import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.7.3/firebase-auth.js";
import {
  collection,
  doc,
  getDocs,
  setDoc,
  addDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";

import { auth, db, VENTAS_USERS, getVentasUserEmails } from "./firebase-init.js";

import {
  $,
  normalizeEmail,
  normalizeText,
  normalizeSearch,
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
const HISTORIAL_COLLECTION = "ventas_historial";

/* =========================================================
   ESTADO
========================================================= */
const state = {
  realUser: null,
  effectiveUser: null,
  carteraOptions: [],
  lastCreated: null,
  pendingAlertReview: null
};

/* =========================================================
   HELPERS
========================================================= */
function getScopeText() {
  let text = "Registrar contacto · Nueva cotización";

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

  // Como el switcher del header puede re-renderizarse,
  // volvemos a enlazar sus botones.
  bindHeaderActions();
}

function getCurrentYear() {
  return new Date().getFullYear();
}

function normalizeCursoInput(value = "") {
  return normalizeText(value)
    .toUpperCase()
    .replace(/\s+/g, "");
}

function hasValidCursoFormat(value = "") {
  const curso = normalizeCursoInput(value);

  // Reglas válidas:
  // 1 a 8  -> pueden llevar letras: 4, 4A, 8DAVINCI
  // 9 a 11 -> para colegios con sistema americano: 9, 10, 11, 10A, 11DAVINCI
  // Siempre todo junto y sin espacios
  return /^(?:11|10|[1-9])[A-Z]*$/.test(curso);
}

function extractCursoNumber(value = "") {
  const match = normalizeCursoInput(value).match(/^(11|10|[1-9])/);
  return match ? Number(match[1]) : null;
}

function extractCursoSuffix(value = "") {
  const match = normalizeCursoInput(value).match(/^(?:11|10|[1-9])(.*)$/);
  return match ? match[1] : "";
}

function getNextCursoNumber(currentNumber) {
  // Básica / media tradicional
  if (currentNumber >= 1 && currentNumber <= 7) return currentNumber + 1;
  if (currentNumber === 8) return 1;

  // Sistema americano
  if (currentNumber === 9) return 10;
  if (currentNumber === 10) return 11;

  // Tope actual permitido según tu regla
  if (currentNumber === 11) return 11;

  return null;
}

function projectCursoToYear(cursoBase = "", anoBase = getCurrentYear(), anoViaje = getCurrentYear()) {
  const baseCurso = normalizeCursoInput(cursoBase);
  const baseNumber = extractCursoNumber(baseCurso);
  const suffix = extractCursoSuffix(baseCurso);
  const fromYear = Number(anoBase);
  const toYear = Number(anoViaje);

  if (!baseCurso || baseNumber === null) return "";
  if (!Number.isFinite(fromYear) || !Number.isFinite(toYear) || toYear < fromYear) return "";

  let projectedNumber = baseNumber;
  const diff = toYear - fromYear;

  for (let i = 0; i < diff; i += 1) {
    const nextNumber = getNextCursoNumber(projectedNumber);
    if (nextNumber === null) return "";
    projectedNumber = nextNumber;
  }

  return `${projectedNumber}${suffix}`;
}

function buildAliasGrupo({ cursoBase = "", anoBase = "", cursoViaje = "", anoViaje = "", colegio = "" }) {
  const base = normalizeCursoInput(cursoBase);
  const trip = normalizeCursoInput(cursoViaje);
  const school = normalizeText(colegio);

  if (!base || !trip || !anoBase || !anoViaje || !school) return "";

  const baseYear = String(anoBase).trim();
  const tripYear = String(anoViaje).trim();

  // Si el año base y el año de viaje coinciden,
  // no repetimos el curso/año proyectado.
  if (baseYear === tripYear) {
    return `${base} (${baseYear}) ${school}`.trim();
  }

  return `${base} (${baseYear}) ${trip} (${tripYear}) ${school}`.trim();
}

function buildAliasTripKey({ colegio = "", comuna = "", cursoViaje = "", anoViaje = "" }) {
  return normalizeSearch(
    `${normalizeText(colegio)}__${normalizeText(comuna)}__${normalizeCursoInput(cursoViaje)}__${normalizeText(anoViaje)}`
  );
}

function getDocBaseYear(data = {}) {
  const explicit = Number(data.anoBaseCurso || "");
  if (Number.isFinite(explicit) && explicit > 0) return explicit;

  const ts = data.fechaCreacion;
  if (ts?.toDate) {
    return ts.toDate().getFullYear();
  }

  return getCurrentYear();
}

function buildLegacyCursoBase(data = {}) {
  const direct = normalizeCursoInput(data.curso || "");
  if (hasValidCursoFormat(direct)) return direct;

  const nivel = normalizeText(data.cursoNivel || "");
  const seccion = normalizeText(data.cursoSeccion || "").toUpperCase().replace(/\s+/g, "");
  const numberMatch = nivel.match(/(\d{1,2})/);
  const number = numberMatch ? numberMatch[1] : "";

  const rebuilt = normalizeCursoInput(`${number}${seccion}`);
  return hasValidCursoFormat(rebuilt) ? rebuilt : "";
}

function buildTripKeyFromExistingDoc(data = {}) {
  const explicit = normalizeText(data.aliasTripKey || "");
  if (explicit) return normalizeSearch(explicit);

  const colegio = normalizeText(data.colegio || "");
  const comuna = normalizeText(data.comunaCiudad || data.comuna || "");
  const anoViaje = normalizeText(data.anoViaje || "");

  if (!colegio || !anoViaje) return "";

  const cursoBase = buildLegacyCursoBase(data);
  const cursoViaje = normalizeCursoInput(
    data.cursoViaje || projectCursoToYear(cursoBase, getDocBaseYear(data), anoViaje)
  );

  if (!cursoViaje) return "";

  return buildAliasTripKey({ colegio, comuna, cursoViaje, anoViaje });
}

async function findExistingAliasConflict(targetTripKey = "") {
  if (!targetTripKey) return null;

  const snap = await getDocs(collection(db, "ventas_cotizaciones"));

  for (const row of snap.docs) {
    const data = row.data() || {};
    const rowTripKey = buildTripKeyFromExistingDoc(data);

    if (rowTripKey && rowTripKey === targetTripKey) {
      return {
        id: row.id,
        data
      };
    }
  }

  return null;
}

function updateAliasPreview() {
  const aliasPreview = $("aliasPreview");
  if (!aliasPreview) return;

  const colegio = normalizeText($("inputColegio")?.value || "");
  const curso = normalizeCursoInput($("inputCurso")?.value || "");
  const anoBase = getCurrentYear();
  const anoViaje = normalizeText($("anoViaje")?.value || "");

  if (!colegio || !curso || !anoViaje || !hasValidCursoFormat(curso)) {
    aliasPreview.textContent = "—";
    return;
  }

  const cursoViaje = projectCursoToYear(curso, anoBase, anoViaje);
  const alias = buildAliasGrupo({
    cursoBase: curso,
    anoBase,
    cursoViaje,
    anoViaje,
    colegio
  });

  aliasPreview.textContent = alias || "—";
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
  return normalizeSearch(value)
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
  const cursoA = normalizeCursoInput(a);
  const cursoB = normalizeCursoInput(b);

  if (!cursoA || !cursoB) return 0;
  if (cursoA === cursoB) return 1;

  const numberA = extractCursoNumber(cursoA);
  const numberB = extractCursoNumber(cursoB);

  if (numberA !== null && numberA === numberB) {
    return 0.88;
  }

  return 0;
}

function pushUniqueReason(reasons = [], text = "") {
  if (!text) return;
  if (!reasons.includes(text)) reasons.push(text);
}

function getAlertLevel(score = 0, hardSignals = 0, businessCritical = false) {
  if (businessCritical || hardSignals > 0 || score >= 75) return "Alta";
  if (score >= 48) return "Media";
  return "Leve";
}

function getAlertLevelClass(level = "") {
  if (level === "Alta") return "high";
  if (level === "Media") return "medium";
  return "low";
}

function summarizeAlertMatches(matches = []) {
  const altas = matches.filter((item) => item.level === "Alta").length;
  const medias = matches.filter((item) => item.level === "Media").length;
  const leves = matches.filter((item) => item.level === "Leve").length;

  if (!matches.length) {
    return "No se encontraron coincidencias para revisar.";
  }

  return `Se encontraron ${matches.length} posible(s) coincidencia(s). Se muestran primero las de alta coincidencia: ${altas} alta(s), ${medias} media(s) y ${leves} leve(s). Puedes volver a editar o registrar igualmente.`;
}

function splitAlertMatches(matches = []) {
  return {
    altas: matches.filter((item) => item.level === "Alta"),
    otras: matches.filter((item) => item.level !== "Alta")
  };
}

function buildAlertReviewCardsHtml(matches = []) {
  if (!matches.length) {
    return `<div class="alert-review-empty">No hay coincidencias para mostrar.</div>`;
  }

  return matches.map((item) => `
    <article class="alert-review-card">
      <div class="alert-review-top">
        <div>
          <h4 class="alert-review-title">${item.aliasGrupo || "Grupo sin alias"}</h4>
          <div class="helper">${item.codigoRegistro || "Sin código"} · ID ${item.relatedIdGrupo}</div>
        </div>

        <div class="alert-review-tags">
          <span class="alert-pill ${item.levelClass}">${item.level}</span>
          <span class="alert-pill low">Puntaje ${item.score}</span>
        </div>
      </div>

      <div class="alert-review-grid">
        <div class="alert-review-row"><strong>Colegio:</strong> ${item.colegio || "—"}</div>
        <div class="alert-review-row"><strong>Curso:</strong> ${item.curso || "—"}</div>
        <div class="alert-review-row"><strong>Año viaje:</strong> ${item.anoViaje || "—"}</div>
        <div class="alert-review-row"><strong>Comuna:</strong> ${item.comunaCiudad || "—"}</div>
        <div class="alert-review-row"><strong>Vendedor/a:</strong> ${item.vendedora || "Sin asignar"}</div>
        <div class="alert-review-row"><strong>Estado:</strong> ${item.estado || "—"}</div>
      </div>

      <ul class="alert-review-reasons">
        ${item.reasons.map((reason) => `<li>${reason}</li>`).join("")}
      </ul>

      <a class="alert-review-link" href="${item.url}" target="_blank" rel="noopener">
        Abrir grupo en nueva pestaña
      </a>
    </article>
  `).join("");
}

async function findPotentialDuplicateAlerts(data = {}) {
  const snap = await getDocs(collection(db, "ventas_cotizaciones"));
  const currentYear = getCurrentYear();
  const inputYear = Number(data.anoViaje || "");
  const inputComuna = normalizeSearch(data.comunaCiudad || "");
  const inputNames = [data.nombreCliente, data.nombreCliente2]
    .map((value) => normalizeText(value))
    .filter(Boolean);
  const inputEmails = [data.correoCliente, data.correoCliente2]
    .map((value) => normalizeEmail(value))
    .filter(Boolean);
  const inputPhones = [data.celularCliente, data.celularCliente2]
    .map((value) => normalizePhoneLoose(value))
    .filter(Boolean);

  const results = [];

  snap.docs.forEach((row) => {
    const rowData = row.data() || {};
    const rowId = normalizeText(rowData.idGrupo || row.id || "");
    const rowYear = Number(rowData.anoViaje || "");

    if (Number.isFinite(rowYear) && rowYear && rowYear < currentYear) {
      return;
    }

    let score = 0;
    let hardSignals = 0;
    let businessCritical = false;
    const reasons = [];

    const schoolSimilarity = getSchoolSimilarity(
      data.colegio || data.colegioBase || "",
      rowData.colegio || rowData.colegioBase || ""
    );

    if (schoolSimilarity >= 0.95) {
      score += 28;
      pushUniqueReason(reasons, "Colegio muy parecido");
    } else if (schoolSimilarity >= 0.82) {
      score += 18;
      pushUniqueReason(reasons, "Colegio parecido");
    }

    const rowComuna = normalizeSearch(rowData.comunaCiudad || rowData.comuna || "");
    if (inputComuna && rowComuna && inputComuna === rowComuna) {
      score += 10;
      pushUniqueReason(reasons, "Misma comuna/ciudad");
    }

    if (inputYear && Number.isFinite(rowYear) && rowYear) {
      if (rowYear === inputYear) {
        score += 18;
        pushUniqueReason(reasons, `Mismo año de viaje (${rowYear})`);
      } else if (rowYear > inputYear) {
        score += 8;
        pushUniqueReason(reasons, `Año de viaje futuro (${rowYear})`);
      }
    }

    const courseSimilarity = Math.max(
      getCourseSimilarity(data.curso, rowData.curso || ""),
      getCourseSimilarity(data.cursoViaje, rowData.cursoViaje || "")
    );

    if (courseSimilarity >= 1) {
      score += 18;
      pushUniqueReason(reasons, "Mismo curso");
    } else if (courseSimilarity >= 0.88) {
      score += 12;
      pushUniqueReason(reasons, "Curso parecido / misma numeración con otra letra");
    }

    const rowNames = [rowData.nombreCliente, rowData.nombreCliente2]
      .map((value) => normalizeText(value))
      .filter(Boolean);

    let bestNameMatch = { score: 0, value: "" };

    inputNames.forEach((inputName) => {
      rowNames.forEach((rowName) => {
        const sim = getNameSimilarity(inputName, rowName);
        if (sim > bestNameMatch.score) {
          bestNameMatch = { score: sim, value: rowName };
        }
      });
    });

    if (bestNameMatch.score >= 0.97) {
      score += 34;
      hardSignals += 1;
      pushUniqueReason(reasons, `Nombre de contacto muy parecido: ${bestNameMatch.value}`);
    } else if (bestNameMatch.score >= 0.88) {
      score += 22;
      pushUniqueReason(reasons, `Nombre de contacto parecido: ${bestNameMatch.value}`);
    }

    const rowEmails = [rowData.correoCliente, rowData.correoCliente2]
      .map((value) => normalizeEmail(value))
      .filter(Boolean);

    const matchedEmail = inputEmails.find((email) => email && rowEmails.includes(email));
    if (matchedEmail) {
      score += 60;
      hardSignals += 1;
      pushUniqueReason(reasons, `Mismo correo: ${matchedEmail}`);
    }

    const rowPhones = [rowData.celularCliente, rowData.celularCliente2]
      .map((value) => normalizePhoneLoose(value))
      .filter(Boolean);

    const matchedPhone = inputPhones.find((phone) => phone && rowPhones.includes(phone));
    if (matchedPhone) {
      score += 55;
      hardSignals += 1;
      pushUniqueReason(reasons, `Mismo celular terminado en ${matchedPhone}`);
    }

    const shouldKeep =
      hardSignals > 0 ||
      score >= 35 ||
      (schoolSimilarity >= 0.82 && courseSimilarity >= 0.88 && rowYear === inputYear) ||
      (bestNameMatch.score >= 0.88 && schoolSimilarity >= 0.78);

    if (!shouldKeep) return;

    const sameComuna = inputComuna && rowComuna && inputComuna === rowComuna;
    const sameYear = inputYear && Number.isFinite(rowYear) && rowYear === inputYear;
    const nearBusinessMatch =
      schoolSimilarity >= 0.95 &&
      sameComuna &&
      (courseSimilarity >= 0.88 || sameYear);
    
    if (nearBusinessMatch) {
      businessCritical = true;
      pushUniqueReason(reasons, "Posible conflicto comercial crítico: mismo colegio/comuna y curso o año relacionado");
    }

    const level = getAlertLevel(score, hardSignals, businessCritical);

    results.push({
      relatedIdGrupo: rowId,
      codigoRegistro: normalizeText(rowData.codigoRegistro || ""),
      aliasGrupo: normalizeText(rowData.aliasGrupo || rowData.nombreGrupo || rowData.colegio || rowId),
      colegio: normalizeText(rowData.colegio || ""),
      curso: normalizeText(rowData.cursoViaje || rowData.curso || ""),
      anoViaje: normalizeText(rowData.anoViaje || ""),
      comunaCiudad: normalizeText(rowData.comunaCiudad || rowData.comuna || ""),
      vendedora: normalizeText(rowData.vendedora || "") || "Sin asignar",
      estado: normalizeText(rowData.estado || "") || "A contactar",
      level,
      levelClass: getAlertLevelClass(level),
      score,
      reasons,
      url: `${DETALLE_GRUPO_URL}?id=${encodeURIComponent(rowId)}`
    });
  });

  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);
}

function renderAlertReviewModal(matches = []) {
  const summary = $("alertReviewSummary");
  const primaryList = $("alertReviewPrimaryList");
  const moreWrap = $("alertReviewMoreWrap");
  const moreList = $("alertReviewMoreList");
  const toggleMoreBtn = $("btnAlertReviewToggleMore");

  const { altas, otras } = splitAlertMatches(matches);

  if (summary) {
    summary.textContent = summarizeAlertMatches(matches);
  }

  if (primaryList) {
    if (altas.length) {
      primaryList.innerHTML = buildAlertReviewCardsHtml(altas);
    } else {
      primaryList.innerHTML = `
        <div class="alert-review-empty">
          No se encontraron coincidencias de alta prioridad.
          Puedes desplegar abajo las coincidencias medias y bajas si quieres revisarlas.
        </div>
      `;
    }
  }

  if (moreWrap && moreList && toggleMoreBtn) {
    if (otras.length) {
      moreWrap.classList.remove("hidden");
      moreList.classList.add("hidden");
      moreList.innerHTML = buildAlertReviewCardsHtml(otras);
      toggleMoreBtn.dataset.total = String(otras.length);
      toggleMoreBtn.textContent = `Ver coincidencias medias y bajas (${otras.length})`;
    } else {
      moreWrap.classList.add("hidden");
      moreList.classList.add("hidden");
      moreList.innerHTML = "";
      toggleMoreBtn.dataset.total = "0";
      toggleMoreBtn.textContent = "Ver coincidencias medias y bajas";
    }
  }
}

function openAlertReviewModal(matches = []) {
  renderAlertReviewModal(matches);
  $("alertReviewModal")?.classList.add("show");
}

function closeAlertReviewModal() {
  $("alertReviewModal")?.classList.remove("show");
}

function clearAlertReviewState() {
  state.pendingAlertReview = null;
  closeAlertReviewModal();
}

async function createRegistroAlertReviewEntry({
  idGrupo = "",
  codigoRegistro = "",
  aliasGrupo = "",
  colegio = "",
  alerts = [],
  creadoPor = "",
  creadoPorCorreo = ""
} = {}) {
  if (!alerts.length) return;

  await addDoc(collection(db, HISTORIAL_COLLECTION), {
    idGrupo: String(idGrupo || ""),
    codigoRegistro: normalizeText(codigoRegistro || ""),
    aliasGrupo: normalizeText(aliasGrupo || ""),
    colegio: normalizeText(colegio || ""),

    tipoMovimiento: "revision_previa_duplicidad",
    modulo: "registro-contacto",
    titulo: "Revisión preventiva de posibles coincidencias",
    mensaje: `${creadoPor || "Usuario"} revisó ${alerts.length} posible(s) coincidencia(s) antes de crear el grupo y decidió continuar con el registro.`,

    metadata: {
      totalAlertas: alerts.length,
      alertas: alerts.map((item) => ({
        relatedIdGrupo: item.relatedIdGrupo,
        codigoRegistro: item.codigoRegistro,
        aliasGrupo: item.aliasGrupo,
        colegio: item.colegio,
        curso: item.curso,
        anoViaje: item.anoViaje,
        comunaCiudad: item.comunaCiudad,
        vendedora: item.vendedora,
        estado: item.estado,
        level: item.level,
        score: item.score,
        reasons: item.reasons
      })),
      creadoDesde: "registro-contacto"
    },

    creadoPor: creadoPor || "",
    creadoPorCorreo: normalizeEmail(creadoPorCorreo || ""),
    fecha: serverTimestamp()
  });
}

function getOptionKey(email, numeroColegio, colegio, comuna = "") {
  return `${normalizeEmail(email)}__${normalizeText(numeroColegio)}__${normalizeText(colegio)}__${normalizeText(comuna)}`;
}

function getCarteraOptionsByColegioInput() {
  const colegioInput = normalizeSearch($("inputColegio")?.value || "");
  if (!colegioInput) return [];

  return state.carteraOptions.filter(
    opt => normalizeSearch(opt.colegio) === colegioInput
  );
}

function getExactCarteraOptionByInput() {
  const matches = getCarteraOptionsByColegioInput();
  if (!matches.length) return null;

  const comunaInput = normalizeSearch($("comunaCiudad")?.value || "");

  // Si solo existe un colegio con ese nombre, aceptamos match automático.
  // Pero si el usuario escribió una comuna distinta, se rompe el match.
  if (matches.length === 1) {
    if (!comunaInput) return matches[0];

    return normalizeSearch(matches[0].comuna || "") === comunaInput
      ? matches[0]
      : null;
  }

  // Si hay varios colegios con el mismo nombre,
  // obligamos a resolver por comuna.
  if (!comunaInput) return null;

  return (
    matches.find(opt => normalizeSearch(opt.comuna || "") === comunaInput) || null
  );
}

function getAssignmentDecision(carteraOpt = null) {
  const isVendor = state.effectiveUser?.rol === "vendedor";
  const ownerEmail = normalizeEmail(carteraOpt?.vendedoraCorreo || "");
  const ownerName = normalizeText(carteraOpt?.vendedora || "");

  const currentVendorEmails = isVendor
    ? getVentasUserEmails(state.effectiveUser).map(normalizeEmail)
    : [];

  const belongsToEffectiveVendor =
    !!carteraOpt &&
    !!ownerEmail &&
    currentVendorEmails.includes(ownerEmail);

  if (carteraOpt) {
    return {
      vendedora: ownerName || "Sin asignar",
      vendedoraCorreo: ownerEmail,
      requiereAsignacion: false,
      estado: belongsToEffectiveVendor ? "Contactado" : "A contactar",
      esPropia: belongsToEffectiveVendor
    };
  }

  return {
    vendedora: "Sin asignar",
    vendedoraCorreo: "",
    requiereAsignacion: true,
    estado: "A contactar",
    esPropia: false
  };
}

function ensureComunaDatalist() {
  const comunaInput = $("comunaCiudad");
  if (!comunaInput) return null;

  let list = $("listaComunasColegio");

  if (!list) {
    list = document.createElement("datalist");
    list.id = "listaComunasColegio";
    (comunaInput.form || document.body).appendChild(list);
  }

  comunaInput.setAttribute("list", "listaComunasColegio");
  return list;
}

function updateComunaSuggestionsByColegio() {
  const list = ensureComunaDatalist();
  if (!list) return;

  list.innerHTML = "";

  const matches = getCarteraOptionsByColegioInput();

  const comunas = [...new Set(
    matches
      .map(opt => normalizeText(opt.comuna || ""))
      .filter(Boolean)
  )].sort((a, b) => a.localeCompare(b, "es"));

  comunas.forEach((comuna) => {
    const option = document.createElement("option");
    option.value = comuna;
    list.appendChild(option);
  });
}

function getCheckedValues(name) {
  return [...document.querySelectorAll(`input[name="${name}"]:checked`)]
    .map(el => normalizeText(el.value))
    .filter(Boolean);
}

function uniqueStrings(items = []) {
  return [...new Set(items.filter(Boolean))];
}

function toUppercaseLive(value = "") {
  return String(value ?? "").toLocaleUpperCase("es-CL");
}

function forceUppercaseInputValue(el) {
  if (!el || el.id === "correoCliente" || el.id === "correoCliente2") return;

  const next = toUppercaseLive(el.value || "");
  if (el.value === next) return;

  const start = el.selectionStart;
  const end = el.selectionEnd;

  el.value = next;

  try {
    if (typeof start === "number" && typeof end === "number") {
      el.setSelectionRange(start, end);
    }
  } catch {}
}

function bindUppercaseField(el, onAfter = null) {
  if (!el || el.dataset.uppercaseBound === "1") return;

  el.dataset.uppercaseBound = "1";

  const handler = () => {
    forceUppercaseInputValue(el);
    if (typeof onAfter === "function") onAfter();
  };

  el.addEventListener("input", handler);
  el.addEventListener("change", handler);
}

function uppercaseSelectOptionLabels(selectEl) {
  if (!selectEl || selectEl.dataset.uppercaseOptions === "1") return;

  selectEl.dataset.uppercaseOptions = "1";

  [...selectEl.options].forEach((opt) => {
    opt.textContent = toUppercaseLive(opt.textContent || "");
  });
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
      setHeaderAndScope();
      await loadCarteraOptions();
      resetForm();
    },
    onResetActAs: async () => {
      sessionStorage.removeItem(ACTING_USER_KEY);
      await bootstrapFromSession();
      setHeaderAndScope();
      await loadCarteraOptions();
      resetForm();
    }
  });
}

/* =========================================================
   CARTERA
========================================================= */
async function loadCarteraOptions() {
  setProgressStatus({
    text: "Cargando cartera...",
    meta: "Leyendo colegios disponibles...",
    progress: 15
  });

  const sellersSnap = await getDocs(collection(db, "ventas_cartera"));
  const sellerEmails = [...new Set(
    sellersSnap.docs
      .map(d => normalizeEmail(d.id))
      .filter(Boolean)
  )];

  const map = new Map();

  for (let i = 0; i < sellerEmails.length; i++) {
    const sellerEmail = sellerEmails[i];
    const itemsSnap = await getDocs(collection(db, "ventas_cartera", sellerEmail, "items"));

    itemsSnap.docs.forEach((d) => {
      const data = d.data() || {};
      const estatus = normalizeText(data.estatus || "");

      // Solo colegios con estatus OK entran a la lista de cartera
      if (normalizeSearch(estatus) !== "ok") return;

      const colegio =
        normalizeText(data.colegioBase || data.colegio || data.colegioOriginal || "");

      if (!colegio) return;

      const comuna = normalizeText(data.comuna || "");
      const numeroColegio = normalizeText(data.numeroColegio || d.id || "");
      const vendedoraNombre = normalizeText(
        `${data.nombreVendedor || ""} ${data.apellidoVendedor || ""}`.trim()
      );

      // Ahora la unicidad de cartera es colegio + comuna
      const key = normalizeSearch(`${colegio}__${comuna}`);

      if (!map.has(key)) {
        map.set(key, {
          key: getOptionKey(data.correoVendedor || sellerEmail, numeroColegio, colegio, comuna),
          colegio,
          colegioBase: normalizeText(data.colegioBase || colegio),
          numeroColegio,
          vendedora: vendedoraNombre,
          vendedoraCorreo: normalizeEmail(data.correoVendedor || sellerEmail),
          comuna,
          estatus
        });
      }
    });

    const pct = 15 + Math.round(((i + 1) / Math.max(1, sellerEmails.length)) * 70);
    setProgressStatus({
      text: "Cargando cartera...",
      meta: `Vendedores procesados: ${i + 1}/${sellerEmails.length}`,
      progress: pct
    });
  }

  state.carteraOptions = [...map.values()].sort((a, b) => {
    const bySchool = a.colegio.localeCompare(b.colegio, "es");
    if (bySchool !== 0) return bySchool;
    return (a.comuna || "").localeCompare(b.comuna || "", "es");
  });

  renderCarteraSelect();

  setProgressStatus({
    text: "Cartera lista.",
    meta: `${state.carteraOptions.length} combinación(es) colegio/comuna disponibles.`,
    progress: 100,
    type: "success"
  });
  clearProgressStatus();
}

function renderCarteraSelect() {
  const list = $("listaColegios");
  if (!list) return;

  list.innerHTML = "";

  const used = new Set();

  state.carteraOptions.forEach((opt) => {
    const colegio = normalizeText(opt.colegio || "");
    const key = normalizeSearch(colegio);

    if (!colegio || used.has(key)) return;
    used.add(key);

    const option = document.createElement("option");
    option.value = colegio;
    list.appendChild(option);
  });
}

function updateSchoolModeUI() {
  const matched = getExactCarteraOptionByInput();
  const colegioMatches = getCarteraOptionsByColegioInput();

  const inputColegio = $("inputColegio");
  const vendedoraPreview = $("vendedoraPreview");
  const estadoPreview = $("estadoPreview");
  const comunaCiudad = $("comunaCiudad");
  const comunaInput = normalizeSearch($("comunaCiudad")?.value || "");

  updateComunaSuggestionsByColegio();

  if (!inputColegio || !vendedoraPreview || !estadoPreview) return;

  if (matched) {
    const assignment = getAssignmentDecision(matched);

    vendedoraPreview.textContent = assignment.vendedora || "—";
    estadoPreview.textContent = assignment.estado || "—";

    if (comunaCiudad && !normalizeText(comunaCiudad.value)) {
      comunaCiudad.value = matched.comuna || "";
      updateComunaSuggestionsByColegio();
    }
  } else {
    if (normalizeText(inputColegio.value)) {
      // Solo obligamos a distinguir comuna si hay varios colegios con el mismo nombre
      // y todavía no se ha indicado una comuna.
      if (colegioMatches.length > 1 && !comunaInput) {
        vendedoraPreview.textContent = "Selecciona comuna";
        estadoPreview.textContent = "Pendiente";
      } else {
        const assignment = getAssignmentDecision(null);
        vendedoraPreview.textContent = assignment.vendedora;
        estadoPreview.textContent = assignment.estado;
      }
    } else {
      vendedoraPreview.textContent = "—";
      estadoPreview.textContent = "—";
    }
  }

  updateAliasPreview();
}

function updateConditionalFields() {
  const origenEsp = $("origenEspecificacion")?.value || "";
  const destinoPrincipal = $("destinoPrincipal")?.value || "";
  const secundarios = getCheckedValues("destinoSecundario");

  $("wrapOrigenEspecificacionOtro")?.classList.toggle("hidden", origenEsp !== "Otro");
  $("wrapDestinoPrincipalOtro")?.classList.toggle("hidden", destinoPrincipal !== "Otro");
  $("wrapDestinoSecundarioOtro")?.classList.toggle("hidden", !secundarios.includes("Otro"));
}

function showSuccessModal() {
  if (!state.lastCreated) return;

  const dt = state.lastCreated.createdAt || new Date();

  $("successCodigo").textContent = state.lastCreated.codigoRegistro || "—";
  $("successColegio").textContent = state.lastCreated.colegio || "—";
  $("successCreadoPor").textContent = state.lastCreated.creadoPor || "—";
  $("successFecha").textContent = dt.toLocaleDateString("es-CL");
  $("successHora").textContent = dt.toLocaleTimeString("es-CL", {
    hour: "2-digit",
    minute: "2-digit"
  });

  $("successModal")?.classList.add("show");
}

function closeSuccessModal() {
  $("successModal")?.classList.remove("show");
}

function resetForm() {
  $("registroForm")?.reset();
  $("anoViaje").value = getCurrentYear();
  clearAlertReviewState();
  updateSchoolModeUI();
  updateConditionalFields();
  updateAliasPreview();
}

/* =========================================================
   VALIDACIÓN Y PAYLOAD
========================================================= */
function validateForm(data) {
  if (!data.colegio) {
    return "Debes indicar el colegio.";
  }

  if (!data.curso) {
    return "Debes indicar el curso.";
  }

  if (!hasValidCursoFormat(data.curso)) {
    return "El curso debe comenzar con un número válido (1 a 11) y luego puede llevar letras, todo junto y sin espacios. Ejemplo: 4, 4A, 8DAVINCI, 9, 10A, 11DAVINCI.";
  }

  if (!data.anoViaje) {
    return "Debes indicar el año del viaje.";
  }

  if (Number(data.anoViaje) < getCurrentYear()) {
    return "El año del viaje no puede ser menor al año actual.";
  }

  if (!data.cantidadGrupo && data.cantidadGrupo !== 0) {
    return "Debes indicar la cantidad del grupo.";
  }

  if (!Number.isFinite(Number(data.cantidadGrupo)) || Number(data.cantidadGrupo) <= 0) {
    return "La cantidad del grupo debe ser un número mayor a 0.";
  }

  if (!data.cursoViaje) {
    return "No se pudo calcular el curso proyectado para el año del viaje.";
  }

  if (!data.aliasGrupo || !data.aliasTripKey) {
    return "No se pudo construir el alias del grupo.";
  }

  if (data.colegioMatchesCount > 1 && !data.esCartera && !data.comunaCiudad) {
    return "Debes indicar la comuna o ciudad para distinguir colegios con el mismo nombre en cartera.";
  }

  // Si no quedó en cartera, igual debe poder guardarse,
  // pero la comuna sigue siendo obligatoria para identificar bien el colegio.
  if (!data.esCartera && !data.comunaCiudad) {
    return "Debes indicar la comuna o ciudad cuando el colegio no pertenece a cartera.";
  }

  if (!data.nombreCliente) {
    return "Debes indicar el nombre del cliente.";
  }

  if (!data.rolCliente) {
    return "Debes seleccionar el rol del cliente.";
  }

  if (!data.correoCliente && !data.celularCliente) {
    return "Debes ingresar al menos correo o celular del cliente.";
  }

    const hasSecondContactData = Boolean(
    data.nombreCliente2 ||
    data.rolCliente2 ||
    data.correoCliente2 ||
    data.celularCliente2
  );

  if (hasSecondContactData) {
    if (!data.nombreCliente2) {
      return "Si registras 2° contacto, debes indicar el nombre.";
    }

    if (!data.rolCliente2) {
      return "Si registras 2° contacto, debes seleccionar el rol.";
    }

    if (!data.correoCliente2 && !data.celularCliente2) {
      return "Si registras 2° contacto, debes ingresar correo o celular.";
    }
  }

  if (!data.origenCliente) {
    return "Debes seleccionar el origen del cliente.";
  }

  if (!data.origenEspecificacion) {
    return "Debes seleccionar la especificación del origen.";
  }

  if (data.origenEspecificacion === "Otro" && !data.origenEspecificacionOtro) {
    return "Debes especificar el otro origen.";
  }

  if (!data.destinoPrincipal) {
    return "Debes seleccionar el destino principal.";
  }

  if (data.destinoPrincipal === "Otro" && !data.destinoPrincipalOtro) {
    return "Debes especificar el otro destino principal.";
  }

  if (data.destinosSecundarios.includes("Otro") && !data.destinoSecundarioOtro) {
    return "Debes especificar el otro destino secundario.";
  }

  return "";
}

function readFormData() {
  const carteraOpt = getExactCarteraOptionByInput();
  const colegioMatches = getCarteraOptionsByColegioInput();
  const esCartera = !!carteraOpt;
  const assignment = getAssignmentDecision(carteraOpt);

  const colegio = normalizeText($("inputColegio")?.value || "");
  const comunaInput = normalizeText($("comunaCiudad")?.value || "");
  const comunaFinal = esCartera
    ? normalizeText(carteraOpt?.comuna || comunaInput)
    : comunaInput;

  const curso = normalizeCursoInput($("inputCurso")?.value || "");
  const anoBaseCurso = getCurrentYear();
  const anoViaje = normalizeText($("anoViaje")?.value || "");
  const cantidadGrupoRaw = normalizeText($("cantidadGrupo")?.value || "");
  const cantidadGrupoNum = Number(cantidadGrupoRaw);
  const cantidadGrupo = Number.isFinite(cantidadGrupoNum) ? cantidadGrupoNum : "";

  const cursoViaje = projectCursoToYear(curso, anoBaseCurso, anoViaje);
  const aliasGrupo = buildAliasGrupo({
    cursoBase: curso,
    anoBase: anoBaseCurso,
    cursoViaje,
    anoViaje,
    colegio
  });

  const aliasTripKey = buildAliasTripKey({
    colegio,
    comuna: comunaFinal,
    cursoViaje,
    anoViaje
  });

  const destinosSecundarios = uniqueStrings(
    getCheckedValues("destinoSecundario").filter(v => v !== ($("destinoPrincipal")?.value || ""))
  );

  return {
    esCartera,
    colegioMatchesCount: colegioMatches.length,
    tipoColegio: esCartera ? "Cartera" : "No cartera",
    colegio,
    colegioBase: esCartera ? normalizeText(carteraOpt?.colegioBase || carteraOpt?.colegio || "") : colegio,
    carteraNumeroColegio: esCartera ? normalizeText(carteraOpt?.numeroColegio || "") : "",
    carteraCorreoVendedora: esCartera ? normalizeEmail(carteraOpt?.vendedoraCorreo || "") : "",
    vendedora: assignment.vendedora,
    vendedoraCorreo: assignment.vendedoraCorreo,
    requiereAsignacion: assignment.requiereAsignacion,
    estado: assignment.estado,

    curso,
    anoBaseCurso: String(anoBaseCurso),
    cursoViaje,
    aliasGrupo,
    aliasTripKey,
    cantidadGrupo,
    anoViaje,
    comunaCiudad: comunaFinal,
    nombreCliente: normalizeText($("nombreCliente")?.value || ""),
    rolCliente: normalizeText($("rolCliente")?.value || ""),
    correoCliente: normalizeEmail($("correoCliente")?.value || ""),
    celularCliente: normalizeText($("celularCliente")?.value || ""),

    nombreCliente2: normalizeText($("nombreCliente2")?.value || ""),
    rolCliente2: normalizeText($("rolCliente2")?.value || ""),
    correoCliente2: normalizeEmail($("correoCliente2")?.value || ""),
    celularCliente2: normalizeText($("celularCliente2")?.value || ""),

    nombreCliente2: normalizeText($("nombreCliente2")?.value || ""),
    rolCliente2: normalizeText($("rolCliente2")?.value || ""),
    correoCliente2: normalizeEmail($("correoCliente2")?.value || ""),
    celularCliente2: normalizeText($("celularCliente2")?.value || ""),

    origenCliente: normalizeText($("origenCliente")?.value || ""),
    origenEspecificacion: normalizeText($("origenEspecificacion")?.value || ""),
    origenEspecificacionOtro: normalizeText($("origenEspecificacionOtro")?.value || ""),
    destinoPrincipal: normalizeText($("destinoPrincipal")?.value || ""),
    destinoPrincipalOtro: normalizeText($("destinoPrincipalOtro")?.value || ""),
    destinosSecundarios,
    destinoSecundarioOtro: normalizeText($("destinoSecundarioOtro")?.value || "")
  };
}

function buildCodigoRegistro(docId) {
  const year = new Date().getFullYear();
  return `COT-${year}-${String(docId).slice(0, 6).toUpperCase()}`;
}

async function createRegistroHistorialEntry({
  idGrupo = "",
  codigoRegistro = "",
  aliasGrupo = "",
  colegio = "",
  estado = "",
  vendedora = "",
  vendedoraCorreo = "",
  origenColegio = "",
  creadoPor = "",
  creadoPorCorreo = ""
} = {}) {
  await addDoc(collection(db, HISTORIAL_COLLECTION), {
    idGrupo: String(idGrupo || ""),
    codigoRegistro: normalizeText(codigoRegistro || ""),
    aliasGrupo: normalizeText(aliasGrupo || ""),
    colegio: normalizeText(colegio || ""),

    tipoMovimiento: "registro_contacto",
    modulo: "registro-contacto",
    titulo: "Registro inicial del grupo",
    mensaje: `${creadoPor || "Usuario"} registró el grupo en el sistema.`,

    metadata: {
      cambios: [
        { campo: "estado", anterior: "", nuevo: normalizeText(estado || "") },
        { campo: "vendedora", anterior: "", nuevo: normalizeText(vendedora || "") },
        { campo: "vendedoraCorreo", anterior: "", nuevo: normalizeEmail(vendedoraCorreo || "") },
        { campo: "origenColegio", anterior: "", nuevo: normalizeText(origenColegio || "") }
      ],
      creadoDesde: "registro-contacto"
    },

    creadoPor: creadoPor || "",
    creadoPorCorreo: normalizeEmail(creadoPorCorreo || ""),
    fecha: serverTimestamp()
  });
}

async function getNextSequentialIdGrupo() {
  const snap = await getDocs(collection(db, "ventas_cotizaciones"));

  // Piso inicial según tu base actual
  let maxId = 10935;

  snap.docs.forEach((row) => {
    const data = row.data() || {};

    const candidates = [
      String(row.id || "").trim(),
      String(data.idGrupo || "").trim()
    ];

    candidates.forEach((candidate) => {
      if (/^\d+$/.test(candidate)) {
        maxId = Math.max(maxId, Number(candidate));
      }
    });
  });

  return String(maxId + 1);
}

/* =========================================================
   GUARDAR
========================================================= */
async function saveRegistro(e) {
  e.preventDefault();

  const btn = $("btnGuardarRegistro");
  const data = readFormData();
  const validation = validateForm(data);

  if (validation) {
    alert(validation);
    return;
  }

  try {
    if (btn) btn.disabled = true;

    setProgressStatus({
      text: "Registrando contacto...",
      meta: "Preparando registro...",
      progress: 20
    });

    setProgressStatus({
      text: "Registrando contacto...",
      meta: "Validando alias del grupo...",
      progress: 35
    });

    const conflict = await findExistingAliasConflict(data.aliasTripKey);

    if (conflict) {
      const conflictCode = normalizeText(conflict.data?.codigoRegistro || conflict.id || "");
      const conflictAlias = normalizeText(conflict.data?.aliasGrupo || "");
      const conflictComuna = normalizeText(conflict.data?.comunaCiudad || conflict.data?.comuna || "");
      clearProgressStatus();

      alert(
        `Ya existe una cotización para ${data.cursoViaje} (${data.anoViaje}) en ${data.colegio}${data.comunaCiudad ? `, ${data.comunaCiudad}` : ""}.\n\n` +
        `Registro existente: ${conflictCode || "sin código"}\n` +
        `${conflictAlias ? `Alias: ${conflictAlias}\n` : ""}` +
        `${conflictComuna ? `Comuna: ${conflictComuna}\n\n` : "\n"}` +
        `No se puede crear otro grupo con el mismo curso proyectado, año de viaje, colegio y comuna.`
      );

      return;
    }

    setProgressStatus({
      text: "Registrando contacto...",
      meta: "Buscando posibles coincidencias...",
      progress: 62
    });

    const alerts = await findPotentialDuplicateAlerts(data);

    if (alerts.length) {
      state.pendingAlertReview = { data, alerts };
      clearProgressStatus();
      openAlertReviewModal(alerts);
      return;
    }

    await persistRegistro({
      data,
      alerts: [],
      confirmedAfterReview: false
    });
  } catch (error) {
    console.error(error);
    setProgressStatus({
      text: "Error revisando el registro.",
      meta: error.message || "No se pudo completar la revisión previa.",
      progress: 100,
      type: "error"
    });
  } finally {
    if (!state.pendingAlertReview && btn) {
      btn.disabled = false;
    }
  }
}

async function persistRegistro({
  data,
  alerts = [],
  confirmedAfterReview = false
} = {}) {
  const btn = $("btnGuardarRegistro");

  try {
    if (btn) btn.disabled = true;

    setProgressStatus({
      text: "Registrando contacto...",
      meta: "Generando nuevo grupo...",
      progress: 78
    });

    const idGrupo = await getNextSequentialIdGrupo();
    const newRef = doc(db, "ventas_cotizaciones", idGrupo);
    const codigoRegistro = buildCodigoRegistro(idGrupo);

    const payload = {
      idGrupo,
      codigoRegistro,
      tipoRegistro: "cotizacion",

      fichaFlujoModo: "nuevo",

      origenColegio: data.tipoColegio,
      colegio: data.colegio,
      colegioBase: data.colegioBase,
      carteraNumeroColegio: data.carteraNumeroColegio,
      carteraCorreoVendedora: data.carteraCorreoVendedora,

      vendedora: data.vendedora,
      vendedoraCorreo: data.vendedoraCorreo,
      requiereAsignacion: data.requiereAsignacion,
      estado: data.estado,

      curso: data.curso,
      anoBaseCurso: data.anoBaseCurso,
      cursoViaje: data.cursoViaje,
      aliasGrupo: data.aliasGrupo,
      aliasTripKey: data.aliasTripKey,
      cantidadGrupo: data.cantidadGrupo,
      anoViaje: data.anoViaje,
      comunaCiudad: data.comunaCiudad,

      nombreCliente: data.nombreCliente,
      rolCliente: data.rolCliente,
      correoCliente: data.correoCliente,
      celularCliente: data.celularCliente,

      nombreCliente2: data.nombreCliente2,
      rolCliente2: data.rolCliente2,
      correoCliente2: data.correoCliente2,
      celularCliente2: data.celularCliente2,

      origenCliente: data.origenCliente,
      origenEspecificacion: data.origenEspecificacion,
      origenEspecificacionOtro: data.origenEspecificacionOtro,

      destinoPrincipal: data.destinoPrincipal,
      destinoPrincipalOtro: data.destinoPrincipalOtro,
      destinosSecundarios: data.destinosSecundarios,
      destinoSecundarioOtro: data.destinoSecundarioOtro,

      creadoPor: getNombreUsuario(state.effectiveUser),
      creadoPorCorreo: normalizeEmail(state.realUser?.email || ""),
      fechaCreacion: serverTimestamp(),
      actualizadoPor: getNombreUsuario(state.effectiveUser),
      actualizadoPorCorreo: normalizeEmail(state.realUser?.email || ""),
      fechaActualizacion: serverTimestamp()
    };

    setProgressStatus({
      text: "Registrando contacto...",
      meta: "Guardando en Firebase...",
      progress: 88
    });

    await setDoc(newRef, payload);

    await createRegistroHistorialEntry({
      idGrupo,
      codigoRegistro,
      aliasGrupo: data.aliasGrupo,
      colegio: data.colegio,
      estado: data.estado,
      vendedora: data.vendedora,
      vendedoraCorreo: data.vendedoraCorreo,
      origenColegio: data.tipoColegio,
      creadoPor: getNombreUsuario(state.effectiveUser),
      creadoPorCorreo: normalizeEmail(state.realUser?.email || "")
    });

    if (confirmedAfterReview && alerts.length) {
      await createRegistroAlertReviewEntry({
        idGrupo,
        codigoRegistro,
        aliasGrupo: data.aliasGrupo,
        colegio: data.colegio,
        alerts,
        creadoPor: getNombreUsuario(state.effectiveUser),
        creadoPorCorreo: normalizeEmail(state.realUser?.email || "")
      });
    }

    setProgressStatus({
      text: "Registro creado.",
      meta: `Código: ${codigoRegistro}`,
      progress: 100,
      type: "success"
    });
    clearProgressStatus(2000);

    state.lastCreated = {
      idGrupo,
      codigoRegistro,
      colegio: data.colegio,
      creadoPor: getNombreUsuario(state.effectiveUser),
      createdAt: new Date()
    };

    showSuccessModal();
  } catch (error) {
    console.error(error);
    setProgressStatus({
      text: "Error creando registro.",
      meta: error.message || "No se pudo guardar el contacto.",
      progress: 100,
      type: "error"
    });
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function continueRegistroAfterAlertReview() {
  const pending = state.pendingAlertReview;
  if (!pending) return;

  const continueBtn = $("btnAlertReviewContinue");
  if (continueBtn) continueBtn.disabled = true;

  closeAlertReviewModal();

  await persistRegistro({
    data: pending.data,
    alerts: pending.alerts,
    confirmedAfterReview: true
  });

  state.pendingAlertReview = null;

  if (continueBtn) continueBtn.disabled = false;
}

/* =========================================================
   EVENTOS
========================================================= */
function bindPageEvents() {
  const inputColegio = $("inputColegio");
  const inputCurso = $("inputCurso");
  const anoViaje = $("anoViaje");
  const cantidadGrupo = $("cantidadGrupo");
  const comunaCiudad = $("comunaCiudad");
  const nombreCliente = $("nombreCliente");
  const celularCliente = $("celularCliente");
  const correoCliente = $("correoCliente");
  const rolCliente = $("rolCliente");

  const nombreCliente2 = $("nombreCliente2");
  const celularCliente2 = $("celularCliente2");
  const correoCliente2 = $("correoCliente2");
  const rolCliente2 = $("rolCliente2");
  const origenCliente = $("origenCliente");
  const origenEspecificacion = $("origenEspecificacion");
  const origenEspecificacionOtro = $("origenEspecificacionOtro");
  const destinoPrincipal = $("destinoPrincipal");
  const destinoPrincipalOtro = $("destinoPrincipalOtro");
  const destinoSecundarioOtro = $("destinoSecundarioOtro");
  const btnLimpiar = $("btnLimpiar");
  const btnNuevoRegistro = $("btnNuevoRegistro");
  const btnIrRegistro = $("btnIrRegistro");
  const successModal = $("successModal");
  const alertReviewModal = $("alertReviewModal");
  const btnAlertReviewBack = $("btnAlertReviewBack");
  const btnAlertReviewContinue = $("btnAlertReviewContinue");
  const btnAlertReviewToggleMore = $("btnAlertReviewToggleMore");
  const form = $("registroForm");

  // Visualmente dejamos los selects en mayúscula, pero sin tocar sus values internos
  uppercaseSelectOptionLabels(rolCliente);
  uppercaseSelectOptionLabels(rolCliente2);
  uppercaseSelectOptionLabels(origenCliente);
  uppercaseSelectOptionLabels(origenEspecificacion);
  uppercaseSelectOptionLabels(destinoPrincipal);

  // Campos de texto que deben ir en mayúscula
  bindUppercaseField(inputColegio, updateSchoolModeUI);
  bindUppercaseField(comunaCiudad, updateSchoolModeUI);
  bindUppercaseField(nombreCliente);
  bindUppercaseField(celularCliente);
  bindUppercaseField(nombreCliente2);
  bindUppercaseField(celularCliente2);
  bindUppercaseField(origenEspecificacionOtro);
  bindUppercaseField(destinoPrincipalOtro);
  bindUppercaseField(destinoSecundarioOtro);

  // El curso mantiene su lógica especial sin espacios
  if (inputCurso && !inputCurso.dataset.bound) {
    inputCurso.dataset.bound = "1";
    inputCurso.addEventListener("input", () => {
      inputCurso.value = normalizeCursoInput(inputCurso.value);
      updateAliasPreview();
    });
    inputCurso.addEventListener("change", () => {
      inputCurso.value = normalizeCursoInput(inputCurso.value);
      updateAliasPreview();
    });
  }

  if (anoViaje && !anoViaje.dataset.bound) {
    anoViaje.dataset.bound = "1";
    anoViaje.addEventListener("input", updateAliasPreview);
    anoViaje.addEventListener("change", updateAliasPreview);
  }

  if (cantidadGrupo && !cantidadGrupo.dataset.bound) {
    cantidadGrupo.dataset.bound = "1";
    cantidadGrupo.addEventListener("input", () => {
      cantidadGrupo.value = String(cantidadGrupo.value || "").replace(/[^\d]/g, "");
    });
  }

  if (origenEspecificacion && !origenEspecificacion.dataset.bound) {
    origenEspecificacion.dataset.bound = "1";
    origenEspecificacion.addEventListener("change", updateConditionalFields);
  }

  if (destinoPrincipal && !destinoPrincipal.dataset.bound) {
    destinoPrincipal.dataset.bound = "1";
    destinoPrincipal.addEventListener("change", updateConditionalFields);
  }

  [...document.querySelectorAll('input[name="destinoSecundario"]')].forEach((input) => {
    if (!input.dataset.bound) {
      input.dataset.bound = "1";
      input.addEventListener("change", updateConditionalFields);
    }
  });

  // El correo NO se fuerza a mayúscula
  if (correoCliente && !correoCliente.dataset.bound) {
    correoCliente.dataset.bound = "1";
    correoCliente.addEventListener("input", () => {
      correoCliente.value = String(correoCliente.value || "").trim();
    });
    correoCliente.addEventListener("change", () => {
      correoCliente.value = String(correoCliente.value || "").trim();
    });
  }

    if (correoCliente2 && !correoCliente2.dataset.bound) {
    correoCliente2.dataset.bound = "1";
    correoCliente2.addEventListener("input", () => {
      correoCliente2.value = String(correoCliente2.value || "").trim();
    });
    correoCliente2.addEventListener("change", () => {
      correoCliente2.value = String(correoCliente2.value || "").trim();
    });
  }

  if (btnLimpiar && !btnLimpiar.dataset.bound) {
    btnLimpiar.dataset.bound = "1";
    btnLimpiar.addEventListener("click", resetForm);
  }

  if (btnNuevoRegistro && !btnNuevoRegistro.dataset.bound) {
    btnNuevoRegistro.dataset.bound = "1";
    btnNuevoRegistro.addEventListener("click", () => {
      closeSuccessModal();
      resetForm();
      $("inputColegio")?.focus();
    });
  }

  if (btnIrRegistro && !btnIrRegistro.dataset.bound) {
    btnIrRegistro.dataset.bound = "1";
    btnIrRegistro.addEventListener("click", () => {
      if (!state.lastCreated?.idGrupo) return;
      location.href = `${DETALLE_GRUPO_URL}?id=${encodeURIComponent(state.lastCreated.idGrupo)}`;
    });
  }

  if (successModal && !successModal.dataset.bound) {
    successModal.dataset.bound = "1";
    successModal.addEventListener("click", (e) => {
      if (e.target === successModal) {
        closeSuccessModal();
      }
    });
  }

    if (alertReviewModal && !alertReviewModal.dataset.bound) {
    alertReviewModal.dataset.bound = "1";
    alertReviewModal.addEventListener("click", (e) => {
      if (e.target === alertReviewModal) {
        clearAlertReviewState();
      }
    });
  }

  if (btnAlertReviewBack && !btnAlertReviewBack.dataset.bound) {
    btnAlertReviewBack.dataset.bound = "1";
    btnAlertReviewBack.addEventListener("click", () => {
      clearAlertReviewState();
      $("inputColegio")?.focus();
    });
  }

    if (btnAlertReviewToggleMore && !btnAlertReviewToggleMore.dataset.bound) {
    btnAlertReviewToggleMore.dataset.bound = "1";
    btnAlertReviewToggleMore.addEventListener("click", () => {
      const moreList = $("alertReviewMoreList");
      if (!moreList) return;

      const total = Number(btnAlertReviewToggleMore.dataset.total || "0");
      const wasHidden = moreList.classList.contains("hidden");

      moreList.classList.toggle("hidden");

      btnAlertReviewToggleMore.textContent = wasHidden
        ? `Ocultar coincidencias medias y bajas (${total})`
        : `Ver coincidencias medias y bajas (${total})`;
    });
  }

  if (btnAlertReviewContinue && !btnAlertReviewContinue.dataset.bound) {
    btnAlertReviewContinue.dataset.bound = "1";
    btnAlertReviewContinue.addEventListener("click", continueRegistroAfterAlertReview);
  }

  if (form && !form.dataset.bound) {
    form.dataset.bound = "1";
    form.addEventListener("submit", saveRegistro);
  }
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
    setHeaderAndScope();
    await loadCarteraOptions();
    resetForm();
  });
}

initPage();
