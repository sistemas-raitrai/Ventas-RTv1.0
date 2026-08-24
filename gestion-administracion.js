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
const JEFA_ADMINISTRACION_EMAIL = "administracion@raitrai.cl";

const EQUIPO_ADMINISTRACION = [
  "yenny@raitrai.cl",
  "raitrai@raitrai.cl",
  "contacto@raitrai.cl",
  "giras@raitrai.cl",
  "secretaria@raitrai.cl"
];

const LABEL_EQUIPO = {
  "yenny@raitrai.cl": "Yenny",
  "raitrai@raitrai.cl": "Rai Trai",
  "contacto@raitrai.cl": "Contacto",
  "giras@raitrai.cl": "Giras",
  "secretaria@raitrai.cl": "Secretaría"
};

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
  rows: [],
  config: {
    columnas: FUNCIONES_BASE.map((item) => ({ ...item }))
  },
  controles: new Map(),
  historial: [],
  detalleFuncionId: ""
};

init();

async function init() {
  await waitForLayoutReady();
  configurarSelectorAno();
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

  await Promise.all([
    cargarConfiguracion(),
    cargarGrupos(),
    cargarControles(),
    cargarHistorial()
  ]);

  renderTodo();
}

async function cargarConfiguracion() {
  try {
    const snap = await getDoc(
      doc(db, ADMIN_CONFIG_COLLECTION, ADMIN_CONFIG_DOC)
    );

    state.config = normalizarConfiguracion(
      snap.exists() ? snap.data() : {}
    );
  } catch (error) {
    console.error("[gestion-administracion] cargarConfiguracion", error);
    state.config = normalizarConfiguracion({});
  }
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
  const ahora = new Date();
  const periodo = String(state.periodo || "7");

  if (periodo === "hoy") {
    return inicioDia(ahora);
  }

  if (periodo === "ayer") {
    const ayer = inicioDia(ahora);
    ayer.setDate(ayer.getDate() - 1);
    return ayer;
  }

  if (periodo === "mes") {
    return new Date(ahora.getFullYear(), ahora.getMonth(), 1);
  }

  const dias = Number(periodo || 7);
  const inicio = inicioDia(ahora);
  inicio.setDate(inicio.getDate() - Math.max(dias - 1, 0));
  return inicio;
}

function getFinPeriodo() {
  const ahora = new Date();

  if (String(state.periodo) === "ayer") {
    const fin = inicioDia(ahora);
    fin.setMilliseconds(-1);
    return fin;
  }

  return ahora;
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
          />
        </div>

        <label class="config-active">
          <input
            type="checkbox"
            data-config-activa="${esc(funcion.id)}"
            ${funcion.activa === true ? "checked" : ""}
          />
          Activa
        </label>

        <div class="config-responsables">
          <label class="all-team">
            <input
              type="checkbox"
              data-responsables-todos="${esc(funcion.id)}"
              ${todosAsignados ? "checked" : ""}
            />
            Asignar a todo el equipo
          </label>

          ${EQUIPO_ADMINISTRACION.map((email) => `
            <label>
              <input
                type="checkbox"
                data-responsable-funcion="${esc(funcion.id)}"
                value="${esc(email)}"
                ${(funcion.responsables || []).includes(email) ? "checked" : ""}
              />
              ${esc(email)}
            </label>
          `).join("")}
        </div>
      </div>
    `;
  }).join("");
}

async function guardarConfiguracion() {
  if (!puedeSupervisarAdministracion()) return;

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

    state.config = normalizarConfiguracion({ columnas: nuevas });

    await Promise.all([
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
    .map((email) => LABEL_EQUIPO[email] || email)
    .join(", ");
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
