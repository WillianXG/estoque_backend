import { Router } from "express";
import db from "../db.js";
import { authMiddleware } from "./auth.js";

const router = Router();

/**
 * GET /subcategorias?categoriaId=1
 * Lista todas as subcategorias ou filtra por categoria
 */
router.get("/", authMiddleware, async (req, res) => {
  const { categoriaId } = req.query;

  let query = "SELECT * FROM subcategorias";
  let params = [];

  if (categoriaId) {
    query += " WHERE categoria_id = $1";
    params.push(categoriaId);
  }

  query += " ORDER BY nome";

  const result = await db.query(query, params);
  res.json(result.rows);
});

/**
 * POST /subcategorias
 * Cria uma subcategoria ligada a uma categoria
 */
router.post("/", authMiddleware, async (req, res) => {
  const { nome, categoria_id } = req.body;
  if (!categoria_id) return res.status(400).json({ erro: "categoria_id é obrigatório" });

  const result = await db.query(
    "INSERT INTO subcategorias (nome, categoria_id) VALUES ($1, $2) RETURNING *",
    [nome, categoria_id]
  );
  res.status(201).json(result.rows[0]);
});

/**
 * PUT /subcategorias/:id
 * Atualiza nome ou categoria da subcategoria
 */
router.put("/:id", authMiddleware, async (req, res) => {
  const { nome, categoria_id } = req.body;
  await db.query(
    "UPDATE subcategorias SET nome = $1, categoria_id = $2 WHERE id = $3",
    [nome, categoria_id, req.params.id]
  );
  res.sendStatus(204);
});

/**
 * DELETE /subcategorias/:id
 */
router.delete("/:id", authMiddleware, async (req, res) => {
  await db.query("DELETE FROM subcategorias WHERE id = $1", [req.params.id]);
  res.sendStatus(204);
});

export default router;
