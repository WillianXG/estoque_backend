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
    variacao,
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
      INSERT INTO produtos (nome, preco, subcategoria_id, variacao, imagem_url, criado_por, data_criacao)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      RETURNING id
      `,
      [nome, preco, subcategoria_id, variacao, imagem_url, req.user.id]
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

/**
 * PUT para atualizar produto e estoque
 */
router.put("/:id", authMiddleware, async (req, res) => {
  const { id } = req.params;
  const {
    nome,
    preco,
    subcategoria_id,
    variacao,
    imagem_url,
    qtd_arara,
    qtd_deposito,
  } = req.body;

  const client = await db.connect();

  try {
    await client.query("BEGIN");

    // Atualiza tabela produtos
    await client.query(
      `
      UPDATE produtos
      SET nome=$1, preco=$2, subcategoria_id=$3, variacao=$4, imagem_url=$5
      WHERE id=$6
      `,
      [nome, preco, subcategoria_id, variacao, imagem_url, id]
    );

    // Atualiza estoque se enviado
    if (qtd_arara !== undefined || qtd_deposito !== undefined) {
      const estoqueAtual = await client.query(
        `SELECT * FROM estoque WHERE produto_id=$1`,
        [id]
      );

      if (estoqueAtual.rows.length) {
        await client.query(
          `
          UPDATE estoque
          SET quantidade_arara=$1, quantidade_deposito=$2
          WHERE produto_id=$3
          `,
          [
            qtd_arara ?? estoqueAtual.rows[0].quantidade_arara,
            qtd_deposito ?? estoqueAtual.rows[0].quantidade_deposito,
            id,
          ]
        );
      }
    }

    await client.query("COMMIT");
    res.json({ msg: "Produto atualizado com sucesso" });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ erro: "Erro ao atualizar produto" });
  } finally {
    client.release();
  }
});

/**
 * DELETE para remover produto
 */
router.delete("/:id", authMiddleware, async (req, res) => {
  const { id } = req.params;
  const client = await db.connect();

  try {
    await client.query("BEGIN");

    // Remove movimentações
    await client.query(`DELETE FROM movimentacoes_estoque WHERE produto_id=$1`, [
      id,
    ]);

    // Remove estoque
    await client.query(`DELETE FROM estoque WHERE produto_id=$1`, [id]);

    // Remove produto
    await client.query(`DELETE FROM produtos WHERE id=$1`, [id]);

    await client.query("COMMIT");
    res.json({ msg: "Produto removido com sucesso" });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ erro: "Erro ao remover produto" });
  } finally {
    client.release();
  }
});

export default router;
