import { Router } from "express";
import db from "../db.js";
import authMiddleware from "./auth.js";


const router = Router();

router.post("/", authMiddleware, async (req, res) => {
  const { itens, forma_pagamento, observacoes } = req.body;

  const client = await db.connect();

  try {
    await client.query("BEGIN");

    if (!itens || itens.length === 0) {
      return res.status(400).json({ erro: "Nenhum item na venda" });
    }

    const valorTotal = itens.reduce((sum, item) => {
      return sum + Number(item.preco) * Number(item.quantidade);
    }, 0);

    // ✅ Cria venda (AGORA COM CANAL)
    const vendaRes = await client.query(
      `
      INSERT INTO vendas
      (vendedora_id, canal, data, valor_total, forma_pagamento, observacoes)
      VALUES ($1, $2, NOW(), $3, $4, $5)
      RETURNING id
      `,
      [
        req.user.id,
        "pdv", // 👈 aqui resolve o erro do NOT NULL
        valorTotal,
        forma_pagamento,
        observacoes
      ]
    );

    const vendaId = vendaRes.rows[0].id;

    // Itens da venda
    for (const item of itens) {

      // 1️⃣ Verifica estoque atual
      const estoqueAtual = await client.query(
        `
        SELECT quantidade_arara
        FROM estoque
        WHERE produto_id = $1
        `,
        [item.produto_id]
      );

      if (estoqueAtual.rows.length === 0) {
        throw new Error("Produto sem estoque cadastrado");
      }

      if (estoqueAtual.rows[0].quantidade_arara < item.quantidade) {
        throw new Error("Estoque insuficiente");
      }

      // 2️⃣ Atualiza estoque
      await client.query(
        `
        UPDATE estoque
        SET quantidade_arara = quantidade_arara - $1
        WHERE produto_id = $2
        `,
        [item.quantidade, item.produto_id]
      );

      // 3️⃣ Insere item da venda
      await client.query(
        `
        INSERT INTO venda_items
        (venda_id, produto_id, quantidade, preco)
        VALUES ($1, $2, $3, $4)
        `,
        [vendaId, item.produto_id, item.quantidade, item.preco]
      );

      // 4️⃣ Registra movimentação
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

    res.status(201).json({ venda_id: vendaId });

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("ERRO AO FINALIZAR VENDA:", err);
    res.status(500).json({ erro: err.message });
  } finally {
    client.release();
  }
});

export default router;
