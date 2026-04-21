const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { PDFDocument } = require("pdf-lib");

// Inicializa Firebase Admin UNA sola vez
admin.initializeApp();

// Referencias reutilizables
const db = admin.firestore();
const bucket = admin.storage().bucket();

/*
  FUNCIÓN DE PRUEBA / BASE
  -------------------------------------------------------
  Por ahora solo deja lista la infraestructura.
  Más adelante aquí pondremos la lógica real para:
  - recibir el PDF base desde el frontend
  - descargar el Programa PDF desde Storage
  - unir ambos PDFs
  - guardar el PDF final
  - actualizar Firestore
  - registrar historial
  - encolar correo
*/
exports.cerrarFichaPdfOficial = functions.https.onRequest(async (req, res) => {
  try {
    // Permitimos solo POST
    if (req.method !== "POST") {
      return res.status(405).json({
        ok: false,
        error: "Método no permitido. Usa POST."
      });
    }

    // Respuesta simple de prueba
    return res.status(200).json({
      ok: true,
      message: "Cloud Function cerrarFichaPdfOficial creada correctamente.",
      projectBucket: bucket.name || "",
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("[cerrarFichaPdfOficial]", error);

    return res.status(500).json({
      ok: false,
      error: error?.message || "Error interno en la Cloud Function."
    });
  }
});
