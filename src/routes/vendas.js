import express from "express";
import db from "../db.js";

const router = express.Router();

router.post("/", async (req, res) => {
  const { vendedora_id, itens } = req.body;

  const venda = await db.query(
    "INSERT INTO vendas (vendedora_id, data, valor_total) VALUES ($1, NOW(), 0) RETURNING *",
    [vendedora_id]
  );

  let total = 0;

  for (const item of itens) {
    total += item.quantidade * item.preco_unitario;

    await db.query(
      `INSERT INTO venda_itens
       (venda_id, produto_id, quantidade, preco_unitario)
       VALUES ($1,$2,$3,$4)`,
      [venda.rows[0].id, item.produto_id, item.quantidade, item.preco_unitario]
    );
  }

  await db.query(
    "UPDATE vendas SET valor_total=$1 WHERE id=$2",
    [total, venda.rows[0].id]
  );

  res.status(201).json({ venda_id: venda.rows[0].id, total });
});

export default router;
