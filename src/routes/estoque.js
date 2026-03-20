import { Router } from "express";
import db from "../db.js";
import { authMiddleware } from "./auth.js";

const router = Router();

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
        e.cor,
        e.tamanho,
        e.quantidade_arara, 
        e.quantidade_deposito
      FROM estoque e
      JOIN produtos p ON p.id = e.produto_id
      WHERE p.ativo = true  -- <--- ADICIONE ESTA LINHA
      ORDER BY p.nome ASC, e.cor ASC, e.tamanho ASC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao buscar estoque" });
  }
});

/**
 * POST /estoque/entrada
 * Adiciona quantidade no estoque (Soma na grade específica)
 */
router.post("/entrada", authMiddleware, async (req, res) => {
  const { produto_id, cor, tamanho, quantidade, local } = req.body;

  if (!produto_id || quantidade == null || !local) {
    return res.status(400).json({ erro: "Dados incompletos" });
  }

  const corFinal = cor || "Padrão";
  const tamanhoFinal = tamanho || "Único";

  try {
    await db.query(
      `
      INSERT INTO estoque (produto_id, cor, tamanho, quantidade_${local})
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (produto_id, cor, tamanho)
      DO UPDATE SET quantidade_${local} = estoque.quantidade_${local} + $4
      `,
      [produto_id, corFinal, tamanhoFinal, quantidade]
    );
    res.status(200).json({ message: "Estoque atualizado" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao atualizar estoque" });
  }
});

/**
 * POST /estoque/saida
 * Remove quantidade do estoque (Subtrai na grade específica)
 */
router.post("/saida", authMiddleware, async (req, res) => {
  const { produto_id, cor, tamanho, quantidade, local } = req.body;

  if (!produto_id || quantidade == null || !local) {
    return res.status(400).json({ erro: "Dados incompletos" });
  }

  const corFinal = cor || "Padrão";
  const tamanhoFinal = tamanho || "Único";

  try {
    await db.query(
      `
      UPDATE estoque
      SET quantidade_${local} = quantidade_${local} - $1
      WHERE produto_id = $2 AND cor = $3 AND tamanho = $4
      `,
      [quantidade, produto_id, corFinal, tamanhoFinal]
    );
    res.status(200).json({ message: "Estoque atualizado" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao atualizar estoque" });
  }
});

/**
 * POST /estoque/ajustar
 * Ajusta o estoque para um valor exato (Substitui na grade específica)
 */
router.post("/ajustar", authMiddleware, async (req, res) => {
  const { produto_id, cor, tamanho, quantidade, local } = req.body;

  if (!produto_id || quantidade == null || !local) {
    return res.status(400).json({ erro: "Dados incompletos" });
  }

  const corFinal = cor || "Padrão";
  const tamanhoFinal = tamanho || "Único";
  const quantidadeNum = Number(quantidade);

  try {
    // Garante que o registro exista para a variação
    await db.query(
      `INSERT INTO estoque (produto_id, cor, tamanho, quantidade_arara, quantidade_deposito)
       VALUES ($1, $2, $3, 0, 0)
       ON CONFLICT (produto_id, cor, tamanho) DO NOTHING`,
      [produto_id, corFinal, tamanhoFinal]
    );

    // Substitui pelo valor exato
    await db.query(
      `UPDATE estoque SET quantidade_${local} = $1 
       WHERE produto_id = $2 AND cor = $3 AND tamanho = $4`,
      [quantidadeNum, produto_id, corFinal, tamanhoFinal]
    );

    res.status(200).json({ message: "Estoque ajustado com sucesso" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao ajustar estoque" });
  }
});

export default router;