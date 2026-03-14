// backend/src/routes/frete.js
import express from "express";
import axios from "axios";

const router = express.Router();

async function gerarToken() {
  const res = await axios.post(
    "https://sandbox.melhorenvio.com.br/api/v2/oauth/token",
    {
      grant_type: "client_credentials",
      client_id: "23152",
      client_secret: "RYSzcXPflXCoN2PmDQp45cSp9LIggYvXC4rcPRyV"
    }
  );
  return res.data.access_token;
}

router.post("/", async (req, res) => {
  try {
    const token = await gerarToken();
    const { cepDestino, pacotes } = req.body;

    if (!cepDestino || !pacotes || pacotes.length === 0) {
      return res.status(400).json({ error: "cepDestino e pacotes são obrigatórios" });
    }

    // Certifica que CEP só tem números
    const cepLimpo = cepDestino.replace(/\D/g, "");

    // Map pacotes para o formato correto
    const parcels = pacotes.map(p => ({
      weight: p.weight || 0.3,
      length: p.length || 20,
      height: p.height || 10,
      width: p.width || 15
    }));

    const response = await axios.post(
      "https://sandbox.melhorenvio.com.br/api/v2/me/shipment/calculate",
      {
        from: { postal_code: "26587000" },
        to: { postal_code: cepLimpo },
        parcels,
        options: { receipt: false, own_hand: false }
      },
      { headers: { Authorization: `Bearer ${token}` } }
    );

    res.json(response.data);
  } catch (err) {
    console.error("Erro Melhor Envio:", err.response?.data || err.message);
    res.status(500).json({ error: "Erro ao calcular frete" });
  }
});

export default router;