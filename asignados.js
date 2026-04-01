import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.7.3/firebase-auth.js";
import {
  collection,
  doc,
  getDocs,
  query,
  orderBy,
  limit,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";

import { auth, db, VENTAS_USERS } from "./firebase-init.js";

import {
  $,
  normalizeEmail,
  normalizeText,
  normalizeSearch,
  escapeHtml,
  getNombreUsuario
} from "./utils.js";

import {
  ACTING_USER_KEY,
  getRealUser,
  getEffectiveUser,
  isActingAsAnother,
  getVendorUsers
} from "./roles.js";

import {
  setHeaderState,
  renderActingUserSwitcher,
  bindLayoutButtons,
  setProgressStatus,
  clearProgressStatus,
  waitForLayoutReady
} from "./ui.js";

/* =========================================================
   CONFIG
========================================================= */
const GITHUB_HOME_URL = "https://sistemas-raitrai.github.io/Ventas-RT/";
const DETALLE_GRUPO_URL = "grupo.html";

/* =========================================================
   ESTADO
========================================================= */
const state = {
  realUser: null,
  effectiveUser: null,
  rows: [],
  filteredRows: [],
  tab: new URLSearchParams(window.location.search).get("tab") === "asignados"
    ? "asignados"
    : "sin_asignar",
  search: "",
  filters: {
    vendedora: "",
    anoViaje: "",
    estado: ""
  }
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

function getRoleKey(user = {}) {
  return normalizeLoose(user?.rol || "");
}

function canAccessAsignados(user = {}) {
  const role = getRoleKey(user);
  return role === "admin" || role === "supervision";
}

function assertAccess() {
  if (!canAccessAsignados(state.effectiveUser)) {
    location.href = "index.html";
    return false;
  }
  return true;
}

function getScopeText() {
  let text = "Asignación comercial · Supervisión / Admin";

  if (state.effectiveUser) {
    text += ` · ${getNombreUsuario(state.effectiveUser)}`;
  }

  if (isActingAsAnother(state.realUser, state.effectiveUser)) {
    return `Navegando como ${getNombreUsuario(state.effectiveUser)} · ${state.effectiveUser.rol} · ${text}`;
  }

  return text;
}

function setHeaderAndScope() {
  setHeaderState({
    realUser: state.realUser,
    effectiveUser: state.effectiveUser,
    scopeText: getScopeText()
  });

  renderActingUserSwitcher({
    realUser: state.realUser,
    effectiveUser: state.effectiveUser,
    users: VENTAS_USERS
  });

  const scope = $("asignadosScope");
  if (scope) {
    scope.textContent = state.tab === "sin_asignar"
      ? "Grupos sin vendedor(a) asignado."
      : "Grupos ya asignados para edición o desasignación.";
  }
}

function getRowId(row = {}) {
  return String(row.idGrupo || row.id || "").trim();
}

function getRowAlias(row = {}) {
  return normalizeText(
    row.aliasGrupo ||
    row.nombreGrupo ||
    row.colegio ||
    row.idGrupo ||
    row.id ||
    "Sin alias"
  );
}

function getRowVendorEmail(row = {}) {
  return normalizeEmail(row.vendedoraCorreo || "");
}

function getRowVendorName(row = {}) {
  return normalizeText(row.vendedora || "");
}

function isSinAsignar(row = {}) {
  return (
    isTruthyFlag(row.requiereAsignacion) ||
    (!getRowVendorEmail(row) && !getRowVendorName(row)) ||
    normalizeSearch(getRowVendorName(row)) === "sin asignar"
  );
}

function formatDateTime(value) {
  if (!value) return "";

  if (typeof value?.toDate === "function") {
    value = value.toDate();
  } else if (typeof value === "object" && typeof value.seconds === "number") {
    value = new Date(value.seconds * 1000);
  }

  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return "";

  const f = value.toLocaleDateString("es-CL");
  const h = value.toLocaleTimeString("es-CL", {
    hour: "2-digit",
    minute: "2-digit"
  });

  return `${f} ${h}`;
}

function getAnoViajeNumber(row = {}) {
  const raw = String(row.anoViaje ?? "").trim();
  const match = raw.match(/\d{4}/);
  if (!match) return null;

  const year = Number(match[0]);
  return Number.isFinite(year) ? year : null;
}

function getSearchTarget(row = {}) {
  return normalizeSearch([
    row.idGrupo,
    row.codigoRegistro,
    row.aliasGrupo,
    row.colegio,
    row.nombreCliente,
    row.estado,
    row.vendedora,
    row.anoViaje
  ].join(" "));
}

function getVendorOptions() {
  return getVendorUsers()
    .map((user) => ({
      email: normalizeEmail(user.email || ""),
      nombre: normalizeText(`${user.nombre || ""} ${user.apellido || ""}`.trim() || user.nombre || "")
    }))
    .filter((item) => item.email && item.nombre)
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" }));
}

function findVendorByEmail(email = "") {
  const target = normalizeEmail(email);
  if (!target) return null;
  return getVendorOptions().find((v) => v.email === target) || null;
}

/* =========================================================
   CARGA
========================================================= */
async function loadData() {
  try {
    setProgressStatus({
      text: "Cargando asignaciones...",
      meta: "Leyendo grupos comerciales...",
      progress: 20
    });

    const snap = await getDocs(collection(db, "ventas_cotizaciones"));

    state.rows = snap.docs.map((docSnap) => {
      const data = docSnap.data() || {};
      return {
        id: docSnap.id,
        idGrupo: data.idGrupo || docSnap.id,
        ...data
      };
    });

    populateFilters();
    applyFilters();

    setProgressStatus({
      text: "Asignaciones cargadas.",
      meta: `${state.rows.length} grupo(s) encontrados.`,
      progress: 100,
      type: "success"
    });
    clearProgressStatus();
  } catch (error) {
    console.error(error);
    setProgressStatus({
      text: "Error cargando asignaciones.",
      meta: error.message || "No se pudo leer Firestore.",
      progress: 100,
      type: "error"
    });
  }
}

/* =========================================================
   FILTROS
========================================================= */
function fillSelect(selectId, values = [], placeholder = "Todos") {
  const select = $(selectId);
  if (!select) return;

  const current = select.value || "";
  select.innerHTML = `<option value="">${placeholder}</option>`;

  values.forEach((value) => {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = value;
    select.appendChild(opt);
  });

  select.value = values.includes(current) ? current : "";
}

function populateFilters() {
  fillSelect(
    "filterVendedora",
    getVendorOptions().map((v) => v.nombre),
    "Todas las vendedoras"
  );

  fillSelect(
    "filterAnoViaje",
    [...new Set(state.rows.map((r) => normalizeText(r.anoViaje)).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "es", { numeric: true })),
    "Todos los años"
  );

  fillSelect(
    "filterEstado",
    [...new Set(state.rows.map((r) => normalizeText(r.estado)).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" })),
    "Todos los estados"
  );
}

function applyFilters() {
  let rows = [...state.rows];

  rows = rows.filter((row) => {
    return state.tab === "sin_asignar" ? isSinAsignar(row) : !isSinAsignar(row);
  });

  if (state.filters.vendedora) {
    rows = rows.filter((row) => normalizeText(row.vendedora) === state.filters.vendedora);
  }

  if (state.filters.anoViaje) {
    rows = rows.filter((row) => normalizeText(row.anoViaje) === state.filters.anoViaje);
  }

  if (state.filters.estado) {
    rows = rows.filter((row) => normalizeText(row.estado) === state.filters.estado);
  }

  const q = normalizeSearch(state.search || "");
  if (q) {
    rows = rows.filter((row) => getSearchTarget(row).includes(q));
  }

  rows.sort((a, b) => {
    const aId = Number(getRowId(a)) || 0;
    const bId = Number(getRowId(b)) || 0;
    return bId - aId;
  });

  state.filteredRows = rows;
  renderTabs();
  renderTable();
}

/* =========================================================
   RENDER
========================================================= */
function renderTabs() {
  $("btnTabSinAsignar")?.classList.toggle("active", state.tab === "sin_asignar");
  $("btnTabAsignados")?.classList.toggle("active", state.tab === "asignados");

  const scope = $("asignadosScope");
  if (scope) {
    scope.textContent = state.tab === "sin_asignar"
      ? "Grupos sin vendedor(a) asignado."
      : "Grupos ya asignados para edición o desasignación.";
  }
}

function buildVendorSelect(row = {}) {
  const currentEmail = normalizeEmail(row.vendedoraCorreo || "");
  const options = getVendorOptions();

  return `
    <select class="assign-select" data-role="assign-select" data-id="${escapeHtml(getRowId(row))}">
      <option value="">Seleccionar vendedor(a)</option>
      ${options.map((opt) => `
        <option value="${escapeHtml(opt.email)}" ${opt.email === currentEmail ? "selected" : ""}>
          ${escapeHtml(opt.nombre)}
        </option>
      `).join("")}
    </select>
  `;
}

function renderTable() {
  const tbody = $("tbodyAsignados");
  const empty = $("emptyState");
  const summary = $("tableSummary");

  if (!tbody || !empty || !summary) return;

  summary.textContent = `${state.filteredRows.length} registro(s) en esta vista`;

  if (!state.filteredRows.length) {
    tbody.innerHTML = "";
    empty.classList.remove("hidden");
    return;
  }

  empty.classList.add("hidden");

  tbody.innerHTML = state.filteredRows.map((row) => {
    const idGrupo = getRowId(row);
    const alias = getRowAlias(row);
    const colegio = normalizeText(row.colegio || "");
    const anoViaje = normalizeText(row.anoViaje || "");
    const cliente = normalizeText(row.nombreCliente || "—");
    const estado = normalizeText(row.estado || "—");
    const vendedora = normalizeText(row.vendedora || "Sin asignar");
    const correoVendedora = normalizeEmail(row.vendedoraCorreo || "");

    return `
      <tr>
        <td>${escapeHtml(idGrupo)}</td>
        <td>${escapeHtml(alias)}</td>
        <td>${escapeHtml(colegio)}</td>
        <td>${escapeHtml(anoViaje)}</td>
        <td>${escapeHtml(cliente)}</td>
        <td>${escapeHtml(estado)}</td>
        <td>
          <div class="assignment-current">
            <strong>${escapeHtml(vendedora || "Sin asignar")}</strong>
            <small>${escapeHtml(correoVendedora || "—")}</small>
          </div>
        </td>
        <td>
          ${buildVendorSelect(row)}
        </td>
        <td>
          <div class="table-actions">
            <button class="btn-mini edit" data-action="save-assignment" data-id="${escapeHtml(idGrupo)}">
              ${state.tab === "sin_asignar" ? "Asignar" : "Guardar"}
            </button>

            ${state.tab === "asignados" ? `
              <button class="btn-mini warn" data-action="remove-assignment" data-id="${escapeHtml(idGrupo)}">
                Quitar asignación
              </button>
            ` : ""}

            <button class="btn-mini open" data-action="history" data-id="${escapeHtml(idGrupo)}">
              Historial
            </button>

            <button class="btn-mini open" data-action="open-group" data-id="${escapeHtml(idGrupo)}">
              Abrir grupo
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join("");
}

/* =========================================================
   HISTORIAL
========================================================= */
async function writeAssignmentHistory({
  idGrupo,
  tipo,
  anteriorVendedora,
  anteriorVendedoraCorreo,
  nuevaVendedora,
  nuevaVendedoraCorreo,
  estadoAnterior,
  estadoNuevo
}) {
  const ref = doc(collection(db, "ventas_cotizaciones", String(idGrupo), "historialAsignaciones"));

  await setDoc(ref, {
    idGrupo: String(idGrupo),
    tipo: normalizeText(tipo),
    campo: "vendedora",
    anteriorVendedora: normalizeText(anteriorVendedora || ""),
    anteriorVendedoraCorreo: normalizeEmail(anteriorVendedoraCorreo || ""),
    nuevaVendedora: normalizeText(nuevaVendedora || ""),
    nuevaVendedoraCorreo: normalizeEmail(nuevaVendedoraCorreo || ""),
    estadoAnterior: normalizeText(estadoAnterior || ""),
    estadoNuevo: normalizeText(estadoNuevo || ""),
    hechoPor: getNombreUsuario(state.effectiveUser),
    hechoPorCorreo: normalizeEmail(state.realUser?.email || ""),
    fecha: serverTimestamp()
  });
}

async function openHistory(idGrupo) {
  const modal = $("historyModal");
  const body = $("historyBody");
  const title = $("historyTitle");

  if (!modal || !body || !title) return;

  title.textContent = `Historial de asignación · Grupo ${idGrupo}`;
  body.innerHTML = `<div class="history-empty">Cargando historial...</div>`;
  modal.classList.add("show");

  try {
    const qy = query(
      collection(db, "ventas_cotizaciones", String(idGrupo), "historialAsignaciones"),
      orderBy("fecha", "desc"),
      limit(20)
    );

    const snap = await getDocs(qy);

    if (snap.empty) {
      body.innerHTML = `<div class="history-empty">No hay historial de asignación todavía.</div>`;
      return;
    }

    body.innerHTML = snap.docs.map((docSnap) => {
      const row = docSnap.data() || {};

      return `
        <div class="history-item">
          <div class="history-top">
            <strong>${escapeHtml(normalizeText(row.tipo || "Cambio"))}</strong>
            <span>${escapeHtml(formatDateTime(row.fecha) || "Fecha pendiente")}</span>
          </div>

          <div class="history-line">
            <strong>Antes:</strong>
            ${escapeHtml(normalizeText(row.anteriorVendedora || "Sin asignar"))}
            ${row.anteriorVendedoraCorreo ? ` · ${escapeHtml(normalizeEmail(row.anteriorVendedoraCorreo))}` : ""}
          </div>

          <div class="history-line">
            <strong>Después:</strong>
            ${escapeHtml(normalizeText(row.nuevaVendedora || "Sin asignar"))}
            ${row.nuevaVendedoraCorreo ? ` · ${escapeHtml(normalizeEmail(row.nuevaVendedoraCorreo))}` : ""}
          </div>

          <div class="history-line">
            <strong>Estado:</strong>
            ${escapeHtml(normalizeText(row.estadoAnterior || "—"))}
            → 
            ${escapeHtml(normalizeText(row.estadoNuevo || "—"))}
          </div>

          <div class="history-line">
            <strong>Hecho por:</strong>
            ${escapeHtml(normalizeText(row.hechoPor || "—"))}
            ${row.hechoPorCorreo ? ` · ${escapeHtml(normalizeEmail(row.hechoPorCorreo))}` : ""}
          </div>
        </div>
      `;
    }).join("");
  } catch (error) {
    console.error(error);
    body.innerHTML = `<div class="history-empty">No se pudo cargar el historial.</div>`;
  }
}

function closeHistory() {
  $("historyModal")?.classList.remove("show");
}

/* =========================================================
   GUARDAR / QUITAR ASIGNACIÓN
========================================================= */
async function saveAssignment(idGrupo) {
  const row = state.rows.find((item) => getRowId(item) === String(idGrupo));
  if (!row) return;

  const select = document.querySelector(`[data-role="assign-select"][data-id="${CSS.escape(String(idGrupo))}"]`);
  if (!select) return;

  const selectedEmail = normalizeEmail(select.value || "");
  if (!selectedEmail) {
    alert("Debes seleccionar una vendedora.");
    return;
  }

  const vendor = findVendorByEmail(selectedEmail);
  if (!vendor) {
    alert("No se encontró la vendedora seleccionada.");
    return;
  }

  const anteriorVendedora = getRowVendorName(row) || "Sin asignar";
  const anteriorVendedoraCorreo = getRowVendorEmail(row) || "";
  const nuevaVendedora = vendor.nombre;
  const nuevaVendedoraCorreo = vendor.email;

  const noCambioReal =
    normalizeEmail(anteriorVendedoraCorreo) === normalizeEmail(nuevaVendedoraCorreo) &&
    normalizeSearch(anteriorVendedora) === normalizeSearch(nuevaVendedora) &&
    !isSinAsignar(row);

  if (noCambioReal) {
    alert("No hay cambios de asignación para guardar.");
    return;
  }

  const tipo = isSinAsignar(row) ? "Asignación" : "Reasignación";

  try {
    setProgressStatus({
      text: `${tipo} en proceso...`,
      meta: `Grupo ${idGrupo}`,
      progress: 40
    });

    const patch = {
      vendedora: nuevaVendedora,
      vendedoraCorreo: nuevaVendedoraCorreo,
      requiereAsignacion: false,
      estado: "A contactar",
      fechaUltimoCambioEstado: serverTimestamp(),
      actualizadoPor: getNombreUsuario(state.effectiveUser),
      actualizadoPorCorreo: normalizeEmail(state.realUser?.email || ""),
      fechaActualizacion: serverTimestamp()
    };

    await setDoc(doc(db, "ventas_cotizaciones", String(idGrupo)), patch, { merge: true });

    await writeAssignmentHistory({
      idGrupo,
      tipo,
      anteriorVendedora,
      anteriorVendedoraCorreo,
      nuevaVendedora,
      nuevaVendedoraCorreo,
      estadoAnterior: normalizeText(row.estado || ""),
      estadoNuevo: "A contactar"
    });

    setProgressStatus({
      text: `${tipo} realizada.`,
      meta: `Grupo ${idGrupo} actualizado.`,
      progress: 100,
      type: "success"
    });
    clearProgressStatus();

    await loadData();
  } catch (error) {
    console.error(error);
    setProgressStatus({
      text: `Error en ${tipo.toLowerCase()}.`,
      meta: error.message || "No se pudo guardar la asignación.",
      progress: 100,
      type: "error"
    });
  }
}

async function removeAssignment(idGrupo) {
  const row = state.rows.find((item) => getRowId(item) === String(idGrupo));
  if (!row) return;

  const ok = confirm(`¿Seguro que quieres quitar la asignación del grupo ${idGrupo}?`);
  if (!ok) return;

  try {
    setProgressStatus({
      text: "Quitando asignación...",
      meta: `Grupo ${idGrupo}`,
      progress: 40
    });

    const anteriorVendedora = getRowVendorName(row) || "Sin asignar";
    const anteriorVendedoraCorreo = getRowVendorEmail(row) || "";

    const patch = {
      vendedora: "Sin asignar",
      vendedoraCorreo: "",
      requiereAsignacion: true,
      estado: "A contactar",
      fechaUltimoCambioEstado: serverTimestamp(),
      actualizadoPor: getNombreUsuario(state.effectiveUser),
      actualizadoPorCorreo: normalizeEmail(state.realUser?.email || ""),
      fechaActualizacion: serverTimestamp()
    };

    await setDoc(doc(db, "ventas_cotizaciones", String(idGrupo)), patch, { merge: true });

    await writeAssignmentHistory({
      idGrupo,
      tipo: "Desasignación",
      anteriorVendedora,
      anteriorVendedoraCorreo,
      nuevaVendedora: "Sin asignar",
      nuevaVendedoraCorreo: "",
      estadoAnterior: normalizeText(row.estado || ""),
      estadoNuevo: "A contactar"
    });

    setProgressStatus({
      text: "Asignación quitada.",
      meta: `Grupo ${idGrupo} volvió a Sin asignar.`,
      progress: 100,
      type: "success"
    });
    clearProgressStatus();

    await loadData();
  } catch (error) {
    console.error(error);
    setProgressStatus({
      text: "Error quitando asignación.",
      meta: error.message || "No se pudo desasignar el grupo.",
      progress: 100,
      type: "error"
    });
  }
}

/* =========================================================
   EVENTOS
========================================================= */
function bindPageEvents() {
  const searchInput = $("searchInput");
  const filterVendedora = $("filterVendedora");
  const filterAnoViaje = $("filterAnoViaje");
  const filterEstado = $("filterEstado");
  const btnRecargar = $("btnRecargar");
  const btnTabSinAsignar = $("btnTabSinAsignar");
  const btnTabAsignados = $("btnTabAsignados");
  const tbody = $("tbodyAsignados");
  const historyModal = $("historyModal");
  const historyCloseBtn = $("historyCloseBtn");
  const historyCloseBtn2 = $("historyCloseBtn2");

  if (searchInput && !searchInput.dataset.bound) {
    searchInput.dataset.bound = "1";
    searchInput.addEventListener("input", (e) => {
      state.search = e.target.value || "";
      applyFilters();
    });
  }

  if (filterVendedora && !filterVendedora.dataset.bound) {
    filterVendedora.dataset.bound = "1";
    filterVendedora.addEventListener("change", (e) => {
      state.filters.vendedora = normalizeText(e.target.value || "");
      applyFilters();
    });
  }

  if (filterAnoViaje && !filterAnoViaje.dataset.bound) {
    filterAnoViaje.dataset.bound = "1";
    filterAnoViaje.addEventListener("change", (e) => {
      state.filters.anoViaje = normalizeText(e.target.value || "");
      applyFilters();
    });
  }

  if (filterEstado && !filterEstado.dataset.bound) {
    filterEstado.dataset.bound = "1";
    filterEstado.addEventListener("change", (e) => {
      state.filters.estado = normalizeText(e.target.value || "");
      applyFilters();
    });
  }

  if (btnRecargar && !btnRecargar.dataset.bound) {
    btnRecargar.dataset.bound = "1";
    btnRecargar.addEventListener("click", async () => {
      await loadData();
    });
  }

  if (btnTabSinAsignar && !btnTabSinAsignar.dataset.bound) {
    btnTabSinAsignar.dataset.bound = "1";
    btnTabSinAsignar.addEventListener("click", () => {
      state.tab = "sin_asignar";
      applyFilters();
    });
  }

  if (btnTabAsignados && !btnTabAsignados.dataset.bound) {
    btnTabAsignados.dataset.bound = "1";
    btnTabAsignados.addEventListener("click", () => {
      state.tab = "asignados";
      applyFilters();
    });
  }

  if (tbody && !tbody.dataset.bound) {
    tbody.dataset.bound = "1";

    tbody.addEventListener("click", async (e) => {
      const btn = e.target.closest("button[data-action]");
      if (!btn) return;

      const action = btn.dataset.action || "";
      const id = btn.dataset.id || "";

      if (action === "save-assignment") {
        await saveAssignment(id);
        return;
      }

      if (action === "remove-assignment") {
        await removeAssignment(id);
        return;
      }

      if (action === "history") {
        await openHistory(id);
        return;
      }

      if (action === "open-group") {
        location.href = `${DETALLE_GRUPO_URL}?id=${encodeURIComponent(id)}`;
      }
    });
  }

  if (historyCloseBtn && !historyCloseBtn.dataset.bound) {
    historyCloseBtn.dataset.bound = "1";
    historyCloseBtn.addEventListener("click", closeHistory);
  }

  if (historyCloseBtn2 && !historyCloseBtn2.dataset.bound) {
    historyCloseBtn2.dataset.bound = "1";
    historyCloseBtn2.addEventListener("click", closeHistory);
  }

  if (historyModal && !historyModal.dataset.bound) {
    historyModal.dataset.bound = "1";
    historyModal.addEventListener("click", (e) => {
      if (e.target === historyModal) closeHistory();
    });
  }
}

/* =========================================================
   HEADER / LAYOUT
========================================================= */
function bindHeaderActions() {
  bindLayoutButtons({
    homeUrl: GITHUB_HOME_URL,
    onLogout: async () => {
      try {
        sessionStorage.removeItem(ACTING_USER_KEY);
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
      await bootstrapFromSession();
      if (!assertAccess()) return;
      setHeaderAndScope();
      await loadData();
    },
    onResetActAs: async () => {
      sessionStorage.removeItem(ACTING_USER_KEY);
      await bootstrapFromSession();
      if (!assertAccess()) return;
      setHeaderAndScope();
      await loadData();
    }
  });
}

/* =========================================================
   INIT
========================================================= */
async function bootstrapFromSession() {
  state.realUser = getRealUser();
  state.effectiveUser = getEffectiveUser();
}

async function initPage() {
  await waitForLayoutReady();

  bindPageEvents();

  onAuthStateChanged(auth, async (user) => {
    if (!user) return;

    await bootstrapFromSession();
    if (!assertAccess()) return;

    setHeaderAndScope();
    bindHeaderActions();
    await loadData();
  });
}

initPage();
