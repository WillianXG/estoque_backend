import { pool } from "../db.js";

export async function getDashboardData(req, res) {
  try {
    const client = await pool.connect();

    // 1️⃣ Vendas do dia
    const vendasDiaRes = await client.query(
      `SELECT COUNT(*) AS total_vendas_dia, COALESCE(SUM(valor_total),0) AS total_valor_dia
       FROM vendas
       WHERE DATE(data) = CURRENT_DATE`
    );
    const vendasDia = vendasDiaRes.rows[0];

    // 2️⃣ Vendas do mês
    const vendasMesRes = await client.query(
      `SELECT COUNT(*) AS total_vendas_mes, COALESCE(SUM(valor_total),0) AS total_valor_mes
       FROM vendas
       WHERE DATE_TRUNC('month', data) = DATE_TRUNC('month', CURRENT_DATE)`
    );
    const vendasMes = vendasMesRes.rows[0];

    // 3️⃣ Lucro do mês (venda - compra)
    const lucroMesRes = await client.query(
      `SELECT COALESCE(SUM(vi.quantidade * (p.preco_venda - p.preco_compra)),0) AS lucro_mes
       FROM venda_itens vi
       JOIN produtos p ON vi.produto_id = p.id
       JOIN vendas v ON vi.venda_id = v.id
       WHERE DATE_TRUNC('month', v.data) = DATE_TRUNC('month', CURRENT_DATE)`
    );
    const lucroMes = lucroMesRes.rows[0].lucro_mes;

    // 4️⃣ Ranking de vendedoras (total vendas do mês)
    const rankingRes = await client.query(
      `SELECT ve.nome, COUNT(v.id) AS vendas_realizadas, COALESCE(SUM(v.valor_total),0) AS total_vendas
       FROM vendedoras ve
       LEFT JOIN vendas v ON ve.id = v.vendedora_id
       WHERE DATE_TRUNC('month', v.data) = DATE_TRUNC('month', CURRENT_DATE)
       GROUP BY ve.id
       ORDER BY total_vendas DESC`
    );
    const rankingVendedoras = rankingRes.rows;

    // 5️⃣ Estoque baixo (arara + deposito < 5)
    const estoqueBaixoRes = await client.query(
      `SELECT p.nome, (e.quantidade_arara + e.quantidade_deposito) AS total_estoque
       FROM estoque e
       JOIN produtos p ON e.produto_id = p.id
       WHERE (e.quantidade_arara + e.quantidade_deposito) < 5`
    );
    const estoqueBaixo = estoqueBaixoRes.rows;

    // 6️⃣ Produtos encostados (sem venda no último mês)
    const produtosEncostadosRes = await client.query(
      `SELECT p.nome
       FROM produtos p
       LEFT JOIN venda_itens vi ON p.id = vi.produto_id
       LEFT JOIN vendas v ON vi.venda_id = v.id AND v.data >= CURRENT_DATE - INTERVAL '30 days'
       WHERE v.id IS NULL`
    );
    const produtosEncostados = produtosEncostadosRes.rows;

    // 7️⃣ Produtos mais vendidos (quantidade total no mês)
    const produtosMaisVendidosRes = await client.query(
      `SELECT p.nome, SUM(vi.quantidade) AS quantidade_vendida
       FROM venda_itens vi
       JOIN vendas v ON vi.venda_id = v.id
       JOIN produtos p ON vi.produto_id = p.id
       WHERE DATE_TRUNC('month', v.data) = DATE_TRUNC('month', CURRENT_DATE)
       GROUP BY p.id
       ORDER BY quantidade_vendida DESC
       LIMIT 10`
    );
    const produtosMaisVendidos = produtosMaisVendidosRes.rows;

    client.release();

    res.json({
      vendasDia,
      vendasMes,
      lucroMes,
      rankingVendedoras,
      estoqueBaixo,
      produtosEncostados,
      produtosMaisVendidos,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao buscar dados do dashboard" });
  }
}