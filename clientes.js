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
  "aliasGrupo",
  "estado",
  "fechaUltimoCambioEstado",

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

  "nombreCliente2",
  "rolCliente2",
  "correoCliente2",
  "celularCliente2",

  "origenColegio",
  "origenCliente",
  "origenEspecificacion",
  "origenEspecificacionOtro",

  "destinoPrincipal",
  "destinoPrincipalOtro",
  "destinosSecundarios",
  "destinoSecundarioOtro",

  "programa",
  "tramo",
  "semanaViaje",
  "fechaViaje",
  "fechaReunionCliente",
  "solicitudReserva",
  "solicitudHotel",

  "comunaCiudad",
  "requiereAsignacion",

  "observacionesOperaciones",
  "observacionesAdministracion",

  "asistenciaMed",
  "liberados",
  "valorPrograma",

  "autorizacionGerencia",
  "descuentoFicha",

  "versionFicha",
  "fechaActualizacionFicha",
  "observacionesFicha",

  "firmaVendedor",
  "firmaSupervision",
  "firmaAdministracion",

  "autorizada",
  "cerrada",
  "cierre",
  "fichaEstado",
  "contratoEstado",
  "nominaEstado",
  "fichaMedicaEstado",
  "cortesiaEstado",

  "numeroNegocio",
  "usuarioProgramaAdm",
  "claveAdministrativa",

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

const HIDDEN_DYNAMIC_KEYS = new Set([
  "logoColegioUrl",
  "logoColegioPath"
]);

const LABELS = {
  idGrupo: "ID GRUPO",
  codigoRegistro: "CÓDIGO",
  aliasGrupo: "ALIAS",
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

  fechaUltimoCambioEstado: "FECHA ÚLTIMO CAMBIO ESTADO",

  nombreCliente2: "CONTACTO 2",
  rolCliente2: "ROL CONTACTO 2",
  correoCliente2: "CORREO CONTACTO 2",
  celularCliente2: "CELULAR CONTACTO 2",

  programa: "PROGRAMA",
  tramo: "TRAMO",
  semanaViaje: "SEMANA VIAJE",
  fechaViaje: "FECHA DE VIAJE",
  fechaReunionCliente: "FECHA REUNIÓN CLIENTE",
  solicitudReserva: "SOLICITUD RESERVA",
  solicitudHotel: "SOLICITUD HOTEL",

  observacionesOperaciones: "OBSERVACIONES OPERACIONES",
  observacionesAdministracion: "OBSERVACIONES ADMINISTRACIÓN",

  asistenciaMed: "ASISTENCIA EN VIAJES",
  liberados: "LIBERADOS",
  valorPrograma: "VALOR PROGRAMA",

  autorizacionGerencia: "AUTORIZACIÓN GERENCIA",
  descuentoFicha: "DESCUENTO",
  versionFicha: "VERSIÓN FICHA",
  fechaActualizacionFicha: "FECHA ACTUALIZACIÓN FICHA",
  observacionesFicha: "OBSERVACIONES FICHA",

  firmaVendedor: "FIRMA VENDEDOR",
  firmaSupervision: "FIRMA SUPERVISIÓN",
  firmaAdministracion: "FIRMA ADMINISTRACIÓN",

  autorizada: "AUTORIZADA",
  cerrada: "CERRADA",
  cierre: "CIERRE",
  fichaEstado: "ESTADO FICHA",
  contratoEstado: "ESTADO CONTRATO",
  nominaEstado: "ESTADO NÓMINA",
  fichaMedicaEstado: "ESTADO FICHAS MÉDICAS",
  cortesiaEstado: "ESTADO CORTESÍAS",

  numeroNegocio: "NÚMERO NEGOCIO",
  usuarioProgramaAdm: "USUARIO PROGRAMA ADM",
  claveAdministrativa: "CLAVE ADMINISTRATIVA",

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
  pageRows: [],
  selectedKeys: new Set(),
  allKeys: [],
  dynamicKeys: [],
  carteraIndex: new Map(),
  carteraEntries: [],
  carteraIndexLoaded: false,
  editingId: null,
  search: "",
  showArchivedOnly: false,
  pageSize: 8,
  currentPage: 1,
  sort: {
    key: "idGrupo",
    dir: "desc"
  },
  filters: {
    estado: "",
    vendedora: "",
    anoViaje: "",
    destinoPrincipal: "",
    cartera: ""
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

function getCurrentYear() {
  return new Date().getFullYear();
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

  // IMPORTANTE:
  // Como el switcher del encabezado se vuelve a renderizar,
  // hay que volver a conectar los listeners de sus botones.
  bindHeaderActions();
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

function getCarteraBucket(row) {
  const origen = normalizeSearch(row?.origenColegio || "");
  return origen === "cartera" ? "cartera" : "no_cartera";
}

function updateArchiveButton() {
  const btn = $("btnVerAnteriores");
  if (!btn) return;

  btn.textContent = state.showArchivedOnly ? "Ver Actuales" : "Ver Anteriores";
}

function valueToString(value) {
  if (value === null || value === undefined) return "";

  if (value instanceof Date) {
    return formatDateTime(value);
  }

  if (isTimestampLike(value)) {
    return formatDateTime(value);
  }

  if (Array.isArray(value)) {
    return value.map(v => valueToString(v)).filter(Boolean).join(" | ");
  }

  if (typeof value === "boolean") {
    return value ? "Sí" : "No";
  }

  if (typeof value === "number") {
    return String(value);
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
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

const NUMERIC_IMPORT_KEYS = new Set([
  "anoViaje",
  "cantidadGrupo",
  "liberados",
  "valorPrograma",
  "numeroNegocio"
]);

const DATE_IMPORT_KEYS = new Set([
  "fechaUltimoCambioEstado",
  "fechaReunionCliente",
  "solicitudReserva",
  "fechaActualizacionFicha",
  "fechaViaje",
  "fechaCreacion",
  "fechaActualizacion"
]);

function parseImportedNumber(rawValue) {
  if (rawValue === null || rawValue === undefined) return null;

  if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
    return rawValue;
  }

  let raw = String(rawValue ?? "").trim();
  if (!raw) return null;

  raw = raw.replace(/\$/g, "").replace(/\s+/g, "");

  if (raw.includes(".") && raw.includes(",")) {
    if (raw.lastIndexOf(",") > raw.lastIndexOf(".")) {
      raw = raw.replace(/\./g, "").replace(",", ".");
    } else {
      raw = raw.replace(/,/g, "");
    }
  } else if ((raw.match(/\./g) || []).length > 1) {
    raw = raw.replace(/\./g, "");
  } else if ((raw.match(/,/g) || []).length > 1) {
    raw = raw.replace(/,/g, "");
  } else if (raw.includes(",") && !raw.includes(".")) {
    raw = raw.replace(",", ".");
  }

  const maybe = Number(raw);
  return Number.isFinite(maybe) ? maybe : null;
}

function parseExcelSerialDate(rawValue) {
  const serial = Number(rawValue);
  if (!Number.isFinite(serial)) return null;
  if (serial < 20000 || serial > 70000) return null;

  const utcDays = Math.floor(serial - 25569);
  const utcValue = utcDays * 86400;
  const fractionalDay = serial % 1;
  const totalSeconds = Math.round(fractionalDay * 86400);

  const d = new Date((utcValue + totalSeconds) * 1000);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseImportedDate(rawValue) {
  if (!rawValue && rawValue !== 0) return null;

  if (rawValue instanceof Date && !Number.isNaN(rawValue.getTime())) {
    return rawValue;
  }

  if (typeof rawValue === "number") {
    return parseExcelSerialDate(rawValue);
  }

  const raw = String(rawValue ?? "").trim();
  if (!raw) return null;

  const iso = new Date(raw);
  if (!Number.isNaN(iso.getTime())) {
    return iso;
  }

  const match = raw.match(
    /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?$/
  );

  if (match) {
    let year = Number(match[3]);
    if (year < 100) year += 2000;

    const d = new Date(
      year,
      Number(match[2]) - 1,
      Number(match[1]),
      Number(match[4] || 0),
      Number(match[5] || 0),
      0
    );

    return Number.isNaN(d.getTime()) ? null : d;
  }

  return null;
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
    if (["no", "false", "0", "abierta"].includes(val)) return false;
  }

  if (NUMERIC_IMPORT_KEYS.has(key)) {
    const maybe = parseImportedNumber(rawValue);
    return maybe !== null ? maybe : value;
  }

  if (DATE_IMPORT_KEYS.has(key)) {
    const parsed = parseImportedDate(rawValue);
    return parsed || value;
  }

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
  const original = normalizeText(rawKey).trim();
  if (!original) return "";

  /* =========================================================
     1) SI EL HEADER YA VIENE EXACTO COMO LO EXPORTA EL SISTEMA,
        SE RESPETA TAL CUAL
        Ej: anoViaje, codigoRegistro, origenColegio, vendedoraCorreo
  ========================================================= */
  if (BASE_COLUMNS.includes(original)) {
    return original;
  }

  /* =========================================================
     2) SI EL HEADER PARECE UNA KEY INTERNA VÁLIDA
        (camelCase, snake_case o anidada con punto),
        también se respeta tal cual.
        Esto ayuda a reimportar columnas dinámicas exportadas
        por el propio sistema.
  ========================================================= */
  const looksLikeInternalKey = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(original);
  if (looksLikeInternalKey && !/\s/.test(original)) {
    return original;
  }

  /* =========================================================
     3) ALIAS HUMANOS / VARIANTES MANUALES
        Aquí aceptamos encabezados "bonitos" o escritos a mano
  ========================================================= */
  const normalized = normalizeSearch(original)
    .replace(/\s+/g, " ")
    .trim();

  const aliasMap = {
    // base
    "id grupo": "idGrupo",
    "idgrupo": "idGrupo",

    "codigo": "codigoRegistro",
    "código": "codigoRegistro",
    "codigo registro": "codigoRegistro",
    "código registro": "codigoRegistro",
    "codigoregistro": "codigoRegistro",

    "estado": "estado",
    "colegio": "colegio",
    "curso": "curso",

    "cantidad grupo": "cantidadGrupo",
    "cantidadgrupo": "cantidadGrupo",

    "año viaje": "anoViaje",
    "anio viaje": "anoViaje",
    "anoviaje": "anoViaje",

    // vendedora / cliente
    "vendedora": "vendedora",
    "correo vendedora": "vendedoraCorreo",
    "correo vendedor": "vendedoraCorreo",
    "correo de vendedora": "vendedoraCorreo",

    "nombre cliente": "nombreCliente",
    "rol cliente": "rolCliente",
    "correo cliente": "correoCliente",
    "celular cliente": "celularCliente",

    // origen
    "origen colegio": "origenColegio",
    "origen cliente": "origenCliente",
    "especificacion origen": "origenEspecificacion",
    "especificación origen": "origenEspecificacion",
    "detalle origen": "origenEspecificacionOtro",
    "otro origen": "origenEspecificacionOtro",

    // destino
    "destino principal": "destinoPrincipal",
    "otro destino principal": "destinoPrincipalOtro",
    "destinos secundarios": "destinosSecundarios",
    "destino secundario": "destinosSecundarios",
    "otro destino secundario": "destinoSecundarioOtro",

    // contacto 2
    "contacto 2": "nombreCliente2",
    "nombre contacto 2": "nombreCliente2",
    "rol contacto 2": "rolCliente2",
    "correo contacto 2": "correoCliente2",
    "celular contacto 2": "celularCliente2",

    // datos grupo / operativos
    "fecha de ultimo cambio de estado": "fechaUltimoCambioEstado",
    "fecha de último cambio de estado": "fechaUltimoCambioEstado",
    "programa": "programa",
    "tramo": "tramo",
    "fecha tentativa": "semanaViaje",
    "solicitud reserva": "solicitudReserva",
    "solicitud de reserva": "solicitudReserva",
    "fecha reunion cliente": "fechaReunionCliente",
    "fecha reunión cliente": "fechaReunionCliente",
    "hotel": "solicitudHotel",
    "solicitud hotel": "solicitudHotel",

    // observaciones
    "observacion operaciones": "observacionesOperaciones",
    "observación operaciones": "observacionesOperaciones",
    "observaciones operaciones": "observacionesOperaciones",
    "observaciones administracion": "observacionesAdministracion",
    "observaciones administración": "observacionesAdministracion",

    // ficha
    "asistencia en viaje": "asistenciaMed",
    "asistencia en viajes": "asistenciaMed",
    "liberados": "liberados",
    "valor programa": "valorPrograma",
    "autorizacion": "autorizacionGerencia",
    "autorización": "autorizacionGerencia",
    "descuento": "descuentoFicha",
    "version ficha": "versionFicha",
    "fecha actualizacion ficha": "fechaActualizacionFicha",
    "fecha actualización ficha": "fechaActualizacionFicha",
    "observaciones ficha": "observacionesFicha",

    // firmas / flujo
    "firma vendedor": "firmaVendedor",
    "firma supervision": "firmaSupervision",
    "firma supervisión": "firmaSupervision",
    "firma administracion": "firmaAdministracion",
    "firma administración": "firmaAdministracion",
    "cierre": "cierre",

    // integración / administración
    "numero negocio": "numeroNegocio",
    "n negocio": "numeroNegocio",
    "n de negocio": "numeroNegocio",
    "usuario programa adm": "usuarioProgramaAdm",
    "clave administrativa": "claveAdministrativa",

    // ubicación / asignación
    "comuna ciudad": "comunaCiudad",
    "comuna / ciudad": "comunaCiudad",
    "requiere asignacion": "requiereAsignacion",
    "requiere asignación": "requiereAsignacion",

    // auditoría
    "creado por": "creadoPor",
    "correo creador": "creadoPorCorreo",
    "correo creado por": "creadoPorCorreo",
    "fecha creacion": "fechaCreacion",
    "fecha creación": "fechaCreacion",

    "actualizado por": "actualizadoPor",
    "correo actualizacion": "actualizadoPorCorreo",
    "correo actualización": "actualizadoPorCorreo",
    "correo actualizado por": "actualizadoPorCorreo",
    "fecha actualizacion": "fechaActualizacion",
    "fecha actualización": "fechaActualizacion"
  };

  if (aliasMap[normalized]) {
    return aliasMap[normalized];
  }

  /* =========================================================
     4) FALLBACK:
        convierte headers legibles a camelCase
        Ej: "Nombre Cliente" -> "nombreCliente"
        Mantiene puntos para campos anidados
  ========================================================= */
  const pieces = original
    .split(".")
    .map((piece) => {
      const cleaned = piece
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9_ ]+/g, " ")
        .trim();

      if (!cleaned) return "";

      const parts = cleaned.split(/\s+/).filter(Boolean);

      return parts
        .map((part, idx) => {
          const low = part.toLowerCase();
          if (idx === 0) return low;
          return low.charAt(0).toUpperCase() + low.slice(1);
        })
        .join("");
    })
    .filter(Boolean);

  const candidate = pieces.join(".");

  // si el fallback termina coincidiendo con una key base, perfecto
  if (BASE_COLUMNS.includes(candidate)) {
    return candidate;
  }

  // si no, igual devolvemos el candidate para permitir columnas dinámicas
  return candidate;
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

function normalizeSchoolForCartera(value = "") {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " Y ")
    .replace(/[^A-Z0-9 ]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function compactSchoolKey(value = "") {
  return normalizeSchoolForCartera(value).replace(/\s+/g, "");
}

function buildCarteraVendorName(data = {}) {
  return normalizeText(`${data.nombreVendedor || ""} ${data.apellidoVendedor || ""}`.trim());
}

function normalizeCarteraStatus(value = "") {
  return normalizeSearch(value).replace(/\s+/g, " ").trim();
}

function isCarteraOkStatus(value = "") {
  return normalizeCarteraStatus(value) === "ok";
}

function levenshteinDistance(a = "", b = "") {
  const s = String(a);
  const t = String(b);

  if (s === t) return 0;
  if (!s.length) return t.length;
  if (!t.length) return s.length;

  const rows = t.length + 1;
  const cols = s.length + 1;
  const dp = Array.from({ length: rows }, () => new Array(cols).fill(0));

  for (let i = 0; i < rows; i++) dp[i][0] = i;
  for (let j = 0; j < cols; j++) dp[0][j] = j;

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = t[i - 1] === s[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }

  return dp[t.length][s.length];
}

function similarityRatio(a = "", b = "") {
  const x = String(a || "");
  const y = String(b || "");
  if (!x && !y) return 1;
  if (!x || !y) return 0;

  const maxLen = Math.max(x.length, y.length);
  if (!maxLen) return 1;

  const dist = levenshteinDistance(x, y);
  return 1 - (dist / maxLen);
}

function tokenOverlapRatio(a = "", b = "") {
  const aTokens = normalizeSchoolForCartera(a).split(" ").filter(Boolean);
  const bTokens = normalizeSchoolForCartera(b).split(" ").filter(Boolean);

  if (!aTokens.length || !bTokens.length) return 0;

  const aSet = new Set(aTokens);
  const bSet = new Set(bTokens);

  let common = 0;
  aSet.forEach((token) => {
    if (bSet.has(token)) common += 1;
  });

  return common / Math.max(aSet.size, bSet.size);
}

async function loadSchoolCarteraIndex(force = false) {
  if (!force && state.carteraIndexLoaded) {
    return {
      byExact: state.carteraIndex,
      entries: state.carteraEntries
    };
  }

  const byExact = new Map();
  const sellersSnap = await getDocs(collection(db, "ventas_cartera"));

  for (const sellerDoc of sellersSnap.docs) {
    const sellerEmail = normalizeEmail(sellerDoc.id);
    const itemsSnap = await getDocs(collection(db, "ventas_cartera", sellerEmail, "items"));

    itemsSnap.docs.forEach((itemDoc) => {
      const data = itemDoc.data() || {};

      const normalizedSchool = normalizeSchoolForCartera(
        data.colegioNormalizado || data.colegio || itemDoc.id
      );
      if (!normalizedSchool) return;

      const existing = byExact.get(normalizedSchool) || {
        normalizedSchool,
        compactKey: compactSchoolKey(normalizedSchool),
        colegio: normalizeText(data.colegio || ""),
        matches: 0,
        hasOk: false,
        hasAny: false,
        vendedora: "",
        vendedoraCorreo: "",
        logoColegioUrl: "",
        statuses: new Set()
      };

      existing.matches += 1;
      existing.hasAny = true;

      const statusNorm = normalizeCarteraStatus(data.estatus || "");
      if (statusNorm) existing.statuses.add(statusNorm);
      if (isCarteraOkStatus(data.estatus || "")) {
        existing.hasOk = true;
      }

      if (!existing.vendedora) {
        existing.vendedora = buildCarteraVendorName(data);
      }

      if (!existing.vendedoraCorreo) {
        existing.vendedoraCorreo = normalizeEmail(data.correoVendedor || sellerEmail);
      }

      if (!existing.colegio) {
        existing.colegio = normalizeText(data.colegio || "");
      }

      if (!existing.logoColegioUrl) {
        existing.logoColegioUrl = String(data.logoColegioUrl || data.logoUrl || "").trim();
      }

      byExact.set(normalizedSchool, existing);
    });
  }

  const entries = Array.from(byExact.values()).map((entry) => ({
    ...entry,
    statuses: Array.from(entry.statuses || [])
  }));

  state.carteraIndex = byExact;
  state.carteraEntries = entries;
  state.carteraIndexLoaded = true;

  return { byExact, entries };
}

function findBestCarteraMatch(colegio = "", carteraCache = { byExact: new Map(), entries: [] }) {
  const exactKey = normalizeSchoolForCartera(colegio);
  if (!exactKey) return null;

  const direct = carteraCache.byExact.get(exactKey);
  if (direct) {
    return {
      entry: direct,
      score: 1,
      mode: "exact"
    };
  }

  const targetCompact = compactSchoolKey(colegio);
  const targetPretty = normalizeSchoolForCartera(colegio);

  let best = null;
  let second = null;

  for (const entry of (carteraCache.entries || [])) {
    const simPretty = similarityRatio(targetPretty, entry.normalizedSchool);
    const simCompact = similarityRatio(targetCompact, entry.compactKey);
    const overlap = tokenOverlapRatio(targetPretty, entry.normalizedSchool);

    const score = Math.max(simPretty, simCompact) * 0.8 + overlap * 0.2;

    if (!best || score > best.score) {
      second = best;
      best = { entry, score, overlap, mode: "fuzzy" };
    } else if (!second || score > second.score) {
      second = { entry, score, overlap, mode: "fuzzy" };
    }
  }

  if (!best) return null;

  const bestScore = best.score || 0;
  const secondScore = second?.score || 0;
  const gap = bestScore - secondScore;

  const isStrongEnough =
    bestScore >= 0.93 ||
    (bestScore >= 0.89 && (best.overlap || 0) >= 0.75);

  const isClearlyBetter = gap >= 0.03;

  if (!isStrongEnough || !isClearlyBetter) {
    return null;
  }

  return best;
}

function resolveOrigenColegioFromMatch(match) {
  if (!match?.entry) return "No cartera";
  return match.entry.hasOk ? "Cartera" : "Pendiente en cartera";
}

function applyCarteraInfoToPayload(payload, carteraCache, baseData = {}) {
  const merged = {
    ...(baseData || {}),
    ...(payload || {})
  };

  const colegio = normalizeText(merged.colegio || "");
  if (!colegio) {
    return autoResolveKnownPeople(payload);
  }

  const match = findBestCarteraMatch(colegio, carteraCache);

  if (!match?.entry) {
    payload.origenColegio = "No cartera";
    return autoResolveKnownPeople(payload);
  }

  payload.origenColegio = resolveOrigenColegioFromMatch(match);

  // El logo pertenece al colegio, no al alias ni al curso.
  // Si hay match por colegio, copiamos el logo aunque el estado sea pendiente.
  if (match.entry.logoColegioUrl) {
    payload.logoColegioUrl = match.entry.logoColegioUrl;
  }

  // Solo completamos vendedora/correo si la coincidencia es única y clara
  if (match.entry.matches === 1) {
    if (!normalizeText(payload.vendedora) && normalizeText(match.entry.vendedora)) {
      payload.vendedora = match.entry.vendedora;
    }

    if (!normalizeEmail(payload.vendedoraCorreo) && normalizeEmail(match.entry.vendedoraCorreo)) {
      payload.vendedoraCorreo = match.entry.vendedoraCorreo;
    }
  }

  return autoResolveKnownPeople(payload);
}

function hasImportedContent(value = "") {
  return normalizeSearch(value || "") !== "";
}

function normalizeCierreFicha(value = "") {
  const v = normalizeSearch(value || "");
  if (v.includes("cerrad")) return "cerrada";
  if (v.includes("abiert")) return "abierta";
  return String(value || "").trim();
}

function deriveFichaEstadoFromLegacy(payload = {}) {
  const signedV = hasImportedContent(payload.firmaVendedor);
  const signedS = hasImportedContent(payload.firmaSupervision);
  const signedA = hasImportedContent(payload.firmaAdministracion);
  const cierreNorm = normalizeCierreFicha(payload.cierre);

  if (cierreNorm === "cerrada" || signedA) return "autorizada_admin";
  if (signedS) return "revisada_jefa_ventas";
  if (signedV) return "lista_vendedor";

  return normalizeText(payload.fichaEstado || "") || "pendiente";
}

function applyLegacyWorkflowFields(payload = {}) {
  const hasRelevantLegacyData = [
    "fechaUltimoCambioEstado",
    "solicitudReserva",
    "observacionesOperaciones",
    "observacionesAdministracion",
    "asistenciaMed",
    "liberados",
    "valorPrograma",
    "autorizacionGerencia",
    "descuentoFicha",
    "versionFicha",
    "fechaActualizacionFicha",
    "observacionesFicha",
    "firmaVendedor",
    "firmaSupervision",
    "firmaAdministracion",
    "cierre",
    "numeroNegocio",
    "usuarioProgramaAdm",
    "claveAdministrativa"
  ].some((key) => key in payload);

  if (!hasRelevantLegacyData) {
    return payload;
  }

  const signedV = hasImportedContent(payload.firmaVendedor);
  const signedS = hasImportedContent(payload.firmaSupervision);
  const signedA = hasImportedContent(payload.firmaAdministracion);
  const cierreNorm = normalizeCierreFicha(payload.cierre);
  const isClosed = cierreNorm === "cerrada";
  const isAuthorized = isClosed || signedA;

  // Resumen de situación
  if ("fechaUltimoCambioEstado" in payload) {
    setNestedValue(payload, "situacion.fechaUltimoCambioEstado", payload.fechaUltimoCambioEstado);
  }

  if ("observacionesOperaciones" in payload) {
    setNestedValue(payload, "situacion.observacionOperaciones", payload.observacionesOperaciones || "");
  }

  if ("observacionesAdministracion" in payload) {
    setNestedValue(payload, "situacion.observacionAdministracion", payload.observacionesAdministracion || "");
  }

  // Bloque ficha
  if ("versionFicha" in payload) {
    setNestedValue(payload, "ficha.version", payload.versionFicha || "");
  }

  if ("fechaActualizacionFicha" in payload) {
    setNestedValue(payload, "ficha.fechaActualizacion", payload.fechaActualizacionFicha || "");
  }

  if ("observacionesFicha" in payload) {
    setNestedValue(payload, "ficha.observacionesGenerales", payload.observacionesFicha || "");
  }

  if ("autorizacionGerencia" in payload) {
    setNestedValue(payload, "ficha.autorizacionGerencia", payload.autorizacionGerencia || "");
  }

  if ("descuentoFicha" in payload) {
    setNestedValue(payload, "ficha.descuento", payload.descuentoFicha || "");
  }

  if ("asistenciaMed" in payload) {
    setNestedValue(payload, "ficha.asistenciaMed", payload.asistenciaMed || "");
  }

  if ("liberados" in payload) {
    setNestedValue(payload, "ficha.liberados", payload.liberados ?? "");
  }

  if ("valorPrograma" in payload) {
    setNestedValue(payload, "ficha.valorPrograma", payload.valorPrograma ?? "");
  }

  if ("numeroNegocio" in payload) {
    setNestedValue(payload, "ficha.numeroNegocio", payload.numeroNegocio ?? "");
  }

  if ("solicitudReserva" in payload) {
    setNestedValue(payload, "ficha.solicitudReserva", payload.solicitudReserva || "");
  }

  // Bloque administración
  if ("usuarioProgramaAdm" in payload) {
    setNestedValue(payload, "administracion.usuarioProgramaAdm", payload.usuarioProgramaAdm || "");
  }

  if ("claveAdministrativa" in payload) {
    setNestedValue(payload, "administracion.claveAdministrativa", payload.claveAdministrativa || "");
  }

  // Derivar resumen de ficha
  if (
    "firmaVendedor" in payload ||
    "firmaSupervision" in payload ||
    "firmaAdministracion" in payload ||
    "cierre" in payload ||
    !normalizeText(payload.fichaEstado || "")
  ) {
    payload.fichaEstado = deriveFichaEstadoFromLegacy(payload);
    setNestedValue(payload, "documentos.fichaGrupo.estado", payload.fichaEstado);
  }

  if ("cierre" in payload) {
    payload.cierre = cierreNorm || payload.cierre || "";
  }

  if ("cierre" in payload || "firmaAdministracion" in payload) {
    payload.cerrada = isClosed;
    payload.autorizada = isAuthorized;
  }

  // Flujo de firmas
  if (
    "firmaVendedor" in payload ||
    "firmaSupervision" in payload ||
    "firmaAdministracion" in payload ||
    "cierre" in payload
  ) {
    setNestedValue(payload, "flowFicha.habilitada", signedV || signedS || signedA || isAuthorized);
    setNestedValue(payload, "flowFicha.estado", payload.fichaEstado || "pendiente");
    setNestedValue(payload, "flowFicha.requiereRefirmaAdministracion", false);

    setNestedValue(payload, "flowFicha.vendedor.firmado", signedV);
    setNestedValue(payload, "flowFicha.vendedor.firmadoPor", payload.firmaVendedor || "");
    setNestedValue(payload, "flowFicha.vendedor.firmadoPorCorreo", "");
    setNestedValue(payload, "flowFicha.vendedor.observacion", "");

    setNestedValue(payload, "flowFicha.jefaVentas.firmado", signedS);
    setNestedValue(payload, "flowFicha.jefaVentas.firmadoPor", payload.firmaSupervision || "");
    setNestedValue(payload, "flowFicha.jefaVentas.firmadoPorCorreo", "");
    setNestedValue(payload, "flowFicha.jefaVentas.observacion", "");

    setNestedValue(payload, "flowFicha.administracion.firmado", signedA);
    setNestedValue(payload, "flowFicha.administracion.firmadoPor", payload.firmaAdministracion || "");
    setNestedValue(payload, "flowFicha.administracion.firmadoPorCorreo", "");
    setNestedValue(payload, "flowFicha.administracion.observacion", "");
  }

  return payload;
}

async function backfillOrigenColegioDesdeCartera() {
  if (!isAdminOnly()) return;

  try {
    setProgressStatus({
      text: "Completando origen colegio...",
      meta: "Leyendo cartera y registros existentes...",
      progress: 10
    });

    const carteraCache = await loadSchoolCarteraIndex(true);
    const pending = [];

    state.rowsRaw.forEach(({ id, data }) => {
      const currentData = data || {};
      const colegioActual = normalizeText(currentData.colegio || "");
      if (!colegioActual) return;

      const patch = {};
      applyCarteraInfoToPayload(patch, carteraCache, currentData);

      const origenNuevo = normalizeText(patch.origenColegio || "");
      const origenActual = normalizeText(currentData.origenColegio || "");

      const vendedoraNueva = normalizeText(patch.vendedora || "");
      const vendedoraActual = normalizeText(currentData.vendedora || "");

      const correoNuevo = normalizeEmail(patch.vendedoraCorreo || "");
      const correoActual = normalizeEmail(currentData.vendedoraCorreo || "");

      const changed =
        origenNuevo !== origenActual ||
        (!vendedoraActual && vendedoraNueva) ||
        (!correoActual && correoNuevo);

      if (!changed) return;

      pending.push({
        id,
        patch: {
          origenColegio: patch.origenColegio || "",
          ...(!vendedoraActual && vendedoraNueva ? { vendedora: patch.vendedora } : {}),
          ...(!correoActual && correoNuevo ? { vendedoraCorreo: patch.vendedoraCorreo } : {}),
          actualizadoPor: getNombreUsuario(state.effectiveUser),
          actualizadoPorCorreo: normalizeEmail(state.realUser?.email || ""),
          fechaActualizacion: serverTimestamp()
        }
      });
    });

    if (!pending.length) {
      setProgressStatus({
        text: "Backfill listo.",
        meta: "No había registros para actualizar.",
        progress: 100,
        type: "success"
      });
      clearProgressStatus({}, 2500);
      return;
    }

    let processed = 0;

    for (let i = 0; i < pending.length; i += WRITE_BATCH_LIMIT) {
      const chunk = pending.slice(i, i + WRITE_BATCH_LIMIT);
      const batch = writeBatch(db);

      chunk.forEach(({ id, patch }) => {
        batch.set(doc(db, "ventas_cotizaciones", id), patch, { merge: true });
      });

      await batch.commit();
      processed += chunk.length;

      setProgressStatus({
        text: "Completando origen colegio...",
        meta: `Procesados: ${processed}/${pending.length}`,
        progress: 20 + Math.round((processed / pending.length) * 80)
      });
    }

    setProgressStatus({
      text: "Backfill listo.",
      meta: `${pending.length} registro(s) actualizados.`,
      progress: 100,
      type: "success"
    });
    clearProgressStatus({}, 2500);

    await loadData();
  } catch (error) {
    console.error(error);
    setProgressStatus({
      text: "Error completando origen colegio.",
      meta: error.message || "No se pudo ejecutar el backfill.",
      progress: 100,
      type: "error"
    });
  }
}

async function backfillLogoColegioDesdeCartera() {
  if (!isAdminOnly()) return;

  try {
    setProgressStatus({
      text: "Completando logos de colegio...",
      meta: "Leyendo cartera y registros existentes...",
      progress: 10
    });

    const carteraCache = await loadSchoolCarteraIndex(true);
    const pending = [];

    state.rowsRaw.forEach(({ id, data }) => {
      const currentData = data || {};
      const colegioActual = normalizeText(currentData.colegio || "");
      if (!colegioActual) return;

      const patch = {};
      applyCarteraInfoToPayload(patch, carteraCache, currentData);

      const logoNuevo = String(patch.logoColegioUrl || "").trim();
      const logoActual = String(currentData.logoColegioUrl || "").trim();

      if (!logoNuevo) return;
      if (logoNuevo === logoActual) return;

      pending.push({
        id,
        patch: {
          logoColegioUrl: logoNuevo,
          actualizadoPor: getNombreUsuario(state.effectiveUser),
          actualizadoPorCorreo: normalizeEmail(state.realUser?.email || ""),
          fechaActualizacion: serverTimestamp()
        }
      });
    });

    if (!pending.length) {
      setProgressStatus({
        text: "Backfill listo.",
        meta: "No había logos para actualizar.",
        progress: 100,
        type: "success"
      });
      clearProgressStatus({}, 2500);
      return;
    }

    let processed = 0;

    for (let i = 0; i < pending.length; i += WRITE_BATCH_LIMIT) {
      const chunk = pending.slice(i, i + WRITE_BATCH_LIMIT);
      const batch = writeBatch(db);

      chunk.forEach(({ id, patch }) => {
        batch.set(doc(db, "ventas_cotizaciones", id), patch, { merge: true });
      });

      await batch.commit();
      processed += chunk.length;

      setProgressStatus({
        text: "Completando logos de colegio...",
        meta: `Procesados: ${processed}/${pending.length}`,
        progress: 20 + Math.round((processed / pending.length) * 80)
      });
    }

    setProgressStatus({
      text: "Backfill listo.",
      meta: `${pending.length} registro(s) actualizados.`,
      progress: 100,
      type: "success"
    });
    clearProgressStatus({}, 2500);

    await loadData();
  } catch (error) {
    console.error(error);
    setProgressStatus({
      text: "Error completando logos de colegio.",
      meta: error.message || "No se pudo ejecutar el backfill.",
      progress: 100,
      type: "error"
    });
  }
}

async function backfillVendedoraCorreoDesdeNombre({ overwriteExisting = false } = {}) {
  if (!isAdminOnly()) return;

  try {
    setProgressStatus({
      text: "Completando datos de vendedora.",
      meta: "Revisando registros existentes.",
      progress: 10
    });

    const pending = [];

    state.rowsRaw.forEach(({ id, data }) => {
      const currentData = data || {};

      const nombreActual = normalizeText(currentData.vendedora || "");
      const correoActual = normalizeEmail(currentData.vendedoraCorreo || "");

      let seller = null;

      // Prioridad 1:
      // si hay correo, usarlo como fuente principal de verdad
      if (correoActual) {
        seller = resolveVentasUserByEmail(correoActual);
      }

      // Prioridad 2:
      // si no resolvió por correo, intentar por nombre actual
      if (!seller && nombreActual) {
        seller = resolveVentasUserByName(nombreActual);
      }

      if (!seller) return;

      const nombreNuevo = getDisplayName(seller) || nombreActual;
      const correoNuevo = normalizeEmail(seller.email || "") || correoActual;

      const shouldUpdateNombre =
        !!nombreNuevo &&
        (
          overwriteExisting
            ? nombreNuevo !== nombreActual
            : !nombreActual
        );

      const shouldUpdateCorreo =
        !!correoNuevo &&
        (
          overwriteExisting
            ? correoNuevo !== correoActual
            : !correoActual
        );

      if (!shouldUpdateNombre && !shouldUpdateCorreo) return;

      pending.push({
        id,
        patch: {
          ...(shouldUpdateNombre ? { vendedora: nombreNuevo } : {}),
          ...(shouldUpdateCorreo ? { vendedoraCorreo: correoNuevo } : {}),
          actualizadoPor: getNombreUsuario(state.effectiveUser),
          actualizadoPorCorreo: normalizeEmail(state.realUser?.email || ""),
          fechaActualizacion: serverTimestamp()
        }
      });
    });

    if (!pending.length) {
      setProgressStatus({
        text: "Backfill listo.",
        meta: "No había registros para actualizar.",
        progress: 100,
        type: "success"
      });
      clearProgressStatus({}, 2500);
      return;
    }

    let processed = 0;

    for (let i = 0; i < pending.length; i += WRITE_BATCH_LIMIT) {
      const chunk = pending.slice(i, i + WRITE_BATCH_LIMIT);
      const batch = writeBatch(db);

      chunk.forEach(({ id, patch }) => {
        batch.set(doc(db, "ventas_cotizaciones", id), patch, { merge: true });
      });

      await batch.commit();
      processed += chunk.length;

      setProgressStatus({
        text: "Completando datos de vendedora.",
        meta: `Procesados: ${processed}/${pending.length}`,
        progress: 20 + Math.round((processed / pending.length) * 80)
      });
    }

    setProgressStatus({
      text: "Backfill listo.",
      meta: `${pending.length} registro(s) actualizados.`,
      progress: 100,
      type: "success"
    });
    clearProgressStatus({}, 2500);

    await loadData();
  } catch (error) {
    console.error(error);
    setProgressStatus({
      text: "Error completando datos de vendedora.",
      meta: error.message || "No se pudo ejecutar el backfill.",
      progress: 100,
      type: "error"
    });
  }
}

function normalizeCursoForAlias(value = "") {
  return normalizeText(value).toUpperCase().replace(/\s+/g, "");
}

function hasValidCursoFormatForAlias(value = "") {
  const curso = normalizeCursoForAlias(value);

  // Válidos:
  // 1 a 8   -> básica / media tradicional
  // 9 a 11  -> colegios con sistema americano
  // Puede venir solo número o número + letras
  // Ej: 4, 4A, 8DAVINCI, 9, 10A, 11DAVINCI
  return /^(?:11|10|[1-9])[A-Z]*$/.test(curso);
}

function getYearFromValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;

  const raw = normalizeText(value);
  const match = raw.match(/\d{4}/);
  if (!match) return null;

  const year = Number(match[0]);
  return Number.isFinite(year) ? year : null;
}

function getAnoBaseForAlias(data = {}, fallbackYear = getCurrentYear()) {
  const explicit = getYearFromValue(data.anoBaseCurso);
  if (explicit) return explicit;

  const created = timestampToDate(data.fechaCreacion);
  if (created && Number.isFinite(created.getFullYear())) {
    return created.getFullYear();
  }

  const updated = timestampToDate(data.fechaActualizacion);
  if (updated && Number.isFinite(updated.getFullYear())) {
    return updated.getFullYear();
  }

  const fallback = getYearFromValue(fallbackYear);
  if (fallback) return fallback;

  const tripYear = getYearFromValue(data.anoViaje);
  if (tripYear) return tripYear;

  return getCurrentYear();
}

function extractCursoNumberForAlias(value = "") {
  const match = normalizeCursoForAlias(value).match(/^(11|10|[1-9])/);
  return match ? Number(match[1]) : null;
}

function extractCursoSuffixForAlias(value = "") {
  const match = normalizeCursoForAlias(value).match(/^(?:11|10|[1-9])(.*)$/);
  return match ? match[1] : "";
}

function getNextCursoNumberForAlias(currentNumber) {
  if (currentNumber >= 1 && currentNumber <= 7) return currentNumber + 1;
  if (currentNumber === 8) return 1;

  if (currentNumber === 9) return 10;
  if (currentNumber === 10) return 11;

  // Por ahora 11 queda en 11.
  // Si después quieres otra regla, se cambia aquí.
  if (currentNumber === 11) return 11;

  return null;
}

function projectCursoForAlias(cursoBase = "", anoBase = null, anoViaje = null) {
  const baseCurso = normalizeCursoForAlias(cursoBase);
  const baseNumber = extractCursoNumberForAlias(baseCurso);
  const suffix = extractCursoSuffixForAlias(baseCurso);

  if (!baseCurso || baseNumber === null) return "";
  if (!Number.isFinite(Number(anoBase)) || !Number.isFinite(Number(anoViaje))) return "";

  let projected = baseNumber;
  const diff = Number(anoViaje) - Number(anoBase);

  if (diff < 0) return "";

  for (let i = 0; i < diff; i += 1) {
    const next = getNextCursoNumberForAlias(projected);
    if (next === null) return "";
    projected = next;
  }

  return `${projected}${suffix}`;
}

function buildAliasTripKeyForRow({ colegio = "", cursoViaje = "", anoViaje = "" } = {}) {
  return normalizeSearch(
    `${normalizeText(colegio)}__${normalizeCursoForAlias(cursoViaje)}__${normalizeText(anoViaje)}`
  );
}

function deriveCursoAliasFields(data = {}, fallbackYear = getCurrentYear()) {
  const colegio = normalizeText(data.colegio || "");
  const cursoBase = normalizeCursoForAlias(data.curso || "");
  const anoViaje = getYearFromValue(data.anoViaje);

  if (!colegio || !cursoBase || !anoViaje) return {};
  if (!hasValidCursoFormatForAlias(cursoBase)) return {};

  const anoBase = getAnoBaseForAlias(data, fallbackYear);
  const cursoViaje = normalizeCursoForAlias(
    data.cursoViaje || projectCursoForAlias(cursoBase, anoBase, anoViaje)
  );

  if (!cursoViaje) return {};

  const aliasGrupo =
    Number(anoBase) === Number(anoViaje)
      ? `${cursoBase} (${anoBase}) ${colegio}`.trim()
      : `${cursoBase} (${anoBase}) ${cursoViaje} (${anoViaje}) ${colegio}`.trim();

  const aliasTripKey = buildAliasTripKeyForRow({
    colegio,
    cursoViaje,
    anoViaje
  });

  return {
    curso: cursoBase,
    anoBaseCurso: String(anoBase),
    cursoViaje,
    aliasGrupo,
    aliasTripKey
  };
}

function buildAliasGrupoForRow(data = {}, fallbackYear = getCurrentYear()) {
  return deriveCursoAliasFields(data, fallbackYear).aliasGrupo || "";
}

function buildTripKeyFromExistingDoc(data = {}, fallbackYear = getCurrentYear()) {
  const explicit = normalizeText(data.aliasTripKey || "");
  if (explicit) return normalizeSearch(explicit);

  return normalizeSearch(
    deriveCursoAliasFields(data, fallbackYear).aliasTripKey || ""
  );
}

async function backfillCursoAliasTripKey() {
  if (!isAdminOnly()) return;

  try {
    setProgressStatus({
      text: "Corrigiendo curso y alias...",
      meta: "Preparando recálculo...",
      progress: 10
    });

    const derivedMap = new Map();
    const tripKeyOwners = new Map();
    const conflicts = [];

    state.rowsRaw.forEach(({ id, data }) => {
      const currentData = data || {};
      const derived = deriveCursoAliasFields(currentData, getAnoBaseForAlias(currentData));

      if (!Object.keys(derived).length) return;

      derivedMap.set(String(id), derived);

      const tripKey = normalizeText(derived.aliasTripKey || "");
      if (!tripKey) return;

      const prevOwner = tripKeyOwners.get(tripKey);
      if (prevOwner && prevOwner !== String(id)) {
        conflicts.push({
          tripKey,
          firstId: prevOwner,
          secondId: String(id)
        });
        return;
      }

      tripKeyOwners.set(tripKey, String(id));
    });

    if (conflicts.length) {
      const preview = conflicts
        .slice(0, 5)
        .map(c => `${c.tripKey} [${c.firstId} / ${c.secondId}]`)
        .join(" · ");

      throw new Error(
        `Se detectaron conflictos de aliasTripKey al recalcular cursos. Revisa primero estos casos: ${preview}`
      );
    }

    const pending = [];

    state.rowsRaw.forEach(({ id, data }) => {
      const currentData = data || {};
      const derived = derivedMap.get(String(id));
      if (!derived) return;

      const patch = {};

      ["curso", "anoBaseCurso", "cursoViaje", "aliasGrupo", "aliasTripKey"].forEach((key) => {
        const currentValue = normalizeText(currentData[key] ?? "");
        const nextValue = normalizeText(derived[key] ?? "");

        if (currentValue !== nextValue) {
          patch[key] = derived[key];
        }
      });

      if (!Object.keys(patch).length) return;

      pending.push({
        id,
        patch: {
          ...patch,
          actualizadoPor: getNombreUsuario(state.effectiveUser),
          actualizadoPorCorreo: normalizeEmail(state.realUser?.email || ""),
          fechaActualizacion: serverTimestamp()
        }
      });
    });

    if (!pending.length) {
      setProgressStatus({
        text: "Backfill listo.",
        meta: "No había registros para actualizar.",
        progress: 100,
        type: "success"
      });
      clearProgressStatus({}, 2500);
      return;
    }

    let processed = 0;

    for (let i = 0; i < pending.length; i += WRITE_BATCH_LIMIT) {
      const chunk = pending.slice(i, i + WRITE_BATCH_LIMIT);
      const batch = writeBatch(db);

      chunk.forEach(({ id, patch }) => {
        batch.set(doc(db, "ventas_cotizaciones", String(id)), patch, { merge: true });
      });

      await batch.commit();
      processed += chunk.length;

      setProgressStatus({
        text: "Corrigiendo curso y alias...",
        meta: `Procesados: ${processed}/${pending.length}`,
        progress: 20 + Math.round((processed / pending.length) * 80)
      });
    }

    setProgressStatus({
      text: "Backfill listo.",
      meta: `${pending.length} registro(s) actualizados.`,
      progress: 100,
      type: "success"
    });
    clearProgressStatus({}, 2500);

    await loadData();
  } catch (error) {
    console.error(error);
    setProgressStatus({
      text: "Error corrigiendo curso y alias.",
      meta: error.message || "No se pudo ejecutar el backfill.",
      progress: 100,
      type: "error"
    });
  }
}

async function backfillAliasGrupo() {
  return backfillCursoAliasTripKey();
}

async function backfillLegacyVentas() {
  if (!isAdminOnly()) return;

  try {
    setProgressStatus({
      text: "Marcando base como legacy...",
      meta: "Leyendo registros existentes...",
      progress: 10
    });

    const pending = [];

    state.rowsRaw.forEach(({ id, data }) => {
      const currentData = data || {};
      const flowFicha = currentData.flowFicha || {};
      const ficha = currentData.ficha || {};

      const modoActualRaiz = normalizeText(currentData.fichaFlujoModo || "");
      const modoActualFlow = normalizeText(flowFicha.modo || "");
      const modoActualFicha = normalizeText(ficha.flujoModo || "");

      // Si ya tiene modo definido, no lo tocamos
      if (modoActualRaiz || modoActualFlow || modoActualFicha) return;

      const pdfExistente = normalizeText(
        currentData.fichaPdfUrl ||
        ficha.pdfUrl ||
        ficha.urlPdf ||
        ""
      );

      const firmadoVendedor = !!flowFicha?.vendedor?.firmado || normalizeText(currentData.firmaVendedor || "") !== "";
      const firmadoJefa = !!flowFicha?.jefaVentas?.firmado || normalizeText(currentData.firmaSupervision || "") !== "";
      const firmadoAdmin = !!flowFicha?.administracion?.firmado || normalizeText(currentData.firmaAdministracion || "") !== "";

      const patch = {
        fichaFlujoModo: "legacy",
        legacyMigrado: true,
        legacyMigradoAt: serverTimestamp(),
        legacyMigradoPor: getNombreUsuario(state.effectiveUser),
        legacyMigradoPorCorreo: normalizeEmail(state.realUser?.email || ""),

        flowFicha: {
          ...(flowFicha || {}),
          modo: "legacy",
          legacy: true,
          bloqueadaParaVendedor: firmadoVendedor,
          requiereActualizacion: false,

          vendedor: {
            ...(flowFicha.vendedor || {}),
            firmado: firmadoVendedor
          },

          jefaVentas: {
            ...(flowFicha.jefaVentas || {}),
            firmado: firmadoJefa
          },

          administracion: {
            ...(flowFicha.administracion || {}),
            firmado: firmadoAdmin
          }
        },

        ficha: {
          ...(ficha || {}),
          flujoModo: "legacy",
          pdfPendienteLegacy: !pdfExistente
        },

        actualizadoPor: getNombreUsuario(state.effectiveUser),
        actualizadoPorCorreo: normalizeEmail(state.realUser?.email || ""),
        fechaActualizacion: serverTimestamp()
      };

      pending.push({ id, patch });
    });

    if (!pending.length) {
      setProgressStatus({
        text: "Backfill legacy listo.",
        meta: "No había registros para actualizar.",
        progress: 100,
        type: "success"
      });
      clearProgressStatus({}, 2500);
      return;
    }

    let processed = 0;

    for (let i = 0; i < pending.length; i += WRITE_BATCH_LIMIT) {
      const chunk = pending.slice(i, i + WRITE_BATCH_LIMIT);
      const batch = writeBatch(db);

      chunk.forEach(({ id, patch }) => {
        batch.set(doc(db, "ventas_cotizaciones", id), patch, { merge: true });
      });

      await batch.commit();
      processed += chunk.length;

      setProgressStatus({
        text: "Marcando base como legacy...",
        meta: `Procesados: ${processed}/${pending.length}`,
        progress: 20 + Math.round((processed / pending.length) * 80)
      });
    }

    setProgressStatus({
      text: "Backfill legacy listo.",
      meta: `${pending.length} registro(s) actualizados.`,
      progress: 100,
      type: "success"
    });
    clearProgressStatus({}, 2500);

    await loadData();
  } catch (error) {
    console.error(error);
    setProgressStatus({
      text: "Error marcando legacy.",
      meta: error.message || "No se pudo ejecutar el backfill legacy.",
      progress: 100,
      type: "error"
    });
  }
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
    ...[...keySet]
      .filter(k => !BASE_COLUMNS.includes(k) && !HIDDEN_DYNAMIC_KEYS.has(k))
      .sort((a, b) => a.localeCompare(b, "es"))
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

  if (state.filters.cartera) {
    rows = rows.filter(r => getCarteraBucket(r) === state.filters.cartera);
  }

  const q = normalizeSearch(state.search);
  if (q) {
    rows = rows.filter(r => getSearchTarget(r).includes(q));
  }

  state.filteredRows = rows;
  state.currentPage = 1; // cada filtro vuelve a la primera página
  updateArchiveButton();
  renderTable();
}

/* =========================================================
   TABLA DINÁMICA
========================================================= */
function getDisplayColumns() {
  return state.allKeys;
}

function getSortValue(row, key) {
  const raw = valueToString(row?.[key] ?? "").trim();

  if (!raw) {
    return { empty: true, num: null, text: "" };
  }

  if (["idGrupo", "anoViaje", "cantidadGrupo"].includes(key)) {
    const numericOnly = String(raw).replace(/[^\d.-]/g, "");
    const num = Number(numericOnly);
    if (Number.isFinite(num)) {
      return { empty: false, num, text: raw };
    }
  }

  if (/^-?\d+(?:[.,]\d+)?$/.test(raw)) {
    const num = Number(raw.replace(",", "."));
    if (Number.isFinite(num)) {
      return { empty: false, num, text: raw };
    }
  }

  return {
    empty: false,
    num: null,
    text: normalizeText(raw).toLocaleLowerCase("es-CL")
  };
}

function getSortedRows(rows = []) {
  const sortKey = state.sort.key || "idGrupo";
  const dir = state.sort.dir === "asc" ? 1 : -1;

  return [...rows].sort((a, b) => {
    const av = getSortValue(a, sortKey);
    const bv = getSortValue(b, sortKey);

    if (av.empty && bv.empty) return 0;
    if (av.empty) return 1;
    if (bv.empty) return -1;

    if (av.num !== null && bv.num !== null && av.num !== bv.num) {
      return (av.num - bv.num) * dir;
    }

    const cmp = av.text.localeCompare(bv.text, "es", {
      numeric: true,
      sensitivity: "base"
    });

    if (cmp !== 0) {
      return cmp * dir;
    }

    // desempate estable por ID Grupo de mayor a menor
    const aId = Number(String(a.idGrupo || "").replace(/[^\d.-]/g, "")) || 0;
    const bId = Number(String(b.idGrupo || "").replace(/[^\d.-]/g, "")) || 0;
    return bId - aId;
  });
}

function getPaginationData(rows = []) {
  const sortedRows = getSortedRows(rows);

  if (state.pageSize === "all") {
    state.currentPage = 1;
    return {
      sortedRows,
      pageRows: sortedRows,
      totalPages: sortedRows.length ? 1 : 1
    };
  }

  const pageSize = Number(state.pageSize) || 8;
  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize));

  if (state.currentPage < 1) state.currentPage = 1;
  if (state.currentPage > totalPages) state.currentPage = totalPages;

  const start = (state.currentPage - 1) * pageSize;
  const pageRows = sortedRows.slice(start, start + pageSize);

  return {
    sortedRows,
    pageRows,
    totalPages
  };
}

function renderPaginationControls(totalFiltered, totalPages) {
  const pageSizeSelect = $("pageSizeSelect");
  const btnPrevPage = $("btnPrevPage");
  const btnNextPage = $("btnNextPage");
  const pageIndicator = $("pageIndicator");

  if (pageSizeSelect) {
    pageSizeSelect.value = String(state.pageSize);
  }

  const showingAll = state.pageSize === "all";

  if (pageIndicator) {
    if (!totalFiltered) {
      pageIndicator.textContent = "Página 0 de 0";
    } else if (showingAll) {
      pageIndicator.textContent = `Todos (${totalFiltered})`;
    } else {
      pageIndicator.textContent = `Página ${state.currentPage} de ${totalPages}`;
    }
  }

  if (btnPrevPage) {
    btnPrevPage.disabled = !totalFiltered || showingAll || state.currentPage <= 1;
  }

  if (btnNextPage) {
    btnNextPage.disabled = !totalFiltered || showingAll || state.currentPage >= totalPages;
  }
}

function renderTable() {
  const thead = $("theadClientes");
  const tbody = $("tbodyClientes");
  const empty = $("emptyState");
  const summary = $("tableSummary");

  if (!thead || !tbody || !empty || !summary) return;

  const columns = getDisplayColumns();
  const canAdmin = isAdminOnly();

  const { sortedRows, pageRows, totalPages } = getPaginationData(state.filteredRows);
  state.pageRows = pageRows;

  summary.textContent = `${pageRows.length} registro(s) mostrados · ${sortedRows.length} filtrados · ${state.rowsFlat.length} total`;

  renderPaginationControls(sortedRows.length, totalPages);

  thead.innerHTML = `
    <tr>
      ${canAdmin ? `
        <th class="check-col">
          <input id="checkAllRows" type="checkbox" />
        </th>
      ` : ""}
      ${columns.map((key) => {
        const isActive = state.sort.key === key;
        const arrow = isActive
          ? (state.sort.dir === "asc" ? "↑" : "↓")
          : "↕";

        return `
          <th>
            <button
              class="th-sort ${isActive ? "active" : ""}"
              type="button"
              data-action="sort"
              data-key="${escapeHtml(key)}"
            >
              <span>${escapeHtml(prettifyFieldKey(key))}</span>
              <span class="sort-arrow" aria-hidden="true">${arrow}</span>
            </button>
          </th>
        `;
      }).join("")}
      <th class="actions-col">ACCIONES</th>
    </tr>
  `;

  if (!sortedRows.length) {
    state.pageRows = [];
    tbody.innerHTML = "";
    empty.classList.remove("hidden");
    renderPaginationControls(0, 1);

    const btnDelete = $("btnEliminarSeleccionados");
    if (btnDelete) {
      btnDelete.disabled = state.selectedKeys.size === 0;
    }

    return;
  }

  empty.classList.add("hidden");

  tbody.innerHTML = pageRows.map((row) => {
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
    const visibleKeys = pageRows.map(buildRowKey);
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

  const carteraCache = await loadSchoolCarteraIndex(true);
  autoResolveKnownPeople(payload);
  applyCarteraInfoToPayload(payload, carteraCache, raw.data || {});

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

function getMaxSequentialIdFromRows(rowsRaw = []) {
  let maxId = 10935;

  rowsRaw.forEach(({ id, data }) => {
    const candidates = [
      String(id || "").trim(),
      String(data?.idGrupo || "").trim()
    ];

    candidates.forEach((candidate) => {
      if (/^\d+$/.test(candidate)) {
        maxId = Math.max(maxId, Number(candidate));
      }
    });
  });

  return maxId;
}

function buildCodeIndex(rowsRaw = []) {
  const index = new Map();

  rowsRaw.forEach(({ id, data }) => {
    const code = normalizeText(data?.codigoRegistro || "");
    if (code) index.set(code, String(id));
  });

  return index;
}

function buildAliasIndex(rowsRaw = [], fallbackYear = getCurrentYear()) {
  const index = new Map();

  rowsRaw.forEach(({ id, data }) => {
    const tripKey = buildTripKeyFromExistingDoc(data || {}, fallbackYear);
    if (tripKey) {
      index.set(normalizeText(tripKey), String(id));
    }
  });

  return index;
}

function rowToFieldPayload(rowObj, carteraCache = { byExact: new Map(), entries: [] }, fallbackAnoBase = getCurrentYear()) {
  const payload = {};

  Object.entries(rowObj).forEach(([rawKey, rawValue]) => {
    const key = sanitizeImportKey(rawKey);
    if (!key) return;
    if (IMPORT_IGNORE_KEYS.has(key)) return;

    const value = parseImportedValue(key, rawValue);
    setNestedValue(payload, key, value);
  });

  autoResolveKnownPeople(payload);
  applyCarteraInfoToPayload(payload, carteraCache);
  applyLegacyWorkflowFields(payload);

  // Si la fila trae curso/colegio/año, recalculamos campos derivados
  Object.assign(payload, deriveCursoAliasFields(payload, fallbackAnoBase));

  return payload;
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
      text: "Importando XLSX.",
      meta: "Leyendo archivo.",
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
        text: "Importando XLSX.",
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

    const importBaseYear = getCurrentYear();
    const codeIndex = buildCodeIndex(state.rowsRaw);
    const aliasIndex = buildAliasIndex(state.rowsRaw, importBaseYear);

    // Leemos la cartera fresca en cada import
    const carteraCache = await loadSchoolCarteraIndex(true);

    let nextSequentialId = getMaxSequentialIdFromRows(state.rowsRaw) + 1;

    let createdCount = 0;
    let updatedCount = 0;
    let processed = 0;

    for (const rowObj of rawRows) {
      const payload = rowToFieldPayload(rowObj, carteraCache, importBaseYear);
      const existingId = findExistingDocId(payload, codeIndex);

      let ref;
      let isNew = false;

      if (existingId) {
        ref = doc(db, "ventas_cotizaciones", String(existingId));
      } else {
        const newSequentialId = String(nextSequentialId++);
        payload.idGrupo = newSequentialId;
        ref = doc(db, "ventas_cotizaciones", newSequentialId);
        isNew = true;
      }

      const snap = await getDoc(ref);
      const currentData = snap.exists() ? (snap.data() || {}) : {};

      const mergedForDerivation = {
        ...currentData,
        ...payload
      };

      const derived = deriveCursoAliasFields(
        mergedForDerivation,
        getAnoBaseForAlias(mergedForDerivation, importBaseYear)
      );

      const finalPayload = {
        ...payload,
        ...derived,
        idGrupo: normalizeText(payload.idGrupo || currentData.idGrupo || ref.id),
        actualizadoPor: getNombreUsuario(state.effectiveUser),
        actualizadoPorCorreo: normalizeEmail(state.realUser?.email || ""),
        fechaActualizacion: serverTimestamp()
      };

      finalPayload.codigoRegistro =
        normalizeText(finalPayload.codigoRegistro) ||
        normalizeText(currentData.codigoRegistro) ||
        buildCodigoRegistro(finalPayload.idGrupo);

      if (!normalizeText(finalPayload.anoBaseCurso)) {
        finalPayload.anoBaseCurso = String(
          getAnoBaseForAlias(finalPayload, importBaseYear)
        );
      }

      const nextTripKey = normalizeText(finalPayload.aliasTripKey || "");
      const previousTripKey = buildTripKeyFromExistingDoc(currentData, importBaseYear);
      const ownerId = nextTripKey ? aliasIndex.get(nextTripKey) : "";

      if (nextTripKey && ownerId && String(ownerId) !== String(ref.id)) {
        throw new Error(
          `Conflicto al importar: ya existe un grupo para ${finalPayload.cursoViaje || finalPayload.curso} (${finalPayload.anoViaje}) en ${finalPayload.colegio}.`
        );
      }

      if (isNew || !snap.exists()) {
        finalPayload.creadoPor = getNombreUsuario(state.effectiveUser);
        finalPayload.creadoPorCorreo = normalizeEmail(state.realUser?.email || "");
        finalPayload.fechaCreacion = serverTimestamp();

        await setDoc(ref, finalPayload, { merge: true });
        createdCount += 1;
      } else {
        await setDoc(ref, finalPayload, { merge: true });
        updatedCount += 1;
      }

      if (
        previousTripKey &&
        previousTripKey !== nextTripKey &&
        aliasIndex.get(previousTripKey) === String(ref.id)
      ) {
        aliasIndex.delete(previousTripKey);
      }

      if (nextTripKey) {
        aliasIndex.set(nextTripKey, String(ref.id));
      }

      const finalCode = normalizeText(finalPayload.codigoRegistro || "");
      if (finalCode) {
        codeIndex.set(finalCode, String(ref.id));
      }

      processed += 1;
      const pct = 35 + Math.round((processed / rawRows.length) * 65);
      setProgressStatus({
        text: "Importando XLSX.",
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
  const filterCartera = $("filterCartera");
  const btnRecargar = $("btnRecargar");
  const btnEliminarSeleccionados = $("btnEliminarSeleccionados");
  const fileInputXlsx = $("fileInputXlsx");
  const btnPlantilla = $("btnPlantilla");
  const btnVerAnteriores = $("btnVerAnteriores");
  const btnExportar = $("btnExportar");
  const pageSizeSelect = $("pageSizeSelect");
  const btnPrevPage = $("btnPrevPage");
  const btnNextPage = $("btnNextPage");
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

  if (filterCartera && !filterCartera.dataset.bound) {
    filterCartera.dataset.bound = "1";
    filterCartera.addEventListener("change", (e) => {
      state.filters.cartera = e.target.value || "";
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

  if (pageSizeSelect && !pageSizeSelect.dataset.bound) {
    pageSizeSelect.dataset.bound = "1";
    pageSizeSelect.addEventListener("change", (e) => {
      const value = e.target.value || "8";
      state.pageSize = value === "all" ? "all" : (Number(value) || 8);
      state.currentPage = 1;
      renderTable();
    });
  }

  if (btnPrevPage && !btnPrevPage.dataset.bound) {
    btnPrevPage.dataset.bound = "1";
    btnPrevPage.addEventListener("click", () => {
      if (state.pageSize === "all") return;
      if (state.currentPage <= 1) return;
      state.currentPage -= 1;
      renderTable();
    });
  }

  if (btnNextPage && !btnNextPage.dataset.bound) {
    btnNextPage.dataset.bound = "1";
    btnNextPage.addEventListener("click", () => {
      if (state.pageSize === "all") return;

      const pageSize = Number(state.pageSize) || 8;
      const totalPages = Math.max(1, Math.ceil(state.filteredRows.length / pageSize));

      if (state.currentPage >= totalPages) return;
      state.currentPage += 1;
      renderTable();
    });
  }

  if (thead && !thead.dataset.bound) {
    thead.dataset.bound = "1";

    thead.addEventListener("click", (e) => {
      const target = e.target instanceof Element ? e.target : null;
      if (!target) return;

      const sortBtn = target.closest('button[data-action="sort"]');
      if (!sortBtn) return;

      const key = sortBtn.dataset.key || "";
      if (!key) return;

      if (state.sort.key === key) {
        state.sort.dir = state.sort.dir === "asc" ? "desc" : "asc";
      } else {
        state.sort.key = key;
        state.sort.dir = key === "idGrupo" ? "desc" : "asc";
      }

      state.currentPage = 1;
      renderTable();
    });

    thead.addEventListener("change", (e) => {
      if (!isAdminOnly()) return;

      const target = e.target;
      if (!(target instanceof HTMLInputElement)) return;
      if (target.id !== "checkAllRows") return;

      const checked = !!target.checked;

      state.pageRows.forEach((row) => {
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

  bindPageEvents();

  onAuthStateChanged(auth, async (user) => {
    if (!user) return;

    await bootstrapFromSession();
    if (!assertAccess()) return;

    setHeaderAndScope();
    await loadData();
  });
}

window.backfillCursoAliasTripKey = backfillCursoAliasTripKey;
window.backfillAliasGrupo = backfillAliasGrupo;

window.backfillOrigenColegioDesdeCartera = backfillOrigenColegioDesdeCartera;
window.backfillVendedoraCorreoDesdeNombre = backfillVendedoraCorreoDesdeNombre;
window.backfillAliasGrupo = backfillAliasGrupo;
window.backfillLogoColegioDesdeCartera = backfillLogoColegioDesdeCartera;
window.backfillLegacyVentas = backfillLegacyVentas;


initPage();
