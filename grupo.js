import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.7.3/firebase-auth.js";
import {
  collection,
  query,
  where,
  getDocs,
  getDoc,
  addDoc,
  doc,
  setDoc,
  serverTimestamp,
  Timestamp
} from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";

import {
  auth,
  db,
  VENTAS_USERS,
  normalizeEmail,
  puedeVerGeneral,
  puedeModificarVentas
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
const REUNIONES_COLLECTION = "ventas_reuniones";
const HISTORIAL_COLLECTION = "ventas_historial";
const ALERTAS_COLLECTION = "ventas_alertas";
const SOLICITUDES_COLLECTION = "ventas_solicitudes_actualizacion";

const richSelectionByEditor = new Map();
let richEditorsBound = false;

const state = {
  realUser: null,
  effectiveUser: null,
  effectiveEmail: "",
  canSeeAll: false,
  canModify: false,

  requestedId: "",
  groupDocId: "",
  groupId: "",
  group: null,

  meetings: [],
  history: [],
  alertsManual: [],
  requests: [],

  autoAlerts: [],

  historyUi: {
    limit: 10,
    showHidden: false
  }
};

const ESTADO_META = {
  a_contactar: { label: "A contactar", css: "estado-a_contactar" },
  contactado: { label: "Contactado", css: "estado-contactado" },
  cotizando: { label: "Cotizando", css: "estado-cotizando" },
  recotizando: { label: "Recotizando", css: "estado-recotizando" },
  reunion_confirmada: { label: "Reunión confirmada", css: "estado-reunion_confirmada" },
  ganada: { label: "Ganada", css: "estado-ganada" },
  perdida: { label: "Perdida", css: "estado-perdida" }
};

const DOC_LABELS = {
  fichaMedicaEstado: "Fichas médicas",
  nominaEstado: "Nómina",
  fichaEstado: "Ficha del grupo",
  contratoEstado: "Contrato",
  cortesiaEstado: "Cortesías"
};

const DATA_FIELDS = [
  "aliasGrupo",
  "estado",
  "vendedora",
  "colegio",
  "curso",
  "anoViaje",
  "cantidadGrupo",
  "destinoPrincipal",
  "programa",
  "tramo",
  "semanaViaje",
  "comunaCiudad",
  "nombreCliente",
  "rolCliente",
  "correoCliente",
  "celularCliente",
  "nombreCliente2",
  "rolCliente2",
  "correoCliente2",
  "celularCliente2"
];

const SITUACION_FIELDS = [
  "estado",
  "autorizada",
  "cerrada",
  "situacion.resumen",
  "situacion.proximoPaso",
  "situacion.observacionVentas",
  "situacion.observacionJefaVentas",
  "situacion.observacionAdministracion",
  "situacion.observacionOperaciones"
];

const DOC_FIELDS = [
  "fichaMedicaEstado",
  "nominaEstado",
  "fichaEstado",
  "contratoEstado",
  "cortesiaEstado"
];

initPage();

async function initPage() {
  state.requestedId = String(new URLSearchParams(location.search).get("id") || "").trim();

  await waitForLayoutReady();
  bindEvents();

  onAuthStateChanged(auth, async (user) => {
    if (!user) return;

    await bootstrapFromSession();
    setHeaderAndScope();
    await loadAll();
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
  state.canModify = puedeModificarVentas(state.effectiveEmail);
}

function setHeaderAndScope() {
  setHeaderState({
    realUser: state.realUser,
    effectiveUser: state.effectiveUser,
    scopeText: `Portafolio del grupo · ${state.requestedId || "Sin ID"}`
  });

  renderActingUserSwitcher({
    realUser: state.realUser,
    effectiveUser: state.effectiveUser,
    users: VENTAS_USERS
  });

  bindHeaderActions();
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
      setHeaderAndScope();
      await loadAll();
    },
    onResetActAs: async () => {
      sessionStorage.removeItem(ACTING_USER_KEY);
      await bootstrapFromSession();
      setHeaderAndScope();
      await loadAll();
    }
  });
}

/* =========================================================
   LOAD
========================================================= */
async function loadAll() {
  if (!state.requestedId) {
    renderFatal("Falta el parámetro ?id= en la URL.");
    return;
  }

  const resolved = await resolveGroupByParam(state.requestedId);

  if (!resolved) {
    renderFatal(`No encontré el grupo ${state.requestedId}.`);
    return;
  }

  state.groupDocId = resolved.docId;
  state.groupId = String(resolved.groupId || state.requestedId);
  state.group = resolved.data || {};

  if (!canAccessGroup(state.group)) {
    renderFatal("No tienes permisos para ver este grupo.");
    return;
  }

  // Si el usuario actual es vendedor, el grupo le corresponde
  // y está en "A contactar", al abrirlo pasa automáticamente a "Contactado".
  // saveGroupPatch recargará la ficha y dejará historial.
  if (await autoMarkVendorGroupAsContactedOnOpen()) {
    return;
  }

  await Promise.all([
    loadMeetings(),
    loadHistory(),
    loadManualAlerts(),
    loadRequests()
  ]);

  state.autoAlerts = buildAutomaticAlerts();
  renderGroup();
}

async function resolveGroupByParam(id) {
  const directRef = doc(db, "ventas_cotizaciones", String(id));
  const directSnap = await getDoc(directRef);

  if (directSnap.exists()) {
    return {
      docId: directSnap.id,
      groupId: String(directSnap.data()?.idGrupo || directSnap.id),
      data: directSnap.data() || {}
    };
  }

  const q = query(
    collection(db, "ventas_cotizaciones"),
    where("idGrupo", "==", String(id))
  );

  const snap = await getDocs(q);
  if (snap.empty) return null;

  const first = snap.docs[0];
  return {
    docId: first.id,
    groupId: String(first.data()?.idGrupo || first.id),
    data: first.data() || {}
  };
}

async function loadMeetings() {
  state.meetings = [];

  try {
    const snap = await getDocs(
      query(collection(db, REUNIONES_COLLECTION), where("idGrupo", "==", String(state.groupId)))
    );

    state.meetings = snap.docs
      .map((d) => ({
        id: d.id,
        ...d.data()
      }))
      .sort((a, b) => dateValue(b.fechaInicio) - dateValue(a.fechaInicio));
  } catch (error) {
    console.error("[grupo] loadMeetings", error);
  }
}

async function loadHistory() {
  state.history = [];

  try {
    const snap = await getDocs(
      query(collection(db, HISTORIAL_COLLECTION), where("idGrupo", "==", String(state.groupId)))
    );

    state.history = snap.docs
      .map((d) => ({
        id: d.id,
        ...d.data()
      }))
      .sort((a, b) => dateValue(b.fecha) - dateValue(a.fecha));
  } catch (error) {
    console.error("[grupo] loadHistory", error);
  }
}

async function loadManualAlerts() {
  state.alertsManual = [];

  try {
    const snap = await getDocs(
      query(collection(db, ALERTAS_COLLECTION), where("idGrupo", "==", String(state.groupId)))
    );

    state.alertsManual = snap.docs
      .map((d) => ({
        id: d.id,
        ...d.data()
      }))
      .filter((item) => item.activa !== false && item.resuelta !== true)
      .sort((a, b) => dateValue(b.fechaCreacion) - dateValue(a.fechaCreacion));
  } catch (error) {
    console.error("[grupo] loadManualAlerts", error);
  }
}

async function loadRequests() {
  state.requests = [];

  try {
    const snap = await getDocs(
      query(collection(db, SOLICITUDES_COLLECTION), where("idGrupo", "==", String(state.groupId)))
    );

    state.requests = snap.docs
      .map((d) => ({
        id: d.id,
        ...d.data()
      }))
      .sort((a, b) => dateValue(b.fechaSolicitud) - dateValue(a.fechaSolicitud));
  } catch (error) {
    console.error("[grupo] loadRequests", error);
  }
}

/* =========================================================
   ACCESS
========================================================= */
function canAccessGroup(groupData = {}) {
  if (state.canSeeAll) return true;

  const rowVendorEmail = normalizeEmail(groupData.vendedoraCorreo || "");
  if (rowVendorEmail && rowVendorEmail === state.effectiveEmail) return true;

  const vendorName = normalizeSearchLocal(groupData.vendedora || "");
  const currentFull = normalizeSearchLocal(
    [state.effectiveUser?.nombre, state.effectiveUser?.apellido].filter(Boolean).join(" ")
  );

  if (currentFull && vendorName.includes(currentFull)) return true;

  const aliases = Array.isArray(state.effectiveUser?.aliascartera)
    ? state.effectiveUser.aliascartera.map(normalizeSearchLocal)
    : [];

  return aliases.some((alias) => alias && vendorName.includes(alias));
}

function canEditGroup() {
  if (!state.canModify) return false;

  const isVendor = String(state.effectiveUser?.rol || "").toLowerCase() === "vendedor";

  if (isVendor && isVendorLockedByFlow(state.group)) {
    return false;
  }

  if (state.group?.autorizada && isVendor) {
    return false;
  }

  return canAccessGroup(state.group);
}

function canEditDocuments() {
  const rol = String(state.effectiveUser?.rol || "").toLowerCase();
  return rol === "admin" || rol === "supervision";
}

function canManageHistoryItems() {
  return canAccessGroup(state.group);
}

function isEffectiveVendorRole() {
  return String(state.effectiveUser?.rol || "").toLowerCase() === "vendedor";
}

function shouldAutoMarkVendorGroupAsContacted(groupData = {}) {
  return (
    isEffectiveVendorRole() &&
    canAccessGroup(groupData) &&
    normalizeState(groupData.estado) === "a_contactar"
  );
}

function getEstadoChangeFromCambios(cambios = []) {
  return Array.isArray(cambios)
    ? cambios.find((item) => String(item?.campo || "").trim() === "estado")
    : null;
}

function applyEstadoAuditFields(patch = {}, cambios = []) {
  const estadoChange = getEstadoChangeFromCambios(cambios);
  if (!estadoChange) return;

  // Marca visual para la ficha y panel de situación
  patch.fechaUltimoCambioEstado = serverTimestamp();
  setNestedValue(patch, "situacion.fechaUltimoCambioEstado", serverTimestamp());

  // También deja huella como última gestión
  if (!("ultimaGestionAt" in patch)) {
    patch.ultimaGestionAt = serverTimestamp();
  }

  if (!("ultimaGestionTipo" in patch)) {
    patch.ultimaGestionTipo = "cambio_estado";
  }
}

async function autoMarkVendorGroupAsContactedOnOpen() {
  if (!shouldAutoMarkVendorGroupAsContacted(state.group)) return false;

  await saveGroupPatch(
    {
      estado: "contactado"
    },
    {
      tipoMovimiento: "cambio_estado",
      modulo: "grupo",
      titulo: "Cambio automático de estado",
      mensaje: `${getDisplayName(state.effectiveUser)} abrió el grupo y el sistema cambió el estado de A contactar a Contactado.`,
      cambios: [
        {
          campo: "estado",
          anterior: normalizeState(state.group.estado),
          nuevo: "contactado"
        }
      ]
    }
  );

  return true;
}

function isJefaVentas() {
  return normalizeEmail(state.effectiveEmail) === "chernandez@raitrai.cl" || state.effectiveUser?.rol === "admin";
}

function isAdministracion() {
  const email = normalizeEmail(state.effectiveEmail || "");
  const rol = String(state.effectiveUser?.rol || "").toLowerCase();

  if (rol === "admin") return true;

  return (
    email === "yenny@raitrai.cl" ||
    email === "administracion@raitrai.cl"
  );
}

function getFichaFlowMode(groupData = {}) {
  const flow = groupData.flowFicha || {};
  const ficha = groupData.ficha || {};

  return normalizeSearchLocal(
    groupData.fichaFlujoModo ||
    flow.modo ||
    ficha.flujoModo ||
    ""
  );
}

function isV2FichaFlow(groupData = {}) {
  return getFichaFlowMode(groupData) === "v2";
}

function isVendorLockedByFlow(groupData = {}) {
  const flow = groupData.flowFicha || {};
  return isV2FichaFlow(groupData) && !!flow?.vendedor?.firmado;
}

function canCreateFichaFromEstado() {
  return normalizeState(state.group?.estado) === "ganada";
}

function getFichaSummary() {
  const ficha = getByPath(state.group, "ficha") || {};

  const numeroNegocio =
    state.group.numeroNegocio ??
    ficha.numeroNegocio ??
    "";

  const version =
    state.group.versionFicha ||
    ficha.version ||
    "";

  const fechaActualizacion =
    state.group.fechaActualizacionFicha ||
    ficha.fechaActualizacion ||
    "";

  const pdfUrl =
    cleanText(
      state.group.fichaPdfUrl ||
      ficha.pdfUrl ||
      ficha.urlPdf ||
      ""
    );

  const pdfNombre =
    cleanText(
      state.group.fichaPdfNombre ||
      ficha.pdfNombre ||
      ficha.nombrePdf ||
      ""
    );

  const estadoRaw =
    state.group.fichaEstado ||
    ficha.estado ||
    (pdfUrl || numeroNegocio || version ? "ok" : "pendiente");

  const programa =
    cleanText(
      ficha.nombrePrograma ||
      state.group.programa ||
      ""
    );

  const tramo =
    cleanText(
      ficha.tramo ||
      state.group.tramo ||
      ""
    );

  const hotel =
    cleanText(
      ficha.categoriaHoteleraContratada ||
      state.group.categoriaHoteleraContratada ||
      state.group.hotel ||
      state.group.solicitudHotel ||
      ""
    );

  // Fecha tentativa:
  // 1) semanaViaje del grupo
  // 2) fechaViajeTexto de ficha
  // 3) fechaViaje real si existe
  const fechaTentativa =
    cleanText(
      state.group.semanaViaje ||
      ficha.fechaViajeTexto ||
      ""
    ) ||
    (toDate(state.group.fechaViaje) ? formatDate(state.group.fechaViaje) : "");

  return {
    exists: Boolean(
      pdfUrl ||
      numeroNegocio ||
      version ||
      fechaActualizacion ||
      Object.keys(ficha).length
    ),
    estadoLabel: getFichaEstadoLabel(estadoRaw),
    numeroNegocio: stringValue(numeroNegocio) || "—",
    version: stringValue(version) || "—",
    fechaActualizacion: toDate(fechaActualizacion)
      ? formatDate(fechaActualizacion)
      : (stringValue(fechaActualizacion) || "—"),
    pdfUrl,
    pdfNombre: pdfNombre || "PDF ficha",

    // Resumen visual rápido
    programa: programa || "—",
    tramo: tramo || "—",
    hotel: hotel || "—",
    fechaTentativa: fechaTentativa || "—"
  };
}

function renderFichaPanel() {
  const box = $("panelFichaViajeBody");
  if (!box) return;

  const ficha = getFichaSummary();
  const isGanada = canCreateFichaFromEstado();
  const vendorLocked = isVendorLockedByFlow(state.group);

  if (!isGanada && !ficha.exists) {
    box.innerHTML = `
      <div class="empty-box">
        La ficha de viaje se habilita cuando el grupo está en estado GANADA.
      </div>
    `;
    return;
  }

  let regla = "La ficha solo puede crearse cuando el grupo está Ganada.";

  if (isGanada) {
    regla = ficha.exists
      ? "Este grupo ya tiene ficha y puedes entrar a revisarla."
      : "Este grupo ya puede crear su ficha.";
  }

  if (vendorLocked) {
    regla = "La ficha ya fue firmada por vendedor(a). Desde este portafolio solo se puede ver.";
  }

  box.innerHTML = `
    <div class="grupo-kpi-list">
      <div class="grupo-kpi">
        <div class="info-label">Estado ficha</div>
        <div class="info-value">${escapeHtml(ficha.estadoLabel)}</div>
      </div>

      <div class="grupo-kpi">
        <div class="info-label">Versión ficha</div>
        <div class="info-value">${escapeHtml(ficha.version)}</div>
      </div>

      <div class="grupo-kpi">
        <div class="info-label">Número negocio</div>
        <div class="info-value">${escapeHtml(ficha.numeroNegocio)}</div>
      </div>

      <div class="grupo-kpi">
        <div class="info-label">Fecha actualización ficha</div>
        <div class="info-value">${escapeHtml(ficha.fechaActualizacion)}</div>
      </div>
    </div>

    <div class="grupo-ficha-focus">
      <div class="grupo-ficha-focus-head"><Importante:</div>

      <div class="grupo-ficha-focus-grid">
        <div class="grupo-ficha-focus-item is-highlight">
          <div class="grupo-ficha-focus-label">Programa</div>
          <div class="grupo-ficha-focus-value">${escapeHtml(ficha.programa || "—")}</div>
        </div>

        <div class="grupo-ficha-focus-item">
          <div class="grupo-ficha-focus-label">Tramo</div>
          <div class="grupo-ficha-focus-value">${escapeHtml(ficha.tramo || "—")}</div>
        </div>

        <div class="grupo-ficha-focus-item">
          <div class="grupo-ficha-focus-label">Hotel</div>
          <div class="grupo-ficha-focus-value">${escapeHtml(ficha.hotel || "—")}</div>
        </div>

        <div class="grupo-ficha-focus-item is-highlight">
          <div class="grupo-ficha-focus-label">Fecha tentativa</div>
          <div class="grupo-ficha-focus-value">${escapeHtml(ficha.fechaTentativa || "—")}</div>
        </div>
      </div>
    </div>

    <div class="info-stack" style="margin-top:16px;">
      <div class="info-item">
        <div class="info-label">PDF ficha</div>
        <div class="info-value">
          ${escapeHtml(ficha.pdfUrl ? ficha.pdfNombre : "Sin PDF generado")}
        </div>
      </div>

      <div class="info-item">
        <div class="info-label">Regla de habilitación</div>
        <div class="info-value">${escapeHtml(regla)}</div>
      </div>
    </div>

    <div class="grupo-ficha-note">
      <strong>Tip visual:</strong> aquí quedan arriba los datos que más necesitas para ubicarte rápido, sin tener que leer toda la ficha ni todo el grupo.
    </div>
  `;
}

function openFichaEditor() {
  if (!canCreateFichaFromEstado()) {
    alert("La ficha solo se habilita cuando el grupo está en estado GANADA.");
    return;
  }

  location.href = `fichas.html?id=${encodeURIComponent(state.groupId)}`;
}

function openFichaPdf() {
  const ficha = getFichaSummary();

  if (!ficha.pdfUrl) {
    alert("Este grupo todavía no tiene un PDF de ficha generado.");
    return;
  }

  window.open(ficha.pdfUrl, "_blank", "noopener");
}

function prioritizeFichaPanelInLayout() {
  const fichaPanel = $("panelFichaViaje");
  const datosPanel = $("panelDatosGrupo");

  if (!fichaPanel || !datosPanel) return;
  if (!fichaPanel.parentElement || fichaPanel.parentElement !== datosPanel.parentElement) return;

  const parent = fichaPanel.parentElement;

  // Si está ganada, la ficha pasa a ser más importante visualmente.
  if (normalizeState(state.group?.estado) === "ganada") {
    parent.insertBefore(fichaPanel, datosPanel);
    return;
  }

  // En cualquier otro estado, dejamos primero los datos.
  parent.insertBefore(datosPanel, fichaPanel);
}

function getFichaMainButtonMode() {
  const ficha = getFichaSummary();
  const isGanada = canCreateFichaFromEstado();
  const editable = canEditGroup();
  const vendorLocked = isVendorLockedByFlow(state.group);

  // Regla única y coherente:
  // la ficha solo se puede abrir cuando el grupo está GANADA.
  if (!isGanada) {
    return {
      label: ficha.exists ? "Ficha bloqueada" : "Crear ficha",
      disabled: true
    };
  }

  // Si el vendedor ya firmó, desde grupo solo debe verla.
  if (vendorLocked) {
    return {
      label: "Ver ficha",
      disabled: false
    };
  }

  // Si está ganada, crear o editar según exista.
  if (editable) {
    return {
      label: ficha.exists ? "Editar ficha" : "Crear ficha",
      disabled: false
    };
  }

  // Si no puede editar pero sí está ganada y ya existe, puede verla.
  if (ficha.exists) {
    return {
      label: "Ver ficha",
      disabled: false
    };
  }

  return {
    label: "Crear ficha",
    disabled: true
  };
}

/* =========================================================
   RENDER
========================================================= */
function renderGroup() {
  renderHero();
  renderSituacion();
  renderDatos();
  renderFichaPanel();
  renderDocs();
  renderMeetings();
  renderAlerts();
  renderHistory();

  // Reordena visualmente los paneles para priorizar ficha cuando el grupo está ganada
  prioritizeFichaPanelInLayout();

  syncButtons();
}

function renderHero() {
  const title =
    cleanText(state.group.aliasGrupo) ||
    cleanText(state.group.nombreGrupo) ||
    cleanText(state.group.colegio) ||
    `Grupo ${state.groupId}`;

  setText("heroTitle", title);
  setText("heroColegio", state.group.colegio || "—");
  setText("heroAnoViaje", state.group.anoViaje || "—");
  setText("heroVendedora", state.group.vendedora || state.group.vendedoraCorreo || "—");
  setText("heroIdGrupo", state.groupId);

  renderHeroLogo();
  renderHeroBadges();

  const nextMeeting = getNextMeeting();
  if (nextMeeting) {
    setText("heroProximaReunion", formatDateTime(nextMeeting.fechaInicio));
    setText(
      "heroProximaReunionSub",
      `${capitalize(nextMeeting.tipo || "reunión")} · ${meetingPlaceLabel(nextMeeting)}`
    );
  } else {
    setText("heroProximaReunion", "Sin reunión");
    setText("heroProximaReunionSub", "No hay reuniones agendadas");
  }

  const ultimaGestion = toDate(
    state.group.ultimaGestionAt ||
    state.group.fechaActualizacion ||
    null
  );
  setText("heroUltimaGestion", ultimaGestion ? formatDate(ultimaGestion) : "—");
  setText(
    "heroUltimaGestionSub",
    ultimaGestion
      ? `${state.group.ultimaGestionTipo || "Actualización"} · ${formatTime(ultimaGestion)}`
      : "Sin historial reciente"
  );

  const fichaLabel = getFichaEstadoLabel(state.group.fichaEstado);
  setText("heroFichaEstado", fichaLabel);
  setText(
    "heroFichaEstadoSub",
    state.group.autorizada ? "Grupo autorizado para operaciones" : "Flujo pendiente"
  );

  const autoCount = state.autoAlerts.length;
  const manualCount = state.alertsManual.length;
  setText("heroAlertasActivas", autoCount + manualCount);
  setText("heroAlertasActivasSub", `${autoCount} automáticas / ${manualCount} manuales`);
}

function renderHeroLogo() {
  const wrap = $("grupoLogoWrap");
  if (!wrap) return;

  const url = cleanText(state.group.logoColegioUrl || "");
  const baseText =
    cleanText(state.group.colegio) ||
    cleanText(state.group.aliasGrupo) ||
    cleanText(state.group.nombreCliente) ||
    state.groupId;

  if (url) {
    wrap.innerHTML = `<img src="${escapeHtml(url)}" alt="${escapeHtml(baseText)}" />`;
    return;
  }

  wrap.textContent = getInitials(baseText);
}

function renderHeroBadges() {
  const box = $("heroBadges");
  if (!box) return;

  const estado = normalizeState(state.group.estado);
  const estadoMeta = ESTADO_META[estado] || ESTADO_META.a_contactar;

  box.innerHTML = `
    <span class="g-badge ${estadoMeta.css}">
      Estado: ${escapeHtml(estadoMeta.label)}
    </span>

    <span class="g-badge ${state.group.autorizada ? "is-ok" : "is-muted"}">
      ${state.group.autorizada ? "Autorizada" : "No autorizada"}
    </span>

    <span class="g-badge ${state.group.cerrada ? "is-ok" : "is-muted"}">
      ${state.group.cerrada ? "Cerrada" : "Abierta"}
    </span>
  `;
}

function renderSituacion() {
  const fechaCambioEstado =
    state.group.fechaUltimoCambioEstado ||
    getByPath(state.group, "situacion.fechaUltimoCambioEstado") ||
    null;

  const fechaCambioEstadoTxt = toDate(fechaCambioEstado)
    ? formatDateTime(fechaCambioEstado)
    : (stringValue(fechaCambioEstado) || "—");

  const estadoNormalizado = normalizeState(state.group.estado);
  const isGanada = estadoNormalizado === "ganada";

  setText("situacionEstado", getEstadoLabel(state.group.estado));
  setText("situacionAutorizacion", state.group.autorizada ? "Autorizada" : "No autorizada");
  setText("situacionCierre", state.group.cerrada ? "Cerrada" : "Abierta");
  setText("situacionProximoPaso", getByPath(state.group, "situacion.proximoPaso") || "—");
  setText("situacionUltimoCambioEstado", fechaCambioEstadoTxt);

  const obsAdmin = sanitizeRichHtml(
    getByPath(state.group, "situacion.observacionAdministracion") ||
    state.group.observacionesAdministracion ||
    ""
  ) || "—";

  const obsOps = sanitizeRichHtml(
    getByPath(state.group, "situacion.observacionOperaciones") ||
    state.group.observacionesOperaciones ||
    ""
  ) || "—";

  const adminWrap = $("situacionObsAdminWrap");
  const opsWrap = $("situacionObsOperacionesWrap");
  const adminEl = $("situacionObsAdmin");
  const opsEl = $("situacionObsOperaciones");

  adminWrap?.classList.toggle("hidden", !isGanada);
  opsWrap?.classList.toggle("hidden", !isGanada);

  if (adminEl) {
    adminEl.innerHTML = isGanada
      ? `
        <div class="obs-box admin">
          <div class="obs-title">Observaciones para administración</div>
          <div class="obs-body">${obsAdmin}</div>
        </div>
      `
      : "";
  }

  if (opsEl) {
    opsEl.innerHTML = isGanada
      ? `
        <div class="obs-box ops">
          <div class="obs-title">Observaciones para operaciones</div>
          <div class="obs-body">${obsOps}</div>
        </div>
      `
      : "";
  }

  const box = $("panelProximaReunion");
  if (!box) return;

  const nextMeeting = getNextMeeting();
  if (!nextMeeting) {
    box.innerHTML = `<div class="empty-box">No hay reuniones agendadas para este grupo.</div>`;
    return;
  }

  box.innerHTML = `
    <div class="obs-box">
      <div class="obs-title">Próxima reunión agendada</div>
      <div class="obs-body">
        <p><strong>Fecha:</strong> ${escapeHtml(formatDateTime(nextMeeting.fechaInicio))}</p>
        <p><strong>Tipo:</strong> ${escapeHtml(capitalize(nextMeeting.tipo || "—"))}</p>
        <p><strong>Lugar / link:</strong> ${escapeHtml(meetingPlaceLabel(nextMeeting))}</p>
        <p><strong>Observaciones:</strong> ${escapeHtml(nextMeeting.observaciones || "Sin observaciones")}</p>
      </div>
    </div>
  `;
}

function renderDatos() {
  const grid = $("datosGrupoGrid");
  if (!grid) return;

  const items = [
    itemData("Colegio", state.group.colegio, true),
    itemData("Curso", state.group.curso),
    itemData("Año viaje", state.group.anoViaje),
    itemData("Cantidad grupo", state.group.cantidadGrupo),

    itemData("Destino principal", state.group.destinoPrincipal, true),
    itemData("Programa", state.group.programa, true),
    itemData("Tramo", state.group.tramo),
    itemData("Semana viaje", state.group.semanaViaje),
    itemData("Comuna / ciudad", state.group.comunaCiudad),

    itemData("Vendedor(a)", state.group.vendedora || state.group.vendedoraCorreo, true),

    itemData("1° Contacto", state.group.nombreCliente),
    itemData("Rol 1° Contacto", state.group.rolCliente),
    itemData("Correo 1° Contacto", state.group.correoCliente),
    itemData("Celular 1° Contacto", state.group.celularCliente),

    itemData("2° Contacto", state.group.nombreCliente2),
    itemData("Rol 2° Contacto", state.group.rolCliente2),
    itemData("Correo 2° Contacto", state.group.correoCliente2),
    itemData("Celular 2° Contacto", state.group.celularCliente2)
  ];

  grid.className = "grupo-data-card-grid";

  grid.innerHTML = items.map((item) => `
    <div class="grupo-data-card ${item.full ? "full is-strong" : ""}">
      <div class="info-label">${escapeHtml(item.label)}</div>
      <div class="info-value">${escapeHtml(item.value || "—")}</div>
    </div>
  `).join("");
}

function renderDocs() {
  const docsChips = $("docsChips");
  const flowSteps = $("flowSteps");

  if (docsChips) {
    docsChips.innerHTML = `
      ${renderDocChip("fichaMedicaEstado", state.group.fichaMedicaEstado)}
      ${renderDocChip("nominaEstado", state.group.nominaEstado)}
      ${renderDocChip("fichaEstado", state.group.fichaEstado)}
      ${renderDocChip("contratoEstado", state.group.contratoEstado)}
      ${renderDocChip("cortesiaEstado", state.group.cortesiaEstado)}
    `;
  }

  const flow = state.group.flowFicha || {};

  if (flowSteps) {
    flowSteps.innerHTML = `
      ${renderFlowStep("Vendedor(a)", flow?.vendedor)}
      ${renderFlowStep("Jefa de ventas", flow?.jefaVentas)}
      ${renderFlowStep("Administración", flow?.administracion)}
    `;
  }
}

function renderMeetings() {
  const list = $("meetingsList");
  if (!list) return;

  if (!state.meetings.length) {
    list.innerHTML = `<div class="empty-box">Todavía no hay reuniones registradas para este grupo.</div>`;
    return;
  }

  list.innerHTML = state.meetings.map((meeting) => `
    <div class="list-card">
      <div class="list-card-top">
        <div>
          <div class="list-card-title">${escapeHtml(meeting.titulo || "Reunión")}</div>
          <div class="list-card-meta">
${escapeHtml(formatDateTime(meeting.fechaInicio))}
${escapeHtml(capitalize(meeting.tipo || "reunión"))} · ${escapeHtml(meeting.estadoReunion || "agendada")}
${escapeHtml(meetingPlaceLabel(meeting))}
          </div>
        </div>

        <div class="doc-chip ${docStateClass(meeting.estadoReunion === "cancelada" ? "no_aplica" : meeting.estadoReunion === "realizada" ? "ok" : "pendiente")}">
          ${escapeHtml(capitalize(meeting.estadoReunion || "agendada"))}
        </div>
      </div>

      <div class="list-card-meta">
        ${escapeHtml(meeting.observaciones || "Sin observaciones")}
      </div>
    </div>
  `).join("");
}

function renderAlerts() {
  const list = $("alertsList");
  if (!list) return;

  const merged = [
    ...state.autoAlerts.map((item) => ({ ...item, tipoLista: "auto" })),
    ...state.alertsManual.map((item) => ({ ...item, tipoLista: "manual" }))
  ];

  if (!merged.length) {
    list.innerHTML = `<div class="empty-box">No hay alertas activas para este grupo.</div>`;
    return;
  }

  const levelOrder = { critica: 3, warning: 2, info: 1 };

  const sorted = [...merged].sort((a, b) => {
    const nivelA = normalizeSearchLocal(a.nivel || "info");
    const nivelB = normalizeSearchLocal(b.nivel || "info");

    const diffNivel = (levelOrder[nivelB] || 0) - (levelOrder[nivelA] || 0);
    if (diffNivel !== 0) return diffNivel;

    return dateValue(b.fechaCreacion || b.fecha || null) - dateValue(a.fechaCreacion || a.fecha || null);
  });

  list.innerHTML = sorted.map((alertItem) => {
    const isManual = alertItem.tipoLista === "manual";
    const levelClass = normalizeSearchLocal(alertItem.nivel) === "critica" ? "alert-critical" : "";
    const baseClass = isManual ? "alert-manual" : "alert-auto";

    const author = isManual
      ? (alertItem.creadoPor || alertItem.creadoPorCorreo || "Sin autor")
      : "Sistema";

    const dateLabel = isManual && alertItem.fechaCreacion
      ? formatDateTime(alertItem.fechaCreacion)
      : "En tiempo real";

    const levelLabel = normalizeSearchLocal(alertItem.nivel) === "critica"
      ? "Crítica"
      : normalizeSearchLocal(alertItem.nivel) === "warning"
        ? "Pendiente"
        : "Info";

    return `
      <article class="registro-card registro-alert-card ${baseClass} ${levelClass}">
        <div class="registro-card-top">
          <div class="registro-meta-row">
            <span>${escapeHtml(author)}</span>
            <span>·</span>
            <span>${escapeHtml(dateLabel)}</span>
          </div>

          <div class="registro-card-actions">
            <span class="registro-tag">${isManual ? "Manual" : "Automática"}</span>
            <span class="registro-tag is-soft">${escapeHtml(levelLabel)}</span>

            ${
              isManual && canEditGroup()
                ? `<button class="btn-danger" type="button" data-action="resolver-alerta" data-id="${escapeHtml(alertItem.id)}">Resolver</button>`
                : ""
            }
          </div>
        </div>

        <div class="registro-title">${escapeHtml(alertItem.titulo || "Alerta")}</div>
        <div class="registro-message">${escapeHtml(alertItem.mensaje || "Sin mensaje")}</div>
      </article>
    `;
  }).join("");
}

function renderHistory() {
  const list = $("historyList");
  const note = $("historyToolbarNote");
  const btnMore = $("btnHistoryMore");
  const btnToggleHidden = $("btnHistoryToggleHidden");

  if (!list) return;

  const canManage = canManageHistoryItems();
  const allItems = [...state.history];
  const hiddenCount = allItems.filter((item) => item.oculto === true).length;

  if (btnToggleHidden) {
    btnToggleHidden.classList.toggle("hidden", !canManage);

    if (canManage) {
      btnToggleHidden.textContent = state.historyUi.showHidden
        ? `Ocultar ocultos (${hiddenCount})`
        : `Ver ocultos (${hiddenCount})`;

      btnToggleHidden.disabled = hiddenCount === 0 && !state.historyUi.showHidden;
    }
  }

  const visibleItems = allItems
    .filter((item) => state.historyUi.showHidden || item.oculto !== true)
    .sort((a, b) => {
      const featuredDiff = Number(!!b.destacado) - Number(!!a.destacado);
      if (featuredDiff !== 0) return featuredDiff;
      return dateValue(b.fecha) - dateValue(a.fecha);
    });

  const shownItems = visibleItems.slice(0, state.historyUi.limit);

  if (note) {
    if (!visibleItems.length) {
      note.textContent = hiddenCount > 0 && !state.historyUi.showHidden
        ? `No hay registros visibles. Hay ${hiddenCount} oculto(s).`
        : "Todavía no hay historial registrado para este grupo.";
    } else {
      note.textContent = `Mostrando ${shownItems.length} de ${visibleItems.length} registro(s)` +
        (hiddenCount ? ` · ocultos: ${hiddenCount}` : "");
    }
  }

  if (!shownItems.length) {
    list.innerHTML = `<div class="empty-box">Todavía no hay historial visible para este grupo.</div>`;

    if (btnMore) {
      btnMore.classList.add("hidden");
    }
    return;
  }

  list.innerHTML = shownItems.map((item) => {
    const cambiosDetallados =
      Array.isArray(item?.metadata?.cambiosDetallados) && item.metadata.cambiosDetallados.length
        ? item.metadata.cambiosDetallados
        : buildDetailedChanges(
            Array.isArray(item?.metadata?.cambios) ? item.metadata.cambios : []
          );

    const tipo = getHistoryTypeLabel(item);
    const cssType = getHistoryCardClass(item);
    const encabezado = item.asunto || item.titulo || "Movimiento";
    const autor = item.creadoPor || item.creadoPorCorreo || "Sin usuario";
    const fecha = item.fecha ? formatDateTime(item.fecha) : "Sin fecha";
    const fullMessage = cleanText(item.mensaje || "Sin detalle");
    const previewMessage = truncateHistoryMessage(fullMessage, 220);

    const detailItems = cambiosDetallados.map((c) => {
      if (c.tipoCambio === "agregado") {
        return `<li><strong>Agregado</strong> · ${escapeHtml(prettyLabel(c.campo))}: ${escapeHtml(c.nuevoPreview || "sin valor")}</li>`;
      }

      if (c.tipoCambio === "eliminado") {
        return `<li><strong>Eliminado</strong> · ${escapeHtml(prettyLabel(c.campo))}: ${escapeHtml(c.anteriorPreview || "sin valor")}</li>`;
      }

      return `<li><strong>Modificado</strong> · ${escapeHtml(prettyLabel(c.campo))}: ${escapeHtml(c.anteriorPreview || "vacío")} → ${escapeHtml(c.nuevoPreview || "vacío")}</li>`;
    }).join("");

    const hasLongMessage = fullMessage.length > 220;
    const hasDetails = hasLongMessage || cambiosDetallados.length > 0;

    return `
      <article class="registro-card ${cssType} ${item.destacado ? "is-featured" : ""} ${item.oculto ? "is-hidden-item" : ""}">
        <div class="registro-card-top">
          <div class="registro-meta-row">
            <span>${escapeHtml(autor)}</span>
            <span>·</span>
            <span>${escapeHtml(fecha)}</span>
          </div>

          <div class="registro-card-actions">
            <span class="registro-tag">${escapeHtml(tipo)}</span>
            ${item.destacado ? `<span class="registro-tag is-featured">Destacado</span>` : ""}
            ${item.oculto ? `<span class="registro-tag is-hidden">Oculto</span>` : ""}

            ${
              canManage
                ? `<button class="btn-icon-lite" type="button" title="${item.destacado ? "Quitar destacado" : "Destacar"}" data-action="toggle-history-star" data-id="${escapeHtml(item.id)}">${item.destacado ? "★" : "☆"}</button>`
                : ""
            }

            ${
              canManage
                ? `<button class="btn-icon-lite" type="button" title="${item.oculto ? "Mostrar" : "Ocultar"}" data-action="toggle-history-hidden" data-id="${escapeHtml(item.id)}">${item.oculto ? "👁" : "🙈"}</button>`
                : ""
            }
          </div>
        </div>

        <div class="registro-title">${escapeHtml(encabezado)}</div>
        <div class="registro-message">${escapeHtml(previewMessage || "Sin detalle")}</div>

        ${
          hasDetails
            ? `
              <button
                class="btn-link-lite"
                type="button"
                data-action="toggle-history-detail"
                data-target="history-detail-${escapeHtml(item.id)}"
              >
                Ver más
              </button>

              <div class="registro-detail hidden" id="history-detail-${escapeHtml(item.id)}">
                ${
                  hasLongMessage
                    ? `
                      <div class="registro-detail-block">
                        <div class="registro-detail-label">Mensaje completo</div>
                        <div class="registro-detail-text">${escapeHtml(fullMessage)}</div>
                      </div>
                    `
                    : ""
                }

                ${
                  cambiosDetallados.length
                    ? `
                      <div class="registro-detail-block">
                        <div class="registro-detail-label">Detalle</div>
                        <ul class="registro-detail-list">${detailItems}</ul>
                      </div>
                    `
                    : ""
                }
              </div>
            `
            : ""
        }
      </article>
    `;
  }).join("");

  if (btnMore) {
    const remaining = visibleItems.length - shownItems.length;

    if (remaining > 0) {
      btnMore.classList.remove("hidden");
      btnMore.textContent = `Ver más (${remaining} restantes)`;
    } else {
      btnMore.classList.add("hidden");
    }
  }
}

function syncButtons() {
  const editable = canEditGroup();
  const isGanada = normalizeState(state.group.estado) === "ganada";
  const autorizada = !!state.group.autorizada;
  const ficha = getFichaSummary();

  [
    "btnEditarDatosHero",
    "btnEditarDatos",
    "btnEditarSituacionHero",
    "btnEditarSituacion",
    "btnNuevaReunionHero",
    "btnNuevaReunion",
    "btnNuevaReunionListado",
    "btnNuevaAlertaHero",
    "btnNuevaAlerta"
  ].forEach((id) => {
    const el = $(id);
    if (el) el.disabled = !editable;
  });

  const btnEditarDocumentos = $("btnEditarDocumentos");
  if (btnEditarDocumentos) {
    const canDocs = canEditDocuments();
    btnEditarDocumentos.disabled = !canDocs;
    btnEditarDocumentos.classList.toggle("hidden", !canDocs);
  }

  const btnFicha = $("btnCrearFicha");
  if (btnFicha) {
    const fichaButtonMode = getFichaMainButtonMode();
  
    btnFicha.textContent = fichaButtonMode.label;
    btnFicha.disabled = fichaButtonMode.disabled;
  }

  const btnAbrirFichaPdf = $("btnAbrirFichaPdf");
  if (btnAbrirFichaPdf) btnAbrirFichaPdf.disabled = !ficha.pdfUrl;

  const btnContrato = $("btnCrearContrato");
  if (btnContrato) btnContrato.disabled = !autorizada;

  const flow = state.group.flowFicha || {};
  const btnVend = $("btnFirmarVendedor");
  const btnJefa = $("btnFirmarJefaVentas");
  const btnAdmin = $("btnFirmarAdministracion");

  if (btnVend) {
    btnVend.disabled = !editable || !isGanada || !!flow?.vendedor?.firmado;
  }

  if (btnJefa) {
    btnJefa.disabled = !isJefaVentas() || !flow?.vendedor?.firmado || !!flow?.jefaVentas?.firmado;
  }

  if (btnAdmin) {
    btnAdmin.disabled = !isAdministracion() || !flow?.jefaVentas?.firmado || !!flow?.administracion?.firmado;
  }
}

function renderFatal(message) {
  const shell = document.querySelector(".grupo-shell");
  if (!shell) return;

  shell.innerHTML = `
    <div class="grupo-panel">
      <div class="grupo-panel-body">
        <div class="empty-box">${escapeHtml(message)}</div>
      </div>
    </div>
  `;
}

/* =========================================================
   AUTO ALERTS
========================================================= */
function buildAutomaticAlerts() {
  const list = [];
  const nextMeeting = getNextMeeting();

  if (nextMeeting) {
    const diff = daysBetween(nowDate(), toDate(nextMeeting.fechaInicio));

    if (diff >= 0 && diff <= 3) {
      list.push({
        id: `auto-reunion-${state.groupId}`,
        nivel: "info",
        titulo: "Reunión próxima",
        mensaje: `El grupo tiene reunión ${capitalize(nextMeeting.tipo || "presencial")} el ${formatDateTime(nextMeeting.fechaInicio)}.`
      });
    }

    if (diff < 0 && normalizeSearchLocal(nextMeeting.estadoReunion) === "agendada") {
      list.push({
        id: `auto-reunion-vencida-${state.groupId}`,
        nivel: "warning",
        titulo: "Reunión vencida sin cierre",
        mensaje: "Hay una reunión pasada que sigue marcada como agendada."
      });
    }
  }

  if (normalizeState(state.group.estado) === "ganada" && normalizeSearchLocal(state.group.fichaEstado) === "pendiente") {
    list.push({
      id: `auto-ficha-${state.groupId}`,
      nivel: "warning",
      titulo: "Ganada sin ficha",
      mensaje: "El grupo está ganado, pero la ficha todavía no se ha iniciado."
    });
  }

  if (normalizeSearchLocal(state.group.fichaEstado) === "lista_vendedor") {
    list.push({
      id: `auto-jefa-${state.groupId}`,
      nivel: "warning",
      titulo: "Pendiente firma jefa de ventas",
      mensaje: "La ficha quedó lista por vendedor(a) y espera revisión de jefa de ventas."
    });
  }

  if (normalizeSearchLocal(state.group.fichaEstado) === "revisada_jefa_ventas" && !state.group.autorizada) {
    list.push({
      id: `auto-admin-${state.groupId}`,
      nivel: "warning",
      titulo: "Pendiente firma administración",
      mensaje: "La ficha ya fue revisada por jefa de ventas y ahora espera firma de administración."
    });
  }

  const pendingRequests = state.requests.filter(
    (item) => normalizeSearchLocal(item.estadoSolicitud) === "pendiente"
  ).length;

  if (pendingRequests > 0) {
    list.push({
      id: `auto-request-${state.groupId}`,
      nivel: "info",
      titulo: "Solicitudes de actualización pendientes",
      mensaje: `Este grupo tiene ${pendingRequests} solicitud(es) de actualización pendientes.`
    });
  }

  const lastClosedUpdate = toDate(state.group?.flowFicha?.ultimaActualizacionCerradaAt || null);
  if (lastClosedUpdate) {
    const diffClosed = daysBetween(new Date(), new Date(lastClosedUpdate));

    if (diffClosed >= 0 && diffClosed <= 7) {
      list.push({
        id: `auto-request-done-${state.groupId}`,
        nivel: "info",
        titulo: "Actualización de ficha completada",
        mensaje: `La solicitud de actualización ya fue aprobada nuevamente por administración el ${formatDateTime(lastClosedUpdate)}.`
      });
    }
  }

  return list;
}

/* =========================================================
   MODALS / EVENTS
========================================================= */
function bindEvents() {
  bindRichEditors();

  document.querySelectorAll("[data-close]").forEach((btn) => {
    btn.addEventListener("click", () => closeModal(btn.dataset.close));
  });

  $("modalDatos")?.addEventListener("click", (e) => {
    if (e.target === $("modalDatos")) closeModal("modalDatos");
  });
  $("modalSituacion")?.addEventListener("click", (e) => {
    if (e.target === $("modalSituacion")) closeModal("modalSituacion");
  });
  $("modalDocumentos")?.addEventListener("click", (e) => {
    if (e.target === $("modalDocumentos")) closeModal("modalDocumentos");
  });
  $("modalReunion")?.addEventListener("click", (e) => {
    if (e.target === $("modalReunion")) closeModal("modalReunion");
  });
  $("modalAlerta")?.addEventListener("click", (e) => {
    if (e.target === $("modalAlerta")) closeModal("modalAlerta");
  });
  $("modalComentario")?.addEventListener("click", (e) => {
    if (e.target === $("modalComentario")) closeModal("modalComentario");
  });

  $("btnEditarDatosHero")?.addEventListener("click", openDatosModal);
  $("btnEditarDatos")?.addEventListener("click", openDatosModal);

  $("btnEditarSituacionHero")?.addEventListener("click", openSituacionModal);
  $("btnEditarSituacion")?.addEventListener("click", openSituacionModal);

  $("btnEditarDocumentos")?.addEventListener("click", openDocsModal);

  $("btnNuevaReunionHero")?.addEventListener("click", openMeetingModal);
  $("btnNuevaReunion")?.addEventListener("click", openMeetingModal);
  $("btnNuevaReunionListado")?.addEventListener("click", openMeetingModal);

  $("btnNuevaAlertaHero")?.addEventListener("click", openAlertModal);
  $("btnNuevaAlerta")?.addEventListener("click", openAlertModal);

  $("btnNuevoComentario")?.addEventListener("click", openCommentModal);

  $("btnGuardarDatos")?.addEventListener("click", saveDatos);
  $("btnGuardarSituacion")?.addEventListener("click", saveSituacion);
  $("btnGuardarDocumentos")?.addEventListener("click", saveDocumentos);
  $("s_estado")?.addEventListener("change", syncSituacionStateUI);
  $("s_estado")?.addEventListener("input", syncSituacionStateUI);
  $("btnGuardarReunion")?.addEventListener("click", saveMeeting);
  $("btnGuardarAlerta")?.addEventListener("click", saveManualAlert);
  $("btnGuardarComentario")?.addEventListener("click", saveComment);

  $("btnHistoryToggleHidden")?.addEventListener("click", () => {
    state.historyUi.showHidden = !state.historyUi.showHidden;
    renderHistory();
  });

  $("btnHistoryMore")?.addEventListener("click", () => {
    state.historyUi.limit += 10;
    renderHistory();
  });

  $("r_tipo")?.addEventListener("change", syncMeetingTypeVisibility);

  $("btnFirmarVendedor")?.addEventListener("click", () => signFlow("vendedor"));
  $("btnFirmarJefaVentas")?.addEventListener("click", () => signFlow("jefaVentas"));
  $("btnFirmarAdministracion")?.addEventListener("click", () => signFlow("administracion"));
  
  $("btnCrearFicha")?.addEventListener("click", openFichaEditor);
  $("btnAbrirFichaPdf")?.addEventListener("click", openFichaPdf);

  $("btnCrearContrato")?.addEventListener("click", () => {
    if (!state.group?.autorizada) {
      alert("El contrato se habilita cuando el grupo ya está AUTORIZADO.");
      return;
    }
    alert("Aquí conectarás el generador de contrato.");
  });

  $("alertsList")?.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-action='resolver-alerta']");
    if (!btn) return;

    const id = btn.dataset.id || "";
    await resolveManualAlert(id);
  });

  $("historyList")?.addEventListener("click", async (e) => {
    const detailBtn = e.target.closest("[data-action='toggle-history-detail']");
    if (detailBtn) {
      const targetId = detailBtn.dataset.target || "";
      const target = $(targetId);
      if (!target) return;

      const isHidden = target.classList.contains("hidden");
      target.classList.toggle("hidden", !isHidden);
      detailBtn.textContent = isHidden ? "Ver menos" : "Ver más";
      return;
    }

    const starBtn = e.target.closest("[data-action='toggle-history-star']");
    if (starBtn) {
      const id = starBtn.dataset.id || "";
      await toggleHistoryStar(id);
      return;
    }

    const hideBtn = e.target.closest("[data-action='toggle-history-hidden']");
    if (hideBtn) {
      const id = hideBtn.dataset.id || "";
      await toggleHistoryHidden(id);
    }
  });
}

function openModal(id) {
  $(id)?.classList.add("show");
}

function closeModal(id) {
  $(id)?.classList.remove("show");
}

function setSituacionBlockVisibility(id, shouldShow, displayValue = "block") {
  const el = $(id);
  if (!el) return;

  el.classList.toggle("hidden", !shouldShow);
  el.style.display = shouldShow ? displayValue : "none";
}

function syncSituacionStateUI() {
  const estadoRaw = $("s_estado")?.value || "";
  const estado = normalizeState(estadoRaw);
  const isGanada = estado === "ganada";
  const isReunion = estado === "reunion_confirmada";

  setSituacionBlockVisibility("wrapSituacionGanadaFields", isGanada, "grid");
  setSituacionBlockVisibility("wrapSituacionFechaReunion", isReunion, "block");

  const fechaInput = $("s_fechaReunion");
  if (fechaInput) {
    fechaInput.required = isReunion;

    if (!isReunion) {
      fechaInput.value = "";
    }
  }
}

function getSituacionMeetingBaseDate() {
  const fromGroup = toDate(state.group?.proximaReunionFecha || null);
  if (fromGroup) return fromGroup;

  const nextMeeting = getNextMeeting();
  const fromAgenda = toDate(nextMeeting?.fechaInicio || null);
  if (fromAgenda) return fromAgenda;

  return null;
}

async function createMeetingFromSituacionChange({ fechaReunionRaw = "", mensajeHistorial = "" } = {}) {
  const fechaInicioDate = new Date(fechaReunionRaw);

  if (Number.isNaN(fechaInicioDate.getTime())) {
    throw new Error("La fecha de la reunión no es válida.");
  }

  // Reunión de 1 hora por defecto
  const fechaFinDate = new Date(fechaInicioDate.getTime() + (60 * 60 * 1000));

  // Evita duplicar si ya existe una reunión activa exactamente en esa fecha/hora
  const yaExiste = state.meetings.some((meeting) => {
    const meetingDate = toDate(meeting.fechaInicio);
    if (!meetingDate) return false;

    const sameMoment = Math.abs(meetingDate.getTime() - fechaInicioDate.getTime()) < 60000;
    const notCancelled = normalizeSearchLocal(meeting.estadoReunion || "agendada") !== "cancelada";

    return sameMoment && notCancelled;
  });

  if (yaExiste) {
    return {
      created: false,
      patch: {}
    };
  }

  const meetingData = {
    idGrupo: String(state.groupId),
    codigoRegistro: cleanText(state.group.codigoRegistro),
    aliasGrupo: cleanText(state.group.aliasGrupo),
    colegio: cleanText(state.group.colegio),
    vendedora: cleanText(state.group.vendedora),
    vendedoraCorreo: normalizeEmail(state.group.vendedoraCorreo || ""),

    titulo: "Primera reunión",
    tipo: "por_definir",
    modalidad: "por_definir",
    fechaInicio: Timestamp.fromDate(fechaInicioDate),
    fechaFin: Timestamp.fromDate(fechaFinDate),
    direccion: "",
    link: "",
    estadoReunion: "agendada",
    resultado: "",
    observaciones: mensajeHistorial || "Primera reunión creada desde cambio de estado del grupo.",
    creadaDesde: "situacion_grupo",
    origenCalendario: true,

    creadoPor: getDisplayName(state.effectiveUser),
    creadoPorCorreo: state.effectiveEmail,
    fechaCreacion: serverTimestamp(),
    actualizadoPor: "",
    actualizadoPorCorreo: "",
    fechaActualizacion: null
  };

  await addDoc(collection(db, REUNIONES_COLLECTION), meetingData);

  await createHistoryEntry({
    tipoMovimiento: "reunion_creada",
    modulo: "agenda",
    titulo: "Primera reunión agendada",
    mensaje: `${getDisplayName(state.effectiveUser)} agendó la primera reunión del grupo.`,
    metadata: {
      cambios: [
        { campo: "reunion.titulo", anterior: "", nuevo: "Primera reunión" },
        { campo: "reunion.fechaInicio", anterior: "", nuevo: fechaReunionRaw },
        { campo: "reunion.tipo", anterior: "", nuevo: "por_definir" }
      ]
    }
  });

  return {
    created: true,
    patch: buildMeetingSummaryPatchAfterCreate(meetingData)
  };
}

function openDatosModal() {
  if (!canEditGroup()) {
    alert(getBlockedEditMessage());
    return;
  }

  setFormValue("d_aliasGrupo", state.group.aliasGrupo);
  setFormValue("d_estado", normalizeState(state.group.estado));
  setFormValue("d_vendedora", state.group.vendedora);
  setFormValue("d_colegio", state.group.colegio);
  setFormValue("d_curso", state.group.curso);
  setFormValue("d_anoViaje", state.group.anoViaje);
  setFormValue("d_cantidadGrupo", state.group.cantidadGrupo);
  setFormValue("d_destinoPrincipal", state.group.destinoPrincipal);
  setFormValue("d_programa", state.group.programa);
  setFormValue("d_tramo", state.group.tramo);
  setFormValue("d_semanaViaje", state.group.semanaViaje);
  setFormValue("d_comunaCiudad", state.group.comunaCiudad);
  setFormValue("d_nombreCliente", state.group.nombreCliente);
  setFormValue("d_rolCliente", state.group.rolCliente);
  setFormValue("d_correoCliente", state.group.correoCliente);
  setFormValue("d_celularCliente", state.group.celularCliente);
  setFormValue("d_nombreCliente2", state.group.nombreCliente2);
  setFormValue("d_rolCliente2", state.group.rolCliente2);
  setFormValue("d_correoCliente2", state.group.correoCliente2);
  setFormValue("d_celularCliente2", state.group.celularCliente2);

  openModal("modalDatos");
}

function openSituacionModal() {
  if (!canEditGroup()) {
    alert(getBlockedEditMessage());
    return;
  }

  setFormValue("s_estado", normalizeState(state.group.estado));
  setFormValue("s_mensajeHistorial", "");

  const meetingBaseDate = getSituacionMeetingBaseDate();
  setFormValue("s_fechaReunion", meetingBaseDate ? toDatetimeLocal(meetingBaseDate) : "");

  setRichEditorHtml(
    "s_obsAdmin",
    getByPath(state.group, "situacion.observacionAdministracion") ||
    state.group.observacionesAdministracion ||
    ""
  );

  setRichEditorHtml(
    "s_obsOperaciones",
    getByPath(state.group, "situacion.observacionOperaciones") ||
    state.group.observacionesOperaciones ||
    ""
  );

  openModal("modalSituacion");

  requestAnimationFrame(() => {
    syncSituacionStateUI();
  });

  setTimeout(() => {
    syncSituacionStateUI();
  }, 0);
}

function openDocsModal() {
  if (!canEditDocuments()) {
    alert("Solo administración y supervisión pueden editar el estado de documentos.");
    return;
  }

  setFormValue("doc_fichaMedicaEstado", normalizeDocState(state.group.fichaMedicaEstado));
  setFormValue("doc_nominaEstado", normalizeDocState(state.group.nominaEstado));
  setFormValue("doc_fichaEstado", normalizeDocState(state.group.fichaEstado));
  setFormValue("doc_contratoEstado", normalizeDocState(state.group.contratoEstado));
  setFormValue("doc_cortesiaEstado", normalizeDocState(state.group.cortesiaEstado));

  openModal("modalDocumentos");
}

function openMeetingModal() {
  if (!canEditGroup()) {
    alert(getBlockedEditMessage());
    return;
  }

  $("formReunion")?.reset();
  setDefaultMeetingDates();
  setFormValue("r_tipo", "presencial");
  syncMeetingTypeVisibility();
  openModal("modalReunion");
}

function openAlertModal() {
  if (!canEditGroup()) {
    alert(getBlockedEditMessage());
    return;
  }

  $("formAlerta")?.reset();
  setFormValue("a_nivel", "warning");
  openModal("modalAlerta");
}

function openCommentModal() {
  if (!canEditGroup()) {
    alert(getBlockedEditMessage());
    return;
  }

  $("formComentario")?.reset();
  openModal("modalComentario");
}

async function saveComment() {
  if (!canEditGroup()) {
    alert(getBlockedEditMessage());
    return;
  }

  const titulo = cleanText($("c_titulo")?.value);
  const mensaje = cleanText($("c_mensaje")?.value);

  if (!titulo || !mensaje) {
    alert("Debes completar el título y el comentario.");
    return;
  }

  await createHistoryEntry({
    tipoMovimiento: "comentario",
    modulo: "bitacora",
    titulo: "Comentario",
    asunto: titulo,
    mensaje,
    metadata: {
      tipoRegistro: "comentario"
    }
  });

  closeModal("modalComentario");
  await loadAll();
  showSaveNotice("Comentario guardado correctamente.");
}

function getHistoryTypeLabel(item = {}) {
  const tipo = normalizeSearchLocal(item.tipoMovimiento || "");
  const modulo = normalizeSearchLocal(item.modulo || "");

  if (tipo.includes("comentario")) return "Comentario";
  if (tipo.includes("alerta")) return "Alerta";
  if (tipo.includes("reunion")) return "Reunión";
  if (tipo.includes("firma")) return "Firma";
  if (tipo.includes("estado")) return "Estado";
  if (tipo.includes("document")) return "Documento";

  if (modulo === "agenda") return "Reunión";
  if (modulo === "alertas") return "Alerta";
  if (modulo === "bitacora") return "Comentario";

  return "Movimiento";
}

function getHistoryCardClass(item = {}) {
  const tipo = getHistoryTypeLabel(item);

  if (tipo === "Comentario") return "is-comment";
  if (tipo === "Alerta") return "is-alert";
  if (tipo === "Reunión") return "is-meeting";
  if (tipo === "Firma") return "is-sign";
  if (tipo === "Estado") return "is-status";

  return "";
}

function truncateHistoryMessage(value = "", max = 220) {
  const text = cleanText(value || "");
  if (!text) return "";
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
}

async function toggleHistoryStar(historyId) {
  if (!canManageHistoryItems()) {
    alert("No tienes permisos para destacar elementos del historial de este grupo.");
    return;
  }

  const item = state.history.find((x) => x.id === historyId);
  if (!item) return;

  const nextValue = !item.destacado;

  await setDoc(doc(db, HISTORIAL_COLLECTION, historyId), {
    destacado: nextValue,
    destacadoAt: nextValue ? serverTimestamp() : null,
    destacadoPor: nextValue ? getDisplayName(state.effectiveUser) : "",
    destacadoPorCorreo: nextValue ? state.effectiveEmail : ""
  }, { merge: true });

  await loadAll();
}

async function toggleHistoryHidden(historyId) {
  if (!canManageHistoryItems()) {
    alert("No tienes permisos para ocultar elementos del historial de este grupo.");
    return;
  }

  const item = state.history.find((x) => x.id === historyId);
  if (!item) return;

  const nextValue = !item.oculto;
  const actionLabel = nextValue ? "ocultar" : "volver a mostrar";
  const ok = confirm(`¿Quieres ${actionLabel} este item del historial?`);
  if (!ok) return;

  await setDoc(doc(db, HISTORIAL_COLLECTION, historyId), {
    oculto: nextValue,
    ocultadoAt: nextValue ? serverTimestamp() : null,
    ocultadoPor: nextValue ? getDisplayName(state.effectiveUser) : "",
    ocultadoPorCorreo: nextValue ? state.effectiveEmail : ""
  }, { merge: true });

  await loadAll();
}
function syncMeetingTypeVisibility() {
  const type = String($("r_tipo")?.value || "presencial");
  $("wrapDireccion")?.classList.toggle("hidden", type !== "presencial");
  $("wrapLink")?.classList.toggle("hidden", type !== "virtual");
}

function bindRichEditors() {
  if (richEditorsBound) return;
  richEditorsBound = true;

  document.addEventListener("selectionchange", () => {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;

    const anchorNode = sel.anchorNode;
    const editor =
      anchorNode?.nodeType === 3
        ? anchorNode.parentElement?.closest(".rich-editor[contenteditable='true']")
        : anchorNode?.closest?.(".rich-editor[contenteditable='true']");

    if (!editor || !editor.id) return;

    richSelectionByEditor.set(editor.id, sel.getRangeAt(0).cloneRange());
  });

  document.addEventListener("mousedown", (e) => {
    const btn = e.target.closest("[data-rich-cmd]");
    if (!btn) return;

    e.preventDefault();

    const targetId = String(btn.dataset.editorTarget || "");
    const cmd = String(btn.dataset.richCmd || "");
    if (!targetId || !cmd) return;

    applyRichCommand(targetId, cmd);
  });

  document.addEventListener("input", (e) => {
    const input = e.target.closest("[data-rich-color]");
    if (!input) return;

    const targetId = String(input.dataset.editorTarget || "");
    const cmd = String(input.dataset.richColor || "");
    if (!targetId || !cmd) return;

    applyRichCommand(targetId, cmd, input.value);
  });
}

function applyRichCommand(targetId, cmd, value = null) {
  const editor = $(targetId);
  if (!editor) return;

  editor.focus();
  restoreRichSelection(targetId);

  try {
    document.execCommand("styleWithCSS", false, true);
  } catch (e) {
    // sin acción
  }

  if (cmd === "hiliteColor") {
    const ok = document.execCommand("hiliteColor", false, value);
    if (!ok) {
      document.execCommand("backColor", false, value);
    }
  } else {
    document.execCommand(cmd, false, value);
  }

  editor.focus();
  captureRichSelection(targetId);
}

function captureRichSelection(targetId) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;
  richSelectionByEditor.set(targetId, sel.getRangeAt(0).cloneRange());
}

function restoreRichSelection(targetId) {
  const range = richSelectionByEditor.get(targetId);
  if (!range) return;

  const sel = window.getSelection();
  if (!sel) return;

  sel.removeAllRanges();
  sel.addRange(range);
}

function setRichEditorHtml(id, html) {
  const el = $(id);
  if (!el) return;
  el.innerHTML = sanitizeRichHtml(html || "");
}

function getRichEditorHtml(id) {
  const el = $(id);
  if (!el) return "";
  return normalizeRichHtml(sanitizeRichHtml(el.innerHTML || ""));
}

function renderRichText(id, html, fallback = "—") {
  const el = $(id);
  if (!el) return;

  const safe = sanitizeRichHtml(html || "");
  el.innerHTML = safe || fallback;
}

function sanitizeRichHtml(html = "") {
  const raw = String(html || "");
  if (!raw.trim()) return "";

  const template = document.createElement("template");
  template.innerHTML = raw;

  template.content
    .querySelectorAll("script, iframe, object, embed, link, meta")
    .forEach((el) => el.remove());

  template.content.querySelectorAll("*").forEach((el) => {
    [...el.attributes].forEach((attr) => {
      const name = attr.name.toLowerCase();
      const value = String(attr.value || "");

      if (name.startsWith("on")) {
        el.removeAttribute(attr.name);
      }

      if ((name === "href" || name === "src") && /^\s*javascript:/i.test(value)) {
        el.removeAttribute(attr.name);
      }
    });
  });

  return normalizeRichHtml(template.innerHTML);
}

function normalizeRichHtml(html = "") {
  return String(html || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/<div><br><\/div>/gi, "")
    .replace(/<p><br><\/p>/gi, "")
    .replace(/>\s+</g, "><")
    .trim();
}

function stripHistoryHtml(value = "") {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isRichHistoryField(path = "") {
  return [
    "situacion.observacionAdministracion",
    "situacion.observacionOperaciones"
  ].includes(String(path || "").trim());
}

function getHistoryComparable(value, rich = false) {
  if (value === null || value === undefined) return "";

  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);

  if (Array.isArray(value)) {
    return value.map((item) => getHistoryComparable(item, false)).filter(Boolean).join(" | ").trim();
  }

  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  const raw = String(value || "");
  const text = rich ? stripHistoryHtml(raw) : raw;

  return text.replace(/\s+/g, " ").trim();
}

function getHistoryPreview(value, rich = false) {
  const text = getHistoryComparable(value, rich);
  if (!text) return "";
  return text.length > 180 ? `${text.slice(0, 177)}...` : text;
}

function classifyHistoryChangeType({ anterior, nuevo, rich = false } = {}) {
  const oldValue = getHistoryComparable(anterior, rich);
  const newValue = getHistoryComparable(nuevo, rich);

  if (oldValue === newValue) return "sin_cambio";
  if (!oldValue && newValue) return "agregado";
  if (oldValue && !newValue) return "eliminado";
  return "modificado";
}

function buildDetailedChanges(changes = []) {
  return (changes || [])
    .map((item) => {
      const campo = cleanText(item?.campo || "campo");
      const rich = isRichHistoryField(campo);

      const anterior = item?.anterior ?? "";
      const nuevo = item?.nuevo ?? "";
      const tipoCambio = classifyHistoryChangeType({ anterior, nuevo, rich });

      return {
        campo,
        tipoCambio,
        anterior,
        nuevo,
        anteriorPreview: getHistoryPreview(anterior, rich),
        nuevoPreview: getHistoryPreview(nuevo, rich)
      };
    })
    .filter((item) => item.tipoCambio !== "sin_cambio");
}

function buildHistorySubject({ titulo = "", cambios = [] } = {}) {
  const prefix = cleanText(titulo || "Movimiento");
  if (!cambios.length) return prefix;

  const first = cambios[0];
  const actionLabel = {
    agregado: "Agregado",
    eliminado: "Eliminado",
    modificado: "Modificado"
  }[first.tipoCambio] || "Cambio";

  if (cambios.length === 1) {
    return `${prefix} · ${actionLabel} ${prettyLabel(first.campo)}`;
  }

  return `${prefix} · ${actionLabel} ${prettyLabel(first.campo)} (+${cambios.length - 1})`;
}

function buildHistorySummary(cambios = []) {
  if (!cambios.length) return "";

  return cambios.map((item) => {
    const base = `${capitalize(item.tipoCambio)} ${prettyLabel(item.campo)}`;

    if (item.tipoCambio === "agregado") {
      return `${base}: ${item.nuevoPreview || "sin valor"}`;
    }

    if (item.tipoCambio === "eliminado") {
      return `${base}: ${item.anteriorPreview || "sin valor"}`;
    }

    return `${base}: ${item.anteriorPreview || "vacío"} → ${item.nuevoPreview || "vacío"}`;
  }).join(" | ");
}

/* =========================================================
   SAVE DATA
========================================================= */
async function saveDatos() {
  const patch = {};
  const cambios = [];

  const values = {
    aliasGrupo: $("d_aliasGrupo")?.value || "",
    estado: $("d_estado")?.value || "a_contactar",
    vendedora: $("d_vendedora")?.value || "",
    colegio: $("d_colegio")?.value || "",
    curso: $("d_curso")?.value || "",
    anoViaje: parseNumberOrText($("d_anoViaje")?.value),
    cantidadGrupo: parseNumberOrText($("d_cantidadGrupo")?.value),
    destinoPrincipal: $("d_destinoPrincipal")?.value || "",
    programa: $("d_programa")?.value || "",
    tramo: $("d_tramo")?.value || "",
    semanaViaje: $("d_semanaViaje")?.value || "",
    comunaCiudad: $("d_comunaCiudad")?.value || "",
    nombreCliente: $("d_nombreCliente")?.value || "",
    rolCliente: $("d_rolCliente")?.value || "",
    correoCliente: $("d_correoCliente")?.value || "",
    celularCliente: $("d_celularCliente")?.value || "",
    nombreCliente2: $("d_nombreCliente2")?.value || "",
    rolCliente2: $("d_rolCliente2")?.value || "",
    correoCliente2: $("d_correoCliente2")?.value || "",
    celularCliente2: $("d_celularCliente2")?.value || ""
  };

  for (const path of DATA_FIELDS) {
    const nuevo = values[path];
    const anterior = getByPath(state.group, path);

    if (!sameValue(anterior, nuevo)) {
      setNestedValue(patch, path, nuevo);
      cambios.push({ campo: path, anterior, nuevo });
    }
  }

  if (!cambios.length) {
    closeModal("modalDatos");
    return;
  }

  await applyCriticalChangeRules(patch, cambios);
  await saveGroupPatch(patch, {
    tipoMovimiento: "edicion_datos",
    modulo: "grupo",
    titulo: "Modificación manual de datos",
    mensaje: `${getDisplayName(state.effectiveUser)} modificó datos del grupo.`,
    cambios
  });

  closeModal("modalDatos");
  showSaveNotice("Datos guardados correctamente.");
}

async function saveSituacion() {
  if (!canEditGroup()) {
    alert(getBlockedEditMessage());
    return;
  }

  const patch = {};
  const cambios = [];

  const estadoAnterior = normalizeState(state.group.estado || "a_contactar");
  const estadoNuevo = normalizeState($("s_estado")?.value || "a_contactar");
  const mensajeHistorial = cleanText($("s_mensajeHistorial")?.value || "");
  const fechaReunionRaw = $("s_fechaReunion")?.value || "";

  const isGanada = estadoNuevo === "ganada";
  const isReunionConfirmada = estadoNuevo === "reunion_confirmada";

  // Siempre obligatorio
  if (!mensajeHistorial) {
    alert("Debes escribir un mensaje del cambio.");
    return;
  }

  if (isReunionConfirmada && !fechaReunionRaw) {
    alert("Debes indicar la fecha de la reunión cuando el estado es Reunión confirmada.");
    return;
  }

  // 1) Cambio de estado
  if (estadoNuevo !== estadoAnterior) {
    patch.estado = estadoNuevo;
    cambios.push({
      campo: "estado",
      anterior: estadoAnterior,
      nuevo: estadoNuevo
    });
  }

  // 2) Si queda en reunión confirmada, además crear/agendar la primera reunión real
  if (isReunionConfirmada) {
    try {
      const meetingResult = await createMeetingFromSituacionChange({
        fechaReunionRaw,
        mensajeHistorial
      });

      if (meetingResult?.patch) {
        Object.assign(patch, meetingResult.patch);
      }

      const fechaAnteriorTxt = toDatetimeLocal(
        toDate(state.group.proximaReunionFecha || getNextMeeting()?.fechaInicio || null)
      );

      if (fechaAnteriorTxt !== fechaReunionRaw) {
        cambios.push({
          campo: "proximaReunionFecha",
          anterior: fechaAnteriorTxt || "",
          nuevo: fechaReunionRaw
        });
      }
    } catch (error) {
      alert(error.message || "No se pudo crear la reunión.");
      return;
    }
  }

  // 3) Si queda en ganada, guardar observaciones enriquecidas
  if (isGanada) {
    const adminNuevo = getRichEditorHtml("s_obsAdmin");
    const opsNuevo = getRichEditorHtml("s_obsOperaciones");

    const adminAnterior =
      getByPath(state.group, "situacion.observacionAdministracion") ||
      state.group.observacionesAdministracion ||
      "";

    const opsAnterior =
      getByPath(state.group, "situacion.observacionOperaciones") ||
      state.group.observacionesOperaciones ||
      "";

    if (normalizeRichHtml(adminAnterior) !== normalizeRichHtml(adminNuevo)) {
      setNestedValue(patch, "situacion.observacionAdministracion", adminNuevo);
      patch.observacionesAdministracion = adminNuevo;
      cambios.push({
        campo: "situacion.observacionAdministracion",
        anterior: adminAnterior,
        nuevo: adminNuevo
      });
    }

    if (normalizeRichHtml(opsAnterior) !== normalizeRichHtml(opsNuevo)) {
      setNestedValue(patch, "situacion.observacionOperaciones", opsNuevo);
      patch.observacionesOperaciones = opsNuevo;
      cambios.push({
        campo: "situacion.observacionOperaciones",
        anterior: opsAnterior,
        nuevo: opsNuevo
      });
    }
  }

  if (!cambios.length) {
    alert("No hay cambios para guardar.");
    return;
  }

  await applyCriticalChangeRules(patch, cambios);

  await saveGroupPatch(patch, {
    tipoMovimiento: "cambio_estado",
    modulo: "grupo",
    titulo: "Actualización de situación",
    asunto: `Cambio de situación · ${getEstadoLabel(estadoAnterior)} → ${getEstadoLabel(estadoNuevo)}`,
    mensaje: mensajeHistorial,
    cambios
  });

  closeModal("modalSituacion");
  showSaveNotice("Situación guardada correctamente.");
}

async function saveDocumentos() {
    if (!canEditDocuments()) {
    alert("Solo administración y supervisión pueden editar el estado de documentos.");
    return;
  }
  
  const patch = {};
  const cambios = [];

  const values = {
    fichaMedicaEstado: $("doc_fichaMedicaEstado")?.value || "pendiente",
    nominaEstado: $("doc_nominaEstado")?.value || "pendiente",
    fichaEstado: $("doc_fichaEstado")?.value || "pendiente",
    contratoEstado: $("doc_contratoEstado")?.value || "pendiente",
    cortesiaEstado: $("doc_cortesiaEstado")?.value || "pendiente"
  };

  for (const path of DOC_FIELDS) {
    const nuevo = values[path];
    const anterior = normalizeDocState(getByPath(state.group, path));

    if (!sameValue(anterior, nuevo)) {
      patch[path] = nuevo;
      cambios.push({ campo: path, anterior, nuevo });
    }
  }

  if (!sameValue(getByPath(state.group, "documentos.fichaMedica.estado"), values.fichaMedicaEstado)) {
    setNestedValue(patch, "documentos.fichaMedica.estado", values.fichaMedicaEstado);
  }
  if (!sameValue(getByPath(state.group, "documentos.nomina.estado"), values.nominaEstado)) {
    setNestedValue(patch, "documentos.nomina.estado", values.nominaEstado);
  }
  if (!sameValue(getByPath(state.group, "documentos.fichaGrupo.estado"), values.fichaEstado)) {
    setNestedValue(patch, "documentos.fichaGrupo.estado", values.fichaEstado);
  }
  if (!sameValue(getByPath(state.group, "documentos.contrato.estado"), values.contratoEstado)) {
    setNestedValue(patch, "documentos.contrato.estado", values.contratoEstado);
  }
  if (!sameValue(getByPath(state.group, "documentos.cortesia.estado"), values.cortesiaEstado)) {
    setNestedValue(patch, "documentos.cortesia.estado", values.cortesiaEstado);
  }

  if (!cambios.length) {
    closeModal("modalDocumentos");
    return;
  }

  await applyCriticalChangeRules(patch, cambios);
  await saveGroupPatch(patch, {
    tipoMovimiento: "documento_actualizado",
    modulo: "documentos",
    titulo: "Actualización de documentos",
    mensaje: `${getDisplayName(state.effectiveUser)} actualizó el control documental del grupo.`,
    cambios
  });

  closeModal("modalDocumentos");
  showSaveNotice("Documentos guardados correctamente.");
}

async function saveMeeting() {
  if (!canEditGroup()) {
    alert(getBlockedEditMessage());
    return;
  }

  const titulo = cleanText($("r_titulo")?.value);
  const tipo = String($("r_tipo")?.value || "presencial");
  const fechaInicio = $("r_fechaInicio")?.value || "";
  const fechaFin = $("r_fechaFin")?.value || "";
  const direccion = cleanText($("r_direccion")?.value);
  const link = cleanText($("r_link")?.value);
  const observaciones = cleanText($("r_observaciones")?.value);

  if (!titulo) {
    alert("Debes ingresar un título para la reunión.");
    return;
  }

  if (!fechaInicio || !fechaFin) {
    alert("Debes ingresar fecha y hora de inicio y fin.");
    return;
  }

  if (new Date(fechaFin).getTime() <= new Date(fechaInicio).getTime()) {
    alert("La fecha/hora de fin debe ser mayor a la de inicio.");
    return;
  }

  if (tipo === "presencial" && !direccion) {
    alert("Para reuniones presenciales debes ingresar dirección.");
    return;
  }

  if (tipo === "virtual" && !link) {
    alert("Para reuniones virtuales debes ingresar link.");
    return;
  }

  const data = {
    idGrupo: String(state.groupId),
    codigoRegistro: cleanText(state.group.codigoRegistro),
    aliasGrupo: cleanText(state.group.aliasGrupo),
    colegio: cleanText(state.group.colegio),
    vendedora: cleanText(state.group.vendedora),
    vendedoraCorreo: normalizeEmail(state.group.vendedoraCorreo || ""),

    titulo,
    tipo,
    modalidad: tipo,
    fechaInicio: Timestamp.fromDate(new Date(fechaInicio)),
    fechaFin: Timestamp.fromDate(new Date(fechaFin)),
    direccion: tipo === "presencial" ? direccion : "",
    link: tipo === "virtual" ? link : "",
    estadoReunion: "agendada",
    resultado: "",
    observaciones,
    creadaDesde: "grupo",
    origenCalendario: true,

    creadoPor: getDisplayName(state.effectiveUser),
    creadoPorCorreo: state.effectiveEmail,
    fechaCreacion: serverTimestamp(),
    actualizadoPor: "",
    actualizadoPorCorreo: "",
    fechaActualizacion: null
  };

  await addDoc(collection(db, REUNIONES_COLLECTION), data);

  const patch = buildMeetingSummaryPatchAfterCreate(data);
  await saveGroupPatch(patch, {
    tipoMovimiento: "reunion_creada",
    modulo: "agenda",
    titulo: "Nueva reunión agendada",
    mensaje: `${getDisplayName(state.effectiveUser)} agendó una reunión ${tipo}.`,
    cambios: [
      { campo: "proximaReunionFecha", anterior: state.group.proximaReunionFecha || "", nuevo: fechaInicio },
      { campo: "proximaReunionTipo", anterior: state.group.proximaReunionTipo || "", nuevo: tipo }
    ],
    reloadAfterSave: false
  });

  await createHistoryEntry({
    tipoMovimiento: "reunion_creada",
    modulo: "agenda",
    titulo: "Nueva reunión agendada",
    mensaje: `${getDisplayName(state.effectiveUser)} agendó "${titulo}".`,
    metadata: {
      cambios: [
        { campo: "reunion.tipo", anterior: "", nuevo: tipo },
        { campo: "reunion.fechaInicio", anterior: "", nuevo: fechaInicio },
        { campo: "reunion.lugar", anterior: "", nuevo: tipo === "presencial" ? direccion : link }
      ]
    }
  });

  closeModal("modalReunion");
  await loadAll();
  showSaveNotice("Reunión guardada correctamente.");
}

async function saveManualAlert() {
  if (!canEditGroup()) {
    alert(getBlockedEditMessage());
    return;
  }

  const titulo = cleanText($("a_titulo")?.value);
  const nivel = cleanText($("a_nivel")?.value || "warning");
  const mensaje = cleanText($("a_mensaje")?.value);

  if (!titulo || !mensaje) {
    alert("Debes completar el título y el mensaje de la alerta.");
    return;
  }

  await addDoc(collection(db, ALERTAS_COLLECTION), {
    idGrupo: String(state.groupId),
    codigoRegistro: cleanText(state.group.codigoRegistro),
    aliasGrupo: cleanText(state.group.aliasGrupo),
    tipo: "manual",
    origen: "grupo",
    nivel,
    titulo,
    mensaje,
    activa: true,
    visibleEnIndex: true,
    visibleEnGrupo: true,
    resuelta: false,
    resueltaPor: "",
    resueltaPorCorreo: "",
    fechaResolucion: null,
    creadoPor: getDisplayName(state.effectiveUser),
    creadoPorCorreo: state.effectiveEmail,
    fechaCreacion: serverTimestamp()
  });

  await createHistoryEntry({
    tipoMovimiento: "alerta_manual",
    modulo: "alertas",
    titulo: "Alerta manual",
    asunto: titulo,
    mensaje,
    metadata: {
      cambios: [
        { campo: "alerta.titulo", anterior: "", nuevo: titulo },
        { campo: "alerta.nivel", anterior: "", nuevo: nivel },
        { campo: "alerta.mensaje", anterior: "", nuevo: mensaje }
      ]
    }
  });

  closeModal("modalAlerta");
  await loadAll();
  showSaveNotice("Alerta guardada correctamente.");
}

async function resolveManualAlert(alertId) {
  const item = state.alertsManual.find((x) => x.id === alertId);
  if (!item) return;

  const ok = confirm(`¿Marcar como resuelta la alerta "${item.titulo}"?`);
  if (!ok) return;

  await setDoc(doc(db, ALERTAS_COLLECTION, alertId), {
    activa: false,
    resuelta: true,
    resueltaPor: getDisplayName(state.effectiveUser),
    resueltaPorCorreo: state.effectiveEmail,
    fechaResolucion: serverTimestamp()
  }, { merge: true });

  await createHistoryEntry({
    tipoMovimiento: "alerta_manual",
    modulo: "alertas",
    titulo: "Alerta resuelta",
    asunto: item.titulo || "Alerta manual",
    mensaje: `${getDisplayName(state.effectiveUser)} resolvió esta alerta manual.`,
    metadata: {
      cambios: [
        { campo: "alerta.activa", anterior: true, nuevo: false },
        { campo: "alerta.resuelta", anterior: false, nuevo: true }
      ]
    }
  });

  await loadAll();
}

/* =========================================================
   FLOW / FIRMAS
========================================================= */
function getPendingFichaUpdateRequests() {
  return state.requests.filter((item) => {
    return normalizeSearchLocal(item.tipoSolicitud || "") === "actualizacion_ficha"
      && normalizeSearchLocal(item.estadoSolicitud || "") === "pendiente";
  });
}

async function markPendingFichaUpdateRequestsAsCompleted({
  resolvedBy = getDisplayName(state.effectiveUser),
  resolvedByCorreo = state.effectiveEmail,
  newStatus = "completada"
} = {}) {
  const pending = getPendingFichaUpdateRequests();

  for (const item of pending) {
    await setDoc(doc(db, SOLICITUDES_COLLECTION, item.id), {
      estadoSolicitud: newStatus,
      resuelta: true,
      resueltaPor: resolvedBy,
      resueltaPorCorreo: resolvedByCorreo,
      fechaResolucion: serverTimestamp()
    }, { merge: true });
  }

  return pending.length;
}

async function signFlow(step) {
  if (!state.group) return;

  const flow = state.group.flowFicha || {};
  const nombre = getDisplayName(state.effectiveUser);

  if (step === "vendedor") {
    if (!canEditGroup()) {
      alert(getBlockedEditMessage());
      return;
    }

    if (normalizeState(state.group.estado) !== "ganada") {
      alert("La firma de vendedor(a) solo se habilita cuando el grupo está GANADA.");
      return;
    }

    if (flow?.vendedor?.firmado) {
      alert("La firma de vendedor(a) ya está registrada.");
      return;
    }

    const patch = {
      fichaFlujoModo: "v2",
      fichaEstado: "lista_vendedor",
      firmaVendedor: nombre,

      documentos: {
        ...(state.group.documentos || {}),
        fichaGrupo: {
          ...(state.group.documentos?.fichaGrupo || {}),
          estado: "lista_vendedor"
        }
      },

      ficha: {
        ...(state.group.ficha || {}),
        flujoModo: "v2",
        estado: "lista_vendedor"
      },

      flowFicha: {
        ...(state.group.flowFicha || {}),
        modo: "v2",
        legacy: false,
        habilitada: true,
        estado: "lista_vendedor",
        bloqueadaParaVendedor: true,
        requiereActualizacion: false,
        vendedor: {
          ...(state.group.flowFicha?.vendedor || {}),
          firmado: true,
          firmadoAt: serverTimestamp(),
          firmadoPor: nombre,
          firmadoPorCorreo: state.effectiveEmail,
          observacion: ""
        }
      }
    };

    await saveGroupPatch(patch, {
      tipoMovimiento: "firma_vendedor",
      modulo: "ficha",
      titulo: "Firma de vendedor(a)",
      mensaje: `${nombre} dejó la ficha lista como vendedor(a).`,
      cambios: [
        { campo: "fichaEstado", anterior: state.group.fichaEstado || "", nuevo: "lista_vendedor" }
      ]
    });
    return;
  }

  if (step === "jefaVentas") {
    if (!isJefaVentas()) {
      alert("Esta firma solo puede realizarla la jefa de ventas.");
      return;
    }

    if (!flow?.vendedor?.firmado) {
      alert("Primero debe firmar el vendedor(a).");
      return;
    }

    if (flow?.jefaVentas?.firmado) {
      alert("La firma de jefa de ventas ya está registrada.");
      return;
    }

    const hadPendingRequest = getPendingFichaUpdateRequests().length > 0;

    const flowPatch = {
      ...(state.group.flowFicha || {}),
      modo: "v2",
      legacy: false,
      estado: "revisada_jefa_ventas",
      jefaVentas: {
        ...(state.group.flowFicha?.jefaVentas || {}),
        firmado: true,
        firmadoAt: serverTimestamp(),
        firmadoPor: nombre,
        firmadoPorCorreo: state.effectiveEmail,
        observacion: ""
      }
    };

    if (hadPendingRequest) {
      flowPatch.ultimaSolicitudActualizacion = {
        ...(state.group.flowFicha?.ultimaSolicitudActualizacion || {}),
        estado: "revisada_jefa_ventas",
        revisadaPor: nombre,
        revisadaPorCorreo: state.effectiveEmail,
        fechaRevisionJefa: serverTimestamp()
      };
    }

    const patch = {
      fichaFlujoModo: "v2",
      fichaEstado: "revisada_jefa_ventas",
      firmaSupervision: nombre,

      documentos: {
        ...(state.group.documentos || {}),
        fichaGrupo: {
          ...(state.group.documentos?.fichaGrupo || {}),
          estado: "revisada_jefa_ventas"
        }
      },

      ficha: {
        ...(state.group.ficha || {}),
        flujoModo: "v2",
        estado: "revisada_jefa_ventas"
      },

      flowFicha: flowPatch
    };

    await saveGroupPatch(patch, {
      tipoMovimiento: "firma_jefa_ventas",
      modulo: "ficha",
      titulo: hadPendingRequest ? "Refirma jefa de ventas" : "Firma jefa de ventas",
      mensaje: hadPendingRequest
        ? `${nombre} revisó nuevamente la ficha tras una solicitud de actualización.`
        : `${nombre} revisó la ficha como jefa de ventas.`,
      cambios: [
        { campo: "fichaEstado", anterior: state.group.fichaEstado || "", nuevo: "revisada_jefa_ventas" }
      ]
    });
    return;
  }

  if (step === "administracion") {
    if (!isAdministracion()) {
      alert("Esta firma solo puede realizarla administración.");
      return;
    }

    if (!flow?.jefaVentas?.firmado) {
      alert("Primero debe firmar jefa de ventas.");
      return;
    }

    if (flow?.administracion?.firmado) {
      alert("La firma de administración ya está registrada.");
      return;
    }

    const hadPendingRequest = getPendingFichaUpdateRequests().length > 0;

    const flowPatch = {
      ...(state.group.flowFicha || {}),
      modo: "v2",
      legacy: false,
      estado: "autorizada_admin",
      requiereActualizacion: false,
      requiereRefirmaAdministracion: false,
      administracion: {
        ...(state.group.flowFicha?.administracion || {}),
        firmado: true,
        firmadoAt: serverTimestamp(),
        firmadoPor: nombre,
        firmadoPorCorreo: state.effectiveEmail,
        observacion: ""
      }
    };

    if (hadPendingRequest) {
      flowPatch.ultimaSolicitudActualizacion = {
        ...(state.group.flowFicha?.ultimaSolicitudActualizacion || {}),
        estado: "completada",
        cerradaPor: nombre,
        cerradaPorCorreo: state.effectiveEmail,
        fechaCierre: serverTimestamp()
      };

      flowPatch.ultimaActualizacionCerradaAt = serverTimestamp();
      flowPatch.ultimaActualizacionCerradaPor = nombre;
      flowPatch.ultimaActualizacionCerradaPorCorreo = state.effectiveEmail;
    }

    const patch = {
      fichaFlujoModo: "v2",
      fichaEstado: "autorizada_admin",
      firmaAdministracion: nombre,
      autorizada: true,

      documentos: {
        ...(state.group.documentos || {}),
        fichaGrupo: {
          ...(state.group.documentos?.fichaGrupo || {}),
          estado: "autorizada_admin"
        }
      },

      ficha: {
        ...(state.group.ficha || {}),
        flujoModo: "v2",
        estado: "autorizada_admin",
        pdfPendienteGeneracion: true
      },

      flowFicha: flowPatch
    };

    await saveGroupPatch(patch, {
      tipoMovimiento: "firma_administracion",
      modulo: "ficha",
      titulo: hadPendingRequest ? "Refirma administración" : "Firma administración",
      mensaje: hadPendingRequest
        ? `${nombre} aprobó nuevamente la ficha desde administración y cerró la solicitud de actualización.`
        : `${nombre} autorizó el grupo desde administración.`,
      cambios: [
        { campo: "autorizada", anterior: !!state.group.autorizada, nuevo: true },
        { campo: "fichaEstado", anterior: state.group.fichaEstado || "", nuevo: "autorizada_admin" }
      ],
      reloadAfterSave: false
    });

    if (hadPendingRequest) {
      await markPendingFichaUpdateRequestsAsCompleted({
        resolvedBy: nombre,
        resolvedByCorreo: state.effectiveEmail
      });
    }

    await loadAll();
  }
}

async function applyCriticalChangeRules(patch, cambios) {
  if (!state.group?.autorizada) return;

  const criticalFields = new Set([
    "colegio",
    "curso",
    "anoViaje",
    "cantidadGrupo",
    "destinoPrincipal",
    "programa",
    "tramo",
    "asistenciaMed",
    "fechaViaje",
    "estado",
    "fichaEstado",
    "contratoEstado",
    "nominaEstado",
    "fichaMedicaEstado"
  ]);

  const touchedCritical = cambios.some((c) => {
    const root = String(c.campo || "").split(".")[0];
    return criticalFields.has(c.campo) || criticalFields.has(root);
  });

  if (!touchedCritical) return;

  patch.autorizada = false;
  patch.fichaEstado = normalizeSearchLocal(state.group.fichaEstado) === "autorizada_admin"
    ? "revisada_jefa_ventas"
    : (patch.fichaEstado || state.group.fichaEstado || "pendiente");

  patch.flowFicha = {
    ...(state.group.flowFicha || {}),
    requiereRefirmaAdministracion: true,
    administracion: {
      firmado: false,
      firmadoAt: null,
      firmadoPor: "",
      firmadoPorCorreo: "",
      observacion: ""
    }
  };
}

/* =========================================================
   SAVE CORE
========================================================= */
async function saveGroupPatch(patch, {
  tipoMovimiento = "edicion_datos",
  modulo = "grupo",
  titulo = "Actualización",
  asunto = "",
  mensaje = "",
  cambios = [],
  metadata = {},
  reloadAfterSave = true
} = {}) {
  // Si dentro de los cambios viene "estado",
  // dejamos automáticamente fecha de último cambio de estado
  // y última gestión, tanto para cambios automáticos como manuales.
  applyEstadoAuditFields(patch, cambios);

  patch.actualizadoPor = getDisplayName(state.effectiveUser);
  patch.actualizadoPorCorreo = state.effectiveEmail;
  patch.fechaActualizacion = serverTimestamp();

  await setDoc(doc(db, "ventas_cotizaciones", state.groupDocId), patch, { merge: true });

  await createHistoryEntry({
    tipoMovimiento,
    modulo,
    titulo,
    asunto,
    mensaje,
    cambios,
    metadata
  });

  if (reloadAfterSave) {
    await loadAll();
  }
}

async function createHistoryEntry({
  tipoMovimiento = "movimiento",
  modulo = "grupo",
  titulo = "Movimiento",
  asunto = "",
  mensaje = "",
  cambios = [],
  metadata = {}
} = {}) {
  const baseChanges =
    Array.isArray(cambios) && cambios.length
      ? cambios
      : (Array.isArray(metadata?.cambios) ? metadata.cambios : []);

  const cambiosDetallados = buildDetailedChanges(baseChanges);
  const asuntoFinal =
    cleanText(asunto) ||
    buildHistorySubject({ titulo, cambios: cambiosDetallados }) ||
    cleanText(titulo) ||
    "Movimiento";

  const resumenCambios = buildHistorySummary(cambiosDetallados);
  const mensajeFinal =
    cleanText(mensaje) ||
    resumenCambios ||
    asuntoFinal;

  await addDoc(collection(db, HISTORIAL_COLLECTION), {
    idGrupo: String(state.groupId),
    codigoRegistro: cleanText(state.group?.codigoRegistro),
    aliasGrupo: cleanText(state.group?.aliasGrupo),
    colegio: cleanText(state.group?.colegio),

    tipoMovimiento,
    modulo,
    titulo,
    asunto: asuntoFinal,
    mensaje: mensajeFinal,

    metadata: {
      ...metadata,
      totalCambios: cambiosDetallados.length,
      resumenCambios,
      cambios: baseChanges,
      cambiosDetallados
    },

    destacado: false,
    destacadoAt: null,
    destacadoPor: "",
    destacadoPorCorreo: "",

    oculto: false,
    ocultadoAt: null,
    ocultadoPor: "",
    ocultadoPorCorreo: "",

    creadoPor: getDisplayName(state.effectiveUser),
    creadoPorCorreo: state.effectiveEmail,
    fecha: serverTimestamp()
  });
}

/* =========================================================
   HELPERS DATA
========================================================= */
function buildMeetingSummaryPatchAfterCreate(meetingData) {
  const nextMeeting = getEarliestUpcomingMeeting([
    ...state.meetings,
    meetingData
  ]);

  const patch = {
    ultimaGestionAt: serverTimestamp(),
    ultimaGestionTipo: "reunion"
  };

  if (nextMeeting) {
    patch.proximaReunionFecha = nextMeeting.fechaInicio;
    patch.proximaReunionTipo = nextMeeting.tipo || "";
    patch.proximaReunionLugar = meetingPlaceLabel(nextMeeting);
    patch.proximaReunionLink = nextMeeting.link || "";
  }

  const estadoActual = normalizeState(state.group.estado);
  if (!["ganada", "perdida"].includes(estadoActual)) {
    patch.estado = "reunion_confirmada";
  }

  return patch;
}

function getNextMeeting() {
  return getEarliestUpcomingMeeting(state.meetings);
}

function getEarliestUpcomingMeeting(list = []) {
  const now = nowDate().getTime();

  return list
    .filter((item) => normalizeSearchLocal(item.estadoReunion || "agendada") !== "cancelada")
    .map((item) => ({ ...item, __date: toDate(item.fechaInicio) }))
    .filter((item) => item.__date && item.__date.getTime() >= now)
    .sort((a, b) => a.__date.getTime() - b.__date.getTime())[0] || null;
}

function setDefaultMeetingDates() {
  const now = new Date();
  now.setMinutes(0, 0, 0);

  const start = new Date(now);
  start.setHours(start.getHours() + 2);

  const end = new Date(start);
  end.setHours(end.getHours() + 1);

  setFormValue("r_fechaInicio", toDatetimeLocal(start));
  setFormValue("r_fechaFin", toDatetimeLocal(end));
}

function itemData(label, value, full = false) {
  return {
    label,
    value: stringValue(value),
    full
  };
}

function renderDocChip(key, value) {
  const normalized = normalizeDocState(value);
  return `
    <span class="doc-chip ${docStateClass(normalized)}">
      ${escapeHtml(DOC_LABELS[key] || key)} · ${escapeHtml(getDocStateLabel(normalized))}
    </span>
  `;
}

function renderFlowStep(label, data = {}) {
  const signed = !!data?.firmado;
  const who = data?.firmadoPor || "";
  const when = formatDateTime(data?.firmadoAt);
  const obs = data?.observacion || "";

  return `
    <div class="flow-step">
      <div class="flow-step-top">
        <div class="flow-step-title">${escapeHtml(label)}</div>
        <span class="flow-step-status ${signed ? "signed" : ""}">
          ${signed ? "Firmado" : "Pendiente"}
        </span>
      </div>

      <div class="flow-step-meta">
        ${signed ? escapeHtml(`${who} · ${when}`) : "Sin firma aún"}
        ${obs ? `<br>${escapeHtml(obs)}` : ""}
      </div>
    </div>
  `;
}

function getBlockedEditMessage() {
  if (!state.canModify) {
    return "Tu rol actual es solo de lectura en este grupo.";
  }

  const isVendor = String(state.effectiveUser?.rol || "").toLowerCase() === "vendedor";

  if (isVendor && isVendorLockedByFlow(state.group)) {
    return "Ya firmaste la ficha. Desde este momento no puedes modificar el grupo ni la ficha; debes solicitar actualización a jefa de ventas.";
  }

  if (state.group?.autorizada && isVendor) {
    return "El grupo ya está autorizado. El vendedor(a) debe solicitar actualización y la modificación final debe hacerla jefa de ventas.";
  }

  return "No tienes permisos para editar este grupo.";
}

function prettyLabel(path = "") {
  const map = {
    aliasGrupo: "Alias grupo",
    estado: "Estado",
    colegio: "Colegio",
    curso: "Curso",
    anoViaje: "Año viaje",
    cantidadGrupo: "Cantidad grupo",
    destinoPrincipal: "Destino principal",
    programa: "Programa",
    tramo: "Tramo",
    asistenciaMed: "Asistencia médica",
    semanaViaje: "Semana viaje",
    fechaViaje: "Fecha viaje",
    comunaCiudad: "Comuna / ciudad",
    nombreCliente: "1° Contacto",
    rolCliente: "Rol 1° Contacto",
    correoCliente: "Correo 1° Contacto",
    celularCliente: "Celular 1° Contacto",
    nombreCliente2: "2° Contacto",
    rolCliente2: "Rol 2° Contacto",
    correoCliente2: "Correo 2° Contacto",
    celularCliente2: "Celular 2° Contacto",
    autorizada: "Autorizada",
    cerrada: "Cerrada",
    fichaEstado: "Ficha del grupo",
    contratoEstado: "Contrato",
    nominaEstado: "Nómina",
    fichaMedicaEstado: "Fichas médicas",
    cortesiaEstado: "Cortesías",
    "situacion.resumen": "Resumen",
    "situacion.proximoPaso": "Próximo paso",
    "situacion.observacionVentas": "Observación ventas",
    "situacion.observacionJefaVentas": "Observación jefa ventas",
    "situacion.observacionAdministracion": "Observaciones administración",
    "situacion.observacionOperaciones": "Observaciones operaciones"
  };

  return map[path] || String(path)
    .replaceAll(".", " / ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .trim();
}

function getEstadoLabel(value = "") {
  const key = normalizeState(value);
  return ESTADO_META[key]?.label || "A contactar";
}

function getFichaEstadoLabel(value = "") {
  const v = normalizeSearchLocal(value);
  if (!v) return "Pendiente";
  if (v === "lista_vendedor") return "Lista vendedor";
  if (v === "revisada_jefa_ventas") return "Revisada jefa ventas";
  if (v === "autorizada_admin") return "Autorizada administración";
  if (v === "en_edicion") return "En edición";
  if (v === "ok") return "Ok";
  return capitalize(String(value).replaceAll("_", " "));
}

function getDocStateLabel(value = "") {
  const v = normalizeDocState(value);
  if (v === "ok") return "Ok";
  if (v === "no_aplica") return "No aplica";
  return "Pendiente";
}

function docStateClass(value = "") {
  const v = normalizeDocState(value);
  if (v === "ok" || v === "realizada") return "ok";
  if (v === "no_aplica" || v === "cancelada") return "no_aplica";
  return "pendiente";
}

function normalizeState(value = "") {
  const v = normalizeSearchLocal(value).replaceAll("_", " ");
  if (!v) return "a_contactar";
  if (v.includes("reunion confirm")) return "reunion_confirmada";
  if (v.includes("recot")) return "recotizando";
  if (v.includes("cotiz")) return "cotizando";
  if (v.includes("contactad")) return "contactado";
  if (v.includes("ganad")) return "ganada";
  if (v.includes("perdid")) return "perdida";
  return "a_contactar";
}

function normalizeDocState(value = "") {
  const v = normalizeSearchLocal(value);
  if (!v) return "pendiente";
  if (["ok", "cumplido", "firmado", "generado", "enviado", "realizada", "autorizada admin", "autorizada_admin"].includes(v)) return "ok";
  if (v.includes("no aplica") || v === "n/a" || v === "na" || v === "cancelada") return "no_aplica";
  if (v.includes("lista vendedor")) return "lista_vendedor";
  if (v.includes("revisada jefa ventas")) return "revisada_jefa_ventas";
  if (v.includes("autorizada admin")) return "autorizada_admin";
  if (v.includes("en edicion")) return "en_edicion";
  if (v.includes("generado")) return "generado";
  if (v.includes("enviado")) return "enviado";
  if (v.includes("firmado")) return "firmado";
  return "pendiente";
}

function meetingPlaceLabel(meeting = {}) {
  if (normalizeSearchLocal(meeting.tipo) === "virtual") {
    return meeting.link || "Sin link";
  }
  return meeting.direccion || "Sin dirección";
}

function getDisplayName(user) {
  const name = [user?.nombre, user?.apellido].filter(Boolean).join(" ").trim();
  return name || user?.email || state.effectiveEmail || "Usuario";
}

function getInitials(text = "") {
  const parts = String(text || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "RT";
  return parts.slice(0, 2).map((p) => p[0]?.toUpperCase() || "").join("");
}

function stringValue(value) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (Array.isArray(value)) return value.map(stringValue).filter(Boolean).join(" · ");
  if (isTimestampLike(value)) return formatDateTime(value);
  return String(value);
}

function sameValue(a, b) {
  return normalizeComparable(a) === normalizeComparable(b);
}

function normalizeComparable(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(normalizeComparable).join("|");
  if (isTimestampLike(value)) return String(toDate(value)?.getTime() || "");
  return String(value).trim();
}

function setNestedValue(target, path, value) {
  const parts = String(path).split(".");
  let ref = target;

  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i];
    if (!ref[key] || typeof ref[key] !== "object" || Array.isArray(ref[key])) {
      ref[key] = {};
    }
    ref = ref[key];
  }

  ref[parts[parts.length - 1]] = value;
}

function getByPath(obj, path = "") {
  const parts = String(path).split(".");
  let ref = obj;

  for (const part of parts) {
    if (ref == null) return "";
    ref = ref[part];
  }

  return ref;
}

function setFormValue(id, value) {
  const el = $(id);
  if (!el) return;
  el.value = value == null ? "" : String(value);
}

function setText(id, value) {
  const el = $(id);
  if (!el) return;
  el.textContent = String(value ?? "");
}

function cleanText(value = "") {
  return String(value || "").trim();
}

function parseNumberOrText(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const num = Number(raw);
  return Number.isFinite(num) ? num : raw;
}

function nowDate() {
  return new Date();
}

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value) ? null : value;
  if (typeof value?.toDate === "function") {
    const d = value.toDate();
    return isNaN(d) ? null : d;
  }
  if (typeof value === "string") {
    const d = new Date(value);
    return isNaN(d) ? null : d;
  }
  if (typeof value === "number") {
    const d = new Date(value);
    return isNaN(d) ? null : d;
  }
  return null;
}

function dateValue(value) {
  return toDate(value)?.getTime() || 0;
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

function formatDate(value) {
  const d = toDate(value);
  if (!d) return "—";
  return d.toLocaleDateString("es-CL");
}

function formatTime(value) {
  const d = toDate(value);
  if (!d) return "—";
  return d.toLocaleTimeString("es-CL", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatDateTime(value) {
  const d = toDate(value);
  if (!d) return "—";
  return `${formatDate(d)} · ${formatTime(d)}`;
}

function toDatetimeLocal(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d)) return "";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

function formatInputDate(value) {
  if (!value) return "";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = toDate(value);
  if (!d) return "";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function daysBetween(a, b) {
  if (!(a instanceof Date) || !(b instanceof Date)) return 9999;
  const ms = b.setHours(0,0,0,0) - a.setHours(0,0,0,0);
  return Math.round(ms / 86400000);
}

function capitalize(value = "") {
  const s = String(value || "").trim();
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function normalizeSearchLocal(value = "") {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function escapeHtml(value = "") {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
