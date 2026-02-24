import { Router } from "express";
import db from "../db.js";
import { authMiddleware } from "./auth.js";

const router = Router();

/**
 * 🛒 Finalizar venda
 * POST /vendas
 * Body: { itens: [{produto_id, quantidade, preco}], forma_pagamento, observacoes, canal }
 */
router.post("/", authMiddleware, async (req, res) => {
  const { itens, forma_pagamento, observacoes, canal } = req.body;

  // Validação de usuário
  if (!req.user || !req.user.id) {
    return res.status(401).json({ erro: "Usuário não autenticado" });
  }

  // Validação de itens
  if (!itens || itens.length === 0) {
    return res.status(400).json({ erro: "Nenhum item na venda" });
  }

  const client = await db.connect();

  try {
    await client.query("BEGIN");

    // Calcula valor total da venda
    const valorTotal = itens.reduce(
      (sum, item) => sum + Number(item.preco) * Number(item.quantidade),
      0
    );

    // Insere venda
    const vendaRes = await client.query(
      `
      INSERT INTO vendas
      (vendedora_id, canal, data, valor_total, forma_pagamento, observacoes)
      VALUES ($1, $2, NOW(), $3, $4, $5)
      RETURNING id
      `,
      [req.user.id, canal || "pdv", valorTotal, forma_pagamento, observacoes]
    );

    const vendaId = vendaRes.rows[0].id;

    // Processa cada item da venda
    for (const item of itens) {
      // Consulta estoque
      const estoqueRes = await client.query(
        `SELECT quantidade_arara FROM estoque WHERE produto_id = $1`,
        [item.produto_id]
      );

      if (estoqueRes.rows.length === 0) {
        throw new Error(`Produto ID ${item.produto_id} sem estoque cadastrado`);
      }

      if (estoqueRes.rows[0].quantidade_arara < item.quantidade) {
        throw new Error(`Estoque insuficiente para o produto ID ${item.produto_id}`);
      }

      // Atualiza estoque
      await client.query(
        `UPDATE estoque SET quantidade_arara = quantidade_arara - $1 WHERE produto_id = $2`,
        [item.quantidade, item.produto_id]
      );

      // Registra item da venda
      await client.query(
        `
        INSERT INTO venda_itens
        (venda_id, produto_id, quantidade, preco_unitario)
        VALUES ($1, $2, $3, $4)
        `,
        [vendaId, item.produto_id, item.quantidade, item.preco]
      );

      // Movimentação de estoque
      await client.query(
        `
        INSERT INTO movimentacoes_estoque
        (produto_id, usuario_id, tipo, local, quantidade, motivo, data)
        VALUES ($1, $2, 'saida', 'arara', $3, $4, NOW())
        `,
        [item.produto_id, req.user.id, item.quantidade, `Venda #${vendaId}`]
      );
    }

    await client.query("COMMIT");

    res.status(201).json({ venda_id: vendaId, mensagem: "Venda realizada com sucesso!" });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("ERRO AO FINALIZAR VENDA:", err);
    res.status(500).json({ erro: err.message });
  } finally {
    client.release();
  }
});

/**
 * 📖 Histórico de vendas do usuário logado
 * GET /vendas
 */
router.get("/", authMiddleware, async (req, res) => {
  if (!req.user || !req.user.id) {
    return res.status(401).json({ erro: "Usuário não autenticado" });
  }

  try {
    const vendasRes = await db.query(
      `
      SELECT v.id, v.data, v.canal, v.valor_total, v.forma_pagamento, v.observacoes,
        json_agg(json_build_object(
          'produto_id', vi.produto_id,
          'quantidade', vi.quantidade,
          'preco_unitario', vi.preco_unitario
        )) AS itens
      FROM vendas v
      LEFT JOIN venda_itens vi ON vi.venda_id = v.id
      WHERE v.vendedora_id = $1
      GROUP BY v.id
      ORDER BY v.data DESC
      `,
      [req.user.id]
    );

    res.json(vendasRes.rows);
  } catch (err) {
    console.error("ERRO AO BUSCAR VENDAS:", err);
    res.status(500).json({ erro: err.message });
  }
});

export default router;