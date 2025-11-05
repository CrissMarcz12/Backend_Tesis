import { Router } from "express";
import { ensureAuth } from "../middlewares/auth.js";
import { query, withTransaction } from "../db.js";
import { buildRagPayload, queryRag, RagClientError } from "../services/ragClient.js";

const router = Router();

// Todas las rutas requieren que el usuario esté autenticado.
router.use(ensureAuth);

// Lista las conversaciones a las que pertenece el usuario (propietario o invitado).
router.get("/conversations", async (req, res) => {
  try {
    const userId = req.user.id;
    const { page = "1", limit = "20" } = req.query;

    const p = Math.max(parseInt(page, 10) || 1, 1);
    const l = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const offset = (p - 1) * l;

    const totalRows = await query(
      `SELECT COUNT(DISTINCT p.conversation_id)::int AS count
       FROM chat.participants p
       JOIN chat.conversations c ON c.id = p.conversation_id
       WHERE p.user_id = $1 AND c.is_active`,
      [userId]
    );
    const total = totalRows[0]?.count || 0;

    const conversations = await query(
      `SELECT
         c.id,
         c.title,
         c.owner_user_id,
         c.created_at,
         c.closed_at,
         c.is_active,
         COALESCE(stats.messages_count, 0) AS messages_count,
         stats.last_message_at,
         COALESCE(participants.participants, '[]'::json) AS participants
       FROM chat.conversations c
       JOIN chat.participants self
         ON self.conversation_id = c.id AND self.user_id = $1
       LEFT JOIN LATERAL (
         SELECT
           COUNT(*)::int AS messages_count,
           MAX(created_at) AS last_message_at
         FROM chat.messages m
         WHERE m.conversation_id = c.id
       ) stats ON TRUE
       LEFT JOIN LATERAL (
         SELECT json_agg(
                  json_build_object(
                    'user_id', cp.user_id,
                    'is_owner', cp.is_owner,
                    'added_at', cp.added_at
                  )
                  ORDER BY cp.added_at
                ) AS participants
         FROM chat.participants cp
         WHERE cp.conversation_id = c.id
       ) participants ON TRUE
       WHERE c.is_active
       ORDER BY COALESCE(stats.last_message_at, c.created_at) DESC
       LIMIT $2 OFFSET $3`,
      [userId, l, offset]
    );

    res.json({ ok: true, page: p, limit: l, total, data: conversations });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: "internal_error" });
  }
});

// Crear una nueva conversación y registrar al creador como propietario.
router.post("/conversations", async (req, res) => {
  try {
    const userId = req.user.id;
    const title = req.body.title?.trim() || null;

    const conversation = await withTransaction(async ({ query }) => {
      const { rows: convRows } = await query(
        `INSERT INTO chat.conversations (owner_user_id, title)
         VALUES ($1, $2)
         RETURNING id, owner_user_id, title, created_at, closed_at is_active`,
        [userId, title]
      );

      const conv = convRows[0];

      await query(
        `INSERT INTO chat.participants (conversation_id, user_id, is_owner)
         VALUES ($1, $2, TRUE)
         ON CONFLICT (conversation_id, user_id) DO NOTHING`,
        [conv.id, userId]
      );

      const { rows: participants } = await query(
        `SELECT conversation_id, user_id, is_owner, added_at
         FROM chat.participants
         WHERE conversation_id = $1
         ORDER BY added_at`,
        [conv.id]
      );

      return { ...conv, participants };
    });

    res.status(201).json({ ok: true, data: conversation });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: "internal_error" });
  }
});

// Detalle de una conversación (solo para participantes).
router.get("/conversations/:id", async (req, res) => {
  try {
    const conversationId = req.params.id;
    const userId = req.user.id;

    const conversations = await query(
            `SELECT c.id, c.title, c.owner_user_id, c.created_at, c.closed_at, c.is_active
       FROM chat.conversations c
       JOIN chat.participants p
         ON p.conversation_id = c.id AND p.user_id = $2
       WHERE c.id = $1 AND c.is_active`
      [conversationId, userId]
    );

    const conversation = conversations[0];
    if (!conversation) {
      return res.status(404).json({ ok: false, error: "conversation_not_found" });
    }

    const participants = await query(
      `SELECT p.user_id, p.is_owner, p.added_at,
              u.display_name, u.email
       FROM chat.participants p
       JOIN auth.users u ON u.id = p.user_id
       WHERE p.conversation_id = $1
       ORDER BY p.added_at`,
      [conversationId]
    );

    const statsRows = await query(
      `SELECT COUNT(*)::int AS messages_count,
              MAX(created_at) AS last_message_at
       FROM chat.messages
       WHERE conversation_id = $1`,
      [conversationId]
    );

    res.json({
      ok: true,
      data: {
        ...conversation,
        participants,
        messages_count: statsRows[0]?.messages_count || 0,
        last_message_at: statsRows[0]?.last_message_at || null,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: "internal_error" });
  }
});

// Eliminación lógica de una conversación (solo el propietario puede hacerlo).
router.delete("/conversations/:id", async (req, res) => {
  try {
    const conversationId = req.params.id;
    const userId = req.user.id;

    const rows = await query(
      `UPDATE chat.conversations c
       SET is_active = FALSE,
           closed_at = COALESCE(c.closed_at, NOW())
       WHERE c.id = $1 AND c.owner_user_id = $2 AND c.is_active
       RETURNING c.id, c.title, c.owner_user_id, c.created_at, c.closed_at, c.is_active`,
      [conversationId, userId]
    );

    if (!rows.length) {
      return res.status(404).json({ ok: false, error: "conversation_not_found" });
    }

    res.json({ ok: true, data: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: "internal_error" });
  }
});

// Listado de mensajes dentro de una conversación (solo participantes).
router.get("/conversations/:id/messages", async (req, res) => {
  try {
    const conversationId = req.params.id;
    const userId = req.user.id;

    const membership = await query(
      `SELECT 1
       FROM chat.participants p
       JOIN chat.conversations c ON c.id = p.conversation_id AND c.is_active
       WHERE p.conversation_id = $1 AND p.user_id = $2
       LIMIT 1`,
      [conversationId, userId]
    );

    if (!membership.length) {
      return res.status(404).json({ ok: false, error: "conversation_not_found" });
    }

    const messages = await query(
      `SELECT
         m.id,
         m.conversation_id,
         m.sender_user_id,
         m.sender,
         m.content,
         m.latency_ms,
         m.created_at,
          m.metadata,
         COALESCE(feedback.items, '[]'::json) AS feedback
       FROM chat.messages m
       LEFT JOIN LATERAL (
         SELECT json_agg(
                  json_build_object(
                    'id', f.id,
                    'user_id', f.user_id,
                    'rating', f.rating,
                    'comment', f.comment,
                    'created_at', f.created_at
                  )
                  ORDER BY f.created_at
                ) AS items
         FROM chat.message_feedback f
         WHERE f.message_id = m.id
       ) feedback ON TRUE
       WHERE m.conversation_id = $1
       ORDER BY m.created_at ASC`,
      [conversationId]
    );

    res.json({ ok: true, data: messages });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: "internal_error" });
  }
});

// Registrar un mensaje dentro de una conversación.
router.post("/conversations/:id/messages", async (req, res) => {
  try {
    const conversationId = req.params.id;
    const userId = req.user.id;
    const { content, sender = "user", latency_ms = null, sender_user_id } = req.body;

    if (!content || typeof content !== "string" || !content.trim()) {
      return res.status(400).json({ ok: false, error: "invalid_content" });
    }

    const membership = await query(
      `SELECT p.is_owner
       FROM chat.participants p
       JOIN chat.conversations c ON c.id = p.conversation_id AND c.is_active
       WHERE p.conversation_id = $1 AND p.user_id = $2
       LIMIT 1`,
      [conversationId, userId]
    );

    if (!membership.length) {
      return res.status(404).json({ ok: false, error: "conversation_not_found" });
    }

    const allowedSenders = new Set(["user", "bot", "system"]);
    if (!allowedSenders.has(sender)) {
      return res.status(400).json({ ok: false, error: "invalid_sender" });
    }

    let latency = null;
    if (latency_ms !== null && latency_ms !== undefined) {
      const parsed = Number(latency_ms);
      if (!Number.isFinite(parsed) || parsed < 0) {
        return res.status(400).json({ ok: false, error: "invalid_latency" });
      }
      latency = Math.round(parsed);
    }

    let senderUserId = null;
    if (sender === "user") {
      senderUserId = userId;
    } else if (sender_user_id) {
      senderUserId = sender_user_id;
      if (senderUserId !== userId) {
        const allowed = await query(
          `SELECT 1
           FROM chat.participants p
           JOIN chat.conversations c ON c.id = p.conversation_id AND c.is_active
           WHERE p.conversation_id = $1 AND p.user_id = $2
           LIMIT 1`,
          [conversationId, senderUserId]
        );
        if (!allowed.length) {
          return res.status(400).json({ ok: false, error: "invalid_sender_user" });
        }
      }
    }

    const rows = await query(
      `INSERT INTO chat.messages (
         conversation_id,
         sender_user_id,
         sender,
         content,
         latency_ms
       ) VALUES ($1, $2, $3, $4, $5)
              RETURNING id, conversation_id, sender_user_id, sender, content, latency_ms, created_at, metadata`,
      [conversationId, senderUserId, sender, content.trim(), latency]
    );

    res.status(201).json({ ok: true, data: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: "internal_error" });
  }
});


router.post("/conversations/:id/ask", async (req, res) => {
  try {
    const conversationId = req.params.id;
    const userId = req.user.id;
    const { question, k = undefined, evaluate = undefined } = req.body || {};

    let payload;
    try {
      payload = buildRagPayload({ question, k, evaluate });
    } catch (err) {
      if (err instanceof RagClientError) {
        return res.status(400).json({ ok: false, error: "invalid_request", message: err.message });
      }
      throw err;
    }

    const membership = await query(
      `SELECT p.is_owner
       FROM chat.participants p
       JOIN chat.conversations c ON c.id = p.conversation_id AND c.is_active
       WHERE p.conversation_id = $1 AND p.user_id = $2
       LIMIT 1`,
      [conversationId, userId]
    );

    if (!membership.length) {
      return res.status(404).json({ ok: false, error: "conversation_not_found" });
    }

    const sanitizedQuestion = payload.question;

    const userRows = await query(
      `INSERT INTO chat.messages (
         conversation_id,
         sender_user_id,
         sender,
         content,
         latency_ms
       ) VALUES ($1, $2, 'user', $3, NULL)
       RETURNING id, conversation_id, sender_user_id, sender, content, latency_ms, created_at, metadata`,
      [conversationId, userId, sanitizedQuestion]
    );

    const userMessage = userRows[0];

    let ragResult;
    try {
      ragResult = await queryRag(payload);
    } catch (err) {
      console.error("Error al consultar el motor RAG", err);
      const errorMetadata = {
        rag: {
          request: payload,
          error: {
            message: err.message,
            status: err.status ?? null,
            details: err.details ?? null,
          },
        },
      };

      await query(
        `INSERT INTO chat.messages (
           conversation_id,
           sender_user_id,
           sender,
           content,
           latency_ms,
           metadata
         ) VALUES ($1, NULL, 'system', $2, NULL, $3)
         RETURNING id`,
        [conversationId, "Ocurrió un problema al consultar la IA. Intenta nuevamente más tarde.", JSON.stringify(errorMetadata)]
      );

      if (err instanceof RagClientError && err.status === 400) {
        return res.status(400).json({ ok: false, error: "rag_invalid_request", message: err.message });
      }

      return res.status(502).json({ ok: false, error: "rag_unavailable", message: err.message });
    }

    const botMetadata = {
      rag: {
        request: ragResult.rag_request,
        response: {
          sources: ragResult.sources,
          evaluation: ragResult.evaluation,
        },
        raw: ragResult.raw,
      },
    };

    const botRows = await query(
      `INSERT INTO chat.messages (
         conversation_id,
         sender_user_id,
         sender,
         content,
         latency_ms,
         metadata
       ) VALUES ($1, NULL, 'bot', $2, $3, $4)
       RETURNING id, conversation_id, sender_user_id, sender, content, latency_ms, created_at, metadata`,
      [conversationId, ragResult.answer, ragResult.latency_ms, JSON.stringify(botMetadata)]
    );

    const botMessage = botRows[0];

    res.status(201).json({
      ok: true,
      data: {
        user: userMessage,
        bot: botMessage,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: "internal_error" });
  }
});


// Calificar un mensaje (1-5) y opcionalmente dejar un comentario/sugerencia.
router.post("/messages/:id/feedback", async (req, res) => {
  try {
    const messageId = req.params.id;
    const userId = req.user.id;
    const rating = Number(req.body.rating);
    const comment = req.body.comment?.trim() || null;

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ ok: false, error: "invalid_rating" });
    }

    const ownership = await query(
      `SELECT 1
       FROM chat.messages m
              JOIN chat.conversations c ON c.id = m.conversation_id AND c.is_active
       JOIN chat.participants p
         ON p.conversation_id = m.conversation_id AND p.user_id = $2
       WHERE m.id = $1
       LIMIT 1`,
      [messageId, userId]
    );

    if (!ownership.length) {
      return res.status(404).json({ ok: false, error: "message_not_found" });
    }

    const rows = await query(
      `INSERT INTO chat.message_feedback (message_id, user_id, rating, comment)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (message_id, user_id) DO UPDATE
         SET rating = EXCLUDED.rating,
             comment = EXCLUDED.comment,
             created_at = now()
       RETURNING id, message_id, user_id, rating, comment, created_at`,
      [messageId, userId, rating, comment]
    );

    res.json({ ok: true, data: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: "internal_error" });
  }
});

export default router;