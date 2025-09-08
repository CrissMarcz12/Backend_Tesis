// Importamos el cliente MySQL de mysql2 con soporte de Promesas
import mysql from "mysql2/promise";
import 'dotenv/config';

// Cargamos las variables de entorno desde .env en server.js; aquí solo las usamos vía process.env
const {
  MYSQL_HOST,
  MYSQL_USER,
  MYSQL_PASSWORD,
  MYSQL_DATABASE
} = process.env;

// Creamos un "pool" de conexiones: MySQL mantiene un conjunto de conexiones listas
export const pool = mysql.createPool({
  host: MYSQL_HOST,         // Dirección del servidor MySQL
  user: MYSQL_USER,         // Usuario de MySQL
  password: MYSQL_PASSWORD, // Contraseña de MySQL
  database: MYSQL_DATABASE, // Base de datos por defecto
  waitForConnections: true, // Espera si no hay conexión disponible
  connectionLimit: 10,      // Máximo de conexiones en el pool
  queueLimit: 0             // Sin límite de cola
});

// Función de ayuda: ejecuta un query con parámetros y devuelve [rows]
export async function query(sql, params = []) {
  // pool.execute devuelve [rows, fields]; solo nos interesan rows
  const [rows] = await pool.execute(sql, params);
  return rows;
}
