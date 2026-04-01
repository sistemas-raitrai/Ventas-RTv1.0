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
  serverTimestamp
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
const HISTORIAL_COLLECTION = "ventas_historial";

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
  ficha: null
};

const FICHA_FIELDS = [
  "solicitudReserva",
  "nombreGrupo",
  "apoderadoEncargado",
  "telefono",
  "correo",
  "nombrePrograma",
  "valorPrograma",
  "numeroPaxTotal",
  "tramo",
  "liberados",
  "categoriaHoteleraContratada",
  "autorizacionGerencia",
  "descuentoValorBase",
  "fechaViajeTexto",
  "asistenciaEnViajes",
  "nombreVendedor",
  "numeroNegocio",
  "usuarioFicha",
  "claveAdministrativa",
  "version",
  "infoOperacionesHtml",
  "infoAdministracionHtml",
  "observacionesHtml",
  "pdfUrl",
  "pdfNombre"
];

initPage();

async function initPage() {
  state.requestedId = String(new URLSearchParams(location.search).get("id") || "").trim();

  await waitForLayoutReady();
  bindRichEditors();
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
    scopeText: `Ficha de viaje · ${state.requestedId || "Sin ID"}`
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
    renderFatal("No tienes permisos para ver esta ficha.");
    return;
  }

  if (!canOpenFicha()) {
    renderFatal("La ficha solo puede abrirse cuando el grupo está en estado GANADA.");
    return;
  }

  state.ficha = hydrateFicha(state.group);
  renderPage();
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

function canEditFicha() {
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

function canOpenFicha() {
  return normalizeState(state.group?.estado) === "ganada";
}

/* =========================================================
   RENDER
========================================================= */
function renderPage() {
  renderHero();
  renderResumenGrupo();
  fillForm();
  syncButtons();
}

function renderHero() {
  const title =
    cleanText(state.ficha?.nombreGrupo) ||
    cleanText(state.group?.aliasGrupo) ||
    cleanText(state.group?.nombreGrupo) ||
    cleanText(state.group?.colegio) ||
    `Grupo ${state.groupId}`;

  setText("heroTitle", title);
  setText("heroIdGrupo", state.groupId);
  setText("heroColegio", state.group?.colegio || "—");
  setText("heroAnoViaje", state.group?.anoViaje || "—");
  setText("heroVendedora", state.group?.vendedora || state.group?.vendedoraCorreo || "—");
  setText("sheetAno", state.group?.anoViaje || "—");

  const estadoFicha = getFichaEstadoLabel(state.group?.fichaEstado || state.ficha?.estado || "pendiente");
  const tienePdf = !!cleanText(state.ficha?.pdfUrl || state.group?.fichaPdfUrl || "");

  setText("heroFichaEstado", estadoFicha);
  setText(
    "heroFichaEstadoSub",
    state.group?.autorizada
      ? "Grupo autorizado para operaciones"
      : "Todavía no termina el flujo de firmas"
  );

  setText("heroPdfEstado", tienePdf ? "PDF disponible" : "Sin PDF");
  setText(
    "heroPdfEstadoSub",
    tienePdf
      ? (state.ficha?.pdfNombre || "PDF de ficha")
      : "Se enlazará automáticamente en el siguiente paso"
  );

  const ultimaActualizacion = state.group?.fechaActualizacionFicha || state.ficha?.fechaActualizacion || null;
  setText("heroFechaActualizacion", formatDate(ultimaActualizacion));
  setText(
    "heroFechaActualizacionSub",
    ultimaActualizacion
      ? `${getDisplayNameByStored(state.ficha?.actualizadoPor, state.ficha?.actualizadoPorCorreo)}`
      : "Sin guardar aún"
  );

  const puedeEditar = canEditFicha();
  setText("heroPermiso", puedeEditar ? "Editable" : "Solo lectura");
  setText(
    "heroPermisoSub",
    puedeEditar
      ? "Puedes guardar cambios en esta ficha"
      : getBlockedEditMessage()
  );

  const badges = $("heroBadges");
  if (!badges) return;

  badges.innerHTML = `
    <span class="f-badge ok">Estado grupo: ${escapeHtml(getEstadoLabel(state.group?.estado))}</span>
    <span class="f-badge ${state.group?.autorizada ? "ok" : "warn"}">${state.group?.autorizada ? "Autorizada" : "No autorizada"}</span>
    <span class="f-badge ${tienePdf ? "ok" : "muted"}">${tienePdf ? "PDF enlazado" : "PDF pendiente"}</span>
  `;

  setText("sideEstadoFicha", estadoFicha);
  setText("sideVersionFicha", state.ficha?.version || "—");
  setText("sideNumeroNegocio", state.ficha?.numeroNegocio || "—");
  setText("sidePdfGuardado", tienePdf ? "Sí" : "No");
}

function renderResumenGrupo() {
  const box = $("grupoResumenGrid");
  if (!box) return;

  const items = [
    itemMini("Colegio", state.group?.colegio),
    itemMini("Curso", state.group?.curso),
    itemMini("Año viaje", state.group?.anoViaje),
    itemMini("Cantidad grupo", state.group?.cantidadGrupo),
    itemMini("Destino principal", state.group?.destinoPrincipal),
    itemMini("Programa", state.group?.programa),
    itemMini("Estado comercial", getEstadoLabel(state.group?.estado)),
    itemMini("Vendedor(a)", state.group?.vendedora || state.group?.vendedoraCorreo),
    itemMini("1° Contacto", state.group?.nombreCliente),
    itemMini("Correo 1° Contacto", state.group?.correoCliente),
    itemMini("Teléfono 1° Contacto", state.group?.celularCliente),
    itemMini("Observaciones operaciones", stripHtmlPreview(
      getByPath(state.group, "situacion.observacionOperaciones") ||
      state.group?.observacionesOperaciones ||
      ""
    ))
  ];

  box.innerHTML = items.map((item) => `
    <div class="mini-card">
      <div class="mini-label">${escapeHtml(item.label)}</div>
      <div class="mini-value">${escapeHtml(item.value || "—")}</div>
    </div>
  `).join("");
}

function fillForm() {
  const f = state.ficha || {};

  setValue("f_solicitudReserva", f.solicitudReserva);
  setValue("f_nombreGrupo", f.nombreGrupo);
  setValue("f_apoderadoEncargado", f.apoderadoEncargado);
  setValue("f_telefono", f.telefono);
  setValue("f_correo", f.correo);
  setValue("f_nombrePrograma", f.nombrePrograma);
  setValue("f_valorPrograma", f.valorPrograma);
  setValue("f_numeroPaxTotal", f.numeroPaxTotal);
  setValue("f_tramo", f.tramo);
  setValue("f_liberados", f.liberados);
  setValue("f_categoriaHoteleraContratada", f.categoriaHoteleraContratada);
  setValue("f_autorizacionGerencia", f.autorizacionGerencia);
  setValue("f_descuentoValorBase", f.descuentoValorBase);
  setValue("f_fechaViajeTexto", f.fechaViajeTexto);
  setValue("f_asistenciaEnViajes", f.asistenciaEnViajes);
  setValue("f_nombreVendedor", f.nombreVendedor);
  setValue("f_numeroNegocio", f.numeroNegocio);
  setValue("f_usuarioFicha", f.usuarioFicha);
  setValue("f_claveAdministrativa", f.claveAdministrativa);
  setValue("f_version", f.version);
  setValue("f_fechaActualizacionTexto", f.fechaActualizacionTexto);

  setRichEditorHtml("f_infoOperaciones", f.infoOperacionesHtml);
  setRichEditorHtml("f_infoAdministracion", f.infoAdministracionHtml);
  setRichEditorHtml("f_observacionesHtml", f.observacionesHtml);
}

function syncButtons() {
  const editable = canEditFicha();
  const tienePdf = !!cleanText(state.ficha?.pdfUrl || state.group?.fichaPdfUrl || "");

  const btnGuardar = $("btnGuardarFicha");
  if (btnGuardar) btnGuardar.disabled = !editable;

  const btnAbrirPdf = $("btnAbrirPdfFicha");
  if (btnAbrirPdf) btnAbrirPdf.disabled = !tienePdf;

  document.querySelectorAll("#formFicha input, #formFicha select, #formFicha textarea").forEach((el) => {
    el.disabled = !editable;
  });

  ["f_infoOperaciones", "f_infoAdministracion", "f_observacionesHtml"].forEach((id) => {
    const el = $(id);
    if (el) el.contentEditable = editable ? "true" : "false";
  });

  document.querySelectorAll(".rich-btn, .rich-color").forEach((el) => {
    el.disabled = !editable;
  });
}

function renderFatal(message) {
  const shell = document.querySelector(".ficha-shell");
  if (!shell) return;

  shell.innerHTML = `
    <div class="ficha-panel">
      <div class="ficha-panel-body">
        <div class="mini-card">
          <div class="mini-value">${escapeHtml(message)}</div>
        </div>
      </div>
    </div>
  `;
}

/* =========================================================
   EVENTS
========================================================= */
function bindEvents() {
  $("btnVolverGrupo")?.addEventListener("click", () => {
    location.href = `grupo.html?id=${encodeURIComponent(state.groupId || state.requestedId || "")}`;
  });

  $("btnGuardarFicha")?.addEventListener("click", saveFicha);

  $("btnImprimirFicha")?.addEventListener("click", () => {
    window.print();
  });

  $("btnAbrirPdfFicha")?.addEventListener("click", () => {
    const url = cleanText(state.ficha?.pdfUrl || state.group?.fichaPdfUrl || "");
    if (!url) {
      alert("Esta ficha todavía no tiene PDF guardado.");
      return;
    }
    window.open(url, "_blank", "noopener");
  });
}

/* =========================================================
   SAVE
========================================================= */
async function saveFicha() {
  if (!canEditFicha()) {
    alert(getBlockedEditMessage());
    return;
  }

  const oldFicha = state.group?.ficha || {};
  const nowText = formatDateTime(new Date());

  const values = {
    solicitudReserva: getValue("f_solicitudReserva"),
    nombreGrupo: getValue("f_nombreGrupo"),
    apoderadoEncargado: getValue("f_apoderadoEncargado"),
    telefono: getValue("f_telefono"),
    correo: getValue("f_correo"),
    nombrePrograma: getValue("f_nombrePrograma"),
    valorPrograma: getValue("f_valorPrograma"),
    numeroPaxTotal: getValue("f_numeroPaxTotal"),
    tramo: getValue("f_tramo"),
    liberados: getValue("f_liberados"),
    categoriaHoteleraContratada: getValue("f_categoriaHoteleraContratada"),
    autorizacionGerencia: getValue("f_autorizacionGerencia"),
    descuentoValorBase: getValue("f_descuentoValorBase"),
    fechaViajeTexto: getValue("f_fechaViajeTexto"),
    asistenciaEnViajes: getValue("f_asistenciaEnViajes"),
    nombreVendedor: getValue("f_nombreVendedor"),
    numeroNegocio: getValue("f_numeroNegocio"),
    usuarioFicha: getValue("f_usuarioFicha"),
    claveAdministrativa: getValue("f_claveAdministrativa"),
    version: getValue("f_version") || "ORIGINAL",
    fechaActualizacionTexto: nowText,
    infoOperacionesHtml: getRichEditorHtml("f_infoOperaciones"),
    infoAdministracionHtml: getRichEditorHtml("f_infoAdministracion"),
    observacionesHtml: getRichEditorHtml("f_observacionesHtml"),
    pdfUrl: cleanText(oldFicha.pdfUrl || ""),
    pdfNombre: cleanText(oldFicha.pdfNombre || "")
  };

  const cambios = [];

  for (const path of FICHA_FIELDS) {
    const anterior = oldFicha[path];
    const nuevo = values[path];

    const changed = isRichField(path)
      ? normalizeRichHtml(anterior) !== normalizeRichHtml(nuevo)
      : !sameValue(anterior, nuevo);

    if (changed) {
      cambios.push({ campo: `ficha.${path}`, anterior, nuevo });
    }
  }

  const fichaWasEmpty = !Object.keys(oldFicha || {}).length;

  if (!cambios.length && !fichaWasEmpty) {
    alert("No hay cambios para guardar.");
    return;
  }

  const patch = {
    ficha: {
      ...(oldFicha || {}),
      ...values,
      estado: state.group?.fichaEstado && state.group.fichaEstado !== "pendiente"
        ? state.group.fichaEstado
        : "en_edicion",
      actualizadoPor: getDisplayName(state.effectiveUser),
      actualizadoPorCorreo: state.effectiveEmail,
      fechaActualizacion: serverTimestamp()
    },

    solicitudReserva: values.solicitudReserva,
    asistenciaMed: values.asistenciaEnViajes,
    liberados: values.liberados,
    valorPrograma: values.valorPrograma,
    numeroNegocio: values.numeroNegocio,
    versionFicha: values.version,
    fechaActualizacionFicha: serverTimestamp(),
    fechaViaje: values.fechaViajeTexto,
    fichaEstado: state.group?.fichaEstado && state.group.fichaEstado !== "pendiente"
      ? state.group.fichaEstado
      : "en_edicion",

    actualizadoPor: getDisplayName(state.effectiveUser),
    actualizadoPorCorreo: state.effectiveEmail,
    fechaActualizacion: serverTimestamp()
  };

  await setDoc(doc(db, "ventas_cotizaciones", state.groupDocId), patch, { merge: true });

  await addDoc(collection(db, HISTORIAL_COLLECTION), {
    idGrupo: String(state.groupId),
    codigoRegistro: cleanText(state.group?.codigoRegistro),
    aliasGrupo: cleanText(state.group?.aliasGrupo),
    colegio: cleanText(state.group?.colegio),
    tipoMovimiento: fichaWasEmpty ? "ficha_creada" : "ficha_actualizada",
    modulo: "ficha",
    titulo: fichaWasEmpty ? "Creación de ficha" : "Actualización de ficha",
    mensaje: `${getDisplayName(state.effectiveUser)} ${fichaWasEmpty ? "creó" : "actualizó"} la ficha del grupo.`,
    metadata: { cambios },
    creadoPor: getDisplayName(state.effectiveUser),
    creadoPorCorreo: state.effectiveEmail,
    fecha: serverTimestamp()
  });

  alert("Ficha guardada correctamente.");
  await loadAll();
}

/* =========================================================
   DATA BUILD
========================================================= */
function hydrateFicha(group = {}) {
  const ficha = getByPath(group, "ficha") || {};
  const situacion = getByPath(group, "situacion") || {};

  return {
    solicitudReserva: pick(
      ficha.solicitudReserva,
      group.solicitudReserva,
      ""
    ),

    nombreGrupo: pick(
      ficha.nombreGrupo,
      group.aliasGrupo,
      group.nombreGrupo,
      buildDefaultGroupName(group)
    ),

    apoderadoEncargado: pick(
      ficha.apoderadoEncargado,
      group.nombreCliente,
      ""
    ),

    telefono: pick(
      ficha.telefono,
      group.celularCliente,
      ""
    ),

    correo: pick(
      ficha.correo,
      group.correoCliente,
      ""
    ),

    nombrePrograma: pick(
      ficha.nombrePrograma,
      group.programa,
      ""
    ),

    valorPrograma: pick(
      ficha.valorPrograma,
      group.valorPrograma,
      ""
    ),

    numeroPaxTotal: pick(
      ficha.numeroPaxTotal,
      group.cantidadGrupo,
      ""
    ),

    tramo: pick(
      ficha.tramo,
      group.tramo,
      ""
    ),

    liberados: pick(
      ficha.liberados,
      group.liberados,
      ""
    ),

    categoriaHoteleraContratada: pick(
      ficha.categoriaHoteleraContratada,
      group.categoriaHoteleraContratada,
      group.hotel,
      ""
    ),

    autorizacionGerencia: pick(
      ficha.autorizacionGerencia,
      situacion.resumen,
      ""
    ),

    descuentoValorBase: pick(
      ficha.descuentoValorBase,
      "NO"
    ),

    fechaViajeTexto: pick(
      ficha.fechaViajeTexto,
      humanDateLong(group.fechaViaje),
      ""
    ),

    asistenciaEnViajes: pick(
      ficha.asistenciaEnViajes,
      group.asistenciaMed,
      ""
    ),

    nombreVendedor: pick(
      ficha.nombreVendedor,
      group.vendedora,
      ""
    ),

    numeroNegocio: pick(
      ficha.numeroNegocio,
      group.numeroNegocio,
      ""
    ),

    usuarioFicha: pick(
      ficha.usuarioFicha,
      group.codigoRegistro,
      group.idGrupo,
      ""
    ),

    claveAdministrativa: pick(
      ficha.claveAdministrativa,
      ""
    ),

    version: pick(
      ficha.version,
      group.versionFicha,
      "ORIGINAL"
    ),

    fechaActualizacionTexto: pick(
      ficha.fechaActualizacionTexto,
      humanDateLong(group.fechaActualizacionFicha),
      ""
    ),

    infoOperacionesHtml: pick(
      ficha.infoOperacionesHtml,
      situacion.observacionOperaciones,
      group.observacionesOperaciones,
      ""
    ),

    infoAdministracionHtml: pick(
      ficha.infoAdministracionHtml,
      situacion.observacionAdministracion,
      group.observacionesAdministracion,
      ""
    ),

    observacionesHtml: pick(
      ficha.observacionesHtml,
      ""
    ),

    pdfUrl: pick(
      ficha.pdfUrl,
      group.fichaPdfUrl,
      ""
    ),

    pdfNombre: pick(
      ficha.pdfNombre,
      group.fichaPdfNombre,
      ""
    ),

    estado: pick(
      ficha.estado,
      group.fichaEstado,
      "pendiente"
    ),

    actualizadoPor: pick(ficha.actualizadoPor, ""),
    actualizadoPorCorreo: pick(ficha.actualizadoPorCorreo, ""),
    fechaActualizacion: ficha.fechaActualizacion || group.fechaActualizacionFicha || null
  };
}

/* =========================================================
   RICH TEXT
========================================================= */
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
  if (!editor || editor.contentEditable !== "true") return;

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

function isRichField(path = "") {
  return [
    "infoOperacionesHtml",
    "infoAdministracionHtml",
    "observacionesHtml"
  ].includes(path);
}

/* =========================================================
   HELPERS
========================================================= */
function getBlockedEditMessage() {
  if (!state.canModify) {
    return "Tu rol actual es solo de lectura para esta ficha.";
  }

  const isVendor = String(state.effectiveUser?.rol || "").toLowerCase() === "vendedor";

  if (isVendor && isVendorLockedByFlow(state.group)) {
    return "Ya firmaste la ficha. Desde este momento no puedes modificarla; debes solicitar actualización a jefa de ventas.";
  }

  if (state.group?.autorizada && isVendor) {
    return "El grupo ya está autorizado. El vendedor(a) no puede modificar esta ficha directamente.";
  }

  return "No tienes permisos para editar esta ficha.";
}

function getDisplayName(user) {
  const name = [user?.nombre, user?.apellido].filter(Boolean).join(" ").trim();
  return name || user?.email || state.effectiveEmail || "Usuario";
}

function getDisplayNameByStored(name = "", email = "") {
  return cleanText(name) || cleanText(email) || "Sin registro";
}

function getEstadoLabel(value = "") {
  const key = normalizeState(value);
  const map = {
    a_contactar: "A contactar",
    contactado: "Contactado",
    cotizando: "Cotizando",
    recotizando: "Recotizando",
    reunion_confirmada: "Reunión confirmada",
    ganada: "Ganada",
    perdida: "Perdida"
  };
  return map[key] || "A contactar";
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

function buildDefaultGroupName(group = {}) {
  return [
    cleanText(group.aliasGrupo) ||
    cleanText(group.nombreGrupo) ||
    cleanText(group.colegio) ||
    "",
    group.anoViaje ? `(${group.anoViaje})` : ""
  ].filter(Boolean).join(" ");
}

function stripHtmlPreview(html = "") {
  return String(html || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function humanDateLong(value) {
  const d = toDate(value);
  if (!d) return "";
  return d.toLocaleDateString("es-CL", {
    day: "numeric",
    month: "long",
    year: "numeric"
  });
}

function pick(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    if (typeof value === "string" && !value.trim()) continue;
    return value;
  }
  return "";
}

function itemMini(label, value) {
  return {
    label,
    value: String(value ?? "").trim()
  };
}

function setValue(id, value) {
  const el = $(id);
  if (!el) return;
  el.value = value == null ? "" : String(value);
}

function getValue(id) {
  const el = $(id);
  return el ? String(el.value || "").trim() : "";
}

function setText(id, value) {
  const el = $(id);
  if (!el) return;
  el.textContent = String(value ?? "");
}

function sameValue(a, b) {
  return normalizeComparable(a) === normalizeComparable(b);
}

function normalizeComparable(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value).trim();
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

function cleanText(value = "") {
  return String(value || "").trim();
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

function normalizeSearchLocal(value = "") {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
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

function capitalize(value = "") {
  const s = String(value || "").trim();
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function escapeHtml(value = "") {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
