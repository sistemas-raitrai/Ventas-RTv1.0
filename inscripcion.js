// inscripcion.js
// -----------------------------------------------------------------------------
// Formulario público de inscripción Rai Trai.
// Incluye:
// - Pantalla de bienvenida + botón comenzar
// - Barra de progreso automática
// - Tipo viajante: estudiante / profesor / adulto acompañante
// - RUT / sin RUT con correlativo global
// - Colección global inscripciones_sin_rut
// - Colección global inscripciones_por_rut
// - Historial del grupo
// -----------------------------------------------------------------------------

import { db } from "./firebase-init.js";

import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  runTransaction,
  collection,
  addDoc,
  getDocs,
  query,
  where
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
const sinRutNotice = $("sinRutNotice");
const rutHint = $("rutHint");
const nacionalidadDetalleWrap = $("nacionalidadDetalleWrap");

const telefonoViajanteWrap = $("telefonoViajanteWrap");

const bloqueProfesor = $("bloqueProfesor");
const tipoProfesorOtroWrap = $("tipoProfesorOtroWrap");

const bloqueAcompanante = $("bloqueAcompanante");
const relacionCursoOtroWrap = $("relacionCursoOtroWrap");

const bloqueApoderado = $("bloqueApoderado");
const contactoPrincipalRelacionOtroWrap = $("contactoPrincipalRelacionOtroWrap");
const contactoPrincipalWhatsappAlternativoWrap = $("contactoPrincipalWhatsappAlternativoWrap");

const emergenciaRelacionOtroWrap = $("emergenciaRelacionOtroWrap");
const emergenciaWhatsappAlternativoWrap = $("emergenciaWhatsappAlternativoWrap");

const bloqueInternacional = $("bloqueInternacional");
const docsInternacionalesDetalleWrap = $("docsInternacionalesDetalleWrap");
const permisoMenorWrap = $("permisoMenorWrap");
const situacionLegalWrap = $("situacionLegalWrap");
const situacionLegalDetalleWrap = $("situacionLegalDetalleWrap");

const enfermedadBaseDetalleWrap = $("enfermedadBaseDetalleWrap");
const saludGeneralDetalleWrap = $("saludGeneralDetalleWrap");
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
const RUT_INTERNO_INICIAL = 90000000;

// -----------------------------------------------------------------------------
// ESTADO
// -----------------------------------------------------------------------------
let grupoData = null;
let idGrupo = "";
let tokenUrl = "";
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

  const inscripcionHabilitada = !!grupoData.inscripcionHabilitada;
  const tokenGrupo = limpiarTexto(grupoData.tokenInscripcion);

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

  chipColegio.textContent = limpiarTexto(grupoData.colegio) || "-";
  chipCurso.textContent = limpiarTexto(grupoData.curso) || "-";

  chipDestino.textContent =
    limpiarTexto(grupoData.destinoPrincipal) ||
    limpiarTexto(grupoData.destino) ||
    "-";

  chipAno.textContent = String(grupoData.anoViaje || "-");
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

  form.addEventListener("submit", onSubmit);
  btnLimpiar.addEventListener("click", onLimpiar);

  form.addEventListener("input", actualizarProgreso);
  form.addEventListener("change", () => {
    aplicarEstadoUI();
    actualizarProgreso();
  });

  document.querySelectorAll('input[name="tipoViajante"]').forEach((el) => {
    el.addEventListener("change", aplicarEstadoUI);
  });

  $("rutNumero").addEventListener("input", onRutInput);
  $("rutDv").addEventListener("input", onRutInput);

  enlazarFlagDetalle("conoceDocsInternacionales", docsInternacionalesDetalleWrap, ["no", "parcial"]);
  enlazarFlagDetalle("situacionLegalAfecta", situacionLegalDetalleWrap, ["si", "privado"]);

  enlazarFlagDetalle("enfermedadBaseFlag", enfermedadBaseDetalleWrap, ["si"]);
  enlazarFlagDetalle("saludGeneralFlag", saludGeneralDetalleWrap, ["si"]);
  enlazarFlagDetalle("medicamentosFlag", medicamentosWrap, ["si"]);
  enlazarFlagDetalle("medicamentosProhibidosFlag", medicamentosProhibidosDetalleWrap, ["si"]);
  enlazarFlagDetalle("alergiasFlag", alergiasWrap, ["si"]);
  enlazarFlagDetalle("dietaFlag", dietaWrap, ["si"]);
  enlazarFlagDetalle("otrosAntecedentesFlag", otrosAntecedentesDetalleWrap, ["si"]);

  [
    "telefonoViajante",
    "contactoPrincipalTelefono",
    "contactoPrincipalWhatsappAlternativo",
    "emergenciaTelefono",
    "emergenciaWhatsappAlternativo"
  ].forEach(bindPhoneInput);

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
      <strong id="progresoTexto">Avance del formulario</strong>
      <span id="progresoPorcentaje" style="font-weight:700; color:#6f58c9;">0%</span>
    </div>

    <div style="height:10px; background:#efeafe; border-radius:999px; overflow:hidden; border:1px solid #d9d9e6;">
      <div id="progresoBarra" style="height:100%; width:0%; background:#6f58c9; border-radius:999px; transition:width .25s ease;"></div>
    </div>

    <div id="progresoAyuda" style="margin-top:8px; color:#6d6d7a; font-size:12px;">
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

  const tipoIdentificacion = $("tipoIdentificacion").value;
  const nacionalidadBase = $("nacionalidadBase").value;
  const esInternacional = grupoEsInternacional();
  const esMenor = calcularEdad($("fechaNacimiento").value) < 18;

  mostrar(bloqueApoderado, esEstudiante);
  mostrar(bloqueProfesor, esProfesor);
  mostrar(bloqueAcompanante, esAcompanante);
  mostrar(adultoCompromisoCard, esAdultoOperativo);
  mostrar(telefonoViajanteWrap, esAdultoOperativo);

  setRequired("telefonoViajante", esAdultoOperativo);
  setRequired("adultoAceptaCompromiso", esAdultoOperativo);

  mostrar(rutCompletoWrap, tipoIdentificacion === "rut");
  mostrar(sinRutNotice, tipoIdentificacion === "sin_rut");

  setRequired("rutNumero", tipoIdentificacion === "rut");

  if (tipoIdentificacion !== "rut") {
    $("rutNumero").value = "";
    $("rutDv").value = "";
    $("rutNumero").classList.remove("input-error");
  }

  const generoOtro = $("genero").value === "otro";
  mostrar(generoOtroWrap, generoOtro);
  setRequired("generoOtro", generoOtro);

  const nacionalidadDetalle = nacionalidadBase === "otra" || nacionalidadBase === "doble";
  mostrar(nacionalidadDetalleWrap, nacionalidadDetalle);
  setRequired("nacionalidadDetalle", nacionalidadDetalle);

  const tipoProfesorOtro = $("tipoProfesor").value === "otro";
  mostrar(tipoProfesorOtroWrap, tipoProfesorOtro);
  setRequired("tipoProfesor", esProfesor);
  setRequired("tipoProfesorOtro", esProfesor && tipoProfesorOtro);

  const relacionCursoOtro = $("relacionCurso").value === "otro";
  mostrar(relacionCursoOtroWrap, relacionCursoOtro);
  setRequired("relacionCurso", esAcompanante);
  setRequired("relacionCursoOtro", esAcompanante && relacionCursoOtro);
  setRequired("estudianteRelacionado", esAcompanante);

  setRequired("contactoPrincipalNombre", esEstudiante);
  setRequired("contactoPrincipalRelacion", esEstudiante);
  setRequired("contactoPrincipalTelefono", esEstudiante);
  setRequired("contactoPrincipalCorreo", esEstudiante);

  const relacionOtro = $("contactoPrincipalRelacion").value === "otro";
  mostrar(contactoPrincipalRelacionOtroWrap, esEstudiante && relacionOtro);
  setRequired("contactoPrincipalRelacionOtro", esEstudiante && relacionOtro);

  const contactoEsWhatsapp = $("contactoPrincipalEsWhatsapp").checked;
  mostrar(contactoPrincipalWhatsappAlternativoWrap, esEstudiante && !contactoEsWhatsapp);
  setRequired("contactoPrincipalWhatsappAlternativo", esEstudiante && !contactoEsWhatsapp);

  const emergenciaOtro = $("emergenciaRelacion").value === "otro";
  mostrar(emergenciaRelacionOtroWrap, emergenciaOtro);
  setRequired("emergenciaRelacionOtro", emergenciaOtro);

  const emergenciaEsWhatsapp = $("emergenciaEsWhatsapp").checked;
  mostrar(emergenciaWhatsappAlternativoWrap, !emergenciaEsWhatsapp);
  setRequired("emergenciaWhatsappAlternativo", !emergenciaEsWhatsapp);

  mostrar(bloqueInternacional, esInternacional);

  const docsNoChile = esInternacional && nacionalidadDetalle;
  mostrar($("docsNoChileWrap"), docsNoChile);

  if (!docsNoChile) {
    limpiarRadios("conoceDocsInternacionales");
    $("docsInternacionalesDetalle").value = "";
    mostrar(docsInternacionalesDetalleWrap, false);
  }

  const permisoMenor = esEstudiante && esInternacional && esMenor;
  mostrar(permisoMenorWrap, permisoMenor);
  mostrar(situacionLegalWrap, permisoMenor);

  if (!permisoMenor) {
    limpiarRadios("permisoMenorViaje");
    limpiarRadios("situacionLegalAfecta");
    $("situacionLegalDetalle").value = "";
    mostrar(situacionLegalDetalleWrap, false);
  }

  actualizarProgreso();
}

// -----------------------------------------------------------------------------
// RUT
// -----------------------------------------------------------------------------
function onRutInput() {
  const numeroInput = $("rutNumero");
  const dvInput = $("rutDv");

  const numero = limpiarRutNumero(numeroInput.value);
  const dv = limpiarTexto(dvInput.value).toUpperCase();

  numeroInput.value = numero;
  dvInput.value = dv;

  if (!numero || !dv) {
    numeroInput.classList.remove("input-error");
    dvInput.classList.remove("input-error");
    rutHint.textContent = "Ingrese RUT completo.";
    return;
  }

  const dvCorrecto = calcularDvRut(numero);
  const valido = dv === dvCorrecto;

  numeroInput.classList.toggle("input-error", !valido);
  dvInput.classList.toggle("input-error", !valido);

  rutHint.textContent = valido
    ? "RUT válido ✔"
    : "RUT inválido";
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

  const segundoApellido = limpiarTexto($("segundoApellido").value);

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
  btnEnviar.textContent = "Enviando inscripción...";

  try {
    const payloadBase = construirPayloadBase();
    const payload = await guardarInscripcion(payloadBase);

    await crearCorreoConfirmacion(payload);
    await registrarEventosEspeciales(payload);
    await detectarRutEnOtrosGrupos(payload);
    await verificarCupoCompleto();

    mostrarMensaje("ok", "Inscripción enviada correctamente. ¡Gracias por confiar en Rai Trai!");
    form.reset();
    resetDefaults();
    aplicarEstadoUI();
    actualizarProgreso();
    window.scrollTo({ top: 0, behavior: "smooth" });

  } catch (error) {
    console.error(error);

    if (error.message === "duplicate_document") {
      mostrarMensaje(
        "error",
        `Ya existe una inscripción para este documento dentro del grupo. Comuníquese con <strong>${CORREO_ADMIN}</strong> o al <strong>${TELEFONO_ADMIN}</strong>.`
      );
    } else if (error.message === "duplicate_no_rut_name") {
      mostrarMensaje(
        "error",
        `Ya existe una inscripción con esos nombres y apellidos en este grupo. Comuníquese con <strong>${CORREO_ADMIN}</strong> o al <strong>${TELEFONO_ADMIN}</strong>.`
      );
    } else {
      mostrarMensaje(
        "error",
        `No fue posible enviar la inscripción. Intente nuevamente o comuníquese con <strong>${CORREO_ADMIN}</strong>.`
      );
    }

    window.scrollTo({ top: 0, behavior: "smooth" });
  } finally {
    btnEnviar.disabled = false;
    btnEnviar.textContent = "Enviar inscripción";
  }
}

// -----------------------------------------------------------------------------
// GUARDADO
// -----------------------------------------------------------------------------
async function guardarInscripcion(payloadBase) {
  if (payloadBase.identificacion.tipoIdentificacion === "rut") {
    return await guardarConRut(payloadBase);
  }

  if (payloadBase.identificacion.tipoIdentificacion === "sin_rut") {
    return await guardarSinRut(payloadBase);
  }

  throw new Error("tipo_identificacion_invalido");
}

async function guardarConRut(payloadBase) {
  const documentoNormalizado = payloadBase.identificacion.documentoNormalizado;

  const refInscripcion = doc(
    db,
    "ventas_cotizaciones",
    idGrupo,
    "inscripciones",
    documentoNormalizado
  );

  const refRutGlobal = doc(
    db,
    "inscripciones_por_rut",
    `${documentoNormalizado}_${idGrupo}`
  );

  const payload = {
    ...payloadBase,
    meta: {
      ...payloadBase.meta,
      fechaInscripcion: serverTimestamp()
    }
  };

  await runTransaction(db, async (tx) => {
    const existente = await tx.get(refInscripcion);

    if (existente.exists()) {
      throw new Error("duplicate_document");
    }

    tx.set(refInscripcion, payload);

    tx.set(refRutGlobal, {
      rutNormalizado: documentoNormalizado,
      idGrupo,
      nombreCompleto: payload.identificacion.nombreCompleto,
      grupo: payload.grupo,
      fechaRegistro: serverTimestamp()
    });
  });

  return payload;
}

async function guardarSinRut(payloadBase) {
  const nombreKey = construirNombreKey(
    payloadBase.identificacion.nombres,
    payloadBase.identificacion.primerApellido,
    payloadBase.identificacion.segundoApellido
  );

  const refCounter = doc(db, "config", "contadorRutInterno");

  const refNameIndex = doc(
    db,
    "ventas_cotizaciones",
    idGrupo,
    "sin_rut_name_index",
    nombreKey
  );

  return await runTransaction(db, async (tx) => {
    const snapIndex = await tx.get(refNameIndex);

    if (snapIndex.exists()) {
      throw new Error("duplicate_no_rut_name");
    }

    const snapCounter = await tx.get(refCounter);

    let numero = RUT_INTERNO_INICIAL;

    if (snapCounter.exists()) {
      const ultimo = Number(snapCounter.data().ultimoNumero || RUT_INTERNO_INICIAL - 1);
      numero = ultimo + 1;
    }

    const rutDv = calcularDvRut(String(numero));
    const documento = `${numero}-${rutDv}`;
    const documentoNormalizado = `SIN_RUT_${numero}-${rutDv}`;

    const payload = {
      ...payloadBase,
      identificacion: {
        ...payloadBase.identificacion,
        documento,
        documentoNormalizado,
        rutInterno: documento,
        esRutInterno: true
      },
      meta: {
        ...payloadBase.meta,
        fechaInscripcion: serverTimestamp()
      }
    };

    const refInscripcion = doc(
      db,
      "ventas_cotizaciones",
      idGrupo,
      "inscripciones",
      documentoNormalizado
    );

    const refSinRutGlobal = doc(db, "inscripciones_sin_rut", documentoNormalizado);

    tx.set(refCounter, { ultimoNumero: numero }, { merge: true });

    tx.set(refInscripcion, payload);

    tx.set(refNameIndex, {
      nombreKey,
      documentoNormalizado,
      idGrupo,
      nombreCompleto: payload.identificacion.nombreCompleto,
      fechaRegistro: serverTimestamp()
    });

    tx.set(refSinRutGlobal, {
      documento,
      documentoNormalizado,
      nombreKey,
      idGrupo,
      grupo: payload.grupo,
      identificacion: payload.identificacion,
      fechaRegistro: serverTimestamp(),
      estado: "activo"
    });

    return payload;
  });
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

  const tipoIdentificacion = $("tipoIdentificacion").value;
  const esInternacional = grupoEsInternacional();
  const edad = calcularEdad($("fechaNacimiento").value);
  const esMenor = edad < 18;

  if (!tipoViajante) errores.push("Debe indicar el tipo de viajante.");
  if (!limpiarTexto($("nombres").value)) errores.push("Debe ingresar los nombres del viajante.");
  if (!limpiarTexto($("primerApellido").value)) errores.push("Debe ingresar el primer apellido del viajante.");

  if (!$("genero").value) errores.push("Debe indicar el género del viajante.");
  if ($("genero").value === "otro" && !limpiarTexto($("generoOtro").value)) {
    errores.push("Debe especificar el género del viajante.");
  }

  if (!tipoIdentificacion) errores.push("Debe seleccionar el documento de identidad.");

  if (tipoIdentificacion === "rut") {
    const rutNumero = limpiarRutNumero($("rutNumero").value);
    const dv = limpiarTexto($("rutDv").value).toUpperCase();
  
    if (!rutNumero || !dv) {
      errores.push("Debe ingresar el RUT completo.");
    } else {
      const dvCorrecto = calcularDvRut(rutNumero);
  
      if (dv !== dvCorrecto) {
        errores.push("El RUT ingresado es inválido.");
      }
    }
  }

  if (!$("fechaNacimiento").value) errores.push("Debe ingresar la fecha de nacimiento.");

  if (!$("nacionalidadBase").value) errores.push("Debe indicar la nacionalidad.");

  if (["otra", "doble"].includes($("nacionalidadBase").value) && !limpiarTexto($("nacionalidadDetalle").value)) {
    errores.push("Debe especificar la nacionalidad.");
  }

  if (!validarCorreo($("correoViajante").value)) {
    errores.push("Debe ingresar un correo válido del viajante.");
  }

  if (esAdultoOperativo && !telefonoValido($("telefonoViajante").value)) {
    errores.push("Debe ingresar un teléfono válido del viajante.");
  }

  if (esProfesor) {
    if (!$("tipoProfesor").value) errores.push("Debe indicar el tipo de profesor.");
    if ($("tipoProfesor").value === "otro" && !limpiarTexto($("tipoProfesorOtro").value)) {
      errores.push("Debe especificar el tipo de profesor.");
    }
  }

  if (esAcompanante) {
    if (!$("relacionCurso").value) errores.push("Debe indicar la relación con el curso.");
    if ($("relacionCurso").value === "otro" && !limpiarTexto($("relacionCursoOtro").value)) {
      errores.push("Debe especificar la relación con el curso.");
    }
    if (!limpiarTexto($("estudianteRelacionado").value)) {
      errores.push("Debe indicar el nombre del estudiante relacionado.");
    }
  }

  if (esEstudiante) {
    if (!limpiarTexto($("contactoPrincipalNombre").value)) errores.push("Debe ingresar el nombre del apoderado.");
    if (!$("contactoPrincipalRelacion").value) errores.push("Debe indicar la relación del apoderado.");
    if ($("contactoPrincipalRelacion").value === "otro" && !limpiarTexto($("contactoPrincipalRelacionOtro").value)) {
      errores.push("Debe especificar la relación del apoderado.");
    }
    if (!telefonoValido($("contactoPrincipalTelefono").value)) errores.push("Debe ingresar un teléfono válido del apoderado.");
    if (!$("contactoPrincipalEsWhatsapp").checked && !telefonoValido($("contactoPrincipalWhatsappAlternativo").value)) {
      errores.push("Debe ingresar un WhatsApp válido del apoderado.");
    }
    if (!validarCorreo($("contactoPrincipalCorreo").value)) errores.push("Debe ingresar un correo válido del apoderado.");
  }

  if (!limpiarTexto($("emergenciaNombre").value)) errores.push("Debe ingresar el contacto de emergencia.");
  if (!$("emergenciaRelacion").value) errores.push("Debe indicar la relación del contacto de emergencia.");
  if ($("emergenciaRelacion").value === "otro" && !limpiarTexto($("emergenciaRelacionOtro").value)) {
    errores.push("Debe especificar la relación del contacto de emergencia.");
  }
  if (!telefonoValido($("emergenciaTelefono").value)) errores.push("Debe ingresar un teléfono válido de emergencia.");
  if (!$("emergenciaEsWhatsapp").checked && !telefonoValido($("emergenciaWhatsappAlternativo").value)) {
    errores.push("Debe ingresar un WhatsApp válido de emergencia.");
  }

  if (esInternacional && ["otra", "doble"].includes($("nacionalidadBase").value)) {
    if (!obtenerRadio("conoceDocsInternacionales")) errores.push("Debe indicar si conoce los documentos internacionales requeridos.");
  }

  if (esInternacional && esEstudiante && esMenor) {
    if (!obtenerRadio("permisoMenorViaje")) errores.push("Debe indicar la situación de autorizaciones del menor.");
    if (!obtenerRadio("situacionLegalAfecta")) errores.push("Debe indicar si existe una situación legal o familiar relevante.");
  }

  if (obtenerRadio("enfermedadBaseFlag") === "si" && !limpiarTexto($("enfermedadBaseDetalle").value)) {
    errores.push("Debe detallar la enfermedad de base.");
  }

  if (obtenerRadio("saludGeneralFlag") === "si" && !limpiarTexto($("saludGeneralDetalle").value)) {
    errores.push("Debe detallar la condición de salud.");
  }

  if (obtenerRadio("medicamentosFlag") === "si" && !limpiarTexto($("medicamentosDetalle").value)) {
    errores.push("Debe detallar los medicamentos.");
  }

  if (obtenerRadio("medicamentosProhibidosFlag") === "si" && !limpiarTexto($("medicamentosProhibidosDetalle").value)) {
    errores.push("Debe detallar los medicamentos prohibidos.");
  }

  if (obtenerRadio("alergiasFlag") === "si" && !limpiarTexto($("alergiasDetalle").value)) {
    errores.push("Debe detallar la alergia.");
  }

  if (obtenerRadio("dietaFlag") === "si") {
    if (!obtenerChecks("dietaTipo").length) errores.push("Debe seleccionar al menos un tipo de dieta.");
    if (!limpiarTexto($("dietaDetalle").value)) errores.push("Debe detallar la dieta.");
  }

  if (obtenerRadio("otrosAntecedentesFlag") === "si" && !limpiarTexto($("otrosAntecedentesDetalle").value)) {
    errores.push("Debe detallar la información adicional.");
  }

  if (esAdultoOperativo && !$("adultoAceptaCompromiso").checked) {
    errores.push("Debe aceptar la declaración de responsabilidad.");
  }

  if (!$("aceptaVeracidad").checked) errores.push("Debe aceptar la declaración de veracidad.");
  if (!$("aceptaUsoInterno").checked) errores.push("Debe autorizar el uso interno de la información.");
  if (!$("aceptaCambiosCorreo").checked) errores.push("Debe aceptar la condición de modificación posterior.");

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

  const fechaNacimiento = $("fechaNacimiento").value || null;
  const edad = calcularEdad(fechaNacimiento);
  const esMenor = edad < 18;
  const esInternacional = grupoEsInternacional();

  const nombres = limpiarTexto($("nombres").value);
  const primerApellido = limpiarTexto($("primerApellido").value);
  const segundoApellido = limpiarTexto($("segundoApellido").value);
  const sinSegundoApellido = !segundoApellido;
  const nombreCompleto = [nombres, primerApellido, segundoApellido].filter(Boolean).join(" ");

  const tipoIdentificacion = $("tipoIdentificacion").value;
  const rutNumero = limpiarRutNumero($("rutNumero").value);
  const rutDv = limpiarTexto($("rutDv").value).toUpperCase();

  let documento = "";
  let documentoNormalizado = "";
  let rut = "";

  if (tipoIdentificacion === "rut") {
    rut = `${rutNumero}-${rutDv}`;
    documento = rut;
    documentoNormalizado = normalizarRutDocumento(rutNumero, rutDv);
  }

  const genero = $("genero").value || "";
  const generoOtro = limpiarTexto($("generoOtro").value);
  const generoFinal = genero === "otro" ? generoOtro : genero;

  const contactoRelacion = $("contactoPrincipalRelacion").value || "";
  const contactoRelacionOtro = limpiarTexto($("contactoPrincipalRelacionOtro").value);
  const contactoRelacionFinal = contactoRelacion === "otro" ? contactoRelacionOtro : contactoRelacion;

  const emergenciaRelacion = $("emergenciaRelacion").value || "";
  const emergenciaRelacionOtro = limpiarTexto($("emergenciaRelacionOtro").value);
  const emergenciaRelacionFinal = emergenciaRelacion === "otro" ? emergenciaRelacionOtro : emergenciaRelacion;

  const tipoProfesor = $("tipoProfesor").value || "";
  const tipoProfesorOtro = limpiarTexto($("tipoProfesorOtro").value);
  const tipoProfesorFinal = tipoProfesor === "otro" ? tipoProfesorOtro : tipoProfesor;

  const relacionCurso = $("relacionCurso").value || "";
  const relacionCursoOtro = limpiarTexto($("relacionCursoOtro").value);
  const relacionCursoFinal = relacionCurso === "otro" ? relacionCursoOtro : relacionCurso;

  return {
    tipoRegistro: "inscripcion_pasajero",
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
      nacionalidadBase: $("nacionalidadBase").value || "",
      nacionalidadDetalle: limpiarTexto($("nacionalidadDetalle").value),

      correoViajante: limpiarTexto($("correoViajante").value),
      telefonoViajante: esAdultoOperativo ? limpiarTexto($("telefonoViajante").value) : "",
      telefonoViajanteEsWhatsapp: esAdultoOperativo ? !!$("telefonoViajanteEsWhatsapp").checked : false
    },

    profesor: {
      aplica: esProfesor,
      tipoProfesor: esProfesor ? tipoProfesorFinal : "",
      tipoProfesorBase: esProfesor ? tipoProfesor : "",
      tipoProfesorOtro: esProfesor ? tipoProfesorOtro : "",
      interesConoceRaitrai: esProfesor ? !!$("interesConoceRaitrai").checked : false
    },

    adultoAcompanante: {
      aplica: esAcompanante,
      relacionCurso: esAcompanante ? relacionCursoFinal : "",
      relacionCursoBase: esAcompanante ? relacionCurso : "",
      relacionCursoOtro: esAcompanante ? relacionCursoOtro : "",
      estudianteRelacionado: esAcompanante ? limpiarTexto($("estudianteRelacionado").value) : ""
    },

    contactoPrincipal: {
      aplica: esEstudiante,
      nombre: esEstudiante ? limpiarTexto($("contactoPrincipalNombre").value) : nombreCompleto,
      relacion: esEstudiante ? contactoRelacionFinal : "mismo_viajante",
      relacionBase: esEstudiante ? contactoRelacion : "mismo_viajante",
      telefono: esEstudiante ? limpiarTexto($("contactoPrincipalTelefono").value) : limpiarTexto($("telefonoViajante").value),
      esWhatsapp: esEstudiante ? !!$("contactoPrincipalEsWhatsapp").checked : !!$("telefonoViajanteEsWhatsapp").checked,
      whatsappAlternativo: esEstudiante && !$("contactoPrincipalEsWhatsapp").checked
        ? limpiarTexto($("contactoPrincipalWhatsappAlternativo").value)
        : "",
      correo: esEstudiante ? limpiarTexto($("contactoPrincipalCorreo").value) : limpiarTexto($("correoViajante").value)
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
      permisoMenorViaje: esInternacional && esEstudiante && esMenor ? (obtenerRadio("permisoMenorViaje") || "") : "",
      situacionLegalAfecta: esInternacional && esEstudiante && esMenor ? (obtenerRadio("situacionLegalAfecta") || "") : "",
      situacionLegalDetalle: limpiarTexto($("situacionLegalDetalle")?.value)
    },

    salud: {
      enfermedadBaseFlag: obtenerRadio("enfermedadBaseFlag") || "",
      enfermedadBaseDetalle: limpiarTexto($("enfermedadBaseDetalle").value),

      saludGeneralFlag: obtenerRadio("saludGeneralFlag") || "",
      saludGeneralDetalle: limpiarTexto($("saludGeneralDetalle").value),

      medicamentosFlag: obtenerRadio("medicamentosFlag") || "",
      medicamentosDetalle: limpiarTexto($("medicamentosDetalle").value),

      medicamentosProhibidosFlag: obtenerRadio("medicamentosProhibidosFlag") || "",
      medicamentosProhibidosDetalle: limpiarTexto($("medicamentosProhibidosDetalle").value),

      alergiasFlag: obtenerRadio("alergiasFlag") || "",
      alergiasDetalle: limpiarTexto($("alergiasDetalle").value),

      dietaFlag: obtenerRadio("dietaFlag") || "",
      dietaTipos: obtenerChecks("dietaTipo"),
      dietaDetalle: limpiarTexto($("dietaDetalle").value),

      otrosAntecedentesFlag: obtenerRadio("otrosAntecedentesFlag") || "",
      otrosAntecedentesDetalle: limpiarTexto($("otrosAntecedentesDetalle").value)
    },

    adultoCompromiso: {
      aplica: esAdultoOperativo,
      aceptaCompromiso: esAdultoOperativo ? !!$("adultoAceptaCompromiso").checked : false,
      observaciones: limpiarTexto($("adultoObservacionesCompromiso").value)
    },

    consentimiento: {
      aceptaVeracidad: !!$("aceptaVeracidad").checked,
      aceptaUsoInterno: !!$("aceptaUsoInterno").checked,
      aceptaCambiosCorreo: !!$("aceptaCambiosCorreo").checked,
      correoCambios: CORREO_ADMIN,
      telefonoCambios: TELEFONO_ADMIN
    },

    meta: {
      fechaInscripcion: null,
      canal: "formulario_publico",
      versionFormulario: 3,
      creadoDesde: window.location.href,
      estado: "inscrito"
    }
  };
}

// -----------------------------------------------------------------------------
// CORREO
// -----------------------------------------------------------------------------
async function crearCorreoConfirmacion(payload) {
  const destinatario = payload.contactoPrincipal?.correo || payload.identificacion?.correoViajante;
  if (!destinatario) return;

  const nombre = payload.identificacion?.nombreCompleto || "";
  const destino = payload.grupo?.destinoPrincipal || "";
  const aliasGrupo = payload.grupo?.aliasGrupo || payload.grupo?.nombreGrupo || payload.grupo?.idGrupo || idGrupo;
  const tipoLabel = labelTipoViajante(payload.tipoViajante);
  const documento = payload.identificacion?.documento || "";

  const html = `
    <div style="font-family: Arial, Helvetica, sans-serif; color:#222; line-height:1.6;">
      <h2>Confirmación de inscripción recibida</h2>
      <p>Hemos recibido correctamente la inscripción de <strong>${escapeHtml(nombre)}</strong> como <strong>${escapeHtml(tipoLabel)}</strong>.</p>
      <p>
        <strong>Grupo:</strong> ${escapeHtml(aliasGrupo)}<br>
        <strong>Destino:</strong> ${escapeHtml(destino)}<br>
        <strong>Documento:</strong> ${escapeHtml(documento)}
      </p>
      <p>La información entregada será utilizada exclusivamente para la planificación, coordinación y operación segura del viaje.</p>
      <p>Si necesita corregir algún dato posteriormente, debe comunicarse con Turismo Rai Trai y asegurarse de recibir confirmación del cambio.</p>
      <p>Correo: <strong>${escapeHtml(CORREO_ADMIN)}</strong><br>Teléfono: <strong>${escapeHtml(TELEFONO_ADMIN)}</strong></p>
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
// HISTORIAL
// -----------------------------------------------------------------------------
async function registrarEventosEspeciales(payload) {
  const eventos = [];

  eventos.push({
    tipo: "inscripcion_publica",
    mensaje: `Nueva inscripción recibida para ${payload.identificacion?.nombreCompleto || "viajante"}.`
  });

  if (payload.identificacion?.sinSegundoApellido) {
    eventos.push({
      tipo: "inscripcion_sin_segundo_apellido",
      mensaje: `El viajante ${payload.identificacion.nombreCompleto} fue inscrito sin segundo apellido, confirmado por quien completó el formulario.`
    });
  }

  if (payload.identificacion?.esRutInterno) {
    eventos.push({
      tipo: "inscripcion_sin_rut",
      mensaje: `El viajante ${payload.identificacion.nombreCompleto} fue inscrito sin RUT. Se asignó documento interno ${payload.identificacion.documento}.`
    });
  }

  for (const evento of eventos) {
    await addDoc(collection(db, "ventas_cotizaciones", idGrupo, "historial_inscripciones"), {
      fecha: serverTimestamp(),
      tipo: evento.tipo,
      documentoNormalizado: payload.identificacion?.documentoNormalizado || "",
      documento: payload.identificacion?.documento || "",
      nombreCompleto: payload.identificacion?.nombreCompleto || "",
      tipoViajante: payload.tipoViajante || "",
      mensaje: evento.mensaje
    });
  }
}

async function detectarRutEnOtrosGrupos(payload) {
  if (payload.identificacion?.tipoIdentificacion !== "rut") return;

  const rutNormalizado = payload.identificacion.documentoNormalizado;

  const q = query(
    collection(db, "inscripciones_por_rut"),
    where("rutNormalizado", "==", rutNormalizado)
  );

  const snap = await getDocs(q);

  const otros = snap.docs.map((d) => d.data()).filter((x) => x.idGrupo && x.idGrupo !== idGrupo);

  if (!otros.length) return;

  await addDoc(collection(db, "alertas_inscripciones"), {
    fecha: serverTimestamp(),
    tipo: "rut_repetido_otro_grupo",
    prioridad: "media",
    idGrupo,
    rutNormalizado,
    nombreCompleto: payload.identificacion.nombreCompleto,
    grupoActual: payload.grupo,
    coincidencias: otros,
    mensaje: `El RUT ${rutNormalizado} fue inscrito en este grupo y ya existe en otro grupo. Revisar administrativamente.`
  });
}

async function verificarCupoCompleto() {
  const cantidadGrupo = normalizarNumeroGrupo(
    grupoData?.cantidadGrupo ?? grupoData?.cantidadgrupo ?? grupoData?.cantidadGrupoCotizada
  );

  if (!cantidadGrupo) return;

  const snap = await getDocs(collection(db, "ventas_cotizaciones", idGrupo, "inscripciones"));
  const totalInscritos = snap.size;

  if (totalInscritos !== cantidadGrupo) return;

  const refControl = doc(db, "ventas_cotizaciones", idGrupo, "control_inscripcion", "cupo_completo");
  const controlSnap = await getDoc(refControl);

  if (controlSnap.exists()) return;

  await setDoc(refControl, {
    fecha: serverTimestamp(),
    totalInscritos,
    cantidadGrupo,
    estado: "registrado"
  });

  await addDoc(collection(db, "ventas_cotizaciones", idGrupo, "historial_inscripciones"), {
    fecha: serverTimestamp(),
    tipo: "cupo_completo",
    totalInscritos,
    cantidadGrupo,
    mensaje: `Cupo completo: se registraron ${totalInscritos} personas inscritas de ${cantidadGrupo} esperadas para el grupo.`
  });
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

  $("rutDv").value = "";
  $("rutNumero").classList.remove("input-error");
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

// -----------------------------------------------------------------------------
// HELPERS DATOS
// -----------------------------------------------------------------------------
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
  });

  el.addEventListener("input", () => {
    const raw = String(el.value || "");
    let clean = raw.replace(/[^\d+]/g, "");

    if (clean.includes("+")) {
      clean = clean[0] === "+"
        ? "+" + clean.slice(1).replace(/\+/g, "")
        : clean.replace(/\+/g, "");
    }

    el.value = clean;
  });
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

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
