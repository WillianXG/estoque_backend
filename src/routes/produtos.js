import { Router } from "express";
import db from "../db.js";
import { authMiddleware } from "./auth.js";

const router = Router();

/**
 * 🆕 Criar produto com estoque inicial e registrar movimentação
 */
router.post("/", authMiddleware, async (req, res) => {
  const {
    nome,
    preco,
    subcategoria_id,
    imagem_url,
    qtd_arara = 0,
    qtd_deposito = 0,
  } = req.body;

  const client = await db.connect();

  try {
    await client.query("BEGIN");

    // 1️⃣ Inserir no produtos
    const produtoResult = await client.query(
      `
      INSERT INTO produtos (nome, preco, subcategoria_id, imagem_url, criado_por, data_criacao)
      VALUES ($1, $2, $3, $4, $5, NOW())
      RETURNING id
      `,
      [nome, preco, subcategoria_id, imagem_url, req.user.id]
    );

    const produtoId = produtoResult.rows[0].id;

    // 2️⃣ Inserir no estoque
    await client.query(
      `
      INSERT INTO estoque (produto_id, quantidade_arara, quantidade_deposito)
      VALUES ($1, $2, $3)
      `,
      [produtoId, qtd_arara, qtd_deposito]
    );

    // 3️⃣ Movimentação estoque - arara
    if (qtd_arara > 0) {
      await client.query(
        `
        INSERT INTO movimentacoes_estoque
        (produto_id, usuario_id, tipo, local, quantidade, motivo)
        VALUES ($1, $2, 'entrada', 'arara', $3, 'Estoque inicial')
        `,
        [produtoId, req.user.id, qtd_arara]
      );
    }

    // 4️⃣ Movimentação estoque - deposito
    if (qtd_deposito > 0) {
      await client.query(
        `
        INSERT INTO movimentacoes_estoque
        (produto_id, usuario_id, tipo, local, quantidade, motivo)
        VALUES ($1, $2, 'entrada', 'deposito', $3, 'Estoque inicial')
        `,
        [produtoId, req.user.id, qtd_deposito]
      );
    }

    await client.query("COMMIT");

    res.status(201).json({ id: produtoId });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ erro: "Erro ao criar produto" });
  } finally {
    client.release();
  }
});

/**
 * GET para listar produtos com estoque atual
 */
router.get("/", authMiddleware, async (req, res) => {
  const result = await db.query(
    `
    SELECT p.*, e.quantidade_arara, e.quantidade_deposito
    FROM produtos p
    LEFT JOIN estoque e ON e.produto_id = p.id
    ORDER BY p.nome
    `
  );
  res.json(result.rows);
});

export default router;