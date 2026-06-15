import { initializeApp } from "https://www.gstatic.com/firebasejs/11.7.3/firebase-app.js";
import {
  getFirestore,
  doc,
  getDoc,
  collection,
  getDocs,
  query,
  where
} from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAdx9nVcV-UiGER3mcz-w9BcSSIZd-t5nE",
  authDomain: "sist-op-rt.firebaseapp.com",
  projectId: "sist-op-rt",
  storageBucket: "sist-op-rt.firebasestorage.app",
  messagingSenderId: "438607695630",
  appId: "1:438607695630:web:f5a16f319e3ea17fbfd15f"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const $ = (id) => document.getElementById(id);

init();

async function init() {
  try {
    const params = new URLSearchParams(location.search);
    const token = String(params.get("t") || "").trim();

    if (!token) {
      renderError("Link inválido. Falta el token de acceso.");
      return;
    }

    const tokenSnap = await getDoc(doc(db, "nominas_publicas", token));

    if (!tokenSnap.exists()) {
      renderError("La nómina no existe o el link fue reemplazado.");
      return;
    }

    const tokenData = tokenSnap.data();

    if (tokenData.activo === false) {
      renderError("Esta nómina ya no está activa.");
      return;
    }

    const groupDocId = String(tokenData.groupDocId || "").trim();

    if (!groupDocId) {
      renderError("El link no tiene grupo asociado.");
      return;
    }

    const grupoSnap = await getDoc(doc(db, "ventas_cotizaciones", groupDocId));

    if (!grupoSnap.exists()) {
      renderError("No fue posible encontrar el grupo asociado a esta nómina.");
      return;
    }

    const grupo = grupoSnap.data() || {};

    const inscSnap = await getDocs(
      query(
        collection(db, "inscripciones_pendientes_publicas"),
        where("idGrupo", "==", groupDocId)
      )
    );
    
    let pasajeros = inscSnap.docs
      .map((d) => ({
        id: d.id,
        ...d.data()
      }))
        .filter((item) => item?.estado !== "eliminada_logica")
        .filter((item) => item?.payload?.privacidad?.estado !== "eliminada_logica")
        .filter((item) => item?.payload?.privacidad?.estado !== "archivada")
        .map((item) => {
        const payload = item.payload || {};
        const fechaOriginal = getFechaFormularioInscripcion(payload) || item.creadoEn;

        return {
          nombre: getNombrePublicoInscripcion(payload),
          rutKey: getRutKeyInscripcion(payload),
          fechaInscripcion: formatPublicDateTime(fechaOriginal),
          fechaOrden: getPublicDateTimeMs(fechaOriginal)
        };
      })
      .filter((p) => p.nombre);
      
      pasajeros = deduplicarPasajeros(pasajeros)
        .sort((a, b) => a.fechaOrden - b.fechaOrden);
    
    // Respaldo para links antiguos tipo “foto”
    if (!pasajeros.length && Array.isArray(tokenData.pasajeros)) {
      pasajeros = tokenData.pasajeros
        .map((p) => ({
          nombre: p.nombre || "",
          fechaInscripcion: p.fechaInscripcion || "—",
          fechaOrden: 0
        }))
        .filter((p) => p.nombre);
    }

    renderNomina({
      ...tokenData,
      colegio: grupo.colegio || tokenData.colegio || "",
      curso: grupo.curso || tokenData.curso || "",
      anoViaje: grupo.anoViaje || tokenData.anoViaje || "",
      destino: grupo.destinoPrincipal || grupo.destino || tokenData.destino || "",
      nombreGrupo:
        grupo.aliasGrupo ||
        grupo.nombreGrupo ||
        grupo.colegio ||
        tokenData.nombreGrupo ||
        "Nómina del grupo",
      pasajeros
    });
  } catch (error) {
    console.error("[nomina pública]", error);
    renderError("Ocurrió un error al cargar la nómina.");
  }
}

function renderNomina(data = {}) {
  $("tituloNomina").textContent = String(data.nombreGrupo || "Nómina del grupo").toUpperCase();

  $("subtituloNomina").textContent = [
    data.colegio,
    data.curso,
    data.anoViaje ? `Año ${data.anoViaje}` : "",
    data.destino
  ].filter(Boolean).join(" · ");

  $("datosGrupoNomina").innerHTML = `
    <div class="info-box">
      <div class="label">Colegio</div>
      <div class="value">${escapeHtml(data.colegio || "—")}</div>
    </div>

    <div class="info-box">
      <div class="label">Curso</div>
      <div class="value">${escapeHtml(data.curso || "—")}</div>
    </div>

    <div class="info-box">
      <div class="label">Año viaje</div>
      <div class="value">${escapeHtml(data.anoViaje || "—")}</div>
    </div>
  `;

  const pasajeros = Array.isArray(data.pasajeros) ? data.pasajeros : [];

  $("tablaNominaPublica").innerHTML = pasajeros.length
    ? pasajeros.map((p, i) => `
        <tr>
          <td style="text-align:center;">${i + 1}</td>
          <td>${escapeHtml(String(p.nombre || "").toUpperCase())}</td>
          <td>${escapeHtml(p.fechaInscripcion || "—")}</td>
        </tr>
      `).join("")
    : `<tr><td colspan="3">No hay pasajeros inscritos actualmente.</td></tr>`;
}

function getNombrePublicoInscripcion(item = {}) {
  const identificacion = item.identificacion || {};

  const nombreCompleto = [
    identificacion.nombres || item.nombres,
    identificacion.primerApellido || item.primerApellido,
    identificacion.segundoApellido || item.segundoApellido
  ].filter(Boolean).join(" ");

  return cleanText(
    nombreCompleto ||
    identificacion.nombreCompleto ||
    item.nombreCompleto ||
    item.nombre ||
    item.pasajero ||
    ""
  );
}

function getFechaFormularioInscripcion(item = {}) {
  return (
    item?.meta?.fechaInscripcion ||
    item?.meta?.fechaFormularioCliente ||
    item?.fechaInscripcion ||
    item?.fechaFormularioCliente ||
    item?.creadoEn ||
    item?.createdAt ||
    item?.fechaCreacion ||
    item?.fechaAprobacion ||
    ""
  );
}

function formatPublicDateTime(value) {
  const d = toDate(value);
  if (!d) return "—";

  return d.toLocaleString("es-CL", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function getPublicDateTimeMs(value) {
  const d = toDate(value);
  return d ? d.getTime() : 0;
}

function toDate(value) {
  if (!value) return null;
  if (value?.toDate) return value.toDate();
  if (value instanceof Date) return value;

  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function renderError(msg) {
  $("tituloNomina").textContent = "No fue posible cargar la nómina";
  $("subtituloNomina").textContent = msg;
  $("datosGrupoNomina").innerHTML = "";
  $("tablaNominaPublica").innerHTML = "";
}

function cleanText(value = "") {
  return String(value ?? "").trim();
}

function deduplicarPasajeros(lista = []) {
  const map = new Map();

  lista.forEach((p) => {
    // Primero intenta deduplicar por RUT/documento.
    // Si no tiene RUT, usa nombre normalizado como respaldo.
    const key = p.rutKey || normalizarNombreParaComparar(p.nombre);

    if (!key) return;

    const existente = map.get(key);

    // Si ya existe, conserva el registro más reciente.
    if (!existente || p.fechaOrden > existente.fechaOrden) {
      map.set(key, p);
    }
  });

  return Array.from(map.values());
}

function getRutKeyInscripcion(item = {}) {
  const identificacion = item.identificacion || {};

  const documento =
    identificacion.documentoNormalizado ||
    identificacion.rut ||
    identificacion.documento ||
    [
      identificacion.rutNumero,
      identificacion.rutDv
    ].filter(Boolean).join("-") ||
    item.documentoNormalizado ||
    item.rut ||
    item.documento ||
    "";

  return normalizarRutKey(documento);
}

function normalizarRutKey(value = "") {
  return String(value || "")
    .toUpperCase()
    .replace(/\./g, "")
    .replace(/-/g, "")
    .replace(/\s+/g, "")
    .trim();
}

function normalizarNombreParaComparar(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

function escapeHtml(value = "") {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
