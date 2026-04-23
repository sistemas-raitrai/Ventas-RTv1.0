// inscripcion.js
// -----------------------------------------------------------------------------
// OBJETIVO
// Página pública de inscripción de pasajero para un grupo de viaje.
// Guarda en:
// ventas_cotizaciones/{idGrupo}/inscripciones/{rutNormalizado}
//
// REGLA CLAVE
// - El ID del documento será el RUT normalizado del viajante.
// - Si ese RUT ya existe en el grupo, NO se vuelve a inscribir.
// - Puede inscribirse:
//   1) estudiante
//   2) adulto acompañante
// - Si es adulto acompañante, se diferencia entre:
//   - responsable_grupo
//   - acompanante
//
// IMPORTANTE
// Este archivo asume que tu firebase-init.js exporta "db".
// Si en tu proyecto usas otro nombre o estructura, ajusta SOLO esa importación.
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

// Bloques condicionales
const adultoRolWrap = $("adultoRolWrap");
const adultoCompromisoCard = $("adultoCompromisoCard");
const adultoCargoWrap = $("adultoCargoWrap");
const cursoWrap = $("cursoWrap");

const nacionalidadDetalleWrap = $("nacionalidadDetalleWrap");

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

// -----------------------------------------------------------------------------
// CARGA DE GRUPO
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

  // Validación de apertura de inscripción
  const inscripcionHabilitada = !!grupoData.inscripcionHabilitada;
  const tokenGrupo = limpiarTexto(grupoData.tokenInscripcion);
  correoCambios = limpiarTexto(grupoData.correoCambiosInscripcion) || "operaciones@raitrai.cl";

  if (!inscripcionHabilitada) {
    mostrarMensaje("error", "La inscripción para este grupo no se encuentra habilitada.");
    bloquearFormulario();
    return;
  }

  // Si existe token configurado, se valida
  if (tokenGrupo && tokenUrl && tokenGrupo !== tokenUrl) {
    mostrarMensaje("error", "El enlace de inscripción no es válido para este grupo.");
    bloquearFormulario();
    return;
  }

  // Si el grupo tiene token y no vino token, también bloqueamos
  if (tokenGrupo && !tokenUrl) {
    mostrarMensaje("error", "Falta el token de acceso para esta inscripción.");
    bloquearFormulario();
    return;
  }

  // Rellenar chips visuales
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

  // Precargar curso por defecto para estudiante
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

  // Tipo viajante
  document.querySelectorAll('input[name="tipoViajante"]').forEach((el) => {
    el.addEventListener("change", aplicarEstadoUI);
  });

  // Rol adulto
  document.querySelectorAll('input[name="rolAdulto"]').forEach((el) => {
    el.addEventListener("change", aplicarEstadoUI);
  });

  // Nacionalidad
  $("nacionalidadBase").addEventListener("change", aplicarEstadoUI);

  // Fecha nacimiento
  $("fechaNacimiento").addEventListener("change", aplicarEstadoUI);

  // Radios de apertura/cierre
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

  // Formato RUT al salir del campo
  $("rut").addEventListener("blur", () => {
    $("rut").value = formatearRutVisual($("rut").value);
  });
}

// -----------------------------------------------------------------------------
// UI
// -----------------------------------------------------------------------------
function aplicarEstadoUI() {
  const tipoViajante = obtenerRadio("tipoViajante");
  const nacionalidadBase = $("nacionalidadBase").value;
  const esInternacional = grupoEsInternacional();
  const esMenor = calcularEdad($("fechaNacimiento").value) < 18;

  // Tipo viajante
  const esAdulto = tipoViajante === "adulto";
  mostrar(adultoRolWrap, esAdulto);
  mostrar(adultoCompromisoCard, esAdulto);
  mostrar(adultoCargoWrap, esAdulto);
  mostrar(cursoWrap, !esAdulto);

  // Curso obligatorio solo para estudiante
  $("cursoViajante").required = !esAdulto;

  // Nacionalidad
  const mostrarNacionalidadDetalle =
    nacionalidadBase === "otra" || nacionalidadBase === "doble";

  mostrar(nacionalidadDetalleWrap, mostrarNacionalidadDetalle);
  $("nacionalidadDetalle").required = mostrarNacionalidadDetalle;

  // Internacional
  mostrar(bloqueInternacional, esInternacional);

  // Pregunta documentación internacional:
  // solo si el viaje es internacional y la nacionalidad no es exclusivamente chilena
  const mostrarDocsNoChile = esInternacional && mostrarNacionalidadDetalle;
  const docsNoChileWrap = $("docsNoChileWrap");
  mostrar(docsNoChileWrap, mostrarDocsNoChile);

  if (!mostrarDocsNoChile) {
    limpiarRadios("conoceDocsInternacionales");
    $("docsInternacionalesDetalle").value = "";
    mostrar(docsInternacionalesDetalleWrap, false);
  }

  // Preguntas permiso menor:
  // solo estudiante + internacional + menor de edad
  const mostrarPermisoMenor = !esAdulto && esInternacional && esMenor;
  mostrar(permisoMenorWrap, mostrarPermisoMenor);
  mostrar(situacionLegalWrap, mostrarPermisoMenor);

  if (!mostrarPermisoMenor) {
    limpiarRadios("permisoMenorViaje");
    limpiarRadios("situacionLegalAfecta");
    $("situacionLegalDetalle").value = "";
    mostrar(situacionLegalDetalleWrap, false);
  }

  // Adulto: rol obligatorio
  document.querySelectorAll('input[name="rolAdulto"]').forEach((r) => {
    r.required = esAdulto;
  });

  // Carta compromiso adulto obligatoria si es adulto
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
    const rutNormalizado = payload.identificacion.rutNormalizado;

    const refInscripcion = doc(
      db,
      "ventas_cotizaciones",
      idGrupo,
      "inscripciones",
      rutNormalizado
    );

    await runTransaction(db, async (tx) => {
      const existente = await tx.get(refInscripcion);

      if (existente.exists()) {
        throw new Error("duplicate_rut");
      }

      tx.set(refInscripcion, payload);
    });

    // Cola correo de confirmación
    await crearCorreoConfirmacion(payload);

    // Opcional: registrar un evento simple en historial del grupo
    await registrarEventoGrupo(payload);

    mostrarMensaje(
      "ok",
      `Inscripción enviada correctamente. También se registró una solicitud de correo de confirmación a <strong>${escapeHtml(payload.contactoPrincipal.correo)}</strong>.`
    );

    form.reset();
    if ($("cursoViajante") && grupoData?.curso) {
      $("cursoViajante").value = String(grupoData.curso);
    }
    aplicarEstadoUI();
    window.scrollTo({ top: 0, behavior: "smooth" });

  } catch (error) {
    console.error(error);

    if (error.message === "duplicate_rut") {
      mostrarMensaje(
        "error",
        `Ya existe una inscripción para este RUT dentro del grupo. Si necesita corregir información, debe solicitarlo por correo a <strong>${escapeHtml(correoCambios)}</strong>.`
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

  if (!tipoViajante) {
    errores.push("Debe indicar si el viajante es estudiante o adulto acompañante.");
  }

  if (esAdulto && !obtenerRadio("rolAdulto")) {
    errores.push("Debe indicar el rol del adulto acompañante.");
  }

  if (!limpiarTexto($("nombreCompleto").value)) {
    errores.push("Debe ingresar el nombre completo del viajante.");
  }

  if (!validarRutFlexible($("rut").value)) {
    errores.push("Debe ingresar un RUT válido.");
  }

  if (!$("fechaNacimiento").value) {
    errores.push("Debe ingresar la fecha de nacimiento.");
  }

  if (!$("nacionalidadBase").value) {
    errores.push("Debe indicar la nacionalidad.");
  }

  if (
    (["otra", "doble"].includes($("nacionalidadBase").value)) &&
    !limpiarTexto($("nacionalidadDetalle").value)
  ) {
    errores.push("Debe especificar la nacionalidad indicada.");
  }

  if (!esAdulto && !limpiarTexto($("cursoViajante").value)) {
    errores.push("Debe ingresar el curso del estudiante.");
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

  if (!limpiarTexto($("contactoPrincipalRelacion").value)) {
    errores.push("Debe indicar la relación del contacto principal con el viajante.");
  }

  if (!limpiarTexto($("contactoPrincipalTelefono").value)) {
    errores.push("Debe ingresar el teléfono del contacto principal.");
  }

  if (!validarCorreo($("contactoPrincipalCorreo").value)) {
    errores.push("Debe ingresar un correo válido para el contacto principal.");
  }

  if (!limpiarTexto($("emergenciaNombre").value)) {
    errores.push("Debe ingresar el nombre del contacto de emergencia.");
  }

  if (!limpiarTexto($("emergenciaTelefono").value)) {
    errores.push("Debe ingresar el teléfono del contacto de emergencia.");
  }

  if (esInternacional && ["otra", "doble"].includes($("nacionalidadBase").value)) {
    const conoceDocs = obtenerRadio("conoceDocsInternacionales");
    if (!conoceDocs) {
      errores.push("Debe indicar si conoce los documentos requeridos para ingreso internacional.");
    }
  }

  if (esInternacional && !esAdulto && esMenor) {
    const permisoMenorViaje = obtenerRadio("permisoMenorViaje");
    if (!permisoMenorViaje) {
      errores.push("Debe indicar la situación de autorizaciones del menor para salida del país.");
    }

    const situacionLegalAfecta = obtenerRadio("situacionLegalAfecta");
    if (!situacionLegalAfecta) {
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
  const rutOriginal = limpiarTexto($("rut").value);
  const rutNormalizado = normalizarRut(rutOriginal);
  const fechaNacimiento = $("fechaNacimiento").value || null;
  const edad = calcularEdad(fechaNacimiento);
  const esMenor = edad < 18;
  const esInternacional = grupoEsInternacional();

  const nacionalidadBase = $("nacionalidadBase").value || "";
  const nacionalidadDetalle = limpiarTexto($("nacionalidadDetalle").value);

  const payload = {
    tipoRegistro: "inscripcion_pasajero",
    tipoViajante, // estudiante | adulto
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
      nombreCompleto,
      rut: formatearRutVisual(rutOriginal),
      rutNormalizado,
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
      relacion: limpiarTexto($("contactoPrincipalRelacion").value),
      telefono: limpiarTexto($("contactoPrincipalTelefono").value),
      correo: limpiarTexto($("contactoPrincipalCorreo").value),
      prevision: limpiarTexto($("prevision").value)
    },

    emergencia: {
      nombre: limpiarTexto($("emergenciaNombre").value),
      relacion: limpiarTexto($("emergenciaRelacion").value),
      telefono: limpiarTexto($("emergenciaTelefono").value)
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
      versionFormulario: 1,
      creadoDesde: window.location.href,
      estado: "inscrito"
    }
  };

  return payload;
}

// -----------------------------------------------------------------------------
// CORREO DE CONFIRMACIÓN
// -----------------------------------------------------------------------------
// Esta función deja una solicitud en la colección "mail".
// Si ya tienes Cloud Function / extensión que procesa esa colección, enviará el correo.
// Si usas otro mecanismo, aquí solo cambias esta parte.
async function crearCorreoConfirmacion(payload) {
  const destinatario = payload.contactoPrincipal?.correo;
  if (!destinatario) return;

  const esAdulto = !!payload.esAdulto;
  const nombre = payload.identificacion?.nombreCompleto || "";
  const destino = payload.grupo?.destinoPrincipal || "";
  const aliasGrupo = payload.grupo?.aliasGrupo || payload.grupo?.nombreGrupo || payload.grupo?.idGrupo || idGrupo;
  const tipoLabel = esAdulto ? "adulto acompañante" : "estudiante";

  const html = `
    <div style="font-family: Arial, Helvetica, sans-serif; color:#222; line-height:1.6;">
      <h2 style="margin-bottom:8px;">Confirmación de inscripción recibida</h2>
      <p>Hemos recibido correctamente la inscripción de <strong>${escapeHtml(nombre)}</strong> como <strong>${escapeHtml(tipoLabel)}</strong>.</p>

      <p><strong>Grupo:</strong> ${escapeHtml(aliasGrupo)}<br>
      <strong>Destino:</strong> ${escapeHtml(destino)}<br>
      <strong>RUT:</strong> ${escapeHtml(payload.identificacion?.rut || "")}</p>

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
      rutNormalizado: payload.identificacion?.rutNormalizado || "",
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
      rutNormalizado: payload.identificacion?.rutNormalizado || "",
      rut: payload.identificacion?.rut || "",
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
// HELPERS DE UI
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

  // Restituir curso del grupo para estudiante
  if ($("cursoViajante") && grupoData?.curso) {
    $("cursoViajante").value = String(grupoData.curso);
  }

  ocultarMensaje();
  aplicarEstadoUI();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// -----------------------------------------------------------------------------
// HELPERS DE DATOS
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

function normalizarRut(rut) {
  return limpiarTexto(rut)
    .replace(/\./g, "")
    .replace(/-/g, "")
    .replace(/\s+/g, "")
    .toUpperCase();
}

function formatearRutVisual(rut) {
  const limpio = normalizarRut(rut);
  if (!limpio || limpio.length < 2) return limpiarTexto(rut);

  const cuerpo = limpio.slice(0, -1);
  const dv = limpio.slice(-1);

  const cuerpoConPuntos = cuerpo.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${cuerpoConPuntos}-${dv}`;
}

function validarRutFlexible(rut) {
  const limpio = normalizarRut(rut);
  if (!/^\d{7,8}[0-9K]$/.test(limpio)) return false;

  const cuerpo = limpio.slice(0, -1);
  const dv = limpio.slice(-1);

  let suma = 0;
  let multiplo = 2;

  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += Number(cuerpo[i]) * multiplo;
    multiplo = multiplo === 7 ? 2 : multiplo + 1;
  }

  const resto = 11 - (suma % 11);
  let dvEsperado = "";

  if (resto === 11) dvEsperado = "0";
  else if (resto === 10) dvEsperado = "K";
  else dvEsperado = String(resto);

  return dv === dvEsperado;
}

function validarCorreo(correo) {
  const v = limpiarTexto(correo);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
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
  const destinoPrincipal = normalizarTexto(
    grupoData?.destinoPrincipal || ""
  );

  const destinoOtro = normalizarTexto(
    grupoData?.destinoPrincipalOtro || ""
  );

  const programa = normalizarTexto(
    grupoData?.programa || ""
  );

  const universo = `${destinoPrincipal} ${destinoOtro} ${programa}`.trim();

  if (!universo) return false;

  // INTERNACIONALES / mixtos con salida del país
  if (universo.includes("bariloche")) return true;
  if (universo.includes("brasil")) return true;
  if (universo.includes("mexico")) return true;
  if (universo.includes("republica dominicana")) return true;
  if (universo.includes("argentina")) return true;
  if (universo.includes("internacional")) return true;

  // Casos mixtos que incluyen Chile + extranjero
  if (universo.includes("sur de chile y bariloche")) return true;
  if (universo.includes("bariloche y sur de chile")) return true;
  if (universo.includes("pucon y bariloche")) return true;

  // Nacionales
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
