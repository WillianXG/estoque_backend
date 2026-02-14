import express from "express";
import db from "../db.js";

const router = express.Router();

// Listar todas as vendedoras
router.get("/", async (_, res) => {
  try {
    const result = await db.query("SELECT * FROM vendedoras ORDER BY nome");
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao buscar vendedoras" });
  }
});

// Criar nova vendedora
router.post("/", async (req, res) => {
  const { nome, telefone, role = "vendedora" } = req.body;

  if (!nome) return res.status(400).json({ erro: "Nome obrigatório" });
  if (!telefone) return res.status(400).json({ erro: "Telefone obrigatório" });

  try {
    // Gera código único tipo VEND-0001
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
      if (!existe) codigo = `VEND-${numero}`;
    }

    const result = await db.query(
      `
      INSERT INTO vendedoras (nome, telefone, codigo, role)
      VALUES ($1, $2, $3, $4)
      RETURNING *
      `,
      [nome, telefone, codigo, role]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao criar vendedora" });
  }
});

// Atualizar vendedora
router.put("/:id", async (req, res) => {
  const { id } = req.params;
  const { nome, telefone, role } = req.body;

  if (!nome || !telefone || !role) {
    return res.status(400).json({ erro: "Dados inválidos" });
  }

  try {
    const result = await db.query(
      `
      UPDATE vendedoras
      SET nome = $1, telefone = $2, role = $3
      WHERE id = $4
      RETURNING *
      `,
      [nome, telefone, role, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ erro: "Vendedora não encontrada" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao atualizar vendedora" });
  }
});

// Deletar vendedora
router.delete("/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const result = await db.query(
      "DELETE FROM vendedoras WHERE id = $1 RETURNING *",
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ erro: "Vendedora não encontrada" });
    }

    res.json({ mensagem: "Vendedora removida com sucesso" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao remover vendedora" });
  }
});

export default router;