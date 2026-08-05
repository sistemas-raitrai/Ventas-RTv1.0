import {
  auth,
  db,
  puedeVerGeneral,
  normalizeEmail,
  getVentasUser
} from "./firebase-init.js";

import {
  collection,
  getDocs,
  query,
  where
} from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";

import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/11.7.3/firebase-auth.js";

import {
  ACTING_USER_KEY,
  getRealUser,
  getEffectiveUser
} from "./roles.js";

import {
  bindLayoutButtons,
  waitForLayoutReady
} from "./ui.js";

import {
  crearInscripcionesManager,
  resumirNomina,
  exportarNominaCsv,
  camposPasajero
} from "./inscripciones-manager.js";

const $ = (id) =>
  document.getElementById(id);

const ANO_GESTION = 2026;

const ALERTAS_INSCRIPCIONES_COLLECTION =
  "ventas_alertas_inscripciones";

const state = {
  realUser: null,
  user: null,
  email: "",
  canSeeAll: false,

  rows: [],
  filtered: [],

  manager: null,
  current: null,
  nomina: [],

  alertasInscripciones: [],
  nuevosPendientes: [],
  listaEsperaPendientes: [],
  listaEsperaPagadas: [],

  alertaListadoActual: [],
  alertaTipoActual: "",
  pasajeroFocoId: ""
};

init();

async function init() {
  await waitForLayoutReady();
  bindEvents();

  onAuthStateChanged(
    auth,
    async (user) => {
      if (!user) {
        return;
      }

      await bootstrap();
      bindHeader();
      await cargarPantalla();
    }
  );
}

async function bootstrap() {
  state.realUser =
    getRealUser();

  state.user =
    getEffectiveUser();

  const resolved =
    getVentasUser(
      state.user?.email ||
      state.realUser?.email ||
      auth.currentUser?.email ||
      ""
    );

  if (resolved) {
    state.user = {
      ...state.user,
      ...resolved
    };
  }

  state.email =
    normalizeEmail(
      state.user?.email ||
      auth.currentUser?.email ||
      ""
    );

  state.canSeeAll =
    puedeVerGeneral(
      state.email
    );

  state.manager =
    crearInscripcionesManager({
      db,
      usuario: state.user
    });
}

function bindHeader() {
  bindLayoutButtons({
    homeUrl: "index.html",

    onLogout: async () => {
      sessionStorage.removeItem(
        ACTING_USER_KEY
      );

      await signOut(auth);

      location.href =
        "login.html";
    },

    onActAs: async (selected) => {
      if (
        state.realUser?.rol !== "admin" ||
        !selected
      ) {
        return;
      }

      sessionStorage.setItem(
        ACTING_USER_KEY,
        selected
      );

      await bootstrap();
      await cargarPantalla();
    },

    onResetActAs: async () => {
      sessionStorage.removeItem(
        ACTING_USER_KEY
      );

      await bootstrap();
      await cargarPantalla();
    }
  });
}

function bindEvents() {
  $("gnBuscar")
    ?.addEventListener(
      "input",
      debounce(
        aplicarFiltros,
        150
      )
    );

  $("gnVendedor")
    ?.addEventListener(
      "change",
      aplicarFiltros
    );

  $("gnEstado")
    ?.addEventListener(
      "change",
      aplicarFiltros
    );

  $("gnRecargar")
    ?.addEventListener(
      "click",
      cargarPantalla
    );

  $("modalCerrar")
    ?.addEventListener(
      "click",
      cerrarModal
    );

  $("gnModal")
    ?.addEventListener(
      "click",
      (event) => {
        if (
          event.target ===
          $("gnModal")
        ) {
          cerrarModal();
        }
      }
    );

  $("gnTbody")
    ?.addEventListener(
      "click",
      (event) => {
        const tr =
          event.target.closest(
            "tr[data-id]"
          );

        if (tr) {
          abrirGrupo(
            tr.dataset.id
          );
        }
      }
    );

  $("fasesContenedor")
    ?.addEventListener(
      "click",
      manejarFase
    );

  $("btnExportarCsv")
    ?.addEventListener(
      "click",
      () =>
        exportarNominaCsv(
          state.nomina,
          `nomina_${
            state.current?.groupId ||
            "grupo"
          }.csv`
        )
    );

  $("btnCargadoPagos")
    ?.addEventListener(
      "click",
      () =>
        accionSimple(
          "cargado"
        )
    );

  $("btnArchivar")
    ?.addEventListener(
      "click",
      () =>
        accionSimple(
          "archivar"
        )
    );

  $("btnResetear")
    ?.addEventListener(
      "click",
      () =>
        accionSimple(
          "resetear"
        )
    );

  $("btnAbrirGrupo")
    ?.addEventListener(
      "click",
      () =>
        window.open(
          `grupo.html?id=${encodeURIComponent(
            state.current?.groupId ||
            state.current?.docId ||
            ""
          )}`,
          "_blank",
          "noopener"
        )
    );

  document
    .querySelectorAll(
      "[data-alerta-kpi]"
    )
    .forEach(
      (card) => {
        card.addEventListener(
          "click",
          () => {
            abrirListadoAlertas(
              card.dataset.alertaKpi
            );
          }
        );

        card.addEventListener(
          "keydown",
          (event) => {
            if (
              event.key !== "Enter" &&
              event.key !== " "
            ) {
              return;
            }

            event.preventDefault();

            abrirListadoAlertas(
              card.dataset.alertaKpi
            );
          }
        );
      }
    );

  $("btnCerrarAlertas")
    ?.addEventListener(
      "click",
      cerrarListadoAlertas
    );

  $("modalAlertasInscripciones")
    ?.addEventListener(
      "click",
      (event) => {
        if (
          event.target ===
          $("modalAlertasInscripciones")
        ) {
          cerrarListadoAlertas();
        }
      }
    );

  $("alertasInscripcionesTbody")
    ?.addEventListener(
      "click",
      manejarAccionAlerta
    );

  $("buscadorAlertasInscripciones")
    ?.addEventListener(
      "input",
      renderListadoAlertas
    );

  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Escape") {
        return;
      }

      if (
        $("modalAlertasInscripciones")
          ?.classList.contains("show")
      ) {
        cerrarListadoAlertas();
        return;
      }

      if (
        $("gnModal")
          ?.classList.contains("show")
      ) {
        cerrarModal();
      }
    }
  );
}

async function cargarPantalla() {
  await Promise.all([
    cargarGrupos(),
    cargarAlertasInscripciones()
  ]);
}

async function cargarGrupos() {
  renderMensaje(
    "Cargando grupos 2026..."
  );

  try {
    const snap =
      await getDocs(
        query(
          collection(
            db,
            "ventas_grupos_resumen"
          ),
          where(
            "anoViaje",
            "==",
            ANO_GESTION
          )
        )
      );

    state.rows =
      snap.docs
        .map(
          (documento) =>
            mapRow(
              documento.id,
              documento.data() ||
              {}
            )
        )
        .filter(
          (row) =>
            row.estado ===
            "ganada"
        )
        .filter(
          accesoRow
        );

    llenarVendedores();
    aplicarFiltros();
    clasificarAlertasInscripciones();
  } catch (error) {
    console.error(
      "[gestion-nomina] cargarGrupos",
      error
    );

    renderMensaje(
      "No se pudieron cargar los grupos."
    );
  }
}

async function cargarAlertasInscripciones() {
  try {
    const snap =
      await getDocs(
        query(
          collection(
            db,
            ALERTAS_INSCRIPCIONES_COLLECTION
          ),
          where(
            "activa",
            "==",
            true
          )
        )
      );

    state.alertasInscripciones =
      snap.docs.map(
        (documento) => ({
          id:
            documento.id,

          ...documento.data()
        })
      );

    clasificarAlertasInscripciones();
  } catch (error) {
    console.error(
      "[gestion-nomina] cargarAlertasInscripciones",
      error
    );

    state.alertasInscripciones =
      [];

    clasificarAlertasInscripciones();
  }
}

function clasificarAlertasInscripciones() {
  const idsPermitidos =
    new Set();

  const docIdsPermitidos =
    new Set();

  state.rows.forEach(
    (row) => {
      [
        row.id,
        row.groupId
      ]
        .map(
          (value) =>
            String(
              value ||
              ""
            ).trim()
        )
        .filter(Boolean)
        .forEach(
          (value) =>
            idsPermitidos.add(
              value
            )
        );

      if (row.id) {
        docIdsPermitidos.add(
          String(row.id)
        );
      }
    }
  );

  const alertasScope =
    state.alertasInscripciones
      .filter(
        esAlertaInscripcionActiva
      )
      .filter(
        (item) => {
          const ano =
            Number(
              item.anoViaje ||
              0
            );

          if (
            ano &&
            ano !== ANO_GESTION
          ) {
            return false;
          }

          const idGrupo =
            String(
              item.idGrupo ||
              ""
            ).trim();

          const groupDocId =
            String(
              item.groupDocId ||
              ""
            ).trim();

          return (
            idsPermitidos.has(
              idGrupo
            ) ||
            idsPermitidos.has(
              groupDocId
            ) ||
            docIdsPermitidos.has(
              groupDocId
            )
          );
        }
      );

  state.nuevosPendientes =
    ordenarAlertas(
      alertasScope.filter(
        (item) =>
          item.tipoAlerta ===
          "nuevo_ingreso_pendiente"
      )
    );

  state.listaEsperaPendientes =
    ordenarAlertas(
      alertasScope.filter(
        (item) =>
          item.tipoAlerta ===
          "lista_espera_pendiente"
      )
    );

  state.listaEsperaPagadas =
    ordenarAlertas(
      alertasScope.filter(
        (item) =>
          item.tipoAlerta ===
          "lista_espera_pagada_pendiente_confirmar"
      )
    );

  renderKpisInscripciones();
}

function esAlertaInscripcionActiva(
  item = {}
) {
  const estadoViaje =
    normalizar(
      item.estadoViaje ||
      ""
    ).replace(
      /\s+/g,
      "_"
    );

  return (
    item.activa !== false &&
    item.resuelta !== true &&
    item.anulado !== true &&
    item.viaja !== false &&
    estadoViaje !==
      "no_viaja"
  );
}

function ordenarAlertas(
  rows = []
) {
  return [
    ...rows
  ].sort(
    (a, b) => {
      const grupoA =
        normalizar(
          a.aliasGrupo ||
          a.colegio ||
          ""
        );

      const grupoB =
        normalizar(
          b.aliasGrupo ||
          b.colegio ||
          ""
        );

      const byGrupo =
        grupoA.localeCompare(
          grupoB,
          "es",
          {
            sensitivity:
              "base",
            numeric:
              true
          }
        );

      if (byGrupo !== 0) {
        return byGrupo;
      }

      return (
        fechaMs(
          b.fechaFormulario ||
          b.creadaAt ||
          b.actualizadoAt
        ) -
        fechaMs(
          a.fechaFormulario ||
          a.creadaAt ||
          a.actualizadoAt
        )
      );
    }
  );
}

function renderKpisInscripciones() {
  set(
    "sumNuevosPendientes",
    state.nuevosPendientes.length
  );

  set(
    "sumListaEsperaPendiente",
    state.listaEsperaPendientes.length
  );

  set(
    "sumListaEsperaPagada",
    state.listaEsperaPagadas.length
  );

  actualizarKpiActivo(
    "kpiNuevosPendientes",
    state.nuevosPendientes.length
  );

  actualizarKpiActivo(
    "kpiListaEsperaPendiente",
    state.listaEsperaPendientes.length
  );

  actualizarKpiActivo(
    "kpiListaEsperaPagada",
    state.listaEsperaPagadas.length
  );
}

function actualizarKpiActivo(
  id,
  cantidad
) {
  const card =
    $(id);

  if (!card) {
    return;
  }

  card.classList.toggle(
    "has-items",
    Number(
      cantidad ||
      0
    ) > 0
  );
}

function getListadoPorTipo(
  tipo = ""
) {
  if (
    tipo ===
    "nuevo_ingreso"
  ) {
    return {
      titulo:
        "Nuevos ingresos pendientes",

      subtitulo:
        "Pasajeros pendientes de confirmación.",

      rows:
        state.nuevosPendientes
    };
  }

  if (
    tipo ===
    "lista_espera"
  ) {
    return {
      titulo:
        "Lista de espera pendiente",

      subtitulo:
        "Pasajeros pendientes de pago.",

      rows:
        state.listaEsperaPendientes
    };
  }

  if (
    tipo ===
    "lista_espera_pagada"
  ) {
    return {
      titulo:
        "Lista de espera pagada",

      subtitulo:
        "Pasajeros pagados pendientes de confirmar cupo.",

      rows:
        state.listaEsperaPagadas
    };
  }

  return {
    titulo:
      "Gestión de inscripciones",

    subtitulo:
      "",

    rows:
      []
  };
}

function abrirListadoAlertas(
  tipo = ""
) {
  const data =
    getListadoPorTipo(
      tipo
    );

  state.alertaTipoActual =
    tipo;

  state.alertaListadoActual =
    data.rows;

  set(
    "alertasInscripcionesTitulo",
    data.titulo
  );

  set(
    "alertasInscripcionesSubtitulo",
    data.subtitulo
  );

  const buscador =
    $("buscadorAlertasInscripciones");

  if (buscador) {
    buscador.value =
      "";
  }

  renderListadoAlertas();

  $("modalAlertasInscripciones")
    ?.classList.add(
      "show"
    );

  document.body.classList.add(
    "modal-open"
  );
}

function cerrarListadoAlertas() {
  $("modalAlertasInscripciones")
    ?.classList.remove(
      "show"
    );

  state.alertaListadoActual =
    [];

  state.alertaTipoActual =
    "";

  if (
    !$("gnModal")
      ?.classList.contains(
        "show"
      )
  ) {
    document.body.classList.remove(
      "modal-open"
    );
  }
}

function renderListadoAlertas() {
  const tbody =
    $("alertasInscripcionesTbody");

  if (!tbody) {
    return;
  }

  const q =
    normalizar(
      $("buscadorAlertasInscripciones")
        ?.value ||
      ""
    );

  const rows =
    state.alertaListadoActual.filter(
      (item) =>
        !q ||
        buildSearchAlerta(
          item
        ).includes(
          q
        )
    );

  set(
    "alertasInscripcionesResumen",
    `${rows.length} pasajero(s)`
  );

  if (!rows.length) {
    tbody.innerHTML = `
      <tr>
        <td
          colspan="8"
          class="gn-empty"
        >
          No hay pasajeros para mostrar.
        </td>
      </tr>
    `;

    return;
  }

  tbody.innerHTML =
    rows.map(
      (item) => {
        const idGrupo =
          String(
            item.idGrupo ||
            item.groupDocId ||
            ""
          ).trim();

        const groupDocId =
          String(
            item.groupDocId ||
            item.idGrupo ||
            ""
          ).trim();

        const inscripcionId =
          String(
            item.inscripcionId ||
            item.idInscripcion ||
            item.documentoId ||
            ""
          ).trim();

        return `
          <tr>
            <td>
              <strong>
                ${esc(
                  item.nombreParticipante ||
                  "Sin nombre"
                )}
              </strong>

              <div class="gn-sub">
                ${esc(
                  item.documento ||
                  item.rut ||
                  "Sin documento"
                )}
              </div>
            </td>

            <td>
              ${esc(
                item.aliasGrupo ||
                item.colegio ||
                idGrupo ||
                "Sin grupo"
              )}

              <div class="gn-sub">
                ${esc(
                  [
                    item.curso,
                    item.anoViaje
                  ]
                    .filter(Boolean)
                    .join(" · ")
                )}
              </div>
            </td>

            <td>
              ${esc(
                item.numeroNegocio ||
                "—"
              )}
            </td>

            <td>
              ${esc(
                item.vendedora ||
                item.vendedoraCorreo ||
                "—"
              )}
            </td>

            <td>
              ${esc(
                item.nombreResponsable ||
                "—"
              )}

              <div class="gn-sub">
                ${esc(
                  item.correoResponsable ||
                  ""
                )}
              </div>
            </td>

            <td>
              ${esc(
                item.telefonoResponsable ||
                "—"
              )}
            </td>

            <td>
              ${esc(
                formatFecha(
                  item.fechaFormulario ||
                  item.creadaAt ||
                  item.actualizadoAt
                )
              )}
            </td>

            <td>
              <div class="alert-row-actions">
                <button
                  type="button"
                  class="gn-btn"
                  data-alerta-gestionar="${esc(
                    groupDocId
                  )}"
                  data-inscripcion-id="${esc(
                    inscripcionId
                  )}"
                >
                  Gestionar nómina
                </button>

                <button
                  type="button"
                  class="btn-secondary"
                  data-alerta-abrir-grupo="${esc(
                    idGrupo
                  )}"
                >
                  Abrir grupo
                </button>
              </div>
            </td>
          </tr>
        `;
      }
    ).join("");
}

function manejarAccionAlerta(
  event
) {
  const btnGestionar =
    event.target.closest(
      "[data-alerta-gestionar]"
    );

  if (btnGestionar) {
    const grupoId =
      btnGestionar.dataset
        .alertaGestionar;

    state.pasajeroFocoId =
      btnGestionar.dataset
        .inscripcionId ||
      "";

    cerrarListadoAlertas();

    abrirGrupo(
      grupoId
    );

    return;
  }

  const btnAbrir =
    event.target.closest(
      "[data-alerta-abrir-grupo]"
    );

  if (btnAbrir) {
    const grupoId =
      btnAbrir.dataset
        .alertaAbrirGrupo;

    window.open(
      `grupo.html?id=${encodeURIComponent(
        grupoId
      )}`,
      "_blank",
      "noopener"
    );
  }
}

function buildSearchAlerta(
  item = {}
) {
  return normalizar(
    [
      item.nombreParticipante,
      item.documento,
      item.rut,
      item.aliasGrupo,
      item.colegio,
      item.curso,
      item.anoViaje,
      item.numeroNegocio,
      item.vendedora,
      item.vendedoraCorreo,
      item.nombreResponsable,
      item.correoResponsable,
      item.telefonoResponsable
    ]
      .filter(Boolean)
      .join(" ")
  );
}

function mapRow(
  id,
  data
) {
  const resumen =
    data.nominaResumen ||
    data.nomina ||
    {};

  return {
    id,

    groupId:
      String(
        data.idGrupo ||
        id
      ),

    titulo:
      data.aliasGrupo ||
      [
        data.colegio,
        data.curso
      ]
        .filter(Boolean)
        .join(" ") ||
      `Grupo ${id}`,

    colegio:
      data.colegio ||
      "",

    curso:
      data.curso ||
      "",

    negocio:
      data.numeroNegocio ||
      data.negocioId ||
      "",

    vendedora:
      data.vendedora ||
      data.vendedoraCorreo ||
      "",

    vendedoraCorreo:
      normalizeEmail(
        data.vendedoraCorreo ||
        ""
      ),

    destino:
      data.destinoPrincipal ||
      data.destino ||
      "—",

    estado:
      normalizar(
        data.estado
      ),

    total:
      Number(
        data.totalInscripciones ??
        resumen.total ??
        data.totalPasajeros ??
        0
      ),

    pendientes:
      Number(
        data.fichasMedicasPendientes ??
        resumen.fichasMedicasPendientes ??
        0
      ),

    conCarnet:
      Number(
        data.conCarnet ??
        resumen.conCarnet ??
        0
      ),

    sinCarnet:
      Number(
        data.sinCarnet ??
        resumen.sinCarnet ??
        0
      ),

    linkActivo:
      data.inscripcionHabilitada ===
        true ||
      data.linkActivo ===
        true ||
      data.inscripcionNuevosActivo ===
        true ||
      data.inscripcionListaEsperaActivo ===
        true ||
      data.linkLiberadosActivo ===
        true,

    archivada:
      data.nominaArchivada ===
      true,

    search:
      normalizar(
        [
          id,
          data.idGrupo,
          data.numeroNegocio,
          data.aliasGrupo,
          data.colegio,
          data.curso,
          data.vendedora,
          data.destinoPrincipal
        ].join(" ")
      )
  };
}

function accesoRow(
  row
) {
  if (state.canSeeAll) {
    return true;
  }

  return (
    row.vendedoraCorreo ===
      state.email ||
    normalizar(
      row.vendedora
    ).includes(
      normalizar(
        [
          state.user?.nombre,
          state.user?.apellido
        ]
          .filter(Boolean)
          .join(" ")
      )
    )
  );
}

function llenarVendedores() {
  const select =
    $("gnVendedor");

  if (!select) {
    return;
  }

  const valores =
    [
      ...new Set(
        state.rows
          .map(
            (row) =>
              row.vendedora
          )
          .filter(Boolean)
      )
    ].sort(
      (a, b) =>
        a.localeCompare(
          b,
          "es"
        )
    );

  select.innerHTML =
    '<option value="todos">Todos</option>' +
    valores
      .map(
        (value) =>
          `<option>${esc(
            value
          )}</option>`
      )
      .join("");

  select.disabled =
    !state.canSeeAll;
}

function aplicarFiltros() {
  const q =
    normalizar(
      $("gnBuscar")
        ?.value
    );

  const v =
    $("gnVendedor")
      ?.value ||
    "todos";

  const e =
    $("gnEstado")
      ?.value ||
    "todos";

  state.filtered =
    state.rows
      .filter(
        (row) =>
          (
            !q ||
            row.search.includes(
              q
            )
          ) &&
          (
            v === "todos" ||
            row.vendedora === v
          ) &&
          (
            e === "todos" ||
            (
              e === "pendiente" &&
              row.pendientes > 0
            ) ||
            (
              e === "completa" &&
              row.total > 0 &&
              row.pendientes === 0
            ) ||
            (
              e === "link_activo" &&
              row.linkActivo
            ) ||
            (
              e === "archivada" &&
              row.archivada
            )
          )
      )
      .sort(
        (a, b) =>
          a.titulo.localeCompare(
            b.titulo,
            "es"
          )
      );

  renderRows();
  renderSummary();
}

function renderRows() {
  const tbody =
    $("gnTbody");

  if (
    !state.filtered.length
  ) {
    renderMensaje(
      "No hay grupos para los filtros seleccionados."
    );

    return;
  }

  tbody.innerHTML =
    state.filtered
      .map(
        (row) => `
          <tr
            data-id="${esc(
              row.groupId
            )}"
          >
            <td>
              <div class="gn-group">
                ${esc(
                  row.titulo
                )}
              </div>

              <div class="gn-sub">
                ${esc(
                  [
                    row.colegio,
                    row.curso
                  ]
                    .filter(Boolean)
                    .join(" · ")
                )}
              </div>
            </td>

            <td>
              ${esc(
                row.negocio ||
                "—"
              )}
            </td>

            <td>
              ${esc(
                row.vendedora ||
                "—"
              )}
            </td>

            <td>
              ${esc(
                row.destino
              )}
            </td>

            <td>
              ${row.total ||
              "—"}
            </td>

            <td>
              <span
                class="badge ${
                  row.pendientes > 0
                    ? "warn"
                    : "ok"
                }"
              >
                ${row.pendientes}
              </span>
            </td>

            <td>
              ${row.conCarnet}/${
                row.total ||
                0
              }
            </td>

            <td>
              ${
                row.archivada
                  ? '<span class="badge muted">Archivada</span>'
                  : row.linkActivo
                    ? '<span class="badge ok">Link activo</span>'
                    : row.pendientes > 0
                      ? '<span class="badge warn">Pendiente</span>'
                      : '<span class="badge ok">Completa</span>'
              }
            </td>

            <td>
              <button
                class="gn-btn"
                type="button"
              >
                Gestionar
              </button>
            </td>
          </tr>
        `
      )
      .join("");
}

function renderMensaje(
  mensaje
) {
  const tbody =
    $("gnTbody");

  if (!tbody) {
    return;
  }

  tbody.innerHTML = `
    <tr>
      <td
        colspan="9"
        class="gn-empty"
      >
        ${esc(
          mensaje
        )}
      </td>
    </tr>
  `;
}

function renderSummary() {
  set(
    "sumGrupos",
    state.filtered.length
  );

  set(
    "sumPax",
    sum(
      "total"
    )
  );

  set(
    "sumPendientes",
    sum(
      "pendientes"
    )
  );

  set(
    "sumSinCarnet",
    sum(
      "sinCarnet"
    )
  );

  set(
    "sumLinks",
    state.filtered.filter(
      (row) =>
        row.linkActivo
    ).length
  );

  set(
    "sumArchivadas",
    state.filtered.filter(
      (row) =>
        row.archivada
    ).length
  );
}

function sum(
  key
) {
  return state.filtered.reduce(
    (total, row) =>
      total +
      Number(
        row[key] ||
        0
      ),
    0
  );
}

async function abrirGrupo(
  id
) {
  $("gnModal")
    ?.classList.add(
      "show"
    );

  document.body.classList.add(
    "modal-open"
  );

  $("modalCargando")
    ?.classList.remove(
      "hidden"
    );

  $("modalContenido")
    ?.classList.add(
      "hidden"
    );

  try {
    state.current =
      await state.manager
        .resolverGrupo(
          id
        );

    if (!state.current) {
      throw new Error(
        "Grupo no encontrado."
      );
    }

    const [
      origen,
      nomina
    ] =
      await Promise.all([
        state.manager
          .detectarOrigenNomina(
            state.current
          ),

        state.manager
          .cargarNomina(
            state.current
          )
      ]);

    state.nomina =
      nomina;

    const fases =
      state.manager
        .obtenerEstadoFases(
          state.current,
          origen
        );

    renderModal(
      fases
    );
  } catch (error) {
    console.error(
      "[gestion-nomina] abrirGrupo",
      error
    );

    const cargando =
      $("modalCargando");

    if (cargando) {
      cargando.textContent =
        error.message ||
        "No se pudo cargar la nómina.";
    }
  }
}

function renderModal(
  fases
) {
  const grupo =
    state.current.data;

  const resumen =
    resumirNomina(
      state.nomina
    );

  $("modalTitulo").textContent =
    grupo.aliasGrupo ||
    [
      grupo.colegio,
      grupo.curso
    ]
      .filter(Boolean)
      .join(" ") ||
    `Grupo ${
      state.current.groupId
    }`;

  $("modalSubtitulo").textContent =
    `Año ${
      grupo.anoViaje ||
      ANO_GESTION
    } · Negocio ${
      grupo.numeroNegocio ||
      "—"
    } · ${
      fases.origen ===
      "sistema_pagos"
        ? "Sistema de Pagos"
        : "Inscripción inicial"
    }`;

  [
    [
      "kTotal",
      resumen.total
    ],
    [
      "kActivos",
      resumen.activos
    ],
    [
      "kAnulados",
      resumen.anulados
    ],
    [
      "kCompleta",
      resumen.fichaCompleta
    ],
    [
      "kPendiente",
      resumen.fichaPendiente
    ],
    [
      "kCarnet",
      resumen.conCarnet
    ],
    [
      "kSinCarnet",
      resumen.sinCarnet
    ]
  ].forEach(
    ([id, value]) =>
      set(
        id,
        value
      )
  );

  $("fasesContenedor").innerHTML =
    [
      fases.principal,
      fases.nuevos,
      fases.listaEspera,
      fases.liberados
    ]
      .map(
        renderFase
      )
      .join("");

  renderPasajeros();

  $("btnCargadoPagos").textContent =
    grupo.nominaCargadaPagos
      ? "Quitar cargado a pagos"
      : "Marcar cargado a pagos";

  $("btnArchivar").textContent =
    grupo.nominaArchivada
      ? "Desarchivar nómina"
      : "Archivar nómina";

  $("btnResetear")
    ?.classList.toggle(
      "hidden",
      !state.manager
        .esAdminOSupervision()
    );

  $("modalCargando")
    ?.classList.add(
      "hidden"
    );

  $("modalContenido")
    ?.classList.remove(
      "hidden"
    );

  enfocarPasajeroPendiente();
}

function renderFase(
  fase
) {
  return `
    <div class="gn-fase">
      <h4>
        ${esc(
          fase.label
        )}
      </h4>

      <div class="gn-sub">
        ${
          fase.activo
            ? "Abierta"
            : "Cerrada"
        }
      </div>

      <div class="gn-actions">
        ${
          fase.activo
            ? `
              <button
                class="gn-btn ok"
                data-action="copiar"
                data-fase="${fase.clave}"
                data-link="${esc(
                  fase.link
                )}"
                type="button"
              >
                Copiar link
              </button>

              <button
                class="gn-btn danger"
                data-action="cerrar"
                data-fase="${fase.clave}"
                type="button"
              >
                Cerrar
              </button>
            `
            : `
              <button
                class="gn-btn"
                data-action="abrir"
                data-fase="${fase.clave}"
                type="button"
              >
                Abrir
              </button>
            `
        }
      </div>
    </div>
  `;
}

function renderPasajeros() {
  const campos =
    camposPasajero;

  const tbody =
    $("pasajerosTbody");

  if (!tbody) {
    return;
  }

  if (!state.nomina.length) {
    tbody.innerHTML = `
      <tr>
        <td
          colspan="10"
          class="gn-empty"
        >
          No hay pasajeros.
        </td>
      </tr>
    `;

    return;
  }

  tbody.innerHTML =
    state.nomina.map(
      (item) => {
        const esFoco =
          state.pasajeroFocoId &&
          String(
            item.id ||
            ""
          ) ===
          String(
            state.pasajeroFocoId
          );

        return `
          <tr
            data-inscripcion-row="${esc(
              item.id ||
              ""
            )}"
            class="${
              esFoco
                ? "is-focus"
                : ""
            }"
          >
            <td>
              ${esc(
                campos.documento(
                  item
                ) ||
                "—"
              )}
            </td>

            <td>
              ${esc(
                campos.nombres(
                  item
                ) ||
                "—"
              )}
            </td>

            <td>
              ${esc(
                campos.apellidos(
                  item
                ) ||
                "—"
              )}
            </td>

            <td>
              ${esc(
                campos.tipo(
                  item
                ) ||
                "—"
              )}
            </td>

            <td>
              ${esc(
                campos.estado(
                  item
                ) ||
                "—"
              )}
            </td>

            <td>
              <span
                class="badge ${
                  campos.fichaCompleta(
                    item
                  )
                    ? "ok"
                    : "warn"
                }"
              >
                ${
                  campos.fichaCompleta(
                    item
                  )
                    ? "Completa"
                    : "Pendiente"
                }
              </span>
            </td>

            <td>
              ${
                campos.estaAnulada(
                  item
                )
                  ? "Sí"
                  : "No"
              }
            </td>

            <td>
              ${esc(
                campos.correo(
                  item
                ) ||
                "—"
              )}
            </td>

            <td>
              ${esc(
                campos.telefono(
                  item
                ) ||
                "—"
              )}
            </td>

            <td>
              ${
                campos.tieneCarnet(
                  item
                )
                  ? "Sí"
                  : "No"
              }
            </td>
          </tr>
        `;
      }
    ).join("");
}

function enfocarPasajeroPendiente() {
  if (
    !state.pasajeroFocoId
  ) {
    return;
  }

  window.setTimeout(
    () => {
      const fila =
        document.querySelector(
          `[data-inscripcion-row="${cssEscape(
            state.pasajeroFocoId
          )}"]`
        );

      if (fila) {
        fila.scrollIntoView({
          behavior:
            "smooth",
          block:
            "center"
        });
      }

      state.pasajeroFocoId =
        "";
    },
    180
  );
}

async function manejarFase(
  event
) {
  const button =
    event.target.closest(
      "button[data-action]"
    );

  if (!button) {
    return;
  }

  try {
    button.disabled =
      true;

    if (
      button.dataset.action ===
      "copiar"
    ) {
      const link =
        button.dataset.link;

      if (!link) {
        throw new Error(
          "La fase no tiene link guardado."
        );
      }

      await navigator.clipboard
        .writeText(
          link
        );

      alert(
        "Link copiado."
      );

      return;
    }

    if (
      button.dataset.action ===
      "abrir"
    ) {
      let polera =
        null;

      if (
        [
          "inscripcion_inicial",
          "nomina_final"
        ].includes(
          button.dataset.fase
        )
      ) {
        polera =
          confirm(
            "¿Este grupo incluye polera?\nAceptar = Sí / Cancelar = No"
          );
      }

      await state.manager
        .abrirFase(
          state.current,
          button.dataset.fase,
          {
            tienePolera:
              polera
          }
        );
    } else if (
      button.dataset.action ===
      "cerrar"
    ) {
      if (
        !confirm(
          "¿Cerrar este link?"
        )
      ) {
        return;
      }

      await state.manager
        .cerrarFase(
          state.current,
          button.dataset.fase
        );
    }

    await refrescarModal();
  } catch (error) {
    alert(
      error.message ||
      "No se pudo completar la acción."
    );
  } finally {
    button.disabled =
      false;
  }
}

async function accionSimple(
  tipo
) {
  try {
    if (
      tipo ===
      "cargado"
    ) {
      await state.manager
        .marcarCargadoPagos(
          state.current,
          state.current.data
            .nominaCargadaPagos !==
            true
        );
    }

    if (
      tipo ===
      "archivar"
    ) {
      await state.manager
        .archivarNomina(
          state.current,
          state.current.data
            .nominaArchivada !==
            true
        );
    }

    if (
      tipo ===
      "resetear"
    ) {
      if (
        !confirm(
          "Esto cerrará y limpiará todos los links del ciclo. ¿Continuar?"
        )
      ) {
        return;
      }

      await state.manager
        .resetearCiclo(
          state.current
        );
    }

    await refrescarModal();
    await cargarPantalla();
  } catch (error) {
    alert(
      error.message ||
      "No se pudo completar la acción."
    );
  }
}

async function refrescarModal() {
  state.current =
    await state.manager
      .recargarGrupo(
        state.current
      );

  const origen =
    await state.manager
      .detectarOrigenNomina(
        state.current
      );

  state.nomina =
    await state.manager
      .cargarNomina(
        state.current
      );

  renderModal(
    state.manager
      .obtenerEstadoFases(
        state.current,
        origen
      )
  );
}

function cerrarModal() {
  $("gnModal")
    ?.classList.remove(
      "show"
    );

  state.current =
    null;

  state.nomina =
    [];

  state.pasajeroFocoId =
    "";

  if (
    !$("modalAlertasInscripciones")
      ?.classList.contains(
        "show"
      )
  ) {
    document.body.classList.remove(
      "modal-open"
    );
  }
}

function fechaMs(
  value
) {
  if (!value) {
    return 0;
  }

  if (
    typeof value?.toDate ===
    "function"
  ) {
    return value
      .toDate()
      .getTime();
  }

  if (
    typeof value === "object" &&
    typeof value.seconds ===
      "number"
  ) {
    return value.seconds *
      1000;
  }

  const date =
    new Date(
      value
    );

  return Number.isNaN(
    date.getTime()
  )
    ? 0
    : date.getTime();
}

function formatFecha(
  value
) {
  const ms =
    fechaMs(
      value
    );

  if (!ms) {
    return "—";
  }

  return new Date(
    ms
  ).toLocaleString(
    "es-CL",
    {
      day:
        "2-digit",
      month:
        "2-digit",
      year:
        "numeric",
      hour:
        "2-digit",
      minute:
        "2-digit",
      hour12:
        false
    }
  );
}

function set(
  id,
  value
) {
  const element =
    $(id);

  if (element) {
    element.textContent =
      String(
        value ??
        ""
      );
  }
}

function esc(
  value
) {
  return String(
    value ??
    ""
  )
    .replaceAll(
      "&",
      "&amp;"
    )
    .replaceAll(
      "<",
      "&lt;"
    )
    .replaceAll(
      ">",
      "&gt;"
    )
    .replaceAll(
      '"',
      "&quot;"
    )
    .replaceAll(
      "'",
      "&#39;"
    );
}

function normalizar(
  value
) {
  return String(
    value ??
    ""
  )
    .normalize(
      "NFD"
    )
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .toLowerCase()
    .trim();
}

function debounce(
  fn,
  wait
) {
  let timeout;

  return (
    ...args
  ) => {
    clearTimeout(
      timeout
    );

    timeout =
      setTimeout(
        () =>
          fn(
            ...args
          ),
        wait
      );
  };
}

function cssEscape(
  value
) {
  if (
    window.CSS &&
    typeof window.CSS.escape ===
      "function"
  ) {
    return window.CSS.escape(
      String(
        value ||
        ""
      )
    );
  }

  return String(
    value ||
    ""
  ).replace(
    /["\\]/g,
    "\\$&"
  );
}
