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

function isVendorPdfReadOnlyView() {
  return String(state.effectiveUser?.rol || "").toLowerCase() === "vendedor";
}

function syncPdfTopActionsVisibility() {
  const hideAllActions = isVendorPdfReadOnlyView();

  const actionButtons = [
    $("btnVolverFichaEditable"),
    $("btnVolverGrupo"),
    $("btnImprimirFichaPdf")
  ].filter(Boolean);

  actionButtons.forEach((btn) => {
    btn.classList.toggle("hidden", hideAllActions);
    btn.style.display = hideAllActions ? "none" : "";
  });

  const explicitToolbar =
    document.querySelector("[data-pdf-actions]") ||
    document.querySelector(".pdf-actions") ||
    document.querySelector(".pdf-top-actions") ||
    document.querySelector(".pdf-toolbar");

  if (explicitToolbar) {
    explicitToolbar.classList.toggle("hidden", hideAllActions);
    explicitToolbar.style.display = hideAllActions ? "none" : "";
    return;
  }

  const commonParent = actionButtons.length ? actionButtons[0].parentElement : null;
  const sameParent =
    commonParent &&
    actionButtons.length &&
    actionButtons.every((btn) => btn.parentElement === commonParent);

  if (sameParent) {
    commonParent.style.display = hideAllActions ? "none" : "";
  }
}

/* =========================================================
   RENDER
========================================================= */
function renderPage() {
  setText("pdfAnoTitulo", state.group?.anoViaje || "—");
  setText("pdfSolicitudReserva", valueOrDash(state.ficha?.solicitudReserva).toUpperCase());
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

  if (isPdfOfficiallyConfirmed()) {
    window.print();
    return;
  }

  if (!canFinalizeFichaPdf()) {
    alert(getFinalizeBlockedMessage());
    return;
  }

  const alias =
    cleanText(state.group?.aliasGrupo) ||
    cleanText(state.ficha?.nombreGrupo) ||
    `Grupo ${state.groupId}`;

  const ok = window.confirm(
    `Vas a confirmar oficialmente la ficha del grupo ${alias}. Esta acción dejará historial y luego abrirá la impresión.`
  );

  if (!ok) return;

  state.isClosingPdf = true;
  syncPrintButton();

  try {
    const result = await confirmOfficialPdfClosure();
    await loadAll();

    if (result?.emailQueued === false) {
      alert("La ficha se confirmó correctamente, pero el correo quedó pendiente de envío. Revisa la configuración de la colección mail / extensión de correo.");
    }

    window.print();
  } catch (error) {
    console.error("[ficha-pdf] confirmOfficialPdfClosure", error);
    alert("No se pudo confirmar oficialmente la ficha: " + (error?.message || error));
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
    btn.textContent = "Confirmando ficha...";
    return;
  }

  if (isPdfOfficiallyConfirmed()) {
    btn.disabled = !canFinalizeFichaAsCurrentUser();
    btn.textContent = "Reimprimir / Guardar PDF";
    return;
  }

  btn.disabled = !canFinalizeFichaPdf();
  btn.textContent = "Imprimir / Guardar PDF";
}

function canFinalizeFichaPdf() {
  if (!canFinalizeFichaAsCurrentUser()) return false;
  if (!state.group || !state.groupDocId) return false;
  if (!canAccessGroup(state.group)) return false;

  const flow = state.group.flowFicha || {};
  const fichaEstado = normalizeSearchLocal(state.group?.fichaEstado || "");
  const adminFirmado = !!flow?.administracion?.firmado;

  return fichaEstado === "autorizada_admin" && adminFirmado;
}

function getFinalizeBlockedMessage() {
  if (!canFinalizeFichaAsCurrentUser()) {
    return "Solo admin, yenny@raitrai.cl o administracion@raitrai.cl pueden confirmar oficialmente esta ficha para impresión.";
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
    email === "administracion@raitrai.cl"
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

async function queueFichaConfirmationEmail({ versionLabel, nombre }) {
  const alias =
    cleanText(state.group?.aliasGrupo) ||
    cleanText(state.ficha?.nombreGrupo) ||
    `Grupo ${state.groupId}`;

  const idGrupo = String(state.groupId || "");
  const numeroNegocio = cleanText(state.ficha?.numeroNegocio || state.group?.numeroNegocio || "");
  const solicitudReserva = cleanText(state.ficha?.solicitudReserva || state.group?.solicitudReserva || "");
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

async function confirmOfficialPdfClosure() {
  const nombre = getDisplayName(state.effectiveUser);
  const fichaActual = getByPath(state.group, "ficha") || {};
  const flow = state.group.flowFicha || {};
  const groupRef = doc(db, "ventas_cotizaciones", state.groupDocId);
  const versionData = resolveNextFichaVersion();
  const versionLabel = getFichaVersionLabel(versionData);

  await updateDoc(groupRef, {
    fichaEstado: "confirmada_pdf",
    autorizada: true,
    ultimaGestionAt: serverTimestamp(),
    ultimaGestionTipo: "confirmacion_ficha_pdf",

    versionFicha: versionData.version,
    tipoVersionFicha: versionData.tipoVersion,
    versionFichaNumero: versionData.versionNumero,
    fechaActualizacionFicha: serverTimestamp(),

    "ficha.estado": "confirmada_pdf",
    "ficha.confirmada": true,
    "ficha.confirmadaEl": serverTimestamp(),
    "ficha.confirmadaPor": nombre,
    "ficha.confirmadaPorCorreo": state.effectiveEmail,
    "ficha.pdfPendienteGeneracion": true,
    "ficha.pendienteEnvioCorreo": true,
    "ficha.version": versionData.version,
    "ficha.tipoVersion": versionData.tipoVersion,
    "ficha.versionNumero": versionData.versionNumero,
    "ficha.fechaActualizacion": serverTimestamp(),
    "ficha.actualizadoPor": nombre,
    "ficha.actualizadoPorCorreo": state.effectiveEmail,

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
    mensaje: `${nombre} confirmó oficialmente la ficha para impresión (${versionLabel}).`,
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
          campo: "ficha.pendienteEnvioCorreo",
          anterior: !!fichaActual?.pendienteEnvioCorreo,
          nuevo: true
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

  return { emailQueued };
}

/* =========================================================
   DATA
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
