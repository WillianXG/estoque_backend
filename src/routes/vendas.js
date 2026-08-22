import { Router } from "express";
import db from "../db.js";
import { authMiddleware } from "./auth.js";

const router = Router();

/**
 * 🛒 Finalizar venda (PDV / Loja Física)
 * POST /vendas
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

    const valorTotal = itens.reduce(
      (sum, item) => sum + Number(item.preco) * Number(item.quantidade),
      0
    );

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

    for (const item of itens) {
      const estoqueRes = await client.query(
        `SELECT quantidade_arara, quantidade_deposito FROM estoque WHERE produto_id = $1`,
        [item.produto_id]
      );

      if (estoqueRes.rows.length === 0) {
        throw new Error(`Produto ID ${item.produto_id} sem estoque cadastrado`);
      }

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

      await client.query(
        `
        INSERT INTO venda_itens
        (venda_id, produto_id, quantidade, preco_unitario)
        VALUES ($1, $2, $3, $4)
        `,
        [vendaId, item.produto_id, item.quantidade, item.preco]
      );

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
    res.status(500).json({ erro: err.message });
  } finally {
    client.release();
  }
});

/**
 * 📖 Histórico de vendas do PDV
 * GET /vendas
 */
router.get("/", authMiddleware, async (req, res) => {
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
      GROUP BY v.id
      ORDER BY v.data DESC
      `
    );

    res.json(vendasRes.rows);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

/**
 * 🛍️ Buscar Pedidos On-line
 * GET /pedidos-online
 */
router.get("/pedidos-online", authMiddleware, async (req, res) => {
  try {
    const pedidosRes = await db.query(
      `
      SELECT 
        po.id,
        po.cliente_nome,
        po.cliente_whatsapp,
        po.cliente_cpf,
        po.endereco,
        po.valor_total,
        po.forma_pagamento,
        po.status_pagamento,
        po.status_pedido,
        po.created_at,
        po.observacao,
        COALESCE(json_agg(
          json_build_object(
            'id', poi.id,
            'produto_id', poi.produto_id,
            'cor', poi.cor,
            'tamanho', poi.tamanho,
            'quantidade', poi.quantidade,
            'preco_unitario', p.preco,
            'nome_produto', p.nome
          )
        ) FILTER (WHERE poi.id IS NOT NULL), '[]') AS pedidos_online_itens
      FROM pedidos_online po
      LEFT JOIN pedidos_online_itens poi ON poi.pedido_online_id = po.id
      LEFT JOIN produtos p ON p.id = poi.produto_id
      GROUP BY po.id
      ORDER BY po.id DESC
      `
    );

    res.json(pedidosRes.rows);
  } catch (err) {
    console.error("Erro ao buscar pedidos online:", err);
    res.status(500).json({ erro: err.message });
  }
});

/**
 * 💳 Atualizar Status do Pagamento (Ex: Confirmar PIX)
 * PATCH /pedidos-online/:id/pagamento
 */
router.patch("/pedidos-online/:id/pagamento", authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { status_pagamento } = req.body;

  try {
    await db.query(
      `UPDATE pedidos_online SET status_pagamento = $1 WHERE id = $2`,
      [status_pagamento, id]
    );
    res.json({ mensagem: "Status de pagamento atualizado com sucesso!" });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

/**
 * 📦 Atualizar Status do Pedido (Ex: Embalando / Enviado)
 * PATCH /pedidos-online/:id/status
 */
router.patch("/pedidos-online/:id/status", authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { status_pedido } = req.body;

  try {
    await db.query(
      `UPDATE pedidos_online SET status_pedido = $1 WHERE id = $2`,
      [status_pedido, id]
    );
    res.json({ mensagem: "Status do pedido atualizado com sucesso!" });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

export default router;