import { Router } from "express";
import db from "../db.js";
import { authMiddleware } from "./auth.js";

const router = Router();

router.post("/", authMiddleware, async (req, res) => {
  const { itens } = req.body;
  const client = await db.connect();

  try {
    await client.query("BEGIN");

    const venda = await client.query(
      "INSERT INTO vendas (vendedora_id, data) VALUES ($1, NOW()) RETURNING id",
      [req.user.id]
    );

    for (const item of itens) {
      await client.query(
        `INSERT INTO venda_itens (venda_id, produto_id, quantidade, preco)
         VALUES ($1, $2, $3, $4)`,
        [venda.rows[0].id, item.produto_id, item.quantidade, item.preco]
      );

      await client.query(
        "UPDATE estoque SET quantidade = quantidade - $1 WHERE produto_id = $2",
        [item.quantidade, item.produto_id]
      );
    }

    await client.query("COMMIT");
    res.status(201).json({ venda_id: venda.rows[0].id });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ erro: "Erro ao finalizar venda" });
  } finally {
    client.release();
  }
});

export default router;
