import {
  auth,
  db,
  normalizeEmail,
  getVentasUser
} from "./firebase-init.js";

import {
  collection,
  getDocs,
  getDoc,
  doc,
  setDoc,
  addDoc,
  query,
  where,
  serverTimestamp
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

const $ = (id) => document.getElementById(id);

const ADMIN_CONTROL_COLLECTION = "ventas_administracion_control";
const ADMIN_CONFIG_COLLECTION = "ventas_configuracion";
const ADMIN_CONFIG_DOC = "administracion_control";
const HISTORIAL_COLLECTION = "ventas_historial";
const ADMIN_CONFIG_VERSIONES_SUBCOLLECTION = "versiones";
const JEFA_ADMINISTRACION_EMAIL = "administracion@raitrai.cl";

const EQUIPO_ADMINISTRACION = [
  "yenny@raitrai.cl",
  "raitrai@raitrai.cl",
  "contacto@raitrai.cl",
  "giras@raitrai.cl",
  "secretaria@raitrai.cl"
];


/*
  Mantenemos los IDs de la versión ya instalada para no perder
  los estados que ya alcanzaste a registrar.

  IMPORTANTE:
  - Los 5 nombres son configurables.
  - Ninguna función queda fija por nombre.
  - cicloId permite reutilizar una posición para una tarea nueva
    sin heredar los OK de la tarea anterior.
*/
const FUNCIONES_BASE = [
  {
    id: "estado_carnet",
    nombre: "Estado Carnet",
    activa: true,
    responsables: [],
    cicloId: "legacy"
  },
  {
    id: "estado_economico",
    nombre: "Estado Económico",
    activa: true,
    responsables: [],
    cicloId: "legacy"
  },
  {
    id: "variable_3",
    nombre: "",
    activa: false,
    responsables: [],
    cicloId: "legacy"
  },
  {
    id: "variable_4",
    nombre: "",
    activa: false,
    responsables: [],
    cicloId: "legacy"
  },
  {
    id: "variable_5",
    nombre: "",
    activa: false,
    responsables: [],
    cicloId: "legacy"
  }
];

const now = new Date();
const ANO_ACTUAL = now.getFullYear();

const state = {
  realUser: null,
  user: null,
  email: "",
  anoSeleccionado: ANO_ACTUAL,
  periodo: "7",
  fechaReferencia: fechaInputValue(new Date()),
  rows: [],
  config: {
    columnas: FUNCIONES_BASE.map((item) => ({ ...item }))
  },
  configActual: {
    columnas: FUNCIONES_BASE.map((item) => ({ ...item }))
  },
  controles: new Map(),
  historial: [],
  configVersiones: [],
  detalleFuncionId: ""
};

init();

async function init() {
  await waitForLayoutReady();
  configurarSelectorAno();
  configurarFechaReferencia();
  bindEvents();

  onAuthStateChanged(auth, async (firebaseUser) => {
    if (!firebaseUser) {
      location.href = "login.html";
      return;
    }

    await bootstrap();

    if (!puedeSupervisarAdministracion()) {
      alert("Solo la Jefatura de Administración o un usuario Admin pueden acceder a este panel.");
      location.href = "gestion-nomina.html";
      return;
    }

    bindHeader();
    await cargarPantalla();
  });
}

async function bootstrap() {
  state.realUser = getRealUser();
  state.user = getEffectiveUser();

  const resolved = getVentasUser(
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

  state.email = normalizeEmail(
    state.user?.email ||
    auth.currentUser?.email ||
    ""
  );
}

function getRolActual() {
  return normalizar(state.user?.rol || "").replace(/\s+/g, "_");
}

function puedeSupervisarAdministracion() {
  return (
    getRolActual() === "admin" ||
    normalizeEmail(state.email) === JEFA_ADMINISTRACION_EMAIL
  );
}

function getNombreUsuario() {
  return (
    [state.user?.nombre, state.user?.apellido]
      .filter(Boolean)
      .join(" ")
      .trim() ||
    state.email ||
    "Usuario"
  );
}

function getNombreEquipoAdministracion(email = "") {
  const correo = normalizeEmail(email);
  if (!correo) return "Sin usuario";

  const user = getVentasUser(correo);
  if (!user) return correo;

  return (
    [user.nombre, user.apellido]
      .filter(Boolean)
      .join(" ")
      .trim() ||
    user.nombre ||
    correo
  );
}

function fechaInputValue(date = new Date()) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "";

  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0")
  ].join("-");
}

function dateFromInput(value = "") {
  const [year, month, day] = String(value || "")
    .split("-")
    .map(Number);

  if (!year || !month || !day) return new Date();
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function configurarFechaReferencia() {
  const input = $("adminFechaReferencia");
  if (!input) return;

  const params = new URLSearchParams(location.search);
  const fechaUrl = params.get("fecha");

  state.fechaReferencia = /^\d{4}-\d{2}-\d{2}$/.test(fechaUrl || "")
    ? fechaUrl
    : fechaInputValue(new Date());

  input.value = state.fechaReferencia;
  input.max = fechaInputValue(new Date());
}

function esFechaReferenciaHoy() {
  return state.fechaReferencia === fechaInputValue(new Date());
}

function finFechaReferencia() {
  const d = dateFromInput(state.fechaReferencia);
  d.setHours(23, 59, 59, 999);
  return d;
}

function bindHeader() {
  bindLayoutButtons({
    homeUrl: "index.html",

    onLogout: async () => {
      sessionStorage.removeItem(ACTING_USER_KEY);
      await signOut(auth);
      location.href = "login.html";
    },

    onActAs: async (selected) => {
      if (state.realUser?.rol !== "admin" || !selected) return;

      sessionStorage.setItem(ACTING_USER_KEY, selected);
      await bootstrap();

      if (!puedeSupervisarAdministracion()) {
        location.href = "gestion-nomina.html";
        return;
      }

      await cargarPantalla();
    },

    onResetActAs: async () => {
      sessionStorage.removeItem(ACTING_USER_KEY);
      await bootstrap();
      await cargarPantalla();
    }
  });
}

function configurarSelectorAno() {
  const select = $("adminAno");
  if (!select) return;

  const anos = [];

  for (let year = ANO_ACTUAL + 2; year >= ANO_ACTUAL - 1; year -= 1) {
    anos.push(year);
  }

  select.innerHTML = anos
    .map((year) => `<option value="${year}">${year}</option>`)
    .join("");

  select.value = String(state.anoSeleccionado);
}

function bindEvents() {
  $("adminAno")?.addEventListener("change", async () => {
    state.anoSeleccionado = Number($("adminAno")?.value || ANO_ACTUAL);
    state.detalleFuncionId = "";
    await cargarPantalla();
  });

  $("adminPeriodo")?.addEventListener("change", () => {
    state.periodo = $("adminPeriodo")?.value || "7";
    renderTodo();
  });

  $("adminFechaReferencia")?.addEventListener("change", async () => {
    state.fechaReferencia = $("adminFechaReferencia")?.value || fechaInputValue(new Date());
    state.detalleFuncionId = "";
    aplicarConfiguracionReferencia();
    renderTodo();
  });

  $("btnFechaHoy")?.addEventListener("click", () => {
    state.fechaReferencia = fechaInputValue(new Date());
    if ($("adminFechaReferencia")) {
      $("adminFechaReferencia").value = state.fechaReferencia;
    }
    aplicarConfiguracionReferencia();
    renderTodo();
  });

  $("btnExportarXls")?.addEventListener("click", exportarXlsAdministracion);

  $("adminBuscar")?.addEventListener("input", debounce(renderTodo, 150));

  $("btnRecargarAdmin")?.addEventListener("click", cargarPantalla);

  $("btnVolverNomina")?.addEventListener("click", () => {
    location.href = `gestion-nomina.html?ano=${encodeURIComponent(state.anoSeleccionado)}`;
  });

  $("btnIrConfiguracion")?.addEventListener("click", () => {
    $("configuracionSection")?.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  });

  $("btnGuardarConfiguracion")?.addEventListener("click", guardarConfiguracion);

  $("funcionesResumen")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-ver-pendientes]");
    if (!button) return;

    state.detalleFuncionId = button.dataset.verPendientes || "";
    renderDetallePendientes();

    $("detallePendientesSection")?.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  });

  $("btnCerrarDetallePendientes")?.addEventListener("click", () => {
    state.detalleFuncionId = "";
    renderDetallePendientes();
  });

  $("detallePendientesLista")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-abrir-grupo]");
    if (!button) return;

    window.open(
      `grupo.html?id=${encodeURIComponent(button.dataset.abrirGrupo || "")}`,
      "_blank",
      "noopener"
    );
  });

  $("configFunciones")?.addEventListener("change", (event) => {
    const all = event.target.closest("[data-responsables-todos]");
    if (!all) return;

    const id = all.dataset.responsablesTodos;
    const checked = all.checked === true;

    document
      .querySelectorAll(`[data-responsable-funcion="${cssEscape(id)}"]`)
      .forEach((input) => {
        input.checked = checked;
      });
  });
}

async function cargarPantalla() {
  set("kGrupos", "…");
  set("kOk", "…");
  set("kPendientes", "…");
  set("kAvance", "…");

  await cargarConfiguracion();

  await Promise.all([
    cargarVersionesConfiguracion(),
    cargarGrupos(),
    cargarControles(),
    cargarHistorial()
  ]);

  await asegurarVersionInicialConfiguracion();
  aplicarConfiguracionReferencia();
  renderTodo();
}

async function cargarConfiguracion() {
  try {
    const snap = await getDoc(
      doc(db, ADMIN_CONFIG_COLLECTION, ADMIN_CONFIG_DOC)
    );

    state.configActual = normalizarConfiguracion(
      snap.exists() ? snap.data() : {}
    );
    state.config = normalizarConfiguracion(state.configActual);
  } catch (error) {
    console.error("[gestion-administracion] cargarConfiguracion", error);
    state.configActual = normalizarConfiguracion({});
    state.config = normalizarConfiguracion(state.configActual);
  }
}

async function cargarVersionesConfiguracion() {
  state.configVersiones = [];

  try {
    const snap = await getDocs(
      collection(
        db,
        ADMIN_CONFIG_COLLECTION,
        ADMIN_CONFIG_DOC,
        ADMIN_CONFIG_VERSIONES_SUBCOLLECTION
      )
    );

    state.configVersiones = snap.docs
      .map((documento) => ({
        id: documento.id,
        ...documento.data()
      }))
      .sort((a, b) => getVersionDesdeMs(a) - getVersionDesdeMs(b));
  } catch (error) {
    console.error("[gestion-administracion] cargarVersionesConfiguracion", error);
    state.configVersiones = [];
  }
}

function getVersionDesdeMs(version = {}) {
  return (
    fechaMs(version.vigenteDesde) ||
    fechaMs(version.vigenteDesdeCliente) ||
    fechaMs(version.fecha) ||
    0
  );
}

async function asegurarVersionInicialConfiguracion() {
  if (state.configVersiones.length) return;

  const columnas = (state.config?.columnas || []).map((item) => ({
    ...item,
    responsables: [...(item.responsables || [])]
  }));

  if (!columnas.length) return;

  try {
    const versionId = `v_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const ref = doc(
      db,
      ADMIN_CONFIG_COLLECTION,
      ADMIN_CONFIG_DOC,
      ADMIN_CONFIG_VERSIONES_SUBCOLLECTION,
      versionId
    );

    const vigenteDesdeCliente = new Date().toISOString();

    await setDoc(ref, {
      versionId,
      anoContexto: Number(state.anoSeleccionado),
      columnas,
      equipo: EQUIPO_ADMINISTRACION,
      vigenteDesde: serverTimestamp(),
      vigenteDesdeCliente,
      creadoPor: getNombreUsuario(),
      creadoPorCorreo: state.email
    });

    state.configVersiones.push({
      id: versionId,
      versionId,
      anoContexto: Number(state.anoSeleccionado),
      columnas,
      equipo: EQUIPO_ADMINISTRACION,
      vigenteDesdeCliente,
      creadoPor: getNombreUsuario(),
      creadoPorCorreo: state.email
    });
  } catch (error) {
    console.error("[gestion-administracion] asegurarVersionInicialConfiguracion", error);
  }
}

function getConfiguracionParaFecha(fecha = state.fechaReferencia) {
  const fin = dateFromInput(fecha);
  fin.setHours(23, 59, 59, 999);
  const limite = fin.getTime();

  const candidatas = state.configVersiones
    .filter((item) => getVersionDesdeMs(item) <= limite)
    .sort((a, b) => getVersionDesdeMs(b) - getVersionDesdeMs(a));

  if (!candidatas.length) {
    return normalizarConfiguracion(state.config || {});
  }

  return normalizarConfiguracion(candidatas[0]);
}

function aplicarConfiguracionReferencia() {
  if (esFechaReferenciaHoy()) {
    state.config = normalizarConfiguracion(state.configActual || {});
    return;
  }

  state.config = getConfiguracionParaFecha(state.fechaReferencia);
}

function normalizarConfiguracion(data = {}) {
  const recibidas = Array.isArray(data.columnas)
    ? data.columnas
    : [];

  const recibidasMap = new Map(
    recibidas.map((item) => [String(item.id || ""), item])
  );

  return {
    columnas: FUNCIONES_BASE.map((base) => {
      const guardada = recibidasMap.get(base.id) || {};

      const nombre = String(
        guardada.nombre !== undefined
          ? guardada.nombre
          : base.nombre
      ).trim();

      const responsables = Array.isArray(guardada.responsables)
        ? [...new Set(
            guardada.responsables
              .map(normalizeEmail)
              .filter((email) => EQUIPO_ADMINISTRACION.includes(email))
          )]
        : [];

      return {
        id: base.id,
        nombre,
        activa:
          guardada.activa !== undefined
            ? guardada.activa === true && !!nombre
            : base.activa === true && !!nombre,
        responsables,
        cicloId: String(guardada.cicloId || base.cicloId || "legacy")
      };
    })
  };
}

async function cargarGrupos() {
  try {
    const snap = await getDocs(
      query(
        collection(db, "ventas_grupos_resumen"),
        where("anoViaje", "==", Number(state.anoSeleccionado))
      )
    );

    state.rows = snap.docs
      .map((documento) => mapRow(documento.id, documento.data() || {}))
      .filter((row) => row.estado === "ganada")
      .sort((a, b) =>
        a.titulo.localeCompare(b.titulo, "es", {
          sensitivity: "base",
          numeric: true
        })
      );
  } catch (error) {
    console.error("[gestion-administracion] cargarGrupos", error);
    state.rows = [];
  }
}

async function cargarControles() {
  state.controles = new Map();

  try {
    const snap = await getDocs(
      query(
        collection(db, ADMIN_CONTROL_COLLECTION),
        where("anoViaje", "==", Number(state.anoSeleccionado))
      )
    );

    snap.docs.forEach((documento) => {
      const data = {
        id: documento.id,
        ...documento.data()
      };

      registrarAliasControl(documento.id, data);
      registrarAliasControl(data.groupDocId, data);
      registrarAliasControl(data.idGrupo, data);
    });
  } catch (error) {
    console.error("[gestion-administracion] cargarControles", error);
  }
}

function registrarAliasControl(key = "", data = {}) {
  const normalized = String(key || "").trim();
  if (!normalized) return;

  state.controles.set(normalized, data);
}

async function cargarHistorial() {
  state.historial = [];

  try {
    const snap = await getDocs(
      query(
        collection(db, HISTORIAL_COLLECTION),
        where("modulo", "==", "administracion")
      )
    );

    state.historial = snap.docs
      .map((documento) => ({
        id: documento.id,
        ...documento.data()
      }))
      .filter(
        (item) =>
          Number(item.anoViaje || 0) ===
          Number(state.anoSeleccionado)
      )
      .sort((a, b) => fechaMs(b.fecha) - fechaMs(a.fecha));
  } catch (error) {
    console.error("[gestion-administracion] cargarHistorial", error);
    state.historial = [];
  }
}

function mapRow(id, data = {}) {
  return {
    id: String(id || ""),
    docId: String(data.groupDocId || id || ""),
    groupId: String(data.idGrupo || id || ""),
    negocio: String(data.numeroNegocio || data.negocioId || ""),
    titulo:
      data.aliasGrupo ||
      [data.colegio, data.curso].filter(Boolean).join(" ") ||
      `Grupo ${id}`,
    colegio: data.colegio || "",
    curso: data.curso || "",
    estado: normalizar(data.estado || data.estadoComercial || ""),
    search: normalizar(
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
        data.destino
      ]
        .filter(Boolean)
        .join(" ")
    )
  };
}

function getFuncionesActivas() {
  return (state.config?.columnas || []).filter(
    (item) => item.activa === true && String(item.nombre || "").trim()
  );
}

function getFuncion(id = "") {
  return (state.config?.columnas || []).find(
    (item) => String(item.id) === String(id)
  ) || null;
}

function getControlGrupo(row = {}) {
  const claves = [
    row.docId,
    row.id,
    row.groupId
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  for (const key of claves) {
    if (state.controles.has(key)) {
      return state.controles.get(key);
    }
  }

  return { controles: {} };
}

function getEstadoFuncion(row = {}, funcion = {}) {
  if (!esFechaReferenciaHoy()) {
    return getEstadoFuncionHistorico(row, funcion);
  }

  const documento = getControlGrupo(row);
  const control = documento?.controles?.[funcion.id] || {};

  if (normalizar(control.estado || "") !== "ok") {
    return "pendiente";
  }

  const cicloEsperado = String(funcion.cicloId || "legacy");
  const cicloControl = String(control.cicloId || "legacy");

  return cicloEsperado === cicloControl
    ? "ok"
    : "pendiente";
}

function getEstadoFuncionHistorico(row = {}, funcion = {}) {
  const limite = finFechaReferencia().getTime();
  const idsGrupo = new Set(
    [row.docId, row.id, row.groupId]
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  );

  const cicloEsperado = String(funcion.cicloId || "legacy");

  const movimientos = state.historial
    .filter((item) => item.tipoMovimiento === "control_administracion")
    .filter((item) => fechaMs(item.fecha) <= limite)
    .filter((item) => {
      const groupKey = String(item.groupDocId || item.idGrupo || "").trim();
      return idsGrupo.has(groupKey);
    })
    .filter((item) => String(item?.metadata?.controlId || "") === String(funcion.id))
    .filter((item) => String(item?.metadata?.cicloId || "legacy") === cicloEsperado)
    .sort((a, b) => fechaMs(b.fecha) - fechaMs(a.fecha));

  if (!movimientos.length) return "pendiente";

  return normalizar(movimientos[0]?.metadata?.nuevo || "") === "ok"
    ? "ok"
    : "pendiente";
}

function getRowsVisibles() {
  const q = normalizar($("adminBuscar")?.value || "");

  if (!q) return state.rows;

  return state.rows.filter((row) => row.search.includes(q));
}

function getResumenActual() {
  const rows = getRowsVisibles();
  const funciones = getFuncionesActivas();

  const detalle = funciones.map((funcion) => {
    const ok = rows.filter(
      (row) => getEstadoFuncion(row, funcion) === "ok"
    ).length;

    const total = rows.length;
    const pendientes = Math.max(total - ok, 0);
    const porcentaje = total
      ? Math.round((ok / total) * 100)
      : 0;

    return {
      ...funcion,
      ok,
      pendientes,
      total,
      porcentaje
    };
  });

  const totalTareas = rows.length * funciones.length;
  const totalOk = detalle.reduce((sum, item) => sum + item.ok, 0);
  const pendientes = Math.max(totalTareas - totalOk, 0);

  return {
    grupos: rows.length,
    totalTareas,
    totalOk,
    pendientes,
    porcentaje: totalTareas
      ? Math.round((totalOk / totalTareas) * 100)
      : 0,
    detalle
  };
}

function inicioDia(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getInicioPeriodo() {
  const referencia = dateFromInput(state.fechaReferencia);
  const periodo = String(state.periodo || "7");

  if (periodo === "hoy") {
    return inicioDia(referencia);
  }

  if (periodo === "ayer") {
    const ayer = inicioDia(referencia);
    ayer.setDate(ayer.getDate() - 1);
    return ayer;
  }

  if (periodo === "mes") {
    return new Date(referencia.getFullYear(), referencia.getMonth(), 1);
  }

  const dias = Number(periodo || 7);
  const inicio = inicioDia(referencia);
  inicio.setDate(inicio.getDate() - Math.max(dias - 1, 0));
  return inicio;
}

function getFinPeriodo() {
  const referencia = dateFromInput(state.fechaReferencia);

  if (String(state.periodo) === "ayer") {
    const fin = inicioDia(referencia);
    fin.setMilliseconds(-1);
    return fin;
  }

  referencia.setHours(23, 59, 59, 999);
  return referencia;
}

function getHistorialPeriodo() {
  const inicio = getInicioPeriodo().getTime();
  const fin = getFinPeriodo().getTime();

  return state.historial.filter((item) => {
    const ms = fechaMs(item.fecha);
    return ms >= inicio && ms <= fin;
  });
}

function esOk(item = {}) {
  return normalizar(item?.metadata?.nuevo || "") === "ok";
}

function esReapertura(item = {}) {
  return (
    normalizar(item?.metadata?.anterior || "") === "ok" &&
    normalizar(item?.metadata?.nuevo || "") === "pendiente"
  );
}

function getFechaClave(value) {
  const ms = fechaMs(value);
  if (!ms) return "";

  const d = new Date(ms);

  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0")
  ].join("-");
}

function formatDiaCorto(key = "") {
  if (!key) return "—";

  const [year, month, day] = key.split("-").map(Number);
  const date = new Date(year, month - 1, day);

  return date
    .toLocaleDateString("es-CL", {
      weekday: "short",
      day: "2-digit",
      month: "2-digit"
    })
    .replace(".", "");
}

function getActividadPorDia(historial = []) {
  const map = new Map();

  historial.forEach((item) => {
    const key = getFechaClave(item.fecha);
    if (!key) return;

    if (!map.has(key)) {
      map.set(key, {
        fecha: key,
        ok: 0,
        reabiertos: 0,
        grupos: new Set()
      });
    }

    const row = map.get(key);

    if (esOk(item)) row.ok += 1;
    if (esReapertura(item)) row.reabiertos += 1;

    const grupo = String(item.groupDocId || item.idGrupo || "");
    if (grupo) row.grupos.add(grupo);
  });

  return [...map.values()]
    .map((item) => ({
      fecha: item.fecha,
      ok: item.ok,
      reabiertos: item.reabiertos,
      grupos: item.grupos.size
    }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
}

function getActividadPorPersona(historial = []) {
  const map = new Map();

  historial.forEach((item) => {
    const correo = normalizeEmail(
      item.creadoPorCorreo ||
      item.usuarioCorreo ||
      ""
    );

    const nombre = String(
      item.creadoPor ||
      item.usuarioNombre ||
      LABEL_EQUIPO[correo] ||
      correo ||
      "Sin usuario"
    );

    const key = correo || normalizar(nombre);

    if (!map.has(key)) {
      map.set(key, {
        correo,
        nombre,
        ok: 0,
        reabiertos: 0,
        grupos: new Set(),
        dias: new Set(),
        funciones: new Map()
      });
    }

    const row = map.get(key);

    if (esOk(item)) row.ok += 1;
    if (esReapertura(item)) row.reabiertos += 1;

    const grupo = String(item.groupDocId || item.idGrupo || "");
    if (grupo) row.grupos.add(grupo);

    const dia = getFechaClave(item.fecha);
    if (dia) row.dias.add(dia);

    if (esOk(item)) {
      const nombreFuncion = String(
        item?.metadata?.controlNombre ||
        item?.metadata?.controlId ||
        "Otra función"
      );

      row.funciones.set(
        nombreFuncion,
        (row.funciones.get(nombreFuncion) || 0) + 1
      );
    }
  });

  return [...map.values()]
    .map((item) => ({
      correo: item.correo,
      nombre: item.nombre,
      ok: item.ok,
      reabiertos: item.reabiertos,
      grupos: item.grupos.size,
      dias: item.dias.size,
      funciones: [...item.funciones.entries()].sort((a, b) => b[1] - a[1])
    }))
    .sort((a, b) => b.ok - a.ok);
}

function getActividadPorFuncion(historial = []) {
  const map = new Map();

  historial.forEach((item) => {
    const controlId = String(item?.metadata?.controlId || "");
    if (!controlId) return;

    if (!map.has(controlId)) {
      map.set(controlId, {
        controlId,
        nombre: String(item?.metadata?.controlNombre || controlId),
        ok: 0,
        reabiertos: 0,
        grupos: new Set()
      });
    }

    const row = map.get(controlId);

    if (esOk(item)) row.ok += 1;
    if (esReapertura(item)) row.reabiertos += 1;

    const grupo = String(item.groupDocId || item.idGrupo || "");
    if (grupo) row.grupos.add(grupo);
  });

  return [...map.values()]
    .map((item) => ({
      ...item,
      grupos: item.grupos.size
    }))
    .sort((a, b) => b.ok - a.ok);
}

function getCargaEquipo(historialPeriodo = []) {
  const funciones = getFuncionesActivas();
  const actividad = getActividadPorPersona(historialPeriodo);

  return EQUIPO_ADMINISTRACION.map((email) => {
    const asignadas = funciones.filter((funcion) =>
      (funcion.responsables || []).includes(email)
    );

    const pendientes = asignadas.reduce((total, funcion) => {
      return total + state.rows.filter(
        (row) => getEstadoFuncion(row, funcion) !== "ok"
      ).length;
    }, 0);

    const actividadPersona = actividad.find(
      (item) => normalizeEmail(item.correo) === email
    ) || {
      ok: 0,
      grupos: 0,
      dias: 0
    };

    return {
      email,
      nombre: LABEL_EQUIPO[email] || email,
      asignadas,
      pendientes,
      okPeriodo: actividadPersona.ok,
      gruposPeriodo: actividadPersona.grupos,
      diasPeriodo: actividadPersona.dias
    };
  });
}

function renderTodo() {
  renderConfiguracion();
  renderResumenActual();
  renderActividad();
  renderDetallePendientes();
}

function renderResumenActual() {
  const resumen = getResumenActual();

  set("kGrupos", resumen.grupos);
  set("kOk", resumen.totalOk);
  set("kPendientes", resumen.pendientes);
  set("kAvance", `${resumen.porcentaje}%`);

  const cont = $("funcionesResumen");

  if (cont) {
    cont.innerHTML = resumen.detalle.length
      ? resumen.detalle.map((item) => `
          <article class="funcion-card">
            <div class="funcion-card-head">
              <div>
                <h3>${esc(item.nombre)}</h3>
              </div>
              <div class="porcentaje">${item.porcentaje}%</div>
            </div>

            <div class="funcion-progress">
              <div style="width:${item.porcentaje}%"></div>
            </div>

            <div class="funcion-values">
              <span><strong>${item.ok}</strong> OK</span>

              <button
                type="button"
                data-ver-pendientes="${esc(item.id)}"
              >
                ${item.pendientes} pendientes
              </button>
            </div>

            <div class="responsables-line">
              <strong>Responsables:</strong>
              ${esc(formatResponsables(item.responsables))}
            </div>
          </article>
        `).join("")
      : `<div class="empty">No hay funciones activas. Configura al menos una.</div>`;
  }
}

function renderActividad() {
  const historial = getHistorialPeriodo();
  const porDia = getActividadPorDia(historial);
  const porPersona = getActividadPorPersona(historial);
  const porFuncion = getActividadPorFuncion(historial);
  const cargaEquipo = getCargaEquipo(historial);

  const ok = historial.filter(esOk).length;
  const reabiertas = historial.filter(esReapertura).length;
  const grupos = new Set(
    historial
      .map((item) => String(item.groupDocId || item.idGrupo || ""))
      .filter(Boolean)
  ).size;

  set("kPeriodoOk", ok);
  set("kPeriodoReabiertas", reabiertas);
  set("kPeriodoGrupos", grupos);

  renderGrafico(porDia);
  renderEquipo(cargaEquipo);
  renderActividadFunciones(porFuncion);
  renderActividadPersonas(porPersona);
}

function renderGrafico(rows = []) {
  const cont = $("actividadGrafico");
  if (!cont) return;

  if (!rows.length) {
    cont.innerHTML = `<div class="empty">No hay actividad en este período.</div>`;
    return;
  }

  const max = Math.max(...rows.map((item) => item.ok), 1);

  cont.innerHTML = rows.map((item) => {
    const height = item.ok
      ? Math.max((item.ok / max) * 100, 4)
      : 0;

    return `
      <div class="chart-col">
        <div class="chart-value">${item.ok}</div>
        <div class="chart-track">
          <div class="chart-bar" style="height:${height}%"></div>
        </div>
        <div class="chart-label">${esc(formatDiaCorto(item.fecha))}</div>
      </div>
    `;
  }).join("");
}

function renderEquipo(rows = []) {
  const tbody = $("equipoTbody");
  if (!tbody) return;

  tbody.innerHTML = rows.map((item) => `
    <tr>
      <td>
        <strong>${esc(item.nombre)}</strong>
        <div class="sub">${esc(item.email)}</div>
      </td>
      <td>
        ${item.asignadas.length
          ? item.asignadas.map((funcion) => `<span class="tag">${esc(funcion.nombre)}</span>`).join("")
          : `<span class="sub">Sin funciones asignadas</span>`}
      </td>
      <td><strong>${item.pendientes}</strong></td>
      <td><strong>${item.okPeriodo}</strong></td>
      <td>${item.gruposPeriodo}</td>
      <td>${item.diasPeriodo}</td>
    </tr>
  `).join("");
}

function renderActividadFunciones(rows = []) {
  const tbody = $("funcionesActividadTbody");
  if (!tbody) return;

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty">Sin actividad para este período.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map((item) => {
    const funcionActual = getFuncion(item.controlId);

    return `
      <tr>
        <td><strong>${esc(item.nombre)}</strong></td>
        <td><strong>${item.ok}</strong></td>
        <td>${item.reabiertos}</td>
        <td>${item.grupos}</td>
        <td>${esc(formatResponsables(funcionActual?.responsables || []))}</td>
      </tr>
    `;
  }).join("");
}

function renderActividadPersonas(rows = []) {
  const tbody = $("personasActividadTbody");
  if (!tbody) return;

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty">Sin actividad para este período.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map((item) => `
    <tr>
      <td>
        <strong>${esc(item.nombre)}</strong>
        ${item.correo ? `<div class="sub">${esc(item.correo)}</div>` : ""}
      </td>
      <td><strong>${item.ok}</strong></td>
      <td>${item.reabiertos}</td>
      <td>${item.grupos}</td>
      <td>${item.dias}</td>
      <td>
        ${item.funciones.length
          ? item.funciones.map(([nombre, cantidad]) => `<div>${esc(nombre)} · <strong>${cantidad}</strong></div>`).join("")
          : "—"}
      </td>
    </tr>
  `).join("");
}

function renderDetallePendientes() {
  const section = $("detallePendientesSection");
  const list = $("detallePendientesLista");

  if (!section || !list) return;

  const funcion = getFuncion(state.detalleFuncionId);

  if (!funcion || funcion.activa !== true) {
    section.classList.add("hidden");
    list.innerHTML = "";
    return;
  }

  const q = normalizar($("adminBuscar")?.value || "");

  const rows = state.rows
    .filter((row) => !q || row.search.includes(q))
    .filter((row) => getEstadoFuncion(row, funcion) !== "ok");

  section.classList.remove("hidden");

  set("detallePendientesTitulo", `Pendientes · ${funcion.nombre}`);
  set(
    "detallePendientesSubtitulo",
    `${rows.length} grupo${rows.length === 1 ? "" : "s"} pendiente${rows.length === 1 ? "" : "s"}.`
  );

  list.innerHTML = rows.length
    ? rows.map((row) => `
        <div class="detail-row">
          <div>
            <strong>${esc(row.titulo)}</strong>
            <div class="sub">
              ID ${esc(row.groupId || row.docId)} · Negocio ${esc(row.negocio || "—")}
            </div>
          </div>

          <button
            class="admin-btn secondary"
            type="button"
            data-abrir-grupo="${esc(row.groupId || row.docId)}"
          >
            Abrir grupo
          </button>
        </div>
      `).join("")
    : `<div class="empty">✓ No quedan grupos pendientes en esta función.</div>`;
}

function renderConfiguracion() {
  const cont = $("configFunciones");
  if (!cont) return;

  const historica = !esFechaReferenciaHoy();

  cont.innerHTML = (state.config?.columnas || []).map((funcion, index) => {
    const todosAsignados = EQUIPO_ADMINISTRACION.every(
      (email) => (funcion.responsables || []).includes(email)
    );

    return `
      <div class="config-row" data-config-funcion="${esc(funcion.id)}">
        <div class="admin-field">
          <label>Función ${index + 1}</label>
          <input
            type="text"
            data-config-nombre="${esc(funcion.id)}"
            value="${esc(funcion.nombre || "")}"
            placeholder="Nombre de la función"
            ${historica ? "disabled" : ""}
          />
        </div>

        <label class="config-active">
          <input
            type="checkbox"
            data-config-activa="${esc(funcion.id)}"
            ${funcion.activa === true ? "checked" : ""}
            ${historica ? "disabled" : ""}
          />
          Activa
        </label>

        <div class="config-responsables">
          <label class="all-team">
            <input
              type="checkbox"
              data-responsables-todos="${esc(funcion.id)}"
              ${todosAsignados ? "checked" : ""}
              ${historica ? "disabled" : ""}
            />
            Asignar a todo el equipo
          </label>

          ${EQUIPO_ADMINISTRACION.map((email) => `
            <label title="${esc(email)}">
              <input
                type="checkbox"
                data-responsable-funcion="${esc(funcion.id)}"
                value="${esc(email)}"
                ${(funcion.responsables || []).includes(email) ? "checked" : ""}
                ${historica ? "disabled" : ""}
              />
              ${esc(getNombreEquipoAdministracion(email))}
            </label>
          `).join("")}
        </div>
      </div>
    `;
  }).join("");

  const button = $("btnGuardarConfiguracion");
  if (button) {
    button.disabled = historica;
    button.title = historica
      ? "Vuelve a la fecha de hoy para modificar la organización."
      : "";
  }

  const aviso = $("configHistoricaAviso");
  if (aviso) {
    aviso.classList.toggle("hidden", !historica);
  }
}

async function guardarConfiguracion() {
  if (!puedeSupervisarAdministracion()) return;

  if (!esFechaReferenciaHoy()) {
    alert("Estás viendo una fecha histórica. Vuelve a Hoy para modificar funciones y responsables.");
    return;
  }

  const actuales = state.config?.columnas || [];
  const nuevas = [];
  const funcionesRenombradas = [];
  const cambiosHistorial = [];

  for (const actual of actuales) {
    const nombre = String(
      document.querySelector(`[data-config-nombre="${cssEscape(actual.id)}"]`)?.value || ""
    ).trim();

    const activa =
      document.querySelector(`[data-config-activa="${cssEscape(actual.id)}"]`)?.checked === true &&
      !!nombre;

    const responsables = [...document.querySelectorAll(
      `[data-responsable-funcion="${cssEscape(actual.id)}"]:checked`
    )]
      .map((input) => normalizeEmail(input.value || ""))
      .filter((email) => EQUIPO_ADMINISTRACION.includes(email));

    const nombreCambio = normalizar(nombre) !== normalizar(actual.nombre || "");

    if (nombreCambio) {
      funcionesRenombradas.push({
        anterior: actual.nombre || "Sin nombre",
        nuevo: nombre || "Desactivada"
      });
    }

    const responsablesAntes = [...(actual.responsables || [])].sort().join(",");
    const responsablesAhora = [...responsables].sort().join(",");

    if (nombreCambio || activa !== actual.activa || responsablesAntes !== responsablesAhora) {
      cambiosHistorial.push({
        campo: actual.nombre || `Función ${actual.id}`,
        anterior: JSON.stringify({
          nombre: actual.nombre || "",
          activa: actual.activa === true,
          responsables: actual.responsables || []
        }),
        nuevo: JSON.stringify({
          nombre,
          activa,
          responsables
        })
      });
    }

    nuevas.push({
      id: actual.id,
      nombre,
      activa,
      responsables,
      cicloId: nombreCambio
        ? crearCicloId(actual.id)
        : String(actual.cicloId || "legacy")
    });
  }

  if (funcionesRenombradas.length) {
    const detalle = funcionesRenombradas
      .map((item) => `• ${item.anterior} → ${item.nuevo}`)
      .join("\n");

    const confirmar = confirm(
      "Cambiaste el nombre de una o más funciones.\n\n" +
      "Al tratarse como una función nueva, sus estados actuales volverán a PENDIENTE para esa columna. El historial anterior se conserva.\n\n" +
      detalle +
      "\n\n¿Guardar igualmente?"
    );

    if (!confirmar) return;
  }

  const button = $("btnGuardarConfiguracion");
  const original = button?.textContent || "Guardar organización";

  try {
    if (button) {
      button.disabled = true;
      button.textContent = "Guardando...";
    }

    await setDoc(
      doc(db, ADMIN_CONFIG_COLLECTION, ADMIN_CONFIG_DOC),
      {
        version: 2,
        columnas: nuevas,
        equipo: EQUIPO_ADMINISTRACION,
        actualizadoAt: serverTimestamp(),
        actualizadoPor: getNombreUsuario(),
        actualizadoPorCorreo: state.email
      },
      { merge: true }
    );

    const versionId = `v_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const vigenteDesdeCliente = new Date().toISOString();

    await setDoc(
      doc(
        db,
        ADMIN_CONFIG_COLLECTION,
        ADMIN_CONFIG_DOC,
        ADMIN_CONFIG_VERSIONES_SUBCOLLECTION,
        versionId
      ),
      {
        versionId,
        anoContexto: Number(state.anoSeleccionado),
        columnas: nuevas,
        equipo: EQUIPO_ADMINISTRACION,
        vigenteDesde: serverTimestamp(),
        vigenteDesdeCliente,
        creadoPor: getNombreUsuario(),
        creadoPorCorreo: state.email
      }
    );

    if (cambiosHistorial.length) {
      await addDoc(
        collection(db, HISTORIAL_COLLECTION),
        {
          modulo: "administracion",
          tipoMovimiento: "configuracion_administracion",
          titulo: "Configuración de funciones de Administración",
          mensaje: `${getNombreUsuario()} actualizó funciones y responsables de Administración.`,
          anoViaje: Number(state.anoSeleccionado),
          cambios: cambiosHistorial,
          metadata: {
            tipo: "configuracion_funciones"
          },
          creadoPor: getNombreUsuario(),
          creadoPorCorreo: state.email,
          fecha: serverTimestamp()
        }
      );
    }

    state.configActual = normalizarConfiguracion({ columnas: nuevas });
    state.config = normalizarConfiguracion(state.configActual);

    await Promise.all([
      cargarVersionesConfiguracion(),
      cargarControles(),
      cargarHistorial()
    ]);

    renderTodo();
    alert("Organización de Administración guardada correctamente.");
  } catch (error) {
    console.error("[gestion-administracion] guardarConfiguracion", error);
    alert(error.message || "No se pudo guardar la configuración.");
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = original;
    }
  }
}

function crearCicloId(id = "") {
  return `${id}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function formatResponsables(responsables = []) {
  if (!responsables.length) return "Sin responsable asignado";

  return responsables
    .map((email) => getNombreEquipoAdministracion(email))
    .join(", ");
}

function exportarXlsAdministracion() {
  if (!window.XLSX) {
    alert("No se pudo cargar el módulo de Excel. Recarga la página e intenta nuevamente.");
    return;
  }

  const resumen = getResumenActual();
  const historialPeriodo = getHistorialPeriodo();
  const actividadPersonas = getActividadPorPersona(historialPeriodo);
  const actividadFunciones = getActividadPorFuncion(historialPeriodo);
  const cargaEquipo = getCargaEquipo(historialPeriodo);
  const funciones = getFuncionesActivas();
  const rows = getRowsVisibles();

  const parametros = [
    ["Parámetro", "Valor"],
    ["Año de viaje", state.anoSeleccionado],
    ["Fecha de referencia", state.fechaReferencia],
    ["Período de actividad", getEtiquetaPeriodo()],
    ["Desde actividad", fechaInputValue(getInicioPeriodo())],
    ["Hasta actividad", fechaInputValue(getFinPeriodo())],
    ["Búsqueda", $("adminBuscar")?.value || ""],
    ["Grupos considerados", resumen.grupos],
    ["Funciones activas", funciones.length],
    ["Tareas OK", resumen.totalOk],
    ["Pendientes", resumen.pendientes],
    ["Avance global", `${resumen.porcentaje}%`],
    ["Exportado por", getNombreUsuario()],
    ["Correo", state.email],
    ["Fecha exportación", new Date().toLocaleString("es-CL")]
  ];

  const funcionesSheet = [[
    "Función",
    "Activa",
    "Ciclo",
    "Responsables",
    "Grupos",
    "OK",
    "Pendientes",
    "Avance %"
  ]];

  resumen.detalle.forEach((item) => {
    funcionesSheet.push([
      item.nombre,
      item.activa ? "Sí" : "No",
      item.cicloId || "",
      formatResponsables(item.responsables || []),
      item.total,
      item.ok,
      item.pendientes,
      item.porcentaje
    ]);
  });

  const equipoSheet = [[
    "Integrante",
    "Correo",
    "Funciones asignadas",
    "Pendientes asignados",
    "OK en período",
    "Grupos trabajados",
    "Días activos"
  ]];

  cargaEquipo.forEach((item) => {
    equipoSheet.push([
      item.nombre,
      item.email,
      item.asignadas.map((funcion) => funcion.nombre).join(" | "),
      item.pendientes,
      item.okPeriodo,
      item.gruposPeriodo,
      item.diasPeriodo
    ]);
  });

  const actividadSheet = [[
    "Fecha",
    "Hora",
    "Persona",
    "Correo",
    "Función",
    "Grupo",
    "ID Grupo",
    "Negocio",
    "Anterior",
    "Nuevo",
    "Ciclo"
  ]];

  historialPeriodo
    .filter((item) => item.tipoMovimiento === "control_administracion")
    .sort((a, b) => fechaMs(a.fecha) - fechaMs(b.fecha))
    .forEach((item) => {
      const d = new Date(fechaMs(item.fecha));
      actividadSheet.push([
        d.toLocaleDateString("es-CL"),
        d.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" }),
        item.creadoPor || item.usuarioNombre || getNombreEquipoAdministracion(item.creadoPorCorreo || item.usuarioCorreo || ""),
        item.creadoPorCorreo || item.usuarioCorreo || "",
        item?.metadata?.controlNombre || item?.metadata?.controlId || "",
        item.aliasGrupo || "",
        item.idGrupo || item.groupDocId || "",
        item.numeroNegocio || "",
        item?.metadata?.anterior || "",
        item?.metadata?.nuevo || "",
        item?.metadata?.cicloId || "legacy"
      ]);
    });

  const estadoGruposSheet = [[
    "Grupo",
    "ID Grupo",
    "Negocio",
    ...funciones.map((funcion) => funcion.nombre)
  ]];

  rows.forEach((row) => {
    estadoGruposSheet.push([
      row.titulo,
      row.groupId || row.docId,
      row.negocio,
      ...funciones.map((funcion) =>
        getEstadoFuncion(row, funcion) === "ok" ? "OK" : "Pendiente"
      )
    ]);
  });

  const configHistoricaSheet = [[
    "Versión",
    "Vigente desde",
    "Función",
    "Nombre",
    "Activa",
    "Ciclo",
    "Responsables",
    "Creado por",
    "Correo"
  ]];

  state.configVersiones
    .slice()
    .sort((a, b) => getVersionDesdeMs(a) - getVersionDesdeMs(b))
    .forEach((version) => {
      const desde = getVersionDesdeMs(version);
      (version.columnas || []).forEach((funcion) => {
        configHistoricaSheet.push([
          version.versionId || version.id || "",
          desde ? new Date(desde).toLocaleString("es-CL") : "",
          funcion.id || "",
          funcion.nombre || "",
          funcion.activa === true ? "Sí" : "No",
          funcion.cicloId || "legacy",
          formatResponsables(funcion.responsables || []),
          version.creadoPor || "",
          version.creadoPorCorreo || ""
        ]);
      });
    });

  const actividadFuncionSheet = [[
    "Función",
    "OK en período",
    "Reabiertas",
    "Grupos trabajados"
  ]];

  actividadFunciones.forEach((item) => {
    actividadFuncionSheet.push([
      item.nombre,
      item.ok,
      item.reabiertos,
      item.grupos
    ]);
  });

  const actividadPersonaSheet = [[
    "Persona",
    "Correo",
    "OK",
    "Reabiertas",
    "Grupos",
    "Días activos",
    "Detalle funciones"
  ]];

  actividadPersonas.forEach((item) => {
    actividadPersonaSheet.push([
      item.nombre,
      item.correo,
      item.ok,
      item.reabiertos,
      item.grupos,
      item.dias,
      item.funciones.map(([nombre, cantidad]) => `${nombre}: ${cantidad}`).join(" | ")
    ]);
  });

  const wb = window.XLSX.utils.book_new();

  agregarHojaXls(wb, "PARAMETROS", parametros);
  agregarHojaXls(wb, "FUNCIONES", funcionesSheet);
  agregarHojaXls(wb, "EQUIPO", equipoSheet);
  agregarHojaXls(wb, "ACTIVIDAD", actividadSheet);
  agregarHojaXls(wb, "ESTADO GRUPOS", estadoGruposSheet);
  agregarHojaXls(wb, "ACTIVIDAD FUNCION", actividadFuncionSheet);
  agregarHojaXls(wb, "ACTIVIDAD PERSONA", actividadPersonaSheet);
  agregarHojaXls(wb, "CONFIG HISTORICA", configHistoricaSheet);

  const nombreArchivo = [
    "administracion",
    state.anoSeleccionado,
    state.fechaReferencia,
    String(state.periodo || "7")
  ].join("_") + ".xlsx";

  window.XLSX.writeFile(wb, nombreArchivo);
}

function agregarHojaXls(workbook, nombre, rows) {
  const ws = window.XLSX.utils.aoa_to_sheet(rows);

  ws["!cols"] = calcularAnchosXls(rows);
  window.XLSX.utils.book_append_sheet(workbook, ws, nombre.slice(0, 31));
}

function calcularAnchosXls(rows = []) {
  const maxCols = Math.max(0, ...rows.map((row) => row.length));

  return Array.from({ length: maxCols }, (_, index) => {
    const max = Math.max(
      10,
      ...rows.map((row) => String(row[index] ?? "").length)
    );

    return { wch: Math.min(max + 2, 45) };
  });
}

function getEtiquetaPeriodo() {
  const value = String(state.periodo || "7");

  return ({
    hoy: "Día de referencia",
    ayer: "Día anterior",
    "7": "Últimos 7 días",
    "30": "Últimos 30 días",
    mes: "Mes de la fecha de referencia"
  })[value] || value;
}

function fechaMs(value) {
  if (!value) return 0;

  if (typeof value?.toDate === "function") {
    return value.toDate().getTime();
  }

  if (typeof value === "object" && typeof value.seconds === "number") {
    return value.seconds * 1000;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? 0
    : date.getTime();
}

function set(id, value) {
  const element = $(id);
  if (element) element.textContent = String(value ?? "");
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizar(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function debounce(fn, wait = 150) {
  let timeout;

  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), wait);
  };
}

function cssEscape(value) {
  if (window.CSS && typeof window.CSS.escape === "function") {
    return window.CSS.escape(String(value || ""));
  }

  return String(value || "").replace(/["\\]/g, "\\$&");
}
