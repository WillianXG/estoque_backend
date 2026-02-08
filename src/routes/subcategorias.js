import express from "express";
import db from "../db.js";

const router = express.Router();

router.get("/", async (_, res) => {
  const r = await db.query(`
    SELECT s.*, c.nome AS categoria
    FROM subcategorias s
    JOIN categorias c ON c.id = s.categoria_id
  `);
  res.json(r.rows);
});

router.post("/", async (req, res) => {
  const { nome, categoria_id } = req.body;

  const r = await db.query(
    "INSERT INTO subcategorias (nome, categoria_id) VALUES ($1,$2) RETURNING *",
    [nome, categoria_id]
  );
  res.status(201).json(r.rows[0]);
});

export default router;
