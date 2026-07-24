// alertas-pagos.js — Página independiente de alertas de pagos

import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/11.7.3/firebase-auth.js";

import {
  collection,
  getDocs,
  getDoc,
  doc,
  setDoc,
  addDoc,
  serverTimestamp,
  query,
  where
} from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";

import {
  auth,
  db,
  VENTAS_USERS
} from "./firebase-init.js";

import {
  $,
  normalizeEmail,
  escapeHtml
} from "./utils.js";

import {
  ACTING_USER_KEY,
  getRealUser,
  getEffectiveUser,
  clearVendorFilter,
  clearGroupFilter,
  isVendedorRole
} from "./roles.js";

import {
  updateClockDataset,
  setHeaderState,
  renderActingUserSwitcher,
  bindLayoutButtons,
  waitForLayoutReady
} from "./ui.js";

/* =========================================================
   CONFIGURACIÓN
========================================================= */

const HOME_URL = "home.html";

const ALERTAS_PAGOS_PERSONAS_COLLECTION =
  "ventas_alertas_pagos_personas";

const ALERTAS_PAGOS_GRUPOS_COLLECTION =
  "ventas_alertas_pagos_grupos";

const ALERTAS_PAGOS_DETALLE_COLLECTION =
  "ventas_alertas_pagos_detalle";

const ALERTAS_PAGOS_HISTORIAL_COLLECTION =
  "ventas_alertas_pagos_historial";

/* =========================================================
   ESTADO
========================================================= */

const state = {
  alertasPagosRows: [],
  alertasPagosFiltradasRows: [],
  alertasPagosUltimaActualizacion: null,

  alertasPagosSortKey:
    "fechaViaje",

  alertasPagosSortDir:
    "asc",

  /*
    Resúmenes grupales.
  */
  gruposPorAno:
    new Map(),

  /*
    Personas cargadas solamente cuando
    se abre una categoría individual.
  */
  personasPorAno:
    new Map(),

  anosIniciales:
    [],

  anosGruposCargados:
    new Set(),

  anosPersonasCargados:
    new Set(),

  anoFiltro:
    "__iniciales__",

  /*
    La pantalla comienza en grupos muy atrasados.
  */
  tipoActivo:
    "grupo_muy_atrasado",

  modoActivo:
    "grupo",

  detalleGrupoCache:
    new Map(),

  cargaEnCurso:
    false
};

/* =========================================================
   HELPERS GENERALES
========================================================= */

function normalizeLoose(value = "") {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function timestampLikeToDate(value) {
  if (!value) return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? null
      : value;
  }

  if (typeof value?.toDate === "function") {
    const date = value.toDate();

    return Number.isNaN(date?.getTime?.())
      ? null
      : date;
  }

  if (
    typeof value === "object" &&
    typeof value.seconds === "number"
  ) {
    const date = new Date(
      value.seconds * 1000
    );

    return Number.isNaN(date.getTime())
      ? null
      : date;
  }

  if (typeof value === "number") {
    const date = new Date(value);

    return Number.isNaN(date.getTime())
      ? null
      : date;
  }

  if (typeof value === "string") {
    const date = new Date(value);

    if (!Number.isNaN(date.getTime())) {
      return date;
    }

    const match = value.match(
      /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?$/
    );

    if (match) {
      let year = Number(match[3]);

      if (year < 100) {
        year += 2000;
      }

      const parsed = new Date(
        year,
        Number(match[2]) - 1,
        Number(match[1]),
        Number(match[4] || 0),
        Number(match[5] || 0),
        0
      );

      return Number.isNaN(parsed.getTime())
        ? null
        : parsed;
    }
  }

  return null;
}

function formatDate(value) {
  const date = timestampLikeToDate(value);

  if (!date) {
    return "Sin fecha";
  }

  return date.toLocaleString("es-CL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

function getAlertasPagosForScope() {
  const effectiveUser =
    getEffectiveUser();

  if (!effectiveUser) {
    return [];
  }

  let alertas = (
    state.alertasPagosRows || []
  ).filter(
    (alerta) =>
      alerta.activa !== false
  );

  /*
    Los vendedores ven solamente
    las alertas de sus grupos.
  */
  if (isVendedorRole(effectiveUser)) {
    const correoUsuario =
      normalizeEmail(
        effectiveUser.email || ""
      );

    alertas = alertas.filter(
      (alerta) =>
        normalizeEmail(
          alerta.vendedoraCorreo || ""
        ) === correoUsuario
    );
  }

  /*
    Admin, Registro, Administración
    y otros roles autorizados ven todas.
  */
  return alertas.sort(
    (a, b) =>
      getFechaViajeOrdenAlertaPago(a) -
      getFechaViajeOrdenAlertaPago(b)
  );
}

function setText(id, value) {
  const element = $(id);

  if (element) {
    element.textContent =
      String(value ?? "");
  }
}

function buildSearchText(obj = {}) {
  let text = "";

  function extract(value) {
    if (
      value === null ||
      value === undefined
    ) {
      return;
    }

    if (value instanceof Date) {
      text += ` ${value.toISOString()}`;
      return;
    }

    if (
      typeof value?.toDate ===
      "function"
    ) {
      text +=
        ` ${value.toDate().toISOString()}`;

      return;
    }

    if (Array.isArray(value)) {
      value.forEach(extract);
      return;
    }

    if (typeof value === "object") {
      Object.values(value)
        .forEach(extract);

      return;
    }

    text += ` ${String(value)}`;
  }

  extract(obj);

  return normalizeLoose(text);
}

function emptyHtml(
  text = "Sin resultados."
) {
  return `
    <div class="home-empty">
      ${escapeHtml(text)}
    </div>
  `;
}

function openDialog(dialog) {
  if (!dialog) return;

  if (
    typeof dialog.showModal ===
    "function"
  ) {
    if (!dialog.open) {
      dialog.showModal();
    }

    return;
  }

  dialog.setAttribute(
    "open",
    "open"
  );
}

function closeDialog(dialog) {
  if (!dialog) return;

  if (
    typeof dialog.close ===
    "function"
  ) {
    dialog.close();
    return;
  }

  dialog.removeAttribute("open");
}

/* =========================================================
   CARGA DE DATOS
========================================================= */

function logCargaPagos(mensaje, datos = null) {
  const hora = new Date().toLocaleTimeString("es-CL", {
    hour12: false
  });

  if (datos !== null) {
    console.log(
      `%c[Alertas pagos ${hora}] ${mensaje}`,
      "color:#5a2d82;font-weight:900;",
      datos
    );
  } else {
    console.log(
      `%c[Alertas pagos ${hora}] ${mensaje}`,
      "color:#5a2d82;font-weight:900;"
    );
  }
}

async function medirConsultaPagos(nombre, callback) {
  const inicio = performance.now();

  logCargaPagos(`Iniciando: ${nombre}`);

  try {
    const resultado = await callback();

    const duracion = Math.round(
      performance.now() - inicio
    );

    logCargaPagos(
      `Finalizó: ${nombre} · ${duracion} ms · ${resultado?.size ?? 0} documentos`
    );

    return resultado;
  } catch (error) {
    const duracion = Math.round(
      performance.now() - inicio
    );

    console.error(
      `[Alertas pagos] Error en ${nombre} después de ${duracion} ms`,
      error
    );

    throw error;
  }
}

function getAnosInicialesAlertasPagos() {
  const hoy = new Date();

  const anoActual =
    hoy.getFullYear();

  const mes =
    hoy.getMonth();

  const dia =
    hoy.getDate();

  /*
    getMonth() comienza en 0:

    Enero = 0
    Noviembre = 10
    Diciembre = 11
  */
  const desde30Noviembre =
    mes > 10 ||
    (
      mes === 10 &&
      dia >= 30
    );

  const anoBase =
    desde30Noviembre
      ? anoActual + 1
      : anoActual;

  return [
    String(anoBase),
    String(anoBase + 1)
  ];
}

function getAnosDisponiblesSelectorPagos() {
  const anosIniciales =
    state.anosIniciales.length
      ? state.anosIniciales
      : getAnosInicialesAlertasPagos();

  const anoBase =
    Number(anosIniciales[0]);

  const anosCargados = [
    ...state.anosGruposCargados,
    ...state.anosPersonasCargados
  ];

  const anos = [
    String(anoBase - 1),
    String(anoBase),
    String(anoBase + 1),
    String(anoBase + 2),
    String(anoBase + 3),
    ...anosCargados
  ];

  return [
    ...new Set(anos)
  ].sort(
    (a, b) =>
      Number(a) - Number(b)
  );
}

async function consultarAlertasActivasAno({
  anoViaje,
  categoria
}) {
  const ano =
    String(
      anoViaje || ""
    ).trim();

  if (!ano) {
    throw new Error(
      "No se indicó el año."
    );
  }

  const coleccion =
    categoria === "persona"
      ? ALERTAS_PAGOS_PERSONAS_COLLECTION
      : ALERTAS_PAGOS_GRUPOS_COLLECTION;

  return medirConsultaPagos(
    `${categoria} activas ${ano}`,
    () =>
      getDocs(
        query(
          collection(
            db,
            coleccion
          ),

          where(
            "activa",
            "==",
            true
          ),

          where(
            "anoViaje",
            "==",
            ano
          )
        )
      )
  );
}

async function cargarAnoGruposPagos(
  anoViaje,
  {
    forzar = false
  } = {}
) {
  const ano =
    String(
      anoViaje || ""
    ).trim();

  if (
    state.gruposPorAno.has(ano) &&
    !forzar
  ) {
    return (
      state.gruposPorAno.get(ano) ||
      []
    );
  }

  const snap =
    await consultarAlertasActivasAno({
      anoViaje:
        ano,

      categoria:
        "grupo"
    });

  const rows =
    snap.docs.map(
      (docSnap) => ({
        id:
          docSnap.id,

        ...docSnap.data()
      })
    );

  state.gruposPorAno.set(
    ano,
    rows
  );

  state.anosGruposCargados.add(
    ano
  );

  return rows;
}

async function cargarAnoPersonasPagos(
  anoViaje,
  {
    forzar = false
  } = {}
) {
  const ano =
    String(
      anoViaje || ""
    ).trim();

  if (
    state.personasPorAno.has(ano) &&
    !forzar
  ) {
    return (
      state.personasPorAno.get(ano) ||
      []
    );
  }

  const snap =
    await consultarAlertasActivasAno({
      anoViaje:
        ano,

      categoria:
        "persona"
    });

  const rows =
    snap.docs.map(
      (docSnap) => ({
        id:
          docSnap.id,

        ...docSnap.data()
      })
    );

  state.personasPorAno.set(
    ano,
    rows
  );

  state.anosPersonasCargados.add(
    ano
  );

  return rows;
}

function reconstruirAlertasPagosDesdeCache() {
  const grupos =
    [...state.gruposPorAno.values()]
      .flat();

  const personas =
    [...state.personasPorAno.values()]
      .flat();

  state.alertasPagosRows = [
    ...grupos,
    ...personas
  ];

  state
    .alertasPagosUltimaActualizacion =
    state.alertasPagosRows
      .map((row) =>
        timestampLikeToDate(
          row.actualizadoAt
        )
      )
      .filter(Boolean)
      .sort(
        (a, b) =>
          b.getTime() -
          a.getTime()
      )[0] || null;

  state.alertasPagosFiltradasRows =
    getAlertasPagosForScope();
}

async function cargarDatosAlertasPagos({
  forzar = false
} = {}) {
  const loading =
    $("alertas-pagos-loading");

  const app =
    $("alertas-pagos-app");

  const actualizado =
    $("alertas-pagos-actualizado");

  if (state.cargaEnCurso) {
    logCargaPagos(
      "Ya existe una carga en curso."
    );

    return;
  }

  state.cargaEnCurso = true;

  if (!state.anosIniciales.length) {
    state.anosIniciales =
      getAnosInicialesAlertasPagos();
  }

  if (loading) {
    loading.hidden = false;

    loading.textContent =
      `Cargando alertas activas ${state.anosIniciales.join(" y ")}...`;
  }

  if (app) {
    app.hidden = true;
  }

  if (actualizado) {
    actualizado.textContent =
      `Consultando alertas ${state.anosIniciales.join("–")}...`;
  }

  const inicioTotal =
    performance.now();

  logCargaPagos(
    "Comenzó la carga inicial",
    {
      anos:
        state.anosIniciales
    }
  );

  try {
    /*
      La carga inicial contiene solamente resúmenes grupales.
    */
    await Promise.all(
      state.anosIniciales.map(
        (ano) =>
          cargarAnoGruposPagos(
            ano,
            {
              forzar
            }
          )
      )
    );

    const inicioProcesamiento =
      performance.now();

    reconstruirAlertasPagosDesdeCache();

    logCargaPagos(
      `Procesamiento local finalizado · ${Math.round(
        performance.now() -
        inicioProcesamiento
      )} ms`,
      {
        anosGruposCargados:
          [...state.anosGruposCargados],
        
        anosPersonasCargados:
          [...state.anosPersonasCargados],

        alertasEnMemoria:
          state.alertasPagosRows.length,

        alertasVisibles:
          state
            .alertasPagosFiltradasRows
            .length
      }
    );

    if (actualizado) {
      actualizado.textContent =
        state
          .alertasPagosUltimaActualizacion
          ? `Última actualización: ${formatDate(
              state
                .alertasPagosUltimaActualizacion
            )}`
          : "Última actualización: sin registro";
    }

    if (loading) {
      loading.hidden = true;
    }

    if (app) {
      app.hidden = false;
    }

    logCargaPagos(
      `Alertas iniciales listas · ${Math.round(
        performance.now() -
        inicioTotal
      )} ms`
    );
  } catch (error) {
    console.error(
      "Error cargando alertas de pagos:",
      error
    );

    state.alertasPagosCargadas =
      false;

    if (loading) {
      loading.hidden = false;

      loading.innerHTML = `
        <strong>
          No se pudieron cargar las alertas.
        </strong>
        <br>
        ${escapeHtml(
          error.message ||
          "Error desconocido"
        )}
      `;
    }

    if (actualizado) {
      actualizado.textContent =
        "Última actualización: error de carga";
    }
  } finally {
    state.cargaEnCurso = false;
  }
}

async function cargarAlertasPagosDesdeFirestore({
  forzar = false,
  anos = null,
  categoria = ""
} = {}) {
  if (!state.anosIniciales.length) {
    state.anosIniciales =
      getAnosInicialesAlertasPagos();
  }

  const anosObjetivo =
    Array.isArray(anos) &&
    anos.length
      ? anos.map(String)
      : state.anosIniciales;

  const categoriaObjetivo =
    categoria ||
    state.modoActivo ||
    "grupo";

  if (categoriaObjetivo === "persona") {
    await Promise.all(
      anosObjetivo.map(
        (ano) =>
          cargarAnoPersonasPagos(
            ano,
            {
              forzar
            }
          )
      )
    );
  } else {
    await Promise.all(
      anosObjetivo.map(
        (ano) =>
          cargarAnoGruposPagos(
            ano,
            {
              forzar
            }
          )
      )
    );
  }

  reconstruirAlertasPagosDesdeCache();
}

/* =========================================================
   ALERTAS DE PAGOS
========================================================= */

function obtenerAnoOperativoHome() {
  const hoy = new Date();
  const anoActual = hoy.getFullYear();
  const mes = hoy.getMonth() + 1;
  const dia = hoy.getDate();

  if (mes < 3 || (mes === 3 && dia < 1)) {
    return anoActual - 1;
  }

  return anoActual;
}

function formatoMontoPago(v, moneda = "") {
  const currency = String(moneda || "").toUpperCase();

  if (currency === "USD" || currency === "EUR") {
    return Number(v || 0).toLocaleString("es-CL", {
      style: "currency",
      currency,
      maximumFractionDigits: 0
    });
  }

  return Number(v || 0).toLocaleString("es-CL", {
    maximumFractionDigits: 0
  });
}

function getPrioridadPagoKey(alerta = {}) {
  const nivel =
    normalizeLoose(
      alerta.nivel || ""
    );

  if (nivel === "critica") {
    return "critica";
  }

  if (
    nivel === "warning" ||
    nivel === "advertencia"
  ) {
    return "alta";
  }

  if (nivel === "info") {
    return "media";
  }

  const gravedad =
    Number(
      alerta.gravedad || 0
    );

  if (gravedad >= 5) {
    return "critica";
  }

  if (gravedad >= 3) {
    return "alta";
  }

  if (gravedad >= 2) {
    return "media";
  }

  return "baja";
}

function getPrioridadPagoLabel(alerta = {}) {
  const key = getPrioridadPagoKey(alerta);

  if (key === "critica") return "Crítica";
  if (key === "alta") return "Alta";
  if (key === "media") return "Media";
  return "Baja";
}

function redondearNumeroCuotas(valor = 0) {
  const numero = Number(valor || 0);

  if (!Number.isFinite(numero) || numero <= 0) {
    return 0;
  }

  return Math.round(numero * 10) / 10;
}

function formatearNumeroCuotas(valor = 0) {
  const numero = redondearNumeroCuotas(valor);

  if (Number.isInteger(numero)) {
    return String(numero);
  }

  return numero.toLocaleString("es-CL", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  });
}

function getInfoCuotasAlertaPago(alerta = {}) {
  const cantidadCuotas = Math.max(
    0,
    Number(alerta.cantidadCuotas || 0)
  );

  const cuotasVencidas = Math.max(
    0,
    Number(alerta.cuotasVencidas || 0)
  );

  const cuotasPagadasEstimadas = Math.max(
    0,
    Number(
      alerta.cuotasPagadasEstimadas ??
      alerta.cuotasCubiertas ??
      0
    )
  );

  const cuotasAtrasadasReales = Math.max(
    0,
    Number(alerta.cuotasAtrasadas || 0)
  );

  /*
    Regla operativa:
    si debe 2,3 cuotas, se considera que registra
    3 cuotas atrasadas.
  */
  const cuotasAtrasadasOperativas =
    cuotasAtrasadasReales > 0
      ? Math.ceil(cuotasAtrasadasReales)
      : 0;

  const valorCuota = Math.max(
    0,
    Number(alerta.valorCuota || 0)
  );

  return {
    cantidadCuotas,
    cuotasVencidas,
    cuotasPagadasEstimadas,
    cuotasAtrasadasReales,
    cuotasAtrasadasOperativas,
    valorCuota
  };
}

function getTextoAvanceCuotasPago(alerta = {}) {
  const info = getInfoCuotasAlertaPago(alerta);

  if (!info.cantidadCuotas) {
    return "";
  }

  const partes = [];

  if (info.cuotasPagadasEstimadas > 0) {
    partes.push(
      `Registra pagos equivalentes a ${formatearNumeroCuotas(info.cuotasPagadasEstimadas)} ` +
      `${info.cuotasPagadasEstimadas === 1 ? "cuota" : "cuotas"} de ${info.cantidadCuotas}.`
    );
  } else {
    partes.push(
      `No registra pagos equivalentes a cuotas del plan de ${info.cantidadCuotas} cuotas.`
    );
  }

  if (info.cuotasVencidas > 0) {
    partes.push(
      `A esta fecha debería ir en la cuota ${info.cuotasVencidas} de ${info.cantidadCuotas}.`
    );
  }

  if (info.cuotasAtrasadasOperativas > 0) {
    partes.push(
      `Registra ${info.cuotasAtrasadasOperativas} ` +
      `${info.cuotasAtrasadasOperativas === 1 ? "cuota atrasada" : "cuotas atrasadas"}.`
    );
  } else if (info.cuotasVencidas > 0) {
    partes.push("De acuerdo con este cálculo, no registra cuotas atrasadas.");
  }

  return partes.join(" ");
}

function getResumenCuotasTablaPago(alerta = {}) {
  const info = getInfoCuotasAlertaPago(alerta);

  if (!info.cantidadCuotas) {
    return "";
  }

  const pagadas = formatearNumeroCuotas(info.cuotasPagadasEstimadas);

  if (info.cuotasAtrasadasOperativas > 0) {
    return (
      `Pagos equivalentes a ${pagadas} de ${info.cantidadCuotas} · ` +
      `Debería ir en ${info.cuotasVencidas} · ` +
      `${info.cuotasAtrasadasOperativas} atrasada${info.cuotasAtrasadasOperativas === 1 ? "" : "s"}`
    );
  }

  return (
    `Pagos equivalentes a ${pagadas} de ${info.cantidadCuotas} · ` +
    `Debería ir en ${info.cuotasVencidas}`
  );
}

function renderDetalleCuotasAlertaPago(alerta = {}) {
  const info = getInfoCuotasAlertaPago(alerta);

  if (!info.cantidadCuotas) {
    return `
      <div style="margin-top:12px; padding:12px; border-radius:14px; background:#faf8fd; border:1px solid rgba(49,25,75,.10);">
        <strong>Plan de cuotas:</strong> Sin información disponible.
      </div>
    `;
  }

  const cuotasPagadasTexto = formatearNumeroCuotas(
    info.cuotasPagadasEstimadas
  );

  return `
    <div style="
      margin-top:12px;
      padding:12px 14px;
      border-radius:14px;
      background:#f7f3fb;
      border:1px solid rgba(49,25,75,.12);
      color:#3e3550;
      font-size:14px;
      line-height:1.6;
    ">
      <strong>Plan de pagos</strong><br>

      <strong>Cantidad total:</strong>
      ${escapeHtml(info.cantidadCuotas)} cuotas<br>

      <strong>Pagos equivalentes:</strong>
      ${escapeHtml(cuotasPagadasTexto)} de
      ${escapeHtml(info.cantidadCuotas)} cuotas<br>

      <strong>Cuota esperada a esta fecha:</strong>
      ${escapeHtml(info.cuotasVencidas)} de
      ${escapeHtml(info.cantidadCuotas)}<br>

      <strong>Atraso estimado:</strong>
      ${escapeHtml(info.cuotasAtrasadasOperativas)}
      ${info.cuotasAtrasadasOperativas === 1 ? "cuota" : "cuotas"}<br>

      <strong>Valor referencial de cada cuota:</strong>
      ${escapeHtml(formatoMontoPago(info.valorCuota, alerta.moneda))}
    </div>
  `;
}

function getTextoSugeridoPago(alerta = {}) {
  const responsable = alerta.responsable || "apoderado/a";
  const participante = alerta.participante || "el/la participante";
  const grupo = alerta.grupo || "su grupo";
  const moneda = alerta.moneda || "";

  const total = formatoMontoPago(alerta.totalDebe, moneda);
  const pagado = formatoMontoPago(alerta.totalPagado, moneda);
  const saldo = formatoMontoPago(alerta.saldoPendiente, moneda);

  const textoCuotas = getTextoAvanceCuotasPago(alerta);

  return `Estimado/a ${responsable}:

Junto con saludar, le escribimos respecto del viaje de estudios de ${participante}, correspondiente al grupo ${grupo}.

Según nuestros registros, el valor total del programa es de ${total}. Actualmente registra pagos por ${pagado}, manteniendo un saldo pendiente de ${saldo}.

${textoCuotas ? `${textoCuotas}\n\n` : ""}Le agradeceríamos revisar esta información y regularizar las cuotas pendientes. Si existe algún pago que aún no se encuentre reflejado o requiere revisar su situación, puede contactarnos para verificarlo.

Saludos cordiales,
Turismo Rai Trai`;
}

function getFechaViajeOrdenAlertaPago(alerta = {}) {
  const fecha = timestampLikeToDate(
    alerta.fechaViajeTimestamp ||
    alerta.fechaViajeConfirmada
  );

  return fecha
    ? fecha.getTime()
    : Number.MAX_SAFE_INTEGER;
}

function formatFechaViajeAlertaPago(alerta = {}) {
  const fecha = timestampLikeToDate(
    alerta.fechaViajeTimestamp ||
    alerta.fechaViajeConfirmada
  );

  if (!fecha) {
    return "-";
  }

  return fecha.toLocaleDateString("es-CL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });
}

function buildAlertasPagosFiltrosHtml(rows = []) {
  const anosIniciales =
    state.anosIniciales.length
      ? state.anosIniciales
      : getAnosInicialesAlertasPagos();
  
  const anos =
    getAnosDisponiblesSelectorPagos();
  
  const etiquetaTodos =
    `Todos ${anosIniciales[0]}–${anosIniciales[1]}`;

  const vendedores = [...new Map(
    rows
      .map((r) => [
        normalizeEmail(r.vendedoraCorreo || ""),
        r.vendedor || r.vendedoraCorreo || "Sin vendedor"
      ])
      .filter(([email]) => email)
  ).entries()];

  const monedas = [...new Set(
    rows
      .map((r) => String(r.moneda || "").trim())
      .filter(Boolean)
  )].sort();

  const destinos = [
    "Chile",
    "Argentina",
    "Brasil",
    "Otros"
  ];

  const tiposAlertas = getTiposAlertasPagosUI();

  const filtroControlStyle = `
    width:100%;
    min-width:0;
    min-height:38px;
    padding:9px 12px;
    border:1px solid rgba(49,25,75,.22);
    border-radius:14px;
    background:#fff;
    color:#32184f;
    font-size:13px;
    font-weight:700;
    outline:none;
    box-sizing:border-box;
  `;

  const renderChip = (item, activo = false) => {
    const esGrupal = item.categoria === "grupo";

    const backgroundNormal = esGrupal ? "#f6f0fb" : "#fff";
    const colorNormal = esGrupal ? "#694583" : "#654d78";
    const borderNormal = esGrupal
      ? "1px solid rgba(109,74,146,.28)"
      : "1px solid rgba(49,25,75,.18)";

    const backgroundActivo = esGrupal ? "#e4d3f1" : "#eadff7";
    const colorActivo = esGrupal ? "#4d216e" : "#32184f";
    const borderActivo = esGrupal
      ? "2px solid #6d4a92"
      : "2px solid #32184f";

    return `
      <button
        type="button"
        class="chip-alerta-pago ${activo ? "is-active" : ""}"
        data-tipo-alerta-pago="${escapeHtml(item.tipo)}"
        data-chip-categoria="${escapeHtml(item.categoria)}"
        data-bg-normal="${escapeHtml(backgroundNormal)}"
        data-color-normal="${escapeHtml(colorNormal)}"
        data-border-normal="${escapeHtml(borderNormal)}"
        data-bg-activo="${escapeHtml(backgroundActivo)}"
        data-color-activo="${escapeHtml(colorActivo)}"
        data-border-activo="${escapeHtml(borderActivo)}"
        style="
          border:${activo ? borderActivo : borderNormal};
          background:${activo ? backgroundActivo : backgroundNormal};
          color:${activo ? colorActivo : colorNormal};
          border-radius:999px;
          padding:8px 12px;
          font-weight:900;
          cursor:pointer;
          font-size:12px;
          white-space:nowrap;
        "
      >
        ${escapeHtml(item.label)}
      </button>
    `;
  };

  return `
    <div
      style="
        display:flex;
        justify-content:space-between;
        gap:12px;
        align-items:center;
        flex-wrap:wrap;
        margin-bottom:14px;
      "
    >
      <div style="font-size:13px; color:#4b405a;">
        <strong>Última actualización:</strong>
        ${
          state.alertasPagosUltimaActualizacion
            ? escapeHtml(formatDate(state.alertasPagosUltimaActualizacion))
            : "Sin actualización"
        }
      </div>

      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        <button
          type="button"
          id="btn-exportar-alertas-pagos"
          class="home-btn"
          style="background:#6d4a92;"
        >
          Exportar XLSX
        </button>

        <!--
        <button
          type="button"
          id="btn-actualizar-alertas-pagos"
          class="home-btn"
        >
          Actualizar
        </button>
        -->
      </div>
    </div>

    <div
      style="
        display:grid;
        grid-template-columns:
          minmax(90px, 120px)
          minmax(180px, 1.3fr)
          minmax(130px, .85fr)
          minmax(140px, .95fr)
          minmax(150px, .95fr);
        gap:10px;
        margin-bottom:10px;
        align-items:center;
      "
    >
      <select
        id="filtro-alerta-pago-ano"
        style="${filtroControlStyle}"
      >
        <option
          value="__iniciales__"
          ${
            state.anoFiltro ===
            "__iniciales__"
              ? "selected"
              : ""
          }
        >
          ${escapeHtml(etiquetaTodos)}
        </option>
      
        ${anos.map((a) => {
          const anoTexto =
            String(a);
        
          const estaCargado =
            state.anosGruposCargados.has(
              anoTexto
            ) ||
            state.anosPersonasCargados.has(
              anoTexto
            );
        
          return `
            <option
              value="${escapeHtml(anoTexto)}"
              ${
                state.anoFiltro ===
                anoTexto
                  ? "selected"
                  : ""
              }
            >
              ${escapeHtml(anoTexto)}
              ${
                estaCargado
                  ? ""
                  : " · cargar"
              }
            </option>
          `;
        }).join("")}
      </select>

      <select
        id="filtro-alerta-pago-vendedor"
        style="${filtroControlStyle}"
      >
        <option value="">Todos los vendedores</option>

        ${vendedores.map(([email, nombre]) => `
          <option value="${escapeHtml(email)}">
            ${escapeHtml(nombre)}
          </option>
        `).join("")}
      </select>

      <select
        id="filtro-alerta-pago-moneda"
        style="${filtroControlStyle}"
      >
        <option value="">Todas las monedas</option>

        ${monedas.map((m) => `
          <option value="${escapeHtml(m)}">
            ${escapeHtml(m)}
          </option>
        `).join("")}
      </select>

      <select
        id="filtro-alerta-pago-destino"
        style="${filtroControlStyle}"
      >
        <option value="">Todos los destinos</option>

        ${destinos.map((d) => `
          <option value="${escapeHtml(d)}">
            ${escapeHtml(d)}
          </option>
        `).join("")}
      </select>

      <select
        id="filtro-alerta-pago-prioridad"
        style="${filtroControlStyle}"
      >
        <option value="">Todas las prioridades</option>
        <option value="critica">Crítica</option>
        <option value="alta">Alta</option>
        <option value="media">Media</option>
        <option value="baja">Baja</option>
      </select>
    </div>

    <div style="margin-bottom:14px;">
      <input
        id="filtro-alerta-pago-buscar"
        style="${filtroControlStyle}"
        type="search"
        placeholder="Buscar participante, responsable, grupo, correo, RUT, vendedor..."
      />
    </div>

    <div
      id="chips-alertas-pagos"
      style="
        display:grid;
        gap:12px;
        margin-bottom:16px;
      "
    >
      <!-- ALERTAS GRUPALES PRIMERO -->
      <div
        style="
          padding:12px 14px;
          border-radius:16px;
          background:#f7f1fb;
          border:1px solid rgba(109,74,146,.18);
        "
      >
        <div
          style="
            margin-bottom:9px;
            color:#5c3279;
            font-size:12px;
            font-weight:900;
            text-transform:uppercase;
            letter-spacing:.35px;
          "
        >
          Alertas grupales
        </div>
    
        <div
          style="
            display:flex;
            flex-wrap:wrap;
            gap:8px;
          "
        >
          ${tiposAlertas.grupales.map((item) =>
            renderChip(
              item,
              item.tipo === state.tipoActivo
            )
          ).join("")}
        </div>
      </div>
    
      <!-- ALERTAS INDIVIDUALES DESPUÉS -->
      <div
        style="
          padding:12px 14px;
          border-radius:16px;
          background:#fbf9fd;
          border:1px solid rgba(49,25,75,.10);
        "
      >
        <div
          style="
            margin-bottom:9px;
            color:#32184f;
            font-size:12px;
            font-weight:900;
            text-transform:uppercase;
            letter-spacing:.35px;
          "
        >
          Alertas individuales
        </div>
    
        <div
          style="
            display:flex;
            flex-wrap:wrap;
            gap:8px;
          "
        >
          ${tiposAlertas.individuales.map((item) =>
            renderChip(
              item,
              item.tipo === state.tipoActivo
            )
          ).join("")}
        </div>
      </div>

    </div>
    
    <div
      id="resumen-alertas-pagos"
      style="margin-bottom:12px;"
    ></div>
    
    <div id="contenedor-alertas-pagos-listado"></div>
  `;
}

function getTiposAlertasPagosUI() {
  return {
    grupales: [
      {
        tipo: "__todas_grupales__",
        label: "Todas las grupales",
        categoria: "grupo"
      },
      {
        tipo: "grupo_muy_atrasado",
        label: "Grupo muy atrasado",
        categoria: "grupo",
        campo: "grupoMuyAtrasado"
      },
      {
        tipo: "grupo_atrasos_2_mas",
        label: "Integrantes con 2+ cuotas",
        categoria: "grupo",
        campo: "grupoConAtrasos2Mas"
      },
      {
        tipo: "grupo_no_va_al_dia",
        label: "Grupo no va al día",
        categoria: "grupo",
        campo: "grupoNoVaAlDia"
      },
      {
        tipo: "grupo_liberados_parciales",
        label: "Liberados parciales",
        categoria: "grupo",
        campo: "grupoConLiberadosParciales"
      },
      {
        tipo: "grupo_saldo_a_favor",
        label: "Saldo a favor",
        categoria: "grupo",
        campo: "grupoConSaldoFavor"
      }
    ],

    individuales: [
      {
        tipo: "__todas_individuales__",
        label: "Todas las individuales",
        categoria: "persona"
      },
      {
        tipo: "persona_muy_atrasada",
        label: "Muy atrasado",
        categoria: "persona",
        campo: "personaMuyAtrasada"
      },
      {
        tipo: "persona_atrasada_2_mas_cuotas",
        label: "2+ cuotas atrasadas",
        categoria: "persona",
        campo: "personaAtraso2MasCuotas"
      },
      {
        tipo: "persona_atrasada_1_cuota",
        label: "1 cuota atrasada",
        categoria: "persona",
        campo: "personaAtraso1Cuota"
      },
      {
        tipo: "persona_sin_pagos_o_inscripcion",
        label: "Nunca pagó / inscripción",
        categoria: "persona",
        campo: "personaSinPagosOInscripcion"
      },
      {
        tipo: "persona_pago_bajo",
        label: "Pago bajo",
        categoria: "persona",
        campo: "personaPagoBajo"
      }
    ]
  };
}

function getTiposActivosAlertasPagos() {
  const chips = [...document.querySelectorAll("[data-tipo-alerta-pago]")];

  const activos = chips
    .filter((btn) => btn.classList.contains("is-active"))
    .map((btn) => btn.dataset.tipoAlertaPago)
    .filter(Boolean);

  return new Set(activos);
}

function renderResumenAlertasPagos(rows = []) {
  const cont = $("resumen-alertas-pagos");
  if (!cont) return;

  const personas = rows.filter((r) => r.categoriaAlerta === "persona");
  const grupos = rows.filter((r) => r.categoriaAlerta === "grupo");
  const contactados = rows.filter((r) => r.contactado === true);

  cont.innerHTML = `
    <div style="display:grid; grid-template-columns:repeat(4, minmax(120px, 1fr)); gap:10px;">
      <div style="padding:12px; border-radius:14px; background:#faf8fd; border:1px solid rgba(49,25,75,.10);">
        <strong style="font-size:20px; color:#26133d;">${rows.length}</strong><br>
        <span style="font-size:12px; color:#766b84;">Total alertas</span>
      </div>

      <div style="padding:12px; border-radius:14px; background:#faf8fd; border:1px solid rgba(49,25,75,.10);">
        <strong style="font-size:20px; color:#26133d;">${personas.length}</strong><br>
        <span style="font-size:12px; color:#766b84;">Personas</span>
      </div>

      <div style="padding:12px; border-radius:14px; background:#faf8fd; border:1px solid rgba(49,25,75,.10);">
        <strong style="font-size:20px; color:#26133d;">${grupos.length}</strong><br>
        <span style="font-size:12px; color:#766b84;">Grupos</span>
      </div>

      <div style="padding:12px; border-radius:14px; background:#eef8ef; border:1px solid #b9dfc0;">
        <strong style="font-size:20px; color:#1d6a2b;">${contactados.length}</strong><br>
        <span style="font-size:12px; color:#1d6a2b;">Contactados</span>
      </div>
    </div>
  `;
}

function ordenarAlertasPagos(rows = []) {
  const base = [...rows].map((row, index) => ({
    ...row,
    _numeroOrden: index + 1
  }));

  return ordenarAlertasPagosPorColumna(base);
}

function getValorOrdenAlertaPago(row = {}, key = "") {
  if (key === "fechaViaje") return getFechaViajeOrdenAlertaPago(row);
  if (key === "numero") return Number(row._numeroOrden || 0);
  if (key === "participante") return normalizeLoose(row.participante || row.grupo || "");
  if (key === "grupo") return normalizeLoose(row.grupo || "");
  if (key === "ano") return Number(row.anoViaje || 0);
  if (key === "vendedor") return normalizeLoose(row.vendedor || "");
  if (key === "razon") return normalizeLoose(row.label || row.tipo || "");
  if (key === "pagado") return Number(row.totalPagado || 0);
  if (key === "total") return Number(row.totalDebe || row.totalViajeGrupo || row.totalDebeGrupo || 0);
  if (key === "saldo") return Number(row.saldoPendiente || row.saldoPendienteGrupo || 0);
  if (key === "ultimoPago") {
    const d = timestampLikeToDate(row.ultimoPagoFecha);
    return d ? d.getTime() : 0;
  }
  if (key === "estado") return row.contactado === true ? 1 : 0;
  if (key === "prioridad") return Number(row.prioridad || 0);

  return "";
}

function ordenarAlertasPagosPorColumna(rows = []) {
  const key = state.alertasPagosSortKey || "prioridad";
  const dir = state.alertasPagosSortDir || "desc";
  const factor = dir === "asc" ? 1 : -1;

  return [...rows].sort((a, b) => {
    const va = getValorOrdenAlertaPago(a, key);
    const vb = getValorOrdenAlertaPago(b, key);

    if (typeof va === "number" && typeof vb === "number") {
      return (va - vb) * factor;
    }

    return String(va).localeCompare(String(vb), "es", {
      sensitivity: "base",
      numeric: true
    }) * factor;
  });
}

function getIconoOrdenAlertaPago(key = "") {
  if (state.alertasPagosSortKey !== key) return "↕";
  return state.alertasPagosSortDir === "asc" ? "▲" : "▼";
}

function thOrdenAlertaPago(label = "", key = "", align = "left") {
  return `
    <th
      data-sort-alerta-pago="${escapeHtml(key)}"
      style="padding:10px; text-align:${align}; cursor:pointer; user-select:none; white-space:nowrap;"
      title="Ordenar"
    >
      ${escapeHtml(label)}
      <span style="font-size:10px; opacity:.85; margin-left:4px;">
        ${escapeHtml(getIconoOrdenAlertaPago(key))}
      </span>
    </th>
  `;
}

function limpiarTelefonoWhatsapp(valor = "") {
  let fono = String(valor || "").replace(/\D/g, "");

  if (!fono) return "";

  if (fono.startsWith("56")) return fono;
  if (fono.startsWith("9")) return `56${fono}`;
  if (fono.length === 8) return `569${fono}`;

  return fono;
}

function getTextoWhatsappPago(alerta = {}) {
  const responsable = alerta.responsable || "";
  const participante = alerta.participante || "el/la participante";
  const grupo = alerta.grupo || "su grupo";
  const moneda = alerta.moneda || "";

  const pagado = formatoMontoPago(alerta.totalPagado, moneda);
  const saldo = formatoMontoPago(alerta.saldoPendiente, moneda);
  const textoCuotas = getTextoAvanceCuotasPago(alerta);

  return `Hola ${responsable}, le escribimos de Turismo Rai Trai por el viaje de estudios de ${participante}, grupo ${grupo}.

Actualmente registra pagos por ${pagado} y un saldo pendiente de ${saldo}.

${textoCuotas ? `${textoCuotas}\n\n` : ""}Le agradeceríamos revisar esta información y regularizar las cuotas pendientes. Si existe algún pago que aún no se encuentre reflejado, puede contactarnos para verificarlo.`;
}

function getWhatsappUrlAlertaPago(alerta = {}) {
  const fono = limpiarTelefonoWhatsapp(alerta.telefonoResponsable || "");
  if (!fono) return "";

  return `https://wa.me/${encodeURIComponent(fono)}?text=${encodeURIComponent(getTextoWhatsappPago(alerta))}`;
}

function getGmailUrlAlertaPago(alerta = {}) {
  const to = String(alerta.correoResponsable || "").trim();
  if (!to) return "";

  const subject = `Estado de pagos viaje de estudios - ${alerta.participante || alerta.grupo || ""}`;
  const body = getTextoSugeridoPago(alerta);

  return `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function getZonaDestinoPago(destino = "") {
  const d = normalizeLoose(destino);

  if (
    d.includes("sur de chile y bariloche") ||
    d.includes("norte de chile") ||
    d.includes("sur de chile")
  ) {
    return "Chile";
  }

  if (d.includes("bariloche")) {
    return "Argentina";
  }

  if (d.includes("camboriu") || d.includes("brasil")) {
    return "Brasil";
  }

  return "Otros";
}

function filtrarAlertasPagosModal(rows = []) {
  const ano =
    $("filtro-alerta-pago-ano")
      ?.value ||
    state.anoFiltro ||
    "__iniciales__";
  const vendedor = $("filtro-alerta-pago-vendedor")?.value || "";
  const moneda = $("filtro-alerta-pago-moneda")?.value || "";
  const destino = $("filtro-alerta-pago-destino")?.value || "";
  const prioridad = $("filtro-alerta-pago-prioridad")?.value || "";

  const q = normalizeLoose(
    $("filtro-alerta-pago-buscar")?.value || ""
  );

  const tiposActivos = getTiposActivosAlertasPagos();

  return ordenarAlertasPagos(
    rows.filter((row) => {
      if (
        ano === "__iniciales__" &&
        !state.anosIniciales.includes(
          String(row.anoViaje || "")
        )
      ) {
        return false;
      }
      
      if (
        ano !== "__iniciales__" &&
        String(row.anoViaje || "") !==
          String(ano)
      ) {
        return false;
      }

      if (
        vendedor &&
        normalizeEmail(row.vendedoraCorreo || "") !== vendedor
      ) {
        return false;
      }

      if (
        moneda &&
        String(row.moneda || "") !== moneda
      ) {
        return false;
      }

      if (
        destino &&
        getZonaDestinoPago(row.destino) !== destino
      ) {
        return false;
      }

      if (
        prioridad &&
        getPrioridadPagoKey(row) !== prioridad
      ) {
        return false;
      }

      if (!tiposActivos.size) {
        return false;
      }
      
      const tipoActivo =
        [...tiposActivos][0];
      
      if (
        tipoActivo ===
        "__todas_individuales__"
      ) {
        if (
          row.categoriaAlerta !==
          "persona"
        ) {
          return false;
        }
      } else if (
        tipoActivo ===
        "__todas_grupales__"
      ) {
        if (
          row.categoriaAlerta !==
          "grupo"
        ) {
          return false;
        }
      } else {
        const configuracion =
          [
            ...getTiposAlertasPagosUI()
              .grupales,
      
            ...getTiposAlertasPagosUI()
              .individuales
          ].find(
            (item) =>
              item.tipo ===
              tipoActivo
          );
      
        if (!configuracion) {
          return false;
        }
      
        if (
          row.categoriaAlerta !==
          configuracion.categoria
        ) {
          return false;
        }
      
        /*
          El filtro usa indicadores superpuestos,
          no solamente la categoría principal.
        */
        if (
          configuracion.campo &&
          row[
            configuracion.campo
          ] !== true
        ) {
          return false;
        }
      }

      if (q) {
        const texto = buildSearchText(row);

        if (!texto.includes(q)) {
          return false;
        }
      }

      return true;
    })
  );
}

function renderAlertasPagosListado(rows = []) {
  const cont = $("contenedor-alertas-pagos-listado");
  if (!cont) return;

  renderResumenAlertasPagos(rows);

  if (!rows.length) {
    cont.innerHTML = emptyHtml("No hay alertas de pagos para mostrar.");
    return;
  }

  cont.innerHTML = `
    <div style="overflow:auto; border:1px solid rgba(49,25,75,.10); border-radius:16px;">
      <table style="width:100%; border-collapse:collapse; font-size:12px;">
        <thead style="background:#32184f; color:white; position:sticky; top:0;">
          <tr>
            ${thOrdenAlertaPago("#", "numero")}
            ${thOrdenAlertaPago("Participante / Grupo", "participante")}
            ${thOrdenAlertaPago("Grupo", "grupo")}
            ${thOrdenAlertaPago("Año", "ano")}
            ${thOrdenAlertaPago("Fecha viaje", "fechaViaje")}
            ${thOrdenAlertaPago("Vendedor", "vendedor")}
            ${thOrdenAlertaPago("Razón", "razon")}
            ${thOrdenAlertaPago("Total programa", "total", "right")}
            ${thOrdenAlertaPago("Pagado", "pagado", "right")}
            ${thOrdenAlertaPago("Saldo", "saldo", "right")}
            ${thOrdenAlertaPago("Último pago", "ultimoPago")}
            ${thOrdenAlertaPago("Estado", "estado")}
          </tr>
        </thead>

        <tbody>
          ${rows.map((alerta, index) => {
            const esPersona = alerta.categoriaAlerta === "persona";
            const nombre = esPersona ? alerta.participante : alerta.grupo;
            const contactado = alerta.contactado === true;

            return `
              <tr
                data-open-detalle-alerta-pago="${escapeHtml(alerta.id)}"
                style="cursor:pointer; border-bottom:1px solid rgba(49,25,75,.08); background:${contactado ? "#eef8ef" : "#fff"};"
              >
                <td style="padding:9px 10px; font-weight:900;">${index + 1}</td>

                <td style="padding:9px 10px;">
                  <strong style="color:#26133d;">${escapeHtml(nombre || "-")}</strong><br>
                  <span style="color:#766b84;">${escapeHtml(esPersona ? (alerta.responsable || "Sin responsable") : "Alerta de grupo")}</span>
                </td>

                <td style="padding:9px 10px;">
                  ${escapeHtml(alerta.grupo || "-")}<br>
                  <span style="color:#766b84;">N° ${escapeHtml(alerta.numeroNegocio || "-")}</span>
                </td>

                <td style="padding:9px 10px;">${escapeHtml(alerta.anoViaje || "-")}</td>
                
                <td style="padding:9px 10px;">
                  ${escapeHtml(formatFechaViajeAlertaPago(alerta))}
                </td>
                
                <td style="padding:9px 10px;">${escapeHtml(alerta.vendedor || "Sin vendedor")}</td>
                <td style="padding:9px 10px; min-width:210px;">
                  <strong>${escapeHtml(alerta.label || alerta.tipo || "-")}</strong>
                
                  ${esPersona && getResumenCuotasTablaPago(alerta) ? `
                    <br>
                    <span style="display:inline-block; margin-top:4px; color:#766b84; line-height:1.4;">
                      ${escapeHtml(getResumenCuotasTablaPago(alerta))}
                    </span>
                  ` : ""}
                </td>
                
                <td style="padding:9px 10px; text-align:right;">
                  ${escapeHtml(formatoMontoPago(
                    esPersona ? (alerta.totalDebe || 0) : (alerta.totalViajeGrupo || alerta.totalDebeGrupo || alerta.totalDebe || 0),
                    alerta.moneda
                  ))}
                </td>

                <td style="padding:9px 10px; text-align:right;">
                  ${escapeHtml(formatoMontoPago(
                    esPersona ? (alerta.totalPagado || 0) : (alerta.totalPagadoGrupo || 0),
                    alerta.moneda
                  ))}
                </td>

                <td style="padding:9px 10px; text-align:right; font-weight:900;">
                  ${escapeHtml(formatoMontoPago(alerta.saldoPendiente || alerta.saldoPendienteGrupo || 0, alerta.moneda))}
                </td>

                <td style="padding:9px 10px;">${escapeHtml(alerta.ultimoPagoFecha || "-")}</td>

                <td style="padding:9px 10px;">
                  ${contactado
                    ? `<span style="color:#1d6a2b; font-weight:900;">Contactado</span>`
                    : `<span style="color:#9f1d1d; font-weight:900;">Pendiente</span>`
                  }
                </td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderTablaCasosEspecialesPago(alerta = {}) {
  let titulo = "";
  let rows = [];

  if (alerta.tipo === "grupo_liberados_parciales") {
    titulo = "Liberados parciales del grupo";
    rows = Array.isArray(alerta.pasajerosLiberacionParcial)
      ? alerta.pasajerosLiberacionParcial
      : [];
  }

  if (alerta.tipo === "grupo_saldo_a_favor") {
    titulo = "Personas con posible saldo a favor";
    rows = Array.isArray(alerta.pasajerosSaldoFavor)
      ? alerta.pasajerosSaldoFavor
      : [];
  }

  if (!titulo) return "";

  if (!rows.length) {
    return `
      <div class="home-empty">
        No hay detalle de personas guardado para esta alerta.
      </div>
    `;
  }

  return `
    <div style="margin-top:14px;">
      <strong style="display:block; margin-bottom:8px;">
        ${escapeHtml(titulo)}
      </strong>

      <div style="overflow:auto; border:1px solid rgba(49,25,75,.10); border-radius:14px;">
        <table style="width:100%; border-collapse:collapse; font-size:12px;">
          <thead style="background:#f7f3fb; color:#32184f;">
            <tr>
              <th style="padding:8px; text-align:right;">#</th>
              <th style="padding:8px; text-align:left;">Participante</th>
              <th style="padding:8px; text-align:left;">Responsable / contacto</th>
              <th style="padding:8px; text-align:right;">Total persona</th>
              <th style="padding:8px; text-align:right;">Total grupo</th>
              <th style="padding:8px; text-align:right;">Pagado</th>
              <th style="padding:8px; text-align:right;">Saldo</th>
              <th style="padding:8px; text-align:right;">Diferencia</th>
              <th style="padding:8px; text-align:right;">Saldo favor</th>
            </tr>
          </thead>

          <tbody>
            ${rows.map((p, idx) => `
              <tr style="border-top:1px solid rgba(49,25,75,.08);">
                <td style="padding:8px; text-align:right; font-weight:900;">
                  ${idx + 1}
                </td>

                <td style="padding:8px;">
                  <strong>${escapeHtml(p.participante || "-")}</strong><br>
                  <span style="color:#766b84;">${escapeHtml(p.rut || "")}</span>
                </td>

                <td style="padding:8px;">
                  <strong>${escapeHtml(p.responsable || "-")}</strong><br>
                  <span style="color:#766b84;">${escapeHtml(p.correoResponsable || "-")}</span><br>
                  <span style="color:#766b84;">${escapeHtml(p.telefonoResponsable || "-")}</span>
                </td>

                <td style="padding:8px; text-align:right;">
                  ${escapeHtml(formatoMontoPago(p.totalDebe || 0, alerta.moneda))}
                </td>

                <td style="padding:8px; text-align:right;">
                  ${escapeHtml(formatoMontoPago(p.totalReferenciaGrupo || 0, alerta.moneda))}
                </td>

                <td style="padding:8px; text-align:right;">
                  ${escapeHtml(formatoMontoPago(p.totalPagado || 0, alerta.moneda))}
                </td>

                <td style="padding:8px; text-align:right; font-weight:900;">
                  ${escapeHtml(formatoMontoPago(p.saldoPendiente || 0, alerta.moneda))}
                </td>

                <td style="padding:8px; text-align:right;">
                  ${escapeHtml(formatoMontoPago(p.diferenciaValorPrograma || 0, alerta.moneda))}
                </td>

                <td style="padding:8px; text-align:right; font-weight:900;">
                  ${escapeHtml(formatoMontoPago(p.saldoFavorEstimado || 0, alerta.moneda))}
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderAlertaPagoCard(alerta = {}) {
  const esPersona = alerta.categoriaAlerta === "persona";
  const idGrupo = String(alerta.idGrupo || "").trim();
  const textoSugerido = esPersona ? getTextoSugeridoPago(alerta) : "";
  const yaContactado = alerta.contactado === true;
  const gmailUrl = esPersona ? getGmailUrlAlertaPago(alerta) : "";
  const whatsappUrl = esPersona ? getWhatsappUrlAlertaPago(alerta) : "";

  return `
    <div class="home-card-row">
      <div style="min-width:0;">
        <div class="home-card-row-title">
          ${escapeHtml(esPersona ? (alerta.participante || "Participante") : (alerta.grupo || "Grupo"))}
        </div>

        <div class="home-card-row-text">
          <strong>Razón:</strong> ${escapeHtml(alerta.label || alerta.tipo || "Alerta de pago")}<br>
          Grupo: ${escapeHtml(alerta.grupo || "-")} · N° ${escapeHtml(alerta.numeroNegocio || "-")}<br>
          Año: ${escapeHtml(alerta.anoViaje || "-")} · Vendedor(a): ${escapeHtml(alerta.vendedor || "Sin vendedor")}<br>
          Moneda: ${escapeHtml(alerta.moneda || "-")} · Prioridad: ${escapeHtml(getPrioridadPagoLabel(alerta))}
        </div>

        ${esPersona ? `
          <div style="margin-top:10px; color:#3e3550; font-size:14px; line-height:1.5;">
            <strong>Apoderado(a):</strong> ${escapeHtml(alerta.responsable || "-")}<br>
            <strong>Correo:</strong> ${escapeHtml(alerta.correoResponsable || "-")}<br>
            <strong>Teléfono:</strong> ${escapeHtml(alerta.telefonoResponsable || "-")}<br>
          
            <strong>Total programa:</strong>
            ${escapeHtml(formatoMontoPago(alerta.totalDebe, alerta.moneda))}<br>
          
            <strong>Total pagado:</strong>
            ${escapeHtml(formatoMontoPago(alerta.totalPagado, alerta.moneda))}<br>
          
            <strong>Saldo pendiente:</strong>
            ${escapeHtml(formatoMontoPago(alerta.saldoPendiente, alerta.moneda))}<br>
          
            <strong>Último pago:</strong>
            ${escapeHtml(alerta.ultimoPagoFecha || "Sin registro")}
          </div>
          
          ${renderDetalleCuotasAlertaPago(alerta)}

          ${yaContactado ? `
            <div style="margin-top:10px; padding:10px 12px; border-radius:14px; background:#eef8ef; border:1px solid #b9dfc0; color:#1d6a2b; font-size:13px;">
              ✅ Ya contactado por ${escapeHtml(alerta.contactadoPor || alerta.contactadoPorCorreo || "usuario")} el ${escapeHtml(formatDate(alerta.contactadoAt))}.<br>
              ⚠ Recuerda que este contacto debe estar registrado también en el historial del Sistema de Pagos.
            </div>
          ` : ""}

          <details open style="margin-top:10px;">
            <summary style="cursor:pointer; font-weight:800;">Texto sugerido para contactar</summary>
            <div style="margin-top:8px; white-space:pre-wrap; padding:10px; border-radius:12px; background:#f7f3fb;">
              ${escapeHtml(textoSugerido)}
            </div>
          </details>
        ` : `
          <div style="margin-top:10px; color:#3e3550; font-size:14px; line-height:1.5;">
            <strong>Total viajan:</strong> ${escapeHtml(alerta.totalViajan || 0)}<br>
            <strong>Con deuda:</strong> ${escapeHtml(alerta.totalConDeuda || 0)}<br>
            <strong>% saldo pendiente grupo:</strong> ${escapeHtml(Number(alerta.porcentajeGrupoDebe || 0).toFixed(1))}%<br>
            <strong>Saldo pendiente grupo:</strong> ${escapeHtml(formatoMontoPago(alerta.saldoPendienteGrupo, alerta.moneda))}<br>
            <strong>Total pagado grupo:</strong> ${escapeHtml(formatoMontoPago(alerta.totalPagadoGrupo || 0, alerta.moneda))}<br>
            <strong>30%+ sin pago +60 días:</strong>
            ${escapeHtml(alerta.totalDeudoresSinPago60 || 0)}
            persona(s)
            (${escapeHtml(Number(alerta.porcentajeGrupoSinPago60 || 0).toFixed(1))}%)
          </div>
        
          ${["grupo_liberados_parciales", "grupo_saldo_a_favor"].includes(alerta.tipo)
            ? renderTablaCasosEspecialesPago(alerta)
            : `
              <div style="margin-top:14px;">
                <strong style="display:block; margin-bottom:8px;">Personas con deuda del grupo</strong>
          
                ${Array.isArray(alerta.pasajerosConDeudaGrupo) && alerta.pasajerosConDeudaGrupo.length ? `
                  <div style="overflow:auto; border:1px solid rgba(49,25,75,.10); border-radius:14px;">
                    <table style="width:100%; border-collapse:collapse; font-size:12px;">
                      <thead style="background:#f7f3fb; color:#32184f;">
                        <tr>
                          <th style="padding:8px; text-align:right;">#</th>
                          <th style="padding:8px; text-align:left;">Participante</th>
                          <th style="padding:8px; text-align:left;">Responsable / contacto</th>
                          <th style="padding:8px; text-align:right;">Pagado</th>
                          <th style="padding:8px; text-align:right;">Saldo</th>
                          <th style="padding:8px; text-align:left;">Último pago</th>
                          <th style="padding:8px; text-align:right;">Días</th>
                          <th style="padding:8px; text-align:center;">Gestión</th>
                        </tr>
                      </thead>
          
                      <tbody>
                        ${alerta.pasajerosConDeudaGrupo.map((p, idx) => `
                          <tr style="border-top:1px solid rgba(49,25,75,.08);">
                            <td style="padding:8px; text-align:right; font-weight:900;">${idx + 1}</td>
          
                            <td style="padding:8px;">
                              <strong>${escapeHtml(p.participante || "-")}</strong><br>
                              <span style="color:#766b84;">${escapeHtml(p.rut || "")}</span>
                            </td>
          
                            <td style="padding:8px;">
                              <strong>${escapeHtml(p.responsable || "-")}</strong><br>
                              <span style="color:#766b84;">${escapeHtml(p.correoResponsable || "-")}</span><br>
                              <span style="color:#766b84;">${escapeHtml(p.telefonoResponsable || "-")}</span>
                            </td>
          
                            <td style="padding:8px; text-align:right;">
                              ${escapeHtml(formatoMontoPago(p.totalPagado || 0, alerta.moneda))}
                            </td>
          
                            <td style="padding:8px; text-align:right; font-weight:900;">
                              ${escapeHtml(formatoMontoPago(p.saldoPendiente || 0, alerta.moneda))}
                            </td>
          
                            <td style="padding:8px;">
                              ${escapeHtml(p.ultimoPagoFecha || "-")}
                            </td>
          
                            <td style="padding:8px; text-align:right;">
                              ${escapeHtml(p.diasUltimoPago ?? "-")}
                            </td>
          
                            <td style="padding:8px; text-align:center;">
                              <button
                                type="button"
                                class="home-btn"
                                data-open-persona-grupo="${escapeHtml(alerta.id)}"
                                data-persona-index="${idx}"
                                style="padding:6px 10px; font-size:11px;"
                              >
                                Ver gestión
                              </button>
                            </td>
                          </tr>
                        `).join("")}
                      </tbody>
                    </table>
                  </div>
                ` : `
                  <div class="home-empty">No hay detalle de personas con deuda guardado para esta alerta.</div>
                `}
              </div>
            `
            }
          `}
      </div>

      <div style="display:flex; flex-direction:column; gap:8px;">
        ${esPersona ? `
          ${gmailUrl ? `
            <a href="${gmailUrl}" target="_blank" rel="noopener" class="home-btn" style="background:#b42318;">
              Gmail
            </a>
          ` : ""}

          ${whatsappUrl ? `
            <a href="${whatsappUrl}" target="_blank" rel="noopener" class="home-btn" style="background:#16833a;">
              WhatsApp
            </a>
          ` : ""}

          <button type="button" class="home-btn" data-copy-alerta-pago="${escapeHtml(alerta.id)}">
            Copiar texto
          </button>

          <button
            type="button"
            class="home-btn"
            data-contactar-alerta-pago="${escapeHtml(alerta.id)}"
            style="background:${yaContactado ? "#6d4a92" : "#1f7a3b"};"
          >
            ${yaContactado ? "Registrar nuevo contacto" : "Marcar contactado"}
          </button>
        ` : ""}

        <a href="grupo.html?id=${encodeURIComponent(idGrupo)}" target="_blank" rel="noopener" class="home-btn">
          Abrir grupo
        </a>
      </div>
    </div>
  `;
}

async function openDetalleAlertaPago(
  alertaId
) {
  const alerta =
    state.alertasPagosRows.find(
      (row) =>
        String(row.id) ===
        String(alertaId)
    );

  if (!alerta) {
    return;
  }

  let alertaCompleta =
    alerta;

  if (
    alerta.categoriaAlerta ===
    "grupo"
  ) {
    const detalleId =
      String(
        alerta.detalleId ||
        alerta.id ||
        ""
      );

    let detalle =
      state.detalleGrupoCache.get(
        detalleId
      );

    if (!detalle) {
      const cont =
        $(
          "modal-alerta-pago-contenido"
        );

      setText(
        "modal-alerta-pago-titulo",
        alerta.grupo ||
        "Detalle grupo"
      );

      setText(
        "modal-alerta-pago-subtitulo",
        "Cargando detalle..."
      );

      if (cont) {
        cont.innerHTML = `
          <div class="home-empty">
            Cargando participantes del grupo...
          </div>
        `;
      }

      openDialog(
        $(
          "modal-detalle-alerta-pago"
        )
      );

      const snapDetalle =
        await getDoc(
          doc(
            db,
            ALERTAS_PAGOS_DETALLE_COLLECTION,
            detalleId
          )
        );

      detalle =
        snapDetalle.exists()
          ? {
              id:
                snapDetalle.id,

              ...snapDetalle.data()
            }
          : {};

      state.detalleGrupoCache.set(
        detalleId,
        detalle
      );
    }

    alertaCompleta = {
      ...alerta,
      ...detalle
    };
    /*
      Guardamos también el detalle en el objeto
      que está dentro del estado de la página.
      Así funciona "Ver gestión".
    */
    Object.assign(
      alerta,
      detalle
    );
  }

  setText(
    "modal-alerta-pago-titulo",
    alertaCompleta
      .categoriaAlerta ===
    "persona"
      ? (
          alertaCompleta
            .participante ||
          "Detalle alerta"
        )
      : (
          alertaCompleta.grupo ||
          "Detalle grupo"
        )
  );

  setText(
    "modal-alerta-pago-subtitulo",
    alertaCompleta.label ||
    alertaCompleta
      .categoriaPrincipal ||
    "Alerta de pago"
  );

  const cont =
    $("modal-alerta-pago-contenido");

  if (cont) {
    cont.innerHTML =
      renderAlertaPagoCard(
        alertaCompleta
      );
  }

  openDialog(
    $("modal-detalle-alerta-pago")
  );
}

function openDetallePersonaDesdeGrupo(alertaGrupoId, indexPersona) {
  const alertaGrupo = state.alertasPagosRows.find((row) => String(row.id) === String(alertaGrupoId));
  if (!alertaGrupo) return;

  const p = alertaGrupo.pasajerosConDeudaGrupo?.[Number(indexPersona)];
  if (!p) return;

  const personaExistente = state.alertasPagosRows.find((row) =>
    row.categoriaAlerta === "persona" &&
    String(row.numeroNegocio || "") === String(alertaGrupo.numeroNegocio || "") &&
    (
      String(row.rut || "") === String(p.rut || "") ||
      normalizeLoose(row.participante || "") === normalizeLoose(p.participante || "")
    )
  );

  if (personaExistente) {
    openDetalleAlertaPago(personaExistente.id);
    return;
  }

  const rutKey = String(p.rut || p.participante || "")
    .replace(/[^a-zA-Z0-9]/g, "_")
    .slice(0, 80);

  const alertaPersona = {
    id: `persona_${alertaGrupo.numeroNegocio}_${rutKey}_desde_grupo`,
    categoriaAlerta: "persona",
    tipo: "persona_pago_parcial_con_saldo",
    label: "Saldo pendiente",
    nivel: "warning",
    activa: true,
    prioridad: 1,
    numeroNegocio: alertaGrupo.numeroNegocio || "",
    idGrupo: alertaGrupo.idGrupo || "",
    grupo: alertaGrupo.grupo || "",
    anoViaje: alertaGrupo.anoViaje || "",
    destino: alertaGrupo.destino || "",
    moneda: alertaGrupo.moneda || "",
    vendedor: alertaGrupo.vendedor || "",
    vendedoraCorreo: alertaGrupo.vendedoraCorreo || "",
    rut: p.rut || "",
    participante: p.participante || "",
    responsable: p.responsable || "",
    correoResponsable: p.correoResponsable || "",
    telefonoResponsable: p.telefonoResponsable || "",
    totalDebe: p.totalDebe || 0,
    totalPagado: p.totalPagado || 0,
    saldoPendiente: p.saldoPendiente || 0,
    ultimoPagoFecha: p.ultimoPagoFecha || "",
    ultimoPagoMonto: p.ultimoPagoMonto || 0,
    contactado: false
  };

  state.alertasPagosRows.push(alertaPersona);
  openDetalleAlertaPago(alertaPersona.id);
}

function exportarAlertasPagosXlsx() {
  const rows = filtrarAlertasPagosModal(state.alertasPagosFiltradasRows || []);

  if (!rows.length) {
    alert("No hay alertas para exportar con los filtros actuales.");
    return;
  }

  const fecha = new Date();
  const fechaTxt = fecha.toISOString().slice(0, 10);
  const horaTxt = fecha.toTimeString().slice(0, 5).replace(":", "");

  const data = rows.map((a, index) => ({
    numero: index + 1,
    exportadoEl: fecha.toLocaleString("es-CL"),
    categoria: a.categoriaAlerta || "",
    tipo: a.tipo || "",
    razon: a.label || "",
    participante: a.participante || "",
    responsable: a.responsable || "",
    correo: a.correoResponsable || "",
    telefono: a.telefonoResponsable || "",
    grupo: a.grupo || "",
    numeroNegocio: a.numeroNegocio || "",
    anoViaje: a.anoViaje || "",
    fechaViaje: formatFechaViajeAlertaPago(a),
    vendedor: a.vendedor || "",
    moneda: a.moneda || "",
    total: a.totalDebe || "",
    pagado: a.totalPagado || "",
    saldo: a.saldoPendiente || a.saldoPendienteGrupo || "",
    
    cantidadCuotas: a.cantidadCuotas || "",
    cuotasVencidas: a.cuotasVencidas || "",
    cuotasPagadasEstimadas:
      a.cuotasPagadasEstimadas ??
      a.cuotasCubiertas ??
      "",
    
    cuotasAtrasadasReales: a.cuotasAtrasadas || "",
    cuotasAtrasadasOperativas:
      Number(a.cuotasAtrasadas || 0) > 0
        ? Math.ceil(Number(a.cuotasAtrasadas || 0))
        : 0,
    
    valorCuota: a.valorCuota || "",
    estadoCuotas: getResumenCuotasTablaPago(a),
    
    ultimoPagoFecha: a.ultimoPagoFecha || "",
    contactado: a.contactado ? "Sí" : "No",
    contactadoPor: a.contactadoPor || a.contactadoPorCorreo || "",
    contactadoAt: a.contactadoAt || "",
    prioridad: a.prioridad || ""
  }));

  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(wb, ws, "Alertas pagos");

  XLSX.writeFile(wb, `alertas_pagos_${fechaTxt}_${horaTxt}.xlsx`);
}

async function copiarTextoAlertaPago(alertaId) {
  const alerta = state.alertasPagosRows.find((row) => String(row.id) === String(alertaId));
  if (!alerta) return;

  const texto = getTextoSugeridoPago(alerta);

  try {
    await navigator.clipboard.writeText(texto);
    alert("Texto copiado.");
  } catch (error) {
    console.error("No se pudo copiar:", error);
    alert(texto);
  }
}

async function marcarAlertaPagoContactada(alertaId) {
  const alerta = state.alertasPagosRows.find((row) => String(row.id) === String(alertaId));
  if (!alerta) return;

  const ok = confirm(
    "Antes de marcar como contactado:\n\n" +
    "Recuerda registrar este contacto también en el historial del Sistema de Pagos.\n\n" +
    "¿Confirmas que ya lo registraste o que lo registrarás ahora?"
  );

  if (!ok) return;

  const nota = prompt("Nota del contacto realizado:", "") || "";

  const user = getEffectiveUser() || {};
  const realUser = getRealUser() || {};

  const payload = {
    ...alerta,
    contactado: true,
    contactadoAt: new Date().toISOString(),
    contactadoPor: user.nombre || user.name || user.email || "",
    contactadoPorCorreo: normalizeEmail(user.email || ""),
    contactadoRealPorCorreo: normalizeEmail(realUser.email || ""),
    notaContacto: nota,
    requiereRegistroHistorialPagos: true,
    mensajeAviso: "Debe registrar este contacto en historial del Sistema de Pagos",
    actualizadoAt: new Date().toISOString()
  };

  await setDoc(
    doc(
      db,
      ALERTAS_PAGOS_PERSONAS_COLLECTION,
      alerta.id
    ),
    payload,
    {
      merge: true
    }
  );

  await addDoc(collection(db, ALERTAS_PAGOS_HISTORIAL_COLLECTION), {
    tipo: "contacto_alerta_pago",
    fecha: serverTimestamp(),
    usuario: user.nombre || user.name || user.email || "",
    usuarioCorreo: normalizeEmail(user.email || ""),
    realUsuarioCorreo: normalizeEmail(realUser.email || ""),
    alertaId: alerta.id,
    numeroNegocio: alerta.numeroNegocio || "",
    idGrupo: alerta.idGrupo || "",
    rut: alerta.rut || "",
    participante: alerta.participante || "",
    responsable: alerta.responsable || "",
    correoResponsable: alerta.correoResponsable || "",
    telefonoResponsable: alerta.telefonoResponsable || "",
    nota,
    aviso: "Usuario fue advertido de registrar contacto en historial del Sistema de Pagos"
  });

  closeDialog(
     $("modal-detalle-alerta-pago")
  );

  alerta.contactado =
    true;
  
  alerta.contactadoAt =
    payload.contactadoAt;
  
  alerta.contactadoPor =
    payload.contactadoPor;
  
  alerta.contactadoPorCorreo =
    payload.contactadoPorCorreo;
  
  alerta.notaContacto =
    payload.notaContacto;
  
  await abrirPaginaAlertasPagos();
}

async function actualizarAlertasPagos() {
  const anoViaje = $("filtro-alerta-pago-ano")?.value || "";
  const destino = $("filtro-alerta-pago-destino")?.value || "";

  const partes = [];

  if (anoViaje) partes.push(`año ${anoViaje}`);
  if (destino) partes.push(`destino ${destino}`);

  const alcance = partes.length ? partes.join(" · ") : "todos los grupos";

  const ok = confirm(
    "Esto recalculará las alertas de pagos desde el backend.\n\n" +
    `Alcance: ${alcance}\n\n` +
    "Puede demorar algunos minutos.\n\n" +
    "¿Deseas continuar?"
  );

  if (!ok) return;

  const btn =
    $("btn-actualizar-alertas-pagos") ||
    $("btn-home-actualizar-alertas-pagos");

  if (btn) {
    btn.disabled = true;
    btn.textContent = "Actualizando...";
  }

  try {
    const params = new URLSearchParams();
    params.set("origen", "manual");

    if (anoViaje) params.set("anoViaje", anoViaje);
    if (destino) params.set("destino", destino);

    const res = await fetch(`https://southamerica-west1-sist-op-rt.cloudfunctions.net/actualizarAlertasPagos?${params.toString()}`);
    const data = await res.json();

    if (!res.ok || data.ok === false) {
      throw new Error(data.error || "Error actualizando alertas");
    }

    alert(
      "Actualización finalizada.\n\n" +
      `Grupos procesados: ${data.totalGruposProcesados}\n` +
      `Alertas generadas: ${data.totalAlertas}\n` +
      `Personas: ${data.totalPersonas}\n` +
      `Grupos: ${data.totalGrupos}`
    );

    const anosARecargar =
      anoViaje &&
      anoViaje !== "__iniciales__"
        ? [
            String(anoViaje)
          ]
        : [
            ...new Set([
              ...state.anosGruposCargados,
              ...state.anosPersonasCargados
            ])
          ];
    
    await Promise.all([
      cargarAlertasPagosDesdeFirestore({
        forzar: true,
        anos: anosARecargar,
        categoria: "grupo"
      }),
    
      state.anosPersonasCargados.size
        ? cargarAlertasPagosDesdeFirestore({
            forzar: true,
            anos: anosARecargar,
            categoria: "persona"
          })
        : Promise.resolve()
    ]);
    
    await abrirPaginaAlertasPagos();

  } catch (error) {
    console.error("Error actualizando alertas de pagos:", error);
    alert("No se pudieron actualizar las alertas de pagos: " + error.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Actualizar";
    }
  }
}

async function abrirPaginaAlertasPagos() {
  await cargarAlertasPagosDesdeFirestore();

  const app =
    $("alertas-pagos-app");

  if (!app) {
    console.error(
      "No existe #alertas-pagos-app en alertas-pagos.html"
    );

    return;
  }

  state.alertasPagosFiltradasRows =
    getAlertasPagosForScope();

  app.innerHTML =
    buildAlertasPagosFiltrosHtml(
      state.alertasPagosFiltradasRows
    );

  app.hidden = false;

  const rowsBase =
    state.alertasPagosFiltradasRows ||
    [];

  const refrescar = () => {
    const filtradas =
      filtrarAlertasPagosModal(
        rowsBase
      );

    renderAlertasPagosListado(
      filtradas
    );

    document
      .querySelectorAll(
        "[data-sort-alerta-pago]"
      )
      .forEach((th) => {
        if (
          th.dataset.boundSort
        ) {
          return;
        }

        th.dataset.boundSort = "1";

        th.addEventListener(
          "click",
          () => {
            const key =
              th.dataset
                .sortAlertaPago;

            if (
              state
                .alertasPagosSortKey ===
              key
            ) {
              state
                .alertasPagosSortDir =
                state
                  .alertasPagosSortDir ===
                "asc"
                  ? "desc"
                  : "asc";
            } else {
              state
                .alertasPagosSortKey =
                key;

              state
                .alertasPagosSortDir =
                [
                  "pagado",
                  "saldo",
                  "ano",
                  "ultimoPago",
                  "estado",
                  "numero"
                ].includes(key)
                  ? "desc"
                  : "asc";
            }

            refrescar();
          }
        );
      });
  };

  const filtroAno =
    $("filtro-alerta-pago-ano");
  
  if (
    filtroAno &&
    !filtroAno.dataset.bound
  ) {
    filtroAno.dataset.bound = "1";
  
    filtroAno.addEventListener(
      "change",
      async () => {
        const nuevoValor =
          filtroAno.value ||
          "__iniciales__";
  
        state.anoFiltro =
          nuevoValor;
  
        /*
          "Todos 2026–2027" ya está
          disponible en memoria.
        */
        if (
          nuevoValor ===
          "__iniciales__"
        ) {
          refrescar();
          return;
        }
  
        /*
          Si el año ya se descargó antes,
          solo aplicamos el filtro local.
        */
        const anosCargadosModo =
          state.modoActivo === "persona"
            ? state.anosPersonasCargados
            : state.anosGruposCargados;
        
        if (
          anosCargadosModo.has(
            nuevoValor
          )
        ) {
          refrescar();
          return;
        }
  
        const loading =
          $("alertas-pagos-loading");
  
        const app =
          $("alertas-pagos-app");
  
        if (loading) {
          loading.hidden = false;
          loading.textContent =
            `Cargando alertas activas ${nuevoValor}...`;
        }
  
        if (app) {
          app.hidden = true;
        }
  
        try {
          logCargaPagos(
            `El usuario solicitó el año ${nuevoValor}`
          );
  
          await cargarAlertasPagosDesdeFirestore({
            anos: [
              nuevoValor
            ],
          
            categoria:
              state.modoActivo
          });
  
          /*
            Volvemos a construir la interfaz
            para incorporar el año nuevo.
          */
          await abrirPaginaAlertasPagos();
        } catch (error) {
          console.error(
            `Error cargando año ${nuevoValor}:`,
            error
          );
  
          alert(
            `No se pudieron cargar las alertas ${nuevoValor}: ${error.message}`
          );
  
          state.anoFiltro =
            "__iniciales__";
  
          await abrirPaginaAlertasPagos();
        } finally {
          if (loading) {
            loading.hidden = true;
          }
  
          if (app) {
            app.hidden = false;
          }
        }
      }
    );
  }
  
  [
    "filtro-alerta-pago-vendedor",
    "filtro-alerta-pago-moneda",
    "filtro-alerta-pago-destino",
    "filtro-alerta-pago-prioridad",
    "filtro-alerta-pago-buscar"
  ].forEach((id) => {
    const element = $(id);
  
    if (
      !element ||
      element.dataset.bound
    ) {
      return;
    }
  
    element.dataset.bound = "1";
  
    element.addEventListener(
      "input",
      refrescar
    );
  
    element.addEventListener(
      "change",
      refrescar
    );
  });

  const btnExportar =
    $("btn-exportar-alertas-pagos") ||
    $("btn-exportar-alertas");

  if (
    btnExportar &&
    !btnExportar.dataset.bound
  ) {
    btnExportar.dataset.bound = "1";

    btnExportar.addEventListener(
      "click",
      exportarAlertasPagosXlsx
    );
  }

  document
    .querySelectorAll(
      "[data-tipo-alerta-pago]"
    )
    .forEach((btn) => {
      if (btn.dataset.bound) {
        return;
      }

      btn.dataset.bound = "1";

      btn.addEventListener(
        "click",
        async () => {
          const tipo =
            btn.dataset
              .tipoAlertaPago;
      
          const categoria =
            btn.dataset
              .chipCategoria;
      
          state.tipoActivo =
            tipo;
      
          state.modoActivo =
            categoria;
      
          /*
            Las personas no se cargan al abrir la página.
            Se descargan la primera vez que el usuario
            selecciona una categoría individual.
          */
          if (
            categoria === "persona"
          ) {
            const anosObjetivo =
              state.anoFiltro ===
              "__iniciales__"
                ? state.anosIniciales
                : [
                    state.anoFiltro
                  ];
      
            const faltanPersonas =
              anosObjetivo.some(
                (ano) =>
                  !state
                    .anosPersonasCargados
                    .has(
                      String(ano)
                    )
              );
      
            if (faltanPersonas) {
              const loading =
                $("alertas-pagos-loading");
      
              if (loading) {
                loading.hidden = false;
      
                loading.textContent =
                  "Cargando alertas individuales...";
              }
      
              await Promise.all(
                anosObjetivo.map(
                  (ano) =>
                    cargarAnoPersonasPagos(
                      ano
                    )
                )
              );
      
              reconstruirAlertasPagosDesdeCache();
      
              if (loading) {
                loading.hidden = true;
              }
      
              /*
                Se reconstruye para incorporar
                vendedores y datos individuales.
              */
              await abrirPaginaAlertasPagos();
              return;
            }
          }
      
          document
            .querySelectorAll(
              "[data-tipo-alerta-pago]"
            )
            .forEach(
              (otroBtn) => {
                otroBtn.classList.remove(
                  "is-active"
                );
      
                otroBtn.style.background =
                  otroBtn.dataset
                    .bgNormal ||
                  "#fff";
      
                otroBtn.style.color =
                  otroBtn.dataset
                    .colorNormal ||
                  "#766b84";
      
                otroBtn.style.border =
                  otroBtn.dataset
                    .borderNormal ||
                  "1px solid rgba(49,25,75,.18)";
              }
            );
      
          btn.classList.add(
            "is-active"
          );
      
          btn.style.background =
            btn.dataset.bgActivo ||
            "#eadff7";
      
          btn.style.color =
            btn.dataset.colorActivo ||
            "#32184f";
      
          btn.style.border =
            btn.dataset.borderActivo ||
            "2px solid #32184f";
      
          refrescar();
        }
      );
    });

  refrescar();
}

/* =========================================================
   EVENTOS DE LA PÁGINA
========================================================= */

function bindAlertasPagosPage() {
  if (
    !document.body.dataset
      .boundAlertasPagosPage
  ) {
    document.body.dataset
      .boundAlertasPagosPage =
      "1";

    document.addEventListener(
      "click",
      async (event) => {
        const fila =
          event.target.closest(
            "[data-open-detalle-alerta-pago]"
          );

        if (fila) {
          event.preventDefault();

          await openDetalleAlertaPago(
            fila.dataset
              .openDetalleAlertaPago
          );
          return;
        }

        const personaGrupo =
          event.target.closest(
            "[data-open-persona-grupo]"
          );

        if (personaGrupo) {
          event.preventDefault();
          event.stopPropagation();

          openDetallePersonaDesdeGrupo(
            personaGrupo.dataset
              .openPersonaGrupo,
            personaGrupo.dataset
              .personaIndex
          );

          return;
        }

        const copiar =
          event.target.closest(
            "[data-copy-alerta-pago]"
          );

        if (copiar) {
          event.preventDefault();

          await copiarTextoAlertaPago(
            copiar.dataset
              .copyAlertaPago
          );

          return;
        }

        const contactar =
          event.target.closest(
            "[data-contactar-alerta-pago]"
          );

        if (contactar) {
          event.preventDefault();

          await marcarAlertaPagoContactada(
            contactar.dataset
              .contactarAlertaPago
          );
        }
      }
    );
  }

  const btnCerrar =
    $("btn-cerrar-alerta-pago");

  const dialog =
    $("modal-detalle-alerta-pago");

  if (
    btnCerrar &&
    !btnCerrar.dataset.bound
  ) {
    btnCerrar.dataset.bound = "1";

    btnCerrar.addEventListener(
      "click",
      () => {
        closeDialog(dialog);
      }
    );
  }

  if (
    dialog &&
    !dialog.dataset.bound
  ) {
    dialog.dataset.bound = "1";

    dialog.addEventListener(
      "click",
      (event) => {
        if (event.target === dialog) {
          closeDialog(dialog);
        }
      }
    );
  }
}

/* =========================================================
   INIT
========================================================= */

async function renderPantallaAlertasPagos() {
  const realUser =
    getRealUser();

  const effectiveUser =
    getEffectiveUser();

  if (
    !realUser ||
    !effectiveUser
  ) {
    location.href =
      "login.html";

    return;
  }

  setHeaderState({
    realUser,
    effectiveUser,
    title: "Alertas de pagos",
    subtitle:
      "Gestión de alertas de pagos"
  });

  renderActingUserSwitcher(
    VENTAS_USERS
  );

  await cargarDatosAlertasPagos();
  await abrirPaginaAlertasPagos();
}

async function initAlertasPagosPage() {
  const inicioInit =
    performance.now();

  logCargaPagos(
    "Iniciando alertas-pagos.js"
  );

  logCargaPagos(
    "Esperando layout..."
  );

  await waitForLayoutReady();

  logCargaPagos(
    `Layout disponible · ${Math.round(
      performance.now() -
      inicioInit
    )} ms`
  );

  bindLayoutButtons({
    homeUrl: HOME_URL,

    onLogout: async () => {
      try {
        sessionStorage.removeItem(
          ACTING_USER_KEY
        );

        clearVendorFilter();
        clearGroupFilter();

        await signOut(auth);

        location.href =
          "login.html";
      } catch (error) {
        alert(
          "Error al cerrar sesión: " +
          error.message
        );
      }
    },

    onActAs: async (
      selectedEmail
    ) => {
      const realUser =
        getRealUser();

      if (
        !realUser ||
        realUser.rol !== "admin"
      ) {
        return;
      }

      if (!selectedEmail) {
        return;
      }

      sessionStorage.setItem(
        ACTING_USER_KEY,
        selectedEmail
      );

      clearVendorFilter();
      clearGroupFilter();

      await renderPantallaAlertasPagos();
    },

    onResetActAs: async () => {
      sessionStorage.removeItem(
        ACTING_USER_KEY
      );

      clearVendorFilter();
      clearGroupFilter();

      await renderPantallaAlertasPagos();
    }
  });

  bindAlertasPagosPage();

  onAuthStateChanged(
    auth,
    async (user) => {
      logCargaPagos(
        "Firebase Auth respondió",
        {
          conectado: !!user,
          correo: user?.email || ""
        }
      );
  
      if (!user) {
        location.href =
          "login.html";
  
        return;
      }
  
      const inicioRender =
        performance.now();
  
      await renderPantallaAlertasPagos();
  
      logCargaPagos(
        `Render general terminado · ${Math.round(
          performance.now() -
          inicioRender
        )} ms`
      );
    }
  );

  updateClockDataset();

  setInterval(
    updateClockDataset,
    1000
  );
}

initAlertasPagosPage();
