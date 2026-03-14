// backend/src/routes/frete.js
const express = require("express");
const axios = require("axios");

const router = express.Router();

// Função para gerar token sandbox
async function gerarToken() {
  try {
    const res = await axios.post(
      "https://sandbox.melhorenvio.com.br/api/v2/login",
      {
        client_id: "23152", // seu Client ID
        client_secret: "RYSzcXPflXCoN2PmDQp45cSp9LIggYvXC4rcPRyV" // seu Secret
      }
    );
    return res.data.access_token;
  } catch (err) {
    console.error("Erro ao gerar token:", err.response?.data || err);
    throw err;
  }
}

// POST /frete
router.post("/", async (req, res) => {
  try {
    const token = await gerarToken();
    const { cepDestino, pacotes } = req.body;

    if (!cepDestino || !pacotes) {
      return res.status(400).json({ error: "cepDestino e pacotes são obrigatórios" });
    }

    const response = await axios.post(
      "https://sandbox.melhorenvio.com.br/api/v2/me/shipment/calculate",
      {
        from: { postal_code: "26587000" }, // CEP da loja
        to: { postal_code: cepDestino.replace(/\D/g, "") },
        parcels: pacotes, // precisa ser parcels
        options: { receipt: false, own_hand: false },
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );

    // Retorna o menor valor
    const menorFrete = Math.min(...response.data.map(c => c.price));

    res.json({ valor: menorFrete });
  } catch (err) {
    console.error("Erro ao calcular frete:", err.response?.data || err);
    res.status(500).json({ error: "Erro ao calcular frete" });
  }
});

module.exports = router;