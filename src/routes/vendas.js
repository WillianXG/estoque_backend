import { Router } from "express";
import db from "../db.js";
import { authMiddleware } from "./auth.js";

const router = Router();

/**
 * 🛒 Finalizar venda
 * POST /vendas
 * Body: { itens: [{produto_id, quantidade, preco}], forma_pagamento, observacoes, canal, local_venda }
 */
router.post("/", authMiddleware, async (req, res) => {
  const { itens, forma_pagamento, observacoes, canal, local_venda } = req.body;

  if (!req.user || !req.user.id) {
    return res.status(401).json({ erro: "Usuário não autenticado" });
  }

  if (!itens || itens.length === 0) {
    return res.status(400).json({ erro: "Nenhum item na venda" });
  }

  const client = await db.connect();

  try {
    await client.query("BEGIN");

    // Calcula valor total
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
        `SELECT quantidade_arara, quantidade_deposito FROM estoque WHERE produto_id = $1`,
        [item.produto_id]
      );

      if (estoqueRes.rows.length === 0) {
        throw new Error(`Produto ID ${item.produto_id} sem estoque cadastrado`);
      }

      // Determina de onde retirar estoque
      let local = "arara";
      if (local_venda === "deposito") {
        if (estoqueRes.rows[0].quantidade_deposito < item.quantidade) {
          throw new Error(`Estoque insuficiente no depósito para produto ID ${item.produto_id}`);
        }
        await client.query(
          `UPDATE estoque SET quantidade_deposito = quantidade_deposito - $1 WHERE produto_id = $2`,
          [item.quantidade, item.produto_id]
        );
        local = "deposito";
      } else {
        if (estoqueRes.rows[0].quantidade_arara < item.quantidade) {
          throw new Error(`Estoque insuficiente na arara para produto ID ${item.produto_id}`);
        }
        await client.query(
          `UPDATE estoque SET quantidade_arara = quantidade_arara - $1 WHERE produto_id = $2`,
          [item.quantidade, item.produto_id]
        );
      }

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
        VALUES ($1, $2, 'saida', $3, $4, $5, NOW())
        `,
        [item.produto_id, req.user.id, local, item.quantidade, `Venda #${vendaId}`]
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
 * 📖 Histórico de todas as vendas do usuário logado
 * GET /vendas
 */
router.get("/", authMiddleware, async (req, res) => {
  console.log("USUÁRIO LOGADO:", req.user.id);
  if (!req.user || !req.user.id) {
    return res.status(401).json({ erro: "Usuário não autenticado" });
  }

  try {
    const vendasRes = await db.query(
      `
      SELECT
        v.id,
        v.data,
        v.canal,
        v.valor_total,
        v.forma_pagamento,
        v.observacoes,
        COALESCE(json_agg(
          json_build_object(
            'produto_id', vi.produto_id,
            'produto_nome', p.nome,
            'quantidade', vi.quantidade,
            'preco_unitario', vi.preco_unitario
          )
        ) FILTER (WHERE vi.id IS NOT NULL), '[]') AS itens
      FROM vendas v
      LEFT JOIN venda_itens vi ON vi.venda_id = v.id
      LEFT JOIN produtos p ON p.id = vi.produto_id
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