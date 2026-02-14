import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import authRoutes from "./routes/auth.js";
import categoriasRoutes from "./routes/categorias.js";
import subcategoriasRoutes from "./routes/subcategorias.js";
import produtosRoutes from "./routes/produtos.js";
import vendasRoutes from "./routes/vendas.js";
import estoqueMovimentacaoRoutes from "./routes/estoqueMovimentacao.js";
import vendedorasRoutes from "./routes/vendedoras.js";

const app = express();

/* =========================
   CONFIGURAÇÃO DE PATH (ESM)
========================= */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* =========================
   CRIAR PASTA UPLOADS AUTOMATICAMENTE
========================= */
const uploadDir = path.join(__dirname, "../uploads");

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
  console.log("📁 Pasta uploads criada automaticamente");
}

/* =========================
   MIDDLEWARES
========================= */
app.use(cors());
app.use(express.json());

/* =========================
   SERVIR ARQUIVOS ESTÁTICOS
========================= */
app.use("/uploads", express.static(uploadDir));

/* =========================
   ROTAS
========================= */
app.use("/auth", authRoutes);
app.use("/categorias", categoriasRoutes);
app.use("/subcategorias", subcategoriasRoutes);
app.use("/produtos", produtosRoutes);
app.use("/vendas", vendasRoutes);
app.use("/estoque", estoqueMovimentacaoRoutes);
app.use("/movimentacoes-estoque", estoqueMovimentacaoRoutes);
app.use("/vendedoras", vendedorasRoutes);

/* =========================
   ROTA TESTE
========================= */
app.get("/", (req, res) => {
  res.json({ ok: true });
});

export default app;