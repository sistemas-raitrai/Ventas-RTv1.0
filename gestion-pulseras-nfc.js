import {
  auth,
  db,
  normalizeEmail,
  getVentasUser
} from "./firebase-init.js";

import {
  collection,
  doc,
  getDocs,
  query,
  setDoc,
  serverTimestamp,
  where
} from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";

import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/11.7.3/firebase-auth.js";

import {
  ACTING_USER_KEY,
  getRealUser,
  getEffectiveUser
} from "./roles.js";

import {
  bindLayoutButtons,
  waitForLayoutReady
} from "./ui.js";

import {
  crearInscripcionesManager,
  camposPasajero
} from "./inscripciones-manager.js";

const $ = (id) => document.getElementById(id);

const state = {
  user: null,
  realUser: null,
  email: "",
  manager: null,

  grupoId: "",
  grupo: null,
  nomina: [],
  viajan: [],

  modalidad: "individual",
  lote: [],
  indice: 0,
  guardando: false
};

init();

async function init() {
  await waitForLayoutReady();
  bindEvents();

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      location.href = "login.html";
      return;
    }

    await bootstrap();
    bindHeader();
    await cargarGrupoDesdeUrl();
  });
}

async function bootstrap() {
  state.realUser = getRealUser();
  state.user = getEffectiveUser();

  const resolved = getVentasUser(
    state.user?.email ||
    state.realUser?.email ||
    auth.currentUser?.email ||
    ""
  );

  if (resolved) {
    state.user = {
      ...state.user,
      ...resolved
    };
  }

  state.email = normalizeEmail(
    state.user?.email ||
    auth.currentUser?.email ||
    ""
  );

  state.manager = crearInscripcionesManager({
    db,
    usuario: state.user
  });
}

function bindHeader() {
  bindLayoutButtons({
    homeUrl: "index.html",

    onLogout: async () => {
      sessionStorage.removeItem(ACTING_USER_KEY);
      await signOut(auth);
      location.href = "login.html";
    }
  });
}

function bindEvents() {
  $("btnVolverNomina")?.addEventListener("click", () => {
    location.href = "gestion-nomina.html";
  });

  $("btnLeerPulsera")?.addEventListener("click", () => {
    const negocio = numeroNegocioActual();
    window.open(
      `leer-pulsera-nfc.html?negocio=${encodeURIComponent(negocio)}`,
      "_blank",
      "noopener"
    );
  });

  $("nfcModalidad")?.addEventListener("change", () => {
    state.modalidad = $("nfcModalidad").value;
    $("nfcCantidadGrupal").disabled = state.modalidad !== "grupal";
    limpiarLote();
  });

  $("btnGenerarCodigos")?.addEventListener("click", generarCodigos);
  $("btnGuardarAsociaciones")?.addEventListener("click", guardarAsociaciones);
  $("btnGrabarActual")?.addEventListener("click", grabarActual);
  $("btnAnterior")?.addEventListener("click", () => moverIndice(-1));
  $("btnSiguiente")?.addEventListener("click", () => moverIndice(1));

  $("nfcTbody")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-indice]");
    if (!button) return;

    state.indice = Number(button.dataset.indice || 0);
    renderActual();
    renderTabla();
  });
}

async function cargarGrupoDesdeUrl() {
  const params = new URLSearchParams(location.search);

  state.grupoId = String(
    params.get("id") ||
    params.get("grupo") ||
    ""
  ).trim();

  if (!state.grupoId) {
    setEstado("Falta el identificador del grupo en la URL.", true);
    $("nfcTbody").innerHTML = `
      <tr><td colspan="6">Abre esta página desde Gestión de Nómina.</td></tr>
    `;
    return;
  }

  try {
    state.grupo = await state.manager.resolverGrupo(state.grupoId);

    if (!state.grupo) {
      throw new Error("No se encontró el grupo.");
    }

    state.nomina = await state.manager.cargarNomina(state.grupo);
    state.viajan = state.nomina.filter(esPasajeroQueViaja);

    const g = state.grupo.data || {};

    $("nfcSubtitulo").textContent =
      `${g.aliasGrupo || g.colegio || "Grupo"} · ` +
      `Negocio ${numeroNegocioActual()} · ` +
      `${state.viajan.length} pasajero(s) que viajan`;

    $("kViajan").textContent = String(state.viajan.length);

    comprobarCompatibilidad();
    renderTablaInicial();
  } catch (error) {
    console.error("[gestion-pulseras-nfc] cargarGrupoDesdeUrl", error);
    setEstado(error.message || "No se pudo cargar el grupo.", true);
  }
}

function esPasajeroQueViaja(item = {}) {
  if (camposPasajero.estaAnulada(item)) {
    return false;
  }

  const estadoViaje = normalizar(
    item.estadoViaje ||
    item.viajeEstado ||
    item.estado ||
    ""
  ).replace(/\s+/g, "_");

  if (
    item.viaja === false ||
    item.noViaja === true ||
    ["no_viaja", "anulado", "anulada", "eliminado", "eliminada"].includes(estadoViaje)
  ) {
    return false;
  }

  const tipo = normalizar(
    camposPasajero.tipo(item) ||
    item.tipoInscripcion ||
    ""
  ).replace(/\s+/g, "_");

  const estadoCupo = normalizar(
    item.estadoCupo ||
    item.estadoConfirmacion ||
    ""
  ).replace(/\s+/g, "_");

  if (
    ["nuevo_ingreso", "nuevos"].includes(tipo) &&
    !["confirmado", "confirmada", "aprobado", "aprobada"].includes(estadoCupo) &&
    item.nuevoIngresoConfirmado !== true
  ) {
    return false;
  }

  if (
    ["lista_espera", "lista_de_espera"].includes(tipo) &&
    !["confirmado", "confirmada"].includes(estadoCupo) &&
    item.listaEsperaConfirmada !== true
  ) {
    return false;
  }

  return true;
}

function generarCodigos() {
  if (!state.grupo || !state.viajan.length) {
    setEstado("El grupo no tiene pasajeros disponibles para generar.", true);
    return;
  }

  state.modalidad = $("nfcModalidad").value;

  if (state.modalidad === "grupal") {
    const cantidad = Math.max(
      1,
      Number($("nfcCantidadGrupal").value || state.viajan.length)
    );

    const codigo = `${sanearCodigo(numeroNegocioActual())}-GRUPO`;

    state.lote = Array.from({ length: cantidad }, (_, index) => ({
      indice: index,
      numero: index + 1,
      codigo,
      modalidad: "grupal",
      inscripcionId: "",
      rut: "",
      nombre: `Pulsera grupal ${index + 1}`,
      grabada: false,
      verificada: false
    }));
  } else {
    state.lote = state.viajan.map((item, index) => {
      const nombre = camposPasajero.nombres(item);
      const apellido = camposPasajero.apellidos(item);
      const iniciales = obtenerIniciales(nombre, apellido);
      const correlativo = String(index + 1).padStart(3, "0");

      return {
        indice: index,
        numero: index + 1,
        codigo: `${sanearCodigo(numeroNegocioActual())}-${correlativo}-${iniciales}`,
        modalidad: "individual",
        inscripcionId: String(item.id || ""),
        rut: camposPasajero.documento(item),
        nombre: [nombre, apellido].filter(Boolean).join(" ").trim() || "Sin nombre",
        grabada: false,
        verificada: false
      };
    });
  }

  state.indice = 0;
  $("btnGuardarAsociaciones").disabled = false;
  $("btnGrabarActual").disabled = false;

  setEstado(
    `Se generaron ${state.lote.length} código(s). Guarda las asociaciones antes de comenzar.`
  );

  renderTodo();
}

async function guardarAsociaciones() {
  if (!state.lote.length || state.guardando) {
    return;
  }

  state.guardando = true;
  $("btnGuardarAsociaciones").disabled = true;
  setEstado("Guardando asociaciones en Firebase...");

  try {
    const g = state.grupo.data || {};
    const loteId = `${state.grupo.docId}_${Date.now()}`;

    for (const item of state.lote) {
      await setDoc(
        doc(db, "ventas_pulseras_nfc", item.codigo),
        {
          codigo: item.codigo,
          modalidad: item.modalidad,

          groupDocId: state.grupo.docId,
          idGrupo: state.grupo.groupId,
          numeroNegocio: numeroNegocioActual(),
          anoViaje: Number(g.anoViaje || 0),

          aliasGrupo: g.aliasGrupo || "",
          colegio: g.colegio || "",
          curso: g.curso || "",
          destino: g.destino || "",

          inscripcionId: item.inscripcionId,
          rut: item.rut,
          nombrePasajero: item.nombre,

          numeroPulsera: item.numero,
          loteId,

          grabada: item.grabada === true,
          verificada: item.verificada === true,

          activa: true,
          creadoAt: serverTimestamp(),
          creadoPor: nombreUsuario(),
          creadoPorCorreo: state.email
        },
        {
          merge: true
        }
      );
    }

    setEstado("Asociaciones guardadas. Ya puedes comenzar a grabar las pulseras.");
  } catch (error) {
    console.error("[gestion-pulseras-nfc] guardarAsociaciones", error);
    setEstado(error.message || "No se pudieron guardar las asociaciones.", true);
    $("btnGuardarAsociaciones").disabled = false;
  } finally {
    state.guardando = false;
  }
}

async function grabarActual() {
  const item = state.lote[state.indice];

  if (!item) {
    setEstado("No hay una pulsera seleccionada.", true);
    return;
  }

  if (!("NDEFReader" in window)) {
    setEstado(
      "Este navegador no soporta Web NFC. Usa Chrome en un teléfono Android con NFC.",
      true
    );
    return;
  }

  $("btnGrabarActual").disabled = true;
  setEstado(`Acerca una pulsera NFC para grabar ${item.codigo}...`);

  try {
    const ndef = new NDEFReader();

    await ndef.write({
      records: [
        {
          recordType: "text",
          data: item.codigo,
          lang: "es"
        }
      ]
    });

    item.grabada = true;
    item.verificada = true;

    await setDoc(
      doc(db, "ventas_pulseras_nfc", item.codigo),
      {
        grabada: true,
        verificada: true,
        ultimaGrabacionAt: serverTimestamp(),
        ultimaGrabacionPor: nombreUsuario(),
        ultimaGrabacionPorCorreo: state.email
      },
      {
        merge: true
      }
    );

    setEstado(`Pulsera grabada correctamente: ${item.codigo}`, false, true);

    const siguiente = state.lote.findIndex(
      (row, index) => index > state.indice && row.grabada !== true
    );

    if (siguiente >= 0) {
      state.indice = siguiente;
    }

    renderTodo();
  } catch (error) {
    console.error("[gestion-pulseras-nfc] grabarActual", error);

    const mensaje =
      error?.name === "NotAllowedError"
        ? "Permiso NFC rechazado o lectura cancelada."
        : error?.message || "No se pudo grabar la pulsera.";

    setEstado(mensaje, true);
  } finally {
    $("btnGrabarActual").disabled = !state.lote.length;
  }
}

function moverIndice(delta) {
  if (!state.lote.length) return;

  state.indice = Math.min(
    state.lote.length - 1,
    Math.max(0, state.indice + delta)
  );

  renderActual();
  renderTabla();
}

function renderTodo() {
  renderActual();
  renderTabla();
  renderResumen();
}

function renderActual() {
  const item = state.lote[state.indice];

  if (!item) {
    $("writerProgreso").textContent = "Sin lote generado";
    $("writerPersona").textContent = "—";
    $("writerCodigo").textContent = "—";
    $("btnAnterior").disabled = true;
    $("btnSiguiente").disabled = true;
    $("btnGrabarActual").disabled = true;
    return;
  }

  $("writerProgreso").textContent =
    `Pulsera ${state.indice + 1} de ${state.lote.length}`;

  $("writerPersona").textContent = item.nombre;
  $("writerCodigo").textContent = item.codigo;

  $("btnAnterior").disabled = state.indice <= 0;
  $("btnSiguiente").disabled = state.indice >= state.lote.length - 1;
  $("btnGrabarActual").disabled = false;
}

function renderTabla() {
  const tbody = $("nfcTbody");

  if (!state.lote.length) {
    renderTablaInicial();
    return;
  }

  tbody.innerHTML = state.lote.map((item, index) => `
    <tr class="${
      index === state.indice
        ? "row-current"
        : item.grabada
          ? "row-written"
          : ""
    }">
      <td>${item.numero}</td>
      <td><strong>${esc(item.nombre)}</strong></td>
      <td>${esc(item.rut || "—")}</td>
      <td><strong>${esc(item.codigo)}</strong></td>
      <td>
        <span class="pill ${item.grabada ? "ok" : ""}">
          ${item.grabada ? "Grabada" : "Pendiente"}
        </span>
      </td>
      <td>
        <button class="nfc-btn secondary" type="button" data-indice="${index}">
          Seleccionar
        </button>
      </td>
    </tr>
  `).join("");
}

function renderTablaInicial() {
  const tbody = $("nfcTbody");

  if (!state.viajan.length) {
    tbody.innerHTML = `
      <tr><td colspan="6">No hay pasajeros confirmados que viajen.</td></tr>
    `;
    return;
  }

  tbody.innerHTML = state.viajan.map((item, index) => `
    <tr>
      <td>${index + 1}</td>
      <td>
        ${esc([
          camposPasajero.nombres(item),
          camposPasajero.apellidos(item)
        ].filter(Boolean).join(" "))}
      </td>
      <td>${esc(camposPasajero.documento(item))}</td>
      <td>Por generar</td>
      <td><span class="pill">Sin código</span></td>
      <td>—</td>
    </tr>
  `).join("");
}

function renderResumen() {
  const grabadas = state.lote.filter((item) => item.grabada).length;

  $("kCodigos").textContent = String(state.lote.length);
  $("kGrabadas").textContent = String(grabadas);
  $("kPendientes").textContent = String(Math.max(0, state.lote.length - grabadas));
}

function limpiarLote() {
  state.lote = [];
  state.indice = 0;
  $("btnGuardarAsociaciones").disabled = true;
  renderTodo();
  setEstado("Selecciona la modalidad y genera un nuevo lote.");
}

function comprobarCompatibilidad() {
  const box = $("nfcCompatibilidad");

  if ("NDEFReader" in window) {
    box.textContent =
      "Web NFC disponible. Usa Chrome en Android, HTTPS y NFC activado.";
    return;
  }

  box.textContent =
    "Web NFC no está disponible en este navegador. Para grabar, abre esta página en Chrome para Android.";
}

function numeroNegocioActual() {
  const g = state.grupo?.data || {};

  return String(
    g.numeroNegocio ||
    g.negocio_id ||
    state.grupo?.groupId ||
    state.grupoId ||
    ""
  ).trim();
}

function obtenerIniciales(nombre = "", apellido = "") {
  const inicialNombre = primeraLetra(nombre);
  const inicialApellido = primeraLetra(apellido);

  return `${inicialNombre}${inicialApellido}` || "XX";
}

function primeraLetra(valor = "") {
  const limpio = String(valor)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();

  return limpio.charAt(0) || "X";
}

function sanearCodigo(valor = "") {
  return String(valor)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function nombreUsuario() {
  return [
    state.user?.nombre,
    state.user?.apellido
  ].filter(Boolean).join(" ").trim() || state.email;
}

function setEstado(mensaje, esError = false, esOk = false) {
  const box = $("writerEstado");
  box.textContent = mensaje;
  box.classList.toggle("error", esError);
  box.classList.toggle("ok", esOk);
}

function normalizar(valor = "") {
  return String(valor)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function esc(valor = "") {
  return String(valor)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
