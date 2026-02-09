import { Router } from "express";
import jwt from "jsonwebtoken";
import db from "../db.js";
import { hashSenha, comparaSenha } from "../utils/hash.js";

const router = Router();

router.post("/register", async (req, res) => {
  const { nome, email, senha } = req.body;
  if (!nome || !email || !senha)
    return res.status(400).json({ erro: "Dados obrigatórios" });

  const senhaHash = await hashSenha(senha);

  await db.query(
    "INSERT INTO usuarios (nome, email, senha) VALUES ($1,$2,$3)",
    [nome, email, senhaHash]
  );

  res.json({ ok: true });
});

router.post("/login", async (req, res) => {
  const { email, senha } = req.body;

  const result = await db.query(
    "SELECT * FROM usuarios WHERE email=$1",
    [email]
  );

  if (result.rowCount === 0)
    return res.status(401).json({ erro: "Usuário não encontrado" });

  const user = result.rows[0];
  const ok = await comparaSenha(senha, user.senha);

  if (!ok)
    return res.status(401).json({ erro: "Senha inválida" });

  const token = jwt.sign(
    { id: user.id, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: "1d" }
  );

  res.json({ token });
});

export default router;
