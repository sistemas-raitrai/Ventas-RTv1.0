// home.js — Home específico por usuario / rol para Ventas RT

import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.7.3/firebase-auth.js";
import {
  collection,
  getDocs,
  doc,
  setDoc,
  addDoc,
  serverTimestamp
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

const API_PAGOS_URL = "/api/pagos";
const ALERTAS_PAGOS_COLLECTION = "ventas_alertas_pagos";
const ALERTAS_PAGOS_HISTORIAL_COLLECTION = "ventas_alertas_pagos_historial";

/* =========================================================
   ESTADO
========================================================= */

const state = {
  rows: [],
  rowsById: new Map(),
  alertRows: [],
  solicitudesRows: [],
  alertasPagosRows: [],
  alertasPagosUltimaActualizacion: null,
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
  alertasPagosFiltradasRows: [],
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
  const modo = normalizeLoose(flow.modo || row.fichaFlujoModo || "");

  if (modo !== "correccion") return "";

  const firmas = getFichaFirmas(row);

  if (firmas.vendedor && firmas.jefa && firmas.admin) {
    return "";
  }

  if (firmas.jefa) {
    return "pendiente_administracion";
  }

  return "pendiente_jefa";
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
  const estado = getCorreccionFichaEstado(row);

  if (estado === "pendiente_jefa") {
    return "Corrección pendiente de revisión por jefa de ventas";
  }

  if (estado === "pendiente_administracion") {
    return "Corrección pendiente de cierre administrativo";
  }

  const firmas = getFichaFirmas(row);

  if (firmas.jefa && !firmas.admin) {
    return "Corrección pendiente de cierre administrativo";
  }

  if (!firmas.jefa) {
    return "Corrección pendiente de revisión por jefa de ventas";
  }

  return "Corrección pendiente";
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
  setAlertRowVisibleByChild("link-alertas-pagos", !!user);
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
    const estado = getCorreccionFichaEstado(row);

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
  const [groupsSnap, alertsSnap, solicitudesSnap, alertasPagosSnap] = await Promise.all([
    getDocs(collection(db, "ventas_cotizaciones")),
    getDocs(collection(db, ALERTAS_COLLECTION)),
    getDocs(collection(db, SOLICITUDES_COLLECTION)),
    getDocs(collection(db, ALERTAS_PAGOS_COLLECTION))
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

  state.alertasPagosRows = alertasPagosSnap.docs
    .map((docSnap) => ({
      id: docSnap.id,
      ...docSnap.data()
    }))
    .filter((row) => row.activa !== false)
    .sort((a, b) => Number(b.prioridad || 0) - Number(a.prioridad || 0));

  state.alertasPagosUltimaActualizacion =
    state.alertasPagosRows
      .map((row) => timestampLikeToDate(row.actualizadoAt))
      .filter(Boolean)
      .sort((a, b) => b.getTime() - a.getTime())[0] || null;
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
  
  state.alertasPagosFiltradasRows = getAlertasPagosForScope(scopedRows);
  
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
  setText("count-alertas-pagos", state.alertasPagosFiltradasRows.length);
  setText("count-reunion-3dias", state.reuniones3DiasRows.length);

  syncAlertRowsByRole(effectiveUser);
}

/* =========================================================
   ALERTAS DE PAGOS
========================================================= */

function numeroPago(v) {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(String(v).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function obtenerAnoOperativoHome() {
  const hoy = new Date();
  const anoActual = hoy.getFullYear();
  const mes = hoy.getMonth() + 1;
  const dia = hoy.getDate();

  if (mes < 3 || (mes === 3 && dia < 1)) {
    return anoActual - 1;
  }

  return anoActual;
}

function formatoMontoPago(v, moneda = "") {
  const currency = String(moneda || "").toUpperCase();

  if (currency === "USD" || currency === "EUR") {
    return Number(v || 0).toLocaleString("es-CL", {
      style: "currency",
      currency,
      maximumFractionDigits: 0
    });
  }

  return Number(v || 0).toLocaleString("es-CL", {
    maximumFractionDigits: 0
  });
}

function normalizarMonedaPago(valor = "") {
  const m = normalizeLoose(valor);

  if (m.includes("peso") || m === "clp") return "CLP";
  if (m.includes("dolar") || m.includes("dólar") || m === "usd") return "USD";
  if (m.includes("euro") || m === "eur") return "EUR";

  return String(valor || "").trim().toUpperCase();
}

function normalizarGrupoPagos(g = {}) {
  return {
    numeroNegocio: String(g.negocio_id || "").trim(),
    nombreGrupo: String(g.nombre_colegio || "").trim(),
    anoViaje: String(g.ano_viaje || "").trim(),
    fechaSalida: String(g.fecha_salida || "").trim(),
    destino: String(g.destino || "").trim(),
    monedaTexto: normalizarMonedaPago(g.moneda_texto),
    totalViaje: numeroPago(g.total_viaje),
    totalPagado: numeroPago(g.total_pagado),
    saldoPendiente: numeroPago(g.saldo_pendiente)
  };
}

function normalizarPasajeroPagos(item = {}) {
  if (item.pasajero) {
    const p = item.pasajero || {};
    const s = item.situacion_pagos || {};

    return {
      rut: String(p.rut || "").trim(),
      nombreCompleto: `${p.nombres || ""} ${p.apellidos || ""}`.trim(),
      categoria: String(p.ocupacion_categoria || "").trim(),
      responsable: String(p.nombre_apoderado || p.apoderado || "").trim(),
      correoResponsable: String(p.email || "").trim(),
      telefonoResponsable: String(p.telefono || "").trim(),
      viaja: Number(p.viaja) === 1,
      totalDebe: numeroPago(s.monto_total),
      totalPagado: numeroPago(s.monto_total_pagado),
      saldoPendiente: numeroPago(s.saldo_pendiente),
      ultimoPagoFecha: s.ultimo_pago?.fecha || "",
      ultimoPagoMonto: numeroPago(s.ultimo_pago?.monto)
    };
  }

  return {
    rut: String(item.rut || "").trim(),
    nombreCompleto: String(item.nombre_completo || "").trim(),
    categoria: "",
    responsable: String(item.nombre_apoderado || item.apoderado || "").trim(),
    correoResponsable: String(item.email || item.correo || "").trim(),
    telefonoResponsable: String(item.telefono || item.celular || "").trim(),
    viaja: String(item.viaja || "").toLowerCase() !== "no",
    totalDebe: numeroPago(item.total_debe),
    totalPagado: numeroPago(item.total_pagado),
    saldoPendiente: numeroPago(item.saldo_pendiente),
    ultimoPagoFecha: item.ultimo_pago_fecha || "",
    ultimoPagoMonto: numeroPago(item.ultimo_pago_monto)
  };
}

async function fetchJsonPagos(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

function buscarGrupoRtPorNumeroNegocio(numeroNegocio) {
  const numero = String(numeroNegocio || "").trim();

  return state.rows.find((row) =>
    String(getNumeroNegocio(row) || "").trim() === numero
  ) || null;
}

function diasDesdeFechaPago(fecha) {
  const d = timestampLikeToDate(fecha);
  if (!d) return null;

  const now = new Date();
  const diff = now.getTime() - d.getTime();

  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

function getTipoAlertaPersonaPago(p = {}, grupo = {}) {
  if (!p.viaja) return null;
  if (p.saldoPendiente <= 0) return null;

  const moneda = String(grupo.monedaTexto || "").toUpperCase();
  const diasUltimoPago = diasDesdeFechaPago(p.ultimoPagoFecha);

  if (p.totalPagado <= 0) {
    return {
      tipo: "persona_sin_pagos",
      nivel: "critica",
      label: "Nunca ha pagado",
      gravedad: 5
    };
  }

  const limitePagoBajo =
    moneda === "USD" || moneda === "EUR"
      ? 550
      : moneda === "CLP"
        ? 500000
        : null;
  
  if (limitePagoBajo !== null && p.totalPagado > 0 && p.totalPagado <= limitePagoBajo) {
    return {
      tipo: "persona_pago_bajo",
      nivel: "critica",
      label: moneda === "CLP"
        ? "Pagado menor o igual a $500.000 CLP"
        : `Pagado menor o igual a 550 ${moneda}`,
      gravedad: 4
    };
  }

  if (diasUltimoPago !== null && diasUltimoPago > 90) {
    return {
      tipo: "persona_sin_pago_3_meses",
      nivel: "warning",
      label: "No paga hace más de 3 meses",
      gravedad: 3
    };
  }

  if (p.totalPagado > 50 && p.saldoPendiente > 0) {
    return {
      tipo: "persona_pago_parcial_con_saldo",
      nivel: "warning",
      label: "Pago parcial con saldo pendiente",
      gravedad: 2
    };
  }

  return null;
}

function getTipoAlertaGrupoPago(grupo = {}, pasajeros = []) {
  const viajan = pasajeros.filter((p) => p.viaja);
  const conDeuda = viajan.filter((p) => p.saldoPendiente > 0);

  const totalViajan = viajan.length;
  const totalConDeuda = conDeuda.length;

  let porcentajeDebe = 0;

  if (totalViajan > 0) {
    porcentajeDebe = (totalConDeuda / totalViajan) * 100;
  } else if (grupo.totalViaje > 0 && grupo.saldoPendiente > 0) {
    porcentajeDebe = (grupo.saldoPendiente / grupo.totalViaje) * 100;
  } else if (grupo.totalPagado <= 0 && grupo.totalViaje > 0) {
    porcentajeDebe = 100;
  }

  if (porcentajeDebe <= 0) return null;

  if (porcentajeDebe > 50) {
    return {
      tipo: "grupo_mas_50_debe",
      nivel: "critica",
      label: "Más del 50% del grupo debe",
      gravedad: 3,
      porcentajeDebe,
      totalViajan,
      totalConDeuda
    };
  }

  if (porcentajeDebe >= 20) {
    return {
      tipo: "grupo_20_49_debe",
      nivel: "warning",
      label: "Entre 20% y 49% del grupo debe",
      gravedad: 2,
      porcentajeDebe,
      totalViajan,
      totalConDeuda
    };
  }

  return {
    tipo: "grupo_0_19_debe",
    nivel: "info",
    label: "Entre 0% y 19% del grupo debe",
    gravedad: 1,
    porcentajeDebe,
    totalViajan,
    totalConDeuda
  };
}

function calcularPrioridadPersona(tipoInfo, grupoInfo = {}) {
  const porcentajeGrupoDebe = Number(grupoInfo.porcentajeDebe || 0);
  const avanceGrupo = Math.max(0, 100 - porcentajeGrupoDebe);

  return Math.round(
    Number(tipoInfo.gravedad || 1) * 1000 +
    avanceGrupo * 10 -
    porcentajeGrupoDebe
  );
}

function calcularPrioridadGrupo(tipoInfo, grupo = {}) {
  const saldo = Number(grupo.saldoPendiente || 0);

  // En grupos importa más el que debe menos dentro de su categoría,
  // porque está más cerca de concretar.
  return Math.round(
    Number(tipoInfo.gravedad || 1) * 1000 -
    Math.min(saldo / 100, 999)
  );
}

function getPrioridadPagoKey(alerta = {}) {
  const tipo = String(alerta.tipo || "");
  const saldo = Number(alerta.saldoPendiente || alerta.saldoPendienteGrupo || 0);
  const porcentajeGrupoDebe = Number(alerta.porcentajeGrupoDebe || 0);

  if (
    tipo === "persona_sin_pagos" ||
    tipo === "persona_pago_bajo" ||
    tipo === "grupo_mas_50_debe"
  ) {
    return "critica";
  }

  if (
    tipo === "persona_sin_pago_3_meses" ||
    (tipo === "persona_pago_parcial_con_saldo" && saldo > 1000) ||
    porcentajeGrupoDebe >= 40
  ) {
    return "alta";
  }

  if (
    tipo === "persona_pago_parcial_con_saldo" ||
    tipo === "grupo_20_49_debe"
  ) {
    return "media";
  }

  return "baja";
}

function getPrioridadPagoLabel(alerta = {}) {
  const key = getPrioridadPagoKey(alerta);

  if (key === "critica") return "Crítica";
  if (key === "alta") return "Alta";
  if (key === "media") return "Media";
  return "Baja";
}

function getTextoSugeridoPago(alerta = {}) {
  const responsable = alerta.responsable || "apoderado/a";
  const participante = alerta.participante || "el/la participante";
  const grupo = alerta.grupo || "su grupo";
  const moneda = alerta.moneda || "";
  const total = formatoMontoPago(alerta.totalDebe, moneda);
  const pagado = formatoMontoPago(alerta.totalPagado, moneda);
  const saldo = formatoMontoPago(alerta.saldoPendiente, moneda);

  return `Estimado/a ${responsable}, junto con saludar, le escribimos respecto del viaje de estudios de ${participante}, correspondiente al grupo ${grupo}.

Según nuestros registros, el total del programa es de ${total}, de los cuales actualmente se registra un pago de ${pagado}, quedando un saldo pendiente de ${saldo}.

Le agradeceríamos regularizar esta situación o contactarnos para revisar el estado de pagos.`;
}

function getAlertasPagosForScope(scopedRows = []) {
  const scopedIds = new Set(scopedRows.map(getRowId).filter(Boolean));
  const scopedNumeros = new Set(scopedRows.map(getNumeroNegocio).filter(Boolean));

  return (state.alertasPagosRows || [])
    .filter((alerta) => {
      if (alerta.activa === false) return false;

      const idGrupo = String(alerta.idGrupo || "").trim();
      const numeroNegocio = String(alerta.numeroNegocio || "").trim();

      return scopedIds.has(idGrupo) || scopedNumeros.has(numeroNegocio);
    })
    .sort((a, b) => Number(b.prioridad || 0) - Number(a.prioridad || 0));
}

function buildAlertasPagosFiltrosHtml(rows = []) {
  const anoOperativo = String(obtenerAnoOperativoHome());

  const anos = [...new Set(rows.map((r) => String(r.anoViaje || "").trim()).filter(Boolean))].sort();

  const vendedores = [...new Map(
    rows
      .map((r) => [normalizeEmail(r.vendedoraCorreo || ""), r.vendedor || r.vendedoraCorreo || "Sin vendedor"])
      .filter(([email]) => email)
  ).entries()];

  const monedas = [...new Set(rows.map((r) => String(r.moneda || "").trim()).filter(Boolean))].sort();

  return `
    <div style="display:flex; justify-content:space-between; gap:12px; align-items:center; flex-wrap:wrap; margin-bottom:14px;">
      <div style="font-size:13px; color:#4b405a;">
        <strong>Última actualización:</strong>
        ${state.alertasPagosUltimaActualizacion ? escapeHtml(formatDate(state.alertasPagosUltimaActualizacion)) : "Sin actualización"}
      </div>

      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        <button type="button" id="btn-exportar-alertas-pagos" class="home-btn" style="background:#6d4a92;">
          Exportar XLSX
        </button>

        <button type="button" id="btn-actualizar-alertas-pagos" class="home-btn">
          Actualizar
        </button>
      </div>
    </div>

    <div style="display:grid; grid-template-columns:repeat(4, minmax(140px, 1fr)); gap:10px; margin-bottom:12px;">
      <select id="filtro-alerta-pago-ano">
        <option value="">Todos los años</option>
        ${anos.map((a) => `
          <option value="${escapeHtml(a)}" ${String(a) === anoOperativo ? "selected" : ""}>
            ${escapeHtml(a)}
          </option>
        `).join("")}
      </select>

      <select id="filtro-alerta-pago-vendedor">
        <option value="">Todos los vendedores</option>
        ${vendedores.map(([email, nombre]) => `
          <option value="${escapeHtml(email)}">${escapeHtml(nombre)}</option>
        `).join("")}
      </select>

      <select id="filtro-alerta-pago-moneda">
        <option value="">Todas las monedas</option>
        ${monedas.map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join("")}
      </select>
      
      <select id="filtro-alerta-pago-prioridad">
        <option value="">Todas las prioridades</option>
        <option value="critica">Crítica</option>
        <option value="alta">Alta</option>
        <option value="media">Media</option>
        <option value="baja">Baja</option>
      </select>
      
      <input id="filtro-alerta-pago-buscar" type="search" placeholder="Buscar participante, grupo, correo..." />
    </div>

    <div id="chips-alertas-pagos" style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:14px;">
      ${getTiposAlertasPagosUI().map((item) => `
        <button
          type="button"
          class="chip-alerta-pago is-active"
          data-tipo-alerta-pago="${escapeHtml(item.tipo)}"
          style="border:1px solid rgba(49,25,75,.18); background:#f4eefb; color:#32184f; border-radius:999px; padding:8px 11px; font-weight:900; cursor:pointer; font-size:12px;"
        >
          ${escapeHtml(item.label)}
        </button>
      `).join("")}
    </div>

    <div id="resumen-alertas-pagos" style="margin-bottom:12px;"></div>
    <div id="contenedor-alertas-pagos-listado"></div>
  `;
}

function getTiposAlertasPagosUI() {
  return [
    { tipo: "persona_sin_pagos", label: "Nunca pagó" },
    { tipo: "persona_pago_bajo", label: "Personas: Pago bajo" },
    { tipo: "persona_sin_pago_3_meses", label: "Sin pago +3 meses" },
    { tipo: "persona_pago_parcial_con_saldo", label: "Pago parcial" },
    { tipo: "grupo_mas_50_debe", label: "Grupo >50%" },
    { tipo: "grupo_20_49_debe", label: "Grupo 20%-49%" },
    { tipo: "grupo_0_19_debe", label: "Grupo 0%-19%" }
  ];
}

function getTiposActivosAlertasPagos() {
  const chips = [...document.querySelectorAll("[data-tipo-alerta-pago]")];

  const activos = chips
    .filter((btn) => btn.classList.contains("is-active"))
    .map((btn) => btn.dataset.tipoAlertaPago)
    .filter(Boolean);

  return new Set(activos);
}

function renderResumenAlertasPagos(rows = []) {
  const cont = $("resumen-alertas-pagos");
  if (!cont) return;

  const personas = rows.filter((r) => r.categoriaAlerta === "persona");
  const grupos = rows.filter((r) => r.categoriaAlerta === "grupo");
  const contactados = rows.filter((r) => r.contactado === true);

  cont.innerHTML = `
    <div style="display:grid; grid-template-columns:repeat(4, minmax(120px, 1fr)); gap:10px;">
      <div style="padding:12px; border-radius:14px; background:#faf8fd; border:1px solid rgba(49,25,75,.10);">
        <strong style="font-size:20px; color:#26133d;">${rows.length}</strong><br>
        <span style="font-size:12px; color:#766b84;">Total alertas</span>
      </div>

      <div style="padding:12px; border-radius:14px; background:#faf8fd; border:1px solid rgba(49,25,75,.10);">
        <strong style="font-size:20px; color:#26133d;">${personas.length}</strong><br>
        <span style="font-size:12px; color:#766b84;">Personas</span>
      </div>

      <div style="padding:12px; border-radius:14px; background:#faf8fd; border:1px solid rgba(49,25,75,.10);">
        <strong style="font-size:20px; color:#26133d;">${grupos.length}</strong><br>
        <span style="font-size:12px; color:#766b84;">Grupos</span>
      </div>

      <div style="padding:12px; border-radius:14px; background:#eef8ef; border:1px solid #b9dfc0;">
        <strong style="font-size:20px; color:#1d6a2b;">${contactados.length}</strong><br>
        <span style="font-size:12px; color:#1d6a2b;">Contactados</span>
      </div>
    </div>
  `;
}

function ordenarAlertasPagos(rows = []) {
  return [...rows].sort((a, b) => {
    if (!!a.contactado !== !!b.contactado) {
      return a.contactado ? 1 : -1;
    }

    const prioridad = Number(b.prioridad || 0) - Number(a.prioridad || 0);
    if (prioridad !== 0) return prioridad;

    return String(a.participante || a.grupo || "").localeCompare(
      String(b.participante || b.grupo || ""),
      "es",
      { sensitivity: "base" }
    );
  });
}

function limpiarTelefonoWhatsapp(valor = "") {
  let fono = String(valor || "").replace(/\D/g, "");

  if (!fono) return "";

  if (fono.startsWith("56")) return fono;
  if (fono.startsWith("9")) return `56${fono}`;
  if (fono.length === 8) return `569${fono}`;

  return fono;
}

function getTextoWhatsappPago(alerta = {}) {
  const responsable = alerta.responsable || "";
  const participante = alerta.participante || "el/la participante";
  const grupo = alerta.grupo || "su grupo";
  const moneda = alerta.moneda || "";
  const pagado = formatoMontoPago(alerta.totalPagado, moneda);
  const saldo = formatoMontoPago(alerta.saldoPendiente, moneda);

  return `Hola ${responsable}, le escribimos de Turismo Rai Trai por el viaje de estudios de ${participante}, grupo ${grupo}. Según nuestros registros, se registra pagado ${pagado} y queda un saldo pendiente de ${saldo}. Le agradeceríamos regularizar o contactarnos para revisar el estado de pagos.`;
}

function getWhatsappUrlAlertaPago(alerta = {}) {
  const fono = limpiarTelefonoWhatsapp(alerta.telefonoResponsable || "");
  if (!fono) return "";

  return `https://wa.me/${encodeURIComponent(fono)}?text=${encodeURIComponent(getTextoWhatsappPago(alerta))}`;
}

function getGmailUrlAlertaPago(alerta = {}) {
  const to = String(alerta.correoResponsable || "").trim();
  if (!to) return "";

  const subject = `Estado de pagos viaje de estudios - ${alerta.participante || alerta.grupo || ""}`;
  const body = getTextoSugeridoPago(alerta);

  return `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function filtrarAlertasPagosModal(rows = []) {
  const ano = $("filtro-alerta-pago-ano")?.value || "";
  const vendedor = $("filtro-alerta-pago-vendedor")?.value || "";
  const moneda = $("filtro-alerta-pago-moneda")?.value || "";
  const prioridad = $("filtro-alerta-pago-prioridad")?.value || "";
  const q = normalizeLoose($("filtro-alerta-pago-buscar")?.value || "");
  const tiposActivos = getTiposActivosAlertasPagos();

  return ordenarAlertasPagos(rows.filter((row) => {
    if (ano && String(row.anoViaje || "") !== ano) return false;
    if (vendedor && normalizeEmail(row.vendedoraCorreo || "") !== vendedor) return false;
    if (moneda && String(row.moneda || "") !== moneda) return false;
    if (prioridad && getPrioridadPagoKey(row) !== prioridad) return false;

    if (tiposActivos.size && !tiposActivos.has(String(row.tipo || ""))) return false;

    if (q) {
      const texto = buildSearchText(row);
      if (!texto.includes(q)) return false;
    }

    return true;
  }));
}

function renderAlertasPagosListado(rows = []) {
  const cont = $("contenedor-alertas-pagos-listado");
  if (!cont) return;

  renderResumenAlertasPagos(rows);

  if (!rows.length) {
    cont.innerHTML = emptyHtml("No hay alertas de pagos para mostrar.");
    return;
  }

  cont.innerHTML = `
    <div style="overflow:auto; border:1px solid rgba(49,25,75,.10); border-radius:16px;">
      <table style="width:100%; border-collapse:collapse; font-size:12px;">
        <thead style="background:#32184f; color:white; position:sticky; top:0;">
          <tr>
            <th style="padding:10px; text-align:left;">#</th>
            <th style="padding:10px; text-align:left;">Participante / Grupo</th>
            <th style="padding:10px; text-align:left;">Grupo</th>
            <th style="padding:10px; text-align:left;">Año</th>
            <th style="padding:10px; text-align:left;">Vendedor</th>
            <th style="padding:10px; text-align:left;">Razón</th>
            <th style="padding:10px; text-align:right;">Pagado</th>
            <th style="padding:10px; text-align:right;">Saldo</th>
            <th style="padding:10px; text-align:left;">Último pago</th>
            <th style="padding:10px; text-align:left;">Estado</th>
          </tr>
        </thead>

        <tbody>
          ${rows.map((alerta, index) => {
            const esPersona = alerta.categoriaAlerta === "persona";
            const nombre = esPersona ? alerta.participante : alerta.grupo;
            const contactado = alerta.contactado === true;

            return `
              <tr
                data-open-detalle-alerta-pago="${escapeHtml(alerta.id)}"
                style="cursor:pointer; border-bottom:1px solid rgba(49,25,75,.08); background:${contactado ? "#eef8ef" : "#fff"};"
              >
                <td style="padding:9px 10px; font-weight:900;">${index + 1}</td>

                <td style="padding:9px 10px;">
                  <strong style="color:#26133d;">${escapeHtml(nombre || "-")}</strong><br>
                  <span style="color:#766b84;">${escapeHtml(esPersona ? (alerta.responsable || "Sin responsable") : "Alerta de grupo")}</span>
                </td>

                <td style="padding:9px 10px;">
                  ${escapeHtml(alerta.grupo || "-")}<br>
                  <span style="color:#766b84;">N° ${escapeHtml(alerta.numeroNegocio || "-")}</span>
                </td>

                <td style="padding:9px 10px;">${escapeHtml(alerta.anoViaje || "-")}</td>
                <td style="padding:9px 10px;">${escapeHtml(alerta.vendedor || "Sin vendedor")}</td>
                <td style="padding:9px 10px;">${escapeHtml(alerta.label || alerta.tipo || "-")}</td>

                <td style="padding:9px 10px; text-align:right;">
                  ${escapeHtml(formatoMontoPago(alerta.totalPagado || 0, alerta.moneda))}
                </td>

                <td style="padding:9px 10px; text-align:right; font-weight:900;">
                  ${escapeHtml(formatoMontoPago(alerta.saldoPendiente || alerta.saldoPendienteGrupo || 0, alerta.moneda))}
                </td>

                <td style="padding:9px 10px;">${escapeHtml(alerta.ultimoPagoFecha || "-")}</td>

                <td style="padding:9px 10px;">
                  ${contactado
                    ? `<span style="color:#1d6a2b; font-weight:900;">Contactado</span>`
                    : `<span style="color:#9f1d1d; font-weight:900;">Pendiente</span>`
                  }
                </td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderAlertaPagoCard(alerta = {}) {
  const esPersona = alerta.categoriaAlerta === "persona";
  const idGrupo = String(alerta.idGrupo || "").trim();
  const textoSugerido = esPersona ? getTextoSugeridoPago(alerta) : "";
  const yaContactado = alerta.contactado === true;
  const gmailUrl = esPersona ? getGmailUrlAlertaPago(alerta) : "";
  const whatsappUrl = esPersona ? getWhatsappUrlAlertaPago(alerta) : "";

  return `
    <div class="home-card-row">
      <div style="min-width:0;">
        <div class="home-card-row-title">
          ${escapeHtml(esPersona ? (alerta.participante || "Participante") : (alerta.grupo || "Grupo"))}
        </div>

        <div class="home-card-row-text">
          <strong>Razón:</strong> ${escapeHtml(alerta.label || alerta.tipo || "Alerta de pago")}<br>
          Grupo: ${escapeHtml(alerta.grupo || "-")} · N° ${escapeHtml(alerta.numeroNegocio || "-")}<br>
          Año: ${escapeHtml(alerta.anoViaje || "-")} · Vendedor(a): ${escapeHtml(alerta.vendedor || "Sin vendedor")}<br>
          Moneda: ${escapeHtml(alerta.moneda || "-")} · Prioridad: ${escapeHtml(getPrioridadPagoLabel(alerta))}
        </div>

        ${esPersona ? `
          <div style="margin-top:10px; color:#3e3550; font-size:14px; line-height:1.5;">
            <strong>Responsable:</strong> ${escapeHtml(alerta.responsable || "-")}<br>
            <strong>Correo:</strong> ${escapeHtml(alerta.correoResponsable || "-")}<br>
            <strong>Teléfono:</strong> ${escapeHtml(alerta.telefonoResponsable || "-")}<br>
            <strong>Total:</strong> ${escapeHtml(formatoMontoPago(alerta.totalDebe, alerta.moneda))} ·
            <strong>Pagado:</strong> ${escapeHtml(formatoMontoPago(alerta.totalPagado, alerta.moneda))} ·
            <strong>Saldo:</strong> ${escapeHtml(formatoMontoPago(alerta.saldoPendiente, alerta.moneda))}<br>
            <strong>Último pago:</strong> ${escapeHtml(alerta.ultimoPagoFecha || "Sin registro")}
          </div>

          ${yaContactado ? `
            <div style="margin-top:10px; padding:10px 12px; border-radius:14px; background:#eef8ef; border:1px solid #b9dfc0; color:#1d6a2b; font-size:13px;">
              ✅ Ya contactado por ${escapeHtml(alerta.contactadoPor || alerta.contactadoPorCorreo || "usuario")} el ${escapeHtml(formatDate(alerta.contactadoAt))}.<br>
              ⚠ Recuerda que este contacto debe estar registrado también en el historial del Sistema de Pagos.
            </div>
          ` : ""}

          <details open style="margin-top:10px;">
            <summary style="cursor:pointer; font-weight:800;">Texto sugerido para contactar</summary>
            <div style="margin-top:8px; white-space:pre-wrap; padding:10px; border-radius:12px; background:#f7f3fb;">
              ${escapeHtml(textoSugerido)}
            </div>
          </details>
        ` : `
          <div style="margin-top:10px; color:#3e3550; font-size:14px; line-height:1.5;">
            <strong>Total viajan:</strong> ${escapeHtml(alerta.totalViajan || 0)}<br>
            <strong>Con deuda:</strong> ${escapeHtml(alerta.totalConDeuda || 0)}<br>
            <strong>% grupo debe:</strong> ${escapeHtml(Number(alerta.porcentajeGrupoDebe || 0).toFixed(1))}%<br>
            <strong>Saldo pendiente grupo:</strong> ${escapeHtml(formatoMontoPago(alerta.saldoPendienteGrupo, alerta.moneda))}
          </div>
        `}
      </div>

      <div style="display:flex; flex-direction:column; gap:8px;">
        ${esPersona ? `
          ${gmailUrl ? `
            <a href="${gmailUrl}" target="_blank" rel="noopener" class="home-btn" style="background:#b42318;">
              Gmail
            </a>
          ` : ""}

          ${whatsappUrl ? `
            <a href="${whatsappUrl}" target="_blank" rel="noopener" class="home-btn" style="background:#16833a;">
              WhatsApp
            </a>
          ` : ""}

          <button type="button" class="home-btn" data-copy-alerta-pago="${escapeHtml(alerta.id)}">
            Copiar texto
          </button>

          <button
            type="button"
            class="home-btn"
            data-contactar-alerta-pago="${escapeHtml(alerta.id)}"
            style="background:${yaContactado ? "#6d4a92" : "#1f7a3b"};"
          >
            ${yaContactado ? "Registrar nuevo contacto" : "Marcar contactado"}
          </button>
        ` : ""}

        <a href="grupo.html?id=${encodeURIComponent(idGrupo)}" target="_blank" rel="noopener" class="home-btn">
          Abrir grupo
        </a>
      </div>
    </div>
  `;
}

function openDetalleAlertaPago(alertaId) {
  const alerta = state.alertasPagosRows.find((row) => String(row.id) === String(alertaId));
  if (!alerta) return;

  setText("modal-detalle-titulo", alerta.categoriaAlerta === "persona"
    ? (alerta.participante || "Detalle alerta")
    : (alerta.grupo || "Detalle alerta")
  );

  setText("modal-detalle-subtitulo", alerta.label || alerta.tipo || "Alerta de pago");

  const cont = $("modal-detalle-contenido");
  if (cont) {
    cont.innerHTML = renderAlertaPagoCard(alerta);
  }

  openDialog($("modal-detalle-home"));
}

function exportarAlertasPagosXlsx() {
  const rows = filtrarAlertasPagosModal(state.alertasPagosFiltradasRows || []);

  if (!rows.length) {
    alert("No hay alertas para exportar con los filtros actuales.");
    return;
  }

  const fecha = new Date();
  const fechaTxt = fecha.toISOString().slice(0, 10);
  const horaTxt = fecha.toTimeString().slice(0, 5).replace(":", "");

  const data = rows.map((a, index) => ({
    numero: index + 1,
    exportadoEl: fecha.toLocaleString("es-CL"),
    categoria: a.categoriaAlerta || "",
    tipo: a.tipo || "",
    razon: a.label || "",
    participante: a.participante || "",
    responsable: a.responsable || "",
    correo: a.correoResponsable || "",
    telefono: a.telefonoResponsable || "",
    grupo: a.grupo || "",
    numeroNegocio: a.numeroNegocio || "",
    anoViaje: a.anoViaje || "",
    vendedor: a.vendedor || "",
    moneda: a.moneda || "",
    total: a.totalDebe || "",
    pagado: a.totalPagado || "",
    saldo: a.saldoPendiente || a.saldoPendienteGrupo || "",
    ultimoPagoFecha: a.ultimoPagoFecha || "",
    contactado: a.contactado ? "Sí" : "No",
    contactadoPor: a.contactadoPor || a.contactadoPorCorreo || "",
    contactadoAt: a.contactadoAt || "",
    prioridad: a.prioridad || ""
  }));

  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(wb, ws, "Alertas pagos");

  XLSX.writeFile(wb, `alertas_pagos_${fechaTxt}_${horaTxt}.xlsx`);
}

async function copiarTextoAlertaPago(alertaId) {
  const alerta = state.alertasPagosRows.find((row) => String(row.id) === String(alertaId));
  if (!alerta) return;

  const texto = getTextoSugeridoPago(alerta);

  try {
    await navigator.clipboard.writeText(texto);
    alert("Texto copiado.");
  } catch (error) {
    console.error("No se pudo copiar:", error);
    alert(texto);
  }
}

async function marcarAlertaPagoContactada(alertaId) {
  const alerta = state.alertasPagosRows.find((row) => String(row.id) === String(alertaId));
  if (!alerta) return;

  const ok = confirm(
    "Antes de marcar como contactado:\n\n" +
    "Recuerda registrar este contacto también en el historial del Sistema de Pagos.\n\n" +
    "¿Confirmas que ya lo registraste o que lo registrarás ahora?"
  );

  if (!ok) return;

  const nota = prompt("Nota del contacto realizado:", "") || "";

  const user = getEffectiveUser() || {};
  const realUser = getRealUser() || {};

  const payload = {
    ...alerta,
    contactado: true,
    contactadoAt: new Date().toISOString(),
    contactadoPor: user.nombre || user.name || user.email || "",
    contactadoPorCorreo: normalizeEmail(user.email || ""),
    contactadoRealPorCorreo: normalizeEmail(realUser.email || ""),
    notaContacto: nota,
    requiereRegistroHistorialPagos: true,
    mensajeAviso: "Debe registrar este contacto en historial del Sistema de Pagos",
    actualizadoAt: new Date().toISOString()
  };

  await setDoc(doc(db, ALERTAS_PAGOS_COLLECTION, alerta.id), payload, { merge: true });

  await addDoc(collection(db, ALERTAS_PAGOS_HISTORIAL_COLLECTION), {
    tipo: "contacto_alerta_pago",
    fecha: serverTimestamp(),
    usuario: user.nombre || user.name || user.email || "",
    usuarioCorreo: normalizeEmail(user.email || ""),
    realUsuarioCorreo: normalizeEmail(realUser.email || ""),
    alertaId: alerta.id,
    numeroNegocio: alerta.numeroNegocio || "",
    idGrupo: alerta.idGrupo || "",
    rut: alerta.rut || "",
    participante: alerta.participante || "",
    responsable: alerta.responsable || "",
    correoResponsable: alerta.correoResponsable || "",
    telefonoResponsable: alerta.telefonoResponsable || "",
    nota,
    aviso: "Usuario fue advertido de registrar contacto en historial del Sistema de Pagos"
  });

  await loadHomeData();
  renderHome();
  abrirModalAlertasPagos();
}

async function actualizarAlertasPagos() {
  const user = getEffectiveUser() || {};
  const realUser = getRealUser() || {};

  const ok = confirm(
    "Esto consultará el Sistema de Pagos y recalculará las alertas.\n\n" +
    "Puede demorar algunos minutos si hay muchos grupos.\n\n" +
    "¿Deseas continuar?"
  );

  if (!ok) return;

  const btn = $("btn-actualizar-alertas-pagos");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Actualizando...";
  }

  try {
    const dataGrupos = await fetchJsonPagos(`${API_PAGOS_URL}?modo=grupos`);
    const gruposPagos = (dataGrupos?.grupos?.data || []).map(normalizarGrupoPagos);

    const alertas = [];

    for (let i = 0; i < gruposPagos.length; i++) {
      const grupoPago = gruposPagos[i];
      if (!grupoPago.numeroNegocio) continue;

      const grupoRt = buscarGrupoRtPorNumeroNegocio(grupoPago.numeroNegocio) || {
        idGrupo: "",
        id: "",
        numeroNegocio: grupoPago.numeroNegocio,
        nombreGrupo: grupoPago.nombreGrupo,
        colegio: grupoPago.nombreGrupo,
        anoViaje: grupoPago.anoViaje,
        destino: grupoPago.destino,
        vendedora: "Sin vendedor",
        vendedoraCorreo: ""
      };

      if (btn) {
        btn.textContent = `Actualizando ${i + 1}/${gruposPagos.length}`;
      }

      const detalle = await fetchJsonPagos(
        `${API_PAGOS_URL}?modo=detalle&numeroNegocio=${encodeURIComponent(grupoPago.numeroNegocio)}`
      );

      const pasajerosRaw =
        detalle?.nominas?.data?.pasajeros ||
        detalle?.saldos?.data?.detalle_pasajeros ||
        [];

      const pasajeros = pasajerosRaw.map(normalizarPasajeroPagos);

      const grupoAlertaInfo = getTipoAlertaGrupoPago(grupoPago, pasajeros);

      if (grupoAlertaInfo) {
        const id = `grupo_${grupoPago.numeroNegocio}_${grupoAlertaInfo.tipo}`;

        alertas.push({
          id,
          categoriaAlerta: "grupo",
          tipo: grupoAlertaInfo.tipo,
          label: grupoAlertaInfo.label,
          nivel: grupoAlertaInfo.nivel,
          activa: true,
          prioridad: calcularPrioridadGrupo(grupoAlertaInfo, grupoPago),
          numeroNegocio: grupoPago.numeroNegocio,
          idGrupo: getRowId(grupoRt),
          grupo: getRowAlias(grupoRt),
          anoViaje: String(grupoPago.anoViaje || getAnoViajeNumber(grupoRt) || ""),
          destino: grupoPago.destino || grupoRt.destino || grupoRt.destinoPrincipal || "",
          moneda: grupoPago.monedaTexto,
          vendedor: getRowVendorName(grupoRt) || grupoRt.vendedoraCorreo || "",
          vendedoraCorreo: normalizeEmail(grupoRt.vendedoraCorreo || ""),
          porcentajeGrupoDebe: grupoAlertaInfo.porcentajeDebe,
          totalViajan: grupoAlertaInfo.totalViajan,
          totalConDeuda: grupoAlertaInfo.totalConDeuda,
          saldoPendienteGrupo: grupoPago.saldoPendiente,
          actualizadoAt: new Date().toISOString()
        });
      }

      const viajan = pasajeros.filter((p) => p.viaja);
      const conDeuda = viajan.filter((p) => p.saldoPendiente > 0);
      const porcentajeGrupoDebe = viajan.length > 0 ? (conDeuda.length / viajan.length) * 100 : 0;

      pasajeros.forEach((p) => {
        const tipoInfo = getTipoAlertaPersonaPago(p, grupoPago);
        if (!tipoInfo) return;

        const rutKey = String(p.rut || p.nombreCompleto || "")
          .replace(/[^a-zA-Z0-9]/g, "_")
          .slice(0, 80);

        const id = `persona_${grupoPago.numeroNegocio}_${rutKey}_${tipoInfo.tipo}`;

        alertas.push({
          id,
          categoriaAlerta: "persona",
          tipo: tipoInfo.tipo,
          label: tipoInfo.label,
          nivel: tipoInfo.nivel,
          activa: true,
          prioridad: calcularPrioridadPersona(tipoInfo, { porcentajeDebe: porcentajeGrupoDebe }),
          numeroNegocio: grupoPago.numeroNegocio,
          idGrupo: getRowId(grupoRt),
          grupo: getRowAlias(grupoRt),
          anoViaje: String(grupoPago.anoViaje || getAnoViajeNumber(grupoRt) || ""),
          destino: grupoPago.destino || grupoRt.destino || grupoRt.destinoPrincipal || "",
          moneda: grupoPago.monedaTexto,
          vendedor: getRowVendorName(grupoRt) || grupoRt.vendedoraCorreo || "",
          vendedoraCorreo: normalizeEmail(grupoRt.vendedoraCorreo || ""),
          rut: p.rut,
          participante: p.nombreCompleto,
          categoria: p.categoria,
          responsable: p.responsable,
          correoResponsable: p.correoResponsable,
          telefonoResponsable: p.telefonoResponsable,
          totalDebe: p.totalDebe,
          totalPagado: p.totalPagado,
          saldoPendiente: p.saldoPendiente,
          ultimoPagoFecha: p.ultimoPagoFecha,
          ultimoPagoMonto: p.ultimoPagoMonto,
          porcentajeGrupoDebe,
          actualizadoAt: new Date().toISOString()
        });
      });
    }

    state.alertasPagosRows = alertas
      .filter((row) => row.activa !== false)
      .sort((a, b) => Number(b.prioridad || 0) - Number(a.prioridad || 0));
    
    state.alertasPagosUltimaActualizacion = new Date();
    
    renderHome();
    abrirModalAlertasPagos();

    for (const alerta of alertas) {
      const anterior = state.alertasPagosRows.find((a) => String(a.id) === String(alerta.id));

      await setDoc(doc(db, ALERTAS_PAGOS_COLLECTION, alerta.id), {
        ...alerta,

        // Conserva marca de contacto si la alerta sigue viva al día siguiente.
        contactado: anterior?.contactado === true,
        contactadoAt: anterior?.contactadoAt || null,
        contactadoPor: anterior?.contactadoPor || "",
        contactadoPorCorreo: anterior?.contactadoPorCorreo || "",
        notaContacto: anterior?.notaContacto || "",

        actualizadoPor: user.nombre || user.name || user.email || "",
        actualizadoPorCorreo: normalizeEmail(user.email || ""),
        actualizadoRealPorCorreo: normalizeEmail(realUser.email || "")
      }, { merge: true });
    }

    await addDoc(collection(db, ALERTAS_PAGOS_HISTORIAL_COLLECTION), {
      tipo: "actualizacion_alertas_pagos",
      fecha: serverTimestamp(),
      usuario: user.nombre || user.name || user.email || "",
      usuarioCorreo: normalizeEmail(user.email || ""),
      realUsuarioCorreo: normalizeEmail(realUser.email || ""),
      totalAlertas: alertas.length,
      totalPersonas: alertas.filter((a) => a.categoriaAlerta === "persona").length,
      totalGrupos: alertas.filter((a) => a.categoriaAlerta === "grupo").length
    });

    await loadHomeData();
    renderHome();
    abrirModalAlertasPagos();

  } catch (error) {
    console.error("Error actualizando alertas de pagos:", error);
    alert("No se pudieron actualizar las alertas de pagos: " + error.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Actualizar";
    }
  }
}

function abrirModalAlertasPagos() {
  openListadoModal({
    titulo: "Alertas de pagos",
    subtitulo: "Alertas generadas desde el Sistema de Pagos, ordenadas por prioridad.",
    resumen: `Hay ${state.alertasPagosFiltradasRows.length} alerta(s) de pagos.`,
    rows: state.alertasPagosFiltradasRows,
    renderFn: (rows) => buildAlertasPagosFiltrosHtml(rows)
  });

  setTimeout(() => {
    const rowsBase = state.alertasPagosFiltradasRows || [];

    const refrescar = () => {
      const filtradas = filtrarAlertasPagosModal(rowsBase);
      renderAlertasPagosListado(filtradas);
    };

    ["filtro-alerta-pago-ano", "filtro-alerta-pago-vendedor", "filtro-alerta-pago-moneda", "filtro-alerta-pago-prioridad", "filtro-alerta-pago-buscar"]
      .forEach((id) => {
        const el = $(id);
        if (!el || el.dataset.bound) return;
        el.dataset.bound = "1";
        el.addEventListener("input", refrescar);
        el.addEventListener("change", refrescar);
      });

    const btnActualizar = $("btn-actualizar-alertas-pagos");
    if (btnActualizar && !btnActualizar.dataset.bound) {
      btnActualizar.dataset.bound = "1";
      btnActualizar.addEventListener("click", actualizarAlertasPagos);
    }

    const btnExportar = $("btn-exportar-alertas-pagos");
    if (btnExportar && !btnExportar.dataset.bound) {
      btnExportar.dataset.bound = "1";
      btnExportar.addEventListener("click", exportarAlertasPagosXlsx);
    }
    
    document.querySelectorAll("[data-tipo-alerta-pago]").forEach((btn) => {
      if (btn.dataset.bound) return;
      btn.dataset.bound = "1";
    
      btn.addEventListener("click", () => {
        btn.classList.toggle("is-active");
    
        if (btn.classList.contains("is-active")) {
          btn.style.background = "#f4eefb";
          btn.style.color = "#32184f";
        } else {
          btn.style.background = "#fff";
          btn.style.color = "#766b84";
        }
    
        refrescar();
      });
    });

    refrescar();
  }, 80);
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
  const linkAlertasPagos = $("link-alertas-pagos");
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

  if (!document.body.dataset.boundAlertasPagosAcciones) {
    document.body.dataset.boundAlertasPagosAcciones = "1";

    document.addEventListener("click", async (e) => {
      const filaDetalle = e.target.closest("[data-open-detalle-alerta-pago]");
      if (filaDetalle) {
        e.preventDefault();
        openDetalleAlertaPago(filaDetalle.dataset.openDetalleAlertaPago);
        return;
      }
      
      const btnCopy = e.target.closest("[data-copy-alerta-pago]");
      if (btnCopy) {
        e.preventDefault();
        await copiarTextoAlertaPago(btnCopy.dataset.copyAlertaPago);
        return;
      }

      const btnContactar = e.target.closest("[data-contactar-alerta-pago]");
      if (btnContactar) {
        e.preventDefault();
        await marcarAlertaPagoContactada(btnContactar.dataset.contactarAlertaPago);
      }
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

  if (linkAlertasPagos && !linkAlertasPagos.dataset.bound) {
    linkAlertasPagos.dataset.bound = "1";
    linkAlertasPagos.addEventListener("click", (e) => {
      e.preventDefault();
      abrirModalAlertasPagos();
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
