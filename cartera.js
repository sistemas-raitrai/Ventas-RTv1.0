import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.7.3/firebase-auth.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  writeBatch,
  serverTimestamp,
  query,
  orderBy,
  limit
} from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";

import {
  getStorage,
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
  deleteObject
} from "https://www.gstatic.com/firebasejs/11.7.3/firebase-storage.js";

import { auth, db, VENTAS_USERS, getVentasUserEmails } from "./firebase-init.js";

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
  getVendorUsers,
  canManageVentasRole,
  canObserveOnlyRole,
  isVendedorRole
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
const WRITE_BATCH_LIMIT = 400;
const storage = getStorage();

/* =========================================================
   ESTADO
========================================================= */
const state = {
  realUser: null,
  effectiveUser: null,
  rows: [],
  quoteRows: [],
  filteredRows: [],
  pageRows: [],
  vendorFilter: "",
  statusFilter: "ok",
  trabajoFilter: "all",
  includePastYears: false,
  search: "",
  modalMode: "create",
  editingOriginal: null,
  vendors: [],
  selectedKeys: new Set(),
  pendingLogoFile: null,
  removeCurrentLogo: false,
  logoPreviewObjectUrl: "",
  pageSize: 8,
  currentPage: 1,
  sort: {
    key: "numeroColegio",
    dir: "asc"
  }
};

/* =========================================================
   HELPERS
========================================================= */
function getRoleHintText() {
  if (canManageVentasRole(state.effectiveUser)) return "Modo gestión";
  if (canObserveOnlyRole(state.effectiveUser)) return "Modo observador";
  return "Vista del vendedor(a)";
}

function getVendorNameByEmail(email = "") {
  const seller = state.vendors.find(v => normalizeEmail(v.email) === normalizeEmail(email));
  return seller ? `${seller.nombre} ${seller.apellido}`.trim() : email;
}

function toDateValue(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value?.toDate === "function") {
    const d = value.toDate();
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === "string") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function formatDateOnly(value) {
  const d = toDateValue(value);
  if (!d) return "";
  return d.toLocaleDateString("es-CL");
}

function normalizeSchoolKey(value = "") {
  return normalizeSearch(value)
    .replace(/\b(colegio|liceo|escuela|school|instituto|centro|educacional)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseMaybeJson(value, fallback = null) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return value;
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function normalizePhoneLoose(value = "") {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith("56")) digits = digits.slice(2);
  if (digits.startsWith("9")) digits = digits.slice(1);
  return digits.slice(-8);
}

function stringifyContact(contact = {}) {
  const parts = [
    normalizeText(contact.nombre || ""),
    normalizeText(contact.rol || ""),
    normalizeText(contact.correo || ""),
    normalizeText(contact.telefono || ""),
    normalizeText(contact.nivel || ""),
    normalizeText(contact.curso || ""),
    normalizeText(contact.observaciones || "")
  ].filter(Boolean);

  return parts.join(" · ");
}

function buildContact(nombre = "", rol = "", correo = "", telefono = "") {
  return {
    nombre: normalizeText(nombre),
    rol: normalizeText(rol),
    correo: normalizeEmail(correo),
    telefono: normalizeText(telefono)
  };
}

function createEmptyContact() {
  return {
    nombre: "",
    rol: "",
    correo: "",
    telefono: "",
    nivel: "",
    curso: "",
    observaciones: ""
  };
}

function normalizeContactItem(contact = {}) {
  return {
    nombre: normalizeText(contact.nombre || ""),
    rol: normalizeText(contact.rol || ""),
    correo: normalizeEmail(contact.correo || ""),
    telefono: normalizeText(contact.telefono || ""),
    nivel: normalizeText(contact.nivel || ""),
    curso: normalizeText(contact.curso || "").toUpperCase(),
    observaciones: normalizeText(contact.observaciones || "")
  };
}

function renderContactos(contactos = []) {
  const container = $("contactosContainer");
  if (!container) return;

  const safeContacts = Array.isArray(contactos) && contactos.length
    ? contactos.map(normalizeContactItem)
    : [createEmptyContact()];

  container.innerHTML = safeContacts.map((contact, index) => `
    <div class="contacto-item" data-index="${index}">
      <div class="contacto-item-head">
        <strong>Contacto ${index + 1}</strong>
        <button type="button" class="btn-mini delete" data-action="remove-contact">
          Eliminar
        </button>
      </div>

      <div class="contacto-grid">
        <div class="modal-field">
          <label>Nombre</label>
          <input type="text" class="contacto-nombre" value="${escapeHtml(contact.nombre)}" />
        </div>

        <div class="modal-field">
          <label>Rol / cargo</label>
          <select class="contacto-rol">
            <option value="">Seleccionar</option>
            <option value="APODERADO" ${contact.rol === "APODERADO" ? "selected" : ""}>APODERADO</option>
            <option value="PROFESOR" ${contact.rol === "PROFESOR" ? "selected" : ""}>PROFESOR</option>
            <option value="DIRECTIVO" ${contact.rol === "DIRECTIVO" ? "selected" : ""}>DIRECTIVO</option>
            <option value="OTRO" ${contact.rol === "OTRO" ? "selected" : ""}>OTRO</option>
          </select>
        </div>

        <div class="modal-field">
          <label>Correo</label>
          <input type="email" class="contacto-correo" value="${escapeHtml(contact.correo)}" />
        </div>

        <div class="modal-field">
          <label>Teléfono</label>
          <input type="text" class="contacto-telefono" value="${escapeHtml(contact.telefono)}" />
        </div>

        <div class="modal-field">
          <label>Nivel</label>
          <input type="text" class="contacto-nivel" placeholder="Ej: 3, 4, director" value="${escapeHtml(contact.nivel)}" />
        </div>

        <div class="modal-field">
          <label>Curso / letra</label>
          <input type="text" class="contacto-curso" placeholder="Ej: A, B, C" value="${escapeHtml(contact.curso)}" />
        </div>

        <div class="modal-field contacto-observaciones-wrap">
          <label>Observaciones del contacto</label>
          <textarea class="contacto-observaciones" rows="3">${escapeHtml(contact.observaciones)}</textarea>
        </div>
      </div>
    </div>
  `).join("");
}

function addContactoItem(data = {}) {
  const container = $("contactosContainer");
  if (!container) return;

  const contactos = readContactosFromModal();
  contactos.push(normalizeContactItem(data));
  renderContactos(contactos);
}

function removeContactoItemByIndex(index) {
  const contactos = readContactosFromModal().filter((_, i) => i !== index);
  renderContactos(contactos.length ? contactos : [createEmptyContact()]);
}

function readContactosFromModal() {
  const container = $("contactosContainer");
  if (!container) return [];

  const items = [...container.querySelectorAll(".contacto-item")];

  return items
    .map((item) => {
      const contacto = {
        nombre: item.querySelector(".contacto-nombre")?.value || "",
        rol: item.querySelector(".contacto-rol")?.value || "",
        correo: item.querySelector(".contacto-correo")?.value || "",
        telefono: item.querySelector(".contacto-telefono")?.value || "",
        nivel: item.querySelector(".contacto-nivel")?.value || "",
        curso: item.querySelector(".contacto-curso")?.value || "",
        observaciones: item.querySelector(".contacto-observaciones")?.value || ""
      };

      return normalizeContactItem(contacto);
    })
    .filter((contact) =>
      contact.nombre ||
      contact.rol ||
      contact.correo ||
      contact.telefono ||
      contact.nivel ||
      contact.curso ||
      contact.observaciones
    );
}

function normalizeCourseToken(value = "") {
  return normalizeText(value).toUpperCase().replace(/\s+/g, "");
}

function parseCursoDescriptor(rawValue = "") {
  const raw = normalizeCourseToken(rawValue);
  if (!raw) return null;

  const match = raw.match(/^(11|10|[1-9])(.*)$/);
  if (!match) return null;

  const nivel = String(match[1]);
  const suffix = String(match[2] || "").trim();

  if (!suffix) {
    return { nivel, mode: "unknown", sections: [], raw };
  }

  if (suffix === "COMPLETO") {
    return { nivel, mode: "full", sections: [], raw };
  }

  if (suffix === "SINDETALLE") {
    return { nivel, mode: "unknown", sections: [], raw };
  }

  if (/^[A-Z]{1,4}$/.test(suffix) && suffix.length > 1 && suffix.length <= 4) {
    return { nivel, mode: "sections", sections: suffix.split(""), raw };
  }

  return { nivel, mode: "sections", sections: [suffix], raw };
}

function parseNivelesText(text = "") {
  const lines = String(text || "")
    .split(/\n|;/)
    .map((line) => normalizeText(line))
    .filter(Boolean);

  const out = [];

  lines.forEach((line) => {
    const normalized = line.toUpperCase();

    if (normalized.includes(":")) {
      const [nivelRaw, restRaw] = normalized.split(":");
      const nivelMatch = normalizeText(nivelRaw).match(/^(11|10|[1-9])$/);
      if (!nivelMatch) return;

      const nivel = nivelMatch[1];
      const rest = normalizeText(restRaw || "");

      if (!rest || rest === "SINDETALLE" || rest === "SIN DETALLE") {
        out.push({ nivel, mode: "unknown", sections: [], raw: line });
        return;
      }

      if (rest === "COMPLETO") {
        out.push({ nivel, mode: "full", sections: [], raw: line });
        return;
      }

      const sections = rest
        .split(/,|\//)
        .map((item) => normalizeCourseToken(item))
        .filter(Boolean);

      out.push({
        nivel,
        mode: sections.length ? "sections" : "unknown",
        sections,
        raw: line
      });
      return;
    }

    const parsed = parseCursoDescriptor(line);
    if (parsed) out.push(parsed);
  });

  return out;
}

function summarizeNiveles(niveles = []) {
  return niveles.map((item) => {
    if (item.mode === "full") return `${item.nivel} completo`;
    if (item.mode === "unknown") return `${item.nivel} sin detalle`;
    return `${item.nivel} (${item.sections.join(", ")})`;
  }).join(" · ");
}

function parseStoredNiveles(data = {}) {
  const direct = parseMaybeJson(data.nivelesColegio, null);
  if (Array.isArray(direct)) return direct;
  return parseNivelesText(data.resumenNiveles || data.nivelesTexto || "");
}

function getDefaultCurrentDateInput() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function getHistoryCollectionRef(correoVendedor = "", numeroColegio = "") {
  return collection(
    db,
    "ventas_cartera",
    normalizeEmail(correoVendedor),
    "items",
    String(numeroColegio),
    "historial"
  );
}

async function getNextNumeroColegioForVendor(correoVendedor = "") {
  const email = normalizeEmail(correoVendedor);
  if (!email) return "";

  const snap = await getDocs(collection(db, "ventas_cartera", email, "items"));

  let maxNumero = 0;

  snap.forEach((docSnap) => {
    const data = docSnap.data() || {};
    const raw = String(data.numeroColegio || docSnap.id || "").trim();
    const num = Number(raw.replace(/[^\d]/g, ""));
    if (Number.isFinite(num) && num > maxNumero) {
      maxNumero = num;
    }
  });

  return String(maxNumero + 1);
}

function buildVendorDisplayNameFromRow(row = {}) {
  return normalizeText(
    `${row.nombreVendedor || ""} ${row.apellidoVendedor || ""}`.trim()
  );
}

async function syncNumeroColegioInputForSelectedVendor() {
  const numeroInput = $("numeroColegioInput");
  const vendedorSelect = $("vendedorSelectModal");

  if (!numeroInput || !vendedorSelect) return;

  const selectedEmail = normalizeEmail(vendedorSelect.value || "");
  if (!selectedEmail) {
    if (state.modalMode === "create") numeroInput.value = "";
    return;
  }

  // En creación: siempre se calcula automáticamente
  if (state.modalMode === "create") {
    const nextNumero = await getNextNumeroColegioForVendor(selectedEmail);
    numeroInput.value = nextNumero || "";
    return;
  }

  // En edición: si cambia de vendedor, mostrar el nuevo número destino
  const oldEmail = normalizeEmail(state.editingOriginal?.correoVendedor || "");
  if (oldEmail && oldEmail !== selectedEmail) {
    const nextNumero = await getNextNumeroColegioForVendor(selectedEmail);
    numeroInput.value = nextNumero || "";
    return;
  }

  // Si sigue en el mismo vendedor, mantiene su número
  numeroInput.value = normalizeText(state.editingOriginal?.numeroColegio || "");
}

function canEditCarteraRow(row = null) {
  if (canManageVentasRole(state.effectiveUser)) return true;
  if (!isVendedorRole(state.effectiveUser)) return false;
  if (!row) return false;
  return normalizeEmail(row.correoVendedor) === normalizeEmail(state.effectiveUser?.email || "");
}

function canDeleteCarteraRow() {
  return canManageVentasRole(state.effectiveUser);
}

function canCreateCarteraRow() {
  return canManageVentasRole(state.effectiveUser);
}

function buildHistorySummaryForChanges(changes = []) {
  return changes
    .map((item) => `${item.label}: ${item.before || "vacío"} → ${item.after || "vacío"}`)
    .join(" | ");
}

function normalizeQuoteSchoolMatch(row = {}, quote = {}) {
  const schoolOk = normalizeSchoolKey(row.colegio) === normalizeSchoolKey(quote.colegio || quote.colegioBase || "");
  if (!schoolOk) return false;

  const rowComuna = normalizeSearch(row.comuna || "");
  const quoteComuna = normalizeSearch(quote.comunaCiudad || quote.comuna || "");

  if (!rowComuna || !quoteComuna) return true;
  return rowComuna === quoteComuna;
}

function getQuotesForRow(row = {}) {
  return state.quoteRows.filter((quote) => normalizeQuoteSchoolMatch(row, quote));
}

function parseQuoteCoverage(quote = {}) {
  return parseCursoDescriptor(quote.cursoViaje || quote.curso || "");
}

function getVisitSeasonRange() {
  const now = new Date();
  const year = now.getFullYear();

  // Año comercial:
  // si estamos desde marzo en adelante, la temporada parte este año
  // si estamos en enero/febrero, la temporada partió el año anterior
  const seasonStartYear = now.getMonth() >= 2 ? year : year - 1;

  const start = new Date(seasonStartYear, 2, 1, 0, 0, 0, 0); // 1 marzo
  const end = new Date(seasonStartYear + 1, 2, 1, 0, 0, 0, 0); // 1 marzo siguiente

  return { start, end, label: `${seasonStartYear}-${seasonStartYear + 1}` };
}

function isDateWithinVisitSeason(value) {
  const d = toDateValue(value);
  if (!d) return false;

  const { start, end } = getVisitSeasonRange();
  return d >= start && d < end;
}

function historyItemCountsAsVisit(item = {}) {
  const tipo = normalizeSearch(item.tipo || "");
  const asunto = normalizeSearch(item.asunto || "");
  const mensaje = normalizeSearch(item.mensaje || "");
  const changes = Array.isArray(item.metadata?.changes) ? item.metadata.changes : [];

  // 1) caso directo: historial marcado como visita
  if (tipo.includes("visita")) return true;

  // 2) caso indirecto: hubo cambio en fechaUltimaVisita
  if (changes.some(change => String(change?.key || "") === "fechaUltimaVisita")) return true;

  // 3) respaldo por texto libre
  const joined = `${tipo} ${asunto} ${mensaje}`;
  if (joined.includes("visita") || joined.includes("visitado")) return true;

  return false;
}

async function countVisitsForRowInSeason(row = {}) {
  try {
    const snap = await getDocs(getHistoryCollectionRef(row.correoVendedor, row.numeroColegio));

    let count = 0;

    snap.forEach((docSnap) => {
      const item = docSnap.data() || {};
      if (!historyItemCountsAsVisit(item)) return;
      if (!isDateWithinVisitSeason(item.fecha)) return;
      count += 1;
    });

    return count;
  } catch (error) {
    console.warn("No se pudo contar visitas del colegio:", row.numeroColegio, error);
    return 0;
  }
}

function computeRowMetrics(row = {}) {
  const currentYear = new Date().getFullYear();

  const quotes = getQuotesForRow(row).filter((quote) => {
    const year = Number(String(quote.anoViaje || "").match(/\d{4}/)?.[0] || "");
    if (!Number.isFinite(year)) return state.includePastYears;
    return state.includePastYears ? true : year >= currentYear;
  });

  const byYear = new Map();
  quotes.forEach((quote) => {
    const year = String(quote.anoViaje || "Sin año");
    byYear.set(year, (byYear.get(year) || 0) + 1);
  });

  const yearlySummary = [...byYear.entries()]
    .sort((a, b) => String(a[0]).localeCompare(String(b[0]), "es", { numeric: true }))
    .map(([year, count]) => `${year}: ${count}`)
    .join(" · ");

  const niveles = Array.isArray(row.nivelesColegio) ? row.nivelesColegio : [];
  const faltantes = [];
  const trabajadoSinDetalle = [];

  niveles.forEach((nivelItem) => {
    const sameLevelQuotes = quotes
      .map((quote) => parseQuoteCoverage(quote))
      .filter((parsed) => parsed && parsed.nivel === nivelItem.nivel);

    if (!sameLevelQuotes.length) {
      if (nivelItem.mode === "sections" && nivelItem.sections.length) {
        nivelItem.sections.forEach((section) => faltantes.push(`${nivelItem.nivel}${section}`));
      } else {
        faltantes.push(`${nivelItem.nivel}`);
      }
      return;
    }

    if (nivelItem.mode === "full") return;
    if (nivelItem.mode === "unknown") return;

    const covered = new Set();

    sameLevelQuotes.forEach((parsed) => {
      if (parsed.mode === "full") {
        nivelItem.sections.forEach((section) => covered.add(section));
        return;
      }

      if (parsed.mode === "unknown") {
        trabajadoSinDetalle.push(nivelItem.nivel);
        return;
      }

      parsed.sections.forEach((section) => {
        if (nivelItem.sections.includes(section)) covered.add(section);
      });
    });

    nivelItem.sections.forEach((section) => {
      if (!covered.has(section)) faltantes.push(`${nivelItem.nivel}${section}`);
    });
  });

  return {
    totalQuotes: quotes.length,
    yearlySummary: yearlySummary || "—",
    faltantes,
    trabajadoSinDetalle: [...new Set(trabajadoSinDetalle)],
    quotes,

    // NUEVO: visitas temporada comercial
    visitCountSeason: 0,
    wasVisitedInSeason: false,
    visitSeasonLabel: getVisitSeasonRange().label
  };
}

function getAliasList(user) {
  // Soporta ambas variantes:
  // - aliascartera  (como está hoy en firebase-init.js)
  // - aliasCartera  (por si después normalizas el nombre)
  const raw = user?.aliascartera ?? user?.aliasCartera;

  if (Array.isArray(raw)) {
    return raw.map(a => normalizeSearch(a)).filter(Boolean);
  }

  if (typeof raw === "string") {
    return [normalizeSearch(raw)].filter(Boolean);
  }

  return [];
}

function findVendorByAlias(alias = "") {
  const target = normalizeSearch(alias);
  if (!target) return null;

  for (const vendor of state.vendors) {
    const aliases = getAliasList(vendor);
    if (aliases.includes(target)) return vendor;
  }

  for (const vendor of state.vendors) {
    const fullName = normalizeSearch(`${vendor.nombre} ${vendor.apellido}`.trim());
    const firstName = normalizeSearch(vendor.nombre);
    if (target === fullName || target === firstName) return vendor;
  }

  return null;
}

function buildScopeText() {
  if (!state.effectiveUser) {
    return "Cartera · Cargando usuario...";
  }

  let texto = "Cartera · Vista general";

  if (isVendedorRole(state.effectiveUser)) {
    texto = `Cartera · Vista personal de ${getNombreUsuario(state.effectiveUser)}`;
  } else if (canObserveOnlyRole(state.effectiveUser)) {
    texto = "Cartera · Observador";
  } else {
    texto = `Cartera · ${state.effectiveUser.rol || "sin rol"}`;
  }

  if (state.vendorFilter && !isVendedorRole(state.effectiveUser)) {
    texto += ` · Filtrada por ${getVendorNameByEmail(state.vendorFilter)}`;
  }

  if (state.realUser && isActingAsAnother(state.realUser, state.effectiveUser)) {
    return `Navegando como ${getNombreUsuario(state.effectiveUser)} · ${state.effectiveUser.rol || "sin rol"} · ${texto}`;
  }

  return texto;
}

function mapDocToRow(docId, data) {
  const contactosDirect = parseMaybeJson(data.contactosColegio, []) || [];
  const contactos = Array.isArray(contactosDirect) ? contactosDirect : [];
  const nivelesColegio = parseStoredNiveles(data);

  const row = {
    numeroColegio: normalizeText(data.numeroColegio || docId),
    colegio: normalizeText(data.colegio),
    nombreVendedor: normalizeText(data.nombreVendedor),
    apellidoVendedor: normalizeText(data.apellidoVendedor),
    correoVendedor: normalizeEmail(data.correoVendedor),
    comuna: normalizeText(data.comuna),
    ciudad: normalizeText(data.ciudad),
    estatus: normalizeText(data.estatus),
    observaciones: normalizeText(data.observaciones),

    logoUrl: String(data.logoColegioUrl || data.logoUrl || "").trim(),
    logoPath: String(data.logoColegioPath || data.logoPath || "").trim(),
    logoColegioUrl: String(data.logoColegioUrl || data.logoUrl || "").trim(),
    logoColegioPath: String(data.logoColegioPath || data.logoPath || "").trim(),

    nivelesColegio,
    resumenNiveles: normalizeText(data.resumenNiveles || summarizeNiveles(nivelesColegio)),
    contactosColegio: contactos,
    trabajado: !!data.trabajado,
    visitado: !!data.visitado,
    fechaUltimaVisita: normalizeText(data.fechaUltimaVisita || ""),
    ultimaGestionTipo: normalizeText(data.ultimaGestionTipo || ""),
    ultimaGestionAsunto: normalizeText(data.ultimaGestionAsunto || ""),
    ultimaGestionMensaje: normalizeText(data.ultimaGestionMensaje || ""),
    ultimaGestionFechaText: normalizeText(data.ultimaGestionFechaText || ""),
    ultimaGestionAt: data.ultimaGestionAt || null
  };

  row.metrics = computeRowMetrics(row);
  return row;
}

function buildItemPayload(input, existing = null) {
  const nextLogoUrl =
    input.logoUrl !== undefined && input.logoUrl !== null
      ? String(input.logoUrl).trim()
      : String(input.logoColegioUrl ?? existing?.logoUrl ?? existing?.logoColegioUrl ?? "").trim();

  const nextLogoPath =
    input.logoPath !== undefined && input.logoPath !== null
      ? String(input.logoPath).trim()
      : String(input.logoColegioPath ?? existing?.logoPath ?? existing?.logoColegioPath ?? "").trim();

  const nivelesColegio = Array.isArray(input.nivelesColegio)
    ? input.nivelesColegio
    : (Array.isArray(existing?.nivelesColegio) ? existing.nivelesColegio : []);

  const contactosColegio = Array.isArray(input.contactosColegio)
    ? input.contactosColegio
    : (Array.isArray(existing?.contactosColegio) ? existing.contactosColegio : []);

  const trabajado = input.trabajado !== undefined
    ? !!input.trabajado
    : !!(existing?.trabajado);

  const visitado = input.visitado !== undefined
    ? !!input.visitado
    : !!(existing?.visitado);

  return {
    numeroColegio: normalizeText(input.numeroColegio),
    colegio: normalizeText(input.colegio),
    colegioNormalizado: normalizeSearch(input.colegio),
    nombreVendedor: normalizeText(input.nombreVendedor),
    apellidoVendedor: normalizeText(input.apellidoVendedor),
    correoVendedor: normalizeEmail(input.correoVendedor),
    comuna: normalizeText(input.comuna),
    ciudad: normalizeText(
      input.ciudad !== undefined && input.ciudad !== null && input.ciudad !== ""
        ? input.ciudad
        : existing?.ciudad || ""
    ),
    estatus: normalizeText(input.estatus),
    observaciones: normalizeText(
      input.observaciones !== undefined && input.observaciones !== null && input.observaciones !== ""
        ? input.observaciones
        : existing?.observaciones || ""
    ),

    nivelesColegio,
    resumenNiveles: normalizeText(input.resumenNiveles || summarizeNiveles(nivelesColegio)),
    contactosColegio,
    trabajado,
    visitado,
    fechaUltimaVisita: normalizeText(input.fechaUltimaVisita || existing?.fechaUltimaVisita || ""),
    ultimaGestionTipo: normalizeText(input.ultimaGestionTipo || existing?.ultimaGestionTipo || ""),
    ultimaGestionAsunto: normalizeText(input.ultimaGestionAsunto || existing?.ultimaGestionAsunto || ""),
    ultimaGestionMensaje: normalizeText(input.ultimaGestionMensaje || existing?.ultimaGestionMensaje || ""),
    ultimaGestionFechaText: normalizeText(input.ultimaGestionFechaText || existing?.ultimaGestionFechaText || ""),
    ultimaGestionAt:
      input.ultimaGestionTipo || input.ultimaGestionAsunto || input.ultimaGestionMensaje || input.fechaUltimaVisita
        ? serverTimestamp()
        : (existing?.ultimaGestionAt || null),

    logoUrl: nextLogoUrl,
    logoPath: nextLogoPath,
    logoColegioUrl:
      input.logoColegioUrl !== undefined && input.logoColegioUrl !== null
        ? String(input.logoColegioUrl).trim()
        : nextLogoUrl,
    logoColegioPath:
      input.logoColegioPath !== undefined && input.logoColegioPath !== null
        ? String(input.logoColegioPath).trim()
        : nextLogoPath,

    actualizadoPor: normalizeEmail(state.realUser?.email || ""),
    fechaActualizacion: serverTimestamp()
  };
}

function buildParentVendorPayload(vendor) {
  return {
    correoVendedor: normalizeEmail(vendor.email || vendor.correoVendedor),
    nombreVendedor: normalizeText(vendor.nombre || vendor.nombreVendedor),
    apellidoVendedor: normalizeText(vendor.apellido || vendor.apellidoVendedor),
    actualizadoPor: normalizeEmail(state.realUser?.email || ""),
    fechaActualizacion: serverTimestamp()
  };
}

function slugStoragePart(value = "") {
  return String(value || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "") || "sin_valor";
}

function revokeLogoPreviewObjectUrl() {
  if (state.logoPreviewObjectUrl) {
    try {
      URL.revokeObjectURL(state.logoPreviewObjectUrl);
    } catch {}
    state.logoPreviewObjectUrl = "";
  }
}

function setLogoPreview(url = "") {
  const img = $("logoPreviewImg");
  const empty = $("logoPreviewEmpty");

  if (!img || !empty) return;

  if (url) {
    img.src = url;
    img.classList.remove("hidden");
    empty.classList.add("hidden");
  } else {
    img.removeAttribute("src");
    img.classList.add("hidden");
    empty.classList.remove("hidden");
  }
}

function refreshLogoPreview() {
  const removeWrap = $("quitarLogoWrap");
  const hasExistingLogo = !!state.editingOriginal?.logoUrl;

  if (removeWrap) {
    removeWrap.classList.toggle("hidden", !hasExistingLogo);
  }

  revokeLogoPreviewObjectUrl();

  if (state.pendingLogoFile) {
    state.logoPreviewObjectUrl = URL.createObjectURL(state.pendingLogoFile);
    setLogoPreview(state.logoPreviewObjectUrl);
    return;
  }

  if (hasExistingLogo && !state.removeCurrentLogo) {
    setLogoPreview(state.editingOriginal.logoUrl);
    return;
  }

  setLogoPreview("");
}

function resetLogoModalState() {
  state.pendingLogoFile = null;
  state.removeCurrentLogo = false;

  if ($("logoInput")) $("logoInput").value = "";
  if ($("quitarLogoCheck")) $("quitarLogoCheck").checked = false;

  refreshLogoPreview();
}

async function uploadSchoolLogo(file, input) {
  const ext =
    (file?.name || "").includes(".")
      ? file.name.split(".").pop().toLowerCase().replace(/[^a-z0-9]/g, "")
      : "bin";

  const sellerPart = slugStoragePart(input.correoVendedor);
  const schoolPart = slugStoragePart(input.numeroColegio);
  const path = `ventas_cartera_logos/${sellerPart}/${schoolPart}_${Date.now()}.${ext || "bin"}`;

  const fileRef = storageRef(storage, path);

  await uploadBytes(fileRef, file, {
    contentType: file.type || "application/octet-stream"
  });

  const url = await getDownloadURL(fileRef);

  return {
    logoPath: path,
    logoUrl: url
  };
}

async function deleteLogoFromStorage(path = "") {
  if (!path) return;

  try {
    await deleteObject(storageRef(storage, path));
  } catch (error) {
    if (error?.code !== "storage/object-not-found") {
      console.warn("No se pudo eliminar logo antiguo:", error);
    }
  }
}

/* =========================================================
   HEADER / LAYOUT
========================================================= */
function renderHeaderState() {
  const pageScope = $("carteraScope");

  if (!state.effectiveUser) {
    setHeaderState({
      realUser: state.realUser,
      effectiveUser: null,
      scopeText: "Cartera · Cargando usuario..."
    });

    renderActingUserSwitcher({
      realUser: state.realUser,
      effectiveUser: null,
      users: VENTAS_USERS
    });

    if (pageScope) {
      pageScope.textContent = "Cargando permisos de usuario...";
    }

    return;
  }

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

  if (pageScope) {
    if (canManageVentasRole(state.effectiveUser)) {
      pageScope.textContent = "Administra la cartera de colegios/clientes por vendedor(a).";
    } else if (canObserveOnlyRole(state.effectiveUser)) {
      pageScope.textContent = "Vista observador de la cartera.";
    } else {
      pageScope.textContent = "Vista personal de la cartera asignada al vendedor(a).";
    }
  }
}

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
      await loadData();
    },
    onResetActAs: async () => {
      sessionStorage.removeItem(ACTING_USER_KEY);
      await bootstrapFromSession();
      await loadData();
    }
  });
}

/* =========================================================
   UI LOCAL
========================================================= */
function renderRoleButtons() {
  const allowManage = state.effectiveUser ? canManageVentasRole(state.effectiveUser) : false;
  const importLabel = $("labelImportar");
  const addBtn = $("btnAgregar");
  const deleteSelectedBtn = $("btnEliminarSeleccionados");

  if (importLabel) importLabel.classList.toggle("hidden", !allowManage);
  if (addBtn) addBtn.classList.toggle("hidden", !allowManage);
  if (deleteSelectedBtn) {
    deleteSelectedBtn.classList.toggle("hidden", !allowManage);
    deleteSelectedBtn.disabled = !allowManage || state.selectedKeys.size === 0;
  }

  $("vendorEditHint")?.classList.toggle("hidden", !isVendedorRole(state.effectiveUser));
}

function renderVendorFilter() {
  const wrap = $("vendorFilterWrap");
  const select = $("vendorFilter");
  if (!wrap || !select || !state.effectiveUser) return;

  if (isVendedorRole(state.effectiveUser)) {
    wrap.classList.add("hidden");
    return;
  }

  wrap.classList.remove("hidden");
  select.innerHTML = `<option value="">Todos</option>`;

  state.vendors.forEach((vendor) => {
    const opt = document.createElement("option");
    opt.value = normalizeEmail(vendor.email);
    opt.textContent = `${vendor.nombre} ${vendor.apellido}`.trim();
    select.appendChild(opt);
  });

  select.value = state.vendorFilter || "";
}

function getSearchTarget(row) {
  return normalizeSearch([
    row.numeroColegio,
    row.nombreVendedor,
    row.apellidoVendedor,
    row.colegio,
    row.comuna,
    row.ciudad,
    row.estatus,
    row.observaciones,
    row.resumenNiveles,
    stringifyContact(row.contactosColegio?.[0] || {}),
    stringifyContact(row.contactosColegio?.[1] || {}),
    row.ultimaGestionTipo,
    row.ultimaGestionAsunto,
    row.ultimaGestionMensaje,
    row.fechaUltimaVisita,
    row.metrics?.yearlySummary,
    (row.metrics?.faltantes || []).join(" ")
  ].join(" "));
}

const SORTABLE_COLUMNS = [
  "numeroColegio",
  "vendedor",
  "colegio",
  "comuna",
  "niveles",
  "trabajo",
  "visitasTemporada",
  "cotizaciones",
  "faltantes",
  "estatus"
];

const COLUMN_LABELS = {
  numeroColegio: "N° Colegio",
  vendedor: "Vendedor(a)",
  colegio: "Colegio",
  comuna: "Comuna",
  niveles: "Niveles",
  trabajo: "Seguimiento",
  visitasTemporada: "Visitado",
  cotizaciones: "Cotizaciones",
  faltantes: "Faltantes",
  estatus: "Estatus"
};

function getColumnLabel(key = "") {
  return COLUMN_LABELS[key] || key;
}

function getCellValue(row, key) {
  if (key === "vendedor") {
    return normalizeText(`${row.nombreVendedor || ""} ${row.apellidoVendedor || ""}`.trim());
  }

  if (key === "niveles") return normalizeText(row.resumenNiveles || "");

  if (key === "trabajo") {
    return normalizeText([
      row.trabajado ? "TRABAJADO" : "PENDIENTE",
      row.visitado ? "VISITADO" : "",
      row.ultimaGestionTipo || "",
      row.ultimaGestionAsunto || ""
    ].join(" "));
  }

  if (key === "visitasTemporada") {
    return String(row.metrics?.visitCountSeason || 0);
  }

  if (key === "cotizaciones") return String(row.metrics?.totalQuotes || 0);
  if (key === "faltantes") return normalizeText((row.metrics?.faltantes || []).join(" "));

  return normalizeText(row?.[key] ?? "");
}

function getSortValue(row, key) {
  const raw = getCellValue(row, key).trim();

  if (!raw) {
    return { empty: true, num: null, text: "" };
  }

  if (key === "numeroColegio") {
    const onlyNum = String(raw).replace(/[^\d.-]/g, "");
    const num = Number(onlyNum);
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
  const sortKey = state.sort.key || "numeroColegio";
  const dir = state.sort.dir === "desc" ? -1 : 1;

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

    if (cmp !== 0) return cmp * dir;

    return String(a.numeroColegio || "").localeCompare(
      String(b.numeroColegio || ""),
      "es",
      { numeric: true, sensitivity: "base" }
    );
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

function renderSortButton(key) {
  const isActive = state.sort.key === key;
  const arrow = isActive
    ? (state.sort.dir === "asc" ? "↑" : "↓")
    : "↕";

  return `
    <button
      class="th-sort ${isActive ? "active" : ""}"
      type="button"
      data-action="sort"
      data-key="${escapeHtml(key)}"
    >
      <span>${escapeHtml(getColumnLabel(key))}</span>
      <span class="sort-arrow" aria-hidden="true">${arrow}</span>
    </button>
  `;
}

function applyFilters() {
  let rows = [...state.rows];

  if (state.vendorFilter) {
    rows = rows.filter(r => normalizeEmail(r.correoVendedor) === normalizeEmail(state.vendorFilter));
  }

  if (state.statusFilter === "ok") {
    rows = rows.filter(r => normalizeText(r.estatus) === "OK");
  } else if (state.statusFilter === "pending") {
    rows = rows.filter(r => normalizeText(r.estatus) !== "OK");
  }

  if (state.trabajoFilter === "pendiente") {
    rows = rows.filter((r) => !r.trabajado);
  } else if (state.trabajoFilter === "trabajado") {
    rows = rows.filter((r) => !!r.trabajado);
  } else if (state.trabajoFilter === "visitado") {
    rows = rows.filter((r) => !!r.visitado);
  }

  const q = normalizeSearch(state.search);
  if (q) {
    rows = rows.filter(r => getSearchTarget(r).includes(q));
  }

  state.filteredRows = rows;
  state.currentPage = 1;
  renderTable();
  renderHeaderState();
}

function renderTable() {
  const thead = document.querySelector(".cartera-table thead");
  const tbody = $("tbodyCartera");
  const empty = $("emptyState");
  const summary = $("tableSummary");

  if (!thead || !tbody || !empty || !summary) return;

  const allowManage = canManageVentasRole(state.effectiveUser);
  const { sortedRows, pageRows, totalPages } = getPaginationData(state.filteredRows);
  state.pageRows = pageRows;

  summary.textContent = `${pageRows.length} registro(s) mostrados · ${sortedRows.length} filtrados · ${state.rows.length} total`;

  thead.innerHTML = `
    <tr>
      ${allowManage ? `
        <th class="check-col check-head">
          <input id="checkAllRows" type="checkbox" />
        </th>
      ` : ""}
      <th>${renderSortButton("numeroColegio")}</th>
      <th>${renderSortButton("vendedor")}</th>
      <th class="logo-col logo-head">Logo</th>
      <th>${renderSortButton("colegio")}</th>
      <th>${renderSortButton("comuna")}</th>
      <th>${renderSortButton("niveles")}</th>
      <th>${renderSortButton("trabajo")}</th>
      <th>${renderSortButton("visitasTemporada")}</th>
      <th>${renderSortButton("cotizaciones")}</th>
      <th>${renderSortButton("faltantes")}</th>
      <th>${renderSortButton("estatus")}</th>
      <th class="actions-col actions-head">Acciones</th>
    </tr>
  `;

  renderPaginationControls(sortedRows.length, totalPages);

  if (!sortedRows.length) {
    tbody.innerHTML = "";
    empty.classList.remove("hidden");

    const checkAll = $("checkAllRows");
    if (checkAll) {
      checkAll.checked = false;
      checkAll.indeterminate = false;
    }

    renderRoleButtons();
    return;
  }

  empty.classList.add("hidden");

  tbody.innerHTML = pageRows.map((row) => {
    const sellerName = `${row.nombreVendedor} ${row.apellidoVendedor}`.trim();
    const rowKey = `${normalizeEmail(row.correoVendedor)}__${String(row.numeroColegio)}`;
    const checked = state.selectedKeys.has(rowKey) ? "checked" : "";
    const canEdit = canEditCarteraRow(row);
    const canDelete = canDeleteCarteraRow();
    const metrics = row.metrics || {
      totalQuotes: 0,
      yearlySummary: "—",
      faltantes: [],
      trabajadoSinDetalle: [],
      visitCountSeason: 0,
      wasVisitedInSeason: false,
      visitSeasonLabel: getVisitSeasonRange().label
    };

    const actions = `
      <div class="table-actions">
        ${canEdit ? `<button class="btn-mini edit" data-action="edit" data-id="${escapeHtml(row.numeroColegio)}" data-email="${escapeHtml(row.correoVendedor)}">Editar</button>` : ""}
        ${canDelete ? `<button class="btn-mini delete" data-action="delete" data-id="${escapeHtml(row.numeroColegio)}" data-email="${escapeHtml(row.correoVendedor)}">Eliminar</button>` : ""}
        <button class="btn-mini view" data-action="history" data-id="${escapeHtml(row.numeroColegio)}" data-email="${escapeHtml(row.correoVendedor)}">Historial</button>
      </div>
    `;

    const logoHtml = row.logoUrl
      ? `<img class="school-logo-thumb" src="${escapeHtml(row.logoUrl)}" alt="Logo ${escapeHtml(row.colegio || row.numeroColegio)}" loading="lazy" />`
      : `<div class="school-logo-empty">—</div>`;

    const trabajoChips = [
      row.trabajado ? `<span class="metric-chip ok">Trabajado</span>` : `<span class="metric-chip warn">Pendiente</span>`,
      row.visitado ? `<span class="metric-chip">Visitado</span>` : ""
    ].filter(Boolean).join("");

    const ultimaGestionTxt = [row.ultimaGestionTipo, row.ultimaGestionAsunto, row.ultimaGestionFechaText || row.fechaUltimaVisita]
      .filter(Boolean)
      .join(" · ");

    const visitadoTxt = metrics.wasVisitedInSeason
      ? `SÍ · ${metrics.visitCountSeason}`
      : "NO";
    
    const visitadoDetalleTxt = metrics.wasVisitedInSeason
      ? `Temporada ${metrics.visitSeasonLabel}`
      : `Sin visitas en ${metrics.visitSeasonLabel}`;

    const faltantesTxt = metrics.faltantes.length
      ? metrics.faltantes.join(", ")
      : "Sin faltantes detectados";

    const sinDetalleTxt = metrics.trabajadoSinDetalle.length
      ? `Trabajado sin detalle: ${metrics.trabajadoSinDetalle.join(", ")}`
      : "";

    return `
      <tr>
        ${allowManage ? `
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
        <td>${escapeHtml(row.numeroColegio)}</td>
        <td>${escapeHtml(sellerName)}</td>
        <td class="logo-col">${logoHtml}</td>
        <td>
          <div class="stack-tight">
            <strong>${escapeHtml(row.colegio)}</strong>
            <div class="table-note">${escapeHtml((row.contactosColegio || []).map(c => c.nombre).filter(Boolean).join(" · ") || "Sin contactos cargados")}</div>
          </div>
        </td>
        <td>${escapeHtml(row.comuna || row.ciudad || "—")}</td>
        <td>
          <div class="stack-tight">
            <strong>${escapeHtml(row.resumenNiveles || "Sin definir")}</strong>
            <div class="table-note">${escapeHtml(sinDetalleTxt || "—")}</div>
          </div>
        </td>
        <td>
          <div class="stack-tight">
            <div>${trabajoChips}</div>
            <div class="table-note">${escapeHtml(ultimaGestionTxt || "Sin gestión registrada")}</div>
          </div>
        </td>
        <td>
          <div class="stack-tight">
            <strong>${escapeHtml(visitadoTxt)}</strong>
            <div class="table-note">${escapeHtml(visitadoDetalleTxt)}</div>
          </div>
        </td>
        <td>
          <div class="stack-tight">
            <strong>${escapeHtml(String(metrics.totalQuotes || 0))}</strong>
            <div class="table-note">${escapeHtml(metrics.yearlySummary || "—")}</div>
          </div>
        </td>
        <td>
          <div class="stack-tight">
            <strong>${escapeHtml(faltantesTxt)}</strong>
          </div>
        </td>
        <td>${escapeHtml(row.estatus)}</td>
        <td class="actions-col">${actions}</td>
      </tr>
    `;
  }).join("");

  const checkAll = $("checkAllRows");
  if (checkAll) {
    const visibleKeys = pageRows.map(
      row => `${normalizeEmail(row.correoVendedor)}__${String(row.numeroColegio)}`
    );
    const selectedVisible = visibleKeys.filter(key => state.selectedKeys.has(key)).length;

    checkAll.checked = visibleKeys.length > 0 && selectedVisible === visibleKeys.length;
    checkAll.indeterminate = selectedVisible > 0 && selectedVisible < visibleKeys.length;
  }

  renderRoleButtons();
}

/* =========================================================
   FIRESTORE
========================================================= */
async function loadVendorItems(email) {
  const sellerEmails = (getVentasUserEmails(email) || [])
    .map(e => normalizeEmail(e))
    .filter(e => e && e.includes("@")); // evita undefined/null

    if (!sellerEmails.length) {
    console.warn("No hay emails válidos para cargar cartera:", email);
    return [];
  }

  setProgressStatus({
    text: "Cargando cartera...",
    meta: `Vendedor(a): ${sellerEmails.join(" | ") || normalizeEmail(email)}`,
    progress: 10
  });

  const rows = [];
  const seen = new Set();

  for (const sellerEmail of sellerEmails) {
    const snap = await getDocs(collection(db, "ventas_cartera", sellerEmail, "items"));

    snap.docs.forEach((d) => {
      const row = mapDocToRow(d.id, d.data());
      const key = `${normalizeEmail(row.correoVendedor)}__${String(row.numeroColegio)}`;

      if (seen.has(key)) return;
      seen.add(key);
      rows.push(row);
    });
  }

  setProgressStatus({
    text: "Cartera cargada.",
    meta: `${rows.length} registro(s) encontrados`,
    progress: 100,
    type: "success"
  });
  clearProgressStatus();

  return rows;
}

async function loadAllItems() {
  setProgressStatus({
    text: "Cargando cartera...",
    meta: "Leyendo vendedores...",
    progress: 5
  });

  const sellersSnap = await getDocs(collection(db, "ventas_cartera"));
  const sellerDocs = sellersSnap.docs;

  if (!sellerDocs.length) {
    setProgressStatus({
      text: "Cartera cargada.",
      meta: "No hay vendedores con registros todavía.",
      progress: 100,
      type: "success"
    });
    clearProgressStatus();
    return [];
  }

  const rows = [];
  let processed = 0;

  for (const sellerDoc of sellerDocs) {
    const sellerEmail = sellerDoc.id;
    if (!sellerEmail || !sellerEmail.includes("@")) continue;
    const itemsSnap = await getDocs(collection(db, "ventas_cartera", sellerEmail, "items"));
    itemsSnap.docs.forEach(d => rows.push(mapDocToRow(d.id, d.data())));

    processed += 1;
    const pct = 5 + Math.round((processed / sellerDocs.length) * 85);

    setProgressStatus({
      text: "Cargando cartera...",
      meta: `Vendedores procesados: ${processed}/${sellerDocs.length}`,
      progress: pct
    });
  }

  setProgressStatus({
    text: "Cartera cargada.",
    meta: `${rows.length} registro(s) encontrados`,
    progress: 100,
    type: "success"
  });
  clearProgressStatus();

  return rows;
}

async function loadQuoteRows() {
  const snap = await getDocs(collection(db, "ventas_cotizaciones"));
  state.quoteRows = snap.docs.map((docSnap) => ({
    id: docSnap.id,
    ...(docSnap.data() || {})
  }));
}

async function loadData() {
  try {
    await loadQuoteRows();

    if (isVendedorRole(state.effectiveUser)) {
      const sellerEmails = getVentasUserEmails(state.effectiveUser);
      state.vendorFilter = normalizeEmail(sellerEmails[0] || state.effectiveUser.email);
      state.rows = await loadVendorItems(state.effectiveUser.email);
    } else {
      state.rows = await loadAllItems();
    }

    state.rows = await Promise.all(
      state.rows.map(async (row) => {
        const metrics = computeRowMetrics(row);
        const visitCountSeason = await countVisitsForRowInSeason(row);
    
        return {
          ...row,
          metrics: {
            ...metrics,
            visitCountSeason,
            wasVisitedInSeason: visitCountSeason > 0
          }
        };
      })
    );

    renderRoleButtons();
    renderVendorFilter();
    applyFilters();
  } catch (error) {
    console.error(error);
    setProgressStatus({
      text: "Error cargando cartera.",
      meta: error.message || "No se pudo leer Firestore.",
      progress: 100,
      type: "error"
    });
  }
}

/* =========================================================
   MODAL
========================================================= */
function fillVendorSelectModal(selectedEmail = "") {
  const select = $("vendedorSelectModal");
  if (!select) return;

  select.innerHTML = `<option value="">Seleccionar vendedor(a)</option>`;

  state.vendors.forEach((vendor) => {
    const opt = document.createElement("option");
    opt.value = normalizeEmail(vendor.email);
    opt.textContent = `${vendor.nombre} ${vendor.apellido}`.trim();
    if (normalizeEmail(vendor.email) === normalizeEmail(selectedEmail)) {
      opt.selected = true;
    }
    select.appendChild(opt);
  });

  updateVendorPreview();
}

async function updateVendorPreview() {
  const select = $("vendedorSelectModal");
  const vendor = state.vendors.find(
    v => normalizeEmail(v.email) === normalizeEmail(select?.value || "")
  );

  $("nombrePreview").textContent = vendor?.nombre || "—";
  $("apellidoPreview").textContent = vendor?.apellido || "—";
  $("correoPreview").textContent = vendor?.email || "—";

  await syncNumeroColegioInputForSelectedVendor();
}

async function openCreateModal() {
  state.modalMode = "create";
  state.editingOriginal = null;

  $("modalTitle").textContent = "Agregar colegio";
  $("numeroColegioInput").value = "";
  $("numeroColegioInput").readOnly = true;
  $("colegioInput").value = "";
  $("comunaInput").value = "";
  $("ciudadInput").value = "";
  $("estatusInput").value = "";
  $("observacionesInput").value = "";

  fillVendorSelectModal("");
  resetLogoModalState();

  renderContactos([createEmptyContact()]);

  $("modalForm").classList.add("show");

  await syncNumeroColegioInputForSelectedVendor();
}
async function openEditModal(row) {
  state.modalMode = "edit";
  state.editingOriginal = { ...row };

  $("modalTitle").textContent = "Editar colegio";
  $("numeroColegioInput").value = row.numeroColegio || "";
  $("numeroColegioInput").readOnly = true;
  $("colegioInput").value = row.colegio || "";
  $("comunaInput").value = row.comuna || "";
  $("ciudadInput").value = row.ciudad || "";
  $("estatusInput").value = row.estatus || "";
  $("observacionesInput").value = row.observaciones || "";

  fillVendorSelectModal(row.correoVendedor || "");
  resetLogoModalState();
  refreshLogoPreview();

  renderContactos(row.contactosColegio || [createEmptyContact()]);

  $("modalForm").classList.add("show");

  await syncNumeroColegioInputForSelectedVendor();
}

function closeModal() {
  revokeLogoPreviewObjectUrl();
  state.pendingLogoFile = null;
  state.removeCurrentLogo = false;

  if ($("logoInput")) $("logoInput").value = "";
  if ($("quitarLogoCheck")) $("quitarLogoCheck").checked = false;

  const container = $("contactosContainer");
  if (container) container.innerHTML = "";

  $("modalForm")?.classList.remove("show");
}

function readModalInput() {
  const sellerEmail = normalizeEmail($("vendedorSelectModal")?.value || "");
  const vendor = state.vendors.find(v => normalizeEmail(v.email) === sellerEmail);
  const contactosColegio = readContactosFromModal();

  return {
    numeroColegio: normalizeText($("numeroColegioInput")?.value || ""),
    colegio: normalizeText($("colegioInput")?.value || ""),
    comuna: normalizeText($("comunaInput")?.value || ""),
    ciudad: normalizeText($("ciudadInput")?.value || ""),
    estatus: normalizeText($("estatusInput")?.value || ""),
    observaciones: normalizeText($("observacionesInput")?.value || ""),
    correoVendedor: sellerEmail,
    nombreVendedor: vendor?.nombre || "",
    apellidoVendedor: vendor?.apellido || "",
    contactosColegio
  };
}

function validateRowInput(input) {
  if (!input.colegio) return "Debes indicar el nombre del colegio.";
  if (!input.correoVendedor) return "Debes seleccionar un vendedor(a).";
  if (!input.nombreVendedor) return "No se pudo determinar el nombre del vendedor(a).";

  const invalidContact = (input.contactosColegio || []).find((c) => {
    const hasSomething = c.nombre || c.rol || c.correo || c.telefono || c.nivel || c.curso || c.observaciones;
    const hasMinimum = c.nombre || c.rol;
    return hasSomething && !hasMinimum;
  });

  if (invalidContact) {
    return "Cada contacto que ingreses debe tener al menos nombre o rol/cargo.";
  }

  return "";
}

function buildHistoryChanges(oldRow = {}, input = {}) {
  const fields = [
    ["numeroColegio", "N° Colegio"],
    ["colegio", "Colegio"],
    ["comuna", "Comuna"],
    ["ciudad", "Ciudad"],
    ["estatus", "Estatus"],
    ["observaciones", "Observaciones"],
    ["resumenNiveles", "Niveles"],
    ["ultimaGestionTipo", "Tipo gestión"],
    ["ultimaGestionAsunto", "Asunto gestión"],
    ["ultimaGestionMensaje", "Mensaje gestión"],
    ["fechaUltimaVisita", "Fecha visita"]
  ];

  const changes = [];

  fields.forEach(([key, label]) => {
    const before = normalizeText(oldRow?.[key] || "");
    const after = normalizeText(input?.[key] || "");
    if (before !== after) {
      changes.push({ key, label, before, after });
    }
  });

  const oldVendorName = buildVendorDisplayNameFromRow(oldRow);
  const newVendorName = normalizeText(
    `${input?.nombreVendedor || ""} ${input?.apellidoVendedor || ""}`.trim()
  );

  if (
    normalizeEmail(oldRow?.correoVendedor || "") !== normalizeEmail(input?.correoVendedor || "") ||
    oldVendorName !== newVendorName
  ) {
    changes.push({
      key: "vendedor",
      label: "Vendedor(a)",
      before: oldVendorName || normalizeEmail(oldRow?.correoVendedor || ""),
      after: newVendorName || normalizeEmail(input?.correoVendedor || "")
    });
  }

  const contactsBefore = (oldRow?.contactosColegio || []).map(stringifyContact).join(" | ");
  const contactsAfter = (input?.contactosColegio || []).map(stringifyContact).join(" | ");
  if (contactsBefore !== contactsAfter) {
    changes.push({
      key: "contactosColegio",
      label: "Contactos",
      before: contactsBefore,
      after: contactsAfter
    });
  }

  return changes;
}

async function writeCarteraHistory({
  correoVendedor,
  numeroColegio,
  tipo = "Actualización",
  asunto = "",
  mensaje = "",
  metadata = {}
}) {
  const historyRef = doc(getHistoryCollectionRef(correoVendedor, numeroColegio));

  await setDoc(historyRef, {
    tipo: normalizeText(tipo),
    asunto: normalizeText(asunto),
    mensaje: normalizeText(mensaje),
    metadata,
    hechoPor: getNombreUsuario(state.effectiveUser),
    hechoPorCorreo: normalizeEmail(state.realUser?.email || ""),
    fecha: serverTimestamp()
  });
}

async function openHistoryModal(row) {
  const modal = $("historyModal");
  const body = $("historyBody");
  const title = $("historyTitle");

  if (!modal || !body || !title || !row) return;

  title.textContent = `Historial · ${row.colegio || row.numeroColegio}`;
  body.innerHTML = `<div class="history-empty">Cargando historial...</div>`;
  modal.classList.add("show");

  try {
    const qy = query(
      getHistoryCollectionRef(row.correoVendedor, row.numeroColegio),
      orderBy("fecha", "desc"),
      limit(30)
    );

    const snap = await getDocs(qy);

    if (snap.empty) {
      body.innerHTML = `<div class="history-empty">No hay historial para este colegio todavía.</div>`;
      return;
    }

    body.innerHTML = snap.docs.map((docSnap) => {
      const item = docSnap.data() || {};
      const changes = Array.isArray(item.metadata?.changes) ? item.metadata.changes : [];

      return `
        <div class="history-item">
          <div class="history-top">
            <strong>${escapeHtml(normalizeText(item.tipo || "Movimiento"))}</strong>
            <span>${escapeHtml(formatDateOnly(item.fecha) || "")}</span>
          </div>

          ${item.asunto ? `<div class="history-line"><strong>Asunto:</strong> ${escapeHtml(item.asunto)}</div>` : ""}
          ${item.mensaje ? `<div class="history-line"><strong>Detalle:</strong> ${escapeHtml(item.mensaje)}</div>` : ""}

          ${changes.length ? `
            <div class="history-line"><strong>Cambios:</strong></div>
            ${changes.map((change) => `
              <div class="history-line">• <strong>${escapeHtml(change.label || change.key || "Campo")}:</strong> ${escapeHtml(change.before || "vacío")} → ${escapeHtml(change.after || "vacío")}</div>
            `).join("")}
          ` : ""}

          <div class="history-line">
            <strong>Hecho por:</strong>
            ${escapeHtml(normalizeText(item.hechoPor || "—"))}
            ${item.hechoPorCorreo ? ` · ${escapeHtml(normalizeEmail(item.hechoPorCorreo))}` : ""}
          </div>
        </div>
      `;
    }).join("");
  } catch (error) {
    console.error(error);
    body.innerHTML = `<div class="history-empty">No se pudo cargar el historial.</div>`;
  }
}

function closeHistoryModal() {
  $("historyModal")?.classList.remove("show");
}

async function saveModal() {
  const canCreate = state.modalMode === "create" && canCreateCarteraRow();
  const canEdit = state.modalMode === "edit" && canEditCarteraRow(state.editingOriginal);

  if (!canCreate && !canEdit) return;

  const input = readModalInput();
  const validation = validateRowInput(input);
  if (validation) {
    alert(validation);
    return;
  }

  try {
    setProgressStatus({
      text: "Guardando registro...",
      meta: state.modalMode === "create" ? "Creando colegio..." : "Actualizando colegio...",
      progress: 20
    });

    let oldLogoPathToDelete = "";
    let historyPayload = null;

    if (state.modalMode === "create") {
      // El número SIEMPRE se construye según el vendedor elegido
      input.numeroColegio = await getNextNumeroColegioForVendor(input.correoVendedor);

      if (!input.numeroColegio) {
        alert("No se pudo generar el número consecutivo del vendedor.");
        return;
      }

      const newItemRef = doc(db, "ventas_cartera", input.correoVendedor, "items", input.numeroColegio);
      const newParentRef = doc(db, "ventas_cartera", input.correoVendedor);

      const exists = await getDoc(newItemRef);
      if (exists.exists()) {
        alert("Ya existe un colegio con ese N° dentro de la cartera de ese vendedor(a).");
        return;
      }

      let logoData = { logoUrl: "", logoPath: "" };

      if (state.pendingLogoFile) {
        setProgressStatus({
          text: "Guardando registro...",
          meta: "Subiendo logo...",
          progress: 45
        });

        logoData = await uploadSchoolLogo(state.pendingLogoFile, input);
      }

      await setDoc(newParentRef, buildParentVendorPayload(input), { merge: true });
      await setDoc(newItemRef, {
        ...buildItemPayload({ ...input, ...logoData }),
        creadoPor: normalizeEmail(state.realUser?.email || ""),
        fechaCreacion: serverTimestamp()
      }, { merge: true });

      historyPayload = {
        tipo: "Creación",
        asunto: "Colegio agregado a cartera",
        mensaje: `Se creó el colegio ${input.colegio} para ${buildVendorDisplayNameFromRow(input)} con el N° ${input.numeroColegio}.`,
        metadata: {
          changes: [
            { key: "numeroColegio", label: "N° Colegio", before: "", after: input.numeroColegio },
            { key: "vendedor", label: "Vendedor(a)", before: "", after: buildVendorDisplayNameFromRow(input) },
            { key: "colegio", label: "Colegio", before: "", after: input.colegio },
            { key: "comuna", label: "Comuna", before: "", after: input.comuna || "" },
            { key: "ciudad", label: "Ciudad", before: "", after: input.ciudad || "" },
            { key: "estatus", label: "Estatus", before: "", after: input.estatus || "" }
          ]
        }
      };

      await writeCarteraHistory({
        correoVendedor: input.correoVendedor,
        numeroColegio: input.numeroColegio,
        ...historyPayload
      });

      setProgressStatus({
        text: "Registro guardado.",
        meta: "Colegio agregado correctamente.",
        progress: 100,
        type: "success"
      });
    } else {
      const old = { ...state.editingOriginal };
      const oldItemRef = doc(db, "ventas_cartera", old.correoVendedor, "items", old.numeroColegio);

      const movingToAnotherVendor =
        normalizeEmail(old.correoVendedor) !== normalizeEmail(input.correoVendedor);

      // Si cambia de vendedor, el número cambia al siguiente de ese vendedor
      if (movingToAnotherVendor) {
        input.numeroColegio = await getNextNumeroColegioForVendor(input.correoVendedor);
      } else {
        input.numeroColegio = normalizeText(old.numeroColegio || input.numeroColegio || "");
      }

      if (!input.numeroColegio) {
        alert("No se pudo determinar el N° Colegio destino.");
        return;
      }

      const newItemRef = doc(db, "ventas_cartera", input.correoVendedor, "items", input.numeroColegio);
      const newParentRef = doc(db, "ventas_cartera", input.correoVendedor);

      const samePath =
        normalizeEmail(old.correoVendedor) === normalizeEmail(input.correoVendedor) &&
        normalizeText(old.numeroColegio) === normalizeText(input.numeroColegio);

      const existingData = samePath
        ? ((await getDoc(newItemRef)).data() || {})
        : ((await getDoc(oldItemRef)).data() || {});

      let logoUrl = String(existingData?.logoUrl || "").trim();
      let logoPath = String(existingData?.logoPath || "").trim();

      if (state.removeCurrentLogo) {
        oldLogoPathToDelete = logoPath || "";
        logoUrl = "";
        logoPath = "";
      }

      if (state.pendingLogoFile) {
        setProgressStatus({
          text: "Guardando registro...",
          meta: "Subiendo logo...",
          progress: 50
        });

        const uploadedLogo = await uploadSchoolLogo(state.pendingLogoFile, input);
        oldLogoPathToDelete = logoPath || "";
        logoUrl = uploadedLogo.logoUrl;
        logoPath = uploadedLogo.logoPath;
      }

      const changes = buildHistoryChanges(old, input);

      if (input.trabajado && (input.ultimaGestionTipo || input.ultimaGestionAsunto || input.ultimaGestionMensaje || input.fechaUltimaVisita)) {
        changes.push({
          key: "seguimiento",
          label: "Seguimiento",
          before: normalizeText(old.ultimaGestionTipo || ""),
          after: [input.ultimaGestionTipo, input.ultimaGestionAsunto, input.fechaUltimaVisita].filter(Boolean).join(" · ")
        });
      }

      if (samePath) {
        await setDoc(newParentRef, buildParentVendorPayload(input), { merge: true });
        await setDoc(newItemRef, {
          ...buildItemPayload({ ...input, logoUrl, logoPath }, existingData)
        }, { merge: true });

        await writeCarteraHistory({
          correoVendedor: input.correoVendedor,
          numeroColegio: input.numeroColegio,
          tipo: input.visitado ? "Seguimiento / visita" : "Edición",
          asunto: input.ultimaGestionAsunto || "Actualización de colegio en cartera",
          mensaje:
            input.ultimaGestionMensaje ||
            buildHistorySummaryForChanges(changes) ||
            "Se actualizó la información del colegio.",
          metadata: { changes }
        });
      } else {
        const targetExists = await getDoc(newItemRef);
        if (targetExists.exists()) {
          alert("Ya existe un colegio con ese N° en la cartera destino.");
          return;
        }

        // 1) registrar en historial origen ANTES de mover
        await writeCarteraHistory({
          correoVendedor: old.correoVendedor,
          numeroColegio: old.numeroColegio,
          tipo: "Reasignación",
          asunto: "Colegio movido de vendedor",
          mensaje: `Se movió el colegio ${old.colegio} desde ${buildVendorDisplayNameFromRow(old)} (${old.numeroColegio}) hacia ${buildVendorDisplayNameFromRow(input)} (${input.numeroColegio}).`,
          metadata: { changes }
        });

        // 2) mover documento
        const batch = writeBatch(db);

        batch.set(newParentRef, buildParentVendorPayload(input), { merge: true });
        batch.set(newItemRef, {
          ...buildItemPayload({ ...input, logoUrl, logoPath }, existingData),
          creadoPor: existingData?.creadoPor || normalizeEmail(state.realUser?.email || ""),
          fechaCreacion: existingData?.fechaCreacion || serverTimestamp()
        }, { merge: true });

        batch.delete(oldItemRef);
        await batch.commit();

        // 3) registrar en historial destino DESPUÉS de mover
        await writeCarteraHistory({
          correoVendedor: input.correoVendedor,
          numeroColegio: input.numeroColegio,
          tipo: "Reasignación",
          asunto: "Colegio recibido desde otro vendedor",
          mensaje: `Se recibió el colegio ${input.colegio} desde ${buildVendorDisplayNameFromRow(old)} (${old.numeroColegio}) hacia ${buildVendorDisplayNameFromRow(input)} (${input.numeroColegio}).`,
          metadata: { changes }
        });
      }

      if (oldLogoPathToDelete && oldLogoPathToDelete !== logoPath) {
        await deleteLogoFromStorage(oldLogoPathToDelete);
      }

      setProgressStatus({
        text: "Registro guardado.",
        meta: "Colegio actualizado correctamente.",
        progress: 100,
        type: "success"
      });
    }

    closeModal();
    clearProgressStatus();
    await loadData();
  } catch (error) {
    console.error(error);
    setProgressStatus({
      text: "Error guardando registro.",
      meta: error.message || "No se pudo guardar.",
      progress: 100,
      type: "error"
    });
  }
}

async function deleteRow(numeroColegio, correoVendedor) {
  if (!canManageVentasRole(state.effectiveUser)) return;

  const ok = confirm(`¿Seguro que quieres eliminar el colegio ${numeroColegio} de la cartera?`);
  if (!ok) return;

  try {
    setProgressStatus({
      text: "Eliminando registro...",
      meta: `${numeroColegio} · ${correoVendedor}`,
      progress: 30
    });

    const itemRef = doc(db, "ventas_cartera", normalizeEmail(correoVendedor), "items", String(numeroColegio));
    const snap = await getDoc(itemRef);
    const data = snap.exists() ? snap.data() : null;
    const logoPath = String(data?.logoPath || "").trim();

    await deleteDoc(itemRef);

    if (logoPath) {
      await deleteLogoFromStorage(logoPath);
    }

    setProgressStatus({
      text: "Registro eliminado.",
      meta: "El colegio fue eliminado correctamente.",
      progress: 100,
      type: "success"
    });
    clearProgressStatus();
    await loadData();
  } catch (error) {
    console.error(error);
    setProgressStatus({
      text: "Error eliminando registro.",
      meta: error.message || "No se pudo eliminar.",
      progress: 100,
      type: "error"
    });
  }
}

async function deleteSelectedRows() {
  if (!canManageVentasRole(state.effectiveUser)) return;
  if (!state.selectedKeys.size) return;

  const ok = confirm(`¿Seguro que quieres eliminar ${state.selectedKeys.size} colegio(s) seleccionados?`);
  if (!ok) return;

  try {
    const selectedEntries = [...state.selectedKeys].map((key) => {
      const [correoVendedor, numeroColegio] = key.split("__");
      return { correoVendedor, numeroColegio };
    });

    setProgressStatus({
      text: "Eliminando seleccionados...",
      meta: `Registros a eliminar: ${selectedEntries.length}`,
      progress: 15
    });

    let processed = 0;

    for (let i = 0; i < selectedEntries.length; i += WRITE_BATCH_LIMIT) {
      const chunk = selectedEntries.slice(i, i + WRITE_BATCH_LIMIT);
      const batch = writeBatch(db);

      chunk.forEach(({ correoVendedor, numeroColegio }) => {
        batch.delete(doc(db, "ventas_cartera", normalizeEmail(correoVendedor), "items", String(numeroColegio)));
      });

      await batch.commit();
      processed += chunk.length;

      const pct = 15 + Math.round((processed / selectedEntries.length) * 85);
      setProgressStatus({
        text: "Eliminando seleccionados...",
        meta: `Procesados: ${processed}/${selectedEntries.length}`,
        progress: pct
      });
    }

    state.selectedKeys.clear();

    setProgressStatus({
      text: "Eliminación lista.",
      meta: `${selectedEntries.length} registro(s) eliminados.`,
      progress: 100,
      type: "success"
    });
    clearProgressStatus();
    await loadData();
  } catch (error) {
    console.error(error);
    setProgressStatus({
      text: "Error eliminando seleccionados.",
      meta: error.message || "No se pudo completar la eliminación masiva.",
      progress: 100,
      type: "error"
    });
  }
}

/* =========================================================
   IMPORTAR XLSX
========================================================= */
function normalizeHeader(value = "") {
  return normalizeSearch(value).replace(/\s+/g, " ");
}

function mapImportRow(rawRow) {
  const normalized = {};
  Object.entries(rawRow || {}).forEach(([key, value]) => {
    normalized[normalizeHeader(key)] = normalizeText(value);
  });

  const getAny = (...keys) => {
    for (const key of keys) {
      const val = normalized[normalizeHeader(key)];
      if (val !== undefined) return val;
    }
    return "";
  };

  const alias = getAny("vendedor", "nombre vendedor", "vendedor(a)");
  const vendor = findVendorByAlias(alias);

  return {
    numeroColegio: getAny("nro", "numero colegio", "número colegio", "numero", "número"),
    colegio: getAny("colegio", "nombre colegio"),
    comuna: getAny("comuna"),
    estatus: getAny("estatus", "estado"),
    observaciones: "",
    ciudad: "",
    nombreVendedor: vendor?.nombre || "",
    apellidoVendedor: vendor?.apellido || "",
    correoVendedor: vendor?.email || "",
    vendedorAliasOriginal: alias,
    __sourceRow: rawRow?.__sourceRow || "",
    __sheetName: rawRow?.__sheetName || ""
  };
}

async function readWorkbookRows(file) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });

  const allRows = [];
  const sheetNames = workbook.SheetNames;

  for (let s = 0; s < sheetNames.length; s++) {
    const sheetName = workbook.SheetNames[s];
    const sheet = workbook.Sheets[sheetName];

    setProgressStatus({
      text: "Importando XLSX...",
      meta: `Leyendo hoja ${s + 1}/${sheetNames.length}: ${sheetName}`,
      progress: 5 + Math.round(((s + 1) / sheetNames.length) * 15)
    });

    const matrix = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: ""
    });

    if (!matrix.length) continue;

    // Buscar automáticamente la fila de encabezados
    let headerIndex = -1;

    for (let r = 0; r < matrix.length; r++) {
      const row = matrix[r].map(cell => normalizeHeader(cell));
      const hasNro = row.includes("nro") || row.includes("numero colegio") || row.includes("número colegio");
      const hasVendedor = row.includes("vendedor") || row.includes("nombre vendedor") || row.includes("vendedor(a)");
      const hasColegio = row.includes("colegio") || row.includes("nombre colegio");

      if (hasNro && hasVendedor && hasColegio) {
        headerIndex = r;
        break;
      }
    }

    if (headerIndex === -1) {
      continue;
    }

    const headers = matrix[headerIndex].map(h => normalizeText(h));

    for (let r = headerIndex + 1; r < matrix.length; r++) {
      const values = matrix[r] || [];

      // Saltar filas vacías
      const hasContent = values.some(v => normalizeText(v) !== "");
      if (!hasContent) continue;

      const obj = {};
      headers.forEach((header, idx) => {
        obj[header] = normalizeText(values[idx] ?? "");
      });

      allRows.push({
        ...obj,
        __sourceRow: r + 1,
        __sheetName: sheetName
      });
    }
  }

  return allRows;
}

async function importXlsx(file) {
  if (!canManageVentasRole(state.effectiveUser)) return;
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

    const rawRows = await readWorkbookRows(file);

    setProgressStatus({
      text: "Importando XLSX...",
      meta: `Filas detectadas: ${rawRows.length}`,
      progress: 20
    });

    if (!rawRows.length) {
      setProgressStatus({
        text: "Importación detenida.",
        meta: "El archivo no tiene filas útiles.",
        progress: 100,
        type: "error"
      });
      return;
    }

    const parsedRows = [];
    const errors = [];

    for (let i = 0; i < rawRows.length; i++) {
      const row = mapImportRow(rawRows[i]);
    
      if (!row.numeroColegio || !row.colegio || !row.vendedorAliasOriginal) {
        continue;
      }
    
      if (!row.correoVendedor) {
        errors.push(`Fila ${row.__sourceRow || i + 1}: no se pudo resolver el vendedor "${row.vendedorAliasOriginal}" con aliasCartera.`);
        continue;
      }
    
      parsedRows.push(row);
    
      const pct = 20 + Math.round(((i + 1) / rawRows.length) * 20);
      setProgressStatus({
        text: "Importando XLSX...",
        meta: `Validando filas... ${i + 1}/${rawRows.length}`,
        progress: pct
      });
    }

    if (errors.length) {
      setProgressStatus({
        text: "Importación detenida.",
        meta: errors.slice(0, 3).join(" | "),
        progress: 100,
        type: "error"
      });
      return;
    }

    if (!parsedRows.length) {
      setProgressStatus({
        text: "Importación detenida.",
        meta: "No quedaron filas válidas para guardar.",
        progress: 100,
        type: "error"
      });
      return;
    }

    const touchedVendors = new Map();
    let createdCount = 0;
    let updatedCount = 0;

    for (let i = 0; i < parsedRows.length; i++) {
      const row = parsedRows[i];
      const email = normalizeEmail(row.correoVendedor);

      if (!touchedVendors.has(email)) {
        touchedVendors.set(email, {
          correoVendedor: email,
          nombreVendedor: row.nombreVendedor,
          apellidoVendedor: row.apellidoVendedor
        });
      }

      const parentRef = doc(db, "ventas_cartera", email);
      const itemRef = doc(db, "ventas_cartera", email, "items", normalizeText(row.numeroColegio));
      const existingSnap = await getDoc(itemRef);
      const existingData = existingSnap.exists() ? existingSnap.data() : null;

      await setDoc(parentRef, buildParentVendorPayload({
        correoVendedor: email,
        nombreVendedor: row.nombreVendedor,
        apellidoVendedor: row.apellidoVendedor
      }), { merge: true });

      await setDoc(itemRef, {
        ...buildItemPayload(row, existingData),
        ...(existingSnap.exists()
          ? {}
          : {
              creadoPor: normalizeEmail(state.realUser?.email || ""),
              fechaCreacion: serverTimestamp()
            })
      }, { merge: true });

      if (existingSnap.exists()) {
        updatedCount += 1;
      } else {
        createdCount += 1;
      }

      const pct = 45 + Math.round(((i + 1) / parsedRows.length) * 55);
      setProgressStatus({
        text: "Importando XLSX...",
        meta: `Guardando filas... ${i + 1}/${parsedRows.length}`,
        progress: pct
      });
    }

    setProgressStatus({
      text: "Importación lista.",
      meta: `${createdCount} nuevos · ${updatedCount} actualizados · ${parsedRows.length} total`,
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
      meta: error.message || "No se pudo importar.",
      progress: 100,
      type: "error"
    });
  }
}

/* =========================================================
   EXPORTAR XLSX
========================================================= */
async function exportXlsx() {
  try {
    if (typeof XLSX === "undefined") {
      alert("No se encontró la librería XLSX.");
      return;
    }

    setProgressStatus({
      text: "Exportando XLSX...",
      meta: "Preparando datos visibles...",
      progress: 15
    });

    const exportRows = getSortedRows(state.filteredRows).map((row) => ({
      "NRO": row.numeroColegio,
      "VENDEDOR": `${row.nombreVendedor} ${row.apellidoVendedor}`.trim(),
      "COLEGIO": row.colegio,
      "COMUNA": row.comuna,
      "ESTATUS": row.estatus,
      "CIUDAD": row.ciudad,
      "OBSERVACIONES": row.observaciones
    }));

    setProgressStatus({
      text: "Exportando XLSX...",
      meta: `Registros a exportar: ${exportRows.length}`,
      progress: 45
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(exportRows);
    XLSX.utils.book_append_sheet(wb, ws, "Cartera");

    const filename = `cartera_${formatNowForFile()}.xlsx`;

    setProgressStatus({
      text: "Exportando XLSX...",
      meta: "Generando archivo...",
      progress: 80
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

/* =========================================================
   EVENTOS
========================================================= */
function bindPageEvents() {
  const trabajoFilter = $("trabajoFilter");
  const toggleIncludePast = $("toggleIncludePast");
  const historyModal = $("historyModal");
  const historyCloseBtn = $("historyCloseBtn");
  const historyCloseBtn2 = $("historyCloseBtn2");
  const searchInput = $("searchInput");
  const vendorFilter = $("vendorFilter");
  const statusFilter = $("statusFilter");
  const btnRecargar = $("btnRecargar");
  const btnAgregar = $("btnAgregar");
  const btnEliminarSeleccionados = $("btnEliminarSeleccionados");
  const btnGuardarModal = $("btnGuardarModal");
  const btnCancelarModal = $("btnCancelarModal");
  const modalCloseBtn = $("modalCloseBtn");
  const vendedorSelectModal = $("vendedorSelectModal");
  const logoInput = $("logoInput");
  const quitarLogoCheck = $("quitarLogoCheck");
  const fileInputXlsx = $("fileInputXlsx");
  const btnExportar = $("btnExportar");
  const pageSizeSelect = $("pageSizeSelect");
  const btnPrevPage = $("btnPrevPage");
  const btnNextPage = $("btnNextPage");
  const thead = document.querySelector(".cartera-table thead");
  const tbody = $("tbodyCartera");
  const modalBackdrop = $("modalForm");
  const btnAgregarContacto = $("btnAgregarContacto");
  const contactosContainer = $("contactosContainer");

  if (searchInput && !searchInput.dataset.bound) {
    searchInput.dataset.bound = "1";
    searchInput.addEventListener("input", (e) => {
      state.search = e.target.value || "";
      applyFilters();
    });
  }

  if (vendorFilter && !vendorFilter.dataset.bound) {
    vendorFilter.dataset.bound = "1";
    vendorFilter.addEventListener("change", (e) => {
      state.vendorFilter = normalizeEmail(e.target.value || "");
      applyFilters();
    });
  }

    if (statusFilter && !statusFilter.dataset.bound) {
    statusFilter.dataset.bound = "1";
    statusFilter.value = state.statusFilter || "ok";

    statusFilter.addEventListener("change", (e) => {
      state.statusFilter = e.target.value || "ok";
      applyFilters();
    });
  }

  if (btnRecargar && !btnRecargar.dataset.bound) {
    btnRecargar.dataset.bound = "1";
    btnRecargar.addEventListener("click", async () => {
      await loadData();
    });
  }

  if (btnAgregar && !btnAgregar.dataset.bound) {
    btnAgregar.dataset.bound = "1";
    btnAgregar.addEventListener("click", () => {
      if (!canManageVentasRole(state.effectiveUser)) return;
      openCreateModal();
    });
  }

  if (btnEliminarSeleccionados && !btnEliminarSeleccionados.dataset.bound) {
    btnEliminarSeleccionados.dataset.bound = "1";
    btnEliminarSeleccionados.addEventListener("click", deleteSelectedRows);
  }

  if (btnGuardarModal && !btnGuardarModal.dataset.bound) {
    btnGuardarModal.dataset.bound = "1";
    btnGuardarModal.addEventListener("click", saveModal);
  }

  if (btnCancelarModal && !btnCancelarModal.dataset.bound) {
    btnCancelarModal.dataset.bound = "1";
    btnCancelarModal.addEventListener("click", closeModal);
  }

  if (modalCloseBtn && !modalCloseBtn.dataset.bound) {
    modalCloseBtn.dataset.bound = "1";
    modalCloseBtn.addEventListener("click", closeModal);
  }

  if (vendedorSelectModal && !vendedorSelectModal.dataset.bound) {
    vendedorSelectModal.dataset.bound = "1";
    vendedorSelectModal.addEventListener("change", async () => {
      await updateVendorPreview();
    });
  }

  if (logoInput && !logoInput.dataset.bound) {
    logoInput.dataset.bound = "1";
    logoInput.addEventListener("change", (e) => {
      const file = e.target.files?.[0] || null;

      if (file && !String(file.type || "").startsWith("image/")) {
        alert("El archivo debe ser una imagen válida.");
        e.target.value = "";
        return;
      }

      state.pendingLogoFile = file;

      if (file) {
        state.removeCurrentLogo = false;
        if ($("quitarLogoCheck")) $("quitarLogoCheck").checked = false;
      }

      refreshLogoPreview();
    });
  }

  if (quitarLogoCheck && !quitarLogoCheck.dataset.bound) {
    quitarLogoCheck.dataset.bound = "1";
    quitarLogoCheck.addEventListener("change", (e) => {
      state.removeCurrentLogo = !!e.target.checked;

      if (state.removeCurrentLogo) {
        state.pendingLogoFile = null;
        if ($("logoInput")) $("logoInput").value = "";
      }

      refreshLogoPreview();
    });
  }

  if (fileInputXlsx && !fileInputXlsx.dataset.bound) {
    fileInputXlsx.dataset.bound = "1";
    fileInputXlsx.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      await importXlsx(file);
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
        state.sort.dir = "asc";
      }

      state.currentPage = 1;
      renderTable();
    });

    thead.addEventListener("change", (e) => {
      const target = e.target;
      if (!(target instanceof HTMLInputElement)) return;
      if (target.id !== "checkAllRows") return;

      const checked = !!target.checked;

      state.pageRows.forEach((row) => {
        const rowKey = `${normalizeEmail(row.correoVendedor)}__${String(row.numeroColegio)}`;
        if (checked) {
          state.selectedKeys.add(rowKey);
        } else {
          state.selectedKeys.delete(rowKey);
        }
      });

      renderTable();
    });
  }

  if (tbody && !tbody.dataset.bound) {
    tbody.dataset.bound = "1";
    tbody.addEventListener("click", async (e) => {
      const rowCheck = e.target.closest('input[data-action="toggle-row"]');
      if (rowCheck) {
        const key = rowCheck.dataset.key || "";
        if (rowCheck.checked) {
          state.selectedKeys.add(key);
        } else {
          state.selectedKeys.delete(key);
        }
        renderTable();
        return;
      }

      const btn = e.target.closest("button[data-action]");
      if (!btn) return;

      const action = btn.dataset.action;
      const numeroColegio = btn.dataset.id || "";
      const correoVendedor = normalizeEmail(btn.dataset.email || "");

      const row = state.rows.find(r =>
        String(r.numeroColegio) === String(numeroColegio) &&
        normalizeEmail(r.correoVendedor) === correoVendedor
      );

      if (!row) return;

      if (action === "edit") openEditModal(row);
      if (action === "delete") await deleteRow(numeroColegio, correoVendedor);
      if (action === "history") await openHistoryModal(row);
    });
  }

  if (modalBackdrop && !modalBackdrop.dataset.bound) {
    modalBackdrop.dataset.bound = "1";
    modalBackdrop.addEventListener("click", (e) => {
      if (e.target === modalBackdrop) closeModal();
    });
  }
  if (trabajoFilter && !trabajoFilter.dataset.bound) {
    trabajoFilter.dataset.bound = "1";
    trabajoFilter.addEventListener("change", (e) => {
      state.trabajoFilter = e.target.value || "all";
      applyFilters();
    });
  }
  
  if (toggleIncludePast && !toggleIncludePast.dataset.bound) {
    toggleIncludePast.dataset.bound = "1";
    toggleIncludePast.addEventListener("change", (e) => {
      state.includePastYears = !!e.target.checked;
      state.rows = state.rows.map((row) => ({
        ...row,
        metrics: computeRowMetrics(row)
      }));
      applyFilters();
    });
  }
  
  if (historyCloseBtn && !historyCloseBtn.dataset.bound) {
    historyCloseBtn.dataset.bound = "1";
    historyCloseBtn.addEventListener("click", closeHistoryModal);
  }
  
  if (historyCloseBtn2 && !historyCloseBtn2.dataset.bound) {
    historyCloseBtn2.dataset.bound = "1";
    historyCloseBtn2.addEventListener("click", closeHistoryModal);
  }
  
  if (historyModal && !historyModal.dataset.bound) {
    historyModal.dataset.bound = "1";
    historyModal.addEventListener("click", (e) => {
      if (e.target === historyModal) closeHistoryModal();
    });
  }

  if (btnAgregarContacto && !btnAgregarContacto.dataset.bound) {
    btnAgregarContacto.dataset.bound = "1";
    btnAgregarContacto.addEventListener("click", () => {
      addContactoItem(createEmptyContact());
    });
  }

  if (contactosContainer && !contactosContainer.dataset.bound) {
    contactosContainer.dataset.bound = "1";
  
    contactosContainer.addEventListener("click", (e) => {
      const btn = e.target.closest('button[data-action="remove-contact"]');
      if (!btn) return;
  
      const item = btn.closest(".contacto-item");
      if (!item) return;
  
      const index = Number(item.dataset.index || "-1");
      if (index < 0) return;
  
      removeContactoItemByIndex(index);
    });
  }
}



/* =========================================================
   INIT
========================================================= */
async function bootstrapFromSession() {
  state.vendors = getVendorUsers();
  state.realUser = getRealUser();
  state.effectiveUser = getEffectiveUser();
  state.search = "";

  if (!state.realUser || !state.effectiveUser) return;

  state.vendorFilter = isVendedorRole(state.effectiveUser)
    ? normalizeEmail(state.effectiveUser.email)
    : "";
}

async function initPage() {
  await waitForLayoutReady();

  await bootstrapFromSession();
  bindHeaderActions();
  bindPageEvents();

  if (state.effectiveUser) {
    renderHeaderState();
    renderRoleButtons();
    renderVendorFilter();
  }

  onAuthStateChanged(auth, async (user) => {
    if (!user) return;
  
    await bootstrapFromSession();
  
    renderHeaderState();
    bindHeaderActions(); // ← volver a enlazar navegar como / volver a mi usuario
  
    renderRoleButtons();
    renderVendorFilter();
  
    await loadData();
  });
}
initPage();
