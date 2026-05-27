// inscripcion.js

import { db } from "./firebase-init.js";

import {
  doc,
  getDoc,
  collection,
  addDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";

// -----------------------------------------------------------------------------
// DOM
// -----------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);

const form = $("formInscripcion");
const msgBox = $("msgBox");
const btnEnviar = $("btnEnviar");
const btnLimpiar = $("btnLimpiar");
const btnComenzar = $("btnComenzar");
const pantallaBienvenida = $("pantallaBienvenida");

const chipGrupo = $("chipGrupo");
const chipColegio = $("chipColegio");
const chipCurso = $("chipCurso");
const chipDestino = $("chipDestino");
const chipAno = $("chipAno");

const generoOtroWrap = $("generoOtroWrap");

const rutCompletoWrap = $("rutCompletoWrap");
const rutWrap = $("rutWrap");
const dvWrap = $("dvWrap");
const sinRutNotice = $("sinRutNotice");
const rutHint = $("rutHint");

const nombreDocumentoWrap = $("nombreDocumentoWrap");
const datosDocumentoWrap = $("datosDocumentoWrap");
const correoViajanteReq = $("correoViajanteReq");
const autorizaCorreoViajanteWrap = $("autorizaCorreoViajanteWrap");
const emergenciaMismoResponsableWrap = $("emergenciaMismoResponsableWrap");

const emergenciaUsarResponsable2Wrap = $("emergenciaUsarResponsable2Wrap");
const emergencia2MismoResponsableWrap = $("emergencia2MismoResponsableWrap");
const emergencia2UsarResponsable2Wrap = $("emergencia2UsarResponsable2Wrap");

const nacionalidadDetalleWrap = $("nacionalidadDetalleWrap");
const telefonoViajanteWrap = $("telefonoViajanteWrap");
const avisoAdultoResponsableWrap = $("avisoAdultoResponsableWrap");

const bloqueProfesor = $("bloqueProfesor");
const tipoProfesorOtroWrap = $("tipoProfesorOtroWrap");

const bloqueAcompanante = $("bloqueAcompanante");
const acompananteConoceWrap = $("acompananteConoceWrap");
const relacionCursoOtroWrap = $("relacionCursoOtroWrap");

const bloqueApoderado = $("bloqueApoderado");
const contactoPrincipalRelacionOtroWrap = $("contactoPrincipalRelacionOtroWrap");

const btnAgregarApoderado2 = $("btnAgregarApoderado2");
const bloqueApoderado2 = $("bloqueApoderado2");
const contactoSecundarioRelacionOtroWrap = $("contactoSecundarioRelacionOtroWrap");

const emergenciaRelacionOtroWrap = $("emergenciaRelacionOtroWrap");

const btnAgregarEmergencia2 = $("btnAgregarEmergencia2");
const bloqueEmergencia2 = $("bloqueEmergencia2");
const emergencia2RelacionOtroWrap = $("emergencia2RelacionOtroWrap");

const bloqueInternacional = $("bloqueInternacional");
const nacionalidadPaisDestinoWrap = $("nacionalidadPaisDestinoWrap");

const alertaNacionalidadDestinoWrap = $("alertaNacionalidadDestinoWrap");
const docsOtraNacionalidadWrap = $("docsOtraNacionalidadWrap");

const discapacidadWrap = $("discapacidadWrap");
const discapacidadApoyosWrap = $("discapacidadApoyosWrap");
const discapacidadAyudasTecnicasWrap = $("discapacidadAyudasTecnicasWrap");

const neurodivergenciaWrap = $("neurodivergenciaWrap");
const neurodivergenciaOtraWrap = $("neurodivergenciaOtraWrap");
const neuroSobrecargaWrap = $("neuroSobrecargaWrap");
const neuroApoyosWrap = $("neuroApoyosWrap");

const saludMentalWrap = $("saludMentalWrap");
const alergiasAlimentariasWrap = $("alergiasAlimentariasWrap");
const grupoSanguineoWrap = $("grupoSanguineoWrap");
const grupoSanguineoNoSeWrap = $("grupoSanguineoNoSeWrap");

const enfermedadBaseDetalleWrap = $("enfermedadBaseDetalleWrap");
const saludGeneralDetalleWrap = $("saludGeneralDetalleWrap");
const cirugiasPreviasDetalleWrap = $("cirugiasPreviasDetalleWrap");
const emergenciaMedicaDetalleWrap = $("emergenciaMedicaDetalleWrap");

const medicamentosWrap = $("medicamentosWrap");
const medicamentosProhibidosDetalleWrap = $("medicamentosProhibidosDetalleWrap");
const alergiasWrap = $("alergiasWrap");
const dietaWrap = $("dietaWrap");
const otrosAntecedentesDetalleWrap = $("otrosAntecedentesDetalleWrap");

const adultoCompromisoCard = $("adultoCompromisoCard");

// -----------------------------------------------------------------------------
// CONSTANTES
// -----------------------------------------------------------------------------
const CORREO_ADMIN = "administracion@raitrai.cl";
const TELEFONO_ADMIN = "+56 (2) 2236 3232";
const WHATSAPP_ADMIN = "(+569) 9818 3857";
const COLECCION_INSCRIPCIONES_PENDIENTES = "inscripciones_pendientes_publicas";


// -----------------------------------------------------------------------------
// ESTADO
// -----------------------------------------------------------------------------
let grupoData = null;
let idGrupo = "";
let tokenUrl = "";
let faseUrl = "normal";
let correoCambios = CORREO_ADMIN;

// -----------------------------------------------------------------------------
// INICIO
// -----------------------------------------------------------------------------
init().catch((error) => {
  console.error(error);
  mostrarMensaje("error", "Ocurrió un error al cargar la inscripción.");
});

async function init() {
  const params = new URLSearchParams(window.location.search);
  idGrupo = limpiarTexto(params.get("grupo"));
  tokenUrl = limpiarTexto(params.get("token"));
  faseUrl = normalizarFaseInscripcion(params.get("fase"));

  if (!idGrupo) {
    mostrarMensaje("error", "Falta el identificador del grupo en el enlace.");
    bloquearFormulario();
    return;
  }

  await cargarGrupo();
  insertarBarraProgreso();
  conectarEventos();
  aplicarEstadoUI();
  actualizarProgreso();
}

// -----------------------------------------------------------------------------
// CARGA GRUPO
// -----------------------------------------------------------------------------
async function cargarGrupo() {
  const ref = doc(db, "ventas_cotizaciones", idGrupo);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    mostrarMensaje("error", "El grupo indicado no existe.");
    bloquearFormulario();
    return;
  }

  grupoData = { id: snap.id, ...snap.data() };

  const esLinkLiberado = faseUrl === "liberado";
  
  const inscripcionHabilitada = esLinkLiberado
    ? !!grupoData.linkLiberadosActivo
    : !!grupoData.inscripcionHabilitada;
  
  const tokenGrupo = esLinkLiberado
    ? limpiarTexto(grupoData.tokenInscripcionLiberados)
    : limpiarTexto(grupoData.tokenInscripcion);

  if (!esLinkLiberado && grupoData.inscripcionEstado === "cerrada") {
    mostrarMensaje("error", "La inscripción para este grupo se encuentra cerrada.");
    bloquearFormulario();
    return;
  }

  correoCambios = limpiarTexto(grupoData.correoCambiosInscripcion) || CORREO_ADMIN;

  if (!inscripcionHabilitada) {
    mostrarMensaje("error", "La inscripción para este grupo no se encuentra habilitada.");
    bloquearFormulario();
    return;
  }

  if (tokenGrupo && tokenUrl && tokenGrupo !== tokenUrl) {
    mostrarMensaje("error", "El enlace de inscripción no es válido para este grupo.");
    bloquearFormulario();
    return;
  }

  if (tokenGrupo && !tokenUrl) {
    mostrarMensaje("error", "Falta el token de acceso para esta inscripción.");
    bloquearFormulario();
    return;
  }

  if (chipGrupo) {
    chipGrupo.textContent =
      limpiarTexto(grupoData.aliasGrupo) ||
      limpiarTexto(grupoData.nombreGrupo) ||
      limpiarTexto(grupoData.idGrupo) ||
      idGrupo;
  }

  if (chipColegio) chipColegio.textContent = limpiarTexto(grupoData.colegio) || "-";
  if (chipCurso) chipCurso.textContent = obtenerCursoActualInscripcion(grupoData);

  if (chipDestino) {
    chipDestino.textContent =
      limpiarTexto(grupoData.destinoPrincipal) ||
      limpiarTexto(grupoData.destino) ||
      "-";
  }

  if (chipAno) chipAno.textContent = String(grupoData.anoViaje || "-");

  renderBannerFaseInscripcion();
}

// -----------------------------------------------------------------------------
// EVENTOS
// -----------------------------------------------------------------------------
function conectarEventos() {
  btnComenzar?.addEventListener("click", () => {
    pantallaBienvenida?.classList.add("hidden");
    form?.classList.remove("hidden");
    window.scrollTo({ top: 0, behavior: "smooth" });
    actualizarProgreso();
  });

  form?.addEventListener("submit", onSubmit);
  btnLimpiar?.addEventListener("click", onLimpiar);

  $("btnInfoConoceRaitrai")?.addEventListener("click", () => {
    $("modalConoceRaitrai")?.classList.remove("hidden");
  });
  
  $("btnInfoConoceRaitraiAcompanante")?.addEventListener("click", () => {
    $("modalConoceRaitrai")?.classList.remove("hidden");
  });
  
  $("btnCerrarConoceRaitrai")?.addEventListener("click", () => {
    $("modalConoceRaitrai")?.classList.add("hidden");
  });
  
  $("modalConoceRaitrai")?.addEventListener("click", (event) => {
    if (event.target?.id === "modalConoceRaitrai") {
      $("modalConoceRaitrai")?.classList.add("hidden");
    }
  });

  $("btnAbrirTallas")?.addEventListener("click", () => {
    $("modalTallasPolera")?.classList.remove("hidden");
  });
  
  $("btnCerrarTallas")?.addEventListener("click", () => {
    $("modalTallasPolera")?.classList.add("hidden");
  });
  
  $("modalTallasPolera")?.addEventListener("click", (event) => {
    if (event.target?.id === "modalTallasPolera") {
      $("modalTallasPolera")?.classList.add("hidden");
    }
  });

  form?.addEventListener("input", actualizarProgreso);
  form?.addEventListener("change", () => {
    aplicarEstadoUI();
    actualizarProgreso();
  });

  document.querySelectorAll('input[name="tipoViajante"]').forEach((el) => {
    el.addEventListener("change", aplicarEstadoUI);
  });

  $("rutNumero")?.addEventListener("input", onRutInput);
  $("rutDv")?.addEventListener("input", onRutInput);

  document.querySelectorAll('input[name="nombreCoincideDocumento"]').forEach((el) => {
    el.addEventListener("change", aplicarEstadoUI);
  });
  
  $("correoViajante")?.addEventListener("input", aplicarEstadoUI);
  
  document.querySelectorAll('input[name="emergenciaMismoResponsable"]').forEach((el) => {
    el.addEventListener("change", () => {
      aplicarEmergenciaDesdeResponsable(1);
      aplicarEstadoUI();
      actualizarProgreso();
    });
  });
  
  document.querySelectorAll('input[name="emergencia2MismoResponsable"]').forEach((el) => {
    el.addEventListener("change", () => {
      aplicarEmergenciaDesdeResponsable(2);
      aplicarEstadoUI();
      actualizarProgreso();
    });
  });
  
  [
    "contactoPrincipalNombre",
    "contactoPrincipalRelacion",
    "contactoPrincipalTelefono",
    "contactoSecundarioNombre",
    "contactoSecundarioRelacion",
    "contactoSecundarioTelefono"
  ].forEach((id) => {
    $(id)?.addEventListener("input", () => {
      aplicarEmergenciaDesdeResponsable(1);
      aplicarEmergenciaDesdeResponsable(2);
    });
  
    $(id)?.addEventListener("change", () => {
      aplicarEmergenciaDesdeResponsable(1);
      aplicarEmergenciaDesdeResponsable(2);
    });
  });

  btnAgregarApoderado2?.addEventListener("click", () => {
    mostrar(bloqueApoderado2, true);
    btnAgregarApoderado2.classList.add("hidden");
    setPhoneDefault("contactoSecundarioTelefono");
    aplicarEstadoUI();
    actualizarProgreso();
  });

  btnAgregarEmergencia2?.addEventListener("click", () => {
    mostrar(bloqueEmergencia2, true);
    btnAgregarEmergencia2.classList.add("hidden");
    setPhoneDefault("emergencia2Telefono");
    aplicarEstadoUI();
    actualizarProgreso();
  });

  $("contactoSecundarioRelacion")?.addEventListener("change", aplicarEstadoUI);

  $("emergencia2Relacion")?.addEventListener("change", aplicarEstadoUI);

  enlazarFlagDetalle("discapacidadFlag", discapacidadWrap, ["si"]);
  enlazarFlagDetalle("discapacidadApoyosFlag", discapacidadApoyosWrap, ["si"]);
  enlazarFlagDetalle("discapacidadAyudasTecnicasFlag", discapacidadAyudasTecnicasWrap, ["si"]);
  
  enlazarFlagDetalle("neurodivergenciaFlag", neurodivergenciaWrap, ["si"]);
  enlazarFlagDetalle("neuroSobrecargaFlag", neuroSobrecargaWrap, ["si"]);
  enlazarFlagDetalle("neuroApoyosFlag", neuroApoyosWrap, ["si"]);
  
  enlazarFlagDetalle("saludMentalFlag", saludMentalWrap, ["si"]);
  document.querySelectorAll('input[name="dietaRestricciones"]').forEach((el) => {
    el.addEventListener("change", aplicarEstadoUI);
  });
  $("grupoSanguineo")?.addEventListener("change", aplicarEstadoUI);
  
  enlazarFlagDetalle("alergiaAlimentaria1ProtocoloFlag", $("alergiaAlimentaria1ProtocoloWrap"), ["si"]);
  enlazarFlagDetalle("alergiaAlimentaria2ProtocoloFlag", $("alergiaAlimentaria2ProtocoloWrap"), ["si"]);
  enlazarFlagDetalle("alergiaAlimentaria3ProtocoloFlag", $("alergiaAlimentaria3ProtocoloWrap"), ["si"]);
  
  $("btnAgregarAlergiaAlimentaria")?.addEventListener("click", agregarAlergiaAlimentaria);

  enlazarFlagDetalle("enfermedadBaseFlag", enfermedadBaseDetalleWrap, ["si"]);
  enlazarFlagDetalle("saludGeneralFlag", saludGeneralDetalleWrap, ["si"]);
  enlazarFlagDetalle("cirugiasPreviasFlag", cirugiasPreviasDetalleWrap, ["si"]);
  enlazarFlagDetalle("emergenciaMedicaFlag", emergenciaMedicaDetalleWrap, ["si"]);
  enlazarFlagDetalle("medicamentosFlag", medicamentosWrap, ["si"]);
  enlazarFlagDetalle("medicamentosProhibidosFlag", medicamentosProhibidosDetalleWrap, ["si"]);
  enlazarFlagDetalle("alergiasFlag", alergiasWrap, ["si"]);
  enlazarFlagDetalle("dietaFlag", dietaWrap, ["si"]);
  enlazarFlagDetalle("otrosAntecedentesFlag", otrosAntecedentesDetalleWrap, ["si"]);

  [
    "telefonoViajante",
    "contactoPrincipalTelefono",
    "contactoSecundarioTelefono",
    "emergenciaTelefono",
    "emergencia2Telefono"
  ].forEach(bindPhoneInput);

  document.querySelectorAll('input[name="neurodivergenciaTipos"]').forEach((el) => {
    el.addEventListener("change", aplicarEstadoUI);
  });

  setPhoneDefault("telefonoViajante");
  setPhoneDefault("contactoPrincipalTelefono");
  setPhoneDefault("emergenciaTelefono");
}

// -----------------------------------------------------------------------------
// BARRA DE PROGRESO
// -----------------------------------------------------------------------------
function insertarBarraProgreso() {
  if ($("barraProgresoInscripcion") || !form) return;

  const wrap = document.createElement("section");
  wrap.id = "barraProgresoInscripcion";
  wrap.className = "card";
  wrap.style.position = "sticky";
  wrap.style.top = "10px";
  wrap.style.zIndex = "20";
  wrap.style.padding = "14px 18px";

  wrap.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:8px;">
      <strong id="progresoTexto" style="color:#1e2559;">Avance del formulario</strong>
      <span id="progresoPorcentaje" style="font-weight:800; color:#1e2559;">0%</span>
    </div>
  
    <div style="height:10px; background:#fff7cc; border-radius:999px; overflow:hidden; border:1px solid #facc15;">
      <div id="progresoBarra" style="
        height:100%;
        width:0%;
        background:linear-gradient(90deg,#facc15,#f59e0b,#f97316);
        border-radius:999px;
        transition:width .25s ease;
        box-shadow:0 0 8px rgba(250, 204, 21, 0.6);
      "></div>
    </div>
  
    <div id="progresoAyuda" style="margin-top:8px; color:#64748b; font-size:12px;">
      Complete los campos requeridos para avanzar.
    </div>
  `;

  form.prepend(wrap);
}

function actualizarProgreso() {
  const barra = $("progresoBarra");
  const porcentaje = $("progresoPorcentaje");
  const ayuda = $("progresoAyuda");

  if (!barra || !porcentaje || !form || form.classList.contains("hidden")) return;

  const requeridos = obtenerCamposRequeridosVisibles();
  const total = requeridos.length || 1;
  const completos = requeridos.filter(campoEstaCompleto).length;
  const pct = Math.round((completos / total) * 100);

  barra.style.width = `${pct}%`;
  porcentaje.textContent = `${pct}%`;

  if (pct < 35) {
    ayuda.textContent = "Vamos comenzando. Complete los datos principales del viajante.";
  } else if (pct < 70) {
    ayuda.textContent = "Buen avance. Revise contactos, salud y datos importantes.";
  } else if (pct < 100) {
    ayuda.textContent = "Ya falta poco. Revise la confirmación final.";
  } else {
    ayuda.textContent = "Formulario completo. Ya puede enviar la inscripción.";
  }
}

function obtenerCamposRequeridosVisibles() {
  return Array.from(form.querySelectorAll("input, select, textarea"))
    .filter((el) => {
      if (!el.required) return false;
      if (el.disabled) return false;
      if (el.type === "hidden") return false;
      if (el.closest(".hidden")) return false;
      return true;
    });
}

function campoEstaCompleto(el) {
  if (el.type === "checkbox") return el.checked;

  if (el.type === "radio") {
    return !!document.querySelector(`input[name="${el.name}"]:checked`);
  }

  return !!limpiarTexto(el.value);
}

// -----------------------------------------------------------------------------
// UI
// -----------------------------------------------------------------------------
function aplicarEstadoUI() {
  const tipoViajante = obtenerRadio("tipoViajante");
  const esEstudiante = tipoViajante === "estudiante";
  const esProfesor = tipoViajante === "profesor";
  const esAcompanante = tipoViajante === "adulto_acompanante";
  const esAdultoOperativo = esProfesor || esAcompanante;

  const correoViajanteHint = $("correoViajanteHint");

  if (correoViajanteHint) {
    mostrar(correoViajanteHint, !esEstudiante);
  }
  
  if (correoViajanteReq) {
    mostrar(correoViajanteReq, !esEstudiante);
  }
  
  setRequired("correoViajante", !esEstudiante);
  
  const hayCorreoPersonaQueViaja = !!limpiarTexto($("correoViajante")?.value);
  mostrar(autorizaCorreoViajanteWrap, esEstudiante && hayCorreoPersonaQueViaja);

  const tipoIdentificacion = $("tipoIdentificacion")?.value || "";
  const nacionalidadBase = $("nacionalidadBase")?.value || "";
  const esInternacional = grupoEsInternacional();
  const esMenor = calcularEdad($("fechaNacimiento")?.value) < 18;

  mostrar(bloqueApoderado, esEstudiante);
  mostrar(avisoAdultoResponsableWrap, esEstudiante);
  mostrar(bloqueProfesor, esProfesor);
  mostrar(bloqueAcompanante, esAcompanante);
  mostrar(adultoCompromisoCard, esAdultoOperativo);
  mostrar(telefonoViajanteWrap, esAdultoOperativo);

  setRequired("telefonoViajante", esAdultoOperativo);
  setRequired("adultoAceptaCompromiso", esAdultoOperativo);

  const sinRut = tipoIdentificacion === "sin_rut";
  const muestraRut = !sinRut;
  const tieneRut = tipoIdentificacion === "rut";

  mostrar(rutCompletoWrap, muestraRut);
  mostrar(rutWrap, muestraRut);
  mostrar(dvWrap, muestraRut);
  mostrar(sinRutNotice, sinRut);
  
  setRequired("rutNumero", muestraRut);
  setRequired("rutDv", muestraRut);

  mostrar(nombreDocumentoWrap, tieneRut);

  if (!tieneRut) {
    limpiarRadios("nombreCoincideDocumento");
    mostrar(datosDocumentoWrap, false);
  }
  
  const nombreCoincideDocumento = obtenerRadio("nombreCoincideDocumento");
  const debeCompletarDocumento = tieneRut && nombreCoincideDocumento === "no";
  
  mostrar(datosDocumentoWrap, debeCompletarDocumento);
  
  setRequired("nombresDocumento", debeCompletarDocumento);
  setRequired("primerApellidoDocumento", debeCompletarDocumento);
  setRequired("sexoDocumento", debeCompletarDocumento);
  setRequired("declaraActualizacionDocumento", debeCompletarDocumento);
  
  if (sinRut) {
    if ($("rutNumero")) $("rutNumero").value = "";
    if ($("rutDv")) $("rutDv").value = "";
    $("rutNumero")?.classList.remove("input-error");
    $("rutDv")?.classList.remove("input-error");
  }

  const generoOtro = $("genero")?.value === "otro";
  mostrar(generoOtroWrap, generoOtro);
  setRequired("generoOtro", generoOtro);

  // Si no tiene RUT, no puede seleccionar nacionalidad chilena.
  if (tipoIdentificacion === "sin_rut" && nacionalidadBase === "chilena") {
    $("nacionalidadBase").value = "otra";
  }
  
  const nacionalidadFinal = $("nacionalidadBase")?.value || "";
  const nacionalidadDetalle = nacionalidadFinal === "extranjera" || nacionalidadFinal === "doble";
  
  mostrar(nacionalidadDetalleWrap, nacionalidadDetalle);
  setRequired("nacionalidadDetalle", nacionalidadDetalle);

  const tipoProfesorOtro = $("tipoProfesor")?.value === "otro";
  mostrar(tipoProfesorOtroWrap, tipoProfesorOtro);
  setRequired("tipoProfesor", esProfesor);
  setRequired("tipoProfesorOtro", esProfesor && tipoProfesorOtro);

  const relacionCursoOtro = $("relacionCurso")?.value === "otro";
  mostrar(relacionCursoOtroWrap, relacionCursoOtro);
  setRequired("relacionCurso", esAcompanante);
  setRequired("relacionCursoOtro", esAcompanante && relacionCursoOtro);
  setRequired("estudianteRelacionado", esAcompanante);
  const tieneHijosViaje = obtenerRadio("acompananteTieneHijosViaje") === "si";
  mostrar(acompananteConoceWrap, esAcompanante && tieneHijosViaje);

  setRequired("contactoPrincipalNombre", esEstudiante);
  setRequired("contactoPrincipalRelacion", esEstudiante);
  setRequired("contactoPrincipalTelefono", esEstudiante);
  setRequired("contactoPrincipalCorreo", esEstudiante);

  const relacionOtro = $("contactoPrincipalRelacion")?.value === "otro";
  mostrar(contactoPrincipalRelacionOtroWrap, esEstudiante && relacionOtro);
  setRequired("contactoPrincipalRelacionOtro", esEstudiante && relacionOtro);

  const hayApoderado2 = bloqueApoderado2 && !bloqueApoderado2.classList.contains("hidden");

  const contactoSecundarioOtro = $("contactoSecundarioRelacion")?.value === "otro";
  mostrar(contactoSecundarioRelacionOtroWrap, hayApoderado2 && contactoSecundarioOtro);

  mostrar(emergenciaMismoResponsableWrap, esEstudiante);
  
  const hayApoderado2Activo = bloqueApoderado2 && !bloqueApoderado2.classList.contains("hidden");
  
  mostrar(emergenciaUsarResponsable2Wrap, esEstudiante && hayApoderado2Activo);
  
  if (!esEstudiante) {
    limpiarRadios("emergenciaMismoResponsable");
  }

  const emergenciaOtro = $("emergenciaRelacion")?.value === "otro";
  mostrar(emergenciaRelacionOtroWrap, emergenciaOtro);
  setRequired("emergenciaRelacionOtro", emergenciaOtro);

  const hayEmergencia2 = bloqueEmergencia2 && !bloqueEmergencia2.classList.contains("hidden");
  
  mostrar(emergencia2MismoResponsableWrap, esEstudiante && hayEmergencia2);
  mostrar(emergencia2UsarResponsable2Wrap, esEstudiante && hayEmergencia2 && hayApoderado2Activo);
  
  if (!hayEmergencia2) {
    limpiarRadios("emergencia2MismoResponsable");
  }
  
  const emergencia2Otro = $("emergencia2Relacion")?.value === "otro";
  mostrar(emergencia2RelacionOtroWrap, hayEmergencia2 && emergencia2Otro);

  mostrar(bloqueInternacional, esInternacional);

  const debePreguntarNacionalidadDestino =
    esInternacional &&
    (nacionalidadFinal === "extranjera" || nacionalidadFinal === "doble");
  
  mostrar(nacionalidadPaisDestinoWrap, debePreguntarNacionalidadDestino);
  
  if (!debePreguntarNacionalidadDestino && $("nacionalidadPaisDestino")) {
    $("nacionalidadPaisDestino").value = "";
  }
  
  const nacionalidadPaisDestino = $("nacionalidadPaisDestino")?.value || "";
  
  const tieneNacionalidadEspecial =
    nacionalidadFinal === "extranjera" ||
    nacionalidadFinal === "doble" ||
    nacionalidadPaisDestino === "si" ||
    nacionalidadPaisDestino === "no_lo_se";
  
  mostrar(docsOtraNacionalidadWrap, esInternacional && tieneNacionalidadEspecial);
  mostrar(alertaNacionalidadDestinoWrap, esInternacional && tieneNacionalidadEspecial);

  const dietaActiva = obtenerRadio("dietaFlag") === "si";
  const tieneAlergiaAlimentaria = obtenerChecks("dietaRestricciones").includes("alergia_alimentaria");
  
  mostrar(alergiasAlimentariasWrap, dietaActiva && tieneAlergiaAlimentaria);
  
  if (!dietaActiva || !tieneAlergiaAlimentaria) {
    ["alergiaAlimentaria1ProtocoloFlag", "alergiaAlimentaria2ProtocoloFlag", "alergiaAlimentaria3ProtocoloFlag"].forEach(limpiarRadios);
  }

  const seleccionoNeuroOtra = obtenerChecks("neurodivergenciaTipos").includes("otra");
  mostrar(neurodivergenciaOtraWrap, seleccionoNeuroOtra);
  setRequired("neurodivergenciaOtra", seleccionoNeuroOtra);

  const grupoSanguineo = $("grupoSanguineo")?.value || "";
  mostrar(grupoSanguineoNoSeWrap, grupoSanguineo === "no_informado");
  setRequired("declaraGrupoSanguineoPendiente", grupoSanguineo === "no_informado");

  actualizarProgreso();
}

function obtenerResponsableParaEmergencia(valor = "") {
  if (valor === "responsable_1") {
    return {
      nombre: limpiarTexto($("contactoPrincipalNombre")?.value),
      relacion: $("contactoPrincipalRelacion")?.value || "",
      telefono: limpiarTexto($("contactoPrincipalTelefono")?.value)
    };
  }

  if (valor === "responsable_2") {
    return {
      nombre: limpiarTexto($("contactoSecundarioNombre")?.value),
      relacion: $("contactoSecundarioRelacion")?.value || "",
      telefono: limpiarTexto($("contactoSecundarioTelefono")?.value)
    };
  }

  return null;
}

function aplicarEmergenciaDesdeResponsable(numero = 1) {
  const tipoViajante = obtenerRadio("tipoViajante");
  const esEstudiante = tipoViajante === "estudiante";

  if (!esEstudiante) return;

  const nombreRadio = numero === 2
    ? "emergencia2MismoResponsable"
    : "emergenciaMismoResponsable";

  const seleccion = obtenerRadio(nombreRadio);

  if (!seleccion || seleccion === "manual") return;

  const responsable = obtenerResponsableParaEmergencia(seleccion);

  if (!responsable) return;

  if (numero === 2) {
    if ($("emergencia2Nombre")) $("emergencia2Nombre").value = responsable.nombre;
    if ($("emergencia2Relacion")) $("emergencia2Relacion").value = responsable.relacion;
    if ($("emergencia2Telefono")) $("emergencia2Telefono").value = responsable.telefono;
  } else {
    if ($("emergenciaNombre")) $("emergenciaNombre").value = responsable.nombre;
    if ($("emergenciaRelacion")) $("emergenciaRelacion").value = responsable.relacion;
    if ($("emergenciaTelefono")) $("emergenciaTelefono").value = responsable.telefono;
  }
}

// -----------------------------------------------------------------------------
// RUT
// -----------------------------------------------------------------------------
function onRutInput() {
  const numeroInput = $("rutNumero");
  const dvInput = $("rutDv");

  if (!numeroInput || !dvInput) return;

  const numero = limpiarRutNumero(numeroInput.value).slice(0, 8);
  const dv = limpiarTexto(dvInput.value).toUpperCase().replace(/[^0-9K]/g, "").slice(0, 1);

  numeroInput.value = numero;
  dvInput.value = dv;

  if (!numero || !dv) {
    numeroInput.classList.remove("input-error");
    dvInput.classList.remove("input-error");
    if (rutHint) rutHint.textContent = "Ingrese cuerpo del RUT y dígito verificador.";
    return;
  }

  const dvCorrecto = calcularDvRut(numero);
  const valido = /^\d{7,8}$/.test(numero) && dv === dvCorrecto;

  numeroInput.classList.toggle("input-error", !valido);
  dvInput.classList.toggle("input-error", !valido);

  if (rutHint) {
    rutHint.textContent = valido ? "RUT válido ✔" : "RUT inválido";
  }
}

// -----------------------------------------------------------------------------
// SUBMIT
// -----------------------------------------------------------------------------
async function onSubmit(event) {
  event.preventDefault();
  ocultarMensaje();

  if (!grupoData) {
    mostrarMensaje("error", "No fue posible validar el grupo.");
    return;
  }

  aplicarEstadoUI();

  const errores = validarFormulario();

  if (errores.length) {
    mostrarMensaje("error", errores.join("<br>"));
    window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }

  const segundoApellido = limpiarTexto($("segundoApellido")?.value);

  if (!segundoApellido) {
    const ok = window.confirm(
      "El campo segundo apellido está en blanco. ¿Es correcto que el viajante no tiene segundo apellido?"
    );

    if (!ok) {
      mostrarMensaje("error", "Complete el segundo apellido antes de enviar.");
      return;
    }
  }

  btnEnviar.disabled = true;
  btnEnviar.textContent = "Enviando formulario...";

  try {
      const payloadBase = construirPayloadBase();
      
      await enviarInscripcionPendiente(payloadBase);
      
      mostrarPantallaFinal(payloadBase);

  } catch (error) {
    console.error("ERROR INSCRIPCION:", {
      message: error?.message,
      code: error?.code,
      name: error?.name,
      stack: error?.stack
    });
  
    if (error.message === "duplicate_document") {
      mostrarMensaje(
        "error",
        `Ya existe una inscripción para este documento dentro del grupo. Comuníquese con <strong>${CORREO_ADMIN}</strong>, al <strong>${TELEFONO_ADMIN}</strong> o al WhatsApp <strong>${WHATSAPP_ADMIN}</strong>.`
      );
    } else if (error.message === "duplicate_no_rut_name") {
      mostrarMensaje(
        "error",
        `Ya existe una inscripción con esos nombres y apellidos en este grupo. Comuníquese con <strong>${CORREO_ADMIN}</strong>, al <strong>${TELEFONO_ADMIN}</strong> o al WhatsApp <strong>${WHATSAPP_ADMIN}</strong>.`
      );
    } else {
      const codigoError = error?.code || error?.message || "error_desconocido";
  
      mostrarMensaje(
        "error",
        `
          No fue posible completar la inscripción en este momento.
          <br><br>
          Por favor, intente nuevamente. Si el problema continúa, comuníquese con
          <strong>${CORREO_ADMIN}</strong> o al WhatsApp <strong>${WHATSAPP_ADMIN}</strong>
          e indique este código:
          <br>
          <strong>${escapeHtml(codigoError)}</strong>
        `
      );
    }

    window.scrollTo({ top: 0, behavior: "smooth" });
  } finally {
    btnEnviar.disabled = false;
    btnEnviar.textContent = "Enviar inscripción";
  }
}

// -----------------------------------------------------------------------------
// GUARDADO EN BACKEND
// -----------------------------------------------------------------------------
async function enviarInscripcionPendiente(payloadBase) {
  await addDoc(collection(db, COLECCION_INSCRIPCIONES_PENDIENTES), {
    idGrupo,
    token: tokenUrl,
    fase: faseUrl,
    payload: limpiarPayloadFirestore(payloadBase),
    estado: "pendiente",
    creadoEn: serverTimestamp(),
    origen: "formulario_publico"
  });

  return { ok: true };
}

// -----------------------------------------------------------------------------
// VALIDACIONES
// -----------------------------------------------------------------------------
function validarFormulario() {
  const errores = [];

  const tipoViajante = obtenerRadio("tipoViajante");
  const esEstudiante = tipoViajante === "estudiante";
  const esProfesor = tipoViajante === "profesor";
  const esAcompanante = tipoViajante === "adulto_acompanante";
  const esAdultoOperativo = esProfesor || esAcompanante;

  const tipoIdentificacion = $("tipoIdentificacion")?.value || "";
  const esInternacional = grupoEsInternacional();
  const edad = calcularEdad($("fechaNacimiento")?.value);
  const esMenor = edad < 18;

  if (!tipoViajante) errores.push("Debe indicar el tipo de viajante.");
  if (!limpiarTexto($("nombres")?.value)) errores.push("Debe ingresar los nombres del viajante.");
  if (!limpiarTexto($("primerApellido")?.value)) errores.push("Debe ingresar el primer apellido del viajante.");

  if (!$("genero")?.value) errores.push("Debe indicar el género del viajante.");
  if ($("genero")?.value === "otro" && !limpiarTexto($("generoOtro")?.value)) {
    errores.push("Debe especificar el género del viajante.");
  }

  if (!tipoIdentificacion) errores.push("Debe seleccionar el documento de identidad.");

  if (tipoIdentificacion === "rut") {
    const rutNumero = limpiarRutNumero($("rutNumero")?.value);
    const dv = limpiarTexto($("rutDv")?.value).toUpperCase();
  
    if (!rutNumero || !dv) {
      errores.push("Debe ingresar el RUT completo.");
    } else if (!/^\d{7,8}$/.test(rutNumero)) {
      errores.push("Debe ingresar un RUT válido.");
    } else if (dv !== calcularDvRut(rutNumero)) {
      errores.push("El RUT ingresado es inválido.");
    }
  
    const nombreCoincideDocumento = obtenerRadio("nombreCoincideDocumento");
  
    if (!nombreCoincideDocumento) {
      errores.push("Debe indicar si el nombre coincide con el documento de identidad.");
    }
  
    if (nombreCoincideDocumento === "no") {
      if (!limpiarTexto($("nombresDocumento")?.value)) {
        errores.push("Debe ingresar los nombres según documento.");
      }
  
      if (!limpiarTexto($("primerApellidoDocumento")?.value)) {
        errores.push("Debe ingresar el primer apellido según documento.");
      }
  
      if (!$("sexoDocumento")?.value) {
        errores.push("Debe indicar el sexo que aparece en el documento.");
      }
  
      if (!$("declaraActualizacionDocumento")?.checked) {
        errores.push("Debe aceptar la declaración de actualización de documento antes del viaje.");
      }
    }
  }

  if (!$("fechaNacimiento")?.value) errores.push("Debe ingresar la fecha de nacimiento.");

  if (!$("nacionalidadBase")?.value) errores.push("Debe indicar la nacionalidad.");
  if (tipoIdentificacion === "sin_rut" && $("nacionalidadBase")?.value === "chilena") {
    errores.push("Si el viajante tiene nacionalidad chilena, debe ingresar RUT.");
  }

  if (
    ["extranjera", "doble"].includes($("nacionalidadBase")?.value) &&
    !limpiarTexto($("nacionalidadDetalle")?.value)
  ) {
    errores.push("Debe especificar la nacionalidad o nacionalidades.");
  }

  if (!$("tallaPolera")?.value) {
    errores.push("Debe indicar la talla de polera.");
  }
  
  if (!esEstudiante && !validarCorreo($("correoViajante")?.value)) {
    errores.push("Debe ingresar un correo válido de la persona que viaja.");
  }
  
  if (esEstudiante && $("correoViajante")?.value && !validarCorreo($("correoViajante")?.value)) {
    errores.push("Debe ingresar un correo válido de la persona que viaja o dejarlo vacío.");
  }

  if (esAdultoOperativo && !telefonoValido($("telefonoViajante")?.value)) {
    errores.push("Debe ingresar un teléfono válido del viajante.");
  }

  if (esProfesor) {
    if (!$("tipoProfesor")?.value) errores.push("Debe indicar el tipo de profesor.");
    if ($("tipoProfesor")?.value === "otro" && !limpiarTexto($("tipoProfesorOtro")?.value)) {
      errores.push("Debe especificar el tipo de profesor.");
    }
  }

  if (esAcompanante) {
    if (!$("relacionCurso")?.value) errores.push("Debe indicar la relación con el curso.");
    if ($("relacionCurso")?.value === "otro" && !limpiarTexto($("relacionCursoOtro")?.value)) {
      errores.push("Debe especificar la relación con el curso.");
    }
    if (!limpiarTexto($("estudianteRelacionadoNombres")?.value)) {
      errores.push("Debe ingresar los nombres del estudiante relacionado.");
    }
    
    if (!limpiarTexto($("estudianteRelacionadoPrimerApellido")?.value)) {
      errores.push("Debe ingresar el primer apellido del estudiante relacionado.");
    }
  }

  if (esEstudiante) {
    if (!limpiarTexto($("contactoPrincipalNombre")?.value)) errores.push("Debe ingresar el nombre del apoderado.");
    if (!$("contactoPrincipalRelacion")?.value) errores.push("Debe indicar la relación del apoderado.");
    if ($("contactoPrincipalRelacion")?.value === "otro" && !limpiarTexto($("contactoPrincipalRelacionOtro")?.value)) {
      errores.push("Debe especificar la relación del apoderado.");
    }
    if (!telefonoValido($("contactoPrincipalTelefono")?.value)) errores.push("Debe ingresar un teléfono válido del apoderado.");
    if (!validarCorreo($("contactoPrincipalCorreo")?.value)) errores.push("Debe ingresar un correo válido del apoderado.");

    if (apoderado2Activo()) {
      if (!limpiarTexto($("contactoSecundarioNombre")?.value)) errores.push("Debe ingresar el nombre del segundo apoderado.");
      if (!$("contactoSecundarioRelacion")?.value) errores.push("Debe indicar la relación del segundo apoderado.");
      if ($("contactoSecundarioRelacion")?.value === "otro" && !limpiarTexto($("contactoSecundarioRelacionOtro")?.value)) {
        errores.push("Debe especificar la relación del segundo apoderado.");
      }
      if (!telefonoValido($("contactoSecundarioTelefono")?.value)) errores.push("Debe ingresar un teléfono válido del segundo apoderado.");
      if ($("contactoSecundarioCorreo")?.value && !validarCorreo($("contactoSecundarioCorreo")?.value)) {
        errores.push("Debe ingresar un correo válido del segundo apoderado.");
      }
    }
  }

  if (!limpiarTexto($("emergenciaNombre")?.value)) errores.push("Debe ingresar el contacto de emergencia.");
  if (!$("emergenciaRelacion")?.value) errores.push("Debe indicar la relación del contacto de emergencia.");
  if ($("emergenciaRelacion")?.value === "otro" && !limpiarTexto($("emergenciaRelacionOtro")?.value)) {
    errores.push("Debe especificar la relación del contacto de emergencia.");
  }
  if (!telefonoValido($("emergenciaTelefono")?.value)) errores.push("Debe ingresar un teléfono válido de emergencia.");

  if (emergencia2Activa()) {
    if (!limpiarTexto($("emergencia2Nombre")?.value)) errores.push("Debe ingresar el nombre del segundo contacto de emergencia.");
    if (!$("emergencia2Relacion")?.value) errores.push("Debe indicar la relación del segundo contacto de emergencia.");
    if ($("emergencia2Relacion")?.value === "otro" && !limpiarTexto($("emergencia2RelacionOtro")?.value)) {
      errores.push("Debe especificar la relación del segundo contacto de emergencia.");
    }
    if (!telefonoValido($("emergencia2Telefono")?.value)) errores.push("Debe ingresar un teléfono válido del segundo contacto de emergencia.");
  }

  if (esInternacional && !$("declaraDocumentacionViaje")?.checked) {
    errores.push("Debe declarar responsabilidad sobre la documentación del viaje.");
  }
  
  const nacionalidadEspecial =
    ["extranjera", "doble"].includes($("nacionalidadBase")?.value) ||
    ["si", "no_lo_se"].includes($("nacionalidadPaisDestino")?.value);
  
  const debePreguntarNacionalidadDestino =
    esInternacional &&
    ["extranjera", "doble"].includes($("nacionalidadBase")?.value);
  
  if (debePreguntarNacionalidadDestino && !$("nacionalidadPaisDestino")?.value) {
    errores.push("Debe indicar si la persona viajera tiene nacionalidad del país de destino.");
  }
  
  if (esInternacional && nacionalidadEspecial && !$("declaraRevisionConsulado")?.checked) {
    errores.push("Debe confirmar la revisión documental o consular aplicable.");
  }

  if (obtenerRadio("discapacidadFlag") === "si") {
    if (!obtenerChecks("discapacidadTipos").length) errores.push("Debe seleccionar al menos un tipo de discapacidad.");
    if (!limpiarTexto($("discapacidadDescripcion")?.value)) errores.push("Debe describir la condición de discapacidad.");
  }
  
  if (obtenerRadio("discapacidadApoyosFlag") === "si") {
    if (!limpiarTexto($("discapacidadApoyoTipo")?.value)) errores.push("Debe indicar el tipo de apoyo o adaptación requerida.");
  }
  
  if (obtenerRadio("discapacidadAyudasTecnicasFlag") === "si") {
    if (!limpiarTexto($("discapacidadAyudaTecnica")?.value)) errores.push("Debe indicar la ayuda técnica utilizada.");
  }
  
  if (obtenerRadio("neurodivergenciaFlag") === "si") {
    if (!obtenerChecks("neurodivergenciaTipos").length) errores.push("Debe seleccionar al menos un tipo de neurodivergencia.");
    if (obtenerChecks("neurodivergenciaTipos").includes("otra") && !limpiarTexto($("neurodivergenciaOtra")?.value)) {
      errores.push("Debe indicar cuál es la otra condición asociada a neurodivergencia.");
    }
    if (!limpiarTexto($("neurodivergenciaDescripcion")?.value)) errores.push("Debe describir la condición asociada a neurodivergencia.");
  }
  
  if (obtenerRadio("neuroSobrecargaFlag") === "si") {
    if (!limpiarTexto($("neuroFactores")?.value)) errores.push("Debe indicar situaciones o factores que podrían afectar el bienestar.");
  }
  
  if (obtenerRadio("neuroApoyosFlag") === "si") {
    if (!limpiarTexto($("neuroApoyosDetalle")?.value)) errores.push("Debe detallar apoyos o consideraciones necesarias.");
  }
  
  if (obtenerRadio("saludMentalFlag") === "si" && !limpiarTexto($("saludMentalDetalle")?.value)) {
    errores.push("Debe describir la condición de salud mental informada.");
  }
  
  if (!$("grupoSanguineo")?.value) {
    errores.push("Debe seleccionar el grupo sanguíneo o indicar No informado.");
  }
  
  if ($("grupoSanguineo")?.value === "no_informado" && !$("declaraGrupoSanguineoPendiente")?.checked) {
    errores.push("Debe confirmar que toma conocimiento de no estar informando el grupo sanguíneo en este momento.");
  }
  
  if (obtenerRadio("enfermedadBaseFlag") === "si" && !limpiarTexto($("enfermedadBaseDetalle")?.value)) {
    errores.push("Debe detallar la enfermedad de base.");
  }

  if (obtenerRadio("saludGeneralFlag") === "si" && !limpiarTexto($("saludGeneralDetalle")?.value)) {
    errores.push("Debe detallar la condición de salud.");
  }

  if (obtenerRadio("cirugiasPreviasFlag") === "si" && !limpiarTexto($("cirugiasPreviasDetalle")?.value)) {
    errores.push("Debe detallar las cirugías, hospitalizaciones o tratamientos relevantes.");
  }
  
  if (obtenerRadio("emergenciaMedicaFlag") === "si" && !limpiarTexto($("emergenciaMedicaDetalle")?.value)) {
    errores.push("Debe detallar el antecedente importante para una atención médica de emergencia.");
  }

  if (obtenerRadio("medicamentosFlag") === "si" && !limpiarTexto($("medicamentosDetalle")?.value)) {
    errores.push("Debe detallar los medicamentos.");
  }

  if (obtenerRadio("medicamentosProhibidosFlag") === "si" && !limpiarTexto($("medicamentosProhibidosDetalle")?.value)) {
    errores.push("Debe detallar los medicamentos prohibidos.");
  }

  if (obtenerRadio("alergiasFlag") === "si" && !limpiarTexto($("alergiasDetalle")?.value)) {
    errores.push("Debe detallar la alergia.");
  }

  if (obtenerRadio("dietaFlag") === "si") {
    const dietaPrincipal = obtenerRadio("dietaPrincipal");
    const restricciones = obtenerChecks("dietaRestricciones");
  
    if (!dietaPrincipal && !restricciones.length) {
      errores.push("Debe seleccionar al menos una dieta, alergia o restricción alimentaria.");
    }
  
    if (restricciones.includes("alergia_alimentaria")) {
      const alergias = obtenerAlergiasAlimentarias();
      if (!alergias.length) errores.push("Debe ingresar al menos una alergia alimentaria.");
    }
  }

  if (obtenerRadio("otrosAntecedentesFlag") === "si" && !limpiarTexto($("otrosAntecedentesDetalle")?.value)) {
    errores.push("Debe detallar la información adicional.");
  }

  if (esAdultoOperativo && !$("adultoAceptaCompromiso")?.checked) {
    errores.push("Debe aceptar la declaración de responsabilidad.");
  }

  if (!$("aceptaVeracidad")?.checked) errores.push("Debe aceptar la declaración de veracidad.");
  if (!$("aceptaUsoInterno")?.checked) errores.push("Debe autorizar el uso interno de la información.");
  if (!$("aceptaCambiosCorreo")?.checked) errores.push("Debe aceptar la condición de modificación posterior.");

  return errores;
}

// -----------------------------------------------------------------------------
// PAYLOAD
// -----------------------------------------------------------------------------
function construirPayloadBase() {
  const tipoViajante = obtenerRadio("tipoViajante");
  const esEstudiante = tipoViajante === "estudiante";
  const esProfesor = tipoViajante === "profesor";
  const esAcompanante = tipoViajante === "adulto_acompanante";
  const esAdultoOperativo = esProfesor || esAcompanante;

  const fechaNacimiento = $("fechaNacimiento")?.value || null;
  const edad = calcularEdad(fechaNacimiento);
  const esMenor = edad < 18;
  const esInternacional = grupoEsInternacional();

  const nombres = limpiarTexto($("nombres")?.value);
  const primerApellido = limpiarTexto($("primerApellido")?.value);
  const segundoApellido = limpiarTexto($("segundoApellido")?.value);
  const sinSegundoApellido = !segundoApellido;
  const nombreCompleto = [nombres, primerApellido, segundoApellido].filter(Boolean).join(" ");

  const tipoIdentificacion = $("tipoIdentificacion")?.value || "";
  const rutNumero = limpiarRutNumero($("rutNumero")?.value);
  const rutDv = limpiarTexto($("rutDv")?.value).toUpperCase();

  let documento = "";
  let documentoNormalizado = "";
  let rut = "";

  if (tipoIdentificacion === "rut") {
    rut = `${rutNumero}-${rutDv}`;
    documento = rut;
    documentoNormalizado = normalizarRutDocumento(rutNumero, rutDv);
  }

  const genero = $("genero")?.value || "";
  const generoOtro = limpiarTexto($("generoOtro")?.value);
  const generoFinal = genero === "otro" ? generoOtro : genero;

  const contactoRelacion = $("contactoPrincipalRelacion")?.value || "";
  const contactoRelacionOtro = limpiarTexto($("contactoPrincipalRelacionOtro")?.value);
  const contactoRelacionFinal = contactoRelacion === "otro" ? contactoRelacionOtro : contactoRelacion;

  const emergenciaRelacion = $("emergenciaRelacion")?.value || "";
  const emergenciaRelacionOtro = limpiarTexto($("emergenciaRelacionOtro")?.value);
  const emergenciaRelacionFinal = emergenciaRelacion === "otro" ? emergenciaRelacionOtro : emergenciaRelacion;

  const tipoProfesor = $("tipoProfesor")?.value || "";
  const tipoProfesorOtro = limpiarTexto($("tipoProfesorOtro")?.value);
  const tipoProfesorFinal = tipoProfesor === "otro" ? tipoProfesorOtro : tipoProfesor;

  const relacionCurso = $("relacionCurso")?.value || "";
  const relacionCursoOtro = limpiarTexto($("relacionCursoOtro")?.value);
  const relacionCursoFinal = relacionCurso === "otro" ? relacionCursoOtro : relacionCurso;

  const contactoSecundarioActivo = apoderado2Activo();
  const emergenciaSecundariaActiva = emergencia2Activa();

  const estudianteRelacionadoNombres = limpiarTexto($("estudianteRelacionadoNombres")?.value);
  const estudianteRelacionadoPrimerApellido = limpiarTexto($("estudianteRelacionadoPrimerApellido")?.value);
  const estudianteRelacionadoSegundoApellido = limpiarTexto($("estudianteRelacionadoSegundoApellido")?.value);
  const estudianteRelacionadoNombreCompleto = [
    estudianteRelacionadoNombres,
    estudianteRelacionadoPrimerApellido,
    estudianteRelacionadoSegundoApellido
  ].filter(Boolean).join(" ");

  const contextoFormulario = getContextoFormulario();
  
  return {
    tipoRegistro: "inscripcion_pasajero",
    
    faseInscripcion: faseUrl,
    contextoFormulario: contextoFormulario.clave,
    estadoInscripcion: contextoFormulario.tipoInscripcion,
    tipoInscripcion: contextoFormulario.tipoInscripcion,
    tipoInscripcionLabel: contextoFormulario.tipoInscripcionLabel,
    estadoCupo: contextoFormulario.estadoCupo,
  
    privacidad: {
      estado: "activa",
      anonimizada: false,
      eliminada: false,
      motivo: ""
    },
  
    tipoViajante,
    esEstudiante,
    esProfesor,
    esAcompanante,
    esAdulto: esAdultoOperativo,
    esMenor,

    grupo: {
      idGrupo,
      aliasGrupo: limpiarTexto(grupoData?.aliasGrupo),
      nombreGrupo: limpiarTexto(grupoData?.nombreGrupo),
      colegio: limpiarTexto(grupoData?.colegio),
      cursoBase: limpiarTexto(grupoData?.curso),
      cursoActualInscripcion: obtenerCursoActualInscripcion(grupoData),
      cantidadGrupo: grupoData?.cantidadGrupo ?? grupoData?.cantidadgrupo ?? null,
      anoViaje: grupoData?.anoViaje ?? null,
      destinoPrincipal: limpiarTexto(grupoData?.destinoPrincipal || grupoData?.destino),
      internacional: esInternacional
    },

    identificacion: {
      tipoIdentificacion,
      documento,
      documentoNormalizado,
      rut,
      rutNumero: tipoIdentificacion === "rut" ? rutNumero : "",
      rutDv: tipoIdentificacion === "rut" ? rutDv : "",
      rutInterno: "",
      esRutInterno: false,

      nombres,
      primerApellido,
      segundoApellido,
      sinSegundoApellido,
      nombreCompleto,

      genero,
      generoOtro,
      generoFinal,

      fechaNacimiento,
      edad,
      nacionalidadBase: $("nacionalidadBase")?.value || "",
      nacionalidadDetalle: limpiarTexto($("nacionalidadDetalle")?.value),

      correoViajante: limpiarTexto($("correoViajante")?.value),
      telefonoViajante: esAdultoOperativo ? limpiarTexto($("telefonoViajante")?.value) : "",
      telefonoViajanteEsWhatsapp: esAdultoOperativo,
      tallaPolera: $("tallaPolera")?.value || "",

      correoPersonaQueViaja: limpiarTexto($("correoViajante")?.value),
      autorizaCorreosPreviosPersonaQueViaja: esEstudiante
        ? !!$("autorizaCorreoViajante")?.checked
        : true
    },

    documentoIdentidad: {
      aplica: tipoIdentificacion === "rut",
      nombreCoincideDocumento: tipoIdentificacion === "rut"
        ? obtenerRadio("nombreCoincideDocumento")
        : "",
      nombresDocumento: tipoIdentificacion === "rut" && obtenerRadio("nombreCoincideDocumento") === "no"
        ? limpiarTexto($("nombresDocumento")?.value)
        : "",
      primerApellidoDocumento: tipoIdentificacion === "rut" && obtenerRadio("nombreCoincideDocumento") === "no"
        ? limpiarTexto($("primerApellidoDocumento")?.value)
        : "",
      segundoApellidoDocumento: tipoIdentificacion === "rut" && obtenerRadio("nombreCoincideDocumento") === "no"
        ? limpiarTexto($("segundoApellidoDocumento")?.value)
        : "",
      sexoDocumento: tipoIdentificacion === "rut" && obtenerRadio("nombreCoincideDocumento") === "no"
        ? $("sexoDocumento")?.value || ""
        : "",
      declaraActualizacionDocumento: tipoIdentificacion === "rut" && obtenerRadio("nombreCoincideDocumento") === "no"
        ? !!$("declaraActualizacionDocumento")?.checked
        : false
    },

    profesor: {
      aplica: esProfesor,
      tipoProfesor: esProfesor ? tipoProfesorFinal : "",
      tipoProfesorBase: esProfesor ? tipoProfesor : "",
      tipoProfesorOtro: esProfesor ? tipoProfesorOtro : "",
      interesConoceRaitrai: esProfesor ? !!$("interesConoceRaitrai")?.checked : false
    },

    adultoAcompanante: {
      aplica: esAcompanante,
      relacionCurso: esAcompanante ? relacionCursoFinal : "",
      relacionCursoBase: esAcompanante ? relacionCurso : "",
      relacionCursoOtro: esAcompanante ? relacionCursoOtro : "",
      estudianteRelacionado: esAcompanante ? estudianteRelacionadoNombreCompleto : "",
      estudianteRelacionadoNombres: esAcompanante ? estudianteRelacionadoNombres : "",
      estudianteRelacionadoPrimerApellido: esAcompanante ? estudianteRelacionadoPrimerApellido : "",
      estudianteRelacionadoSegundoApellido: esAcompanante ? estudianteRelacionadoSegundoApellido : "",
      acompananteTieneHijosViaje: esAcompanante ? (obtenerRadio("acompananteTieneHijosViaje") || "") : "",
      interesConoceRaitrai: esAcompanante ? !!$("interesConoceRaitraiAcompanante")?.checked : false
    },

    contactoPrincipal: {
      aplica: esEstudiante,
      nombre: esEstudiante ? limpiarTexto($("contactoPrincipalNombre")?.value) : nombreCompleto,
      relacion: esEstudiante ? contactoRelacionFinal : "mismo_viajante",
      relacionBase: esEstudiante ? contactoRelacion : "mismo_viajante",
      telefono: esEstudiante ? limpiarTexto($("contactoPrincipalTelefono")?.value) : limpiarTexto($("telefonoViajante")?.value),
      esWhatsapp: true,
      whatsappAlternativo: "",
      correo: esEstudiante ? limpiarTexto($("contactoPrincipalCorreo")?.value) : limpiarTexto($("correoViajante")?.value)
    },

    contactoSecundario: {
      aplica: esEstudiante && contactoSecundarioActivo,
      nombre: contactoSecundarioActivo ? limpiarTexto($("contactoSecundarioNombre")?.value) : "",
      relacion: contactoSecundarioActivo
        ? ($("contactoSecundarioRelacion")?.value === "otro"
          ? limpiarTexto($("contactoSecundarioRelacionOtro")?.value)
          : $("contactoSecundarioRelacion")?.value)
        : "",
      relacionBase: contactoSecundarioActivo ? $("contactoSecundarioRelacion")?.value : "",
      telefono: contactoSecundarioActivo ? limpiarTexto($("contactoSecundarioTelefono")?.value) : "",
      esWhatsapp: contactoSecundarioActivo,
      whatsappAlternativo: "",
      correo: contactoSecundarioActivo ? limpiarTexto($("contactoSecundarioCorreo")?.value) : ""
    },

    emergencia: {
      nombre: limpiarTexto($("emergenciaNombre")?.value),
      relacion: emergenciaRelacionFinal,
      relacionBase: emergenciaRelacion,
      telefono: limpiarTexto($("emergenciaTelefono")?.value),
      esWhatsapp: true,
      whatsappAlternativo: ""
    },

    emergenciaSecundaria: {
      aplica: emergenciaSecundariaActiva,
      nombre: emergenciaSecundariaActiva ? limpiarTexto($("emergencia2Nombre")?.value) : "",
      relacion: emergenciaSecundariaActiva
        ? ($("emergencia2Relacion")?.value === "otro"
          ? limpiarTexto($("emergencia2RelacionOtro")?.value)
          : $("emergencia2Relacion")?.value)
        : "",
      relacionBase: emergenciaSecundariaActiva ? $("emergencia2Relacion")?.value : "",
      telefono: emergenciaSecundariaActiva ? limpiarTexto($("emergencia2Telefono")?.value) : "",
      esWhatsapp: emergenciaSecundariaActiva,
      whatsappAlternativo: ""
    },

    documentacion: {
      aplicaInternacional: esInternacional,
      declaraDocumentacionViaje: esInternacional ? !!$("declaraDocumentacionViaje")?.checked : false,
      nacionalidadPaisDestino: esInternacional ? ($("nacionalidadPaisDestino")?.value || "") : "",
      declaraRevisionConsulado: esInternacional ? !!$("declaraRevisionConsulado")?.checked : false,
      guiaCasosParticularesDisponible: esInternacional
    },

    salud: {
      discapacidadFlag: obtenerRadio("discapacidadFlag") || "",
      discapacidadTipos: obtenerChecks("discapacidadTipos"),
      discapacidadDescripcion: limpiarTexto($("discapacidadDescripcion")?.value),
      
      discapacidadApoyosFlag: obtenerRadio("discapacidadApoyosFlag") || "",
      discapacidadApoyoTipo: limpiarTexto($("discapacidadApoyoTipo")?.value),
      discapacidadRecomendaciones: limpiarTexto($("discapacidadRecomendaciones")?.value),
      
      discapacidadAyudasTecnicasFlag: obtenerRadio("discapacidadAyudasTecnicasFlag") || "",
      discapacidadAyudaTecnica: limpiarTexto($("discapacidadAyudaTecnica")?.value),
      discapacidadAyudaIndicaciones: limpiarTexto($("discapacidadAyudaIndicaciones")?.value),
      
      neurodivergenciaFlag: obtenerRadio("neurodivergenciaFlag") || "",
      neurodivergenciaTipos: obtenerChecks("neurodivergenciaTipos"),
      neurodivergenciaOtra: limpiarTexto($("neurodivergenciaOtra")?.value),
      neurodivergenciaDescripcion: limpiarTexto($("neurodivergenciaDescripcion")?.value),
      
      neuroSobrecargaFlag: obtenerRadio("neuroSobrecargaFlag") || "",
      neuroFactores: limpiarTexto($("neuroFactores")?.value),
      neuroEstrategias: limpiarTexto($("neuroEstrategias")?.value),
      
      neuroApoyosFlag: obtenerRadio("neuroApoyosFlag") || "",
      neuroApoyosDetalle: limpiarTexto($("neuroApoyosDetalle")?.value),
      
      saludMentalFlag: obtenerRadio("saludMentalFlag") || "",
      saludMentalDetalle: limpiarTexto($("saludMentalDetalle")?.value),
      
      dietaPrincipal: obtenerRadio("dietaPrincipal") || "",
      dietaRestricciones: obtenerChecks("dietaRestricciones"),
      
      alergiaAlimentariaFlag: obtenerChecks("dietaRestricciones").includes("alergia_alimentaria") ? "si" : "no",
      alergiasAlimentarias: obtenerChecks("dietaRestricciones").includes("alergia_alimentaria")
        ? obtenerAlergiasAlimentarias()
        : [],
      
      conoceGrupoSanguineoFlag: $("grupoSanguineo")?.value === "no_informado" ? "no" : "si",
      grupoSanguineo: $("grupoSanguineo")?.value || "",
      declaraGrupoSanguineoPendiente: $("grupoSanguineo")?.value === "no_informado"
        ? !!$("declaraGrupoSanguineoPendiente")?.checked
        : false,
      enfermedadBaseFlag: obtenerRadio("enfermedadBaseFlag") || "",
      enfermedadBaseDetalle: limpiarTexto($("enfermedadBaseDetalle")?.value),

      saludGeneralFlag: obtenerRadio("saludGeneralFlag") || "",
      saludGeneralDetalle: limpiarTexto($("saludGeneralDetalle")?.value),
      
      cirugiasPreviasFlag: obtenerRadio("cirugiasPreviasFlag") || "",
      cirugiasPreviasDetalle: limpiarTexto($("cirugiasPreviasDetalle")?.value),
      
      emergenciaMedicaFlag: obtenerRadio("emergenciaMedicaFlag") || "",
      emergenciaMedicaDetalle: limpiarTexto($("emergenciaMedicaDetalle")?.value),
      
      medicamentosFlag: obtenerRadio("medicamentosFlag") || "",
      medicamentosDetalle: limpiarTexto($("medicamentosDetalle")?.value),

      medicamentosProhibidosFlag: obtenerRadio("medicamentosProhibidosFlag") || "",
      medicamentosProhibidosDetalle: limpiarTexto($("medicamentosProhibidosDetalle")?.value),

      alergiasFlag: obtenerRadio("alergiasFlag") || "",
      alergiasDetalle: limpiarTexto($("alergiasDetalle")?.value),

      dietaFlag: obtenerRadio("dietaFlag") || "",
      dietaTipos: [
        obtenerRadio("dietaPrincipal"),
        ...obtenerChecks("dietaRestricciones")
      ].filter(Boolean),
      
      dietaDetalle: limpiarTexto($("dietaDetalle")?.value),

      otrosAntecedentesFlag: obtenerRadio("otrosAntecedentesFlag") || "",
      otrosAntecedentesDetalle: limpiarTexto($("otrosAntecedentesDetalle")?.value)
    },

    adultoCompromiso: {
      aplica: esAdultoOperativo,
      aceptaCompromiso: esAdultoOperativo ? !!$("adultoAceptaCompromiso")?.checked : false,
      observaciones: limpiarTexto($("adultoObservacionesCompromiso")?.value)
    },

    consentimiento: {
      aceptaVeracidad: !!$("aceptaVeracidad")?.checked,
      aceptaUsoInterno: !!$("aceptaUsoInterno")?.checked,
      aceptaCambiosCorreo: !!$("aceptaCambiosCorreo")?.checked,
      correoCambios: CORREO_ADMIN,
      telefonoCambios: TELEFONO_ADMIN,
      whatsappCambios: WHATSAPP_ADMIN
    },

    meta: {
      fechaInscripcion: null,
      canal: "formulario_publico",
      versionFormulario: 4,
      creadoDesde: window.location.href,
      estado: "inscrito"
    }
  };
}

function obtenerDestinatariosCorreoRespaldo(payload) {
  const correos = [];

  if (payload?.tipoViajante === "estudiante") {
    const correo1 = limpiarTexto(payload?.contactoPrincipal?.correo);
    const correo2 = limpiarTexto(payload?.contactoSecundario?.correo);

    if (correo1) correos.push(correo1);
    if (correo2) correos.push(correo2);
  } else if (payload?.tipoViajante === "profesor" || payload?.tipoViajante === "adulto_acompanante") {
    const correo = limpiarTexto(payload?.identificacion?.correoViajante);
    if (correo) correos.push(correo);
  } else {
    const correo = limpiarTexto(payload?.contactoPrincipal?.correo || payload?.identificacion?.correoViajante);
    if (correo) correos.push(correo);
  }

  return [...new Set(correos.filter(validarCorreo))];
}

function obtenerDestinatariosPantallaFinal(payload) {
  const correos = [];

  if (payload?.tipoViajante === "estudiante") {
    const correo1 = limpiarTexto(payload?.contactoPrincipal?.correo);
    const correo2 = limpiarTexto(payload?.contactoSecundario?.correo);

    if (correo1) correos.push(correo1);
    if (correo2) correos.push(correo2);
  } else {
    const correo = limpiarTexto(payload?.identificacion?.correoViajante);
    if (correo) correos.push(correo);
  }

  return [...new Set(correos)].join(", ");
}

function mostrarPantallaFinal(payload) {
  form?.classList.add("hidden");
  pantallaBienvenida?.classList.add("hidden");
  msgBox?.classList.remove("hidden");

  const destinatarioTexto = obtenerDestinatariosPantallaFinal(payload);

  mostrarMensaje(
    "ok",
    `
      <h2 style="margin-top:0;">
        ${
          payload?.tipoInscripcion === "lista_espera"
            ? "🟡 Solicitud de lista de espera enviada"
            : payload?.tipoInscripcion === "nuevo_ingreso"
            ? "🟣 Solicitud de nuevo ingreso enviada"
            : payload?.tipoInscripcion === "nomina_final"
            ? "🩺 Nómina final enviada correctamente"
            : payload?.tipoInscripcion === "liberado"
            ? "🔵 Registro de cupo liberado enviado"
            : "✅ Inscripción enviada correctamente"
        }
      </h2>

      <p>
        🎉 Muchas gracias. Hemos recibido las respuestas de
        <strong>${escapeHtml(payload?.identificacion?.nombreCompleto || "la persona inscrita")}</strong>.
      </p>

      <p>
        📩 Se enviará un respaldo al correo
        <strong>${escapeHtml(destinatarioTexto || "indicado en el formulario")}</strong>.
      </p>

      <div class="notice time" style="margin-top:12px;">
        Si no lo recibes en unos minutos, revisa especialmente
        <strong>spam / correos no deseados</strong>.
      </div>

      <p>
        ✏️ Si necesitas corregir, actualizar o eliminar información, comunícate con
        Turismo Rai Trai Viajes de Estudio y asegúrate de recibir confirmación de tu solicitud.
      </p>

      <p>
        📧 Correo:
        <a href="mailto:administracion@raitrai.cl?subject=Sobre%20el%20formulario%20de%20registro">
          administracion@raitrai.cl
        </a><br>

        ☎️ Teléfono:
        <a href="tel:+56222363232">+56 2 2236 3232</a><br>

        💬 WhatsApp:
        <a href="https://wa.me/56998183857?text=Necesito%20ayuda%20con%20el%20formulario%20de%20registro" target="_blank" rel="noopener">
          +56 9 9818 3857
        </a>
      </p>
    `
  );

  window.scrollTo({ top: 0, behavior: "smooth" });
}

// -----------------------------------------------------------------------------
// LIMPIEZA
// -----------------------------------------------------------------------------
function onLimpiar() {
  form.reset();
  resetDefaults();
  ocultarMensaje();
  aplicarEstadoUI();
  actualizarProgreso();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function resetDefaults() {
  setPhoneDefault("telefonoViajante");
  setPhoneDefault("contactoPrincipalTelefono");
  setPhoneDefault("emergenciaTelefono");

  if ($("rutDv")) $("rutDv").value = "";
  $("rutNumero")?.classList.remove("input-error");
  $("rutDv")?.classList.remove("input-error");

  if (bloqueApoderado2) bloqueApoderado2.classList.add("hidden");
  if (btnAgregarApoderado2) btnAgregarApoderado2.classList.remove("hidden");

  if (bloqueEmergencia2) bloqueEmergencia2.classList.add("hidden");
  if (btnAgregarEmergencia2) btnAgregarEmergencia2.classList.remove("hidden");
}

// -----------------------------------------------------------------------------
// HELPERS UI
// -----------------------------------------------------------------------------
function enlazarFlagDetalle(nombreRadio, wrap, valoresActivos) {
  const radios = document.querySelectorAll(`input[name="${nombreRadio}"]`);

  radios.forEach((el) => {
    el.addEventListener("change", () => {
      const v = obtenerRadio(nombreRadio);
      mostrar(wrap, valoresActivos.includes(v));
      actualizarProgreso();
    });
  });
}

function mostrar(elemento, mostrarFlag) {
  if (!elemento) return;
  elemento.classList.toggle("hidden", !mostrarFlag);
}

function setRequired(id, required) {
  const el = $(id);
  if (!el) return;
  el.required = !!required;
}

function mostrarMensaje(tipo, html) {
  msgBox.classList.remove("hidden", "ok", "error", "time", "privacy");
  msgBox.classList.add(tipo === "ok" ? "ok" : "error");
  msgBox.innerHTML = html;
}

function ocultarMensaje() {
  msgBox.classList.add("hidden");
  msgBox.innerHTML = "";
}

function bloquearFormulario() {
  form?.querySelectorAll("input, select, textarea, button").forEach((el) => {
    el.disabled = true;
  });
}

function normalizarFaseInscripcion(value = "") {
  const key = limpiarTexto(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  if (key === "nuevos") return "nuevos";
  if (key === "lista_espera") return "lista_espera";
  if (key === "liberado") return "liberado";

  return "normal";
}

function grupoTieneFirmaVendedor(data = {}) {
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

function getContextoFormulario() {
  const tieneFirmaVendedor = grupoTieneFirmaVendedor(grupoData || {});

  if (faseUrl === "nuevos") {
    return {
      clave: "nuevo_ingreso",
      tipoInscripcion: "nuevo_ingreso",
      tipoInscripcionLabel: "Nuevo ingreso",
      estadoCupo: "confirmado"
    };
  }

  if (faseUrl === "lista_espera") {
    return {
      clave: "lista_espera",
      tipoInscripcion: "lista_espera",
      tipoInscripcionLabel: "Lista de espera",
      estadoCupo: "pendiente_confirmacion"
    };
  }

  if (faseUrl === "liberado") {
    return {
      clave: "liberado",
      tipoInscripcion: "liberado",
      tipoInscripcionLabel: "Cupo liberado",
      estadoCupo: "confirmado"
    };
  }

  if (tieneFirmaVendedor) {
    return {
      clave: "nomina_final",
      tipoInscripcion: "nomina_final",
      tipoInscripcionLabel: "Nómina final / ficha médica",
      estadoCupo: "confirmado"
    };
  }
  
  return {
    clave: "inscripcion_inicial",
    tipoInscripcion: "inscripcion_comercial",
    tipoInscripcionLabel: "Inscripción inicial",
    estadoCupo: "confirmado"
  };
}

function getTipoInscripcionActual() {
  return getContextoFormulario().tipoInscripcion;
}

function getEstadoCupoActual() {
  return getContextoFormulario().estadoCupo;
}

function getTipoInscripcionLabelPublico() {
  return getContextoFormulario().tipoInscripcionLabel;
}

function renderBannerFaseInscripcion() {
  const box = $("bannerFaseInscripcion");
  if (!box) return;

  const contexto = getContextoFormulario();

  const titulo = $("tituloFormularioPublico");
  const btn = $("btnComenzar");
  
  if (titulo) {
    titulo.textContent = contexto.tipoInscripcionLabel;
  }
  
  if (btn) {
    btn.textContent = `Comenzar ${contexto.tipoInscripcionLabel.toLowerCase()}`;
  }

  if (contexto.clave === "nuevo_ingreso") {
    box.className = "notice time";
    box.innerHTML = `
      <strong>Nuevo ingreso al grupo de viaje.</strong><br>
      Te estás incorporando al grupo después de la nómina inicial. La gestión de pagos y cuotas deberá ser confirmada con Administración, ya que podrían existir cuotas retroactivas o condiciones particulares según la fecha de incorporación.
    `;
  } else if (contexto.clave === "lista_espera") {
    box.className = "notice error";
    box.innerHTML = `
      <strong>Lista de espera.</strong><br><br>
    
      Estás ingresando a la lista de espera del grupo de viaje.
      El cupo aún NO se encuentra confirmado.
    
      <br><br>
    
      Para mantener activa esta solicitud, debes realizar el abono inicial
      indicado por Turismo Rai Trai Viajes de Estudio y enviar el comprobante
      correspondiente.
    
      <br><br>
    
      También debes tener disponible:
    
      <ul style="margin-top:8px;">
        <li>Cédula de identidad vigente por ambos lados</li>
        <li>Comprobante de pago</li>
      </ul>
    
      <hr style="margin:14px 0;">
    
      <strong>Datos de transferencia:</strong><br>
      Turismo Rai Trai Viajes de Estudio<br>
      Rut Empresa: 78.384.230-0<br>
      Banco: Banco de Chile<br>
      Cuenta Corriente N°: 033 98-07<br>
      Correo comprobantes: giras@raitrai.cl
    
      <br><br>
    
      El equipo de Administración confirmará posteriormente si el cupo
      puede ser asignado definitivamente.
    `;
  } else if (contexto.clave === "liberado") {
    box.className = "notice ok";
    box.innerHTML = `
      <strong>Cupo liberado.</strong><br>
      Estás ingresando al grupo mediante un cupo liberado. Completa la información solicitada para registrar correctamente la participación en el viaje.
    `;
  } else if (contexto.clave === "nomina_final") {
    box.className = "notice privacy";
    box.innerHTML = `
      <strong>Nómina final y ficha médica.</strong><br>
      Este formulario permitirá completar la nómina definitiva del viaje y registrar información médica, documental y operacional necesaria para la participación.
    `;
  } else {
    box.className = "notice privacy";
    box.innerHTML = `
      <strong>Inscripción inicial.</strong><br>
      Completa este formulario para registrar a la persona que participará en el viaje de estudio.
    `;
  }

  box.classList.remove("hidden");
}

// -----------------------------------------------------------------------------
// HELPERS DATOS
// -----------------------------------------------------------------------------
function bloqueTieneDatos(ids) {
  return ids.some((id) => limpiarTexto($(id)?.value));
}

function apoderado2Activo() {
  return bloqueApoderado2 && !bloqueApoderado2.classList.contains("hidden") &&
    bloqueTieneDatos([
      "contactoSecundarioNombre",
      "contactoSecundarioRelacion",
      "contactoSecundarioRelacionOtro",
      "contactoSecundarioTelefono",
      "contactoSecundarioCorreo"
    ]);
}

function emergencia2Activa() {
  return bloqueEmergencia2 && !bloqueEmergencia2.classList.contains("hidden") &&
    bloqueTieneDatos([
      "emergencia2Nombre",
      "emergencia2Relacion",
      "emergencia2RelacionOtro",
      "emergencia2Telefono"
    ]);
}

function obtenerRadio(name) {
  const checked = document.querySelector(`input[name="${name}"]:checked`);
  return checked ? checked.value : "";
}

function obtenerChecks(name) {
  return Array.from(document.querySelectorAll(`input[name="${name}"]:checked`)).map((el) => el.value);
}

function limpiarRadios(name) {
  document.querySelectorAll(`input[name="${name}"]`).forEach((el) => {
    el.checked = false;
  });
}

function limpiarTexto(valor) {
  return String(valor || "").trim();
}

function normalizarTexto(valor) {
  return limpiarTexto(valor)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function limpiarRutNumero(valor) {
  return String(valor || "").replace(/\D/g, "");
}

function calcularDvRut(cuerpo) {
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

function normalizarRutDocumento(numero, dv) {
  return `RUT_${limpiarRutNumero(numero)}-${limpiarTexto(dv).toUpperCase()}`;
}

function construirNombreKey(nombres, primerApellido, segundoApellido) {
  return [
    normalizarTexto(nombres),
    normalizarTexto(primerApellido),
    normalizarTexto(segundoApellido || "SIN_SEGUNDO_APELLIDO")
  ]
    .join("_")
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 160);
}

function validarCorreo(correo) {
  const v = limpiarTexto(correo);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function telefonoValido(valor) {
  const limpio = limpiarTexto(valor).replace(/[^\d+]/g, "");
  if (!limpio) return false;
  const soloDigitos = limpio.replace(/\D/g, "");
  return soloDigitos.length >= 8;
}

function bindPhoneInput(id) {
  const el = $(id);
  if (!el || el.dataset.phoneBound === "1") return;

  el.dataset.phoneBound = "1";

  el.addEventListener("focus", () => {
    if (!limpiarTexto(el.value)) {
      el.value = "+569";
    }
    actualizarHintWhatsapp(id);
  });

  el.addEventListener("input", () => {
    let raw = String(el.value || "");
    let clean = raw.replace(/[^\d+]/g, "");

    if (clean.includes("+")) {
      clean = clean[0] === "+"
        ? "+" + clean.slice(1).replace(/\+/g, "")
        : clean.replace(/\+/g, "");
    }

    if (clean.startsWith("+569")) {
      const resto = clean.slice(4).replace(/\D/g, "").slice(0, 8);
      clean = "+569" + resto;
    }

    el.value = clean;
    actualizarHintWhatsapp(id);
  });

  el.addEventListener("blur", () => actualizarHintWhatsapp(id));
}

function actualizarHintWhatsapp(id) {
  const el = $(id);
  const hint = $(`${id}WhatsappHint`);
  if (!el || !hint) return;

  const valor = limpiarTexto(el.value);
  const mostrarHint = valor && !valor.startsWith("+569");

  hint.classList.toggle("hidden", !mostrarHint);
}

function setPhoneDefault(id) {
  const el = $(id);
  if (el && !limpiarTexto(el.value)) {
    el.value = "+569";
  }
}

function calcularEdad(fechaIso) {
  if (!fechaIso) return 0;

  const nacimiento = new Date(`${fechaIso}T00:00:00`);
  if (Number.isNaN(nacimiento.getTime())) return 0;

  const hoy = new Date();

  let edad = hoy.getFullYear() - nacimiento.getFullYear();
  const m = hoy.getMonth() - nacimiento.getMonth();

  if (m < 0 || (m === 0 && hoy.getDate() < nacimiento.getDate())) {
    edad--;
  }

  return edad;
}

function normalizarCursoInput(value = "") {
  return limpiarTexto(value)
    .toUpperCase()
    .replace(/\s+/g, "");
}

function extraerNumeroCurso(value = "") {
  const match = normalizarCursoInput(value).match(/^(11|10|[1-9])/);
  return match ? Number(match[1]) : null;
}

function extraerLetrasCurso(value = "") {
  const match = normalizarCursoInput(value).match(/^(?:11|10|[1-9])(.*)$/);
  return match ? match[1] : "";
}

function siguienteCurso(numero) {
  if (numero >= 1 && numero <= 7) return numero + 1;
  if (numero === 8) return 1;
  if (numero === 9) return 10;
  if (numero === 10) return 11;
  if (numero === 11) return 11;
  return null;
}

function proyectarCursoPorAno(cursoBase = "", anoBase = "", anoDestino = "") {
  const curso = normalizarCursoInput(cursoBase);
  const numeroBase = extraerNumeroCurso(curso);
  const letras = extraerLetrasCurso(curso);

  const desde = Number(anoBase);
  const hasta = Number(anoDestino);

  if (!curso || numeroBase === null) return "";
  if (!Number.isFinite(desde) || !Number.isFinite(hasta)) return curso;
  if (hasta <= desde) return curso;

  let numero = numeroBase;
  const diferencia = hasta - desde;

  for (let i = 0; i < diferencia; i += 1) {
    const sig = siguienteCurso(numero);
    if (sig === null) return "";
    numero = sig;
  }

  return `${numero}${letras}`;
}

function obtenerAnoBaseCursoGrupo(data = {}) {
  const anoBase = Number(data.anoBaseCurso || data.anoRegistroCurso || "");

  if (Number.isFinite(anoBase) && anoBase > 0) {
    return anoBase;
  }

  const fechaCreacion = data.fechaCreacion;

  if (fechaCreacion?.toDate) {
    return fechaCreacion.toDate().getFullYear();
  }

  return new Date().getFullYear();
}

function obtenerCursoActualInscripcion(data = {}) {
  const cursoBase = limpiarTexto(data.curso || data.cursoBase || "");
  const anoBase = obtenerAnoBaseCursoGrupo(data);
  const anoViaje = Number(data.anoViaje || "");
  const anoHoy = new Date().getFullYear();

  const anoReferencia = Number.isFinite(anoViaje) && anoViaje > 0
    ? Math.min(anoHoy, anoViaje)
    : anoHoy;

  const cursoActual = proyectarCursoPorAno(cursoBase, anoBase, anoReferencia);

  if (!cursoActual) return cursoBase || "-";

  return `${cursoActual} (${anoReferencia})`;
}

function grupoEsInternacional() {
  const destinoPrincipal = normalizarTexto(grupoData?.destinoPrincipal || "");
  const destinoOtro = normalizarTexto(grupoData?.destinoPrincipalOtro || "");
  const destino = normalizarTexto(grupoData?.destino || "");
  const programa = normalizarTexto(grupoData?.programa || "");

  const universo = `${destinoPrincipal} ${destinoOtro} ${destino} ${programa}`.trim();

  if (!universo) return false;

  if (universo.includes("bariloche")) return true;
  if (universo.includes("brasil")) return true;
  if (universo.includes("mexico")) return true;
  if (universo.includes("republica dominicana")) return true;
  if (universo.includes("argentina")) return true;
  if (universo.includes("internacional")) return true;

  if (universo.includes("sur de chile y bariloche")) return true;
  if (universo.includes("bariloche y sur de chile")) return true;
  if (universo.includes("pucon y bariloche")) return true;

  if (universo.includes("sur de chile")) return false;
  if (universo.includes("norte de chile")) return false;

  return false;
}

function normalizarNumeroGrupo(valor) {
  const n = Number(String(valor || "").replace(/[^\d]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function labelTipoViajante(tipo) {
  if (tipo === "estudiante") return "estudiante";
  if (tipo === "profesor") return "profesor";
  if (tipo === "adulto_acompanante") return "adulto acompañante";
  return "viajante";
}

function agregarAlergiaAlimentaria() {
  const bloque2 = $("alergiaAlimentaria2Wrap");
  const bloque3 = $("alergiaAlimentaria3Wrap");

  if (bloque2?.classList.contains("hidden")) {
    bloque2.classList.remove("hidden");
    actualizarProgreso();
    return;
  }

  if (bloque3?.classList.contains("hidden")) {
    bloque3.classList.remove("hidden");
    $("btnAgregarAlergiaAlimentaria")?.classList.add("hidden");
    actualizarProgreso();
    return;
  }
}

function obtenerAlergiasAlimentarias() {
  const alergias = [];

  [1, 2, 3].forEach((n) => {
    const wrap = n === 1 ? $("alergiasAlimentariasWrap") : $(`alergiaAlimentaria${n}Wrap`);
    if (!wrap || wrap.classList.contains("hidden")) return;

    const alimento = limpiarTexto($(`alergiaAlimentaria${n}Alimento`)?.value);
    const reaccion = limpiarTexto($(`alergiaAlimentaria${n}Reaccion`)?.value);
    const nivelRiesgo = $(`alergiaAlimentaria${n}Riesgo`)?.value || "";
    const protocoloFlag = obtenerRadio(`alergiaAlimentaria${n}ProtocoloFlag`);
    const protocolo = limpiarTexto($(`alergiaAlimentaria${n}Protocolo`)?.value);
    const indicaciones = limpiarTexto($(`alergiaAlimentaria${n}Indicaciones`)?.value);

    if (!alimento && !reaccion && !nivelRiesgo && !protocolo && !indicaciones) return;

    alergias.push({
      alimento,
      reaccion,
      nivelRiesgo,
      protocoloFlag,
      protocolo,
      indicaciones
    });
  });

  return alergias;
}

function limpiarPayloadFirestore(value) {
  if (value === undefined) return "";
  if (value === null) return null;

  if (Array.isArray(value)) {
    return value
      .map((item) => limpiarPayloadFirestore(item))
      .filter((item) => item !== undefined);
  }

  if (typeof value === "object") {
    const limpio = {};

    Object.entries(value).forEach(([key, val]) => {
      const valorLimpio = limpiarPayloadFirestore(val);
      if (valorLimpio !== undefined) {
        limpio[key] = valorLimpio;
      }
    });

    return limpio;
  }

  return value;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
