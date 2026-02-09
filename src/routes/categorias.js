import { Router } from "express";
import db from "../db.js";
import auth from "../middlewares/auth.js";

const router = Router();

router.get("/", auth, async (req, res) => {
  const result = await db.query("SELECT * FROM categorias ORDER BY nome");
  res.json(result.rows);
});

router.post("/", auth, async (req, res) => {
  const { nome } = req.body;
  if (!nome) return res.status(400).json({ erro: "Nome obrigatório" });

  await db.query("INSERT INTO categorias (nome) VALUES ($1)", [nome]);
  res.json({ ok: true });
});

export default router;
