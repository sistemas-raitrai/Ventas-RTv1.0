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
      Gestión médica solo considera pasajeros
      que actualmente viajan.

      Los anulados quedan fuera.
    */
    state.items =
      allItems
        .filter(
          (
            item
          ) =>
            !isCancelled(
              item
            )
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

  if (
    !puedeMostrarDetalle(
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
    Alimentación.
  */
  const alimentacion =
    getAlimentacionValues(
      item
    );

  if (
    alimentacion.length
  ) {
    labels.push(
      alimentacion.join(
        ", "
      )
    );
  }


  /*
    Alergias.
  */
  const alergias =
    getAlergiasValues(
      item
    );

  if (
    alergias.length
  ) {
    labels.push(
      "Alergia"
    );
  }


  /*
    Medicamentos.
  */
  if (
    getMedicamentosDetalle(
      item
    )
  ) {
    labels.push(
      "Medicación"
    );
  }


  /*
    Consideraciones de apoyo.
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
        .discapacidadAyudaIndicaciones
    ) ||
    clean(
      salud
        .neuroApoyosDetalle
    ) ||
    clean(
      salud
        .neuroEstrategias
    ) ||
    clean(
      salud
        .neuroFactores
    )
  ) {
    labels.push(
      "Ver indicaciones"
    );
  }


  /*
    En modo viaje también advertimos
    antecedentes médicos generales.
  */
  if (
    state.mode ===
      "viaje" &&
    (
      clean(
        salud
          .emergenciaMedicaDetalle
      ) ||
      clean(
        salud
          .enfermedadBaseDetalle
      ) ||
      clean(
        salud
          .saludGeneralDetalle
      ) ||
      clean(
        salud
          .otrosAntecedentesDetalle
      )
    )
  ) {
    labels.push(
      "Antecedente médico"
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
  if (
    !fichaCompleta(
      item
    )
  ) {
    /*
      Las fichas pendientes NO llenan la página de detalle.
      Ya están claramente identificadas en el resumen.
    */
    return false;
  }

  /*
    Si existe información restringida para encargado,
    sí la mostramos como aviso breve.
  */
  if (
    state.mode ===
      "encargado" &&
    !puedeCompartirConEncargado(
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

  const consideraciones =
    getConsideracionesOperativas(
      item
    );

  return (
    consideraciones.length >
    0
  );
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
      group
        .aliasGrupo ||
      group
        .nombreGrupo ||
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
        ? "Encargado de grupo"
        : "Equipo de viaje";

  $("detailsSubtitle")
    .textContent =
      state.mode ===
        "encargado"
        ? "Se muestran únicamente pasajeros con información operativa relevante autorizada para esta etapa."
        : "Se muestran únicamente pasajeros con antecedentes, indicaciones o necesidades relevantes para la operación del viaje.";
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

        Este resumen muestra únicamente información
        autorizada para ser compartida con el/la
        encargado(a) del grupo.

        Cuando una persona no ha autorizado esta entrega,
        sus antecedentes médicos específicos permanecen
        restringidos.
      `;

    return;
  }

  $("privacyNotice")
    .innerHTML = `
      <strong>
        Uso durante el viaje:
      </strong>

      Documento destinado a los adultos responsables
      del grupo durante el viaje.

      La información debe utilizarse exclusivamente
      para fines de seguridad, cuidado, asistencia
      y coordinación operativa.
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

  const asistenciaSi =
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
        getNecesitaAsistencia(
          item
        ) === true
    ).length;

  const asistenciaNo =
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
        getNecesitaAsistencia(
          item
        ) === false
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
          Pendientes
        </span>

        <span class="summary-value">
          ${pendientes}
        </span>
      </div>

      <div class="summary-item">
        <span class="summary-label">
          Requieren asistencia
        </span>

        <span class="summary-value">
          ${asistenciaSi}
        </span>
      </div>

      <div class="summary-item">
        <span class="summary-label">
          No requieren asistencia
        </span>

        <span class="summary-value">
          ${asistenciaNo}
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

            const asistencia =
              getNecesitaAsistenciaTexto(
                item
              );

            let asistenciaClase =
              "assistance-pending";

            if (
              asistencia ===
              "Sí"
            ) {
              asistenciaClase =
                "assistance-yes";
            }

            if (
              asistencia ===
              "No"
            ) {
              asistenciaClase =
                "assistance-no";
            }

            if (
              asistencia ===
              "Restringido"
            ) {
              asistenciaClase =
                "assistance-restricted";
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

                <td class="${asistenciaClase}">
                  ${escapeHtml(
                    asistencia
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
  $("responsibilityNote")
    .innerHTML = `
      <strong>
        Asistencia y acompañamiento:
      </strong>

      La asistencia, acompañamiento y cumplimiento de las
      indicaciones particulares informadas para cada viajero
      corresponden a los adultos responsables que acompañan
      al grupo.

      Turismo Rai Trai facilita la coordinación y entrega
      oportunamente la información disponible para contribuir
      a una operación segura y adecuada.

      La entrega de este resumen forma parte de las medidas
      de apoyo y coordinación implementadas por Turismo Rai Trai
      antes y durante el viaje.
    `;
}


/*
  =========================================================
  DETALLE
  =========================================================
*/


function renderDetails() {
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

    /*
      Si realmente no existe ningún detalle,
      ocultamos página 2 al imprimir y en pantalla.
    */
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

  /*
    PRIVACIDAD ENCARGADO
  */
  if (
    state.mode ===
      "encargado" &&
    !puedeCompartirConEncargado(
      item
    )
  ) {
    return `
      <article class="detail-card restricted-card">

        <div class="detail-card-head">

          <div class="detail-name">
            ${escapeHtml(
              nombre
            )}
          </div>

          <div class="detail-assistance assistance-restricted">
            Información restringida
          </div>

        </div>

        <div class="detail-body">

          <div class="restricted-text">
            Existen antecedentes asociados a esta ficha,
            pero la persona responsable no ha autorizado
            su entrega al encargado del grupo en esta etapa.
          </div>

        </div>

      </article>
    `;
  }


  const asistencia =
    getNecesitaAsistenciaTexto(
      item
    );

  const asistenciaClase =
    asistencia ===
      "Sí"
      ? "assistance-yes"
      : asistencia ===
          "No"
        ? "assistance-no"
        : "assistance-pending";


  const rows =
    [];


  /*
    CONSIDERACIONES
  */

  const consideraciones =
    getConsideracionesOperativas(
      item
    );

  if (
    consideraciones.length
  ) {
    rows.push({
      label:
        "Consideraciones",

      value:
        consideraciones.join(
          " · "
        )
    });
  }


  /*
    CONTACTO DE EMERGENCIA
    Solo equipo de viaje.
  */

  if (
    state.mode ===
    "viaje"
  ) {
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
  }


  /*
    Si por alguna razón la persona quedó marcada
    para detalle exclusivamente por "Sí asistencia"
    pero no existen textos adicionales.
  */

  if (
    !rows.length
  ) {
    rows.push({
      label:
        "Consideraciones",

      value:
        asistencia ===
          "Sí"
          ? "La ficha indica que requiere asistencia. Revisar coordinación previa al viaje."
          : "Existe información operativa asociada a esta ficha."
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

        <div class="detail-assistance ${asistenciaClase}">
          Asistencia:
          ${escapeHtml(
            asistencia
          )}
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
