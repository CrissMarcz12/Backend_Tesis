import { pool } from "./db.js";

async function createAuthSchema() {
  await pool.query(`CREATE SCHEMA IF NOT EXISTS auth;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS auth.users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT,
      display_name TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      verification_code TEXT,
      verification_expires TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS auth.roles (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS auth.user_roles (
      user_id INTEGER NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      role_id INTEGER NOT NULL REFERENCES auth.roles(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, role_id)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS auth.oauth_accounts (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      provider_account_id TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (provider, provider_account_id)
    );
  `);
}

async function createChatSchema() {
  await pool.query(`CREATE SCHEMA IF NOT EXISTS chat;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS chat.conversations (
      id SERIAL PRIMARY KEY,
      owner_user_id INTEGER REFERENCES auth.users(id) ON DELETE SET NULL,
      title TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      closed_at TIMESTAMPTZ,
      is_active BOOLEAN NOT NULL DEFAULT TRUE
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS chat.participants (
      conversation_id INTEGER NOT NULL REFERENCES chat.conversations(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      is_owner BOOLEAN NOT NULL DEFAULT FALSE,
      added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (conversation_id, user_id)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS chat.messages (
      id SERIAL PRIMARY KEY,
      conversation_id INTEGER NOT NULL REFERENCES chat.conversations(id) ON DELETE CASCADE,
      sender_user_id INTEGER REFERENCES auth.users(id) ON DELETE SET NULL,
      sender TEXT NOT NULL,
      content TEXT NOT NULL,
      latency_ms INTEGER,
      metadata JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS chat.message_feedback (
      id SERIAL PRIMARY KEY,
      message_id INTEGER NOT NULL REFERENCES chat.messages(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      rating INTEGER NOT NULL,
      comment TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (message_id, user_id)
    );
  `);
}

async function createAdminSchema() {
  await pool.query(`CREATE SCHEMA IF NOT EXISTS admin;`);

  await pool.query(`
    CREATE OR REPLACE VIEW admin.v_conversations_summary AS
    SELECT
      c.id AS conversation_id,
      c.owner_user_id,
      u.email AS owner_email,
      u.display_name AS owner_display_name,
      c.title,
      c.created_at,
      c.closed_at,
      c.is_active,
      COALESCE(m.messages_count, 0)::int AS messages_count,
      m.last_message_at,
      COALESCE(p.participants_count, 0)::int AS participants_count
    FROM chat.conversations c
    LEFT JOIN auth.users u ON u.id = c.owner_user_id
    LEFT JOIN (
      SELECT conversation_id, COUNT(*) AS messages_count, MAX(created_at) AS last_message_at
      FROM chat.messages
      GROUP BY conversation_id
    ) m ON m.conversation_id = c.id
    LEFT JOIN (
      SELECT conversation_id, COUNT(*) AS participants_count
      FROM chat.participants
      GROUP BY conversation_id
    ) p ON p.conversation_id = c.id;
  `);

  await pool.query(`
    CREATE OR REPLACE VIEW admin.v_feedback_stats_by_user AS
    SELECT
      u.id AS user_id,
      u.email AS user_email,
      u.display_name AS user_display_name,
      COUNT(f.*)::int AS total_ratings,
      COALESCE(ROUND(AVG(f.rating)::numeric, 2), 0)::float AS avg_rating,
      MAX(f.created_at) AS last_rating_at
    FROM auth.users u
    LEFT JOIN chat.message_feedback f ON f.user_id = u.id
    GROUP BY u.id, u.email, u.display_name;
  `);
}

export async function ensureDatabaseSchema() {
  await createAuthSchema();
  await createChatSchema();
  await createAdminSchema();
}

export async function ensureChatMessageMetadataColumn() {
  await pool.query(`CREATE SCHEMA IF NOT EXISTS chat;`);

  await pool.query(`
    ALTER TABLE IF EXISTS chat.messages
    ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
  `);
}