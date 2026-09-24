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

const DESTINOS_POLERAS = [
  "Sur de Chile",
  "Bariloche",
  "Sur de Chile y Bariloche",
  "Norte de Chile",
  "Brasil",
  "Otro"
];

const estado = {
  grupos: [],
  resultados: [],
  consultando: false,
  cargandoGrupos: false,
  filtrosConsultados: null,
  sinFecha: 0
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
    cargarGruposConPolera
  );

  [
    "filtroDestinoPoleras",
    "filtroDesdePoleras",
    "filtroHastaPoleras"
  ].forEach((id) => {
    $(id).addEventListener(
      "change",
      invalidarConsultaPoleras
    );
  });

  prepararFiltrosPoleras();
  await cargarGruposConPolera();
});

function normalizarTextoPoleras(valor) {
  return String(valor ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function numeroNegocioPoleras(valor) {
  return String(valor ?? "").trim();
}

function destinoCanonicoPoleras(grupo = {}) {
  const original = clean(
    grupo.destinoPrincipal ||
    grupo.destino ||
    grupo.destinoPrincipalOtro ||
    ""
  );

  const valor = normalizarTextoPoleras(original)
    .replace(/\s+/g, " ");

  if (
    valor.includes("sur de chile") &&
    valor.includes("bariloche")
  ) {
    return "Sur de Chile y Bariloche";
  }

  if (valor.includes("bariloche")) {
    return "Bariloche";
  }

  if (valor.includes("sur de chile")) {
    return "Sur de Chile";
  }

  if (valor.includes("norte de chile")) {
    return "Norte de Chile";
  }

  if (valor.includes("brasil")) {
    return "Brasil";
  }

  /*
    Incluye el valor OTRO y cualquier destino distinto
    de las cinco categorías anteriores.
  */
  return "Otro";
}

function prepararFiltrosPoleras() {
  const anoActual = new Date().getFullYear();

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

  $("filtroDestinoPoleras").innerHTML = `
    <option value="">Todos los destinos</option>

    ${DESTINOS_POLERAS.map((destino) => `
      <option value="${escapeHtml(destino)}">
        ${escapeHtml(destino)}
      </option>
    `).join("")}
  `;
}

function invalidarConsultaPoleras() {
  estado.resultados = [];
  estado.filtrosConsultados = null;

  $("resultadoPoleras").hidden = true;
  $("btnImprimirPoleras").disabled = true;

  if (!estado.consultando && !estado.cargandoGrupos) {
    $("estadoPoleras").textContent =
      "Los filtros cambiaron. Pulsa Consultar para actualizar los totales.";

    $("estadoPoleras").classList.remove("error");
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

async function leerResumenesGanadosPoleras(ano) {
  /*
    Gestión de Nómina consulta el año como número.
  */
  const snapshot = await getDocs(
    query(
      collection(db, "ventas_grupos_resumen"),
      where("anoViaje", "==", Number(ano))
    )
  );

  return snapshot.docs
    .map((documento) => ({
      resumenId: documento.id,
      datos: documento.data() || {}
    }))
    .filter(({ datos }) =>
      normalizarTextoPoleras(
        datos.estado || datos.estadoComercial
      ) === "ganada"
    );
}

async function leerFechasOperativasPoleras(ano) {
  /*
    grupos.js admite anoViaje guardado como número
    o como texto. Leemos las dos variantes.
  */
  const [numericos, texto] = await Promise.all([
    getDocs(
      query(
        collection(db, "grupos"),
        where("anoViaje", "==", Number(ano))
      )
    ),

    getDocs(
      query(
        collection(db, "grupos"),
        where("anoViaje", "==", String(ano))
      )
    )
  ]);

  const porNegocio = new Map();

  for (const snapshot of [numericos, texto]) {
    for (const documento of snapshot.docs) {
      const datos = documento.data() || {};

      const negocio = numeroNegocioPoleras(
        datos.numeroNegocio ??
        datos.numNegocio ??
        datos.idNegocio
      );

      if (!negocio) continue;

      /*
        Si hay más de un documento operativo para un negocio,
        conservamos el dato, pero evitamos escoger una fecha
        distinta silenciosamente.
      */
      const fecha = fechaInicioPoleras(datos);
      const anterior = porNegocio.get(negocio);

      if (
        anterior &&
        anterior.fechaInicio &&
        fecha &&
        anterior.fechaInicio !== fecha
      ) {
        throw new Error(
          `El negocio ${negocio} tiene dos fechas de salida ` +
          "diferentes en la colección grupos."
        );
      }

      if (!anterior || (!anterior.fechaInicio && fecha)) {
        porNegocio.set(negocio, {
          fechaInicio: fecha,
          docId: documento.id
        });
      }
    }
  }

  return porNegocio;
}

async function cargarGruposConPolera() {
  if (estado.cargandoGrupos || estado.consultando) return;

  estado.cargandoGrupos = true;
  estado.grupos = [];
  invalidarConsultaPoleras();

  $("btnConsultarPoleras").disabled = true;
  $("filtroAnoPoleras").disabled = true;
  $("estadoPoleras").classList.remove("error");

  const ano = Number($("filtroAnoPoleras").value);

  try {
    $("estadoPoleras").textContent =
      `Cargando grupos ganados ${ano}…`;

    const [ganados, fechasPorNegocio] = await Promise.all([
      leerResumenesGanadosPoleras(ano),
      leerFechasOperativasPoleras(ano)
    ]);

    const grupos = [];

    for (
      let indice = 0;
      indice < ganados.length;
      indice += 5
    ) {
      const lote = ganados.slice(indice, indice + 5);

      const parciales = await Promise.all(
        lote.map(async ({ resumenId, datos }) => {
          const docId = String(
            datos.groupDocId || resumenId
          );

          const documentoGrupo = await getDoc(
            doc(db, "ventas_cotizaciones", docId)
          );

          if (!documentoGrupo.exists()) {
            throw new Error(
              `Falta el grupo de Ventas ${docId}.`
            );
          }

          const grupoVentas = documentoGrupo.data() || {};

          /*
            Es la regla efectiva de grupo.js:
            ausencia del campo también significa incluido.
          */
          if (
            grupoVentas.elementosIncluidos?.polera === false
          ) {
            return null;
          }

          const numeroNegocio = numeroNegocioPoleras(
            grupoVentas.numeroNegocio ??
            datos.numeroNegocio ??
            datos.negocioId
          );

          const fechaOperativa = numeroNegocio
            ? fechasPorNegocio.get(numeroNegocio)
            : null;

          const destino = destinoCanonicoPoleras({
            ...datos,
            ...grupoVentas,
            destinoPrincipal:
              grupoVentas.destinoPrincipal ||
              datos.destinoPrincipal,
            destino:
              grupoVentas.destino ||
              datos.destino
          });

          return {
            docId,
            datos: {
              ...datos,
              ...grupoVentas,

              /*
                Esta fecha proviene exclusivamente de grupos.js
                / colección grupos. Se usa para filtrar,
                ordenar, mostrar e imprimir.
              */
              fechaInicio:
                fechaOperativa?.fechaInicio || "",

              numeroNegocio,
              idGrupo:
                String(
                  grupoVentas.idGrupo ||
                  datos.idGrupo ||
                  docId
                ),

              destino,
              destinoPoleras: destino,

              aliasGrupo:
                datos.aliasGrupo ||
                grupoVentas.aliasGrupo ||
                grupoVentas.nombreGrupo ||
                "",

              anoViaje: ano
            }
          };
        })
      );

      grupos.push(...parciales.filter(Boolean));

      $("estadoPoleras").textContent =
        `Revisados ${Math.min(
          indice + 5,
          ganados.length
        )} de ${ganados.length} grupos ganados…`;
    }

    estado.grupos = grupos;

    estado.sinFecha = grupos.filter(
      ({ datos }) => !datos.fechaInicio
    ).length;

    $("estadoPoleras").textContent =
      `${grupos.length} grupos ganados incluyen polera` +
      (
        estado.sinFecha
          ? ` · ${estado.sinFecha} sin fecha de salida vinculada`
          : ""
      ) +
      ". Elige los filtros y pulsa Consultar.";
  } catch (error) {
    console.error("[poleras] cargarGruposConPolera", error);

    estado.grupos = [];
    estado.sinFecha = 0;

    $("estadoPoleras").textContent =
      error.message ||
      "No se pudieron cargar los grupos con polera.";

    $("estadoPoleras").classList.add("error");
  } finally {
    estado.cargandoGrupos = false;
    $("btnConsultarPoleras").disabled = false;
    $("filtroAnoPoleras").disabled = false;
  }
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
      const fecha = datos.fechaInicio || "";

      if (
        destino &&
        datos.destinoPoleras !== destino
      ) {
        return false;
      }

      if (
        desde &&
        (!fecha || fecha < desde)
      ) {
        return false;
      }

      if (
        hasta &&
        (!fecha || fecha > hasta)
      ) {
        return false;
      }

      return true;
    })
    .sort((a, b) => {
      const fechaA =
        a.datos.fechaInicio || "9999-99-99";

      const fechaB =
        b.datos.fechaInicio || "9999-99-99";

      return fechaA.localeCompare(fechaB) ||
        String(a.datos.numeroNegocio).localeCompare(
          String(b.datos.numeroNegocio),
          "es",
          { numeric: true }
        );
    });
}

async function consultarConsolidadoPoleras() {
  if (estado.consultando || estado.cargandoGrupos) return;

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
  $("filtroAnoPoleras").disabled = true;
  $("filtroDestinoPoleras").disabled = true;
  $("filtroDesdePoleras").disabled = true;
  $("filtroHastaPoleras").disabled = true;
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

          const resumen = resumirPolerasGrupo(
            datos,
            docId,
            inscripciones
          );

          return {
            ...resumen,

            /*
              N.º negocio y ID grupo son diferentes.
              docId sigue siendo la referencia real
              para abrir el detalle.
            */
            numeroNegocio: datos.numeroNegocio,
            idGrupo: datos.idGrupo,
            docId,
            fechaInicio: datos.fechaInicio,
            destino: datos.destinoPoleras
          };
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

    const sinFecha = resultados.filter(
      (grupo) => !grupo.fechaInicio
    ).length;

    $("estadoPoleras").textContent =
      `Consulta completa: ${resultados.length} grupos con polera` +
      (
        sinFecha
          ? ` · ${sinFecha} sin fecha de salida`
          : ""
      ) +
      ".";

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
    $("filtroAnoPoleras").disabled = false;
    $("filtroDestinoPoleras").disabled = false;
    $("filtroDesdePoleras").disabled = false;
    $("filtroHastaPoleras").disabled = false;
  }
}

function renderConsolidadoPoleras() {
  const totales = totalesPoleras(
    estado.resultados
  );

  $("totalesPoleras").innerHTML = `
    <div class="totales">
      <span>Grupos con polera:
        <strong>${totales.grupos}</strong>
      </span>

      <span>Participantes:
        <strong>${totales.totalPersonas}</strong>
      </span>

      <span>Con talla:
        <strong>${totales.conTalla}</strong>
      </span>

      <span>Sin talla:
        <strong>${totales.sinTalla}</strong>
      </span>
    </div>

    <div class="tallas">
      ${htmlResumenTallas(totales.tallas)}
    </div>
  `;

  $("tablaPoleras").innerHTML =
    estado.resultados.length
      ? estado.resultados.map((grupo) => `
          <tr>
            <td>${escapeHtml(
              mostrarFechaPoleras(grupo.fechaInicio)
            )}</td>

            <td>${escapeHtml(
              grupo.numeroNegocio || "—"
            )}</td>

            <td>${escapeHtml(
              grupo.idGrupo || "—"
            )}</td>

            <td>${escapeHtml(grupo.nombre)}</td>
            <td>${escapeHtml(grupo.destino)}</td>

            <td>${grupo.totalPersonas}</td>
            <td>${grupo.conTalla}</td>
            <td>${grupo.sinTalla}</td>

            ${TALLAS_POLERAS.map((talla) => `
              <td>${grupo.tallas[talla]}</td>
            `).join("")}

            <td>
              <a href="gestion-fichas-medicas.html?id=${
                encodeURIComponent(grupo.docId)
              }">
                Ver grupo
              </a>
            </td>
          </tr>
        `).join("")
      : `
        <tr>
          <td colspan="17">
            No hay grupos con polera para los filtros seleccionados.
          </td>
        </tr>
      `;

  $("resultadoPoleras").hidden = false;
}

function mostrarFechaPoleras(iso) {
  if (!iso) return "Sin fecha";

  const partes = String(iso).split("-");

  if (partes.length !== 3) {
    return "Sin fecha";
  }

  return `${partes[2]}-${partes[1]}-${partes[0]}`;
}

function imprimirConsolidadoPoleras() {
  if (
    !estado.resultados.length ||
    !estado.filtrosConsultados
  ) {
    return;
  }

  const totales = totalesPoleras(
    estado.resultados
  );

  const consultados =
    estado.filtrosConsultados;

  const filtros = [
    consultados.ano &&
      `Año ${consultados.ano}`,

    consultados.destino,

    consultados.desde &&
      `Desde ${mostrarFechaPoleras(
        consultados.desde
      )}`,

    consultados.hasta &&
      `Hasta ${mostrarFechaPoleras(
        consultados.hasta
      )}`
  ].filter(Boolean).join(" · ");

  const sinFecha = estado.resultados.filter(
    (grupo) => !grupo.fechaInicio
  ).length;

  const contenido = `
    <h1>Consolidado de poleras</h1>

    <p class="poleras-subtitulo">
      ${escapeHtml(filtros)}
    </p>

    <div class="poleras-indicadores">
      <span>Grupos:
        <strong>${totales.grupos}</strong>
      </span>

      <span>Participantes:
        <strong>${totales.totalPersonas}</strong>
      </span>

      <span>Con talla:
        <strong>${totales.conTalla}</strong>
      </span>

      <span>Sin talla:
        <strong>${totales.sinTalla}</strong>
      </span>

      ${
        sinFecha
          ? `<span>Grupos sin fecha:
               <strong>${sinFecha}</strong>
             </span>`
          : ""
      }
    </div>

    <div class="poleras-tallas">
      ${htmlResumenTallas(totales.tallas)}
    </div>

    <h2>Desglose por grupo</h2>

    <table>
      <thead>
        <tr>
          <th>Salida</th>
          <th>N.º negocio</th>
          <th>ID grupo</th>
          <th>Grupo</th>
          <th>Destino</th>
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
            <td>${escapeHtml(
              mostrarFechaPoleras(grupo.fechaInicio)
            )}</td>

            <td>${escapeHtml(
              grupo.numeroNegocio || "—"
            )}</td>

            <td>${escapeHtml(
              grupo.idGrupo || "—"
            )}</td>

            <td>${escapeHtml(grupo.nombre)}</td>
            <td>${escapeHtml(grupo.destino)}</td>
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
    contenido,
    horizontal: true
  });
}
