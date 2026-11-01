import { Router } from "express";
import db from "../db.js";
import { authMiddleware } from "./auth.js";
import multer from "multer";
import { uploadImagem } from "../services/storage.js";

const upload = multer({ storage: multer.memoryStorage() });
const router = Router();

/* ============================================================
    CADASTRO EM LOTE
    Atende a requisição em POST na raiz do roteador de lote
============================================================ */
router.post("/", authMiddleware, upload.array("imagens", 100), async (req, res) => {
  const client = await db.connect();
  try {
    const { subcategoria_id, preco_venda, preco_compra, categoria_id } = req.body;
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

    // Pega o ID do usuário vindo do token JWT ou usa 1 como padrão
    const usuarioId = req.user?.id || req.user?.usuario_id || 1;

    // 1. Busca o nome da subcategoria para usar como prefixo do produto
    const subcatRes = await client.query("SELECT nome FROM subcategorias WHERE id = $1", [idSub]);
    const nomeBaseSubcategoria = subcatRes.rows.length > 0 ? subcatRes.rows[0].nome : "Produto";

    // 2. Conta quantos produtos já existem nessa subcategoria para continuar a numeração sequencial
    const countRes = await client.query("SELECT COUNT(*) FROM produtos WHERE subcategoria_id = $1", [idSub]);
    const quantidadeExistente = parseInt(countRes.rows[0].count, 10) || 0;
    const proximoNumeroInicial = quantidadeExistente + 1;

    // 3. Faz o upload das imagens para o Supabase Storage em paralelo
    const imagensUrls = await Promise.all(
      files.map(async (file) => {
        try {
          return await uploadImagem(file);
        } catch (err) {
          console.error(`Falha no upload (${file.originalname}):`, err.message);
          return "";
        }
      })
    );

    // 4. Abre transação no PostgreSQL
    await client.query("BEGIN");
    const produtosCriados = [];

    for (let i = 0; i < files.length; i++) {
      const imagemUrl = imagensUrls[i] || "";
      
      // Gera o nome sequencial correto (ex: Conjunto saia curta 4, 5, 6...)
      const numeroAtual = proximoNumeroInicial + i;
      const nomeProduto = `${nomeBaseSubcategoria} ${numeroAtual}`;

      // Insert na tabela produtos
      const prodRes = await client.query(
        `INSERT INTO produtos 
         (nome, preco_venda, preco_compra, subcategoria_id, categoria_id, variacao, imagem_url, criado_por, data_criacao, ativo)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), true) 
         RETURNING id`,
        [nomeProduto, pVenda, pCompra, idSub, categoria_id || null, "Padrão", imagemUrl, usuarioId]
      );

      const produtoId = prodRes.rows[0].id;

      // Insert na tabela produto_variantes
      const varRes = await client.query(
        `INSERT INTO produto_variantes 
         (produto_id, variacao, tamanho, quantidade_arara, quantidade_deposito, imagem_url)
         VALUES ($1, 'Padrão', 'Único', 1, 0, $2) 
         RETURNING id`,
        [produtoId, imagemUrl]
      );

      const varianteId = varRes.rows[0].id;

      // Insert na tabela estoque
      await client.query(
        `INSERT INTO estoque 
         (produto_id, produto_variacao_id, quantidade_arara, quantidade_deposito, cor, tamanho)
         VALUES ($1, $2, 1, 0, 'Padrão', 'Único')`,
        [produtoId, varianteId]
      );

      // Insert na tabela movimentacoes_estoque
      await client.query(
        `INSERT INTO movimentacoes_estoque 
         (produto_id, usuario_id, tipo, local, quantidade, motivo, data, quantidade_anterior, quantidade_nova, cor, tamanho)
         VALUES ($1, $2, 'entrada', 'arara', 1, 'Cadastro em Lote', NOW(), 0, 1, 'Padrão', 'Único')`,
        [produtoId, usuarioId]
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
    console.error("ERRO NO POST /lote:", err.message);
    return res.status(500).json({ 
      erro: "Erro ao cadastrar lote de produtos", 
      detalhes: err.message 
    });
  } finally {
    client.release();
  }
});

export default router;