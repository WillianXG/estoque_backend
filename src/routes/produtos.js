import { Router } from "express";
import multer from "multer";
import db from "../db.js";
import { authMiddleware } from "./auth.js";
import supabase from "../config/supabase.js";
import path from "path";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

// Helper de Upload com Tratamento de Erro
async function uploadImagem(file) {
  if (!file) return null;
  const fileExt = path.extname(file.originalname) || ".jpg";
  const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}${fileExt}`;
  const filePath = `produtos/${fileName}`;

  const { error } = await supabase.storage
    .from("produtos")
    .upload(filePath, file.buffer, { 
      contentType: file.mimetype || "image/jpeg",
      upsert: true 
    });

  if (error) {
    console.error(`Erro no Supabase (${file.originalname}):`, error.message);
    throw new Error(`Erro Supabase: ${error.message}`);
  }

  const { data } = supabase.storage.from("produtos").getPublicUrl(filePath);
  return data.publicUrl;
}

// Fallback de Usuario ID caso a req.user venha vazia
function getUsuarioId(req) {
  const id = req.user?.id || req.user?.usuario_id || req.user?.userId;
  if (id && !isNaN(parseInt(id))) {
    return parseInt(id);
  }
  return 1; // ID fallback para evitar NOT NULL constraint em movimentacoes_estoque
}

/* ============================================================
   CADASTRO EM LOTE (POST /lote)
============================================================ */
router.post("/lote", authMiddleware, upload.array("imagens", 100), async (req, res) => {
  const client = await db.connect();
  try {
    const { subcategoria_id, preco_venda, preco_compra } = req.body;
    const files = req.files;

    if (!files || files.length === 0) {
      return res.status(400).json({ erro: "Nenhuma imagem foi enviada." });
    }

    const idSub = parseInt(subcategoria_id);
    const pVenda = parseFloat(String(preco_venda).replace(",", "."));
    const pCompra = preco_compra ? parseFloat(String(preco_compra).replace(",", ".")) : null;

    if (isNaN(idSub) || isNaN(pVenda)) {
      return res.status(400).json({ erro: "Subcategoria e Preço de Venda são obrigatórios." });
    }

    const usuarioId = getUsuarioId(req);

    // 1. Upload Paralelo para alta performance
    const imagensUrls = await Promise.all(
      files.map(async (file) => {
        try {
          return await uploadImagem(file);
        } catch (err) {
          console.error(`Falha ao subir ${file.originalname}:`, err.message);
          return "";
        }
      })
    );

    // 2. Transação única
    await client.query("BEGIN");
    const produtosCriados = [];
    const timestampBatch = Date.now().toString().slice(-4); // Garante unicidade mesmo em lotes simultâneos

    for (let i = 0; i < files.length; i++) {
      const imagemUrl = imagensUrls[i] || "";
      
      // Nome e variação dinâmicos para respeitar a constraint 'unico_produto (nome, variacao)'
      const nomeProduto = `Produto Lote ${timestampBatch}-${i + 1}`;
      const variacaoProduto = `Padrão ${i + 1}`;

      // INSERT em 'produtos'
      const prodRes = await client.query(
        `INSERT INTO produtos 
         (nome, preco_venda, preco_compra, subcategoria_id, variacao, imagem_url, criado_por, data_criacao, ativo)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), true) 
         RETURNING id`,
        [nomeProduto, pVenda, pCompra, idSub, variacaoProduto, imagemUrl, usuarioId]
      );

      const produtoId = prodRes.rows[0].id;

      // INSERT em 'produto_variantes'
      const varRes = await client.query(
        `INSERT INTO produto_variantes 
         (produto_id, variacao, tamanho, quantidade_arara, quantidade_deposito, imagem_url)
         VALUES ($1, $2, 'Único', 1, 0, $3) 
         RETURNING id`,
        [produtoId, variacaoProduto, imagemUrl]
      );

      const varianteId = varRes.rows[0].id;

      // INSERT em 'estoque'
      await client.query(
        `INSERT INTO estoque 
         (produto_id, produto_variacao_id, quantidade_arara, quantidade_deposito, cor, tamanho)
         VALUES ($1, $2, 1, 0, $3, 'Único')`,
        [produtoId, varianteId, variacaoProduto]
      );

      // INSERT em 'movimentacoes_estoque'
      await client.query(
        `INSERT INTO movimentacoes_estoque 
         (produto_id, usuario_id, tipo, local, quantidade, motivo, data, quantidade_anterior, quantidade_nova, cor, tamanho)
         VALUES ($1, $2, 'entrada', 'arara', 1, 'Cadastro em Lote', NOW(), 0, 1, $3, 'Único')`,
        [produtoId, usuarioId, variacaoProduto]
      );

      produtosCriados.push(produtoId);
    }

    await client.query("COMMIT");

    return res.status(201).json({
      mensagem: `${produtosCriados.length} produtos cadastrados com sucesso!`,
      ids: produtosCriados,
    });
  } catch (err) {
    if (client) await client.query("ROLLBACK");
    console.error("ERRO CRÍTICO NO POST /lote:", err);
    return res.status(500).json({ 
      erro: "Erro ao cadastrar lote de produtos", 
      detalhes: err.message || "Erro interno do servidor" 
    });
  } finally {
    client.release();
  }
});

/* ============================================================
   CRIAR PRODUTO INDIVIDUAL (POST)
============================================================ */
router.post("/", authMiddleware, upload.any(), async (req, res) => {
  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const { nome, preco_venda, preco_compra, subcategoria_id, variacao, variantes } = req.body;

    const idSub = parseInt(subcategoria_id);
    const pVenda = parseFloat(String(preco_venda).replace(",", "."));
    const pCompra = preco_compra ? parseFloat(String(preco_compra).replace(",", ".")) : null;

    const nomeFinal = nome?.trim() ? nome : "Produto sem nome";
    const usuarioId = getUsuarioId(req);

    if (isNaN(idSub) || isNaN(pVenda)) {
      await client.query("ROLLBACK");
      return res.status(400).json({ erro: "Subcategoria e Preço de Venda são obrigatórios." });
    }

    const fotoPrincipalFile = req.files?.find((f) => f.fieldname === "imagem");
    const imagem_url_principal = fotoPrincipalFile ? await uploadImagem(fotoPrincipalFile) : null;

    const produto = await client.query(
      `INSERT INTO produtos 
       (nome, preco_venda, preco_compra, subcategoria_id, variacao, imagem_url, criado_por, data_criacao, ativo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), true) 
       RETURNING id`,
      [nomeFinal, pVenda, pCompra, idSub, variacao || "", imagem_url_principal, usuarioId]
    );

    const produtoId = produto.rows[0].id;

    if (variantes) {
      const parsedVariantes = typeof variantes === "string" ? JSON.parse(variantes) : variantes;

      for (let i = 0; i < parsedVariantes.length; i++) {
        const v = parsedVariantes[i];

        const varFile = req.files?.find((f) => f.fieldname === `variante_imagem_${i}`);
        let varImagemUrl = v.imagem_url || v.imagem || null;

        if (varFile) {
          varImagemUrl = await uploadImagem(varFile);
        }

        const varResult = await client.query(
          `INSERT INTO produto_variantes 
           (produto_id, variacao, tamanho, quantidade_arara, quantidade_deposito, imagem_url)
           VALUES ($1, $2, $3, $4, $5, $6) 
           RETURNING id`,
          [
            produtoId,
            v.variacao || "Padrão",
            v.tamanho || "Único",
            Number(v.quantidade_arara) || 0,
            Number(v.quantidade_deposito) || 0,
            varImagemUrl,
          ]
        );

        const varianteId = varResult.rows[0].id;
        const qtdTotal = (Number(v.quantidade_arara) || 0) + (Number(v.quantidade_deposito) || 0);

        await client.query(
          `INSERT INTO estoque 
           (produto_id, produto_variacao_id, quantidade_arara, quantidade_deposito, cor, tamanho)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [produtoId, varianteId, Number(v.quantidade_arara) || 0, Number(v.quantidade_deposito) || 0, v.variacao || "Padrão", v.tamanho || "Único"]
        );

        if (qtdTotal > 0) {
          await client.query(
            `INSERT INTO movimentacoes_estoque 
             (produto_id, usuario_id, tipo, local, quantidade, motivo, data, quantidade_anterior, quantidade_nova, cor, tamanho)
             VALUES ($1, $2, 'entrada', 'arara', $3, 'Estoque Inicial', NOW(), 0, $3, $4, $5)`,
            [produtoId, usuarioId, qtdTotal, v.variacao || "Padrão", v.tamanho || "Único"]
          );
        }
      }
    }

    await client.query("COMMIT");
    return res.status(201).json({ id: produtoId });
  } catch (err) {
    if (client) await client.query("ROLLBACK");
    console.error("ERRO NO POST INDIVIDUAL:", err.message);
    return res.status(500).json({ erro: "Erro ao salvar produto", detalhes: err.message });
  } finally {
    client.release();
  }
});

/* ============================================================
   ATUALIZAR PRODUTO (PUT)
============================================================ */
router.put("/:id", authMiddleware, upload.any(), async (req, res) => {
  const { id } = req.params;
  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const { nome, preco_venda, preco_compra, subcategoria_id, variacao, variantes } = req.body;
    const usuarioId = getUsuarioId(req);

    const idSub = parseInt(subcategoria_id);
    const pVenda = parseFloat(String(preco_venda).replace(",", "."));
    const pCompra = preco_compra ? parseFloat(String(preco_compra).replace(",", ".")) : null;

    const fotoPrincipalFile = req.files?.find((f) => f.fieldname === "imagem");
    let imagem_url = fotoPrincipalFile ? await uploadImagem(fotoPrincipalFile) : null;

    await client.query(
      `UPDATE produtos 
       SET nome = COALESCE(NULLIF($1, ''), nome), 
           preco_venda=$2, preco_compra=$3, subcategoria_id=$4, variacao=$5, 
           imagem_url = COALESCE($6, imagem_url) 
       WHERE id=$7`,
      [nome || "", pVenda, pCompra, idSub, variacao || "", imagem_url, id]
    );

    if (variantes) {
      const parsedVariantes = typeof variantes === "string" ? JSON.parse(variantes) : variantes;

      for (let i = 0; i < parsedVariantes.length; i++) {
        const v = parsedVariantes[i];

        const varFile = req.files?.find((f) => f.fieldname === `variante_imagem_${i}`);
        let varImagemUrl = v.imagem_url || v.imagem || null;

        if (varFile) {
          varImagemUrl = await uploadImagem(varFile);
        }

        let varianteId = v.id;

        if (varianteId) {
          await client.query(
            `UPDATE produto_variantes 
             SET variacao = $1, tamanho = $2, quantidade_arara = $3, quantidade_deposito = $4,
                 imagem_url = COALESCE($5, imagem_url)
             WHERE id = $6 AND produto_id = $7`,
            [
              v.variacao || "Padrão",
              v.tamanho || "Único",
              Number(v.quantidade_arara) || 0,
              Number(v.quantidade_deposito) || 0,
              varImagemUrl,
              varianteId,
              id,
            ]
          );

          await client.query(
            `UPDATE estoque 
             SET quantidade_arara = $1, quantidade_deposito = $2, cor = $3, tamanho = $4
             WHERE produto_variacao_id = $5`,
            [
              Number(v.quantidade_arara) || 0,
              Number(v.quantidade_deposito) || 0,
              v.variacao || "Padrão",
              v.tamanho || "Único",
              varianteId,
            ]
          );
        } else {
          const varResult = await client.query(
            `INSERT INTO produto_variantes 
             (produto_id, variacao, tamanho, quantidade_arara, quantidade_deposito, imagem_url)
             VALUES ($1, $2, $3, $4, $5, $6) 
             RETURNING id`,
            [
              id,
              v.variacao || "Padrão",
              v.tamanho || "Único",
              Number(v.quantidade_arara) || 0,
              Number(v.quantidade_deposito) || 0,
              varImagemUrl,
            ]
          );

          varianteId = varResult.rows[0].id;

          await client.query(
            `INSERT INTO estoque 
             (produto_id, produto_variacao_id, quantidade_arara, quantidade_deposito, cor, tamanho)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [id, varianteId, Number(v.quantidade_arara) || 0, Number(v.quantidade_deposito) || 0, v.variacao || "Padrão", v.tamanho || "Único"]
          );
        }
      }

      await client.query(
        `INSERT INTO movimentacoes_estoque 
         (produto_id, usuario_id, tipo, local, quantidade, motivo, data, quantidade_anterior, quantidade_nova)
         VALUES ($1, $2, 'ajuste', 'arara', 0, 'Alteração cadastral de variantes', NOW(), 0, 0)`,
        [id, usuarioId]
      );
    }

    await client.query("COMMIT");
    return res.json({ mensagem: "Sucesso" });
  } catch (err) {
    if (client) await client.query("ROLLBACK");
    console.error("ERRO NO PUT:", err.message);
    return res.status(500).json({ erro: "Erro no PUT", detalhes: err.message });
  } finally {
    client.release();
  }
});

/* ============================================================
   LISTAR PRODUTOS (GET)
============================================================ */
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
            'quantidade_deposito', v.quantidade_deposito,
            'imagem_url', v.imagem_url
          )
        ) FILTER (WHERE v.id IS NOT NULL), '[]'
      ) as variantes
      FROM produtos p
      LEFT JOIN produto_variantes v ON v.produto_id = p.id
      WHERE p.ativo = true
      GROUP BY p.id
      ORDER BY p.id DESC;
    `);

    const rows = result.rows.map((row) => ({
      ...row,
      preco_venda: parseFloat(row.preco_venda),
      preco_compra: row.preco_compra ? parseFloat(row.preco_compra) : null,
    }));

    return res.json(rows);
  } catch (err) {
    console.error("ERRO NO GET:", err.message);
    return res.status(500).json({ erro: "Erro ao buscar produtos" });
  }
});

/* ============================================================
   DESATIVAR PRODUTO (DELETE)
============================================================ */
router.delete("/:id", authMiddleware, async (req, res) => {
  try {
    await db.query("UPDATE produtos SET ativo = false WHERE id = $1", [req.params.id]);
    return res.json({ message: "Produto desativado com sucesso" });
  } catch (err) {
    console.error("ERRO NO DELETE:", err.message);
    return res.status(500).json({ erro: "Erro ao remover produto" });
  }
});

export default router;