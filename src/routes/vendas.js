import { Router } from "express";
import db from "../db.js";
import authMiddleware from "./auth.js";

const router = Router();

router.post("/", authMiddleware, async (req, res) => {
  const { itens, forma_pagamento, observacoes, canal } = req.body;

  if (!itens || itens.length === 0) {
    return res.status(400).json({ erro: "Nenhum item na venda" });
  }

  if (!forma_pagamento || !canal) {
    return res.status(400).json({ erro: "Forma de pagamento e canal são obrigatórios" });
  }

  const client = await db.connect();

  try {
    await client.query("BEGIN");

    // Calcula valor total
    const valorTotal = itens.reduce(
      (sum, item) => sum + Number(item.preco) * Number(item.quantidade),
      0
    );

    // Cria venda
    const vendaRes = await client.query(
      `
      INSERT INTO vendas
      (vendedora_id, canal, data, valor_total, forma_pagamento, observacoes)
      VALUES ($1, $2, NOW(), $3, $4, $5)
      RETURNING id
      `,
      [req.user.id, canal, valorTotal, forma_pagamento, observacoes || null]
    );

    const vendaId = vendaRes.rows[0].id;

    // Loop de itens da venda
    for (const item of itens) {
      // Verifica estoque
      const estoqueRes = await client.query(
        `SELECT quantidade_arara FROM estoque WHERE produto_id = $1`,
        [item.produto_id]
      );

      if (estoqueRes.rows.length === 0) {
        throw new Error(`Produto ${item.produto_id} sem estoque cadastrado`);
      }

      const estoqueAtual = estoqueRes.rows[0].quantidade_arara;

      if (estoqueAtual < item.quantidade) {
        throw new Error(`Estoque insuficiente para o produto ${item.produto_id}`);
      }

      // Atualiza estoque
      await client.query(
        `UPDATE estoque SET quantidade_arara = quantidade_arara - $1 WHERE produto_id = $2`,
        [item.quantidade, item.produto_id]
      );

      // Insere item na venda
      await client.query(
        `
        INSERT INTO venda_itens
        (venda_id, produto_id, quantidade, preco_unitario)
        VALUES ($1, $2, $3, $4)
        `,
        [vendaId, item.produto_id, item.quantidade, item.preco]
      );

      // Registra movimentação
      await client.query(
        `
        INSERT INTO movimentacoes_estoque
        (produto_id, usuario_id, tipo, local, quantidade, motivo)
        VALUES ($1, $2, 'saida', 'arara', $3, $4)
        `,
        [item.produto_id, req.user.id, item.quantidade, `Venda #${vendaId}`]
      );
    }

    await client.query("COMMIT");

    res.status(201).json({ venda_id: vendaId, mensagem: "Venda finalizada com sucesso" });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("ERRO AO FINALIZAR VENDA:", err.message);
    res.status(500).json({ erro: err.message });
  } finally {
    client.release();
  }
});

export default router;