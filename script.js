// script.js — Dashboard Ventas RT conectado a Firestore

import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.7.3/firebase-auth.js";
import {
  collection,
  getDocs
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
  scopedRows: [],
  fichasPorFirmarRows: []
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

function isCaroDashboardUser(user = {}) {
  return normalizeEmail(user?.email || "") === "chernandez@raitrai.cl";
}

function isAdministracionDashboardUser(user = {}) {
  const email = normalizeEmail(user?.email || "");
  return (
    email === "yenny@raitrai.cl" ||
    email === "administracion@raitrai.cl"
  );
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
  return dedupeRowsByGroup(rows)
    .filter((row) => isFichaPorFirmarSegunUsuario(row, effectiveUser))
    .sort((a, b) => {
      const aliasA = getAliasColegioSortKey(getRowAlias(a));
      const aliasB = getAliasColegioSortKey(getRowAlias(b));
      return aliasA.localeCompare(aliasB, "es", { sensitivity: "base", numeric: true });
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

  setAlertRowVisibleByChild("link-sin-asignar", canSeeSinAsignar);
  setAlertRowVisibleByChild("link-fichas-firmar", canSeeFichas);
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

/* =========================================================
   CARGA DE DATOS
========================================================= */
async function loadDashboardData() {
  const snap = await getDocs(collection(db, "ventas_cotizaciones"));

  state.rows = snap.docs.map((docSnap) => {
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
  
  const setText = (id, value) => {
    const el = $(id);
    if (el) el.textContent = value;
  };

  const effectiveUser = getEffectiveUser();
  
  setText("count-sin-asignar", "0");
  setSinAsignarManagementHref();
  setAlertCountLink("count-a-contactar", 0, "a_contactar");
  setAlertHref("link-a-contactar", "a_contactar");
  setText("count-fichas-firmar", "0");
  setText("count-reunion-3dias", "0");
  
  syncAlertRowsByRole(effectiveUser);

  renderBucketLinks("contactados-top", "contactados", []);
  renderBucketLinks("cotizando-top", "cotizando", []);
  renderBucketLinks("reunion-top", "reunion", []);
  renderBucketLinks("perdidas-top", "perdidas", []);
  renderBucketLinks("recotizando-top", "recotizando", []);
  renderBucketLinks("ganadas-top", "ganadas", []);
  renderBucketLinks("autorizadas-top", "autorizadas", []);
  renderSingleTotalLink("cerradas-top", "cerradas", 0);
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

  const canSeeGlobalSinAsignar =
    isAdminDashboardRole(effectiveUser) ||
    isSupervisionDashboardRole(effectiveUser) ||
    isRegistroRole(effectiveUser);

  const sinAsignarRows = canSeeGlobalSinAsignar
    ? allRows.filter(isSinAsignar)
    : scopedRows.filter(isSinAsignar);

  const aContactarRows = scopedRows.filter(isAContactar);
  const reuniones3DiasRows = scopedRows.filter(isReunionEnProximosTresDias);

  // ALERTAS
  setText("count-sin-asignar", sinAsignarRows.length);
  setSinAsignarManagementHref();

  setAlertCountLink("count-a-contactar", aContactarRows.length, "a_contactar");
  setAlertHref("link-a-contactar", "a_contactar");

  setText("count-fichas-firmar", fichasPorFirmar.length);
  setText("count-reunion-3dias", reuniones3DiasRows.length);

  syncAlertRowsByRole(effectiveUser);

  // FLUJO CON LINKS
  renderBucketLinks("contactados-top", "contactados", contactados);
  renderBucketLinks("cotizando-top", "cotizando", cotizando);
  renderBucketLinks("reunion-top", "reunion", reunion);
  renderBucketLinks("perdidas-top", "perdidas", perdidas);
  renderBucketLinks("recotizando-top", "recotizando", recotizando);
  renderBucketLinks("ganadas-top", "ganadas", ganadas);
  renderBucketLinks("autorizadas-top", "autorizadas", autorizadas);
  renderSingleTotalLink("cerradas-top", "cerradas", cerradas.length);
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
    .map((row) => {
      const alias = getRowAlias(row);
      const apoderado = getRowApoderado(row);
  
      return {
        value: getRowId(row),
        label: `${alias} — ${apoderado}`,
        sortKey: `${getAliasColegioSortKey(alias)} ${alias} ${apoderado}`
      };
    })
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

  initSearchableSelect("select-grupo", "Buscar grupo...");
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
    await loadDashboardData();

    const rowsScope = getRowsForCurrentScope(effectiveUser);

    poblarSelectorVendedores(effectiveUser);
    poblarSelectorGrupos(effectiveUser, rowsScope);
    poblarSelectorApoderados(rowsScope);
    renderDashboard(rowsScope);
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

  const linkFichasFirmar = $("link-fichas-firmar");
  const btnCerrarFichasFirmar = $("btn-cerrar-fichas-firmar");
  const modalFichasFirmar = $("modal-fichas-firmar");

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

  if (modalFichasFirmar && !modalFichasFirmar.dataset.bound) {
    modalFichasFirmar.dataset.bound = "1";

    modalFichasFirmar.addEventListener("click", (e) => {
      if (e.target === modalFichasFirmar) {
        closeFichasPorFirmarModal();
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

initPage();
