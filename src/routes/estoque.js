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
 * POST /movimentacoes-estoque/ajustar
 * Body: { produto_id, tipo, local, quantidade, motivo? }
 * tipo: 'entrada' | 'saida' | 'ajuste'
 * local: 'arara' | 'deposito'
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

    // Garante que o produto existe no estoque
    await client.query(
      `INSERT INTO estoque (produto_id, quantidade_arara, quantidade_deposito)
       VALUES ($1, 0, 0)
       ON CONFLICT (produto_id) DO NOTHING`,
      [produto_id]
    );

    // Atualiza estoque com o valor exato (não soma)
    if (tipo === "ajuste" || tipo === "entrada" || tipo === "saida") {
      const operador = tipo === "saida" ? "-" : ""; // só subtrair para saida
      await client.query(
        `UPDATE estoque SET quantidade_${local} = ${operador}$1 WHERE produto_id = $2`,
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
    res.status(200).json({ message: "Estoque atualizado e movimentação registrada" });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("ERRO AJUSTAR ESTOQUE:", err);
    res.status(500).json({ erro: "Erro ao ajustar estoque" });
  } finally {
    client.release();
  }
});

export default router;