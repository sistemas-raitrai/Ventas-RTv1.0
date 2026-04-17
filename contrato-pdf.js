import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.7.3/firebase-auth.js";

import {
  collection,
  query,
  where,
  getDocs,
  getDoc,
  addDoc,
  updateDoc,
  doc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";

import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/11.7.3/firebase-storage.js";

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

const $ = (id) => document.getElementById(id);

const GITHUB_HOME_URL = "https://sistemas-raitrai.github.io/Ventas-RT/";
const HISTORIAL_COLLECTION = "ventas_historial";

const state = {
  realUser: null,
  effectiveUser: null,
  effectiveEmail: "",
  canSeeAll: false,
  requestedId: "",
  groupDocId: "",
  groupId: "",
  group: null,
  ficha: null,
  isSavingPdf: false
};

initPage();

async function initPage() {
  state.requestedId = String(new URLSearchParams(location.search).get("id") || "").trim();

  bindEvents();

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      location.href = "login.html";
      return;
    }

    await bootstrapFromSession();
    await loadAll();
  });
}

/* =========================================================
   SESSION
========================================================= */
async function bootstrapFromSession() {
  state.realUser = getRealUser();
  state.effectiveUser = getEffectiveUser();
  state.effectiveEmail = normalizeEmail(
    state.effectiveUser?.email || state.realUser?.email || auth.currentUser?.email || ""
  );
  state.canSeeAll = puedeVerGeneral(state.effectiveEmail);
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
    renderFatal("No tienes permisos para ver este contrato.");
    return;
  }

  if (!canOpenContratoPdf()) {
    renderFatal("El contrato solo puede abrirse cuando el grupo está en estado GANADA.");
    return;
  }

  state.ficha = hydrateFicha(state.group);
  renderContrato();
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

function canOpenContratoPdf() {
  return normalizeState(state.group?.estado) === "ganada";
}

/* =========================================================
   RENDER
========================================================= */
function renderContrato() {
  setText("ctNombreGrupo", upper(valueOrDash(state.ficha?.nombreGrupo)));
  setText("ctPrograma", upper(valueOrDash(state.ficha?.nombrePrograma)));
  setText("ctFechaViaje", valueOrDash(state.ficha?.fechaViajeTexto));
  setText("ctNumeroNegocio", valueOrDash(state.ficha?.numeroNegocio));

  setText("ctApoderadoInline", upper(valueOrDash(state.ficha?.apoderadoEncargado)));
  setText("ctGrupoInline", upper(valueOrDash(state.ficha?.nombreGrupo)));
  setText("ctProgramaInline", upper(valueOrDash(state.ficha?.nombrePrograma)));
  setText("ctGrupoInline2", upper(valueOrDash(state.ficha?.nombreGrupo)));

  setText("ctApoderado", upper(valueOrDash(state.ficha?.apoderadoEncargado)));
  setText("ctTelefono", valueOrDash(state.ficha?.telefono));
  setText("ctCorreo", valueOrDash(state.ficha?.correo));
  setText("ctPax", valueOrDash(state.ficha?.numeroPaxTotal));
  setText("ctLiberados", valueOrDash(state.ficha?.liberados));
  setText("ctTramo", upper(valueOrDash(state.ficha?.tramo)));
  setText("ctHotel", upper(valueOrDash(state.ficha?.categoriaHoteleraContratada)));
  setText("ctAsistencia", upper(valueOrDash(state.ficha?.asistenciaEnViajes)));
  setText("ctValor", formatMoneyMaybe(state.ficha?.valorPrograma));
  setText("ctValorInline", formatMoneyMaybe(state.ficha?.valorPrograma));
  setText("ctNumeroNegocioInline", valueOrDash(state.ficha?.numeroNegocio));
  setText("ctVendedor", upper(valueOrDash(state.ficha?.nombreVendedor)));
  setText("ctApoderadoFirma", upper(valueOrDash(state.ficha?.apoderadoEncargado)));

  renderRichAsHtml(
    "ctInfoOperaciones",
    state.ficha?.infoOperacionesHtml,
    "Sin observaciones de operaciones."
  );

  renderRichAsHtml(
    "ctInfoAdministracion",
    state.ficha?.infoAdministracionHtml,
    "Sin observaciones de administración."
  );

  renderRichAsHtml(
    "ctObservaciones",
    state.ficha?.observacionesHtml,
    "Sin observaciones generales."
  );
}

/* =========================================================
   EVENTS
========================================================= */
function bindEvents() {
  $("btnVolverFicha")?.addEventListener("click", () => {
    location.href = `fichas.html?id=${encodeURIComponent(state.groupId || state.requestedId || "")}`;
  });

  $("btnVolverGrupo")?.addEventListener("click", () => {
    location.href = `grupo.html?id=${encodeURIComponent(state.groupId || state.requestedId || "")}`;
  });

  $("btnGuardarContratoPdf")?.addEventListener("click", async () => {
    await handleGuardarContratoPdf();
  });
}

async function handleGuardarContratoPdf() {
  if (!state.group || !state.groupDocId || state.isSavingPdf) return;

  state.isSavingPdf = true;
  syncGuardarButton();

  try {
    const fileName = buildContratoPdfName();
    const pdfBlob = await generateRealPdfBlob(fileName);
    const { downloadUrl, storagePath } = await uploadContratoPdfToStorage(pdfBlob, fileName);

    const nombre = getDisplayName(state.effectiveUser);

    await updateDoc(doc(db, "ventas_cotizaciones", state.groupDocId), {
      contratoPdfUrl: downloadUrl,
      contratoPdfNombre: fileName,
      fechaActualizacionContrato: serverTimestamp(),

      "contrato.pdfUrl": downloadUrl,
      "contrato.pdfNombre": fileName,
      "contrato.storagePathPdf": storagePath,
      "contrato.actualizadoPor": nombre,
      "contrato.actualizadoPorCorreo": state.effectiveEmail,
      "contrato.fechaActualizacion": serverTimestamp()
    });

    await addDoc(collection(db, HISTORIAL_COLLECTION), {
      idGrupo: String(state.groupId || ""),
      codigoRegistro: cleanText(state.group?.codigoRegistro || ""),
      aliasGrupo: cleanText(state.group?.aliasGrupo || state.ficha?.nombreGrupo || ""),
      modulo: "contrato",
      tipoMovimiento: "generacion_contrato_pdf",
      titulo: "Generación de contrato PDF",
      asunto: "Generación de contrato PDF",
      mensaje: `${nombre} generó el contrato PDF del grupo.`,
      fecha: serverTimestamp(),
      creadoPor: nombre,
      creadoPorCorreo: state.effectiveEmail,
      metadata: {
        cambios: [
          {
            campo: "contrato.pdfUrl",
            anterior: state.group?.contratoPdfUrl || getByPath(state.group, "contrato.pdfUrl") || "",
            nuevo: downloadUrl
          },
          {
            campo: "contrato.pdfNombre",
            anterior: state.group?.contratoPdfNombre || getByPath(state.group, "contrato.pdfNombre") || "",
            nuevo: fileName
          }
        ]
      }
    });

    downloadBlobLocally(pdfBlob, fileName);
    alert("Contrato PDF generado y guardado correctamente.");
  } catch (error) {
    console.error("[contrato-pdf] handleGuardarContratoPdf", error);
    alert("No se pudo generar el contrato PDF: " + (error?.message || error));
  } finally {
    state.isSavingPdf = false;
    syncGuardarButton();
  }
}

function syncGuardarButton() {
  const btn = $("btnGuardarContratoPdf");
  if (!btn) return;

  if (state.isSavingPdf) {
    btn.disabled = true;
    btn.textContent = "Generando contrato...";
    return;
  }

  btn.disabled = false;
  btn.textContent = "Generar contrato PDF";
}

/* =========================================================
   PDF / STORAGE
========================================================= */
function buildContratoPdfName() {
  const base =
    sanitizeFilePart(
      cleanText(state.group?.aliasGrupo) ||
      cleanText(state.ficha?.nombreGrupo) ||
      `Grupo ${state.groupId}`
    ) || `Grupo ${state.groupId}`;

  return `Contrato ${base}.pdf`;
}

function buildStorageContratoPath(fileName = "") {
  const ano = sanitizeFilePart(String(state.group?.anoViaje || "sin-ano"));
  const id = sanitizeFilePart(String(state.groupId || "sin-id"));
  const safeFile = sanitizeFilePart(fileName || "contrato.pdf");

  return `ventas/contratos/${ano}/${id}/${safeFile}`;
}

function getContratoPageElement() {
  const el = document.querySelector(".pdf-page");
  if (!el) {
    throw new Error("No encontré el contenedor .pdf-page para generar el contrato.");
  }
  return el;
}

async function generateRealPdfBlob(fileName = "contrato.pdf") {
  if (typeof window.html2pdf !== "function") {
    throw new Error("html2pdf.js no está cargado en la página.");
  }

  const element = getContratoPageElement();

  const options = {
    margin: 0,
    filename: fileName,
    image: { type: "jpeg", quality: 0.98 },
    html2canvas: {
      scale: 2,
      useCORS: true,
      backgroundColor: "#ffffff"
    },
    jsPDF: {
      unit: "mm",
      format: "a4",
      orientation: "portrait"
    },
    pagebreak: {
      mode: ["css", "legacy"]
    }
  };

  return await window.html2pdf()
    .set(options)
    .from(element)
    .outputPdf("blob");
}

async function uploadContratoPdfToStorage(blob, fileName = "contrato.pdf") {
  const storage = getStorage();
  const storagePath = buildStorageContratoPath(fileName);
  const storageRef = ref(storage, storagePath);

  await uploadBytes(storageRef, blob, {
    contentType: "application/pdf"
  });

  const downloadUrl = await getDownloadURL(storageRef);

  return {
    downloadUrl,
    storagePath
  };
}

function downloadBlobLocally(blob, fileName = "contrato.pdf") {
  const localUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");

  a.href = localUrl;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();

  setTimeout(() => URL.revokeObjectURL(localUrl), 5000);
}

/* =========================================================
   DATA
========================================================= */
function hydrateFicha(group = {}) {
  const ficha = getByPath(group, "ficha") || {};
  const situacion = getByPath(group, "situacion") || {};

  const observacionesFallbackTexto =
    pick(
      group.observacionesFicha,
      ficha.observacionesGenerales,
      group.observacionesGenerales,
      ""
    ) || "";

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
      group.programaOtro,
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
      group.Hotel,
      group.solicitudHotel,
      ""
    ),

    fechaViajeTexto: pick(
      ficha.fechaViajeTexto,
      group.fechaDeViaje,
      group.fechaViaje,
      group.semanaViaje,
      group.mesViaje,
      ""
    ),

    asistenciaEnViajes: pick(
      ficha.asistenciaEnViajes,
      group.asistenciaEnViajes,
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
      plainTextToRichHtml(observacionesFallbackTexto),
      ""
    )
  };
}

/* =========================================================
   HELPERS
========================================================= */
function renderFatal(message) {
  document.body.innerHTML = `
    <main style="max-width:820px;margin:40px auto;padding:24px;font-family:Arial,Helvetica,sans-serif;">
      <div style="background:#fff;border:1px solid rgba(58,42,82,.12);border-radius:20px;padding:22px;box-shadow:0 10px 24px rgba(36,18,56,.08);">
        <div style="font-weight:900;font-size:22px;color:#31194b;margin-bottom:8px;">Contrato PDF</div>
        <div style="color:#3a2a52;font-size:15px;line-height:1.5;">${escapeHtml(message)}</div>
      </div>
    </main>
  `;
}

function renderRichAsHtml(id, html = "", emptyText = "") {
  const el = $(id);
  if (!el) return;

  const safe = sanitizeRichHtml(html || "");
  if (!safe) {
    el.innerHTML = `<div class="empty">${escapeHtml(emptyText || "Sin contenido.")}</div>`;
    return;
  }

  el.innerHTML = `<div class="pdf-rich">${safe}</div>`;
}

function setText(id, value) {
  const el = $(id);
  if (!el) return;
  el.textContent = String(value ?? "");
}

function valueOrDash(value) {
  const s = String(value ?? "").trim();
  return s || "—";
}

function pick(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    if (typeof value === "string" && !value.trim()) continue;
    return value;
  }
  return "";
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

function buildDefaultGroupName(group = {}) {
  return [
    cleanText(group.aliasGrupo) ||
    cleanText(group.nombreGrupo) ||
    cleanText(group.colegio) ||
    "",
    group.anoViaje ? `(${group.anoViaje})` : ""
  ].filter(Boolean).join(" ");
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

function sanitizeFilePart(value = "") {
  return String(value || "")
    .replace(/[<>:"/\\|?*]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function upper(value = "") {
  return String(value || "").toUpperCase();
}

function getDisplayName(user = {}) {
  const full = [user?.nombre, user?.apellido].filter(Boolean).join(" ").trim();
  if (full) return full;
  if (user?.nombre) return String(user.nombre).trim();
  if (user?.email) return String(user.email).trim();
  return "Usuario";
}

function plainTextToRichHtml(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";

  return raw
    .split(/\n+/)
    .map((line) => `<p>${escapeHtml(line.trim())}</p>`)
    .join("");
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

      if (name === "style") {
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

function escapeHtml(value = "") {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
