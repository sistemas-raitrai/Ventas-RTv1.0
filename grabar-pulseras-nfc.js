import {
  auth,
  db,
  normalizeEmail,
  getVentasUser
} from "./firebase-init.js";

import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc
} from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.7.3/firebase-auth.js";

import {
  getEffectiveUser,
  getRealUser
} from "./roles.js";

const $ = (id) =>
  document.getElementById(id);

const LOTES_COLLECTION =
  "ventas_pulseras_nfc_lotes";

const NFC_PORTAL_URL =
  "https://comunicaciones-raitrai.vercel.app/";

const state = {
  loteId: "",
  lote: null,
  pulseras: [],
  indice: 0,

  realUser: null,
  user: null,
  email: "",

  escribiendo: false,

  unsubscribeLote: null,
  unsubscribePulseras: null,

  wakeLock: null
};

init();

function init() {
  bindEvents();
  comprobarNfc();

  state.loteId =
    String(
      new URLSearchParams(
        location.search
      ).get("lote") ||
      ""
    ).trim();

  onAuthStateChanged(
    auth,
    async (
      firebaseUser
    ) => {
      if (!firebaseUser) {
        mostrarSinSesion();
        return;
      }

      prepararUsuario();

      if (
        !state.loteId
      ) {
        mostrarErrorInicial(
          "Falta el identificador del lote en el enlace."
        );

        return;
      }

      await iniciarLote();
    }
  );

  document.addEventListener(
    "visibilitychange",
    async () => {
      if (
        document.visibilityState === "visible" &&
        state.wakeLock
      ) {
        await solicitarWakeLock();
      }
    }
  );

  window.addEventListener(
    "beforeunload",
    detenerListeners
  );
}

function prepararUsuario() {
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
}

function bindEvents() {
  $("btnGrabar")
    ?.addEventListener(
      "click",
      grabarActual
    );

  $("btnAnterior")
    ?.addEventListener(
      "click",
      () => {
        moverIndice(-1);
      }
    );

  $("btnSiguiente")
    ?.addEventListener(
      "click",
      () => {
        moverIndice(1);
      }
    );

  $("btnSaltar")
    ?.addEventListener(
      "click",
      saltarActual
    );

  $("btnPantallaActiva")
    ?.addEventListener(
      "click",
      alternarWakeLock
    );

  $("btnToggleLista")
    ?.addEventListener(
      "click",
      toggleLista
    );

  $("listaPulseras")
    ?.addEventListener(
      "click",
      (
        event
      ) => {
        const row =
          event.target.closest(
            "[data-index]"
          );

        if (!row) {
          return;
        }

        state.indice =
          Number(
            row.dataset.index ||
            0
          );

        renderActual();
        renderLista();
      }
    );
}

async function iniciarLote() {
  $("authPanel")
    .classList
    .add("hidden");

  $("appPanel")
    .classList
    .remove("hidden");

  setConexion(
    "Conectando"
  );

  const loteRef =
    doc(
      db,
      LOTES_COLLECTION,
      state.loteId
    );

  const snap =
    await getDoc(
      loteRef
    );

  if (
    !snap.exists()
  ) {
    mostrarErrorInicial(
      "El lote no existe."
    );

    return;
  }

  const data =
    snap.data() ||
    {};

  if (
    data.activo === false
  ) {
    mostrarErrorInicial(
      "Este lote está anulado o inactivo."
    );

    return;
  }

  state.unsubscribeLote =
    onSnapshot(
      loteRef,
      (
        loteSnap
      ) => {
        if (
          !loteSnap.exists()
        ) {
          mostrarErrorInicial(
            "El lote fue eliminado."
          );

          return;
        }

        state.lote = {
          id:
            loteSnap.id,
          ...loteSnap.data()
        };

        renderCabecera();
        setConexion(
          "Sincronizado",
          true
        );
      },
      (
        error
      ) => {
        console.error(
          "[grabar-pulseras-nfc] lote",
          error
        );

        setConexion(
          "Sin conexión",
          false,
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
        snapPulseras
      ) => {
        const codigoActual =
          state.pulseras[
            state.indice
          ]?.id ||
          "";

        state.pulseras =
          snapPulseras
            .docs
            .map(
              (
                item
              ) => ({
                id:
                  item.id,
                ...item.data()
              })
            );

        if (
          codigoActual
        ) {
          const indiceAnterior =
            state.pulseras
              .findIndex(
                (
                  item
                ) =>
                  item.id ===
                  codigoActual
              );

          if (
            indiceAnterior >= 0
          ) {
            state.indice =
              indiceAnterior;
          }
        } else {
          seleccionarPrimeraPendiente();
        }

        asegurarIndiceValido();
        renderTodo();
      },
      (
        error
      ) => {
        console.error(
          "[grabar-pulseras-nfc] pulseras",
          error
        );

        setEstadoGrabacion(
          "No se pudo sincronizar la lista de pulseras.",
          true
        );
      }
    );
}

async function grabarActual() {
  const item =
    state.pulseras[
      state.indice
    ];

  if (
    !item ||
    state.escribiendo
  ) {
    return;
  }

  if (
    !("NDEFReader" in window)
  ) {
    setEstadoGrabacion(
      "Este navegador no soporta Web NFC. Usa Chrome en Android, con NFC activado y la página publicada por HTTPS.",
      true
    );

    return;
  }

  state.escribiendo =
    true;

  actualizarBotones();

  setEstadoGrabacion(
    `Acerca la pulsera al teléfono para grabar ${item.codigo}...`
  );

  const pulseraRef =
    doc(
      db,
      LOTES_COLLECTION,
      state.loteId,
      "pulseras",
      item.id
    );

  try {
    await updateDoc(
      pulseraRef,
      {
        estado:
          "EN_GRABACION",

        error:
          false,

        mensajeError:
          "",

        ultimoIntentoAt:
          serverTimestamp(),

        ultimoIntentoPor:
          nombreUsuario(),

        ultimoIntentoPorCorreo:
          state.email,

        actualizadoAt:
          serverTimestamp()
      }
    );

    const ndef =
      new NDEFReader();

    const urlPulsera =
      `${NFC_PORTAL_URL}?nfc=${encodeURIComponent(
        String(
          item.codigo ||
          ""
        )
      )}`;
    
    await ndef.write({
      records: [
        {
          recordType:
            "url",
    
          data:
            urlPulsera
        }
      ]
    });

    await marcarGrabada(
      item
    );

    vibrarExito();

    setEstadoGrabacion(
      `✓ Pulsera grabada: ${item.codigo}`,
      false,
      true
    );

    moverASiguientePendiente();
  } catch (error) {
    console.error(
      "[grabar-pulseras-nfc] grabarActual",
      error
    );

    const mensaje =
      traducirErrorNfc(
        error
      );

    try {
      await updateDoc(
        pulseraRef,
        {
          estado:
            "ERROR",

          error:
            true,

          mensajeError:
            mensaje,

          intentos:
            Number(
              item.intentos ||
              0
            ) + 1,

          ultimoErrorAt:
            serverTimestamp(),

          ultimoErrorPor:
            nombreUsuario(),

          ultimoErrorPorCorreo:
            state.email,

          actualizadoAt:
            serverTimestamp()
        }
      );
    } catch (
      updateError
    ) {
      console.warn(
        "[grabar-pulseras-nfc] registrar error",
        updateError
      );
    }

    vibrarError();

    setEstadoGrabacion(
      mensaje,
      true
    );
  } finally {
    state.escribiendo =
      false;

    actualizarBotones();
  }
}

async function marcarGrabada(
  item
) {
  const loteRef =
    doc(
      db,
      LOTES_COLLECTION,
      state.loteId
    );

  const pulseraRef =
    doc(
      loteRef,
      "pulseras",
      item.id
    );

  await runTransaction(
    db,
    async (
      transaction
    ) => {
      const pulseraSnap =
        await transaction.get(
          pulseraRef
        );

      const loteSnap =
        await transaction.get(
          loteRef
        );

      if (
        !pulseraSnap.exists() ||
        !loteSnap.exists()
      ) {
        throw new Error(
          "El lote o la pulsera ya no existen."
        );
      }

      const pulseraData =
        pulseraSnap.data() ||
        {};

      const loteData =
        loteSnap.data() ||
        {};

      const yaGrabada =
        pulseraData.grabada === true;

      const urlPulsera =
        `${NFC_PORTAL_URL}?nfc=${encodeURIComponent(
          String(
            pulseraData.codigo ||
            item.codigo ||
            ""
          )
        )}`;
      
      transaction.update(
        pulseraRef,
        {
          estado:
            "GRABADA",
      
          grabada:
            true,
      
          error:
            false,
      
          mensajeError:
            "",
      
          verificada:
            true,
      
          formatoNfc:
            "URL",
      
          urlNfc:
            urlPulsera,
      
          codigoNfc:
            String(
              pulseraData.codigo ||
              item.codigo ||
              ""
            ),
      
          intentos:
            Number(
              pulseraData.intentos ||
              0
            ) + 1,
      
          grabadaAt:
            serverTimestamp(),
      
          grabadaPor:
            nombreUsuario(),
      
          grabadaPorCorreo:
            state.email,
      
          actualizadoAt:
            serverTimestamp()
        }
      );

      if (
        !yaGrabada
      ) {
        const nuevoGrabadas =
          Math.min(
            Number(
              loteData.total ||
              0
            ),
            Number(
              loteData.grabadas ||
              0
            ) + 1
          );

        const nuevoPendientes =
          Math.max(
            0,
            Number(
              loteData.total ||
              0
            ) -
            nuevoGrabadas
          );

        transaction.update(
          loteRef,
          {
            grabadas:
              nuevoGrabadas,

            pendientes:
              nuevoPendientes,

            estado:
              nuevoPendientes === 0
                ? "COMPLETADO"
                : "EN_PROCESO",

            iniciadoAt:
              loteData.iniciadoAt ||
              serverTimestamp(),

            completadoAt:
              nuevoPendientes === 0
                ? serverTimestamp()
                : loteData.completadoAt ||
                  null,

            actualizadoAt:
              serverTimestamp()
          }
        );
      } else {
        transaction.update(
          loteRef,
          {
            actualizadoAt:
              serverTimestamp()
          }
        );
      }
    }
  );
}

function saltarActual() {
  if (
    !state.pulseras.length
  ) {
    return;
  }

  const siguiente =
    buscarSiguientePendiente(
      state.indice + 1
    );

  if (
    siguiente < 0
  ) {
    setEstadoGrabacion(
      "No quedan otras pulseras pendientes.",
      false,
      true
    );

    return;
  }

  state.indice =
    siguiente;

  renderActual();
  renderLista();

  setEstadoGrabacion(
    "Pulsera saltada. Puedes volver a ella desde la lista."
  );
}

function moverASiguientePendiente() {
  const siguiente =
    buscarSiguientePendiente(
      state.indice + 1
    );

  if (
    siguiente >= 0
  ) {
    state.indice =
      siguiente;

    renderActual();
    renderLista();

    return;
  }

  const primera =
    buscarSiguientePendiente(
      0
    );

  if (
    primera >= 0
  ) {
    state.indice =
      primera;

    renderActual();
    renderLista();

    return;
  }

  renderTodo();

  setEstadoGrabacion(
    "✓ Lote completado. Todas las pulseras están grabadas.",
    false,
    true
  );
}

function buscarSiguientePendiente(
  desde
) {
  for (
    let index =
      Math.max(
        0,
        desde
      );
    index <
      state.pulseras.length;
    index += 1
  ) {
    if (
      state.pulseras[
        index
      ]?.grabada !== true
    ) {
      return index;
    }
  }

  return -1;
}

function seleccionarPrimeraPendiente() {
  const index =
    buscarSiguientePendiente(
      0
    );

  state.indice =
    index >= 0
      ? index
      : 0;
}

function moverIndice(
  delta
) {
  if (
    !state.pulseras.length
  ) {
    return;
  }

  state.indice =
    Math.min(
      state.pulseras.length -
        1,
      Math.max(
        0,
        state.indice +
          delta
      )
    );

  renderActual();
  renderLista();
}

function asegurarIndiceValido() {
  if (
    !state.pulseras.length
  ) {
    state.indice =
      0;

    return;
  }

  state.indice =
    Math.min(
      state.pulseras.length -
        1,
      Math.max(
        0,
        state.indice
      )
    );
}

function renderTodo() {
  renderCabecera();
  renderActual();
  renderLista();
  actualizarBotones();
}

function renderCabecera() {
  const lote =
    state.lote ||
    {};

  $("grupoNumero")
    .textContent =
    lote.numeroNegocio ||
    "—";

  $("grupoNombre")
    .textContent =
    [
      lote.aliasGrupo ||
      lote.colegio ||
      "",
      lote.curso ||
      "",
      lote.destino ||
      ""
    ]
      .filter(Boolean)
      .join(" · ") ||
    "Grupo";

  const total =
    state.pulseras.length ||
    Number(
      lote.total ||
      0
    );

  const grabadas =
    state.pulseras.filter(
      (
        item
      ) =>
        item.grabada === true
    ).length;

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

  $("progresoTexto")
    .textContent =
    `${grabadas} de ${total} grabadas`;

  $("barraProgreso")
    .style
    .width =
    `${progreso}%`;
}

function renderActual() {
  const item =
    state.pulseras[
      state.indice
    ];

  if (!item) {
    $("actualPersona")
      .textContent =
      "Sin pulseras";

    $("actualCodigo")
      .textContent =
      "—";

    actualizarBotones();

    return;
  }

  $("actualPersona")
    .textContent =
    item.nombrePasajero ||
    `Pulsera ${item.numero}`;

  $("actualCodigo")
    .textContent =
    item.codigo ||
    "—";

  if (
    item.grabada === true
  ) {
    setEstadoGrabacion(
      "Esta pulsera ya fue grabada. Puedes regrabarla o avanzar a otra.",
      false,
      true
    );
  }

  actualizarBotones();
}

function renderLista() {
  const contenedor =
    $("listaPulseras");

  if (
    !state.pulseras.length
  ) {
    contenedor.innerHTML =
      "<div style='padding:14px'>No hay pulseras.</div>";

    return;
  }

  contenedor.innerHTML =
    state.pulseras
      .map(
        (
          item,
          index
        ) => {
          const classes = [
            "mobile-row"
          ];

          if (
            index ===
            state.indice
          ) {
            classes.push(
              "current"
            );
          }

          if (
            item.grabada ===
            true
          ) {
            classes.push(
              "done"
            );
          }

          return `
            <button
              class="${classes.join(" ")}"
              type="button"
              data-index="${index}"
            >
              <span class="mobile-row-number">
                ${Number(item.numero || 0)}
              </span>

              <span class="mobile-row-person">
                <strong>
                  ${esc(
                    item.nombrePasajero ||
                    "Pulsera"
                  )}
                </strong>

                <span>
                  ${esc(
                    item.codigo ||
                    ""
                  )}
                </span>
              </span>

              <span class="mobile-row-state">
                ${
                  item.grabada
                    ? "✓"
                    : item.error
                      ? "Error"
                      : "Pendiente"
                }
              </span>
            </button>
          `;
        }
      )
      .join("");
}

function actualizarBotones() {
  const hay =
    state.pulseras.length >
    0;

  const item =
    state.pulseras[
      state.indice
    ];

  $("btnGrabar")
    .disabled =
    !hay ||
    !item ||
    state.escribiendo ||
    state.lote?.activo === false;

  $("btnGrabar")
    .textContent =
    state.escribiendo
      ? "ACERCA LA PULSERA..."
      : item?.grabada
        ? "REGRABAR PULSERA"
        : "GRABAR PULSERA";

  $("btnAnterior")
    .disabled =
    !hay ||
    state.indice <= 0 ||
    state.escribiendo;

  $("btnSiguiente")
    .disabled =
    !hay ||
    state.indice >=
      state.pulseras.length -
        1 ||
    state.escribiendo;

  $("btnSaltar")
    .disabled =
    !hay ||
    state.escribiendo;
}

function toggleLista() {
  const lista =
    $("listaPulseras");

  const oculta =
    lista.classList
      .toggle("hidden");

  $("btnToggleLista")
    .textContent =
    oculta
      ? "Ver lista completa"
      : "Ocultar lista";
}

async function alternarWakeLock() {
  if (
    state.wakeLock
  ) {
    await liberarWakeLock();
    return;
  }

  await solicitarWakeLock();
}

async function solicitarWakeLock() {
  if (
    !("wakeLock" in navigator)
  ) {
    setEstadoGrabacion(
      "Este navegador no permite mantener la pantalla activa automáticamente.",
      true
    );

    return;
  }

  try {
    state.wakeLock =
      await navigator
        .wakeLock
        .request(
          "screen"
        );

    $("btnPantallaActiva")
      .textContent =
      "Pantalla activa ✓";

    state.wakeLock
      .addEventListener(
        "release",
        () => {
          state.wakeLock =
            null;

          $("btnPantallaActiva")
            .textContent =
            "Mantener pantalla activa";
        }
      );
  } catch (
    error
  ) {
    console.warn(
      "[grabar-pulseras-nfc] wake lock",
      error
    );

    setEstadoGrabacion(
      "No se pudo mantener la pantalla activa.",
      true
    );
  }
}

async function liberarWakeLock() {
  try {
    await state.wakeLock
      ?.release();
  } catch {
    // No requiere acción.
  }

  state.wakeLock =
    null;

  $("btnPantallaActiva")
    .textContent =
    "Mantener pantalla activa";
}

function comprobarNfc() {
  const box =
    $("compatibilidadNfc");

  if (
    "NDEFReader" in window
  ) {
    box.textContent =
      "Web NFC disponible. Mantén NFC activado y acerca una pulsera compatible con NDEF.";

    return;
  }

  box.textContent =
    "Web NFC no está disponible. Abre esta página en Chrome para Android mediante HTTPS.";
}

function mostrarSinSesion() {
  $("appPanel")
    .classList
    .add("hidden");

  $("authPanel")
    .classList
    .remove("hidden");

  const retorno =
    encodeURIComponent(
      location.href
    );

  $("authMensaje")
    .innerHTML = `
      Debes iniciar sesión en el sistema desde este celular.
      <br><br>
      <a href="login.html?redirect=${retorno}">
        Ir al inicio de sesión
      </a>
    `;
}

function mostrarErrorInicial(
  mensaje
) {
  $("appPanel")
    .classList
    .add("hidden");

  $("authPanel")
    .classList
    .remove("hidden");

  $("authMensaje")
    .textContent =
    mensaje;
}

function setConexion(
  texto,
  ok = false,
  error = false
) {
  const pill =
    $("estadoConexion");

  pill.textContent =
    texto;

  pill.classList
    .toggle(
      "ok",
      ok
    );

  pill.classList
    .toggle(
      "error",
      error
    );
}

function setEstadoGrabacion(
  mensaje,
  error = false,
  ok = false
) {
  const box =
    $("estadoGrabacion");

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

function traducirErrorNfc(
  error
) {
  if (
    error?.name ===
    "NotAllowedError"
  ) {
    return "Permiso NFC rechazado o grabación cancelada.";
  }

  if (
    error?.name ===
    "NotSupportedError"
  ) {
    return "La pulsera no es compatible con escritura NDEF o está bloqueada.";
  }

  if (
    error?.name ===
    "NetworkError"
  ) {
    return "No se pudo completar la comunicación con la pulsera. Acércala nuevamente.";
  }

  if (
    error?.name ===
    "AbortError"
  ) {
    return "La grabación fue cancelada.";
  }

  return error?.message ||
    "No se pudo grabar la pulsera.";
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

function vibrarExito() {
  navigator.vibrate?.(
    [100, 60, 100]
  );
}

function vibrarError() {
  navigator.vibrate?.(
    [250, 100, 250]
  );
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

  liberarWakeLock();
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
