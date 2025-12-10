import pool from "./db.js";

export async function ensureChatMessageMetadataColumn() {
  await pool.query(`CREATE SCHEMA IF NOT EXISTS chat;`);

  await pool.query(`
    ALTER TABLE IF EXISTS chat.messages
    ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
  `);
}
