// home.js — Home específico por usuario / rol para Ventas RT

import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.7.3/firebase-auth.js";
import {
  collection,
  getDocs
} from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";

import { auth, db, VENTAS_USERS } from "./firebase-init.js";

import {
  $,
  normalizeEmail,
  escapeHtml
} from "./utils.js";

import {
  ACTING_USER_KEY,
  getRealUser,
  getEffectiveUser,
  clearVendorFilter,
  clearGroupFilter,
  isVendedorRole,
  isRegistroRole
} from "./roles.js";

import {
  updateClockDataset,
  setHeaderState,
  renderActingUserSwitcher,
  bindLayoutButtons,
  waitForLayoutReady
} from "./ui.js";

/* =========================================================
   CONFIG
========================================================= */

const GITHUB_HOME_URL = "https://sistemas-raitrai.github.io/Ventas-RT/home.html";
const ALERTAS_COLLECTION = "ventas_alertas";
const SOLICITUDES_COLLECTION = "ventas_solicitudes_actualizacion";

/* =========================================================
   ESTADO
========================================================= */

const state = {
  rows: [],
  rowsById: new Map(),
  alertRows: [],
  solicitudesRows: [],
  anoFichaFiltro: String(new Date().getFullYear()),

  scopedRows: [],
  sinAsignarRows: [],
  aContactarRows: [],
  fichasPorFirmarRows: [],
  fichasCorregidasRows: [],
  fichasAbiertasRows: [],
  fichasCerradasRows: [],
  fichasAutorizadasRows: [],
  solicitudesActualizacionRows: [],
  alertasCriticasRows: [],
  alertasWarningRows: [],
  reuniones3DiasRows: []
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

function timestampLikeToDate(value) {
  if (!value) return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value?.toDate === "function") {
    const d = value.toDate();
    return Number.isNaN(d?.getTime?.()) ? null : d;
  }

  if (typeof value === "object" && typeof value.seconds === "number") {
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

function formatDate(value) {
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

function getRowId(row = {}) {
  return String(row.idGrupo || row.id || "").trim();
}

function getNumeroNegocio(row = {}) {
  return String(
    row.numeroNegocio ||
    row?.ficha?.numeroNegocio ||
    ""
  ).trim();
}

function getIdNegocioLabel(row = {}) {
  const id = getRowId(row);
  const numero = getNumeroNegocio(row);

  return numero ? `ID: ${id} / N°: ${numero}` : `ID: ${id}`;
}

function getAdminImportantChanges(row = {}) {
  const directos = Array.isArray(row.camposAdministracionModificados)
    ? row.camposAdministracionModificados
    : [];

  const ficha = Array.isArray(row?.ficha?.camposAdministracionModificados)
    ? row.ficha.camposAdministracionModificados
    : [];

  const flow = Array.isArray(row?.flowFicha?.camposAdministracionModificados)
    ? row.flowFicha.camposAdministracionModificados
    : [];

  return [...directos, ...ficha, ...flow].filter(Boolean);
}

function renderAdminImportantChanges(row = {}, user = null) {
  const effectiveUser = user || getEffectiveUser();
  if (!isAdministracionDashboardUser(effectiveUser)) return "";

  const changes = getAdminImportantChanges(row);
  if (!changes.length) return "";

  return `
    <div style="margin-top:10px; padding:10px 12px; border-radius:14px; background:#fff1f1; border:1px solid #f0b4b4; color:#9f1d1d; font-size:13px; line-height:1.45;">
      <strong>⚠ Campos administrativos modificados:</strong><br>
      ${changes.map((c) => `
        ${escapeHtml(c.label || c.campo || "Campo")} fue modificado de
        <strong>${escapeHtml(String(c.anterior ?? ""))}</strong>
        a
        <strong>${escapeHtml(String(c.nuevo ?? ""))}</strong>
      `).join("<br>")}
    </div>
  `;
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
  return String(row.nombreCliente || row.apoderado || "Sin apoderado").trim();
}

function getRowVendorEmail(row = {}) {
  return normalizeEmail(row.vendedoraCorreo || row.creadoPorCorreo || "");
}

function getRowVendorName(row = {}) {
  return String(row.vendedora || "").trim();
}

function getAnoViajeNumber(row = {}) {
  const raw = String(row.anoViaje ?? "").trim();
  const match = raw.match(/\d{4}/);
  if (!match) return null;

  const year = Number(match[0]);
  return Number.isFinite(year) ? year : null;
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

function dedupeRowsByGroup(rows = []) {
  const map = new Map();

  rows.forEach((row) => {
    const id = getRowId(row);
    if (!id) return;
    if (!map.has(id)) map.set(id, row);
  });

  return [...map.values()];
}

function getAliasColegioSortKey(value = "") {
  return normalizeLoose(value)
    .replace(/^\s*\d+[a-zA-Z]*\s*\(\d{4}\)\s*/g, "")
    .replace(/^\s*\d+[a-zA-Z]*\s*/g, "")
    .trim();
}

function sortRowsByAlias(rows = []) {
  return [...rows].sort((a, b) => {
    const aliasA = getAliasColegioSortKey(getRowAlias(a));
    const aliasB = getAliasColegioSortKey(getRowAlias(b));

    return aliasA.localeCompare(aliasB, "es", {
      sensitivity: "base",
      numeric: true
    });
  });
}

/* =========================================================
   ROLES / VISIBILIDAD
========================================================= */

function getRoleKey(user = {}) {
  return normalizeLoose(user?.rol || "");
}

function isAdminDashboardRole(user = {}) {
  return getRoleKey(user) === "admin";
}

function isSupervisionDashboardRole(user = {}) {
  return getRoleKey(user) === "supervision";
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

function tienePdfRealFicha(row = {}) {
  return !!String(
    row?.ficha?.pdfUrl ||
    row?.fichaPdfUrl ||
    row?.pdfUrl ||
    ""
  ).trim();
}

function isPdfPendienteGeneracion(row = {}) {
  return (
    row?.ficha?.pdfPendienteGeneracion === true ||
    row?.pdfPendienteGeneracion === true ||
    row?.fichaPdfPendienteGeneracion === true
  );
}

function tuvoPdfOficialAlgunaVez(row = {}) {
  return !!String(
    row?.ficha?.storagePathPdf ||
    row?.ficha?.confirmadaEl ||
    row?.ficha?.confirmadaPor ||
    row?.ultimaGestionTipo === "confirmacion_ficha_pdf" ||
    row?.versionFichaNumero > 1 ||
    row?.ficha?.versionNumero > 1 ||
    ""
  ).trim();
}

function isCorreccionFichaPendiente(row = {}) {
  const flow = row.flowFicha || {};
  const estado = normalizeLoose(flow.correccionEstado || "");
  const modo = normalizeLoose(flow.modo || row.fichaFlujoModo || "");

  const firmasCompletas = hasAllThreeFichaFirmas(row);
  const pdfGenerado = tienePdfRealFicha(row);
  const pdfPendiente = isPdfPendienteGeneracion(row);
  const flujoAbierto = row.fichaFlujoAbierto === true;

  // Si ya están las 3 firmas, ya existe PDF real, no hay PDF pendiente
  // y el flujo está cerrado, NO puede seguir como corrección pendiente.
  if (firmasCompletas && pdfGenerado && !pdfPendiente && !flujoAbierto) {
    return false;
  }

  return (
    flow.correccionPendiente === true ||
    estado === "pendiente_jefa" ||
    estado === "pendiente_administracion" ||
    (
      modo === "correccion" &&
      flujoAbierto
    ) ||
    (
      modo === "correccion" &&
      pdfPendiente
    )
  );
}

function getCorreccionFichaEstado(row = {}) {
  const flow = row.flowFicha || {};
  const estado = normalizeLoose(flow.correccionEstado || "");

  if (estado) return estado;

  if (
    flow.requiereRefirmaAdministracion === true &&
    tuvoPdfOficialAlgunaVez(row)
  ) {
    if (flow?.jefaVentas?.firmado) return "pendiente_administracion";
    return "pendiente_jefa";
  }

  return "";
}

function isFichaCorregidaVisibleParaUsuario(row = {}, user = null) {
  const effectiveUser = user || getEffectiveUser();
  if (!effectiveUser) return false;

  // Solo si hay corrección realmente pendiente
  if (!isCorreccionFichaPendiente(row)) return false;

  const estado = getCorreccionFichaEstado(row);
  const rol = normalizeLoose(effectiveUser.rol || "");

  // Admin real ve todas las correcciones activas
  if (rol === "admin") return true;

  // Jefa de ventas solo ve las que están pendientes para ella
  if (isCaroDashboardUser(effectiveUser)) {
    return estado === "pendiente_jefa";
  }

  // Administración solo ve las que ya pasaron por jefa
  if (isAdministracionDashboardUser(effectiveUser)) {
    return estado === "pendiente_administracion";
  }

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

function getCorreccionDetalle(row = {}) {
  return String(
    row?.ultimaCorreccion?.detalle ||
    row?.flowFicha?.ultimaCorreccion?.detalle ||
    row?.ficha?.ultimaCorreccion?.detalle ||
    row?.ultimaCorreccion?.asunto ||
    row?.flowFicha?.ultimaCorreccion?.asunto ||
    ""
  ).trim();
}

function getTextoResumen(texto = "", max = 90) {
  const clean = String(texto || "").trim();
  if (clean.length <= max) return clean;
  return clean.slice(0, max).trim() + "...";
}

function renderMotivoCorreccion(row = {}) {
  const detalle = getCorreccionDetalle(row);
  if (!detalle) return "";

  const resumen = getTextoResumen(detalle, 90);
  const uid = `motivo-correccion-${getRowId(row)}`;

  return `
    <div style="margin-top:10px; padding:10px 12px; border-radius:14px; background:#fff8eb; border:1px solid #f0c27a; color:#5f3b00; font-size:13px; line-height:1.45;">
      <strong>Motivo:</strong> ${escapeHtml(resumen)}

      <button
        type="button"
        data-toggle-motivo="${escapeHtml(uid)}"
        style="margin-left:8px; border:0; background:#f2dfbd; color:#4b2d00; border-radius:999px; padding:5px 9px; font-weight:800; cursor:pointer;"
      >
        Ver motivo
      </button>

      <div
        id="${escapeHtml(uid)}"
        hidden
        style="margin-top:10px; padding-top:10px; border-top:1px solid #e8c98f;"
      >
        <strong>Motivo completo:</strong><br>
        ${escapeHtml(detalle)}
      </div>
    </div>
  `;
}

function getRowsForCurrentScope(effectiveUser) {
  if (!effectiveUser) return [];

  if (isVendedorRole(effectiveUser)) {
    const email = normalizeEmail(effectiveUser.email || "");
    return dedupeRowsByGroup(
      state.rows.filter((row) => getRowVendorEmail(row) === email)
    );
  }

  return dedupeRowsByGroup(state.rows);
}

function syncAlertRowsByRole(effectiveUser = null) {
  const user = effectiveUser || getEffectiveUser();

  const canSeeSinAsignar =
    isAdminDashboardRole(user) ||
    isSupervisionDashboardRole(user) ||
    isRegistroRole(user);

  setAlertRowVisibleByChild("link-sin-asignar", canSeeSinAsignar);
  setAlertRowVisibleByChild("link-fichas-firmar", !!user);
  setAlertRowVisibleByChild("link-fichas-corregidas", !!user);
  setAlertRowVisibleByChild("link-solicitudes-actualizacion", !!user);
  setAlertRowVisibleByChild("link-alertas-criticas", !!user);
  setAlertRowVisibleByChild("link-alertas-warning", !!user);
  setAlertRowVisibleByChild("link-reunion-3dias", !!user);
}

function setAlertRowVisibleByChild(childId, visible = true) {
  const child = $(childId);
  const row = child?.closest(".alert-row") || child?.closest(".alert-row-wrap");
  if (!row) return;

  row.style.display = visible ? "" : "none";
}

/* =========================================================
   ESTADOS / FICHAS
========================================================= */

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

function isGanadaComercial(row = {}) {
  return resolveEstadoBucket(row) === "ganadas";
}

function getFichaFirmas(row = {}) {
  const flow = row.flowFicha || {};

  return {
    vendedor: !!flow?.vendedor?.firmado || isTruthyFlag(row.firmaVendedor),
    jefa: !!flow?.jefaVentas?.firmado || isTruthyFlag(row.firmaSupervision),
    admin: !!flow?.administracion?.firmado || isTruthyFlag(row.firmaAdministracion)
  };
}

function hasAllThreeFichaFirmas(row = {}) {
  const firmas = getFichaFirmas(row);
  return !!(firmas.vendedor && firmas.jefa && firmas.admin);
}

function getAdminValue(row = {}, fichaKey = "", rootKey = "") {
  return String(row?.ficha?.[fichaKey] || row?.[rootKey] || row?.[fichaKey] || "").trim();
}

function tuvoFirmaAdministracionAlgunaVez(row = {}) {
  const flow = row.flowFicha || {};
  return !!flow?.administracion?.firmado || !!flow?.administracion?.firmadoAt || !!flow?.administracion?.firmadoPor || !!row.firmaAdministracion || !!row.fechaFirmaAdministracion || row.autorizada === true;
}

function isFichaAbiertaAdministrativa(row = {}) {
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
    isCorreccionFichaPendiente(row) ||
    row.fichaFlujoAbierto === true ||
    isPdfPendienteGeneracion(row)
  );
}

function isFichaCerradaAdministrativa(row = {}) {
  const firmas = getFichaFirmas(row);
  return firmas.vendedor && firmas.jefa && firmas.admin && !isFichaAbiertaAdministrativa(row);
}

function isFichaAutorizadaAdministrativa(row = {}) {
  const estado = normalizeLoose(row.estado || "");

  // Si pasa a perdida, deja de contar como autorizada
  if (estado.includes("perdid")) return false;

  return row.autorizada === true || tienePdfRealFicha(row);
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

  const ano = getAnoViajeNumber(row);

  if (!ano || ano < 2026) return false;
  if (!isGanadaComercial(row)) return false;

  const flow = row.flowFicha || {};
  const flowMode = normalizeLoose(
    row.fichaFlujoModo ||
    row?.flowFicha?.modo ||
    row?.ficha?.flujoModo ||
    ""
  );

  if (
    flowMode === "actualizacion" ||
    flowMode === "correccion" ||
    flow.correccionPendiente === true ||
    flow.requiereActualizacion === true ||
    row.fichaFlujoAbierto === true ||
    isCorreccionFichaPendiente(row)
  ) {
    return false;
  }

  if (
    tienePdfRealFicha(row) ||
    tuvoPdfOficialAlgunaVez(row) ||
    row.autorizada === true ||
    Number(row.versionFichaNumero || row?.ficha?.versionNumero || 0) > 1
  ) {
    return false;
  }

  const firmas = getFichaFirmas(row);

  if (isVendedorRole(user)) {
    return !firmas.vendedor;
  }

  if (isCaroDashboardUser(user)) {
    return firmas.vendedor && !firmas.jefa;
  }

  if (isAdministracionDashboardUser(user)) {
    return firmas.vendedor && firmas.jefa && !firmas.admin;
  }

  return !hasAllThreeFichaFirmas(row);
}

function isSolicitudActualizacionAbierta(sol = {}) {
  const tipo = normalizeLoose(sol.tipoSolicitud || "");
  const estado = normalizeLoose(sol.estadoSolicitud || "");

  return (
    tipo === "actualizacion_ficha" &&
    sol.resuelta !== true &&
    estado !== "completada" &&
    estado !== "cerrada"
  );
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

    return solicitadoPor === userEmail || vendedorGrupo === userEmail;
  }

  return false;
}

function getSolicitudEstadoLabel(sol = {}) {
  const estado = normalizeLoose(sol.estadoSolicitud || "");

  if (estado === "pendiente") return "Pendiente revisión jefa de ventas";
  if (estado === "revisada_jefa") return "Revisada por jefa / pendiente Administración";
  if (estado === "completada") return "Cerrada por Administración";

  return sol.estadoSolicitud || "Sin estado";
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

/* =========================================================
   ALERTAS FIRESTORE
========================================================= */

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

/* =========================================================
   CARGA DE DATOS
========================================================= */

async function loadHomeData() {
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
   RENDER ALERTAS
========================================================= */

function setText(id, value) {
  const el = $(id);
  if (el) el.textContent = String(value);
}

function poblarSelectorAnoFichas(scopedRows = []) {
  const select = $("select-home-ano-fichas");
  if (!select) return;

  const currentYear = String(new Date().getFullYear());

  const years = [...new Set(
    scopedRows
      .map((row) => getAnoViajeNumber(row))
      .filter(Boolean)
      .map(String)
  )].sort();

  if (!years.includes(currentYear)) {
    years.unshift(currentYear);
  }

  const currentValue = state.anoFichaFiltro || currentYear;

  select.innerHTML = `
    <option value="">Todos los años</option>
    ${years.map((year) => `
      <option value="${escapeHtml(year)}">${escapeHtml(year)}</option>
    `).join("")}
  `;

  select.value = years.includes(currentValue) ? currentValue : currentYear;
  state.anoFichaFiltro = select.value;
}

function renderHome() {
  const effectiveUser = getEffectiveUser();
  const scopedRows = getRowsForCurrentScope(effectiveUser);

  state.scopedRows = scopedRows;
  poblarSelectorAnoFichas(scopedRows);

  const canSeeGlobalSinAsignar =
    isAdminDashboardRole(effectiveUser) ||
    isSupervisionDashboardRole(effectiveUser) ||
    isRegistroRole(effectiveUser);

  state.sinAsignarRows = canSeeGlobalSinAsignar
    ? dedupeRowsByGroup(state.rows).filter(isSinAsignar)
    : [];

  state.aContactarRows = sortRowsByAlias(scopedRows.filter(isAContactar));

  // Excluir de "Fichas por firmar" las fichas que están en solicitud de actualización abierta.
  // Esas deben aparecer solo en "Solicitudes de actualización", no duplicadas en firma general.
  const solicitudesAbiertasIds = new Set(
    (state.solicitudesRows || [])
      .filter(isSolicitudActualizacionAbierta)
      .flatMap((sol) => [
        String(sol.idGrupo || "").trim(),
        String(sol.codigoRegistro || "").trim()
      ])
      .filter(Boolean)
  );
  
  state.fichasCorregidasRows = sortRowsByAlias(
    scopedRows.filter((row) => isFichaCorregidaVisibleParaUsuario(row, effectiveUser))
  );

  const ganadasScopeBase = scopedRows.filter((row) => {
    const ano = getAnoViajeNumber(row);
    return isGanadaComercial(row) && ano >= 2026;
  });

  const ganadasScope = state.anoFichaFiltro
    ? ganadasScopeBase.filter((row) => String(getAnoViajeNumber(row)) === String(state.anoFichaFiltro))
    : ganadasScopeBase;

  state.fichasAbiertasRows = sortRowsByAlias(
    ganadasScope.filter(isFichaAbiertaAdministrativa)
  );
  
  state.fichasCerradasRows = sortRowsByAlias(
    ganadasScope.filter(isFichaCerradaAdministrativa)
  );
  
  state.fichasAutorizadasRows = sortRowsByAlias(
    ganadasScope.filter(isFichaAutorizadaAdministrativa)
  );
  
  state.fichasPorFirmarRows = sortRowsByAlias(
    scopedRows.filter((row) => {
      const posiblesIds = [
        String(row.idGrupo || "").trim(),
        String(row.id || "").trim(),
        String(row.codigoRegistro || "").trim()
      ].filter(Boolean);
  
      const tieneSolicitudAbierta = posiblesIds.some((id) =>
        solicitudesAbiertasIds.has(id)
      );
  
      if (tieneSolicitudAbierta) return false;
  
      // Si está en corrección interna, NO es ficha nueva por firmar.
      if (isCorreccionFichaPendiente(row)) return false;
  
      return isFichaPorFirmarSegunUsuario(row, effectiveUser);
    })
  );

  const scopedIds = new Set(
    scopedRows.map((row) => getRowId(row)).filter(Boolean)
  );

  state.solicitudesActualizacionRows = (state.solicitudesRows || [])
    .map((sol) => {
      const idGrupo = String(sol.idGrupo || "").trim();
      const groupRow = state.rowsById.get(idGrupo) || {};
      return { ...sol, _groupRow: groupRow };
    })
    .filter((sol) => {
      const idGrupo = String(sol.idGrupo || "").trim();
      if (!scopedIds.has(idGrupo)) return false;
      return isSolicitudVisibleParaUsuario(sol, effectiveUser, sol._groupRow || {});
    })
    .sort((a, b) => {
      const da = timestampLikeToDate(a.fechaSolicitud)?.getTime() || 0;
      const db = timestampLikeToDate(b.fechaSolicitud)?.getTime() || 0;
      return db - da;
    });

  state.alertasCriticasRows = getAlertsForScope(scopedRows, isCriticalIndexAlert);
  state.alertasWarningRows = getAlertsForScope(scopedRows, isWarningIndexAlert);
  state.reuniones3DiasRows = sortRowsByAlias(scopedRows.filter(isReunionEnProximosTresDias));

  setText("count-sin-asignar", state.sinAsignarRows.length);
  setText("count-a-contactar", state.aContactarRows.length);
  setText("count-fichas-firmar", state.fichasPorFirmarRows.length);
  setText("count-fichas-corregidas", state.fichasCorregidasRows.length);
  setText("count-home-fichas-abiertas", state.fichasAbiertasRows.length);
  setText("count-home-fichas-cerradas", state.fichasCerradasRows.length);
  setText("count-home-fichas-autorizadas", state.fichasAutorizadasRows.length);
  setText("count-solicitudes-actualizacion", state.solicitudesActualizacionRows.length);
  setText("count-alertas-criticas", state.alertasCriticasRows.length);
  setText("count-alertas-warning", state.alertasWarningRows.length);
  setText("count-reunion-3dias", state.reuniones3DiasRows.length);

  syncAlertRowsByRole(effectiveUser);
}

/* =========================================================
   MODALES LISTADO ALERTAS
========================================================= */

function openDialog(dialog) {
  if (!dialog) return;

  if (typeof dialog.showModal === "function") {
    if (!dialog.open) dialog.showModal();
    return;
  }

  dialog.setAttribute("open", "open");
}

function closeDialog(dialog) {
  if (!dialog) return;

  if (typeof dialog.close === "function") {
    dialog.close();
    return;
  }

  dialog.removeAttribute("open");
}

function openListadoModal({
  titulo = "Listado",
  subtitulo = "",
  resumen = "",
  html = "",
  rows = [],
  renderFn = null
} = {}) {
  const dialog = $("modal-listado-home");
  const buscador = $("modal-listado-buscador");
  const contenido = $("modal-listado-contenido");

  setText("modal-listado-titulo", titulo);
  setText("modal-listado-subtitulo", subtitulo);
  setText("modal-listado-resumen", resumen);

  if (buscador) {
    buscador.value = "";
  }

  const pintar = (lista = rows) => {
    if (!contenido) return;

    if (typeof renderFn === "function") {
      contenido.innerHTML = renderFn(lista);
      return;
    }

    contenido.innerHTML = html || emptyHtml("No hay registros para mostrar.");
  };

  pintar(rows);

  if (buscador && !buscador.dataset.boundModalListado) {
    buscador.dataset.boundModalListado = "1";

    buscador.addEventListener("input", () => {
      const q = buscador.value;

      const filtradas = rows.filter((item) =>
        evaluarBusqueda(buildSearchText(item), q)
      );

      pintar(q.trim() ? filtradas : rows);
    });
  }

  openDialog(dialog);

  setTimeout(() => {
    if (buscador) buscador.focus();
  }, 120);
}

function emptyHtml(text = "Sin resultados.") {
  return `<div class="home-empty">${escapeHtml(text)}</div>`;
}

function renderGroupCards(rows = [], options = {}) {
  const {
    buttonLabel = "Abrir grupo",
    hrefBase = "grupo.html",
    extraRenderer = null
  } = options;

  if (!rows.length) return emptyHtml("No hay registros para mostrar.");

  return rows.map((row) => {
    const id = getRowId(row);
    const alias = getRowAlias(row);
    const vendedor = getRowVendorName(row) || row.vendedoraCorreo || "Sin vendedor";
    const idNegocio = getIdNegocioLabel(row);

    const extra = typeof extraRenderer === "function"
      ? extraRenderer(row)
      : "";

    return `
      <div class="home-card-row">
        <div style="min-width:0;">
          <div class="home-card-row-title">${escapeHtml(alias)}</div>

          <div class="home-card-row-text">
            ${escapeHtml(idNegocio)}<br>
            Colegio: ${escapeHtml(row.colegio || "Sin colegio")}<br>
            Curso: ${escapeHtml(row.curso || "Sin curso")} · Año: ${escapeHtml(row.anoViaje || "Sin año")}<br>
            Apoderado: ${escapeHtml(getRowApoderado(row))}<br>
            Vendedor(a): ${escapeHtml(vendedor)}<br>
            Estado: ${escapeHtml(row.estado || "Sin estado")}
          </div>

          ${extra}
        </div>

        <a
          href="${hrefBase}?id=${encodeURIComponent(id)}"
          target="_blank"
          rel="noopener"
          class="home-btn"
        >
          ${escapeHtml(buttonLabel)}
        </a>
      </div>
    `;
  }).join("");
}

function renderAlertCards(rows = []) {
  if (!rows.length) return emptyHtml("No hay alertas activas.");

  return rows.map((alertRow) => {
    const groupRow = alertRow._groupRow || getAlertGroupRow(alertRow) || {};
    const idGrupo = getAlertGroupId(alertRow);
    const alias = getRowAlias(groupRow) || alertRow.aliasGrupo || `Grupo ${idGrupo}`;
    const vendedor = getRowVendorName(groupRow) || groupRow.vendedoraCorreo || "Sin vendedor";
    const titulo = String(alertRow.titulo || "Alerta").trim();
    const mensaje = String(alertRow.mensaje || "Sin detalle").trim();
    const creadoPor = String(alertRow.creadoPor || alertRow.creadoPorCorreo || "Sin autor").trim();

    return `
      <div class="home-card-row">
        <div style="min-width:0;">
          <div class="home-card-row-title">${escapeHtml(alias)}</div>

          <div class="home-card-row-text">
            Vendedor(a): ${escapeHtml(vendedor)}<br>
            Título: ${escapeHtml(titulo)}<br>
            Creada por: ${escapeHtml(creadoPor)}<br>
            Fecha: ${escapeHtml(formatDate(alertRow.fechaCreacion))}
          </div>

          <div style="margin-top:10px; color:#3e3550; font-size:14px; line-height:1.5;">
            ${escapeHtml(mensaje)}
          </div>
        </div>

        <a
          href="grupo.html?id=${encodeURIComponent(idGrupo)}"
          target="_blank"
          rel="noopener"
          class="home-btn"
        >
          Abrir grupo
        </a>
      </div>
    `;
  }).join("");
}

function renderSolicitudesCards(rows = []) {
  if (!rows.length) return emptyHtml("No hay solicitudes de actualización abiertas.");

  const effectiveUser = getEffectiveUser();

  return rows.map((sol) => {
    const groupRow = sol._groupRow || {};
    const idGrupo = String(sol.idGrupo || "").trim();
    const alias = getRowAlias(groupRow) || sol.aliasGrupo || `Grupo ${idGrupo}`;
    const vendedor = getRowVendorName(groupRow) || groupRow.vendedoraCorreo || sol.solicitadoPor || "Sin vendedor";
    const idNegocio = getIdNegocioLabel(groupRow);
    const adminChangesHtml = renderAdminImportantChanges(groupRow, effectiveUser);

    return `
      <div class="home-card-row">
        <div style="min-width:0;">
          <div class="home-card-row-title">${escapeHtml(alias)}</div>

          <div class="home-card-row-text">
            ${escapeHtml(idNegocio)}<br>
            Vendedor(a): ${escapeHtml(vendedor)}<br>
            Estado: ${escapeHtml(getSolicitudEstadoLabel(sol))}<br>
            Fecha solicitud: ${escapeHtml(formatDate(sol.fechaSolicitud))}
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

          ${adminChangesHtml}
        </div>

        <a
          href="fichas.html?id=${encodeURIComponent(idGrupo)}"
          target="_blank"
          rel="noopener"
          class="home-btn"
        >
          Abrir ficha
        </a>
      </div>
    `;
  }).join("");
}

/* =========================================================
   BUSCADORES
========================================================= */

function buildSearchText(obj = {}) {
  let text = "";

  function extract(value) {
    if (value === null || value === undefined) return;

    if (value instanceof Date) {
      text += " " + value.toISOString();
      return;
    }

    if (typeof value?.toDate === "function") {
      text += " " + value.toDate().toISOString();
      return;
    }

    if (Array.isArray(value)) {
      value.forEach(extract);
      return;
    }

    if (typeof value === "object") {
      Object.values(value).forEach(extract);
      return;
    }

    text += " " + String(value);
  }

  extract(obj);

  return normalizeLoose(text);
}

function evaluarBusqueda(texto, query) {
  const q = normalizeLoose(query);
  if (!q) return false;

  if (q.includes("(o)")) {
    const parts = q.split("(o)").map((p) => p.trim()).filter(Boolean);
    return parts.some((p) => texto.includes(p));
  }

  if (q.includes("(y)")) {
    const parts = q.split("(y)").map((p) => p.trim()).filter(Boolean);
    return parts.every((p) => texto.includes(p));
  }

  return q.split(/\s+/).filter(Boolean).every((p) => texto.includes(p));
}

function filtrarRows(rows = [], query = "") {
  return rows.filter((row) => evaluarBusqueda(buildSearchText(row), query));
}

function hasFichaSignal(row = {}) {
  const flow = row.flowFicha || {};
  const ficha = row.ficha || {};

  const rootSignals = [
    row.solicitudReserva,
    row.versionFicha,
    row.fechaActualizacionFicha,
    row.fichaEstado,
    row.fichaPdfUrl,
    row.numeroNegocio,
    row.usuarioProgramaAdm,
    row.claveAdministrativa,
    row.asistenciaEnViajes,
    row.liberados,
    row.valorPrograma,
    row.cierre,
    row.firmaVendedor,
    row.firmaSupervision,
    row.firmaAdministracion
  ];

  return (
    Object.keys(flow).length > 0 ||
    Object.keys(ficha).length > 0 ||
    rootSignals.some((value) => String(value ?? "").trim() !== "")
  );
}

function renderResultadosGrupos(rows = []) {
  const cont = $("resultados-grupos-home");
  if (!cont) return;

  if (!rows.length) {
    cont.innerHTML = emptyHtml("Sin resultados de grupos.");
    return;
  }

  cont.innerHTML = rows.slice(0, 40).map((row) => {
    const id = getRowId(row);

    return `
      <div class="home-result-item" data-open-group="${escapeHtml(id)}">
        <strong>${escapeHtml(getRowAlias(row))}</strong>
        <span>
          ${escapeHtml(row.colegio || "Sin colegio")} · ${escapeHtml(row.curso || "Sin curso")} · ${escapeHtml(row.anoViaje || "Sin año")}<br>
          ${escapeHtml(getRowApoderado(row))} · ${escapeHtml(row.estado || "Sin estado")}
        </span>
      </div>
    `;
  }).join("");
}

function renderResultadosFichas(rows = []) {
  const cont = $("resultados-fichas-home");
  if (!cont) return;

  if (!rows.length) {
    cont.innerHTML = emptyHtml("Sin resultados de fichas.");
    return;
  }

  cont.innerHTML = rows.slice(0, 40).map((row) => {
    const id = getRowId(row);
    const pendiente = getFichaPendienteLabel(row);

    return `
      <div class="home-result-item" data-open-ficha="${escapeHtml(id)}">
        <strong>${escapeHtml(getRowAlias(row))}</strong>
        <span>
          Negocio: ${escapeHtml(row.numeroNegocio || "Sin número")} · Versión: ${escapeHtml(row.versionFicha || "Sin versión")}<br>
          ${escapeHtml(pendiente)} · ${escapeHtml(row.cierre || "Sin cierre")}
        </span>
      </div>
    `;
  }).join("");
}

function initSearchers() {
  const inputGrupos = $("input-buscador-grupos-home");
  const inputFichas = $("input-buscador-fichas-home");
  const btnBuscarGrupos = $("btn-buscar-grupos-home");
  const btnBuscarFichas = $("btn-buscar-fichas-home");

  const ejecutarBusquedaGrupos = () => {
    const query = inputGrupos?.value?.trim() || "";
    if (!query) return;

    const rows = sortRowsByAlias(filtrarRows(state.scopedRows, query));

    openListadoModal({
      titulo: `Resultados grupos: "${query}"`,
      subtitulo: "Grupos encontrados según la búsqueda ingresada.",
      resumen: `Hay ${rows.length} grupo(s) encontrado(s).`,
      rows,
      renderFn: (lista) => renderGroupCards(lista, {
        buttonLabel: "Abrir grupo",
        hrefBase: "grupo.html"
      })
    });
  };

  const ejecutarBusquedaFichas = () => {
    const query = inputFichas?.value?.trim() || "";
    if (!query) return;

    const fichaRows = state.scopedRows.filter(hasFichaSignal);
    const rows = sortRowsByAlias(filtrarRows(fichaRows, query));

    openListadoModal({
      titulo: `Resultados fichas: "${query}"`,
      subtitulo: "Fichas encontradas según la búsqueda ingresada.",
      resumen: `Hay ${rows.length} ficha(s) encontrada(s).`,
      rows,
      renderFn: (lista) => renderGroupCards(lista, {
        buttonLabel: "Abrir ficha",
        hrefBase: "fichas.html",
        extraRenderer: (row) => `
          <div style="margin-top:10px; color:#3e3550; font-size:14px;">
            <strong>Pendiente:</strong> ${escapeHtml(getFichaPendienteLabel(row))}
          </div>
        `
      })
    });
  };

  if (inputGrupos && !inputGrupos.dataset.bound) {
    inputGrupos.dataset.bound = "1";

    inputGrupos.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      ejecutarBusquedaGrupos();
    });
  }

  if (inputFichas && !inputFichas.dataset.bound) {
    inputFichas.dataset.bound = "1";

    inputFichas.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      ejecutarBusquedaFichas();
    });
  }

  if (btnBuscarGrupos && !btnBuscarGrupos.dataset.bound) {
    btnBuscarGrupos.dataset.bound = "1";
    btnBuscarGrupos.addEventListener("click", ejecutarBusquedaGrupos);
  }

  if (btnBuscarFichas && !btnBuscarFichas.dataset.bound) {
    btnBuscarFichas.dataset.bound = "1";
    btnBuscarFichas.addEventListener("click", ejecutarBusquedaFichas);
  }
}

/* =========================================================
   MODAL DETALLE BUSCADORES
========================================================= */

function renderKeyValue(label, value) {
  const finalValue = String(value ?? "").trim();
  if (!finalValue) return "";

  return `
    <div style="padding:10px 0; border-bottom:1px solid rgba(60,40,90,.08);">
      <strong style="color:#31194b;">${escapeHtml(label)}:</strong>
      <span style="color:#4b405a;">${escapeHtml(finalValue)}</span>
    </div>
  `;
}

function openDetalleGrupo(row = {}) {
  const id = getRowId(row);

  setText("modal-detalle-titulo", getRowAlias(row));
  setText("modal-detalle-subtitulo", "Detalle del grupo encontrado.");

  const cont = $("modal-detalle-contenido");
  if (cont) {
    cont.innerHTML = `
      <div style="display:grid; gap:4px;">
        ${renderKeyValue("ID Grupo", id)}
        ${renderKeyValue("Colegio", row.colegio)}
        ${renderKeyValue("Curso", row.curso)}
        ${renderKeyValue("Año viaje", row.anoViaje)}
        ${renderKeyValue("Destino", row.destinoPrincipal || row.destino)}
        ${renderKeyValue("Programa", row.programa)}
        ${renderKeyValue("Estado", row.estado)}
        ${renderKeyValue("Apoderado", getRowApoderado(row))}
        ${renderKeyValue("Correo apoderado", row.correoCliente)}
        ${renderKeyValue("Teléfono apoderado", row.celularCliente)}
        ${renderKeyValue("Vendedor(a)", getRowVendorName(row))}
        ${renderKeyValue("Correo vendedor(a)", row.vendedoraCorreo)}
        ${renderKeyValue("Número negocio", row.numeroNegocio)}
        ${renderKeyValue("Observaciones", row.observaciones || row.observacionesOperaciones)}
      </div>

      <div style="margin-top:18px; display:flex; gap:10px; flex-wrap:wrap;">
        <a href="grupo.html?id=${encodeURIComponent(id)}" target="_blank" rel="noopener" class="home-btn">
          Abrir grupo
        </a>

        <a href="fichas.html?id=${encodeURIComponent(id)}" target="_blank" rel="noopener" class="home-btn" style="background:#6d4a92;">
          Abrir ficha
        </a>
      </div>
    `;
  }

  openDialog($("modal-detalle-home"));
}

function openDetalleFicha(row = {}) {
  const id = getRowId(row);
  const firmas = getFichaFirmas(row);

  setText("modal-detalle-titulo", getRowAlias(row));
  setText("modal-detalle-subtitulo", "Detalle de ficha encontrada.");

  const cont = $("modal-detalle-contenido");
  if (cont) {
    cont.innerHTML = `
      <div style="display:grid; gap:4px;">
        ${renderKeyValue("ID Grupo", id)}
        ${renderKeyValue("Colegio", row.colegio)}
        ${renderKeyValue("Curso", row.curso)}
        ${renderKeyValue("Año viaje", row.anoViaje)}
        ${renderKeyValue("Número negocio", row.numeroNegocio)}
        ${renderKeyValue("Versión ficha", row.versionFicha)}
        ${renderKeyValue("Estado ficha", row.fichaEstado)}
        ${renderKeyValue("Cierre", row.cierre)}
        ${renderKeyValue("Programa", row.programa)}
        ${renderKeyValue("Asistencia en viajes", row.asistenciaEnViajes)}
        ${renderKeyValue("Liberados", row.liberados)}
        ${renderKeyValue("Valor programa", row.valorPrograma)}
        ${renderKeyValue("Solicitud reserva", row.solicitudReserva)}
        ${renderKeyValue("Firma vendedor", firmas.vendedor ? "Firmada" : "Pendiente")}
        ${renderKeyValue("Firma jefa de ventas", firmas.jefa ? "Firmada" : "Pendiente")}
        ${renderKeyValue("Firma administración", firmas.admin ? "Firmada" : "Pendiente")}
        ${renderKeyValue("Pendiente actual", getFichaPendienteLabel(row))}
        ${renderKeyValue("Observaciones operaciones", row.observacionesOperaciones)}
        ${renderKeyValue("Observaciones administración", row.observacionesAdministracion)}
      </div>

      <div style="margin-top:18px; display:flex; gap:10px; flex-wrap:wrap;">
        <a href="fichas.html?id=${encodeURIComponent(id)}" target="_blank" rel="noopener" class="home-btn">
          Abrir ficha
        </a>

        <a href="grupo.html?id=${encodeURIComponent(id)}" target="_blank" rel="noopener" class="home-btn" style="background:#6d4a92;">
          Abrir grupo
        </a>
      </div>
    `;
  }

  openDialog($("modal-detalle-home"));
}

/* =========================================================
   BIND ALERTAS
========================================================= */

function openSinAsignarPopup() {
  const url = "asignados.html?tab=sin_asignar";

  window.open(
    url,
    "sinAsignarPopup",
    "width=1200,height=760,menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=yes"
  );
}

function bindAlertButtons() {
  const linkSinAsignar = $("link-sin-asignar");
  const linkAContactar = $("link-a-contactar");
  const linkFichas = $("link-fichas-firmar");
  const linkFichasCorregidas = $("link-fichas-corregidas");
  const linkSolicitudes = $("link-solicitudes-actualizacion");
  const linkHomeFichasAbiertas = $("link-home-fichas-abiertas");
  const linkHomeFichasCerradas = $("link-home-fichas-cerradas");
  const linkHomeFichasAutorizadas = $("link-home-fichas-autorizadas");
  const linkCriticas = $("link-alertas-criticas");
  const linkWarning = $("link-alertas-warning");
  const linkReuniones = $("link-reunion-3dias");
  const selectAnoFichas = $("select-home-ano-fichas");

  // AGREGAR: permite abrir/cerrar el motivo completo de corrección
  if (!document.body.dataset.boundToggleMotivo) {
    document.body.dataset.boundToggleMotivo = "1";
  
    document.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-toggle-motivo]");
      if (!btn) return;
  
      const targetId = btn.dataset.toggleMotivo;
      const box = document.getElementById(targetId);
      if (!box) return;
  
      const isHidden = box.hidden;
      box.hidden = !isHidden;
      btn.textContent = isHidden ? "Ocultar motivo" : "Ver motivo";
    });
  }

  if (linkSinAsignar && !linkSinAsignar.dataset.bound) {
    linkSinAsignar.dataset.bound = "1";
    linkSinAsignar.addEventListener("click", (e) => {
      e.preventDefault();
      openSinAsignarPopup();
    });
  }

  if (linkAContactar && !linkAContactar.dataset.bound) {
    linkAContactar.dataset.bound = "1";
    linkAContactar.addEventListener("click", (e) => {
      e.preventDefault();

      openListadoModal({
        titulo: "Contactos a contactar",
        subtitulo: "Grupos pendientes de primer contacto según tu rol.",
        resumen: `Hay ${state.aContactarRows.length} contacto(s) por contactar.`,
        rows: state.aContactarRows,
        renderFn: (rows) => renderGroupCards(rows, {
          buttonLabel: "Abrir grupo",
          hrefBase: "grupo.html"
        })
      });
    });
  }

  if (linkFichas && !linkFichas.dataset.bound) {
    linkFichas.dataset.bound = "1";
    linkFichas.addEventListener("click", (e) => {
      e.preventDefault();

      openListadoModal({
        titulo: "Fichas por firmar",
        subtitulo: "Fichas pendientes según rol y correo del usuario.",
        resumen: `Hay ${state.fichasPorFirmarRows.length} ficha(s) pendiente(s).`,
        rows: state.fichasPorFirmarRows,
        renderFn: (rows) => renderGroupCards(rows, {
          buttonLabel: "Abrir ficha",
          hrefBase: "fichas.html",
          extraRenderer: (row) => `
            <div style="margin-top:10px; color:#3e3550; font-size:14px;">
              <strong>Pendiente:</strong> ${escapeHtml(getFichaPendienteLabel(row))}
            </div>
          `
        })
      });
    });
  }

  if (linkFichasCorregidas && !linkFichasCorregidas.dataset.bound) {
    linkFichasCorregidas.dataset.bound = "1";
  
    linkFichasCorregidas.addEventListener("click", (e) => {
      e.preventDefault();
  
      openListadoModal({
        titulo: "Fichas corregidas",
        subtitulo: "Correcciones internas pendientes según tu rol.",
        resumen: `Hay ${state.fichasCorregidasRows.length} ficha(s) corregida(s) pendiente(s).`,
        rows: state.fichasCorregidasRows,
        renderFn: (rows) => renderGroupCards(rows, {
          buttonLabel: "Abrir ficha",
          hrefBase: "fichas.html",
          extraRenderer: (row) => `
            <div style="margin-top:10px; color:#3e3550; font-size:14px;">
              <strong>Corrección:</strong> ${escapeHtml(getFichaCorregidaLabel(row))}
            </div>
          
            ${renderMotivoCorreccion(row)}
          
            ${renderAdminImportantChanges(row, getEffectiveUser())}
          `
        })
      });
    });
  }

  if (linkSolicitudes && !linkSolicitudes.dataset.bound) {
    linkSolicitudes.dataset.bound = "1";
    linkSolicitudes.addEventListener("click", (e) => {
      e.preventDefault();

      openListadoModal({
        titulo: "Solicitudes de actualización",
        subtitulo: "Solicitudes abiertas visibles para este usuario.",
        resumen: `Hay ${state.solicitudesActualizacionRows.length} solicitud(es) abierta(s).`,
        rows: state.solicitudesActualizacionRows, 
        renderFn: renderSolicitudesCards
      });
    });
  }

  if (linkCriticas && !linkCriticas.dataset.bound) {
    linkCriticas.dataset.bound = "1";
    linkCriticas.addEventListener("click", (e) => {
      e.preventDefault();

      openListadoModal({
        titulo: "Alertas críticas",
        subtitulo: "Alertas críticas activas según la vista del usuario.",
        resumen: `Hay ${state.alertasCriticasRows.length} alerta(s) crítica(s).`,
        rows: state.alertasCriticasRows,
        renderFn: renderAlertCards
      });
    });
  }

  if (linkWarning && !linkWarning.dataset.bound) {
    linkWarning.dataset.bound = "1";
    linkWarning.addEventListener("click", (e) => {
      e.preventDefault();

      openListadoModal({
        titulo: "Alertas pendientes",
        subtitulo: "Alertas pendientes activas según la vista del usuario.",
        resumen: `Hay ${state.alertasWarningRows.length} alerta(s) pendiente(s).`,
        rows: state.alertasWarningRows,
        renderFn: renderAlertCards
      });
    });
  }

  if (linkReuniones && !linkReuniones.dataset.bound) {
    linkReuniones.dataset.bound = "1";
    linkReuniones.addEventListener("click", (e) => {
      e.preventDefault();

      openListadoModal({
        titulo: "Reuniones próximas",
        subtitulo: "Reuniones confirmadas dentro de los próximos tres días.",
        resumen: `Hay ${state.reuniones3DiasRows.length} reunión(es) próxima(s).`,
        rows: state.reuniones3DiasRows,
        renderFn: (rows) => renderGroupCards(rows, {
          buttonLabel: "Abrir grupo",
          hrefBase: "grupo.html",
          extraRenderer: (row) => `
            <div style="margin-top:10px; color:#3e3550; font-size:14px;">
              <strong>Fecha reunión:</strong> ${escapeHtml(formatDate(getMeetingDate(row)))}
            </div>
          `
        })
      });
    });
  }

  const btnCerrarListado = $("btn-cerrar-modal-listado");
  const modalListado = $("modal-listado-home");

  if (btnCerrarListado && !btnCerrarListado.dataset.bound) {
    btnCerrarListado.dataset.bound = "1";
    btnCerrarListado.addEventListener("click", () => closeDialog(modalListado));
  }

  if (modalListado && !modalListado.dataset.bound) {
    modalListado.dataset.bound = "1";
    modalListado.addEventListener("click", (e) => {
      if (e.target === modalListado) closeDialog(modalListado);
    });
  }

  const btnCerrarDetalle = $("btn-cerrar-modal-detalle");
  const modalDetalle = $("modal-detalle-home");

  if (btnCerrarDetalle && !btnCerrarDetalle.dataset.bound) {
    btnCerrarDetalle.dataset.bound = "1";
    btnCerrarDetalle.addEventListener("click", () => closeDialog(modalDetalle));
  }

  if (modalDetalle && !modalDetalle.dataset.bound) {
    modalDetalle.dataset.bound = "1";
    modalDetalle.addEventListener("click", (e) => {
      if (e.target === modalDetalle) closeDialog(modalDetalle);
    });
  }
  function abrirModalFichasHome(tipo = "", rows = []) {
    const titulos = {
      abiertas: "Fichas abiertas",
      cerradas: "Fichas cerradas",
      autorizadas: "Fichas autorizadas"
    };
  
    openListadoModal({
      titulo: titulos[tipo] || "Fichas",
      subtitulo: "Detalle administrativo de fichas.",
      resumen: `Hay ${rows.length} ficha(s).`,
      rows,
      renderFn: (lista) => renderGroupCards(lista, {
        buttonLabel: "Abrir ficha",
        hrefBase: "fichas.html",
        extraRenderer: (row) => `
          <div style="margin-top:10px; color:#3e3550; font-size:14px;">
            <strong>Estado administrativo:</strong> ${escapeHtml(getFichaAdminMotivo(row))}
          </div>
          ${renderAdminImportantChanges(row, getEffectiveUser())}
        `
      })
    });
  }
  
  if (linkHomeFichasAbiertas && !linkHomeFichasAbiertas.dataset.bound) {
    linkHomeFichasAbiertas.dataset.bound = "1";
    linkHomeFichasAbiertas.addEventListener("click", (e) => {
      e.preventDefault();
      abrirModalFichasHome("abiertas", state.fichasAbiertasRows);
    });
  }
  
  if (linkHomeFichasCerradas && !linkHomeFichasCerradas.dataset.bound) {
    linkHomeFichasCerradas.dataset.bound = "1";
    linkHomeFichasCerradas.addEventListener("click", (e) => {
      e.preventDefault();
      abrirModalFichasHome("cerradas", state.fichasCerradasRows);
    });
  }
  
  if (linkHomeFichasAutorizadas && !linkHomeFichasAutorizadas.dataset.bound) {
    linkHomeFichasAutorizadas.dataset.bound = "1";
    linkHomeFichasAutorizadas.addEventListener("click", (e) => {
      e.preventDefault();
      abrirModalFichasHome("autorizadas", state.fichasAutorizadasRows);
    });
  }

  if (selectAnoFichas && !selectAnoFichas.dataset.bound) {
    selectAnoFichas.dataset.bound = "1";
  
    selectAnoFichas.addEventListener("change", () => {
      state.anoFichaFiltro = selectAnoFichas.value;
      renderHome();
    });
  }
}

/* =========================================================
   INIT
========================================================= */

async function renderPantalla() {
  const realUser = getRealUser();
  const effectiveUser = getEffectiveUser();

  if (!realUser || !effectiveUser) {
    location.href = "login.html";
    return;
  }

  setHeaderState({
    realUser,
    effectiveUser,
    isActing: normalizeEmail(realUser.email) !== normalizeEmail(effectiveUser.email)
  });

  renderActingUserSwitcher({
    realUser,
    effectiveUser,
    users: VENTAS_USERS
  });

  try {
    await loadHomeData();
    renderHome();
    initSearchers();
  } catch (error) {
    console.error("Error cargando home:", error);
    alert("No se pudo cargar el home: " + error.message);
  }
}

async function initPage() {
  await waitForLayoutReady();

  bindLayoutButtons({
    homeUrl: GITHUB_HOME_URL,

    onLogout: async () => {
      try {
        sessionStorage.removeItem(ACTING_USER_KEY);
        clearVendorFilter();
        clearGroupFilter();
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
      await renderPantalla();
    },

    onResetActAs: async () => {
      sessionStorage.removeItem(ACTING_USER_KEY);
      clearVendorFilter();
      clearGroupFilter();
      await renderPantalla();
    }
  });

  bindAlertButtons();

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      location.href = "login.html";
      return;
    }

    await renderPantalla();
  });

  updateClockDataset();
  setInterval(updateClockDataset, 1000);
}

initPage();
