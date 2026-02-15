import { Router } from "express";
import db from "../db.js";
import { authMiddleware } from "./auth.js";

const router = Router();

/**
 * GET /estoque
 * Retorna todos os estoques
 */
router.get("/", authMiddleware, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT e.id, e.produto_id, e.quantidade_arara, e.quantidade_deposito
      FROM estoque e
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao buscar estoque" });
  }
});

/**
 * Entrada de estoque (somar)
 * Body: { produto_id, quantidade, local: 'arara' | 'deposito' }
 */
router.post("/entrada", authMiddleware, async (req, res) => {
  const { produto_id, quantidade, local } = req.body;

  if (!produto_id || quantidade == null || !local) {
    return res.status(400).json({ erro: "Dados incompletos" });
  }

  try {
    await db.query(
      `
      INSERT INTO estoque (produto_id, quantidade_${local})
      VALUES ($1, $2)
      ON CONFLICT (produto_id)
      DO UPDATE SET quantidade_${local} = estoque.quantidade_${local} + $2
      `,
      [produto_id, quantidade]
    );
    res.status(200).json({ message: "Estoque atualizado" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao atualizar estoque" });
  }
});

/**
 * Saída de estoque (subtrair)
 * Body: { produto_id, quantidade, local: 'arara' | 'deposito' }
 */
router.post("/saida", authMiddleware, async (req, res) => {
  const { produto_id, quantidade, local } = req.body;

  if (!produto_id || quantidade == null || !local) {
    return res.status(400).json({ erro: "Dados incompletos" });
  }

  try {
    await db.query(
      `
      UPDATE estoque
      SET quantidade_${local} = quantidade_${local} - $1
      WHERE produto_id = $2
      `,
      [quantidade, produto_id]
    );
    res.status(200).json({ message: "Estoque atualizado" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao atualizar estoque" });
  }
});

export default router;