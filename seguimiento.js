import {
  auth,
  db,
  puedeVerGeneral,
  normalizeEmail,
  VENTAS_USERS,
  getVentasUser,
  getVentasUserEmails
} from "./firebase-init.js";

import {
  collection,
  doc,
  getDoc,
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

/* =========================================================
   CONFIG
========================================================= */
const $ = (id) =>
  document.getElementById(id);

const CURRENT_YEAR =
  new Date().getFullYear();

const GRUPOS_RESUMEN_COLLECTION =
  "ventas_grupos_resumen";

const SEGUIMIENTO_CACHE_PREFIX =
  "seguimiento_resumen_ano_";

const SEGUIMIENTO_CACHE_TTL_MS =
  10 * 60 * 1000;

function getAnoComercialActual() {
  const hoy =
    new Date();

  const ano =
    hoy.getFullYear();

  const mes =
    hoy.getMonth();

  /*
    Enero = 0
    Febrero = 1
    Marzo = 2

    El año comercial cambia el 1 de marzo.
  */
  return mes >= 2
    ? ano
    : ano - 1;
}

function getAnoViajePrincipal() {
  return (
    getAnoComercialActual() + 1
  );
}

function getAnosSeguimientoDisponibles() {
  const anoComercial =
    getAnoComercialActual();

  const anoPrincipal =
    getAnoViajePrincipal();

  return [
    anoComercial,
    anoPrincipal,
    anoPrincipal + 1,
    anoPrincipal + 2
  ];
}

const state = {
  allRows: [],
  filteredRows: [],
  visibleRows: [],
  authEmail: "",
  effectiveEmail: "",
  currentUser: null,
  realUser: null,
  canSeeAll: false,

  // filtro recibido desde dashboard
  dashboardPreset: {
    bucket: "",
    ano: "",
    archivados: false,
    vendor: ""
  },

  // Perdidas oculto por defecto
  hiddenSummaryStates: new Set(["perdida"]),

  // Orden default: por grupo/colegio A → Z
  sortKey: "grupo",
  sortDir: "asc",
  
  /*
    Caché en memoria, separada por año.
  */
  rowsPorAno:
    new Map(),
  
  anosCargados:
    new Set(),
  
  /*
    Hoy en 2026 comenzará en 2027.
  */
  anoSeleccionado:
    String(
      getAnoViajePrincipal()
    ),
  
  cargaEnCurso:
    false
};

const STAGE_META = {
  a_contactar:        { label: "A contactar",        steps: 1, fillClass: "seg-fill-red",    order: 1 },
  contactado:         { label: "Contactado",         steps: 2, fillClass: "seg-fill-orange", order: 2 },
  cotizando:          { label: "Cotizando",          steps: 3, fillClass: "seg-fill-yellow", order: 3 },
  recotizando:        { label: "Recotizando",        steps: 3, fillClass: "seg-fill-yellow", order: 4 },
  reunion_confirmada: { label: "Reunión confirmada", steps: 4, fillClass: "seg-fill-mix",    order: 5 },
  ganada:             { label: "Ganada",             steps: 5, fillClass: "seg-fill-green",  order: 6 },
  perdida:            { label: "Perdida",            steps: 5, fillClass: "seg-fill-red",    order: 7 }
};

const DOCS_META = [
  { key: "fichaMedicaEstado", label: "Fichas médicas",       icon: "🩺" },
  { key: "nominaEstado",      label: "Nómina de viaje",      icon: "📋" },
  { key: "fichaEstado",       label: "Ficha del grupo",      icon: "🧾" },
  { key: "contratoEstado",    label: "Contrato",             icon: "✍️" },
  { key: "cortesiaEstado",    label: "Estadías de cortesía", icon: "🎁" }
];

/* =========================================================
   INIT
========================================================= */
initPage();

async function initPage() {
  bindEvents();
  
  await waitForLayoutReady();
  
  ocultarControlAnosAnteriores();
  
  bindHeaderActions();

  onAuthStateChanged(auth, async (user) => {
    if (!user) return;
  
    await bootstrapFromSession();
    renderActingUserSwitcherSimple();
    bindHeaderActions(); // reengancha entrar como / volver a mi usuario
  
    updateSummaryButtonsUI();
    updateSortHeaderUI();
    await loadSeguimiento();
  });
}

function ocultarControlAnosAnteriores() {
  const toggle =
    $("toggleAnteriores");

  if (!toggle) {
    return;
  }

  toggle.checked = false;
  toggle.disabled = true;


  /*
    Queremos ocultar TODO el bloque:

      Mostrar
      [ ] Archivados

    No solamente el label interno
    que contiene el checkbox.
  */
  const contenedor =
    toggle.closest(
      ".field-wrap"
    );


  if (contenedor) {
    contenedor.style.display =
      "none";

    return;
  }


  /*
    Fallback por si cambia
    la estructura del HTML.
  */
  toggle.style.display =
    "none";
}

async function bootstrapFromSession() {
  state.realUser = getRealUser();
  state.currentUser = getEffectiveUser();
  
  const resolvedRealUser = getVentasUser(state.realUser?.email || auth.currentUser?.email || "");
  const resolvedEffectiveUser = getVentasUser(state.currentUser?.email || state.realUser?.email || auth.currentUser?.email || "");
  
  if (resolvedRealUser) {
    state.realUser = { ...state.realUser, ...resolvedRealUser };
  }
  
  if (resolvedEffectiveUser) {
    state.currentUser = { ...state.currentUser, ...resolvedEffectiveUser };
  }
  
  state.authEmail = normalizeEmail(state.realUser?.email || auth.currentUser?.email || "");
  state.effectiveEmail = normalizeEmail(state.currentUser?.email || state.authEmail);

  // IMPORTANTE:
  // usar solo el usuario efectivo, para que "Entrar como" sí respete
  // la vista del vendedor.
  state.canSeeAll = puedeVerGeneral(state.effectiveEmail);

  document.body.classList.toggle(
    "is-vendedor-view",
    String(state.currentUser?.rol || "").toLowerCase() === "vendedor"
  );

  const btnAnalisisLeads =
  $("btnExportarAnalisisLeads");

  if (btnAnalisisLeads) {
    const esVendedor =
      String(
        state.currentUser?.rol || ""
      ).toLowerCase() === "vendedor";
  
    btnAnalisisLeads.style.display =
      esVendedor
        ? "none"
        : "";
  }
}

function bindHeaderActions() {
  bindLayoutButtons({
    homeUrl: "index.html",
    onLogout: async () => {
      try {
        sessionStorage.removeItem(ACTING_USER_KEY);
        await signOut(auth);
        location.href = "login.html";
      } catch (error) {
        alert("Error al cerrar sesión: " + error.message);
      }
    },
    onActAs: async (selectedEmail) => {
      if (!state.realUser || state.realUser.rol !== "admin") return;
      if (!selectedEmail) return;

      sessionStorage.setItem(ACTING_USER_KEY, selectedEmail);
      await bootstrapFromSession();
      renderActingUserSwitcherSimple();
      updateSummaryButtonsUI();
      updateSortHeaderUI();
      await loadSeguimiento();
    },
    onResetActAs: async () => {
      sessionStorage.removeItem(ACTING_USER_KEY);
      await bootstrapFromSession();
      renderActingUserSwitcherSimple();
      updateSummaryButtonsUI();
      updateSortHeaderUI();
      await loadSeguimiento();
    }
  });
}

function renderActingUserSwitcherSimple() {
  const wrap = document.getElementById("admin-switcher");
  const select = document.getElementById("select-acting-user");
  if (!wrap || !select) return;

  if (!state.realUser || state.realUser.rol !== "admin") {
    wrap.classList.add("hidden");
    return;
  }

  wrap.classList.remove("hidden");

  const current = select.value || "";
  const options = VENTAS_USERS
    .map((u) => {
      const nombreCompleto = [u.nombre, u.apellido].filter(Boolean).join(" ");
      return {
        email: u.email,
        label: `${nombreCompleto || u.email} · ${u.rol}`
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label, "es"));

  select.innerHTML = `
    <option value="">Elegir usuario</option>
    ${options.map((opt) => `<option value="${opt.email}">${opt.label}</option>`).join("")}
  `;

  select.value = options.some((opt) => opt.email === state.effectiveEmail)
    ? state.effectiveEmail
    : current;
}

/* =========================================================
   EVENTOS
========================================================= */
function bindEvents() {
  /* =====================================================
     AÑO VIAJE
  ===================================================== */

  $("filtroAno")?.addEventListener(
    "change",
    async (event) => {
      const nuevoAno =
        String(
          event.target.value ||
          getAnoViajePrincipal()
        );

      state.anoSeleccionado =
        nuevoAno;

      await cargarSeleccionAnoSeguimiento(
        nuevoAno
      );
    }
  );


  /* =====================================================
     FILTROS NORMALES
  ===================================================== */

  $("filtroEstado")?.addEventListener(
    "change",
    applyFiltersAndRender
  );

  $("filtroVendedora")?.addEventListener(
    "change",
    applyFiltersAndRender
  );


  /* =====================================================
     FECHA CREACIÓN
  ===================================================== */

  $("filtroFechaCreacion")?.addEventListener(
    "change",
    () => {
      actualizarUIFiltroFechaCreacion();
      applyFiltersAndRender();
    }
  );


  $("filtroFechaDesde")?.addEventListener(
    "change",
    () => {
      applyFiltersAndRender();
    }
  );


  $("filtroFechaHasta")?.addEventListener(
    "change",
    () => {
      applyFiltersAndRender();
    }
  );


  /* =====================================================
     BUSCADOR
  ===================================================== */

  $("buscadorSeguimiento")?.addEventListener(
    "input",
    debounce(
      () => {
        applyFiltersAndRender();
      },
      180
    )
  );


  /* =====================================================
     RECARGAR
  ===================================================== */

  $("btnRecargarSeguimiento")?.addEventListener(
    "click",
    async () => {
      await cargarSeleccionAnoSeguimiento(
        state.anoSeleccionado,
        {
          forzar: true
        }
      );
    }
  );


  /* =====================================================
     EXPORTADORES
  ===================================================== */

  $("btnExportarSeguimiento")?.addEventListener(
    "click",
    exportVisibleRowsToXlsx
  );

  $("btnExportarAnalisisLeads")?.addEventListener(
    "click",
    exportAnalisisLeadsToXlsx
  );


  /* =====================================================
     BOTONES RESUMEN
  ===================================================== */

  document
    .querySelectorAll(
      ".summary-filter"
    )
    .forEach(
      (btn) => {
        btn.addEventListener(
          "click",
          () => {
            const summaryState =
              String(
                btn.dataset.summaryState ||
                ""
              );

            if (!summaryState) {
              return;
            }


            /*
              TOTAL = mostrar todos.
            */
            if (
              summaryState === "__all__"
            ) {
              state.hiddenSummaryStates.clear();

            } else {
              if (
                state.hiddenSummaryStates.has(
                  summaryState
                )
              ) {
                state.hiddenSummaryStates.delete(
                  summaryState
                );

              } else {
                state.hiddenSummaryStates.add(
                  summaryState
                );
              }
            }

            updateSummaryButtonsUI();
            applyFiltersAndRender();
          }
        );
      }
    );


  /* =====================================================
     ORDEN TABLA
  ===================================================== */

  document
    .querySelectorAll(
      ".th-sort"
    )
    .forEach(
      (btn) => {
        btn.addEventListener(
          "click",
          () => {
            const sortKey =
              String(
                btn.dataset.sort ||
                ""
              );

            if (!sortKey) {
              return;
            }


            if (
              state.sortKey === sortKey
            ) {
              state.sortDir =
                state.sortDir === "asc"
                  ? "desc"
                  : "asc";

            } else {
              state.sortKey =
                sortKey;

              state.sortDir =
                "asc";
            }

            updateSortHeaderUI();
            applyFiltersAndRender();
          }
        );
      }
    );


  /*
    Deja la interfaz consistente
    desde la primera carga.
  */
  actualizarUIFiltroFechaCreacion();
}

function updateSummaryButtonsUI() {
  document.querySelectorAll(".summary-filter").forEach((btn) => {
    const summaryState = String(btn.dataset.summaryState || "");

    if (summaryState === "__all__") {
      const allVisible = state.hiddenSummaryStates.size === 0;
      btn.classList.toggle("is-active", allVisible);
      btn.classList.toggle("is-off", !allVisible);
      return;
    }

    const isHidden = state.hiddenSummaryStates.has(summaryState);
    btn.classList.toggle("is-active", !isHidden);
    btn.classList.toggle("is-off", isHidden);
  });
}

function updateSortHeaderUI() {
  document.querySelectorAll(".th-sort").forEach((btn) => {
    const key = String(btn.dataset.sort || "");
    const active = key === state.sortKey;

    btn.classList.toggle("active", active);

    const arrow = btn.querySelector(".sort-arrow");
    if (!arrow) return;

    if (!active) {
      arrow.textContent = "↕";
    } else {
      arrow.textContent = state.sortDir === "asc" ? "↑" : "↓";
    }
  });
}

function getCacheKeySeguimientoAno(
  ano
) {
  return (
    SEGUIMIENTO_CACHE_PREFIX +
    String(ano)
  );
}

function guardarCacheSeguimientoAno(
  ano,
  rows = []
) {
  try {
    sessionStorage.setItem(
      getCacheKeySeguimientoAno(
        ano
      ),
      JSON.stringify({
        guardadoAt:
          Date.now(),

        rows
      })
    );
  } catch (error) {
    console.warn(
      "[seguimiento] no se pudo guardar caché",
      error
    );
  }
}

function leerCacheSeguimientoAno(
  ano
) {
  try {
    const raw =
      sessionStorage.getItem(
        getCacheKeySeguimientoAno(
          ano
        )
      );

    if (!raw) {
      return null;
    }

    const parsed =
      JSON.parse(raw);

    const guardadoAt =
      Number(
        parsed?.guardadoAt || 0
      );

    if (
      !guardadoAt ||
      Date.now() - guardadoAt >
        SEGUIMIENTO_CACHE_TTL_MS
    ) {
      sessionStorage.removeItem(
        getCacheKeySeguimientoAno(
          ano
        )
      );

      return null;
    }

    const rows =
      Array.isArray(parsed?.rows)
        ? parsed.rows
        : [];

    return rows.map(
      (row) => ({
        ...row,

        fechaCreacion:
          toDate(
            row.fechaCreacion
          ),

        ultimaGestionAt:
          toDate(
            row.ultimaGestionAt
          ),

        fechaUltimaReunion:
          toDate(
            row.fechaUltimaReunion
          )
      })
    );

  } catch (error) {
    console.warn(
      "[seguimiento] caché inválida",
      error
    );

    return null;
  }
}

function reconstruirRowsSeguimiento() {
  if (
    state.anoSeleccionado ===
    "todos"
  ) {
    state.allRows =
      getAnosSeguimientoDisponibles()
        .flatMap(
          (ano) =>
            state.rowsPorAno.get(
              String(ano)
            ) || []
        );
  } else {
    state.allRows =
      state.rowsPorAno.get(
        String(
          state.anoSeleccionado
        )
      ) || [];
  }
}

function renderizarSeguimientoCargado() {
  reconstruirRowsSeguimiento();

  state.sortKey =
    "grupo";

  state.sortDir =
    "asc";

  updateSortHeaderUI();

  fillYearFilter();

  fillVendorFilter(
    state.allRows
  );

  applyDashboardPreset();

  updateSummaryButtonsUI();

  applyFiltersAndRender();
}

async function consultarSeguimientoAno(
  ano
) {
  const anoNumero =
    Number(ano);

  if (!anoNumero) {
    throw new Error(
      "Año de seguimiento inválido."
    );
  }

  const inicio =
    performance.now();

  const snap =
    await getDocs(
      query(
        collection(
          db,
          GRUPOS_RESUMEN_COLLECTION
        ),

        where(
          "anoViaje",
          "==",
          anoNumero
        )
      )
    );

  const rows =
    snap.docs.map(
      (docSnap) =>
        mapClienteDoc(
          docSnap.id,
          docSnap.data() || {}
        )
    );

  console.log(
    "[seguimiento] año consultado",
    {
      ano:
        anoNumero,

      documentos:
        snap.size,

      firestoreMs:
        Math.round(
          performance.now() -
          inicio
        )
    }
  );

  return rows;
}

async function cargarAnoSeguimiento(
  ano,
  {
    forzar = false,
    permitirCache = true
  } = {}
) {
  const anoTexto =
    String(ano);

  if (
    !forzar &&
    state.rowsPorAno.has(
      anoTexto
    )
  ) {
    return {
      rows:
        state.rowsPorAno.get(
          anoTexto
        ) || [],

      origen:
        "memoria"
    };
  }

  if (
    !forzar &&
    permitirCache
  ) {
    const rowsCache =
      leerCacheSeguimientoAno(
        anoTexto
      );

    if (rowsCache) {
      state.rowsPorAno.set(
        anoTexto,
        rowsCache
      );

      state.anosCargados.add(
        anoTexto
      );

      return {
        rows:
          rowsCache,

        origen:
          "sessionStorage"
      };
    }
  }

  const rows =
    await consultarSeguimientoAno(
      anoTexto
    );

  state.rowsPorAno.set(
    anoTexto,
    rows
  );

  state.anosCargados.add(
    anoTexto
  );

  guardarCacheSeguimientoAno(
    anoTexto,
    rows
  );

  return {
    rows,
    origen:
      "firestore"
  };
}

async function actualizarAnoEnSegundoPlano(
  ano
) {
  try {
    await cargarAnoSeguimiento(
      ano,
      {
        forzar: true,
        permitirCache: false
      }
    );

    /*
      Solo redibujamos si el usuario
      sigue viendo ese mismo año.
    */
    if (
      state.anoSeleccionado ===
      String(ano)
    ) {
      renderizarSeguimientoCargado();
    }
  } catch (error) {
    console.warn(
      "[seguimiento] no se pudo refrescar en segundo plano",
      error
    );
  }
}

async function cargarSeleccionAnoSeguimiento(
  valor,
  {
    forzar = false
  } = {}
) {
  if (state.cargaEnCurso) {
    return;
  }

  state.cargaEnCurso =
    true;

  state.anoSeleccionado =
    String(
      valor ||
      getAnoViajePrincipal()
    );

  const anosObjetivo =
    state.anoSeleccionado ===
    "todos"
      ? getAnosSeguimientoDisponibles()
      : [
          Number(
            state.anoSeleccionado
          )
        ];

  const hayTodoEnMemoria =
    anosObjetivo.every(
      (ano) =>
        state.rowsPorAno.has(
          String(ano)
        )
    );

  if (!hayTodoEnMemoria) {
    renderEmpty(
      state.anoSeleccionado ===
        "todos"
        ? "Cargando todos los años activos..."
        : `Cargando grupos ${state.anoSeleccionado}...`
    );
  }

  try {
    const resultados =
      await Promise.all(
        anosObjetivo.map(
          (ano) =>
            cargarAnoSeguimiento(
              ano,
              {
                forzar,
                permitirCache: true
              }
            )
        )
      );

    renderizarSeguimientoCargado();

    /*
      Si se mostró una copia de sessionStorage,
      actualizamos ese año sin bloquear la pantalla.
    */
    resultados.forEach(
      (resultado, index) => {
        if (
          resultado.origen ===
          "sessionStorage" &&
          !forzar
        ) {
          actualizarAnoEnSegundoPlano(
            anosObjetivo[index]
          );
        }
      }
    );
  } catch (error) {
    console.error(
      "[seguimiento] error cargando selección:",
      error
    );

    renderEmpty(
      "No se pudieron cargar los grupos."
    );
  } finally {
    state.cargaEnCurso =
      false;
  }
}

/* =========================================================
   CARGA PRINCIPAL
========================================================= */
async function loadSeguimiento() {
  const preset =
    getDashboardQueryPreset();

  state.dashboardPreset =
    preset;

  const anosDisponibles =
    getAnosSeguimientoDisponibles();

  const anoPreset =
    Number(
      preset.ano || 0
    );

  const anoInicial =
    anosDisponibles.includes(
      anoPreset
    )
      ? String(anoPreset)
      : String(
          getAnoViajePrincipal()
        );

  state.anoSeleccionado =
    anoInicial;

  fillYearFilter();

  const filtroAno =
    $("filtroAno");

  if (filtroAno) {
    filtroAno.value =
      anoInicial;
  }

  await cargarSeleccionAnoSeguimiento(
    anoInicial
  );
}

/* =========================================================
   MAPEO DE DATOS
========================================================= */
function mapClienteDoc(id, data) {
  const aliasGrupo =
    cleanText(
      data.aliasGrupo
    );

  const nombreApoderado =
    cleanText(
      data.nombreCliente ||
      data.nombreApoderado ||
      data.apoderado ||
      ""
    );

  const nombreGrupo =
    cleanText(
      data.nombreGrupo ||
      data.colegio ||
      ""
    );

  const colegio =
    cleanText(
      data.colegio
    );

  const curso =
    cleanText(
      data.curso
    );

  const anoViaje =
    Number(
      data.anoViaje || 0
    ) || 0;

  const numeroNegocio =
    cleanText(
      data.numeroNegocio ||
      data.numero_negocio ||
      ""
    );

  const fichaComercial =
    data.fichaComercial || {};

  const programa =
    cleanText(
      data.nombrePrograma ||
      data.programa ||
      fichaComercial.nombrePrograma ||
      fichaComercial.programa ||
      ""
    );

  /*
    Pax comercial contratado.

    Priorizamos el nuevo resumen.
    Si no existe, mantenemos compatibilidad
    con documentos antiguos.
  */
  const paxContratados =
    Number(
      data.paxContratados ||
      data.numeroPaxTotal ||
      fichaComercial.numeroPaxTotal ||
      data.cantidadGrupo ||
      0
    ) || 0;

  const cantidadGrupo =
    paxContratados;

  const fechaCreacion =
    toDate(
      data.fechaCreacion ||
      null
    );

  const destino =
    cleanText(
      data.destinoPrincipal ||
      fichaComercial.destinoPrincipal ||
      data.destino ||
      "Sin destino"
    );

  const estado =
    normalizeEstado(
      data.estado ||
      data.estadoGrupo ||
      data.estadoComercial ||
      data.etapaComercial
    );

  const visualFicha =
    resolveFichaVisualState(
      data
    );

  const autorizada =
    visualFicha.autorizadaVisual;

  const cerrada =
    visualFicha.fichaCerrada;

  const imagen =
    cleanText(
      data.imagen ||
      data.imagenUrl ||
      ""
    );

  const ultimaGestionAt =
    toDate(
      data.ultimaGestionAt ||
      data.fechaActualizacion ||
      data.actualizadoEl ||
      data.updatedAt ||
      data.fechaCreacion ||
      null
    );

  const fechaUltimaReunion =
    toDate(
      data.fechaUltimaReunion ||
      data.ultimaReunion ||
      data.fechaReunion ||
      null
    );

  const vendedora =
    cleanText(
      data.vendedora ||
      ""
    );

  const vendedoraCorreo =
    normalizeEmail(
      data.vendedoraCorreo ||
      ""
    );

  const fichaPdfUrl =
    cleanText(
      data.fichaPdfUrl ||
      data?.ficha?.pdfUrl ||
      data?.ficha?.urlPdf ||
      ""
    );

  const fichaMedicaEstado =
    normalizeDocState(
      data.fichaMedicaEstado
    );

  const nominaEstado =
    normalizeDocState(
      data.nominaEstado
    );

  const fichaEstado =
    fichaPdfUrl
      ? "ok"
      : normalizeDocState(
          data.fichaEstado ||
          data?.documentos?.fichaGrupo?.estado ||
          data?.ficha?.estado ||
          ""
        );

  const contratoEstado =
    normalizeDocState(
      data.contratoEstado
    );

  const cortesiaEstado =
    normalizeDocState(
      data.cortesiaEstado
    );


  /* =====================================================
     NUEVA INFORMACIÓN COMERCIAL
  ===================================================== */

  const categoriaHoteleraContratada =
    cleanText(
      data.categoriaHoteleraContratada ||
      fichaComercial.categoriaHoteleraContratada ||
      ""
    );

  const valorPrograma =
    cleanText(
      data.valorPrograma ??
      fichaComercial.valorPrograma ??
      ""
    );

  const valorProgramaNumero =
    Number(
      data.valorProgramaNumero ??
      fichaComercial.valorProgramaNumero ??
      0
    ) || 0;

  const liberados =
    cleanText(
      data.liberados ??
      fichaComercial.liberados ??
      ""
    );

  const liberadosCantidad =
    Number(
      data.liberadosCantidad ??
      fichaComercial.liberadosCantidad ??
      0
    ) || 0;

  const tramoSeleccion =
    cleanText(
      data.tramoSeleccion ||
      fichaComercial.tramoSeleccion ||
      data.tramo ||
      fichaComercial.tramo ||
      ""
    );

  const tramoOtro =
    cleanText(
      data.tramoOtro ||
      fichaComercial.tramoOtro ||
      ""
    );

  const tramo =
    cleanText(
      data.tramo ||
      fichaComercial.tramo ||
      tramoSeleccion ||
      ""
    );

  const mesViaje =
    cleanText(
      data.mesViaje ||
      fichaComercial.mesViaje ||
      ""
    );

  const mesViajeOtro =
    cleanText(
      data.mesViajeOtro ||
      fichaComercial.mesViajeOtro ||
      ""
    );

  const fechaViajeTexto =
    cleanText(
      data.fechaViajeTexto ||
      fichaComercial.fechaViajeTexto ||
      data.semanaViaje ||
      mesViajeOtro ||
      mesViaje ||
      ""
    );

  const asistenciaEnViajes =
    cleanText(
      data.asistenciaEnViajes ||
      fichaComercial.asistenciaEnViajes ||
      ""
    );

  const solicitudReserva =
    cleanText(
      data.solicitudReserva ||
      fichaComercial.solicitudReserva ||
      ""
    );

  const autorizacionGerencia =
    cleanText(
      data.autorizacionGerencia ||
      fichaComercial.autorizacionGerencia ||
      ""
    );

  const descuentoValorBase =
    cleanText(
      data.descuentoValorBase ??
      fichaComercial.descuentoValorBase ??
      ""
    );


  const displayTitleRaw =
    aliasGrupo ||
    nombreApoderado ||
    nombreGrupo ||
    `Grupo ${id}`;

  const displayTitle =
    buildGrupoDisplayTitle(
      displayTitleRaw,
      colegio || nombreGrupo
    );

  const grupoSortTitle =
    buildGrupoSortTitle(
      displayTitle,
      colegio || nombreGrupo
    );

  const subtitleParts = [];

  if (numeroNegocio) {
    subtitleParts.push(
      `Negocio ${numeroNegocio}`
    );
  }

  if (anoViaje) {
    subtitleParts.push(
      `Año ${anoViaje}`
    );
  }

  return {
    id,

    idGrupo:
      cleanText(
        data.idGrupo ||
        id
      ),

    aliasGrupo,
    nombreApoderado,
    nombreGrupo,
    colegio,
    curso,
    anoViaje,

    numeroNegocio,
    programa,

    cantidadGrupo,
    paxContratados,

    fechaCreacion,

    destino,
    estado,
    autorizada,
    cerrada,
    imagen,

    ultimaGestionAt,
    fechaUltimaReunion,

    vendedora,
    vendedoraCorreo,

    fichaMedicaEstado,
    nominaEstado,
    fichaEstado,
    fichaPdfUrl,
    contratoEstado,
    cortesiaEstado,

    /*
      Información comercial nueva.
    */
    categoriaHoteleraContratada,

    valorPrograma,
    valorProgramaNumero,

    liberados,
    liberadosCantidad,

    tramo,
    tramoSeleccion,
    tramoOtro,

    mesViaje,
    mesViajeOtro,
    fechaViajeTexto,

    asistenciaEnViajes,
    solicitudReserva,
    autorizacionGerencia,
    descuentoValorBase,

    displayTitle,
    displayTitleRaw,
    grupoSortTitle,
    subtitleParts,

    hasAlias:
      !!aliasGrupo,

    avatarBaseText:
      colegio ||
      nombreGrupo ||
      nombreApoderado ||
      displayTitle,

    searchIndex:
      buildSearchIndex([
        data.busquedaTexto || "",

        id,
        data.idGrupo || "",
        data.groupDocId || "",

        numeroNegocio,
        data.codigo || "",

        aliasGrupo,
        nombreApoderado,
        nombreGrupo,
        colegio,
        curso,

        destino,
        programa,

        categoriaHoteleraContratada,
        fechaViajeTexto,
        tramo,

        valorPrograma,
        liberados,
        asistenciaEnViajes,

        data.comunaCiudad || "",

        data.nombreCliente || "",
        data.nombreCliente2 || "",

        data.correoCliente || "",
        data.correoCliente2 || "",

        data.celularCliente || "",
        data.celularCliente2 || "",

        vendedora,
        vendedoraCorreo,

        cantidadGrupo,
        anoViaje
      ])
  };
}

/* =========================================================
   FILTRO FECHA CREACIÓN
========================================================= */

function actualizarUIFiltroFechaCreacion() {
  const tipo =
    $("filtroFechaCreacion")?.value ||
    "todas";

  const custom =
    $("filtroFechaCreacionPersonalizado");

  if (!custom) {
    return;
  }

  custom.hidden =
    tipo !== "personalizado";
}


/*
  Convierte YYYY-MM-DD del input HTML
  a fecha LOCAL.

  Evitamos new Date("2026-09-03")
  porque puede interpretarse como UTC
  y desplazar la fecha según zona horaria.
*/
function parseFechaInputLocal(
  value,
  finalDelDia = false
) {
  const raw =
    String(
      value || ""
    ).trim();

  const match =
    raw.match(
      /^(\d{4})-(\d{2})-(\d{2})$/
    );

  if (!match) {
    return null;
  }

  const year =
    Number(match[1]);

  const month =
    Number(match[2]) - 1;

  const day =
    Number(match[3]);


  if (finalDelDia) {
    return new Date(
      year,
      month,
      day,
      23,
      59,
      59,
      999
    );
  }


  return new Date(
    year,
    month,
    day,
    0,
    0,
    0,
    0
  );
}


/*
  Devuelve el rango activo:

  {
    desde: Date | null,
    hasta: Date | null
  }
*/
function getRangoFechaCreacionActivo() {
  const tipo =
    $("filtroFechaCreacion")?.value ||
    "todas";


  /*
    Sin filtro.
  */
  if (tipo === "todas") {
    return {
      desde: null,
      hasta: null
    };
  }


  const hoy =
    new Date();

  const inicioHoy =
    new Date(
      hoy.getFullYear(),
      hoy.getMonth(),
      hoy.getDate(),
      0,
      0,
      0,
      0
    );

  const finHoy =
    new Date(
      hoy.getFullYear(),
      hoy.getMonth(),
      hoy.getDate(),
      23,
      59,
      59,
      999
    );


  /* =====================================================
     ÚLTIMOS 30 DÍAS
     Incluye hoy + 29 días anteriores.
  ===================================================== */

  if (
    tipo === "ultimos_30"
  ) {
    const desde =
      new Date(
        inicioHoy
      );

    desde.setDate(
      desde.getDate() - 29
    );

    return {
      desde,
      hasta:
        finHoy
    };
  }


  /* =====================================================
     ÚLTIMOS 90 DÍAS
     Incluye hoy + 89 días anteriores.
  ===================================================== */

  if (
    tipo === "ultimos_90"
  ) {
    const desde =
      new Date(
        inicioHoy
      );

    desde.setDate(
      desde.getDate() - 89
    );

    return {
      desde,
      hasta:
        finHoy
    };
  }


  /* =====================================================
     ESTE MES
  ===================================================== */

  if (
    tipo === "este_mes"
  ) {
    const desde =
      new Date(
        hoy.getFullYear(),
        hoy.getMonth(),
        1,
        0,
        0,
        0,
        0
      );

    return {
      desde,
      hasta:
        finHoy
    };
  }


  /* =====================================================
     MES ANTERIOR COMPLETO
  ===================================================== */

  if (
    tipo === "mes_anterior"
  ) {
    const desde =
      new Date(
        hoy.getFullYear(),
        hoy.getMonth() - 1,
        1,
        0,
        0,
        0,
        0
      );

    const hasta =
      new Date(
        hoy.getFullYear(),
        hoy.getMonth(),
        0,
        23,
        59,
        59,
        999
      );

    return {
      desde,
      hasta
    };
  }


  /* =====================================================
     ENTRE FECHAS
  ===================================================== */

  if (
    tipo === "personalizado"
  ) {
    let desde =
      parseFechaInputLocal(
        $("filtroFechaDesde")?.value,
        false
      );

    let hasta =
      parseFechaInputLocal(
        $("filtroFechaHasta")?.value,
        true
      );


    /*
      Si accidentalmente ponen:
      Desde 20/09
      Hasta 10/09

      intercambiamos automáticamente.
    */
    if (
      desde &&
      hasta &&
      desde.getTime() >
        hasta.getTime()
    ) {
      const desdeOriginal =
        desde;

      desde =
        new Date(
          hasta.getFullYear(),
          hasta.getMonth(),
          hasta.getDate(),
          0,
          0,
          0,
          0
        );

      hasta =
        new Date(
          desdeOriginal.getFullYear(),
          desdeOriginal.getMonth(),
          desdeOriginal.getDate(),
          23,
          59,
          59,
          999
        );
    }


    return {
      desde,
      hasta
    };
  }


  return {
    desde: null,
    hasta: null
  };
}

/* =========================================================
   FILTROS
========================================================= */
function applyFiltersAndRender() {
  const filtroAno =
    $("filtroAno")?.value ||
    "todos";

  const filtroEstado =
    $("filtroEstado")?.value ||
    "todos";

  const filtroVendedora =
    $("filtroVendedora")?.value ||
    "todos";

  const search =
    normalizeText(
      $("buscadorSeguimiento")?.value ||
      ""
    );


  /*
    Nuevo filtro de fecha de creación.
  */
  const rangoFechaCreacion =
    getRangoFechaCreacionActivo();


  const currentVendorFullName =
    normalizeText(
      [
        state.currentUser?.nombre,
        state.currentUser?.apellido
      ]
        .filter(Boolean)
        .join(" ")
    );


  const rawAliases =
    state.currentUser?.aliasCartera ??
    state.currentUser?.aliascartera ??
    [];


  const currentVendorAliases =
    Array.isArray(
      rawAliases
    )
      ? rawAliases.map(
          normalizeText
        )
      : (
          rawAliases
            ? [
                normalizeText(
                  rawAliases
                )
              ]
            : []
        );


  const currentVendorEmails =
    getVentasUserEmails(
      state.currentUser
    );


  let rows =
    [...state.allRows];


  /* =====================================================
     RESTRICCIÓN POR ROL
  ===================================================== */

  rows =
    rows.filter(
      (row) => {
        if (state.canSeeAll) {
          return true;
        }


        const rowVendorEmail =
          normalizeEmail(
            row.vendedoraCorreo
          );

        const rowVendorName =
          normalizeText(
            row.vendedora
          );


        if (
          rowVendorEmail &&
          currentVendorEmails.includes(
            rowVendorEmail
          )
        ) {
          return true;
        }


        if (
          currentVendorFullName &&
          rowVendorName.includes(
            currentVendorFullName
          )
        ) {
          return true;
        }


        if (
          currentVendorAliases.length
        ) {
          return currentVendorAliases.some(
            (alias) =>
              rowVendorName.includes(
                alias
              )
          );
        }


        return false;
      }
    );


  /* =====================================================
     FILTRO AÑO VIAJE
  ===================================================== */

  rows =
    rows.filter(
      (row) => {
        const anoViaje =
          Number(
            row.anoViaje || 0
          );


        if (
          !anoViaje ||
          anoViaje <
            getAnoComercialActual()
        ) {
          return false;
        }


        if (
          filtroAno === "todos"
        ) {
          return true;
        }


        return (
          String(
            anoViaje
          ) ===
          String(
            filtroAno
          )
        );
      }
    );


  /* =====================================================
     NUEVO:
     FILTRO FECHA CREACIÓN DEL LEAD
  ===================================================== */

  rows =
    rows.filter(
      (row) => {
        const {
          desde,
          hasta
        } =
          rangoFechaCreacion;


        /*
          Si no existe rango activo,
          no filtramos.
        */
        if (
          !desde &&
          !hasta
        ) {
          return true;
        }


        const fechaCreacion =
          toDate(
            row.fechaCreacion
          );


        /*
          Si estamos filtrando por fecha
          y el lead no tiene fechaCreacion,
          no puede pertenecer al período.
        */
        if (!fechaCreacion) {
          return false;
        }


        const time =
          fechaCreacion.getTime();


        if (
          desde &&
          time <
            desde.getTime()
        ) {
          return false;
        }


        if (
          hasta &&
          time >
            hasta.getTime()
        ) {
          return false;
        }


        return true;
      }
    );


  /* =====================================================
     FILTRO ESTADO
  ===================================================== */

  rows =
    rows.filter(
      (row) => {
        if (
          filtroEstado === "todos"
        ) {
          return true;
        }

        return (
          row.estado ===
          filtroEstado
        );
      }
    );


  /* =====================================================
     FILTRO DASHBOARD
  ===================================================== */

  rows =
    rows.filter(
      (row) => {
        const bucket =
          state.dashboardPreset?.bucket ||
          "";

        if (!bucket) {
          return true;
        }


        if (
          bucket === "a_contactar"
        ) {
          return (
            row.estado ===
            "a_contactar"
          );
        }


        if (
          bucket === "contactados"
        ) {
          return (
            row.estado ===
            "contactado"
          );
        }


        if (
          bucket === "autorizadas"
        ) {
          return (
            !!row.autorizada
          );
        }


        if (
          bucket === "cerradas"
        ) {
          return (
            !!row.cerrada
          );
        }


        return true;
      }
    );


  /* =====================================================
     FILTRO VENDEDOR
  ===================================================== */

  rows =
    rows.filter(
      (row) => {
        if (!state.canSeeAll) {
          return true;
        }


        if (
          filtroVendedora ===
          "todos"
        ) {
          return true;
        }


        const vendorFilter =
          normalizeText(
            filtroVendedora
          );


        return (
          normalizeEmail(
            row.vendedoraCorreo
          ) ===
            normalizeEmail(
              filtroVendedora
            ) ||

          normalizeText(
            row.vendedora
          ) ===
            vendorFilter
        );
      }
    );


  /* =====================================================
     BUSCADOR
  ===================================================== */

  rows =
    rows.filter(
      (row) => {
        if (!search) {
          return true;
        }

        return (
          row.searchIndex.includes(
            search
          )
        );
      }
    );


  /*
    Este conjunto alimenta
    el resumen superior.
  */
  state.filteredRows =
    rows;


  renderSummary(
    rows
  );

  updateSummaryButtonsUI();


  /* =====================================================
     BOTONES RESUMEN
  ===================================================== */

  rows =
    rows.filter(
      (row) => {
        const bucket =
          getSummaryBucket(
            row.estado
          );

        return (
          !state.hiddenSummaryStates.has(
            bucket
          )
        );
      }
    );


  /* =====================================================
     ORDEN FINAL
  ===================================================== */

  const sortKey =
    state.sortKey ||
    "grupo";

  const sortDir =
    state.sortDir ||
    "asc";


  rows.sort(
    (a, b) =>
      compareRows(
        a,
        b,
        sortKey,
        sortDir
      )
  );


  /*
    ESTO ES LO IMPORTANTE:

    Ambas exportaciones utilizan
    state.visibleRows.

    Por lo tanto desde ahora
    también respetarán el período
    de creación seleccionado.
  */
  state.visibleRows =
    rows;


  renderRows(
    rows
  );
}

/* =========================================================
   RENDER
========================================================= */
function renderRows(rows) {
  const tbody = $("tbodySeguimiento");
  if (!tbody) return;

  if (!rows.length) {
    renderEmpty("No hay grupos para los filtros seleccionados.");
    return;
  }

  tbody.innerHTML = rows.map(renderRow).join("");
}

function renderRow(row) {
  const progressHtml =
    renderProgress(
      row.estado
    );

  const docsHtml =
    renderDocs(
      row
    );

  const avatarHtml =
    renderAvatar(
      row
    );

  const fechaCreacion =
    formatDateRelative(
      row.fechaCreacion,
      "Sin fecha"
    );

  const ultimaGestion =
    formatDateRelative(
      row.ultimaGestionAt,
      "Sin registro"
    );

  const ultimaReunion =
    formatDateTime(
      row.fechaUltimaReunion,
      "Sin reunión"
    );

  const programa =
    cleanText(
      row.programa ||
      ""
    );

  const cantidadGrupo =
    Number(
      row.cantidadGrupo || 0
    ) || 0;

  return `
    <tr>

      <!-- ===================================================
           GRUPO
      ==================================================== -->
      <td>
        <a
          class="seg-group-link"
          href="grupo.html?id=${encodeURIComponent(row.idGrupo || row.id)}"
          target="_blank"
          rel="noopener noreferrer"
        >
          <div class="seg-avatar">
            ${avatarHtml}
          </div>

          <div class="seg-group-info">

            <div
              class="seg-group-title"
              title="${escapeAttr(row.displayTitleRaw || row.displayTitle)}"
            >
              ${escapeHtml(row.displayTitle)}
            </div>

            <div class="seg-group-sub">
              ${
                row.subtitleParts
                  .map(
                    (part) =>
                      `<span>${escapeHtml(part)}</span>`
                  )
                  .join("")
              }
            </div>

          </div>
        </a>
      </td>


      <!-- ===================================================
           VENDEDOR
      ==================================================== -->
      <td
        class="td-vendedor"
        title="${escapeAttr(row.vendedora || row.vendedoraCorreo || "—")}"
      >
        ${escapeHtml(row.vendedora || row.vendedoraCorreo || "—")}
      </td>


      <!-- ===================================================
           DESTINO + PROGRAMA
      ==================================================== -->
      <td
        class="seg-destino"
        title="${escapeAttr(row.destino || "Sin destino")}"
      >
        <div>
          ${escapeHtml(row.destino || "Sin destino")}
        </div>

        ${
          programa
            ? `
              <small class="seg-cell-sub">
                ${escapeHtml(programa)}
              </small>
            `
            : ""
        }
      </td>


      <!-- ===================================================
           PAX
      ==================================================== -->
      <td class="seg-pax">
        ${
          cantidadGrupo
            ? escapeHtml(
                String(
                  cantidadGrupo
                )
              )
            : "—"
        }
      </td>


      <!-- ===================================================
           FECHA CREACIÓN
      ==================================================== -->
      <td class="seg-date">
        ${escapeHtml(fechaCreacion.main)}

        <small>
          ${escapeHtml(fechaCreacion.sub)}
        </small>
      </td>


      <!-- ===================================================
           SEGUIMIENTO
      ==================================================== -->
      <td>
        ${progressHtml}
      </td>


      <!-- ===================================================
           AUTORIZADA
      ==================================================== -->
      <td>
        ${
          row.autorizada
            ? `
              <span class="seg-badge seg-badge-blue">
                Autorizada
              </span>
            `
            : `
              <span class="seg-badge seg-badge-muted">
                —
              </span>
            `
        }
      </td>


      <!-- ===================================================
           CERRADA
      ==================================================== -->
      <td>
        ${
          row.cerrada
            ? `
              <span class="seg-badge seg-badge-green-dark">
                Cerrada
              </span>
            `
            : `
              <span class="seg-badge seg-badge-muted">
                —
              </span>
            `
        }
      </td>


      <!-- ===================================================
           ÚLTIMA GESTIÓN
      ==================================================== -->
      <td class="seg-date">
        ${escapeHtml(ultimaGestion.main)}

        <small>
          ${escapeHtml(ultimaGestion.sub)}
        </small>
      </td>


      <!-- ===================================================
           ÚLTIMA REUNIÓN
      ==================================================== -->
      <td class="seg-date">
        ${escapeHtml(ultimaReunion.main)}

        <small>
          ${escapeHtml(ultimaReunion.sub)}
        </small>
      </td>


      <!-- ===================================================
           DOCUMENTOS
      ==================================================== -->
      <td>
        <div class="seg-docs">
          ${docsHtml}
        </div>
      </td>

    </tr>
  `;
}

function renderProgress(estado) {
  const meta = STAGE_META[estado] || STAGE_META.a_contactar;
  const blocks = [];

  for (let i = 1; i <= 5; i++) {
    const fillClass = i <= meta.steps ? meta.fillClass : "";
    blocks.push(`<span class="seg-step ${fillClass}"></span>`);
  }

  return `
    <div class="seg-progress-wrap">
      <div class="seg-progress-bar">${blocks.join("")}</div>
      <div class="seg-progress-label" title="${escapeAttr(meta.label)}">${escapeHtml(meta.label)}</div>
    </div>
  `;
}

function renderDocs(row) {
  return DOCS_META.map((item) => {
    const value = row[item.key];
    const css = getDocCss(value);
    const label = getDocLabel(value);

    // Solo la ficha del grupo lleva link directo al PDF cuando existe.
    if (item.key === "fichaEstado" && row.fichaPdfUrl) {
      return `
        <a
          class="seg-doc ${css}"
          href="${escapeAttr(row.fichaPdfUrl)}"
          target="_blank"
          rel="noopener noreferrer"
          title="${escapeAttr(item.label)} · ${escapeAttr(label)}"
          aria-label="${escapeAttr(item.label)}"
        >${item.icon}</a>
      `;
    }

    return `
      <span
        class="seg-doc ${css}"
        title="${escapeAttr(item.label)} · ${escapeAttr(label)}"
        aria-label="${escapeAttr(item.label)}"
      >${item.icon}</span>
    `;
  }).join("");
}

function renderAvatar(row) {
  if (row.imagen) {
    return `
      <img
        src="${escapeAttr(row.imagen)}"
        alt="${escapeAttr(row.displayTitle)}"
        onerror="this.parentNode.textContent='${escapeJs(getInitials(row.avatarBaseText || row.displayTitle))}'"
      />
    `;
  }

  return escapeHtml(getInitials(row.avatarBaseText || row.displayTitle));
}

function renderSummary(rows) {
  const totals = {
    total: rows.length,
    a_contactar: 0,
    contactado: 0,
    cotizando: 0,
    reunion_confirmada: 0,
    ganada: 0,
    perdida: 0
  };

  for (const row of rows) {
    const bucket = getSummaryBucket(row.estado);

    if (bucket === "a_contactar") totals.a_contactar++;
    else if (bucket === "contactado") totals.contactado++;
    else if (bucket === "cotizando") totals.cotizando++;
    else if (bucket === "reunion_confirmada") totals.reunion_confirmada++;
    else if (bucket === "ganada") totals.ganada++;
    else if (bucket === "perdida") totals.perdida++;
  }

  setText("sumTotal", totals.total);
  setText("sumAContactar", totals.a_contactar);
  setText("sumContactado", totals.contactado);
  setText("sumCotizando", totals.cotizando);
  setText("sumReunion", totals.reunion_confirmada);
  setText("sumGanadas", totals.ganada);
  setText("sumPerdidas", totals.perdida);
}

function renderEmpty(message) {
  const tbody =
    $("tbodySeguimiento");

  if (!tbody) {
    return;
  }

  const colspan =
    document.body.classList.contains(
      "is-vendedor-view"
    )
      ? 10
      : 11;

  tbody.innerHTML = `
    <tr>
      <td
        colspan="${colspan}"
        class="seg-empty"
      >
        ${escapeHtml(message)}
      </td>
    </tr>
  `;
}

async function obtenerPrimeraAsignacionHistorica(
  idGrupo
) {
  try {
    const snap =
      await getDocs(
        collection(
          db,
          "ventas_cotizaciones",
          String(idGrupo),
          "historialAsignaciones"
        )
      );

    if (snap.empty) {
      return null;
    }

    const movimientos =
      snap.docs
        .map(
          (docSnap) => {
            const data =
              docSnap.data() || {};

            return {
              ...data,
              _fecha:
                toDate(
                  data.fecha
                )
            };
          }
        )
        .filter(
          (item) => {
            const tipo =
              normalizeText(
                item.tipo || ""
              );

            /*
              Queremos una ASIGNACIÓN real,
              no recomendación,
              reasignación o desasignación.
            */
            return (
              tipo === "asignacion" ||
              tipo === "asignación"
            );
          }
        )
        .filter(
          (item) =>
            !!item._fecha
        )
        .sort(
          (a, b) =>
            a._fecha.getTime() -
            b._fecha.getTime()
        );

    if (!movimientos.length) {
      return null;
    }

    const primera =
      movimientos[0];

    return {
      fechaAsignacion:
        primera._fecha,

      vendedorAsignadoInicial:
        cleanText(
          primera.nuevaVendedora ||
          ""
        ),

      vendedorAsignadoInicialCorreo:
        normalizeEmail(
          primera.nuevaVendedoraCorreo ||
          ""
        )
    };

  } catch (error) {
    console.warn(
      `[seguimiento] no se pudo recuperar historial de asignación ${idGrupo}`,
      error
    );

    return null;
  }
}

async function exportAnalisisLeadsToXlsx() {
  const boton =
    $("btnExportarAnalisisLeads");

  try {
    /* =====================================================
       SEGURIDAD POR ROL
    ===================================================== */

    const esVendedor =
      String(
        state.currentUser?.rol || ""
      ).toLowerCase() === "vendedor";

    if (esVendedor) {
      alert(
        "Tu perfil no tiene permisos para exportar el análisis de leads."
      );
      return;
    }

    if (typeof XLSX === "undefined") {
      alert(
        "No se encontró la librería XLSX."
      );
      return;
    }

    /*
      Usamos los grupos visibles.

      Se respetan:
      - año
      - vendedor
      - estado
      - búsqueda
      - filtros del dashboard
      - botones de resumen
    */
    const gruposVisibles =
      [...state.visibleRows];

    if (!gruposVisibles.length) {
      alert(
        "No hay grupos visibles para generar el análisis."
      );
      return;
    }

    if (boton) {
      boton.disabled = true;

      boton.dataset.textoOriginal =
        boton.textContent || "";

      boton.textContent =
        "Generando análisis...";
    }


    /* =====================================================
       TRAER DOCUMENTOS ORIGINALES
    ===================================================== */

    const registros =
      await Promise.all(
        gruposVisibles.map(
          async (row) => {
            const idGrupo =
              String(
                row.idGrupo ||
                row.id ||
                ""
              ).trim();

            if (!idGrupo) {
              return construirRegistroLead(
                row,
                {}
              );
            }

            try {
              const snap =
                await getDoc(
                  doc(
                    db,
                    "ventas_cotizaciones",
                    idGrupo
                  )
                );

              const data =
                snap.exists()
                  ? snap.data() || {}
                  : {};


              /*
                Para registros nuevos,
                fechaAsignacion vive en el grupo.

                Para antiguos,
                reconstruimos desde historial.
              */
              let asignacionHistorica =
                null;

              if (!data.fechaAsignacion) {
                asignacionHistorica =
                  await obtenerPrimeraAsignacionHistorica(
                    idGrupo
                  );
              }


              return construirRegistroLead(
                row,
                data,
                asignacionHistorica
              );

            } catch (error) {
              console.warn(
                `[seguimiento] no se pudo cargar cotización ${idGrupo}`,
                error
              );

              /*
                No abortamos todo el informe
                por un solo documento.
              */
              return construirRegistroLead(
                row,
                {}
              );
            }
          }
        )
      );


    /* =====================================================
       ORDEN CRONOLÓGICO
    ===================================================== */

    registros.sort(
      (a, b) => {
        const fechaA =
          a._fechaCreacion
            ? a._fechaCreacion.getTime()
            : Number.MAX_SAFE_INTEGER;

        const fechaB =
          b._fechaCreacion
            ? b._fechaCreacion.getTime()
            : Number.MAX_SAFE_INTEGER;

        return fechaA - fechaB;
      }
    );


    /* =====================================================
       HOJAS
    ===================================================== */

    const detalle =
      registros.map(
        registroLeadParaExcel
      );

    const resumenMensual =
      construirResumenMensualLeads(
        registros
      );

    const resumenVendedores =
      construirResumenVendedoresLeads(
        registros
      );

    const resumenOrigen =
      construirResumenOrigenLeads(
        registros
      );

    const resumenRolContacto =
      construirResumenRolContactos(
        registros
      );

    const resumenCalidad =
      construirResumenCalidadLeads(
        registros
      );

    /*
      Nuevos análisis comerciales.
    */
    const resumenDestino =
      construirResumenDestinoLeads(
        registros
      );

    const resumenTemporada =
      construirResumenTemporadaLeads(
        registros
      );

    const resumenHoteleria =
      construirResumenHoteleriaLeads(
        registros
      );

    const resumenGanadas =
      construirResumenGanadasLeads(
        registros
      );


    /* =====================================================
       CREAR LIBRO
    ===================================================== */

    const wb =
      XLSX.utils.book_new();


    const wsDetalle =
      XLSX.utils.json_to_sheet(
        detalle
      );

    const wsMensual =
      XLSX.utils.json_to_sheet(
        resumenMensual
      );

    const wsVendedores =
      XLSX.utils.json_to_sheet(
        resumenVendedores
      );

    const wsOrigen =
      XLSX.utils.json_to_sheet(
        resumenOrigen
      );

    const wsRolContacto =
      XLSX.utils.json_to_sheet(
        resumenRolContacto
      );

    const wsCalidad =
      XLSX.utils.json_to_sheet(
        resumenCalidad
      );

    const wsDestino =
      XLSX.utils.json_to_sheet(
        resumenDestino
      );

    const wsTemporada =
      XLSX.utils.json_to_sheet(
        resumenTemporada
      );

    const wsHoteleria =
      XLSX.utils.json_to_sheet(
        resumenHoteleria
      );

    const wsGanadas =
      XLSX.utils.json_to_sheet(
        resumenGanadas
      );


    /* =====================================================
       ANCHOS LEADS
    ===================================================== */

    wsDetalle["!cols"] = [
      { wch: 12 }, // FECHA INGRESO
      { wch: 10 }, // HORA
      { wch: 12 }, // MES INGRESO
      { wch: 12 }, // AÑO INGRESO

      { wch: 12 }, // ID
      { wch: 14 }, // NEGOCIO
      { wch: 18 }, // CÓDIGO
      { wch: 42 }, // GRUPO
      { wch: 35 }, // COLEGIO
      { wch: 22 }, // COMUNA
      { wch: 14 }, // CURSO
      { wch: 14 }, // CURSO VIAJE
      { wch: 12 }, // AÑO VIAJE
      { wch: 24 }, // PAX

      { wch: 28 },
      { wch: 22 },
      { wch: 32 },
      { wch: 18 },

      { wch: 28 },
      { wch: 22 },
      { wch: 32 },
      { wch: 18 },

      { wch: 22 },
      { wch: 22 },
      { wch: 24 },
      { wch: 28 },
      { wch: 32 },

      { wch: 28 },
      { wch: 32 },

      { wch: 22 },
      { wch: 32 },
      { wch: 22 },
      { wch: 32 },

      { wch: 20 },
      { wch: 20 },
      { wch: 22 },
      { wch: 30 },

      { wch: 22 },
      { wch: 26 },
      { wch: 18 },
      { wch: 24 },
      { wch: 24 },
      { wch: 24 },
      { wch: 16 },

      { wch: 18 },
      { wch: 35 },

      { wch: 30 }, // DESTINO
      { wch: 30 }, // PROGRAMA
      { wch: 18 }, // MES
      { wch: 28 }, // FECHA/TEMPORADA
      { wch: 18 }, // TRAMO
      { wch: 42 }, // HOTELERÍA
      { wch: 18 }, // VALOR
      { wch: 14 }, // LIBERADOS
      { wch: 22 }, // ASISTENCIA
      { wch: 22 }, // SOL RESERVA
      { wch: 22 }, // AUT GERENCIA
      { wch: 22 }  // DESCUENTO
    ];


    /* =====================================================
       ANCHOS RESÚMENES EXISTENTES
    ===================================================== */

    wsMensual["!cols"] = [
      { wch: 12 },
      { wch: 10 },
      { wch: 15 },
      { wch: 22 },
      { wch: 22 },
      { wch: 24 },
      { wch: 28 },
      { wch: 18 },
      { wch: 18 },
      { wch: 18 },
      { wch: 22 },
      { wch: 12 },
      { wch: 12 },
      { wch: 14 },
      { wch: 14 },
      { wch: 16 }
    ];

    wsVendedores["!cols"] = [
      { wch: 12 },
      { wch: 26 },
      { wch: 10 },
      { wch: 15 },
      { wch: 14 },
      { wch: 12 },
      { wch: 12 },
      { wch: 14 },
      { wch: 16 }
    ];

    wsOrigen["!cols"] = [
      { wch: 18 },
      { wch: 18 },
      { wch: 20 },
      { wch: 10 },
      { wch: 15 },
      { wch: 14 },
      { wch: 12 },
      { wch: 12 },
      { wch: 16 }
    ];

    wsRolContacto["!cols"] = [
      { wch: 28 },
      { wch: 12 },
      { wch: 18 },
      { wch: 14 },
      { wch: 14 },
      { wch: 14 },
      { wch: 16 },
      { wch: 16 },
      { wch: 18 }
    ];

    wsCalidad["!cols"] = [
      { wch: 18 },
      { wch: 10 },
      { wch: 15 },
      { wch: 14 },
      { wch: 12 },
      { wch: 12 },
      { wch: 16 }
    ];


    /* =====================================================
       ANCHOS NUEVAS HOJAS
    ===================================================== */

    wsDestino["!cols"] = [
      { wch: 32 },
      { wch: 12 },
      { wch: 18 },
      { wch: 14 },
      { wch: 14 },
      { wch: 16 },
      { wch: 14 },
      { wch: 16 },
      { wch: 18 }
    ];

    wsTemporada["!cols"] = [
      { wch: 14 },
      { wch: 30 },
      { wch: 12 },
      { wch: 18 },
      { wch: 14 },
      { wch: 16 },
      { wch: 14 },
      { wch: 16 },
      { wch: 18 }
    ];

    wsHoteleria["!cols"] = [
      { wch: 14 },
      { wch: 32 },
      { wch: 45 },
      { wch: 18 },
      { wch: 20 },
      { wch: 14 }
    ];

    wsGanadas["!cols"] = [
      { wch: 14 },
      { wch: 14 },
      { wch: 42 },
      { wch: 35 },
      { wch: 28 },
      { wch: 30 },
      { wch: 32 },
      { wch: 32 },
      { wch: 18 },
      { wch: 18 },
      { wch: 14 },
      { wch: 45 },
      { wch: 18 },
      { wch: 22 },
      { wch: 22 },
      { wch: 22 },
      { wch: 22 }
    ];


    /* =====================================================
       AGREGAR HOJAS
    ===================================================== */

    XLSX.utils.book_append_sheet(
      wb,
      wsDetalle,
      "LEADS"
    );

    XLSX.utils.book_append_sheet(
      wb,
      wsMensual,
      "POR MES"
    );

    XLSX.utils.book_append_sheet(
      wb,
      wsVendedores,
      "POR VENDEDOR"
    );

    XLSX.utils.book_append_sheet(
      wb,
      wsOrigen,
      "POR ORIGEN"
    );

    XLSX.utils.book_append_sheet(
      wb,
      wsRolContacto,
      "POR ROL CONTACTO"
    );

    XLSX.utils.book_append_sheet(
      wb,
      wsCalidad,
      "CALIDAD"
    );

    XLSX.utils.book_append_sheet(
      wb,
      wsDestino,
      "POR DESTINO"
    );

    XLSX.utils.book_append_sheet(
      wb,
      wsTemporada,
      "POR TEMPORADA"
    );

    XLSX.utils.book_append_sheet(
      wb,
      wsHoteleria,
      "HOTELERIA"
    );

    XLSX.utils.book_append_sheet(
      wb,
      wsGanadas,
      "GANADAS"
    );


    /* =====================================================
       DESCARGAR
    ===================================================== */

    XLSX.writeFile(
      wb,
      `analisis_leads_${fileStamp()}.xlsx`
    );

  } catch (error) {
    console.error(
      "[seguimiento] error exportando análisis de leads:",
      error
    );

    alert(
      "No se pudo generar el análisis de leads."
    );

  } finally {
    if (boton) {
      boton.disabled = false;

      boton.textContent =
        boton.dataset.textoOriginal ||
        "📊 Análisis de Leads XLSX";
    }
  }
}

/* =========================================================
   CONSTRUIR REGISTRO ANALÍTICO
========================================================= */

function construirRegistroLead(
  row,
  data = {},
  asignacionHistorica = null
) {
  const fechaCreacion =
    toDate(
      data.fechaCreacion ||
      row.fechaCreacion ||
      null
    );


  /*
    Primero usamos el dato nuevo
    guardado directamente en el grupo.

    Si no existe, usamos el dato
    reconstruido desde historialAsignaciones.
  */
  const fechaAsignacion =
    toDate(
      data.fechaAsignacion ||
      asignacionHistorica?.fechaAsignacion ||
      null
    );


  const vendedorAsignadoInicial =
    cleanText(
      data.vendedorAsignadoInicial ||
      asignacionHistorica?.vendedorAsignadoInicial ||
      ""
    );


  const vendedorAsignadoInicialCorreo =
    normalizeEmail(
      data.vendedorAsignadoInicialCorreo ||
      asignacionHistorica?.vendedorAsignadoInicialCorreo ||
      ""
    );


  let ingresoSinAsignar =
    null;

  if (
    data.ingresoSinAsignar === true
  ) {
    ingresoSinAsignar =
      true;

  } else if (
    data.ingresoSinAsignar === false
  ) {
    ingresoSinAsignar =
      false;

  } else if (
    asignacionHistorica
  ) {
    ingresoSinAsignar =
      true;
  }


  const horasHastaAsignacion =
    ingresoSinAsignar === true &&
    fechaCreacion &&
    fechaAsignacion
      ? Math.max(
          0,
          (
            fechaAsignacion.getTime() -
            fechaCreacion.getTime()
          ) /
          (
            1000 *
            60 *
            60
          )
        )
      : (
          ingresoSinAsignar === false
            ? 0
            : null
        );


  const fechaUltimoCambioEstado =
    toDate(
      data.fechaUltimoCambioEstado ||
      data?.situacion?.fechaUltimoCambioEstado ||
      null
    );


  const ultimaGestionAt =
    toDate(
      data.ultimaGestionAt ||
      row.ultimaGestionAt ||
      null
    );


  const fechaUltimaReunion =
    toDate(
      data.fechaUltimaReunion ||
      data.ultimaReunion ||
      data.fechaReunion ||
      row.fechaUltimaReunion ||
      null
    );


  const estado =
    normalizeEstado(
      data.estado ||
      row.estado ||
      ""
    );


  const ultimaGestionTipo =
    cleanText(
      data.ultimaGestionTipo ||
      ""
    );


  const pasoPorReunion =
    !!fechaUltimaReunion ||
    estado === "reunion_confirmada" ||
    normalizeText(
      ultimaGestionTipo
    ).includes("reunion");


  const ficha =
    data.ficha || {};

  const fichaComercial =
    data.fichaComercial || {};


  /*
    Pax comercial contratado.

    Priorizamos resumen comercial.
  */
  const cantidadGrupo =
    Number(
      row.paxContratados ||
      data.paxContratados ||
      data.numeroPaxTotal ||
      fichaComercial.numeroPaxTotal ||
      data.cantidadGrupo ||
      ficha.numeroPaxTotal ||
      0
    ) || 0;


  const calidadLead =
    normalizarCalidadLead(
      data.calidadLead
    );


  /* =====================================================
     INFORMACIÓN COMERCIAL NUEVA
  ===================================================== */

  const categoriaHoteleraContratada =
    cleanText(
      row.categoriaHoteleraContratada ||
      data.categoriaHoteleraContratada ||
      fichaComercial.categoriaHoteleraContratada ||
      ficha.categoriaHoteleraContratada ||
      ""
    );


  const valorPrograma =
    cleanText(
      row.valorPrograma ||
      data.valorPrograma ||
      fichaComercial.valorPrograma ||
      ficha.valorPrograma ||
      ""
    );


  const valorProgramaNumero =
    Number(
      row.valorProgramaNumero ||
      data.valorProgramaNumero ||
      fichaComercial.valorProgramaNumero ||
      data.valorPrograma ||
      ficha.valorPrograma ||
      0
    ) || 0;


  const liberados =
    cleanText(
      row.liberados ||
      data.liberados ||
      fichaComercial.liberados ||
      ficha.liberados ||
      ""
    );


  const liberadosCantidad =
    Number(
      row.liberadosCantidad ||
      data.liberadosCantidad ||
      fichaComercial.liberadosCantidad ||
      data.liberados ||
      ficha.liberados ||
      0
    ) || 0;


  const tramo =
    cleanText(
      row.tramo ||
      data.tramo ||
      fichaComercial.tramo ||
      ficha.tramo ||
      ""
    );


  const fechaViajeTexto =
    cleanText(
      row.fechaViajeTexto ||
      data.fechaViajeTexto ||
      fichaComercial.fechaViajeTexto ||
      ficha.fechaViajeTexto ||
      data.semanaViaje ||
      row.mesViaje ||
      data.mesViaje ||
      ""
    );


  const mesViaje =
    cleanText(
      row.mesViaje ||
      data.mesViaje ||
      fichaComercial.mesViaje ||
      ficha.mesViaje ||
      ""
    );


  const asistenciaEnViajes =
    cleanText(
      row.asistenciaEnViajes ||
      data.asistenciaEnViajes ||
      fichaComercial.asistenciaEnViajes ||
      ficha.asistenciaEnViajes ||
      ""
    );


  const solicitudReserva =
    cleanText(
      row.solicitudReserva ||
      data.solicitudReserva ||
      fichaComercial.solicitudReserva ||
      ficha.solicitudReserva ||
      ""
    );


  const autorizacionGerencia =
    cleanText(
      row.autorizacionGerencia ||
      data.autorizacionGerencia ||
      fichaComercial.autorizacionGerencia ||
      ficha.autorizacionGerencia ||
      ""
    );


  const descuentoValorBase =
    cleanText(
      row.descuentoValorBase ||
      data.descuentoValorBase ||
      fichaComercial.descuentoValorBase ||
      ficha.descuentoValorBase ||
      ""
    );


  return {
    _fechaCreacion:
      fechaCreacion,

    _fechaAsignacion:
      fechaAsignacion,

    ingresoSinAsignar,

    horasHastaAsignacion,

    vendedorAsignadoInicial,

    vendedorAsignadoInicialCorreo,

    _fechaUltimoCambioEstado:
      fechaUltimoCambioEstado,

    _fechaUltimaReunion:
      fechaUltimaReunion,

    _ultimaGestionAt:
      ultimaGestionAt,


    /* =====================================================
       IDENTIFICACIÓN DEL GRUPO
    ===================================================== */

    idGrupo:
      cleanText(
        data.idGrupo ||
        row.idGrupo ||
        row.id ||
        ""
      ),

    numeroNegocio:
      cleanText(
        data.numeroNegocio ||
        row.numeroNegocio ||
        ""
      ),

    codigoRegistro:
      cleanText(
        data.codigoRegistro
      ),

    grupo:
      cleanText(
        row.displayTitle ||
        data.aliasGrupo ||
        data.colegio ||
        ""
      ),

    colegio:
      cleanText(
        data.colegio ||
        row.colegio ||
        ""
      ),

    comunaCiudad:
      cleanText(
        data.comunaCiudad
      ),

    curso:
      cleanText(
        data.curso ||
        row.curso ||
        ""
      ),

    cursoViaje:
      cleanText(
        data.cursoViaje
      ),

    anoViaje:
      Number(
        data.anoViaje ||
        row.anoViaje ||
        0
      ) || "",

    cantidadGrupo,


    /* =====================================================
       CONTACTO PRINCIPAL
    ===================================================== */

    nombreCliente:
      cleanText(
        data.nombreCliente ||
        ficha.apoderadoEncargado ||
        ""
      ),

    rolCliente:
      cleanText(
        data.rolCliente ||
        ""
      ),

    correoCliente:
      cleanText(
        data.correoCliente ||
        ficha.correo ||
        ""
      ),

    celularCliente:
      cleanText(
        data.celularCliente ||
        ficha.telefono ||
        ""
      ),


    /* =====================================================
       SEGUNDO CONTACTO
    ===================================================== */

    nombreCliente2:
      cleanText(
        data.nombreCliente2 ||
        ""
      ),

    rolCliente2:
      cleanText(
        data.rolCliente2 ||
        ""
      ),

    correoCliente2:
      cleanText(
        data.correoCliente2 ||
        ""
      ),

    celularCliente2:
      cleanText(
        data.celularCliente2 ||
        ""
      ),


    /* =====================================================
       VENDEDOR
    ===================================================== */

    vendedora:
      cleanText(
        data.vendedora ||
        row.vendedora ||
        ""
      ),

    vendedoraCorreo:
      normalizeEmail(
        data.vendedoraCorreo ||
        row.vendedoraCorreo ||
        ""
      ),


    /* =====================================================
       AUDITORÍA
    ===================================================== */

    creadoPor:
      cleanText(
        data.creadoPor
      ),

    creadoPorCorreo:
      normalizeEmail(
        data.creadoPorCorreo ||
        ""
      ),

    actualizadoPor:
      cleanText(
        data.actualizadoPor ||
        ""
      ),

    actualizadoPorCorreo:
      normalizeEmail(
        data.actualizadoPorCorreo ||
        ""
      ),


    /* =====================================================
       ORIGEN
    ===================================================== */

    origenCliente:
      cleanText(
        data.origenCliente
      ),

    origenColegio:
      cleanText(
        data.origenColegio
      ),

    origenEspecificacion:
      cleanText(
        data.origenEspecificacion
      ),

    origenEspecificacionOtro:
      cleanText(
        data.origenEspecificacionOtro
      ),


    /* =====================================================
       ESTADO / SEGUIMIENTO
    ===================================================== */

    estado,

    pasoPorReunion,

    ultimaGestionTipo,

    calidadLead,

    calidadLeadComentario:
      cleanText(
        data.calidadLeadComentario ||
        data.calidadLeadDetalle ||
        ""
      ),


    /* =====================================================
       VIAJE / FICHA COMERCIAL
    ===================================================== */

    destino:
      cleanText(
        row.destino ||
        data.destinoPrincipal ||
        fichaComercial.destinoPrincipal ||
        data.destino ||
        ""
      ),

    programa:
      cleanText(
        row.programa ||
        data.nombrePrograma ||
        data.programa ||
        fichaComercial.nombrePrograma ||
        ficha.nombrePrograma ||
        ""
      ),

    mesViaje,

    fechaViajeTexto,

    tramo,

    categoriaHoteleraContratada,

    valorPrograma,
    valorProgramaNumero,

    liberados,
    liberadosCantidad,

    asistenciaEnViajes,
    solicitudReserva,
    autorizacionGerencia,
    descuentoValorBase
  };
}

/* =========================================================
   FILA DETALLE XLSX
========================================================= */

function registroLeadParaExcel(
  registro
) {
  const fecha =
    registro._fechaCreacion;

  return {
    "FECHA INGRESO":
      formatDateOnlyText(fecha),

    "HORA INGRESO":
      formatTimeOnlyText(fecha),

    "MES INGRESO":
      getMonthKey(fecha),

    "AÑO INGRESO":
      fecha
        ? fecha.getFullYear()
        : "",


    /* =====================================================
       GRUPO
    ===================================================== */

    "ID GRUPO":
      registro.idGrupo,

    "N° NEGOCIO":
      registro.numeroNegocio,

    "CÓDIGO":
      registro.codigoRegistro,

    "GRUPO":
      registro.grupo,

    "COLEGIO":
      registro.colegio,

    "COMUNA":
      registro.comunaCiudad,

    "CURSO":
      registro.curso,

    "CURSO VIAJE":
      registro.cursoViaje,

    "AÑO VIAJE":
      registro.anoViaje,

    "PAX POTENCIALES / CONTRATADOS":
      registro.cantidadGrupo,


    /* =====================================================
       CONTACTO PRINCIPAL
    ===================================================== */

    "CONTACTO 1":
      registro.nombreCliente,

    "ROL CONTACTO 1":
      registro.rolCliente,

    "CORREO CONTACTO 1":
      registro.correoCliente,

    "CELULAR CONTACTO 1":
      registro.celularCliente,


    /* =====================================================
       SEGUNDO CONTACTO
    ===================================================== */

    "CONTACTO 2":
      registro.nombreCliente2,

    "ROL CONTACTO 2":
      registro.rolCliente2,

    "CORREO CONTACTO 2":
      registro.correoCliente2,

    "CELULAR CONTACTO 2":
      registro.celularCliente2,


    /* =====================================================
       ASIGNACIÓN
    ===================================================== */

    "INGRESÓ SIN ASIGNAR":
      registro.ingresoSinAsignar === true
        ? "SI"
        : registro.ingresoSinAsignar === false
          ? "NO"
          : "NO REGISTRADO",

    "FECHA ASIGNACIÓN":
      formatDateTimeText(
        registro._fechaAsignacion
      ),

    "HORAS HASTA ASIGNACIÓN":
      registro.horasHastaAsignacion === null
        ? ""
        : Number(
            registro.horasHastaAsignacion
              .toFixed(2)
          ),

    "VENDEDOR ASIGNADO INICIAL":
      registro.vendedorAsignadoInicial,

    "CORREO VENDEDOR INICIAL":
      registro.vendedorAsignadoInicialCorreo,


    /* =====================================================
       VENDEDOR ACTUAL
    ===================================================== */

    "VENDEDOR(A) ACTUAL":
      registro.vendedora,

    "CORREO VENDEDOR(A)":
      registro.vendedoraCorreo,


    /* =====================================================
       AUDITORÍA
    ===================================================== */

    "CREADO POR":
      registro.creadoPor,

    "CORREO CREADOR":
      registro.creadoPorCorreo,

    "ACTUALIZADO POR":
      registro.actualizadoPor,

    "CORREO ÚLTIMA ACTUALIZACIÓN":
      registro.actualizadoPorCorreo,


    /* =====================================================
       ORIGEN
    ===================================================== */

    "ORIGEN CLIENTE":
      registro.origenCliente,

    "ORIGEN COLEGIO":
      registro.origenColegio,

    "MEDIO / CONTACTO":
      registro.origenEspecificacion,

    "DETALLE ORIGEN":
      registro.origenEspecificacionOtro,


    /* =====================================================
       SEGUIMIENTO
    ===================================================== */

    "ESTADO ACTUAL":
      STAGE_META[
        registro.estado
      ]?.label ||
      registro.estado,

    "FECHA ÚLTIMO CAMBIO ESTADO":
      formatDateTimeText(
        registro._fechaUltimoCambioEstado
      ),

    "PASÓ POR REUNIÓN":
      registro.pasoPorReunion
        ? "SI"
        : "NO",

    "FECHA ÚLTIMA REUNIÓN":
      formatDateTimeText(
        registro._fechaUltimaReunion
      ),

    "ÚLTIMA GESTIÓN":
      formatDateTimeText(
        registro._ultimaGestionAt
      ),

    "TIPO ÚLTIMA GESTIÓN":
      registro.ultimaGestionTipo,

    "RESULTADO":
      getResultadoLead(
        registro.estado
      ),

    "CALIDAD LEAD":
      registro.calidadLead,

    "DETALLE CALIDAD":
      registro.calidadLeadComentario,


    /* =====================================================
       VIAJE / PROYECCIÓN COMERCIAL
    ===================================================== */

    "DESTINO":
      registro.destino,

    "PROGRAMA":
      registro.programa,

    "MES VIAJE":
      registro.mesViaje,

    "FECHA / TEMPORADA VIAJE":
      registro.fechaViajeTexto,

    "TRAMO":
      registro.tramo,

    "CATEGORÍA HOTELERA CONTRATADA":
      registro.categoriaHoteleraContratada,

    "VALOR PROGRAMA":
      registro.valorProgramaNumero ||
      registro.valorPrograma ||
      "",

    "LIBERADOS":
      registro.liberadosCantidad ||
      registro.liberados ||
      "",

    "ASISTENCIA EN VIAJES":
      registro.asistenciaEnViajes,

    "SOLICITUD RESERVA":
      registro.solicitudReserva,

    "AUTORIZACIÓN GERENCIA":
      registro.autorizacionGerencia,

    "DESCUENTO VALOR BASE":
      registro.descuentoValorBase
  };
}

/* =========================================================
   RESUMEN MENSUAL
========================================================= */

function construirResumenMensualLeads(
  registros
) {
  const mapa =
    new Map();

  for (const registro of registros) {
    const mes =
      getMonthKey(
        registro._fechaCreacion
      );

    if (!mes) continue;

    if (!mapa.has(mes)) {
      mapa.set(
        mes,
        crearAcumuladorLeads()
      );
    }

    acumularLead(
      mapa.get(mes),
      registro
    );
  }

  return [...mapa.entries()]
    .sort(
      ([a], [b]) =>
        a.localeCompare(b)
    )
    .map(
      ([mes, total]) => ({
        "MES INGRESO":
          mes,
      
        "LEADS":
          total.leads,
      
        "PAX POTENCIALES":
          total.pax,
      
        "INGRESARON SIN ASIGNAR":
          total.sinAsignarIngreso,
      
        "% INGRESO SIN ASIGNAR":
          porcentaje(
            total.sinAsignarIngreso,
            total.leads
          ),
      
        "ASIGNACIÓN NO REGISTRADA":
          total.asignacionNoRegistrada,
      
        "PROMEDIO HORAS HASTA ASIGNACIÓN":
          total.asignacionConTiempo
            ? Number(
                (
                  total.totalHorasAsignacion /
                  total.asignacionConTiempo
                ).toFixed(2)
              )
            : "",
      
        "ASIGNADOS ≤ 4 H":
          total.asignadosHasta4Horas,
      
        "ASIGNADOS ≤ 24 H":
          total.asignadosHasta24Horas,
      
        "ASIGNADOS > 24 H":
          total.asignadosMas24Horas,
      
        "PASARON POR REUNIÓN":
          total.reuniones,
      
        "GANADOS":
          total.ganados,
      
        "PERDIDOS":
          total.perdidos,
      
        "EN PROCESO":
          total.enProceso,
      
        "% REUNIÓN":
          porcentaje(
            total.reuniones,
            total.leads
          ),
      
        "% CONVERSIÓN":
          porcentaje(
            total.ganados,
            total.leads
          )
      })
    );
}


/* =========================================================
   RESUMEN POR VENDEDOR
========================================================= */

function construirResumenVendedoresLeads(
  registros
) {
  const mapa =
    new Map();

  for (const registro of registros) {
    const mes =
      getMonthKey(
        registro._fechaCreacion
      );

    const vendedor =
      registro.vendedora ||
      registro.vendedoraCorreo ||
      "Sin vendedor";

    const key =
      `${mes}__${vendedor}`;

    if (!mapa.has(key)) {
      mapa.set(
        key,
        {
          mes,
          vendedor,
          ...crearAcumuladorLeads()
        }
      );
    }

    acumularLead(
      mapa.get(key),
      registro
    );
  }

  return [...mapa.values()]
    .sort(
      (a, b) =>
        compareText(
          `${a.mes} ${a.vendedor}`,
          `${b.mes} ${b.vendedor}`
        )
    )
    .map(
      (total) => ({
        "MES INGRESO":
          total.mes,

        "VENDEDOR(A)":
          total.vendedor,

        "LEADS":
          total.leads,

        "PAX POTENCIALES":
          total.pax,

        "REUNIÓN":
          total.reuniones,

        "GANADOS":
          total.ganados,

        "PERDIDOS":
          total.perdidos,

        "EN PROCESO":
          total.enProceso,

        "% CONVERSIÓN":
          porcentaje(
            total.ganados,
            total.leads
          )
      })
    );
}

/* =========================================================
   RESUMEN POR ROL DEL CONTACTO
========================================================= */

function construirResumenRolContactos(
  registros
) {
  const mapa =
    new Map();

  for (const registro of registros) {
    /*
      El análisis se realiza sobre el
      CONTACTO PRINCIPAL que originó el lead.
    */
    const rol =
      cleanText(
        registro.rolCliente
      ) ||
      "Sin definir";

    if (!mapa.has(rol)) {
      mapa.set(
        rol,
        {
          rol,
          ...crearAcumuladorLeads()
        }
      );
    }

    acumularLead(
      mapa.get(rol),
      registro
    );
  }

  return [...mapa.values()]
    .sort(
      (a, b) =>
        compareText(
          a.rol,
          b.rol
        )
    )
    .map(
      (total) => ({
        "ROL CONTACTO":
          total.rol,

        "LEADS":
          total.leads,

        "PAX POTENCIALES":
          total.pax,

        "REUNIÓN":
          total.reuniones,

        "GANADOS":
          total.ganados,

        "PERDIDOS":
          total.perdidos,

        "EN PROCESO":
          total.enProceso,

        "% REUNIÓN":
          porcentaje(
            total.reuniones,
            total.leads
          ),

        "% CONVERSIÓN":
          porcentaje(
            total.ganados,
            total.leads
          )
      })
    );
}

/* =========================================================
   RESUMEN POR ORIGEN
========================================================= */

function construirResumenOrigenLeads(
  registros
) {
  const mapa =
    new Map();

  for (const registro of registros) {
    const origen =
      registro.origenColegio ||
      registro.origenCliente ||
      "Sin definir";

    const medio =
      registro.origenEspecificacion ||
      "Sin especificar";

    const detalle =
      registro.origenEspecificacionOtro ||
      "";

    const key =
      `${origen}__${medio}__${detalle}`;

    if (!mapa.has(key)) {
      mapa.set(
        key,
        {
          origen,
          medio,
          detalle,
          ...crearAcumuladorLeads()
        }
      );
    }

    acumularLead(
      mapa.get(key),
      registro
    );
  }

  return [...mapa.values()]
    .sort(
      (a, b) =>
        compareText(
          `${a.origen} ${a.medio} ${a.detalle}`,
          `${b.origen} ${b.medio} ${b.detalle}`
        )
    )
    .map(
      (total) => ({
        "ORIGEN":
          total.origen,

        "MEDIO / CONTACTO":
          total.medio,

        "DETALLE":
          total.detalle,

        "LEADS":
          total.leads,

        "PAX POTENCIALES":
          total.pax,

        "REUNIÓN":
          total.reuniones,

        "GANADOS":
          total.ganados,

        "PERDIDOS":
          total.perdidos,

        "% CONVERSIÓN":
          porcentaje(
            total.ganados,
            total.leads
          )
      })
    );
}


/* =========================================================
   RESUMEN CALIDAD
========================================================= */

function construirResumenCalidadLeads(
  registros
) {
  const mapa =
    new Map();

  for (const registro of registros) {
    const calidad =
      registro.calidadLead ||
      "SIN EVALUAR";

    if (!mapa.has(calidad)) {
      mapa.set(
        calidad,
        crearAcumuladorLeads()
      );
    }

    acumularLead(
      mapa.get(calidad),
      registro
    );
  }

  return [...mapa.entries()]
    .map(
      ([calidad, total]) => ({
        "CALIDAD":
          calidad,

        "LEADS":
          total.leads,

        "PAX POTENCIALES":
          total.pax,

        "REUNIÓN":
          total.reuniones,

        "GANADOS":
          total.ganados,

        "PERDIDOS":
          total.perdidos,

        "% CONVERSIÓN":
          porcentaje(
            total.ganados,
            total.leads
          )
      })
    );
}

/* =========================================================
   RESUMEN POR DESTINO
========================================================= */

function construirResumenDestinoLeads(
  registros
) {
  const mapa =
    new Map();

  for (const registro of registros) {
    const destino =
      cleanText(
        registro.destino
      ) ||
      "Sin definir";

    if (!mapa.has(destino)) {
      mapa.set(
        destino,
        {
          destino,
          leads: 0,
          pax: 0,
          reuniones: 0,
          ganados: 0,
          paxGanados: 0,
          perdidos: 0,
          enProceso: 0
        }
      );
    }

    const total =
      mapa.get(destino);

    total.leads++;

    total.pax +=
      Number(
        registro.cantidadGrupo || 0
      );

    if (registro.pasoPorReunion) {
      total.reuniones++;
    }

    if (registro.estado === "ganada") {
      total.ganados++;

      total.paxGanados +=
        Number(
          registro.cantidadGrupo || 0
        );

    } else if (
      registro.estado === "perdida"
    ) {
      total.perdidos++;

    } else {
      total.enProceso++;
    }
  }

  return [...mapa.values()]
    .sort(
      (a, b) =>
        compareText(
          a.destino,
          b.destino
        )
    )
    .map(
      (total) => ({
        "DESTINO":
          total.destino,

        "LEADS":
          total.leads,

        "PAX POTENCIALES":
          total.pax,

        "REUNIÓN":
          total.reuniones,

        "GANADOS":
          total.ganados,

        "PAX GANADOS":
          total.paxGanados,

        "PERDIDOS":
          total.perdidos,

        "EN PROCESO":
          total.enProceso,

        "% CONVERSIÓN":
          porcentaje(
            total.ganados,
            total.leads
          )
      })
    );
}


/* =========================================================
   RESUMEN POR TEMPORADA
========================================================= */

function construirResumenTemporadaLeads(
  registros
) {
  const mapa =
    new Map();

  for (const registro of registros) {
    const ano =
      registro.anoViaje ||
      "Sin año";

    const temporada =
      cleanText(
        registro.fechaViajeTexto ||
        registro.mesViaje
      ) ||
      "Sin definir";

    const key =
      `${ano}__${temporada}`;

    if (!mapa.has(key)) {
      mapa.set(
        key,
        {
          ano,
          temporada,
          leads: 0,
          pax: 0,
          ganados: 0,
          paxGanados: 0,
          perdidos: 0,
          enProceso: 0
        }
      );
    }

    const total =
      mapa.get(key);

    total.leads++;

    total.pax +=
      Number(
        registro.cantidadGrupo || 0
      );

    if (registro.estado === "ganada") {
      total.ganados++;

      total.paxGanados +=
        Number(
          registro.cantidadGrupo || 0
        );

    } else if (
      registro.estado === "perdida"
    ) {
      total.perdidos++;

    } else {
      total.enProceso++;
    }
  }

  return [...mapa.values()]
    .sort(
      (a, b) => {
        const anoCompare =
          compareNumber(
            a.ano,
            b.ano
          );

        if (anoCompare !== 0) {
          return anoCompare;
        }

        return compareText(
          a.temporada,
          b.temporada
        );
      }
    )
    .map(
      (total) => ({
        "AÑO VIAJE":
          total.ano,

        "TEMPORADA / FECHA":
          total.temporada,

        "LEADS":
          total.leads,

        "PAX POTENCIALES":
          total.pax,

        "GANADOS":
          total.ganados,

        "PAX GANADOS":
          total.paxGanados,

        "PERDIDOS":
          total.perdidos,

        "EN PROCESO":
          total.enProceso,

        "% CONVERSIÓN":
          porcentaje(
            total.ganados,
            total.leads
          )
      })
    );
}


/* =========================================================
   RESUMEN HOTELERÍA
========================================================= */

function construirResumenHoteleriaLeads(
  registros
) {
  const mapa =
    new Map();

  for (const registro of registros) {
    /*
      Para hotelería interesa especialmente
      lo que efectivamente fue ganado.
    */
    if (
      registro.estado !== "ganada"
    ) {
      continue;
    }

    const ano =
      registro.anoViaje ||
      "Sin año";

    const destino =
      cleanText(
        registro.destino
      ) ||
      "Sin destino";

    const hoteleria =
      cleanText(
        registro.categoriaHoteleraContratada
      ) ||
      "Sin definir";

    const key =
      `${ano}__${destino}__${hoteleria}`;

    if (!mapa.has(key)) {
      mapa.set(
        key,
        {
          ano,
          destino,
          hoteleria,
          grupos: 0,
          pax: 0,
          liberados: 0
        }
      );
    }

    const total =
      mapa.get(key);

    total.grupos++;

    total.pax +=
      Number(
        registro.cantidadGrupo || 0
      );

    total.liberados +=
      Number(
        registro.liberadosCantidad || 0
      );
  }

  return [...mapa.values()]
    .sort(
      (a, b) =>
        compareText(
          `${a.ano} ${a.destino} ${a.hoteleria}`,
          `${b.ano} ${b.destino} ${b.hoteleria}`
        )
    )
    .map(
      (total) => ({
        "AÑO VIAJE":
          total.ano,

        "DESTINO":
          total.destino,

        "CATEGORÍA HOTELERA CONTRATADA":
          total.hoteleria,

        "GRUPOS GANADOS":
          total.grupos,

        "PAX CONTRATADOS":
          total.pax,

        "LIBERADOS":
          total.liberados
      })
    );
}


/* =========================================================
   DETALLE GRUPOS GANADOS
========================================================= */

function construirResumenGanadasLeads(
  registros
) {
  return registros
    .filter(
      (registro) =>
        registro.estado === "ganada"
    )
    .sort(
      (a, b) => {
        const anoCompare =
          compareNumber(
            a.anoViaje,
            b.anoViaje
          );

        if (anoCompare !== 0) {
          return anoCompare;
        }

        const destinoCompare =
          compareText(
            a.destino,
            b.destino
          );

        if (destinoCompare !== 0) {
          return destinoCompare;
        }

        return compareText(
          a.grupo,
          b.grupo
        );
      }
    )
    .map(
      (registro) => ({
        "AÑO VIAJE":
          registro.anoViaje,

        "N° NEGOCIO":
          registro.numeroNegocio,

        "GRUPO":
          registro.grupo,

        "COLEGIO":
          registro.colegio,

        "VENDEDOR(A)":
          registro.vendedora,

        "TEMPORADA / FECHA":
          registro.fechaViajeTexto ||
          registro.mesViaje,

        "DESTINO":
          registro.destino,

        "PROGRAMA":
          registro.programa,

        "TRAMO":
          registro.tramo,

        "PAX CONTRATADOS":
          registro.cantidadGrupo,

        "LIBERADOS":
          registro.liberadosCantidad ||
          registro.liberados ||
          "",

        "CATEGORÍA HOTELERA CONTRATADA":
          registro.categoriaHoteleraContratada,

        "VALOR PROGRAMA":
          registro.valorProgramaNumero ||
          registro.valorPrograma ||
          "",

        "ASISTENCIA EN VIAJES":
          registro.asistenciaEnViajes,

        "SOLICITUD RESERVA":
          registro.solicitudReserva,

        "AUTORIZACIÓN GERENCIA":
          registro.autorizacionGerencia,

        "DESCUENTO VALOR BASE":
          registro.descuentoValorBase
      })
    );
}


/* =========================================================
   ACUMULADORES
========================================================= */

function crearAcumuladorLeads() {
  return {
    leads: 0,
    pax: 0,
    reuniones: 0,
    ganados: 0,
    perdidos: 0,
    enProceso: 0,

    /*
      Métricas asignación
    */
    sinAsignarIngreso: 0,

    asignacionConTiempo: 0,

    totalHorasAsignacion: 0,

    asignadosHasta4Horas: 0,

    asignadosHasta24Horas: 0,

    asignadosMas24Horas: 0,

    asignacionNoRegistrada: 0
  };
}


function acumularLead(
  total,
  registro
) {
  total.leads++;

  total.pax +=
    Number(
      registro.cantidadGrupo || 0
    );


  /* =====================================================
     ASIGNACIÓN
  ===================================================== */

  if (
    registro.ingresoSinAsignar === true
  ) {
    total.sinAsignarIngreso++;
  }


  if (
    registro.ingresoSinAsignar === null
  ) {
    total.asignacionNoRegistrada++;
  }


  if (
    registro.horasHastaAsignacion !== null &&
    Number.isFinite(
      registro.horasHastaAsignacion
    )
  ) {
    const horas =
      Number(
        registro.horasHastaAsignacion
      );

    total.asignacionConTiempo++;

    total.totalHorasAsignacion +=
      horas;


    if (horas <= 4) {
      total.asignadosHasta4Horas++;
    }


    if (horas <= 24) {
      total.asignadosHasta24Horas++;
    } else {
      total.asignadosMas24Horas++;
    }
  }


  /* =====================================================
     FUNNEL
  ===================================================== */

  if (
    registro.pasoPorReunion
  ) {
    total.reuniones++;
  }


  if (
    registro.estado === "ganada"
  ) {
    total.ganados++;

  } else if (
    registro.estado === "perdida"
  ) {
    total.perdidos++;

  } else {
    total.enProceso++;
  }
}


/* =========================================================
   HELPERS INFORME
========================================================= */

function getResultadoLead(
  estado
) {
  if (estado === "ganada") {
    return "GANADA";
  }

  if (estado === "perdida") {
    return "PERDIDA";
  }

  return "EN PROCESO";
}


function normalizarCalidadLead(
  value
) {
  const v =
    normalizeText(value);

  if (!v) {
    return "SIN EVALUAR";
  }

  if (
    v === "a" ||
    v.includes("muy bueno") ||
    v.includes("muy alta")
  ) {
    return "A";
  }

  if (
    v === "b" ||
    v === "bueno" ||
    v === "alta"
  ) {
    return "B";
  }

  if (
    v === "c" ||
    v === "regular" ||
    v === "media"
  ) {
    return "C";
  }

  if (
    v === "d" ||
    v.includes("bajo")
  ) {
    return "D";
  }

  return String(value)
    .trim()
    .toUpperCase();
}


function getMonthKey(
  date
) {
  if (!date) {
    return "";
  }

  const yyyy =
    date.getFullYear();

  const mm =
    String(
      date.getMonth() + 1
    ).padStart(
      2,
      "0"
    );

  return `${yyyy}-${mm}`;
}


function porcentaje(
  cantidad,
  total
) {
  if (!total) {
    return "0,0%";
  }

  return (
    (
      Number(cantidad || 0) /
      Number(total)
    ) * 100
  ).toLocaleString(
    "es-CL",
    {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1
    }
  ) + "%";
}


function formatDateOnlyText(
  date
) {
  if (!date) {
    return "";
  }

  return date.toLocaleDateString(
    "es-CL"
  );
}


function formatTimeOnlyText(
  date
) {
  if (!date) {
    return "";
  }

  return date.toLocaleTimeString(
    "es-CL",
    {
      hour: "2-digit",
      minute: "2-digit"
    }
  );
}

/* =========================================================
   EXPORTAR
========================================================= */
function exportVisibleRowsToXlsx() {
  try {
    if (
      typeof XLSX ===
      "undefined"
    ) {
      alert(
        "No se encontró la librería XLSX."
      );

      return;
    }

    if (
      !state.visibleRows.length
    ) {
      alert(
        "No hay registros visibles para exportar."
      );

      return;
    }

    const rowsToExport =
      state.visibleRows.map(
        (row) => ({
          "ID GRUPO":
            row.idGrupo ||
            row.id ||
            "",

          "N° NEGOCIO":
            row.numeroNegocio ||
            "",

          "GRUPO":
            row.displayTitle ||
            "",

          "VENDEDOR(A)":
            row.vendedora ||
            row.vendedoraCorreo ||
            "",

          "COLEGIO":
            row.colegio ||
            row.nombreGrupo ||
            "",

          "CURSO":
            row.curso ||
            "",

          "AÑO VIAJE":
            row.anoViaje ||
            "",

          "DESTINO":
            row.destino ||
            "",

          "PROGRAMA":
            row.programa ||
            "",

          "PAX":
            row.cantidadGrupo ||
            0,

          "FECHA CREACIÓN":
            formatDateTimeText(
              row.fechaCreacion
            ),

          "PROGRESO":
            STAGE_META[
              row.estado
            ]?.label ||
            row.estado ||
            "",

          "AUTORIZADA":
            row.autorizada
              ? "SI"
              : "NO",

          "CERRADA":
            row.cerrada
              ? "SI"
              : "NO",

          "ÚLT. GESTIÓN":
            formatDateTimeText(
              row.ultimaGestionAt
            ),

          "ÚLT. REUNIÓN":
            formatDateTimeText(
              row.fechaUltimaReunion
            ),

          "FICHAS MÉDICAS":
            getDocLabel(
              row.fichaMedicaEstado
            ),

          "NÓMINA":
            getDocLabel(
              row.nominaEstado
            ),

          "FICHA DEL GRUPO":
            getDocLabel(
              row.fichaEstado
            ),

          "CONTRATO":
            getDocLabel(
              row.contratoEstado
            ),

          "CORTESÍAS":
            getDocLabel(
              row.cortesiaEstado
            )
        })
      );

    const wb =
      XLSX.utils.book_new();

    const ws =
      XLSX.utils.json_to_sheet(
        rowsToExport
      );

    ws["!cols"] = [
      { wch: 12 }, // ID GRUPO
      { wch: 14 }, // NEGOCIO
      { wch: 42 }, // GRUPO
      { wch: 28 }, // VENDEDOR
      { wch: 35 }, // COLEGIO
      { wch: 12 }, // CURSO
      { wch: 12 }, // AÑO
      { wch: 30 }, // DESTINO
      { wch: 28 }, // PROGRAMA
      { wch: 10 }, // PAX
      { wch: 22 }, // FECHA CREACIÓN
      { wch: 22 }, // PROGRESO
      { wch: 14 }, // AUTORIZADA
      { wch: 14 }, // CERRADA
      { wch: 22 }, // ÚLT. GESTIÓN
      { wch: 22 }, // ÚLT. REUNIÓN
      { wch: 20 }, // FICHAS MÉDICAS
      { wch: 18 }, // NÓMINA
      { wch: 22 }, // FICHA GRUPO
      { wch: 18 }, // CONTRATO
      { wch: 18 }  // CORTESÍAS
    ];

    XLSX.utils.book_append_sheet(
      wb,
      ws,
      "Seguimiento"
    );

    XLSX.writeFile(
      wb,
      `seguimiento_grupos_${fileStamp()}.xlsx`
    );

  } catch (error) {
    console.error(
      "[seguimiento] error exportando xlsx:",
      error
    );

    alert(
      "No se pudo exportar el XLSX."
    );
  }
}

function getDashboardQueryPreset() {
  const params = new URLSearchParams(window.location.search);

  return {
    bucket: normalizeText(params.get("dashboardBucket") || ""),
    ano: String(params.get("ano") || "").trim(),
    archivados: params.get("archivados") === "1",
    vendor: normalizeEmail(params.get("vendor") || "")
  };
}

function applyDashboardPreset() {
  const preset =
    state.dashboardPreset ||
    getDashboardQueryPreset();

  const filtroAno =
    $("filtroAno");

  const filtroEstado =
    $("filtroEstado");

  const filtroVendedora =
    $("filtroVendedora");

  const anosDisponibles =
    getAnosSeguimientoDisponibles();

  const anoPreset =
    Number(
      preset.ano || 0
    );

  /*
    Solo aceptamos años activos.
    Los anteriores quedan archivados.
  */
  if (
    filtroAno &&
    anosDisponibles.includes(
      anoPreset
    )
  ) {
    filtroAno.value =
      String(anoPreset);

    state.anoSeleccionado =
      String(anoPreset);
  }

  const bucketToEstado = {
    a_contactar:
      "a_contactar",

    contactados:
      "contactado",

    cotizando:
      "cotizando",

    recotizando:
      "recotizando",

    reunion:
      "reunion_confirmada",

    reunion_confirmada:
      "reunion_confirmada",

    ganadas:
      "ganada",

    ganada:
      "ganada",

    perdidas:
      "perdida",

    perdida:
      "perdida"
  };

  if (filtroEstado) {
    filtroEstado.value =
      bucketToEstado[
        preset.bucket
      ] || "todos";
  }

  if (
    preset.vendor &&
    filtroVendedora
  ) {
    const matchingOption =
      [...filtroVendedora.options]
        .find(
          (option) =>
            normalizeEmail(
              option.value
            ) ===
            preset.vendor
        );

    if (matchingOption) {
      filtroVendedora.value =
        matchingOption.value;
    }
  }

  if (
    preset.bucket ===
      "perdidas" ||
    preset.bucket ===
      "perdida"
  ) {
    state.hiddenSummaryStates.delete(
      "perdida"
    );
  }
}

/* =========================================================
   FILTROS AUXILIARES / SORT
========================================================= */
function getSummaryBucket(estado) {
  const normalized = normalizeEstado(estado);
  if (normalized === "recotizando") return "cotizando";
  return normalized;
}

function compareRows(
  a,
  b,
  sortKey,
  sortDir
) {
  let result = 0;

  switch (sortKey) {

    case "grupo":
      result =
        compareText(
          a.grupoSortTitle ||
          a.displayTitle,

          b.grupoSortTitle ||
          b.displayTitle
        );
      break;


    case "vendedora":
      result =
        compareText(
          a.vendedora ||
          a.vendedoraCorreo,

          b.vendedora ||
          b.vendedoraCorreo
        );
      break;


    case "destino":
      result =
        compareText(
          a.destino,
          b.destino
        );
      break;


    case "pax":
      result =
        compareNumber(
          a.cantidadGrupo,
          b.cantidadGrupo
        );
      break;


    case "fechaCreacion":
      result =
        compareNumber(
          a.fechaCreacion
            ? a.fechaCreacion.getTime()
            : 0,

          b.fechaCreacion
            ? b.fechaCreacion.getTime()
            : 0
        );
      break;


    case "estado":
      result =
        compareText(
          STAGE_META[a.estado]?.label ||
          a.estado,

          STAGE_META[b.estado]?.label ||
          b.estado
        );
      break;


    case "autorizada":
      result =
        compareNumber(
          a.autorizada
            ? 1
            : 0,

          b.autorizada
            ? 1
            : 0
        );
      break;


    case "cerrada":
      result =
        compareNumber(
          a.cerrada
            ? 1
            : 0,

          b.cerrada
            ? 1
            : 0
        );
      break;


    case "ultimaGestion":
      result =
        compareNumber(
          a.ultimaGestionAt
            ? a.ultimaGestionAt.getTime()
            : 0,

          b.ultimaGestionAt
            ? b.ultimaGestionAt.getTime()
            : 0
        );
      break;


    case "ultimaReunion":
      result =
        compareNumber(
          a.fechaUltimaReunion
            ? a.fechaUltimaReunion.getTime()
            : 0,

          b.fechaUltimaReunion
            ? b.fechaUltimaReunion.getTime()
            : 0
        );
      break;


    case "documentos":
      result =
        compareText(
          getDocsSortText(a),
          getDocsSortText(b)
        );
      break;


    default:
      result =
        compareText(
          a.grupoSortTitle ||
          a.displayTitle,

          b.grupoSortTitle ||
          b.displayTitle
        );
      break;
  }

  return (
    sortDir === "desc"
      ? -result
      : result
  );
}

function compareText(a, b) {
  return String(a || "").localeCompare(String(b || ""), "es", {
    sensitivity: "base",
    numeric: true
  });
}

function compareNumber(a, b) {
  return Number(a || 0) - Number(b || 0);
}

function getDocsSortText(row) {
  return DOCS_META.map((item) => `${item.label}:${getDocLabel(row[item.key])}`).join(" | ");
}

/* =========================================================
   OPCIONES DE FILTROS
========================================================= */
function fillYearFilter() {
  const select =
    $("filtroAno");

  if (!select) {
    return;
  }

  const previous =
    state.anoSeleccionado ||
    String(
      getAnoViajePrincipal()
    );

  const years =
    getAnosSeguimientoDisponibles();

  select.innerHTML = `
    <option value="todos">
      Todos
    </option>

    ${years.map(
      (year) => `
        <option value="${year}">
          ${year}
        </option>
      `
    ).join("")}
  `;

  if (
    [...select.options].some(
      (option) =>
        option.value === previous
    )
  ) {
    select.value =
      previous;
  } else {
    select.value =
      String(
        getAnoViajePrincipal()
      );
  }
}

function fillVendorFilter(rows) {
  const select = $("filtroVendedora");
  if (!select) return;

  if (!state.canSeeAll) {
    select.innerHTML = `<option value="todos">Solo mis grupos</option>`;
    select.disabled = true;
    return;
  }

  const previous = select.value || "todos";
  const vendorMap = new Map();

  for (const row of rows) {
    if (!row.vendedora && !row.vendedoraCorreo) continue;

    const value = row.vendedoraCorreo || row.vendedora;
    const label = row.vendedora || row.vendedoraCorreo;

    if (!vendorMap.has(value)) {
      vendorMap.set(value, { value, label });
    }
  }

  const vendors = [...vendorMap.values()].sort((a, b) =>
    a.label.localeCompare(b.label, "es", { sensitivity: "base" })
  );

  select.disabled = false;
  select.innerHTML = `
    <option value="todos">Todos</option>
    ${vendors.map((v) => `<option value="${escapeAttr(v.value)}">${escapeHtml(v.label)}</option>`).join("")}
  `;

  if ([...select.options].some((opt) => opt.value === previous)) {
    select.value = previous;
  } else {
    select.value = "todos";
  }
}

/* =========================================================
   REGLAS DE NEGOCIO
========================================================= */
function normalizeEstado(value) {
  const v = normalizeText(value);

  if (!v) return "a_contactar";
  if (v.includes("perdid")) return "perdida";
  if (v.includes("reunion confirm") || v.includes("reunión confirm")) return "reunion_confirmada";
  if (v.includes("reunion") && v.includes("confirm")) return "reunion_confirmada";
  if (v.includes("recotiz")) return "recotizando";
  if (v.includes("cotiz")) return "cotizando";
  if (v.includes("contactad")) return "contactado";
  if (v.includes("ganad")) return "ganada";
  if (v.includes("cerrad")) return "ganada";
  if (v.includes("a contactar")) return "a_contactar";
  if (v.includes("contactar")) return "a_contactar";

  return "a_contactar";
}

function resolveFichaVisualState(data = {}) {
  const anoViajeNum = Number(data?.anoViaje || 0);
  const esLegacy2025 = anoViajeNum <= 2025;

  const flujoAbierto = !!data?.fichaFlujoAbierto;

  const tienePdf = !!cleanText(
    data?.ficha?.pdfUrl ||
    data?.fichaPdfUrl ||
    data?.ficha?.urlPdf ||
    ""
  );

  const autorizadaVisual = esLegacy2025
    ? resolveAutorizada(data)
    : (tienePdf && !flujoAbierto);

  const fichaCerrada = !flujoAbierto && (
    esLegacy2025
      ? resolveCerrada(data)
      : !!(
          data?.flowFicha?.vendedor?.firmado &&
          data?.flowFicha?.jefaVentas?.firmado &&
          data?.flowFicha?.administracion?.firmado
        )
  );

  return {
    autorizadaVisual,
    fichaCerrada,
    flujoAbierto,
    tienePdf
  };
}

function resolveAutorizada(data) {
  const raw = data.autorizada ?? data.autorizacion ?? data.estadoAutorizacion ?? null;

  if (typeof raw === "boolean") return raw;
  if (Array.isArray(raw)) return raw.some((v) => normalizeText(v).includes("autoriz"));
  if (typeof raw === "string") {
    const v = normalizeText(raw);
    return v.includes("autoriz") || v === "si" || v === "sí" || v === "true";
  }

  return false;
}

function resolveCerrada(data) {
  const raw = data.cerrada ?? data.cierre ?? data.estadoCierre ?? null;

  if (typeof raw === "boolean") return raw;
  if (Array.isArray(raw)) return raw.some((v) => normalizeText(v).includes("cerrad"));
  if (typeof raw === "string") {
    const v = normalizeText(raw);
    return v.includes("cerrad") || v === "si" || v === "sí" || v === "true";
  }

  return false;
}

function normalizeDocState(value) {
  if (typeof value === "boolean") {
    return value ? "ok" : "pendiente";
  }

  const v = normalizeText(value);

  if (!v) return "pendiente";
  if (v.includes("no aplica") || v === "na" || v === "n/a") return "no_aplica";

  if (
    v.includes("ok") ||
    v.includes("completo") ||
    v.includes("cumpl") ||
    v.includes("entreg") ||
    v.includes("confirmada_pdf") ||
    v.includes("pdf_confirmado") ||
    v.includes("confirmada")
  ) {
    return "ok";
  }

  if (v.includes("pend")) return "pendiente";

  return "pendiente";
}

function getDocCss(value) {
  if (value === "ok") return "seg-doc-ok";
  if (value === "pendiente") return "seg-doc-pendiente";
  if (value === "no_aplica") return "seg-doc-no-aplica";
  return "seg-doc-default";
}

function getDocLabel(value) {
  if (value === "ok") return "Cumplido";
  if (value === "pendiente") return "Pendiente";
  if (value === "no_aplica") return "No aplica";
  return "Sin definir";
}

/* =========================================================
   HELPERS
========================================================= */
function buildGrupoDisplayTitle(title = "", colegioFallback = "") {
  const raw = cleanText(title);
  if (!raw) return "";

  // Detecta cursos/años al inicio:
  // 1B (2026) 3B (2028) INSTITUTO...
  // 1B (2026) - 3B (2028) INSTITUTO...
  const match = raw.match(/^((?:\d{1,2}[A-ZÁÉÍÓÚÑ]*\s*\(\d{4}\)\s*(?:-|–|—)?\s*)+)(.+)$/i);

  if (!match) return raw;

  const cursos = cleanText(match[1])
    .replace(/\s+/g, " ")
    .replace(/\s*-\s*/g, " - ");

  const colegio = cleanText(match[2]) || cleanText(colegioFallback);

  if (!colegio || !cursos) return raw;

  return `${colegio} ${cursos}`.replace(/\s+/g, " ").trim();
}

function buildGrupoSortTitle(displayTitle = "", colegioFallback = "") {
  const title = cleanText(displayTitle);
  const colegio = cleanText(colegioFallback);

  // Prioridad: usar el título ya reordenado visualmente.
  // Ej: "INSTITUTO LA SALLE 1B (2026) - 3B (2028)"
  const base = title || colegio;

  return normalizeText(base)
    // elimina cursos/años al inicio
    .replace(/^(\d{1,2}[a-zñ]*\s*\(\d{4}\)\s*(?:-|–|—)?\s*)+/i, "")
    // elimina cursos/años al final
    .replace(/\s+(\d{1,2}[a-zñ]*\s*\(\d{4}\)\s*(?:-|–|—)?\s*)+$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildSearchIndex(values = []) {
  const raw = values
    .filter((v) => v !== null && v !== undefined)
    .map((v) => String(v))
    .join(" ");

  const normalized = normalizeText(raw);

  // Versión solo números para que encuentre 1596 aunque venga como "N° 1596" o "1596-2026"
  const numericOnly = raw.replace(/\D/g, " ");

  return normalizeText(`${normalized} ${numericOnly}`);
}

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function toDate(value) {
  if (!value) return null;

  if (value instanceof Date && !isNaN(value)) return value;

  if (typeof value?.toDate === "function") {
    const d = value.toDate();
    return isNaN(d) ? null : d;
  }

  if (typeof value === "number") {
    const d = new Date(value);
    return isNaN(d) ? null : d;
  }

  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!isNaN(parsed)) return parsed;

    const match = value.match(/^(\d{2})[-/](\d{2})[-/](\d{2,4})(?:\s+(\d{2}):(\d{2}))?$/);
    if (match) {
      const dd = Number(match[1]);
      const mm = Number(match[2]) - 1;
      let yy = Number(match[3]);
      if (yy < 100) yy += 2000;
      const hh = Number(match[4] || 0);
      const mi = Number(match[5] || 0);
      const d = new Date(yy, mm, dd, hh, mi);
      return isNaN(d) ? null : d;
    }
  }

  return null;
}

function formatDateTime(date, emptySub = "Sin registro") {
  if (!date) {
    return {
      main: "—",
      sub: emptySub
    };
  }

  return {
    main: date.toLocaleDateString("es-CL"),
    sub: date.toLocaleTimeString("es-CL", {
      hour: "2-digit",
      minute: "2-digit"
    })
  };
}

function formatRelativeDays(date) {
  if (!date) {
    return "";
  }

  const fecha =
    toDate(date);

  if (!fecha) {
    return "";
  }

  const hoy =
    new Date();

  const inicioHoy =
    new Date(
      hoy.getFullYear(),
      hoy.getMonth(),
      hoy.getDate()
    );

  const inicioFecha =
    new Date(
      fecha.getFullYear(),
      fecha.getMonth(),
      fecha.getDate()
    );

  const diferenciaMs =
    inicioHoy.getTime() -
    inicioFecha.getTime();

  const dias =
    Math.round(
      diferenciaMs /
      (
        1000 *
        60 *
        60 *
        24
      )
    );

  if (dias === 0) {
    return "hoy";
  }

  if (dias === 1) {
    return "ayer";
  }

  if (dias > 1) {
    return `hace ${dias} días`;
  }

  if (dias === -1) {
    return "mañana";
  }

  return `en ${Math.abs(dias)} días`;
}


function formatDateRelative(
  date,
  emptySub = "Sin registro"
) {
  const fecha =
    toDate(date);

  if (!fecha) {
    return {
      main: "—",
      sub: emptySub
    };
  }

  const fechaTexto =
    fecha.toLocaleDateString(
      "es-CL"
    );

  const horaTexto =
    fecha.toLocaleTimeString(
      "es-CL",
      {
        hour: "2-digit",
        minute: "2-digit"
      }
    );

  const relativo =
    formatRelativeDays(
      fecha
    );

  return {
    main:
      fechaTexto,

    sub:
      relativo
        ? `${horaTexto} · ${relativo}`
        : horaTexto
  };
}

function formatDateTimeText(date) {
  if (!date) return "";
  return `${date.toLocaleDateString("es-CL")} ${date.toLocaleTimeString("es-CL", {
    hour: "2-digit",
    minute: "2-digit"
  })}`;
}

function getInitials(text) {
  const parts = String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!parts.length) return "G";
  return parts.slice(0, 2).map((p) => p[0]?.toUpperCase() || "").join("");
}

function setText(id, value) {
  const el = $(id);
  if (el) el.textContent = String(value ?? "");
}

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttr(str) {
  return escapeHtml(str);
}

function escapeJs(str) {
  return String(str ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'");
}

function debounce(fn, wait = 150) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

function fileStamp() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}${mm}${dd}_${hh}${mi}`;
}
