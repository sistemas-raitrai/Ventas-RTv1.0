import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.7.3/firebase-auth.js";
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";

import { auth, db, VENTAS_USERS } from "./firebase-init.js";

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

/* =========================================================
   ESTADO
========================================================= */
const state = {
  realUser: null,
  effectiveUser: null,
  quoteRows: [],
  historyRows: [],
  filteredRows: [],
  filters: {
    anoViaje: "",
    vendedora: "",
    comuna: "",
    estado: "",
    search: "",
    includePastYears: false
  },
  charts: {
    funnel: null,
    winsByVendor: null,
    meetingsByVendor: null,
    backlogByVendor: null
  },
  scoring: {
    mode: "actual",
    weights: {
      continuity: 20,
      performance: 35,
      historical: 30,
      workload: 15
    }
  },
  lastRender: null
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

function getRoleKey(user = {}) {
  return normalizeLoose(user?.rol || "");
}

function canViewInforme(user = {}) {
  const role = getRoleKey(user);
  return role === "admin" || role === "supervision" || role === "registro";
}

function assertAccess() {
  if (!canViewInforme(state.effectiveUser)) {
    location.href = "index.html";
    return false;
  }
  return true;
}

function getScopeText() {
  let text = "Informe comercial · Supervisión / Admin";

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

  const scope = $("informeScope");
  if (scope) {
    scope.textContent = "Resumen comercial de vendedores, grupos, embudo, alertas y oportunidades.";
  }
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

function getRowId(row = {}) {
  return String(row.idGrupo || row.id || "").trim();
}

function getRowVendorEmail(row = {}) {
  return normalizeEmail(row.vendedoraCorreo || "");
}

function getRowVendorName(row = {}) {
  return normalizeText(row.vendedora || "");
}

function isSinAsignar(row = {}) {
  const vendorName = normalizeSearch(getRowVendorName(row));
  return (
    !!row.requiereAsignacion ||
    (!getRowVendorEmail(row) && !getRowVendorName(row)) ||
    vendorName === "sin asignar"
  );
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

function getAnoViajeNumber(row = {}) {
  const raw = String(row.anoViaje ?? "").trim();
  const match = raw.match(/\d{4}/);
  if (!match) return null;
  const year = Number(match[0]);
  return Number.isFinite(year) ? year : null;
}

function getCurrentCommercialYear() {
  // Año comercial fijo o configurable
  return 2026;
}

function isCurrentOrFutureTravelYear(row = {}) {
  const year = getAnoViajeNumber(row);
  if (!year) return false;
  return year >= getCurrentCommercialYear();
}

function normalizeHistoryText(value = "") {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function extractHistoryDate(item = {}) {
  const raw = item.fecha || item.fechaOriginal || null;
  if (!raw) return null;
  if (typeof raw?.toDate === "function") return raw.toDate();
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function detectHistoryEvents(historyItems = []) {
  let hasMeeting = false;
  let hasWon = false;

  let meetingDate = null;
  let wonDate = null;

  historyItems.forEach((item) => {
    const text = normalizeHistoryText(
      `${item.asunto || ""} ${item.mensajeLimpio || item.mensaje || ""}`
    );

    const fecha = extractHistoryDate(item);

    if (text.includes("reunion confirmada")) {
      hasMeeting = true;
      if (fecha && (!meetingDate || fecha < meetingDate)) meetingDate = fecha;
    }

    if (text.includes("ganada")) {
      hasWon = true;
      if (fecha && (!wonDate || fecha < wonDate)) wonDate = fecha;
    }
  });

  const wonAfterMeeting = Boolean(
    hasMeeting &&
    hasWon &&
    meetingDate &&
    wonDate &&
    wonDate > meetingDate
  );

  return {
    hasMeeting,
    hasWon,
    wonAfterMeeting
  };
}

function safeRate(numerator = 0, denominator = 0) {
  if (!denominator) return 0;
  return numerator / denominator;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getSearchTarget(row = {}) {
  return normalizeSearch([
    row.idGrupo,
    row.codigoRegistro,
    row.aliasGrupo,
    row.colegio,
    row.nombreCliente,
    row.comunaCiudad,
    row.comuna,
    row.estado,
    row.vendedora,
    row.anoViaje
  ].join(" "));
}

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

function destroyChart(chart) {
  if (chart) chart.destroy();
}

function buildHistoryMap(rows = []) {
  const map = new Map();

  rows.forEach((item) => {
    const idGrupo = String(item.idGrupo || "").trim();
    if (!idGrupo) return;

    if (!map.has(idGrupo)) map.set(idGrupo, []);
    map.get(idGrupo).push(item);
  });

  return map;
}

function getScoringPreset(mode = "actual") {
  if (mode === "historico") {
    return { continuity: 20, performance: 20, historical: 45, workload: 15 };
  }

  if (mode === "asignacion") {
    return { continuity: 35, performance: 30, historical: 20, workload: 15 };
  }

  if (mode === "actual") {
    return { continuity: 20, performance: 45, historical: 25, workload: 10 };
  }

  return { continuity: 20, performance: 40, historical: 25, workload: 15 };
}

function readScoringInputs() {
  const mode = $("analysisMode")?.value || "actual";

  if (mode !== "personalizado") {
    const preset = getScoringPreset(mode);
    state.scoring.mode = mode;
    state.scoring.weights = { ...preset };

    if ($("weightContinuity")) $("weightContinuity").value = String(preset.continuity);
    if ($("weightPerformance")) $("weightPerformance").value = String(preset.performance);
    if ($("weightHistorical")) $("weightHistorical").value = String(preset.historical);
    if ($("weightWorkload")) $("weightWorkload").value = String(preset.workload);

    return;
  }

  const continuity = Number($("weightContinuity")?.value || 0);
  const performance = Number($("weightPerformance")?.value || 0);
  const historical = Number($("weightHistorical")?.value || 0);
  const workload = Number($("weightWorkload")?.value || 0);

  state.scoring.mode = "personalizado";
  state.scoring.weights = {
    continuity: Math.max(0, continuity),
    performance: Math.max(0, performance),
    historical: Math.max(0, historical),
    workload: Math.max(0, workload)
  };
}

function getCoverageFactor(rec = {}) {
  // Si el vendedor tiene poco histórico analizado, reducimos el peso histórico
  if (rec.historicalGroupsAnalyzed >= 8) return 1;
  if (rec.historicalGroupsAnalyzed >= 5) return 0.8;
  if (rec.historicalGroupsAnalyzed >= 3) return 0.6;
  if (rec.historicalGroupsAnalyzed >= 1) return 0.4;
  return 0;
}

function calculateWeightedTotal(rec = {}, weights = {}) {
  const coverageFactor = getCoverageFactor(rec);

  const continuityWeight = Number(weights.continuity || 0);
  const performanceWeight = Number(weights.performance || 0);
  const historicalWeight = Number(weights.historical || 0) * coverageFactor;
  const workloadWeight = Number(weights.workload || 0);

  const totalWeight = continuityWeight + performanceWeight + historicalWeight + workloadWeight;

  if (!totalWeight) return 0;

  const continuityNorm = safeRate(rec.continuityScore, 45);
  const performanceNorm = safeRate(rec.performanceScore, 30);
  const historicalNorm = safeRate(rec.historicalFunnelScore, 35);
  const workloadNorm = safeRate(rec.workloadScore, 25);

  const weighted =
    (continuityNorm * continuityWeight) +
    (performanceNorm * performanceWeight) +
    (historicalNorm * historicalWeight) +
    (workloadNorm * workloadWeight);

  return Math.round((weighted / totalWeight) * 100);
}

function getScoringModeLabel(mode = "") {
  if (mode === "actual") return "Gestión actual";
  if (mode === "historico") return "Histórico comercial";
  if (mode === "asignacion") return "Asignación inteligente";
  if (mode === "personalizado") return "Personalizado";
  return "Actual";
}

function renderScoringExplanation() {
  const modeText = $("scoringModeText");
  const weightsText = $("scoringWeightsText");

  if (!modeText || !weightsText) return;

  const mode = state.scoring.mode;
  const w = state.scoring.weights;

  let explanation = "";

  if (mode === "actual") {
    explanation = "Este modo analiza el desempeño actual considerando solo grupos con año de viaje 2026 en adelante. Prioriza reuniones, avance comercial, conversión a ganadas y backlog.";
  } else if (mode === "historico") {
    explanation = "Este modo prioriza el historial comercial: cuántos grupos llegan a reunión y cuántos terminan ganados después de reunión.";
  } else if (mode === "asignacion") {
    explanation = "Este modo está pensado para decidir asignaciones: da más peso a continuidad, desempeño actual y capacidad operativa.";
  } else {
    explanation = "Este modo usa una ponderación manual definida por quien analiza. Sirve para justificar decisiones según el criterio del momento.";
  }

  weightsText.textContent =
    `Modo: ${getScoringModeLabel(mode)} · ` +
    `Continuidad ${w.continuity}% · ` +
    `Desempeño ${w.performance}% · ` +
    `Embudo histórico ${w.historical}% · ` +
    `Disponibilidad ${w.workload}%`;

  modeText.textContent = explanation;
}

/* =========================================================
   KPI ENGINE
========================================================= */
function createVendorKpiBase(vendorEmail = "", vendorName = "") {
  return {
    vendorEmail,
    vendorName,

    totalAssigned: 0,
    activeCount: 0,
    aContactarCount: 0,
    contactadoCount: 0,
    cotizandoCount: 0,
    reunionCount: 0,
    ganadaCount: 0,
    perdidaCount: 0,

    currentPortfolioCount: 0,
    currentAContactarCount: 0,
    currentCotizandoCount: 0,
    currentReunionCount: 0,
    currentGanadaCount: 0,

    historicalGroupsAnalyzed: 0,
    historicalMeetingCount: 0,
    historicalWonCount: 0,
    historicalWonAfterMeetingCount: 0,

    reunionRateCurrent: 0,
    ganadaRateCurrent: 0,
    aContactarRateCurrent: 0,
    meetingRateHistorical: 0,
    winAfterMeetingRate: 0,

    continuityScore: 0,
    performanceScore: 0,
    historicalFunnelScore: 0,
    workloadScore: 0,
    totalScore: 0
  };
}

function calculateContinuityScorePlaceholder(rec = {}) {
  let score = 0;

  if (rec.totalAssigned >= 40) score += 10;
  else if (rec.totalAssigned >= 20) score += 6;
  else if (rec.totalAssigned >= 10) score += 3;

  if (rec.currentPortfolioCount >= 10) score += 6;
  if (rec.currentReunionCount >= 3) score += 8;
  if (rec.currentGanadaCount >= 2) score += 8;

  return clamp(Math.round(score), 0, 45);
}

function calculatePerformanceScore(rec = {}) {
  let score = 0;

  // 🔹 Volumen de avance
  score += Math.min(8, rec.currentReunionCount * 1.8);
  score += Math.min(7, rec.currentGanadaCount * 2);

  // 🔹 Calidad de avance (LO MÁS IMPORTANTE)
  score += rec.reunionRateCurrent * 18;
  score += rec.ganadaRateCurrent * 12;

  // 🔹 Cotizando suma pero menos
  score += Math.min(4, rec.currentCotizandoCount * 0.8);

  // 🔻 Penalización SOLO por abandono (A contactar)
  score -= rec.aContactarRateCurrent * 15;

  return clamp(Math.round(score), 0, 30);
}

function calculateHistoricalFunnelScore(rec = {}) {
  let score = 0;

  // 🔹 Lo MÁS importante: llegar a reunión
  score += rec.meetingRateHistorical * 20;

  // 🔹 Segundo: cerrar después de reunión
  score += rec.winAfterMeetingRate * 25;

  // 🔹 Volumen real trabajado
  score += Math.min(10, rec.historicalMeetingCount * 0.7);

  // 🔹 Ganadas post reunión
  score += Math.min(8, rec.historicalWonAfterMeetingCount * 1);

  return clamp(Math.round(score), 0, 35);
}

function calculateWorkloadScore(rec = {}, avgActive = 0) {
  let score = 12;

  if (rec.aContactarCount === 0) score += 8;
  else if (rec.aContactarCount <= 2) score += 4;
  else if (rec.aContactarCount <= 4) score += 1;
  else score -= 6;

  const diffActive = rec.activeCount - avgActive;
  if (diffActive <= -2) score += 5;
  else if (diffActive < 0) score += 2;
  else if (diffActive >= 4) score -= 5;
  else if (diffActive > 1) score -= 2;

  return clamp(Math.round(score), 0, 25);
}

function computeGlobalKpis(rows = []) {
  const stages = {
    total: rows.length,
    activos: 0,
    aContactar: 0,
    contactado: 0,
    cotizando: 0,
    reunion: 0,
    ganada: 0,
    perdida: 0,
    sinAsignar: 0
  };

  rows.forEach((row) => {
    const stage = normalizeStage(row.estado || "");

    if (isSinAsignar(row)) stages.sinAsignar += 1;
    if (stage !== "ganada" && stage !== "perdida") stages.activos += 1;
    if (stage === "a_contactar") stages.aContactar += 1;
    if (stage === "contactado") stages.contactado += 1;
    if (stage === "cotizando") stages.cotizando += 1;
    if (stage === "reunion_confirmada") stages.reunion += 1;
    if (stage === "ganada") stages.ganada += 1;
    if (stage === "perdida") stages.perdida += 1;
  });

  return {
    ...stages,
    reunionRate: safeRate(stages.reunion, stages.total),
    winAfterMeetingApprox: safeRate(stages.ganada, stages.reunion)
  };
}

function buildVendorKpis(rows = [], historyRows = []) {
  const vendorOptions = getVendorOptions();
  const historyMap = buildHistoryMap(historyRows);

  const vendorMap = new Map(
    vendorOptions.map((v) => [v.email, createVendorKpiBase(v.email, v.nombre)])
  );

  rows.forEach((row) => {
    const vendorEmail = getRowVendorEmail(row);
    const vendorName = getRowVendorName(row);
    if (!vendorEmail || !vendorMap.has(vendorEmail) || isSinAsignar(row)) return;

    const rec = vendorMap.get(vendorEmail);
    const stage = normalizeStage(row.estado || "");
    const isCurrent = isCurrentOrFutureTravelYear(row);

    rec.totalAssigned += 1;

    if (stage !== "ganada" && stage !== "perdida") rec.activeCount += 1;
    if (stage === "a_contactar") rec.aContactarCount += 1;
    if (stage === "contactado") rec.contactadoCount += 1;
    if (stage === "cotizando") rec.cotizandoCount += 1;
    if (stage === "reunion_confirmada") rec.reunionCount += 1;
    if (stage === "ganada") rec.ganadaCount += 1;
    if (stage === "perdida") rec.perdidaCount += 1;

    if (isCurrent) {
      rec.currentPortfolioCount += 1;
      if (stage === "a_contactar") rec.currentAContactarCount += 1;
      if (stage === "cotizando") rec.currentCotizandoCount += 1;
      if (stage === "reunion_confirmada") rec.currentReunionCount += 1;
      if (stage === "ganada") rec.currentGanadaCount += 1;
    }

    const groupHistory = historyMap.get(String(getRowId(row))) || [];
    if (groupHistory.length > 0) {
      const events = detectHistoryEvents(groupHistory);

      rec.historicalGroupsAnalyzed += 1;
      if (events.hasMeeting) rec.historicalMeetingCount += 1;
      if (events.hasWon) rec.historicalWonCount += 1;
      if (events.wonAfterMeeting) rec.historicalWonAfterMeetingCount += 1;
    }

    if (!rec.vendorName && vendorName) {
      rec.vendorName = vendorName;
    }
  });

  const list = Array.from(vendorMap.values()).filter((item) => item.vendorEmail);

  const avgActive = list.length
    ? list.reduce((sum, item) => sum + item.activeCount, 0) / list.length
    : 0;

  list.forEach((rec) => {
    // Base real del flujo ACTUAL (solo grupos en proceso del año actual)
    // = cartera actual - ganadas (las pérdidas ya no están en juego)
    const baseFlujoActual =
      rec.currentPortfolioCount - rec.currentGanadaCount;
    
    // Evitar negativos o división por 0
    const base = Math.max(1, baseFlujoActual);
    
    // % que avanzan a reunión
    rec.reunionRateCurrent = safeRate(rec.currentReunionCount, base);
    
    // % que terminan ganados (respecto a cartera total)
    rec.ganadaRateCurrent = safeRate(rec.currentGanadaCount, rec.currentPortfolioCount);
    
    // backlog
    rec.aContactarRateCurrent = safeRate(rec.currentAContactarCount, base);

    rec.meetingRateHistorical = safeRate(rec.historicalMeetingCount, rec.historicalGroupsAnalyzed);
    rec.winAfterMeetingRate = safeRate(rec.historicalWonAfterMeetingCount, rec.historicalMeetingCount);

    rec.continuityScore = calculateContinuityScorePlaceholder(rec);
    rec.performanceScore = calculatePerformanceScore(rec);
    rec.historicalFunnelScore = calculateHistoricalFunnelScore(rec);
    rec.workloadScore = calculateWorkloadScore(rec, avgActive);

    rec.historyCoverageFactor = getCoverageFactor(rec);
    rec.totalScore = calculateWeightedTotal(rec, state.scoring.weights);
  });

  return list.sort((a, b) => {
    return (
      b.totalScore - a.totalScore ||
      b.historicalFunnelScore - a.historicalFunnelScore ||
      b.performanceScore - a.performanceScore ||
      a.vendorName.localeCompare(b.vendorName, "es", { sensitivity: "base" })
    );
  });
}

function buildAlerts(rows = [], vendorKpis = []) {
  const alerts = [];

  vendorKpis
    .filter((item) => item.aContactarCount >= 5)
    .slice(0, 5)
    .forEach((item) => {
      alerts.push({
        title: `${item.vendorName} tiene backlog alto`,
        body: `${item.aContactarCount} grupo(s) en "A contactar". Conviene revisar disciplina comercial y priorización.`
      });
    });

  const stagnantCotizando = rows
    .filter((row) => normalizeStage(row.estado || "") === "cotizando")
    .slice(0, 5);

  stagnantCotizando.forEach((row) => {
    alerts.push({
      title: `${row.aliasGrupo || row.colegio || row.idGrupo} sigue cotizando`,
      body: `Grupo ${row.idGrupo || "—"} · ${row.colegio || "—"} · ${row.vendedora || "Sin asignar"}`
    });
  });

  return alerts.slice(0, 8);
}

function buildOpportunities(rows = [], vendorKpis = []) {
  const opportunities = [];

  vendorKpis
    .filter((item) => item.winAfterMeetingRate >= 0.4 && item.historicalMeetingCount >= 2)
    .slice(0, 5)
    .forEach((item) => {
      opportunities.push({
        title: `${item.vendorName} destaca en cierre post-reunión`,
        body: `${Math.round(item.winAfterMeetingRate * 100)}% de cierre después de reunión sobre ${item.historicalMeetingCount} grupo(s) con reunión detectada.`
      });
    });

  const noAssigned = rows.filter((row) => isSinAsignar(row)).slice(0, 5);
  noAssigned.forEach((row) => {
    opportunities.push({
      title: `Grupo sin asignar: ${row.aliasGrupo || row.colegio || row.idGrupo}`,
      body: `${row.colegio || "—"} · ${row.comunaCiudad || row.comuna || "—"} · Año ${row.anoViaje || "—"}`
    });
  });

  return opportunities.slice(0, 8);
}

/* =========================================================
   RENDER
========================================================= */
function renderCards(globalKpis, vendorKpis) {
  const el = $("kpiCards");
  if (!el) return;

  const bestCloser = vendorKpis[0];
  const bestMeeting = [...vendorKpis].sort((a, b) => b.historicalMeetingCount - a.historicalMeetingCount)[0];

  renderScoringExplanation();
  el.innerHTML = `
    <div class="seguimiento-summary-card">
      <div class="label">Total</div>
      <div class="value">${globalKpis.total}</div>
      <div class="meta">Grupos filtrados</div>
    </div>

    <div class="seguimiento-summary-card">
      <div class="label">Activos</div>
      <div class="value">${globalKpis.activos}</div>
      <div class="meta">Sin ganada / perdida</div>
    </div>

    <div class="seguimiento-summary-card">
      <div class="label">A contactar</div>
      <div class="value">${globalKpis.aContactar}</div>
      <div class="meta">Pendientes por gestionar</div>
    </div>

    <div class="seguimiento-summary-card">
      <div class="label">Reunión</div>
      <div class="value">${globalKpis.reunion}</div>
      <div class="meta">${Math.round(globalKpis.reunionRate * 100)}% del total</div>
    </div>

    <div class="seguimiento-summary-card">
      <div class="label">Ganadas</div>
      <div class="value">${globalKpis.ganada}</div>
      <div class="meta">${Math.round(globalKpis.winAfterMeetingApprox * 100)}% vs reuniones actuales</div>
    </div>

    <div class="seguimiento-summary-card">
      <div class="label">Sin asignar</div>
      <div class="value">${globalKpis.sinAsignar}</div>
      <div class="meta">Oportunidades por distribuir</div>
    </div>

    <div class="seguimiento-summary-card">
      <div class="label">Mejor score</div>
      <div class="value">${bestCloser ? bestCloser.totalScore : 0}</div>
      <div class="meta">${bestCloser ? bestCloser.vendorName : "Sin datos"}</div>
    </div>

    <div class="seguimiento-summary-card">
      <div class="label">Más reuniones</div>
      <div class="value">${bestMeeting ? bestMeeting.historicalMeetingCount : 0}</div>
      <div class="meta">${bestMeeting ? bestMeeting.vendorName : "Sin datos"}</div>
    </div>
  `;
}

function renderVendorTable(vendorKpis = []) {
  const tbody = $("tbodyVendors");
  const summary = $("vendorTableSummary");
  if (!tbody || !summary) return;

  summary.textContent = `${vendorKpis.length} vendedora(s) analizadas`;

  if (!vendorKpis.length) {
    tbody.innerHTML = `<tr><td colspan="18" class="empty">No hay datos para mostrar.</td></tr>`;
    return;
  }

  tbody.innerHTML = vendorKpis.map((item) => `
    <tr>
      <td>
        <div class="vendor-cell">
          <strong>${item.vendorName || item.vendorEmail}</strong>
          <small>${item.vendorEmail || "—"}</small>
        </div>
      </td>
      <td>${item.activeCount}</td>
      <td>${item.aContactarCount}</td>
      <td>${item.cotizandoCount}</td>
      <td>${item.currentReunionCount}</td>
      <td>${item.currentGanadaCount}</td>
      <td>
        ${Math.round(item.reunionRateCurrent * 100)}%
        <small style="display:block;color:#6d6480;">
          ${item.currentReunionCount} / flujo
        </small>
      </td>
      <td>${Math.round(item.ganadaRateCurrent * 100)}%</td>
      <td>${item.historicalGroupsAnalyzed}</td>
      <td>${item.historicalMeetingCount}</td>
      <td>${item.historicalWonAfterMeetingCount}</td>
      <td>${Math.round(item.meetingRateHistorical * 100)}%</td>
      <td>${Math.round(item.winAfterMeetingRate * 100)}%</td>
      <td>${item.continuityScore}</td>
      <td>${item.performanceScore}</td>
      <td>${item.historicalFunnelScore}</td>
      <td>${item.workloadScore}</td>
      <td>
        <div class="vendor-cell">
          <span class="score-badge">${item.totalScore}</span>
          <small>Cobertura hist.: ${Math.round((item.historyCoverageFactor || 0) * 100)}%</small>
        </div>
      </td>
    </tr>
  `).join("");
}

function renderAlerts(alerts = [], opportunities = []) {
  const alertList = $("alertList");
  const opportunityList = $("opportunityList");

  if (alertList) {
    alertList.innerHTML = alerts.length
      ? alerts.map((item) => `
          <li class="alert-item">
            <strong>${item.title}</strong><br />
            ${item.body}
          </li>
        `).join("")
      : `<li class="alert-item">Sin alertas destacadas.</li>`;
  }

  if (opportunityList) {
    opportunityList.innerHTML = opportunities.length
      ? opportunities.map((item) => `
          <li class="alert-item">
            <strong>${item.title}</strong><br />
            ${item.body}
          </li>
        `).join("")
      : `<li class="alert-item">Sin oportunidades destacadas.</li>`;
  }
}

function renderChart(chartKey, canvasId, config) {
  const ctx = $(canvasId);
  if (!ctx || typeof Chart === "undefined") return;

  destroyChart(state.charts[chartKey]);
  state.charts[chartKey] = new Chart(ctx, config);
}

function renderCharts(globalKpis, vendorKpis) {
  renderChart("funnel", "chartFunnel", {
    type: "bar",
    data: {
      labels: ["A contactar", "Contactado", "Cotizando", "Reunión", "Ganada"],
      datasets: [{
        label: "Grupos",
        data: [
          globalKpis.aContactar,
          globalKpis.contactado,
          globalKpis.cotizando,
          globalKpis.reunion,
          globalKpis.ganada
        ]
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false
    }
  });

  renderChart("winsByVendor", "chartWinsByVendor", {
    type: "bar",
    data: {
      labels: vendorKpis.map((v) => v.vendorName),
      datasets: [{
        label: "Ganadas actuales",
        data: vendorKpis.map((v) => v.currentGanadaCount)
      }]
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false
    }
  });

  renderChart("meetingsByVendor", "chartMeetingsByVendor", {
    type: "bar",
    data: {
      labels: vendorKpis.map((v) => v.vendorName),
      datasets: [{
        label: "Reuniones históricas",
        data: vendorKpis.map((v) => v.historicalMeetingCount)
      }]
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false
    }
  });

  renderChart("backlogByVendor", "chartBacklogByVendor", {
    type: "bar",
    data: {
      labels: vendorKpis.map((v) => v.vendorName),
      datasets: [{
        label: "A contactar",
        data: vendorKpis.map((v) => v.aContactarCount)
      }]
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false
    }
  });
}

/* =========================================================
   EXPORT
========================================================= */
function exportXlsx(globalKpis, vendorKpis, rows, alerts, opportunities) {
  if (typeof XLSX === "undefined") {
    alert("No se encontró la librería XLSX.");
    return;
  }

  const wb = XLSX.utils.book_new();

  const resumenData = [
    { KPI: "Total grupos", Valor: globalKpis.total },
    { KPI: "Activos", Valor: globalKpis.activos },
    { KPI: "A contactar", Valor: globalKpis.aContactar },
    { KPI: "Contactado", Valor: globalKpis.contactado },
    { KPI: "Cotizando", Valor: globalKpis.cotizando },
    { KPI: "Reunión confirmada", Valor: globalKpis.reunion },
    { KPI: "Ganada", Valor: globalKpis.ganada },
    { KPI: "Perdida", Valor: globalKpis.perdida },
    { KPI: "Sin asignar", Valor: globalKpis.sinAsignar }
  ];

  const vendedoresData = vendorKpis.map((v) => ({
    vendedor: v.vendorName,
    activos: v.activeCount,
    aContactar: v.aContactarCount,
    cotizando: v.cotizandoCount,
    reunionActual: v.currentReunionCount,
    ganadaActual: v.currentGanadaCount,
    reunionRateActual: Math.round(v.reunionRateCurrent * 100),
    ganadaRateActual: Math.round(v.ganadaRateCurrent * 100),
    historialAnalizado: v.historicalGroupsAnalyzed,
    llegaronReunion: v.historicalMeetingCount,
    ganadasPostReunion: v.historicalWonAfterMeetingCount,
    reunionRateHistorico: Math.round(v.meetingRateHistorical * 100),
    cierreTrasReunion: Math.round(v.winAfterMeetingRate * 100),
    continuityScore: v.continuityScore,
    performanceScore: v.performanceScore,
    historicalFunnelScore: v.historicalFunnelScore,
    workloadScore: v.workloadScore,
    totalScore: v.totalScore
  }));

  const gruposData = rows.map((r) => ({
    idGrupo: r.idGrupo || r.id || "",
    aliasGrupo: r.aliasGrupo || "",
    colegio: r.colegio || "",
    comuna: r.comunaCiudad || r.comuna || "",
    anoViaje: r.anoViaje || "",
    cliente: r.nombreCliente || "",
    estado: r.estado || "",
    vendedora: r.vendedora || "",
    vendedoraCorreo: r.vendedoraCorreo || ""
  }));

  const alertsData = alerts.map((a) => ({ titulo: a.title, detalle: a.body }));
  const opportunitiesData = opportunities.map((a) => ({ titulo: a.title, detalle: a.body }));

  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resumenData), "Resumen");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(vendedoresData), "Vendedores");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(gruposData), "Grupos");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(alertsData), "Alertas");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(opportunitiesData), "Oportunidades");

  XLSX.writeFile(wb, `informe_comercial_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

function exportPdf() {
  window.print();
}

/* =========================================================
   CARGA
========================================================= */
async function loadData() {
  try {
    setProgressStatus({
      text: "Cargando informe...",
      meta: "Leyendo cotizaciones...",
      progress: 12
    });

    if ($("informeLoadHint")) {
      $("informeLoadHint").textContent = "Leyendo cotizaciones...";
    }

    const quoteSnap = await getDocs(collection(db, "ventas_cotizaciones"));
    state.quoteRows = quoteSnap.docs.map((docSnap) => ({
      id: docSnap.id,
      ...(docSnap.data() || {})
    }));

    setProgressStatus({
      text: "Cargando informe...",
      meta: `Cotizaciones recibidas: ${state.quoteRows.length}`,
      progress: 42
    });

    if ($("informeLoadHint")) {
      $("informeLoadHint").textContent = `Cotizaciones recibidas: ${state.quoteRows.length}`;
    }

    const historySnap = await getDocs(collection(db, "ventas_historial"));
    state.historyRows = historySnap.docs.map((docSnap) => ({
      id: docSnap.id,
      ...(docSnap.data() || {})
    }));

    setProgressStatus({
      text: "Cargando informe...",
      meta: `Historial recibido: ${state.historyRows.length} movimiento(s)`,
      progress: 72
    });

    if ($("informeLoadHint")) {
      $("informeLoadHint").textContent = `Historial recibido: ${state.historyRows.length} movimiento(s)`;
    }

    populateFilters();
    applyFilters();

    setProgressStatus({
      text: "Informe cargado.",
      meta: `${state.filteredRows.length} grupo(s) filtrados.`,
      progress: 100,
      type: "success"
    });

    if ($("informeLoadHint")) {
      $("informeLoadHint").textContent = `${state.filteredRows.length} grupo(s) listos en el informe.`;
    }

    clearProgressStatus();
  } catch (error) {
    console.error(error);
    setProgressStatus({
      text: "Error cargando informe.",
      meta: error.message || "No se pudo leer Firestore.",
      progress: 100,
      type: "error"
    });

    if ($("informeLoadHint")) {
      $("informeLoadHint").textContent = "Error al cargar el informe.";
    }
  }
}

/* =========================================================
   FILTROS
========================================================= */
function populateFilters() {
  fillSelect(
    "filterAnoViaje",
    [...new Set(state.quoteRows.map((r) => normalizeText(r.anoViaje)).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "es", { numeric: true })),
    "Todos"
  );

  fillSelect(
    "filterVendedora",
    getVendorOptions().map((v) => v.nombre),
    "Todas"
  );

  fillSelect(
    "filterComuna",
    [...new Set(state.quoteRows.map((r) => normalizeText(r.comunaCiudad || r.comuna)).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" })),
    "Todas"
  );

  fillSelect(
    "filterEstado",
    [...new Set(state.quoteRows.map((r) => normalizeText(r.estado)).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" })),
    "Todos"
  );
}

function applyFilters() {
  let rows = [...state.quoteRows];

  if (!state.filters.includePastYears) {
    rows = rows.filter((row) => isCurrentOrFutureTravelYear(row));
  }

  if (state.filters.anoViaje) {
    rows = rows.filter((row) => normalizeText(row.anoViaje) === state.filters.anoViaje);
  }

  if (state.filters.vendedora) {
    rows = rows.filter((row) => normalizeText(row.vendedora) === state.filters.vendedora);
  }

  if (state.filters.comuna) {
    rows = rows.filter((row) => normalizeText(row.comunaCiudad || row.comuna) === state.filters.comuna);
  }

  if (state.filters.estado) {
    rows = rows.filter((row) => normalizeText(row.estado) === state.filters.estado);
  }

  const q = normalizeSearch(state.filters.search || "");
  if (q) {
    rows = rows.filter((row) => getSearchTarget(row).includes(q));
  }

  state.filteredRows = rows;
  renderAll();
}

/* =========================================================
   RENDER ALL
========================================================= */
function renderAll() {
  readScoringInputs();
  
  const globalKpis = computeGlobalKpis(state.filteredRows);
  const vendorKpis = buildVendorKpis(state.filteredRows, state.historyRows);
  const alerts = buildAlerts(state.filteredRows, vendorKpis);
  const opportunities = buildOpportunities(state.filteredRows, vendorKpis);

  renderCards(globalKpis, vendorKpis);
  renderVendorTable(vendorKpis);
  renderAlerts(alerts, opportunities);
  renderCharts(globalKpis, vendorKpis);

  state.lastRender = {
    globalKpis,
    vendorKpis,
    alerts,
    opportunities
  };
}

/* =========================================================
   EVENTOS
========================================================= */
function bindPageEvents() {
  $("filterAnoViaje")?.addEventListener("change", (e) => {
    state.filters.anoViaje = normalizeText(e.target.value || "");
    applyFilters();
  });

  $("filterVendedora")?.addEventListener("change", (e) => {
    state.filters.vendedora = normalizeText(e.target.value || "");
    applyFilters();
  });

  $("filterComuna")?.addEventListener("change", (e) => {
    state.filters.comuna = normalizeText(e.target.value || "");
    applyFilters();
  });

  $("filterEstado")?.addEventListener("change", (e) => {
    state.filters.estado = normalizeText(e.target.value || "");
    applyFilters();
  });

  $("filterSearch")?.addEventListener("input", (e) => {
    state.filters.search = e.target.value || "";
    applyFilters();
  });

  $("filterPastYears")?.addEventListener("change", (e) => {
    state.filters.includePastYears = String(e.target.value || "0") === "1";
    applyFilters();
  });

  $("btnActualizar")?.addEventListener("click", async () => {
    await loadData();
  });

  $("btnExportXlsx")?.addEventListener("click", () => {
    const payload = state.lastRender || {};
    exportXlsx(
      payload.globalKpis || computeGlobalKpis(state.filteredRows),
      payload.vendorKpis || buildVendorKpis(state.filteredRows, state.historyRows),
      state.filteredRows,
      payload.alerts || [],
      payload.opportunities || []
    );
  });

  $("btnExportPdf")?.addEventListener("click", () => {
    exportPdf();
  });

    $("analysisMode")?.addEventListener("change", () => {
    readScoringInputs();
    renderAll();
  });

  $("weightContinuity")?.addEventListener("input", () => {
    if (($("analysisMode")?.value || "") !== "personalizado") return;
    readScoringInputs();
    renderAll();
  });

  $("weightPerformance")?.addEventListener("input", () => {
    if (($("analysisMode")?.value || "") !== "personalizado") return;
    readScoringInputs();
    renderAll();
  });

  $("weightHistorical")?.addEventListener("input", () => {
    if (($("analysisMode")?.value || "") !== "personalizado") return;
    readScoringInputs();
    renderAll();
  });

  $("btnExplainScoring")?.addEventListener("click", () => {
    renderScoringExplanation();
    alert(
      "Continuidad: instalación/comercialidad general.\n" +
      "Desempeño: cómo mueve hoy su cartera vigente.\n" +
      "Embudo histórico: cuántos grupos llegaron a reunión y luego a ganada.\n" +
      "Disponibilidad: carga actual y backlog.\n\n" +
      "El total score usa la ponderación seleccionada y ajusta el peso histórico si la cobertura es baja."
    );
  });
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
   BOOTSTRAP
========================================================= */
async function bootstrapFromSession() {
  state.realUser = getRealUser();
  state.effectiveUser = getEffectiveUser();

  setHeaderAndScope();
  if (!assertAccess()) return false;

  bindHeaderActions();
  return true;
}

async function initPage() {
  await waitForLayoutReady();

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      location.href = "login.html";
      return;
    }

    await bootstrapFromSession();
    if (!assertAccess()) return;

    bindPageEvents();
    await loadData();
  });
}

initPage();
