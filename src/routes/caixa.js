import { Router } from "express";
import db from "../db.js";
import { authMiddleware } from "./auth.js";

const router = Router();

// 1. ABRIR CAIXA (POST /api/caixa/abrir)
router.post("/abrir", authMiddleware, async (req, res) => {
    const { valorInicial, idUsuario } = req.body;

    try {
        // Verifica se já não existe um caixa aberto
        const caixaAberto = await db.query(
            'SELECT * FROM "CaixaSessao" WHERE "Status" = \'ABERTO\''
        );

        if (caixaAberto.rows.length > 0) {
            return res.status(400).json({ error: "Já existe um caixa aberto no momento!" });
        }

        // Cria a nova sessão de caixa
        const query = `
            INSERT INTO "CaixaSessao" ("ValorInicial", "Status", "IdUsuario") 
            VALUES ($1, 'ABERTO', $2) 
            RETURNING *
        `;
        const result = await db.query(query, [valorInicial, idUsuario]);

        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Erro ao abrir o caixa." });
    }
});

// 2. VERIFICAR STATUS ATUAL DO CAIXA (GET /api/caixa/status)
router.get("/status", authMiddleware, async (req, res) => {
    try {
        // Busca se tem caixa aberto e traz os valores consolidados
        const caixaAberto = await db.query(
            'SELECT * FROM "CaixaSessao" WHERE "Status" = \'ABERTO\''
        );

        if (caixaAberto.rows.length === 0) {
            return res.json({ status: "FECHADO", caixa: null });
        }

        const caixa = caixaAberto.rows[0];

        // Busca a soma de movimentações para exibir no painel (Saldo Estimado)
        const movimentacoes = await db.query(
            'SELECT "Tipo", SUM("Valor") as total FROM "CaixaMovimentacao" WHERE "IdSessao" = $1 GROUP BY "Tipo"',
            [caixa.Id]
        );

        res.json({
            status: "ABERTO",
            caixa,
            resumo: movimentacoes.rows
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Erro ao buscar status do caixa." });
    }
});

// 3. REALIZAR MOVIMENTAÇÃO: SANGRIA OU SUPRIMENTO (POST /api/caixa/movimentacao)
router.post("/movimentacao", authMiddleware, async (req, res) => {
    const { idSessao, tipo, valor, observacao } = req.body;

    // Validação do tipo correto
    if (!["SANGRIA", "SUPRIMENTO", "VENDA_DINHEIRO"].includes(tipo)) {
        return res.status(400).json({ error: "Tipo de movimentação inválido." });
    }

    try {
        const query = `
            INSERT INTO "CaixaMovimentacao" ("IdSessao", "Tipo", "Valor", "Observacao")
            VALUES ($1, $2, $3, $4)
            RETURNING *
        `;
        const result = await db.query(query, [idSessao, tipo, valor, observacao]);

        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Erro ao registrar movimentação." });
    }
});

// 4. FECHAR CAIXA (POST /api/caixa/fechar)
router.post("/fechar", authMiddleware, async (req, res) => {
    const { idSessao, valorFechamentoDinheiro } = req.body;

    try {
        const query = `
            UPDATE "CaixaSessao" 
            SET "Status" = 'FECHADO', "DataFechamento" = NOW(), "ValorFechamentoDinheiro" = $1
            WHERE "Id" = $2 AND "Status" = 'ABERTO'
            RETURNING *
        `;
        const result = await db.query(query, [valorFechamentoDinheiro, idSessao]);

        if (result.rows.length === 0) {
            return res.status(400).json({ error: "Caixa não encontrado ou já encerrado." });
        }

        res.json({ message: "Caixa fechado com sucesso!", caixa: result.rows[0] });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Erro ao fechar o caixa." });
    }
});

export default router;