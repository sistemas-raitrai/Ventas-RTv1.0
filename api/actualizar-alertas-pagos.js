import admin from "firebase-admin";

const BASE_API_PAGOS = "https://pagos.turismoraitrai.cl/agencia/api";

const ALERTAS_PAGOS_COLLECTION = "ventas_alertas_pagos";
const ALERTAS_PAGOS_HISTORIAL_COLLECTION = "ventas_alertas_pagos_historial";

function initFirebaseAdmin() {
  if (admin.apps.length) return;

  const serviceAccountBase64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;

  if (!serviceAccountBase64) {
    throw new Error("Falta FIREBASE_SERVICE_ACCOUNT_BASE64");
  }

  const serviceAccount = JSON.parse(
    Buffer.from(serviceAccountBase64, "base64").toString("utf8")
  );

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

function normalizeLoose(value = "") {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function numeroPago(v) {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(String(v).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function normalizarMonedaPago(valor = "") {
  const m = normalizeLoose(valor);

  if (m.includes("peso") || m === "clp") return "CLP";
  if (m.includes("dolar") || m.includes("dólar") || m === "usd") return "USD";
  if (m.includes("euro") || m === "eur") return "EUR";

  return String(valor || "").trim().toUpperCase();
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

  if (cantidadNum === 1) return 1;

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

function normalizarGrupoPagos(g = {}) {
  const detalleCuotas = Array.isArray(g.detalle_cuotas) ? g.detalle_cuotas : [];

  const inscripciones = detalleCuotas.filter(c =>
    normalizeLoose(c.tipo_cuota || "") === "inscripcion"
  );

  const cuotas = detalleCuotas.filter(c =>
    normalizeLoose(c.tipo_cuota || "") === "cuota"
  );

  const totalInscripcion = inscripciones.reduce((acc, c) => acc + numeroPago(c.total), 0);
  const cantidadInscripcion = inscripciones.reduce((acc, c) => acc + Number(c.cantidad || 0), 0);
  const valorInscripcionUnitario =
    cantidadInscripcion > 0 ? totalInscripcion / cantidadInscripcion : 0;

  const totalCuotas = cuotas.reduce((acc, c) => acc + numeroPago(c.total), 0);
  const cantidadCuotas = cuotas.reduce((acc, c) => acc + Number(c.cantidad || 0), 0);
  const valorCuota = cantidadCuotas > 0 ? totalCuotas / cantidadCuotas : 0;

  const inscripcion = inscripciones[0] || {};
  const cuota = cuotas[0] || {};

  const inscripcionesVencidas = contarVencimientosPorMes(
    cantidadInscripcion,
    inscripcion.inicio_pago,
    inscripcion.termino_pago
  );

  const cuotasVencidas = contarVencimientosPorMes(
    cantidadCuotas,
    cuota.inicio_pago,
    cuota.termino_pago
  );

  const esperadoInscripcionHoy = inscripcionesVencidas * valorInscripcionUnitario;
  const esperadoCuotasHoy = cuotasVencidas * valorCuota;
  const montoEsperadoHoy = esperadoInscripcionHoy + esperadoCuotasHoy;

  return {
    numeroNegocio: String(g.negocio_id || "").trim(),
    nombreGrupo: String(g.nombre_colegio || "").trim(),
    anoViaje: String(g.ano_viaje || "").trim(),
    fechaSalida: String(g.fecha_salida || "").trim(),
    destino: String(g.destino || "").trim(),
    monedaTexto: normalizarMonedaPago(g.moneda_texto),
    totalViaje: numeroPago(g.total_viaje),
    totalPagado: numeroPago(g.total_pagado),
    saldoPendiente: numeroPago(g.saldo_pendiente),

    detalleCuotas,
    totalInscripcion,
    cantidadInscripcion,
    valorInscripcionUnitario,
    inscripcionesVencidas,
    esperadoInscripcionHoy,

    totalCuotas,
    cantidadCuotas,
    valorCuota,
    cuotasVencidas,
    esperadoCuotasHoy,
    montoEsperadoHoy,

    inicioPagoInscripcion: inscripcion.inicio_pago || "",
    terminoPagoInscripcion: inscripcion.termino_pago || "",
    inicioPagoCuotas: cuota.inicio_pago || "",
    terminoPagoCuotas: cuota.termino_pago || "",

    totalCuotasApi: numeroPago(g.total_cuotas),
    pagoOnlineActivo: Number(g.pago_online_activo || 0),
    cerrado: Number(g.cerrado || 0),
    bloqueado: Number(g.bloqueado || 0),
    incluyePoleron: Number(g.incluye_poleron || 0)
  };
}

function normalizarPasajeroPagos(item = {}) {
  if (item.pasajero) {
    const p = item.pasajero || {};
    const s = item.situacion_pagos || {};

    return {
      rut: String(p.rut || "").trim(),
      nombreCompleto: `${p.nombres || ""} ${p.apellidos || ""}`.trim(),
      categoria: String(p.ocupacion_categoria || "").trim(),
      responsable: String(p.nombre_apoderado || p.apoderado || "").trim(),
      correoResponsable: String(p.email || "").trim(),
      telefonoResponsable: String(p.telefono || "").trim(),
      viaja: Number(p.viaja) === 1,
      totalDebe: numeroPago(s.monto_total),
      totalPagado: numeroPago(s.monto_total_pagado),
      saldoPendiente: numeroPago(s.saldo_pendiente),
      ultimoPagoFecha: s.ultimo_pago?.fecha || "",
      ultimoPagoMonto: numeroPago(s.ultimo_pago?.monto)
    };
  }

  return {
    rut: String(item.rut || "").trim(),
    nombreCompleto: String(item.nombre_completo || "").trim(),
    categoria: "",
    responsable: String(item.nombre_apoderado || item.apoderado || "").trim(),
    correoResponsable: String(item.email || item.correo || "").trim(),
    telefonoResponsable: String(item.telefono || item.celular || "").trim(),
    viaja: String(item.viaja || "").toLowerCase() !== "no",
    totalDebe: numeroPago(item.total_debe),
    totalPagado: numeroPago(item.total_pagado),
    saldoPendiente: numeroPago(item.saldo_pendiente),
    ultimoPagoFecha: item.ultimo_pago_fecha || "",
    ultimoPagoMonto: numeroPago(item.ultimo_pago_monto)
  };
}

function calcularEstadoCuotasPasajero(p = {}, grupo = {}) {
  const totalPagado = Number(p.totalPagado || 0);
  const valorCuota = Number(grupo.valorCuota || 0);

  const pagoAplicadoACuotas = Math.max(
    0,
    totalPagado - grupo.esperadoInscripcionHoy
  );

  const cuotasPagadasEstimadas =
    valorCuota > 0 ? pagoAplicadoACuotas / valorCuota : 0;

  const cuotasCubiertas = Math.floor(cuotasPagadasEstimadas);

  const cuotasAtrasadas = Math.max(
    0,
    grupo.cuotasVencidas - cuotasCubiertas
  );

  return {
    cuotasPagadasEstimadas,
    cuotasCubiertas,
    cuotasAtrasadas
  };
}

function getTiposAlertaPersonaPago(p = {}, grupo = {}) {
  if (!p.viaja) return [];
  if (p.saldoPendiente <= 0) return [];

  const moneda = String(grupo.monedaTexto || "").toUpperCase();
  const alertas = [];

  const estadoCuotas = calcularEstadoCuotasPasajero(p, grupo);
  const cuotasAtrasadas = estadoCuotas.cuotasAtrasadas;

  const limitePagoBajo =
    moneda === "USD" || moneda === "EUR"
      ? 550
      : moneda === "CLP"
        ? 550000
        : null;

  if (p.totalPagado <= 0 || p.totalPagado < grupo.esperadoInscripcionHoy) {
    alertas.push({
      tipo: "persona_sin_pagos_o_sin_inscripcion",
      nivel: "critica",
      label: p.totalPagado <= 0 ? "Nunca pagó" : "Pagó menos que la inscripción vencida",
      gravedad: 5,
      cuotasAtrasadas
    });
  }

  if (limitePagoBajo !== null && p.totalPagado > 0 && p.totalPagado < limitePagoBajo) {
    alertas.push({
      tipo: "persona_pago_bajo",
      nivel: "critica",
      label: moneda === "CLP"
        ? "Pagó menos de $550.000 CLP"
        : `Pagó menos de 550 ${moneda}`,
      gravedad: 4,
      cuotasAtrasadas
    });
  }

  if (cuotasAtrasadas === 1) {
    alertas.push({
      tipo: "persona_atrasada_1_cuota",
      nivel: "warning",
      label: "Atrasado 1 cuota",
      gravedad: 3,
      cuotasAtrasadas
    });
  }

  if (cuotasAtrasadas >= 2) {
    alertas.push({
      tipo: "persona_atrasada_2_mas_cuotas",
      nivel: "critica",
      label: `Atrasado ${cuotasAtrasadas} cuotas`,
      gravedad: 5,
      cuotasAtrasadas
    });
  }

  const porcentajeDeuda = p.totalDebe > 0 ? (p.saldoPendiente / p.totalDebe) * 100 : 0;

  if (porcentajeDeuda > 50) {
    alertas.push({
      tipo: "persona_muy_atrasada_50",
      nivel: "critica",
      label: "Muy atrasado: deuda mayor al 50%",
      gravedad: 5,
      cuotasAtrasadas,
      porcentajeDeuda
    });
  }

  return alertas;
}

function calcularPrioridadPersona(tipoInfo, grupoInfo = {}) {
  const porcentajeGrupoDebe = Number(grupoInfo.porcentajeDebe || 0);
  const avanceGrupo = Math.max(0, 100 - porcentajeGrupoDebe);

  return Math.round(
    Number(tipoInfo.gravedad || 1) * 1000 +
    avanceGrupo * 10 -
    porcentajeGrupoDebe
  );
}

function calcularPrioridadGrupo(tipoInfo, grupo = {}) {
  const saldo = Number(grupo.saldoPendiente || 0);

  return Math.round(
    Number(tipoInfo.gravedad || 1) * 1000 -
    Math.min(saldo / 100, 999)
  );
}

async function pedirJson(url) {
  const token = process.env.TOKEN_API_PAGOS;

  const r = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    }
  });

  const txt = await r.text();

  if (!r.ok) {
    throw new Error(`Error API pagos ${r.status}: ${txt.slice(0, 300)}`);
  }

  return JSON.parse(txt);
}

function getRowId(row = {}) {
  return String(row.idGrupo || row.id || "").trim();
}

function getNumeroNegocio(row = {}) {
  return String(row.numeroNegocio || row?.ficha?.numeroNegocio || "").trim();
}

function getRowAlias(row = {}) {
  return String(
    row.aliasGrupo ||
    row.nombreGrupo ||
    row.colegio ||
    row.idGrupo ||
    row.id ||
    "Sin alias"
  ).trim();
}

function getRowVendorName(row = {}) {
  return String(row.vendedora || "").trim();
}

function normalizeEmail(value = "") {
  return String(value || "").trim().toLowerCase();
}

function getAnoViajeNumber(row = {}) {
  const raw = String(row.anoViaje ?? "").trim();
  const match = raw.match(/\d{4}/);
  if (!match) return null;

  const year = Number(match[0]);
  return Number.isFinite(year) ? year : null;
}

function diasDesdeFechaPago(fecha) {
  const d = fechaLocal(fecha);
  if (!d) return null;

  const now = new Date();
  const diff = now.getTime() - d.getTime();

  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

function debeProcesarGrupo(grupo, filtros = {}) {
  if (!grupo.numeroNegocio) return false;

  if (filtros.numeroNegocio && String(grupo.numeroNegocio) !== String(filtros.numeroNegocio)) {
    return false;
  }

  if (filtros.anoViaje && String(grupo.anoViaje) !== String(filtros.anoViaje)) {
    return false;
  }

  if (filtros.destino && normalizeLoose(grupo.destino) !== normalizeLoose(filtros.destino)) {
    return false;
  }

  return true;
}

export default async function handler(req, res) {
  try {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

    initFirebaseAdmin();

    const db = admin.firestore();

    const filtros = {
      anoViaje: String(req.query.anoViaje || "").trim(),
      destino: String(req.query.destino || "").trim(),
      numeroNegocio: String(req.query.numeroNegocio || "").trim(),
      origen: String(req.query.origen || "manual").trim()
    };

    const dataGrupos = await pedirJson(`${BASE_API_PAGOS}/api_colegios.php?t=${Date.now()}`);
    const gruposLista = (dataGrupos?.data || []).map(normalizarGrupoPagos);

    const gruposFiltrados = gruposLista.filter((g) => debeProcesarGrupo(g, filtros));

    const cotizacionesSnap = await db.collection("ventas_cotizaciones").get();
    const gruposRt = cotizacionesSnap.docs.map((d) => ({
      id: d.id,
      idGrupo: d.id,
      ...d.data()
    }));

    const gruposRtPorNumero = new Map(
      gruposRt
        .map((row) => [getNumeroNegocio(row), row])
        .filter(([numero]) => numero)
    );

    const alertas = [];

    for (let i = 0; i < gruposFiltrados.length; i++) {
      const grupoBase = gruposFiltrados[i];

      const dataGrupoUno = await pedirJson(
        `${BASE_API_PAGOS}/api_colegios.php?negocio_id=${encodeURIComponent(grupoBase.numeroNegocio)}&t=${Date.now()}`
      );

      const grupoPago = normalizarGrupoPagos(dataGrupoUno?.data || grupoBase);

      const detalle = await Promise.all([
        pedirJson(`${BASE_API_PAGOS}/api_nominas.php?negocio_id=${encodeURIComponent(grupoPago.numeroNegocio)}&t=${Date.now()}`),
        pedirJson(`${BASE_API_PAGOS}/api_saldos.php?negocio_id=${encodeURIComponent(grupoPago.numeroNegocio)}&t=${Date.now()}`)
      ]);

      const nominas = detalle[0];
      const saldos = detalle[1];

      const pasajerosRaw =
        nominas?.data?.pasajeros ||
        saldos?.data?.detalle_pasajeros ||
        [];

      const pasajeros = pasajerosRaw.map(normalizarPasajeroPagos);

      const grupoRt = gruposRtPorNumero.get(String(grupoPago.numeroNegocio)) || {
        idGrupo: "",
        id: "",
        numeroNegocio: grupoPago.numeroNegocio,
        nombreGrupo: grupoPago.nombreGrupo,
        colegio: grupoPago.nombreGrupo,
        anoViaje: grupoPago.anoViaje,
        destino: grupoPago.destino,
        vendedora: "Sin vendedor",
        vendedoraCorreo: ""
      };

      const viajan = pasajeros.filter((p) => p.viaja);
      const conDeuda = viajan.filter((p) => p.saldoPendiente > 0);

      const totalPagadoGrupoCalculado = viajan.reduce((acc, p) => acc + Number(p.totalPagado || 0), 0);
      const saldoPendienteGrupoCalculado = viajan.reduce((acc, p) => acc + Number(p.saldoPendiente || 0), 0);

      const porcentajeGrupoDebe =
        viajan.length > 0 ? (conDeuda.length / viajan.length) * 100 : 0;

      const viajanConAtraso = viajan.map((p) => ({
        ...p,
        ...calcularEstadoCuotasPasajero(p, grupoPago)
      }));

      const atrasados = viajanConAtraso.filter((p) => p.cuotasAtrasadas >= 1);
      const atrasados2Mas = viajanConAtraso.filter((p) => p.cuotasAtrasadas >= 2);

      const porcentajeSaldoPendiente =
        grupoPago.totalViaje > 0
          ? (saldoPendienteGrupoCalculado / grupoPago.totalViaje) * 100
          : 0;

      const porcentajeGrupoAtrasado =
        viajan.length > 0 ? (atrasados.length / viajan.length) * 100 : 0;

      const pasajerosConDeudaGrupo = viajanConAtraso
        .filter((p) => p.saldoPendiente > 0)
        .sort((a, b) => Number(b.cuotasAtrasadas || 0) - Number(a.cuotasAtrasadas || 0))
        .map((p) => ({
          rut: p.rut || "",
          participante: p.nombreCompleto || "",
          responsable: p.responsable || "",
          correoResponsable: p.correoResponsable || "",
          telefonoResponsable: p.telefonoResponsable || "",
          totalDebe: p.totalDebe || 0,
          totalPagado: p.totalPagado || 0,
          saldoPendiente: p.saldoPendiente || 0,
          ultimoPagoFecha: p.ultimoPagoFecha || "",
          diasUltimoPago: diasDesdeFechaPago(p.ultimoPagoFecha),
          cuotasAtrasadas: p.cuotasAtrasadas || 0,
          cuotasCubiertas: p.cuotasCubiertas || 0,
          montoEsperadoHoy: grupoPago.montoEsperadoHoy || 0,
          valorCuota: grupoPago.valorCuota || 0,
          totalInscripcion: grupoPago.totalInscripcion || 0
        }));

      const alertasGrupo = [];

      if (saldoPendienteGrupoCalculado > 0 && porcentajeSaldoPendiente > 50) {
        alertasGrupo.push({
          tipo: "grupo_debe_mas_50",
          nivel: "critica",
          label: "Grupo debe más del 50% del total",
          gravedad: 5
        });
      }

      if (atrasados2Mas.length >= 10) {
        alertasGrupo.push({
          tipo: "grupo_10_mas_atrasados_2_cuotas",
          nivel: "critica",
          label: "10+ personas con 2+ cuotas atrasadas",
          gravedad: 5
        });
      }

      if (atrasados.length > 0) {
        alertasGrupo.push({
          tipo: "grupo_no_va_al_dia",
          nivel: "warning",
          label: "Grupo no va al día",
          gravedad: 3
        });
      }

      for (const grupoAlertaInfo of alertasGrupo) {
        const id = `grupo_${grupoPago.numeroNegocio}_${grupoAlertaInfo.tipo}`;

        alertas.push({
          id,
          categoriaAlerta: "grupo",
          tipo: grupoAlertaInfo.tipo,
          label: grupoAlertaInfo.label,
          nivel: grupoAlertaInfo.nivel,
          activa: true,
          prioridad: calcularPrioridadGrupo(grupoAlertaInfo, grupoPago),

          numeroNegocio: grupoPago.numeroNegocio,
          idGrupo: getRowId(grupoRt),
          grupo: getRowAlias(grupoRt),
          anoViaje: String(grupoPago.anoViaje || getAnoViajeNumber(grupoRt) || ""),
          destino: grupoPago.destino || grupoRt.destino || grupoRt.destinoPrincipal || "",
          moneda: grupoPago.monedaTexto,
          vendedor: getRowVendorName(grupoRt) || grupoRt.vendedoraCorreo || "",
          vendedoraCorreo: normalizeEmail(grupoRt.vendedoraCorreo || ""),

          porcentajeGrupoDebe,
          porcentajeSaldoPendiente,
          porcentajeGrupoAtrasado,
          totalViajan: viajan.length,
          totalConDeuda: conDeuda.length,
          totalAtrasados: atrasados.length,
          totalAtrasados2Mas: atrasados2Mas.length,

          totalPagadoGrupo: totalPagadoGrupoCalculado || grupoPago.totalPagado || 0,
          saldoPendienteGrupo: saldoPendienteGrupoCalculado || grupoPago.saldoPendiente || 0,
          totalViajeGrupo: grupoPago.totalViaje,

          totalInscripcion: grupoPago.totalInscripcion,
          cantidadInscripcion: grupoPago.cantidadInscripcion,
          inscripcionesVencidas: grupoPago.inscripcionesVencidas,
          esperadoInscripcionHoy: grupoPago.esperadoInscripcionHoy,
          valorCuota: grupoPago.valorCuota,
          cantidadCuotas: grupoPago.cantidadCuotas,
          cuotasVencidas: grupoPago.cuotasVencidas,
          esperadoCuotasHoy: grupoPago.esperadoCuotasHoy,
          montoEsperadoHoy: grupoPago.montoEsperadoHoy,

          pasajerosConDeudaGrupo,
          actualizadoAt: new Date().toISOString()
        });
      }

      for (const p of pasajeros) {
        const tiposInfo = getTiposAlertaPersonaPago(p, grupoPago);
        if (!tiposInfo.length) continue;

        const estadoCuotas = calcularEstadoCuotasPasajero(p, grupoPago);

        const rutKey = String(p.rut || p.nombreCompleto || "")
          .replace(/[^a-zA-Z0-9]/g, "_")
          .slice(0, 80);

        for (const tipoInfo of tiposInfo) {
          const id = `persona_${grupoPago.numeroNegocio}_${rutKey}_${tipoInfo.tipo}`;

          alertas.push({
            id,
            categoriaAlerta: "persona",
            tipo: tipoInfo.tipo,
            label: tipoInfo.label,
            nivel: tipoInfo.nivel,
            activa: true,
            prioridad: calcularPrioridadPersona(tipoInfo, { porcentajeDebe: porcentajeGrupoDebe }),

            numeroNegocio: grupoPago.numeroNegocio,
            idGrupo: getRowId(grupoRt),
            grupo: getRowAlias(grupoRt),
            anoViaje: String(grupoPago.anoViaje || getAnoViajeNumber(grupoRt) || ""),
            destino: grupoPago.destino || grupoRt.destino || grupoRt.destinoPrincipal || "",
            moneda: grupoPago.monedaTexto,
            vendedor: getRowVendorName(grupoRt) || grupoRt.vendedoraCorreo || "",
            vendedoraCorreo: normalizeEmail(grupoRt.vendedoraCorreo || ""),

            rut: p.rut,
            participante: p.nombreCompleto,
            categoria: p.categoria,
            responsable: p.responsable,
            correoResponsable: p.correoResponsable,
            telefonoResponsable: p.telefonoResponsable,
            totalDebe: p.totalDebe,
            totalPagado: p.totalPagado,
            saldoPendiente: p.saldoPendiente,
            ultimoPagoFecha: p.ultimoPagoFecha,
            ultimoPagoMonto: p.ultimoPagoMonto,

            totalInscripcion: grupoPago.totalInscripcion,
            cantidadInscripcion: grupoPago.cantidadInscripcion,
            inscripcionesVencidas: grupoPago.inscripcionesVencidas,
            esperadoInscripcionHoy: grupoPago.esperadoInscripcionHoy,
            valorCuota: grupoPago.valorCuota,
            cantidadCuotas: grupoPago.cantidadCuotas,
            cuotasVencidas: grupoPago.cuotasVencidas,
            cuotasCubiertas: estadoCuotas.cuotasCubiertas,
            cuotasAtrasadas: estadoCuotas.cuotasAtrasadas,
            esperadoCuotasHoy: grupoPago.esperadoCuotasHoy,
            montoEsperadoHoy: grupoPago.montoEsperadoHoy,
            porcentajeDeuda: tipoInfo.porcentajeDeuda || 0,

            porcentajeGrupoDebe,
            actualizadoAt: new Date().toISOString()
          });
        }
      }
    }

    const snapActuales = await db.collection(ALERTAS_PAGOS_COLLECTION).get();
    const actuales = snapActuales.docs.map((d) => ({
      id: d.id,
      ...d.data()
    }));

    const idsNuevas = new Set(alertas.map((a) => String(a.id)));

    const batch = db.batch();
    let operaciones = 0;

    for (const anterior of actuales) {
      const coincideFiltro =
        (!filtros.anoViaje || String(anterior.anoViaje || "") === filtros.anoViaje) &&
        (!filtros.destino || normalizeLoose(anterior.destino || "") === normalizeLoose(filtros.destino)) &&
        (!filtros.numeroNegocio || String(anterior.numeroNegocio || "") === filtros.numeroNegocio);

      if (coincideFiltro && !idsNuevas.has(String(anterior.id))) {
        batch.set(
          db.collection(ALERTAS_PAGOS_COLLECTION).doc(anterior.id),
          {
            activa: false,
            actualizadoAt: new Date().toISOString()
          },
          { merge: true }
        );
        operaciones++;
      }
    }

    for (const alerta of alertas) {
      const anterior = actuales.find((a) => String(a.id) === String(alerta.id));

      batch.set(
        db.collection(ALERTAS_PAGOS_COLLECTION).doc(alerta.id),
        {
          ...alerta,
          contactado: anterior?.contactado === true,
          contactadoAt: anterior?.contactadoAt || null,
          contactadoPor: anterior?.contactadoPor || "",
          contactadoPorCorreo: anterior?.contactadoPorCorreo || "",
          notaContacto: anterior?.notaContacto || ""
        },
        { merge: true }
      );
      operaciones++;
    }

    if (operaciones > 0) {
      await batch.commit();
    }

    await db.collection(ALERTAS_PAGOS_HISTORIAL_COLLECTION).add({
      tipo: "actualizacion_alertas_pagos_backend",
      fecha: admin.firestore.FieldValue.serverTimestamp(),
      origen: filtros.origen,
      filtros,
      totalGruposProcesados: gruposFiltrados.length,
      totalAlertas: alertas.length,
      totalPersonas: alertas.filter((a) => a.categoriaAlerta === "persona").length,
      totalGrupos: alertas.filter((a) => a.categoriaAlerta === "grupo").length
    });

    return res.status(200).json({
      ok: true,
      filtros,
      totalGruposProcesados: gruposFiltrados.length,
      totalAlertas: alertas.length,
      totalPersonas: alertas.filter((a) => a.categoriaAlerta === "persona").length,
      totalGrupos: alertas.filter((a) => a.categoriaAlerta === "grupo").length
    });

  } catch (error) {
    console.error("Error actualizar-alertas-pagos:", error);

    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
}
