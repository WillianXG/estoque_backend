import express from "express";
import db from "../db.js";

const router = express.Router();

router.get("/", async (_, res) => {
  const r = await db.query(`
    SELECT p.*, c.nome AS categoria, s.nome AS subcategoria
    FROM produtos p
    JOIN categorias c ON c.id = p.categoria_id
    LEFT JOIN subcategorias s ON s.id = p.subcategoria_id
  `);
  res.json(r.rows);
});

router.post("/", async (req, res) => {
  const {
    nome,
    categoria_id,
    subcategoria_id,
    variacao,
    preco,
    imagem_url
  } = req.body;

  const r = await db.query(
    `INSERT INTO produtos
     (nome, categoria_id, subcategoria_id, variacao, preco, imagem_url)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING *`,
    [nome, categoria_id, subcategoria_id, variacao, preco, imagem_url]
  );

  res.status(201).json(r.rows[0]);
});

export default router;
