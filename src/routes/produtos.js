import { Router } from "express";
import multer from "multer";
import path from "path";
import db from "../db.js";
import { authMiddleware } from "./auth.js";

const router = Router();

/* =========================
   CONFIG MULTER
========================= */

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + "-" + file.originalname;
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

/* =========================
   CRIAR PRODUTO
========================= */

router.post(
  "/",
  authMiddleware,
  upload.single("imagem"),
  async (req, res) => {
    const {
      nome,
      preco_venda,
      preco_compra,
      subcategoria_id,
      variacao,
      qtd_arara = 0,
      qtd_deposito = 0,
    } = req.body;

    const imagem_url = req.file
      ? `${req.protocol}://${req.get("host")}/uploads/${req.file.filename}`
      : null;

    const client = await db.connect();

    try {
      await client.query("BEGIN");

      const produtoResult = await client.query(
        `
        INSERT INTO produtos 
        (nome, preco_venda, preco_compra, subcategoria_id, variacao, imagem_url, criado_por, data_criacao)
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
        RETURNING id
        `,
        [
          nome,
          preco_venda,
          preco_compra,
          subcategoria_id,
          variacao,
          imagem_url,
          req.user.id,
        ]
      );

      const produtoId = produtoResult.rows[0].id;

      // Inserir estoque
      await client.query(
        `
        INSERT INTO estoque (produto_id, quantidade_arara, quantidade_deposito)
        VALUES ($1, $2, $3)
        `,
        [produtoId, qtd_arara, qtd_deposito]
      );

      // Movimentações
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
  }
);

/* =========================
   LISTAR PRODUTOS
========================= */

router.get("/", authMiddleware, async (req, res) => {
  try {
    const result = await db.query(
      `
      SELECT p.*, e.quantidade_arara, e.quantidade_deposito
      FROM produtos p
      LEFT JOIN estoque e ON e.produto_id = p.id
      ORDER BY p.nome
      `
    );

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao buscar produtos" });
  }
});

/* =========================
   ATUALIZAR PRODUTO
========================= */

router.put(
  "/:id",
  authMiddleware,
  upload.single("imagem"),
  async (req, res) => {
    const { id } = req.params;

    const {
      nome,
      preco_venda,
      preco_compra,
      subcategoria_id,
      variacao,
      qtd_arara,
      qtd_deposito,
    } = req.body;

    const client = await db.connect();

    try {
      await client.query("BEGIN");

      let imagem_url = null;

      if (req.file) {
        imagem_url = `${req.protocol}://${req.get("host")}/uploads/${req.file.filename}`;
      }

      // Atualiza produto
      await client.query(
        `
        UPDATE produtos
        SET 
          nome=$1, 
          preco_venda=$2, 
          preco_compra=$3, 
          subcategoria_id=$4, 
          variacao=$5,
          imagem_url = COALESCE($6, imagem_url)
        WHERE id=$7
        `,
        [
          nome,
          preco_venda,
          preco_compra,
          subcategoria_id,
          variacao,
          imagem_url,
          id,
        ]
      );

      // Atualiza estoque se enviado
      if (qtd_arara !== undefined || qtd_deposito !== undefined) {
        const { rows } = await client.query(
          `SELECT * FROM estoque WHERE produto_id=$1`,
          [id]
        );

        if (rows.length === 0) {
          await client.query(
            `
            INSERT INTO estoque (produto_id, quantidade_arara, quantidade_deposito)
            VALUES ($1, $2, $3)
            `,
            [id, qtd_arara ?? 0, qtd_deposito ?? 0]
          );
        } else {
          const estoqueAtual = rows[0];

          await client.query(
            `
            UPDATE estoque
            SET quantidade_arara=$1, quantidade_deposito=$2
            WHERE produto_id=$3
            `,
            [
              qtd_arara ?? estoqueAtual.quantidade_arara,
              qtd_deposito ?? estoqueAtual.quantidade_deposito,
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
  }
);

/* =========================
   REMOVER PRODUTO
========================= */

router.delete("/:id", authMiddleware, async (req, res) => {
  const { id } = req.params;
  const client = await db.connect();

  try {
    await client.query("BEGIN");

    await client.query(`DELETE FROM movimentacoes_estoque WHERE produto_id=$1`, [id]);
    await client.query(`DELETE FROM estoque WHERE produto_id=$1`, [id]);
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
