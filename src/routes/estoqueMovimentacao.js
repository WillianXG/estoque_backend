import { Router } from "express";
import db from "../db.js";
import { authMiddleware } from "./auth.js";

const router = Router();

/**
 * POST /movimentacoes-estoque/ajustar
 * Body: { produto_id, tipo, local, quantidade, motivo? }
 * tipo: 'entrada' | 'saida' | 'ajuste'
 * local: 'arara' | 'deposito'
 */
router.post("/ajustar", authMiddleware, async (req, res) => {
  const { produto_id, tipo, local, quantidade, motivo } = req.body;

  // Validação básica
  if (!produto_id || !tipo || !local || quantidade == null) {
    return res.status(400).json({ erro: "Dados incompletos" });
  }

  if (!["arara", "deposito"].includes(local)) {
    return res.status(400).json({ erro: `Local inválido: ${local}` });
  }

  const quantidadeNum = Number(quantidade);
  if (isNaN(quantidadeNum)) {
    return res.status(400).json({ erro: "Quantidade inválida" });
  }

  const usuarioId = req.user?.id;
  if (!usuarioId) {
    return res.status(401).json({ erro: "Usuário não autenticado" });
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    // Garantir que o estoque exista
    await client.query(
      `INSERT INTO estoque (produto_id, quantidade_arara, quantidade_deposito)
       VALUES ($1, 0, 0)
       ON CONFLICT (produto_id) DO NOTHING`,
      [produto_id]
    );

    // Atualiza estoque
    if (tipo === "entrada" || tipo === "ajuste") {
      await client.query(
        `UPDATE estoque SET quantidade_${local} = quantidade_${local} + $1 WHERE produto_id = $2`,
        [quantidadeNum, produto_id]
      );
    } else if (tipo === "saida") {
      await client.query(
        `UPDATE estoque SET quantidade_${local} = quantidade_${local} - $1 WHERE produto_id = $2`,
        [quantidadeNum, produto_id]
      );
    } else {
      throw new Error(`Tipo inválido: ${tipo}`);
    }

    // Registra movimentação
    await client.query(
      `INSERT INTO movimentacoes_estoque
        (produto_id, usuario_id, tipo, local, quantidade, motivo)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [produto_id, usuarioId, tipo, local, quantidadeNum, motivo || ""]
    );

    await client.query("COMMIT");
    res.status(200).json({ message: "Movimentação registrada" });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("ERRO AJUSTAR ESTOQUE:", err);
    res.status(500).json({ erro: "Erro ao ajustar estoque" });
  } finally {
    client.release();
  }
});

/**
 * GET /movimentacoes-estoque
 * Retorna todas as movimentações de estoque
 * Inclui o nome do produto, nome da vendedora e quantidade anterior/nova
 */
router.get("/", authMiddleware, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT
         m.id,
         m.produto_id,
         p.nome AS produto_nome,
         m.usuario_id,
         v.nome AS usuario_nome,
         m.tipo,
         m.local,
         m.quantidade,
         m.motivo,
         m.data,
         -- quantidade anterior usando LAG
         COALESCE(LAG(
           CASE
             WHEN m.tipo = 'entrada' OR m.tipo = 'ajuste' THEN m.quantidade * -1
             WHEN m.tipo = 'saida' THEN m.quantidade
           END
         ) OVER (
           PARTITION BY m.produto_id, m.local
           ORDER BY m.data, m.id
         ), 0) + 
         -- para somar a movimentação atual
         (CASE 
            WHEN m.tipo = 'entrada' OR m.tipo = 'ajuste' THEN m.quantidade
            WHEN m.tipo = 'saida' THEN -m.quantidade
          END) AS quantidade_nova
      FROM movimentacoes_estoque m
      LEFT JOIN produtos p ON p.id = m.produto_id
      LEFT JOIN vendedoras v ON v.id = m.usuario_id
      ORDER BY m.data DESC, m.id DESC`
    );

    // Para frontend, podemos calcular quantidade_anterior = quantidade_nova - quantidade atual
    const movimentacoes = result.rows.map((m) => ({
      ...m,
      quantidade_nova: Number(m.quantidade_nova),
      quantidade_anterior: Number(m.quantidade_nova) - Number(m.quantidade),
    }));

    res.status(200).json(movimentacoes);
  } catch (err) {
    console.error("ERRO GET MOVIMENTACOES:", err);
    res.status(500).json({ erro: "Erro ao buscar movimentações" });
  }
});


export default router;