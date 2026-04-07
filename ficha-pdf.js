import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.7.3/firebase-auth.js";
import {
  collection,
  query,
  where,
  getDocs,
  getDoc,
  doc
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

const state = {
  realUser: null,
  effectiveUser: null,
  effectiveEmail: "",
  canSeeAll: false,

  requestedId: "",
  groupDocId: "",
  groupId: "",
  group: null,
  ficha: null
};

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
}

function setHeaderAndScope() {
  setHeaderState({
    realUser: state.realUser,
    effectiveUser: state.effectiveUser,
    scopeText: `Ficha PDF · ${state.requestedId || "Sin ID"}`
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
    renderFatal("No tienes permisos para ver esta ficha PDF.");
    return;
  }

  if (!canOpenFichaPdf()) {
    renderFatal("La ficha PDF solo puede abrirse cuando el grupo está en estado GANADA.");
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

function canOpenFichaPdf() {
  return normalizeState(state.group?.estado) === "ganada";
}

/* =========================================================
   RENDER
========================================================= */
function renderPage() {
  renderHeader();
  renderFields();
  renderRichBlocks();
  renderFooter();
}

function renderHeader() {
  const title =
    cleanText(state.ficha?.nombreGrupo) ||
    cleanText(state.group?.aliasGrupo) ||
    cleanText(state.group?.nombreGrupo) ||
    cleanText(state.group?.colegio) ||
    `Grupo ${state.groupId}`;

  setText("pdfTitle", title);
  setText("pdfIdGrupo", state.groupId);
  setText("pdfColegio", state.group?.colegio || "—");
  setText("pdfCurso", state.group?.curso || "—");
  setText("pdfAnoViaje", state.group?.anoViaje || "—");
  setText("pdfVendedora", state.group?.vendedora || state.group?.vendedoraCorreo || "—");

  const estadoFicha = getFichaEstadoLabel(
    state.group?.fichaEstado ||
    state.ficha?.estado ||
    "pendiente"
  );

  setText("pdfEstadoFicha", estadoFicha);
  setText(
    "pdfEstadoFichaSub",
    state.group?.autorizada
      ? "Grupo autorizado para operaciones"
      : "Flujo todavía no cerrado"
  );

  setText("pdfVersion", state.ficha?.version || "—");
  setText("pdfNumeroNegocio", state.ficha?.numeroNegocio || "—");
  setText(
    "pdfFechaActualizacion",
    state.ficha?.fechaActualizacionTexto ||
    formatDate(state.ficha?.fechaActualizacion) ||
    "Sin fecha"
  );

  setText("pdfSolicitudReserva", state.ficha?.solicitudReserva || "—");

  const chipRow = $("pdfChipRow");
  if (chipRow) {
    chipRow.innerHTML = `
      <span class="pdf-chip">Estado grupo: ${escapeHtml(getEstadoLabel(state.group?.estado))}</span>
      <span class="pdf-chip">${state.group?.autorizada ? "Autorizada" : "No autorizada"}</span>
      <span class="pdf-chip">${cleanText(state.ficha?.pdfUrl || state.group?.fichaPdfUrl || "") ? "PDF previo enlazado" : "Sin PDF enlazado"}</span>
    `;
  }

  const statusRow = $("pdfStatusRow");
  if (statusRow) {
    statusRow.innerHTML = `
      <span class="status-pill ${state.group?.autorizada ? "ok" : "warn"}">
        ${state.group?.autorizada ? "Autorizada" : "Pendiente"}
      </span>
      <span class="status-pill ${cleanText(state.group?.fichaPdfUrl || state.ficha?.pdfUrl || "") ? "ok" : "warn"}">
        ${cleanText(state.group?.fichaPdfUrl || state.ficha?.pdfUrl || "") ? "Con PDF previo" : "Sin PDF previo"}
      </span>
    `;
  }
}

function renderFields() {
  setText("pdfPrograma", state.ficha?.nombrePrograma || state.group?.programa || "—");
  setText("pdfTramo", state.ficha?.tramo || state.group?.tramo || "—");
  setText(
    "pdfHotel",
    state.ficha?.categoriaHoteleraContratada ||
    state.group?.categoriaHoteleraContratada ||
    state.group?.hotel ||
    "—"
  );
  setText(
    "pdfFechaTentativa",
    state.ficha?.fechaViajeTexto ||
    state.group?.semanaViaje ||
    humanDateLong(state.group?.fechaViaje) ||
    "—"
  );

  setText("pdfNombreGrupo", state.ficha?.nombreGrupo || "—");
  setText("pdfApoderado", state.ficha?.apoderadoEncargado || "—");
  setText("pdfTelefono", state.ficha?.telefono || "—");
  setText("pdfCorreo", state.ficha?.correo || "—");
  setText("pdfPax", state.ficha?.numeroPaxTotal || "—");
  setText("pdfLiberados", state.ficha?.liberados || "—");
  setText("pdfValorPrograma", formatMoneyMaybe(state.ficha?.valorPrograma));
  setText("pdfAutorizacionGerencia", state.ficha?.autorizacionGerencia || "—");
  setText("pdfDescuentoValorBase", state.ficha?.descuentoValorBase || "—");
  setText("pdfAsistenciaViajes", state.ficha?.asistenciaEnViajes || "—");
  setText("pdfNombreVendedor", state.ficha?.nombreVendedor || "—");
  setText("pdfUsuarioFicha", state.ficha?.usuarioFicha || "—");
  setText("pdfClaveAdministrativa", state.ficha?.claveAdministrativa || "—");
}

function renderRichBlocks() {
  renderRich("pdfInfoOperaciones", state.ficha?.infoOperacionesHtml);
  renderRich("pdfInfoAdministracion", state.ficha?.infoAdministracionHtml);
  renderRich("pdfObservaciones", state.ficha?.observacionesHtml);
}

function renderFooter() {
  setText("pdfFooterVersion", state.ficha?.version || "—");
  setText(
    "pdfFooterFecha",
    state.ficha?.fechaActualizacionTexto ||
    formatDate(state.ficha?.fechaActualizacion) ||
    "—"
  );
}

function renderFatal(message) {
  document.body.innerHTML = `
    <main style="max-width:820px;margin:40px auto;padding:24px;">
      <div style="background:#fff;border:1px solid rgba(58,42,82,.12);border-radius:20px;padding:22px;box-shadow:0 10px 24px rgba(36,18,56,.08);font-family:Arial,Helvetica,sans-serif;">
        <div style="font-weight:900;font-size:22px;color:#31194b;margin-bottom:8px;">Ficha PDF</div>
        <div style="color:#3a2a52;font-size:15px;line-height:1.5;">${escapeHtml(message)}</div>
      </div>
    </main>
  `;
}

function renderRich(id, html = "") {
  const el = $(id);
  if (!el) return;

  const safe = sanitizeRichHtml(html || "");
  if (!safe) {
    el.innerHTML = `<div class="empty-rich">Sin información registrada.</div>`;
    return;
  }

  el.innerHTML = safe;
}

/* =========================================================
   EVENTS
========================================================= */
function bindEvents() {
  $("btnVolverGrupo")?.addEventListener("click", () => {
    location.href = `grupo.html?id=${encodeURIComponent(state.groupId || state.requestedId || "")}`;
  });

  $("btnAbrirFichaEditable")?.addEventListener("click", () => {
    location.href = `fichas.html?id=${encodeURIComponent(state.groupId || state.requestedId || "")}`;
  });

  $("btnImprimirFichaPdf")?.addEventListener("click", () => {
    window.print();
  });
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
      group.semanaViaje,
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
   HELPERS
========================================================= */
function setText(id, value) {
  const el = $(id);
  if (!el) return;
  el.textContent = String(value ?? "");
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

function pick(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    if (typeof value === "string" && !value.trim()) continue;
    return value;
  }
  return "";
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

function cleanText(value = "") {
  return String(value || "").trim();
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
  if (!d) return "";
  return d.toLocaleDateString("es-CL");
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

function formatMoneyMaybe(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "—";

  const normalized = raw.replace(/[^\d,-.]/g, "");
  const onlyDigits = normalized.replace(/[^\d]/g, "");

  if (!onlyDigits) return raw;

  const n = Number(onlyDigits);
  if (!Number.isFinite(n)) return raw;

  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0
  }).format(n);
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
