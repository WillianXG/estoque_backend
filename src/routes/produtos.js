import { Router } from "express";
import multer from "multer";
import db from "../db.js";
import { authMiddleware } from "./auth.js";
import supabase from "../config/supabase.js";
import path from "path";

const router = Router();

/* =========================
   MULTER
========================= */

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

/* =========================
   UPLOAD SUPABASE
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

router.post("/", authMiddleware, upload.single("imagem"), async (req, res) => {
  const client = await db.connect();

  try {
    await client.query("BEGIN");

    const {
      nome,
      preco_venda,
      preco_compra,
      subcategoria_id,
      variacao,
      qtd_arara = 0,
      qtd_deposito = 0,
    } = req.body;

    if (!nome || !preco_venda || !subcategoria_id) {
      await client.query("ROLLBACK");
      return res.status(400).json({ erro: "Campos obrigatórios não enviados" });
    }

    const imagem_url = req.file ? await uploadImagem(req.file) : null;

    const produto = await client.query(
      `
      INSERT INTO produtos 
      (nome, preco_venda, preco_compra, subcategoria_id, variacao, imagem_url, criado_por, data_criacao, ativo)
      VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),true)
      RETURNING id
      `,
      [
        nome,
        Number(preco_venda),
        preco_compra ? Number(preco_compra) : null,
        Number(subcategoria_id),
        variacao || "",
        imagem_url,
        req.user.id,
      ]
    );

    const produtoId = produto.rows[0].id;

    await client.query(
      `
      INSERT INTO estoque (produto_id, quantidade_arara, quantidade_deposito)
      VALUES ($1,$2,$3)
      `,
      [produtoId, Number(qtd_arara), Number(qtd_deposito)]
    );

    if (qtd_arara > 0) {
      await client.query(
        `
        INSERT INTO movimentacoes_estoque
        (produto_id, usuario_id, tipo, local, quantidade, motivo)
        VALUES ($1,$2,'entrada','arara',$3,'Estoque inicial')
        `,
        [produtoId, req.user.id, qtd_arara]
      );
    }

    if (qtd_deposito > 0) {
      await client.query(
        `
        INSERT INTO movimentacoes_estoque
        (produto_id, usuario_id, tipo, local, quantidade, motivo)
        VALUES ($1,$2,'entrada','deposito',$3,'Estoque inicial')
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

/* =========================
   LISTAR PRODUTOS
========================= */

router.get("/", authMiddleware, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
      p.*, 
      COALESCE(e.quantidade_arara, 0) as quantidade_arara,
      COALESCE(e.quantidade_deposito, 0) as quantidade_deposito
      FROM produtos p
      LEFT JOIN estoque e ON e.produto_id = p.id
      WHERE p.ativo = true
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

router.put("/:id", authMiddleware, upload.single("imagem"), async (req, res) => {
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
      qtd_arara,
      qtd_deposito,
    } = req.body;

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
        Number(preco_venda),
        preco_compra ? Number(preco_compra) : null,
        Number(subcategoria_id),
        variacao || "",
        imagem_url,
        id,
      ]
    );

    if (qtd_arara !== undefined || qtd_deposito !== undefined) {
      await client.query(
        `
        UPDATE estoque
        SET 
        quantidade_arara = COALESCE($1, quantidade_arara),
        quantidade_deposito = COALESCE($2, quantidade_deposito)
        WHERE produto_id = $3
        `,
        [qtd_arara, qtd_deposito, id]
      );
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
    console.error(err);
    res.status(500).json({ erro: "Erro ao atualizar produto" });
  } finally {
    client.release();
  }
});

/* =========================
   DESATIVAR PRODUTO
========================= */

router.delete("/:id", authMiddleware, async (req, res) => {
  const { id } = req.params;

  try {

    await db.query(
      `
      UPDATE produtos
      SET ativo = false
      WHERE id = $1
      `,
      [id]
    );

    res.json({ message: "Produto desativado com sucesso" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao remover produto" });
  }
});

export default router;