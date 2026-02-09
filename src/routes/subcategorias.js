import { Router } from "express";
import db from "../db.js";
import auth from "../middlewares/auth.js";

const router = Router();

router.get("/", auth, async (req, res) => {
  const result = await db.query("SELECT * FROM subcategorias");
  res.json(result.rows);
});

router.post("/", auth, async (req, res) => {
  const { nome, categoria_id } = req.body;
  await db.query(
    "INSERT INTO subcategorias (nome, categoria_id) VALUES ($1,$2)",
    [nome, categoria_id]
  );
  res.json({ ok: true });
});

export default router;
