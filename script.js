// script.js — Dashboard Ventas RT conectado a Firestore

import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.7.3/firebase-auth.js";
import {
  collection,
  getDocs,
  doc,
  updateDoc,
  getDoc,
  setDoc,
  deleteDoc,
  serverTimestamp,
  query,
  where
} from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";

import { auth, db, VENTAS_USERS } from "./firebase-init.js";

import {
  $,
  getNombreUsuario,
  normalizeEmail,
  escapeHtml
} from "./utils.js";

import {
  ACTING_USER_KEY,
  getRealUser,
  getEffectiveUser,
  isActingAsAnother,
  getVendorUsers,
  setVendorFilter,
  getVendorFilter,
  clearVendorFilter,
  setGroupFilter,
  getGroupFilter,
  clearGroupFilter,
  isVendedorRole,
  isRegistroRole
} from "./roles.js";

import {
  setFlowNumbers,
  updateClockDataset,
  setHeaderState,
  renderActingUserSwitcher,
  bindLayoutButtons,
  waitForLayoutReady
} from "./ui.js";

/* =========================================================
   CONFIG
========================================================= */
const GITHUB_HOME_URL = "https://sistemas-raitrai.github.io/Ventas-RT/";
const ALERTAS_COLLECTION = "ventas_alertas";
const SOLICITUDES_COLLECTION = "ventas_solicitudes_actualizacion";
const PRIVATE_NOTES_COLLECTION = "ventas_notas_privadas";
const PRIVATE_NOTE_PAGE = "index";
const ALERTAS_INSCRIPCIONES_COLLECTION = "ventas_alertas_inscripciones";

const GRUPOS_RESUMEN_COLLECTION =
  "ventas_grupos_resumen";

const DASHBOARD_RESUMEN_COLLECTION =
  "ventas_dashboard_resumen";

const INDEX_GRUPOS_CACHE_PREFIX =
  "ventas_index_grupos_";

const INDEX_ALERTAS_CACHE_PREFIX =
  "ventas_index_alertas_";

const INDEX_CACHE_TTL_MS =
  10 * 60 * 1000;

/* =========================================================
   MEDICIÓN DE RENDIMIENTO DEL INDEX
========================================================= */

const indexPerformance = {
  cargaId: "",
  inicio: 0
};

function iniciarMedicionIndex() {
  indexPerformance.cargaId =
    Date.now().toString(36);

  indexPerformance.inicio =
    performance.now();

  console.log(
    `[INDEX][${indexPerformance.cargaId}][INICIO]`,
    {
      fecha:
        new Date().toLocaleString("es-CL")
    }
  );
}

function logRendimientoIndex(
  etapa = "",
  datos = {}
) {
  if (!indexPerformance.inicio) {
    iniciarMedicionIndex();
  }

  console.log(
    `[INDEX][${indexPerformance.cargaId}][${etapa}]`,
    {
      ...datos,

      desdeInicioMs:
        Math.round(
          performance.now() -
          indexPerformance.inicio
        )
    }
  );
}

function getAnoPrioritarioIndex() {
  /*
    En Index el año cambia el 1 de enero.

    Durante 2026:
    prioridad 2026.

    Desde el 1 de enero de 2027:
    prioridad 2027.
  */
  return new Date().getFullYear();
}

function getAnosActivosIndex() {
  const anoActual =
    getAnoPrioritarioIndex();

  return [
    anoActual,
    anoActual + 1,
    anoActual + 2,
    anoActual + 3
  ];
}

const searchableInstances = {};

function destroySearchableSelect(id) {
  const el = $(id);
  if (!el) return;

  if (el.tomselect) {
    el.tomselect.destroy();
  }

  delete searchableInstances[id];
}

function initSearchableSelect(
  id,
  placeholder = "Escribe para buscar...",
  {
    onChange = null
  } = {}
) {
  const el = $(id);

  if (!el) {
    return null;
  }

  destroySearchableSelect(id);

  if (typeof window.TomSelect === "undefined") {
    return null;
  }

  el.setAttribute(
    "placeholder",
    placeholder
  );

  const instance =
    new window.TomSelect(
      el,
      {
        create: false,
        allowEmptyOption: true,
        maxOptions: 1000,

        searchField: [
          "text"
        ],

        sortField: [
          {
            field: "$score"
          },
          {
            field: "$order"
          }
        ],

        openOnFocus: true,
        closeAfterSelect: true,
        placeholder,

        onChange(value) {
          const selectedValue =
            String(value || "").trim();

          if (
            !selectedValue ||
            typeof onChange !== "function"
          ) {
            return;
          }

          onChange(
            selectedValue,
            instance
          );
        }
      }
    );

  if (el.disabled) {
    instance.disable();
  }

  searchableInstances[id] =
    instance;

  return instance;
}

/* =========================================================
   ESTADO LOCAL
========================================================= */
const state = {
  rows: [],
  rowsById: new Map(),

  alertRows: [],
  scopedRows: [],

  fichasPorFirmarRows: [],
  fichasCorregidasRows: [],
  fichasAbiertasRows: [],
  fichasCerradasRows: [],
  fichasAutorizadasRows: [],

  alertasCriticasRows: [],
  alertasWarningRows: [],

  solicitudesRows: [],
  solicitudesActualizacionRows: [],

  inscripcionesRows: [],
  inscripcionNuevoIngresoRows: [],
  inscripcionListaEsperaRows: [],
  listaEsperaPagadaRows: [],

  aContactarRows: [],

  /*
    Grupos livianos separados por año.
  */
  rowsPorAno: new Map(),
  anosCargados: new Set(),

  /*
    Resumen pequeño de alertas.
  */
  dashboardResumen: null,

  /*
    Las consultas de detalle se guardan aquí
    para no repetirlas.
  */
  promiseDatosAuxiliares: null,

  datosAuxiliaresCargados: false
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

function pad2(value = 0) {
  return String(Number(value) || 0).padStart(2, "0");
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

function getDashboardBaseYear(date = new Date()) {
  // Año comercial: cambia el 1 de marzo
  // Enero y febrero siguen perteneciendo al año anterior
  const year = date.getFullYear();
  const month = date.getMonth(); // 0=ene, 1=feb, 2=mar
  return month >= 2 ? year : year - 1;
}

function getAnoViajeNumber(row = {}) {
  const raw = String(row.anoViaje ?? "").trim();
  const match = raw.match(/\d{4}/);
  if (!match) return null;

  const year = Number(match[0]);
  return Number.isFinite(year) ? year : null;
}

function timestampLikeToDate(value) {
  if (!value) return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value?.toDate === "function") {
    const d = value.toDate();
    return Number.isNaN(d?.getTime?.()) ? null : d;
  }

  if (
    typeof value === "object" &&
    typeof value.seconds === "number"
  ) {
    const d = new Date(value.seconds * 1000);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  if (typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  if (typeof value === "string") {
    const iso = new Date(value);
    if (!Number.isNaN(iso.getTime())) return iso;

    // dd/mm/yyyy o dd-mm-yyyy
    const m = value.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?$/);
    if (m) {
      let year = Number(m[3]);
      if (year < 100) year += 2000;

      const d = new Date(
        year,
        Number(m[2]) - 1,
        Number(m[1]),
        Number(m[4] || 0),
        Number(m[5] || 0),
        0
      );

      return Number.isNaN(d.getTime()) ? null : d;
    }
  }

  return null;
}

function getMeetingDate(row = {}) {
  const candidateKeys = [
    "fechaReunion",
    "fechaReunionConfirmada",
    "fechaProximaReunion",
    "proximaReunion",
    "reunionFecha",
    "fechaConfirmacionReunion"
  ];

  for (const key of candidateKeys) {
    const d = timestampLikeToDate(row[key]);
    if (d) return d;
  }

  return null;
}

function getPrivateNoteDocId() {
  const uid = String(auth.currentUser?.uid || "").trim();
  if (!uid) return "";
  return `${uid}_${PRIVATE_NOTE_PAGE}`;
}

function getPrivateNoteRef() {
  const docId = getPrivateNoteDocId();
  if (!docId) return null;
  return doc(db, PRIVATE_NOTES_COLLECTION, docId);
}

function setPrivateNoteStatus(message = "", tone = "muted") {
  const el = $("private-note-status");
  if (!el) return;

  const colors = {
    muted: "#6a6078",
    loading: "#6a6078",
    ok: "#2f7a4b",
    error: "#b33a3a"
  };

  el.textContent = message;
  el.style.color = colors[tone] || colors.muted;
}

function setPrivateNoteBusy(isBusy = false) {
  const textarea = $("private-note-text");
  const btnSave = $("btn-private-note-save");
  const btnClear = $("btn-private-note-clear");

  if (textarea) textarea.disabled = isBusy;
  if (btnSave) btnSave.disabled = isBusy;
  if (btnClear) btnClear.disabled = isBusy;
}

async function loadPrivateNote() {
  const textarea = $("private-note-text");
  if (!textarea) return;

  const ref = getPrivateNoteRef();
  if (!ref) {
    textarea.value = "";
    setPrivateNoteStatus("No se pudo identificar tu cuenta.", "error");
    return;
  }

  setPrivateNoteBusy(true);
  setPrivateNoteStatus("Cargando nota privada...", "loading");

  try {
    const snap = await getDoc(ref);
    const data = snap.exists() ? (snap.data() || {}) : {};

    textarea.value = String(data.contenido || "");
    setPrivateNoteStatus("Nota privada. Solo la ves tú.", "muted");
  } catch (error) {
    console.error("Error cargando nota privada:", error);
    setPrivateNoteStatus("No se pudo cargar la nota.", "error");
  } finally {
    setPrivateNoteBusy(false);
  }
}

async function savePrivateNote() {
  const textarea = $("private-note-text");
  const ref = getPrivateNoteRef();

  if (!textarea || !ref) {
    setPrivateNoteStatus("No se pudo guardar la nota.", "error");
    return;
  }

  const contenido = String(textarea.value || "");

  setPrivateNoteBusy(true);
  setPrivateNoteStatus("Guardando...", "loading");

  try {
    await setDoc(
      ref,
      {
        uid: String(auth.currentUser?.uid || ""),
        pagina: PRIVATE_NOTE_PAGE,
        contenido,
        actualizadoEn: serverTimestamp(),
        actualizadoPorCorreo: normalizeEmail(
          auth.currentUser?.email || getRealUser()?.email || ""
        )
      },
      { merge: true }
    );

    setPrivateNoteStatus("Guardado.", "ok");
  } catch (error) {
    console.error("Error guardando nota privada:", error);
    setPrivateNoteStatus("No se pudo guardar la nota.", "error");
  } finally {
    setPrivateNoteBusy(false);
  }
}

async function clearPrivateNote() {
  const textarea = $("private-note-text");
  const ref = getPrivateNoteRef();

  if (!textarea || !ref) {
    setPrivateNoteStatus("No se pudo limpiar la nota.", "error");
    return;
  }

  const confirmed = window.confirm("¿Quieres borrar por completo tu nota privada?");
  if (!confirmed) return;

  setPrivateNoteBusy(true);
  setPrivateNoteStatus("Borrando...", "loading");

  try {
    await deleteDoc(ref);
    textarea.value = "";
    setPrivateNoteStatus("Nota eliminada.", "ok");
  } catch (error) {
    console.error("Error borrando nota privada:", error);
    setPrivateNoteStatus("No se pudo borrar la nota.", "error");
  } finally {
    setPrivateNoteBusy(false);
  }
}

function bindPrivateNotePanel() {
  const textarea = $("private-note-text");
  const btnSave = $("btn-private-note-save");
  const btnClear = $("btn-private-note-clear");

  if (btnSave && !btnSave.dataset.bound) {
    btnSave.dataset.bound = "1";
    btnSave.addEventListener("click", async () => {
      await savePrivateNote();
    });
  }

  if (btnClear && !btnClear.dataset.bound) {
    btnClear.dataset.bound = "1";
    btnClear.addEventListener("click", async () => {
      await clearPrivateNote();
    });
  }

  if (textarea && !textarea.dataset.boundShortcut) {
    textarea.dataset.boundShortcut = "1";

    textarea.addEventListener("keydown", async (e) => {
      const saveShortcut = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s";
      if (!saveShortcut) return;

      e.preventDefault();
      await savePrivateNote();
    });
  }
}

function abrirGrupoDesdeSelector(
  idGrupo = ""
) {
  const id =
    String(idGrupo || "").trim();

  if (!id) {
    return;
  }

  /*
    Se conserva el grupo seleccionado por coherencia
    con el resto del sistema.
  */
  setGroupFilter(id);

  location.href =
    `grupo.html?id=${encodeURIComponent(id)}`;
}

function getRowId(row = {}) {
  return String(row.idGrupo || row.id || "").trim();
}

function getNumeroNegocio(row = {}) {
  return String(
    row.numeroNegocio ||
    row?.ficha?.numeroNegocio ||
    ""
  ).trim();
}

function getIdNegocioLabel(row = {}) {
  const id = getRowId(row);
  const numero = getNumeroNegocio(row);

  return numero ? `ID: ${id} / N°: ${numero}` : `ID: ${id}`;
}

function getAdminImportantChanges(row = {}) {
  const directos = Array.isArray(row.camposAdministracionModificados)
    ? row.camposAdministracionModificados
    : [];

  const ficha = Array.isArray(row?.ficha?.camposAdministracionModificados)
    ? row.ficha.camposAdministracionModificados
    : [];

  const flow = Array.isArray(row?.flowFicha?.camposAdministracionModificados)
    ? row.flowFicha.camposAdministracionModificados
    : [];

  return [...directos, ...ficha, ...flow].filter(Boolean);
}

function renderAdminImportantChanges(row = {}, user = null) {
  const effectiveUser = user || getEffectiveUser();
  if (!isAdministracionDashboardUser(effectiveUser)) return "";

  const changes = getAdminImportantChanges(row);
  if (!changes.length) return "";

  return `
    <div style="margin-top:10px; padding:10px 12px; border-radius:14px; background:#fff1f1; border:1px solid #f0b4b4; color:#9f1d1d; font-size:13px; line-height:1.45;">
      <strong>⚠ Campos administrativos modificados:</strong><br>
      ${changes.map((c) => `
        ${escapeHtml(c.label || c.campo || "Campo")} fue modificado de
        <strong>${escapeHtml(String(c.anterior ?? ""))}</strong>
        a
        <strong>${escapeHtml(String(c.nuevo ?? ""))}</strong>
      `).join("<br>")}
    </div>
  `;
}

function getRowAlias(row = {}) {
  return String(
    row.aliasGrupo ||
    row.nombreGrupo ||
    row.colegio ||
    row.idGrupo ||
    row.id ||
    "Sin alias"
  ).trim();
}

function getRowApoderado(row = {}) {
  return String(row.nombreCliente || "Sin apoderado").trim();
}

function getRowVendorEmail(row = {}) {
  return normalizeEmail(
    row.vendedoraCorreo ||
    row.creadoPorCorreo ||
    ""
  );
}

function getRowVendorName(row = {}) {
  return String(row.vendedora || "").trim();
}

function dedupeRowsByGroup(rows = []) {
  const map = new Map();

  rows.forEach((row) => {
    const id = getRowId(row);
    if (!id) return;
    if (!map.has(id)) {
      map.set(id, row);
    }
  });

  return [...map.values()];
}

function getRowsForCurrentScope(effectiveUser) {
  const vendorFilter = isVendedorRole(effectiveUser)
    ? normalizeEmail(effectiveUser.email)
    : normalizeEmail(getVendorFilter(effectiveUser) || "");

  let rows = [...state.rows];

  if (vendorFilter) {
    rows = rows.filter((row) => getRowVendorEmail(row) === vendorFilter);
  }

  return dedupeRowsByGroup(rows);
}

function formatYearBuckets(rows = []) {
  const baseYear =
    getAnoPrioritarioIndex();

  const y1 =
    baseYear;

  const y2 =
    baseYear + 1;

  const y3 =
    baseYear + 2;

  let c1 = 0;
  let c2 = 0;
  let c3 = 0;

  rows.forEach((row) => {
    const y =
      getAnoViajeNumber(row);

    if (y === y1) {
      c1 += 1;
    } else if (y === y2) {
      c2 += 1;
    } else if (y === y3) {
      c3 += 1;
    }
  });

  return `${pad2(c1)} | ${pad2(c2)} | ${pad2(c3)} | (${pad2(rows.length)})`;
}

function renderFichaAdminBucketLinks(
  targetId,
  tipo = "",
  rows = []
) {
  const el =
    $(targetId);

  if (!el) {
    return;
  }

  const baseYear =
    getAnoPrioritarioIndex();

  const years = [
    baseYear,
    baseYear + 1,
    baseYear + 2
  ];

  const counts =
    years.map((year) =>
      rows.filter(
        (row) =>
          getAnoViajeNumber(row) ===
          year
      ).length
    );

  const yearLinks =
    years.map(
      (year, index) => `
        <a
          href="#"
          class="flow-number-link"
          data-fichas-admin-tipo="${tipo}"
          data-fichas-admin-year="${year}"
          style="color:inherit;text-decoration:none;"
        >${pad2(counts[index])}</a>
      `
    );

  const totalLink = `
    <a
      href="#"
      class="flow-number-link"
      data-fichas-admin-tipo="${tipo}"
      data-fichas-admin-year="total"
      style="color:inherit;text-decoration:none;"
    >${pad2(rows.length)}</a>
  `;

  el.innerHTML =
    `${yearLinks[0]} | ${yearLinks[1]} | ${yearLinks[2]} | (${totalLink})`;
}

function resolveEstadoBucket(row = {}) {
  const estado = normalizeLoose(row.estado);

  if (!estado) return "";

  if (estado.includes("re cot") || estado.includes("recot")) return "recotizando";
  if (estado.includes("reunion") && estado.includes("confirm")) return "reunion";
  if (estado.includes("cotiz")) return "cotizando";
  if (estado.includes("perdid")) return "perdidas";
  if (estado.includes("ganad")) return "ganadas";
  if (estado.includes("autoriz")) return "autorizadas";
  if (estado.includes("cerrad")) return "cerradas";
  if (estado.includes("a contactar")) return "a_contactar";
  if (estado.includes("contactad")) return "contactados";

  return "";
}

function getBucketRows(rows = [], bucket = "") {
  return rows.filter((row) => resolveEstadoBucket(row) === bucket);
}

function isSinAsignar(row = {}) {
  return (
    isTruthyFlag(row.requiereAsignacion) ||
    (!getRowVendorEmail(row) && !normalizeLoose(getRowVendorName(row))) ||
    normalizeLoose(getRowVendorName(row)) === "sin asignar"
  );
}

function isAContactar(row = {}) {
  return normalizeLoose(row.estado).includes("a contactar");
}

function getRoleKey(user = {}) {
  return normalizeLoose(user?.rol || "");
}

function isAdminDashboardRole(user = {}) {
  return getRoleKey(user) === "admin";
}

function isGeneralDashboardRole(user = {}) {
  return isAdminDashboardRole(user) || isRegistroRole(user);
}

function isSupervisionDashboardRole(user = {}) {
  return getRoleKey(user) === "supervision";
}

function getFichaFlowModeRow(row = {}) {
  return normalizeLoose(
    row.fichaFlujoModo ||
    row?.flowFicha?.modo ||
    row?.ficha?.flujoModo ||
    ""
  );
}

function getFichaFirmas(row = {}) {
  const flow = row.flowFicha || {};

  return {
    vendedor: !!flow?.vendedor?.firmado || isTruthyFlag(row.firmaVendedor),
    jefa: !!flow?.jefaVentas?.firmado || isTruthyFlag(row.firmaSupervision),
    admin: !!flow?.administracion?.firmado || isTruthyFlag(row.firmaAdministracion)
  };
}

function hasFichaCreada(row = {}) {
  const flowMode = getFichaFlowModeRow(row);
  if (flowMode) return true;

  if (row.ficha && typeof row.ficha === "object" && Object.keys(row.ficha).length) {
    return true;
  }

  if (row.flowFicha && typeof row.flowFicha === "object" && Object.keys(row.flowFicha).length) {
    return true;
  }

  const rootSignals = [
    row.solicitudReserva,
    row.versionFicha,
    row.fechaActualizacionFicha,
    row.fichaEstado,
    row.fichaPdfUrl,
    row.numeroNegocio,
    row.usuarioProgramaAdm,
    row.claveAdministrativa,
    row.firmaVendedor,
    row.firmaSupervision,
    row.firmaAdministracion
  ];

  return rootSignals.some((value) => String(value ?? "").trim() !== "");
}

function isFichaCerrada(row = {}) {
  const firmas = getFichaFirmas(row);
  const estadoFicha = normalizeLoose(row.fichaEstado || "");
  const cierre = normalizeLoose(row.cierre || "");

  return (
    isTruthyFlag(row.cerrada) ||
    isTruthyFlag(row.autorizada) ||
    cierre.includes("cerrad") ||
    estadoFicha === "autorizada_admin" ||
    (firmas.vendedor && firmas.jefa && firmas.admin)
  );
}

function isGanadaComercial(row = {}) {
  return resolveEstadoBucket(row) === "ganadas";
}

function hasAllThreeFichaFirmas(row = {}) {
  const firmas = getFichaFirmas(row);
  return !!(firmas.vendedor && firmas.jefa && firmas.admin);
}

function getAdminValue(row = {}, fichaKey = "", rootKey = "") {
  return String(
    row?.ficha?.[fichaKey] ||
    row?.[rootKey] ||
    row?.[fichaKey] ||
    ""
  ).trim();
}

function tuvoFirmaAdministracionAlgunaVez(row = {}) {
  const flow = row.flowFicha || {};

  return (
    !!flow?.administracion?.firmado ||
    !!flow?.administracion?.firmadoAt ||
    !!flow?.administracion?.firmadoPor ||
    !!row.firmaAdministracion ||
    !!row.fechaFirmaAdministracion ||
    row.autorizada === true
  );
}

function isFichaAbiertaAdministrativa(row = {}) {
  const haySolicitudAbierta = (state.solicitudesRows || []).some((sol) => {
    return (
      String(sol.idGrupo || "").trim() === getRowId(row) &&
      normalizeLoose(sol.tipoSolicitud || "") === "actualizacion_ficha" &&
      sol.resuelta !== true &&
      !["completada", "cerrada"].includes(normalizeLoose(sol.estadoSolicitud || ""))
    );
  });

  return (
    haySolicitudAbierta ||
    isCorreccionFichaPendiente(row) ||
    row.fichaFlujoAbierto === true ||
    isPdfPendienteGeneracion(row)
  );
}

function isFichaCerradaAdministrativa(row = {}) {
  const firmas = getFichaFirmas(row);
  return firmas.vendedor && firmas.jefa && firmas.admin && !isFichaAbiertaAdministrativa(row);
}

function isFichaAutorizadaAdministrativa(row = {}) {
  const estado = normalizeLoose(row.estado || "");

  // Si pasa a perdida, deja de contar como autorizada
  if (estado.includes("perdid")) return false;

  return row.autorizada === true || tienePdfRealFicha(row);
}

function getFichaAdminMotivo(row = {}) {
  if (isFichaAbiertaAdministrativa(row)) {
    const estado = normalizeLoose(row?.flowFicha?.correccionEstado || "");

    if (estado === "pendiente_jefa") return "Corrección pendiente de jefa de ventas";
    if (estado === "pendiente_administracion") return "Corrección pendiente de administración";

    return "Solicitud de actualización o corrección abierta";
  }

  if (isFichaAutorizadaAdministrativa(row)) return "Autorizada para gestión de pago";
  if (isFichaCerradaAdministrativa(row)) return "Flujo de firmas completo";

  return "Sin clasificación";
}

function sortRowsByAliasComparator(a, b) {
  const aliasA = getAliasColegioSortKey(getRowAlias(a));
  const aliasB = getAliasColegioSortKey(getRowAlias(b));
  return aliasA.localeCompare(aliasB, "es", { sensitivity: "base", numeric: true });
}

function isCaroDashboardUser(user = {}) {
  return normalizeEmail(user?.email || "") === "chernandez@raitrai.cl";
}

function isAdministracionDashboardUser(user = {}) {
  const email = normalizeEmail(user?.email || "");
  return (
    email === "yenny@raitrai.cl" ||
    email === "administracion@raitrai.cl" ||
    email === "raitrai@raitrai.cl"
  );
}

function tienePdfRealFicha(row = {}) {
  return !!String(
    row?.ficha?.pdfUrl ||
    row?.fichaPdfUrl ||
    row?.pdfUrl ||
    ""
  ).trim();
}

function isPdfPendienteGeneracion(row = {}) {
  return (
    row?.ficha?.pdfPendienteGeneracion === true ||
    row?.pdfPendienteGeneracion === true ||
    row?.fichaPdfPendienteGeneracion === true
  );
}

function tuvoPdfOficialAlgunaVez(row = {}) {
  return !!String(
    row?.ficha?.storagePathPdf ||
    row?.ficha?.confirmadaEl ||
    row?.ficha?.confirmadaPor ||
    row?.ultimaGestionTipo === "confirmacion_ficha_pdf" ||
    row?.versionFichaNumero > 1 ||
    row?.ficha?.versionNumero > 1 ||
    ""
  ).trim();
}

function isCorreccionFichaPendiente(row = {}) {
  const flow = row.flowFicha || {};
  const estado = normalizeLoose(flow.correccionEstado || "");
  const modo = normalizeLoose(flow.modo || row.fichaFlujoModo || "");

  const firmasCompletas = hasAllThreeFichaFirmas(row);
  const pdfGenerado = tienePdfRealFicha(row);
  const pdfPendiente = isPdfPendienteGeneracion(row);
  const flujoAbierto = row.fichaFlujoAbierto === true;

  // Si ya están las 3 firmas, ya existe PDF real, no hay PDF pendiente
  // y el flujo está cerrado, NO puede seguir como corrección pendiente.
  if (firmasCompletas && pdfGenerado && !pdfPendiente && !flujoAbierto) {
    return false;
  }

  return (
    flow.correccionPendiente === true ||
    estado === "pendiente_jefa" ||
    estado === "pendiente_administracion" ||
    (
      modo === "correccion" &&
      flujoAbierto
    ) ||
    (
      modo === "correccion" &&
      pdfPendiente
    )
  );
}

function getCorreccionFichaEstado(row = {}) {
  const flow = row.flowFicha || {};
  const modo = normalizeLoose(flow.modo || row.fichaFlujoModo || "");

  if (modo !== "correccion") return "";

  const firmas = getFichaFirmas(row);

  if (firmas.vendedor && firmas.jefa && firmas.admin) {
    return "";
  }

  if (firmas.jefa) {
    return "pendiente_administracion";
  }

  return "pendiente_jefa";
}

function isFichaCorregidaVisibleParaUsuario(row = {}, user = null) {
  const effectiveUser = user || getEffectiveUser();
  if (!effectiveUser) return false;

  // Si no hay PDF real, sigue siendo ficha nueva.
  if (!tienePdfRealFicha(row)) return false;

  if (!isCorreccionFichaPendiente(row)) return false;

  const estado = getCorreccionFichaEstado(row);

  if (isGeneralDashboardRole(effectiveUser)) return true;

  if (isCaroDashboardUser(effectiveUser)) {
    return estado === "pendiente_jefa";
  }

  if (isAdministracionDashboardUser(effectiveUser)) {
    return estado === "pendiente_administracion";
  }

  return false;
}

function getFichaCorregidaLabel(row = {}) {
  const estado = getCorreccionFichaEstado(row);

  if (estado === "pendiente_jefa") {
    return "Corrección pendiente de revisión por jefa de ventas";
  }

  if (estado === "pendiente_administracion") {
    return "Corrección pendiente de cierre administrativo";
  }

  const firmas = getFichaFirmas(row);

  if (firmas.jefa && !firmas.admin) {
    return "Corrección pendiente de cierre administrativo";
  }

  if (!firmas.jefa) {
    return "Corrección pendiente de revisión por jefa de ventas";
  }

  return "Corrección pendiente";
}

function getCorreccionDetalle(row = {}) {
  return String(
    row?.ultimaCorreccion?.detalle ||
    row?.flowFicha?.ultimaCorreccion?.detalle ||
    row?.ficha?.ultimaCorreccion?.detalle ||
    row?.ultimaCorreccion?.asunto ||
    row?.flowFicha?.ultimaCorreccion?.asunto ||
    ""
  ).trim();
}

function getTextoResumen(texto = "", max = 90) {
  const clean = String(texto || "").trim();
  if (clean.length <= max) return clean;
  return clean.slice(0, max).trim() + "...";
}

function renderMotivoCorreccion(row = {}) {
  const detalle = getCorreccionDetalle(row);
  if (!detalle) return "";

  const resumen = getTextoResumen(detalle, 90);
  const uid = `motivo-correccion-${getRowId(row)}`;

  return `
    <div style="margin-top:10px; padding:10px 12px; border-radius:14px; background:#fff8eb; border:1px solid #f0c27a; color:#5f3b00; font-size:13px; line-height:1.45;">
      <strong>Motivo:</strong> ${escapeHtml(resumen)}

      <button
        type="button"
        data-toggle-motivo="${escapeHtml(uid)}"
        style="margin-left:8px; border:0; background:#f2dfbd; color:#4b2d00; border-radius:999px; padding:5px 9px; font-weight:800; cursor:pointer;"
      >
        Ver motivo
      </button>

      <div
        id="${escapeHtml(uid)}"
        hidden
        style="margin-top:10px; padding-top:10px; border-top:1px solid #e8c98f;"
      >
        <strong>Motivo completo:</strong><br>
        ${escapeHtml(detalle)}
      </div>
    </div>
  `;
}

function getFichasCorregidasSegunUsuario(rows = [], effectiveUser = null) {
  return dedupeRowsByGroup(rows)
    .filter((row) => isFichaCorregidaVisibleParaUsuario(row, effectiveUser))
    .sort((a, b) => {
      const aliasA = getAliasColegioSortKey(getRowAlias(a));
      const aliasB = getAliasColegioSortKey(getRowAlias(b));
      return aliasA.localeCompare(aliasB, "es", { sensitivity: "base", numeric: true });
    });
}

function getFichaPendienteLabel(row = {}) {
  const firmas = getFichaFirmas(row);

  if (!firmas.vendedor) return "Falta firma vendedor(a)";
  if (!firmas.jefa) return "Falta firma jefa de ventas";
  if (!firmas.admin) return "Falta firma administración";
  return "Firmas completas";
}

function isFichaPorFirmarSegunUsuario(row = {}, effectiveUser = null) {
  const user = effectiveUser || getEffectiveUser();
  if (!user) return false;

  const ano = getAnoViajeNumber(row);

  if (!ano || ano < 2026) return false;
  if (!isGanadaComercial(row)) return false;

  // Si ya tiene PDF real, ya no es ficha nueva.
  if (tienePdfRealFicha(row)) return false;

  const firmas = getFichaFirmas(row);

  if (isVendedorRole(user)) {
    return !firmas.vendedor;
  }

  if (isCaroDashboardUser(user)) {
    return firmas.vendedor && !firmas.jefa;
  }

  if (isAdministracionDashboardUser(user)) {
    return firmas.vendedor && firmas.jefa && !firmas.admin;
  }

  if (isGeneralDashboardRole(user)) {
    return !hasAllThreeFichaFirmas(row);
  }

  return false;
}

function getFichasPorFirmarSegunUsuario(rows = [], effectiveUser = null) {
  const solicitudesAbiertasIds = new Set(
    (state.solicitudesRows || [])
      .filter(isSolicitudActualizacionAbierta)
      .flatMap((sol) => [
        String(sol.idGrupo || "").trim(),
        String(sol.codigoRegistro || "").trim()
      ])
      .filter(Boolean)
  );

  return dedupeRowsByGroup(rows)
    .filter((row) => {
      // Regla madre:
      // Sin PDF real = ficha nueva, aunque tenga corrección o solicitud.
      if (!tienePdfRealFicha(row)) {
        return isFichaPorFirmarSegunUsuario(row, effectiveUser);
      }

      const posiblesIdsGrupo = [
        String(row.idGrupo || "").trim(),
        String(row.id || "").trim(),
        String(row.codigoRegistro || "").trim()
      ].filter(Boolean);

      const tieneSolicitudAbierta = posiblesIdsGrupo.some((id) =>
        solicitudesAbiertasIds.has(id)
      );

      if (tieneSolicitudAbierta) return false;
      if (isCorreccionFichaPendiente(row)) return false;

      return isFichaPorFirmarSegunUsuario(row, effectiveUser);
    })
    .sort((a, b) => {
      const aliasA = getAliasColegioSortKey(getRowAlias(a));
      const aliasB = getAliasColegioSortKey(getRowAlias(b));
      return aliasA.localeCompare(aliasB, "es", { sensitivity: "base", numeric: true });
    });
}

function getSolicitudEstadoLabel(sol = {}) {
  const estado = normalizeLoose(sol.estadoSolicitud || "");

  if (estado === "pendiente") return "Pendiente revisión jefa de ventas";
  if (estado === "revisada_jefa") return "Revisada por jefa / pendiente Administración";
  if (estado === "completada") return "Cerrada por Administración";

  return sol.estadoSolicitud || "Sin estado";
}

function isSolicitudActualizacionAbierta(sol = {}) {
  const tipo = normalizeLoose(sol.tipoSolicitud || "");
  const estado = normalizeLoose(sol.estadoSolicitud || "");

  return tipo === "actualizacion_ficha" &&
    sol.resuelta !== true &&
    estado !== "completada" &&
    estado !== "cerrada";
}

function isSolicitudVisibleParaUsuario(sol = {}, user = null, groupRow = {}) {
  if (!user) return false;

  const estado = normalizeLoose(sol.estadoSolicitud || "");
  const userEmail = normalizeEmail(user.email || "");
  const rol = normalizeLoose(user.rol || "");

  if (!isSolicitudActualizacionAbierta(sol)) return false;

  if (rol === "admin") return true;

  if (isCaroDashboardUser(user)) {
    return estado === "pendiente";
  }

  if (isAdministracionDashboardUser(user)) {
    return estado === "revisada_jefa";
  }

  if (isVendedorRole(user)) {
    const solicitadoPor = normalizeEmail(sol.solicitadoPorCorreo || "");
    const vendedorGrupo = normalizeEmail(groupRow?.vendedoraCorreo || "");

    return (
      solicitadoPor === userEmail ||
      vendedorGrupo === userEmail
    );
  }

  return false;
}

function getSolicitudesActualizacionSegunUsuario(rows = [], effectiveUser = null) {
  const user = effectiveUser || getEffectiveUser();

  const scopedIds = new Set(
    dedupeRowsByGroup(rows)
      .map((row) => getRowId(row))
      .filter(Boolean)
  );

  return (state.solicitudesRows || [])
    .map((sol) => {
      const idGrupo = String(sol.idGrupo || "").trim();
      const groupRow = state.rowsById.get(idGrupo) || {};
      return { ...sol, _groupRow: groupRow };
    })
    .filter((sol) => {
      const idGrupo = String(sol.idGrupo || "").trim();
      if (!scopedIds.has(idGrupo)) return false;
      return isSolicitudVisibleParaUsuario(sol, user, sol._groupRow || {});
    })
    .sort((a, b) => {
      const da = timestampLikeToDate(a.fechaSolicitud)?.getTime() || 0;
      const db = timestampLikeToDate(b.fechaSolicitud)?.getTime() || 0;
      return db - da;
    });
}

function actualizarEstadoVisualAlerta(
  contadorId = "",
  cantidad = 0
) {
  const contador =
    $(contadorId);

  if (!contador) {
    return;
  }

  const row =
    contador.closest(
      ".alert-row"
    ) ||
    contador.closest(
      ".alert-row-wrap"
    );

  if (!row) {
    return;
  }

  const total =
    Math.max(
      0,
      Number(cantidad) || 0
    );

  /*
    Primero limpia ambos estados.
  */
  row.classList.remove(
    "alerta-activa",
    "alerta-urgente"
  );

  /*
    Cero:
    apariencia normal.
  */
  if (total <= 0) {
    return;
  }

  /*
    Desde uno:
    resaltado suave.
  */
  row.classList.add(
    "alerta-activa"
  );

  /*
    Desde seis:
    pulsación de emergencia.
  */
  if (total > 5) {
    row.classList.add(
      "alerta-urgente"
    );
  }
}

function setContadorAlertaIndex(
  contadorId = "",
  cantidad = 0
) {
  const total =
    Math.max(
      0,
      Number(cantidad) || 0
    );

  const el =
    $(contadorId);

  if (!el) {
    return;
  }

  el.textContent =
    String(total);

  actualizarEstadoVisualAlerta(
    contadorId,
    total
  );
}

function setAlertRowVisibleByChild(childId, visible = true) {
  const child = $(childId);
  const row = child?.closest(".alert-row") || child?.closest(".alert-row-wrap");
  if (!row) return;

  row.style.display = visible ? "" : "none";
}

function syncAlertRowsByRole(effectiveUser = null) {
  const user = effectiveUser || getEffectiveUser();

  const canSeeSinAsignar =
    isAdminDashboardRole(user) ||
    isSupervisionDashboardRole(user) ||
    isRegistroRole(user);

  const canSeeFichas = !!user;
  const canSeeSolicitudes = !!user;
  const canSeeAlertasCriticas = !!user;
  const canSeeAlertasWarning = !!user;

  setAlertRowVisibleByChild("link-sin-asignar", canSeeSinAsignar);
  setAlertRowVisibleByChild("link-fichas-firmar", canSeeFichas);
  setAlertRowVisibleByChild("link-fichas-corregidas", canSeeFichas);
  setAlertRowVisibleByChild("link-solicitudes-actualizacion", canSeeSolicitudes);
  setAlertRowVisibleByChild("link-alertas-criticas", canSeeAlertasCriticas);
  setAlertRowVisibleByChild("link-alertas-warning", canSeeAlertasWarning);
  setAlertRowVisibleByChild("link-inscripcion-nuevo-ingreso", !!user);
  setAlertRowVisibleByChild("link-inscripcion-lista-espera", !!user);
  setAlertRowVisibleByChild("link-lista-espera-pagada", !!user);
  setAlertRowVisibleByChild("count-pendientes", false);
}

function isReunionEnProximosTresDias(row = {}) {
  if (resolveEstadoBucket(row) !== "reunion") return false;

  const fecha = getMeetingDate(row);
  if (!fecha) return false;

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const limit = new Date(todayStart);
  limit.setDate(limit.getDate() + 3);
  limit.setHours(23, 59, 59, 999);

  return fecha >= todayStart && fecha <= limit;
}

function renderAContactarModal(rows = [], effectiveUser = null) {
  const titleEl = $("a-contactar-titulo");
  const subtitleEl = $("a-contactar-subtitulo");
  const summaryEl = $("a-contactar-resumen");
  const listEl = $("a-contactar-lista");

  if (!titleEl || !subtitleEl || !summaryEl || !listEl) return;

  titleEl.textContent = "Contactos a contactar";
  subtitleEl.textContent = isVendedorRole(effectiveUser)
    ? "Aquí ves tus grupos pendientes de primer contacto."
    : "Aquí ves los grupos pendientes de primer contacto según la vista actual.";

  summaryEl.textContent = rows.length
    ? `Hay ${rows.length} contacto(s) pendientes de contactar.`
    : "No hay contactos pendientes de contactar en esta vista.";

  if (!rows.length) {
    listEl.innerHTML = `
      <div style="padding:16px 18px; border:1px solid rgba(60,40,90,.10); border-radius:16px; background:#faf8fd; color:#5d546d;">
        No hay contactos a contactar.
      </div>
    `;
    return;
  }

  listEl.innerHTML = rows.map((row) => {
    const id = getRowId(row);
    const alias = getRowAlias(row);
    const apoderado = getRowApoderado(row);
    const vendedor = getRowVendorName(row) || row.vendedoraCorreo || "Sin vendedor";

    return `
      <div style="padding:14px 16px; border:1px solid rgba(60,40,90,.12); border-radius:16px; background:#fff; display:flex; justify-content:space-between; gap:14px; align-items:flex-start;">
        <div style="min-width:0;">
          <div style="font-weight:800; color:#31194b; font-size:16px; line-height:1.2;">
            ${escapeHtml(alias)}
          </div>

          <div style="margin-top:6px; color:#6a6078; font-size:13px; line-height:1.45;">
            Apoderado: ${escapeHtml(apoderado)}<br>
            Vendedor(a): ${escapeHtml(vendedor)}<br>
            Estado: ${escapeHtml(row.estado || "A contactar")}
          </div>
        </div>

        <a
          href="grupo.html?id=${encodeURIComponent(id)}"
          target="_blank"
          rel="noopener"
          style="flex:0 0 auto; text-decoration:none; background:#3b2357; color:#fff; border-radius:999px; padding:10px 14px; font-weight:700; white-space:nowrap;"
        >
          Abrir grupo
        </a>
      </div>
    `;
  }).join("");
}

function openAContactarModal() {
  const dialog = $("modal-a-contactar");
  if (!dialog) return;

  renderAContactarModal(
    Array.isArray(state.aContactarRows) ? state.aContactarRows : [],
    getEffectiveUser()
  );

  if (typeof dialog.showModal === "function") {
    if (!dialog.open) dialog.showModal();
    return;
  }

  dialog.setAttribute("open", "open");
}

function closeAContactarModal() {
  const dialog = $("modal-a-contactar");
  if (!dialog) return;

  if (typeof dialog.close === "function") {
    dialog.close();
    return;
  }

  dialog.removeAttribute("open");
}

function getFichasPorFirmarSubtitulo(user = null) {
  const effectiveUser = user || getEffectiveUser();
  if (!effectiveUser) return "Listado de fichas pendientes según tu rol.";

  if (isVendedorRole(effectiveUser)) {
    return "Aquí ves las fichas ganadas donde todavía falta la firma del vendedor(a).";
  }

  if (isCaroDashboardUser(effectiveUser)) {
    return "Aquí ves las fichas donde ya firmó vendedor(a) y todavía falta la firma de jefa de ventas.";
  }

  if (isAdministracionDashboardUser(effectiveUser)) {
    return "Aquí ves las fichas donde ya firmó vendedor(a) y jefa de ventas, y todavía falta la firma de administración.";
  }

  return "Aquí ves todas las fichas ganadas que todavía no tienen las 3 firmas completas.";
}

function renderFichasPorFirmarModal(rows = [], effectiveUser = null) {
  const titleEl = $("fichas-firmar-titulo");
  const subtitleEl = $("fichas-firmar-subtitulo");
  const summaryEl = $("fichas-firmar-resumen");
  const listEl = $("fichas-firmar-lista");

  if (!titleEl || !subtitleEl || !summaryEl || !listEl) return;

  titleEl.textContent = "Fichas por firmar";
  subtitleEl.textContent = getFichasPorFirmarSubtitulo(effectiveUser);
  summaryEl.textContent = rows.length
    ? `Hay ${rows.length} ficha(s) pendiente(s) en tu vista actual.`
    : "No hay fichas pendientes para tu rol en esta vista.";

  if (!rows.length) {
    listEl.innerHTML = `
      <div style="padding:16px 18px; border:1px solid rgba(60,40,90,.10); border-radius:16px; background:#faf8fd; color:#5d546d;">
        No hay fichas por firmar.
      </div>
    `;
    return;
  }

  listEl.innerHTML = rows.map((row) => {
    const id = getRowId(row);
    const alias = getRowAlias(row);
    const idNegocio = getIdNegocioLabel(row);
    const apoderado = getRowApoderado(row);
    const vendedor = getRowVendorName(row) || row.vendedoraCorreo || "Sin vendedor";
    const pendiente = getFichaPendienteLabel(row);

    return `
      <div style="padding:14px 16px; border:1px solid rgba(60,40,90,.12); border-radius:16px; background:#fff; display:flex; justify-content:space-between; gap:14px; align-items:flex-start;">
        <div style="min-width:0;">
          <div style="font-weight:800; color:#31194b; font-size:16px; line-height:1.2;">
            ${escapeHtml(alias)}
          </div>

          <div style="margin-top:6px; color:#6a6078; font-size:13px; line-height:1.45;">
            ${escapeHtml(idNegocio)}<br>
            Apoderado: ${escapeHtml(apoderado)}<br>
            Vendedor(a): ${escapeHtml(vendedor)}<br>
            Estado pendiente: ${escapeHtml(pendiente)}
          </div>
        </div>

        <a
          href="fichas.html?id=${encodeURIComponent(id)}"
          target="_blank"
          rel="noopener"
          style="flex:0 0 auto; text-decoration:none; background:#3b2357; color:#fff; border-radius:999px; padding:10px 14px; font-weight:700; white-space:nowrap;"
        >
          Abrir ficha
        </a>
      </div>
    `;
  }).join("");
}

function openFichasPorFirmarModal() {
  const dialog = $("modal-fichas-firmar");
  if (!dialog) return;

  const effectiveUser = getEffectiveUser();
  const rows = Array.isArray(state.fichasPorFirmarRows) ? state.fichasPorFirmarRows : [];

  renderFichasPorFirmarModal(rows, effectiveUser);

  if (typeof dialog.showModal === "function") {
    if (!dialog.open) dialog.showModal();
    return;
  }

  dialog.setAttribute("open", "open");
}

function closeFichasPorFirmarModal() {
  const dialog = $("modal-fichas-firmar");
  if (!dialog) return;

  if (typeof dialog.close === "function") {
    dialog.close();
    return;
  }

  dialog.removeAttribute("open");
}

function renderFichasCorregidasModal(rows = [], effectiveUser = null) {
  const titleEl = $("fichas-corregidas-titulo");
  const subtitleEl = $("fichas-corregidas-subtitulo");
  const summaryEl = $("fichas-corregidas-resumen");
  const listEl = $("fichas-corregidas-lista");

  if (!titleEl || !subtitleEl || !summaryEl || !listEl) return;

  titleEl.textContent = "Fichas corregidas";
  subtitleEl.textContent = "Correcciones internas pendientes según tu rol.";
  summaryEl.textContent = rows.length
    ? `Hay ${rows.length} ficha(s) corregida(s) pendiente(s).`
    : "No hay fichas corregidas pendientes para tu rol.";

  if (!rows.length) {
    listEl.innerHTML = `
      <div style="padding:16px 18px; border:1px solid rgba(60,40,90,.10); border-radius:16px; background:#faf8fd; color:#5d546d;">
        No hay fichas corregidas pendientes.
      </div>
    `;
    return;
  }

  listEl.innerHTML = rows.map((row) => {
    const id = getRowId(row);
    const alias = getRowAlias(row);
    const idNegocio = getIdNegocioLabel(row);
    const adminChangesHtml = renderAdminImportantChanges(row, effectiveUser);
    const apoderado = getRowApoderado(row);
    const vendedor = getRowVendorName(row) || row.vendedoraCorreo || "Sin vendedor";
    const pendiente = getFichaCorregidaLabel(row);

    return `
      <div style="padding:14px 16px; border:1px solid rgba(60,40,90,.12); border-radius:16px; background:#fff; display:flex; justify-content:space-between; gap:14px; align-items:flex-start;">
        <div style="min-width:0;">
          <div style="font-weight:800; color:#31194b; font-size:16px; line-height:1.2;">
            ${escapeHtml(alias)}
          </div>

          <div style="margin-top:6px; color:#6a6078; font-size:13px; line-height:1.45;">
            ${escapeHtml(idNegocio)}<br>
            Apoderado: ${escapeHtml(apoderado)}<br>
            Vendedor(a): ${escapeHtml(vendedor)}<br>
            Estado corrección: ${escapeHtml(pendiente)}
            ${renderMotivoCorreccion(row)}
            ${adminChangesHtml}
          </div>
        </div>

        <a
          href="fichas.html?id=${encodeURIComponent(id)}"
          target="_blank"
          rel="noopener"
          style="flex:0 0 auto; text-decoration:none; background:#3b2357; color:#fff; border-radius:999px; padding:10px 14px; font-weight:700; white-space:nowrap;"
        >
          Abrir ficha
        </a>
      </div>
    `;
  }).join("");
}

function openFichasCorregidasModal() {
  const dialog = $("modal-fichas-corregidas");
  if (!dialog) return;

  const effectiveUser = getEffectiveUser();
  const rows = Array.isArray(state.fichasCorregidasRows) ? state.fichasCorregidasRows : [];

  renderFichasCorregidasModal(rows, effectiveUser);

  if (typeof dialog.showModal === "function") {
    if (!dialog.open) dialog.showModal();
    return;
  }

  dialog.setAttribute("open", "open");
}

function closeFichasCorregidasModal() {
  const dialog = $("modal-fichas-corregidas");
  if (!dialog) return;

  if (typeof dialog.close === "function") {
    dialog.close();
    return;
  }

  dialog.removeAttribute("open");
}

function buildSearchTextLocal(obj = {}) {
  let text = "";

  function walk(value) {
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) return value.forEach(walk);
    if (typeof value === "object") return Object.values(value).forEach(walk);
    text += " " + String(value);
  }

  walk(obj);
  return normalizeLoose(text);
}

function renderFichasAdminModal(rows = [], tipo = "") {
  const titleEl = $("fichas-admin-titulo");
  const subtitleEl = $("fichas-admin-subtitulo");
  const summaryEl = $("fichas-admin-resumen");
  const listEl = $("fichas-admin-lista");
  const buscador = $("fichas-admin-buscador");

  if (!titleEl || !subtitleEl || !summaryEl || !listEl) return;

  const titles = {
    abiertas: "Fichas abiertas",
    cerradas: "Fichas cerradas",
    autorizadas: "Fichas autorizadas"
  };

  titleEl.textContent = titles[tipo] || "Fichas";
  subtitleEl.textContent =
    tipo === "abiertas" ? "Fichas reabiertas por actualización, corrección o refirma." :
    tipo === "cerradas" ? "Fichas con flujo completo y sin reapertura activa." :
    "Fichas autorizadas para gestión administrativa de pago.";

  summaryEl.textContent = `Hay ${rows.length} ficha(s) en este listado.`;
  if (buscador) buscador.value = "";

  const pintar = (lista = rows) => {
    if (!lista.length) {
      listEl.innerHTML = `<div style="padding:16px 18px; border-radius:16px; background:#faf8fd; color:#5d546d;">No hay fichas para mostrar.</div>`;
      return;
    }

    listEl.innerHTML = lista.map((row) => {
      const id = getRowId(row);
      return `
        <div style="padding:14px 16px; border:1px solid rgba(60,40,90,.12); border-radius:16px; background:#fff; display:flex; justify-content:space-between; gap:14px;">
          <div>
            <div style="font-weight:800; color:#31194b; font-size:16px;">${escapeHtml(getRowAlias(row))}</div>
            <div style="margin-top:6px; color:#6a6078; font-size:13px; line-height:1.45;">
              Apoderado: ${escapeHtml(getRowApoderado(row))}<br>
              Vendedor(a): ${escapeHtml(getRowVendorName(row) || row.vendedoraCorreo || "Sin vendedor")}<br>
              Año viaje: ${escapeHtml(row.anoViaje || "—")}<br>
              Motivo: ${escapeHtml(getFichaAdminMotivo(row))}
            </div>
          </div>

          <a href="fichas.html?id=${encodeURIComponent(id)}" target="_blank" rel="noopener" style="text-decoration:none; background:#3b2357; color:#fff; border-radius:999px; padding:10px 14px; font-weight:700; height:max-content;">
            Abrir ficha
          </a>
        </div>
      `;
    }).join("");
  };

  pintar(rows);

  if (buscador && !buscador.dataset.boundFichasAdmin) {
    buscador.dataset.boundFichasAdmin = "1";
    buscador.addEventListener("input", () => {
      const q = normalizeLoose(buscador.value || "");
      pintar(q ? rows.filter((row) => buildSearchTextLocal(row).includes(q)) : rows);
    });
  }
}

function openFichasAdminModal(tipo = "", year = "total") {
  const dialog = $("modal-fichas-admin");
  if (!dialog) return;

  const allRows =
    tipo === "abiertas" ? state.fichasAbiertasRows :
    tipo === "cerradas" ? state.fichasCerradasRows :
    tipo === "autorizadas" ? state.fichasAutorizadasRows :
    [];

  const rows = year && year !== "total"
    ? allRows.filter((row) => getAnoViajeNumber(row) === Number(year))
    : allRows;

  renderFichasAdminModal(rows || [], tipo);

  if (typeof dialog.showModal === "function") {
    if (!dialog.open) dialog.showModal();
  } else {
    dialog.setAttribute("open", "open");
  }
}

function closeFichasAdminModal() {
  const dialog = $("modal-fichas-admin");
  if (!dialog) return;
  if (typeof dialog.close === "function") dialog.close();
  else dialog.removeAttribute("open");
}

function getSolicitudesActualizacionSubtitulo(user = null) {
  const effectiveUser = user || getEffectiveUser();

  if (!effectiveUser) return "Solicitudes abiertas según tu rol.";

  if (isVendedorRole(effectiveUser)) {
    return "Aquí ves el seguimiento de tus solicitudes de actualización abiertas.";
  }

  if (isCaroDashboardUser(effectiveUser)) {
    return "Aquí ves las solicitudes pendientes de revisión por jefa de ventas.";
  }

  if (isAdministracionDashboardUser(effectiveUser)) {
    return "Aquí ves las solicitudes ya revisadas por jefa de ventas y pendientes de cierre administrativo.";
  }

  return "Aquí ves las solicitudes de actualización abiertas.";
}

function renderSolicitudesActualizacionModal(rows = [], effectiveUser = null) {
  const titleEl = $("solicitudes-actualizacion-titulo");
  const subtitleEl = $("solicitudes-actualizacion-subtitulo");
  const summaryEl = $("solicitudes-actualizacion-resumen");
  const listEl = $("solicitudes-actualizacion-lista");

  if (!titleEl || !subtitleEl || !summaryEl || !listEl) return;

  titleEl.textContent = "Solicitudes de actualización";
  subtitleEl.textContent = getSolicitudesActualizacionSubtitulo(effectiveUser);

  summaryEl.textContent = rows.length
    ? `Hay ${rows.length} solicitud(es) de actualización en tu vista actual.`
    : "No hay solicitudes de actualización pendientes para tu rol.";

  if (!rows.length) {
    listEl.innerHTML = `
      <div style="padding:16px 18px; border:1px solid rgba(60,40,90,.10); border-radius:16px; background:#faf8fd; color:#5d546d;">
        No hay solicitudes de actualización abiertas.
      </div>
    `;
    return;
  }

  listEl.innerHTML = rows.map((sol) => {
    const groupRow = sol._groupRow || {};
    const idNegocio = getIdNegocioLabel(groupRow);
    const adminChangesHtml = renderAdminImportantChanges(groupRow, effectiveUser);
    const idGrupo = String(sol.idGrupo || "").trim();
    const alias = getRowAlias(groupRow) || sol.aliasGrupo || `Grupo ${idGrupo}`;
    const vendedor = getRowVendorName(groupRow) || groupRow.vendedoraCorreo || sol.solicitadoPor || "Sin vendedor";
    const fecha = timestampLikeToDate(sol.fechaSolicitud);
    const fechaTxt = fecha
      ? fecha.toLocaleString("es-CL", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false
        })
      : "Sin fecha";

    return `
      <div style="padding:14px 16px; border:1px solid rgba(60,40,90,.12); border-radius:16px; background:#fff; display:flex; justify-content:space-between; gap:14px; align-items:flex-start;">
        <div style="min-width:0;">
          <div style="font-weight:800; color:#31194b; font-size:16px; line-height:1.2;">
            ${escapeHtml(alias)}
            <div style="margin-top:4px; color:#6a6078; font-size:12px; font-weight:700;">
              ${escapeHtml(idNegocio)}
            </div>
          </div>

          <div style="margin-top:6px; color:#6a6078; font-size:13px; line-height:1.45;">
            Vendedor(a): ${escapeHtml(vendedor)}<br>
            Estado: ${escapeHtml(getSolicitudEstadoLabel(sol))}<br>
            Fecha solicitud: ${escapeHtml(fechaTxt)}
          </div>

          <div style="margin-top:10px; color:#3e3550; font-size:14px; line-height:1.5;">
            <strong>Motivo vendedor:</strong><br>
            ${escapeHtml(sol.detalle || "Sin detalle")}
          </div>

          ${sol.respuestaJefa ? `
            <div style="margin-top:10px; color:#3e3550; font-size:14px; line-height:1.5;">
              <strong>Respuesta jefa de ventas:</strong><br>
              ${escapeHtml(sol.respuestaJefa)}
            </div>
          ` : ""}

          ${sol.respuestaAdministracion ? `
            <div style="margin-top:10px; color:#3e3550; font-size:14px; line-height:1.5;">
              <strong>Cierre administración:</strong><br>
              ${escapeHtml(sol.respuestaAdministracion)}
            </div>
          ` : ""}

          ${adminChangesHtml}
        </div>

        <a
          href="fichas.html?id=${encodeURIComponent(idGrupo)}"
          target="_blank"
          rel="noopener"
          style="flex:0 0 auto; text-decoration:none; background:#3b2357; color:#fff; border-radius:999px; padding:10px 14px; font-weight:700; white-space:nowrap;"
        >
          Abrir ficha
        </a>
      </div>
    `;
  }).join("");
}

function openSolicitudesActualizacionModal() {
  const dialog = $("modal-solicitudes-actualizacion");
  if (!dialog) return;

  const effectiveUser = getEffectiveUser();
  const rows = Array.isArray(state.solicitudesActualizacionRows)
    ? state.solicitudesActualizacionRows
    : [];

  renderSolicitudesActualizacionModal(rows, effectiveUser);

  if (typeof dialog.showModal === "function") {
    if (!dialog.open) dialog.showModal();
    return;
  }

  dialog.setAttribute("open", "open");
}

function closeSolicitudesActualizacionModal() {
  const dialog = $("modal-solicitudes-actualizacion");
  if (!dialog) return;

  if (typeof dialog.close === "function") {
    dialog.close();
    return;
  }

  dialog.removeAttribute("open");
}

function getAlertGroupId(alertRow = {}) {
  return String(alertRow.idGrupo || alertRow.groupId || "").trim();
}

function getAlertGroupRow(alertRow = {}) {
  const groupId = getAlertGroupId(alertRow);
  if (!groupId) return null;
  return state.rowsById.get(groupId) || null;
}

function isDashboardVisibleAlert(alertRow = {}) {
  return (
    alertRow.activa !== false &&
    alertRow.resuelta !== true &&
    alertRow.visibleEnIndex !== false
  );
}

function isCriticalIndexAlert(alertRow = {}) {
  return (
    isDashboardVisibleAlert(alertRow) &&
    normalizeLoose(alertRow.nivel || "") === "critica"
  );
}

function isWarningIndexAlert(alertRow = {}) {
  return (
    isDashboardVisibleAlert(alertRow) &&
    normalizeLoose(alertRow.nivel || "") === "warning"
  );
}

function formatAlertDate(value) {
  const d = timestampLikeToDate(value);
  if (!d) return "Sin fecha";

  return d.toLocaleString("es-CL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

function getAlertsForScope(rows = [], predicate = () => false) {
  const scopedIds = new Set(
    dedupeRowsByGroup(rows)
      .map((row) => getRowId(row))
      .filter(Boolean)
  );

  return (state.alertRows || [])
    .filter((alertRow) => predicate(alertRow))
    .map((alertRow) => ({
      ...alertRow,
      _groupRow: getAlertGroupRow(alertRow)
    }))
    .filter((alertRow) => {
      const groupId = getAlertGroupId(alertRow);
      return !!alertRow._groupRow && scopedIds.has(groupId);
    })
    .sort((a, b) => {
      const diffFecha =
        (timestampLikeToDate(b.fechaCreacion)?.getTime() || 0) -
        (timestampLikeToDate(a.fechaCreacion)?.getTime() || 0);

      if (diffFecha !== 0) return diffFecha;

      const aliasA = getAliasColegioSortKey(getRowAlias(a._groupRow || {}));
      const aliasB = getAliasColegioSortKey(getRowAlias(b._groupRow || {}));

      return aliasA.localeCompare(aliasB, "es", {
        sensitivity: "base",
        numeric: true
      });
    });
}

function getCriticalAlertsForScope(rows = []) {
  return getAlertsForScope(rows, isCriticalIndexAlert);
}

function getWarningAlertsForScope(rows = []) {
  return getAlertsForScope(rows, isWarningIndexAlert);
}

function getAlertasCriticasSubtitulo(user = null) {
  const effectiveUser = user || getEffectiveUser();
  if (!effectiveUser) {
    return "Listado de alertas críticas activas en la vista actual.";
  }

  if (isVendedorRole(effectiveUser)) {
    return "Aquí ves solo las alertas críticas activas de tus grupos.";
  }

  return "Aquí ves las alertas críticas activas según la vista actual del dashboard.";
}

function getAlertasWarningSubtitulo(user = null) {
  const effectiveUser = user || getEffectiveUser();
  if (!effectiveUser) {
    return "Listado de alertas pendientes activas en la vista actual.";
  }

  if (isVendedorRole(effectiveUser)) {
    return "Aquí ves solo las alertas pendientes activas de tus grupos.";
  }

  return "Aquí ves las alertas pendientes activas según la vista actual del dashboard.";
}

function renderAlertCardsHtml(rows = [], fallbackTitle = "Alerta") {
  if (!rows.length) {
    return `
      <div style="padding:16px 18px; border:1px solid rgba(60,40,90,.10); border-radius:16px; background:#faf8fd; color:#5d546d;">
        No hay alertas activas en esta categoría.
      </div>
    `;
  }

  return rows.map((alertRow) => {
    const groupRow = alertRow._groupRow || getAlertGroupRow(alertRow) || {};
    const idGrupo = getAlertGroupId(alertRow);
    const alias = getRowAlias(groupRow) || alertRow.aliasGrupo || `Grupo ${idGrupo}`;
    const vendedor = getRowVendorName(groupRow) || groupRow.vendedoraCorreo || "Sin vendedor";
    const creadoPor = String(alertRow.creadoPor || alertRow.creadoPorCorreo || "Sin autor").trim() || "Sin autor";
    const fecha = formatAlertDate(alertRow.fechaCreacion);
    const titulo = String(alertRow.titulo || fallbackTitle).trim();
    const mensaje = String(alertRow.mensaje || "Sin detalle").trim();

    return `
      <div style="padding:14px 16px; border:1px solid rgba(60,40,90,.12); border-radius:16px; background:#fff; display:flex; justify-content:space-between; gap:14px; align-items:flex-start;">
        <div style="min-width:0;">
          <div style="font-weight:800; color:#31194b; font-size:16px; line-height:1.2;">
            ${escapeHtml(alias)}
          </div>

          <div style="margin-top:6px; color:#6a6078; font-size:13px; line-height:1.45;">
            Vendedor(a): ${escapeHtml(vendedor)}<br>
            Título: ${escapeHtml(titulo)}<br>
            Creada por: ${escapeHtml(creadoPor)}<br>
            Fecha: ${escapeHtml(fecha)}
          </div>

          <div style="margin-top:10px; color:#3e3550; font-size:14px; line-height:1.5;">
            ${escapeHtml(mensaje)}
          </div>
        </div>

        <a
          href="grupo.html?id=${encodeURIComponent(idGrupo)}"
          target="_blank"
          rel="noopener"
          style="flex:0 0 auto; text-decoration:none; background:#3b2357; color:#fff; border-radius:999px; padding:10px 14px; font-weight:700; white-space:nowrap;"
        >
          Abrir grupo
        </a>
      </div>
    `;
  }).join("");
}

function renderAlertasCriticasModal(rows = [], effectiveUser = null) {
  const titleEl = $("alertas-criticas-titulo");
  const subtitleEl = $("alertas-criticas-subtitulo");
  const summaryEl = $("alertas-criticas-resumen");
  const listEl = $("alertas-criticas-lista");

  if (!titleEl || !subtitleEl || !summaryEl || !listEl) return;

  titleEl.textContent = "Alertas críticas";
  subtitleEl.textContent = getAlertasCriticasSubtitulo(effectiveUser);
  summaryEl.textContent = rows.length
    ? `Hay ${rows.length} alerta(s) crítica(s) activa(s) en tu vista actual.`
    : "No hay alertas críticas activas en esta vista.";

  listEl.innerHTML = renderAlertCardsHtml(rows, "Alerta crítica");
}

function renderAlertasWarningModal(rows = [], effectiveUser = null) {
  const titleEl = $("alertas-warning-titulo");
  const subtitleEl = $("alertas-warning-subtitulo");
  const summaryEl = $("alertas-warning-resumen");
  const listEl = $("alertas-warning-lista");

  if (!titleEl || !subtitleEl || !summaryEl || !listEl) return;

  titleEl.textContent = "Alertas pendientes";
  subtitleEl.textContent = getAlertasWarningSubtitulo(effectiveUser);
  summaryEl.textContent = rows.length
    ? `Hay ${rows.length} alerta(s) pendiente(s) activa(s) en tu vista actual.`
    : "No hay alertas pendientes activas en esta vista.";

  listEl.innerHTML = renderAlertCardsHtml(rows, "Alerta pendiente");
}

function openAlertasCriticasModal() {
  const dialog = $("modal-alertas-criticas");
  if (!dialog) return;

  const effectiveUser = getEffectiveUser();
  const rows = Array.isArray(state.alertasCriticasRows) ? state.alertasCriticasRows : [];

  renderAlertasCriticasModal(rows, effectiveUser);

  if (typeof dialog.showModal === "function") {
    if (!dialog.open) dialog.showModal();
    return;
  }

  dialog.setAttribute("open", "open");
}

function closeAlertasCriticasModal() {
  const dialog = $("modal-alertas-criticas");
  if (!dialog) return;

  if (typeof dialog.close === "function") {
    dialog.close();
    return;
  }

  dialog.removeAttribute("open");
}

function openAlertasWarningModal() {
  const dialog = $("modal-alertas-warning");
  if (!dialog) return;

  const effectiveUser = getEffectiveUser();
  const rows = Array.isArray(state.alertasWarningRows) ? state.alertasWarningRows : [];

  renderAlertasWarningModal(rows, effectiveUser);

  if (typeof dialog.showModal === "function") {
    if (!dialog.open) dialog.showModal();
    return;
  }

  dialog.setAttribute("open", "open");
}

function closeAlertasWarningModal() {
  const dialog = $("modal-alertas-warning");
  if (!dialog) return;

  if (typeof dialog.close === "function") {
    dialog.close();
    return;
  }

  dialog.removeAttribute("open");
}

/* =========================================================
   ALERTAS DE INSCRIPCIONES
========================================================= */

function esAlertaInscripcionActivaDashboard(
  item = {}
) {
  const estadoViaje =
    normalizeLoose(
      item.estadoViaje || ""
    );

  return (
    item.activa !== false &&
    item.resuelta !== true &&
    item.anulado !== true &&
    item.viaja !== false &&
    estadoViaje !== "no_viaja"
  );
}

function esInscripcionNuevoIngresoPendiente(
  item = {}
) {
  return (
    esAlertaInscripcionActivaDashboard(
      item
    ) &&
    item.tipoAlerta ===
      "nuevo_ingreso_pendiente"
  );
}

function esInscripcionListaEsperaPendiente(
  item = {}
) {
  return (
    esAlertaInscripcionActivaDashboard(
      item
    ) &&
    item.tipoAlerta ===
      "lista_espera_pendiente"
  );
}

function esListaEsperaPagadaPendienteConfirmar(
  item = {}
) {
  return (
    esAlertaInscripcionActivaDashboard(
      item
    ) &&
    item.tipoAlerta ===
      "lista_espera_pagada_pendiente_confirmar"
  );
}

function getInscripcionFechaDashboard(item = {}) {
  return (
    item.fechaFormulario ||
    item.creadaAt ||
    item.creadoAt ||
    item.actualizadoAt ||
    ""
  );
}

function getInscripcionNombreDashboard(item = {}) {
  return String(
    item.nombreParticipante ||
    item.nombreCompleto ||
    "Sin nombre"
  ).trim();
}

function getInscripcionResponsableDashboard(item = {}) {
  return String(
    item.nombreResponsable ||
    item.responsable ||
    "Sin responsable"
  ).trim();
}

function getInscripcionCorreoDashboard(item = {}) {
  return String(
    item.correoResponsable ||
    item.emailResponsable ||
    ""
  ).trim();
}

function getInscripcionTelefonoDashboard(item = {}) {
  return String(
    item.telefonoResponsable ||
    item.celularResponsable ||
    ""
  ).trim();
}

function getGrupoIdAlertaInscripcion(item = {}) {
  return String(
    item.idGrupo ||
    item.groupDocId ||
    ""
  ).trim();
}

function getGrupoAlertaInscripcion(item = {}) {
  const idGrupo = String(item.idGrupo || "").trim();
  const groupDocId = String(item.groupDocId || "").trim();

  return (
    state.rows.find((row) => {
      const rowId = String(getRowId(row) || "").trim();
      const rowDocId = String(row.id || "").trim();

      return (
        (idGrupo && rowId === idGrupo) ||
        (groupDocId && rowDocId === groupDocId) ||
        (groupDocId && rowId === groupDocId)
      );
    }) || null
  );
}

function sortInscripcionesDashboard(rows = []) {
  return [...rows].sort((a, b) => {
    const grupoA = normalizeLoose(
      a.aliasGrupo ||
      a.colegio ||
      getGrupoAlertaInscripcion(a)?.aliasGrupo ||
      ""
    );

    const grupoB = normalizeLoose(
      b.aliasGrupo ||
      b.colegio ||
      getGrupoAlertaInscripcion(b)?.aliasGrupo ||
      ""
    );

    const porGrupo = grupoA.localeCompare(grupoB, "es", {
      sensitivity: "base",
      numeric: true
    });

    if (porGrupo !== 0) return porGrupo;

    const fechaA =
      timestampLikeToDate(getInscripcionFechaDashboard(a))?.getTime() || 0;

    const fechaB =
      timestampLikeToDate(getInscripcionFechaDashboard(b))?.getTime() || 0;

    return fechaB - fechaA;
  });
}

function formatFechaInscripcionDashboard(value) {
  const fecha = timestampLikeToDate(value);

  if (!fecha) return "Sin fecha";

  return fecha.toLocaleString("es-CL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

function renderInscripcionesDashboardCards(rows = []) {
  if (!rows.length) {
    return `
      <div
        style="
          padding:16px 18px;
          border:1px solid rgba(60,40,90,.10);
          border-radius:16px;
          background:#faf8fd;
          color:#5d546d;
        "
      >
        No hay inscripciones para mostrar.
      </div>
    `;
  }

  return rows.map((item) => {
    const grupoRow = getGrupoAlertaInscripcion(item) || {};

    const idGrupo =
      String(grupoRow.idGrupo || grupoRow.id || "").trim() ||
      getGrupoIdAlertaInscripcion(item);

    const aliasGrupo =
      item.aliasGrupo ||
      grupoRow.aliasGrupo ||
      grupoRow.nombreGrupo ||
      grupoRow.colegio ||
      idGrupo ||
      "Sin grupo";

    const vendedor =
      item.vendedora ||
      grupoRow.vendedora ||
      item.vendedoraCorreo ||
      grupoRow.vendedoraCorreo ||
      "Sin vendedor";

    return `
      <div
        data-inscripcion-alerta-card
        data-search-text="${escapeHtml(
          normalizeLoose([
            getInscripcionNombreDashboard(item),
            aliasGrupo,
            vendedor,
            getInscripcionResponsableDashboard(item),
            getInscripcionCorreoDashboard(item),
            getInscripcionTelefonoDashboard(item),
            item.documento || "",
            item.estadoCupo || ""
          ].join(" "))
        )}"
        style="
          padding:14px 16px;
          border:1px solid rgba(60,40,90,.12);
          border-radius:16px;
          background:#fff;
          display:flex;
          justify-content:space-between;
          gap:14px;
          align-items:flex-start;
        "
      >
        <div style="min-width:0;">
          <div
            style="
              font-weight:800;
              color:#31194b;
              font-size:16px;
              line-height:1.2;
            "
          >
            ${escapeHtml(getInscripcionNombreDashboard(item))}
          </div>

          <div
            style="
              margin-top:6px;
              color:#6a6078;
              font-size:13px;
              line-height:1.45;
            "
          >
            Grupo: ${escapeHtml(aliasGrupo)}<br>
            Año: ${escapeHtml(item.anoViaje || grupoRow.anoViaje || "Sin año")} ·
            Curso: ${escapeHtml(item.curso || grupoRow.curso || "Sin curso")}<br>
            Vendedor(a): ${escapeHtml(vendedor)}<br>
            Responsable: ${escapeHtml(getInscripcionResponsableDashboard(item))}<br>
            Correo: ${escapeHtml(getInscripcionCorreoDashboard(item) || "Sin correo")}<br>
            Teléfono: ${escapeHtml(getInscripcionTelefonoDashboard(item) || "Sin teléfono")}<br>
            Fecha formulario:
            ${escapeHtml(
              formatFechaInscripcionDashboard(
                getInscripcionFechaDashboard(item)
              )
            )}<br>
            Estado cupo: ${escapeHtml(item.estadoCupo || "Sin estado")}
          </div>
        </div>

        <a
          href="grupo.html?id=${encodeURIComponent(idGrupo)}"
          target="_blank"
          rel="noopener"
          style="
            flex:0 0 auto;
            text-decoration:none;
            background:#3b2357;
            color:#fff;
            border-radius:999px;
            padding:10px 14px;
            font-weight:700;
            white-space:nowrap;
          "
        >
          Abrir grupo
        </a>
      </div>
    `;
  }).join("");
}

function getConfiguracionModalInscripcion(tipo = "") {
  if (tipo === "nuevo_ingreso") {
    return {
      titulo: "Inscripción Nuevo Ingreso",
      subtitulo: "Formularios de nuevo ingreso pendientes de confirmación.",
      rows: state.inscripcionNuevoIngresoRows
    };
  }

  if (tipo === "lista_espera") {
    return {
      titulo: "Inscripción Lista de Espera",
      subtitulo: "Formularios de lista de espera pendientes de pago.",
      rows: state.inscripcionListaEsperaRows
    };
  }

  if (tipo === "lista_espera_pagada") {
    return {
      titulo: "Lista de Espera pendiente por confirmar",
      subtitulo: "Listas de espera pagadas que todavía deben confirmarse.",
      rows: state.listaEsperaPagadaRows
    };
  }

  return {
    titulo: "Inscripciones",
    subtitulo: "Alertas de inscripción.",
    rows: []
  };
}

function pintarListadoAlertasInscripciones(rows = []) {
  const lista = $("alertas-inscripciones-lista");
  const resumen = $("alertas-inscripciones-resumen");

  if (!lista || !resumen) return;

  resumen.textContent = rows.length
    ? `Hay ${rows.length} inscripción(es) en este listado.`
    : "No hay inscripciones pendientes en este listado.";

  lista.innerHTML = renderInscripcionesDashboardCards(rows);
}

function openAlertasInscripcionesModal(tipo = "") {
  const dialog = $("modal-alertas-inscripciones");
  if (!dialog) return;

  const config = getConfiguracionModalInscripcion(tipo);

  dialog.dataset.tipoInscripcion = tipo;

  const titulo = $("alertas-inscripciones-titulo");
  const subtitulo = $("alertas-inscripciones-subtitulo");
  const buscador = $("alertas-inscripciones-buscador");

  if (titulo) titulo.textContent = config.titulo;
  if (subtitulo) subtitulo.textContent = config.subtitulo;
  if (buscador) buscador.value = "";

  pintarListadoAlertasInscripciones(config.rows || []);

  if (typeof dialog.showModal === "function") {
    if (!dialog.open) dialog.showModal();
  } else {
    dialog.setAttribute("open", "open");
  }
}

function closeAlertasInscripcionesModal() {
  const dialog = $("modal-alertas-inscripciones");
  if (!dialog) return;

  if (typeof dialog.close === "function") {
    dialog.close();
  } else {
    dialog.removeAttribute("open");
  }
}

function filtrarModalAlertasInscripciones() {
  const dialog = $("modal-alertas-inscripciones");
  const buscador = $("alertas-inscripciones-buscador");

  if (!dialog || !buscador) return;

  const tipo = dialog.dataset.tipoInscripcion || "";
  const config = getConfiguracionModalInscripcion(tipo);
  const q = normalizeLoose(buscador.value || "");

  const rows = q
    ? (config.rows || []).filter((item) => {
        const grupoRow = getGrupoAlertaInscripcion(item) || {};

        const texto = normalizeLoose([
          getInscripcionNombreDashboard(item),
          item.aliasGrupo,
          item.colegio,
          grupoRow.aliasGrupo,
          grupoRow.nombreGrupo,
          grupoRow.colegio,
          item.vendedora,
          item.vendedoraCorreo,
          grupoRow.vendedora,
          grupoRow.vendedoraCorreo,
          getInscripcionResponsableDashboard(item),
          getInscripcionCorreoDashboard(item),
          getInscripcionTelefonoDashboard(item),
          item.documento,
          item.estadoCupo
        ].join(" "));

        return texto.includes(q);
      })
    : config.rows || [];

  pintarListadoAlertasInscripciones(rows);
}

/* =========================================================
   CARGA DE DATOS
========================================================= */
function getDashboardResumenScopeKey() {
  const effectiveUser =
    getEffectiveUser();

  if (!effectiveUser) {
    return "general";
  }

  const vendorEmail =
    isVendedorRole(effectiveUser)
      ? normalizeEmail(effectiveUser.email || "")
      : normalizeEmail(
          getVendorFilter(effectiveUser) || ""
        );

  if (!vendorEmail) {
    return "general";
  }

  const safeEmail =
    vendorEmail
      .replace(/[^a-z0-9]+/gi, "_")
      .replace(/^_+|_+$/g, "")
      .toLowerCase();

  return `vendor_${safeEmail}`;
}

function getIndexGruposCacheKey(ano) {
  return (
    INDEX_GRUPOS_CACHE_PREFIX +
    String(ano)
  );
}

function getIndexAlertasCacheKey() {
  return (
    INDEX_ALERTAS_CACHE_PREFIX +
    getDashboardResumenScopeKey()
  );
}

function guardarCacheIndex(
  key,
  data
) {
  try {
    sessionStorage.setItem(
      key,
      JSON.stringify({
        guardadoAt:
          Date.now(),

        data
      })
    );
  } catch (error) {
    console.warn(
      "[INDEX] No se pudo guardar caché:",
      error
    );
  }
}

function leerCacheIndex(
  key
) {
  try {
    const raw =
      sessionStorage.getItem(
        key
      );

    if (!raw) {
      return null;
    }

    const parsed =
      JSON.parse(raw);

    const guardadoAt =
      Number(
        parsed?.guardadoAt || 0
      );

    if (
      !guardadoAt ||
      Date.now() - guardadoAt >
        INDEX_CACHE_TTL_MS
    ) {
      sessionStorage.removeItem(
        key
      );

      return null;
    }

    return (
      parsed?.data ??
      null
    );
  } catch (error) {
    console.warn(
      "[INDEX] Caché inválida:",
      error
    );

    return null;
  }
}

function mapGrupoResumenIndex(
  docId,
  data = {}
) {
  return {
    id:
      docId,

    idGrupo:
      data.idGrupo ||
      data.groupDocId ||
      docId,

    ...data
  };
}

function reconstruirRowsIndex() {
  const anos =
    getAnosActivosIndex();

  state.rows =
    anos.flatMap(
      (ano) =>
        state.rowsPorAno.get(
          String(ano)
        ) || []
    );

  state.rowsById =
    new Map(
      state.rows.map(
        (row) => [
          getRowId(row),
          row
        ]
      )
    );
}

async function consultarGruposResumenAno(
  ano
) {
  const anoNumero =
    Number(ano);

  const inicio =
    performance.now();

  const snap =
    await getDocs(
      query(
        collection(
          db,
          GRUPOS_RESUMEN_COLLECTION
        ),

        where(
          "anoViaje",
          "==",
          anoNumero
        )
      )
    );

  const rows =
    snap.docs.map(
      (docSnap) =>
        mapGrupoResumenIndex(
          docSnap.id,
          docSnap.data() || {}
        )
    );

  console.log(
    "[INDEX] Grupos resumen cargados",
    {
      ano:
        anoNumero,

      documentos:
        snap.size,

      duracionMs:
        Math.round(
          performance.now() -
          inicio
        )
    }
  );

  return rows;
}

async function cargarGruposIndexAno(
  ano,
  {
    forzar = false
  } = {}
) {
  const anoTexto =
    String(ano);

  const inicio =
    performance.now();

  if (
    !forzar &&
    state.rowsPorAno.has(
      anoTexto
    )
  ) {
    const rows =
      state.rowsPorAno.get(
        anoTexto
      ) || [];

    logRendimientoIndex(
      "GRUPOS_AÑO",
      {
        ano:
          Number(anoTexto),

        origen:
          "memoria",

        documentos:
          rows.length,

        duracionMs:
          Math.round(
            performance.now() -
            inicio
          )
      }
    );

    return {
      origen:
        "memoria",

      rows
    };
  }

  if (!forzar) {
    const cache =
      leerCacheIndex(
        getIndexGruposCacheKey(
          anoTexto
        )
      );

    if (
      Array.isArray(cache)
    ) {
      state.rowsPorAno.set(
        anoTexto,
        cache
      );

      state.anosCargados.add(
        anoTexto
      );

      reconstruirRowsIndex();

      logRendimientoIndex(
        "GRUPOS_AÑO",
        {
          ano:
            Number(anoTexto),

          origen:
            "sessionStorage",

          documentos:
            cache.length,

          duracionMs:
            Math.round(
              performance.now() -
              inicio
            )
        }
      );

      return {
        origen:
          "sessionStorage",

        rows:
          cache
      };
    }
  }

  const rows =
    await consultarGruposResumenAno(
      anoTexto
    );

  state.rowsPorAno.set(
    anoTexto,
    rows
  );

  state.anosCargados.add(
    anoTexto
  );

  guardarCacheIndex(
    getIndexGruposCacheKey(
      anoTexto
    ),
    rows
  );

  reconstruirRowsIndex();

  logRendimientoIndex(
    "GRUPOS_AÑO",
    {
      ano:
        Number(anoTexto),

      origen:
        "firestore",

      documentos:
        rows.length,

      duracionMs:
        Math.round(
          performance.now() -
          inicio
        )
    }
  );

  return {
    origen:
      "firestore",

    rows
  };
}

function getResumenNumber(
  resumen = {},
  key = ""
) {
  return Number(
    resumen?.[key] || 0
  );
}

function pintarResumenAlertasIndex(
  resumen = {}
) {
  setContadorAlertaIndex(
    "count-sin-asignar",
    getResumenNumber(
      resumen,
      "sinAsignar"
    )
  );

  setContadorAlertaIndex(
    "count-a-contactar",
    getResumenNumber(
      resumen,
      "aContactar"
    )
  );

  setContadorAlertaIndex(
    "count-fichas-firmar",
    getResumenNumber(
      resumen,
      "fichasPorFirmar"
    )
  );

  setContadorAlertaIndex(
    "count-fichas-corregidas",
    getResumenNumber(
      resumen,
      "fichasCorregidas"
    )
  );

  setContadorAlertaIndex(
    "count-solicitudes-actualizacion",
    getResumenNumber(
      resumen,
      "solicitudesActualizacion"
    )
  );

  setContadorAlertaIndex(
    "count-alertas-criticas",
    getResumenNumber(
      resumen,
      "alertasCriticas"
    )
  );

  setContadorAlertaIndex(
    "count-alertas-warning",
    getResumenNumber(
      resumen,
      "alertasWarning"
    )
  );

  setContadorAlertaIndex(
    "count-inscripcion-nuevo-ingreso",
    getResumenNumber(
      resumen,
      "nuevoIngresoPendiente"
    )
  );

  setContadorAlertaIndex(
    "count-inscripcion-lista-espera",
    getResumenNumber(
      resumen,
      "listaEsperaPendiente"
    )
  );

  setContadorAlertaIndex(
    "count-lista-espera-pagada",
    getResumenNumber(
      resumen,
      "listaEsperaPagadaPendienteConfirmar"
    )
  );

  setContadorAlertaIndex(
    "count-reunion-3dias",
    getResumenNumber(
      resumen,
      "reunionesProximosTresDias"
    )
  );

  setSinAsignarManagementHref();

  syncAlertRowsByRole(
    getDashboardViewUser(
      getEffectiveUser()
    )
  );
}

async function cargarResumenAlertasIndex() {
  const cacheKey =
    getIndexAlertasCacheKey();

  const cache =
    leerCacheIndex(
      cacheKey
    );

  /*
    Primero se pinta la caché.
    Esto ocurre prácticamente de inmediato.
  */
  if (
    cache &&
    typeof cache === "object"
  ) {
    state.dashboardResumen =
      cache;

    pintarResumenAlertasIndex(
      cache
    );
  }

  try {
    const scopeKey =
      getDashboardResumenScopeKey();

    const snap =
      await getDoc(
        doc(
          db,
          DASHBOARD_RESUMEN_COLLECTION,
          scopeKey
        )
      );

    if (!snap.exists()) {
      console.warn(
        `[INDEX] No existe el resumen ${scopeKey}. Se usarán los cálculos normales.`
      );

      return null;
    }

    const resumen =
      snap.data() || {};

    state.dashboardResumen =
      resumen;

    guardarCacheIndex(
      cacheKey,
      resumen
    );

    pintarResumenAlertasIndex(
      resumen
    );

    console.log(
      "[INDEX] Resumen de alertas cargado",
      {
        scope:
          scopeKey
      }
    );

    return resumen;
  } catch (error) {
    console.warn(
      "[INDEX] No se pudo cargar resumen de alertas:",
      error
    );

    return null;
  }
}

function actualizarExperienciaPrincipalIndex({
  renderizarDashboardCompleto = false
} = {}) {
  const effectiveUser =
    getEffectiveUser();

  if (!effectiveUser) {
    return;
  }

  const rowsScope =
    getRowsForCurrentScope(
      effectiveUser
    );

  poblarSelectorVendedores(
    effectiveUser
  );

  poblarSelectorGruposComerciales(
    effectiveUser,
    rowsScope
  );
  
  poblarSelectorGruposAdministrativos(
    rowsScope
  );

  /*
    El buscador usa estos grupos,
    pero no necesariamente recalculamos
    todas las alertas todavía.
  */
  state.scopedRows =
    rowsScope;

  initBuscadorDashboard();

  if (
    renderizarDashboardCompleto
  ) {
    renderDashboard(
      rowsScope
    );
  }
}

async function consultarColeccionAuxiliarIndex(
  nombre = "",
  crearConsulta
) {
  const inicio =
    performance.now();

  const snap =
    await crearConsulta();

  logRendimientoIndex(
    "CONSULTA_AUXILIAR",
    {
      coleccion:
        nombre,

      documentos:
        snap.size,

      duracionMs:
        Math.round(
          performance.now() -
          inicio
        )
    }
  );

  return snap;
}

async function loadDashboardAuxData() {
  if (
    state.promiseDatosAuxiliares
  ) {
    return state.promiseDatosAuxiliares;
  }

  state.promiseDatosAuxiliares =
    (async () => {
      const inicio =
        performance.now();

      const [
        alertsSnap,
        solicitudesSnap,
        alertasInscripcionesSnap
      ] = await Promise.all([
        consultarColeccionAuxiliarIndex(
          ALERTAS_COLLECTION,
          () =>
            getDocs(
              collection(
                db,
                ALERTAS_COLLECTION
              )
            )
        ),

        consultarColeccionAuxiliarIndex(
          SOLICITUDES_COLLECTION,
          () =>
            getDocs(
              collection(
                db,
                SOLICITUDES_COLLECTION
              )
            )
        ),

        consultarColeccionAuxiliarIndex(
          ALERTAS_INSCRIPCIONES_COLLECTION,
          () =>
            getDocs(
              query(
                collection(
                  db,
                  ALERTAS_INSCRIPCIONES_COLLECTION
                ),

                where(
                  "activa",
                  "==",
                  true
                )
              )
            )
        )
      ]);

      const inicioProcesamiento =
        performance.now();

      state.alertRows =
        alertsSnap.docs.map(
          (docSnap) => ({
            id:
              docSnap.id,

            ...docSnap.data()
          })
        );

      state.solicitudesRows =
        solicitudesSnap.docs.map(
          (docSnap) => ({
            id:
              docSnap.id,

            ...docSnap.data()
          })
        );

      state.inscripcionesRows =
        alertasInscripcionesSnap.docs.map(
          (docSnap) => ({
            id:
              docSnap.id,

            ...docSnap.data()
          })
        );

      state.datosAuxiliaresCargados =
        true;

      logRendimientoIndex(
        "AUXILIARES_LISTOS",
        {
          alertas:
            state.alertRows.length,

          solicitudes:
            state.solicitudesRows.length,

          inscripciones:
            state.inscripcionesRows.length,

          procesamientoMs:
            Math.round(
              performance.now() -
              inicioProcesamiento
            ),

          duracionTotalMs:
            Math.round(
              performance.now() -
              inicio
            )
        }
      );

      return true;
    })()
      .catch((error) => {
        state.promiseDatosAuxiliares =
          null;

        throw error;
      });

  return state.promiseDatosAuxiliares;
}

async function asegurarDetallesDashboardCargados() {
  try {
    await loadDashboardAuxData();

    const effectiveUser =
      getEffectiveUser();

    if (!effectiveUser) {
      return;
    }

    const rowsScope =
      getRowsForCurrentScope(
        effectiveUser
      );

    renderDashboard(
      rowsScope
    );
  } catch (error) {
    console.error(
      "[INDEX] No se pudieron preparar los detalles del dashboard:",
      error
    );

    throw error;
  }
}

function mostrarEstadoSelectorComercial(
  mensaje = "Cargando grupos comerciales...",
  {
    deshabilitado = true
  } = {}
) {
  const select =
    $("select-grupo-comercial");

  if (!select) {
    return;
  }

  /*
    Primero elimina cualquier Tom Select anterior.
  */
  destroySearchableSelect(
    "select-grupo-comercial"
  );

  /*
    Durante la carga dejamos solamente el select nativo.

    No creamos Tom Select todavía, porque después
    podría restaurar esta opción antigua al destruirse.
  */
  select.innerHTML = "";

  const option =
    document.createElement(
      "option"
    );

  option.value = "";
  option.textContent = mensaje;
  option.selected = true;

  select.appendChild(
    option
  );

  select.value = "";
  select.disabled = deshabilitado;
}

async function cargarAnosFuturosIndex() {
  const anoActual =
    getAnoPrioritarioIndex();

  const anosFuturos =
    getAnosActivosIndex()
      .filter(
        (ano) =>
          ano !== anoActual
      );

  const resultados =
    await Promise.all(
      anosFuturos.map(
        async (ano) => {
          const resultado =
            await cargarGruposIndexAno(
              ano
            );

          return {
            ano,
            origen:
              resultado?.origen || "",
            grupos:
              Array.isArray(
                resultado?.rows
              )
                ? resultado.rows.length
                : 0
          };
        }
      )
    );

  /*
    Une nuevamente año actual y años futuros
    dentro de state.rows.
  */
  reconstruirRowsIndex();

  logRendimientoIndex(
    "AÑOS_FUTUROS_LISTOS",
    {
      anos:
        resultados,

      gruposTotales:
        state.rows.length
    }
  );

  return resultados;
}

async function loadDashboardData() {
  const anoActual =
    getAnoPrioritarioIndex();

  const inicioTotal =
    performance.now();

  /*
    Mostramos de inmediato que el selector comercial
    todavía está cargando sus años futuros.
  */
  mostrarEstadoSelectorComercial(
    "Cargando grupos comerciales..."
  );

  /*
    Todas las consultas comienzan en paralelo.
  */
  const promiseResumen =
    cargarResumenAlertasIndex();

  const promiseAnoActual =
    cargarGruposIndexAno(
      anoActual
    );

  const promiseAnosFuturos =
    cargarAnosFuturosIndex();

  const promiseAuxiliares =
    loadDashboardAuxData();

  /*
    Primero esperamos el año actual para dejar disponible
    rápidamente el selector administrativo.
  */
  const resultadoAnoActual =
    await promiseAnoActual;

  reconstruirRowsIndex();

  actualizarExperienciaPrincipalIndex({
    renderizarDashboardCompleto:
      false
  });

  console.log(
    "[INDEX] Año actual disponible",
    {
      ano:
        anoActual,

      origen:
        resultadoAnoActual?.origen ||
        "",

      grupos:
        Array.isArray(
          resultadoAnoActual?.rows
        )
          ? resultadoAnoActual.rows.length
          : 0,

      desdeInicioMs:
        Math.round(
          performance.now() -
          inicioTotal
        )
    }
  );

  /*
    Si el año actual salió desde sessionStorage,
    se actualiza desde Firestore en segundo plano.
  */
  if (
    resultadoAnoActual?.origen ===
    "sessionStorage"
  ) {
    cargarGruposIndexAno(
      anoActual,
      {
        forzar:
          true
      }
    )
      .then(() => {
        reconstruirRowsIndex();

        actualizarExperienciaPrincipalIndex({
          renderizarDashboardCompleto:
            state.datosAuxiliaresCargados
        });
      })
      .catch((error) => {
        console.warn(
          "[INDEX] No se pudo refrescar el año actual:",
          error
        );
      });
  }

  /*
    IMPORTANTE:

    Ahora sí esperamos explícitamente los años futuros.

    Esto garantiza que el selector comercial se reconstruya
    durante la primera carga y no solamente después
    de actualizar la página.
  */
  try {
    const resultadosFuturos =
      await promiseAnosFuturos;

    reconstruirRowsIndex();

    actualizarExperienciaPrincipalIndex({
      renderizarDashboardCompleto:
        false
    });

    console.log(
      "[INDEX] Años futuros disponibles",
      {
        resultados:
          resultadosFuturos,

        gruposTotales:
          state.rows.length,

        desdeInicioMs:
          Math.round(
            performance.now() -
            inicioTotal
          )
      }
    );
  } catch (error) {
    console.warn(
      "[INDEX] No se pudieron cargar los años futuros:",
      error
    );

    mostrarEstadoSelectorComercial(
      "No se pudieron cargar los grupos comerciales"
    );
  }

  /*
    Las alertas y solicitudes se estaban cargando
    paralelamente. Ahora esperamos su resultado.
  */
  await promiseAuxiliares;

  const effectiveUser =
    getEffectiveUser();

  if (!effectiveUser) {
    return;
  }

  const rowsScope =
    getRowsForCurrentScope(
      effectiveUser
    );

  /*
    Render final del dashboard.
    En este punto ya tenemos:
    - año actual;
    - años futuros;
    - datos auxiliares.
  */
  actualizarExperienciaPrincipalIndex({
    renderizarDashboardCompleto:
      true
  });

  console.log(
    "[INDEX] Dashboard completo disponible",
    {
      gruposScope:
        rowsScope.length,

      alertas:
        state.alertRows.length,

      solicitudes:
        state.solicitudesRows.length,

      inscripciones:
        state.inscripcionesRows.length,

      duracionTotalMs:
        Math.round(
          performance.now() -
          inicioTotal
        )
    }
  );

  /*
    El resumen rápido no debe bloquear
    el funcionamiento del dashboard.
  */
  promiseResumen.catch(
    (error) => {
      console.warn(
        "[INDEX] No se pudo cargar el resumen rápido:",
        error
      );
    }
  );
}

/* =========================================================
   DASHBOARD BASE
========================================================= */
function getYearBucketCounts(rows = []) {
  const baseYear =
    getAnoPrioritarioIndex();

  const years = [
    baseYear,
    baseYear + 1,
    baseYear + 2
  ];

  const counts = [
    0,
    0,
    0
  ];

  rows.forEach((row) => {
    const year =
      getAnoViajeNumber(row);

    const index =
      years.indexOf(year);

    if (index >= 0) {
      counts[index] += 1;
    }
  });

  return {
    years,
    counts,
    total:
      rows.length
  };
}

function getDashboardVendorScope() {
  const effectiveUser = getEffectiveUser();
  if (!effectiveUser) return "";

  // Si el usuario efectivo es vendedor, el scope es su propio correo
  if (isVendedorRole(effectiveUser)) {
    return normalizeEmail(effectiveUser.email || "");
  }

  // Si es supervisión / registro / admin, usar el vendedor seleccionado en el dashboard
  return normalizeEmail(getVendorFilter(effectiveUser) || "");
}

function buildSeguimientoUrl({ bucket = "", ano = "", archivados = false } = {}) {
  const url = new URL("seguimiento.html", window.location.href);
  const vendor = getDashboardVendorScope();

  if (bucket) url.searchParams.set("dashboardBucket", String(bucket));
  if (ano) url.searchParams.set("ano", String(ano));
  if (archivados) url.searchParams.set("archivados", "1");
  if (vendor) url.searchParams.set("vendor", vendor);

  return `${url.pathname}${url.search}`;
}

function renderFlowAnchor({ label = "00", bucket = "", ano = "", archivados = false } = {}) {
  const href = buildSeguimientoUrl({ bucket, ano, archivados });

  return `
    <a
      href="${href}"
      class="flow-number-link"
      style="color:inherit;text-decoration:none;"
    >${label}</a>
  `;
}

function setAlertCountLink(targetId, count = 0, bucket = "") {
  const el = $(targetId);
  if (!el) return;

  const href = buildSeguimientoUrl({
    bucket,
    archivados: true
  });

  el.innerHTML = `
    <a
      href="${href}"
      class="flow-number-link"
      style="color:inherit;text-decoration:none;"
    >${count}</a>
  `;
}

function setAlertHref(targetId, bucket = "") {
  const el = $(targetId);
  if (!el) return;

  el.href = buildSeguimientoUrl({
    bucket,
    archivados: true
  });
}

function setSinAsignarManagementHref() {
  const el = $("link-sin-asignar");
  if (!el) return;
  el.href = "asignados.html?tab=sin_asignar";
}

function renderBucketLinks(targetId, bucket, rows = []) {
  const el = $(targetId);
  if (!el) return;

  const { years, counts, total } = getYearBucketCounts(rows);

  const [link1, link2, link3] = counts.map((count, index) =>
    renderFlowAnchor({
      label: pad2(count),
      bucket,
      ano: years[index]
    })
  );

  const totalLink = renderFlowAnchor({
    label: pad2(total),
    bucket,
    archivados: true
  });

  el.innerHTML = `${link1} | ${link2} | ${link3} | (${totalLink})`;
}

function renderSingleTotalLink(targetId, bucket, count = 0) {
  const el = $(targetId);
  if (!el) return;

  el.innerHTML = renderFlowAnchor({
    label: pad2(count),
    bucket,
    archivados: true
  });
}

function inicializarDashboardEnCeros() {
  state.scopedRows = [];

  state.fichasPorFirmarRows = [];
  state.fichasCorregidasRows = [];
  state.alertasCriticasRows = [];
  state.alertasWarningRows = [];
  state.solicitudesActualizacionRows = [];

  state.inscripcionesRows = [];
  state.inscripcionNuevoIngresoRows = [];
  state.inscripcionListaEsperaRows = [];
  state.listaEsperaPagadaRows = [];

  setContadorAlertaIndex(
    "count-sin-asignar",
    0
  );
  
  setSinAsignarManagementHref();
  
  setContadorAlertaIndex(
    "count-a-contactar",
    0
  );
  
  setContadorAlertaIndex(
    "count-fichas-firmar",
    0
  );
  
  setContadorAlertaIndex(
    "count-fichas-corregidas",
    0
  );
  
  setContadorAlertaIndex(
    "count-solicitudes-actualizacion",
    0
  );
  
  setContadorAlertaIndex(
    "count-inscripcion-nuevo-ingreso",
    0
  );
  
  setContadorAlertaIndex(
    "count-inscripcion-lista-espera",
    0
  );
  
  setContadorAlertaIndex(
    "count-lista-espera-pagada",
    0
  );
  
  setContadorAlertaIndex(
    "count-alertas-criticas",
    0
  );
  
  setContadorAlertaIndex(
    "count-alertas-warning",
    0
  );
  
  setContadorAlertaIndex(
    "count-reunion-3dias",
    0
  );

  syncAlertRowsByRole(getEffectiveUser());

  renderBucketLinks("contactados-top", "contactados", []);
  renderBucketLinks("cotizando-top", "cotizando", []);
  renderBucketLinks("reunion-top", "reunion", []);
  renderBucketLinks("perdidas-top", "perdidas", []);
  renderBucketLinks("recotizando-top", "recotizando", []);
  renderBucketLinks("ganadas-top", "ganadas", []);

  renderFichaAdminBucketLinks("abiertas-top", "abiertas", []);
  renderFichaAdminBucketLinks("cerradas-top", "cerradas", []);
  renderFichaAdminBucketLinks("autorizadas-top", "autorizadas", []);
}

function getDashboardViewUser(effectiveUser = null) {
  const user = effectiveUser || getEffectiveUser();
  const vendorFilter = normalizeEmail(getVendorFilter(user) || "");

  if (!user || !vendorFilter || isVendedorRole(user)) return user;

  const vendedor = getVendorUsers().find(
    (v) => normalizeEmail(v.email) === vendorFilter
  );

  if (!vendedor) return user;

  return {
    ...vendedor,
    rol: "vendedor",
    email: normalizeEmail(vendedor.email)
  };
}

function renderDashboard(rows = []) {
  const inicioRenderDashboard =
    performance.now();

  const inicioDiagrama =
    performance.now();
  
  const effectiveUser = getEffectiveUser();
  const viewUser = getDashboardViewUser(effectiveUser);

  const scopedRows = dedupeRowsByGroup(rows);
  const allRows = dedupeRowsByGroup(state.rows);

  state.scopedRows = scopedRows;

  const contactados = getBucketRows(scopedRows, "contactados");
  const cotizando = getBucketRows(scopedRows, "cotizando");
  const reunion = getBucketRows(scopedRows, "reunion");
  const perdidas = getBucketRows(scopedRows, "perdidas");
  const recotizando = getBucketRows(scopedRows, "recotizando");
  const ganadas = getBucketRows(scopedRows, "ganadas");
  const autorizadas = getBucketRows(scopedRows, "autorizadas");
  const cerradas = getBucketRows(scopedRows, "cerradas");

  const finClasificacionDiagrama =
    performance.now();

  const inicioAlertas =
    performance.now();

  const fichasPorFirmar = getFichasPorFirmarSegunUsuario(scopedRows, viewUser);
  state.fichasPorFirmarRows = fichasPorFirmar;

  const fichasCorregidas = getFichasCorregidasSegunUsuario(scopedRows, viewUser);
  state.fichasCorregidasRows = fichasCorregidas;

  const ganadasScope = scopedRows.filter(isGanadaComercial);

  state.fichasAbiertasRows = ganadasScope
    .filter(isFichaAbiertaAdministrativa)
    .sort(sortRowsByAliasComparator);
  
  state.fichasCerradasRows = ganadasScope
    .filter(isFichaCerradaAdministrativa)
    .sort(sortRowsByAliasComparator);
  
  state.fichasAutorizadasRows = ganadasScope
    .filter(isFichaAutorizadaAdministrativa)
    .sort(sortRowsByAliasComparator);

  const solicitudesActualizacion = getSolicitudesActualizacionSegunUsuario(scopedRows, viewUser);
  state.solicitudesActualizacionRows = solicitudesActualizacion;
  
  const alertasCriticas = getCriticalAlertsForScope(scopedRows);
  state.alertasCriticasRows = alertasCriticas;
  
  const alertasWarning = getWarningAlertsForScope(scopedRows);
  state.alertasWarningRows = alertasWarning;

  const canSeeGlobalSinAsignar =
    isAdminDashboardRole(effectiveUser) ||
    isSupervisionDashboardRole(effectiveUser) ||
    isRegistroRole(effectiveUser);

  const sinAsignarRows = canSeeGlobalSinAsignar
    ? allRows.filter(isSinAsignar)
    : scopedRows.filter(isSinAsignar);

  const aContactarRows = scopedRows.filter(isAContactar);
  state.aContactarRows = aContactarRows;
  const reuniones3DiasRows = scopedRows.filter(isReunionEnProximosTresDias);

    /* =======================================================
     ALERTAS DE INSCRIPCIÓN SEGÚN VISTA / VENDEDOR
  ======================================================= */

  const scopedIdsInscripciones = new Set(
    scopedRows
      .map((row) => String(getRowId(row) || "").trim())
      .filter(Boolean)
  );

  const scopedDocIdsInscripciones = new Set(
    scopedRows
      .map((row) => String(row.id || "").trim())
      .filter(Boolean)
  );

  const inscripcionesScope = (state.inscripcionesRows || [])
    .filter((item) => {
      if (item.activa === false || item.resuelta === true) {
        return false;
      }

      const idGrupo = String(item.idGrupo || "").trim();
      const groupDocId = String(item.groupDocId || "").trim();

      return (
        scopedIdsInscripciones.has(idGrupo) ||
        scopedIdsInscripciones.has(groupDocId) ||
        scopedDocIdsInscripciones.has(idGrupo) ||
        scopedDocIdsInscripciones.has(groupDocId)
      );
    });

  state.inscripcionNuevoIngresoRows = sortInscripcionesDashboard(
    inscripcionesScope.filter(esInscripcionNuevoIngresoPendiente)
  );

  state.inscripcionListaEsperaRows = sortInscripcionesDashboard(
    inscripcionesScope.filter(esInscripcionListaEsperaPendiente)
  );

  state.listaEsperaPagadaRows = sortInscripcionesDashboard(
    inscripcionesScope.filter(esListaEsperaPagadaPendienteConfirmar)
  );

  // ALERTAS
  setContadorAlertaIndex(
    "count-sin-asignar",
    sinAsignarRows.length
  );
  
  setSinAsignarManagementHref();
  
  setContadorAlertaIndex(
    "count-a-contactar",
    aContactarRows.length
  );
  
  setContadorAlertaIndex(
    "count-fichas-firmar",
    fichasPorFirmar.length
  );
  
  setContadorAlertaIndex(
    "count-fichas-corregidas",
    fichasCorregidas.length
  );
  
  setContadorAlertaIndex(
    "count-solicitudes-actualizacion",
    solicitudesActualizacion.length
  );
  
  setContadorAlertaIndex(
    "count-inscripcion-nuevo-ingreso",
    state.inscripcionNuevoIngresoRows.length
  );
  
  setContadorAlertaIndex(
    "count-inscripcion-lista-espera",
    state.inscripcionListaEsperaRows.length
  );
  
  setContadorAlertaIndex(
    "count-lista-espera-pagada",
    state.listaEsperaPagadaRows.length
  );
  
  setContadorAlertaIndex(
    "count-alertas-criticas",
    alertasCriticas.length
  );
  
  setContadorAlertaIndex(
    "count-alertas-warning",
    alertasWarning.length
  );
  
  setContadorAlertaIndex(
    "count-reunion-3dias",
    reuniones3DiasRows.length
  );

  syncAlertRowsByRole(viewUser);

  logRendimientoIndex(
    "ALERTAS_RENDER",
    {
      gruposScope:
        scopedRows.length,

      fichasPorFirmar:
        fichasPorFirmar.length,

      fichasCorregidas:
        fichasCorregidas.length,

      solicitudes:
        solicitudesActualizacion.length,

      alertasCriticas:
        alertasCriticas.length,

      alertasPendientes:
        alertasWarning.length,

      nuevoIngreso:
        state.inscripcionNuevoIngresoRows.length,

      listaEspera:
        state.inscripcionListaEsperaRows.length,

      listaEsperaPagada:
        state.listaEsperaPagadaRows.length,

      reunionesTresDias:
        reuniones3DiasRows.length,

      duracionMs:
        Math.round(
          performance.now() -
          inicioAlertas
        )
    }
  );

  // FLUJO CON LINKS
  renderBucketLinks("contactados-top", "contactados", contactados);
  renderBucketLinks("cotizando-top", "cotizando", cotizando);
  renderBucketLinks("reunion-top", "reunion", reunion);
  renderBucketLinks("perdidas-top", "perdidas", perdidas);
  renderBucketLinks("recotizando-top", "recotizando", recotizando);
  renderBucketLinks("ganadas-top", "ganadas", ganadas);
  renderFichaAdminBucketLinks("abiertas-top", "abiertas", state.fichasAbiertasRows);
  renderFichaAdminBucketLinks("cerradas-top", "cerradas", state.fichasCerradasRows);
  renderFichaAdminBucketLinks("autorizadas-top", "autorizadas", state.fichasAutorizadasRows);
  logRendimientoIndex(
    "DIAGRAMA_RENDER",
    {
      gruposScope:
        scopedRows.length,

      contactados:
        contactados.length,

      cotizando:
        cotizando.length,

      reunion:
        reunion.length,

      perdidas:
        perdidas.length,

      recotizando:
        recotizando.length,

      ganadas:
        ganadas.length,

      clasificacionMs:
        Math.round(
          finClasificacionDiagrama -
          inicioDiagrama
        ),

      pintadoMs:
        Math.round(
          performance.now() -
          finClasificacionDiagrama
        ),

      duracionRenderCompletoMs:
        Math.round(
          performance.now() -
          inicioRenderDashboard
        )
    }
  );
}
/* =========================================================
   SELECTOR DE VENDEDORES
========================================================= */
function poblarSelectorVendedores(effectiveUser) {
  const select = $("select-vendedor");
  const btn = $("btn-ir-vendedor");

  if (!select || !btn || !effectiveUser) return;

  const vendorFilter = getVendorFilter(effectiveUser);
  const vendedores = getVendorUsers();

  select.innerHTML = "";

  if (isVendedorRole(effectiveUser)) {
    const option = document.createElement("option");
    option.value = normalizeEmail(effectiveUser.email);
    option.textContent = getNombreUsuario(effectiveUser);
    option.selected = true;
    select.appendChild(option);

    select.disabled = true;
    btn.disabled = true;
    btn.classList.add("ui-hidden");
    return;
  }

  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = "Todos";
  select.appendChild(defaultOption);

  vendedores.forEach((v) => {
    const option = document.createElement("option");
    option.value = normalizeEmail(v.email);
    option.textContent = `${v.nombre} ${v.apellido}`.trim() || getNombreUsuario(v);
    select.appendChild(option);
  });

  select.value = vendorFilter || "";
  select.disabled = false;
  btn.disabled = false;
  btn.classList.remove("ui-hidden");
}

function getAliasColegioSortKey(alias = "") {
  let text = String(alias || "").trim();

  // Quita el primer bloque tipo: 1C (2025)
  text = text.replace(/^[0-9A-Z]+(?:\s*[A-Z]+)?\s*\(\d{4}\)\s*/i, "");

  // Quita un segundo bloque si existe, por ejemplo:
  // 1C (2026) 2C (2027) COLEGIO...
  text = text.replace(/^[0-9A-Z]+(?:\s*[A-Z]+)?\s*\(\d{4}\)\s*/i, "");

  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function extraerBloquesCursoAnoDesdeAlias(
  alias = ""
) {
  let text =
    String(alias || "").trim();

  const bloques =
    [];

  while (
    bloques.length < 2
  ) {
    const match =
      text.match(
        /^([0-9]{1,2}\s*[A-ZÁÉÍÓÚÑ]*\s*\(\d{4}\))\s*/i
      );

    if (!match) {
      break;
    }

    bloques.push(
      match[1]
        .replace(/\s+/g, " ")
        .trim()
    );

    text =
      text
        .slice(match[0].length)
        .trim();
  }

  return bloques;
}

function extraerDatosCursoAno(
  bloque = ""
) {
  const match =
    String(bloque || "")
      .trim()
      .match(
        /^([0-9]{1,2})\s*([A-ZÁÉÍÓÚÑ]*)\s*\((\d{4})\)$/i
      );

  if (!match) {
    return null;
  }

  const numero =
    Number(match[1]);

  const letra =
    String(match[2] || "")
      .trim()
      .toUpperCase();

  const ano =
    Number(match[3]);

  if (
    !Number.isFinite(numero) ||
    !Number.isFinite(ano)
  ) {
    return null;
  }

  return {
    numero,
    letra,
    ano
  };
}

function avanzarCursoEscolar(
  numeroCurso,
  cantidadAnos = 0
) {
  let curso =
    Number(numeroCurso);

  let pasos =
    Math.max(
      0,
      Number(cantidadAnos) || 0
    );

  if (
    !Number.isFinite(curso) ||
    curso <= 0
  ) {
    return null;
  }

  while (pasos > 0) {
    /*
      Transición:
      8° básico → 1° medio.
    */
    if (curso === 8) {
      curso = 1;
    } else if (curso >= 4) {
      /*
        No existe un curso posterior a 4° medio.
        Se mantiene en 4 para evitar mostrar 5°, 6°, etc.
      */
      curso = 4;
    } else {
      curso += 1;
    }

    pasos -= 1;
  }

  return curso;
}

function calcularCursoActualDesdeAlias(
  row = {},
  fechaActual = new Date()
) {
  const alias =
    getRowAlias(row);

  const bloques =
    extraerBloquesCursoAnoDesdeAlias(
      alias
    );

  /*
    El primer bloque representa:
    curso cuando se creó el grupo + año de creación.
  */
  const datosBase =
    extraerDatosCursoAno(
      bloques[0] || ""
    );

  if (!datosBase) {
    return String(
      row.curso || ""
    ).trim();
  }

  const anoActual =
    fechaActual.getFullYear();

  const diferenciaAnos =
    Math.max(
      0,
      anoActual - datosBase.ano
    );

  const cursoActual =
    avanzarCursoEscolar(
      datosBase.numero,
      diferenciaAnos
    );

  if (!cursoActual) {
    return String(
      row.curso || ""
    ).trim();
  }

  return `${cursoActual}${datosBase.letra}`;
}

function extraerColegioDesdeAlias(
  alias = ""
) {
  let text =
    String(alias || "").trim();

  /*
    Quita hasta dos bloques iniciales:
    1C (2025) 3C (2027)
  */
  text =
    text
      .replace(
        /^([0-9]{1,2}\s*[A-ZÁÉÍÓÚÑ]*\s*\(\d{4}\)\s*){1,2}/i,
        ""
      )
      .trim();

  /*
    Quita separadores sobrantes.
  */
  text =
    text
      .replace(
        /^\s*[—\-|,:]+\s*/g,
        ""
      )
      .trim();

  return text;
}

function construirColegioParaSelector(
  row = {}
) {
  const colegio =
    String(row.colegio || "").trim();

  if (colegio) {
    return colegio;
  }

  const alias =
    getRowAlias(row);

  const colegioDesdeAlias =
    extraerColegioDesdeAlias(
      alias
    );

  return (
    colegioDesdeAlias ||
    alias
  );
}

function construirLabelGrupoSelector(
  row = {}
) {
  const ano =
    getAnoViajeNumber(row) ||
    "";

  const colegio =
    construirColegioParaSelector(
      row
    );

  const cursoActual =
    calcularCursoActualDesdeAlias(
      row
    );

  const colegioCurso =
    [
      colegio,
      cursoActual
    ]
      .filter(
        (parte) =>
          String(parte || "").trim()
      )
      .join(" ");

  const apoderado =
    getRowApoderado(row);

  const estado =
    String(
      row.estado ||
      "Sin estado"
    ).trim();

  return [
    ano,
    colegioCurso,
    apoderado,
    estado
  ]
    .filter(
      (parte) =>
        String(parte || "").trim()
    )
    .join(" · ");
}

function getPrioridadEstadoAdministrativo(
  row = {}
) {
  const bucket =
    resolveEstadoBucket(row);

  const prioridades = {
    ganadas: 1,
    reunion: 2,
    cotizando: 3,
    recotizando: 4,
    contactados: 5
  };

  return (
    prioridades[bucket] ||
    99
  );
}

function esEstadoVisibleEnSelectores(
  row = {}
) {
  return (
    resolveEstadoBucket(row) !==
    "perdidas"
  );
}

function esEstadoAdministrativoVisible(
  row = {}
) {
  const bucket =
    resolveEstadoBucket(row);

  return [
    "ganadas",
    "reunion",
    "cotizando",
    "recotizando",
    "contactados"
  ].includes(bucket);
}

function construirSortKeyComercial(
  row = {}
) {
  const colegio =
    construirColegioParaSelector(
      row
    );

  const ano =
    getAnoViajeNumber(row) ||
    9999;

  const cursoActual =
    calcularCursoActualDesdeAlias(
      row
    );

  const apoderado =
    getRowApoderado(row);

  return [
    normalizeLoose(colegio),

    String(ano)
      .padStart(4, "0"),

    normalizeLoose(
      cursoActual
    ),

    normalizeLoose(
      apoderado
    )
  ].join(" | ");
}

function construirSortKeyAdministrativo(
  row = {}
) {
  const colegio =
    construirColegioParaSelector(
      row
    );

  const prioridadEstado =
    getPrioridadEstadoAdministrativo(
      row
    );

  const cursoActual =
    calcularCursoActualDesdeAlias(
      row
    );

  const apoderado =
    getRowApoderado(row);

  const ano =
    getAnoViajeNumber(row) ||
    9999;

  return [
    normalizeLoose(colegio),

    String(prioridadEstado)
      .padStart(2, "0"),

    String(ano)
      .padStart(4, "0"),

    normalizeLoose(
      cursoActual
    ),

    normalizeLoose(
      apoderado
    )
  ].join(" | ");
}

/*
  Esta función se mantiene porque también la utiliza
  el buscador general del dashboard.
*/
function construirSortKeyGrupoSelector(
  row = {}
) {
  const colegio =
    construirColegioParaSelector(
      row
    );

  const ano =
    getAnoViajeNumber(row) ||
    9999;

  const cursoActual =
    calcularCursoActualDesdeAlias(
      row
    );

  const apoderado =
    getRowApoderado(row);

  return [
    normalizeLoose(colegio),

    String(ano)
      .padStart(4, "0"),

    normalizeLoose(
      cursoActual
    ),

    normalizeLoose(
      apoderado
    )
  ].join(" | ");
}

/* =========================================================
   SELECTOR DE GRUPOS
========================================================= */
function poblarSelectorGruposComerciales(
  effectiveUser,
  rows = []
) {
  const inicioSelector =
    performance.now();
  
  const select =
    $("select-grupo-comercial");

  if (
    !select ||
    !effectiveUser
  ) {
    return;
  }

    /*
    IMPORTANTE:

    Se debe destruir Tom Select ANTES de modificar
    el contenido del select nativo.

    Si se destruye después, Tom Select puede restaurar
    las opciones antiguas, como el mensaje
    "Cargando grupos comerciales...".
  */
  destroySearchableSelect(
    "select-grupo-comercial"
  );

  const anoActual =
    getAnoPrioritarioIndex();

  /*
    Comercial:
    desde el próximo año en adelante.
    En 2026 muestra 2027, 2028, 2029...
  */
  const rowsComerciales =
    dedupeRowsByGroup(rows)
      .filter(
        (row) => {
          const anoViaje =
            getAnoViajeNumber(row);

          return (
            anoViaje !== null &&
            anoViaje >= anoActual + 1 &&
            esEstadoVisibleEnSelectores(row)
          );
        }
      );

  select.innerHTML =
    `<option value="">Buscar grupo comercial...</option>`;

  const items =
    rowsComerciales
      .map(
        (row) => ({
          value:
            getRowId(row),

          label:
            construirLabelGrupoSelector(
              row
            ),

          sortKey:
            construirSortKeyComercial(
              row
            )
        })
      )
      .filter(
        (item) =>
          item.value
      )
      .sort(
        (a, b) =>
          a.sortKey.localeCompare(
            b.sortKey,
            "es",
            {
              sensitivity: "base",
              numeric: true
            }
          )
      );

  items.forEach(
    (item) => {
      const option =
        document.createElement(
          "option"
        );

      option.value =
        item.value;

      option.textContent =
        item.label;

      select.appendChild(
        option
      );
    }
  );

  /*
    Siempre comienza vacío.
    Es un acceso directo, no un filtro persistente.
  */
  select.value =
    "";

  select.disabled =
    !items.length;

  initSearchableSelect(
    "select-grupo-comercial",
    "Buscar grupo comercial por colegio, curso, año o apoderado...",
    {
      onChange(value) {
        abrirGrupoDesdeSelector(
          value
        );
      }
    }
  );
  
  logRendimientoIndex(
    "SELECTOR_COMERCIAL",
    {
      filasRecibidas:
        rows.length,

      filasValidas:
        rowsComerciales.length,

      opciones:
        items.length,

      duracionMs:
        Math.round(
          performance.now() -
          inicioSelector
        )
    }
  );
}

/* =========================================================
   SELECTOR DE GRUPOS ADMINISTRATIVOS
========================================================= */
function poblarSelectorGruposAdministrativos(
  rows = []
) {
  const inicioSelector =
    performance.now();
  
  const select =
    $("select-grupo-administrativo");

  if (!select) {
    return;
  }

  /*
    Destruye la instancia visual antes de modificar
    las opciones del select original.
  */
  destroySearchableSelect(
    "select-grupo-administrativo"
  );

  const anoActual =
    getAnoPrioritarioIndex();

  /*
    Administrativo:
    solamente grupos del año actual.

    Durante 2026:
    muestra grupos que viajan en 2026.
  */
  const rowsAdministrativos =
    dedupeRowsByGroup(rows)
      .filter(
        (row) => {
          const anoViaje =
            getAnoViajeNumber(row);

          return (
            anoViaje === anoActual &&
            esEstadoAdministrativoVisible(row)
          );
        }
      );

  select.innerHTML =
    `<option value="">Buscar grupo administrativo...</option>`;

  const items =
    rowsAdministrativos
      .map(
        (row) => ({
          value:
            getRowId(row),

          label:
            construirLabelGrupoSelector(
              row
            ),

          sortKey:
            construirSortKeyAdministrativo(
              row
            )
        })
      )
      .filter(
        (item) =>
          item.value
      )
      .sort(
        (a, b) =>
          a.sortKey.localeCompare(
            b.sortKey,
            "es",
            {
              sensitivity: "base",
              numeric: true
            }
          )
      );

  items.forEach(
    (item) => {
      const option =
        document.createElement(
          "option"
        );

      option.value =
        item.value;

      option.textContent =
        item.label;

      select.appendChild(
        option
      );
    }
  );

  /*
    Siempre comienza vacío.
  */
  select.value =
    "";

  select.disabled =
    !items.length;

  initSearchableSelect(
    "select-grupo-administrativo",
    "Buscar grupo administrativo por colegio, curso, año o apoderado...",
    {
      onChange(value) {
        abrirGrupoDesdeSelector(
          value
        );
      }
    }
  );
  
  logRendimientoIndex(
    "SELECTOR_ADMINISTRATIVO",
    {
      filasRecibidas:
        rows.length,

      filasValidas:
        rowsAdministrativos.length,

      opciones:
        items.length,

      duracionMs:
        Math.round(
          performance.now() -
          inicioSelector
        )
    }
  );
}

/* =========================================================
   SCOPE VISUAL
========================================================= */
function buildScopeText(realUser, effectiveUser) {
  const vendorFilter = getVendorFilter(effectiveUser);
  const vendedores = getVendorUsers();

  let texto = "Vista general";

  if (isVendedorRole(effectiveUser)) {
    texto = `Vista personal: ${getNombreUsuario(effectiveUser)}`;
  } else if (isRegistroRole(effectiveUser)) {
    if (vendorFilter) {
      const vendedor = vendedores.find(
        (v) => normalizeEmail(v.email) === normalizeEmail(vendorFilter)
      );
      texto = vendedor
        ? `Vista observador · filtrada por vendedor(a): ${`${vendedor.nombre} ${vendedor.apellido}`.trim()}`
        : "Vista general · observador";
    } else {
      texto = "Vista general · observador";
    }
  } else {
    if (vendorFilter) {
      const vendedor = vendedores.find(
        (v) => normalizeEmail(v.email) === normalizeEmail(vendorFilter)
      );
      texto = vendedor
        ? `Vista filtrada por vendedor(a): ${`${vendedor.nombre} ${vendedor.apellido}`.trim()}`
        : "Vista general";
    } else {
      texto = "Vista general";
    }
  }

  if (isActingAsAnother(realUser, effectiveUser)) {
    return `Navegando como ${getNombreUsuario(effectiveUser)} · ${effectiveUser.rol} · ${texto}`;
  }

  return texto;
}

/* =========================================================
   RENDER
========================================================= */
async function renderPantalla() {
  const realUser =
    getRealUser();

  const effectiveUser =
    getEffectiveUser();

  if (
    !realUser ||
    !effectiveUser
  ) {
    return;
  }
  
  iniciarMedicionIndex();

  logRendimientoIndex(
    "USUARIO",
    {
      correo:
        normalizeEmail(
          effectiveUser.email || ""
        ),
  
      rol:
        effectiveUser.rol || ""
    }
  );

  if (
    isVendedorRole(
      effectiveUser
    )
  ) {
    setVendorFilter(
      effectiveUser.email
    );
  }

  setHeaderState({
    realUser,
    effectiveUser,

    scopeText:
      buildScopeText(
        realUser,
        effectiveUser
      )
  });

  renderActingUserSwitcher({
    realUser,
    effectiveUser,
    users:
      VENTAS_USERS
  });

  /*
    Reinicia datos auxiliares cuando cambia
    el usuario efectivo o el filtro vendedor.
  */
  state.promiseDatosAuxiliares =
    null;

  state.datosAuxiliaresCargados =
    false;

  state.alertRows =
    [];

  state.solicitudesRows =
    [];

  state.inscripcionesRows =
    [];

  inicializarDashboardEnCeros();

  /*
    La nota no bloquea el resto.
  */
  loadPrivateNote()
    .catch((error) => {
      console.error(
        "Error cargando nota privada:",
        error
      );
    });

  try {
    await loadDashboardData();
  } catch (error) {
    console.error(
      "Error cargando dashboard:",
      error
    );

    reconstruirRowsIndex();

    if (state.rows.length) {
      actualizarExperienciaPrincipalIndex({
        renderizarDashboardCompleto:
          false
      });
    }
  }
}

/* =========================================================
   INIT
========================================================= */
async function initPage() {
  await waitForLayoutReady();

  bindPrivateNotePanel();

  bindLayoutButtons({
    homeUrl: GITHUB_HOME_URL,
    onLogout: async () => {
      try {
        sessionStorage.removeItem(ACTING_USER_KEY);
        clearVendorFilter();
        clearGroupFilter();
    
        await signOut(auth);
    
        location.href = "login.html";
      } catch (error) {
        alert(
          "Error al cerrar sesión: " +
          error.message
        );
      }
    },
    onActAs: async (selectedEmail) => {
      const realUser =
        getRealUser();
    
      if (
        !realUser ||
        realUser.rol !== "admin"
      ) {
        return;
      }
    
      if (!selectedEmail) {
        return;
      }
    
      sessionStorage.setItem(
        ACTING_USER_KEY,
        selectedEmail
      );
    
      clearVendorFilter();
      clearGroupFilter();
    
      renderPantalla();
    },
    onResetActAs: async () => {
      sessionStorage.removeItem(
        ACTING_USER_KEY
      );
    
      clearVendorFilter();
      clearGroupFilter();
    
      renderPantalla();
    }
  });

  const btnIrVendedor =
    $("btn-ir-vendedor");

  const linkSinAsignar = $("link-sin-asignar");

  const linkAContactar = $("link-a-contactar");
  const btnCerrarAContactar = $("btn-cerrar-a-contactar");
  const modalAContactar = $("modal-a-contactar");

  const linkFichasFirmar = $("link-fichas-firmar");
  const linkFichasAbiertas = $("abiertas-top");
  const linkFichasCerradas = $("cerradas-top");
  const linkFichasAutorizadas = $("autorizadas-top");
  const btnCerrarFichasAdmin = $("btn-cerrar-fichas-admin");
  const modalFichasAdmin = $("modal-fichas-admin");
  const btnCerrarFichasFirmar = $("btn-cerrar-fichas-firmar");
  const modalFichasFirmar = $("modal-fichas-firmar");

  const linkFichasCorregidas = $("link-fichas-corregidas");
  const btnCerrarFichasCorregidas = $("btn-cerrar-fichas-corregidas");
  const modalFichasCorregidas = $("modal-fichas-corregidas");

  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-toggle-motivo]");
    if (!btn) return;
  
    const targetId = btn.dataset.toggleMotivo;
    const box = document.getElementById(targetId);
    if (!box) return;
  
    const isHidden = box.hidden;
    box.hidden = !isHidden;
    btn.textContent = isHidden ? "Ocultar motivo" : "Ver motivo";
  });

  const linkSolicitudesActualizacion = $("link-solicitudes-actualizacion");
  const btnCerrarSolicitudesActualizacion = $("btn-cerrar-solicitudes-actualizacion");
  const modalSolicitudesActualizacion = $("modal-solicitudes-actualizacion");
  
  const linkAlertasCriticas = $("link-alertas-criticas");
  const btnCerrarAlertasCriticas = $("btn-cerrar-alertas-criticas");
  const modalAlertasCriticas = $("modal-alertas-criticas");
  
  const linkAlertasWarning = $("link-alertas-warning");
  const btnCerrarAlertasWarning = $("btn-cerrar-alertas-warning");
  const modalAlertasWarning = $("modal-alertas-warning");

  const linkInscripcionNuevoIngreso =
    $("link-inscripcion-nuevo-ingreso");

  const linkInscripcionListaEspera =
    $("link-inscripcion-lista-espera");

  const linkListaEsperaPagada =
    $("link-lista-espera-pagada");

  const btnCerrarAlertasInscripciones =
    $("btn-cerrar-alertas-inscripciones");

  const modalAlertasInscripciones =
    $("modal-alertas-inscripciones");

  const buscadorAlertasInscripciones =
    $("alertas-inscripciones-buscador");
  

  if (btnIrVendedor && !btnIrVendedor.dataset.bound) {
    btnIrVendedor.dataset.bound = "1";

    btnIrVendedor.addEventListener("click", async () => {
      const effectiveUser = getEffectiveUser();
      if (!effectiveUser) return;

      if (isVendedorRole(effectiveUser)) {
        setVendorFilter(effectiveUser.email);
      } else {
        const selectedEmail = normalizeEmail($("select-vendedor")?.value || "");
        setVendorFilter(selectedEmail);
      }

      clearGroupFilter();
      await renderPantalla();
    });
  }

  if (linkSinAsignar && !linkSinAsignar.dataset.boundPopup) {
    linkSinAsignar.dataset.boundPopup = "1";
  
    linkSinAsignar.addEventListener("click", (e) => {
      e.preventDefault();
  
      window.open(
        "asignados.html?tab=sin_asignar",
        "sinAsignarPopup",
        "width=1200,height=800,scrollbars=yes,resizable=yes"
      );
    });
  }
  
  if (linkAContactar && !linkAContactar.dataset.bound) {
    linkAContactar.dataset.bound = "1";
  
    linkAContactar.addEventListener("click", (e) => {
      e.preventDefault();
      openAContactarModal();
    });
  }
  
  if (btnCerrarAContactar && !btnCerrarAContactar.dataset.bound) {
    btnCerrarAContactar.dataset.bound = "1";
  
    btnCerrarAContactar.addEventListener("click", () => {
      closeAContactarModal();
    });
  }
  
  if (modalAContactar && !modalAContactar.dataset.bound) {
    modalAContactar.dataset.bound = "1";
  
    modalAContactar.addEventListener("click", (e) => {
      if (e.target === modalAContactar) {
        closeAContactarModal();
      }
    });
  }

  if (
    linkFichasFirmar &&
    !linkFichasFirmar.dataset.bound
  ) {
    linkFichasFirmar.dataset.bound =
      "1";
  
    linkFichasFirmar.addEventListener(
      "click",
      async (e) => {
        e.preventDefault();
  
        try {
          await asegurarDetallesDashboardCargados();
          openFichasPorFirmarModal();
        } catch (error) {
          alert(
            "No se pudieron cargar las fichas por firmar."
          );
        }
      }
    );
  }
  
  if (btnCerrarFichasFirmar && !btnCerrarFichasFirmar.dataset.bound) {
    btnCerrarFichasFirmar.dataset.bound = "1";
  
    btnCerrarFichasFirmar.addEventListener("click", () => {
      closeFichasPorFirmarModal();
    });
  }

  if (
    linkFichasCorregidas &&
    !linkFichasCorregidas.dataset.bound
  ) {
    linkFichasCorregidas.dataset.bound =
      "1";
  
    linkFichasCorregidas.addEventListener(
      "click",
      async (e) => {
        e.preventDefault();
  
        try {
          await asegurarDetallesDashboardCargados();
          openFichasCorregidasModal();
        } catch (error) {
          alert(
            "No se pudieron cargar las fichas corregidas."
          );
        }
      }
    );
  }
  
  if (btnCerrarFichasCorregidas && !btnCerrarFichasCorregidas.dataset.bound) {
    btnCerrarFichasCorregidas.dataset.bound = "1";
  
    btnCerrarFichasCorregidas.addEventListener("click", () => {
      closeFichasCorregidasModal();
    });
  }
  
  if (modalFichasCorregidas && !modalFichasCorregidas.dataset.bound) {
    modalFichasCorregidas.dataset.bound = "1";
  
    modalFichasCorregidas.addEventListener("click", (e) => {
      if (e.target === modalFichasCorregidas) {
        closeFichasCorregidasModal();
      }
    });
  }

  [linkFichasAbiertas, linkFichasCerradas, linkFichasAutorizadas].forEach((link) => {
    if (!link || link.dataset.boundAdminBuckets) return;
  
    link.dataset.boundAdminBuckets = "1";
  
    link.addEventListener("click", (e) => {
      const clicked = e.target.closest("[data-fichas-admin-tipo]");
      if (!clicked) return;
  
      e.preventDefault();
  
      const tipo = clicked.dataset.fichasAdminTipo || "";
      const year = clicked.dataset.fichasAdminYear || "total";
  
      openFichasAdminModal(tipo, year);
    });
  });
  
  if (btnCerrarFichasAdmin && !btnCerrarFichasAdmin.dataset.bound) {
    btnCerrarFichasAdmin.dataset.bound = "1";
    btnCerrarFichasAdmin.addEventListener("click", closeFichasAdminModal);
  }
  
  if (modalFichasAdmin && !modalFichasAdmin.dataset.bound) {
    modalFichasAdmin.dataset.bound = "1";
    modalFichasAdmin.addEventListener("click", (e) => {
      if (e.target === modalFichasAdmin) closeFichasAdminModal();
    });
  }

  if (
    linkSolicitudesActualizacion &&
    !linkSolicitudesActualizacion.dataset.bound
  ) {
    linkSolicitudesActualizacion.dataset.bound =
      "1";
  
    linkSolicitudesActualizacion.addEventListener(
      "click",
      async (e) => {
        e.preventDefault();
  
        try {
          await asegurarDetallesDashboardCargados();
          openSolicitudesActualizacionModal();
        } catch (error) {
          alert(
            "No se pudieron cargar las solicitudes de actualización."
          );
        }
      }
    );
  }
  
  if (btnCerrarSolicitudesActualizacion && !btnCerrarSolicitudesActualizacion.dataset.bound) {
    btnCerrarSolicitudesActualizacion.dataset.bound = "1";
  
    btnCerrarSolicitudesActualizacion.addEventListener("click", () => {
      closeSolicitudesActualizacionModal();
    });
  }
  
  if (modalSolicitudesActualizacion && !modalSolicitudesActualizacion.dataset.bound) {
    modalSolicitudesActualizacion.dataset.bound = "1";
  
    modalSolicitudesActualizacion.addEventListener("click", (e) => {
      if (e.target === modalSolicitudesActualizacion) {
        closeSolicitudesActualizacionModal();
      }
    });
  }

  if (
    linkAlertasCriticas &&
    !linkAlertasCriticas.dataset.bound
  ) {
    linkAlertasCriticas.dataset.bound =
      "1";
  
    linkAlertasCriticas.addEventListener(
      "click",
      async (e) => {
        e.preventDefault();
  
        try {
          await asegurarDetallesDashboardCargados();
          openAlertasCriticasModal();
        } catch (error) {
          alert(
            "No se pudieron cargar las alertas críticas."
          );
        }
      }
    );
  }
  
  if (btnCerrarAlertasCriticas && !btnCerrarAlertasCriticas.dataset.bound) {
    btnCerrarAlertasCriticas.dataset.bound = "1";
  
    btnCerrarAlertasCriticas.addEventListener("click", () => {
      closeAlertasCriticasModal();
    });
  }
  
  if (
    linkAlertasWarning &&
    !linkAlertasWarning.dataset.bound
  ) {
    linkAlertasWarning.dataset.bound =
      "1";
  
    linkAlertasWarning.addEventListener(
      "click",
      async (e) => {
        e.preventDefault();
  
        try {
          await asegurarDetallesDashboardCargados();
          openAlertasWarningModal();
        } catch (error) {
          alert(
            "No se pudieron cargar las alertas pendientes."
          );
        }
      }
    );
  }
  
  if (btnCerrarAlertasWarning && !btnCerrarAlertasWarning.dataset.bound) {
    btnCerrarAlertasWarning.dataset.bound = "1";
  
    btnCerrarAlertasWarning.addEventListener("click", () => {
      closeAlertasWarningModal();
    });
  }
  
  if (modalFichasFirmar && !modalFichasFirmar.dataset.bound) {
    modalFichasFirmar.dataset.bound = "1";

    modalFichasFirmar.addEventListener("click", (e) => {
      if (e.target === modalFichasFirmar) {
        closeFichasPorFirmarModal();
      }
    });
  }

  if (modalAlertasCriticas && !modalAlertasCriticas.dataset.bound) {
    modalAlertasCriticas.dataset.bound = "1";
  
    modalAlertasCriticas.addEventListener("click", (e) => {
      if (e.target === modalAlertasCriticas) {
        closeAlertasCriticasModal();
      }
    });
  }

  if (modalAlertasWarning && !modalAlertasWarning.dataset.bound) {
    modalAlertasWarning.dataset.bound = "1";
  
    modalAlertasWarning.addEventListener("click", (e) => {
      if (e.target === modalAlertasWarning) {
        closeAlertasWarningModal();
      }
    });
  }

  if (
    linkInscripcionNuevoIngreso &&
    !linkInscripcionNuevoIngreso.dataset.bound
  ) {
    linkInscripcionNuevoIngreso.dataset.bound =
      "1";
  
    linkInscripcionNuevoIngreso.addEventListener(
      "click",
      async (e) => {
        e.preventDefault();
  
        try {
          await asegurarDetallesDashboardCargados();
  
          openAlertasInscripcionesModal(
            "nuevo_ingreso"
          );
        } catch (error) {
          alert(
            "No se pudieron cargar las inscripciones de Nuevo Ingreso."
          );
        }
      }
    );
  }

  if (
    linkInscripcionListaEspera &&
    !linkInscripcionListaEspera.dataset.bound
  ) {
    linkInscripcionListaEspera.dataset.bound =
      "1";
  
    linkInscripcionListaEspera.addEventListener(
      "click",
      async (e) => {
        e.preventDefault();
  
        try {
          await asegurarDetallesDashboardCargados();
  
          openAlertasInscripcionesModal(
            "lista_espera"
          );
        } catch (error) {
          alert(
            "No se pudieron cargar las inscripciones de Lista de Espera."
          );
        }
      }
    );
  }

  if (
    linkListaEsperaPagada &&
    !linkListaEsperaPagada.dataset.bound
  ) {
    linkListaEsperaPagada.dataset.bound =
      "1";
  
    linkListaEsperaPagada.addEventListener(
      "click",
      async (e) => {
        e.preventDefault();
  
        try {
          await asegurarDetallesDashboardCargados();
  
          openAlertasInscripcionesModal(
            "lista_espera_pagada"
          );
        } catch (error) {
          alert(
            "No se pudieron cargar las listas de espera pagadas."
          );
        }
      }
    );
  }

  if (
    btnCerrarAlertasInscripciones &&
    !btnCerrarAlertasInscripciones.dataset.bound
  ) {
    btnCerrarAlertasInscripciones.dataset.bound = "1";

    btnCerrarAlertasInscripciones.addEventListener("click", () => {
      closeAlertasInscripcionesModal();
    });
  }

  if (
    modalAlertasInscripciones &&
    !modalAlertasInscripciones.dataset.bound
  ) {
    modalAlertasInscripciones.dataset.bound = "1";

    modalAlertasInscripciones.addEventListener("click", (e) => {
      if (e.target === modalAlertasInscripciones) {
        closeAlertasInscripcionesModal();
      }
    });
  }

  if (
    buscadorAlertasInscripciones &&
    !buscadorAlertasInscripciones.dataset.bound
  ) {
    buscadorAlertasInscripciones.dataset.bound = "1";

    buscadorAlertasInscripciones.addEventListener(
      "input",
      filtrarModalAlertasInscripciones
    );
  }

  onAuthStateChanged(auth, (user) => {
    if (!user) return;
    renderPantalla();
  });

  updateClockDataset();
  setInterval(updateClockDataset, 1000);
}

/* =========================================================
   BUSCADOR GLOBAL DE GRUPOS
========================================================= */

function buildSearchText(
  row = {}
) {
  const busquedaResumen =
    String(
      row.busquedaTexto || ""
    ).trim();

  if (busquedaResumen) {
    return normalizeLoose(
      busquedaResumen
    );
  }

  return normalizeLoose(
    [
      getRowId(row),
      getNumeroNegocio(row),
      getRowAlias(row),
      getRowApoderado(row),
      row.colegio,
      row.curso,
      row.anoViaje,
      row.destino,
      row.destinoPrincipal,
      row.programa,
      row.vendedora,
      row.vendedoraCorreo,
      row.estado
    ].join(" ")
  );
}

function evaluarBusqueda(textoGrupo, query) {
  const q = normalizeLoose(query);

  if (!q) return true;

  // OR
  if (q.includes("(o)")) {
    const parts = q.split("(o)").map(p => p.trim());
    return parts.some(p => textoGrupo.includes(p));
  }

  // AND
  if (q.includes("(y)")) {
    const parts = q.split("(y)").map(p => p.trim());
    return parts.every(p => textoGrupo.includes(p));
  }

  // default AND por palabras
  return q.split(" ").every(p => textoGrupo.includes(p));
}

function filtrarGruposPorBusqueda(
  rows = [],
  query = ""
) {
  const filtrados =
    query
      ? rows.filter(
          (row) => {
            const text =
              buildSearchText(
                row
              );

            return evaluarBusqueda(
              text,
              query
            );
          }
        )
      : [...rows];

  return filtrados.sort(
    (a, b) =>
      construirSortKeyGrupoSelector(
        a
      ).localeCompare(
        construirSortKeyGrupoSelector(
          b
        ),
        "es",
        {
          sensitivity:
            "base",

          numeric:
            true
        }
      )
  );
}

function renderResultadosBusqueda(
  rows = []
) {
  const cont =
    $("buscador-resultados");

  if (!cont) {
    return;
  }

  if (!rows.length) {
    cont.innerHTML =
      `<div class="buscador-item">Sin resultados</div>`;

    return;
  }

  cont.innerHTML =
    rows
      .slice(0, 30)
      .map((row) => {
        const id =
          getRowId(row);

        const ano =
          getAnoViajeNumber(row) ||
          "Sin año";

        return `
          <div
            class="buscador-item"
            data-group-result="${escapeHtml(id)}"
            style="cursor:pointer;"
          >
            <strong>
              ${escapeHtml(
                `${ano} · ${getRowAlias(row)}`
              )}
            </strong>
            <br>

            ${escapeHtml(
              row.colegio || ""
            )}
            —
            ${escapeHtml(
              getRowApoderado(row)
            )}
            <br>

            <span style="opacity:.6">
              ${escapeHtml(
                row.estado || ""
              )}
            </span>
          </div>
        `;
      })
      .join("");

  cont
    .querySelectorAll(
      "[data-group-result]"
    )
    .forEach((item) => {
      item.addEventListener(
        "click",
        () => {
          const id =
            String(
              item.dataset.groupResult || ""
            ).trim();

          if (!id) {
            return;
          }

          location.href =
            `grupo.html?id=${encodeURIComponent(id)}`;
        }
      );
    });
}

function initBuscadorDashboard() {
  const input =
    $("input-buscador-grupos");

  if (
    !input ||
    input.dataset.bound
  ) {
    return;
  }

  input.dataset.bound =
    "1";

  input.addEventListener(
    "input",
    () => {
      const query =
        input.value;

      const effectiveUser =
        getEffectiveUser();

      const baseRows =
        getRowsForCurrentScope(
          effectiveUser
        );

      const filtrados =
        filtrarGruposPorBusqueda(
          baseRows,
          query
        );

      renderResultadosBusqueda(
        filtrados
      );

      /*
        Los resultados del buscador no deben
        alterar el scope base utilizado por
        la siguiente búsqueda.
      */
      renderDashboard(
        filtrados
      );

      state.scopedRows =
        baseRows;
    }
  );
}

initPage();

window.limpiarCorreccionesCerradasAntiguas = async function ({ aplicar = false } = {}) {
  const snap = await getDocs(collection(db, "ventas_cotizaciones"));

  const candidatas = [];

  for (const d of snap.docs) {
    const row = d.data() || {};
    const flow = row.flowFicha || {};
    const ficha = row.ficha || {};

    const tienePdf = !!(ficha.pdfUrl || row.fichaPdfUrl || ficha.storagePathPdf);

    const firmasCompletas =
      !!flow?.vendedor?.firmado &&
      !!flow?.jefaVentas?.firmado &&
      !!flow?.administracion?.firmado;

    const pdfPendiente = ficha.pdfPendienteGeneracion === true;
    const flujoAbierto = row.fichaFlujoAbierto === true;

    const correccionVieja =
      flow.correccionPendiente === true ||
      String(flow.correccionEstado || "").includes("pendiente") ||
      flow.requiereRefirmaAdministracion === true;

    if (tienePdf && firmasCompletas && !pdfPendiente && !flujoAbierto && correccionVieja) {
      candidatas.push({
        docId: d.id,
        idGrupo: row.idGrupo || d.id,
        aliasGrupo: row.aliasGrupo || row.nombreGrupo || "",
        correccionEstado: flow.correccionEstado || "",
        correccionPendiente: flow.correccionPendiente,
        pdfUrl: ficha.pdfUrl || row.fichaPdfUrl || ""
      });

      if (aplicar) {
        await updateDoc(doc(db, "ventas_cotizaciones", d.id), {
          "flowFicha.correccionPendiente": false,
          "flowFicha.correccionEstado": "cerrada",
          "flowFicha.requiereRefirmaAdministracion": false,
          "flowFicha.requiereActualizacion": false,
          fichaFlujoAbierto: false,
          "ficha.pdfPendienteGeneracion": false
        });
      }
    }
  }

  console.table(candidatas);
  console.log(aplicar ? "Limpieza aplicada." : "Simulación. Para aplicar ejecuta con { aplicar: true }.");
  return candidatas;
};
