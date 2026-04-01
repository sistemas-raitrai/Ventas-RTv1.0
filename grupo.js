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

  autoAlerts: []
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

function isJefaVentas() {
  return normalizeEmail(state.effectiveEmail) === "chernandez@raitrai.cl" || state.effectiveUser?.rol === "admin";
}

function isAdministracion() {
  return normalizeEmail(state.effectiveEmail) === "yenny@raitrai.cl" || state.effectiveUser?.rol === "admin";
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
    pdfNombre: pdfNombre || "PDF ficha"
  };
}

function renderFichaPanel() {
  const box = $("panelFichaViajeBody");
  if (!box) return;

  const ficha = getFichaSummary();
  const isGanada = canCreateFichaFromEstado();

  if (!isGanada && !ficha.exists) {
    box.innerHTML = `
      <div class="empty-box">
        La ficha de viaje se habilita cuando el grupo está en estado GANADA.
      </div>
    `;
    return;
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

    <div class="info-stack" style="margin-top:14px;">
      <div class="info-item">
        <div class="info-label">PDF ficha</div>
        <div class="info-value">
          ${escapeHtml(ficha.pdfUrl ? ficha.pdfNombre : "Sin PDF generado")}
        </div>
      </div>

      <div class="info-item">
        <div class="info-label">Regla de habilitación</div>
        <div class="info-value">
          ${
            isGanada
              ? "Este grupo ya puede crear o editar ficha."
              : "La ficha solo puede crearse cuando el grupo está Ganada."
          }
        </div>
      </div>
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

  setText("situacionEstado", getEstadoLabel(state.group.estado));
  setText("situacionAutorizacion", state.group.autorizada ? "Autorizada" : "No autorizada");
  setText("situacionCierre", state.group.cerrada ? "Cerrada" : "Abierta");
  setText("situacionProximoPaso", getByPath(state.group, "situacion.proximoPaso") || "—");

  renderRichText(
    "situacionObsAdmin",
    getByPath(state.group, "situacion.observacionAdministracion") ||
    state.group.observacionesAdministracion ||
    ""
  );

  renderRichText(
    "situacionObsOperaciones",
    getByPath(state.group, "situacion.observacionOperaciones") ||
    state.group.observacionesOperaciones ||
    ""
  );

  setText("situacionUltimoCambioEstado", fechaCambioEstadoTxt);

  const box = $("panelProximaReunion");
  if (!box) return;

  const nextMeeting = getNextMeeting();
  if (!nextMeeting) {
    box.innerHTML = `<div class="empty-box">No hay reuniones agendadas para este grupo.</div>`;
    return;
  }

  box.innerHTML = `
    <div class="info-item">
      <div class="info-label">Fecha</div>
      <div class="info-value">${escapeHtml(formatDateTime(nextMeeting.fechaInicio))}</div>
    </div>

    <div class="info-item">
      <div class="info-label">Tipo</div>
      <div class="info-value">${escapeHtml(capitalize(nextMeeting.tipo || "—"))}</div>
    </div>

    <div class="info-item">
      <div class="info-label">Lugar / link</div>
      <div class="info-value">${escapeHtml(meetingPlaceLabel(nextMeeting))}</div>
    </div>

    <div class="info-item">
      <div class="info-label">Observaciones</div>
      <div class="info-value">${escapeHtml(nextMeeting.observaciones || "Sin observaciones")}</div>
    </div>
  `;
}

function renderDatos() {
  const grid = $("datosGrupoGrid");
  if (!grid) return;

  const items = [
    itemData("Colegio", state.group.colegio),
    itemData("Curso", state.group.curso),
    itemData("Año viaje", state.group.anoViaje),
    itemData("Cantidad grupo", state.group.cantidadGrupo),

    itemData("Destino principal", state.group.destinoPrincipal),
    itemData("Programa", state.group.programa, true),
    itemData("Tramo", state.group.tramo),
    itemData("Semana viaje", state.group.semanaViaje),

    itemData("Comuna / ciudad", state.group.comunaCiudad),
    itemData("Vendedor(a)", state.group.vendedora || state.group.vendedoraCorreo),

    itemData("1° Contacto", state.group.nombreCliente),
    itemData("Rol 1° Contacto", state.group.rolCliente),
    itemData("Correo 1° Contacto", state.group.correoCliente),
    itemData("Celular 1° Contacto", state.group.celularCliente),

    itemData("2° Contacto", state.group.nombreCliente2),
    itemData("Rol 2° Contacto", state.group.rolCliente2),
    itemData("Correo 2° Contacto", state.group.correoCliente2),
    itemData("Celular 2° Contacto", state.group.celularCliente2)
  ];

  grid.innerHTML = items.map((item) => `
    <div class="${item.full ? "full" : ""}">
      <div class="info-item">
        <div class="info-label">${escapeHtml(item.label)}</div>
        <div class="info-value">${escapeHtml(item.value || "—")}</div>
      </div>
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

  list.innerHTML = merged.map((alertItem) => {
    const isManual = alertItem.tipoLista === "manual";
    const levelClass = alertItem.nivel === "critica" ? "alert-critical" : "";
    const baseClass = isManual ? "alert-manual" : "alert-auto";

    return `
      <div class="list-card ${baseClass} ${levelClass}">
        <div class="list-card-top">
          <div>
            <div class="list-card-title">${escapeHtml(alertItem.titulo || "Alerta")}</div>
            <div class="list-card-meta">
              ${escapeHtml(capitalize(alertItem.nivel || (isManual ? "warning" : "info")))}
              ·
              ${isManual ? "Manual" : "Automática"}
            </div>
          </div>

          ${
            isManual && canEditGroup()
              ? `<button class="btn-danger" type="button" data-action="resolver-alerta" data-id="${escapeHtml(alertItem.id)}">Resolver</button>`
              : ""
          }
        </div>

        <div class="list-card-meta">${escapeHtml(alertItem.mensaje || "Sin mensaje")}</div>
      </div>
    `;
  }).join("");
}

function renderHistory() {
  const list = $("historyList");
  if (!list) return;

  if (!state.history.length) {
    list.innerHTML = `<div class="empty-box">Todavía no hay historial registrado para este grupo.</div>`;
    return;
  }

  list.innerHTML = state.history.map((item) => {
    const cambios = Array.isArray(item?.metadata?.cambios) ? item.metadata.cambios : [];
    const cambiosHtml = cambios.length
      ? "\n" + cambios.map((c) => `• ${prettyLabel(c.campo)}: ${stringValue(c.anterior)} → ${stringValue(c.nuevo)}`).join("\n")
      : "";

    return `
      <div class="timeline-item">
        <div class="timeline-head">
          <div class="timeline-title">${escapeHtml(item.titulo || "Movimiento")}</div>
          <div class="timeline-date">${escapeHtml(formatDateTime(item.fecha))}</div>
        </div>

        <div class="timeline-body">${escapeHtml(item.mensaje || "Sin detalle")}${escapeHtml(cambiosHtml)}</div>
      </div>
    `;
  }).join("");
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
  if (btnFicha) btnFicha.disabled = !editable || !isGanada;

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

  $("btnGuardarDatos")?.addEventListener("click", saveDatos);
  $("btnGuardarSituacion")?.addEventListener("click", saveSituacion);
  $("btnGuardarDocumentos")?.addEventListener("click", saveDocumentos);
  $("btnGuardarReunion")?.addEventListener("click", saveMeeting);
  $("btnGuardarAlerta")?.addEventListener("click", saveManualAlert);

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
}

function openModal(id) {
  $(id)?.classList.add("show");
}

function closeModal(id) {
  $(id)?.classList.remove("show");
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
  setFormValue("s_autorizada", String(!!state.group.autorizada));
  setFormValue("s_cerrada", String(!!state.group.cerrada));
  setFormValue("s_resumen", getByPath(state.group, "situacion.resumen"));
  setFormValue("s_proximoPaso", getByPath(state.group, "situacion.proximoPaso"));
  setFormValue("s_obsVentas", getByPath(state.group, "situacion.observacionVentas"));
  setFormValue("s_obsJefa", getByPath(state.group, "situacion.observacionJefaVentas"));

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
}

async function saveSituacion() {
  const patch = {};
  const cambios = [];

  const values = {
    estado: $("s_estado")?.value || "a_contactar",
    autorizada: String($("s_autorizada")?.value) === "true",
    cerrada: String($("s_cerrada")?.value) === "true",
    "situacion.resumen": $("s_resumen")?.value || "",
    "situacion.proximoPaso": $("s_proximoPaso")?.value || "",
    "situacion.observacionVentas": $("s_obsVentas")?.value || "",
    "situacion.observacionJefaVentas": $("s_obsJefa")?.value || "",
    "situacion.observacionAdministracion": getRichEditorHtml("s_obsAdmin"),
    "situacion.observacionOperaciones": getRichEditorHtml("s_obsOperaciones")
  };

  for (const path of SITUACION_FIELDS) {
    const anterior =
      path === "situacion.observacionAdministracion"
        ? (getByPath(state.group, path) || state.group.observacionesAdministracion || "")
        : path === "situacion.observacionOperaciones"
          ? (getByPath(state.group, path) || state.group.observacionesOperaciones || "")
          : getByPath(state.group, path);

    const nuevo = values[path];

    const changed = path === "situacion.observacionAdministracion" || path === "situacion.observacionOperaciones"
      ? normalizeRichHtml(anterior) !== normalizeRichHtml(nuevo)
      : !sameValue(anterior, nuevo);

    if (changed) {
      setNestedValue(patch, path, nuevo);
      cambios.push({ campo: path, anterior, nuevo });
    }
  }

  if (!cambios.length) {
    closeModal("modalSituacion");
    return;
  }

  patch.observacionesAdministracion = values["situacion.observacionAdministracion"];
  patch.observacionesOperaciones = values["situacion.observacionOperaciones"];

  await applyCriticalChangeRules(patch, cambios);
  await saveGroupPatch(patch, {
    tipoMovimiento: "cambio_estado",
    modulo: "grupo",
    titulo: "Actualización de situación",
    mensaje: `${getDisplayName(state.effectiveUser)} actualizó la situación comercial del grupo.`,
    cambios
  });

  closeModal("modalSituacion");
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
    titulo: "Nueva alerta manual",
    mensaje: `${getDisplayName(state.effectiveUser)} creó una alerta manual para este grupo.`,
    metadata: {
      cambios: [
        { campo: "alerta.titulo", anterior: "", nuevo: titulo },
        { campo: "alerta.nivel", anterior: "", nuevo: nivel }
      ]
    }
  });

  closeModal("modalAlerta");
  await loadAll();
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
    mensaje: `${getDisplayName(state.effectiveUser)} resolvió la alerta manual "${item.titulo}".`
  });

  await loadAll();
}

/* =========================================================
   FLOW / FIRMAS
========================================================= */
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
      "documentos.fichaGrupo.estado": "lista_vendedor",
    
      ficha: {
        ...(state.group.ficha || {}),
        flujoModo: "v2"
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

    const patch = {
      fichaEstado: "revisada_jefa_ventas",
      "documentos.fichaGrupo.estado": "revisada_jefa_ventas",
      flowFicha: {
        ...(state.group.flowFicha || {}),
        estado: "revisada_jefa_ventas",
        jefaVentas: {
          firmado: true,
          firmadoAt: serverTimestamp(),
          firmadoPor: nombre,
          firmadoPorCorreo: state.effectiveEmail,
          observacion: ""
        }
      }
    };

    await saveGroupPatch(patch, {
      tipoMovimiento: "firma_jefa_ventas",
      modulo: "ficha",
      titulo: "Firma jefa de ventas",
      mensaje: `${nombre} revisó la ficha como jefa de ventas.`,
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

    const patch = {
      fichaEstado: "autorizada_admin",
      "documentos.fichaGrupo.estado": "autorizada_admin",
      autorizada: true,
      flowFicha: {
        ...(state.group.flowFicha || {}),
        estado: "autorizada_admin",
        requiereRefirmaAdministracion: false,
        administracion: {
          firmado: true,
          firmadoAt: serverTimestamp(),
          firmadoPor: nombre,
          firmadoPorCorreo: state.effectiveEmail,
          observacion: ""
        }
      }
    };

    await saveGroupPatch(patch, {
      tipoMovimiento: "firma_administracion",
      modulo: "ficha",
      titulo: "Firma administración",
      mensaje: `${nombre} autorizó el grupo desde administración.`,
      cambios: [
        { campo: "autorizada", anterior: !!state.group.autorizada, nuevo: true },
        { campo: "fichaEstado", anterior: state.group.fichaEstado || "", nuevo: "autorizada_admin" }
      ]
    });
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
  mensaje = "",
  cambios = [],
  reloadAfterSave = true
} = {}) {
  patch.actualizadoPor = getDisplayName(state.effectiveUser);
  patch.actualizadoPorCorreo = state.effectiveEmail;
  patch.fechaActualizacion = serverTimestamp();

  await setDoc(doc(db, "ventas_cotizaciones", state.groupDocId), patch, { merge: true });

  await createHistoryEntry({
    tipoMovimiento,
    modulo,
    titulo,
    mensaje,
    metadata: { cambios }
  });

  if (reloadAfterSave) {
    await loadAll();
  }
}

async function createHistoryEntry({
  tipoMovimiento = "movimiento",
  modulo = "grupo",
  titulo = "Movimiento",
  mensaje = "",
  metadata = {}
} = {}) {
  await addDoc(collection(db, HISTORIAL_COLLECTION), {
    idGrupo: String(state.groupId),
    codigoRegistro: cleanText(state.group?.codigoRegistro),
    aliasGrupo: cleanText(state.group?.aliasGrupo),
    colegio: cleanText(state.group?.colegio),
    tipoMovimiento,
    modulo,
    titulo,
    mensaje,
    metadata,
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
  const v = normalizeSearchLocal(value);
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
