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


const state = {
  groupDocId: "",
  groupId: "",
  group: null,
  items: [],
  user: null,

  /*
    encargado:
      versión limitada según consentimiento.

    viaje:
      versión operativa para adultos responsables.
  */
  mode: "encargado"
};


init();


function init() {
  onAuthStateChanged(
    auth,
    async (
      firebaseUser
    ) => {
      if (!firebaseUser) {
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
      () =>
        window.print()
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


async function loadPage() {
  try {
    const params =
      new URLSearchParams(
        location.search
      );

    const requested =
      clean(
        params.get("id") ||
        params.get("grupo")
      );

    if (!requested) {
      throw new Error(
        "Falta el parámetro ?id= del grupo."
      );
    }

    const resolved =
      await resolveGroup(
        requested
      );

    if (!resolved) {
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

    /*
      Solamente trabajamos con pasajeros vigentes.
    */
    state.items =
      (
        await loadGroupInscriptions(
          state.groupDocId
        )
      )
        .filter(
          (item) =>
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
            )
              .localeCompare(
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
      `Resumen operativo · ${
        clean(
          state.group
            ?.aliasGrupo ||
          state.group
            ?.colegio ||
          state.groupId
        )
      }`;

    $("loadingBox")
      .classList
      .add(
        "hidden"
      );

    $("content")
      .classList
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
        () =>
          window.print(),
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
  const v =
    normalize(
      value
    );

  if (
    value === true ||
    v === "si" ||
    v === "true"
  ) {
    return true;
  }

  if (
    value === false ||
    v === "no" ||
    v === "false"
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
          (value) =>
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

  if (!raw) {
    return "";
  }

  const map = {
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
    map[
      normalize(
        raw
      )
        .replace(
          /\s+/g,
          "_"
        )
    ]
  ) {
    return map[
      normalize(
        raw
      )
        .replace(
          /\s+/g,
          "_"
        )
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


function versionConsentimiento(
  item = {}
) {
  return Number(
    item
      ?.consentimiento
      ?.versionConsentimiento ||
    1
  );
}


/*
  Para el ENCARGADO DE GRUPO:

  V2:
    respetamos literalmente
    autorizaApoderadoCoordinador.

  V1:
    la pregunta específica todavía no existía.
    NO interpretamos el silencio como autorización.

    Por seguridad, el encargado no verá detalle
    médico individual de una ficha V1.
*/
function puedeCompartirConEncargado(
  item = {}
) {
  const version =
    versionConsentimiento(
      item
    );

  if (
    version < 2
  ) {
    return false;
  }

  return (
    item
      ?.consentimiento
      ?.autorizaApoderadoCoordinador ===
    true
  );
}


/*
  Equipo de viaje.

  El consentimiento V2 que ya utilizas indica
  expresamente que la ficha y antecedentes
  relevantes pueden ser consultados por
  coordinadores Rai Trai y adultos acompañantes
  responsables cuando sea necesario para
  seguridad, cuidado y asistencia.

  Por eso en modo viaje utilizamos la información
  operativa necesaria.
*/
function puedeCompartirConEquipoViaje(
  item = {}
) {
  return (
    item
      ?.consentimiento
      ?.aceptaUsoInterno ===
      true ||
    versionConsentimiento(
      item
    ) < 2
  );
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

  ESTA ES LA ÚNICA FUNCIÓN QUE DEBEMOS CAMBIAR
  SI CONFIRMAMOS UN CAMPO GENERAL DIFERENTE.

  Primero busca posibles campos generales nuevos.
  Después aplica fallback a las preguntas que
  YA EXISTEN en las fichas actuales:
    - discapacidadApoyosFlag
    - neuroApoyosFlag
*/


function getNecesitaAsistencia(
  item = {}
) {
  const salud =
    item.salud ||
    {};

  /*
    CAMPOS CANÓNICOS FUTUROS / POSIBLES.

    Si alguno existe, tiene prioridad absoluta.
  */
  const posiblesGenerales = [
    salud.necesitaAsistencia,
    salud.necesitaAsistenciaFlag,
    salud.requiereAsistencia,
    salud.requiereAsistenciaFlag,
    item.necesitaAsistencia,
    item.necesitaAsistenciaFlag
  ];

  for (
    const value of
    posiblesGenerales
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
    COMPATIBILIDAD CON FICHAS ACTUALES.
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

  if (
    discapacidad ===
      true ||
    neuro === true
  ) {
    return true;
  }

  if (
    discapacidad ===
      false &&
    neuro === false
  ) {
    return false;
  }

  /*
    Si solo una de las preguntas fue respondida,
    utilizamos esa respuesta.
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

  /*
    En el documento del encargado,
    una persona que NO autorizó compartir
    no puede revelar aquí información médica
    indirectamente.
  */
  if (
    state.mode ===
      "encargado" &&
    !puedeCompartirConEncargado(
      item
    )
  ) {
    return "Información restringida";
  }

  const value =
    getNecesitaAsistencia(
      item
    );

  if (
    value === true
  ) {
    return "SÍ";
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
  ALIMENTACIÓN
  =========================================================
*/


function getAlimentacion(
  item = {}
) {
  const salud =
    item.salud ||
    {};

  if (
    !puedeMostrarDetalle(
      item
    )
  ) {
    return "Información restringida";
  }

  const dietaFlag =
    normalizarFlag(
      salud.dietaFlag
    );

  const values =
    [];

  if (
    clean(
      salud.dietaPrincipal
    )
  ) {
    values.push(
      humanizar(
        salud.dietaPrincipal
      )
    );
  }

  if (
    Array.isArray(
      salud.dietaTipos
    )
  ) {
    values.push(
      ...salud.dietaTipos
        .map(
          humanizar
        )
    );
  }

  if (
    Array.isArray(
      salud.dietaRestricciones
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
      salud.dietaDetalle
    )
  ) {
    values.push(
      salud.dietaDetalle
    );
  }

  const result =
    uniqueText(
      values
    );

  if (
    result.length
  ) {
    return result.join(
      " · "
    );
  }

  if (
    dietaFlag ===
    true
  ) {
    return "Requiere consideración";
  }

  if (
    dietaFlag ===
    false
  ) {
    return "—";
  }

  return "—";
}


/*
  =========================================================
  ALERGIAS
  =========================================================
*/


function getAlergias(
  item = {}
) {
  const salud =
    item.salud ||
    {};

  if (
    !puedeMostrarDetalle(
      item
    )
  ) {
    return "Información restringida";
  }

  const values =
    [];

  if (
    clean(
      salud.alergiasDetalle
    )
  ) {
    values.push(
      salud.alergiasDetalle
    );
  }

  if (
    Array.isArray(
      salud.alergiasAlimentarias
    )
  ) {
    salud
      .alergiasAlimentarias
      .forEach(
        (
          alergia
        ) => {
          const detail =
            clean(
              alergia
                ?.alimento ||
              alergia
                ?.detalle ||
              ""
            );

          if (
            detail
          ) {
            values.push(
              detail
            );
          }
        }
      );
  }

  const result =
    uniqueText(
      values
    );

  if (
    result.length
  ) {
    return result.join(
      " · "
    );
  }

  if (
    normalizarFlag(
      salud.alergiasFlag
    ) === true ||
    normalizarFlag(
      salud.alergiaAlimentariaFlag
    ) === true
  ) {
    return "Sí";
  }

  return "—";
}


/*
  =========================================================
  MEDICACIÓN
  =========================================================
*/


function getMedicacion(
  item = {}
) {
  const salud =
    item.salud ||
    {};

  if (
    !puedeMostrarDetalle(
      item
    )
  ) {
    return "Información restringida";
  }

  const usa =
    normalizarFlag(
      salud.medicamentosFlag
    );

  if (
    clean(
      salud.medicamentosDetalle
    )
  ) {
    /*
      Para encargado preferimos no convertir
      automáticamente la tabla principal
      en un listado farmacológico.

      Basta indicar que existe medicación.
      El detalle aparecerá solo en modo viaje.
    */
    if (
      state.mode ===
      "encargado"
    ) {
      return "Sí";
    }

    return salud
      .medicamentosDetalle;
  }

  if (
    usa === true
  ) {
    return "Sí";
  }

  return "—";
}


/*
  =========================================================
  CONSIDERACIONES
  =========================================================
*/


function getConsideraciones(
  item = {}
) {
  if (
    !puedeMostrarDetalle(
      item
    )
  ) {
    return "Información no autorizada para compartir en esta etapa.";
  }

  const salud =
    item.salud ||
    {};

  const values =
    [];

  /*
    Solo incorporamos información útil
    operacionalmente.

    No intentamos construir una historia clínica.
  */

  if (
    clean(
      salud
        .discapacidadApoyoTipo
    )
  ) {
    values.push(
      salud
        .discapacidadApoyoTipo
    );
  }

  if (
    clean(
      salud
        .discapacidadRecomendaciones
    )
  ) {
    values.push(
      salud
        .discapacidadRecomendaciones
    );
  }

  if (
    clean(
      salud
        .discapacidadAyudaIndicaciones
    )
  ) {
    values.push(
      salud
        .discapacidadAyudaIndicaciones
    );
  }

  if (
    clean(
      salud
        .neuroApoyosDetalle
    )
  ) {
    values.push(
      salud
        .neuroApoyosDetalle
    );
  }

  if (
    clean(
      salud
        .neuroEstrategias
    )
  ) {
    values.push(
      salud
        .neuroEstrategias
    );
  }

  if (
    clean(
      salud
        .neuroFactores
    )
  ) {
    values.push(
      `Considerar factores de sobrecarga: ${
        salud.neuroFactores
      }`
    );
  }

  /*
    En el documento de VIAJE podemos incorporar
    antecedentes adicionales necesarios para
    la operación.

    En el documento del ENCARGADO evitamos
    volcar diagnósticos innecesarios.
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
        salud
          .emergenciaMedicaDetalle
      );
    }

    if (
      clean(
        salud
          .enfermedadBaseDetalle
      )
    ) {
      values.push(
        salud
          .enfermedadBaseDetalle
      );
    }

    if (
      clean(
        salud
          .otrosAntecedentesDetalle
      )
    ) {
      values.push(
        salud
          .otrosAntecedentesDetalle
      );
    }
  }

  const result =
    uniqueText(
      values
    );

  return (
    result.join(
      " · "
    ) ||
    "—"
  );
}


/*
  =========================================================
  CONTACTO DE EMERGENCIA
  =========================================================
*/


function getContactoEmergencia(
  item = {}
) {
  /*
    Solo se imprime en versión de viaje.
  */
  if (
    state.mode !==
    "viaje"
  ) {
    return "";
  }

  const emergencia =
    item.emergencia ||
    {};

  const nombre =
    clean(
      emergencia.nombre
    );

  const relacion =
    clean(
      emergencia.relacion
    );

  const telefono =
    clean(
      emergencia.telefono
    );

  return [
    nombre,
    relacion,
    telefono
  ]
    .filter(
      Boolean
    )
    .join(
      " · "
    ) ||
    "—";
}


/*
  =========================================================
  DETALLE OPERATIVO
  =========================================================
*/


function tieneDetalleOperativo(
  item = {}
) {
  if (
    !fichaCompleta(
      item
    )
  ) {
    return false;
  }

  if (
    !puedeMostrarDetalle(
      item
    )
  ) {
    return true;
  }

  return (
    getNecesitaAsistencia(
      item
    ) === true ||

    getAlimentacion(
      item
    ) !== "—" ||

    getAlergias(
      item
    ) !== "—" ||

    getMedicacion(
      item
    ) !== "—" ||

    getConsideraciones(
      item
    ) !== "—"
  );
}


function renderDetallePersona(
  item = {}
) {
  const nombre =
    passengerName(
      item
    );

  if (
    !puedeMostrarDetalle(
      item
    )
  ) {
    return `
      <article class="detail-item">
        <div class="detail-name">
          ${escapeHtml(
            nombre
          )}
        </div>

        <div class="detail-text status-restricted">
          Información médica registrada,
          pero no autorizada para compartir
          con el/la encargado(a) del grupo
          en esta etapa.
        </div>
      </article>
    `;
  }

  const detalles =
    [];

  const alimentacion =
    getAlimentacion(
      item
    );

  const alergias =
    getAlergias(
      item
    );

  const medicacion =
    getMedicacion(
      item
    );

  const asistencia =
    getNecesitaAsistenciaTexto(
      item
    );

  const consideraciones =
    getConsideraciones(
      item
    );

  if (
    alimentacion !==
    "—"
  ) {
    detalles.push(`
      <div>
        <span class="detail-label">
          Alimentación:
        </span>

        ${escapeHtml(
          alimentacion
        )}
      </div>
    `);
  }

  if (
    alergias !==
    "—"
  ) {
    detalles.push(`
      <div>
        <span class="detail-label">
          Alergias:
        </span>

        ${escapeHtml(
          alergias
        )}
      </div>
    `);
  }

  if (
    medicacion !==
    "—"
  ) {
    detalles.push(`
      <div>
        <span class="detail-label">
          Medicación:
        </span>

        ${escapeHtml(
          medicacion
        )}
      </div>
    `);
  }

  detalles.push(`
    <div>
      <span class="detail-label">
        Necesita asistencia:
      </span>

      ${escapeHtml(
        asistencia
      )}
    </div>
  `);

  if (
    consideraciones !==
    "—"
  ) {
    detalles.push(`
      <div>
        <span class="detail-label">
          Consideraciones:
        </span>

        ${escapeHtml(
          consideraciones
        )}
      </div>
    `);
  }

  if (
    state.mode ===
    "viaje"
  ) {
    const emergencia =
      getContactoEmergencia(
        item
      );

    if (
      emergencia !==
      "—"
    ) {
      detalles.push(`
        <div>
          <span class="detail-label">
            Emergencia:
          </span>

          ${escapeHtml(
            emergencia
          )}
        </div>
      `);
    }
  }

  return `
    <article class="detail-item">
      <div class="detail-name">
        ${escapeHtml(
          nombre
        )}
      </div>

      <div class="detail-text">
        ${detalles.join("")}
      </div>
    </article>
  `;
}


/*
  =========================================================
  RENDER
  =========================================================
*/


function render() {
  renderMode();

  renderHeader();

  renderPrivacyNotice();

  renderKpis();

  renderTable();

  renderDetails();
}


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

  $("emergencyHeader")
    ?.classList
    .toggle(
      "hidden",
      state.mode !==
        "viaje"
    );
}


function renderHeader() {
  const group =
    state.group ||
    {};

  $("groupSubtitle").textContent =
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

  $("documentType").textContent =
    state.mode ===
      "encargado"
      ? "Versión para encargado de grupo"
      : "Versión operativa para equipo de viaje";
}


function renderPrivacyNotice() {
  if (
    state.mode ===
    "encargado"
  ) {
    $("privacyNotice").innerHTML = `
      <strong>
        Privacidad:
      </strong>

      Este documento respeta la autorización
      entregada para compartir antecedentes con
      el/la apoderado(a) encargado(a) del grupo.

      Cuando dicha autorización no existe,
      los antecedentes médicos individuales
      no se muestran.
    `;

    return;
  }

  $("privacyNotice").innerHTML = `
    <strong>
      Uso operativo:
    </strong>

    Esta versión está destinada exclusivamente
    al equipo responsable durante el viaje y
    contiene antecedentes necesarios para la
    seguridad, cuidado, asistencia y operación
    del grupo.
  `;
}


function renderKpis() {
  const total =
    state.items.length;

  const completas =
    state.items
      .filter(
        fichaCompleta
      )
      .length;

  const pendientes =
    total -
    completas;

  const asistenciaSi =
    state.items
      .filter(
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
      )
      .length;

  const asistenciaNo =
    state.items
      .filter(
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
      )
      .length;

  const consideraciones =
    state.items
      .filter(
        (
          item
        ) =>
          fichaCompleta(
            item
          ) &&
          puedeMostrarDetalle(
            item
          ) &&
          tieneDetalleOperativo(
            item
          )
      )
      .length;

  $("kpiContainer").innerHTML = `
    <div class="kpi">
      <span class="kpi-label">
        Pasajeros
      </span>

      <span class="kpi-value">
        ${total}
      </span>
    </div>

    <div class="kpi">
      <span class="kpi-label">
        Fichas completas
      </span>

      <span class="kpi-value">
        ${completas}
      </span>
    </div>

    <div class="kpi">
      <span class="kpi-label">
        Pendientes
      </span>

      <span class="kpi-value">
        ${pendientes}
      </span>
    </div>

    <div class="kpi">
      <span class="kpi-label">
        Necesitan asistencia
      </span>

      <span class="kpi-value">
        ${asistenciaSi}
      </span>
    </div>

    <div class="kpi">
      <span class="kpi-label">
        No necesitan asistencia
      </span>

      <span class="kpi-value">
        ${asistenciaNo}
      </span>
    </div>
  `;
}


function renderTable() {
  $("tableBody").innerHTML =
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

          const comparte =
            puedeMostrarDetalle(
              item
            );

          const asistencia =
            getNecesitaAsistenciaTexto(
              item
            );

          let asistenciaClass =
            "";

          if (
            asistencia ===
            "SÍ"
          ) {
            asistenciaClass =
              "status-danger";
          } else if (
            asistencia ===
            "No"
          ) {
            asistenciaClass =
              "status-ok";
          } else if (
            asistencia ===
            "Información restringida"
          ) {
            asistenciaClass =
              "status-restricted";
          } else {
            asistenciaClass =
              "status-warning";
          }

          const fichaText =
            completa
              ? "Completa"
              : "Pendiente";

          const fichaClass =
            completa
              ? "status-ok"
              : "status-warning";

          const alimentacion =
            completa
              ? getAlimentacion(
                  item
                )
              : "—";

          const alergias =
            completa
              ? getAlergias(
                  item
                )
              : "—";

          const medicacion =
            completa
              ? getMedicacion(
                  item
                )
              : "—";

          const consideraciones =
            completa
              ? getConsideraciones(
                  item
                )
              : "Ficha pendiente";

          const emergencia =
            completa
              ? getContactoEmergencia(
                  item
                )
              : "—";

          return `
            <tr>
              <td>
                ${index + 1}
              </td>

              <td class="passenger-name">
                ${escapeHtml(
                  passengerName(
                    item
                  )
                )}
              </td>

              <td class="${fichaClass}">
                ${escapeHtml(
                  fichaText
                )}
              </td>

              <td class="${
                !comparte &&
                state.mode ===
                  "encargado"
                  ? "status-restricted"
                  : ""
              }">
                ${escapeHtml(
                  alimentacion
                )}
              </td>

              <td class="${
                !comparte &&
                state.mode ===
                  "encargado"
                  ? "status-restricted"
                  : ""
              }">
                ${escapeHtml(
                  alergias
                )}
              </td>

              <td class="${
                !comparte &&
                state.mode ===
                  "encargado"
                  ? "status-restricted"
                  : ""
              }">
                ${escapeHtml(
                  medicacion
                )}
              </td>

              <td class="${asistenciaClass}">
                ${escapeHtml(
                  asistencia
                )}
              </td>

              <td class="consideration ${
                !comparte &&
                state.mode ===
                  "encargado"
                  ? "status-restricted"
                  : ""
              }">
                ${escapeHtml(
                  consideraciones
                )}
              </td>

              ${
                state.mode ===
                "viaje"
                  ? `
                    <td>
                      ${escapeHtml(
                        emergencia
                      )}
                    </td>
                  `
                  : ""
              }
            </tr>
          `;
        }
      )
      .join("");
}


function renderDetails() {
  const relevantes =
    state.items
      .filter(
        tieneDetalleOperativo
      );

  if (
    !relevantes.length
  ) {
    $("detailsSection")
      .classList
      .add(
        "hidden"
      );

    return;
  }

  $("detailsSection")
    .classList
    .remove(
      "hidden"
    );

  $("detailsContainer").innerHTML =
    relevantes
      .map(
        renderDetallePersona
      )
      .join("");
}


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

  $("errorBox").textContent =
    message;

  $("errorBox")
    .classList
    .remove(
      "hidden"
    );
}
