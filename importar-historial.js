import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.7.3/firebase-auth.js";
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  setDoc,
  writeBatch,
  Timestamp
} from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";

import {
  auth,
  db,
  VENTAS_USERS,
  normalizeEmail,
  puedeVerGeneral
} from "./firebase-init.js";

import {
  ACTING_USER_KEY,
  getRealUser,
  getEffectiveUser
} from "./roles.js";

import {
  setHeaderState,
  renderActingUserSwitcher,
  bindLayoutButtons,
  waitForLayoutReady
} from "./ui.js";

const $ = (id) => document.getElementById(id);

const GITHUB_HOME_URL = "https://sistemas-raitrai.github.io/Ventas-RT/";
const COTIZACIONES_COLLECTION = "ventas_cotizaciones";
const HISTORIAL_COLLECTION = "ventas_historial";
const FALLIDAS_COLLECTION = "ventas_historial_fallidas";

// Firestore permite máximo 500 operaciones por batch.
// Dejamos 350 para ir seguros.
const BATCH_LIMIT = 350;
// Para consultas "in", usamos chunks chicos y seguros.
const QUERY_IN_LIMIT = 30;

const state = {
  realUser: null,
  effectiveUser: null,
  effectiveEmail: "",
  canSeeAll: false,

  rawCsvText: "",
  delimiter: ",",
  parsedRows: [],
  normalizedRows: [],
  previewRows: [],
  groupsByCodigo: new Map(),

  analysis: {
    totalRows: 0,
    validRows: 0,
    matchedRows: 0,
    unmatchedRows: 0,
    importedRows: 0,
    failedSavedRows: 0
  },

  isImporting: false
};

initPage();

async function initPage() {
  await waitForLayoutReady();
  bindEvents();

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      location.href = "login.html";
      return;
    }

    await bootstrapFromSession();
    setHeaderAndScope();

    if (!isAdminRealOrEffective()) {
      showDanger("Solo administración puede usar esta herramienta.");
      disableAllActions();
      appendLog("Acceso bloqueado: usuario sin permisos de administrador.");
    } else {
      appendLog("Herramienta lista. Sube un CSV para analizar.");
    }
  });
}

/* =========================================================
   SESSION / HEADER
========================================================= */
async function bootstrapFromSession() {
  state.realUser = getRealUser();
  state.effectiveUser = getEffectiveUser();
  state.effectiveEmail = normalizeEmail(
    state.effectiveUser?.email || state.realUser?.email || auth.currentUser?.email || ""
  );
  state.canSeeAll = puedeVerGeneral(state.effectiveEmail);
}

function setHeaderAndScope() {
  setHeaderState({
    realUser: state.realUser,
    effectiveUser: state.effectiveUser,
    scopeText: "Importación masiva · Historial legacy"
  });

  renderActingUserSwitcher({
    realUser: state.realUser,
    effectiveUser: state.effectiveUser,
    users: VENTAS_USERS
  });

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

      if (!isAdminRealOrEffective()) {
        showDanger("Solo administración puede usar esta herramienta.");
        disableAllActions();
      } else {
        enableBasicActions();
      }
    },
    onResetActAs: async () => {
      sessionStorage.removeItem(ACTING_USER_KEY);
      await bootstrapFromSession();
      setHeaderAndScope();

      if (!isAdminRealOrEffective()) {
        showDanger("Solo administración puede usar esta herramienta.");
        disableAllActions();
      } else {
        enableBasicActions();
      }
    }
  });
}

function isAdminRealOrEffective() {
  return String(state.effectiveUser?.rol || "").toLowerCase() === "admin";
}

/* =========================================================
   EVENTS
========================================================= */
function bindEvents() {
  $("btnAnalizar")?.addEventListener("click", handleAnalyzeClick);
  $("btnImportar")?.addEventListener("click", handleImportClick);
  $("btnLimpiar")?.addEventListener("click", resetAll);
}

async function handleAnalyzeClick() {
  try {
    clearMessages();
    resetAnalysisOnly();

    if (!isAdminRealOrEffective()) {
      showDanger("Solo administración puede usar esta herramienta.");
      return;
    }

    const file = $("fileCsv")?.files?.[0];
    if (!file) {
      showDanger("Debes seleccionar un archivo CSV.");
      return;
    }

    appendLog(`Leyendo archivo: ${file.name}`);
    updateProgress(2, "Leyendo CSV...");

    const rawText = await readFileAsText(file);
    state.rawCsvText = rawText;

    const delimiter = detectDelimiter(rawText);
    state.delimiter = delimiter;

    appendLog(`Separador detectado: "${delimiter}"`);
    updateProgress(8, "Parseando CSV...");

    const parsed = parseCsv(rawText, delimiter);
    if (!parsed.length) {
      showDanger("El archivo no contiene filas legibles.");
      return;
    }

    const normalized = normalizeLegacyRows(parsed);

    if (!normalized.length) {
      showDanger("No se encontraron filas útiles después de normalizar el archivo.");
      return;
    }

    state.parsedRows = parsed;
    state.normalizedRows = normalized;

    state.analysis.totalRows = normalized.length;
    state.analysis.validRows = normalized.filter((r) => r.isValid).length;

    appendLog(`Filas normalizadas: ${state.analysis.totalRows}`);
    appendLog(`Filas válidas: ${state.analysis.validRows}`);

    updateProgress(18, "Buscando grupos por código...");

    await buildGroupsMapFromRows(normalized);

    normalized.forEach((row) => {
      const group = state.groupsByCodigo.get(row.codigoRegistro);
      row.matchFound = !!group;
      row.group = group || null;
    });

    state.analysis.matchedRows = normalized.filter((r) => r.isValid && r.matchFound).length;
    state.analysis.unmatchedRows = normalized.filter((r) => r.isValid && !r.matchFound).length;

    renderStats();
    renderPreview();

    updateProgress(100, "Análisis completo");

    if (state.analysis.validRows === 0) {
      showDanger("No hay filas válidas para importar.");
      $("btnImportar").disabled = true;
      return;
    }

    $("btnImportar").disabled = false;

    showSuccess(
      `Análisis listo. Coincidencias: ${state.analysis.matchedRows}. ` +
      `Sin coincidencia: ${state.analysis.unmatchedRows}.`
    );

    appendLog("Análisis terminado correctamente.");
  } catch (error) {
    console.error("[importar-historial] analyze", error);
    showDanger(error.message || "Ocurrió un error al analizar el archivo.");
    appendLog(`ERROR análisis: ${error.message || error}`);
    updateProgress(0, "Error en análisis");
  }
}

async function handleImportClick() {
  try {
    clearMessages();

    if (state.isImporting) return;

    if (!isAdminRealOrEffective()) {
      showDanger("Solo administración puede usar esta herramienta.");
      return;
    }

    if (!state.normalizedRows.length) {
      showDanger("Primero debes analizar un archivo.");
      return;
    }

    const validRows = state.normalizedRows.filter((row) => row.isValid);
    if (!validRows.length) {
      showDanger("No hay filas válidas para importar.");
      return;
    }

    const ok = confirm(
      `Se importarán ${state.analysis.matchedRows} filas a ${HISTORIAL_COLLECTION} ` +
      `y ${state.analysis.unmatchedRows} filas sin coincidencia se guardarán en ${FALLIDAS_COLLECTION}. ¿Continuar?`
    );
    if (!ok) return;

    state.isImporting = true;
    $("btnAnalizar").disabled = true;
    $("btnImportar").disabled = true;
    $("btnLimpiar").disabled = true;

    appendLog("Inicio de importación...");
    updateProgress(0, "Preparando importación...");

    let processed = 0;
    let importedRows = 0;
    let failedSavedRows = 0;

    const docsToWrite = validRows.map((row) => {
      if (row.matchFound && row.group) {
        return {
          collectionName: HISTORIAL_COLLECTION,
          docId: buildLegacyHistoryDocId(row),
          data: buildHistorialDoc(row, row.group)
        };
      }

      return {
        collectionName: FALLIDAS_COLLECTION,
        docId: buildLegacyFailedDocId(row),
        data: buildFallidaDoc(row)
      };
    });

    const total = docsToWrite.length;
    const chunks = chunkArray(docsToWrite, BATCH_LIMIT);

    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
      const chunk = chunks[chunkIndex];
      const batch = writeBatch(db);

      for (const item of chunk) {
        const ref = doc(db, item.collectionName, item.docId);
        batch.set(ref, item.data, { merge: true });
      }

      await batch.commit();

      for (const item of chunk) {
        if (item.collectionName === HISTORIAL_COLLECTION) importedRows += 1;
        if (item.collectionName === FALLIDAS_COLLECTION) failedSavedRows += 1;
      }

      processed += chunk.length;

      const percent = Math.round((processed / total) * 100);
      updateProgress(percent, `Importando lote ${chunkIndex + 1} de ${chunks.length}...`);
      appendLog(
        `Lote ${chunkIndex + 1}/${chunks.length} OK · procesadas ${processed}/${total} · ` +
        `importadas ${importedRows} · falladas guardadas ${failedSavedRows}`
      );

      state.analysis.importedRows = importedRows;
      state.analysis.failedSavedRows = failedSavedRows;
      renderStats();

      // Respiro pequeño para no congelar UI
      await wait(60);
    }

    updateProgress(100, "Importación completada");
    appendLog("Importación finalizada correctamente.");

    showSuccess(
      `Importación terminada. ` +
      `Importadas: ${importedRows}. ` +
      `Guardadas en fallidas: ${failedSavedRows}.`
    );
  } catch (error) {
    console.error("[importar-historial] import", error);
    showDanger(error.message || "Ocurrió un error durante la importación.");
    appendLog(`ERROR importación: ${error.message || error}`);
    updateProgress(0, "Error en importación");
  } finally {
    state.isImporting = false;
    if (isAdminRealOrEffective()) {
      $("btnAnalizar").disabled = false;
      $("btnImportar").disabled = !state.normalizedRows.length;
      $("btnLimpiar").disabled = false;
    }
  }
}

/* =========================================================
   FILE / CSV
========================================================= */
function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      resolve(String(reader.result || ""));
    };

    reader.onerror = () => {
      reject(new Error("No se pudo leer el archivo."));
    };

    reader.readAsText(file, "utf-8");
  });
}

function detectDelimiter(text = "") {
  const sampleLines = String(text || "")
    .split(/\r?\n/)
    .filter((line) => cleanText(line))
    .slice(0, 8);

  let commas = 0;
  let semicolons = 0;

  for (const line of sampleLines) {
    commas += countCharOutsideQuotes(line, ",");
    semicolons += countCharOutsideQuotes(line, ";");
  }

  return semicolons > commas ? ";" : ",";
}

function countCharOutsideQuotes(line = "", char = ",") {
  let count = 0;
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const current = line[i];
    const next = line[i + 1];

    if (current === '"') {
      if (inQuotes && next === '"') {
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && current === char) count += 1;
  }

  return count;
}

/**
 * Parser CSV robusto:
 * - soporta comillas
 * - soporta delimitador variable
 * - soporta saltos de línea dentro de celdas
 */
function parseCsv(text = "", delimiter = ",") {
  const rows = [];
  let current = "";
  let row = [];
  let inQuotes = false;

  const input = String(text || "").replace(/^\uFEFF/, "");

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    const next = input[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === delimiter && !inQuotes) {
      row.push(current);
      current = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        i += 1;
      }

      row.push(current);
      current = "";

      if (row.some((cell) => cleanText(cell) !== "")) {
        rows.push(row);
      }

      row = [];
      continue;
    }

    current += char;
  }

  row.push(current);
  if (row.some((cell) => cleanText(cell) !== "")) {
    rows.push(row);
  }

  if (!rows.length) return [];

  const headers = rows[0].map(normalizeHeader);
  const dataRows = rows.slice(1);

  return dataRows.map((cells, index) => {
    const obj = { __rowNumber: index + 2 };

    headers.forEach((header, i) => {
      obj[header] = cells[i] ?? "";
    });

    return obj;
  });
}

function normalizeHeader(value = "") {
  return String(value || "")
    .replace(/\uFEFF/g, "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normalizeLegacyRows(rows = []) {
  return rows.map((row) => {
    const fecha =
      cleanText(row.fecha) ||
      cleanText(row.fecharegistro) ||
      cleanText(row["fecha registro"]) ||
      cleanText(row["fecha_registro"]);

    const nombreUsuario =
      cleanText(row.nombreusuario) ||
      cleanText(row.usuario) ||
      cleanText(row.nombre) ||
      "";

    const codigoRegistro =
      cleanText(row.codigoregistro) ||
      cleanText(row.codigo) ||
      "";

    const asunto =
      cleanText(row.asunto) ||
      cleanText(row.titulo) ||
      "";

    const mensajeRaw =
      cleanText(row.mensaje) ||
      cleanText(row.detalle) ||
      "";

    const mensajeLimpio = htmlToPlainText(mensajeRaw);

    const isValid = Boolean(fecha && codigoRegistro && (asunto || mensajeLimpio));

    return {
      sourceRowNumber: Number(row.__rowNumber || 0),
      fechaOriginal: fecha,
      nombreUsuarioOriginal: nombreUsuario,
      codigoRegistro,
      asuntoOriginal: asunto,
      mensajeOriginal: mensajeRaw,
      mensajeLimpio,
      isValid,
      invalidReason: isValid
        ? ""
        : buildInvalidReason({ fecha, codigoRegistro, asunto, mensajeLimpio }),
      matchFound: false,
      group: null
    };
  });
}

function buildInvalidReason({ fecha, codigoRegistro, asunto, mensajeLimpio }) {
  const missing = [];
  if (!fecha) missing.push("fecha");
  if (!codigoRegistro) missing.push("codigoRegistro");
  if (!asunto && !mensajeLimpio) missing.push("asunto/mensaje");
  return `Faltan datos: ${missing.join(", ")}`;
}

function htmlToPlainText(html = "") {
  const raw = String(html || "").trim();
  if (!raw) return "";

  const temp = document.createElement("div");
  temp.innerHTML = raw
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/li>/gi, "\n");

  const text = temp.textContent || temp.innerText || "";
  return text
    .replace(/\u00A0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/* =========================================================
   MATCH DE GRUPOS
========================================================= */
async function buildGroupsMapFromRows(rows = []) {
  state.groupsByCodigo = new Map();

  const uniqueCodes = [...new Set(
    rows
      .map((row) => cleanText(row.codigoRegistro))
      .filter(Boolean)
  )];

  appendLog(`Códigos únicos a consultar: ${uniqueCodes.length}`);

  const codeChunks = chunkArray(uniqueCodes, QUERY_IN_LIMIT);

  for (let i = 0; i < codeChunks.length; i += 1) {
    const chunk = codeChunks[i];

    const q = query(
      collection(db, COTIZACIONES_COLLECTION),
      where("codigoRegistro", "in", chunk)
    );

    const snap = await getDocs(q);

    snap.forEach((docSnap) => {
      const data = docSnap.data() || {};
      const codigo = cleanText(data.codigoRegistro || "");
      if (!codigo) return;

      state.groupsByCodigo.set(codigo, {
        docId: docSnap.id,
        idGrupo: cleanText(data.idGrupo || docSnap.id),
        codigoRegistro: codigo,
        aliasGrupo: cleanText(data.aliasGrupo || ""),
        colegio: cleanText(data.colegio || ""),
        data
      });
    });

    updateProgress(
      Math.min(18 + Math.round(((i + 1) / codeChunks.length) * 42), 60),
      `Buscando grupos... lote ${i + 1} de ${codeChunks.length}`
    );

    await wait(25);
  }

  appendLog(`Grupos encontrados por código: ${state.groupsByCodigo.size}`);
}

/* =========================================================
   BUILD DOCS
========================================================= */
function buildHistorialDoc(row, group) {
  const legacyHash = buildLegacyHash(row);
  const fechaDate = parseDateSafe(row.fechaOriginal);
  const fechaTimestamp = fechaDate ? Timestamp.fromDate(fechaDate) : Timestamp.now();

  return {
    idGrupo: cleanText(group.idGrupo || ""),
    codigoRegistro: cleanText(row.codigoRegistro),
    aliasGrupo: cleanText(group.aliasGrupo || ""),
    colegio: cleanText(group.colegio || ""),

    tipoMovimiento: "legacy_import",
    modulo: "legacy",
    titulo: "Historial importado",
    asunto: cleanText(row.asuntoOriginal) || "Historial importado",
    mensaje: cleanText(row.mensajeLimpio) || cleanText(row.asuntoOriginal) || "Sin detalle",

    metadata: {
      origen: "historial_antiguo_csv",
      legacy: true,
      legacyHash,
      importadoDesde: "importar-historial.html",
      filaOriginal: Number(row.sourceRowNumber || 0),
      fechaOriginal: cleanText(row.fechaOriginal),
      nombreUsuarioOriginal: cleanText(row.nombreUsuarioOriginal),
      asuntoOriginal: cleanText(row.asuntoOriginal),
      mensajeOriginal: cleanText(row.mensajeOriginal),
      mensajeLimpio: cleanText(row.mensajeLimpio),
      cambios: [],
      cambiosDetallados: [],
      totalCambios: 0,
      resumenCambios: ""
    },

    destacado: false,
    destacadoAt: null,
    destacadoPor: "",
    destacadoPorCorreo: "",

    oculto: false,
    ocultadoAt: null,
    ocultadoPor: "",
    ocultadoPorCorreo: "",

    creadoPor: cleanText(row.nombreUsuarioOriginal) || "Legacy",
    creadoPorCorreo: "",
    fecha: fechaTimestamp
  };
}

function buildFallidaDoc(row) {
  const legacyHash = buildLegacyHash(row);
  const fechaDate = parseDateSafe(row.fechaOriginal);
  const fechaTimestamp = fechaDate ? Timestamp.fromDate(fechaDate) : Timestamp.now();

  return {
    codigoRegistro: cleanText(row.codigoRegistro),
    asunto: cleanText(row.asuntoOriginal),
    mensaje: cleanText(row.mensajeLimpio) || cleanText(row.asuntoOriginal) || "Sin detalle",
    fecha: fechaTimestamp,

    motivo: row.isValid ? "codigoRegistro_no_encontrado" : "fila_invalida",
    estadoRevision: "pendiente",
    origen: "historial_antiguo_csv",
    legacyHash,

    metadata: {
      legacy: true,
      filaOriginal: Number(row.sourceRowNumber || 0),
      fechaOriginal: cleanText(row.fechaOriginal),
      nombreUsuarioOriginal: cleanText(row.nombreUsuarioOriginal),
      asuntoOriginal: cleanText(row.asuntoOriginal),
      mensajeOriginal: cleanText(row.mensajeOriginal),
      mensajeLimpio: cleanText(row.mensajeLimpio),
      isValid: !!row.isValid,
      invalidReason: cleanText(row.invalidReason)
    },

    creadoPor: cleanText(row.nombreUsuarioOriginal) || "Legacy",
    creadoPorCorreo: "",
    fechaImportacion: Timestamp.now(),
    importadoPor: getDisplayName(state.effectiveUser),
    importadoPorCorreo: state.effectiveEmail
  };
}

function buildLegacyHistoryDocId(row) {
  return `legacy_${buildLegacyHash(row)}`;
}

function buildLegacyFailedDocId(row) {
  return `legacy_fail_${buildLegacyHash(row)}`;
}

function buildLegacyHash(row) {
  const base = [
    cleanText(row.fechaOriginal),
    cleanText(row.nombreUsuarioOriginal),
    cleanText(row.codigoRegistro),
    cleanText(row.asuntoOriginal),
    cleanText(row.mensajeLimpio)
  ].join("||");

  return simpleHash(base);
}

function simpleHash(value = "") {
  let hash = 5381;
  const str = String(value || "");

  for (let i = 0; i < str.length; i += 1) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash |= 0;
  }

  return Math.abs(hash).toString(36);
}

/* =========================================================
   RENDER
========================================================= */
function renderStats() {
  setText("statRows", formatInt(state.analysis.totalRows));
  setText("statValid", formatInt(state.analysis.validRows));
  setText("statMatched", formatInt(state.analysis.matchedRows));
  setText("statUnmatched", formatInt(state.analysis.unmatchedRows));
  setText("statImported", formatInt(state.analysis.importedRows));
  setText("statFailedSaved", formatInt(state.analysis.failedSavedRows));
}

function renderPreview() {
  const body = $("previewBody");
  if (!body) return;

  const preview = state.normalizedRows.slice(0, 120);

  if (!preview.length) {
    body.innerHTML = `
      <tr>
        <td colspan="7" style="text-align:center; color:#7a738c;">Sin datos aún</td>
      </tr>
    `;
    return;
  }

  body.innerHTML = preview.map((row, idx) => {
    const status = row.isValid
      ? (row.matchFound ? badge("Coincide", "ok") : badge("Sin coincidencia", "warn"))
      : badge("Inválida", "info");

    return `
      <tr>
        <td>${escapeHtml(String(idx + 1))}</td>
        <td>${escapeHtml(cleanText(row.fechaOriginal) || "—")}</td>
        <td>${escapeHtml(cleanText(row.nombreUsuarioOriginal) || "—")}</td>
        <td>${escapeHtml(cleanText(row.codigoRegistro) || "—")}</td>
        <td>${escapeHtml(cleanText(row.asuntoOriginal) || "—")}</td>
        <td>${escapeHtml(truncate(cleanText(row.mensajeLimpio) || row.invalidReason || "—", 160))}</td>
        <td>${status}</td>
      </tr>
    `;
  }).join("");
}

function badge(label, variant = "info") {
  return `<span class="status-pill ${variant}">${escapeHtml(label)}</span>`;
}

/* =========================================================
   UI HELPERS
========================================================= */
function appendLog(message = "") {
  const log = $("importLog");
  if (!log) return;

  const now = new Date().toLocaleTimeString("es-CL", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });

  log.textContent += `\n[${now}] ${message}`;
  log.scrollTop = log.scrollHeight;
}

function clearLog() {
  const log = $("importLog");
  if (!log) return;
  log.textContent = "Esperando archivo...";
}

function updateProgress(percent = 0, text = "") {
  const safe = Math.max(0, Math.min(100, Number(percent) || 0));
  const bar = $("progressBar");
  const percentEl = $("progressPercent");
  const textEl = $("progressText");

  if (bar) bar.style.width = `${safe}%`;
  if (percentEl) percentEl.textContent = `${safe}%`;
  if (textEl) textEl.textContent = text || "Procesando...";
}

function showDanger(message = "") {
  const el = $("dangerBox");
  const ok = $("successBox");
  if (ok) {
    ok.classList.add("hidden");
    ok.textContent = "";
  }
  if (el) {
    el.textContent = message;
    el.classList.remove("hidden");
  }
}

function showSuccess(message = "") {
  const el = $("successBox");
  const danger = $("dangerBox");
  if (danger) {
    danger.classList.add("hidden");
    danger.textContent = "";
  }
  if (el) {
    el.textContent = message;
    el.classList.remove("hidden");
  }
}

function clearMessages() {
  $("dangerBox")?.classList.add("hidden");
  $("successBox")?.classList.add("hidden");

  if ($("dangerBox")) $("dangerBox").textContent = "";
  if ($("successBox")) $("successBox").textContent = "";
}

function disableAllActions() {
  if ($("btnAnalizar")) $("btnAnalizar").disabled = true;
  if ($("btnImportar")) $("btnImportar").disabled = true;
  if ($("btnLimpiar")) $("btnLimpiar").disabled = true;
  if ($("fileCsv")) $("fileCsv").disabled = true;
}

function enableBasicActions() {
  if ($("btnAnalizar")) $("btnAnalizar").disabled = false;
  if ($("btnLimpiar")) $("btnLimpiar").disabled = false;
  if ($("fileCsv")) $("fileCsv").disabled = false;
}

function resetAnalysisOnly() {
  state.parsedRows = [];
  state.normalizedRows = [];
  state.previewRows = [];
  state.groupsByCodigo = new Map();

  state.analysis = {
    totalRows: 0,
    validRows: 0,
    matchedRows: 0,
    unmatchedRows: 0,
    importedRows: 0,
    failedSavedRows: 0
  };

  renderStats();
  renderPreview();
  $("btnImportar").disabled = true;
  clearMessages();
}

function resetAll() {
  state.rawCsvText = "";
  resetAnalysisOnly();
  clearLog();
  updateProgress(0, "Sin proceso en curso");
  if ($("fileCsv")) $("fileCsv").value = "";
  appendLog("Estado reiniciado.");
}

function setText(id, value) {
  const el = $(id);
  if (!el) return;
  el.textContent = String(value ?? "");
}

/* =========================================================
   GENERIC HELPERS
========================================================= */
function parseDateSafe(value = "") {
  const raw = cleanText(value);
  if (!raw) return null;

  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function cleanText(value = "") {
  return String(value ?? "").trim();
}

function truncate(value = "", max = 120) {
  const text = String(value || "");
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
}

function chunkArray(list = [], size = 100) {
  const out = [];
  for (let i = 0; i < list.length; i += size) {
    out.push(list.slice(i, i + size));
  }
  return out;
}

function wait(ms = 50) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatInt(value) {
  return Number(value || 0).toLocaleString("es-CL");
}

function getDisplayName(user) {
  const full = [user?.nombre, user?.apellido].filter(Boolean).join(" ").trim();
  return full || user?.email || state.effectiveEmail || "Usuario";
}

function escapeHtml(value = "") {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
