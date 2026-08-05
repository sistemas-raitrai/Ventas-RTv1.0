import {
  auth,
  db
} from "./firebase-init.js";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  where
} from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.7.3/firebase-auth.js";

const $ = (id) => document.getElementById(id);

const state = {
  negocio: "",
  autorizado: false,
  firebaseUser: null
};

init();

function init() {
  bindEvents();

  onAuthStateChanged(auth, (user) => {
    state.firebaseUser = user || null;
  });

  const negocioUrl = new URLSearchParams(location.search).get("negocio");

  if (negocioUrl) {
    $("claveNegocio").value = negocioUrl;
  }

  comprobarCompatibilidad();
}

function bindEvents() {
  $("btnValidarClave")?.addEventListener("click", validarClave);
  $("btnCerrarSesionGrupo")?.addEventListener("click", cerrarSesionGrupo);
  $("btnEscanearNfc")?.addEventListener("click", escanearNfc);
  $("btnBuscarManual")?.addEventListener("click", buscarCodigoManual);

  $("claveNegocio")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      validarClave();
    }
  });

  $("codigoManual")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      buscarCodigoManual();
    }
  });
}

async function validarClave() {
  const negocio = sanearCodigo($("claveNegocio").value);

  if (!negocio) {
    setEstado("Ingresa el número de negocio.", true);
    return;
  }

  setEstado("Validando grupo...");

  try {
    const snap = await getDocs(
      query(
        collection(db, "ventas_pulseras_nfc"),
        where("numeroNegocio", "==", negocio),
        where("activa", "==", true),
        limit(1)
      )
    );

    if (snap.empty) {
      throw new Error(
        "No hay pulseras activas asociadas a ese número de negocio."
      );
    }

    state.negocio = negocio;
    state.autorizado = true;

    $("claveNegocio").disabled = true;
    $("btnValidarClave").classList.add("hidden");
    $("btnCerrarSesionGrupo").classList.remove("hidden");
    $("readerPanel").classList.remove("hidden");

    setEstado(`Acceso habilitado para el negocio ${negocio}.`, false, true);
  } catch (error) {
    console.error("[leer-pulsera-nfc] validarClave", error);

    setEstado(
      error.message ||
      "No se pudo validar el número de negocio. Revisa los permisos de Firestore.",
      true
    );
  }
}

function cerrarSesionGrupo() {
  state.negocio = "";
  state.autorizado = false;

  $("claveNegocio").disabled = false;
  $("claveNegocio").value = "";
  $("codigoManual").value = "";

  $("btnValidarClave").classList.remove("hidden");
  $("btnCerrarSesionGrupo").classList.add("hidden");
  $("readerPanel").classList.add("hidden");
  $("resultadoPanel").classList.add("hidden");

  setEstado("Ingresa la clave para comenzar.");
}

async function escanearNfc() {
  if (!state.autorizado) {
    setEstado("Primero debes ingresar la clave del grupo.", true);
    return;
  }

  if (!("NDEFReader" in window)) {
    setEstado(
      "Este navegador no soporta Web NFC. Usa Chrome en Android o prueba ingresando el código manualmente.",
      true
    );
    return;
  }

  setEstado("Acerca la pulsera al teléfono...");

  try {
    const ndef = new NDEFReader();
    await ndef.scan();

    const controller = new AbortController();

    ndef.addEventListener(
      "readingerror",
      () => {
        setEstado("No se pudo leer la pulsera. Inténtalo nuevamente.", true);
      },
      {
        signal: controller.signal
      }
    );

    ndef.addEventListener(
      "reading",
      async ({ message }) => {
        const codigo = extraerTextoNdef(message);

        if (!codigo) {
          setEstado("La pulsera no contiene un código de texto válido.", true);
          return;
        }

        controller.abort();
        await buscarCodigo(codigo);
      },
      {
        signal: controller.signal
      }
    );
  } catch (error) {
    console.error("[leer-pulsera-nfc] escanearNfc", error);
    setEstado(error.message || "No se pudo iniciar la lectura NFC.", true);
  }
}

async function buscarCodigoManual() {
  const codigo = $("codigoManual").value;
  await buscarCodigo(codigo);
}

async function buscarCodigo(codigoRaw) {
  if (!state.autorizado) {
    setEstado("Primero debes ingresar la clave del grupo.", true);
    return;
  }

  const codigo = sanearCodigoCompleto(codigoRaw);

  if (!codigo) {
    setEstado("No se recibió un código válido.", true);
    return;
  }

  setEstado(`Buscando ${codigo}...`);

  try {
    const snap = await getDoc(
      doc(db, "ventas_pulseras_nfc", codigo)
    );

    if (!snap.exists()) {
      throw new Error("El código no está registrado.");
    }

    const data = snap.data() || {};

    if (data.activa === false) {
      throw new Error("La pulsera está desactivada.");
    }

    if (sanearCodigo(data.numeroNegocio) !== state.negocio) {
      throw new Error(
        "La pulsera pertenece a otro grupo y no puede verse con esta clave."
      );
    }

    renderResultado({
      id: snap.id,
      ...data
    });

    setEstado("Pulsera identificada correctamente.", false, true);
  } catch (error) {
    console.error("[leer-pulsera-nfc] buscarCodigo", error);
    $("resultadoPanel").classList.add("hidden");
    setEstado(error.message || "No se pudo consultar la pulsera.", true);
  }
}

function renderResultado(data = {}) {
  $("resultadoCodigo").textContent = data.codigo || data.id || "—";

  const individual = data.modalidad === "individual";

  const filas = [
    ["Modalidad", individual ? "Individual" : "Grupal"],
    ["Grupo", data.aliasGrupo || data.colegio || "—"],
    ["Negocio", data.numeroNegocio || "—"],
    ["Año", data.anoViaje || "—"],
    ["Destino", data.destino || "—"]
  ];

  if (individual) {
    filas.push(
      ["Pasajero", data.nombrePasajero || "—"],
      ["RUT", data.rut || "—"],
      ["Inscripción", data.inscripcionId || "—"]
    );
  } else {
    filas.push(
      ["Información", "Pulsera general del grupo"]
    );
  }

  $("resultadoDatos").innerHTML = filas.map(([label, value]) => `
    <div class="data-card">
      <span>${esc(label)}</span>
      <strong>${esc(value)}</strong>
    </div>
  `).join("");

  $("resultadoPanel").classList.remove("hidden");
}

function extraerTextoNdef(message) {
  for (const record of message.records || []) {
    if (record.recordType !== "text") {
      continue;
    }

    try {
      return new TextDecoder(record.encoding || "utf-8")
        .decode(record.data)
        .trim();
    } catch {
      return "";
    }
  }

  return "";
}

function comprobarCompatibilidad() {
  if (!("NDEFReader" in window)) {
    setEstado(
      "Web NFC no está disponible aquí. Puedes probar escribiendo el código manualmente."
    );
  }
}

function setEstado(mensaje, error = false, ok = false) {
  const box = $("readerEstado");
  box.textContent = mensaje;
  box.classList.toggle("error", error);
  box.classList.toggle("ok", ok);
}

function sanearCodigo(valor = "") {
  return String(valor)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function sanearCodigoCompleto(valor = "") {
  return String(valor)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "");
}

function esc(valor = "") {
  return String(valor)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
