import { auth, db, VENTAS_USERS } from "./firebase-init.js";
import { requireAuth } from "./auth.js";
import { toast, wireLogout, setActiveNav } from "./ui.js";
import { loadSidebar } from "./layout.js";
import { normalizeEmail } from "./utils.js";
import {
  ACTING_USER_KEY
} from "./roles.js";

import {
  collection,
  getDocs
} from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";

await loadSidebar({ active: "seguimiento" });
setActiveNav?.("seguimiento");
wireLogout?.();
await requireAuth();

/* =========================================================
   SEGUIMIENTO DE GRUPOS
   ---------------------------------------------------------
   Esta vista está preparada para leer estos campos del doc:
   - alias
   - nombreApoderado
   - nombreGrupo
   - colegio
   - curso
   - anoViaje
   - destino
   - estado
   - autorizada / autorizacion
   - cerrada / cierre
   - imagen / imagenUrl
   - ultimaGestionAt / actualizadoEl / updatedAt / fechaModificacion
   - fechaUltimaReunion / ultimaReunion
   - fichaMedicaEstado
   - nominaEstado
   - fichaEstado
   - contratoEstado
   - cortesiaEstado

   IMPORTANTE PARA MÁS ADELANTE:
   cuando implementes el historial real, conviene que cada cambio:
   1) escriba una fila de historial
   2) actualice en el grupo: ultimaGestionAt = serverTimestamp()
   así esta vista no necesita recorrer miles de cambios para saber
   la última gestión.
========================================================= */

const $ = (id) => document.getElementById(id);
const CURRENT_YEAR = new Date().getFullYear();

const state = {
  rows: [],
  filtered: [],
  currentUserEmail: "",
  canSeeAll: false
};

const STAGE_META = {
  a_contactar: {
    label: "A contactar",
    steps: 1,
    className: "fill-red"
  },
  contactado: {
    label: "Contactado",
    steps: 2,
    className: "fill-orange"
  },
  cotizando: {
    label: "Cotizando",
    steps: 3,
    className: "fill-yellow"
  },
  recotizando: {
    label: "Recotizando",
    steps: 3,
    className: "fill-yellow"
  },
  reunion_confirmada: {
    label: "Reunión confirmada",
    steps: 4,
    className: "fill-mix"
  },
  ganada: {
    label: "Ganada",
    steps: 5,
    className: "fill-green"
  },
  perdida: {
    label: "Perdida",
    steps: 5,
    className: "fill-red"
  }
};

const DOCS_META = [
  { key: "fichaMedicaEstado", label: "Fichas médicas", icon: "🩺" },
  { key: "nominaEstado", label: "Nómina de viaje", icon: "📋" },
  { key: "fichaEstado", label: "Ficha del grupo", icon: "🧾" },
  { key: "contratoEstado", label: "Contrato", icon: "✍️" },
  { key: "cortesiaEstado", label: "Estadías de cortesía", icon: "🎁" }
];

/* =========================================================
   INIT
========================================================= */
init().catch((err) => {
  console.error("[seguimiento] error init:", err);
  toast?.("No se pudo cargar el seguimiento.");
  renderEmpty("Ocurrió un error al cargar la vista.");
});

async function init() {
  resolveCurrentUserContext();
  bindEvents();
  await loadRows();
}

/* =========================================================
   EVENTOS
========================================================= */
function bindEvents() {
  $("filtroAno")?.addEventListener("change", applyFiltersAndRender);
  $("filtroEstado")?.addEventListener("change", applyFiltersAndRender);
  $("filtroVendedora")?.addEventListener("change", applyFiltersAndRender);
  $("toggleAnteriores")?.addEventListener("change", applyFiltersAndRender);

  $("buscadorSeguimiento")?.addEventListener("input", debounce(() => {
    applyFiltersAndRender();
  }, 180));

  $("btnRecargarSeguimiento")?.addEventListener("click", async () => {
    await loadRows();
  });
}

/* =========================================================
   CONTEXTO USUARIO / ROL
========================================================= */
function resolveCurrentUserContext() {
  const authEmail = normalizeEmail(auth.currentUser?.email || "");
  const actingEmail = readActingUserEmail();
  state.currentUserEmail = actingEmail || authEmail;
  state.canSeeAll = detectGlobalAccess(state.currentUserEmail);
}

function readActingUserEmail() {
  try {
    const raw = localStorage.getItem(ACTING_USER_KEY);
    if (!raw) return "";

    const parsed = JSON.parse(raw);
    const email =
      parsed?.email ||
      parsed?.correo ||
      parsed?.userEmail ||
      parsed?.vendedoraCorreo ||
      "";

    return normalizeEmail(email);
  } catch {
    return "";
  }
}

function detectGlobalAccess(email) {
  const safeEmail = normalizeEmail(email);
  const meta = VENTAS_USERS?.[safeEmail] || {};

  const rol = String(
    meta?.rol || meta?.role || meta?.tipo || meta?.perfil || ""
  ).toLowerCase();

  if (!rol) {
    return false;
  }

  return [
    "admin",
    "administracion",
    "supervisor",
    "supervision",
    "gerencia",
    "director",
    "direccion"
  ].some((token) => rol.includes(token));
}

/* =========================================================
   CARGA
========================================================= */
async function loadRows() {
  renderEmpty("Cargando grupos...");

  const snap = await getDocs(collection(db, "clientes"));
  const rows = [];

  snap.forEach((docSnap) => {
    rows.push(mapDocToRow(docSnap.id, docSnap.data() || {}));
  });

  state.rows = rows;
  fillYearFilter(rows);
  fillVendorFilter(rows);
  applyFiltersAndRender();
}

/* =========================================================
   MAPEO
========================================================= */
function mapDocToRow(id, data) {
  const alias = cleanText(data.alias);
  const nombreApoderado = cleanText(
    data.nombreApoderado ||
    data.apoderado ||
    data.apoderadoNombre ||
    data.nombreResponsable
  );

  const nombreGrupo = cleanText(
    data.nombreGrupo ||
    data.grupo ||
    data.nombre ||
    data.colegio
  );

  const colegio = cleanText(data.colegio);
  const curso = cleanText(data.curso);
  const anoViaje = Number(data.anoViaje || data.anioViaje || data.ano || 0) || 0;
  const destino = cleanText(data.destino || data.programa || "Sin destino");
  const estado = normalizeEstado(
    data.estado ||
    data.estadoGrupo ||
    data.estadoComercial ||
    data.etapaComercial ||
    data.estadoSeguimiento
  );

  const autorizada = resolveAutorizada(data);
  const cerrada = resolveCerrada(data);

  const imagen = cleanText(
    data.imagen ||
    data.imagenUrl ||
    data.foto ||
    data.logo ||
    data.logoUrl
  );

  const ultimaGestionRaw =
    data.ultimaGestionAt ||
    data.ultimaGestion ||
    data.actualizadoEl ||
    data.updatedAt ||
    data.modificadoEl ||
    data.fechaModificacion ||
    data.fechaActualizacion ||
    data.creadoEl ||
    data.fechaCreacion ||
    null;

  const fechaUltimaReunionRaw =
    data.fechaUltimaReunion ||
    data.ultimaReunion ||
    data.reunionFecha ||
    data.fechaReunion ||
    null;

  const vendedora = cleanText(
    data.vendedora ||
    data.creadoPor ||
    data.vendedor ||
    data.usuario ||
    ""
  );

  const vendedoraCorreo = normalizeEmail(
    data.vendedoraCorreo ||
    data.creadoPorCorreo ||
    data.vendedorCorreo ||
    data.usuarioCorreo ||
    ""
  );

  const fichaMedicaEstado = normalizeDocState(
    data.fichaMedicaEstado ||
    data.estadoFichaMedica ||
    data.medicasEstado
  );

  const nominaEstado = normalizeDocState(
    data.nominaEstado ||
    data.estadoNomina ||
    data.listadoEstado
  );

  const fichaEstado = normalizeDocState(
    data.fichaEstado ||
    data.estadoFicha ||
    data.fichaGrupoEstado
  );

  const contratoEstado = normalizeDocState(
    data.contratoEstado ||
    data.estadoContrato
  );

  const cortesiaEstado = normalizeDocState(
    data.cortesiaEstado ||
    data.estadoCortesia ||
    data.estadiasCortesiaEstado
  );

  const displayTitle = alias || nombreApoderado || nombreGrupo || `Grupo ${id}`;
  const subtitleParts = [
    nombreGrupo && nombreGrupo !== displayTitle ? nombreGrupo : "",
    colegio,
    curso ? `Curso ${curso}` : "",
    anoViaje ? `Año ${anoViaje}` : ""
  ].filter(Boolean);

  const searchIndex = normalizeSearchText([
    id,
    alias,
    nombreApoderado,
    nombreGrupo,
    colegio,
    curso,
    destino,
    vendedora,
    vendedoraCorreo,
    anoViaje
  ].join(" "));

  return {
    id,
    alias,
    nombreApoderado,
    nombreGrupo,
    colegio,
    curso,
    anoViaje,
    destino,
    estado,
    autorizada,
    cerrada,
    imagen,
    ultimaGestionAt: toDate(ultimaGestionRaw),
    fechaUltimaReunion: toDate(fechaUltimaReunionRaw),
    vendedora,
    vendedoraCorreo,
    fichaMedicaEstado,
    nominaEstado,
    fichaEstado,
    contratoEstado,
    cortesiaEstado,
    displayTitle,
    subtitleParts,
    searchIndex
  };
}

/* =========================================================
   FILTROS
========================================================= */
function applyFiltersAndRender() {
  const yearValue = $("filtroAno")?.value || "todos";
  const stateValue = $("filtroEstado")?.value || "todos";
  const vendorValue = $("filtroVendedora")?.value || "todos";
  const showOld = !!$("toggleAnteriores")?.checked;
  const search = normalizeSearchText($("buscadorSeguimiento")?.value || "");

  const currentVendorMeta = VENTAS_USERS?.[state.currentUserEmail] || {};
  const currentVendorName = normalizeSearchText(
    currentVendorMeta?.nombre || currentVendorMeta?.name || ""
  );

  let rows = [...state.rows];

  rows = rows.filter((row) => {
    if (state.canSeeAll) return true;

    const rowVendorEmail = normalizeEmail(row.vendedoraCorreo);
    const rowVendorName = normalizeSearchText(row.vendedora);

    if (rowVendorEmail && rowVendorEmail === state.currentUserEmail) return true;
    if (currentVendorName && rowVendorName && rowVendorName === currentVendorName) return true;

    return false;
  });

  rows = rows.filter((row) => {
    if (yearValue !== "todos") {
      return String(row.anoViaje || "") === String(yearValue);
    }

    if (showOld) return true;
    return (row.anoViaje || 0) >= CURRENT_YEAR;
  });

  rows = rows.filter((row) => {
    if (stateValue === "todos") return true;
    return row.estado === stateValue;
  });

  rows = rows.filter((row) => {
    if (!state.canSeeAll) return true;
    if (vendorValue === "todos") return true;

    const target = normalizeSearchText(vendorValue);
    return (
      normalizeEmail(row.vendedoraCorreo) === normalizeEmail(vendorValue) ||
      normalizeSearchText(row.vendedora) === target
    );
  });

  rows = rows.filter((row) => {
    if (!search) return true;
    return row.searchIndex.includes(search);
  });

  rows.sort((a, b) => {
    const aYear = Number(a.anoViaje || 0);
    const bYear = Number(b.anoViaje || 0);
    if (aYear !== bYear) return aYear - bYear;

    const aDate = a.ultimaGestionAt ? a.ultimaGestionAt.getTime() : 0;
    const bDate = b.ultimaGestionAt ? b.ultimaGestionAt.getTime() : 0;
    if (aDate !== bDate) return bDate - aDate;

    return a.displayTitle.localeCompare(b.displayTitle, "es", { sensitivity: "base" });
  });

  state.filtered = rows;
  renderSummary(rows);
  renderRows(rows);
}

/* =========================================================
   RENDER
========================================================= */
function renderRows(rows) {
  const tbody = $("tbodySeguimiento");
  if (!tbody) return;

  if (!rows.length) {
    renderEmpty("No hay grupos para los filtros seleccionados.");
    return;
  }

  tbody.innerHTML = rows.map(renderRow).join("");
}

function renderRow(row) {
  const progress = renderProgress(row.estado);
  const docs = renderDocs(row);
  const avatar = renderAvatar(row);
  const ultimaGestion = formatDateTime(row.ultimaGestionAt);
  const ultimaReunion = formatDateTime(row.fechaUltimaReunion);

  return `
    <tr>
      <td>
        <div class="seg-group">
          <div class="seg-avatar">${avatar}</div>

          <div class="seg-group-info">
            <div class="seg-group-title">${escapeHtml(row.displayTitle)}</div>

            <div class="seg-group-sub">
              ${row.subtitleParts.map(part => `<span>${escapeHtml(part)}</span>`).join("")}
              ${row.vendedora ? `<span class="seg-chip seg-chip-vendor">${escapeHtml(row.vendedora)}</span>` : ""}
            </div>
          </div>
        </div>
      </td>

      <td class="seg-destino">${escapeHtml(row.destino || "Sin destino")}</td>

      <td class="seg-progress-cell">${progress}</td>

      <td>
        ${
          row.autorizada
            ? `<span class="seg-chip seg-chip-blue">Autorizada</span>`
            : `<span class="seg-chip seg-chip-muted">—</span>`
        }
      </td>

      <td>
        ${
          row.cerrada
            ? `<span class="seg-chip seg-chip-green-dark">Cerrada</span>`
            : `<span class="seg-chip seg-chip-muted">—</span>`
        }
      </td>

      <td class="seg-date">
        ${ultimaGestion.main}
        <small>${ultimaGestion.sub}</small>
      </td>

      <td class="seg-date">
        ${ultimaReunion.main}
        <small>${ultimaReunion.sub}</small>
      </td>

      <td>
        <div class="seg-docs">
          ${docs}
        </div>
      </td>
    </tr>
  `;
}

function renderAvatar(row) {
  if (row.imagen) {
    return `<img src="${escapeAttr(row.imagen)}" alt="${escapeAttr(row.displayTitle)}" onerror="this.parentNode.innerHTML='${escapeJs(getInitials(row.displayTitle))}'">`;
  }

  return escapeHtml(getInitials(row.displayTitle));
}

function renderProgress(estado) {
  const meta = STAGE_META[estado] || STAGE_META.a_contactar;
  const blocks = [];

  for (let i = 1; i <= 5; i++) {
    const fill = i <= meta.steps ? meta.className : "";
    blocks.push(`<span class="seg-step ${fill}"></span>`);
  }

  return `
    <div class="seg-progress-wrap">
      <div class="seg-progress-bar">${blocks.join("")}</div>
      <div class="seg-progress-label">${escapeHtml(meta.label)}</div>
    </div>
  `;
}

function renderDocs(row) {
  return DOCS_META.map((item) => {
    const rawState = row[item.key];
    const css = docStateToClass(rawState);

    return `
      <span
        class="seg-doc-icon ${css}"
        title="${escapeAttr(item.label)} · ${escapeAttr(docStateLabel(rawState))}"
        aria-label="${escapeAttr(item.label)}"
      >${item.icon}</span>
    `;
  }).join("");
}

function renderSummary(rows) {
  const totals = {
    total: rows.length,
    a_contactar: 0,
    contactado: 0,
    cotizando: 0,
    reunion_confirmada: 0,
    ganada: 0,
    perdida: 0
  };

  for (const row of rows) {
    if (row.estado === "a_contactar") totals.a_contactar++;
    else if (row.estado === "contactado") totals.contactado++;
    else if (row.estado === "cotizando" || row.estado === "recotizando") totals.cotizando++;
    else if (row.estado === "reunion_confirmada") totals.reunion_confirmada++;
    else if (row.estado === "ganada") totals.ganada++;
    else if (row.estado === "perdida") totals.perdida++;
  }

  setText("sumTotal", totals.total);
  setText("sumAContactar", totals.a_contactar);
  setText("sumContactado", totals.contactado);
  setText("sumCotizando", totals.cotizando);
  setText("sumReunion", totals.reunion_confirmada);
  setText("sumGanadas", totals.ganada);
  setText("sumPerdidas", totals.perdida);
}

function renderEmpty(message) {
  const tbody = $("tbodySeguimiento");
  if (!tbody) return;

  tbody.innerHTML = `
    <tr>
      <td colspan="8" class="seg-empty">${escapeHtml(message)}</td>
    </tr>
  `;
}

/* =========================================================
   FILTROS: OPTIONS
========================================================= */
function fillYearFilter(rows) {
  const select = $("filtroAno");
  if (!select) return;

  const previousValue = select.value || "todos";
  const years = [...new Set(
    rows
      .map(r => Number(r.anoViaje || 0))
      .filter(Boolean)
  )].sort((a, b) => a - b);

  select.innerHTML = `
    <option value="todos">Todos</option>
    ${years.map(year => `<option value="${year}">${year}</option>`).join("")}
  `;

  if ([...select.options].some(opt => opt.value === previousValue)) {
    select.value = previousValue;
  } else {
    select.value = "todos";
  }
}

function fillVendorFilter(rows) {
  const select = $("filtroVendedora");
  if (!select) return;

  if (!state.canSeeAll) {
    select.innerHTML = `<option value="todos">Solo mis grupos</option>`;
    select.disabled = true;
    return;
  }

  const previousValue = select.value || "todos";
  const vendors = [...new Map(
    rows
      .filter(r => r.vendedora || r.vendedoraCorreo)
      .map(r => {
        const key = r.vendedoraCorreo || normalizeSearchText(r.vendedora);
        const label = r.vendedora || r.vendedoraCorreo;
        return [key, { value: key, label }];
      })
  ).values()].sort((a, b) =>
    a.label.localeCompare(b.label, "es", { sensitivity: "base" })
  );

  select.disabled = false;
  select.innerHTML = `
    <option value="todos">Todos</option>
    ${vendors.map(v => `<option value="${escapeAttr(v.value)}">${escapeHtml(v.label)}</option>`).join("")}
  `;

  if ([...select.options].some(opt => opt.value === previousValue)) {
    select.value = previousValue;
  } else {
    select.value = "todos";
  }
}

/* =========================================================
   HELPERS DE NEGOCIO
========================================================= */
function normalizeEstado(value) {
  const v = normalizeSearchText(value);

  if (!v) return "a_contactar";
  if (v.includes("cerrad")) return "ganada";
  if (v.includes("ganad")) return "ganada";
  if (v.includes("perdid")) return "perdida";
  if (v.includes("reunion confirm") || v.includes("reunión confirm")) return "reunion_confirmada";
  if (v.includes("reunion") && v.includes("confirm")) return "reunion_confirmada";
  if (v.includes("recotiz")) return "recotizando";
  if (v.includes("cotiz")) return "cotizando";
  if (v.includes("contactad")) return "contactado";
  if (v.includes("a contactar")) return "a_contactar";
  if (v.includes("contactar")) return "a_contactar";

  return "a_contactar";
}

function resolveAutorizada(data) {
  const raw = data.autorizada ?? data.autorizacion ?? data.estadoAutorizacion ?? null;

  if (typeof raw === "boolean") return raw;
  if (Array.isArray(raw)) return raw.some(v => normalizeSearchText(v).includes("autoriz"));
  if (typeof raw === "string") {
    const v = normalizeSearchText(raw);
    return v.includes("autoriz") || v === "si" || v === "sí" || v === "true";
  }

  return false;
}

function resolveCerrada(data) {
  const raw = data.cerrada ?? data.cierre ?? data.estadoCierre ?? null;

  if (typeof raw === "boolean") return raw;
  if (Array.isArray(raw)) return raw.some(v => normalizeSearchText(v).includes("cerrad"));
  if (typeof raw === "string") {
    const v = normalizeSearchText(raw);
    return v.includes("cerrad") || v === "si" || v === "sí" || v === "true";
  }

  return false;
}

function normalizeDocState(value) {
  const v = normalizeSearchText(value);

  if (!v) return "pendiente";
  if (v.includes("no aplica") || v.includes("na") || v.includes("n/a")) return "no_aplica";
  if (v.includes("ok") || v.includes("completo") || v.includes("cumpl") || v.includes("entreg")) return "ok";
  if (v.includes("pend")) return "pendiente";

  return "pendiente";
}

function docStateToClass(value) {
  if (value === "ok") return "doc-ok";
  if (value === "pendiente") return "doc-pendiente";
  if (value === "no_aplica") return "doc-no-aplica";
  return "doc-desconocido";
}

function docStateLabel(value) {
  if (value === "ok") return "Cumplido";
  if (value === "pendiente") return "Pendiente";
  if (value === "no_aplica") return "No aplica";
  return "Sin definir";
}

/* =========================================================
   HELPERS GENERALES
========================================================= */
function cleanText(value) {
  return String(value ?? "").trim();
}

function normalizeSearchText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function toDate(value) {
  if (!value) return null;

  if (value instanceof Date && !isNaN(value)) {
    return value;
  }

  if (typeof value?.toDate === "function") {
    const d = value.toDate();
    return isNaN(d) ? null : d;
  }

  if (typeof value === "number") {
    const d = new Date(value);
    return isNaN(d) ? null : d;
  }

  if (typeof value === "string") {
    const tryDate = new Date(value);
    if (!isNaN(tryDate)) return tryDate;

    const m = value.match(/^(\d{2})[-/](\d{2})[-/](\d{2,4})(?:\s+(\d{2}):(\d{2}))?$/);
    if (m) {
      const dd = Number(m[1]);
      const mm = Number(m[2]) - 1;
      let yy = Number(m[3]);
      if (yy < 100) yy += 2000;
      const hh = Number(m[4] || 0);
      const mi = Number(m[5] || 0);
      const d = new Date(yy, mm, dd, hh, mi);
      return isNaN(d) ? null : d;
    }
  }

  return null;
}

function formatDateTime(date) {
  if (!date) {
    return {
      main: "—",
      sub: "Sin registro"
    };
  }

  return {
    main: date.toLocaleDateString("es-CL"),
    sub: date.toLocaleTimeString("es-CL", {
      hour: "2-digit",
      minute: "2-digit"
    })
  };
}

function getInitials(text) {
  const parts = String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!parts.length) return "G";

  return parts.slice(0, 2).map(p => p[0]?.toUpperCase() || "").join("");
}

function setText(id, value) {
  const el = $(id);
  if (el) el.textContent = String(value ?? "");
}

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttr(str) {
  return escapeHtml(str);
}

function escapeJs(str) {
  return String(str ?? "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function debounce(fn, wait = 150) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}
