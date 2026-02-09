import { Router } from "express";
import db from "../db.js";
import auth from "../middlewares/auth.js";

const router = Router();

router.get("/", auth, async (req, res) => {
  const result = await db.query("SELECT * FROM produtos");
  res.json(result.rows);
});

router.post("/", auth, async (req, res) => {
  const { nome, preco, categoria_id } = req.body;

  await db.query(
    "INSERT INTO produtos (nome, preco, categoria_id) VALUES ($1,$2,$3)",
    [nome, preco, categoria_id]
  );

  res.json({ ok: true });
});

export default router;
