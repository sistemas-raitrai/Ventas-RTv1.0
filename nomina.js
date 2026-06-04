import { initializeApp } from "https://www.gstatic.com/firebasejs/11.7.3/firebase-app.js";
import {
  getFirestore,
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "COPIA_AQUI_TU_API_KEY_REAL",
  authDomain: "COPIA_AQUI_TU_AUTH_DOMAIN_REAL",
  projectId: "COPIA_AQUI_TU_PROJECT_ID_REAL",
  storageBucket: "COPIA_AQUI_TU_STORAGE_BUCKET_REAL",
  messagingSenderId: "COPIA_AQUI_TU_MESSAGING_SENDER_ID_REAL",
  appId: "COPIA_AQUI_TU_APP_ID_REAL"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const $ = (id) => document.getElementById(id);

init();

async function init() {
  const params = new URLSearchParams(location.search);
  const token = String(params.get("t") || "").trim();

  if (!token) {
    renderError("Link inválido. Falta el token de acceso.");
    return;
  }

  const snap = await getDoc(doc(db, "nominas_publicas", token));

  if (!snap.exists()) {
    renderError("La nómina no existe o el link fue reemplazado.");
    return;
  }

  const data = snap.data();

  if (data.activo === false) {
    renderError("Esta nómina ya no está activa.");
    return;
  }

  renderNomina(data);
}

function renderNomina(data = {}) {
  $("tituloNomina").textContent = data.nombreGrupo || "Nómina del grupo";

  $("subtituloNomina").textContent = [
    data.colegio,
    data.curso,
    data.anoViaje ? `Año ${data.anoViaje}` : "",
    data.destino
  ].filter(Boolean).join(" · ");

  $("datosGrupoNomina").innerHTML = `
    <div class="grupo-data-card is-strong">
      <div class="info-label">Colegio</div>
      <div class="info-value">${escapeHtml(data.colegio || "—")}</div>
    </div>

    <div class="grupo-data-card is-strong">
      <div class="info-label">Curso</div>
      <div class="info-value">${escapeHtml(data.curso || "—")}</div>
    </div>

    <div class="grupo-data-card is-strong">
      <div class="info-label">Año viaje</div>
      <div class="info-value">${escapeHtml(data.anoViaje || "—")}</div>
    </div>
  `;

  const pasajeros = Array.isArray(data.pasajeros) ? data.pasajeros : [];

  $("tablaNominaPublica").innerHTML = pasajeros.length
    ? pasajeros.map((p, i) => `
        <tr>
          <td style="text-align:center;">${i + 1}</td>
          <td>${escapeHtml(p.nombre || "")}</td>
        </tr>
      `).join("")
    : `<tr><td colspan="2">No hay pasajeros publicados.</td></tr>`;
}

function renderError(msg) {
  $("tituloNomina").textContent = "No fue posible cargar la nómina";
  $("subtituloNomina").textContent = msg;
  $("tablaNominaPublica").innerHTML = "";
}

function escapeHtml(value = "") {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
