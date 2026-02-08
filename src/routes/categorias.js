import express from "express";
import db from "../db.js";

const router = express.Router();

router.get("/", async (_, res) => {
  const r = await db.query("SELECT * FROM categorias ORDER BY nome");
  res.json(r.rows);
});

router.post("/", async (req, res) => {
  const { nome } = req.body;
  const r = await db.query(
    "INSERT INTO categorias (nome) VALUES ($1) RETURNING *",
    [nome]
  );
  res.status(201).json(r.rows[0]);
});

export default router;
