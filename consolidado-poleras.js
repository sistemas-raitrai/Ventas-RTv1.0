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
  getDocs,
  getDoc,
  doc,
  query,
  where
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
  consultando: false,
  filtrosConsultados: null
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

  $("filtroAnoPoleras").addEventListener(
    "change",
    async () => {
      invalidarConsultaPoleras();
      await cargarGruposGanadosPoleras();
    }
  );

  [
    "filtroDestinoPoleras",
    "filtroDesdePoleras",
    "filtroHastaPoleras"
  ].forEach((id) => {
    $(id).addEventListener("change", invalidarConsultaPoleras);
  });

  prepararAnosPoleras();

  await cargarGruposGanadosPoleras();
});

function normalizarEstadoPoleras(valor) {
  return String(valor ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function prepararAnosPoleras() {
  const anoActual = new Date().getFullYear();

  /*
    Mismo rango operativo que declara gestion-nomina.js:
    año anterior, actual y dos siguientes.
  */
  const anos = [
    anoActual - 1,
    anoActual,
    anoActual + 1,
    anoActual + 2
  ];

  $("filtroAnoPoleras").innerHTML = anos.map((ano) => `
    <option value="${ano}">${ano}</option>
  `).join("");

  $("filtroAnoPoleras").value = String(anoActual);
}

function invalidarConsultaPoleras() {
  estado.resultados = [];
  estado.filtrosConsultados = null;

  $("resultadoPoleras").hidden = true;
  $("btnImprimirPoleras").disabled = true;

  if (!estado.consultando) {
    $("estadoPoleras").textContent =
      "Los filtros cambiaron. Pulsa Consultar para actualizar los totales.";
    $("estadoPoleras").classList.remove("error");
  }
}

function actualizarDestinosPoleras() {
  const seleccionAnterior = $("filtroDestinoPoleras").value;

  const destinos = [...new Set(
    estado.grupos
      .map(({ datos }) =>
        clean(datos.destinoPrincipal || datos.destino)
      )
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

  if (destinos.includes(seleccionAnterior)) {
    $("filtroDestinoPoleras").value = seleccionAnterior;
  }
}

async function cargarGruposGanadosPoleras() {
  const ano = Number($("filtroAnoPoleras").value);

  estado.grupos = [];
  invalidarConsultaPoleras();

  $("btnConsultarPoleras").disabled = true;
  $("filtroAnoPoleras").disabled = true;
  $("estadoPoleras").textContent =
    `Cargando grupos ganados ${ano}…`;

  try {
    /*
      Esta es la misma colección y consulta por año
      que utiliza Gestión de Nómina.
    */
    const snapshot = await getDocs(
      query(
        collection(db, "ventas_grupos_resumen"),
        where("anoViaje", "==", ano)
      )
    );

    const ganados = snapshot.docs
      .map((documento) => ({
        resumenId: documento.id,
        datos: documento.data() || {}
      }))
      .filter(({ datos }) =>
        normalizarEstadoPoleras(
          datos.estado || datos.estadoComercial
        ) === "ganada"
      );

    /*
      El resumen indica cuáles grupos corresponden.
      El documento original aporta la fecha de inicio
      y los demás datos oficiales del grupo.
    */
    const grupos = [];

    for (let indice = 0; indice < ganados.length; indice += 5) {
      const lote = ganados.slice(indice, indice + 5);

      const parciales = await Promise.all(
        lote.map(async ({ resumenId, datos }) => {
          const docId = String(
            datos.groupDocId || resumenId
          );

          const snapshotGrupo = await getDoc(
            doc(db, "ventas_cotizaciones", docId)
          );

          if (!snapshotGrupo.exists()) {
            throw new Error(
              `No existe el documento del grupo ${docId}.`
            );
          }

          const grupoOriginal = snapshotGrupo.data() || {};

          return {
            docId,
            datos: {
              ...datos,
              ...grupoOriginal,

              /*
                Estos valores identifican al grupo tal como
                aparece en el resumen de Gestión de Nómina.
              */
              aliasGrupo:
                datos.aliasGrupo ||
                grupoOriginal.aliasGrupo,
              destino:
                datos.destinoPrincipal ||
                datos.destino ||
                grupoOriginal.destino,
              anoViaje: ano
            }
          };
        })
      );

      grupos.push(...parciales);

      $("estadoPoleras").textContent =
        `Cargando datos de ${Math.min(
          indice + 5,
          ganados.length
        )} de ${ganados.length} grupos ganados…`;
    }

    estado.grupos = grupos;

    actualizarDestinosPoleras();

    $("estadoPoleras").textContent =
      `${grupos.length} grupos ganados en ${ano}. ` +
      "Elige los filtros y pulsa Consultar.";

    $("estadoPoleras").classList.remove("error");
  } catch (error) {
    console.error("[poleras] cargarGruposGanadosPoleras", error);

    estado.grupos = [];
    actualizarDestinosPoleras();

    $("estadoPoleras").textContent =
      error.message ||
      "No fue posible cargar los grupos ganados.";

    $("estadoPoleras").classList.add("error");
  } finally {
    $("btnConsultarPoleras").disabled = false;
    $("filtroAnoPoleras").disabled = false;
  }
}

function obtenerFiltrosPoleras() {
  return {
    ano: $("filtroAnoPoleras").value,
    destino: $("filtroDestinoPoleras").value,
    desde: $("filtroDesdePoleras").value,
    hasta: $("filtroHastaPoleras").value
  };
}

function seleccionarGruposPoleras() {
  const {
    destino,
    desde,
    hasta
  } = obtenerFiltrosPoleras();

  if (desde && hasta && desde > hasta) {
    throw new Error(
      "La fecha «desde» no puede ser posterior a «hasta»."
    );
  }

  return estado.grupos
    .filter(({ datos }) => {
      const inicio = fechaInicioPoleras(datos);
      const destinoGrupo = clean(
        datos.destinoPrincipal || datos.destino
      );

      if (destino && destinoGrupo !== destino) return false;
      if (desde && (!inicio || inicio < desde)) return false;
      if (hasta && (!inicio || inicio > hasta)) return false;

      return true;
    })
    .sort((a, b) => {
      const fechaA =
        fechaInicioPoleras(a.datos) || "9999-99-99";

      const fechaB =
        fechaInicioPoleras(b.datos) || "9999-99-99";

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
  estado.filtrosConsultados = null;

  $("resultadoPoleras").hidden = true;
  $("btnConsultarPoleras").disabled = true;
  $("btnImprimirPoleras").disabled = true;
  $("estadoPoleras").classList.remove("error");

  try {
    const resultados = [];

    for (
      let indice = 0;
      indice < seleccion.length;
      indice += 5
    ) {
      const lote = seleccion.slice(indice, indice + 5);

      const parciales = await Promise.all(
        lote.map(async ({ docId, datos }) => {
          const inscripciones =
            await loadGroupInscriptions(docId);

          return resumirPolerasGrupo(
            datos,
            docId,
            inscripciones
          );
        })
      );

      resultados.push(...parciales);

      $("estadoPoleras").textContent =
        `Consultados ${Math.min(
          indice + 5,
          seleccion.length
        )} de ${seleccion.length} grupos…`;
    }

    estado.resultados = resultados;
    estado.filtrosConsultados = obtenerFiltrosPoleras();

    renderConsolidadoPoleras();

    $("estadoPoleras").textContent =
      `Consulta completa: ${resultados.length} grupos ganados.`;

    $("btnImprimirPoleras").disabled =
      !resultados.length;
  } catch (error) {
    console.error("[poleras] consultarConsolidadoPoleras", error);

    estado.resultados = [];
    estado.filtrosConsultados = null;

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
  if (
    !estado.resultados.length ||
    !estado.filtrosConsultados
  ) {
    return;
  }
  
  const totales = totalesPoleras(estado.resultados);
  const consultados = estado.filtrosConsultados;
  
  const filtros = [
    consultados.ano && `Año ${consultados.ano}`,
    consultados.destino,
    consultados.desde && `Desde ${consultados.desde}`,
    consultados.hasta && `Hasta ${consultados.hasta}`
  ].filter(Boolean).join(" · ");

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
