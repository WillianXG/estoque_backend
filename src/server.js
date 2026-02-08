import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import categorias from "./routes/categorias.js";
import subcategorias from "./routes/subcategorias.js";
import produtos from "./routes/produtos.js";
import estoque from "./routes/estoque.js";
import vendedoras from "./routes/vendedoras.js";
import vendas from "./routes/vendas.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

app.use("/categorias", categorias);
app.use("/subcategorias", subcategorias);
app.use("/produtos", produtos);
app.use("/estoque", estoque);
app.use("/vendedoras", vendedoras);
app.use("/vendas", vendas);

app.listen(3000, () =>
  console.log("Servidor rodando na porta 3000")
);
