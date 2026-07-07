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

  document.documentElement.style.overflow = "hidden";
  document.body.style.overflow = "hidden";

  els.detalleTitulo.textContent = `Cargando detalle N° ${numeroNegocio}...`;
  els.tbodyDetallePasajeros.innerHTML =
    `<tr><td colspan="15" class="seg-empty">Cargando pasajeros...</td></tr>`;

  try {
    const [data, dataGrupo] = await Promise.all([
      fetchJson(`${API_PAGOS_URL}?modo=detalle&numeroNegocio=${encodeURIComponent(numeroNegocio)}`),
      fetchJson(`${API_PAGOS_URL}?modo=grupos&numeroNegocio=${encodeURIComponent(numeroNegocio)}`)
    ]);

    const infoGrupoPagos = normalizarGrupo(dataGrupo?.grupos?.data || {});

    detalleActual = {
      ...data,
      infoGrupoPagos
    };

    const resumen = data?.saldos?.data?.resumen_grupo || {};
    const pasajeros =
      data?.nominas?.data?.pasajeros ||
      data?.saldos?.data?.detalle_pasajeros ||
      [];

    const grupo = gruposOriginales.find(
      (g) => String(g.numeroNegocio) === String(numeroNegocio)
    );

    els.detalleTitulo.textContent =
      `Detalle N° ${numeroNegocio}${grupo?.nombreGrupo ? " · " + grupo.nombreGrupo : ""}`;

    renderResumenDetalle(resumen, infoGrupoPagos);
    renderTablaDetalle(pasajeros, infoGrupoPagos);

  } catch (error) {
    console.error("Error cargando detalle:", error);
    els.tbodyDetallePasajeros.innerHTML =
      `<tr><td colspan="15" class="seg-empty">Error cargando detalle.</td></tr>`;
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

function renderResumenDetalle(resumen, infoGrupoPagos = {}) {
  const resumenCuotas = calcularResumenCuotasGrupo(infoGrupoPagos);

  els.detPasajeros.textContent = resumen.total_pasajeros ?? 0;
  els.detViajan.textContent = resumen.total_viajan ?? 0;
  els.detNoViajan.textContent = resumen.total_no_viajan ?? 0;
  els.detCredencial.textContent = resumen.con_credencial ?? 0;
  els.detSinCredencial.textContent = resumen.sin_credencial ?? 0;
  els.detPagado.textContent = formatoMoneda(resumen.monto_total_pagado || 0, infoGrupoPagos.monedaTexto);
  els.detSaldo.textContent = formatoMoneda(resumen.saldo_pendiente || 0, infoGrupoPagos.monedaTexto);

  const modalCard = els.detalleGrupoBox.querySelector(".detalle-modal-card");
  const tablaWrap = modalCard?.querySelector(".pagos-table-wrap");

  let boxCuotas = document.getElementById("detalleCuotasBox");

  if (!boxCuotas && modalCard && tablaWrap) {
    boxCuotas = document.createElement("div");
    boxCuotas.id = "detalleCuotasBox";
    boxCuotas.className = "seg-card";
    boxCuotas.style.margin = "12px 16px";
    boxCuotas.style.padding = "14px 16px";
    boxCuotas.style.border = "2px solid #d7dde6";
    boxCuotas.style.borderRadius = "12px";
    boxCuotas.style.background = "#fff";

    modalCard.insertBefore(boxCuotas, tablaWrap);
  }

  if (!boxCuotas) return;

  boxCuotas.innerHTML = `
    <div style="display:grid; grid-template-columns:repeat(4, minmax(150px, 1fr)); gap:12px;">
      <div>
        <strong>Inscripción total</strong><br>
        ${formatoMoneda(infoGrupoPagos.totalInscripcion || 0, infoGrupoPagos.monedaTexto)}
      </div>

      <div>
        <strong>Inscripciones vencidas</strong><br>
        ${escapeHtml(resumenCuotas.inscripcionesVencidas)} de ${escapeHtml(infoGrupoPagos.cantidadInscripcion || 0)}
      </div>

      <div>
        <strong>Esperado inscripción</strong><br>
        ${formatoMoneda(resumenCuotas.esperadoInscripcionHoy || 0, infoGrupoPagos.monedaTexto)}
      </div>

      <div>
        <strong>Valor cuota</strong><br>
        ${formatoMoneda(infoGrupoPagos.valorCuota || 0, infoGrupoPagos.monedaTexto)}
      </div>

      <div>
        <strong>Cuotas vencidas</strong><br>
        ${escapeHtml(resumenCuotas.cuotasVencidas)} de ${escapeHtml(infoGrupoPagos.cantidadCuotas || 0)}
      </div>

      <div>
        <strong>Esperado cuotas</strong><br>
        ${formatoMoneda(resumenCuotas.esperadoCuotasHoy || 0, infoGrupoPagos.monedaTexto)}
      </div>

      <div>
        <strong>Esperado hoy</strong><br>
        ${formatoMoneda(resumenCuotas.esperadoHoy || 0, infoGrupoPagos.monedaTexto)}
      </div>

      <div>
        <strong>Estado grupo</strong><br>
        ${infoGrupoPagos.bloqueado ? "Bloqueado" : "No bloqueado"} ·
        ${infoGrupoPagos.cerrado ? "Cerrado" : "Abierto"}
      </div>

      <div>
        <strong>Inicio inscripción</strong><br>
        ${formatearFecha(infoGrupoPagos.inicioPagoInscripcion)}
      </div>

      <div>
        <strong>Término inscripción</strong><br>
        ${formatearFecha(infoGrupoPagos.terminoPagoInscripcion)}
      </div>

      <div>
        <strong>Inicio cuotas</strong><br>
        ${formatearFecha(infoGrupoPagos.inicioPagoCuotas)}
      </div>

      <div>
        <strong>Término cuotas</strong><br>
        ${formatearFecha(infoGrupoPagos.terminoPagoCuotas)}
      </div>
    </div>
  `;
}

function renderTablaDetalle(items, infoGrupoPagos = {}) {
  if (!items.length) {
    els.tbodyDetallePasajeros.innerHTML =
      `<tr><td colspan="15" class="seg-empty">No hay pasajeros para mostrar.</td></tr>`;
    return;
  }

  const pasajeros = items.map((item) => {
    const p = normalizarPasajero(item);
    const estadoCuotas = calcularEstadoCuotasPasajero(p, infoGrupoPagos);

    return {
      ...p,
      ...estadoCuotas
    };
  });

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
        <td>${formatoMoneda(p.totalDebe, infoGrupoPagos.monedaTexto)}</td>
        <td>${formatoMoneda(p.totalPagado, infoGrupoPagos.monedaTexto)}</td>
        <td>${formatoMoneda(p.saldoPendiente, infoGrupoPagos.monedaTexto)}</td>
        <td>${formatoMoneda(p.esperadoHoy, infoGrupoPagos.monedaTexto)}</td>
        <td>${Number(p.cuotasAtrasadas || 0).toFixed(1)}</td>
        <td>${estadoPago}</td>
        <td>${p.ultimoPagoFecha ? `${formatearFecha(p.ultimoPagoFecha)} · ${formatoMoneda(p.ultimoPagoMonto, infoGrupoPagos.monedaTexto)}` : "-"}</td>
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

  const infoGrupoPagos = detalleActual.infoGrupoPagos || {};
  const resumenCuotas = calcularResumenCuotasGrupo(infoGrupoPagos);

  const pasajerosRaw =
    detalleActual?.nominas?.data?.pasajeros ||
    detalleActual?.saldos?.data?.detalle_pasajeros ||
    [];

  const pasajeros = pasajerosRaw.map((item) => {
    const p = normalizarPasajero(item);
    return {
      ...p,
      ...calcularEstadoCuotasPasajero(p, infoGrupoPagos)
    };
  });

  const rows = pasajeros.map((p) => ({
    numeroNegocio,
    grupo: grupo?.nombreGrupo || "",
    anoViaje: grupo?.anoViaje || "",
    destino: grupo?.destino || "",
    moneda: infoGrupoPagos.monedaTexto || grupo?.monedaTexto || "",
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

    totalInscripcion: infoGrupoPagos.totalInscripcion || 0,
    cantidadInscripcion: infoGrupoPagos.cantidadInscripcion || 0,
    valorInscripcionUnitario: infoGrupoPagos.valorInscripcionUnitario || 0,
    inscripcionesVencidas: resumenCuotas.inscripcionesVencidas || 0,
    esperadoInscripcionHoy: p.esperadoInscripcionHoy || 0,

    valorCuota: infoGrupoPagos.valorCuota || 0,
    cantidadCuotas: infoGrupoPagos.cantidadCuotas || 0,
    cuotasVencidas: p.cuotasVencidas || 0,
    esperadoCuotasHoy: p.esperadoCuotasHoy || 0,

    esperadoHoy: p.esperadoHoy || 0,
    cuotasPagadasEstimadas: p.cuotasPagadasEstimadas || 0,
    cuotasAtrasadas: p.cuotasAtrasadas || 0,

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
    valorInscripcion: g.valorInscripcion,
    valorCuota: g.valorCuota,
    cantidadCuotas: g.cantidadCuotas,
    totalCuotas: g.totalCuotas,
    inicioPagoCuotas: g.inicioPagoCuotas,
    terminoPagoCuotas: g.terminoPagoCuotas,
    totalCuotasApi: g.totalCuotasApi,
    pagoOnlineActivo: g.pagoOnlineActivo,
    cerrado: g.cerrado,
    bloqueado: g.bloqueado,
    incluyePoleron: g.incluyePoleron,
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
  const detalleCuotas = Array.isArray(g.detalle_cuotas) ? g.detalle_cuotas : [];

  const inscripciones = detalleCuotas.filter(c =>
    normalizarTexto(c.tipo_cuota || "") === "inscripcion"
  );

  const cuotas = detalleCuotas.filter(c =>
    normalizarTexto(c.tipo_cuota || "") === "cuota"
  );

  const totalInscripcion = inscripciones.reduce((acc, c) => acc + numero(c.total), 0);
  const cantidadInscripcion = inscripciones.reduce((acc, c) => acc + Number(c.cantidad || 0), 0);
  const valorInscripcionUnitario =
    cantidadInscripcion > 0 ? totalInscripcion / cantidadInscripcion : 0;

  const totalCuotas = cuotas.reduce((acc, c) => acc + numero(c.total), 0);
  const cantidadCuotas = cuotas.reduce((acc, c) => acc + Number(c.cantidad || 0), 0);
  const valorCuota = cantidadCuotas > 0 ? totalCuotas / cantidadCuotas : 0;

  const primeraInscripcion = inscripciones[0] || null;
  const ultimaInscripcion = inscripciones[inscripciones.length - 1] || primeraInscripcion;

  const primeraCuota = cuotas[0] || null;
  const ultimaCuota = cuotas[cuotas.length - 1] || primeraCuota;

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
    saldoPendiente: numero(g.saldo_pendiente),

    detalleCuotas,

    totalInscripcion,
    cantidadInscripcion,
    valorInscripcionUnitario,
    inicioPagoInscripcion: primeraInscripcion?.inicio_pago || "",
    terminoPagoInscripcion: ultimaInscripcion?.termino_pago || primeraInscripcion?.termino_pago || "",

    valorInscripcion: totalInscripcion,

    totalCuotas,
    cantidadCuotas,
    valorCuota,
    inicioPagoCuotas: primeraCuota?.inicio_pago || "",
    terminoPagoCuotas: ultimaCuota?.termino_pago || primeraCuota?.termino_pago || "",

    totalCuotasApi: numero(g.total_cuotas),
    pagoOnlineActivo: Number(g.pago_online_activo || 0),
    cerrado: Number(g.cerrado || 0),
    bloqueado: Number(g.bloqueado || 0),
    incluyePoleron: Number(g.incluye_poleron || 0)
  };
}

function fechaLocal(fecha) {
  if (!fecha) return null;

  const d = new Date(`${fecha}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function contarVencimientosPorMes(cantidad = 0, inicioPago = "", terminoPago = "") {
  const cantidadNum = Number(cantidad || 0);
  const inicio = fechaLocal(inicioPago);
  const termino = fechaLocal(terminoPago);

  if (!cantidadNum || !inicio) return 0;

  const hoy = new Date();

  if (hoy < inicio) return 0;

  if (cantidadNum === 1) {
    return 1;
  }

  // Caso típico doble inscripción:
  // cantidad 2, inicio 23-12, término 30-01.
  // Se consideran vencidas según esas dos fechas reales.
  if (cantidadNum === 2 && termino) {
    let vencidas = 0;
    if (hoy >= inicio) vencidas++;
    if (hoy >= termino) vencidas++;
    return Math.min(vencidas, cantidadNum);
  }

  let vencidas =
    (hoy.getFullYear() - inicio.getFullYear()) * 12 +
    (hoy.getMonth() - inicio.getMonth()) +
    1;

  if (hoy.getDate() < inicio.getDate()) {
    vencidas -= 1;
  }

  return Math.max(0, Math.min(vencidas, cantidadNum));
}

function calcularResumenCuotasGrupo(infoGrupoPagos = {}) {
  const inscripcionesVencidas = contarVencimientosPorMes(
    infoGrupoPagos.cantidadInscripcion,
    infoGrupoPagos.inicioPagoInscripcion,
    infoGrupoPagos.terminoPagoInscripcion
  );

  const cuotasVencidas = contarVencimientosPorMes(
    infoGrupoPagos.cantidadCuotas,
    infoGrupoPagos.inicioPagoCuotas,
    infoGrupoPagos.terminoPagoCuotas
  );

  const esperadoInscripcionHoy =
    inscripcionesVencidas * Number(infoGrupoPagos.valorInscripcionUnitario || 0);

  const esperadoCuotasHoy =
    cuotasVencidas * Number(infoGrupoPagos.valorCuota || 0);

  const esperadoHoy = esperadoInscripcionHoy + esperadoCuotasHoy;

  return {
    inscripcionesVencidas,
    cuotasVencidas,
    esperadoInscripcionHoy,
    esperadoCuotasHoy,
    esperadoHoy
  };
}

function calcularEstadoCuotasPasajero(p = {}, infoGrupoPagos = {}) {
  const resumen = calcularResumenCuotasGrupo(infoGrupoPagos);

  const totalPagado = Number(p.totalPagado || 0);
  const valorCuota = Number(infoGrupoPagos.valorCuota || 0);

  const pagoAplicadoACuotas = Math.max(
    0,
    totalPagado - resumen.esperadoInscripcionHoy
  );

  const cuotasPagadasEstimadas =
    valorCuota > 0 ? pagoAplicadoACuotas / valorCuota : 0;

  const cuotasAtrasadas = Math.max(
    0,
    resumen.cuotasVencidas - cuotasPagadasEstimadas
  );

  return {
    ...resumen,
    pagoAplicadoACuotas,
    cuotasPagadasEstimadas,
    cuotasAtrasadas
  };
}

function calcularEsperadoHoy(infoGrupoPagos = {}) {
  return calcularResumenCuotasGrupo(infoGrupoPagos).esperadoHoy;
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

window.buscarCorreosEnPagos = async function (correos = []) {
  const buscados = new Set(
    (Array.isArray(correos) ? correos : String(correos).split(/[,\n;]/))
      .map(c => normalizarTexto(c))
      .filter(Boolean)
  );

  if (!buscados.size) {
    console.warn("Debes ingresar uno o más correos.");
    return [];
  }

  const resultados = [];

  const grupos = gruposOriginales.length
    ? gruposOriginales
    : (await fetchJson(`${API_PAGOS_URL}?modo=grupos`))?.grupos?.data?.map(normalizarGrupo) || [];

  let revisados = 0;

  for (const grupo of grupos) {
    revisados++;
    console.log(`🔎 ${revisados}/${grupos.length} revisando N° ${grupo.numeroNegocio} · ${grupo.nombreGrupo || ""}`);
    try {
      const data = await fetchJson(
        `${API_PAGOS_URL}?modo=detalle&numeroNegocio=${encodeURIComponent(grupo.numeroNegocio)}`
      );

      const pasajerosRaw =
        data?.nominas?.data?.pasajeros ||
        data?.saldos?.data?.detalle_pasajeros ||
        [];

      const pasajeros = pasajerosRaw.map(normalizarPasajero);

      pasajeros.forEach((p) => {
        const correo = normalizarTexto(p.correoApoderado || "");

        if (!correo || !buscados.has(correo)) return;

        resultados.push({
          correo: p.correoApoderado,
          pasajero: p.nombreCompleto,
          rut: p.rut,
          categoria: p.categoria,
          viaja: p.viaja ? "Sí" : "No",
          grupo: grupo.nombreGrupo,
          numeroNegocio: grupo.numeroNegocio,
          anoViaje: grupo.anoViaje,
          destino: grupo.destino,
          saldoPendiente: p.saldoPendiente
        });
      });

    } catch (error) {
      console.warn(`No pude revisar grupo ${grupo.numeroNegocio}`, error);
    }
  }

  console.table(resultados);
  return resultados;
};
