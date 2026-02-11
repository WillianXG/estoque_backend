import { Router } from "express";
import db from "../db.js";
import { authMiddleware } from "./auth.js";

const router = Router();

router.get("/", authMiddleware, async (req, res) => {
  const result = await db.query("SELECT * FROM produtos ORDER BY nome");
  res.json(result.rows);
});

router.post("/", authMiddleware, async (req, res) => {
  const { nome, preco, subcategoria_id } = req.body;
  const result = await db.query(
    `INSERT INTO produtos (nome, preco, subcategoria_id)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [nome, preco, subcategoria_id]
  );
  res.status(201).json(result.rows[0]);
});

router.put("/:id", authMiddleware, async (req, res) => {
  const { nome, preco } = req.body;
  await db.query(
    "UPDATE produtos SET nome=$1, preco=$2 WHERE id=$3",
    [nome, preco, req.params.id]
  );
  res.sendStatus(204);
});

router.delete("/:id", authMiddleware, async (req, res) => {
  await db.query("DELETE FROM produtos WHERE id=$1", [req.params.id]);
  res.sendStatus(204);
});

export default router;
