import bcrypt from "bcrypt";
import { pool } from "./db.js";

async function seed() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Limpia las tablas principales para evitar conflictos con datos previos.
    await client.query(
      "TRUNCATE chat.message_feedback, chat.messages, chat.participants, chat.conversations RESTART IDENTITY CASCADE"
    );
    await client.query(
      "TRUNCATE auth.oauth_accounts, auth.user_roles, auth.users, auth.roles RESTART IDENTITY CASCADE"
    );

    const roleNames = ["admin", "user", "analyst"];
    const roleIds = new Map();

    for (const name of roleNames) {
      const { rows } = await client.query(
        "INSERT INTO auth.roles (name) VALUES ($1) RETURNING id",
        [name]
      );
      roleIds.set(name, rows[0].id);
    }

    const passwordPlain = "Password123!";
    const passwordHash = await bcrypt.hash(passwordPlain, 10);

    const users = [
      {
        email: "ada.admin@example.com",
        display_name: "Ada Admin",
        is_active: true,
        roles: ["admin", "user"],
      },
      {
        email: "carlos.analyst@example.com",
        display_name: "Carlos Analyst",
        is_active: true,
        roles: ["analyst", "user"],
      },
      {
        email: "sofia.user@example.com",
        display_name: "Sofía Usuaria",
        is_active: true,
        roles: ["user"],
      },
      {
        email: "inactivo@example.com",
        display_name: "Inactivo Ejemplo",
        is_active: false,
        roles: ["user"],
      },
    ];

    const userIds = new Map();

    for (const user of users) {
      const { rows } = await client.query(
        `INSERT INTO auth.users (email, password_hash, display_name, is_active)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [user.email, passwordHash, user.display_name, user.is_active]
      );
      const id = rows[0].id;
      userIds.set(user.email, id);

      for (const roleName of user.roles) {
        const roleId = roleIds.get(roleName);
        await client.query(
          "INSERT INTO auth.user_roles (user_id, role_id) VALUES ($1, $2)",
          [id, roleId]
        );
      }
    }

    // Vincula la cuenta de Google ficticia al analista.
    await client.query(
      `INSERT INTO auth.oauth_accounts (user_id, provider, provider_account_id)
       VALUES ($1, 'google', $2)`,
      [userIds.get("carlos.analyst@example.com"), "google-oauth-demo-123"]
    );

    const conversations = [
      {
        title: "Bienvenida a la plataforma",
        owner: "ada.admin@example.com",
        participants: [
          { email: "ada.admin@example.com", is_owner: true },
          { email: "sofia.user@example.com", is_owner: false },
        ],
        messages: [
          {
            sender: "user",
            senderEmail: "sofia.user@example.com",
            content: "Hola Ada, ¿podrías contarme cómo funciona todo?",
            latency_ms: 420,
          },
          {
            sender: "bot",
            content: "¡Bienvenida! Te ayudaré a conocer las funciones principales.",
            latency_ms: 1800,
          },
          {
            sender: "user",
            senderEmail: "ada.admin@example.com",
            content: "Recuerda revisar la sección de configuraciones para personalizar tu perfil.",
            latency_ms: 600,
          },
        ],
        feedback: [
          {
            messageIndex: 2,
            userEmail: "sofia.user@example.com",
            rating: 5,
            comment: "Respuesta muy clara, gracias",
          },
        ],
      },
      {
        title: "Revisión semanal con el bot",
        owner: "carlos.analyst@example.com",
        participants: [
          { email: "carlos.analyst@example.com", is_owner: true },
          { email: "sofia.user@example.com", is_owner: false },
        ],
        messages: [
          {
            sender: "user",
            senderEmail: "carlos.analyst@example.com",
            content: "Hola bot, ¿cuáles fueron los tickets más valorados esta semana?",
            latency_ms: 800,
          },
          {
            sender: "bot",
            content: "Hubo 12 tickets con calificación promedio 4.7, destacando soporte onboarding.",
            latency_ms: 2100,
          },
          {
            sender: "system",
            content: "Recordatorio: programa tu próxima reunión con soporte.",
            latency_ms: null,
          },
        ],
        feedback: [
          {
            messageIndex: 1,
            userEmail: "sofia.user@example.com",
            rating: 4,
            comment: "El resumen me ayudó, aunque faltaron enlaces",
          },
          {
            messageIndex: 2,
            userEmail: "carlos.analyst@example.com",
            rating: 5,
            comment: "Excelente detalle de métricas",
          },
        ],
      },
      {
        title: "Soporte a usuario inactivo",
        owner: "ada.admin@example.com",
        closed_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        participants: [
          { email: "ada.admin@example.com", is_owner: true },
          { email: "inactivo@example.com", is_owner: false },
        ],
        messages: [
          {
            sender: "user",
            senderEmail: "inactivo@example.com",
            content: "No puedo acceder, creo que mi cuenta está suspendida.",
            latency_ms: 500,
          },
          {
            sender: "user",
            senderEmail: "ada.admin@example.com",
            content: "Tu cuenta estaba inactiva, acabo de reactivarla. Intenta de nuevo.",
            latency_ms: 900,
          },
          {
            sender: "bot",
            content: "Estado de la cuenta: reactivación completada hace 2 minutos.",
            latency_ms: 1500,
          },
        ],
        feedback: [
          {
            messageIndex: 2,
            userEmail: "inactivo@example.com",
            rating: 3,
            comment: "Gracias, aunque tardó un poco",
          },
        ],
      },
    ];

    for (const conversation of conversations) {
      const ownerId = userIds.get(conversation.owner);
      const { rows } = await client.query(
        `INSERT INTO chat.conversations (owner_user_id, title, closed_at)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [ownerId, conversation.title, conversation.closed_at || null]
      );
      const conversationId = rows[0].id;

      const messageIds = [];

      for (const participant of conversation.participants) {
        const participantId = userIds.get(participant.email);
        await client.query(
          `INSERT INTO chat.participants (conversation_id, user_id, is_owner)
           VALUES ($1, $2, $3)
           ON CONFLICT (conversation_id, user_id) DO NOTHING`,
          [conversationId, participantId, participant.is_owner]
        );
      }

      for (const msg of conversation.messages) {
        const senderUserId = msg.senderEmail
          ? userIds.get(msg.senderEmail)
          : null;
        const { rows: messageRows } = await client.query(
          `INSERT INTO chat.messages (
             conversation_id,
             sender_user_id,
             sender,
             content,
             latency_ms
           ) VALUES ($1, $2, $3, $4, $5)
           RETURNING id`,
          [
            conversationId,
            senderUserId,
            msg.sender,
            msg.content,
            msg.latency_ms,
          ]
        );
        messageIds.push(messageRows[0].id);
      }

      for (const feedback of conversation.feedback) {
        const messageId = messageIds[feedback.messageIndex];
        const userId = userIds.get(feedback.userEmail);
        await client.query(
          `INSERT INTO chat.message_feedback (message_id, user_id, rating, comment)
           VALUES ($1, $2, $3, $4)`,
          [messageId, userId, feedback.rating, feedback.comment]
        );
      }
    }

    await client.query("COMMIT");
    console.log("✅ Datos ficticios insertados correctamente.");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("❌ Error al ejecutar el seeding:", error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch(() => process.exit(1));