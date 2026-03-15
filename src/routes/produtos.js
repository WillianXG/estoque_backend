import { Router } from "express";
import multer from "multer";
import db from "../db.js";
import { authMiddleware } from "./auth.js";
import supabase from "../config/supabase.js";
import path from "path";

const router = Router();

/* =========================
   MULTER MEMORY (SEM DISCO)
========================= */

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

/* =========================
   FUNÇÃO UPLOAD SUPABASE
========================= */

async function uploadImagem(file) {
  if (!file) return null;

  const fileExt = path.extname(file.originalname);
  const fileName = `${Date.now()}${fileExt}`;
  const filePath = `produtos/${fileName}`;

  const { error } = await supabase.storage
    .from("produtos")
    .upload(filePath, file.buffer, {
      contentType: file.mimetype,
    });

  if (error) throw error;

  const { data } = supabase.storage
    .from("produtos")
    .getPublicUrl(filePath);

  return data.publicUrl;
}

/* =========================
   CRIAR PRODUTO
========================= */

router.post(
  "/",
  authMiddleware,
  upload.single("imagem"),
  async (req, res) => {
    const client = await db.connect();

    try {
      await client.query("BEGIN");

      const {
        nome,
        preco_venda,
        preco_compra,
        subcategoria_id,
        variacao,
      } = req.body;

      if (!nome || !preco_venda || !subcategoria_id) {
        await client.query("ROLLBACK");
        return res.status(400).json({ erro: "Campos obrigatórios não enviados" });
      }

      const precoVendaNum = Number(preco_venda);
      const precoCompraNum = preco_compra ? Number(preco_compra) : null;
      const subcategoriaIdNum = Number(subcategoria_id);

      if (isNaN(precoVendaNum)) {
        await client.query("ROLLBACK");
        return res.status(400).json({ erro: "Preço de venda inválido" });
      }

      if (precoCompraNum !== null && isNaN(precoCompraNum)) {
        await client.query("ROLLBACK");
        return res.status(400).json({ erro: "Preço de compra inválido" });
      }

      if (isNaN(subcategoriaIdNum)) {
        await client.query("ROLLBACK");
        return res.status(400).json({ erro: "Subcategoria inválida" });
      }

      const qtd_arara = Number(req.body.qtd_arara || 0);
      const qtd_deposito = Number(req.body.qtd_deposito || 0);

      /* 🔥 UPLOAD SUPABASE */
      const imagem_url = req.file ? await uploadImagem(req.file) : null;

      const produtoResult = await client.query(
        `
        INSERT INTO produtos 
        (nome, preco_venda, preco_compra, subcategoria_id, variacao, imagem_url, criado_por, data_criacao)
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
        RETURNING id
        `,
        [
          nome,
          precoVendaNum,
          precoCompraNum,
          subcategoriaIdNum,
          variacao || "",
          imagem_url,
          req.user.id,
        ]
      );

      const produtoId = produtoResult.rows[0].id;

      await client.query(
        `
        INSERT INTO estoque (produto_id, quantidade_arara, quantidade_deposito)
        VALUES ($1, $2, $3)
        `,
        [produtoId, qtd_arara, qtd_deposito]
      );

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
      console.error("ERRO REAL:", err);
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
    const result = await db.query(`
      SELECT p.*, e.quantidade_arara, e.quantidade_deposito
      FROM produtos p
      LEFT JOIN estoque e ON e.produto_id = p.id
      ORDER BY p.nome
    `);

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
    const client = await db.connect();

    try {
      await client.query("BEGIN");

      const {
        nome,
        preco_venda,
        preco_compra,
        subcategoria_id,
        variacao,
      } = req.body;

      if (!nome || !preco_venda || !subcategoria_id) {
        await client.query("ROLLBACK");
        return res.status(400).json({ erro: "Campos obrigatórios não enviados" });
      }

      const precoVendaNum = Number(preco_venda);
      const precoCompraNum = preco_compra ? Number(preco_compra) : null;
      const subcategoriaIdNum = Number(subcategoria_id);

      if (isNaN(precoVendaNum) || isNaN(subcategoriaIdNum)) {
        await client.query("ROLLBACK");
        return res.status(400).json({ erro: "Dados inválidos" });
      }

      let imagem_url = null;

      if (req.file) {
        imagem_url = await uploadImagem(req.file);
      }

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
          precoVendaNum,
          precoCompraNum,
          subcategoriaIdNum,
          variacao || "",
          imagem_url,
          id,
        ]
      );

      /* ESTOQUE */
      const qtd_arara =
        req.body.qtd_arara !== undefined
          ? Number(req.body.qtd_arara)
          : undefined;

      const qtd_deposito =
        req.body.qtd_deposito !== undefined
          ? Number(req.body.qtd_deposito)
          : undefined;

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

      const produtoAtualizado = await client.query(
        `
        SELECT p.*, e.quantidade_arara, e.quantidade_deposito
        FROM produtos p
        LEFT JOIN estoque e ON e.produto_id = p.id
        WHERE p.id = $1
        `,
        [id]
      );
      await client.query("COMMIT");
      res.json(produtoAtualizado.rows[0]);

    } catch (err) {
      await client.query("ROLLBACK");
      console.error("ERRO REAL:", err);
      res.status(500).json({ erro: "Erro ao atualizar produto" });
    } finally {
      client.release();
    }
  }
);

/* =========================
   DELETAR PRODUTO
========================= */

router.delete("/:id", authMiddleware, async (req, res) => {
  const { id } = req.params;
  const client = await db.connect();

  try {
    await client.query("BEGIN");

    // apagar itens de venda
    await client.query(
      `DELETE FROM venda_itens WHERE produto_id = $1`,
      [id]
    );

    // apagar movimentações
    await client.query(
      `DELETE FROM movimentacoes_estoque WHERE produto_id = $1`,
      [id]
    );

    // apagar estoque
    await client.query(
      `DELETE FROM estoque WHERE produto_id = $1`,
      [id]
    );

    // apagar produto
    await client.query(
      `DELETE FROM produtos WHERE id = $1`,
      [id]
    );

    await client.query("COMMIT");

    res.json({ message: "Produto deletado com sucesso" });

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("ERRO REAL:", err);
    res.status(500).json({ erro: "Erro ao deletar produto" });
  } finally {
    client.release();
  }
});

export default router;