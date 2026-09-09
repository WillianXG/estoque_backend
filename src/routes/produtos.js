import { Router } from "express";
import multer from "multer";
import db from "../db.js";
import { authMiddleware } from "./auth.js";
import supabase from "../config/supabase.js";
import path from "path";

const router = Router();

// Configuração do Multer para Upload de Múltiplas Imagens
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

// Função Auxiliar: Upload para Supabase
async function uploadImagem(file) {
  if (!file) return null;
  const fileExt = path.extname(file.originalname);
  const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}${fileExt}`;
  const filePath = `produtos/${fileName}`;

  const { error } = await supabase.storage
    .from("produtos")
    .upload(filePath, file.buffer, { contentType: file.mimetype });

  if (error) throw error;
  const { data } = supabase.storage.from("produtos").getPublicUrl(filePath);
  return data.publicUrl;
}

/* ============================================================
   CADASTRO EM LOTE (POST /lote) - SEM NOME
   Cadastra produtos apenas com Imagem, Preço e Subcategoria
============================================================ */
router.post("/lote", authMiddleware, upload.array("imagens", 50), async (req, res) => {
  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const { subcategoria_id, preco_venda, preco_compra } = req.body;
    const files = req.files;

    if (!files || files.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ erro: "Nenhuma imagem foi enviada." });
    }

    const idSub = parseInt(subcategoria_id);
    const pVenda = parseFloat(String(preco_venda).replace(",", "."));
    const pCompra = preco_compra ? parseFloat(String(preco_compra).replace(",", ".")) : null;

    if (isNaN(idSub) || isNaN(pVenda)) {
      await client.query("ROLLBACK");
      return res.status(400).json({ erro: "Subcategoria e Preço de Venda são obrigatórios." });
    }

    const produtosCriados = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      // 1. Upload da imagem no Supabase
      const imagemUrl = await uploadImagem(file);

      // Nome genérico ou string vazia caso o banco exija NOT NULL (ajuste se seu campo aceitar NULL)
      const nomeProduto = "Produto sem nome"; 

      // 2. Inserir Produto Principal
      const prodRes = await client.query(
        `INSERT INTO produtos (nome, preco_venda, preco_compra, subcategoria_id, variacao, imagem_url, criado_por, data_criacao, ativo)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), true) RETURNING id`,
        [nomeProduto, pVenda, pCompra, idSub, "", imagemUrl, req.user.id]
      );

      const produtoId = prodRes.rows[0].id;

      // 3. Inserir Variante Padrão
      const varRes = await client.query(
        `INSERT INTO produto_variantes (produto_id, variacao, tamanho, quantidade_arara, quantidade_deposito, imagem_url)
         VALUES ($1, 'Padrão', 'Único', 1, 0, $2) RETURNING id`,
        [produtoId, imagemUrl]
      );

      const varianteId = varRes.rows[0].id;

      // 4. Inserir no Estoque (1 unidade na arara como padrão)
      await client.query(
        `INSERT INTO estoque (produto_id, produto_variacao_id, quantidade_arara, quantidade_deposito, cor, tamanho)
         VALUES ($1, $2, 1, 0, 'Padrão', 'Único')`,
        [produtoId, varianteId]
      );

      // 5. Movimentação de Estoque Inicial
      await client.query(
        `INSERT INTO movimentacoes_estoque 
         (produto_id, tipo, quantidade, motivo, usuario_id, data, local, quantidade_anterior, quantidade_nova, cor, tamanho)
         VALUES ($1, 'entrada', 1, 'Cadastro em Lote', $2, NOW(), 'arara', 0, 1, 'Padrão', 'Único')`,
        [produtoId, req.user.id]
      );

      produtosCriados.push(produtoId);
    }

    await client.query("COMMIT");
    res.status(201).json({
      mensagem: `${produtosCriados.length} produtos cadastrados com sucesso!`,
      ids: produtosCriados,
    });
  } catch (err) {
    if (client) await client.query("ROLLBACK");
    console.error("ERRO NO POST /lote:", err.message);
    res.status(500).json({ erro: "Erro ao cadastrar lote", detalhes: err.message });
  } finally {
    client.release();
  }
});

/* ============================================================
   CRIAR PRODUTO INDIVIDUAL (POST) - Nome Opcional
============================================================ */
router.post("/", authMiddleware, upload.any(), async (req, res) => {
  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const { nome, preco_venda, preco_compra, subcategoria_id, variacao, variantes } = req.body;

    const idSub = parseInt(subcategoria_id);
    const pVenda = parseFloat(String(preco_venda).replace(",", "."));
    const pCompra = preco_compra ? parseFloat(String(preco_compra).replace(",", ".")) : null;

    // Se não vier nome, define um nome padrão/genérico
    const nomeFinal = nome?.trim() ? nome : "Produto sem nome";

    if (isNaN(idSub) || isNaN(pVenda)) {
      await client.query("ROLLBACK");
      return res.status(400).json({ erro: "Subcategoria e Preço de Venda são obrigatórios." });
    }

    // Processa Imagem Principal (file field: 'imagem')
    const fotoPrincipalFile = req.files?.find((f) => f.fieldname === "imagem");
    const imagem_url_principal = fotoPrincipalFile ? await uploadImagem(fotoPrincipalFile) : null;

    // 1. Inserir o Produto principal
    const produto = await client.query(
      `INSERT INTO produtos (nome, preco_venda, preco_compra, subcategoria_id, variacao, imagem_url, criado_por, data_criacao, ativo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), true) RETURNING id`,
      [nomeFinal, pVenda, pCompra, idSub, variacao || "", imagem_url_principal, req.user.id]
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

        // 2. Inserir Variante
        const varResult = await client.query(
          `INSERT INTO produto_variantes (produto_id, variacao, tamanho, quantidade_arara, quantidade_deposito, imagem_url)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
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

        // 3. Inserir no Estoque
        await client.query(
          `INSERT INTO estoque (produto_id, produto_variacao_id, quantidade_arara, quantidade_deposito, cor, tamanho)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [produtoId, varianteId, Number(v.quantidade_arara) || 0, Number(v.quantidade_deposito) || 0, v.variacao || "Padrão", v.tamanho || "Único"]
        );

        // 4. Registrar Movimentação
        if (qtdTotal > 0) {
          await client.query(
            `INSERT INTO movimentacoes_estoque 
             (produto_id, tipo, quantidade, motivo, usuario_id, data, local, quantidade_anterior, quantidade_nova, cor, tamanho)
             VALUES ($1, 'entrada', $2, 'Estoque Inicial', $3, NOW(), 'arara', 0, $2, $4, $5)`,
            [produtoId, qtdTotal, req.user.id, v.variacao || "Padrão", v.tamanho || "Único"]
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

/* ============================================================
   ATUALIZAR PRODUTO (PUT)
============================================================ */
router.put("/:id", authMiddleware, upload.any(), async (req, res) => {
  const { id } = req.params;
  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const { nome, preco_venda, preco_compra, subcategoria_id, variacao, variantes } = req.body;

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
            `INSERT INTO produto_variantes (produto_id, variacao, tamanho, quantidade_arara, quantidade_deposito, imagem_url)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
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
            `INSERT INTO estoque (produto_id, produto_variacao_id, quantidade_arara, quantidade_deposito, cor, tamanho)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [id, varianteId, Number(v.quantidade_arara) || 0, Number(v.quantidade_deposito) || 0, v.variacao || "Padrão", v.tamanho || "Único"]
          );
        }
      }

      await client.query(
        `INSERT INTO movimentacoes_estoque (produto_id, tipo, quantidade, motivo, usuario_id, data, local, quantidade_anterior, quantidade_nova)
         VALUES ($1, 'ajuste', 0, 'Alteração cadastral de variantes', $2, NOW(), 'arara', 0, 0)`,
        [id, req.user.id]
      );
    }

    await client.query("COMMIT");
    res.json({ mensagem: "Sucesso" });
  } catch (err) {
    if (client) await client.query("ROLLBACK");
    console.error("ERRO NO PUT:", err.message);
    res.status(500).json({ erro: "Erro no PUT", detalhes: err.message });
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

    res.json(rows);
  } catch (err) {
    console.error("ERRO NO GET:", err.message);
    res.status(500).json({ erro: "Erro ao buscar produtos" });
  }
});

/* ============================================================
   DESATIVAR PRODUTO (DELETE)
============================================================ */
router.delete("/:id", authMiddleware, async (req, res) => {
  try {
    await db.query("UPDATE produtos SET ativo = false WHERE id = $1", [req.params.id]);
    res.json({ message: "Produto desativado com sucesso" });
  } catch (err) {
    console.error("ERRO NO DELETE:", err.message);
    res.status(500).json({ erro: "Erro ao remover produto" });
  }
});

export default router;