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

import {
  buildContratoHtml,
  mapFichaToContratoData,
  getContratoMissingFields,
  CONTRATO_TEMPLATE_VERSION
} from "./contrato-template.js";

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

  contratoData: null,
  contratoHtmlAuto: "",
  contratoHtmlFinal: "",
  contratoManualActivo: false,

  isSavingManual: false,
  isGeneratingPdf: false
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

  buildContractState();
  renderAll();
}

function buildContractState() {
  state.contratoData = mapFichaToContratoData(state.ficha, state.group);
  state.contratoHtmlAuto = buildContratoHtml(state.contratoData);

  const manualActivo = !!getByPath(state.group, "contrato.manual.activo");
  const manualHtml = cleanText(getByPath(state.group, "contrato.manual.htmlEditado") || "");

  state.contratoManualActivo = manualActivo && !!manualHtml;
  state.contratoHtmlFinal = state.contratoManualActivo ? manualHtml : state.contratoHtmlAuto;
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

function canEditManualContract() {
  const rol = String(state.effectiveUser?.rol || "").toLowerCase();
  const email = normalizeEmail(state.effectiveEmail || "");

  if (rol === "admin") return true;
  if (rol === "supervision") return true;

  return (
    email === "yenny@raitrai.cl" ||
    email === "administracion@raitrai.cl" ||
    email === "raitrai@raitrai.cl"
  );
}

function canGeneratePdfContract() {
  return canEditManualContract();
}

/* =========================================================
   RENDER
========================================================= */
function renderAll() {
  renderHeaderSummary();
  renderMissingFields();
  renderContractHtml();
  syncEditorVisibility();
  syncButtons();
}

function renderHeaderSummary() {
  setText("ctTopNombreGrupo", valueOrDash(state.contratoData?.nombreGrupo));
  setText("ctTopPrograma", valueOrDash(state.contratoData?.programaNombre));
  setText("ctTopNumeroNegocio", valueOrDash(state.contratoData?.numeroNegocio));
  setText("ctTopVersion", CONTRATO_TEMPLATE_VERSION);
}

function renderMissingFields() {
  const box = $("contratoMissingFields");
  if (!box) return;

  const missing = getContratoMissingFields(state.contratoData || {});

  if (!missing.length) {
    box.innerHTML = `<div class="ok">Contrato listo para generar.</div>`;
    return;
  }

  box.innerHTML = `
    <div class="warn">
      <strong>Faltan datos recomendados:</strong>
      <ul>${missing.map((field) => `<li>${escapeHtml(field)}</li>`).join("")}</ul>
    </div>
  `;
}

function renderContractHtml() {
  const preview = $("contratoPreview");
  if (!preview) return;

  preview.innerHTML = state.contratoHtmlFinal || `<p class="empty">No se pudo generar el contrato.</p>`;

  const editor = $("contratoEditor");
  if (editor) {
    editor.value = state.contratoHtmlFinal || "";
  }
}

function syncEditorVisibility() {
  const editorWrap = $("contratoEditorWrap");
  const previewWrap = $("contratoPreviewWrap");

  if (!editorWrap || !previewWrap) return;

  const isEditing = editorWrap.dataset.editing === "1";

  editorWrap.style.display = isEditing ? "block" : "none";
  previewWrap.style.display = isEditing ? "none" : "block";
}

function setEditingMode(isEditing) {
  const editorWrap = $("contratoEditorWrap");
  if (!editorWrap) return;

  editorWrap.dataset.editing = isEditing ? "1" : "0";
  syncEditorVisibility();
  syncButtons();
}

function syncButtons() {
  const btnEditar = $("btnEditarContratoManual");
  const btnCancelar = $("btnCancelarEdicionContrato");
  const btnGuardar = $("btnGuardarContratoManual");
  const btnVolverAuto = $("btnVolverAutomatico");
  const btnPdf = $("btnGenerarContratoPdf");
  const editorWrap = $("contratoEditorWrap");

  const isEditing = editorWrap?.dataset.editing === "1";

  if (btnEditar) btnEditar.style.display = canEditManualContract() && !isEditing ? "inline-flex" : "none";
  if (btnCancelar) btnCancelar.style.display = isEditing ? "inline-flex" : "none";
  if (btnGuardar) {
    btnGuardar.style.display = isEditing ? "inline-flex" : "none";
    btnGuardar.disabled = state.isSavingManual;
    btnGuardar.textContent = state.isSavingManual ? "Guardando..." : "Guardar edición manual";
  }

  if (btnVolverAuto) {
    btnVolverAuto.style.display = canEditManualContract() ? "inline-flex" : "none";
    btnVolverAuto.disabled = !state.contratoManualActivo || state.isSavingManual;
  }

  if (btnPdf) {
    btnPdf.disabled = !canGeneratePdfContract() || state.isGeneratingPdf;
    btnPdf.textContent = state.isGeneratingPdf ? "Generando PDF..." : "Generar contrato PDF";
  }
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

  $("btnEditarContratoManual")?.addEventListener("click", () => {
    if (!canEditManualContract()) return;
    setEditingMode(true);
  });

  $("btnCancelarEdicionContrato")?.addEventListener("click", () => {
    renderContractHtml();
    setEditingMode(false);
  });

  $("btnGuardarContratoManual")?.addEventListener("click", async () => {
    await saveManualContract();
  });

  $("btnVolverAutomatico")?.addEventListener("click", async () => {
    await revertToAutomaticContract();
  });

  $("btnGenerarContratoPdf")?.addEventListener("click", async () => {
    await handleGeneratePdf();
  });

  $("btnLogoutContrato")?.addEventListener("click", async () => {
    try {
      sessionStorage.removeItem(ACTING_USER_KEY);
      await signOut(auth);
      location.href = "login.html";
    } catch (error) {
      alert("Error al cerrar sesión: " + (error?.message || error));
    }
  });
}

/* =========================================================
   MANUAL OVERRIDE
========================================================= */
async function saveManualContract() {
  if (!canEditManualContract()) return;
  if (!state.groupDocId || state.isSavingManual) return;

  const editor = $("contratoEditor");
  if (!editor) return;

  const htmlEditado = String(editor.value || "").trim();
  if (!htmlEditado) {
    alert("El contrato manual no puede guardarse vacío.");
    return;
  }

  state.isSavingManual = true;
  syncButtons();

  try {
    const nombre = getDisplayName(state.effectiveUser);
    const groupRef = doc(db, "ventas_cotizaciones", state.groupDocId);

    await updateDoc(groupRef, {
      "contrato.plantilla": CONTRATO_TEMPLATE_VERSION,
      "contrato.htmlGenerado": state.contratoHtmlAuto || "",
      "contrato.actualizadoPor": nombre,
      "contrato.actualizadoPorCorreo": state.effectiveEmail,
      "contrato.fechaActualizacion": serverTimestamp(),

      "contrato.manual.activo": true,
      "contrato.manual.htmlEditado": htmlEditado,
      "contrato.manual.actualizadoPor": nombre,
      "contrato.manual.actualizadoPorCorreo": state.effectiveEmail,
      "contrato.manual.fechaActualizacion": serverTimestamp()
    });

    await addDoc(collection(db, HISTORIAL_COLLECTION), {
      idGrupo: String(state.groupId || ""),
      codigoRegistro: cleanText(state.group?.codigoRegistro || ""),
      aliasGrupo: cleanText(state.group?.aliasGrupo || state.ficha?.nombreGrupo || ""),
      modulo: "contrato",
      tipoMovimiento: "edicion_manual_contrato",
      titulo: "Edición manual de contrato",
      asunto: "Edición manual de contrato",
      mensaje: `${nombre} guardó una edición manual del contrato.`,
      fecha: serverTimestamp(),
      creadoPor: nombre,
      creadoPorCorreo: state.effectiveEmail
    });

    state.group = {
      ...state.group,
      contrato: {
        ...(state.group?.contrato || {}),
        plantilla: CONTRATO_TEMPLATE_VERSION,
        htmlGenerado: state.contratoHtmlAuto || "",
        manual: {
          ...((state.group?.contrato || {}).manual || {}),
          activo: true,
          htmlEditado
        }
      }
    };

    buildContractState();
    renderAll();
    setEditingMode(false);

    alert("Edición manual del contrato guardada correctamente.");
  } catch (error) {
    console.error("[contrato-pdf] saveManualContract", error);
    alert("No se pudo guardar la edición manual: " + (error?.message || error));
  } finally {
    state.isSavingManual = false;
    syncButtons();
  }
}

async function revertToAutomaticContract() {
  if (!canEditManualContract()) return;
  if (!state.groupDocId || state.isSavingManual) return;
  if (!state.contratoManualActivo) return;

  const ok = confirm("Esto desactivará la edición manual y volverá al contrato automático. ¿Continuar?");
  if (!ok) return;

  state.isSavingManual = true;
  syncButtons();

  try {
    const nombre = getDisplayName(state.effectiveUser);
    const groupRef = doc(db, "ventas_cotizaciones", state.groupDocId);

    await updateDoc(groupRef, {
      "contrato.plantilla": CONTRATO_TEMPLATE_VERSION,
      "contrato.htmlGenerado": state.contratoHtmlAuto || "",
      "contrato.actualizadoPor": nombre,
      "contrato.actualizadoPorCorreo": state.effectiveEmail,
      "contrato.fechaActualizacion": serverTimestamp(),

      "contrato.manual.activo": false,
      "contrato.manual.actualizadoPor": nombre,
      "contrato.manual.actualizadoPorCorreo": state.effectiveEmail,
      "contrato.manual.fechaActualizacion": serverTimestamp()
    });

    await addDoc(collection(db, HISTORIAL_COLLECTION), {
      idGrupo: String(state.groupId || ""),
      codigoRegistro: cleanText(state.group?.codigoRegistro || ""),
      aliasGrupo: cleanText(state.group?.aliasGrupo || state.ficha?.nombreGrupo || ""),
      modulo: "contrato",
      tipoMovimiento: "volver_contrato_automatico",
      titulo: "Volver a contrato automático",
      asunto: "Volver a contrato automático",
      mensaje: `${nombre} desactivó la edición manual y volvió al contrato automático.`,
      fecha: serverTimestamp(),
      creadoPor: nombre,
      creadoPorCorreo: state.effectiveEmail
    });

    state.group = {
      ...state.group,
      contrato: {
        ...(state.group?.contrato || {}),
        plantilla: CONTRATO_TEMPLATE_VERSION,
        htmlGenerado: state.contratoHtmlAuto || "",
        manual: {
          ...((state.group?.contrato || {}).manual || {}),
          activo: false
        }
      }
    };

    buildContractState();
    renderAll();
    setEditingMode(false);

    alert("El contrato volvió a la versión automática.");
  } catch (error) {
    console.error("[contrato-pdf] revertToAutomaticContract", error);
    alert("No se pudo volver al contrato automático: " + (error?.message || error));
  } finally {
    state.isSavingManual = false;
    syncButtons();
  }
}

/* =========================================================
   PDF
========================================================= */
async function handleGeneratePdf() {
  if (!canGeneratePdfContract()) return;
  if (!state.groupDocId || state.isGeneratingPdf) return;

  state.isGeneratingPdf = true;
  syncButtons();

  try {
    const fileName = buildContratoPdfName();
    const pdfBlob = await generateRealPdfBlob(fileName);
    const { downloadUrl, storagePath } = await uploadContratoPdfToStorage(pdfBlob, fileName);

    const nombre = getDisplayName(state.effectiveUser);
    const groupRef = doc(db, "ventas_cotizaciones", state.groupDocId);

    await updateDoc(groupRef, {
      "contrato.plantilla": CONTRATO_TEMPLATE_VERSION,
      "contrato.htmlGenerado": state.contratoHtmlAuto || "",
      "contrato.htmlFinal": state.contratoHtmlFinal || "",

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

    state.group = {
      ...state.group,
      contratoPdfUrl: downloadUrl,
      contratoPdfNombre: fileName,
      contrato: {
        ...(state.group?.contrato || {}),
        pdfUrl: downloadUrl,
        pdfNombre: fileName,
        storagePathPdf: storagePath
      }
    };

    alert("Contrato PDF generado y guardado correctamente.");
  } catch (error) {
    console.error("[contrato-pdf] handleGeneratePdf", error);
    alert("No se pudo generar el contrato PDF: " + (error?.message || error));
  } finally {
    state.isGeneratingPdf = false;
    syncButtons();
  }
}

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
  const el = document.querySelector(".contrato-page");
  if (!el) {
    throw new Error("No encontré el contenedor .contrato-page para generar el contrato.");
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

function escapeHtml(value = "") {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
