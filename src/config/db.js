import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

if (
  process.env.DB_HOST === "" ||
  process.env.DB_PORT === "" ||
  process.env.DB_USER === "" ||
  process.env.DB_PASS === "" ||
  process.env.DB_NAME === ""
) {
  throw new Error("envirovment required");
}
export default pool;
