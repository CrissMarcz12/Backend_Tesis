// Importamos el cliente PostgreSQL de pg
import pkg from "pg";
import "dotenv/config";

const { Pool } = pkg;

// Creamos un "pool" de conexiones: PostgreSQL mantiene un conjunto de conexiones listas
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Función de ayuda: ejecuta un query con parámetros y devuelve [rows]
export async function query(sql, params = []) {
  const res = await pool.query(sql, params);
  return res.rows;
}

// Helper sencillo para ejecutar bloques dentro de una transacción explícita.
// Se usa cuando necesitamos varias operaciones atómicas (por ejemplo, crear
// una conversación y registrar automáticamente al propietario como
// participante).
export async function withTransaction(callback) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await callback({
      query: (sql, params = []) => client.query(sql, params),
      client,
    });
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}