import { Router } from "express";
import db from "../db.js";
import { authMiddleware } from "./auth.js";

const router = Router();

router.get("/", authMiddleware, async (req, res) => {
  const result = await db.query("SELECT * FROM categorias ORDER BY nome");
  res.json(result.rows);
});

router.post("/", authMiddleware, async (req, res) => {
  const { nome } = req.body;
  const result = await db.query(
    "INSERT INTO categorias (nome) VALUES ($1) RETURNING *",
    [nome]
  );
  res.status(201).json(result.rows[0]);
});

router.put("/:id", authMiddleware, async (req, res) => {
  const { nome } = req.body;
  await db.query(
    "UPDATE categorias SET nome = $1 WHERE id = $2",
    [nome, req.params.id]
  );
  res.sendStatus(204);
});

router.delete("/:id", authMiddleware, async (req, res) => {
  await db.query("DELETE FROM categorias WHERE id = $1", [req.params.id]);
  res.sendStatus(204);
});

export default router;
