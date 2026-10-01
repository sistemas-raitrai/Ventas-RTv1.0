import { db, auth, getVentasUser } from "./firebase-init.js";
import { collection, collectionGroup, query, where, getDocs, getDoc, doc } from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";
import { clean, normalize, escapeHtml, passengerName, passengerDocument, onAuthStateChanged, fichaCompleta, isCancelled, loadGroupInscriptions } from "./ficha-medica-common.js";

// Mismos criterios de la versión de resumen operativo recibida.
const state = { mode: "viaje" };

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

  /*
    Buscamos todas las variantes históricas
    que pueden existir en las fichas.
  */
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


  /*
    REGLA ACTUAL:

    Solo restringimos cuando existe una negativa
    explícita.

    Esto es importante porque muchas fichas antiguas
    fueron completadas antes de que existiera esta
    pregunta y, por lo tanto, el campo simplemente
    no existe.
  */
  const existeNegativaExplicita =
    candidatos.some(
      (
        value
      ) =>
        value === false ||
        normalizarFlag(
          value
        ) === false
    );


  if (
    existeNegativaExplicita
  ) {
    return false;
  }


  /*
    Si existe autorización explícita, naturalmente
    también permitimos compartir.
  */
  const existeAutorizacionExplicita =
    candidatos.some(
      (
        value
      ) =>
        value === true ||
        normalizarFlag(
          value
        ) === true
    );


  if (
    existeAutorizacionExplicita
  ) {
    return true;
  }


  /*
    Fichas antiguas o fichas que nunca tuvieron
    esta pregunta:

    ausencia de respuesta NO equivale a rechazo.

    Por omisión se permite incluir la información
    en el resumen del Delegado.
  */
  return true;
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



function descripcionOperativa(p) {
  const detalles = getConsideracionesOperativas(p);
  if (fichaCompleta(p) && puedeCompartirConEquipoViaje(p) && !detalles.length) {
    if (tieneSituacionSaludDeclarada(p)) detalles.push('Situación de salud declarada; revisar ficha para conocer el detalle');
    if (getNecesitaAsistencia(p) === true) detalles.push('Requiere asistencia o apoyo durante el viaje');
  }
  return detalles.join(' · ');
}

const $g = id => document.getElementById(id);
const metricas = [
  ['total','Viajan'], ['completas','Completas'], ['pendientes','Pendientes'],
  ['salud','Salud'], ['alergias','Alergias'], ['dieta','Alimentación'],
  ['medicamentos','Medicamentos'], ['contraindicados','Contraindicados'],
  ['apoyo','Apoyo'], ['noDelegado','No autoriza delegado'], ['restringidas','Uso interno restringido']
];
function rolVendedor(user) {
  return /^vendedor(?:a|\(a\))?$/.test(normalize(user?.rol).replace(/\s+/g,''));
}
function fechaISO(v) {
  if (!v) return '';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0,10);
  const d = v?.toDate ? v.toDate() : v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
}
const fechaTexto = v => v ? v.split('-').reverse().join('-') : 'Sin fecha';
const e = escapeHtml;
const unicos = values => [...new Set(values.filter(Boolean))];

export function crearResumenSaludGeneral({ getUsuario, getAno }) {
  let grupos = [], visibles = [], ocupado = false, ciclo = 0, foco = null;
  function permitido() {
    const user = getUsuario();
    const real = getVentasUser(auth.currentUser?.email || '');
    return !!auth.currentUser && !!clean(user?.rol) && !!clean(real?.rol)
      && !rolVendedor(user) && !rolVendedor(real);
  }
  function validar() {
    if (!permitido()) throw new Error('No tienes acceso al resumen general de salud.');
  }
  function actualizarVisibilidad() {
    $g('btnResumenSaludGeneral')?.classList.toggle('hidden', !permitido());
    if (!permitido()) { grupos = []; visibles = []; ciclo++; cerrar(); }
  }
  function montar() {
    if ($g('rsgModal')) return;
    const css = document.createElement('style');
    css.textContent = `
      #rsgModal{position:fixed;inset:0;background:#17203399;z-index:10000;padding:16px;display:flex;align-items:center;justify-content:center}
      #rsgModal[hidden]{display:none!important}
      #rsgModal .rsg-card{width:min(1500px,100%);max-height:calc(100dvh - 32px);max-height:min(94vh,1100px);background:white;border-radius:14px;display:flex;flex-direction:column;overflow:hidden;color:#172033;font:14px Arial,sans-serif}
      #rsgModal .rsg-head{display:flex;justify-content:space-between;align-items:center;padding:16px;border-bottom:1px solid #ddd;gap:12px;flex-shrink:0}
      #rsgModal h2{margin:0;font-size:20px}#rsgModal p{margin:6px 0}
      #rsgModal .rsg-scroll{overflow:auto;-webkit-overflow-scrolling:touch;padding:16px}
      #rsgModal .rsg-tools{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px}
      #rsgModal label{display:flex;flex-direction:column;gap:4px;font-size:12px}
      #rsgModal input,#rsgModal select,#rsgModal button{font:inherit;padding:8px;border:1px solid #cbd5e1;border-radius:7px}
      #rsgModal button{cursor:pointer;background:#f1f5f9;color:#172033}#rsgModal button:disabled{opacity:.5;cursor:default}
      #rsgModal .rsg-kpis{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}
      #rsgModal .rsg-kpis span{background:#eef2f6;padding:9px;border-radius:7px}
      #rsgModal .rsg-table{overflow:auto}#rsgModal table{width:100%;border-collapse:collapse;font-size:12px}
      #rsgModal th,#rsgModal td{padding:9px;border-bottom:1px solid #dde3eb;text-align:left;vertical-align:top}
      #rsgModal th{background:#eef2f6;white-space:nowrap}#rsgModal .rsg-num{text-align:center}
      #rsgModal .rsg-error{color:#a12626}#rsgModal details{background:#f8fafc;border-radius:8px;padding:10px;margin:8px 0}
      #rsgModal summary{cursor:pointer;font-weight:bold}#rsgModal .rsg-detail{min-width:750px}
      @media(max-width:650px){#rsgModal{padding:6px}#rsgModal .rsg-scroll{padding:10px}#rsgModal .rsg-card{max-height:96vh}#rsgModal h2{font-size:17px}}
    `;
    document.head.append(css);
    const modal = document.createElement('div');
    modal.id = 'rsgModal'; modal.hidden = true;
    modal.innerHTML = `<section class="rsg-card" role="dialog" aria-modal="true" aria-labelledby="rsgTitulo" tabindex="-1">
      <header class="rsg-head"><div><h2 id="rsgTitulo">Resumen general de salud</h2><p id="rsgSubtitulo"></p></div><button id="rsgCerrar" aria-label="Cerrar resumen">Cerrar ✕</button></header>
      <div class="rsg-scroll"><div class="rsg-tools">
        <label>Buscar grupo, ID, negocio o pasajero<input id="rsgBuscar" type="search"></label>
        <label>Destino<select id="rsgDestino"><option value="">Todos</option></select></label>
        <label>Coordinador<select id="rsgCoord"><option value="">Todos</option></select></label>
        <label>Salida desde<input id="rsgDesde" type="date"></label><label>Salida hasta<input id="rsgHasta" type="date"></label>
        <label>Situación<select id="rsgSituacion"><option value="">Todas</option><option value="pendientes">Fichas pendientes</option><option value="salud">Situación de salud</option><option value="alergias">Alergias</option><option value="dieta">Alimentación especial</option><option value="medicamentos">Medicamentos</option><option value="contraindicados">Medicamentos contraindicados</option><option value="apoyo">Necesidad de apoyo</option><option value="restringidas">Uso interno restringido</option></select></label>
      </div><div class="rsg-tools"><button id="rsgRecargar">Recargar</button><button id="rsgLimpiar">Limpiar filtros</button><button id="rsgExcel">Exportar Excel</button><button id="rsgPdf">Descargar PDF</button></div>
      <p id="rsgMensaje" role="status" aria-live="polite"></p><div id="rsgKpis" class="rsg-kpis"></div>
      <p>Las categorías pueden coincidir en una persona. Las fichas pendientes no equivalen a ausencia de situaciones médicas. Las restricciones de uso interno se respetan también en las exportaciones.</p>
      <div id="rsgTabla" class="rsg-table"></div><div id="rsgDetalles"></div></div></section>`;
    document.body.append(modal);
    $g('rsgCerrar').onclick = cerrar;
    modal.addEventListener('click', ev => { if(ev.target === modal) cerrar(); });
    modal.addEventListener('keydown', ev => {
      if(ev.key === 'Escape') cerrar();
      if(ev.key === 'Tab') {
        const focusables = [...modal.querySelectorAll('button:not(:disabled),input,select,summary')].filter(x=>x.getClientRects().length);
        const first = focusables[0], last = focusables.at(-1);
        if(ev.shiftKey && document.activeElement === first) {ev.preventDefault();last?.focus();}
        else if(!ev.shiftKey && document.activeElement === last) {ev.preventDefault();first?.focus();}
      }
    });
    ['rsgBuscar','rsgDestino','rsgCoord','rsgDesde','rsgHasta','rsgSituacion'].forEach(id => $g(id).addEventListener('input', filtrar));
    $g('rsgLimpiar').onclick = () => { ['rsgBuscar','rsgDestino','rsgCoord','rsgDesde','rsgHasta','rsgSituacion'].forEach(id=>$g(id).value=''); filtrar(); };
    $g('rsgRecargar').onclick = () => cargar();
    $g('rsgExcel').onclick = () => accion(exportarExcel);
    $g('rsgPdf').onclick = () => accion(exportarPdf);
  }
  function accion(fn) {
    try { validar(); fn(); } catch(err) { mensaje(err.message,true); }
  }
  function mensaje(texto,error=false) {
    $g('rsgMensaje').textContent = texto;
    $g('rsgMensaje').classList.toggle('rsg-error',error);
  }
  function botones() {
    ['rsgExcel','rsgPdf'].forEach(id=>$g(id).disabled=ocupado || !visibles.length || !permitido());
    $g('rsgRecargar').disabled=ocupado;
  }
  async function abrir() {
    validar(); montar(); foco=document.activeElement; $g('rsgModal').hidden=false; $g('rsgCerrar').focus();
    await cargar();
  }
  function cerrar() {
    if($g('rsgModal')) $g('rsgModal').hidden=true;
    foco?.focus();
  }
  async function cargarCoordinadores(ano) {
    const [catalogo,conjuntos] = await Promise.all([
      getDocs(collection(db,'coordinadores')),getDocs(collectionGroup(db,'conjuntos'))
    ]);
    const nombres = new Map(catalogo.docs.filter(d=>d.id!=='_borradores').map(d=>[d.id,clean(d.data().nombre)||`Coordinador ${d.id}`]));
    const porGrupo = new Map();
    for(const d of conjuntos.docs) {
      const parent = d.ref.parent.parent;
      if(!parent || parent.parent.id!=='coordinadores' || parent.id==='_borradores') continue;
      const data=d.data();
      if(data.anoViaje && Number(data.anoViaje)!==ano) continue;
      for(const gid of Array.isArray(data.viajes)?data.viajes:[]) {
        const id=String(gid); if(!porGrupo.has(id)) porGrupo.set(id,new Set());
        porGrupo.get(id).add(parent.id);
      }
    }
    return {nombres,porGrupo};
  }
  async function cargar() {
    if(ocupado) return;
    validar(); ocupado=true; const token=++ciclo, ano=Number(getAno());
    grupos=[];visibles=[];render();botones();
    $g('rsgSubtitulo').textContent=`Grupos ganados · Año de viaje ${ano}`;
    mensaje('Cargando grupos y coordinadores…');
    let errorCoords='';
    try {
      const [resumenes, coordinadores] = await Promise.all([
        getDocs(query(collection(db,'ventas_grupos_resumen'),where('anoViaje','==',ano))),
        cargarCoordinadores(ano).catch(err=> { errorCoords='No se pudieron leer todas las asignaciones de coordinadores.'; console.error('[salud-general] coordinadores',err); return {nombres:new Map(),porGrupo:new Map()}; })
      ]);
      const rows=resumenes.docs.map(d=>({id:d.id,...d.data()})).filter(r=>normalize(r.estado||r.estadoComercial)==='ganada');
      let siguiente=0, terminados=0; const resultados=new Array(rows.length);
      async function worker() {
        while(siguiente<rows.length) {
          validar(); if(token!==ciclo) return;
          const i=siguiente++, r=rows[i];
          try {
            const id=clean(r.groupDocId||r.id);
            const [ventas,ops,items] = await Promise.all([
              getDoc(doc(db,'ventas_cotizaciones',id)),
              getDoc(doc(db,'grupos',clean(r.idGrupo||id))),
              loadGroupInscriptions(id)
            ]);
            if(!ventas.exists()) throw new Error('No se encontró el documento original del grupo.');
            const v=ventas.data(), o=ops.exists()?ops.data():{}, gid=clean(r.idGrupo||id);
            const ids=unicos([...(Array.isArray(o.coordinadorIds)?o.coordinadorIds:o.coordinadorId?[o.coordinadorId]:[]),...(coordinadores.porGrupo.get(gid)||[])] .map(String));
            const nombres=ids.map(cid=>coordinadores.nombres.get(cid)||`Coordinador ${cid}`);
            if(!nombres.length) nombres.push(...(Array.isArray(o.coordinadores)?o.coordinadores:typeof o.coordinador==='string'?[o.coordinador]:[]).filter(x=>typeof x==='string'));
            const pasajeros=items.filter(esPasajeroQueViaja).map(p=>{
              const completa=fichaCompleta(p), autorizado=puedeCompartirConEquipoViaje(p);
              const visible=completa&&autorizado;
              return {nombre:passengerName(p),documento:passengerDocument(p),completa,autorizado,
                delegado:puedeCompartirConEncargado(p),
                salud:visible&&tieneSituacionSaludDeclarada(p),alergias:visible&&getAlergiasValues(p).length>0,
                dieta:visible&&tieneAlimentacionEspecial(p),medicamentos:visible&&tieneMedicamentosDeclarados(p),
                contraindicados:visible&&!!getMedicamentosContraindicados(p),apoyo:visible&&getNecesitaAsistencia(p)===true,
                detalles:descripcionOperativa(p)};
            });
            const g={id,gid,negocio:clean(r.numeroNegocio||v.numeroNegocio),titulo:clean(r.aliasGrupo||[v.colegio,v.curso].filter(Boolean).join(' '))||`Grupo ${gid}`,
              destino:clean(r.destinoPrincipal||r.destino||v.destino||o.destino)||'Sin destino',
              inicio:fechaISO(o.fechaInicio||v.fechaInicio||r.fechaInicio),fin:fechaISO(o.fechaFin||v.fechaFin||r.fechaFin),
              coordinadores:unicos(nombres),pasajeros,error:''};
            g.total=pasajeros.length;g.completas=pasajeros.filter(p=>p.completa).length;g.pendientes=g.total-g.completas;
            for(const key of ['salud','alergias','dieta','medicamentos','contraindicados','apoyo']) g[key]=pasajeros.filter(p=>p[key]).length;
            g.noDelegado=pasajeros.filter(p=>p.completa&&!p.delegado).length;
            g.restringidas=pasajeros.filter(p=>p.completa&&!p.autorizado).length;
            resultados[i]=g;
          } catch(err) {
            console.error('[salud-general] grupo',r.id,err);
            resultados[i]={id:clean(r.groupDocId||r.id),gid:clean(r.idGrupo||r.id),negocio:clean(r.numeroNegocio),titulo:clean(r.aliasGrupo)||`Grupo ${r.id}`,destino:clean(r.destino)||'Sin destino',inicio:'',fin:'',coordinadores:[],pasajeros:[],error:err.message};
          }
          terminados++; if(token===ciclo) mensaje(`Cargando fichas: ${terminados} de ${rows.length} grupos…`);
        }
      }
      await Promise.all(Array.from({length:Math.min(5,rows.length)},worker));
      validar();if(token!==ciclo)return;
      grupos=resultados.filter(Boolean).sort((a,b)=>(a.inicio||'9999').localeCompare(b.inicio||'9999')||a.titulo.localeCompare(b.titulo,'es'));
      const destinos=unicos(grupos.map(g=>g.destino)).sort();
      const coords=unicos(grupos.flatMap(g=>g.coordinadores)).sort();
      $g('rsgDestino').innerHTML='<option value="">Todos</option>'+destinos.map(x=>`<option value="${e(x)}">${e(x)}</option>`).join('');
      $g('rsgCoord').innerHTML='<option value="">Todos</option><option value="__sin">Sin coordinador asignado</option>'+coords.map(x=>`<option value="${e(x)}">${e(x)}</option>`).join('');
      const errores=grupos.filter(g=>g.error).length;
      mensaje(`${grupos.length} grupos cargados. ${errores?`${errores} grupos con error de carga; sus totales son desconocidos.`:''} ${errorCoords}`,!!errores||!!errorCoords);
      filtrar();
    } catch(err) { if(token===ciclo)mensaje(err.message,true); }
    finally { ocupado=false;botones(); }
  }
  function filtrar() {
    if(!permitido()) {actualizarVisibilidad();return;}
    const q=normalize($g('rsgBuscar').value), destino=$g('rsgDestino').value,coord=$g('rsgCoord').value,desde=$g('rsgDesde').value,hasta=$g('rsgHasta').value,situacion=$g('rsgSituacion').value;
    visibles=grupos.filter(g=>(!q||normalize([g.titulo,g.id,g.gid,g.negocio,...g.coordinadores,...g.pasajeros.map(p=>p.nombre)].join(' ')).includes(q))
      &&(!destino||g.destino===destino)&&(!coord||(coord==='__sin'?!g.coordinadores.length:g.coordinadores.includes(coord)))
      &&(!desde||(g.inicio&&g.inicio>=desde))&&(!hasta||(g.inicio&&g.inicio<=hasta))&&(!situacion||g[situacion]>0));
    render();botones();
  }
  function datosGrupo(g) {return [g.negocio||'—',g.gid,g.titulo,g.destino,fechaTexto(g.inicio),fechaTexto(g.fin),g.coordinadores.join(' / ')||'Sin asignación'];}
  const cabecera=['Negocio','ID grupo','Grupo','Destino','Inicio','Fin','Coordinadores',...metricas.map(m=>m[1]),'Estado de carga'];
  function resumenFila(g) {return [...datosGrupo(g),...metricas.map(([k])=>g.error?'':g[k]),g.error?`Error: ${g.error}`:'Cargado'];}
  function render() {
    if(!$g('rsgTabla'))return;
    $g('rsgKpis').innerHTML=`<span><b>${visibles.length}</b> grupos visibles</span>`+['total','pendientes','apoyo'].map(k=>`<span><b>${visibles.reduce((n,g)=>n+(g[k]||0),0)}</b> ${metricas.find(m=>m[0]===k)[1]}</span>`).join('');
    $g('rsgTabla').innerHTML=`<table><thead><tr>${cabecera.map(x=>`<th>${e(x)}</th>`).join('')}</tr></thead><tbody>${visibles.map(g=>`<tr>${resumenFila(g).map(x=>`<td>${e(x)}</td>`).join('')}</tr>`).join('')||`<tr><td colspan="${cabecera.length}">No hay grupos para mostrar.</td></tr>`}</tbody></table>`;
    $g('rsgDetalles').innerHTML=visibles.map(g=>`<details><summary>${e(g.titulo)} · ID ${e(g.gid)} · ${e(g.coordinadores.join(' / ')||'Sin coordinador')}</summary>${g.error?`<p class="rsg-error">${e(g.error)}</p>`:`<div class="rsg-table"><table class="rsg-detail"><thead><tr><th>Pasajero</th><th>Documento</th><th>Ficha</th><th>Compartir con delegado</th><th>Consideraciones operativas</th></tr></thead><tbody>${g.pasajeros.map(p=>`<tr><td>${e(p.nombre)}</td><td>${e(p.documento)}</td><td>${p.completa?'Completa':'Pendiente'}</td><td>${p.delegado?'Permitido según criterio actual':'No autorizado'}</td><td>${e(p.detalles||'Sin consideraciones declaradas')}</td></tr>`).join('')}</tbody></table></div>`}</details>`).join('');
  }
  function exportarExcel() {
    if(ocupado||!visibles.length)return;
    if(!window.XLSX)throw new Error('No se pudo cargar la herramienta de Excel.');
    const X=window.XLSX, book=X.utils.book_new();
    const general=X.utils.aoa_to_sheet([cabecera,...visibles.map(resumenFila)]);
    general['!cols']=cabecera.map((_,i)=>({wch:i===2||i===6?35:18}));
    general['!autofilter']={ref:general['!ref']};X.utils.book_append_sheet(book,general,'Grupos');
    const headers=['Negocio','ID grupo','Grupo','Destino','Inicio','Fin','Coordinadores','Pasajero','Documento','Ficha','Compartir con delegado','Uso interno','Consideraciones'];
    const rows=visibles.flatMap(g=>g.error?[[...datosGrupo(g),'','','Error de carga','','',g.error]]:g.pasajeros.map(p=>[...datosGrupo(g),p.nombre,p.documento,p.completa?'Completa':'Pendiente',p.delegado?'Permitido según criterio actual':'No autorizado',p.autorizado?'Permitido según criterio actual':'Restringido',p.detalles||'Sin consideraciones declaradas']));
    const detalle=X.utils.aoa_to_sheet([headers,...rows]);detalle['!cols']=headers.map((_,i)=>({wch:i===12?90:i===2||i===6||i===7?35:18}));detalle['!autofilter']={ref:detalle['!ref']};X.utils.book_append_sheet(book,detalle,'Pasajeros');
    X.writeFile(book,`resumen_salud_${Number(getAno())}.xlsx`);
  }
  function exportarPdf() {
    if(ocupado||!visibles.length)return;
    if(!window.jspdf?.jsPDF)throw new Error('No se pudo cargar la herramienta de PDF.');
    const pdf=new window.jspdf.jsPDF({orientation:'landscape',unit:'mm',format:'a4'});
    if(typeof pdf.autoTable!=='function')throw new Error('No se pudo cargar el complemento de tablas PDF.');
    pdf.setFontSize(15);pdf.text(`Resumen general de salud · ${Number(getAno())}`,12,14);
    pdf.setFontSize(9);pdf.text(`${visibles.length} grupos filtrados · Generado ${new Date().toLocaleString('es-CL')}`,12,21);
    pdf.autoTable({startY:26,margin:12,head:[['ID','Grupo','Destino','Inicio','Coordinadores','Viajan','Pend.','Salud','Alerg.','Alim.','Medic.','Apoyo','Carga']],
      body:visibles.map(g=>[g.gid,g.titulo,g.destino,fechaTexto(g.inicio),g.coordinadores.join(' / ')||'Sin asignación',...['total','pendientes','salud','alergias','dieta','medicamentos','apoyo'].map(k=>g.error?'—':g[k]),g.error?'Error':'OK']),styles:{fontSize:7,overflow:'linebreak'},headStyles:{fillColor:[43,25,64]}});
    for(const g of visibles) {
      pdf.addPage();pdf.setFontSize(13);const titulo=pdf.splitTextToSize(`${g.titulo} · ID ${g.gid} · Negocio ${g.negocio||'—'}`,270);pdf.text(titulo,12,15);
      let y=15+titulo.length*6;pdf.setFontSize(9);
      const subtitulo=pdf.splitTextToSize(`${g.destino} · ${fechaTexto(g.inicio)} a ${fechaTexto(g.fin)} · Coordinadores: ${g.coordinadores.join(' / ')||'Sin asignación'}`,270);pdf.text(subtitulo,12,y);y+=subtitulo.length*5+3;
      pdf.autoTable({startY:y,margin:12,head:[['Pasajero','Documento','Ficha','Delegado','Consideraciones operativas']],body:g.error?[['','','Error de carga','',g.error]]:g.pasajeros.map(p=>[p.nombre,p.documento,p.completa?'Completa':'Pendiente',p.delegado?'Permitido según criterio actual':'No autorizado',p.detalles||'Sin consideraciones declaradas']),styles:{fontSize:8,overflow:'linebreak'},headStyles:{fillColor:[43,25,64]},columnStyles:{4:{cellWidth:140}}});
    }
    const paginas=pdf.getNumberOfPages();for(let i=1;i<=paginas;i++){pdf.setPage(i);pdf.setFontSize(8);pdf.text(`Uso interno · ${i} / ${paginas}`,12,204);}
    pdf.save(`resumen_salud_${Number(getAno())}.pdf`);
  }
  onAuthStateChanged(auth, actualizarVisibilidad);
  return { abrir, actualizarVisibilidad };
}
