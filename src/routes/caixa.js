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

// 5. HISTÓRICO DE CAIXAS (GET /api/caixa/historico)
// Traz as sessões fechadas calculando de forma isolada para evitar duplicações por agrupamento
router.get("/historico", authMiddleware, async (req, res) => {
    try {
        const query = `
            SELECT 
                s."Id",
                s."DataAbertura",
                s."DataFechamento",
                s."ValorInicial",
                s."ValorFechamentoDinheiro" AS "ValorInformado",
                COALESCE((SELECT SUM("Valor") FROM "CaixaMovimentacao" WHERE "IdSessao" = s."Id" AND "Tipo" = 'SUPRIMENTO'), 0) AS "TotalSuprimentos",
                COALESCE((SELECT SUM("Valor") FROM "CaixaMovimentacao" WHERE "IdSessao" = s."Id" AND "Tipo" = 'SANGRIA'), 0) AS "TotalSangrias",
                COALESCE((SELECT SUM("Valor") FROM "CaixaMovimentacao" WHERE "IdSessao" = s."Id" AND "Tipo" = 'VENDA_DINHEIRO'), 0) AS "TotalVendas"
            FROM "CaixaSessao" s
            WHERE s."Status" = 'FECHADO'
            ORDER BY s."DataFechamento" DESC
        `;

        const result = await db.query(query);

        // Processa a diferença para saber se faltou ou sobrou dinheiro na gaveta
        const historicoFormatado = result.rows.map(caixa => {
            const valorInicial = Number(caixa.ValorInicial);
            const totalSuprimentos = Number(caixa.TotalSuprimentos);
            const totalSangrias = Number(caixa.TotalSangrias);
            const totalVendas = Number(caixa.TotalVendas);
            const valorInformado = Number(caixa.ValorInformado);

            // Cálculo do Saldo Estimado correto por sessão
            const saldoEstimado = valorInicial + totalSuprimentos + totalVendas - totalSangrias;
            const diferenca = valorInformado - saldoEstimado;

            return {
                Id: caixa.Id,
                DataAbertura: caixa.DataAbertura,
                DataFechamento: caixa.DataFechamento,
                ValorInicial: valorInicial,
                ValorInformado: valorInformado,
                TotalSuprimentos: totalSuprimentos,
                TotalSangrias: totalSangrias,
                TotalVendas: totalVendas,
                SaldoEstimado: saldoEstimado,
                Diferenca: diferenca, 
                ResultadoFechamento: diferenca === 0 ? "OK" : diferenca < 0 ? "QUEBRA" : "SOBRA"
            };
        });

        res.json(historicoFormatado);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Erro ao buscar histórico do caixa." });
    }
});

// ==========================================
// ADICIONADO: NOVA ROTA EXCLUSIVA PARA O MODAL
// 6. BUSCAR MOVIMENTAÇÕES DE UMA SESSÃO (GET /api/caixa/movimentacoes/:idSessao)
// ==========================================
router.get("/movimentacoes/:idSessao", authMiddleware, async (req, res) => {
    const { idSessao } = req.params;

    try {
        const query = `
            SELECT 
                "Id", 
                "Tipo", 
                "Valor", 
                "Observacao",
                "DataCriacao"
            FROM "CaixaMovimentacao"
            WHERE "IdSessao" = $1
            ORDER BY "Id" ASC
        `;
        const result = await db.query(query, [idSessao]);
        
        res.json(result.rows);
    } catch (error) {
        console.error("Erro ao carregar movimentações do modal:", error);
        res.status(500).json({ error: "Erro ao carregar os detalhes do caixa selecionado." });
    }
});

export default router;