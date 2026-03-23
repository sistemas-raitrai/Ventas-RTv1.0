import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.7.3/firebase-auth.js";
import {
  collection,
  doc,
  getDocs,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";

import { auth, db, VENTAS_USERS } from "./firebase-init.js";

import {
  $,
  normalizeEmail,
  normalizeText,
  normalizeSearch,
  getNombreUsuario
} from "./utils.js";

import {
  ACTING_USER_KEY,
  getRealUser,
  getEffectiveUser,
  isActingAsAnother,
  getVendorUsers
} from "./roles.js";

import {
  setHeaderState,
  renderActingUserSwitcher,
  bindLayoutButtons,
  setProgressStatus,
  clearProgressStatus,
  waitForLayoutReady
} from "./ui.js";

/* =========================================================
   CONFIG
========================================================= */
const GITHUB_HOME_URL = "https://sistemas-raitrai.github.io/Ventas-RT/";
const DETALLE_GRUPO_URL = "grupo.html";

/* =========================================================
   ESTADO
========================================================= */
const state = {
  realUser: null,
  effectiveUser: null,
  carteraOptions: [],
  lastCreated: null
};

/* =========================================================
   HELPERS
========================================================= */
function getScopeText() {
  let text = "Registrar contacto · Nueva cotización";

  if (state.effectiveUser) {
    text += ` · ${getNombreUsuario(state.effectiveUser)}`;
  }

  if (isActingAsAnother(state.realUser, state.effectiveUser)) {
    return `Navegando como ${getNombreUsuario(state.effectiveUser)} · ${state.effectiveUser.rol} · ${text}`;
  }

  return text;
}

function setHeaderAndScope() {
  setHeaderState({
    realUser: state.realUser,
    effectiveUser: state.effectiveUser,
    scopeText: getScopeText()
  });

  renderActingUserSwitcher({
    realUser: state.realUser,
    effectiveUser: state.effectiveUser,
    users: VENTAS_USERS
  });
}

function getCurrentYear() {
  return new Date().getFullYear();
}

function getOptionKey(email, numeroColegio, colegio) {
  return `${normalizeEmail(email)}__${normalizeText(numeroColegio)}__${normalizeText(colegio)}`;
}

function getExactCarteraOptionByInput() {
  const input = normalizeSearch($("inputColegio")?.value || "");
  if (!input) return null;

  return state.carteraOptions.find(opt => normalizeSearch(opt.colegio) === input) || null;
}

function getCheckedValues(name) {
  return [...document.querySelectorAll(`input[name="${name}"]:checked`)]
    .map(el => normalizeText(el.value))
    .filter(Boolean);
}

function uniqueStrings(items = []) {
  return [...new Set(items.filter(Boolean))];
}

/* =========================================================
   HEADER / LAYOUT
========================================================= */
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
      await loadCarteraOptions();
      resetForm();
    },
    onResetActAs: async () => {
      sessionStorage.removeItem(ACTING_USER_KEY);
      await bootstrapFromSession();
      setHeaderAndScope();
      await loadCarteraOptions();
      resetForm();
    }
  });
}

/* =========================================================
   CARTERA
========================================================= */
async function loadCarteraOptions() {
  setProgressStatus({
    text: "Cargando cartera...",
    meta: "Leyendo colegios disponibles...",
    progress: 15
  });

  let sellerEmails = [];

  if (state.effectiveUser?.rol === "vendedor") {
    sellerEmails = [normalizeEmail(state.effectiveUser.email)];
  } else {
    const sellersSnap = await getDocs(collection(db, "ventas_cartera"));
    sellerEmails = sellersSnap.docs.map(d => normalizeEmail(d.id));
  }

  const map = new Map();

  for (let i = 0; i < sellerEmails.length; i++) {
    const sellerEmail = sellerEmails[i];
    const itemsSnap = await getDocs(collection(db, "ventas_cartera", sellerEmail, "items"));

    itemsSnap.docs.forEach((d) => {
      const data = d.data() || {};
      const estatus = normalizeText(data.estatus || "");
    
      // Solo colegios con estatus OK entran a la lista de cartera
      if (normalizeSearch(estatus) !== "ok") return;
    
      const colegio =
        normalizeText(data.colegioBase || data.colegio || data.colegioOriginal || "");
    
      if (!colegio) return;
    
      const numeroColegio = normalizeText(data.numeroColegio || d.id || "");
      const vendedoraNombre = normalizeText(
        `${data.nombreVendedor || ""} ${data.apellidoVendedor || ""}`.trim()
      );
    
      const key = normalizeSearch(colegio);
    
      if (!map.has(key)) {
        map.set(key, {
          key: getOptionKey(data.correoVendedor || sellerEmail, numeroColegio, colegio),
          colegio,
          colegioBase: normalizeText(data.colegioBase || colegio),
          numeroColegio,
          vendedora: vendedoraNombre,
          vendedoraCorreo: normalizeEmail(data.correoVendedor || sellerEmail),
          comuna: normalizeText(data.comuna || ""),
          estatus
        });
      }
    });

    const pct = 15 + Math.round(((i + 1) / Math.max(1, sellerEmails.length)) * 70);
    setProgressStatus({
      text: "Cargando cartera...",
      meta: `Vendedores procesados: ${i + 1}/${sellerEmails.length}`,
      progress: pct
    });
  }

  state.carteraOptions = [...map.values()].sort((a, b) =>
    a.colegio.localeCompare(b.colegio, "es")
  );

  renderCarteraSelect();

  setProgressStatus({
    text: "Cartera lista.",
    meta: `${state.carteraOptions.length} colegio(s) disponibles.`,
    progress: 100,
    type: "success"
  });
  clearProgressStatus();
}

function renderCarteraSelect() {
  const list = $("listaColegios");
  if (!list) return;

  list.innerHTML = "";

  state.carteraOptions.forEach((opt) => {
    const option = document.createElement("option");
    option.value = opt.colegio;
    list.appendChild(option);
  });
}

/* =========================================================
   FORM UI
========================================================= */
function updateSchoolModeUI() {
  const matched = getExactCarteraOptionByInput();
  const inputColegio = $("inputColegio");
  const vendedoraPreview = $("vendedoraPreview");
  const estadoPreview = $("estadoPreview");
  const comunaCiudad = $("comunaCiudad");

  if (!inputColegio || !vendedoraPreview || !estadoPreview) return;

  if (matched) {
    vendedoraPreview.textContent = matched.vendedora || "—";
    estadoPreview.textContent = "A contactar";

    if (comunaCiudad && !normalizeText(comunaCiudad.value)) {
      comunaCiudad.value = matched.comuna || "";
    }
  } else {
    if (normalizeText(inputColegio.value)) {
      vendedoraPreview.textContent = "Sin asignar";
      estadoPreview.textContent = "Sin asignar";
    } else {
      vendedoraPreview.textContent = "—";
      estadoPreview.textContent = "—";
    }
  }
}

function updateConditionalFields() {
  const origenEsp = $("origenEspecificacion")?.value || "";
  const destinoPrincipal = $("destinoPrincipal")?.value || "";
  const secundarios = getCheckedValues("destinoSecundario");

  $("wrapOrigenEspecificacionOtro")?.classList.toggle("hidden", origenEsp !== "Otro");
  $("wrapDestinoPrincipalOtro")?.classList.toggle("hidden", destinoPrincipal !== "Otro");
  $("wrapDestinoSecundarioOtro")?.classList.toggle("hidden", !secundarios.includes("Otro"));
}

function showSuccessModal() {
  if (!state.lastCreated) return;

  const dt = state.lastCreated.createdAt || new Date();

  $("successCodigo").textContent = state.lastCreated.codigoRegistro || "—";
  $("successColegio").textContent = state.lastCreated.colegio || "—";
  $("successCreadoPor").textContent = state.lastCreated.creadoPor || "—";
  $("successFecha").textContent = dt.toLocaleDateString("es-CL");
  $("successHora").textContent = dt.toLocaleTimeString("es-CL", {
    hour: "2-digit",
    minute: "2-digit"
  });

  $("successModal")?.classList.add("show");
}

function closeSuccessModal() {
  $("successModal")?.classList.remove("show");
}

function resetForm() {
  $("registroForm")?.reset();
  $("anoViaje").value = getCurrentYear();
  updateSchoolModeUI();
  updateConditionalFields();
}

/* =========================================================
   VALIDACIÓN Y PAYLOAD
========================================================= */
function validateForm(data) {
  if (!data.colegio) {
    return "Debes indicar el colegio.";
  }

  if (!data.cursoNivel) {
    return "Debes seleccionar el curso base.";
  }

  if (!data.cursoSeccion) {
    return "Debes indicar la letra o nombre del curso.";
  }

  if (!data.anoViaje) {
    return "Debes indicar el año del viaje.";
  }

  if (!data.nombreCliente) {
    return "Debes indicar el nombre del cliente.";
  }

  if (!data.rolCliente) {
    return "Debes seleccionar el rol del cliente.";
  }

  if (!data.correoCliente && !data.celularCliente) {
    return "Debes ingresar al menos correo o celular del cliente.";
  }

  if (!data.origenCliente) {
    return "Debes seleccionar el origen del cliente.";
  }

  if (!data.origenEspecificacion) {
    return "Debes seleccionar la especificación del origen.";
  }

  if (data.origenEspecificacion === "Otro" && !data.origenEspecificacionOtro) {
    return "Debes especificar el otro origen.";
  }

  if (!data.destinoPrincipal) {
    return "Debes seleccionar el destino principal.";
  }

  if (data.destinoPrincipal === "Otro" && !data.destinoPrincipalOtro) {
    return "Debes especificar el otro destino principal.";
  }

  if (data.destinosSecundarios.includes("Otro") && !data.destinoSecundarioOtro) {
    return "Debes especificar el otro destino secundario.";
  }

  if (state.effectiveUser?.rol === "vendedor" && !data.esCartera) {
    return "Como vendedor(a), solo puedes registrar cotizaciones de colegios que pertenezcan a tu cartera.";
  }

  return "";
}

function readFormData() {
  const carteraOpt = getExactCarteraOptionByInput();
  const esCartera = !!carteraOpt;

  const colegio = normalizeText($("inputColegio")?.value || "");
  const cursoNivel = normalizeText($("cursoNivel")?.value || "");
  const cursoSeccion = normalizeText($("cursoSeccion")?.value || "");

  const destinosSecundarios = uniqueStrings(
    getCheckedValues("destinoSecundario").filter(v => v !== ($("destinoPrincipal")?.value || ""))
  );

  return {
    esCartera,
    tipoColegio: esCartera ? "cartera" : "otro",
    colegio,
    colegioBase: esCartera ? normalizeText(carteraOpt?.colegioBase || carteraOpt?.colegio || "") : colegio,
    carteraNumeroColegio: esCartera ? normalizeText(carteraOpt?.numeroColegio || "") : "",
    carteraCorreoVendedora: esCartera ? normalizeEmail(carteraOpt?.vendedoraCorreo || "") : "",
    vendedora: esCartera ? normalizeText(carteraOpt?.vendedora || "") : "Sin asignar",
    vendedoraCorreo: esCartera ? normalizeEmail(carteraOpt?.vendedoraCorreo || "") : "",
    requiereAsignacion: !esCartera,
    estado: esCartera ? "A contactar" : "Sin asignar",

    cursoNivel,
    cursoSeccion,
    curso: `${cursoNivel} ${cursoSeccion}`.trim(),
    anoViaje: normalizeText($("anoViaje")?.value || ""),
    comunaCiudad: normalizeText($("comunaCiudad")?.value || ""),
    nombreCliente: normalizeText($("nombreCliente")?.value || ""),
    rolCliente: normalizeText($("rolCliente")?.value || ""),
    correoCliente: normalizeEmail($("correoCliente")?.value || ""),
    celularCliente: normalizeText($("celularCliente")?.value || ""),
    origenCliente: normalizeText($("origenCliente")?.value || ""),
    origenEspecificacion: normalizeText($("origenEspecificacion")?.value || ""),
    origenEspecificacionOtro: normalizeText($("origenEspecificacionOtro")?.value || ""),
    destinoPrincipal: normalizeText($("destinoPrincipal")?.value || ""),
    destinoPrincipalOtro: normalizeText($("destinoPrincipalOtro")?.value || ""),
    destinosSecundarios,
    destinoSecundarioOtro: normalizeText($("destinoSecundarioOtro")?.value || "")
  };
}

function buildCodigoRegistro(docId) {
  const year = new Date().getFullYear();
  return `COT-${year}-${String(docId).slice(0, 6).toUpperCase()}`;
}

/* =========================================================
   GUARDAR
========================================================= */
async function saveRegistro(e) {
  e.preventDefault();

  const btn = $("btnGuardarRegistro");
  const data = readFormData();
  const validation = validateForm(data);

  if (validation) {
    alert(validation);
    return;
  }

  try {
    btn.disabled = true;

    setProgressStatus({
      text: "Registrando contacto...",
      meta: "Preparando registro...",
      progress: 25
    });

    const newRef = doc(collection(db, "ventas_cotizaciones"));
    const idGrupo = newRef.id;
    const codigoRegistro = buildCodigoRegistro(idGrupo);

    const payload = {
      idGrupo,
      codigoRegistro,
      tipoRegistro: "cotizacion",

      origenColegio: data.tipoColegio,
      colegio: data.colegio,
      colegioBase: data.colegioBase,
      carteraNumeroColegio: data.carteraNumeroColegio,
      carteraCorreoVendedora: data.carteraCorreoVendedora,

      vendedora: data.vendedora,
      vendedoraCorreo: data.vendedoraCorreo,
      requiereAsignacion: data.requiereAsignacion,
      estado: data.estado,

      cursoNivel: data.cursoNivel,
      cursoSeccion: data.cursoSeccion,
      curso: data.curso,
      anoViaje: data.anoViaje,
      comunaCiudad: data.comunaCiudad,

      nombreCliente: data.nombreCliente,
      rolCliente: data.rolCliente,
      correoCliente: data.correoCliente,
      celularCliente: data.celularCliente,

      origenCliente: data.origenCliente,
      origenEspecificacion: data.origenEspecificacion,
      origenEspecificacionOtro: data.origenEspecificacionOtro,

      destinoPrincipal: data.destinoPrincipal,
      destinoPrincipalOtro: data.destinoPrincipalOtro,
      destinosSecundarios: data.destinosSecundarios,
      destinoSecundarioOtro: data.destinoSecundarioOtro,

      creadoPor: getNombreUsuario(state.effectiveUser),
      creadoPorCorreo: normalizeEmail(state.realUser?.email || ""),
      fechaCreacion: serverTimestamp(),
      actualizadoPor: getNombreUsuario(state.effectiveUser),
      actualizadoPorCorreo: normalizeEmail(state.realUser?.email || ""),
      fechaActualizacion: serverTimestamp()
    };

    setProgressStatus({
      text: "Registrando contacto...",
      meta: "Guardando en Firebase...",
      progress: 70
    });

    await setDoc(newRef, payload);

    setProgressStatus({
      text: "Registro creado.",
      meta: `Código: ${codigoRegistro}`,
      progress: 100,
      type: "success"
    });
    clearProgressStatus(2000);

    state.lastCreated = {
      idGrupo,
      codigoRegistro,
      colegio: data.colegio,
      creadoPor: getNombreUsuario(state.effectiveUser),
      createdAt: new Date()
    };

    showSuccessModal();
  } catch (error) {
    console.error(error);
    setProgressStatus({
      text: "Error creando registro.",
      meta: error.message || "No se pudo guardar el contacto.",
      progress: 100,
      type: "error"
    });
  } finally {
    btn.disabled = false;
  }
}

/* =========================================================
   EVENTOS
========================================================= */
function bindPageEvents() {
  const inputColegio = $("inputColegio");
  const origenEspecificacion = $("origenEspecificacion");
  const destinoPrincipal = $("destinoPrincipal");
  const btnLimpiar = $("btnLimpiar");
  const btnNuevoRegistro = $("btnNuevoRegistro");
  const btnIrRegistro = $("btnIrRegistro");
  const successModal = $("successModal");
  const form = $("registroForm");

  if (inputColegio && !inputColegio.dataset.bound) {
    inputColegio.dataset.bound = "1";
    inputColegio.addEventListener("input", updateSchoolModeUI);
    inputColegio.addEventListener("change", updateSchoolModeUI);
  }

  if (origenEspecificacion && !origenEspecificacion.dataset.bound) {
    origenEspecificacion.dataset.bound = "1";
    origenEspecificacion.addEventListener("change", updateConditionalFields);
  }

  if (destinoPrincipal && !destinoPrincipal.dataset.bound) {
    destinoPrincipal.dataset.bound = "1";
    destinoPrincipal.addEventListener("change", updateConditionalFields);
  }

  [...document.querySelectorAll('input[name="destinoSecundario"]')].forEach((input) => {
    if (!input.dataset.bound) {
      input.dataset.bound = "1";
      input.addEventListener("change", updateConditionalFields);
    }
  });

  if (btnLimpiar && !btnLimpiar.dataset.bound) {
    btnLimpiar.dataset.bound = "1";
    btnLimpiar.addEventListener("click", resetForm);
  }

  if (btnNuevoRegistro && !btnNuevoRegistro.dataset.bound) {
    btnNuevoRegistro.dataset.bound = "1";
    btnNuevoRegistro.addEventListener("click", () => {
      closeSuccessModal();
      resetForm();
      $("inputColegio")?.focus();
    });
  }

  if (btnIrRegistro && !btnIrRegistro.dataset.bound) {
    btnIrRegistro.dataset.bound = "1";
    btnIrRegistro.addEventListener("click", () => {
      if (!state.lastCreated?.idGrupo) return;
      location.href = `${DETALLE_GRUPO_URL}?id=${encodeURIComponent(state.lastCreated.idGrupo)}`;
    });
  }

  if (successModal && !successModal.dataset.bound) {
    successModal.dataset.bound = "1";
    successModal.addEventListener("click", (e) => {
      if (e.target === successModal) {
        closeSuccessModal();
      }
    });
  }

  if (form && !form.dataset.bound) {
    form.dataset.bound = "1";
    form.addEventListener("submit", saveRegistro);
  }
}

/* =========================================================
   INIT
========================================================= */
async function bootstrapFromSession() {
  state.realUser = getRealUser();
  state.effectiveUser = getEffectiveUser();
}

async function initPage() {
  await waitForLayoutReady();

  bindHeaderActions();
  bindPageEvents();

  onAuthStateChanged(auth, async (user) => {
    if (!user) return;

    await bootstrapFromSession();
    setHeaderAndScope();
    await loadCarteraOptions();
    resetForm();
  });
}

initPage();
