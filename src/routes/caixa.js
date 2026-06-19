import { Router } from "express";
import db from "../db.js";
import { authMiddleware } from "./auth.js";

const router = Router();

// =========================================================================
// 1. ABRIR CAIXA (POST /caixa/abrir)
// =========================================================================
router.post("/abrir", authMiddleware, async (req, res) => {
    const { valorInicial, idUsuario } = req.body;

    // Validação básica de entrada
    if (valorInicial === undefined || isNaN(Number(valorInicial))) {
        return res.status(400).json({ error: "O valor inicial é obrigatório e deve ser um número válido." });
    }

    try {
        // Verifica se já não existe um caixa aberto no sistema
        const caixaAberto = await db.query(
            'SELECT * FROM "CaixaSessao" WHERE "Status" = \'ABERTO\''
        );

        if (caixaAberto.rows.length > 0) {
            return res.status(400).json({ error: "Já existe um caixa aberto no momento!" });
        }

        // Cria a nova sessão de caixa na tabela corrigida do Supabase
        const query = `
            INSERT INTO "CaixaSessao" ("ValorInicial", "Status", "IdUsuario") 
            VALUES ($1, 'ABERTO', $2) 
            RETURNING *
        `;
        const result = await db.query(query, [Number(valorInicial), idUsuario || 1]);

        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error("Erro crítico na rota POST /caixa/abrir:", error);
        res.status(500).json({ 
            error: "Erro interno no servidor ao abrir o caixa.",
            detalhe: error.message 
        });
    }
});

// =========================================================================
// 2. VERIFICAR STATUS ATUAL DO CAIXA (GET /caixa/status)
// =========================================================================
router.get("/status", authMiddleware, async (req, res) => {
    try {
        // Busca se tem uma sessão com status 'ABERTO'
        const caixaAberto = await db.query(
            'SELECT * FROM "CaixaSessao" WHERE "Status" = \'ABERTO\''
        );

        // Se não houver caixa aberto, avisa o front-end de forma limpa via JSON
        if (caixaAberto.rows.length === 0) {
            return res.json({ status: "FECHADO", caixa: null, resumo: [] });
        }

        const caixa = caixaAberto.rows[0];
        
        // Garante a leitura do ID seja em maiúsculo (Id) ou minúsculo (id) pelo driver do pg
        const sessaoId = caixa.Id !== undefined ? caixa.Id : caixa.id;

        // Busca a soma de movimentações agrupadas por tipo para alimentar os cards do ERP
        const movimentacoes = await db.query(
            'SELECT "Tipo", SUM("Valor") as total FROM "CaixaMovimentacao" WHERE "IdSessao" = $1 GROUP BY "Tipo"',
            [sessaoId]
        );

        res.json({
            status: "ABERTO",
            caixa,
            resumo: movimentacoes.rows
        });
    } catch (error) {
        console.error("Erro crítico na rota GET /caixa/status:", error);
        res.status(500).json({ 
            error: "Erro interno no servidor ao buscar status do caixa.", 
            detalhe: error.message 
        });
    }
});

// =========================================================================
// 3. REALIZAR MOVIMENTAÇÃO: SANGRIA OU SUPRIMENTO (POST /caixa/movimentacao)
// =========================================================================
router.post("/movimentacao", authMiddleware, async (req, res) => {
    const { idSessao, tipo, valor, observacao } = req.body;

    // Validações de segurança obrigatórias
    if (!idSessao) {
        return res.status(400).json({ error: "O ID da sessão do caixa é obrigatório." });
    }
    if (!["SANGRIA", "SUPRIMENTO", "VENDA_DINHEIRO"].includes(tipo)) {
        return res.status(400).json({ error: "Tipo de movimentação inválido. Use SANGRIA, SUPRIMENTO ou VENDA_DINHEIRO." });
    }
    if (!valor || isNaN(Number(valor)) || Number(valor) <= 0) {
        return res.status(400).json({ error: "O valor da movimentação deve ser um número maior que zero." });
    }

    try {
        // Insere a movimentação de entrada ou saída na tabela
        const query = `
            INSERT INTO "CaixaMovimentacao" ("IdSessao", "Tipo", "Valor", "Observacao")
            VALUES ($1, $2, $3, $4)
            RETURNING *
        `;
        const result = await db.query(query, [
            idSessao, 
            tipo, 
            Number(valor), 
            observacao || `Movimentação de ${tipo}`
        ]);

        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error("Erro crítico na rota POST /caixa/movimentacao:", error);
        res.status(500).json({ 
            error: "Erro interno no servidor ao registrar movimentação.",
            detalhe: error.message 
        });
    }
});

// =========================================================================
// 4. FECHAR CAIXA (POST /caixa/fechar)
// =========================================================================
router.post("/fechar", authMiddleware, async (req, res) => {
    const { idSessao, valorFechamentoDinheiro } = req.body;

    if (!idSessao) {
        return res.status(400).json({ error: "O ID da sessão é obrigatório para realizar o encerramento." });
    }
    if (valorFechamentoDinheiro === undefined || isNaN(Number(valorFechamentoDinheiro))) {
        return res.status(400).json({ error: "Informe o valor total em dinheiro contado na gaveta." });
    }

    try {
        // Altera o status para FECHADO, salva o valor contado e carimba o timestamp do encerramento
        const query = `
            UPDATE "CaixaSessao" 
            SET "Status" = 'FECHADO', "DataFechamento" = NOW(), "ValorFechamentoDinheiro" = $1
            WHERE "Id" = $2 AND "Status" = 'ABERTO'
            RETURNING *
        `;
        const result = await db.query(query, [Number(valorFechamentoDinheiro), idSessao]);

        // Se a query retornou 0 linhas alteradas, significa que a sessão já foi fechada ou o ID está errado
        if (result.rows.length === 0) {
            return res.status(400).json({ error: "Sessão de caixa não encontrada ou já encerrada anteriormente." });
        }

        res.json({ 
            message: "Caixa fechado com sucesso!", 
            caixa: result.rows[0] 
        });
    } catch (error) {
        console.error("Erro crítico na rota POST /caixa/fechar:", error);
        res.status(500).json({ 
            error: "Erro interno no servidor ao fechar o caixa.",
            detalhe: error.message 
        });
    }
});

export default router;