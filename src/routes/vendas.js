import { Router } from "express";
import db from "../db.js";
import auth from "../middlewares/auth.js";

const router = Router();

router.post("/", auth, async (req, res) => {
  const { itens, total } = req.body;

  const venda = await db.query(
    "INSERT INTO vendas (valor_total) VALUES ($1) RETURNING id",
    [total]
  );

  for (const item of itens) {
    await db.query(
      "INSERT INTO venda_itens (venda_id, produto_id, quantidade, preco_unitario) VALUES ($1,$2,$3,$4)",
      [venda.rows[0].id, item.produto_id, item.qtd, item.preco]
    );
  }

  res.json({ ok: true });
});

export default router;
