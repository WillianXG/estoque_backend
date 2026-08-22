import express from "express";
import cors from "cors";

import authRoutes from "./routes/auth.js";
import categoriasRoutes from "./routes/categorias.js";
import subcategoriasRoutes from "./routes/subcategorias.js";
import produtosRoutes from "./routes/produtos.js";
import vendasRoutes from "./routes/vendas.js";
import estoqueMovimentacaoRoutes from "./routes/estoqueMovimentacao.js";
import vendedorasRoutes from "./routes/vendedoras.js";
import estoqueRoutes from "./routes/estoque.js";
import dashboardRoutes from "./routes/dashboard.js";
import freteRouter from "./routes/frete.js";
import caixaRouter from "./routes/caixa.js";

const app = express();

/* =========================
   MIDDLEWARES
========================= */
app.use(cors());
app.use(express.json());

/* =========================
   ROTAS
========================= */
app.use("/auth", authRoutes);
app.use("/categorias", categoriasRoutes);
app.use("/subcategorias", subcategoriasRoutes);
app.use("/produtos", produtosRoutes);
app.use("/vendas", vendasRoutes);
app.use("/estoque", estoqueRoutes);
app.use("/movimentacoes-estoque", estoqueMovimentacaoRoutes);
app.use("/vendedoras", vendedorasRoutes);
app.use("/dashboard", dashboardRoutes);
app.use("/frete", freteRouter);
app.use("/caixa", caixaRouter);

/* =========================
   ROTA TESTE / HEALTHCHECK
========================= */
app.get("/", (req, res) => {
  res.json({ status: "online", mensagem: "API Duda Arthou Modas operacional" });
});

/* =========================
   TRATAMENTO DE ERROS GLOBAL
========================= */
app.use((err, req, res, next) => {
  console.error("❌ ERRO NÃO TRATADO:", err.stack || err.message);
  res.status(500).json({
    erro: "Erro interno no servidor",
    detalhes: err.message
  });
});

export default app;