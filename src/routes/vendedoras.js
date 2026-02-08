import express from "express";
import db from "../db.js";

const router = express.Router();

router.get("/", async (_, res) => {
  const r = await db.query("SELECT * FROM vendedoras");
  res.json(r.rows);
});

router.post("/", async (req, res) => {
  const { nome, codigo, telefone } = req.body;

  const r = await db.query(
    "INSERT INTO vendedoras (nome, codigo, telefone) VALUES ($1,$2,$3) RETURNING *",
    [nome, codigo, telefone]
  );

  res.status(201).json(r.rows[0]);
});

export default router;
