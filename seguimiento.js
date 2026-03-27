import {
  auth,
  db,
  getVentasUser,
  puedeVerGeneral,
  normalizeEmail
} from "./firebase-init.js";

import {
  collection,
  getDocs
} from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.7.3/firebase-auth.js";

/* =========================================================
   CONFIG
========================================================= */
const $ = (id) => document.getElementById(id);
const CURRENT_YEAR = new Date().getFullYear();

const state = {
  allRows: [],
  filteredRows: [],
  authEmail: "",
  effectiveEmail: "",
  currentUser: null,
  canSeeAll: false
};

const STAGE_META = {
  a_contactar:        { label: "A contactar",        steps: 1, fillClass: "seg-fill-red" },
  contactado:         { label: "Contactado",         steps: 2, fillClass: "seg-fill-orange" },
  cotizando:          { label: "Cotizando",          steps: 3, fillClass: "seg-fill-yellow" },
  recotizando:        { label: "Recotizando",        steps: 3, fillClass: "seg-fill-yellow" },
  reunion_confirmada: { label: "Reunión confirmada", steps: 4, fillClass: "seg-fill-mix" },
  ganada:             { label: "Ganada",             steps: 5, fillClass: "seg-fill-green" },
  perdida:            { label: "Perdida",            steps: 5, fillClass: "seg-fill-red" }
};

const DOCS_META = [
  { key: "fichaMedicaEstado", label: "Fichas médicas",       icon: "🩺" },
  { key: "nominaEstado",      label: "Nómina de viaje",      icon: "📋" },
  { key: "fichaEstado",       label: "Ficha del grupo",      icon: "🧾" },
  { key: "contratoEstado",    label: "Contrato",             icon: "✍️" },
  { key: "cortesiaEstado",    label: "Estadías de cortesía", icon: "🎁" }
];

/* =========================================================
   INIT
========================================================= */
bindEvents();

onAuthStateChanged(auth, async (user) => {
  if (!user) return;

  state.authEmail = normalizeEmail(user.email || "");
  state.effectiveEmail = resolveEffectiveEmail(state.authEmail);
  state.currentUser = getVentasUser(state.effectiveEmail) || getVentasUser(state.authEmail) || null;
  state.canSeeAll = puedeVerGeneral(state.effectiveEmail) || puedeVerGeneral(state.authEmail);

  await loadSeguimiento();
});

/* =========================================================
   EVENTOS
========================================================= */
function bindEvents() {
  $("filtroAno")?.addEventListener("change", applyFiltersAndRender);
  $("filtroEstado")?.addEventListener("change", applyFiltersAndRender);
  $("filtroVendedora")?.addEventListener("change", applyFiltersAndRender);
  $("toggleAnteriores")?.addEventListener("change", () => {
    fillYearFilter(state.allRows);
    applyFiltersAndRender();
  });

  $("buscadorSeguimiento")?.addEventListener("input", debounce(() => {
    applyFiltersAndRender();
  }, 180));

  $("btnRecargarSeguimiento")?.addEventListener("click", async () => {
    await loadSeguimiento();
  });
}

/* =========================================================
   CARGA PRINCIPAL
========================================================= */
async function loadSeguimiento() {
  renderEmpty("Cargando grupos...");

  try {
    const snap = await getDocs(collection(db, "ventas_cotizaciones"));
    const rows = [];

    snap.forEach((docSnap) => {
      rows.push(mapClienteDoc(docSnap.id, docSnap.data() || {}));
    });

    state.allRows = rows;

    fillYearFilter(rows);
    fillVendorFilter(rows);
    applyFiltersAndRender();
  } catch (err) {
    console.error("[seguimiento] error cargando clientes:", err);
    renderEmpty("No se pudieron cargar los grupos.");
  }
}

/* =========================================================
   MAPEO DE DATOS
========================================================= */
function mapClienteDoc(id, data) {
  const aliasGrupo = cleanText(data.aliasGrupo);
  const nombreApoderado = cleanText(
    data.nombreCliente ||
    data.nombreApoderado ||
    data.apoderado ||
    ""
  );

  const nombreGrupo = cleanText(
    data.nombreGrupo ||
    data.colegio ||
    ""
  );

  const colegio = cleanText(data.colegio);
  const curso = cleanText(data.curso);
  const anoViaje = Number(data.anoViaje || 0) || 0;

  const destino = cleanText(
    data.destinoPrincipal ||
    data.destino ||
    "Sin destino"
  );

  const estado = normalizeEstado(
    data.estado ||
    data.estadoGrupo ||
    data.estadoComercial ||
    data.etapaComercial
  );

  const autorizada = resolveAutorizada(data);
  const cerrada = resolveCerrada(data);

  const imagen = cleanText(
    data.imagen ||
    data.imagenUrl ||
    ""
  );

  const ultimaGestionAt = toDate(
    data.ultimaGestionAt ||
    data.fechaActualizacion ||
    data.actualizadoEl ||
    data.updatedAt ||
    data.fechaCreacion ||
    null
  );

  const fechaUltimaReunion = toDate(
    data.fechaUltimaReunion ||
    data.ultimaReunion ||
    data.fechaReunion ||
    null
  );

  const vendedora = cleanText(data.vendedora || "");
  const vendedoraCorreo = normalizeEmail(data.vendedoraCorreo || "");

  const fichaMedicaEstado = normalizeDocState(data.fichaMedicaEstado);
  const nominaEstado = normalizeDocState(data.nominaEstado);
  const fichaEstado = normalizeDocState(data.fichaEstado);
  const contratoEstado = normalizeDocState(data.contratoEstado);
  const cortesiaEstado = normalizeDocState(data.cortesiaEstado);

  const displayTitle = aliasGrupo || nombreApoderado || nombreGrupo || `Grupo ${id}`;
  
  let subtitleParts = [];
  
  if (aliasGrupo) {
    // Si tiene alias: abajo solo año
    subtitleParts = [
      anoViaje ? `Año ${anoViaje}` : ""
    ].filter(Boolean);
  } else {
    // Si no tiene alias: título = nombre apoderada
    // abajo colegio + año
    subtitleParts = [
      colegio || nombreGrupo || "",
      anoViaje ? `Año ${anoViaje}` : ""
    ].filter(Boolean);
  }

  return {
    id,
    aliasGrupo,
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
    ultimaGestionAt,
    fechaUltimaReunion,
    vendedora,
    vendedoraCorreo,
    fichaMedicaEstado,
    nominaEstado,
    fichaEstado,
    contratoEstado,
    cortesiaEstado,
    displayTitle,
    subtitleParts,
    hasAlias: !!aliasGrupo,
    avatarBaseText: colegio || nombreGrupo || nombreApoderado || displayTitle,
    searchIndex: normalizeText([
      id,
      aliasGrupo,
      nombreApoderado,
      nombreGrupo,
      colegio,
      curso,
      destino,
      vendedora,
      vendedoraCorreo,
      anoViaje
    ].join(" "))
  };
}
/* =========================================================
   FILTROS
========================================================= */
function applyFiltersAndRender() {
  const filtroAno = $("filtroAno")?.value || "todos";
  const filtroEstado = $("filtroEstado")?.value || "todos";
  const filtroVendedora = $("filtroVendedora")?.value || "todos";
  const verAnteriores = !!$("toggleAnteriores")?.checked;
  const search = normalizeText($("buscadorSeguimiento")?.value || "");

  const currentVendorFullName = normalizeText([
    state.currentUser?.nombre,
    state.currentUser?.apellido
  ].filter(Boolean).join(" "));

  const currentVendorAliases = Array.isArray(state.currentUser?.aliascartera)
    ? state.currentUser.aliascartera.map(normalizeText)
    : [];

  let rows = [...state.allRows];

  rows = rows.filter((row) => {
    if (state.canSeeAll) return true;

    const rowVendorEmail = normalizeEmail(row.vendedoraCorreo);
    const rowVendorName = normalizeText(row.vendedora);

    if (rowVendorEmail && rowVendorEmail === state.effectiveEmail) return true;
    if (rowVendorEmail && rowVendorEmail === state.authEmail) return true;

    if (currentVendorFullName && rowVendorName.includes(currentVendorFullName)) return true;

    if (currentVendorAliases.length) {
      return currentVendorAliases.some(alias => rowVendorName.includes(alias));
    }

    return false;
  });

  rows = rows.filter((row) => {
    if (filtroAno !== "todos") {
      return String(row.anoViaje || "") === String(filtroAno);
    }

    if (verAnteriores) return true;
    return !row.anoViaje || row.anoViaje >= CURRENT_YEAR;
  });

  rows = rows.filter((row) => {
    if (filtroEstado === "todos") return true;
    return row.estado === filtroEstado;
  });

  rows = rows.filter((row) => {
    if (!state.canSeeAll) return true;
    if (filtroVendedora === "todos") return true;

    const vendorFilter = normalizeText(filtroVendedora);

    return (
      normalizeEmail(row.vendedoraCorreo) === normalizeEmail(filtroVendedora) ||
      normalizeText(row.vendedora) === vendorFilter
    );
  });

  rows = rows.filter((row) => {
    if (!search) return true;
    return row.searchIndex.includes(search);
  });

  rows.sort((a, b) => {
    const ay = Number(a.anoViaje || 0);
    const by = Number(b.anoViaje || 0);
    if (ay !== by) return ay - by;

    const ad = a.ultimaGestionAt ? a.ultimaGestionAt.getTime() : 0;
    const bd = b.ultimaGestionAt ? b.ultimaGestionAt.getTime() : 0;
    if (ad !== bd) return bd - ad;

    return a.displayTitle.localeCompare(b.displayTitle, "es", { sensitivity: "base" });
  });

  state.filteredRows = rows;
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
  const progressHtml = renderProgress(row.estado);
  const docsHtml = renderDocs(row);
  const avatarHtml = renderAvatar(row);

  const ultimaGestion = formatDateTime(row.ultimaGestionAt, "Sin registro");
  const ultimaReunion = formatDateTime(row.fechaUltimaReunion, "Sin reunión");

  return `
    <tr>
      <td>
        <div class="seg-group">
          <div class="seg-avatar">${avatarHtml}</div>

          <div class="seg-group-info">
            <div class="seg-group-title">${escapeHtml(row.displayTitle)}</div>

            <div class="seg-group-sub">
              ${row.subtitleParts.map(part => `<span>${escapeHtml(part)}</span>`).join("")}
              ${row.hasAlias && row.vendedora ? `<span class="seg-chip-vendor">${escapeHtml(row.vendedora)}</span>` : ""}
            </div>
          </div>
        </div>
      </td>

      <td class="seg-destino">${escapeHtml(row.destino || "Sin destino")}</td>

      <td>${progressHtml}</td>

      <td>
        ${
          row.autorizada
            ? `<span class="seg-badge seg-badge-blue">Autorizada</span>`
            : `<span class="seg-badge seg-badge-muted">—</span>`
        }
      </td>

      <td>
        ${
          row.cerrada
            ? `<span class="seg-badge seg-badge-green-dark">Cerrada</span>`
            : `<span class="seg-badge seg-badge-muted">—</span>`
        }
      </td>

      <td class="seg-date">
        ${escapeHtml(ultimaGestion.main)}
        <small>${escapeHtml(ultimaGestion.sub)}</small>
      </td>

      <td class="seg-date">
        ${escapeHtml(ultimaReunion.main)}
        <small>${escapeHtml(ultimaReunion.sub)}</small>
      </td>

      <td>
        <div class="seg-docs">
          ${docsHtml}
        </div>
      </td>
    </tr>
  `;
}

function renderProgress(estado) {
  const meta = STAGE_META[estado] || STAGE_META.a_contactar;
  const blocks = [];

  for (let i = 1; i <= 5; i++) {
    const fillClass = i <= meta.steps ? meta.fillClass : "";
    blocks.push(`<span class="seg-step ${fillClass}"></span>`);
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
    const value = row[item.key];
    const css = getDocCss(value);
    const label = getDocLabel(value);

    return `
      <span
        class="seg-doc ${css}"
        title="${escapeAttr(item.label)} · ${escapeAttr(label)}"
        aria-label="${escapeAttr(item.label)}"
      >${item.icon}</span>
    `;
  }).join("");
}

function renderAvatar(row) {
  if (row.imagen) {
    return `
      <img
        src="${escapeAttr(row.imagen)}"
        alt="${escapeAttr(row.displayTitle)}"
        onerror="this.parentNode.textContent='${escapeJs(getInitials(row.avatarBaseText || row.displayTitle))}'"
      />
    `;
  }

  return escapeHtml(getInitials(row.avatarBaseText || row.displayTitle));
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
   OPCIONES DE FILTROS
========================================================= */
function fillYearFilter(rows) {
  const select = $("filtroAno");
  if (!select) return;

  const previous = select.value || "todos";
  const showOld = !!$("toggleAnteriores")?.checked;

  let years = [...new Set(
    rows
      .map(r => Number(r.anoViaje || 0))
      .filter(Boolean)
  )].sort((a, b) => a - b);

  // Si NO está activado "Ver años anteriores",
  // ocultamos del selector los años menores al actual.
  if (!showOld) {
    years = years.filter(year => year >= CURRENT_YEAR);
  }

  select.innerHTML = `
    <option value="todos">Todos</option>
    ${years.map(year => `<option value="${year}">${year}</option>`).join("")}
  `;

  // Si el año previamente seleccionado ya no existe en el select
  // (por ejemplo 2025 al desactivar "Ver años anteriores"),
  // volvemos a "todos".
  if ([...select.options].some(opt => opt.value === previous)) {
    select.value = previous;
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

  const previous = select.value || "todos";

  const vendorMap = new Map();

  for (const row of rows) {
    if (!row.vendedora && !row.vendedoraCorreo) continue;

    const value = row.vendedoraCorreo || row.vendedora;
    const label = row.vendedora || row.vendedoraCorreo;

    if (!vendorMap.has(value)) {
      vendorMap.set(value, { value, label });
    }
  }

  const vendors = [...vendorMap.values()].sort((a, b) =>
    a.label.localeCompare(b.label, "es", { sensitivity: "base" })
  );

  select.disabled = false;
  select.innerHTML = `
    <option value="todos">Todos</option>
    ${vendors.map(v => `<option value="${escapeAttr(v.value)}">${escapeHtml(v.label)}</option>`).join("")}
  `;

  if ([...select.options].some(opt => opt.value === previous)) {
    select.value = previous;
  } else {
    select.value = "todos";
  }
}

/* =========================================================
   REGLAS DE NEGOCIO
========================================================= */
function normalizeEstado(value) {
  const v = normalizeText(value);

  if (!v) return "a_contactar";
  if (v.includes("perdid")) return "perdida";
  if (v.includes("reunion confirm") || v.includes("reunión confirm")) return "reunion_confirmada";
  if (v.includes("reunion") && v.includes("confirm")) return "reunion_confirmada";
  if (v.includes("recotiz")) return "recotizando";
  if (v.includes("cotiz")) return "cotizando";
  if (v.includes("contactad")) return "contactado";
  if (v.includes("ganad")) return "ganada";
  if (v.includes("cerrad")) return "ganada";
  if (v.includes("a contactar")) return "a_contactar";
  if (v.includes("contactar")) return "a_contactar";

  return "a_contactar";
}

function resolveAutorizada(data) {
  const raw = data.autorizada ?? data.autorizacion ?? data.estadoAutorizacion ?? null;

  if (typeof raw === "boolean") return raw;
  if (Array.isArray(raw)) return raw.some(v => normalizeText(v).includes("autoriz"));
  if (typeof raw === "string") {
    const v = normalizeText(raw);
    return v.includes("autoriz") || v === "si" || v === "sí" || v === "true";
  }

  return false;
}

function resolveCerrada(data) {
  const raw = data.cerrada ?? data.cierre ?? data.estadoCierre ?? null;

  if (typeof raw === "boolean") return raw;
  if (Array.isArray(raw)) return raw.some(v => normalizeText(v).includes("cerrad"));
  if (typeof raw === "string") {
    const v = normalizeText(raw);
    return v.includes("cerrad") || v === "si" || v === "sí" || v === "true";
  }

  return false;
}

function normalizeDocState(value) {
  if (typeof value === "boolean") {
    return value ? "ok" : "pendiente";
  }

  const v = normalizeText(value);

  if (!v) return "pendiente";
  if (v.includes("no aplica") || v === "na" || v === "n/a") return "no_aplica";
  if (v.includes("ok") || v.includes("completo") || v.includes("cumpl") || v.includes("entreg")) return "ok";
  if (v.includes("pend")) return "pendiente";

  return "pendiente";
}

function getDocCss(value) {
  if (value === "ok") return "seg-doc-ok";
  if (value === "pendiente") return "seg-doc-pendiente";
  if (value === "no_aplica") return "seg-doc-no-aplica";
  return "seg-doc-default";
}

function getDocLabel(value) {
  if (value === "ok") return "Cumplido";
  if (value === "pendiente") return "Pendiente";
  if (value === "no_aplica") return "No aplica";
  return "Sin definir";
}

/* =========================================================
   HELPERS
========================================================= */
function resolveEffectiveEmail(fallbackEmail = "") {
  try {
    const candidateObjects = [];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i) || "";
      const lowerKey = key.toLowerCase();

      if (!/(acting|scope|ventas|imperson|switch|user)/i.test(lowerKey)) continue;

      const raw = localStorage.getItem(key);
      if (!raw || raw.length > 1000) continue;

      try {
        const parsed = JSON.parse(raw);
        candidateObjects.push(parsed);
      } catch {
        // ignorar
      }
    }

    for (const parsed of candidateObjects) {
      const email =
        parsed?.email ||
        parsed?.correo ||
        parsed?.userEmail ||
        parsed?.vendedoraCorreo ||
        parsed?.targetEmail ||
        "";

      const safeEmail = normalizeEmail(email);
      if (safeEmail) return safeEmail;
    }
  } catch (err) {
    console.warn("[seguimiento] no se pudo leer acting user:", err);
  }

  return normalizeEmail(fallbackEmail);
}

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function toDate(value) {
  if (!value) return null;

  if (value instanceof Date && !isNaN(value)) return value;

  if (typeof value?.toDate === "function") {
    const d = value.toDate();
    return isNaN(d) ? null : d;
  }

  if (typeof value === "number") {
    const d = new Date(value);
    return isNaN(d) ? null : d;
  }

  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!isNaN(parsed)) return parsed;

    const match = value.match(/^(\d{2})[-/](\d{2})[-/](\d{2,4})(?:\s+(\d{2}):(\d{2}))?$/);
    if (match) {
      const dd = Number(match[1]);
      const mm = Number(match[2]) - 1;
      let yy = Number(match[3]);
      if (yy < 100) yy += 2000;
      const hh = Number(match[4] || 0);
      const mi = Number(match[5] || 0);
      const d = new Date(yy, mm, dd, hh, mi);
      return isNaN(d) ? null : d;
    }
  }

  return null;
}

function formatDateTime(date, emptySub = "Sin registro") {
  if (!date) {
    return {
      main: "—",
      sub: emptySub
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
  return String(str ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'");
}

function debounce(fn, wait = 150) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}
