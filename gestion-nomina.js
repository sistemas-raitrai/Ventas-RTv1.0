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

import {
  crearInscripcionViewer
} from "./inscripcion-viewer.js";

const $ = (id) =>
  document.getElementById(id);

const ANO_ACTUAL =
  new Date()
    .getFullYear();

const ANO_MINIMO_GESTION =
  ANO_ACTUAL - 1;

const ANO_MAXIMO_GESTION =
  ANO_ACTUAL + 2;

const ALERTAS_INSCRIPCIONES_COLLECTION =
  "ventas_alertas_inscripciones";

const state = {
  realUser: null,
  user: null,
  email: "",
  canSeeAll: false,

  anoSeleccionado:
    ANO_ACTUAL,

  rows: [],
  filtered: [],

  manager: null,
  viewer: null,
  current: null,
  nomina: [],

  alertasInscripciones: [],
  nuevosPendientes: [],
  listaEsperaPendientes: [],
  listaEsperaPagadas: [],

  alertaListadoActual: [],
  alertaTipoActual: "",
  pasajeroFocoId: "",

  // Filtro aplicado dentro del modal de nómina.
  nominaFiltro: "todos",

  /*
    Pasajero actualmente abierto
    en el editor administrativo.
  */
  editingNominaId: ""
};

init();

async function init() {
  await waitForLayoutReady();

  configurarSelectorAnos();
  actualizarTituloAno();
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

function configurarSelectorAnos() {
  const select =
    $("gnAno");

  if (!select) {
    return;
  }

  const anos =
    [];

  for (
    let ano = ANO_MAXIMO_GESTION;
    ano >= ANO_MINIMO_GESTION;
    ano -= 1
  ) {
    anos.push(
      ano
    );
  }

  select.innerHTML =
    anos
      .map(
        (ano) => `
          <option
            value="${ano}"
            ${
              ano ===
              state.anoSeleccionado
                ? "selected"
                : ""
            }
          >
            ${ano}
          </option>
        `
      )
      .join("");

  select.value =
    String(
      state.anoSeleccionado
    );
}

function actualizarTituloAno() {
  const ano =
    Number(
      state.anoSeleccionado ||
      ANO_ACTUAL
    );

  const titulo =
    $("tituloAnoGestion");

  if (titulo) {
    titulo.textContent =
      String(
        ano
      );
  }

  document.title =
    `Gestión de Nómina ${ano} | Sistema Ventas RT`;
}

async function cambiarAnoGestion() {
  const select =
    $("gnAno");

  const nuevoAno =
    Number(
      select?.value ||
      ANO_ACTUAL
    );

  if (
    !Number.isInteger(
      nuevoAno
    ) ||
    nuevoAno < 2000
  ) {
    return;
  }

  if (
    nuevoAno ===
    state.anoSeleccionado
  ) {
    return;
  }

  state.anoSeleccionado =
    nuevoAno;

  state.rows =
    [];

  state.filtered =
    [];

  state.alertasInscripciones =
    [];

  state.nuevosPendientes =
    [];

  state.listaEsperaPendientes =
    [];

  state.listaEsperaPagadas =
    [];

  const buscador =
    $("gnBuscar");

  if (buscador) {
    buscador.value =
      "";
  }

  const estado =
    $("gnEstado");

  if (estado) {
    estado.value =
      "todos";
  }

  actualizarTituloAno();

  renderMensaje(
    `Cargando grupos ${nuevoAno}...`
  );

  renderKpisInscripciones();

  await cargarPantalla();
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

  state.viewer =
    crearInscripcionViewer({
      manager:
        state.manager,

      getGrupoCtx:
        () =>
          state.current,

      getGrupoData:
        () =>
          state.current?.data ||
          {}
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

  $("gnAno")
    ?.addEventListener(
      "change",
      cambiarAnoGestion
    );

  $("gnEstado")
    ?.addEventListener(
      "change",
      aplicarFiltros
    );

  $("summaryGestionNomina")
    ?.addEventListener(
      "click",
      (event) => {
        const card =
          event.target.closest(
            "[data-summary-filter]"
          );
  
        if (!card) {
          return;
        }
  
        filtrarDesdeKpiResumen(
          card.dataset
            .summaryFilter ||
          "todos"
        );
      }
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
      abrirGrupoCompleto
    );
  
  $("btnGestionarFichasMedicas")
    ?.addEventListener(
      "click",
      abrirGestionFichasMedicas
    );
  
  $("btnVerFichasGrupo")
    ?.addEventListener(
      "click",
      abrirFichasMedicasGrupo
    );
  
  $("btnGestionarPulseras")
    ?.addEventListener(
      "click",
      abrirGestionPulseras
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
              card.dataset
                .alertaKpi
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
              card.dataset
                .alertaKpi
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

  $("pasajerosTbody")
    ?.addEventListener(
      "click",
      manejarAccionPasajero
    );

  $("modalKpisNomina")
    ?.addEventListener(
      "click",
      (event) => {
        const card =
          event.target.closest(
            "[data-nomina-filtro]"
          );

        if (!card) {
          return;
        }

        state.nominaFiltro =
          card.dataset
            .nominaFiltro ||
          "todos";

        renderKpisModal();
        renderPasajeros();
      }
    );

  $("btnMostrarTodaNomina")
    ?.addEventListener(
      "click",
      () => {
        state.nominaFiltro =
          "todos";

        renderKpisModal();
        renderPasajeros();
      }
    );

  document.addEventListener(
    "keydown",
    (event) => {
      if (
        event.key !==
        "Escape"
      ) {
        return;
      }

      if (
        $("modalAlertasInscripciones")
          ?.classList.contains(
            "show"
          )
      ) {
        cerrarListadoAlertas();
        return;
      }

      if (
        $("gnModal")
          ?.classList.contains(
            "show"
          )
      ) {
        cerrarModal();
      }
    }
  );
}

async function cargarPantalla() {
  actualizarTituloAno();

  renderMensaje(
    `Cargando grupos ${state.anoSeleccionado}...`
  );

  await Promise.all([
    cargarGrupos(),
    cargarAlertasInscripciones()
  ]);
}

async function cargarGrupos() {
  renderMensaje(
    `Cargando grupos ${state.anoSeleccionado}...`
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
            Number(
              state.anoSeleccionado
            )
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
      `No se pudieron cargar los grupos ${state.anoSeleccionado}.`
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
          String(
            row.id
          )
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
            ano !==
              Number(
                state.anoSeleccionado
              )
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
  const totalViajan =
    Number(
      data.totalViajan ??
      data.totalRegistros ??
      0
    );

  const fichaCompleta =
    Number(
      data.totalFichaMedicaCompleta ??
      0
    );

  const fichaPendiente =
    Number(
      data.totalFichaMedicaPendiente ??
      0
    );

  const conCarnetRaw =
    data.conCarnet ??
    data.totalConCarnet ??
    null;

  const sinCarnetRaw =
    data.sinCarnet ??
    data.totalSinCarnet ??
    null;

  const tieneResumenCarnet =
    conCarnetRaw !== null ||
    sinCarnetRaw !== null;

  return {
    id:
      String(
        id ||
        ""
      ),

    docId:
      String(
        data.groupDocId ||
        id ||
        ""
      ),

    groupId:
      String(
        data.idGrupo ||
        id ||
        ""
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
      String(
        data.numeroNegocio ||
        data.negocioId ||
        ""
      ),

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
        data.estado ||
        data.estadoComercial ||
        ""
      ),

    total:
      totalViajan,

    totalRegistros:
      Number(
        data.totalRegistros ??
        0
      ),

    fichaCompleta,

    pendientes:
      fichaPendiente,

    conCarnet:
      tieneResumenCarnet
        ? Number(
            conCarnetRaw ||
            0
          )
        : null,

    sinCarnet:
      tieneResumenCarnet
        ? Number(
            sinCarnetRaw ||
            0
          )
        : null,

    tieneResumenCarnet,

    origenNomina:
      String(
        data.origenNomina ||
        data.tipoNomina ||
        ""
      ),

    faseNominaActual:
      String(
        data.faseNominaActual ||
        ""
      ),

    estadoNominaGeneral:
      String(
        data.estadoNominaGeneral ||
        ""
      ),

    estadoNominaDetalle:
      String(
        data.estadoNominaDetalle ||
        ""
      ),

    inscripcionHabilitada:
      data.inscripcionHabilitada ===
      true,

    tieneNominaInicial:
      data.tieneNominaInicial ===
      true,

    tieneNominaSistemaPagos:
      data.tieneNominaSistemaPagos ===
      true,

    nuevosPendientes:
      Number(
        data.totalNuevosIngresosPendientes ??
        0
      ),

    nuevosConfirmados:
      Number(
        data.totalNuevosIngresosConfirmados ??
        0
      ),

    listaEsperaPendiente:
      Number(
        data.totalListaEsperaPendiente ??
        0
      ),

    listaEsperaPagada:
      Number(
        data.totalListaEsperaPagada ??
        0
      ),

    listaEsperaConfirmada:
      Number(
        data.totalListaEsperaConfirmada ??
        0
      ),

    liberados:
      Number(
        data.totalLiberados ??
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
          data.groupDocId,
          data.idGrupo,
          data.numeroNegocio,
          data.aliasGrupo,
          data.colegio,
          data.curso,
          data.vendedora,
          data.destinoPrincipal,
          data.destino,
          data.faseNominaActual,
          data.origenNomina
        ]
          .filter(Boolean)
          .join(" ")
      )
  };
}

function getFaseNominaLabel(
  fase = ""
) {
  const key =
    normalizar(
      fase
    )
      .replace(
        /\s+/g,
        "_"
      );

  const labels = {
    inscripcion_inicial:
      "Inscripción inicial",

    nomina_inicial:
      "Inscripción inicial",

    nomina_final:
      "Nómina final / ficha médica",

    nuevo_ingreso:
      "Nuevo ingreso",

    nuevos:
      "Nuevo ingreso",

    lista_espera:
      "Lista de espera",

    liberado:
      "Cupos liberados",

    cupos_liberados:
      "Cupos liberados",

    cerrada:
      "Sin link abierto"
  };

  return (
    labels[key] ||
    String(
      fase ||
      ""
    )
      .replaceAll(
        "_",
        " "
      ) ||
    "Sin fase"
  );
}

function getFaseGrupoHtml(
  row = {}
) {
  const fase =
    getFaseNominaLabel(
      row.faseNominaActual
    );

  const estado =
    normalizar(
      row.estadoNominaGeneral ||
      ""
    );

  const abierta =
    estado === "abierta" ||
    row.inscripcionHabilitada ===
      true ||
    row.linkActivo ===
      true;

  if (abierta) {
    return `
      <span class="badge ok">
        ${esc(fase)}
      </span>
      <div class="gn-sub">
        Link abierto
      </div>
    `;
  }

  return `
    <span class="badge muted">
      ${esc(fase)}
    </span>
    <div class="gn-sub">
      Cerrado
    </div>
  `;
}

function getFichaResumenHtml(
  row = {}
) {
  const completas =
    Number(
      row.fichaCompleta ||
      0
    );

  const pendientes =
    Number(
      row.pendientes ||
      0
    );

  const total =
    completas +
    pendientes;

  if (!total) {
    return `
      <span class="badge muted">
        0
      </span>
    `;
  }

  if (!pendientes) {
    return `
      <span class="badge ok">
        ${completas}/${total}
      </span>
      <div class="gn-sub">
        Completas
      </div>
    `;
  }

  return `
    <span class="badge warn">
      ${completas}/${total}
    </span>
    <div class="gn-sub">
      ${pendientes} pendiente${
        pendientes === 1
          ? ""
          : "s"
      }
    </div>
  `;
}

function getCarnetResumenHtml(
  row = {}
) {
  if (
    row.tieneResumenCarnet !==
    true
  ) {
    return `
      <span class="badge muted">
        —
      </span>
      <div class="gn-sub">
        Resumen pendiente
      </div>
    `;
  }

  const conCarnet =
    Number(
      row.conCarnet ||
      0
    );

  const sinCarnet =
    Number(
      row.sinCarnet ||
      0
    );

  const total =
    conCarnet +
    sinCarnet;

  return `
    <strong>
      ${conCarnet}/${total}
    </strong>
    ${
      sinCarnet
        ? `
          <div class="gn-sub">
            ${sinCarnet} sin carnet
          </div>
        `
        : ""
    }
  `;
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
        ?.value ||
      ""
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
        (row) => {
          const coincideBusqueda =
            !q ||
            row.search.includes(
              q
            );

          const coincideVendedor =
            v === "todos" ||
            row.vendedora === v;

          let coincideEstado =
            true;

          if (
            e ===
            "pendiente"
          ) {
            coincideEstado =
              row.pendientes > 0;
          }

          if (
            e ===
            "sin_carnet"
          ) {
            coincideEstado =
              row.sinCarnet > 0;
          }

          if (
            e ===
            "completa"
          ) {
            coincideEstado =
              row.total > 0 &&
              row.pendientes === 0;
          }

          if (
            e ===
            "link_activo"
          ) {
            coincideEstado =
              row.linkActivo ===
              true;
          }

          if (
            e ===
            "archivada"
          ) {
            coincideEstado =
              row.archivada ===
              true;
          }

          return (
            coincideBusqueda &&
            coincideVendedor &&
            coincideEstado
          );
        }
      )
      .sort(
        (a, b) =>
          a.titulo.localeCompare(
            b.titulo,
            "es",
            {
              sensitivity:
                "base",
              numeric:
                true
            }
          )
      );

  actualizarKpiResumenActivo(
    e
  );

  renderRows();
  renderSummary();
}

function actualizarKpiResumenActivo(
  filtro = "todos"
) {
  document
    .querySelectorAll(
      "[data-summary-filter]"
    )
    .forEach(
      (card) => {
        card.classList.toggle(
          "active",
          card.dataset
            .summaryFilter ===
            filtro
        );
      }
    );
}

function filtrarDesdeKpiResumen(
  filtro = "todos"
) {
  const selectEstado =
    $("gnEstado");

  if (!selectEstado) {
    return;
  }

  const filtrosValidos =
    new Set([
      "todos",
      "pendiente",
      "sin_carnet",
      "link_activo",
      "archivada"
    ]);

  const filtroSeguro =
    filtrosValidos.has(
      filtro
    )
      ? filtro
      : "todos";

  selectEstado.value =
    filtroSeguro;

  aplicarFiltros();

  window.setTimeout(
    () => {
      $("tablaGruposGestion")
        ?.scrollIntoView({
          behavior:
            "smooth",
          block:
            "start"
        });
    },
    80
  );
}

function renderRows() {
  const tbody =
    $("gnTbody");

  if (!tbody) {
    return;
  }

  if (
    !state.filtered.length
  ) {
    tbody.innerHTML = `
      <tr>
        <td
          colspan="10"
          class="gn-empty"
        >
          No hay grupos para mostrar.
        </td>
      </tr>
    `;

    return;
  }

  tbody.innerHTML =
    state.filtered
      .map(
        (row) => `
          <tr
            data-id="${esc(
              row.id
            )}"
          >
            <td>
              <div class="gn-group">
                ${esc(
                  row.titulo ||
                  "—"
                )}
              </div>

              <div class="gn-sub">
                ${
                  [
                    row.colegio,
                    row.curso
                  ]
                    .filter(Boolean)
                    .map(
                      escapeHtml
                    )
                    .join(" · ")
                }
              </div>
            </td>

            <td>
              <strong>
                ${esc(
                  row.groupId ||
                  row.docId ||
                  "—"
                )}
              </strong>
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
                row.destino ||
                "—"
              )}
            </td>

            <td>
              <strong>
                ${Number(
                  row.total ||
                  0
                )}
              </strong>
            </td>

            <td>
              ${getFichaResumenHtml(
                row
              )}
            </td>

            <td>
              ${getCarnetResumenHtml(
                row
              )}
            </td>

            <td>
              ${getFaseGrupoHtml(
                row
              )}
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
        colspan="10"
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
  /*
    Los KPI superiores representan el universo
    del año y vendedor seleccionados.

    El filtro de estado no debe alterar sus cifras,
    porque las tarjetas sirven para cambiar de filtro.
  */
  const vendedorSeleccionado =
    $("gnVendedor")
      ?.value ||
    "todos";

  const q =
    normalizar(
      $("gnBuscar")
        ?.value ||
      ""
    );

  const baseResumen =
    state.rows.filter(
      (row) => {
        const coincideBusqueda =
          !q ||
          row.search.includes(
            q
          );

        const coincideVendedor =
          vendedorSeleccionado ===
            "todos" ||
          row.vendedora ===
            vendedorSeleccionado;

        return (
          coincideBusqueda &&
          coincideVendedor
        );
      }
    );

  const sumar =
    (key) =>
      baseResumen.reduce(
        (total, row) =>
          total +
          Number(
            row[key] ||
            0
          ),
        0
      );

  set(
    "sumGrupos",
    baseResumen.length
  );

  set(
    "sumPax",
    sumar(
      "total"
    )
  );

  set(
    "sumPendientes",
    sumar(
      "pendientes"
    )
  );

  set(
    "sumSinCarnet",
    sumar(
      "sinCarnet"
    )
  );

  set(
    "sumLinks",
    baseResumen.filter(
      (row) =>
        row.linkActivo ===
        true
    ).length
  );

  set(
    "sumArchivadas",
    baseResumen.filter(
      (row) =>
        row.archivada ===
        true
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
      state.anoSeleccionado
    } · Negocio ${
      grupo.numeroNegocio ||
      "—"
    } · ${
      fases.origen ===
      "sistema_pagos"
        ? "Sistema de Pagos"
        : "Inscripción inicial"
    }`;

  /*
    Al abrir un grupo mostramos la nómina completa.
    Después el usuario puede filtrar presionando un KPI.
  */
  state.nominaFiltro =
    "todos";

  renderKpisModal();

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

function getTipoRealNomina(
  item = {}
) {
  const raw =
    item.tipoInscripcion ||
    item.estadoInscripcion ||
    item.faseInscripcion ||
    "";

  const key =
    normalizar(raw)
      .replace(
        /\s+/g,
        "_"
      );

  if (
    key ===
    "inscripcion_inicial"
  ) {
    return "nomina_inicial";
  }

  if (
    key ===
    "nomina_final_ficha_medica"
  ) {
    return "nomina_final";
  }

  if (
    key ===
    "sistema_de_pagos"
  ) {
    return "sistema_pagos";
  }

  if (
    key ===
    "cupo_liberado"
  ) {
    return "liberado";
  }

  return key ||
    "nomina_inicial";
}

function getEstadoCupoNomina(
  item = {}
) {
  return normalizar(
    item.estadoCupo ||
    ""
  )
    .replace(
      /\s+/g,
      "_"
    );
}

function estaAnuladoNomina(
  item = {}
) {
  return camposPasajero
    .estaAnulada(
      item
    );
}

function fichaCompletaNomina(
  item = {}
) {
  return camposPasajero
    .fichaCompleta(
      item
    );
}

function getCategoriaOperativa(
  item = {}
) {
  if (
    estaAnuladoNomina(
      item
    )
  ) {
    return "anulado";
  }

  const tipo =
    getTipoRealNomina(
      item
    );

  const estadoCupo =
    getEstadoCupoNomina(
      item
    );

  if (
    tipo ===
      "lista_espera_confirmada" ||
    (
      tipo ===
        "lista_espera" &&
      estadoCupo ===
        "confirmado"
    )
  ) {
    return "lista_confirmada";
  }

  if (
    tipo ===
      "nuevo_ingreso_confirmado" ||
    (
      tipo ===
        "nuevo_ingreso" &&
      estadoCupo ===
        "confirmado"
    )
  ) {
    return "nuevo_confirmado";
  }

  if (
    tipo ===
    "liberado"
  ) {
    return "liberado";
  }

  if (
    tipo ===
    "sistema_pagos"
  ) {
    return fichaCompletaNomina(
      item
    )
      ? "sistema_completo"
      : "sistema_pendiente";
  }

  if (
    tipo ===
      "nomina_inicial" ||
    tipo ===
      "nomina_final"
  ) {
    return fichaCompletaNomina(
      item
    )
      ? "nomina_base_completa"
      : "nomina_base_pendiente";
  }

  if (
    tipo ===
    "nuevo_ingreso"
  ) {
    return "nuevo_pendiente";
  }

  if (
    tipo ===
      "lista_espera_pagada" ||
    (
      tipo ===
        "lista_espera" &&
      estadoCupo ===
        "pagado"
    )
  ) {
    return "lista_pagada";
  }

  if (
    tipo ===
    "lista_espera"
  ) {
    return "lista_pendiente";
  }

  return "otro";
}

const ORDEN_CATEGORIAS_NOMINA = {
  lista_confirmada:
    1,

  nuevo_confirmado:
    2,

  liberado:
    3,

  nomina_base_completa:
    4,

  nomina_base_pendiente:
    5,

  sistema_completo:
    6,

  sistema_pendiente:
    7,

  nuevo_pendiente:
    8,

  lista_pagada:
    9,

  lista_pendiente:
    10,

  otro:
    90,

  anulado:
    1000
};

function getOrdenNomina(
  item = {}
) {
  return (
    ORDEN_CATEGORIAS_NOMINA[
      getCategoriaOperativa(
        item
      )
    ] ||
    90
  );
}

function ordenarNominaGestion(
  items = []
) {
  return [
    ...items
  ].sort(
    (a, b) => {
      const orden =
        getOrdenNomina(a) -
        getOrdenNomina(b);

      if (orden !== 0) {
        return orden;
      }

      const apellidoA =
        normalizar(
          camposPasajero.apellidos(
            a
          )
        );

      const apellidoB =
        normalizar(
          camposPasajero.apellidos(
            b
          )
        );

      const byApellido =
        apellidoA.localeCompare(
          apellidoB,
          "es",
          {
            sensitivity:
              "base",
            numeric:
              true
          }
        );

      if (byApellido !== 0) {
        return byApellido;
      }

      return normalizar(
        camposPasajero.nombres(
          a
        )
      ).localeCompare(
        normalizar(
          camposPasajero.nombres(
            b
          )
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

function esViajaConfirmado(
  item = {}
) {
  return [
    "lista_confirmada",
    "nuevo_confirmado",
    "liberado",
    "nomina_base_completa",
    "nomina_base_pendiente",
    "sistema_completo",
    "sistema_pendiente"
  ].includes(
    getCategoriaOperativa(
      item
    )
  );
}

function requiereGestion(
  item = {}
) {
  return [
    "nuevo_pendiente",
    "lista_pagada",
    "lista_pendiente"
  ].includes(
    getCategoriaOperativa(
      item
    )
  );
}

function getResumenOperativoNomina() {
  const items =
    state.nomina;

  const activos =
    items.filter(
      (item) =>
        !estaAnuladoNomina(
          item
        )
    );

  const countCategoria =
    (categoria) =>
      items.filter(
        (item) =>
          getCategoriaOperativa(
            item
          ) ===
          categoria
      ).length;

  return {
    total:
      items.length,

    viajan:
      items.filter(
        esViajaConfirmado
      ).length,

    gestion:
      items.filter(
        requiereGestion
      ).length,

    anulados:
      countCategoria(
        "anulado"
      ),

    fichaPendiente:
      activos.filter(
        (item) =>
          !fichaCompletaNomina(
            item
          )
      ).length,

    sinCarnet:
      activos.filter(
        (item) =>
          !camposPasajero
            .tieneCarnet(
              item
            )
      ).length,

    listaConfirmada:
      countCategoria(
        "lista_confirmada"
      ),

    nuevoConfirmado:
      countCategoria(
        "nuevo_confirmado"
      ),

    liberados:
      countCategoria(
        "liberado"
      ),

    sistemaCompleto:
      countCategoria(
        "sistema_completo"
      ),

    sistemaPendiente:
      countCategoria(
        "sistema_pendiente"
      ),

    nuevoPendiente:
      countCategoria(
        "nuevo_pendiente"
      ),

    listaPagada:
      countCategoria(
        "lista_pagada"
      ),

    listaPendiente:
      countCategoria(
        "lista_pendiente"
      )
  };
}

function renderKpisModal() {
  const resumen =
    getResumenOperativoNomina();

  const valores = {
    kTotal:
      resumen.total,

    kViajan:
      resumen.viajan,

    kGestion:
      resumen.gestion,

    kAnulados:
      resumen.anulados,

    kFichaPendiente:
      resumen.fichaPendiente,

    kSinCarnet:
      resumen.sinCarnet,

    kListaConfirmada:
      resumen.listaConfirmada,

    kNuevoConfirmado:
      resumen.nuevoConfirmado,

    kLiberados:
      resumen.liberados,

    kSistemaCompleto:
      resumen.sistemaCompleto,

    kSistemaPendiente:
      resumen.sistemaPendiente,

    kNuevoPendiente:
      resumen.nuevoPendiente,

    kListaPagada:
      resumen.listaPagada,

    kListaPendiente:
      resumen.listaPendiente
  };

  Object.entries(
    valores
  ).forEach(
    ([id, value]) =>
      set(
        id,
        value
      )
  );

  document
    .querySelectorAll(
      "#modalKpisNomina [data-nomina-filtro]"
    )
    .forEach(
      (card) => {
        card.classList.toggle(
          "active",
          card.dataset.nominaFiltro ===
            state.nominaFiltro
        );
      }
    );

  const filtroLabel =
    getFiltroNominaLabel(
      state.nominaFiltro
    );

  set(
    "nominaFiltroActual",
    filtroLabel
  );

  $("btnMostrarTodaNomina")
    ?.classList.toggle(
      "hidden",
      state.nominaFiltro ===
        "todos"
    );
}

function getFiltroNominaLabel(
  filtro = "todos"
) {
  const labels = {
    todos:
      "Mostrando toda la nómina",

    viajan:
      "Mostrando pasajeros que viajan",

    gestion:
      "Mostrando pendientes de gestión",

    anulados:
      "Mostrando anulados / no viajan",

    ficha_pendiente:
      "Mostrando fichas médicas pendientes",

    sin_carnet:
      "Mostrando pasajeros sin carnet",

    lista_confirmada:
      "Mostrando lista de espera confirmada",

    nuevo_confirmado:
      "Mostrando nuevos ingresos confirmados",

    liberado:
      "Mostrando cupos liberados",

    sistema_completo:
      "Mostrando Sistema de Pagos con ficha completa",

    sistema_pendiente:
      "Mostrando Sistema de Pagos con ficha pendiente",

    nuevo_pendiente:
      "Mostrando nuevos ingresos pendientes",

    lista_pagada:
      "Mostrando lista de espera pagada",

    lista_pendiente:
      "Mostrando lista de espera pendiente"
  };

  return labels[filtro] ||
    labels.todos;
}

function filtrarNominaModal(
  items = []
) {
  const filtro =
    state.nominaFiltro ||
    "todos";

  if (
    filtro ===
    "todos"
  ) {
    return items;
  }

  if (
    filtro ===
    "viajan"
  ) {
    return items.filter(
      esViajaConfirmado
    );
  }

  if (
    filtro ===
    "gestion"
  ) {
    return items.filter(
      requiereGestion
    );
  }

  if (
    filtro ===
    "anulados"
  ) {
    return items.filter(
      estaAnuladoNomina
    );
  }

  if (
    filtro ===
    "ficha_pendiente"
  ) {
    return items.filter(
      (item) =>
        !estaAnuladoNomina(
          item
        ) &&
        !fichaCompletaNomina(
          item
        )
    );
  }

  if (
    filtro ===
    "sin_carnet"
  ) {
    return items.filter(
      (item) =>
        !estaAnuladoNomina(
          item
        ) &&
        !camposPasajero
          .tieneCarnet(
            item
          )
    );
  }

  return items.filter(
    (item) =>
      getCategoriaOperativa(
        item
      ) ===
      filtro
  );
}

function getSeccionNomina(
  item = {}
) {
  if (
    estaAnuladoNomina(
      item
    )
  ) {
    return "anulados";
  }

  if (
    requiereGestion(
      item
    )
  ) {
    return "gestion";
  }

  return "viajan";
}

function getSeccionNominaLabel(
  seccion = ""
) {
  if (
    seccion ===
    "viajan"
  ) {
    return "NÓMINA QUE VIAJA";
  }

  if (
    seccion ===
    "gestion"
  ) {
    return "PENDIENTES DE GESTIÓN";
  }

  return "ANULADOS / NO VIAJAN";
}

function getEstadoOperativoLabel(
  item = {}
) {
  const categoria =
    getCategoriaOperativa(
      item
    );

  const labels = {
    lista_confirmada:
      "Lista de espera confirmada",

    nuevo_confirmado:
      "Nuevo ingreso confirmado",

    liberado:
      "Cupo liberado",

    nomina_base_completa:
      "Nómina final / ficha completa",

    nomina_base_pendiente:
      "Nómina final / ficha pendiente",

    sistema_completo:
      "Sistema de Pagos · Ficha completa",

    sistema_pendiente:
      "Sistema de Pagos · Ficha pendiente",

    nuevo_pendiente:
      "Nuevo ingreso pendiente",

    lista_pagada:
      "Lista de espera pagada",

    lista_pendiente:
      "Lista de espera pendiente",

    otro:
      "Inscripción",

    anulado:
      getMotivoAnulacion(
        item
      )
  };

  return labels[categoria] ||
    "Inscripción";
}

function getTipoVisibleNomina(
  item = {}
) {
  const categoria =
    getCategoriaOperativa(
      item
    );

  if (
    categoria ===
    "anulado"
  ) {
    return "Anulado";
  }

  const labels = {
    lista_confirmada:
      "Lista de espera",

    nuevo_confirmado:
      "Nuevo ingreso",

    liberado:
      "Cupo liberado",

    nomina_base_completa:
      "Nómina final",

    nomina_base_pendiente:
      "Nómina final",

    sistema_completo:
      "Sistema de Pagos",

    sistema_pendiente:
      "Sistema de Pagos",

    nuevo_pendiente:
      "Nuevo ingreso",

    lista_pagada:
      "Lista de espera",

    lista_pendiente:
      "Lista de espera",

    otro:
      camposPasajero.tipo(
        item
      ) ||
      "Inscripción"
  };

  return labels[categoria] ||
    "Inscripción";
}

function getMotivoAnulacion(
  item = {}
) {
  const estadoViaje =
    normalizar(
      item.estadoViaje ||
      ""
    )
      .replace(
        /\s+/g,
        "_"
      );

  const motivo =
    String(
      item.motivoAnulacion ||
      item.anuladoMotivo ||
      item.motivoNoViaja ||
      item.sistemaPagosMotivo ||
      ""
    ).trim();

  if (
    estadoViaje ===
      "eliminado_en_sp" ||
    estadoViaje ===
      "eliminado_sistema_pagos" ||
    item.eliminadoSistemaPagos ===
      true
  ) {
    return "Eliminado en Sistema de Pagos";
  }

  if (
    item.viaja === false ||
    estadoViaje ===
      "no_viaja"
  ) {
    return motivo ||
      "No viaja según Sistema de Pagos";
  }

  return motivo ||
    "Anulación administrativa";
}

function getClaseFilaNomina(
  item = {}
) {
  return `nomina-row-${
    getCategoriaOperativa(
      item
    )
  }`;
}

function toDateNomina(
  value
) {
  if (!value) {
    return null;
  }

  if (
    value instanceof Date
  ) {
    return Number.isNaN(
      value.getTime()
    )
      ? null
      : value;
  }

  if (
    typeof value?.toDate ===
    "function"
  ) {
    const date =
      value.toDate();

    return Number.isNaN(
      date.getTime()
    )
      ? null
      : date;
  }

  if (
    typeof value ===
      "object" &&
    typeof value.seconds ===
      "number"
  ) {
    return new Date(
      value.seconds *
      1000
    );
  }

  const date =
    new Date(
      value
    );

  return Number.isNaN(
    date.getTime()
  )
    ? null
    : date;
}

function getFechaIngresoNomina(
  item = {}
) {
  return (
    item.fechaFormulario ||
    item?.meta?.fechaInscripcion ||
    item?.meta?.fechaFormularioCliente ||
    item.fechaInscripcion ||
    item.fechaFormularioCliente ||
    item.creadoEn ||
    item.createdAt ||
    item.fechaCreacion ||
    item.fechaAprobacion ||
    item?.sistemaPagos?.importadoAtCliente ||
    ""
  );
}

function formatFechaIngresoNomina(
  item = {}
) {
  const date =
    toDateNomina(
      getFechaIngresoNomina(
        item
      )
    );

  if (!date) {
    return "—";
  }

  return date.toLocaleDateString(
    "es-CL",
    {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit"
    }
  );
}

function getResponsableNomina(
  item = {},
  tipo = "principal"
) {
  const base =
    tipo === "secundario"
      ? item?.contactoSecundario ||
        {}
      : item?.contactoPrincipal ||
        {};

  const nombre =
    String(
      base.nombre ||
      base.nombreCompleto ||
      [
        base.nombres,
        base.primerApellido,
        base.segundoApellido
      ]
        .filter(Boolean)
        .join(" ") ||
      ""
    ).trim();

  const relacion =
    String(
      base.relacion ||
      base.relacionBase ||
      ""
    ).trim();

  const telefono =
    String(
      base.celular ||
      base.telefono ||
      base.whatsapp ||
      ""
    ).trim();

  const correo =
    String(
      base.correo ||
      ""
    ).trim();

  const aplica =
    tipo === "principal"
      ? !!(
          nombre ||
          telefono ||
          correo
        )
      : (
          base.aplica === true ||
          !!(
            nombre ||
            telefono ||
            correo
          )
        );

  return {
    aplica,
    nombre,
    relacion,
    telefono,
    correo
  };
}

function getResponsablesNominaHtml(
  item = {}
) {
  const principal =
    getResponsableNomina(
      item,
      "principal"
    );

  const secundario =
    getResponsableNomina(
      item,
      "secundario"
    );

  const bloques =
    [];

  if (
    principal.aplica
  ) {
    bloques.push(`
      <div class="gn-responsable">
        <strong>
          ${esc(
            principal.nombre ||
            "Responsable principal"
          )}
        </strong>

        <small>
          ${esc(
            [
              principal.relacion,
              principal.telefono
            ]
              .filter(Boolean)
              .join(" · ")
          )}
        </small>

        ${
          principal.correo
            ? `
              <small>
                ${esc(
                  principal.correo
                )}
              </small>
            `
            : ""
        }
      </div>
    `);
  }

  if (
    secundario.aplica
  ) {
    bloques.push(`
      <div class="gn-responsable">
        <strong>
          ${esc(
            secundario.nombre ||
            "Responsable secundario"
          )}
        </strong>

        <small>
          ${esc(
            [
              secundario.relacion,
              secundario.telefono
            ]
              .filter(Boolean)
              .join(" · ")
          )}
        </small>

        ${
          secundario.correo
            ? `
              <small>
                ${esc(
                  secundario.correo
                )}
              </small>
            `
            : ""
        }
      </div>
    `);
  }

  if (!bloques.length) {
    return "—";
  }

  return `
    <div class="gn-responsables">
      ${bloques.join("")}
    </div>
  `;
}

function getOrdenNominaOperativa(
  item = {}
) {
  if (
    estaAnuladoNomina(
      item
    )
  ) {
    return 1000;
  }

  const tipo =
    normalizar(
      item.tipoInscripcion ||
      item.estadoInscripcion ||
      item.faseInscripcion ||
      ""
    )
      .replace(
        /\s+/g,
        "_"
      );

  const estadoCupo =
    normalizar(
      item.estadoCupo ||
      ""
    )
      .replace(
        /\s+/g,
        "_"
      );

  /*
    1º Lo que requiere gestión.
  */
  if (
    tipo ===
      "nuevo_ingreso" &&
    estadoCupo !==
      "confirmado"
  ) {
    return 10;
  }

  if (
    tipo ===
      "lista_espera" &&
    ![
      "pagado",
      "confirmado"
    ].includes(
      estadoCupo
    )
  ) {
    return 20;
  }

  if (
    tipo ===
      "lista_espera_pagada" ||
    (
      tipo ===
        "lista_espera" &&
      estadoCupo ===
        "pagado"
    )
  ) {
    return 30;
  }

  /*
    2º Personas ya confirmadas que viajan.
  */
  if (
    tipo ===
      "nuevo_ingreso_confirmado" ||
    (
      tipo ===
        "nuevo_ingreso" &&
      estadoCupo ===
        "confirmado"
    )
  ) {
    return 40;
  }

  if (
    tipo ===
      "lista_espera_confirmada" ||
    (
      tipo ===
        "lista_espera" &&
      estadoCupo ===
        "confirmado"
    )
  ) {
    return 50;
  }

  if (
    tipo ===
      "liberado" ||
    tipo ===
      "cupo_liberado"
  ) {
    return 60;
  }

  if (
    [
      "nomina_inicial",
      "inscripcion_inicial",
      "nomina_final",
      "sistema_pagos",
      "sistema_de_pagos"
    ].includes(
      tipo
    )
  ) {
    return 70;
  }

  return 500;
}

function ordenarNominaOperativa(
  items = []
) {
  return [
    ...items
  ].sort(
    (a, b) => {
      const ordenA =
        getOrdenNominaOperativa(
          a
        );

      const ordenB =
        getOrdenNominaOperativa(
          b
        );

      if (
        ordenA !==
        ordenB
      ) {
        return (
          ordenA -
          ordenB
        );
      }

      /*
        Para los pendientes de gestión:
        el que ingresó primero aparece primero.
      */
      if (
        ordenA <= 30
      ) {
        const fechaA =
          toDateNomina(
            getFechaIngresoNomina(
              a
            )
          )?.getTime() ||
          Number.MAX_SAFE_INTEGER;

        const fechaB =
          toDateNomina(
            getFechaIngresoNomina(
              b
            )
          )?.getTime() ||
          Number.MAX_SAFE_INTEGER;

        if (
          fechaA !==
          fechaB
        ) {
          return (
            fechaA -
            fechaB
          );
        }
      }

      /*
        Para pasajeros ya confirmados:
        orden alfabético por apellido y luego nombre.
      */
      const apellidoA =
        normalizar(
          camposPasajero.apellidos(
            a
          )
        );

      const apellidoB =
        normalizar(
          camposPasajero.apellidos(
            b
          )
        );

      const compareApellido =
        apellidoA.localeCompare(
          apellidoB,
          "es",
          {
            sensitivity:
              "base",
            numeric:
              true
          }
        );

      if (
        compareApellido !==
        0
      ) {
        return compareApellido;
      }

      return normalizar(
        camposPasajero.nombres(
          a
        )
      ).localeCompare(
        normalizar(
          camposPasajero.nombres(
            b
          )
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

function renderPasajeros() {
  const tbody =
    $("pasajerosTbody");

  if (!tbody) {
    return;
  }

  /*
    ESTE ES EL FILTRO CORRECTO QUE YA EXISTE
    EN TU gestion-nomina.js.

    Los KPI modifican state.nominaFiltro
    y filtrarNominaModal() aplica ese filtro.
  */
  const filtrados =
    filtrarNominaModal(
      state.nomina
    );

  /*
    Después del filtro aplicamos
    el nuevo orden operativo.
  */
  const visibles =
    ordenarNominaOperativa(
      filtrados
    );

  if (!visibles.length) {
    tbody.innerHTML = `
      <tr>
        <td
          colspan="11"
          class="gn-empty"
        >
          No hay pasajeros para este filtro.
        </td>
      </tr>
    `;

    return;
  }

  let seccionAnterior =
    "";

  tbody.innerHTML =
    visibles
      .map(
        (item) => {
          const seccion =
            getSeccionNomina(
              item
            );

          const separador =
            seccion !==
            seccionAnterior
              ? `
                <tr class="nomina-section-row">
                  <td colspan="11">
                    ${esc(
                      getSeccionNominaLabel(
                        seccion
                      )
                    )}
                  </td>
                </tr>
              `
              : "";

          seccionAnterior =
            seccion;

          const esFoco =
            state.pasajeroFocoId &&
            String(
              item.id ||
              ""
            ) ===
            String(
              state.pasajeroFocoId
            );

          const anulada =
            estaAnuladoNomina(
              item
            );

          return `
            ${separador}

            <tr
              data-inscripcion-row="${esc(
                item.id ||
                ""
              )}"
              class="${esc(
                [
                  getClaseFilaNomina(
                    item
                  ),
                  esFoco
                    ? "is-focus"
                    : "",
                  anulada
                    ? "is-anulado"
                    : ""
                ]
                  .filter(Boolean)
                  .join(" ")
              )}"
            >
              <td>
                <button
                  type="button"
                  class="rut-viewer-link"
                  data-ver-ficha-inscripcion="${esc(
                    item.id ||
                    ""
                  )}"
                  title="Abrir ficha individual"
                >
                  ${esc(
                    camposPasajero.documento(
                      item
                    ) ||
                    "—"
                  )}
                </button>
              </td>

              <td>
                ${esc(
                  camposPasajero.nombres(
                    item
                  ) ||
                  "—"
                )}
              </td>

              <td>
                ${esc(
                  camposPasajero.apellidos(
                    item
                  ) ||
                  "—"
                )}
              </td>

              <td>
                <span class="nomina-type-pill">
                  ${esc(
                    getTipoVisibleNomina(
                      item
                    )
                  )}
                </span>
              </td>

              <td>
                <strong>
                  ${esc(
                    getEstadoOperativoLabel(
                      item
                    )
                  )}
                </strong>
              </td>

              <td>
                <span
                  class="badge ${
                    fichaCompletaNomina(
                      item
                    )
                      ? "ok"
                      : "warn"
                  }"
                >
                  ${
                    fichaCompletaNomina(
                      item
                    )
                      ? "Completa"
                      : "Pendiente"
                  }
                </span>
              </td>

              <td>
                ${
                  anulada
                    ? "Sí"
                    : "No"
                }
              </td>

              <td>
                ${getResponsablesNominaHtml(
                  item
                )}
              </td>

              <td>
                <span class="gn-fecha-ingreso">
                  ${esc(
                    formatFechaIngresoNomina(
                      item
                    )
                  )}
                </span>
              </td>

              <td>
                ${
                  camposPasajero.tieneCarnet(
                    item
                  )
                    ? "Sí"
                    : "No"
                }
              </td>

              <td>
                <div class="passenger-row-actions">
                  ${getAccionOperativaHtml(
                    item
                  )}
                </div>
              </td>
            </tr>
          `;
        }
      )
      .join("");
}

async function manejarAccionPasajero(
  event
) {
  const viewButton =
    event.target.closest(
      "[data-ver-ficha-inscripcion]"
    );

  if (viewButton) {
    try {
      await state.viewer
        .abrir(
          viewButton.dataset
            .verFichaInscripcion
        );
    } catch (error) {
      alert(
        error.message ||
        "No se pudo abrir la ficha."
      );
    }

    return;
  }

  const button =
    event.target.closest(
      "[data-pasajero-action]"
    );

  if (!button) {
    return;
  }

  const accion =
    button.dataset
      .pasajeroAction;

  const inscripcionId =
    button.dataset
      .inscripcionId;

  if (
    !accion ||
    !inscripcionId ||
    !state.current
  ) {
    return;
  }

  /*
    NUEVO:
    Editor administrativo de nómina.
  */
  if (
    accion ===
    "editar_nomina"
  ) {
    try {
      await abrirEditorNomina(
        inscripcionId
      );
    } catch (error) {
      console.error(
        "[gestion-nomina] abrirEditorNomina",
        error
      );

      alert(
        error.message ||
        "No se pudo abrir el editor."
      );
    }

    return;
  }

  const item =
    state.nomina.find(
      (row) =>
        String(
          row.id
        ) ===
        String(
          inscripcionId
        )
    );

  const nombre =
    [
      camposPasajero.nombres(
        item ||
        {}
      ),
      camposPasajero.apellidos(
        item ||
        {}
      )
    ]
      .filter(Boolean)
      .join(" ")
      .trim() ||
    "esta persona";

  let mensaje =
    "";

  if (
    accion ===
    "confirmar_nuevo"
  ) {
    mensaje =
      `¿Confirmar nuevo ingreso para ${nombre}?`;
  }

  if (
    accion ===
    "marcar_pagado"
  ) {
    mensaje =
      `¿Confirmar que ${nombre} pagó los $100.000 de lista de espera?`;
  }

  if (
    accion ===
    "confirmar_cupo"
  ) {
    mensaje =
      `¿Confirmar cupo para ${nombre} desde lista de espera pagada?`;
  }

  if (
    !mensaje ||
    !confirm(
      mensaje
    )
  ) {
    return;
  }

  const textoOriginal =
    button.textContent;

  try {
    button.disabled =
      true;

    button.textContent =
      "Procesando...";

    if (
      accion ===
      "confirmar_nuevo"
    ) {
      await state.manager
        .confirmarNuevoIngreso(
          state.current,
          inscripcionId
        );
    }

    if (
      accion ===
      "marcar_pagado"
    ) {
      await state.manager
        .marcarListaEsperaPagada(
          state.current,
          inscripcionId
        );
    }

    if (
      accion ===
      "confirmar_cupo"
    ) {
      await state.manager
        .confirmarCupoListaEspera(
          state.current,
          inscripcionId
        );
    }

    await refrescarModal();
    await cargarAlertasInscripciones();

    alert(
      "Acción realizada correctamente."
    );
  } catch (error) {
    console.error(
      "[gestion-nomina] manejarAccionPasajero",
      error
    );

    alert(
      error.message ||
      "No se pudo completar la acción."
    );
  } finally {
    button.disabled =
      false;

    button.textContent =
      textoOriginal;
  }
}

function getAccionOperativaHtml(
  item = {}
) {
  const categoria =
    getCategoriaOperativa(
      item
    );

  let accionPendiente =
    `
      <span class="gn-sub">
        Sin acción pendiente
      </span>
    `;

  if (
    categoria ===
    "nuevo_pendiente"
  ) {
    accionPendiente = `
      <button
        class="passenger-action-btn action-confirm"
        type="button"
        data-pasajero-action="confirmar_nuevo"
        data-inscripcion-id="${esc(
          item.id ||
          ""
        )}"
      >
        Confirmar nuevo ingreso
      </button>
    `;
  }

  if (
    categoria ===
    "lista_pendiente"
  ) {
    accionPendiente = `
      <button
        class="passenger-action-btn action-paid"
        type="button"
        data-pasajero-action="marcar_pagado"
        data-inscripcion-id="${esc(
          item.id ||
          ""
        )}"
      >
        Marcar pagado
      </button>
    `;
  }

  if (
    categoria ===
    "lista_pagada"
  ) {
    accionPendiente = `
      <button
        class="passenger-action-btn action-confirm"
        type="button"
        data-pasajero-action="confirmar_cupo"
        data-inscripcion-id="${esc(
          item.id ||
          ""
        )}"
      >
        Confirmar cupo
      </button>
    `;
  }

  const tieneAlertaCambio =
    state.alertasInscripciones
      .some(
        (alerta) =>
          alerta.tipoAlerta ===
            "cambio_datos_criticos" &&
          alerta.activa !==
            false &&
          alerta.resuelta !==
            true &&
          String(
            alerta.inscripcionId ||
            ""
          ) ===
            String(
              item.id ||
              ""
            )
      );

  return `
    ${accionPendiente}

    ${
      tieneAlertaCambio
        ? `
          <span
            class="badge warn"
            title="Hay datos modificados que deben revisarse en Sistema de Pagos"
          >
            ⚠ Revisar pagos
          </span>
        `
        : ""
    }

    <button
      class="passenger-action-btn action-edit"
      type="button"
      data-pasajero-action="editar_nomina"
      data-inscripcion-id="${esc(
        item.id ||
        ""
      )}"
    >
      Editar
    </button>
  `;
}

function getByPathNomina(
  object = {},
  path = ""
) {
  return String(
    path ||
    ""
  )
    .split(".")
    .reduce(
      (current, key) =>
        current?.[key],
      object
    );
}

function asegurarModalEditorNomina() {
  if (
    $("modalEditarNominaPasajero")
  ) {
    return;
  }

  const modal =
    document.createElement(
      "div"
    );

  modal.id =
    "modalEditarNominaPasajero";

  modal.style.cssText = `
    display:none;
    position:fixed;
    inset:0;
    z-index:10050;
    background:rgba(0,0,0,.48);
    padding:24px;
    overflow:auto;
  `;

  modal.innerHTML = `
    <div
      style="
        width:min(920px,100%);
        margin:30px auto;
        background:#fff;
        border-radius:16px;
        padding:24px;
        box-shadow:0 24px 70px rgba(0,0,0,.25);
      "
    >
      <div
        style="
          display:flex;
          justify-content:space-between;
          gap:20px;
          align-items:flex-start;
          margin-bottom:20px;
        "
      >
        <div>
          <h2
            id="editarNominaTitulo"
            style="margin:0 0 5px"
          >
            Editar pasajero
          </h2>

          <div
            class="gn-sub"
            id="editarNominaSubtitulo"
          ></div>
        </div>

        <button
          type="button"
          class="btn-secondary"
          id="btnCerrarEditorNomina"
        >
          Cerrar
        </button>
      </div>

      <div
        style="
          background:#fff8dc;
          border:1px solid #eadca6;
          border-radius:10px;
          padding:12px 14px;
          margin-bottom:18px;
        "
      >
        Este editor modifica únicamente datos administrativos
        del pasajero y del apoderado. No modifica la ficha médica.
      </div>

      <div
        id="editarNominaCampos"
        style="
          display:grid;
          grid-template-columns:
            repeat(
              auto-fit,
              minmax(220px,1fr)
            );
          gap:14px;
        "
      ></div>

      <div
        style="
          margin-top:20px;
        "
      >
        <label
          style="
            display:block;
            font-weight:700;
            margin-bottom:6px;
          "
        >
          Motivo / justificación de la modificación
        </label>

        <textarea
          id="editarNominaMotivo"
          rows="4"
          style="
            width:100%;
            box-sizing:border-box;
            padding:10px;
            border:1px solid #ccc;
            border-radius:8px;
          "
          placeholder="Explica por qué se realiza la corrección..."
        ></textarea>
      </div>

      <div
        style="
          display:flex;
          justify-content:space-between;
          flex-wrap:wrap;
          gap:12px;
          margin-top:22px;
        "
      >
        <button
          type="button"
          class="gn-btn danger"
          id="btnArchivarPasajeroEditor"
        >
          Archivar pasajero
        </button>

        <div
          style="
            display:flex;
            gap:10px;
            flex-wrap:wrap;
          "
        >
          <button
            type="button"
            class="btn-secondary"
            id="btnCancelarEditorNomina"
          >
            Cancelar
          </button>

          <button
            type="button"
            class="gn-btn"
            id="btnGuardarEditorNomina"
          >
            Guardar cambios
          </button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(
    modal
  );

  $("btnCerrarEditorNomina")
    ?.addEventListener(
      "click",
      cerrarEditorNomina
    );

  $("btnCancelarEditorNomina")
    ?.addEventListener(
      "click",
      cerrarEditorNomina
    );

  $("btnGuardarEditorNomina")
    ?.addEventListener(
      "click",
      guardarEditorNomina
    );

  $("btnArchivarPasajeroEditor")
    ?.addEventListener(
      "click",
      archivarDesdeEditorNomina
    );

  modal.addEventListener(
    "click",
    (event) => {
      if (
        event.target ===
        modal
      ) {
        cerrarEditorNomina();
      }
    }
  );
}

function renderCampoEditorNomina({
  label,
  path,
  value = "",
  type = "text"
}) {
  return `
    <label
      style="
        display:flex;
        flex-direction:column;
        gap:6px;
        font-weight:700;
      "
    >
      ${esc(
        label
      )}

      <input
        type="${esc(
          type
        )}"
        value="${esc(
          value ??
          ""
        )}"
        data-nomina-edit-path="${esc(
          path
        )}"
        style="
          width:100%;
          box-sizing:border-box;
          padding:10px;
          border:1px solid #ccc;
          border-radius:8px;
          font-weight:400;
        "
      >
    </label>
  `;
}

async function abrirEditorNomina(
  inscripcionId
) {
  asegurarModalEditorNomina();

  const item =
    await state.manager
      .cargarInscripcionCompleta(
        state.current,
        inscripcionId
      );

  if (!item) {
    throw new Error(
      "No se pudo cargar la inscripción completa."
    );
  }

  state.editingNominaId =
    String(
      inscripcionId
    );

  const nombreCompleto =
    [
      getByPathNomina(
        item,
        "identificacion.nombres"
      ),
      getByPathNomina(
        item,
        "identificacion.primerApellido"
      ),
      getByPathNomina(
        item,
        "identificacion.segundoApellido"
      )
    ]
      .filter(Boolean)
      .join(" ")
      .trim();

  set(
    "editarNominaTitulo",
    `Editar · ${
      nombreCompleto ||
      "Pasajero"
    }`
  );

  set(
    "editarNominaSubtitulo",
    camposPasajero.documento(
      item
    ) ||
    ""
  );

  $("editarNominaMotivo").value =
    "";

  const campos = [
    {
      label:
        "RUT / Documento",
      path:
        "identificacion.documento",
      value:
        camposPasajero.documento(
          item
        )
    },
    {
      label:
        "Nombres",
      path:
        "identificacion.nombres",
      value:
        getByPathNomina(
          item,
          "identificacion.nombres"
        )
    },
    {
      label:
        "Primer apellido",
      path:
        "identificacion.primerApellido",
      value:
        getByPathNomina(
          item,
          "identificacion.primerApellido"
        )
    },
    {
      label:
        "Segundo apellido",
      path:
        "identificacion.segundoApellido",
      value:
        getByPathNomina(
          item,
          "identificacion.segundoApellido"
        )
    },
    {
      label:
        "Fecha de nacimiento",
      path:
        "identificacion.fechaNacimiento",
      value:
        getByPathNomina(
          item,
          "identificacion.fechaNacimiento"
        ),
      type:
        "date"
    },
    {
      label:
        "Tipo de viajante",
      path:
        "tipoViajante",
      value:
        item.tipoViajante ||
        item.tipoParticipacion ||
        ""
    },
    {
      label:
        "Nacionalidad",
      path:
        "identificacion.nacionalidad",
      value:
        getByPathNomina(
          item,
          "identificacion.nacionalidad"
        )
    },
    {
      label:
        "Género / Sexo",
      path:
        "identificacion.genero",
      value:
        getByPathNomina(
          item,
          "identificacion.genero"
        )
    },

    /*
      DATOS DEL APODERADO / RESPONSABLE
    */
    {
      label:
        "Nombre apoderado / responsable",
      path:
        "contactoPrincipal.nombre",
      value:
        getByPathNomina(
          item,
          "contactoPrincipal.nombre"
        )
    },
    {
      label:
        "Correo apoderado / responsable",
      path:
        "contactoPrincipal.correo",
      value:
        getByPathNomina(
          item,
          "contactoPrincipal.correo"
        ),
      type:
        "email"
    },
    {
      label:
        "Celular apoderado / responsable",
      path:
        "contactoPrincipal.celular",
      value:
        getByPathNomina(
          item,
          "contactoPrincipal.celular"
        ) ||
        getByPathNomina(
          item,
          "contactoPrincipal.telefono"
        )
    }
  ];

  $("editarNominaCampos").innerHTML =
    campos
      .map(
        renderCampoEditorNomina
      )
      .join("");

  $("modalEditarNominaPasajero")
    .style.display =
      "block";

  document.body.classList.add(
    "modal-open"
  );
}

function cerrarEditorNomina() {
  const modal =
    $("modalEditarNominaPasajero");

  if (modal) {
    modal.style.display =
      "none";
  }

  state.editingNominaId =
    "";

  /*
    El modal principal de Gestión Nómina
    continúa abierto.
  */
  document.body.classList.add(
    "modal-open"
  );
}

function leerValoresEditorNomina() {
  const valores =
    {};

  document
    .querySelectorAll(
      "#modalEditarNominaPasajero [data-nomina-edit-path]"
    )
    .forEach(
      (input) => {
        const path =
          input.dataset
            .nominaEditPath;

        let value =
          String(
            input.value ||
            ""
          ).trim();

        /*
          Mantiene la convención de nombres en mayúsculas
          que ya usa el sistema.
        */
        if (
          [
            "identificacion.nombres",
            "identificacion.primerApellido",
            "identificacion.segundoApellido",
            "identificacion.nacionalidad",
            "contactoPrincipal.nombre"
          ].includes(
            path
          )
        ) {
          value =
            value.toLocaleUpperCase(
              "es-CL"
            );
        }

        if (
          path ===
          "contactoPrincipal.correo"
        ) {
          value =
            value.toLowerCase();
        }

        valores[path] =
          value;

        /*
          Estas dos rutas deben mantenerse iguales.
        */
        if (
          path ===
          "identificacion.documento"
        ) {
          valores[
            "identificacion.rutCompleto"
          ] =
            value;
        }

        if (
          path ===
          "tipoViajante"
        ) {
          valores[
            "tipoParticipacion"
          ] =
            value;
        }
      }
    );

  return valores;
}

async function guardarEditorNomina() {
  if (
    !state.editingNominaId ||
    !state.current
  ) {
    return;
  }

  const motivo =
    String(
      $("editarNominaMotivo")
        ?.value ||
      ""
    ).trim();

  if (!motivo) {
    alert(
      "Debes explicar el motivo de la modificación."
    );

    $("editarNominaMotivo")
      ?.focus();

    return;
  }

  const button =
    $("btnGuardarEditorNomina");

  const textoOriginal =
    button?.textContent ||
    "Guardar cambios";

  try {
    if (button) {
      button.disabled =
        true;

      button.textContent =
        "Guardando...";
    }

    const resultado =
      await state.manager
        .actualizarDatosNomina(
          state.current,
          state.editingNominaId,
          leerValoresEditorNomina(),
          motivo
        );

    if (
      resultado?.sinCambios
    ) {
      alert(
        "No hay cambios para guardar."
      );

      return;
    }

    cerrarEditorNomina();

    await refrescarModal();
    await cargarAlertasInscripciones();

    /*
      Vuelve a renderizar para que pueda aparecer
      la advertencia "Revisar pagos".
    */
    renderPasajeros();

    alert(
      "Datos de nómina actualizados correctamente."
    );
  } catch (error) {
    console.error(
      "[gestion-nomina] guardarEditorNomina",
      error
    );

    alert(
      error.message ||
      "No se pudieron guardar los cambios."
    );
  } finally {
    if (button) {
      button.disabled =
        false;

      button.textContent =
        textoOriginal;
    }
  }
}

async function archivarDesdeEditorNomina() {
  if (
    !state.editingNominaId ||
    !state.current
  ) {
    return;
  }

  const motivo =
    String(
      $("editarNominaMotivo")
        ?.value ||
      ""
    ).trim();

  if (!motivo) {
    alert(
      "Antes de archivar debes explicar el motivo."
    );

    $("editarNominaMotivo")
      ?.focus();

    return;
  }

  if (
    !confirm(
      "¿Archivar este pasajero?\n\nEl registro no será eliminado; quedará archivado."
    )
  ) {
    return;
  }

  const button =
    $("btnArchivarPasajeroEditor");

  try {
    if (button) {
      button.disabled =
        true;

      button.textContent =
        "Archivando...";
    }

    await state.manager
      .archivarPasajero(
        state.current,
        state.editingNominaId,
        motivo
      );

    cerrarEditorNomina();

    await refrescarModal();
    await cargarPantalla();

    alert(
      "Pasajero archivado correctamente."
    );
  } catch (error) {
    console.error(
      "[gestion-nomina] archivarDesdeEditorNomina",
      error
    );

    alert(
      error.message ||
      "No se pudo archivar al pasajero."
    );
  } finally {
    if (button) {
      button.disabled =
        false;

      button.textContent =
        "Archivar pasajero";
    }
  }
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

function getGrupoActualIds() {
  return {
    /*
      docId corresponde al documento real dentro de
      ventas_cotizaciones.

      Es el identificador que necesitan las páginas
      de fichas médicas para encontrar directamente
      la subcolección de inscripciones.
    */
    docId:
      String(
        state.current?.docId ||
        ""
      ).trim(),

    /*
      groupId corresponde al idGrupo comercial.

      Se mantiene para abrir grupo.html, porque esa
      página ya sabe resolver ambos identificadores.
    */
    groupId:
      String(
        state.current?.groupId ||
        ""
      ).trim()
  };
}

function abrirGrupoCompleto() {
  const {
    docId,
    groupId
  } =
    getGrupoActualIds();

  const idGrupo =
    groupId ||
    docId;

  if (!idGrupo) {
    alert(
      "No se pudo identificar el grupo."
    );

    return;
  }

  window.open(
    `grupo.html?id=${encodeURIComponent(
      idGrupo
    )}`,
    "_blank",
    "noopener"
  );
}

function abrirGestionFichasMedicas() {
  const {
    docId,
    groupId
  } =
    getGrupoActualIds();

  /*
    Para acceder a:
    ventas_cotizaciones/{groupDocId}/inscripciones

    preferimos siempre docId.
  */
  const idGrupo =
    docId ||
    groupId;

  if (!idGrupo) {
    alert(
      "No se pudo identificar el grupo para gestionar sus fichas médicas."
    );

    return;
  }

  window.open(
    `gestion-fichas-medicas.html?id=${encodeURIComponent(
      idGrupo
    )}`,
    "_blank",
    "noopener"
  );
}

function abrirFichasMedicasGrupo() {
  const {
    docId,
    groupId
  } =
    getGrupoActualIds();

  const idGrupo =
    docId ||
    groupId;

  if (!idGrupo) {
    alert(
      "No se pudo identificar el grupo para abrir sus fichas médicas."
    );

    return;
  }

  window.open(
    `fichas-medicas-grupo.html?id=${encodeURIComponent(
      idGrupo
    )}`,
    "_blank",
    "noopener"
  );
}

function abrirGestionPulseras() {
  const {
    docId,
    groupId
  } =
    getGrupoActualIds();

  const idGrupo =
    docId ||
    groupId;

  if (!idGrupo) {
    alert(
      "No se pudo identificar el grupo."
    );

    return;
  }

  window.open(
    `gestion-pulseras-nfc.html?id=${encodeURIComponent(
      idGrupo
    )}`,
    "_blank",
    "noopener"
  );
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

  state.nominaFiltro =
    "todos";

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
