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
  normalizeEmail
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

/* =========================================================
   ESTADO LOCAL
========================================================= */
const state = {
  rows: [],
  rowsById: new Map()
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
  if (estado.includes("contact") || estado.includes("a contactar")) return "contactados";

  return "";
}

function getBucketRows(rows = [], bucket = "") {
  return rows.filter((row) => resolveEstadoBucket(row) === bucket);
}

function isSinAsignar(row = {}) {
  return (
    isTruthyFlag(row.requiereAsignacion) ||
    (!getRowVendorEmail(row) && !normalizeLoose(getRowVendorName(row)))
  );
}

function isAContactar(row = {}) {
  return normalizeLoose(row.estado).includes("a contactar");
}

function isPendiente(row = {}) {
  return normalizeLoose(row.estado).includes("pendiente");
}

function isFichaPorFirmar(row = {}) {
  const candidateKeys = [
    "fichaFirmada",
    "firmaVendedor",
    "firmaSupervision",
    "firmaAdministracion",
    "fichaLista",
    "documentoFirmado"
  ];

  const existingKeys = candidateKeys.filter((key) => key in row);
  if (!existingKeys.length) return false;

  // Si existe una marca global y está falsa, cuenta
  if ("fichaFirmada" in row) {
    return !isTruthyFlag(row.fichaFirmada);
  }

  // Si existen firmas parciales y alguna está faltante, cuenta
  return existingKeys.some((key) => !isTruthyFlag(row[key]));
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
function inicializarDashboardEnCeros() {
  const setText = (id, value) => {
    const el = $(id);
    if (el) el.textContent = value;
  };

  setText("count-sin-asignar", "0");
  setText("count-a-contactar", "0");
  setText("count-fichas-firmar", "0");
  setText("count-reunion-3dias", "0");
  setText("count-pendientes", "0");

  setFlowNumbers("contactados", "00 | 00 | 00 | (00)", "00 | 00 | 00 | (00)");
  setFlowNumbers("cotizando", "00 | 00 | 00 | (00)", "00 | 00 | 00 | (00)");
  setFlowNumbers("reunion", "00 | 00 | 00 | (00)", "00 | 00 | 00 | (00)");
  setFlowNumbers("perdidas", "00 | 00 | 00 | (00)");
  setFlowNumbers("recotizando", "00 | 00 | 00 | (00)");
  setFlowNumbers("ganadas", "00 | 00 | 00 | (00)");
  setFlowNumbers("autorizadas", "00 | 00 | 00 | (00)");
  setFlowNumbers("cerradas", "00");
}

function renderDashboard(rows = []) {
  const setText = (id, value) => {
    const el = $(id);
    if (el) el.textContent = String(value);
  };

  const contactados = getBucketRows(rows, "contactados");
  const cotizando = getBucketRows(rows, "cotizando");
  const reunion = getBucketRows(rows, "reunion");
  const perdidas = getBucketRows(rows, "perdidas");
  const recotizando = getBucketRows(rows, "recotizando");
  const ganadas = getBucketRows(rows, "ganadas");
  const autorizadas = getBucketRows(rows, "autorizadas");
  const cerradas = getBucketRows(rows, "cerradas");

  // ALERTAS
  setText("count-sin-asignar", rows.filter(isSinAsignar).length);
  setText("count-a-contactar", rows.filter(isAContactar).length);
  setText("count-fichas-firmar", rows.filter(isFichaPorFirmar).length);
  setText("count-reunion-3dias", rows.filter(isReunionEnProximosTresDias).length);
  setText("count-pendientes", rows.filter(isPendiente).length);

  // FLUJO
  // Primera línea = por año comercial (base marzo)
  // Segunda línea, por ahora, la dejo igual que la primera en las cajas que tienen 2 líneas
  // para no inventar una lógica distinta todavía.
  setFlowNumbers("contactados", formatYearBuckets(contactados), formatYearBuckets(contactados));
  setFlowNumbers("cotizando", formatYearBuckets(cotizando), formatYearBuckets(cotizando));
  setFlowNumbers("reunion", formatYearBuckets(reunion), formatYearBuckets(reunion));
  setFlowNumbers("perdidas", formatYearBuckets(perdidas));
  setFlowNumbers("recotizando", formatYearBuckets(recotizando));
  setFlowNumbers("ganadas", formatYearBuckets(ganadas));
  setFlowNumbers("autorizadas", formatYearBuckets(autorizadas));
  setFlowNumbers("cerradas", pad2(cerradas.length));
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
      label: `${getRowAlias(row)} — ${getRowApoderado(row)}`
    }))
    .filter((item) => item.value)
    .sort((a, b) => a.label.localeCompare(b.label, "es", { sensitivity: "base" }));

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

      console.log("Grupo seleccionado:", grupoSeleccionado);
      // Cuando tengas definida la ficha destino, aquí puedes redirigir.
      // Ejemplo:
      // if (grupoSeleccionado) location.href = `grupo.html?id=${encodeURIComponent(grupoSeleccionado)}`;
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

      console.log("Apoderado seleccionado:", apoderadoSeleccionado);
      // Cuando tengas definida la ficha destino, aquí puedes redirigir.
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
