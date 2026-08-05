import {
  auth,
  db,
  normalizeEmail,
  getVentasUser
} from "./firebase-init.js";

import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch
} from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";

import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/11.7.3/firebase-auth.js";

import {
  ACTING_USER_KEY,
  getEffectiveUser,
  getRealUser
} from "./roles.js";

import {
  bindLayoutButtons,
  waitForLayoutReady
} from "./ui.js";

import {
  crearInscripcionesManager,
  camposPasajero
} from "./inscripciones-manager.js";

const $ = (id) =>
  document.getElementById(id);

const LOTES_COLLECTION =
  "ventas_pulseras_nfc_lotes";

const state = {
  realUser: null,
  user: null,
  email: "",
  manager: null,

  grupoCtx: null,
  nomina: [],
  pasajerosViajan: [],

  loteId: "",
  lote: null,
  pulseras: [],

  unsubscribeLote: null,
  unsubscribePulseras: null,

  procesando: false
};

init();

async function init() {
  await waitForLayoutReady();

  bindEvents();

  onAuthStateChanged(
    auth,
    async (firebaseUser) => {
      if (!firebaseUser) {
        location.href = "login.html";
        return;
      }

      await bootstrap();
      bindHeader();
      await cargarDesdeUrl();
    }
  );
}

async function bootstrap() {
  state.realUser =
    getRealUser();

  state.user =
    getEffectiveUser();

  const resolved =
    getVentasUser(
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

  state.email =
    normalizeEmail(
      state.user?.email ||
      auth.currentUser?.email ||
      ""
    );

  state.manager =
    crearInscripcionesManager({
      db,
      usuario: state.user
    });
}

function bindHeader() {
  bindLayoutButtons({
    homeUrl: "index.html",

    onLogout: async () => {
      sessionStorage.removeItem(
        ACTING_USER_KEY
      );

      await signOut(auth);

      location.href =
        "login.html";
    }
  });
}

function bindEvents() {
  $("btnVolverNomina")
    ?.addEventListener(
      "click",
      () => {
        location.href =
          "gestion-nomina.html";
      }
    );

  $("btnCargarGrupo")
    ?.addEventListener(
      "click",
      cargarGrupoDesdeInput
    );

  $("inputGrupo")
    ?.addEventListener(
      "keydown",
      (event) => {
        if (
          event.key === "Enter"
        ) {
          cargarGrupoDesdeInput();
        }
      }
    );

  $("modalidadLote")
    ?.addEventListener(
      "change",
      () => {
        const grupal =
          $("modalidadLote")
            .value === "grupal";

        $("cantidadGrupal")
          .disabled =
          !grupal;

        if (grupal) {
          $("cantidadGrupal")
            .value =
            String(
              Math.max(
                1,
                state.pasajerosViajan.length
              )
            );
        }
      }
    );

  $("btnCrearLote")
    ?.addEventListener(
      "click",
      crearLote
    );

  $("btnCopiarEnlace")
    ?.addEventListener(
      "click",
      copiarEnlaceMovil
    );

  $("btnCompartirEnlace")
    ?.addEventListener(
      "click",
      compartirEnlaceMovil
    );

  $("btnAbrirMovil")
    ?.addEventListener(
      "click",
      abrirPaginaMovil
    );

  $("btnEliminarLote")
    ?.addEventListener(
      "click",
      anularLote
    );

  window.addEventListener(
    "beforeunload",
    detenerListeners
  );
}

async function cargarDesdeUrl() {
  const params =
    new URLSearchParams(
      location.search
    );

  const grupo =
    String(
      params.get("id") ||
      params.get("grupo") ||
      params.get("negocio") ||
      ""
    ).trim();

  if (!grupo) {
    return;
  }

  $("inputGrupo").value =
    grupo;

  await cargarGrupo(grupo);
}

async function cargarGrupoDesdeInput() {
  const valor =
    String(
      $("inputGrupo")
        ?.value ||
      ""
    ).trim();

  if (!valor) {
    setEstadoPrincipal(
      "Ingresa un número de negocio o ID de grupo.",
      true
    );

    return;
  }

  await cargarGrupo(valor);
}

async function cargarGrupo(valor) {
  if (
    state.procesando
  ) {
    return;
  }

  state.procesando =
    true;

  $("btnCargarGrupo")
    .disabled =
    true;

  detenerListeners();
  limpiarLoteActual();

  setEstadoPrincipal(
    "Cargando grupo y nómina..."
  );

  try {
    const grupoCtx =
      await state.manager
        .resolverGrupo(
          valor
        );

    if (!grupoCtx) {
      throw new Error(
        "No se encontró el grupo."
      );
    }

    const nomina =
      await state.manager
        .cargarNomina(
          grupoCtx
        );

    state.grupoCtx =
      grupoCtx;

    state.nomina =
      Array.isArray(nomina)
        ? nomina
        : [];

    state.pasajerosViajan =
      state.nomina
        .filter(
          esPasajeroQueViaja
        )
        .sort(
          ordenarPasajeros
        );

    renderGrupo();

    $("panelLote")
      .classList
      .remove("hidden");

    $("cantidadGrupal")
      .value =
      String(
        Math.max(
          1,
          state.pasajerosViajan.length
        )
      );

    setEstadoPrincipal(
      `Grupo cargado: ${state.pasajerosViajan.length} pasajero(s) que viajan.`,
      false,
      true
    );

    await buscarLoteActivo();
  } catch (error) {
    console.error(
      "[gestion-pulseras-nfc] cargarGrupo",
      error
    );

    state.grupoCtx =
      null;

    state.nomina =
      [];

    state.pasajerosViajan =
      [];

    $("grupoResumen")
      .classList
      .add("hidden");

    $("panelLote")
      .classList
      .add("hidden");

    setEstadoPrincipal(
      error.message ||
      "No se pudo cargar el grupo.",
      true
    );
  } finally {
    state.procesando =
      false;

    $("btnCargarGrupo")
      .disabled =
      false;
  }
}

async function buscarLoteActivo() {
  const numeroNegocio =
    getNumeroNegocio();

  if (!numeroNegocio) {
    return;
  }

  setEstadoLote(
    "Buscando lote activo..."
  );

  const snap =
    await getDocs(
      query(
        collection(
          db,
          LOTES_COLLECTION
        ),
        where(
          "numeroNegocio",
          "==",
          numeroNegocio
        ),
        where(
          "activo",
          "==",
          true
        ),
        limit(1)
      )
    );

  if (snap.empty) {
    $("panelLoteActivo")
      .classList
      .add("hidden");

    setEstadoLote(
      "No existe un lote activo para este grupo."
    );

    return;
  }

  const loteDoc =
    snap.docs[0];

  conectarLote(
    loteDoc.id
  );
}

async function crearLote() {
  if (
    !state.grupoCtx ||
    state.procesando
  ) {
    return;
  }

  const modalidad =
    $("modalidadLote")
      .value;

  if (
    modalidad === "individual" &&
    !state.pasajerosViajan.length
  ) {
    setEstadoLote(
      "No hay pasajeros que viajen para crear el lote.",
      true
    );

    return;
  }

  const cantidadGrupal =
    Math.max(
      1,
      Number(
        $("cantidadGrupal")
          .value ||
        1
      )
    );

  const mensaje =
    modalidad === "individual"
      ? `Se crearán ${state.pasajerosViajan.length} códigos individuales.`
      : `Se crearán ${cantidadGrupal} registros con un mismo código grupal.`;

  const ok =
    confirm(
      `${mensaje}\n\n` +
      "Si ya existe un lote activo para el grupo, debes anularlo antes.\n\n" +
      "¿Deseas continuar?"
    );

  if (!ok) {
    return;
  }

  state.procesando =
    true;

  $("btnCrearLote")
    .disabled =
    true;

  setEstadoLote(
    "Creando lote y códigos..."
  );

  try {
    const existe =
      await getDocs(
        query(
          collection(
            db,
            LOTES_COLLECTION
          ),
          where(
            "numeroNegocio",
            "==",
            getNumeroNegocio()
          ),
          where(
            "activo",
            "==",
            true
          ),
          limit(1)
        )
      );

    if (!existe.empty) {
      throw new Error(
        "Ya existe un lote activo para este grupo. Ábrelo o anúlalo antes de crear otro."
      );
    }

    const loteRef =
      doc(
        collection(
          db,
          LOTES_COLLECTION
        )
      );

    const pulseras =
      modalidad === "individual"
        ? generarPulserasIndividuales()
        : generarPulserasGrupales(
            cantidadGrupal
          );

    const grupoData =
      state.grupoCtx?.data ||
      {};

    const batch =
      writeBatch(db);

    batch.set(
      loteRef,
      {
        loteId:
          loteRef.id,

        groupDocId:
          state.grupoCtx.docId,

        idGrupo:
          state.grupoCtx.groupId,

        numeroNegocio:
          getNumeroNegocio(),

        anoViaje:
          Number(
            grupoData.anoViaje ||
            0
          ),

        aliasGrupo:
          grupoData.aliasGrupo ||
          grupoData.nombreGrupo ||
          "",

        colegio:
          grupoData.colegio ||
          grupoData.institucion ||
          "",

        curso:
          grupoData.curso ||
          "",

        destino:
          grupoData.destino ||
          "",

        modalidad,

        total:
          pulseras.length,

        grabadas:
          0,

        pendientes:
          pulseras.length,

        errores:
          0,

        estado:
          "PENDIENTE",

        activo:
          true,

        creadoAt:
          serverTimestamp(),

        creadoPor:
          nombreUsuario(),

        creadoPorCorreo:
          state.email,

        actualizadoAt:
          serverTimestamp()
      }
    );

    for (
      const pulsera
      of pulseras
    ) {
      const pulseraRef =
        doc(
          loteRef,
          "pulseras",
          pulsera.docId
        );

      batch.set(
        pulseraRef,
        {
          ...pulsera,

          loteId:
            loteRef.id,

          numeroNegocio:
            getNumeroNegocio(),

          groupDocId:
            state.grupoCtx.docId,

          idGrupo:
            state.grupoCtx.groupId,

          estado:
            "PENDIENTE",

          grabada:
            false,

          error:
            false,

          intentos:
            0,

          activo:
            true,

          creadoAt:
            serverTimestamp(),

          actualizadoAt:
            serverTimestamp()
        }
      );
    }

    await batch.commit();

    conectarLote(
      loteRef.id
    );

    setEstadoLote(
      "Lote creado correctamente. Ya puedes abrirlo en el celular.",
      false,
      true
    );
  } catch (error) {
    console.error(
      "[gestion-pulseras-nfc] crearLote",
      error
    );

    setEstadoLote(
      error.message ||
      "No se pudo crear el lote.",
      true
    );
  } finally {
    state.procesando =
      false;

    $("btnCrearLote")
      .disabled =
      false;
  }
}

function generarPulserasIndividuales() {
  return state.pasajerosViajan
    .map(
      (
        pasajero,
        index
      ) => {
        const numero =
          index + 1;

        const nombres =
          camposPasajero
            .nombres(
              pasajero
            );

        const apellidos =
          camposPasajero
            .apellidos(
              pasajero
            );

        const iniciales =
          obtenerIniciales(
            nombres,
            apellidos
          );

        const codigo =
          [
            limpiarParteCodigo(
              getNumeroNegocio()
            ),
            String(numero)
              .padStart(3, "0"),
            iniciales
          ].join("-");

        return {
          docId:
            `P${String(numero).padStart(3, "0")}`,

          numero,

          codigo,

          modalidad:
            "individual",

          inscripcionId:
            String(
              pasajero.id ||
              ""
            ),

          rut:
            camposPasajero
              .documento(
                pasajero
              ),

          nombres,

          apellidos,

          nombrePasajero:
            [
              nombres,
              apellidos
            ]
              .filter(Boolean)
              .join(" ")
              .trim()
        };
      }
    );
}

function generarPulserasGrupales(
  cantidad
) {
  const codigo =
    `${limpiarParteCodigo(
      getNumeroNegocio()
    )}-GRUPO`;

  return Array.from(
    {
      length:
        cantidad
    },
    (
      _,
      index
    ) => {
      const numero =
        index + 1;

      return {
        docId:
          `P${String(numero).padStart(3, "0")}`,

        numero,

        codigo,

        modalidad:
          "grupal",

        inscripcionId:
          "",

        rut:
          "",

        nombres:
          "",

        apellidos:
          "",

        nombrePasajero:
          `Pulsera grupal ${numero}`
      };
    }
  );
}

function conectarLote(
  loteId
) {
  detenerListeners();

  state.loteId =
    loteId;

  const loteRef =
    doc(
      db,
      LOTES_COLLECTION,
      loteId
    );

  state.unsubscribeLote =
    onSnapshot(
      loteRef,
      (
        snap
      ) => {
        if (!snap.exists()) {
          limpiarLoteActual();

          setEstadoLote(
            "El lote ya no existe.",
            true
          );

          return;
        }

        state.lote = {
          id:
            snap.id,
          ...snap.data()
        };

        renderLote();
      },
      (
        error
      ) => {
        console.error(
          "[gestion-pulseras-nfc] listener lote",
          error
        );

        setEstadoLote(
          "Se perdió la sincronización del lote.",
          true
        );
      }
    );

  state.unsubscribePulseras =
    onSnapshot(
      query(
        collection(
          loteRef,
          "pulseras"
        ),
        orderBy(
          "numero",
          "asc"
        )
      ),
      (
        snap
      ) => {
        state.pulseras =
          snap.docs.map(
            (
              item
            ) => ({
              id:
                item.id,
              ...item.data()
            })
          );

        renderPulseras();
        renderKpisDesdePulseras();
      },
      (
        error
      ) => {
        console.error(
          "[gestion-pulseras-nfc] listener pulseras",
          error
        );

        setEstadoLote(
          "No se pudo sincronizar la lista de pulseras.",
          true
        );
      }
    );
}

async function anularLote() {
  if (
    !state.loteId ||
    !state.lote
  ) {
    return;
  }

  const ok =
    confirm(
      "El lote quedará anulado y ya no aparecerá como activo.\n\n" +
      "Los registros se conservarán para historial.\n\n" +
      "¿Deseas continuar?"
    );

  if (!ok) {
    return;
  }

  try {
    await updateDoc(
      doc(
        db,
        LOTES_COLLECTION,
        state.loteId
      ),
      {
        activo:
          false,

        estado:
          "ANULADO",

        anuladoAt:
          serverTimestamp(),

        anuladoPor:
          nombreUsuario(),

        anuladoPorCorreo:
          state.email,

        actualizadoAt:
          serverTimestamp()
      }
    );

    detenerListeners();
    limpiarLoteActual();

    setEstadoLote(
      "Lote anulado. Ahora puedes crear uno nuevo.",
      false,
      true
    );
  } catch (error) {
    console.error(
      "[gestion-pulseras-nfc] anularLote",
      error
    );

    setEstadoLote(
      error.message ||
      "No se pudo anular el lote.",
      true
    );
  }
}

function renderGrupo() {
  const data =
    state.grupoCtx?.data ||
    {};

  $("grupoNombre")
    .textContent =
    data.aliasGrupo ||
    data.nombreGrupo ||
    data.colegio ||
    "Grupo";

  $("grupoNegocio")
    .textContent =
    getNumeroNegocio() ||
    "—";

  $("grupoDestino")
    .textContent =
    data.destino ||
    "—";

  $("grupoViajan")
    .textContent =
    String(
      state.pasajerosViajan.length
    );

  $("grupoResumen")
    .classList
    .remove("hidden");
}

function renderLote() {
  if (
    !state.lote
  ) {
    return;
  }

  $("panelLoteActivo")
    .classList
    .remove("hidden");

  const url =
    obtenerUrlMovil();

  $("urlMovil")
    .textContent =
    url;

  $("btnEliminarLote")
    .disabled =
    state.lote.activo === false;

  setEstadoLote(
    "Sincronización activa. Los cambios realizados desde el celular aparecerán automáticamente.",
    false,
    true
  );
}

function renderPulseras() {
  const tbody =
    $("pulserasTbody");

  if (
    !state.pulseras.length
  ) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7">
          El lote no contiene pulseras.
        </td>
      </tr>
    `;

    return;
  }

  tbody.innerHTML =
    state.pulseras
      .map(
        (
          item
        ) => {
          const estado =
            getEstadoPulsera(
              item
            );

          const claseFila =
            item.grabada
              ? "row-written"
              : item.error
                ? "row-error"
                : "";

          const clasePill =
            item.grabada
              ? "ok"
              : item.error
                ? "error"
                : "";

          return `
            <tr class="${claseFila}">
              <td>
                ${Number(item.numero || 0)}
              </td>

              <td>
                <strong>
                  ${esc(
                    item.nombrePasajero ||
                    "—"
                  )}
                </strong>
              </td>

              <td>
                ${esc(
                  item.rut ||
                  "—"
                )}
              </td>

              <td>
                <strong>
                  ${esc(
                    item.codigo ||
                    "—"
                  )}
                </strong>
              </td>

              <td>
                <span class="pill ${clasePill}">
                  ${esc(estado)}
                </span>
              </td>

              <td>
                ${esc(
                  item.grabadaPor ||
                  "—"
                )}
              </td>

              <td>
                ${esc(
                  formatearFecha(
                    item.grabadaAt
                  )
                )}
              </td>
            </tr>
          `;
        }
      )
      .join("");
}

function renderKpisDesdePulseras() {
  const total =
    state.pulseras.length;

  const grabadas =
    state.pulseras.filter(
      (
        item
      ) =>
        item.grabada === true
    ).length;

  const errores =
    state.pulseras.filter(
      (
        item
      ) =>
        item.error === true &&
        item.grabada !== true
    ).length;

  const pendientes =
    Math.max(
      0,
      total - grabadas
    );

  const progreso =
    total > 0
      ? Math.round(
          (
            grabadas /
            total
          ) *
          100
        )
      : 0;

  $("kTotal")
    .textContent =
    String(total);

  $("kGrabadas")
    .textContent =
    String(grabadas);

  $("kPendientes")
    .textContent =
    String(pendientes);

  $("kErrores")
    .textContent =
    String(errores);

  $("kProgreso")
    .textContent =
    `${progreso}%`;

  $("barraProgreso")
    .style
    .width =
    `${progreso}%`;
}

async function copiarEnlaceMovil() {
  const url =
    obtenerUrlMovil();

  if (!url) {
    return;
  }

  try {
    await navigator
      .clipboard
      .writeText(
        url
      );

    setEstadoLote(
      "Enlace copiado. Puedes enviarlo al celular.",
      false,
      true
    );
  } catch {
    prompt(
      "Copia este enlace:",
      url
    );
  }
}

async function compartirEnlaceMovil() {
  const url =
    obtenerUrlMovil();

  if (!url) {
    return;
  }

  if (
    navigator.share
  ) {
    try {
      await navigator.share({
        title:
          `Pulseras NFC ${getNumeroNegocio()}`,

        text:
          "Abrir lote para grabar pulseras NFC.",

        url
      });

      return;
    } catch (
      error
    ) {
      if (
        error?.name ===
        "AbortError"
      ) {
        return;
      }
    }
  }

  await copiarEnlaceMovil();
}

function abrirPaginaMovil() {
  const url =
    obtenerUrlMovil();

  if (!url) {
    return;
  }

  window.open(
    url,
    "_blank",
    "noopener"
  );
}

function obtenerUrlMovil() {
  if (
    !state.loteId
  ) {
    return "";
  }

  return new URL(
    `grabar-pulseras-nfc.html?lote=${encodeURIComponent(
      state.loteId
    )}`,
    location.href
  ).href;
}

function limpiarLoteActual() {
  state.loteId =
    "";

  state.lote =
    null;

  state.pulseras =
    [];

  $("panelLoteActivo")
    ?.classList
    .add("hidden");

  $("pulserasTbody")
    .innerHTML = `
      <tr>
        <td colspan="7">
          No hay lote activo.
        </td>
      </tr>
    `;
}

function detenerListeners() {
  if (
    typeof state.unsubscribeLote ===
    "function"
  ) {
    state.unsubscribeLote();
  }

  if (
    typeof state.unsubscribePulseras ===
    "function"
  ) {
    state.unsubscribePulseras();
  }

  state.unsubscribeLote =
    null;

  state.unsubscribePulseras =
    null;
}

function esPasajeroQueViaja(
  item = {}
) {
  if (
    camposPasajero
      .estaAnulada(
        item
      )
  ) {
    return false;
  }

  if (
    item.viaja === false ||
    item.noViaja === true
  ) {
    return false;
  }

  const estado =
    normalizarClave(
      item.estadoViaje ||
      item.viajeEstado ||
      ""
    );

  if (
    [
      "no_viaja",
      "no_viajan",
      "anulado",
      "anulada",
      "eliminado",
      "eliminada"
    ].includes(
      estado
    )
  ) {
    return false;
  }

  const tipo =
    normalizarClave(
      camposPasajero
        .tipo(
          item
        )
    );

  const estadoCupo =
    normalizarClave(
      item.estadoCupo ||
      item.estadoConfirmacion ||
      ""
    );

  if (
    [
      "nuevo_ingreso",
      "nuevos"
    ].includes(
      tipo
    ) &&
    item.nuevoIngresoConfirmado !== true &&
    ![
      "confirmado",
      "confirmada",
      "aprobado",
      "aprobada"
    ].includes(
      estadoCupo
    )
  ) {
    return false;
  }

  if (
    [
      "lista_espera",
      "lista_de_espera"
    ].includes(
      tipo
    ) &&
    item.listaEsperaConfirmada !== true &&
    ![
      "confirmado",
      "confirmada"
    ].includes(
      estadoCupo
    )
  ) {
    return false;
  }

  return true;
}

function ordenarPasajeros(
  a,
  b
) {
  const nombreA =
    [
      camposPasajero
        .apellidos(a),
      camposPasajero
        .nombres(a)
    ]
      .filter(Boolean)
      .join(" ");

  const nombreB =
    [
      camposPasajero
        .apellidos(b),
      camposPasajero
        .nombres(b)
    ]
      .filter(Boolean)
      .join(" ");

  return nombreA.localeCompare(
    nombreB,
    "es",
    {
      sensitivity:
        "base"
    }
  );
}

function getNumeroNegocio() {
  const data =
    state.grupoCtx?.data ||
    {};

  return String(
    data.numeroNegocio ||
    data.negocio_id ||
    state.grupoCtx?.groupId ||
    state.grupoCtx?.docId ||
    ""
  ).trim();
}

function obtenerIniciales(
  nombres = "",
  apellidos = ""
) {
  const inicialNombre =
    primeraInicial(
      nombres
    );

  const inicialApellido =
    primeraInicial(
      apellidos
    );

  return `${inicialNombre}${inicialApellido}`;
}

function primeraInicial(
  valor = ""
) {
  const limpio =
    quitarAcentos(
      valor
    )
      .trim()
      .toUpperCase();

  return limpio
    .charAt(0) ||
    "X";
}

function limpiarParteCodigo(
  valor = ""
) {
  return quitarAcentos(
    valor
  )
    .toUpperCase()
    .replace(
      /[^A-Z0-9]/g,
      ""
    );
}

function normalizarClave(
  valor = ""
) {
  return quitarAcentos(
    valor
  )
    .trim()
    .toLowerCase()
    .replace(
      /\s+/g,
      "_"
    );
}

function quitarAcentos(
  valor = ""
) {
  return String(
    valor
  )
    .normalize("NFD")
    .replace(
      /[\u0300-\u036f]/g,
      ""
    );
}

function nombreUsuario() {
  return [
    state.user?.nombre,
    state.user?.apellido
  ]
    .filter(Boolean)
    .join(" ")
    .trim() ||
    state.email;
}

function getEstadoPulsera(
  item = {}
) {
  if (
    item.grabada === true
  ) {
    return "Grabada";
  }

  if (
    item.error === true
  ) {
    return "Error";
  }

  if (
    item.estado === "EN_GRABACION"
  ) {
    return "En grabación";
  }

  return "Pendiente";
}

function formatearFecha(
  valor
) {
  const date =
    valor?.toDate
      ? valor.toDate()
      : valor instanceof Date
        ? valor
        : null;

  if (!date) {
    return "—";
  }

  return new Intl.DateTimeFormat(
    "es-CL",
    {
      dateStyle:
        "short",
      timeStyle:
        "short"
    }
  ).format(
    date
  );
}

function setEstadoPrincipal(
  mensaje,
  error = false,
  ok = false
) {
  const box =
    $("estadoPrincipal");

  box.textContent =
    mensaje;

  box.classList
    .toggle(
      "error",
      error
    );

  box.classList
    .toggle(
      "ok",
      ok
    );
}

function setEstadoLote(
  mensaje,
  error = false,
  ok = false
) {
  const box =
    $("estadoLote");

  if (!box) {
    return;
  }

  box.textContent =
    mensaje;

  box.classList
    .toggle(
      "error",
      error
    );

  box.classList
    .toggle(
      "ok",
      ok
    );
}

function esc(
  valor = ""
) {
  return String(
    valor
  )
    .replaceAll(
      "&",
      "&amp;"
    )
    .replaceAll(
      "<",
      "&lt;"
    )
    .replaceAll(
      ">",
      "&gt;"
    )
    .replaceAll(
      '"',
      "&quot;"
    )
    .replaceAll(
      "'",
      "&#039;"
    );
}
