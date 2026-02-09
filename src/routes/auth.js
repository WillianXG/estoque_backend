import { Router } from "express";
import jwt from "jsonwebtoken";

const router = Router();

/**
 * 🔐 Middleware de autenticação
 */
export function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ erro: "Token não enviado" });
  }

  const [, token] = authHeader.split(" ");

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ erro: "Token inválido" });
  }
}

/**
 * 🟢 LOGIN
 * POST /auth/login
 */
router.post("/login", async (req, res) => {
  const { usuario, senha } = req.body;

  if (!usuario || !senha) {
    return res.status(400).json({ erro: "Usuário e senha obrigatórios" });
  }

  // ⚠️ MVP SIMPLES (depois liga no banco)
  if (usuario !== "admin" || senha !== "123") {
    return res.status(401).json({ erro: "Credenciais inválidas" });
  }

  const token = jwt.sign(
    { usuario },
    process.env.JWT_SECRET,
    { expiresIn: "1d" }
  );

  res.json({ token });
});

/**
 * 🟡 REGISTER (opcional)
 * POST /auth/register
 */
router.post("/register", async (req, res) => {
  const { usuario, senha } = req.body;

  if (!usuario || !senha) {
    return res.status(400).json({ erro: "Dados inválidos" });
  }

  // Aqui no futuro você salva no banco
  res.status(201).json({
    mensagem: "Usuário registrado (mock)",
    usuario
  });
});

/**
 * 🔵 USUÁRIO LOGADO
 * GET /auth/me
 */
router.get("/me", authMiddleware, (req, res) => {
  res.json({
    usuario: req.user.usuario
  });
});

export default router;