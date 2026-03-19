import { Router } from "express";
import db from "../db.js"; // Verifique se o caminho para o seu arquivo de banco está correto
import { authMiddleware } from "./auth.js"; // Verifique se o caminho para o seu middleware está correto

const router = Router();

router.post("/ajustar", authMiddleware, async (req, res) => {
  const { produto_id, cor, tamanho, tipo, local, quantidade, motivo } = req.body;

  // Validação básica (agora incluindo cor e tamanho)
  if (!produto_id || !tipo || !local || quantidade == null) {
    return res.status(400).json({ erro: "Dados incompletos" });
  }

  // Define valores padrão caso o front-end não envie (para retrocompatibilidade)
  const corFinal = cor || "Padrão";
  const tamanhoFinal = tamanho || "Único";
  const quantidadeNum = Number(quantidade);
  const usuarioId = req.user?.id;

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    // 1. Garante que o registro de estoque exista para essa combinação específica (UPSERT)
    // Importante: a CONSTRAINT unique_produto_cor_tamanho que criamos no Passo 1 faz isso funcionar
    await client.query(
      `INSERT INTO estoque (produto_id, cor, tamanho, quantidade_arara, quantidade_deposito)
       VALUES ($1, $2, $3, 0, 0) 
       ON CONFLICT (produto_id, cor, tamanho) DO NOTHING`,
      [produto_id, corFinal, tamanhoFinal]
    );

    // 2. Busca o saldo atual da variação específica com trava de linha (FOR UPDATE)
    const estoqueRes = await client.query(
      `SELECT quantidade_${local} FROM estoque 
       WHERE produto_id = $1 AND cor = $2 AND tamanho = $3 
       FOR UPDATE`,
      [produto_id, corFinal, tamanhoFinal]
    );

    const quantidadeAnterior = Number(estoqueRes.rows[0][`quantidade_${local}`]);
    let quantidadeNova;

    // 3. Calcula e Atualiza o estoque
    if (tipo === "saida") {
      quantidadeNova = quantidadeAnterior - quantidadeNum;
    } else {
      quantidadeNova = quantidadeAnterior + quantidadeNum;
    }

    await client.query(
      `UPDATE estoque 
       SET quantidade_${local} = $1 
       WHERE produto_id = $2 AND cor = $3 AND tamanho = $4`,
      [quantidadeNova, produto_id, corFinal, tamanhoFinal]
    );

    // 4. Registra a movimentação no histórico incluindo COR e TAMANHO
    await client.query(
      `INSERT INTO movimentacoes_estoque 
       (produto_id, cor, tamanho, usuario_id, tipo, local, quantidade, motivo, quantidade_anterior, quantidade_nova, data)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
      [
        produto_id, 
        corFinal, 
        tamanhoFinal, 
        usuarioId, 
        tipo, 
        local, 
        quantidadeNum, 
        motivo || "Ajuste manual", 
        quantidadeAnterior, 
        quantidadeNova
      ]
    );

    await client.query("COMMIT");
    res.json({ 
      message: "Sucesso", 
      nova_quantidade: quantidadeNova,
      variacao: { cor: corFinal, tamanho: tamanhoFinal }
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("ERRO NO AJUSTE DE ESTOQUE:", err.message);
    res.status(500).json({ erro: err.message });
  } finally {
    client.release();
  }
});

export default router;