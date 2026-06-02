import { GoogleAuth } from "google-auth-library";

const FUNCTION_URL =
  "https://southamerica-west1-sist-op-rt.cloudfunctions.net/apiPagos";

export default async function handler(req, res) {
  try {
    const query = new URLSearchParams(req.query).toString();
    const url = `${FUNCTION_URL}?${query}`;

    const auth = new GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n")
      }
    });

    const client = await auth.getIdTokenClient(FUNCTION_URL);
    const response = await client.request({ url });

    res.status(200).json(response.data);

  } catch (error) {
    console.error("Error proxy pagos:", error);

    res.status(500).json({
      ok: false,
      error: "Error consultando proxy de pagos",
      detalle: error.message
    });
  }
}
