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
  updateDoc,
  deleteDoc,
  serverTimestamp,
  Timestamp,
  deleteField
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
const EMAIL_TEMPLATES_COLLECTION = "ventas_email_templates";

const DEFAULT_CORREO_CAMBIOS_INSCRIPCION = "operaciones@raitrai.cl";

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
  inscripciones: [],
  editingMeetingId: "",

  autoAlerts: [],

  emailTemplates: [],
  emailUi: {
    selectedTemplateId: "",
    editingTemplateId: "",
    activeTargetEmail: "",
    mode: "single",
    bulkRecipients: []
  },

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

const DESTINO_PRINCIPAL_OPTIONS = [
  "BARILOCHE",
  "SUR DE CHILE",
  "SUR DE CHILE Y BARILOCHE",
  "BRASIL",
  "NORTE DE CHILE",
  "MÉXICO",
  "REPÚBLICA DOMINICANA",
  "OTRO"
];

const ROL_CONTACTO_OPTIONS = [
  "ESTUDIANTE",
  "APODERADO(A)",
  "PROFESOR(A)",
  "COMISION GIRA",
  "OTRO(A)"
];

const TRAMO_OPTIONS = [
  "36 – 39",
  "30 – 35",
  "26 – 29",
  "23 – 25",
  "20 – 22",
  "18 – 19",
  "15 – 17",
  "OTRO"
];

const MES_VIAJE_OPTIONS = [
  "ENERO",
  "FEBRERO",
  "MARZO",
  "ABRIL",
  "MAYO",
  "JUNIO",
  "JULIO",
  "AGOSTO",
  "SEPTIEMBRE",
  "OCTUBRE",
  "NOVIEMBRE",
  "DICIEMBRE",
  "OTRO"
];

const PROGRAM_OPTIONS_BY_DESTINO = {
  [normalizeOptionKey("BRASIL")]: [
    "CAMBORIU FULL 8/7",
    "CAMBORIU ECO 8/7",
    "CAMBORIU ECO 6/5",
    "OTRO"
  ],

  [normalizeOptionKey("BARILOCHE")]: [
    "BARILOCHE 6/5",
    "BARILOCHE TERRESTRE 6/5",
    "BARILOCHE TERRESTRE 5/4",
    "OTRO"
  ],

  [normalizeOptionKey("SUR DE CHILE Y BARILOCHE")]: [
    "SUR DE CHILE Y BARILOCHE CON VALDIVIA 8/7",
    "SUR DE CHILE Y BARILOCHE CON VALDIVIA 7/6",
    "SUR DE CHILE Y BARILOCHE SURFACE 7/6",
    "SUR DE CHILE Y BARILOCHE 7/6",
    "SUR DE CHILE Y BARILOCHE 6/5",
    "PUCON Y BARILOCHE 7/6",
    "OTRO"
  ],

  [normalizeOptionKey("BARILOCHE Y SUR DE CHILE")]: [
    "SUR DE CHILE Y BARILOCHE CON VALDIVIA 8/7",
    "SUR DE CHILE Y BARILOCHE CON VALDIVIA 7/6",
    "SUR DE CHILE Y BARILOCHE SURFACE 7/6",
    "SUR DE CHILE Y BARILOCHE 7/6",
    "SUR DE CHILE Y BARILOCHE 6/5",
    "PUCON Y BARILOCHE 7/6",
    "OTRO"
  ],

  [normalizeOptionKey("SUR DE CHILE")]: [
    "SUR DE CHILE Y HUILO HUILO 7/6",
    "SUR DE CHILE Y HUILO HUILO 6/5",
    "SUR DE CHILE Y PUCON 7/6",
    "SOLO PUERTO VARAS 7/6",
    "SOLO PUERTO VARAS 6/5",
    "SOLO PUERTO VARAS 5/4",
    "TORRES DEL PAINE 7/6",
    "TORRES DEL PAINE 6/5",
    "TORRES DEL PAINE 5/4",
    "VALLE LAS TRANCAS 6/5",
    "VALLE LAS TRANCAS 5/4",
    "OTRO"
  ],

  [normalizeOptionKey("NORTE DE CHILE")]: [
    "SAN PEDRO ATACAMA 7/6",
    "SAN PEDRO ATACAMA 6/5",
    "OTRO"
  ],

  [normalizeOptionKey("MÉXICO")]: [
    "CANCUN Y PLAYA DEL CARMEN 8/7",
    "CANCUN Y PLAYA DEL CARMEN 7/6",
    "CANCUN Y PLAYA DEL CARMEN 6/5",
    "OTRO"
  ],

  [normalizeOptionKey("REPÚBLICA DOMINICANA")]: [
    "PUNTA CANA - BAYAHIBE 8/7",
    "PUNTA CANA - BAYAHIBE 7/6",
    "PUNTA CANA - BAYAHIBE 6/5",
    "OTRO"
  ],

  [normalizeOptionKey("OTRO")]: [
    "OTRO"
  ]
};

const DATA_FIELDS = [
  "colegio",
  "curso",
  "anoViaje",
  "cantidadGrupo",
  "destinoPrincipal",
  "destinoPrincipalOtro",
  "programa",
  "programaOtro",
  "tramo",
  "tramoOtro",
  "mesViaje",
  "mesViajeOtro",
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
    loadRequests(),
    loadEmailTemplates(),
    loadInscripciones()
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

async function loadEmailTemplates() {
  state.emailTemplates = [];

  try {
    const currentEmail = normalizeEmail(state.effectiveEmail || "");
    if (!currentEmail) return;

    const snap = await getDocs(
      query(
        collection(db, EMAIL_TEMPLATES_COLLECTION),
        where("ownerEmail", "==", currentEmail)
      )
    );

    state.emailTemplates = snap.docs
      .map((d) => ({
        id: d.id,
        ...d.data()
      }))
      .filter((item) => item.activa !== false)
      .sort((a, b) => {
        const aName = cleanText(a.nombre || "").toLowerCase();
        const bName = cleanText(b.nombre || "").toLowerCase();
        return aName.localeCompare(bName, "es");
      });
  } catch (error) {
    console.error("[grupo] loadEmailTemplates", error);
  }
}

async function loadInscripciones() {
  state.inscripciones = [];

  try {
    const snap = await getDocs(
      collection(db, "ventas_cotizaciones", String(state.groupDocId), "inscripciones")
    );

    state.inscripciones = snap.docs
      .map((d) => ({
        id: d.id,
        ...d.data()
      }))
      .filter((item) => {
        const estadoPrivacidad = normalizeSearchLocal(item?.privacidad?.estado || "");
        return estadoPrivacidad !== "eliminada_logica" && estadoPrivacidad !== "archivada";
      })
      .sort((a, b) => {
        const ordenA = getOrdenOperativoInscripcion(a);
        const ordenB = getOrdenOperativoInscripcion(b);
      
        if (ordenA !== ordenB) return ordenA - ordenB;
      
        const fechaA = dateValue(getFechaFormularioInscripcion(a));
        const fechaB = dateValue(getFechaFormularioInscripcion(b));
      
        return fechaB - fechaA;
      });
  } catch (error) {
    console.error("[grupo] loadInscripciones", error);
  }
}

function canManageEmailTemplates() {
  return !!normalizeEmail(state.effectiveEmail || "");
}

function getGrupoCortoCorreo() {
  const colegio = normalizeTextUpper(state.group?.colegio || "");
  const curso = normalizeTextUpper(state.group?.curso || "");
  const ano = cleanText(state.group?.anoViaje || "");

  return `${colegio}${curso ? ` ${curso}` : ""}${ano ? ` (${ano})` : ""}`.trim();
}

function getBuiltinEmailTemplateById(id = "") {
  if (id !== "__ficha_medica__") return null;

  return {
    id: "__ficha_medica__",
    nombre: "Ficha médica",
    categoria: "inscripcion",
    asuntoTemplate: "Ficha médica habilitada · {{grupoCorto}}",
    cuerpoTemplate:
`Estimados/as apoderados/as:

Junto con saludar, informamos que desde ahora se encuentra habilitado el ingreso de datos para completar la ficha médica del viaje de estudios del grupo {{grupoCorto}}.

Les solicitamos ingresar al link enviado por Turismo Rai Trai y completar cuidadosamente la información solicitada, especialmente antecedentes médicos, alergias, medicamentos, contactos de emergencia y datos personales del/de la pasajero/a.

Esta información es fundamental para la correcta organización del viaje y para que nuestro equipo pueda contar con los antecedentes necesarios antes de la salida.

Agradecemos completar el formulario dentro de los próximos días.

Saludos cordiales,
{{firmaUsuario}}
Turismo Rai Trai`
  };
}

function getEmailVariableMap({ email = "", contactLabel = "" } = {}) {
  const nombre1 = normalizeTextUpper(state.group?.nombreCliente || "");
  const nombre2 = normalizeTextUpper(state.group?.nombreCliente2 || "");

  const email1 = normalizeEmail(state.group?.correoCliente || "");
  const email2 = normalizeEmail(state.group?.correoCliente2 || "");
  const emailNorm = normalizeEmail(email || "");

  const contactName =
    emailNorm === email1
      ? (nombre1 || contactLabel || "")
      : emailNorm === email2
        ? (nombre2 || contactLabel || "")
        : (contactLabel || "");

  return {
    contacto: contactName || "",
    nombreContacto: contactName || "",
    email: emailNorm || "",
    correo: emailNorm || "",

    idGrupo: String(state.groupId || ""),
    aliasGrupo: cleanText(state.group?.aliasGrupo || ""),
    grupoCorto: getGrupoCortoCorreo(),
    nombreGrupo: cleanText(state.group?.nombreGrupo || ""),
    colegio: normalizeTextUpper(state.group?.colegio || ""),
    curso: normalizeTextUpper(state.group?.curso || ""),
    anoViaje: cleanText(state.group?.anoViaje || ""),
    comunaCiudad: normalizeTextUpper(state.group?.comunaCiudad || ""),
    destinoPrincipal: normalizeTextUpper(getDestinoPrincipalDisplay(state.group) || ""),
    programa: normalizeTextUpper(getProgramaDisplay(state.group) || ""),
    tramo: normalizeTextUpper(getTramoDisplay(state.group) || ""),
    mesViaje: normalizeTextUpper(getMesViajeDisplay(state.group) || ""),
    cantidadGrupo: cleanText(state.group?.cantidadGrupo || ""),
    vendedora: cleanText(state.group?.vendedora || state.group?.vendedoraCorreo || ""),
    numeroNegocio: cleanText(state.group?.numeroNegocio || ""),

    firmaUsuario: getDisplayName(state.effectiveUser),
    firmaCorreo: state.effectiveEmail || ""
  };
}

function replaceTemplateVariables(text = "", variables = {}) {
  return String(text || "").replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
    return String(variables[key] ?? "");
  });
}

function getSelectedEmailTemplate() {
  return getBuiltinEmailTemplateById(state.emailUi.selectedTemplateId) ||
    state.emailTemplates.find((item) => item.id === state.emailUi.selectedTemplateId) ||
    null;
}

function renderEmailTemplateOptions() {
  const select = $("email_template");
  if (!select) return;

  const current = state.emailUi.selectedTemplateId || "";

  select.innerHTML = `
    <option value="">Sin plantilla</option>
    <option value="__ficha_medica__">Ficha médica</option>
    ${state.emailTemplates.map((tpl) => `
      <option value="${escapeHtml(tpl.id)}">${escapeHtml(tpl.nombre || "Plantilla")}</option>
    `).join("")}
  `;

  select.value = current;
}

function buildDefaultEmailDraft({ email = "", contactLabel = "" } = {}) {
  const vars = getEmailVariableMap({ email, contactLabel });

  return {
    asunto: `Viaje de estudios ${vars.colegio || vars.aliasGrupo || ""}`.trim(),
    cuerpo:
`Hola ${vars.nombreContacto || ""},

Te escribo por el grupo ${vars.aliasGrupo || vars.nombreGrupo || vars.colegio || ""}${vars.anoViaje ? `, viaje ${vars.anoViaje}` : ""}.

Quedo atento(a) a tus comentarios.

Saludos,
${vars.firmaUsuario || ""}`.trim()
  };
}

function applyEmailTemplateSelection() {
  const para = normalizeEmail($("email_to")?.value || "");
  const contactLabel = cleanText($("email_contact_label")?.value || "");
  const tpl = getSelectedEmailTemplate();

  if (!tpl) {
    const draft = buildDefaultEmailDraft({ email: para, contactLabel });
    setFormValue("email_subject", draft.asunto);
    setFormValue("email_body", draft.cuerpo);
    return;
  }

  const vars = getEmailVariableMap({
    email: state.emailUi.mode === "bulk_inscripcion" ? "" : para,
    contactLabel: state.emailUi.mode === "bulk_inscripcion" ? "" : contactLabel
  });

  setFormValue("email_subject", replaceTemplateVariables(tpl.asuntoTemplate || "", vars));
  setFormValue("email_body", replaceTemplateVariables(tpl.cuerpoTemplate || "", vars));
}

function syncEmailTemplateButtons() {
  const canManage = canManageEmailTemplates();
  const hasSelected = !!state.emailUi.selectedTemplateId;

  const btnNew = $("btnNewEmailTemplate");
  const btnEdit = $("btnEditEmailTemplate");
  const btnDelete = $("btnDeleteEmailTemplate");

  if (btnNew) {
    btnNew.disabled = !canManage;
    btnNew.classList.toggle("hidden", !canManage);
  }

  if (btnEdit) {
    btnEdit.disabled = !canManage || !hasSelected;
    btnEdit.classList.toggle("hidden", !canManage);
  }

  if (btnDelete) {
    btnDelete.disabled = !canManage || !hasSelected;
    btnDelete.classList.toggle("hidden", !canManage);
  }
}

function ensureEmailBulkUi() {
  if ($("email_bulk_wrap")) return;

  const emailTo = $("email_to");
  if (!emailTo) return;

  const wrap = document.createElement("div");
  wrap.id = "email_bulk_wrap";
  wrap.className = "hidden form-field span-3 email-bulk-wrap";
  wrap.innerHTML = `
    <div class="email-bulk-head">
      <div>
        <div class="email-bulk-title">Destinatarios BCC / CCO</div>
        <div id="email_bulk_summary" class="email-bulk-summary"></div>
      </div>

      <div class="email-bulk-actions">
        <button type="button" class="btn-pill" data-email-bulk-select="all">Seleccionar todos</button>
        <button type="button" class="btn-pill" data-email-bulk-select="pending">Solo pendientes ficha médica</button>
        <button type="button" class="btn-pill" data-email-bulk-select="none">Limpiar</button>
      </div>
    </div>

    <div id="email_bulk_list" class="email-bulk-list"></div>
  `;

  emailTo.closest(".form-group, label, div")?.after(wrap);
}

function buildDestinatariosApoderadosInscripcion() {
  const vistos = new Set();

  return state.inscripciones
    .map((item) => {
      const correo = normalizeEmail(getByPath(item, "contactoPrincipal.correo") || "");
      const nombreResponsable = getResponsablePrincipalNombre(item);
      const nombreParticipante = buildNombreCompletoInscripcion(item);
      const documento = getInscripcionDocumento(item);
      const pendienteFicha = fichaMedicaPendiente(item);

      return {
        id: item.id,
        correo,
        nombreResponsable,
        nombreParticipante,
        documento,
        pendienteFicha
      };
    })
    .filter((d) => {
      if (!d.correo) return false;
      if (vistos.has(d.correo)) return false;
      vistos.add(d.correo);
      return true;
    })
    .sort((a, b) => {
      if (a.pendienteFicha !== b.pendienteFicha) return a.pendienteFicha ? -1 : 1;
      return a.nombreParticipante.localeCompare(b.nombreParticipante, "es");
    });
}

function renderEmailBulkRecipients() {
  ensureEmailBulkUi();

  const list = $("email_bulk_list");
  const summary = $("email_bulk_summary");
  if (!list || !summary) return;

  const seleccionados = state.emailUi.bulkRecipients.filter((d) => d.selected);
  const pendientes = state.emailUi.bulkRecipients.filter((d) => d.pendienteFicha);

  summary.textContent =
    `${seleccionados.length} seleccionado(s) · ${state.emailUi.bulkRecipients.length} correos disponibles · ${pendientes.length} pendiente(s) de ficha médica`;

  list.innerHTML = state.emailUi.bulkRecipients.length
    ? state.emailUi.bulkRecipients.map((d, index) => `
      <label class="email-bulk-row">
        <input
          type="checkbox"
          data-email-bulk-index="${index}"
          ${d.selected ? "checked" : ""}
        />

        <div>
          <div class="email-bulk-name">${escapeHtml(d.nombreParticipante || "Participante")}</div>
          <div class="email-bulk-detail">
            Apoderado/a: ${escapeHtml(d.nombreResponsable || "—")} · ${escapeHtml(d.correo)}
          </div>
          <div class="${d.pendienteFicha ? "email-bulk-pending" : "email-bulk-ok"}">
            ${d.pendienteFicha ? "Ficha médica pendiente" : "Ficha médica completa"}
          </div>
        </div>
      </label>
    `).join("")
    : `<div class="empty-box">No hay correos de apoderados disponibles.</div>`;
}

function syncEmailBulkVisibility() {
  ensureEmailBulkUi();

  const bulkWrap = $("email_bulk_wrap");
  const emailTo = $("email_to");

  if (!bulkWrap || !emailTo) return;

  const isBulk = state.emailUi.mode === "bulk_inscripcion";

  bulkWrap.classList.toggle("hidden", !isBulk);
  emailTo.disabled = isBulk;

  if (isBulk) {
    emailTo.value = "";
  }
}

function openEmailModalInscripcion() {
  const destinatarios = buildDestinatariosApoderadosInscripcion();

  if (!destinatarios.length) {
    alert("No hay correos de apoderados disponibles para este grupo.");
    return;
  }

  state.emailUi.mode = "bulk_inscripcion";
  state.emailUi.activeTargetEmail = "";
  state.emailUi.selectedTemplateId = "__ficha_medica__";
  state.emailUi.bulkRecipients = destinatarios.map((d) => ({
    ...d,
    selected: d.pendienteFicha
  }));

  const hayPendientes = state.emailUi.bulkRecipients.some((d) => d.selected);
  if (!hayPendientes) {
    state.emailUi.bulkRecipients = state.emailUi.bulkRecipients.map((d) => ({
      ...d,
      selected: true
    }));
  }

  setFormValue("email_to", "");
  setFormValue("email_contact_label", "");
  setFormValue("email_subject", "");
  setFormValue("email_body", "");

  renderEmailTemplateOptions();
  syncEmailTemplateButtons();
  syncEmailBulkVisibility();
  renderEmailBulkRecipients();
  applyEmailTemplateSelection();

  openModal("modalCorreo");
}

function getSelectedBulkEmails() {
  return state.emailUi.bulkRecipients
    .filter((d) => d.selected && d.correo)
    .map((d) => d.correo);
}

async function openEmailModal({ email = "", contactLabel = "" } = {}) {
  const normalizedEmail = normalizeEmail(email || "");
  if (!normalizedEmail) {
    alert("Este contacto no tiene correo disponible.");
    return;
  }

  state.emailUi.mode = "single";
  state.emailUi.bulkRecipients = [];
  state.emailUi.activeTargetEmail = normalizedEmail;
  state.emailUi.selectedTemplateId = "";

  setFormValue("email_to", normalizedEmail);
  setFormValue("email_contact_label", contactLabel || "");
  setFormValue("email_subject", "");
  setFormValue("email_body", "");

  renderEmailTemplateOptions();
  syncEmailTemplateButtons();
  syncEmailBulkVisibility();
  applyEmailTemplateSelection();

  openModal("modalCorreo");
}

function openEmailTemplateModal(mode = "create") {
  if (!canManageEmailTemplates()) {
    alert("Solo admin y supervisión pueden administrar plantillas.");
    return;
  }

  if (mode === "edit") {
    const tpl = getSelectedEmailTemplate();

    const currentEmail = normalizeEmail(state.effectiveEmail || "");
    if (normalizeEmail(tpl?.ownerEmail || "") !== currentEmail) {
      alert("Solo puedes editar tus propias plantillas.");
      return;
    }

    if (!tpl) {
      alert("Debes seleccionar una plantilla.");
      return;
    }

    state.emailUi.editingTemplateId = tpl.id;
    setText("emailTemplateModalTitle", "Editar plantilla");
    setFormValue("tpl_nombre", tpl.nombre || "");
    setFormValue("tpl_asunto", tpl.asuntoTemplate || "");
    setFormValue("tpl_cuerpo", tpl.cuerpoTemplate || "");
    setFormValue("tpl_categoria", tpl.categoria || "grupo");
  } else {
    state.emailUi.editingTemplateId = "";
    setText("emailTemplateModalTitle", "Nueva plantilla");
    setFormValue("tpl_nombre", "");
    setFormValue("tpl_asunto", "");
    setFormValue("tpl_cuerpo", "");
    setFormValue("tpl_categoria", "grupo");
  }

  openModal("modalTemplateEmail");
}

async function saveEmailTemplate() {
  if (!canManageEmailTemplates()) {
    alert("Solo admin y supervisión pueden administrar plantillas.");
    return;
  }

  const nombre = cleanText($("tpl_nombre")?.value || "");
  const asuntoTemplate = String($("tpl_asunto")?.value || "").trim();
  const cuerpoTemplate = String($("tpl_cuerpo")?.value || "").trim();
  const categoria = cleanText($("tpl_categoria")?.value || "grupo") || "grupo";

  if (!nombre) {
    alert("Debes ingresar un nombre para la plantilla.");
    return;
  }

  if (!asuntoTemplate) {
    alert("Debes ingresar un asunto para la plantilla.");
    return;
  }

  if (!cuerpoTemplate) {
    alert("Debes ingresar un cuerpo para la plantilla.");
    return;
  }

  const payload = {
    nombre,
    categoria,
    asuntoTemplate,
    cuerpoTemplate,
    activa: true,

    ownerEmail: normalizeEmail(state.effectiveEmail || ""),
    ownerName: getDisplayName(state.effectiveUser),

    actualizadoPor: getDisplayName(state.effectiveUser),
    actualizadoPorCorreo: state.effectiveEmail,
    fechaActualizacion: serverTimestamp()
  };

  if (state.emailUi.editingTemplateId) {
    await updateDoc(doc(db, EMAIL_TEMPLATES_COLLECTION, state.emailUi.editingTemplateId), payload);

    await createHistoryEntry({
      tipoMovimiento: "plantilla_correo_editada",
      modulo: "correo",
      titulo: "Plantilla de correo editada",
      asunto: nombre,
      mensaje: `${getDisplayName(state.effectiveUser)} editó la plantilla "${nombre}".`
    });
  } else {
    await addDoc(collection(db, EMAIL_TEMPLATES_COLLECTION), {
      ...payload,
      creadoPor: getDisplayName(state.effectiveUser),
      creadoPorCorreo: state.effectiveEmail,
      fechaCreacion: serverTimestamp()
    });

    await createHistoryEntry({
      tipoMovimiento: "plantilla_correo_creada",
      modulo: "correo",
      titulo: "Plantilla de correo creada",
      asunto: nombre,
      mensaje: `${getDisplayName(state.effectiveUser)} creó la plantilla "${nombre}".`
    });
  }

  await loadEmailTemplates();
  renderEmailTemplateOptions();
  syncEmailTemplateButtons();

  closeModal("modalTemplateEmail");
  showSaveNotice("Plantilla guardada correctamente.");
}

async function deleteSelectedEmailTemplate() {
  if (!canManageEmailTemplates()) {
    alert("Solo admin y supervisión pueden administrar plantillas.");
    return;
  }

  const tpl = getSelectedEmailTemplate();
  if (!tpl) {
    alert("Debes seleccionar una plantilla.");
    return;
  }

  const currentEmail = normalizeEmail(state.effectiveEmail || "");
  if (normalizeEmail(tpl.ownerEmail || "") !== currentEmail) {
    alert("Solo puedes eliminar tus propias plantillas.");
    return;
  }

  const ok = confirm(`¿Eliminar la plantilla "${tpl.nombre}"?`);
  if (!ok) return;

  await deleteDoc(doc(db, EMAIL_TEMPLATES_COLLECTION, tpl.id));

  await createHistoryEntry({
    tipoMovimiento: "plantilla_correo_eliminada",
    modulo: "correo",
    titulo: "Plantilla de correo eliminada",
    asunto: tpl.nombre || "Plantilla",
    mensaje: `${getDisplayName(state.effectiveUser)} eliminó la plantilla "${tpl.nombre || "Plantilla"}".`
  });

  state.emailUi.selectedTemplateId = "";
  await loadEmailTemplates();
  renderEmailTemplateOptions();
  syncEmailTemplateButtons();
  applyEmailTemplateSelection();

  showSaveNotice("Plantilla eliminada correctamente.");
}

async function goToGmailWithDraft() {
  const isBulk = state.emailUi.mode === "bulk_inscripcion";

  const para = normalizeEmail($("email_to")?.value || "");
  const bccList = isBulk ? getSelectedBulkEmails() : [];
  const asunto = String($("email_subject")?.value || "").trim();
  const cuerpo = String($("email_body")?.value || "").trim();
  const contactLabel = cleanText($("email_contact_label")?.value || "");
  const tpl = getSelectedEmailTemplate();

  if (!isBulk && !para) {
    alert("Debes indicar un destinatario.");
    return;
  }

  if (isBulk && !bccList.length) {
    alert("Debes seleccionar al menos un apoderado.");
    return;
  }

  if (!asunto) {
    alert("Debes indicar un asunto.");
    return;
  }

  if (!cuerpo) {
    alert("Debes indicar el cuerpo del correo.");
    return;
  }

  const baseUrl = "https://mail.google.com/mail/u/0/?view=cm&fs=1";

  const paramsArray = [];

  if (isBulk) {
    paramsArray.push(`bcc=${encodeURIComponent(bccList.join(","))}`);
  } else {
    paramsArray.push(`to=${encodeURIComponent(para)}`);
  }

  paramsArray.push(`su=${encodeURIComponent(asunto)}`);
  paramsArray.push(`body=${encodeURIComponent(cuerpo)}`);

  window.open(`${baseUrl}&${paramsArray.join("&")}`, "_blank", "noopener");

  await createHistoryEntry({
    tipoMovimiento: "correo_preparado",
    modulo: "correo",
    titulo: isBulk ? "Correo masivo preparado" : "Correo preparado",
    asunto: asunto,
    mensaje: isBulk
      ? `${getDisplayName(state.effectiveUser)} preparó un correo masivo por Gmail para ${bccList.length} apoderado(s) del grupo ${getGrupoCortoCorreo()}${tpl ? ` usando la plantilla "${tpl.nombre}"` : ""}.`
      : `${getDisplayName(state.effectiveUser)} preparó un correo para ${contactLabel || para}${tpl ? ` usando la plantilla "${tpl.nombre}"` : ""}.`,
    metadata: {
      modo: isBulk ? "bulk_inscripcion" : "single",
      destinatario: isBulk ? "" : para,
      bcc: isBulk ? bccList : [],
      totalBcc: isBulk ? bccList.length : 0,
      plantillaId: tpl?.id || "",
      plantillaNombre: tpl?.nombre || "",
      asuntoCorreo: asunto,
      grupoCorto: getGrupoCortoCorreo()
    }
  });

  closeModal("modalCorreo");
  showSaveNotice(isBulk ? "Se abrió Gmail con los apoderados en BCC/CCO." : "Se abrió Gmail con el borrador listo.");
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

  if (isAdministracionBlockedFromGroupEdit()) {
    return false;
  }

  if (isVendor && isVendorLockedByFlow(state.group)) {
    return false;
  }

  if (state.group?.autorizada && isVendor) {
    return false;
  }

  return canAccessGroup(state.group);
}

function isRolAdminOSupervision() {
  const rol = String(state.effectiveUser?.rol || "").toLowerCase();
  return rol === "admin" || rol === "supervision";
}

function isRolRegistro() {
  const rol = String(state.effectiveUser?.rol || "").toLowerCase();
  return rol === "registro";
}

function isRolAdministracionInscripcion() {
  const email = normalizeEmail(state.effectiveEmail || "");

  return (
    isRolAdminOSupervision() ||
    isRolRegistro() ||
    email === "yenny@raitrai.cl" ||
    email === "administracion@raitrai.cl" ||
    email === "raitrai@raitrai.cl"
  );
}

function isRolVendedorInscripcion() {
  return String(state.effectiveUser?.rol || "").toLowerCase() === "vendedor";
}

function getAnoViajeInscripcion() {
  return Number(state.group?.anoViaje || 0);
}

function inscripcionPrincipalEstaCerrada() {
  return !state.group?.inscripcionHabilitada || getInscripcionEstadoActual() === "cerrada";
}

function esFechaListaEsperaAutomatica() {
  const anoViaje = getAnoViajeInscripcion();
  if (!anoViaje || anoViaje < 2027) return false;

  const hoy = new Date();
  const inicioListaEspera = new Date(anoViaje, 2, 16, 0, 0, 0); // 16 marzo

  return hoy >= inicioListaEspera;
}

function debeSugerirListaEspera() {
  const anoViaje = getAnoViajeInscripcion();

  if (anoViaje === 2026 && inscripcionPrincipalEstaCerrada()) return true;
  if (anoViaje >= 2027 && esFechaListaEsperaAutomatica()) return true;

  return false;
}

function puedeAbrirCerrarFasesInscripcion() {
  if (normalizeState(state.group?.estado) !== "ganada") return false;

  const rol = String(state.effectiveUser?.rol || "").toLowerCase();

  if (rol === "admin" || rol === "supervision") return true;
  if (rol === "vendedor" && canAccessGroup(state.group)) return true;

  return false;
}

function puedeReabrirFasePasada() {
  const rol = String(state.effectiveUser?.rol || "").toLowerCase();
  const email = normalizeEmail(state.effectiveEmail || "");

  return rol === "admin" || email === "chernandez@raitrai.cl";
}

function puedeOperarListaEsperaAdministrativa() {
  const rol = String(state.effectiveUser?.rol || "").toLowerCase();
  const email = normalizeEmail(state.effectiveEmail || "");

  return (
    rol === "admin" ||
    rol === "registro" ||
    email === "administracion@raitrai.cl" ||
    email === "yenny@raitrai.cl" ||
    email === "raitrai@raitrai.cl"
  );
}

function puedeExportarCsvInscripciones() {
  return puedeOperarListaEsperaAdministrativa();
}

function getOrigenNominaGrupo() {
  const origenGuardado = normalizeSearchLocal(
    state.group?.origenNomina ||
    state.group?.nominaOrigen ||
    state.group?.inscripcion?.origenNomina ||
    ""
  );

  if (origenGuardado === "sistema_pagos") return "sistema_pagos";
  if (origenGuardado === "inscripcion_inicial") return "inscripcion_inicial";

  if (getInscripcionesSistemaPagos().length > 0) return "sistema_pagos";

  return "inscripcion_inicial";
}

function grupoVieneSistemaAntiguo() {
  return getOrigenNominaGrupo() === "sistema_pagos";
}

function getOrigenNominaLabel() {
  return getOrigenNominaGrupo() === "sistema_pagos"
    ? "Sistema de Pagos"
    : "Inscripción inicial";
}

function getFasesCerradasInscripcion() {
  return state.group?.inscripcion?.fasesCerradas || {};
}

function faseInscripcionYaCerrada(clave = "") {
  return !!getFasesCerradasInscripcion()[clave];
}

function inscripcionInicialYaCerrada() {
  return faseInscripcionYaCerrada("inscripcion_inicial");
}

function nominaFinalYaCerrada() {
  return faseInscripcionYaCerrada("nomina_final");
}

function correspondeListaEsperaPorFecha() {
  const anoViaje = getAnoViajeInscripcion();

  if (anoViaje === 2026) return true;
  if (!anoViaje || anoViaje < 2027) return false;

  return esFechaListaEsperaAutomatica();
}

function correspondeNuevosIngresosPorFecha() {
  const anoViaje = getAnoViajeInscripcion();

  if (!anoViaje || anoViaje < 2027) return false;
  if (anoViaje === 2026) return false;

  return !esFechaListaEsperaAutomatica();
}

function puedeMarcarListaEsperaPagada() {
  return normalizeState(state.group?.estado) === "ganada" &&
    puedeOperarListaEsperaAdministrativa();
}

function canGestionarInscripcionInicial() {
  if (!puedeAbrirCerrarFasesInscripcion()) return false;
  if (!inscripcionPrincipalEstaCerrada()) return false;

  // Si tiene firma vendedor, viene del sistema antiguo:
  // no debe abrir inscripción inicial, sino nómina final.
  if (grupoVieneSistemaAntiguo()) return false;

  // Si ya se cerró la inscripción inicial, no vuelve a aparecer,
  // salvo Admin o Jefa de ventas.
  if (inscripcionInicialYaCerrada() && !puedeReabrirFasePasada()) return false;

  return true;
}

function canGestionarNominaFinal() {
  if (!puedeAbrirCerrarFasesInscripcion()) return false;
  if (!inscripcionPrincipalEstaCerrada()) return false;

  // Solo grupos con firma vendedor vienen del sistema antiguo.
  if (!grupoVieneSistemaAntiguo()) return false;

  // Si ya se cerró la nómina final, no vuelve a aparecer,
  // salvo Admin o Jefa de ventas.
  if (nominaFinalYaCerrada() && !puedeReabrirFasePasada()) return false;

  return true;
}

function canGestionarNuevosIngresos() {
  if (!puedeAbrirCerrarFasesInscripcion()) return false;
  if (!inscripcionPrincipalEstaCerrada()) return false;

  if (!correspondeNuevosIngresosPorFecha()) return false;

  // Si NO viene del sistema antiguo, primero debe haber cerrado inscripción inicial.
  if (!grupoVieneSistemaAntiguo() && !inscripcionInicialYaCerrada()) return false;

  return true;
}

function canGestionarListaEspera() {
  if (!puedeAbrirCerrarFasesInscripcion()) return false;
  if (!inscripcionPrincipalEstaCerrada()) return false;

  if (!correspondeListaEsperaPorFecha()) return false;

  // Si NO viene del sistema antiguo, primero debe haber cerrado inscripción inicial.
  if (!grupoVieneSistemaAntiguo() && !inscripcionInicialYaCerrada()) return false;

  return true;
}

function canGestionarLiberados() {
  if (normalizeState(state.group?.estado) !== "ganada") return false;

  // Sistema antiguo: puede habilitar liberados cuando estime.
  if (grupoVieneSistemaAntiguo()) {
    return puedeAbrirCerrarFasesInscripcion();
  }

  // Sistema nuevo: primero debe existir o haberse cerrado la inscripción inicial.
  const yaExisteFlujo =
    !!state.group?.inscripcionHabilitada ||
    !!state.group?.tokenInscripcion ||
    !!state.group?.inscripcion?.tokenActual ||
    inscripcionInicialYaCerrada();

  if (!yaExisteFlujo) return false;

  return puedeAbrirCerrarFasesInscripcion();
}

function canConfirmarListaEspera() {
  return normalizeState(state.group?.estado) === "ganada" &&
    puedeOperarListaEsperaAdministrativa();
}

function getBlockedInscripcionMessage() {
  return "No tienes permisos para realizar esta acción de inscripción.";
}

function canManageMeetings() {
  if (!state.canModify) return false;

  // Reuniones se pueden seguir creando/editando aunque el vendedor ya haya firmado.
  // La firma bloquea datos y situación, pero no agenda.
  return canAccessGroup(state.group);
}

function canCreateAlertsAndComments() {
  // Debe poder:
  // - quien ya puede editar normalmente
  // - y además el rol "registro", pero solo para alertas/comentarios
  const rol = String(state.effectiveUser?.rol || "").toLowerCase();

  if (canEditGroup()) return true;

  if (rol === "registro" && canAccessGroup(state.group)) {
    return true;
  }

  return false;
}

function canEditDocuments() {
  const rol = String(state.effectiveUser?.rol || "").toLowerCase();
  return rol === "admin" || rol === "supervision";
}

function canEditSchoolName() {
  const rol = String(state.effectiveUser?.rol || "").toLowerCase();

  // Regla real de negocio:
  // solo vendedor no puede cambiar el colegio.
  if (rol === "vendedor") return false;

  // Si puede modificar el grupo, puede cambiar el colegio.
  return canEditGroup();
}

function canManageHistoryItems() {
  return canAccessGroup(state.group);
}

function isEffectiveVendorRole() {
  return String(state.effectiveUser?.rol || "").toLowerCase() === "vendedor";
}

function isRealAdminRoleGrupo() {
  return String(state.effectiveUser?.rol || "").toLowerCase() === "admin";
}

function isJefaVentasStrict() {
  return normalizeEmail(state.effectiveEmail || "") === "chernandez@raitrai.cl";
}

function canBypassEstadoAutorizadoLock() {
  return isRealAdminRoleGrupo() || isJefaVentasStrict();
}

function hasFichaPdfVigente(groupData = state.group || {}) {
  const tienePdf = !!cleanText(
    getByPath(groupData, "ficha.pdfUrl") ||
    groupData?.fichaPdfUrl ||
    ""
  );

  return tienePdf && !groupData?.fichaFlujoAbierto;
}

function isGrupoAutorizadoVisual(groupData = state.group || {}) {
  const anoViajeNum = Number(groupData?.anoViaje || 0);
  const esLegacy2025 = anoViajeNum <= 2025;

  if (esLegacy2025) return !!groupData?.autorizada;

  return !!groupData?.autorizada || hasFichaPdfVigente(groupData);
}

function canEditSituacionGrupo() {
  // Misma regla que editar datos:
  // si el vendedor ya firmó, queda bloqueado para cambiar situación.
  // Ganada NO bloquea por sí sola.
  // No metemos aquí regla de autorizada.
  return canEditGroup();
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
  if (!state.groupDocId) return false;

  const targetDocId = String(state.groupDocId);
  const targetGroupId = String(state.groupId || "");
  const estadoAnterior = normalizeState(state.group?.estado);

  // Blindaje extra:
  // solo cambia el grupo actualmente abierto en pantalla.
  await saveGroupPatch(
    {
      estado: "contactado"
    },
    {
      tipoMovimiento: "cambio_estado",
      modulo: "grupo",
      titulo: "Cambio automático de estado",
      mensaje: `${getDisplayName(state.effectiveUser)} abrió el grupo ${targetGroupId} y el sistema cambió su estado de A contactar a Contactado.`,
      cambios: [
        {
          campo: "estado",
          anterior: estadoAnterior,
          nuevo: "contactado"
        }
      ],
      metadata: {
        targetDocId,
        targetGroupId,
        origen: "apertura_grupo"
      }
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
    email === "administracion@raitrai.cl" ||
    email === "raitrai@raitrai.cl"
  );
}

function isStrictAdministracionUser() {
  const email = normalizeEmail(state.effectiveEmail || "");

  return (
    email === "yenny@raitrai.cl" ||
    email === "administracion@raitrai.cl" ||
    email === "raitrai@raitrai.cl"
  );
}

function isAdministracionBlockedFromGroupEdit() {
  const flow = state.group?.flowFicha || {};

  return (
    isStrictAdministracionUser() &&
    normalizeState(state.group?.estado) === "ganada" &&
    !!flow?.vendedor?.firmado
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

  // Regla de negocio:
  // si el vendedor ya firmó, queda bloqueado aunque el grupo sea legacy.
  // La excepción legacy aplica al cierre / PDF real y al flujo posterior,
  // no a que el vendedor siga editando.
  return !!flow?.vendedor?.firmado;
}

function canCreateFichaFromEstado() {
  return normalizeState(state.group?.estado) === "ganada";
}

function getFichaSummary() {
  const ficha = getByPath(state.group, "ficha") || {};

  const numeroNegocio =
    ficha.numeroNegocio ??
    state.group.numeroNegocio ??
    "";
  
  const version =
    ficha.version ||
    state.group.versionFicha ||
    "";
  
  const fechaActualizacion =
    ficha.fechaActualizacion ||
    state.group.fechaActualizacionFicha ||
    "";
  
  const pdfUrl =
    cleanText(
      ficha.pdfUrl ||
      state.group.fichaPdfUrl ||
      ficha.urlPdf ||
      ""
    );
  
  const pdfNombre =
    cleanText(
      ficha.pdfNombre ||
      state.group.fichaPdfNombre ||
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

function shouldShowInscripcionPanel() {
  const isGanada = normalizeState(state.group?.estado) === "ganada";
  const habilitada = !!state.group?.inscripcionHabilitada;
  const tieneInscritos = Array.isArray(state.inscripciones) && state.inscripciones.length > 0;

  return isGanada || habilitada || tieneInscritos;
}

function getInscripcionEstadoActual() {
  const estado = cleanText(
    state.group?.inscripcionEstado ||
    state.group?.inscripcion?.estado ||
    state.group?.faseInscripcion ||
    ""
  );

  if (estado) return estado;

  if (state.group?.inscripcionHabilitada) return "normal";

  return "cerrada";
}

function grupoTieneFirmaVendedor(data = state.group || {}) {
  return !!(
    data?.firmaVendedor ||
    data?.firmaVendedora ||
    data?.firmaVendedorFecha ||
    data?.firmaVendedoraFecha ||
    data?.firmaVendedorNombre ||
    data?.firmaVendedoraNombre ||
    data?.firmas?.vendedor?.fecha ||
    data?.firmas?.vendedora?.fecha ||
    data?.flowFicha?.vendedor?.firmado
  );
}

function getContextoInscripcionGrupo(fase = "normal", groupData = state.group || {}) {
  const key = normalizeSearchLocal(fase);

  if (key === "nomina_final") {
    return {
      clave: "nomina_final",
      faseInscripcion: "nomina_final",
      tipoInscripcion: "nomina_final",
      labelFase: "Nómina final / ficha médica",
      labelTipo: "Nómina final / ficha médica",
      estadoCupo: "confirmado"
    };
  }

  if (key === "nuevos") {
    return {
      clave: "nuevo_ingreso",
      faseInscripcion: "nuevos",
      tipoInscripcion: "nuevo_ingreso",
      labelFase: "Nuevo ingreso",
      labelTipo: "Nuevo ingreso",
      estadoCupo: "pendiente_confirmacion"
    };
  }

  if (key === "lista_espera") {
    return {
      clave: "lista_espera",
      faseInscripcion: "lista_espera",
      tipoInscripcion: "lista_espera",
      labelFase: "Lista de espera",
      labelTipo: "Lista de espera",
      estadoCupo: "pendiente_pago"
    };
  }

  if (key === "liberado") {
    return {
      clave: "liberado",
      faseInscripcion: "liberado",
      tipoInscripcion: "liberado",
      labelFase: "Cupo liberado",
      labelTipo: "Cupo liberado",
      estadoCupo: "confirmado"
    };
  }

  if (key === "cerrada") {
    return {
      clave: "cerrada",
      faseInscripcion: "cerrada",
      tipoInscripcion: "",
      labelFase: "Cerrada",
      labelTipo: "Cerrada",
      estadoCupo: ""
    };
  }

  return {
    clave: "inscripcion_inicial",
    faseInscripcion: "normal",
    tipoInscripcion: "nomina_inicial",
    labelFase: "Inscripción inicial",
    labelTipo: "Inscripción inicial",
    estadoCupo: "confirmado"
  };
}

function getTipoInscripcionFromFase(fase = "") {
  return getContextoInscripcionGrupo(fase).tipoInscripcion || "nomina_inicial";
}

function getEstadoCupoFromFase(fase = "") {
  return getContextoInscripcionGrupo(fase).estadoCupo || "confirmado";
}

function getInscripcionFaseLabel(fase = "") {
  return getContextoInscripcionGrupo(fase).labelFase || formatInscripcionValue(fase);
}

function getEstadoOperativoInscripcionLabel(item = {}) {
  const tipo = normalizeSearchLocal(getInscripcionTipoReal(item));
  const estadoCupo = normalizeSearchLocal(item.estadoCupo || "");

  if (tipo === "nuevo_ingreso" && estadoCupo !== "confirmado") {
    return "Nuevo ingreso pendiente";
  }

  if (
    (tipo === "nuevo_ingreso" || tipo === "nuevo_ingreso_confirmado") &&
    estadoCupo === "confirmado"
  ) {
    return "Nuevo ingreso confirmado";
  }

  if (tipo === "lista_espera" && estadoCupo === "pendiente_pago") {
    return "Lista de espera pendiente";
  }

  if (
    (tipo === "lista_espera" || tipo === "lista_espera_pagada") &&
    estadoCupo === "pagado"
  ) {
    return "Lista de espera pagada";
  }

  if (
    tipo === "lista_espera_confirmada" ||
    (tipo === "lista_espera" && estadoCupo === "confirmado")
  ) {
    return "Lista de espera confirmada";
  }

  if (tipo === "sistema_pagos") {
    return fichaMedicaPendiente(item)
      ? "Sistema de Pagos · Ficha pendiente"
      : "Sistema de Pagos · Ficha completa";
  }
  
  return getTipoInscripcionLabel(tipo);
}

function getOrdenOperativoInscripcion(item = {}) {
  const tipo = normalizeSearchLocal(getInscripcionTipoReal(item));
  const estadoCupo = normalizeSearchLocal(item.estadoCupo || "");

  // 1. Lista de espera, con sus variantes
  if (
    tipo === "lista_espera_confirmada" ||
    (tipo === "lista_espera" && estadoCupo === "confirmado")
  ) return 1;

  if (
    tipo === "lista_espera_pagada" ||
    (tipo === "lista_espera" && estadoCupo === "pagado")
  ) return 2;

  if (tipo === "lista_espera") return 3;

  // 2. Nuevos ingresos, con sus variantes
  if (
    tipo === "nuevo_ingreso_confirmado" ||
    (tipo === "nuevo_ingreso" && estadoCupo === "confirmado")
  ) return 4;

  if (tipo === "nuevo_ingreso") return 5;

  // 3. Inscripción inicial / nómina final
  if (tipo === "nomina_inicial" || tipo === "nomina_final" || tipo === "sistema_pagos") return 6;

  // 4. Otros
  if (tipo === "liberado") return 7;

  return 99;
}

function getFechaFormularioInscripcion(item = {}) {
  return (
    item?.meta?.fechaInscripcion ||
    item?.meta?.fechaFormularioCliente ||
    item?.fechaInscripcion ||
    item?.fechaFormularioCliente ||
    item?.creadoEn ||
    item?.createdAt ||
    item?.fechaCreacion ||
    item?.fechaAprobacion ||
    ""
  );
}

function formatFechaFormularioTabla(value) {
  const d = toDate(value);
  if (!d) return "—";

  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(-2);
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");

  return `${dd}-${mm}-${yy} ${hh}:${min}`;
}

function getTipoInscripcionLabel(value = "") {
  const key = normalizeSearchLocal(value);
  
  if (key === "sistema_pagos") return "Sistema de Pagos";
  if (key === "nomina_inicial") return "Inscripción inicial";
  if (key === "nomina_final") return "Nómina final / ficha médica";

  if (key === "nuevo_ingreso") return "Nuevo ingreso";
  if (key === "lista_espera") return "Lista de espera";
  if (key === "lista_espera_confirmada") return "Lista de espera confirmada";
  if (key === "liberado") return "Cupo liberado";

  return "Inscripción inicial";
}

function getTipoInscripcionClass(item = {}) {
  const tipo = normalizeSearchLocal(item.tipoInscripcion || item.estadoInscripcion || item.faseInscripcion || "nomina_inicial");
  const estadoCupo = normalizeSearchLocal(item.estadoCupo || "");

  if (tipo === "nomina_final") return "insc-nomina-final";
  if (tipo === "liberado") return "insc-liberado";
  if (tipo === "lista_espera" && estadoCupo === "confirmado") return "insc-lista-espera-confirmada";
  if (tipo === "lista_espera_confirmada") return "insc-lista-espera-confirmada";
  if (tipo === "lista_espera") return "insc-lista-espera";
  if (tipo === "nuevo_ingreso" || tipo === "nuevos") return "insc-nuevo-ingreso";

  return "insc-nomina-inicial";
}

function getInscripcionTipoReal(item = {}) {
  const raw = item.tipoInscripcion || "";
  const key = normalizeSearchLocal(raw).replace(/\s+/g, "_");

  if (key === "inscripcion_inicial") return "nomina_inicial";
  if (key === "nomina_inicial") return "nomina_inicial";
  if (key === "nomina_final") return "nomina_final";
  if (key === "nomina_final_ficha_medica") return "nomina_final";
  if (key === "sistema_de_pagos") return "sistema_pagos";
  if (key === "sistema_pagos") return "sistema_pagos";
  if (key === "nuevo_ingreso") return "nuevo_ingreso";
  if (key === "nuevo_ingreso_confirmado") return "nuevo_ingreso_confirmado";
  if (key === "lista_espera") return "lista_espera";
  if (key === "lista_espera_pagada") return "lista_espera_pagada";
  if (key === "lista_espera_confirmada") return "lista_espera_confirmada";
  if (key === "liberado" || key === "cupo_liberado") return "liberado";

  return getTipoInscripcionFromFase(item.faseInscripcion || item.estadoInscripcion || "normal");
}

function esNominaFinalOperativa(item = {}) {
  const tipo = normalizeSearchLocal(getInscripcionTipoReal(item));
  const estadoCupo = normalizeSearchLocal(item.estadoCupo || "");

  if (tipo === "nuevo_ingreso") {
    return estadoCupo === "confirmado";
  }

  if (tipo === "lista_espera") {
    return estadoCupo === "confirmado";
  }

  if (tipo === "lista_espera_pagada") {
    return false;
  }

  return (
    tipo === "nomina_inicial" ||
    tipo === "nomina_final" ||
    tipo === "sistema_pagos" ||
    tipo === "nuevo_ingreso_confirmado" ||
    tipo === "lista_espera_confirmada" ||
    tipo === "liberado"
  );
}

function getInscripcionesSistemaPagos() {
  return state.inscripciones.filter((item) =>
    normalizeSearchLocal(getInscripcionTipoReal(item)) === "sistema_pagos"
  );
}

function fichaMedicaPendiente(item = {}) {
  return !(
    item.fichaMedicaCompleta === true ||
    item.nominaFinalCompleta === true ||
    item.fichaMedicaEstado === "completa" ||
    item.fichaMedicaEstado === "completada"
  );
}

function getInscripcionesConFichaMedicaPendiente() {
  return state.inscripciones.filter((item) =>
    esNominaFinalOperativa(item) && fichaMedicaPendiente(item)
  );
}

function getInscripcionesConFichaMedicaCompleta() {
  return state.inscripciones.filter((item) =>
    esNominaFinalOperativa(item) && !fichaMedicaPendiente(item)
  );
}

function getEstadoListaPasajerosLabel() {
  if (!state.inscripciones.length && !state.group?.inscripcionHabilitada) {
    return "Sin inscripciones";
  }

  const estado = normalizeSearchLocal(getInscripcionEstadoActual());
  const abierta = !!state.group?.inscripcionHabilitada;

  if (estado === "normal") {
    return abierta ? "Inscripción inicial abierta" : "Inscripción inicial cerrada";
  }

  if (estado === "nomina_final") {
    return abierta ? "Nómina final / ficha médica abierta" : "Nómina final / ficha médica cerrada";
  }

  if (estado === "nuevos") {
    return abierta ? "Nuevos ingresos abierta" : "Nuevos ingresos cerrada";
  }

  if (estado === "lista_espera") {
    return abierta ? "Lista de espera abierta" : "Lista de espera cerrada";
  }

  return "Inscripción cerrada";
}

function getLiberadosPermitidos() {
  return Number(
    state.group?.liberados ||
    state.group?.cantidadLiberados ||
    state.group?.ficha?.liberados ||
    state.group?.ficha?.cantidadLiberados ||
    0
  );
}

function getLiberadosUsados() {
  return state.inscripciones.filter((item) =>
    normalizeSearchLocal(getInscripcionTipoReal(item)) === "liberado"
  ).length;
}

function renderInscripcionPasajerosPanel() {
  const panel = $("panelInscripcionPasajeros");
  const box = $("panelInscripcionPasajerosBody");
  if (!panel || !box) return;

  const visible = shouldShowInscripcionPanel();
  panel.classList.toggle("hidden", !visible);

  if (!visible) return;

  const totalBruto = state.inscripciones.length;
  const capacidad = Number(state.group?.cantidadGrupo || 0);
  
  const nominaFinalOperativa = state.inscripciones.filter(esNominaFinalOperativa).length;
  const nominaInicial = getInscripcionesNominaInicial().length;
  
  const fichaPendiente = getInscripcionesConFichaMedicaPendiente().length;
  const fichaCompleta = getInscripcionesConFichaMedicaCompleta().length;
  
  const nuevosConfirmados = state.inscripciones.filter((x) => {
    const tipo = normalizeSearchLocal(getInscripcionTipoReal(x));
    const estadoCupo = normalizeSearchLocal(x.estadoCupo || "");
    return tipo === "nuevo_ingreso_confirmado" || (tipo === "nuevo_ingreso" && estadoCupo === "confirmado");
  }).length;
  
  const nuevosPendientes = state.inscripciones.filter((x) => {
    const tipo = normalizeSearchLocal(getInscripcionTipoReal(x));
    const estadoCupo = normalizeSearchLocal(x.estadoCupo || "");
    return tipo === "nuevo_ingreso" && estadoCupo !== "confirmado";
  }).length;
  
  const esperaPendiente = state.inscripciones.filter((x) => {
    const tipo = normalizeSearchLocal(getInscripcionTipoReal(x));
    const estadoCupo = normalizeSearchLocal(x.estadoCupo || "");
    return tipo === "lista_espera" && estadoCupo !== "pagado" && estadoCupo !== "confirmado";
  }).length;
  
  const esperaPagada = state.inscripciones.filter((x) => {
    const tipo = normalizeSearchLocal(getInscripcionTipoReal(x));
    const estadoCupo = normalizeSearchLocal(x.estadoCupo || "");
    return tipo === "lista_espera_pagada" || (tipo === "lista_espera" && estadoCupo === "pagado");
  }).length;
  
  const esperaConfirmada = state.inscripciones.filter((x) => {
    const tipo = normalizeSearchLocal(getInscripcionTipoReal(x));
    const estadoCupo = normalizeSearchLocal(x.estadoCupo || "");
    return tipo === "lista_espera_confirmada" || (tipo === "lista_espera" && estadoCupo === "confirmado");
  }).length;

  const liberadosPermitidos = getLiberadosPermitidos();
  const liberadosUsados = getLiberadosUsados();

  const estadoInscripcion = getInscripcionEstadoActual();
  const linkInfo = state.group?.inscripcion || {};
  const liberadosInfo = state.group?.inscripcionLiberados || {};

  const tabla = state.inscripciones.length
    ? `
      <div class="inscripcion-table-wrap">
        <table class="inscripcion-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Tipo inscripción</th>
              <th>Fecha formulario</th>
              <th>RUT / Documento</th>
              <th>Apellidos</th>
              <th>Nombres</th>
              <th>Fecha nacimiento</th>
              <th>Tipo pasajero</th>
              <th>Nacionalidad</th>
              <th>Sexo / género</th>
              <th>Responsable</th>
              <th>Correo responsable</th>
              <th>Celular responsable</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            ${state.inscripciones.map((item, index) => {
              const tipoReal = getInscripcionTipoReal(item);
              const esListaEsperaPendiente =
                normalizeSearchLocal(tipoReal) === "lista_espera" &&
                normalizeSearchLocal(item.estadoCupo || "") !== "confirmado";

              return `
                <tr class="${escapeHtml(getTipoInscripcionClass(item))}">
                  <td>${index + 1}</td>
                  <td>${escapeHtml(getEstadoOperativoInscripcionLabel(item))}</td>
                  <td>${escapeHtml(formatFechaFormularioTabla(getFechaFormularioInscripcion(item)))}</td>
                  <td>${escapeHtml(getInscripcionDocumento(item))}</td>
                  <td>${escapeHtml(getInscripcionApellidos(item))}</td>
                  <td>${escapeHtml(getInscripcionNombres(item))}</td>
                  <td>${escapeHtml(formatDateOnlyForTable(getByPath(item, "identificacion.fechaNacimiento")))}</td>
                  <td>${escapeHtml(formatInscripcionValue(item.tipoViajante || item.tipoParticipacion || ""))}</td>
                  <td>${escapeHtml(getInscripcionNacionalidad(item))}</td>
                  <td>${escapeHtml(getInscripcionGenero(item))}</td>
                  <td>${escapeHtml(getResponsablePrincipalNombre(item))}</td>
                  <td>${escapeHtml(getByPath(item, "contactoPrincipal.correo") || "—")}</td>
                  <td>${escapeHtml(getByPath(item, "contactoPrincipal.celular") || getByPath(item, "contactoPrincipal.telefono") || getByPath(item, "contactoPrincipal.whatsapp") || "—")}</td>
                  <td>
                    ${
                      normalizeSearchLocal(tipoReal) === "nuevo_ingreso" &&
                      normalizeSearchLocal(item.estadoCupo || "") !== "confirmado"
                        ? `<button class="inscripcion-action-btn" type="button" data-confirmar-nuevo-ingreso="${escapeHtml(item.id)}">Confirmar nuevo ingreso</button>`
                        : esListaEsperaPendiente && normalizeSearchLocal(item.estadoCupo || "") !== "pagado"
                          ? `<button class="inscripcion-action-btn" type="button" data-marcar-lista-pagada="${escapeHtml(item.id)}">Marcar pagado</button>`
                          : esListaEsperaPendiente && normalizeSearchLocal(item.estadoCupo || "") === "pagado"
                            ? `<button class="inscripcion-action-btn" type="button" data-confirmar-cupo="${escapeHtml(item.id)}">Confirmar cupo</button>`
                            : "—"
                    }
                  </td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      </div>
    `
    : `<div class="empty-box">Todavía no hay personas inscritas para este grupo.</div>`;

  box.innerHTML = `
    <div class="grupo-kpi-list">
      <div class="grupo-kpi">
        <div class="info-label">Origen nómina</div>
        <div class="info-value">${escapeHtml(getOrigenNominaLabel())}</div>
      </div>

      <div class="grupo-kpi">
        <div class="info-label">Estado inscripción</div>
        <div class="info-value">${escapeHtml(getEstadoListaPasajerosLabel())}</div>
      </div>

      <div class="grupo-kpi">
        <div class="info-label">Total inscritos</div>
        <div class="info-value">${escapeHtml(`${nominaFinalOperativa} viajan / ${totalBruto} inscritos`)}</div>
      </div>

      <div class="grupo-kpi">
        <div class="info-label">Ficha médica</div>
        <div class="info-value">${escapeHtml(`${fichaCompleta} completas / ${fichaPendiente} pendientes`)}</div>
      </div>

      <div class="grupo-kpi">
        <div class="info-label">Nómina inicial</div>
        <div class="info-value">${escapeHtml(`${nominaInicial}${capacidad ? ` / ${capacidad}` : ""} pasajeros`)}</div>
      </div>

      <div class="grupo-kpi">
        <div class="info-label">Nuevos ingresos</div>
        <div class="info-value">${escapeHtml(`${nuevosConfirmados} confirmados / ${nuevosPendientes} pendientes`)}</div>
      </div>

      <div class="grupo-kpi">
        <div class="info-label">Lista espera</div>
        <div class="info-value">${escapeHtml(`${esperaConfirmada} confirmados / ${esperaPagada} pagados / ${esperaPendiente} pendientes`)}</div>
      </div>

      <div class="grupo-kpi">
        <div class="info-label">Liberados</div>
        <div class="info-value">${escapeHtml(`${liberadosUsados} confirmados${liberadosPermitidos ? ` de ${liberadosPermitidos} cupos liberados` : ""}`)}</div>
      </div>
    </div>

    ${tabla}

    <div class="inscripcion-traza">
      <div><strong>Link principal:</strong> ${state.group?.inscripcionHabilitada ? "Habilitado" : "No habilitado"}</div>
      <div><strong>Estado inscripción:</strong> ${escapeHtml(getInscripcionFaseLabel(estadoInscripcion))}</div>
      <div><strong>Generado por:</strong> ${escapeHtml(linkInfo.actualizadoPor || linkInfo.linkGeneradoPor || state.group?.inscripcionLinkGeneradoPor || "—")}</div>
      <div><strong>Fecha generación:</strong> ${escapeHtml(formatDateTime(linkInfo.actualizadoAt || linkInfo.linkGeneradoAt || state.group?.fechaAperturaInscripcion))}</div>
      <div><strong>Link liberados:</strong> ${state.group?.linkLiberadosActivo ? "Habilitado" : "No habilitado"}</div>
      <div><strong>Liberados generado por:</strong> ${escapeHtml(liberadosInfo.actualizadoPor || liberadosInfo.linkGeneradoPor || "—")}</div>
    </div>
  `;
}

function getInscripcionDocumento(item = {}) {
  return (
    getByPath(item, "identificacion.documento") ||
    getByPath(item, "identificacion.rutCompleto") ||
    getByPath(item, "identificacion.documentoNormalizado") ||
    item.id ||
    "—"
  );
}

function getInscripcionNombres(item = {}) {
  return (
    getByPath(item, "identificacion.nombres") ||
    getByPath(item, "identificacion.nombre") ||
    "—"
  );
}

function getInscripcionApellidos(item = {}) {
  const p1 = getByPath(item, "identificacion.primerApellido") || "";
  const p2 = getByPath(item, "identificacion.segundoApellido") || "";
  const unidos = [p1, p2].filter(Boolean).join(" ");
  return unidos || "—";
}

function getInscripcionNacionalidad(item = {}) {
  const base =
    getByPath(item, "identificacion.nacionalidadBase") ||
    getByPath(item, "identificacion.nacionalidad") ||
    "";

  const detalle =
    getByPath(item, "identificacion.nacionalidadDetalle") ||
    getByPath(item, "identificacion.nacionalidadOtra") ||
    getByPath(item, "identificacion.otraNacionalidad") ||
    "";

  const baseKey = normalizeSearchLocal(base);

  if ((baseKey === "doble" || baseKey === "extranjera" || baseKey === "otra") && detalle) {
    return detalle;
  }

  return base || detalle || "—";
}

function getInscripcionGenero(item = {}) {
  const genero = getByPath(item, "identificacion.genero") || "";
  const generoOtro = getByPath(item, "identificacion.generoOtro") || "";
  const sexoDocumento = getByPath(item, "documentoIdentidad.sexoDocumento") || "";

  if (sexoDocumento) return formatInscripcionValue(sexoDocumento);
  if (normalizeSearchLocal(genero) === "otro" && generoOtro) return generoOtro;

  return genero ? formatInscripcionValue(genero) : "—";
}

function getResponsablePrincipalNombre(item = {}) {
  const nombreDirecto =
    getByPath(item, "contactoPrincipal.nombre") ||
    getByPath(item, "Contacto principal.nombre") ||
    getByPath(item, "contactoPrincipal.nombreCompleto");

  if (nombreDirecto) return nombreDirecto;

  const nombres = getByPath(item, "contactoPrincipal.nombres") || "";
  const p1 = getByPath(item, "contactoPrincipal.primerApellido") || "";
  const p2 = getByPath(item, "contactoPrincipal.segundoApellido") || "";

  return [nombres, p1, p2].filter(Boolean).join(" ") || "—";
}

function formatDateOnlyForTable(value) {
  if (!value) return "—";

  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [yyyy, mm, dd] = value.split("-");
    return `${dd}-${mm}-${yyyy}`;
  }

  const d = toDate(value);
  if (!d) return String(value);

  return d.toLocaleDateString("es-CL");
}

function formatInscripcionValue(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "—";

  const map = {
    estudiante: "Estudiante",
    profesor: "Profesor(a)",
    profesora: "Profesor(a)",
    adulto_acompanante: "Adulto(a) acompañante",
    adulto: "Adulto(a) acompañante",
    normal: "Normal",
    nuevos: "Nuevos inscritos",
    nuevo_inscrito: "Nuevo inscrito",
    lista_espera: "Lista de espera",
    cerrada: "Cerrada",
    masculino: "Masculino",
    femenino: "Femenino"
  };

  const key = normalizeSearchLocal(raw).replace(/\s+/g, "_");
  return map[key] || raw.replaceAll("_", " ");
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

      <div class="info-item">
        <div class="info-label">Inscripción pasajeros</div>
        <div class="info-value">
          ${state.group?.inscripcionHabilitada ? "Habilitada" : "No habilitada"}
        </div>
      </div>
    </div>

    <div class="grupo-ficha-note">
      <strong>Tip visual:</strong> aquí quedan arriba los datos que más necesitas para ubicarte rápido, sin tener que leer toda la ficha ni todo el grupo.
    </div>
  `;
}

function getCurrentYear() {
  return new Date().getFullYear();
}

function normalizeCursoInput(value = "") {
  return cleanText(value)
    .toUpperCase()
    .replace(/\s+/g, "");
}

function hasValidCursoFormat(value = "") {
  const curso = normalizeCursoInput(value);
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
  if (currentNumber >= 1 && currentNumber <= 7) return currentNumber + 1;
  if (currentNumber === 8) return 1;
  if (currentNumber === 9) return 10;
  if (currentNumber === 10) return 11;
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
  const school = normalizeTextUpper(colegio);

  if (!base || !trip || !anoBase || !anoViaje || !school) return "";

  const baseYear = String(anoBase).trim();
  const tripYear = String(anoViaje).trim();

  if (baseYear === tripYear) {
    return `${base} (${baseYear}) ${school}`.trim();
  }

  return `${base} (${baseYear}) ${trip} (${tripYear}) ${school}`.trim();
}

function buildAliasTripKey({ colegio = "", cursoViaje = "", anoViaje = "" }) {
  return normalizeSearchLocal(
    `${normalizeTextUpper(colegio)}__${normalizeCursoInput(cursoViaje)}__${cleanText(anoViaje)}`
  );
}

function getDocBaseYear(data = {}) {
  const explicit = Number(data.anoBaseCurso || "");
  if (Number.isFinite(explicit) && explicit > 0) return explicit;

  const createdAt = toDate(data.fechaCreacion);
  if (createdAt) return createdAt.getFullYear();

  return getCurrentYear();
}

function normalizeTextUpper(value = "") {
  return String(value || "").trim().toLocaleUpperCase("es-CL");
}

function normalizeTextUpperLive(value = "") {
  return String(value || "").toLocaleUpperCase("es-CL");
}

function normalizeChileMobile(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";

  let digits = raw.replace(/\D/g, "");

  if (digits.startsWith("56")) digits = digits.slice(2);
  if (digits.startsWith("9")) digits = digits.slice(1);

  digits = digits.slice(0, 8);

  return digits ? `+569${digits}` : "+569";
}

function sanitizeChileMobileForSave(value = "") {
  const normalized = normalizeChileMobile(value);
  return normalized === "+569" ? "" : normalized;
}

function formatChileMobileForInput(value = "") {
  return value ? normalizeChileMobile(value) : "+569";
}

function getChileMobileDigits(value = "") {
  const normalized = normalizeChileMobile(value);
  return String(normalized || "").replace(/\D/g, "");
}

function formatChileMobileDisplay(value = "") {
  const digits = getChileMobileDigits(value);

  // Esperado: 569 + 8 dígitos
  if (digits.length >= 11) {
    const countryAndPrefix = digits.slice(0, 3); // 569
    const part1 = digits.slice(3, 7);            // 4 dígitos
    const part2 = digits.slice(7, 11);           // 4 dígitos
    return `(+${countryAndPrefix}) ${part1} ${part2}`;
  }

  // Fallback por si viene incompleto
  const normalized = normalizeChileMobile(value);
  return normalized || "—";
}

function buildPhoneValueHtml(value = "") {
  const digits = getChileMobileDigits(value);
  if (!digits || digits.length < 11) return "—";

  const display = formatChileMobileDisplay(value);
  const telHref = `tel:+${digits}`;
  const waHref = `https://wa.me/${digits}`;

  return `
    <div class="contact-value-stack">
      <div class="contact-main-value">${escapeHtml(display)}</div>
      <div class="contact-actions">
        <a class="contact-action-link" href="${escapeHtml(telHref)}">Llamar</a>
        <a class="contact-action-link" href="${escapeHtml(waHref)}" target="_blank" rel="noopener">WhatsApp</a>
      </div>
    </div>
  `;
}

function buildEmailValueHtml(value = "", contactLabel = "") {
  const email = normalizeEmail(value || "");
  if (!email) return "—";

  return `
    <div class="contact-value-stack">
      <div class="contact-main-value">${escapeHtml(email)}</div>
      <div class="contact-actions">
        <button
          class="contact-action-link"
          type="button"
          data-action="open-email-modal"
          data-email="${escapeHtml(email)}"
          data-contact-label="${escapeHtml(contactLabel || "")}"
        >
          Enviar correo
        </button>
      </div>
    </div>
  `;
}



function buildSemanaViajeLabel(start = "", end = "") {
  const startTxt = formatInputDate(start);
  const endTxt = formatInputDate(end);

  if (startTxt && endTxt) return `${startTxt} al ${endTxt}`;
  return startTxt || endTxt || "";
}

function getSemanaViajeDisplay(groupData = {}) {
  return cleanText(
    groupData.semanaViaje ||
    buildSemanaViajeLabel(groupData.fechaInicioViaje, groupData.fechaFinViaje)
  );
}

function fillSelectWithOptions(selectId, options = [], placeholder = "SELECCIONAR") {
  const select = $(selectId);
  if (!select) return;

  select.innerHTML = "";

  const first = document.createElement("option");
  first.value = "";
  first.textContent = placeholder;
  select.appendChild(first);

  options.forEach((value) => {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = value;
    select.appendChild(opt);
  });
}

function ensureSelectHasValue(selectId, value = "") {
  const select = $(selectId);
  const finalValue = cleanText(value);
  if (!select || !finalValue) return;

  const exists = [...select.options].some(
    (opt) => normalizeOptionKey(opt.value) === normalizeOptionKey(finalValue)
  );

  if (exists) return;

  const opt = document.createElement("option");
  opt.value = finalValue;
  opt.textContent = finalValue;
  select.appendChild(opt);
}

function normalizeOptionKey(value = "") {
  return normalizeSearchLocal(value).replace(/[^a-z0-9]/g, "");
}

function findCanonicalOption(options = [], value = "") {
  const target = normalizeOptionKey(value);
  if (!target) return "";

  return options.find((opt) => normalizeOptionKey(opt) === target) || "";
}

function normalizeDestinoCanonical(value = "") {
  const raw = cleanText(value);
  const direct = findCanonicalOption(DESTINO_PRINCIPAL_OPTIONS, raw);
  if (direct) return direct;

  const key = normalizeOptionKey(raw);
  if (key === normalizeOptionKey("BARILOCHE Y SUR DE CHILE")) {
    return "SUR DE CHILE Y BARILOCHE";
  }

  return "";
}

function getProgramOptionsByDestino(destinoRaw = "") {
  const key = normalizeOptionKey(destinoRaw);
  return PROGRAM_OPTIONS_BY_DESTINO[key] ? [...PROGRAM_OPTIONS_BY_DESTINO[key]] : [];
}

function getDestinoPrincipalDisplay(groupData = {}) {
  const principal = cleanText(groupData.destinoPrincipal || "");
  const otro = cleanText(groupData.destinoPrincipalOtro || "");
  const canonical = normalizeDestinoCanonical(principal);

  if (canonical === "OTRO" && otro) {
    return `OTRO · ${otro}`;
  }

  return canonical || principal || otro || "";
}

function getProgramaDisplay(groupData = {}) {
  const programa = cleanText(groupData.programa || "");
  const programaOtro = cleanText(groupData.programaOtro || "");

  if (normalizeOptionKey(programa) === normalizeOptionKey("OTRO") && programaOtro) {
    return `OTRO · ${programaOtro}`;
  }

  if (!programa && programaOtro) {
    return `OTRO · ${programaOtro}`;
  }

  return programa || programaOtro || "";
}

function getTramoDisplay(groupData = {}) {
  const tramo = cleanText(groupData.tramo || "");
  const tramoOtro = cleanText(groupData.tramoOtro || "");

  if (normalizeOptionKey(tramo) === normalizeOptionKey("OTRO") && tramoOtro) {
    return `OTRO · ${tramoOtro}`;
  }

  if (!tramo && tramoOtro) {
    return `OTRO · ${tramoOtro}`;
  }

  return tramo || tramoOtro || "";
}

function getMesViajeDisplay(groupData = {}) {
  const mesViaje = cleanText(groupData.mesViaje || "");
  const mesViajeOtro = cleanText(groupData.mesViajeOtro || "");
  const legacy = cleanText(groupData.semanaViaje || "");

  if (normalizeOptionKey(mesViaje) === normalizeOptionKey("OTRO") && mesViajeOtro) {
    return `OTRO · ${mesViajeOtro}`;
  }

  if (!mesViaje && mesViajeOtro) {
    return `OTRO · ${mesViajeOtro}`;
  }

  return mesViaje || legacy || mesViajeOtro || "";
}

function hydrateDatosSelects(groupData = {}) {
  fillSelectWithOptions("d_tramo", TRAMO_OPTIONS, "SELECCIONAR");
  fillSelectWithOptions("d_mesViaje", MES_VIAJE_OPTIONS, "SELECCIONAR");
  fillSelectWithOptions("d_rolCliente", ROL_CONTACTO_OPTIONS, "SELECCIONAR");
  fillSelectWithOptions("d_rolCliente2", ROL_CONTACTO_OPTIONS, "SELECCIONAR");

  ensureSelectHasValue("d_rolCliente", findCanonicalOption(ROL_CONTACTO_OPTIONS, groupData.rolCliente || ""));
  ensureSelectHasValue("d_rolCliente2", findCanonicalOption(ROL_CONTACTO_OPTIONS, groupData.rolCliente2 || ""));
}

function resolveDestinoPrincipalForm(groupData = {}) {
  const principal = cleanText(groupData.destinoPrincipal || "");
  const otro = cleanText(groupData.destinoPrincipalOtro || "");
  const canonical = normalizeDestinoCanonical(principal);

  if (!principal && !otro) {
    return { selectValue: "", otherValue: "" };
  }

  if (canonical && canonical !== "OTRO") {
    return {
      selectValue: canonical,
      otherValue: ""
    };
  }

  if (canonical === "OTRO") {
    return {
      selectValue: "OTRO",
      otherValue: normalizeTextUpper(otro || "")
    };
  }

  return {
    selectValue: "OTRO",
    otherValue: normalizeTextUpper(otro || principal)
  };
}

function resolveProgramaForm(groupData = {}, destinoActual = "") {
  const programa = cleanText(groupData.programa || "");
  const programaOtro = cleanText(groupData.programaOtro || "");
  const options = getProgramOptionsByDestino(destinoActual);
  const canonical = findCanonicalOption(options, programa);

  if (!programa && !programaOtro) {
    return { selectValue: "", otherValue: "" };
  }

  if (canonical && canonical !== "OTRO") {
    return {
      selectValue: canonical,
      otherValue: ""
    };
  }

  if (canonical === "OTRO") {
    return {
      selectValue: "OTRO",
      otherValue: normalizeTextUpper(programaOtro || "")
    };
  }

  return {
    selectValue: "OTRO",
    otherValue: normalizeTextUpper(programaOtro || programa)
  };
}

function resolveTramoForm(groupData = {}) {
  const tramo = cleanText(groupData.tramo || "");
  const tramoOtro = cleanText(groupData.tramoOtro || "");
  const canonical = findCanonicalOption(TRAMO_OPTIONS, tramo);

  if (!tramo && !tramoOtro) {
    return { selectValue: "", otherValue: "" };
  }

  if (canonical && canonical !== "OTRO") {
    return {
      selectValue: canonical,
      otherValue: ""
    };
  }

  if (canonical === "OTRO") {
    return {
      selectValue: "OTRO",
      otherValue: normalizeTextUpper(tramoOtro || "")
    };
  }

  return {
    selectValue: "OTRO",
    otherValue: normalizeTextUpper(tramoOtro || tramo)
  };
}

function resolveMesViajeForm(groupData = {}) {
  const mesViaje = cleanText(groupData.mesViaje || "");
  const mesViajeOtro = cleanText(groupData.mesViajeOtro || "");
  const legacy = cleanText(groupData.semanaViaje || "");
  const canonical = findCanonicalOption(MES_VIAJE_OPTIONS, mesViaje || legacy);

  if (!mesViaje && !mesViajeOtro && !legacy) {
    return { selectValue: "", otherValue: "" };
  }

  if (canonical && canonical !== "OTRO") {
    return {
      selectValue: canonical,
      otherValue: ""
    };
  }

  if (canonical === "OTRO") {
    return {
      selectValue: "OTRO",
      otherValue: normalizeTextUpper(mesViajeOtro || "")
    };
  }

  return {
    selectValue: "OTRO",
    otherValue: normalizeTextUpper(mesViajeOtro || mesViaje || legacy)
  };
}

function syncDatosDestinoOtroVisibility() {
  const selectValue = normalizeDestinoCanonical($("d_destinoPrincipal")?.value || "");
  const isOther = selectValue === "OTRO";

  $("wrapDatosDestinoPrincipalOtro")?.classList.toggle("hidden", !isOther);

  if (!isOther) {
    setFormValue("d_destinoPrincipalOtro", "");
  }
}

function syncDatosProgramaOtroVisibility() {
  const selectValue = findCanonicalOption(
    getProgramOptionsByDestino($("d_destinoPrincipal")?.value || "").length
      ? getProgramOptionsByDestino($("d_destinoPrincipal")?.value || "")
      : ["OTRO"],
    $("d_programa")?.value || ""
  );

  const isOther = selectValue === "OTRO";
  $("wrapDatosProgramaOtro")?.classList.toggle("hidden", !isOther);

  if (!isOther) {
    setFormValue("d_programaOtro", "");
  }
}

function syncDatosProgramaOptions(selectedValue = "", otherValue = "") {
  const destinoActual = $("d_destinoPrincipal")?.value || "";
  const options = getProgramOptionsByDestino(destinoActual);
  const finalOptions = options.length ? options : ["OTRO"];

  fillSelectWithOptions("d_programa", finalOptions, "SELECCIONAR");

  const canonical = findCanonicalOption(finalOptions, selectedValue);

  if (canonical) {
    setFormValue("d_programa", canonical);
    setFormValue("d_programaOtro", canonical === "OTRO" ? normalizeTextUpper(otherValue || "") : "");
  } else if (cleanText(selectedValue) || cleanText(otherValue)) {
    setFormValue("d_programa", "OTRO");
    setFormValue("d_programaOtro", normalizeTextUpper(otherValue || selectedValue));
  } else {
    setFormValue("d_programa", "");
    setFormValue("d_programaOtro", "");
  }

  syncDatosProgramaOtroVisibility();
}

function syncDatosTramoOtroVisibility() {
  const selectValue = findCanonicalOption(TRAMO_OPTIONS, $("d_tramo")?.value || "");
  const isOther = selectValue === "OTRO";

  $("wrapDatosTramoOtro")?.classList.toggle("hidden", !isOther);

  if (!isOther) {
    setFormValue("d_tramoOtro", "");
  }
}

function syncDatosMesViajeOtroVisibility() {
  const selectValue = findCanonicalOption(MES_VIAJE_OPTIONS, $("d_mesViaje")?.value || "");
  const isOther = selectValue === "OTRO";

  $("wrapDatosMesViajeOtro")?.classList.toggle("hidden", !isOther);

  if (!isOther) {
    setFormValue("d_mesViajeOtro", "");
  }
}

function buildDatosAliasPayload() {
  const colegio = normalizeTextUpper($("d_colegio")?.value || state.group?.colegio || "");
  const cursoBase = normalizeCursoInput($("d_curso")?.value || "");
  const anoViaje = cleanText($("d_anoViaje")?.value || "");
  const anoBase = getDocBaseYear(state.group || {});

  const cursoViaje = projectCursoToYear(cursoBase, anoBase, anoViaje);
  const aliasGrupo = buildAliasGrupo({
    cursoBase,
    anoBase,
    cursoViaje,
    anoViaje,
    colegio
  });

  const aliasTripKey = buildAliasTripKey({
    colegio,
    cursoViaje,
    anoViaje
  });

  return {
    colegio,
    cursoBase,
    anoBase,
    anoViaje,
    cursoViaje,
    aliasGrupo,
    aliasTripKey
  };
}

function syncDatosAliasPreview() {
  const aliasBox = $("d_aliasPreview");
  const aliasHelper = $("d_aliasHelper");

  if (!aliasBox) return;

  const esAliasManual = state.group?.nombreGrupoManual === true;

  if (esAliasManual) {
    const aliasManual = cleanText(
      state.group?.aliasGrupo ||
      state.group?.nombreGrupo ||
      getByPath(state.group, "ficha.nombreGrupo") ||
      ""
    );

    aliasBox.textContent = aliasManual || "—";
    aliasBox.classList.add("alias-manual");

    if (aliasHelper) {
      aliasHelper.textContent =
        "Nombre personalizado desde Ficha editable. El alias automático fue reemplazado manualmente y no se reconstruirá al cambiar curso o año.";
      aliasHelper.classList.add("alias-manual-helper");
    }

    return;
  }

  const { aliasGrupo } = buildDatosAliasPayload();

  aliasBox.textContent = aliasGrupo || "—";
  aliasBox.classList.remove("alias-manual");

  if (aliasHelper) {
    aliasHelper.textContent =
      "Se reconstruye automáticamente si cambias curso o año de viaje.";
    aliasHelper.classList.remove("alias-manual-helper");
  }
}
function bindUppercaseModalInput(id, afterChange = null) {
  const el = $(id);
  if (!el || el.dataset.upperBound === "1") return;

  el.dataset.upperBound = "1";

  el.addEventListener("input", () => {
    const start = el.selectionStart;
    const end = el.selectionEnd;

    el.value = normalizeTextUpperLive(el.value || "");

    try {
      el.setSelectionRange(start, end);
    } catch {}

    if (typeof afterChange === "function") afterChange();
  });

  el.addEventListener("change", () => {
    el.value = normalizeTextUpper(el.value || "");

    if (typeof afterChange === "function") afterChange();
  });
}

function bindPhoneModalInput(id) {
  const el = $(id);
  if (!el || el.dataset.phoneBound === "1") return;

  el.dataset.phoneBound = "1";

  el.addEventListener("focus", () => {
    if (!cleanText(el.value)) {
      el.value = "+569";
    }
  });

  el.addEventListener("input", () => {
    el.value = normalizeChileMobile(el.value || "");
    try {
      el.setSelectionRange(el.value.length, el.value.length);
    } catch {}
  });

  el.addEventListener("blur", () => {
    const safe = sanitizeChileMobileForSave(el.value || "");
    el.value = safe || "";
  });
}

function bindDatosModalControls() {
  bindUppercaseModalInput("d_colegio", syncDatosAliasPreview);
  bindUppercaseModalInput("d_comunaCiudad");
  bindUppercaseModalInput("d_nombreCliente");
  bindUppercaseModalInput("d_nombreCliente2");
  bindUppercaseModalInput("d_destinoPrincipalOtro");
  bindUppercaseModalInput("d_programaOtro");
  bindUppercaseModalInput("d_tramoOtro");
  bindUppercaseModalInput("d_mesViajeOtro");

  const curso = $("d_curso");
  if (curso && curso.dataset.cursoBound !== "1") {
    curso.dataset.cursoBound = "1";

    const handler = () => {
      curso.value = normalizeCursoInput(curso.value || "");
      syncDatosAliasPreview();
    };

    curso.addEventListener("input", handler);
    curso.addEventListener("change", handler);
  }

  const anoViaje = $("d_anoViaje");
  if (anoViaje && anoViaje.dataset.aliasBound !== "1") {
    anoViaje.dataset.aliasBound = "1";
    anoViaje.addEventListener("input", syncDatosAliasPreview);
    anoViaje.addEventListener("change", syncDatosAliasPreview);
  }

  const destino = $("d_destinoPrincipal");
  if (destino && destino.dataset.destinoBound !== "1") {
    destino.dataset.destinoBound = "1";
    destino.addEventListener("change", () => {
      syncDatosDestinoOtroVisibility();
      syncDatosProgramaOptions();
    });
  }

  const programa = $("d_programa");
  if (programa && programa.dataset.programaBound !== "1") {
    programa.dataset.programaBound = "1";
    programa.addEventListener("change", syncDatosProgramaOtroVisibility);
  }

  const tramo = $("d_tramo");
  if (tramo && tramo.dataset.tramoBound !== "1") {
    tramo.dataset.tramoBound = "1";
    tramo.addEventListener("change", syncDatosTramoOtroVisibility);
  }

  const mesViaje = $("d_mesViaje");
  if (mesViaje && mesViaje.dataset.mesBound !== "1") {
    mesViaje.dataset.mesBound = "1";
    mesViaje.addEventListener("change", syncDatosMesViajeOtroVisibility);
  }

  bindPhoneModalInput("d_celularCliente");
  bindPhoneModalInput("d_celularCliente2");
}

function groupValueIsEmpty(value) {
  if (value === null || value === undefined) return true;
  return String(value).trim() === "";
}

function getGrupoDatoFinal(campo = "") {
  if (campo === "destinoPrincipal") {
    const base = cleanText(state.group?.destinoPrincipal || "");
    if (normalizeSearchLocal(base) === "otro") {
      return cleanText(state.group?.destinoPrincipalOtro || "");
    }
    return base;
  }

  if (campo === "programa") {
    const base = cleanText(state.group?.programa || "");
    if (normalizeSearchLocal(base) === "otro") {
      return cleanText(state.group?.programaOtro || "");
    }
    return base;
  }

  if (campo === "tramo") {
    const base = cleanText(state.group?.tramo || "");
    if (normalizeSearchLocal(base) === "otro") {
      return cleanText(state.group?.tramoOtro || "");
    }
    return base;
  }

  if (campo === "mesViaje") {
    const base = cleanText(state.group?.mesViaje || "");
    if (normalizeSearchLocal(base) === "otro") {
      return cleanText(state.group?.mesViajeOtro || state.group?.semanaViaje || "");
    }
    return base || cleanText(state.group?.semanaViaje || "");
  }

  return cleanText(state.group?.[campo] || "");
}

function getDatosGrupoFaltantesParaFicha() {
  const campos = [
    { campo: "colegio", label: "Colegio" },
    { campo: "curso", label: "Curso" },
    { campo: "anoViaje", label: "Año de viaje" },
    { campo: "cantidadGrupo", label: "Cantidad grupo" },
    { campo: "destinoPrincipal", label: "Destino principal" },
    { campo: "programa", label: "Programa" },
    { campo: "tramo", label: "Tramo" },
    { campo: "mesViaje", label: "Mes / fecha de viaje" },
    { campo: "nombreCliente", label: "Contacto principal" },
    { campo: "correoCliente", label: "Correo contacto principal" },
    { campo: "celularCliente", label: "Teléfono contacto principal" }
  ];

  return campos
    .filter((item) => groupValueIsEmpty(getGrupoDatoFinal(item.campo)))
    .map((item) => item.label);
}

function openFichaEditor() {
  if (!canCreateFichaFromEstado()) {
    alert("La ficha solo se habilita cuando el grupo está en estado GANADA.");
    return;
  }

  const faltantes = getDatosGrupoFaltantesParaFicha();

  if (faltantes.length) {
    const mensaje =
      "Faltan datos del grupo que deberían completarse antes de editar la ficha.\n\n" +
      faltantes.map((x) => `- ${x}`).join("\n") +
      "\n\nPuedes ir a Editar Grupo o continuar con información incompleta.\n\n" +
      "Aceptar: continuar a ficha.\n" +
      "Cancelar: volver para editar el grupo.";

    const continuar = confirm(mensaje);

    if (!continuar) {
      openDatosModal();
      return;
    }
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

function generateInscripcionToken(length = 32) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);

  let out = "";
  for (let i = 0; i < array.length; i += 1) {
    out += chars[array[i] % chars.length];
  }
  return out;
}

function getInscripcionBaseUrl() {
  return new URL("inscripcion.html", window.location.href).href.split("?")[0];
}

function getInscripcionPublicLink(groupId, token, fase = "normal") {
  const base = getInscripcionBaseUrl();

  return `${base}?grupo=${encodeURIComponent(groupId)}&fase=${encodeURIComponent(fase)}&token=${encodeURIComponent(token)}`;
}

async function abrirInscripcionPrincipalDesdeBoton() {
  if (canGestionarInscripcionInicial()) {
    await cambiarFaseInscripcion("normal");
    return;
  }

  if (canGestionarNominaFinal()) {
    await cambiarFaseInscripcion("nomina_final");
    return;
  }

  alert(getBlockedInscripcionMessage());
}

async function enableGroupInscripcion() {
  await abrirInscripcionPrincipalDesdeBoton();
}

async function cambiarFaseInscripcion(fase = "normal") {
  const faseNormalizada = normalizeSearchLocal(fase);

  let puedeGestionar = false;

  if (faseNormalizada === "normal") {
    puedeGestionar = canGestionarInscripcionInicial();
  } else if (faseNormalizada === "nomina_final") {
    puedeGestionar = canGestionarNominaFinal();
  } else if (faseNormalizada === "nuevos") {
    puedeGestionar = canGestionarNuevosIngresos();
  } else if (faseNormalizada === "lista_espera") {
    puedeGestionar = canGestionarListaEspera();
  }

  if (!puedeGestionar) {
    alert(getBlockedInscripcionMessage());
    return;
  }

  const contexto = getContextoInscripcionGrupo(faseNormalizada);
  const label = contexto.labelFase;
  const tokenInscripcion = generateInscripcionToken(32);

  const ok = confirm(`¿Quieres abrir "${label}" y generar un nuevo link público?`);
  if (!ok) return;

  const link = getInscripcionPublicLink(state.groupId, tokenInscripcion, faseNormalizada);

  const patch = {
    inscripcionHabilitada: true,
    tokenInscripcion,
    inscripcionEstado: faseNormalizada,
    faseInscripcion: faseNormalizada,

    fechaAperturaInscripcion: serverTimestamp(),

    inscripcion: {
      ...(state.group?.inscripcion || {}),
      estado: faseNormalizada,
      faseActual: faseNormalizada,

      claveActual: contexto.clave,
      labelActual: contexto.labelFase,
      tipoInscripcionActual: contexto.tipoInscripcion,
      estadoCupoActual: contexto.estadoCupo,

      tokenActual: tokenInscripcion,
      linkActual: link,

      actualizadoPor: getDisplayName(state.effectiveUser),
      actualizadoPorCorreo: state.effectiveEmail,
      actualizadoAt: serverTimestamp(),

      linkGeneradoPor: getDisplayName(state.effectiveUser),
      linkGeneradoPorCorreo: state.effectiveEmail,
      linkGeneradoAt: serverTimestamp()
    },

    correoCambiosInscripcion:
      cleanText(state.group?.correoCambiosInscripcion || "") || DEFAULT_CORREO_CAMBIOS_INSCRIPCION
  };

  await saveGroupPatch(patch, {
    tipoMovimiento: `inscripcion_${faseNormalizada}_habilitada`,
    modulo: "inscripcion",
    titulo: `Inscripción abierta: ${label}`,
    mensaje: `${getDisplayName(state.effectiveUser)} abrió "${label}" y generó un nuevo link público.`,
    cambios: [
      {
        campo: "inscripcionEstado",
        anterior: getInscripcionEstadoActual(),
        nuevo: faseNormalizada
      },
      {
        campo: "tipoInscripcionActual",
        anterior: state.group?.inscripcion?.tipoInscripcionActual || "",
        nuevo: contexto.tipoInscripcion
      },
      {
        campo: "tokenInscripcion",
        anterior: state.group?.tokenInscripcion || "",
        nuevo: tokenInscripcion
      }
    ]
  });

  try {
    await navigator.clipboard.writeText(link);
    showSaveNotice(`${label} habilitada y link copiado.`);
  } catch {
    showSaveNotice(`${label} habilitada correctamente.`);
    alert(`Link de inscripción:\n\n${link}`);
  }
}

async function crearLinkLiberados() {
  if (!canGestionarLiberados()) {
    alert(getBlockedInscripcionMessage());
    return;
  }

  if (normalizeState(state.group?.estado) !== "ganada") {
    alert("El link de liberados solo se puede crear cuando el grupo está en estado GANADA.");
    return;
  }

  const permitidos = getLiberadosPermitidos();
  const usados = getLiberadosUsados();

  if (permitidos && usados >= permitidos) {
    const okCupo = confirm(
      `Ya están usados ${usados} de ${permitidos} cupos liberados. ¿Quieres generar el link de todas formas?`
    );
    if (!okCupo) return;
  }

  const tokenLiberados = generateInscripcionToken(32);
  const link = getInscripcionPublicLink(state.groupId, tokenLiberados, "liberado");

  const ok = confirm("¿Quieres crear/regenerar el link para cupos liberados?");
  if (!ok) return;

  await saveGroupPatch(
    {
      linkLiberadosActivo: true,
      tokenInscripcionLiberados: tokenLiberados,

      inscripcionLiberados: {
        ...(state.group?.inscripcionLiberados || {}),
        activo: true,
        tokenActual: tokenLiberados,
        linkActual: link,
        tipoInscripcionActual: "liberado",
        estadoCupoActual: "confirmado",

        actualizadoPor: getDisplayName(state.effectiveUser),
        actualizadoPorCorreo: state.effectiveEmail,
        actualizadoAt: serverTimestamp(),

        linkGeneradoPor: state.group?.inscripcionLiberados?.linkGeneradoPor || getDisplayName(state.effectiveUser),
        linkGeneradoPorCorreo: state.group?.inscripcionLiberados?.linkGeneradoPorCorreo || state.effectiveEmail,
        linkGeneradoAt: state.group?.inscripcionLiberados?.linkGeneradoAt || serverTimestamp()
      }
    },
    {
      tipoMovimiento: "inscripcion_liberados_habilitada",
      modulo: "inscripcion",
      titulo: "Link de liberados habilitado",
      mensaje: `${getDisplayName(state.effectiveUser)} creó/regeneró el link para cupos liberados.`,
      cambios: [
        {
          campo: "tokenInscripcionLiberados",
          anterior: state.group?.tokenInscripcionLiberados || "",
          nuevo: tokenLiberados
        },
        {
          campo: "linkLiberadosActivo",
          anterior: !!state.group?.linkLiberadosActivo,
          nuevo: true
        }
      ]
    }
  );

  try {
    await navigator.clipboard.writeText(link);
    showSaveNotice("Link de liberados creado y copiado.");
  } catch {
    showSaveNotice("Link de liberados creado correctamente.");
    alert(`Link liberados:\n\n${link}`);
  }
}

async function cerrarInscripcion() {
  const puedeCerrar =
    puedeAbrirCerrarFasesInscripcion() ||
    puedeReabrirFasePasada();

  if (!puedeCerrar) {
    alert(getBlockedInscripcionMessage());
    return;
  }

  if (!state.group?.inscripcionHabilitada) {
    alert("No hay una inscripción activa para cerrar.");
    return;
  }

  const estadoAnterior = getInscripcionEstadoActual();

  const contextoActivo = {
    clave:
      state.group?.inscripcion?.claveActual ||
      getContextoInscripcionGrupo(estadoAnterior).clave,

    label:
      state.group?.inscripcion?.labelActual ||
      getContextoInscripcionGrupo(estadoAnterior).labelFase
  };

  const ok = confirm(`¿Quieres cerrar "${contextoActivo.label}"?`);
  if (!ok) return;

  const fasesCerradasActuales = state.group?.inscripcion?.fasesCerradas || {};

  await saveGroupPatch(
    {
      inscripcionHabilitada: false,
      inscripcionEstado: "cerrada",
      faseInscripcion: "cerrada",

      inscripcion: {
        ...(state.group?.inscripcion || {}),
        estado: "cerrada",
        faseActual: "cerrada",

        fasesCerradas: {
          ...fasesCerradasActuales,
          [contextoActivo.clave]: true
        },

        actualizadoPor: getDisplayName(state.effectiveUser),
        actualizadoPorCorreo: state.effectiveEmail,
        actualizadoAt: serverTimestamp(),

        cerradaPor: getDisplayName(state.effectiveUser),
        cerradaPorCorreo: state.effectiveEmail,
        cerradaAt: serverTimestamp(),
        ultimaFaseCerrada: contextoActivo.clave,
        ultimaFaseCerradaLabel: contextoActivo.label
      }
    },
    {
      tipoMovimiento: "inscripcion_cerrada",
      modulo: "inscripcion",
      titulo: `Inscripción cerrada: ${contextoActivo.label}`,
      mensaje: `${getDisplayName(state.effectiveUser)} cerró "${contextoActivo.label}".`,
      cambios: [
        {
          campo: "inscripcionEstado",
          anterior: estadoAnterior,
          nuevo: "cerrada"
        },
        {
          campo: "faseCerrada",
          anterior: "",
          nuevo: contextoActivo.clave
        },
        {
          campo: "inscripcionHabilitada",
          anterior: !!state.group?.inscripcionHabilitada,
          nuevo: false
        }
      ]
    }
  );

  showSaveNotice(`${contextoActivo.label} cerrada correctamente.`);
}

async function marcarListaEsperaPagada(inscripcionId = "") {
  if (!puedeMarcarListaEsperaPagada()) {
    alert("Solo Administración o Admin pueden marcar lista de espera como pagada.");
    return;
  }

  const item = state.inscripciones.find((x) => x.id === inscripcionId);
  if (!item) {
    alert("No se encontró la inscripción seleccionada.");
    return;
  }

  const nombre = [
    getInscripcionNombres(item),
    getInscripcionApellidos(item)
  ].filter(Boolean).join(" ");

  const ok = confirm(`¿Confirmar que ${nombre || "esta persona"} pagó los $100.000 de lista de espera?`);
  if (!ok) return;

  const ref = doc(
    db,
    "ventas_cotizaciones",
    String(state.groupDocId),
    "inscripciones",
    String(inscripcionId)
  );

  await updateDoc(ref, {
    tipoInscripcion: "lista_espera_pagada",
    estadoCupo: "pagado",
    listaEsperaPagada: true,
    listaEsperaPagadaPor: getDisplayName(state.effectiveUser),
    listaEsperaPagadaPorCorreo: state.effectiveEmail,
    listaEsperaPagadaAt: serverTimestamp()
  });

  await createHistoryEntry({
    tipoMovimiento: "inscripcion_lista_espera_pagada",
    modulo: "inscripcion",
    titulo: "Lista de espera pagada",
    mensaje: `${getDisplayName(state.effectiveUser)} marcó como pagada la lista de espera de ${nombre || "una persona"}.`,
    metadata: {
      inscripcionId,
      documento: getInscripcionDocumento(item),
      nombreCompleto: nombre
    }
  });

  await loadInscripciones();
  renderInscripcionPasajerosPanel();
  syncButtons();

  showSaveNotice("Lista de espera marcada como pagada.");
}

async function confirmarCupoListaEspera(inscripcionId = "") {
  if (!canConfirmarListaEspera()) {
    alert(getBlockedInscripcionMessage());
    return;
  }

  const item = state.inscripciones.find((x) => x.id === inscripcionId);
  if (!item) {
    alert("No se encontró la inscripción seleccionada.");
    return;
  }

  if (normalizeSearchLocal(item.estadoCupo || "") !== "pagado") {
    alert("Antes de confirmar el cupo, Administración o Admin debe marcar esta lista de espera como pagada.");
    return;
  }

  const nombre = [
    getInscripcionNombres(item),
    getInscripcionApellidos(item)
  ].filter(Boolean).join(" ");

  const ok = confirm(`¿Confirmar cupo para ${nombre || "esta persona"} desde lista de espera pagada?`);
  if (!ok) return;

  const ref = doc(
    db,
    "ventas_cotizaciones",
    String(state.groupDocId),
    "inscripciones",
    String(inscripcionId)
  );

  await updateDoc(ref, {
    tipoInscripcion: "lista_espera_confirmada",
    estadoCupo: "confirmado",
    confirmadoDesdeListaEspera: true,
    confirmadoCupoPor: getDisplayName(state.effectiveUser),
    confirmadoCupoPorCorreo: state.effectiveEmail,
    confirmadoCupoAt: serverTimestamp()
  });

  await createHistoryEntry({
    tipoMovimiento: "inscripcion_lista_espera_confirmada",
    modulo: "inscripcion",
    titulo: "Cupo confirmado desde lista de espera pagada",
    mensaje: `${getDisplayName(state.effectiveUser)} confirmó cupo para ${nombre || "una persona"} desde lista de espera pagada.`,
    metadata: {
      inscripcionId,
      documento: getInscripcionDocumento(item),
      nombreCompleto: nombre
    }
  });

  await loadInscripciones();
  renderInscripcionPasajerosPanel();
  syncButtons();

  showSaveNotice("Cupo confirmado correctamente.");
}

async function confirmarNuevoIngreso(inscripcionId = "") {
  if (!canConfirmarListaEspera()) {
    alert("Solo Registro, Administración o Admin pueden confirmar nuevos ingresos.");
    return;
  }

  const item = state.inscripciones.find((x) => x.id === inscripcionId);
  if (!item) {
    alert("No se encontró la inscripción seleccionada.");
    return;
  }

  const nombre = [
    getInscripcionNombres(item),
    getInscripcionApellidos(item)
  ].filter(Boolean).join(" ");

  const ok = confirm(`¿Confirmar nuevo ingreso para ${nombre || "esta persona"}?`);
  if (!ok) return;

  const ref = doc(
    db,
    "ventas_cotizaciones",
    String(state.groupDocId),
    "inscripciones",
    String(inscripcionId)
  );

  await updateDoc(ref, {
    tipoInscripcion: "nuevo_ingreso_confirmado",
    estadoCupo: "confirmado",
    nuevoIngresoConfirmado: true,
    nuevoIngresoConfirmadoPor: getDisplayName(state.effectiveUser),
    nuevoIngresoConfirmadoPorCorreo: state.effectiveEmail,
    nuevoIngresoConfirmadoAt: serverTimestamp()
  });

  await createHistoryEntry({
    tipoMovimiento: "inscripcion_nuevo_ingreso_confirmado",
    modulo: "inscripcion",
    titulo: "Nuevo ingreso confirmado",
    mensaje: `${getDisplayName(state.effectiveUser)} confirmó nuevo ingreso para ${nombre || "una persona"}.`,
    metadata: {
      inscripcionId,
      documento: getInscripcionDocumento(item),
      nombreCompleto: nombre
    }
  });

  await loadInscripciones();
  renderInscripcionPasajerosPanel();
  syncButtons();

  showSaveNotice("Nuevo ingreso confirmado correctamente.");
}

async function copyGroupInscripcionLink() {
  if (!state.group?.inscripcionHabilitada || !state.group?.tokenInscripcion) {
    alert("Este grupo todavía no tiene una inscripción habilitada.");
    return;
  }

  const fase =
    state.group?.inscripcion?.faseActual ||
    getInscripcionEstadoActual();

  const label =
    state.group?.inscripcion?.labelActual ||
    getInscripcionFaseLabel(fase);

  const link = getInscripcionPublicLink(state.groupId, state.group.tokenInscripcion, fase);

  try {
    await navigator.clipboard.writeText(link);
    showSaveNotice(`Link copiado: ${label}.`);
  } catch {
    alert(`No se pudo copiar automáticamente.\n\nCopia este link:\n\n${link}`);
  }
}

function canResetearCicloInscripcion() {
  const rol = String(state.effectiveUser?.rol || "").toLowerCase();
  const email = normalizeEmail(state.effectiveEmail || "");

  return rol === "admin" || email === "chernandez@raitrai.cl";
}

function canEditarNominaInscripcion() {
  const rol = String(state.effectiveUser?.rol || "").toLowerCase();
  const email = normalizeEmail(state.effectiveEmail || "");

  if (rol === "admin") return true;
  if (rol === "registro") return true;

  if (
    email === "administracion@raitrai.cl" ||
    email === "yenny@raitrai.cl" ||
    email === "raitrai@raitrai.cl"
  ) {
    return true;
  }

  if (email === "chernandez@raitrai.cl") {
    return !state.group?.flowFicha?.jefaVentas?.firmado;
  }

  return false;
}

function canEditarRutYTipoInscripcionNomina() {
  return String(state.effectiveUser?.rol || "").toLowerCase() === "admin";
}

function getFaseResetInscripcionSeleccionada() {
  const seleccion = normalizeSearchLocal($("reset_tipo_ciclo")?.value || "auto");

  if (seleccion === "normal") return "normal";
  if (seleccion === "nomina_final") return "nomina_final";

  return grupoVieneSistemaAntiguo() ? "nomina_final" : "normal";
}

function openResetCicloInscripcionModal() {
  if (!canResetearCicloInscripcion()) {
    alert("Solo Admin o Jefa de Ventas puede resetear el ciclo de inscripción.");
    return;
  }

  setFormValue("reset_tipo_ciclo", "auto");
  setFormValue("reset_accion_inscritos", "conservar");
  setFormValue("reset_motivo", "");

  openModal("modalResetCicloInscripcion");
}

async function resetearCicloInscripcion() {
  if (!canResetearCicloInscripcion()) {
    alert("Solo Admin o Jefa de Ventas puede resetear el ciclo de inscripción.");
    return;
  }

  const faseNueva = getFaseResetInscripcionSeleccionada();
  const contexto = getContextoInscripcionGrupo(faseNueva);
  const accionInscritos = normalizeSearchLocal($("reset_accion_inscritos")?.value || "conservar");
  const debeArchivar = accionInscritos === "archivar";
  const motivo = cleanText($("reset_motivo")?.value || "");

  const totalInscritos = state.inscripciones.length;

  const mensajeConfirmacion = [
    "¿Confirmas resetear el ciclo de inscripción?",
    "",
    `Nuevo ciclo: ${contexto.labelFase}`,
    debeArchivar
      ? `Se archivarán ${totalInscritos} inscrito(s) y la nómina visible quedará limpia.`
      : "Se conservarán los inscritos actuales.",
    "",
    "Esta acción quedará registrada en el historial."
  ].join("\n");

  const ok = confirm(mensajeConfirmacion);
  if (!ok) return;

  const btn = $("btnConfirmarResetCicloInscripcion");
  if (btn) btn.disabled = true;

  try {
    const tokenNuevo = generateInscripcionToken(32);
    const linkNuevo = getInscripcionPublicLink(state.groupId, tokenNuevo, faseNueva);
    const archivoId = `reset_${state.groupId}_${Date.now()}`;

    if (debeArchivar && totalInscritos) {
      const archivoRef = doc(
        db,
        "ventas_cotizaciones",
        String(state.groupDocId),
        "inscripciones_archivadas",
        archivoId
      );

      await setDoc(archivoRef, {
        archivoId,
        tipoArchivo: "reset_ciclo_inscripcion",
        idGrupo: String(state.groupId || ""),
        groupDocId: String(state.groupDocId || ""),

        faseAnterior: getInscripcionEstadoActual(),
        faseNueva,
        labelFaseNueva: contexto.labelFase,

        totalInscritos,
        motivo: motivo || "Reset ciclo inscripción",

        creadoPor: getDisplayName(state.effectiveUser),
        creadoPorCorreo: state.effectiveEmail,
        creadoAt: serverTimestamp()
      });

      for (const item of state.inscripciones) {
        const inscRef = doc(
          db,
          "ventas_cotizaciones",
          String(state.groupDocId),
          "inscripciones",
          String(item.id)
        );

        await updateDoc(inscRef, {
          privacidad: {
            ...(item.privacidad || {}),
            estado: "archivada",
            archivoId,
            archivadaAt: serverTimestamp(),
            archivadaPor: getDisplayName(state.effectiveUser),
            archivadaPorCorreo: state.effectiveEmail,
            motivoArchivo: motivo || "Reset ciclo inscripción"
          }
        });
      }
    }

    await saveGroupPatch(
      {
        inscripcionHabilitada: true,
        tokenInscripcion: tokenNuevo,
        inscripcionEstado: faseNueva,
        faseInscripcion: faseNueva,

        fechaAperturaInscripcion: serverTimestamp(),

        inscripcion: {
          ...(state.group?.inscripcion || {}),
          estado: faseNueva,
          faseActual: faseNueva,

          claveActual: contexto.clave,
          labelActual: contexto.labelFase,
          tipoInscripcionActual: contexto.tipoInscripcion,
          estadoCupoActual: contexto.estadoCupo,

          tokenActual: tokenNuevo,
          linkActual: linkNuevo,

          resetCicloAt: serverTimestamp(),
          resetCicloPor: getDisplayName(state.effectiveUser),
          resetCicloPorCorreo: state.effectiveEmail,
          resetCicloMotivo: motivo || "",
          resetCicloArchivoId: debeArchivar ? archivoId : "",
          resetCicloArchivoInscritos: debeArchivar,

          actualizadoPor: getDisplayName(state.effectiveUser),
          actualizadoPorCorreo: state.effectiveEmail,
          actualizadoAt: serverTimestamp(),

          linkGeneradoPor: getDisplayName(state.effectiveUser),
          linkGeneradoPorCorreo: state.effectiveEmail,
          linkGeneradoAt: serverTimestamp()
        }
      },
      {
        tipoMovimiento: "reset_ciclo_inscripcion",
        modulo: "inscripcion",
        titulo: "Reset de ciclo de inscripción",
        mensaje: `${getDisplayName(state.effectiveUser)} reseteó el ciclo de inscripción a "${contexto.labelFase}". ${
          debeArchivar
            ? `Se archivaron ${totalInscritos} inscrito(s).`
            : "Se conservaron los inscritos actuales."
        }${motivo ? ` Motivo: ${motivo}` : ""}`,
        metadata: {
          faseNueva,
          labelFaseNueva: contexto.labelFase,
          archivoId: debeArchivar ? archivoId : "",
          inscritosArchivados: debeArchivar ? totalInscritos : 0,
          inscritosConservados: debeArchivar ? 0 : totalInscritos
        }
      }
    );

    try {
      await navigator.clipboard.writeText(linkNuevo);
      showSaveNotice("Ciclo reseteado y nuevo link copiado.");
    } catch {
      showSaveNotice("Ciclo reseteado correctamente.");
      alert(`Nuevo link:\n\n${linkNuevo}`);
    }

    closeModal("modalResetCicloInscripcion");
    await loadAll();
  } catch (error) {
    console.error("[grupo] resetearCicloInscripcion", error);
    alert("Error al resetear ciclo de inscripción: " + error.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

function normalizarTextoExport(value = "") {
  const limpio = String(value || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ");

  if (!limpio) return "";

  return limpio
    .split(" ")
    .map((p) => p ? p.charAt(0).toUpperCase() + p.slice(1) : "")
    .join(" ");
}

function soloDigitos(value = "") {
  return String(value || "").replace(/\D/g, "");
}

function normalizarRutExport(value = "") {
  const limpio = String(value || "")
    .trim()
    .replace(/\./g, "")
    .replace(/-/g, "")
    .replace(/\s+/g, "")
    .toUpperCase();

  if (limpio === "—") return "";

  return limpio;
}

function normalizarTipoPasajeroExport(item = {}) {
  const tipoRaw = item.tipoViajante || item.tipoParticipacion || "";
  const tipoKey = normalizeSearchLocal(tipoRaw);

  return tipoKey === "estudiante" ? "Estudiante" : "Adulto";
}

function normalizarNacionalidadExport(item = {}) {
  const raw = getInscripcionNacionalidad(item);
  const partes = String(raw || "")
    .split(/[,;/|]+|\s+y\s+/i)
    .map((x) => normalizarTextoExport(x))
    .filter(Boolean);

  if (!partes.length) return "";

  const chilena = partes.find((x) => normalizeSearchLocal(x) === "chilena");
  if (chilena) return "Chilena";

  return partes[0];
}

function getCantidadLiberadosAnonimosExport() {
  const raw =
    state.group?.liberados ??
    state.group?.cantidadLiberados ??
    state.group?.ficha?.liberados ??
    state.group?.ficha?.cantidadLiberados ??
    0;

  const numero = Number(String(raw).replace(",", "."));

  if (!Number.isFinite(numero) || numero <= 0) return 0;

  return Math.ceil(numero);
}

function buildInscripcionesExportRows() {
  const items = state.inscripciones.filter(esNominaFinalOperativa);

  const rows = items.map((item, index) => ({
    "Numero": index + 1,

    "1.- Rut": normalizarRutExport(getInscripcionDocumento(item)),

    "2.- Apellidos del Alumno": normalizarTextoExport(getInscripcionApellidos(item)),

    "3.- Nombre del Alumno": normalizarTextoExport(getInscripcionNombres(item)),

    "4.- Fecha Nacimiento": formatDateOnlyForTable(
      getByPath(item, "identificacion.fechaNacimiento")
    ),

    "5.- Tipo Pasajero": normalizarTipoPasajeroExport(item),

    "6.- Nacionalidad": normalizarNacionalidadExport(item),

    "7.- Sexo": normalizarTextoExport(getInscripcionGenero(item)),

    "8.- Nombre del Apoderado": normalizarTextoExport(getResponsablePrincipalNombre(item)),

    "9.- Correo del Apoderado":
      getByPath(item, "contactoPrincipal.correo") || "",

    "10.- Celular Apoderado": soloDigitos(
      getByPath(item, "contactoPrincipal.celular") ||
      getByPath(item, "contactoPrincipal.telefono") ||
      getByPath(item, "contactoPrincipal.whatsapp") ||
      ""
    )
  }));

  const cantidadLiberadosAnonimos = getCantidadLiberadosAnonimosExport();

  for (let i = 0; i < cantidadLiberadosAnonimos; i += 1) {
    rows.push({
      "Numero": rows.length + 1,

      "1.- Rut": "",

      "2.- Apellidos del Alumno": "",

      "3.- Nombre del Alumno": `Apoderado ${i + 1}`,

      "4.- Fecha Nacimiento": "",

      "5.- Tipo Pasajero": "Adulto",

      "6.- Nacionalidad": "",

      "7.- Sexo": "",

      "8.- Nombre del Apoderado": "",

      "9.- Correo del Apoderado": "",

      "10.- Celular Apoderado": ""
    });
  }

  return rows;
}

function downloadTextFile(filename, content, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();

  a.remove();
  URL.revokeObjectURL(url);
}

function exportarInscripcionesCsv() {
  const rows = buildInscripcionesExportRows();

  if (!puedeExportarCsvInscripciones()) {
    alert("Solo Registro, Administración o Admin pueden exportar CSV.");
    return;
  }

  if (!rows.length) {
    alert("No hay inscripciones para exportar.");
    return;
  }

  const headers = Object.keys(rows[0]);

  const csv = [
    headers.join(";"),
    ...rows.map((row) =>
      headers.map((key) => {
        const value = String(row[key] ?? "").replaceAll('"', '""');
        return `"${value}"`;
      }).join(";")
    )
  ].join("\n");

  const nombre = `inscripciones_${state.groupId}_${new Date().toISOString().slice(0, 10)}.csv`;
  downloadTextFile(nombre, csv, "text/csv;charset=utf-8");
}

function exportarInscripcionesExcel() {
  const rows = buildInscripcionesExportRows();

  if (!rows.length) {
    alert("No hay inscripciones para exportar.");
    return;
  }

  const headers = Object.keys(rows[0]);

  const html = `
    <html>
      <head>
        <meta charset="UTF-8" />
      </head>
      <body>
        <table>
          <thead>
            <tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr>
          </thead>
          <tbody>
            ${rows.map((row) => `
              <tr>
                ${headers.map((h) => `<td>${escapeHtml(row[h] ?? "")}</td>`).join("")}
              </tr>
            `).join("")}
          </tbody>
        </table>
      </body>
    </html>
  `;

  const nombre = `inscripciones_${state.groupId}_${new Date().toISOString().slice(0, 10)}.xls`;
  downloadTextFile(nombre, html, "application/vnd.ms-excel;charset=utf-8");
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
/* =========================================================
   NÓMINA INICIAL · SISTEMA DE PAGOS
========================================================= */

function esInscripcionSistemaPagos(item = {}) {
  return normalizeSearchLocal(getInscripcionTipoReal(item)) === "sistema_pagos";
}

function getCorreoVendedoraGrupoParaCopia() {
  const vendedor = normalizeSearchLocal(state.group?.vendedora || "");

  const MAP_VENDEDORAS_CORREO = [
    { claves: ["giselle"], correo: "griveros@raitrai.cl" },
    { claves: ["elias"], correo: "elagos@raitrai.cl" },
    { claves: ["claudio"], correo: "crojas@raitrai.cl" },
    { claves: ["alejandra"], correo: "aflores@raitrai.cl" },
    { claves: ["orietta"], correo: "orietta@raitrai.cl" },
    { claves: ["carolina", "carola"], correo: "ccayoso@raitrai.cl" },
    { claves: ["juan pablo", "juanpablo"], correo: "jpino@raitrai.cl" }
  ];

  const match = MAP_VENDEDORAS_CORREO.find((item) =>
    item.claves.some((clave) => vendedor.includes(normalizeSearchLocal(clave)))
  );

  return match?.correo || "";
}

function getInscripcionesNominaInicial() {
  return state.inscripciones.filter((item) => {
    const tipo = normalizeSearchLocal(getInscripcionTipoReal(item));
    const fase = normalizeSearchLocal(item.faseInscripcion || item?.meta?.faseInscripcion || "");
    const estado = normalizeSearchLocal(item.estadoInscripcion || "");
    const label = normalizeSearchLocal(getEstadoOperativoInscripcionLabel(item));

    return (
      tipo === "nomina_inicial" ||
      tipo === "inscripcion_inicial" ||
      tipo === "inscripcion_comercial" ||
      (
        tipo !== "sistema_pagos" &&
        fase === "normal"
      ) ||
      (
        tipo !== "sistema_pagos" &&
        estado === "normal"
      ) ||
      label === "inscripcion_inicial"
    );
  });
}

function getEstadoNominaInicialPagos() {
  const pagos = state.group?.sistemaPagos?.nominaInicial || {};
  return {
    cargada: pagos.cargada === true,
    totalInscripciones: Number(pagos.totalInscripciones || 0),
    totalCorreos: Number(pagos.totalCorreos || 0),
    cargadaAt: pagos.cargadaAt || null,
    cargadaPor: pagos.cargadaPor || "",
    batchId: pagos.batchId || ""
  };
}

function buildNombreCompletoInscripcion(item = {}) {
  return [
    getInscripcionNombres(item),
    getInscripcionApellidos(item)
  ]
    .filter((x) => x && x !== "—")
    .join(" ")
    .trim();
}

function getCorreoViajanteAdulto(item = {}) {
  return normalizeEmail(
    getByPath(item, "contactoViajante.correo") ||
    getByPath(item, "viajante.correo") ||
    getByPath(item, "identificacion.correo") ||
    getByPath(item, "contacto.correo") ||
    ""
  );
}

function getDestinatarioNominaInicial(item = {}) {
  const tipo = normalizeSearchLocal(item.tipoViajante || item.tipoParticipacion || "");
  const esEstudiante = !tipo || tipo === "estudiante";

  const nombreParticipante = buildNombreCompletoInscripcion(item);
  const documento = getInscripcionDocumento(item);

  const responsableNombre = getResponsablePrincipalNombre(item);
  const correoResponsable = normalizeEmail(getByPath(item, "contactoPrincipal.correo") || "");

  const correoAdulto = getCorreoViajanteAdulto(item);

  const correo = esEstudiante
    ? correoResponsable
    : (correoAdulto || correoResponsable);

  const nombreResponsable = esEstudiante
    ? responsableNombre
    : (nombreParticipante || responsableNombre);

  return {
    inscripcionId: item.id,
    item,
    nombreParticipante,
    documento,
    nombreResponsable,
    correo,
    estado: correo ? "listo" : "sin_correo"
  };
}

function buildDestinatariosNominaInicial() {
  const base = [
    ...getInscripcionesNominaInicial(),
    ...getInscripcionesSistemaPagos()
  ];

  const vistos = new Set();

  return base
    .filter((item) => {
      const key = item.id || getInscripcionDocumento(item);
      if (vistos.has(key)) return false;
      vistos.add(key);
      return true;
    })
    .map(getDestinatarioNominaInicial);
}

function buildAsuntoNominaInicialPagos() {
  const colegio = normalizeTextUpper(state.group?.colegio || "");
  const curso = normalizeTextUpper(state.group?.curso || "");
  const ano = cleanText(state.group?.anoViaje || "");

  return `Sistema de pagos habilitado · ${[colegio, curso, ano].filter(Boolean).join(" ")}`.trim();
}

function buildCuerpoNominaInicialPagos() {
  const grupo =
    cleanText(state.group?.aliasGrupo) ||
    cleanText(state.group?.nombreGrupo) ||
    normalizeTextUpper(state.group?.colegio || "");

  return `
Junto con saludar, informamos que la inscripción inicial del viaje de estudios ${grupo ? `del grupo ${grupo}` : ""} ya fue cargada en el sistema de pagos de Turismo Rai Trai.

Desde ahora podrá ingresar al portal de pagos:

https://pagos.turismoraitrai.cl/payment/

Para acceder debe utilizar:
Usuario: RUT del/de la viajante.
Contraseña: últimos 4 dígitos del RUT.

En el sistema podrá revisar y efectuar los pagos correspondientes al viaje de estudios.

Saludos cordiales,
Turismo Rai Trai
`.trim();
}

function setNominaPagosProgress(done = 0, total = 0) {
  const pct = total ? Math.round((done / total) * 100) : 0;

  setText("nominaPagosProgresoTxt", `${done} / ${total}`);
  const bar = $("nominaPagosProgresoBar");
  if (bar) bar.style.width = `${pct}%`;
}

function renderNominaPagosDestinatarios(destinatarios = []) {
  const tbody = $("nominaPagosDestinatariosBody");
  if (!tbody) return;

  tbody.innerHTML = destinatarios.map((d, index) => `
    <tr>
      <td>${index + 1}</td>
      <td>${escapeHtml(d.nombreParticipante || "—")}</td>
      <td>${escapeHtml(d.nombreResponsable || "—")}</td>
      <td>${escapeHtml(d.correo || "—")}</td>
      <td>${d.correo ? "Listo" : "Sin correo"}</td>
    </tr>
  `).join("");
}

function openNominaInicialPagosModal() {
  if (!puedeOperarListaEsperaAdministrativa()) {
    alert("Solo Registro, Administración o Admin pueden realizar esta acción.");
    return;
  }

  const destinatarios = buildDestinatariosNominaInicial();
  const validos = destinatarios.filter((d) => d.correo);
  const sinCorreo = destinatarios.filter((d) => !d.correo);

  if (!destinatarios.length) {
    const rol = String(state.effectiveUser?.rol || "").toLowerCase();
  
    if (rol === "admin") {
      alert("No hay inscripciones iniciales para cargar a pagos. Revisa Editar Nómina y cambia el Tipo inscripción a Inscripción inicial si corresponde.");
    } else {
      alert("No hay inscripciones iniciales para este grupo.");
    }
  
    return;
  }

  const correoVendedoraCopia = getCorreoVendedoraGrupoParaCopia();
  
  setText(
    "nominaPagosResumen",
    `Grupo: ${state.group?.aliasGrupo || state.group?.nombreGrupo || state.group?.colegio || state.groupId}
  Participantes inscripción inicial: ${destinatarios.length}
  Correos válidos: ${validos.length}
  Sin correo: ${sinCorreo.length}
  Resumen a vendedora: ${correoVendedoraCopia || "No detectada"}`
  );

  setFormValue("nominaPagosAsunto", buildAsuntoNominaInicialPagos());
  setFormValue("nominaPagosCuerpo", buildCuerpoNominaInicialPagos());

  renderNominaPagosDestinatarios(destinatarios);
  setNominaPagosProgress(0, validos.length);

  openModal("modalNominaInicialPagos");
}

async function enviarNominaInicialPagos() {
  if (!puedeOperarListaEsperaAdministrativa()) {
    alert("Solo Registro, Administración o Admin pueden realizar esta acción.");
    return;
  }

  const asunto = String($("nominaPagosAsunto")?.value || "").trim();
  const cuerpo = String($("nominaPagosCuerpo")?.value || "").trim();

  if (!asunto || !cuerpo) {
    alert("Debes ingresar asunto y cuerpo del correo.");
    return;
  }

  const destinatarios = buildDestinatariosNominaInicial();
  const validos = destinatarios.filter((d) => d.correo);
  const sinCorreo = destinatarios.filter((d) => !d.correo);

  if (!validos.length) {
    alert("No hay correos válidos para enviar.");
    return;
  }

  const ok = confirm(`Se enviarán ${validos.length} correos. ${sinCorreo.length} participantes serán omitidos por no tener correo. ¿Continuar?`);
  if (!ok) return;

  const btn = $("btnEnviarNominaInicialPagos");
  if (btn) btn.disabled = true;

  const batchId = `nomina_inicial_pagos_${state.groupId}_${Date.now()}`;
  let enviados = 0;

  try {
    for (const d of validos) {
      await addDoc(collection(db, "correos_nomina_inicial_pagos"), {
        batchId,
        estado: "pendiente",

        destinatario: d.correo,
        to: d.correo,
        asunto,
        subject: asunto,
        cuerpo,
        body: cuerpo,

        idGrupo: String(state.groupId || ""),
        groupDocId: String(state.groupDocId || ""),
        inscripcionId: d.inscripcionId,

        grupo:
          cleanText(state.group?.aliasGrupo) ||
          cleanText(state.group?.nombreGrupo) ||
          normalizeTextUpper(state.group?.colegio || ""),

        colegio: normalizeTextUpper(state.group?.colegio || ""),
        curso: normalizeTextUpper(state.group?.curso || ""),
        anoViaje: cleanText(state.group?.anoViaje || ""),
        documento: d.documento,
        nombreParticipante: d.nombreParticipante,
        nombreResponsable: d.nombreResponsable,

        creadoPor: getDisplayName(state.effectiveUser),
        creadoPorCorreo: state.effectiveEmail,
        creadoAt: serverTimestamp()
      });

      const inscRef = doc(
        db,
        "ventas_cotizaciones",
        String(state.groupDocId),
        "inscripciones",
        String(d.inscripcionId)
      );

      const esSistemaPagos = esInscripcionSistemaPagos(d.item);
      
      const patchCorreoPagos = esSistemaPagos
        ? {
            "sistemaPagos.correoPagosEnviado": true,
            "sistemaPagos.correoPagosEnviadoAt": serverTimestamp(),
            "sistemaPagos.correoPagosEnviadoPor": getDisplayName(state.effectiveUser),
            "sistemaPagos.correoPagosEnviadoPorCorreo": state.effectiveEmail,
            "sistemaPagos.correoPagosBatchId": batchId,
            "sistemaPagos.correoPagosDestinatario": d.correo
          }
        : {
            "sistemaPagos.nominaInicialCargada": true,
            "sistemaPagos.nominaInicialCargadaAt": serverTimestamp(),
            "sistemaPagos.nominaInicialCargadaPor": getDisplayName(state.effectiveUser),
            "sistemaPagos.nominaInicialCargadaPorCorreo": state.effectiveEmail,
            "sistemaPagos.correoPagosBatchId": batchId,
            "sistemaPagos.correoPagosDestinatario": d.correo
          };
      
      await updateDoc(inscRef, patchCorreoPagos);

      enviados += 1;
      setNominaPagosProgress(enviados, validos.length);
    }

    const correoVendedora = getCorreoVendedoraGrupoParaCopia();

    if (correoVendedora) {
      const ejemplo = validos[0];
    
      const resumenVendedora = `
    Se realizó el envío de correos de acceso al sistema de pagos.
    
    Grupo: ${state.group?.aliasGrupo || state.group?.nombreGrupo || state.group?.colegio || state.groupId}
    Vendedora: ${state.group?.vendedora || "—"}
    Total enviados: ${validos.length}
    Total sin correo: ${sinCorreo.length}
    
    Correos enviados:
    ${validos.map((d) => `- ${d.nombreParticipante || "Participante"} · ${d.correo}`).join("\n")}
    
    Participantes sin correo:
    ${sinCorreo.length
      ? sinCorreo.map((d) => `- ${d.nombreParticipante || "Participante"} · ${d.documento || "sin documento"}`).join("\n")
      : "- Ninguno"}
    
    ----------------------------------------
    EJEMPLO DEL CORREO ENVIADO A APODERADOS
    ----------------------------------------
    
    ${cuerpo}
    `.trim();
    
      await addDoc(collection(db, "correos_nomina_inicial_pagos"), {
        batchId,
        tipoCorreo: "resumen_vendedora",
        estado: "pendiente",
    
        destinatario: correoVendedora,
        to: correoVendedora,
    
        asunto: `Resumen envío pagos · ${state.group?.aliasGrupo || state.group?.colegio || state.groupId}`,
        subject: `Resumen envío pagos · ${state.group?.aliasGrupo || state.group?.colegio || state.groupId}`,
    
        cuerpo: resumenVendedora,
        body: resumenVendedora,
    
        idGrupo: String(state.groupId || ""),
        groupDocId: String(state.groupDocId || ""),
    
        grupo:
          cleanText(state.group?.aliasGrupo) ||
          cleanText(state.group?.nombreGrupo) ||
          normalizeTextUpper(state.group?.colegio || ""),
    
        colegio: normalizeTextUpper(state.group?.colegio || ""),
        curso: normalizeTextUpper(state.group?.curso || ""),
        anoViaje: cleanText(state.group?.anoViaje || ""),
    
        documento: ejemplo?.documento || "",
        nombreParticipante: ejemplo?.nombreParticipante || "",
        nombreResponsable: "Vendedora",
    
        totalCorreos: validos.length,
        totalSinCorreo: sinCorreo.length,
    
        creadoPor: getDisplayName(state.effectiveUser),
        creadoPorCorreo: state.effectiveEmail,
        creadoAt: serverTimestamp()
      });
    }

    await saveGroupPatch(
      {
        sistemaPagos: {
          ...(state.group?.sistemaPagos || {}),
          nominaInicial: {
            ...(state.group?.sistemaPagos?.nominaInicial || {}),
            cargada: true,
            cargadaAt: serverTimestamp(),
            cargadaPor: getDisplayName(state.effectiveUser),
            cargadaPorCorreo: state.effectiveEmail,
            batchId,
            totalInscripciones: destinatarios.length,
            totalCorreos: validos.length,
            totalSinCorreo: sinCorreo.length,
            asuntoUltimoEnvio: asunto
          }
        }
      },
      {
        tipoMovimiento: "nomina_inicial_cargada_pagos",
        modulo: "inscripcion",
        titulo: "Nómina inicial cargada en sistema de pagos",
        mensaje: `${getDisplayName(state.effectiveUser)} marcó la nómina inicial como cargada en sistema de pagos y generó ${validos.length} correo(s).`,
        metadata: {
          batchId,
          totalInscripciones: destinatarios.length,
          totalCorreos: validos.length,
          totalSinCorreo: sinCorreo.length
        }
      }
    );

    closeModal("modalNominaInicialPagos");
    showSaveNotice(`Nómina inicial marcada como cargada. Correos generados: ${validos.length}.`);
  } catch (error) {
    console.error("[grupo] enviarNominaInicialPagos", error);
    alert("Error al generar correos de nómina inicial: " + error.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

function renderGroup() {
  renderHero();
  renderSituacion();
  renderDatos();
  renderInscripcionPasajerosPanel();
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
  setText("heroColegio", normalizeTextUpper(state.group.colegio || "—"));
  setText("heroAnoViaje", state.group.anoViaje || "—");
  setText("heroVendedora", state.group.vendedora || state.group.vendedoraCorreo || "—");
  setText("heroIdGrupo", state.groupId);
  setText("heroComuna", normalizeTextUpper(state.group.comunaCiudad || "—"));

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

  const estado = normalizeState(state.group?.estado);
  const estadoMeta = ESTADO_META[estado] || ESTADO_META.a_contactar;

  const anoViajeNum = Number(state.group?.anoViaje || 0);
  const esLegacy2025 = anoViajeNum <= 2025;
  const flujoAbierto = !!state.group?.fichaFlujoAbierto;

  const tienePdf = !!cleanText(
    getByPath(state.group, "ficha.pdfUrl") ||
    state.group?.fichaPdfUrl ||
    ""
  );

  const autorizadaVisual = esLegacy2025
    ? !!state.group?.autorizada
    : (tienePdf && !flujoAbierto);

  const pdfVigente = tienePdf && !flujoAbierto;
  const pdfAnterior = tienePdf && flujoAbierto;

  const pagos = getEstadoNominaInicialPagos();

  box.innerHTML = `
    <span class="g-badge ${estadoMeta.css}">
      Estado: ${escapeHtml(estadoMeta.label)}
    </span>

    <span class="f-badge ${flujoAbierto ? "warn" : "ok"}">
      ${flujoAbierto ? "Ficha abierta" : "Ficha cerrada"}
    </span>

    <span class="f-badge ${autorizadaVisual ? "ok" : "warn"}">
      ${autorizadaVisual ? "Autorizada" : "No autorizada"}
    </span>

    <span class="f-badge ${pdfVigente ? "ok" : "warn"}">
      ${
        pdfVigente
          ? "PDF vigente"
          : pdfAnterior
            ? "PDF anterior"
            : "PDF pendiente"
      }
    </span>

    <span class="f-badge ${pagos.cargada ? "ok" : "warn"}">
      ${
        pagos.cargada
          ? `Pagos: nómina inicial cargada (${pagos.totalCorreos || 0} correos)`
          : "Pagos: nómina inicial pendiente"
      }
    </span>
  `;
}

function renderSituacion() {
  const fechaCambioEstado =
    state.group?.fechaUltimoCambioEstado ||
    getByPath(state.group, "situacion.fechaUltimoCambioEstado") ||
    null;

  const fechaCambioEstadoTxt = toDate(fechaCambioEstado)
    ? formatDateTime(fechaCambioEstado)
    : (stringValue(fechaCambioEstado) || "—");

  const estadoNormalizado = normalizeState(state.group?.estado);
  const isGanada = estadoNormalizado === "ganada";

  const anoViajeNum = Number(state.group?.anoViaje || 0);
  const esLegacy2025 = anoViajeNum <= 2025;
  const flujoAbierto = !!state.group?.fichaFlujoAbierto;

  const tienePdf = !!cleanText(
    getByPath(state.group, "ficha.pdfUrl") ||
    state.group?.fichaPdfUrl ||
    ""
  );

  const autorizadaVisual = esLegacy2025
    ? !!state.group?.autorizada
    : (tienePdf && !flujoAbierto);

  setText("situacionEstado", getEstadoLabel(state.group?.estado));
  setText("situacionAutorizacion", autorizadaVisual ? "Autorizada" : "No autorizada");
  setText("situacionCierre", flujoAbierto ? "Abierta" : "Cerrada");
  setText("situacionProximoPaso", getByPath(state.group, "situacion.proximoPaso") || "—");
  setText("situacionUltimoCambioEstado", fechaCambioEstadoTxt);

  const obsAdmin = sanitizeRichHtml(getSharedObsAdministracion(state.group)) || "—";
  const obsOps = sanitizeRichHtml(getSharedObsOperaciones(state.group)) || "—";

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

  const nombre1 = normalizeTextUpper(state.group.nombreCliente || "");
  const nombre2 = normalizeTextUpper(state.group.nombreCliente2 || "");
  const rol1 = normalizeTextUpper(state.group.rolCliente || "");
  const rol2 = normalizeTextUpper(state.group.rolCliente2 || "");

  const items = [
    {
      label: "1° Contacto",
      valueHtml: `
        <div class="contact-value-stack">
          <div class="contact-main-value">${escapeHtml(nombre1 || "—")}</div>
          ${rol1 ? `<div class="contact-role-chip">${escapeHtml(rol1)}</div>` : ""}
        </div>
      `
    },
    {
      label: "Correo 1° Contacto",
      valueHtml: buildEmailValueHtml(state.group.correoCliente, nombre1 || "1° CONTACTO")
    },
    {
      label: "Celular 1° Contacto",
      valueHtml: buildPhoneValueHtml(state.group.celularCliente)
    },

    {
      label: "2° Contacto",
      valueHtml: `
        <div class="contact-value-stack">
          <div class="contact-main-value">${escapeHtml(nombre2 || "—")}</div>
          ${rol2 ? `<div class="contact-role-chip">${escapeHtml(rol2)}</div>` : ""}
        </div>
      `
    },
    {
      label: "Correo 2° Contacto",
      valueHtml: buildEmailValueHtml(state.group.correoCliente2, nombre2 || "2° CONTACTO")
    },
    {
      label: "Celular 2° Contacto",
      valueHtml: buildPhoneValueHtml(state.group.celularCliente2)
    },

    {
      label: "Destino principal",
      valueHtml: escapeHtml(normalizeTextUpper(getDestinoPrincipalDisplay(state.group)) || "—"),
      full: true
    },
    {
      label: "Programa",
      valueHtml: escapeHtml(normalizeTextUpper(getProgramaDisplay(state.group)) || "—"),
      full: true
    },

    {
      label: "Mes de viaje",
      valueHtml: escapeHtml(normalizeTextUpper(getMesViajeDisplay(state.group)) || "—")
    },
    {
      label: "Cantidad grupo",
      valueHtml: escapeHtml(String(state.group.cantidadGrupo || "—"))
    },
    {
      label: "Tramo",
      valueHtml: escapeHtml(normalizeTextUpper(getTramoDisplay(state.group)) || "—")
    }
  ];

  grid.className = "grupo-data-card-grid";

  grid.innerHTML = items.map((item) => `
    <div class="grupo-data-card ${item.full ? "full is-strong" : ""}">
      <div class="info-label">${escapeHtml(item.label)}</div>
      <div class="info-value contact-info-value">${item.valueHtml || "—"}</div>
    </div>
  `).join("");
}

function renderDocs() {
  const docsChips = $("docsChips");
  const flowSteps = $("flowSteps");

  if (docsChips) {
    const fichaPdfUrl = getFichaDocumentoPdfUrl(state.group);
    const fichaDocumentoEstado = resolveFichaDocumentoEstado(state.group);

    docsChips.innerHTML = `
      ${renderDocChip("fichaMedicaEstado", state.group.fichaMedicaEstado)}
      ${renderDocChip("nominaEstado", state.group.nominaEstado)}
      ${renderDocChip("fichaEstado", fichaDocumentoEstado, { href: fichaPdfUrl })}
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

  list.innerHTML = state.meetings.map((meeting, index) => `
    <div class="list-card">
      <div class="list-card-top">
        <div>
          <div class="list-card-title">
            ${escapeHtml(meeting.titulo || `Reunión ${state.meetings.length - index}`)}
          </div>

          <div class="list-card-meta">
${escapeHtml(formatDateTime(meeting.fechaInicio))}
${escapeHtml(capitalize(meeting.tipo || "reunión"))} · ${escapeHtml(meeting.estadoReunion || "agendada")}
${escapeHtml(meetingPlaceLabel(meeting))}
          </div>
        </div>

        <div class="registro-card-actions">
          <div class="doc-chip ${docStateClass(
            meeting.estadoReunion === "cancelada"
              ? "no_aplica"
              : meeting.estadoReunion === "realizada"
                ? "ok"
                : "pendiente"
          )}">
            ${escapeHtml(capitalize(meeting.estadoReunion || "agendada"))}
          </div>

          <button
            class="btn-pill"
            type="button"
            data-action="edit-meeting"
            data-id="${escapeHtml(meeting.id)}"
          >
            Editar
          </button>

          ${
            normalizeSearchLocal(meeting.estadoReunion || "") !== "realizada"
              ? `
                <button
                  class="btn-dark"
                  type="button"
                  data-action="complete-meeting"
                  data-id="${escapeHtml(meeting.id)}"
                >
                  Marcar realizada
                </button>
              `
              : ""
          }
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

function buildDuplicateReviewHtml(item = {}) {
  const alertas = Array.isArray(item?.metadata?.alertas)
    ? item.metadata.alertas
    : [];

  if (!alertas.length) return "";

  const rows = alertas.map((a, index) => {
    const reasons = Array.isArray(a.reasons) ? a.reasons : [];

    return `
      <li>
        <strong>${index + 1}. ID ${escapeHtml(a.relatedIdGrupo || "—")}</strong>
        · ${escapeHtml(a.aliasGrupo || "Grupo sin alias")}
        <br>
        Colegio: ${escapeHtml(a.colegio || "—")}
        · Curso: ${escapeHtml(a.curso || "—")}
        · Año: ${escapeHtml(a.anoViaje || "—")}
        · Comuna: ${escapeHtml(a.comunaCiudad || "—")}
        <br>
        Vendedora: ${escapeHtml(a.vendedora || "Sin asignar")}
        · Estado: ${escapeHtml(a.estado || "—")}
        · Nivel: ${escapeHtml(a.level || "—")}
        · Puntaje: ${escapeHtml(a.score ?? "—")}
        ${
          reasons.length
            ? `<br><em>Razones:</em> ${reasons.map(r => escapeHtml(r)).join(" · ")}`
            : ""
        }
      </li>
    `;
  }).join("");

  return `
    <div class="registro-detail-block">
      <div class="registro-detail-label">Coincidencias revisadas</div>
      <ul class="registro-detail-list">${rows}</ul>
    </div>
  `;
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

    const duplicateReviewHtml = buildDuplicateReviewHtml(item);
    
    const hasLongMessage = fullMessage.length > 220;
    const hasDetails = hasLongMessage || cambiosDetallados.length > 0 || !!duplicateReviewHtml;

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
                ${duplicateReviewHtml}
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

function ensureBotonCorreosInscripcion() {
  if ($("btnCorreosInscripcion")) return;

  const btnCerrar = $("btnCerrarInscripcion");
  if (!btnCerrar || !btnCerrar.parentElement) return;

  const btn = document.createElement("button");
  btn.id = "btnCorreosInscripcion";
  btn.type = "button";
  btn.className = "btn-pill";
  btn.textContent = "Correos";

  btnCerrar.insertAdjacentElement("afterend", btn);
}

function syncButtons() {
  ensureBotonCorreosInscripcion();
  const editable = canEditGroup();
  const isGanada = normalizeState(state.group.estado) === "ganada";
  const autorizada = !!state.group.autorizada;
  const ficha = getFichaSummary();

  const canAlertsComments = canCreateAlertsAndComments();

  [
    "btnEditarDatosHero",
    "btnEditarDatos"
  ].forEach((id) => {
    const el = $(id);
    if (el) el.disabled = !editable;
  });

  [
    "btnNuevaReunionHero",
    "btnNuevaReunion",
    "btnNuevaReunionListado"
  ].forEach((id) => {
    const el = $(id);
    if (el) el.disabled = !canManageMeetings();
  });

  [
    "btnEditarSituacionHero",
    "btnEditarSituacion"
  ].forEach((id) => {
    const el = $(id);
    if (el) el.disabled = !canEditSituacionGrupo();
  });

  [
    "btnNuevaAlertaHero",
    "btnNuevaAlerta",
    "btnNuevoComentario"
  ].forEach((id) => {
    const el = $(id);
    if (el) el.disabled = !canAlertsComments;
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

  const btnHabilitarInscripcion = $("btnHabilitarInscripcion");
  const btnCerrarInscripcion = $("btnCerrarInscripcion");
  const btnAbrirNuevosInscritos = $("btnAbrirNuevosInscritos");
  const btnAbrirListaEspera = $("btnAbrirListaEspera");
  const btnCrearLinkLiberados = $("btnCrearLinkLiberados");
  const btnCopiarLinkInscripcion = $("btnCopiarLinkInscripcion");
  const btnExportarInscripcionesExcel = $("btnExportarInscripcionesExcel");
  const btnExportarInscripcionesCsv = $("btnExportarInscripcionesCsv");
  const btnResetearCicloInscripcion = $("btnResetearCicloInscripcion");
  const btnEditarNominaInscripcion = $("btnEditarNominaInscripcion");
  const btnNominaInicialPagos = $("btnNominaInicialPagos");
  const btnCorreosInscripcion = $("btnCorreosInscripcion");

  const puedeInicial = canGestionarInscripcionInicial();
  const puedeNominaFinal = canGestionarNominaFinal();
  const puedeNuevos = canGestionarNuevosIngresos();
  const puedeListaEspera = canGestionarListaEspera();
  const puedeLiberados = canGestionarLiberados();

  const inscripcionYaHabilitada = !!state.group?.inscripcionHabilitada;
  const tieneInscripciones = state.inscripciones.length > 0;

  const labelActivo =
    state.group?.inscripcion?.labelActual ||
    getInscripcionFaseLabel(getInscripcionEstadoActual());

  if (btnHabilitarInscripcion) {
    if (grupoVieneSistemaAntiguo()) {
      btnHabilitarInscripcion.textContent = puedeReabrirFasePasada() && nominaFinalYaCerrada()
        ? "Reabrir nómina final / ficha médica"
        : "Abrir nómina final / ficha médica";

      btnHabilitarInscripcion.disabled = !puedeNominaFinal;
    } else {
      btnHabilitarInscripcion.textContent = puedeReabrirFasePasada() && inscripcionInicialYaCerrada()
        ? "Reabrir inscripción inicial"
        : "Abrir inscripción inicial";

      btnHabilitarInscripcion.disabled = !puedeInicial;
    }
  }

  if (btnCopiarLinkInscripcion) {
    btnCopiarLinkInscripcion.disabled = !inscripcionYaHabilitada;
    btnCopiarLinkInscripcion.textContent = inscripcionYaHabilitada
      ? "Copiar link activo"
      : "Sin link activo";
  }

  if (btnCerrarInscripcion) {
    btnCerrarInscripcion.disabled = !inscripcionYaHabilitada || !puedeAbrirCerrarFasesInscripcion();
    btnCerrarInscripcion.textContent = inscripcionYaHabilitada
      ? `Cerrar ${labelActivo}`
      : "Cerrar inscripción";
  }

  if (btnCorreosInscripcion) {
    const puedeCorreo = canAccessGroup(state.group);
    btnCorreosInscripcion.disabled = !puedeCorreo || !tieneInscripciones;
    btnCorreosInscripcion.classList.toggle("hidden", !puedeCorreo);
  }

  if (btnAbrirNuevosInscritos) {
    btnAbrirNuevosInscritos.disabled = !puedeNuevos;

    if (!inscripcionPrincipalEstaCerrada()) {
      btnAbrirNuevosInscritos.textContent = "Nuevos ingresos (cerrar link activo primero)";
    } else if (!correspondeNuevosIngresosPorFecha()) {
      btnAbrirNuevosInscritos.textContent = "Nuevos ingresos no corresponde por fecha";
    } else {
      btnAbrirNuevosInscritos.textContent = "Abrir nuevos ingresos";
    }
  }

  if (btnAbrirListaEspera) {
    btnAbrirListaEspera.disabled = !puedeListaEspera;

    if (!inscripcionPrincipalEstaCerrada()) {
      btnAbrirListaEspera.textContent = "Lista de espera (cerrar link activo primero)";
    } else if (!correspondeListaEsperaPorFecha()) {
      btnAbrirListaEspera.textContent = "Lista de espera aún no corresponde";
    } else {
      btnAbrirListaEspera.textContent = "Abrir lista de espera";
    }
  }

  if (btnCrearLinkLiberados) {
    btnCrearLinkLiberados.disabled = !puedeLiberados;
    btnCrearLinkLiberados.textContent = state.group?.linkLiberadosActivo
      ? "Regenerar link liberados"
      : "Crear link liberados";
  }

  if (btnExportarInscripcionesExcel) {
    btnExportarInscripcionesExcel.disabled = !tieneInscripciones;
  }

  if (btnExportarInscripcionesCsv) {
    const puedeCsv = puedeExportarCsvInscripciones();

    btnExportarInscripcionesCsv.disabled = !tieneInscripciones || !puedeCsv;
    btnExportarInscripcionesCsv.classList.toggle("hidden", !puedeCsv);
  }

  if (btnResetearCicloInscripcion) {
    const puedeReset = canResetearCicloInscripcion();
  
    btnResetearCicloInscripcion.classList.toggle("hidden", !puedeReset);
    btnResetearCicloInscripcion.disabled = !puedeReset;
  }

  if (btnEditarNominaInscripcion) {
    const puedeEditarNomina = canEditarNominaInscripcion();
  
    btnEditarNominaInscripcion.classList.toggle("hidden", !puedeEditarNomina);
    btnEditarNominaInscripcion.disabled = !puedeEditarNomina || !tieneInscripciones;
  }

  if (btnNominaInicialPagos) {
    const puedeGestionarPagos = puedeOperarListaEsperaAdministrativa();
  
    btnNominaInicialPagos.classList.toggle("hidden", !puedeGestionarPagos);
    btnNominaInicialPagos.disabled = !puedeGestionarPagos;
  
    const estadoPagos = getEstadoNominaInicialPagos();
  
    btnNominaInicialPagos.textContent = estadoPagos.cargada
      ? "Reenviar aviso / actualizar carga pagos"
      : "Cargado a Pagos";
  }
  
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
function getOpenFichaUpdateRequestsForGroup() {
  return state.requests.filter((item) => {
    const tipo = normalizeSearchLocal(item.tipoSolicitud || "");
    const estado = normalizeSearchLocal(item.estadoSolicitud || "");

    return tipo === "actualizacion_ficha" &&
      item.resuelta !== true &&
      estado !== "completada" &&
      estado !== "cerrada";
  });
}

function getSolicitudFichaEstadoLabel(item = {}) {
  const estado = normalizeSearchLocal(item.estadoSolicitud || "");

  if (estado === "pendiente") return "Pendiente revisión jefa de ventas";
  if (estado === "revisada_jefa") return "Revisada por jefa / pendiente Administración";
  if (estado === "completada") return "Cerrada por Administración";

  return item.estadoSolicitud || "Sin estado";
}

function buildSolicitudFichaMensaje(item = {}) {
  return [
    `Estado: ${getSolicitudFichaEstadoLabel(item)}.`,
    item.solicitadoPor ? `Solicitado por: ${item.solicitadoPor}.` : "",
    item.detalle ? `Motivo vendedor: ${item.detalle}` : "Motivo vendedor: sin detalle registrado.",
    item.respuestaJefa ? `Respuesta jefa: ${item.respuestaJefa}` : "",
    item.respuestaAdministracion ? `Cierre administración: ${item.respuestaAdministracion}` : ""
  ].filter(Boolean).join("\n");
}

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

  const openFichaRequests = getOpenFichaUpdateRequestsForGroup();
  
  openFichaRequests.forEach((item, index) => {
    const estado = normalizeSearchLocal(item.estadoSolicitud || "");
  
    list.push({
      id: `auto-request-${state.groupId}-${item.id || index}`,
      nivel: estado === "pendiente" || estado === "revisada_jefa" ? "warning" : "info",
      titulo: "Solicitud de actualización de ficha",
      mensaje: buildSolicitudFichaMensaje(item)
    });
  });

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

window.repararHistorialSolicitudesFicha = async function () {
  if (!state.canSeeAll) {
    alert("Solo administración/supervisión puede reparar historial.");
    return;
  }

  const solicitudes = state.requests.filter((item) =>
    normalizeSearchLocal(item.tipoSolicitud || "") === "actualizacion_ficha"
  );

  if (!solicitudes.length) {
    console.log("No hay solicitudes de actualización para reconstruir.");
    return;
  }

  let creadas = 0;

  for (const sol of solicitudes) {
    const yaExiste = state.history.some((h) =>
      normalizeSearchLocal(h.tipoMovimiento || "") === "solicitud_actualizacion_ficha" &&
      normalizeSearchLocal(h?.metadata?.solicitudId || "") === normalizeSearchLocal(sol.id || "")
    );

    if (yaExiste) continue;

    await addDoc(collection(db, HISTORIAL_COLLECTION), {
      idGrupo: String(state.groupId),
      codigoRegistro: cleanText(state.group?.codigoRegistro),
      aliasGrupo: cleanText(state.group?.aliasGrupo),
      colegio: cleanText(state.group?.colegio),

      tipoMovimiento: "solicitud_actualizacion_ficha",
      modulo: "ficha",
      titulo: "Solicitud de actualización de ficha",
      asunto: cleanText(sol.asunto || "Solicitud de actualización"),
      mensaje: `${sol.solicitadoPor || "Vendedor(a)"} solicitó actualización de la ficha. Motivo: ${sol.detalle || "Sin detalle registrado"}`,

      metadata: {
        solicitudId: sol.id,
        detalleSolicitud: sol.detalle || "",
        reconstruido: true
      },

      destacado: false,
      oculto: false,

      creadoPor: "Sistema",
      creadoPorCorreo: state.effectiveEmail,
      fecha: sol.fechaSolicitud || serverTimestamp()
    });

    await setDoc(doc(db, SOLICITUDES_COLLECTION, sol.id), {
      historialReconstruido: true,
      fechaReconstruccionHistorial: serverTimestamp()
    }, { merge: true });

    creadas++;
  }

  await loadAll();
  console.log(`Historial reconstruido. Entradas creadas: ${creadas}`);
};

/* =========================================================
   CONSOLA · TRACKING FORMULARIO INSCRIPCIÓN
========================================================= */

async function cargarSesionesTrackingInscripcionGrupo(idGrupoManual = "") {
  const idsBuscar = [
    cleanText(idGrupoManual),
    cleanText(state.groupId),
    cleanText(state.groupDocId),
    cleanText(state.requestedId)
  ].filter(Boolean);

  const idsUnicos = [...new Set(idsBuscar)];
  const docsMap = new Map();

  for (const id of idsUnicos) {
    const snap = await getDocs(
      query(
        collection(db, "inscripciones_sesiones_publicas"),
        where("idGrupo", "==", String(id))
      )
    );

    snap.docs.forEach((d) => {
      docsMap.set(d.id, {
        id: d.id,
        ...d.data()
      });
    });
  }

  return [...docsMap.values()];
}

function trackingToDate(value) {
  if (!value) return null;

  if (value?.toDate) return value.toDate();

  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function trackingMinutosEntre(inicio, fin) {
  const a = trackingToDate(inicio);
  const b = trackingToDate(fin);

  if (!a || !b) return null;

  return Math.round(((b.getTime() - a.getTime()) / 60000) * 10) / 10;
}

function trackingFechaTexto(value) {
  const d = trackingToDate(value);
  if (!d) return "—";

  return d.toLocaleString("es-CL", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function trackingPersonaKey(item = {}) {
  const persona = item.persona || {};

  const doc = cleanText(persona.documentoNormalizado || "");
  const correo = normalizeEmail(persona.correo || "");
  const nombre = normalizeSearchLocal(persona.nombreCompleto || "");

  if (doc) return `doc:${doc}`;
  if (correo) return `correo:${correo}`;
  if (nombre) return `nombre:${nombre}`;

  return `sesion:${item.id}`;
}

function trackingPersonaLabel(item = {}) {
  const persona = item.persona || {};

  return (
    cleanText(persona.nombreCompleto) ||
    normalizeEmail(persona.correo || "") ||
    cleanText(persona.documentoNormalizado) ||
    "Sin identificar"
  );
}

function trackingConstruirDetalle(sesiones = []) {
  return sesiones
    .map((item) => {
      const persona = item.persona || {};

      const abierto =
        item.abiertoEnCliente ||
        item.creadoEn ||
        item.creadoAt ||
        "";

      const enviado =
        item.enviadoEnCliente ||
        item.enviadoEn ||
        "";

      const actualizado =
        item.actualizadoEn ||
        item.actualizadoAt ||
        "";

      const enviadoBool = item.enviado === true || cleanText(item.estado) === "enviada";

      const minutosCompletar = enviadoBool
        ? trackingMinutosEntre(abierto, enviado || actualizado)
        : null;

      const minutosDesdeApertura = !enviadoBool
        ? trackingMinutosEntre(abierto, new Date())
        : null;

      return {
        sesionId: item.id,
        personaKey: trackingPersonaKey(item),
        persona: trackingPersonaLabel(item),
        documento: cleanText(persona.documentoNormalizado || ""),
        correo: normalizeEmail(persona.correo || ""),
        telefono: cleanText(persona.telefono || ""),
        tipoViajante: cleanText(persona.tipoViajante || ""),

        fase: cleanText(item.fase || ""),
        tipoInscripcion: cleanText(item.tipoInscripcion || ""),
        estado: cleanText(item.estado || ""),
        enviado: enviadoBool ? "Sí" : "No",
        avancePct: Number(item.avancePct || 0),
        avanceTramo: cleanText(item.avanceTramo || "0"),
        ultimoEvento: cleanText(item.ultimoEvento || ""),

        abierto: trackingFechaTexto(abierto),
        actualizado: trackingFechaTexto(actualizado),
        enviadoEn: trackingFechaTexto(enviado),

        minutosCompletar,
        minutosDesdeApertura
      };
    })
    .sort((a, b) => {
      if (a.enviado !== b.enviado) return a.enviado === "Sí" ? -1 : 1;
      return Number(b.avancePct || 0) - Number(a.avancePct || 0);
    });
}

function trackingConstruirResumen(detalle = []) {
  const totalSesiones = detalle.length;
  const enviadas = detalle.filter((x) => x.enviado === "Sí");
  const noEnviadas = detalle.filter((x) => x.enviado !== "Sí");

  const comenzaron = detalle.filter((x) =>
    Number(x.avancePct || 0) > 0 ||
    ["formulario_comenzado", "avance_formulario", "formulario_enviado"].includes(x.ultimoEvento)
  );

  const quedaronEnProceso = noEnviadas.filter((x) => Number(x.avancePct || 0) > 0);
  const abandonaronSinComenzar = noEnviadas.filter((x) => Number(x.avancePct || 0) === 0);

  const demoras = enviadas
    .map((x) => Number(x.minutosCompletar))
    .filter((n) => Number.isFinite(n));

  const promedioMinutos = demoras.length
    ? Math.round((demoras.reduce((a, b) => a + b, 0) / demoras.length) * 10) / 10
    : 0;

  const porPersonaMap = new Map();

  detalle.forEach((item) => {
    const key = item.personaKey;

    if (!porPersonaMap.has(key)) {
      porPersonaMap.set(key, {
        persona: item.persona,
        documento: item.documento,
        correo: item.correo,
        sesiones: 0,
        enviosCompletos: 0,
        intentosPendientes: 0,
        mejorAvancePendiente: 0,
        demoraUltimoEnvioMin: "",
        ultimoEstado: ""
      });
    }

    const acc = porPersonaMap.get(key);

    acc.sesiones += 1;

    if (item.enviado === "Sí") {
      acc.enviosCompletos += 1;
      acc.demoraUltimoEnvioMin = item.minutosCompletar ?? "";
    } else {
      acc.intentosPendientes += 1;
      acc.mejorAvancePendiente = Math.max(acc.mejorAvancePendiente, Number(item.avancePct || 0));
    }

    acc.ultimoEstado = item.enviado === "Sí"
      ? "enviada"
      : Number(item.avancePct || 0) > 0
        ? "en proceso / abandonada"
        : "abierta sin comenzar";
  });

  const porPersona = [...porPersonaMap.values()]
    .sort((a, b) => b.intentosPendientes - a.intentosPendientes || b.sesiones - a.sesiones);

  const resumen = {
    grupo: String(state.groupId || state.requestedId || ""),
    totalSesiones,
    personasDetectadas: porPersona.length,
    abrieron: totalSesiones,
    comenzaron: comenzaron.length,
    enviaron: enviadas.length,
    quedaronEnProceso: quedaronEnProceso.length,
    abandonaronSinComenzar: abandonaronSinComenzar.length,
    promedioDemoraEnvioMin: promedioMinutos,
    tasaEnvio: totalSesiones ? `${Math.round((enviadas.length / totalSesiones) * 100)}%` : "0%"
  };

  return {
    resumen,
    porPersona
  };
}

window.resumenTrackingInscripcionGrupo = async function (idGrupoManual = "") {
  const sesiones = await cargarSesionesTrackingInscripcionGrupo(idGrupoManual);
  const detalle = trackingConstruirDetalle(sesiones);
  const { resumen, porPersona } = trackingConstruirResumen(detalle);

  console.log("RESUMEN TRACKING INSCRIPCIÓN");
  console.table([resumen]);

  console.log("RESUMEN POR PERSONA");
  console.table(porPersona);

  return {
    resumen,
    porPersona,
    detalle
  };
};

window.detalleTrackingInscripcionGrupo = async function (idGrupoManual = "") {
  const sesiones = await cargarSesionesTrackingInscripcionGrupo(idGrupoManual);
  const detalle = trackingConstruirDetalle(sesiones);

  console.log("DETALLE TRACKING INSCRIPCIÓN");
  console.table(detalle);

  return detalle;
};

window.trackingPersonaInscripcionGrupo = async function (busqueda = "", idGrupoManual = "") {
  const texto = normalizeSearchLocal(busqueda);

  if (!texto) {
    console.warn("Debes buscar por nombre, correo, documento o parte del teléfono.");
    return [];
  }

  const sesiones = await cargarSesionesTrackingInscripcionGrupo(idGrupoManual);
  const detalle = trackingConstruirDetalle(sesiones);

  const filtrado = detalle.filter((item) => {
    const universo = normalizeSearchLocal([
      item.persona,
      item.documento,
      item.correo,
      item.telefono,
      item.tipoViajante,
      item.estado,
      item.ultimoEvento
    ].join(" "));

    return universo.includes(texto);
  });

  console.log(`TRACKING PERSONA: ${busqueda}`);
  console.table(filtrado);

  return filtrado;
};

function getTipoInscripcionEditableOptions() {
  return [
    { value: "sistema_pagos", label: "Sistema de Pagos" },
    { value: "nomina_inicial", label: "Inscripción inicial" },
    { value: "nomina_final", label: "Nómina final / ficha médica" },
    { value: "nuevo_ingreso", label: "Nuevo ingreso" },
    { value: "lista_espera", label: "Lista de espera" },
    { value: "lista_espera_pagada", label: "Lista de espera pagada" },
    { value: "lista_espera_confirmada", label: "Lista de espera confirmada" },
    { value: "liberado", label: "Cupo liberado" }
  ];
}

function getTipoPasajeroEditableOptions() {
  return [
    { value: "estudiante", label: "Estudiante" },
    { value: "adulto_acompanante", label: "Adulto(a) acompañante" },
    { value: "profesor", label: "Profesor(a)" }
  ];
}

function getGeneroEditableOptions() {
  return [
    { value: "masculino", label: "Masculino" },
    { value: "femenino", label: "Femenino" },
    { value: "otro", label: "Otro" }
  ];
}

function optionHtml(options = [], selected = "") {
  const selectedKey = normalizeSearchLocal(selected || "");

  return options.map((opt) => {
    const optKey = normalizeSearchLocal(opt.value || "");
    return `
      <option value="${escapeHtml(opt.value)}" ${optKey === selectedKey ? "selected" : ""}>
        ${escapeHtml(opt.label)}
      </option>
    `;
  }).join("");
}

function openEditarNominaInscripcionModal() {
  if (!canEditarNominaInscripcion()) {
    alert("No tienes permisos para editar la nómina.");
    return;
  }

  renderEditarNominaInscripcionModal();
  openModal("modalEditarNominaInscripcion");
}

function renderEditarNominaInscripcionModal() {
  const tbody = $("editarNominaBody");
  if (!tbody) return;

  const puedeEditarRutTipo = canEditarRutYTipoInscripcionNomina();

  tbody.innerHTML = state.inscripciones.map((item, index) => {
    const tipoReal = getInscripcionTipoReal(item);
    const tipoPasajero = item.tipoViajante || item.tipoParticipacion || "";
    const genero = getByPath(item, "identificacion.genero") || getByPath(item, "documentoIdentidad.sexoDocumento") || "";

    return `
      <tr data-inscripcion-edit-row="${escapeHtml(item.id)}">
        <td>${index + 1}</td>

        <td>
          <select data-field="tipoInscripcion" ${puedeEditarRutTipo ? "" : "disabled"}>
            ${optionHtml(getTipoInscripcionEditableOptions(), tipoReal)}
          </select>
        </td>

        <td>
          <input data-field="documento" value="${escapeHtml(getInscripcionDocumento(item))}" ${puedeEditarRutTipo ? "" : "disabled"} />
        </td>

        <td>
          <input data-field="apellidos" value="${escapeHtml(getInscripcionApellidos(item))}" />
        </td>

        <td>
          <input data-field="nombres" value="${escapeHtml(getInscripcionNombres(item))}" />
        </td>

        <td>
          <input data-field="fechaNacimiento" type="date" value="${escapeHtml(getFechaNacimientoInputValue(item))}" />
        </td>

        <td>
          <select data-field="tipoViajante">
            ${optionHtml(getTipoPasajeroEditableOptions(), tipoPasajero)}
          </select>
        </td>

        <td>
          <input data-field="nacionalidad" value="${escapeHtml(getInscripcionNacionalidad(item))}" />
        </td>

        <td>
          <select data-field="genero">
            ${optionHtml(getGeneroEditableOptions(), genero)}
          </select>
        </td>

        <td>
          <input data-field="responsable" value="${escapeHtml(getResponsablePrincipalNombre(item))}" />
        </td>

        <td>
          <input data-field="correoResponsable" value="${escapeHtml(getByPath(item, "contactoPrincipal.correo") || "")}" />
        </td>

        <td>
          <input data-field="celularResponsable" value="${escapeHtml(getByPath(item, "contactoPrincipal.celular") || getByPath(item, "contactoPrincipal.telefono") || getByPath(item, "contactoPrincipal.whatsapp") || "")}" />
        </td>

        <td>
          <button class="btn-ok" type="button" data-action="guardar-nomina-inscripcion" data-id="${escapeHtml(item.id)}">
            Guardar
          </button>
          <button class="btn-danger" type="button" data-action="archivar-nomina-inscripcion" data-id="${escapeHtml(item.id)}">
            Archivar
          </button>
        </td>
      </tr>
    `;
  }).join("");
}

function getFechaNacimientoInputValue(item = {}) {
  const raw = getByPath(item, "identificacion.fechaNacimiento") || "";
  if (!raw) return "";

  if (typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  if (typeof raw === "string" && /^\d{2}-\d{2}-\d{4}$/.test(raw)) {
    const [dd, mm, yyyy] = raw.split("-");
    return `${yyyy}-${mm}-${dd}`;
  }

  const d = toDate(raw);
  if (!d) return "";

  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");

  return `${yyyy}-${mm}-${dd}`;
}

function splitApellidosNomina(value = "") {
  const partes = cleanText(value || "").split(/\s+/).filter(Boolean);

  return {
    primerApellido: partes[0] || "",
    segundoApellido: partes.slice(1).join(" ")
  };
}

function buildNominaEditPatch(item = {}, values = {}) {
  const patch = {};
  const cambios = [];
  const puedeEditarRutTipo = canEditarRutYTipoInscripcionNomina();

  const addChange = (campo, anterior, nuevo) => {
    if (sameValue(anterior, nuevo)) return;
    setNestedValue(patch, campo, nuevo);
    cambios.push({ campo, anterior, nuevo });
  };

  const changed = (anterior, nuevo) => !sameValue(anterior || "", nuevo || "");

  const apellidosActual = getInscripcionApellidos(item);
  const nombresActual = getInscripcionNombres(item);
  const fechaActual = getFechaNacimientoInputValue(item);
  const tipoViajanteActual = item.tipoViajante || item.tipoParticipacion || "";
  const nacionalidadActual = getInscripcionNacionalidad(item);
  const generoActual =
    getByPath(item, "identificacion.genero") ||
    getByPath(item, "documentoIdentidad.sexoDocumento") ||
    "";
  const responsableActual = getResponsablePrincipalNombre(item);
  const correoActual = getByPath(item, "contactoPrincipal.correo") || "";
  const celularActual =
    getByPath(item, "contactoPrincipal.celular") ||
    getByPath(item, "contactoPrincipal.telefono") ||
    getByPath(item, "contactoPrincipal.whatsapp") ||
    "";

  if (changed(apellidosActual, values.apellidos)) {
    const apellidos = splitApellidosNomina(values.apellidos);
    addChange("identificacion.primerApellido", getByPath(item, "identificacion.primerApellido") || "", normalizeTextUpper(apellidos.primerApellido));
    addChange("identificacion.segundoApellido", getByPath(item, "identificacion.segundoApellido") || "", normalizeTextUpper(apellidos.segundoApellido));
  }

  if (changed(nombresActual, values.nombres)) {
    addChange("identificacion.nombres", getByPath(item, "identificacion.nombres") || "", normalizeTextUpper(values.nombres || ""));
  }

  if (changed(fechaActual, values.fechaNacimiento)) {
    addChange("identificacion.fechaNacimiento", getByPath(item, "identificacion.fechaNacimiento") || "", values.fechaNacimiento || "");
  }

  if (changed(tipoViajanteActual, values.tipoViajante)) {
    addChange("tipoViajante", item.tipoViajante || "", values.tipoViajante || "");
    addChange("tipoParticipacion", item.tipoParticipacion || "", values.tipoViajante || "");
  }

  if (changed(nacionalidadActual, values.nacionalidad)) {
    addChange("identificacion.nacionalidad", getByPath(item, "identificacion.nacionalidad") || "", normalizarTextoExport(values.nacionalidad || ""));
  }

  if (changed(generoActual, values.genero)) {
    addChange("identificacion.genero", getByPath(item, "identificacion.genero") || "", values.genero || "");
    addChange("documentoIdentidad.sexoDocumento", getByPath(item, "documentoIdentidad.sexoDocumento") || "", values.genero || "");
  }

  if (changed(responsableActual, values.responsable)) {
    addChange("contactoPrincipal.nombre", getByPath(item, "contactoPrincipal.nombre") || "", normalizeTextUpper(values.responsable || ""));
  }

  if (changed(correoActual, values.correoResponsable)) {
    addChange("contactoPrincipal.correo", getByPath(item, "contactoPrincipal.correo") || "", normalizeEmail(values.correoResponsable || ""));
  }

  if (changed(celularActual, values.celularResponsable)) {
    addChange("contactoPrincipal.celular", getByPath(item, "contactoPrincipal.celular") || "", cleanText(values.celularResponsable || ""));
  }

  if (puedeEditarRutTipo) {
    const documentoActual = getInscripcionDocumento(item);
    const documentoNuevo = cleanText(values.documento || "");

    if (changed(documentoActual, documentoNuevo)) {
      addChange("identificacion.documento", getByPath(item, "identificacion.documento") || "", documentoNuevo);
      addChange("identificacion.rutCompleto", getByPath(item, "identificacion.rutCompleto") || "", documentoNuevo);
    }

    const tipoActualPantalla = getInscripcionTipoReal(item);
    const tipoNuevo = values.tipoInscripcion || "";

    if (changed(tipoActualPantalla, tipoNuevo)) {
      addChange("tipoInscripcion", item.tipoInscripcion || "", tipoNuevo);
      addChange("faseInscripcion", item.faseInscripcion || "", getFaseDesdeTipoInscripcionEditable(tipoNuevo));
      addChange("estadoCupo", item.estadoCupo || "", getEstadoCupoDesdeTipoInscripcionEditable(tipoNuevo));
    }
  }

  return { patch, cambios };
}

function getFaseDesdeTipoInscripcionEditable(tipo = "") {
  const key = normalizeSearchLocal(tipo);

  if (key === "nomina_final") return "nomina_final";
  if (key === "nuevo_ingreso") return "nuevos";
  if (key === "lista_espera" || key === "lista_espera_pagada" || key === "lista_espera_confirmada") return "lista_espera";
  if (key === "liberado") return "liberado";

  return "normal";
}

function getEstadoCupoDesdeTipoInscripcionEditable(tipo = "") {
  const key = normalizeSearchLocal(tipo);

  if (key === "lista_espera_pagada") return "pagado";
  if (key === "lista_espera_confirmada") return "confirmado";
  if (key === "nuevo_ingreso") return "pendiente_confirmacion";

  return "confirmado";
}

function getNominaEditValuesFromRow(row) {
  const get = (field) => row.querySelector(`[data-field="${field}"]`)?.value || "";

  return {
    tipoInscripcion: get("tipoInscripcion"),
    documento: get("documento"),
    apellidos: get("apellidos"),
    nombres: get("nombres"),
    fechaNacimiento: get("fechaNacimiento"),
    tipoViajante: get("tipoViajante"),
    nacionalidad: get("nacionalidad"),
    genero: get("genero"),
    responsable: get("responsable"),
    correoResponsable: get("correoResponsable"),
    celularResponsable: get("celularResponsable")
  };
}

async function guardarNominaInscripcion(inscripcionId = "") {
  if (!canEditarNominaInscripcion()) {
    alert("No tienes permisos para editar la nómina.");
    return;
  }

  const item = state.inscripciones.find((x) => x.id === inscripcionId);
  if (!item) {
    alert("No se encontró la inscripción.");
    return;
  }

  const row = document.querySelector(`[data-inscripcion-edit-row="${CSS.escape(inscripcionId)}"]`);
  if (!row) return;

  const values = getNominaEditValuesFromRow(row);
  const { patch, cambios } = buildNominaEditPatch(item, values);

  if (!cambios.length) {
    showSaveNotice("No hay cambios para guardar.");
    return;
  }

  const ref = doc(
    db,
    "ventas_cotizaciones",
    String(state.groupDocId),
    "inscripciones",
    String(inscripcionId)
  );

  await updateDoc(ref, {
    ...patch,
    actualizadoPor: getDisplayName(state.effectiveUser),
    actualizadoPorCorreo: state.effectiveEmail,
    actualizadoAt: serverTimestamp()
  });

  await createHistoryEntry({
    tipoMovimiento: "edicion_nomina_inscripcion",
    modulo: "inscripcion",
    titulo: "Edición de nómina",
    mensaje: `${getDisplayName(state.effectiveUser)} editó la inscripción de ${getInscripcionNombres(item)} ${getInscripcionApellidos(item)}.`,
    metadata: {
      inscripcionId,
      documento: getInscripcionDocumento(item),
      cambios
    }
  });

  await loadInscripciones();
  renderInscripcionPasajerosPanel();
  renderEditarNominaInscripcionModal();
  syncButtons();

  showSaveNotice("Inscripción actualizada.");
}

async function archivarNominaInscripcion(inscripcionId = "") {
  if (!canEditarNominaInscripcion()) {
    alert("No tienes permisos para archivar inscritos.");
    return;
  }

  const item = state.inscripciones.find((x) => x.id === inscripcionId);
  if (!item) {
    alert("No se encontró la inscripción.");
    return;
  }

  const nombre = `${getInscripcionNombres(item)} ${getInscripcionApellidos(item)}`.trim();

  const ok = confirm(`¿Archivar a ${nombre || "esta persona"}?\n\nNo se borrará, solo saldrá de la nómina visible.`);
  if (!ok) return;

  const ref = doc(
    db,
    "ventas_cotizaciones",
    String(state.groupDocId),
    "inscripciones",
    String(inscripcionId)
  );

  await updateDoc(ref, {
    privacidad: {
      ...(item.privacidad || {}),
      estado: "archivada",
      archivadaAt: serverTimestamp(),
      archivadaPor: getDisplayName(state.effectiveUser),
      archivadaPorCorreo: state.effectiveEmail,
      motivoArchivo: "Archivado manual desde Editar Nómina"
    }
  });

  await marcarInscripcionPublicaComoEliminada({
    ...item,
    privacidad: {
      ...(item.privacidad || {}),
      estado: "archivada"
    }
  });

  await createHistoryEntry({
    tipoMovimiento: "archivo_nomina_inscripcion",
    modulo: "inscripcion",
    titulo: "Inscripción archivada",
    mensaje: `${getDisplayName(state.effectiveUser)} archivó de la nómina a ${nombre || "una persona"}.`,
    metadata: {
      inscripcionId,
      documento: getInscripcionDocumento(item),
      nombreCompleto: nombre
    }
  });

  await loadInscripciones();
  renderInscripcionPasajerosPanel();
  renderEditarNominaInscripcionModal();
  syncButtons();

  showSaveNotice("Inscripción archivada.");
}

/* =========================================================
   MODALS / EVENTS
========================================================= */
function bindEvents() {
  bindRichEditors();
  bindDatosModalControls();

  document.querySelectorAll("[data-close]").forEach((btn) => {
    btn.addEventListener("click", () => closeModal(btn.dataset.close));
  });

  document.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-confirmar-cupo]");
    if (!btn) return;
  
    confirmarCupoListaEspera(btn.dataset.confirmarCupo);
  });

  document.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-confirmar-nuevo-ingreso]");
    if (!btn) return;
  
    confirmarNuevoIngreso(btn.dataset.confirmarNuevoIngreso);
  });

  document.addEventListener("click", (event) => {
  const btn = event.target.closest("[data-marcar-lista-pagada]");
    if (!btn) return;
  
    marcarListaEsperaPagada(btn.dataset.marcarListaPagada);
  });

  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-var]");
    if (!btn) return;
  
    const variable = btn.dataset.var || "";
    const wrap = btn.closest("[data-variable-targets]");
    if (!wrap || !variable) return;
  
    const targets = String(wrap.dataset.variableTargets || "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
  
    insertVariableAtActiveField(variable, targets);
  });

  $("btnAbrirPdfFicha")?.addEventListener("click", () => {
    const url = cleanText(state.ficha?.pdfUrl || state.group?.fichaPdfUrl || "");
    if (!url) {
      alert("Esta ficha todavía no tiene PDF guardado.");
      return;
    }
    window.open(url, "_blank", "noopener");
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

    $("modalCorreo")?.addEventListener("click", (e) => {
    if (e.target === $("modalCorreo")) closeModal("modalCorreo");
  });

  $("modalTemplateEmail")?.addEventListener("click", (e) => {
    if (e.target === $("modalTemplateEmail")) closeModal("modalTemplateEmail");
  });

  $("modalNominaInicialPagos")?.addEventListener("click", (e) => {
    if (e.target === $("modalNominaInicialPagos")) closeModal("modalNominaInicialPagos");
  });

  $("modalResetCicloInscripcion")?.addEventListener("click", (e) => {
    if (e.target === $("modalResetCicloInscripcion")) closeModal("modalResetCicloInscripcion");
  });

  $("modalEditarNominaInscripcion")?.addEventListener("click", (e) => {
    if (e.target === $("modalEditarNominaInscripcion")) closeModal("modalEditarNominaInscripcion");
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

  $("email_template")?.addEventListener("change", () => {
    state.emailUi.selectedTemplateId = $("email_template")?.value || "";
    syncEmailTemplateButtons();
    applyEmailTemplateSelection();
  });

  $("btnGoGmail")?.addEventListener("click", goToGmailWithDraft);
  $("btnNewEmailTemplate")?.addEventListener("click", () => openEmailTemplateModal("create"));
  $("btnEditEmailTemplate")?.addEventListener("click", () => openEmailTemplateModal("edit"));
  $("btnDeleteEmailTemplate")?.addEventListener("click", deleteSelectedEmailTemplate);
  $("btnSaveEmailTemplate")?.addEventListener("click", saveEmailTemplate);

  $("btnHistoryToggleHidden")?.addEventListener("click", () => {
    state.historyUi.showHidden = !state.historyUi.showHidden;
    renderHistory();
  });

  $("btnHistoryMore")?.addEventListener("click", () => {
    state.historyUi.limit += 10;
    renderHistory();
  });

  $("r_tipo")?.addEventListener("change", syncMeetingTypeVisibility);

  $("meetingsList")?.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;

    const id = btn.dataset.id || "";
    const action = btn.dataset.action || "";

    if (action === "edit-meeting") {
      await openEditMeetingModal(id);
      return;
    }

    if (action === "complete-meeting") {
      await completeMeeting(id);
    }
  });

  $("btnFirmarVendedor")?.addEventListener("click", () => signFlow("vendedor"));
  $("btnFirmarJefaVentas")?.addEventListener("click", () => signFlow("jefaVentas"));
  $("btnFirmarAdministracion")?.addEventListener("click", () => signFlow("administracion"));
  
  $("btnCrearFicha")?.addEventListener("click", openFichaEditor);
  $("btnAbrirFichaPdf")?.addEventListener("click", openFichaPdf);
  $("btnHabilitarInscripcion")?.addEventListener("click", abrirInscripcionPrincipalDesdeBoton);
  $("btnCerrarInscripcion")?.addEventListener("click", cerrarInscripcion);
  $("btnAbrirNuevosInscritos")?.addEventListener("click", () => cambiarFaseInscripcion("nuevos"));
  $("btnAbrirListaEspera")?.addEventListener("click", () => cambiarFaseInscripcion("lista_espera"));
  $("btnCrearLinkLiberados")?.addEventListener("click", crearLinkLiberados);
  $("btnCopiarLinkInscripcion")?.addEventListener("click", copyGroupInscripcionLink);
    document.addEventListener("click", (event) => {
    const btn = event.target.closest("#btnCorreosInscripcion");
    if (!btn) return;

    openEmailModalInscripcion();
  });

  document.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-email-bulk-select]");
    if (!btn) return;

    const mode = btn.dataset.emailBulkSelect;

    if (mode === "all") {
      state.emailUi.bulkRecipients = state.emailUi.bulkRecipients.map((d) => ({
        ...d,
        selected: true
      }));
    }

    if (mode === "pending") {
      state.emailUi.bulkRecipients = state.emailUi.bulkRecipients.map((d) => ({
        ...d,
        selected: d.pendienteFicha
      }));
    }

    if (mode === "none") {
      state.emailUi.bulkRecipients = state.emailUi.bulkRecipients.map((d) => ({
        ...d,
        selected: false
      }));
    }

    renderEmailBulkRecipients();
  });

  document.addEventListener("change", (event) => {
    const chk = event.target.closest("[data-email-bulk-index]");
    if (!chk) return;

    const index = Number(chk.dataset.emailBulkIndex);
    if (!Number.isFinite(index)) return;
    if (!state.emailUi.bulkRecipients[index]) return;

    state.emailUi.bulkRecipients[index].selected = chk.checked;
    renderEmailBulkRecipients();
  });
  $("btnGenerarLinkNominaPublica")?.addEventListener("click", generarLinkNominaPublica);
  $("btnNominaInicialPagos")?.addEventListener("click", openNominaInicialPagosModal);
  $("btnEnviarNominaInicialPagos")?.addEventListener("click", enviarNominaInicialPagos);
  $("btnExportarInscripcionesExcel")?.addEventListener("click", exportarInscripcionesExcel);
  $("btnExportarInscripcionesCsv")?.addEventListener("click", exportarInscripcionesCsv);
  $("btnResetearCicloInscripcion")?.addEventListener("click", openResetCicloInscripcionModal);
  $("btnEditarNominaInscripcion")?.addEventListener("click", openEditarNominaInscripcionModal);
  $("btnConfirmarResetCicloInscripcion")?.addEventListener("click", resetearCicloInscripcion);

  $("btnCrearContrato")?.addEventListener("click", () => {
    if (!state.group?.autorizada) {
      alert("El contrato se habilita cuando el grupo ya está AUTORIZADO.");
      return;
    }
    alert("Aquí conectarás el generador de contrato.");
  });

  $("editarNominaBody")?.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
  
    const id = btn.dataset.id || "";
    const action = btn.dataset.action || "";
  
    if (action === "guardar-nomina-inscripcion") {
      await guardarNominaInscripcion(id);
      return;
    }
  
    if (action === "archivar-nomina-inscripcion") {
      await archivarNominaInscripcion(id);
    }
  });

  $("alertsList")?.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-action='resolver-alerta']");
    if (!btn) return;

    const id = btn.dataset.id || "";
    await resolveManualAlert(id);
  });

  $("datosGrupoGrid")?.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-action='open-email-modal']");
    if (!btn) return;

    await openEmailModal({
      email: btn.dataset.email || "",
      contactLabel: btn.dataset.contactLabel || ""
    });
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

function showSaveNotice(message = "Guardado correctamente.") {
  const old = document.getElementById("saveNoticeToast");
  if (old) old.remove();

  const toast = document.createElement("div");
  toast.id = "saveNoticeToast";
  toast.textContent = message;

  toast.style.position = "fixed";
  toast.style.right = "20px";
  toast.style.bottom = "20px";
  toast.style.zIndex = "99999";
  toast.style.background = "linear-gradient(135deg, #2b1145 0%, #4a2570 100%)";
  toast.style.color = "#fff";
  toast.style.padding = "12px 16px";
  toast.style.borderRadius = "14px";
  toast.style.boxShadow = "0 12px 28px rgba(43,17,69,.28)";
  toast.style.fontSize = "14px";
  toast.style.fontWeight = "800";
  toast.style.letterSpacing = ".15px";
  toast.style.opacity = "0";
  toast.style.transform = "translateY(8px)";
  toast.style.transition = "opacity .2s ease, transform .2s ease";

  document.body.appendChild(toast);

  requestAnimationFrame(() => {
    toast.style.opacity = "1";
    toast.style.transform = "translateY(0)";
  });

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(8px)";
    setTimeout(() => toast.remove(), 220);
  }, 2200);
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

  hydrateDatosSelects(state.group);

  const destinoForm = resolveDestinoPrincipalForm(state.group);
  const programaForm = resolveProgramaForm(
    state.group,
    destinoForm.selectValue === "OTRO" ? destinoForm.otherValue : destinoForm.selectValue
  );
  const tramoForm = resolveTramoForm(state.group);
  const mesForm = resolveMesViajeForm(state.group);

  setText("d_estadoPreview", getEstadoLabel(state.group.estado));
  setText("d_vendedoraPreview", state.group.vendedora || state.group.vendedoraCorreo || "—");

  setFormValue("d_colegio", normalizeTextUpper(state.group.colegio || ""));
  const colegioInput = $("d_colegio");
  const colegioHelper = $("d_colegioHelper");
  
  if (colegioInput) {
    const canEditColegio = canEditSchoolName();
  
    colegioInput.disabled = !canEditColegio;
    colegioInput.readOnly = !canEditColegio;
  }
  
  if (colegioHelper) {
    colegioHelper.textContent = canEditSchoolName()
      ? "Admin y supervisión pueden editar el colegio. El cambio quedará registrado en el historial."
      : "Solo admin y supervisión pueden editar el colegio.";
  }
  setFormValue("d_curso", state.group.curso || "");
  setFormValue("d_anoViaje", state.group.anoViaje || "");
  setFormValue("d_cantidadGrupo", state.group.cantidadGrupo || "");

  setFormValue("d_destinoPrincipal", destinoForm.selectValue);
  setFormValue("d_destinoPrincipalOtro", destinoForm.otherValue);
  syncDatosDestinoOtroVisibility();

  syncDatosProgramaOptions(programaForm.selectValue, programaForm.otherValue);

  setFormValue("d_tramo", tramoForm.selectValue);
  setFormValue("d_tramoOtro", tramoForm.otherValue);
  syncDatosTramoOtroVisibility();

  setFormValue("d_mesViaje", mesForm.selectValue);
  setFormValue("d_mesViajeOtro", mesForm.otherValue);
  syncDatosMesViajeOtroVisibility();

  setFormValue("d_comunaCiudad", state.group.comunaCiudad || "");
  setFormValue("d_nombreCliente", state.group.nombreCliente || "");
  setFormValue("d_rolCliente", findCanonicalOption(ROL_CONTACTO_OPTIONS, state.group.rolCliente || ""));
  setFormValue("d_correoCliente", state.group.correoCliente || "");
  setFormValue("d_celularCliente", formatChileMobileForInput(state.group.celularCliente || ""));
  setFormValue("d_nombreCliente2", state.group.nombreCliente2 || "");
  setFormValue("d_rolCliente2", findCanonicalOption(ROL_CONTACTO_OPTIONS, state.group.rolCliente2 || ""));
  setFormValue("d_correoCliente2", state.group.correoCliente2 || "");
  setFormValue("d_celularCliente2", formatChileMobileForInput(state.group.celularCliente2 || ""));

  syncDatosAliasPreview();
  openModal("modalDatos");
}

function getSharedObsAdministracion(groupData = state.group || {}) {
  return (
    getByPath(groupData, "ficha.infoAdministracionHtml") ||
    getByPath(groupData, "situacion.observacionAdministracion") ||
    groupData.observacionesAdministracion ||
    ""
  );
}

function getSharedObsOperaciones(groupData = state.group || {}) {
  return (
    getByPath(groupData, "ficha.infoOperacionesHtml") ||
    getByPath(groupData, "situacion.observacionOperaciones") ||
    groupData.observacionesOperaciones ||
    ""
  );
}

function openSituacionModal() {
  if (!canEditSituacionGrupo()) {
    alert(getBlockedEditMessage());
    return;
  }

  const estadoActual = normalizeState(state.group.estado);

  setFormValue("s_mensajeHistorial", "");

  const selectEstado = $("s_estado");
  if (selectEstado) {
    selectEstado.innerHTML = `
      <option value="contactado">Contactado</option>
      <option value="cotizando">Cotizando</option>
      <option value="recotizando">Recotizando</option>
      <option value="reunion_confirmada">Reunión confirmada</option>
      <option value="ganada">Ganada</option>
      <option value="perdida">Perdida</option>
    `;

    setFormValue(
      "s_estado",
      estadoActual === "a_contactar" ? "contactado" : estadoActual
    );
  }

  const meetingBaseDate = getSituacionMeetingBaseDate();
  setFormValue("s_fechaReunion", meetingBaseDate ? toDatetimeLocal(meetingBaseDate) : "");

  setRichEditorHtml("s_obsAdmin", getSharedObsAdministracion(state.group));
  setRichEditorHtml("s_obsOperaciones", getSharedObsOperaciones(state.group));

  openModal("modalSituacion");

  requestAnimationFrame(syncSituacionStateUI);
  setTimeout(syncSituacionStateUI, 0);
}

function openDocsModal() {
  if (!canEditDocuments()) {
    alert("Solo administración y supervisión pueden editar el estado de documentos.");
    return;
  }

  setFormValue("doc_fichaMedicaEstado", normalizeDocState(state.group.fichaMedicaEstado));
  setFormValue("doc_nominaEstado", normalizeDocState(state.group.nominaEstado));
  setFormValue("doc_fichaEstado", resolveFichaDocumentoEstado(state.group));
  setFormValue("doc_contratoEstado", normalizeDocState(state.group.contratoEstado));
  setFormValue("doc_cortesiaEstado", normalizeDocState(state.group.cortesiaEstado));

  openModal("modalDocumentos");
}

function openMeetingModal() {
  if (!canManageMeetings()) {
    alert("No tienes permisos para crear reuniones en este grupo.");
    return;
  }

  state.editingMeetingId = "";

  $("formReunion")?.reset();
  setDefaultMeetingDates();
  setFormValue("r_tipo", "presencial");
  syncMeetingTypeVisibility();
  setText("meetingModalTitle", "Nueva reunión");
  setText("btnGuardarReunionLabel", "Guardar reunión");
  openModal("modalReunion");
}

async function openEditMeetingModal(id) {
  if (!canManageMeetings()) {
    alert("No tienes permisos para editar reuniones en este grupo.");
    return;
  }

  const meeting = state.meetings.find((m) => m.id === id);
  if (!meeting) {
    alert("No se encontró la reunión.");
    return;
  }

  state.editingMeetingId = id;

  $("formReunion")?.reset();

  setFormValue("r_titulo", meeting.titulo || "");
  setFormValue("r_tipo", meeting.tipo || "presencial");

  const fecha = toDate(meeting.fechaInicio);
  if (fecha) {
    const yyyy = fecha.getFullYear();
    const mm = String(fecha.getMonth() + 1).padStart(2, "0");
    const dd = String(fecha.getDate()).padStart(2, "0");
    const hh = String(fecha.getHours()).padStart(2, "0");
    const mi = String(fecha.getMinutes()).padStart(2, "0");

    setFormValue("r_fecha", `${yyyy}-${mm}-${dd}`);
    setFormValue("r_horaInicio", `${hh}:${mi}`);
  } else {
    setFormValue("r_fecha", "");
    setFormValue("r_horaInicio", "");
  }

  setFormValue("r_direccion", meeting.direccion || "");
  setFormValue("r_link", meeting.link || "");
  setFormValue("r_observaciones", meeting.observaciones || "");

  syncMeetingTypeVisibility();
  setText("meetingModalTitle", "Editar reunión");
  setText("btnGuardarReunionLabel", "Guardar cambios");
  openModal("modalReunion");
}



function openAlertModal() {
  if (!canCreateAlertsAndComments()) {
    alert("No tienes permisos para crear alertas en este grupo.");
    return;
  }

  $("formAlerta")?.reset();
  setFormValue("a_nivel", "warning");
  openModal("modalAlerta");
}

function openCommentModal() {
  if (!canCreateAlertsAndComments()) {
    alert("No tienes permisos para crear comentarios en este grupo.");
    return;
  }

  $("formComentario")?.reset();
  openModal("modalComentario");
}

async function saveComment() {
  if (!canCreateAlertsAndComments()) {
    alert("No tienes permisos para crear comentarios en este grupo.");
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
  if (!canEditGroup()) {
    alert(getBlockedEditMessage());
    return;
  }

  const patch = {};
  const cambios = [];

  const destinoSeleccionado = normalizeDestinoCanonical($("d_destinoPrincipal")?.value || "");
  const destinoPrincipalOtro = normalizeTextUpper($("d_destinoPrincipalOtro")?.value || "");

  const programaOptions = getProgramOptionsByDestino(destinoSeleccionado);
  const programaSeleccionado = findCanonicalOption(
    programaOptions.length ? programaOptions : ["OTRO"],
    $("d_programa")?.value || ""
  );
  const programaOtro = normalizeTextUpper($("d_programaOtro")?.value || "");

  const tramoSeleccionado = findCanonicalOption(TRAMO_OPTIONS, $("d_tramo")?.value || "");
  const tramoOtro = normalizeTextUpper($("d_tramoOtro")?.value || "");

  const mesViajeSeleccionado = findCanonicalOption(MES_VIAJE_OPTIONS, $("d_mesViaje")?.value || "");
  const mesViajeOtro = normalizeTextUpper($("d_mesViajeOtro")?.value || "");

  const values = {
    colegio: normalizeTextUpper($("d_colegio")?.value || state.group?.colegio || ""),
    curso: normalizeCursoInput($("d_curso")?.value || ""),
    anoViaje: parseNumberOrText($("d_anoViaje")?.value),
    cantidadGrupo: parseNumberOrText($("d_cantidadGrupo")?.value),

    destinoPrincipal: destinoSeleccionado === "OTRO" ? "OTRO" : normalizeTextUpper(destinoSeleccionado),
    destinoPrincipalOtro: destinoSeleccionado === "OTRO" ? destinoPrincipalOtro : "",

    programa: programaSeleccionado === "OTRO" ? "OTRO" : normalizeTextUpper(programaSeleccionado),
    programaOtro: programaSeleccionado === "OTRO" ? programaOtro : "",

    tramo: tramoSeleccionado === "OTRO" ? "OTRO" : normalizeTextUpper(tramoSeleccionado),
    tramoOtro: tramoSeleccionado === "OTRO" ? tramoOtro : "",

    mesViaje: mesViajeSeleccionado === "OTRO" ? "OTRO" : normalizeTextUpper(mesViajeSeleccionado),
    mesViajeOtro: mesViajeSeleccionado === "OTRO" ? mesViajeOtro : "",
    semanaViaje: mesViajeSeleccionado === "OTRO"
      ? mesViajeOtro
      : normalizeTextUpper(mesViajeSeleccionado),

    comunaCiudad: normalizeTextUpper($("d_comunaCiudad")?.value || ""),

    nombreCliente: normalizeTextUpper($("d_nombreCliente")?.value || ""),
    rolCliente: normalizeTextUpper($("d_rolCliente")?.value || ""),
    correoCliente: normalizeEmail($("d_correoCliente")?.value || ""),
    celularCliente: sanitizeChileMobileForSave($("d_celularCliente")?.value || ""),

    nombreCliente2: normalizeTextUpper($("d_nombreCliente2")?.value || ""),
    rolCliente2: normalizeTextUpper($("d_rolCliente2")?.value || ""),
    correoCliente2: normalizeEmail($("d_correoCliente2")?.value || ""),
    celularCliente2: sanitizeChileMobileForSave($("d_celularCliente2")?.value || "")
  };

  // Blindaje: vendedor puede abrir editar datos, pero no cambiar el nombre del colegio.
  if (!canEditSchoolName()) {
    values.colegio = normalizeTextUpper(state.group?.colegio || "");
  }

  // Detectar cambios reales primero
  for (const path of DATA_FIELDS) {
    const nuevo = values[path];
    const anterior = getByPath(state.group, path);

    if (!sameValue(anterior, nuevo)) {
      setNestedValue(patch, path, nuevo);
      cambios.push({ campo: path, anterior, nuevo });
    }
  }

  // Si no cambió nada, no forzar validaciones ni guardado
  if (!cambios.length) {
    closeModal("modalDatos");
    return;
  }

  const changedFields = new Set(cambios.map((c) => c.campo));

  // Helpers de validación parcial
  const changed = (field) => changedFields.has(field);

  const changedAny = (...fields) => fields.some((field) => changedFields.has(field));

  // Validar solo lo tocado y sus dependencias directas

  if (changed("colegio") && !values.colegio) {
    alert("El nombre del colegio no puede quedar vacío.");
    return;
  }

  if (changed("curso")) {
    if (!values.curso) {
      alert("Si modificas el curso, no puede quedar vacío.");
      return;
    }

    if (!hasValidCursoFormat(values.curso)) {
      alert("El curso debe comenzar con un número válido (1 a 11) y luego puede llevar letras, todo junto y sin espacios. Ejemplo: 4C, 3DAVINCI, 10A.");
      return;
    }
  }

  if (changed("anoViaje") && !values.anoViaje) {
    alert("Si modificas el año de viaje, no puede quedar vacío.");
    return;
  }

  if (changed("destinoPrincipal")) {
    if (!values.destinoPrincipal) {
      alert("Si modificas el destino principal, debes seleccionar uno.");
      return;
    }

    if (values.destinoPrincipal === "OTRO" && !values.destinoPrincipalOtro) {
      alert("Debes especificar el otro destino principal.");
      return;
    }
  }

  if (changed("destinoPrincipalOtro")) {
    const destinoFinal = values.destinoPrincipal;
    if (destinoFinal === "OTRO" && !values.destinoPrincipalOtro) {
      alert("Debes especificar el otro destino principal.");
      return;
    }
  }

  if (changed("programa")) {
    if (!values.programa) {
      alert("Si modificas el programa, debes seleccionar uno.");
      return;
    }

    if (values.programa === "OTRO" && !values.programaOtro) {
      alert("Debes especificar el otro programa.");
      return;
    }
  }

  if (changed("programaOtro")) {
    if (values.programa === "OTRO" && !values.programaOtro) {
      alert("Debes especificar el otro programa.");
      return;
    }
  }

  if (changed("tramo")) {
    if (!values.tramo) {
      alert("Si modificas el tramo, debes seleccionar uno.");
      return;
    }

    if (values.tramo === "OTRO" && !values.tramoOtro) {
      alert("Debes especificar el otro tramo.");
      return;
    }
  }

  if (changed("tramoOtro")) {
    if (values.tramo === "OTRO" && !values.tramoOtro) {
      alert("Debes especificar el otro tramo.");
      return;
    }
  }

  if (changed("mesViaje")) {
    if (!values.mesViaje) {
      alert("Si modificas el mes de viaje, debes seleccionar uno.");
      return;
    }

    if (values.mesViaje === "OTRO" && !values.mesViajeOtro) {
      alert("Debes especificar el otro mes de viaje.");
      return;
    }
  }

  if (changed("mesViajeOtro")) {
    if (values.mesViaje === "OTRO" && !values.mesViajeOtro) {
      alert("Debes especificar el otro mes de viaje.");
      return;
    }
  }

  // Recalcular alias solo si cambió alguno de los campos que lo afectan
  if (changedAny("colegio", "curso", "anoViaje")) {
    const { anoBase, cursoViaje, aliasGrupo, aliasTripKey } = buildDatosAliasPayload();

    if (!values.colegio) {
      alert("No se encontró el colegio del grupo.");
      return;
    }

    if (!values.curso) {
      alert("Para reconstruir el alias, el curso no puede quedar vacío.");
      return;
    }

    if (!hasValidCursoFormat(values.curso)) {
      alert("El curso debe comenzar con un número válido (1 a 11) y luego puede llevar letras, todo junto y sin espacios. Ejemplo: 4C, 3DAVINCI, 10A.");
      return;
    }

    if (!values.anoViaje) {
      alert("Para reconstruir el alias, el año de viaje no puede quedar vacío.");
      return;
    }

    if (!cursoViaje || !aliasGrupo || !aliasTripKey) {
      alert("No se pudo reconstruir el alias del grupo. Revisa colegio, curso y año de viaje.");
      return;
    }

    const derivedValues = {
      anoBaseCurso: String(anoBase),
      cursoViaje,
      aliasTripKey
    };
    
    // Si el nombre fue editado manualmente desde la ficha,
    // NO volver a recalcular ni pisar aliasGrupo.
    if (state.group?.nombreGrupoManual !== true) {
      derivedValues.aliasGrupo = aliasGrupo;
    }

    Object.entries(derivedValues).forEach(([path, nuevo]) => {
      const anterior = getByPath(state.group, path);

      if (!sameValue(anterior, nuevo)) {
        setNestedValue(patch, path, nuevo);
        cambios.push({ campo: path, anterior, nuevo });
      }
    });
  }

  // =========================================================
  // ESPEJO GRUPO -> FICHA
  // Mantener en ficha los mismos datos editados desde el modal Datos.
  // NO cambia variables de Firebase: usa las mismas ya existentes.
  // =========================================================
  const nombreProgramaFicha =
    values.programa === "OTRO"
      ? (values.programaOtro || "")
      : (values.programaOtro || values.programa || "");
  
  const tramoFicha =
    values.tramo === "OTRO"
      ? (values.tramoOtro || "")
      : (values.tramoOtro || values.tramo || "");
  
  const fechaViajeFicha =
    values.mesViaje === "OTRO"
      ? (values.mesViajeOtro || "")
      : (values.mesViajeOtro || values.mesViaje || values.semanaViaje || "");
  
  setNestedValue(patch, "ficha.apoderadoEncargado", values.nombreCliente || "");
  setNestedValue(patch, "ficha.telefono", values.celularCliente || "");
  setNestedValue(patch, "ficha.correo", values.correoCliente || "");
  setNestedValue(patch, "ficha.nombrePrograma", nombreProgramaFicha || "");
  setNestedValue(patch, "ficha.numeroPaxTotal", values.cantidadGrupo || "");
  setNestedValue(patch, "ficha.tramo", tramoFicha || "");
  setNestedValue(patch, "ficha.fechaViajeTexto", fechaViajeFicha || "");

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
if (!canEditSituacionGrupo()) {
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

  const flujoNormal = {
    a_contactar: ["contactado"],
    contactado: ["cotizando"],
    cotizando: ["reunion_confirmada"],
    reunion_confirmada: ["ganada", "perdida", "recotizando"],
    perdida: ["recotizando"],
    recotizando: ["cotizando", "reunion_confirmada", "ganada", "perdida"],
    ganada: ["contactado", "cotizando", "reunion_confirmada", "recotizando", "perdida"]
  };
  
  const cambioEstado = estadoNuevo !== estadoAnterior;
  const esSaltoFlujo =
    cambioEstado &&
    estadoNuevo !== "ganada" &&
    !(flujoNormal[estadoAnterior] || []).includes(estadoNuevo);
  
  const esGanadaSaltando =
    cambioEstado &&
    estadoNuevo === "ganada" &&
    estadoAnterior !== "reunion_confirmada";
  
  let justificacionSalto = "";
  
  if (esSaltoFlujo || esGanadaSaltando) {
    const omitidos =
      esGanadaSaltando
        ? getPasosOmitidosHastaGanada(estadoAnterior)
        : [];
  
    const ok = confirm(
      [
        "Estás realizando un cambio fuera del flujo comercial normal.",
        "",
        `Cambio: ${getEstadoLabel(estadoAnterior)} → ${getEstadoLabel(estadoNuevo)}`,
        omitidos.length ? `Pasos omitidos: ${omitidos.map(getEstadoLabel).join(", ")}` : "",
        "",
        "Este salto quedará registrado en el historial.",
        "¿Deseas continuar?"
      ].filter(Boolean).join("\n")
    );
  
    if (!ok) return;
  
    justificacionSalto = cleanText(
      window.prompt(
        "Justifica el salto de flujo. Esto quedará en el historial:",
        mensajeHistorial
      ) || ""
    );
  
    if (!justificacionSalto) {
      alert("Debes justificar el salto de flujo.");
      return;
    }
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

    // Si el grupo venía como legacy, pero recién ahora entra a GANADA
  // y todavía no tiene firmas reales ni flujo avanzado,
  // lo dejamos listo para iniciar el flujo nuevo desde cero.
  if (isGanada) {
    const flowActual = state.group.flowFicha || {};
    const fichaEstadoActual = normalizeSearchLocal(
      state.group?.fichaEstado ||
      state.group?.ficha?.estado ||
      ""
    );

    const hasRealFlowStarted =
      !!flowActual?.vendedor?.firmado ||
      !!flowActual?.jefaVentas?.firmado ||
      !!flowActual?.administracion?.firmado ||
      !!state.group?.autorizada ||
      [
        "lista_vendedor",
        "revisada_jefa_ventas",
        "autorizada_admin",
        "confirmada_pdf",
        "pdf_confirmado",
        "ok"
      ].includes(fichaEstadoActual);

    const veniaLegacy = getFichaFlowMode(state.group) === "legacy";

    if (veniaLegacy && !hasRealFlowStarted) {
      patch.fichaFlujoModo = "";
      patch.fichaEstado = "pendiente";
      patch.firmaVendedor = "";
      patch.firmaSupervision = "";
      patch.firmaAdministracion = "";
      patch.autorizada = false;

      patch.ficha = {
        ...(state.group.ficha || {}),
        flujoModo: "",
        estado: "pendiente",
        confirmada: false,
        pdfPendienteGeneracion: false,
        pdfUrl: "",
        pdfNombre: ""
      };

      patch.flowFicha = {
        ...(state.group.flowFicha || {}),
        modo: "",
        legacy: false,
        estado: "pendiente",
        requiereActualizacion: false,
        requiereRefirmaAdministracion: false,

        vendedor: {
          ...(flowActual.vendedor || {}),
          firmado: false,
          firmadoAt: null,
          firmadoPor: "",
          firmadoPorCorreo: "",
          observacion: ""
        },

        jefaVentas: {
          ...(flowActual.jefaVentas || {}),
          firmado: false,
          firmadoAt: null,
          firmadoPor: "",
          firmadoPorCorreo: "",
          observacion: ""
        },

        administracion: {
          ...(flowActual.administracion || {}),
          firmado: false,
          firmadoAt: null,
          firmadoPor: "",
          firmadoPorCorreo: "",
          observacion: ""
        }
      };

      patch.documentos = {
        ...(state.group.documentos || {}),
        fichaGrupo: {
          ...(state.group.documentos?.fichaGrupo || {}),
          estado: "pendiente"
        }
      };

      if (!sameValue(state.group?.fichaFlujoModo || "", "")) {
        cambios.push({
          campo: "fichaFlujoModo",
          anterior: state.group?.fichaFlujoModo || "",
          nuevo: ""
        });
      }

      if (!sameValue(state.group?.fichaEstado || "", "pendiente")) {
        cambios.push({
          campo: "fichaEstado",
          anterior: state.group?.fichaEstado || "",
          nuevo: "pendiente"
        });
      }
    }
  }

  // 3) Si queda en ganada, guardar observaciones enriquecidas
  if (isGanada) {
    const adminNuevo = getRichEditorHtml("s_obsAdmin");
    const opsNuevo = getRichEditorHtml("s_obsOperaciones");

    const adminAnterior = getSharedObsAdministracion(state.group);
    const opsAnterior = getSharedObsOperaciones(state.group);
    
    if (normalizeRichHtml(adminAnterior) !== normalizeRichHtml(adminNuevo)) {
      // espejo grupo
      setNestedValue(patch, "situacion.observacionAdministracion", adminNuevo);
      patch.observacionesAdministracion = adminNuevo;
    
      // espejo ficha
      setNestedValue(patch, "ficha.infoAdministracionHtml", adminNuevo);
    
      cambios.push({
        campo: "situacion.observacionAdministracion",
        anterior: adminAnterior,
        nuevo: adminNuevo
      });
    }
    
    if (normalizeRichHtml(opsAnterior) !== normalizeRichHtml(opsNuevo)) {
      // espejo grupo
      setNestedValue(patch, "situacion.observacionOperaciones", opsNuevo);
      patch.observacionesOperaciones = opsNuevo;
    
      // espejo ficha
      setNestedValue(patch, "ficha.infoOperacionesHtml", opsNuevo);
    
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

  const omitidosFinal = getPasosOmitidosHastaGanada(estadoAnterior);
  
  const mensajeFinal = [
    mensajeHistorial,
    (esSaltoFlujo || esGanadaSaltando)
      ? `⚠️ Cambio con salto de flujo comercial: ${getEstadoLabel(estadoAnterior)} → ${getEstadoLabel(estadoNuevo)}.`
      : "",
    esGanadaSaltando && omitidosFinal.length
      ? `Pasos omitidos: ${omitidosFinal.map(getEstadoLabel).join(", ")}.`
      : "",
    justificacionSalto
      ? `Justificación del salto: ${justificacionSalto}.`
      : ""
  ].filter(Boolean).join("\n\n");
  
  await saveGroupPatch(patch, {
    tipoMovimiento: (esSaltoFlujo || esGanadaSaltando)
      ? "cambio_estado_salto_flujo"
      : "cambio_estado",
    modulo: "grupo",
    titulo: (esSaltoFlujo || esGanadaSaltando)
      ? "Cambio de situación con salto de flujo"
      : "Actualización de situación",
    asunto: `Cambio de situación · ${getEstadoLabel(estadoAnterior)} → ${getEstadoLabel(estadoNuevo)}`,
    mensaje: mensajeFinal,
    cambios,
    metadata: {
      saltoFlujo: esSaltoFlujo || esGanadaSaltando,
      estadoAnterior,
      estadoNuevo,
      pasosOmitidos: esGanadaSaltando ? omitidosFinal : [],
      justificacionSalto
    }
  });

  closeModal("modalSituacion");
  showSaveNotice("Situación guardada correctamente.");
}

function getPasosOmitidosHastaGanada(estadoAnterior = "") {
  const orden = ["contactado", "cotizando", "reunion_confirmada", "ganada"];
  const fromIndex = orden.indexOf(normalizeState(estadoAnterior));
  const toIndex = orden.indexOf("ganada");

  if (fromIndex < 0 || fromIndex >= toIndex) return [];

  return orden.slice(fromIndex + 1, toIndex);
}

async function saveDocumentos() {
    if (!canEditDocuments()) {
    alert("Solo administración y supervisión pueden editar el estado de documentos.");
    return;
  }
  
  const patch = {};
  const cambios = [];

  const fichaPdfUrl = getFichaDocumentoPdfUrl(state.group);
  
  const values = {
    fichaMedicaEstado: $("doc_fichaMedicaEstado")?.value || "pendiente",
    nominaEstado: $("doc_nominaEstado")?.value || "pendiente",
  
    // Si ya existe PDF real, este documento debe quedar cumplido.
    fichaEstado: fichaPdfUrl
      ? "ok"
      : ($("doc_fichaEstado")?.value || "pendiente"),
  
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
  if (!canManageMeetings()) {
    alert("No tienes permisos para guardar reuniones en este grupo.");
    return;
  }

  const titulo = cleanText($("r_titulo")?.value);
  const tipo = String($("r_tipo")?.value || "presencial");
  const fecha = $("r_fecha")?.value || "";
  const horaInicio = $("r_horaInicio")?.value || "";
  const direccion = cleanText($("r_direccion")?.value);
  const link = cleanText($("r_link")?.value);
  const observaciones = cleanText($("r_observaciones")?.value);

  if (!titulo) {
    alert("Debes ingresar un título para la reunión.");
    return;
  }

  if (!fecha || !horaInicio) {
    alert("Debes ingresar la fecha y la hora de inicio.");
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

  const fechaInicio = new Date(`${fecha}T${horaInicio}`);
  if (Number.isNaN(fechaInicio.getTime())) {
    alert("La fecha u hora ingresada no es válida.");
    return;
  }

  // duración interna referencial de 1 hora
  const fechaFin = new Date(fechaInicio.getTime() + 60 * 60 * 1000);

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
    fechaInicio: Timestamp.fromDate(fechaInicio),
    fechaFin: Timestamp.fromDate(fechaFin),
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

  if (state.editingMeetingId) {
    const current = state.meetings.find((m) => m.id === state.editingMeetingId);

    await updateDoc(doc(db, REUNIONES_COLLECTION, state.editingMeetingId), {
      titulo,
      tipo,
      modalidad: tipo,
      fechaInicio: Timestamp.fromDate(fechaInicio),
      fechaFin: Timestamp.fromDate(fechaFin),
      direccion: tipo === "presencial" ? direccion : "",
      link: tipo === "virtual" ? link : "",
      observaciones,
      actualizadoPor: getDisplayName(state.effectiveUser),
      actualizadoPorCorreo: state.effectiveEmail,
      fechaActualizacion: serverTimestamp()
    });

    await createHistoryEntry({
      tipoMovimiento: "reunion_editada",
      modulo: "agenda",
      titulo: "Reunión editada",
      mensaje: `${getDisplayName(state.effectiveUser)} editó la reunión "${titulo}".`,
      metadata: {
        cambios: [
          { campo: "reunion.titulo", anterior: current?.titulo || "", nuevo: titulo },
          { campo: "reunion.tipo", anterior: current?.tipo || "", nuevo: tipo },
          { campo: "reunion.fechaInicio", anterior: current?.fechaInicio || "", nuevo: fechaInicio.toISOString() },
          { campo: "reunion.lugar", anterior: meetingPlaceLabel(current || {}), nuevo: tipo === "presencial" ? direccion : link },
          { campo: "reunion.observaciones", anterior: current?.observaciones || "", nuevo: observaciones }
        ]
      }
    });

  } else {
    await addDoc(collection(db, REUNIONES_COLLECTION), data);

    const patch = buildMeetingSummaryPatchAfterCreate(data);
    await saveGroupPatch(patch, {
      tipoMovimiento: "reunion_creada",
      modulo: "agenda",
      titulo: "Nueva reunión agendada",
      mensaje: `${getDisplayName(state.effectiveUser)} agendó una reunión ${tipo}.`,
      cambios: [
        { campo: "proximaReunionFecha", anterior: state.group.proximaReunionFecha || "", nuevo: fechaInicio.toISOString() },
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
          { campo: "reunion.fechaInicio", anterior: "", nuevo: fechaInicio.toISOString() },
          { campo: "reunion.lugar", anterior: "", nuevo: tipo === "presencial" ? direccion : link }
        ]
      }
    });
  }

  state.editingMeetingId = "";
  closeModal("modalReunion");
  await loadAll();
  showSaveNotice("Reunión guardada correctamente.");
}

async function completeMeeting(id) {
  if (!canManageMeetings()) {
    alert("No tienes permisos para modificar reuniones en este grupo.");
    return;
  }

  const meeting = state.meetings.find((m) => m.id === id);
  if (!meeting) return;

  const ok = confirm(`¿Marcar como realizada la reunión "${meeting.titulo || "Reunión"}"?`);
  if (!ok) return;

  await updateDoc(doc(db, REUNIONES_COLLECTION, id), {
    estadoReunion: "realizada",
    actualizadoPor: getDisplayName(state.effectiveUser),
    actualizadoPorCorreo: state.effectiveEmail,
    fechaActualizacion: serverTimestamp()
  });

  await createHistoryEntry({
    tipoMovimiento: "reunion_realizada",
    modulo: "agenda",
    titulo: "Reunión realizada",
    mensaje: `${getDisplayName(state.effectiveUser)} marcó como realizada la reunión "${meeting.titulo || "Reunión"}".`,
    metadata: {
      cambios: [
        {
          campo: "reunion.estadoReunion",
          anterior: meeting.estadoReunion || "agendada",
          nuevo: "realizada"
        }
      ]
    }
  });

  await loadAll();
  showSaveNotice("Reunión marcada como realizada.");
}

async function saveManualAlert() {
  if (!canCreateAlertsAndComments()) {
    alert("No tienes permisos para crear alertas en este grupo.");
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
    "curso",
    "anoViaje",
    "cantidadGrupo",
    "destinoPrincipal",
    "destinoPrincipalOtro",
    "programa",
    "programaOtro",
    "tramo",
    "tramoOtro",
    "mesViaje",
    "mesViajeOtro",
    "semanaViaje",
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

function sanitizeHistoryValue(value) {
  if (value === undefined) return null;
  if (value === null) return null;

  if (value instanceof Date) return value;
  if (isTimestampLike(value)) return value;

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeHistoryValue(item));
  }

  if (value && typeof value === "object") {
    const out = {};
    Object.entries(value).forEach(([key, itemValue]) => {
      out[key] = sanitizeHistoryValue(itemValue);
    });
    return out;
  }

  return value;
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
  const rawChanges =
    Array.isArray(cambios) && cambios.length
      ? cambios
      : (Array.isArray(metadata?.cambios) ? metadata.cambios : []);

  // Limpia undefined para que Firestore no rechace el historial
  const baseChanges = rawChanges.map((item) => ({
    campo: cleanText(item?.campo || ""),
    anterior: sanitizeHistoryValue(item?.anterior),
    nuevo: sanitizeHistoryValue(item?.nuevo)
  }));

  const cambiosDetallados = buildDetailedChanges(baseChanges);
  const metadataSafe = sanitizeHistoryValue(metadata || {});

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
      ...metadataSafe,
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
  now.setSeconds(0, 0);

  const start = new Date(now);
  start.setHours(start.getHours() + 2);

  const yyyy = start.getFullYear();
  const mm = String(start.getMonth() + 1).padStart(2, "0");
  const dd = String(start.getDate()).padStart(2, "0");
  const hh = String(start.getHours()).padStart(2, "0");
  const mi = String(start.getMinutes()).padStart(2, "0");

  setFormValue("r_fecha", `${yyyy}-${mm}-${dd}`);
  setFormValue("r_horaInicio", `${hh}:${mi}`);
}

function itemData(label, value, full = false) {
  return {
    label,
    value: stringValue(value),
    full
  };
}

function getFichaDocumentoPdfUrl(groupData = {}) {
  return cleanText(
    groupData.fichaPdfUrl ||
    getByPath(groupData, "ficha.pdfUrl") ||
    getByPath(groupData, "ficha.urlPdf") ||
    ""
  );
}

function resolveFichaDocumentoEstado(groupData = {}) {
  const pdfUrl = getFichaDocumentoPdfUrl(groupData);

  // Si existe PDF real guardado, la ficha del grupo debe verse como cumplida.
  if (pdfUrl) return "ok";

  return normalizeDocState(
    groupData.fichaEstado ||
    getByPath(groupData, "documentos.fichaGrupo.estado") ||
    getByPath(groupData, "ficha.estado") ||
    ""
  );
}

function renderDocChip(key, value, options = {}) {
  const normalized = normalizeDocState(value);
  const href = cleanText(options.href || "");
  const label = `${DOC_LABELS[key] || key} · ${getDocStateLabel(normalized)}`;

  if (href) {
    return `
      <a
        class="doc-chip ${docStateClass(normalized)}"
        href="${escapeHtml(href)}"
        target="_blank"
        rel="noopener noreferrer"
        title="${escapeHtml(label)}"
      >
        ${escapeHtml(label)}
      </a>
    `;
  }

  return `
    <span class="doc-chip ${docStateClass(normalized)}">
      ${escapeHtml(label)}
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
  if (isAdministracionBlockedFromGroupEdit()) {
    return "Administración no puede editar datos del grupo después de la firma del vendedor. Solo puede editar N° negocio, usuario ficha y clave administrativa desde la ficha, o solicitar corrección.";
  }

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
    destinoPrincipalOtro: "Otro destino principal",
    programa: "Programa",
    programaOtro: "Otro programa",
    tramo: "Tramo",
    tramoOtro: "Otro tramo",
    mesViaje: "Mes de viaje",
    mesViajeOtro: "Otro mes de viaje",
    semanaViaje: "Mes de viaje",
    asistenciaMed: "Asistencia médica",
    cursoViaje: "Curso proyectado",
    aliasTripKey: "Clave alias viaje",
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

function normalizeDocState(value) {
  if (typeof value === "boolean") {
    return value ? "ok" : "pendiente";
  }

  const v = normalizeSearchLocal(value);

  if (!v) return "pendiente";
  if (v.includes("no aplica") || v === "na" || v === "n/a") return "no_aplica";

  if (
    v.includes("ok") ||
    v.includes("completo") ||
    v.includes("cumpl") ||
    v.includes("entreg") ||
    v.includes("confirmada_pdf") ||
    v.includes("pdf_confirmado") ||
    v.includes("confirmada")
  ) {
    return "ok";
  }

  if (v.includes("pend")) return "pendiente";

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

function insertVariableAtActiveField(variable, allowedIds = []) {
  const active = document.activeElement;

  const isValidTarget =
    active &&
    allowedIds.includes(active.id) &&
    (active.tagName === "TEXTAREA" || active.tagName === "INPUT");

  const target = isValidTarget
    ? active
    : $(allowedIds[allowedIds.length - 1]);

  if (!target) return;

  const start = target.selectionStart ?? target.value.length;
  const end = target.selectionEnd ?? target.value.length;

  const before = target.value.slice(0, start);
  const after = target.value.slice(end);

  target.value = `${before}${variable}${after}`;

  const nextPos = start + variable.length;
  target.focus();
  target.setSelectionRange(nextPos, nextPos);
}

function escapeHtml(value = "") {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getNombrePublicoInscripcion(item = {}) {
  const nombres =
    getByPath(item, "identificacion.nombres") ||
    item.nombres ||
    "";

  const primerApellido =
    getByPath(item, "identificacion.primerApellido") ||
    item.primerApellido ||
    "";

  const segundoApellido =
    getByPath(item, "identificacion.segundoApellido") ||
    item.segundoApellido ||
    "";

  const nombreCompleto =
    getByPath(item, "identificacion.nombreCompleto") ||
    item.nombreCompleto ||
    "";

  return cleanText(
    nombreCompleto || [nombres, primerApellido, segundoApellido].filter(Boolean).join(" ")
  );
}

function buildNominaPublicaRows() {
  return state.inscripciones
    .filter((item) => item?.privacidad?.estado !== "eliminada_logica")
    .map((item) => {
      const fechaOriginal = getFechaFormularioInscripcion(item);

      return {
        nombre: getNombrePublicoInscripcion(item),
        fechaInscripcion: formatPublicDateTime(fechaOriginal),
        fechaOrden: getPublicDateTimeMs(fechaOriginal),
        tipo: formatInscripcionValue(item.tipoViajante || item.tipoParticipacion || "")
      };
    })
    .filter((x) => x.nombre)
    .sort((a, b) => a.fechaOrden - b.fechaOrden);
}

function formatPublicDateTime(value) {
  let d = null;

  if (!value) return "—";

  if (value?.toDate) {
    d = value.toDate();
  } else if (value instanceof Date) {
    d = value;
  } else {
    d = new Date(value);
  }

  if (!d || Number.isNaN(d.getTime())) return "—";

  return d.toLocaleString("es-CL", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function getPublicDateTimeMs(value) {
  let d = null;

  if (!value) return 0;

  if (value?.toDate) {
    d = value.toDate();
  } else if (value instanceof Date) {
    d = value;
  } else {
    d = new Date(value);
  }

  if (!d || Number.isNaN(d.getTime())) return 0;

  return d.getTime();
}

function getNominaPublicaLink(token = "") {
  return `${location.origin}${location.pathname.replace(/grupo\.html$/i, "nomina.html")}?t=${encodeURIComponent(token)}`;
}

async function generarLinkNominaPublica() {
  if (!state.groupDocId || !state.groupId) {
    alert("No se pudo identificar el grupo.");
    return;
  }

  const ok = confirm(
    "Se generará un link público de nómina viva. Cada vez que se abra, mostrará la nómina actual del grupo. Solo incluirá nombres, apellidos y fecha de inscripción. ¿Continuar?"
  );

  if (!ok) return;

  const tokenExistente = cleanText(state.group?.nominaPublica?.token || "");
  const token = tokenExistente || generateInscripcionToken(40);
  const link = getNominaPublicaLink(token);

  const payloadNominaPublica = {
    token,
    activo: true,

    idGrupo: String(state.groupId),
    groupDocId: String(state.groupDocId),

    colegio: cleanText(state.group?.colegio || ""),
    curso: cleanText(state.group?.curso || ""),
    anoViaje: cleanText(state.group?.anoViaje || ""),
    destino:
      cleanText(state.group?.destinoPrincipal || "") ||
      cleanText(state.group?.destino || ""),
    nombreGrupo:
      cleanText(state.group?.aliasGrupo || "") ||
      cleanText(state.group?.nombreGrupo || "") ||
      cleanText(state.group?.colegio || ""),

    tipo: "nomina_viva",
    actualizadoEn: serverTimestamp(),
    actualizadoPor: getDisplayName(state.effectiveUser),
    actualizadoPorCorreo: state.effectiveEmail || ""
  };

  if (!tokenExistente) {
    payloadNominaPublica.creadoEn = serverTimestamp();
  }

  await setDoc(
    doc(db, "nominas_publicas", token),
    payloadNominaPublica,
    { merge: true }
  );

  await saveGroupPatch(
    {
      nominaPublica: {
        activo: true,
        token,
        link,
        tipo: "nomina_viva",
        actualizadoEn: serverTimestamp(),
        actualizadoPor: getDisplayName(state.effectiveUser),
        actualizadoPorCorreo: state.effectiveEmail || ""
      }
    },
    {
      tipoMovimiento: "nomina_publica_generada",
      modulo: "inscripcion",
      titulo: "Link público de nómina viva generado",
      mensaje: `${getDisplayName(state.effectiveUser)} generó o actualizó el link público de nómina viva.`
    }
  );

  try {
    await navigator.clipboard.writeText(link);
    showSaveNotice("Link de nómina viva copiado.");
  } catch {
    alert(`Link de nómina viva:\n\n${link}`);
  }
}

/* =========================================================
   IMPORTAR NÓMINA DESDE SISTEMA DE PAGOS · CONSOLA
========================================================= */

const API_PAGOS_DETALLE_URL = "/api/pagos";

function capitalizarNombrePagos(value = "") {
  return cleanText(value)
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

function normalizarRutPagos(value = "") {
  return String(value || "")
    .toUpperCase()
    .replace(/\./g, "")
    .replace(/-/g, "")
    .replace(/\s+/g, "")
    .trim();
}

function calcularDvRutImport(cuerpo = "") {
  const rut = String(cuerpo || "").replace(/\D/g, "");
  if (!rut) return "";

  let suma = 0;
  let multiplo = 2;

  for (let i = rut.length - 1; i >= 0; i--) {
    suma += Number(rut[i]) * multiplo;
    multiplo = multiplo === 7 ? 2 : multiplo + 1;
  }

  const resto = 11 - (suma % 11);
  if (resto === 11) return "0";
  if (resto === 10) return "K";
  return String(resto);
}

function formatearRutDesdePagos(rutRaw = "") {
  const limpio = normalizarRutPagos(rutRaw);
  if (!limpio) return { rut: "", rutNumero: "", rutDv: "", documentoNormalizado: "" };

  const cuerpo = limpio.slice(0, -1);
  const dv = limpio.slice(-1) || calcularDvRutImport(cuerpo);
  const rut = cuerpo && dv ? `${cuerpo}-${dv}` : limpio;

  return {
    rut,
    rutNumero: cuerpo,
    rutDv: dv,
    documentoNormalizado: `RUT_${rut}`
  };
}

function separarApellidosPagos(apellidos = "") {
  const partes = capitalizarNombrePagos(apellidos).split(/\s+/).filter(Boolean);

  return {
    primerApellido: partes[0] || "",
    segundoApellido: partes.slice(1).join(" ")
  };
}

function generoDesdeSexoPagos(sexo = "") {
  const s = String(sexo || "").toUpperCase().trim();
  if (s === "M") return "masculino";
  if (s === "F") return "femenino";
  return "";
}

function tipoViajanteDesdeCategoriaPagos(categoria = "") {
  const c = normalizeSearchLocal(categoria || "");

  if (c.includes("estudiante")) return "estudiante";
  if (c.includes("profesor") || c.includes("docente") || c.includes("coordinador")) return "profesor";
  return "adulto_acompanante";
}

function buildPayloadInscripcionDesdePagos(p = {}, grupo = {}, groupDocId = "") {
  const rutInfo = formatearRutDesdePagos(p.rut || "");
  const apellidos = separarApellidosPagos(p.apellidos || "");
  const genero = generoDesdeSexoPagos(p.sexo || "");
  const tipoViajante = tipoViajanteDesdeCategoriaPagos(p.ocupacion_categoria || "");

  const esEstudiante = tipoViajante === "estudiante";
  const esProfesor = tipoViajante === "profesor";
  const esAcompanante = tipoViajante === "adulto_acompanante";

  const nombres = capitalizarNombrePagos(p.nombres || "");
  const nombreCompleto = [
    nombres,
    apellidos.primerApellido,
    apellidos.segundoApellido
  ].filter(Boolean).join(" ");

  return {
    tipoRegistro: "inscripcion_pasajero",

    faseInscripcion: "nomina_final",
    contextoFormulario: "sistema_pagos",
    estadoInscripcion: "sistema_pagos",
    tipoInscripcion: "sistema_pagos",
    tipoInscripcionLabel: "Sistema de Pagos",
    estadoCupo: "confirmado",

    tipoViajante,
    tipoParticipacion: tipoViajante,
    esEstudiante,
    esProfesor,
    esAcompanante,
    esAdulto: !esEstudiante,
    esMenor: false,

    grupo: {
      idGrupo: String(groupDocId || ""),
      aliasGrupo: cleanText(grupo.aliasGrupo || ""),
      nombreGrupo: cleanText(grupo.nombreGrupo || ""),
      colegio: cleanText(grupo.colegio || ""),
      cursoBase: cleanText(grupo.curso || grupo.cursoBase || ""),
      cursoActualInscripcion: cleanText(grupo.curso || grupo.cursoBase || ""),
      cantidadGrupo: grupo.cantidadGrupo ?? grupo.cantidadgrupo ?? null,
      anoViaje: grupo.anoViaje ?? null,
      destinoPrincipal: cleanText(grupo.destinoPrincipal || grupo.destino || ""),
      internacional: false
    },

    identificacion: {
      tipoIdentificacion: rutInfo.rut ? "rut" : "sin_rut",
      documento: rutInfo.rut,
      documentoNormalizado: rutInfo.documentoNormalizado,
      rut: rutInfo.rut,
      rutNumero: rutInfo.rutNumero,
      rutDv: rutInfo.rutDv,

      nombres,
      primerApellido: apellidos.primerApellido,
      segundoApellido: apellidos.segundoApellido,
      sinSegundoApellido: !apellidos.segundoApellido,
      nombreCompleto,

      fechaNacimiento: p.fecha_nacimiento || "",
      genero,
      generoFinal: genero,
      sexoPagos: p.sexo || "",
      ocupacionCategoriaPagos: p.ocupacion_categoria || "",

      nacionalidadBase: "",
      nacionalidadDetalle: "",

      correoViajante: "",
      telefonoViajante: "",
      tallaPolera: ""
    },

    contactoPrincipal: {
      aplica: true,
      nombre: "",
      relacion: "",
      relacionBase: "",
      telefono: cleanText(p.telefono || ""),
      celular: cleanText(p.telefono || ""),
      esWhatsapp: true,
      whatsappAlternativo: "",
      correo: normalizeEmail(p.email || "")
    },

    contactoSecundario: {
      aplica: false,
      nombre: "",
      relacion: "",
      relacionBase: "",
      telefono: "",
      celular: "",
      correo: "",
      esWhatsapp: false,
      whatsappAlternativo: ""
    },

    documentoIdentidad: {
      aplica: !!rutInfo.rut,
      nombreCoincideDocumento: "si",
      nombresDocumento: "",
      primerApellidoDocumento: "",
      segundoApellidoDocumento: "",
      sexoDocumento: genero,
      declaraActualizacionDocumento: false
    },

    emergencia: {
      nombre: "",
      relacion: "",
      relacionBase: "",
      telefono: "",
      esWhatsapp: false,
      whatsappAlternativo: ""
    },

    emergenciaSecundaria: {
      aplica: false,
      nombre: "",
      relacion: "",
      relacionBase: "",
      telefono: "",
      esWhatsapp: false,
      whatsappAlternativo: ""
    },

    profesor: {
      aplica: esProfesor,
      tipoProfesor: "",
      tipoProfesorBase: "",
      tipoProfesorOtro: "",
      interesConoceRaitrai: false
    },

    adultoAcompanante: {
      aplica: esAcompanante,
      relacionCurso: "",
      relacionCursoBase: "",
      relacionCursoOtro: "",
      estudianteRelacionado: "",
      estudianteRelacionadoNombres: "",
      estudianteRelacionadoPrimerApellido: "",
      estudianteRelacionadoSegundoApellido: "",
      acompananteTieneHijosViaje: "",
      interesConoceRaitrai: false
    },

    adultoCompromiso: {
      aplica: !esEstudiante,
      aceptaCompromiso: false,
      observaciones: ""
    },

    salud: {},

    privacidad: {
      estado: "activa",
      anonimizada: false,
      eliminada: false,
      motivo: ""
    },

    sistemaPagos: {
      origen: "importado_desde_pagos",
      pasajeroId: p.pasajero_id || "",
      viaja: Number(p.viaja) === 1,
      bloqueado: Number(p.bloqueado) === 1,
      tieneCredencial: Number(p.tiene_credencial) === 1,
      tipoPago: p.tipo_pago || "",
      ocupacionCategoria: p.ocupacion_categoria || "",
      importadoAtCliente: new Date().toISOString()
    },

    meta: {
      canal: "sistema_pagos",
      estado: "precargado_desde_pagos",
      requiereCompletarNominaFinal: true,
      fechaInscripcion: new Date().toISOString(),
      fechaFormularioCliente: new Date().toISOString(),
      versionFormulario: 4,
      creadoDesde: "importacion_consola_grupo_js"
    }
  };
}

async function buscarGrupoPorNumeroNegocio(numeroNegocio) {
  const n = String(numeroNegocio || "").trim();

  const intentos = [
    query(collection(db, "ventas_cotizaciones"), where("numeroNegocio", "==", n)),
    query(collection(db, "ventas_cotizaciones"), where("numeroNegocio", "==", Number(n))),
    query(collection(db, "ventas_cotizaciones"), where("ficha.numeroNegocio", "==", n)),
    query(collection(db, "ventas_cotizaciones"), where("ficha.numeroNegocio", "==", Number(n)))
  ];

  for (const qRef of intentos) {
    const snap = await getDocs(qRef);
    if (!snap.empty) {
      const d = snap.docs[0];
      return { docId: d.id, data: d.data() || {} };
    }
  }

  throw new Error(`No encontré grupo con numeroNegocio ${n}`);
}

async function consultarNominaPagos(numeroNegocio) {
  const url = `${API_PAGOS_DETALLE_URL}?modo=detalle&numeroNegocio=${encodeURIComponent(numeroNegocio)}`;
  const res = await fetch(url);

  if (!res.ok) throw new Error(`Error consultando pagos HTTP ${res.status}`);

  const data = await res.json();
  const pasajeros = data?.nominas?.data?.pasajeros || [];

  return pasajeros.map((x) => x.pasajero || {}).filter((p) => p && Object.keys(p).length);
}

window.importarNominaPagosPorNumeroNegocio = async function (numeroNegocio, options = {}) {
  const dryRun = options.dryRun !== false;

  const grupo = await buscarGrupoPorNumeroNegocio(numeroNegocio);
  const pasajeros = await consultarNominaPagos(numeroNegocio);

  const resultado = {
    numeroNegocio: String(numeroNegocio),
    groupDocId: grupo.docId,
    totalPagos: pasajeros.length,
    creados: 0,
    existentes: 0,
    omitidosSinRut: 0,
    dryRun,
    detalle: []
  };

  for (const p of pasajeros) {
    const rutInfo = formatearRutDesdePagos(p.rut || "");

    if (!rutInfo.rut) {
      resultado.omitidosSinRut += 1;
      resultado.detalle.push({
        accion: "omitido_sin_rut",
        nombre: capitalizarNombrePagos(`${p.nombres || ""} ${p.apellidos || ""}`)
      });
      continue;
    }

    const docId = rutInfo.documentoNormalizado;
    const ref = doc(db, "ventas_cotizaciones", grupo.docId, "inscripciones", docId);
    const snap = await getDoc(ref);
    const payload = buildPayloadInscripcionDesdePagos(p, grupo.data, grupo.docId);

    if (snap.exists()) {
      resultado.existentes += 1;
      resultado.detalle.push({
        accion: "ya_existia",
        docId,
        rut: rutInfo.rut,
        nombre: payload.identificacion.nombreCompleto
      });
      continue;
    }

    resultado.detalle.push({
      accion: dryRun ? "simular_creacion" : "creado",
      docId,
      rut: rutInfo.rut,
      nombre: payload.identificacion.nombreCompleto,
      tipoViajante: payload.tipoViajante,
      correo: payload.contactoPrincipal.correo,
      telefono: payload.contactoPrincipal.telefono,
      viaja: payload.sistemaPagos.viaja
    });

    if (!dryRun) {
      await setDoc(ref, {
        ...payload,
        creadoPor: getDisplayName(state.effectiveUser),
        creadoPorCorreo: state.effectiveEmail,
        creadoAt: serverTimestamp(),
        actualizadoPor: getDisplayName(state.effectiveUser),
        actualizadoPorCorreo: state.effectiveEmail,
        actualizadoAt: serverTimestamp()
      });
    }

    resultado.creados += 1;
  }

  console.table(resultado.detalle);
  console.log("RESULTADO IMPORTACIÓN:", resultado);

  if (!dryRun) {
    await loadInscripciones();
    renderInscripcionPasajerosPanel();
    syncButtons();
    showSaveNotice(`Importación lista: ${resultado.creados} creados, ${resultado.existentes} ya existían.`);
  }

  return resultado;
};

window.importarTodasNominasPagos = async function (options = {}) {
  const {
    dryRun = true,
    soloSiNoTieneNomina = true
  } = options;

  const gruposSnap = await getDocs(collection(db, "ventas_cotizaciones"));

  let procesados = 0;
  let importados = 0;
  let omitidosSinNumeroNegocio = 0;
  let omitidosConNomina = 0;
  let errores = 0;

  for (const grupoDoc of gruposSnap.docs) {
    const grupo = grupoDoc.data() || {};

    const numeroNegocio = String(
      grupo.numeroNegocio ||
      grupo.ficha?.numeroNegocio ||
      ""
    ).trim();

    if (!numeroNegocio) {
      omitidosSinNumeroNegocio++;
      console.log(`⏭️ ${grupoDoc.id}: sin numeroNegocio.`);
      continue;
    }

    procesados++;

    try {
      if (soloSiNoTieneNomina) {
        const inscSnap = await getDocs(
          collection(db, "ventas_cotizaciones", grupoDoc.id, "inscripciones")
        );

        const tieneNominaVisible = inscSnap.docs.some((d) => {
          const data = d.data() || {};
          const estadoPrivacidad = normalizeSearchLocal(data?.privacidad?.estado || "");

          return estadoPrivacidad !== "archivada" &&
                 estadoPrivacidad !== "eliminada_logica";
        });

        if (tieneNominaVisible) {
          omitidosConNomina++;
          console.log(`⏭️ ${numeroNegocio}: ya tiene nómina.`);
          continue;
        }
      }

      console.log(`▶️ Importando numeroNegocio ${numeroNegocio} · doc ${grupoDoc.id}`);

      await window.importarNominaPagosPorNumeroNegocio(numeroNegocio, { dryRun });

      importados++;
    } catch (error) {
      errores++;
      console.error(`❌ Error importando ${numeroNegocio}:`, error);
    }
  }

  const resumen = {
    dryRun,
    soloSiNoTieneNomina,
    procesados,
    importados,
    omitidosSinNumeroNegocio,
    omitidosConNomina,
    errores
  };

  console.table([resumen]);
  return resumen;
};

window.sincronizarNominaPublicaConOficial = async function (groupDocIdParam = "") {
  const groupDocId = String(groupDocIdParam || state.groupDocId || "").trim();

  if (!groupDocId) {
    console.error("Falta groupDocId.");
    return;
  }

  const oficialSnap = await getDocs(
    collection(db, "ventas_cotizaciones", groupDocId, "inscripciones")
  );

  const oficialesActivos = new Set();

  oficialSnap.docs.forEach((d) => {
    const item = { id: d.id, ...d.data() };

    const estadoPrivacidad = normalizeSearchLocal(item?.privacidad?.estado || "");
    if (estadoPrivacidad === "archivada" || estadoPrivacidad === "eliminada_logica") return;

    const rutKey = normalizarRutKeyGrupo(
      getInscripcionDocumento(item) || item.id || ""
    );

    const nombreKey = normalizeSearchLocal(
      `${getInscripcionNombres(item)} ${getInscripcionApellidos(item)}`
    );

    if (rutKey) oficialesActivos.add(`rut:${rutKey}`);
    if (nombreKey) oficialesActivos.add(`nombre:${nombreKey}`);
  });

  const publicaSnap = await getDocs(
    query(
      collection(db, "inscripciones_pendientes_publicas"),
      where("idGrupo", "==", groupDocId)
    )
  );

  let revisados = 0;
  let eliminados = 0;

  for (const docPub of publicaSnap.docs) {
    revisados++;

    const item = { id: docPub.id, ...docPub.data() };
    const payload = item.payload || {};

    const rutKey = normalizarRutKeyGrupo(
      getRutKeyInscripcionPublicaGrupo(payload) || item.id || ""
    );

    const nombreKey = normalizeSearchLocal(
      getNombrePublicoInscripcionGrupo(payload)
    );

    const existeEnOficial =
      (rutKey && oficialesActivos.has(`rut:${rutKey}`)) ||
      (nombreKey && oficialesActivos.has(`nombre:${nombreKey}`));

    if (existeEnOficial) continue;

    await updateDoc(doc(db, "inscripciones_pendientes_publicas", docPub.id), {
      estado: "eliminada_logica",
      "payload.privacidad.estado": "eliminada_logica",
      eliminadaPorSyncNomina: true,
      eliminadaPorSyncAt: serverTimestamp(),
      eliminadaPorSyncGrupo: groupDocId
    });

    eliminados++;
    console.log("Eliminada de nómina pública:", {
      id: docPub.id,
      nombre: getNombrePublicoInscripcionGrupo(payload),
      rutKey
    });
  }

  console.log("Sync nómina pública terminado:", {
    groupDocId,
    revisados,
    eliminados,
    oficialesActivos: oficialesActivos.size
  });

  alert(`Sync terminado. Revisados: ${revisados}. Eliminados de pública: ${eliminados}.`);
};

function normalizarRutKeyGrupo(value = "") {
  return String(value || "")
    .toUpperCase()
    .replace(/\./g, "")
    .replace(/-/g, "")
    .replace(/\s+/g, "")
    .trim();
}

function getRutKeyInscripcionPublicaGrupo(item = {}) {
  const identificacion = item.identificacion || {};

  const documento =
    identificacion.documentoNormalizado ||
    identificacion.rut ||
    identificacion.documento ||
    [
      identificacion.rutNumero,
      identificacion.rutDv
    ].filter(Boolean).join("-") ||
    item.documentoNormalizado ||
    item.rut ||
    item.documento ||
    "";

  return normalizarRutKeyGrupo(documento);
}

function getNombrePublicoInscripcionGrupo(item = {}) {
  const identificacion = item.identificacion || {};

  return cleanText([
    identificacion.nombres || item.nombres,
    identificacion.primerApellido || item.primerApellido,
    identificacion.segundoApellido || item.segundoApellido
  ].filter(Boolean).join(" ") ||
    identificacion.nombreCompleto ||
    item.nombreCompleto ||
    item.nombre ||
    item.pasajero ||
    ""
  );
}

async function marcarInscripcionPublicaComoEliminada(inscripcionOficial = {}) {
  const rutKey = normalizarRutKeyGrupo(
    getInscripcionDocumento(inscripcionOficial) || inscripcionOficial.id || ""
  );

  const nombreKey = normalizeSearchLocal(
    `${getInscripcionNombres(inscripcionOficial)} ${getInscripcionApellidos(inscripcionOficial)}`
  );

  const publicaSnap = await getDocs(
    query(
      collection(db, "inscripciones_pendientes_publicas"),
      where("idGrupo", "==", String(state.groupDocId))
    )
  );

  for (const docPub of publicaSnap.docs) {
    const itemPub = { id: docPub.id, ...docPub.data() };
    const payload = itemPub.payload || {};

    const rutPub = normalizarRutKeyGrupo(
      getRutKeyInscripcionPublicaGrupo(payload) || itemPub.id || ""
    );

    const nombrePub = normalizeSearchLocal(
      getNombrePublicoInscripcionGrupo(payload)
    );

    const coincide =
      (rutKey && rutPub && rutKey === rutPub) ||
      (nombreKey && nombrePub && nombreKey === nombrePub);

    if (!coincide) continue;

    await updateDoc(doc(db, "inscripciones_pendientes_publicas", docPub.id), {
      estado: "eliminada_logica",
      "payload.privacidad.estado": "eliminada_logica",
      eliminadaPorSyncNomina: true,
      eliminadaPorSyncAt: serverTimestamp(),
      eliminadaPorSyncGrupo: String(state.groupDocId || ""),
      eliminadaPorSyncInscripcionId: String(inscripcionOficial.id || "")
    });

    console.log("[sync pública] marcada eliminada:", {
      idPublico: docPub.id,
      nombre: getNombrePublicoInscripcionGrupo(payload),
      rutPub
    });
  }
}

async function sincronizarInscripcionPublicaPostEdicion(inscripcionOficial = {}) {
  const estadoPrivacidad = normalizeSearchLocal(inscripcionOficial?.privacidad?.estado || "");

  if (estadoPrivacidad === "archivada" || estadoPrivacidad === "eliminada_logica") {
    await marcarInscripcionPublicaComoEliminada(inscripcionOficial);
  }
}

window.buscarCorreosEnInscripciones = async function (correos = []) {
  const buscados = new Set(
    (Array.isArray(correos) ? correos : String(correos).split(/[,\n;]/))
      .map(c => normalizeEmail(c))
      .filter(Boolean)
  );

  const resultados = [];
  const gruposSnap = await getDocs(collection(db, "ventas_cotizaciones"));

  let revisados = 0;

  for (const grupoDoc of gruposSnap.docs) {
    revisados++;

    const grupo = grupoDoc.data() || {};
    const numeroNegocio = grupo.numeroNegocio || grupo.ficha?.numeroNegocio || "";
    const nombreGrupo = grupo.nombreGrupo || grupo.aliasGrupo || grupo.colegio || "";

    console.log(`🔎 ${revisados}/${gruposSnap.size} revisando ${numeroNegocio || grupoDoc.id} · ${nombreGrupo}`);

    const inscSnap = await getDocs(
      collection(db, "ventas_cotizaciones", grupoDoc.id, "inscripciones")
    );

    for (const inscDoc of inscSnap.docs) {
      const p = inscDoc.data() || {};

      const correosPersona = [
        p.contactoPrincipal?.correo,
        p.contactoPrincipal?.email,
        p.contactoSecundario?.correo,
        p.contactoSecundario?.email,
        p.identificacion?.correoViajante,
        p.identificacion?.correoPersonaQueViaja,
        p.correo,
        p.email
      ].map(normalizeEmail).filter(Boolean);

      const match = correosPersona.find(c => buscados.has(c));
      if (!match) continue;

      const item = {
        correoBuscado: match,
        pasajero: p.identificacion?.nombreCompleto || [
          p.identificacion?.nombres,
          p.identificacion?.primerApellido,
          p.identificacion?.segundoApellido
        ].filter(Boolean).join(" "),
        rut: p.identificacion?.rut || p.identificacion?.documento || inscDoc.id,
        responsable1: p.contactoPrincipal?.nombre || "",
        responsable2: p.contactoSecundario?.nombre || "",
        tipoInscripcion: p.tipoInscripcion || "",
        tipoViajante: p.tipoViajante || "",
        numeroNegocio,
        grupo: nombreGrupo,
        colegio: grupo.colegio || "",
        curso: grupo.curso || "",
        anoViaje: grupo.anoViaje || "",
        grupoDocId: grupoDoc.id,
        inscripcionDocId: inscDoc.id
      };

      resultados.push(item);
      console.log("✅ ENCONTRADO:", item);
    }
  }

  console.log(`✅ Búsqueda terminada. Coincidencias: ${resultados.length}`);
  console.table(resultados);
  return resultados;
};


