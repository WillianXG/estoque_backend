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
      variantes, // pegamos aqui do body
    } = req.body;

    if (!nome || !preco_venda || !subcategoria_id) {
      await client.query("ROLLBACK");
      return res.status(400).json({ erro: "Campos obrigatórios não enviados" });
    }

    const imagem_url = req.file ? await uploadImagem(req.file) : null;

    // Criar produto
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

    // Inserir variantes, se houver
    if (variantes) {
      const parsedVariantes = typeof variantes === "string" ? JSON.parse(variantes) : variantes;

      for (const v of parsedVariantes) {
        await client.query(
          `
          INSERT INTO produto_variantes
          (produto_id, variacao, tamanho, quantidade_arara, quantidade_deposito)
          VALUES ($1,$2,$3,$4,$5)
          `,
          [
            produtoId,
            v.variacao,
            v.tamanho,
            Number(v.quantidade_arara) || 0,
            Number(v.quantidade_deposito) || 0
          ]
        );
      }
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
  COALESCE(
    json_agg(
      json_build_object(
        'id', v.id,
        'variacao', v.variacao,
        'tamanho', v.tamanho,
        'quantidade_arara', v.quantidade_arara,
        'quantidade_deposito', v.quantidade_deposito
      )
    ) FILTER (WHERE v.id IS NOT NULL),
    '[]'
  ) as variantes
FROM produtos p
LEFT JOIN produto_variantes v ON v.produto_id = p.id
WHERE p.ativo = true
GROUP BY p.id
ORDER BY p.nome;
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

router.post("/variantes", authMiddleware, async (req, res) => {
  const client = await db.connect();

  try {
    const {
      produto_id,
      variacao,
      tamanho,
      qtd_arara = 0,
      qtd_deposito = 0
    } = req.body;

    const result = await client.query(
      `
      INSERT INTO produto_variantes
      (produto_id, variacao, tamanho, quantidade_arara, quantidade_deposito)
      VALUES ($1,$2,$3,$4,$5)
      RETURNING *
      `,
      [produto_id, variacao, tamanho, qtd_arara, qtd_deposito]
    );

    res.json(result.rows[0]);

  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao criar variante" });
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