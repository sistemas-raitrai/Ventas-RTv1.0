// contrato-template.js
// Plantilla base del contrato Rai Trai.
// Este archivo NO genera el PDF.
// Solo construye el HTML contractual completo con placeholders reemplazables.

export const CONTRATO_TEMPLATE_VERSION = "base_2026_v1";

/* =========================================================
   API PRINCIPAL
========================================================= */

export function buildContratoHtml(data = {}) {
  const v = normalizeContratoData(data);
  const template = getContratoTemplate();

  return replacePlaceholders(template, {
    versionPlantilla: CONTRATO_TEMPLATE_VERSION,

    fechaContratoLarga: escapeHtml(v.fechaContratoLarga),
    ciudadFirma: escapeHtml(v.ciudadFirma),

    razonSocialAgencia: escapeHtml(v.razonSocialAgencia),
    rutAgencia: escapeHtml(v.rutAgencia),
    representanteAgencia: escapeHtml(v.representanteAgencia),
    rutRepresentanteAgencia: escapeHtml(v.rutRepresentanteAgencia),
    domicilioAgencia: escapeHtml(v.domicilioAgencia),

    grupoDescripcionCompleta: escapeHtml(v.grupoDescripcionCompleta),
    cursoActualTexto: escapeHtml(v.cursoActualTexto),
    cursoProyectadoTexto: escapeHtml(v.cursoProyectadoTexto),
    colegio: escapeHtml(v.colegio),
    comuna: escapeHtml(v.comuna),

    nombreGrupo: escapeHtml(v.nombreGrupo),
    apoderadoEncargado: escapeHtml(v.apoderadoEncargado),
    telefono: escapeHtml(v.telefono),
    correo: escapeHtml(v.correo),

    programaNombre: escapeHtml(v.programaNombre),
    destinoPrograma: escapeHtml(v.destinoPrograma),
    fechaViajeTexto: escapeHtml(v.fechaViajeTexto),
    salidaTexto: escapeHtml(v.salidaTexto),
    regresoTexto: escapeHtml(v.regresoTexto),

    cantidadPaxTotal: escapeHtml(v.cantidadPaxTotal),
    cantidadPaxPagados: escapeHtml(v.cantidadPaxPagados),
    liberados: escapeHtml(v.liberados),
    tramo: escapeHtml(v.tramo),

    valorPrograma: escapeHtml(String(v.valorPrograma ?? "")),
    valorProgramaTexto: escapeHtml(v.valorProgramaTexto),
    cuotaInscripcion: escapeHtml(String(v.cuotaInscripcion ?? "")),
    cuotaInscripcionTexto: escapeHtml(v.cuotaInscripcionTexto),
    cuotasTexto: escapeHtml(v.cuotasTexto),
    diferenciaTramoTexto: escapeHtml(v.diferenciaTramoTexto),
    fechaPagoTotalTexto: escapeHtml(v.fechaPagoTotalTexto),

    asistenciaEnViajes: escapeHtml(v.asistenciaEnViajes),
    categoriaHoteleraContratada: escapeHtml(v.categoriaHoteleraContratada),

    numeroNegocio: escapeHtml(v.numeroNegocio),
    nombreVendedor: escapeHtml(v.nombreVendedor),

    delegado1Nombre: escapeHtml(v.delegado1Nombre),
    delegado1Rut: escapeHtml(v.delegado1Rut),
    delegado2Nombre: escapeHtml(v.delegado2Nombre),
    delegado2Rut: escapeHtml(v.delegado2Rut),

    htmlObservacionesOperaciones: v.htmlObservacionesOperaciones,
    htmlObservacionesAdministracion: v.htmlObservacionesAdministracion,
    htmlObservacionesGenerales: v.htmlObservacionesGenerales
  });
}

export function buildContratoHtmlFromFicha(ficha = {}, group = {}) {
  return buildContratoHtml(mapFichaToContratoData(ficha, group));
}

export function mapFichaToContratoData(ficha = {}, group = {}) {
  const anoViaje = cleanText(group?.anoViaje || ficha?.anoViaje || "");
  const anoContrato = cleanText(group?.anoContrato || currentYearString());
  const cursoBase = cleanText(group?.curso || ficha?.curso || "");

  const cursoProyectado = cleanText(
    group?.cursoProyectado || proyectarCursoSimple(cursoBase)
  );

  return {
    fechaContrato: group?.fechaContrato || new Date(),
    ciudadFirma: group?.ciudadFirma || "Santiago de Chile",

    razonSocialAgencia: "TURISMO RAITRAI LIMITADA",
    rutAgencia: "78.384.230-0",
    representanteAgencia: "Carlos Flores Maragaño",
    rutRepresentanteAgencia: "7.844.528-9",
    domicilioAgencia: "La Concepción Nº 141 oficina 305, Santiago",

    cursoActual: cursoBase,
    anoActual: anoContrato,
    cursoProyectado,
    anoProyectado: anoViaje,

    nombreGrupo:
      cleanText(ficha?.nombreGrupo) ||
      cleanText(group?.aliasGrupo) ||
      cleanText(group?.nombreGrupo),

    colegio: cleanText(group?.colegio),
    comuna: cleanText(group?.comunaCiudad || group?.comuna),

    apoderadoEncargado:
      cleanText(ficha?.apoderadoEncargado) ||
      cleanText(group?.nombreCliente),

    telefono:
      cleanText(ficha?.telefono) ||
      cleanText(group?.celularCliente),

    correo:
      cleanText(ficha?.correo) ||
      cleanText(group?.correoCliente),

    programaNombre:
      cleanText(ficha?.nombrePrograma) ||
      cleanText(group?.programaOtro) ||
      cleanText(group?.programa),

    destinoPrograma:
      cleanText(group?.destinoPrincipalOtro) ||
      cleanText(group?.destinoPrincipal) ||
      cleanText(group?.destino),

    fechaViajeTexto:
      cleanText(ficha?.fechaViajeTexto) ||
      cleanText(group?.fechaDeViaje) ||
      cleanText(group?.fechaViaje) ||
      cleanText(group?.mesViaje) ||
      cleanText(group?.semanaViaje),

    salidaTexto:
      cleanText(group?.salidaTexto) ||
      cleanText(group?.fechaSalida) ||
      cleanText(ficha?.fechaViajeTexto) ||
      cleanText(group?.fechaDeViaje) ||
      cleanText(group?.fechaViaje),

    regresoTexto:
      cleanText(group?.regresoTexto) ||
      cleanText(group?.fechaRegreso) ||
      cleanText(ficha?.fechaViajeTexto) ||
      cleanText(group?.fechaDeViaje) ||
      cleanText(group?.fechaViaje),

    cantidadPaxTotal:
      cleanText(ficha?.numeroPaxTotal) ||
      cleanText(group?.cantidadGrupo),

    cantidadPaxPagados:
      cleanText(group?.cantidadPaxPagados) ||
      cleanText(group?.paxPagados) ||
      cleanText(ficha?.numeroPaxTotal) ||
      cleanText(group?.cantidadGrupo),

    liberados:
      cleanText(ficha?.liberados) ||
      cleanText(group?.liberados),

    tramo:
      cleanText(ficha?.tramo) ||
      cleanText(group?.tramo),

    valorPrograma:
      ficha?.valorPrograma ?? group?.valorPrograma ?? "",

    cuotaInscripcion:
      group?.cuotaInscripcion ?? "",

    cuotasTexto:
      cleanText(group?.cuotasTexto),

    diferenciaTramoTexto:
      cleanText(group?.diferenciaTramoTexto),

    fechaPagoTotalTexto:
      cleanText(group?.fechaPagoTotalTexto),

    asistenciaEnViajes:
      cleanText(ficha?.asistenciaEnViajes) ||
      cleanText(group?.asistenciaEnViajes) ||
      cleanText(group?.asistenciaMed),

    categoriaHoteleraContratada:
      cleanText(ficha?.categoriaHoteleraContratada) ||
      cleanText(group?.categoriaHoteleraContratada) ||
      cleanText(group?.hotel) ||
      cleanText(group?.Hotel),

    numeroNegocio:
      cleanText(ficha?.numeroNegocio) ||
      cleanText(group?.numeroNegocio),

    nombreVendedor:
      cleanText(ficha?.nombreVendedor) ||
      cleanText(group?.vendedora),

    delegado1Nombre:
      cleanText(group?.delegado1Nombre),

    delegado1Rut:
      cleanText(group?.delegado1Rut),

    delegado2Nombre:
      cleanText(group?.delegado2Nombre),

    delegado2Rut:
      cleanText(group?.delegado2Rut),

    htmlObservacionesOperaciones:
      ficha?.infoOperacionesHtml ||
      group?.observacionesOperaciones ||
      "",

    htmlObservacionesAdministracion:
      ficha?.infoAdministracionHtml ||
      group?.observacionesAdministracion ||
      "",

    htmlObservacionesGenerales:
      ficha?.observacionesHtml ||
      group?.observacionesFicha ||
      group?.observacionesGenerales ||
      ""
  };
}

export function getContratoMissingFields(data = {}) {
  const v = normalizeContratoData(data);

  const required = [
    ["nombreGrupo", v.nombreGrupo],
    ["colegio", v.colegio],
    ["cursoActualTexto", v.cursoActualTexto],
    ["cursoProyectadoTexto", v.cursoProyectadoTexto],
    ["programaNombre", v.programaNombre],
    ["cantidadPaxTotal", v.cantidadPaxTotal],
    ["valorProgramaTexto", v.valorProgramaTexto],
    ["numeroNegocio", v.numeroNegocio]
  ];

  return required
    .filter(([, value]) => isMissingValue(value))
    .map(([field]) => field);
}

/* =========================================================
   NORMALIZACIÓN
========================================================= */

export function normalizeContratoData(raw = {}) {
  const fechaContrato = toDate(raw.fechaContrato) || new Date();

  const cursoActual = cleanText(raw.cursoActual || raw.curso || "");
  const anoActual = cleanText(raw.anoActual || raw.anoContrato || "");
  const cursoProyectado = cleanText(raw.cursoProyectado || "");
  const anoProyectado = cleanText(raw.anoProyectado || raw.anoViaje || "");

  const cursoActualTexto = buildCursoAnoTexto(cursoActual, anoActual);
  const cursoProyectadoTexto = buildCursoAnoTexto(cursoProyectado, anoProyectado);

  const colegio = cleanText(raw.colegio || "");
  const comuna = cleanText(raw.comuna || raw.comunaCiudad || "");

  const grupoDescripcionCompleta = buildGrupoDescripcionCompleta({
    cursoActualTexto,
    cursoProyectadoTexto,
    colegio,
    comuna
  });

  const valorProgramaRaw = raw.valorPrograma ?? "";
  const cuotaInscripcionRaw = raw.cuotaInscripcion ?? "";

  return {
    fechaContratoLarga: humanDateLong(fechaContrato),
    ciudadFirma: fallbackText(raw.ciudadFirma, "Santiago de Chile"),

    razonSocialAgencia: fallbackText(raw.razonSocialAgencia, "TURISMO RAITRAI LIMITADA"),
    rutAgencia: fallbackText(raw.rutAgencia, "78.384.230-0"),
    representanteAgencia: fallbackText(raw.representanteAgencia, "Carlos Flores Maragaño"),
    rutRepresentanteAgencia: fallbackText(raw.rutRepresentanteAgencia, "7.844.528-9"),
    domicilioAgencia: fallbackText(raw.domicilioAgencia, "La Concepción Nº 141 oficina 305, Santiago"),

    grupoDescripcionCompleta,
    cursoActualTexto: cursoActualTexto || "CURSO NO INFORMADO",
    cursoProyectadoTexto: cursoProyectadoTexto || "CURSO PROYECTADO NO INFORMADO",
    colegio: colegio || "COLEGIO NO INFORMADO",
    comuna: comuna || "COMUNA NO INFORMADA",

    nombreGrupo: fallbackText(raw.nombreGrupo || raw.aliasGrupo || grupoDescripcionCompleta, "GRUPO NO INFORMADO"),
    apoderadoEncargado: fallbackText(raw.apoderadoEncargado || raw.nombreCliente, "NO INFORMADO"),
    telefono: fallbackText(raw.telefono || raw.celularCliente, "NO INFORMADO"),
    correo: fallbackText(raw.correo || raw.correoCliente, "NO INFORMADO"),

    programaNombre: fallbackText(raw.programaNombre || raw.nombrePrograma || raw.programa, "PROGRAMA NO INFORMADO"),
    destinoPrograma: fallbackText(raw.destinoPrograma || raw.destino || raw.destinoPrincipal, "DESTINO NO INFORMADO"),
    fechaViajeTexto: fallbackText(raw.fechaViajeTexto || raw.fechaDeViaje || raw.fechaViaje, "NO INFORMADA"),
    salidaTexto: fallbackText(raw.salidaTexto || raw.salidaViaje || raw.fechaSalida || raw.fechaViajeTexto, "NO INFORMADA"),
    regresoTexto: fallbackText(raw.regresoTexto || raw.regresoViaje || raw.fechaRegreso || raw.fechaViajeTexto, "NO INFORMADA"),

    cantidadPaxTotal: fallbackText(raw.cantidadPaxTotal || raw.numeroPaxTotal || raw.cantidadGrupo, "NO INFORMADO"),
    cantidadPaxPagados: fallbackText(raw.cantidadPaxPagados || raw.paxPagados || raw.numeroPaxPagados || raw.cantidadGrupo, "NO INFORMADO"),
    liberados: fallbackText(raw.liberados, "NO INFORMADO"),
    tramo: fallbackText(raw.tramo, "NO INFORMADO"),

    valorPrograma: valorProgramaRaw,
    valorProgramaTexto: formatMoneyMaybe(valorProgramaRaw, "NO INFORMADO"),
    cuotaInscripcion: cuotaInscripcionRaw,
    cuotaInscripcionTexto: cuotaInscripcionRaw !== "" ? formatMoneyMaybe(cuotaInscripcionRaw, "NO INFORMADA") : "NO INFORMADA",
    cuotasTexto: fallbackText(raw.cuotasTexto, "NO INFORMADAS"),
    diferenciaTramoTexto: fallbackText(raw.diferenciaTramoTexto, "NO INFORMADA"),
    fechaPagoTotalTexto: fallbackText(raw.fechaPagoTotalTexto, "NO INFORMADA"),

    asistenciaEnViajes: fallbackText(raw.asistenciaEnViajes, "NO INFORMADA"),
    categoriaHoteleraContratada: fallbackText(raw.categoriaHoteleraContratada || raw.hotel, "NO INFORMADA"),

    numeroNegocio: fallbackText(raw.numeroNegocio, "NO INFORMADO"),
    nombreVendedor: fallbackText(raw.nombreVendedor || raw.vendedora, "NO INFORMADO"),

    delegado1Nombre: cleanText(raw.delegado1Nombre || ""),
    delegado1Rut: cleanText(raw.delegado1Rut || ""),
    delegado2Nombre: cleanText(raw.delegado2Nombre || ""),
    delegado2Rut: cleanText(raw.delegado2Rut || ""),

    htmlObservacionesOperaciones: normalizeRichHtml(raw.htmlObservacionesOperaciones || raw.observacionesOperaciones || ""),
    htmlObservacionesAdministracion: normalizeRichHtml(raw.htmlObservacionesAdministracion || raw.observacionesAdministracion || ""),
    htmlObservacionesGenerales: normalizeRichHtml(raw.htmlObservacionesGenerales || raw.observacionesGenerales || raw.observacionesFicha || "")
  };
}

/* =========================================================
   PLANTILLA BASE
========================================================= */

function getContratoTemplate() {
  return `
  <article class="contrato-doc" data-template-version="{{versionPlantilla}}">
    <section class="contrato-titulo">
      <h1>CONTRATO DE PRESTACIÓN DE SERVICIOS TURÍSTICOS</h1>
    </section>

    <section class="contrato-parrafo">
      <p>
        En {{ciudadFirma}}, {{fechaContratoLarga}}, entre {{razonSocialAgencia}}, Rut {{rutAgencia}},
        en adelante también "La Agencia", representada por su Gerente General, {{representanteAgencia}},
        chileno, cédula nacional de identidad número {{rutRepresentanteAgencia}}, domiciliado en
        {{domicilioAgencia}}, en adelante “LA AGENCIA”, por una parte y por la otra
        {{grupoDescripcionCompleta}}, representado por las personas cuyos nombres se incluyen al final del
        presente instrumento, en adelante “El Grupo”, se conviene el contrato de prestación de servicios
        turísticos que se describe en las cláusulas siguientes:
      </p>
    </section>

    <section class="contrato-clausula">
      <h2>PRIMERO:</h2>
      <p>
        La agencia y el grupo han acordado la realización de un programa de viajes de estudios para sus pupilos
        que se detalla en anexo N° 1, N° 2, N° 3, los cuales formarán parte del contrato para todos los efectos
        legales, el cual es firmado por la Agencia y los representantes del grupo.
      </p>
      <p>Anexo 1: Programa contratado con el detalle de lo que “Incluye” y “No Incluye”.</p>
      <p>Anexo 2: Copia de los términos y condiciones del servicio de “Asistencia en viaje”.</p>
      <p>Anexo 3: Copia de los términos y condiciones del servicio de “Seguro cancelación previo a la salida”.</p>
    </section>

    <section class="contrato-clausula">
      <h2>SEGUNDO: OBLIGACIONES DE LA AGENCIA.</h2>

      <p><strong>a)</strong> Informar y asesorar a los participantes del grupo en todo lo relacionado a lo que el viaje se refiere, además complementará con documentos escritos los siguientes informativos:</p>

      <ul>
        <li>Documento Instructivo pago de giras</li>
        <li>Documento listado de pasajeros</li>
        <li>Documento solicitud casos especiales</li>
        <li>Documento instructivo salida de menores del país cuando corresponda</li>
        <li>Documento de Distribución de Habitaciones</li>
        <li>Documento de Confirmación del viaje</li>
        <li>Documento guía de Viaje</li>
        <li>Documento carta de responsabilidad y compromiso adultos acompañantes y apoderado designado o representante</li>
      </ul>

      <p><strong>b)</strong> Organización y desarrollo del Viaje de estudios en los términos estipulados.</p>

      <p>Respecto a este punto, la Agencia podrá introducir cambios en las rutas y horarios previamente establecidos por las siguientes razones:</p>

      <ul>
        <li>De caso fortuito y de fuerza mayor, cuando pudieran afectar la seguridad de los integrantes del grupo.</li>
        <li>Aquellas destinadas a mejorar el cumplimiento de los objetivos previstos, siempre y cuando sean acordadas por el representante de la Agencia y los representantes del grupo.</li>
      </ul>

      <p>
        En estos casos ambas partes podrán acordar una nueva actividad en reemplazo, que no genere nuevos costos,
        que pudieren significar un valor mayor al precio del programa contratado. En caso que la actividad de
        reemplazo genere un nuevo sobrecosto al pactado, el grupo se obligará a pagar dicha diferencia de manera inmediata.
      </p>

      <p><strong>c)</strong> Efectuar las reservas y reconfirmaciones correspondientes a los distintos servicios turísticos, tales como pasajes aéreos si fuera el caso, transporte terrestre, hoteles u otros establecimientos necesarios, para el adecuado desarrollo del programa.</p>

      <p><strong>d)</strong> Designar un representante de Raitrai que acompañe al grupo, que ejercerá funciones de coordinador del grupo, y que se encargará de velar por el adecuado cumplimiento del programa del viaje contratado, y que proporcionará asistencia frente a cualquier problema o emergencia de los pasajeros.</p>

      <p><strong>e)</strong> El transporte de los pasajeros se realizará en los medios de transporte pactados en el Anexo N° 1. El transporte terrestre se realizará en bus de Turismo, a cargo de conductores profesionales, quienes en todo momento tienen especiales instrucciones de respetar estrictamente todas las normas legales y reglamentarias pertinentes. Especial mención merece la decisión de la Agencia de velar para que los conductores no excedan el máximo de horas continuas permitidas.</p>

      <p>
        En el evento que el vehículo terrestre sufriera un desperfecto mecánico que impidiera la continuación del
        programa, la Agencia se obliga a reemplazarlo por un vehículo de características similares en el menor
        plazo posible, siendo de cargo de la Agencia los gastos que fueran necesarios para el cumplimiento del programa.
      </p>
    </section>

    <section class="contrato-clausula">
      <h2>TERCERO: OBLIGACIONES DE LOS APODERADOS DE CADA ALUMNO</h2>

      <p>Representados para efectos de negociación del Programa y servicios contratados por los DELEGADOS DESIGNADOS.</p>

      <p><strong>a) Pago del Valor Programa:</strong> Esta responsabilidad será de cargo del representante y/o Apoderado, de cada alumno integrante del grupo que viaja, respondiendo personalmente por los compromisos que adquiera para estos efectos con la AGENCIA. Pagando mensualmente las cuotas ofrecidas por Turismo Raitrai.</p>

      <p><strong>b) Firma de contrato:</strong> El presente contrato podrá formalizarse mediante una de las siguientes dos modalidades. En ambos casos, la aceptación de sus condiciones se entenderá válida desde el momento en que el apoderado realice el primer pago, sea este la cuota de inscripción o cualquier otro abono asociado al viaje.</p>

      <p><strong>b1.- Firmado por los delegados designados en representación del grupo:</strong> La firma del presente contrato por parte de los delegados designados no implica responsabilidad económica individual para ellos. Actúan exclusivamente como representantes del grupo ante la Agencia, y su firma respalda y ratifica que todos los apoderados integrantes del grupo conocen y aceptan íntegramente las condiciones aquí estipuladas.</p>

      <p><strong>b2.- Firmado individualmente por cada apoderado:</strong> Cada apoderado dispondrá de un plazo de 15 días para firmar personalmente el contrato en las oficinas de Turismo Raitrai. En caso de no hacerlo, pero realizar uno o más pagos a la Agencia, se entenderá que acepta todas las condiciones contenidas en este contrato, sin necesidad de firma adicional.</p>

      <p><strong>c) Tramo pactado:</strong> Para dar consistencia al tramo pactado, los delegados del grupo deberán remitir una nómina con los nombres de los participantes del viaje utilizando el formato oficial de Turismo Raitrai. El plazo máximo de envío de este documento es 15 días hábiles después de firmado el contrato.</p>

      <p><strong>d) Repartición de Liberados:</strong> Los liberados podrán asignarse en porcentajes de 25%, 50% o 100%. Los cupos correspondientes a liberados del 100% del valor del programa deberán ser designados y respaldados al momento de enviar la nómina inicial o, como plazo máximo, hasta el 15 de marzo del año del viaje, indicando obligatoriamente el sexo del pasajero para coordinar el tipo de habitación. Los nombres de los pasajeros con liberación del 100% deberán ser informados 90 días antes de la fecha de salida del viaje. En el caso de los estudiantes que reciban un porcentaje de liberación (25% o 50%), esta condición deberá ser informada en la nómina de pasajeros. Todos los pasajeros deberán abonar la cuota de inscripción, excepto aquellos que cuenten con liberación del 100%.</p>

      <p><strong>e) Cumplimiento de fechas:</strong> El cumplimiento en las fechas establecidas para la entrega de información requerida por la AGENCIA es de exclusiva responsabilidad de los delegados y apoderados o representantes legales de cada alumno.</p>

      <p><strong>f) Documentación de viaje:</strong> Conocer y tener la documentación legal necesaria para que los estudiantes puedan salir del país e ingresar a los países durante el viaje es de exclusiva responsabilidad de cada uno de los apoderados o representantes legales de cada alumno.</p>

      <p><strong>g) Comunicación y monitoreo:</strong> Los Delegados de los grupos tienen la responsabilidad de transmitir toda la información que la AGENCIA entregue relativa al viaje. Además, se les proporcionará una clave especial para que tengan acceso a monitorear el estado de pago general del grupo.</p>

      <p>
        Cada apoderado es responsable de informarse de todas las cláusulas de este contrato sin excepción alguna,
        y sus obligaciones deben cumplirse. De lo contrario, Turismo Raitrai podrá, a su arbitrio y sin
        responsabilidad para ella, excluir al alumno que no cumpla con los tiempos pactados por el grupo y la
        agencia, y modificar el precio del presente contrato, adecuándolo a la nueva cantidad de estudiantes.
      </p>
    </section>

    <section class="contrato-clausula">
      <h2>CUARTO: RELATIVO A LA SALIDA DEL PAÍS.</h2>

      <p>Todos los estudiantes menores de edad (que a la fecha de salida del país no hayan cumplido 18 años de edad), necesitan ser autorizados notarialmente por ambos padres o por quien tenga la tuición legal del menor, para poder salir del país.</p>

      <p>El día de salida -inicio del viaje- los pasajeros menores de edad deben presentarse con:</p>

      <ul>
        <li>Cédula de identidad o Pasaporte al día y en buenas condiciones.</li>
        <li>Autorización Notarial de ambos padres o Tutor, en triplicado, autorizándolos a salir del país en gira de estudios. Se les enviará instructivo especial para tal documento.</li>
        <li>Triplicado de Certificado de nacimiento donde conste la identidad de los padres.</li>
      </ul>

      <p>
        TURISMO RAITRAI declina toda responsabilidad por eventuales inconvenientes que puedan surgir respecto a la
        salida del país de menores de edad o adultos, ya sea por falta de documentación, autorizaciones u otros
        motivos. En tales casos, los pasajeros no tendrán derecho a devolución alguna.
      </p>
    </section>

    <section class="contrato-clausula">
      <h2>QUINTO: RESPONSABILIDADES.</h2>

      <p><strong>a) Horarios de transporte:</strong> Los cambios en los itinerarios pueden estar sujetos a modificaciones sin previo aviso, siendo tales cambios de exclusiva responsabilidad de la compañía aérea respectiva.</p>

      <p><strong>b) Equipaje:</strong></p>
      <p>
        La seguridad e integridad del equipaje transportado en avión, tren, barco o bus es de responsabilidad
        exclusiva de las compañías respectivas y de sus usuarios. Asimismo, todas las pertenencias de valor deben
        ser guardadas en las cajas fuertes de los hoteles cuando estén disponibles, siendo responsabilidad
        exclusiva de los pasajeros hacerlo.
      </p>
      <p>
        La pérdida, extravío, deterioro o robo de pertenencias como celulares, ropa, calzado, gafas u otros
        objetos personales será responsabilidad única de quien las porte.
      </p>
      <p>
        Sin perjuicio de lo anterior, TURISMO RAITRAI brindará la asistencia adecuada dentro de sus facultades
        operativas para orientar, gestionar o colaborar en la resolución de dichos casos, actuando con buena fe y
        disposición, sin que ello implique asumir responsabilidad por los hechos ocurridos.
      </p>

      <p><strong>c) Seguridad de los estudiantes:</strong></p>
      <p>
        Es de responsabilidad común de las partes. No obstante, las responsabilidades que se originen en una
        conducta inadecuada de los estudiantes, adultos acompañantes y apoderado designado como representante del
        grupo, recae en LOS PADRES Y/O APODERADOS ACOMPAÑANTES Y APODERADO DESIGNADO, sin perjuicio de la que
        individualmente pueda corresponder al o los autores directos.
      </p>
      <p>
        Se deja expresa constancia que, sin perjuicio de lo dispuesto precedentemente, serán de exclusiva
        responsabilidad de los estudiantes, padres y/o apoderados la contratación de servicios adicionales y/o la
        realización de actividades que no se encuentren expresamente consideradas en el programa contratado. Por lo
        cual no podrá imputársele responsabilidad a TURISMO RAITRAI LIMITADA por cualquier hecho fortuito,
        culpable o doloso que cause daños o perjuicios a los estudiantes, representantes legales y/o apoderados y
        que sea consecuencia o se relacione directamente con tales servicios o actividades.
      </p>

      <p><strong>d) Delegados designados y/o adultos acompañantes:</strong> Serán designados por el grupo y deberán firmar una “carta de responsabilidad y compromiso” para el buen desarrollo del viaje. Se comprometen a velar por el cuidado, la conducta, el orden y la disciplina de los estudiantes con el fin de asegurar el normal cumplimiento del programa de viaje y son las personas que acompañan a los menores frente a situaciones médicas, pérdida de documentos, etc. En caso de presentarse situaciones de indisciplina por parte de los estudiantes, el representante de TURISMO RAITRAI no aplicará sanciones ni medidas disciplinarias, limitándose únicamente a informar los hechos a los representantes de los apoderados correspondientes.</p>

      <p><strong>e) Habitaciones para delegados designados y adultos acompañantes:</strong> Están fijadas según tramo. Siempre las habitaciones serán dobles o triples. Sobre 30 pasajeros 100% pagados se asignan 02 habitaciones para estos fines. Con menos de 30 pasajeros 100% pagados, se asigna 01 habitación para estos fines. Por política de la empresa, no está permitido que los adultos compartan habitación con los menores salvo en “casos especiales”, los cuales deberán ser informados y autorizados previamente por la agencia. Pasajeros que pagan el 100% del viaje quedan sujetos a estas condiciones.</p>

      <p><strong>f) Daños o desperfectos por estudiantes o acompañantes del grupo:</strong></p>
      <p>
        Cualquier daño, desperfecto o deterioro parcial de partes, piezas, instalaciones o accesorios de los
        medios de transporte o de los establecimientos comerciales, hoteles, restaurantes u otros que presten los
        servicios previstos en el programa, serán de responsabilidad de sus autores.
      </p>
      <p>
        Todos los gastos que se generen como consecuencia de acciones u omisiones de los estudiantes serán de cargo
        de LOS PADRES, APODERADOS, O REPRESENTANTE LEGAL correspondiente a cada uno de LOS ESTUDIANTES.
      </p>

      <p><strong>h) Actividades adicionales al programa:</strong> El programa deberá cumplirse en los términos estipulados. En todo caso, el representante de la Agencia podrá convenir con el o los representantes del grupo otras actividades adicionales al programa, siempre y cuando no afecte el desarrollo del programa pactado y sean consideradas apropiadas por las partes. Estas ampliaciones del programa original serán de exclusivo cargo del grupo.</p>
    </section>

    <section class="contrato-clausula">
      <h2>SEXTO: ASISTENCIA EN VIAJES Y SEGUROS.</h2>

      <p>
        Los participantes del programa serán beneficiados con los seguros correspondientes a los medios de
        transporte de pasajeros, así como también por el servicio de “Asistencia en viaje” descrita en el Anexo
        Nº 2, el “Seguro de cancelación previo a la salida del viaje” descrito en el Anexo N° 3, y el “Seguro de
        cancelación Any Reason” (ver cláusula en el artículo Décimo Primero, punto H).
      </p>

      <p>
        TURISMO RAITRAI no tendrá responsabilidad por el pago de los deducibles ni por cantidades que excedan el
        límite de las coberturas establecidas en dichos seguros. La liquidación de estas coberturas y el pago de
        las asistencias se efectuarán directamente por las entidades aseguradoras que correspondan, conforme a sus
        propias condiciones.
      </p>

      <p>
        Sin perjuicio de lo anterior, la Agencia prestará apoyo activo dentro de sus competencias para asistir al
        grupo en la gestión de estas coberturas, facilitar los trámites correspondientes, y acompañar al afectado
        en situaciones de emergencia o necesidad, actuando con la máxima disposición y buena fe operativa.
      </p>
    </section>

    <section class="contrato-clausula">
      <h2>SÉPTIMO: PRECIO DEL VIAJE DE ESTUDIO</h2>

      <p>
        El Viaje de Estudios tendrá un costo de U$ {{valorProgramaTexto}}, establecido en el Anexo N°1, en la base
        mínima de {{cantidadPaxPagados}} pasajeros pagados más {{liberados}} pasajeros liberados.
      </p>

      <p>
        Se acuerda que el abono establecido por concepto de cuota de inscripción de U$ {{cuotaInscripcionTexto}} pp,
        tendrá fecha de pago máxima {{fechaPagoTotalTexto}} con el fin de establecer el tramo contratado por los
        representantes del grupo. De otra manera, TURISMO RAITRAI se reserva el derecho de cambiar el tramo al
        valor del programa establecido según el mínimo de pasajeros pagados que hayan pagado íntegramente este
        contrato y por lo tanto se informará a los Delegados el nuevo valor.
      </p>

      <p>
        Es condición esencial que el precio pactado se encuentre totalmente pagado a plena satisfacción de la
        Agencia 60 días antes de salida. De lo contrario, la Agencia podrá cancelar la reserva y aplicar penalidades.
      </p>
    </section>

    <section class="contrato-clausula">
      <h2>OCTAVO: ATRASOS EN LOS PAGOS</h2>

      <p>
        Todo pasajero que documente o cancele total o parcialmente el viaje fuera del plazo acordado estará sujeto
        a las variaciones de precio que pudieran producirse.
      </p>

      <p>
        En caso de incumplimiento de los pagos pactados, Turismo Raitrai tiene la facultad de dar de baja al
        alumno y disponer del cupo no utilizado.
      </p>
    </section>

    <section class="contrato-clausula">
      <h2>NOVENO: DETALLE DE LA FORMA DE PAGO:</h2>

      <p>
        ABONO, O CUOTA DE INSCRIPCIÓN convenido en la cantidad de U$ {{cuotaInscripcionTexto}}.
        Este valor será descontado del saldo total a pagar del viaje. No es reembolsable ni transferible.
      </p>

      <p>
        La forma de pago que ofrece TURISMO RAITRAI se hace referencia en este instrumento y en anexo N°1, el cual
        asciende a la suma de U$ {{valorProgramaTexto}} por cada pasajero y que se paga de la siguiente manera:
      </p>

      <p><strong>{{cuotasTexto}}</strong></p>
      <p><strong>Diferencia tramo:</strong> {{diferenciaTramoTexto}}</p>

      <p>
        En caso de incumplir con el pago de dos o más cuotas consecutivas, Turismo Raitrai podrá considerar que el
        pasajero renuncia al viaje. Se notificará al apoderado por escrito, otorgándole 5 días corridos para
        regularizar los pagos. Si no se realiza el pago dentro de ese plazo, Turismo Raitrai podrá aplicar el
        proceso de anulación y devolución según las condiciones del contrato.
      </p>

      <p>
        El apoderado se compromete a pagar el monto total en mensualidades sin intereses, siendo los pagos
        puntuales dentro de los 30 días de cada mes.
      </p>

      <p>
        Hasta el 15 de marzo del año del viaje, se pueden agregar pasajeros al viaje ajustando el valor al nuevo
        tramo en beneficio del grupo.
      </p>

      <p>
        Después del 15 de marzo del año del viaje, la suma de nuevos pasajeros no tendrá ajuste de valor en
        beneficio del grupo.
      </p>

      <p>
        La baja de pasajeros puede modificar el valor y tramo, y el grupo asumirá la diferencia en una cuota adicional.
      </p>

      <p><strong>b) OTRAS FORMAS QUE PUEDE SER PAGADO EL VIAJE</strong></p>
      <ol>
        <li>Pesos Chilenos, dólares y cheques.</li>
        <li>Webpay a través de la página web www.raitrai.cl</li>
        <li>3% de descuento en el mes de la contratación por pago contado. (Solo transferencia, efectivo o cheque al día). (Se excluye pago con tarjetas de crédito y/débito).</li>
        <li>Todas las tarjetas de crédito bancarias, con “cuotas” precio contado según banco.</li>
      </ol>

      <p><strong>Nota:</strong> Pagada la inscripción el apoderado deberá realizar los pagos mensuales para mantener el cupo.</p>
    </section>

    <section class="contrato-clausula">
      <h2>DÉCIMO: TIPO DE CAMBIO</h2>
      <p>Todos los pagos y reembolsos expresados en moneda extranjera serán establecidos por el área de administración de TURISMO RAITRAI.</p>
    </section>

    <section class="contrato-clausula">
      <h2>DÉCIMO PRIMERO: POLÍTICAS DE ANULACIÓN</h2>

      <p>Para el efecto de anulación individual o colectiva del presente contrato de prestación de servicios antes de la ejecución del programa, las partes se sujetan a las siguientes disposiciones:</p>

      <p><strong>a)</strong> En el evento de anulación tanto individual como colectiva, se retendrá el valor correspondiente a la cuota de inscripción, que está fijada en U$ {{cuotaInscripcionTexto}}, no es reembolsable ni transferible sin excepción alguna.</p>

      <p>
        La anulación deberá ser solicitada por escrito mediante correo electrónico a su asesor de viajes, con copia
        al encargado del grupo. Una vez recibida, la Agencia confirmará su recepción y asignará un número de caso,
        el cual será requisito para dar por oficializada la solicitud.
      </p>

      <p>
        En el caso de una anulación colectiva, y para efectos de devolución, el grupo debe cumplir con el 100% del
        pago de la cuota de inscripción de todos los pasajeros según el tramo contratado, además de las otras
        cláusulas según corresponda.
      </p>

      <p><strong>B.1) EN CASO DE VUELOS A BRASIL Y BARILOCHE:</strong></p>
      <p>Si la anulación se produce con 180 días de anticipación a la fecha de salida, se retendrá:</p>
      <ul>
        <li>USD 550 por pasajero para programas con destino a Brasil.</li>
        <li>USD 350 por pasajero para programas con destino a Bariloche.</li>
      </ul>
      <p>A lo anterior se sumará el valor de la cuota de inscripción.</p>

      <p><strong>B.2) EN CASO DE VUELOS REGULARES:</strong></p>
      <p>Se retendrán todos los costos asociados a reservas de servicios del programa, además del valor de la cuota de inscripción.</p>

      <p><strong>C)</strong> Si el programa incluye prepagos o abonos por concepto de hoteles, excursiones u otros servicios, y estos ya han sido efectuados por la agencia, se retendrá además el monto que cobre el prestador del servicio por concepto de anulación.</p>

      <p><strong>D)</strong> En caso de anulación efectuada entre 90 y 61 días antes de la salida, se retendrá un 20 % del valor total del programa, además de lo dispuesto en las letras a) y b.1) o b.2), según corresponda.</p>

      <p><strong>E)</strong> En caso de anulación efectuada entre 60 y 45 días antes de la salida, se retendrá un 50 % del valor total del programa, además de lo dispuesto en las letras a) y b.1) o b.2), según corresponda.</p>

      <p><strong>F)</strong> En caso de anulación efectuada entre 44 y 31 días antes de la salida, se retendrá un 60 % del valor total del programa, además de lo dispuesto en las letras a) y b.1) o b.2), según corresponda.</p>

      <p><strong>G)</strong> En caso de anulación efectuada con menos de 30 días de anticipación a la salida, se retendrá el 100 % del valor total del programa pactado, sin derecho a reembolso.</p>

      <p><strong>H)</strong> El grupo cuenta con dos beneficios (seguros): el seguro previo a la salida y el seguro “Any Reason”.</p>

      <p><strong>Anulación “Any Reason” (por cualquier motivo):</strong> Este contrato incluye un beneficio de anulación por cualquier motivo, bajo las siguientes condiciones:</p>

      <ul>
        <li>El beneficio no aplica durante los últimos 7 días previos a la salida del programa.</li>
        <li>La anulación no debe afectar el mínimo de pasajeros pactado.</li>
        <li>El programa debe encontrarse íntegramente pagado.</li>
      </ul>

      <p>
        En caso de cumplirse las condiciones anteriores, se aplicará un deducible del 50 % del valor total del
        programa, sin embargo, la cuota de inscripción no será devuelta bajo ninguna circunstancia.
      </p>

      <p><strong>I)</strong> El valor definitivo del programa está basado en un mínimo de {{cantidadPaxPagados}} pasajeros íntegramente pagados + {{liberados}} pasajero(s) liberado(s).</p>

      <p><strong>J)</strong> Si con una antelación de 60 días a la salida del viaje el grupo no tuviera pagado la cantidad de pasajeros convenida, el valor del programa se adecuará al tramo que corresponda, debiendo los apoderados pagar de manera inmediata las diferencias que puedan producirse, respetando siempre el mínimo de pasajeros establecidos.</p>
    </section>

    <section class="contrato-clausula">
      <h2>DÉCIMO SEGUNDO: INCORPORACIÓN DE NUEVOS PASAJEROS (LISTA DE ESPERA)</h2>

      <p>
        Toda solicitud de incorporación de nuevos estudiantes o acompañantes una vez confirmada la nómina oficial del
        grupo será gestionada exclusivamente a través del procedimiento interno de Lista de Espera de TURISMO RAITRAI.
      </p>

      <p>
        Dicho procedimiento contempla requisitos y condiciones específicas que serán informadas al solicitante al
        momento de iniciar el proceso, incluyendo —pero no limitado a— la disponibilidad de cupos, tiempos
        operativos, confirmación por parte de prestadores de servicios (aéreos y/o terrestres), y los valores
        vigentes al momento de la solicitud.
      </p>

      <p>La inclusión en la Lista de Espera no implica aceptación automática, ni garantiza el mismo valor ni condiciones pactadas previamente para el grupo.</p>

      <p>Cada solicitud será formalizada mediante la asignación de un número de caso, conforme al sistema interno de gestión de TURISMO RAITRAI.</p>
    </section>

    <section class="contrato-clausula">
      <h2>DÉCIMO TERCERO: CUPOS DADOS DE BAJA</h2>

      <p>
        Todo cupo que sea dado de baja por el grupo, por cualquier motivo, pasará automáticamente a ser de libre
        disposición de TURISMO RAITRAI. Una vez liberado, el cupo podrá ser asignado a cualquier otro grupo o
        pasajero según disponibilidad y criterio de la empresa, entendiéndose que el grupo pierde definitivamente
        todo derecho sobre dicho cupo.
      </p>
    </section>

    <section class="contrato-clausula">
      <h2>DÉCIMO CUARTO: CASO FORTUITO O FUERZA MAYOR</h2>

      <p>
        De acuerdo con el artículo 45 del Código Civil, se entiende por fuerza mayor o caso fortuito aquel suceso
        imprevisto, irresistible y ajeno a la voluntad de las partes, que impide o dificulta el cumplimiento de
        las obligaciones contractuales.
      </p>

      <p><strong>Caso fortuito:</strong> Son eventos que tienen su origen en la naturaleza y que resultan inevitables e imprevisibles, tales como terremotos, inundaciones, huracanes, lluvias, vientos y otros fenómenos naturales que impiden el cumplimiento de una obligación.</p>

      <p><strong>Fuerza mayor:</strong> Se refiere a hechos de origen humano o externo, que, aunque son inevitables, provienen de actos de terceros o de la autoridad pública y que dificultan o impiden cumplir con las obligaciones contractuales.</p>

      <p>
        Ninguna de las partes será responsable por el incumplimiento, retraso o cancelación de sus obligaciones
        cuando estos se produzcan por caso fortuito, fuerza mayor o cualquier otra circunstancia fuera del control
        razonable de ambas partes, tales como guerras, pandemias, protestas civiles, actos terroristas, huelgas,
        decisiones de autoridades gubernamentales, fenómenos climáticos, o razones de seguridad.
      </p>

      <p>
        En caso de que cualquiera de las partes se vea imposibilitada para cumplir sus obligaciones contractuales
        por alguna de estas causas, TURISMO RAITRAI, en coordinación con LOS DELEGADOS y/o ACOMPAÑANTES DEL GRUPO,
        deberán acordar una nueva fecha para la realización del viaje de estudios si este no ha comenzado, o
        determinar la mejor forma de continuar el viaje si ya está en curso.
      </p>

      <p>
        Los gastos adicionales que puedan surgir como consecuencia de estos eventos, tales como contratación de
        servicios no previstos en el programa original, serán responsabilidad de los apoderados, quienes deberán
        efectuar su pago inmediato a TURISMO RAITRAI para garantizar la correcta prestación de dichos servicios.
      </p>
    </section>

    <section class="contrato-clausula">
      <h2>DÉCIMO QUINTO: SOLUCIÓN Y CONTROVERSIAS</h2>
      <p>
        Toda dificultad que surja entre las partes sobre la validez, interpretación, cumplimiento o incumplimiento
        de este contrato será resuelta aplicando las leyes chilenas, por un árbitro arbitrador designado por ellas
        de común acuerdo; sin embargo, cada parte podrá solicitar por escrito la designación del árbitro a la Cámara
        de Comercio de Santiago A.G., de entre los árbitros que integren la nómina del Centro de Arbitrajes de dicha
        Cámara y conforme a su Reglamento, que las partes declaran conocer y aceptar. El árbitro queda especialmente
        facultado para resolver todo asunto relacionado con su competencia o jurisdicción. La sede del arbitraje
        será la ciudad de Santiago.
      </p>
    </section>

    <section class="contrato-clausula">
      <h2>DÉCIMO SEXTO: COMPROMISO ÉTICO</h2>

      <p>
        Nuestra empresa declara su apoyo a la campaña iniciada desde hace algunos años por diversas entidades, tales
        como OTM, UNICEF o UNTWO, que tienen entre sus objetivos tomar iniciativas para resguardar la integridad
        física y moral de los seres humanos, especialmente de los menores, desarrollando las siguientes acciones:
      </p>

      <ul>
        <li>Nuestros paquetes turísticos NO promueven el turismo sexual en ninguna de sus vertientes.</li>
        <li>Adherirnos a las normativas legales referentes a materias sobre explotación de seres humanos, especialmente menores, tanto a nivel nacional como internacional.</li>
        <li>Formamos a nuestro personal en materia de prevención de la explotación de seres humanos, capacitándolos en las medidas de prevención que toma la empresa.</li>
      </ul>
    </section>

    <section class="contrato-clausula">
      <h2>DÉCIMO SÉPTIMO: PROTECCIÓN DE DATOS PERSONALES</h2>

      <p>
        El grupo y sus representantes autorizan expresamente a TURISMO RAITRAI LIMITADA a recolectar, almacenar y
        tratar los datos personales que sean necesarios para la correcta ejecución del presente contrato, conforme a
        la Ley Nº 19.628 sobre Protección de la Vida Privada.
      </p>

      <p>
        Estos datos podrán ser utilizados únicamente para fines operativos, administrativos y de comunicación
        relacionados con el viaje contratado, incluyendo la entrega de información a prestadores de servicios
        turísticos (transportistas, hoteles, aseguradoras u otros) cuando sea necesario.
      </p>

      <p>
        TURISMO RAITRAI se compromete a resguardar la confidencialidad de esta información, no cederla a terceros
        para fines distintos a los expresamente indicados, y permitir a los titulares ejercer sus derechos de
        acceso, rectificación, cancelación y oposición conforme a la ley.
      </p>
    </section>

    <section class="contrato-clausula">
      <h2>DÉCIMO OCTAVO</h2>
      <p>
        La salida para el cumplimiento del programa acordado está fijada para {{salidaTexto}} desde el aeropuerto
        de Santiago. Regreso {{regresoTexto}} al mismo lugar de la salida.
      </p>
    </section>

    <section class="contrato-clausula">
      <h2>DÉCIMO NOVENO</h2>
      <p>
        Para todos los efectos legales las partes fijan su domicilio en la ciudad de Santiago, comuna de
        Providencia. Se suscribe en DOS ejemplares, queda uno en poder de TURISMO RAITRAI y otro en poder de los
        DELEGADOS DESIGNADOS POR EL GRUPO.
      </p>
    </section>

    <section class="contrato-clausula contrato-resumen-comercial">
      <h2>RESUMEN COMERCIAL DEL GRUPO</h2>
      <div class="contrato-box">
        <p><strong>Grupo:</strong> {{nombreGrupo}}</p>
        <p><strong>Curso actual:</strong> {{cursoActualTexto}}</p>
        <p><strong>Curso proyectado:</strong> {{cursoProyectadoTexto}}</p>
        <p><strong>Colegio:</strong> {{colegio}}</p>
        <p><strong>Comuna:</strong> {{comuna}}</p>
        <p><strong>Programa:</strong> {{programaNombre}}</p>
        <p><strong>Destino:</strong> {{destinoPrograma}}</p>
        <p><strong>Fecha viaje:</strong> {{fechaViajeTexto}}</p>
        <p><strong>Pax total:</strong> {{cantidadPaxTotal}}</p>
        <p><strong>Pax pagados:</strong> {{cantidadPaxPagados}}</p>
        <p><strong>Liberados:</strong> {{liberados}}</p>
        <p><strong>Tramo:</strong> {{tramo}}</p>
        <p><strong>Valor programa:</strong> U$ {{valorProgramaTexto}}</p>
        <p><strong>Cuota inscripción:</strong> U$ {{cuotaInscripcionTexto}}</p>
        <p><strong>Forma de pago:</strong> {{cuotasTexto}}</p>
        <p><strong>Asistencia en viajes:</strong> {{asistenciaEnViajes}}</p>
        <p><strong>Categoría hotelera:</strong> {{categoriaHoteleraContratada}}</p>
        <p><strong>Apoderado / responsable:</strong> {{apoderadoEncargado}}</p>
        <p><strong>Teléfono:</strong> {{telefono}}</p>
        <p><strong>Correo:</strong> {{correo}}</p>
        <p><strong>Número de negocio:</strong> {{numeroNegocio}}</p>
        <p><strong>Ejecutivo responsable:</strong> {{nombreVendedor}}</p>
      </div>
    </section>

    <section class="contrato-clausula contrato-observaciones">
      <h2>OBSERVACIONES DEL DOCUMENTO</h2>

      <div class="contrato-box">
        <h3>Operaciones</h3>
        {{htmlObservacionesOperaciones}}
      </div>

      <div class="contrato-box">
        <h3>Administración</h3>
        {{htmlObservacionesAdministracion}}
      </div>

      <div class="contrato-box">
        <h3>Generales</h3>
        {{htmlObservacionesGenerales}}
      </div>
    </section>

    <section class="contrato-firmas">
      <div class="contrato-firma-bloque">
        <p><strong>Número de negocio:</strong> {{numeroNegocio}}</p>
        <p>En comprobante, previas lecturas firman y ratifican como representante del grupo.</p>

        <table class="tabla-firmas">
          <thead>
            <tr>
              <th>NOMBRE Y APELLIDO</th>
              <th>RUT</th>
              <th>FIRMA</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{{delegado1Nombre}}</td>
              <td>{{delegado1Rut}}</td>
              <td>------------------------------------</td>
            </tr>
            <tr>
              <td>{{delegado2Nombre}}</td>
              <td>{{delegado2Rut}}</td>
              <td>------------------------------------</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="contrato-firma-empresa">
        <p><strong>POR TURISMO RAITRAI</strong></p>
        <p>{{representanteAgencia}} &nbsp;&nbsp;&nbsp; {{rutRepresentanteAgencia}} &nbsp;&nbsp;&nbsp; ------------------------------------</p>
      </div>
    </section>

    <section class="contrato-anexos-nota">
      <p><strong>ANEXO N°1:</strong> Itinerario programa viaje.</p>
      <p><strong>ANEXO N°2:</strong> Asistencia en viaje.</p>
      <p><strong>ANEXO N°3:</strong> Seguro de cancelación previo al viaje.</p>
    </section>
  </article>
  `;
}

/* =========================================================
   REEMPLAZO DE PLACEHOLDERS
========================================================= */

export function replacePlaceholders(template = "", values = {}) {
  let out = String(template || "");

  for (const [key, value] of Object.entries(values)) {
    const safeValue = value == null ? "" : String(value);
    out = out.replaceAll(`{{${key}}}`, safeValue);
  }

  return cleanupUnresolvedPlaceholders(out);
}

function cleanupUnresolvedPlaceholders(html = "") {
  return String(html || "").replace(/\{\{[^}]+\}\}/g, "—");
}

/* =========================================================
   HELPERS
========================================================= */

function buildGrupoDescripcionCompleta({
  cursoActualTexto = "",
  cursoProyectadoTexto = "",
  colegio = "",
  comuna = ""
} = {}) {
  const cursoActualSafe = cursoActualTexto || "curso no informado";
  const cursoProyectadoSafe = cursoProyectadoTexto || "curso proyectado no informado";
  const colegioSafe = colegio || "colegio no informado";
  const comunaSafe = comuna || "comuna no informada";

  return `${cursoActualSafe} (${cursoProyectadoSafe}) del colegio ${colegioSafe} de la comuna de ${comunaSafe}`;
}

function buildCursoAnoTexto(curso = "", ano = "") {
  const c = cleanText(curso);
  const a = cleanText(ano);

  if (c && a) return `${c} ${a}`;
  if (c) return c;
  if (a) return a;
  return "";
}

function cleanText(value = "") {
  return String(value ?? "").trim();
}

function fallbackText(value = "", fallback = "") {
  const v = cleanText(value);
  return v || String(fallback || "").trim();
}

function isMissingValue(value = "") {
  const v = cleanText(value);
  return !v || v === "NO INFORMADO" || v === "NO INFORMADA";
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

function formatMoneyMaybe(value, fallback = "NO INFORMADO") {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;

  const normalized = raw.replace(/[^\d,.-]/g, "");
  const hasNumber = /\d/.test(normalized);
  if (!hasNumber) return raw || fallback;

  const digits = normalized.replace(/[^\d]/g, "");
  if (!digits) return raw || fallback;

  const n = Number(digits);
  if (!Number.isFinite(n)) return raw || fallback;

  return new Intl.NumberFormat("es-CL", {
    maximumFractionDigits: 0
  }).format(n);
}

function normalizeRichHtml(html = "") {
  const raw = String(html || "").trim();
  if (!raw) {
    return `<p class="empty">Sin observaciones.</p>`;
  }

  const looksLikeHtml = /<\/?[a-z][\s\S]*>/i.test(raw);
  if (!looksLikeHtml) {
    return raw
      .split(/\n+/)
      .map((line) => `<p>${escapeHtml(line.trim())}</p>`)
      .join("");
  }

  return sanitizeBasicHtml(raw);
}

function sanitizeBasicHtml(html = "") {
  const raw = String(html || "");

  return raw
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/<iframe[\s\S]*?>[\s\S]*?<\/iframe>/gi, "")
    .replace(/\son\w+="[^"]*"/gi, "")
    .replace(/\son\w+='[^']*'/gi, "")
    .replace(/\sstyle="[^"]*"/gi, "")
    .replace(/\sstyle='[^']*'/gi, "")
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

function currentYearString() {
  return String(new Date().getFullYear());
}

function proyectarCursoSimple(curso = "") {
  const raw = cleanText(curso);
  if (!raw) return "";

  const match = raw.match(/^(\d+)([A-Za-zÁÉÍÓÚáéíóúÑñ]*)$/);
  if (!match) return raw;

  const numero = Number(match[1]);
  const letras = match[2] || "";

  if (!Number.isFinite(numero)) return raw;

  let siguiente = numero + 1;

  if (numero === 8) {
    siguiente = 1;
  }

  return `${siguiente}${letras}`;
}
