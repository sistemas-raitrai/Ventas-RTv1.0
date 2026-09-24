import {
  auth,
  db,
  onAuthStateChanged,
  collection,
  clean,
  escapeHtml,
  getCurrentSystemUser,
  canViewMedicalData,
  loadGroupInscriptions
} from "./ficha-medica-common.js";

import {
  getDocs
} from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";

import {
  TALLAS_POLERAS,
  fechaInicioPoleras,
  htmlResumenTallas,
  imprimirReportePoleras,
  resumirPolerasGrupo,
  totalesPoleras
} from "./poleras-common.js";

const $ = (id) => document.getElementById(id);

const estado = {
  grupos: [],
  resultados: [],
  consultando: false
};

onAuthStateChanged(auth, async (firebaseUser) => {
  if (!firebaseUser) {
    location.href = "login.html";
    return;
  }

  const usuario = getCurrentSystemUser(firebaseUser);

  if (!canViewMedicalData(usuario)) {
    $("estadoPoleras").textContent =
      "No tienes permisos para consultar estos datos.";
    return;
  }

  $("btnConsultarPoleras").addEventListener(
    "click",
    consultarConsolidadoPoleras
  );

  $("btnImprimirPoleras").addEventListener(
    "click",
    imprimirConsolidadoPoleras
  );

  try {
    $("estadoPoleras").textContent = "Cargando grupos…";

    const snapshot = await getDocs(
      collection(db, "ventas_cotizaciones")
    );

    estado.grupos = snapshot.docs.map((documento) => ({
      docId: documento.id,
      datos: documento.data()
    }));

    cargarFiltrosPoleras();

    $("estadoPoleras").textContent =
      "Elige los filtros y pulsa Consultar.";
  } catch (error) {
    console.error(error);
    $("estadoPoleras").textContent =
      "No fue posible cargar los grupos.";
    $("estadoPoleras").classList.add("error");
  }
});

function cargarFiltrosPoleras() {
  const anos = [...new Set(
    estado.grupos
      .map((grupo) => clean(grupo.datos.anoViaje))
      .filter(Boolean)
  )].sort((a, b) => b.localeCompare(a, "es"));

  const anoActual = String(new Date().getFullYear());

  $("filtroAnoPoleras").innerHTML = `
    <option value="">Todos los años</option>
    ${anos.map((ano) => `
      <option value="${escapeHtml(ano)}">
        ${escapeHtml(ano)}
      </option>
    `).join("")}
  `;

  if (anos.includes(anoActual)) {
    $("filtroAnoPoleras").value = anoActual;
  }

  const destinos = [...new Set(
    estado.grupos
      .map((grupo) => clean(grupo.datos.destino))
      .filter(Boolean)
  )].sort((a, b) => a.localeCompare(b, "es"));

  $("filtroDestinoPoleras").innerHTML = `
    <option value="">Todos los destinos</option>
    ${destinos.map((destino) => `
      <option value="${escapeHtml(destino)}">
        ${escapeHtml(destino)}
      </option>
    `).join("")}
  `;
}

function seleccionarGruposPoleras() {
  const ano = $("filtroAnoPoleras").value;
  const destino = $("filtroDestinoPoleras").value;
  const desde = $("filtroDesdePoleras").value;
  const hasta = $("filtroHastaPoleras").value;

  if (desde && hasta && desde > hasta) {
    throw new Error(
      "La fecha «desde» no puede ser posterior a «hasta»."
    );
  }

  return estado.grupos
    .filter(({ datos }) => {
      const inicio = fechaInicioPoleras(datos);

      if (ano && clean(datos.anoViaje) !== ano) return false;
      if (destino && clean(datos.destino) !== destino) return false;
      if (desde && (!inicio || inicio < desde)) return false;
      if (hasta && (!inicio || inicio > hasta)) return false;

      return true;
    })
    .sort((a, b) => {
      const fechaA = fechaInicioPoleras(a.datos) || "9999-99-99";
      const fechaB = fechaInicioPoleras(b.datos) || "9999-99-99";

      return fechaA.localeCompare(fechaB) ||
        a.docId.localeCompare(b.docId);
    });
}

async function consultarConsolidadoPoleras() {
  if (estado.consultando) return;

  let seleccion;

  try {
    seleccion = seleccionarGruposPoleras();
  } catch (error) {
    $("estadoPoleras").textContent = error.message;
    $("estadoPoleras").classList.add("error");
    return;
  }

  estado.consultando = true;
  estado.resultados = [];

  $("resultadoPoleras").hidden = true;
  $("btnConsultarPoleras").disabled = true;
  $("btnImprimirPoleras").disabled = true;
  $("estadoPoleras").classList.remove("error");

  try {
    /*
      Se consultan cinco grupos a la vez. Evitamos lanzar
      cientos de lecturas simultáneas al abrir la página.
    */
    const resultados = [];

    for (let indice = 0; indice < seleccion.length; indice += 5) {
      const lote = seleccion.slice(indice, indice + 5);

      const parciales = await Promise.all(
        lote.map(async ({ docId, datos }) => {
          const inscripciones = await loadGroupInscriptions(docId);

          return resumirPolerasGrupo(
            datos,
            docId,
            inscripciones
          );
        })
      );

      resultados.push(...parciales);

      $("estadoPoleras").textContent =
        `Consultados ${Math.min(indice + 5, seleccion.length)} ` +
        `de ${seleccion.length} grupos…`;
    }

    estado.resultados = resultados;
    renderConsolidadoPoleras();

    $("estadoPoleras").textContent =
      `Consulta completa: ${resultados.length} grupos.`;

    $("btnImprimirPoleras").disabled = !resultados.length;
  } catch (error) {
    console.error(error);

    /*
      No se publica un total parcial como si fuera completo.
    */
    estado.resultados = [];
    $("estadoPoleras").textContent =
      "La consulta no se completó. No se mostrarán totales parciales.";
    $("estadoPoleras").classList.add("error");
  } finally {
    estado.consultando = false;
    $("btnConsultarPoleras").disabled = false;
  }
}

function renderConsolidadoPoleras() {
  const totales = totalesPoleras(estado.resultados);

  $("totalesPoleras").innerHTML = `
    <div class="totales">
      <span>Grupos: <strong>${totales.grupos}</strong></span>
      <span>Participantes:
        <strong>${totales.totalPersonas}</strong>
      </span>
      <span>Con talla: <strong>${totales.conTalla}</strong></span>
      <span>Sin talla: <strong>${totales.sinTalla}</strong></span>
    </div>

    <div class="tallas">
      ${htmlResumenTallas(totales.tallas)}
    </div>
  `;

  $("tablaPoleras").innerHTML = estado.resultados.length
    ? estado.resultados.map((grupo) => `
        <tr>
          <td>${escapeHtml(grupo.nombre)}</td>
          <td>${escapeHtml(grupo.destino)}</td>
          <td>${escapeHtml(grupo.fechaInicio || "—")}</td>
          <td>${grupo.totalPersonas}</td>
          <td>${grupo.conTalla}</td>
          <td>${grupo.sinTalla}</td>

          ${TALLAS_POLERAS.map((talla) => `
            <td>${grupo.tallas[talla]}</td>
          `).join("")}

          <td>
            <a href="gestion-fichas-medicas.html?id=${
              encodeURIComponent(grupo.id)
            }">
              Ver grupo
            </a>
          </td>
        </tr>
      `).join("")
    : `
      <tr>
        <td colspan="15">
          No hay grupos para los filtros seleccionados.
        </td>
      </tr>
    `;

  $("resultadoPoleras").hidden = false;
}

function imprimirConsolidadoPoleras() {
  if (!estado.resultados.length) return;

  const totales = totalesPoleras(estado.resultados);

  const filtros = [
    $("filtroAnoPoleras").value &&
      `Año ${$("filtroAnoPoleras").value}`,
    $("filtroDestinoPoleras").value &&
      $("filtroDestinoPoleras").value,
    $("filtroDesdePoleras").value &&
      `Desde ${$("filtroDesdePoleras").value}`,
    $("filtroHastaPoleras").value &&
      `Hasta ${$("filtroHastaPoleras").value}`
  ].filter(Boolean).join(" · ") || "Todos los grupos";

  const contenido = `
    <h1>Consolidado de poleras</h1>
    <p class="poleras-subtitulo">${escapeHtml(filtros)}</p>

    <div class="poleras-indicadores">
      <span>Grupos: <strong>${totales.grupos}</strong></span>
      <span>Participantes:
        <strong>${totales.totalPersonas}</strong>
      </span>
      <span>Con talla: <strong>${totales.conTalla}</strong></span>
      <span>Sin talla: <strong>${totales.sinTalla}</strong></span>
    </div>

    <div class="poleras-tallas">
      ${htmlResumenTallas(totales.tallas)}
    </div>

    <h2>Desglose por grupo</h2>

    <table>
      <thead>
        <tr>
          <th>Grupo</th>
          <th>Inicio</th>
          <th>Personas</th>
          <th>Sin talla</th>
          ${TALLAS_POLERAS.map((talla) => `
            <th>${talla}</th>
          `).join("")}
        </tr>
      </thead>

      <tbody>
        ${estado.resultados.map((grupo) => `
          <tr>
            <td>${escapeHtml(grupo.nombre)}</td>
            <td>${escapeHtml(grupo.fechaInicio || "—")}</td>
            <td>${grupo.totalPersonas}</td>
            <td>${grupo.sinTalla}</td>

            ${TALLAS_POLERAS.map((talla) => `
              <td>${grupo.tallas[talla]}</td>
            `).join("")}
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;

  imprimirReportePoleras({
    titulo: "Consolidado de poleras",
    subtitulo: filtros,
    contenido
  });
}
