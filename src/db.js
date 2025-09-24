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
