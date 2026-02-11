import { Router } from "express";
import db from "../db.js";
import { authMiddleware } from "./auth.js";

const router = Router();

router.post("/entrada", authMiddleware, async (req, res) => {
  const { produto_id, quantidade } = req.body;
  await db.query(
    `INSERT INTO estoque (produto_id, quantidade)
     VALUES ($1, $2)
     ON CONFLICT (produto_id)
     DO UPDATE SET quantidade = estoque.quantidade + $2`,
    [produto_id, quantidade]
  );
  res.sendStatus(200);
});

router.post("/saida", authMiddleware, async (req, res) => {
  const { produto_id, quantidade } = req.body;
  await db.query(
    "UPDATE estoque SET quantidade = quantidade - $1 WHERE produto_id = $2",
    [quantidade, produto_id]
  );
  res.sendStatus(200);
});

export default router;
