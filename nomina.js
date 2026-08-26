import { initializeApp } from "https://www.gstatic.com/firebasejs/11.7.3/firebase-app.js";
import {
  getFirestore,
  doc,
  getDoc,
  collection,
  getDocs,
  query,
  where
} from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAdx9nVcV-UiGER3mcz-w9BcSSIZd-t5nE",
  authDomain: "sist-op-rt.firebaseapp.com",
  projectId: "sist-op-rt",
  storageBucket: "sist-op-rt.firebasestorage.app",
  messagingSenderId: "438607695630",
  appId: "1:438607695630:web:f5a16f319e3ea17fbfd15f"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const $ = (id) => document.getElementById(id);



init();

async function init() {
  try {
    const params = new URLSearchParams(location.search);
    const token = String(params.get("t") || "").trim();

    if (!token) {
      renderError("Link inválido. Falta el token de acceso.");
      return;
    }

    const tokenSnap = await getDoc(
      doc(db, "nominas_publicas", token)
    );

    if (!tokenSnap.exists()) {
      renderError(
        "La nómina no existe o el link fue reemplazado."
      );
      return;
    }

    const tokenData =
      tokenSnap.data() || {};

    if (tokenData.activo === false) {
      renderError(
        "Esta nómina ya no está activa."
      );
      return;
    }

    const groupDocId =
      String(
        tokenData.groupDocId || ""
      ).trim();

    if (!groupDocId) {
      renderError(
        "El link no tiene grupo asociado."
      );
      return;
    }

    const grupoSnap = await getDoc(
      doc(
        db,
        "ventas_cotizaciones",
        groupDocId
      )
    );

    if (!grupoSnap.exists()) {
      renderError(
        "No fue posible encontrar el grupo asociado a esta nómina."
      );
      return;
    }

    const grupo =
      grupoSnap.data() || {};

    // ============================================================
    // 1. VISTA LIVIANA OFICIAL
    //
    // IMPORTANTE:
    // NO descargamos las fichas completas.
    //
    // Esta misma colección es la que grupo.js usa
    // para mostrar la nómina sin descargar información
    // médica/personal completa.
    // ============================================================

    const resumenSnap =
      await getDocs(
        collection(
          db,
          "ventas_cotizaciones",
          groupDocId,
          "nomina_resumen"
        )
      );

    const oficiales =
      resumenSnap.docs
        .map((d) => ({
          id: d.id,
          fuente: "oficial",
          ...d.data()
        }))
        .filter((item) => {
          const privacidad =
            normalizarClaveMonitor(
              item?.privacidad?.estado ||
              ""
            );

          return (
            privacidad !==
              "eliminada_logica" &&
            privacidad !==
              "archivada"
          );
        });

    // ============================================================
    // 2. FORMULARIOS PÚBLICOS
    //
    // Solamente sirven como respaldo de solicitudes
    // todavía no reflejadas en nomina_resumen.
    // ============================================================

    const pendientesSnap =
      await getDocs(
        query(
          collection(
            db,
            "inscripciones_pendientes_publicas"
          ),
          where(
            "idGrupo",
            "==",
            groupDocId
          )
        )
      );

    const pendientes =
      pendientesSnap.docs
        .map((d) => ({
          id: d.id,
          fuente:
            "formulario_publico",
          ...d.data()
        }))
        .filter((item) => {
          const payload =
            item.payload || {};

          const estadoDocumento =
            normalizarClaveMonitor(
              item.estado || ""
            );

          const estadoPrivacidad =
            normalizarClaveMonitor(
              payload?.privacidad
                ?.estado ||
              ""
            );

          return (
            estadoDocumento !==
              "eliminada_logica" &&
            estadoPrivacidad !==
              "eliminada_logica" &&
            estadoPrivacidad !==
              "archivada"
          );
        });

    // ============================================================
    // 3. CONSTRUIR MONITOR
    // ============================================================

    const resultado =
      construirMonitorNomina({
        oficiales,
        pendientes
      });

    let pasajeros =
      resultado.pasajeros;

    let fichasMedicasPendientes =
      resultado
        .fichasMedicasPendientes;

    // ============================================================
    // RESPALDO PARA LINKS ANTIGUOS
    // ============================================================

    if (
      !pasajeros.length &&
      !fichasMedicasPendientes.length &&
      Array.isArray(
        tokenData.pasajeros
      )
    ) {
      pasajeros =
        tokenData.pasajeros
          .map((p) => ({
            nombre:
              p.nombre || "",

            fechaInscripcion:
              p.fechaInscripcion ||
              "—",

            fechaOrden: 0,

            categoria:
              "base",

            etiqueta: ""
          }))
          .filter(
            (p) => p.nombre
          );
    }

    renderNomina({
      ...tokenData,

      colegio:
        grupo.colegio ||
        tokenData.colegio ||
        "",

      curso:
        grupo.curso ||
        tokenData.curso ||
        "",

      anoViaje:
        grupo.anoViaje ||
        tokenData.anoViaje ||
        "",

      destino:
        grupo.destinoPrincipal ||
        grupo.destino ||
        tokenData.destino ||
        "",

      nombreGrupo:
        grupo.aliasGrupo ||
        grupo.nombreGrupo ||
        grupo.colegio ||
        tokenData.nombreGrupo ||
        "Nómina del grupo",

      pasajeros,

      fichasMedicasPendientes
    });

  } catch (error) {
    console.error(
      "[nomina pública]",
      error
    );

    renderError(
      "Ocurrió un error al cargar la nómina."
    );
  }
}

function renderNomina(data = {}) {
  $("tituloNomina").textContent =
    String(
      data.nombreGrupo ||
      "Nómina del grupo"
    ).toUpperCase();

  $("subtituloNomina").textContent = [
    data.colegio,
    data.curso,
    data.anoViaje
      ? `Año ${data.anoViaje}`
      : "",
    data.destino
  ]
    .filter(Boolean)
    .join(" · ");

  $("datosGrupoNomina").innerHTML = `
    <div class="info-box">
      <div class="label">Colegio</div>
      <div class="value">
        ${escapeHtml(data.colegio || "—")}
      </div>
    </div>

    <div class="info-box">
      <div class="label">Curso</div>
      <div class="value">
        ${escapeHtml(data.curso || "—")}
      </div>
    </div>

    <div class="info-box">
      <div class="label">Año viaje</div>
      <div class="value">
        ${escapeHtml(data.anoViaje || "—")}
      </div>
    </div>
  `;

  const pasajeros =
    Array.isArray(data.pasajeros)
      ? data.pasajeros
      : [];

  // ============================================================
  // TABLA PRINCIPAL
  // ============================================================

  $("tablaNominaPublica").innerHTML =
    pasajeros.length
      ? pasajeros
          .map((p, i) => {

            const etiqueta = p.etiqueta
              ? `
                <div style="
                  margin-top:3px;
                  font-size:11px;
                  font-weight:700;
                  color:${getColorEtiquetaPublica(p.categoria)};
                ">
                  ${escapeHtml(p.etiqueta)}
                </div>
              `
              : "";

            return `
              <tr>
                <td style="text-align:center;">
                  ${i + 1}
                </td>

                <td>
                  <div style="font-weight:700;">
                    ${escapeHtml(
                      String(
                        p.nombre || ""
                      ).toUpperCase()
                    )}
                  </div>

                  ${etiqueta}
                </td>

                <td>
                  ${escapeHtml(
                    p.fechaInscripcion || "—"
                  )}
                </td>
              </tr>
            `;
          })
          .join("")
      : `
        <tr>
          <td colspan="3">
            No hay pasajeros inscritos actualmente.
          </td>
        </tr>
      `;

  // ============================================================
  // FICHAS MÉDICAS PENDIENTES
  // ============================================================

  renderFichasMedicasPendientes(
    data.fichasMedicasPendientes || []
  );
}

function construirMonitorNomina({
  oficiales = [],
  pendientes = []
} = {}) {

  // ============================================================
  // NORMALIZAR LA NÓMINA OFICIAL
  // ============================================================

  const registrosOficiales =
    oficiales
      .map((item) =>
        normalizarRegistroMonitor(
          item
        )
      )
      .filter(Boolean);

  // ============================================================
  // ÍNDICE DE PERSONAS QUE YA EXISTEN EN OFICIAL
  // ============================================================

  const oficialesPorPersona =
    new Map();

  registrosOficiales.forEach(
    (registro) => {
      if (!registro.identidadKey) {
        return;
      }

      oficialesPorPersona.set(
        registro.identidadKey,
        registro
      );
    }
  );

  // ============================================================
  // NORMALIZAR FORMULARIOS PÚBLICOS
  // ============================================================

  const registrosPublicos =
    pendientes
      .map((item) =>
        normalizarRegistroMonitor(
          item
        )
      )
      .filter(Boolean);

  // ============================================================
  // SOLAMENTE UTILIZAMOS UN FORMULARIO PÚBLICO
  // SI TODAVÍA NO EXISTE ESA PERSONA EN LA VISTA OFICIAL.
  //
  // Si ya existe en nomina_resumen:
  // MANDA SIEMPRE nomina_resumen.
  // ============================================================

  const publicosSinOficial =
    registrosPublicos.filter(
      (registro) =>
        !oficialesPorPersona.has(
          registro.identidadKey
        )
    );

  // ============================================================
  // RESULTADO PRINCIPAL
  // ============================================================

  const pasajeros = [];

  // ============================================================
  // 1. PROCESAR OFICIALES
  // ============================================================

  registrosOficiales.forEach(
    (registro) => {

      // ----------------------------------------------------------
      // ANULADOS:
      // NO aparecen en ninguna parte del monitor público.
      // ----------------------------------------------------------

      if (registro.anulado) {
        return;
      }

      // ----------------------------------------------------------
      // SISTEMA DE PAGOS + FICHA PENDIENTE:
      //
      // NO aparece en la tabla principal.
      // Se mostrará abajo, en el bloque especial.
      // ----------------------------------------------------------

      if (
        registro.tipo ===
          "sistema_pagos" &&
        fichaMedicaPendienteMonitor(
          registro.raw
        )
      ) {
        return;
      }

      pasajeros.push(
        registro
      );
    }
  );

  // ============================================================
  // 2. PROCESAR FORMULARIOS TODAVÍA NO OFICIALIZADOS
  //
  // Solo queremos:
  // - Nuevo ingreso
  // - Lista de espera
  // - Liberado
  //
  // No queremos reconstruir una nómina base completa
  // desde formularios históricos.
  // ============================================================

  publicosSinOficial.forEach(
    (registro) => {

      if (registro.anulado) {
        return;
      }

      if (
        registro.categoria !==
          "nuevo_ingreso" &&
        registro.categoria !==
          "lista_espera" &&
        registro.categoria !==
          "liberado"
      ) {
        return;
      }

      pasajeros.push(
        registro
      );
    }
  );

  // ============================================================
  // DEDUPLICAR RESULTADO
  // ============================================================

  const pasajerosUnicos =
    deduplicarRegistrosMonitor(
      pasajeros
    );

  // ============================================================
  // ORDEN PÚBLICO
  //
  // 1. Nuevo ingreso
  // 2. Nómina base
  // 3. Liberados
  // 4. Lista de espera
  // ============================================================

  pasajerosUnicos.sort(
    (a, b) => {

      const ordenCategoria = {
        nuevo_ingreso: 1,
        base: 2,
        liberado: 3,
        lista_espera: 4
      };

      const ordenA =
        ordenCategoria[
          a.categoria
        ] || 99;

      const ordenB =
        ordenCategoria[
          b.categoria
        ] || 99;

      if (ordenA !== ordenB) {
        return (
          ordenA - ordenB
        );
      }

      // Nuevas incorporaciones:
      // más nuevas primero.
      if (
        a.categoria ===
          "nuevo_ingreso"
      ) {
        return (
          b.fechaOrden -
          a.fechaOrden
        );
      }

      // Lista de espera:
      // dejamos los movimientos recientes
      // más abajo pero internamente ordenados
      // cronológicamente.
      return (
        a.fechaOrden -
        b.fechaOrden
      );
    }
  );

  // ============================================================
  // FICHAS MÉDICAS PENDIENTES
  // ============================================================

  const fichasMedicasPendientes =
    construirPendientesFichaMedica(
      oficiales
    );

  return {
    pasajeros:
      pasajerosUnicos,

    fichasMedicasPendientes
  };
}

function deduplicarRegistrosMonitor(
  lista = []
) {
  const map =
    new Map();

  lista.forEach(
    (registro) => {

      const key =
        registro.identidadKey ||
        registro.rutKey ||
        normalizarNombreParaComparar(
          registro.nombre
        );

      if (!key) {
        return;
      }

      const anterior =
        map.get(key);

      if (!anterior) {
        map.set(
          key,
          registro
        );

        return;
      }

      // Si por alguna razón llegan dos,
      // conservamos el más reciente.
      if (
        registro.fechaOrden >
        anterior.fechaOrden
      ) {
        map.set(
          key,
          registro
        );
      }
    }
  );

  return Array.from(
    map.values()
  );
}

function normalizarRegistroMonitor(item = {}) {
  const esFormularioPublico =
    item.fuente === "formulario_publico";

  const data =
    esFormularioPublico
      ? (item.payload || {})
      : item;

  const nombre =
    getNombrePublicoInscripcion(data);

  const rutKey =
    getRutKeyInscripcion(data);

  const identidadKey =
    rutKey ||
    normalizarNombreParaComparar(
      nombre
    );

  if (!identidadKey) {
    return null;
  }

  const fechaOriginal =
    getFechaFormularioInscripcion(
      data
    ) ||
    item.creadoEn ||
    item.actualizadoAt ||
    "";

  const tipo =
    getTipoInscripcionMonitor(
      data
    );

  const estadoCupo =
    getEstadoCupoMonitor(
      data,
      item
    );

  const anulado =
    estaAnuladoMonitor(
      data
    );

  const categoria =
    getCategoriaPublicaMonitor({
      tipo,
      estadoCupo
    });

  return {
    id: item.id || "",
    fuente: item.fuente || "",

    nombre,
    rutKey,
    identidadKey,

    tipo,
    estadoCupo,
    categoria,

    anulado,

    fechaInscripcion:
      formatPublicDateTime(
        fechaOriginal
      ),

    fechaOrden:
      getPublicDateTimeMs(
        fechaOriginal
      ),

    etiqueta:
      getEtiquetaPublicaMonitor({
        tipo,
        estadoCupo,
        categoria
      }),

    raw: data
  };
}

function getTipoInscripcionMonitor(item = {}) {
  const raw = cleanText(
    item.tipoInscripcion ||
    item.estadoInscripcion ||
    item.contextoFormulario ||
    item.faseInscripcion ||
    ""
  );

  const key =
    normalizarClaveMonitor(raw);

  if (
    key === "inscripcion_inicial" ||
    key === "nomina_inicial" ||
    key === "normal"
  ) {
    return "nomina_inicial";
  }

  if (
    key === "sistema_de_pagos" ||
    key === "sistema_pagos"
  ) {
    return "sistema_pagos";
  }

  if (
    key === "nuevo_ingreso" ||
    key === "nuevos"
  ) {
    return "nuevo_ingreso";
  }

  if (
    key === "nuevo_ingreso_confirmado"
  ) {
    return "nuevo_ingreso_confirmado";
  }

  if (
    key === "lista_espera"
  ) {
    return "lista_espera";
  }

  if (
    key === "lista_espera_pagada"
  ) {
    return "lista_espera_pagada";
  }

  if (
    key === "lista_espera_confirmada"
  ) {
    return "lista_espera_confirmada";
  }

  if (
    key === "liberado" ||
    key === "cupo_liberado"
  ) {
    return "liberado";
  }

  if (
    key === "nomina_final"
  ) {
    return "nomina_final";
  }

  return key || "nomina_inicial";
}

function getEstadoCupoMonitor(
  data = {},
  registroExterior = {}
) {
  const tipo =
    getTipoInscripcionMonitor(
      data
    );

  // ============================================================
  // TIPO EXPLÍCITO TIENE PRIORIDAD
  // ============================================================

  if (
    tipo ===
    "lista_espera_confirmada"
  ) {
    return "confirmado";
  }

  if (
    tipo ===
    "lista_espera_pagada"
  ) {
    return "pagado";
  }

  if (
    tipo ===
    "nuevo_ingreso_confirmado"
  ) {
    return "confirmado";
  }

  // ============================================================
  // ESTADO DE CUPO REAL
  // ============================================================

  const estadoCupo =
    normalizarClaveMonitor(
      data.estadoCupo ||
      registroExterior.estadoCupo ||
      ""
    );

  if (
    estadoCupo ===
    "confirmado"
  ) {
    return "confirmado";
  }

  if (
    estadoCupo ===
    "pagado"
  ) {
    return "pagado";
  }

  // ============================================================
  // ESTADO ADMINISTRATIVO DEL FORMULARIO PÚBLICO
  // ============================================================

  const estadoExterior =
    normalizarClaveMonitor(
      registroExterior.estado ||
      ""
    );

  if (
    estadoExterior ===
      "confirmada" ||
    estadoExterior ===
      "confirmado"
  ) {
    return "confirmado";
  }

  if (
    estadoExterior ===
      "pagada" ||
    estadoExterior ===
      "pagado"
  ) {
    return "pagado";
  }

  // ============================================================
  // DEFAULT
  // ============================================================

  if (
    tipo ===
    "lista_espera"
  ) {
    return "pendiente";
  }

  if (
    tipo ===
    "nuevo_ingreso"
  ) {
    return "pendiente_confirmacion";
  }

  return estadoCupo;
}

function getCategoriaPublicaMonitor({
  tipo = "",
  estadoCupo = ""
} = {}) {

  if (
    tipo === "nuevo_ingreso" ||
    tipo === "nuevo_ingreso_confirmado"
  ) {
    return "nuevo_ingreso";
  }

  if (
    tipo === "lista_espera" ||
    tipo === "lista_espera_pagada" ||
    tipo === "lista_espera_confirmada"
  ) {
    return "lista_espera";
  }

  if (tipo === "liberado") {
    return "liberado";
  }

  return "base";
}

function getEtiquetaPublicaMonitor({
  tipo = "",
  estadoCupo = "",
  categoria = ""
} = {}) {

  if (
    categoria === "nuevo_ingreso"
  ) {
    return "INSCRITO POSTERIOR A LA NÓMINA INICIAL";
  }

  if (
    categoria === "liberado"
  ) {
    return "CUPO LIBERADO";
  }

  if (
    categoria === "lista_espera"
  ) {
    const confirmado =
      tipo ===
        "lista_espera_confirmada" ||
      estadoCupo === "confirmado";

    if (confirmado) {
      return "LISTA DE ESPERA · CUPO CONFIRMADO";
    }

    return "LISTA DE ESPERA · CUPO PENDIENTE";
  }

  return "";
}

function estaAnuladoMonitor(
  item = {}
) {
  const estadoViaje =
    normalizarClaveMonitor(
      item.estadoViaje ||
      item?.sistemaPagos
        ?.estadoViaje ||
      ""
    );

  const estadoGeneral =
    normalizarClaveMonitor(
      item.estado ||
      item?.sistemaPagos
        ?.estado ||
      ""
    );

  const privacidadEstado =
    normalizarClaveMonitor(
      item?.privacidad
        ?.estado ||
      ""
    );

  const sistemaPagosViaja =
    item?.sistemaPagos
      ?.viaja;

  return (
    item.anulado === true ||
    item.anulada === true ||
    item.viaja === false ||
    sistemaPagosViaja === false ||

    estadoViaje ===
      "anulado" ||
    estadoViaje ===
      "anulada" ||
    estadoViaje ===
      "no_viaja" ||
    estadoViaje ===
      "eliminado_en_sp" ||

    estadoGeneral ===
      "anulado" ||
    estadoGeneral ===
      "anulada" ||
    estadoGeneral ===
      "no_viaja" ||
    estadoGeneral ===
      "eliminado_en_sp" ||

    privacidadEstado ===
      "archivada" ||
    privacidadEstado ===
      "eliminada_logica"
  );
}

function esIncorporacionPosteriorVisible(
  registro = {}
) {
  return (
    registro.categoria ===
      "nuevo_ingreso" ||
    registro.categoria ===
      "lista_espera"
  );
}

function elegirRegistroPublicoPersona(
  historial = []
) {
  if (!historial.length) {
    return null;
  }

  const activos =
    historial.filter(
      (registro) =>
        !registro.anulado
    );

  if (!activos.length) {
    return null;
  }

  return [...activos]
    .sort(
      (a, b) =>
        b.fechaOrden -
        a.fechaOrden
    )[0];
}

function construirPendientesFichaMedica(
  oficiales = []
) {
  const lista =
    oficiales
      .filter((item) => {

        const tipo =
          getTipoInscripcionMonitor(
            item
          );

        // --------------------------------------------------------
        // SOLAMENTE SISTEMA DE PAGOS
        // --------------------------------------------------------

        if (
          tipo !==
          "sistema_pagos"
        ) {
          return false;
        }

        // --------------------------------------------------------
        // ANULADOS NO APARECEN
        // --------------------------------------------------------

        if (
          estaAnuladoMonitor(
            item
          )
        ) {
          return false;
        }

        // --------------------------------------------------------
        // SOLAMENTE FICHA REALMENTE PENDIENTE
        // --------------------------------------------------------

        return (
          fichaMedicaPendienteMonitor(
            item
          )
        );
      })
      .map((item) => {

        const nombre =
          getNombrePublicoInscripcion(
            item
          );

        const rutKey =
          getRutKeyInscripcion(
            item
          );

        return {
          nombre,

          rutKey,

          identidadKey:
            rutKey ||
            normalizarNombreParaComparar(
              nombre
            )
        };
      })
      .filter(
        (item) =>
          item.nombre
      );

  return (
    deduplicarPorIdentidadMonitor(
      lista
    )
      .sort(
        (a, b) =>
          a.nombre.localeCompare(
            b.nombre,
            "es",
            {
              sensitivity:
                "base"
            }
          )
      )
  );
}

function fichaMedicaPendienteMonitor(
  item = {}
) {
  if (
    estaAnuladoMonitor(
      item
    )
  ) {
    return false;
  }

  const tipo =
    getTipoInscripcionMonitor(
      item
    );

  if (
    tipo !==
    "sistema_pagos"
  ) {
    return false;
  }

  return !(
    item.fichaMedicaCompleta ===
      true ||

    item.nominaFinalCompleta ===
      true ||

    item.fichaMedicaCompletada ===
      true ||

    item.nominaFinalCompletada ===
      true ||

    normalizarClaveMonitor(
      item.fichaMedicaEstado
    ) === "completa" ||

    normalizarClaveMonitor(
      item.fichaMedicaEstado
    ) === "completada"
  );
}

function renderFichasMedicasPendientes(
  lista = []
) {
  const tabla =
    $("tablaNominaPublica");

  if (!tabla) return;

  const tablaContenedor =
    tabla.closest("table");

  if (!tablaContenedor) {
    return;
  }

  let bloque =
    $("bloqueFichasMedicasPendientes");

  // Si no hay pendientes, eliminamos el bloque.
  if (!lista.length) {
    bloque?.remove();
    return;
  }

  if (!bloque) {
    bloque =
      document.createElement(
        "section"
      );

    bloque.id =
      "bloqueFichasMedicasPendientes";

    bloque.style.marginTop =
      "28px";

    tablaContenedor.insertAdjacentElement(
      "afterend",
      bloque
    );
  }

  bloque.innerHTML = `
    <div style="
      padding:18px 20px;
      border-radius:12px;
      background:#fff8e8;
      border:1px solid #f0d58a;
    ">

      <div style="
        font-size:18px;
        font-weight:800;
        margin-bottom:5px;
      ">
        Pendientes de completar ficha médica
      </div>

      <div style="
        color:#64748b;
        font-size:13px;
        margin-bottom:14px;
      ">
        ${lista.length}
        ${
          lista.length === 1
            ? "pasajero tiene"
            : "pasajeros tienen"
        }
        pendiente completar su ficha médica.
      </div>

      <div>
        ${lista
          .map(
            (p, i) => `
              <div style="
                display:flex;
                gap:10px;
                padding:8px 0;
                border-top:
                  ${
                    i === 0
                      ? "0"
                      : "1px solid rgba(0,0,0,.08)"
                  };
              ">
                <div style="
                  width:24px;
                  color:#64748b;
                  font-weight:700;
                ">
                  ${i + 1}.
                </div>

                <div style="
                  font-weight:700;
                ">
                  ${escapeHtml(
                    String(
                      p.nombre || ""
                    ).toUpperCase()
                  )}
                </div>
              </div>
            `
          )
          .join("")}
      </div>

    </div>
  `;
}

function getNombrePublicoInscripcion(item = {}) {
  const identificacion = item.identificacion || {};

  const nombreCompleto = [
    identificacion.nombres || item.nombres,
    identificacion.primerApellido || item.primerApellido,
    identificacion.segundoApellido || item.segundoApellido
  ].filter(Boolean).join(" ");

  return cleanText(
    nombreCompleto ||
    identificacion.nombreCompleto ||
    item.nombreCompleto ||
    item.nombre ||
    item.pasajero ||
    ""
  );
}

function getFechaFormularioInscripcion(item = {}) {
  return (
    item?.meta?.fechaInscripcion ||
    item?.meta?.fechaFormularioCliente ||
    item?.fechaInscripcion ||
    item?.fechaFormularioCliente ||
    item?.creadoEn ||
    item?.createdAt ||
    item?.fechaCreacion ||
    item?.fechaAprobacion ||
    ""
  );
}

function formatPublicDateTime(value) {
  const d = toDate(value);
  if (!d) return "—";

  return d.toLocaleString("es-CL", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function getPublicDateTimeMs(value) {
  const d = toDate(value);
  return d ? d.getTime() : 0;
}

function toDate(value) {
  if (!value) return null;
  if (value?.toDate) return value.toDate();
  if (value instanceof Date) return value;

  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function renderError(msg) {
  $("tituloNomina").textContent = "No fue posible cargar la nómina";
  $("subtituloNomina").textContent = msg;
  $("datosGrupoNomina").innerHTML = "";
  $("tablaNominaPublica").innerHTML = "";
}

function cleanText(value = "") {
  return String(value ?? "").trim();
}

function deduplicarPasajeros(lista = []) {
  const map = new Map();

  lista.forEach((p) => {
    // Primero intenta deduplicar por RUT/documento.
    // Si no tiene RUT, usa nombre normalizado como respaldo.
    const key = p.rutKey || normalizarNombreParaComparar(p.nombre);

    if (!key) return;

    const existente = map.get(key);

    // Si ya existe, conserva el registro más reciente.
    if (!existente || p.fechaOrden > existente.fechaOrden) {
      map.set(key, p);
    }
  });

  return Array.from(map.values());
}

function getRutKeyInscripcion(item = {}) {
  const identificacion = item.identificacion || {};

  const documento =
    identificacion.documentoNormalizado ||
    identificacion.rut ||
    identificacion.documento ||
    [
      identificacion.rutNumero,
      identificacion.rutDv
    ].filter(Boolean).join("-") ||
    item.documentoNormalizado ||
    item.rut ||
    item.documento ||
    "";

  return normalizarRutKey(documento);
}

function normalizarRutKey(value = "") {
  return String(value || "")
    .toUpperCase()
    .replace(/\./g, "")
    .replace(/-/g, "")
    .replace(/\s+/g, "")
    .trim();
}

function normalizarNombreParaComparar(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")       // elimina tildes
    .replace(/[\u200B-\u200D\uFEFF]/g, "") // elimina caracteres invisibles
    .replace(/[^\p{L}\p{N}]+/gu, " ")      // cualquier separador pasa a espacio
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

function escapeHtml(value = "") {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizarClaveMonitor(
  value = ""
) {
  return String(value || "")
    .normalize("NFD")
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "_");
}

function deduplicarPorIdentidadMonitor(
  lista = []
) {
  const map = new Map();

  lista.forEach((item) => {
    const key =
      item.identidadKey ||
      item.rutKey ||
      normalizarNombreParaComparar(
        item.nombre
      );

    if (!key) return;

    if (!map.has(key)) {
      map.set(key, item);
    }
  });

  return Array.from(
    map.values()
  );
}

function getColorEtiquetaPublica(
  categoria = ""
) {
  if (
    categoria === "nuevo_ingreso"
  ) {
    return "#6d28d9";
  }

  if (
    categoria === "liberado"
  ) {
    return "#0369a1";
  }

  if (
    categoria === "lista_espera"
  ) {
    return "#a16207";
  }

  return "#64748b";
}
