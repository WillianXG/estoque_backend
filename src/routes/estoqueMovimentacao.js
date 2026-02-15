import { Router } from "express";
import db from "../db.js";
import { authMiddleware } from "./auth.js";

const router = Router();

// POST /movimentacoes-estoque/ajustar
router.post("/ajustar", authMiddleware, async (req, res) => {
  const { produto_id, tipo, local, quantidade, motivo } = req.body;

  if (!produto_id || !tipo || !local || quantidade == null)
    return res.status(400).json({ erro: "Dados incompletos" });

  const quantidadeNum = Number(quantidade);
  if (isNaN(quantidadeNum)) return res.status(400).json({ erro: "Quantidade inválida" });

  const client = await db.connect();

  try {
    await client.query("BEGIN");

    // Garantir que o estoque exista
    await client.query(
      `INSERT INTO estoque (produto_id, quantidade_${local}) VALUES ($1, 0) ON CONFLICT (produto_id) DO NOTHING`,
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
    }

    // Registra movimentação
    await client.query(
      `INSERT INTO movimentacao_estoque (produto_id, usuario_id, tipo, local, quantidade, motivo)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [produto_id, req.user.id, tipo, local, quantidadeNum, motivo || ""]
    );

    await client.query("COMMIT");
    res.status(200).json({ message: "Movimentação registrada" });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ erro: "Erro ao ajustar estoque" });
  } finally {
    client.release();
  }
});

export default router;