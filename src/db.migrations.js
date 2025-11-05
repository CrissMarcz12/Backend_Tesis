import { pool } from "./db.js";

export async function ensureChatMessageMetadataColumn() {
  await pool.query(
    `ALTER TABLE chat.messages ADD COLUMN IF NOT EXISTS metadata jsonb`
  );
}