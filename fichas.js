import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.7.3/firebase-auth.js";
import {
  collection,
  query,
  where,
  getDocs,
  getDoc,
  addDoc,
  doc,
  setDoc,
  updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";

import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/11.7.3/firebase-storage.js";

import {
  auth,
  db,
  VENTAS_USERS,
  normalizeEmail,
  puedeVerGeneral,
  puedeModificarVentas
} from "./firebase-init.js";

import {
  ACTING_USER_KEY,
  getRealUser,
  getEffectiveUser
} from "./roles.js";

import {
  setHeaderState,
  renderActingUserSwitcher,
  bindLayoutButtons,
  waitForLayoutReady
} from "./ui.js";

const $ = (id) => document.getElementById(id);

const GITHUB_HOME_URL = "https://sistemas-raitrai.github.io/Ventas-RT/";
const HISTORIAL_COLLECTION = "ventas_historial";
const SOLICITUDES_COLLECTION = "ventas_solicitudes_actualizacion";
const ALERTAS_COLLECTION = "ventas_alertas";

const richSelectionByEditor = new Map();
let richEditorsBound = false;

const state = {
  realUser: null,
  effectiveUser: null,
  effectiveEmail: "",
  canSeeAll: false,
  canModify: false,

  requestedId: "",
  groupDocId: "",
  groupId: "",
  group: null,
  ficha: null,
  requests: [],

  isUploadingProgramaPdf: false
};

const FICHA_FIELDS = [
  "solicitudReserva",
  "nombreGrupo",

  /*
   * DATOS COMPARTIDOS GRUPO <-> FICHA
   */
  "apoderadoEncargado",
  "telefono",
  "correo",

  "destinoPrincipal",
  "destinoPrincipalOtro",

  "programa",
  "programaOtro",
  "nombrePrograma",

  "numeroPaxTotal",

  "tramoSeleccion",
  "tramoOtro",
  "tramo",

  "mesViaje",
  "mesViajeOtro",
  "fechaViajeTexto",

  /*
   * DATOS PROPIOS DE FICHA
   */
  "programaPdfUrl",
  "programaPdfNombre",
  "programaPdfStoragePath",
  "programaPdfSubidoPor",
  "programaPdfSubidoPorCorreo",

  "valorPrograma",
  "liberados",
  "categoriaHoteleraContratada",
  "autorizacionGerencia",
  "descuentoValorBase",
  "asistenciaEnViajes",
  "nombreVendedor",
  "numeroNegocio",
  "usuarioFicha",
  "claveAdministrativa",
  "version",
  "infoOperacionesHtml",
  "infoAdministracionHtml",
  "observacionesHtml",
  "pdfUrl",
  "pdfNombre"
];

const FICHA_DESTINO_PRINCIPAL_OPTIONS = [
  "BARILOCHE",
  "SUR DE CHILE",
  "SUR DE CHILE Y BARILOCHE",
  "BRASIL",
  "NORTE DE CHILE",
  "MÉXICO",
  "REPÚBLICA DOMINICANA",
  "OTRO"
];

const FICHA_TRAMO_OPTIONS = [
  "36 – 39",
  "30 – 35",
  "26 – 29",
  "23 – 25",
  "20 – 22",
  "18 – 19",
  "15 – 17",
  "OTRO"
];

const FICHA_MES_VIAJE_OPTIONS = [
  "ENERO",
  "FEBRERO",
  "MARZO",
  "ABRIL",
  "MAYO",
  "JUNIO",
  "JULIO",
  "AGOSTO",
  "SEPTIEMBRE",
  "OCTUBRE",
  "NOVIEMBRE",
  "DICIEMBRE",
  "OTRO"
];

const FICHA_PROGRAM_OPTIONS_BY_DESTINO = {
  [normalizeFichaOptionKey("BRASIL")]: [
    "CAMBORIU FULL 8/7",
    "CAMBORIU ECO 8/7",
    "CAMBORIU ECO 6/5",
    "OTRO"
  ],

  [normalizeFichaOptionKey("BARILOCHE")]: [
    "BARILOCHE 6/5",
    "BARILOCHE TERRESTRE 6/5",
    "BARILOCHE TERRESTRE 5/4",
    "OTRO"
  ],

  [normalizeFichaOptionKey("SUR DE CHILE Y BARILOCHE")]: [
    "SUR DE CHILE Y BARILOCHE CON VALDIVIA 8/7",
    "SUR DE CHILE Y BARILOCHE CON VALDIVIA 7/6",
    "SUR DE CHILE Y BARILOCHE SURFACE 7/6",
    "SUR DE CHILE Y BARILOCHE 7/6",
    "SUR DE CHILE Y BARILOCHE 6/5",
    "PUCON Y BARILOCHE 7/6",
    "OTRO"
  ],

  [normalizeFichaOptionKey("BARILOCHE Y SUR DE CHILE")]: [
    "SUR DE CHILE Y BARILOCHE CON VALDIVIA 8/7",
    "SUR DE CHILE Y BARILOCHE CON VALDIVIA 7/6",
    "SUR DE CHILE Y BARILOCHE SURFACE 7/6",
    "SUR DE CHILE Y BARILOCHE 7/6",
    "SUR DE CHILE Y BARILOCHE 6/5",
    "PUCON Y BARILOCHE 7/6",
    "OTRO"
  ],

  [normalizeFichaOptionKey("SUR DE CHILE")]: [
    "SUR DE CHILE Y HUILO HUILO 7/6",
    "SUR DE CHILE Y HUILO HUILO 6/5",
    "SUR DE CHILE Y PUCON 7/6",
    "SOLO PUERTO VARAS 7/6",
    "SOLO PUERTO VARAS 6/5",
    "SOLO PUERTO VARAS 5/4",
    "TORRES DEL PAINE 7/6",
    "TORRES DEL PAINE 6/5",
    "TORRES DEL PAINE 5/4",
    "VALLE LAS TRANCAS 6/5",
    "VALLE LAS TRANCAS 5/4",
    "OTRO"
  ],

  [normalizeFichaOptionKey("NORTE DE CHILE")]: [
    "SAN PEDRO ATACAMA 7/6",
    "SAN PEDRO ATACAMA 6/5",
    "OTRO"
  ],

  [normalizeFichaOptionKey("MÉXICO")]: [
    "CANCUN Y PLAYA DEL CARMEN 8/7",
    "CANCUN Y PLAYA DEL CARMEN 7/6",
    "CANCUN Y PLAYA DEL CARMEN 6/5",
    "OTRO"
  ],

  [normalizeFichaOptionKey("REPÚBLICA DOMINICANA")]: [
    "PUNTA CANA - BAYAHIBE 8/7",
    "PUNTA CANA - BAYAHIBE 7/6",
    "PUNTA CANA - BAYAHIBE 6/5",
    "OTRO"
  ],

  [normalizeFichaOptionKey("OTRO")]: [
    "OTRO"
  ]
};

const ADMIN_IMPORTANT_FICHA_FIELDS = [
  {
    campo: "valorPrograma",
    label: "Valor programa"
  },
  {
    campo: "numeroPaxTotal",
    label: "Número pax total"
  },
  {
    campo: "tramo",
    label: "Tramo"
  },
  {
    campo: "liberados",
    label: "Liberados"
  },
  {
    campo: "asistenciaEnViajes",
    label: "Asistencia en viajes"
  }
];

function normalizeFichaOptionKey(value = "") {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

function findFichaCanonicalOption(options = [], value = "") {
  const key =
    normalizeFichaOptionKey(value);

  if (!key) {
    return "";
  }

  return (
    options.find(
      (option) =>
        normalizeFichaOptionKey(option) ===
        key
    ) || ""
  );
}

function normalizeFichaDestinoCanonical(value = "") {
  const key =
    normalizeFichaOptionKey(value);

  if (!key) {
    return "";
  }

  /*
   * Compatibilidad con el nombre inverso antiguo.
   */
  if (
    key ===
    normalizeFichaOptionKey(
      "BARILOCHE Y SUR DE CHILE"
    )
  ) {
    return "SUR DE CHILE Y BARILOCHE";
  }

  return (
    findFichaCanonicalOption(
      FICHA_DESTINO_PRINCIPAL_OPTIONS,
      value
    ) || value
  );
}

function getFichaProgramOptionsByDestino(destino = "") {
  const canonical =
    normalizeFichaDestinoCanonical(
      destino
    );

  const key =
    normalizeFichaOptionKey(
      canonical
    );

  return (
    FICHA_PROGRAM_OPTIONS_BY_DESTINO[key] ||
    []
  );
}

function getFichaSharedDisplayValue(
  selected = "",
  other = ""
) {
  return (
    normalizeSearchLocal(selected) === "otro"
      ? cleanText(other || "")
      : cleanText(selected || "")
  );
}

/* =========================================================
   COMPATIBILIDAD FICHAS ANTIGUAS <-> SELECTORES NUEVOS
========================================================= */

function resolveFichaLegacySelector({
  options = [],
  selected = "",
  other = "",
  legacyValue = ""
} = {}) {
  const selectedClean =
    cleanText(selected || "");

  const otherClean =
    cleanText(other || "");

  const legacyClean =
    cleanText(legacyValue || "");

  /*
   * =====================================================
   * 1. YA EXISTE ESTRUCTURA NUEVA
   * =====================================================
   */

  if (selectedClean) {
    const canonical =
      findFichaCanonicalOption(
        options,
        selectedClean
      );

    /*
     * Valor nuevo reconocido.
     */
    if (canonical) {
      if (
        normalizeSearchLocal(canonical) ===
        "otro"
      ) {
        return {
          selected: "OTRO",
          other:
            otherClean ||
            legacyClean ||
            ""
        };
      }

      return {
        selected: canonical,
        other: ""
      };
    }

    /*
     * Puede existir una ficha intermedia donde
     * selected todavía contiene directamente
     * el texto libre antiguo.
     */
    return {
      selected: "OTRO",
      other:
        otherClean ||
        selectedClean ||
        legacyClean ||
        ""
    };
  }

  /*
   * =====================================================
   * 2. NO HAY ESTRUCTURA NUEVA:
   *    INTENTAMOS RECUPERAR TEXTO ANTIGUO
   * =====================================================
   */

  if (!legacyClean) {
    return {
      selected: "",
      other: ""
    };
  }

  const canonical =
    findFichaCanonicalOption(
      options,
      legacyClean
    );

  /*
   * Texto antiguo coincide exactamente
   * con una opción actual.
   */
  if (canonical) {
    return {
      selected: canonical,
      other: ""
    };
  }

  /*
   * Texto antiguo NO coincide.
   *
   * NO SE PIERDE.
   *
   * Se representa como:
   *
   * OTRO + texto histórico completo.
   */
  return {
    selected: "OTRO",
    other: legacyClean
  };
}

function setFichaSelectOptions(
  selectId,
  options = [],
  selectedValue = ""
) {
  const select =
    $(selectId);

  if (!select) {
    return;
  }

  const selectedCanonical =
    findFichaCanonicalOption(
      options,
      selectedValue
    );

  const selected =
    selectedCanonical ||
    (
      normalizeSearchLocal(
        selectedValue
      ) === "otro"
        ? "OTRO"
        : ""
    );

  select.innerHTML = "";

  const empty =
    document.createElement(
      "option"
    );

  empty.value =
    "";

  empty.textContent =
    "Seleccionar";

  select.appendChild(
    empty
  );

  options.forEach(
    (optionValue) => {
      const option =
        document.createElement(
          "option"
        );

      option.value =
        optionValue;

      option.textContent =
        optionValue;

      select.appendChild(
        option
      );
    }
  );

  select.value =
    selected || "";
}

function syncFichaDestinoOtroVisibility() {
  const select =
    $("f_destinoPrincipal");

  const otro =
    $("f_destinoPrincipalOtro");

  if (!otro) {
    return;
  }

  const esOtro =
    normalizeSearchLocal(
      select?.value || ""
    ) === "otro";

  /*
   * Funciona tanto si el HTML usa hidden
   * como si solamente tiene input normal.
   */
  otro.classList.toggle(
    "hidden",
    !esOtro
  );

  const wrapper =
    otro.closest(
      ".form-group, .field, .ficha-field, .form-field"
    );

  wrapper?.classList.toggle(
    "hidden",
    !esOtro
  );

  otro.disabled =
    !esOtro ||
    !canEditFicha();
}

function syncFichaProgramaOtroVisibility() {
  const select =
    $("f_programa");

  const otro =
    $("f_programaOtro");

  if (!otro) {
    return;
  }

  const esOtro =
    normalizeSearchLocal(
      select?.value || ""
    ) === "otro";

  otro.classList.toggle(
    "hidden",
    !esOtro
  );

  const wrapper =
    otro.closest(
      ".form-group, .field, .ficha-field, .form-field"
    );

  wrapper?.classList.toggle(
    "hidden",
    !esOtro
  );

  otro.disabled =
    !esOtro ||
    !canEditFicha();
}

function syncFichaTramoOtroVisibility() {
  const select =
    $("f_tramoSeleccion");

  const otro =
    $("f_tramoOtro");

  if (!otro) {
    return;
  }

  const esOtro =
    normalizeSearchLocal(
      select?.value || ""
    ) === "otro";

  otro.classList.toggle(
    "hidden",
    !esOtro
  );

  const wrapper =
    otro.closest(
      ".form-group, .field, .ficha-field, .form-field"
    );

  wrapper?.classList.toggle(
    "hidden",
    !esOtro
  );

  otro.disabled =
    !esOtro ||
    !canEditFicha();
}

function syncFichaMesViajeOtroVisibility() {
  const select =
    $("f_mesViaje");

  const otro =
    $("f_mesViajeOtro");

  if (!otro) {
    return;
  }

  /*
   * NUEVA REGLA:
   *
   * "Especificar" está disponible para CUALQUIER mes.
   *
   * Ejemplos:
   *
   * NOVIEMBRE
   * Segunda quincena
   *
   * SEPTIEMBRE
   * Primera semana
   *
   * NOVIEMBRE
   * [vacío]
   *
   * OTRO
   * Fecha por definir
   */

  const hayMesSeleccionado =
    !!cleanText(
      select?.value || ""
    );

  /*
   * Si todavía no se selecciona mes,
   * dejamos oculto el campo.
   *
   * Apenas existe una selección,
   * cualquiera que sea, se muestra.
   */
  otro.classList.toggle(
    "hidden",
    !hayMesSeleccionado
  );

  const wrapper =
    otro.closest(
      ".form-group, .field, .ficha-field, .form-field"
    );

  wrapper?.classList.toggle(
    "hidden",
    !hayMesSeleccionado
  );

  otro.disabled =
    !hayMesSeleccionado ||
    !canEditFicha();
}

function syncFichaProgramaOptions({
  selectedProgram = "",
  selectedOther = ""
} = {}) {
  const select =
    $("f_programa");

  if (!select) {
    return;
  }

  const destinoSeleccion =
    getValue(
      "f_destinoPrincipal"
    );

  const destinoOtro =
    getValue(
      "f_destinoPrincipalOtro"
    );

  const destinoVisible =
    getFichaSharedDisplayValue(
      destinoSeleccion,
      destinoOtro
    );

  let options =
    getFichaProgramOptionsByDestino(
      destinoVisible
    );

  /*
   * Si el destino antiguo no existe
   * dentro del catálogo actual,
   * de todas maneras permitimos conservar
   * el programa histórico como OTRO.
   */
  if (!options.length) {
    options = [
      "OTRO"
    ];
  }

  const resolved =
    resolveFichaLegacySelector({
      options,
      selected:
        selectedProgram,

      other:
        selectedOther,

      legacyValue:
        selectedOther
    });

  setFichaSelectOptions(
    "f_programa",
    options,
    resolved.selected
  );

  setValue(
    "f_programaOtro",
    resolved.other
  );

  syncFichaProgramaOtroVisibility();
}

function syncFichaSharedSelectors(
  ficha = {}
) {
  /*
   * =====================================================
   * DESTINO
   * =====================================================
   */

  const destinoResolved =
    resolveFichaLegacySelector({
      options:
        FICHA_DESTINO_PRINCIPAL_OPTIONS,

      selected:
        ficha.destinoPrincipal,

      other:
        ficha.destinoPrincipalOtro,

      legacyValue:
        ficha.destinoPrincipalOtro
    });

  setFichaSelectOptions(
    "f_destinoPrincipal",
    FICHA_DESTINO_PRINCIPAL_OPTIONS,
    destinoResolved.selected
  );

  setValue(
    "f_destinoPrincipalOtro",
    destinoResolved.other
  );

  syncFichaDestinoOtroVisibility();

  /*
   * =====================================================
   * PROGRAMA
   * =====================================================
   */

  syncFichaProgramaOptions({
    selectedProgram:
      ficha.programa,

    selectedOther:
      ficha.programaOtro ||
      (
        normalizeSearchLocal(
          ficha.programa
        ) === "otro"
          ? ficha.nombrePrograma
          : ""
      )
  });

  /*
   * =====================================================
   * TRAMO
   * =====================================================
   */

  const tramoResolved =
    resolveFichaLegacySelector({
      options:
        FICHA_TRAMO_OPTIONS,

      selected:
        ficha.tramoSeleccion,

      other:
        ficha.tramoOtro,

      legacyValue:
        ficha.tramo
    });

  setFichaSelectOptions(
    "f_tramoSeleccion",
    FICHA_TRAMO_OPTIONS,
    tramoResolved.selected
  );

  setValue(
    "f_tramoOtro",
    tramoResolved.other
  );

  syncFichaTramoOtroVisibility();

  /*
   * =====================================================
   * MES / FECHA TENTATIVA
   * =====================================================
   *
   * A diferencia de DESTINO / PROGRAMA / TRAMO,
   * aquí "mesViajeOtro" NO significa solamente OTRO.
   *
   * También funciona como especificación opcional:
   *
   * NOVIEMBRE + Segunda quincena
   * SEPTIEMBRE + Primera semana
   */

  const mesSeleccionadoRaw =
    cleanText(
      ficha.mesViaje || ""
    );

  const mesEspecificacionRaw =
    cleanText(
      ficha.mesViajeOtro || ""
    );

  const fechaLegacy =
    cleanText(
      ficha.fechaViajeTexto || ""
    );

  let mesSeleccionado =
    "";

  let mesEspecificacion =
    mesEspecificacionRaw;

  if (mesSeleccionadoRaw) {
    const canonical =
      findFichaCanonicalOption(
        FICHA_MES_VIAJE_OPTIONS,
        mesSeleccionadoRaw
      );

    if (canonical) {
      mesSeleccionado =
        canonical;
    } else {
      /*
       * Ficha intermedia / antigua donde mesViaje
       * contenía directamente texto libre.
       */
      mesSeleccionado =
        "OTRO";

      if (!mesEspecificacion) {
        mesEspecificacion =
          mesSeleccionadoRaw;
      }
    }
  } else if (fechaLegacy) {
    /*
     * Compatibilidad con fichas antiguas que solamente
     * tenían fechaViajeTexto.
     */
    const canonical =
      findFichaCanonicalOption(
        FICHA_MES_VIAJE_OPTIONS,
        fechaLegacy
      );

    if (canonical) {
      mesSeleccionado =
        canonical;
    } else {
      mesSeleccionado =
        "OTRO";

      mesEspecificacion =
        mesEspecificacion ||
        fechaLegacy;
    }
  }

  setFichaSelectOptions(
    "f_mesViaje",
    FICHA_MES_VIAJE_OPTIONS,
    mesSeleccionado
  );

  setValue(
    "f_mesViajeOtro",
    mesEspecificacion
  );

  /*
   * Campo antiguo.
   *
   * Lo conservamos por compatibilidad,
   * pero ya no manda sobre la estructura nueva.
   */
  setValue(
    "f_fechaViajeTexto",
    ficha.fechaViajeTexto
  );

  syncFichaMesViajeOtroVisibility();
}

function getAdminImportantFichaChanges(previousFicha = {}, nextFicha = {}) {
  return ADMIN_IMPORTANT_FICHA_FIELDS
    .map((item) => {
      const anterior = previousFicha?.[item.campo] ?? "";
      const nuevo = nextFicha?.[item.campo] ?? "";

      if (sameValue(anterior, nuevo)) return null;

      return {
        campo: item.campo,
        label: item.label,
        anterior,
        nuevo
      };
    })
    .filter(Boolean);
}

function isFichaUpdateFlowOpen() {
  const flow = state.group?.flowFicha || {};
  return (
    flow.requiereActualizacion === true ||
    normalizeSearchLocal(flow.modo || "") === "actualizacion" ||
    normalizeSearchLocal(flow.modo || "") === "v2" &&
      getOpenFichaUpdateRequests().length > 0
  );
}

function shouldCarolaOpenCorrectionOnSave() {
  const email = normalizeEmail(state.effectiveEmail || "");
  if (email !== "chernandez@raitrai.cl") return false;

  const flow = state.group?.flowFicha || {};

  const yaFirmoJefa =
    !!flow?.jefaVentas?.firmado ||
    !!flow?.jefaVentas?.firmadoAt ||
    !!state.group?.firmaSupervision;

  const yaFirmoAdmin =
    !!flow?.administracion?.firmado ||
    !!flow?.administracion?.firmadoAt ||
    !!state.group?.firmaAdministracion;

  const vieneDeActualizacionVendedor = isFichaUpdateFlowOpen();

  return !vieneDeActualizacionVendedor && (yaFirmoJefa || yaFirmoAdmin);
}

const TOAST_HOST_ID = "appToastHost";
let toastUiReady = false;

function ensureToastUi() {
  if (!toastUiReady) {
    const style = document.createElement("style");
    style.id = "app-toast-styles";
    style.textContent = `
      #${TOAST_HOST_ID}{
        position: fixed;
        top: 18px;
        right: 18px;
        z-index: 99999;
        display: flex;
        flex-direction: column;
        gap: 10px;
        pointer-events: none;
      }

      .app-toast{
        --toast-accent: #6d5dfc;
        min-width: 320px;
        max-width: min(420px, calc(100vw - 36px));
        display: grid;
        grid-template-columns: auto 1fr auto;
        gap: 10px;
        align-items: start;
        padding: 12px 12px 12px 12px;
        border-radius: 16px;
        border: 1px solid rgba(61, 41, 92, 0.10);
        border-left: 5px solid var(--toast-accent);
        background: #ffffff;
        box-shadow: 0 14px 34px rgba(41, 27, 61, 0.18);
        color: #2d1b45;
        opacity: 0;
        transform: translateY(-8px) scale(0.98);
        transition: opacity .18s ease, transform .18s ease;
        pointer-events: auto;
        font-size: 14px;
      }

      .app-toast.show{
        opacity: 1;
        transform: translateY(0) scale(1);
      }

      .app-toast.success{
        --toast-accent: #2ca56f;
        background: #f3fcf7;
      }

      .app-toast.error{
        --toast-accent: #d94b61;
        background: #fff6f7;
      }

      .app-toast.warning{
        --toast-accent: #d89b1d;
        background: #fffaf1;
      }

      .app-toast.info{
        --toast-accent: #7a5cf0;
        background: #f7f4ff;
      }

      .app-toast__icon{
        width: 26px;
        height: 26px;
        border-radius: 999px;
        display: grid;
        place-items: center;
        font-size: 14px;
        font-weight: 700;
        background: rgba(109, 93, 252, 0.10);
        color: var(--toast-accent);
        margin-top: 1px;
      }

      .app-toast__message{
        line-height: 1.35;
        white-space: pre-wrap;
        word-break: break-word;
        padding-top: 2px;
      }

      .app-toast__close{
        border: 0;
        background: transparent;
        color: #6f6484;
        cursor: pointer;
        font-size: 18px;
        line-height: 1;
        padding: 0 2px;
      }

      .app-toast__close:hover{
        color: #2d1b45;
      }

      @media (max-width: 640px){
        #${TOAST_HOST_ID}{
          top: 12px;
          right: 12px;
          left: 12px;
        }

        .app-toast{
          min-width: 0;
          max-width: 100%;
        }
      }
    `;
    document.head.appendChild(style);
    toastUiReady = true;
  }

  let host = document.getElementById(TOAST_HOST_ID);
  if (!host) {
    host = document.createElement("div");
    host.id = TOAST_HOST_ID;
    document.body.appendChild(host);
  }

  return host;
}

function removeToast(toastEl) {
  if (!toastEl || toastEl.dataset.closing === "1") return;

  toastEl.dataset.closing = "1";
  toastEl.classList.remove("show");

  setTimeout(() => {
    toastEl.remove();
  }, 220);
}

function showToast(message = "", type = "success", { duration = 3200 } = {}) {
  const text = String(message || "").trim();
  if (!text) return;

  const host = ensureToastUi();

  const iconMap = {
    success: "✓",
    error: "✕",
    warning: "!",
    info: "i"
  };

  const toast = document.createElement("div");
  toast.className = `app-toast ${type}`;

  const icon = document.createElement("div");
  icon.className = "app-toast__icon";
  icon.textContent = iconMap[type] || "i";

  const body = document.createElement("div");
  body.className = "app-toast__message";
  body.textContent = text;

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "app-toast__close";
  closeBtn.setAttribute("aria-label", "Cerrar aviso");
  closeBtn.textContent = "×";
  closeBtn.addEventListener("click", () => removeToast(toast));

  toast.appendChild(icon);
  toast.appendChild(body);
  toast.appendChild(closeBtn);
  host.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.add("show");
  });

  setTimeout(() => {
    removeToast(toast);
  }, duration);
}

initPage();

async function initPage() {
  state.requestedId = String(new URLSearchParams(location.search).get("id") || "").trim();

  await waitForLayoutReady();
  bindRichEditors();
  bindEvents();

  onAuthStateChanged(auth, async (user) => {
    if (!user) return;

    await bootstrapFromSession();
    setHeaderAndScope();
    await loadAll();
  });
}

/* =========================================================
   SESSION / HEADER
========================================================= */
async function bootstrapFromSession() {
  state.realUser = getRealUser();
  state.effectiveUser = getEffectiveUser();
  state.effectiveEmail = normalizeEmail(
    state.effectiveUser?.email || state.realUser?.email || auth.currentUser?.email || ""
  );
  state.canSeeAll = puedeVerGeneral(state.effectiveEmail);
  state.canModify = puedeModificarVentas(state.effectiveEmail);
}

function setHeaderAndScope() {
  setHeaderState({
    realUser: state.realUser,
    effectiveUser: state.effectiveUser,
    scopeText: `Ficha de viaje · ${state.requestedId || "Sin ID"}`
  });

  renderActingUserSwitcher({
    realUser: state.realUser,
    effectiveUser: state.effectiveUser,
    users: VENTAS_USERS
  });

  bindLayoutButtons({
    homeUrl: GITHUB_HOME_URL,
    onLogout: async () => {
      try {
        sessionStorage.removeItem(ACTING_USER_KEY);
        await signOut(auth);
        location.href = "login.html";
      } catch (error) {
        alert("Error al cerrar sesión: " + error.message);
      }
    },
    onActAs: async (selectedEmail) => {
      if (!state.realUser || state.realUser.rol !== "admin") return;
      if (!selectedEmail) return;

      sessionStorage.setItem(ACTING_USER_KEY, selectedEmail);
      await bootstrapFromSession();
      setHeaderAndScope();
      await loadAll();
    },
    onResetActAs: async () => {
      sessionStorage.removeItem(ACTING_USER_KEY);
      await bootstrapFromSession();
      setHeaderAndScope();
      await loadAll();
    }
  });
}

/* =========================================================
   LOAD
========================================================= */
async function loadAll() {
  if (!state.requestedId) {
    renderFatal("Falta el parámetro ?id= en la URL.");
    return;
  }

  let resolved = null;

  try {
    resolved = await resolveGroupByParam(state.requestedId);
  } catch (error) {
    console.error("[fichas] Error conectando con Firestore", error);

    renderFatal(`
      No se pudo conectar con Firebase/Firestore.

      Esto suele pasar por conexión lenta, bloqueo de red, VPN, firewall, navegador o Firebase temporalmente sin respuesta.

      Prueba:
      1. Recargar la página.
      2. Abrir en incógnito.
      3. Probar otra red.
      4. Revisar que firebase-init.js tenga useFetchStreams: false.
    `);

    return;
  }

  if (!resolved) {
    renderFatal(`No encontré el grupo ${state.requestedId}.`);
    return;
  }

  state.groupDocId = resolved.docId;
  state.groupId = String(resolved.groupId || state.requestedId);
  state.group = resolved.data || {};

  if (!canAccessGroup(state.group)) {
    renderFatal("No tienes permisos para ver esta ficha.");
    return;
  }

  if (!canOpenFicha()) {
    renderFatal("La ficha solo puede abrirse cuando el grupo está en estado GANADA.");
    return;
  }

  await loadRequests();
  state.ficha = hydrateFicha(state.group);
  renderPage();
}

async function resolveGroupByParam(id) {
  const directRef = doc(db, "ventas_cotizaciones", String(id));
  const directSnap = await getDoc(directRef);

  if (directSnap.exists()) {
    return {
      docId: directSnap.id,
      groupId: String(directSnap.data()?.idGrupo || directSnap.id),
      data: directSnap.data() || {}
    };
  }

  const q = query(
    collection(db, "ventas_cotizaciones"),
    where("idGrupo", "==", String(id))
  );

  const snap = await getDocs(q);
  if (snap.empty) return null;

  const first = snap.docs[0];
  return {
    docId: first.id,
    groupId: String(first.data()?.idGrupo || first.id),
    data: first.data() || {}
  };
}

async function loadRequests() {
  state.requests = [];

  try {
    const snap = await getDocs(
      query(collection(db, SOLICITUDES_COLLECTION), where("idGrupo", "==", String(state.groupId)))
    );

    state.requests = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (toDate(b.fechaSolicitud)?.getTime() || 0) - (toDate(a.fechaSolicitud)?.getTime() || 0));
  } catch (error) {
    console.error("[fichas] loadRequests", error);
  }
}

/* =========================================================
   ACCESS
========================================================= */
function canAccessGroup(groupData = {}) {
  if (state.canSeeAll) return true;

  const rowVendorEmail = normalizeEmail(groupData.vendedoraCorreo || "");
  if (rowVendorEmail && rowVendorEmail === state.effectiveEmail) return true;

  const vendorName = normalizeSearchLocal(groupData.vendedora || "");
  const currentFull = normalizeSearchLocal(
    [state.effectiveUser?.nombre, state.effectiveUser?.apellido].filter(Boolean).join(" ")
  );

  if (currentFull && vendorName.includes(currentFull)) return true;

  const aliases = Array.isArray(state.effectiveUser?.aliascartera)
    ? state.effectiveUser.aliascartera.map(normalizeSearchLocal)
    : [];

  return aliases.some((alias) => alias && vendorName.includes(alias));
}

function isJefaVentas() {
  return normalizeEmail(state.effectiveEmail) === "chernandez@raitrai.cl" || state.effectiveUser?.rol === "admin";
}

function isAdministracion() {
  const email = normalizeEmail(state.effectiveEmail || "");
  const rol = String(state.effectiveUser?.rol || "").toLowerCase();

  if (rol === "admin") return true;

  return (
    email === "yenny@raitrai.cl" ||
    email === "administracion@raitrai.cl" ||
    email === "raitrai@raitrai.cl"
  );
}

function isStrictAdministracionUser() {
  const email = normalizeEmail(state.effectiveEmail || "");

  return (
    email === "yenny@raitrai.cl" ||
    email === "administracion@raitrai.cl" ||
    email === "raitrai@raitrai.cl"
  );
}

function isAdministracionLimitedAfterVendorSign() {
  // Administración operativa SIEMPRE queda limitada
  // a N° negocio, usuario y clave administrativa.
  // No depende de si ya firmó vendedor.
  return isStrictAdministracionUser();
}

const ADMIN_LIMITED_FICHA_FIELDS = new Set([
  "numeroNegocio",
  "usuarioFicha",
  "claveAdministrativa"
]);

function canEditFichaFieldByAdminLimit(fieldName = "") {
  if (!isAdministracionLimitedAfterVendorSign()) return true;
  return ADMIN_LIMITED_FICHA_FIELDS.has(fieldName);
}

function canActAsFichaAdministracion() {
  const email = normalizeEmail(state.effectiveEmail || "");
  return isAdministracion() || email === "raitrai@raitrai.cl";
}

function getFichaFlowMode(groupData = {}) {
  const flow = groupData.flowFicha || {};
  const ficha = groupData.ficha || {};

  return normalizeSearchLocal(
    groupData.fichaFlujoModo ||
    flow.modo ||
    ficha.flujoModo ||
    ""
  );
}

function isV2FichaFlow(groupData = {}) {
  return getFichaFlowMode(groupData) === "v2";
}

function isVendorRole() {
  return String(state.effectiveUser?.rol || "").toLowerCase() === "vendedor";
}

function isVendorLockedByFlow(groupData = {}) {
  const flow = groupData.flowFicha || {};

  // Regla de negocio:
  // si el vendedor ya firmó, queda bloqueado aunque el grupo sea legacy.
  // La excepción legacy aplica al cierre / PDF real y al flujo posterior,
  // no a que el vendedor siga editando.
  return !!flow?.vendedor?.firmado;
}

function getOpenFichaUpdateRequests() {
  return state.requests.filter((item) => {
    const tipo = normalizeSearchLocal(item.tipoSolicitud || "");
    const estado = normalizeSearchLocal(item.estadoSolicitud || "");

    return tipo === "actualizacion_ficha" &&
      estado !== "completada" &&
      estado !== "cerrada" &&
      item.resuelta !== true;
  });
}

function getPendingFichaUpdateRequests() {
  return state.requests.filter((item) => {
    return normalizeSearchLocal(item.tipoSolicitud || "") === "actualizacion_ficha"
      && normalizeSearchLocal(item.estadoSolicitud || "") === "pendiente";
  });
}

function getReviewedByJefaFichaUpdateRequests() {
  return state.requests.filter((item) => {
    return normalizeSearchLocal(item.tipoSolicitud || "") === "actualizacion_ficha"
      && normalizeSearchLocal(item.estadoSolicitud || "") === "revisada_jefa";
  });
}

function hasPendingUpdateRequest() {
  return getOpenFichaUpdateRequests().length > 0;
}

function hasOpenFichaProcessRequest() {
  return (
    getOpenFichaUpdateRequests().length > 0 ||
    getOpenFichaCorrectionRequests().length > 0
  );
}

function getLatestPendingFichaUpdateRequest() {
  return getPendingFichaUpdateRequests()[0] || null;
}

function getLatestOpenFichaUpdateRequest() {
  return getOpenFichaUpdateRequests()[0] || null;
}

function getOpenFichaCorrectionRequests() {
  return state.requests.filter((item) => {
    const tipo = normalizeSearchLocal(item.tipoSolicitud || "");
    const estado = normalizeSearchLocal(item.estadoSolicitud || "");

    return tipo === "correccion_ficha" &&
      estado !== "completada" &&
      estado !== "cerrada" &&
      item.resuelta !== true;
  });
}

function getPendingFichaCorrectionRequests() {
  return getOpenFichaCorrectionRequests().filter((item) => {
    return normalizeSearchLocal(item.estadoSolicitud || "") === "pendiente_jefa";
  });
}

function getLatestPendingFichaCorrectionRequest() {
  return getPendingFichaCorrectionRequests()[0] || null;
}

function getLatestOpenFichaCorrectionRequest() {
  return getOpenFichaCorrectionRequests()[0] || null;
}

function inscripcionInicialEstaCerradaParaFirma() {
  return !!state.group?.inscripcion?.fasesCerradas?.inscripcion_inicial;
}

function nominaInicialEstaCargadaEnPagos() {
  return state.group?.sistemaPagos?.nominaInicial?.cargada === true;
}

async function obtenerResumenNominaParaFirmaAdmin() {
  const snap = await getDocs(
    collection(
      db,
      "ventas_cotizaciones",
      state.groupDocId,
      "inscripciones"
    )
  );

  const inscripcionesActivas = snap.docs.filter((d) => {
    const data = d.data() || {};

    const estadoPrivacidad = normalizeSearchLocal(
      data?.privacidad?.estado || ""
    );

    return (
      estadoPrivacidad !== "archivada" &&
      estadoPrivacidad !== "eliminada_logica"
    );
  });

  const existeNomina = inscripcionesActivas.length > 0;

  const tieneSistemaPagos = inscripcionesActivas.some((d) => {
    const data = d.data() || {};

    const tipo = normalizeSearchLocal(
      data.tipoInscripcion ||
      data.estadoInscripcion ||
      data.contextoFormulario?.tipoInscripcion ||
      ""
    );

    return (
      tipo === "sistema_pagos" ||
      tipo === "sistema de pagos"
    );
  });

  return {
    existeNomina,
    tieneSistemaPagos
  };
}

function isRealAdminRole() {
  return String(state.effectiveUser?.rol || "").toLowerCase() === "admin";
}

function canRequestFichaUpdate() {
  if (!state.group) return false;
  if (!canAccessGroup(state.group)) return false;
  if (!canOpenFicha()) return false;

  const flow = state.group?.flowFicha || {};

  // Admin real puede solicitar actualización si ya firmó vendedor.
  if (isRealAdminRole()) {
    return !!flow?.vendedor?.firmado;
  }

  // Vendedor solo puede solicitar actualización después de firmar.
  if (isVendorRole()) {
    return !!flow?.vendedor?.firmado;
  }

  return false;
}

function canRequestFichaCorrection() {
  if (!state.group) return false;
  if (!canAccessGroup(state.group)) return false;
  if (!canOpenFicha()) return false;

  const flow = state.group?.flowFicha || {};

  // Admin real puede pedir corrección si ya firmó vendedor.
  if (isRealAdminRole()) {
    return !!flow?.vendedor?.firmado;
  }

  // Administración operativa puede pedir corrección si ya firmó vendedor.
  if (isStrictAdministracionUser()) {
    return !!flow?.vendedor?.firmado;
  }

  // Jefa de ventas también puede iniciar corrección después de firma vendedor.
  if (normalizeEmail(state.effectiveEmail) === "chernandez@raitrai.cl") {
    return !!flow?.vendedor?.firmado;
  }

  return false;
}

function promptRequired(message = "") {
  const value = window.prompt(message, "");
  if (value === null) return null;

  const clean = cleanText(value || "");
  if (!clean) return "";

  return clean;
}

async function createFichaAlert({
  titulo = "",
  mensaje = "",
  nivel = "info",
  destinatarioRol = "",
  destinatarioCorreo = "",
  tipo = "solicitud_actualizacion_ficha"
} = {}) {
  await addDoc(collection(db, ALERTAS_COLLECTION), {
    idGrupo: String(state.groupId),
    codigoRegistro: cleanText(state.group?.codigoRegistro),
    aliasGrupo: cleanText(state.group?.aliasGrupo),
    colegio: cleanText(state.group?.colegio),

    tipo,
    origen: "ficha",
    modulo: "ficha",
    nivel,
    titulo,
    mensaje,

    destinatarioRol,
    destinatarioCorreo: normalizeEmail(destinatarioCorreo || ""),

    activa: true,
    visibleEnIndex: true,
    visibleEnGrupo: true,
    resuelta: false,

    creadoPor: getDisplayName(state.effectiveUser),
    creadoPorCorreo: state.effectiveEmail,
    fechaCreacion: serverTimestamp()
  });
}

async function markPendingFichaUpdateRequestsAsReviewedByJefa({
  reviewedBy = getDisplayName(state.effectiveUser),
  reviewedByCorreo = state.effectiveEmail,
  respuestaJefa = ""
} = {}) {
  const pending = getPendingFichaUpdateRequests();

  for (const item of pending) {
    await setDoc(doc(db, SOLICITUDES_COLLECTION, item.id), {
      estadoSolicitud: "revisada_jefa",
      respuestaJefa,
      revisadaPor: reviewedBy,
      revisadaPorCorreo: reviewedByCorreo,
      fechaRevisionJefa: serverTimestamp()
    }, { merge: true });
  }

  return pending.length;
}

async function markPendingFichaCorrectionRequestsAsReviewedByJefa({
  reviewedBy =
    getDisplayName(
      state.effectiveUser
    ),

  reviewedByCorreo =
    state.effectiveEmail,

  respuestaJefa = ""
} = {}) {
  const pending =
    getPendingFichaCorrectionRequests();

  for (const item of pending) {
    await setDoc(
      doc(
        db,
        SOLICITUDES_COLLECTION,
        item.id
      ),
      {
        estadoSolicitud:
          "revisada_jefa",

        respuestaJefa,

        revisadaPor:
          reviewedBy,

        revisadaPorCorreo:
          reviewedByCorreo,

        fechaRevisionJefa:
          serverTimestamp()
      },
      {
        merge: true
      }
    );
  }

  return pending.length;
}

async function markOpenFichaUpdateRequestsAsCompleted({
  resolvedBy =
    getDisplayName(
      state.effectiveUser
    ),

  resolvedByCorreo =
    state.effectiveEmail,

  respuestaAdministracion = "",

  newStatus =
    "completada"
} = {}) {
  /*
   * Administración cierra cualquiera
   * de los dos procesos abiertos:
   *
   * - actualización de ficha;
   * - corrección de ficha.
   */
  const open = [
    ...getOpenFichaUpdateRequests(),
    ...getOpenFichaCorrectionRequests()
  ];

  /*
   * Evita eventualmente procesar dos veces
   * el mismo documento.
   */
  const unique =
    [...new Map(
      open.map(
        (item) => [
          item.id,
          item
        ]
      )
    ).values()];

  for (const item of unique) {
    await setDoc(
      doc(
        db,
        SOLICITUDES_COLLECTION,
        item.id
      ),
      {
        estadoSolicitud:
          newStatus,

        respuestaAdministracion,

        resuelta:
          true,

        resueltaPor:
          resolvedBy,

        resueltaPorCorreo:
          resolvedByCorreo,

        fechaResolucion:
          serverTimestamp()
      },
      {
        merge: true
      }
    );
  }

  return unique.length;
}

async function resolveOpenFichaProcessAlerts({
  resolvedBy =
    getDisplayName(
      state.effectiveUser
    ),

  resolvedByCorreo =
    state.effectiveEmail,

  resolucion = ""
} = {}) {
  const snap =
    await getDocs(
      query(
        collection(
          db,
          ALERTAS_COLLECTION
        ),

        where(
          "idGrupo",
          "==",
          String(state.groupId)
        )
      )
    );

  /*
   * Solamente cerramos alertas creadas
   * por el flujo de actualización/corrección.
   *
   * NO tocamos alertas manuales.
   */
  const tiposQueSeCierran =
    new Set([
      "solicitud_actualizacion_ficha",
      "solicitud_correccion_ficha"
    ]);

  const pendientes =
    snap.docs.filter(
      (docSnap) => {
        const data =
          docSnap.data() || {};

        const tipo =
          normalizeSearchLocal(
            data.tipo || ""
          );

        return (
          tiposQueSeCierran.has(tipo) &&
          data.activa !== false &&
          data.resuelta !== true
        );
      }
    );

  for (const alertSnap of pendientes) {
    await setDoc(
      alertSnap.ref,
      {
        activa:
          false,

        resuelta:
          true,

        resolucion:
          resolucion || "Cerrada por Administración",

        resolucionAutomatica:
          true,

        motivoResolucion:
          "cierre_administracion_ficha",

        resueltaPor:
          resolvedBy,

        resueltaPorCorreo:
          resolvedByCorreo,

        fechaResolucion:
          serverTimestamp()
      },
      {
        merge: true
      }
    );
  }

  return pendientes.length;
}

function canEditFicha() {
  const canEditByContext = state.canModify || canActAsFichaAdministracion();
  if (!canEditByContext) return false;

  const isVendor = isVendorRole();

  if (isVendor && isVendorLockedByFlow(state.group)) {
    return false;
  }

  if (state.group?.autorizada && isVendor) {
    return false;
  }

  return canAccessGroup(state.group);
}

function canEditProgramaGrupo() {
  if (!state.group) return false;
  if (!canAccessGroup(state.group)) return false;

  const isVendor = isVendorRole();

  if (isVendor) {
    if (!canEditFicha()) return false;
    if (isVendorLockedByFlow(state.group)) return false;
    if (state.group?.autorizada) return false;
    return true;
  }

  return isJefaVentas() || canActAsFichaAdministracion();
}

function canOpenFicha() {
  return normalizeState(state.group?.estado) === "ganada";
}

function canGeneratePdfVersionAsCurrentUser() {
  return canActAsFichaAdministracion();
}

function getProgramaPdfUrl() {
  const programa = state.group?.programaGrupo || {};
  return cleanText(programa.pdfUrl || "");
}

function getProgramaPdfNombre() {
  const programa = state.group?.programaGrupo || {};

  return cleanText(
    programa.pdfNombre ||
    programa.archivoNombre ||
    ""
  );
}

function hasProgramaPdf() {
  return !!getProgramaPdfUrl();
}

function getProgramaOriginalUrl() {
  return cleanText(
    getByPath(state.group, "programaGrupo.archivoUrl") ||
    getProgramaPdfUrl() ||
    ""
  );
}

function getProgramaOriginalNombre() {
  return cleanText(
    getByPath(state.group, "programaGrupo.archivoNombre") ||
    getProgramaPdfNombre() ||
    ""
  );
}

function hasProgramaOriginal() {
  return !!getProgramaOriginalUrl();
}

function sanitizeFileNamePart(value = "") {
  return String(value || "")
    .replace(/[<>:"/\\|?*]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildProgramaPdfStoragePath(fileName = "") {
  const ano = sanitizeFileNamePart(String(state.group?.anoViaje || "sin-ano"));
  const id = sanitizeFileNamePart(String(state.groupId || "sin-id"));
  const safeFile = sanitizeFileNamePart(fileName || "programa.pdf") || "programa.pdf";

  return `ventas/programas/${ano}/${id}/${safeFile}`;
}

function updateProgramaPdfUi() {
  const statusEl = $("programaPdfStatus");
  const metaEl = $("programaPdfMeta");
  const openBtn = $("btnAbrirProgramaPdf");
  const input = $("f_programaPdfFile");
  const versionInput = $("f_programaVersion");
  const descInput = $("f_programaDescripcionCambio");

  const programa = state.group?.programaGrupo || {};
  const hasPrograma = hasProgramaOriginal();
  const fileName = getProgramaOriginalNombre();
  const version = cleanText(programa.versionPrograma || "");
  const descripcion = cleanText(programa.descripcionCambio || "");
  const tipo = cleanText(programa.archivoTipo || "");

  if (statusEl) {
    if (state.isUploadingProgramaPdf) {
      statusEl.textContent = "Subiendo programa...";
    } else if (hasPrograma) {
      statusEl.textContent = `Programa cargado${version ? ` · Versión ${version}` : ""}`;
    } else {
      statusEl.textContent = "Programa pendiente";
    }
  }

  if (metaEl) {
    if (state.isUploadingProgramaPdf) {
      metaEl.textContent = "Espera a que termine la subida del archivo.";
    } else if (hasPrograma) {
      metaEl.textContent = [
        fileName || "Archivo cargado correctamente.",
        tipo ? `Formato: ${tipo.toUpperCase()}` : "",
        descripcion ? `Cambio: ${descripcion}` : ""
      ].filter(Boolean).join(" · ");
    } else {
      metaEl.textContent = "Debe subirse obligatoriamente antes de firmar como vendedor(a).";
    }
  }

  if (openBtn) {
    openBtn.disabled = !hasPrograma || state.isUploadingProgramaPdf;
  }

  if (input) {
    input.disabled = !canEditProgramaGrupo() || state.isUploadingProgramaPdf;
  }

  if (versionInput) {
    versionInput.disabled = !canEditProgramaGrupo() || state.isUploadingProgramaPdf;
    versionInput.value = version;
  }

  if (descInput) {
    descInput.disabled = !canEditProgramaGrupo() || state.isUploadingProgramaPdf;
    descInput.value = descripcion;
  }
}

function getProgramaFileKind(file = null) {
  const name = String(file?.name || "").toLowerCase();
  const type = String(file?.type || "").toLowerCase();

  if (type === "application/pdf" || name.endsWith(".pdf")) return "pdf";

  if (
    type === "application/msword" ||
    type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    name.endsWith(".doc") ||
    name.endsWith(".docx")
  ) {
    return name.endsWith(".doc") ? "doc" : "docx";
  }

  return "";
}

function getContentTypeByProgramaKind(kind = "") {
  if (kind === "pdf") return "application/pdf";
  if (kind === "doc") return "application/msword";
  if (kind === "docx") {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  return "application/octet-stream";
}

function buildProgramaOriginalStoragePath(fileName = "") {
  const ano = sanitizeFileNamePart(String(state.group?.anoViaje || "sin-ano"));
  const id = sanitizeFileNamePart(String(state.groupId || "sin-id"));
  const safeFile = sanitizeFileNamePart(fileName || "programa") || "programa";

  return `ventas/programas-originales/${ano}/${id}/${Date.now()}-${safeFile}`;
}

/*
  IMPORTANTE:
  Esta función requiere backend/Cloud Function/API externa.
  Acá debe devolver:
  {
    pdfUrl: "...",
    pdfStoragePath: "...",
    pdfNombre: "programa.pdf"
  }
*/
async function convertirProgramaOfficeAPdf({ archivoStoragePath, archivoNombre }) {
  const maxIntentos = 40; // aprox. 2 minutos
  const esperaMs = 3000;

  showToast("Programa Word subido. Generando PDF automáticamente...", "info", {
    duration: 5000
  });

  for (let intento = 1; intento <= maxIntentos; intento += 1) {
    const snap = await getDocs(
      query(
        collection(db, "conversiones_programa"),
        where("originalPath", "==", archivoStoragePath)
      )
    );

    if (!snap.empty) {
      const data = snap.docs[0].data() || {};

      if (data.pdfUrl && data.pdfPath) {
        return {
          pdfUrl: data.pdfUrl,
          pdfStoragePath: data.pdfPath,
          pdfNombre: String(archivoNombre || "programa.docx").replace(/\.(docx|doc)$/i, ".pdf")
        };
      }
    }

    await new Promise((resolve) => setTimeout(resolve, esperaMs));
  }

  throw new Error(
    "El Word se subió, pero la conversión a PDF aún no aparece. Espera unos segundos y vuelve a guardar."
  );
}

async function saveProgramaGrupo() {
  const input =
    $("f_programaPdfFile");

  const file =
    input?.files?.[0] ||
    null;

  if (
    !canEditProgramaGrupo()
  ) {
    showToast(
      "No tienes permisos para subir o reemplazar el programa en este momento.",
      "warning"
    );

    return;
  }

  const programaAnterior =
    state.group?.programaGrupo ||
    {};

  const fichaAnterior =
    state.group?.ficha ||
    {};

  /*
   * PDF anterior.
   */
  const anteriorPdfNombre =
    getProgramaPdfNombre();

  const anteriorPdfUrl =
    getProgramaPdfUrl();

  /*
   * Original anterior.
   */
  const anteriorOriginalNombre =
    getProgramaOriginalNombre();

  const anteriorOriginalUrl =
    getProgramaOriginalUrl();

  const anteriorNombre =
    anteriorOriginalNombre ||
    anteriorPdfNombre ||
    "";

  const anteriorUrl =
    anteriorOriginalUrl ||
    anteriorPdfUrl ||
    "";

  if (
    !file &&
    !anteriorOriginalUrl
  ) {
    showToast(
      "Debes seleccionar un archivo PDF, DOC o DOCX para guardar el programa.",
      "warning"
    );

    return;
  }

  let versionPrograma =
    cleanText(
      $("f_programaVersion")
        ?.value ||
      ""
    );

  if (!versionPrograma) {
    const prev =
      Number(
        programaAnterior
          .versionPrograma ||
        0
      );

    versionPrograma =
      String(
        Number.isFinite(prev) &&
        prev > 0
          ? prev
          : 1
      );
  }

  const descripcionCambio =
    cleanText(
      $("f_programaDescripcionCambio")
        ?.value ||
      ""
    );

  const displayName =
    getDisplayName(
      state.effectiveUser
    );

  const flow =
    state.group?.flowFicha ||
    {};

  const esReemplazo =
    !!file &&
    !!anteriorUrl;

  let archivoUrl =
    programaAnterior.archivoUrl ||
    anteriorOriginalUrl ||
    "";

  let archivoStoragePath =
    programaAnterior.archivoStoragePath ||
    "";

  let archivoNombre =
    programaAnterior.archivoNombre ||
    anteriorOriginalNombre ||
    "";

  let archivoTipo =
    programaAnterior.archivoTipo ||
    "";

  let downloadUrl =
    anteriorPdfUrl ||
    "";

  let storagePath =
    programaAnterior.storagePath ||
    "";

  let pdfNombre =
    anteriorPdfNombre ||
    "";

  state.isUploadingProgramaPdf =
    true;

  updateProgramaPdfUi();

  try {
    if (file) {
      const kind =
        getProgramaFileKind(
          file
        );

      if (!kind) {
        showToast(
          "Solo se permite subir programas en PDF, DOC o DOCX.",
          "warning"
        );

        return;
      }

      const storage =
        getStorage();

      /*
       * Siempre guardamos archivo original.
       */
      archivoTipo =
        kind;

      archivoNombre =
        file.name;

      archivoStoragePath =
        buildProgramaOriginalStoragePath(
          file.name
        );

      const originalRef =
        ref(
          storage,
          archivoStoragePath
        );

      await uploadBytes(
        originalRef,
        file,
        {
          contentType:
            getContentTypeByProgramaKind(
              kind
            )
        }
      );

      archivoUrl =
        await getDownloadURL(
          originalRef
        );

      /*
       * PDF original:
       * sirve también para unión final.
       */
      if (kind === "pdf") {
        downloadUrl =
          archivoUrl;

        storagePath =
          archivoStoragePath;

        pdfNombre =
          file.name;
      }

      /*
       * Word:
       * se conserva original.
       * La conversión/unión final se hace después.
       */
      if (
        kind === "doc" ||
        kind === "docx"
      ) {
        downloadUrl =
          "";

        storagePath =
          "";

        pdfNombre =
          "";
      }
    }

    /*
     * =========================================================
     * PATCH DEL PROGRAMA
     * =========================================================
     *
     * MUY IMPORTANTE:
     *
     * Esta función solamente guarda/reemplaza el ARCHIVO.
     *
     * NO vuelve a sincronizar silenciosamente todos
     * los campos de la ficha.
     *
     * Esa responsabilidad pertenece exclusivamente
     * a saveFicha().
     */

    const fichaConPrograma = {
      ...fichaAnterior,

      programaPdfUrl:
        downloadUrl || "",

      programaPdfNombre:
        pdfNombre || "",

      programaPdfStoragePath:
        storagePath || ""
    };

    const patch = {
      programaGrupo: {
        ...(programaAnterior || {}),

        archivoUrl,

        archivoNombre,

        archivoStoragePath,

        archivoTipo,

        pdfUrl:
          downloadUrl,

        pdfNombre,

        storagePath,

        versionPrograma,

        descripcionCambio,

        subidoPor:
          displayName,

        subidoPorCorreo:
          state.effectiveEmail,

        subidoEl:
          serverTimestamp(),

        reemplazaArchivoNombre:
          esReemplazo
            ? anteriorNombre || ""
            : "",

        reemplazaArchivoUrl:
          esReemplazo
            ? anteriorUrl || ""
            : ""
      },

      ficha:
        fichaConPrograma,

      /*
       * Compatibilidad raíz.
       */
      programaPdfUrl:
        downloadUrl || "",

      programaPdfNombre:
        pdfNombre || "",

      programaPdfStoragePath:
        storagePath || "",

      fechaActualizacion:
        serverTimestamp(),

      fechaActualizacionFicha:
        serverTimestamp(),

      actualizadoPor:
        displayName,

      actualizadoPorCorreo:
        state.effectiveEmail
    };

    /*
     * =========================================================
     * REAPERTURA POR REEMPLAZO DE ARCHIVO
     * =========================================================
     */

    const yaFirmoVendedor =
      !!flow?.vendedor?.firmado;

    const yaFirmoJefa =
      !!flow?.jefaVentas?.firmado;

    const yaFirmoAdmin =
      !!flow?.administracion?.firmado;

    const estabaAutorizada =
      !!state.group?.autorizada;

    const adminReal =
      isRealAdminRole();

    const debeReabrirPorJefa =
      esReemplazo &&
      !adminReal &&
      isJefaVentas() &&
      yaFirmoVendedor &&
      (
        yaFirmoJefa ||
        yaFirmoAdmin ||
        estabaAutorizada
      );

    const debeReabrirPorAdmin =
      esReemplazo &&
      !adminReal &&
      canActAsFichaAdministracion() &&
      yaFirmoVendedor &&
      (
        yaFirmoJefa ||
        yaFirmoAdmin ||
        estabaAutorizada
      );

    /*
     * Admin real:
     * mantiene su capacidad especial,
     * pero invalida PDF vigente porque cambió el programa.
     */
    if (
      esReemplazo &&
      adminReal
    ) {
      patch.autorizada =
        false;

      patch.fichaFlujoAbierto =
        false;

      patch.fichaEstado =
        "autorizada_admin";

      patch.fichaPdfUrl =
        "";

      patch.fichaPdfNombre =
        "";

      patch.ficha = {
        ...patch.ficha,

        pdfUrl:
          "",

        pdfNombre:
          "",

        confirmada:
          false,

        pdfPendienteGeneracion:
          true,
        
        versionPendienteGeneracion: {
          solicitudId:
            "",

          tipoProceso:
            "reemplazo_programa",

          tipoSolicitud:
            "reemplazo_programa",

          detalle:
            "Reemplazo del programa vigente realizado por administración.",

          cerradoPor:
            displayName,

          cerradoPorCorreo:
            state.effectiveEmail,

          registradoEl:
            new Date().toISOString()
        },
        estado:
          "autorizada_admin"
      };

      patch.flowFicha = {
        ...(flow || {}),

        estado:
          "autorizada_admin",

        cierrePdfRealizado:
          false
      };
    }

    if (
      debeReabrirPorJefa ||
      debeReabrirPorAdmin
    ) {
      patch.autorizada =
        false;

      patch.fichaFlujoAbierto =
        true;

      patch.fichaEstado =
        debeReabrirPorAdmin
          ? "lista_vendedor"
          : "revisada_jefa_ventas";

      patch.firmaAdministracion =
        "";

      patch.fichaPdfUrl =
        "";

      patch.fichaPdfNombre =
        "";

      /*
       * =====================================================
       * HISTORIAL PDF ANTERIOR
       * =====================================================
       */

      const pdfHistorialPrevio =
        Array.isArray(
          fichaAnterior.pdfHistorial
        )
          ? [
              ...fichaAnterior.pdfHistorial
            ]
          : [];

      if (
        fichaAnterior.pdfUrl ||
        fichaAnterior.pdfNombre
      ) {
        pdfHistorialPrevio.push({
          pdfUrl:
            fichaAnterior.pdfUrl ||
            "",

          pdfNombre:
            fichaAnterior.pdfNombre ||
            "",

          version:
            fichaAnterior.version ||
            "",

          fechaArchivado:
            new Date()
              .toISOString(),

          motivo:
            "Reapertura por reemplazo de programa"
        });
      }

      /*
       * No perdemos los nuevos datos del archivo del programa.
       */
      patch.ficha = {
        ...patch.ficha,

        estado:
          patch.fichaEstado,

        flujoModo:
          "v2",

        confirmada:
          false,

        pdfPendienteGeneracion:
          true,
        
        versionPendienteGeneracion: {
          solicitudId:
            "",

          tipoProceso:
            "reemplazo_programa",

          tipoSolicitud:
            "reemplazo_programa",

          detalle:
            "Reapertura de ficha por reemplazo del programa vigente.",

          solicitadoPor:
            displayName,

          solicitadoPorCorreo:
            state.effectiveEmail,

          registradoEl:
            new Date().toISOString()
        },

        pdfUrl:
          "",

        pdfNombre:
          "",

        pdfHistorial:
          pdfHistorialPrevio
      };

      patch.flowFicha = {
        ...(flow || {}),

        modo:
          "v2",

        legacy:
          false,

        estado:
          patch.fichaEstado,

        requiereActualizacion:
          false,

        requiereRefirmaAdministracion:
          false,

        cierrePdfRealizado:
          false,

        ultimaSolicitudActualizacion: {
          ...(flow
            ?.ultimaSolicitudActualizacion ||
            {}),

          estado:
            "reabierta"
        }
      };

      console.warn(
        "[fichas] Reapertura por reemplazo de programa: PDF activo invalidado."
      );
    }

    await setDoc(
      doc(
        db,
        "ventas_cotizaciones",
        state.groupDocId
      ),
      patch,
      {
        merge: true
      }
    );

    await createHistoryEntry({
      tipoMovimiento:
        esReemplazo
          ? "programa_reemplazado"
          : "programa_guardado",

      modulo:
        "programa",

      titulo:
        esReemplazo
          ? "Programa reemplazado"
          : "Programa guardado",

      mensaje:
        [
          esReemplazo
            ? `${displayName} reemplazó el programa del grupo.`
            : `${displayName} guardó el programa del grupo.`,

          anteriorNombre
            ? `Archivo anterior: ${anteriorNombre}.`
            : "",

          archivoNombre
            ? `Archivo actual: ${archivoNombre}.`
            : "",

          versionPrograma
            ? `Versión programa: ${versionPrograma}.`
            : "",

          descripcionCambio
            ? `Detalle: ${descripcionCambio}.`
            : ""
        ]
          .filter(Boolean)
          .join(" "),

      metadata: {
        cambios: [
          {
            campo:
              "programaGrupo.archivoNombre",

            anterior:
              anteriorNombre || "",

            nuevo:
              archivoNombre || ""
          },

          {
            campo:
              "programaGrupo.archivoUrl",

            anterior:
              anteriorUrl || "",

            nuevo:
              archivoUrl || ""
          },

          {
            campo:
              "programaGrupo.versionPrograma",

            anterior:
              programaAnterior
                .versionPrograma ||
              "",

            nuevo:
              versionPrograma ||
              ""
          },

          {
            campo:
              "programaGrupo.descripcionCambio",

            anterior:
              programaAnterior
                .descripcionCambio ||
              "",

            nuevo:
              descripcionCambio ||
              ""
          }
        ]
      }
    });

    await loadAll();

    syncButtons();

    showToast(
      esReemplazo
        ? "Programa reemplazado correctamente."
        : "Programa guardado correctamente.",
      "success"
    );
  } catch (error) {
    console.error(
      "[fichas] saveProgramaGrupo",
      error
    );

    showToast(
      "No se pudo guardar el programa: " +
        (
          error?.message ||
          error
        ),
      "error",
      {
        duration: 7000
      }
    );
  } finally {
    state.isUploadingProgramaPdf =
      false;

    if (input) {
      input.value =
        "";
    }

    updateProgramaPdfUi();

    syncButtons();
  }
}

/* =========================================================
   RENDER
========================================================= */
function renderPage() {
  renderHero();
  renderResumenGrupo();
  renderWorkflowPanel();
  fillForm();
  renderFichaBaseMissingNotice();
  syncButtons();
  syncAdminLimitedFichaFields(); 
}

function fichaValueIsEmpty(value) {
  if (value === null || value === undefined) return true;
  return String(value).trim() === "";
}

function getFichaDatoFinal(campoFicha = "", campoGrupo = "") {
  const fichaValue = cleanText(state.ficha?.[campoFicha] || "");
  if (fichaValue) return fichaValue;

  const grupoValue = cleanText(state.group?.[campoGrupo || campoFicha] || "");
  return grupoValue;
}

function getFichaDatoFinalConOtro(campoFicha = "", campoGrupo = "", campoOtroGrupo = "") {
  const fichaValue = cleanText(state.ficha?.[campoFicha] || "");
  if (fichaValue) return fichaValue;

  const grupoValue = cleanText(state.group?.[campoGrupo] || "");

  if (normalizeSearchLocal(grupoValue) === "otro") {
    return cleanText(state.group?.[campoOtroGrupo] || "");
  }

  return grupoValue;
}

function getDatosFaltantesParaCompletarFicha() {
  const fechaGrupo =
    cleanText(state.group?.fechaViaje || "") ||
    cleanText(state.group?.fechaDeViaje || "") ||
    cleanText(state.group?.semanaViaje || "") ||
    cleanText(state.group?.mesViaje || "");

  const campos = [
    {
      label: "Nombre grupo",
      value: getFichaDatoFinal("nombreGrupo", "nombreGrupo") ||
        cleanText(state.group?.aliasGrupo || "") ||
        cleanText(state.group?.colegio || "")
    },
    {
      label: "Apoderado encargado",
      value: getFichaDatoFinal("apoderadoEncargado", "nombreCliente")
    },
    {
      label: "Teléfono",
      value: getFichaDatoFinal("telefono", "celularCliente")
    },
    {
      label: "Correo",
      value: getFichaDatoFinal("correo", "correoCliente")
    },
    {
      label: "Programa",
      value: getFichaDatoFinalConOtro("nombrePrograma", "programa", "programaOtro")
    },
    {
      label: "Número pax total",
      value: getFichaDatoFinal("numeroPaxTotal", "cantidadGrupo")
    },
    {
      label: "Tramo",
      value: getFichaDatoFinalConOtro("tramo", "tramo", "tramoOtro")
    },
    {
      label: "Fecha / mes de viaje",
      value: cleanText(state.ficha?.fechaViajeTexto || "") || fechaGrupo
    },
    {
      label: "Nombre vendedor",
      value: getFichaDatoFinal("nombreVendedor", "vendedora")
    }
  ];

  return campos
    .filter((item) => fichaValueIsEmpty(item.value))
    .map((item) => item.label);
}

function renderFichaBaseMissingNotice() {
  const faltantes = getDatosFaltantesParaCompletarFicha();

  let notice = document.getElementById("fichaBaseMissingNotice");

  if (!faltantes.length) {
    notice?.remove();
    return;
  }

  if (!notice) {
    notice = document.createElement("div");
    notice.id = "fichaBaseMissingNotice";
    notice.className = "ficha-base-missing-notice";

    const form = document.querySelector("#formFicha");

    // Lo insertamos ANTES del form, no dentro del form-grid.
    form?.parentNode?.insertBefore(notice, form);
  }

  notice.innerHTML = `
    <div class="ficha-base-missing-title">
      Faltan datos necesarios para completar la ficha.
    </div>
    <div class="ficha-base-missing-text">
      Estos datos deberían venir desde Editar Grupo o completarse antes de firmar.
    </div>
    <ul>
      ${faltantes.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}
    </ul>
  `;
}

function syncAdminLimitedFichaFields() {
  const limited = isAdministracionLimitedAfterVendorSign();

  FICHA_FIELDS.forEach((fieldName) => {
    const canEditField = !limited || ADMIN_LIMITED_FICHA_FIELDS.has(fieldName);
    const fieldId = `f_${fieldName}`;
    const el = $(fieldId);

    if (!el) return;

    if ("disabled" in el) {
      el.disabled = !canEditField;
    }

    if (el.classList) {
      el.classList.toggle("admin-limited-disabled", limited && !canEditField);
      el.classList.toggle("admin-limited-editable", limited && canEditField);
    }

    if (el.getAttribute("contenteditable") !== null) {
      el.setAttribute("contenteditable", canEditField ? "true" : "false");
    }
  });

  document.querySelectorAll("[data-editor-target]").forEach((btn) => {
    const target = btn.dataset.editorTarget || "";
    const fieldName = target.replace(/^f_/, "");
    const canEditField = !limited || ADMIN_LIMITED_FICHA_FIELDS.has(fieldName);

    if ("disabled" in btn) {
      btn.disabled = !canEditField;
    }

    btn.classList?.toggle("admin-limited-disabled", limited && !canEditField);
  });

  const noticeId = "adminLimitedNotice";
  let notice = document.getElementById(noticeId);

  if (limited && !notice) {
    notice = document.createElement("div");
    notice.id = noticeId;
    notice.className = "admin-limited-notice";
    
    const form = document.querySelector("#formFicha") || document.querySelector("main");
    form?.prepend(notice);
  }

  if (notice) {
    notice.classList.toggle("hidden", !limited);
  }
}

function renderHero() {
  const title =
    cleanText(state.group?.aliasGrupo) ||
    cleanText(state.group?.nombreGrupo) ||
    cleanText(state.ficha?.nombreGrupo) ||
    cleanText(state.group?.colegio) ||
    `Grupo ${state.groupId}`;

  setText("heroTitle", title);
  setText("heroIdGrupo", state.groupId);
  setText("heroColegio", state.group?.colegio || "—");
  setText("heroAnoViaje", state.group?.anoViaje || "—");
  setText("heroVendedora", state.group?.vendedora || state.group?.vendedoraCorreo || "—");
  setText("sheetAno", state.group?.anoViaje || "—");

  const estadoFicha = getFichaEstadoLabel(state.group?.fichaEstado || state.ficha?.estado || "pendiente");
  const tienePdf = !!cleanText(state.ficha?.pdfUrl || state.group?.fichaPdfUrl || "");
  const flujoAbierto = !!state.group?.fichaFlujoAbierto;
  
  // Si hay flujo abierto, el PDF existente es anterior/no vigente.
  const pdfVigente = tienePdf && !flujoAbierto;
  const pdfAnterior = tienePdf && flujoAbierto;

  setText("heroFichaEstado", estadoFicha);
  setText(
    "heroFichaEstadoSub",
    state.group?.autorizada
      ? "Grupo autorizado para operaciones"
      : "Todavía no termina el flujo de firmas"
  );

  setText("heroPdfEstado", tienePdf ? "PDF disponible" : "Sin PDF");
  setText(
    "heroPdfEstadoSub",
    tienePdf
      ? (state.ficha?.pdfNombre || "PDF de ficha")
      : "Se enlazará automáticamente en el siguiente paso"
  );

  const ultimaActualizacion =
    state.ficha?.fechaActualizacionTexto ||
    formatFichaDateTimeText(state.ficha?.fechaActualizacion) ||
    formatFichaDateTimeText(state.group?.fechaActualizacionFicha) ||
    null;
  setText("heroFechaActualizacion", formatDate(ultimaActualizacion));
  setText(
    "heroFechaActualizacionSub",
    ultimaActualizacion
      ? `${getDisplayNameByStored(state.ficha?.actualizadoPor, state.ficha?.actualizadoPorCorreo)}`
      : "Sin guardar aún"
  );

  const puedeEditar = canEditFicha();
  setText("heroPermiso", puedeEditar ? "Editable" : "Solo lectura");
  setText(
    "heroPermisoSub",
    puedeEditar
      ? "Puedes guardar cambios en esta ficha"
      : getBlockedEditMessage()
  );

  const badges = $("heroBadges");
  if (!badges) return;
  
  badges.innerHTML = `
    <span class="f-badge ok">Estado grupo: ${escapeHtml(getEstadoLabel(state.group?.estado))}</span>
  
    <span class="f-badge ${flujoAbierto ? "warn" : "ok"}">
      ${flujoAbierto ? "Ficha abierta" : "Ficha cerrada"}
    </span>
  
    <span class="f-badge ${state.group?.autorizada ? "ok" : "warn"}">
      ${state.group?.autorizada ? "Autorizada" : "No autorizada"}
    </span>
  
    <span class="f-badge ${pdfVigente ? "ok" : "warn"}">
      ${
        pdfVigente
          ? "PDF vigente"
          : pdfAnterior
            ? "PDF anterior"
            : "PDF pendiente"
      }
    </span>
  `;

  setText("sideEstadoFicha", estadoFicha);
  setText("sideVersionFicha", state.ficha?.version || "—");
  setText("sideNumeroNegocio", state.ficha?.numeroNegocio || "—");
  setText(
    "sidePdfGuardado",
    pdfVigente
      ? "Sí, vigente"
      : pdfAnterior
        ? "Sí, pero anterior"
        : "No"
  );
}

function renderResumenGrupo() {
  const box = $("grupoResumenGrid");
  if (!box) return;

  const items = [
    itemMini("Colegio", state.group?.colegio),
    itemMini("Curso", state.group?.curso),
    itemMini("Año viaje", state.group?.anoViaje),
    itemMini("Cantidad grupo", state.group?.cantidadGrupo),
    itemMini("Destino principal", state.group?.destinoPrincipal),
    itemMini("Programa", state.group?.programa),
    itemMini("Estado comercial", getEstadoLabel(state.group?.estado)),
    itemMini("Vendedor(a)", state.group?.vendedora || state.group?.vendedoraCorreo),
    itemMini("1° Contacto", state.group?.nombreCliente),
    itemMini("Correo 1° Contacto", state.group?.correoCliente),
    itemMini("Teléfono 1° Contacto", state.group?.celularCliente),
    itemMini("Observaciones operaciones", stripHtmlPreview(
      getByPath(state.group, "situacion.observacionOperaciones") ||
      state.group?.observacionesOperaciones ||
      ""
    ))
  ];

  box.innerHTML = items.map((item) => `
    <div class="mini-card">
      <div class="mini-label">${escapeHtml(item.label)}</div>
      <div class="mini-value">${escapeHtml(item.value || "—")}</div>
    </div>
  `).join("");
}

function renderWorkflowPanel() {
  const flow = state.group?.flowFicha || {};
  const pendingRequest = state.requests.find((item) => {
    return normalizeSearchLocal(item.estadoSolicitud || "") === "pendiente"
      && normalizeSearchLocal(item.tipoSolicitud || "") === "actualizacion_ficha";
  });

  setText("wfEstadoVendedor", flow?.vendedor?.firmado ? "Firmado" : "Pendiente");
  setText(
    "wfMetaVendedor",
    flow?.vendedor?.firmado
      ? `${flow.vendedor.firmadoPor || "—"} · ${formatDateTime(flow.vendedor.firmadoAt)}`
      : "Revisión comercial final"
  );

  setText("wfEstadoJefa", flow?.jefaVentas?.firmado ? "Firmado" : "Pendiente");
  setText(
    "wfMetaJefa",
    flow?.jefaVentas?.firmado
      ? `${flow.jefaVentas.firmadoPor || "—"} · ${formatDateTime(flow.jefaVentas.firmadoAt)}`
      : "Revisión de supervisión"
  );

  setText("wfEstadoAdmin", flow?.administracion?.firmado ? "Firmado" : "Pendiente");
  setText(
    "wfMetaAdmin",
    flow?.administracion?.firmado
      ? `${flow.administracion.firmadoPor || "—"} · ${formatDateTime(flow.administracion.firmadoAt)}`
      : "Cierre administrativo"
  );

  setText(
    "wfEstadoSolicitud",
    pendingRequest
      ? (pendingRequest.asunto || "Solicitud pendiente")
      : "Sin solicitudes pendientes"
  );

  setText(
    "wfMetaSolicitud",
    pendingRequest
      ? `${pendingRequest.solicitadoPor || "—"} · ${formatDateTime(pendingRequest.fechaSolicitud)}`
      : "Flujo de cambios posteriores"
  );
}

function fillForm() {
  const f =
    state.ficha || {};

  setValue(
    "f_solicitudReserva",
    toInputDateValue(
      f.solicitudReserva
    ) || todayInputDate()
  );

  setValue(
    "f_nombreGrupo",
    f.nombreGrupo
  );

  setValue(
    "f_apoderadoEncargado",
    f.apoderadoEncargado
  );

  setValue(
    "f_telefono",
    f.telefono
  );

  setValue(
    "f_correo",
    f.correo
  );

  /*
   * =========================================================
   * DESTINO / PROGRAMA / TRAMO / MES
   * =========================================================
   *
   * Esta función:
   * - carga destino;
   * - genera programas según destino;
   * - maneja OTRO;
   * - carga tramo;
   * - carga mes / fecha tentativa.
   */

  syncFichaSharedSelectors(
    f
  );

  /*
   * =========================================================
   * RESTO DE FICHA
   * =========================================================
   */

  setValue(
    "f_valorPrograma",
    f.valorPrograma
  );

  setValue(
    "f_numeroPaxTotal",
    f.numeroPaxTotal
  );

  setValue(
    "f_liberados",
    f.liberados
  );

  setValue(
    "f_categoriaHoteleraContratada",
    f.categoriaHoteleraContratada
  );

  setValue(
    "f_autorizacionGerencia",
    f.autorizacionGerencia
  );

  setValue(
    "f_descuentoValorBase",
    f.descuentoValorBase
  );

  setValue(
    "f_asistenciaEnViajes",
    f.asistenciaEnViajes
  );

  setValue(
    "f_nombreVendedor",
    f.nombreVendedor
  );

  setValue(
    "f_numeroNegocio",
    f.numeroNegocio
  );

  setValue(
    "f_usuarioFicha",
    f.usuarioFicha
  );

  setValue(
    "f_claveAdministrativa",
    f.claveAdministrativa
  );

  setValue(
    "f_version",
    f.version
  );

  setValue(
    "f_fechaActualizacionTexto",
    f.fechaActualizacionTexto
  );

  setRichEditorHtml(
    "f_infoOperaciones",
    f.infoOperacionesHtml
  );

  setRichEditorHtml(
    "f_infoAdministracion",
    f.infoAdministracionHtml
  );

  setRichEditorHtml(
    "f_observacionesHtml",
    f.observacionesHtml
  );

  updateProgramaPdfUi();
}

function syncButtons() {
  const editable =
    canEditFicha();

  const tienePdf =
    !!cleanText(
      state.ficha?.pdfUrl ||
      state.group?.fichaPdfUrl ||
      ""
    );

  const tienePrograma =
    hasProgramaOriginal();

  const flow =
    state.group?.flowFicha || {};

  const isGanada =
    normalizeState(
      state.group?.estado
    ) === "ganada";

  /*
   * =========================================================
   * PROCESOS ABIERTOS
   * =========================================================
   */

  const pendingUpdate =
    getOpenFichaUpdateRequests().length > 0;

  const pendingCorrection =
    getOpenFichaCorrectionRequests().length > 0;

  const pendingProcess =
    pendingUpdate ||
    pendingCorrection;

  const pendingRequest =
    getLatestPendingFichaUpdateRequest() ||
    getLatestPendingFichaCorrectionRequest() ||
    getLatestOpenFichaUpdateRequest() ||
    getLatestOpenFichaCorrectionRequest();

  /*
   * =========================================================
   * GUARDAR
   * =========================================================
   */

  const btnGuardar =
    $("btnGuardarFicha");

  if (btnGuardar) {
    btnGuardar.disabled =
      !editable ||
      state.isUploadingProgramaPdf;
  }

  const btnGuardarBottom =
    $("btnGuardarFichaBottom");

  if (btnGuardarBottom) {
    btnGuardarBottom.disabled =
      !editable ||
      state.isUploadingProgramaPdf;
  }

  /*
   * =========================================================
   * PDF
   * =========================================================
   */

  const flujoAbierto =
    !!state.group?.fichaFlujoAbierto;

  const pdfVigente =
    tienePdf &&
    !flujoAbierto;

  const autorizada =
    !!state.group?.autorizada;

  const btnAbrirPdf =
    $("btnAbrirPdfFicha");

  if (btnAbrirPdf) {
    btnAbrirPdf.classList.toggle(
      "hidden",
      !tienePdf
    );

    btnAbrirPdf.disabled =
      !tienePdf;

    btnAbrirPdf.classList.toggle(
      "btn-light",
      pdfVigente
    );

    btnAbrirPdf.classList.toggle(
      "btn-pill",
      !pdfVigente
    );
  }

  /*
   * =========================================================
   * CONTRATO
   * =========================================================
   */

  const btnContrato =
    $("btnAbrirContratoPdf");

  if (btnContrato) {
    const vendedor =
      isVendorRole();

    btnContrato.classList.toggle(
      "hidden",
      vendedor &&
      !autorizada
    );

    btnContrato.disabled =
      vendedor &&
      !autorizada;

    btnContrato.classList.toggle(
      "btn-light",
      autorizada
    );

    btnContrato.classList.toggle(
      "btn-pill",
      !autorizada
    );
  }

  /*
   * =========================================================
   * GENERADOR PDF
   * =========================================================
   */

  const canGeneratePdf =
    canGeneratePdfVersionAsCurrentUser();

  const pdfPendienteGeneracion =
    state.group?.ficha?.pdfPendienteGeneracion === true ||
    state.group?.pdfPendienteGeneracion === true ||
    state.group?.fichaPdfPendienteGeneracion === true;

  const listoParaGenerarPdf =
    canGeneratePdf &&
    canOpenFicha() &&
    normalizeSearchLocal(
      state.group?.fichaEstado || ""
    ) === "autorizada_admin" &&
    state.group?.flowFicha?.administracion?.firmado === true &&
    (
      !tienePdf ||
      pdfPendienteGeneracion
    );

  const btnGenerarPdf =
    $("btnGenerarPdfVersion");

  if (btnGenerarPdf) {
    btnGenerarPdf.classList.toggle(
      "hidden",
      !canGeneratePdf
    );

    btnGenerarPdf.disabled =
      !canGeneratePdf ||
      !canOpenFicha();

    btnGenerarPdf.classList.toggle(
      "btn-light",
      listoParaGenerarPdf
    );

    btnGenerarPdf.classList.toggle(
      "btn-pill",
      !listoParaGenerarPdf
    );
  }

  const btnGenerarPdfBottom =
    $("btnGenerarPdfVersionBottom");

  if (btnGenerarPdfBottom) {
    btnGenerarPdfBottom.classList.toggle(
      "hidden",
      !canGeneratePdf
    );

    btnGenerarPdfBottom.disabled =
      !canGeneratePdf ||
      !canOpenFicha();

    btnGenerarPdfBottom.classList.toggle(
      "btn-light",
      listoParaGenerarPdf
    );

    btnGenerarPdfBottom.classList.toggle(
      "btn-pill",
      !listoParaGenerarPdf
    );
  }

  /*
   * =========================================================
   * CAMPOS DE FORMULARIO
   * =========================================================
   */

  document
    .querySelectorAll(
      "#formFicha input, #formFicha select, #formFicha textarea"
    )
    .forEach((el) => {
      el.disabled =
        !editable ||
        state.isUploadingProgramaPdf;
    });

  [
    "f_infoOperaciones",
    "f_infoAdministracion",
    "f_observacionesHtml"
  ].forEach((id) => {
    const el =
      $(id);

    if (el) {
      el.contentEditable =
        editable
          ? "true"
          : "false";
    }
  });

  document
    .querySelectorAll(
      ".rich-btn, .rich-color"
    )
    .forEach((el) => {
      el.disabled =
        !editable ||
        state.isUploadingProgramaPdf;
    });

  /*
   * =========================================================
   * FIRMA VENDEDOR
   * =========================================================
   */

  const btnVend =
    $("btnFirmarFichaVendedor");

  if (btnVend) {
    const puedeFirmarComoVendedor =
      isVendorRole() ||
      isRealAdminRole();

    btnVend.classList.toggle(
      "hidden",
      !puedeFirmarComoVendedor
    );

    btnVend.disabled =
      !puedeFirmarComoVendedor ||
      !editable ||
      !isGanada ||
      !tienePrograma ||
      !!flow?.vendedor?.firmado ||
      state.isUploadingProgramaPdf;

    btnVend.textContent =
      isRealAdminRole()
        ? "Firmar vendedor(a) como admin"
        : "Firmar vendedor(a)";
  }

  /*
   * =========================================================
   * FIRMA JEFA DE VENTAS
   * =========================================================
   *
   * Si ya había firmado pero aparece:
   * - actualización;
   * - corrección;
   *
   * debe poder volver a revisar / firmar.
   */

  const btnJefa =
    $("btnFirmarFichaJefa");

  if (btnJefa) {
    btnJefa.classList.toggle(
      "hidden",
      !isJefaVentas()
    );

    btnJefa.disabled =
      !isJefaVentas() ||
      !flow?.vendedor?.firmado ||
      (
        !!flow?.jefaVentas?.firmado &&
        !pendingProcess
      );
  }

  /*
   * =========================================================
   * FIRMA ADMINISTRACIÓN
   * =========================================================
   *
   * Administración también debe poder refirmar
   * cuando existe actualización/corrección abierta.
   */

  const btnAdmin =
    $("btnFirmarFichaAdmin");

  if (btnAdmin) {
    btnAdmin.classList.toggle(
      "hidden",
      !canActAsFichaAdministracion()
    );

    btnAdmin.disabled =
      !canActAsFichaAdministracion() ||
      !flow?.jefaVentas?.firmado ||
      (
        !!flow?.administracion?.firmado &&
        !pendingProcess
      );
  }

  /*
   * =========================================================
   * SOLICITUD ACTUALIZACIÓN
   * =========================================================
   */

  const canUpdate =
    canRequestFichaUpdate();

  const canCorrection =
    canRequestFichaCorrection();

  const btnSolicitar =
    $("btnSolicitarActualizacionFicha");

  if (btnSolicitar) {
    btnSolicitar.classList.toggle(
      "hidden",
      !canUpdate
    );

    btnSolicitar.disabled =
      !canUpdate ||
      pendingProcess;

    btnSolicitar.textContent =
      pendingProcess
        ? "Solicitud abierta"
        : "Solicitar actualización";
  }

  const btnSolicitarBottom =
    $("btnSolicitarActualizacionFichaBottom");

  if (btnSolicitarBottom) {
    btnSolicitarBottom.classList.toggle(
      "hidden",
      !canUpdate
    );

    btnSolicitarBottom.disabled =
      !canUpdate ||
      pendingProcess;

    btnSolicitarBottom.textContent =
      pendingProcess
        ? "Solicitud abierta"
        : "Solicitar actualización";
  }

  /*
   * =========================================================
   * SOLICITUD CORRECCIÓN
   * =========================================================
   */

  const btnCorreccion =
    $("btnSolicitarCorreccionFicha");

  if (btnCorreccion) {
    btnCorreccion.classList.toggle(
      "hidden",
      !canCorrection
    );

    btnCorreccion.disabled =
      !canCorrection ||
      pendingProcess;

    btnCorreccion.textContent =
      pendingProcess
        ? "Solicitud abierta"
        : "Solicitar corrección";
  }

  const btnCorreccionBottom =
    $("btnSolicitarCorreccionFichaBottom");

  if (btnCorreccionBottom) {
    btnCorreccionBottom.classList.toggle(
      "hidden",
      !canCorrection
    );

    btnCorreccionBottom.disabled =
      !canCorrection ||
      pendingProcess;

    btnCorreccionBottom.textContent =
      pendingProcess
        ? "Solicitud abierta"
        : "Solicitar corrección";
  }

  /*
   * Conserva restricciones especiales
   * del programa.
   */
  updateProgramaPdfUi();
}

function renderFatal(message) {
  const shell = document.querySelector(".ficha-shell");
  if (!shell) return;

  shell.innerHTML = `
    <div class="ficha-panel">
      <div class="ficha-panel-body">
        <div class="mini-card">
          <div class="mini-value">${escapeHtml(message)}</div>
        </div>
      </div>
    </div>
  `;
}

/* =========================================================
   EVENTS
========================================================= */
function bindEvents() {
  /*
   * =========================================================
   * NAVEGACIÓN / GUARDADO
   * =========================================================
   */

  $("btnVolverGrupo")?.addEventListener(
    "click",
    () => {
      location.href =
        `grupo.html?id=${encodeURIComponent(
          state.groupId ||
          state.requestedId ||
          ""
        )}`;
    }
  );

  $("btnGuardarFicha")?.addEventListener(
    "click",
    () => saveFicha()
  );

  $("btnGuardarFichaBottom")?.addEventListener(
    "click",
    () => saveFicha()
  );

  /*
   * =========================================================
   * SELECTORES COMPARTIDOS GRUPO <-> FICHA
   * =========================================================
   */

  $("f_destinoPrincipal")?.addEventListener(
    "change",
    () => {
      syncFichaDestinoOtroVisibility();

      /*
       * Al cambiar destino se reinicia el programa,
       * porque las opciones dependen del destino.
       */
      syncFichaProgramaOptions({
        selectedProgram:
          "",

        selectedOther:
          ""
      });
    }
  );

  $("f_programa")?.addEventListener(
    "change",
    () => {
      syncFichaProgramaOtroVisibility();
    }
  );

  $("f_tramoSeleccion")?.addEventListener(
    "change",
    () => {
      syncFichaTramoOtroVisibility();
    }
  );

  $("f_mesViaje")?.addEventListener(
    "change",
    () => {
      syncFichaMesViajeOtroVisibility();
    }
  );

  /*
   * =========================================================
   * GENERADOR PDF
   * =========================================================
   */

  $("btnGenerarPdfVersion")?.addEventListener(
    "click",
    async () => {
      await handleGenerarPdfVersion();
    }
  );

  $("btnGenerarPdfVersionBottom")?.addEventListener(
    "click",
    async () => {
      await handleGenerarPdfVersion();
    }
  );

  $("btnAbrirPdfFicha")?.addEventListener(
    "click",
    () => {
      const url =
        cleanText(
          state.ficha?.pdfUrl ||
          state.group?.fichaPdfUrl ||
          ""
        );

      if (!url) {
        alert(
          "Esta ficha todavía no tiene PDF guardado."
        );

        return;
      }

      window.open(
        url,
        "_blank",
        "noopener"
      );
    }
  );

  /*
   * =========================================================
   * CONTRATO
   * =========================================================
   */

  $("btnAbrirContratoPdf")?.addEventListener(
    "click",
    () => {
      const id =
        state.groupId ||
        state.requestedId ||
        state.group?.idGrupo ||
        "";

      if (!id) {
        alert(
          "No encontré el ID del grupo para abrir el contrato."
        );

        return;
      }

      window.open(
        `contrato-pdf.html?id=${encodeURIComponent(id)}`,
        "_blank",
        "noopener"
      );
    }
  );

  /*
   * =========================================================
   * PROGRAMA DEL GRUPO
   * =========================================================
   */

  $("btnGuardarProgramaPdf")?.addEventListener(
    "click",
    saveProgramaGrupo
  );

  $("btnAbrirProgramaPdf")?.addEventListener(
    "click",
    () => {
      const url =
        getProgramaOriginalUrl();

      if (!url) {
        alert(
          "Todavía no hay un programa cargado."
        );

        return;
      }

      window.open(
        url,
        "_blank",
        "noopener"
      );
    }
  );

  /*
   * =========================================================
   * FIRMAS
   * =========================================================
   */

  $("btnFirmarFichaVendedor")?.addEventListener(
    "click",
    async () => {
      try {
        await signFlowFromFicha(
          "vendedor"
        );
      } catch (error) {
        console.error(
          "[fichas] firma vendedor",
          error
        );

        showToast(
          "No se pudo registrar la firma de vendedor(a): " +
            (
              error?.message ||
              error
            ),
          "error",
          {
            duration: 5000
          }
        );
      }
    }
  );

  $("btnFirmarFichaJefa")?.addEventListener(
    "click",
    async () => {
      try {
        await signFlowFromFicha(
          "jefaVentas"
        );
      } catch (error) {
        console.error(
          "[fichas] firma jefa",
          error
        );

        showToast(
          "No se pudo registrar la firma de jefa de ventas: " +
            (
              error?.message ||
              error
            ),
          "error",
          {
            duration: 5000
          }
        );
      }
    }
  );

  $("btnFirmarFichaAdmin")?.addEventListener(
    "click",
    async () => {
      try {
        await signFlowFromFicha(
          "administracion"
        );
      } catch (error) {
        console.error(
          "[fichas] firma administración",
          error
        );

        showToast(
          "No se pudo registrar la firma de administración: " +
            (
              error?.message ||
              error
            ),
          "error",
          {
            duration: 5000
          }
        );
      }
    }
  );

  /*
   * =========================================================
   * SOLICITUDES
   * =========================================================
   */

  $("btnSolicitarActualizacionFicha")?.addEventListener(
    "click",
    () => {
      openRequestModal(
        "actualizacion"
      );
    }
  );

  $("btnSolicitarActualizacionFichaBottom")?.addEventListener(
    "click",
    () => {
      openRequestModal(
        "actualizacion"
      );
    }
  );

  $("btnSolicitarCorreccionFicha")?.addEventListener(
    "click",
    () => {
      openRequestModal(
        "correccion"
      );
    }
  );

  $("btnSolicitarCorreccionFichaBottom")?.addEventListener(
    "click",
    () => {
      openRequestModal(
        "correccion"
      );
    }
  );

  $("btnEnviarSolicitudFicha")?.addEventListener(
    "click",
    saveUpdateRequest
  );

  /*
   * =========================================================
   * MODALES
   * =========================================================
   */

  document
    .querySelectorAll(
      "[data-close]"
    )
    .forEach(
      (btn) => {
        btn.addEventListener(
          "click",
          () =>
            closeModal(
              btn.dataset.close
            )
        );
      }
    );

  $("modalSolicitudFicha")?.addEventListener(
    "click",
    (e) => {
      if (
        e.target ===
        $("modalSolicitudFicha")
      ) {
        closeModal(
          "modalSolicitudFicha"
        );
      }
    }
  );
}

function openModal(id) {
  $(id)?.classList.add("show");
}

function closeModal(id) {
  $(id)?.classList.remove("show");
}

function openRequestModal(mode = "actualizacion") {
  const isCorrection =
    mode === "correccion";

  if (
    isCorrection &&
    !canRequestFichaCorrection()
  ) {
    alert(
      "No tienes permisos para solicitar corrección."
    );

    return;
  }

  if (
    !isCorrection &&
    !canRequestFichaUpdate()
  ) {
    alert(
      "No tienes permisos para solicitar actualización."
    );

    return;
  }

  /*
   * REGLA:
   *
   * No puede existir al mismo tiempo:
   * - una actualización abierta;
   * - una corrección abierta;
   * - dos correcciones;
   * - dos actualizaciones.
   */
  if (hasOpenFichaProcessRequest()) {
    alert(
      "Ya existe una solicitud de actualización o corrección abierta para este grupo."
    );

    return;
  }

  state.requestMode =
    isCorrection
      ? "correccion"
      : "actualizacion";

  $("formSolicitudFicha")?.reset();

  setText(
    "modalSolicitudFichaTitle",

    isCorrection
      ? "Solicitar corrección de ficha"
      : "Solicitar actualización de ficha"
  );

  setText(
    "sr_detalle_label",

    isCorrection
      ? "Qué hay que corregir"
      : "Qué hay que actualizar"
  );

  setValue(
    "sr_asunto",

    isCorrection
      ? `Corrección ficha · ${
          state.group?.aliasGrupo ||
          state.group?.colegio ||
          state.groupId
        }`

      : `Actualizar ficha · ${
          state.group?.aliasGrupo ||
          state.group?.colegio ||
          state.groupId
        }`
  );

  openModal(
    "modalSolicitudFicha"
  );
}

async function refreshFichaUiAfterFlowChange() {
  await loadAll();

  renderHero();
  renderWorkflowPanel();
  syncButtons();
  syncAdminLimitedFichaFields();
}

async function signFlowFromFicha(step) {
  if (!state.group) {
    return;
  }

  const flow =
    state.group.flowFicha || {};

  const nombre =
    getDisplayName(
      state.effectiveUser
    );

  const firmanteComoAdmin =
    isRealAdminRole();

  /*
   * =========================================================
   * FIRMA VENDEDOR
   * =========================================================
   */

  if (step === "vendedor") {
    if (
      !isVendorRole() &&
      !isRealAdminRole()
    ) {
      alert(
        "Esta firma solo la realiza el vendedor(a) o admin."
      );

      return;
    }

    if (!canEditFicha()) {
      alert(
        getBlockedEditMessage()
      );

      return;
    }

    if (
      normalizeState(
        state.group.estado
      ) !== "ganada"
    ) {
      alert(
        "La firma de vendedor(a) solo se habilita cuando el grupo está GANADA."
      );

      return;
    }

    if (flow?.vendedor?.firmado) {
      alert(
        "La firma de vendedor(a) ya está registrada."
      );

      return;
    }

    const resumenNominaFirmaVendedor =
      await obtenerResumenNominaParaFirmaAdmin();

    const puedeFirmarPorOrigenNomina =
      inscripcionInicialEstaCerradaParaFirma() ||
      resumenNominaFirmaVendedor.tieneSistemaPagos;

    if (
      !isRealAdminRole() &&
      !puedeFirmarPorOrigenNomina
    ) {
      alert(
        "Antes de firmar la ficha debes cumplir una de estas condiciones:\n\n" +
        "• Cerrar la Inscripción Inicial del grupo.\n" +
        "• Tener cargada la nómina base desde Sistema de Pagos.\n\n" +
        "Revisa la sección Inscripciones del grupo y luego vuelve a firmar."
      );

      return;
    }

    const faltantesFicha =
      getDatosFaltantesParaCompletarFicha();

    if (
      !isRealAdminRole() &&
      faltantesFicha.length
    ) {
      alert(
        "No puedes firmar la ficha porque faltan datos necesarios:\n\n" +
        faltantesFicha
          .map(
            (x) => `- ${x}`
          )
          .join("\n") +
        "\n\nCompleta estos datos en Editar Grupo o directamente en la ficha antes de firmar."
      );

      return;
    }

    const patch = {
      fichaFlujoModo:
        "v2",

      fichaEstado:
        "lista_vendedor",

      firmaVendedor:
        nombre,

      documentos: {
        ...(state.group.documentos || {}),

        fichaGrupo: {
          ...(state.group.documentos?.fichaGrupo || {}),

          estado:
            "lista_vendedor"
        }
      },

      ficha: {
        ...(state.group.ficha || {}),

        flujoModo:
          "v2",

        estado:
          "lista_vendedor"
      },

      flowFicha: {
        ...(state.group.flowFicha || {}),

        modo:
          "v2",

        legacy:
          false,

        habilitada:
          true,

        estado:
          "lista_vendedor",

        bloqueadaParaVendedor:
          true,

        requiereActualizacion:
          false,

        vendedor: {
          ...(state.group.flowFicha?.vendedor || {}),

          firmado:
            true,

          firmadoAt:
            serverTimestamp(),

          firmadoPor:
            nombre,

          firmadoPorCorreo:
            state.effectiveEmail,

          observacion:
            ""
        }
      }
    };

    await saveGroupPatch(
      patch,
      {
        tipoMovimiento:
          "firma_vendedor",

        modulo:
          "ficha",

        titulo:
          "Firma de vendedor(a)",

        mensaje:
          firmanteComoAdmin
            ? `${nombre} (admin) registró firma como vendedor(a).`
            : `${nombre} dejó la ficha lista como vendedor(a).`,

        cambios: [
          {
            campo:
              "fichaEstado",

            anterior:
              state.group.fichaEstado || "",

            nuevo:
              "lista_vendedor"
          }
        ],

        reloadAfterSave:
          false,

        successMessage:
          "Firma de vendedor(a) registrada correctamente."
      }
    );

    await refreshFichaUiAfterFlowChange();

    return;
  }

  /*
   * =========================================================
   * FIRMA / REVISIÓN JEFA DE VENTAS
   * =========================================================
   */

  if (step === "jefaVentas") {
    if (!isJefaVentas()) {
      alert(
        "Esta firma solo puede realizarla la jefa de ventas."
      );

      return;
    }

    if (!flow?.vendedor?.firmado) {
      alert(
        "Primero debe firmar el vendedor(a)."
      );

      return;
    }

    const pendingRequest =
      getLatestPendingFichaUpdateRequest();

    const pendingCorrection =
      getLatestPendingFichaCorrectionRequest();

    const hadPendingRequest =
      !!pendingRequest;

    const hadPendingCorrection =
      !!pendingCorrection;

    const esCorreccionActiva =
      hadPendingCorrection ||
      flow?.correccionPendiente === true ||
      normalizeSearchLocal(
        flow?.modo || ""
      ) === "correccion";

    /*
     * Si ya firmó y no existe ningún proceso
     * nuevo que revisar, no firma nuevamente.
     */
    if (
      flow?.jefaVentas?.firmado &&
      !hadPendingRequest &&
      !esCorreccionActiva
    ) {
      alert(
        "La firma de jefa de ventas ya está registrada."
      );

      return;
    }

    /*
     * =====================================================
     * EXPLICACIÓN OBLIGATORIA
     * =====================================================
     */

    let respuestaJefa =
      "";

    const solicitudQueSeRevisa =
      pendingRequest ||
      pendingCorrection;

    if (solicitudQueSeRevisa) {
      const tipoTexto =
        hadPendingCorrection
          ? "corrección"
          : "actualización";

      respuestaJefa =
        promptRequired(
          [
            `Motivo de la ${tipoTexto}:`,
            solicitudQueSeRevisa?.detalle ||
              "Sin detalle",
            "",
            "¿Qué cambiaste, corregiste, revisaste o resolviste?"
          ].join("\n")
        );

      if (
        respuestaJefa === null
      ) {
        return;
      }

      if (!respuestaJefa) {
        alert(
          "Debes escribir qué cambiaste, corregiste o revisaste antes de enviar a Administración."
        );

        return;
      }
    }

    /*
     * =====================================================
     * FLOW
     * =====================================================
     */

    const flowPatch = {
      ...(state.group.flowFicha || {}),

      modo:
        esCorreccionActiva
          ? "correccion"
          : "v2",

      legacy:
        false,

      estado:
        esCorreccionActiva
          ? "correccion_pendiente_administracion"
          : "revisada_jefa_ventas",

      requiereActualizacion:
        hadPendingRequest,

      requiereRefirmaAdministracion:
        esCorreccionActiva
          ? true
          : (
              flow?.requiereRefirmaAdministracion ||
              false
            ),

      correccionPendiente:
        esCorreccionActiva
          ? true
          : (
              flow?.correccionPendiente ||
              false
            ),

      correccionEstado:
        esCorreccionActiva
          ? "pendiente_administracion"
          : (
              flow?.correccionEstado ||
              ""
            ),

      jefaVentas: {
        ...(state.group.flowFicha?.jefaVentas || {}),

        firmado:
          true,

        firmadoAt:
          serverTimestamp(),

        firmadoPor:
          nombre,

        firmadoPorCorreo:
          state.effectiveEmail,

        observacion:
          respuestaJefa || ""
      }
    };

    /*
     * DATOS DE ACTUALIZACIÓN
     */

    if (hadPendingRequest) {
      flowPatch.ultimaSolicitudActualizacion = {
        ...(state.group.flowFicha?.ultimaSolicitudActualizacion || {}),

        estado:
          "revisada_jefa",

        revisadaPor:
          nombre,

        revisadaPorCorreo:
          state.effectiveEmail,

        respuestaJefa,

        fechaRevisionJefa:
          serverTimestamp()
      };
    }

    /*
     * DATOS DE CORRECCIÓN
     */

    if (hadPendingCorrection) {
      flowPatch.ultimaCorreccion = {
        ...(state.group.flowFicha?.ultimaCorreccion || {}),

        estado:
          "revisada_jefa",

        revisadaPor:
          nombre,

        revisadaPorCorreo:
          state.effectiveEmail,

        respuestaJefa,

        fechaRevisionJefa:
          serverTimestamp()
      };
    }

    const patch = {
      fichaFlujoModo:
        esCorreccionActiva
          ? "correccion"
          : "v2",

      fichaEstado:
        esCorreccionActiva
          ? "correccion_pendiente_administracion"
          : "revisada_jefa_ventas",

      firmaSupervision:
        nombre,

      documentos: {
        ...(state.group.documentos || {}),

        fichaGrupo: {
          ...(state.group.documentos?.fichaGrupo || {}),

          estado:
            esCorreccionActiva
              ? "correccion_pendiente_administracion"
              : "revisada_jefa_ventas"
        }
      },

      ficha: {
        ...(state.group.ficha || {}),

        flujoModo:
          esCorreccionActiva
            ? "correccion"
            : "v2",

        estado:
          esCorreccionActiva
            ? "correccion_pendiente_administracion"
            : "revisada_jefa_ventas"
      },

      flowFicha:
        flowPatch
    };

    /*
     * =====================================================
     * HISTORIAL JEFA
     * =====================================================
     */

    await saveGroupPatch(
      patch,
      {
        tipoMovimiento:
          hadPendingCorrection
            ? "solicitud_correccion_revisada_jefa"
            : hadPendingRequest
              ? "solicitud_actualizacion_revisada_jefa"
              : "firma_jefa_ventas",

        modulo:
          "ficha",

        titulo:
          hadPendingCorrection
            ? "Corrección revisada por jefa de ventas"
            : hadPendingRequest
              ? "Solicitud revisada por jefa de ventas"
              : "Firma jefa de ventas",

        mensaje:
          hadPendingCorrection
            ? [
                `${nombre} revisó la corrección de ficha.`,
                `Motivo original: ${
                  pendingCorrection?.detalle ||
                  "Sin detalle"
                }.`,
                `Revisión / corrección realizada: ${respuestaJefa}.`
              ].join(" ")

            : hadPendingRequest
              ? [
                  `${nombre} revisó la solicitud de actualización.`,
                  `Motivo original: ${
                    pendingRequest?.detalle ||
                    "Sin detalle"
                  }.`,
                  `Revisión / actualización realizada: ${respuestaJefa}.`
                ].join(" ")

              : `${nombre} revisó la ficha como jefa de ventas.`,

        cambios: [
          {
            campo:
              "fichaEstado",

            anterior:
              state.group.fichaEstado || "",

            nuevo:
              esCorreccionActiva
                ? "correccion_pendiente_administracion"
                : "revisada_jefa_ventas"
          },

          {
            campo:
              "firmaSupervision",

            anterior:
              state.group.firmaSupervision || "",

            nuevo:
              nombre
          }
        ],

        reloadAfterSave:
          false,

        successMessage:
          hadPendingCorrection
            ? "Corrección revisada por jefa de ventas y enviada a Administración."
            : hadPendingRequest
              ? "Solicitud revisada por jefa de ventas y enviada a Administración."
              : "Firma de jefa de ventas registrada correctamente."
      }
    );

    /*
     * =====================================================
     * ACTUALIZA DOCUMENTO DE SOLICITUD
     * =====================================================
     */

    if (hadPendingRequest) {
      await markPendingFichaUpdateRequestsAsReviewedByJefa({
        reviewedBy:
          nombre,

        reviewedByCorreo:
          state.effectiveEmail,

        respuestaJefa
      });

      /*
       * NO creamos alerta info.
       *
       * Esta warning permite que Administración
       * sepa que ya debe atenderla.
       */
      await createFichaAlert({
        titulo:
          "Solicitud revisada por jefa de ventas",

        mensaje:
          `${nombre} revisó una solicitud de actualización.\n\n` +
          `Motivo original: ${pendingRequest?.detalle || "Sin detalle"}\n\n` +
          `Respuesta jefa: ${respuestaJefa}`,

        nivel:
          "warning",

        destinatarioRol:
          "administracion",

        destinatarioCorreo:
          "administracion@raitrai.cl",

        tipo:
          "solicitud_actualizacion_ficha"
      });
    }

    if (hadPendingCorrection) {
      await markPendingFichaCorrectionRequestsAsReviewedByJefa({
        reviewedBy:
          nombre,

        reviewedByCorreo:
          state.effectiveEmail,

        respuestaJefa
      });

      /*
       * También dejamos alerta orientada
       * a Administración para la corrección.
       */
      await createFichaAlert({
        titulo:
          "Corrección revisada por jefa de ventas",

        mensaje:
          `${nombre} revisó una corrección de ficha.\n\n` +
          `Motivo original: ${pendingCorrection?.detalle || "Sin detalle"}\n\n` +
          `Respuesta jefa: ${respuestaJefa}`,

        nivel:
          "warning",

        destinatarioRol:
          "administracion",

        destinatarioCorreo:
          "administracion@raitrai.cl",

        tipo:
          "solicitud_correccion_ficha"
      });
    }

    await refreshFichaUiAfterFlowChange();

    return;
  }

  /*
   * =========================================================
   * FIRMA / CIERRE ADMINISTRACIÓN
   * =========================================================
   */

  if (step === "administracion") {
    if (
      !canActAsFichaAdministracion()
    ) {
      alert(
        "Esta firma solo puede realizarla administración."
      );

      return;
    }

    /*
     * =====================================================
     * VALIDACIÓN NÓMINA
     * =====================================================
     */

    const resumenNomina =
      await obtenerResumenNominaParaFirmaAdmin();

    const debeBloquearFirmaAdmin =
      !isRealAdminRole() &&
      resumenNomina.existeNomina &&
      !resumenNomina.tieneSistemaPagos &&
      !nominaInicialEstaCargadaEnPagos();

    if (debeBloquearFirmaAdmin) {
      alert(
        "Antes de firmar como Administración debes marcar la nómina inicial como Cargado a Pagos.\n\n" +
        "Ve al Portafolio del grupo, hace clic al botón Cargado a Pagos y luego vuelve a firmar."
      );

      return;
    }

    /*
     * =====================================================
     * PROCESO PENDIENTE
     * =====================================================
     */

    const pendingUpdate =
      getLatestOpenFichaUpdateRequest();

    const pendingCorrection =
      getLatestOpenFichaCorrectionRequest();

    const pendingRequest =
      pendingUpdate ||
      pendingCorrection;

    const hadPendingRequest =
      !!pendingRequest;

    const closingCorrection =
      !!pendingCorrection;

    if (
      flow?.administracion?.firmado &&
      !hadPendingRequest
    ) {
      alert(
        "La firma de administración ya está registrada."
      );

      return;
    }

    /*
     * =====================================================
     * EXPLICACIÓN OBLIGATORIA DEL CIERRE
     * =====================================================
     */

    let respuestaAdministracion =
      "";

    if (hadPendingRequest) {
      const tipoProceso =
        closingCorrection
          ? "corrección"
          : "actualización";

      respuestaAdministracion =
        promptRequired(
          [
            `Cierre de ${tipoProceso}`,
            "",
            "Motivo original:",
            pendingRequest?.detalle ||
              "Sin detalle",
            "",
            "Respuesta jefa de ventas:",
            pendingRequest?.respuestaJefa ||
              "Sin respuesta registrada",
            "",
            "¿Qué valida, resuelve o cierra Administración?"
          ].join("\n")
        );

      if (
        respuestaAdministracion === null
      ) {
        return;
      }

      if (!respuestaAdministracion) {
        alert(
          "Debes escribir qué valida, resuelve o cierra Administración."
        );

        return;
      }
    }

    /*
     * =====================================================
     * DETERMINAR SI REALMENTE NECESITA NUEVO PDF
     * =====================================================
     *
     * IMPORTANTE:
     *
     * Cerrar una actualización/corrección NO significa
     * automáticamente crear un nuevo PDF.
     *
     * Si saveFicha() cambió datos que invalidan el PDF,
     * ya habrá dejado:
     *
     * pdfPendienteGeneracion = true
     * y normalmente pdfUrl = ""
     */

    const tienePdfActual =
      !!cleanText(
        state.group?.ficha?.pdfUrl ||
        state.group?.fichaPdfUrl ||
        ""
      );

    const pdfYaEstabaPendiente =
      state.group?.ficha?.pdfPendienteGeneracion === true ||
      state.group?.pdfPendienteGeneracion === true ||
      state.group?.fichaPdfPendienteGeneracion === true;

    const debeGenerarNuevoPdf =
      !tienePdfActual ||
      pdfYaEstabaPendiente;

    /*
     * =====================================================
     * FLOW ADMINISTRACIÓN
     * =====================================================
     */

    const flowPatch = {
      ...(state.group.flowFicha || {}),

      modo:
        "v2",

      legacy:
        false,

      estado:
        "autorizada_admin",

      requiereActualizacion:
        false,

      correccionPendiente:
        false,

      correccionEstado:
        "cerrada",

      requiereRefirmaAdministracion:
        false,

      administracion: {
        ...(state.group.flowFicha?.administracion || {}),

        firmado:
          true,

        firmadoAt:
          serverTimestamp(),

        firmadoPor:
          nombre,

        firmadoPorCorreo:
          state.effectiveEmail,

        /*
         * Guardamos también la explicación
         * directamente en la firma.
         */
        observacion:
          respuestaAdministracion || ""
      }
    };

    /*
     * =====================================================
     * CIERRE ACTUALIZACIÓN / CORRECCIÓN
     * =====================================================
     */

    if (hadPendingRequest) {
      if (closingCorrection) {
        flowPatch.ultimaCorreccion = {
          ...(state.group.flowFicha?.ultimaCorreccion || {}),

          estado:
            "completada",

          respuestaJefa:
            pendingRequest?.respuestaJefa ||
            state.group.flowFicha?.ultimaCorreccion?.respuestaJefa ||
            "",

          respuestaAdministracion,

          cerradaPor:
            nombre,

          cerradaPorCorreo:
            state.effectiveEmail,

          fechaCierre:
            serverTimestamp()
        };
      } else {
        flowPatch.ultimaSolicitudActualizacion = {
          ...(state.group.flowFicha?.ultimaSolicitudActualizacion || {}),

          estado:
            "completada",

          respuestaJefa:
            pendingRequest?.respuestaJefa ||
            state.group.flowFicha?.ultimaSolicitudActualizacion?.respuestaJefa ||
            "",

          respuestaAdministracion,

          cerradaPor:
            nombre,

          cerradaPorCorreo:
            state.effectiveEmail,

          fechaCierre:
            serverTimestamp()
        };

        flowPatch.ultimaActualizacionCerradaAt =
          serverTimestamp();

        flowPatch.ultimaActualizacionCerradaPor =
          nombre;

        flowPatch.ultimaActualizacionCerradaPorCorreo =
          state.effectiveEmail;
      }
    }

    /*
     * =====================================================
     * AUTORIZACIÓN
     * =====================================================
     */

    const anoViajeNum =
      Number(
        state.group?.anoViaje || 0
      );

    const esFichaLegacy2025 =
      anoViajeNum <= 2025;

    /*
     * 2026+:
     *
     * - Si falta PDF nuevo -> todavía NO autorizada.
     * - Si ya existe PDF vigente y no requiere reemplazo
     *   -> puede seguir autorizada.
     */
    const debeQuedarAutorizada =
      esFichaLegacy2025 ||
      (
        tienePdfActual &&
        !debeGenerarNuevoPdf
      );

    const patch = {
      fichaFlujoModo:
        "v2",

      fichaEstado:
        "autorizada_admin",

      firmaAdministracion:
        nombre,

      autorizada:
        debeQuedarAutorizada,

      /*
       * El procedimiento de revisión sí queda cerrado.
       */
      fichaFlujoAbierto:
        false,

      documentos: {
        ...(state.group.documentos || {}),

        fichaGrupo: {
          ...(state.group.documentos?.fichaGrupo || {}),

          estado:
            "autorizada_admin"
        }
      },

      ficha: {
        ...(state.group.ficha || {}),

        flujoModo:
          "v2",

        estado:
          "autorizada_admin",

        /*
         * CLAVE:
         *
         * No forzamos un PDF nuevo solo porque
         * Administración cerró la solicitud.
         */
        pdfPendienteGeneracion:
          debeGenerarNuevoPdf,

        /*
         * Identifica exactamente qué proceso justificará
         * la siguiente generación oficial del PDF.
         *
         * Corrección y actualización producen el mismo resultado:
         * una nueva versión oficial.
         */
        versionPendienteGeneracion:
          debeGenerarNuevoPdf
            ? {
                solicitudId:
                  pendingRequest?.id ||
                  "",

                tipoProceso:
                  closingCorrection
                    ? "correccion_ficha"
                    : hadPendingRequest
                      ? "actualizacion_ficha"
                      : "generacion_original",

                tipoSolicitud:
                  pendingRequest?.tipoSolicitud ||
                  "",

                detalle:
                  pendingRequest?.detalle ||
                  "",

                respuestaJefa:
                  pendingRequest?.respuestaJefa ||
                  "",

                respuestaAdministracion,

                cerradoPor:
                  nombre,

                cerradoPorCorreo:
                  state.effectiveEmail,

                registradoEl:
                  new Date().toISOString()
              }

            : null
      },

      flowFicha:
        flowPatch
    };

    /*
     * =====================================================
     * FIRMA ADMINISTRACIÓN
     * =====================================================
     */

    await saveGroupPatch(
      patch,
      {
        tipoMovimiento:
          hadPendingRequest
            ? (
                closingCorrection
                  ? "refirma_administracion_correccion"
                  : "refirma_administracion_actualizacion"
              )
            : "firma_administracion",

        modulo:
          "ficha",

        titulo:
          hadPendingRequest
            ? (
                closingCorrection
                  ? "Cierre administrativo de corrección"
                  : "Cierre administrativo de actualización"
              )
            : "Firma administración",

        mensaje:
          hadPendingRequest
            ? (
                closingCorrection
                  ? `${nombre} aprobó nuevamente la ficha desde Administración y cerró la corrección.`
                  : `${nombre} aprobó nuevamente la ficha desde Administración y cerró la solicitud de actualización.`
              )
            : `${nombre} autorizó el grupo desde administración.`,

        cambios: [
          {
            campo:
              "autorizada",

            anterior:
              !!state.group.autorizada,

            nuevo:
              debeQuedarAutorizada
          },

          {
            campo:
              "fichaFlujoAbierto",

            anterior:
              !!state.group.fichaFlujoAbierto,

            nuevo:
              false
          },

          {
            campo:
              "fichaEstado",

            anterior:
              state.group.fichaEstado || "",

            nuevo:
              "autorizada_admin"
          },

          {
            campo:
              "ficha.pdfPendienteGeneracion",

            anterior:
              state.group?.ficha?.pdfPendienteGeneracion === true,

            nuevo:
              debeGenerarNuevoPdf
          }
        ],

        reloadAfterSave:
          false,

        successMessage:
          hadPendingRequest
            ? (
                closingCorrection
                  ? "Corrección cerrada correctamente por Administración."
                  : "Actualización cerrada correctamente por Administración."
              )
            : "Firma de administración registrada correctamente."
      }
    );

    /*
     * =====================================================
     * CIERRE DEL DOCUMENTO SOLICITUD + ALERTAS
     * =====================================================
     */

    if (hadPendingRequest) {
      await markOpenFichaUpdateRequestsAsCompleted({
        resolvedBy:
          nombre,

        resolvedByCorreo:
          state.effectiveEmail,

        respuestaAdministracion
      });

      /*
       * Cierra las warnings del proceso.
       *
       * Esto incluye tanto la alerta inicial como
       * las alertas posteriores creadas para Administración.
       */
      await resolveOpenFichaProcessAlerts({
        resolvedBy:
          nombre,

        resolvedByCorreo:
          state.effectiveEmail,

        resolucion:
          respuestaAdministracion
      });

      /*
       * ===================================================
       * HISTORIAL COMPLETO
       * ===================================================
       */

      const tipoProcesoCerrado =
        closingCorrection
          ? "corrección"
          : "actualización";

      await createHistoryEntry({
        tipoMovimiento:
          closingCorrection
            ? "solicitud_correccion_cerrada"
            : "solicitud_actualizacion_cerrada",

        modulo:
          "ficha",

        titulo:
          closingCorrection
            ? "Corrección de ficha cerrada"
            : "Solicitud de actualización cerrada",

        asunto:
          pendingRequest?.asunto ||
          (
            closingCorrection
              ? "Corrección de ficha"
              : "Solicitud de actualización"
          ),

        mensaje:
          [
            `${nombre} cerró la ${tipoProcesoCerrado} de ficha.`,

            `Motivo original: ${
              pendingRequest?.detalle ||
              "Sin detalle"
            }.`,

            `Revisión jefa de ventas: ${
              pendingRequest?.respuestaJefa ||
              "Sin respuesta registrada"
            }.`,

            `Cierre Administración: ${
              respuestaAdministracion
            }.`,

            debeGenerarNuevoPdf
              ? "La ficha quedó pendiente de generación de un nuevo PDF."
              : "No fue necesario generar un nuevo PDF para cerrar este procedimiento."
          ].join(" "),

        metadata: {
          solicitudId:
            pendingRequest?.id || "",

          tipoSolicitud:
            pendingRequest?.tipoSolicitud || "",

          detalleSolicitud:
            pendingRequest?.detalle || "",

          respuestaJefa:
            pendingRequest?.respuestaJefa || "",

          respuestaAdministracion,

          solicitadoPor:
            pendingRequest?.solicitadoPor || "",

          solicitadoPorCorreo:
            pendingRequest?.solicitadoPorCorreo || "",

          cerradoPor:
            nombre,

          cerradoPorCorreo:
            state.effectiveEmail,

          requiereNuevoPdf:
            debeGenerarNuevoPdf,

          pdfExistente:
            tienePdfActual
        }
      });
    }

    await refreshFichaUiAfterFlowChange();

    return;
  }
}

async function saveUpdateRequest() {
  const mode =
    state.requestMode === "correccion"
      ? "correccion"
      : "actualizacion";

  const esCorreccion =
    mode === "correccion";

  /*
   * =========================================================
   * PERMISOS
   * =========================================================
   */

  if (
    esCorreccion &&
    !canRequestFichaCorrection()
  ) {
    showToast(
      "No tienes permisos para solicitar corrección.",
      "warning"
    );

    return;
  }

  if (
    !esCorreccion &&
    !canRequestFichaUpdate()
  ) {
    showToast(
      "No tienes permisos para solicitar actualización.",
      "warning"
    );

    return;
  }

  /*
   * =========================================================
   * EVITAR PROCESOS DUPLICADOS
   * =========================================================
   */

  if (hasOpenFichaProcessRequest()) {
    showToast(
      "Ya existe una solicitud de actualización o corrección abierta para este grupo.",
      "warning"
    );

    closeModal(
      "modalSolicitudFicha"
    );

    return;
  }

  /*
   * =========================================================
   * DATOS SOLICITUD
   * =========================================================
   */

  const asunto =
    getValue(
      "sr_asunto"
    );

  const detalle =
    getValue(
      "sr_detalle"
    );

  if (!detalle) {
    showToast(
      esCorreccion
        ? "Debes explicar qué hay que corregir."
        : "Debes explicar qué hay que actualizar.",

      "warning"
    );

    return;
  }

  const asuntoFinal =
    asunto ||
    (
      esCorreccion
        ? `Corrección ficha · ${
            state.group.aliasGrupo ||
            state.group.colegio ||
            state.groupId
          }`

        : `Actualizar ficha · ${
            state.group.aliasGrupo ||
            state.group.colegio ||
            state.groupId
          }`
    );

  const solicitadoPor =
    getDisplayName(
      state.effectiveUser
    );

  /*
   * =========================================================
   * DOCUMENTO SOLICITUD
   * =========================================================
   */

  await addDoc(
    collection(
      db,
      SOLICITUDES_COLLECTION
    ),
    {
      idGrupo:
        String(
          state.groupId
        ),

      codigoRegistro:
        cleanText(
          state.group.codigoRegistro
        ),

      aliasGrupo:
        cleanText(
          state.group.aliasGrupo
        ),

      colegio:
        cleanText(
          state.group.colegio
        ),

      tipoSolicitud:
        esCorreccion
          ? "correccion_ficha"
          : "actualizacion_ficha",

      asunto:
        asuntoFinal,

      detalle,

      estadoSolicitud:
        esCorreccion
          ? "pendiente_jefa"
          : "pendiente",

      resuelta:
        false,

      destinatarioRol:
        "jefa_ventas",

      destinatarioCorreo:
        "chernandez@raitrai.cl",

      solicitadoPor,

      solicitadoPorCorreo:
        state.effectiveEmail,

      fechaSolicitud:
        serverTimestamp()
    }
  );

  /*
   * =========================================================
   * FLOW GRUPO
   * =========================================================
   */

  const flowActual =
    state.group.flowFicha || {};

  const flowPatch =
    esCorreccion

      ? {
          ...flowActual,

          modo:
            "correccion",

          correccionPendiente:
            true,

          correccionOrigen:
            isStrictAdministracionUser()
              ? "administracion"
              : isRealAdminRole()
                ? "admin"
                : "jefa_ventas",

          correccionEstado:
            "pendiente_jefa",

          correccionSolicitadaPor:
            solicitadoPor,

          correccionSolicitadaPorCorreo:
            state.effectiveEmail,

          correccionSolicitadaAt:
            serverTimestamp(),

          requiereActualizacion:
            false,

          ultimaCorreccion: {
            asunto:
              asuntoFinal,

            detalle,

            solicitadaPor:
              solicitadoPor,

            solicitadaPorCorreo:
              state.effectiveEmail,

            fechaSolicitud:
              serverTimestamp(),

            estado:
              "pendiente_jefa"
          }
        }

      : {
          ...flowActual,

          modo:
            "v2",

          requiereActualizacion:
            true,

          ultimaSolicitudActualizacion: {
            asunto:
              asuntoFinal,

            detalle,

            solicitadaPor:
              solicitadoPor,

            solicitadaPorCorreo:
              state.effectiveEmail,

            fechaSolicitud:
              serverTimestamp(),

            estado:
              "pendiente"
          }
        };

  /*
   * =========================================================
   * ABRIR PROCEDIMIENTO
   * =========================================================
   *
   * IMPORTANTE:
   *
   * Esto abre el procedimiento de revisión,
   * pero NO invalida por sí solo el PDF existente.
   *
   * Si después realmente se modifica la ficha,
   * saveFicha() determinará si debe generarse
   * una nueva versión.
   */

  await setDoc(
    doc(
      db,
      "ventas_cotizaciones",
      state.groupDocId
    ),
    {
      fichaFlujoAbierto:
        true,

      fichaFlujoModo:
        esCorreccion
          ? "correccion"
          : "v2",

      fichaEstado:
        esCorreccion
          ? "correccion_pendiente_jefa"
          : (
              state.group?.fichaEstado ||
              "en_edicion"
            ),

      ficha: {
        ...(state.group.ficha || {}),

        flujoModo:
          esCorreccion
            ? "correccion"
            : "v2",

        estado:
          esCorreccion
            ? "correccion_pendiente_jefa"
            : (
                state.group?.ficha?.estado ||
                state.group?.fichaEstado ||
                "en_edicion"
              )
      },

      flowFicha:
        flowPatch,

      actualizadoPor:
        solicitadoPor,

      actualizadoPorCorreo:
        state.effectiveEmail,

      fechaActualizacion:
        serverTimestamp()
    },
    {
      merge:
        true
    }
  );

  /*
   * =========================================================
   * HISTORIAL
   * =========================================================
   */

  await createHistoryEntry({
    tipoMovimiento:
      esCorreccion
        ? "solicitud_correccion_ficha"
        : "solicitud_actualizacion_ficha",

    modulo:
      "ficha",

    titulo:
      esCorreccion
        ? "Solicitud de corrección de ficha"
        : "Solicitud de actualización de ficha",

    asunto:
      asuntoFinal,

    mensaje:
      esCorreccion
        ? `${solicitadoPor} solicitó corrección de la ficha. Motivo: ${detalle}`
        : `${solicitadoPor} solicitó actualización de la ficha. Motivo: ${detalle}`,

    metadata: {
      asunto:
        asuntoFinal,

      detalleSolicitud:
        detalle,

      destinatarioCorreo:
        "chernandez@raitrai.cl",

      tipoSolicitud:
        esCorreccion
          ? "correccion_ficha"
          : "actualizacion_ficha",

      solicitadoPor,

      solicitadoPorCorreo:
        state.effectiveEmail
    }
  });

  /*
   * =========================================================
   * ALERTA AUTOMÁTICA
   * =========================================================
   */

  await createFichaAlert({
    titulo:
      esCorreccion
        ? "Corrección de ficha solicitada"
        : "Solicitud de actualización de ficha",

    mensaje:
      esCorreccion
        ? `${solicitadoPor} solicitó corregir la ficha.\n\nMotivo: ${detalle}`
        : `${solicitadoPor} solicitó actualizar la ficha.\n\nMotivo: ${detalle}`,

    nivel:
      "warning",

    destinatarioRol:
      "jefa_ventas",

    destinatarioCorreo:
      "chernandez@raitrai.cl",

    tipo:
      esCorreccion
        ? "solicitud_correccion_ficha"
        : "solicitud_actualizacion_ficha"
  });

  /*
   * =========================================================
   * CIERRE UI
   * =========================================================
   */

  state.requestMode =
    "";

  closeModal(
    "modalSolicitudFicha"
  );

  await loadAll();

  showToast(
    esCorreccion
      ? "Corrección enviada a jefa de ventas correctamente."
      : "Solicitud de actualización enviada a jefa de ventas correctamente.",

    "success"
  );
}

function buildSharedGroupPatchFromFicha(values = {}) {
  /*
   * =========================================================
   * ESPEJO OFICIAL FICHA -> GRUPO
   * =========================================================
   *
   * Solamente sincronizamos aquí datos que tienen
   * equivalente real entre:
   *
   * - Editar datos de grupo
   * - Ficha
   *
   * NO modificamos:
   * - vendedor asignado;
   * - curso/colegio;
   * - fechas operativas reales;
   * - firmas;
   * - PDF.
   */

  const destinoSeleccion =
    cleanText(
      values.destinoPrincipal || ""
    );

  const destinoOtro =
    cleanText(
      values.destinoPrincipalOtro || ""
    );

  const programaSeleccion =
    cleanText(
      values.programa || ""
    );

  const programaOtro =
    cleanText(
      values.programaOtro || ""
    );

  const tramoSeleccion =
    cleanText(
      values.tramoSeleccion || ""
    );

  const tramoOtro =
    cleanText(
      values.tramoOtro || ""
    );

  const mesSeleccion =
    cleanText(
      values.mesViaje || ""
    );

  const mesOtro =
    cleanText(
      values.mesViajeOtro || ""
    );

  const patch = {
    /*
     * CONTACTO PRINCIPAL
     */
    nombreCliente:
      cleanText(
        values.apoderadoEncargado || ""
      ),

    correoCliente:
      normalizeEmail(
        values.correo || ""
      ),

    celularCliente:
      sanitizeChileMobileForSave(
        values.telefono || ""
      ),

    /*
     * DESTINO
     */
    destinoPrincipal:
      destinoSeleccion === "OTRO"
        ? "OTRO"
        : destinoSeleccion,

    destinoPrincipalOtro:
      destinoSeleccion === "OTRO"
        ? destinoOtro
        : "",

    /*
     * PROGRAMA
     */
    programa:
      programaSeleccion === "OTRO"
        ? "OTRO"
        : programaSeleccion,

    programaOtro:
      programaSeleccion === "OTRO"
        ? programaOtro
        : "",

    /*
     * CANTIDAD GRUPO
     */
    cantidadGrupo:
      values.numeroPaxTotal ?? "",

    /*
     * TRAMO
     */
    tramo:
      tramoSeleccion === "OTRO"
        ? "OTRO"
        : tramoSeleccion,

    tramoOtro:
      tramoSeleccion === "OTRO"
        ? tramoOtro
        : "",

    /*
     * MES / INDICACIÓN TENTATIVA
     *
     * mesViaje guarda el mes principal.
     *
     * mesViajeOtro guarda una especificación opcional
     * para cualquier mes:
     *
     * NOVIEMBRE + Segunda quincena
     * SEPTIEMBRE + Primera semana
     *
     * También sigue soportando:
     *
     * OTRO + texto libre
     *
     * NO escribimos fechaInicioViaje,
     * fechaFinViaje ni fechaViaje real.
     */
    mesViaje:
      mesSeleccion,

    mesViajeOtro:
      mesOtro,

    /*
     * Campo antiguo utilizado por otras partes
     * del sistema.
     *
     * Priorizamos la especificación si existe.
     */
    semanaViaje:
      mesOtro ||
      mesSeleccion ||
      values.fechaViajeTexto ||
      "",

    /*
     * OTROS CAMPOS CON ESPEJO REAL
     */
    descuento:
      values.descuentoValorBase || "",

    asistenciaEnViajes:
      values.asistenciaEnViajes || "",

    asistenciaMed:
      values.asistenciaEnViajes || "",

    observacionesOperaciones:
      values.infoOperacionesHtml || "",

    observacionesAdministracion:
      values.infoAdministracionHtml || ""
  };

  setNestedValue(
    patch,
    "situacion.observacionOperaciones",
    values.infoOperacionesHtml || ""
  );

  setNestedValue(
    patch,
    "situacion.observacionAdministracion",
    values.infoAdministracionHtml || ""
  );

  return patch;
}

function isAdministrativeReviewEditor() {
  return isJefaVentas() || canActAsFichaAdministracion();
}

function isEmptyFichaFieldValue(path = "", value = "") {
  if (isRichField(path)) {
    return !normalizeRichHtml(value || "");
  }
  return !cleanText(value || "");
}

function shouldIgnoreTrackedFichaChange(path = "", anterior = "", nuevo = "") {
  /*
    Campos propios de administración.
    Si los modifica Yenny / administracion@raitrai.cl / raitrai@raitrai.cl,
    NO deben reabrir flujo ni volver a firma de vendedor.
  */
  const adminOnlySafeFields = new Set([
    "numeroNegocio",
    "usuarioFicha",
    "claveAdministrativa"
  ]);

  if (canActAsFichaAdministracion() && adminOnlySafeFields.has(path)) {
    return true;
  }

  /*
    Regla general:
    Observaciones puede completarse por primera vez sin reabrir flujo
    si la edita jefa de ventas o administración.
  */
  if (!isAdministrativeReviewEditor()) return false;

  const firstFillSafeFields = new Set([
    "observacionesHtml"
  ]);

  if (!firstFillSafeFields.has(path)) return false;

  return (
    isEmptyFichaFieldValue(path, anterior) &&
    !isEmptyFichaFieldValue(path, nuevo)
  );
}

function shouldReopenFlowAfterFichaSave(trackedChanges = []) {
  if (!isAdministrativeReviewEditor()) return false;
  if (!trackedChanges.length) return false;

  const flow = state.group?.flowFicha || {};
  const fichaEstado = normalizeSearchLocal(state.group?.fichaEstado || "");

  const downstreamStarted =
    !!flow?.jefaVentas?.firmado ||
    !!flow?.administracion?.firmado ||
    !!state.group?.autorizada ||
    [
      "revisada_jefa_ventas",
      "autorizada_admin",
      "confirmada_pdf",
      "ok"
    ].includes(fichaEstado);

  return !!flow?.vendedor?.firmado && downstreamStarted;
}

function isAccidentalFichaMassClear(previousFicha = {}, values = {}) {
  const protectedFields = [
    "solicitudReserva",
    "nombreGrupo",
    "apoderadoEncargado",
    "telefono",
    "correo",
    "nombrePrograma",
    "valorPrograma",
    "numeroPaxTotal",
    "tramo",
    "liberados",
    "categoriaHoteleraContratada",
    "autorizacionGerencia",
    "descuentoValorBase",
    "fechaViajeTexto",
    "asistenciaEnViajes",
    "nombreVendedor",
    "numeroNegocio",
    "usuarioFicha",
    "claveAdministrativa",
    "infoOperacionesHtml",
    "infoAdministracionHtml"
  ];

  const deleted = protectedFields.filter((field) => {
    const before = isRichField(field)
      ? normalizeRichHtml(previousFicha[field] || "")
      : cleanText(previousFicha[field] || "");

    const after = isRichField(field)
      ? normalizeRichHtml(values[field] || "")
      : cleanText(values[field] || "");

    return before && !after;
  });

  return deleted.length >= 5;
}

/* =========================================================
   SAVE
========================================================= */
async function saveFicha({
  silent = false,
  reloadAfterSave = true
} = {}) {
  if (!canEditFicha()) {
    showToast(
      getBlockedEditMessage(),
      "warning"
    );

    return {
      ok: false,
      reason: "blocked"
    };
  }

  const oldFicha =
    state.group?.ficha || {};

  const previousFichaView =
    state.ficha ||
    hydrateFicha(
      state.group || {}
    );

  const flow =
    state.group?.flowFicha || {};

  const nowText =
    formatDateTime(
      new Date()
    );

  /*
   * =========================================================
   * DESTINO
   * =========================================================
   *
   * Si el HTML nuevo todavía no tiene estos selectores,
   * conservamos el dato actual.
   */

  const destinoRaw =
    $("f_destinoPrincipal")
      ? getValue("f_destinoPrincipal")
      : (
          previousFichaView.destinoPrincipal ||
          state.group?.destinoPrincipal ||
          ""
        );

  const destinoPrincipal =
    normalizeFichaDestinoCanonical(
      destinoRaw
    );

  const destinoPrincipalOtro =
    destinoPrincipal === "OTRO"
      ? (
          $("f_destinoPrincipalOtro")
            ? getValue("f_destinoPrincipalOtro")
            : (
                previousFichaView.destinoPrincipalOtro ||
                state.group?.destinoPrincipalOtro ||
                ""
              )
        )
      : "";

  /*
   * =========================================================
   * PROGRAMA
   * =========================================================
   */

  const programaOptions =
    getFichaProgramOptionsByDestino(
      destinoPrincipal === "OTRO"
        ? destinoPrincipalOtro
        : destinoPrincipal
    );

  let programa =
    "";

  let programaOtro =
    "";

  if ($("f_programa")) {
    const raw =
      getValue(
        "f_programa"
      );

    const canonical =
      findFichaCanonicalOption(
        programaOptions.length
          ? programaOptions
          : ["OTRO"],
        raw
      );

    programa =
      canonical ||
      (
        raw
          ? "OTRO"
          : ""
      );

    programaOtro =
      programa === "OTRO"
        ? (
            getValue(
              "f_programaOtro"
            ) ||
            (
              canonical
                ? ""
                : raw
            )
          )
        : "";
  } else {
    /*
     * Compatibilidad con el HTML actual:
     * f_nombrePrograma todavía puede ser un input libre.
     */
    const nombreProgramaLegacy =
      getValue(
        "f_nombrePrograma"
      );

    const canonical =
      findFichaCanonicalOption(
        programaOptions.length
          ? programaOptions
          : ["OTRO"],
        nombreProgramaLegacy
      );

    if (canonical) {
      programa =
        canonical;

      programaOtro =
        "";
    } else if (
      nombreProgramaLegacy
    ) {
      programa =
        "OTRO";

      programaOtro =
        nombreProgramaLegacy;
    } else {
      programa =
        previousFichaView.programa ||
        state.group?.programa ||
        "";

      programaOtro =
        previousFichaView.programaOtro ||
        state.group?.programaOtro ||
        "";
    }
  }

  const nombrePrograma =
    getFichaSharedDisplayValue(
      programa,
      programaOtro
    );

  /*
   * =========================================================
   * TRAMO
   * =========================================================
   */

  let tramoSeleccion =
    "";

  let tramoOtro =
    "";

  if ($("f_tramoSeleccion")) {
    const raw =
      getValue(
        "f_tramoSeleccion"
      );

    const canonical =
      findFichaCanonicalOption(
        FICHA_TRAMO_OPTIONS,
        raw
      );

    tramoSeleccion =
      canonical ||
      (
        raw
          ? "OTRO"
          : ""
      );

    tramoOtro =
      tramoSeleccion === "OTRO"
        ? (
            getValue(
              "f_tramoOtro"
            ) ||
            (
              canonical
                ? ""
                : raw
            )
          )
        : "";
  } else {
    /*
     * Compatibilidad con f_tramo antiguo.
     */
    const tramoLegacy =
      getValue(
        "f_tramo"
      );

    const canonical =
      findFichaCanonicalOption(
        FICHA_TRAMO_OPTIONS,
        tramoLegacy
      );

    if (canonical) {
      tramoSeleccion =
        canonical;

      tramoOtro =
        "";
    } else if (tramoLegacy) {
      tramoSeleccion =
        "OTRO";

      tramoOtro =
        tramoLegacy;
    } else {
      tramoSeleccion =
        previousFichaView.tramoSeleccion ||
        state.group?.tramo ||
        "";

      tramoOtro =
        previousFichaView.tramoOtro ||
        state.group?.tramoOtro ||
        "";
    }
  }

  const tramo =
    getFichaSharedDisplayValue(
      tramoSeleccion,
      tramoOtro
    );

  /*
   * =========================================================
   * MES / FECHA TENTATIVA
   * =========================================================
   */

  const fechaViajeTextoInput =
    getValue(
      "f_fechaViajeTexto"
    );

  let mesViaje =
    "";

  let mesViajeOtro =
    "";

  if ($("f_mesViaje")) {
    const raw =
      getValue(
        "f_mesViaje"
      );

    const canonical =
      findFichaCanonicalOption(
        FICHA_MES_VIAJE_OPTIONS,
        raw
      );

    /*
     * Si el selector trae un mes reconocido,
     * guardamos ese mes.
     *
     * Si por compatibilidad llega texto libre,
     * se convierte en OTRO.
     */
    mesViaje =
      canonical ||
      (
        raw
          ? "OTRO"
          : ""
      );

    /*
     * NUEVA REGLA:
     *
     * mesViajeOtro siempre puede contener
     * una especificación opcional,
     * independientemente del mes.
     */
    mesViajeOtro =
      cleanText(
        getValue(
          "f_mesViajeOtro"
        )
      );

    /*
     * Si llegó texto libre directamente al selector
     * por alguna ficha antigua/intermedia,
     * lo conservamos como especificación de OTRO.
     */
    if (
      mesViaje === "OTRO" &&
      !mesViajeOtro &&
      raw &&
      !canonical
    ) {
      mesViajeOtro =
        raw;
    }
  } else {
    /*
     * Compatibilidad con HTML/fichas antiguas.
     */
    const canonical =
      findFichaCanonicalOption(
        FICHA_MES_VIAJE_OPTIONS,
        fechaViajeTextoInput
      );

    if (canonical) {
      mesViaje =
        canonical;

      mesViajeOtro =
        previousFichaView.mesViajeOtro ||
        state.group?.mesViajeOtro ||
        "";
    } else if (
      fechaViajeTextoInput
    ) {
      mesViaje =
        "OTRO";

      mesViajeOtro =
        fechaViajeTextoInput;
    } else {
      mesViaje =
        previousFichaView.mesViaje ||
        state.group?.mesViaje ||
        "";

      mesViajeOtro =
        previousFichaView.mesViajeOtro ||
        state.group?.mesViajeOtro ||
        "";
    }
  }

  /*
   * Texto de compatibilidad.
   *
   * Si hay especificación, esa es la descripción
   * más precisa.
   *
   * Si no, usamos el mes.
   */
  const fechaViajeTexto =
    mesViajeOtro ||
    mesViaje ||
    fechaViajeTextoInput ||
    "";

  /*
   * =========================================================
   * VALORES DE FICHA
   * =========================================================
   */

  const values = {
    solicitudReserva:
      getValue(
        "f_solicitudReserva"
      ),

    nombreGrupo:
      getValue(
        "f_nombreGrupo"
      ),

    apoderadoEncargado:
      getValue(
        "f_apoderadoEncargado"
      ),

    telefono:
      getValue(
        "f_telefono"
      ),

    correo:
      getValue(
        "f_correo"
      ),

    destinoPrincipal,

    destinoPrincipalOtro,

    programa,

    programaOtro,

    nombrePrograma,

    programaPdfUrl:
      cleanText(
        oldFicha.programaPdfUrl || ""
      ),

    programaPdfNombre:
      cleanText(
        oldFicha.programaPdfNombre || ""
      ),

    programaPdfStoragePath:
      cleanText(
        oldFicha.programaPdfStoragePath || ""
      ),

    programaPdfSubidoPor:
      cleanText(
        oldFicha.programaPdfSubidoPor || ""
      ),

    programaPdfSubidoPorCorreo:
      cleanText(
        oldFicha.programaPdfSubidoPorCorreo || ""
      ),

    programaPdfSubidoEl:
      oldFicha.programaPdfSubidoEl ||
      null,

    valorPrograma:
      getValue(
        "f_valorPrograma"
      ),

    numeroPaxTotal:
      getValue(
        "f_numeroPaxTotal"
      ),

    tramoSeleccion,

    tramoOtro,

    tramo,

    liberados:
      getValue(
        "f_liberados"
      ),

    categoriaHoteleraContratada:
      getValue(
        "f_categoriaHoteleraContratada"
      ),

    autorizacionGerencia:
      getValue(
        "f_autorizacionGerencia"
      ),

    descuentoValorBase:
      getValue(
        "f_descuentoValorBase"
      ),

    mesViaje,

    mesViajeOtro,

    fechaViajeTexto,

    asistenciaEnViajes:
      getValue(
        "f_asistenciaEnViajes"
      ),

    nombreVendedor:
      getValue(
        "f_nombreVendedor"
      ),

    numeroNegocio:
      getValue(
        "f_numeroNegocio"
      ),

    usuarioFicha:
      getValue(
        "f_usuarioFicha"
      ),

    claveAdministrativa:
      getValue(
        "f_claveAdministrativa"
      ),

    version:
      getValue(
        "f_version"
      ) || "ORIGINAL",

    fechaActualizacionTexto:
      nowText,

    infoOperacionesHtml:
      getRichEditorHtml(
        "f_infoOperaciones"
      ),

    infoAdministracionHtml:
      getRichEditorHtml(
        "f_infoAdministracion"
      ),

    observacionesHtml:
      getRichEditorHtml(
        "f_observacionesHtml"
      ),

    pdfUrl:
      cleanText(
        oldFicha.pdfUrl || ""
      ),

    pdfNombre:
      cleanText(
        oldFicha.pdfNombre || ""
      )
  };

  /*
   * =========================================================
   * LIMITACIÓN ADMINISTRACIÓN OPERATIVA
   * =========================================================
   */

  if (
    isAdministracionLimitedAfterVendorSign()
  ) {
    FICHA_FIELDS.forEach(
      (fieldName) => {
        if (
          ADMIN_LIMITED_FICHA_FIELDS.has(
            fieldName
          )
        ) {
          return;
        }

        if (
          Object.prototype.hasOwnProperty.call(
            values,
            fieldName
          )
        ) {
          values[fieldName] =
            previousFichaView?.[fieldName] ??
            oldFicha?.[fieldName] ??
            "";
        }
      }
    );

    values.fechaActualizacionTexto =
      nowText;
  }

  const observacionesPlain =
    richHtmlToPlainText(
      values.observacionesHtml
    );

  /*
   * Blindaje contra borrado masivo.
   */
  if (
    isAccidentalFichaMassClear(
      previousFichaView,
      values
    )
  ) {
    showToast(
      "Se detectó que la ficha quedaría casi vacía. No se guardó para evitar borrar datos existentes. Recarga la página e intenta nuevamente.",
      "error",
      {
        duration: 7000
      }
    );

    console.warn(
      "[fichas] Guardado bloqueado por posible borrado masivo accidental",
      {
        previousFichaView,
        values
      }
    );

    return {
      ok: false,
      reason: "mass_clear_guard"
    };
  }

  /*
   * =========================================================
   * CAMBIOS
   * =========================================================
   */

  const actualChanges = [];
  const trackedChanges = [];

  for (
    const path of FICHA_FIELDS
  ) {
    const anterior =
      previousFichaView[path];

    const nuevo =
      values[path];

    const changed =
      isRichField(path)
        ? (
            normalizeRichHtml(
              anterior || ""
            ) !==
            normalizeRichHtml(
              nuevo || ""
            )
          )
        : !sameValue(
            anterior,
            nuevo
          );

    if (!changed) {
      continue;
    }

    const anteriorSafe =
      anterior ?? "";

    const nuevoSafe =
      nuevo ?? "";

    actualChanges.push({
      campo:
        `ficha.${path}`,

      anterior:
        anteriorSafe,

      nuevo:
        nuevoSafe
    });

    if (
      !shouldIgnoreTrackedFichaChange(
        path,
        anteriorSafe,
        nuevoSafe
      )
    ) {
      trackedChanges.push({
        campo:
          `ficha.${path}`,

        anterior:
          anteriorSafe,

        nuevo:
          nuevoSafe
      });
    }
  }

  const fichaWasEmpty =
    !Object.keys(
      oldFicha || {}
    ).length;

  if (
    !actualChanges.length &&
    !fichaWasEmpty
  ) {
    if (!silent) {
      showToast(
        "No hay cambios para guardar.",
        "warning"
      );
    }

    return {
      ok: true,
      changed: false
    };
  }

  const adminImportantChanges =
    getAdminImportantFichaChanges(
      previousFichaView,
      values
    );

  const reopenFlowByNormalRules =
    shouldReopenFlowAfterFichaSave(
      trackedChanges
    );

  const reopenFlowByCarolaCorrection =
    shouldCarolaOpenCorrectionOnSave() &&
    trackedChanges.length > 0;

  const reopenFlow =
    reopenFlowByNormalRules ||
    reopenFlowByCarolaCorrection;

  const nextFlowMode =
    reopenFlowByCarolaCorrection
      ? "correccion"
      : (
          isFichaUpdateFlowOpen()
            ? "actualizacion"
            : "v2"
        );

  const nextFichaEstado =
    reopenFlow
      ? "lista_vendedor"
      : (
          state.group?.fichaEstado &&
          state.group.fichaEstado !==
            "pendiente"
            ? state.group.fichaEstado
            : "en_edicion"
        );

  const nombreGrupoManualNuevo =
    cleanText(
      values.nombreGrupo || ""
    );

  /*
   * =========================================================
   * PATCH FICHA
   * =========================================================
   */

  const patch = {
    ficha: {
      ...(oldFicha || {}),

      ...values,

      nombreGrupo:
        nombreGrupoManualNuevo,

      estado:
        nextFichaEstado,

      actualizadoPor:
        getDisplayName(
          state.effectiveUser
        ),

      actualizadoPorCorreo:
        state.effectiveEmail,

      fechaActualizacion:
        serverTimestamp()
    },

    /*
     * El nombre escrito en ficha sigue siendo
     * el nombre manual oficial del grupo.
     */
    nombreGrupo:
      nombreGrupoManualNuevo,

    aliasGrupo:
      nombreGrupoManualNuevo,

    nombreGrupoManual:
      true,

    /*
     * CAMPOS PROPIOS DE FICHA / ADMINISTRACIÓN
     */
    solicitudReserva:
      values.solicitudReserva,

    categoriaHoteleraContratada:
      values.categoriaHoteleraContratada,

    autorizacionGerencia:
      values.autorizacionGerencia,

    liberados:
      values.liberados,

    valorPrograma:
      values.valorPrograma,

    numeroNegocio:
      values.numeroNegocio,

    usuarioProgramaAdm:
      values.usuarioFicha,

    claveAdministrativa:
      values.claveAdministrativa,

    versionFicha:
      values.version,

    fechaActualizacionFicha:
      serverTimestamp(),

    camposAdministracionModificados:
      adminImportantChanges,

    observacionesFicha:
      observacionesPlain,

    fichaEstado:
      nextFichaEstado,

    actualizadoPor:
      getDisplayName(
        state.effectiveUser
      ),

    actualizadoPorCorreo:
      state.effectiveEmail,

    fechaActualizacion:
      serverTimestamp()
  };

  /*
   * =========================================================
   * ESPEJO FICHA -> DATOS OFICIALES DEL GRUPO
   * =========================================================
   */

  const sharedGroupPatch =
    buildSharedGroupPatchFromFicha(
      values
    );

  Object.assign(
    patch,
    sharedGroupPatch
  );

  /*
   * =========================================================
   * REAPERTURA DEL FLUJO
   * =========================================================
   */

  if (reopenFlow) {
    patch.autorizada =
      false;

    patch.firmaSupervision =
      "";

    patch.firmaAdministracion =
      "";

    patch.fichaPdfUrl =
      "";

    patch.fichaPdfNombre =
      "";

    patch.fichaFlujoAbierto =
      true;

    patch.fichaFlujoModo =
      nextFlowMode;

    patch.ficha = {
      ...patch.ficha,

      flujoModo:
        nextFlowMode,

      estado:
        reopenFlowByCarolaCorrection
          ? "correccion_pendiente_jefa"
          : "lista_vendedor",

      confirmada:
        false,

      pdfPendienteGeneracion:
        true,
      
      versionPendienteGeneracion: {
        solicitudId:
          "",

        tipoProceso:
          reopenFlowByCarolaCorrection
            ? "correccion_ficha"
            : nextFlowMode === "actualizacion"
              ? "actualizacion_ficha"
              : "edicion_ficha",

        tipoSolicitud:
          reopenFlowByCarolaCorrection
            ? "correccion_ficha"
            : nextFlowMode === "actualizacion"
              ? "actualizacion_ficha"
              : "edicion_ficha",

        detalle:
          reopenFlowByCarolaCorrection
            ? "Ficha reabierta por corrección."
            : nextFlowMode === "actualizacion"
              ? "Ficha reabierta por solicitud de actualización."
              : "Ficha reabierta debido a cambios que invalidan el PDF vigente.",

        solicitadoPor:
          getDisplayName(
            state.effectiveUser
          ),

        solicitadoPorCorreo:
          state.effectiveEmail,

        registradoEl:
          new Date().toISOString()
      },
      /*
       * Solo se invalida PDF activo.
       */
      pdfUrl:
        "",

      pdfNombre:
        "",

      /*
       * Conservamos identidad e historial
       * de la versión anterior.
       */
      tipoVersion:
        oldFicha?.tipoVersion ||
        state.group?.tipoVersionFicha ||
        "original",

      version:
        oldFicha?.version ||
        state.group?.versionFicha ||
        values.version ||
        "ORIGINAL",

      versionNumero:
        Number(
          oldFicha?.versionNumero ??
          state.group?.versionFichaNumero ??
          1
        ) || 1,

      confirmadaEl:
        oldFicha?.confirmadaEl ||
        null,

      confirmadaPor:
        oldFicha?.confirmadaPor ||
        "",

      confirmadaPorCorreo:
        oldFicha?.confirmadaPorCorreo ||
        "",

      storagePathPdf:
        oldFicha?.storagePathPdf ||
        "",

      pdfHistorial:
        Array.isArray(
          oldFicha?.pdfHistorial
        )
          ? oldFicha.pdfHistorial
          : [],

      camposAdministracionModificados:
        adminImportantChanges
    };

    patch.flowFicha = {
      ...(state.group.flowFicha || {}),

      modo:
        nextFlowMode,

      legacy:
        false,

      estado:
        reopenFlowByCarolaCorrection
          ? "correccion_pendiente_jefa"
          : "lista_vendedor",

      requiereActualizacion:
        nextFlowMode ===
        "actualizacion",

      requiereRefirmaAdministracion:
        true,

      correccionPendiente:
        reopenFlowByCarolaCorrection
          ? true
          : (
              state.group.flowFicha
                ?.correccionPendiente ||
              false
            ),

      correccionOrigen:
        reopenFlowByCarolaCorrection
          ? "jefa_ventas"
          : (
              state.group.flowFicha
                ?.correccionOrigen ||
              ""
            ),

      correccionEstado:
        reopenFlowByCarolaCorrection
          ? "pendiente_jefa"
          : (
              state.group.flowFicha
                ?.correccionEstado ||
              ""
            ),

      camposAdministracionModificados:
        adminImportantChanges,

      jefaVentas: {
        ...(flow?.jefaVentas || {}),

        firmado:
          false,

        firmadoAt:
          null,

        firmadoPor:
          "",

        firmadoPorCorreo:
          "",

        observacion:
          ""
      },

      administracion: {
        ...(flow?.administracion || {}),

        firmado:
          false,

        firmadoAt:
          null,

        firmadoPor:
          "",

        firmadoPorCorreo:
          "",

        observacion:
          ""
      }
    };

    patch.documentos = {
      ...(state.group.documentos || {}),

      fichaGrupo: {
        ...(state.group.documentos
          ?.fichaGrupo || {}),

        estado:
          reopenFlowByCarolaCorrection
            ? "correccion_pendiente_jefa"
            : "lista_vendedor"
      }
    };
  }

  /*
   * =========================================================
   * GUARDAR
   * =========================================================
   */

  await setDoc(
    doc(
      db,
      "ventas_cotizaciones",
      state.groupDocId
    ),
    patch,
    {
      merge: true
    }
  );

  const historyChanges = [
    ...trackedChanges
  ];

  if (reopenFlow) {
    historyChanges.push(
      {
        campo:
          "fichaEstado",

        anterior:
          state.group?.fichaEstado ||
          "",

        nuevo:
          reopenFlowByCarolaCorrection
            ? "correccion_pendiente_jefa"
            : "lista_vendedor"
      },

      {
        campo:
          "flowFicha.jefaVentas.firmado",

        anterior:
          !!state.group?.flowFicha
            ?.jefaVentas?.firmado,

        nuevo:
          false
      },

      {
        campo:
          "flowFicha.administracion.firmado",

        anterior:
          !!state.group?.flowFicha
            ?.administracion?.firmado,

        nuevo:
          false
      },

      {
        campo:
          "firmaSupervision",

        anterior:
          state.group
            ?.firmaSupervision ||
          "",

        nuevo:
          ""
      },

      {
        campo:
          "firmaAdministracion",

        anterior:
          state.group
            ?.firmaAdministracion ||
          "",

        nuevo:
          ""
      }
    );
  }

  /*
   * =========================================================
   * HISTORIAL
   * =========================================================
   */

  if (
    fichaWasEmpty ||
    historyChanges.length
  ) {
    const editorLabel =
      isAdministracion()
        ? "administración"
        : isJefaVentas()
          ? "jefa de ventas"
          : "usuario";

    const observacionesChanged =
      historyChanges.some(
        (item) =>
          item.campo ===
          "ficha.observacionesHtml"
      );

    const observacionesMsg =
      observacionesChanged
        ? (
            observacionesPlain
              ? ` Observaciones ficha: ${truncateForHistory(observacionesPlain)}.`
              : " Observaciones ficha vaciadas."
          )
        : "";

    await addDoc(
      collection(
        db,
        HISTORIAL_COLLECTION
      ),
      {
        idGrupo:
          String(
            state.groupId
          ),

        codigoRegistro:
          cleanText(
            state.group?.codigoRegistro
          ),

        aliasGrupo:
          cleanText(
            nombreGrupoManualNuevo ||
            state.group?.aliasGrupo
          ),

        colegio:
          cleanText(
            state.group?.colegio
          ),

        tipoMovimiento:
          reopenFlow
            ? "ficha_actualizada_reabre_flujo"
            : (
                fichaWasEmpty
                  ? "ficha_creada"
                  : "ficha_actualizada"
              ),

        modulo:
          "ficha",

        titulo:
          reopenFlow
            ? "Actualización de ficha con reapertura de flujo"
            : (
                fichaWasEmpty
                  ? "Creación de ficha"
                  : "Actualización de ficha"
              ),

        mensaje:
          reopenFlow
            ? `${getDisplayName(state.effectiveUser)} actualizó la ficha desde ${editorLabel}. La revisión vuelve a jefa de ventas y luego a administración.${observacionesMsg}`
            : `${getDisplayName(state.effectiveUser)} ${fichaWasEmpty ? "creó" : "actualizó"} la ficha del grupo.${observacionesMsg}`,

        metadata: {
          cambios:
            historyChanges
        },

        creadoPor:
          getDisplayName(
            state.effectiveUser
          ),

        creadoPorCorreo:
          state.effectiveEmail,

        fecha:
          serverTimestamp()
      }
    );
  }

  if (reloadAfterSave) {
    await loadAll();
  }

  if (!silent) {
    showToast(
      reopenFlow
        ? "Ficha guardada correctamente. El flujo volvió a revisión de jefa de ventas y luego administración."
        : "Ficha guardada correctamente.",
      "success"
    );
  }

  return {
    ok: true,
    changed: true,
    reopenFlow,
    trackedChanges:
      trackedChanges.length
  };
}

async function saveGroupPatch(patch, {
  tipoMovimiento = "movimiento",
  modulo = "ficha",
  titulo = "Movimiento",
  mensaje = "",
  cambios = [],
  reloadAfterSave = true,
  successMessage = "",
  successType = "success"
} = {}) {
  patch.actualizadoPor = getDisplayName(state.effectiveUser);
  patch.actualizadoPorCorreo = state.effectiveEmail;
  patch.fechaActualizacion = serverTimestamp();

  await setDoc(doc(db, "ventas_cotizaciones", state.groupDocId), patch, { merge: true });

  await createHistoryEntry({
    tipoMovimiento,
    modulo,
    titulo,
    mensaje,
    metadata: { cambios }
  });

  if (reloadAfterSave) {
    await loadAll();
  }

  if (successMessage) {
    showToast(successMessage, successType);
  }
}

function sanitizeForFirestore(value) {
  if (value === undefined) return "";

  if (value === null) return null;

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForFirestore(item));
  }

  if (
    typeof value === "object" &&
    value !== null &&
    !(value instanceof Date) &&
    typeof value?.toDate !== "function"
  ) {
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = sanitizeForFirestore(val);
    }
    return out;
  }

  return value;
}

async function createHistoryEntry({
  tipoMovimiento = "movimiento",
  modulo = "ficha",
  titulo = "Movimiento",
  mensaje = "",
  metadata = {}
} = {}) {
  await addDoc(collection(db, HISTORIAL_COLLECTION), {
    idGrupo: String(state.groupId),
    codigoRegistro: cleanText(state.group?.codigoRegistro),
    aliasGrupo: cleanText(state.group?.aliasGrupo),
    colegio: cleanText(state.group?.colegio),
    tipoMovimiento,
    modulo,
    titulo,
    mensaje,
    metadata: sanitizeForFirestore(metadata),
    creadoPor: getDisplayName(state.effectiveUser),
    creadoPorCorreo: state.effectiveEmail,
    fecha: serverTimestamp()
  });
}

/* =========================================================
   DATA BUILD
========================================================= */
function hydrateFicha(group = {}) {
  const ficha =
    getByPath(
      group,
      "ficha"
    ) || {};

  const situacion =
    getByPath(
      group,
      "situacion"
    ) || {};

  /*
   * =========================================================
   * DESTINO
   * =========================================================
   *
   * Prioridad:
   *
   * 1. estructura nueva dentro de ficha;
   * 2. estructura antigua/raíz del grupo.
   *
   * Si encontramos un texto que ya no pertenece
   * al catálogo actual, NO lo descartamos:
   * se transforma visualmente en OTRO + texto.
   */

  const destinoLegacy =
    cleanText(
      ficha.destinoPrincipal ||
      group.destinoPrincipal ||
      ""
    );

  const destinoOtroLegacy =
    cleanText(
      ficha.destinoPrincipalOtro ||
      group.destinoPrincipalOtro ||
      ""
    );

  const destinoBase =
    resolveFichaLegacySelector({
      options:
        FICHA_DESTINO_PRINCIPAL_OPTIONS,

      selected:
        destinoLegacy,

      other:
        destinoOtroLegacy,

      legacyValue:
        destinoOtroLegacy ||
        destinoLegacy
    });

  const destinoPrincipal =
    destinoBase.selected;

  const destinoPrincipalOtro =
    destinoBase.other;

  /*
   * =========================================================
   * PROGRAMA
   * =========================================================
   *
   * MUY IMPORTANTE:
   *
   * En fichas antiguas el valor oficial estaba
   * principalmente en:
   *
   * ficha.nombrePrograma
   *
   * Por eso ese campo tiene prioridad frente a
   * valores raíz dudosos o antiguos.
   */

  const programaLegacyFicha =
    cleanText(
      ficha.nombrePrograma ||
      ""
    );

  const programaNuevoFicha =
    cleanText(
      ficha.programa ||
      ""
    );

  const programaOtroNuevoFicha =
    cleanText(
      ficha.programaOtro ||
      ""
    );

  const programaGrupo =
    cleanText(
      group.programa ||
      ""
    );

  const programaOtroGrupo =
    cleanText(
      group.programaOtro ||
      ""
    );

  const destinoVisible =
    getFichaSharedDisplayValue(
      destinoPrincipal,
      destinoPrincipalOtro
    );

  let programaOptions =
    getFichaProgramOptionsByDestino(
      destinoVisible
    );

  if (!programaOptions.length) {
    programaOptions = [
      "OTRO"
    ];
  }

  /*
   * Primero intentamos estructura nueva de ficha.
   *
   * Si no existe, recuperamos nombrePrograma histórico.
   *
   * Solamente al final usamos la raíz del grupo.
   */

  let programaResolved;

  if (
    programaNuevoFicha ||
    programaOtroNuevoFicha
  ) {
    programaResolved =
      resolveFichaLegacySelector({
        options:
          programaOptions,

        selected:
          programaNuevoFicha,

        other:
          programaOtroNuevoFicha,

        legacyValue:
          programaLegacyFicha
      });
  } else if (
    programaLegacyFicha
  ) {
    programaResolved =
      resolveFichaLegacySelector({
        options:
          programaOptions,

        legacyValue:
          programaLegacyFicha
      });
  } else {
    programaResolved =
      resolveFichaLegacySelector({
        options:
          programaOptions,

        selected:
          programaGrupo,

        other:
          normalizeSearchLocal(
            programaGrupo
          ) === "otro"
            ? programaOtroGrupo
            : "",

        legacyValue:
          programaOtroGrupo ||
          programaGrupo
      });
  }

  const programa =
    programaResolved.selected;

  const programaOtro =
    programaResolved.other;

  const nombrePrograma =
    getFichaSharedDisplayValue(
      programa,
      programaOtro
    ) ||
    programaLegacyFicha ||
    programaOtroGrupo ||
    programaGrupo ||
    "";

  /*
   * =========================================================
   * TRAMO
   * =========================================================
   *
   * Igual que programa:
   * ficha.tramo antiguo tiene prioridad.
   */

  const tramoLegacyFicha =
    cleanText(
      ficha.tramo ||
      ""
    );

  const tramoSeleccionFicha =
    cleanText(
      ficha.tramoSeleccion ||
      ""
    );

  const tramoOtroFicha =
    cleanText(
      ficha.tramoOtro ||
      ""
    );

  const tramoGrupo =
    cleanText(
      group.tramo ||
      ""
    );

  const tramoOtroGrupo =
    cleanText(
      group.tramoOtro ||
      ""
    );

  let tramoResolved;

  if (
    tramoSeleccionFicha ||
    tramoOtroFicha
  ) {
    tramoResolved =
      resolveFichaLegacySelector({
        options:
          FICHA_TRAMO_OPTIONS,

        selected:
          tramoSeleccionFicha,

        other:
          tramoOtroFicha,

        legacyValue:
          tramoLegacyFicha
      });
  } else if (
    tramoLegacyFicha
  ) {
    tramoResolved =
      resolveFichaLegacySelector({
        options:
          FICHA_TRAMO_OPTIONS,

        legacyValue:
          tramoLegacyFicha
      });
  } else {
    tramoResolved =
      resolveFichaLegacySelector({
        options:
          FICHA_TRAMO_OPTIONS,

        selected:
          tramoGrupo,

        other:
          normalizeSearchLocal(
            tramoGrupo
          ) === "otro"
            ? tramoOtroGrupo
            : "",

        legacyValue:
          tramoOtroGrupo ||
          tramoGrupo
      });
  }

  const tramoSeleccion =
    tramoResolved.selected;

  const tramoOtro =
    tramoResolved.other;

  const tramo =
    getFichaSharedDisplayValue(
      tramoSeleccion,
      tramoOtro
    ) ||
    tramoLegacyFicha ||
    tramoOtroGrupo ||
    tramoGrupo ||
    "";

  /*
   * =========================================================
   * MES / FECHA TENTATIVA
   * =========================================================
   *
   * Las fichas antiguas podían traer cosas como:
   *
   * "segunda semana de noviembre"
   * "noviembre - diciembre"
   * "a confirmar"
   *
   * Nada de eso se pierde.
   *
   * Si no coincide exactamente con un mes:
   * OTRO + texto histórico.
   */

  const fechaLegacyFicha =
    cleanText(
      ficha.fechaViajeTexto ||
      ""
    );

  const fechaLegacyGrupo =
    cleanText(
      group.fechaDeViaje ||
      group.fechaViaje ||
      group.semanaViaje ||
      group.mesViaje ||
      ""
    );

  const mesFicha =
    cleanText(
      ficha.mesViaje ||
      ""
    );

  const mesOtroFicha =
    cleanText(
      ficha.mesViajeOtro ||
      ""
    );

  const mesGrupo =
    cleanText(
      group.mesViaje ||
      ""
    );

  const mesOtroGrupo =
    cleanText(
      group.mesViajeOtro ||
      ""
    );

  let mesViaje =
    "";

  let mesViajeOtro =
    "";

  if (
    mesFicha ||
    mesOtroFicha
  ) {
    const canonical =
      findFichaCanonicalOption(
        FICHA_MES_VIAJE_OPTIONS,
        mesFicha
      );

    if (canonical) {
      mesViaje =
        canonical;

      mesViajeOtro =
        mesOtroFicha;
    } else if (mesFicha) {
      mesViaje =
        "OTRO";

      mesViajeOtro =
        mesOtroFicha ||
        mesFicha ||
        fechaLegacyFicha ||
        "";
    } else {
      mesViaje =
        "OTRO";

      mesViajeOtro =
        mesOtroFicha;
    }
  } else if (
    fechaLegacyFicha
  ) {
    const canonical =
      findFichaCanonicalOption(
        FICHA_MES_VIAJE_OPTIONS,
        fechaLegacyFicha
      );

    if (canonical) {
      mesViaje =
        canonical;

      mesViajeOtro =
        "";
    } else {
      mesViaje =
        "OTRO";

      mesViajeOtro =
        fechaLegacyFicha;
    }
  } else if (
    mesGrupo ||
    mesOtroGrupo
  ) {
    const canonical =
      findFichaCanonicalOption(
        FICHA_MES_VIAJE_OPTIONS,
        mesGrupo
      );

    if (canonical) {
      mesViaje =
        canonical;

      mesViajeOtro =
        mesOtroGrupo;
    } else if (mesGrupo) {
      mesViaje =
        "OTRO";

      mesViajeOtro =
        mesOtroGrupo ||
        mesGrupo ||
        fechaLegacyGrupo ||
        "";
    } else {
      mesViaje =
        "OTRO";

      mesViajeOtro =
        mesOtroGrupo;
    }
  } else if (
    fechaLegacyGrupo
  ) {
    const canonical =
      findFichaCanonicalOption(
        FICHA_MES_VIAJE_OPTIONS,
        fechaLegacyGrupo
      );

    if (canonical) {
      mesViaje =
        canonical;

      mesViajeOtro =
        "";
    } else {
      mesViaje =
        "OTRO";

      mesViajeOtro =
        fechaLegacyGrupo;
    }
  }

  const fechaViajeTexto =
    mesViajeOtro ||
    fechaLegacyFicha ||
    mesViaje ||
    fechaLegacyGrupo ||
    "";

  /*
   * =========================================================
   * OBSERVACIONES
   * =========================================================
   */

  const observacionesFallbackTexto =
    pick(
      ficha.observacionesGenerales,
      group.observacionesFicha,
      group.observacionesGenerales,
      ""
    ) || "";

  /*
   * =========================================================
   * RESULTADO FINAL
   * =========================================================
   */

  return {
    solicitudReserva:
      pick(
        ficha.solicitudReserva,
        group.solicitudReserva,
        ""
      ),

    nombreGrupo:
      pick(
        ficha.nombreGrupo,
        group.nombreGrupo,
        group.aliasGrupo,
        buildDefaultGroupName(
          group
        )
      ),

    /*
     * CONTACTO PRINCIPAL
     */
    apoderadoEncargado:
      pick(
        ficha.apoderadoEncargado,
        group.nombreCliente,
        ""
      ),

    telefono:
      pick(
        ficha.telefono,
        group.celularCliente,
        ""
      ),

    correo:
      pick(
        ficha.correo,
        group.correoCliente,
        ""
      ),

    /*
     * DESTINO
     */
    destinoPrincipal,
    destinoPrincipalOtro,

    /*
     * PROGRAMA
     */
    programa,
    programaOtro,
    nombrePrograma,

    programaPdfUrl:
      pick(
        ficha.programaPdfUrl,
        group.programaPdfUrl,
        ""
      ),

    programaPdfNombre:
      pick(
        ficha.programaPdfNombre,
        group.programaPdfNombre,
        ""
      ),

    programaPdfStoragePath:
      pick(
        ficha.programaPdfStoragePath,
        group.programaPdfStoragePath,
        ""
      ),

    programaPdfSubidoPor:
      pick(
        ficha.programaPdfSubidoPor,
        group.programaPdfSubidoPor,
        ""
      ),

    programaPdfSubidoPorCorreo:
      pick(
        ficha.programaPdfSubidoPorCorreo,
        group.programaPdfSubidoPorCorreo,
        ""
      ),

    valorPrograma:
      pick(
        ficha.valorPrograma,
        group.valorPrograma,
        ""
      ),

    /*
     * CANTIDAD
     */
    numeroPaxTotal:
      pick(
        ficha.numeroPaxTotal,
        group.cantidadGrupo,
        ""
      ),

    /*
     * TRAMO
     */
    tramoSeleccion,
    tramoOtro,
    tramo,

    liberados:
      pick(
        ficha.liberados,
        group.liberados,
        ""
      ),

    categoriaHoteleraContratada:
      pick(
        ficha.categoriaHoteleraContratada,
        group.categoriaHoteleraContratada,
        group.hotel,
        group.Hotel,
        group.solicitudHotel,
        ""
      ),

    autorizacionGerencia:
      pick(
        ficha.autorizacionGerencia,
        group.autorizacionGerencia,
        group.Autorizacion,
        group.autorizacion,
        situacion.resumen,
        ""
      ),

    descuentoValorBase:
      pick(
        ficha.descuentoValorBase,
        group.descuento,
        "NO"
      ),

    /*
     * MES / FECHA
     */
    mesViaje,
    mesViajeOtro,
    fechaViajeTexto,

    asistenciaEnViajes:
      pick(
        ficha.asistenciaEnViajes,
        group.asistenciaEnViajes,
        group.asistenciaMed,
        ""
      ),

    nombreVendedor:
      pick(
        ficha.nombreVendedor,
        group.vendedora,
        ""
      ),

    numeroNegocio:
      pick(
        ficha.numeroNegocio,
        group.numeroNegocio,
        ""
      ),

    usuarioFicha:
      pick(
        ficha.usuarioFicha,
        group.usuarioProgramaAdm,
        ""
      ),

    claveAdministrativa:
      pick(
        ficha.claveAdministrativa,
        group.claveAdministrativa,
        ""
      ),

    version:
      normalizePlainText(
        pick(
          ficha.version,
          group.versionFicha,
          "ORIGINAL"
        )
      ) ||
      "ORIGINAL",

    fechaActualizacionTexto:
      pick(
        ficha.fechaActualizacionTexto,

        formatFichaDateTimeText(
          ficha.fechaActualizacion
        ),

        formatFichaDateTimeText(
          group.fechaActualizacionFicha
        ),

        ""
      ),

    infoOperacionesHtml:
      pick(
        ficha.infoOperacionesHtml,
        situacion.observacionOperaciones,
        group.observacionesOperaciones,
        ""
      ),

    infoAdministracionHtml:
      pick(
        ficha.infoAdministracionHtml,
        situacion.observacionAdministracion,
        group.observacionesAdministracion,
        ""
      ),

    observacionesHtml:
      pick(
        ficha.observacionesHtml,

        plainTextToRichHtml(
          observacionesFallbackTexto
        ),

        ""
      ),

    pdfUrl:
      pick(
        ficha.pdfUrl,
        group.fichaPdfUrl,
        ""
      ),

    pdfNombre:
      pick(
        ficha.pdfNombre,
        group.fichaPdfNombre,
        ""
      ),

    estado:
      pick(
        ficha.estado,
        group.fichaEstado,
        "pendiente"
      ),

    actualizadoPor:
      pick(
        ficha.actualizadoPor,
        ""
      ),

    actualizadoPorCorreo:
      pick(
        ficha.actualizadoPorCorreo,
        ""
      ),

    fechaActualizacion:
      ficha.fechaActualizacion ||
      group.fechaActualizacionFicha ||
      null
  };
}
/* =========================================================
   RICH TEXT
========================================================= */
function bindRichEditors() {
  if (richEditorsBound) return;
  richEditorsBound = true;

  document.addEventListener("selectionchange", () => {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;

    const anchorNode = sel.anchorNode;
    const editor =
      anchorNode?.nodeType === 3
        ? anchorNode.parentElement?.closest(".rich-editor[contenteditable='true']")
        : anchorNode?.closest?.(".rich-editor[contenteditable='true']");

    if (!editor || !editor.id) return;

    richSelectionByEditor.set(editor.id, sel.getRangeAt(0).cloneRange());
  });

  document.addEventListener("mousedown", (e) => {
    const btn = e.target.closest("[data-rich-cmd]");
    if (!btn) return;

    e.preventDefault();

    const targetId = String(btn.dataset.editorTarget || "");
    const cmd = String(btn.dataset.richCmd || "");
    if (!targetId || !cmd) return;

    applyRichCommand(targetId, cmd);
  });

  document.addEventListener("input", (e) => {
    const input = e.target.closest("[data-rich-color]");
    if (!input) return;

    const targetId = String(input.dataset.editorTarget || "");
    const cmd = String(input.dataset.richColor || "");
    if (!targetId || !cmd) return;

    applyRichCommand(targetId, cmd, input.value);
  });
}

function applyRichCommand(targetId, cmd, value = null) {
  const editor = $(targetId);
  if (!editor || editor.contentEditable !== "true") return;

  editor.focus();
  restoreRichSelection(targetId);

  try {
    document.execCommand("styleWithCSS", false, true);
  } catch (e) {
    // sin acción
  }

  if (cmd === "hiliteColor") {
    const ok = document.execCommand("hiliteColor", false, value);
    if (!ok) {
      document.execCommand("backColor", false, value);
    }
  } else {
    document.execCommand(cmd, false, value);
  }

  editor.focus();
  captureRichSelection(targetId);
}

function captureRichSelection(targetId) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;
  richSelectionByEditor.set(targetId, sel.getRangeAt(0).cloneRange());
}

function restoreRichSelection(targetId) {
  const range = richSelectionByEditor.get(targetId);
  if (!range) return;

  const sel = window.getSelection();
  if (!sel) return;

  sel.removeAllRanges();
  sel.addRange(range);
}

function setRichEditorHtml(id, html) {
  const el = $(id);
  if (!el) return;
  el.innerHTML = sanitizeRichHtml(html || "");
}

function getRichEditorHtml(id) {
  const el = $(id);
  if (!el) return "";
  return normalizeRichHtml(sanitizeRichHtml(el.innerHTML || ""));
}

function sanitizeRichHtml(html = "") {
  const raw = String(html || "");
  if (!raw.trim()) return "";

  const template = document.createElement("template");
  template.innerHTML = raw;

  template.content
    .querySelectorAll("script, iframe, object, embed, link, meta")
    .forEach((el) => el.remove());

  template.content.querySelectorAll("*").forEach((el) => {
    [...el.attributes].forEach((attr) => {
      const name = attr.name.toLowerCase();
      const value = String(attr.value || "");

      if (name.startsWith("on")) {
        el.removeAttribute(attr.name);
      }

      if ((name === "href" || name === "src") && /^\s*javascript:/i.test(value)) {
        el.removeAttribute(attr.name);
      }
    });
  });

  return normalizeRichHtml(template.innerHTML);
}

function normalizeRichHtml(html = "") {
  return String(html || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/<div><br><\/div>/gi, "")
    .replace(/<p><br><\/p>/gi, "")
    .replace(/>\s+</g, "><")
    .trim();
}

function formatFichaDateTimeText(value = "") {
  if (!value) return "";

  if (typeof value === "string") {
    const raw = value.trim();
    if (!raw) return "";

    const parsed = toDate(raw);
    return parsed ? formatDateTime(parsed) : raw;
  }

  const parsed = toDate(value);
  return parsed ? formatDateTime(parsed) : "";
}

function plainTextToRichHtml(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";

  return raw
    .split(/\n+/)
    .map((line) => `<p>${escapeHtml(line.trim())}</p>`)
    .join("");
}

function richHtmlToPlainText(html = "") {
  const safe = sanitizeRichHtml(html || "");
  if (!safe) return "";

  const div = document.createElement("div");
  div.innerHTML = safe;

  return String(div.textContent || div.innerText || "")
    .replace(/\u00a0/g, " ")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function truncateForHistory(value = "", max = 260) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.length <= max) return text;
  return `${text.slice(0, max).trim()}...`;
}

function normalizePlainText(value = "") {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isRichField(path = "") {
  return [
    "infoOperacionesHtml",
    "infoAdministracionHtml",
    "observacionesHtml"
  ].includes(path);
}

/* =========================================================
   HELPERS
========================================================= */
function buildFichaPdfHtmlUrl({ mode = "view" } = {}) {
  const id = encodeURIComponent(state.groupId || state.requestedId || "");
  const m = encodeURIComponent(mode);
  return `ficha-pdf.html?id=${id}&mode=${m}`;
}

function openFichaPdfHtml() {
  if (!canOpenFicha()) {
    alert("La ficha solo se habilita cuando el grupo está en estado GANADA.");
    return;
  }

  window.open(buildFichaPdfHtmlUrl({ mode: "generator" }), "_blank", "noopener");
}

async function handleGenerarPdfVersion() {
  if (!canOpenFicha()) {
    alert("El generador de fichas solo se habilita cuando el grupo está en estado GANADA.");
    return;
  }

  if (!canGeneratePdfVersionAsCurrentUser()) {
    alert("Solo admin, yenny@raitrai.cl, administracion@raitrai.cl o raitrai@raitrai.cl pueden usar el generador de fichas.");
    return;
  }

  // IMPORTANTE:
  // No guardamos la ficha aquí.
  // Este botón solo abre el generador; guardar antes podía reiniciar flujo.
  const win = window.open(buildFichaPdfHtmlUrl({ mode: "generator" }), "_blank", "noopener");

  if (!win) {
    alert("El navegador bloqueó la ventana del generador. Debes permitir pop-ups para continuar.");
  }
}

function waitForPdfPersistResult(win, timeoutMs = 90000) {
  return new Promise((resolve) => {
    let done = false;

    const finish = (payload) => {
      if (done) return;
      done = true;
      window.removeEventListener("message", onMessage);
      clearTimeout(timer);
      resolve(payload);
    };

    const onMessage = (event) => {
      const data = event?.data || {};
      if (!data || data.type !== "ficha-pdf-saved") return;

      finish({
        ok: !!data.ok,
        reason: data.reason || "",
        message: data.message || "",
        pdfUrl: data.pdfUrl || "",
        pdfNombre: data.pdfNombre || ""
      });
    };

    const timer = setTimeout(() => {
      try {
        if (win && !win.closed) {
          // dejamos la ventana abierta por si el usuario aún la está viendo
        }
      } catch (_) {
        // sin acción
      }

      finish({ ok: false, reason: "timeout" });
    }, timeoutMs);

    window.addEventListener("message", onMessage);
  });
}

function getBlockedEditMessage() {
  if (!state.canModify) {
    return "Tu rol actual es solo de lectura para esta ficha.";
  }

  const isVendor = String(state.effectiveUser?.rol || "").toLowerCase() === "vendedor";

  if (isVendor && isVendorLockedByFlow(state.group)) {
    return "Ya firmaste la ficha. Desde este momento no puedes modificarla; debes solicitar actualización a jefa de ventas.";
  }

  if (state.group?.autorizada && isVendor) {
    return "El grupo ya está autorizado. El vendedor(a) no puede modificar esta ficha directamente.";
  }

  return "No tienes permisos para editar esta ficha.";
}

function getDisplayName(user) {
  const name = [user?.nombre, user?.apellido].filter(Boolean).join(" ").trim();
  return name || user?.email || state.effectiveEmail || "Usuario";
}

function getDisplayNameByStored(name = "", email = "") {
  return cleanText(name) || cleanText(email) || "Sin registro";
}

function getEstadoLabel(value = "") {
  const key = normalizeState(value);
  const map = {
    a_contactar: "A contactar",
    contactado: "Contactado",
    cotizando: "Cotizando",
    recotizando: "Recotizando",
    reunion_confirmada: "Reunión confirmada",
    ganada: "Ganada",
    perdida: "Perdida"
  };
  return map[key] || "A contactar";
}

function getFichaEstadoLabel(value = "") {
  const v = normalizeSearchLocal(value);
  if (!v) return "Pendiente";
  if (v === "lista_vendedor") return "Lista vendedor";
  if (v === "revisada_jefa_ventas") return "Revisada jefa ventas";
  if (v === "autorizada_admin") return "Autorizada administración";
  if (v === "en_edicion") return "En edición";
  if (v === "ok") return "Ok";
  return capitalize(String(value).replaceAll("_", " "));
}

function buildDefaultGroupName(group = {}) {
  return [
    cleanText(group.aliasGrupo) ||
    cleanText(group.nombreGrupo) ||
    cleanText(group.colegio) ||
    "",
    group.anoViaje ? `(${group.anoViaje})` : ""
  ].filter(Boolean).join(" ");
}

function stripHtmlPreview(html = "") {
  return String(html || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function humanDateLong(value) {
  const d = toDate(value);
  if (!d) return "";
  return d.toLocaleDateString("es-CL", {
    day: "numeric",
    month: "long",
    year: "numeric"
  });
}

function pick(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    if (typeof value === "string" && !value.trim()) continue;
    return value;
  }
  return "";
}

function itemMini(label, value) {
  return {
    label,
    value: String(value ?? "").trim()
  };
}

function setValue(id, value) {
  const el = $(id);
  if (!el) return;
  el.value = value == null ? "" : String(value);
}

function toInputDateValue(value) {
  if (!value) return "";

  if (typeof value?.toDate === "function") {
    const d = value.toDate();
    if (isNaN(d)) return "";
    return d.toISOString().slice(0, 10);
  }

  if (value instanceof Date) {
    if (isNaN(value)) return "";
    return value.toISOString().slice(0, 10);
  }

  const raw = String(value).trim();
  if (!raw) return "";

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }

  const parsed = new Date(raw);
  if (!isNaN(parsed)) {
    return parsed.toISOString().slice(0, 10);
  }

  return "";
}

function todayInputDate() {
  return new Date().toISOString().slice(0, 10);
}

function getValue(id) {
  const el = $(id);
  return el ? String(el.value || "").trim() : "";
}

function setText(id, value) {
  const el = $(id);
  if (!el) return;
  el.textContent = String(value ?? "");
}

function sameValue(a, b) {
  return normalizeComparable(a) === normalizeComparable(b);
}

function normalizeComparable(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value).trim();
}

function getByPath(obj, path = "") {
  const parts = String(path).split(".");
  let ref = obj;

  for (const part of parts) {
    if (ref == null) return "";
    ref = ref[part];
  }

  return ref;
}

function cleanText(value = "") {
  return String(value || "").trim();
}

function normalizeState(value = "") {
  const v = normalizeSearchLocal(value);
  if (!v) return "a_contactar";
  if (v.includes("reunion confirm")) return "reunion_confirmada";
  if (v.includes("recot")) return "recotizando";
  if (v.includes("cotiz")) return "cotizando";
  if (v.includes("contactad")) return "contactado";
  if (v.includes("ganad")) return "ganada";
  if (v.includes("perdid")) return "perdida";
  return "a_contactar";
}

function normalizeSearchLocal(value = "") {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value) ? null : value;
  if (typeof value?.toDate === "function") {
    const d = value.toDate();
    return isNaN(d) ? null : d;
  }
  if (typeof value === "string") {
    const d = new Date(value);
    return isNaN(d) ? null : d;
  }
  if (typeof value === "number") {
    const d = new Date(value);
    return isNaN(d) ? null : d;
  }
  return null;
}

function formatDate(value) {
  const d = toDate(value);
  if (!d) return "—";
  return d.toLocaleDateString("es-CL");
}

function formatTime(value) {
  const d = toDate(value);
  if (!d) return "—";
  return d.toLocaleTimeString("es-CL", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatDateTime(value) {
  const d = toDate(value);
  if (!d) return "—";
  return `${formatDate(d)} · ${formatTime(d)}`;
}

function capitalize(value = "") {
  const s = String(value || "").trim();
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function setNestedValue(obj = {}, path = "", value = "") {
  const parts = String(path || "").split(".").filter(Boolean);
  if (!parts.length) return obj;

  let ref = obj;

  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i];

    if (!ref[key] || typeof ref[key] !== "object" || Array.isArray(ref[key])) {
      ref[key] = {};
    }

    ref = ref[key];
  }

  ref[parts[parts.length - 1]] = value;
  return obj;
}

function sanitizeChileMobileForSave(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";

  let digits = raw.replace(/\D/g, "");

  if (digits.startsWith("56")) {
    digits = digits.slice(2);
  }

  if (digits.startsWith("9")) {
    digits = digits.slice(1);
  }

  digits = digits.slice(0, 8);

  return digits ? `+569${digits}` : "";
}

function escapeHtml(value = "") {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// =========================================================
// BACKFILL TEMPORAL — FICHAS CORREGIDAS
// Ejecutar una sola vez desde consola: backfillFichasCorregidas()
// Luego eliminar esta función del archivo.
// =========================================================
window.backfillFichasCorregidas = async function backfillFichasCorregidas() {
  const snap = await getDocs(collection(db, "ventas_cotizaciones"));

  let revisadas = 0;
  let marcadas = 0;

  for (const docSnap of snap.docs) {
    const row = { id: docSnap.id, ...docSnap.data() };
    const flow = row.flowFicha || {};

    const firmas = {
      vendedor: !!flow?.vendedor?.firmado || row.firmaVendedor === true,
      jefa: !!flow?.jefaVentas?.firmado || row.firmaSupervision === true || !!row.firmaSupervision,
      admin: !!flow?.administracion?.firmado || row.firmaAdministracion === true || !!row.firmaAdministracion
    };

    const tuvoFirmaJefa =
      !!flow?.jefaVentas?.firmadoAt ||
      !!flow?.jefaVentas?.firmadoEn ||
      !!flow?.jefaVentas?.fechaFirma ||
      !!flow?.jefaVentas?.firmadoPor ||
      !!row.fechaFirmaSupervision ||
      !!row.firmaSupervision;

    const tuvoFirmaAdmin =
      !!flow?.administracion?.firmadoAt ||
      !!flow?.administracion?.firmadoEn ||
      !!flow?.administracion?.fechaFirma ||
      !!flow?.administracion?.firmadoPor ||
      !!row.fechaFirmaAdministracion ||
      !!row.firmaAdministracion;

    const yaEstaEnCorreccion =
      flow.modo === "correccion" ||
      flow.correccionPendiente === true;

    const tieneSolicitudAbierta =
      flow.modo === "solicitud_actualizacion" ||
      flow.solicitudActualizacionPendiente === true ||
      flow.requiereActualizacion === true;

    revisadas++;

    if (yaEstaEnCorreccion || tieneSolicitudAbierta) continue;

    let correccionEstado = "";

    if (tuvoFirmaAdmin && !firmas.jefa) {
      correccionEstado = "pendiente_jefa";
    }

    if (tuvoFirmaJefa && !firmas.admin) {
      correccionEstado = "pendiente_administracion";
    }

    if (!correccionEstado) continue;

    await updateDoc(doc(db, "ventas_cotizaciones", docSnap.id), {
      "flowFicha.modo": "correccion",
      "flowFicha.correccionPendiente": true,
      "flowFicha.correccionEstado": correccionEstado,
      "flowFicha.correccionOrigen":
        correccionEstado === "pendiente_jefa"
          ? "administracion"
          : "jefaVentas",
      "flowFicha.correccionBackfill": true,
      "flowFicha.correccionBackfillEn": serverTimestamp()
    });

    marcadas++;
    console.log("Marcada como corrección:", row.idGrupo || docSnap.id, correccionEstado);
  }

  console.log(`Backfill terminado. Revisadas: ${revisadas}. Marcadas: ${marcadas}.`);
};

// =========================================================
// BACKFILL TEMPORAL — OBSERVACIONES DE FICHA
// Ejecutar una sola vez desde consola: backfillObservacionesFicha()
// Luego eliminar esta función del archivo.
// =========================================================
window.backfillObservacionesFicha = async function backfillObservacionesFicha() {
  const groupsSnap = await getDocs(collection(db, "ventas_cotizaciones"));

  let revisadas = 0;
  let actualizadas = 0;
  let omitidas = 0;

  function localToDate(value) {
    if (!value) return null;
    if (value instanceof Date) return value;
    if (typeof value?.toDate === "function") return value.toDate();
    if (typeof value?.seconds === "number") return new Date(value.seconds * 1000);

    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function localFormatDate(value) {
    const d = localToDate(value);
    if (!d) return "Sin fecha";

    return d.toLocaleString("es-CL", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    });
  }

  function localClean(value = "") {
    return String(value ?? "").trim();
  }

  function htmlEscape(value = "") {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function stripHtml(value = "") {
    return String(value ?? "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<[^>]*>/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function pushEvent(events, {
    fecha = null,
    usuario = "",
    tipo = "",
    detalle = ""
  } = {}) {
    const cleanTipo = localClean(tipo);
    const cleanDetalle = localClean(detalle);

    if (!cleanTipo && !cleanDetalle) return;

    events.push({
      fecha,
      usuario: localClean(usuario) || "Sistema",
      tipo: cleanTipo || "Evento",
      detalle: cleanDetalle
    });
  }

  for (const docSnap of groupsSnap.docs) {
    revisadas++;

    const row = { id: docSnap.id, ...docSnap.data() };
    const idGrupo = String(row.idGrupo || docSnap.id || "").trim();
    const flow = row.flowFicha || {};
    const ficha = row.ficha || {};

    if (flow.observacionesBackfill === true) {
      omitidas++;
      continue;
    }

    const observacionesActualesHtml = localClean(ficha.observacionesHtml || "");
    const observacionesActualesPlain = stripHtml(observacionesActualesHtml);

    if (observacionesActualesHtml.includes("BITÁCORA AUTOMÁTICA RETROACTIVA")) {
      omitidas++;
      continue;
    }

    const events = [];

    // Firma vendedor
    if (flow?.vendedor?.firmado) {
      pushEvent(events, {
        fecha: flow.vendedor.firmadoAt || flow.vendedor.firmadoEn || flow.vendedor.fechaFirma,
        usuario: flow.vendedor.firmadoPor || row.firmaVendedor || row.vendedora || "",
        tipo: "Firma vendedor(a)",
        detalle: "El vendedor dejó la ficha lista para revisión."
      });
    }

    // Firma jefa
    if (flow?.jefaVentas?.firmado || row.firmaSupervision) {
      pushEvent(events, {
        fecha: flow.jefaVentas?.firmadoAt || flow.jefaVentas?.firmadoEn || flow.jefaVentas?.fechaFirma,
        usuario: flow.jefaVentas?.firmadoPor || row.firmaSupervision || "Jefa de ventas",
        tipo: "Firma jefa de ventas",
        detalle: flow.jefaVentas?.observacion || "La jefa de ventas revisó la ficha."
      });
    }

    // Firma administración
    if (flow?.administracion?.firmado || row.firmaAdministracion) {
      pushEvent(events, {
        fecha: flow.administracion?.firmadoAt || flow.administracion?.firmadoEn || flow.administracion?.fechaFirma,
        usuario: flow.administracion?.firmadoPor || row.firmaAdministracion || "Administración",
        tipo: "Firma administración",
        detalle: flow.administracion?.observacion || "Administración autorizó o cerró la ficha."
      });
    }

    // Corrección detectada por backfill
    if (flow.correccionBackfill === true || flow.correccionPendiente === true) {
      const estadoCorreccion = localClean(flow.correccionEstado || "");
      const origenCorreccion = localClean(flow.correccionOrigen || "");

      pushEvent(events, {
        fecha: flow.correccionBackfillEn || row.fechaActualizacionFicha || row.fechaActualizacion,
        usuario: "Sistema",
        tipo: "Corrección interna detectada",
        detalle: `Se marcó la ficha como corrección pendiente. Estado: ${estadoCorreccion || "sin estado"}. Origen: ${origenCorreccion || "sin origen"}.`
      });
    }

    // Solicitudes de actualización
    const solicitudesSnap = await getDocs(
      query(collection(db, SOLICITUDES_COLLECTION), where("idGrupo", "==", idGrupo))
    );

    solicitudesSnap.docs.forEach((solDoc) => {
      const sol = solDoc.data() || {};
      const tipoSolicitud = localClean(sol.tipoSolicitud || "");

      if (tipoSolicitud !== "actualizacion_ficha") return;

      pushEvent(events, {
        fecha: sol.fechaSolicitud,
        usuario: sol.solicitadoPor || sol.solicitadoPorCorreo || "Vendedor(a)",
        tipo: "Solicitud de actualización",
        detalle: sol.detalle || sol.asunto || "Se solicitó actualización de ficha."
      });

      if (sol.respuestaJefa) {
        pushEvent(events, {
          fecha: sol.fechaRevisionJefa,
          usuario: sol.revisadaPor || sol.revisadaPorCorreo || "Jefa de ventas",
          tipo: "Revisión solicitud por jefa de ventas",
          detalle: sol.respuestaJefa
        });
      }

      if (sol.respuestaAdministracion || sol.resuelta === true) {
        pushEvent(events, {
          fecha: sol.fechaResolucion,
          usuario: sol.resueltaPor || sol.resueltaPorCorreo || "Administración",
          tipo: "Cierre solicitud por administración",
          detalle: sol.respuestaAdministracion || "Administración cerró la solicitud de actualización."
        });
      }
    });

    if (!events.length) {
      omitidas++;
      continue;
    }

    events.sort((a, b) => {
      const da = localToDate(a.fecha)?.getTime() || 0;
      const db = localToDate(b.fecha)?.getTime() || 0;
      return da - db;
    });

    const bitacoraHtml = `
      <hr>
      <p><strong>BITÁCORA AUTOMÁTICA RETROACTIVA</strong></p>
      ${events.map((ev) => `
        <p>
          <strong>[${htmlEscape(localFormatDate(ev.fecha))} - ${htmlEscape(ev.usuario)} - ${htmlEscape(ev.tipo)}]</strong><br>
          ${htmlEscape(ev.detalle)}
        </p>
      `).join("")}
    `;

    const bitacoraPlain = events.map((ev) => {
      return `[${localFormatDate(ev.fecha)} - ${ev.usuario} - ${ev.tipo}]\n${ev.detalle}`;
    }).join("\n\n");

    const nuevoHtml = [
      observacionesActualesHtml,
      bitacoraHtml
    ].filter(Boolean).join("\n");

    const nuevoPlain = [
      observacionesActualesPlain,
      "BITÁCORA AUTOMÁTICA RETROACTIVA",
      bitacoraPlain
    ].filter(Boolean).join("\n\n");

    await updateDoc(doc(db, "ventas_cotizaciones", docSnap.id), {
      "ficha.observacionesHtml": nuevoHtml,
      observacionesFicha: nuevoPlain,
      "flowFicha.observacionesBackfill": true,
      "flowFicha.observacionesBackfillEn": serverTimestamp()
    });

    actualizadas++;
    console.log("Observaciones actualizadas:", idGrupo);
  }

  console.log(`Backfill observaciones terminado. Revisadas: ${revisadas}. Actualizadas: ${actualizadas}. Omitidas: ${omitidas}.`);
};

window.reconstruirVersionFichaGrupo =
async function ({
  idGrupo,
  dryRun = true
} = {}) {
  const targetId =
    cleanText(idGrupo);

  if (!targetId) {
    throw new Error(
      "Debes indicar idGrupo. Ejemplo: reconstruirVersionFichaGrupo({ idGrupo: '10918', dryRun: true })"
    );
  }

  console.log(
    "========================================"
  );

  console.log(
    "RECONSTRUCCIÓN VERSIÓN FICHA"
  );

  console.log({
    idGrupo:
      targetId,

    dryRun
  });

  /*
   * =========================================================
   * 1. BUSCAR EL GRUPO
   * =========================================================
   */

  let groupSnapshot =
    await getDoc(
      doc(
        db,
        "ventas_cotizaciones",
        targetId
      )
    );

  /*
   * Compatibilidad cuando idGrupo no coincide
   * con el ID documental de Firestore.
   */
  if (!groupSnapshot.exists()) {
    const groupQuery =
      query(
        collection(
          db,
          "ventas_cotizaciones"
        ),
        where(
          "idGrupo",
          "==",
          targetId
        )
      );

    const groupResults =
      await getDocs(
        groupQuery
      );

    groupSnapshot =
      groupResults.docs[0] ||
      null;
  }

  if (
    !groupSnapshot ||
    !groupSnapshot.exists()
  ) {
    throw new Error(
      `No encontré el grupo ${targetId}.`
    );
  }

  const group =
    groupSnapshot.data() || {};

  const ficha =
    group.ficha || {};

  const realIdGrupo =
    String(
      group.idGrupo ||
      targetId
    );

  /*
   * IDs que podrían haberse utilizado históricamente
   * para relacionar solicitudes e historial.
   */
  const posiblesIdsGrupo = [
    realIdGrupo,
    String(groupSnapshot.id || ""),
    String(targetId || "")
  ].filter(
    (value, index, array) =>
      value &&
      array.indexOf(value) === index
  );

  /*
   * =========================================================
   * 2. BUSCAR EL HISTORIAL DEL GRUPO
   * =========================================================
   */

  const historyMap =
    new Map();

  for (
    const possibleId of posiblesIdsGrupo
  ) {
    const historyQuery =
      query(
        collection(
          db,
          HISTORIAL_COLLECTION
        ),
        where(
          "idGrupo",
          "==",
          possibleId
        )
      );

    const historySnapshot =
      await getDocs(
        historyQuery
      );

    historySnapshot.docs.forEach(
      (item) => {
        historyMap.set(
          item.id,
          {
            id:
              item.id,

            ...item.data()
          }
        );
      }
    );
  }

  const history =
    Array.from(
      historyMap.values()
    );

  /*
   * =========================================================
   * 3. BUSCAR SOLICITUDES DE ACTUALIZACIÓN/CORRECCIÓN
   * =========================================================
   */

  const solicitudesMap =
    new Map();

  for (
    const possibleId of posiblesIdsGrupo
  ) {
    const solicitudesQuery =
      query(
        collection(
          db,
          SOLICITUDES_COLLECTION
        ),
        where(
          "idGrupo",
          "==",
          possibleId
        )
      );

    const solicitudesSnapshot =
      await getDocs(
        solicitudesQuery
      );

    solicitudesSnapshot.docs.forEach(
      (item) => {
        solicitudesMap.set(
          item.id,
          {
            id:
              item.id,

            ...item.data()
          }
        );
      }
    );
  }

  const solicitudes =
    Array.from(
      solicitudesMap.values()
    );

  console.log(
    "SOLICITUDES ENCONTRADAS:",
    solicitudes.map(
      (item) => ({
        id:
          item.id,

        idGrupo:
          item.idGrupo,

        tipoSolicitud:
          item.tipoSolicitud,

        estadoSolicitud:
          item.estadoSolicitud,

        estado:
          item.estado,

        resuelta:
          item.resuelta,

        requiereNuevoPdf:
          item.requiereNuevoPdf,

        detalle:
          item.detalle,

        respuestaJefa:
          item.respuestaJefa,

        respuestaAdministracion:
          item.respuestaAdministracion
      })
    )
  );

  /*
   * =========================================================
   * 4. PROCESOS CONFIRMADOS EN EL HISTORIAL NUEVO
   * =========================================================
   */

  const procesosHistorial =
    history.filter(
      (item) => {
        const tipo =
          normalizeSearchLocal(
            item.tipoMovimiento ||
            item.tipo ||
            ""
          );

        const esCierre =
          tipo ===
            "solicitud_actualizacion_cerrada" ||
          tipo ===
            "solicitud_correccion_cerrada";

        const requiereNuevoPdf =
          item.metadata?.requiereNuevoPdf === true ||
          item.requiereNuevoPdf === true;

        return (
          esCierre &&
          requiereNuevoPdf
        );
      }
    );

  /*
   * =========================================================
   * 5. SOLICITUDES ANTIGUAS CERRADAS
   * =========================================================
   *
   * En los registros antiguos puede no existir
   * metadata.requiereNuevoPdf. Por eso se utiliza el cierre
   * efectivo de la solicitud como evidencia del proceso.
   */

  const solicitudesCerradas =
    solicitudes.filter(
      (item) => {
        const tipo =
          normalizeSearchLocal(
            item.tipoSolicitud ||
            item.tipo ||
            ""
          );

        const estado =
          normalizeSearchLocal(
            item.estadoSolicitud ||
            item.estado ||
            ""
          );

        const tipoValido =
          tipo === "actualizacion_ficha" ||
          tipo === "correccion_ficha";

        const estaCerrada =
          item.resuelta === true ||
          item.cerrada === true ||
          item.completada === true ||
          estado === "resuelta" ||
          estado === "resuelto" ||
          estado === "completada" ||
          estado === "completado" ||
          estado === "cerrada" ||
          estado === "cerrado" ||
          !!cleanText(
            item.respuestaAdministracion ||
            item.cierreAdministracion ||
            ""
          );

        /*
         * Si el registro dice expresamente que NO requirió
         * un nuevo PDF, no debe aumentar la versión.
         *
         * Si la propiedad no existía, se aplica compatibilidad
         * con el formato antiguo.
         */
        const noRequirioNuevoPdf =
          item.requiereNuevoPdf === false ||
          item.metadata?.requiereNuevoPdf === false;

        return (
          tipoValido &&
          estaCerrada &&
          !noRequirioNuevoPdf
        );
      }
    );

  /*
   * =========================================================
   * 6. UNIFICAR LOS PROCESOS SIN DUPLICAR SOLICITUDES
   * =========================================================
   */

  const procesosMap =
    new Map();

  procesosHistorial.forEach(
    (item) => {
      const solicitudId =
        cleanText(
          item.metadata?.solicitudId ||
          item.solicitudId ||
          ""
        );

      const key =
        solicitudId
          ? `solicitud:${solicitudId}`
          : `historial:${item.id}`;

      procesosMap.set(
        key,
        {
          fuente:
            "ventas_historial",

          id:
            item.id,

          solicitudId,

          tipoMovimiento:
            item.tipoMovimiento ||
            item.tipo ||
            "",

          tipoSolicitud:
            item.metadata?.tipoSolicitud ||
            item.tipoSolicitud ||
            "",

          detalle:
            item.metadata?.detalleSolicitud ||
            item.metadata?.detalle ||
            item.detalle ||
            "",

          requiereNuevoPdf:
            true,

          compatibilidadLegacy:
            false
        }
      );
    }
  );

  solicitudesCerradas.forEach(
    (item) => {
      const solicitudId =
        cleanText(item.id);

      const key =
        `solicitud:${solicitudId}`;

      /*
       * Si el historial ya contiene el cierre de esta solicitud,
       * no debe contarse nuevamente.
       */
      if (
        procesosMap.has(key)
      ) {
        return;
      }

      procesosMap.set(
        key,
        {
          fuente:
            "ventas_solicitudes_actualizacion",

          id:
            item.id,

          solicitudId:
            item.id,

          tipoMovimiento:
            "",

          tipoSolicitud:
            item.tipoSolicitud ||
            item.tipo ||
            "",

          detalle:
            item.detalle ||
            item.asunto ||
            item.motivo ||
            "",

          estadoSolicitud:
            item.estadoSolicitud ||
            item.estado ||
            "",

          resuelta:
            item.resuelta === true,

          requiereNuevoPdf:
            true,

          /*
           * Indica que fue inferido desde una solicitud antigua
           * cerrada que todavía no guardaba requiereNuevoPdf.
           */
          compatibilidadLegacy:
            item.requiereNuevoPdf !== true &&
            item.metadata?.requiereNuevoPdf !== true
        }
      );
    }
  );

  const procesosUnicos =
    Array.from(
      procesosMap.values()
    );

  const cantidadActualizaciones =
    procesosUnicos.length;

  /*
   * =========================================================
   * 7. VERIFICAR QUE EXISTA UN PDF OFICIAL
   * =========================================================
   */

  const pdfHistorial =
    Array.isArray(
      ficha.pdfHistorial
    )
      ? ficha.pdfHistorial
      : [];

  const tienePdfOficial =
    !!cleanText(
      ficha.pdfUrl ||
      group.fichaPdfUrl ||
      ficha.storagePathPdf ||
      ficha.pdfNombre ||
      group.fichaPdfNombre ||
      ""
    ) ||
    pdfHistorial.length > 0 ||
    !!ficha.confirmadaEl ||
    !!ficha.confirmadaPor ||
    ficha.confirmada === true ||
    group.fichaConfirmada === true;

  if (!tienePdfOficial) {
    const resultadoOmitido = {
      ok:
        true,

      dryRun,

      omitido:
        true,

      motivo:
        "El grupo no tiene evidencia suficiente de un PDF oficial.",

      idGrupo:
        realIdGrupo,

      groupDocId:
        groupSnapshot.id,

      aliasGrupo:
        group.aliasGrupo ||
        group.nombreGrupo ||
        "",

      cantidadProcesos:
        cantidadActualizaciones,

      procesos:
        procesosUnicos
    };

    console.log(
      "RESULTADO:",
      resultadoOmitido
    );

    return resultadoOmitido;
  }

  /*
   * =========================================================
   * 8. CALCULAR LA VERSIÓN CORRECTA
   * =========================================================
   */

  const versionCorrecta =
    cantidadActualizaciones > 0
      ? {
          version:
            "ACTUALIZACIÓN",

          tipoVersion:
            "actualizacion",

          versionNumero:
            cantidadActualizaciones,

          versionLabel:
            `ACTUALIZACIÓN ${cantidadActualizaciones}`
        }

      : {
          version:
            "ORIGINAL",

          tipoVersion:
            "original",

          versionNumero:
            1,

          versionLabel:
            "ORIGINAL"
        };

  const versionActual = {
    version:
      ficha.version ||
      group.versionFicha ||
      "",

    tipoVersion:
      ficha.tipoVersion ||
      group.tipoVersionFicha ||
      "",

    versionNumero:
      Number(
        ficha.versionNumero ??
        group.versionFichaNumero ??
        0
      )
  };

  const necesitaCorreccion =
    normalizeSearchLocal(
      versionActual.version
    ) !==
      normalizeSearchLocal(
        versionCorrecta.version
      ) ||
    normalizeSearchLocal(
      versionActual.tipoVersion
    ) !==
      normalizeSearchLocal(
        versionCorrecta.tipoVersion
      ) ||
    Number(
      versionActual.versionNumero
    ) !==
      Number(
        versionCorrecta.versionNumero
      );

  const resultado = {
    ok:
      true,

    dryRun,

    idGrupo:
      realIdGrupo,

    groupDocId:
      groupSnapshot.id,

    aliasGrupo:
      group.aliasGrupo ||
      group.nombreGrupo ||
      "",

    versionActual,

    versionCorrecta,

    cantidadProcesos:
      cantidadActualizaciones,

    procesos:
      procesosUnicos.map(
        (item) => ({
          fuente:
            item.fuente ||
            "",

          id:
            item.id ||
            "",

          solicitudId:
            item.solicitudId ||
            "",

          tipoMovimiento:
            item.tipoMovimiento ||
            "",

          tipoSolicitud:
            item.tipoSolicitud ||
            "",

          detalle:
            item.detalle ||
            "",

          estadoSolicitud:
            item.estadoSolicitud ||
            "",

          compatibilidadLegacy:
            item.compatibilidadLegacy === true
        })
      ),

    necesitaCorreccion
  };

  console.log(
    "RESULTADO:",
    resultado
  );

  /*
   * En dryRun solamente informa.
   */
  if (dryRun) {
    return resultado;
  }

  /*
   * Si ya está correcta, no escribe nada.
   */
  if (!necesitaCorreccion) {
    resultado.aplicado =
      false;

    resultado.motivo =
      "La versión ya se encontraba correcta.";

    console.log(
      "SIN CAMBIOS:",
      resultado
    );

    return resultado;
  }

  /*
   * =========================================================
   * 9. APLICAR LA CORRECCIÓN EN FIRESTORE
   * =========================================================
   *
   * regenerarMismaVersion=true permitirá reemplazar físicamente
   * el PDF incorrecto sin volver a aumentar el contador.
   */

  await updateDoc(
    groupSnapshot.ref,
    {
      versionFicha:
        versionCorrecta.version,

      tipoVersionFicha:
        versionCorrecta.tipoVersion,

      versionFichaNumero:
        versionCorrecta.versionNumero,

      "ficha.version":
        versionCorrecta.version,

      "ficha.tipoVersion":
        versionCorrecta.tipoVersion,

      "ficha.versionNumero":
        versionCorrecta.versionNumero,

      "ficha.regenerarMismaVersion":
        true,

      "ficha.versionReconstruida":
        true,

      "ficha.versionReconstruidaAt":
        serverTimestamp(),

      "ficha.versionReconstruidaPor":
        getDisplayName(
          state.effectiveUser
        ),

      "ficha.versionReconstruidaPorCorreo":
        state.effectiveEmail
    }
  );

  /*
   * Registrar la reconstrucción en el historial.
   */
  await createHistoryEntry({
    tipoMovimiento:
      "reconstruccion_version_ficha",

    modulo:
      "ficha",

    titulo:
      "Reconstrucción de versión de ficha",

    asunto:
      "Corrección del contador de versión",

    mensaje:
      [
        `Se corrigió la versión desde ${
          versionActual.version ||
          "sin versión"
        } ${
          versionActual.versionNumero ||
          ""
        } hacia ${
          versionCorrecta.versionLabel
        }.`,

        `Se detectaron ${
          cantidadActualizaciones
        } procesos reales que requirieron un nuevo PDF.`,

        "El PDF quedó habilitado para regenerarse conservando la versión corregida."
      ].join(" "),

    metadata: {
      versionAnterior:
        versionActual,

      versionNueva:
        versionCorrecta,

      cantidadProcesos:
        cantidadActualizaciones,

      procesosConsiderados:
        procesosUnicos.map(
          (item) => ({
            fuente:
              item.fuente ||
              "",

            id:
              item.id ||
              "",

            solicitudId:
              item.solicitudId ||
              "",

            tipoSolicitud:
              item.tipoSolicitud ||
              "",

            compatibilidadLegacy:
              item.compatibilidadLegacy === true
          })
        )
    }
  });

  resultado.aplicado =
    true;

  console.log(
    "CORRECCIÓN APLICADA:",
    resultado
  );

  return resultado;
};
