import express from "express";
import db from "../db.js";

const router = express.Router();

router.get("/", async (_, res) => {
  const r = await db.query("SELECT * FROM vendedoras");
  res.json(r.rows);
});

router.post("/", async (req, res) => {
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

router.put("/:id", async (req, res) => {
  const { id } = req.params;
  const { nome, codigo, telefone } = req.body;

  if (!nome || !codigo || !telefone) {
    return res.status(400).json({ erro: "Dados inválidos" });
  }

  try {
    const result = await pool.query(
      `
      UPDATE vendedoras
      SET nome = $1, codigo = $2, telefone = $3
      WHERE id = $4
      RETURNING *
      `,
      [nome, codigo, telefone, id]
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

router.delete("/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
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
