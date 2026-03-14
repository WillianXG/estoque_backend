import { Router } from "express";
import db from "../db.js";
import { authMiddleware } from "./auth.js";

const router = Router();

/**
 * POST /movimentacoes-estoque/ajustar
 * Body: { produto_id, tipo, local, quantidade, motivo? }
 */

router.post("/ajustar", authMiddleware, async (req, res) => {
  const { produto_id, tipo, local, quantidade, motivo } = req.body;

  if (!produto_id || !tipo || !local || quantidade == null) {
    return res.status(400).json({ erro: "Dados incompletos" });
  }

  if (!["arara", "deposito"].includes(local)) {
    return res.status(400).json({ erro: `Local inválido: ${local}` });
  }

  const quantidadeNum = Number(quantidade);
  if (isNaN(quantidadeNum) || quantidadeNum <= 0) {
    return res.status(400).json({ erro: "Quantidade inválida" });
  }

  const usuarioId = req.user?.id;
  if (!usuarioId) {
    return res.status(401).json({ erro: "Usuário não autenticado" });
  }

  const client = await db.connect();

  try {
    await client.query("BEGIN");

    // Garante que o estoque exista
    await client.query(
      `INSERT INTO estoque (produto_id, quantidade_arara, quantidade_deposito)
       VALUES ($1,0,0)
       ON CONFLICT (produto_id) DO NOTHING`,
      [produto_id]
    );

    // Busca estoque atual
    const estoqueRes = await client.query(
      `SELECT quantidade_${local} FROM estoque WHERE produto_id = $1`,
      [produto_id]
    );

    const quantidadeAnterior = Number(
      estoqueRes.rows[0][`quantidade_${local}`]
    );

    let quantidadeNova;

    if (tipo === "saida") {
      if (quantidadeAnterior < quantidadeNum) {
        throw new Error("Estoque insuficiente");
      }

      quantidadeNova = quantidadeAnterior - quantidadeNum;

      await client.query(
        `UPDATE estoque
         SET quantidade_${local} = quantidade_${local} - $1
         WHERE produto_id = $2`,
        [quantidadeNum, produto_id]
      );
    } else if (tipo === "entrada" || tipo === "ajuste") {
      quantidadeNova = quantidadeAnterior + quantidadeNum;

      await client.query(
        `UPDATE estoque
         SET quantidade_${local} = quantidade_${local} + $1
         WHERE produto_id = $2`,
        [quantidadeNum, produto_id]
      );
    } else {
      throw new Error(`Tipo inválido: ${tipo}`);
    }

    // Registra movimentação
    await client.query(
      `INSERT INTO movimentacoes_estoque
      (produto_id, usuario_id, tipo, local, quantidade, motivo, quantidade_anterior, quantidade_nova, data)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())`,
      [
        produto_id,
        usuarioId,
        tipo,
        local,
        quantidadeNum,
        motivo || "",
        quantidadeAnterior,
        quantidadeNova
      ]
    );

    await client.query("COMMIT");

    res.status(200).json({
      message: "Movimentação registrada",
      quantidade_anterior: quantidadeAnterior,
      quantidade_nova: quantidadeNova
    });

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("ERRO AJUSTAR ESTOQUE:", err);
    res.status(500).json({ erro: err.message });
  } finally {
    client.release();
  }
});


/**
 * GET /movimentacoes-estoque
 * Histórico de movimentações
 */

router.get("/", authMiddleware, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        m.id,
        m.produto_id,
        p.nome AS produto_nome,
        m.usuario_id,
        v.nome AS usuario_nome,
        m.tipo,
        m.local,
        m.quantidade,
        m.quantidade_anterior,
        m.quantidade_nova,
        m.motivo,
        m.data
      FROM movimentacoes_estoque m
      JOIN produtos p ON p.id = m.produto_id
      LEFT JOIN vendedoras v ON v.id = m.usuario_id
      ORDER BY m.data DESC
    `);

    res.status(200).json(result.rows);

  } catch (err) {
    console.error("ERRO GET MOVIMENTACOES:", err);
    res.status(500).json({ erro: "Erro ao buscar movimentações" });
  }
});

export default router;