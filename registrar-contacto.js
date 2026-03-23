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

/* =========================================================
   ESTADO
========================================================= */
const state = {
  realUser: null,
  effectiveUser: null,
  carteraOptions: []
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

function getSelectedCarteraOption() {
  const select = $("selectColegioCartera");
  const key = select?.value || "";
  return state.carteraOptions.find(opt => opt.key === key) || null;
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
          comuna: normalizeText(data.comuna || "")
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
  const select = $("selectColegioCartera");
  if (!select) return;

  select.innerHTML = `<option value="">Seleccionar colegio de cartera</option>`;

  state.carteraOptions.forEach((opt) => {
    const option = document.createElement("option");
    option.value = opt.key;
    option.textContent = opt.colegio;
    select.appendChild(option);
  });
}

/* =========================================================
   FORM UI
========================================================= */
function updateSchoolModeUI() {
  const tipo = $("tipoColegio")?.value || "cartera";
  const wrapCartera = $("wrapColegioCartera");
  const wrapOtro = $("wrapColegioOtro");
  const vendedoraPreview = $("vendedoraPreview");
  const estadoPreview = $("estadoPreview");
  const comunaCiudad = $("comunaCiudad");

  if (!wrapCartera || !wrapOtro || !vendedoraPreview || !estadoPreview) return;

  if (tipo === "cartera") {
    wrapCartera.classList.remove("hidden");
    wrapOtro.classList.add("hidden");

    const opt = getSelectedCarteraOption();

    if (opt) {
      vendedoraPreview.textContent = opt.vendedora || "—";
      estadoPreview.textContent = "A contactar";

      if (comunaCiudad && !normalizeText(comunaCiudad.value)) {
        comunaCiudad.value = opt.comuna || "";
      }
    } else {
      vendedoraPreview.textContent = "—";
      estadoPreview.textContent = "—";
    }
  } else {
    wrapCartera.classList.add("hidden");
    wrapOtro.classList.remove("hidden");
    vendedoraPreview.textContent = "Sin asignar";
    estadoPreview.textContent = "Sin asignar";
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

function resetForm() {
  $("registroForm")?.reset();
  $("tipoColegio").value = "cartera";
  $("anoViaje").value = getCurrentYear();
  updateSchoolModeUI();
  updateConditionalFields();
}

/* =========================================================
   VALIDACIÓN Y PAYLOAD
========================================================= */
function validateForm(data) {
  if (data.tipoColegio === "cartera" && !data.colegio) {
    return "Debes seleccionar un colegio de cartera.";
  }

  if (data.tipoColegio === "otro" && !data.colegio) {
    return "Debes escribir el nombre del otro colegio.";
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

  return "";
}

function readFormData() {
  const tipoColegio = $("tipoColegio")?.value || "cartera";
  const carteraOpt = getSelectedCarteraOption();

  const colegio =
    tipoColegio === "cartera"
      ? normalizeText(carteraOpt?.colegio || "")
      : normalizeText($("inputColegioOtro")?.value || "");

  const cursoNivel = normalizeText($("cursoNivel")?.value || "");
  const cursoSeccion = normalizeText($("cursoSeccion")?.value || "");

  const destinosSecundarios = uniqueStrings(
    getCheckedValues("destinoSecundario").filter(v => v !== ($("destinoPrincipal")?.value || ""))
  );

  return {
    tipoColegio,
    colegio,
    colegioBase: tipoColegio === "cartera" ? normalizeText(carteraOpt?.colegioBase || carteraOpt?.colegio || "") : colegio,
    carteraNumeroColegio: tipoColegio === "cartera" ? normalizeText(carteraOpt?.numeroColegio || "") : "",
    carteraCorreoVendedora: tipoColegio === "cartera" ? normalizeEmail(carteraOpt?.vendedoraCorreo || "") : "",
    vendedora: tipoColegio === "cartera" ? normalizeText(carteraOpt?.vendedora || "") : "Sin asignar",
    vendedoraCorreo: tipoColegio === "cartera" ? normalizeEmail(carteraOpt?.vendedoraCorreo || "") : "",
    requiereAsignacion: tipoColegio !== "cartera",
    estado: tipoColegio === "cartera" ? "A contactar" : "Sin asignar",

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
    clearProgressStatus(2800);

    resetForm();
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
  const tipoColegio = $("tipoColegio");
  const selectColegioCartera = $("selectColegioCartera");
  const origenEspecificacion = $("origenEspecificacion");
  const destinoPrincipal = $("destinoPrincipal");
  const btnLimpiar = $("btnLimpiar");
  const form = $("registroForm");

  if (tipoColegio && !tipoColegio.dataset.bound) {
    tipoColegio.dataset.bound = "1";
    tipoColegio.addEventListener("change", updateSchoolModeUI);
  }

  if (selectColegioCartera && !selectColegioCartera.dataset.bound) {
    selectColegioCartera.dataset.bound = "1";
    selectColegioCartera.addEventListener("change", updateSchoolModeUI);
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
