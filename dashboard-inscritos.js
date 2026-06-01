// dashboard-inscritos.js

// ======================================================
// CONFIGURACIÓN
// ======================================================

// IMPORTANTE:
// Esta URL debe ser una función/backend propio.
// NO pongas aquí el token que te entregaron.
// El backend es quien debe llamar a la API externa con el token.
const API_PROXY_URL = "https://TU_BACKEND_O_FIREBASE_FUNCTION/apiPagos";

// Si después quieres comparar contra Firestore, aquí activamos Firebase.
// Por ahora dejamos la estructura preparada.
const USAR_FIREBASE_COMPARATIVO = false;

// ======================================================
// ELEMENTOS HTML
// ======================================================

const inputNumeroNegocio = document.getElementById("inputNumeroNegocio");
const btnBuscar = document.getElementById("btnBuscar");
const btnLimpiar = document.getElementById("btnLimpiar");

const estadoCarga = document.getElementById("estadoCarga");
const resumenGrupo = document.getElementById("resumenGrupo");
const resumenComparativo = document.getElementById("resumenComparativo");
const tbodyPasajeros = document.getElementById("tbodyPasajeros");

// ======================================================
// EVENTOS
// ======================================================

btnBuscar.addEventListener("click", buscarGrupo);

btnLimpiar.addEventListener("click", () => {
  inputNumeroNegocio.value = "";
  estadoCarga.textContent = "";
  resumenGrupo.innerHTML = "";
  resumenComparativo.innerHTML = "";
  tbodyPasajeros.innerHTML = "";
});

inputNumeroNegocio.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    buscarGrupo();
  }
});

// ======================================================
// FUNCIÓN PRINCIPAL
// ======================================================

async function buscarGrupo() {
  const numeroNegocio = inputNumeroNegocio.value.trim();

  if (!numeroNegocio) {
    alert("Ingresa un Número de Negocio.");
    return;
  }

  limpiarVista();

  try {
    estadoCarga.textContent = "Consultando información...";

    const datosApi = await consultarApiPagos(numeroNegocio);

    const grupo = normalizarGrupo(datosApi);
    const pasajeros = normalizarPasajeros(datosApi);
    const saldos = normalizarSaldos(datosApi);

    let pasajerosFirestore = [];

    if (USAR_FIREBASE_COMPARATIVO) {
      pasajerosFirestore = await obtenerPasajerosDesdeFirestore(numeroNegocio);
    }

    const comparativo = compararNominas(pasajeros, pasajerosFirestore);

    renderResumenGrupo(grupo, pasajeros, saldos);
    renderResumenComparativo(comparativo);
    renderTablaPasajeros(pasajeros, comparativo);

    estadoCarga.textContent = `Consulta finalizada para N° ${numeroNegocio}.`;
  } catch (error) {
    console.error("Error al buscar grupo:", error);
    estadoCarga.textContent = "Error al consultar la información.";
    alert("No se pudo consultar la información. Revisa consola o configuración del backend.");
  }
}

// ======================================================
// CONSULTA AL BACKEND PROPIO
// ======================================================

async function consultarApiPagos(numeroNegocio) {
  const url = `${API_PROXY_URL}?numeroNegocio=${encodeURIComponent(numeroNegocio)}`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Error HTTP ${response.status}`);
  }

  const data = await response.json();

  return data;
}

// ======================================================
// NORMALIZADORES
// Ajusta aquí los nombres reales cuando veamos la respuesta
// exacta de la API externa.
// ======================================================

function normalizarGrupo(data) {
  const grupo = data.grupo || data.colegio || data.colegios || {};

  return {
    numeroNegocio: grupo.numeroNegocio || grupo.numero_negocio || grupo.negocio || "",
    nombreGrupo: grupo.nombreGrupo || grupo.nombre_grupo || grupo.colegio || "",
    anoViaje: grupo.anoViaje || grupo.anioViaje || grupo.año_viaje || grupo.anio_viaje || "",
    fechaIngreso: grupo.fechaIngreso || grupo.fecha_ingreso || grupo.created_at || ""
  };
}

function normalizarPasajeros(data) {
  const lista =
    data.nomina ||
    data.nominas ||
    data.pasajeros ||
    data.items ||
    [];

  return lista.map((pax) => {
    return {
      idPasajero: pax.idPasajero || pax.id_pasajero || pax.id || "",
      rut: limpiarRut(pax.rut || pax.RUT || pax.documento || ""),
      nombres: pax.nombres || pax.nombre || "",
      apellidos: pax.apellidos || pax.apellido || "",
      nombreCompleto: construirNombreCompleto(pax),
      fechaNacimiento: pax.fechaNacimiento || pax.fecha_nacimiento || pax.nacimiento || "",
      sexo: pax.sexo || pax.genero || "",
      subocupacion: pax.subocupacion || pax.sub_ocupacion || pax.ocupacion || pax.categoria || "",
      pagoInscripcion: numero(pax.pagoInscripcion || pax.pago_inscripcion || pax.inscripcion_pagada || 0),
      totalPagado: numero(pax.totalPagado || pax.total_pagado || pax.pagado || 0),
      saldo: numero(pax.saldo || pax.saldoPendiente || pax.saldo_pendiente || 0),
      estadoPago: pax.estadoPago || pax.estado_pago || "",
      ultimaCuota: pax.ultimaCuota || pax.ultima_cuota || pax.ultimoMesPagado || pax.ultimo_mes_pagado || "",
      fechaAnulacion: pax.fechaAnulacion || pax.fecha_anulacion || "",
      credencialCargada: Boolean(
        pax.credencialCargada ||
        pax.credencial_cargada ||
        pax.tieneCredencial ||
        pax.tiene_credencial ||
        pax.urlCredencial ||
        pax.url_credencial
      ),
      urlCredencial: pax.urlCredencial || pax.url_credencial || pax.credencial_url || ""
    };
  });
}

function normalizarSaldos(data) {
  const saldos = data.saldos || data.resumenFinanciero || data.resumen_financiero || {};

  return {
    totalPagado: numero(saldos.totalPagado || saldos.total_pagado || saldos.pagado || 0),
    saldoTotal: numero(saldos.saldoTotal || saldos.saldo_total || saldos.saldo || 0),
    totalGrupo: numero(saldos.totalGrupo || saldos.total_grupo || saldos.total || 0)
  };
}

// ======================================================
// COMPARATIVO
// ======================================================

function compararNominas(pasajerosApi, pasajerosFirestore) {
  const apiPorRut = new Map();
  const firePorRut = new Map();

  pasajerosApi.forEach((p) => {
    if (p.rut) apiPorRut.set(p.rut, p);
  });

  pasajerosFirestore.forEach((p) => {
    const rut = limpiarRut(p.rut || "");
    if (rut) firePorRut.set(rut, p);
  });

  const enApiNoFirestore = [];
  const enFirestoreNoApi = [];
  const enAmbos = [];

  apiPorRut.forEach((paxApi, rut) => {
    if (firePorRut.has(rut)) {
      enAmbos.push(rut);
    } else {
      enApiNoFirestore.push(rut);
    }
  });

  firePorRut.forEach((paxFire, rut) => {
    if (!apiPorRut.has(rut)) {
      enFirestoreNoApi.push(rut);
    }
  });

  return {
    totalApi: pasajerosApi.length,
    totalFirestore: pasajerosFirestore.length,
    enAmbos,
    enApiNoFirestore,
    enFirestoreNoApi
  };
}

// Esta función queda preparada para cuando conectemos Firebase.
// Luego la reemplazamos por la lectura real de inscripciones.
async function obtenerPasajerosDesdeFirestore(numeroNegocio) {
  console.warn("Comparativo Firestore aún no conectado:", numeroNegocio);
  return [];
}

// ======================================================
// RENDER RESUMEN
// ======================================================

function renderResumenGrupo(grupo, pasajeros, saldos) {
  const activos = pasajeros.filter((p) => !p.fechaAnulacion).length;
  const anulados = pasajeros.filter((p) => p.fechaAnulacion).length;
  const conCredencial = pasajeros.filter((p) => p.credencialCargada).length;

  resumenGrupo.innerHTML = `
    ${kpi("N° Negocio", grupo.numeroNegocio || "-")}
    ${kpi("Grupo", grupo.nombreGrupo || "-")}
    ${kpi("Año viaje", grupo.anoViaje || "-")}
    ${kpi("Fecha ingreso", formatearFecha(grupo.fechaIngreso))}
    ${kpi("Pasajeros activos", activos)}
    ${kpi("Pasajeros anulados", anulados)}
    ${kpi("Con credencial", conCredencial)}
    ${kpi("Total pagado", formatoCLP(saldos.totalPagado))}
    ${kpi("Saldo total", formatoCLP(saldos.saldoTotal))}
  `;
}

function renderResumenComparativo(comparativo) {
  resumenComparativo.innerHTML = `
    ${kpi("Pasajeros API pagos", comparativo.totalApi)}
    ${kpi("Pasajeros inscripción RT", comparativo.totalFirestore)}
    ${kpi("Coinciden por RUT", comparativo.enAmbos.length)}
    ${kpi("En pagos no en inscripción", comparativo.enApiNoFirestore.length)}
    ${kpi("En inscripción no en pagos", comparativo.enFirestoreNoApi.length)}
  `;
}

function kpi(titulo, valor) {
  return `
    <div class="kpi">
      <span>${titulo}</span>
      <strong>${valor ?? "-"}</strong>
    </div>
  `;
}

// ======================================================
// RENDER TABLA
// ======================================================

function renderTablaPasajeros(pasajeros, comparativo) {
  tbodyPasajeros.innerHTML = "";

  if (!pasajeros.length) {
    tbodyPasajeros.innerHTML = `
      <tr>
        <td colspan="13" class="muted">No hay pasajeros para mostrar.</td>
      </tr>
    `;
    return;
  }

  pasajeros.forEach((pax) => {
    const tr = document.createElement("tr");

    const estadoNomina = obtenerEstadoNomina(pax, comparativo);

    tr.innerHTML = `
      <td>${estadoNomina}</td>
      <td>${pax.rut || "-"}</td>
      <td>${pax.nombreCompleto || "-"}</td>
      <td>${formatearFecha(pax.fechaNacimiento)}</td>
      <td>${pax.sexo || "-"}</td>
      <td>${pax.subocupacion || "-"}</td>
      <td>${formatoCLP(pax.pagoInscripcion)}</td>
      <td>${formatoCLP(pax.totalPagado)}</td>
      <td>${formatoCLP(pax.saldo)}</td>
      <td>${renderEstadoPago(pax)}</td>
      <td>${pax.ultimaCuota || "-"}</td>
      <td>${formatearFecha(pax.fechaAnulacion)}</td>
      <td>${renderCredencial(pax)}</td>
    `;

    tbodyPasajeros.appendChild(tr);
  });
}

function obtenerEstadoNomina(pax, comparativo) {
  if (pax.fechaAnulacion) {
    return `<span class="tag danger">Anulado</span>`;
  }

  if (comparativo.enApiNoFirestore.includes(pax.rut)) {
    return `<span class="tag warning">Solo API pagos</span>`;
  }

  if (comparativo.enAmbos.includes(pax.rut)) {
    return `<span class="tag ok">Coincide</span>`;
  }

  return `<span class="tag">Activo</span>`;
}

function renderEstadoPago(pax) {
  const estado = String(pax.estadoPago || "").toLowerCase();

  if (pax.saldo <= 0 && pax.totalPagado > 0) {
    return `<span class="ok">Pagado</span>`;
  }

  if (estado.includes("pendiente") || pax.saldo > 0) {
    return `<span class="warning">${pax.estadoPago || "Pendiente"}</span>`;
  }

  return pax.estadoPago || "-";
}

function renderCredencial(pax) {
  if (!pax.credencialCargada) {
    return `<span class="danger">No cargada</span>`;
  }

  if (pax.urlCredencial) {
    return `<a href="${pax.urlCredencial}" target="_blank">Ver / descargar</a>`;
  }

  return `<span class="ok">Cargada</span>`;
}

// ======================================================
// UTILIDADES
// ======================================================

function limpiarVista() {
  resumenGrupo.innerHTML = "";
  resumenComparativo.innerHTML = "";
  tbodyPasajeros.innerHTML = "";
}

function limpiarRut(rut) {
  return String(rut || "")
    .replace(/\./g, "")
    .replace(/-/g, "")
    .replace(/\s/g, "")
    .toUpperCase();
}

function construirNombreCompleto(pax) {
  if (pax.nombreCompleto) return pax.nombreCompleto;
  if (pax.nombre_completo) return pax.nombre_completo;

  const nombres = pax.nombres || pax.nombre || "";
  const apellidos = pax.apellidos || pax.apellido || "";

  return `${nombres} ${apellidos}`.trim();
}

function numero(valor) {
  if (valor === null || valor === undefined || valor === "") return 0;

  const limpio = String(valor)
    .replace(/\$/g, "")
    .replace(/\./g, "")
    .replace(/,/g, ".");

  const n = Number(limpio);

  return Number.isFinite(n) ? n : 0;
}

function formatoCLP(valor) {
  return Number(valor || 0).toLocaleString("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0
  });
}

function formatearFecha(fecha) {
  if (!fecha) return "-";

  const d = new Date(fecha);

  if (Number.isNaN(d.getTime())) {
    return fecha;
  }

  return d.toLocaleDateString("es-CL");
}
