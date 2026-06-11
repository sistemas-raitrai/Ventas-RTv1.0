// dashboard.js

const API_PAGOS_URL = "/api/pagos";

let gruposOriginales = [];
let gruposFiltrados = [];
let detalleActual = null;

const $ = (id) => document.getElementById(id);

const els = {
  filtroAno: $("filtroAno"),
  filtroMoneda: $("filtroMoneda"),
  filtroDestino: $("filtroDestino"),
  filtroEstadoPago: $("filtroEstadoPago"),
  buscadorPagos: $("buscadorPagos"),
  btnRecargarPagos: $("btnRecargarPagos"),
  btnExportarPagos: $("btnExportarPagos"),
  tbodyGruposPagos: $("tbodyGruposPagos"),

  sumGrupos: $("sumGrupos"),
  sumTotalViaje: $("sumTotalViaje"),
  sumPagado: $("sumPagado"),
  sumSaldo: $("sumSaldo"),
  sumPorcentaje: $("sumPorcentaje"),
  sumSinPagos: $("sumSinPagos"),
  sumConSaldo: $("sumConSaldo"),

  detalleGrupoBox: $("detalleGrupoBox"),
  detalleBackdrop: $("detalleBackdrop"),
  detalleTitulo: $("detalleTitulo"),
  btnCerrarDetalle: $("btnCerrarDetalle"),
  btnExportarDetalle: $("btnExportarDetalle"),
  tbodyDetallePasajeros: $("tbodyDetallePasajeros"),

  detPasajeros: $("detPasajeros"),
  detViajan: $("detViajan"),
  detNoViajan: $("detNoViajan"),
  detCredencial: $("detCredencial"),
  detSinCredencial: $("detSinCredencial"),
  detPagado: $("detPagado"),
  detSaldo: $("detSaldo")
};

document.addEventListener("DOMContentLoaded", initDashboardPagos);

function initDashboardPagos() {
  // Mueve el modal fuera del panel principal.
  // Así no queda cortado por el contenedor del dashboard.
  if (els.detalleGrupoBox && els.detalleGrupoBox.parentElement !== document.body) {
    document.body.appendChild(els.detalleGrupoBox);
  }

  els.btnRecargarPagos.addEventListener("click", cargarGruposPagos);
  els.btnExportarPagos.addEventListener("click", exportarGruposPagos);
  els.btnCerrarDetalle.addEventListener("click", cerrarDetalle);
  els.btnExportarDetalle.addEventListener("click", exportarDetalleNomina);

  if (els.detalleBackdrop) {
    els.detalleBackdrop.addEventListener("click", cerrarDetalle);
  }

  [
    els.filtroAno,
    els.filtroMoneda,
    els.filtroDestino,
    els.filtroEstadoPago,
    els.buscadorPagos
  ].forEach((el) => el.addEventListener("input", aplicarFiltros));

  cargarGruposPagos();
}

async function cargarGruposPagos() {
  els.tbodyGruposPagos.innerHTML =
    `<tr><td colspan="11" class="seg-empty">Cargando grupos...</td></tr>`;

  try {
    const data = await fetchJson(`${API_PAGOS_URL}?modo=grupos`);

    const lista = data?.grupos?.data || [];

    gruposOriginales = lista.map(normalizarGrupo);
    gruposFiltrados = [...gruposOriginales];

    cargarFiltros();
    aplicarFiltros();

  } catch (error) {
    console.error("Error cargando grupos:", error);
    els.tbodyGruposPagos.innerHTML =
      `<tr><td colspan="11" class="seg-empty">Error cargando grupos.</td></tr>`;
  }
}

async function cargarDetalleGrupo(numeroNegocio) {
  els.detalleGrupoBox.classList.remove("hidden");

  // Evita que se mueva la página de fondo mientras el modal está abierto.
  document.documentElement.style.overflow = "hidden";
  document.body.style.overflow = "hidden";

  els.detalleTitulo.textContent = `Cargando detalle N° ${numeroNegocio}...`;
  els.tbodyDetallePasajeros.innerHTML =
    `<tr><td colspan="10" class="seg-empty">Cargando pasajeros...</td></tr>`;

  try {
    const data = await fetchJson(
      `${API_PAGOS_URL}?modo=detalle&numeroNegocio=${encodeURIComponent(numeroNegocio)}`
    );

    detalleActual = data;

    console.log("NOMINAS COMPLETO:", JSON.stringify(data?.nominas, null, 2));
    console.log("SALDOS COMPLETO:", JSON.stringify(data?.saldos, null, 2));
    
    const primerPasajeroNomina = data?.nominas?.data?.pasajeros?.[0]?.pasajero;
    const primerPasajeroSaldo = data?.saldos?.data?.detalle_pasajeros?.[0];
    
    console.log("CAMPOS NOMINA:", Object.keys(primerPasajeroNomina || {}));
    console.log("CAMPOS SALDOS:", Object.keys(primerPasajeroSaldo || {}));
    
    console.log("PRIMER PASAJERO NOMINA:", JSON.stringify(primerPasajeroNomina, null, 2));
    console.log("PRIMER PASAJERO SALDOS:", JSON.stringify(primerPasajeroSaldo, null, 2));

    const resumen = data?.saldos?.data?.resumen_grupo || {};
    const pasajeros =
      data?.nominas?.data?.pasajeros ||
      data?.saldos?.data?.detalle_pasajeros ||
      [];

    console.log("DATA COMPLETA PAGOS:", JSON.stringify(data, null, 2));

    const grupo = gruposOriginales.find(
      (g) => String(g.numeroNegocio) === String(numeroNegocio)
    );

    els.detalleTitulo.textContent =
      `Detalle N° ${numeroNegocio}${grupo?.nombreGrupo ? " · " + grupo.nombreGrupo : ""}`;

    renderResumenDetalle(resumen);
    renderTablaDetalle(pasajeros);

  } catch (error) {
    console.error("Error cargando detalle:", error);
    els.tbodyDetallePasajeros.innerHTML =
      `<tr><td colspan="10" class="seg-empty">Error cargando detalle.</td></tr>`;
  }
}

function cargarFiltros() {
  const anoOperativo = obtenerAnoOperativo();

  const anos = [...new Set(
    gruposOriginales
      .map(g => Number(g.anoViaje))
      .filter(a => a && a >= anoOperativo)
  )].sort((a, b) => a - b);

  const destinos = [...new Set(
    gruposOriginales
      .filter(g => Number(g.anoViaje) >= anoOperativo)
      .map(g => g.destino)
      .filter(Boolean)
  )].sort();

  els.filtroAno.innerHTML =
    `<option value="desde_actual">Desde ${anoOperativo}</option>` +
    anos.map(a => `<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`).join("");

  els.filtroDestino.innerHTML =
    `<option value="todos">Todos</option>` +
    destinos.map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join("");

  els.filtroAno.value = "desde_actual";
}

function aplicarFiltros() {
  const ano = els.filtroAno.value;
  const moneda = els.filtroMoneda.value;
  const destino = els.filtroDestino.value;
  const estadoPago = els.filtroEstadoPago.value;
  const q = normalizarTexto(els.buscadorPagos.value);

  gruposFiltrados = gruposOriginales.filter((g) => {
    if (ano === "desde_actual") {
      const anoOperativo = obtenerAnoOperativo();
      if (Number(g.anoViaje) < anoOperativo) return false;
    } else if (ano !== "todos" && String(g.anoViaje) !== String(ano)) {
      return false;
    }
    if (moneda !== "todos" && g.monedaTexto !== moneda) return false;
    if (destino !== "todos" && g.destino !== destino) return false;

    if (estadoPago === "pagado" && g.saldoPendiente > 0) return false;
    if (estadoPago === "pendiente" && g.saldoPendiente <= 0) return false;
    if (estadoPago === "sin_pagos" && g.totalPagado > 0) return false;

    if (q) {
      const texto = normalizarTexto([
        g.numeroNegocio,
        g.nombreGrupo,
        g.destino,
        g.anoViaje,
        g.monedaTexto
      ].join(" "));
      if (!texto.includes(q)) return false;
    }

    return true;
  });

  renderResumenGeneral();
  renderTablaGrupos();
}

function renderResumenGeneral() {
  const totalGrupos = gruposFiltrados.length;
  const totalViaje = suma(gruposFiltrados, "totalViaje");
  const totalPagado = suma(gruposFiltrados, "totalPagado");
  const saldo = suma(gruposFiltrados, "saldoPendiente");
  const porcentaje = totalViaje > 0 ? (totalPagado / totalViaje) * 100 : 0;
  const sinPagos = gruposFiltrados.filter(g => g.totalPagado <= 0).length;
  const conSaldo = gruposFiltrados.filter(g => g.saldoPendiente > 0).length;

  els.sumGrupos.textContent = totalGrupos;
  els.sumTotalViaje.textContent = formatoMontoMixto(totalViaje);
  els.sumPagado.textContent = formatoMontoMixto(totalPagado);
  els.sumSaldo.textContent = formatoMontoMixto(saldo);
  els.sumPorcentaje.textContent = `${porcentaje.toFixed(1)}%`;
  els.sumSinPagos.textContent = sinPagos;
  els.sumConSaldo.textContent = conSaldo;
}

function renderTablaGrupos() {
  if (!gruposFiltrados.length) {
    els.tbodyGruposPagos.innerHTML =
      `<tr><td colspan="11" class="seg-empty">No hay grupos para mostrar.</td></tr>`;
    return;
  }

  const ordenados = [...gruposFiltrados].sort((a, b) => {
    if (a.anoViaje !== b.anoViaje) return Number(a.anoViaje || 0) - Number(b.anoViaje || 0);
    return String(a.nombreGrupo).localeCompare(String(b.nombreGrupo), "es");
  });

  els.tbodyGruposPagos.innerHTML = ordenados.map((g) => {
    const porcentaje = g.totalViaje > 0 ? (g.totalPagado / g.totalViaje) * 100 : 0;
    const estado = estadoGrupoPago(g);

    return `
      <tr>
        <td class="grupo-cell">
          <div class="grupo-title">${escapeHtml(g.nombreGrupo || "-")}</div>
          <div class="grupo-sub">N° ${escapeHtml(g.numeroNegocio)} · ${escapeHtml(g.monedaTexto || "")}</div>
        </td>
        <td>${escapeHtml(g.anoViaje || "-")}</td>
        <td>${formatearFecha(g.fechaSalida)}</td>
        <td>${escapeHtml(g.destino || "-")}</td>
        <td>${escapeHtml(g.monedaTexto || "-")}</td>
        <td>${formatoMoneda(g.totalViaje, g.monedaTexto)}</td>
        <td>${formatoMoneda(g.totalPagado, g.monedaTexto)}</td>
        <td>${formatoMoneda(g.saldoPendiente, g.monedaTexto)}</td>
        <td>
          <div class="progress-pay" title="${porcentaje.toFixed(1)}%">
            <span style="width:${Math.min(100, porcentaje).toFixed(1)}%"></span>
          </div>
          <small>${porcentaje.toFixed(1)}%</small>
        </td>
        <td>${estado}</td>
        <td>
          <button class="btn-page sec btn-detalle" type="button" data-negocio="${escapeHtml(g.numeroNegocio)}">
            Ver nómina
          </button>
        </td>
      </tr>
    `;
  }).join("");

  document.querySelectorAll(".btn-detalle").forEach((btn) => {
    btn.addEventListener("click", () => cargarDetalleGrupo(btn.dataset.negocio));
  });
}

function renderResumenDetalle(resumen) {
  els.detPasajeros.textContent = resumen.total_pasajeros ?? 0;
  els.detViajan.textContent = resumen.total_viajan ?? 0;
  els.detNoViajan.textContent = resumen.total_no_viajan ?? 0;
  els.detCredencial.textContent = resumen.con_credencial ?? 0;
  els.detSinCredencial.textContent = resumen.sin_credencial ?? 0;
  els.detPagado.textContent = formatoCLP(resumen.monto_total_pagado || 0);
  els.detSaldo.textContent = formatoCLP(resumen.saldo_pendiente || 0);
}

function renderTablaDetalle(items) {
  if (!items.length) {
    els.tbodyDetallePasajeros.innerHTML =
      `<tr><td colspan="13" class="seg-empty">No hay pasajeros para mostrar.</td></tr>`;
    return;
  }

  const pasajeros = items.map(normalizarPasajero);

  els.tbodyDetallePasajeros.innerHTML = pasajeros.map((p) => {
    const estadoViaje = p.viaja
      ? `<span class="badge badge-ok">Viaja</span>`
      : `<span class="badge badge-danger">No viaja</span>`;

    const credencial = p.tieneCredencial
      ? `<span class="badge badge-ok">Con carnet</span>`
      : `<span class="badge badge-warn">Sin carnet</span>`;

    const estadoPago = p.saldoPendiente <= 0
      ? `<span class="badge badge-ok">Pagado</span>`
      : p.totalPagado <= 0
        ? `<span class="badge badge-danger">Sin pagos</span>`
        : `<span class="badge badge-warn">Parcial</span>`;

    return `
      <tr>
        <td>${estadoViaje}</td>
        <td>${escapeHtml(p.rut || "-")}</td>
        <td>${escapeHtml(p.nombreCompleto || "-")}</td>
        <td>${escapeHtml(p.categoria || "-")}</td>
        <td>${escapeHtml(p.nombreApoderado || "-")}</td>
        <td>${escapeHtml(p.correoApoderado || "-")}</td>
        <td>${escapeHtml(p.celularApoderado || "-")}</td>
        <td>${formatoCLP(p.totalDebe)}</td>
        <td>${formatoCLP(p.totalPagado)}</td>
        <td>${formatoCLP(p.saldoPendiente)}</td>
        <td>${estadoPago}</td>
        <td>${p.ultimoPagoFecha ? `${formatearFecha(p.ultimoPagoFecha)} · ${formatoCLP(p.ultimoPagoMonto)}` : "-"}</td>
        <td>${credencial}</td>
      </tr>
    `;
  }).join("");
}

function cerrarDetalle() {
  detalleActual = null;
  els.detalleGrupoBox.classList.add("hidden");

  document.documentElement.style.overflow = "";
  document.body.style.overflow = "";
}

function exportarDetalleNomina() {
  if (!detalleActual) {
    alert("Primero debes abrir una nómina.");
    return;
  }

  const numeroNegocio = detalleActual.numeroNegocio || "";

  const grupo = gruposOriginales.find(
    (g) => String(g.numeroNegocio) === String(numeroNegocio)
  );

  const pasajerosRaw =
    detalleActual?.nominas?.data?.pasajeros ||
    detalleActual?.saldos?.data?.detalle_pasajeros ||
    [];

  const pasajeros = pasajerosRaw.map(normalizarPasajero);

  const rows = pasajeros.map((p) => ({
    numeroNegocio,
    grupo: grupo?.nombreGrupo || "",
    anoViaje: grupo?.anoViaje || "",
    destino: grupo?.destino || "",
    rut: p.rut || "",
    nombreCompleto: p.nombreCompleto || "",
    nombreApoderado: p.nombreApoderado || "",
    correoApoderado: p.correoApoderado || "",
    celularApoderado: p.celularApoderado || "",
    categoria: p.categoria || "",
    viaja: p.viaja ? "Sí" : "No",
    total: p.totalDebe,
    pagado: p.totalPagado,
    saldo: p.saldoPendiente,
    estadoPago:
      p.saldoPendiente <= 0
        ? "Pagado"
        : p.totalPagado <= 0
          ? "Sin pagos"
          : "Parcial",
    ultimoPagoFecha: p.ultimoPagoFecha || "",
    ultimoPagoMonto: p.ultimoPagoMonto || 0,
    carnet: p.tieneCredencial ? "Con carnet" : "Sin carnet"
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(wb, ws, "Nomina");

  const nombreArchivo =
    `nomina_${numeroNegocio}_${limpiarNombreArchivo(grupo?.nombreGrupo || "grupo")}.xlsx`;

  XLSX.writeFile(wb, nombreArchivo);
}

function exportarGruposPagos() {
  const rows = gruposFiltrados.map((g) => ({
    numeroNegocio: g.numeroNegocio,
    grupo: g.nombreGrupo,
    anoViaje: g.anoViaje,
    fechaSalida: g.fechaSalida,
    destino: g.destino,
    moneda: g.monedaTexto,
    totalViaje: g.totalViaje,
    totalPagado: g.totalPagado,
    saldoPendiente: g.saldoPendiente,
    porcentajePagado: g.totalViaje > 0 ? (g.totalPagado / g.totalViaje) : 0
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Dashboard Pagos");
  XLSX.writeFile(wb, `dashboard_pagos_${new Date().toISOString().slice(0,10)}.xlsx`);
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

function normalizarGrupo(g) {
  return {
    numeroNegocio: g.negocio_id,
    nombreGrupo: g.nombre_colegio || "",
    anoViaje: g.ano_viaje || "",
    fechaSalida: g.fecha_salida || "",
    destino: g.destino || "",
    moneda: Number(g.moneda || 0),
    monedaTexto: g.moneda_texto || "",
    totalViaje: numero(g.total_viaje),
    totalPagado: numero(g.total_pagado),
    saldoPendiente: numero(g.saldo_pendiente)
  };
}

function normalizarPasajero(item) {
  if (item.pasajero) {
    const p = item.pasajero;
    const s = item.situacion_pagos || {};

    return {
      rut: p.rut || "",
      nombreCompleto: `${p.nombres || ""} ${p.apellidos || ""}`.trim(),
      categoria: p.ocupacion_categoria || "",

      // Standby: cuando la API lo entregue, lo conectamos acá.
      nombreApoderado: "",

      // Estos campos sí vienen desde pagos y corresponden al contacto/apoderado.
      correoApoderado: p.email || "",
      celularApoderado: p.telefono || "",

      viaja: Number(p.viaja) === 1,
      tieneCredencial: Number(p.tiene_credencial) === 1,
      totalDebe: numero(s.monto_total),
      totalPagado: numero(s.monto_total_pagado),
      saldoPendiente: numero(s.saldo_pendiente),
      ultimoPagoFecha: s.ultimo_pago?.fecha || "",
      ultimoPagoMonto: numero(s.ultimo_pago?.monto)
    };
  }

  return {
    rut: item.rut || "",
    nombreCompleto: item.nombre_completo || "",
    categoria: "",
    nombreApoderado: "",
    correoApoderado: "",
    celularApoderado: "",
    viaja: String(item.viaja || "").toLowerCase() !== "no",
    tieneCredencial: Number(item.tiene_credencial) === 1,
    totalDebe: numero(item.total_debe),
    totalPagado: numero(item.total_pagado),
    saldoPendiente: numero(item.saldo_pendiente),
    ultimoPagoFecha: "",
    ultimoPagoMonto: 0
  };
}

function estadoGrupoPago(g) {
  if (g.totalPagado <= 0) return `<span class="badge badge-danger">Sin pagos</span>`;
  if (g.saldoPendiente <= 0) return `<span class="badge badge-ok">Pagado</span>`;
  return `<span class="badge badge-warn">Con saldo</span>`;
}

function suma(arr, campo) {
  return arr.reduce((acc, item) => acc + numero(item[campo]), 0);
}

function numero(v) {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(String(v).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function formatoCLP(v) {
  return Number(v || 0).toLocaleString("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0
  });
}

function formatoUSD(v) {
  return Number(v || 0).toLocaleString("es-CL", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  });
}

function formatoEUR(v) {
  return Number(v || 0).toLocaleString("es-CL", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0
  });
}

function formatoMoneda(v, moneda) {
  if (moneda === "USD") return formatoUSD(v);
  if (moneda === "EUR") return formatoEUR(v);
  return formatoCLP(v);
}

// En KPIs globales mezclamos monedas, por eso se muestra como monto referencial.
function formatoMontoMixto(v) {
  return Number(v || 0).toLocaleString("es-CL", {
    maximumFractionDigits: 0
  });
}

function formatearFecha(fecha) {
  if (!fecha) return "-";
  const d = new Date(`${fecha}T00:00:00`);
  if (Number.isNaN(d.getTime())) return fecha;
  return d.toLocaleDateString("es-CL");
}

function normalizarTexto(txt) {
  return String(txt || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function obtenerAnoOperativo() {
  const hoy = new Date();
  const anoActual = hoy.getFullYear();
  const mes = hoy.getMonth() + 1;
  const dia = hoy.getDate();

  if (mes < 3 || (mes === 3 && dia < 1)) {
    return anoActual - 1;
  }

  return anoActual;
}

function limpiarNombreArchivo(txt) {
  return String(txt || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
