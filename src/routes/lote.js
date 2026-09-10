/* ============================================================
   CADASTRO EM LOTE (POST /produtos/lote)
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

    // Pega o ID do usuário vindo do token JWT ou usa 1 como padrão
    const usuarioId = req.user?.id || req.user?.usuario_id || 1;

    // 1. Faz o upload das imagens para o Supabase Storage em paralelo
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

    // 2. Abre transação no PostgreSQL
    await client.query("BEGIN");
    const produtosCriados = [];

    for (let i = 0; i < files.length; i++) {
      const imagemUrl = imagensUrls[i] || "";
      const nomeProduto = "Produto sem nome";

      // Insert na tabela produtos
      const prodRes = await client.query(
        `INSERT INTO produtos 
         (nome, preco_venda, preco_compra, subcategoria_id, variacao, imagem_url, criado_por, data_criacao, ativo)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), true) 
         RETURNING id`,
        [nomeProduto, pVenda, pCompra, idSub, "Padrão", imagemUrl, usuarioId]
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