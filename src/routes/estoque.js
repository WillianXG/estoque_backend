import { Router } from "express";
import db from "../db.js";
import { authMiddleware } from "./auth.js";

const router = Router();

// Função auxiliar para extrair ID do usuário logado
function getUsuarioId(req) {
  const id = req.user?.id || req.user?.usuario_id || req.user?.userId;
  return id && !isNaN(parseInt(id)) ? parseInt(id) : 1;
}

/**
 * GET /estoque
 * Retorna todos os estoques detalhados por grade (Cor e Tamanho)
 */
router.get("/", authMiddleware, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        e.id, 
        e.produto_id, 
        p.nome AS produto_nome,
        COALESCE(e.cor, 'Padrão') AS cor,
        COALESCE(e.tamanho, 'Único') AS tamanho,
        COALESCE(e.quantidade_arara, 0) AS quantidade_arara, 
        COALESCE(e.quantidade_deposito, 0) AS quantidade_deposito
      FROM estoque e
      JOIN produtos p ON p.id = e.produto_id
      WHERE p.ativo = true
      ORDER BY p.nome ASC, e.cor ASC, e.tamanho ASC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error("Erro ao buscar estoque:", err.message);
    res.status(500).json({ erro: "Erro ao buscar estoque" });
  }
});

/**
 * POST /estoque/ajustar
 */
router.post("/ajustar", authMiddleware, async (req, res) => {
  const { produto_id, cor, tamanho, quantidade, local } = req.body;

  if (!produto_id || quantidade === undefined || !local) {
    return res.status(400).json({ erro: "Dados incompletos" });
  }

  if (local !== 'arara' && local !== 'deposito') {
    return res.status(400).json({ erro: "Local inválido. Use 'arara' ou 'deposito'." });
  }

  const corFinal = cor || "Padrão";
  const tamanhoFinal = tamanho || "Único";
  const quantidadeNum = Number(quantidade);
  const usuarioId = getUsuarioId(req);

  const client = await db.connect();

  try {
    await client.query("BEGIN");

    const qtdArara = local === 'arara' ? quantidadeNum : 0;
    const qtdDeposito = local === 'deposito' ? quantidadeNum : 0;

    // INSERT com COALESCE para impedir inserção de NULL nas colunas obrigatórias
    if (local === 'arara') {
      await client.query(
        `
        INSERT INTO estoque (produto_id, cor, tamanho, quantidade_arara, quantidade_deposito)
        VALUES ($1, $2, $3, $4, 0)
        ON CONFLICT (produto_id, cor, tamanho) 
        DO UPDATE SET quantidade_arara = EXCLUDED.quantidade_arara
        `,
        [produto_id, corFinal, tamanhoFinal, quantidadeNum]
      );
    } else {
      await client.query(
        `
        INSERT INTO estoque (produto_id, cor, tamanho, quantidade_arara, quantidade_deposito)
        VALUES ($1, $2, $3, 0, $4)
        ON CONFLICT (produto_id, cor, tamanho) 
        DO UPDATE SET quantidade_deposito = EXCLUDED.quantidade_deposito
        `,
        [produto_id, corFinal, tamanhoFinal, quantidadeNum]
      );
    }

    // Registrar no histórico de movimentações
    await client.query(
      `INSERT INTO movimentacoes_estoque 
       (produto_id, usuario_id, tipo, local, quantidade, motivo, data, quantidade_anterior, quantidade_nova, cor, tamanho)
       VALUES ($1, $2, 'ajuste', $3, $4, 'Ajuste Manual', NOW(), 0, $4, $5, $6)`,
      [produto_id, usuarioId, local, quantidadeNum, corFinal, tamanhoFinal]
    );

    await client.query("COMMIT");
    res.status(200).json({ message: "Estoque ajustado com sucesso" });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Erro ao ajustar estoque:", err.message);
    res.status(500).json({ erro: "Erro ao processar ajuste de estoque", detalhes: err.message });
  } finally {
    client.release();
  }
});

/**
 * POST /estoque/entrada
 */
router.post("/entrada", authMiddleware, async (req, res) => {
  const { produto_id, cor, tamanho, quantidade, local } = req.body;

  if (!produto_id || !quantidade || !local) return res.status(400).json({ erro: "Dados incompletos" });
  if (local !== 'arara' && local !== 'deposito') return res.status(400).json({ erro: "Local inválido" });

  const corFinal = cor || "Padrão";
  const tamanhoFinal = tamanho || "Único";
  const qtdNum = Number(quantidade);
  const usuarioId = getUsuarioId(req);

  const client = await db.connect();

  try {
    await client.query("BEGIN");

    if (local === 'arara') {
      await client.query(
        `
        INSERT INTO estoque (produto_id, cor, tamanho, quantidade_arara, quantidade_deposito)
        VALUES ($1, $2, $3, $4, 0)
        ON CONFLICT (produto_id, cor, tamanho)
        DO UPDATE SET quantidade_arara = COALESCE(estoque.quantidade_arara, 0) + $4
        `,
        [produto_id, corFinal, tamanhoFinal, qtdNum]
      );
    } else {
      await client.query(
        `
        INSERT INTO estoque (produto_id, cor, tamanho, quantidade_arara, quantidade_deposito)
        VALUES ($1, $2, $3, 0, $4)
        ON CONFLICT (produto_id, cor, tamanho)
        DO UPDATE SET quantidade_deposito = COALESCE(estoque.quantidade_deposito, 0) + $4
        `,
        [produto_id, corFinal, tamanhoFinal, qtdNum]
      );
    }

    // Registrar movimentação
    await client.query(
      `INSERT INTO movimentacoes_estoque 
       (produto_id, usuario_id, tipo, local, quantidade, motivo, data, quantidade_anterior, quantidade_nova, cor, tamanho)
       VALUES ($1, $2, 'entrada', $3, $4, 'Entrada de Estoque', NOW(), 0, $4, $5, $6)`,
      [produto_id, usuarioId, local, qtdNum, corFinal, tamanhoFinal]
    );

    await client.query("COMMIT");
    res.status(200).json({ message: "Entrada registrada com sucesso" });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Erro na entrada:", err.message);
    res.status(500).json({ erro: "Erro na entrada", detalhes: err.message });
  } finally {
    client.release();
  }
});

/**
 * POST /estoque/saida
 */
router.post("/saida", authMiddleware, async (req, res) => {
  const { produto_id, cor, tamanho, quantidade, local } = req.body;

  if (!produto_id || !quantidade || !local) return res.status(400).json({ erro: "Dados incompletos" });
  if (local !== 'arara' && local !== 'deposito') return res.status(400).json({ erro: "Local inválido" });

  const corFinal = cor || "Padrão";
  const tamanhoFinal = tamanho || "Único";
  const qtdNum = Number(quantidade);
  const usuarioId = getUsuarioId(req);

  const client = await db.connect();

  try {
    await client.query("BEGIN");

    const campo = local === 'arara' ? 'quantidade_arara' : 'quantidade_deposito';

    const result = await client.query(
      `
      UPDATE estoque
      SET ${campo} = GREATEST(0, COALESCE(${campo}, 0) - $1)
      WHERE produto_id = $2 AND cor = $3 AND tamanho = $4
      RETURNING id
      `,
      [qtdNum, produto_id, corFinal, tamanhoFinal]
    );

    if (result.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ erro: "Item não encontrado no estoque para saída" });
    }

    // Registrar movimentação de saída
    await client.query(
      `INSERT INTO movimentacoes_estoque 
       (produto_id, usuario_id, tipo, local, quantidade, motivo, data, quantidade_anterior, quantidade_nova, cor, tamanho)
       VALUES ($1, $2, 'saida', $3, $4, 'Saída de Estoque', NOW(), 0, $4, $5, $6)`,
      [produto_id, usuarioId, local, qtdNum, corFinal, tamanhoFinal]
    );

    await client.query("COMMIT");
    res.status(200).json({ message: "Saída registrada com sucesso" });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Erro na saída:", err.message);
    res.status(500).json({ erro: "Erro na saída", detalhes: err.message });
  } finally {
    client.release();
  }
});

export default router;