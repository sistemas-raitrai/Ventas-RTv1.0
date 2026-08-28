// RENOMBRAR COMO: gestion-fichas-medicas.js

import {
  $,
  auth,
  db,
  onAuthStateChanged,
  doc,
  updateDoc,
  collection,
  addDoc,
  serverTimestamp,
  clean,
  normalize,
  escapeHtml,
  getByPath,
  formatDate,
  passengerName,
  passengerDocument,
  fichaCompleta,
  medicalAlerts,
  isCancelled,
  getCurrentSystemUser,
  canViewMedicalData,
  canEditMedicalData,
  resolveGroup,
  loadGroupInscriptions,
  EDIT_FIELDS
} from "./ficha-medica-common.js";

import {
  getDocs,
  query,
  orderBy
} from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";

/*
  CAMPOS DEL EDITOR MÉDICO

  EDIT_FIELDS puede contener campos generales de la ficha,
  pero Gestión Fichas Médicas NO debe permitir modificar
  identidad, nómina ni datos administrativos.

  Estos campos quedan exclusivamente en Gestión Nómina.
*/
const EMERGENCY_RELATION_OPTIONS = [
  {
    value:
      "padre",
    label:
      "Padre"
  },
  {
    value:
      "madre",
    label:
      "Madre"
  },
  {
    value:
      "tutor",
    label:
      "Tutor(a)"
  },
  {
    value:
      "hermano_a",
    label:
      "Hermano(a)"
  },
  {
    value:
      "tio_a",
    label:
      "Tío(a)"
  },
  {
    value:
      "abuelo_a",
    label:
      "Abuelo(a)"
  },
  {
    value:
      "esposo_a",
    label:
      "Esposo(a)"
  },
  {
    value:
      "pareja",
    label:
      "Pareja"
  },
  {
    value:
      "hijo_a",
    label:
      "Hijo(a)"
  },
  {
    value:
      "amigo_a",
    label:
      "Amigo(a)"
  },
  {
    value:
      "otro",
    label:
      "Otro"
  }
];

const YES_NO_OPTIONS = [
  {
    value:
      "no",
    label:
      "No"
  },
  {
    value:
      "si",
    label:
      "Sí"
  }
];

const MEDICAL_FIELD_OVERRIDES = {
  /*
    =====================================================
    OPERACIÓN DEL PASAJERO
    =====================================================
  */

  "identificacion.tallaPolera": {
    section:
      "Datos operativos",
    label:
      "Talla de polera",
    type:
      "select",
    options: [
      {
        value:
          "XS",
        label:
          "XS"
      },
      {
        value:
          "S",
        label:
          "S"
      },
      {
        value:
          "M",
        label:
          "M"
      },
      {
        value:
          "L",
        label:
          "L"
      },
      {
        value:
          "XL",
        label:
          "XL"
      },
      {
        value:
          "2XL",
        label:
          "2XL"
      },
      {
        value:
          "3XL",
        label:
          "3XL"
      },
      {
        value:
          "4XL",
        label:
          "4XL"
      }
    ]
  },

  /*
    =====================================================
    CONTACTO DE EMERGENCIA 1
    =====================================================
  */

  "emergencia.nombre": {
    section:
      "Contactos de emergencia",
    label:
      "Nombre contacto de emergencia 1",
    type:
      "text"
  },

  "emergencia.relacionBase": {
    section:
      "Contactos de emergencia",
    label:
      "Relación contacto de emergencia 1",
    type:
      "select",
    options:
      EMERGENCY_RELATION_OPTIONS
  },

  "emergencia.relacion": {
    section:
      "Contactos de emergencia",
    label:
      "Relación — Otro",
    type:
      "text"
  },

  "emergencia.telefono": {
    section:
      "Contactos de emergencia",
    label:
      "WhatsApp contacto de emergencia 1",
    type:
      "text"
  },

  /*
    =====================================================
    CONTACTO DE EMERGENCIA 2
    =====================================================
  */

  "emergenciaSecundaria.aplica": {
    section:
      "Contactos de emergencia",
    label:
      "Tiene segundo contacto de emergencia",
    type:
      "boolean"
  },

  "emergenciaSecundaria.nombre": {
    section:
      "Contactos de emergencia",
    label:
      "Nombre contacto de emergencia 2",
    type:
      "text"
  },

  "emergenciaSecundaria.relacionBase": {
    section:
      "Contactos de emergencia",
    label:
      "Relación contacto de emergencia 2",
    type:
      "select",
    options:
      EMERGENCY_RELATION_OPTIONS
  },

  "emergenciaSecundaria.relacion": {
    section:
      "Contactos de emergencia",
    label:
      "Relación contacto emergencia 2 — Otro",
    type:
      "text"
  },

  "emergenciaSecundaria.telefono": {
    section:
      "Contactos de emergencia",
    label:
      "WhatsApp contacto de emergencia 2",
    type:
      "text"
  },

  /*
    =====================================================
    CAMPOS MÉDICOS CERRADOS
    =====================================================
  */

  "salud.discapacidadFlag": {
    type:
      "select",
    options:
      YES_NO_OPTIONS
  },

  "salud.discapacidadApoyosFlag": {
    type:
      "select",
    options:
      YES_NO_OPTIONS
  },

  "salud.discapacidadAyudasTecnicasFlag": {
    type:
      "select",
    options:
      YES_NO_OPTIONS
  },

  "salud.neurodivergenciaFlag": {
    type:
      "select",
    options:
      YES_NO_OPTIONS
  },

  "salud.neuroSobrecargaFlag": {
    type:
      "select",
    options:
      YES_NO_OPTIONS
  },

  "salud.neuroApoyosFlag": {
    type:
      "select",
    options:
      YES_NO_OPTIONS
  },

  "salud.saludMentalFlag": {
    type:
      "select",
    options:
      YES_NO_OPTIONS
  },

  "salud.dietaFlag": {
    type:
      "select",
    options:
      YES_NO_OPTIONS
  },

  "salud.enfermedadBaseFlag": {
    type:
      "select",
    options:
      YES_NO_OPTIONS
  },

  "salud.saludGeneralFlag": {
    type:
      "select",
    options:
      YES_NO_OPTIONS
  },

  "salud.cirugiasPreviasFlag": {
    type:
      "select",
    options:
      YES_NO_OPTIONS
  },

  "salud.emergenciaMedicaFlag": {
    type:
      "select",
    options:
      YES_NO_OPTIONS
  },

  "salud.medicamentosFlag": {
    type:
      "select",
    options:
      YES_NO_OPTIONS
  },

  "salud.medicamentosProhibidosFlag": {
    type:
      "select",
    options:
      YES_NO_OPTIONS
  },

  "salud.alergiasFlag": {
    type:
      "select",
    options:
      YES_NO_OPTIONS
  },

  "salud.otrosAntecedentesFlag": {
    type:
      "select",
    options:
      YES_NO_OPTIONS
  },

  "salud.grupoSanguineo": {
    type:
      "select",
    options: [
      {
        value:
          "no_informado",
        label:
          "Desconozco"
      },
      {
        value:
          "A+",
        label:
          "A Rh+"
      },
      {
        value:
          "A-",
        label:
          "A Rh-"
      },
      {
        value:
          "B+",
        label:
          "B Rh+"
      },
      {
        value:
          "B-",
        label:
          "B Rh-"
      },
      {
        value:
          "AB+",
        label:
          "AB Rh+"
      },
      {
        value:
          "AB-",
        label:
          "AB Rh-"
      },
      {
        value:
          "O+",
        label:
          "O Rh+"
      },
      {
        value:
          "O-",
        label:
          "O Rh-"
      }
    ]
  },

  "salud.discapacidadTipos": {
    type:
      "multicheck",
    options: [
      {
        value:
          "fisica",
        label:
          "Discapacidad física"
      },
      {
        value:
          "visual",
        label:
          "Discapacidad visual"
      },
      {
        value:
          "auditiva",
        label:
          "Discapacidad auditiva"
      },
      {
        value:
          "cognitiva",
        label:
          "Discapacidad cognitiva"
      }
    ]
  },

  "salud.neurodivergenciaTipos": {
    type:
      "multicheck",
    options: [
      {
        value:
          "cea_tea",
        label:
          "CEA / TEA"
      },
      {
        value:
          "tdah",
        label:
          "TDAH"
      },
      {
        value:
          "dea",
        label:
          "DEA"
      },
      {
        value:
          "otra",
        label:
          "Otra"
      }
    ]
  }
};


/*
  =========================================================
  CAMPOS OPERATIVOS EXTRA
  =========================================================
*/
const OPERATIONAL_EXTRA_FIELDS = [
  {
    path:
      "identificacion.tallaPolera"
  },

  {
    path:
      "emergencia.nombre"
  },
  {
    path:
      "emergencia.relacionBase"
  },
  {
    path:
      "emergencia.relacion"
  },
  {
    path:
      "emergencia.telefono"
  },

  {
    path:
      "emergenciaSecundaria.aplica"
  },
  {
    path:
      "emergenciaSecundaria.nombre"
  },
  {
    path:
      "emergenciaSecundaria.relacionBase"
  },
  {
    path:
      "emergenciaSecundaria.relacion"
  },
  {
    path:
      "emergenciaSecundaria.telefono"
  }
];


const MEDICAL_EDIT_FIELDS = [
  /*
    Primero conservamos los campos médicos
    que ya existían.
  */
  ...EDIT_FIELDS
    .filter(
      (field) => {
        const path =
          String(
            field?.path ||
            ""
          );

        /*
          Ficha Médica NO puede tocar
          datos administrativos estructurales.
        */
        const esAdministrativo =
          (
            path.startsWith(
              "identificacion."
            ) &&
            path !==
              "identificacion.tallaPolera"
          ) ||
          path.startsWith(
            "contactoPrincipal."
          ) ||
          path.startsWith(
            "contactoSecundario."
          ) ||
          path.startsWith(
            "documentoIdentidad."
          ) ||
          path.startsWith(
            "profesor."
          ) ||
          path.startsWith(
            "adultoAcompanante."
          ) ||
          path.startsWith(
            "documentacion."
          ) ||
          path.startsWith(
            "consentimiento."
          ) ||
          [
            "tipoViajante",
            "tipoParticipacion",
            "tipoInscripcion",
            "estadoInscripcion",
            "faseInscripcion",
            "estadoCupo"
          ].includes(
            path
          );

        return !esAdministrativo;
      }
    ),

  /*
    Después agregamos específicamente
    talla + contactos de emergencia.
  */
  ...OPERATIONAL_EXTRA_FIELDS
]
  .map(
    (field) => {
      const override =
        MEDICAL_FIELD_OVERRIDES[
          field.path
        ] ||
        {};

      return {
        ...field,
        ...override
      };
    }
  )
  /*
    Evita campos repetidos si EDIT_FIELDS
    ya contenía alguno de ellos.
  */
  .filter(
    (
      field,
      index,
      array
    ) =>
      array.findIndex(
        (candidate) =>
          candidate.path ===
          field.path
      ) === index
  );

const state = {
  groupDocId: "",
  groupId: "",
  group: null,
  items: [],
  user: null,
  editingId: "",

  medicalHistory: [],
  currentView: "fichas"
};

init();

function init() {
  onAuthStateChanged(auth, async (firebaseUser) => {
    if (!firebaseUser) {
      location.href = "login.html";
      return;
    }

    state.user = getCurrentSystemUser(firebaseUser);

    if (!canViewMedicalData(state.user)) {
      showError("No tienes permisos para acceder a información médica.");
      return;
    }

    bindEvents();
    await loadPage();
  });
}

function bindEvents() {
  if (document.body.dataset.bound === "1") return;
  document.body.dataset.bound = "1";

  $("btnRecargar")?.addEventListener("click", loadPage);
  $("searchInput")?.addEventListener("input", renderTable);
  $("statusFilter")?.addEventListener("change", renderTable);
  $("typeFilter")?.addEventListener("change", renderTable);
  $("tableBody")?.addEventListener("click", onTableClick);
  $("btnCloseModal")?.addEventListener("click", closeModal);
  $("btnCancelEdit")?.addEventListener("click", closeModal);
  $("editForm")?.addEventListener("submit", saveEdit);
  $("editModal")?.addEventListener("click", (event) => {
    if (event.target?.id === "editModal") closeModal();
  });
  document
    .querySelectorAll(
      "[data-medical-filter]"
    )
    .forEach(
      (button) => {
        button.addEventListener(
          "click",
          () => {
            const value =
              button.dataset
                .medicalFilter ||
              "";
  
            $("statusFilter").value =
              value === "todos"
                ? ""
                : value;
  
            renderTable();
          }
        );
      }
    );
  
  document
    .querySelectorAll(
      "[data-medical-detail]"
    )
    .forEach(
      (button) => {
        button.addEventListener(
          "click",
          () => {
            abrirDetalleMedicoTipo(
              button.dataset
                .medicalDetail
            );
          }
        );
      }
    );
  
  $("btnCloseMedicalDetail")
    ?.addEventListener(
      "click",
      cerrarModalDetalleMedico
    );
  
  $("medicalDetailModal")
    ?.addEventListener(
      "click",
      (event) => {
        if (
          event.target?.id ===
          "medicalDetailModal"
        ) {
          cerrarModalDetalleMedico();
        }
      }
    );
    document
      .querySelectorAll(
        "[data-medical-view]"
      )
      .forEach(
        (button) => {
          button.addEventListener(
            "click",
            () => {
              changeMedicalView(
                button.dataset
                  .medicalView ||
                "fichas"
              );
            }
          );
        }
      );
}

async function loadMedicalHistory() {
  if (
    !state.groupDocId
  ) {
    state.medicalHistory =
      [];

    return;
  }

  try {
    const ref =
      collection(
        db,
        "ventas_cotizaciones",
        state.groupDocId,
        "historial_ficha_medica"
      );

    const snap =
      await getDocs(
        query(
          ref,
          orderBy(
            "fecha",
            "desc"
          )
        )
      );

    state.medicalHistory =
      snap.docs.map(
        (documento) => ({
          id:
            documento.id,

          ...documento.data()
        })
      );
  } catch (error) {
    console.error(
      "[gestion-fichas-medicas] loadMedicalHistory",
      error
    );

    state.medicalHistory =
      [];
  }
}


function renderMedicalHistoryValue(
  value
) {
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

  if (
    Array.isArray(
      value
    )
  ) {
    return (
      value.join(
        ", "
      ) ||
      "—"
    );
  }

  if (
    value ===
      undefined ||
    value ===
      null ||
    value ===
      ""
  ) {
    return "—";
  }

  return String(
    value
  );
}


function getMedicalHistoryFieldLabel(
  path = ""
) {
  const labels = {
    "identificacion.tallaPolera":
      "Talla de polera",

    "emergencia.nombre":
      "Contacto de emergencia 1",

    "emergencia.relacionBase":
      "Relación emergencia 1",

    "emergencia.relacion":
      "Relación emergencia 1",

    "emergencia.telefono":
      "WhatsApp emergencia 1",

    "emergenciaSecundaria.aplica":
      "Segundo contacto de emergencia",

    "emergenciaSecundaria.nombre":
      "Contacto de emergencia 2",

    "emergenciaSecundaria.relacionBase":
      "Relación emergencia 2",

    "emergenciaSecundaria.relacion":
      "Relación emergencia 2",

    "emergenciaSecundaria.telefono":
      "WhatsApp emergencia 2",

    "salud.discapacidadFlag":
      "Discapacidad",

    "salud.neurodivergenciaFlag":
      "Neurodivergencia",

    "salud.saludMentalFlag":
      "Salud mental",

    "salud.dietaFlag":
      "Dieta / restricción alimentaria",

    "salud.grupoSanguineo":
      "Grupo sanguíneo",

    "salud.enfermedadBaseFlag":
      "Enfermedad de base",

    "salud.medicamentosFlag":
      "Medicamentos",

    "salud.medicamentosDetalle":
      "Detalle de medicamentos",

    "salud.medicamentosProhibidosFlag":
      "Medicamentos contraindicados",

    "salud.medicamentosProhibidosDetalle":
      "Detalle medicamentos contraindicados",

    "salud.alergiasFlag":
      "Alergias",

    "salud.alergiasDetalle":
      "Detalle de alergias",

    "salud.otrosAntecedentesFlag":
      "Otros antecedentes",

    "salud.otrosAntecedentesDetalle":
      "Detalle otros antecedentes"
  };

  return (
    labels[path] ||
    String(
      path ||
      "Campo"
    )
  );
}


function renderMedicalHistory() {
  const container =
    $("medicalHistoryList");

  if (!container) {
    return;
  }

  const items =
    state.medicalHistory ||
    [];

  $("medicalHistoryCount").textContent =
    `${items.length} movimiento${
      items.length === 1
        ? ""
        : "s"
    }`;

  if (!items.length) {
    container.innerHTML = `
      <div class="loading">
        No hay modificaciones registradas.
      </div>
    `;

    return;
  }

  container.innerHTML =
    items
      .map(
        (item) => {
          const cambios =
            Array.isArray(
              item.cambios
            )
              ? item.cambios
              : (
                  Array.isArray(
                    item
                      ?.metadata
                      ?.cambios
                  )
                    ? item.metadata
                        .cambios
                    : []
                );

          const nombre =
            clean(
              item
                ?.metadata
                ?.nombreCompleto ||
              ""
            );

          const documento =
            clean(
              item
                ?.metadata
                ?.documento ||
              ""
            );

          const motivo =
            clean(
              item.motivo ||
              item
                ?.metadata
                ?.motivo ||
              ""
            );

          return `
            <article class="medical-history-item">
              <div class="medical-history-item-head">
                <div>
                  <div class="medical-history-title">
                    ${escapeHtml(
                      item.titulo ||
                      "Edición de ficha / datos operativos"
                    )}
                  </div>

                  ${
                    nombre
                      ? `
                        <div class="medical-history-passenger">
                          ${escapeHtml(
                            nombre
                          )}

                          ${
                            documento
                              ? ` · ${escapeHtml(
                                  documento
                                )}`
                              : ""
                          }
                        </div>
                      `
                      : ""
                  }
                </div>

                <div class="medical-history-date">
                  ${escapeHtml(
                    formatDate(
                      item.fecha
                    )
                  )}
                </div>
              </div>

              ${
                cambios.length
                  ? `
                    <div class="medical-history-changes">
                      ${
                        cambios
                          .map(
                            (cambio) => `
                              <div class="medical-history-change">
                                <strong>
                                  ${escapeHtml(
                                    getMedicalHistoryFieldLabel(
                                      cambio.campo
                                    )
                                  )}
                                </strong>

                                <div>
                                  ${escapeHtml(
                                    renderMedicalHistoryValue(
                                      cambio.anterior
                                    )
                                  )}
                                  →
                                  ${escapeHtml(
                                    renderMedicalHistoryValue(
                                      cambio.nuevo
                                    )
                                  )}
                                </div>
                              </div>
                            `
                          )
                          .join("")
                      }
                    </div>
                  `
                  : ""
              }

              ${
                motivo
                  ? `
                    <div class="medical-history-reason">
                      <strong>
                        Motivo:
                      </strong>

                      ${escapeHtml(
                        motivo
                      )}
                    </div>
                  `
                  : ""
              }

              <div class="medical-history-author">
                Modificado por
                ${escapeHtml(
                  item.creadoPor ||
                  item.usuarioNombre ||
                  "—"
                )}

                ${
                  item.creadoPorCorreo ||
                  item.usuarioCorreo
                    ? `
                      · ${escapeHtml(
                        item.creadoPorCorreo ||
                        item.usuarioCorreo
                      )}
                    `
                    : ""
                }
              </div>
            </article>
          `;
        }
      )
      .join("");
}


function changeMedicalView(
  view = "fichas"
) {
  const safeView =
    view ===
      "historial"
      ? "historial"
      : "fichas";

  state.currentView =
    safeView;

  $("medicalPassengersPanel")
    ?.classList.toggle(
      "hidden",
      safeView !==
        "fichas"
    );

  $("medicalHistoryPanel")
    ?.classList.toggle(
      "hidden",
      safeView !==
        "historial"
    );

  document
    .querySelectorAll(
      "[data-medical-view]"
    )
    .forEach(
      (button) => {
        button.classList.toggle(
          "active",
          button.dataset
            .medicalView ===
            safeView
        );
      }
    );

  if (
    safeView ===
    "historial"
  ) {
    renderMedicalHistory();
  }
}

async function loadPage() {
  showLoading(true);

  try {
    const params = new URLSearchParams(location.search);
    const requested = clean(params.get("id") || params.get("grupo"));

    if (!requested) throw new Error("Falta el parámetro ?id= del grupo.");

    const resolved = await resolveGroup(requested);
    if (!resolved) throw new Error(`No se encontró el grupo ${requested}.`);

    state.groupDocId = resolved.docId;
    state.groupId = resolved.groupId;
    state.group = resolved.data;
    state.items = await loadGroupInscriptions(state.groupDocId);

    await loadMedicalHistory();

    $("groupSubtitle").textContent = [
      state.group.aliasGrupo || state.group.nombreGrupo || state.groupId,
      state.group.colegio,
      state.group.curso,
      state.group.anoViaje
    ].filter(Boolean).join(" · ");

    $("btnVolverNomina").href =
      `gestion-nomina.html?id=${encodeURIComponent(
        state.groupDocId
      )}`;
    
    $("btnVerGrupo").href =
      `fichas-medicas-grupo.html?id=${encodeURIComponent(
        state.groupDocId
      )}`;
    
    $("btnResumenOperativo").href =
      `resumen-operativo-fichas-medicas.html?id=${encodeURIComponent(
        state.groupDocId
      )}`;

    renderKpis();
    renderTypeOptions();
    renderTable();
    renderMedicalHistory();
    
    changeMedicalView(
      state.currentView ||
      "fichas"
    );

    $("content").classList.remove("hidden");
  } catch (error) {
    console.error(error);
    showError(error.message || "No fue posible cargar las fichas.");
  } finally {
    showLoading(false);
  }
}

function valueByPaths(
  item = {},
  paths = []
) {
  for (
    const path of paths
  ) {
    const value =
      getByPath(
        item,
        path
      );

    if (
      value !== undefined &&
      value !== null &&
      value !== ""
    ) {
      return value;
    }
  }

  return "";
}

function normalizedFlag(
  value
) {
  const normalized =
    normalize(
      value
    );

  return (
    value === true ||
    normalized === "si" ||
    normalized === "sí" ||
    normalized === "true"
  );
}

function tieneMedicamentos(
  item = {}
) {
  return normalizedFlag(
    valueByPaths(
      item,
      [
        "salud.medicamentosFlag",
        "antecedentesMedicos.medicamentosFlag",
        "medicamentosFlag"
      ]
    )
  );
}

function getMedicamentosDetalle(
  item = {}
) {
  return clean(
    valueByPaths(
      item,
      [
        "salud.medicamentosDetalle",
        "antecedentesMedicos.medicamentosDetalle",
        "medicamentosDetalle"
      ]
    )
  );
}

function tieneDieta(
  item = {}
) {
  const salud =
    item.salud ||
    {};

  return (
    normalize(
      salud.dietaFlag
    ) === "si" ||

    clean(
      salud.dietaDetalle
    ) !== "" ||

    (
      Array.isArray(
        salud.dietaTipos
      ) &&
      salud.dietaTipos.length >
        0
    ) ||

    (
      Array.isArray(
        salud.dietaRestricciones
      ) &&
      salud.dietaRestricciones.length >
        0
    ) ||

    (
      Array.isArray(
        salud.alergiasAlimentarias
      ) &&
      salud.alergiasAlimentarias.length >
        0
    )
  );
}

function getDietaPrincipal(
  item = {}
) {
  const salud =
    item.salud ||
    {};

  if (
    Array.isArray(
      salud.dietaTipos
    ) &&
    salud.dietaTipos.length
  ) {
    return salud.dietaTipos.join(
      ", "
    );
  }

  return clean(
    salud.dietaDetalle
  );
}

function getDietaRestricciones(
  item = {}
) {
  const salud =
    item.salud ||
    {};

  const resultado =
    [];

  if (
    Array.isArray(
      salud.dietaRestricciones
    )
  ) {
    resultado.push(
      ...salud.dietaRestricciones
    );
  }

  if (
    Array.isArray(
      salud.alergiasAlimentarias
    )
  ) {
    salud.alergiasAlimentarias
      .forEach(
        (alergia) => {
          const detalle =
            clean(
              alergia?.alimento ||
              alergia?.detalle ||
              ""
            );

          if (detalle) {
            resultado.push(
              `Alergia alimentaria: ${detalle}`
            );
          }
        }
      );
  }

  return [
    ...new Set(
      resultado
        .map(clean)
        .filter(Boolean)
    )
  ];
}

function tieneAlergias(
  item = {}
) {
  return normalizedFlag(
    valueByPaths(
      item,
      [
        "salud.alergiasFlag",
        "antecedentesMedicos.alergiasFlag",
        "alergiasFlag"
      ]
    )
  ) ||
  getDietaRestricciones(
    item
  ).includes(
    "alergia_alimentaria"
  );
}

function getAlergiasDetalle(
  item = {}
) {
  return clean(
    valueByPaths(
      item,
      [
        "salud.alergiasDetalle",
        "antecedentesMedicos.alergiasDetalle",
        "alergiasDetalle"
      ]
    )
  );
}

function tieneNeurodivergencia(
  item = {}
) {
  return normalizedFlag(
    valueByPaths(
      item,
      [
        "salud.neurodivergenciaFlag",
        "neurodivergencia.flag",
        "neurodivergenciaFlag"
      ]
    )
  );
}

function getNeuroTipos(
  item = {}
) {
  const value =
    valueByPaths(
      item,
      [
        "salud.neurodivergenciaTipos",
        "neurodivergencia.tipos",
        "neurodivergenciaTipos"
      ]
    );

  return Array.isArray(
    value
  )
    ? value
    : (
        clean(
          value
        )
          ? [
              clean(
                value
              )
            ]
          : []
      );
}

function requiereApoyos(
  item = {}
) {
  const salud =
    item.salud ||
    {};

  return !!(
    clean(
      salud.neuroApoyosDetalle
    ) ||

    clean(
      salud.discapacidadApoyoTipo
    ) ||

    clean(
      salud.discapacidadRecomendaciones
    ) ||

    clean(
      salud.discapacidadAyudaTecnica
    ) ||

    clean(
      salud.discapacidadAyudaIndicaciones
    )
  );
}

function getApoyosDetalle(
  item = {}
) {
  return clean(
    valueByPaths(
      item,
      [
        "salud.neuroApoyosDetalle",
        "neurodivergencia.apoyosDetalle",
        "salud.discapacidadRecomendaciones",
        "neuroApoyosDetalle"
      ]
    )
  );
}

function grupoSanguineoDesconocido(
  item = {}
) {
  const value =
    normalize(
      valueByPaths(
        item,
        [
          "salud.grupoSanguineo",
          "grupoSanguineo",
          "antecedentesMedicos.grupoSanguineo"
        ]
      )
    )
      .replace(
        /\s+/g,
        "_"
      );

  return (
    !value ||
    value ===
      "no_informado" ||
    value ===
      "no_lo_se" ||
    value ===
      "desconocido"
  );
}

function tieneAntecedentesRelevantes(
  item = {}
) {
  const salud =
    item.salud ||
    {};

  return (
    normalize(
      salud.enfermedadBaseFlag
    ) === "si" ||
    !!clean(
      salud.enfermedadBaseDetalle
    ) ||

    normalize(
      salud.saludGeneralFlag
    ) === "si" ||
    !!clean(
      salud.saludGeneralDetalle
    ) ||

    normalize(
      salud.cirugiasPreviasFlag
    ) === "si" ||
    !!clean(
      salud.cirugiasPreviasDetalle
    ) ||

    normalize(
      salud.emergenciaMedicaFlag
    ) === "si" ||
    !!clean(
      salud.emergenciaMedicaDetalle
    ) ||

    normalize(
      salud.saludMentalFlag
    ) === "si" ||
    !!clean(
      salud.saludMentalDetalle
    ) ||

    normalize(
      salud.otrosAntecedentesFlag
    ) === "si" ||
    !!clean(
      salud.otrosAntecedentesDetalle
    )
  );
}

function renderKpis() {
  /*
    En Gestión de Fichas Médicas
    solo interesan pasajeros que VIAJAN.
  */
  const activos =
    state.items.filter(
      (item) =>
        !isCancelled(
          item
        )
    );

  $("kpiTotal").textContent =
    activos.length;

  $("kpiCompletas").textContent =
    activos.filter(
      fichaCompleta
    ).length;

  $("kpiPendientes").textContent =
    activos.filter(
      (item) =>
        !fichaCompleta(
          item
        )
    ).length;

  $("kpiAlertas").textContent =
    activos.filter(
      (item) =>
        medicalAlerts(
          item
        ).length > 0
    ).length;

  $("kpiMedicamentos").textContent =
    activos.filter(
      tieneMedicamentos
    ).length;

  $("kpiDietas").textContent =
    activos.filter(
      tieneDieta
    ).length;

  $("kpiAlergias").textContent =
    activos.filter(
      tieneAlergias
    ).length;

  $("kpiNeurodivergencia").textContent =
    activos.filter(
      tieneNeurodivergencia
    ).length;

  $("kpiApoyos").textContent =
    activos.filter(
      requiereApoyos
    ).length;

  $("kpiGrupoSanguineo").textContent =
    activos.filter(
      (item) =>
        fichaCompleta(
          item
        ) &&
        grupoSanguineoDesconocido(
          item
        )
    ).length;

  $("kpiAntecedentes").textContent =
    activos.filter(
      tieneAntecedentesRelevantes
    ).length;
}

function renderTypeOptions() {
  const values = [...new Set(
    state.items.map((item) => clean(item.tipoInscripcion || item.tipoViajante)).filter(Boolean)
  )].sort((a, b) => a.localeCompare(b, "es"));

  $("typeFilter").innerHTML = `
    <option value="">Todos los tipos</option>
    ${values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("")}
  `;
}

function getFilteredItems() {
  const search =
    normalize(
      $("searchInput")
        ?.value
    );

  const status =
    normalize(
      $("statusFilter")
        ?.value
    );

  const type =
    clean(
      $("typeFilter")
        ?.value
    );

  return state.items.filter(
    (item) => {
      /*
        ANULADOS NO APLICAN
        A GESTIÓN DE FICHAS MÉDICAS.
      */
      if (
        isCancelled(
          item
        )
      ) {
        return false;
      }

      const searchable =
        normalize(
          [
            passengerName(
              item
            ),
            passengerDocument(
              item
            ),
            item
              ?.contactoPrincipal
              ?.nombre,
            item
              ?.contactoPrincipal
              ?.correo,
            item
              ?.contactoPrincipal
              ?.telefono,
            item
              ?.identificacion
              ?.correoViajante,
            item
              ?.identificacion
              ?.telefonoViajante
          ].join(" ")
        );

      if (
        search &&
        !searchable.includes(
          search
        )
      ) {
        return false;
      }

      if (
        type &&
        clean(
          item.tipoInscripcion ||
          item.tipoViajante
        ) !== type
      ) {
        return false;
      }

      if (
        status ===
          "completa" &&
        !fichaCompleta(
          item
        )
      ) {
        return false;
      }

      if (
        status ===
          "pendiente" &&
        fichaCompleta(
          item
        )
      ) {
        return false;
      }

      if (
        status ===
          "alerta" &&
        !medicalAlerts(
          item
        ).length
      ) {
        return false;
      }

      return true;
    }
  );
}

function ordenarFichasMedicas(
  items = []
) {
  return [
    ...items
  ].sort(
    (
      a,
      b
    ) => {
      const ordenEstado = (
        item
      ) => {
        if (
          fichaCompleta(
            item
          )
        ) {
          return 10;
        }
      
        return 20;
      };

      const estadoA =
        ordenEstado(
          a
        );

      const estadoB =
        ordenEstado(
          b
        );

      if (
        estadoA !==
        estadoB
      ) {
        return (
          estadoA -
          estadoB
        );
      }

      return passengerName(
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
      );
    }
  );
}

function renderTable() {
  const rows =
    ordenarFichasMedicas(
      getFilteredItems()
    );

  $("tableBody").innerHTML =
    rows.length
      ? rows
          .map(
            (
              item,
              index
            ) => {
              const alerts =
                medicalAlerts(
                  item
                );

              const statusClass =
                isCancelled(
                  item
                )
                  ? "status-cancelled"
                  : fichaCompleta(
                      item
                    )
                    ? "status-complete"
                    : "status-pending";

              const statusText =
                isCancelled(
                  item
                )
                  ? "Anulado"
                  : fichaCompleta(
                      item
                    )
                    ? "Completa"
                    : "Pendiente";

              return `
                <tr>
                  <td>
                    ${index + 1}
                  </td>

                  <td>
                    <strong>
                      ${escapeHtml(
                        passengerName(
                          item
                        )
                      )}
                    </strong>
                  </td>

                  <td>
                    ${escapeHtml(
                      passengerDocument(
                        item
                      )
                    )}
                  </td>

                  <td>
                    ${escapeHtml(
                      item.tipoInscripcion ||
                      item.tipoViajante ||
                      "—"
                    )}
                  </td>

                  <td>
                    <span
                      class="status ${statusClass}"
                    >
                      ${statusText}
                    </span>
                  </td>

                  <td>
                    ${
                      alerts.length
                        ? alerts
                            .map(
                              (
                                alert
                              ) => `
                                <button
                                  type="button"
                                  class="alert-chip alert-chip-button"
                                  data-medical-alert="${escapeHtml(
                                    alert
                                  )}"
                                  data-inscripcion-id="${escapeHtml(
                                    item.id
                                  )}"
                                >
                                  ${escapeHtml(
                                    alert
                                  )}
                                </button>
                              `
                            )
                            .join("")
                        : `
                          <span class="no-alerts">
                            Sin alertas
                          </span>
                        `
                    }
                  </td>

                  <td>
                    ${escapeHtml(
                      item
                        ?.contactoPrincipal
                        ?.nombre ||
                      "—"
                    )}

                    <br>

                    <small>
                      ${escapeHtml(
                        item
                          ?.contactoPrincipal
                          ?.correo ||
                        ""
                      )}
                    </small>
                  </td>

                  <td>
                    ${escapeHtml(
                      formatDate(
                        item
                          ?.auditoriaFichaMedica
                          ?.actualizadoAt ||
                        item
                          ?.meta
                          ?.fechaFormularioCliente ||
                        item
                          ?.meta
                          ?.fechaInscripcion
                      )
                    )}
                  </td>

                  <td>
                    <div class="actions">
                      <button
                        class="btn-light"
                        type="button"
                        data-view="${escapeHtml(
                          item.id
                        )}"
                      >
                        Ver
                      </button>

                      <button
                        class="btn-yellow"
                        type="button"
                        data-print="${escapeHtml(
                          item.id
                        )}"
                      >
                        PDF
                      </button>

                      ${
                        canEditMedicalData(
                          state.user
                        )
                          ? `
                            <button
                              class="btn-primary"
                              type="button"
                              data-edit="${escapeHtml(
                                item.id
                              )}"
                            >
                              Editar
                            </button>
                          `
                          : ""
                      }
                    </div>
                  </td>
                </tr>
              `;
            }
          )
          .join("")
      : `
        <tr>
          <td colspan="9">
            No hay pasajeros que coincidan con los filtros.
          </td>
        </tr>
      `;
}

function onTableClick(
  event
) {
  const alertButton =
    event.target.closest(
      "[data-medical-alert]"
    );

  if (alertButton) {
    abrirDetalleAlertaIndividual(
      alertButton.dataset
        .inscripcionId,
      alertButton.dataset
        .medicalAlert
    );

    return;
  }

  const viewId =
    event.target.closest(
      "[data-view]"
    )?.dataset.view;

  const printId =
    event.target.closest(
      "[data-print]"
    )?.dataset.print;

  const editId =
    event.target.closest(
      "[data-edit]"
    )?.dataset.edit;

  if (viewId) {
    location.href =
      `ficha-medica.html?grupo=${encodeURIComponent(
        state.groupDocId
      )}&id=${encodeURIComponent(
        viewId
      )}`;

    return;
  }

  if (printId) {
    location.href =
      `ficha-medica.html?grupo=${encodeURIComponent(
        state.groupDocId
      )}&id=${encodeURIComponent(
        printId
      )}&print=1`;

    return;
  }

  if (editId) {
    openEdit(
      editId
    );
  }
}

function abrirModalDetalleMedico(
  titulo,
  subtitulo,
  html
) {
  $("medicalDetailTitle").textContent =
    titulo;

  $("medicalDetailSubtitle").textContent =
    subtitulo ||
    "";

  $("medicalDetailContent").innerHTML =
    html ||
    `
      <p>
        No hay información para mostrar.
      </p>
    `;

  $("medicalDetailModal")
    .classList
    .remove(
      "hidden"
    );
}

function cerrarModalDetalleMedico() {
  $("medicalDetailModal")
    ?.classList
    .add(
      "hidden"
    );
}

function renderPersonaDetalleMedico(
  item,
  detalle = ""
) {
  return `
    <article class="medical-detail-person">
      <div class="medical-detail-person-head">
        <div>
          <strong>
            ${escapeHtml(
              passengerName(
                item
              )
            )}
          </strong>

          <small>
            ${escapeHtml(
              passengerDocument(
                item
              )
            )}
          </small>
        </div>

        <a
          class="button-link btn-light"
          href="ficha-medica.html?grupo=${encodeURIComponent(
            state.groupDocId
          )}&id=${encodeURIComponent(
            item.id
          )}"
        >
          Ver ficha
        </a>
      </div>

      ${
        detalle
          ? `
            <div class="medical-detail-text">
              ${detalle}
            </div>
          `
          : ""
      }
    </article>
  `;
}

function abrirDetalleMedicoTipo(
  tipo
) {
  const activos =
    state.items.filter(
      (item) =>
        !isCancelled(
          item
        )
    );

  let titulo =
    "Detalle médico";

  let rows =
    [];

  let detalleFn =
    () =>
      "";

  if (
    tipo ===
    "medicamentos"
  ) {
    titulo =
      "Medicamentos";

    rows =
      activos.filter(
        tieneMedicamentos
      );

    detalleFn =
      (item) => `
        <strong>Medicamentos informados:</strong>
        <br>
        ${escapeHtml(
          getMedicamentosDetalle(
            item
          ) ||
          "Sin detalle informado."
        )}
      `;
  }

  if (
    tipo ===
    "dietas"
  ) {
    titulo =
      "Dietas y restricciones alimentarias";

    rows =
      activos.filter(
        tieneDieta
      );

    detalleFn =
      (item) => {
        const principal =
          getDietaPrincipal(
            item
          );

        const restricciones =
          getDietaRestricciones(
            item
          );

        return `
          ${
            principal
              ? `
                <strong>
                  Dieta principal:
                </strong>
                ${escapeHtml(
                  principal
                )}
                <br>
              `
              : ""
          }

          ${
            restricciones.length
              ? `
                <strong>
                  Restricciones:
                </strong>
                ${escapeHtml(
                  restricciones.join(
                    ", "
                  )
                )}
              `
              : ""
          }
        `;
      };
  }

  if (
    tipo ===
    "alergias"
  ) {
    titulo =
      "Alergias";

    rows =
      activos.filter(
        tieneAlergias
      );

    detalleFn =
      (item) => `
        ${escapeHtml(
          getAlergiasDetalle(
            item
          ) ||
          getDietaRestricciones(
            item
          ).join(", ") ||
          "Alergia informada sin detalle visible."
        )}
      `;
  }

  if (
    tipo ===
    "neurodivergencia"
  ) {
    titulo =
      "Neurodivergencia";

    rows =
      activos.filter(
        tieneNeurodivergencia
      );

    detalleFn =
      (item) => {
        const tipos =
          getNeuroTipos(
            item
          );

        const descripcion =
          clean(
            valueByPaths(
              item,
              [
                "salud.neurodivergenciaDescripcion",
                "neurodivergencia.descripcion"
              ]
            )
          );

        return `
          <strong>
            Tipo:
          </strong>
          ${escapeHtml(
            tipos.join(", ") ||
            "No especificado"
          )}

          ${
            descripcion
              ? `
                <br>
                <strong>
                  Descripción:
                </strong>
                ${escapeHtml(
                  descripcion
                )}
              `
              : ""
          }

          ${
            requiereApoyos(
              item
            )
              ? `
                <br>
                <strong>
                  Requiere apoyo:
                </strong>
                Sí

                ${
                  getApoyosDetalle(
                    item
                  )
                    ? `
                      <br>
                      ${escapeHtml(
                        getApoyosDetalle(
                          item
                        )
                      )}
                    `
                    : ""
                }
              `
              : `
                <br>
                <strong>
                  Requiere apoyo:
                </strong>
                No informado
              `
          }
        `;
      };
  }

  if (
    tipo ===
    "apoyos"
  ) {
    titulo =
      "Personas que requieren apoyo";

    rows =
      activos.filter(
        requiereApoyos
      );

    detalleFn =
      (item) =>
        escapeHtml(
          getApoyosDetalle(
            item
          ) ||
          "Apoyo informado sin detalle visible."
        );
  }

  if (
    tipo ===
    "grupo_sanguineo"
  ) {
    titulo =
      "Grupo sanguíneo no informado";

    rows =
      activos.filter(
        (item) =>
          fichaCompleta(
            item
          ) &&
          grupoSanguineoDesconocido(
            item
          )
      );

    detalleFn =
      () =>
        "Grupo sanguíneo desconocido o no informado.";
  }

  if (
    tipo ===
    "antecedentes"
  ) {
    titulo =
      "Antecedentes médicos relevantes";

    rows =
      activos.filter(
        tieneAntecedentesRelevantes
      );

    detalleFn =
      (item) => {
        const detalles = [
          valueByPaths(
            item,
            [
              "salud.enfermedadBaseDetalle"
            ]
          ),
          valueByPaths(
            item,
            [
              "salud.saludGeneralDetalle"
            ]
          ),
          valueByPaths(
            item,
            [
              "salud.cirugiasPreviasDetalle"
            ]
          ),
          valueByPaths(
            item,
            [
              "salud.emergenciaMedicaDetalle"
            ]
          ),
          valueByPaths(
            item,
            [
              "salud.saludMentalDetalle"
            ]
          )
        ]
          .map(clean)
          .filter(Boolean);

        return escapeHtml(
          detalles.join(" · ") ||
          "Antecedente médico informado."
        );
      };
  }

  abrirModalDetalleMedico(
    `${titulo} · ${rows.length}`,
    "Personas del grupo que cumplen este criterio.",
    rows.length
      ? rows
          .map(
            (item) =>
              renderPersonaDetalleMedico(
                item,
                detalleFn(
                  item
                )
              )
          )
          .join("")
      : `
        <p class="no-alerts">
          No hay pasajeros en esta categoría.
        </p>
      `
  );
}

function abrirDetalleAlertaIndividual(
  id,
  alerta
) {
  const item =
    state.items.find(
      (row) =>
        String(
          row.id
        ) ===
        String(
          id
        )
    );

  if (!item) {
    return;
  }

  const salud =
    item.salud ||
    {};

  const tipo =
    normalize(
      alerta
    );

  let titulo =
    alerta ||
    "Detalle médico";

  let detalle =
    "";

  /*
    MEDICAMENTOS
  */
  if (
    tipo.includes(
      "medicamento"
    )
  ) {
    titulo =
      "Medicamentos";

    detalle = `
      <strong>
        Medicamentos informados:
      </strong>

      <br>

      ${escapeHtml(
        clean(
          salud.medicamentosDetalle
        ) ||
        "Sin detalle informado."
      )}

      ${
        normalize(
          salud.medicamentosProhibidosFlag
        ) === "si" ||
        clean(
          salud.medicamentosProhibidosDetalle
        )
          ? `
            <br><br>

            <strong>
              Medicamentos prohibidos / contraindicados:
            </strong>

            <br>

            ${escapeHtml(
              clean(
                salud.medicamentosProhibidosDetalle
              ) ||
              "Informado sin detalle."
            )}
          `
          : ""
      }
    `;
  }

  /*
    SALUD MENTAL
  */
  else if (
    tipo.includes(
      "salud mental"
    )
  ) {
    titulo =
      "Salud mental";

    detalle = `
      <strong>
        Antecedente informado:
      </strong>

      <br>

      ${escapeHtml(
        clean(
          salud.saludMentalDetalle
        ) ||
        "Antecedente de salud mental informado sin detalle."
      )}
    `;
  }

  /*
    EMERGENCIA MÉDICA
  */
  else if (
    tipo.includes(
      "emergencia"
    )
  ) {
    titulo =
      "Antecedente de emergencia médica";

    detalle = `
      <strong>
        Antecedente informado:
      </strong>

      <br>

      ${escapeHtml(
        clean(
          salud.emergenciaMedicaDetalle
        ) ||
        "Antecedente de emergencia médica informado sin detalle."
      )}
    `;
  }

  /*
    ALERGIAS
  */
  else if (
    tipo.includes(
      "alerg"
    )
  ) {
    titulo =
      "Alergias";

    const alimentarias =
      Array.isArray(
        salud.alergiasAlimentarias
      )
        ? salud.alergiasAlimentarias
            .map(
              (alergia) =>
                clean(
                  alergia?.alimento ||
                  alergia?.detalle ||
                  ""
                )
            )
            .filter(Boolean)
        : [];

    detalle = `
      <strong>
        Alergias informadas:
      </strong>

      <br>

      ${escapeHtml(
        clean(
          salud.alergiasDetalle
        ) ||
        (
          alimentarias.length
            ? alimentarias.join(
                " · "
              )
            : "Alergia informada sin detalle."
        )
      )}
    `;
  }

  /*
    ALIMENTACIÓN
  */
  else if (
    tipo.includes(
      "aliment"
    )
  ) {
    titulo =
      "Alimentación";

    const tipos =
      Array.isArray(
        salud.dietaTipos
      )
        ? salud.dietaTipos
        : [];

    const restricciones =
      Array.isArray(
        salud.dietaRestricciones
      )
        ? salud.dietaRestricciones
        : [];

    const alergiasAlimentarias =
      Array.isArray(
        salud.alergiasAlimentarias
      )
        ? salud.alergiasAlimentarias
            .map(
              (alergia) =>
                clean(
                  alergia?.alimento ||
                  alergia?.detalle ||
                  ""
                )
            )
            .filter(Boolean)
        : [];

    detalle = `
      ${
        clean(
          salud.dietaDetalle
        )
          ? `
            <strong>
              Detalle:
            </strong>

            <br>

            ${escapeHtml(
              salud.dietaDetalle
            )}

            <br><br>
          `
          : ""
      }

      ${
        tipos.length
          ? `
            <strong>
              Tipos de dieta:
            </strong>

            <br>

            ${escapeHtml(
              tipos.join(
                ", "
              )
            )}

            <br><br>
          `
          : ""
      }

      ${
        restricciones.length
          ? `
            <strong>
              Restricciones:
            </strong>

            <br>

            ${escapeHtml(
              restricciones.join(
                ", "
              )
            )}

            <br><br>
          `
          : ""
      }

      ${
        alergiasAlimentarias.length
          ? `
            <strong>
              Alergias alimentarias:
            </strong>

            <br>

            ${escapeHtml(
              alergiasAlimentarias.join(
                " · "
              )
            )}
          `
          : ""
      }

      ${
        !clean(
          salud.dietaDetalle
        ) &&
        !tipos.length &&
        !restricciones.length &&
        !alergiasAlimentarias.length
          ? "Información alimentaria registrada sin detalle visible."
          : ""
      }
    `;
  }

  /*
    ENFERMEDAD DE BASE
  */
  else if (
    tipo.includes(
      "enfermedad"
    )
  ) {
    titulo =
      "Enfermedad de base";

    detalle = `
      <strong>
        Enfermedad / condición:
      </strong>

      <br>

      ${escapeHtml(
        clean(
          salud.enfermedadBaseDetalle
        ) ||
        "Enfermedad de base informada sin detalle."
      )}
    `;
  }

  /*
    NEURODIVERGENCIA
  */
  else if (
    tipo.includes(
      "neuro"
    )
  ) {
    titulo =
      "Neurodivergencia";

    const tipos =
      Array.isArray(
        salud.neurodivergenciaTipos
      )
        ? salud.neurodivergenciaTipos
        : [];

    detalle = `
      ${
        tipos.length
          ? `
            <strong>
              Tipo:
            </strong>

            <br>

            ${escapeHtml(
              tipos.join(
                ", "
              )
            )}

            <br><br>
          `
          : ""
      }

      ${
        clean(
          salud.neurodivergenciaDescripcion
        )
          ? `
            <strong>
              Descripción:
            </strong>

            <br>

            ${escapeHtml(
              salud.neurodivergenciaDescripcion
            )}

            <br><br>
          `
          : ""
      }

      ${
        clean(
          salud.neuroFactores
        )
          ? `
            <strong>
              Factores de sobrecarga:
            </strong>

            <br>

            ${escapeHtml(
              salud.neuroFactores
            )}

            <br><br>
          `
          : ""
      }

      ${
        clean(
          salud.neuroEstrategias
        )
          ? `
            <strong>
              Estrategias:
            </strong>

            <br>

            ${escapeHtml(
              salud.neuroEstrategias
            )}

            <br><br>
          `
          : ""
      }

      <strong>
        Apoyos / consideraciones:
      </strong>

      <br>

      ${escapeHtml(
        clean(
          salud.neuroApoyosDetalle
        ) ||
        "No se informaron apoyos específicos."
      )}
    `;
  }

  /*
    APOYOS / DISCAPACIDAD
  */
  else if (
    tipo.includes(
      "apoyo"
    ) ||
    tipo.includes(
      "discap"
    )
  ) {
    titulo =
      "Apoyos y consideraciones";

    const tipos =
      Array.isArray(
        salud.discapacidadTipos
      )
        ? salud.discapacidadTipos
        : [];

    detalle = `
      ${
        tipos.length
          ? `
            <strong>
              Tipo:
            </strong>

            <br>

            ${escapeHtml(
              tipos.join(
                ", "
              )
            )}

            <br><br>
          `
          : ""
      }

      ${
        clean(
          salud.discapacidadDescripcion
        )
          ? `
            <strong>
              Descripción:
            </strong>

            <br>

            ${escapeHtml(
              salud.discapacidadDescripcion
            )}

            <br><br>
          `
          : ""
      }

      ${
        clean(
          salud.discapacidadApoyoTipo
        )
          ? `
            <strong>
              Apoyo requerido:
            </strong>

            <br>

            ${escapeHtml(
              salud.discapacidadApoyoTipo
            )}

            <br><br>
          `
          : ""
      }

      ${
        clean(
          salud.discapacidadRecomendaciones
        )
          ? `
            <strong>
              Recomendaciones:
            </strong>

            <br>

            ${escapeHtml(
              salud.discapacidadRecomendaciones
            )}
          `
          : ""
      }
    `;
  }

  /*
    CUALQUIER ALERTA FUTURA
  */
  else {
    titulo =
      alerta ||
      "Información médica";

    detalle = `
      Existe información médica asociada a esta alerta.

      <br><br>

      Presiona <strong>Ver ficha</strong>
      para revisar el antecedente completo.
    `;
  }

  abrirModalDetalleMedico(
    `${titulo} · ${passengerName(
      item
    )}`,
    passengerDocument(
      item
    ),
    renderPersonaDetalleMedico(
      item,
      detalle
    )
  );
}

function openEdit(id) {
  if (
    !canEditMedicalData(
      state.user
    )
  ) {
    alert(
      "No tienes permisos para editar fichas médicas."
    );

    return;
  }

  const item =
    state.items.find(
      (row) =>
        row.id ===
        id
    );

  if (!item) {
    return;
  }

  state.editingId =
    id;

  $("editTitle").textContent =
    `Editar ficha médica · ${passengerName(
      item
    )}`;

  $("editReason").value =
    "";

  /*
    IMPORTANTE:
    usamos exclusivamente MEDICAL_EDIT_FIELDS.
  */
  const sections =
    [
      ...new Set(
        MEDICAL_EDIT_FIELDS.map(
          (field) =>
            field.section
        )
      )
    ];

  $("editFields").innerHTML =
    sections
      .map(
        (sectionName) => {
          const fields =
            MEDICAL_EDIT_FIELDS.filter(
              (field) =>
                field.section ===
                sectionName
            );

          return `
            <section class="edit-section">
              <h3>
                ${escapeHtml(
                  sectionName
                )}
              </h3>

              <div class="edit-grid">
                ${
                  fields
                    .map(
                      (field) =>
                        renderInput(
                          field,
                          getByPath(
                            item,
                            field.path
                          )
                        )
                    )
                    .join("")
                }
              </div>
            </section>
          `;
        }
      )
      .join("");

  $("editModal")
    .classList
    .remove(
      "hidden"
    );
}

function renderInput(
  field,
  value
) {
  const type =
    field.type ||
    "text";

  const options =
    Array.isArray(
      field.options
    )
      ? field.options
      : [];

  const serialized =
    type ===
      "array"
      ? (
          Array.isArray(
            value
          )
            ? value.join(
                ", "
              )
            : clean(
                value
              )
        )
      : clean(
          value
        );

  const wideClass =
    type ===
      "textarea" ||
    type ===
      "multicheck"
      ? "is-wide"
      : "";

  /*
    =====================================================
    TEXTAREA
    =====================================================
  */
  if (
    type ===
    "textarea"
  ) {
    return `
      <div class="field ${wideClass}">
        <label>
          ${escapeHtml(
            field.label
          )}
        </label>

        <textarea
          data-edit-path="${escapeHtml(
            field.path
          )}"
          data-edit-type="text"
        >${escapeHtml(
          serialized
        )}</textarea>
      </div>
    `;
  }

  /*
    =====================================================
    SELECT
    =====================================================
  */
  if (
    type ===
    "select"
  ) {
    return `
      <div class="field">
        <label>
          ${escapeHtml(
            field.label
          )}
        </label>

        <select
          data-edit-path="${escapeHtml(
            field.path
          )}"
          data-edit-type="select"
        >
          <option value="">
            Seleccione...
          </option>

          ${
            options
              .map(
                (option) => `
                  <option
                    value="${escapeHtml(
                      option.value
                    )}"
                    ${
                      String(
                        option.value
                      ) ===
                      String(
                        value ??
                        ""
                      )
                        ? "selected"
                        : ""
                    }
                  >
                    ${escapeHtml(
                      option.label
                    )}
                  </option>
                `
              )
              .join("")
          }
        </select>
      </div>
    `;
  }

  /*
    =====================================================
    BOOLEAN
    =====================================================
  */
  if (
    type ===
    "boolean"
  ) {
    return `
      <div class="field is-wide">
        <label
          style="
            display:flex;
            align-items:center;
            gap:9px;
          "
        >
          <input
            type="checkbox"
            data-edit-path="${escapeHtml(
              field.path
            )}"
            data-edit-type="boolean"
            ${
              value === true
                ? "checked"
                : ""
            }
          >

          ${escapeHtml(
            field.label
          )}
        </label>
      </div>
    `;
  }

  /*
    =====================================================
    MULTI CHECKBOX
    =====================================================
  */
  if (
    type ===
    "multicheck"
  ) {
    const selectedValues =
      Array.isArray(
        value
      )
        ? value.map(
            String
          )
        : [];

    return `
      <div class="field is-wide">
        <label>
          ${escapeHtml(
            field.label
          )}
        </label>

        <div
          style="
            display:flex;
            flex-wrap:wrap;
            gap:8px;
          "
          data-edit-path="${escapeHtml(
            field.path
          )}"
          data-edit-type="multicheck"
        >
          ${
            options
              .map(
                (option) => `
                  <label
                    style="
                      display:inline-flex;
                      align-items:center;
                      gap:6px;
                      padding:8px 10px;
                      border:1px solid #dbe4f0;
                      border-radius:999px;
                      background:#fff;
                    "
                  >
                    <input
                      type="checkbox"
                      value="${escapeHtml(
                        option.value
                      )}"
                      ${
                        selectedValues.includes(
                          String(
                            option.value
                          )
                        )
                          ? "checked"
                          : ""
                      }
                    >

                    ${escapeHtml(
                      option.label
                    )}
                  </label>
                `
              )
              .join("")
          }
        </div>
      </div>
    `;
  }

  /*
    =====================================================
    INPUT NORMAL
    =====================================================
  */
  return `
    <div class="field ${wideClass}">
      <label>
        ${escapeHtml(
          field.label
        )}
      </label>

      <input
        type="${escapeHtml(
          type ===
            "array"
            ? "text"
            : type
        )}"
        value="${escapeHtml(
          serialized
        )}"
        data-edit-path="${escapeHtml(
          field.path
        )}"
        data-edit-type="${escapeHtml(
          type
        )}"
      >
    </div>
  `;
}

async function registrarEventoHistorialMedico(
  inscriptionRef,
  item,
  {
    motivo = "",
    cambios = []
  } = {}
) {
  const nombre =
    passengerName(
      item
    );

  const documentoPersona =
    passengerDocument(
      item
    );

  const cambiosSeguros =
    Array.isArray(
      cambios
    )
      ? cambios
      : [];

  const eventoGeneral = {
    idGrupo:
      state.groupId,

    groupDocId:
      state.groupDocId,

    aliasGrupo:
      clean(
        state.group?.aliasGrupo ||
        state.group?.nombreGrupo ||
        state.group?.colegio ||
        state.groupId
      ),

    tipoMovimiento:
      "edicion_ficha_medica",

    modulo:
      "ficha_medica",

    titulo:
      "Edición de ficha médica",

    mensaje:
      `${state.user.nombre} modificó la ficha médica de ${nombre}.`,

    motivo:
      motivo,

    cambios:
      cambiosSeguros,

    metadata: {
      inscripcionId:
        state.editingId,

      documento:
        documentoPersona,

      nombreCompleto:
        nombre,

      motivo,

      origen:
        "gestion_fichas_medicas",

      cambios:
        cambiosSeguros
    },

    fecha:
      serverTimestamp(),

    creadoPor:
      state.user.nombre,

    creadoPorCorreo:
      state.user.email
  };

  /*
    1. HISTORIAL INDIVIDUAL
  */
  await addDoc(
    collection(
      inscriptionRef,
      "historial_ficha"
    ),
    {
      tipoMovimiento:
        "edicion_ficha_medica",

      titulo:
        "Edición de ficha médica",

      fecha:
        serverTimestamp(),

      usuarioNombre:
        state.user.nombre,

      usuarioCorreo:
        state.user.email,

      motivo,

      cambios:
        cambiosSeguros,

      origen:
        "gestion_fichas_medicas"
    }
  );

  /*
    2. HISTORIAL MÉDICO DEL GRUPO
  */
  await addDoc(
    collection(
      db,
      "ventas_cotizaciones",
      state.groupDocId,
      "historial_ficha_medica"
    ),
    eventoGeneral
  );

  /*
    3. HISTORIAL GENERAL DEL GRUPO
  */
  await addDoc(
    collection(
      db,
      "ventas_historial"
    ),
    eventoGeneral
  );
}

async function saveEdit(event) {
  event.preventDefault();

  if (
    !state.editingId ||
    !canEditMedicalData(
      state.user
    )
  ) {
    return;
  }

  const reason =
    clean(
      $("editReason").value
    );

  if (!reason) {
    alert(
      "Debes indicar el motivo de la corrección."
    );

    return;
  }

  const item =
    state.items.find(
      (row) =>
        row.id ===
        state.editingId
    );

  if (!item) {
    return;
  }

  const patch =
    {};

  const cambios =
    [];

  /*
    Solamente tomamos inputs que fueron creados
    desde MEDICAL_EDIT_FIELDS.
  */
  document
    .querySelectorAll(
      "#editModal [data-edit-path]"
    )
    .forEach(
      (input) => {
        const path =
          input.dataset
            .editPath;

        /*
          SEGUNDO BLINDAJE:

          incluso si alguien agrega accidentalmente
          un input administrativo al HTML, no dejamos
          que se guarde si su ruta no pertenece a
          MEDICAL_EDIT_FIELDS.
        */
        const permitido =
          MEDICAL_EDIT_FIELDS.some(
            (field) =>
              field.path ===
              path
          );

        if (!permitido) {
          console.warn(
            "[gestion-fichas-medicas] Campo rechazado:",
            path
          );

          return;
        }

        const type =
          input.dataset
            .editType;

        const oldValue =
          getByPath(
            item,
            path
          );

        let newValue;
        
        /*
          BOOLEAN
        */
        if (
          type ===
          "boolean"
        ) {
          newValue =
            input.checked ===
            true;
        }
        
        /*
          MULTICHECK
        */
        else if (
          type ===
          "multicheck"
        ) {
          newValue =
            Array.from(
              input.querySelectorAll(
                'input[type="checkbox"]:checked'
              )
            )
              .map(
                (checkbox) =>
                  clean(
                    checkbox.value
                  )
              )
              .filter(Boolean);
        }
        
        /*
          ARRAY ANTIGUO
        */
        else if (
          type ===
          "array"
        ) {
          newValue =
            clean(
              input.value
            )
              .split(",")
              .map(clean)
              .filter(Boolean);
        }
        
        /*
          TEXTO / SELECT
        */
        else {
          newValue =
            clean(
              input.value
            );
        }

        if (
          JSON.stringify(
            oldValue ??
            ""
          ) !==
          JSON.stringify(
            newValue
          )
        ) {
          /*
            GUARDADO QUIRÚRGICO.

            patch utiliza la ruta exacta:
            salud.x
            dieta.x
            antecedentesMedicos.x
            etc.

            NO reemplazamos objetos completos.
          */
          patch[path] =
            newValue;

          cambios.push({
            campo:
              path,

            anterior:
              oldValue ??
              "",

            nuevo:
              newValue
          });
        }
      }
    );

  /*
    =====================================================
    CAMPOS DERIVADOS / ESPEJO
    =====================================================
  */
  
  /*
    Emergencia 1.
    Cuando la relación NO es "otro",
    relación final debe quedar igual
    a relaciónBase.
  */
  if (
    patch[
      "emergencia.relacionBase"
    ] !== undefined &&
    patch[
      "emergencia.relacionBase"
    ] !== "otro"
  ) {
    patch[
      "emergencia.relacion"
    ] =
      patch[
        "emergencia.relacionBase"
      ];
  }
  
  /*
    Emergencia 2.
  */
  if (
    patch[
      "emergenciaSecundaria.relacionBase"
    ] !== undefined &&
    patch[
      "emergenciaSecundaria.relacionBase"
    ] !== "otro"
  ) {
    patch[
      "emergenciaSecundaria.relacion"
    ] =
      patch[
        "emergenciaSecundaria.relacionBase"
      ];
  }

  if (!cambios.length) {
    alert(
      "No hay cambios para guardar."
    );

    return;
  }

  /*
    AUDITORÍA MÉDICA DEL DOCUMENTO.

    Esto permite saber:
    - cuándo fue modificado,
    - quién lo hizo,
    - por qué,
    - y cuántas versiones administrativas lleva.
  */
  patch[
    "auditoriaFichaMedica.actualizadoAt"
  ] =
    serverTimestamp();

  patch[
    "auditoriaFichaMedica.actualizadoPor"
  ] =
    state.user.nombre;

  patch[
    "auditoriaFichaMedica.actualizadoPorCorreo"
  ] =
    state.user.email;

  patch[
    "auditoriaFichaMedica.motivoUltimoCambio"
  ] =
    reason;

  patch[
    "auditoriaFichaMedica.version"
  ] =
    Number(
      item
        ?.auditoriaFichaMedica
        ?.version ||
      0
    ) + 1;

  const button =
    $("btnSaveEdit");

  button.disabled =
    true;

  button.textContent =
    "Guardando...";

  try {
    const inscriptionRef =
      doc(
        db,
        "ventas_cotizaciones",
        state.groupDocId,
        "inscripciones",
        state.editingId
      );

    /*
      =====================================================
      1. ACTUALIZACIÓN SEGURA DE LA INSCRIPCIÓN
      =====================================================

      Modificamos solamente las rutas que realmente
      cambiaron.

      Este punto es importante para NO repetir el
      problema que ocurrió antiguamente al reemplazar
      objetos completos y borrar otros datos.
    */
    await updateDoc(
      inscriptionRef,
      patch
    );

    const nombrePasajero =
      passengerName(
        item
      );

    const documentoPasajero =
      passengerDocument(
        item
      );

    const aliasGrupo =
      clean(
        state.group
          ?.aliasGrupo ||
        state.group
          ?.nombreGrupo ||
        state.group
          ?.colegio ||
        state.groupId ||
        state.groupDocId
      );

    /*
      Evento común que utilizaremos para
      el historial médico del grupo y
      ventas_historial.

      De esta manera ambos registros tienen
      exactamente la misma información.
    */
    const eventoGeneral = {
      idGrupo:
        state.groupId,

      groupDocId:
        state.groupDocId,

      aliasGrupo,

      tipoMovimiento:
        "edicion_ficha_medica",

      modulo:
        "ficha_medica",

      titulo:
        "Edición de ficha médica",

      mensaje:
        `${state.user.nombre} modificó la ficha médica de ${nombrePasajero}.`,

      motivo:
        reason,

      cambios,

      metadata: {
        inscripcionId:
          state.editingId,

        documento:
          documentoPasajero,

        nombreCompleto:
          nombrePasajero,

        motivo:
          reason,

        origen:
          "gestion_fichas_medicas",

        cambios
      },

      fecha:
        serverTimestamp(),

      creadoPor:
        state.user.nombre,

      creadoPorCorreo:
        state.user.email
    };

    /*
      =====================================================
      2. HISTORIAL INDIVIDUAL DEL PASAJERO
      =====================================================

      Ruta:

      ventas_cotizaciones/{grupo}
        /inscripciones/{pasajero}
        /historial_ficha/{evento}

      Sirve para revisar exclusivamente
      las modificaciones médicas de esa persona.
    */
    await addDoc(
      collection(
        inscriptionRef,
        "historial_ficha"
      ),
      {
        tipoMovimiento:
          "edicion_ficha_medica",

        titulo:
          "Edición de ficha médica",

        fecha:
          serverTimestamp(),

        usuarioNombre:
          state.user.nombre,

        usuarioCorreo:
          state.user.email,

        motivo:
          reason,

        cambios,

        origen:
          "gestion_fichas_medicas"
      }
    );

    /*
      =====================================================
      3. HISTORIAL MÉDICO DEL GRUPO
      =====================================================

      Ruta:

      ventas_cotizaciones/{grupo}
        /historial_ficha_medica/{evento}

      Este será el que después mostraremos dentro de:

      Gestión Fichas Médicas
      → Historial médico

      Aquí NO aparecerán movimientos administrativos
      como listas de espera o nuevos ingresos.
    */
    await addDoc(
      collection(
        db,
        "ventas_cotizaciones",
        state.groupDocId,
        "historial_ficha_medica"
      ),
      eventoGeneral
    );

    /*
      =====================================================
      4. HISTORIAL GENERAL DEL GRUPO
      =====================================================

      Ruta:

      ventas_historial/{evento}

      grupo.js ya trabaja con esta colección.

      Por lo tanto la modificación médica también
      quedará como parte de la historia general
      del grupo, diferenciada mediante:

      modulo: "ficha_medica"
    */
    await addDoc(
      collection(
        db,
        "ventas_historial"
      ),
      eventoGeneral
    );

    closeModal();

    await loadPage();

    alert(
      "Ficha médica actualizada correctamente."
    );
  } catch (error) {
    console.error(
      "[gestion-fichas-medicas] saveEdit",
      error
    );

    alert(
      `No fue posible guardar: ${
        error.message ||
        "Error desconocido"
      }`
    );
  } finally {
    button.disabled =
      false;

    button.textContent =
      "Guardar cambios";
  }
}

function closeModal() {
  state.editingId = "";
  $("editModal").classList.add("hidden");
}

function showLoading(show) {
  $("loadingBox").classList.toggle("hidden", !show);
}

function showError(message) {
  $("errorBox").textContent = message;
  $("errorBox").classList.remove("hidden");
  $("content").classList.add("hidden");
}
