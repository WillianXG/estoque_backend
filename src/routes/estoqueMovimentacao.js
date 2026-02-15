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

router.get("/", authMiddleware, async (req, res) => {
  try {
    // 1️⃣ Buscar todas as movimentações
    const movResult = await db.query(`
      SELECT
        m.id,
        m.produto_id,
        p.nome AS produto_nome,
        m.usuario_id,
        v.nome AS usuario_nome,
        m.tipo,
        m.local,
        m.quantidade AS quantidade_mov,
        m.motivo,
        m.data
      FROM movimentacoes_estoque m
      LEFT JOIN produtos p ON p.id = m.produto_id
      LEFT JOIN vendedoras v ON v.id = m.usuario_id
      ORDER BY m.data ASC, m.id ASC
    `);

    const movs = movResult.rows;

    // 2️⃣ Buscar estoque atual
    const estoqueResult = await db.query(`SELECT produto_id, quantidade_arara, quantidade_deposito FROM estoque`);
    const estoqueMap = {};
    estoqueResult.rows.forEach((e) => {
      estoqueMap[e.produto_id] = {
        arara: e.quantidade_arara,
        deposito: e.quantidade_deposito,
      };
    });

    // 3️⃣ Inicializar acumulado com estoque inicial antes das movimentações
    const acumulado = {};
    movs.forEach((m) => {
      if (!acumulado[m.produto_id]) {
        // estoque atual é usado como ponto inicial
        acumulado[m.produto_id] = {
          arara: 0,
          deposito: 0,
        };
      }
    });

    // 4️⃣ Calcular quantidade anterior/nova para cada movimentação
    const movimentacoes = movs.map((m) => {
      if (!acumulado[m.produto_id]) {
        acumulado[m.produto_id] = { arara: 0, deposito: 0 };
      }

      const quantidade_anterior = acumulado[m.produto_id][m.local];

      let quantidade_nova;
      if (m.tipo === "entrada" || m.tipo === "ajuste") {
        quantidade_nova = quantidade_anterior + m.quantidade;
      } else if (m.tipo === "saida") {
        quantidade_nova = quantidade_anterior - m.quantidade;
      } else {
        quantidade_nova = quantidade_anterior;
      }

      acumulado[m.produto_id][m.local] = quantidade_nova;

      return {
        id: m.id,
        produto_id: m.produto_id,
        produto_nome: m.produto_nome,
        usuario_id: m.usuario_id,
        usuario_nome: m.usuario_nome,
        tipo: m.tipo,
        local: m.local,
        quantidade: m.quantidade_mov,
        quantidade_anterior,
        quantidade_nova,
        motivo: m.motivo,
        data: m.data,
      };
    });

    res.status(200).json(movimentacoes.reverse());
  } catch (err) {
    console.error("ERRO GET MOVIMENTACOES:", err);
    res.status(500).json({ erro: "Erro ao buscar movimentações" });
  }
});


export default router;