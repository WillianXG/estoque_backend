import { Router } from "express";
import db from "../db.js";
import { authMiddleware } from "./auth.js";

const router = Router();

/**
 * GET /estoque
 * Retorna todos os estoques detalhados por grade (Cor e Tamanho)
 * Faz o JOIN com produtos para exibir o nome corretamente no Front-end
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
        e.quantidade_arara, 
        e.quantidade_deposito
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
 * Ajusta o estoque para um valor exato. 
 * Graças ao SQL que você rodou, ele agora cria ou atualiza sem erros.
 */
router.post("/ajustar", authMiddleware, async (req, res) => {
  const { produto_id, cor, tamanho, quantidade, local } = req.body;

  // Validação básica
  if (!produto_id || quantidade === undefined || !local) {
    return res.status(400).json({ erro: "Dados incompletos" });
  }

  // Proteção contra nomes de colunas inválidos (segurança)
  if (local !== 'arara' && local !== 'deposito') {
    return res.status(400).json({ erro: "Local inválido. Use 'arara' ou 'deposito'." });
  }

  const corFinal = cor || "Padrão";
  const tamanhoFinal = tamanho || "Único";
  const quantidadeNum = Number(quantidade);

  try {
    // UPSERT: Se não existir o registro (produto+cor+tamanho), ele cria. Se existir, ele atualiza o local.
    await db.query(
      `
      INSERT INTO estoque (produto_id, cor, tamanho, quantidade_${local})
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (produto_id, cor, tamanho) 
      DO UPDATE SET quantidade_${local} = EXCLUDED.quantidade_${local}
      `,
      [produto_id, corFinal, tamanhoFinal, quantidadeNum]
    );

    res.status(200).json({ message: "Estoque ajustado com sucesso" });
  } catch (err) {
    console.error("Erro ao ajustar estoque:", err.message);
    res.status(500).json({ erro: "Erro ao processar ajuste de estoque" });
  }
});

/**
 * POST /estoque/entrada
 * Soma uma quantidade específica ao saldo atual
 */
router.post("/entrada", authMiddleware, async (req, res) => {
  const { produto_id, cor, tamanho, quantidade, local } = req.body;

  if (!produto_id || !quantidade || !local) return res.status(400).json({ erro: "Dados incompletos" });
  if (local !== 'arara' && local !== 'deposito') return res.status(400).json({ erro: "Local inválido" });

  try {
    await db.query(
      `
      INSERT INTO estoque (produto_id, cor, tamanho, quantidade_${local})
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (produto_id, cor, tamanho)
      DO UPDATE SET quantidade_${local} = estoque.quantidade_${local} + $4
      `,
      [produto_id, cor || "Padrão", tamanho || "Único", Number(quantidade)]
    );
    res.status(200).json({ message: "Entrada registrada" });
  } catch (err) {
    res.status(500).json({ erro: "Erro na entrada" });
  }
});

/**
 * POST /estoque/saida
 * Subtrai uma quantidade específica do saldo atual
 */
router.post("/saida", authMiddleware, async (req, res) => {
  const { produto_id, cor, tamanho, quantidade, local } = req.body;

  if (!produto_id || !quantidade || !local) return res.status(400).json({ erro: "Dados incompletos" });

  try {
    const result = await db.query(
      `
      UPDATE estoque
      SET quantidade_${local} = quantidade_${local} - $1
      WHERE produto_id = $2 AND cor = $3 AND tamanho = $4
      RETURNING id
      `,
      [Number(quantidade), produto_id, cor || "Padrão", tamanho || "Único"]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ erro: "Item não encontrado no estoque para saída" });
    }

    res.status(200).json({ message: "Saída registrada" });
  } catch (err) {
    res.status(500).json({ erro: "Erro na saída" });
  }
});

export default router;