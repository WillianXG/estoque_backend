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
    .upload(filePath, file.buffer, { contentType: file.mimetype });

  if (error) throw error;
  const { data } = supabase.storage.from("produtos").getPublicUrl(filePath);
  return data.publicUrl;
}

/* =========================
   CRIAR PRODUTO (POST)
========================= */
router.post("/", authMiddleware, upload.single("imagem"), async (req, res) => {
  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const { nome, preco_venda, preco_compra, subcategoria_id, variacao, variantes } = req.body;

    const idSub = parseInt(subcategoria_id);
    const pVenda = parseFloat(String(preco_venda).replace(',', '.'));
    const pCompra = preco_compra ? parseFloat(String(preco_compra).replace(',', '.')) : null;

    if (!nome || isNaN(idSub) || isNaN(pVenda)) {
      await client.query("ROLLBACK");
      return res.status(400).json({ erro: "Dados obrigatórios inválidos." });
    }

    const imagem_url = req.file ? await uploadImagem(req.file) : null;

    const produto = await client.query(
      `INSERT INTO produtos (nome, preco_venda, preco_compra, subcategoria_id, variacao, imagem_url, criado_por, data_criacao, ativo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), true) RETURNING id`,
      [nome, pVenda, pCompra, idSub, variacao || "", imagem_url, req.user.id]
    );

    const produtoId = produto.rows[0].id;

    if (variantes) {
      const parsedVariantes = typeof variantes === "string" ? JSON.parse(variantes) : variantes;
      
      for (const v of parsedVariantes) {
        await client.query(
          `INSERT INTO produto_variantes (produto_id, variacao, tamanho, quantidade_arara, quantidade_deposito)
           VALUES ($1, $2, $3, $4, $5)`,
          [produtoId, v.variacao || "", v.tamanho || "", Number(v.quantidade_arara) || 0, Number(v.quantidade_deposito) || 0]
        );

        const qtdTotal = (Number(v.quantidade_arara) || 0) + (Number(v.quantidade_deposito) || 0);
        
        if (qtdTotal > 0) {
          await client.query(
            `INSERT INTO movimentacoes_estoque 
             (produto_id, tipo, quantidade, motivo, usuario_id, data, local, quantidade_anterior, quantidade_nova, cor, tamanho)
             VALUES ($1, 'ENTRADA', $2, 'Estoque Inicial', $3, NOW(), 'SISTEMA', 0, $2, $4, $5)`,
            [produtoId, qtdTotal, req.user.id, v.variacao || "", v.tamanho || ""]
          );
        }
      }
    }

    await client.query("COMMIT");
    res.status(201).json({ id: produtoId });
  } catch (err) {
    if (client) await client.query("ROLLBACK");
    console.error("ERRO NO POST:", err.message);
    res.status(500).json({ erro: "Erro ao salvar", detalhes: err.message });
  } finally {
    client.release();
  }
});

/* =========================
   ATUALIZAR PRODUTO (PUT) - CORRIGIDO
========================= */
router.put("/:id", authMiddleware, upload.single("imagem"), async (req, res) => {
  const { id } = req.params;
  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const { nome, preco_venda, preco_compra, subcategoria_id, variacao, variantes } = req.body;
    
    const idSub = parseInt(subcategoria_id);
    const pVenda = parseFloat(String(preco_venda).replace(',', '.'));
    const pCompra = preco_compra ? parseFloat(String(preco_compra).replace(',', '.')) : null;

    let imagem_url = null;
    if (req.file) imagem_url = await uploadImagem(req.file);

    await client.query(
      `UPDATE produtos SET nome=$1, preco_venda=$2, preco_compra=$3, subcategoria_id=$4, variacao=$5, 
       imagem_url = COALESCE($6, imagem_url) WHERE id=$7`,
      [nome, pVenda, pCompra, idSub, variacao || "", imagem_url, id]
    );

    if (variantes) {
      const parsedVariantes = typeof variantes === "string" ? JSON.parse(variantes) : variantes;
      
      await client.query("DELETE FROM produto_variantes WHERE produto_id = $1", [id]);

      for (const v of parsedVariantes) {
        await client.query(
          `INSERT INTO produto_variantes (produto_id, variacao, tamanho, quantidade_arara, quantidade_deposito)
           VALUES ($1, $2, $3, $4, $5)`,
          [id, v.variacao || "", v.tamanho || "", Number(v.quantidade_arara) || 0, Number(v.quantidade_deposito) || 0]
        );
      }

      // CORREÇÃO AQUI: Adicionado colunas faltantes para bater com o banco
      await client.query(
        `INSERT INTO movimentacoes_estoque 
         (produto_id, tipo, quantidade, motivo, usuario_id, data, local, quantidade_anterior, quantidade_nova)
         VALUES ($1, 'AJUSTE', 0, 'Alteração via editor', $2, NOW(), 'SISTEMA', 0, 0)`,
        [id, req.user.id]
      );
    }

    await client.query("COMMIT");
    res.json({ mensagem: "Produto atualizado com sucesso" });
  } catch (err) {
    if (client) await client.query("ROLLBACK");
    console.error("ERRO NO PUT:", err.message);
    res.status(500).json({ erro: "Erro ao atualizar produto", detalhes: err.message });
  } finally {
    client.release();
  }
});

/* =========================
   LISTAR PRODUTOS (GET)
========================= */
router.get("/", authMiddleware, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT p.*,
      COALESCE(
        json_agg(
          json_build_object(
            'id', v.id,
            'variacao', v.variacao,
            'tamanho', v.tamanho,
            'quantidade_arara', v.quantidade_arara,
            'quantidade_deposito', v.quantidade_deposito
          )
        ) FILTER (WHERE v.id IS NOT NULL), '[]'
      ) as variantes
      FROM produtos p
      LEFT JOIN produto_variantes v ON v.produto_id = p.id
      WHERE p.ativo = true
      GROUP BY p.id
      ORDER BY p.nome;
    `);
    
    // Converte os preços de string para número antes de enviar
    const rows = result.rows.map(row => ({
      ...row,
      preco_venda: parseFloat(row.preco_venda),
      preco_compra: row.preco_compra ? parseFloat(row.preco_compra) : null
    }));

    res.json(rows);
  } catch (err) {
    console.error("ERRO NO GET:", err);
    res.status(500).json({ erro: "Erro ao buscar produtos" });
  }
});

/* =========================
   DESATIVAR PRODUTO (DELETE)
========================= */
router.delete("/:id", authMiddleware, async (req, res) => {
  const { id } = req.params;
  try {
    await db.query("UPDATE produtos SET ativo = false WHERE id = $1", [id]);
    res.json({ message: "Produto desativado com sucesso" });
  } catch (err) {
    console.error("ERRO NO DELETE:", err);
    res.status(500).json({ erro: "Erro ao remover produto" });
  }
});

export default router;