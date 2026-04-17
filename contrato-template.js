// contrato-template.js
// Plantilla base del contrato Rai Trai.
// Este archivo NO genera el PDF.
// Solo construye el HTML contractual completo con placeholders reemplazables.

export const CONTRATO_TEMPLATE_VERSION = "base_2025_v1";

/* =========================================================
   API PRINCIPAL
========================================================= */

export function buildContratoHtml(data = {}) {
  const v = normalizeContratoData(data);

  const template = getContratoTemplate();

  return replacePlaceholders(template, {
    versionPlantilla: CONTRATO_TEMPLATE_VERSION,

    fechaContratoLarga: v.fechaContratoLarga,
    ciudadFirma: v.ciudadFirma,

    razonSocialAgencia: v.razonSocialAgencia,
    rutAgencia: v.rutAgencia,
    representanteAgencia: v.representanteAgencia,
    rutRepresentanteAgencia: v.rutRepresentanteAgencia,
    domicilioAgencia: v.domicilioAgencia,

    grupoDescripcionCompleta: v.grupoDescripcionCompleta,
    cursoActualTexto: v.cursoActualTexto,
    cursoProyectadoTexto: v.cursoProyectadoTexto,
    colegio: v.colegio,
    comuna: v.comuna,

    nombreGrupo: v.nombreGrupo,
    apoderadoEncargado: v.apoderadoEncargado,
    telefono: v.telefono,
    correo: v.correo,

    programaNombre: v.programaNombre,
    destinoPrograma: v.destinoPrograma,
    fechaViajeTexto: v.fechaViajeTexto,
    salidaTexto: v.salidaTexto,
    regresoTexto: v.regresoTexto,

    cantidadPaxTotal: v.cantidadPaxTotal,
    cantidadPaxPagados: v.cantidadPaxPagados,
    liberados: v.liberados,
    tramo: v.tramo,

    valorPrograma: v.valorPrograma,
    valorProgramaTexto: v.valorProgramaTexto,
    cuotaInscripcion: v.cuotaInscripcion,
    cuotaInscripcionTexto: v.cuotaInscripcionTexto,
    cuotasTexto: v.cuotasTexto,
    diferenciaTramoTexto: v.diferenciaTramoTexto,
    fechaPagoTotalTexto: v.fechaPagoTotalTexto,

    asistenciaEnViajes: v.asistenciaEnViajes,
    categoriaHoteleraContratada: v.categoriaHoteleraContratada,

    numeroNegocio: v.numeroNegocio,
    nombreVendedor: v.nombreVendedor,

    delegado1Nombre: v.delegado1Nombre,
    delegado1Rut: v.delegado1Rut,
    delegado2Nombre: v.delegado2Nombre,
    delegado2Rut: v.delegado2Rut,

    observacionesOperaciones: v.observacionesOperaciones,
    observacionesAdministracion: v.observacionesAdministracion,
    observacionesGenerales: v.observacionesGenerales,

    htmlObservacionesOperaciones: v.htmlObservacionesOperaciones,
    htmlObservacionesAdministracion: v.htmlObservacionesAdministracion,
    htmlObservacionesGenerales: v.htmlObservacionesGenerales
  });
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
    ciudadFirma: cleanText(raw.ciudadFirma || "Santiago de Chile"),

    razonSocialAgencia: cleanText(raw.razonSocialAgencia || "TURISMO RAITRAI LIMITADA"),
    rutAgencia: cleanText(raw.rutAgencia || "78.384.230-0"),
    representanteAgencia: cleanText(raw.representanteAgencia || "Carlos Flores Maragaño"),
    rutRepresentanteAgencia: cleanText(raw.rutRepresentanteAgencia || "7.844.528-9"),
    domicilioAgencia: cleanText(raw.domicilioAgencia || "La Concepción Nº 141 oficina 305, Santiago"),

    grupoDescripcionCompleta,
    cursoActualTexto: cursoActualTexto || "CURSO NO INFORMADO",
    cursoProyectadoTexto: cursoProyectadoTexto || "CURSO PROYECTADO NO INFORMADO",
    colegio: colegio || "COLEGIO NO INFORMADO",
    comuna: comuna || "COMUNA NO INFORMADA",

    nombreGrupo: cleanText(raw.nombreGrupo || raw.aliasGrupo || grupoDescripcionCompleta || ""),
    apoderadoEncargado: cleanText(raw.apoderadoEncargado || raw.nombreCliente || "NO INFORMADO"),
    telefono: cleanText(raw.telefono || raw.celularCliente || "NO INFORMADO"),
    correo: cleanText(raw.correo || raw.correoCliente || "NO INFORMADO"),

    programaNombre: cleanText(raw.programaNombre || raw.nombrePrograma || raw.programa || "PROGRAMA NO INFORMADO"),
    destinoPrograma: cleanText(raw.destinoPrograma || raw.destino || raw.destinoPrincipal || "DESTINO NO INFORMADO"),
    fechaViajeTexto: cleanText(raw.fechaViajeTexto || raw.fechaDeViaje || raw.fechaViaje || "NO INFORMADA"),
    salidaTexto: cleanText(raw.salidaTexto || raw.salidaViaje || raw.fechaSalida || raw.fechaViajeTexto || "NO INFORMADA"),
    regresoTexto: cleanText(raw.regresoTexto || raw.regresoViaje || raw.fechaRegreso || raw.fechaViajeTexto || "NO INFORMADA"),

    cantidadPaxTotal: cleanText(raw.cantidadPaxTotal || raw.numeroPaxTotal || raw.cantidadGrupo || "NO INFORMADO"),
    cantidadPaxPagados: cleanText(raw.cantidadPaxPagados || raw.paxPagados || raw.numeroPaxPagados || raw.cantidadGrupo || "NO INFORMADO"),
    liberados: cleanText(raw.liberados || "NO INFORMADO"),
    tramo: cleanText(raw.tramo || "NO INFORMADO"),

    valorPrograma: valorProgramaRaw,
    valorProgramaTexto: formatMoneyMaybe(valorProgramaRaw),
    cuotaInscripcion: cuotaInscripcionRaw,
    cuotaInscripcionTexto: cuotaInscripcionRaw ? formatMoneyMaybe(cuotaInscripcionRaw) : "NO INFORMADA",
    cuotasTexto: cleanText(raw.cuotasTexto || "NO INFORMADAS"),
    diferenciaTramoTexto: cleanText(raw.diferenciaTramoTexto || "NO INFORMADA"),
    fechaPagoTotalTexto: cleanText(raw.fechaPagoTotalTexto || "NO INFORMADA"),

    asistenciaEnViajes: cleanText(raw.asistenciaEnViajes || "NO INFORMADA"),
    categoriaHoteleraContratada: cleanText(raw.categoriaHoteleraContratada || raw.hotel || "NO INFORMADA"),

    numeroNegocio: cleanText(raw.numeroNegocio || "NO INFORMADO"),
    nombreVendedor: cleanText(raw.nombreVendedor || raw.vendedora || "NO INFORMADO"),

    delegado1Nombre: cleanText(raw.delegado1Nombre || ""),
    delegado1Rut: cleanText(raw.delegado1Rut || ""),
    delegado2Nombre: cleanText(raw.delegado2Nombre || ""),
    delegado2Rut: cleanText(raw.delegado2Rut || ""),

    observacionesOperaciones: cleanText(raw.observacionesOperaciones || ""),
    observacionesAdministracion: cleanText(raw.observacionesAdministracion || ""),
    observacionesGenerales: cleanText(raw.observacionesGenerales || raw.observacionesFicha || ""),

    htmlObservacionesOperaciones: normalizeRichHtml(raw.htmlObservacionesOperaciones || ""),
    htmlObservacionesAdministracion: normalizeRichHtml(raw.htmlObservacionesAdministracion || ""),
    htmlObservacionesGenerales: normalizeRichHtml(raw.htmlObservacionesGenerales || "")
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
        en adelante también "La Agencia", representada por su Gerente General,
        {{representanteAgencia}}, cédula nacional de identidad número {{rutRepresentanteAgencia}},
        domiciliado en {{domicilioAgencia}}, en adelante “LA AGENCIA”, por una parte y por la otra
        {{grupoDescripcionCompleta}}, representado por las personas cuyos nombres se incluyen al final
        del presente instrumento, en adelante “El Grupo”, se conviene el contrato de prestación de
        servicios turísticos que se describe en las cláusulas siguientes:
      </p>
    </section>

    <section class="contrato-clausula">
      <h2>PRIMERO:</h2>
      <p>
        La agencia y el grupo han acordado la realización de un programa de viajes de estudios para sus
        pupilos que se detalla en anexo N° 1, N° 2 y N° 3, los cuales formarán parte del contrato para
        todos los efectos legales, siendo firmados por la Agencia y los representantes del grupo.
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
        <li>Documento de Salida de menores del país cuando corresponda</li>
        <li>Documento Recomendaciones de Viaje</li>
        <li>Documento de Distribución de Habitaciones</li>
        <li>Documento de Confirmación del viaje</li>
      </ul>

      <p><strong>b)</strong> Organización y desarrollo del Viaje de estudios en los términos estipulados.</p>
      <p>
        Respecto a este punto, la Agencia podrá introducir cambios en las rutas y horarios previamente
        establecidos por razones de fuerza mayor, seguridad de los integrantes del grupo o aquellas
        destinadas a mejorar el cumplimiento de los objetivos previstos, siempre y cuando sean acordadas
        por el representante de la Agencia y los acompañantes o representantes del grupo.
      </p>
      <p>
        En estos casos ambas partes podrán acordar una nueva actividad en reemplazo, que no genere nuevos
        costos, que pudieren significar un valor mayor al precio del programa contratado.
      </p>

      <p><strong>c)</strong> Efectuar las reservas y reconfirmaciones correspondientes a los distintos servicios turísticos, tales como pasajes aéreos si fuera el caso, transporte terrestre, hoteles u otros establecimientos necesarios, para el adecuado desarrollo del programa.</p>

      <p><strong>d)</strong> Designar un representante de Raitrai que acompañe al grupo, que ejercerá funciones de coordinador del grupo, y que se encargará de velar por el adecuado cumplimiento del programa del viaje contratado, y que proporcionará asistencia frente a cualquier problema o emergencia de los pasajeros.</p>

      <p><strong>e)</strong> El transporte de los pasajeros se realizará en los medios de transporte pactados en el Anexo N° 1. El transporte terrestre se realizará en bus de Turismo, a cargo de conductores profesionales, quienes en todo momento tienen especiales instrucciones de respetar estrictamente todas las normas legales y reglamentarias pertinentes.</p>

      <p>
        En el evento que el vehículo terrestre sufriera un desperfecto mecánico que impidiera la continuación
        del programa, la Agencia se obliga a reemplazarlo por un vehículo de características similares en el
        menor plazo posible, siendo de cargo de la Agencia los gastos que fueran necesarios para el cumplimiento
        del programa.
      </p>
    </section>

    <section class="contrato-clausula">
      <h2>TERCERO: OBLIGACIONES DE LOS APODERADOS DE CADA ALUMNO</h2>
      <p>Representados para efectos de negociación del Programa y servicios contratados por los DELEGADOS DESIGNADOS.</p>

      <p><strong>a) Pago del Valor Programa.</strong></p>
      <p>
        Esta responsabilidad será de cargo del representante y/o Apoderado, de cada alumno integrante del grupo
        que viaja, respondiendo personalmente por los compromisos que adquiera para estos efectos con la AGENCIA.
      </p>

      <p><strong>b) Firma de contrato.</strong></p>
      <p>
        El presente contrato podrá formalizarse mediante una de las siguientes dos modalidades. En ambos casos,
        la aceptación de sus condiciones se entenderá válida desde el momento en que el apoderado realice el primer pago,
        sea este la cuota de inscripción o cualquier otro abono asociado al viaje.
      </p>

      <p><strong>b1.- Firmado por los delegados en representación del grupo.</strong></p>
      <p>
        La firma del presente contrato por parte de los delegados no implica responsabilidad económica individual
        para ellos. Actúan exclusivamente como representantes del grupo ante la Agencia, y su firma respalda y
        ratifica que todos los apoderados integrantes del grupo conocen y aceptan íntegramente las condiciones aquí estipuladas.
      </p>

      <p><strong>b2.- Firmado individualmente por cada apoderado.</strong></p>
      <p>
        Cada apoderado dispondrá de un plazo de 15 días para firmar personalmente el contrato en las oficinas de
        Turismo Raitrai. En caso de no hacerlo, pero realizar uno o más pagos a la Agencia, se entenderá que acepta
        todas las condiciones contenidas en este contrato, sin necesidad de firma adicional.
      </p>

      <p><strong>c) Tramo pactado.</strong></p>
      <p>
        Para dar consistencia al tramo pactado, los delegados del grupo deberán enviar una nómina con los nombres
        de los participantes del viaje. El nombre de los liberados 100% deberá ser entregado máximo 90 días antes
        de la salida del viaje.
      </p>

      <p><strong>d) Cumplimiento de fechas.</strong></p>
      <p>
        El cumplimiento en las fechas establecidas para la entrega de información requerida por la AGENCIA es de
        exclusiva responsabilidad de los delegados y apoderados o representantes legales de cada alumno.
      </p>

      <p><strong>e) Documentación.</strong></p>
      <p>
        Conocer y tener la documentación legal necesaria para que los alumnos puedan salir del país e ingresar a los
        países durante el viaje es de exclusiva responsabilidad de cada uno de los apoderados o representantes legales
        de cada alumno.
      </p>

      <p><strong>f) Comunicación y monitoreo.</strong></p>
      <p>
        Los Delegados de los grupos tienen la responsabilidad de transmitir toda la información que la AGENCIA entregue
        relativa al viaje. Además, se les proporcionará una clave especial para que tengan acceso a monitorear el estado
        de pago general del grupo.
      </p>

      <p>
        Cada apoderado es responsable de informarse de todas las cláusulas de este contrato sin excepción alguna, y sus
        obligaciones deben cumplirse. De lo contrario, Turismo Raitrai podrá, a su arbitrio y sin responsabilidad para ella,
        excluir al alumno que no cumpla con los tiempos pactados por el grupo y la agencia, y modificar el precio del presente
        contrato, adecuándolo a la nueva cantidad de alumnos.
      </p>
    </section>

    <section class="contrato-clausula">
      <h2>CUARTO: RELATIVO A LA SALIDA DEL PAÍS.</h2>
      <p>
        Todos los alumnos menores de edad que a la fecha de salida del país no hayan cumplido 18 años de edad necesitan
        ser autorizados notarialmente por ambos padres o por quien tenga la tuición legal del menor, para poder salir del país.
      </p>
      <p>El día de salida -inicio del viaje- los pasajeros menores de edad deben presentarse con:</p>
      <ul>
        <li>Cédula de identidad o Pasaporte al día y en buenas condiciones.</li>
        <li>Autorización Notarial de ambos padres o Tutor, en triplicado, autorizándolos a salir del país en gira de estudios.</li>
        <li>Triplicado de Certificado de nacimiento donde conste la identidad de los padres.</li>
      </ul>
      <p>TURISMO RAITRAI declina toda responsabilidad ante posibles problemas en la salida de menores y adultos del país.</p>
    </section>

    <section class="contrato-clausula">
      <h2>QUINTO: RESPONSABILIDADES.</h2>

      <p><strong>a) Horarios de transporte.</strong></p>
      <p>
        Se deja constancia que los horarios establecidos en vuelos chárter y de línea aérea regular son sujetos a cambio
        y sin previo aviso y son responsabilidad de las compañías respectivas.
      </p>

      <p><strong>b) Equipaje.</strong></p>
      <p>
        La seguridad e integridad del equipaje transportado en avión, tren, barco o bus es de responsabilidad exclusiva
        de las compañías respectivas y de sus usuarios. Asimismo, todas las pertenencias de valor deben ser guardadas
        en las cajas fuertes de los hoteles cuando estén disponibles, siendo responsabilidad exclusiva de los pasajeros hacerlo.
      </p>

      <p>
        La pérdida, extravío, deterioro o robo de pertenencias como celulares, ropa, calzado, gafas u otros objetos personales
        será responsabilidad única de quien las porte.
      </p>

      <p>
        Sin perjuicio de lo anterior, TURISMO RAITRAI brindará la asistencia adecuada dentro de sus facultades operativas
        para orientar, gestionar o colaborar en la resolución de dichos casos, actuando con buena fe y disposición,
        sin que ello implique asumir responsabilidad por los hechos ocurridos.
      </p>

      <p><strong>c) Seguridad de los alumnos.</strong></p>
      <p>
        Es de responsabilidad común de las partes. No obstante, las responsabilidades que se originen en una conducta
        inadecuada de los alumnos o de sus acompañantes o apoderados que participen en el Viaje de Estudios, recae en
        los padres y/o apoderados acompañantes, sin perjuicio de la que individualmente pueda corresponder al o los autores directos.
      </p>

      <p>
        Se deja expresa constancia que serán de exclusiva responsabilidad de los alumnos, padres y/o apoderados la contratación
        de servicios adicionales y/o la realización de actividades que no se encuentren expresamente consideradas en el programa contratado.
      </p>

      <p><strong>d) Delegados y/o Acompañantes del grupo.</strong></p>
      <p>
        Se comprometen a velar por la conducta, orden y disciplina de los alumnos, para cumplir el normal desarrollo del programa de viaje.
      </p>

      <p>
        Sobre las habitaciones para adultos acompañantes están fijadas según tramo: siempre las habitaciones serán singles,
        dobles o triples según corresponda. Sobre 30 pasajeros 100% pagados se asignan 02 habitaciones para estos fines.
        Con menos de 29 pasajeros 100% pagados, se asigna 01 habitación.
      </p>

      <p>
        Por política de la empresa, no está permitido que los adultos compartan habitación con los menores.
        Pasajeros que pagan el 100% del viaje quedan sujetos a esta modalidad.
      </p>

      <p><strong>e) Daños o desperfectos por alumnos o acompañantes del grupo.</strong></p>
      <p>
        Cualquier daño, desperfecto o deterioro parcial de partes, piezas, instalaciones o accesorios de los medios de transporte
        o de los establecimientos comerciales, hoteles, restaurantes u otros que presten los servicios previstos en el programa,
        serán de responsabilidad de sus autores.
      </p>

      <p>
        Todos los gastos que se generen como consecuencia de acciones u omisiones de los alumnos serán de cargo de los padres,
        apoderados o representante legal correspondiente a cada uno de los alumnos.
      </p>

      <p><strong>f) Actividades adicionales al programa.</strong></p>
      <p>
        El programa deberá cumplirse en los términos estipulados. En todo caso, el representante de la Agencia podrá convenir
        con el o los representantes del grupo otras actividades adicionales al programa, siempre y cuando no afecte el desarrollo
        del programa pactado y sean consideradas apropiadas por las partes. Estas ampliaciones del programa original serán de
        exclusivo cargo del grupo.
      </p>
    </section>

    <section class="contrato-clausula">
      <h2>SEXTO: ASISTENCIA EN VIAJES Y SEGUROS.</h2>
      <p>
        Los participantes del programa serán beneficiados con los seguros correspondientes a los medios de transporte de pasajeros,
        así como también por el servicio de “Asistencia en viaje” descrita en el Anexo Nº 2 y el “Seguro de cancelación previo
        a la salida del viaje” descrito en el Anexo N° 3.
      </p>
      <p>
        TURISMO RAITRAI no tendrá responsabilidad por el pago de los deducibles ni por cantidades que excedan el límite de las
        coberturas establecidas en dichos seguros.
      </p>
      <p>
        Sin perjuicio de lo anterior, la Agencia prestará apoyo activo dentro de sus competencias para asistir al grupo en la
        gestión de estas coberturas, facilitar los trámites correspondientes, y acompañar al afectado en situaciones de emergencia
        o necesidad, actuando con la máxima disposición y buena fe operativa.
      </p>
    </section>

    <section class="contrato-clausula">
      <h2>SÉPTIMO: PRECIO DEL VIAJE DE ESTUDIO</h2>
      <p>
        El Viaje de Estudios tendrá un costo de {{valorProgramaTexto}}, establecido en el Anexo N°1, en la base mínima de
        {{cantidadPaxPagados}} pasajeros pagados más {{liberados}} pasajeros liberados.
      </p>
      <p>
        Se deja constancia que el abono establecido por concepto de cuota de inscripción de {{cuotaInscripcionTexto}}
        tendrá la finalidad de establecer el tramo contratado. De otra manera, TURISMO RAITRAI se reserva el derecho de cambiar
        el tramo al valor del programa según el mínimo de pasajeros pagados.
      </p>
      <p>
        Es condición esencial que el precio pactado se encuentre totalmente pagado a plena satisfacción de la Agencia
        {{fechaPagoTotalTexto}}. De lo contrario, la Agencia podrá cancelar la reserva y aplicar penalidades.
      </p>
    </section>

    <section class="contrato-clausula">
      <h2>OCTAVO: ATRASOS EN LOS PAGOS</h2>
      <p>
        Todo pasajero que documente o cancele total o parcialmente el viaje fuera del plazo acordado estará sujeto a las
        variaciones de precio que pudieran producirse.
      </p>
      <p>
        En caso de incumplimiento de los pagos pactados, Turismo Raitrai tiene la facultad de dar de baja al alumno
        y disponer del cupo no utilizado.
      </p>
    </section>

    <section class="contrato-clausula">
      <h2>NOVENO: DETALLE DE LA FORMA DE PAGO</h2>
      <p>
        Abono o cuota de inscripción convenido en la cantidad de {{cuotaInscripcionTexto}}. Este valor será descontado del saldo
        total a pagar del viaje. No es reembolsable ni transferible.
      </p>
      <p>
        La forma de pago que ofrece TURISMO RAITRAI asciende al valor total del programa de {{valorProgramaTexto}} por cada pasajero,
        pagándose de la siguiente manera:
      </p>
      <p><strong>{{cuotasTexto}}</strong></p>
      <p><strong>Diferencia tramo:</strong> {{diferenciaTramoTexto}}</p>
      <p>
        Pagada la inscripción, el apoderado deberá realizar los pagos mensuales para mantener el cupo.
      </p>
      <p>
        Recordar que el viaje debe quedar totalmente pagado en la fecha comprometida. El apoderado se compromete a pagar el total
        en cuotas sin interés, mensualmente, conforme al acuerdo comercial vigente para este grupo.
      </p>
      <p>
        En caso de incumplir 2 o más cuotas consecutivas, la Agencia podrá considerar que el pasajero renuncia al viaje.
      </p>

      <p><strong>b) OTRAS FORMAS EN QUE PUEDE SER PAGADO EL VIAJE</strong></p>
      <ol>
        <li>Pesos Chilenos, dólares y cheques.</li>
        <li>Webpay a través de la página web www.raitrai.cl</li>
        <li>3% de descuento por pago contado al momento de contratar el viaje, solo transferencia, efectivo o cheque al día.</li>
        <li>Todas las tarjetas de crédito bancarias, con cuotas precio contado según banco.</li>
      </ol>
    </section>

    <section class="contrato-clausula">
      <h2>DÉCIMO: TIPO DE CAMBIO</h2>
      <p>
        Todos los pagos y reembolsos expresados en moneda extranjera serán establecidos por el área de administración de TURISMO RAITRAI.
      </p>
    </section>

    <section class="contrato-clausula">
      <h2>DÉCIMO PRIMERO: POLÍTICAS DE ANULACIÓN</h2>
      <p>
        Se acuerda que para el efecto de anulación individual o colectiva del presente contrato de prestación de servicios antes
        de la realización del programa, se estará sujeto a las cláusulas y porcentajes establecidos por TURISMO RAITRAI según
        el tipo de servicio contratado, tiempos de anticipación y costos ya comprometidos.
      </p>
      <p>
        Toda solicitud de anulación deberá ser enviada por escrito vía correo electrónico al asesor de viajes, con copia al encargado del grupo.
      </p>
      <p>
        Si con una antelación de 60 días a la salida del viaje el grupo no tuviera pagada la cantidad de pasajeros convenida,
        el valor del programa se adecuará al tramo que corresponda, debiendo los apoderados pagar las diferencias que puedan producirse.
      </p>
    </section>

    <section class="contrato-clausula">
      <h2>DÉCIMO SEGUNDO: INCORPORACIÓN DE NUEVOS PASAJEROS (LISTA DE ESPERA)</h2>
      <p>
        Toda solicitud de incorporación de nuevos alumnos o acompañantes una vez confirmada la nómina oficial del grupo será gestionada
        exclusivamente a través del procedimiento interno de Lista de Espera de TURISMO RAITRAI.
      </p>
    </section>

    <section class="contrato-clausula">
      <h2>DÉCIMO TERCERO: REGISTRO DE CASOS ESPECIALES</h2>
      <p>
        Toda solicitud extraordinaria por parte del apoderado, participante o grupo que implique una modificación de los términos
        originalmente pactados será registrada por TURISMO RAITRAI bajo un sistema interno de gestión de casos.
      </p>
    </section>

    <section class="contrato-clausula">
      <h2>DÉCIMO CUARTO: FUERZA MAYOR O CASO FORTUITO</h2>
      <p>
        Ninguna de las partes será responsable del incumplimiento o demora en el desarrollo de sus obligaciones contractuales,
        en cuanto dicho incumplimiento, demora y/o cancelación sea el resultado de un caso fortuito, fuerza mayor o circunstancia
        fuera del control razonable de cada parte.
      </p>
      <p>
        En caso de presentarse una situación de este tipo, TURISMO RAITRAI, en coordinación con los delegados, deberán acordar
        una nueva fecha para el viaje de estudios o la mejor manera de dar continuidad al mismo.
      </p>
    </section>

    <section class="contrato-clausula">
      <h2>DÉCIMO QUINTO: SOLUCIÓN DE CONTROVERSIAS</h2>
      <p>
        Toda dificultad que surja entre las partes sobre la validez, interpretación, cumplimiento o incumplimiento de este contrato
        será resuelta aplicando las leyes chilenas, por un árbitro arbitrador designado de común acuerdo o conforme al reglamento
        del Centro de Arbitrajes de la Cámara de Comercio de Santiago.
      </p>
    </section>

    <section class="contrato-clausula">
      <h2>DÉCIMO SEXTO: COMPROMISO ÉTICO</h2>
      <p>
        Nuestra empresa declara su apoyo a campañas e iniciativas destinadas a resguardar la integridad física y moral de las personas,
        especialmente de los menores, adhiriendo a normativas legales referentes a materias sobre explotación de seres humanos y
        capacitando a su personal en materia de prevención.
      </p>
    </section>

    <section class="contrato-clausula">
      <h2>DÉCIMO SÉPTIMO: PROTECCIÓN DE DATOS PERSONALES</h2>
      <p>
        El grupo y sus representantes autorizan expresamente a TURISMO RAITRAI LIMITADA a recolectar, almacenar y tratar los datos
        personales necesarios para la correcta ejecución del presente contrato, conforme a la Ley Nº 19.628 sobre Protección de la Vida Privada.
      </p>
    </section>

    <section class="contrato-clausula">
      <h2>DÉCIMO OCTAVO</h2>
      <p>
        La salida para el cumplimiento del programa acordado está fijada para {{salidaTexto}} y el regreso para {{regresoTexto}},
        desde y hacia el lugar operacionalmente definido por la Agencia para la ejecución del viaje.
      </p>
    </section>

    <section class="contrato-clausula">
      <h2>DÉCIMO NOVENO</h2>
      <p>
        Para todos los efectos legales las partes fijan su domicilio en la ciudad de Santiago, comuna de Providencia.
        Se suscribe en dos ejemplares, quedando uno en poder de TURISMO RAITRAI y otro en poder de los delegados del grupo curso.
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
        <p><strong>Valor programa:</strong> {{valorProgramaTexto}}</p>
        <p><strong>Cuota inscripción:</strong> {{cuotaInscripcionTexto}}</p>
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
        <p><strong>NÚMERO DE NEGOCIO:</strong> {{numeroNegocio}}</p>
        <p>En comprobante, previas lecturas firman y ratifican como representante del grupo:</p>

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
              <td>............................................</td>
            </tr>
            <tr>
              <td>{{delegado2Nombre}}</td>
              <td>{{delegado2Rut}}</td>
              <td>............................................</td>
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
      <p><strong>Nota:</strong> El programa detallado, el servicio de asistencia en viaje y el seguro de cancelación previo a la salida forman parte integrante del presente contrato.</p>
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
  if (!raw) return "NO INFORMADO";

  const normalized = raw.replace(/[^\d,-.]/g, "");
  const onlyDigits = normalized.replace(/[^\d]/g, "");
  if (!onlyDigits) return raw;

  const n = Number(onlyDigits);
  if (!Number.isFinite(n)) return raw;

  return new Intl.NumberFormat("es-CL", {
    maximumFractionDigits: 0
  }).format(n);
}

function normalizeRichHtml(html = "") {
  const raw = String(html || "").trim();
  if (!raw) {
    return `<p class="empty">Sin observaciones.</p>`;
  }

  return raw;
}
