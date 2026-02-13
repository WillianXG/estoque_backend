import { Router } from "express";
import db from "../db.js";
import { authMiddleware } from "./auth.js";

const router = Router();

/**
 * Ajustar estoque com histórico
 * Body:
 * {
 *   produto_id,
 *   tipo,             // 'entrada' ou 'saida' ou 'ajuste'
 *   local,            // 'arara' ou 'deposito'
 *   quantidade,
 *   motivo
 * }
 */
router.post("/ajustar", authMiddleware, async (req, res) => {
  const { produto_id, tipo, local, quantidade, motivo } = req.body;

  if (!produto_id || !tipo || !local) {
    return res.status(400).json({ erro: "Dados incompletos" });
  }

  const client = await db.connect();

  try {
    await client.query("BEGIN");

    // Atualiza estoque somando ou subtraindo
    if (tipo === "entrada") {
      await client.query(
        `
        UPDATE estoque
        SET quantidade_${local} = quantidade_${local} + $1
        WHERE produto_id = $2
        `,
        [quantidade, produto_id]
      );
    } else {
      await client.query(
        `
        UPDATE estoque
        SET quantidade_${local} = quantidade_${local} - $1
        WHERE produto_id = $2
        `,
        [quantidade, produto_id]
      );
    }

    // Registra no histórico
    await client.query(
      `
      INSERT INTO movimentacoes_estoque
      (produto_id, usuario_id, tipo, local, quantidade, motivo)
      VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [produto_id, req.user.id, tipo, local, quantidade, motivo]
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