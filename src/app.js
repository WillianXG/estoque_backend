import express from "express";
import cors from "cors";

import authRoutes from "./routes/auth.js";
import categoriasRoutes from "./routes/categorias.js";
import subcategoriasRoutes from "./routes/subcategorias.js";
import produtosRoutes from "./routes/produtos.js";
import vendasRoutes from "./routes/vendas.js";

const app = express();

app.use(cors());
app.use(express.json());

app.use("/auth", authRoutes);
app.use("/categorias", categoriasRoutes);
app.use("/subcategorias", subcategoriasRoutes);
app.use("/produtos", produtosRoutes);
app.use("/vendas", vendasRoutes);
app.get("/health", (req, res) =>
    {
        res.json({ ok: true });
    });
export default app;
