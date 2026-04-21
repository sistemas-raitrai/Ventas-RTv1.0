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
  setHeaderState,
  renderActingUserSwitcher,
  bindLayoutButtons,
  waitForLayoutReady
} from "./ui.js";

import { PDFDocument } from "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm";

const $ = (id) => document.getElementById(id);
const GITHUB_HOME_URL = "https://sistemas-raitrai.github.io/Ventas-RT/";
const HISTORIAL_COLLECTION = "ventas_historial";
const MAIL_COLLECTION = "mail";
const FICHA_ALERT_EMAIL = "aleoperaciones@raitrai.cl";

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
  isClosingPdf: false
};

initPage();

function ensurePdfStatusBox() {
  let box = document.getElementById("pdfStatusBox");
  if (box) return box;

  box = document.createElement("div");
  box.id = "pdfStatusBox";
  box.style.position = "fixed";
  box.style.right = "18px";
  box.style.bottom = "18px";
  box.style.zIndex = "99999";
  box.style.maxWidth = "360px";
  box.style.padding = "12px 14px";
  box.style.borderRadius = "14px";
  box.style.background = "#2f2340";
  box.style.color = "#fff";
  box.style.boxShadow = "0 10px 26px rgba(0,0,0,.22)";
  box.style.fontSize = "14px";
  box.style.lineHeight = "1.4";
  box.style.display = "none";

  document.body.appendChild(box);
  return box;
}

function showPdfStatus(message, isError = false) {
  const box = ensurePdfStatusBox();
  box.textContent = String(message || "");
  box.style.display = "block";
  box.style.background = isError ? "#7a1f1f" : "#2f2340";
}

function hidePdfStatus(delay = 0) {
  const box = ensurePdfStatusBox();

  if (delay > 0) {
    setTimeout(() => {
      box.style.display = "none";
    }, delay);
    return;
  }

  box.style.display = "none";
}

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

function isVendorPdfReadOnlyView() {
  return String(state.effectiveUser?.rol || "").toLowerCase() === "vendedor";
}

function canSeePdfTopActions() {
  return !isVendorPdfReadOnlyView();
}

function syncPdfTopActionsVisibility() {
  const box = $("pdfTopActions");
  if (!box) return;

  const visible = canSeePdfTopActions();

  box.classList.toggle("pdf-top-actions--visible", visible);
  box.setAttribute("aria-hidden", visible ? "false" : "true");
}

/* =========================================================
   RENDER
========================================================= */
function renderPage() {
  setText("pdfAnoTitulo", state.group?.anoViaje || "—");
  setText("pdfSolicitudReserva", formatDateForDisplay(state.ficha?.solicitudReserva));
  setText("pdfNombreGrupo", valueOrDash(state.ficha?.nombreGrupo).toUpperCase());
  setText("pdfApoderadoEncargado", valueOrDash(state.ficha?.apoderadoEncargado).toUpperCase());
  setText("pdfTelefono", valueOrDash(state.ficha?.telefono));
  setText("pdfCorreo", valueOrDash(state.ficha?.correo));
  setText("pdfNombrePrograma", valueOrDash(state.ficha?.nombrePrograma).toUpperCase());
  setText("pdfValorPrograma", formatMoneyMaybe(state.ficha?.valorPrograma));
  setText("pdfNumeroPaxTotal", valueOrDash(state.ficha?.numeroPaxTotal));
  setText("pdfTramo", valueOrDash(state.ficha?.tramo));
  setText("pdfLiberados", valueOrDash(state.ficha?.liberados));
  setText("pdfCategoriaHoteleraContratada", valueOrDash(state.ficha?.categoriaHoteleraContratada).toUpperCase());
  setText("pdfAutorizacionGerencia", valueOrDash(state.ficha?.autorizacionGerencia).toUpperCase());
  setText("pdfDescuentoValorBase", valueOrDash(state.ficha?.descuentoValorBase).toUpperCase());
  setText("pdfFechaViajeTexto", valueOrDash(state.ficha?.fechaViajeTexto));
  setText("pdfAsistenciaEnViajes", valueOrDash(state.ficha?.asistenciaEnViajes).toUpperCase());
  setText("pdfNombreVendedor", valueOrDash(state.ficha?.nombreVendedor).toUpperCase());
  setText("pdfNumeroNegocio", valueOrDash(state.ficha?.numeroNegocio));
  setText("pdfUsuarioFicha", valueOrDash(state.ficha?.usuarioFicha));
  setText("pdfClaveAdministrativa", valueOrDash(state.ficha?.claveAdministrativa));
  setText("pdfVersionFicha", getFichaVersionLabel(state.ficha));
  setText("pdfFechaActualizacion", valueOrDash(state.ficha?.fechaActualizacionTexto));

  renderRichAsHtml("pdfInfoOperaciones", state.ficha?.infoOperacionesHtml);
  renderRichAsHtml("pdfInfoAdministracion", state.ficha?.infoAdministracionHtml);
  renderRichAsHtml("pdfObservaciones", state.ficha?.observacionesHtml);

  syncPdfTopActionsVisibility();
  syncPrintButton();
}

/* =========================================================
   EVENTS
========================================================= */
function bindEvents() {
  $("btnVolverFichaEditable")?.addEventListener("click", () => {
    location.href = `fichas.html?id=${encodeURIComponent(state.groupId || state.requestedId || "")}`;
  });

  $("btnVolverGrupo")?.addEventListener("click", () => {
    location.href = `grupo.html?id=${encodeURIComponent(state.groupId || state.requestedId || "")}`;
  });

  $("btnImprimirFichaPdf")?.addEventListener("click", async () => {
    await handlePrintButtonClick();
  });
}

async function handlePrintButtonClick() {
  if (!state.group) return;
  if (state.isClosingPdf) return;

  if (isVendorPdfReadOnlyView()) {
    return;
  }

  const alreadyConfirmed = isPdfOfficiallyConfirmed();
  const existingPdfUrl = getExistingPdfUrl();

  if (alreadyConfirmed && existingPdfUrl) {
    const wantsOpenExisting = window.confirm(
      "Esta ficha ya tiene un PDF real generado.\n\nAceptar = abrir el PDF actual.\nCancelar = continuar para generar una nueva versión."
    );
  
    if (wantsOpenExisting) {
      window.open(existingPdfUrl, "_blank", "noopener");
      return;
    }
  
    const claveNuevaVersion = window.prompt(
      "Para generar una nueva versión, ingresa la clave de autorización:"
    );
  
    if (claveNuevaVersion === null) {
      showPdfStatus("Generación de nueva versión cancelada.");
      hidePdfStatus(2500);
      return;
    }
  
    if (String(claveNuevaVersion).trim() !== "Raitrai2026") {
      showPdfStatus("Clave incorrecta. No se generó una nueva versión.", true);
      alert("Clave incorrecta. No autorizado para generar una nueva versión.");
      hidePdfStatus(4000);
      return;
    }
  }

  if (!alreadyConfirmed && !canFinalizeFichaPdf()) {
    alert(getFinalizeBlockedMessage());
    return;
  }

  if (alreadyConfirmed && !canFinalizeFichaAsCurrentUser()) {
    alert("Solo admin, yenny@raitrai.cl o administracion@raitrai.cl pueden regenerar este PDF real.");
    return;
  }

  const alias =
    cleanText(state.group?.aliasGrupo) ||
    cleanText(state.ficha?.nombreGrupo) ||
    `Grupo ${state.groupId}`;

  const ok = window.confirm(
    alreadyConfirmed
      ? `La ficha ${alias} ya está confirmada. Vas a generar y guardar el PDF real en Storage usando la versión actual.`
      : `Vas a confirmar oficialmente la ficha del grupo ${alias} y generar el PDF real en Storage.`
  );

  if (!ok) return;

  state.isClosingPdf = true;
  syncPrintButton();
  showPdfStatus(
    alreadyConfirmed
      ? "Generando nueva versión del PDF real..."
      : "Generando PDF real..."
  );
  
  try {
    const result = await confirmOfficialPdfClosure({
      preserveCurrentVersion: false
    });
  
    showPdfStatus("Actualizando datos de la ficha...");
    await loadAll();
  
    if (result?.blob && result?.pdfNombre) {
      showPdfStatus("Descargando PDF generado...");
      downloadBlobLocally(result.blob, result.pdfNombre);
    }
  
    if (result?.emailQueued === false) {
      showPdfStatus("PDF generado correctamente, pero el correo quedó pendiente.", true);
      alert("El PDF real se generó y guardó correctamente, pero el correo quedó pendiente de envío.");
      hidePdfStatus(5000);
      return;
    }
  
    showPdfStatus("PDF real generado correctamente.");
    alert("PDF real generado, subido a Storage y enlazado correctamente.");
    hidePdfStatus(3500);
  } catch (error) {
    console.error("[ficha-pdf] confirmOfficialPdfClosure", error);
    showPdfStatus("Error al generar el PDF real: " + (error?.message || error), true);
    alert("No se pudo generar el PDF real: " + (error?.message || error));
    hidePdfStatus(7000);
  } finally {
    state.isClosingPdf = false;
    syncPrintButton();
  }
}

function syncPrintButton() {
  const btn = $("btnImprimirFichaPdf");
  if (!btn) return;

  if (state.isClosingPdf) {
    btn.disabled = true;
    btn.textContent = "Generando PDF real...";
    return;
  }

  const existingPdfUrl = getExistingPdfUrl();

  if (isPdfOfficiallyConfirmed()) {
    btn.disabled = !canFinalizeFichaAsCurrentUser();
  
    if (state.isClosingPdf) {
      btn.textContent = "Generando nueva versión...";
    } else {
      btn.textContent = existingPdfUrl
        ? "Abrir PDF real / Generar nueva versión"
        : "Generar PDF real";
    }
  
    return;
  }

  btn.disabled = !canFinalizeFichaPdf();
  btn.textContent = "Confirmar y generar PDF real";
}

function canFinalizeFichaPdf() {
  if (!canFinalizeFichaAsCurrentUser()) return false;
  if (!state.group || !state.groupDocId) return false;
  if (!canAccessGroup(state.group)) return false;
  if (!hasProgramaPdf()) return false;

  const flow = state.group.flowFicha || {};
  const fichaEstado = normalizeSearchLocal(state.group?.fichaEstado || "");
  const adminFirmado = !!flow?.administracion?.firmado;

  return fichaEstado === "autorizada_admin" && adminFirmado;
}

function getFinalizeBlockedMessage() {
  if (!canFinalizeFichaAsCurrentUser()) {
    return "Solo admin, yenny@raitrai.cl o administracion@raitrai.cl pueden confirmar oficialmente esta ficha para impresión.";
  }

  if (!hasProgramaPdf()) {
    return "Falta subir el Programa PDF obligatorio para cerrar la ficha.";
  }

  const flow = state.group?.flowFicha || {};
  if (!flow?.administracion?.firmado) {
    return "Primero debe existir la firma de administración.";
  }

  if (normalizeSearchLocal(state.group?.fichaEstado || "") !== "autorizada_admin") {
    return "La ficha todavía no está en estado autorizada por administración.";
  }

  return "La ficha todavía no está lista para cierre oficial.";
}

function isPdfOfficiallyConfirmed() {
  const fichaEstado = normalizeSearchLocal(state.group?.fichaEstado || "");
  const ficha = getByPath(state.group, "ficha") || {};

  return (
    fichaEstado === "confirmada_pdf" ||
    fichaEstado === "pdf_confirmado" ||
    ficha.confirmada === true
  );
}

function canFinalizeFichaAsCurrentUser() {
  const email = normalizeEmail(state.effectiveEmail || "");
  const rol = String(state.effectiveUser?.rol || "").toLowerCase();

  if (rol === "admin") return true;

  return (
    email === "yenny@raitrai.cl" ||
    email === "administracion@raitrai.cl" ||
    email === "raitrai@raitrai.cl"
  );
}

function getDisplayName(user = {}) {
  const full = [user?.nombre, user?.apellido].filter(Boolean).join(" ").trim();
  if (full) return full;
  if (user?.nombre) return String(user.nombre).trim();
  if (user?.email) return String(user.email).trim();
  return "Usuario";
}

function resolveNextFichaVersion() {
  const fichaActual = getByPath(state.group, "ficha") || {};

  const prevNumeroRaw = pick(
    fichaActual.versionNumero,
    state.group?.versionFichaNumero,
    ""
  );

  const prevNumero = Number(prevNumeroRaw);

  const prevTipo = normalizeSearchLocal(
    pick(
      fichaActual.tipoVersion,
      fichaActual.version,
      state.group?.tipoVersionFicha,
      state.group?.versionFicha,
      ""
    )
  );

  const hasPreviousVersion =
    (Number.isFinite(prevNumero) && prevNumero > 0) ||
    prevTipo.includes("original") ||
    prevTipo.includes("actualiz");

  if (!hasPreviousVersion) {
    return {
      tipoVersion: "original",
      version: "ORIGINAL",
      versionNumero: 1
    };
  }

  return {
    tipoVersion: "actualizacion",
    version: "ACTUALIZACIÓN",
    versionNumero: Number.isFinite(prevNumero) && prevNumero > 0 ? prevNumero + 1 : 2
  };
}

function getFichaVersionLabel(ficha = {}) {
  const version = cleanText(ficha?.version || "ORIGINAL").toUpperCase();
  const numero = Number(ficha?.versionNumero || 0);

  if (version === "ORIGINAL") return "ORIGINAL";
  if (version === "ACTUALIZACIÓN" && numero > 1) return `ACTUALIZACIÓN ${numero}`;
  if (version === "ACTUALIZACIÓN") return "ACTUALIZACIÓN";

  return version || "ORIGINAL";
}

function getExistingPdfUrl() {
  return cleanText(
    state.ficha?.pdfUrl ||
    state.group?.fichaPdfUrl ||
    getByPath(state.group, "ficha.pdfUrl") ||
    ""
  );
}

function getProgramaPdfUrl() {
  return cleanText(
    state.ficha?.programaPdfUrl ||
    getByPath(state.group, "ficha.programaPdfUrl") ||
    state.group?.programaPdfUrl ||
    ""
  );
}

function getProgramaPdfNombre() {
  return cleanText(
    state.ficha?.programaPdfNombre ||
    getByPath(state.group, "ficha.programaPdfNombre") ||
    state.group?.programaPdfNombre ||
    ""
  );
}

function hasProgramaPdf() {
  return !!getProgramaPdfUrl();
}

async function fetchPdfBytesFromUrl(url = "") {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`No se pudo descargar el Programa PDF (${response.status}).`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

async function mergeFichaAndProgramaPdf(fichaBlob, programaPdfUrl) {
  const mergedPdf = await PDFDocument.create();

  const fichaBytes = new Uint8Array(await fichaBlob.arrayBuffer());
  const fichaPdf = await PDFDocument.load(fichaBytes);

  const programaBytes = await fetchPdfBytesFromUrl(programaPdfUrl);
  const programaPdf = await PDFDocument.load(programaBytes);

  const fichaPages = await mergedPdf.copyPages(fichaPdf, fichaPdf.getPageIndices());
  fichaPages.forEach((page) => mergedPdf.addPage(page));

  const programaPages = await mergedPdf.copyPages(programaPdf, programaPdf.getPageIndices());
  programaPages.forEach((page) => mergedPdf.addPage(page));

  const mergedBytes = await mergedPdf.save();

  return new Blob([mergedBytes], { type: "application/pdf" });
}

function getCurrentVersionData() {
  const fichaActual = getByPath(state.group, "ficha") || {};

  return {
    tipoVersion: pick(
      fichaActual.tipoVersion,
      state.group?.tipoVersionFicha,
      "original"
    ),
    version: pick(
      fichaActual.version,
      state.group?.versionFicha,
      "ORIGINAL"
    ),
    versionNumero: Number(
      pick(
        fichaActual.versionNumero,
        state.group?.versionFichaNumero,
        1
      )
    ) || 1
  };
}

function sanitizePdfFilePart(value = "") {
  return String(value || "")
    .replace(/[<>:"/\\|?*]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildConfirmedPdfName(versionLabel = "") {
  const base =
    sanitizePdfFilePart(
      cleanText(state.group?.aliasGrupo) ||
      cleanText(state.ficha?.nombreGrupo) ||
      `Grupo ${state.groupId}`
    ) || `Grupo ${state.groupId}`;

  const version =
    sanitizePdfFilePart(versionLabel || "ORIGINAL") || "ORIGINAL";

  return `Ficha ${base} - ${version}.pdf`;
}

function buildStoragePdfPath(fileName = "") {
  const ano = sanitizePdfFilePart(String(state.group?.anoViaje || "sin-ano"));
  const id = sanitizePdfFilePart(String(state.groupId || "sin-id"));
  const safeFile = sanitizePdfFilePart(fileName || "ficha.pdf");

  return `ventas/fichas-pdf/${ano}/${id}/${safeFile}`;
}

function getPdfPageElement() {
  const el = document.querySelector(".pdf-page");
  if (!el) {
    throw new Error("No encontré el contenedor .pdf-page para generar el PDF.");
  }
  return el;
}

async function generateRealPdfBlob(fileName = "ficha.pdf") {
  if (typeof window.html2pdf !== "function") {
    throw new Error("html2pdf.js no está cargado en la página.");
  }

  const element = getPdfPageElement();

  const options = {
    margin: [0, 0, 0, 0],
    filename: fileName,
    image: { type: "jpeg", quality: 0.98 },
    html2canvas: {
      scale: 2,
      useCORS: true,
      backgroundColor: "#ffffff",
      scrollY: 0
    },
    jsPDF: {
      unit: "mm",
      format: "a4",
      orientation: "portrait"
    },
    pagebreak: {
      mode: ["css"]
    }
  };

  return await window.html2pdf()
    .set(options)
    .from(element)
    .outputPdf("blob");
}

async function uploadRealPdfToStorage(blob, fileName = "ficha.pdf") {
  const storage = getStorage();
  const storagePath = buildStoragePdfPath(fileName);
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

function downloadBlobLocally(blob, fileName = "ficha.pdf") {
  const localUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");

  a.href = localUrl;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();

  setTimeout(() => URL.revokeObjectURL(localUrl), 5000);
}

async function queueFichaConfirmationEmail({ versionLabel, nombre }) {
  const alias =
    cleanText(state.group?.aliasGrupo) ||
    cleanText(state.ficha?.nombreGrupo) ||
    `Grupo ${state.groupId}`;

  const idGrupo = String(state.groupId || "");
  const numeroNegocio = cleanText(state.ficha?.numeroNegocio || state.group?.numeroNegocio || "");
  const solicitudReserva = formatDateForDisplay(
    state.ficha?.solicitudReserva || state.group?.solicitudReserva || ""
  );
  
  const anoViaje = cleanText(state.group?.anoViaje || "");
  const subject = `Nueva versión de ficha | ID ${idGrupo} | ${alias}`;

  const text = [
    "Se confirmó oficialmente una nueva versión de la ficha.",
    "",
    `ID Grupo: ${idGrupo}`,
    `Alias: ${alias}`,
    `Versión: ${versionLabel}`,
    `Año de viaje: ${anoViaje || "-"}`,
    `N° Negocio: ${numeroNegocio || "-"}`,
    `Fecha solicitud reserva: ${solicitudReserva || "-"}`,
    `Confirmada por: ${nombre}`,
    `Correo usuario: ${state.effectiveEmail || "-"}`,
    "",
    "Este aviso fue generado automáticamente desde ficha-pdf.js."
  ].join("\n");

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#2d2240;line-height:1.5;">
      <h2 style="margin:0 0 12px;">Nueva versión de ficha confirmada</h2>
      <p style="margin:0 0 12px;">Se confirmó oficialmente una nueva versión de la ficha.</p>

      <table style="border-collapse:collapse;">
        <tr><td style="padding:4px 10px 4px 0;"><strong>ID Grupo:</strong></td><td>${escapeHtml(idGrupo)}</td></tr>
        <tr><td style="padding:4px 10px 4px 0;"><strong>Alias:</strong></td><td>${escapeHtml(alias)}</td></tr>
        <tr><td style="padding:4px 10px 4px 0;"><strong>Versión:</strong></td><td>${escapeHtml(versionLabel)}</td></tr>
        <tr><td style="padding:4px 10px 4px 0;"><strong>Año de viaje:</strong></td><td>${escapeHtml(anoViaje || "-")}</td></tr>
        <tr><td style="padding:4px 10px 4px 0;"><strong>N° Negocio:</strong></td><td>${escapeHtml(numeroNegocio || "-")}</td></tr>
        <tr><td style="padding:4px 10px 4px 0;"><strong>Fecha solicitud reserva:</strong></td><td>${escapeHtml(solicitudReserva || "-")}</td></tr>
        <tr><td style="padding:4px 10px 4px 0;"><strong>Confirmada por:</strong></td><td>${escapeHtml(nombre)}</td></tr>
        <tr><td style="padding:4px 10px 4px 0;"><strong>Correo usuario:</strong></td><td>${escapeHtml(state.effectiveEmail || "-")}</td></tr>
      </table>

      <p style="margin:16px 0 0;font-size:12px;color:#6b6280;">
        Este aviso fue generado automáticamente desde ficha-pdf.js.
      </p>
    </div>
  `;

  await addDoc(collection(db, MAIL_COLLECTION), {
    to: [FICHA_ALERT_EMAIL],
    message: {
      subject,
      text,
      html
    },
    meta: {
      tipo: "ficha_confirmada_pdf",
      idGrupo,
      aliasGrupo: alias,
      version: versionLabel,
      creadoPor: nombre,
      creadoPorCorreo: state.effectiveEmail || ""
    }
  });

  return { subject };
}

async function confirmOfficialPdfClosure({ preserveCurrentVersion = false } = {}) {
  const nombre = getDisplayName(state.effectiveUser);
  const fichaActual = getByPath(state.group, "ficha") || {};
  const flow = state.group.flowFicha || {};
  const groupRef = doc(db, "ventas_cotizaciones", state.groupDocId);

  const versionData = preserveCurrentVersion
    ? getCurrentVersionData()
    : resolveNextFichaVersion();

  const versionLabel = getFichaVersionLabel(versionData);
  const pdfNombre = buildConfirmedPdfName(versionLabel);

  const programaPdfUrl = getProgramaPdfUrl();
  const programaPdfNombre = getProgramaPdfNombre();
  
  if (!programaPdfUrl) {
    throw new Error("No existe Programa PDF cargado para esta ficha.");
  }
  
  // 1) generar PDF base de la ficha
  const fichaBlob = await generateRealPdfBlob(pdfNombre);
  
  // 2) unir físicamente la ficha + programa PDF
  const pdfBlob = await mergeFichaAndProgramaPdf(fichaBlob, programaPdfUrl);
  
  // 3) subir PDF combinado a Firebase Storage
  const { downloadUrl, storagePath } = await uploadRealPdfToStorage(pdfBlob, pdfNombre);

  // 3) guardar URL real en Firestore
  await updateDoc(groupRef, {
    fichaEstado: "confirmada_pdf",
    autorizada: true,
    ultimaGestionAt: serverTimestamp(),
    ultimaGestionTipo: "confirmacion_ficha_pdf",

    fichaPdfUrl: downloadUrl,
    fichaPdfNombre: pdfNombre,

    versionFicha: versionData.version,
    tipoVersionFicha: versionData.tipoVersion,
    versionFichaNumero: versionData.versionNumero,
    fechaActualizacionFicha: serverTimestamp(),

    "ficha.estado": "confirmada_pdf",
    "ficha.confirmada": true,
    "ficha.confirmadaEl": serverTimestamp(),
    "ficha.confirmadaPor": nombre,
    "ficha.confirmadaPorCorreo": state.effectiveEmail,
    "ficha.pdfUrl": downloadUrl,
    "ficha.pdfNombre": pdfNombre,
    "ficha.storagePathPdf": storagePath,
    "ficha.pdfPendienteGeneracion": false,
    "ficha.pendienteEnvioCorreo": true,
    "ficha.version": versionData.version,
    "ficha.tipoVersion": versionData.tipoVersion,
    "ficha.versionNumero": versionData.versionNumero,
    "ficha.fechaActualizacion": serverTimestamp(),
    "ficha.actualizadoPor": nombre,
    "ficha.actualizadoPorCorreo": state.effectiveEmail,
    "ficha.programaPdfIncluido": true,
    "ficha.programaPdfIncluidoNombre": programaPdfNombre || "",

    "flowFicha.estado": "confirmada_pdf",
    "flowFicha.administracion.firmado": !!flow?.administracion?.firmado,
    "flowFicha.administracion.firmadoPor": flow?.administracion?.firmadoPor || nombre,
    "flowFicha.administracion.firmadoPorCorreo": flow?.administracion?.firmadoPorCorreo || state.effectiveEmail,

    "documentos.fichaGrupo.estado": "confirmada_pdf"
  });

  await addDoc(collection(db, HISTORIAL_COLLECTION), {
    idGrupo: String(state.groupId || ""),
    codigoRegistro: cleanText(state.group?.codigoRegistro || ""),
    aliasGrupo: cleanText(state.group?.aliasGrupo || state.ficha?.nombreGrupo || ""),
    modulo: "ficha",
    tipoMovimiento: "confirmacion_ficha_pdf",
    titulo: "Confirmación oficial de ficha PDF",
    asunto: "Confirmación oficial de ficha PDF",
    mensaje: `${nombre} confirmó oficialmente la ficha y generó el PDF real (${versionLabel}).`,
    fecha: serverTimestamp(),
    creadoPor: nombre,
    creadoPorCorreo: state.effectiveEmail,
    metadata: {
      cambios: [
        {
          campo: "fichaEstado",
          anterior: state.group?.fichaEstado || "",
          nuevo: "confirmada_pdf"
        },
        {
          campo: "ficha.confirmada",
          anterior: !!fichaActual?.confirmada,
          nuevo: true
        },
        {
          campo: "ficha.confirmadaPor",
          anterior: fichaActual?.confirmadaPor || "",
          nuevo: nombre
        },
        {
          campo: "ficha.version",
          anterior: fichaActual?.version || state.group?.versionFicha || "",
          nuevo: versionData.version
        },
        {
          campo: "ficha.versionNumero",
          anterior: fichaActual?.versionNumero || state.group?.versionFichaNumero || "",
          nuevo: versionData.versionNumero
        },
        {
          campo: "ficha.pdfUrl",
          anterior: fichaActual?.pdfUrl || state.group?.fichaPdfUrl || "",
          nuevo: downloadUrl
        },
        {
          campo: "ficha.pdfNombre",
          anterior: fichaActual?.pdfNombre || state.group?.fichaPdfNombre || "",
          nuevo: pdfNombre
        },
        {
          campo: "ficha.pendienteEnvioCorreo",
          anterior: !!fichaActual?.pendienteEnvioCorreo,
          nuevo: true
        },
        {
          campo: "ficha.programaPdfIncluido",
          anterior: !!fichaActual?.programaPdfIncluido,
          nuevo: true
        },
        {
          campo: "ficha.programaPdfIncluidoNombre",
          anterior: fichaActual?.programaPdfIncluidoNombre || "",
          nuevo: programaPdfNombre || ""
        }
      ]
    }
  });

  let emailQueued = false;

  try {
    const emailInfo = await queueFichaConfirmationEmail({
      versionLabel,
      nombre
    });

    emailQueued = true;

    await updateDoc(groupRef, {
      "ficha.pendienteEnvioCorreo": false,
      "ficha.ultimoCorreoEstado": "encolado",
      "ficha.ultimoCorreoDestinatario": FICHA_ALERT_EMAIL,
      "ficha.ultimoCorreoAsunto": emailInfo.subject || "",
      "ficha.ultimoCorreoEl": serverTimestamp()
    });
  } catch (emailError) {
    console.error("[ficha-pdf] queueFichaConfirmationEmail", emailError);

    await updateDoc(groupRef, {
      "ficha.pendienteEnvioCorreo": true,
      "ficha.ultimoCorreoEstado": "error"
    });
  }

  try {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage({
        type: "ficha-pdf-saved",
        ok: true,
        pdfUrl: downloadUrl,
        pdfNombre
      }, "*");
    }
  } catch (postMessageError) {
    console.warn("[ficha-pdf] postMessage", postMessageError);
  }

  return {
    emailQueued,
    pdfUrl: downloadUrl,
    pdfNombre,
    blob: pdfBlob
  };
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

    programaPdfUrl: pick(
      ficha.programaPdfUrl,
      group.programaPdfUrl,
      ""
    ),

    programaPdfNombre: pick(
      ficha.programaPdfNombre,
      group.programaPdfNombre,
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

    autorizacionGerencia: pick(
      ficha.autorizacionGerencia,
      group.autorizacionGerencia,
      group.Autorizacion,
      group.autorizacion,
      situacion.resumen,
      ""
    ),

    descuentoValorBase: pick(
      ficha.descuentoValorBase,
      group.descuento,
      "NO"
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

    usuarioFicha: pick(
      group.usuarioProgramaAdm,
      ficha.usuarioFicha,
      ""
    ),

    claveAdministrativa: pick(
      group.claveAdministrativa,
      ficha.claveAdministrativa,
      ""
    ),

    version: pick(
      ficha.version,
      group.versionFicha,
      "ORIGINAL"
    ),

    tipoVersion: pick(
      ficha.tipoVersion,
      group.tipoVersionFicha,
      "original"
    ),

    versionNumero: Number(
      pick(
        ficha.versionNumero,
        group.versionFichaNumero,
        1
      )
    ) || 1,

    fechaActualizacionTexto: pick(
      ficha.fechaActualizacionTexto,
      formatFichaDateText(ficha.fechaActualizacion),
      formatFichaDateText(group.fechaActualizacionFicha),
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

    actualizadoPor: pick(
      ficha.actualizadoPor,
      ""
    ),

    actualizadoPorCorreo: pick(
      ficha.actualizadoPorCorreo,
      ""
    ),

    fechaActualizacion: ficha.fechaActualizacion || group.fechaActualizacionFicha || null
  };
}

/* =========================================================
   HELPERS
========================================================= */
function renderRichAsHtml(id, html = "") {
  const el = $(id);
  if (!el) return;

  const safe = sanitizeRichHtml(html || "");
  if (!safe) {
    el.innerHTML = `<div class="empty"></div>`;
    return;
  }

  el.innerHTML = `<div class="pdf-rich">${safe}</div>`;
}

function renderFatal(message) {
  document.body.innerHTML = `
    <main style="max-width:820px;margin:40px auto;padding:24px;font-family:Arial,Helvetica,sans-serif;">
      <div style="background:#fff;border:1px solid rgba(58,42,82,.12);border-radius:20px;padding:22px;box-shadow:0 10px 24px rgba(36,18,56,.08);">
        <div style="font-weight:900;font-size:22px;color:#31194b;margin-bottom:8px;">Ficha PDF</div>
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

function formatDateForDisplay(value) {
  if (!value) return "—";

  const raw = String(value).trim();
  if (!raw) return "—";

  const d = new Date(raw);
  if (isNaN(d)) return raw;

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

function formatFichaDateText(value = "") {
  if (!value) return "";

  if (typeof value === "string") {
    const raw = value.trim();
    if (!raw) return "";

    const parsed = toDate(raw);
    return parsed ? humanDateLong(parsed) : raw;
  }

  const parsed = toDate(value);
  return parsed ? humanDateLong(parsed) : "";
}

function plainTextToRichHtml(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";

  return raw
    .split(/\n+/)
    .map((line) => `<p>${escapeHtml(line.trim())}</p>`)
    .join("");
}

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value?.toDate === "function") {
    const d = value.toDate();
    return Number.isNaN(d?.getTime?.()) ? null : d;
  }
  if (typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === "string") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
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
