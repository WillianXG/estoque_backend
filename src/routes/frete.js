import express from "express";
import axios from "axios";

const router = express.Router();

// Função para gerar token sandbox
async function gerarToken() {
  try {
    const res = await axios.post(
      "https://sandbox.melhorenvio.com.br/api/v2/oauth/token",
      {
        grant_type: "client_credentials",
        client_id: "23152", // seu Client ID
        client_secret: "RYSzcXPflXCoN2PmDQp45cSp9LIggYvXC4rcPRyV" // seu Secret
      }
    );
    return res.data.access_token;
  } catch (err) {
    console.error("Erro ao gerar token:", err.response?.data || err.message);
    throw err;
  }
}

// Endpoint para calcular frete
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
        to: { postal_code: cepDestino },
        packages: pacotes,
        options: { receipt: false, own_hand: false },
        services: "1,2,18" // PAC, SEDEX e transportadoras integradas
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );

    res.json(response.data);
  } catch (err) {
    console.error("Erro ao calcular frete:", err.response?.data || err.message);
    res.status(500).json({ error: "Erro ao calcular frete" });
  }
});

export default router;