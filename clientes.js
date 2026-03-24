import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.7.3/firebase-auth.js";
import {
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  deleteDoc,
  writeBatch,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";

import { auth, db, VENTAS_USERS } from "./firebase-init.js";

import {
  $,
  normalizeEmail,
  normalizeText,
  normalizeSearch,
  escapeHtml,
  getNombreUsuario,
  formatNowForFile
} from "./utils.js";

import {
  ACTING_USER_KEY,
  getRealUser,
  getEffectiveUser,
  isActingAsAnother,
  canManageVentasRole,
  isAdminRole
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
const DETALLE_GRUPO_URL = "grupo.html"; // cambia esto cuando exista la ficha real
const WRITE_BATCH_LIMIT = 400;

const BASE_COLUMNS = [
  "idGrupo",
  "codigoRegistro",
  "estado",
  "colegio",
  "curso",
  "cantidadGrupo",
  "anoViaje",
  "vendedora",
  "vendedoraCorreo",
  "nombreCliente",
  "rolCliente",
  "correoCliente",
  "celularCliente",
  "origenColegio",
  "origenCliente",
  "origenEspecificacion",
  "origenEspecificacionOtro",
  "destinoPrincipal",
  "destinoPrincipalOtro",
  "destinosSecundarios",
  "destinoSecundarioOtro",
  "comunaCiudad",
  "requiereAsignacion",
  "creadoPor",
  "creadoPorCorreo",
  "fechaCreacion",
  "actualizadoPor",
  "actualizadoPorCorreo",
  "fechaActualizacion"
];

const READONLY_EDIT_KEYS = new Set([
  "idGrupo",
  "codigoRegistro",
  "creadoPor",
  "creadoPorCorreo",
  "fechaCreacion",
  "actualizadoPor",
  "actualizadoPorCorreo",
  "fechaActualizacion"
]);

const IMPORT_IGNORE_KEYS = new Set([
  "creadoPor",
  "creadoPorCorreo",
  "fechaCreacion",
  "actualizadoPor",
  "actualizadoPorCorreo",
  "fechaActualizacion"
]);

const ARRAY_KEYS = new Set([
  "destinosSecundarios"
]);

const BOOLEAN_KEYS = new Set([
  "requiereAsignacion"
]);

const LABELS = {
  idGrupo: "ID GRUPO",
  codigoRegistro: "CÓDIGO",
  estado: "ESTADO",
  colegio: "COLEGIO",
  curso: "CURSO",
  cantidadGrupo: "CANTIDAD GRUPO",
  anoViaje: "AÑO VIAJE",
  vendedora: "VENDEDORA",
  vendedoraCorreo: "CORREO VENDEDORA",
  nombreCliente: "NOMBRE CLIENTE",
  rolCliente: "ROL CLIENTE",
  correoCliente: "CORREO CLIENTE",
  celularCliente: "CELULAR CLIENTE",
  origenColegio: "ORIGEN COLEGIO",
  origenCliente: "ORIGEN CLIENTE",
  origenEspecificacion: "ESPECIFICACIÓN ORIGEN",
  origenEspecificacionOtro: "DETALLE ORIGEN",
  destinoPrincipal: "DESTINO PRINCIPAL",
  destinoPrincipalOtro: "OTRO DESTINO PRINCIPAL",
  destinosSecundarios: "DESTINOS SECUNDARIOS",
  destinoSecundarioOtro: "OTRO DESTINO SECUNDARIO",
  comunaCiudad: "COMUNA / CIUDAD",
  requiereAsignacion: "REQUIERE ASIGNACIÓN",
  creadoPor: "CREADO POR",
  creadoPorCorreo: "CORREO CREADOR",
  fechaCreacion: "FECHA CREACIÓN",
  actualizadoPor: "ACTUALIZADO POR",
  actualizadoPorCorreo: "CORREO ACTUALIZACIÓN",
  fechaActualizacion: "FECHA ACTUALIZACIÓN"
};

/* =========================================================
   ESTADO
========================================================= */
const state = {
  realUser: null,
  effectiveUser: null,
  rowsRaw: [],
  rowsFlat: [],
  filteredRows: [],
  selectedKeys: new Set(),
  allKeys: [],
  dynamicKeys: [],
  editingId: null,
  search: "",
  showArchivedOnly: false,
  filters: {
    estado: "",
    vendedora: "",
    anoViaje: "",
    destinoPrincipal: ""
  }
};

/* =========================================================
   HELPERS GENERALES
========================================================= */
function assertAccess() {
  if (!canManageVentasRole(state.effectiveUser)) {
    location.href = "index.html";
    return false;
  }
  return true;
}

function isAdminOnly() {
  return isAdminRole(state.effectiveUser);
}

function buildScopeText() {
  let text = "Clientes · Macro general de cotizaciones";

  if (state.effectiveUser) {
    text += ` · ${state.effectiveUser.rol}`;
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
    scopeText: buildScopeText()
  });

  renderActingUserSwitcher({
    realUser: state.realUser,
    effectiveUser: state.effectiveUser,
    users: VENTAS_USERS
  });

  const scope = $("clientesScope");
  if (scope) {
    scope.textContent = "Macro general de cotizaciones y grupos comerciales.";
  }
}

function prettifyFieldKey(key = "") {
  if (LABELS[key]) return LABELS[key];

  return String(key || "")
    .replaceAll(".", " / ")
    .replaceAll("_", " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim()
    .replace(/\b\w/g, (l) => l.toUpperCase());
}

function isTimestampLike(value) {
  return (
    value &&
    typeof value === "object" &&
    (
      typeof value.toDate === "function" ||
      (typeof value.seconds === "number" && typeof value.nanoseconds === "number")
    )
  );
}

function timestampToDate(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  if (typeof value.seconds === "number") {
    return new Date(value.seconds * 1000);
  }
  return null;
}

function formatDateTime(value) {
  const date = value instanceof Date ? value : timestampToDate(value);
  if (!date || Number.isNaN(date.getTime())) return "";

  const f = date.toLocaleDateString("es-CL");
  const h = date.toLocaleTimeString("es-CL", {
    hour: "2-digit",
    minute: "2-digit"
  });

  return `${f} ${h}`;
}

function getAnoViajeNumber(row) {
  const raw = normalizeText(row.anoViaje || "");
  if (!raw) return null;

  const match = raw.match(/\d{4}/);
  if (!match) return null;

  const year = Number(match[0]);
  return Number.isFinite(year) ? year : null;
}

function isArchivedRow(row) {
  const year = getAnoViajeNumber(row);
  if (!year) return false;
  return year < new Date().getFullYear();
}

function updateArchiveButton() {
  const btn = $("btnVerAnteriores");
  if (!btn) return;

  btn.textContent = state.showArchivedOnly ? "Ver Actuales" : "Ver Anteriores";
}

function flattenObject(obj, prefix = "", out = {}) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    return out;
  }

  Object.entries(obj).forEach(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;

    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      !isTimestampLike(value)
    ) {
      flattenObject(value, path, out);
      return;
    }

    out[path] = valueToString(value);
  });

  return out;
}

function setNestedValue(target, path, value) {
  const parts = path.split(".");
  let ref = target;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!ref[part] || typeof ref[part] !== "object" || Array.isArray(ref[part])) {
      ref[part] = {};
    }
    ref = ref[part];
  }

  ref[parts[parts.length - 1]] = value;
}

function parseImportedValue(key, rawValue) {
  const value = normalizeText(rawValue);

  if (value === "") return "";

  if (ARRAY_KEYS.has(key)) {
    return value.split("|").map(v => normalizeText(v)).filter(Boolean);
  }

  if (BOOLEAN_KEYS.has(key)) {
    const val = normalizeSearch(value);
    if (["si", "sí", "true", "1", "yes"].includes(val)) return true;
    if (["no", "false", "0"].includes(val)) return false;
  }

  if (key === "anoViaje" || key === "cantidadGrupo") {
    const maybe = Number(value);
    return Number.isFinite(maybe) ? maybe : value;
  }

  // ISO string => Date (Firestore lo guarda como fecha consistente)
  if (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/i.test(value) ||
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+\-]\d{2}:\d{2})$/i.test(value)
  ) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return value;
}

function sanitizeImportKey(rawKey = "") {
  const original = normalizeText(rawKey);
  if (!original) return "";

  const aliasMap = {
    "id grupo": "idGrupo",
    "codigo": "codigoRegistro",
    "codigo registro": "codigoRegistro",
    "código": "codigoRegistro",
    "código registro": "codigoRegistro",
    "cantidad grupo": "cantidadGrupo",
    "cantidadgrupo": "cantidadGrupo",
    "año viaje": "anoViaje",
    "anio viaje": "anoViaje",
    "vendedora": "vendedora",
    "correo vendedora": "vendedoraCorreo",
    "correo vendedor": "vendedoraCorreo",
    "nombre cliente": "nombreCliente",
    "rol cliente": "rolCliente",
    "correo cliente": "correoCliente",
    "celular cliente": "celularCliente",
    "comuna / ciudad": "comunaCiudad",
    "comuna ciudad": "comunaCiudad",
    "destino principal": "destinoPrincipal",
    "destinos secundarios": "destinosSecundarios",
    "origen colegio": "origenColegio",
    "origen cliente": "origenCliente",
    "especificacion origen": "origenEspecificacion",
    "especificación origen": "origenEspecificacion",
    "detalle origen": "origenEspecificacionOtro",
    "otro destino principal": "destinoPrincipalOtro",
    "otro destino secundario": "destinoSecundarioOtro",
    "requiere asignacion": "requiereAsignacion",
    "requiere asignación": "requiereAsignacion",
    "fecha creacion": "fechaCreacion",
    "fecha creación": "fechaCreacion",
    "fecha actualizacion": "fechaActualizacion",
    "fecha actualización": "fechaActualizacion",
    "creado por": "creadoPor",
    "actualizado por": "actualizadoPor"
  };

  const normalized = normalizeSearch(original).replace(/\s+/g, " ");
  if (aliasMap[normalized]) return aliasMap[normalized];

  // conservar puntos para campos anidados
  const pieces = original.split(".").map(piece => {
    const cleaned = piece
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9 ]+/g, " ")
      .trim();

    if (!cleaned) return "";

    const parts = cleaned.split(/\s+/);
    return parts
      .map((part, idx) => {
        const low = part.toLowerCase();
        if (idx === 0) return low;
        return low.charAt(0).toUpperCase() + low.slice(1);
      })
      .join("");
  }).filter(Boolean);

  return pieces.join(".");
}

function normalizePersonName(value = "") {
  return normalizeSearch(value).replace(/\s+/g, " ").trim();
}

function getUserAliases(user) {
  const aliases = [];

  const nombre = normalizeText(user?.nombre || "");
  const apellido = normalizeText(user?.apellido || "");
  const fullName = normalizeText(`${nombre} ${apellido}`.trim());

  if (nombre) aliases.push(normalizePersonName(nombre));
  if (fullName) aliases.push(normalizePersonName(fullName));

  const aliasCartera = user?.aliasCartera;
  if (Array.isArray(aliasCartera)) {
    aliasCartera.forEach(a => aliases.push(normalizePersonName(a)));
  } else if (typeof aliasCartera === "string") {
    aliases.push(normalizePersonName(aliasCartera));
  }

  return [...new Set(aliases.filter(Boolean))];
}

function resolveVentasUserByEmail(email = "") {
  const target = normalizeEmail(email);
  if (!target) return null;
  return VENTAS_USERS.find(u => normalizeEmail(u.email) === target) || null;
}

function resolveVentasUserByName(name = "") {
  const target = normalizePersonName(name);
  if (!target) return null;

  for (const user of VENTAS_USERS) {
    const aliases = getUserAliases(user);
    if (aliases.includes(target)) return user;
  }

  return null;
}

function getDisplayName(user) {
  if (!user) return "";
  return normalizeText(`${user.nombre || ""} ${user.apellido || ""}`.trim() || user.nombre || "");
}

function autoResolveKnownPeople(payload) {
  // vendedora -> vendedoraCorreo
  if (normalizeText(payload.vendedora) && !normalizeEmail(payload.vendedoraCorreo)) {
    const seller = resolveVentasUserByName(payload.vendedora);
    if (seller) {
      payload.vendedora = getDisplayName(seller) || payload.vendedora;
      payload.vendedoraCorreo = normalizeEmail(seller.email || "");
    }
  }

  // vendedoraCorreo -> vendedora
  if (normalizeEmail(payload.vendedoraCorreo) && !normalizeText(payload.vendedora)) {
    const seller = resolveVentasUserByEmail(payload.vendedoraCorreo);
    if (seller) {
      payload.vendedora = getDisplayName(seller);
    }
  }

  // creadoPorCorreo -> creadoPor
  if (normalizeEmail(payload.creadoPorCorreo) && !normalizeText(payload.creadoPor)) {
    const creator = resolveVentasUserByEmail(payload.creadoPorCorreo);
    if (creator) {
      payload.creadoPor = getDisplayName(creator);
    }
  }

  // creadoPor -> creadoPorCorreo
  if (normalizeText(payload.creadoPor) && !normalizeEmail(payload.creadoPorCorreo)) {
    const creator = resolveVentasUserByName(payload.creadoPor);
    if (creator) {
      payload.creadoPor = getDisplayName(creator) || payload.creadoPor;
      payload.creadoPorCorreo = normalizeEmail(creator.email || "");
    }
  }

  // actualizadoPorCorreo -> actualizadoPor
  if (normalizeEmail(payload.actualizadoPorCorreo) && !normalizeText(payload.actualizadoPor)) {
    const updater = resolveVentasUserByEmail(payload.actualizadoPorCorreo);
    if (updater) {
      payload.actualizadoPor = getDisplayName(updater);
    }
  }

  // actualizadoPor -> actualizadoPorCorreo
  if (normalizeText(payload.actualizadoPor) && !normalizeEmail(payload.actualizadoPorCorreo)) {
    const updater = resolveVentasUserByName(payload.actualizadoPor);
    if (updater) {
      payload.actualizadoPor = getDisplayName(updater) || payload.actualizadoPor;
      payload.actualizadoPorCorreo = normalizeEmail(updater.email || "");
    }
  }

  return payload;
}

function buildRowKey(row) {
  return String(row.idGrupo || "");
}

function getSearchTarget(row) {
  return normalizeSearch(
    state.allKeys.map(k => valueToString(row[k] || "")).join(" ")
  );
}

/* =========================================================
   CARGA DE DATOS
========================================================= */
function computeColumns() {
  const keySet = new Set();

  state.rowsFlat.forEach((row) => {
    Object.keys(row).forEach((k) => keySet.add(k));
  });

  state.allKeys = [
    ...BASE_COLUMNS.filter(k => keySet.has(k)),
    ...[...keySet].filter(k => !BASE_COLUMNS.includes(k)).sort((a, b) => a.localeCompare(b, "es"))
  ];

  state.dynamicKeys = state.allKeys.filter(k => !BASE_COLUMNS.includes(k));
}

async function loadData() {
  try {
    setProgressStatus({
      text: "Cargando clientes...",
      meta: "Leyendo cotizaciones...",
      progress: 15
    });

    const snap = await getDocs(collection(db, "ventas_cotizaciones"));

    state.rowsRaw = snap.docs.map((d) => ({
      id: d.id,
      data: d.data() || {}
    }));

    state.rowsFlat = state.rowsRaw.map(({ id, data }) => {
      const flat = flattenObject(data);
      return {
        idGrupo: data.idGrupo || id,
        ...flat
      };
    });

    state.rowsFlat.sort((a, b) => {
      const fa = normalizeText(a.fechaCreacion);
      const fb = normalizeText(b.fechaCreacion);
      return fb.localeCompare(fa, "es");
    });

    const canAdmin = isAdminOnly();
    
    $("labelImportar")?.classList.toggle("hidden", !canAdmin);
    $("btnPlantilla")?.classList.toggle("hidden", !canAdmin);
    $("btnEliminarSeleccionados")?.classList.toggle("hidden", !canAdmin);
    $("btnVerAnteriores")?.classList.remove("hidden");
    
    if (!canAdmin) {
      state.selectedKeys.clear();
    }

    computeColumns();
    populateFilterOptions();
    applyFilters();

    setProgressStatus({
      text: "Clientes cargados.",
      meta: `${state.rowsFlat.length} registro(s) encontrados`,
      progress: 100,
      type: "success"
    });
    clearProgressStatus();
  } catch (error) {
    console.error(error);
    setProgressStatus({
      text: "Error cargando clientes.",
      meta: error.message || "No se pudo leer Firestore.",
      progress: 100,
      type: "error"
    });
  }
}

/* =========================================================
   FILTROS
========================================================= */
function fillSelectOptions(selectId, options = [], placeholder = "Todos") {
  const select = $(selectId);
  if (!select) return;

  const current = select.value || "";
  select.innerHTML = `<option value="">${placeholder}</option>`;

  options.forEach((value) => {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = value;
    select.appendChild(opt);
  });

  select.value = options.includes(current) ? current : "";
}

function populateFilterOptions() {
  fillSelectOptions(
    "filterEstado",
    [...new Set(state.rowsFlat.map(r => normalizeText(r.estado)).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es")),
    "Todos"
  );

  fillSelectOptions(
    "filterVendedora",
    [...new Set(state.rowsFlat.map(r => normalizeText(r.vendedora)).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es")),
    "Todas"
  );

  fillSelectOptions(
    "filterAnoViaje",
    [...new Set(state.rowsFlat.map(r => normalizeText(r.anoViaje)).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es", { numeric: true })),
    "Todos"
  );

  fillSelectOptions(
    "filterDestino",
    [...new Set(state.rowsFlat.map(r => normalizeText(r.destinoPrincipal)).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es")),
    "Todos"
  );
}

function applyFilters() {
  let rows = [...state.rowsFlat];

  // Vista principal: solo actuales
  // Vista archivo: solo anteriores
  if (state.showArchivedOnly) {
    rows = rows.filter(isArchivedRow);
  } else {
    rows = rows.filter((row) => !isArchivedRow(row));
  }

  if (state.filters.estado) {
    rows = rows.filter(r => normalizeText(r.estado) === state.filters.estado);
  }

  if (state.filters.vendedora) {
    rows = rows.filter(r => normalizeText(r.vendedora) === state.filters.vendedora);
  }

  if (state.filters.anoViaje) {
    rows = rows.filter(r => normalizeText(r.anoViaje) === state.filters.anoViaje);
  }

  if (state.filters.destinoPrincipal) {
    rows = rows.filter(r => normalizeText(r.destinoPrincipal) === state.filters.destinoPrincipal);
  }

  const q = normalizeSearch(state.search);
  if (q) {
    rows = rows.filter(r => getSearchTarget(r).includes(q));
  }

  state.filteredRows = rows;
  updateArchiveButton();
  renderTable();
}

/* =========================================================
   TABLA DINÁMICA
========================================================= */
function getDisplayColumns() {
  return state.allKeys;
}

function renderTable() {
  const thead = $("theadClientes");
  const tbody = $("tbodyClientes");
  const empty = $("emptyState");
  const summary = $("tableSummary");

  if (!thead || !tbody || !empty || !summary) return;

  const columns = getDisplayColumns();
  const canAdmin = isAdminOnly();

  summary.textContent = `${state.filteredRows.length} registro(s) mostrados · ${state.rowsFlat.length} total`;

  thead.innerHTML = `
    <tr>
      ${canAdmin ? `
        <th class="check-col">
          <input id="checkAllRows" type="checkbox" />
        </th>
      ` : ""}
      ${columns.map(key => `<th>${escapeHtml(prettifyFieldKey(key))}</th>`).join("")}
      <th class="actions-col">ACCIONES</th>
    </tr>
  `;

  if (!state.filteredRows.length) {
    tbody.innerHTML = "";
    empty.classList.remove("hidden");
    return;
  }

  empty.classList.add("hidden");

  tbody.innerHTML = state.filteredRows.map((row) => {
    const rowKey = buildRowKey(row);
    const checked = state.selectedKeys.has(rowKey) ? "checked" : "";

    const adminActions = `
      <button class="btn-mini open" data-action="open" data-id="${escapeHtml(row.idGrupo)}">Abrir</button>
      <button class="btn-mini edit" data-action="edit" data-id="${escapeHtml(row.idGrupo)}">Editar</button>
      <button class="btn-mini delete" data-action="delete" data-id="${escapeHtml(row.idGrupo)}">Eliminar</button>
    `;

    const supervisionActions = `
      <button class="btn-mini open" data-action="open" data-id="${escapeHtml(row.idGrupo)}">Abrir</button>
    `;

    return `
      <tr>
        ${canAdmin ? `
          <td class="check-col">
            <input
              class="row-check"
              type="checkbox"
              data-action="toggle-row"
              data-key="${escapeHtml(rowKey)}"
              ${checked}
            />
          </td>
        ` : ""}
        ${columns.map(key => `<td>${escapeHtml(valueToString(row[key] ?? ""))}</td>`).join("")}
        <td class="actions-col">
          <div class="table-actions">
            ${canAdmin ? adminActions : supervisionActions}
          </div>
        </td>
      </tr>
    `;
  }).join("");

  const btnDelete = $("btnEliminarSeleccionados");
  if (btnDelete) {
    btnDelete.disabled = state.selectedKeys.size === 0;
  }

  if (canAdmin) {
    const visibleKeys = state.filteredRows.map(buildRowKey);
    const selectedVisible = visibleKeys.filter(k => state.selectedKeys.has(k)).length;
    const master = $("checkAllRows");

    if (master) {
      master.checked = visibleKeys.length > 0 && selectedVisible === visibleKeys.length;
      master.indeterminate = selectedVisible > 0 && selectedVisible < visibleKeys.length;
    }
  }
}

/* =========================================================
   MODAL EDITOR DINÁMICO
========================================================= */
function getRowRawById(idGrupo) {
  return state.rowsRaw.find(r => String(r.id) === String(idGrupo) || String(r.data.idGrupo) === String(idGrupo)) || null;
}

function getEditableKeys(rowFlat) {
  return getDisplayColumns().filter((key) => !READONLY_EDIT_KEYS.has(key));
}

function buildEditorField(key, value) {
  const val = valueToString(value);
  const label = prettifyFieldKey(key);
  const isLong =
    key.toLowerCase().includes("observ") ||
    key.toLowerCase().includes("detalle") ||
    key.toLowerCase().includes("nota") ||
    val.length > 80;

  const spanClass = isLong ? "span-3" : "span-2";

  return `
    <div class="editor-field ${spanClass}">
      <label for="editor_${escapeHtml(key)}">${escapeHtml(label)}</label>
      ${isLong
        ? `<textarea id="editor_${escapeHtml(key)}" data-key="${escapeHtml(key)}">${escapeHtml(val)}</textarea>`
        : `<input id="editor_${escapeHtml(key)}" type="text" data-key="${escapeHtml(key)}" value="${escapeHtml(val)}" />`
      }
    </div>
  `;
}

function openEditor(idGrupo) {
  if (!isAdminOnly()) return;
  
  const raw = getRowRawById(idGrupo);
  const body = $("editorBody");
  const title = $("editorTitle");

  if (!raw || !body || !title) return;

  state.editingId = raw.id;
  const flat = {
    idGrupo: raw.data.idGrupo || raw.id,
    ...flattenObject(raw.data)
  };

  const editableKeys = getEditableKeys(flat);

  title.textContent = `Editar grupo · ${valueToString(flat.codigoRegistro || flat.idGrupo)}`;
  body.innerHTML = editableKeys.map((key) => buildEditorField(key, flat[key])).join("");

  $("editorModal")?.classList.add("show");
}

function closeEditor() {
  state.editingId = null;
  $("editorModal")?.classList.remove("show");
}

async function saveEditor() {
  if (!isAdminOnly()) return;
  if (!state.editingId) return;

  const raw = getRowRawById(state.editingId);
  if (!raw) return;

  const payload = {};
  const fields = [...document.querySelectorAll("#editorBody [data-key]")];

  fields.forEach((el) => {
    const key = el.dataset.key;
    if (!key) return;

    const parsed = parseImportedValue(key, el.value);
    setNestedValue(payload, key, parsed);
  });

  payload.actualizadoPor = getNombreUsuario(state.effectiveUser);
  payload.actualizadoPorCorreo = normalizeEmail(state.realUser?.email || "");
  payload.fechaActualizacion = serverTimestamp();

  try {
    setProgressStatus({
      text: "Guardando cambios...",
      meta: `Grupo: ${state.editingId}`,
      progress: 45
    });

    await setDoc(doc(db, "ventas_cotizaciones", state.editingId), payload, { merge: true });

    setProgressStatus({
      text: "Cambios guardados.",
      meta: "El grupo fue actualizado correctamente.",
      progress: 100,
      type: "success"
    });
    clearProgressStatus();
    closeEditor();
    await loadData();
  } catch (error) {
    console.error(error);
    setProgressStatus({
      text: "Error guardando cambios.",
      meta: error.message || "No se pudo actualizar.",
      progress: 100,
      type: "error"
    });
  }
}

/* =========================================================
   ELIMINACIÓN
========================================================= */
async function deleteRow(idGrupo) {
  if (!isAdminOnly()) return;
  
  const ok = confirm(`¿Seguro que quieres eliminar el grupo ${idGrupo}?`);
  if (!ok) return;

  try {
    setProgressStatus({
      text: "Eliminando grupo...",
      meta: `ID: ${idGrupo}`,
      progress: 40
    });

    await deleteDoc(doc(db, "ventas_cotizaciones", idGrupo));
    state.selectedKeys.delete(String(idGrupo));

    setProgressStatus({
      text: "Grupo eliminado.",
      meta: "El registro fue eliminado correctamente.",
      progress: 100,
      type: "success"
    });
    clearProgressStatus();
    await loadData();
  } catch (error) {
    console.error(error);
    setProgressStatus({
      text: "Error eliminando grupo.",
      meta: error.message || "No se pudo eliminar.",
      progress: 100,
      type: "error"
    });
  }
}

async function deleteSelectedRows() {
  if (!isAdminOnly()) return;
  if (!state.selectedKeys.size) return;

  const ok = confirm(`¿Seguro que quieres eliminar ${state.selectedKeys.size} grupo(s) seleccionados?`);
  if (!ok) return;

  try {
    const ids = [...state.selectedKeys];
    let processed = 0;

    for (let i = 0; i < ids.length; i += WRITE_BATCH_LIMIT) {
      const chunk = ids.slice(i, i + WRITE_BATCH_LIMIT);
      const batch = writeBatch(db);

      chunk.forEach((id) => {
        batch.delete(doc(db, "ventas_cotizaciones", String(id)));
      });

      await batch.commit();
      processed += chunk.length;

      const pct = 20 + Math.round((processed / ids.length) * 80);
      setProgressStatus({
        text: "Eliminando seleccionados...",
        meta: `Procesados: ${processed}/${ids.length}`,
        progress: pct
      });
    }

    state.selectedKeys.clear();

    setProgressStatus({
      text: "Eliminación lista.",
      meta: `${ids.length} registro(s) eliminados.`,
      progress: 100,
      type: "success"
    });
    clearProgressStatus();
    await loadData();
  } catch (error) {
    console.error(error);
    setProgressStatus({
      text: "Error eliminando seleccionados.",
      meta: error.message || "No se pudo completar la eliminación.",
      progress: 100,
      type: "error"
    });
  }
}

/* =========================================================
   IMPORT / EXPORT
========================================================= */
function buildCodigoRegistro(docId) {
  const year = new Date().getFullYear();
  return `COT-${year}-${String(docId).slice(0, 6).toUpperCase()}`;
}

function parseSheetRows(sheet) {
  return XLSX.utils.sheet_to_json(sheet, { defval: "" });
}

function isRowEmpty(rowObj = {}) {
  return !Object.values(rowObj).some(v => normalizeText(v) !== "");
}

function rowToFieldPayload(rowObj) {
  const payload = {};

  Object.entries(rowObj).forEach(([rawKey, rawValue]) => {
    const key = sanitizeImportKey(rawKey);
    if (!key) return;
    if (IMPORT_IGNORE_KEYS.has(key)) return;

    const value = parseImportedValue(key, rawValue);
    setNestedValue(payload, key, value);
  });

  return autoResolveKnownPeople(payload);
}

function findExistingDocId(payload, codeIndex) {
  const id = normalizeText(payload.idGrupo);
  if (id) return id;

  const code = normalizeText(payload.codigoRegistro);
  if (code && codeIndex.has(code)) return codeIndex.get(code);

  return "";
}

async function importXlsx(file) {
  if (!isAdminOnly()) return;
  if (!file) return;

  try {
    if (typeof XLSX === "undefined") {
      alert("No se encontró la librería XLSX.");
      return;
    }

    setProgressStatus({
      text: "Importando XLSX...",
      meta: "Leyendo archivo...",
      progress: 10
    });

    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });

    let rawRows = [];
    workbook.SheetNames.forEach((sheetName, idx) => {
      const sheet = workbook.Sheets[sheetName];
      const rows = parseSheetRows(sheet);
      rawRows = rawRows.concat(rows);

      const pct = 10 + Math.round(((idx + 1) / workbook.SheetNames.length) * 20);
      setProgressStatus({
        text: "Importando XLSX...",
        meta: `Leyendo hoja ${idx + 1}/${workbook.SheetNames.length}: ${sheetName}`,
        progress: pct
      });
    });

    rawRows = rawRows.filter(row => !isRowEmpty(row));

    if (!rawRows.length) {
      setProgressStatus({
        text: "Importación detenida.",
        meta: "El archivo no contiene filas válidas.",
        progress: 100,
        type: "error"
      });
      return;
    }

    const codeIndex = new Map();
    state.rowsRaw.forEach(({ id, data }) => {
      const code = normalizeText(data.codigoRegistro || "");
      if (code) codeIndex.set(code, id);
    });

    let createdCount = 0;
    let updatedCount = 0;
    let processed = 0;

    for (const rowObj of rawRows) {
      const payload = rowToFieldPayload(rowObj);
      const existingId = findExistingDocId(payload, codeIndex);

      let ref;
      let isNew = false;

      if (existingId) {
        ref = doc(db, "ventas_cotizaciones", existingId);
      } else {
        ref = doc(collection(db, "ventas_cotizaciones"));
        isNew = true;
      }

      const snap = await getDoc(ref);
      const finalPayload = {
        ...payload,
        idGrupo: snap.exists() ? (snap.data().idGrupo || ref.id) : ref.id,
        actualizadoPor: getNombreUsuario(state.effectiveUser),
        actualizadoPorCorreo: normalizeEmail(state.realUser?.email || ""),
        fechaActualizacion: serverTimestamp()
      };

      if (isNew || !snap.exists()) {
        finalPayload.codigoRegistro = normalizeText(finalPayload.codigoRegistro) || buildCodigoRegistro(ref.id);
        finalPayload.creadoPor = getNombreUsuario(state.effectiveUser);
        finalPayload.creadoPorCorreo = normalizeEmail(state.realUser?.email || "");
        finalPayload.fechaCreacion = serverTimestamp();
        await setDoc(ref, finalPayload, { merge: true });
        createdCount += 1;
      } else {
        await setDoc(ref, finalPayload, { merge: true });
        updatedCount += 1;
      }

      processed += 1;
      const pct = 35 + Math.round((processed / rawRows.length) * 65);
      setProgressStatus({
        text: "Importando XLSX...",
        meta: `Procesados: ${processed}/${rawRows.length}`,
        progress: pct
      });
    }

    setProgressStatus({
      text: "Importación lista.",
      meta: `${createdCount} nuevos · ${updatedCount} actualizados · ${rawRows.length} total`,
      progress: 100,
      type: "success"
    });
    clearProgressStatus({}, 3000);

    $("fileInputXlsx").value = "";
    await loadData();
  } catch (error) {
    console.error(error);
    setProgressStatus({
      text: "Error importando XLSX.",
      meta: error.message || "No se pudo importar el archivo.",
      progress: 100,
      type: "error"
    });
  }
}

async function exportXlsx() {
  try {
    if (typeof XLSX === "undefined") {
      alert("No se encontró la librería XLSX.");
      return;
    }

    const columns = getDisplayColumns();

    setProgressStatus({
      text: "Exportando XLSX...",
      meta: "Preparando datos visibles...",
      progress: 20
    });

    const exportRows = state.filteredRows.map((row) => {
      const out = {};
      columns.forEach((key) => {
        out[key] = valueToString(row[key] ?? "");
      });
      return out;
    });

    setProgressStatus({
      text: "Exportando XLSX...",
      meta: `Registros a exportar: ${exportRows.length}`,
      progress: 55
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(exportRows);
    XLSX.utils.book_append_sheet(wb, ws, "Clientes");

    const filename = `clientes_${formatNowForFile()}.xlsx`;

    setProgressStatus({
      text: "Exportando XLSX...",
      meta: "Generando archivo...",
      progress: 85
    });

    XLSX.writeFile(wb, filename);

    setProgressStatus({
      text: "Exportación lista.",
      meta: filename,
      progress: 100,
      type: "success"
    });
    clearProgressStatus();
  } catch (error) {
    console.error(error);
    setProgressStatus({
      text: "Error exportando XLSX.",
      meta: error.message || "No se pudo exportar.",
      progress: 100,
      type: "error"
    });
  }
}

function downloadTemplateXlsx() {
  try {
    if (!isAdminOnly()) return;

    if (typeof XLSX === "undefined") {
      alert("No se encontró la librería XLSX.");
      return;
    }

    const columns = state.allKeys.length ? getDisplayColumns() : BASE_COLUMNS;
    const templateRow = {};

    columns.forEach((key) => {
      templateRow[key] = "";
    });

    // ejemplos útiles en algunos campos base
    if ("estado" in templateRow) templateRow.estado = "A contactar";
    if ("anoViaje" in templateRow) templateRow.anoViaje = new Date().getFullYear();
    if ("requiereAsignacion" in templateRow) templateRow.requiereAsignacion = "No";
    if ("destinosSecundarios" in templateRow) templateRow.destinosSecundarios = "Bariloche | Brasil";

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet([templateRow]);
    XLSX.utils.book_append_sheet(wb, ws, "Plantilla");

    const filename = `plantilla_clientes_${formatNowForFile()}.xlsx`;
    XLSX.writeFile(wb, filename);
  } catch (error) {
    console.error(error);
    alert("No se pudo generar la plantilla XLSX.");
  }
}

/* =========================================================
   EVENTOS
========================================================= */
function bindPageEvents() {

  const searchInput = $("searchInput");
  const filterEstado = $("filterEstado");
  const filterVendedora = $("filterVendedora");
  const filterAnoViaje = $("filterAnoViaje");
  const filterDestino = $("filterDestino");
  const btnRecargar = $("btnRecargar");
  const btnEliminarSeleccionados = $("btnEliminarSeleccionados");
  const fileInputXlsx = $("fileInputXlsx");
  const btnPlantilla = $("btnPlantilla");
  const btnVerAnteriores = $("btnVerAnteriores");
  const btnExportar = $("btnExportar");
  const tbody = $("tbodyClientes");
  const thead = $("theadClientes");
  const editorCloseBtn = $("editorCloseBtn");
  const btnCancelarEditor = $("btnCancelarEditor");
  const btnGuardarEditor = $("btnGuardarEditor");
  const editorModal = $("editorModal");

  if (searchInput && !searchInput.dataset.bound) {
    searchInput.dataset.bound = "1";
    searchInput.addEventListener("input", (e) => {
      state.search = e.target.value || "";
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

  if (filterDestino && !filterDestino.dataset.bound) {
    filterDestino.dataset.bound = "1";
    filterDestino.addEventListener("change", (e) => {
      state.filters.destinoPrincipal = normalizeText(e.target.value || "");
      applyFilters();
    });
  }

  if (btnRecargar && !btnRecargar.dataset.bound) {
    btnRecargar.dataset.bound = "1";
    btnRecargar.addEventListener("click", async () => {
      await loadData();
    });
  }

  if (btnEliminarSeleccionados && !btnEliminarSeleccionados.dataset.bound) {
    btnEliminarSeleccionados.dataset.bound = "1";
    btnEliminarSeleccionados.addEventListener("click", deleteSelectedRows);
  }

  if (fileInputXlsx && !fileInputXlsx.dataset.bound) {
    fileInputXlsx.dataset.bound = "1";
    fileInputXlsx.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      await importXlsx(file);
    });
  }

  if (btnPlantilla && !btnPlantilla.dataset.bound) {
    btnPlantilla.dataset.bound = "1";
    btnPlantilla.addEventListener("click", downloadTemplateXlsx);
  }

  if (btnVerAnteriores && !btnVerAnteriores.dataset.bound) {
    btnVerAnteriores.dataset.bound = "1";
    btnVerAnteriores.addEventListener("click", () => {
      state.showArchivedOnly = !state.showArchivedOnly;
      state.selectedKeys.clear();
      applyFilters();
    });
  }

  if (btnExportar && !btnExportar.dataset.bound) {
    btnExportar.dataset.bound = "1";
    btnExportar.addEventListener("click", exportXlsx);
  }

  if (thead && !thead.dataset.bound) {
    thead.dataset.bound = "1";
    thead.addEventListener("change", (e) => {
      if (!isAdminOnly()) return;
  
      const target = e.target;
      if (!(target instanceof HTMLInputElement)) return;
      if (target.id !== "checkAllRows") return;
  
      const checked = !!target.checked;
      state.filteredRows.forEach((row) => {
        const key = buildRowKey(row);
        if (checked) state.selectedKeys.add(key);
        else state.selectedKeys.delete(key);
      });
  
      renderTable();
    });
  }

  if (tbody && !tbody.dataset.bound) {
    tbody.dataset.bound = "1";
    tbody.addEventListener("click", async (e) => {
      const checkbox = e.target.closest('input[data-action="toggle-row"]');
      if (checkbox) return;

      const btn = e.target.closest("button[data-action]");
      if (!btn) return;

      const action = btn.dataset.action || "";
      const id = btn.dataset.id || "";

      if (action === "open") {
        location.href = `${DETALLE_GRUPO_URL}?id=${encodeURIComponent(id)}`;
        return;
      }

      if (action === "edit") {
        openEditor(id);
        return;
      }

      if (action === "delete") {
        await deleteRow(id);
      }
    });

    tbody.addEventListener("change", (e) => {
      if (!isAdminOnly()) return;
    
      const input = e.target.closest('input[data-action="toggle-row"]');
      if (!input) return;
    
      const key = input.dataset.key || "";
      if (input.checked) state.selectedKeys.add(key);
      else state.selectedKeys.delete(key);
    
      renderTable();
    });
  }

  if (editorCloseBtn && !editorCloseBtn.dataset.bound) {
    editorCloseBtn.dataset.bound = "1";
    editorCloseBtn.addEventListener("click", closeEditor);
  }

  if (btnCancelarEditor && !btnCancelarEditor.dataset.bound) {
    btnCancelarEditor.dataset.bound = "1";
    btnCancelarEditor.addEventListener("click", closeEditor);
  }

  if (btnGuardarEditor && !btnGuardarEditor.dataset.bound) {
    btnGuardarEditor.dataset.bound = "1";
    btnGuardarEditor.addEventListener("click", saveEditor);
  }

  if (editorModal && !editorModal.dataset.bound) {
    editorModal.dataset.bound = "1";
    editorModal.addEventListener("click", (e) => {
      if (e.target === editorModal) closeEditor();
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
      if (!state.realUser || state.realUser.rol !== "admin") return;
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

  bindHeaderActions();
  bindPageEvents();

  onAuthStateChanged(auth, async (user) => {
    if (!user) return;

    await bootstrapFromSession();
    if (!assertAccess()) return;

    setHeaderAndScope();
    await loadData();
  });
}

initPage();
