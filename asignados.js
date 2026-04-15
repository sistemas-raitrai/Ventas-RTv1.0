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
  "college",
  "academy",
  "academia",
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

function getMeaningfulSchoolTokens(value = "") {
  return uniqueLooseTokens(value)
    .filter((token) => !GENERIC_SCHOOL_TOKENS.has(token));
}

function getSharedSchoolTokens(a = "", b = "") {
  const tokensA = getMeaningfulSchoolTokens(a);
  const tokensB = getMeaningfulSchoolTokens(b);
  const setB = new Set(tokensB);

  return tokensA.filter((token) => setB.has(token));
}

function hasStrongSchoolNameMatch(a = "", b = "") {
  const shared = getSharedSchoolTokens(a, b);

  // Caso fuerte: comparten 2 o más tokens relevantes
  if (shared.length >= 2) return true;

  // Caso adicional: comparten 1 token largo/importante
  return shared.some((token) => token.length >= 6);
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

function normalizeStage(value = "") {
  const raw = normalizeLoose(value);

  if (!raw) return "";
  if (raw.includes("reunion")) return "reunion_confirmada";
  if (raw.includes("cotiz")) return "cotizando";
  if (raw.includes("contactad")) return "contactado";
  if (raw.includes("ganad")) return "ganada";
  if (raw.includes("perdid")) return "perdida";
  if (raw.includes("a contactar")) return "a_contactar";

  return raw;
}

function isFinalStage(stage = "") {
  return stage === "ganada" || stage === "perdida";
}

function isActiveStage(stage = "") {
  return !isFinalStage(stage);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getCurrentCommercialYear() {
  return new Date().getFullYear();
}

function isCurrentOrFutureTravelYear(row = {}) {
  const year = getAnoViajeNumber(row);
  if (!year) return false;
  return year >= getCurrentCommercialYear();
}

function getSchoolMatchInfo(sourceRow = {}, candidate = {}) {
  const sourceSchoolRaw = sourceRow.colegio || sourceRow.colegioBase || "";
  const candidateSchoolRaw = candidate.colegio || candidate.colegioBase || "";

  const sourceSchool = normalizeSchoolLoose(sourceSchoolRaw);
  const candidateSchool = normalizeSchoolLoose(candidateSchoolRaw);

  const schoolSimilarity = getSchoolSimilarity(sourceSchoolRaw, candidateSchoolRaw);

  const sourceComuna = normalizeSearch(sourceRow.comunaCiudad || sourceRow.comuna || "");
  const candidateComuna = normalizeSearch(candidate.comunaCiudad || candidate.comuna || "");

  const sameExactSchool = Boolean(sourceSchool && candidateSchool && sourceSchool === candidateSchool);
  const sameComuna = Boolean(sourceComuna && candidateComuna && sourceComuna === candidateComuna);

  const sharedTokens = getSharedSchoolTokens(sourceSchoolRaw, candidateSchoolRaw);
  const strongNameMatch = hasStrongSchoolNameMatch(sourceSchoolRaw, candidateSchoolRaw);

  let matchType = "none";
  let label = "Sin coincidencia relevante";

  if (sameExactSchool && sameComuna) {
    matchType = "same_school_same_comuna";
    label = "Mismo colegio + misma comuna";
  } else if (sameExactSchool) {
    matchType = "same_school";
    label = "Mismo colegio";
  } else if (strongNameMatch && sameComuna) {
    matchType = "strong_name_same_comuna";
    label = "Nombre muy relacionado + misma comuna";
  } else if (schoolSimilarity >= 0.90 && sameComuna) {
    matchType = "similar_school_same_comuna";
    label = "Colegio similar + misma comuna";
  } else if (schoolSimilarity >= 0.82) {
    matchType = "similar_school";
    label = "Colegio similar";
  } else if (sameComuna) {
    matchType = "same_comuna_only";
    label = "Otro colegio en la misma comuna";
  }

  return {
    isRelevant: matchType !== "none",
    matchType,
    label,
    schoolSimilarity,
    sameExactSchool,
    sameComuna,
    strongNameMatch,
    sharedTokens
  };
}

function createVendorRecommendationBase(vendor = {}) {
  return {
    vendorEmail: normalizeEmail(vendor.email || ""),
    vendorName: normalizeText(vendor.nombre || ""),

    // Carga global del vendedor
    totalAssignedCount: 0,
    totalActiveCount: 0,
    totalAContactarCount: 0,
    totalContactadoCount: 0,
    totalCotizandoCount: 0,
    totalReunionCount: 0,
    totalGanadaCount: 0,
    totalPerdidaCount: 0,

    // Cartera actual (año actual hacia futuro)
    currentPortfolioCount: 0,
    currentAContactarCount: 0,
    currentContactadoCount: 0,
    currentCotizandoCount: 0,
    currentReunionCount: 0,
    currentGanadaCount: 0,
    currentPerdidaCount: 0,

    // Relación con colegio/comuna
    relatedGroupsCount: 0,
    sameSchoolSameComunaCount: 0,
    sameSchoolExactCount: 0,
    strongNameSameComunaCount: 0,
    similarSchoolSameComunaCount: 0,
    similarSchoolCount: 0,
    sameComunaOnlyCount: 0,
    sameYearCount: 0,

    relatedActiveCount: 0,
    relatedAContactarCount: 0,
    relatedContactadoCount: 0,
    relatedCotizandoCount: 0,
    relatedReunionCount: 0,
    relatedGanadaCount: 0,
    relatedPerdidaCount: 0,

    // Ratios cartera actual
    reunionRateCurrent: 0,
    ganadaRateCurrent: 0,
    cotizandoRateCurrent: 0,
    aContactarRateCurrent: 0,

    // Scores
    continuityScore: 0,
    performanceScore: 0,
    workloadScore: 0,
    totalScore: 0,

    // Perfil
    profileType: "",
    profileLabel: "",
    level: "Leve",
    levelClass: "low",
    hasStrongSchoolContinuity: false,
    selected: false,

    reasons: [],
    relatedExamples: []
  };
}

function pushRelatedExample(rec = {}, candidate = {}, matchInfo = {}) {
  if (!rec.relatedExamples) rec.relatedExamples = [];
  if (rec.relatedExamples.length >= 4) return;

  rec.relatedExamples.push({
    idGrupo: getRowId(candidate),
    aliasGrupo: getRowAlias(candidate),
    colegio: normalizeText(candidate.colegio || ""),
    comunaCiudad: normalizeText(candidate.comunaCiudad || candidate.comuna || ""),
    estado: normalizeText(candidate.estado || "—"),
    curso: normalizeText(candidate.cursoViaje || candidate.curso || ""),
    anoViaje: normalizeText(candidate.anoViaje || ""),
    matchLabel: matchInfo.label || "Relacionado",
    url: `${DETALLE_GRUPO_URL}?id=${encodeURIComponent(getRowId(candidate))}`
  });
}

function getRelatedMatchPriority(matchType = "") {
  if (matchType === "same_school_same_comuna") return 1;
  if (matchType === "same_school") return 2;
  if (matchType === "strong_name_same_comuna") return 3;
  if (matchType === "similar_school_same_comuna") return 4;
  if (matchType === "similar_school") return 5;
  if (matchType === "same_comuna_only") return 6;
  return 9;
}

function buildRelatedGroupDetail(candidate = {}, matchInfo = {}) {
  const vendorName = getRowVendorName(candidate) || "Sin asignar";
  const vendorEmail = getRowVendorEmail(candidate) || "";
  const assigned = !isSinAsignar(candidate);

  return {
    idGrupo: getRowId(candidate),
    aliasGrupo: getRowAlias(candidate),
    colegio: normalizeText(candidate.colegio || ""),
    comunaCiudad: normalizeText(candidate.comunaCiudad || candidate.comuna || ""),
    anoViaje: normalizeText(candidate.anoViaje || ""),
    curso: normalizeText(candidate.cursoViaje || candidate.curso || ""),
    estado: normalizeText(candidate.estado || "—"),
    vendedora: vendorName,
    vendedoraCorreo: vendorEmail,
    assigned,
    matchType: matchInfo.matchType || "none",
    matchLabel: matchInfo.label || "Relacionado",
    matchPriority: getRelatedMatchPriority(matchInfo.matchType || ""),
    url: `${DETALLE_GRUPO_URL}?id=${encodeURIComponent(getRowId(candidate))}`
  };
}

function renderRelatedGroupsListHtml(relatedGroups = []) {
  if (!relatedGroups.length) {
    return `<div class="assignment-alert-empty">No se encontraron grupos relacionados para listar.</div>`;
  }

  const initialVisible = 3;
  const hasMore = relatedGroups.length > initialVisible;

  const itemsHtml = relatedGroups.map((item, index) => `
    <li
      class="assignment-related-item ${index >= initialVisible ? "is-collapsed" : ""}"
      style="${index >= initialVisible ? "display:none;" : ""}"
    >
      <a class="assignment-alert-link" href="${item.url}" target="_blank" rel="noopener">
        ${escapeHtml(item.aliasGrupo || `Grupo ${item.idGrupo}`)}
      </a>
      · ID ${escapeHtml(item.idGrupo || "—")}
      · ${escapeHtml(item.matchLabel || "Relacionado")}
      · ${escapeHtml(item.colegio || "—")}
      · ${escapeHtml(item.comunaCiudad || "—")}
      · ${escapeHtml(item.estado || "—")}
      · ${item.assigned
        ? `Asignado a ${escapeHtml(item.vendedora || "—")}`
        : "Sin asignar"}
    </li>
  `).join("");

  return `
    <div class="assignment-related-list-wrap" data-role="related-list-wrap">
      <ul class="assignment-alert-reasons assignment-related-list" data-role="related-list">
        ${itemsHtml}
      </ul>

      ${hasMore ? `
        <button
          type="button"
          class="btn-page sec assignment-related-toggle"
          data-role="toggle-related-list"
          data-expanded="0"
        >
          Ver más (${relatedGroups.length - initialVisible})
        </button>
      ` : ""}
    </div>
  `;
}

function getRecommendationLevel(totalScore = 0, continuityScore = 0) {
  if (continuityScore >= 24 || totalScore >= 72) {
    return { level: "Alta", levelClass: "high" };
  }
  if (continuityScore >= 12 || totalScore >= 48) {
    return { level: "Media", levelClass: "medium" };
  }
  return { level: "Leve", levelClass: "low" };
}

function safeRate(numerator = 0, denominator = 0) {
  if (!denominator) return 0;
  return numerator / denominator;
}

function calculateContinuityScore(rec = {}) {
  let score = 0;

  if (rec.sameSchoolSameComunaCount > 0) {
    score += 30 + Math.min(8, (rec.sameSchoolSameComunaCount - 1) * 3);
  } else if (rec.sameSchoolExactCount > 0) {
    score += 22 + Math.min(6, (rec.sameSchoolExactCount - 1) * 2);
  }

  score += Math.min(12, (rec.strongNameSameComunaCount || 0) * 5);
  score += Math.min(10, rec.similarSchoolSameComunaCount * 4);
  score += Math.min(6, rec.similarSchoolCount * 2);

  // si el colegio es nuevo, importa quién trabaja la comuna
  score += Math.min(12, rec.sameComunaOnlyCount * 3);

  score += Math.min(5, rec.sameYearCount * 2);

  return clamp(Math.round(score), 0, 45);
}

function calculatePerformanceScore(rec = {}) {
  let score = 0;

  // volumen en cartera actual
  score += Math.min(8, rec.currentReunionCount * 1.5);
  score += Math.min(7, rec.currentGanadaCount * 1.5);
  score += Math.min(5, rec.currentCotizandoCount * 1.2);

  // proporción en cartera actual
  score += rec.reunionRateCurrent * 12;
  score += rec.ganadaRateCurrent * 10;
  score += rec.cotizandoRateCurrent * 5;

  // castigo por disciplina pobre
  score -= rec.aContactarRateCurrent * 12;
  score -= Math.min(4, rec.currentAContactarCount * 0.8);

  return clamp(Math.round(score), 0, 30);
}

function calculateWorkloadScore(rec = {}, averages = {}) {
  let score = 12;

  // disciplina operativa
  if (rec.totalAContactarCount === 0) score += 8;
  else if (rec.totalAContactarCount <= 2) score += 4;
  else if (rec.totalAContactarCount <= 4) score += 1;
  else score -= 6;

  // balance de activos
  const avgActive = Number(averages.activeCount || 0);
  const diffActive = rec.totalActiveCount - avgActive;

  if (diffActive <= -2) score += 5;
  else if (diffActive < 0) score += 2;
  else if (diffActive >= 4) score -= 5;
  else if (diffActive > 1) score -= 2;

  return clamp(Math.round(score), 0, 25);
}

function buildVendorRecommendationReasons(rec = {}, averages = {}) {
  const reasons = [];

  if (rec.sameSchoolSameComunaCount > 0) {
    pushUniqueReason(reasons, `Ya trabaja ${rec.sameSchoolSameComunaCount} grupo(s) del mismo colegio en la misma comuna`);
  } else if (rec.sameSchoolExactCount > 0) {
    pushUniqueReason(reasons, `Ya trabaja ${rec.sameSchoolExactCount} grupo(s) del mismo colegio`);
  }

  if (rec.sameComunaOnlyCount > 0) {
    pushUniqueReason(reasons, `Trabaja ${rec.sameComunaOnlyCount} grupo(s) de otros colegios en la misma comuna`);
  }

  if ((rec.strongNameSameComunaCount || 0) > 0) {
    pushUniqueReason(
      reasons,
      `Tiene ${rec.strongNameSameComunaCount} grupo(s) con nombre muy relacionado en la misma comuna`
    );
  }

  if (rec.similarSchoolSameComunaCount > 0) {
    pushUniqueReason(reasons, `Tiene ${rec.similarSchoolSameComunaCount} grupo(s) de colegio similar en la misma comuna`);
  } else if (rec.similarSchoolCount > 0) {
    pushUniqueReason(reasons, `Tiene ${rec.similarSchoolCount} grupo(s) de colegio similar`);
  }

  if (rec.currentPortfolioCount > 0) {
    pushUniqueReason(
      reasons,
      `En suS grupos actuales: ${Math.round(rec.reunionRateCurrent * 100)}% llega a reunión, ${Math.round(rec.ganadaRateCurrent * 100)}% llega a ganada`
    );
  }

  if (rec.currentReunionCount > 0 || rec.currentGanadaCount > 0) {
    pushUniqueReason(
      reasons,
      `Volumen actual: ${rec.currentReunionCount} reunión(es) y ${rec.currentGanadaCount} ganada(s)`
    );
  }

  if (rec.totalAContactarCount === 0) {
    pushUniqueReason(reasons, "No tiene grupos pendientes en 'A contactar'");
  } else if (rec.totalAContactarCount >= 3) {
    pushUniqueReason(reasons, `Tiene ${rec.totalAContactarCount} grupo(s) aún en 'A contactar'`);
  }

  if (rec.totalActiveCount < Number(averages.activeCount || 0)) {
    pushUniqueReason(reasons, "Tiene una carga activa por debajo del promedio del equipo");
  } else if (rec.totalActiveCount > Number(averages.activeCount || 0) + 1) {
    pushUniqueReason(reasons, "Tiene una carga activa por sobre el promedio del equipo");
  }

  if (!reasons.length) {
    pushUniqueReason(reasons, "Sin señales fuertes de continuidad; aquí pesa más la gestión actual y la carga");
  }

  return reasons;
}

function assignProfileToRecommendation(rec = {}) {
  if (rec.continuityScore >= rec.performanceScore && rec.continuityScore >= rec.workloadScore) {
    rec.profileType = "continuidad";
    rec.profileLabel = "Continuidad comercial";
    return;
  }

  if (rec.performanceScore >= rec.workloadScore) {
    rec.profileType = "desempeno";
    rec.profileLabel = "Mejor desempeño";
    return;
  }

  rec.profileType = "disponibilidad";
  rec.profileLabel = "Mejor disponibilidad";
}

function buildAssignmentRecommendationSummary(analysis = {}) {
  const schoolLabel = analysis.sourceSchoolLabel || "este colegio";
  const top = analysis.topRecommendation;
  const parts = [];

  parts.push(
    `Para ${schoolLabel} se encontraron ${analysis.totalRelatedGroups} grupo(s) relacionado(s): ${analysis.relatedAssignedCount} asignado(s) y ${analysis.relatedUnassignedCount} sin asignar.`
  );

  if (analysis.totalSameComunaTerritory > 0) {
    parts.push(
      `Además hay ${analysis.totalSameComunaTerritory} grupo(s) en la misma comuna, lo que ayuda a sugerir territorio cuando el colegio es nuevo.`
    );
  }

  if (top) {
    parts.push(`La mejor sugerencia general es ${top.vendorName} con ${top.totalScore} pts.`);
  }

  if (analysis.selectedRecommendation && top) {
    if (analysis.selectedRecommendation.vendorEmail === top.vendorEmail) {
      parts.push("La selección actual coincide con la mejor sugerencia general.");
    } else {
      parts.push(
        `La selección actual es ${analysis.selectedRecommendation.vendorName} (${analysis.selectedRecommendation.totalScore} pts), pero hay otras opciones más fuertes por continuidad, desempeño o disponibilidad.`
      );
    }
  }

  return parts.join(" ");
}

function shouldOpenVendorRecommendationModal(analysis = {}) {
  if (!analysis.topRecommendation || !analysis.selectedRecommendation) return false;

  if (analysis.totalRelatedGroups > 0) return true;
  if (analysis.totalSameComunaTerritory > 0) return true;

  return (
    analysis.topRecommendation.vendorEmail !== analysis.selectedRecommendation.vendorEmail &&
    (analysis.topRecommendation.totalScore - analysis.selectedRecommendation.totalScore) >= 10
  );
}

function getTopProfileRecommendations(allRecommendations = [], selectedVendorEmail = "") {
  const selected = allRecommendations.find((item) => item.vendorEmail === selectedVendorEmail) || null;

  const bestContinuity = [...allRecommendations]
    .sort((a, b) => b.continuityScore - a.continuityScore || b.totalScore - a.totalScore)[0] || null;

  const bestPerformance = [...allRecommendations]
    .sort((a, b) => b.performanceScore - a.performanceScore || b.totalScore - a.totalScore)[0] || null;

  const bestWorkload = [...allRecommendations]
    .sort((a, b) => b.workloadScore - a.workloadScore || b.totalScore - a.totalScore)[0] || null;

  const picks = [];
  [bestContinuity, bestPerformance, bestWorkload, selected].forEach((item) => {
    if (!item) return;
    if (!picks.some((x) => x.vendorEmail === item.vendorEmail)) {
      picks.push(item);
    }
  });

  return picks.slice(0, 4);
}

function analyzeVendorAssignmentRecommendation(sourceRow = {}, selectedVendor = {}) {
  const vendors = getVendorOptions();
  const vendorMap = new Map(
    vendors.map((vendor) => [normalizeEmail(vendor.email || ""), createVendorRecommendationBase(vendor)])
  );

  const currentId = getRowId(sourceRow);
  const sourceYear = getAnoViajeNumber(sourceRow);

  let totalRelatedGroups = 0;
  let relatedAssignedCount = 0;
  let relatedUnassignedCount = 0;
  let totalSameComunaTerritory = 0;
  const relatedGroupDetails = [];

  state.rows.forEach((candidate) => {
    if (getRowId(candidate) === currentId) return;

    const candidateVendorEmail = getRowVendorEmail(candidate);
    const candidateVendorKnown = candidateVendorEmail && vendorMap.has(candidateVendorEmail);
    const candidateStage = normalizeStage(candidate.estado || "");
    const candidateCurrentPortfolio = isCurrentOrFutureTravelYear(candidate);

    // SIEMPRE acumulamos carga global del vendedor
    if (candidateVendorKnown && !isSinAsignar(candidate)) {
      const rec = vendorMap.get(candidateVendorEmail);

      rec.totalAssignedCount += 1;

      if (isActiveStage(candidateStage)) rec.totalActiveCount += 1;
      if (candidateStage === "a_contactar") rec.totalAContactarCount += 1;
      if (candidateStage === "contactado") rec.totalContactadoCount += 1;
      if (candidateStage === "cotizando") rec.totalCotizandoCount += 1;
      if (candidateStage === "reunion_confirmada") rec.totalReunionCount += 1;
      if (candidateStage === "ganada") rec.totalGanadaCount += 1;
      if (candidateStage === "perdida") rec.totalPerdidaCount += 1;

      // cartera actual año actual/futuro
      if (candidateCurrentPortfolio) {
        rec.currentPortfolioCount += 1;
        if (candidateStage === "a_contactar") rec.currentAContactarCount += 1;
        if (candidateStage === "contactado") rec.currentContactadoCount += 1;
        if (candidateStage === "cotizando") rec.currentCotizandoCount += 1;
        if (candidateStage === "reunion_confirmada") rec.currentReunionCount += 1;
        if (candidateStage === "ganada") rec.currentGanadaCount += 1;
        if (candidateStage === "perdida") rec.currentPerdidaCount += 1;
      }
    }

    const matchInfo = getSchoolMatchInfo(sourceRow, candidate);
    if (!matchInfo.isRelevant) return;
    
    totalRelatedGroups += 1;
    relatedGroupDetails.push(buildRelatedGroupDetail(candidate, matchInfo));

    if (matchInfo.matchType === "same_comuna_only") {
      totalSameComunaTerritory += 1;
    }

    if (isSinAsignar(candidate) || !candidateVendorKnown) {
      relatedUnassignedCount += 1;
      return;
    }

    relatedAssignedCount += 1;

    const rec = vendorMap.get(candidateVendorEmail);

    rec.relatedGroupsCount += 1;

    if (matchInfo.matchType === "same_school_same_comuna") rec.sameSchoolSameComunaCount += 1;
    else if (matchInfo.matchType === "same_school") rec.sameSchoolExactCount += 1;
    else if (matchInfo.matchType === "strong_name_same_comuna") rec.strongNameSameComunaCount += 1;
    else if (matchInfo.matchType === "similar_school_same_comuna") rec.similarSchoolSameComunaCount += 1;
    else if (matchInfo.matchType === "similar_school") rec.similarSchoolCount += 1;
    else if (matchInfo.matchType === "same_comuna_only") rec.sameComunaOnlyCount += 1;

    if (sourceYear && getAnoViajeNumber(candidate) === sourceYear) {
      rec.sameYearCount += 1;
    }

    if (isActiveStage(candidateStage)) rec.relatedActiveCount += 1;
    if (candidateStage === "a_contactar") rec.relatedAContactarCount += 1;
    if (candidateStage === "contactado") rec.relatedContactadoCount += 1;
    if (candidateStage === "cotizando") rec.relatedCotizandoCount += 1;
    if (candidateStage === "reunion_confirmada") rec.relatedReunionCount += 1;
    if (candidateStage === "ganada") rec.relatedGanadaCount += 1;
    if (candidateStage === "perdida") rec.relatedPerdidaCount += 1;

    pushRelatedExample(rec, candidate, matchInfo);
  });

  const allRecommendations = Array.from(vendorMap.values());

  const averages = {
    activeCount: allRecommendations.length
      ? allRecommendations.reduce((sum, item) => sum + item.totalActiveCount, 0) / allRecommendations.length
      : 0
  };

  const selectedVendorEmail = normalizeEmail(selectedVendor.email || "");

  allRecommendations.forEach((rec) => {
    rec.reunionRateCurrent = safeRate(rec.currentReunionCount, rec.currentPortfolioCount);
    rec.ganadaRateCurrent = safeRate(rec.currentGanadaCount, rec.currentPortfolioCount);
    rec.cotizandoRateCurrent = safeRate(rec.currentCotizandoCount, rec.currentPortfolioCount);
    rec.aContactarRateCurrent = safeRate(rec.currentAContactarCount, rec.currentPortfolioCount);

    rec.continuityScore = calculateContinuityScore(rec);
    rec.performanceScore = calculatePerformanceScore(rec);
    rec.workloadScore = calculateWorkloadScore(rec, averages);
    rec.totalScore = clamp(rec.continuityScore + rec.performanceScore + rec.workloadScore, 0, 100);

    const level = getRecommendationLevel(rec.totalScore, rec.continuityScore);
    rec.level = level.level;
    rec.levelClass = level.levelClass;

    rec.hasStrongSchoolContinuity =
      rec.sameSchoolSameComunaCount > 0 ||
      rec.sameSchoolExactCount > 0 ||
      rec.sameComunaOnlyCount > 0;

    rec.selected = rec.vendorEmail === selectedVendorEmail;
    rec.reasons = buildVendorRecommendationReasons(rec, averages);
    assignProfileToRecommendation(rec);
  });

  allRecommendations.sort((a, b) =>
    b.totalScore - a.totalScore ||
    b.continuityScore - a.continuityScore ||
    b.performanceScore - a.performanceScore ||
    a.vendorName.localeCompare(b.vendorName, "es", { sensitivity: "base" })
  );

  const topRecommendation = allRecommendations[0] || null;
  const selectedRecommendation =
    allRecommendations.find((item) => item.vendorEmail === selectedVendorEmail) || null;

  const recommendations = getTopProfileRecommendations(allRecommendations, selectedVendorEmail);

  const analysis = {
    sourceSchoolLabel: normalizeText(sourceRow.colegio || sourceRow.colegioBase || "este colegio"),
    selectedVendorEmail,
    selectedVendorName: normalizeText(selectedVendor.nombre || ""),
    totalRelatedGroups,
    relatedAssignedCount,
    relatedUnassignedCount,
    totalSameComunaTerritory,
    relatedGroupDetails: relatedGroupDetails.sort((a, b) => {
      return (
        a.matchPriority - b.matchPriority ||
        Number(b.assigned) - Number(a.assigned) ||
        (Number(b.idGrupo) || 0) - (Number(a.idGrupo) || 0)
      );
    }),
    recommendations,
    topRecommendation,
    selectedRecommendation,
    summaryText: ""
  };

  analysis.summaryText = buildAssignmentRecommendationSummary(analysis);
  analysis.shouldReview = shouldOpenVendorRecommendationModal(analysis);

  return analysis;
}

/* =========================================================
   CARGA
========================================================= */
async function loadData() {
  try {
    setProgressStatus({
      text: "Cargando asignaciones...",
      meta: "Preparando vista comercial...",
      progress: 10
    });

    if ($("asignadosLoadHint")) {
      $("asignadosLoadHint").textContent = "Preparando vista comercial...";
    }

    const vendorOptions = getVendorOptions();

    setProgressStatus({
      text: "Cargando asignaciones...",
      meta: `Vendedoras detectadas: ${vendorOptions.length}`,
      progress: 20
    });

    if ($("asignadosLoadHint")) {
      $("asignadosLoadHint").textContent = `Vendedoras detectadas: ${vendorOptions.length}`;
    }

    const snap = await getDocs(collection(db, "ventas_cotizaciones"));

    setProgressStatus({
      text: "Procesando grupos...",
      meta: `Documentos recibidos: ${snap.size}`,
      progress: 55
    });

    if ($("asignadosLoadHint")) {
      $("asignadosLoadHint").textContent = `Procesando ${snap.size} grupo(s)...`;
    }

    state.rows = snap.docs.map((docSnap) => {
      const data = docSnap.data() || {};
      return {
        id: docSnap.id,
        idGrupo: data.idGrupo || docSnap.id,
        ...data
      };
    });

    setProgressStatus({
      text: "Aplicando filtros...",
      meta: `Total grupos cargados: ${state.rows.length}`,
      progress: 78
    });

    populateFilters();

    if ($("asignadosLoadHint")) {
      $("asignadosLoadHint").textContent = "Aplicando filtros y renderizando tabla...";
    }

    setProgressStatus({
      text: "Renderizando tabla...",
      meta: "Preparando resumen, tabs y filas...",
      progress: 90
    });

    applyFilters();

    setProgressStatus({
      text: "Asignaciones cargadas.",
      meta: `${state.filteredRows.length} grupo(s) visibles en la vista actual.`,
      progress: 100,
      type: "success"
    });

    if ($("asignadosLoadHint")) {
      $("asignadosLoadHint").textContent = `${state.filteredRows.length} grupo(s) listos en la vista actual.`;
    }

    clearProgressStatus();
  } catch (error) {
    console.error(error);
    setProgressStatus({
      text: "Error cargando asignaciones.",
      meta: error.message || "No se pudo leer Firestore.",
      progress: 100,
      type: "error"
    });

    if ($("asignadosLoadHint")) {
      $("asignadosLoadHint").textContent = "Error al cargar la vista comercial.";
    }
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

function renderAssignmentAlertModal({ row = {}, vendor = {}, analysis = {} } = {}) {
  const title = $("assignmentAlertTitle");
  const summary = $("assignmentAlertSummary");
  const list = $("assignmentAlertList");
  const continueBtn = $("assignmentAlertContinueBtn");

  const top = analysis.topRecommendation || null;
  const selected = analysis.selectedRecommendation || null;

  if (title) {
    title.textContent = `Sugerencias antes de asignar a ${vendor.nombre || "la vendedora seleccionada"}`;
  }

  if (summary) {
    summary.textContent =
      analysis.summaryText ||
      "Se generaron sugerencias comerciales antes de guardar la asignación.";
  }

  if (continueBtn) {
    continueBtn.textContent =
      selected && top && selected.vendorEmail === top.vendorEmail
        ? "Confirmar asignación"
        : "Asignar igualmente";
  }

  if (!list) return;

const recommendations = analysis.recommendations || [];
const relatedGroups = analysis.relatedGroupDetails || [];

if (!recommendations.length && !relatedGroups.length) {
  list.innerHTML = `<div class="assignment-alert-empty">No hay sugerencias para mostrar.</div>`;
  return;
}

const relatedGroupsHtml = relatedGroups.length
  ? `
    <article class="assignment-alert-item">
      <div class="assignment-alert-top">
        <div>
          <h4 class="assignment-alert-title">Grupos relacionados detectados (${relatedGroups.length})</h4>
          <div class="assignment-alert-meta">
            ${escapeHtml(String(analysis.relatedAssignedCount || 0))} asignado(s) ·
            ${escapeHtml(String(analysis.relatedUnassignedCount || 0))} sin asignar
          </div>
        </div>

        <div class="assignment-alert-tags">
          <span class="assignment-pill same">Lista completa</span>
        </div>
      </div>

      ${renderRelatedGroupsListHtml(relatedGroups)}
    </article>
  `
  : `
    <div class="assignment-alert-empty">No se encontraron grupos relacionados para listar.</div>
  `;

const recommendationsHtml = recommendations.map((item, index) => {
    const isTop = top && item.vendorEmail === top.vendorEmail;
    const isSelected = item.selected;

    return `
      <article class="assignment-alert-item">
        <div class="assignment-alert-top">
          <div>
            <h4 class="assignment-alert-title">${index + 1}. ${escapeHtml(item.vendorName || "Vendedor(a)")}</h4>
            <div class="assignment-alert-meta">
              ${escapeHtml(item.vendorEmail || "Sin correo")} · Puntaje total ${escapeHtml(String(item.totalScore || 0))}/100
            </div>
          </div>

          <div class="assignment-alert-tags">
            ${isTop ? `<span class="assignment-pill same">Sugerencia general</span>` : ""}
            ${isSelected ? `<span class="assignment-pill other">Selección actual</span>` : ""}
            <span class="assignment-pill ${escapeHtml(item.levelClass)}">${escapeHtml(item.level)}</span>
            <span class="assignment-pill medium">${escapeHtml(item.profileLabel || "Perfil")}</span>
          </div>
        </div>

        <div class="assignment-alert-grid">
          <div class="assignment-alert-row"><strong>Continuidad / territorio:</strong> ${escapeHtml(String(item.continuityScore || 0))}/45</div>
          <div class="assignment-alert-row"><strong>Desempeño actual:</strong> ${escapeHtml(String(item.performanceScore || 0))}/30</div>
          <div class="assignment-alert-row"><strong>Disponibilidad:</strong> ${escapeHtml(String(item.workloadScore || 0))}/25</div>

          <div class="assignment-alert-row"><strong>Mismo colegio + comuna:</strong> ${escapeHtml(String(item.sameSchoolSameComunaCount || 0))}</div>
          <div class="assignment-alert-row"><strong>Mismo colegio:</strong> ${escapeHtml(String(item.sameSchoolExactCount || 0))}</div>
          <div class="assignment-alert-row"><strong>Nombre fuerte + comuna:</strong> ${escapeHtml(String(item.strongNameSameComunaCount || 0))}</div>
          <div class="assignment-alert-row"><strong>Misma comuna (otros colegios):</strong> ${escapeHtml(String(item.sameComunaOnlyCount || 0))}</div>
          <div class="assignment-alert-row"><strong>Colegios similares:</strong> ${escapeHtml(String((item.similarSchoolSameComunaCount || 0) + (item.similarSchoolCount || 0)))}</div>

          <div class="assignment-alert-row"><strong>Cant. Grupos hoy:</strong> ${escapeHtml(String(item.currentPortfolioCount || 0))}</div>
          <div class="assignment-alert-row"><strong>Reuniones actuales:</strong> ${escapeHtml(String(item.currentReunionCount || 0))}</div>
          <div class="assignment-alert-row"><strong>Ganadas actuales:</strong> ${escapeHtml(String(item.currentGanadaCount || 0))}</div>
          <div class="assignment-alert-row"><strong>Cotizando actual:</strong> ${escapeHtml(String(item.currentCotizandoCount || 0))}</div>
          <div class="assignment-alert-row"><strong>% reunión actual:</strong> ${escapeHtml(String(Math.round((item.reunionRateCurrent || 0) * 100)))}%</div>
          <div class="assignment-alert-row"><strong>% ganada actual:</strong> ${escapeHtml(String(Math.round((item.ganadaRateCurrent || 0) * 100)))}%</div>
          <div class="assignment-alert-row"><strong>% A contactar actual:</strong> ${escapeHtml(String(Math.round((item.aContactarRateCurrent || 0) * 100)))}%</div>
          <div class="assignment-alert-row"><strong>Total en A contactar:</strong> ${escapeHtml(String(item.totalAContactarCount || 0))}</div>
        </div>

        <ul class="assignment-alert-reasons">
          ${(item.reasons || []).map((reason) => `<li>${escapeHtml(reason)}</li>`).join("")}
        </ul>

        ${
          (item.relatedExamples || []).length
            ? `
              <div class="assignment-alert-row"><strong>Ejemplos relacionados:</strong></div>
              <ul class="assignment-alert-reasons">
                ${(item.relatedExamples || []).map((example) => `
                  <li>
                    <a class="assignment-alert-link" href="${example.url}" target="_blank" rel="noopener">
                      ${escapeHtml(example.aliasGrupo || `Grupo ${example.idGrupo}`)}
                    </a>
                    · ${escapeHtml(example.matchLabel || "Relacionado")}
                    · ${escapeHtml(example.estado || "—")}
                    · ${escapeHtml(example.comunaCiudad || "—")}
                  </li>
                `).join("")}
              </ul>
            `
            : ""
        }
      </article>
    `;
  }).join("");

list.innerHTML = relatedGroupsHtml + recommendationsHtml;
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
  analysis = null
} = {}) {
  if (!analysis) return;

  const ref = doc(collection(db, "ventas_cotizaciones", String(idGrupo), "historialAsignaciones"));

  const top = analysis.topRecommendation || null;

  await setDoc(ref, {
    idGrupo: String(idGrupo),
    tipo: "Recomendación previa de asignación",
    campo: "vendedora",
    colegio: normalizeText(analysis.sourceSchoolLabel || ""),
    vendedorElegido: normalizeText(vendor.nombre || ""),
    vendedorElegidoCorreo: normalizeEmail(vendor.email || ""),
    vendedorSugerido: normalizeText(top?.vendorName || ""),
    vendedorSugeridoCorreo: normalizeEmail(top?.vendorEmail || ""),
    totalGruposRelacionados: Number(analysis.totalRelatedGroups || 0),
    gruposRelacionadosAsignados: Number(analysis.relatedAssignedCount || 0),
    gruposRelacionadosSinAsignar: Number(analysis.relatedUnassignedCount || 0),
    resumen: normalizeText(analysis.summaryText || ""),
    ranking: (analysis.recommendations || []).map((item) => ({
      vendorName: item.vendorName,
      vendorEmail: item.vendorEmail,
      totalScore: item.totalScore,
      continuityScore: item.continuityScore,
      performanceScore: item.performanceScore,
      workloadScore: item.workloadScore,
      profileType: item.profileType,
      profileLabel: item.profileLabel,
      sameSchoolSameComunaCount: item.sameSchoolSameComunaCount,
      sameSchoolExactCount: item.sameSchoolExactCount,
      sameComunaOnlyCount: item.sameComunaOnlyCount,
      similarSchoolSameComunaCount: item.similarSchoolSameComunaCount,
      similarSchoolCount: item.similarSchoolCount,
      currentPortfolioCount: item.currentPortfolioCount,
      currentReunionCount: item.currentReunionCount,
      currentGanadaCount: item.currentGanadaCount,
      currentCotizandoCount: item.currentCotizandoCount,
      reunionRateCurrent: item.reunionRateCurrent,
      ganadaRateCurrent: item.ganadaRateCurrent,
      aContactarRateCurrent: item.aContactarRateCurrent,
      totalAContactarCount: item.totalAContactarCount,
      selected: Boolean(item.selected),
      reasons: item.reasons || []
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
  reviewAnalysis = null,
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

  if (confirmedAfterReview && reviewAnalysis) {
    await writeAssignmentAlertReviewHistory({
      idGrupo,
      vendor,
      analysis: reviewAnalysis
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
    
    setProgressStatus({
      text: "Confirmando asignación...",
      meta: `Guardando selección para grupo ${pending.idGrupo}`,
      progress: 82
    });
    
    await persistAssignment({
      row: currentRow,
      vendor: currentVendor,
      tipo: pending.tipo,
      reviewAnalysis: pending.analysis,
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
      const tipoNorm = normalizeLoose(row.tipo || "");
      const isRecommendation =
        tipoNorm === "recomendacion previa de asignacion" ||
        tipoNorm === "recomendación previa de asignación";
    
      if (isRecommendation) {
        const ranking = Array.isArray(row.ranking) ? row.ranking : [];
    
        return `
          <div class="history-item">
            <div class="history-top">
              <strong>${escapeHtml(normalizeText(row.tipo || "Recomendación"))}</strong>
              <span>${escapeHtml(formatDateTime(row.fecha) || "Fecha pendiente")}</span>
            </div>
    
            <div class="history-line">
              <strong>Colegio:</strong>
              ${escapeHtml(normalizeText(row.colegio || "—"))}
            </div>
    
            <div class="history-line">
              <strong>Vendedor sugerido:</strong>
              ${escapeHtml(normalizeText(row.vendedorSugerido || "—"))}
              ${row.vendedorSugeridoCorreo ? ` · ${escapeHtml(normalizeEmail(row.vendedorSugeridoCorreo))}` : ""}
            </div>
    
            <div class="history-line">
              <strong>Vendedor elegido:</strong>
              ${escapeHtml(normalizeText(row.vendedorElegido || "—"))}
              ${row.vendedorElegidoCorreo ? ` · ${escapeHtml(normalizeEmail(row.vendedorElegidoCorreo))}` : ""}
            </div>
    
            <div class="history-line">
              <strong>Relacionados:</strong>
              ${escapeHtml(String(row.totalGruposRelacionados || 0))}
              · asignados ${escapeHtml(String(row.gruposRelacionadosAsignados || 0))}
              · sin asignar ${escapeHtml(String(row.gruposRelacionadosSinAsignar || 0))}
            </div>
    
            <div class="history-line">
              <strong>Resumen:</strong>
              ${escapeHtml(normalizeText(row.resumen || "—"))}
            </div>
    
            ${
              ranking.length
                ? `
                  <div class="history-line">
                    <strong>Ranking:</strong>
                    ${ranking.slice(0, 3).map((item) => {
                      const label = `${item.vendorName || "Vendedor"} (${item.totalScore || 0} pts)`;
                      return escapeHtml(label);
                    }).join(" · ")}
                  </div>
                `
                : ""
            }
    
            <div class="history-line">
              <strong>Hecho por:</strong>
              ${escapeHtml(normalizeText(row.hechoPor || "—"))}
              ${row.hechoPorCorreo ? ` · ${escapeHtml(normalizeEmail(row.hechoPorCorreo))}` : ""}
            </div>
          </div>
        `;
      }
    
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
      text: `Analizando ${tipo.toLowerCase()}...`,
      meta: `Leyendo continuidad, territorio y desempeño para grupo ${idGrupo}`,
      progress: 18
    });

    const analysis = analyzeVendorAssignmentRecommendation(row, vendor);

    setProgressStatus({
      text: `Análisis listo`,
      meta: `${analysis.totalRelatedGroups || 0} relacionado(s) detectado(s) para ${idGrupo}`,
      progress: 72
    });

    if (analysis.shouldReview) {
      clearProgressStatus();

      state.pendingAssignmentReview = {
        idGrupo: getRowId(row),
        row,
        vendor,
        tipo,
        analysis
      };

      openAssignmentAlertModal({
        row,
        vendor,
        analysis
      });
      return;
    }

    await persistAssignment({
      row,
      vendor,
      tipo,
      reviewAnalysis: null,
      confirmedAfterReview: false
    });
  } catch (error) {
    console.error(error);
    setProgressStatus({
      text: `Error en ${tipo.toLowerCase()}.`,
      meta: error.message || "No se pudo preparar la recomendación de asignación.",
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
        return;
      }
  
      const toggleBtn = e.target.closest('[data-role="toggle-related-list"]');
      if (!toggleBtn) return;
  
      const wrap = toggleBtn.closest('[data-role="related-list-wrap"]');
      const list = wrap?.querySelector('[data-role="related-list"]');
      if (!wrap || !list) return;
  
      const expanded = toggleBtn.dataset.expanded === "1";
      const hiddenItems = list.querySelectorAll('.assignment-related-item.is-collapsed');
  
      hiddenItems.forEach((item) => {
        item.style.display = expanded ? "none" : "list-item";
      });
  
      toggleBtn.dataset.expanded = expanded ? "0" : "1";
      toggleBtn.textContent = expanded ? `Ver más (${hiddenItems.length})` : "Ver menos";
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
