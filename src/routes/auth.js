import { Router } from "express";
import jwt from "jsonwebtoken";
import db from "../db.js";

const router = Router();

/**
 * 🔐 Middleware de autenticação
 */
export function authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
        return res.status(401).json({ erro: "Token não enviado" });
    }

    const parts = authHeader.split(" ");

    if (parts.length !== 2 || parts[0] !== "Bearer") {
        return res.status(401).json({ erro: "Token mal formatado" });
    }

    const token = parts[1];

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch {
        return res.status(401).json({ erro: "Token inválido" });
    }
}


/**
 * 🟢 LOGIN
 * POST /auth/login
 */
router.post("/login", async (req, res) => {
    const { codigo, senha } = req.body;

    if (!codigo) {
        return res.status(400).json({ erro: "Código obrigatório" });
    }

    if (!senha) {
        return res.status(400).json({ erro: "Senha obrigatória" });
    }

    const result = await db.query(
        "SELECT id, nome, codigo, telefone FROM vendedoras WHERE codigo = $1",
        [codigo]
    );

    if (result.rows.length === 0) {
        return res.status(401).json({ erro: "Credenciais inválidas" });
    }

    const vendedora = result.rows[0];

    // últimos 4 dígitos do telefone
    const senhaCorreta = vendedora.telefone.slice(-4);

    if (senha !== senhaCorreta) {
        return res.status(401).json({ erro: "Credenciais inválidas" });
    }

    const token = jwt.sign(
        {
            id: vendedora.id,
            nome: vendedora.nome,
            codigo: vendedora.codigo
        },
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
    const { nome, telefone } = req.body;

    if (!nome) {
        return res.status(400).json({ erro: "Nome obrigatório" });
    }

    if (!telefone) {
        return res.status(400).json({ erro: "Telefone obrigatório" });
    }

    let codigo;
    let existe = true;

    while (existe) {
        const numero = Math.floor(Math.random() * 10000)
            .toString()
            .padStart(4, "0");

        const result = await db.query(
            "SELECT 1 FROM vendedoras WHERE codigo = $1",
            [`VEND-${numero}`]
        );

        existe = result.rows.length > 0;

        if (!existe) {
            codigo = `VEND-${numero}`;
        }
    }

    // Exemplo de uso
    await db.query(
        "INSERT INTO vendedoras (nome, telefone, codigo) VALUES ($1, $2, $3)",
        [nome, telefone, codigo]
    );

    res.status(201).json({ mensagem: "Registrado com sucesso", codigo });
});


/**
 * 🔵 USUÁRIO LOGADO
 * GET /auth/me
 */
router.get("/me", authMiddleware, (req, res) => {
    res.json({
        id: req.user.id,
        nome: req.user.nome,
        codigo: req.user.codigo
    });
});


export default router;