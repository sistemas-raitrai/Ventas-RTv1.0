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
  },
  pendingAssignmentReview: null
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

function canViewAsignados(user = {}) {
  const role = getRoleKey(user);
  return role === "admin" || role === "supervision" || role === "registro";
}

function canEditAsignados(user = {}) {
  const role = getRoleKey(user);
  return role === "admin" || role === "supervision";
}

function assertAccess() {
  if (!canViewAsignados(state.effectiveUser)) {
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

const GENERIC_SCHOOL_TOKENS = new Set([
  "colegio",
  "liceo",
  "escuela",
  "school",
  "instituto",
  "institucion",
  "centro",
  "educacional",
  "particular",
  "subvencionado",
  "municipal"
]);

function normalizeLooseText(value = "") {
  return normalizeLoose(value)
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueLooseTokens(value = "") {
  return [...new Set(normalizeLooseText(value).split(" ").filter(Boolean))];
}

function normalizeSchoolLoose(value = "") {
  return uniqueLooseTokens(value)
    .filter((token) => !GENERIC_SCHOOL_TOKENS.has(token))
    .sort()
    .join(" ");
}

function normalizePersonLoose(value = "") {
  return uniqueLooseTokens(value).join(" ");
}

function normalizePhoneLoose(value = "") {
  let digits = String(value || "").replace(/\D/g, "");

  if (digits.startsWith("56")) digits = digits.slice(2);
  if (digits.startsWith("9")) digits = digits.slice(1);

  return digits.slice(-8);
}

function normalizeCourseLoose(value = "") {
  return normalizeText(value).toUpperCase().replace(/\s+/g, "");
}

function extractCourseNumber(value = "") {
  const match = normalizeCourseLoose(value).match(/^(11|10|[1-9])/);
  return match ? Number(match[1]) : null;
}

function levenshteinDistance(a = "", b = "") {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix = Array.from({ length: rows }, () => Array(cols).fill(0));

  for (let i = 0; i < rows; i += 1) matrix[i][0] = i;
  for (let j = 0; j < cols; j += 1) matrix[0][j] = j;

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;

      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return matrix[a.length][b.length];
}

function similarityRatio(a = "", b = "") {
  if (!a || !b) return 0;
  if (a === b) return 1;

  const maxLen = Math.max(a.length, b.length);
  if (!maxLen) return 0;

  return 1 - (levenshteinDistance(a, b) / maxLen);
}

function tokenOverlapRatio(tokensA = [], tokensB = []) {
  if (!tokensA.length || !tokensB.length) return 0;

  const setB = new Set(tokensB);
  const overlap = tokensA.filter((token) => setB.has(token)).length;

  return overlap / Math.max(tokensA.length, tokensB.length);
}

function containsLooseRatio(a = "", b = "") {
  if (!a || !b) return 0;
  if (a.includes(b) || b.includes(a)) {
    return Math.min(a.length, b.length) / Math.max(a.length, b.length);
  }
  return 0;
}

function getSchoolSimilarity(a = "", b = "") {
  const normA = normalizeSchoolLoose(a);
  const normB = normalizeSchoolLoose(b);

  const tokensA = normA.split(" ").filter(Boolean);
  const tokensB = normB.split(" ").filter(Boolean);

  return Math.max(
    similarityRatio(normA, normB),
    tokenOverlapRatio(tokensA, tokensB),
    containsLooseRatio(normA, normB)
  );
}

function getNameSimilarity(a = "", b = "") {
  const normA = normalizePersonLoose(a);
  const normB = normalizePersonLoose(b);

  const tokensA = normA.split(" ").filter(Boolean);
  const tokensB = normB.split(" ").filter(Boolean);

  return Math.max(
    similarityRatio(normA, normB),
    tokenOverlapRatio(tokensA, tokensB),
    containsLooseRatio(normA, normB)
  );
}

function getCourseSimilarity(a = "", b = "") {
  const courseA = normalizeCourseLoose(a);
  const courseB = normalizeCourseLoose(b);

  if (!courseA || !courseB) return 0;
  if (courseA === courseB) return 1;

  const numberA = extractCourseNumber(courseA);
  const numberB = extractCourseNumber(courseB);

  if (numberA !== null && numberA === numberB) {
    return 0.88;
  }

  return 0;
}

function pushUniqueReason(reasons = [], text = "") {
  if (!text) return;
  if (!reasons.includes(text)) reasons.push(text);
}

function getAssignmentAlertLevel(score = 0, hardSignals = 0) {
  if (hardSignals > 0 || score >= 78) return "Alta";
  if (score >= 52) return "Media";
  return "Leve";
}

function getAssignmentAlertLevelClass(level = "") {
  if (level === "Alta") return "high";
  if (level === "Media") return "medium";
  return "low";
}

function summarizeAssignmentAlerts(alerts = [], targetVendorName = "") {
  const high = alerts.filter((item) => item.level === "Alta").length;
  const medium = alerts.filter((item) => item.level === "Media").length;
  const low = alerts.filter((item) => item.level === "Leve").length;

  return `Vas a asignar este grupo a ${targetVendorName || "la vendedora seleccionada"}. Se encontraron ${alerts.length} coincidencia(s): ${high} alta(s), ${medium} media(s) y ${low} leve(s). Revisa especialmente los grupos que hoy pertenecen a otro vendedor o siguen sin asignar.`;
}

function findPotentialAssignmentAlerts(sourceRow = {}, targetVendor = {}) {
  const currentId = getRowId(sourceRow);
  const targetEmail = normalizeEmail(targetVendor.email || "");
  const sourceYear = getAnoViajeNumber(sourceRow);
  const sourceComuna = normalizeSearch(sourceRow.comunaCiudad || sourceRow.comuna || "");

  const sourceNames = [sourceRow.nombreCliente, sourceRow.nombreCliente2]
    .map((value) => normalizeText(value))
    .filter(Boolean);

  const sourceEmails = [sourceRow.correoCliente, sourceRow.correoCliente2]
    .map((value) => normalizeEmail(value))
    .filter(Boolean);

  const sourcePhones = [sourceRow.celularCliente, sourceRow.celularCliente2]
    .map((value) => normalizePhoneLoose(value))
    .filter(Boolean);

  const results = [];

  state.rows.forEach((candidate) => {
    if (getRowId(candidate) === currentId) return;

    let score = 0;
    let hardSignals = 0;
    const reasons = [];

    const schoolSimilarity = getSchoolSimilarity(
      sourceRow.colegio || sourceRow.colegioBase || "",
      candidate.colegio || candidate.colegioBase || ""
    );

    if (schoolSimilarity >= 0.95) {
      score += 30;
      pushUniqueReason(reasons, "Colegio muy parecido");
    } else if (schoolSimilarity >= 0.82) {
      score += 18;
      pushUniqueReason(reasons, "Colegio parecido");
    }

    const candidateComuna = normalizeSearch(candidate.comunaCiudad || candidate.comuna || "");
    if (sourceComuna && candidateComuna && sourceComuna === candidateComuna) {
      score += 10;
      pushUniqueReason(reasons, "Misma comuna/ciudad");
    }

    const candidateYear = getAnoViajeNumber(candidate);
    if (sourceYear && candidateYear) {
      if (candidateYear === sourceYear) {
        score += 18;
        pushUniqueReason(reasons, `Mismo año de viaje (${candidateYear})`);
      } else if (candidateYear >= sourceYear && candidateYear <= sourceYear + 1) {
        score += 8;
        pushUniqueReason(reasons, `Año de viaje cercano (${candidateYear})`);
      }
    }

    const courseSimilarity = Math.max(
      getCourseSimilarity(sourceRow.curso || "", candidate.curso || ""),
      getCourseSimilarity(sourceRow.cursoViaje || "", candidate.cursoViaje || "")
    );

    if (courseSimilarity >= 1) {
      score += 16;
      pushUniqueReason(reasons, "Mismo curso");
    } else if (courseSimilarity >= 0.88) {
      score += 10;
      pushUniqueReason(reasons, "Curso parecido / misma numeración con otra letra");
    }

    const candidateNames = [candidate.nombreCliente, candidate.nombreCliente2]
      .map((value) => normalizeText(value))
      .filter(Boolean);

    let bestNameMatch = { score: 0, value: "" };

    sourceNames.forEach((inputName) => {
      candidateNames.forEach((candidateName) => {
        const sim = getNameSimilarity(inputName, candidateName);
        if (sim > bestNameMatch.score) {
          bestNameMatch = { score: sim, value: candidateName };
        }
      });
    });

    if (bestNameMatch.score >= 0.97) {
      score += 30;
      hardSignals += 1;
      pushUniqueReason(reasons, `Contacto muy parecido: ${bestNameMatch.value}`);
    } else if (bestNameMatch.score >= 0.88) {
      score += 18;
      pushUniqueReason(reasons, `Contacto parecido: ${bestNameMatch.value}`);
    }

    const candidateEmails = [candidate.correoCliente, candidate.correoCliente2]
      .map((value) => normalizeEmail(value))
      .filter(Boolean);

    const matchedEmail = sourceEmails.find((email) => email && candidateEmails.includes(email));
    if (matchedEmail) {
      score += 60;
      hardSignals += 1;
      pushUniqueReason(reasons, `Mismo correo: ${matchedEmail}`);
    }

    const candidatePhones = [candidate.celularCliente, candidate.celularCliente2]
      .map((value) => normalizePhoneLoose(value))
      .filter(Boolean);

    const matchedPhone = sourcePhones.find((phone) => phone && candidatePhones.includes(phone));
    if (matchedPhone) {
      score += 55;
      hardSignals += 1;
      pushUniqueReason(reasons, `Mismo celular terminado en ${matchedPhone}`);
    }

    const candidateVendorEmail = getRowVendorEmail(candidate);
    const candidateVendorName = getRowVendorName(candidate) || "Sin asignar";

    let relationship = "same";
    let relationshipLabel = "Mismo vendedor destino";
    let relationshipClass = "same";

    if (isSinAsignar(candidate)) {
      relationship = "unassigned";
      relationshipLabel = "Hoy está Sin asignar";
      relationshipClass = "unassigned";
      score += 14;
      pushUniqueReason(reasons, "El grupo parecido hoy está Sin asignar");
    } else if (candidateVendorEmail && candidateVendorEmail !== targetEmail) {
      relationship = "other";
      relationshipLabel = `Hoy pertenece a ${candidateVendorName}`;
      relationshipClass = "other";
      score += 24;
      if (schoolSimilarity >= 0.82 || bestNameMatch.score >= 0.88 || matchedEmail || matchedPhone) {
        hardSignals += 1;
      }
      pushUniqueReason(reasons, `Hoy pertenece a otro vendedor: ${candidateVendorName}`);
    } else if (candidateVendorEmail === targetEmail) {
      score += 4;
      pushUniqueReason(reasons, "Ya existe un grupo parecido del mismo vendedor destino");
    }

    const shouldKeep =
      hardSignals > 0 ||
      score >= 42 ||
      ((schoolSimilarity >= 0.82 || bestNameMatch.score >= 0.88) && candidateYear && sourceYear && candidateYear === sourceYear);

    if (!shouldKeep) return;

    const level = getAssignmentAlertLevel(score, hardSignals);

    results.push({
      idGrupo: getRowId(candidate),
      codigoRegistro: normalizeText(candidate.codigoRegistro || ""),
      aliasGrupo: getRowAlias(candidate),
      colegio: normalizeText(candidate.colegio || ""),
      comunaCiudad: normalizeText(candidate.comunaCiudad || candidate.comuna || ""),
      anoViaje: normalizeText(candidate.anoViaje || ""),
      curso: normalizeText(candidate.cursoViaje || candidate.curso || ""),
      cliente: normalizeText(candidate.nombreCliente || candidate.nombreCliente2 || "—"),
      estado: normalizeText(candidate.estado || "—"),
      vendedora: candidateVendorName,
      level,
      levelClass: getAssignmentAlertLevelClass(level),
      relationship,
      relationshipLabel,
      relationshipClass,
      score,
      reasons,
      url: `${DETALLE_GRUPO_URL}?id=${encodeURIComponent(getRowId(candidate))}`
    });
  });

  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);
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

  const canEdit = canEditAsignados(state.effectiveUser);

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
    const comuna = normalizeText(row.comunaCiudad || row.comuna || "—");
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
        <td>${escapeHtml(comuna)}</td>
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
          ${canEdit
            ? buildVendorSelect(row)
            : `<span style="color:#6b6475;font-weight:600;">Solo lectura</span>`}
        </td>
        <td>
          <div class="table-actions">
            ${canEdit ? `
              <button class="btn-mini edit" data-action="save-assignment" data-id="${escapeHtml(idGrupo)}">
                ${state.tab === "sin_asignar" ? "Asignar" : "Guardar"}
              </button>

              ${state.tab === "asignados" ? `
                <button class="btn-mini warn" data-action="remove-assignment" data-id="${escapeHtml(idGrupo)}">
                  Quitar asignación
                </button>
              ` : ""}
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

function renderAssignmentAlertModal({ row = {}, vendor = {}, alerts = [] } = {}) {
  const title = $("assignmentAlertTitle");
  const summary = $("assignmentAlertSummary");
  const list = $("assignmentAlertList");

  if (title) {
    title.textContent = `Posibles coincidencias antes de asignar a ${vendor.nombre || "la vendedora seleccionada"}`;
  }

  if (summary) {
    summary.textContent = summarizeAssignmentAlerts(alerts, vendor.nombre || "");
  }

  if (!list) return;

  if (!alerts.length) {
    list.innerHTML = `<div class="assignment-alert-empty">No hay coincidencias para revisar.</div>`;
    return;
  }

  list.innerHTML = alerts.map((item) => `
    <article class="assignment-alert-item">
      <div class="assignment-alert-top">
        <div>
          <h4 class="assignment-alert-title">${escapeHtml(item.aliasGrupo || "Grupo sin alias")}</h4>
          <div class="assignment-alert-meta">
            ${escapeHtml(item.codigoRegistro || "Sin código")} · ID ${escapeHtml(item.idGrupo || "—")}
          </div>
        </div>

        <div class="assignment-alert-tags">
          <span class="assignment-pill ${escapeHtml(item.levelClass)}">${escapeHtml(item.level)}</span>
          <span class="assignment-pill ${escapeHtml(item.relationshipClass)}">${escapeHtml(item.relationshipLabel)}</span>
        </div>
      </div>

      <div class="assignment-alert-grid">
        <div class="assignment-alert-row"><strong>Colegio:</strong> ${escapeHtml(item.colegio || "—")}</div>
        <div class="assignment-alert-row"><strong>Curso:</strong> ${escapeHtml(item.curso || "—")}</div>
        <div class="assignment-alert-row"><strong>Año viaje:</strong> ${escapeHtml(item.anoViaje || "—")}</div>
        <div class="assignment-alert-row"><strong>Comuna:</strong> ${escapeHtml(item.comunaCiudad || "—")}</div>
        <div class="assignment-alert-row"><strong>Cliente:</strong> ${escapeHtml(item.cliente || "—")}</div>
        <div class="assignment-alert-row"><strong>Estado:</strong> ${escapeHtml(item.estado || "—")}</div>
        <div class="assignment-alert-row"><strong>Vendedor actual:</strong> ${escapeHtml(item.vendedora || "Sin asignar")}</div>
        <div class="assignment-alert-row"><strong>Puntaje:</strong> ${escapeHtml(String(item.score || 0))}</div>
      </div>

      <ul class="assignment-alert-reasons">
        ${item.reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join("")}
      </ul>

      <a class="assignment-alert-link" href="${item.url}" target="_blank" rel="noopener">
        Abrir grupo
      </a>
    </article>
  `).join("");
}

function openAssignmentAlertModal(payload = {}) {
  renderAssignmentAlertModal(payload);
  $("assignmentAlertModal")?.classList.add("show");
}

function closeAssignmentAlertModal() {
  $("assignmentAlertModal")?.classList.remove("show");
}

function clearAssignmentAlertReviewState() {
  state.pendingAssignmentReview = null;
  closeAssignmentAlertModal();
}

async function writeAssignmentAlertReviewHistory({
  idGrupo,
  vendor = {},
  alerts = []
} = {}) {
  if (!alerts.length) return;

  const ref = doc(collection(db, "ventas_cotizaciones", String(idGrupo), "historialAsignaciones"));

  await setDoc(ref, {
    idGrupo: String(idGrupo),
    tipo: "Alerta previa de asignación",
    campo: "vendedora",
    vendedorObjetivo: normalizeText(vendor.nombre || ""),
    vendedorObjetivoCorreo: normalizeEmail(vendor.email || ""),
    totalCoincidencias: alerts.length,
    coincidencias: alerts.map((item) => ({
      idGrupo: item.idGrupo,
      codigoRegistro: item.codigoRegistro,
      aliasGrupo: item.aliasGrupo,
      colegio: item.colegio,
      curso: item.curso,
      anoViaje: item.anoViaje,
      cliente: item.cliente,
      estado: item.estado,
      vendedora: item.vendedora,
      level: item.level,
      score: item.score,
      relationship: item.relationship,
      reasons: item.reasons
    })),
    hechoPor: getNombreUsuario(state.effectiveUser),
    hechoPorCorreo: normalizeEmail(state.realUser?.email || ""),
    fecha: serverTimestamp()
  });
}

async function persistAssignment({
  row,
  vendor,
  tipo,
  alerts = [],
  confirmedAfterReview = false
} = {}) {
  const idGrupo = getRowId(row);
  const anteriorVendedora = getRowVendorName(row) || "Sin asignar";
  const anteriorVendedoraCorreo = getRowVendorEmail(row) || "";
  const nuevaVendedora = vendor.nombre;
  const nuevaVendedoraCorreo = vendor.email;

  setProgressStatus({
    text: `${tipo} en proceso...`,
    meta: `Grupo ${idGrupo}`,
    progress: confirmedAfterReview ? 70 : 40
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

  if (confirmedAfterReview && alerts.length) {
    await writeAssignmentAlertReviewHistory({
      idGrupo,
      vendor,
      alerts
    });
  }

  setProgressStatus({
    text: `${tipo} realizada.`,
    meta: `Grupo ${idGrupo} actualizado.`,
    progress: 100,
    type: "success"
  });
  clearProgressStatus();

  await loadData();

  alert(
    tipo === "Asignación"
      ? `El grupo ${idGrupo} fue asignado a ${nuevaVendedora}.`
      : `El grupo ${idGrupo} fue reasignado a ${nuevaVendedora}.`
  );
}

async function continueAssignmentAfterAlertReview() {
  const pending = state.pendingAssignmentReview;
  if (!pending) return;

  const continueBtn = $("assignmentAlertContinueBtn");
  if (continueBtn) continueBtn.disabled = true;

  try {
    const currentRow =
      state.rows.find((item) => getRowId(item) === pending.idGrupo) ||
      pending.row;

    const currentVendor =
      findVendorByEmail(pending.vendor.email || "") ||
      pending.vendor;

    closeAssignmentAlertModal();

    await persistAssignment({
      row: currentRow,
      vendor: currentVendor,
      tipo: pending.tipo,
      alerts: pending.alerts,
      confirmedAfterReview: true
    });

    state.pendingAssignmentReview = null;
  } catch (error) {
    console.error(error);
    setProgressStatus({
      text: "Error guardando la asignación.",
      meta: error.message || "No se pudo completar la asignación luego de la revisión.",
      progress: 100,
      type: "error"
    });
  } finally {
    if (continueBtn) continueBtn.disabled = false;
  }
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
  if (!canEditAsignados(state.effectiveUser)) {
    alert("No tienes permisos para asignar vendedores.");
    return;
  }

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
      text: `Revisando ${tipo.toLowerCase()}...`,
      meta: `Buscando grupos parecidos para ${idGrupo}`,
      progress: 28
    });

    const alerts = findPotentialAssignmentAlerts(row, vendor);

    if (alerts.length) {
      clearProgressStatus();
      state.pendingAssignmentReview = {
        idGrupo: getRowId(row),
        row,
        vendor,
        tipo,
        alerts
      };

      openAssignmentAlertModal({
        row,
        vendor,
        alerts
      });
      return;
    }

    await persistAssignment({
      row,
      vendor,
      tipo,
      alerts: [],
      confirmedAfterReview: false
    });
  } catch (error) {
    console.error(error);
    setProgressStatus({
      text: `Error en ${tipo.toLowerCase()}.`,
      meta: error.message || "No se pudo preparar la asignación.",
      progress: 100,
      type: "error"
    });
  }
}

async function removeAssignment(idGrupo) {
    if (!canEditAsignados(state.effectiveUser)) {
    alert("No tienes permisos para quitar asignaciones.");
    return;
  }
  
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

    alert(`El grupo ${idGrupo} quedó Sin asignar.`);
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
  
  const assignmentAlertModal = $("assignmentAlertModal");
  const assignmentAlertCloseBtn = $("assignmentAlertCloseBtn");
  const assignmentAlertBackBtn = $("assignmentAlertBackBtn");
  const assignmentAlertContinueBtn = $("assignmentAlertContinueBtn");

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
      const canEdit = canEditAsignados(state.effectiveUser);

      if (action === "save-assignment") {
        if (!canEdit) {
          alert("Estás en modo solo lectura.");
          return;
        }
        await saveAssignment(id);
        return;
      }

      if (action === "remove-assignment") {
        if (!canEdit) {
          alert("Estás en modo solo lectura.");
          return;
        }
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

  if (assignmentAlertCloseBtn && !assignmentAlertCloseBtn.dataset.bound) {
  assignmentAlertCloseBtn.dataset.bound = "1";
  assignmentAlertCloseBtn.addEventListener("click", clearAssignmentAlertReviewState);
  }
  
  if (assignmentAlertBackBtn && !assignmentAlertBackBtn.dataset.bound) {
    assignmentAlertBackBtn.dataset.bound = "1";
    assignmentAlertBackBtn.addEventListener("click", clearAssignmentAlertReviewState);
  }
  
  if (assignmentAlertContinueBtn && !assignmentAlertContinueBtn.dataset.bound) {
    assignmentAlertContinueBtn.dataset.bound = "1";
    assignmentAlertContinueBtn.addEventListener("click", continueAssignmentAfterAlertReview);
  }
  
  if (assignmentAlertModal && !assignmentAlertModal.dataset.bound) {
    assignmentAlertModal.dataset.bound = "1";
    assignmentAlertModal.addEventListener("click", (e) => {
      if (e.target === assignmentAlertModal) {
        clearAssignmentAlertReviewState();
      }
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
