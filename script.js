// script.js — Dashboard Ventas RT conectado a Firestore

import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.7.3/firebase-auth.js";
import {
  collection,
  getDocs,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";

import { auth, db, VENTAS_USERS } from "./firebase-init.js";

import {
  $,
  getNombreUsuario,
  normalizeEmail,
  escapeHtml
} from "./utils.js";

import {
  ACTING_USER_KEY,
  getRealUser,
  getEffectiveUser,
  isActingAsAnother,
  getVendorUsers,
  setVendorFilter,
  getVendorFilter,
  clearVendorFilter,
  setGroupFilter,
  getGroupFilter,
  clearGroupFilter,
  isVendedorRole,
  isRegistroRole
} from "./roles.js";

import {
  setFlowNumbers,
  updateClockDataset,
  setHeaderState,
  renderActingUserSwitcher,
  bindLayoutButtons,
  waitForLayoutReady
} from "./ui.js";

/* =========================================================
   CONFIG
========================================================= */
const GITHUB_HOME_URL = "https://sistemas-raitrai.github.io/Ventas-RT/";
const APODERADO_FILTER_KEY = "ventas_dashboard_apoderado";
const ALERTAS_COLLECTION = "ventas_alertas";
const SOLICITUDES_COLLECTION = "ventas_solicitudes_actualizacion";
const PRIVATE_NOTES_COLLECTION = "ventas_notas_privadas";
const PRIVATE_NOTE_PAGE = "index";

const searchableInstances = {};

function destroySearchableSelect(id) {
  const el = $(id);
  if (!el) return;

  if (el.tomselect) {
    el.tomselect.destroy();
  }

  delete searchableInstances[id];
}

function initSearchableSelect(id, placeholder = "Escribe para buscar...") {
  const el = $(id);
  if (!el) return;

  destroySearchableSelect(id);

  if (typeof window.TomSelect === "undefined") return;

  el.setAttribute("placeholder", placeholder);

  const instance = new window.TomSelect(el, {
    create: false,
    allowEmptyOption: true,
    maxOptions: 1000,
    searchField: ["text"],
    sortField: [
      { field: "$score" },
      { field: "$order" }
    ],
    openOnFocus: true,
    closeAfterSelect: true,
    placeholder
  });

  if (el.disabled) {
    instance.disable();
  }

  searchableInstances[id] = instance;
}

/* =========================================================
   ESTADO LOCAL
========================================================= */
const state = {
  rows: [],
  rowsById: new Map(),
  alertRows: [],
  scopedRows: [],
  fichasPorFirmarRows: [],
  fichasCorregidasRows: [],
  fichasAbiertasRows: [],
  fichasCerradasRows: [],
  fichasAutorizadasRows: [],
  alertasCriticasRows: [],
  alertasWarningRows: [],
  solicitudesRows: [],
  solicitudesActualizacionRows: [],
  aContactarRows: []
};

/* =========================================================
   HELPERS GENERALES
========================================================= */
function normalizeLoose(value = "") {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function pad2(value = 0) {
  return String(Number(value) || 0).padStart(2, "0");
}

function isTruthyFlag(value) {
  const raw = normalizeLoose(value);
  return (
    value === true ||
    raw === "si" ||
    raw === "sí" ||
    raw === "true" ||
    raw === "1" ||
    raw === "x" ||
    raw === "ok"
  );
}

function getDashboardBaseYear(date = new Date()) {
  // Año comercial: cambia el 1 de marzo
  // Enero y febrero siguen perteneciendo al año anterior
  const year = date.getFullYear();
  const month = date.getMonth(); // 0=ene, 1=feb, 2=mar
  return month >= 2 ? year : year - 1;
}

function getAnoViajeNumber(row = {}) {
  const raw = String(row.anoViaje ?? "").trim();
  const match = raw.match(/\d{4}/);
  if (!match) return null;

  const year = Number(match[0]);
  return Number.isFinite(year) ? year : null;
}

function timestampLikeToDate(value) {
  if (!value) return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value?.toDate === "function") {
    const d = value.toDate();
    return Number.isNaN(d?.getTime?.()) ? null : d;
  }

  if (
    typeof value === "object" &&
    typeof value.seconds === "number"
  ) {
    const d = new Date(value.seconds * 1000);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  if (typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  if (typeof value === "string") {
    const iso = new Date(value);
    if (!Number.isNaN(iso.getTime())) return iso;

    // dd/mm/yyyy o dd-mm-yyyy
    const m = value.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?$/);
    if (m) {
      let year = Number(m[3]);
      if (year < 100) year += 2000;

      const d = new Date(
        year,
        Number(m[2]) - 1,
        Number(m[1]),
        Number(m[4] || 0),
        Number(m[5] || 0),
        0
      );

      return Number.isNaN(d.getTime()) ? null : d;
    }
  }

  return null;
}

function getMeetingDate(row = {}) {
  const candidateKeys = [
    "fechaReunion",
    "fechaReunionConfirmada",
    "fechaProximaReunion",
    "proximaReunion",
    "reunionFecha",
    "fechaConfirmacionReunion"
  ];

  for (const key of candidateKeys) {
    const d = timestampLikeToDate(row[key]);
    if (d) return d;
  }

  return null;
}

function getApoderadoFilter() {
  return String(sessionStorage.getItem(APODERADO_FILTER_KEY) || "").trim();
}

function setApoderadoFilter(value = "") {
  const finalValue = String(value || "").trim();
  if (finalValue) {
    sessionStorage.setItem(APODERADO_FILTER_KEY, finalValue);
  } else {
    sessionStorage.removeItem(APODERADO_FILTER_KEY);
  }
}

function clearApoderadoFilter() {
  sessionStorage.removeItem(APODERADO_FILTER_KEY);
}

function getPrivateNoteDocId() {
  const uid = String(auth.currentUser?.uid || "").trim();
  if (!uid) return "";
  return `${uid}_${PRIVATE_NOTE_PAGE}`;
}

function getPrivateNoteRef() {
  const docId = getPrivateNoteDocId();
  if (!docId) return null;
  return doc(db, PRIVATE_NOTES_COLLECTION, docId);
}

function setPrivateNoteStatus(message = "", tone = "muted") {
  const el = $("private-note-status");
  if (!el) return;

  const colors = {
    muted: "#6a6078",
    loading: "#6a6078",
    ok: "#2f7a4b",
    error: "#b33a3a"
  };

  el.textContent = message;
  el.style.color = colors[tone] || colors.muted;
}

function setPrivateNoteBusy(isBusy = false) {
  const textarea = $("private-note-text");
  const btnSave = $("btn-private-note-save");
  const btnClear = $("btn-private-note-clear");

  if (textarea) textarea.disabled = isBusy;
  if (btnSave) btnSave.disabled = isBusy;
  if (btnClear) btnClear.disabled = isBusy;
}

async function loadPrivateNote() {
  const textarea = $("private-note-text");
  if (!textarea) return;

  const ref = getPrivateNoteRef();
  if (!ref) {
    textarea.value = "";
    setPrivateNoteStatus("No se pudo identificar tu cuenta.", "error");
    return;
  }

  setPrivateNoteBusy(true);
  setPrivateNoteStatus("Cargando nota privada...", "loading");

  try {
    const snap = await getDoc(ref);
    const data = snap.exists() ? (snap.data() || {}) : {};

    textarea.value = String(data.contenido || "");
    setPrivateNoteStatus("Nota privada. Solo la ves tú.", "muted");
  } catch (error) {
    console.error("Error cargando nota privada:", error);
    setPrivateNoteStatus("No se pudo cargar la nota.", "error");
  } finally {
    setPrivateNoteBusy(false);
  }
}

async function savePrivateNote() {
  const textarea = $("private-note-text");
  const ref = getPrivateNoteRef();

  if (!textarea || !ref) {
    setPrivateNoteStatus("No se pudo guardar la nota.", "error");
    return;
  }

  const contenido = String(textarea.value || "");

  setPrivateNoteBusy(true);
  setPrivateNoteStatus("Guardando...", "loading");

  try {
    await setDoc(
      ref,
      {
        uid: String(auth.currentUser?.uid || ""),
        pagina: PRIVATE_NOTE_PAGE,
        contenido,
        actualizadoEn: serverTimestamp(),
        actualizadoPorCorreo: normalizeEmail(
          auth.currentUser?.email || getRealUser()?.email || ""
        )
      },
      { merge: true }
    );

    setPrivateNoteStatus("Guardado.", "ok");
  } catch (error) {
    console.error("Error guardando nota privada:", error);
    setPrivateNoteStatus("No se pudo guardar la nota.", "error");
  } finally {
    setPrivateNoteBusy(false);
  }
}

async function clearPrivateNote() {
  const textarea = $("private-note-text");
  const ref = getPrivateNoteRef();

  if (!textarea || !ref) {
    setPrivateNoteStatus("No se pudo limpiar la nota.", "error");
    return;
  }

  const confirmed = window.confirm("¿Quieres borrar por completo tu nota privada?");
  if (!confirmed) return;

  setPrivateNoteBusy(true);
  setPrivateNoteStatus("Borrando...", "loading");

  try {
    await deleteDoc(ref);
    textarea.value = "";
    setPrivateNoteStatus("Nota eliminada.", "ok");
  } catch (error) {
    console.error("Error borrando nota privada:", error);
    setPrivateNoteStatus("No se pudo borrar la nota.", "error");
  } finally {
    setPrivateNoteBusy(false);
  }
}

function bindPrivateNotePanel() {
  const textarea = $("private-note-text");
  const btnSave = $("btn-private-note-save");
  const btnClear = $("btn-private-note-clear");

  if (btnSave && !btnSave.dataset.bound) {
    btnSave.dataset.bound = "1";
    btnSave.addEventListener("click", async () => {
      await savePrivateNote();
    });
  }

  if (btnClear && !btnClear.dataset.bound) {
    btnClear.dataset.bound = "1";
    btnClear.addEventListener("click", async () => {
      await clearPrivateNote();
    });
  }

  if (textarea && !textarea.dataset.boundShortcut) {
    textarea.dataset.boundShortcut = "1";

    textarea.addEventListener("keydown", async (e) => {
      const saveShortcut = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s";
      if (!saveShortcut) return;

      e.preventDefault();
      await savePrivateNote();
    });
  }
}

function getRowId(row = {}) {
  return String(row.idGrupo || row.id || "").trim();
}

function getRowAlias(row = {}) {
  return String(
    row.aliasGrupo ||
    row.nombreGrupo ||
    row.colegio ||
    row.idGrupo ||
    row.id ||
    "Sin alias"
  ).trim();
}

function getRowApoderado(row = {}) {
  return String(row.nombreCliente || "Sin apoderado").trim();
}

function getRowVendorEmail(row = {}) {
  return normalizeEmail(
    row.vendedoraCorreo ||
    row.creadoPorCorreo ||
    ""
  );
}

function getRowVendorName(row = {}) {
  return String(row.vendedora || "").trim();
}

function dedupeRowsByGroup(rows = []) {
  const map = new Map();

  rows.forEach((row) => {
    const id = getRowId(row);
    if (!id) return;
    if (!map.has(id)) {
      map.set(id, row);
    }
  });

  return [...map.values()];
}

function getRowsForCurrentScope(effectiveUser) {
  const vendorFilter = isVendedorRole(effectiveUser)
    ? normalizeEmail(effectiveUser.email)
    : normalizeEmail(getVendorFilter(effectiveUser) || "");

  let rows = [...state.rows];

  if (vendorFilter) {
    rows = rows.filter((row) => getRowVendorEmail(row) === vendorFilter);
  }

  return dedupeRowsByGroup(rows);
}

function formatYearBuckets(rows = []) {
  const baseYear = getDashboardBaseYear();
  const y1 = baseYear;
  const y2 = baseYear + 1;
  const y3 = baseYear + 2;

  let c1 = 0;
  let c2 = 0;
  let c3 = 0;

  rows.forEach((row) => {
    const y = getAnoViajeNumber(row);
    if (y === y1) c1 += 1;
    else if (y === y2) c2 += 1;
    else if (y === y3) c3 += 1;
  });

  return `${pad2(c1)} | ${pad2(c2)} | ${pad2(c3)} | (${pad2(rows.length)})`;
}

function renderFichaAdminBucketLinks(targetId, tipo = "", rows = []) {
  const el = $(targetId);
  if (!el) return;

  const baseYear = getDashboardBaseYear();
  const years = [baseYear, baseYear + 1, baseYear + 2];

  const counts = years.map((year) =>
    rows.filter((row) => getAnoViajeNumber(row) === year).length
  );

  const yearLinks = years.map((year, index) => `
    <a
      href="#"
      class="flow-number-link"
      data-fichas-admin-tipo="${tipo}"
      data-fichas-admin-year="${year}"
      style="color:inherit;text-decoration:none;"
    >${pad2(counts[index])}</a>
  `);

  const totalLink = `
    <a
      href="#"
      class="flow-number-link"
      data-fichas-admin-tipo="${tipo}"
      data-fichas-admin-year="total"
      style="color:inherit;text-decoration:none;"
    >${pad2(rows.length)}</a>
  `;

  el.innerHTML = `${yearLinks[0]} | ${yearLinks[1]} | ${yearLinks[2]} | (${totalLink})`;
}

function resolveEstadoBucket(row = {}) {
  const estado = normalizeLoose(row.estado);

  if (!estado) return "";

  if (estado.includes("re cot") || estado.includes("recot")) return "recotizando";
  if (estado.includes("reunion") && estado.includes("confirm")) return "reunion";
  if (estado.includes("cotiz")) return "cotizando";
  if (estado.includes("perdid")) return "perdidas";
  if (estado.includes("ganad")) return "ganadas";
  if (estado.includes("autoriz")) return "autorizadas";
  if (estado.includes("cerrad")) return "cerradas";
  if (estado.includes("a contactar")) return "a_contactar";
  if (estado.includes("contactad")) return "contactados";

  return "";
}

function getBucketRows(rows = [], bucket = "") {
  return rows.filter((row) => resolveEstadoBucket(row) === bucket);
}

function isSinAsignar(row = {}) {
  return (
    isTruthyFlag(row.requiereAsignacion) ||
    (!getRowVendorEmail(row) && !normalizeLoose(getRowVendorName(row))) ||
    normalizeLoose(getRowVendorName(row)) === "sin asignar"
  );
}

function isAContactar(row = {}) {
  return normalizeLoose(row.estado).includes("a contactar");
}

function getRoleKey(user = {}) {
  return normalizeLoose(user?.rol || "");
}

function isAdminDashboardRole(user = {}) {
  return getRoleKey(user) === "admin";
}

function isSupervisionDashboardRole(user = {}) {
  return getRoleKey(user) === "supervision";
}

function getFichaFlowModeRow(row = {}) {
  return normalizeLoose(
    row.fichaFlujoModo ||
    row?.flowFicha?.modo ||
    row?.ficha?.flujoModo ||
    ""
  );
}

function getFichaFirmas(row = {}) {
  const flow = row.flowFicha || {};

  return {
    vendedor: !!flow?.vendedor?.firmado || isTruthyFlag(row.firmaVendedor),
    jefa: !!flow?.jefaVentas?.firmado || isTruthyFlag(row.firmaSupervision),
    admin: !!flow?.administracion?.firmado || isTruthyFlag(row.firmaAdministracion)
  };
}

function hasFichaCreada(row = {}) {
  const flowMode = getFichaFlowModeRow(row);
  if (flowMode) return true;

  if (row.ficha && typeof row.ficha === "object" && Object.keys(row.ficha).length) {
    return true;
  }

  if (row.flowFicha && typeof row.flowFicha === "object" && Object.keys(row.flowFicha).length) {
    return true;
  }

  const rootSignals = [
    row.solicitudReserva,
    row.versionFicha,
    row.fechaActualizacionFicha,
    row.fichaEstado,
    row.fichaPdfUrl,
    row.numeroNegocio,
    row.usuarioProgramaAdm,
    row.claveAdministrativa,
    row.firmaVendedor,
    row.firmaSupervision,
    row.firmaAdministracion
  ];

  return rootSignals.some((value) => String(value ?? "").trim() !== "");
}

function isFichaCerrada(row = {}) {
  const firmas = getFichaFirmas(row);
  const estadoFicha = normalizeLoose(row.fichaEstado || "");
  const cierre = normalizeLoose(row.cierre || "");

  return (
    isTruthyFlag(row.cerrada) ||
    isTruthyFlag(row.autorizada) ||
    cierre.includes("cerrad") ||
    estadoFicha === "autorizada_admin" ||
    (firmas.vendedor && firmas.jefa && firmas.admin)
  );
}

function isGanadaComercial(row = {}) {
  return resolveEstadoBucket(row) === "ganadas";
}

function hasAllThreeFichaFirmas(row = {}) {
  const firmas = getFichaFirmas(row);
  return !!(firmas.vendedor && firmas.jefa && firmas.admin);
}

function getAdminValue(row = {}, fichaKey = "", rootKey = "") {
  return String(
    row?.ficha?.[fichaKey] ||
    row?.[rootKey] ||
    row?.[fichaKey] ||
    ""
  ).trim();
}

function tuvoFirmaAdministracionAlgunaVez(row = {}) {
  const flow = row.flowFicha || {};

  return (
    !!flow?.administracion?.firmado ||
    !!flow?.administracion?.firmadoAt ||
    !!flow?.administracion?.firmadoPor ||
    !!row.firmaAdministracion ||
    !!row.fechaFirmaAdministracion ||
    row.autorizada === true
  );
}

function isFichaAbiertaAdministrativa(row = {}) {
  const flow = row.flowFicha || {};
  const modo = normalizeLoose(flow.modo || row.fichaFlujoModo || row?.ficha?.flujoModo || "");

  const haySolicitudAbierta = (state.solicitudesRows || []).some((sol) => {
    return (
      String(sol.idGrupo || "").trim() === getRowId(row) &&
      normalizeLoose(sol.tipoSolicitud || "") === "actualizacion_ficha" &&
      sol.resuelta !== true &&
      !["completada", "cerrada"].includes(normalizeLoose(sol.estadoSolicitud || ""))
    );
  });

  return (
    haySolicitudAbierta ||
    modo === "correccion" ||
    flow.correccionPendiente === true ||
    normalizeLoose(flow.correccionEstado || "").startsWith("pendiente")
  );
}

function isFichaCerradaAdministrativa(row = {}) {
  const firmas = getFichaFirmas(row);
  return firmas.vendedor && firmas.jefa && firmas.admin && !isFichaAbiertaAdministrativa(row);
}

function isFichaAutorizadaAdministrativa(row = {}) {
  const numeroNegocio = getAdminValue(row, "numeroNegocio", "numeroNegocio");
  const usuario = getAdminValue(row, "usuarioFicha", "usuarioProgramaAdm");
  const clave = getAdminValue(row, "claveAdministrativa", "claveAdministrativa");

  return tuvoFirmaAdministracionAlgunaVez(row) && !!numeroNegocio && !!usuario && !!clave;
}

function getFichaAdminMotivo(row = {}) {
  if (isFichaAbiertaAdministrativa(row)) {
    const estado = normalizeLoose(row?.flowFicha?.correccionEstado || "");

    if (estado === "pendiente_jefa") return "Corrección pendiente de jefa de ventas";
    if (estado === "pendiente_administracion") return "Corrección pendiente de administración";

    return "Solicitud de actualización o corrección abierta";
  }

  if (isFichaAutorizadaAdministrativa(row)) return "Autorizada para gestión de pago";
  if (isFichaCerradaAdministrativa(row)) return "Flujo de firmas completo";

  return "Sin clasificación";
}

function sortRowsByAliasComparator(a, b) {
  const aliasA = getAliasColegioSortKey(getRowAlias(a));
  const aliasB = getAliasColegioSortKey(getRowAlias(b));
  return aliasA.localeCompare(aliasB, "es", { sensitivity: "base", numeric: true });
}

function isCaroDashboardUser(user = {}) {
  return normalizeEmail(user?.email || "") === "chernandez@raitrai.cl";
}

function isAdministracionDashboardUser(user = {}) {
  const email = normalizeEmail(user?.email || "");
  return (
    email === "yenny@raitrai.cl" ||
    email === "administracion@raitrai.cl" ||
    email === "raitrai@raitrai.cl"
  );
}

function isCorreccionFichaPendiente(row = {}) {
  const flow = row.flowFicha || {};
  const modo = normalizeLoose(flow.modo || row.fichaFlujoModo || "");

  return (
    modo === "correccion" ||
    flow.correccionPendiente === true ||
    normalizeLoose(flow.correccionEstado || "").startsWith("pendiente")
  );
}

function getCorreccionFichaEstado(row = {}) {
  const flow = row.flowFicha || {};
  return normalizeLoose(flow.correccionEstado || "");
}

function isFichaCorregidaVisibleParaUsuario(row = {}, user = null) {
  const effectiveUser = user || getEffectiveUser();
  if (!effectiveUser) return false;
  if (!isCorreccionFichaPendiente(row)) return false;

  const estado = getCorreccionFichaEstado(row);
  const rol = normalizeLoose(effectiveUser.rol || "");

  // Admin real / general ve todas las correcciones.
  if (rol === "admin") return true;

  // Jefa de ventas ve solo las correcciones que vuelven a ella.
  if (isCaroDashboardUser(effectiveUser)) {
    return estado === "pendiente_jefa";
  }

  // Administración ve solo las correcciones que esperan cierre administrativo.
  if (isAdministracionDashboardUser(effectiveUser)) {
    return estado === "pendiente_administracion";
  }

  // Supervisión genérica NO ve todas las correcciones.
  return false;
}

function getFichaCorregidaLabel(row = {}) {
  const flow = row.flowFicha || {};
  const origen = normalizeLoose(flow.correccionOrigen || "");
  const estado = getCorreccionFichaEstado(row);

  if (estado === "pendiente_jefa") {
    return "Corrección pendiente de revisión por jefa de ventas";
  }

  if (estado === "pendiente_administracion") {
    return "Corrección pendiente de cierre administrativo";
  }

  if (origen === "administracion") {
    return "Corrección iniciada por administración";
  }

  if (origen === "jefaventas") {
    return "Corrección iniciada por jefa de ventas";
  }

  return "Corrección interna pendiente";
}

function getFichasCorregidasSegunUsuario(rows = [], effectiveUser = null) {
  return dedupeRowsByGroup(rows)
    .filter((row) => isFichaCorregidaVisibleParaUsuario(row, effectiveUser))
    .sort((a, b) => {
      const aliasA = getAliasColegioSortKey(getRowAlias(a));
      const aliasB = getAliasColegioSortKey(getRowAlias(b));
      return aliasA.localeCompare(aliasB, "es", { sensitivity: "base", numeric: true });
    });
}

function getFichaPendienteLabel(row = {}) {
  const firmas = getFichaFirmas(row);

  if (!firmas.vendedor) return "Falta firma vendedor(a)";
  if (!firmas.jefa) return "Falta firma jefa de ventas";
  if (!firmas.admin) return "Falta firma administración";
  return "Firmas completas";
}

function isFichaPorFirmarSegunUsuario(row = {}, effectiveUser = null) {
  const user = effectiveUser || getEffectiveUser();
  if (!user) return false;

  const ganada = isGanadaComercial(row);
  if (!ganada) return false;

  const firmas = getFichaFirmas(row);

  // VENDEDOR:
  // ve las ganadas donde todavía falta su firma.
  if (isVendedorRole(user)) {
    return !firmas.vendedor;
  }

  // CARO:
  // ve solo las que le toca firmar a ella.
  if (isCaroDashboardUser(user)) {
    return firmas.vendedor && !firmas.jefa;
  }

  // ADMINISTRACIÓN (YENNY / ADMINISTRACION@):
  // ve solo las que le toca firmar a administración.
  if (isAdministracionDashboardUser(user)) {
    return firmas.vendedor && firmas.jefa && !firmas.admin;
  }

  // RESTO:
  // ve todas las ganadas que aún no tienen las 3 firmas completas.
  return !hasAllThreeFichaFirmas(row);
}

function getFichasPorFirmarSegunUsuario(rows = [], effectiveUser = null) {
  const solicitudesAbiertasIds = new Set(
    (state.solicitudesRows || [])
      .filter((sol) => {
        const tipo = normalizeLoose(sol.tipoSolicitud || "");
        const estado = normalizeLoose(sol.estadoSolicitud || "");

        return tipo === "actualizacion_ficha" &&
          sol.resuelta !== true &&
          estado !== "completada" &&
          estado !== "cerrada";
      })
      .flatMap((sol) => [
        String(sol.idGrupo || "").trim(),
        String(sol.codigoRegistro || "").trim()
      ])
      .filter(Boolean)
  );

  return dedupeRowsByGroup(rows)
    .filter((row) => {
      const posiblesIdsGrupo = [
        String(row.idGrupo || "").trim(),
        String(row.id || "").trim(),
        String(row.codigoRegistro || "").trim()
      ].filter(Boolean);

      const tieneSolicitudAbierta = posiblesIdsGrupo.some((id) =>
        solicitudesAbiertasIds.has(id)
      );

      if (tieneSolicitudAbierta) return false;
      
      // Si está en corrección interna, NO es ficha nueva por firmar.
      if (isCorreccionFichaPendiente(row)) return false;
      
      return isFichaPorFirmarSegunUsuario(row, effectiveUser);
    })
    .sort((a, b) => {
      const aliasA = getAliasColegioSortKey(getRowAlias(a));
      const aliasB = getAliasColegioSortKey(getRowAlias(b));
      return aliasA.localeCompare(aliasB, "es", { sensitivity: "base", numeric: true });
    });
}

function getSolicitudEstadoLabel(sol = {}) {
  const estado = normalizeLoose(sol.estadoSolicitud || "");

  if (estado === "pendiente") return "Pendiente revisión jefa de ventas";
  if (estado === "revisada_jefa") return "Revisada por jefa / pendiente Administración";
  if (estado === "completada") return "Cerrada por Administración";

  return sol.estadoSolicitud || "Sin estado";
}

function isSolicitudActualizacionAbierta(sol = {}) {
  const tipo = normalizeLoose(sol.tipoSolicitud || "");
  const estado = normalizeLoose(sol.estadoSolicitud || "");

  return tipo === "actualizacion_ficha" &&
    sol.resuelta !== true &&
    estado !== "completada" &&
    estado !== "cerrada";
}

function isSolicitudVisibleParaUsuario(sol = {}, user = null, groupRow = {}) {
  if (!user) return false;

  const estado = normalizeLoose(sol.estadoSolicitud || "");
  const userEmail = normalizeEmail(user.email || "");
  const rol = normalizeLoose(user.rol || "");

  if (!isSolicitudActualizacionAbierta(sol)) return false;

  if (rol === "admin") return true;

  if (isCaroDashboardUser(user)) {
    return estado === "pendiente";
  }

  if (isAdministracionDashboardUser(user)) {
    return estado === "revisada_jefa";
  }

  if (isVendedorRole(user)) {
    const solicitadoPor = normalizeEmail(sol.solicitadoPorCorreo || "");
    const vendedorGrupo = normalizeEmail(groupRow?.vendedoraCorreo || "");

    return (
      solicitadoPor === userEmail ||
      vendedorGrupo === userEmail
    );
  }

  return false;
}

function getSolicitudesActualizacionSegunUsuario(rows = [], effectiveUser = null) {
  const user = effectiveUser || getEffectiveUser();

  const scopedIds = new Set(
    dedupeRowsByGroup(rows)
      .map((row) => getRowId(row))
      .filter(Boolean)
  );

  return (state.solicitudesRows || [])
    .map((sol) => {
      const idGrupo = String(sol.idGrupo || "").trim();
      const groupRow = state.rowsById.get(idGrupo) || {};
      return { ...sol, _groupRow: groupRow };
    })
    .filter((sol) => {
      const idGrupo = String(sol.idGrupo || "").trim();
      if (!scopedIds.has(idGrupo)) return false;
      return isSolicitudVisibleParaUsuario(sol, user, sol._groupRow || {});
    })
    .sort((a, b) => {
      const da = timestampLikeToDate(a.fechaSolicitud)?.getTime() || 0;
      const db = timestampLikeToDate(b.fechaSolicitud)?.getTime() || 0;
      return db - da;
    });
}

function setAlertRowVisibleByChild(childId, visible = true) {
  const child = $(childId);
  const row = child?.closest(".alert-row") || child?.closest(".alert-row-wrap");
  if (!row) return;

  row.style.display = visible ? "" : "none";
}

function syncAlertRowsByRole(effectiveUser = null) {
  const user = effectiveUser || getEffectiveUser();

  const canSeeSinAsignar =
    isAdminDashboardRole(user) ||
    isSupervisionDashboardRole(user) ||
    isRegistroRole(user);

  const canSeeFichas = !!user;
  const canSeeSolicitudes = !!user;
  const canSeeAlertasCriticas = !!user;
  const canSeeAlertasWarning = !!user;

  setAlertRowVisibleByChild("link-sin-asignar", canSeeSinAsignar);
  setAlertRowVisibleByChild("link-fichas-firmar", canSeeFichas);
  setAlertRowVisibleByChild("link-fichas-corregidas", canSeeFichas);
  setAlertRowVisibleByChild("link-solicitudes-actualizacion", canSeeSolicitudes);
  setAlertRowVisibleByChild("link-alertas-criticas", canSeeAlertasCriticas);
  setAlertRowVisibleByChild("link-alertas-warning", canSeeAlertasWarning);
  setAlertRowVisibleByChild("count-pendientes", false);
}

function isReunionEnProximosTresDias(row = {}) {
  if (resolveEstadoBucket(row) !== "reunion") return false;

  const fecha = getMeetingDate(row);
  if (!fecha) return false;

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const limit = new Date(todayStart);
  limit.setDate(limit.getDate() + 3);
  limit.setHours(23, 59, 59, 999);

  return fecha >= todayStart && fecha <= limit;
}

function renderAContactarModal(rows = [], effectiveUser = null) {
  const titleEl = $("a-contactar-titulo");
  const subtitleEl = $("a-contactar-subtitulo");
  const summaryEl = $("a-contactar-resumen");
  const listEl = $("a-contactar-lista");

  if (!titleEl || !subtitleEl || !summaryEl || !listEl) return;

  titleEl.textContent = "Contactos a contactar";
  subtitleEl.textContent = isVendedorRole(effectiveUser)
    ? "Aquí ves tus grupos pendientes de primer contacto."
    : "Aquí ves los grupos pendientes de primer contacto según la vista actual.";

  summaryEl.textContent = rows.length
    ? `Hay ${rows.length} contacto(s) pendientes de contactar.`
    : "No hay contactos pendientes de contactar en esta vista.";

  if (!rows.length) {
    listEl.innerHTML = `
      <div style="padding:16px 18px; border:1px solid rgba(60,40,90,.10); border-radius:16px; background:#faf8fd; color:#5d546d;">
        No hay contactos a contactar.
      </div>
    `;
    return;
  }

  listEl.innerHTML = rows.map((row) => {
    const id = getRowId(row);
    const alias = getRowAlias(row);
    const apoderado = getRowApoderado(row);
    const vendedor = getRowVendorName(row) || row.vendedoraCorreo || "Sin vendedor";

    return `
      <div style="padding:14px 16px; border:1px solid rgba(60,40,90,.12); border-radius:16px; background:#fff; display:flex; justify-content:space-between; gap:14px; align-items:flex-start;">
        <div style="min-width:0;">
          <div style="font-weight:800; color:#31194b; font-size:16px; line-height:1.2;">
            ${escapeHtml(alias)}
          </div>

          <div style="margin-top:6px; color:#6a6078; font-size:13px; line-height:1.45;">
            Apoderado: ${escapeHtml(apoderado)}<br>
            Vendedor(a): ${escapeHtml(vendedor)}<br>
            Estado: ${escapeHtml(row.estado || "A contactar")}
          </div>
        </div>

        <a
          href="grupo.html?id=${encodeURIComponent(id)}"
          target="_blank"
          rel="noopener"
          style="flex:0 0 auto; text-decoration:none; background:#3b2357; color:#fff; border-radius:999px; padding:10px 14px; font-weight:700; white-space:nowrap;"
        >
          Abrir grupo
        </a>
      </div>
    `;
  }).join("");
}

function openAContactarModal() {
  const dialog = $("modal-a-contactar");
  if (!dialog) return;

  renderAContactarModal(
    Array.isArray(state.aContactarRows) ? state.aContactarRows : [],
    getEffectiveUser()
  );

  if (typeof dialog.showModal === "function") {
    if (!dialog.open) dialog.showModal();
    return;
  }

  dialog.setAttribute("open", "open");
}

function closeAContactarModal() {
  const dialog = $("modal-a-contactar");
  if (!dialog) return;

  if (typeof dialog.close === "function") {
    dialog.close();
    return;
  }

  dialog.removeAttribute("open");
}

function getFichasPorFirmarSubtitulo(user = null) {
  const effectiveUser = user || getEffectiveUser();
  if (!effectiveUser) return "Listado de fichas pendientes según tu rol.";

  if (isVendedorRole(effectiveUser)) {
    return "Aquí ves las fichas ganadas donde todavía falta la firma del vendedor(a).";
  }

  if (isCaroDashboardUser(effectiveUser)) {
    return "Aquí ves las fichas donde ya firmó vendedor(a) y todavía falta la firma de jefa de ventas.";
  }

  if (isAdministracionDashboardUser(effectiveUser)) {
    return "Aquí ves las fichas donde ya firmó vendedor(a) y jefa de ventas, y todavía falta la firma de administración.";
  }

  return "Aquí ves todas las fichas ganadas que todavía no tienen las 3 firmas completas.";
}

function renderFichasPorFirmarModal(rows = [], effectiveUser = null) {
  const titleEl = $("fichas-firmar-titulo");
  const subtitleEl = $("fichas-firmar-subtitulo");
  const summaryEl = $("fichas-firmar-resumen");
  const listEl = $("fichas-firmar-lista");

  if (!titleEl || !subtitleEl || !summaryEl || !listEl) return;

  titleEl.textContent = "Fichas por firmar";
  subtitleEl.textContent = getFichasPorFirmarSubtitulo(effectiveUser);
  summaryEl.textContent = rows.length
    ? `Hay ${rows.length} ficha(s) pendiente(s) en tu vista actual.`
    : "No hay fichas pendientes para tu rol en esta vista.";

  if (!rows.length) {
    listEl.innerHTML = `
      <div style="padding:16px 18px; border:1px solid rgba(60,40,90,.10); border-radius:16px; background:#faf8fd; color:#5d546d;">
        No hay fichas por firmar.
      </div>
    `;
    return;
  }

  listEl.innerHTML = rows.map((row) => {
    const id = getRowId(row);
    const alias = getRowAlias(row);
    const apoderado = getRowApoderado(row);
    const vendedor = getRowVendorName(row) || row.vendedoraCorreo || "Sin vendedor";
    const pendiente = getFichaPendienteLabel(row);

    return `
      <div style="padding:14px 16px; border:1px solid rgba(60,40,90,.12); border-radius:16px; background:#fff; display:flex; justify-content:space-between; gap:14px; align-items:flex-start;">
        <div style="min-width:0;">
          <div style="font-weight:800; color:#31194b; font-size:16px; line-height:1.2;">
            ${escapeHtml(alias)}
          </div>

          <div style="margin-top:6px; color:#6a6078; font-size:13px; line-height:1.45;">
            Apoderado: ${escapeHtml(apoderado)}<br>
            Vendedor(a): ${escapeHtml(vendedor)}<br>
            Estado pendiente: ${escapeHtml(pendiente)}
          </div>
        </div>

        <a
          href="fichas.html?id=${encodeURIComponent(id)}"
          target="_blank"
          rel="noopener"
          style="flex:0 0 auto; text-decoration:none; background:#3b2357; color:#fff; border-radius:999px; padding:10px 14px; font-weight:700; white-space:nowrap;"
        >
          Abrir ficha
        </a>
      </div>
    `;
  }).join("");
}

function openFichasPorFirmarModal() {
  const dialog = $("modal-fichas-firmar");
  if (!dialog) return;

  const effectiveUser = getEffectiveUser();
  const rows = Array.isArray(state.fichasPorFirmarRows) ? state.fichasPorFirmarRows : [];

  renderFichasPorFirmarModal(rows, effectiveUser);

  if (typeof dialog.showModal === "function") {
    if (!dialog.open) dialog.showModal();
    return;
  }

  dialog.setAttribute("open", "open");
}

function closeFichasPorFirmarModal() {
  const dialog = $("modal-fichas-firmar");
  if (!dialog) return;

  if (typeof dialog.close === "function") {
    dialog.close();
    return;
  }

  dialog.removeAttribute("open");
}

function renderFichasCorregidasModal(rows = [], effectiveUser = null) {
  const titleEl = $("fichas-corregidas-titulo");
  const subtitleEl = $("fichas-corregidas-subtitulo");
  const summaryEl = $("fichas-corregidas-resumen");
  const listEl = $("fichas-corregidas-lista");

  if (!titleEl || !subtitleEl || !summaryEl || !listEl) return;

  titleEl.textContent = "Fichas corregidas";
  subtitleEl.textContent = "Correcciones internas pendientes según tu rol.";
  summaryEl.textContent = rows.length
    ? `Hay ${rows.length} ficha(s) corregida(s) pendiente(s).`
    : "No hay fichas corregidas pendientes para tu rol.";

  if (!rows.length) {
    listEl.innerHTML = `
      <div style="padding:16px 18px; border:1px solid rgba(60,40,90,.10); border-radius:16px; background:#faf8fd; color:#5d546d;">
        No hay fichas corregidas pendientes.
      </div>
    `;
    return;
  }

  listEl.innerHTML = rows.map((row) => {
    const id = getRowId(row);
    const alias = getRowAlias(row);
    const apoderado = getRowApoderado(row);
    const vendedor = getRowVendorName(row) || row.vendedoraCorreo || "Sin vendedor";
    const pendiente = getFichaCorregidaLabel(row);

    return `
      <div style="padding:14px 16px; border:1px solid rgba(60,40,90,.12); border-radius:16px; background:#fff; display:flex; justify-content:space-between; gap:14px; align-items:flex-start;">
        <div style="min-width:0;">
          <div style="font-weight:800; color:#31194b; font-size:16px; line-height:1.2;">
            ${escapeHtml(alias)}
          </div>

          <div style="margin-top:6px; color:#6a6078; font-size:13px; line-height:1.45;">
            Apoderado: ${escapeHtml(apoderado)}<br>
            Vendedor(a): ${escapeHtml(vendedor)}<br>
            Estado corrección: ${escapeHtml(pendiente)}
          </div>
        </div>

        <a
          href="fichas.html?id=${encodeURIComponent(id)}"
          target="_blank"
          rel="noopener"
          style="flex:0 0 auto; text-decoration:none; background:#3b2357; color:#fff; border-radius:999px; padding:10px 14px; font-weight:700; white-space:nowrap;"
        >
          Abrir ficha
        </a>
      </div>
    `;
  }).join("");
}

function openFichasCorregidasModal() {
  const dialog = $("modal-fichas-corregidas");
  if (!dialog) return;

  const effectiveUser = getEffectiveUser();
  const rows = Array.isArray(state.fichasCorregidasRows) ? state.fichasCorregidasRows : [];

  renderFichasCorregidasModal(rows, effectiveUser);

  if (typeof dialog.showModal === "function") {
    if (!dialog.open) dialog.showModal();
    return;
  }

  dialog.setAttribute("open", "open");
}

function closeFichasCorregidasModal() {
  const dialog = $("modal-fichas-corregidas");
  if (!dialog) return;

  if (typeof dialog.close === "function") {
    dialog.close();
    return;
  }

  dialog.removeAttribute("open");
}

function buildSearchTextLocal(obj = {}) {
  let text = "";

  function walk(value) {
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) return value.forEach(walk);
    if (typeof value === "object") return Object.values(value).forEach(walk);
    text += " " + String(value);
  }

  walk(obj);
  return normalizeLoose(text);
}

function renderFichasAdminModal(rows = [], tipo = "") {
  const titleEl = $("fichas-admin-titulo");
  const subtitleEl = $("fichas-admin-subtitulo");
  const summaryEl = $("fichas-admin-resumen");
  const listEl = $("fichas-admin-lista");
  const buscador = $("fichas-admin-buscador");

  if (!titleEl || !subtitleEl || !summaryEl || !listEl) return;

  const titles = {
    abiertas: "Fichas abiertas",
    cerradas: "Fichas cerradas",
    autorizadas: "Fichas autorizadas"
  };

  titleEl.textContent = titles[tipo] || "Fichas";
  subtitleEl.textContent =
    tipo === "abiertas" ? "Fichas reabiertas por actualización, corrección o refirma." :
    tipo === "cerradas" ? "Fichas con flujo completo y sin reapertura activa." :
    "Fichas autorizadas para gestión administrativa de pago.";

  summaryEl.textContent = `Hay ${rows.length} ficha(s) en este listado.`;
  if (buscador) buscador.value = "";

  const pintar = (lista = rows) => {
    if (!lista.length) {
      listEl.innerHTML = `<div style="padding:16px 18px; border-radius:16px; background:#faf8fd; color:#5d546d;">No hay fichas para mostrar.</div>`;
      return;
    }

    listEl.innerHTML = lista.map((row) => {
      const id = getRowId(row);
      return `
        <div style="padding:14px 16px; border:1px solid rgba(60,40,90,.12); border-radius:16px; background:#fff; display:flex; justify-content:space-between; gap:14px;">
          <div>
            <div style="font-weight:800; color:#31194b; font-size:16px;">${escapeHtml(getRowAlias(row))}</div>
            <div style="margin-top:6px; color:#6a6078; font-size:13px; line-height:1.45;">
              Apoderado: ${escapeHtml(getRowApoderado(row))}<br>
              Vendedor(a): ${escapeHtml(getRowVendorName(row) || row.vendedoraCorreo || "Sin vendedor")}<br>
              Año viaje: ${escapeHtml(row.anoViaje || "—")}<br>
              Motivo: ${escapeHtml(getFichaAdminMotivo(row))}
            </div>
          </div>

          <a href="fichas.html?id=${encodeURIComponent(id)}" target="_blank" rel="noopener" style="text-decoration:none; background:#3b2357; color:#fff; border-radius:999px; padding:10px 14px; font-weight:700; height:max-content;">
            Abrir ficha
          </a>
        </div>
      `;
    }).join("");
  };

  pintar(rows);

  if (buscador && !buscador.dataset.boundFichasAdmin) {
    buscador.dataset.boundFichasAdmin = "1";
    buscador.addEventListener("input", () => {
      const q = normalizeLoose(buscador.value || "");
      pintar(q ? rows.filter((row) => buildSearchTextLocal(row).includes(q)) : rows);
    });
  }
}

function openFichasAdminModal(tipo = "", year = "total") {
  const dialog = $("modal-fichas-admin");
  if (!dialog) return;

  const allRows =
    tipo === "abiertas" ? state.fichasAbiertasRows :
    tipo === "cerradas" ? state.fichasCerradasRows :
    tipo === "autorizadas" ? state.fichasAutorizadasRows :
    [];

  const rows = year && year !== "total"
    ? allRows.filter((row) => getAnoViajeNumber(row) === Number(year))
    : allRows;

  renderFichasAdminModal(rows || [], tipo);

  if (typeof dialog.showModal === "function") {
    if (!dialog.open) dialog.showModal();
  } else {
    dialog.setAttribute("open", "open");
  }
}

function closeFichasAdminModal() {
  const dialog = $("modal-fichas-admin");
  if (!dialog) return;
  if (typeof dialog.close === "function") dialog.close();
  else dialog.removeAttribute("open");
}

function getSolicitudesActualizacionSubtitulo(user = null) {
  const effectiveUser = user || getEffectiveUser();

  if (!effectiveUser) return "Solicitudes abiertas según tu rol.";

  if (isVendedorRole(effectiveUser)) {
    return "Aquí ves el seguimiento de tus solicitudes de actualización abiertas.";
  }

  if (isCaroDashboardUser(effectiveUser)) {
    return "Aquí ves las solicitudes pendientes de revisión por jefa de ventas.";
  }

  if (isAdministracionDashboardUser(effectiveUser)) {
    return "Aquí ves las solicitudes ya revisadas por jefa de ventas y pendientes de cierre administrativo.";
  }

  return "Aquí ves las solicitudes de actualización abiertas.";
}

function renderSolicitudesActualizacionModal(rows = [], effectiveUser = null) {
  const titleEl = $("solicitudes-actualizacion-titulo");
  const subtitleEl = $("solicitudes-actualizacion-subtitulo");
  const summaryEl = $("solicitudes-actualizacion-resumen");
  const listEl = $("solicitudes-actualizacion-lista");

  if (!titleEl || !subtitleEl || !summaryEl || !listEl) return;

  titleEl.textContent = "Solicitudes de actualización";
  subtitleEl.textContent = getSolicitudesActualizacionSubtitulo(effectiveUser);

  summaryEl.textContent = rows.length
    ? `Hay ${rows.length} solicitud(es) de actualización en tu vista actual.`
    : "No hay solicitudes de actualización pendientes para tu rol.";

  if (!rows.length) {
    listEl.innerHTML = `
      <div style="padding:16px 18px; border:1px solid rgba(60,40,90,.10); border-radius:16px; background:#faf8fd; color:#5d546d;">
        No hay solicitudes de actualización abiertas.
      </div>
    `;
    return;
  }

  listEl.innerHTML = rows.map((sol) => {
    const groupRow = sol._groupRow || {};
    const idGrupo = String(sol.idGrupo || "").trim();
    const alias = getRowAlias(groupRow) || sol.aliasGrupo || `Grupo ${idGrupo}`;
    const vendedor = getRowVendorName(groupRow) || groupRow.vendedoraCorreo || sol.solicitadoPor || "Sin vendedor";
    const fecha = timestampLikeToDate(sol.fechaSolicitud);
    const fechaTxt = fecha
      ? fecha.toLocaleString("es-CL", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false
        })
      : "Sin fecha";

    return `
      <div style="padding:14px 16px; border:1px solid rgba(60,40,90,.12); border-radius:16px; background:#fff; display:flex; justify-content:space-between; gap:14px; align-items:flex-start;">
        <div style="min-width:0;">
          <div style="font-weight:800; color:#31194b; font-size:16px; line-height:1.2;">
            ${escapeHtml(alias)}
          </div>

          <div style="margin-top:6px; color:#6a6078; font-size:13px; line-height:1.45;">
            Vendedor(a): ${escapeHtml(vendedor)}<br>
            Estado: ${escapeHtml(getSolicitudEstadoLabel(sol))}<br>
            Fecha solicitud: ${escapeHtml(fechaTxt)}
          </div>

          <div style="margin-top:10px; color:#3e3550; font-size:14px; line-height:1.5;">
            <strong>Motivo vendedor:</strong><br>
            ${escapeHtml(sol.detalle || "Sin detalle")}
          </div>

          ${sol.respuestaJefa ? `
            <div style="margin-top:10px; color:#3e3550; font-size:14px; line-height:1.5;">
              <strong>Respuesta jefa de ventas:</strong><br>
              ${escapeHtml(sol.respuestaJefa)}
            </div>
          ` : ""}

          ${sol.respuestaAdministracion ? `
            <div style="margin-top:10px; color:#3e3550; font-size:14px; line-height:1.5;">
              <strong>Cierre administración:</strong><br>
              ${escapeHtml(sol.respuestaAdministracion)}
            </div>
          ` : ""}
        </div>

        <a
          href="fichas.html?id=${encodeURIComponent(idGrupo)}"
          target="_blank"
          rel="noopener"
          style="flex:0 0 auto; text-decoration:none; background:#3b2357; color:#fff; border-radius:999px; padding:10px 14px; font-weight:700; white-space:nowrap;"
        >
          Abrir ficha
        </a>
      </div>
    `;
  }).join("");
}

function openSolicitudesActualizacionModal() {
  const dialog = $("modal-solicitudes-actualizacion");
  if (!dialog) return;

  const effectiveUser = getEffectiveUser();
  const rows = Array.isArray(state.solicitudesActualizacionRows)
    ? state.solicitudesActualizacionRows
    : [];

  renderSolicitudesActualizacionModal(rows, effectiveUser);

  if (typeof dialog.showModal === "function") {
    if (!dialog.open) dialog.showModal();
    return;
  }

  dialog.setAttribute("open", "open");
}

function closeSolicitudesActualizacionModal() {
  const dialog = $("modal-solicitudes-actualizacion");
  if (!dialog) return;

  if (typeof dialog.close === "function") {
    dialog.close();
    return;
  }

  dialog.removeAttribute("open");
}

function getAlertGroupId(alertRow = {}) {
  return String(alertRow.idGrupo || alertRow.groupId || "").trim();
}

function getAlertGroupRow(alertRow = {}) {
  const groupId = getAlertGroupId(alertRow);
  if (!groupId) return null;
  return state.rowsById.get(groupId) || null;
}

function isDashboardVisibleAlert(alertRow = {}) {
  return (
    alertRow.activa !== false &&
    alertRow.resuelta !== true &&
    alertRow.visibleEnIndex !== false
  );
}

function isCriticalIndexAlert(alertRow = {}) {
  return (
    isDashboardVisibleAlert(alertRow) &&
    normalizeLoose(alertRow.nivel || "") === "critica"
  );
}

function isWarningIndexAlert(alertRow = {}) {
  return (
    isDashboardVisibleAlert(alertRow) &&
    normalizeLoose(alertRow.nivel || "") === "warning"
  );
}

function formatAlertDate(value) {
  const d = timestampLikeToDate(value);
  if (!d) return "Sin fecha";

  return d.toLocaleString("es-CL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

function getAlertsForScope(rows = [], predicate = () => false) {
  const scopedIds = new Set(
    dedupeRowsByGroup(rows)
      .map((row) => getRowId(row))
      .filter(Boolean)
  );

  return (state.alertRows || [])
    .filter((alertRow) => predicate(alertRow))
    .map((alertRow) => ({
      ...alertRow,
      _groupRow: getAlertGroupRow(alertRow)
    }))
    .filter((alertRow) => {
      const groupId = getAlertGroupId(alertRow);
      return !!alertRow._groupRow && scopedIds.has(groupId);
    })
    .sort((a, b) => {
      const diffFecha =
        (timestampLikeToDate(b.fechaCreacion)?.getTime() || 0) -
        (timestampLikeToDate(a.fechaCreacion)?.getTime() || 0);

      if (diffFecha !== 0) return diffFecha;

      const aliasA = getAliasColegioSortKey(getRowAlias(a._groupRow || {}));
      const aliasB = getAliasColegioSortKey(getRowAlias(b._groupRow || {}));

      return aliasA.localeCompare(aliasB, "es", {
        sensitivity: "base",
        numeric: true
      });
    });
}

function getCriticalAlertsForScope(rows = []) {
  return getAlertsForScope(rows, isCriticalIndexAlert);
}

function getWarningAlertsForScope(rows = []) {
  return getAlertsForScope(rows, isWarningIndexAlert);
}

function getAlertasCriticasSubtitulo(user = null) {
  const effectiveUser = user || getEffectiveUser();
  if (!effectiveUser) {
    return "Listado de alertas críticas activas en la vista actual.";
  }

  if (isVendedorRole(effectiveUser)) {
    return "Aquí ves solo las alertas críticas activas de tus grupos.";
  }

  return "Aquí ves las alertas críticas activas según la vista actual del dashboard.";
}

function getAlertasWarningSubtitulo(user = null) {
  const effectiveUser = user || getEffectiveUser();
  if (!effectiveUser) {
    return "Listado de alertas pendientes activas en la vista actual.";
  }

  if (isVendedorRole(effectiveUser)) {
    return "Aquí ves solo las alertas pendientes activas de tus grupos.";
  }

  return "Aquí ves las alertas pendientes activas según la vista actual del dashboard.";
}

function renderAlertCardsHtml(rows = [], fallbackTitle = "Alerta") {
  if (!rows.length) {
    return `
      <div style="padding:16px 18px; border:1px solid rgba(60,40,90,.10); border-radius:16px; background:#faf8fd; color:#5d546d;">
        No hay alertas activas en esta categoría.
      </div>
    `;
  }

  return rows.map((alertRow) => {
    const groupRow = alertRow._groupRow || getAlertGroupRow(alertRow) || {};
    const idGrupo = getAlertGroupId(alertRow);
    const alias = getRowAlias(groupRow) || alertRow.aliasGrupo || `Grupo ${idGrupo}`;
    const vendedor = getRowVendorName(groupRow) || groupRow.vendedoraCorreo || "Sin vendedor";
    const creadoPor = String(alertRow.creadoPor || alertRow.creadoPorCorreo || "Sin autor").trim() || "Sin autor";
    const fecha = formatAlertDate(alertRow.fechaCreacion);
    const titulo = String(alertRow.titulo || fallbackTitle).trim();
    const mensaje = String(alertRow.mensaje || "Sin detalle").trim();

    return `
      <div style="padding:14px 16px; border:1px solid rgba(60,40,90,.12); border-radius:16px; background:#fff; display:flex; justify-content:space-between; gap:14px; align-items:flex-start;">
        <div style="min-width:0;">
          <div style="font-weight:800; color:#31194b; font-size:16px; line-height:1.2;">
            ${escapeHtml(alias)}
          </div>

          <div style="margin-top:6px; color:#6a6078; font-size:13px; line-height:1.45;">
            Vendedor(a): ${escapeHtml(vendedor)}<br>
            Título: ${escapeHtml(titulo)}<br>
            Creada por: ${escapeHtml(creadoPor)}<br>
            Fecha: ${escapeHtml(fecha)}
          </div>

          <div style="margin-top:10px; color:#3e3550; font-size:14px; line-height:1.5;">
            ${escapeHtml(mensaje)}
          </div>
        </div>

        <a
          href="grupo.html?id=${encodeURIComponent(idGrupo)}"
          target="_blank"
          rel="noopener"
          style="flex:0 0 auto; text-decoration:none; background:#3b2357; color:#fff; border-radius:999px; padding:10px 14px; font-weight:700; white-space:nowrap;"
        >
          Abrir grupo
        </a>
      </div>
    `;
  }).join("");
}

function renderAlertasCriticasModal(rows = [], effectiveUser = null) {
  const titleEl = $("alertas-criticas-titulo");
  const subtitleEl = $("alertas-criticas-subtitulo");
  const summaryEl = $("alertas-criticas-resumen");
  const listEl = $("alertas-criticas-lista");

  if (!titleEl || !subtitleEl || !summaryEl || !listEl) return;

  titleEl.textContent = "Alertas críticas";
  subtitleEl.textContent = getAlertasCriticasSubtitulo(effectiveUser);
  summaryEl.textContent = rows.length
    ? `Hay ${rows.length} alerta(s) crítica(s) activa(s) en tu vista actual.`
    : "No hay alertas críticas activas en esta vista.";

  listEl.innerHTML = renderAlertCardsHtml(rows, "Alerta crítica");
}

function renderAlertasWarningModal(rows = [], effectiveUser = null) {
  const titleEl = $("alertas-warning-titulo");
  const subtitleEl = $("alertas-warning-subtitulo");
  const summaryEl = $("alertas-warning-resumen");
  const listEl = $("alertas-warning-lista");

  if (!titleEl || !subtitleEl || !summaryEl || !listEl) return;

  titleEl.textContent = "Alertas pendientes";
  subtitleEl.textContent = getAlertasWarningSubtitulo(effectiveUser);
  summaryEl.textContent = rows.length
    ? `Hay ${rows.length} alerta(s) pendiente(s) activa(s) en tu vista actual.`
    : "No hay alertas pendientes activas en esta vista.";

  listEl.innerHTML = renderAlertCardsHtml(rows, "Alerta pendiente");
}

function openAlertasCriticasModal() {
  const dialog = $("modal-alertas-criticas");
  if (!dialog) return;

  const effectiveUser = getEffectiveUser();
  const rows = Array.isArray(state.alertasCriticasRows) ? state.alertasCriticasRows : [];

  renderAlertasCriticasModal(rows, effectiveUser);

  if (typeof dialog.showModal === "function") {
    if (!dialog.open) dialog.showModal();
    return;
  }

  dialog.setAttribute("open", "open");
}

function closeAlertasCriticasModal() {
  const dialog = $("modal-alertas-criticas");
  if (!dialog) return;

  if (typeof dialog.close === "function") {
    dialog.close();
    return;
  }

  dialog.removeAttribute("open");
}

function openAlertasWarningModal() {
  const dialog = $("modal-alertas-warning");
  if (!dialog) return;

  const effectiveUser = getEffectiveUser();
  const rows = Array.isArray(state.alertasWarningRows) ? state.alertasWarningRows : [];

  renderAlertasWarningModal(rows, effectiveUser);

  if (typeof dialog.showModal === "function") {
    if (!dialog.open) dialog.showModal();
    return;
  }

  dialog.setAttribute("open", "open");
}

function closeAlertasWarningModal() {
  const dialog = $("modal-alertas-warning");
  if (!dialog) return;

  if (typeof dialog.close === "function") {
    dialog.close();
    return;
  }

  dialog.removeAttribute("open");
}



/* =========================================================
   CARGA DE DATOS
========================================================= */
async function loadDashboardData() {
  const [groupsSnap, alertsSnap, solicitudesSnap] = await Promise.all([
    getDocs(collection(db, "ventas_cotizaciones")),
    getDocs(collection(db, ALERTAS_COLLECTION)),
    getDocs(collection(db, SOLICITUDES_COLLECTION))
  ]);

  state.rows = groupsSnap.docs.map((docSnap) => {
    const data = docSnap.data() || {};
    return {
      id: docSnap.id,
      idGrupo: data.idGrupo || docSnap.id,
      ...data
    };
  });

  state.rowsById = new Map(
    state.rows.map((row) => [getRowId(row), row])
  );

  state.alertRows = alertsSnap.docs.map((docSnap) => ({
    id: docSnap.id,
    ...docSnap.data()
  }));

  state.solicitudesRows = solicitudesSnap.docs.map((docSnap) => ({
    id: docSnap.id,
    ...docSnap.data()
  }));
}

/* =========================================================
   DASHBOARD BASE
========================================================= */
/* =========================================================
   DASHBOARD BASE
========================================================= */
function getYearBucketCounts(rows = []) {
  const baseYear = getDashboardBaseYear();
  const years = [baseYear, baseYear + 1, baseYear + 2];
  const counts = [0, 0, 0];

  rows.forEach((row) => {
    const y = getAnoViajeNumber(row);
    const index = years.indexOf(y);
    if (index >= 0) counts[index] += 1;
  });

  return {
    years,
    counts,
    total: rows.length
  };
}

function getDashboardVendorScope() {
  const effectiveUser = getEffectiveUser();
  if (!effectiveUser) return "";

  // Si el usuario efectivo es vendedor, el scope es su propio correo
  if (isVendedorRole(effectiveUser)) {
    return normalizeEmail(effectiveUser.email || "");
  }

  // Si es supervisión / registro / admin, usar el vendedor seleccionado en el dashboard
  return normalizeEmail(getVendorFilter(effectiveUser) || "");
}

function buildSeguimientoUrl({ bucket = "", ano = "", archivados = false } = {}) {
  const url = new URL("seguimiento.html", window.location.href);
  const vendor = getDashboardVendorScope();

  if (bucket) url.searchParams.set("dashboardBucket", String(bucket));
  if (ano) url.searchParams.set("ano", String(ano));
  if (archivados) url.searchParams.set("archivados", "1");
  if (vendor) url.searchParams.set("vendor", vendor);

  return `${url.pathname}${url.search}`;
}

function renderFlowAnchor({ label = "00", bucket = "", ano = "", archivados = false } = {}) {
  const href = buildSeguimientoUrl({ bucket, ano, archivados });

  return `
    <a
      href="${href}"
      class="flow-number-link"
      style="color:inherit;text-decoration:none;"
    >${label}</a>
  `;
}

function setAlertCountLink(targetId, count = 0, bucket = "") {
  const el = $(targetId);
  if (!el) return;

  const href = buildSeguimientoUrl({
    bucket,
    archivados: true
  });

  el.innerHTML = `
    <a
      href="${href}"
      class="flow-number-link"
      style="color:inherit;text-decoration:none;"
    >${count}</a>
  `;
}

function setAlertHref(targetId, bucket = "") {
  const el = $(targetId);
  if (!el) return;

  el.href = buildSeguimientoUrl({
    bucket,
    archivados: true
  });
}

function setSinAsignarManagementHref() {
  const el = $("link-sin-asignar");
  if (!el) return;
  el.href = "asignados.html?tab=sin_asignar";
}

function renderBucketLinks(targetId, bucket, rows = []) {
  const el = $(targetId);
  if (!el) return;

  const { years, counts, total } = getYearBucketCounts(rows);

  const [link1, link2, link3] = counts.map((count, index) =>
    renderFlowAnchor({
      label: pad2(count),
      bucket,
      ano: years[index]
    })
  );

  const totalLink = renderFlowAnchor({
    label: pad2(total),
    bucket,
    archivados: true
  });

  el.innerHTML = `${link1} | ${link2} | ${link3} | (${totalLink})`;
}

function renderSingleTotalLink(targetId, bucket, count = 0) {
  const el = $(targetId);
  if (!el) return;

  el.innerHTML = renderFlowAnchor({
    label: pad2(count),
    bucket,
    archivados: true
  });
}

function inicializarDashboardEnCeros() {
  state.scopedRows = [];
  state.fichasPorFirmarRows = [];
  state.fichasCorregidasRows = [];
  state.alertasCriticasRows = [];
  state.alertasWarningRows = [];
  state.solicitudesActualizacionRows = [];
  
  const setText = (id, value) => {
    const el = $(id);
    if (el) el.textContent = value;
  };

  const effectiveUser = getEffectiveUser();
  
  setText("count-sin-asignar", "0");
  setSinAsignarManagementHref();
  setText("count-a-contactar", "0");
  setText("count-fichas-firmar", "0");
  setText("count-fichas-corregidas", "0");
  setText("count-solicitudes-actualizacion", "0");
  setText("count-alertas-criticas", "0");
  setText("count-alertas-warning", "0");
  setText("count-reunion-3dias", "0");
  
  syncAlertRowsByRole(effectiveUser);

  renderBucketLinks("contactados-top", "contactados", []);
  renderBucketLinks("cotizando-top", "cotizando", []);
  renderBucketLinks("reunion-top", "reunion", []);
  renderBucketLinks("perdidas-top", "perdidas", []);
  renderBucketLinks("recotizando-top", "recotizando", []);
  renderBucketLinks("ganadas-top", "ganadas", []);
  renderFichaAdminBucketLinks("abiertas-top", "abiertas", []);
  renderFichaAdminBucketLinks("cerradas-top", "cerradas", []);
  renderFichaAdminBucketLinks("autorizadas-top", "autorizadas", []);
}

function renderDashboard(rows = []) {
  const setText = (id, value) => {
    const el = $(id);
    if (el) el.textContent = String(value);
  };

  const effectiveUser = getEffectiveUser();

  const scopedRows = dedupeRowsByGroup(rows);
  const allRows = dedupeRowsByGroup(state.rows);

  state.scopedRows = scopedRows;

  const contactados = getBucketRows(scopedRows, "contactados");
  const cotizando = getBucketRows(scopedRows, "cotizando");
  const reunion = getBucketRows(scopedRows, "reunion");
  const perdidas = getBucketRows(scopedRows, "perdidas");
  const recotizando = getBucketRows(scopedRows, "recotizando");
  const ganadas = getBucketRows(scopedRows, "ganadas");
  const autorizadas = getBucketRows(scopedRows, "autorizadas");
  const cerradas = getBucketRows(scopedRows, "cerradas");

  const fichasPorFirmar = getFichasPorFirmarSegunUsuario(scopedRows, effectiveUser);
  state.fichasPorFirmarRows = fichasPorFirmar;

  const fichasCorregidas = getFichasCorregidasSegunUsuario(scopedRows, effectiveUser);
  state.fichasCorregidasRows = fichasCorregidas;

  const ganadasScope = scopedRows.filter(isGanadaComercial);

  state.fichasAbiertasRows = ganadasScope
    .filter(isFichaAbiertaAdministrativa)
    .sort(sortRowsByAliasComparator);
  
  state.fichasCerradasRows = ganadasScope
    .filter(isFichaCerradaAdministrativa)
    .sort(sortRowsByAliasComparator);
  
  state.fichasAutorizadasRows = ganadasScope
    .filter(isFichaAutorizadaAdministrativa)
    .sort(sortRowsByAliasComparator);

  const solicitudesActualizacion = getSolicitudesActualizacionSegunUsuario(scopedRows, effectiveUser);
  state.solicitudesActualizacionRows = solicitudesActualizacion;
  
  const alertasCriticas = getCriticalAlertsForScope(scopedRows);
  state.alertasCriticasRows = alertasCriticas;
  
  const alertasWarning = getWarningAlertsForScope(scopedRows);
  state.alertasWarningRows = alertasWarning;

  const canSeeGlobalSinAsignar =
    isAdminDashboardRole(effectiveUser) ||
    isSupervisionDashboardRole(effectiveUser) ||
    isRegistroRole(effectiveUser);

  const sinAsignarRows = canSeeGlobalSinAsignar
    ? allRows.filter(isSinAsignar)
    : scopedRows.filter(isSinAsignar);

  const aContactarRows = scopedRows.filter(isAContactar);
  state.aContactarRows = aContactarRows;
  const reuniones3DiasRows = scopedRows.filter(isReunionEnProximosTresDias);

  // ALERTAS
  setText("count-sin-asignar", sinAsignarRows.length);
  setSinAsignarManagementHref();

  setText("count-a-contactar", aContactarRows.length);

  setText("count-fichas-firmar", fichasPorFirmar.length);
  setText("count-fichas-corregidas", fichasCorregidas.length);
  setText("count-solicitudes-actualizacion", solicitudesActualizacion.length);
  setText("count-alertas-criticas", alertasCriticas.length);
  setText("count-alertas-warning", alertasWarning.length);
  setText("count-reunion-3dias", reuniones3DiasRows.length);

  syncAlertRowsByRole(effectiveUser);

  // FLUJO CON LINKS
  renderBucketLinks("contactados-top", "contactados", contactados);
  renderBucketLinks("cotizando-top", "cotizando", cotizando);
  renderBucketLinks("reunion-top", "reunion", reunion);
  renderBucketLinks("perdidas-top", "perdidas", perdidas);
  renderBucketLinks("recotizando-top", "recotizando", recotizando);
  renderBucketLinks("ganadas-top", "ganadas", ganadas);
  renderFichaAdminBucketLinks("abiertas-top", "abiertas", state.fichasAbiertasRows);
  renderFichaAdminBucketLinks("cerradas-top", "cerradas", state.fichasCerradasRows);
  renderFichaAdminBucketLinks("autorizadas-top", "autorizadas", state.fichasAutorizadasRows);
}
/* =========================================================
   SELECTOR DE VENDEDORES
========================================================= */
function poblarSelectorVendedores(effectiveUser) {
  const select = $("select-vendedor");
  const btn = $("btn-ir-vendedor");

  if (!select || !btn || !effectiveUser) return;

  const vendorFilter = getVendorFilter(effectiveUser);
  const vendedores = getVendorUsers();

  select.innerHTML = "";

  if (isVendedorRole(effectiveUser)) {
    const option = document.createElement("option");
    option.value = normalizeEmail(effectiveUser.email);
    option.textContent = getNombreUsuario(effectiveUser);
    option.selected = true;
    select.appendChild(option);

    select.disabled = true;
    btn.disabled = true;
    btn.classList.add("ui-hidden");
    return;
  }

  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = "Todos";
  select.appendChild(defaultOption);

  vendedores.forEach((v) => {
    const option = document.createElement("option");
    option.value = normalizeEmail(v.email);
    option.textContent = `${v.nombre} ${v.apellido}`.trim() || getNombreUsuario(v);
    select.appendChild(option);
  });

  select.value = vendorFilter || "";
  select.disabled = false;
  btn.disabled = false;
  btn.classList.remove("ui-hidden");
}

function getAliasColegioSortKey(alias = "") {
  let text = String(alias || "").trim();

  // Quita el primer bloque tipo: 1C (2025)
  text = text.replace(/^[0-9A-Z]+(?:\s*[A-Z]+)?\s*\(\d{4}\)\s*/i, "");

  // Quita un segundo bloque si existe, por ejemplo:
  // 1C (2026) 2C (2027) COLEGIO...
  text = text.replace(/^[0-9A-Z]+(?:\s*[A-Z]+)?\s*\(\d{4}\)\s*/i, "");

  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function extraerBloquesCursoAnoDesdeAlias(alias = "") {
  let text = String(alias || "").trim();
  const bloques = [];

  while (bloques.length < 2) {
    const match = text.match(/^([0-9A-Z]+(?:\s*[A-Z]+)?\s*\(\d{4}\))\s*/i);
    if (!match) break;

    bloques.push(match[1].replace(/\s+/g, " ").trim());
    text = text.slice(match[0].length).trim();
  }

  return bloques;
}

function extraerColegioDesdeAlias(alias = "") {
  let text = String(alias || "").trim();

  text = text.replace(/^([0-9A-Z]+(?:\s*[A-Z]+)?\s*\(\d{4}\)\s*){1,2}/i, "").trim();
  text = text.replace(/^\s*[—\-|,:]+\s*/g, "").trim();

  return text;
}

function construirCursoAnoParaSelector(row = {}) {
  const alias = getRowAlias(row);
  const bloquesAlias = extraerBloquesCursoAnoDesdeAlias(alias);

  if (bloquesAlias.length) {
    return bloquesAlias.join(" ");
  }

  const curso = String(row.curso || "").trim();
  const anoMatch = String(row.anoViaje || "").match(/\d{4}/);
  const ano = anoMatch ? anoMatch[0] : "";

  if (curso && ano) return `${curso} (${ano})`;
  if (curso) return curso;
  if (ano) return `(${ano})`;

  return "";
}

function construirColegioParaSelector(row = {}) {
  const colegio = String(row.colegio || "").trim();
  if (colegio) return colegio;

  const alias = getRowAlias(row);
  const colegioDesdeAlias = extraerColegioDesdeAlias(alias);

  return colegioDesdeAlias || alias;
}

function construirLabelGrupoSelector(row = {}) {
  const colegio = construirColegioParaSelector(row);
  const cursoAno = construirCursoAnoParaSelector(row);
  const apoderado = getRowApoderado(row);

  return [colegio, cursoAno, apoderado]
    .filter((parte) => String(parte || "").trim())
    .join(" — ");
}

function construirSortKeyGrupoSelector(row = {}) {
  const colegio = construirColegioParaSelector(row);
  const cursoAno = construirCursoAnoParaSelector(row);
  const apoderado = getRowApoderado(row);

  return [
    normalizeLoose(colegio),
    normalizeLoose(cursoAno),
    normalizeLoose(apoderado)
  ].join(" | ");
}

/* =========================================================
   SELECTOR DE GRUPOS
========================================================= */
function poblarSelectorGrupos(effectiveUser, rows = []) {
  const select = $("select-grupo");
  const btn = $("btn-ir-grupo");

  if (!select || !btn || !effectiveUser) return;

  const vendorFilter = getVendorFilter(effectiveUser);
  const savedGroup = getGroupFilter();

  select.innerHTML = "";

  const defaultOption = document.createElement("option");
  defaultOption.value = "";

  if (isVendedorRole(effectiveUser)) {
    defaultOption.textContent = "Seleccionar Grupo";
  } else if (vendorFilter) {
    const vendedores = getVendorUsers();
    const vendedor = vendedores.find(
      (v) => normalizeEmail(v.email) === normalizeEmail(vendorFilter)
    );
    defaultOption.textContent = vendedor
      ? `Seleccionar Grupo (${`${vendedor.nombre} ${vendedor.apellido}`.trim()})`
      : "Seleccionar Grupo";
  } else {
    defaultOption.textContent = "Seleccionar Grupo";
  }

  select.appendChild(defaultOption);

  const items = rows
    .map((row) => ({
      value: getRowId(row),
      label: construirLabelGrupoSelector(row),
      sortKey: construirSortKeyGrupoSelector(row)
    }))
    .filter((item) => item.value)
    .sort((a, b) =>
      a.sortKey.localeCompare(b.sortKey, "es", {
        sensitivity: "base",
        numeric: true
      })
    );

  items.forEach((item) => {
    const option = document.createElement("option");
    option.value = item.value;
    option.textContent = item.label;
    select.appendChild(option);
  });

  const existsSaved = items.some((item) => item.value === savedGroup);

  if (existsSaved) {
    select.value = savedGroup;
  } else {
    select.value = "";
    clearGroupFilter();
  }

  select.disabled = !items.length;
  btn.disabled = !items.length;

  initSearchableSelect("select-grupo", "Buscar por colegio, curso, año o apoderado...");
}

/* =========================================================
   SELECTOR DE APODERADOS
========================================================= */
function poblarSelectorApoderados(rows = []) {
  const select = $("select-apoderado");
  const btn = $("btn-ir-apoderado");

  if (!select || !btn) return;

  const savedApoderado = getApoderadoFilter();

  select.innerHTML = `<option value="">Seleccionar Apoderado</option>`;

  const items = rows
    .map((row) => ({
      value: getRowId(row),
      label: `${getRowApoderado(row)} — ${getRowAlias(row)}`
    }))
    .filter((item) => item.value)
    .sort((a, b) => a.label.localeCompare(b.label, "es", { sensitivity: "base" }));

  items.forEach((item) => {
    const option = document.createElement("option");
    option.value = item.value;
    option.textContent = item.label;
    select.appendChild(option);
  });

  const existsSaved = items.some((item) => item.value === savedApoderado);

  if (existsSaved) {
    select.value = savedApoderado;
  } else {
    select.value = "";
    clearApoderadoFilter();
  }

  select.disabled = !items.length;
  btn.disabled = !items.length;

  initSearchableSelect("select-apoderado", "Buscar apoderado...");
}

/* =========================================================
   SCOPE VISUAL
========================================================= */
function buildScopeText(realUser, effectiveUser) {
  const vendorFilter = getVendorFilter(effectiveUser);
  const vendedores = getVendorUsers();

  let texto = "Vista general";

  if (isVendedorRole(effectiveUser)) {
    texto = `Vista personal: ${getNombreUsuario(effectiveUser)}`;
  } else if (isRegistroRole(effectiveUser)) {
    if (vendorFilter) {
      const vendedor = vendedores.find(
        (v) => normalizeEmail(v.email) === normalizeEmail(vendorFilter)
      );
      texto = vendedor
        ? `Vista observador · filtrada por vendedor(a): ${`${vendedor.nombre} ${vendedor.apellido}`.trim()}`
        : "Vista general · observador";
    } else {
      texto = "Vista general · observador";
    }
  } else {
    if (vendorFilter) {
      const vendedor = vendedores.find(
        (v) => normalizeEmail(v.email) === normalizeEmail(vendorFilter)
      );
      texto = vendedor
        ? `Vista filtrada por vendedor(a): ${`${vendedor.nombre} ${vendedor.apellido}`.trim()}`
        : "Vista general";
    } else {
      texto = "Vista general";
    }
  }

  if (isActingAsAnother(realUser, effectiveUser)) {
    return `Navegando como ${getNombreUsuario(effectiveUser)} · ${effectiveUser.rol} · ${texto}`;
  }

  return texto;
}

/* =========================================================
   RENDER
========================================================= */
async function renderPantalla() {
  const realUser = getRealUser();
  const effectiveUser = getEffectiveUser();

  if (!realUser || !effectiveUser) return;

  if (isVendedorRole(effectiveUser)) {
    setVendorFilter(effectiveUser.email);
  }

  setHeaderState({
    realUser,
    effectiveUser,
    scopeText: buildScopeText(realUser, effectiveUser)
  });

  renderActingUserSwitcher({
    realUser,
    effectiveUser,
    users: VENTAS_USERS
  });

  inicializarDashboardEnCeros();

  try {
    await Promise.all([
      loadDashboardData(),
      loadPrivateNote()
    ]);
  
    const rowsScope = getRowsForCurrentScope(effectiveUser);
  
    poblarSelectorVendedores(effectiveUser);
    poblarSelectorGrupos(effectiveUser, rowsScope);
    poblarSelectorApoderados(rowsScope);
    renderDashboard(rowsScope);
    initBuscadorDashboard();
  } catch (error) {
    console.error("Error cargando dashboard:", error);
    inicializarDashboardEnCeros();
  }
}

/* =========================================================
   INIT
========================================================= */
async function initPage() {
  await waitForLayoutReady();

  bindPrivateNotePanel();

  bindLayoutButtons({
    homeUrl: GITHUB_HOME_URL,
    onLogout: async () => {
      try {
        sessionStorage.removeItem(ACTING_USER_KEY);
        clearVendorFilter();
        clearGroupFilter();
        clearApoderadoFilter();
        await signOut(auth);
        location.href = "login.html";
      } catch (error) {
        alert("Error al cerrar sesión: " + error.message);
      }
    },
    onActAs: async (selectedEmail) => {
      const realUser = getRealUser();
      if (!realUser || realUser.rol !== "admin") return;
      if (!selectedEmail) return;

      sessionStorage.setItem(ACTING_USER_KEY, selectedEmail);
      clearVendorFilter();
      clearGroupFilter();
      clearApoderadoFilter();
      renderPantalla();
    },
    onResetActAs: async () => {
      sessionStorage.removeItem(ACTING_USER_KEY);
      clearVendorFilter();
      clearGroupFilter();
      clearApoderadoFilter();
      renderPantalla();
    }
  });

  const btnIrVendedor = $("btn-ir-vendedor");
  const btnIrGrupo = $("btn-ir-grupo");
  const btnIrApoderado = $("btn-ir-apoderado");

  const linkSinAsignar = $("link-sin-asignar");

  const linkAContactar = $("link-a-contactar");
  const btnCerrarAContactar = $("btn-cerrar-a-contactar");
  const modalAContactar = $("modal-a-contactar");

  const linkFichasFirmar = $("link-fichas-firmar");
  const linkFichasAbiertas = $("abiertas-top");
  const linkFichasCerradas = $("cerradas-top");
  const linkFichasAutorizadas = $("autorizadas-top");
  const btnCerrarFichasAdmin = $("btn-cerrar-fichas-admin");
  const modalFichasAdmin = $("modal-fichas-admin");
  const btnCerrarFichasFirmar = $("btn-cerrar-fichas-firmar");
  const modalFichasFirmar = $("modal-fichas-firmar");

  const linkFichasCorregidas = $("link-fichas-corregidas");
  const btnCerrarFichasCorregidas = $("btn-cerrar-fichas-corregidas");
  const modalFichasCorregidas = $("modal-fichas-corregidas");

  const linkSolicitudesActualizacion = $("link-solicitudes-actualizacion");
  const btnCerrarSolicitudesActualizacion = $("btn-cerrar-solicitudes-actualizacion");
  const modalSolicitudesActualizacion = $("modal-solicitudes-actualizacion");
  
  const linkAlertasCriticas = $("link-alertas-criticas");
  const btnCerrarAlertasCriticas = $("btn-cerrar-alertas-criticas");
  const modalAlertasCriticas = $("modal-alertas-criticas");
  
  const linkAlertasWarning = $("link-alertas-warning");
  const btnCerrarAlertasWarning = $("btn-cerrar-alertas-warning");
  const modalAlertasWarning = $("modal-alertas-warning");
  
  const selectGrupo = $("select-grupo");
  const selectApoderado = $("select-apoderado");

  if (btnIrVendedor && !btnIrVendedor.dataset.bound) {
    btnIrVendedor.dataset.bound = "1";

    btnIrVendedor.addEventListener("click", async () => {
      const effectiveUser = getEffectiveUser();
      if (!effectiveUser) return;

      if (isVendedorRole(effectiveUser)) {
        setVendorFilter(effectiveUser.email);
      } else {
        const selectedEmail = normalizeEmail($("select-vendedor")?.value || "");
        setVendorFilter(selectedEmail);
      }

      clearGroupFilter();
      clearApoderadoFilter();
      await renderPantalla();
    });
  }

  if (btnIrGrupo && !btnIrGrupo.dataset.bound) {
    btnIrGrupo.dataset.bound = "1";

    btnIrGrupo.addEventListener("click", () => {
      const grupoSeleccionado = String(selectGrupo?.value || "").trim();

      setGroupFilter(grupoSeleccionado);
      setApoderadoFilter(grupoSeleccionado);

      if (selectApoderado) {
        selectApoderado.value = grupoSeleccionado || "";
      }

      if (!grupoSeleccionado) {
        alert("Debes seleccionar un grupo.");
        return;
      }
      
      location.href = `grupo.html?id=${encodeURIComponent(grupoSeleccionado)}`;
    });
  }

  if (linkSinAsignar && !linkSinAsignar.dataset.boundPopup) {
    linkSinAsignar.dataset.boundPopup = "1";
  
    linkSinAsignar.addEventListener("click", (e) => {
      e.preventDefault();
  
      window.open(
        "asignados.html?tab=sin_asignar",
        "sinAsignarPopup",
        "width=1200,height=800,scrollbars=yes,resizable=yes"
      );
    });
  }
  
  if (linkAContactar && !linkAContactar.dataset.bound) {
    linkAContactar.dataset.bound = "1";
  
    linkAContactar.addEventListener("click", (e) => {
      e.preventDefault();
      openAContactarModal();
    });
  }
  
  if (btnCerrarAContactar && !btnCerrarAContactar.dataset.bound) {
    btnCerrarAContactar.dataset.bound = "1";
  
    btnCerrarAContactar.addEventListener("click", () => {
      closeAContactarModal();
    });
  }
  
  if (modalAContactar && !modalAContactar.dataset.bound) {
    modalAContactar.dataset.bound = "1";
  
    modalAContactar.addEventListener("click", (e) => {
      if (e.target === modalAContactar) {
        closeAContactarModal();
      }
    });
  }

  if (btnIrApoderado && !btnIrApoderado.dataset.bound) {
    btnIrApoderado.dataset.bound = "1";

    btnIrApoderado.addEventListener("click", () => {
      const apoderadoSeleccionado = String(selectApoderado?.value || "").trim();

      setApoderadoFilter(apoderadoSeleccionado);
      setGroupFilter(apoderadoSeleccionado);

      if (selectGrupo) {
        selectGrupo.value = apoderadoSeleccionado || "";
      }

      if (!apoderadoSeleccionado) {
        alert("Debes seleccionar un apoderado.");
        return;
      }
      
      location.href = `grupo.html?id=${encodeURIComponent(apoderadoSeleccionado)}`;
    });
  }

  if (linkFichasFirmar && !linkFichasFirmar.dataset.bound) {
    linkFichasFirmar.dataset.bound = "1";
  
    linkFichasFirmar.addEventListener("click", (e) => {
      e.preventDefault();
      openFichasPorFirmarModal();
    });
  }
  
  if (btnCerrarFichasFirmar && !btnCerrarFichasFirmar.dataset.bound) {
    btnCerrarFichasFirmar.dataset.bound = "1";
  
    btnCerrarFichasFirmar.addEventListener("click", () => {
      closeFichasPorFirmarModal();
    });
  }

  if (linkFichasCorregidas && !linkFichasCorregidas.dataset.bound) {
    linkFichasCorregidas.dataset.bound = "1";
  
    linkFichasCorregidas.addEventListener("click", (e) => {
      e.preventDefault();
      openFichasCorregidasModal();
    });
  }
  
  if (btnCerrarFichasCorregidas && !btnCerrarFichasCorregidas.dataset.bound) {
    btnCerrarFichasCorregidas.dataset.bound = "1";
  
    btnCerrarFichasCorregidas.addEventListener("click", () => {
      closeFichasCorregidasModal();
    });
  }
  
  if (modalFichasCorregidas && !modalFichasCorregidas.dataset.bound) {
    modalFichasCorregidas.dataset.bound = "1";
  
    modalFichasCorregidas.addEventListener("click", (e) => {
      if (e.target === modalFichasCorregidas) {
        closeFichasCorregidasModal();
      }
    });
  }

  [linkFichasAbiertas, linkFichasCerradas, linkFichasAutorizadas].forEach((link) => {
    if (!link || link.dataset.boundAdminBuckets) return;
  
    link.dataset.boundAdminBuckets = "1";
  
    link.addEventListener("click", (e) => {
      const clicked = e.target.closest("[data-fichas-admin-tipo]");
      if (!clicked) return;
  
      e.preventDefault();
  
      const tipo = clicked.dataset.fichasAdminTipo || "";
      const year = clicked.dataset.fichasAdminYear || "total";
  
      openFichasAdminModal(tipo, year);
    });
  });
  
  if (btnCerrarFichasAdmin && !btnCerrarFichasAdmin.dataset.bound) {
    btnCerrarFichasAdmin.dataset.bound = "1";
    btnCerrarFichasAdmin.addEventListener("click", closeFichasAdminModal);
  }
  
  if (modalFichasAdmin && !modalFichasAdmin.dataset.bound) {
    modalFichasAdmin.dataset.bound = "1";
    modalFichasAdmin.addEventListener("click", (e) => {
      if (e.target === modalFichasAdmin) closeFichasAdminModal();
    });
  }

  if (linkSolicitudesActualizacion && !linkSolicitudesActualizacion.dataset.bound) {
    linkSolicitudesActualizacion.dataset.bound = "1";
  
    linkSolicitudesActualizacion.addEventListener("click", (e) => {
      e.preventDefault();
      openSolicitudesActualizacionModal();
    });
  }
  
  if (btnCerrarSolicitudesActualizacion && !btnCerrarSolicitudesActualizacion.dataset.bound) {
    btnCerrarSolicitudesActualizacion.dataset.bound = "1";
  
    btnCerrarSolicitudesActualizacion.addEventListener("click", () => {
      closeSolicitudesActualizacionModal();
    });
  }
  
  if (modalSolicitudesActualizacion && !modalSolicitudesActualizacion.dataset.bound) {
    modalSolicitudesActualizacion.dataset.bound = "1";
  
    modalSolicitudesActualizacion.addEventListener("click", (e) => {
      if (e.target === modalSolicitudesActualizacion) {
        closeSolicitudesActualizacionModal();
      }
    });
  }

  if (linkAlertasCriticas && !linkAlertasCriticas.dataset.bound) {
    linkAlertasCriticas.dataset.bound = "1";
  
    linkAlertasCriticas.addEventListener("click", (e) => {
      e.preventDefault();
      openAlertasCriticasModal();
    });
  }
  
  if (btnCerrarAlertasCriticas && !btnCerrarAlertasCriticas.dataset.bound) {
    btnCerrarAlertasCriticas.dataset.bound = "1";
  
    btnCerrarAlertasCriticas.addEventListener("click", () => {
      closeAlertasCriticasModal();
    });
  }
  
  if (linkAlertasWarning && !linkAlertasWarning.dataset.bound) {
    linkAlertasWarning.dataset.bound = "1";
  
    linkAlertasWarning.addEventListener("click", (e) => {
      e.preventDefault();
      openAlertasWarningModal();
    });
  }
  
  if (btnCerrarAlertasWarning && !btnCerrarAlertasWarning.dataset.bound) {
    btnCerrarAlertasWarning.dataset.bound = "1";
  
    btnCerrarAlertasWarning.addEventListener("click", () => {
      closeAlertasWarningModal();
    });
  }
  
  if (modalFichasFirmar && !modalFichasFirmar.dataset.bound) {
    modalFichasFirmar.dataset.bound = "1";

    modalFichasFirmar.addEventListener("click", (e) => {
      if (e.target === modalFichasFirmar) {
        closeFichasPorFirmarModal();
      }
    });
  }

  if (modalAlertasCriticas && !modalAlertasCriticas.dataset.bound) {
    modalAlertasCriticas.dataset.bound = "1";
  
    modalAlertasCriticas.addEventListener("click", (e) => {
      if (e.target === modalAlertasCriticas) {
        closeAlertasCriticasModal();
      }
    });
  }

  if (modalAlertasWarning && !modalAlertasWarning.dataset.bound) {
    modalAlertasWarning.dataset.bound = "1";
  
    modalAlertasWarning.addEventListener("click", (e) => {
      if (e.target === modalAlertasWarning) {
        closeAlertasWarningModal();
      }
    });
  }

  onAuthStateChanged(auth, (user) => {
    if (!user) return;
    renderPantalla();
  });

  updateClockDataset();
  setInterval(updateClockDataset, 1000);
}

/* =========================================================
   BUSCADOR GLOBAL DE GRUPOS
========================================================= */

function buildSearchText(row = {}) {
  let text = "";

  function extract(obj) {
    if (!obj) return;
    if (typeof obj === "object") {
      Object.values(obj).forEach(extract);
    } else {
      text += " " + String(obj);
    }
  }

  extract(row);

  return normalizeLoose(text);
}

function evaluarBusqueda(textoGrupo, query) {
  const q = normalizeLoose(query);

  if (!q) return true;

  // OR
  if (q.includes("(o)")) {
    const parts = q.split("(o)").map(p => p.trim());
    return parts.some(p => textoGrupo.includes(p));
  }

  // AND
  if (q.includes("(y)")) {
    const parts = q.split("(y)").map(p => p.trim());
    return parts.every(p => textoGrupo.includes(p));
  }

  // default AND por palabras
  return q.split(" ").every(p => textoGrupo.includes(p));
}

function filtrarGruposPorBusqueda(rows, query) {
  if (!query) return rows;

  return rows.filter(row => {
    const text = buildSearchText(row);
    return evaluarBusqueda(text, query);
  });
}

function renderResultadosBusqueda(rows) {
  const cont = $("buscador-resultados");
  if (!cont) return;

  if (!rows.length) {
    cont.innerHTML = `<div class="buscador-item">Sin resultados</div>`;
    return;
  }

  cont.innerHTML = rows.slice(0, 20).map(row => {
    const id = getRowId(row);

    return `
      <div class="buscador-item" onclick="location.href='grupo.html?id=${id}'">
        <strong>${getRowAlias(row)}</strong><br>
        ${row.colegio || ""} — ${getRowApoderado(row)}<br>
        <span style="opacity:.6">${row.estado || ""}</span>
      </div>
    `;
  }).join("");
}

function initBuscadorDashboard() {
  const input = $("input-buscador-grupos");
  if (!input || input.dataset.bound) return;

  input.dataset.bound = "1";

  input.addEventListener("input", () => {
    const query = input.value;

    const baseRows = state.scopedRows || [];

    const filtrados = filtrarGruposPorBusqueda(baseRows, query);

    // 👉 render lista flotante
    renderResultadosBusqueda(filtrados);

    // 👉 actualizar TODO el dashboard con filtro
    renderDashboard(filtrados);
  });
}

initPage();
