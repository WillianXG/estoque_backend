import express from "express";
import db from "../db.js";

const router = express.Router();

router.get("/", async (_, res) => {
  const r = await db.query(`
    SELECT e.*, p.nome
    FROM estoque e
    JOIN produtos p ON p.id = e.produto_id
  `);
  res.json(r.rows);
});

router.post("/", async (req, res) => {
  const { produto_id, quantidade_arara, quantidade_deposito } = req.body;

  const r = await db.query(
    `INSERT INTO estoque
     (produto_id, quantidade_arara, quantidade_deposito)
     VALUES ($1,$2,$3)
     RETURNING *`,
    [produto_id, quantidade_arara, quantidade_deposito]
  );

  res.status(201).json(r.rows[0]);
});

export default router;
