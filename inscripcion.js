// inscripcion.js
// -----------------------------------------------------------------------------
// Página pública de inscripción de pasajero para un grupo de viaje.
// Guarda en:
// ventas_cotizaciones/{idGrupo}/inscripciones/{documentoNormalizado}
//
// Casos permitidos:
// - RUT chileno (número + DV automático)
// - Pasaporte
// -----------------------------------------------------------------------------

import { db } from "./firebase-init.js";

import {
  doc,
  getDoc,
  serverTimestamp,
  runTransaction,
  collection,
  addDoc
} from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";

// -----------------------------------------------------------------------------
// REFERENCIAS DOM
// -----------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);

const form = $("formInscripcion");
const msgBox = $("msgBox");
const btnEnviar = $("btnEnviar");
const btnLimpiar = $("btnLimpiar");

const chipGrupo = $("chipGrupo");
const chipColegio = $("chipColegio");
const chipCurso = $("chipCurso");
const chipDestino = $("chipDestino");
const chipAno = $("chipAno");

const adultoRolWrap = $("adultoRolWrap");
const adultoCompromisoCard = $("adultoCompromisoCard");
const adultoCargoWrap = $("adultoCargoWrap");
const cursoWrap = $("cursoWrap");

const rutWrap = $("rutWrap");
const dvWrap = $("dvWrap");
const pasaporteWrap = $("pasaporteWrap");

const nacionalidadDetalleWrap = $("nacionalidadDetalleWrap");

const contactoPrincipalRelacionOtroWrap = $("contactoPrincipalRelacionOtroWrap");
const previsionIsapreWrap = $("previsionIsapreWrap");
const previsionOtraWrap = $("previsionOtraWrap");

const contactoPrincipalWhatsappAlternativoWrap = $("contactoPrincipalWhatsappAlternativoWrap");
const emergenciaRelacionOtroWrap = $("emergenciaRelacionOtroWrap");
const emergenciaWhatsappAlternativoWrap = $("emergenciaWhatsappAlternativoWrap");

const bloqueInternacional = $("bloqueInternacional");
const docsInternacionalesDetalleWrap = $("docsInternacionalesDetalleWrap");
const permisoMenorWrap = $("permisoMenorWrap");
const situacionLegalWrap = $("situacionLegalWrap");
const situacionLegalDetalleWrap = $("situacionLegalDetalleWrap");

const saludGeneralDetalleWrap = $("saludGeneralDetalleWrap");
const enfermedadBaseDetalleWrap = $("enfermedadBaseDetalleWrap");
const saludMentalDetalleWrap = $("saludMentalDetalleWrap");
const apoyosEspecialesDetalleWrap = $("apoyosEspecialesDetalleWrap");

const medicamentosWrap = $("medicamentosWrap");
const medicamentosProhibidosDetalleWrap = $("medicamentosProhibidosDetalleWrap");
const alergiasWrap = $("alergiasWrap");
const dietaWrap = $("dietaWrap");
const otrosAntecedentesDetalleWrap = $("otrosAntecedentesDetalleWrap");
const privadoExclusivoDetalleWrap = $("privadoExclusivoDetalleWrap");

// -----------------------------------------------------------------------------
// ESTADO
// -----------------------------------------------------------------------------
let grupoData = null;
let idGrupo = "";
let tokenUrl = "";
let correoCambios = "operaciones@raitrai.cl";

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

  if (!idGrupo) {
    mostrarMensaje("error", "Falta el identificador del grupo en el enlace.");
    bloquearFormulario();
    return;
  }

  await cargarGrupo();
  conectarEventos();
  aplicarEstadoUI();
}

async function cargarGrupo() {
  const ref = doc(db, "ventas_cotizaciones", idGrupo);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    mostrarMensaje("error", "El grupo indicado no existe.");
    bloquearFormulario();
    return;
  }

  grupoData = { id: snap.id, ...snap.data() };

  const inscripcionHabilitada = !!grupoData.inscripcionHabilitada;
  const tokenGrupo = limpiarTexto(grupoData.tokenInscripcion);
  correoCambios = limpiarTexto(grupoData.correoCambiosInscripcion) || "operaciones@raitrai.cl";

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

  chipGrupo.textContent =
    limpiarTexto(grupoData.aliasGrupo) ||
    limpiarTexto(grupoData.nombreGrupo) ||
    limpiarTexto(grupoData.idGrupo) ||
    idGrupo;

  chipColegio.textContent = limpiarTexto(grupoData.colegio) || "-";
  chipCurso.textContent = limpiarTexto(grupoData.curso) || "-";
  chipDestino.textContent =
    limpiarTexto(grupoData.destinoPrincipal) ||
    limpiarTexto(grupoData.destino) ||
    "-";

  chipAno.textContent = String(grupoData.anoViaje || "-");

  const cursoViajante = $("cursoViajante");
  if (cursoViajante && grupoData.curso) {
    cursoViajante.value = String(grupoData.curso);
  }
}

// -----------------------------------------------------------------------------
// EVENTOS
// -----------------------------------------------------------------------------
function conectarEventos() {
  form.addEventListener("submit", onSubmit);
  btnLimpiar.addEventListener("click", onLimpiar);

  document.querySelectorAll('input[name="tipoViajante"]').forEach((el) => {
    el.addEventListener("change", aplicarEstadoUI);
  });

  document.querySelectorAll('input[name="rolAdulto"]').forEach((el) => {
    el.addEventListener("change", aplicarEstadoUI);
  });

  $("tipoIdentificacion").addEventListener("change", aplicarEstadoUI);
  $("nacionalidadBase").addEventListener("change", aplicarEstadoUI);
  $("fechaNacimiento").addEventListener("change", aplicarEstadoUI);

  $("contactoPrincipalRelacion").addEventListener("change", aplicarEstadoUI);
  $("previsionTipo").addEventListener("change", aplicarEstadoUI);
  $("emergenciaRelacion").addEventListener("change", aplicarEstadoUI);

  $("contactoPrincipalEsWhatsapp").addEventListener("change", aplicarEstadoUI);
  $("emergenciaEsWhatsapp").addEventListener("change", aplicarEstadoUI);

  enlazarFlagDetalle("saludGeneralFlag", saludGeneralDetalleWrap, ["si", "privado"]);
  enlazarFlagDetalle("enfermedadBaseFlag", enfermedadBaseDetalleWrap, ["si"]);
  enlazarFlagDetalle("saludMentalFlag", saludMentalDetalleWrap, ["si", "privado"]);
  enlazarFlagDetalle("apoyosEspecialesFlag", apoyosEspecialesDetalleWrap, ["si", "privado"]);

  enlazarFlagDetalle("medicamentosFlag", medicamentosWrap, ["si"]);
  enlazarFlagDetalle("medicamentosProhibidosFlag", medicamentosProhibidosDetalleWrap, ["si"]);
  enlazarFlagDetalle("alergiasFlag", alergiasWrap, ["si"]);
  enlazarFlagDetalle("dietaFlag", dietaWrap, ["si"]);
  enlazarFlagDetalle("otrosAntecedentesFlag", otrosAntecedentesDetalleWrap, ["si", "privado"]);
  enlazarFlagDetalle("privadoExclusivoFlag", privadoExclusivoDetalleWrap, ["si"]);
  enlazarFlagDetalle("conoceDocsInternacionales", docsInternacionalesDetalleWrap, ["no", "parcial"]);
  enlazarFlagDetalle("situacionLegalAfecta", situacionLegalDetalleWrap, ["si", "privado"]);

  $("rutNumero").addEventListener("input", () => {
    const soloDigitos = String($("rutNumero").value || "").replace(/\D/g, "").slice(0, 8);
    $("rutNumero").value = soloDigitos;
    $("rutDv").value = soloDigitos ? calcularDvRut(soloDigitos) : "";
  });

  [
    "contactoPrincipalTelefono",
    "contactoPrincipalWhatsappAlternativo",
    "emergenciaTelefono",
    "emergenciaWhatsappAlternativo"
  ].forEach(bindPhoneInput);

  if (!$("contactoPrincipalTelefono").value) $("contactoPrincipalTelefono").value = "+569";
  if (!$("emergenciaTelefono").value) $("emergenciaTelefono").value = "+569";
}

// -----------------------------------------------------------------------------
// UI
// -----------------------------------------------------------------------------
function aplicarEstadoUI() {
  const tipoViajante = obtenerRadio("tipoViajante");
  const tipoIdentificacion = $("tipoIdentificacion").value;
  const nacionalidadBase = $("nacionalidadBase").value;
  const esInternacional = grupoEsInternacional();
  const esMenor = calcularEdad($("fechaNacimiento").value) < 18;
  const esAdulto = tipoViajante === "adulto";

  mostrar(adultoRolWrap, esAdulto);
  mostrar(adultoCompromisoCard, esAdulto);
  mostrar(adultoCargoWrap, esAdulto);
  mostrar(cursoWrap, !esAdulto);

  $("cursoViajante").required = false;
  $("cursoViajante").readOnly = true;

  const mostrarRut = tipoIdentificacion === "rut";
  const mostrarPasaporte = tipoIdentificacion === "pasaporte";

  mostrar(rutWrap, mostrarRut);
  mostrar(dvWrap, mostrarRut);
  mostrar(pasaporteWrap, mostrarPasaporte);

  const mostrarNacionalidadDetalle =
    nacionalidadBase === "otra" || nacionalidadBase === "doble";
  mostrar(nacionalidadDetalleWrap, mostrarNacionalidadDetalle);
  $("nacionalidadDetalle").required = mostrarNacionalidadDetalle;

  const relacionOtro = $("contactoPrincipalRelacion").value === "otro";
  mostrar(contactoPrincipalRelacionOtroWrap, relacionOtro);
  $("contactoPrincipalRelacionOtro").required = relacionOtro;

  const prevision = $("previsionTipo").value;
  const mostrarIsapre = prevision === "isapre";
  const mostrarPrevisionOtra = prevision === "otra";
  mostrar(previsionIsapreWrap, mostrarIsapre);
  mostrar(previsionOtraWrap, mostrarPrevisionOtra);
  $("previsionIsapre").required = mostrarIsapre;
  $("previsionOtra").required = mostrarPrevisionOtra;

  const emergenciaOtro = $("emergenciaRelacion").value === "otro";
  mostrar(emergenciaRelacionOtroWrap, emergenciaOtro);
  $("emergenciaRelacionOtro").required = emergenciaOtro;

  const contactoEsWhatsapp = $("contactoPrincipalEsWhatsapp").checked;
  mostrar(contactoPrincipalWhatsappAlternativoWrap, !contactoEsWhatsapp);
  $("contactoPrincipalWhatsappAlternativo").required = !contactoEsWhatsapp;

  const emergenciaEsWhatsapp = $("emergenciaEsWhatsapp").checked;
  mostrar(emergenciaWhatsappAlternativoWrap, !emergenciaEsWhatsapp);
  $("emergenciaWhatsappAlternativo").required = !emergenciaEsWhatsapp;

  mostrar(bloqueInternacional, esInternacional);

  const mostrarDocsNoChile = esInternacional && mostrarNacionalidadDetalle;
  const docsNoChileWrap = $("docsNoChileWrap");
  mostrar(docsNoChileWrap, mostrarDocsNoChile);

  if (!mostrarDocsNoChile) {
    limpiarRadios("conoceDocsInternacionales");
    $("docsInternacionalesDetalle").value = "";
    mostrar(docsInternacionalesDetalleWrap, false);
  }

  const mostrarPermisoMenor = !esAdulto && esInternacional && esMenor;
  mostrar(permisoMenorWrap, mostrarPermisoMenor);
  mostrar(situacionLegalWrap, mostrarPermisoMenor);

  if (!mostrarPermisoMenor) {
    limpiarRadios("permisoMenorViaje");
    limpiarRadios("situacionLegalAfecta");
    $("situacionLegalDetalle").value = "";
    mostrar(situacionLegalDetalleWrap, false);
  }

  document.querySelectorAll('input[name="rolAdulto"]').forEach((r) => {
    r.required = esAdulto;
  });

  $("adultoAceptaCompromiso").required = esAdulto;
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
    return;
  }

  btnEnviar.disabled = true;
  btnEnviar.textContent = "Enviando inscripción...";

  try {
    const payload = construirPayload();
    const documentoNormalizado = payload.identificacion.documentoNormalizado;

    const refInscripcion = doc(
      db,
      "ventas_cotizaciones",
      idGrupo,
      "inscripciones",
      documentoNormalizado
    );

    await runTransaction(db, async (tx) => {
      const existente = await tx.get(refInscripcion);
      if (existente.exists()) {
        throw new Error("duplicate_document");
      }
      tx.set(refInscripcion, payload);
    });

    await crearCorreoConfirmacion(payload);
    await registrarEventoGrupo(payload);

    mostrarMensaje(
      "ok",
      `Inscripción enviada correctamente. También se registró una solicitud de correo de confirmación a <strong>${escapeHtml(payload.contactoPrincipal.correo)}</strong>.`
    );

    form.reset();

    if ($("cursoViajante") && grupoData?.curso) {
      $("cursoViajante").value = String(grupoData.curso);
    }

    $("contactoPrincipalTelefono").value = "+569";
    $("emergenciaTelefono").value = "+569";

    ocultarMensaje();
    mostrarMensaje("ok", "Inscripción enviada correctamente.");
    aplicarEstadoUI();
    window.scrollTo({ top: 0, behavior: "smooth" });

  } catch (error) {
    console.error(error);

    if (error.message === "duplicate_document") {
      mostrarMensaje(
        "error",
        `Ya existe una inscripción para este documento dentro del grupo. Si necesita corregir información, debe solicitarlo por correo a <strong>${escapeHtml(correoCambios)}</strong>.`
      );
    } else {
      mostrarMensaje(
        "error",
        `No fue posible enviar la inscripción. Intente nuevamente. Si el problema continúa, escriba a <strong>${escapeHtml(correoCambios)}</strong>.`
      );
    }
  } finally {
    btnEnviar.disabled = false;
    btnEnviar.textContent = "Enviar inscripción";
  }
}

// -----------------------------------------------------------------------------
// VALIDACIONES
// -----------------------------------------------------------------------------
function validarFormulario() {
  const errores = [];

  const tipoViajante = obtenerRadio("tipoViajante");
  const esAdulto = tipoViajante === "adulto";
  const esInternacional = grupoEsInternacional();
  const edad = calcularEdad($("fechaNacimiento").value);
  const esMenor = edad < 18;
  const tipoIdentificacion = $("tipoIdentificacion").value;

  if (!tipoViajante) {
    errores.push("Debe indicar si el viajante es estudiante o adulto acompañante.");
  }

  if (esAdulto && !obtenerRadio("rolAdulto")) {
    errores.push("Debe indicar el rol del adulto acompañante.");
  }

  if (!limpiarTexto($("nombreCompleto").value)) {
    errores.push("Debe ingresar el nombre completo del viajante.");
  }

  if (!tipoIdentificacion) {
    errores.push("Debe seleccionar el tipo de identificación.");
  }

  if (tipoIdentificacion === "rut") {
    const rutNumero = limpiarRutNumero($("rutNumero").value);
    const dv = limpiarTexto($("rutDv").value).toUpperCase();

    if (!/^\d{7,8}$/.test(rutNumero)) {
      errores.push("Debe ingresar un número de RUT válido, de 7 u 8 dígitos.");
    } else {
      const esperado = calcularDvRut(rutNumero);
      if (!dv || dv !== esperado) {
        errores.push("El RUT no es válido.");
      }
    }
  }

  if (tipoIdentificacion === "pasaporte") {
    if (!limpiarTexto($("pasaporteNumero").value)) {
      errores.push("Debe ingresar el número de pasaporte.");
    }
    if (!limpiarTexto($("pasaportePais").value)) {
      errores.push("Debe indicar el país emisor del pasaporte.");
    }
    if (!$("pasaporteTipo").value) {
      errores.push("Debe indicar el tipo de pasaporte.");
    }
  }

  if (!$("fechaNacimiento").value) {
    errores.push("Debe ingresar la fecha de nacimiento.");
  }

  if (!$("nacionalidadBase").value) {
    errores.push("Debe indicar la nacionalidad.");
  }

  if (["otra", "doble"].includes($("nacionalidadBase").value) && !limpiarTexto($("nacionalidadDetalle").value)) {
    errores.push("Debe especificar la nacionalidad indicada.");
  }

  if (!limpiarTexto($("direccion").value)) {
    errores.push("Debe ingresar la dirección.");
  }

  if (!limpiarTexto($("comuna").value)) {
    errores.push("Debe ingresar la comuna.");
  }

  if (!limpiarTexto($("contactoPrincipalNombre").value)) {
    errores.push("Debe ingresar el nombre del contacto principal.");
  }

  if (!$("contactoPrincipalRelacion").value) {
    errores.push("Debe indicar la relación del contacto principal con el viajante.");
  }

  if ($("contactoPrincipalRelacion").value === "otro" && !limpiarTexto($("contactoPrincipalRelacionOtro").value)) {
    errores.push("Debe especificar la relación del contacto principal.");
  }

  if (!telefonoValido($("contactoPrincipalTelefono").value)) {
    errores.push("Debe ingresar un teléfono principal válido.");
  }

  if (!$("contactoPrincipalEsWhatsapp").checked && !telefonoValido($("contactoPrincipalWhatsappAlternativo").value)) {
    errores.push("Debe ingresar un número válido para WhatsApp del contacto principal.");
  }

  if (!validarCorreo($("contactoPrincipalCorreo").value)) {
    errores.push("Debe ingresar un correo válido para el contacto principal.");
  }

  if (!$("previsionTipo").value) {
    errores.push("Debe indicar la previsión.");
  }

  if ($("previsionTipo").value === "isapre" && !limpiarTexto($("previsionIsapre").value)) {
    errores.push("Debe indicar qué Isapre tiene.");
  }

  if ($("previsionTipo").value === "otra" && !limpiarTexto($("previsionOtra").value)) {
    errores.push("Debe especificar la otra previsión.");
  }

  if (!limpiarTexto($("emergenciaNombre").value)) {
    errores.push("Debe ingresar el nombre del contacto de emergencia.");
  }

  if (!$("emergenciaRelacion").value) {
    errores.push("Debe indicar la relación del contacto de emergencia.");
  }

  if ($("emergenciaRelacion").value === "otro" && !limpiarTexto($("emergenciaRelacionOtro").value)) {
    errores.push("Debe especificar la relación del contacto de emergencia.");
  }

  if (!telefonoValido($("emergenciaTelefono").value)) {
    errores.push("Debe ingresar un teléfono válido para el contacto de emergencia.");
  }

  if (!$("emergenciaEsWhatsapp").checked && !telefonoValido($("emergenciaWhatsappAlternativo").value)) {
    errores.push("Debe ingresar un número válido para WhatsApp del contacto de emergencia.");
  }

  if (esInternacional && ["otra", "doble"].includes($("nacionalidadBase").value)) {
    if (!obtenerRadio("conoceDocsInternacionales")) {
      errores.push("Debe indicar si conoce los documentos requeridos para ingreso internacional.");
    }
  }

  if (esInternacional && !esAdulto && esMenor) {
    if (!obtenerRadio("permisoMenorViaje")) {
      errores.push("Debe indicar la situación de autorizaciones del menor para salida del país.");
    }
    if (!obtenerRadio("situacionLegalAfecta")) {
      errores.push("Debe indicar si existe alguna situación familiar o legal que pueda afectar el proceso.");
    }
  }

  if (obtenerRadio("medicamentosFlag") === "si") {
    if (!limpiarTexto($("medicamentosDetalle").value)) {
      errores.push("Debe detallar los medicamentos de uso regular.");
    }
    if (!obtenerRadio("medicamentosGestion")) {
      errores.push("Debe indicar cómo se gestionan los medicamentos durante el viaje.");
    }
  }

  if (esAdulto && !$("adultoAceptaCompromiso").checked) {
    errores.push("El adulto acompañante debe aceptar la carta compromiso.");
  }

  if (!$("aceptaVeracidad").checked) {
    errores.push("Debe aceptar la declaración de veracidad.");
  }

  if (!$("aceptaUsoInterno").checked) {
    errores.push("Debe autorizar el uso interno de la información.");
  }

  if (!$("aceptaCambiosCorreo").checked) {
    errores.push("Debe aceptar la condición de corrección posterior por correo.");
  }

  return errores;
}

// -----------------------------------------------------------------------------
// CONSTRUCCIÓN PAYLOAD
// -----------------------------------------------------------------------------
function construirPayload() {
  const tipoViajante = obtenerRadio("tipoViajante");
  const esAdulto = tipoViajante === "adulto";
  const nombreCompleto = limpiarTexto($("nombreCompleto").value);
  const fechaNacimiento = $("fechaNacimiento").value || null;
  const edad = calcularEdad(fechaNacimiento);
  const esMenor = edad < 18;
  const esInternacional = grupoEsInternacional();

  const tipoIdentificacion = $("tipoIdentificacion").value;
  const rutNumero = limpiarRutNumero($("rutNumero").value);
  const rutDv = limpiarTexto($("rutDv").value).toUpperCase();
  const rutCompleto = rutNumero && rutDv ? `${rutNumero}${rutDv}` : "";

  const pasaporteNumero = limpiarTexto($("pasaporteNumero").value);
  const pasaportePais = limpiarTexto($("pasaportePais").value);
  const pasaporteTipo = $("pasaporteTipo").value || "";

  let documento = "";
  let documentoNormalizado = "";
  let identificacion = {};

  if (tipoIdentificacion === "rut") {
    documento = rutCompleto;
    documentoNormalizado = rutCompleto;

    identificacion = {
      tipoIdentificacion,
      documento,
      documentoNormalizado,
      rut: rutCompleto,
      rutNumero,
      rutDv,
      pasaporteNumero: "",
      pasaportePais: "",
      pasaporteTipo: ""
    };
  } else {
    documento = pasaporteNumero;
    documentoNormalizado = normalizarDocumentoPasaporte(pasaportePais, pasaporteNumero);

    identificacion = {
      tipoIdentificacion,
      documento,
      documentoNormalizado,
      rut: "",
      rutNumero: "",
      rutDv: "",
      pasaporteNumero,
      pasaportePais,
      pasaporteTipo
    };
  }

  const nacionalidadBase = $("nacionalidadBase").value || "";
  const nacionalidadDetalle = limpiarTexto($("nacionalidadDetalle").value);

  const contactoPrincipalRelacion = $("contactoPrincipalRelacion").value || "";
  const contactoPrincipalRelacionOtro = limpiarTexto($("contactoPrincipalRelacionOtro").value);
  const contactoPrincipalRelacionFinal =
    contactoPrincipalRelacion === "otro" ? contactoPrincipalRelacionOtro : contactoPrincipalRelacion;

  const previsionTipo = $("previsionTipo").value || "";
  const previsionIsapre = limpiarTexto($("previsionIsapre").value);
  const previsionOtra = limpiarTexto($("previsionOtra").value);

  const emergenciaRelacion = $("emergenciaRelacion").value || "";
  const emergenciaRelacionOtro = limpiarTexto($("emergenciaRelacionOtro").value);
  const emergenciaRelacionFinal =
    emergenciaRelacion === "otro" ? emergenciaRelacionOtro : emergenciaRelacion;

  const payload = {
    tipoRegistro: "inscripcion_pasajero",
    tipoViajante,
    rolAdulto: esAdulto ? (obtenerRadio("rolAdulto") || "") : "",
    esAdulto,
    esMenor,

    grupo: {
      idGrupo,
      aliasGrupo: limpiarTexto(grupoData?.aliasGrupo),
      nombreGrupo: limpiarTexto(grupoData?.nombreGrupo),
      colegio: limpiarTexto(grupoData?.colegio),
      cursoBase: limpiarTexto(grupoData?.curso),
      anoViaje: grupoData?.anoViaje ?? null,
      destinoPrincipal: limpiarTexto(grupoData?.destinoPrincipal || grupoData?.destino),
      internacional: esInternacional
    },

    identificacion: {
      ...identificacion,
      nombreCompleto,
      fechaNacimiento,
      edad,
      nacionalidadBase,
      nacionalidadDetalle,
      direccion: limpiarTexto($("direccion").value),
      comuna: limpiarTexto($("comuna").value),
      curso: esAdulto ? "" : limpiarTexto($("cursoViajante").value),
      cargoAdulto: esAdulto ? limpiarTexto($("cargoAdulto").value) : ""
    },

    contactoPrincipal: {
      nombre: limpiarTexto($("contactoPrincipalNombre").value),
      relacion: contactoPrincipalRelacionFinal,
      relacionBase: contactoPrincipalRelacion,
      telefono: limpiarTexto($("contactoPrincipalTelefono").value),
      esWhatsapp: !!$("contactoPrincipalEsWhatsapp").checked,
      whatsappAlternativo: !$("contactoPrincipalEsWhatsapp").checked
        ? limpiarTexto($("contactoPrincipalWhatsappAlternativo").value)
        : "",
      correo: limpiarTexto($("contactoPrincipalCorreo").value),
      previsionTipo,
      previsionIsapre,
      previsionOtra
    },

    emergencia: {
      nombre: limpiarTexto($("emergenciaNombre").value),
      relacion: emergenciaRelacionFinal,
      relacionBase: emergenciaRelacion,
      telefono: limpiarTexto($("emergenciaTelefono").value),
      esWhatsapp: !!$("emergenciaEsWhatsapp").checked,
      whatsappAlternativo: !$("emergenciaEsWhatsapp").checked
        ? limpiarTexto($("emergenciaWhatsappAlternativo").value)
        : ""
    },

    documentacion: {
      aplicaInternacional: esInternacional,
      conoceDocsInternacionales: esInternacional ? (obtenerRadio("conoceDocsInternacionales") || "") : "",
      docsInternacionalesDetalle: limpiarTexto($("docsInternacionalesDetalle")?.value),
      permisoMenorViaje: (esInternacional && !esAdulto && esMenor) ? (obtenerRadio("permisoMenorViaje") || "") : "",
      situacionLegalAfecta: (esInternacional && !esAdulto && esMenor) ? (obtenerRadio("situacionLegalAfecta") || "") : "",
      situacionLegalDetalle: limpiarTexto($("situacionLegalDetalle")?.value)
    },

    salud: {
      saludGeneralFlag: obtenerRadio("saludGeneralFlag") || "",
      saludGeneralDetalle: limpiarTexto($("saludGeneralDetalle").value),

      enfermedadBaseFlag: obtenerRadio("enfermedadBaseFlag") || "",
      enfermedadBaseDetalle: limpiarTexto($("enfermedadBaseDetalle").value),

      saludMentalFlag: obtenerRadio("saludMentalFlag") || "",
      saludMentalDetalle: limpiarTexto($("saludMentalDetalle").value),

      apoyosEspecialesFlag: obtenerRadio("apoyosEspecialesFlag") || "",
      apoyosEspecialesDetalle: limpiarTexto($("apoyosEspecialesDetalle").value),

      grupoSanguineo: limpiarTexto($("grupoSanguineo").value),

      medicamentosFlag: obtenerRadio("medicamentosFlag") || "",
      medicamentosDetalle: limpiarTexto($("medicamentosDetalle").value),
      medicamentosGestion: obtenerRadio("medicamentosGestion") || "",
      medicamentosInstrucciones: limpiarTexto($("medicamentosInstrucciones").value),

      medicamentosProhibidosFlag: obtenerRadio("medicamentosProhibidosFlag") || "",
      medicamentosProhibidosDetalle: limpiarTexto($("medicamentosProhibidosDetalle").value),

      alergiasFlag: obtenerRadio("alergiasFlag") || "",
      alergiaTipos: obtenerChecks("alergiaTipo"),
      alergiasDetalle: limpiarTexto($("alergiasDetalle").value),

      dietaFlag: obtenerRadio("dietaFlag") || "",
      dietaTipos: obtenerChecks("dietaTipo"),
      dietaDetalle: limpiarTexto($("dietaDetalle").value),

      otrosAntecedentesFlag: obtenerRadio("otrosAntecedentesFlag") || "",
      otrosAntecedentesDetalle: limpiarTexto($("otrosAntecedentesDetalle").value),

      privadoExclusivoFlag: obtenerRadio("privadoExclusivoFlag") || "",
      privadoExclusivoDetalle: limpiarTexto($("privadoExclusivoDetalle").value)
    },

    adultoCompromiso: {
      aplica: esAdulto,
      aceptaCompromiso: esAdulto ? !!$("adultoAceptaCompromiso").checked : false,
      observaciones: limpiarTexto($("adultoObservacionesCompromiso").value)
    },

    consentimiento: {
      aceptaVeracidad: !!$("aceptaVeracidad").checked,
      aceptaUsoInterno: !!$("aceptaUsoInterno").checked,
      aceptaCambiosCorreo: !!$("aceptaCambiosCorreo").checked,
      correoCambios
    },

    meta: {
      fechaInscripcion: serverTimestamp(),
      canal: "formulario_publico",
      versionFormulario: 2,
      creadoDesde: window.location.href,
      estado: "inscrito"
    }
  };

  return payload;
}

// -----------------------------------------------------------------------------
// CORREO DE CONFIRMACIÓN
// -----------------------------------------------------------------------------
async function crearCorreoConfirmacion(payload) {
  const destinatario = payload.contactoPrincipal?.correo;
  if (!destinatario) return;

  const esAdulto = !!payload.esAdulto;
  const nombre = payload.identificacion?.nombreCompleto || "";
  const destino = payload.grupo?.destinoPrincipal || "";
  const aliasGrupo = payload.grupo?.aliasGrupo || payload.grupo?.nombreGrupo || payload.grupo?.idGrupo || idGrupo;
  const tipoLabel = esAdulto ? "adulto acompañante" : "estudiante";
  const documento = payload.identificacion?.documento || "";

  const html = `
    <div style="font-family: Arial, Helvetica, sans-serif; color:#222; line-height:1.6;">
      <h2 style="margin-bottom:8px;">Confirmación de inscripción recibida</h2>
      <p>Hemos recibido correctamente la inscripción de <strong>${escapeHtml(nombre)}</strong> como <strong>${escapeHtml(tipoLabel)}</strong>.</p>

      <p><strong>Grupo:</strong> ${escapeHtml(aliasGrupo)}<br>
      <strong>Destino:</strong> ${escapeHtml(destino)}<br>
      <strong>Documento:</strong> ${escapeHtml(documento)}</p>

      <p>La información entregada será utilizada exclusivamente para la planificación y operación segura del viaje.</p>

      <p>Si necesita corregir algún dato posteriormente, especialmente de salud, medicamentos, alimentación o documentación, debe solicitarlo por correo a <strong>${escapeHtml(correoCambios)}</strong>.</p>

      <p>Atentamente,<br>Turismo Rai Trai</p>
    </div>
  `;

  await addDoc(collection(db, "mail"), {
    to: [destinatario],
    message: {
      subject: `Confirmación de inscripción – ${nombre}`,
      html
    },
    meta: {
      tipo: "confirmacion_inscripcion_pasajero",
      idGrupo,
      documentoNormalizado: payload.identificacion?.documentoNormalizado || "",
      creadoEn: serverTimestamp()
    }
  });
}

// -----------------------------------------------------------------------------
// EVENTO SIMPLE EN EL GRUPO
// -----------------------------------------------------------------------------
async function registrarEventoGrupo(payload) {
  try {
    await addDoc(collection(db, "ventas_cotizaciones", idGrupo, "historial_inscripciones"), {
      fecha: serverTimestamp(),
      tipo: "inscripcion_publica",
      documentoNormalizado: payload.identificacion?.documentoNormalizado || "",
      documento: payload.identificacion?.documento || "",
      nombreCompleto: payload.identificacion?.nombreCompleto || "",
      tipoViajante: payload.tipoViajante || "",
      rolAdulto: payload.rolAdulto || "",
      mensaje: `Nueva inscripción recibida para ${payload.identificacion?.nombreCompleto || "viajante"}.`
    });
  } catch (error) {
    console.warn("No se pudo registrar historial_inscripciones:", error);
  }
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
    });
  });
}

function mostrar(elemento, mostrarFlag) {
  if (!elemento) return;
  elemento.classList.toggle("hidden", !mostrarFlag);
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

// -----------------------------------------------------------------------------
// LIMPIEZA
// -----------------------------------------------------------------------------
function onLimpiar() {
  form.reset();

  if ($("cursoViajante") && grupoData?.curso) {
    $("cursoViajante").value = String(grupoData.curso);
  }

  $("contactoPrincipalTelefono").value = "+569";
  $("emergenciaTelefono").value = "+569";
  $("rutDv").value = "";

  ocultarMensaje();
  aplicarEstadoUI();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// -----------------------------------------------------------------------------
// HELPERS DATOS
// -----------------------------------------------------------------------------
function obtenerRadio(name) {
  const checked = document.querySelector(`input[name="${name}"]:checked`);
  return checked ? checked.value : "";
}

function obtenerChecks(name) {
  return Array.from(document.querySelectorAll(`input[name="${name}"]:checked`))
    .map((el) => el.value);
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

function normalizarDocumentoPasaporte(pais, numero) {
  const paisNorm = limpiarTexto(pais).toUpperCase().replace(/[^A-Z0-9]/g, "");
  const numNorm = limpiarTexto(numero).toUpperCase().replace(/[^A-Z0-9]/g, "");
  return `PASAPORTE_${paisNorm}_${numNorm}`;
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
  });

  el.addEventListener("input", () => {
    const raw = String(el.value || "");
    let clean = raw.replace(/[^\d+]/g, "");

    if (clean.includes("+")) {
      clean = clean[0] === "+" ? "+" + clean.slice(1).replace(/\+/g, "") : clean.replace(/\+/g, "");
    }

    el.value = clean;
  });
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

function grupoEsInternacional() {
  const destinoPrincipal = normalizarTexto(grupoData?.destinoPrincipal || "");
  const destinoOtro = normalizarTexto(grupoData?.destinoPrincipalOtro || "");
  const programa = normalizarTexto(grupoData?.programa || "");
  const universo = `${destinoPrincipal} ${destinoOtro} ${programa}`.trim();

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

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
