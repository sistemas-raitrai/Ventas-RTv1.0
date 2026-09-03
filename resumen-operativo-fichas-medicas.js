import {
  $,
  auth,
  onAuthStateChanged,
  clean,
  normalize,
  escapeHtml,
  passengerName,
  fichaCompleta,
  isCancelled,
  getCurrentSystemUser,
  canViewMedicalData,
  resolveGroup,
  loadGroupInscriptions
} from "./ficha-medica-common.js";


/*
  =========================================================
  ESTADO
  =========================================================
*/

const state = {
  groupDocId: "",
  groupId: "",
  group: null,
  items: [],
  user: null,

  /*
    encargado:
      versión limitada según autorización.

    viaje:
      versión destinada a adultos responsables
      durante el viaje.
  */
  mode:
    "encargado"
};


init();


/*
  =========================================================
  INICIO
  =========================================================
*/

function init() {
  onAuthStateChanged(
    auth,
    async (
      firebaseUser
    ) => {
      if (
        !firebaseUser
      ) {
        location.href =
          "login.html";

        return;
      }

      state.user =
        getCurrentSystemUser(
          firebaseUser
        );

      if (
        !canViewMedicalData(
          state.user
        )
      ) {
        showError(
          "No tienes permisos para acceder a información médica."
        );

        return;
      }

      bindEvents();

      await loadPage();
    }
  );
}


function bindEvents() {
  $("btnPrint")
    ?.addEventListener(
      "click",
      () => {
        window.print();
      }
    );

  $("btnModoEncargado")
    ?.addEventListener(
      "click",
      () => {
        state.mode =
          "encargado";

        render();
      }
    );

  $("btnModoViaje")
    ?.addEventListener(
      "click",
      () => {
        state.mode =
          "viaje";

        render();
      }
    );
}


/*
  =========================================================
  CARGA
  =========================================================
*/

async function loadPage() {
  try {
    const params =
      new URLSearchParams(
        location.search
      );

    const requested =
      clean(
        params.get(
          "id"
        ) ||
        params.get(
          "grupo"
        )
      );

    if (
      !requested
    ) {
      throw new Error(
        "Falta el parámetro ?id= del grupo."
      );
    }

    const resolved =
      await resolveGroup(
        requested
      );

    if (
      !resolved
    ) {
      throw new Error(
        `No se encontró el grupo ${requested}.`
      );
    }

    state.groupDocId =
      resolved.docId;

    state.groupId =
      resolved.groupId;

    state.group =
      resolved.data;

    const allItems =
      await loadGroupInscriptions(
        state.groupDocId
      );

    /*
      El resumen operativo considera únicamente
      pasajeros que efectivamente viajan.
    
      Quedan fuera:
        - pendientes de gestión;
        - listas de espera pendientes;
        - listas de espera pagadas aún no confirmadas;
        - nuevos ingresos pendientes;
        - liberados pendientes;
        - anulados;
        - personas marcadas como "No viaja".
    
      Una ficha médica pendiente sí permanece cuando
      corresponde a un pasajero confirmado que viaja.
    */
    
    state.items =
      allItems
        .filter(
          esPasajeroQueViaja
        )
        .sort(
          (
            a,
            b
          ) =>
            passengerName(
              a
            ).localeCompare(
              passengerName(
                b
              ),
              "es",
              {
                sensitivity:
                  "base",
    
                numeric:
                  true
              }
            )
        );

    $("btnVolver").href =
      `gestion-fichas-medicas.html?id=${encodeURIComponent(
        state.groupDocId
      )}`;

    document.title =
      `Resumen operativo · ${clean(
        state.group
          ?.aliasGrupo ||
        state.group
          ?.colegio ||
        state.groupId
      )}`;

    $("loadingBox")
      ?.classList
      .add(
        "hidden"
      );

    $("content")
      ?.classList
      .remove(
        "hidden"
      );

    render();

    if (
      params.get(
        "print"
      ) === "1"
    ) {
      setTimeout(
        () => {
          window.print();
        },
        350
      );
    }
  } catch (
    error
  ) {
    console.error(
      "[resumen-operativo-fichas-medicas]",
      error
    );

    showError(
      error.message ||
      "No fue posible generar el resumen operativo."
    );
  }
}


/*
  =========================================================
  UTILIDADES
  =========================================================
*/

function normalizarFlag(
  value
) {
  const normalized =
    normalize(
      value
    );

  if (
    value === true ||
    normalized ===
      "si" ||
    normalized ===
      "sí" ||
    normalized ===
      "true"
  ) {
    return true;
  }

  if (
    value === false ||
    normalized ===
      "no" ||
    normalized ===
      "false"
  ) {
    return false;
  }

  return null;
}


function uniqueText(
  values = []
) {
  return [
    ...new Set(
      values
        .flat()
        .map(
          (
            value
          ) =>
            clean(
              value
            )
        )
        .filter(
          Boolean
        )
    )
  ];
}


function humanizar(
  value = ""
) {
  const raw =
    clean(
      value
    );

  if (
    !raw
  ) {
    return "";
  }

  const normalized =
    normalize(
      raw
    )
      .replace(
        /\s+/g,
        "_"
      );

  const labels = {
    sin_gluten:
      "Sin gluten",

    sin_lactosa:
      "Sin lactosa",

    vegetariana:
      "Vegetariana",

    vegetariano:
      "Vegetariana",

    vegana:
      "Vegana",

    vegano:
      "Vegana",

    alergia_alimentaria:
      "Alergia alimentaria",

    cea_tea:
      "CEA / TEA",

    tdah:
      "TDAH",

    dea:
      "DEA",

    fisica:
      "Física",

    visual:
      "Visual",

    auditiva:
      "Auditiva",

    cognitiva:
      "Cognitiva"
  };

  if (
    labels[
      normalized
    ]
  ) {
    return labels[
      normalized
    ];
  }

  return raw
    .replaceAll(
      "_",
      " "
    )
    .replace(
      /^./,
      (
        letter
      ) =>
        letter
          .toUpperCase()
    );
}

/*
  =========================================================
  PASAJERO OPERATIVO: EFECTIVAMENTE VIAJA
  =========================================================
*/

function esPasajeroQueViaja(
  item = {}
) {
  /*
    1. Anulados, no viajan o eliminados:
       siempre quedan fuera.
  */

  if (
    isCancelled(
      item
    )
  ) {
    return false;
  }


  /*
    Buscamos el tipo y estado considerando los nombres
    compatibles que pueden existir en inscripciones
    de distintas versiones.
  */

  const tipo =
    normalize(
      item.tipoInscripcion ||
      item.tipoRegistro ||
      item.tipoIngreso ||
      item.tipo ||
      item.origen ||
      ""
    );

  const estado =
    normalize(
      item.estadoInscripcion ||
      item.estadoGestion ||
      item.estado ||
      item.status ||
      ""
    );


  /*
    2. Exclusiones explícitas por estado.

    "Pagada" en Lista de Espera todavía está pendiente
    de confirmación, por lo tanto aún no viaja.
  */

  const estadosQueNoViajan = [
    "pendiente",
    "pendiente de gestion",
    "pendiente gestion",
    "pagada",
    "pagado",
    "por confirmar",
    "espera",
    "lista de espera",
    "rechazado",
    "rechazada",
    "no viaja",
    "no viajan",
    "anulado",
    "anulada",
    "eliminado",
    "eliminada"
  ];

  if (
    estadosQueNoViajan.some(
      (
        value
      ) =>
        estado ===
          value ||
        estado.includes(
          value
        )
    )
  ) {
    return false;
  }


  /*
    3. Flujos que obligatoriamente necesitan confirmación.

    Nuevo ingreso, Lista de espera, Liberados e
    Inscripción inicial solamente forman parte de la
    lista operativa cuando ya fueron confirmados.
  */

  const requiereConfirmacion =
    tipo.includes(
      "nuevo ingreso"
    ) ||
    tipo.includes(
      "lista de espera"
    ) ||
    tipo.includes(
      "liberado"
    ) ||
    tipo.includes(
      "inscripcion inicial"
    );


  if (
    requiereConfirmacion
  ) {
    const estaConfirmado =
      estado.includes(
        "confirmado"
      ) ||
      estado.includes(
        "confirmada"
      ) ||
      estado.includes(
        "completado"
      ) ||
      estado.includes(
        "completada"
      ) ||
      estado.includes(
        "finalizado"
      ) ||
      estado.includes(
        "finalizada"
      );

    return estaConfirmado;
  }


  /*
    4. Sistema de Pagos y Nómina Final corresponden
       a pasajeros activos.

    Pueden tener la ficha médica pendiente, pero eso
    no significa que estén pendientes de gestión.
  */

  if (
    tipo.includes(
      "sistema de pagos"
    ) ||
    tipo.includes(
      "nomina final"
    ) ||
    tipo.includes(
      "ficha medica"
    )
  ) {
    return true;
  }


  /*
    5. Compatibilidad con registros antiguos.

    Si no pertenecen a un flujo pendiente y tampoco
    están anulados, se mantienen como viajeros para no
    eliminar accidentalmente pasajeros antiguos que
    sí forman parte de la nómina.
  */

  return true;
}

/*
  =========================================================
  PRIVACIDAD
  =========================================================
*/


function getConsentimientoObject(
  item = {}
) {
  return (
    item.consentimiento ||
    {}
  );
}


function getVersionConsentimiento(
  item = {}
) {
  const consentimiento =
    getConsentimientoObject(
      item
    );

  return Number(
    consentimiento
      .versionConsentimiento ||
    item.versionConsentimientoFicha ||
    item.versionConsentimiento ||
    1
  );
}


/*
  Esta función mantiene varias rutas compatibles
  porque pueden existir fichas de distintas versiones.

  Si la ficha tiene expresamente FALSE,
  el encargado NO recibe detalles médicos.
*/
function puedeCompartirConEncargado(
  item = {}
) {
  const consentimiento =
    getConsentimientoObject(
      item
    );

  const candidatos = [
    consentimiento
      .autorizaApoderadoCoordinador,

    consentimiento
      .autorizaEncargadoGrupo,

    consentimiento
      .autorizaCompartirEncargado,

    item
      .autorizaApoderadoCoordinador
  ];

  for (
    const value of
    candidatos
  ) {
    if (
      value === true
    ) {
      return true;
    }

    if (
      value === false
    ) {
      return false;
    }
  }

  /*
    Fichas antiguas sin respuesta explícita.

    No damos por hecho que existe autorización
    para entregar antecedentes médicos a un tercero.
  */
  if (
    getVersionConsentimiento(
      item
    ) < 2
  ) {
    return false;
  }

  return false;
}


/*
  El equipo de viaje utiliza la información necesaria
  para seguridad, asistencia, cuidado y operación.

  Si existiera en tus datos un bloqueo explícito
  para uso interno, lo respetamos.
*/
function puedeCompartirConEquipoViaje(
  item = {}
) {
  const consentimiento =
    getConsentimientoObject(
      item
    );

  if (
    consentimiento
      .aceptaUsoInterno ===
      false
  ) {
    return false;
  }

  return true;
}


function puedeMostrarDetalle(
  item = {}
) {
  if (
    state.mode ===
    "encargado"
  ) {
    return puedeCompartirConEncargado(
      item
    );
  }

  return puedeCompartirConEquipoViaje(
    item
  );
}


/*
  =========================================================
  NECESITA ASISTENCIA
  =========================================================
*/


function getNecesitaAsistencia(
  item = {}
) {
  const salud =
    item.salud ||
    {};

  /*
    Primero buscamos posibles campos generales.

    Si tu formulario definitivo ya guarda una pregunta
    directa "Necesita asistencia", esta tiene prioridad.
  */
  const generales = [
    salud
      .necesitaAsistencia,

    salud
      .necesitaAsistenciaFlag,

    salud
      .requiereAsistencia,

    salud
      .requiereAsistenciaFlag,

    item
      .necesitaAsistencia,

    item
      .necesitaAsistenciaFlag,

    item
      .requiereAsistencia
  ];

  for (
    const value of
    generales
  ) {
    const flag =
      normalizarFlag(
        value
      );

    if (
      flag !== null
    ) {
      return flag;
    }
  }

  /*
    Compatibilidad con las fichas actuales.

    Tu Gestión de Fichas Médicas ya utiliza estos
    flags en el editor:
      salud.discapacidadApoyosFlag
      salud.neuroApoyosFlag
  */

  const discapacidad =
    normalizarFlag(
      salud
        .discapacidadApoyosFlag
    );

  const neuro =
    normalizarFlag(
      salud
        .neuroApoyosFlag
    );

  /*
    Si cualquiera requiere apoyo:
    asistencia = Sí.
  */
  if (
    discapacidad ===
      true ||
    neuro ===
      true
  ) {
    return true;
  }

  /*
    Si ambas respuestas existen y son No.
  */
  if (
    discapacidad ===
      false &&
    neuro ===
      false
  ) {
    return false;
  }

  /*
    Si solo existe una de ellas,
    usamos esa respuesta.
  */
  if (
    discapacidad !==
    null
  ) {
    return discapacidad;
  }

  if (
    neuro !==
    null
  ) {
    return neuro;
  }

  /*
    Último fallback:

    Si existen instrucciones concretas de asistencia,
    interpretamos que existe una consideración de apoyo.
  */
  if (
    clean(
      salud
        .discapacidadApoyoTipo
    ) ||
    clean(
      salud
        .discapacidadRecomendaciones
    ) ||
    clean(
      salud
        .discapacidadAyudaTecnica
    ) ||
    clean(
      salud
        .discapacidadAyudaIndicaciones
    ) ||
    clean(
      salud
        .neuroApoyosDetalle
    )
  ) {
    return true;
  }

  return null;
}


function getNecesitaAsistenciaTexto(
  item = {}
) {
  if (
    !fichaCompleta(
      item
    )
  ) {
    return "Pendiente";
  }

  if (
    state.mode ===
      "encargado" &&
    !puedeCompartirConEncargado(
      item
    )
  ) {
    return "Restringido";
  }

  const value =
    getNecesitaAsistencia(
      item
    );

  if (
    value === true
  ) {
    return "Sí";
  }

  if (
    value === false
  ) {
    return "No";
  }

  return "No informado";
}


/*
  =========================================================
  ALIMENTACION
  =========================================================
*/


function getAlimentacionValues(
  item = {}
) {
  const salud =
    item.salud ||
    {};

  const values =
    [];

  if (
    clean(
      salud
        .dietaPrincipal
    )
  ) {
    values.push(
      humanizar(
        salud
          .dietaPrincipal
      )
    );
  }

  if (
    Array.isArray(
      salud
        .dietaTipos
    )
  ) {
    values.push(
      ...salud
        .dietaTipos
        .map(
          humanizar
        )
    );
  }

  if (
    Array.isArray(
      salud
        .dietaRestricciones
    )
  ) {
    values.push(
      ...salud
        .dietaRestricciones
        .filter(
          (
            value
          ) =>
            normalize(
              value
            ) !==
            "alergia_alimentaria"
        )
        .map(
          humanizar
        )
    );
  }

  if (
    clean(
      salud
        .dietaDetalle
    )
  ) {
    values.push(
      salud
        .dietaDetalle
    );
  }

  return uniqueText(
    values
  );
}


/*
  =========================================================
  ALERGIAS
  =========================================================
*/


function getAlergiasValues(
  item = {}
) {
  const salud =
    item.salud ||
    {};

  const values =
    [];

  if (
    clean(
      salud
        .alergiasDetalle
    )
  ) {
    values.push(
      salud
        .alergiasDetalle
    );
  }

  if (
    Array.isArray(
      salud
        .alergiasAlimentarias
    )
  ) {
    salud
      .alergiasAlimentarias
      .forEach(
        (
          alergia
        ) => {
          const detalle =
            clean(
              alergia
                ?.alimento ||
              alergia
                ?.detalle ||
              ""
            );

          if (
            detalle
          ) {
            values.push(
              detalle
            );
          }
        }
      );
  }

  if (
    !values.length &&
    normalizarFlag(
      salud
        .alergiasFlag
    ) === true
  ) {
    values.push(
      "Alergia informada"
    );
  }

  return uniqueText(
    values
  );
}


/*
  =========================================================
  MEDICAMENTOS
  =========================================================
*/


function getMedicamentosDetalle(
  item = {}
) {
  const salud =
    item.salud ||
    {};

  if (
    clean(
      salud
        .medicamentosDetalle
    )
  ) {
    return clean(
      salud
        .medicamentosDetalle
    );
  }

  if (
    normalizarFlag(
      salud
        .medicamentosFlag
    ) === true
  ) {
    return "Uso de medicamentos informado";
  }

  return "";
}


function getMedicamentosContraindicados(
  item = {}
) {
  const salud =
    item.salud ||
    {};

  if (
    clean(
      salud
        .medicamentosProhibidosDetalle
    )
  ) {
    return clean(
      salud
        .medicamentosProhibidosDetalle
    );
  }

  if (
    normalizarFlag(
      salud
        .medicamentosProhibidosFlag
    ) === true
  ) {
    return "Existen medicamentos contraindicados";
  }

  return "";
}

/*
  =========================================================
  INDICADORES RESUMIDOS DE SALUD
  =========================================================
*/


function tieneSituacionSaludDeclarada(
  item = {}
) {
  const salud =
    item.salud ||
    {};

  /*
    Situaciones médicas generales conocidas por este módulo.
  */
  const textosGenerales = [
    salud.emergenciaMedicaDetalle,
    salud.enfermedadBaseDetalle,
    salud.saludGeneralDetalle,
    salud.otrosAntecedentesDetalle,

    salud.discapacidadApoyoTipo,
    salud.discapacidadRecomendaciones,
    salud.discapacidadAyudaTecnica,
    salud.discapacidadAyudaIndicaciones,

    salud.neuroApoyosDetalle,
    salud.neuroEstrategias,
    salud.neuroFactores,

    salud.alergiasDetalle
  ];

  if (
    textosGenerales.some(
      (
        value
      ) =>
        Boolean(
          clean(
            value
          )
        )
    )
  ) {
    return true;
  }


  /*
    Alergias alimentarias declaradas.
  */
  if (
    Array.isArray(
      salud.alergiasAlimentarias
    ) &&
    salud.alergiasAlimentarias.length
  ) {
    return true;
  }


  /*
    Flags explícitos conocidos actualmente.
  */
  const flags = [
    salud.alergiasFlag,

    salud.discapacidadApoyosFlag,
    salud.neuroApoyosFlag,

    salud.emergenciaMedicaFlag,
    salud.enfermedadBaseFlag,

    salud.saludGeneralFlag,
    salud.otrosAntecedentesFlag
  ];

  if (
    flags.some(
      (
        value
      ) =>
        normalizarFlag(
          value
        ) === true
    )
  ) {
    return true;
  }


  return false;
}


function tieneMedicamentosDeclarados(
  item = {}
) {
  const salud =
    item.salud ||
    {};

  return (
    Boolean(
      clean(
        salud.medicamentosDetalle
      )
    ) ||
    normalizarFlag(
      salud.medicamentosFlag
    ) === true
  );
}


function tieneAlimentacionEspecial(
  item = {}
) {
  return (
    getAlimentacionValues(
      item
    ).length >
    0
  );
}


function getEstadoSituacionSalud(
  item = {}
) {
  if (
    !fichaCompleta(
      item
    )
  ) {
    return "Pendiente";
  }

  if (
    state.mode ===
      "encargado" &&
    !puedeCompartirConEncargado(
      item
    )
  ) {
    return "Restringido";
  }

  return tieneSituacionSaludDeclarada(
    item
  )
    ? "Sí"
    : "No";
}


function getEstadoMedicamentos(
  item = {}
) {
  if (
    !fichaCompleta(
      item
    )
  ) {
    return "Pendiente";
  }

  if (
    state.mode ===
      "encargado" &&
    !puedeCompartirConEncargado(
      item
    )
  ) {
    return "Restringido";
  }

  return tieneMedicamentosDeclarados(
    item
  )
    ? "Sí"
    : "No";
}


function getEstadoAlimentacion(
  item = {}
) {
  if (
    !fichaCompleta(
      item
    )
  ) {
    return "Pendiente";
  }

  if (
    state.mode ===
      "encargado" &&
    !puedeCompartirConEncargado(
      item
    )
  ) {
    return "Restringido";
  }

  return tieneAlimentacionEspecial(
    item
  )
    ? "Sí"
    : "No";
}


function getClaseEstadoResumen(
  value = ""
) {
  if (
    value ===
    "Sí"
  ) {
    return "assistance-yes";
  }

  if (
    value ===
    "No"
  ) {
    return "assistance-no";
  }

  if (
    value ===
    "Restringido"
  ) {
    return "assistance-restricted";
  }

  return "assistance-pending";
}


/*
  =========================================================
  CONTACTOS DE EMERGENCIA
  =========================================================
*/


function getContactoEmergencia(
  item = {}
) {
  const emergencia =
    item.emergencia ||
    {};

  return [
    clean(
      emergencia.nombre
    ),

    clean(
      emergencia.relacion
    ),

    clean(
      emergencia.telefono
    )
  ]
    .filter(
      Boolean
    )
    .join(
      " · "
    );
}


function getContactoEmergenciaSecundario(
  item = {}
) {
  const emergencia =
    item
      .emergenciaSecundaria ||
    {};

  if (
    emergencia.aplica ===
    false
  ) {
    return "";
  }

  return [
    clean(
      emergencia.nombre
    ),

    clean(
      emergencia.relacion
    ),

    clean(
      emergencia.telefono
    )
  ]
    .filter(
      Boolean
    )
    .join(
      " · "
    );
}


/*
  =========================================================
  CONSIDERACIONES
  =========================================================
*/


function getConsideracionesOperativas(
  item = {}
) {
  if (
    !fichaCompleta(
      item
    )
  ) {
    return [
      "Ficha médica pendiente"
    ];
  }

  if (
    !puedeMostrarDetalle(
      item
    )
  ) {
    return [
      "Información no autorizada para compartir en esta etapa"
    ];
  }

  const salud =
    item.salud ||
    {};

  const values =
    [];

  /*
    -----------------------------------------------------
    ALIMENTACION
    -----------------------------------------------------
  */

  const alimentacion =
    getAlimentacionValues(
      item
    );

  if (
    alimentacion.length
  ) {
    values.push(
      `Alimentación: ${alimentacion.join(
        ", "
      )}`
    );
  }


  /*
    -----------------------------------------------------
    ALERGIAS
    -----------------------------------------------------
  */

  const alergias =
    getAlergiasValues(
      item
    );

  if (
    alergias.length
  ) {
    values.push(
      `Alergias: ${alergias.join(
        ", "
      )}`
    );
  }


  /*
    -----------------------------------------------------
    MEDICACION
    -----------------------------------------------------
  */

  const medicamentos =
    getMedicamentosDetalle(
      item
    );

  if (
    medicamentos
  ) {
    /*
      En encargado solo indicamos existencia.

      En equipo de viaje sí mostramos
      el detalle disponible.
    */
    if (
      state.mode ===
      "encargado"
    ) {
      values.push(
        "Utiliza medicamentos"
      );
    } else {
      values.push(
        `Medicamentos: ${medicamentos}`
      );
    }
  }


  /*
    -----------------------------------------------------
    CONTRAINDICACIONES
    -----------------------------------------------------
  */

  const contraindicados =
    getMedicamentosContraindicados(
      item
    );

  if (
    contraindicados
  ) {
    if (
      state.mode ===
      "encargado"
    ) {
      values.push(
        "Existen medicamentos contraindicados"
      );
    } else {
      values.push(
        `Medicamentos contraindicados: ${contraindicados}`
      );
    }
  }


  /*
    -----------------------------------------------------
    ASISTENCIA / DISCAPACIDAD
    -----------------------------------------------------
  */

  if (
    clean(
      salud
        .discapacidadApoyoTipo
    )
  ) {
    values.push(
      clean(
        salud
          .discapacidadApoyoTipo
      )
    );
  }

  if (
    clean(
      salud
        .discapacidadRecomendaciones
    )
  ) {
    values.push(
      clean(
        salud
          .discapacidadRecomendaciones
      )
    );
  }

  if (
    clean(
      salud
        .discapacidadAyudaIndicaciones
    )
  ) {
    values.push(
      clean(
        salud
          .discapacidadAyudaIndicaciones
      )
    );
  }


  /*
    -----------------------------------------------------
    NEURODIVERGENCIA:
    preferimos estrategias prácticas antes que
    simplemente repetir diagnósticos.
    -----------------------------------------------------
  */

  if (
    clean(
      salud
        .neuroApoyosDetalle
    )
  ) {
    values.push(
      clean(
        salud
          .neuroApoyosDetalle
      )
    );
  }

  if (
    clean(
      salud
        .neuroEstrategias
    )
  ) {
    values.push(
      clean(
        salud
          .neuroEstrategias
      )
    );
  }

  if (
    clean(
      salud
        .neuroFactores
    )
  ) {
    values.push(
      `Considerar factores de sobrecarga: ${clean(
        salud
          .neuroFactores
      )}`
    );
  }


  /*
    -----------------------------------------------------
    ANTECEDENTES ADICIONALES.

    Solo para equipo de viaje.
    -----------------------------------------------------
  */

  if (
    state.mode ===
    "viaje"
  ) {
    if (
      clean(
        salud
          .emergenciaMedicaDetalle
      )
    ) {
      values.push(
        `Emergencia médica: ${clean(
          salud
            .emergenciaMedicaDetalle
        )}`
      );
    }

    if (
      clean(
        salud
          .enfermedadBaseDetalle
      )
    ) {
      values.push(
        `Antecedente médico: ${clean(
          salud
            .enfermedadBaseDetalle
        )}`
      );
    }

    if (
      clean(
        salud
          .saludGeneralDetalle
      )
    ) {
      values.push(
        clean(
          salud
            .saludGeneralDetalle
        )
      );
    }

    if (
      clean(
        salud
          .otrosAntecedentesDetalle
      )
    ) {
      values.push(
        clean(
          salud
            .otrosAntecedentesDetalle
        )
      );
    }
  }

  return uniqueText(
    values
  );
}


/*
  =========================================================
  CONSIDERACION RESUMIDA
  PAGINA 1
  =========================================================
*/


function getConsideracionResumen(
  item = {}
) {
  if (
    !fichaCompleta(
      item
    )
  ) {
    return "Ficha pendiente";
  }


  /*
    El delegado no recibe consideraciones clínicas
    detalladas en la tabla.

    Su documento solamente informa:
      - situación de salud;
      - medicamentos;
      - alimentación especial.
  */
  if (
    state.mode ===
    "encargado"
  ) {
    if (
      !puedeCompartirConEncargado(
        item
      )
    ) {
      return "Información restringida";
    }

    return "";
  }


  /*
    ADULTOS ACOMPAÑANTES
  */

  if (
    !puedeCompartirConEquipoViaje(
      item
    )
  ) {
    return "Información restringida";
  }

  const salud =
    item.salud ||
    {};

  const labels =
    [];


  /*
    Si existe alguna situación general de salud,
    advertimos que debe revisarse el detalle.
  */
  if (
    tieneSituacionSaludDeclarada(
      item
    )
  ) {
    labels.push(
      "Ver situación de salud"
    );
  }


  /*
    Medicamentos.
  */
  if (
    tieneMedicamentosDeclarados(
      item
    )
  ) {
    labels.push(
      "Medicamentos"
    );
  }


  /*
    Alimentación especial.
  */
  if (
    tieneAlimentacionEspecial(
      item
    )
  ) {
    labels.push(
      getAlimentacionValues(
        item
      ).join(
        ", "
      )
    );
  }


  /*
    Contraindicaciones.
  */
  if (
    getMedicamentosContraindicados(
      item
    )
  ) {
    labels.push(
      "Contraindicaciones"
    );
  }


  /*
    Requiere asistencia deja de ser una columna.

    Solo se informa como una consideración cuando
    la ficha realmente declaró que requiere apoyo.
  */
  if (
    getNecesitaAsistencia(
      item
    ) === true
  ) {
    labels.push(
      "Requiere apoyo / asistencia"
    );
  }


  const result =
    uniqueText(
      labels
    );

  if (
    !result.length
  ) {
    return "Sin consideraciones";
  }

  return result.join(
    " · "
  );
}

/*
  =========================================================
  SABER SI UNA PERSONA DEBE SALIR EN EL DETALLE
  =========================================================
*/


function debeAparecerEnDetalle(
  item = {}
) {
  /*
    El documento del Delegado nunca tiene página
    individual de detalle.
  */
  if (
    state.mode ===
    "encargado"
  ) {
    return false;
  }


  /*
    Las fichas pendientes quedan identificadas
    solamente en la tabla resumen.
  */
  if (
    !fichaCompleta(
      item
    )
  ) {
    return false;
  }


  /*
    Respetamos cualquier bloqueo explícito
    de uso interno.
  */
  if (
    !puedeCompartirConEquipoViaje(
      item
    )
  ) {
    return false;
  }


  /*
    Aparece en detalle si existe cualquier
    información realmente relevante.
  */
  if (
    tieneSituacionSaludDeclarada(
      item
    )
  ) {
    return true;
  }


  if (
    tieneMedicamentosDeclarados(
      item
    )
  ) {
    return true;
  }


  if (
    tieneAlimentacionEspecial(
      item
    )
  ) {
    return true;
  }


  if (
    getAlergiasValues(
      item
    ).length
  ) {
    return true;
  }


  if (
    getMedicamentosContraindicados(
      item
    )
  ) {
    return true;
  }


  if (
    getNecesitaAsistencia(
      item
    ) === true
  ) {
    return true;
  }


  return false;
}

/*
  =========================================================
  RENDER GENERAL
  =========================================================
*/


function render() {
  renderMode();

  renderHeader();

  renderPrivacy();

  renderKpis();

  renderTable();

  renderResponsibility();

  renderDetails();
}


/*
  =========================================================
  MODO
  =========================================================
*/


function renderMode() {
  $("btnModoEncargado")
    ?.classList
    .toggle(
      "active",
      state.mode ===
        "encargado"
    );

  $("btnModoViaje")
    ?.classList
    .toggle(
      "active",
      state.mode ===
        "viaje"
    );
}


/*
  =========================================================
  HEADER
  =========================================================
*/


function renderHeader() {
  const group =
    state.group ||
    {};

  const subtitle =
    [
      group.aliasGrupo ||
      group.nombreGrupo ||
      state.groupId,

      group.colegio,

      group.curso,

      group.anoViaje
        ? `Viaje ${group.anoViaje}`
        : ""
    ]
      .filter(
        Boolean
      )
      .join(
        " · "
      );

  $("groupSubtitle")
    .textContent =
      subtitle;


  $("documentType")
    .textContent =
      state.mode ===
        "encargado"
        ? "Delegado"
        : "Adultos acompañantes";


  $("detailsSubtitle")
    .textContent =
      "Se muestran únicamente pasajeros con antecedentes, indicaciones o necesidades relevantes para la operación del viaje.";
}

/*
  =========================================================
  PRIVACIDAD
  =========================================================
*/


function renderPrivacy() {
  if (
    state.mode ===
    "encargado"
  ) {
    $("privacyNotice")
      .innerHTML = `
        <strong>
          Privacidad:
        </strong>

        Este documento entrega al delegado únicamente
        una visión resumida de las situaciones de salud
        declaradas por los pasajeros.

        No se entregan diagnósticos, medicamentos específicos
        ni antecedentes médicos detallados.

        Cuando la persona responsable no ha autorizado
        compartir esta información, los campos correspondientes
        aparecen como <strong>Restringido</strong>.
      `;

    return;
  }


  $("privacyNotice")
    .innerHTML = `
      <strong>
        Uso durante el viaje:
      </strong>

      Documento destinado exclusivamente a los adultos
      acompañantes que viajan con el grupo.

      Contiene información necesaria para seguridad,
      cuidado, acompañamiento y coordinación operativa
      durante el viaje y debe mantenerse bajo acceso
      restringido.
    `;
}

/*
  =========================================================
  KPIS
  =========================================================
*/


function renderKpis() {
  const total =
    state.items.length;

  const completas =
    state.items.filter(
      fichaCompleta
    ).length;

  const pendientes =
    total -
    completas;


  const conSituacionSalud =
    state.items.filter(
      (
        item
      ) =>
        fichaCompleta(
          item
        ) &&
        puedeMostrarDetalle(
          item
        ) &&
        tieneSituacionSaludDeclarada(
          item
        )
    ).length;


  const conAlimentacionEspecial =
    state.items.filter(
      (
        item
      ) =>
        fichaCompleta(
          item
        ) &&
        puedeMostrarDetalle(
          item
        ) &&
        tieneAlimentacionEspecial(
          item
        )
    ).length;


  $("kpiContainer")
    .innerHTML = `
      <div class="summary-item">
        <span class="summary-label">
          Pasajeros
        </span>

        <span class="summary-value">
          ${total}
        </span>
      </div>


      <div class="summary-item">
        <span class="summary-label">
          Fichas completas
        </span>

        <span class="summary-value">
          ${completas}
        </span>
      </div>


      <div class="summary-item">
        <span class="summary-label">
          Fichas pendientes
        </span>

        <span class="summary-value">
          ${pendientes}
        </span>
      </div>


      <div class="summary-item">
        <span class="summary-label">
          Con situación de salud
        </span>

        <span class="summary-value">
          ${conSituacionSalud}
        </span>
      </div>


      <div class="summary-item">
        <span class="summary-label">
          Alimentación especial
        </span>

        <span class="summary-value">
          ${conAlimentacionEspecial}
        </span>
      </div>
    `;
}


/*
  =========================================================
  TABLA RESUMEN
  =========================================================
*/


function renderTable() {
  /*
    =====================================================
    DELEGADO
    =====================================================
  */

  if (
    state.mode ===
    "encargado"
  ) {
    $("tableHead")
      .innerHTML = `
        <tr>
          <th class="col-number">
            #
          </th>

          <th class="col-passenger">
            Pasajero
          </th>

          <th>
            Ficha
          </th>

          <th>
            Situación de salud
          </th>

          <th>
            Medicamentos
          </th>

          <th>
            Alimentación especial
          </th>
        </tr>
      `;


    $("summaryLegend")
      .innerHTML = `
        <span>
          <strong>Sí:</strong>
          existe una situación declarada.
        </span>

        <span>
          <strong>No:</strong>
          no se registra una situación en esa categoría.
        </span>

        <span>
          <strong>Restringido:</strong>
          información no autorizada para ser compartida con el delegado.
        </span>

        <span>
          <strong>Pendiente:</strong>
          ficha médica aún incompleta.
        </span>
      `;


    $("tableBody")
      .innerHTML =
        state.items
          .map(
            (
              item,
              index
            ) => {
              const completa =
                fichaCompleta(
                  item
                );

              const fichaTexto =
                completa
                  ? "Completa"
                  : "Pendiente";

              const fichaClase =
                completa
                  ? "status-complete"
                  : "status-pending";


              const situacion =
                getEstadoSituacionSalud(
                  item
                );

              const medicamentos =
                getEstadoMedicamentos(
                  item
                );

              const alimentacion =
                getEstadoAlimentacion(
                  item
                );


              return `
                <tr>

                  <td class="col-number">
                    ${index + 1}
                  </td>

                  <td class="passenger-name">
                    ${escapeHtml(
                      passengerName(
                        item
                      )
                    )}
                  </td>

                  <td class="${fichaClase}">
                    ${escapeHtml(
                      fichaTexto
                    )}
                  </td>

                  <td class="${getClaseEstadoResumen(
                    situacion
                  )}">
                    ${escapeHtml(
                      situacion
                    )}
                  </td>

                  <td class="${getClaseEstadoResumen(
                    medicamentos
                  )}">
                    ${escapeHtml(
                      medicamentos
                    )}
                  </td>

                  <td class="${getClaseEstadoResumen(
                    alimentacion
                  )}">
                    ${escapeHtml(
                      alimentacion
                    )}
                  </td>

                </tr>
              `;
            }
          )
          .join("");

    return;
  }


  /*
    =====================================================
    ADULTOS ACOMPAÑANTES
    =====================================================
  */

  $("tableHead")
    .innerHTML = `
      <tr>
        <th class="col-number">
          #
        </th>

        <th class="col-passenger">
          Pasajero
        </th>

        <th>
          Ficha
        </th>

        <th>
          Situación de salud
        </th>

        <th>
          Medicamentos
        </th>

        <th>
          Alimentación
        </th>

        <th class="col-considerations">
          Consideraciones
        </th>
      </tr>
    `;


  $("summaryLegend")
    .innerHTML = `
      <span>
        <strong>Ver detalle:</strong>
        existen antecedentes o indicaciones relevantes.
      </span>

      <span>
        <strong>Pendiente:</strong>
        ficha médica aún incompleta.
      </span>
    `;


  $("tableBody")
    .innerHTML =
      state.items
        .map(
          (
            item,
            index
          ) => {
            const completa =
              fichaCompleta(
                item
              );

            const fichaTexto =
              completa
                ? "Completa"
                : "Pendiente";

            const fichaClase =
              completa
                ? "status-complete"
                : "status-pending";


            const situacion =
              completa
                ? (
                    tieneSituacionSaludDeclarada(
                      item
                    )
                      ? "Sí"
                      : "No"
                  )
                : "Pendiente";


            const medicamentos =
              completa
                ? (
                    tieneMedicamentosDeclarados(
                      item
                    )
                      ? "Sí"
                      : "No"
                  )
                : "Pendiente";


            let alimentacion =
              "No";

            if (
              !completa
            ) {
              alimentacion =
                "Pendiente";
            } else {
              const alimentacionValues =
                getAlimentacionValues(
                  item
                );

              if (
                alimentacionValues.length
              ) {
                alimentacion =
                  alimentacionValues.join(
                    ", "
                  );
              }
            }


            const consideracion =
              getConsideracionResumen(
                item
              );


            let consideracionClase =
              "consideration-text";

            if (
              consideracion ===
              "Sin consideraciones"
            ) {
              consideracionClase =
                "consideration-none";
            }

            if (
              consideracion ===
              "Ficha pendiente"
            ) {
              consideracionClase =
                "consideration-pending";
            }

            if (
              consideracion ===
              "Información restringida"
            ) {
              consideracionClase =
                "consideration-restricted";
            }


            return `
              <tr>

                <td class="col-number">
                  ${index + 1}
                </td>

                <td class="passenger-name">
                  ${escapeHtml(
                    passengerName(
                      item
                    )
                  )}
                </td>

                <td class="${fichaClase}">
                  ${escapeHtml(
                    fichaTexto
                  )}
                </td>

                <td class="${getClaseEstadoResumen(
                  situacion
                )}">
                  ${escapeHtml(
                    situacion
                  )}
                </td>

                <td class="${getClaseEstadoResumen(
                  medicamentos
                )}">
                  ${escapeHtml(
                    medicamentos
                  )}
                </td>

                <td>
                  ${escapeHtml(
                    alimentacion
                  )}
                </td>

                <td class="${consideracionClase}">
                  ${escapeHtml(
                    consideracion
                  )}
                </td>

              </tr>
            `;
          }
        )
        .join("");
}


/*
  =========================================================
  RESPONSABILIDAD / ALCANCE
  =========================================================
*/
function renderResponsibility() {
  if (
    state.mode ===
    "encargado"
  ) {
    $("responsibilityNote")
      .innerHTML = `
        <strong>
          Alcance del resumen:
        </strong>

        Este documento permite al delegado identificar de forma
        general a los pasajeros que han declarado situaciones de
        salud, uso de medicamentos o alimentación especial.

        No reemplaza las indicaciones entregadas directamente a
        los adultos acompañantes responsables durante el viaje.
      `;

    return;
  }


  $("responsibilityNote")
    .innerHTML = `
      <strong>
        Asistencia y acompañamiento:
      </strong>

      Las situaciones, antecedentes e indicaciones particulares
      informadas para cada viajero deben ser conocidas y consideradas
      por los adultos acompañantes responsables del grupo.

      Cuando una ficha indique expresamente que una persona requiere
      apoyo o asistencia, dicha necesidad se señala dentro de sus
      consideraciones específicas.

      Turismo Rai Trai facilita la coordinación y entrega
      oportunamente la información disponible para contribuir
      a una operación segura y adecuada.
    `;
}
/*
  =========================================================
  DETALLE
  =========================================================
*/


function renderDetails() {
  /*
    DELEGADO:
    solo documento resumen.
  */
  if (
    state.mode ===
    "encargado"
  ) {
    $("detailsContainer")
      .innerHTML =
        "";

    $("noDetails")
      ?.classList
      .add(
        "hidden"
      );

    $("detailsPage")
      ?.classList
      .add(
        "hidden"
      );

    return;
  }


  /*
    ADULTOS ACOMPAÑANTES
  */
  const items =
    state.items.filter(
      debeAparecerEnDetalle
    );


  if (
    !items.length
  ) {
    $("detailsContainer")
      .innerHTML =
        "";

    $("noDetails")
      ?.classList
      .remove(
        "hidden"
      );

    $("detailsPage")
      ?.classList
      .add(
        "hidden"
      );

    return;
  }


  $("detailsPage")
    ?.classList
    .remove(
      "hidden"
    );


  $("noDetails")
    ?.classList
    .add(
      "hidden"
    );


  $("detailsContainer")
    .innerHTML =
      items
        .map(
          renderDetailCard
        )
        .join("");
}


function renderDetailCard(
  item = {}
) {
  const nombre =
    passengerName(
      item
    );

  const salud =
    item.salud ||
    {};

  const rows =
    [];


  /*
    =====================================================
    SITUACIÓN DE SALUD / ANTECEDENTES
    =====================================================
  */

  const situaciones =
    [];


  if (
    clean(
      salud.emergenciaMedicaDetalle
    )
  ) {
    situaciones.push(
      `Emergencia médica: ${clean(
        salud.emergenciaMedicaDetalle
      )}`
    );
  }


  if (
    clean(
      salud.enfermedadBaseDetalle
    )
  ) {
    situaciones.push(
      clean(
        salud.enfermedadBaseDetalle
      )
    );
  }


  if (
    clean(
      salud.saludGeneralDetalle
    )
  ) {
    situaciones.push(
      clean(
        salud.saludGeneralDetalle
      )
    );
  }


  if (
    clean(
      salud.otrosAntecedentesDetalle
    )
  ) {
    situaciones.push(
      clean(
        salud.otrosAntecedentesDetalle
      )
    );
  }


  const alergias =
    getAlergiasValues(
      item
    );

  if (
    alergias.length
  ) {
    situaciones.push(
      `Alergias: ${alergias.join(
        ", "
      )}`
    );
  }


  if (
    situaciones.length
  ) {
    rows.push({
      label:
        "Situación de salud",

      value:
        uniqueText(
          situaciones
        ).join(
          " · "
        )
    });
  }


  /*
    =====================================================
    MEDICAMENTOS
    =====================================================
  */

  const medicamentos =
    getMedicamentosDetalle(
      item
    );

  if (
    medicamentos
  ) {
    rows.push({
      label:
        "Medicamentos",

      value:
        medicamentos
    });
  }


  const contraindicados =
    getMedicamentosContraindicados(
      item
    );

  if (
    contraindicados
  ) {
    rows.push({
      label:
        "Contraindicaciones",

      value:
        contraindicados
    });
  }


  /*
    =====================================================
    ALIMENTACIÓN
    =====================================================
  */

  const alimentacion =
    getAlimentacionValues(
      item
    );

  if (
    alimentacion.length
  ) {
    rows.push({
      label:
        "Alimentación",

      value:
        alimentacion.join(
          ", "
        )
    });
  }


  /*
    =====================================================
    APOYOS / DISCAPACIDAD
    =====================================================
  */

  const apoyos =
    [];


  if (
    clean(
      salud.discapacidadApoyoTipo
    )
  ) {
    apoyos.push(
      clean(
        salud.discapacidadApoyoTipo
      )
    );
  }


  if (
    clean(
      salud.discapacidadRecomendaciones
    )
  ) {
    apoyos.push(
      clean(
        salud.discapacidadRecomendaciones
      )
    );
  }


  if (
    clean(
      salud.discapacidadAyudaIndicaciones
    )
  ) {
    apoyos.push(
      clean(
        salud.discapacidadAyudaIndicaciones
      )
    );
  }


  if (
    apoyos.length
  ) {
    rows.push({
      label:
        "Apoyo / asistencia",

      value:
        uniqueText(
          apoyos
        ).join(
          " · "
        )
    });
  }


  /*
    =====================================================
    NEURODIVERGENCIA / APOYOS PRÁCTICOS
    =====================================================
  */

  const neuro =
    [];


  if (
    clean(
      salud.neuroApoyosDetalle
    )
  ) {
    neuro.push(
      clean(
        salud.neuroApoyosDetalle
      )
    );
  }


  if (
    clean(
      salud.neuroEstrategias
    )
  ) {
    neuro.push(
      clean(
        salud.neuroEstrategias
      )
    );
  }


  if (
    clean(
      salud.neuroFactores
    )
  ) {
    neuro.push(
      `Factores de sobrecarga: ${clean(
        salud.neuroFactores
      )}`
    );
  }


  if (
    neuro.length
  ) {
    rows.push({
      label:
        "Indicaciones",

      value:
        uniqueText(
          neuro
        ).join(
          " · "
        )
    });
  }


  /*
    =====================================================
    REQUIERE ASISTENCIA

    Solo aparece cuando realmente fue declarado.
    Nunca como campo fijo.
    =====================================================
  */

  if (
    getNecesitaAsistencia(
      item
    ) === true &&
    !apoyos.length &&
    !neuro.length
  ) {
    rows.push({
      label:
        "Apoyo / asistencia",

      value:
        "La ficha indica que requiere asistencia o apoyo durante el viaje."
    });
  }


  /*
    =====================================================
    CONTACTOS DE EMERGENCIA
    =====================================================
  */

  const emergencia1 =
    getContactoEmergencia(
      item
    );

  const emergencia2 =
    getContactoEmergenciaSecundario(
      item
    );


  if (
    emergencia1
  ) {
    rows.push({
      label:
        "Emergencia 1",

      value:
        emergencia1
    });
  }


  if (
    emergencia2
  ) {
    rows.push({
      label:
        "Emergencia 2",

      value:
        emergencia2
    });
  }


  /*
    Seguridad por si una ficha fue detectada como relevante
    pero no logramos construir una fila textual.
  */
  if (
    !rows.length
  ) {
    rows.push({
      label:
        "Consideraciones",

      value:
        "Existe información operativa asociada a esta ficha."
    });
  }


  return `
    <article class="detail-card">

      <div class="detail-card-head">

        <div class="detail-name">
          ${escapeHtml(
            nombre
          )}
        </div>

        <div class="detail-assistance assistance-yes">
          Revisar indicaciones
        </div>

      </div>


      <div class="detail-body">

        ${
          rows
            .map(
              (
                row
              ) => `
                <div class="detail-row">

                  <div class="detail-label">
                    ${escapeHtml(
                      row.label
                    )}
                  </div>

                  <div class="detail-value">
                    ${escapeHtml(
                      row.value
                    )}
                  </div>

                </div>
              `
            )
            .join("")
        }

      </div>

    </article>
  `;
}

/*
  =========================================================
  ERROR
  =========================================================
*/


function showError(
  message
) {
  $("loadingBox")
    ?.classList
    .add(
      "hidden"
    );

  $("content")
    ?.classList
    .add(
      "hidden"
    );

  $("errorBox")
    .textContent =
      message;

  $("errorBox")
    ?.classList
    .remove(
      "hidden"
    );
}
