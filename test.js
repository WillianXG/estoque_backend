import "dotenv/config";
import pool from "./src/db.js";

console.log("DATABASE_URL =", process.env.DATABASE_URL);

try {
  const res = await pool.query("select now()");
  console.log("Conectado ao banco ✅", res.rows);
} catch (err) {
  console.error("Erro real ❌", err);
}
