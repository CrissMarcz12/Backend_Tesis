import { Router } from "express";
import { ensureAuth, ensureRole } from "../middlewares/auth.js";
import { query } from "../db.js";

const router = Router();

router.use(ensureAuth, ensureRole("admin"));

// Resumen paginado de conversaciones con estadísticas clave.
router.get("/conversations", async (req, res) => {
  try {
    const { page = "1", limit = "20", q = "", owner, participant } = req.query;

    const p = Math.max(parseInt(page, 10) || 1, 1);
    const l = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const offset = (p - 1) * l;

    const clauses = [];
    const params = [];

    if (q) {
      params.push(`%${q}%`);
      clauses.push(`(v.title ILIKE $${params.length})`);
    }

    if (owner) {
      params.push(owner);
      clauses.push(`v.owner_user_id = $${params.length}`);
    }

    if (participant) {
      params.push(participant);
      clauses.push(
        `EXISTS (
           SELECT 1 FROM chat.participants p
           WHERE p.conversation_id = v.conversation_id
             AND p.user_id = $${params.length}
         )`
      );
    }

    const whereSQL = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

    const totalRows = await query(
      `SELECT COUNT(*)::int AS count
       FROM admin.v_conversations_summary v
       ${whereSQL}`,
      params
    );
    const total = totalRows[0]?.count || 0;

    const rows = await query(
      `SELECT *
       FROM admin.v_conversations_summary v
       ${whereSQL}
       ORDER BY v.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, l, offset]
    );

    res.json({ ok: true, page: p, limit: l, total, data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: "internal_error" });
  }
});

// Detalle completo de una conversación: participantes, mensajes y feedback.
router.get("/conversations/:id", async (req, res) => {
  try {
    const conversationId = req.params.id;

    const conversations = await query(
      `SELECT id, owner_user_id, title, created_at, closed_at
       FROM chat.conversations
       WHERE id = $1`,
      [conversationId]
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

    const messages = await query(
      `SELECT
         m.id,
         m.sender,
         m.sender_user_id,
         su.display_name AS sender_display_name,
         su.email AS sender_email,
         m.content,
         m.latency_ms,
         m.created_at,
         COALESCE(feedback.items, '[]'::json) AS feedback
       FROM chat.messages m
       LEFT JOIN auth.users su ON su.id = m.sender_user_id
       LEFT JOIN LATERAL (
         SELECT json_agg(
                  json_build_object(
                    'id', f.id,
                    'user_id', f.user_id,
                    'user_display_name', fu.display_name,
                    'user_email', fu.email,
                    'rating', f.rating,
                    'comment', f.comment,
                    'created_at', f.created_at
                  )
                  ORDER BY f.created_at
                ) AS items
         FROM chat.message_feedback f
         JOIN auth.users fu ON fu.id = f.user_id
         WHERE f.message_id = m.id
       ) feedback ON TRUE
       WHERE m.conversation_id = $1
       ORDER BY m.created_at ASC`,
      [conversationId]
    );

    res.json({ ok: true, data: { ...conversation, participants, messages } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: "internal_error" });
  }
});

// Resumen de calificaciones agrupadas por usuario.
router.get("/feedback/summary", async (_req, res) => {
  try {
    const rows = await query(
      `SELECT *
       FROM admin.v_feedback_stats_by_user
       ORDER BY total_ratings DESC, avg_rating DESC`
    );

    res.json({ ok: true, data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: "internal_error" });
  }
});

// Listado paginado de calificaciones individuales (para ver sugerencias).
router.get("/feedback/messages", async (req, res) => {
  try {
    const { page = "1", limit = "20", conversation, user } = req.query;

    const p = Math.max(parseInt(page, 10) || 1, 1);
    const l = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const offset = (p - 1) * l;

    const clauses = [];
    const params = [];

    if (conversation) {
      params.push(conversation);
      clauses.push(`m.conversation_id = $${params.length}`);
    }

    if (user) {
      params.push(user);
      clauses.push(`f.user_id = $${params.length}`);
    }

    const whereSQL = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

    const totalRows = await query(
      `SELECT COUNT(*)::int AS count
       FROM chat.message_feedback f
       JOIN chat.messages m ON m.id = f.message_id
       ${whereSQL}`,
      params
    );
    const total = totalRows[0]?.count || 0;

    const rows = await query(
      `SELECT
         f.id,
         f.message_id,
         f.user_id,
         fu.display_name AS user_display_name,
         fu.email AS user_email,
         f.rating,
         f.comment,
         f.created_at,
         m.conversation_id,
         m.sender,
         m.created_at AS message_created_at,
         su.display_name AS sender_display_name,
         su.email AS sender_email
       FROM chat.message_feedback f
       JOIN chat.messages m ON m.id = f.message_id
       JOIN auth.users fu ON fu.id = f.user_id
       LEFT JOIN auth.users su ON su.id = m.sender_user_id
       ${whereSQL}
       ORDER BY f.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, l, offset]
    );

    res.json({ ok: true, page: p, limit: l, total, data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: "internal_error" });
  }
});

export default router;