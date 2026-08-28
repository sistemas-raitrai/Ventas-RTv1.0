import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.7.3/firebase-auth.js";
import {
  collection,
  query,
  where,
  limit,
  getDocs,
  getDoc,
  addDoc,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  Timestamp,
  deleteField
} from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";

import {
  getStorage,
  ref as storageRef,
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
const REUNIONES_COLLECTION = "ventas_reuniones";
const HISTORIAL_COLLECTION = "ventas_historial";
const ALERTAS_COLLECTION = "ventas_alertas";
const SOLICITUDES_COLLECTION = "ventas_solicitudes_actualizacion";
const EMAIL_TEMPLATES_COLLECTION = "ventas_email_templates";
const ALERTAS_INSCRIPCIONES_COLLECTION = "ventas_alertas_inscripciones";

const DEFAULT_CORREO_CAMBIOS_INSCRIPCION = "operaciones@raitrai.cl";

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

  meetings: [],
  history: [],
  alertsManual: [],
  requests: [],
  
  inscripciones: [],
  inscripcionesCargadas: false,
  inscripcionesCargando: false,
  nominaVisible: false,
  
  // Indica desde dónde se cargó la tabla visible.
  inscripcionesFuente: "",
  
  // Guarda fichas completas ya consultadas individualmente.
  // Evita volver a descargar la misma ficha varias veces.
  inscripcionesDetalleCache: new Map(),
  
  // Permite reconocer grupos importados desde Sistema de Pagos
  // sin descargar la nómina completa.
  grupoTieneNominaSistemaPagos: false,
  
  // Fase que se abrirá después de confirmar
  // si el grupo incluye polera.
  fasePendienteConfirmacionPolera: "",
  
  reencuadrePdf: {
    inscripcionId: "",
    imagenes: [],
    activaKey: "",
    dragging: false,
    dragStartX: 0,
    dragStartY: 0
  },
  editingMeetingId: "",

  autoAlerts: [],

  emailTemplates: [],
  emailUi: {
    selectedTemplateId: "",
    editingTemplateId: "",
    activeTargetEmail: "",
    mode: "single",
    bulkRecipients: []
  },

  historyUi: {
    limit: 10,
    showHidden: false
  }
};

const ESTADO_META = {
  a_contactar: { label: "A contactar", css: "estado-a_contactar" },
  contactado: { label: "Contactado", css: "estado-contactado" },
  cotizando: { label: "Cotizando", css: "estado-cotizando" },
  recotizando: { label: "Recotizando", css: "estado-recotizando" },
  reunion_confirmada: { label: "Reunión confirmada", css: "estado-reunion_confirmada" },
  ganada: { label: "Ganada", css: "estado-ganada" },
  perdida: { label: "Perdida", css: "estado-perdida" }
};

const DOC_LABELS = {
  fichaMedicaEstado: "Fichas médicas",
  nominaEstado: "Nómina",
  fichaEstado: "Ficha del grupo",
  contratoEstado: "Contrato",
  cortesiaEstado: "Cortesías"
};

const DESTINO_PRINCIPAL_OPTIONS = [
  "BARILOCHE",
  "SUR DE CHILE",
  "SUR DE CHILE Y BARILOCHE",
  "BRASIL",
  "NORTE DE CHILE",
  "MÉXICO",
  "REPÚBLICA DOMINICANA",
  "OTRO"
];

const ROL_CONTACTO_OPTIONS = [
  "ESTUDIANTE",
  "APODERADO(A)",
  "PROFESOR(A)",
  "COMISION GIRA",
  "OTRO(A)"
];

const TRAMO_OPTIONS = [
  "36 – 39",
  "30 – 35",
  "26 – 29",
  "23 – 25",
  "20 – 22",
  "18 – 19",
  "15 – 17",
  "OTRO"
];

const MES_VIAJE_OPTIONS = [
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

const PROGRAM_OPTIONS_BY_DESTINO = {
  [normalizeOptionKey("BRASIL")]: [
    "CAMBORIU FULL 8/7",
    "CAMBORIU ECO 8/7",
    "CAMBORIU ECO 6/5",
    "OTRO"
  ],

  [normalizeOptionKey("BARILOCHE")]: [
    "BARILOCHE 6/5",
    "BARILOCHE TERRESTRE 6/5",
    "BARILOCHE TERRESTRE 5/4",
    "OTRO"
  ],

  [normalizeOptionKey("SUR DE CHILE Y BARILOCHE")]: [
    "SUR DE CHILE Y BARILOCHE CON VALDIVIA 8/7",
    "SUR DE CHILE Y BARILOCHE CON VALDIVIA 7/6",
    "SUR DE CHILE Y BARILOCHE SURFACE 7/6",
    "SUR DE CHILE Y BARILOCHE 7/6",
    "SUR DE CHILE Y BARILOCHE 6/5",
    "PUCON Y BARILOCHE 7/6",
    "OTRO"
  ],

  [normalizeOptionKey("BARILOCHE Y SUR DE CHILE")]: [
    "SUR DE CHILE Y BARILOCHE CON VALDIVIA 8/7",
    "SUR DE CHILE Y BARILOCHE CON VALDIVIA 7/6",
    "SUR DE CHILE Y BARILOCHE SURFACE 7/6",
    "SUR DE CHILE Y BARILOCHE 7/6",
    "SUR DE CHILE Y BARILOCHE 6/5",
    "PUCON Y BARILOCHE 7/6",
    "OTRO"
  ],

  [normalizeOptionKey("SUR DE CHILE")]: [
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

  [normalizeOptionKey("NORTE DE CHILE")]: [
    "SAN PEDRO ATACAMA 7/6",
    "SAN PEDRO ATACAMA 6/5",
    "OTRO"
  ],

  [normalizeOptionKey("MÉXICO")]: [
    "CANCUN Y PLAYA DEL CARMEN 8/7",
    "CANCUN Y PLAYA DEL CARMEN 7/6",
    "CANCUN Y PLAYA DEL CARMEN 6/5",
    "OTRO"
  ],

  [normalizeOptionKey("REPÚBLICA DOMINICANA")]: [
    "PUNTA CANA - BAYAHIBE 8/7",
    "PUNTA CANA - BAYAHIBE 7/6",
    "PUNTA CANA - BAYAHIBE 6/5",
    "OTRO"
  ],

  [normalizeOptionKey("OTRO")]: [
    "OTRO"
  ]
};

const DATA_FIELDS = [
  "colegio",
  "curso",
  "anoViaje",
  "cantidadGrupo",
  "destinoPrincipal",
  "destinoPrincipalOtro",
  "programa",
  "programaOtro",
  "tramo",
  "tramoOtro",
  "mesViaje",
  "mesViajeOtro",
  "semanaViaje",
  "comunaCiudad",
  "nombreCliente",
  "rolCliente",
  "correoCliente",
  "celularCliente",
  "nombreCliente2",
  "rolCliente2",
  "correoCliente2",
  "celularCliente2"
];

const SITUACION_FIELDS = [
  "estado",
  "autorizada",
  "cerrada",
  "situacion.resumen",
  "situacion.proximoPaso",
  "situacion.observacionVentas",
  "situacion.observacionJefaVentas",
  "situacion.observacionAdministracion",
  "situacion.observacionOperaciones",

  "elementosIncluidos.poleron",
  "elementosIncluidos.polera",
  "elementosIncluidos.soporteCelular",
  "elementosIncluidos.portapasaporte",
  "elementosIncluidos.toalla",
  "elementosIncluidos.cortesias",
  "elementosIncluidos.otros",
  "elementosIncluidos.otrosDetalle"
];

const DOC_FIELDS = [
  "fichaMedicaEstado",
  "nominaEstado",
  "fichaEstado",
  "contratoEstado",
  "cortesiaEstado"
];

initPage();

async function initPage() {
  state.requestedId = String(new URLSearchParams(location.search).get("id") || "").trim();

  await waitForLayoutReady();
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
    scopeText: `Portafolio del grupo · ${state.requestedId || "Sin ID"}`
  });

  renderActingUserSwitcher({
    realUser: state.realUser,
    effectiveUser: state.effectiveUser,
    users: VENTAS_USERS
  });

  bindHeaderActions();
}

function bindHeaderActions() {
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
  /*
    Ocultamos las acciones mientras se carga el grupo
    y se vuelven a calcular los permisos.
  */
  $("inscripcionAcciones")
    ?.classList.add("hidden");

  if (!state.requestedId) {
    renderFatal("Falta el parámetro ?id= en la URL.");
    return;
  }

  const resolved = await resolveGroupByParam(state.requestedId);

  if (!resolved) {
    renderFatal(`No encontré el grupo ${state.requestedId}.`);
    return;
  }

  state.groupDocId = resolved.docId;
  state.groupId = String(resolved.groupId || state.requestedId);
  state.group = resolved.data || {};

  if (!canAccessGroup(state.group)) {
    renderFatal("No tienes permisos para ver este grupo.");
    return;
  }

  // Si el usuario actual es vendedor, el grupo le corresponde
  // y está en "A contactar", al abrirlo pasa automáticamente a "Contactado".
  // saveGroupPatch recargará la ficha y dejará historial.
  if (await autoMarkVendorGroupAsContactedOnOpen()) {
    return;
  }

  // La nómina ya no se carga automáticamente.
  // Se descargará solamente cuando el usuario presione "Ver nómina".
  state.inscripciones = [];
  state.inscripcionesCargadas = false;
  state.inscripcionesCargando = false;
  state.nominaVisible = false;
  state.inscripcionesFuente = "";
  state.inscripcionesDetalleCache = new Map();
  
  await Promise.all([
    loadMeetings(),
    loadHistory(),
    loadManualAlerts(),
    loadRequests(),
    loadEmailTemplates(),
    detectarNominaSistemaPagosGrupo()
  ]);

  state.autoAlerts = buildAutomaticAlerts();
  renderGroup();
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

async function loadMeetings() {
  state.meetings = [];

  try {
    const snap = await getDocs(
      query(collection(db, REUNIONES_COLLECTION), where("idGrupo", "==", String(state.groupId)))
    );

    state.meetings = snap.docs
      .map((d) => ({
        id: d.id,
        ...d.data()
      }))
      .sort((a, b) => dateValue(b.fechaInicio) - dateValue(a.fechaInicio));
  } catch (error) {
    console.error("[grupo] loadMeetings", error);
  }
}

async function loadHistory() {
  state.history = [];

  try {
    const snap = await getDocs(
      query(collection(db, HISTORIAL_COLLECTION), where("idGrupo", "==", String(state.groupId)))
    );

    state.history = snap.docs
      .map((d) => ({
        id: d.id,
        ...d.data()
      }))
      .sort((a, b) => dateValue(b.fecha) - dateValue(a.fecha));
  } catch (error) {
    console.error("[grupo] loadHistory", error);
  }
}

async function loadManualAlerts() {
  state.alertsManual = [];

  try {
    const snap = await getDocs(
      query(collection(db, ALERTAS_COLLECTION), where("idGrupo", "==", String(state.groupId)))
    );

    state.alertsManual = snap.docs
      .map((d) => ({
        id: d.id,
        ...d.data()
      }))
      .filter((item) => item.activa !== false && item.resuelta !== true)
      .sort((a, b) => dateValue(b.fechaCreacion) - dateValue(a.fechaCreacion));
  } catch (error) {
    console.error("[grupo] loadManualAlerts", error);
  }
}

async function loadRequests() {
  state.requests = [];

  try {
    const snap = await getDocs(
      query(collection(db, SOLICITUDES_COLLECTION), where("idGrupo", "==", String(state.groupId)))
    );

    state.requests = snap.docs
      .map((d) => ({
        id: d.id,
        ...d.data()
      }))
      .sort((a, b) => dateValue(b.fechaSolicitud) - dateValue(a.fechaSolicitud));
  } catch (error) {
    console.error("[grupo] loadRequests", error);
  }
}

async function loadEmailTemplates() {
  state.emailTemplates = [];

  try {
    const currentEmail = normalizeEmail(state.effectiveEmail || "");
    if (!currentEmail) return;

    const snap = await getDocs(
      query(
        collection(db, EMAIL_TEMPLATES_COLLECTION),
        where("ownerEmail", "==", currentEmail)
      )
    );

    state.emailTemplates = snap.docs
      .map((d) => ({
        id: d.id,
        ...d.data()
      }))
      .filter((item) => item.activa !== false)
      .sort((a, b) => {
        const aName = cleanText(a.nombre || "").toLowerCase();
        const bName = cleanText(b.nombre || "").toLowerCase();
        return aName.localeCompare(bName, "es");
      });
  } catch (error) {
    console.error("[grupo] loadEmailTemplates", error);
  }
}

async function detectarNominaSistemaPagosGrupo() {
  state.grupoTieneNominaSistemaPagos = false;

  /*
    Primero revisamos marcas que puedan existir directamente
    en el documento principal del grupo.
  */
  const origenGuardado = normalizeSearchLocal(
    state.group?.origenNomina ||
    state.group?.nominaOrigen ||
    state.group?.inscripcion?.origenNomina ||
    state.group?.sistemaPagos?.origenNomina ||
    ""
  ).replace(/\s+/g, "_");

  const tieneMarcaDirecta =
    origenGuardado === "sistema_pagos" ||
    origenGuardado === "sistema_de_pagos" ||
    state.group?.sistemaPagos?.nominaImportada === true ||
    state.group?.sistemaPagos?.importada === true ||
    state.group?.nominaImportadaPagos === true ||
    state.group?.nominaImportadaSistemaPagos === true ||
    state.group?.inscripcion?.nominaImportada === true;

  if (tieneMarcaDirecta) {
    state.grupoTieneNominaSistemaPagos = true;
    return true;
  }

  /*
    Si el grupo no tiene una marca directa, hacemos una consulta
    muy pequeña a la subcolección: solo buscamos un documento.
  */
  try {
    const inscripcionesRef = collection(
      db,
      "ventas_cotizaciones",
      String(state.groupDocId),
      "inscripciones"
    );

    const snap = await getDocs(
      query(
        inscripcionesRef,
        where(
          "tipoInscripcion",
          "in",
          [
            "sistema_pagos",
            "sistema_de_pagos",
            "Sistema de Pagos"
          ]
        ),
        limit(1)
      )
    );

    state.grupoTieneNominaSistemaPagos = !snap.empty;

    return state.grupoTieneNominaSistemaPagos;
  } catch (error) {
    console.error(
      "[grupo] detectarNominaSistemaPagosGrupo",
      error
    );

    /*
      Si la consulta falla, no bloqueamos la carga de la página.
      Simplemente dejamos la marca como false.
    */
    state.grupoTieneNominaSistemaPagos = false;

    return false;
  }
}

function ordenarInscripcionesNomina(
  items = []
) {
  return [...items].sort(
    (a, b) => {
      const anuladaA =
        estaInscripcionAnulada(a);

      const anuladaB =
        estaInscripcionAnulada(b);

      if (anuladaA !== anuladaB) {
        return anuladaA
          ? 1
          : -1;
      }

      const ordenA =
        getOrdenOperativoInscripcion(a);

      const ordenB =
        getOrdenOperativoInscripcion(b);

      if (ordenA !== ordenB) {
        return ordenA - ordenB;
      }

      const fechaA =
        dateValue(
          getFechaFormularioInscripcion(a)
        );

      const fechaB =
        dateValue(
          getFechaFormularioInscripcion(b)
        );

      return fechaB - fechaA;
    }
  );
}

async function loadInscripciones() {
  state.inscripciones = [];
  state.inscripcionesCargando = true;
  state.inscripcionesFuente = "";

  /*
    Cada recarga de la nómina invalida los detalles completos
    almacenados. Así PDF, correo y edición no reutilizan una
    ficha anterior a una modificación.
  */
  state.inscripcionesDetalleCache = new Map();

  try {
    /*
      ETAPA 1:
      primero leemos la vista liviana.
    */
    const resumenSnap =
      await getDocs(
        collection(
          db,
          "ventas_cotizaciones",
          String(state.groupDocId),
          "nomina_resumen"
        )
      );

    if (!resumenSnap.empty) {
      state.inscripciones =
        ordenarInscripcionesNomina(
          resumenSnap.docs
            .map((d) => ({
              id: d.id,
              ...d.data(),

              /*
                Esta marca permite saber que el objeto
                visible no contiene la ficha completa.
              */
              esResumenNomina: true
            }))
            .filter((item) => {
              const estadoPrivacidad =
                normalizeSearchLocal(
                  item?.privacidad?.estado ||
                  ""
                );

              return (
                estadoPrivacidad !==
                  "eliminada_logica" &&
                estadoPrivacidad !==
                  "archivada"
              );
            })
        );

      state.inscripcionesFuente =
        "nomina_resumen";
    } else {
      /*
        Respaldo de seguridad.

        Si un grupo todavía no tiene resumen,
        usamos la colección completa para no
        dejar la página sin nómina.
      */
      const inscripcionesSnap =
        await getDocs(
          collection(
            db,
            "ventas_cotizaciones",
            String(state.groupDocId),
            "inscripciones"
          )
        );

      state.inscripciones =
        ordenarInscripcionesNomina(
          inscripcionesSnap.docs
            .map((d) => ({
              id: d.id,
              ...d.data(),
              esResumenNomina: false
            }))
            .filter((item) => {
              const estadoPrivacidad =
                normalizeSearchLocal(
                  item?.privacidad?.estado ||
                  ""
                );

              return (
                estadoPrivacidad !==
                  "eliminada_logica" &&
                estadoPrivacidad !==
                  "archivada"
              );
            })
        );

      state.inscripcionesFuente =
        "inscripciones_completas";

      console.warn(
        "[grupo] nomina_resumen vacío; se usaron inscripciones completas.",
        {
          groupDocId:
            state.groupDocId
        }
      );
    }

    state.inscripcionesCargadas =
      true;

    if (
      getInscripcionesSistemaPagos()
        .length > 0
    ) {
      state.grupoTieneNominaSistemaPagos =
        true;
    }
    
    /*
      La nómina ya está cargada y puede mostrarse.
    
      La revisión de alertas se ejecuta en segundo plano
      para que no bloquee la visualización de pasajeros.
    */
    sincronizarAlertasInscripcionesGrupo()
      .catch((error) => {
        console.error(
          "[grupo] sincronización de alertas en segundo plano",
          error
        );
      });
  } catch (error) {
    console.error(
      "[grupo] loadInscripciones",
      error
    );

    state.inscripciones = [];
    state.inscripcionesCargadas = false;
    state.inscripcionesFuente = "";

    throw error;
  } finally {
    state.inscripcionesCargando =
      false;
  }
}

async function cargarInscripcionCompletaPorId(
  inscripcionId = ""
) {
  const id =
    String(
      inscripcionId || ""
    ).trim();

  if (!id) {
    return null;
  }

  /*
    Si ya fue descargada anteriormente,
    devolvemos la copia guardada.
  */
  if (
    state.inscripcionesDetalleCache
      .has(id)
  ) {
    return state
      .inscripcionesDetalleCache
      .get(id);
  }

  const inscripcionRef =
    doc(
      db,
      "ventas_cotizaciones",
      String(state.groupDocId),
      "inscripciones",
      id
    );

  const snap =
    await getDoc(
      inscripcionRef
    );

  if (!snap.exists()) {
    return null;
  }

  const completa = {
    id: snap.id,
    ...snap.data(),
    esResumenNomina: false
  };

  state.inscripcionesDetalleCache
    .set(
      id,
      completa
    );

  return completa;
}

function reemplazarInscripcionEnEstado(
  inscripcionCompleta
) {
  if (!inscripcionCompleta?.id) {
    return;
  }

  const index =
    state.inscripciones.findIndex(
      (item) =>
        String(item.id) ===
        String(inscripcionCompleta.id)
    );

  if (index < 0) {
    return;
  }

  /*
    Reemplazamos solamente ese pasajero.
    El resto de la nómina sigue siendo liviana.
  */
  state.inscripciones[index] =
    inscripcionCompleta;
}

async function obtenerInscripcionCompleta(
  inscripcionId = ""
) {
  const itemVisible =
    state.inscripciones.find(
      (item) =>
        String(item.id) ===
        String(inscripcionId)
    );

  if (!itemVisible) {
    return null;
  }

  /*
    Si ya es un documento completo,
    no volvemos a consultar Firestore.
  */
  if (
    itemVisible.esResumenNomina !==
      true
  ) {
    return itemVisible;
  }

  const completa =
    await cargarInscripcionCompletaPorId(
      inscripcionId
    );

  if (!completa) {
    return null;
  }

  reemplazarInscripcionEnEstado(
    completa
  );

  return completa;
}

async function cargarTodasLasInscripcionesCompletas({
  mostrarProgreso = true
} = {}) {
  if (!state.inscripcionesCargadas) {
    const cargada = await asegurarNominaCargada({
      mostrar: true,
      renderizar: true
    });

    if (!cargada) {
      return false;
    }
  }

  const ids = state.inscripciones
    .map((item) => String(item.id || "").trim())
    .filter(Boolean);

  if (!ids.length) {
    return true;
  }

  const completas = [];

  for (let index = 0; index < ids.length; index += 1) {
    const id = ids[index];

    if (mostrarProgreso) {
      showSaveNotice(
        `Cargando fichas completas: ${index + 1} de ${ids.length}`
      );
    }

    const completa = await cargarInscripcionCompletaPorId(id);

    if (!completa) {
      console.error(
        "[grupo] No se pudo cargar inscripción completa",
        {
          groupDocId: state.groupDocId,
          inscripcionId: id
        }
      );

      return false;
    }

    completas.push(completa);
  }

  state.inscripciones =
    ordenarInscripcionesNomina(completas);

  return true;
}

async function asegurarNominaCargada({
  mostrar = true,
  renderizar = true
} = {}) {
  if (state.inscripcionesCargando) return false;

  if (state.inscripcionesCargadas) {
    if (mostrar) state.nominaVisible = true;

    if (renderizar) {
      renderInscripcionPasajerosPanel();
      syncButtons();
    }

    return true;
  }

  state.inscripcionesCargando = true;

  if (mostrar) {
    state.nominaVisible = true;
  }

  renderInscripcionPasajerosPanel();
  syncButtons();

  try {
    await loadInscripciones();

    if (mostrar) {
      state.nominaVisible = true;
    }

    if (renderizar) {
      renderInscripcionPasajerosPanel();
      syncButtons();
    }

    return true;
  } catch (error) {
    console.error("[grupo] asegurarNominaCargada", error);

    alert(
      "No se pudo cargar la nómina del grupo: " +
      (error?.message || "Error desconocido")
    );

    renderInscripcionPasajerosPanel();
    syncButtons();

    return false;
  }
}

async function toggleNominaPasajeros() {
  if (state.inscripcionesCargando) return;

  if (!state.inscripcionesCargadas) {
    await asegurarNominaCargada({
      mostrar: true,
      renderizar: true
    });

    return;
  }

  state.nominaVisible = !state.nominaVisible;

  renderInscripcionPasajerosPanel();
  syncButtons();
}

async function recargarNominaPasajeros() {
  if (state.inscripcionesCargando) {
    return;
  }

  state.inscripcionesCargadas = false;
  state.nominaVisible = true;
  state.inscripcionesFuente = "";
  state.inscripcionesDetalleCache =
    new Map();

  await asegurarNominaCargada({
    mostrar: true,
    renderizar: true
  });
}

function esperar(ms = 0) {
  return new Promise(
    (resolve) =>
      window.setTimeout(
        resolve,
        ms
      )
  );
}

async function recargarNominaDespuesDeCambio() {
  /*
    El resumen se actualiza mediante Cloud Function.
    Damos un margen breve antes de volver a consultarlo.
  */
  await esperar(900);

  state.inscripcionesDetalleCache =
    new Map();

  await loadInscripciones();

  renderInscripcionPasajerosPanel();
  syncButtons();
}

async function recargarNominaCompletaDespuesDeCambio() {
  /*
    El trigger necesita un pequeño margen para
    actualizar nomina_resumen.
  */
  await esperar(900);

  /*
    Primero volvemos a leer el resumen actualizado.
  */
  await loadInscripciones();

  /*
    El modal Editar nómina necesita todos los campos
    completos de cada inscripción.
  */
  const cargadas =
    await cargarTodasLasInscripcionesCompletas({
      mostrarProgreso: false
    });

  if (!cargadas) {
    throw new Error(
      "No fue posible volver a cargar las fichas completas."
    );
  }

  renderInscripcionPasajerosPanel();
  renderEditarNominaInscripcionModal();
  syncButtons();
}

function canManageEmailTemplates() {
  return !!normalizeEmail(state.effectiveEmail || "");
}

function getGrupoCortoCorreo() {
  const colegio = normalizeTextUpper(state.group?.colegio || "");
  const curso = normalizeTextUpper(state.group?.curso || "");
  const ano = cleanText(state.group?.anoViaje || "");

  return `${colegio}${curso ? ` ${curso}` : ""}${ano ? ` (${ano})` : ""}`.trim();
}

function getBuiltinEmailTemplateById(id = "") {
  if (id !== "__ficha_medica__") return null;

  return {
    id: "__ficha_medica__",
    nombre: "Ficha médica",
    categoria: "inscripcion",
    asuntoTemplate: "Ficha médica habilitada · {{grupoCorto}}",
    cuerpoTemplate:
`Estimados/as apoderados/as:

Junto con saludar, informamos que desde ahora se encuentra habilitado el ingreso de datos para completar la ficha médica del viaje de estudios del grupo {{grupoCorto}}.

Les solicitamos ingresar al link enviado por Turismo Rai Trai y completar cuidadosamente la información solicitada, especialmente antecedentes médicos, alergias, medicamentos, contactos de emergencia y datos personales del/de la pasajero/a.

Esta información es fundamental para la correcta organización del viaje y para que nuestro equipo pueda contar con los antecedentes necesarios antes de la salida.

Agradecemos completar el formulario dentro de los próximos días.

Saludos cordiales,
{{firmaUsuario}}
Turismo Rai Trai`
  };
}

function getEmailVariableMap({ email = "", contactLabel = "" } = {}) {
  const nombre1 = normalizeTextUpper(state.group?.nombreCliente || "");
  const nombre2 = normalizeTextUpper(state.group?.nombreCliente2 || "");

  const email1 = normalizeEmail(state.group?.correoCliente || "");
  const email2 = normalizeEmail(state.group?.correoCliente2 || "");
  const emailNorm = normalizeEmail(email || "");

  const contactName =
    emailNorm === email1
      ? (nombre1 || contactLabel || "")
      : emailNorm === email2
        ? (nombre2 || contactLabel || "")
        : (contactLabel || "");

  return {
    contacto: contactName || "",
    nombreContacto: contactName || "",
    email: emailNorm || "",
    correo: emailNorm || "",

    idGrupo: String(state.groupId || ""),
    aliasGrupo: cleanText(state.group?.aliasGrupo || ""),
    grupoCorto: getGrupoCortoCorreo(),
    nombreGrupo: cleanText(state.group?.nombreGrupo || ""),
    colegio: normalizeTextUpper(state.group?.colegio || ""),
    curso: normalizeTextUpper(state.group?.curso || ""),
    anoViaje: cleanText(state.group?.anoViaje || ""),
    comunaCiudad: normalizeTextUpper(state.group?.comunaCiudad || ""),
    destinoPrincipal: normalizeTextUpper(getDestinoPrincipalDisplay(state.group) || ""),
    programa: normalizeTextUpper(getProgramaDisplay(state.group) || ""),
    tramo: normalizeTextUpper(getTramoDisplay(state.group) || ""),
    mesViaje: normalizeTextUpper(getMesViajeDisplay(state.group) || ""),
    cantidadGrupo: cleanText(state.group?.cantidadGrupo || ""),
    vendedora: cleanText(state.group?.vendedora || state.group?.vendedoraCorreo || ""),
    numeroNegocio: cleanText(state.group?.numeroNegocio || ""),

    firmaUsuario: getDisplayName(state.effectiveUser),
    firmaCorreo: state.effectiveEmail || ""
  };
}

function replaceTemplateVariables(text = "", variables = {}) {
  return String(text || "").replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
    return String(variables[key] ?? "");
  });
}

function getSelectedEmailTemplate() {
  return getBuiltinEmailTemplateById(state.emailUi.selectedTemplateId) ||
    state.emailTemplates.find((item) => item.id === state.emailUi.selectedTemplateId) ||
    null;
}

function renderEmailTemplateOptions() {
  const select = $("email_template");
  if (!select) return;

  const current = state.emailUi.selectedTemplateId || "";

  select.innerHTML = `
    <option value="">Sin plantilla</option>
    <option value="__ficha_medica__">Ficha médica</option>
    ${state.emailTemplates.map((tpl) => `
      <option value="${escapeHtml(tpl.id)}">${escapeHtml(tpl.nombre || "Plantilla")}</option>
    `).join("")}
  `;

  select.value = current;
}

function buildDefaultEmailDraft({ email = "", contactLabel = "" } = {}) {
  const vars = getEmailVariableMap({ email, contactLabel });

  return {
    asunto: `Viaje de estudios ${vars.colegio || vars.aliasGrupo || ""}`.trim(),
    cuerpo:
`Hola ${vars.nombreContacto || ""},

Te escribo por el grupo ${vars.aliasGrupo || vars.nombreGrupo || vars.colegio || ""}${vars.anoViaje ? `, viaje ${vars.anoViaje}` : ""}.

Quedo atento(a) a tus comentarios.

Saludos,
${vars.firmaUsuario || ""}`.trim()
  };
}

function applyEmailTemplateSelection() {
  const para = normalizeEmail($("email_to")?.value || "");
  const contactLabel = cleanText($("email_contact_label")?.value || "");
  const tpl = getSelectedEmailTemplate();

  if (!tpl) {
    const draft = buildDefaultEmailDraft({ email: para, contactLabel });
    setFormValue("email_subject", draft.asunto);
    setFormValue("email_body", draft.cuerpo);
    return;
  }

  const vars = getEmailVariableMap({
    email: state.emailUi.mode === "bulk_inscripcion" ? "" : para,
    contactLabel: state.emailUi.mode === "bulk_inscripcion" ? "" : contactLabel
  });

  setFormValue("email_subject", replaceTemplateVariables(tpl.asuntoTemplate || "", vars));
  setFormValue("email_body", replaceTemplateVariables(tpl.cuerpoTemplate || "", vars));
}

function syncEmailTemplateButtons() {
  const canManage = canManageEmailTemplates();
  const hasSelected = !!state.emailUi.selectedTemplateId;

  const btnNew = $("btnNewEmailTemplate");
  const btnEdit = $("btnEditEmailTemplate");
  const btnDelete = $("btnDeleteEmailTemplate");

  if (btnNew) {
    btnNew.disabled = !canManage;
    btnNew.classList.toggle("hidden", !canManage);
  }

  if (btnEdit) {
    btnEdit.disabled = !canManage || !hasSelected;
    btnEdit.classList.toggle("hidden", !canManage);
  }

  if (btnDelete) {
    btnDelete.disabled = !canManage || !hasSelected;
    btnDelete.classList.toggle("hidden", !canManage);
  }
}

function ensureEmailBulkUi() {
  if ($("email_bulk_wrap")) return;

  const emailTo = $("email_to");
  if (!emailTo) return;

  const wrap = document.createElement("div");
  wrap.id = "email_bulk_wrap";
  wrap.className = "hidden form-field span-3 email-bulk-wrap";
  wrap.innerHTML = `
    <div class="email-bulk-head">
      <div>
        <div class="email-bulk-title">Destinatarios BCC / CCO</div>
        <div id="email_bulk_summary" class="email-bulk-summary"></div>
      </div>

      <div class="email-bulk-actions">
        <button type="button" class="btn-pill" data-email-bulk-select="all">Seleccionar todos</button>
        <button type="button" class="btn-pill" data-email-bulk-select="pending">Solo pendientes ficha médica</button>
        <button type="button" class="btn-pill" data-email-bulk-select="none">Limpiar</button>
      </div>
    </div>

    <div id="email_bulk_list" class="email-bulk-list"></div>
  `;

  emailTo.closest(".form-group, label, div")?.after(wrap);
}

function buildDestinatariosApoderadosInscripcion() {
  const vistos =
    new Set();

  return state.inscripciones
    /*
      Los anulados siguen visibles en la nómina,
      pero no deben recibir correos de ficha médica.
    */
    .filter(
      estaInscripcionActiva
    )
    .map((item) => {
      const correo =
        normalizeEmail(
          getByPath(
            item,
            "contactoPrincipal.correo"
          ) || ""
        );

      const nombreResponsable =
        getResponsablePrincipalNombre(item);

      const nombreParticipante =
        buildNombreCompletoInscripcion(item);

      const documento =
        getInscripcionDocumento(item);

      const pendienteFicha =
        fichaMedicaPendiente(item);

      return {
        id: item.id,
        correo,
        nombreResponsable,
        nombreParticipante,
        documento,
        pendienteFicha
      };
    })
    .filter((destinatario) => {
      if (!destinatario.correo) {
        return false;
      }

      if (
        vistos.has(
          destinatario.correo
        )
      ) {
        return false;
      }

      vistos.add(
        destinatario.correo
      );

      return true;
    })
    .sort((a, b) => {
      if (
        a.pendienteFicha !==
        b.pendienteFicha
      ) {
        return a.pendienteFicha
          ? -1
          : 1;
      }

      return a.nombreParticipante
        .localeCompare(
          b.nombreParticipante,
          "es"
        );
    });
}

function renderEmailBulkRecipients() {
  ensureEmailBulkUi();

  const list = $("email_bulk_list");
  const summary = $("email_bulk_summary");
  if (!list || !summary) return;

  const seleccionados = state.emailUi.bulkRecipients.filter((d) => d.selected);
  const pendientes = state.emailUi.bulkRecipients.filter((d) => d.pendienteFicha);

  summary.textContent =
    `${seleccionados.length} seleccionado(s) · ${state.emailUi.bulkRecipients.length} correos disponibles · ${pendientes.length} pendiente(s) de ficha médica`;

  list.innerHTML = state.emailUi.bulkRecipients.length
    ? state.emailUi.bulkRecipients.map((d, index) => `
      <label class="email-bulk-row">
        <input
          type="checkbox"
          data-email-bulk-index="${index}"
          ${d.selected ? "checked" : ""}
        />

        <div>
          <div class="email-bulk-name">${escapeHtml(d.nombreParticipante || "Participante")}</div>
          <div class="email-bulk-detail">
            Apoderado/a: ${escapeHtml(d.nombreResponsable || "—")} · ${escapeHtml(d.correo)}
          </div>
          <div class="${d.pendienteFicha ? "email-bulk-pending" : "email-bulk-ok"}">
            ${d.pendienteFicha ? "Ficha médica pendiente" : "Ficha médica completa"}
          </div>
        </div>
      </label>
    `).join("")
    : `<div class="empty-box">No hay correos de apoderados disponibles.</div>`;
}

function syncEmailBulkVisibility() {
  ensureEmailBulkUi();

  const bulkWrap = $("email_bulk_wrap");
  const emailTo = $("email_to");

  if (!bulkWrap || !emailTo) return;

  const isBulk = state.emailUi.mode === "bulk_inscripcion";

  bulkWrap.classList.toggle("hidden", !isBulk);
  emailTo.disabled = isBulk;

  if (isBulk) {
    emailTo.value = "";
  }
}

function openEmailModalInscripcion() {
  const destinatarios = buildDestinatariosApoderadosInscripcion();

  if (!destinatarios.length) {
    alert("No hay correos de apoderados disponibles para este grupo.");
    return;
  }

  state.emailUi.mode = "bulk_inscripcion";
  state.emailUi.activeTargetEmail = "";
  state.emailUi.selectedTemplateId = "__ficha_medica__";
  state.emailUi.bulkRecipients = destinatarios.map((d) => ({
    ...d,
    selected: d.pendienteFicha
  }));

  const hayPendientes = state.emailUi.bulkRecipients.some((d) => d.selected);
  if (!hayPendientes) {
    state.emailUi.bulkRecipients = state.emailUi.bulkRecipients.map((d) => ({
      ...d,
      selected: true
    }));
  }

  setFormValue("email_to", "");
  setFormValue("email_contact_label", "");
  setFormValue("email_subject", "");
  setFormValue("email_body", "");

  renderEmailTemplateOptions();
  syncEmailTemplateButtons();
  syncEmailBulkVisibility();
  renderEmailBulkRecipients();
  applyEmailTemplateSelection();

  openModal("modalCorreo");
}

function getSelectedBulkEmails() {
  return state.emailUi.bulkRecipients
    .filter((d) => d.selected && d.correo)
    .map((d) => d.correo);
}

async function openEmailModal({ email = "", contactLabel = "" } = {}) {
  const normalizedEmail = normalizeEmail(email || "");
  if (!normalizedEmail) {
    alert("Este contacto no tiene correo disponible.");
    return;
  }

  state.emailUi.mode = "single";
  state.emailUi.bulkRecipients = [];
  state.emailUi.activeTargetEmail = normalizedEmail;
  state.emailUi.selectedTemplateId = "";

  setFormValue("email_to", normalizedEmail);
  setFormValue("email_contact_label", contactLabel || "");
  setFormValue("email_subject", "");
  setFormValue("email_body", "");

  renderEmailTemplateOptions();
  syncEmailTemplateButtons();
  syncEmailBulkVisibility();
  applyEmailTemplateSelection();

  openModal("modalCorreo");
}

function openEmailTemplateModal(mode = "create") {
  if (!canManageEmailTemplates()) {
    alert("Solo admin y supervisión pueden administrar plantillas.");
    return;
  }

  if (mode === "edit") {
    const tpl = getSelectedEmailTemplate();

    const currentEmail = normalizeEmail(state.effectiveEmail || "");
    if (normalizeEmail(tpl?.ownerEmail || "") !== currentEmail) {
      alert("Solo puedes editar tus propias plantillas.");
      return;
    }

    if (!tpl) {
      alert("Debes seleccionar una plantilla.");
      return;
    }

    state.emailUi.editingTemplateId = tpl.id;
    setText("emailTemplateModalTitle", "Editar plantilla");
    setFormValue("tpl_nombre", tpl.nombre || "");
    setFormValue("tpl_asunto", tpl.asuntoTemplate || "");
    setFormValue("tpl_cuerpo", tpl.cuerpoTemplate || "");
    setFormValue("tpl_categoria", tpl.categoria || "grupo");
  } else {
    state.emailUi.editingTemplateId = "";
    setText("emailTemplateModalTitle", "Nueva plantilla");
    setFormValue("tpl_nombre", "");
    setFormValue("tpl_asunto", "");
    setFormValue("tpl_cuerpo", "");
    setFormValue("tpl_categoria", "grupo");
  }

  openModal("modalTemplateEmail");
}

async function saveEmailTemplate() {
  if (!canManageEmailTemplates()) {
    alert("Solo admin y supervisión pueden administrar plantillas.");
    return;
  }

  const nombre = cleanText($("tpl_nombre")?.value || "");
  const asuntoTemplate = String($("tpl_asunto")?.value || "").trim();
  const cuerpoTemplate = String($("tpl_cuerpo")?.value || "").trim();
  const categoria = cleanText($("tpl_categoria")?.value || "grupo") || "grupo";

  if (!nombre) {
    alert("Debes ingresar un nombre para la plantilla.");
    return;
  }

  if (!asuntoTemplate) {
    alert("Debes ingresar un asunto para la plantilla.");
    return;
  }

  if (!cuerpoTemplate) {
    alert("Debes ingresar un cuerpo para la plantilla.");
    return;
  }

  const payload = {
    nombre,
    categoria,
    asuntoTemplate,
    cuerpoTemplate,
    activa: true,

    ownerEmail: normalizeEmail(state.effectiveEmail || ""),
    ownerName: getDisplayName(state.effectiveUser),

    actualizadoPor: getDisplayName(state.effectiveUser),
    actualizadoPorCorreo: state.effectiveEmail,
    fechaActualizacion: serverTimestamp()
  };

  if (state.emailUi.editingTemplateId) {
    await updateDoc(doc(db, EMAIL_TEMPLATES_COLLECTION, state.emailUi.editingTemplateId), payload);

    await createHistoryEntry({
      tipoMovimiento: "plantilla_correo_editada",
      modulo: "correo",
      titulo: "Plantilla de correo editada",
      asunto: nombre,
      mensaje: `${getDisplayName(state.effectiveUser)} editó la plantilla "${nombre}".`
    });
  } else {
    await addDoc(collection(db, EMAIL_TEMPLATES_COLLECTION), {
      ...payload,
      creadoPor: getDisplayName(state.effectiveUser),
      creadoPorCorreo: state.effectiveEmail,
      fechaCreacion: serverTimestamp()
    });

    await createHistoryEntry({
      tipoMovimiento: "plantilla_correo_creada",
      modulo: "correo",
      titulo: "Plantilla de correo creada",
      asunto: nombre,
      mensaje: `${getDisplayName(state.effectiveUser)} creó la plantilla "${nombre}".`
    });
  }

  await loadEmailTemplates();
  renderEmailTemplateOptions();
  syncEmailTemplateButtons();

  closeModal("modalTemplateEmail");
  showSaveNotice("Plantilla guardada correctamente.");
}

async function deleteSelectedEmailTemplate() {
  if (!canManageEmailTemplates()) {
    alert("Solo admin y supervisión pueden administrar plantillas.");
    return;
  }

  const tpl = getSelectedEmailTemplate();
  if (!tpl) {
    alert("Debes seleccionar una plantilla.");
    return;
  }

  const currentEmail = normalizeEmail(state.effectiveEmail || "");
  if (normalizeEmail(tpl.ownerEmail || "") !== currentEmail) {
    alert("Solo puedes eliminar tus propias plantillas.");
    return;
  }

  const ok = confirm(`¿Eliminar la plantilla "${tpl.nombre}"?`);
  if (!ok) return;

  await deleteDoc(doc(db, EMAIL_TEMPLATES_COLLECTION, tpl.id));

  await createHistoryEntry({
    tipoMovimiento: "plantilla_correo_eliminada",
    modulo: "correo",
    titulo: "Plantilla de correo eliminada",
    asunto: tpl.nombre || "Plantilla",
    mensaje: `${getDisplayName(state.effectiveUser)} eliminó la plantilla "${tpl.nombre || "Plantilla"}".`
  });

  state.emailUi.selectedTemplateId = "";
  await loadEmailTemplates();
  renderEmailTemplateOptions();
  syncEmailTemplateButtons();
  applyEmailTemplateSelection();

  showSaveNotice("Plantilla eliminada correctamente.");
}

async function goToGmailWithDraft() {
  const isBulk = state.emailUi.mode === "bulk_inscripcion";

  const para = normalizeEmail($("email_to")?.value || "");
  const bccList = isBulk ? getSelectedBulkEmails() : [];
  const asunto = String($("email_subject")?.value || "").trim();
  const cuerpo = String($("email_body")?.value || "").trim();
  const contactLabel = cleanText($("email_contact_label")?.value || "");
  const tpl = getSelectedEmailTemplate();

  if (!isBulk && !para) {
    alert("Debes indicar un destinatario.");
    return;
  }

  if (isBulk && !bccList.length) {
    alert("Debes seleccionar al menos un apoderado.");
    return;
  }

  if (!asunto) {
    alert("Debes indicar un asunto.");
    return;
  }

  if (!cuerpo) {
    alert("Debes indicar el cuerpo del correo.");
    return;
  }

  const baseUrl = "https://mail.google.com/mail/u/0/?view=cm&fs=1";

  const paramsArray = [];

  if (isBulk) {
    paramsArray.push(`bcc=${encodeURIComponent(bccList.join(","))}`);
  } else {
    paramsArray.push(`to=${encodeURIComponent(para)}`);
  }

  paramsArray.push(`su=${encodeURIComponent(asunto)}`);
  paramsArray.push(`body=${encodeURIComponent(cuerpo)}`);

  window.open(`${baseUrl}&${paramsArray.join("&")}`, "_blank", "noopener");

  await createHistoryEntry({
    tipoMovimiento: "correo_preparado",
    modulo: "correo",
    titulo: isBulk ? "Correo masivo preparado" : "Correo preparado",
    asunto: asunto,
    mensaje: isBulk
      ? `${getDisplayName(state.effectiveUser)} preparó un correo masivo por Gmail para ${bccList.length} apoderado(s) del grupo ${getGrupoCortoCorreo()}${tpl ? ` usando la plantilla "${tpl.nombre}"` : ""}.`
      : `${getDisplayName(state.effectiveUser)} preparó un correo para ${contactLabel || para}${tpl ? ` usando la plantilla "${tpl.nombre}"` : ""}.`,
    metadata: {
      modo: isBulk ? "bulk_inscripcion" : "single",
      destinatario: isBulk ? "" : para,
      bcc: isBulk ? bccList : [],
      totalBcc: isBulk ? bccList.length : 0,
      plantillaId: tpl?.id || "",
      plantillaNombre: tpl?.nombre || "",
      asuntoCorreo: asunto,
      grupoCorto: getGrupoCortoCorreo()
    }
  });

  closeModal("modalCorreo");
  showSaveNotice(isBulk ? "Se abrió Gmail con los apoderados en BCC/CCO." : "Se abrió Gmail con el borrador listo.");
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

function canEditGroup() {
  if (!state.canModify) return false;

  const isVendor = String(state.effectiveUser?.rol || "").toLowerCase() === "vendedor";

  if (isAdministracionBlockedFromGroupEdit()) {
    return false;
  }

  if (isVendor && isVendorLockedByFlow(state.group)) {
    return false;
  }

  if (state.group?.autorizada && isVendor) {
    return false;
  }

  return canAccessGroup(state.group);
}

function isRolAdminOSupervision() {
  const rol = String(state.effectiveUser?.rol || "").toLowerCase();
  return rol === "admin" || rol === "supervision";
}

function isRolRegistro() {
  const rol = String(state.effectiveUser?.rol || "").toLowerCase();
  return rol === "registro";
}

function isRolAdministracionInscripcion() {
  const email = normalizeEmail(state.effectiveEmail || "");

  return (
    isRolAdminOSupervision() ||
    isRolRegistro() ||
    email === "yenny@raitrai.cl" ||
    email === "administracion@raitrai.cl" ||
    email === "raitrai@raitrai.cl"
  );
}

function isRolVendedorInscripcion() {
  return String(state.effectiveUser?.rol || "").toLowerCase() === "vendedor";
}

function getAnoViajeInscripcion() {
  return Number(state.group?.anoViaje || 0);
}

function tieneProcesoPrincipalAntiguoInvalido() {
  /*
    Para grupos cuya nómina viene de Sistema de Pagos,
    el único proceso principal válido es:

    nomina_final

    Algunas fichas antiguas pueden conservar:
    - inscripcionHabilitada: true
    - fase normal
    - fase nuevos
    - fase lista_espera

    Esas marcas pertenecen al flujo anterior y no deben
    impedir abrir Nómina final / ficha médica.
  */
  if (!grupoVieneSistemaAntiguo()) {
    return false;
  }

  if (state.group?.inscripcionHabilitada !== true) {
    return false;
  }

  const faseGuardada =
    normalizeSearchLocal(
      getInscripcionEstadoActual()
    );

  return faseGuardada !== "nomina_final";
}

function inscripcionPrincipalEstaCerrada() {
  /*
    Una marca antigua inválida se considera cerrada
    únicamente para decidir qué proceso principal ofrecer.

    No se modifican Lista de espera, Nuevos ingresos
    ni Cupos liberados.
  */
  if (tieneProcesoPrincipalAntiguoInvalido()) {
    return true;
  }

  return (
    state.group?.inscripcionHabilitada !== true ||
    normalizeSearchLocal(
      getInscripcionEstadoActual()
    ) === "cerrada"
  );
}

function esFechaListaEsperaAutomatica() {
  const anoViaje = getAnoViajeInscripcion();
  if (!anoViaje || anoViaje < 2027) return false;

  const hoy = new Date();
  const inicioListaEspera = new Date(anoViaje, 2, 16, 0, 0, 0); // 16 marzo

  return hoy >= inicioListaEspera;
}

function debeSugerirListaEspera() {
  const anoViaje = getAnoViajeInscripcion();

  if (anoViaje === 2026 && inscripcionPrincipalEstaCerrada()) return true;
  if (anoViaje >= 2027 && esFechaListaEsperaAutomatica()) return true;

  return false;
}

function puedeAbrirCerrarFasesInscripcion() {
  if (normalizeState(state.group?.estado) !== "ganada") return false;

  const rol = String(state.effectiveUser?.rol || "").toLowerCase();

  if (rol === "admin" || rol === "supervision") return true;
  if (rol === "vendedor" && canAccessGroup(state.group)) return true;

  return false;
}

function puedeReabrirFasePasada() {
  const rol = String(
    state.effectiveUser?.rol || ""
  ).toLowerCase();

  const email = normalizeEmail(
    state.effectiveEmail || ""
  );

  return (
    rol === "admin" ||
    rol === "supervision" ||
    email === "chernandez@raitrai.cl"
  );
}

function puedeOperarListaEsperaAdministrativa() {
  const rol = String(state.effectiveUser?.rol || "").toLowerCase();
  const email = normalizeEmail(state.effectiveEmail || "");

  return (
    rol === "admin" ||
    rol === "registro" ||
    isGirasConPermisoAdministracion() ||
    email === "administracion@raitrai.cl" ||
    email === "yenny@raitrai.cl" ||
    email === "raitrai@raitrai.cl"
  );
}

function puedeExportarCsvInscripciones() {
  return puedeOperarListaEsperaAdministrativa();
}

function getOrigenNominaGrupo() {
  /*
    Primero usamos la detección liviana realizada al cargar
    el portafolio del grupo.
  */
  if (state.grupoTieneNominaSistemaPagos === true) {
    return "sistema_pagos";
  }

  const origenGuardado = normalizeSearchLocal(
    state.group?.origenNomina ||
    state.group?.nominaOrigen ||
    state.group?.inscripcion?.origenNomina ||
    state.group?.sistemaPagos?.origenNomina ||
    ""
  ).replace(/\s+/g, "_");

  if (
    origenGuardado === "sistema_pagos" ||
    origenGuardado === "sistema_de_pagos"
  ) {
    return "sistema_pagos";
  }

  if (
    origenGuardado === "inscripcion_inicial" ||
    origenGuardado === "nomina_inicial"
  ) {
    return "inscripcion_inicial";
  }

  const tieneNominaPagosGuardada =
    state.group?.sistemaPagos?.nominaImportada === true ||
    state.group?.sistemaPagos?.importada === true ||
    state.group?.nominaImportadaPagos === true ||
    state.group?.nominaImportadaSistemaPagos === true ||
    state.group?.inscripcion?.nominaImportada === true;

  if (tieneNominaPagosGuardada) {
    return "sistema_pagos";
  }

  /*
    Si la nómina completa ya fue cargada, dejamos también
    este respaldo de detección.
  */
  if (
    state.inscripcionesCargadas &&
    getInscripcionesSistemaPagos().length > 0
  ) {
    return "sistema_pagos";
  }

  return "inscripcion_inicial";
}

function grupoVieneSistemaAntiguo() {
  return getOrigenNominaGrupo() === "sistema_pagos";
}

function getOrigenNominaLabel() {
  return getOrigenNominaGrupo() === "sistema_pagos"
    ? "Sistema de Pagos"
    : "Inscripción inicial";
}

function getFasesCerradasInscripcion() {
  return state.group?.inscripcion?.fasesCerradas || {};
}

function faseInscripcionYaCerrada(clave = "") {
  return !!getFasesCerradasInscripcion()[clave];
}

function inscripcionInicialYaCerrada() {
  return faseInscripcionYaCerrada("inscripcion_inicial");
}

function nominaFinalYaCerrada() {
  return faseInscripcionYaCerrada("nomina_final");
}

function correspondeListaEsperaPorFecha() {
  const anoViaje = getAnoViajeInscripcion();

  if (anoViaje === 2026) return true;
  if (!anoViaje || anoViaje < 2027) return false;

  return esFechaListaEsperaAutomatica();
}

function correspondeNuevosIngresosPorFecha() {
  const anoViaje = getAnoViajeInscripcion();

  if (!anoViaje || anoViaje < 2027) return false;
  if (anoViaje === 2026) return false;

  return !esFechaListaEsperaAutomatica();
}

function puedeMarcarListaEsperaPagada() {
  return normalizeState(state.group?.estado) === "ganada" &&
    puedeOperarListaEsperaAdministrativa();
}

function canGestionarInscripcionInicial() {
  if (!puedeAbrirCerrarFasesInscripcion()) return false;
  if (!inscripcionPrincipalEstaCerrada()) return false;

  // Si tiene firma vendedor, viene del sistema antiguo:
  // no debe abrir inscripción inicial, sino nómina final.
  if (grupoVieneSistemaAntiguo()) return false;

  // Si ya se cerró la inscripción inicial, no vuelve a aparecer,
  // salvo Admin o Jefa de ventas.
  if (inscripcionInicialYaCerrada() && !puedeReabrirFasePasada()) return false;

  return true;
}

function canGestionarNominaFinal() {
  if (!puedeAbrirCerrarFasesInscripcion()) return false;
  if (!inscripcionPrincipalEstaCerrada()) return false;

  // Solo grupos con firma vendedor vienen del sistema antiguo.
  if (!grupoVieneSistemaAntiguo()) return false;

  // Si ya se cerró la nómina final, no vuelve a aparecer,
  // salvo Admin o Jefa de ventas.
  if (nominaFinalYaCerrada() && !puedeReabrirFasePasada()) return false;

  return true;
}

function esAdminOSupervisionInscripcion() {
  const rol = String(
    state.effectiveUser?.rol || ""
  ).toLowerCase();

  return (
    rol === "admin" ||
    rol === "supervision"
  );
}

function getEstadoNuevosIngresos() {
  const data =
    state.group?.inscripcionNuevos || {};

  return {
    activo: data.activo === true,
    token: cleanText(
      data.tokenActual || ""
    ),
    link: cleanText(
      data.linkActual || ""
    )
  };
}

function getEstadoListaEsperaLink() {
  const data =
    state.group?.inscripcionListaEspera || {};

  return {
    activo: data.activo === true,
    token: cleanText(
      data.tokenActual || ""
    ),
    link: cleanText(
      data.linkActual || ""
    )
  };
}

function getEstadoLiberadosLink() {
  const data =
    state.group?.inscripcionLiberados || {};

  return {
    activo:
      state.group?.linkLiberadosActivo === true ||
      data.activo === true,

    token: cleanText(
      state.group?.tokenInscripcionLiberados ||
      data.tokenActual ||
      ""
    ),

    link: cleanText(
      data.linkActual || ""
    )
  };
}

function grupoTieneFlujoBaseDisponible() {
  /*
    Sistema nuevo:
    debe haberse cerrado la inscripción inicial.

    Sistema de Pagos:
    puede operar nuevos ingresos/lista de espera aunque
    la importación todavía no se haya ejecutado.
  */
  if (grupoVieneSistemaAntiguo()) {
    return true;
  }

  if (grupoTieneFirmaVendedor(state.group)) {
    return true;
  }

  return inscripcionInicialYaCerrada();
}

function canGestionarNuevosIngresos() {
  if (
    normalizeState(state.group?.estado) !==
    "ganada"
  ) {
    return false;
  }

  if (!puedeAbrirCerrarFasesInscripcion()) {
    return false;
  }

  /*
    Admin y Supervisión pueden abrir o cerrar
    esta fase en cualquier fecha.
  */
  if (esAdminOSupervisionInscripcion()) {
    return true;
  }

  /*
    Para usuarios normales solamente corresponde
    antes del 16 de marzo del año del viaje.
  */
  if (!correspondeNuevosIngresosPorFecha()) {
    return false;
  }

  if (!grupoTieneFlujoBaseDisponible()) {
    return false;
  }

  return true;
}

function canGestionarListaEspera() {
  if (
    normalizeState(state.group?.estado) !==
    "ganada"
  ) {
    return false;
  }

  if (!puedeAbrirCerrarFasesInscripcion()) {
    return false;
  }

  /*
    Admin y Supervisión pueden abrir o cerrar
    Lista de espera sin restricción de fecha.
  */
  if (esAdminOSupervisionInscripcion()) {
    return true;
  }

  /*
    Usuarios normales:
    desde el 16 de marzo del año del viaje.
  */
  if (!correspondeListaEsperaPorFecha()) {
    return false;
  }

  if (!grupoTieneFlujoBaseDisponible()) {
    return false;
  }

  return true;
}

function canGestionarLiberados() {
  if (
    normalizeState(state.group?.estado) !==
    "ganada"
  ) {
    return false;
  }

  if (!puedeAbrirCerrarFasesInscripcion()) {
    return false;
  }

  /*
    Liberados está disponible en cualquier etapa.
    No depende de que la inscripción principal esté
    abierta o cerrada.
  */
  return true;
}

function canConfirmarListaEspera() {
  return normalizeState(state.group?.estado) === "ganada" &&
    puedeOperarListaEsperaAdministrativa();
}

function getBlockedInscripcionMessage() {
  return "No tienes permisos para realizar esta acción de inscripción.";
}

function canManageMeetings() {
  if (!state.canModify) return false;

  // Reuniones se pueden seguir creando/editando aunque el vendedor ya haya firmado.
  // La firma bloquea datos y situación, pero no agenda.
  return canAccessGroup(state.group);
}

function canCreateAlertsAndComments() {
  /*
   * REGLA:
   *
   * Alertas manuales y comentarios son herramientas
   * de trabajo del grupo.
   *
   * Cualquier usuario que tenga acceso al grupo
   * puede utilizarlas, sin importar:
   *
   * - rol;
   * - estado comercial;
   * - si puede editar la cotización;
   * - si la ficha está cerrada;
   * - si el grupo está ganado, perdido, etc.
   */
  if (!state.group) {
    return false;
  }

  return canAccessGroup(
    state.group
  );
}

function canEditDocuments() {
  const rol = String(state.effectiveUser?.rol || "").toLowerCase();
  return rol === "admin" || rol === "supervision";
}

function canEditSchoolName() {
  const rol = String(state.effectiveUser?.rol || "").toLowerCase();

  // Regla real de negocio:
  // solo vendedor no puede cambiar el colegio.
  if (rol === "vendedor") return false;

  // Si puede modificar el grupo, puede cambiar el colegio.
  return canEditGroup();
}

function canManageHistoryItems() {
  return canAccessGroup(state.group);
}

function isEffectiveVendorRole() {
  return String(state.effectiveUser?.rol || "").toLowerCase() === "vendedor";
}

function isRealAdminRoleGrupo() {
  return String(state.effectiveUser?.rol || "").toLowerCase() === "admin";
}

function isJefaVentasStrict() {
  return normalizeEmail(state.effectiveEmail || "") === "chernandez@raitrai.cl";
}

function canBypassEstadoAutorizadoLock() {
  return isRealAdminRoleGrupo() || isJefaVentasStrict();
}

function hasFichaPdfVigente(groupData = state.group || {}) {
  const tienePdf = !!cleanText(
    getByPath(groupData, "ficha.pdfUrl") ||
    groupData?.fichaPdfUrl ||
    ""
  );

  return tienePdf && !groupData?.fichaFlujoAbierto;
}

function isGrupoAutorizadoVisual(groupData = state.group || {}) {
  const anoViajeNum = Number(groupData?.anoViaje || 0);
  const esLegacy2025 = anoViajeNum <= 2025;

  if (esLegacy2025) return !!groupData?.autorizada;

  return !!groupData?.autorizada || hasFichaPdfVigente(groupData);
}

function canEditSituacionGrupo() {
  // Misma regla que editar datos:
  // si el vendedor ya firmó, queda bloqueado para cambiar situación.
  // Ganada NO bloquea por sí sola.
  // No metemos aquí regla de autorizada.
  return canEditGroup();
}

function grupoTieneNominaImportadaSistemaPagos() {
  /*
    Esta es ahora la señal principal.
    Se obtiene con una consulta liviana al abrir el grupo.
  */
  if (state.grupoTieneNominaSistemaPagos === true) {
    return true;
  }

  const origen = normalizeSearchLocal(
    state.group?.origenNomina ||
    state.group?.nominaOrigen ||
    state.group?.inscripcion?.origenNomina ||
    state.group?.sistemaPagos?.origenNomina ||
    ""
  ).replace(/\s+/g, "_");

  if (
    origen === "sistema_pagos" ||
    origen === "sistema_de_pagos"
  ) {
    return true;
  }

  const tieneMarcaDirecta = !!(
    state.group?.sistemaPagos?.nominaImportada === true ||
    state.group?.sistemaPagos?.importada === true ||
    state.group?.nominaImportadaPagos === true ||
    state.group?.nominaImportadaSistemaPagos === true ||
    state.group?.inscripcion?.nominaImportada === true
  );

  if (tieneMarcaDirecta) {
    return true;
  }

  /*
    Respaldo adicional para cuando la nómina completa
    ya fue cargada manualmente.
  */
  if (
    state.inscripcionesCargadas &&
    getInscripcionesSistemaPagos().length > 0
  ) {
    return true;
  }

  return false;
}

function canEditElementosIncluidosGrupo() {
  if (!canAccessGroup(state.group)) return false;

  const rol = String(
    state.effectiveUser?.rol || ""
  ).toLowerCase();

  const email = normalizeEmail(
    state.effectiveEmail || ""
  );

  // Admin y supervisión.
  if (rol === "admin" || rol === "supervision") {
    return true;
  }

  // Administración y Registro.
  if (
    rol === "registro" ||
    isGirasConPermisoAdministracion() ||
    email === "yenny@raitrai.cl" ||
    email === "administracion@raitrai.cl" ||
    email === "raitrai@raitrai.cl"
  ) {
    return true;
  }

  if (rol !== "vendedor") {
    return canEditGroup();
  }

  // Excepción solicitada:
  // el vendedor puede editar estos checkbox en grupos con
  // nómina importada desde Sistema de Pagos, aunque ya haya firmado.
  if (grupoTieneNominaImportadaSistemaPagos()) {
    return true;
  }

  // Grupos normales:
  // vendedor solamente antes de firmar.
  return (
    state.canModify &&
    !isVendorLockedByFlow(state.group)
  );
}

function canOpenSituacionModal() {
  return (
    canEditSituacionGrupo() ||
    canEditElementosIncluidosGrupo()
  );
}

async function guardarElementosIncluidos() {
  if (!canEditElementosIncluidosGrupo()) {
    alert(
      "No tienes permisos para editar los elementos incluidos."
    );

    return;
  }

  const otros = $("s_elementoOtros")?.checked === true;

  const otrosDetalle = cleanText(
    $("s_elementoOtrosDetalle")?.value || ""
  );

  if (otros && !otrosDetalle) {
    alert(
      "Debes explicar qué otros elementos tiene el grupo."
    );

    $("s_elementoOtrosDetalle")?.focus();
    return;
  }

  const anterior = getElementosIncluidosGrupo();

  const nuevo = {
    poleron:
      $("s_elementoPoleron")?.checked === true,

    polera:
      $("s_elementoPolera")?.checked === true,

    soporteCelular:
      $("s_elementoSoporteCelular")?.checked === true,

    portapasaporte:
      $("s_elementoPortapasaporte")?.checked === true,

    toalla:
      $("s_elementoToalla")?.checked === true,

    cortesias:
      $("s_elementoCortesias")?.checked === true,

    otros,

    otrosDetalle:
      otros ? otrosDetalle : "",

    actualizadoPor:
      getDisplayName(state.effectiveUser),

    actualizadoPorCorreo:
      state.effectiveEmail,

    actualizadoAt:
      serverTimestamp()
  };

  const camposComparables = [
    "poleron",
    "polera",
    "soporteCelular",
    "portapasaporte",
    "toalla",
    "cortesias",
    "otros",
    "otrosDetalle"
  ];

  const cambios = camposComparables
    .filter((campo) => {
      return anterior[campo] !== nuevo[campo];
    })
    .map((campo) => ({
      campo: `elementosIncluidos.${campo}`,
      anterior: anterior[campo],
      nuevo: nuevo[campo]
    }));

  if (!cambios.length) {
    showSaveNotice(
      "No hay cambios en los elementos incluidos."
    );

    return;
  }

  const btn = $("btnGuardarElementosIncluidos");

  if (btn) {
    btn.disabled = true;
    btn.textContent = "Guardando...";
  }

  try {
    await saveGroupPatch(
      {
        elementosIncluidos: nuevo
      },
      {
        tipoMovimiento:
          "elementos_incluidos_actualizados",

        modulo:
          "grupo",

        titulo:
          "Elementos incluidos actualizados",

        mensaje:
          `${getDisplayName(state.effectiveUser)} actualizó los elementos incluidos del grupo.`,

        cambios,

        metadata: {
          origenNomina:
            getOrigenNominaGrupo(),

          permisoEspecialSistemaPagos:
            grupoTieneNominaImportadaSistemaPagos()
        }
      }
    );

    closeModal("modalSituacion");

    showSaveNotice(
      "Elementos incluidos guardados correctamente."
    );
  } catch (error) {
    console.error(
      "[grupo] guardarElementosIncluidos",
      error
    );

    alert(
      "Error al guardar los elementos incluidos: " +
      (error?.message || "Error desconocido")
    );
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Guardar elementos";
    }
  }
}

function getElementosIncluidosGrupo() {
  const data = state.group?.elementosIncluidos;

  /*
    Regla de compatibilidad:

    - Si el grupo todavía no tiene elementosIncluidos,
      los elementos habituales se consideran incluidos.
    - Un elemento solamente queda desmarcado cuando está
      guardado explícitamente como false.
    - "Otros" se mantiene desmarcado por defecto.
  */
  return {
    poleron: data?.poleron !== false,
    polera: data?.polera !== false,
    soporteCelular: data?.soporteCelular !== false,
    portapasaporte: data?.portapasaporte !== false,
    toalla: data?.toalla !== false,
    cortesias: data?.cortesias !== false,

    otros: data?.otros === true,

    otrosDetalle: cleanText(
      data?.otrosDetalle || ""
    )
  };
}

function setCheckboxValue(id, checked) {
  const input = $(id);
  if (!input) return;

  input.checked = checked === true;
}

function syncElementosOtrosVisibility() {
  const tieneOtros = $("s_elementoOtros")?.checked === true;
  const wrap = $("wrapElementoOtrosDetalle");

  wrap?.classList.toggle("hidden", !tieneOtros);

  if (!tieneOtros) {
    setFormValue("s_elementoOtrosDetalle", "");
  }
}

function fillElementosIncluidosModal() {
  const elementos = getElementosIncluidosGrupo();

  setCheckboxValue("s_elementoPoleron", elementos.poleron);
  setCheckboxValue("s_elementoPolera", elementos.polera);
  setCheckboxValue(
    "s_elementoSoporteCelular",
    elementos.soporteCelular
  );
  setCheckboxValue(
    "s_elementoPortapasaporte",
    elementos.portapasaporte
  );
  setCheckboxValue("s_elementoToalla", elementos.toalla);
  setCheckboxValue("s_elementoCortesias", elementos.cortesias);
  setCheckboxValue("s_elementoOtros", elementos.otros);

  setFormValue(
    "s_elementoOtrosDetalle",
    elementos.otrosDetalle
  );

  syncElementosOtrosVisibility();
}

function syncSituacionModalPermissions() {
  const puedeSituacion = canEditSituacionGrupo();
  const puedeElementos = canEditElementosIncluidosGrupo();

  const camposSituacion = [
    "s_estado",
    "s_mensajeHistorial",
    "s_fechaReunion"
  ];

  camposSituacion.forEach((id) => {
    const el = $(id);
    if (el) el.disabled = !puedeSituacion;
  });

  ["s_obsAdmin", "s_obsOperaciones"].forEach((id) => {
    const editor = $(id);
    if (!editor) return;

    editor.contentEditable = puedeSituacion
      ? "true"
      : "false";

    editor.classList.toggle(
      "is-readonly",
      !puedeSituacion
    );
  });

  const camposElementos = [
    "s_elementoPoleron",
    "s_elementoPolera",
    "s_elementoSoporteCelular",
    "s_elementoPortapasaporte",
    "s_elementoToalla",
    "s_elementoCortesias",
    "s_elementoOtros",
    "s_elementoOtrosDetalle"
  ];

  camposElementos.forEach((id) => {
    const el = $(id);
    if (el) el.disabled = !puedeElementos;
  });

  const btnSituacion = $("btnGuardarSituacion");

  if (btnSituacion) {
    btnSituacion.disabled = !puedeSituacion;
    btnSituacion.classList.toggle(
      "hidden",
      !puedeSituacion
    );
  }

  const btnElementos = $("btnGuardarElementosIncluidos");

  if (btnElementos) {
    btnElementos.disabled = !puedeElementos;
    btnElementos.classList.toggle(
      "hidden",
      !puedeElementos
    );
  }

  const aviso = $("situacionPermisosEspeciales");

  if (aviso) {
    const soloElementos =
      !puedeSituacion &&
      puedeElementos;

    aviso.classList.toggle(
      "hidden",
      !soloElementos
    );
  }
}

function shouldAutoMarkVendorGroupAsContacted(groupData = {}) {
  return (
    isEffectiveVendorRole() &&
    canAccessGroup(groupData) &&
    normalizeState(groupData.estado) === "a_contactar"
  );
}

function getEstadoChangeFromCambios(cambios = []) {
  return Array.isArray(cambios)
    ? cambios.find((item) => String(item?.campo || "").trim() === "estado")
    : null;
}

function applyEstadoAuditFields(patch = {}, cambios = []) {
  const estadoChange = getEstadoChangeFromCambios(cambios);
  if (!estadoChange) return;

  // Marca visual para la ficha y panel de situación
  patch.fechaUltimoCambioEstado = serverTimestamp();
  setNestedValue(patch, "situacion.fechaUltimoCambioEstado", serverTimestamp());

  // También deja huella como última gestión
  if (!("ultimaGestionAt" in patch)) {
    patch.ultimaGestionAt = serverTimestamp();
  }

  if (!("ultimaGestionTipo" in patch)) {
    patch.ultimaGestionTipo = "cambio_estado";
  }
}

async function autoMarkVendorGroupAsContactedOnOpen() {
  if (!shouldAutoMarkVendorGroupAsContacted(state.group)) return false;
  if (!state.groupDocId) return false;

  const targetDocId = String(state.groupDocId);
  const targetGroupId = String(state.groupId || "");
  const estadoAnterior = normalizeState(state.group?.estado);

  // Blindaje extra:
  // solo cambia el grupo actualmente abierto en pantalla.
  await saveGroupPatch(
    {
      estado: "contactado"
    },
    {
      tipoMovimiento: "cambio_estado",
      modulo: "grupo",
      titulo: "Cambio automático de estado",
      mensaje: `${getDisplayName(state.effectiveUser)} abrió el grupo ${targetGroupId} y el sistema cambió su estado de A contactar a Contactado.`,
      cambios: [
        {
          campo: "estado",
          anterior: estadoAnterior,
          nuevo: "contactado"
        }
      ],
      metadata: {
        targetDocId,
        targetGroupId,
        origen: "apertura_grupo"
      }
    }
  );

  return true;
}

function isJefaVentas() {
  return normalizeEmail(state.effectiveEmail) === "chernandez@raitrai.cl" || state.effectiveUser?.rol === "admin";
}

function isGirasConPermisoAdministracion() {
  return normalizeEmail(state.effectiveEmail || "") === "giras@raitrai.cl";
}

function isAdministracion() {
  const email = normalizeEmail(state.effectiveEmail || "");
  const rol = String(state.effectiveUser?.rol || "").toLowerCase();

  if (rol === "admin") return true;
  if (isGirasConPermisoAdministracion()) return true;

  return (
    email === "yenny@raitrai.cl" ||
    email === "administracion@raitrai.cl" ||
    email === "raitrai@raitrai.cl"
  );
}

function isStrictAdministracionUser() {
  const email = normalizeEmail(state.effectiveEmail || "");

  return (
    isGirasConPermisoAdministracion() ||
    email === "yenny@raitrai.cl" ||
    email === "administracion@raitrai.cl" ||
    email === "raitrai@raitrai.cl"
  );
}

function isAdministracionBlockedFromGroupEdit() {
  const flow = state.group?.flowFicha || {};

  return (
    isStrictAdministracionUser() &&
    normalizeState(state.group?.estado) === "ganada" &&
    !!flow?.vendedor?.firmado
  );
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

function isVendorLockedByFlow(groupData = {}) {
  const flow = groupData.flowFicha || {};

  // Regla de negocio:
  // si el vendedor ya firmó, queda bloqueado aunque el grupo sea legacy.
  // La excepción legacy aplica al cierre / PDF real y al flujo posterior,
  // no a que el vendedor siga editando.
  return !!flow?.vendedor?.firmado;
}

function canCreateFichaFromEstado() {
  return normalizeState(state.group?.estado) === "ganada";
}

function getFichaSummary() {
  const ficha = getByPath(state.group, "ficha") || {};

  const numeroNegocio =
    ficha.numeroNegocio ??
    state.group.numeroNegocio ??
    "";
  
  const version =
    ficha.version ||
    state.group.versionFicha ||
    "";
  
  const fechaActualizacion =
    ficha.fechaActualizacion ||
    state.group.fechaActualizacionFicha ||
    "";
  
  const pdfUrl =
    cleanText(
      ficha.pdfUrl ||
      state.group.fichaPdfUrl ||
      ficha.urlPdf ||
      ""
    );
  
  const pdfNombre =
    cleanText(
      ficha.pdfNombre ||
      state.group.fichaPdfNombre ||
      ficha.nombrePdf ||
      ""
    );

  const estadoRaw =
    state.group.fichaEstado ||
    ficha.estado ||
    (pdfUrl || numeroNegocio || version ? "ok" : "pendiente");

  const programa =
    cleanText(
      ficha.nombrePrograma ||
      state.group.programa ||
      ""
    );

  const tramo =
    cleanText(
      ficha.tramo ||
      state.group.tramo ||
      ""
    );

  const hotel =
    cleanText(
      ficha.categoriaHoteleraContratada ||
      state.group.categoriaHoteleraContratada ||
      state.group.hotel ||
      state.group.solicitudHotel ||
      ""
    );

  // Fecha tentativa:
  // 1) semanaViaje del grupo
  // 2) fechaViajeTexto de ficha
  // 3) fechaViaje real si existe
  const fechaTentativa =
    cleanText(
      state.group.semanaViaje ||
      ficha.fechaViajeTexto ||
      ""
    ) ||
    (toDate(state.group.fechaViaje) ? formatDate(state.group.fechaViaje) : "");

  return {
    exists: Boolean(
      pdfUrl ||
      numeroNegocio ||
      version ||
      fechaActualizacion ||
      Object.keys(ficha).length
    ),
    estadoLabel: getFichaEstadoLabel(estadoRaw),
    numeroNegocio: stringValue(numeroNegocio) || "—",
    version: stringValue(version) || "—",
    fechaActualizacion: toDate(fechaActualizacion)
      ? formatDate(fechaActualizacion)
      : (stringValue(fechaActualizacion) || "—"),
    pdfUrl,
    pdfNombre: pdfNombre || "PDF ficha",

    // Resumen visual rápido
    programa: programa || "—",
    tramo: tramo || "—",
    hotel: hotel || "—",
    fechaTentativa: fechaTentativa || "—"
  };
}

function shouldShowInscripcionPanel() {
  const isGanada = normalizeState(state.group?.estado) === "ganada";
  const habilitada = !!state.group?.inscripcionHabilitada;
  const tieneInscritos = Array.isArray(state.inscripciones) && state.inscripciones.length > 0;

  return isGanada || habilitada || tieneInscritos;
}

function getInscripcionEstadoActual() {
  const estado = cleanText(
    state.group?.inscripcionEstado ||
    state.group?.inscripcion?.estado ||
    state.group?.faseInscripcion ||
    ""
  );

  if (estado) return estado;

  if (state.group?.inscripcionHabilitada) return "normal";

  return "cerrada";
}

function grupoTieneFirmaVendedor(data = state.group || {}) {
  return !!(
    data?.firmaVendedor ||
    data?.firmaVendedora ||
    data?.firmaVendedorFecha ||
    data?.firmaVendedoraFecha ||
    data?.firmaVendedorNombre ||
    data?.firmaVendedoraNombre ||
    data?.firmas?.vendedor?.fecha ||
    data?.firmas?.vendedora?.fecha ||
    data?.flowFicha?.vendedor?.firmado
  );
}

function getContextoInscripcionGrupo(fase = "normal", groupData = state.group || {}) {
  const key = normalizeSearchLocal(fase);

  if (key === "nomina_final") {
    return {
      clave: "nomina_final",
      faseInscripcion: "nomina_final",
      tipoInscripcion: "nomina_final",
      labelFase: "Nómina final / ficha médica",
      labelTipo: "Nómina final / ficha médica",
      estadoCupo: "confirmado"
    };
  }

  if (key === "nuevos") {
    return {
      clave: "nuevo_ingreso",
      faseInscripcion: "nuevos",
      tipoInscripcion: "nuevo_ingreso",
      labelFase: "Nuevo ingreso",
      labelTipo: "Nuevo ingreso",
      estadoCupo: "pendiente_confirmacion"
    };
  }

  if (key === "lista_espera") {
    return {
      clave: "lista_espera",
      faseInscripcion: "lista_espera",
      tipoInscripcion: "lista_espera",
      labelFase: "Lista de espera",
      labelTipo: "Lista de espera",
      estadoCupo: "pendiente_pago"
    };
  }

  if (key === "liberado") {
    return {
      clave: "liberado",
      faseInscripcion: "liberado",
      tipoInscripcion: "liberado",
      labelFase: "Cupo liberado",
      labelTipo: "Cupo liberado",
      estadoCupo: "confirmado"
    };
  }

  if (key === "cerrada") {
    return {
      clave: "cerrada",
      faseInscripcion: "cerrada",
      tipoInscripcion: "",
      labelFase: "Cerrada",
      labelTipo: "Cerrada",
      estadoCupo: ""
    };
  }

  return {
    clave: "inscripcion_inicial",
    faseInscripcion: "normal",
    tipoInscripcion: "nomina_inicial",
    labelFase: "Inscripción inicial",
    labelTipo: "Inscripción inicial",
    estadoCupo: "confirmado"
  };
}

function getTipoInscripcionFromFase(fase = "") {
  return getContextoInscripcionGrupo(fase).tipoInscripcion || "nomina_inicial";
}

function getEstadoCupoFromFase(fase = "") {
  return getContextoInscripcionGrupo(fase).estadoCupo || "confirmado";
}

function getInscripcionFaseLabel(fase = "") {
  return getContextoInscripcionGrupo(fase).labelFase || formatInscripcionValue(fase);
}

function getEstadoOperativoInscripcionLabel(item = {}) {
  const tipo = normalizeSearchLocal(getInscripcionTipoReal(item));
  const estadoCupo = normalizeSearchLocal(item.estadoCupo || "");

  if (
    esCupoReservado(item)
  ) {
    return esCupoReservadoPendiente(item)
      ? "Cupo reservado · Liberado pendiente"
      : "Cupo reservado · Consumido";
  }

  if (tipo === "nuevo_ingreso_confirmado") {
    return "Nuevo ingreso confirmado";
  }

  if (tipo === "nuevo_ingreso") {
    return estadoCupo === "confirmado"
      ? "Nuevo ingreso confirmado"
      : "Nuevo ingreso pendiente";
  }

  if (tipo === "lista_espera_confirmada") {
    return "Lista de espera confirmada";
  }

  if (tipo === "lista_espera_pagada") {
    return "Lista de espera pagada";
  }

  if (tipo === "lista_espera") {
    if (estadoCupo === "confirmado") return "Lista de espera confirmada";
    if (estadoCupo === "pagado") return "Lista de espera pagada";

    return "Lista de espera pendiente";
  }

  if (tipo === "sistema_pagos") {
    return fichaMedicaPendiente(item)
      ? "Sistema de Pagos · Ficha pendiente"
      : "Sistema de Pagos · Ficha completa";
  }

  return getTipoInscripcionLabel(tipo);
}

function getOrdenOperativoInscripcion(item = {}) {
  /*
    Todos los anulados van al final,
    independientemente del tipo de inscripción.
  */
  if (estaInscripcionAnulada(item)) {
    return 1000;
  }

  /*
    Los cupos reservados pendientes quedan
    visibles junto a la nómina operativa,
    antes de los registros menos relevantes.
  */
  if (
    esCupoReservadoPendiente(item)
  ) {
    return 8;
  }

  if (
    esCupoReservado(item)
  ) {
    return 900;
  }

  const tipo =
    normalizeSearchLocal(
      getInscripcionTipoReal(item)
    );

  const estadoCupo =
    normalizeSearchLocal(
      item.estadoCupo || ""
    );

  if (
    tipo === "lista_espera_confirmada" ||
    (
      tipo === "lista_espera" &&
      estadoCupo === "confirmado"
    )
  ) {
    return 1;
  }

  if (
    tipo === "lista_espera_pagada" ||
    (
      tipo === "lista_espera" &&
      estadoCupo === "pagado"
    )
  ) {
    return 2;
  }

  if (tipo === "lista_espera") {
    return 3;
  }

  if (
    tipo === "nuevo_ingreso_confirmado" ||
    (
      tipo === "nuevo_ingreso" &&
      estadoCupo === "confirmado"
    )
  ) {
    return 4;
  }

  if (tipo === "nuevo_ingreso") {
    return 5;
  }

  if (
    tipo === "nomina_inicial" ||
    tipo === "nomina_final" ||
    tipo === "sistema_pagos"
  ) {
    return 6;
  }

  if (tipo === "liberado") {
    return 7;
  }

  return 99;
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

function formatFechaFormularioTabla(value) {
  const d = toDate(value);
  if (!d) return "—";

  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(-2);
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");

  return `${dd}-${mm}-${yy} ${hh}:${min}`;
}

function getTipoInscripcionLabel(value = "") {
  const key =
    normalizeSearchLocal(value)
      .replace(/\s+/g, "_");
  
  if (
    key === "cupo_reservado"
  ) {
    return "Cupo reservado";
  }

  if (
    key === "sistema_pagos" ||
    key === "sistema_de_pagos"
  ) {
    return "Sistema de Pagos";
  }

  if (
    key === "nomina_inicial" ||
    key === "inscripcion_inicial"
  ) {
    return "Inscripción inicial";
  }

  if (
    key === "nomina_final" ||
    key === "nomina_final_ficha_medica"
  ) {
    return "Nómina final / ficha médica";
  }

  if (key === "nuevo_ingreso") {
    return "Nuevo ingreso";
  }

  if (key === "lista_espera") {
    return "Lista de espera";
  }

  if (
    key ===
    "lista_espera_confirmada"
  ) {
    return "Lista de espera confirmada";
  }

  if (
    key === "liberado" ||
    key === "cupo_liberado"
  ) {
    return "Cupo liberado";
  }

  return "Inscripción inicial";
}

function getTipoInscripcionClass(item = {}) {
  const tipo = normalizeSearchLocal(item.tipoInscripcion || item.estadoInscripcion || item.faseInscripcion || "nomina_inicial");
  const estadoCupo = normalizeSearchLocal(item.estadoCupo || "");

  if (tipo === "nomina_final") return "insc-nomina-final";
  if (tipo === "liberado") return "insc-liberado";
  if (tipo === "lista_espera" && estadoCupo === "confirmado") return "insc-lista-espera-confirmada";
  if (tipo === "lista_espera_confirmada") return "insc-lista-espera-confirmada";
  
  if (tipo === "lista_espera_pagada") return "insc-lista-espera-pagada";
  if (tipo === "lista_espera" && estadoCupo === "pagado") return "insc-lista-espera-pagada";
  
  if (tipo === "lista_espera") return "insc-lista-espera";
  if (tipo === "nuevo_ingreso" || tipo === "nuevos") return "insc-nuevo-ingreso";

  return "insc-nomina-inicial";
}

function getInscripcionTipoReal(item = {}) {
  /*
    Cupo reservado tiene prioridad,
    porque todavía no representa a una persona.
  */
  if (esCupoReservado(item)) {
    return "cupo_reservado";
  }

  const raw =
    item.tipoInscripcion ||
    "";

  const key =
    normalizeSearchLocal(raw)
      .replace(/\s+/g, "_");

  if (
    key === "inscripcion_inicial"
  ) {
    return "nomina_inicial";
  }

  if (
    key === "nomina_inicial"
  ) {
    return "nomina_inicial";
  }

  if (
    key === "nomina_final"
  ) {
    return "nomina_final";
  }

  if (
    key ===
    "nomina_final_ficha_medica"
  ) {
    return "nomina_final";
  }

  if (
    key === "sistema_de_pagos"
  ) {
    return "sistema_pagos";
  }

  if (
    key === "sistema_pagos"
  ) {
    return "sistema_pagos";
  }

  if (
    key === "nuevo_ingreso"
  ) {
    return "nuevo_ingreso";
  }

  if (
    key ===
    "nuevo_ingreso_confirmado"
  ) {
    return "nuevo_ingreso_confirmado";
  }

  if (
    key === "lista_espera"
  ) {
    return "lista_espera";
  }

  if (
    key ===
    "lista_espera_pagada"
  ) {
    return "lista_espera_pagada";
  }

  if (
    key ===
    "lista_espera_confirmada"
  ) {
    return "lista_espera_confirmada";
  }

  if (
    key === "liberado" ||
    key === "cupo_liberado"
  ) {
    return "liberado";
  }

  return getTipoInscripcionFromFase(
    item.faseInscripcion ||
    item.estadoInscripcion ||
    "normal"
  );
}

function esNominaFinalOperativa(item = {}) {
  const tipo = normalizeSearchLocal(getInscripcionTipoReal(item));
  const estadoCupo = normalizeSearchLocal(item.estadoCupo || "");

  if (tipo === "nuevo_ingreso") {
    return estadoCupo === "confirmado";
  }

  if (tipo === "lista_espera") {
    return estadoCupo === "confirmado";
  }

  if (tipo === "lista_espera_pagada") {
    return false;
  }

  return (
    tipo === "nomina_inicial" ||
    tipo === "nomina_final" ||
    tipo === "sistema_pagos" ||
    tipo === "nuevo_ingreso_confirmado" ||
    tipo === "lista_espera_confirmada" ||
    tipo === "liberado"
  );
}

function getInscripcionesSistemaPagos() {
  return state.inscripciones.filter((item) =>
    normalizeSearchLocal(getInscripcionTipoReal(item)) === "sistema_pagos"
  );
}

function fichaMedicaPendiente(item = {}) {
  /*
    Un cupo reservado todavía no es una persona.
    Nunca puede considerarse ficha médica pendiente.
  */
  if (
    esCupoReservado(item)
  ) {
    return false;
  }
  /*
    Una persona anulada no debe seguir apareciendo
    como ficha médica pendiente.
  */
  if (estaInscripcionAnulada(item)) {
    return false;
  }

  const tipo =
    normalizeSearchLocal(
      getInscripcionTipoReal(item)
    );

  /*
    Regla actual:
    solamente pasajeros originalmente importados
    desde Sistema de Pagos tienen ficha médica pendiente
    por este flujo.
  */
  if (tipo !== "sistema_pagos") {
    return false;
  }

  return !(
    item.fichaMedicaCompleta === true ||
    item.nominaFinalCompleta === true ||
    item.fichaMedicaCompletada === true ||
    item.nominaFinalCompletada === true ||
    item.fichaMedicaEstado === "completa" ||
    item.fichaMedicaEstado === "completada"
  );
}

function getInscripcionesConFichaMedicaPendiente() {
  return state.inscripciones.filter(
    (item) =>
      estaInscripcionActiva(item) &&
      esNominaFinalOperativa(item) &&
      fichaMedicaPendiente(item)
  );
}

function getInscripcionesConFichaMedicaCompleta() {
  return state.inscripciones.filter(
    (item) =>
      estaInscripcionActiva(item) &&
      esNominaFinalOperativa(item) &&
      !fichaMedicaPendiente(item)
  );
}

function getEstadoListaPasajerosLabel() {
  /*
    Para Sistema de Pagos, una marca antigua distinta
    de nomina_final no representa un proceso principal.
  */
  if (tieneProcesoPrincipalAntiguoInvalido()) {
    return "Nómina final / ficha médica pendiente de apertura";
  }

  if (
    !state.inscripciones.length &&
    !state.group?.inscripcionHabilitada
  ) {
    return "Sin inscripciones";
  }

  const estado =
    normalizeSearchLocal(
      getInscripcionEstadoActual()
    );

  const abierta =
    state.group?.inscripcionHabilitada === true;

  if (estado === "normal") {
    return abierta
      ? "Inscripción inicial abierta"
      : "Inscripción inicial cerrada";
  }

  if (estado === "nomina_final") {
    return abierta
      ? "Nómina final / ficha médica abierta"
      : "Nómina final / ficha médica cerrada";
  }

  /*
    Nuevos ingresos y Lista de espera ahora son
    procesos paralelos. No deben definir el estado
    del proceso principal.
  */
  if (grupoVieneSistemaAntiguo()) {
    return "Nómina final / ficha médica pendiente de apertura";
  }

  return "Inscripción cerrada";
}

function getLiberadosPermitidos() {
  return Number(
    state.group?.liberados ||
    state.group?.cantidadLiberados ||
    state.group?.ficha?.liberados ||
    state.group?.ficha?.cantidadLiberados ||
    0
  );
}

function getLiberadosUsados() {
  return state.inscripciones.filter(
    (item) =>
      estaInscripcionActiva(item) &&
      normalizeSearchLocal(
        getInscripcionTipoReal(item)
      ) === "liberado"
  ).length;
}

/* =========================================================
   CUPOS RESERVADOS PARA LIBERADOS

   Estos registros serán creados/sincronizados
   posteriormente desde Sistema de Pagos.

   REGLA:
   - un cupo reservado pendiente CUENTA COMO VIAJERO;
   - no es todavía una persona individualizada;
   - no cuenta como ficha médica pendiente;
   - cuando un liberado lo consume, deja de sumar como cupo.
========================================================= */

function esCupoReservado(item = {}) {
  const tipoRegistro =
    normalizeSearchLocal(
      item.tipoRegistro ||
      ""
    ).replace(/\s+/g, "_");

  const tipoInscripcion =
    normalizeSearchLocal(
      item.tipoInscripcion ||
      item.estadoInscripcion ||
      ""
    ).replace(/\s+/g, "_");

  return (
    item.esCupoReservado === true ||
    tipoRegistro === "cupo_reservado" ||
    tipoInscripcion === "cupo_reservado"
  );
}

function esCupoReservadoPendiente(item = {}) {
  if (!esCupoReservado(item)) {
    return false;
  }

  const estado =
    normalizeSearchLocal(
      item.estadoCupoReservado ||
      item.cupoReservado?.estado ||
      item.estadoCupo ||
      ""
    ).replace(/\s+/g, "_");

  /*
    Compatibilidad:
    si todavía no trae estado explícito,
    un documento marcado como cupo reservado
    se considera pendiente.
  */
  if (!estado) {
    return true;
  }

  return ![
    "consumido",
    "anulado",
    "eliminado",
    "cerrado"
  ].includes(estado);
}

function getCuposReservadosPendientes() {
  return state.inscripciones.filter(
    esCupoReservadoPendiente
  );
}

function getViajerosIdentificados() {
  return state.inscripciones.filter(
    (item) =>
      estaInscripcionActiva(item) &&
      !esCupoReservado(item) &&
      esNominaFinalOperativa(item)
  );
}

function getTotalViajanOperativo() {
  return (
    getViajerosIdentificados().length +
    getCuposReservadosPendientes().length
  );
}

function renderInscripcionPasajerosPanel() {
  const panel = $("panelInscripcionPasajeros");
  const box = $("panelInscripcionPasajerosBody");
  if (!panel || !box) return;

  asegurarEstilosInscripcionesAnuladas();

  const visible = shouldShowInscripcionPanel();
  panel.classList.toggle("hidden", !visible);

  if (!visible) return;

  if (state.inscripcionesCargando) {
    box.innerHTML = `
      <div class="nomina-carga-box">
        <div class="nomina-carga-icon">⏳</div>
  
        <div>
          <div class="nomina-carga-title">Cargando nómina</div>
          <div class="nomina-carga-text">
            Se están consultando los pasajeros inscritos para este grupo.
          </div>
        </div>
      </div>
    `;
  
    return;
  }
  
  if (!state.inscripcionesCargadas) {
    box.innerHTML = `
      <div class="nomina-carga-box">
        <div class="nomina-carga-icon">👥</div>
  
        <div class="nomina-carga-content">
          <div class="nomina-carga-title">Nómina no cargada</div>
  
          <div class="nomina-carga-text">
            Para que el portafolio abra más rápido, los pasajeros se consultan
            solamente cuando necesitas ver la nómina.
          </div>
  
          <button
            id="btnVerNominaPasajeros"
            class="btn-dark"
            type="button"
          >
            Ver nómina
          </button>
        </div>
      </div>
    `;
  
    return;
  }
  
  if (!state.nominaVisible) {
    box.innerHTML = `
      <div class="nomina-carga-box">
        <div class="nomina-carga-icon">👥</div>
  
        <div class="nomina-carga-content">
          <div class="nomina-carga-title">
            Nómina cargada
          </div>
  
          <div class="nomina-carga-text">
            Se cargaron ${state.inscripciones.length} inscripción(es).
          </div>
  
          <div class="nomina-carga-actions">
            <button
              id="btnVerNominaPasajeros"
              class="btn-dark"
              type="button"
            >
              Mostrar nómina
            </button>
  
            <button
              id="btnRecargarNominaPasajeros"
              class="btn-pill"
              type="button"
            >
              Recargar
            </button>
          </div>
        </div>
      </div>
    `;
  
    return;
  }

  /*
    =====================================================
    RESUMEN OPERATIVO

    VIAJAN SIEMPRE ES EL DATO PRINCIPAL.

    VIAJAN =
    personas identificadas que realmente viajan
    +
    cupos reservados pendientes
    =====================================================
  */

  const totalBruto =
    state.inscripciones.length;

  const totalAnulados =
    state.inscripciones.filter(
      (item) =>
        !esCupoReservado(item) &&
        estaInscripcionAnulada(item)
    ).length;

  /*
    Dejamos aquí solamente personas reales.
    Los cupos reservados se manejan aparte.
  */
  const inscripcionesActivas =
    state.inscripciones.filter(
      (item) =>
        estaInscripcionActiva(item) &&
        !esCupoReservado(item)
    );

  const viajerosIdentificados =
    getViajerosIdentificados();

  const cuposReservados =
    getCuposReservadosPendientes();

  /*
    ESTE ES EL NÚMERO IMPORTANTE.
  */
  const totalViajan =
    viajerosIdentificados.length +
    cuposReservados.length;

  const totalViajerosIdentificados =
    viajerosIdentificados.length;

  const totalCuposReservados =
    cuposReservados.length;
  
  const capacidad =
    Number(
      state.group?.cantidadGrupo || 0
    );
  
  const nominaFinalOperativa =
    inscripcionesActivas.filter(
      esNominaFinalOperativa
    ).length;
  
  const nominaInicial =
    getInscripcionesNominaInicial()
      .filter(
        estaInscripcionActiva
      )
      .length;
  
  const fichaPendiente =
    getInscripcionesConFichaMedicaPendiente()
      .length;
  
  const fichaCompleta =
    getInscripcionesConFichaMedicaCompleta()
      .length;
  
  const nuevosConfirmados =
    inscripcionesActivas.filter((item) => {
      const tipo =
        normalizeSearchLocal(
          getInscripcionTipoReal(item)
        );
  
      const estadoCupo =
        normalizeSearchLocal(
          item.estadoCupo || ""
        );
  
      return (
        tipo ===
          "nuevo_ingreso_confirmado" ||
        (
          tipo ===
            "nuevo_ingreso" &&
          estadoCupo ===
            "confirmado"
        )
      );
    }).length;
  
  const nuevosPendientes =
    inscripcionesActivas.filter((item) => {
      const tipo =
        normalizeSearchLocal(
          getInscripcionTipoReal(item)
        );
  
      const estadoCupo =
        normalizeSearchLocal(
          item.estadoCupo || ""
        );
  
      return (
        tipo ===
          "nuevo_ingreso" &&
        estadoCupo !==
          "confirmado"
      );
    }).length;
  
  const esperaPendiente =
    inscripcionesActivas.filter((item) => {
      const tipo =
        normalizeSearchLocal(
          getInscripcionTipoReal(item)
        );
  
      const estadoCupo =
        normalizeSearchLocal(
          item.estadoCupo || ""
        );
  
      return (
        tipo ===
          "lista_espera" &&
        estadoCupo !==
          "pagado" &&
        estadoCupo !==
          "confirmado"
      );
    }).length;
  
  const esperaPagada =
    inscripcionesActivas.filter((item) => {
      const tipo =
        normalizeSearchLocal(
          getInscripcionTipoReal(item)
        );
  
      const estadoCupo =
        normalizeSearchLocal(
          item.estadoCupo || ""
        );
  
      return (
        tipo ===
          "lista_espera_pagada" ||
        (
          tipo ===
            "lista_espera" &&
          estadoCupo ===
            "pagado"
        )
      );
    }).length;
  
  const esperaConfirmada =
    inscripcionesActivas.filter((item) => {
      const tipo =
        normalizeSearchLocal(
          getInscripcionTipoReal(item)
        );
  
      const estadoCupo =
        normalizeSearchLocal(
          item.estadoCupo || ""
        );
  
      return (
        tipo ===
          "lista_espera_confirmada" ||
        (
          tipo ===
            "lista_espera" &&
          estadoCupo ===
            "confirmado"
        )
      );
    }).length;
  const liberadosPermitidos = getLiberadosPermitidos();
  const liberadosUsados = getLiberadosUsados();

  const estadoInscripcion = getInscripcionEstadoActual();
  const linkInfo = state.group?.inscripcion || {};
  const liberadosInfo = state.group?.inscripcionLiberados || {};

  const tabla = state.inscripciones.length
    ? `
      <div class="inscripcion-table-wrap">
        <table class="inscripcion-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Tipo inscripción</th>
              <th>Fecha formulario</th>
              <th>RUT / Documento</th>
              <th>Apellidos</th>
              <th>Nombres</th>
              <th>Fecha nacimiento</th>
              <th>Tipo pasajero</th>
              <th>Nacionalidad</th>
              <th>Sexo / género</th>
              <th>Carnet identidad</th>
              <th>Responsable</th>
              <th>Correo responsable</th>
              <th>Celular responsable</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            ${state.inscripciones.map((item, index) => {
              const tipoReal = getInscripcionTipoReal(item);
              const tipoRealKey = normalizeSearchLocal(tipoReal);
              const estadoCupoKey = normalizeSearchLocal(item.estadoCupo || "");

              const esReservaLiberado =
                esCupoReservado(item);
              
              const esListaEsperaPendiente =
                tipoRealKey === "lista_espera" &&
                estadoCupoKey !== "pagado" &&
                estadoCupoKey !== "confirmado";
              
              const esListaEsperaPagada =
                tipoRealKey === "lista_espera_pagada" ||
                (tipoRealKey === "lista_espera" && estadoCupoKey === "pagado");

              return `
                <tr
                    class="${escapeHtml(
                      [
                        getTipoInscripcionClass(item),
                        estaInscripcionAnulada(item)
                          ? "inscripcion-anulada-row"
                          : ""
                      ]
                        .filter(Boolean)
                        .join(" ")
                    )}"
                  >
                  <td>${index + 1}</td>
                  <td>
                    ${escapeHtml(
                      getEstadoOperativoInscripcionLabel(item)
                    )}
                  
                    ${getEstadoViajeInscripcionHtml(item)}
                  </td>
                  <td>${escapeHtml(formatFechaFormularioTabla(getFechaFormularioInscripcion(item)))}</td>
                  <td>
                    ${
                      esReservaLiberado
                        ? `<strong>— SIN RUT —</strong>`
                        : `
                          <button
                            class="inscripcion-doc-link"
                            type="button"
                            title="Descargar ficha individual"
                            data-descargar-ficha-inscripcion="${escapeHtml(item.id)}"
                          >
                            ${escapeHtml(getInscripcionDocumento(item))}
                          </button>
                        `
                    }
                  </td>
                  <td>${escapeHtml(getInscripcionApellidos(item))}</td>
                  <td>${escapeHtml(getInscripcionNombres(item))}</td>
                  <td>${escapeHtml(formatDateOnlyForTable(getByPath(item, "identificacion.fechaNacimiento")))}</td>
                  <td>${escapeHtml(formatInscripcionValue(item.tipoViajante || item.tipoParticipacion || ""))}</td>
                  <td>${escapeHtml(getInscripcionNacionalidad(item))}</td>
                  <td>
                    ${escapeHtml(
                      getInscripcionGenero(item)
                    )}
                  </td>
                  
                  <td>
                    ${getCarnetIdentidadHtml(item)}
                  </td>
                  
                  <td>
                    ${escapeHtml(
                      getResponsablePrincipalNombre(item)
                    )}
                  </td>
                  <td>${escapeHtml(getByPath(item, "contactoPrincipal.correo") || "—")}</td>
                  <td>${escapeHtml(getByPath(item, "contactoPrincipal.celular") || getByPath(item, "contactoPrincipal.telefono") || getByPath(item, "contactoPrincipal.whatsapp") || "—")}</td>
                  <td>
                    ${
                      normalizeSearchLocal(tipoReal) === "nuevo_ingreso" &&
                      normalizeSearchLocal(item.estadoCupo || "") !== "confirmado"
                        ? `<button class="inscripcion-action-btn" type="button" data-confirmar-nuevo-ingreso="${escapeHtml(item.id)}">Confirmar nuevo ingreso</button>`
                        : esListaEsperaPendiente
                          ? `<button class="inscripcion-action-btn" type="button" data-marcar-lista-pagada="${escapeHtml(item.id)}">Marcar pagado</button>`
                          : esListaEsperaPagada
                            ? `<button class="inscripcion-action-btn" type="button" data-confirmar-cupo="${escapeHtml(item.id)}">Confirmar cupo</button>`
                            : "—"
                                                }
                            
                                                <div style="margin-top:6px;">
                                                  <button
                                                    class="inscripcion-action-btn"
                                                    type="button"
                                                    data-reenviar-correo-inscripcion="${escapeHtml(item.id)}"
                                                  >
                                                    Reenviar correo
                                                  </button>
                                                </div>
                                              </td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      </div>
    `
    : `<div class="empty-box">Todavía no hay personas inscritas para este grupo.</div>`;

  box.innerHTML = `
    <div class="grupo-kpi-list">
      <div class="grupo-kpi">
        <div class="info-label">Origen nómina</div>
        <div class="info-value">${escapeHtml(getOrigenNominaLabel())}</div>
      </div>

      <div class="grupo-kpi">
        <div class="info-label">Estado inscripción</div>
        <div class="info-value">${escapeHtml(getEstadoListaPasajerosLabel())}</div>
      </div>

      <div class="grupo-kpi">
        <div class="info-label">Total inscritos</div>
      
        <div class="info-value">
          ${escapeHtml(
            `${totalViajan} viajan / ${totalCuposReservados} cupos reservados / ${totalAnulados} anulados / ${totalBruto} registros`
          )}
        </div>
      </div>

      <div class="grupo-kpi">
        <div class="info-label">Ficha médica</div>
        <div class="info-value">${escapeHtml(`${fichaCompleta} completas / ${fichaPendiente} pendientes`)}</div>
      </div>

      <div class="grupo-kpi">
        <div class="info-label">Nómina inicial</div>
        <div class="info-value">${escapeHtml(`${nominaInicial}${capacidad ? ` / ${capacidad}` : ""} pasajeros`)}</div>
      </div>

      <div class="grupo-kpi">
        <div class="info-label">Nuevos ingresos</div>
        <div class="info-value">${escapeHtml(`${nuevosConfirmados} confirmados / ${nuevosPendientes} pendientes`)}</div>
      </div>

      <div class="grupo-kpi">
        <div class="info-label">Lista espera</div>
        <div class="info-value">${escapeHtml(`${esperaConfirmada} confirmados / ${esperaPagada} pagados / ${esperaPendiente} pendientes`)}</div>
      </div>

      <div class="grupo-kpi">
        <div class="info-label">Liberados</div>

        <div class="info-value">
          ${escapeHtml(
            `${liberadosUsados} confirmados / ${totalCuposReservados} cupos reservados pendientes${
              liberadosPermitidos
                ? ` / ${liberadosPermitidos} configurados`
                : ""
            }`
          )}
        </div>
      </div>
    </div>

    ${tabla}

    <div class="inscripcion-traza">
      <div><strong>Link principal:</strong> ${state.group?.inscripcionHabilitada ? "Habilitado" : "No habilitado"}</div>
      <div><strong>Estado inscripción:</strong> ${escapeHtml(getInscripcionFaseLabel(estadoInscripcion))}</div>
      <div><strong>Generado por:</strong> ${escapeHtml(linkInfo.actualizadoPor || linkInfo.linkGeneradoPor || state.group?.inscripcionLinkGeneradoPor || "—")}</div>
      <div><strong>Fecha generación:</strong> ${escapeHtml(formatDateTime(linkInfo.actualizadoAt || linkInfo.linkGeneradoAt || state.group?.fechaAperturaInscripcion))}</div>
      <div><strong>Link liberados:</strong> ${state.group?.linkLiberadosActivo ? "Habilitado" : "No habilitado"}</div>
      <div><strong>Liberados generado por:</strong> ${escapeHtml(liberadosInfo.actualizadoPor || liberadosInfo.linkGeneradoPor || "—")}</div>
    </div>
    <div class="nomina-loaded-footer">
      <div class="nomina-carga-text">
        Fuente de carga:
        ${
          state.inscripcionesFuente ===
            "nomina_resumen"
            ? "Resumen liviano"
            : "Documentos completos"
        }
      </div>
      <button
        id="btnVerNominaPasajeros"
        class="btn-pill"
        type="button"
      >
        Ocultar nómina
      </button>
    
      <button
        id="btnRecargarNominaPasajeros"
        class="btn-pill"
        type="button"
      >
        Recargar nómina
      </button>
    </div>
  `;
}

function getInscripcionDocumento(item = {}) {
  return (
    getByPath(item, "identificacion.documento") ||
    getByPath(item, "identificacion.rutCompleto") ||
    getByPath(item, "identificacion.documentoNormalizado") ||
    item.id ||
    "—"
  );
}

function getInscripcionNombres(item = {}) {
  return (
    getByPath(item, "identificacion.nombres") ||
    getByPath(item, "identificacion.nombre") ||
    "—"
  );
}

function getInscripcionApellidos(item = {}) {
  const p1 = getByPath(item, "identificacion.primerApellido") || "";
  const p2 = getByPath(item, "identificacion.segundoApellido") || "";
  const unidos = [p1, p2].filter(Boolean).join(" ");
  return unidos || "—";
}

function getInscripcionNacionalidad(item = {}) {
  const base =
    getByPath(item, "identificacion.nacionalidadBase") ||
    getByPath(item, "identificacion.nacionalidad") ||
    "";

  const detalle =
    getByPath(item, "identificacion.nacionalidadDetalle") ||
    getByPath(item, "identificacion.nacionalidadOtra") ||
    getByPath(item, "identificacion.otraNacionalidad") ||
    "";

  const baseKey = normalizeSearchLocal(base);

  if ((baseKey === "doble" || baseKey === "extranjera" || baseKey === "otra") && detalle) {
    return detalle;
  }

  return base || detalle || "—";
}

function getInscripcionGenero(item = {}) {
  const genero = getByPath(item, "identificacion.genero") || "";
  const generoOtro = getByPath(item, "identificacion.generoOtro") || "";
  const sexoDocumento = getByPath(item, "documentoIdentidad.sexoDocumento") || "";

  if (sexoDocumento) return formatInscripcionValue(sexoDocumento);
  if (normalizeSearchLocal(genero) === "otro" && generoOtro) return generoOtro;

  return genero ? formatInscripcionValue(genero) : "—";
}

function getCarnetIdentidadResumen(
  item = {}
) {
  const carnetFrente =
    getByPath(
      item,
      "archivosEspeciales.carnetFrente"
    ) ||
    getByPath(
      item,
      "archivos.carnetFrente"
    ) ||
    null;

  const carnetReverso =
    getByPath(
      item,
      "archivosEspeciales.carnetReverso"
    ) ||
    getByPath(
      item,
      "archivos.carnetReverso"
    ) ||
    null;

  const tieneFrente =
    item.tieneCarnetFrente === true ||
    item?.carnet?.tieneCarnetFrente === true ||
    !!carnetFrente;

  const tieneReverso =
    item.tieneCarnetReverso === true ||
    item?.carnet?.tieneCarnetReverso === true ||
    !!carnetReverso;

  const informadoSistemaPagos =
    item?.sistemaPagos?.tieneCarnetIdentidad === true ||
    item?.sistemaPagos?.tieneCredencial === true ||
    item?.sistemaPagos?.tiene_credencial === true ||
    item?.sistemaPagos?.tiene_credencial === 1 ||
    item?.tieneCredencial === true;

  const tiene =
    item.tieneCarnetIdentidad === true ||
    item?.carnet?.tieneCarnetIdentidad === true ||
    informadoSistemaPagos ||
    (tieneFrente && tieneReverso);

  let origen =
    cleanText(
      item.origenCarnetIdentidad ||
      item?.carnet?.origenCarnetIdentidad ||
      ""
    );

  if (!origen) {
    if (
      informadoSistemaPagos &&
      (tieneFrente || tieneReverso)
    ) {
      origen =
        "sistema_pagos_y_formulario";
    } else if (informadoSistemaPagos) {
      origen =
        "sistema_pagos";
    } else if (
      tieneFrente ||
      tieneReverso
    ) {
      origen =
        "formulario";
    }
  }

  return {
    tiene,
    origen,
    tieneFrente,
    tieneReverso
  };
}

function getCarnetIdentidadHtml(
  item = {}
) {
  const carnet =
    getCarnetIdentidadResumen(
      item
    );

  if (carnet.tiene) {
    let detalle =
      "Carnet disponible";

    if (
      carnet.origen ===
      "sistema_pagos"
    ) {
      detalle =
        "Informado por Sistema de Pagos";
    }

    if (
      carnet.origen ===
      "formulario"
    ) {
      detalle =
        "Cargado mediante formulario";
    }

    if (
      carnet.origen ===
      "sistema_pagos_y_formulario"
    ) {
      detalle =
        "Disponible en Sistema de Pagos y formulario";
    }

    return `
      <span
        class="status-chip status-ok"
        title="${escapeHtml(detalle)}"
      >
        Con carnet
      </span>
    `;
  }

  if (
    carnet.tieneFrente ||
    carnet.tieneReverso
  ) {
    return `
      <span
        class="status-chip status-warning"
        title="Solo existe una cara del carnet"
      >
        Incompleto
      </span>
    `;
  }

  return `
    <span
      class="status-chip status-pending"
    >
      Sin carnet
    </span>
  `;
}

function getResponsablePrincipalNombre(item = {}) {
  const nombreDirecto =
    getByPath(item, "contactoPrincipal.nombre") ||
    getByPath(item, "Contacto principal.nombre") ||
    getByPath(item, "contactoPrincipal.nombreCompleto");

  if (nombreDirecto) return nombreDirecto;

  const nombres = getByPath(item, "contactoPrincipal.nombres") || "";
  const p1 = getByPath(item, "contactoPrincipal.primerApellido") || "";
  const p2 = getByPath(item, "contactoPrincipal.segundoApellido") || "";

  return [nombres, p1, p2].filter(Boolean).join(" ") || "—";
}

function formatDateOnlyForTable(value) {
  if (!value) return "—";

  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [yyyy, mm, dd] = value.split("-");
    return `${dd}-${mm}-${yyyy}`;
  }

  const d = toDate(value);
  if (!d) return String(value);

  return d.toLocaleDateString("es-CL");
}

function formatInscripcionValue(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "—";

  const map = {
    estudiante: "Estudiante",
    profesor: "Profesor(a)",
    profesora: "Profesor(a)",
    adulto_acompanante: "Adulto(a) acompañante",
    adulto: "Adulto(a) acompañante",
    normal: "Normal",
    nuevos: "Nuevos inscritos",
    nuevo_inscrito: "Nuevo inscrito",
    lista_espera: "Lista de espera",
    cerrada: "Cerrada",
    masculino: "Masculino",
    femenino: "Femenino"
  };

  const key = normalizeSearchLocal(raw).replace(/\s+/g, "_");
  return map[key] || raw.replaceAll("_", " ");
}

function getNombreGrupoPdf() {
  return (
    cleanText(state.group?.aliasGrupo) ||
    cleanText(state.group?.nombreGrupo) ||
    cleanText(state.group?.colegio) ||
    String(state.groupId || "")
  );
}

function getTituloGrupoPdf() {
  const colegio = normalizeTextUpper(state.group?.colegio || "");
  const cursoViaje =
    normalizeCursoInput(state.group?.cursoViaje || "") ||
    normalizeCursoInput(state.group?.curso || "");

  const anoViaje = cleanText(state.group?.anoViaje || "");

  return [
    cursoViaje,
    colegio
  ].filter(Boolean).join(" ") + (anoViaje ? ` - AÑO ${anoViaje}` : "");
}

function getEncargadosGrupoPdf() {
  const contactos = [];

  const nombre1 = cleanText(state.group?.nombreCliente || "");
  const correo1 = normalizeEmail(state.group?.correoCliente || "");
  const celular1 = cleanText(state.group?.celularCliente || "");
  const rol1 = cleanText(state.group?.rolCliente || "");

  if (nombre1 || correo1 || celular1) {
    contactos.push({
      label: "Encargado/a grupo 1",
      nombre: nombre1 || "—",
      rol: rol1 || "—",
      correo: correo1 || "—",
      celular: celular1 || "—"
    });
  }

  const nombre2 = cleanText(state.group?.nombreCliente2 || "");
  const correo2 = normalizeEmail(state.group?.correoCliente2 || "");
  const celular2 = cleanText(state.group?.celularCliente2 || "");
  const rol2 = cleanText(state.group?.rolCliente2 || "");

  if (nombre2 || correo2 || celular2) {
    contactos.push({
      label: "Encargado/a grupo 2",
      nombre: nombre2 || "—",
      rol: rol2 || "—",
      correo: correo2 || "—",
      celular: celular2 || "—"
    });
  }

  return contactos;
}

function getArchivoEspecialInscripcion(item = {}, clave = "") {
  return (
    getByPath(item, `archivosEspeciales.${clave}`) ||
    getByPath(item, `archivos.${clave}`) ||
    getByPath(item, `documentos.${clave}`) ||
    null
  );
}

function getRutaArchivoEspecialInscripcion(item = {}, clave = "") {
  const archivo = getArchivoEspecialInscripcion(item, clave);

  if (!archivo) return "";

  return cleanText(
    archivo.url ||
    archivo.downloadURL ||
    archivo.publicUrl ||
    archivo.ruta ||
    archivo.path ||
    ""
  );
}

async function resolveArchivoEspecialUrl(item = {}, clave = "") {
  const ruta = getRutaArchivoEspecialInscripcion(item, clave);

  if (!ruta) return "";

  if (/^https?:\/\//i.test(ruta)) {
    return ruta;
  }

  try {
    const storage = getStorage();
    return await getDownloadURL(storageRef(storage, ruta));
  } catch (error) {
    console.warn(`[grupo] No se pudo obtener URL Storage para ${clave}:`, error);
    return "";
  }
}

function renderPdfRows(filas = []) {
  return filas.map(([label, value]) => `
    <div class="row">
      <div class="label">${escapeHtml(label)}</div>
      <div class="value">${escapeHtml(value || "—")}</div>
    </div>
  `).join("");
}

function renderPdfDocumentoImagen(label = "", url = "") {
  if (!url) return "";

  return `
    <div class="doc-card">
      <div class="doc-title">${escapeHtml(label)}</div>
      <img src="${escapeHtml(url)}" alt="${escapeHtml(label)}" />
    </div>
  `;
}

async function descargarFichaInscripcionPdf(
  inscripcionId = ""
) {
  const item =
    await obtenerInscripcionCompleta(
      inscripcionId
    );

  if (!item) {
    alert(
      "No se pudo cargar la ficha completa de la inscripción seleccionada."
    );

    return;
  }

  try {
    const imagenes =
      await prepararImagenesReencuadreInscripcion(
        item
      );

    if (imagenes.length) {
      abrirModalReencuadreFicha(
        inscripcionId,
        imagenes
      );

      return;
    }

    await generarFichaInscripcionPdfFinal(
      inscripcionId,
      {}
    );
  } catch (error) {
    console.error(
      "[grupo] descargarFichaInscripcionPdf",
      error
    );

    alert(
      "No se pudo preparar la ficha PDF: " +
      (
        error?.message ||
        "Error desconocido"
      )
    );
  }
}

function getFechaCambioEstadoInscripcionPdf(item = {}) {
  const tipo = normalizeSearchLocal(getInscripcionTipoReal(item));

  if (tipo === "nuevo_ingreso_confirmado") {
    return item.nuevoIngresoConfirmadoAt || item.confirmadoAt || "";
  }

  if (tipo === "lista_espera_pagada") {
    return item.listaEsperaPagadaAt || "";
  }

  if (tipo === "lista_espera_confirmada") {
    return item.confirmadoCupoAt || item.confirmadoAt || "";
  }

  return "";
}

async function generarFichaInscripcionPdfFinal(inscripcionId = "", recortes = {}) {
  const item =
    await obtenerInscripcionCompleta(
      inscripcionId
    );
  
  if (!item) {
    alert(
      "No se pudo cargar la ficha completa de la inscripción seleccionada."
    );
  
    return;
  }

  const win = window.open("", "_blank");

  if (!win) {
    alert("El navegador bloqueó la ventana emergente. Permite pop-ups para generar el PDF.");
    return;
  }

  win.document.open();
  win.document.write(`
    <!doctype html>
    <html>
      <head><meta charset="UTF-8" /></head>
      <body style="font-family:Arial;padding:30px;">Generando ficha...</body>
    </html>
  `);
  win.document.close();

  const grupo = getNombreGrupoPdf();
  const grupoTitulo = getTituloGrupoPdf() || grupo;
  const encargados = getEncargadosGrupoPdf();

  const tipoInscripcionTitulo = getEstadoOperativoInscripcionLabel(item);
  const fechaCreacionFormulario = formatFechaFormularioTabla(getFechaFormularioInscripcion(item));
  const fechaCambioEstado = getFechaCambioEstadoInscripcionPdf(item);
  const numeroNegocio = cleanText(state.group?.numeroNegocio || state.group?.ficha?.numeroNegocio || "—");

  const carnetFrenteUrl = recortes.carnetFrente || await resolveArchivoEspecialUrl(item, "carnetFrente");
  const carnetReversoUrl = recortes.carnetReverso || await resolveArchivoEspecialUrl(item, "carnetReverso");
  const comprobantePagoUrl = recortes.comprobantePago || await resolveArchivoEspecialUrl(item, "comprobantePago");

  const filasGrupo = [
    ["Grupo", grupoTitulo],
    ["N° negocio", numeroNegocio],
    ["ID grupo", String(state.groupId || "—")],
    ["Nombre Colegio", normalizeTextUpper(state.group?.colegio || "—")],
    ["Curso al momento de inscribirse", normalizeTextUpper(state.group?.curso || "—")],
    ["Año viaje", cleanText(state.group?.anoViaje || "—")],
    ["Vendedor(a)", cleanText(state.group?.vendedora || state.group?.vendedoraCorreo || "—")]
  ];

  const filasPersona = [
    ["Nombres", getInscripcionNombres(item)],
    ["Apellidos", getInscripcionApellidos(item)],
    ["RUT / Documento", getInscripcionDocumento(item)],
    ["Fecha nacimiento", formatDateOnlyForTable(getByPath(item, "identificacion.fechaNacimiento"))],
    ["Tipo pasajero(a)", formatInscripcionValue(item.tipoViajante || item.tipoParticipacion || "")],
    ["Nacionalidad", getInscripcionNacionalidad(item)],
    ["Género", getInscripcionGenero(item)],
    ["Tipo inscripción", tipoInscripcionTitulo],
    ["Fecha creación formulario", fechaCreacionFormulario],
    ...(fechaCambioEstado ? [["Fecha cambio de estado", formatFechaFormularioTabla(fechaCambioEstado)]] : []),
    ["Apoderado(a)", getResponsablePrincipalNombre(item)],
    ["Correo apoderado(a)", getByPath(item, "contactoPrincipal.correo") || "—"],
    [
      "Celular apoderado(a)",
      getByPath(item, "contactoPrincipal.celular") ||
      getByPath(item, "contactoPrincipal.telefono") ||
      getByPath(item, "contactoPrincipal.whatsapp") ||
      "—"
    ]
  ];

  const filasEncargados = encargados.flatMap((c, index) => {
    const suffix = index === 0 ? "" : " 2°";
  
    return [
      [`Nombre${suffix}`, c.nombre],
      [`Correo${suffix}`, c.correo],
      [`Teléfono${suffix}`, c.celular]
    ];
  });

  const nombreArchivo = `ficha_${normalizarRutExport(getInscripcionDocumento(item)) || inscripcionId}.pdf`;

  const documentosHtml = `
    ${renderPdfDocumentoImagen("Carnet de identidad · Frente", carnetFrenteUrl)}
    ${renderPdfDocumentoImagen("Carnet de identidad · Reverso", carnetReversoUrl)}
    ${renderPdfDocumentoImagen("Comprobante de pago", comprobantePagoUrl)}
  `.trim();

  const html = `
    <!doctype html>
    <html>
      <head>
        <meta charset="UTF-8" />
        <title>${escapeHtml(nombreArchivo)}</title>
        <style>
          @page { size: A4; margin: 14mm; }

          body {
            font-family: Arial, sans-serif;
            color: #241238;
            margin: 0;
            font-size: 11px;
          }

          .top {
            border-bottom: 3px solid #4b1979;
            padding-bottom: 10px;
            margin-bottom: 12px;
          }

          .brand {
            font-size: 11px;
            font-weight: 900;
            color: #4b1979;
            letter-spacing: .08em;
            text-transform: uppercase;
            margin-bottom: 5px;
          }

          .doc-title {
            font-size: 18px;
            font-weight: 900;
            margin: 0 0 10px;
            text-transform: uppercase;
          }

          .group-name-box {
            background: #f4eff9;
            border: 1px solid #ddd6e8;
            border-radius: 12px;
            padding: 12px;
            margin-top: 8px;
          }

          .group-label {
            font-size: 9px;
            font-weight: 900;
            color: #6b5a78;
            text-transform: uppercase;
            letter-spacing: .06em;
            margin-bottom: 4px;
          }

          .group-name {
            font-size: 20px;
            line-height: 1.15;
            font-weight: 900;
            color: #241238;
          }

          .section-title {
            font-size: 12px;
            font-weight: 900;
            margin: 14px 0 7px;
            color: #4b1979;
            text-transform: uppercase;
          }

          .form-grid {
            border: 1px solid #ddd6e8;
            border-radius: 10px;
            overflow: hidden;
            margin-bottom: 8px;
          }

          .row {
            display: grid;
            grid-template-columns: 170px 1fr;
            border-bottom: 1px solid #eee8f5;
          }

          .row:last-child { border-bottom: 0; }

          .label {
            background: #f4eff9;
            padding: 7px 9px;
            font-weight: 900;
            text-transform: uppercase;
            font-size: 8.5px;
            letter-spacing: .04em;
            color: #6b5a78;
          }

          .value {
            padding: 7px 9px;
            font-weight: 700;
          }

          .docs-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 10px;
            margin-top: 8px;
          }

          .doc-card {
            border: 1px solid #ddd6e8;
            border-radius: 10px;
            padding: 8px;
            break-inside: avoid;
          }

          .doc-card .doc-title {
            font-size: 10px;
            margin: 0 0 6px;
            color: #4b1979;
          }

          .doc-card img {
            width: 100%;
            max-height: 230px;
            object-fit: contain;
            display: block;
            border-radius: 6px;
            background: #f7f3fb;
          }

          .docs-page {
            page-break-before: always;
            break-before: page;
          }

          .footer {
            margin-top: 12px;
            font-size: 9px;
            color: #786883;
          }
        </style>
      </head>

      <body>
        <div class="top">
          <div class="brand">Formulario de inscripción</div>
          <h1 class="doc-title">${escapeHtml(tipoInscripcionTitulo)}</h1>

          <div class="group-name-box">
            <div class="group-label">Grupo</div>
            <div class="group-name">${escapeHtml(grupoTitulo)}</div>
          </div>
        </div>

        <div class="section-title">Datos de la persona inscrita</div>
        <div class="form-grid">${renderPdfRows(filasPersona)}</div>
        
        <div class="section-title">Datos del grupo</div>
        <div class="form-grid">${renderPdfRows(filasGrupo)}</div>
        
        ${
          filasEncargados.length
            ? `
              <div class="section-title">Encargado(s) del grupo</div>
              <div class="form-grid">${renderPdfRows(filasEncargados)}</div>
            `
            : ""
        }

        ${
          documentosHtml
            ? `
              <div class="docs-page">
                <div class="section-title">Documentos adjuntos</div>
                <div class="docs-grid">${documentosHtml}</div>
              </div>
            `
            : ""
        }

        <div class="footer">
          Documento generado desde el portafolio del grupo el ${escapeHtml(new Date().toLocaleString("es-CL"))}.
        </div>

        <script>
          window.onload = function () {
            document.title = ${JSON.stringify(nombreArchivo)};
            setTimeout(function () {
              window.print();
            }, 600);
          };
        </script>
      </body>
    </html>
  `;

  win.document.open();
  win.document.write(html);
  win.document.close();
}

async function prepararImagenesReencuadreInscripcion(item = {}) {
  const defs = [
    { key: "carnetFrente", label: "Carnet frente" },
    { key: "carnetReverso", label: "Carnet reverso" },
    { key: "comprobantePago", label: "Comprobante pago" }
  ];

  const out = [];

  for (const def of defs) {
    const url = await resolveArchivoEspecialUrl(item, def.key);
    if (!url) continue;

    const img = await cargarImagenParaCanvas(url);

    out.push({
      ...def,
      url,
      img,
      scale: 1,
      offsetX: 0,
      offsetY: 0,
      rotation: 0,
      recorteDataUrl: ""
    });
  }

  return out;
}

function cargarImagenParaCanvas(url = "") {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";

    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("No se pudo cargar imagen para reencuadre."));

    img.src = url;
  });
}

function abrirModalReencuadreFicha(inscripcionId = "", imagenes = []) {
  state.reencuadrePdf = {
    inscripcionId,
    imagenes,
    activaKey: imagenes[0]?.key || "",
    dragging: false,
    dragStartX: 0,
    dragStartY: 0
  };

  renderListaReencuadre();
  centrarReencuadreActivo();
  openModal("modalReencuadreFicha");
}

function getImagenReencuadreActiva() {
  return state.reencuadrePdf.imagenes.find((x) => x.key === state.reencuadrePdf.activaKey) || null;
}

function renderListaReencuadre() {
  const box = $("reencuadreListaImagenes");
  if (!box) return;

  box.innerHTML = state.reencuadrePdf.imagenes.map((img) => `
    <button
      class="reencuadre-item ${img.key === state.reencuadrePdf.activaKey ? "active" : ""}"
      type="button"
      data-reencuadre-key="${escapeHtml(img.key)}"
    >
      ${escapeHtml(img.label)}
    </button>
  `).join("");

  box.querySelectorAll("[data-reencuadre-key]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.reencuadrePdf.activaKey = btn.dataset.reencuadreKey || "";
      renderListaReencuadre();
      dibujarReencuadreActivo();
    });
  });
}

function centrarReencuadreActivo() {
  const item = getImagenReencuadreActiva();
  const canvas = $("reencuadreCanvas");
  if (!item || !canvas) return;

  const baseScale = Math.max(
    canvas.width / item.img.width,
    canvas.height / item.img.height
  );

  item.scale = baseScale;
  item.offsetX = 0;
  item.offsetY = 0;
  item.rotation = item.rotation || 0;

  dibujarReencuadreActivo();
}

function dibujarReencuadreActivo() {
  const canvas = $("reencuadreCanvas");
  const ctx = canvas?.getContext("2d");
  const item = getImagenReencuadreActiva();

  if (!canvas || !ctx || !item) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#251b32";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();

  ctx.translate(canvas.width / 2 + item.offsetX, canvas.height / 2 + item.offsetY);
  ctx.rotate((item.rotation || 0) * Math.PI / 180);
  ctx.scale(item.scale, item.scale);

  ctx.drawImage(
    item.img,
    -item.img.width / 2,
    -item.img.height / 2
  );

  ctx.restore();

  ctx.strokeStyle = "rgba(255,255,255,.95)";
  ctx.lineWidth = 4;
  ctx.strokeRect(10, 10, canvas.width - 20, canvas.height - 20);

  setText(
    "reencuadreEstado",
    `${item.label} · Zoom ${Math.round(item.scale * 100)}% · Rotación ${item.rotation || 0}°`
  );
}

function ajustarReencuadreZoom(delta = 0) {
  const item = getImagenReencuadreActiva();
  if (!item) return;

  item.scale = Math.max(0.05, item.scale + delta);
  dibujarReencuadreActivo();
}

function rotarReencuadre(grados = 0) {
  const item = getImagenReencuadreActiva();
  if (!item) return;

  item.rotation = ((item.rotation || 0) + grados) % 360;
  dibujarReencuadreActivo();
}

function iniciarDragReencuadre(event) {
  const item = getImagenReencuadreActiva();
  if (!item) return;

  state.reencuadrePdf.dragging = true;
  state.reencuadrePdf.dragStartX = event.clientX;
  state.reencuadrePdf.dragStartY = event.clientY;
}

function moverDragReencuadre(event) {
  if (!state.reencuadrePdf.dragging) return;

  const item = getImagenReencuadreActiva();
  if (!item) return;

  const dx = event.clientX - state.reencuadrePdf.dragStartX;
  const dy = event.clientY - state.reencuadrePdf.dragStartY;

  item.offsetX += dx;
  item.offsetY += dy;

  state.reencuadrePdf.dragStartX = event.clientX;
  state.reencuadrePdf.dragStartY = event.clientY;

  dibujarReencuadreActivo();
}

function terminarDragReencuadre() {
  state.reencuadrePdf.dragging = false;
}

function capturarReencuadreDataUrl(item = {}) {
  const canvas = document.createElement("canvas");
  canvas.width = 900;
  canvas.height = 540;

  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();

  ctx.translate(canvas.width / 2 + item.offsetX, canvas.height / 2 + item.offsetY);
  ctx.rotate((item.rotation || 0) * Math.PI / 180);
  ctx.scale(item.scale, item.scale);

  ctx.drawImage(
    item.img,
    -item.img.width / 2,
    -item.img.height / 2
  );

  ctx.restore();

  return canvas.toDataURL("image/jpeg", 0.92);
}

async function generarPdfDesdeModalReencuadre() {
  const recortes = {};

  state.reencuadrePdf.imagenes.forEach((img) => {
    recortes[img.key] = capturarReencuadreDataUrl(img);
  });

  closeModal("modalReencuadreFicha");

  await generarFichaInscripcionPdfFinal(
    state.reencuadrePdf.inscripcionId,
    recortes
  );
}

function renderFichaPanel() {
  const box = $("panelFichaViajeBody");
  if (!box) return;

  const ficha = getFichaSummary();
  const isGanada = canCreateFichaFromEstado();
  const vendorLocked = isVendorLockedByFlow(state.group);

  if (!isGanada && !ficha.exists) {
    box.innerHTML = `
      <div class="empty-box">
        La ficha de viaje se habilita cuando el grupo está en estado GANADA.
      </div>
    `;
    return;
  }

  let regla = "La ficha solo puede crearse cuando el grupo está Ganada.";

  if (isGanada) {
    regla = ficha.exists
      ? "Este grupo ya tiene ficha y puedes entrar a revisarla."
      : "Este grupo ya puede crear su ficha.";
  }

  if (vendorLocked) {
    regla = "La ficha ya fue firmada por vendedor(a). Desde este portafolio solo se puede ver.";
  }

  box.innerHTML = `
    <div class="grupo-kpi-list">
      <div class="grupo-kpi">
        <div class="info-label">Estado ficha</div>
        <div class="info-value">${escapeHtml(ficha.estadoLabel)}</div>
      </div>

      <div class="grupo-kpi">
        <div class="info-label">Versión ficha</div>
        <div class="info-value">${escapeHtml(ficha.version)}</div>
      </div>

      <div class="grupo-kpi">
        <div class="info-label">Número negocio</div>
        <div class="info-value">${escapeHtml(ficha.numeroNegocio)}</div>
      </div>

      <div class="grupo-kpi">
        <div class="info-label">Fecha actualización ficha</div>
        <div class="info-value">${escapeHtml(ficha.fechaActualizacion)}</div>
      </div>
    </div>

    <div class="grupo-ficha-focus">
      <div class="grupo-ficha-focus-head"><Importante:</div>

      <div class="grupo-ficha-focus-grid">
        <div class="grupo-ficha-focus-item is-highlight">
          <div class="grupo-ficha-focus-label">Programa</div>
          <div class="grupo-ficha-focus-value">${escapeHtml(ficha.programa || "—")}</div>
        </div>

        <div class="grupo-ficha-focus-item">
          <div class="grupo-ficha-focus-label">Tramo</div>
          <div class="grupo-ficha-focus-value">${escapeHtml(ficha.tramo || "—")}</div>
        </div>

        <div class="grupo-ficha-focus-item">
          <div class="grupo-ficha-focus-label">Hotel</div>
          <div class="grupo-ficha-focus-value">${escapeHtml(ficha.hotel || "—")}</div>
        </div>

        <div class="grupo-ficha-focus-item is-highlight">
          <div class="grupo-ficha-focus-label">Fecha tentativa</div>
          <div class="grupo-ficha-focus-value">${escapeHtml(ficha.fechaTentativa || "—")}</div>
        </div>
      </div>
    </div>

    <div class="info-stack" style="margin-top:16px;">
      <div class="info-item">
        <div class="info-label">PDF ficha</div>
        <div class="info-value">
          ${escapeHtml(ficha.pdfUrl ? ficha.pdfNombre : "Sin PDF generado")}
        </div>
      </div>

      <div class="info-item">
        <div class="info-label">Regla de habilitación</div>
        <div class="info-value">${escapeHtml(regla)}</div>
      </div>

      <div class="info-item">
        <div class="info-label">Inscripción pasajeros</div>
        <div class="info-value">
          ${state.group?.inscripcionHabilitada ? "Habilitada" : "No habilitada"}
        </div>
      </div>
    </div>

    <div class="grupo-ficha-note">
      <strong>Tip visual:</strong> aquí quedan arriba los datos que más necesitas para ubicarte rápido, sin tener que leer toda la ficha ni todo el grupo.
    </div>
  `;
}

function getCurrentYear() {
  return new Date().getFullYear();
}

function normalizeCursoInput(value = "") {
  return cleanText(value)
    .toUpperCase()
    .replace(/\s+/g, "");
}

function hasValidCursoFormat(value = "") {
  const curso = normalizeCursoInput(value);

  if (curso === "0") return true;

  return /^(?:11|10|[1-9])[A-Z]*$/.test(curso);
}

function extractCursoNumber(value = "") {
  const curso = normalizeCursoInput(value);

  if (curso === "0") return 0;

  const match = curso.match(/^(11|10|[1-9])/);
  return match ? Number(match[1]) : null;
}

function extractCursoSuffix(value = "") {
  const curso = normalizeCursoInput(value);

  if (curso === "0") return "";

  const match = curso.match(/^(?:11|10|[1-9])(.*)$/);
  return match ? match[1] : "";
}

function getNextCursoNumber(currentNumber) {
  if (currentNumber >= 1 && currentNumber <= 7) return currentNumber + 1;
  if (currentNumber === 8) return 1;
  if (currentNumber === 9) return 10;
  if (currentNumber === 10) return 11;
  if (currentNumber === 11) return 11;
  return null;
}

function projectCursoToYear(
  cursoBase = "",
  anoBase = getCurrentYear(),
  anoViaje = getCurrentYear()
) {
  const baseCurso = normalizeCursoInput(cursoBase);

  // 0 significa curso desconocido.
  // No intentamos proyectarlo.
  if (baseCurso === "0") {
    return "0";
  }

  const baseNumber = extractCursoNumber(baseCurso);
  const suffix = extractCursoSuffix(baseCurso);
  const fromYear = Number(anoBase);
  const toYear = Number(anoViaje);

  if (!baseCurso || baseNumber === null) {
    return "";
  }

  if (
    !Number.isFinite(fromYear) ||
    !Number.isFinite(toYear) ||
    toYear < fromYear
  ) {
    return "";
  }

  let projectedNumber = baseNumber;
  const diff = toYear - fromYear;

  for (let i = 0; i < diff; i += 1) {
    const nextNumber = getNextCursoNumber(projectedNumber);

    if (nextNumber === null) {
      return "";
    }

    projectedNumber = nextNumber;
  }

  return `${projectedNumber}${suffix}`;
}

function buildAliasGrupo({ cursoBase = "", anoBase = "", cursoViaje = "", anoViaje = "", colegio = "" }) {
  const base = normalizeCursoInput(cursoBase);
  const trip = normalizeCursoInput(cursoViaje);
  const school = normalizeTextUpper(colegio);

  if (!base || !trip || !anoBase || !anoViaje || !school) return "";

  const baseYear = String(anoBase).trim();
  const tripYear = String(anoViaje).trim();

  if (baseYear === tripYear) {
    return `${base} (${baseYear}) ${school}`.trim();
  }

  return `${base} (${baseYear}) ${trip} (${tripYear}) ${school}`.trim();
}

function buildAliasTripKey({ colegio = "", cursoViaje = "", anoViaje = "" }) {
  return normalizeSearchLocal(
    `${normalizeTextUpper(colegio)}__${normalizeCursoInput(cursoViaje)}__${cleanText(anoViaje)}`
  );
}

function getDocBaseYear(data = {}) {
  const explicit = Number(data.anoBaseCurso || "");
  if (Number.isFinite(explicit) && explicit > 0) return explicit;

  const createdAt = toDate(data.fechaCreacion);
  if (createdAt) return createdAt.getFullYear();

  return getCurrentYear();
}

function normalizeTextUpper(value = "") {
  return String(value || "").trim().toLocaleUpperCase("es-CL");
}

function normalizeTextUpperLive(value = "") {
  return String(value || "").toLocaleUpperCase("es-CL");
}

function normalizeChileMobile(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";

  let digits = raw.replace(/\D/g, "");

  if (digits.startsWith("56")) digits = digits.slice(2);
  if (digits.startsWith("9")) digits = digits.slice(1);

  digits = digits.slice(0, 8);

  return digits ? `+569${digits}` : "+569";
}

function sanitizeChileMobileForSave(value = "") {
  const normalized = normalizeChileMobile(value);
  return normalized === "+569" ? "" : normalized;
}

function formatChileMobileForInput(value = "") {
  return value ? normalizeChileMobile(value) : "+569";
}

function getChileMobileDigits(value = "") {
  const normalized = normalizeChileMobile(value);
  return String(normalized || "").replace(/\D/g, "");
}

function formatChileMobileDisplay(value = "") {
  const digits = getChileMobileDigits(value);

  // Esperado: 569 + 8 dígitos
  if (digits.length >= 11) {
    const countryAndPrefix = digits.slice(0, 3); // 569
    const part1 = digits.slice(3, 7);            // 4 dígitos
    const part2 = digits.slice(7, 11);           // 4 dígitos
    return `(+${countryAndPrefix}) ${part1} ${part2}`;
  }

  // Fallback por si viene incompleto
  const normalized = normalizeChileMobile(value);
  return normalized || "—";
}

function buildPhoneValueHtml(value = "") {
  const digits = getChileMobileDigits(value);
  if (!digits || digits.length < 11) return "—";

  const display = formatChileMobileDisplay(value);
  const telHref = `tel:+${digits}`;
  const waHref = `https://wa.me/${digits}`;

  return `
    <div class="contact-value-stack">
      <div class="contact-main-value">${escapeHtml(display)}</div>
      <div class="contact-actions">
        <a class="contact-action-link" href="${escapeHtml(telHref)}">Llamar</a>
        <a class="contact-action-link" href="${escapeHtml(waHref)}" target="_blank" rel="noopener">WhatsApp</a>
      </div>
    </div>
  `;
}

function buildEmailValueHtml(value = "", contactLabel = "") {
  const email = normalizeEmail(value || "");
  if (!email) return "—";

  return `
    <div class="contact-value-stack">
      <div class="contact-main-value">${escapeHtml(email)}</div>
      <div class="contact-actions">
        <button
          class="contact-action-link"
          type="button"
          data-action="open-email-modal"
          data-email="${escapeHtml(email)}"
          data-contact-label="${escapeHtml(contactLabel || "")}"
        >
          Enviar correo
        </button>
      </div>
    </div>
  `;
}



function buildSemanaViajeLabel(start = "", end = "") {
  const startTxt = formatInputDate(start);
  const endTxt = formatInputDate(end);

  if (startTxt && endTxt) return `${startTxt} al ${endTxt}`;
  return startTxt || endTxt || "";
}

function getSemanaViajeDisplay(groupData = {}) {
  return cleanText(
    groupData.semanaViaje ||
    buildSemanaViajeLabel(groupData.fechaInicioViaje, groupData.fechaFinViaje)
  );
}

function fillSelectWithOptions(selectId, options = [], placeholder = "SELECCIONAR") {
  const select = $(selectId);
  if (!select) return;

  select.innerHTML = "";

  const first = document.createElement("option");
  first.value = "";
  first.textContent = placeholder;
  select.appendChild(first);

  options.forEach((value) => {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = value;
    select.appendChild(opt);
  });
}

function ensureSelectHasValue(selectId, value = "") {
  const select = $(selectId);
  const finalValue = cleanText(value);
  if (!select || !finalValue) return;

  const exists = [...select.options].some(
    (opt) => normalizeOptionKey(opt.value) === normalizeOptionKey(finalValue)
  );

  if (exists) return;

  const opt = document.createElement("option");
  opt.value = finalValue;
  opt.textContent = finalValue;
  select.appendChild(opt);
}

function normalizeOptionKey(value = "") {
  return normalizeSearchLocal(value).replace(/[^a-z0-9]/g, "");
}

function findCanonicalOption(options = [], value = "") {
  const target = normalizeOptionKey(value);
  if (!target) return "";

  return options.find((opt) => normalizeOptionKey(opt) === target) || "";
}

function normalizeDestinoCanonical(value = "") {
  const raw = cleanText(value);
  const direct = findCanonicalOption(DESTINO_PRINCIPAL_OPTIONS, raw);
  if (direct) return direct;

  const key = normalizeOptionKey(raw);
  if (key === normalizeOptionKey("BARILOCHE Y SUR DE CHILE")) {
    return "SUR DE CHILE Y BARILOCHE";
  }

  return "";
}

function getProgramOptionsByDestino(destinoRaw = "") {
  const key = normalizeOptionKey(destinoRaw);
  return PROGRAM_OPTIONS_BY_DESTINO[key] ? [...PROGRAM_OPTIONS_BY_DESTINO[key]] : [];
}

function getDestinoPrincipalDisplay(groupData = {}) {
  const principal = cleanText(groupData.destinoPrincipal || "");
  const otro = cleanText(groupData.destinoPrincipalOtro || "");
  const canonical = normalizeDestinoCanonical(principal);

  if (canonical === "OTRO" && otro) {
    return `OTRO · ${otro}`;
  }

  return canonical || principal || otro || "";
}

function getProgramaDisplay(groupData = {}) {
  const programa = cleanText(groupData.programa || "");
  const programaOtro = cleanText(groupData.programaOtro || "");

  if (normalizeOptionKey(programa) === normalizeOptionKey("OTRO") && programaOtro) {
    return `OTRO · ${programaOtro}`;
  }

  if (!programa && programaOtro) {
    return `OTRO · ${programaOtro}`;
  }

  return programa || programaOtro || "";
}

function getTramoDisplay(groupData = {}) {
  const tramo = cleanText(groupData.tramo || "");
  const tramoOtro = cleanText(groupData.tramoOtro || "");

  if (normalizeOptionKey(tramo) === normalizeOptionKey("OTRO") && tramoOtro) {
    return `OTRO · ${tramoOtro}`;
  }

  if (!tramo && tramoOtro) {
    return `OTRO · ${tramoOtro}`;
  }

  return tramo || tramoOtro || "";
}

function getMesViajeDisplay(groupData = {}) {
  const mesViaje = cleanText(groupData.mesViaje || "");
  const mesViajeOtro = cleanText(groupData.mesViajeOtro || "");
  const legacy = cleanText(groupData.semanaViaje || "");

  if (normalizeOptionKey(mesViaje) === normalizeOptionKey("OTRO") && mesViajeOtro) {
    return `OTRO · ${mesViajeOtro}`;
  }

  if (!mesViaje && mesViajeOtro) {
    return `OTRO · ${mesViajeOtro}`;
  }

  return mesViaje || legacy || mesViajeOtro || "";
}

function hydrateDatosSelects(groupData = {}) {
  fillSelectWithOptions("d_tramo", TRAMO_OPTIONS, "SELECCIONAR");
  fillSelectWithOptions("d_mesViaje", MES_VIAJE_OPTIONS, "SELECCIONAR");
  fillSelectWithOptions("d_rolCliente", ROL_CONTACTO_OPTIONS, "SELECCIONAR");
  fillSelectWithOptions("d_rolCliente2", ROL_CONTACTO_OPTIONS, "SELECCIONAR");

  ensureSelectHasValue("d_rolCliente", findCanonicalOption(ROL_CONTACTO_OPTIONS, groupData.rolCliente || ""));
  ensureSelectHasValue("d_rolCliente2", findCanonicalOption(ROL_CONTACTO_OPTIONS, groupData.rolCliente2 || ""));
}

function resolveDestinoPrincipalForm(groupData = {}) {
  const principal = cleanText(groupData.destinoPrincipal || "");
  const otro = cleanText(groupData.destinoPrincipalOtro || "");
  const canonical = normalizeDestinoCanonical(principal);

  if (!principal && !otro) {
    return { selectValue: "", otherValue: "" };
  }

  if (canonical && canonical !== "OTRO") {
    return {
      selectValue: canonical,
      otherValue: ""
    };
  }

  if (canonical === "OTRO") {
    return {
      selectValue: "OTRO",
      otherValue: normalizeTextUpper(otro || "")
    };
  }

  return {
    selectValue: "OTRO",
    otherValue: normalizeTextUpper(otro || principal)
  };
}

function resolveProgramaForm(groupData = {}, destinoActual = "") {
  const programa = cleanText(groupData.programa || "");
  const programaOtro = cleanText(groupData.programaOtro || "");
  const options = getProgramOptionsByDestino(destinoActual);
  const canonical = findCanonicalOption(options, programa);

  if (!programa && !programaOtro) {
    return { selectValue: "", otherValue: "" };
  }

  if (canonical && canonical !== "OTRO") {
    return {
      selectValue: canonical,
      otherValue: ""
    };
  }

  if (canonical === "OTRO") {
    return {
      selectValue: "OTRO",
      otherValue: normalizeTextUpper(programaOtro || "")
    };
  }

  return {
    selectValue: "OTRO",
    otherValue: normalizeTextUpper(programaOtro || programa)
  };
}

function resolveTramoForm(groupData = {}) {
  const tramo = cleanText(groupData.tramo || "");
  const tramoOtro = cleanText(groupData.tramoOtro || "");
  const canonical = findCanonicalOption(TRAMO_OPTIONS, tramo);

  if (!tramo && !tramoOtro) {
    return { selectValue: "", otherValue: "" };
  }

  if (canonical && canonical !== "OTRO") {
    return {
      selectValue: canonical,
      otherValue: ""
    };
  }

  if (canonical === "OTRO") {
    return {
      selectValue: "OTRO",
      otherValue: normalizeTextUpper(tramoOtro || "")
    };
  }

  return {
    selectValue: "OTRO",
    otherValue: normalizeTextUpper(tramoOtro || tramo)
  };
}

function resolveMesViajeForm(groupData = {}) {
  const mesViaje = cleanText(groupData.mesViaje || "");
  const mesViajeOtro = cleanText(groupData.mesViajeOtro || "");
  const legacy = cleanText(groupData.semanaViaje || "");
  const canonical = findCanonicalOption(MES_VIAJE_OPTIONS, mesViaje || legacy);

  if (!mesViaje && !mesViajeOtro && !legacy) {
    return { selectValue: "", otherValue: "" };
  }

  if (canonical && canonical !== "OTRO") {
    return {
      selectValue: canonical,
      otherValue: ""
    };
  }

  if (canonical === "OTRO") {
    return {
      selectValue: "OTRO",
      otherValue: normalizeTextUpper(mesViajeOtro || "")
    };
  }

  return {
    selectValue: "OTRO",
    otherValue: normalizeTextUpper(mesViajeOtro || mesViaje || legacy)
  };
}

function syncDatosDestinoOtroVisibility() {
  const selectValue = normalizeDestinoCanonical($("d_destinoPrincipal")?.value || "");
  const isOther = selectValue === "OTRO";

  $("wrapDatosDestinoPrincipalOtro")?.classList.toggle("hidden", !isOther);

  if (!isOther) {
    setFormValue("d_destinoPrincipalOtro", "");
  }
}

function syncDatosProgramaOtroVisibility() {
  const selectValue = findCanonicalOption(
    getProgramOptionsByDestino($("d_destinoPrincipal")?.value || "").length
      ? getProgramOptionsByDestino($("d_destinoPrincipal")?.value || "")
      : ["OTRO"],
    $("d_programa")?.value || ""
  );

  const isOther = selectValue === "OTRO";
  $("wrapDatosProgramaOtro")?.classList.toggle("hidden", !isOther);

  if (!isOther) {
    setFormValue("d_programaOtro", "");
  }
}

function syncDatosProgramaOptions(selectedValue = "", otherValue = "") {
  const destinoActual = $("d_destinoPrincipal")?.value || "";
  const options = getProgramOptionsByDestino(destinoActual);
  const finalOptions = options.length ? options : ["OTRO"];

  fillSelectWithOptions("d_programa", finalOptions, "SELECCIONAR");

  const canonical = findCanonicalOption(finalOptions, selectedValue);

  if (canonical) {
    setFormValue("d_programa", canonical);
    setFormValue("d_programaOtro", canonical === "OTRO" ? normalizeTextUpper(otherValue || "") : "");
  } else if (cleanText(selectedValue) || cleanText(otherValue)) {
    setFormValue("d_programa", "OTRO");
    setFormValue("d_programaOtro", normalizeTextUpper(otherValue || selectedValue));
  } else {
    setFormValue("d_programa", "");
    setFormValue("d_programaOtro", "");
  }

  syncDatosProgramaOtroVisibility();
}

function syncDatosTramoOtroVisibility() {
  const selectValue = findCanonicalOption(TRAMO_OPTIONS, $("d_tramo")?.value || "");
  const isOther = selectValue === "OTRO";

  $("wrapDatosTramoOtro")?.classList.toggle("hidden", !isOther);

  if (!isOther) {
    setFormValue("d_tramoOtro", "");
  }
}

function syncDatosMesViajeOtroVisibility() {
  const selectValue = findCanonicalOption(MES_VIAJE_OPTIONS, $("d_mesViaje")?.value || "");
  const isOther = selectValue === "OTRO";

  $("wrapDatosMesViajeOtro")?.classList.toggle("hidden", !isOther);

  if (!isOther) {
    setFormValue("d_mesViajeOtro", "");
  }
}

async function getNextSequentialIdGrupoTemporal() {
  const snap =
    await getDocs(
      collection(
        db,
        "ventas_cotizaciones"
      )
    );

  let maxId = 10935;

  snap.docs.forEach((row) => {
    const data =
      row.data() || {};

    const candidates = [
      String(row.id || "").trim(),
      String(data.idGrupo || "").trim()
    ];

    candidates.forEach(
      (candidate) => {
        if (
          /^\d+$/.test(candidate)
        ) {
          maxId =
            Math.max(
              maxId,
              Number(candidate)
            );
        }
      }
    );
  });

  return String(
    maxId + 1
  );
}

async function crearGrupoDerivadoDesdeActual({
  cursoNuevo = "",
  numeroNegocioNuevo = "",
  cantidadGrupoNueva = null,
  dryRun = true
} = {}) {
  /*
   * =====================================================
   * VALIDACIONES
   * =====================================================
   */

  if (!state.groupDocId || !state.group) {
    throw new Error(
      "Debes ejecutar esta función estando dentro del grupo origen."
    );
  }

  const curso =
    normalizeCursoInput(
      cursoNuevo
    );

  const numeroNegocio =
    cleanText(
      numeroNegocioNuevo
    );

  if (!curso) {
    throw new Error(
      "Debes indicar cursoNuevo."
    );
  }

  if (!numeroNegocio) {
    throw new Error(
      "Debes indicar numeroNegocioNuevo."
    );
  }

  /*
   * =====================================================
   * GRUPO ORIGEN
   * =====================================================
   */

  const origenRef =
    doc(
      db,
      "ventas_cotizaciones",
      String(state.groupDocId)
    );

  const origenSnap =
    await getDoc(
      origenRef
    );

  if (!origenSnap.exists()) {
    throw new Error(
      "No encontré el grupo origen."
    );
  }

  const origen = {
    ...origenSnap.data()
  };

  /*
   * =====================================================
   * SIGUIENTE ID COMO REGISTRO NORMAL
   * =====================================================
   */

  const nuevoIdGrupo =
    await getNextSequentialIdGrupoTemporal();

  const nuevoRef =
    doc(
      db,
      "ventas_cotizaciones",
      nuevoIdGrupo
    );

  const existeNuevo =
    await getDoc(
      nuevoRef
    );

  if (existeNuevo.exists()) {
    throw new Error(
      `El ID ${nuevoIdGrupo} ya existe. Recarga e intenta nuevamente.`
    );
  }

  /*
   * =====================================================
   * IDENTIDAD DEL NUEVO GRUPO
   * =====================================================
   */

  const colegio =
    normalizeTextUpper(
      origen.colegio ||
      ""
    );

  const anoViaje =
    cleanText(
      origen.anoViaje ||
      ""
    );

  const anoBase =
    getDocBaseYear(
      origen
    );

  const cursoViaje =
    projectCursoToYear(
      curso,
      anoBase,
      anoViaje
    );

  const aliasGrupo =
    buildAliasGrupo({
      cursoBase:
        curso,

      anoBase,

      cursoViaje,

      anoViaje,

      colegio
    });

  const aliasTripKey =
    buildAliasTripKey({
      colegio,

      cursoViaje,

      anoViaje
    });

  /*
   * Código equivalente al usado por registro normal.
   */
  const codigoRegistro =
    `COT-${new Date().getFullYear()}-${String(
      nuevoIdGrupo
    )
      .slice(0, 6)
      .toUpperCase()}`;

  /*
   * =====================================================
   * PAX
   * =====================================================
   *
   * Si todavía no sabemos el PAX real de 4B,
   * dejamos 0.
   *
   * Luego importarNominaPagosPorNumeroNegocio("1582")
   * dejará la nómina correspondiente.
   */

  const cantidadGrupo =
    cantidadGrupoNueva === null ||
    cantidadGrupoNueva === undefined
      ? 0
      : Number(
          cantidadGrupoNueva
        );

  if (
    !Number.isFinite(
      cantidadGrupo
    ) ||
    cantidadGrupo < 0
  ) {
    throw new Error(
      "cantidadGrupoNueva debe ser un número válido."
    );
  }

  /*
   * =====================================================
   * FICHA
   * =====================================================
   */

  const fichaOrigen =
    origen.ficha &&
    typeof origen.ficha ===
      "object"
      ? origen.ficha
      : {};

  const fichaNueva = {
    ...fichaOrigen,

    nombreGrupo:
      aliasGrupo,

    numeroNegocio:
      numeroNegocio,

    numeroPaxTotal:
      cantidadGrupo,

    /*
     * El PDF antiguo corresponde al grupo compuesto,
     * por lo tanto NO puede quedar vigente en 4B.
     */
    pdfUrl:
      "",

    pdfNombre:
      "",

    confirmada:
      false,

    pdfPendienteGeneracion:
      true
  };

  /*
   * =====================================================
   * DOCUMENTOS
   * =====================================================
   */

  const documentosOrigen =
    origen.documentos &&
    typeof origen.documentos ===
      "object"
      ? origen.documentos
      : {};

  const documentosNuevos = {
    ...documentosOrigen,

    fichaGrupo: {
      ...(
        documentosOrigen
          .fichaGrupo ||
        {}
      ),

      estado:
        "pendiente"
    }
  };

  /*
   * =====================================================
   * CREAR COPIA CONTROLADA
   * =====================================================
   */

  const nuevoGrupo = {
    ...origen,

    /*
     * Identidad nueva
     */
    idGrupo:
      nuevoIdGrupo,

    codigoRegistro,

    curso,

    cursoViaje,

    cursoPorConfirmar:
      false,

    aliasGrupo,

    aliasTripKey,

    nombreGrupo:
      aliasGrupo,

    nombreGrupoManual:
      false,

    numeroNegocio,

    cantidadGrupo,

    /*
     * La ficha usa identidad nueva.
     */
    ficha:
      fichaNueva,

    documentos:
      documentosNuevos,

    /*
     * ===================================================
     * PDF RAÍZ
     * ===================================================
     */

    fichaPdfUrl:
      "",

    fichaPdfNombre:
      "",

    fichaPdfPendienteGeneracion:
      true,

    /*
     * ===================================================
     * INSCRIPCIÓN PRINCIPAL
     * ===================================================
     *
     * El nuevo grupo NO puede compartir links o tokens
     * públicos con el 4AB.
     */

    inscripcionHabilitada:
      false,

    tokenInscripcion:
      "",

    inscripcionEstado:
      "cerrada",

    faseInscripcion:
      "cerrada",

    fechaAperturaInscripcion:
      null,

    inscripcion: {
      estado:
        "cerrada",

      faseActual:
        "cerrada",

      claveActual:
        "",

      labelActual:
        "",

      tipoInscripcionActual:
        "",

      estadoCupoActual:
        "",

      tokenActual:
        "",

      linkActual:
        ""
    },

    /*
     * ===================================================
     * NUEVO INGRESO
     * ===================================================
     */

    inscripcionNuevos: {
      activo:
        false,

      tokenActual:
        "",

      linkActual:
        ""
    },

    /*
     * ===================================================
     * LISTA DE ESPERA
     * ===================================================
     */

    inscripcionListaEspera: {
      activo:
        false,

      tokenActual:
        "",

      linkActual:
        ""
    },

    /*
     * ===================================================
     * LIBERADOS
     * ===================================================
     */

    inscripcionLiberados: {
      activo:
        false,

      tokenActual:
        "",

      linkActual:
        ""
    },

    linkLiberadosActivo:
      false,

    tokenInscripcionLiberados:
      "",

    /*
     * ===================================================
     * FECHAS DEL NUEVO REGISTRO
     * ===================================================
     */

    creadoPor:
      getDisplayName(
        state.effectiveUser
      ),

    creadoPorCorreo:
      state.effectiveEmail,

    fechaCreacion:
      serverTimestamp(),

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
   * =====================================================
   * PREVISUALIZACIÓN
   * =====================================================
   */

  const resumen = {
    dryRun,

    grupoOrigen: {
      idGrupo:
        state.groupId,

      documento:
        state.groupDocId,

      aliasGrupo:
        origen.aliasGrupo ||
        origen.nombreGrupo ||
        "",

      numeroNegocio:
        origen.numeroNegocio ||
        "",

      curso:
        origen.curso ||
        ""
    },

    grupoNuevo: {
      idGrupo:
        nuevoIdGrupo,

      codigoRegistro,

      aliasGrupo,

      curso,

      cursoViaje,

      numeroNegocio,

      cantidadGrupo,

      anoViaje,

      colegio
    },

    acciones: {
      modificaGrupoOrigen:
        false,

      copiaInscripciones:
        false,

      copiaNominaResumen:
        false,

      linksPublicosReiniciados:
        true,

      pdfAnteriorCopiado:
        false
    }
  };

  console.log(
    "%c[GRUPO DERIVADO] PREVISUALIZACIÓN",
    "font-weight:bold;color:#7a5cf0;"
  );

  console.table(
    [
      {
        tipo:
          "ORIGEN",

        idGrupo:
          resumen.grupoOrigen
            .idGrupo,

        curso:
          resumen.grupoOrigen
            .curso,

        numeroNegocio:
          resumen.grupoOrigen
            .numeroNegocio,

        alias:
          resumen.grupoOrigen
            .aliasGrupo
      },

      {
        tipo:
          "NUEVO",

        idGrupo:
          resumen.grupoNuevo
            .idGrupo,

        curso:
          resumen.grupoNuevo
            .curso,

        numeroNegocio:
          resumen.grupoNuevo
            .numeroNegocio,

        alias:
          resumen.grupoNuevo
            .aliasGrupo
      }
    ]
  );

  console.log(
    "[GRUPO DERIVADO] Resumen:",
    resumen
  );

  /*
   * =====================================================
   * DRY RUN
   * =====================================================
   */

  if (dryRun) {
    console.warn(
      "[GRUPO DERIVADO] DRY RUN: no se escribió nada en Firebase."
    );

    return {
      ok:
        true,

      creado:
        false,

      ...resumen
    };
  }

  /*
   * =====================================================
   * CONFIRMACIÓN FINAL
   * =====================================================
   */

  const confirmar =
    window.confirm(
      [
        "VAS A CREAR UN NUEVO GRUPO.",
        "",
        `Origen: ${origen.aliasGrupo || origen.nombreGrupo || state.groupId}`,
        `Origen NO será modificado.`,
        "",
        `Nuevo ID Grupo: ${nuevoIdGrupo}`,
        `Nuevo grupo: ${aliasGrupo}`,
        `Curso: ${curso}`,
        `N° negocio: ${numeroNegocio}`,
        "",
        "La nómina NO se copiará.",
        "Los links públicos NO se copiarán.",
        "El PDF anterior NO quedará vigente.",
        "",
        "¿Crear el grupo?"
      ].join("\n")
    );

  if (!confirmar) {
    return {
      ok:
        false,

      cancelado:
        true,

      ...resumen
    };
  }

  /*
   * Volvemos a revisar el ID justo antes de escribir.
   */
  const checkFinal =
    await getDoc(
      nuevoRef
    );

  if (checkFinal.exists()) {
    throw new Error(
      `El ID ${nuevoIdGrupo} fue ocupado antes de guardar. Ejecuta nuevamente la función.`
    );
  }

  /*
   * =====================================================
   * GUARDAR
   * =====================================================
   */

  await setDoc(
    nuevoRef,
    nuevoGrupo
  );

  /*
   * =====================================================
   * VERIFICACIÓN POSTERIOR
   * =====================================================
   */

  const guardado =
    await getDoc(
      nuevoRef
    );

  if (!guardado.exists()) {
    throw new Error(
      "La escritura terminó, pero el nuevo grupo no pudo verificarse."
    );
  }

  const dataGuardada =
    guardado.data() || {};

  const resultado = {
    ok:
      true,

    creado:
      true,

    idGrupoNuevo:
      nuevoIdGrupo,

    codigoRegistro,

    curso:
      dataGuardada.curso ||
      "",

    cursoViaje:
      dataGuardada.cursoViaje ||
      "",

    numeroNegocio:
      dataGuardada.numeroNegocio ||
      "",

    aliasGrupo:
      dataGuardada.aliasGrupo ||
      "",

    cantidadGrupo:
      dataGuardada.cantidadGrupo ??
      0,

    url:
      `grupo.html?id=${encodeURIComponent(
        nuevoIdGrupo
      )}`
  };

  console.log(
    "%c[GRUPO DERIVADO] GRUPO CREADO CORRECTAMENTE",
    "font-weight:bold;color:#09832e;"
  );

  console.log(
    resultado
  );

  return resultado;
}

window.crearGrupoDerivadoDesdeActual =
  crearGrupoDerivadoDesdeActual;

function buildDatosAliasPayload() {
  const colegio = normalizeTextUpper($("d_colegio")?.value || state.group?.colegio || "");
  const cursoBase = normalizeCursoInput($("d_curso")?.value || "");
  const anoViaje = cleanText($("d_anoViaje")?.value || "");
  const anoBase = getDocBaseYear(state.group || {});

  const cursoViaje = projectCursoToYear(cursoBase, anoBase, anoViaje);
  const aliasGrupo = buildAliasGrupo({
    cursoBase,
    anoBase,
    cursoViaje,
    anoViaje,
    colegio
  });

  const aliasTripKey = buildAliasTripKey({
    colegio,
    cursoViaje,
    anoViaje
  });

  return {
    colegio,
    cursoBase,
    anoBase,
    anoViaje,
    cursoViaje,
    aliasGrupo,
    aliasTripKey
  };
}

function syncDatosAliasPreview() {
  const aliasBox = $("d_aliasPreview");
  const aliasHelper = $("d_aliasHelper");

  if (!aliasBox) return;

  const esAliasManual = state.group?.nombreGrupoManual === true;

  if (esAliasManual) {
    const aliasManual = cleanText(
      state.group?.aliasGrupo ||
      state.group?.nombreGrupo ||
      getByPath(state.group, "ficha.nombreGrupo") ||
      ""
    );

    aliasBox.textContent = aliasManual || "—";
    aliasBox.classList.add("alias-manual");

    if (aliasHelper) {
      aliasHelper.textContent =
        "Nombre personalizado desde Ficha editable. El alias automático fue reemplazado manualmente y no se reconstruirá al cambiar curso o año.";
      aliasHelper.classList.add("alias-manual-helper");
    }

    return;
  }

  const { aliasGrupo } = buildDatosAliasPayload();

  aliasBox.textContent = aliasGrupo || "—";
  aliasBox.classList.remove("alias-manual");

  if (aliasHelper) {
    aliasHelper.textContent =
      "Se reconstruye automáticamente si cambias curso o año de viaje.";
    aliasHelper.classList.remove("alias-manual-helper");
  }
}
function bindUppercaseModalInput(id, afterChange = null) {
  const el = $(id);
  if (!el || el.dataset.upperBound === "1") return;

  el.dataset.upperBound = "1";

  el.addEventListener("input", () => {
    const start = el.selectionStart;
    const end = el.selectionEnd;

    el.value = normalizeTextUpperLive(el.value || "");

    try {
      el.setSelectionRange(start, end);
    } catch {}

    if (typeof afterChange === "function") afterChange();
  });

  el.addEventListener("change", () => {
    el.value = normalizeTextUpper(el.value || "");

    if (typeof afterChange === "function") afterChange();
  });
}

function bindPhoneModalInput(id) {
  const el = $(id);
  if (!el || el.dataset.phoneBound === "1") return;

  el.dataset.phoneBound = "1";

  el.addEventListener("focus", () => {
    if (!cleanText(el.value)) {
      el.value = "+569";
    }
  });

  el.addEventListener("input", () => {
    el.value = normalizeChileMobile(el.value || "");
    try {
      el.setSelectionRange(el.value.length, el.value.length);
    } catch {}
  });

  el.addEventListener("blur", () => {
    const safe = sanitizeChileMobileForSave(el.value || "");
    el.value = safe || "";
  });
}

function bindDatosModalControls() {
  bindUppercaseModalInput("d_colegio", syncDatosAliasPreview);
  bindUppercaseModalInput("d_comunaCiudad");
  bindUppercaseModalInput("d_nombreCliente");
  bindUppercaseModalInput("d_nombreCliente2");
  bindUppercaseModalInput("d_destinoPrincipalOtro");
  bindUppercaseModalInput("d_programaOtro");
  bindUppercaseModalInput("d_tramoOtro");
  bindUppercaseModalInput("d_mesViajeOtro");

  const curso = $("d_curso");
  if (curso && curso.dataset.cursoBound !== "1") {
    curso.dataset.cursoBound = "1";

    const handler = () => {
      curso.value = normalizeCursoInput(curso.value || "");
      syncDatosAliasPreview();
    };

    curso.addEventListener("input", handler);
    curso.addEventListener("change", handler);
  }

  const anoViaje = $("d_anoViaje");
  if (anoViaje && anoViaje.dataset.aliasBound !== "1") {
    anoViaje.dataset.aliasBound = "1";
    anoViaje.addEventListener("input", syncDatosAliasPreview);
    anoViaje.addEventListener("change", syncDatosAliasPreview);
  }

  const destino = $("d_destinoPrincipal");
  if (destino && destino.dataset.destinoBound !== "1") {
    destino.dataset.destinoBound = "1";
    destino.addEventListener("change", () => {
      syncDatosDestinoOtroVisibility();
      syncDatosProgramaOptions();
    });
  }

  const programa = $("d_programa");
  if (programa && programa.dataset.programaBound !== "1") {
    programa.dataset.programaBound = "1";
    programa.addEventListener("change", syncDatosProgramaOtroVisibility);
  }

  const tramo = $("d_tramo");
  if (tramo && tramo.dataset.tramoBound !== "1") {
    tramo.dataset.tramoBound = "1";
    tramo.addEventListener("change", syncDatosTramoOtroVisibility);
  }

  const mesViaje = $("d_mesViaje");
  if (mesViaje && mesViaje.dataset.mesBound !== "1") {
    mesViaje.dataset.mesBound = "1";
    mesViaje.addEventListener("change", syncDatosMesViajeOtroVisibility);
  }

  bindPhoneModalInput("d_celularCliente");
  bindPhoneModalInput("d_celularCliente2");
}

function buildFichaMirrorFromGroupValues(values = {}) {
  /*
   * =========================================================
   * ESPEJO OFICIAL GRUPO -> FICHA
   * =========================================================
   *
   * Editar datos trabaja sobre los campos oficiales del grupo.
   *
   * Si ya existe una ficha, mantenemos también sincronizados
   * sus campos equivalentes.
   *
   * Si todavía NO existe ficha, no la creamos artificialmente:
   * cuando se abra fichas.html, hydrateFicha() tomará estos
   * mismos datos directamente desde el grupo.
   */

  const fichaActual =
    state.group?.ficha || {};

  const fichaExiste =
    Object.keys(fichaActual).length > 0;

  if (!fichaExiste) {
    return null;
  }

  const destino =
    cleanText(
      values.destinoPrincipal || ""
    );

  const destinoOtro =
    cleanText(
      values.destinoPrincipalOtro || ""
    );

  const programa =
    cleanText(
      values.programa || ""
    );

  const programaOtro =
    cleanText(
      values.programaOtro || ""
    );

  const tramo =
    cleanText(
      values.tramo || ""
    );

  const tramoOtro =
    cleanText(
      values.tramoOtro || ""
    );

  const mesViaje =
    cleanText(
      values.mesViaje || ""
    );

  const mesViajeOtro =
    cleanText(
      values.mesViajeOtro || ""
    );

  const nombrePrograma =
    programa === "OTRO"
      ? programaOtro
      : programa;

  const tramoVisible =
    tramo === "OTRO"
      ? tramoOtro
      : tramo;

  const fechaViajeTexto =
    mesViaje === "OTRO"
      ? mesViajeOtro
      : (
          values.semanaViaje ||
          mesViaje ||
          ""
        );

  return {
    ...fichaActual,

    /*
     * CONTACTO PRINCIPAL
     */
    apoderadoEncargado:
      values.nombreCliente || "",

    telefono:
      values.celularCliente || "",

    correo:
      values.correoCliente || "",

    /*
     * DESTINO
     */
    destinoPrincipal:
      destino,

    destinoPrincipalOtro:
      destino === "OTRO"
        ? destinoOtro
        : "",

    /*
     * PROGRAMA
     */
    programa,

    programaOtro:
      programa === "OTRO"
        ? programaOtro
        : "",

    nombrePrograma,

    /*
     * PAX
     */
    numeroPaxTotal:
      values.cantidadGrupo ?? "",

    /*
     * TRAMO
     */
    tramoSeleccion:
      tramo,

    tramoOtro:
      tramo === "OTRO"
        ? tramoOtro
        : "",

    tramo:
      tramoVisible,

    /*
     * MES / FECHA TENTATIVA
     */
    mesViaje,

    mesViajeOtro:
      mesViaje === "OTRO"
        ? mesViajeOtro
        : "",

    fechaViajeTexto
  };
}

function groupValueIsEmpty(value) {
  if (value === null || value === undefined) return true;
  return String(value).trim() === "";
}

function getGrupoDatoFinal(campo = "") {
  if (campo === "destinoPrincipal") {
    const base = cleanText(state.group?.destinoPrincipal || "");
    if (normalizeSearchLocal(base) === "otro") {
      return cleanText(state.group?.destinoPrincipalOtro || "");
    }
    return base;
  }

  if (campo === "programa") {
    const base = cleanText(state.group?.programa || "");
    if (normalizeSearchLocal(base) === "otro") {
      return cleanText(state.group?.programaOtro || "");
    }
    return base;
  }

  if (campo === "tramo") {
    const base = cleanText(state.group?.tramo || "");
    if (normalizeSearchLocal(base) === "otro") {
      return cleanText(state.group?.tramoOtro || "");
    }
    return base;
  }

  if (campo === "mesViaje") {
    const base = cleanText(state.group?.mesViaje || "");
    if (normalizeSearchLocal(base) === "otro") {
      return cleanText(state.group?.mesViajeOtro || state.group?.semanaViaje || "");
    }
    return base || cleanText(state.group?.semanaViaje || "");
  }

  return cleanText(state.group?.[campo] || "");
}

function getDatosGrupoFaltantesParaFicha() {
  const campos = [
    { campo: "colegio", label: "Colegio" },
    { campo: "curso", label: "Curso" },
    { campo: "anoViaje", label: "Año de viaje" },
    { campo: "cantidadGrupo", label: "Cantidad grupo" },
    { campo: "destinoPrincipal", label: "Destino principal" },
    { campo: "programa", label: "Programa" },
    { campo: "tramo", label: "Tramo" },
    { campo: "mesViaje", label: "Mes / fecha de viaje" },
    { campo: "nombreCliente", label: "Contacto principal" },
    { campo: "correoCliente", label: "Correo contacto principal" },
    { campo: "celularCliente", label: "Teléfono contacto principal" }
  ];

  return campos
    .filter((item) => groupValueIsEmpty(getGrupoDatoFinal(item.campo)))
    .map((item) => item.label);
}

function openFichaEditor() {
  if (!canCreateFichaFromEstado()) {
    alert("La ficha solo se habilita cuando el grupo está en estado GANADA.");
    return;
  }

  const faltantes = getDatosGrupoFaltantesParaFicha();

  if (faltantes.length) {
    const mensaje =
      "Faltan datos del grupo que deberían completarse antes de editar la ficha.\n\n" +
      faltantes.map((x) => `- ${x}`).join("\n") +
      "\n\nPuedes ir a Editar Grupo o continuar con información incompleta.\n\n" +
      "Aceptar: continuar a ficha.\n" +
      "Cancelar: volver para editar el grupo.";

    const continuar = confirm(mensaje);

    if (!continuar) {
      openDatosModal();
      return;
    }
  }

  location.href = `fichas.html?id=${encodeURIComponent(state.groupId)}`;
}

function openFichaPdf() {
  const ficha = getFichaSummary();

  if (!ficha.pdfUrl) {
    alert("Este grupo todavía no tiene un PDF de ficha generado.");
    return;
  }

  window.open(ficha.pdfUrl, "_blank", "noopener");
}

function generateInscripcionToken(length = 32) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);

  let out = "";
  for (let i = 0; i < array.length; i += 1) {
    out += chars[array[i] % chars.length];
  }
  return out;
}

function getInscripcionBaseUrl() {
  return new URL("inscripcion.html", window.location.href).href.split("?")[0];
}

function getInscripcionPublicLink(groupId, token, fase = "normal") {
  const base = getInscripcionBaseUrl();

  return `${base}?grupo=${encodeURIComponent(groupId)}&fase=${encodeURIComponent(fase)}&token=${encodeURIComponent(token)}`;
}

function abrirModalConfirmacionPolera(fase = "normal") {
  const faseNormalizada =
    normalizeSearchLocal(fase);

  const contexto =
    getContextoInscripcionGrupo(
      faseNormalizada
    );

  state.fasePendienteConfirmacionPolera =
    faseNormalizada;

  const elementos =
    getElementosIncluidosGrupo();

  const checkbox =
    $("confirmarPoleraInscripcion");

  if (checkbox) {
    /*
      getElementosIncluidosGrupo() ya aplica
      la regla de compatibilidad:

      - Sin configuración guardada: true.
      - Guardado como true: true.
      - Guardado como false: false.
    */
    checkbox.checked =
      elementos.polera === true;
  }

  setText(
    "tituloConfirmarPoleraInscripcion",
    "Confirmar polera del grupo"
  );

  setText(
    "subtituloConfirmarPoleraInscripcion",
    `Antes de abrir "${contexto.labelFase}", confirma si el grupo incluye polera.`
  );

  const btnContinuar =
    $("btnGuardarYAbrirInscripcion");

  if (btnContinuar) {
    btnContinuar.disabled = false;
    btnContinuar.textContent =
      `Guardar y abrir ${contexto.labelFase}`;
  }

  openModal(
    "modalConfirmarPoleraInscripcion"
  );
}

function cerrarModalConfirmacionPolera() {
  state.fasePendienteConfirmacionPolera = "";

  closeModal(
    "modalConfirmarPoleraInscripcion"
  );
}

function revisarTodosLosElementosDesdeConfirmacion() {
  cerrarModalConfirmacionPolera();

  /*
    Abre el mismo modal de Situación del grupo,
    donde están todos los elementos incluidos.
  */
  openSituacionModal();
}

async function abrirInscripcionPrincipalDesdeBoton() {
  if (canGestionarInscripcionInicial()) {
    abrirModalConfirmacionPolera(
      "normal"
    );

    return;
  }

  if (canGestionarNominaFinal()) {
    abrirModalConfirmacionPolera(
      "nomina_final"
    );

    return;
  }

  alert(
    getBlockedInscripcionMessage()
  );
}

async function guardarPoleraYAbrirInscripcion() {
  const fase =
    normalizeSearchLocal(
      state.fasePendienteConfirmacionPolera || ""
    );

  if (
    fase !== "normal" &&
    fase !== "nomina_final"
  ) {
    alert(
      "No se pudo determinar qué formulario se debe abrir."
    );

    return;
  }

  const checkbox =
    $("confirmarPoleraInscripcion");

  const tienePolera =
    checkbox?.checked === true;

  const elementosAnteriores =
    getElementosIncluidosGrupo();

  const btn =
    $("btnGuardarYAbrirInscripcion");

  if (btn) {
    btn.disabled = true;
    btn.textContent = "Guardando...";
  }

  try {
    /*
      Conservamos todos los elementos existentes
      y modificamos únicamente polera.
    */
    const elementosActuales = {
      ...(state.group?.elementosIncluidos || {}),

      poleron:
        elementosAnteriores.poleron,

      polera:
        tienePolera,

      soporteCelular:
        elementosAnteriores.soporteCelular,

      portapasaporte:
        elementosAnteriores.portapasaporte,

      toalla:
        elementosAnteriores.toalla,

      cortesias:
        elementosAnteriores.cortesias,

      otros:
        elementosAnteriores.otros,

      otrosDetalle:
        elementosAnteriores.otros
          ? elementosAnteriores.otrosDetalle
          : "",

      actualizadoPor:
        getDisplayName(
          state.effectiveUser
        ),

      actualizadoPorCorreo:
        state.effectiveEmail,

      actualizadoAt:
        serverTimestamp()
    };

    const cambioPolera =
      elementosAnteriores.polera !==
      tienePolera;

    /*
      Guardamos incluso cuando no había configuración previa.
      Así el grupo queda con una decisión explícita.
    */
    await saveGroupPatch(
      {
        elementosIncluidos:
          elementosActuales
      },
      {
        tipoMovimiento:
          "polera_confirmada_antes_inscripcion",

        modulo:
          "inscripcion",

        titulo:
          "Polera confirmada antes de abrir inscripción",

        mensaje:
          `${getDisplayName(state.effectiveUser)} confirmó que el grupo ${
            tienePolera
              ? "sí incluye"
              : "no incluye"
          } polera antes de abrir el formulario.`,

        cambios: cambioPolera
          ? [
              {
                campo:
                  "elementosIncluidos.polera",

                anterior:
                  elementosAnteriores.polera,

                nuevo:
                  tienePolera
              }
            ]
          : [],

        metadata: {
          faseInscripcion:
            fase,

          tienePolera
        }
      }
    );

    closeModal(
      "modalConfirmarPoleraInscripcion"
    );

    state.fasePendienteConfirmacionPolera = "";

    /*
      Abrimos la fase sin repetir el confirm()
      del navegador, porque el usuario ya confirmó
      mediante este modal.
    */
    await cambiarFaseInscripcion(
      fase,
      {
        confirmarApertura: false
      }
    );
  } catch (error) {
    console.error(
      "[grupo] guardarPoleraYAbrirInscripcion",
      error
    );

    alert(
      "No se pudo guardar la configuración de polera: " +
      (
        error?.message ||
        "Error desconocido"
      )
    );
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent =
        "Guardar y abrir formulario";
    }
  }
}

async function enableGroupInscripcion() {
  await abrirInscripcionPrincipalDesdeBoton();
}

async function cambiarFaseInscripcion(
  fase = "normal",
  {
    confirmarApertura = true
  } = {}
) {
  const faseNormalizada = normalizeSearchLocal(fase);

  let puedeGestionar = false;

  if (faseNormalizada === "normal") {
    puedeGestionar = canGestionarInscripcionInicial();
  } else if (faseNormalizada === "nomina_final") {
    puedeGestionar = canGestionarNominaFinal();
  } else if (faseNormalizada === "nuevos") {
    puedeGestionar = canGestionarNuevosIngresos();
  } else if (faseNormalizada === "lista_espera") {
    puedeGestionar = canGestionarListaEspera();
  }

  if (!puedeGestionar) {
    alert(getBlockedInscripcionMessage());
    return;
  }

  const contexto = getContextoInscripcionGrupo(faseNormalizada);
  const label = contexto.labelFase;
  const tokenInscripcion = generateInscripcionToken(32);

  if (confirmarApertura) {
    const ok = confirm(
      `¿Quieres abrir "${label}" y generar un nuevo link público?`
    );
  
    if (!ok) return;
  }

  const link = getInscripcionPublicLink(state.groupId, tokenInscripcion, faseNormalizada);

  const patch = {
    inscripcionHabilitada: true,
    tokenInscripcion,
    inscripcionEstado: faseNormalizada,
    faseInscripcion: faseNormalizada,

    fechaAperturaInscripcion: serverTimestamp(),

    inscripcion: {
      ...(state.group?.inscripcion || {}),
      estado: faseNormalizada,
      faseActual: faseNormalizada,

      claveActual: contexto.clave,
      labelActual: contexto.labelFase,
      tipoInscripcionActual: contexto.tipoInscripcion,
      estadoCupoActual: contexto.estadoCupo,

      tokenActual: tokenInscripcion,
      linkActual: link,

      actualizadoPor: getDisplayName(state.effectiveUser),
      actualizadoPorCorreo: state.effectiveEmail,
      actualizadoAt: serverTimestamp(),

      linkGeneradoPor: getDisplayName(state.effectiveUser),
      linkGeneradoPorCorreo: state.effectiveEmail,
      linkGeneradoAt: serverTimestamp()
    },

    correoCambiosInscripcion:
      cleanText(state.group?.correoCambiosInscripcion || "") || DEFAULT_CORREO_CAMBIOS_INSCRIPCION
  };

  await saveGroupPatch(patch, {
    tipoMovimiento: `inscripcion_${faseNormalizada}_habilitada`,
    modulo: "inscripcion",
    titulo: `Inscripción abierta: ${label}`,
    mensaje: `${getDisplayName(state.effectiveUser)} abrió "${label}" y generó un nuevo link público.`,
    cambios: [
      {
        campo: "inscripcionEstado",
        anterior: getInscripcionEstadoActual(),
        nuevo: faseNormalizada
      },
      {
        campo: "tipoInscripcionActual",
        anterior: state.group?.inscripcion?.tipoInscripcionActual || "",
        nuevo: contexto.tipoInscripcion
      },
      {
        campo: "tokenInscripcion",
        anterior: state.group?.tokenInscripcion || "",
        nuevo: tokenInscripcion
      }
    ]
  });

  try {
    await navigator.clipboard.writeText(link);
    showSaveNotice(`${label} habilitada y link copiado.`);
  } catch {
    showSaveNotice(`${label} habilitada correctamente.`);
    alert(`Link de inscripción:\n\n${link}`);
  }
}

async function copiarLinkProcesoInscripcion({
  link = "",
  mensaje = "Link copiado."
} = {}) {
  const linkLimpio =
    cleanText(link || "");

  if (!linkLimpio) {
    alert(
      "No se encontró un link activo para este proceso."
    );

    return;
  }

  try {
    await navigator.clipboard.writeText(
      linkLimpio
    );

    showSaveNotice(
      mensaje
    );
  } catch {
    alert(
      `No se pudo copiar automáticamente.\n\nCopia este link:\n\n${linkLimpio}`
    );
  }
}

async function copiarLinkNuevosIngresos() {
  const estado =
    getEstadoNuevosIngresos();

  if (!estado.activo) {
    alert(
      "El proceso de Nuevos ingresos no está abierto."
    );

    return;
  }

  await copiarLinkProcesoInscripcion({
    link: estado.link,
    mensaje:
      "Link de Nuevos ingresos copiado."
  });
}

async function copiarLinkListaEspera() {
  const estado =
    getEstadoListaEsperaLink();

  if (!estado.activo) {
    alert(
      "La Lista de espera no está abierta."
    );

    return;
  }

  await copiarLinkProcesoInscripcion({
    link: estado.link,
    mensaje:
      "Link de Lista de espera copiado."
  });
}

async function copiarLinkLiberados() {
  const estado =
    getEstadoLiberadosLink();

  if (!estado.activo) {
    alert(
      "El link de Cupos liberados no está abierto."
    );

    return;
  }

  let link =
    cleanText(
      estado.link || ""
    );

  /*
    Compatibilidad con grupos antiguos que solamente
    tienen guardado el token.
  */
  if (!link && estado.token) {
    link =
      getInscripcionPublicLink(
        state.groupId,
        estado.token,
        "liberado"
      );
  }

  await copiarLinkProcesoInscripcion({
    link,
    mensaje:
      "Link de Cupos liberados copiado."
  });
}

async function toggleNuevosIngresos() {
  if (!canGestionarNuevosIngresos()) {
    alert(
      "No tienes permisos o Nuevo ingreso no corresponde por fecha."
    );

    return;
  }

  const estadoActual =
    getEstadoNuevosIngresos();

  if (estadoActual.activo) {
    await cerrarNuevosIngresos();
    return;
  }

  await abrirNuevosIngresos();
}

async function abrirNuevosIngresos() {
  const token =
    generateInscripcionToken(32);

  const link =
    getInscripcionPublicLink(
      state.groupId,
      token,
      "nuevos"
    );

  const esExcepcion =
    esAdminOSupervisionInscripcion() &&
    !correspondeNuevosIngresosPorFecha();

  const ok = confirm(
    esExcepcion
      ? "Nuevo ingreso no corresponde actualmente por fecha. ¿Quieres abrirlo como excepción de Admin/Supervisión?"
      : "¿Quieres abrir Nuevo ingreso y generar un nuevo link?"
  );

  if (!ok) return;

  await saveGroupPatch(
    {
      inscripcionNuevos: {
        ...(state.group?.inscripcionNuevos || {}),

        activo: true,
        tokenActual: token,
        linkActual: link,

        abiertoPor:
          getDisplayName(state.effectiveUser),

        abiertoPorCorreo:
          state.effectiveEmail,

        abiertoAt:
          serverTimestamp(),

        actualizadoPor:
          getDisplayName(state.effectiveUser),

        actualizadoPorCorreo:
          state.effectiveEmail,

        actualizadoAt:
          serverTimestamp(),

        excepcionFecha:
          esExcepcion
      }
    },
    {
      tipoMovimiento:
        "nuevos_ingresos_abiertos",

      modulo:
        "inscripcion",

      titulo:
        "Nuevo ingreso abierto",

      mensaje:
        `${getDisplayName(state.effectiveUser)} abrió el link de Nuevo ingreso.`,

      cambios: [
        {
          campo:
            "inscripcionNuevos.activo",

          anterior:
            false,

          nuevo:
            true
        }
      ],

      metadata: {
        excepcionFecha:
          esExcepcion,

        tokenGenerado:
          true
      }
    }
  );

  try {
    await navigator.clipboard.writeText(link);

    showSaveNotice(
      "Nuevo ingreso abierto y link copiado."
    );
  } catch {
    alert(
      `Nuevo ingreso abierto.\n\nLink:\n${link}`
    );
  }
}

async function cerrarNuevosIngresos() {
  const estadoActual =
    getEstadoNuevosIngresos();

  if (!estadoActual.activo) return;

  const ok = confirm(
    "¿Quieres cerrar el link de Nuevo ingreso?"
  );

  if (!ok) return;

  await saveGroupPatch(
    {
      inscripcionNuevos: {
        ...(state.group?.inscripcionNuevos || {}),

        activo: false,

        cerradoPor:
          getDisplayName(state.effectiveUser),

        cerradoPorCorreo:
          state.effectiveEmail,

        cerradoAt:
          serverTimestamp(),

        actualizadoPor:
          getDisplayName(state.effectiveUser),

        actualizadoPorCorreo:
          state.effectiveEmail,

        actualizadoAt:
          serverTimestamp()
      }
    },
    {
      tipoMovimiento:
        "nuevos_ingresos_cerrados",

      modulo:
        "inscripcion",

      titulo:
        "Nuevo ingreso cerrado",

      mensaje:
        `${getDisplayName(state.effectiveUser)} cerró el link de Nuevo ingreso.`,

      cambios: [
        {
          campo:
            "inscripcionNuevos.activo",

          anterior:
            true,

          nuevo:
            false
        }
      ]
    }
  );

  showSaveNotice(
    "Nuevo ingreso cerrado correctamente."
  );
}

async function toggleListaEspera() {
  if (!canGestionarListaEspera()) {
    alert(
      "No tienes permisos o Lista de espera no corresponde por fecha."
    );

    return;
  }

  const estadoActual =
    getEstadoListaEsperaLink();

  if (estadoActual.activo) {
    await cerrarListaEspera();
    return;
  }

  await abrirListaEspera();
}

async function abrirListaEspera() {
  const token =
    generateInscripcionToken(32);

  const link =
    getInscripcionPublicLink(
      state.groupId,
      token,
      "lista_espera"
    );

  const esExcepcion =
    esAdminOSupervisionInscripcion() &&
    !correspondeListaEsperaPorFecha();

  const ok = confirm(
    esExcepcion
      ? "Lista de espera todavía no corresponde por fecha. ¿Quieres abrirla como excepción de Admin/Supervisión?"
      : "¿Quieres abrir Lista de espera y generar un nuevo link?"
  );

  if (!ok) return;

  await saveGroupPatch(
    {
      inscripcionListaEspera: {
        ...(state.group?.inscripcionListaEspera || {}),

        activo: true,
        tokenActual: token,
        linkActual: link,

        abiertoPor:
          getDisplayName(state.effectiveUser),

        abiertoPorCorreo:
          state.effectiveEmail,

        abiertoAt:
          serverTimestamp(),

        actualizadoPor:
          getDisplayName(state.effectiveUser),

        actualizadoPorCorreo:
          state.effectiveEmail,

        actualizadoAt:
          serverTimestamp(),

        excepcionFecha:
          esExcepcion
      }
    },
    {
      tipoMovimiento:
        "lista_espera_abierta",

      modulo:
        "inscripcion",

      titulo:
        "Lista de espera abierta",

      mensaje:
        `${getDisplayName(state.effectiveUser)} abrió el link de Lista de espera.`,

      cambios: [
        {
          campo:
            "inscripcionListaEspera.activo",

          anterior:
            false,

          nuevo:
            true
        }
      ],

      metadata: {
        excepcionFecha:
          esExcepcion,

        tokenGenerado:
          true
      }
    }
  );

  try {
    await navigator.clipboard.writeText(link);

    showSaveNotice(
      "Lista de espera abierta y link copiado."
    );
  } catch {
    alert(
      `Lista de espera abierta.\n\nLink:\n${link}`
    );
  }
}

async function cerrarListaEspera() {
  const estadoActual =
    getEstadoListaEsperaLink();

  if (!estadoActual.activo) return;

  const ok = confirm(
    "¿Quieres cerrar el link de Lista de espera?"
  );

  if (!ok) return;

  await saveGroupPatch(
    {
      inscripcionListaEspera: {
        ...(state.group?.inscripcionListaEspera || {}),

        activo: false,

        cerradoPor:
          getDisplayName(state.effectiveUser),

        cerradoPorCorreo:
          state.effectiveEmail,

        cerradoAt:
          serverTimestamp(),

        actualizadoPor:
          getDisplayName(state.effectiveUser),

        actualizadoPorCorreo:
          state.effectiveEmail,

        actualizadoAt:
          serverTimestamp()
      }
    },
    {
      tipoMovimiento:
        "lista_espera_cerrada",

      modulo:
        "inscripcion",

      titulo:
        "Lista de espera cerrada",

      mensaje:
        `${getDisplayName(state.effectiveUser)} cerró el link de Lista de espera.`,

      cambios: [
        {
          campo:
            "inscripcionListaEspera.activo",

          anterior:
            true,

          nuevo:
            false
        }
      ]
    }
  );

  showSaveNotice(
    "Lista de espera cerrada correctamente."
  );
}

async function crearLinkLiberados() {
  if (!canGestionarLiberados()) {
    alert(
      getBlockedInscripcionMessage()
    );

    return;
  }

  const estadoActual =
    getEstadoLiberadosLink();

  if (estadoActual.activo) {
    alert(
      "El link de Cupos liberados ya está abierto."
    );

    return;
  }

  const token =
    generateInscripcionToken(32);

  const link =
    getInscripcionPublicLink(
      state.groupId,
      token,
      "liberado"
    );

  const ok = confirm(
    "¿Quieres abrir el link para Cupos liberados?"
  );

  if (!ok) return;

  await saveGroupPatch(
    {
      linkLiberadosActivo: true,
      tokenInscripcionLiberados:
        token,

      inscripcionLiberados: {
        ...(
          state.group
            ?.inscripcionLiberados ||
          {}
        ),

        activo: true,
        tokenActual: token,
        linkActual: link,

        abiertoPor:
          getDisplayName(
            state.effectiveUser
          ),

        abiertoPorCorreo:
          state.effectiveEmail,

        abiertoAt:
          serverTimestamp(),

        actualizadoPor:
          getDisplayName(
            state.effectiveUser
          ),

        actualizadoPorCorreo:
          state.effectiveEmail,

        actualizadoAt:
          serverTimestamp()
      }
    },
    {
      tipoMovimiento:
        "inscripcion_liberados_habilitada",

      modulo:
        "inscripcion",

      titulo:
        "Link de liberados abierto",

      mensaje:
        `${getDisplayName(
          state.effectiveUser
        )} abrió el link para Cupos liberados.`,

      cambios: [
        {
          campo:
            "linkLiberadosActivo",

          anterior:
            false,

          nuevo:
            true
        }
      ]
    }
  );

  try {
    await navigator.clipboard.writeText(
      link
    );

    showSaveNotice(
      "Link de Cupos liberados abierto y copiado."
    );
  } catch {
    alert(
      `Link de Cupos liberados:\n\n${link}`
    );
  }
}

async function cerrarLinkLiberados() {
  if (!canGestionarLiberados()) {
    alert(
      getBlockedInscripcionMessage()
    );

    return;
  }

  const estadoActual =
    getEstadoLiberadosLink();

  if (!estadoActual.activo) {
    alert(
      "El link de Cupos liberados ya está cerrado."
    );

    return;
  }

  const ok = confirm(
    "¿Quieres cerrar el link de Cupos liberados?"
  );

  if (!ok) return;

  await saveGroupPatch(
    {
      linkLiberadosActivo: false,

      inscripcionLiberados: {
        ...(
          state.group
            ?.inscripcionLiberados ||
          {}
        ),

        activo: false,

        cerradoPor:
          getDisplayName(
            state.effectiveUser
          ),

        cerradoPorCorreo:
          state.effectiveEmail,

        cerradoAt:
          serverTimestamp(),

        actualizadoPor:
          getDisplayName(
            state.effectiveUser
          ),

        actualizadoPorCorreo:
          state.effectiveEmail,

        actualizadoAt:
          serverTimestamp()
      }
    },
    {
      tipoMovimiento:
        "inscripcion_liberados_cerrada",

      modulo:
        "inscripcion",

      titulo:
        "Link de liberados cerrado",

      mensaje:
        `${getDisplayName(
          state.effectiveUser
        )} cerró el link para Cupos liberados.`,

      cambios: [
        {
          campo:
            "linkLiberadosActivo",

          anterior:
            true,

          nuevo:
            false
        }
      ]
    }
  );

  showSaveNotice(
    "Link de Cupos liberados cerrado."
  );
}

async function cerrarInscripcion() {
  const puedeCerrar =
    puedeAbrirCerrarFasesInscripcion() ||
    puedeReabrirFasePasada();

  if (!puedeCerrar) {
    alert(getBlockedInscripcionMessage());
    return;
  }

  /*
    No permitimos cerrar como Inscripción inicial una marca
    antigua de un grupo importado desde Sistema de Pagos.
  
    Ese grupo debe abrir primero Nómina final / ficha médica.
  */
  if (tieneProcesoPrincipalAntiguoInvalido()) {
    alert(
      "Este grupo no tiene un proceso principal válido abierto. Debes abrir Nómina final / ficha médica."
    );
  
    return;
  }

  if (!state.group?.inscripcionHabilitada) {
    alert("No hay una inscripción activa para cerrar.");
    return;
  }

  const estadoAnterior = getInscripcionEstadoActual();

  const contextoActivo = {
    clave:
      state.group?.inscripcion?.claveActual ||
      getContextoInscripcionGrupo(estadoAnterior).clave,

    label:
      state.group?.inscripcion?.labelActual ||
      getContextoInscripcionGrupo(estadoAnterior).labelFase
  };

  const ok = confirm(`¿Quieres cerrar "${contextoActivo.label}"?`);
  if (!ok) return;

  const fasesCerradasActuales = state.group?.inscripcion?.fasesCerradas || {};

  await saveGroupPatch(
    {
      inscripcionHabilitada: false,
      inscripcionEstado: "cerrada",
      faseInscripcion: "cerrada",

      inscripcion: {
        ...(state.group?.inscripcion || {}),
        estado: "cerrada",
        faseActual: "cerrada",

        fasesCerradas: {
          ...fasesCerradasActuales,
          [contextoActivo.clave]: true
        },

        actualizadoPor: getDisplayName(state.effectiveUser),
        actualizadoPorCorreo: state.effectiveEmail,
        actualizadoAt: serverTimestamp(),

        cerradaPor: getDisplayName(state.effectiveUser),
        cerradaPorCorreo: state.effectiveEmail,
        cerradaAt: serverTimestamp(),
        ultimaFaseCerrada: contextoActivo.clave,
        ultimaFaseCerradaLabel: contextoActivo.label
      }
    },
    {
      tipoMovimiento: "inscripcion_cerrada",
      modulo: "inscripcion",
      titulo: `Inscripción cerrada: ${contextoActivo.label}`,
      mensaje: `${getDisplayName(state.effectiveUser)} cerró "${contextoActivo.label}".`,
      cambios: [
        {
          campo: "inscripcionEstado",
          anterior: estadoAnterior,
          nuevo: "cerrada"
        },
        {
          campo: "faseCerrada",
          anterior: "",
          nuevo: contextoActivo.clave
        },
        {
          campo: "inscripcionHabilitada",
          anterior: !!state.group?.inscripcionHabilitada,
          nuevo: false
        }
      ]
    }
  );

  showSaveNotice(`${contextoActivo.label} cerrada correctamente.`);
}

async function marcarListaEsperaPagada(inscripcionId = "") {
  console.log("[INSCRIPCIONES] Entró a marcarListaEsperaPagada", {
    inscripcionId,
    email: state.effectiveEmail,
    rol: state.effectiveUser?.rol,
    estadoGrupo: state.group?.estado,
    puedeOperarListaEsperaAdministrativa: puedeOperarListaEsperaAdministrativa(),
    puedeMarcarListaEsperaPagada: puedeMarcarListaEsperaPagada()
  });

  try {
    if (!puedeMarcarListaEsperaPagada()) {
      alert("Solo Administración o Admin pueden marcar lista de espera como pagada.");
      return;
    }

    const item = state.inscripciones.find((x) => x.id === inscripcionId);
    if (!item) {
      alert("No se encontró la inscripción seleccionada.");
      return;
    }

    const nombre = [
      getInscripcionNombres(item),
      getInscripcionApellidos(item)
    ].filter(Boolean).join(" ");

    const ok = confirm(`¿Confirmar que ${nombre || "esta persona"} pagó los $100.000 de lista de espera?`);
    if (!ok) return;

    const ref = doc(
      db,
      "ventas_cotizaciones",
      String(state.groupDocId),
      "inscripciones",
      String(inscripcionId)
    );

    console.log("[INSCRIPCIONES] Intentando updateDoc lista espera pagada", {
      path: `ventas_cotizaciones/${state.groupDocId}/inscripciones/${inscripcionId}`
    });

    await updateDoc(ref, {
      tipoInscripcion: "lista_espera_pagada",
      estadoCupo: "pagado",
      listaEsperaPagada: true,
      listaEsperaPagadaPor: getDisplayName(state.effectiveUser),
      listaEsperaPagadaPorCorreo: state.effectiveEmail,
      listaEsperaPagadaAt: serverTimestamp()
    });

    console.log("[INSCRIPCIONES] updateDoc lista espera pagada OK");

    const alertaRef = doc(
      db,
      ALERTAS_INSCRIPCIONES_COLLECTION,
      getDocIdAlertaInscripcion(item.id)
    );
    
    await setDoc(alertaRef, {
      activa: false,
      resuelta: true,
      resueltaAt: serverTimestamp(),
      resueltaPor: getDisplayName(state.effectiveUser),
      resueltaPorCorreo: state.effectiveEmail,
      actualizadoAt: serverTimestamp()
    }, { merge: true });

    await createHistoryEntry({
      tipoMovimiento: "inscripcion_lista_espera_pagada",
      modulo: "inscripcion",
      titulo: "Lista de espera pagada",
      mensaje: `${getDisplayName(state.effectiveUser)} marcó como pagada la lista de espera de ${nombre || "una persona"}.`,
      metadata: {
        inscripcionId,
        documento: getInscripcionDocumento(item),
        nombreCompleto: nombre
      }
    });

    await recargarNominaDespuesDeCambio();

    showSaveNotice("Lista de espera marcada como pagada.");
  } catch (error) {
    console.error("[INSCRIPCIONES] Error al marcar lista de espera pagada", error);
    alert("Error al marcar lista de espera como pagada: " + error.message);
  }
}

async function confirmarCupoListaEspera(inscripcionId = "") {
  if (!canConfirmarListaEspera()) {
    alert(getBlockedInscripcionMessage());
    return;
  }

  const item = state.inscripciones.find((x) => x.id === inscripcionId);
  if (!item) {
    alert("No se encontró la inscripción seleccionada.");
    return;
  }

  if (normalizeSearchLocal(item.estadoCupo || "") !== "pagado") {
    alert("Antes de confirmar el cupo, Administración o Admin debe marcar esta lista de espera como pagada.");
    return;
  }

  const nombre = [
    getInscripcionNombres(item),
    getInscripcionApellidos(item)
  ].filter(Boolean).join(" ");

  const ok = confirm(`¿Confirmar cupo para ${nombre || "esta persona"} desde lista de espera pagada?`);
  if (!ok) return;

  const ref = doc(
    db,
    "ventas_cotizaciones",
    String(state.groupDocId),
    "inscripciones",
    String(inscripcionId)
  );

  await updateDoc(ref, {
    tipoInscripcion: "lista_espera_confirmada",
    estadoCupo: "confirmado",
    confirmadoDesdeListaEspera: true,
    confirmadoCupoPor: getDisplayName(state.effectiveUser),
    confirmadoCupoPorCorreo: state.effectiveEmail,
    confirmadoCupoAt: serverTimestamp()
  });

  const alertaRef = doc(
    db,
    ALERTAS_INSCRIPCIONES_COLLECTION,
    getDocIdAlertaInscripcion(item.id)
  );
  
  await setDoc(alertaRef, {
    activa: false,
    resuelta: true,
    resueltaAt: serverTimestamp(),
    resueltaPor: getDisplayName(state.effectiveUser),
    resueltaPorCorreo: state.effectiveEmail,
    actualizadoAt: serverTimestamp()
  }, { merge: true });

  await createHistoryEntry({
    tipoMovimiento: "inscripcion_lista_espera_confirmada",
    modulo: "inscripcion",
    titulo: "Cupo confirmado desde lista de espera pagada",
    mensaje: `${getDisplayName(state.effectiveUser)} confirmó cupo para ${nombre || "una persona"} desde lista de espera pagada.`,
    metadata: {
      inscripcionId,
      documento: getInscripcionDocumento(item),
      nombreCompleto: nombre
    }
  });

  await recargarNominaDespuesDeCambio();

  showSaveNotice("Cupo confirmado correctamente.");
}

async function confirmarNuevoIngreso(inscripcionId = "") {
  if (!canConfirmarListaEspera()) {
    alert("Solo Registro, Administración o Admin pueden confirmar nuevos ingresos.");
    return;
  }

  const item = state.inscripciones.find((x) => x.id === inscripcionId);
  if (!item) {
    alert("No se encontró la inscripción seleccionada.");
    return;
  }

  const nombre = [
    getInscripcionNombres(item),
    getInscripcionApellidos(item)
  ].filter(Boolean).join(" ");

  const ok = confirm(`¿Confirmar nuevo ingreso para ${nombre || "esta persona"}?`);
  if (!ok) return;

  const ref = doc(
    db,
    "ventas_cotizaciones",
    String(state.groupDocId),
    "inscripciones",
    String(inscripcionId)
  );

  await updateDoc(ref, {
    tipoInscripcion: "nuevo_ingreso_confirmado",
    estadoCupo: "confirmado",
    nuevoIngresoConfirmado: true,
    nuevoIngresoConfirmadoPor: getDisplayName(state.effectiveUser),
    nuevoIngresoConfirmadoPorCorreo: state.effectiveEmail,
    nuevoIngresoConfirmadoAt: serverTimestamp()
  });

  const alertaRef = doc(
    db,
    ALERTAS_INSCRIPCIONES_COLLECTION,
    getDocIdAlertaInscripcion(item.id)
  );
  
  await setDoc(alertaRef, {
    activa: false,
    resuelta: true,
    resueltaAt: serverTimestamp(),
    resueltaPor: getDisplayName(state.effectiveUser),
    resueltaPorCorreo: state.effectiveEmail,
    actualizadoAt: serverTimestamp()
  }, { merge: true });

  await createHistoryEntry({
    tipoMovimiento: "inscripcion_nuevo_ingreso_confirmado",
    modulo: "inscripcion",
    titulo: "Nuevo ingreso confirmado",
    mensaje: `${getDisplayName(state.effectiveUser)} confirmó nuevo ingreso para ${nombre || "una persona"}.`,
    metadata: {
      inscripcionId,
      documento: getInscripcionDocumento(item),
      nombreCompleto: nombre
    }
  });

  await recargarNominaDespuesDeCambio();

  showSaveNotice("Nuevo ingreso confirmado correctamente.");
}

function validarCorreoSimple(correo = "") {
  const v = normalizeEmail(correo || "");
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function getCorreoClienteInscripcion(item = {}) {
  const tipo = normalizeSearchLocal(item.tipoViajante || item.tipoParticipacion || "");

  if (tipo === "estudiante") {
    return normalizeEmail(getByPath(item, "contactoPrincipal.correo") || "");
  }

  return normalizeEmail(
    getByPath(item, "identificacion.correoViajante") ||
    getByPath(item, "contactoPrincipal.correo") ||
    ""
  );
}

function getPayloadReenvioInscripcion(item = {}, nuevoCorreo = "") {
  const tipo = normalizeSearchLocal(item.tipoViajante || item.tipoParticipacion || "");
  const payload = JSON.parse(JSON.stringify(item || {}));

  if (tipo === "estudiante") {
    payload.contactoPrincipal = {
      ...(payload.contactoPrincipal || {}),
      correo: nuevoCorreo
    };
  } else {
    payload.identificacion = {
      ...(payload.identificacion || {}),
      correoViajante: nuevoCorreo,
      correoPersonaQueViaja: nuevoCorreo
    };

    payload.contactoPrincipal = {
      ...(payload.contactoPrincipal || {}),
      correo: nuevoCorreo
    };
  }

  return payload;
}

function getPatchCorreoInscripcionCliente(item = {}, nuevoCorreo = "") {
  const tipo = normalizeSearchLocal(item.tipoViajante || item.tipoParticipacion || "");

  if (tipo === "estudiante") {
    return {
      "contactoPrincipal.correo": nuevoCorreo,
      "reenvioCorreoInscripcion.ultimoCorreoCliente": nuevoCorreo,
      "reenvioCorreoInscripcion.ultimoReenvioAt": serverTimestamp(),
      "reenvioCorreoInscripcion.ultimoReenvioPor": getDisplayName(state.effectiveUser),
      "reenvioCorreoInscripcion.ultimoReenvioPorCorreo": state.effectiveEmail
    };
  }

  return {
    "identificacion.correoViajante": nuevoCorreo,
    "identificacion.correoPersonaQueViaja": nuevoCorreo,
    "contactoPrincipal.correo": nuevoCorreo,
    "reenvioCorreoInscripcion.ultimoCorreoCliente": nuevoCorreo,
    "reenvioCorreoInscripcion.ultimoReenvioAt": serverTimestamp(),
    "reenvioCorreoInscripcion.ultimoReenvioPor": getDisplayName(state.effectiveUser),
    "reenvioCorreoInscripcion.ultimoReenvioPorCorreo": state.effectiveEmail
  };
}

async function openReenviarCorreoInscripcionModal(
  inscripcionId = ""
) {
  const item =
    await obtenerInscripcionCompleta(
      inscripcionId
    );

  if (!item) {
    alert(
      "No se pudo cargar la inscripción completa."
    );

    return;
  }

  const actual =
    getCorreoClienteInscripcion(
      item
    );

  const nombre =
    buildNombreCompletoInscripcion(
      item
    );

  const tipo =
    getEstadoOperativoInscripcionLabel(
      item
    );

  const nuevoCorreo =
    prompt(
      [
        "Reenviar correo oficial de inscripción",
        "",
        `Pasajero: ${nombre || "—"}`,
        `Tipo: ${tipo}`,
        `Correo actual: ${actual || "sin correo"}`,
        "",
        "Ingresa el nuevo correo al que se reenviará el correo oficial:"
      ].join("\n"),
      actual || ""
    );

  if (nuevoCorreo === null) {
    return;
  }

  await reenviarCorreoInscripcionCliente(
    inscripcionId,
    nuevoCorreo
  );
}

async function reenviarCorreoInscripcionCliente(inscripcionId = "", nuevoCorreoRaw = "") {
  if (!canEditarNominaInscripcion()) {
    alert("No tienes permisos para modificar el correo de una inscripción.");
    return;
  }

  const nuevoCorreo = normalizeEmail(nuevoCorreoRaw || "");

  if (!validarCorreoSimple(nuevoCorreo)) {
    alert("Debes ingresar un correo válido.");
    return;
  }

  const item =
    await obtenerInscripcionCompleta(
      inscripcionId
    );
  
  if (!item) {
    alert(
      "No se pudo cargar la inscripción completa."
    );
  
    return;
  }

  const correoAnterior = getCorreoClienteInscripcion(item);
  const nombre = buildNombreCompletoInscripcion(item);
  const documento = getInscripcionDocumento(item);
  const tipoLabel = getEstadoOperativoInscripcionLabel(item);

  const ok = confirm(
    [
      `¿Confirmas reenviar el correo oficial de inscripción?`,
      ``,
      `Pasajero: ${nombre || "—"}`,
      `Documento: ${documento || "—"}`,
      `Tipo: ${tipoLabel}`,
      ``,
      `Correo anterior: ${correoAnterior || "—"}`,
      `Nuevo correo: ${nuevoCorreo}`,
      ``,
      `Esto actualizará el correo de contacto en la inscripción y enviará nuevamente el correo oficial.`
    ].join("\n")
  );

  if (!ok) return;

  const ref = doc(
    db,
    "ventas_cotizaciones",
    String(state.groupDocId),
    "inscripciones",
    String(inscripcionId)
  );

  const payloadReenvio = getPayloadReenvioInscripcion(item, nuevoCorreo);

  await updateDoc(ref, getPatchCorreoInscripcionCliente(item, nuevoCorreo));

  await addDoc(collection(db, "correos_inscripcion_pendientes"), {
    tipoEnvio: "reenvio_cliente",
    origen: "grupo_js_reenvio_manual",
    estado: "pendiente",

    destinatario: nuevoCorreo,
    payload: payloadReenvio,

    reenviarTransferencias: false,

    idGrupo: String(state.groupId || ""),
    groupDocId: String(state.groupDocId || ""),
    inscripcionId: String(inscripcionId || ""),
    documento,
    nombreParticipante: nombre,
    tipoInscripcion: getInscripcionTipoReal(item),

    correoAnterior,
    correoNuevo: nuevoCorreo,

    creadoPor: getDisplayName(state.effectiveUser),
    creadoPorCorreo: state.effectiveEmail,
    creadoAt: serverTimestamp()
  });

  await createHistoryEntry({
    tipoMovimiento: "reenvio_correo_inscripcion_cliente",
    modulo: "inscripcion",
    titulo: "Correo oficial de inscripción reenviado",
    mensaje: `${getDisplayName(state.effectiveUser)} actualizó el correo de ${nombre || "una inscripción"} desde ${correoAnterior || "sin correo"} a ${nuevoCorreo} y reenvió el correo oficial de inscripción.`,
    metadata: {
      inscripcionId,
      documento,
      nombreCompleto: nombre,
      tipoInscripcion: getInscripcionTipoReal(item),
      correoAnterior,
      correoNuevo: nuevoCorreo
    }
  });

  await recargarNominaDespuesDeCambio();

  showSaveNotice("Correo actualizado y reenvío generado correctamente.");
}

window.archivarInscripcionesGrupo = async function ({ rut = "", confirmar = false, motivo = "" } = {}) {
  if (!canEditarNominaInscripcion()) {
    console.error("No tienes permisos para archivar inscripciones.");
    return;
  }

  if (!confirmar) {
    console.warn("Debes ejecutar con confirmar:true");
    console.warn("Ejemplo archivar por RUT:");
    console.warn(`await archivarInscripcionesGrupo({ rut: "10121006-5", motivo: "prueba", confirmar: true })`);
    console.warn("Ejemplo archivar TODOS:");
    console.warn(`await archivarInscripcionesGrupo({ motivo: "limpieza nómina", confirmar: true })`);
    return;
  }

  const rutBuscado = normalizeSearchLocal(rut || "").replace(/\./g, "").replace(/-/g, "");

  const candidatos = state.inscripciones.filter((item) => {
    if (!rutBuscado) return true;

    const docu = normalizeSearchLocal(getInscripcionDocumento(item))
      .replace(/\./g, "")
      .replace(/-/g, "");

    return docu.includes(rutBuscado);
  });

  if (!candidatos.length) {
    console.warn("No encontré inscripciones para archivar.", { rut });
    return;
  }

  const candidatosCompletos = [];

  for (const candidato of candidatos) {
    const completa =
      await obtenerInscripcionCompleta(
        candidato.id
      );
  
    if (completa) {
      candidatosCompletos.push(
        completa
      );
    }
  }
  
  if (
    candidatosCompletos.length !==
    candidatos.length
  ) {
    alert(
      "No fue posible cargar todas las fichas completas. No se realizará el archivo."
    );
  
    return;
  }

  console.table(candidatosCompletos.map((item) => ({
    id: item.id,
    documento: getInscripcionDocumento(item),
    nombre: buildNombreCompletoInscripcion(item),
    tipo: getEstadoOperativoInscripcionLabel(item)
  })));

  const ok = confirm(
    rutBuscado
      ? `¿Archivar ${candidatos.length} inscripción(es) asociadas al RUT ${rut}?`
      : `¿Archivar TODAS las inscripciones visibles de este grupo? Total: ${candidatos.length}`
  );

  if (!ok) return;

  const archivoId = `archivo_manual_${state.groupId}_${Date.now()}`;

  const archivoRef = doc(
    db,
    "ventas_cotizaciones",
    String(state.groupDocId),
    "inscripciones_archivadas",
    archivoId
  );

  await setDoc(archivoRef, {
    archivoId,
    tipoArchivo: rutBuscado ? "archivo_manual_por_rut" : "archivo_manual_masivo",
    idGrupo: String(state.groupId || ""),
    groupDocId: String(state.groupDocId || ""),
    rutBuscado: rut || "",
    motivo: motivo || "Archivo manual desde consola",

    totalInscritos:   candidatosCompletos.length,

    creadoPor: getDisplayName(state.effectiveUser),
    creadoPorCorreo: state.effectiveEmail,
    creadoAt: serverTimestamp(),

    inscripciones: candidatosCompletos.map((item) => ({
      id: item.id,
      documento: getInscripcionDocumento(item),
      nombre: buildNombreCompletoInscripcion(item),
      tipo: getEstadoOperativoInscripcionLabel(item),
      data: item
    }))
  });

  for (const item of candidatosCompletos) {
    const inscRef = doc(
      db,
      "ventas_cotizaciones",
      String(state.groupDocId),
      "inscripciones",
      String(item.id)
    );

    console.log("Archivando inscripción:", {
      id: item.id,
      documento: getInscripcionDocumento(item),
      nombre: buildNombreCompletoInscripcion(item)
    });

    await updateDoc(inscRef, {
      privacidad: {
        ...(item.privacidad || {}),
        estado: "archivada",
        archivoId,
        archivadaAt: serverTimestamp(),
        archivadaPor: getDisplayName(state.effectiveUser),
        archivadaPorCorreo: state.effectiveEmail,
        motivoArchivo: motivo || "Archivo manual desde consola"
      }
    });

    const alertaRef = doc(
      db,
      ALERTAS_INSCRIPCIONES_COLLECTION,
      getDocIdAlertaInscripcion(item.id)
    );
    
    await setDoc(alertaRef, {
      activa: false,
      resuelta: true,
      resueltaAt: serverTimestamp(),
      resueltaPor: getDisplayName(state.effectiveUser),
      resueltaPorCorreo: state.effectiveEmail,
      actualizadoAt: serverTimestamp()
    }, { merge: true });
  }

  await createHistoryEntry({
    tipoMovimiento: rutBuscado ? "inscripcion_archivada_por_rut" : "inscripciones_archivadas_masivo",
    modulo: "inscripcion",
    titulo: rutBuscado ? "Inscripción archivada por RUT" : "Inscripciones archivadas masivamente",
    mensaje: `${getDisplayName(state.effectiveUser)} archivó ${candidatosCompletos.length} inscripción(es) del grupo.`,
    metadata: {
      archivoId,
      rutBuscado: rut || "",
      motivo: motivo || "Archivo manual desde consola",
      totalArchivadas:
        candidatosCompletos.length,
      inscripciones: candidatosCompletos.map((item) => ({
        id: item.id,
        documento: getInscripcionDocumento(item),
        nombre: buildNombreCompletoInscripcion(item),
        tipo: getEstadoOperativoInscripcionLabel(item)
      }))
    }
  });

  await recargarNominaDespuesDeCambio();

  console.log(
    `Listo. Archivadas ${candidatosCompletos.length} inscripción(es). Archivo: ${archivoId}`
  );
};

window.borrarInscripcionesGrupo = async function ({ rut = "", confirmar = false } = {}) {
  if (!canEditarNominaInscripcion()) {
    console.error("No tienes permisos para borrar inscripciones.");
    return;
  }

  if (!confirmar) {
    console.warn("Debes ejecutar con confirmar:true");
    console.warn("Ejemplo borrar por RUT:");
    console.warn(`await borrarInscripcionesGrupo({ rut: "10121006-5", confirmar: true })`);
    console.warn("Ejemplo borrar TODOS:");
    console.warn(`await borrarInscripcionesGrupo({ confirmar: true })`);
    return;
  }

  const rutBuscado = normalizeSearchLocal(rut || "").replace(/\./g, "").replace(/-/g, "");

  const candidatos = state.inscripciones.filter((item) => {
    if (!rutBuscado) return true;

    const docu = normalizeSearchLocal(getInscripcionDocumento(item))
      .replace(/\./g, "")
      .replace(/-/g, "");

    return docu.includes(rutBuscado);
  });

  if (!candidatos.length) {
    console.warn("No encontré inscripciones para borrar.", { rut });
    return;
  }

  console.table(candidatos.map((item) => ({
    id: item.id,
    documento: getInscripcionDocumento(item),
    nombre: buildNombreCompletoInscripcion(item),
    tipo: getEstadoOperativoInscripcionLabel(item)
  })));

  const ok = confirm(
    rutBuscado
      ? `¿Borrar ${candidatos.length} inscripción(es) asociadas al RUT ${rut}?`
      : `¿Borrar TODAS las inscripciones visibles de este grupo? Total: ${candidatos.length}`
  );

  if (!ok) return;

  for (const item of candidatos) {
    const ref = doc(
      db,
      "ventas_cotizaciones",
      String(state.groupDocId),
      "inscripciones",
      String(item.id)
    );

    console.log("Borrando inscripción:", {
      id: item.id,
      documento: getInscripcionDocumento(item),
      nombre: buildNombreCompletoInscripcion(item)
    });

    await deleteDoc(ref);

    await sincronizarAlertaInscripcion({
      ...item,
      tipoInscripcion: "borrada",
      estadoCupo: "borrada"
    });
  }

  await createHistoryEntry({
    tipoMovimiento: rutBuscado ? "inscripcion_borrada_por_rut" : "inscripciones_borradas_masivo",
    modulo: "inscripcion",
    titulo: rutBuscado ? "Inscripción borrada por RUT" : "Inscripciones borradas masivamente",
    mensaje: `${getDisplayName(state.effectiveUser)} borró ${candidatos.length} inscripción(es) del grupo.`,
    metadata: {
      rutBuscado: rut || "",
      totalBorradas: candidatos.length,
      inscripciones: candidatos.map((item) => ({
        id: item.id,
        documento: getInscripcionDocumento(item),
        nombre: buildNombreCompletoInscripcion(item),
        tipo: getEstadoOperativoInscripcionLabel(item)
      }))
    }
  });

  await recargarNominaDespuesDeCambio();

  console.log(`Listo. Borradas ${candidatos.length} inscripción(es).`);
};

window.limpiarAlertasInscripcionesEliminadas = async function ({
  tipo = "todas",
  confirmar = false
} = {}) {
  if (!canEditarNominaInscripcion()) {
    console.error("No tienes permisos para limpiar alertas de inscripción.");
    return;
  }

  const tipoNormalizado = normalizeSearchLocal(tipo || "todas");

  const tiposPermitidos = {
    todas: [
      "nuevo_ingreso_pendiente",
      "lista_espera_pendiente",
      "lista_espera_pagada_pendiente_confirmar"
    ],

    nuevos: [
      "nuevo_ingreso_pendiente"
    ],

    lista_espera: [
      "lista_espera_pendiente",
      "lista_espera_pagada_pendiente_confirmar"
    ]
  };

  const tiposAlertaObjetivo =
    tiposPermitidos[tipoNormalizado] ||
    tiposPermitidos.todas;

  if (!confirmar) {
    console.warn("Esta función apagará alertas que ya no tienen una inscripción visible.");

    console.warn("Limpiar NUEVOS INGRESOS y LISTAS DE ESPERA:");
    console.warn(`
await limpiarAlertasInscripcionesEliminadas({
  tipo: "todas",
  confirmar: true
})
    `);

    console.warn("Limpiar solo NUEVOS INGRESOS:");
    console.warn(`
await limpiarAlertasInscripcionesEliminadas({
  tipo: "nuevos",
  confirmar: true
})
    `);

    console.warn("Limpiar solo LISTAS DE ESPERA:");
    console.warn(`
await limpiarAlertasInscripcionesEliminadas({
  tipo: "lista_espera",
  confirmar: true
})
    `);

    return;
  }

  console.log("[ALERTAS INSCRIPCIONES] Iniciando limpieza", {
    groupDocId: state.groupDocId,
    idGrupo: state.groupId,
    tipo,
    tiposAlertaObjetivo
  });

  /*
    state.inscripciones solo contiene inscripciones visibles.
    Las borradas ya no existen.
    Las archivadas quedan fuera por el filtro de loadInscripciones().
  */
  const idsInscripcionesActivas = new Set(
    state.inscripciones
      .map((item) => String(item.id || "").trim())
      .filter(Boolean)
  );

  const snap = await getDocs(
    collection(db, ALERTAS_INSCRIPCIONES_COLLECTION)
  );

  const alertasGrupo = snap.docs
    .map((docSnap) => ({
      id: docSnap.id,
      ...docSnap.data()
    }))
    .filter((alerta) => {
      const mismoGroupDocId =
        String(alerta.groupDocId || "").trim() ===
        String(state.groupDocId || "").trim();

      const mismoIdGrupo =
        String(alerta.idGrupo || "").trim() ===
        String(state.groupId || "").trim();

      return mismoGroupDocId || mismoIdGrupo;
    })
    .filter((alerta) => {
      if (alerta.activa === false) return false;
      if (alerta.resuelta === true) return false;

      return tiposAlertaObjetivo.includes(
        String(alerta.tipoAlerta || "").trim()
      );
    });

  const alertasHuerfanas = alertasGrupo.filter((alerta) => {
    const inscripcionId = String(alerta.inscripcionId || "").trim();

    // Alertas antiguas sin inscripcionId también se limpian.
    if (!inscripcionId) return true;

    return !idsInscripcionesActivas.has(inscripcionId);
  });

  console.log("[ALERTAS INSCRIPCIONES] Resultado revisión", {
    alertasActivasEncontradas: alertasGrupo.length,
    alertasHuerfanas: alertasHuerfanas.length,
    inscripcionesVisibles: idsInscripcionesActivas.size
  });

  if (!alertasHuerfanas.length) {
    console.log("No se encontraron alertas huérfanas para limpiar.");

    alert(
      `No se encontraron alertas huérfanas.\n\n` +
      `Alertas revisadas: ${alertasGrupo.length}`
    );

    return {
      revisadas: alertasGrupo.length,
      limpiadas: 0
    };
  }

  console.table(
    alertasHuerfanas.map((alerta) => ({
      alertaId: alerta.id,
      inscripcionId: alerta.inscripcionId || "SIN ID",
      tipoAlerta: alerta.tipoAlerta || "",
      participante: alerta.nombreParticipante || "Sin nombre",
      documento: alerta.documento || "",
      estadoCupo: alerta.estadoCupo || "",
      activa: alerta.activa,
      resuelta: alerta.resuelta
    }))
  );

  const ok = confirm(
    `Se encontraron ${alertasHuerfanas.length} alerta(s) ` +
    `sin una inscripción visible.\n\n` +
    `¿Quieres marcarlas como resueltas?`
  );

  if (!ok) {
    console.warn("Limpieza cancelada.");
    return;
  }

  let limpiadas = 0;
  let errores = 0;

  for (const alerta of alertasHuerfanas) {
    try {
      await setDoc(
        doc(db, ALERTAS_INSCRIPCIONES_COLLECTION, alerta.id),
        {
          activa: false,
          resuelta: true,

          motivoResolucion: "inscripcion_eliminada_o_archivada",
          resueltaAt: serverTimestamp(),
          resueltaPor: getDisplayName(state.effectiveUser),
          resueltaPorCorreo: state.effectiveEmail,

          actualizadoAt: serverTimestamp()
        },
        { merge: true }
      );

      limpiadas += 1;

      console.log("[ALERTA LIMPIADA]", {
        alertaId: alerta.id,
        inscripcionId: alerta.inscripcionId || "",
        tipoAlerta: alerta.tipoAlerta || "",
        participante: alerta.nombreParticipante || ""
      });
    } catch (error) {
      errores += 1;

      console.error("[ERROR LIMPIANDO ALERTA]", {
        alertaId: alerta.id,
        error
      });
    }
  }

  console.log("[ALERTAS INSCRIPCIONES] Limpieza finalizada", {
    alertasRevisadas: alertasGrupo.length,
    alertasLimpiadas: limpiadas,
    errores
  });

  alert(
    `Limpieza finalizada.\n\n` +
    `Alertas revisadas: ${alertasGrupo.length}\n` +
    `Alertas limpiadas: ${limpiadas}\n` +
    `Errores: ${errores}`
  );

  return {
    revisadas: alertasGrupo.length,
    limpiadas,
    errores
  };
};

window.recuperarInscripcionPublicaFallida = async function ({
  pendienteId = "",
  confirmar = true
} = {}) {
  const id = cleanText(pendienteId || "");

  if (!id) {
    console.error(
      "[RECUPERACIÓN INSCRIPCIÓN] Debes indicar pendienteId."
    );

    return null;
  }

  console.log(
    "[RECUPERACIÓN INSCRIPCIÓN] Revisando documento fallido...",
    {
      pendienteId: id
    }
  );

  try {
    // =====================================================================
    // 1. CARGAR DOCUMENTO FALLIDO
    // =====================================================================

    const pendienteRef = doc(
      db,
      "inscripciones_pendientes_publicas",
      id
    );

    const pendienteSnap = await getDoc(
      pendienteRef
    );

    if (!pendienteSnap.exists()) {
      console.error(
        "[RECUPERACIÓN INSCRIPCIÓN] No existe el documento indicado.",
        {
          pendienteId: id
        }
      );

      return null;
    }

    const pendiente =
      pendienteSnap.data() || {};

    // =====================================================================
    // 2. VALIDAR QUE REALMENTE SEA UN ERROR
    // =====================================================================

    if (
      normalizeSearchLocal(
        pendiente.estado || ""
      ) !== "error"
    ) {
      console.error(
        "[RECUPERACIÓN INSCRIPCIÓN] El documento no está en estado error.",
        {
          pendienteId: id,
          estado: pendiente.estado || ""
        }
      );

      return null;
    }

    const idGrupoPendiente =
      cleanText(
        pendiente.idGrupo || ""
      );

    const fase =
      cleanText(
        pendiente.fase ||
        pendiente.payload?.faseInscripcion ||
        ""
      );

    const payload =
      pendiente.payload || null;

    const token =
      cleanText(
        pendiente.token || ""
      );

    if (
      !idGrupoPendiente ||
      !fase ||
      !payload ||
      !token
    ) {
      console.error(
        "[RECUPERACIÓN INSCRIPCIÓN] El documento fallido no tiene toda la información necesaria.",
        {
          pendienteId: id,
          idGrupo: idGrupoPendiente,
          fase,
          tienePayload: !!payload,
          tieneToken: !!token
        }
      );

      return null;
    }

    // =====================================================================
    // 3. SEGURIDAD: DEBE CORRESPONDER AL GRUPO ABIERTO
    // =====================================================================

    const grupoActual =
      cleanText(
        state.groupDocId ||
        state.groupId ||
        ""
      );

    if (
      grupoActual &&
      idGrupoPendiente !== grupoActual &&
      idGrupoPendiente !==
        cleanText(state.groupId || "")
    ) {
      console.error(
        "[RECUPERACIÓN INSCRIPCIÓN] El documento pertenece a otro grupo.",
        {
          pendienteId: id,
          grupoDocumento:
            idGrupoPendiente,
          grupoAbierto:
            grupoActual
        }
      );

      return null;
    }

    // =====================================================================
    // 4. OBTENER IDENTIFICADOR DE LA INSCRIPCIÓN
    // =====================================================================

    const inscripcionId =
      cleanText(
        payload?.identificacion
          ?.documentoNormalizado ||
        ""
      );

    const nombre =
      cleanText(
        payload?.identificacion
          ?.nombreCompleto ||
        ""
      );

    const documento =
      cleanText(
        payload?.identificacion
          ?.documento ||
        ""
      );

    if (!inscripcionId) {
      console.error(
        "[RECUPERACIÓN INSCRIPCIÓN] El payload no tiene documentoNormalizado.",
        {
          pendienteId: id,
          documento,
          nombre
        }
      );

      return null;
    }

    // =====================================================================
    // 5. REVISAR SI LA INSCRIPCIÓN YA EXISTE
    // =====================================================================

    const inscripcionRef = doc(
      db,
      "ventas_cotizaciones",
      idGrupoPendiente,
      "inscripciones",
      inscripcionId
    );

    const inscripcionSnap =
      await getDoc(
        inscripcionRef
      );

    let inscripcionActual = null;
    let existeInscripcion = false;
    let estaAnulada = false;

    if (inscripcionSnap.exists()) {
      existeInscripcion = true;

      inscripcionActual = {
        id: inscripcionSnap.id,
        ...inscripcionSnap.data()
      };

      estaAnulada =
        estaInscripcionAnulada(
          inscripcionActual
        );
    }

    // =====================================================================
    // 6. DETERMINAR SI EL CASO PUEDE SER REPROCESADO
    // =====================================================================

    const faseNormalizada =
      normalizeSearchLocal(
        fase
      );

    const esFaseReingreso =
      faseNormalizada === "lista_espera" ||
      faseNormalizada === "nuevos";

    /*
      REGLA:

      - Si NO existe inscripción → se puede reprocesar.
      - Si existe y está ANULADA + es Lista de Espera/Nuevos → se puede reprocesar.
      - Si existe y está ACTIVA → bloquear.
    */

    const puedeReprocesar =
      !existeInscripcion ||
      (
        existeInscripcion &&
        estaAnulada &&
        esFaseReingreso
      );

    if (!puedeReprocesar) {
      console.warn(
        "[RECUPERACIÓN INSCRIPCIÓN] La inscripción ya existe y está activa. No se crea un nuevo pendiente.",
        {
          idGrupo:
            idGrupoPendiente,

          inscripcionId,

          nombre,

          documento,

          fase,

          estaAnulada
        }
      );

      return {
        ok: false,

        motivo:
          "inscripcion_ya_existe_activa",

        idGrupo:
          idGrupoPendiente,

        inscripcionId,

        nombre,

        documento,

        fase,

        estaAnulada
      };
    }

    // =====================================================================
    // 7. MOSTRAR DIAGNÓSTICO
    // =====================================================================

    console.table([
      {
        pendienteOriginal:
          id,

        idGrupo:
          idGrupoPendiente,

        fase,

        inscripcionId,

        documento,

        nombre,

        existeAnterior:
          existeInscripcion,

        anuladaAnterior:
          estaAnulada,

        tipoAnterior:
          inscripcionActual
            ?.tipoInscripcion ||
          "",

        estadoViajeAnterior:
          inscripcionActual
            ?.estadoViaje ||
          inscripcionActual
            ?.sistemaPagos
            ?.estadoViaje ||
          "",

        errorAnterior:
          pendiente.error || ""
      }
    ]);

    // =====================================================================
    // 8. CONFIRMACIÓN
    // =====================================================================

    if (confirmar) {
      const detalleAnterior =
        existeInscripcion
          ? (
              `\nREGISTRO ANTERIOR ENCONTRADO\n` +
              `Tipo anterior: ${
                inscripcionActual?.tipoInscripcion ||
                "(sin tipo)"
              }\n` +
              `Estado anterior: ${
                inscripcionActual?.estadoViaje ||
                inscripcionActual?.sistemaPagos?.estadoViaje ||
                "(sin estado)"
              }\n` +
              `Anulada: ${
                estaAnulada ? "SÍ" : "NO"
              }\n`
            )
          : (
              "\nNo existe una inscripción anterior.\n"
            );

      const ok = window.confirm(
        `RECUPERAR INSCRIPCIÓN FALLIDA\n\n` +
        `Grupo: ${idGrupoPendiente}\n` +
        `Fase: ${fase}\n` +
        `Pasajero: ${nombre || "(sin nombre)"}\n` +
        `Documento: ${documento || inscripcionId}\n` +
        `${detalleAnterior}\n` +
        `Error anterior:\n${pendiente.error || "(sin detalle)"}\n\n` +
        `Se creará un NUEVO documento pendiente para que la Cloud Function procese nuevamente el formulario original.\n\n` +
        (
          existeInscripcion && estaAnulada
            ? `El registro anterior está ANULADO y será recuperado por el flujo normal de ${fase === "lista_espera" ? "Lista de Espera" : "Nuevo Ingreso"}.\n\n`
            : ""
        ) +
        `El documento pendiente original NO será eliminado.\n\n` +
        `¿Continuar?`
      );

      if (!ok) {
        console.log(
          "[RECUPERACIÓN INSCRIPCIÓN] Cancelada por el usuario."
        );

        return null;
      }
    }

    // =====================================================================
    // 9. CREAR NUEVO PENDIENTE
    //
    // guardarInscripcionPublica utiliza onDocumentCreated.
    // Debe crearse un documento NUEVO.
    // =====================================================================

    const nuevoRef =
      await addDoc(
        collection(
          db,
          "inscripciones_pendientes_publicas"
        ),
        {
          idGrupo:
            idGrupoPendiente,

          token,

          fase,

          payload,

          estado:
            "pendiente",

          creadoEn:
            serverTimestamp(),

          origen:
            "recuperacion_manual_grupo_js",

          recuperacion: {
            activo: true,

            pendienteOriginalId:
              id,

            errorOriginal:
              cleanText(
                pendiente.error || ""
              ),

            errorOriginalEn:
              pendiente.errorEn || null,

            existiaInscripcionAnterior:
              existeInscripcion,

            inscripcionAnteriorAnulada:
              estaAnulada,

            tipoInscripcionAnterior:
              cleanText(
                inscripcionActual
                  ?.tipoInscripcion ||
                ""
              ),

            estadoViajeAnterior:
              cleanText(
                inscripcionActual
                  ?.estadoViaje ||
                inscripcionActual
                  ?.sistemaPagos
                  ?.estadoViaje ||
                ""
              ),

            recuperadoPor:
              getDisplayName(
                state.effectiveUser
              ),

            recuperadoPorCorreo:
              state.effectiveEmail || "",

            recuperadoEn:
              serverTimestamp()
          }
        }
      );

    // =====================================================================
    // 10. HISTORIAL
    // =====================================================================

    await createHistoryEntry({
      tipoMovimiento:
        "recuperacion_inscripcion_publica",

      modulo:
        "inscripcion",

      titulo:
        "Inscripción pública recuperada",

      mensaje:
        existeInscripcion && estaAnulada
          ? `${getDisplayName(state.effectiveUser)} reenvió para procesamiento una inscripción pública fallida de ${nombre || documento || inscripcionId}. El pasajero tenía un registro anterior anulado y será procesado nuevamente mediante ${fase === "lista_espera" ? "Lista de Espera" : "Nuevo Ingreso"}.`
          : `${getDisplayName(state.effectiveUser)} reenvió para procesamiento una inscripción pública que había quedado con error: ${nombre || documento || inscripcionId}.`,

      metadata: {
        pendienteOriginalId:
          id,

        nuevoPendienteId:
          nuevoRef.id,

        idGrupo:
          idGrupoPendiente,

        fase,

        inscripcionId,

        documento,

        nombre,

        errorOriginal:
          pendiente.error || "",

        existiaInscripcionAnterior:
          existeInscripcion,

        inscripcionAnteriorAnulada:
          estaAnulada,

        tipoInscripcionAnterior:
          inscripcionActual
            ?.tipoInscripcion ||
          "",

        estadoViajeAnterior:
          inscripcionActual
            ?.estadoViaje ||
          inscripcionActual
            ?.sistemaPagos
            ?.estadoViaje ||
          ""
      }
    });

    console.log(
      "✅ [RECUPERACIÓN INSCRIPCIÓN] Nuevo pendiente creado.",
      {
        pendienteOriginalId:
          id,

        nuevoPendienteId:
          nuevoRef.id,

        idGrupo:
          idGrupoPendiente,

        fase,

        inscripcionId,

        documento,

        nombre,

        existiaInscripcionAnterior:
          existeInscripcion,

        inscripcionAnteriorAnulada:
          estaAnulada
      }
    );

    console.log(
      "⏳ La Cloud Function guardarInscripcionPublica procesará ahora el nuevo documento."
    );

    return {
      ok: true,

      pendienteOriginalId:
        id,

      nuevoPendienteId:
        nuevoRef.id,

      idGrupo:
        idGrupoPendiente,

      fase,

      inscripcionId,

      documento,

      nombre,

      existiaInscripcionAnterior:
        existeInscripcion,

      inscripcionAnteriorAnulada:
        estaAnulada
    };

  } catch (error) {
    console.error(
      "❌ [RECUPERACIÓN INSCRIPCIÓN] Error inesperado:",
      error
    );

    return null;
  }
};

window.reenviarCorreoTransferenciaListaEspera = async function ({ rut = "", inscripcionId = "" } = {}) {
  const textoRut = normalizeSearchLocal(rut || "");
  const textoId = cleanText(inscripcionId || "");

  const item = state.inscripciones.find((x) => {
    if (textoId && x.id === textoId) return true;

    const docu = normalizeSearchLocal(getInscripcionDocumento(x));
    return textoRut && docu.includes(textoRut.replace(/\./g, "").replace(/-/g, ""));
  });

  if (!item) {
    console.warn("No se encontró inscripción para reenviar a transferencias.");
    return null;
  }

  const itemCompleto =
    await obtenerInscripcionCompleta(
      item.id
    );
  
  if (!itemCompleto) {
    console.warn(
      "No se pudo cargar la inscripción completa para reenviar a transferencias."
    );
  
    return null;
  }

  if (
    normalizeSearchLocal(
      getInscripcionTipoReal(itemCompleto)
    ) !== "lista_espera"
  ) {
    console.warn("Esta función solo aplica a inscripciones de lista de espera.");
    return null;
  }

  const ref = await addDoc(collection(db, "correos_inscripcion_pendientes"), {
    tipoEnvio: "solo_transferencias_lista_espera",
    origen: "consola_grupo_js",
    estado: "pendiente",

    destinatario: "transferencia@raitrai.cl",
    payload: itemCompleto,

    idGrupo: String(state.groupId || ""),
    groupDocId: String(state.groupDocId || ""),
    inscripcionId: String(item.id || ""),
    documento: getInscripcionDocumento(item),
    nombreParticipante: buildNombreCompletoInscripcion(item),

    creadoPor: getDisplayName(state.effectiveUser),
    creadoPorCorreo: state.effectiveEmail,
    creadoAt: serverTimestamp()
  });

  await createHistoryEntry({
    tipoMovimiento: "reenvio_transferencia_lista_espera",
    modulo: "inscripcion",
    titulo: "Reenvío interno lista de espera",
    mensaje: `${getDisplayName(state.effectiveUser)} reenvió a transferencia@raitrai.cl el correo interno de lista de espera de ${buildNombreCompletoInscripcion(item) || "una inscripción"}.`,
    metadata: {
      inscripcionId: item.id,
      documento: getInscripcionDocumento(item),
      correoDestino: "transferencia@raitrai.cl"
    }
  });

  console.log("Reenvío a transferencias generado:", ref.id);
  return ref.id;
};

window.reenviarCorreoNuevoIngresoRaiTrai = async function ({
  rut = "",
  inscripcionId = ""
} = {}) {
  const textoRut =
    normalizeSearchLocal(
      rut || ""
    );

  const textoId =
    cleanText(
      inscripcionId || ""
    );

  // =========================================================
  // BUSCAR INSCRIPCIÓN
  // =========================================================

  const item =
    state.inscripciones.find(
      (x) => {
        if (
          textoId &&
          x.id === textoId
        ) {
          return true;
        }

        const docu =
          normalizeSearchLocal(
            getInscripcionDocumento(x)
          );

        return (
          textoRut &&
          docu.includes(
            textoRut
              .replace(/\./g, "")
              .replace(/-/g, "")
          )
        );
      }
    );

  if (!item) {
    console.warn(
      "No se encontró inscripción para reenviar Nuevo Ingreso."
    );

    return null;
  }

  // =========================================================
  // CARGAR FICHA COMPLETA
  //
  // Necesitamos archivosEspeciales para adjuntar los carnets.
  // =========================================================

  const itemCompleto =
    await obtenerInscripcionCompleta(
      item.id
    );

  if (!itemCompleto) {
    console.warn(
      "No se pudo cargar la inscripción completa de Nuevo Ingreso."
    );

    return null;
  }

  // =========================================================
  // VALIDAR TIPO
  // =========================================================

  const tipo =
    normalizeSearchLocal(
      getInscripcionTipoReal(
        itemCompleto
      )
    );

  if (
    tipo !== "nuevo_ingreso"
  ) {
    console.warn(
      "Esta función solo aplica a inscripciones de Nuevo Ingreso.",
      {
        tipoEncontrado:
          tipo
      }
    );

    return null;
  }

  // =========================================================
  // CREAR CORREO PENDIENTE
  // =========================================================

  const ref =
    await addDoc(
      collection(
        db,
        "correos_inscripcion_pendientes"
      ),
      {
        tipoEnvio:
          "solo_raitrai_nuevo_ingreso",

        origen:
          "consola_grupo_js",

        estado:
          "pendiente",

        destinatario:
          "raitrai@raitrai.cl",

        payload:
          itemCompleto,

        idGrupo:
          String(
            state.groupId || ""
          ),

        groupDocId:
          String(
            state.groupDocId || ""
          ),

        inscripcionId:
          String(
            item.id || ""
          ),

        documento:
          getInscripcionDocumento(
            itemCompleto
          ),

        nombreParticipante:
          buildNombreCompletoInscripcion(
            itemCompleto
          ),

        creadoPor:
          getDisplayName(
            state.effectiveUser
          ),

        creadoPorCorreo:
          state.effectiveEmail,

        creadoAt:
          serverTimestamp()
      }
    );

  // =========================================================
  // HISTORIAL
  // =========================================================

  await createHistoryEntry({
    tipoMovimiento:
      "reenvio_interno_nuevo_ingreso",

    modulo:
      "inscripcion",

    titulo:
      "Reenvío interno Nuevo Ingreso",

    mensaje:
      `${getDisplayName(state.effectiveUser)} reenvió a raitrai@raitrai.cl el correo interno de Nuevo Ingreso de ${
        buildNombreCompletoInscripcion(
          itemCompleto
        ) ||
        "una inscripción"
      }.`,

    metadata: {
      inscripcionId:
        item.id,

      documento:
        getInscripcionDocumento(
          itemCompleto
        ),

      correoDestino:
        "raitrai@raitrai.cl"
    }
  });

  console.log(
    "✅ Reenvío Nuevo Ingreso generado:",
    {
      correoId:
        ref.id,

      destino:
        "raitrai@raitrai.cl",

      pasajero:
        buildNombreCompletoInscripcion(
          itemCompleto
        ),

      documento:
        getInscripcionDocumento(
          itemCompleto
        )
    }
  );

  return ref.id;
};

async function copyGroupInscripcionLink() {
  /*
    No permitimos copiar links antiguos que figuran
    activos en grupos importados desde Sistema de Pagos.
  */
  if (tieneProcesoPrincipalAntiguoInvalido()) {
    alert(
      "Este grupo todavía no tiene abierta la Nómina final / ficha médica."
    );

    return;
  }

  if (
    state.group?.inscripcionHabilitada !== true ||
    !state.group?.tokenInscripcion
  ) {
    alert(
      "Este grupo todavía no tiene un proceso principal habilitado."
    );

    return;
  }

  const fase =
    state.group?.inscripcion?.faseActual ||
    getInscripcionEstadoActual();

  const label =
    state.group?.inscripcion?.labelActual ||
    getInscripcionFaseLabel(fase);

  const link =
    getInscripcionPublicLink(
      state.groupId,
      state.group.tokenInscripcion,
      fase
    );

  try {
    await navigator.clipboard.writeText(
      link
    );

    showSaveNotice(
      `Link copiado: ${label}.`
    );
  } catch {
    alert(
      `No se pudo copiar automáticamente.\n\nCopia este link:\n\n${link}`
    );
  }
}

function canResetearCicloInscripcion() {
  const rol = String(
    state.effectiveUser?.rol || ""
  ).toLowerCase();

  const email = normalizeEmail(
    state.effectiveEmail || ""
  );

  return (
    rol === "admin" ||
    rol === "supervision" ||
    email === "chernandez@raitrai.cl"
  );
}

function canEditarNominaInscripcion() {
  const rol = String(state.effectiveUser?.rol || "").toLowerCase();
  const email = normalizeEmail(state.effectiveEmail || "");

  if (rol === "admin") return true;
  if (rol === "registro") return true;
  if (isGirasConPermisoAdministracion()) return true;

  if (
    email === "administracion@raitrai.cl" ||
    email === "yenny@raitrai.cl" ||
    email === "raitrai@raitrai.cl"
  ) {
    return true;
  }

  if (email === "chernandez@raitrai.cl") {
    return !state.group?.flowFicha?.jefaVentas?.firmado;
  }

  return false;
}

function canEditarRutYTipoInscripcionNomina() {
  return String(state.effectiveUser?.rol || "").toLowerCase() === "admin";
}

function getFaseResetInscripcionSeleccionada() {
  const seleccion = normalizeSearchLocal($("reset_tipo_ciclo")?.value || "auto");

  if (seleccion === "normal") return "normal";
  if (seleccion === "nomina_final") return "nomina_final";

  return grupoVieneSistemaAntiguo() ? "nomina_final" : "normal";
}

function openResetCicloInscripcionModal() {
  if (!canResetearCicloInscripcion()) {
    alert("Solo Admin o Jefa de Ventas puede resetear el ciclo de inscripción.");
    return;
  }

  setFormValue("reset_tipo_ciclo", "auto");
  setFormValue("reset_accion_inscritos", "conservar");
  setFormValue("reset_motivo", "");

  openModal("modalResetCicloInscripcion");
}

async function resetearCicloInscripcion() {
  if (!canResetearCicloInscripcion()) {
    alert("Solo Admin o Jefa de Ventas puede resetear el ciclo de inscripción.");
    return;
  }

  const faseNueva =
    getFaseResetInscripcionSeleccionada();
  
  const contexto =
    getContextoInscripcionGrupo(
      faseNueva
    );
  
  const accionInscritos =
    normalizeSearchLocal(
      $("reset_accion_inscritos")?.value ||
      "conservar"
    );
  
  const debeArchivar =
    accionInscritos === "archivar";
  
  const motivo =
    cleanText(
      $("reset_motivo")?.value || ""
    );
  
  /*
    Como la nómina ahora se carga bajo demanda,
    primero debemos consultarla antes de contar
    o archivar pasajeros.
  */
  if (
    debeArchivar &&
    !state.inscripcionesCargadas
  ) {
    const nominaCargada =
      await asegurarNominaCargada({
        mostrar: false,
        renderizar: false
      });
  
    if (!nominaCargada) {
      alert(
        "No fue posible cargar la nómina. El ciclo no será reseteado."
      );
  
      return;
    }
  }
  
  /*
    Si se archivarán inscritos, necesitamos
    los documentos completos y no solamente
    el resumen liviano.
  */
  if (
    debeArchivar &&
    state.inscripciones.length > 0
  ) {
    const cargadas =
      await cargarTodasLasInscripcionesCompletas({
        mostrarProgreso: true
      });
  
    if (!cargadas) {
      alert(
        "No fue posible cargar todas las fichas completas. El ciclo no será reseteado."
      );
  
      return;
    }
  }
  
  /*
    Se calcula después de cargar la nómina.
  */
  const totalInscritos =
    state.inscripciones.length;

  const mensajeConfirmacion = [
    "¿Confirmas resetear el ciclo de inscripción?",
    "",
    `Nuevo ciclo: ${contexto.labelFase}`,
    debeArchivar
      ? `Se archivarán ${totalInscritos} inscrito(s) y la nómina visible quedará limpia.`
      : "Se conservarán los inscritos actuales.",
    "",
    "Esta acción quedará registrada en el historial."
  ].join("\n");

  const ok = confirm(mensajeConfirmacion);
  if (!ok) return;

  const btn = $("btnConfirmarResetCicloInscripcion");
  if (btn) btn.disabled = true;

  try {
    const tokenNuevo = generateInscripcionToken(32);
    const linkNuevo = getInscripcionPublicLink(state.groupId, tokenNuevo, faseNueva);
    const archivoId = `reset_${state.groupId}_${Date.now()}`;

    if (debeArchivar && totalInscritos) {
      const archivoRef = doc(
        db,
        "ventas_cotizaciones",
        String(state.groupDocId),
        "inscripciones_archivadas",
        archivoId
      );

      await setDoc(archivoRef, {
        archivoId,
        tipoArchivo: "reset_ciclo_inscripcion",
        idGrupo: String(state.groupId || ""),
        groupDocId: String(state.groupDocId || ""),

        faseAnterior: getInscripcionEstadoActual(),
        faseNueva,
        labelFaseNueva: contexto.labelFase,

        totalInscritos,
        motivo: motivo || "Reset ciclo inscripción",

        creadoPor: getDisplayName(state.effectiveUser),
        creadoPorCorreo: state.effectiveEmail,
        creadoAt: serverTimestamp()
      });

      for (const item of state.inscripciones) {
        const inscRef = doc(
          db,
          "ventas_cotizaciones",
          String(state.groupDocId),
          "inscripciones",
          String(item.id)
        );

        await updateDoc(inscRef, {
          privacidad: {
            ...(item.privacidad || {}),
            estado: "archivada",
            archivoId,
            archivadaAt: serverTimestamp(),
            archivadaPor: getDisplayName(state.effectiveUser),
            archivadaPorCorreo: state.effectiveEmail,
            motivoArchivo: motivo || "Reset ciclo inscripción"
          }
        });
      }
    }

    await saveGroupPatch(
      {
        inscripcionHabilitada: true,
        tokenInscripcion: tokenNuevo,
        inscripcionEstado: faseNueva,
        faseInscripcion: faseNueva,

        fechaAperturaInscripcion: serverTimestamp(),

        inscripcion: {
          ...(state.group?.inscripcion || {}),
          estado: faseNueva,
          faseActual: faseNueva,

          claveActual: contexto.clave,
          labelActual: contexto.labelFase,
          tipoInscripcionActual: contexto.tipoInscripcion,
          estadoCupoActual: contexto.estadoCupo,

          tokenActual: tokenNuevo,
          linkActual: linkNuevo,

          resetCicloAt: serverTimestamp(),
          resetCicloPor: getDisplayName(state.effectiveUser),
          resetCicloPorCorreo: state.effectiveEmail,
          resetCicloMotivo: motivo || "",
          resetCicloArchivoId: debeArchivar ? archivoId : "",
          resetCicloArchivoInscritos: debeArchivar,

          actualizadoPor: getDisplayName(state.effectiveUser),
          actualizadoPorCorreo: state.effectiveEmail,
          actualizadoAt: serverTimestamp(),

          linkGeneradoPor: getDisplayName(state.effectiveUser),
          linkGeneradoPorCorreo: state.effectiveEmail,
          linkGeneradoAt: serverTimestamp()
        }
      },
      {
        tipoMovimiento: "reset_ciclo_inscripcion",
        modulo: "inscripcion",
        titulo: "Reset de ciclo de inscripción",
        mensaje: `${getDisplayName(state.effectiveUser)} reseteó el ciclo de inscripción a "${contexto.labelFase}". ${
          debeArchivar
            ? `Se archivaron ${totalInscritos} inscrito(s).`
            : "Se conservaron los inscritos actuales."
        }${motivo ? ` Motivo: ${motivo}` : ""}`,
        metadata: {
          faseNueva,
          labelFaseNueva: contexto.labelFase,
          archivoId: debeArchivar ? archivoId : "",
          inscritosArchivados: debeArchivar ? totalInscritos : 0,
          inscritosConservados: debeArchivar ? 0 : totalInscritos
        }
      }
    );

    try {
      await navigator.clipboard.writeText(linkNuevo);
      showSaveNotice("Ciclo reseteado y nuevo link copiado.");
    } catch {
      showSaveNotice("Ciclo reseteado correctamente.");
      alert(`Nuevo link:\n\n${linkNuevo}`);
    }

    closeModal("modalResetCicloInscripcion");
    await loadAll();
  } catch (error) {
    console.error("[grupo] resetearCicloInscripcion", error);
    alert("Error al resetear ciclo de inscripción: " + error.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

function normalizarTextoExport(value = "") {
  const limpio = String(value || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ");

  if (!limpio) return "";

  return limpio
    .split(" ")
    .map((p) => p ? p.charAt(0).toUpperCase() + p.slice(1) : "")
    .join(" ");
}

function soloDigitos(value = "") {
  return String(value || "").replace(/\D/g, "");
}

function normalizarRutExport(value = "") {
  const limpio = String(value || "")
    .trim()
    .replace(/\./g, "")
    .replace(/-/g, "")
    .replace(/\s+/g, "")
    .toUpperCase();

  if (limpio === "—") return "";

  return limpio;
}

function normalizarTipoPasajeroExport(item = {}) {
  const tipoRaw = item.tipoViajante || item.tipoParticipacion || "";
  const tipoKey = normalizeSearchLocal(tipoRaw);

  return tipoKey === "estudiante" ? "Estudiante" : "Adulto";
}

function normalizarNacionalidadExport(item = {}) {
  const raw = getInscripcionNacionalidad(item);
  const partes = String(raw || "")
    .split(/[,;/|]+|\s+y\s+/i)
    .map((x) => normalizarTextoExport(x))
    .filter(Boolean);

  if (!partes.length) return "";

  const chilena = partes.find((x) => normalizeSearchLocal(x) === "chilena");
  if (chilena) return "Chilena";

  return partes[0];
}

function getCantidadLiberadosAnonimosExport() {
  const raw =
    state.group?.liberados ??
    state.group?.cantidadLiberados ??
    state.group?.ficha?.liberados ??
    state.group?.ficha?.cantidadLiberados ??
    0;

  const numero = Number(String(raw).replace(",", "."));

  if (!Number.isFinite(numero) || numero <= 0) return 0;

  return Math.ceil(numero);
}

function buildInscripcionesExportRows() {
  const items = state.inscripciones.filter(esNominaFinalOperativa);

  const rows = items.map((item, index) => ({
    "Numero": index + 1,

    "1.- Rut": normalizarRutExport(getInscripcionDocumento(item)),

    "2.- Apellidos del Alumno": normalizarTextoExport(getInscripcionApellidos(item)),

    "3.- Nombre del Alumno": normalizarTextoExport(getInscripcionNombres(item)),

    "4.- Fecha Nacimiento": formatDateOnlyForTable(
      getByPath(item, "identificacion.fechaNacimiento")
    ),

    "5.- Tipo Pasajero": normalizarTipoPasajeroExport(item),

    "6.- Nacionalidad": normalizarNacionalidadExport(item),

    "7.- Sexo": normalizarTextoExport(getInscripcionGenero(item)),

    "8.- Nombre del Apoderado": normalizarTextoExport(getResponsablePrincipalNombre(item)),

    "9.- Correo del Apoderado":
      getByPath(item, "contactoPrincipal.correo") || "",

    "10.- Celular Apoderado": soloDigitos(
      getByPath(item, "contactoPrincipal.celular") ||
      getByPath(item, "contactoPrincipal.telefono") ||
      getByPath(item, "contactoPrincipal.whatsapp") ||
      ""
    )
  }));

  const cantidadLiberadosAnonimos = getCantidadLiberadosAnonimosExport();

  for (let i = 0; i < cantidadLiberadosAnonimos; i += 1) {
    rows.push({
      "Numero": rows.length + 1,

      "1.- Rut": "",

      "2.- Apellidos del Alumno": "",

      "3.- Nombre del Alumno": `Apoderado ${i + 1}`,

      "4.- Fecha Nacimiento": "",

      "5.- Tipo Pasajero": "Adulto",

      "6.- Nacionalidad": "",

      "7.- Sexo": "",

      "8.- Nombre del Apoderado": "",

      "9.- Correo del Apoderado": "",

      "10.- Celular Apoderado": ""
    });
  }

  return rows;
}

function downloadTextFile(filename, content, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();

  a.remove();
  URL.revokeObjectURL(url);
}

function exportarInscripcionesCsv() {
  const rows = buildInscripcionesExportRows();

  if (!puedeExportarCsvInscripciones()) {
    alert("Solo Registro, Administración o Admin pueden exportar CSV.");
    return;
  }

  if (!rows.length) {
    alert("No hay inscripciones para exportar.");
    return;
  }

  const headers = Object.keys(rows[0]);

  const csv = [
    headers.join(";"),
    ...rows.map((row) =>
      headers.map((key) => {
        const value = String(row[key] ?? "").replaceAll('"', '""');
        return `"${value}"`;
      }).join(";")
    )
  ].join("\n");

  const nombre = `inscripciones_${state.groupId}_${new Date().toISOString().slice(0, 10)}.csv`;
  downloadTextFile(nombre, csv, "text/csv;charset=utf-8");
}

function exportarInscripcionesExcel() {
  const rows = buildInscripcionesExportRows();

  if (!rows.length) {
    alert("No hay inscripciones para exportar.");
    return;
  }

  const headers = Object.keys(rows[0]);

  const html = `
    <html>
      <head>
        <meta charset="UTF-8" />
      </head>
      <body>
        <table>
          <thead>
            <tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr>
          </thead>
          <tbody>
            ${rows.map((row) => `
              <tr>
                ${headers.map((h) => `<td>${escapeHtml(row[h] ?? "")}</td>`).join("")}
              </tr>
            `).join("")}
          </tbody>
        </table>
      </body>
    </html>
  `;

  const nombre = `inscripciones_${state.groupId}_${new Date().toISOString().slice(0, 10)}.xls`;
  downloadTextFile(nombre, html, "application/vnd.ms-excel;charset=utf-8");
}

function prioritizeFichaPanelInLayout() {
  const fichaPanel = $("panelFichaViaje");
  const datosPanel = $("panelDatosGrupo");

  if (!fichaPanel || !datosPanel) return;
  if (!fichaPanel.parentElement || fichaPanel.parentElement !== datosPanel.parentElement) return;

  const parent = fichaPanel.parentElement;

  // Si está ganada, la ficha pasa a ser más importante visualmente.
  if (normalizeState(state.group?.estado) === "ganada") {
    parent.insertBefore(fichaPanel, datosPanel);
    return;
  }

  // En cualquier otro estado, dejamos primero los datos.
  parent.insertBefore(datosPanel, fichaPanel);
}

function getFichaMainButtonMode() {
  const ficha = getFichaSummary();
  const isGanada = canCreateFichaFromEstado();
  const editable = canEditGroup();
  const vendorLocked = isVendorLockedByFlow(state.group);

  // Regla única y coherente:
  // la ficha solo se puede abrir cuando el grupo está GANADA.
  if (!isGanada) {
    return {
      label: ficha.exists ? "Ficha bloqueada" : "Crear ficha",
      disabled: true
    };
  }

  // Si el vendedor ya firmó, desde grupo solo debe verla.
  if (vendorLocked) {
    return {
      label: "Ver ficha",
      disabled: false
    };
  }

  // Si está ganada, crear o editar según exista.
  if (editable) {
    return {
      label: ficha.exists ? "Editar ficha" : "Crear ficha",
      disabled: false
    };
  }

  // Si no puede editar pero sí está ganada y ya existe, puede verla.
  if (ficha.exists) {
    return {
      label: "Ver ficha",
      disabled: false
    };
  }

  return {
    label: "Crear ficha",
    disabled: true
  };
}

/* =========================================================
   RENDER
========================================================= */
/* =========================================================
   NÓMINA INICIAL · SISTEMA DE PAGOS
========================================================= */

function esInscripcionSistemaPagos(item = {}) {
  return normalizeSearchLocal(getInscripcionTipoReal(item)) === "sistema_pagos";
}

function getCorreoVendedoraGrupoParaCopia() {
  const vendedor = normalizeSearchLocal(state.group?.vendedora || "");

  const MAP_VENDEDORAS_CORREO = [
    { claves: ["giselle"], correo: "griveros@raitrai.cl" },
    { claves: ["elias"], correo: "elagos@raitrai.cl" },
    { claves: ["claudio"], correo: "crojas@raitrai.cl" },
    { claves: ["alejandra"], correo: "aflores@raitrai.cl" },
    { claves: ["orietta"], correo: "orietta@raitrai.cl" },
    { claves: ["carolina", "carola"], correo: "ccayoso@raitrai.cl" },
    { claves: ["juan pablo", "juanpablo"], correo: "jpino@raitrai.cl" }
  ];

  const match = MAP_VENDEDORAS_CORREO.find((item) =>
    item.claves.some((clave) => vendedor.includes(normalizeSearchLocal(clave)))
  );

  return match?.correo || "";
}

function getInscripcionesNominaInicial() {
  return state.inscripciones.filter((item) => {
    const tipo = normalizeSearchLocal(getInscripcionTipoReal(item));
    const fase = normalizeSearchLocal(item.faseInscripcion || item?.meta?.faseInscripcion || "");
    const estado = normalizeSearchLocal(item.estadoInscripcion || "");
    const label = normalizeSearchLocal(getEstadoOperativoInscripcionLabel(item));

    return (
      tipo === "nomina_inicial" ||
      tipo === "inscripcion_inicial" ||
      tipo === "inscripcion_comercial" ||
      (
        tipo !== "sistema_pagos" &&
        fase === "normal"
      ) ||
      (
        tipo !== "sistema_pagos" &&
        estado === "normal"
      ) ||
      label === "inscripcion_inicial"
    );
  });
}

function getEstadoNominaInicialPagos() {
  const pagos = state.group?.sistemaPagos?.nominaInicial || {};
  return {
    cargada: pagos.cargada === true,
    totalInscripciones: Number(pagos.totalInscripciones || 0),
    totalCorreos: Number(pagos.totalCorreos || 0),
    cargadaAt: pagos.cargadaAt || null,
    cargadaPor: pagos.cargadaPor || "",
    batchId: pagos.batchId || ""
  };
}

function buildNombreCompletoInscripcion(item = {}) {
  return [
    getInscripcionNombres(item),
    getInscripcionApellidos(item)
  ]
    .filter((x) => x && x !== "—")
    .join(" ")
    .trim();
}

function estaInscripcionAnulada(item = {}) {
  const estadoViaje = normalizeSearchLocal(
    item.estadoViaje || ""
  );

  return (
    item.anulado === true ||
    item.viaja === false ||
    estadoViaje === "no_viaja"
  );
}

function estaInscripcionActiva(item = {}) {
  return !estaInscripcionAnulada(item);
}

function getMotivoAnulacionInscripcion(item = {}) {
  if (!estaInscripcionAnulada(item)) {
    return "";
  }

  const motivo = normalizeSearchLocal(
    item.motivoAnulacion || ""
  );

  if (
    motivo === "no_viaja_sistema_pagos" ||
    item.viaja === false ||
    normalizeSearchLocal(item.estadoViaje || "") === "no_viaja"
  ) {
    return "No viaja según Sistema de Pagos";
  }

  if (motivo === "eliminado_sistema_pagos") {
    return "Eliminado en Sistema de Pagos";
  }

  return cleanText(item.motivoAnulacion || "") ||
    "Pasajero anulado";
}

function getEstadoViajeInscripcionHtml(item = {}) {
  if (!estaInscripcionAnulada(item)) {
    return "";
  }

  return `
    <div class="inscripcion-anulada-box">
      <span class="inscripcion-anulada-badge">
        ANULADO
      </span>

      <span class="inscripcion-anulada-motivo">
        ${escapeHtml(getMotivoAnulacionInscripcion(item))}
      </span>
    </div>
  `;
}

function asegurarEstilosInscripcionesAnuladas() {
  if (
    document.getElementById(
      "estilosInscripcionesAnuladas"
    )
  ) {
    return;
  }

  const style =
    document.createElement("style");

  style.id =
    "estilosInscripcionesAnuladas";

  style.textContent = `
    .inscripcion-table tr.inscripcion-anulada-row > td {
      background: #eeeeee !important;
      color: #686868 !important;
      opacity: 0.9;
    }

    .inscripcion-table tr.inscripcion-anulada-row:hover > td {
      background: #e4e4e4 !important;
    }

    .inscripcion-table tr.inscripcion-anulada-row .inscripcion-doc-link {
      color: #5f5f5f !important;
    }

    .inscripcion-anulada-box {
      margin-top: 7px;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
    }

    .inscripcion-anulada-badge {
      display: inline-flex;
      align-items: center;
      min-height: 22px;
      padding: 3px 8px;
      border-radius: 999px;
      background: #626262;
      color: #ffffff;
      font-size: 10px;
      font-weight: 900;
      letter-spacing: 0.05em;
    }

    .inscripcion-anulada-motivo {
      color: #5f5f5f;
      font-size: 11px;
      font-weight: 700;
      line-height: 1.25;
    }
  `;

  document.head.appendChild(style);
}

function getTipoAlertaInscripcionHome(item = {}) {
  /*
    Una persona que aún no existe en Sistema de Pagos
    puede seguir normalmente como inscripción inicial,
    nuevo ingreso o lista de espera.

    Solo se cierra la alerta cuando existe una
    anulación explícita.
  */
  if (estaInscripcionAnulada(item)) {
    return "";
  }

  const tipo =
    normalizeSearchLocal(
      getInscripcionTipoReal(item)
    );

  const estadoCupo =
    normalizeSearchLocal(
      item.estadoCupo || ""
    );

  if (
    tipo === "nuevo_ingreso" &&
    estadoCupo !== "confirmado"
  ) {
    return "nuevo_ingreso_pendiente";
  }

  if (
    tipo === "lista_espera" &&
    estadoCupo !== "pagado" &&
    estadoCupo !== "confirmado"
  ) {
    return "lista_espera_pendiente";
  }

  if (
    tipo === "lista_espera_pagada" ||
    (
      tipo === "lista_espera" &&
      estadoCupo === "pagado"
    )
  ) {
    return "lista_espera_pagada_pendiente_confirmar";
  }

  return "";
}

function getDocIdAlertaInscripcion(inscripcionId = "") {
  return `${String(state.groupDocId || state.groupId || "").trim()}_${String(inscripcionId || "").trim()}`;
}

function buildPayloadAlertaInscripcion(
  item = {},
  tipoAlerta = ""
) {
  const nombreParticipante =
    buildNombreCompletoInscripcion(item);

  const nombreResponsable =
    getResponsablePrincipalNombre(item);

  const correoResponsable =
    normalizeEmail(
      getByPath(
        item,
        "contactoPrincipal.correo"
      ) || ""
    );

  const telefonoResponsable =
    getByPath(
      item,
      "contactoPrincipal.celular"
    ) ||
    getByPath(
      item,
      "contactoPrincipal.telefono"
    ) ||
    getByPath(
      item,
      "contactoPrincipal.whatsapp"
    ) ||
    "";

  return {
    activa: true,
    resuelta: false,

    tipoAlerta,
    tipoInscripcion:
      getInscripcionTipoReal(item),

    estadoCupo:
      item.estadoCupo || "",

    /*
      Copia liviana del estado de viaje.

      Home e Index pueden filtrar anulados
      sin descargar la inscripción completa.
    */
    viaja:
      item.viaja !== false,

    anulado:
      estaInscripcionAnulada(item),

    estadoViaje:
      item.estadoViaje || "",

    motivoAnulacion:
      item.motivoAnulacion || "",

    idGrupo:
      String(state.groupId || ""),

    groupDocId:
      String(state.groupDocId || ""),

    inscripcionId:
      String(item.id || ""),

    anoViaje:
      cleanText(
        state.group?.anoViaje || ""
      ),

    colegio:
      cleanText(
        state.group?.colegio || ""
      ),

    curso:
      cleanText(
        state.group?.curso || ""
      ),

    aliasGrupo:
      cleanText(
        state.group?.aliasGrupo
      ) ||
      cleanText(
        state.group?.nombreGrupo
      ) ||
      cleanText(
        state.group?.colegio
      ) ||
      String(state.groupId || ""),

    vendedora:
      cleanText(
        state.group?.vendedora ||
        state.group?.vendedoraCorreo ||
        ""
      ),

    vendedoraCorreo:
      normalizeEmail(
        state.group?.vendedoraCorreo || ""
      ),

    documento:
      getInscripcionDocumento(item),

    nombreParticipante,
    nombreResponsable,
    correoResponsable,
    telefonoResponsable,

    fechaFormulario:
      getFechaFormularioInscripcion(item) ||
      null,

    actualizadoAt:
      serverTimestamp(),

    actualizadoPor:
      getDisplayName(
        state.effectiveUser
      ),

    actualizadoPorCorreo:
      state.effectiveEmail
  };
}

async function sincronizarAlertaInscripcion(
  item = {}
) {
  if (!item?.id) {
    return;
  }

  const tipoAlerta =
    getTipoAlertaInscripcionHome(item);

  const alertaId =
    getDocIdAlertaInscripcion(
      item.id
    );

  const ref =
    doc(
      db,
      ALERTAS_INSCRIPCIONES_COLLECTION,
      alertaId
    );

  /*
    Si está anulado o ya no tiene un estado
    pendiente, cerramos la alerta existente.
  */
  if (!tipoAlerta) {
    await setDoc(
      ref,
      {
        activa: false,
        resuelta: true,

        tipoInscripcion:
          getInscripcionTipoReal(item),

        estadoCupo:
          item.estadoCupo || "",

        viaja:
          item.viaja !== false,

        anulado:
          estaInscripcionAnulada(item),

        estadoViaje:
          item.estadoViaje || "",

        motivoAnulacion:
          item.motivoAnulacion || "",

        motivoResolucion:
          estaInscripcionAnulada(item)
            ? "pasajero_anulado"
            : "estado_inscripcion_resuelto",

        idGrupo:
          String(state.groupId || ""),

        groupDocId:
          String(state.groupDocId || ""),

        inscripcionId:
          String(item.id || ""),

        resueltaAt:
          serverTimestamp(),

        resueltaPor:
          getDisplayName(
            state.effectiveUser
          ),

        resueltaPorCorreo:
          state.effectiveEmail,

        actualizadoAt:
          serverTimestamp()
      },
      {
        merge: true
      }
    );

    return;
  }

  await setDoc(
    ref,
    buildPayloadAlertaInscripcion(
      item,
      tipoAlerta
    ),
    {
      merge: true
    }
  );
}

async function sincronizarAlertasInscripcionesGrupo() {
  for (const item of state.inscripciones) {
    await sincronizarAlertaInscripcion(item);
  }
}

function getCorreoViajanteAdulto(item = {}) {
  return normalizeEmail(
    getByPath(item, "contactoViajante.correo") ||
    getByPath(item, "viajante.correo") ||
    getByPath(item, "identificacion.correo") ||
    getByPath(item, "contacto.correo") ||
    ""
  );
}

function getDestinatarioNominaInicial(item = {}) {
  const tipo = normalizeSearchLocal(item.tipoViajante || item.tipoParticipacion || "");
  const esEstudiante = !tipo || tipo === "estudiante";

  const nombreParticipante = buildNombreCompletoInscripcion(item);
  const documento = getInscripcionDocumento(item);

  const responsableNombre = getResponsablePrincipalNombre(item);
  const correoResponsable = normalizeEmail(getByPath(item, "contactoPrincipal.correo") || "");

  const correoAdulto = getCorreoViajanteAdulto(item);

  const correo = esEstudiante
    ? correoResponsable
    : (correoAdulto || correoResponsable);

  const nombreResponsable = esEstudiante
    ? responsableNombre
    : (nombreParticipante || responsableNombre);

  return {
    inscripcionId: item.id,
    item,
    nombreParticipante,
    documento,
    nombreResponsable,
    correo,
    estado: correo ? "listo" : "sin_correo"
  };
}

function buildDestinatariosNominaInicial() {
  const base = [
    ...getInscripcionesNominaInicial(),
    ...getInscripcionesSistemaPagos()
  ];

  const vistos = new Set();

  return base
    .filter((item) => {
      const key = item.id || getInscripcionDocumento(item);
      if (vistos.has(key)) return false;
      vistos.add(key);
      return true;
    })
    .map(getDestinatarioNominaInicial);
}

function buildAsuntoNominaInicialPagos() {
  const colegio = normalizeTextUpper(state.group?.colegio || "");
  const curso = normalizeTextUpper(state.group?.curso || "");
  const ano = cleanText(state.group?.anoViaje || "");

  return `Sistema de pagos habilitado · ${[colegio, curso, ano].filter(Boolean).join(" ")}`.trim();
}

function buildCuerpoNominaInicialPagos() {
  const grupo =
    cleanText(state.group?.aliasGrupo) ||
    cleanText(state.group?.nombreGrupo) ||
    normalizeTextUpper(state.group?.colegio || "");

  return `
Junto con saludar, informamos que la inscripción inicial del viaje de estudios ${grupo ? `del grupo ${grupo}` : ""} ya fue cargada en el sistema de pagos de Turismo Rai Trai.

Desde ahora podrá ingresar al portal de pagos:

https://pagos.turismoraitrai.cl/payment/

Para acceder debe utilizar:
Usuario: RUT del/de la viajante.
Contraseña: últimos 4 dígitos del RUT.

En el sistema podrá revisar y efectuar los pagos correspondientes al viaje de estudios.

Saludos cordiales,
Turismo Rai Trai
`.trim();
}

function setNominaPagosProgress(done = 0, total = 0) {
  const pct = total ? Math.round((done / total) * 100) : 0;

  setText("nominaPagosProgresoTxt", `${done} / ${total}`);
  const bar = $("nominaPagosProgresoBar");
  if (bar) bar.style.width = `${pct}%`;
}

function renderNominaPagosDestinatarios(destinatarios = []) {
  const tbody = $("nominaPagosDestinatariosBody");
  if (!tbody) return;

  tbody.innerHTML = destinatarios.map((d, index) => `
    <tr>
      <td>${index + 1}</td>
      <td>${escapeHtml(d.nombreParticipante || "—")}</td>
      <td>${escapeHtml(d.nombreResponsable || "—")}</td>
      <td>${escapeHtml(d.correo || "—")}</td>
      <td>${d.correo ? "Listo" : "Sin correo"}</td>
    </tr>
  `).join("");
}

function openNominaInicialPagosModal() {
  if (!puedeOperarListaEsperaAdministrativa()) {
    alert("Solo Registro, Administración o Admin pueden realizar esta acción.");
    return;
  }

  const destinatarios = buildDestinatariosNominaInicial();
  const validos = destinatarios.filter((d) => d.correo);
  const sinCorreo = destinatarios.filter((d) => !d.correo);

  if (!destinatarios.length) {
    const rol = String(state.effectiveUser?.rol || "").toLowerCase();
  
    if (rol === "admin") {
      alert("No hay inscripciones iniciales para cargar a pagos. Revisa Editar Nómina y cambia el Tipo inscripción a Inscripción inicial si corresponde.");
    } else {
      alert("No hay inscripciones iniciales para este grupo.");
    }
  
    return;
  }

  const correoVendedoraCopia = getCorreoVendedoraGrupoParaCopia();
  
  setText(
    "nominaPagosResumen",
    `Grupo: ${state.group?.aliasGrupo || state.group?.nombreGrupo || state.group?.colegio || state.groupId}
  Participantes inscripción inicial: ${destinatarios.length}
  Correos válidos: ${validos.length}
  Sin correo: ${sinCorreo.length}
  Resumen a vendedora: ${correoVendedoraCopia || "No detectada"}`
  );

  setFormValue("nominaPagosAsunto", buildAsuntoNominaInicialPagos());
  setFormValue("nominaPagosCuerpo", buildCuerpoNominaInicialPagos());

  renderNominaPagosDestinatarios(destinatarios);
  setNominaPagosProgress(0, validos.length);

  openModal("modalNominaInicialPagos");
}

async function enviarNominaInicialPagos() {
  if (!puedeOperarListaEsperaAdministrativa()) {
    alert("Solo Registro, Administración o Admin pueden realizar esta acción.");
    return;
  }

  const asunto = String($("nominaPagosAsunto")?.value || "").trim();
  const cuerpo = String($("nominaPagosCuerpo")?.value || "").trim();

  if (!asunto || !cuerpo) {
    alert("Debes ingresar asunto y cuerpo del correo.");
    return;
  }

  const destinatarios = buildDestinatariosNominaInicial();
  const validos = destinatarios.filter((d) => d.correo);
  const sinCorreo = destinatarios.filter((d) => !d.correo);

  if (!validos.length) {
    alert("No hay correos válidos para enviar.");
    return;
  }

  const ok = confirm(`Se enviarán ${validos.length} correos. ${sinCorreo.length} participantes serán omitidos por no tener correo. ¿Continuar?`);
  if (!ok) return;

  const btn = $("btnEnviarNominaInicialPagos");
  if (btn) btn.disabled = true;

  const batchId = `nomina_inicial_pagos_${state.groupId}_${Date.now()}`;
  let enviados = 0;

  try {
    for (const d of validos) {
      await addDoc(collection(db, "correos_nomina_inicial_pagos"), {
        batchId,
        estado: "pendiente",

        destinatario: d.correo,
        to: d.correo,
        asunto,
        subject: asunto,
        cuerpo,
        body: cuerpo,

        idGrupo: String(state.groupId || ""),
        groupDocId: String(state.groupDocId || ""),
        inscripcionId: d.inscripcionId,

        grupo:
          cleanText(state.group?.aliasGrupo) ||
          cleanText(state.group?.nombreGrupo) ||
          normalizeTextUpper(state.group?.colegio || ""),

        colegio: normalizeTextUpper(state.group?.colegio || ""),
        curso: normalizeTextUpper(state.group?.curso || ""),
        anoViaje: cleanText(state.group?.anoViaje || ""),
        documento: d.documento,
        nombreParticipante: d.nombreParticipante,
        nombreResponsable: d.nombreResponsable,

        creadoPor: getDisplayName(state.effectiveUser),
        creadoPorCorreo: state.effectiveEmail,
        creadoAt: serverTimestamp()
      });

      const inscRef = doc(
        db,
        "ventas_cotizaciones",
        String(state.groupDocId),
        "inscripciones",
        String(d.inscripcionId)
      );

      const esSistemaPagos = esInscripcionSistemaPagos(d.item);
      
      const patchCorreoPagos = esSistemaPagos
        ? {
            "sistemaPagos.correoPagosEnviado": true,
            "sistemaPagos.correoPagosEnviadoAt": serverTimestamp(),
            "sistemaPagos.correoPagosEnviadoPor": getDisplayName(state.effectiveUser),
            "sistemaPagos.correoPagosEnviadoPorCorreo": state.effectiveEmail,
            "sistemaPagos.correoPagosBatchId": batchId,
            "sistemaPagos.correoPagosDestinatario": d.correo
          }
        : {
            "sistemaPagos.nominaInicialCargada": true,
            "sistemaPagos.nominaInicialCargadaAt": serverTimestamp(),
            "sistemaPagos.nominaInicialCargadaPor": getDisplayName(state.effectiveUser),
            "sistemaPagos.nominaInicialCargadaPorCorreo": state.effectiveEmail,
            "sistemaPagos.correoPagosBatchId": batchId,
            "sistemaPagos.correoPagosDestinatario": d.correo
          };
      
      await updateDoc(inscRef, patchCorreoPagos);

      enviados += 1;
      setNominaPagosProgress(enviados, validos.length);
    }

    const correoVendedora =
      getCorreoVendedoraGrupoParaCopia();
    
    const correoRaitrai =
      "raitrai@raitrai.cl";
    
    const destinatariosResumen = [
      correoVendedora,
      correoRaitrai
    ]
      .map((correo) =>
        normalizeEmail(correo || "")
      )
      .filter(Boolean)
      .filter(
        (correo, index, lista) =>
          lista.indexOf(correo) === index
      );
    
    const ejemplo = validos[0];
    
    const resumenVendedora = `
    Se realizó el envío de correos de acceso al sistema de pagos.
    
    Grupo: ${
      state.group?.aliasGrupo ||
      state.group?.nombreGrupo ||
      state.group?.colegio ||
      state.groupId
    }
    
    Vendedora: ${
      state.group?.vendedora || "—"
    }
    
    Correo vendedora detectado: ${
      correoVendedora || "No detectado"
    }
    
    Total enviados: ${validos.length}
    Total sin correo: ${sinCorreo.length}
    
    Correos enviados:
    ${
      validos
        .map(
          (d) =>
            `- ${
              d.nombreParticipante ||
              "Participante"
            } · ${d.correo}`
        )
        .join("\n")
    }
    
    Participantes sin correo:
    ${
      sinCorreo.length
        ? sinCorreo
            .map(
              (d) =>
                `- ${
                  d.nombreParticipante ||
                  "Participante"
                } · ${
                  d.documento ||
                  "sin documento"
                }`
            )
            .join("\n")
        : "- Ninguno"
    }
    
    ----------------------------------------
    EJEMPLO DEL CORREO ENVIADO A APODERADOS
    ----------------------------------------
    
    ${cuerpo}
    `.trim();
    
    await addDoc(
      collection(
        db,
        "correos_nomina_inicial_pagos"
      ),
      {
        batchId,
    
        tipoCorreo:
          "resumen_vendedora",
    
        estado:
          "pendiente",
    
        destinatario:
          destinatariosResumen,
        
        to:
          destinatariosResumen,
    
        asunto:
          `Resumen envío pagos · ${
            state.group?.aliasGrupo ||
            state.group?.colegio ||
            state.groupId
          }`,
    
        subject:
          `Resumen envío pagos · ${
            state.group?.aliasGrupo ||
            state.group?.colegio ||
            state.groupId
          }`,
    
        cuerpo:
          resumenVendedora,
    
        body:
          resumenVendedora,
    
        idGrupo:
          String(state.groupId || ""),
    
        groupDocId:
          String(state.groupDocId || ""),
    
        grupo:
          cleanText(
            state.group?.aliasGrupo
          ) ||
          cleanText(
            state.group?.nombreGrupo
          ) ||
          normalizeTextUpper(
            state.group?.colegio || ""
          ),
    
        colegio:
          normalizeTextUpper(
            state.group?.colegio || ""
          ),
    
        curso:
          normalizeTextUpper(
            state.group?.curso || ""
          ),
    
        anoViaje:
          cleanText(
            state.group?.anoViaje || ""
          ),
    
        documento:
          ejemplo?.documento || "",
    
        nombreParticipante:
          ejemplo?.nombreParticipante || "",
    
        nombreResponsable:
          "Vendedora / Rai Trai",
    
        correoVendedora:
          correoVendedora || "",
    
        correoCopiaFija:
          correoRaitrai,
    
        destinatariosResumen,
    
        totalCorreos:
          validos.length,
    
        totalSinCorreo:
          sinCorreo.length,
    
        creadoPor:
          getDisplayName(
            state.effectiveUser
          ),
    
        creadoPorCorreo:
          state.effectiveEmail,
    
        creadoAt:
          serverTimestamp()
      }
    );

    await saveGroupPatch(
      {
        sistemaPagos: {
          ...(state.group?.sistemaPagos || {}),
          nominaInicial: {
            ...(state.group?.sistemaPagos?.nominaInicial || {}),
            cargada: true,
            cargadaAt: serverTimestamp(),
            cargadaPor: getDisplayName(state.effectiveUser),
            cargadaPorCorreo: state.effectiveEmail,
            batchId,
            totalInscripciones: destinatarios.length,
            totalCorreos: validos.length,
            totalSinCorreo: sinCorreo.length,
            asuntoUltimoEnvio: asunto
          }
        }
      },
      {
        tipoMovimiento: "nomina_inicial_cargada_pagos",
        modulo: "inscripcion",
        titulo: "Nómina inicial cargada en sistema de pagos",
        mensaje: `${getDisplayName(state.effectiveUser)} marcó la nómina inicial como cargada en sistema de pagos y generó ${validos.length} correo(s).`,
        metadata: {
          batchId,
          totalInscripciones: destinatarios.length,
          totalCorreos: validos.length,
          totalSinCorreo: sinCorreo.length
        }
      }
    );

    closeModal("modalNominaInicialPagos");
    showSaveNotice(`Nómina inicial marcada como cargada. Correos generados: ${validos.length}.`);
  } catch (error) {
    console.error("[grupo] enviarNominaInicialPagos", error);
    alert("Error al generar correos de nómina inicial: " + error.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

function renderGroup() {
  renderHero();
  renderSituacion();
  renderDatos();
  renderInscripcionPasajerosPanel();
  renderFichaPanel();
  renderDocs();
  renderMeetings();
  renderAlerts();
  renderHistory();

  // Reordena visualmente los paneles para priorizar ficha cuando el grupo está ganada
  prioritizeFichaPanelInLayout();

  syncButtons();
}

function renderHero() {
  const title =
    cleanText(state.group.aliasGrupo) ||
    cleanText(state.group.nombreGrupo) ||
    cleanText(state.group.colegio) ||
    `Grupo ${state.groupId}`;

  setText("heroTitle", title);
  setText("heroColegio", normalizeTextUpper(state.group.colegio || "—"));
  setText("heroAnoViaje", state.group.anoViaje || "—");
  setText("heroVendedora", state.group.vendedora || state.group.vendedoraCorreo || "—");
  setText("heroIdGrupo", state.groupId);
  setText("heroComuna", normalizeTextUpper(state.group.comunaCiudad || "—"));

  renderHeroLogo();
  renderHeroBadges();

  const nextMeeting = getNextMeeting();
  if (nextMeeting) {
    setText("heroProximaReunion", formatDateTime(nextMeeting.fechaInicio));
    setText(
      "heroProximaReunionSub",
      `${capitalize(nextMeeting.tipo || "reunión")} · ${meetingPlaceLabel(nextMeeting)}`
    );
  } else {
    setText("heroProximaReunion", "Sin reunión");
    setText("heroProximaReunionSub", "No hay reuniones agendadas");
  }

  const ultimaGestion = toDate(
    state.group.ultimaGestionAt ||
    state.group.fechaActualizacion ||
    null
  );

  setText("heroUltimaGestion", ultimaGestion ? formatDate(ultimaGestion) : "—");
  setText(
    "heroUltimaGestionSub",
    ultimaGestion
      ? `${state.group.ultimaGestionTipo || "Actualización"} · ${formatTime(ultimaGestion)}`
      : "Sin historial reciente"
  );

  const fichaLabel = getFichaEstadoLabel(state.group.fichaEstado);
  setText("heroFichaEstado", fichaLabel);
  setText(
    "heroFichaEstadoSub",
    state.group.autorizada ? "Grupo autorizado para operaciones" : "Flujo pendiente"
  );

  const autoCount = state.autoAlerts.length;
  const manualCount = state.alertsManual.length;
  setText("heroAlertasActivas", autoCount + manualCount);
  setText("heroAlertasActivasSub", `${autoCount} automáticas / ${manualCount} manuales`);
}

function renderHeroLogo() {
  const wrap = $("grupoLogoWrap");
  if (!wrap) return;

  const url = cleanText(state.group.logoColegioUrl || "");
  const baseText =
    cleanText(state.group.colegio) ||
    cleanText(state.group.aliasGrupo) ||
    cleanText(state.group.nombreCliente) ||
    state.groupId;

  if (url) {
    wrap.innerHTML = `<img src="${escapeHtml(url)}" alt="${escapeHtml(baseText)}" />`;
    return;
  }

  wrap.textContent = getInitials(baseText);
}

function renderHeroBadges() {
  const box = $("heroBadges");
  if (!box) return;

  const estado = normalizeState(state.group?.estado);
  const estadoMeta = ESTADO_META[estado] || ESTADO_META.a_contactar;

  const anoViajeNum = Number(state.group?.anoViaje || 0);
  const esLegacy2025 = anoViajeNum <= 2025;
  const flujoAbierto = !!state.group?.fichaFlujoAbierto;

  const tienePdf = !!cleanText(
    getByPath(state.group, "ficha.pdfUrl") ||
    state.group?.fichaPdfUrl ||
    ""
  );

  const autorizadaVisual = esLegacy2025
    ? !!state.group?.autorizada
    : (tienePdf && !flujoAbierto);

  const pdfVigente = tienePdf && !flujoAbierto;
  const pdfAnterior = tienePdf && flujoAbierto;

  const pagos = getEstadoNominaInicialPagos();

  box.innerHTML = `
    <span class="g-badge ${estadoMeta.css}">
      Estado: ${escapeHtml(estadoMeta.label)}
    </span>

    <span class="f-badge ${flujoAbierto ? "warn" : "ok"}">
      ${flujoAbierto ? "Ficha abierta" : "Ficha cerrada"}
    </span>

    <span class="f-badge ${autorizadaVisual ? "ok" : "warn"}">
      ${autorizadaVisual ? "Autorizada" : "No autorizada"}
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

    <span class="f-badge ${pagos.cargada ? "ok" : "warn"}">
      ${
        pagos.cargada
          ? `Pagos: nómina inicial cargada (${pagos.totalCorreos || 0} correos)`
          : "Pagos: nómina inicial pendiente"
      }
    </span>
  `;
}

function renderSituacion() {
  const fechaCambioEstado =
    state.group?.fechaUltimoCambioEstado ||
    getByPath(state.group, "situacion.fechaUltimoCambioEstado") ||
    null;

  const fechaCambioEstadoTxt = toDate(fechaCambioEstado)
    ? formatDateTime(fechaCambioEstado)
    : (stringValue(fechaCambioEstado) || "—");

  const estadoNormalizado = normalizeState(state.group?.estado);
  const isGanada = estadoNormalizado === "ganada";

  const anoViajeNum = Number(state.group?.anoViaje || 0);
  const esLegacy2025 = anoViajeNum <= 2025;
  const flujoAbierto = !!state.group?.fichaFlujoAbierto;

  const tienePdf = !!cleanText(
    getByPath(state.group, "ficha.pdfUrl") ||
    state.group?.fichaPdfUrl ||
    ""
  );

  const autorizadaVisual = esLegacy2025
    ? !!state.group?.autorizada
    : (tienePdf && !flujoAbierto);

  setText("situacionEstado", getEstadoLabel(state.group?.estado));
  setText("situacionAutorizacion", autorizadaVisual ? "Autorizada" : "No autorizada");
  setText("situacionCierre", flujoAbierto ? "Abierta" : "Cerrada");
  setText("situacionProximoPaso", getByPath(state.group, "situacion.proximoPaso") || "—");
  setText("situacionUltimoCambioEstado", fechaCambioEstadoTxt);

  const elementos = getElementosIncluidosGrupo();

  const elementosSeleccionados = [
    elementos.poleron ? "Polerón" : "",
    elementos.polera ? "Polera" : "",
    elementos.soporteCelular
      ? "Soporte para celular"
      : "",
    elementos.portapasaporte
      ? "Portapasaporte"
      : "",
    elementos.toalla ? "Toalla" : "",
    elementos.cortesias ? "Cortesías" : "",
    elementos.otros && elementos.otrosDetalle
      ? `Otros: ${elementos.otrosDetalle}`
      : ""
  ].filter(Boolean);
  
  const elementosWrap = $(
    "situacionElementosIncluidosWrap"
  );
  
  const elementosBox = $(
    "situacionElementosIncluidos"
  );
  
  if (elementosWrap) {
    elementosWrap.classList.remove("hidden");
  }
  
  if (elementosBox) {
    elementosBox.innerHTML =
      elementosSeleccionados.length
        ? elementosSeleccionados
            .map(
              (item) => `
                <span class="elemento-incluido-chip">
                  ${escapeHtml(item)}
                </span>
              `
            )
            .join("")
        : `
            <span class="muted">
              No se han registrado elementos incluidos.
            </span>
          `;
  }

  const obsAdmin = sanitizeRichHtml(getSharedObsAdministracion(state.group)) || "—";
  const obsOps = sanitizeRichHtml(getSharedObsOperaciones(state.group)) || "—";

  const adminWrap = $("situacionObsAdminWrap");
  const opsWrap = $("situacionObsOperacionesWrap");
  const adminEl = $("situacionObsAdmin");
  const opsEl = $("situacionObsOperaciones");

  adminWrap?.classList.toggle("hidden", !isGanada);
  opsWrap?.classList.toggle("hidden", !isGanada);

  if (adminEl) {
    adminEl.innerHTML = isGanada
      ? `
        <div class="obs-box admin">
          <div class="obs-title">Observaciones para administración</div>
          <div class="obs-body">${obsAdmin}</div>
        </div>
      `
      : "";
  }

  if (opsEl) {
    opsEl.innerHTML = isGanada
      ? `
        <div class="obs-box ops">
          <div class="obs-title">Observaciones para operaciones</div>
          <div class="obs-body">${obsOps}</div>
        </div>
      `
      : "";
  }

  const box = $("panelProximaReunion");
  if (!box) return;

  const nextMeeting = getNextMeeting();

  if (!nextMeeting) {
    box.innerHTML = `<div class="empty-box">No hay reuniones agendadas para este grupo.</div>`;
    return;
  }

  box.innerHTML = `
    <div class="obs-box">
      <div class="obs-title">Próxima reunión agendada</div>
      <div class="obs-body">
        <p><strong>Fecha:</strong> ${escapeHtml(formatDateTime(nextMeeting.fechaInicio))}</p>
        <p><strong>Tipo:</strong> ${escapeHtml(capitalize(nextMeeting.tipo || "—"))}</p>
        <p><strong>Lugar / link:</strong> ${escapeHtml(meetingPlaceLabel(nextMeeting))}</p>
        <p><strong>Observaciones:</strong> ${escapeHtml(nextMeeting.observaciones || "Sin observaciones")}</p>
      </div>
    </div>
  `;
}

function renderDatos() {
  const grid = $("datosGrupoGrid");
  if (!grid) return;

  const nombre1 = normalizeTextUpper(state.group.nombreCliente || "");
  const nombre2 = normalizeTextUpper(state.group.nombreCliente2 || "");
  const rol1 = normalizeTextUpper(state.group.rolCliente || "");
  const rol2 = normalizeTextUpper(state.group.rolCliente2 || "");

  const items = [
    {
      label: "1° Contacto",
      valueHtml: `
        <div class="contact-value-stack">
          <div class="contact-main-value">${escapeHtml(nombre1 || "—")}</div>
          ${rol1 ? `<div class="contact-role-chip">${escapeHtml(rol1)}</div>` : ""}
        </div>
      `
    },
    {
      label: "Correo 1° Contacto",
      valueHtml: buildEmailValueHtml(state.group.correoCliente, nombre1 || "1° CONTACTO")
    },
    {
      label: "Celular 1° Contacto",
      valueHtml: buildPhoneValueHtml(state.group.celularCliente)
    },

    {
      label: "2° Contacto",
      valueHtml: `
        <div class="contact-value-stack">
          <div class="contact-main-value">${escapeHtml(nombre2 || "—")}</div>
          ${rol2 ? `<div class="contact-role-chip">${escapeHtml(rol2)}</div>` : ""}
        </div>
      `
    },
    {
      label: "Correo 2° Contacto",
      valueHtml: buildEmailValueHtml(state.group.correoCliente2, nombre2 || "2° CONTACTO")
    },
    {
      label: "Celular 2° Contacto",
      valueHtml: buildPhoneValueHtml(state.group.celularCliente2)
    },

    {
      label: "Destino principal",
      valueHtml: escapeHtml(normalizeTextUpper(getDestinoPrincipalDisplay(state.group)) || "—"),
      full: true
    },
    {
      label: "Programa",
      valueHtml: escapeHtml(normalizeTextUpper(getProgramaDisplay(state.group)) || "—"),
      full: true
    },

    {
      label: "Mes de viaje",
      valueHtml: escapeHtml(normalizeTextUpper(getMesViajeDisplay(state.group)) || "—")
    },
    {
      label: "Cantidad grupo",
      valueHtml: escapeHtml(String(state.group.cantidadGrupo || "—"))
    },
    {
      label: "Tramo",
      valueHtml: escapeHtml(normalizeTextUpper(getTramoDisplay(state.group)) || "—")
    }
  ];

  grid.className = "grupo-data-card-grid";

  grid.innerHTML = items.map((item) => `
    <div class="grupo-data-card ${item.full ? "full is-strong" : ""}">
      <div class="info-label">${escapeHtml(item.label)}</div>
      <div class="info-value contact-info-value">${item.valueHtml || "—"}</div>
    </div>
  `).join("");
}

function renderDocs() {
  const docsChips = $("docsChips");
  const flowSteps = $("flowSteps");

  if (docsChips) {
    const fichaPdfUrl = getFichaDocumentoPdfUrl(state.group);
    const fichaDocumentoEstado = resolveFichaDocumentoEstado(state.group);

    docsChips.innerHTML = `
      ${renderDocChip("fichaMedicaEstado", state.group.fichaMedicaEstado)}
      ${renderDocChip("nominaEstado", state.group.nominaEstado)}
      ${renderDocChip("fichaEstado", fichaDocumentoEstado, { href: fichaPdfUrl })}
      ${renderDocChip("contratoEstado", state.group.contratoEstado)}
      ${renderDocChip("cortesiaEstado", state.group.cortesiaEstado)}
    `;
  }

  const flow = state.group.flowFicha || {};

  if (flowSteps) {
    flowSteps.innerHTML = `
      ${renderFlowStep("Vendedor(a)", flow?.vendedor)}
      ${renderFlowStep("Jefa de ventas", flow?.jefaVentas)}
      ${renderFlowStep("Administración", flow?.administracion)}
    `;
  }
}

function renderMeetings() {
  const list = $("meetingsList");
  if (!list) return;

  if (!state.meetings.length) {
    list.innerHTML = `<div class="empty-box">Todavía no hay reuniones registradas para este grupo.</div>`;
    return;
  }

  list.innerHTML = state.meetings.map((meeting, index) => `
    <div class="list-card">
      <div class="list-card-top">
        <div>
          <div class="list-card-title">
            ${escapeHtml(meeting.titulo || `Reunión ${state.meetings.length - index}`)}
          </div>

          <div class="list-card-meta">
${escapeHtml(formatDateTime(meeting.fechaInicio))}
${escapeHtml(capitalize(meeting.tipo || "reunión"))} · ${escapeHtml(meeting.estadoReunion || "agendada")}
${escapeHtml(meetingPlaceLabel(meeting))}
          </div>
        </div>

        <div class="registro-card-actions">
          <div class="doc-chip ${docStateClass(
            meeting.estadoReunion === "cancelada"
              ? "no_aplica"
              : meeting.estadoReunion === "realizada"
                ? "ok"
                : "pendiente"
          )}">
            ${escapeHtml(capitalize(meeting.estadoReunion || "agendada"))}
          </div>

          <button
            class="btn-pill"
            type="button"
            data-action="edit-meeting"
            data-id="${escapeHtml(meeting.id)}"
          >
            Editar
          </button>

          ${
            normalizeSearchLocal(meeting.estadoReunion || "") !== "realizada"
              ? `
                <button
                  class="btn-dark"
                  type="button"
                  data-action="complete-meeting"
                  data-id="${escapeHtml(meeting.id)}"
                >
                  Marcar realizada
                </button>
              `
              : ""
          }
        </div>
      </div>

      <div class="list-card-meta">
        ${escapeHtml(meeting.observaciones || "Sin observaciones")}
      </div>
    </div>
  `).join("");
}

function renderAlerts() {
  const list = $("alertsList");
  if (!list) return;

  const merged = [
    ...state.autoAlerts.map((item) => ({
      ...item,
      tipoLista: "auto"
    })),

    ...state.alertsManual.map((item) => ({
      ...item,
      tipoLista: "manual"
    }))
  ];

  if (!merged.length) {
    list.innerHTML = `
      <div class="empty-box">
        No hay alertas activas para este grupo.
      </div>
    `;
    return;
  }

  /*
   * Las automáticas todavía pueden usar nivel "info".
   *
   * Las manuales nuevas solamente podrán ser:
   * - warning
   * - critica
   */
  const levelOrder = {
    critica: 3,
    warning: 2,
    info: 1
  };

  const sorted = [...merged].sort((a, b) => {
    const nivelA =
      normalizeSearchLocal(
        a.nivel || "info"
      );

    const nivelB =
      normalizeSearchLocal(
        b.nivel || "info"
      );

    const diffNivel =
      (levelOrder[nivelB] || 0) -
      (levelOrder[nivelA] || 0);

    if (diffNivel !== 0) {
      return diffNivel;
    }

    return (
      dateValue(
        b.fechaCreacion ||
        b.fecha ||
        null
      ) -
      dateValue(
        a.fechaCreacion ||
        a.fecha ||
        null
      )
    );
  });

  list.innerHTML = sorted
    .map((alertItem) => {
      const isManual =
        alertItem.tipoLista === "manual";

      const level =
        normalizeSearchLocal(
          alertItem.nivel || "info"
        );

      const levelClass =
        level === "critica"
          ? "alert-critical"
          : "";

      const baseClass =
        isManual
          ? "alert-manual"
          : "alert-auto";

      const author =
        isManual
          ? (
              alertItem.creadoPor ||
              alertItem.creadoPorCorreo ||
              "Sin autor"
            )
          : "Sistema";

      const dateLabel =
        isManual &&
        alertItem.fechaCreacion
          ? formatDateTime(
              alertItem.fechaCreacion
            )
          : "En tiempo real";

      const levelLabel =
        level === "critica"
          ? "Crítica"
          : level === "warning"
            ? "Pendiente"
            : "Info";

      /*
       * REGLA:
       *
       * Una alerta manual puede resolverla
       * cualquier usuario que tenga acceso
       * al grupo.
       *
       * No depende de canEditGroup().
       */
      const puedeResolver =
        isManual &&
        canAccessGroup(state.group);

      return `
        <article
          class="
            registro-card
            registro-alert-card
            ${baseClass}
            ${levelClass}
          "
        >
          <div class="registro-card-top">

            <div class="registro-meta-row">
              <span>
                ${escapeHtml(author)}
              </span>

              <span>·</span>

              <span>
                ${escapeHtml(dateLabel)}
              </span>
            </div>

            <div class="registro-card-actions">

              <span class="registro-tag">
                ${isManual ? "Manual" : "Automática"}
              </span>

              <span class="registro-tag is-soft">
                ${escapeHtml(levelLabel)}
              </span>

              ${
                puedeResolver
                  ? `
                    <button
                      class="btn-danger"
                      type="button"
                      data-action="resolver-alerta"
                      data-id="${escapeHtml(alertItem.id)}"
                    >
                      Resolver
                    </button>
                  `
                  : ""
              }

            </div>
          </div>

          <div class="registro-title">
            ${escapeHtml(
              alertItem.titulo ||
              "Alerta"
            )}
          </div>

          <div class="registro-message">
            ${escapeHtml(
              alertItem.mensaje ||
              "Sin mensaje"
            )}
          </div>

        </article>
      `;
    })
    .join("");
}

function buildDuplicateReviewHtml(item = {}) {
  const alertas = Array.isArray(item?.metadata?.alertas)
    ? item.metadata.alertas
    : [];

  if (!alertas.length) return "";

  const rows = alertas.map((a, index) => {
    const reasons = Array.isArray(a.reasons) ? a.reasons : [];

    return `
      <li>
        <strong>${index + 1}. ID ${escapeHtml(a.relatedIdGrupo || "—")}</strong>
        · ${escapeHtml(a.aliasGrupo || "Grupo sin alias")}
        <br>
        Colegio: ${escapeHtml(a.colegio || "—")}
        · Curso: ${escapeHtml(a.curso || "—")}
        · Año: ${escapeHtml(a.anoViaje || "—")}
        · Comuna: ${escapeHtml(a.comunaCiudad || "—")}
        <br>
        Vendedora: ${escapeHtml(a.vendedora || "Sin asignar")}
        · Estado: ${escapeHtml(a.estado || "—")}
        · Nivel: ${escapeHtml(a.level || "—")}
        · Puntaje: ${escapeHtml(a.score ?? "—")}
        ${
          reasons.length
            ? `<br><em>Razones:</em> ${reasons.map(r => escapeHtml(r)).join(" · ")}`
            : ""
        }
      </li>
    `;
  }).join("");

  return `
    <div class="registro-detail-block">
      <div class="registro-detail-label">Coincidencias revisadas</div>
      <ul class="registro-detail-list">${rows}</ul>
    </div>
  `;
}

function renderHistory() {
  const list = $("historyList");
  const note = $("historyToolbarNote");
  const btnMore = $("btnHistoryMore");
  const btnToggleHidden = $("btnHistoryToggleHidden");

  if (!list) return;

  const canManage = canManageHistoryItems();
  const allItems = [...state.history];
  const hiddenCount = allItems.filter((item) => item.oculto === true).length;

  if (btnToggleHidden) {
    btnToggleHidden.classList.toggle("hidden", !canManage);

    if (canManage) {
      btnToggleHidden.textContent = state.historyUi.showHidden
        ? `Ocultar ocultos (${hiddenCount})`
        : `Ver ocultos (${hiddenCount})`;

      btnToggleHidden.disabled = hiddenCount === 0 && !state.historyUi.showHidden;
    }
  }

  const visibleItems = allItems
    .filter((item) => state.historyUi.showHidden || item.oculto !== true)
    .sort((a, b) => {
      const featuredDiff = Number(!!b.destacado) - Number(!!a.destacado);
      if (featuredDiff !== 0) return featuredDiff;
      return dateValue(b.fecha) - dateValue(a.fecha);
    });

  const shownItems = visibleItems.slice(0, state.historyUi.limit);

  if (note) {
    if (!visibleItems.length) {
      note.textContent = hiddenCount > 0 && !state.historyUi.showHidden
        ? `No hay registros visibles. Hay ${hiddenCount} oculto(s).`
        : "Todavía no hay historial registrado para este grupo.";
    } else {
      note.textContent = `Mostrando ${shownItems.length} de ${visibleItems.length} registro(s)` +
        (hiddenCount ? ` · ocultos: ${hiddenCount}` : "");
    }
  }

  if (!shownItems.length) {
    list.innerHTML = `<div class="empty-box">Todavía no hay historial visible para este grupo.</div>`;

    if (btnMore) {
      btnMore.classList.add("hidden");
    }
    return;
  }

  list.innerHTML = shownItems.map((item) => {
    const cambiosDetallados =
      Array.isArray(item?.metadata?.cambiosDetallados) && item.metadata.cambiosDetallados.length
        ? item.metadata.cambiosDetallados
        : buildDetailedChanges(
            Array.isArray(item?.metadata?.cambios) ? item.metadata.cambios : []
          );

    const tipo = getHistoryTypeLabel(item);
    const cssType = getHistoryCardClass(item);
    const encabezado = item.asunto || item.titulo || "Movimiento";
    const autor = item.creadoPor || item.creadoPorCorreo || "Sin usuario";
    const fecha = item.fecha ? formatDateTime(item.fecha) : "Sin fecha";
    const fullMessage = cleanText(item.mensaje || "Sin detalle");
    const previewMessage = truncateHistoryMessage(fullMessage, 220);

    const detailItems = cambiosDetallados.map((c) => {
      if (c.tipoCambio === "agregado") {
        return `<li><strong>Agregado</strong> · ${escapeHtml(prettyLabel(c.campo))}: ${escapeHtml(c.nuevoPreview || "sin valor")}</li>`;
      }

      if (c.tipoCambio === "eliminado") {
        return `<li><strong>Eliminado</strong> · ${escapeHtml(prettyLabel(c.campo))}: ${escapeHtml(c.anteriorPreview || "sin valor")}</li>`;
      }

      return `<li><strong>Modificado</strong> · ${escapeHtml(prettyLabel(c.campo))}: ${escapeHtml(c.anteriorPreview || "vacío")} → ${escapeHtml(c.nuevoPreview || "vacío")}</li>`;
    }).join("");

    const duplicateReviewHtml = buildDuplicateReviewHtml(item);
    
    const hasLongMessage = fullMessage.length > 220;
    const hasDetails = hasLongMessage || cambiosDetallados.length > 0 || !!duplicateReviewHtml;

    return `
      <article class="registro-card ${cssType} ${item.destacado ? "is-featured" : ""} ${item.oculto ? "is-hidden-item" : ""}">
        <div class="registro-card-top">
          <div class="registro-meta-row">
            <span>${escapeHtml(autor)}</span>
            <span>·</span>
            <span>${escapeHtml(fecha)}</span>
          </div>

          <div class="registro-card-actions">
            <span class="registro-tag">${escapeHtml(tipo)}</span>
            ${item.destacado ? `<span class="registro-tag is-featured">Destacado</span>` : ""}
            ${item.oculto ? `<span class="registro-tag is-hidden">Oculto</span>` : ""}

            ${
              canManage
                ? `<button class="btn-icon-lite" type="button" title="${item.destacado ? "Quitar destacado" : "Destacar"}" data-action="toggle-history-star" data-id="${escapeHtml(item.id)}">${item.destacado ? "★" : "☆"}</button>`
                : ""
            }

            ${
              canManage
                ? `<button class="btn-icon-lite" type="button" title="${item.oculto ? "Mostrar" : "Ocultar"}" data-action="toggle-history-hidden" data-id="${escapeHtml(item.id)}">${item.oculto ? "👁" : "🙈"}</button>`
                : ""
            }
          </div>
        </div>

        <div class="registro-title">${escapeHtml(encabezado)}</div>
        <div class="registro-message">${escapeHtml(previewMessage || "Sin detalle")}</div>

        ${
          hasDetails
            ? `
              <button
                class="btn-link-lite"
                type="button"
                data-action="toggle-history-detail"
                data-target="history-detail-${escapeHtml(item.id)}"
              >
                Ver más
              </button>

              <div class="registro-detail hidden" id="history-detail-${escapeHtml(item.id)}">
                ${
                  hasLongMessage
                    ? `
                      <div class="registro-detail-block">
                        <div class="registro-detail-label">Mensaje completo</div>
                        <div class="registro-detail-text">${escapeHtml(fullMessage)}</div>
                      </div>
                    `
                    : ""
                }

                ${
                  cambiosDetallados.length
                    ? `
                      <div class="registro-detail-block">
                        <div class="registro-detail-label">Detalle</div>
                        <ul class="registro-detail-list">${detailItems}</ul>
                      </div>
                    `
                    : ""
                }
                ${duplicateReviewHtml}
              </div>
            `
            : ""
        }
      </article>
    `;
  }).join("");

  if (btnMore) {
    const remaining = visibleItems.length - shownItems.length;

    if (remaining > 0) {
      btnMore.classList.remove("hidden");
      btnMore.textContent = `Ver más (${remaining} restantes)`;
    } else {
      btnMore.classList.add("hidden");
    }
  }
}

function ensureBotonCorreosInscripcion() {
  if ($("btnCorreosInscripcion")) return;

  const btnCerrar = $("btnCerrarInscripcion");
  if (!btnCerrar || !btnCerrar.parentElement) return;

  const btn = document.createElement("button");
  btn.id = "btnCorreosInscripcion";
  btn.type = "button";
  btn.className = "btn-pill";
  btn.textContent = "Correos";

  btnCerrar.insertAdjacentElement("afterend", btn);
}

function ensureBotonGestionFichasMedicas() {
  if ($("btnGestionFichasMedicas")) return;

  const btnLinkNomina =
    $("btnGenerarLinkNominaPublica");

  if (
    !btnLinkNomina ||
    !btnLinkNomina.parentElement
  ) {
    return;
  }

  const btn =
    document.createElement("button");

  btn.id =
    "btnGestionFichasMedicas";

  btn.type =
    "button";

  btn.className =
    "btn-pill btn-gestion-fichas-medicas";

  btn.textContent =
    "Gestionar fichas médicas";

  btn.addEventListener(
    "click",
    abrirGestionFichasMedicasGrupo
  );

  btnLinkNomina.insertAdjacentElement(
    "afterend",
    btn
  );
}
function abrirGestionFichasMedicasGrupo() {
  const groupDocId =
    String(
      state.groupDocId ||
      ""
    ).trim();

  if (!groupDocId) {
    alert(
      "No se pudo identificar el grupo para gestionar sus fichas médicas."
    );

    return;
  }

  window.open(
    `gestion-fichas-medicas.html?id=${encodeURIComponent(
      groupDocId
    )}`,
    "_blank",
    "noopener"
  );
}

function tieneBotonVisible(contenedorId) {
  const contenedor = $(contenedorId);

  if (!contenedor) return false;

  return [
    ...contenedor.querySelectorAll("button")
  ].some((btn) => {
    return !btn.classList.contains("hidden");
  });
}

function syncButtons() {
  ensureBotonCorreosInscripcion();
  ensureBotonGestionFichasMedicas();

  const editable = canEditGroup();
  const isGanada = normalizeState(state.group.estado) === "ganada";
  const autorizada = !!state.group.autorizada;
  const ficha = getFichaSummary();

  const canAlertsComments = canCreateAlertsAndComments();

  [
    "btnEditarDatosHero",
    "btnEditarDatos"
  ].forEach((id) => {
    const el = $(id);
    if (el) el.disabled = !editable;
  });

  [
    "btnNuevaReunionHero",
    "btnNuevaReunion",
    "btnNuevaReunionListado"
  ].forEach((id) => {
    const el = $(id);
    if (el) el.disabled = !canManageMeetings();
  });

  [
    "btnEditarSituacionHero",
    "btnEditarSituacion"
  ].forEach((id) => {
    const el = $(id);
  
    if (el) {
      el.disabled = !canOpenSituacionModal();
    }
  });

  [
    "btnNuevaAlertaHero",
    "btnNuevaAlerta",
    "btnNuevoComentario"
  ].forEach((id) => {
    const el = $(id);
    if (el) el.disabled = !canAlertsComments;
  });

  const btnEditarDocumentos = $("btnEditarDocumentos");
  if (btnEditarDocumentos) {
    const canDocs = canEditDocuments();
    btnEditarDocumentos.disabled = !canDocs;
    btnEditarDocumentos.classList.toggle("hidden", !canDocs);
  }

  const btnFicha = $("btnCrearFicha");
  if (btnFicha) {
    const fichaButtonMode = getFichaMainButtonMode();
    btnFicha.textContent = fichaButtonMode.label;
    btnFicha.disabled = fichaButtonMode.disabled;
  }

  const btnAbrirFichaPdf = $("btnAbrirFichaPdf");
  if (btnAbrirFichaPdf) btnAbrirFichaPdf.disabled = !ficha.pdfUrl;

  const btnHabilitarInscripcion = $("btnHabilitarInscripcion");
  const btnCerrarInscripcion = $("btnCerrarInscripcion");

  /*
    Contenedores completos de las fases correlativas.
  
    Ocultaremos la tarjeta completa cuando esa fase
    no corresponda al usuario actual.
  */
  const procesoNuevosIngresos =
    $("procesoNuevosIngresos");
  
  const procesoListaEspera =
    $("procesoListaEspera");
  
  const procesoLiberados =
    $("procesoLiberados");
  
  const btnAbrirNuevosInscritos =
    $("btnAbrirNuevosInscritos");
  
  const btnCopiarLinkNuevos =
    $("btnCopiarLinkNuevos");
  
  const btnCerrarNuevosInscritos =
    $("btnCerrarNuevosInscritos");
  
  const btnAbrirListaEspera =
    $("btnAbrirListaEspera");
  
  const btnCopiarLinkListaEspera =
    $("btnCopiarLinkListaEspera");
  
  const btnCerrarListaEspera =
    $("btnCerrarListaEspera");
  
  const btnCrearLinkLiberados =
    $("btnCrearLinkLiberados");
  
  const btnCopiarLinkLiberados =
    $("btnCopiarLinkLiberados");
  
  const btnCerrarLinkLiberados =
    $("btnCerrarLinkLiberados");
  
  const btnCopiarLinkInscripcion =
    $("btnCopiarLinkInscripcion");
  const btnExportarInscripcionesExcel = $("btnExportarInscripcionesExcel");
  const btnExportarInscripcionesCsv = $("btnExportarInscripcionesCsv");
  const btnResetearCicloInscripcion = $("btnResetearCicloInscripcion");
  const btnEditarNominaInscripcion = $("btnEditarNominaInscripcion");
  const btnNominaInicialPagos = $("btnNominaInicialPagos");
  const btnCorreosInscripcion = $("btnCorreosInscripcion");

  const puedeInicial = canGestionarInscripcionInicial();
  const puedeNominaFinal = canGestionarNominaFinal();
  const puedeNuevos = canGestionarNuevosIngresos();
  const puedeListaEspera = canGestionarListaEspera();
  const puedeLiberados = canGestionarLiberados();

  /*
    Admin y Supervisión pueden ver y manejar ambas fases,
    sin importar la fecha.
  */
  const puedeVerAmbasFases =
    esAdminOSupervisionInscripcion();
  
  /*
    Para los demás roles, las fases son correlativas:
  
    - Antes del 16 de marzo:
      Nuevos ingresos.
  
    - Desde el 16 de marzo:
      Lista de espera.
  */
  const mostrarProcesoNuevos =
    puedeVerAmbasFases ||
    correspondeNuevosIngresosPorFecha();
  
  const mostrarProcesoListaEspera =
    puedeVerAmbasFases ||
    correspondeListaEsperaPorFecha();

  /*
    Ocultamos la tarjeta completa.
  
    Esto evita que quede visible solamente el título
    "Nuevos ingresos" sin ningún botón.
  */
  procesoNuevosIngresos
    ?.classList.toggle(
      "hidden",
      !mostrarProcesoNuevos
    );
  
  procesoListaEspera
    ?.classList.toggle(
      "hidden",
      !mostrarProcesoListaEspera
    );
  
  /*
    Liberados es paralelo a todos los ciclos.
    Su tarjeta solamente depende del permiso general
    para gestionar Liberados o de que ya exista activa.
  */
  const estadoLiberadosVisible =
    getEstadoLiberadosLink();
  
  procesoLiberados
    ?.classList.toggle(
      "hidden",
      !puedeLiberados &&
      !estadoLiberadosVisible.activo
    );

  /*
    No basta con leer inscripcionHabilitada.
  
    En grupos de Sistema de Pagos puede existir una marca
    antigua de Inscripción inicial que ya no representa
    un proceso principal válido.
  */
  const procesoPrincipalAntiguoInvalido =
    tieneProcesoPrincipalAntiguoInvalido();
  
  const inscripcionPrincipalYaHabilitada =
    state.group?.inscripcionHabilitada === true &&
    !procesoPrincipalAntiguoInvalido;
  
  const tieneInscripciones =
    state.inscripciones.length > 0;

  if (btnHabilitarInscripcion) {
    const puedePrincipal =
      puedeInicial ||
      puedeNominaFinal;
  
    btnHabilitarInscripcion.classList.toggle(
      "hidden",
      !puedePrincipal
    );
  
    if (grupoVieneSistemaAntiguo()) {
      btnHabilitarInscripcion.textContent =
        puedeReabrirFasePasada() &&
        nominaFinalYaCerrada()
          ? "Reabrir nómina final / ficha médica"
          : "Abrir nómina final / ficha médica";
  
      btnHabilitarInscripcion.disabled =
        !puedeNominaFinal;
    } else {
      btnHabilitarInscripcion.textContent =
        puedeReabrirFasePasada() &&
        inscripcionInicialYaCerrada()
          ? "Reabrir inscripción inicial"
          : "Abrir inscripción inicial";
  
      btnHabilitarInscripcion.disabled =
        !puedeInicial;
    }
  }

  if (btnCopiarLinkInscripcion) {
    const fasePrincipal =
      normalizeSearchLocal(
        getInscripcionEstadoActual()
      );
  
    const esFichaMedica =
      fasePrincipal ===
      "nomina_final";
  
    /*
      Si existe una marca antigua inválida, el botón
      no debe ofrecer copiar ese link.
    */
    btnCopiarLinkInscripcion.classList.toggle(
      "hidden",
      !inscripcionPrincipalYaHabilitada
    );
  
    btnCopiarLinkInscripcion.disabled =
      !inscripcionPrincipalYaHabilitada;
  
    btnCopiarLinkInscripcion.textContent =
      esFichaMedica
        ? "Copiar link ficha médica"
        : "Copiar link inscripción inicial";
  }

  if (btnCerrarInscripcion) {
    const puedeCerrarPrincipal =
      inscripcionPrincipalYaHabilitada &&
      puedeAbrirCerrarFasesInscripcion();
  
    /*
      Una fase antigua inválida no debe ofrecer
      "Cerrar inscripción inicial".
    */
    btnCerrarInscripcion.classList.toggle(
      "hidden",
      !inscripcionPrincipalYaHabilitada
    );
  
    btnCerrarInscripcion.disabled =
      !puedeCerrarPrincipal;
  
    const fasePrincipal =
      normalizeSearchLocal(
        getInscripcionEstadoActual()
      );
  
    btnCerrarInscripcion.textContent =
      fasePrincipal === "nomina_final"
        ? "Cerrar ficha médica"
        : "Cerrar inscripción inicial";
  }

  if (btnCorreosInscripcion) {
    const puedeCorreo = canAccessGroup(state.group);
    btnCorreosInscripcion.disabled = !puedeCorreo || !tieneInscripciones;
    btnCorreosInscripcion.classList.toggle("hidden", !puedeCorreo);
  }

  const estadoNuevos =
    getEstadoNuevosIngresos();
  
  const estadoListaEspera =
    getEstadoListaEsperaLink();
  
  const estadoLiberados =
    getEstadoLiberadosLink();
  
  /*
    NUEVOS INGRESOS
  
    Cerrado:
    - muestra Abrir.
  
    Abierto:
    - muestra Copiar.
    - muestra Cerrar.
  */
  if (btnAbrirNuevosInscritos) {
    btnAbrirNuevosInscritos.classList.toggle(
      "hidden",
      !mostrarProcesoNuevos ||
      estadoNuevos.activo ||
      !puedeNuevos
    );
  
    btnAbrirNuevosInscritos.disabled =
      !puedeNuevos ||
      estadoNuevos.activo;
  }
  
  if (btnCopiarLinkNuevos) {
    btnCopiarLinkNuevos.classList.toggle(
      "hidden",
      !mostrarProcesoNuevos ||
      !estadoNuevos.activo
    );
  
    btnCopiarLinkNuevos.disabled =
      !estadoNuevos.activo ||
      !estadoNuevos.link;
  }
  
  if (btnCerrarNuevosInscritos) {
    btnCerrarNuevosInscritos.classList.toggle(
      "hidden",
      !mostrarProcesoNuevos ||
      !estadoNuevos.activo
    );
  
    btnCerrarNuevosInscritos.disabled =
      !estadoNuevos.activo ||
      !puedeNuevos;
  }
  /*
    LISTA DE ESPERA
  */
  if (btnAbrirListaEspera) {
    btnAbrirListaEspera.classList.toggle(
      "hidden",
      !mostrarProcesoListaEspera ||
      estadoListaEspera.activo ||
      !puedeListaEspera
    );
  
    btnAbrirListaEspera.disabled =
      !puedeListaEspera ||
      estadoListaEspera.activo;
  }
  
  if (btnCopiarLinkListaEspera) {
    btnCopiarLinkListaEspera.classList.toggle(
      "hidden",
      !mostrarProcesoListaEspera ||
      !estadoListaEspera.activo
    );
  
    btnCopiarLinkListaEspera.disabled =
      !estadoListaEspera.activo ||
      !estadoListaEspera.link;
  }
  
  if (btnCerrarListaEspera) {
    btnCerrarListaEspera.classList.toggle(
      "hidden",
      !mostrarProcesoListaEspera ||
      !estadoListaEspera.activo
    );
  
    btnCerrarListaEspera.disabled =
      !estadoListaEspera.activo ||
      !puedeListaEspera;
  }
  
  /*
    CUPOS LIBERADOS
  */
  if (btnCrearLinkLiberados) {
    btnCrearLinkLiberados.classList.toggle(
      "hidden",
      estadoLiberados.activo ||
      !puedeLiberados
    );
  
    btnCrearLinkLiberados.disabled =
      !puedeLiberados ||
      estadoLiberados.activo;
  }
  
  if (btnCopiarLinkLiberados) {
    const tieneLinkLiberados =
      !!estadoLiberados.link ||
      !!estadoLiberados.token;
  
    btnCopiarLinkLiberados.classList.toggle(
      "hidden",
      !estadoLiberados.activo
    );
  
    btnCopiarLinkLiberados.disabled =
      !estadoLiberados.activo ||
      !tieneLinkLiberados;
  }
  
  if (btnCerrarLinkLiberados) {
    btnCerrarLinkLiberados.classList.toggle(
      "hidden",
      !estadoLiberados.activo
    );
  
    btnCerrarLinkLiberados.disabled =
      !estadoLiberados.activo ||
      !puedeLiberados;
  }

  if (btnExportarInscripcionesExcel) {
    btnExportarInscripcionesExcel.disabled = !tieneInscripciones;
  }

  if (btnExportarInscripcionesCsv) {
    const puedeCsv = puedeExportarCsvInscripciones();

    btnExportarInscripcionesCsv.disabled = !tieneInscripciones || !puedeCsv;
    btnExportarInscripcionesCsv.classList.toggle("hidden", !puedeCsv);
  }

  if (btnResetearCicloInscripcion) {
    const puedeReset = canResetearCicloInscripcion();
  
    btnResetearCicloInscripcion.classList.toggle("hidden", !puedeReset);
    btnResetearCicloInscripcion.disabled = !puedeReset;
  }

  if (btnEditarNominaInscripcion) {
    const puedeEditarNomina = canEditarNominaInscripcion();
  
    btnEditarNominaInscripcion.classList.toggle("hidden", !puedeEditarNomina);
    btnEditarNominaInscripcion.disabled = !puedeEditarNomina || !tieneInscripciones;
  }

  if (btnNominaInicialPagos) {
    const puedeGestionarPagos =
      puedeOperarListaEsperaAdministrativa();
  
    btnNominaInicialPagos.classList.toggle(
      "hidden",
      !puedeGestionarPagos
    );
  
    btnNominaInicialPagos.disabled =
      !puedeGestionarPagos;
  
    const estadoPagos =
      getEstadoNominaInicialPagos();
  
    btnNominaInicialPagos.textContent =
      estadoPagos.cargada
        ? "Reenviar aviso / actualizar carga pagos"
        : "Cargado a Pagos";
  }
  
  /*
    Después de definir la visibilidad de todos los botones,
    ocultamos las categorías que quedaron sin acciones visibles.
  */
  [
    "bloqueEstadoInscripcion",
    "bloqueEnlacesPasajeros",
    "bloqueGestionNomina",
    "bloqueComunicacionesArchivos",
    "bloqueAccionesAvanzadas"
  ].forEach((id) => {
    const bloque = $(id);
  
    if (!bloque) return;
  
    bloque.classList.toggle(
      "hidden",
      !tieneBotonVisible(id)
    );
  });

  /*
    Todos los botones y categorías ya tienen aplicada
    su visibilidad según rol, permisos y estado del grupo.
  
    Recién ahora mostramos el contenedor completo.
  */
  $("inscripcionAcciones")
    ?.classList.remove("hidden");
  
  const btnContrato = $("btnCrearContrato");
  if (btnContrato) btnContrato.disabled = !autorizada;

  const flow = state.group.flowFicha || {};
  const btnVend = $("btnFirmarVendedor");
  const btnJefa = $("btnFirmarJefaVentas");
  const btnAdmin = $("btnFirmarAdministracion");

  if (btnVend) {
    btnVend.disabled = !editable || !isGanada || !!flow?.vendedor?.firmado;
  }

  if (btnJefa) {
    btnJefa.disabled = !isJefaVentas() || !flow?.vendedor?.firmado || !!flow?.jefaVentas?.firmado;
  }

  if (btnAdmin) {
    btnAdmin.disabled = !isAdministracion() || !flow?.jefaVentas?.firmado || !!flow?.administracion?.firmado;
  }
}

function renderFatal(message) {
  const shell = document.querySelector(".grupo-shell");
  if (!shell) return;

  shell.innerHTML = `
    <div class="grupo-panel">
      <div class="grupo-panel-body">
        <div class="empty-box">${escapeHtml(message)}</div>
      </div>
    </div>
  `;
}

/* =========================================================
   AUTO ALERTS
========================================================= */
function getOpenFichaUpdateRequestsForGroup() {
  return state.requests.filter((item) => {
    const tipo = normalizeSearchLocal(item.tipoSolicitud || "");
    const estado = normalizeSearchLocal(item.estadoSolicitud || "");

    return tipo === "actualizacion_ficha" &&
      item.resuelta !== true &&
      estado !== "completada" &&
      estado !== "cerrada";
  });
}

function getSolicitudFichaEstadoLabel(item = {}) {
  const estado = normalizeSearchLocal(item.estadoSolicitud || "");

  if (estado === "pendiente") return "Pendiente revisión jefa de ventas";
  if (estado === "revisada_jefa") return "Revisada por jefa / pendiente Administración";
  if (estado === "completada") return "Cerrada por Administración";

  return item.estadoSolicitud || "Sin estado";
}

function buildSolicitudFichaMensaje(item = {}) {
  return [
    `Estado: ${getSolicitudFichaEstadoLabel(item)}.`,
    item.solicitadoPor ? `Solicitado por: ${item.solicitadoPor}.` : "",
    item.detalle ? `Motivo vendedor: ${item.detalle}` : "Motivo vendedor: sin detalle registrado.",
    item.respuestaJefa ? `Respuesta jefa: ${item.respuestaJefa}` : "",
    item.respuestaAdministracion ? `Cierre administración: ${item.respuestaAdministracion}` : ""
  ].filter(Boolean).join("\n");
}

function buildAutomaticAlerts() {
  const list = [];
  const nextMeeting = getNextMeeting();

  if (nextMeeting) {
    const diff = daysBetween(nowDate(), toDate(nextMeeting.fechaInicio));

    if (diff >= 0 && diff <= 3) {
      list.push({
        id: `auto-reunion-${state.groupId}`,
        nivel: "info",
        titulo: "Reunión próxima",
        mensaje: `El grupo tiene reunión ${capitalize(nextMeeting.tipo || "presencial")} el ${formatDateTime(nextMeeting.fechaInicio)}.`
      });
    }

    if (diff < 0 && normalizeSearchLocal(nextMeeting.estadoReunion) === "agendada") {
      list.push({
        id: `auto-reunion-vencida-${state.groupId}`,
        nivel: "warning",
        titulo: "Reunión vencida sin cierre",
        mensaje: "Hay una reunión pasada que sigue marcada como agendada."
      });
    }
  }

  if (normalizeState(state.group.estado) === "ganada" && normalizeSearchLocal(state.group.fichaEstado) === "pendiente") {
    list.push({
      id: `auto-ficha-${state.groupId}`,
      nivel: "warning",
      titulo: "Ganada sin ficha",
      mensaje: "El grupo está ganado, pero la ficha todavía no se ha iniciado."
    });
  }

  if (normalizeSearchLocal(state.group.fichaEstado) === "lista_vendedor") {
    list.push({
      id: `auto-jefa-${state.groupId}`,
      nivel: "warning",
      titulo: "Pendiente firma jefa de ventas",
      mensaje: "La ficha quedó lista por vendedor(a) y espera revisión de jefa de ventas."
    });
  }

  if (normalizeSearchLocal(state.group.fichaEstado) === "revisada_jefa_ventas" && !state.group.autorizada) {
    list.push({
      id: `auto-admin-${state.groupId}`,
      nivel: "warning",
      titulo: "Pendiente firma administración",
      mensaje: "La ficha ya fue revisada por jefa de ventas y ahora espera firma de administración."
    });
  }

  const openFichaRequests = getOpenFichaUpdateRequestsForGroup();
  
  openFichaRequests.forEach((item, index) => {
    const estado = normalizeSearchLocal(item.estadoSolicitud || "");
  
    list.push({
      id: `auto-request-${state.groupId}-${item.id || index}`,
      nivel: estado === "pendiente" || estado === "revisada_jefa" ? "warning" : "info",
      titulo: "Solicitud de actualización de ficha",
      mensaje: buildSolicitudFichaMensaje(item)
    });
  });

  const lastClosedUpdate = toDate(state.group?.flowFicha?.ultimaActualizacionCerradaAt || null);
  if (lastClosedUpdate) {
    const diffClosed = daysBetween(new Date(), new Date(lastClosedUpdate));

    if (diffClosed >= 0 && diffClosed <= 7) {
      list.push({
        id: `auto-request-done-${state.groupId}`,
        nivel: "info",
        titulo: "Actualización de ficha completada",
        mensaje: `La solicitud de actualización ya fue aprobada nuevamente por administración el ${formatDateTime(lastClosedUpdate)}.`
      });
    }
  }

  if (state.group?.anoViajePorConfirmar === true) {
    list.push({
      id: `auto-ano-viaje-confirmar-${state.groupId}`,
      nivel: "critica",
      titulo: "AÑO DE VIAJE PENDIENTE DE CONFIRMAR",
      mensaje:
        `El año de viaje no era conocido al registrar este grupo. ` +
        `Se utilizó ${state.group?.anoViaje || getCurrentYear()} provisionalmente. ` +
        `Debe revisarse y corregirse desde Editar datos.`
    });
  }
  
  if (
    state.group?.cursoPorConfirmar === true ||
    normalizeCursoInput(state.group?.curso || "") === "0"
  ) {
    list.push({
      id: `auto-curso-confirmar-${state.groupId}`,
      nivel: "critica",
      titulo: "CURSO PENDIENTE DE CONFIRMAR",
      mensaje:
        "El curso no era conocido al registrar este grupo. " +
        "Debe revisarse y corregirse desde Editar datos."
    });
  }

  return list;
}

window.repararHistorialSolicitudesFicha = async function () {
  if (!state.canSeeAll) {
    alert("Solo administración/supervisión puede reparar historial.");
    return;
  }

  const solicitudes = state.requests.filter((item) =>
    normalizeSearchLocal(item.tipoSolicitud || "") === "actualizacion_ficha"
  );

  if (!solicitudes.length) {
    console.log("No hay solicitudes de actualización para reconstruir.");
    return;
  }

  let creadas = 0;

  for (const sol of solicitudes) {
    const yaExiste = state.history.some((h) =>
      normalizeSearchLocal(h.tipoMovimiento || "") === "solicitud_actualizacion_ficha" &&
      normalizeSearchLocal(h?.metadata?.solicitudId || "") === normalizeSearchLocal(sol.id || "")
    );

    if (yaExiste) continue;

    await addDoc(collection(db, HISTORIAL_COLLECTION), {
      idGrupo: String(state.groupId),
      codigoRegistro: cleanText(state.group?.codigoRegistro),
      aliasGrupo: cleanText(state.group?.aliasGrupo),
      colegio: cleanText(state.group?.colegio),

      tipoMovimiento: "solicitud_actualizacion_ficha",
      modulo: "ficha",
      titulo: "Solicitud de actualización de ficha",
      asunto: cleanText(sol.asunto || "Solicitud de actualización"),
      mensaje: `${sol.solicitadoPor || "Vendedor(a)"} solicitó actualización de la ficha. Motivo: ${sol.detalle || "Sin detalle registrado"}`,

      metadata: {
        solicitudId: sol.id,
        detalleSolicitud: sol.detalle || "",
        reconstruido: true
      },

      destacado: false,
      oculto: false,

      creadoPor: "Sistema",
      creadoPorCorreo: state.effectiveEmail,
      fecha: sol.fechaSolicitud || serverTimestamp()
    });

    await setDoc(doc(db, SOLICITUDES_COLLECTION, sol.id), {
      historialReconstruido: true,
      fechaReconstruccionHistorial: serverTimestamp()
    }, { merge: true });

    creadas++;
  }

  await loadAll();
  console.log(`Historial reconstruido. Entradas creadas: ${creadas}`);
};

/* =========================================================
   CONSOLA · TRACKING FORMULARIO INSCRIPCIÓN
========================================================= */

async function cargarSesionesTrackingInscripcionGrupo(idGrupoManual = "") {
  const idsBuscar = [
    cleanText(idGrupoManual),
    cleanText(state.groupId),
    cleanText(state.groupDocId),
    cleanText(state.requestedId)
  ].filter(Boolean);

  const idsUnicos = [...new Set(idsBuscar)];
  const docsMap = new Map();

  for (const id of idsUnicos) {
    const snap = await getDocs(
      query(
        collection(db, "inscripciones_sesiones_publicas"),
        where("idGrupo", "==", String(id))
      )
    );

    snap.docs.forEach((d) => {
      docsMap.set(d.id, {
        id: d.id,
        ...d.data()
      });
    });
  }

  return [...docsMap.values()];
}

function trackingToDate(value) {
  if (!value) return null;

  if (value?.toDate) return value.toDate();

  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function trackingMinutosEntre(inicio, fin) {
  const a = trackingToDate(inicio);
  const b = trackingToDate(fin);

  if (!a || !b) return null;

  return Math.round(((b.getTime() - a.getTime()) / 60000) * 10) / 10;
}

function trackingFechaTexto(value) {
  const d = trackingToDate(value);
  if (!d) return "—";

  return d.toLocaleString("es-CL", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function trackingPersonaKey(item = {}) {
  const persona = item.persona || {};

  const doc = cleanText(persona.documentoNormalizado || "");
  const correo = normalizeEmail(persona.correo || "");
  const nombre = normalizeSearchLocal(persona.nombreCompleto || "");

  if (doc) return `doc:${doc}`;
  if (correo) return `correo:${correo}`;
  if (nombre) return `nombre:${nombre}`;

  return `sesion:${item.id}`;
}

function trackingPersonaLabel(item = {}) {
  const persona = item.persona || {};

  return (
    cleanText(persona.nombreCompleto) ||
    normalizeEmail(persona.correo || "") ||
    cleanText(persona.documentoNormalizado) ||
    "Sin identificar"
  );
}

function trackingConstruirDetalle(sesiones = []) {
  return sesiones
    .map((item) => {
      const persona = item.persona || {};

      const abierto =
        item.abiertoEnCliente ||
        item.creadoEn ||
        item.creadoAt ||
        "";

      const enviado =
        item.enviadoEnCliente ||
        item.enviadoEn ||
        "";

      const actualizado =
        item.actualizadoEn ||
        item.actualizadoAt ||
        "";

      const enviadoBool = item.enviado === true || cleanText(item.estado) === "enviada";

      const minutosCompletar = enviadoBool
        ? trackingMinutosEntre(abierto, enviado || actualizado)
        : null;

      const minutosDesdeApertura = !enviadoBool
        ? trackingMinutosEntre(abierto, new Date())
        : null;

      return {
        sesionId: item.id,
        personaKey: trackingPersonaKey(item),
        persona: trackingPersonaLabel(item),
        documento: cleanText(persona.documentoNormalizado || ""),
        correo: normalizeEmail(persona.correo || ""),
        telefono: cleanText(persona.telefono || ""),
        tipoViajante: cleanText(persona.tipoViajante || ""),

        fase: cleanText(item.fase || ""),
        tipoInscripcion: cleanText(item.tipoInscripcion || ""),
        estado: cleanText(item.estado || ""),
        enviado: enviadoBool ? "Sí" : "No",
        avancePct: Number(item.avancePct || 0),
        avanceTramo: cleanText(item.avanceTramo || "0"),
        ultimoEvento: cleanText(item.ultimoEvento || ""),

        abierto: trackingFechaTexto(abierto),
        actualizado: trackingFechaTexto(actualizado),
        enviadoEn: trackingFechaTexto(enviado),

        minutosCompletar,
        minutosDesdeApertura
      };
    })
    .sort((a, b) => {
      if (a.enviado !== b.enviado) return a.enviado === "Sí" ? -1 : 1;
      return Number(b.avancePct || 0) - Number(a.avancePct || 0);
    });
}

function trackingConstruirResumen(detalle = []) {
  const totalSesiones = detalle.length;
  const enviadas = detalle.filter((x) => x.enviado === "Sí");
  const noEnviadas = detalle.filter((x) => x.enviado !== "Sí");

  const comenzaron = detalle.filter((x) =>
    Number(x.avancePct || 0) > 0 ||
    ["formulario_comenzado", "avance_formulario", "formulario_enviado"].includes(x.ultimoEvento)
  );

  const quedaronEnProceso = noEnviadas.filter((x) => Number(x.avancePct || 0) > 0);
  const abandonaronSinComenzar = noEnviadas.filter((x) => Number(x.avancePct || 0) === 0);

  const demoras = enviadas
    .map((x) => Number(x.minutosCompletar))
    .filter((n) => Number.isFinite(n));

  const promedioMinutos = demoras.length
    ? Math.round((demoras.reduce((a, b) => a + b, 0) / demoras.length) * 10) / 10
    : 0;

  const porPersonaMap = new Map();

  detalle.forEach((item) => {
    const key = item.personaKey;

    if (!porPersonaMap.has(key)) {
      porPersonaMap.set(key, {
        persona: item.persona,
        documento: item.documento,
        correo: item.correo,
        sesiones: 0,
        enviosCompletos: 0,
        intentosPendientes: 0,
        mejorAvancePendiente: 0,
        demoraUltimoEnvioMin: "",
        ultimoEstado: ""
      });
    }

    const acc = porPersonaMap.get(key);

    acc.sesiones += 1;

    if (item.enviado === "Sí") {
      acc.enviosCompletos += 1;
      acc.demoraUltimoEnvioMin = item.minutosCompletar ?? "";
    } else {
      acc.intentosPendientes += 1;
      acc.mejorAvancePendiente = Math.max(acc.mejorAvancePendiente, Number(item.avancePct || 0));
    }

    acc.ultimoEstado = item.enviado === "Sí"
      ? "enviada"
      : Number(item.avancePct || 0) > 0
        ? "en proceso / abandonada"
        : "abierta sin comenzar";
  });

  const porPersona = [...porPersonaMap.values()]
    .sort((a, b) => b.intentosPendientes - a.intentosPendientes || b.sesiones - a.sesiones);

  const resumen = {
    grupo: String(state.groupId || state.requestedId || ""),
    totalSesiones,
    personasDetectadas: porPersona.length,
    abrieron: totalSesiones,
    comenzaron: comenzaron.length,
    enviaron: enviadas.length,
    quedaronEnProceso: quedaronEnProceso.length,
    abandonaronSinComenzar: abandonaronSinComenzar.length,
    promedioDemoraEnvioMin: promedioMinutos,
    tasaEnvio: totalSesiones ? `${Math.round((enviadas.length / totalSesiones) * 100)}%` : "0%"
  };

  return {
    resumen,
    porPersona
  };
}

window.resumenTrackingInscripcionGrupo = async function (idGrupoManual = "") {
  const sesiones = await cargarSesionesTrackingInscripcionGrupo(idGrupoManual);
  const detalle = trackingConstruirDetalle(sesiones);
  const { resumen, porPersona } = trackingConstruirResumen(detalle);

  console.log("RESUMEN TRACKING INSCRIPCIÓN");
  console.table([resumen]);

  console.log("RESUMEN POR PERSONA");
  console.table(porPersona);

  return {
    resumen,
    porPersona,
    detalle
  };
};

window.detalleTrackingInscripcionGrupo = async function (idGrupoManual = "") {
  const sesiones = await cargarSesionesTrackingInscripcionGrupo(idGrupoManual);
  const detalle = trackingConstruirDetalle(sesiones);

  console.log("DETALLE TRACKING INSCRIPCIÓN");
  console.table(detalle);

  return detalle;
};

window.trackingPersonaInscripcionGrupo = async function (busqueda = "", idGrupoManual = "") {
  const texto = normalizeSearchLocal(busqueda);

  if (!texto) {
    console.warn("Debes buscar por nombre, correo, documento o parte del teléfono.");
    return [];
  }

  const sesiones = await cargarSesionesTrackingInscripcionGrupo(idGrupoManual);
  const detalle = trackingConstruirDetalle(sesiones);

  const filtrado = detalle.filter((item) => {
    const universo = normalizeSearchLocal([
      item.persona,
      item.documento,
      item.correo,
      item.telefono,
      item.tipoViajante,
      item.estado,
      item.ultimoEvento
    ].join(" "));

    return universo.includes(texto);
  });

  console.log(`TRACKING PERSONA: ${busqueda}`);
  console.table(filtrado);

  return filtrado;
};

window.resumenTrackingInscripciones = async function () {
  const snap = await getDocs(collection(db, "inscripciones_sesiones_publicas"));

  const sesiones = snap.docs.map((d) => ({
    id: d.id,
    ...d.data()
  }));

  const gruposMap = new Map();

  sesiones.forEach((s) => {
    const idGrupo = cleanText(s.idGrupo || "sin_grupo");
    if (!gruposMap.has(idGrupo)) gruposMap.set(idGrupo, []);
    gruposMap.get(idGrupo).push(s);
  });

  const resumenGrupos = [];

  for (const [idGrupo, sesionesGrupo] of gruposMap.entries()) {
    const detalle = trackingConstruirDetalle(sesionesGrupo);
    const { resumen } = trackingConstruirResumen(detalle);

    resumenGrupos.push({
      grupo: idGrupo,
      totalSesiones: resumen.totalSesiones,
      personasDetectadas: resumen.personasDetectadas,
      abrieron: resumen.abrieron,
      comenzaron: resumen.comenzaron,
      enviaron: resumen.enviaron,
      quedaronEnProceso: resumen.quedaronEnProceso,
      abandonaronSinComenzar: resumen.abandonaronSinComenzar,
      promedioDemoraEnvioMin: resumen.promedioDemoraEnvioMin,
      tasaEnvio: resumen.tasaEnvio
    });
  }

  resumenGrupos.sort((a, b) => {
    const tasaA = Number(String(a.tasaEnvio).replace("%", ""));
    const tasaB = Number(String(b.tasaEnvio).replace("%", ""));
    return tasaA - tasaB;
  });

  const totalSesiones = resumenGrupos.reduce((acc, x) => acc + x.totalSesiones, 0);
  const totalComenzaron = resumenGrupos.reduce((acc, x) => acc + x.comenzaron, 0);
  const totalEnviaron = resumenGrupos.reduce((acc, x) => acc + x.enviaron, 0);
  const totalProceso = resumenGrupos.reduce((acc, x) => acc + x.quedaronEnProceso, 0);
  const totalSinComenzar = resumenGrupos.reduce((acc, x) => acc + x.abandonaronSinComenzar, 0);

  const resumenGeneral = {
    gruposAnalizados: resumenGrupos.length,
    sesionesAbiertas: totalSesiones,
    comenzaron: totalComenzaron,
    enviaron: totalEnviaron,
    quedaronEnProceso: totalProceso,
    abandonaronSinComenzar: totalSinComenzar,
    tasaEnvioGeneral: totalSesiones ? `${Math.round((totalEnviaron / totalSesiones) * 100)}%` : "0%"
  };

  console.log("RESUMEN GENERAL TRACKING INSCRIPCIONES");
  console.table([resumenGeneral]);

  console.log("RESUMEN POR GRUPO");
  console.table(resumenGrupos);

  return {
    resumenGeneral,
    resumenGrupos
  };
};

function getTipoInscripcionEditableOptions() {
  return [
    { value: "sistema_pagos", label: "Sistema de Pagos" },
    { value: "nomina_inicial", label: "Inscripción inicial" },
    { value: "nomina_final", label: "Nómina final / ficha médica" },
    { value: "nuevo_ingreso", label: "Nuevo ingreso" },
    { value: "lista_espera", label: "Lista de espera" },
    { value: "lista_espera_pagada", label: "Lista de espera pagada" },
    { value: "lista_espera_confirmada", label: "Lista de espera confirmada" },
    { value: "liberado", label: "Cupo liberado" }
  ];
}

function getTipoPasajeroEditableOptions() {
  return [
    { value: "estudiante", label: "Estudiante" },
    { value: "adulto_acompanante", label: "Adulto(a) acompañante" },
    { value: "profesor", label: "Profesor(a)" }
  ];
}

function getGeneroEditableOptions() {
  return [
    { value: "masculino", label: "Masculino" },
    { value: "femenino", label: "Femenino" },
    { value: "otro", label: "Otro" }
  ];
}

function optionHtml(options = [], selected = "") {
  const selectedKey = normalizeSearchLocal(selected || "");

  return options.map((opt) => {
    const optKey = normalizeSearchLocal(opt.value || "");
    return `
      <option value="${escapeHtml(opt.value)}" ${optKey === selectedKey ? "selected" : ""}>
        ${escapeHtml(opt.label)}
      </option>
    `;
  }).join("");
}

async function openEditarNominaInscripcionModal() {
  if (!canEditarNominaInscripcion()) {
    alert("No tienes permisos para editar la nómina.");
    return;
  }

  const cargadas =
    await cargarTodasLasInscripcionesCompletas({
      mostrarProgreso: true
    });

  if (!cargadas) {
    alert(
      "No fue posible cargar todas las fichas completas. No se abrirá la edición de nómina."
    );

    return;
  }

  renderEditarNominaInscripcionModal();
  openModal("modalEditarNominaInscripcion");
}

function renderEditarNominaInscripcionModal() {
  const tbody = $("editarNominaBody");
  if (!tbody) return;

  const puedeEditarRutTipo = canEditarRutYTipoInscripcionNomina();

  tbody.innerHTML = state.inscripciones.map((item, index) => {
    const tipoReal = getInscripcionTipoReal(item);
    const tipoPasajero = item.tipoViajante || item.tipoParticipacion || "";
    const genero = getByPath(item, "identificacion.genero") || getByPath(item, "documentoIdentidad.sexoDocumento") || "";

    return `
      <tr data-inscripcion-edit-row="${escapeHtml(item.id)}">
        <td>${index + 1}</td>

        <td>
          <select data-field="tipoInscripcion" ${puedeEditarRutTipo ? "" : "disabled"}>
            ${optionHtml(getTipoInscripcionEditableOptions(), tipoReal)}
          </select>
        </td>

        <td>
          <input data-field="documento" value="${escapeHtml(getInscripcionDocumento(item))}" ${puedeEditarRutTipo ? "" : "disabled"} />
        </td>

        <td>
          <input data-field="apellidos" value="${escapeHtml(getInscripcionApellidos(item))}" />
        </td>

        <td>
          <input data-field="nombres" value="${escapeHtml(getInscripcionNombres(item))}" />
        </td>

        <td>
          <input data-field="fechaNacimiento" type="date" value="${escapeHtml(getFechaNacimientoInputValue(item))}" />
        </td>

        <td>
          <select data-field="tipoViajante">
            ${optionHtml(getTipoPasajeroEditableOptions(), tipoPasajero)}
          </select>
        </td>

        <td>
          <input data-field="nacionalidad" value="${escapeHtml(getInscripcionNacionalidad(item))}" />
        </td>

        <td>
          <select data-field="genero">
            ${optionHtml(getGeneroEditableOptions(), genero)}
          </select>
        </td>

        <td>
          <input data-field="responsable" value="${escapeHtml(getResponsablePrincipalNombre(item))}" />
        </td>

        <td>
          <input data-field="correoResponsable" value="${escapeHtml(getByPath(item, "contactoPrincipal.correo") || "")}" />
        </td>

        <td>
          <input data-field="celularResponsable" value="${escapeHtml(getByPath(item, "contactoPrincipal.celular") || getByPath(item, "contactoPrincipal.telefono") || getByPath(item, "contactoPrincipal.whatsapp") || "")}" />
        </td>

        <td>
          <button class="btn-ok" type="button" data-action="guardar-nomina-inscripcion" data-id="${escapeHtml(item.id)}">
            Guardar
          </button>
          <button class="btn-danger" type="button" data-action="archivar-nomina-inscripcion" data-id="${escapeHtml(item.id)}">
            Archivar
          </button>
        </td>
      </tr>
    `;
  }).join("");
}

function getFechaNacimientoInputValue(item = {}) {
  const raw = getByPath(item, "identificacion.fechaNacimiento") || "";
  if (!raw) return "";

  if (typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  if (typeof raw === "string" && /^\d{2}-\d{2}-\d{4}$/.test(raw)) {
    const [dd, mm, yyyy] = raw.split("-");
    return `${yyyy}-${mm}-${dd}`;
  }

  const d = toDate(raw);
  if (!d) return "";

  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");

  return `${yyyy}-${mm}-${dd}`;
}

function splitApellidosNomina(value = "") {
  const partes = cleanText(value || "").split(/\s+/).filter(Boolean);

  return {
    primerApellido: partes[0] || "",
    segundoApellido: partes.slice(1).join(" ")
  };
}

function buildNominaEditPatch(item = {}, values = {}) {
  const patch = {};
  const cambios = [];
  const puedeEditarRutTipo = canEditarRutYTipoInscripcionNomina();

  const addChange = (campo, anterior, nuevo) => {
    if (sameValue(anterior, nuevo)) return;
    setNestedValue(patch, campo, nuevo);
    cambios.push({ campo, anterior, nuevo });
  };

  const changed = (anterior, nuevo) => !sameValue(anterior || "", nuevo || "");

  const apellidosActual = getInscripcionApellidos(item);
  const nombresActual = getInscripcionNombres(item);
  const fechaActual = getFechaNacimientoInputValue(item);
  const tipoViajanteActual = item.tipoViajante || item.tipoParticipacion || "";
  const nacionalidadActual = getInscripcionNacionalidad(item);
  const generoActual =
    getByPath(item, "identificacion.genero") ||
    getByPath(item, "documentoIdentidad.sexoDocumento") ||
    "";
  const responsableActual = getResponsablePrincipalNombre(item);
  const correoActual = getByPath(item, "contactoPrincipal.correo") || "";
  const celularActual =
    getByPath(item, "contactoPrincipal.celular") ||
    getByPath(item, "contactoPrincipal.telefono") ||
    getByPath(item, "contactoPrincipal.whatsapp") ||
    "";

  if (changed(apellidosActual, values.apellidos)) {
    const apellidos = splitApellidosNomina(values.apellidos);
    addChange("identificacion.primerApellido", getByPath(item, "identificacion.primerApellido") || "", normalizeTextUpper(apellidos.primerApellido));
    addChange("identificacion.segundoApellido", getByPath(item, "identificacion.segundoApellido") || "", normalizeTextUpper(apellidos.segundoApellido));
  }

  if (changed(nombresActual, values.nombres)) {
    addChange("identificacion.nombres", getByPath(item, "identificacion.nombres") || "", normalizeTextUpper(values.nombres || ""));
  }

  if (changed(fechaActual, values.fechaNacimiento)) {
    addChange("identificacion.fechaNacimiento", getByPath(item, "identificacion.fechaNacimiento") || "", values.fechaNacimiento || "");
  }

  if (changed(tipoViajanteActual, values.tipoViajante)) {
    addChange("tipoViajante", item.tipoViajante || "", values.tipoViajante || "");
    addChange("tipoParticipacion", item.tipoParticipacion || "", values.tipoViajante || "");
  }

  if (changed(nacionalidadActual, values.nacionalidad)) {
    addChange("identificacion.nacionalidad", getByPath(item, "identificacion.nacionalidad") || "", normalizarTextoExport(values.nacionalidad || ""));
  }

  if (changed(generoActual, values.genero)) {
    addChange("identificacion.genero", getByPath(item, "identificacion.genero") || "", values.genero || "");
    addChange("documentoIdentidad.sexoDocumento", getByPath(item, "documentoIdentidad.sexoDocumento") || "", values.genero || "");
  }

  if (changed(responsableActual, values.responsable)) {
    addChange("contactoPrincipal.nombre", getByPath(item, "contactoPrincipal.nombre") || "", normalizeTextUpper(values.responsable || ""));
  }

  if (changed(correoActual, values.correoResponsable)) {
    addChange("contactoPrincipal.correo", getByPath(item, "contactoPrincipal.correo") || "", normalizeEmail(values.correoResponsable || ""));
  }

  if (changed(celularActual, values.celularResponsable)) {
    addChange("contactoPrincipal.celular", getByPath(item, "contactoPrincipal.celular") || "", cleanText(values.celularResponsable || ""));
  }

  if (puedeEditarRutTipo) {
    const documentoActual = getInscripcionDocumento(item);
    const documentoNuevo = cleanText(values.documento || "");

    if (changed(documentoActual, documentoNuevo)) {
      addChange("identificacion.documento", getByPath(item, "identificacion.documento") || "", documentoNuevo);
      addChange("identificacion.rutCompleto", getByPath(item, "identificacion.rutCompleto") || "", documentoNuevo);
    }

    const tipoActualPantalla = getInscripcionTipoReal(item);
    const tipoNuevo = values.tipoInscripcion || "";

    if (changed(tipoActualPantalla, tipoNuevo)) {
      addChange("tipoInscripcion", item.tipoInscripcion || "", tipoNuevo);
      addChange("faseInscripcion", item.faseInscripcion || "", getFaseDesdeTipoInscripcionEditable(tipoNuevo));
      addChange("estadoCupo", item.estadoCupo || "", getEstadoCupoDesdeTipoInscripcionEditable(tipoNuevo));
    }
  }

  return { patch, cambios };
}

function getFaseDesdeTipoInscripcionEditable(tipo = "") {
  const key = normalizeSearchLocal(tipo);

  if (key === "nomina_final") return "nomina_final";
  if (key === "nuevo_ingreso") return "nuevos";
  if (key === "lista_espera" || key === "lista_espera_pagada" || key === "lista_espera_confirmada") return "lista_espera";
  if (key === "liberado") return "liberado";

  return "normal";
}

function getEstadoCupoDesdeTipoInscripcionEditable(tipo = "") {
  const key = normalizeSearchLocal(tipo);

  if (key === "lista_espera_pagada") return "pagado";
  if (key === "lista_espera_confirmada") return "confirmado";
  if (key === "nuevo_ingreso") return "pendiente_confirmacion";

  return "confirmado";
}

function getNominaEditValuesFromRow(row) {
  const get = (field) => row.querySelector(`[data-field="${field}"]`)?.value || "";

  return {
    tipoInscripcion: get("tipoInscripcion"),
    documento: get("documento"),
    apellidos: get("apellidos"),
    nombres: get("nombres"),
    fechaNacimiento: get("fechaNacimiento"),
    tipoViajante: get("tipoViajante"),
    nacionalidad: get("nacionalidad"),
    genero: get("genero"),
    responsable: get("responsable"),
    correoResponsable: get("correoResponsable"),
    celularResponsable: get("celularResponsable")
  };
}

async function guardarNominaInscripcion(inscripcionId = "") {
  if (!canEditarNominaInscripcion()) {
    alert("No tienes permisos para editar la nómina.");
    return;
  }

  const item =
    await obtenerInscripcionCompleta(
      inscripcionId
    );
  
  if (!item) {
    alert(
      "No se pudo cargar la inscripción completa."
    );
  
    return;
  }

  const row = document.querySelector(`[data-inscripcion-edit-row="${CSS.escape(inscripcionId)}"]`);
  if (!row) return;

  const values = getNominaEditValuesFromRow(row);
  const { patch, cambios } = buildNominaEditPatch(item, values);

  if (!cambios.length) {
    showSaveNotice("No hay cambios para guardar.");
    return;
  }

  const ref = doc(
    db,
    "ventas_cotizaciones",
    String(state.groupDocId),
    "inscripciones",
    String(inscripcionId)
  );

  await updateDoc(ref, {
    ...patch,
    actualizadoPor: getDisplayName(state.effectiveUser),
    actualizadoPorCorreo: state.effectiveEmail,
    actualizadoAt: serverTimestamp()
  });

  await createHistoryEntry({
    tipoMovimiento: "edicion_nomina_inscripcion",
    modulo: "inscripcion",
    titulo: "Edición de nómina",
    mensaje: `${getDisplayName(state.effectiveUser)} editó la inscripción de ${getInscripcionNombres(item)} ${getInscripcionApellidos(item)}.`,
    metadata: {
      inscripcionId,
      documento: getInscripcionDocumento(item),
      cambios
    }
  });

  await recargarNominaCompletaDespuesDeCambio();
  
  showSaveNotice(
    "Inscripción actualizada."
  );
}

async function archivarNominaInscripcion(inscripcionId = "") {
  if (!canEditarNominaInscripcion()) {
    alert("No tienes permisos para archivar inscritos.");
    return;
  }

  const item =
    await obtenerInscripcionCompleta(
      inscripcionId
    );
  
  if (!item) {
    alert(
      "No se pudo cargar la inscripción completa."
    );
  
    return;
  }

  const nombre = `${getInscripcionNombres(item)} ${getInscripcionApellidos(item)}`.trim();

  const ok = confirm(`¿Archivar a ${nombre || "esta persona"}?\n\nNo se borrará, solo saldrá de la nómina visible.`);
  if (!ok) return;

  const ref = doc(
    db,
    "ventas_cotizaciones",
    String(state.groupDocId),
    "inscripciones",
    String(inscripcionId)
  );

  await updateDoc(ref, {
    privacidad: {
      ...(item.privacidad || {}),
      estado: "archivada",
      archivadaAt: serverTimestamp(),
      archivadaPor: getDisplayName(state.effectiveUser),
      archivadaPorCorreo: state.effectiveEmail,
      motivoArchivo: "Archivado manual desde Editar Nómina"
    }
  });

  await marcarInscripcionPublicaComoEliminada({
    ...item,
    privacidad: {
      ...(item.privacidad || {}),
      estado: "archivada"
    }
  });

  await createHistoryEntry({
    tipoMovimiento: "archivo_nomina_inscripcion",
    modulo: "inscripcion",
    titulo: "Inscripción archivada",
    mensaje: `${getDisplayName(state.effectiveUser)} archivó de la nómina a ${nombre || "una persona"}.`,
    metadata: {
      inscripcionId,
      documento: getInscripcionDocumento(item),
      nombreCompleto: nombre
    }
  });

  await recargarNominaCompletaDespuesDeCambio();
  
  showSaveNotice(
    "Inscripción archivada."
  );
}

/* =========================================================
   MODALS / EVENTS
========================================================= */
function bindEvents() {
  bindRichEditors();
  bindDatosModalControls();

  document.querySelectorAll("[data-close]").forEach((btn) => {
    btn.addEventListener("click", () => closeModal(btn.dataset.close));
  });

  document.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-confirmar-cupo]");
    if (!btn) return;
  
    confirmarCupoListaEspera(btn.dataset.confirmarCupo);
  });

  document.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-marcar-lista-pagada]");
    if (!btn) return;
  
    console.log("[INSCRIPCIONES] Click Marcar pagado detectado", {
      inscripcionId: btn.dataset.marcarListaPagada,
      email: state.effectiveEmail,
      rol: state.effectiveUser?.rol,
      estadoGrupo: state.group?.estado,
      puedeMarcarListaEsperaPagada: puedeMarcarListaEsperaPagada()
    });
  
    marcarListaEsperaPagada(btn.dataset.marcarListaPagada);
  });

  document.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-confirmar-nuevo-ingreso]");
    if (!btn) return;
  
    confirmarNuevoIngreso(btn.dataset.confirmarNuevoIngreso);
  });

  document.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-reenviar-correo-inscripcion]");
    if (!btn) return;
  
    openReenviarCorreoInscripcionModal(btn.dataset.reenviarCorreoInscripcion);
  });

  document.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-descargar-ficha-inscripcion]");
    if (!btn) return;
  
    descargarFichaInscripcionPdf(btn.dataset.descargarFichaInscripcion);
  });

  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-var]");
    if (!btn) return;
  
    const variable = btn.dataset.var || "";
    const wrap = btn.closest("[data-variable-targets]");
    if (!wrap || !variable) return;
  
    const targets = String(wrap.dataset.variableTargets || "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
  
    insertVariableAtActiveField(variable, targets);
  });

  $("btnAbrirPdfFicha")?.addEventListener("click", () => {
    const url = cleanText(state.ficha?.pdfUrl || state.group?.fichaPdfUrl || "");
    if (!url) {
      alert("Esta ficha todavía no tiene PDF guardado.");
      return;
    }
    window.open(url, "_blank", "noopener");
  });

  $("modalDatos")?.addEventListener("click", (e) => {
    if (e.target === $("modalDatos")) closeModal("modalDatos");
  });
  $("modalSituacion")?.addEventListener("click", (e) => {
    if (e.target === $("modalSituacion")) closeModal("modalSituacion");
  });
  $("modalDocumentos")?.addEventListener("click", (e) => {
    if (e.target === $("modalDocumentos")) closeModal("modalDocumentos");
  });
  $("modalReunion")?.addEventListener("click", (e) => {
    if (e.target === $("modalReunion")) closeModal("modalReunion");
  });
  $("modalAlerta")?.addEventListener("click", (e) => {
    if (e.target === $("modalAlerta")) closeModal("modalAlerta");
  });
  $("modalComentario")?.addEventListener("click", (e) => {
    if (e.target === $("modalComentario")) closeModal("modalComentario");
  });

    $("modalCorreo")?.addEventListener("click", (e) => {
    if (e.target === $("modalCorreo")) closeModal("modalCorreo");
  });

  $("modalTemplateEmail")?.addEventListener("click", (e) => {
    if (e.target === $("modalTemplateEmail")) closeModal("modalTemplateEmail");
  });

  $("modalNominaInicialPagos")?.addEventListener("click", (e) => {
    if (e.target === $("modalNominaInicialPagos")) closeModal("modalNominaInicialPagos");
  });

  $("modalResetCicloInscripcion")?.addEventListener("click", (e) => {
    if (e.target === $("modalResetCicloInscripcion")) closeModal("modalResetCicloInscripcion");
  });

  $("modalEditarNominaInscripcion")?.addEventListener("click", (e) => {
    if (e.target === $("modalEditarNominaInscripcion")) closeModal("modalEditarNominaInscripcion");
  });

  $("btnEditarDatosHero")?.addEventListener("click", openDatosModal);
  $("btnEditarDatos")?.addEventListener("click", openDatosModal);

  $("btnEditarSituacionHero")?.addEventListener("click", openSituacionModal);
  $("btnEditarSituacion")?.addEventListener("click", openSituacionModal);

  $("btnEditarDocumentos")?.addEventListener("click", openDocsModal);

  $("btnNuevaReunionHero")?.addEventListener("click", openMeetingModal);
  $("btnNuevaReunion")?.addEventListener("click", openMeetingModal);
  $("btnNuevaReunionListado")?.addEventListener("click", openMeetingModal);

  $("btnNuevaAlertaHero")?.addEventListener("click", openAlertModal);
  $("btnNuevaAlerta")?.addEventListener("click", openAlertModal);

  $("btnNuevoComentario")?.addEventListener("click", openCommentModal);

  $("btnGuardarDatos")?.addEventListener(
    "click",
    saveDatos
  );
  
  $("btnGuardarSituacion")?.addEventListener(
    "click",
    saveSituacion
  );
  
  $("btnGuardarElementosIncluidos")?.addEventListener(
    "click",
    guardarElementosIncluidos
  );
  
  $("s_elementoOtros")?.addEventListener(
    "change",
    syncElementosOtrosVisibility
  );
  
  $("btnGuardarDocumentos")?.addEventListener(
    "click",
    saveDocumentos
  );
  $("s_estado")?.addEventListener("change", syncSituacionStateUI);
  $("s_estado")?.addEventListener("input", syncSituacionStateUI);
  $("btnGuardarReunion")?.addEventListener("click", saveMeeting);
  $("btnGuardarAlerta")?.addEventListener("click", saveManualAlert);
  $("btnGuardarComentario")?.addEventListener("click", saveComment);

  $("email_template")?.addEventListener("change", () => {
    state.emailUi.selectedTemplateId = $("email_template")?.value || "";
    syncEmailTemplateButtons();
    applyEmailTemplateSelection();
  });

  $("btnGoGmail")?.addEventListener("click", goToGmailWithDraft);
  $("btnNewEmailTemplate")?.addEventListener("click", () => openEmailTemplateModal("create"));
  $("btnEditEmailTemplate")?.addEventListener("click", () => openEmailTemplateModal("edit"));
  $("btnDeleteEmailTemplate")?.addEventListener("click", deleteSelectedEmailTemplate);
  $("btnSaveEmailTemplate")?.addEventListener("click", saveEmailTemplate);

  $("btnHistoryToggleHidden")?.addEventListener("click", () => {
    state.historyUi.showHidden = !state.historyUi.showHidden;
    renderHistory();
  });

  $("btnHistoryMore")?.addEventListener("click", () => {
    state.historyUi.limit += 10;
    renderHistory();
  });

  $("r_tipo")?.addEventListener("change", syncMeetingTypeVisibility);

  $("meetingsList")?.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;

    const id = btn.dataset.id || "";
    const action = btn.dataset.action || "";

    if (action === "edit-meeting") {
      await openEditMeetingModal(id);
      return;
    }

    if (action === "complete-meeting") {
      await completeMeeting(id);
    }
  });

  $("btnFirmarVendedor")?.addEventListener("click", () => signFlow("vendedor"));
  $("btnFirmarJefaVentas")?.addEventListener("click", () => signFlow("jefaVentas"));
  $("btnFirmarAdministracion")?.addEventListener("click", () => signFlow("administracion"));
  
  $("btnCrearFicha")?.addEventListener("click", openFichaEditor);
  $("btnAbrirFichaPdf")?.addEventListener("click", openFichaPdf);
  $("btnHabilitarInscripcion")?.addEventListener("click", abrirInscripcionPrincipalDesdeBoton);
  $("btnCerrarConfirmarPoleraInscripcion")
    ?.addEventListener(
      "click",
      cerrarModalConfirmacionPolera
    );
  
  $("btnCancelarConfirmarPoleraInscripcion")
    ?.addEventListener(
      "click",
      cerrarModalConfirmacionPolera
    );
  
  $("btnRevisarElementosDesdeInscripcion")
    ?.addEventListener(
      "click",
      revisarTodosLosElementosDesdeConfirmacion
    );
  
  $("btnGuardarYAbrirInscripcion")
    ?.addEventListener(
      "click",
      guardarPoleraYAbrirInscripcion
    );
  $("modalConfirmarPoleraInscripcion")
    ?.addEventListener(
      "click",
      (event) => {
        if (
          event.target?.id ===
          "modalConfirmarPoleraInscripcion"
        ) {
          cerrarModalConfirmacionPolera();
        }
      }
    );
  $("btnCerrarInscripcion")?.addEventListener("click", cerrarInscripcion);
  $("btnAbrirNuevosInscritos")
    ?.addEventListener(
      "click",
      abrirNuevosIngresos
    );
  
  $("btnCopiarLinkNuevos")
    ?.addEventListener(
      "click",
      copiarLinkNuevosIngresos
    );
  
  $("btnCerrarNuevosInscritos")
    ?.addEventListener(
      "click",
      cerrarNuevosIngresos
    );
  
  $("btnAbrirListaEspera")
    ?.addEventListener(
      "click",
      abrirListaEspera
    );
  
  $("btnCopiarLinkListaEspera")
    ?.addEventListener(
      "click",
      copiarLinkListaEspera
    );
  
  $("btnCerrarListaEspera")
    ?.addEventListener(
      "click",
      cerrarListaEspera
    );
  
  $("btnCrearLinkLiberados")
    ?.addEventListener(
      "click",
      crearLinkLiberados
    );
  
  $("btnCopiarLinkLiberados")
    ?.addEventListener(
      "click",
      copiarLinkLiberados
    );
  
  $("btnCerrarLinkLiberados")
    ?.addEventListener(
      "click",
      cerrarLinkLiberados
    );
  $("btnCopiarLinkInscripcion")?.addEventListener("click", copyGroupInscripcionLink);

  document.addEventListener("click", async (event) => {
    const btnVer = event.target.closest("#btnVerNominaPasajeros");
  
    if (btnVer) {
      await toggleNominaPasajeros();
      return;
    }
  
    const btnRecargar = event.target.closest(
      "#btnRecargarNominaPasajeros"
    );
  
    if (btnRecargar) {
      await recargarNominaPasajeros();
    }
  });
  
  document.addEventListener("click", async (event) => {
    const btn = event.target.closest("#btnCorreosInscripcion");
    if (!btn) return;
  
    const cargada = await asegurarNominaCargada({
      mostrar: false,
      renderizar: false
    });
  
    if (!cargada) return;
  
    openEmailModalInscripcion();
  });

  document.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-email-bulk-select]");
    if (!btn) return;

    const mode = btn.dataset.emailBulkSelect;

    if (mode === "all") {
      state.emailUi.bulkRecipients = state.emailUi.bulkRecipients.map((d) => ({
        ...d,
        selected: true
      }));
    }

    if (mode === "pending") {
      state.emailUi.bulkRecipients = state.emailUi.bulkRecipients.map((d) => ({
        ...d,
        selected: d.pendienteFicha
      }));
    }

    if (mode === "none") {
      state.emailUi.bulkRecipients = state.emailUi.bulkRecipients.map((d) => ({
        ...d,
        selected: false
      }));
    }

    renderEmailBulkRecipients();
  });

  document.addEventListener("change", (event) => {
    const chk = event.target.closest("[data-email-bulk-index]");
    if (!chk) return;

    const index = Number(chk.dataset.emailBulkIndex);
    if (!Number.isFinite(index)) return;
    if (!state.emailUi.bulkRecipients[index]) return;

    state.emailUi.bulkRecipients[index].selected = chk.checked;
    renderEmailBulkRecipients();
  });
  $("btnGenerarLinkNominaPublica")?.addEventListener("click", generarLinkNominaPublica);
  $("btnNominaInicialPagos")?.addEventListener(
    "click",
    async () => {
      const cargada = await asegurarNominaCargada({
        mostrar: false,
        renderizar: false
      });
  
      if (!cargada) return;
  
      openNominaInicialPagosModal();
    }
  );
  $("btnEnviarNominaInicialPagos")?.addEventListener("click", enviarNominaInicialPagos);
  $("btnExportarInscripcionesExcel")?.addEventListener(
    "click",
    async () => {
      const cargada = await asegurarNominaCargada({
        mostrar: false,
        renderizar: false
      });
  
      if (!cargada) return;
  
      exportarInscripcionesExcel();
    }
  );
  
  $("btnExportarInscripcionesCsv")?.addEventListener(
    "click",
    async () => {
      const cargada = await asegurarNominaCargada({
        mostrar: false,
        renderizar: false
      });
  
      if (!cargada) return;
  
      exportarInscripcionesCsv();
    }
  );
  $("btnResetearCicloInscripcion")?.addEventListener("click", openResetCicloInscripcionModal);
  $("btnEditarNominaInscripcion")?.addEventListener(
    "click",
    async () => {
      const cargada = await asegurarNominaCargada({
        mostrar: true,
        renderizar: true
      });
  
      if (!cargada) return;
  
      openEditarNominaInscripcionModal();
    }
  );
  $("btnConfirmarResetCicloInscripcion")?.addEventListener("click", resetearCicloInscripcion);

  $("btnCrearContrato")?.addEventListener("click", () => {
    if (!state.group?.autorizada) {
      alert("El contrato se habilita cuando el grupo ya está AUTORIZADO.");
      return;
    }
    alert("Aquí conectarás el generador de contrato.");
  });

  $("editarNominaBody")?.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
  
    const id = btn.dataset.id || "";
    const action = btn.dataset.action || "";
  
    if (action === "guardar-nomina-inscripcion") {
      await guardarNominaInscripcion(id);
      return;
    }
  
    if (action === "archivar-nomina-inscripcion") {
      await archivarNominaInscripcion(id);
    }
  });

  $("alertsList")?.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-action='resolver-alerta']");
    if (!btn) return;

    const id = btn.dataset.id || "";
    await resolveManualAlert(id);
  });

  $("datosGrupoGrid")?.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-action='open-email-modal']");
    if (!btn) return;

    await openEmailModal({
      email: btn.dataset.email || "",
      contactLabel: btn.dataset.contactLabel || ""
    });
  });

  $("historyList")?.addEventListener("click", async (e) => {
    const detailBtn = e.target.closest("[data-action='toggle-history-detail']");
    if (detailBtn) {
      const targetId = detailBtn.dataset.target || "";
      const target = $(targetId);
      if (!target) return;

      const isHidden = target.classList.contains("hidden");
      target.classList.toggle("hidden", !isHidden);
      detailBtn.textContent = isHidden ? "Ver menos" : "Ver más";
      return;
    }

    const starBtn = e.target.closest("[data-action='toggle-history-star']");
    if (starBtn) {
      const id = starBtn.dataset.id || "";
      await toggleHistoryStar(id);
      return;
    }

    const hideBtn = e.target.closest("[data-action='toggle-history-hidden']");
    if (hideBtn) {
      const id = hideBtn.dataset.id || "";
      await toggleHistoryHidden(id);
    }
  });

  $("btnReencuadreZoomMenos")?.addEventListener("click", () => ajustarReencuadreZoom(-0.08));
  $("btnReencuadreZoomMas")?.addEventListener("click", () => ajustarReencuadreZoom(0.08));
  $("btnReencuadreRotarIzq")?.addEventListener("click", () => rotarReencuadre(-90));
  $("btnReencuadreRotarDer")?.addEventListener("click", () => rotarReencuadre(90));
  $("btnReencuadreCentrar")?.addEventListener("click", centrarReencuadreActivo);
  $("btnReencuadreGenerarPdf")?.addEventListener("click", generarPdfDesdeModalReencuadre);

  $("reencuadreCanvas")?.addEventListener("mousedown", iniciarDragReencuadre);
  $("reencuadreCanvas")?.addEventListener("mousemove", moverDragReencuadre);
  document.addEventListener("mouseup", terminarDragReencuadre);
}

function openModal(id) {
  $(id)?.classList.add("show");
}

function closeModal(id) {
  $(id)?.classList.remove("show");
}

function showSaveNotice(message = "Guardado correctamente.") {
  const old = document.getElementById("saveNoticeToast");
  if (old) old.remove();

  const toast = document.createElement("div");
  toast.id = "saveNoticeToast";
  toast.textContent = message;

  toast.style.position = "fixed";
  toast.style.right = "20px";
  toast.style.bottom = "20px";
  toast.style.zIndex = "99999";
  toast.style.background = "linear-gradient(135deg, #2b1145 0%, #4a2570 100%)";
  toast.style.color = "#fff";
  toast.style.padding = "12px 16px";
  toast.style.borderRadius = "14px";
  toast.style.boxShadow = "0 12px 28px rgba(43,17,69,.28)";
  toast.style.fontSize = "14px";
  toast.style.fontWeight = "800";
  toast.style.letterSpacing = ".15px";
  toast.style.opacity = "0";
  toast.style.transform = "translateY(8px)";
  toast.style.transition = "opacity .2s ease, transform .2s ease";

  document.body.appendChild(toast);

  requestAnimationFrame(() => {
    toast.style.opacity = "1";
    toast.style.transform = "translateY(0)";
  });

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(8px)";
    setTimeout(() => toast.remove(), 220);
  }, 2200);
}

function setSituacionBlockVisibility(id, shouldShow, displayValue = "block") {
  const el = $(id);
  if (!el) return;

  el.classList.toggle("hidden", !shouldShow);
  el.style.display = shouldShow ? displayValue : "none";
}

function syncSituacionStateUI() {
  const estadoRaw = $("s_estado")?.value || "";
  const estado = normalizeState(estadoRaw);
  const isGanada = estado === "ganada";
  const isReunion = estado === "reunion_confirmada";

  setSituacionBlockVisibility("wrapSituacionGanadaFields", isGanada, "grid");
  setSituacionBlockVisibility("wrapSituacionFechaReunion", isReunion, "block");

  const fechaInput = $("s_fechaReunion");
  if (fechaInput) {
    fechaInput.required = isReunion;

    if (!isReunion) {
      fechaInput.value = "";
    }
  }
}

function getSituacionMeetingBaseDate() {
  const fromGroup = toDate(state.group?.proximaReunionFecha || null);
  if (fromGroup) return fromGroup;

  const nextMeeting = getNextMeeting();
  const fromAgenda = toDate(nextMeeting?.fechaInicio || null);
  if (fromAgenda) return fromAgenda;

  return null;
}

async function createMeetingFromSituacionChange({ fechaReunionRaw = "", mensajeHistorial = "" } = {}) {
  const fechaInicioDate = new Date(fechaReunionRaw);

  if (Number.isNaN(fechaInicioDate.getTime())) {
    throw new Error("La fecha de la reunión no es válida.");
  }

  // Reunión de 1 hora por defecto
  const fechaFinDate = new Date(fechaInicioDate.getTime() + (60 * 60 * 1000));

  // Evita duplicar si ya existe una reunión activa exactamente en esa fecha/hora
  const yaExiste = state.meetings.some((meeting) => {
    const meetingDate = toDate(meeting.fechaInicio);
    if (!meetingDate) return false;

    const sameMoment = Math.abs(meetingDate.getTime() - fechaInicioDate.getTime()) < 60000;
    const notCancelled = normalizeSearchLocal(meeting.estadoReunion || "agendada") !== "cancelada";

    return sameMoment && notCancelled;
  });

  if (yaExiste) {
    return {
      created: false,
      patch: {}
    };
  }

  const meetingData = {
    idGrupo: String(state.groupId),
    codigoRegistro: cleanText(state.group.codigoRegistro),
    aliasGrupo: cleanText(state.group.aliasGrupo),
    colegio: cleanText(state.group.colegio),
    vendedora: cleanText(state.group.vendedora),
    vendedoraCorreo: normalizeEmail(state.group.vendedoraCorreo || ""),

    titulo: "Primera reunión",
    tipo: "por_definir",
    modalidad: "por_definir",
    fechaInicio: Timestamp.fromDate(fechaInicioDate),
    fechaFin: Timestamp.fromDate(fechaFinDate),
    direccion: "",
    link: "",
    estadoReunion: "agendada",
    resultado: "",
    observaciones: mensajeHistorial || "Primera reunión creada desde cambio de estado del grupo.",
    creadaDesde: "situacion_grupo",
    origenCalendario: true,

    creadoPor: getDisplayName(state.effectiveUser),
    creadoPorCorreo: state.effectiveEmail,
    fechaCreacion: serverTimestamp(),
    actualizadoPor: "",
    actualizadoPorCorreo: "",
    fechaActualizacion: null
  };

  await addDoc(collection(db, REUNIONES_COLLECTION), meetingData);

  await createHistoryEntry({
    tipoMovimiento: "reunion_creada",
    modulo: "agenda",
    titulo: "Primera reunión agendada",
    mensaje: `${getDisplayName(state.effectiveUser)} agendó la primera reunión del grupo.`,
    metadata: {
      cambios: [
        { campo: "reunion.titulo", anterior: "", nuevo: "Primera reunión" },
        { campo: "reunion.fechaInicio", anterior: "", nuevo: fechaReunionRaw },
        { campo: "reunion.tipo", anterior: "", nuevo: "por_definir" }
      ]
    }
  });

  return {
    created: true,
    patch: buildMeetingSummaryPatchAfterCreate(meetingData)
  };
}

function openDatosModal() {
  if (!canEditGroup()) {
    alert(getBlockedEditMessage());
    return;
  }

  hydrateDatosSelects(state.group);

  const destinoForm = resolveDestinoPrincipalForm(state.group);
  const programaForm = resolveProgramaForm(
    state.group,
    destinoForm.selectValue === "OTRO" ? destinoForm.otherValue : destinoForm.selectValue
  );
  const tramoForm = resolveTramoForm(state.group);
  const mesForm = resolveMesViajeForm(state.group);

  setText("d_estadoPreview", getEstadoLabel(state.group.estado));
  setText("d_vendedoraPreview", state.group.vendedora || state.group.vendedoraCorreo || "—");

  setFormValue("d_colegio", normalizeTextUpper(state.group.colegio || ""));
  const colegioInput = $("d_colegio");
  const colegioHelper = $("d_colegioHelper");
  
  if (colegioInput) {
    const canEditColegio = canEditSchoolName();
  
    colegioInput.disabled = !canEditColegio;
    colegioInput.readOnly = !canEditColegio;
  }
  
  if (colegioHelper) {
    colegioHelper.textContent = canEditSchoolName()
      ? "Admin y supervisión pueden editar el colegio. El cambio quedará registrado en el historial."
      : "Solo admin y supervisión pueden editar el colegio.";
  }
  setFormValue("d_curso", state.group.curso || "");
  setFormValue("d_anoViaje", state.group.anoViaje || "");
  setFormValue("d_cantidadGrupo", state.group.cantidadGrupo || "");

  setFormValue("d_destinoPrincipal", destinoForm.selectValue);
  setFormValue("d_destinoPrincipalOtro", destinoForm.otherValue);
  syncDatosDestinoOtroVisibility();

  syncDatosProgramaOptions(programaForm.selectValue, programaForm.otherValue);

  setFormValue("d_tramo", tramoForm.selectValue);
  setFormValue("d_tramoOtro", tramoForm.otherValue);
  syncDatosTramoOtroVisibility();

  setFormValue("d_mesViaje", mesForm.selectValue);
  setFormValue("d_mesViajeOtro", mesForm.otherValue);
  syncDatosMesViajeOtroVisibility();

  setFormValue("d_comunaCiudad", state.group.comunaCiudad || "");
  setFormValue("d_nombreCliente", state.group.nombreCliente || "");
  setFormValue("d_rolCliente", findCanonicalOption(ROL_CONTACTO_OPTIONS, state.group.rolCliente || ""));
  setFormValue("d_correoCliente", state.group.correoCliente || "");
  setFormValue("d_celularCliente", formatChileMobileForInput(state.group.celularCliente || ""));
  setFormValue("d_nombreCliente2", state.group.nombreCliente2 || "");
  setFormValue("d_rolCliente2", findCanonicalOption(ROL_CONTACTO_OPTIONS, state.group.rolCliente2 || ""));
  setFormValue("d_correoCliente2", state.group.correoCliente2 || "");
  setFormValue("d_celularCliente2", formatChileMobileForInput(state.group.celularCliente2 || ""));

  syncDatosAliasPreview();
  openModal("modalDatos");
}

function getSharedObsAdministracion(groupData = state.group || {}) {
  return (
    getByPath(groupData, "ficha.infoAdministracionHtml") ||
    getByPath(groupData, "situacion.observacionAdministracion") ||
    groupData.observacionesAdministracion ||
    ""
  );
}

function getSharedObsOperaciones(groupData = state.group || {}) {
  return (
    getByPath(groupData, "ficha.infoOperacionesHtml") ||
    getByPath(groupData, "situacion.observacionOperaciones") ||
    groupData.observacionesOperaciones ||
    ""
  );
}

function openSituacionModal() {
  if (!canOpenSituacionModal()) {
    alert(getBlockedEditMessage());
    return;
  }

  const estadoActual = normalizeState(
    state.group.estado
  );

  setFormValue("s_mensajeHistorial", "");

  const selectEstado = $("s_estado");

  if (selectEstado) {
    selectEstado.innerHTML = `
      <option value="contactado">Contactado</option>
      <option value="cotizando">Cotizando</option>
      <option value="recotizando">Recotizando</option>
      <option value="reunion_confirmada">Reunión confirmada</option>
      <option value="ganada">Ganada</option>
      <option value="perdida">Perdida</option>
    `;

    setFormValue(
      "s_estado",
      estadoActual === "a_contactar"
        ? "contactado"
        : estadoActual
    );
  }

  const meetingBaseDate =
    getSituacionMeetingBaseDate();

  setFormValue(
    "s_fechaReunion",
    meetingBaseDate
      ? toDatetimeLocal(meetingBaseDate)
      : ""
  );

  setRichEditorHtml(
    "s_obsAdmin",
    getSharedObsAdministracion(state.group)
  );

  setRichEditorHtml(
    "s_obsOperaciones",
    getSharedObsOperaciones(state.group)
  );

  fillElementosIncluidosModal();

  openModal("modalSituacion");

  requestAnimationFrame(() => {
    syncSituacionStateUI();
    syncSituacionModalPermissions();
  });

  setTimeout(() => {
    syncSituacionStateUI();
    syncSituacionModalPermissions();
  }, 0);
}

function openDocsModal() {
  if (!canEditDocuments()) {
    alert("Solo administración y supervisión pueden editar el estado de documentos.");
    return;
  }

  setFormValue("doc_fichaMedicaEstado", normalizeDocState(state.group.fichaMedicaEstado));
  setFormValue("doc_nominaEstado", normalizeDocState(state.group.nominaEstado));
  setFormValue("doc_fichaEstado", resolveFichaDocumentoEstado(state.group));
  setFormValue("doc_contratoEstado", normalizeDocState(state.group.contratoEstado));
  setFormValue("doc_cortesiaEstado", normalizeDocState(state.group.cortesiaEstado));

  openModal("modalDocumentos");
}

function openMeetingModal() {
  if (!canManageMeetings()) {
    alert("No tienes permisos para crear reuniones en este grupo.");
    return;
  }

  state.editingMeetingId = "";

  $("formReunion")?.reset();
  setDefaultMeetingDates();
  setFormValue("r_tipo", "presencial");
  syncMeetingTypeVisibility();
  setText("meetingModalTitle", "Nueva reunión");
  setText("btnGuardarReunionLabel", "Guardar reunión");
  openModal("modalReunion");
}

async function openEditMeetingModal(id) {
  if (!canManageMeetings()) {
    alert("No tienes permisos para editar reuniones en este grupo.");
    return;
  }

  const meeting = state.meetings.find((m) => m.id === id);
  if (!meeting) {
    alert("No se encontró la reunión.");
    return;
  }

  state.editingMeetingId = id;

  $("formReunion")?.reset();

  setFormValue("r_titulo", meeting.titulo || "");
  setFormValue("r_tipo", meeting.tipo || "presencial");

  const fecha = toDate(meeting.fechaInicio);
  if (fecha) {
    const yyyy = fecha.getFullYear();
    const mm = String(fecha.getMonth() + 1).padStart(2, "0");
    const dd = String(fecha.getDate()).padStart(2, "0");
    const hh = String(fecha.getHours()).padStart(2, "0");
    const mi = String(fecha.getMinutes()).padStart(2, "0");

    setFormValue("r_fecha", `${yyyy}-${mm}-${dd}`);
    setFormValue("r_horaInicio", `${hh}:${mi}`);
  } else {
    setFormValue("r_fecha", "");
    setFormValue("r_horaInicio", "");
  }

  setFormValue("r_direccion", meeting.direccion || "");
  setFormValue("r_link", meeting.link || "");
  setFormValue("r_observaciones", meeting.observaciones || "");

  syncMeetingTypeVisibility();
  setText("meetingModalTitle", "Editar reunión");
  setText("btnGuardarReunionLabel", "Guardar cambios");
  openModal("modalReunion");
}



function openAlertModal() {
  /*
   * Cualquier usuario con acceso al grupo
   * puede crear una alerta manual.
   */
  if (!canCreateAlertsAndComments()) {
    alert(
      "No tienes permisos para acceder a este grupo."
    );

    return;
  }

  const form =
    $("formAlerta");

  if (form) {
    form.reset();
  }

  /*
   * Las alertas manuales solamente pueden ser:
   *
   * - Pendiente
   * - Crítica
   *
   * Dejamos Pendiente como valor por defecto.
   */
  const nivel =
    $("a_nivel");

  if (nivel) {
    nivel.value =
      "warning";
  }

  openModal(
    "modalAlerta"
  );
}

function openCommentModal() {
  /*
   * Cualquier usuario con acceso al grupo
   * puede agregar comentarios.
   */
  if (!canCreateAlertsAndComments()) {
    alert(
      "No tienes permisos para acceder a este grupo."
    );

    return;
  }

  const form =
    $("formComentario");

  if (form) {
    form.reset();
  }

  openModal(
    "modalComentario"
  );
}

async function saveComment() {
  /*
   * Los comentarios son siempre permitidos
   * para usuarios con acceso al grupo.
   */
  if (!canCreateAlertsAndComments()) {
    alert(
      "No tienes permisos para acceder a este grupo."
    );

    return;
  }

  const mensaje =
    cleanText(
      $("c_mensaje")?.value || ""
    );

  if (!mensaje) {
    alert(
      "Debes escribir un comentario."
    );

    return;
  }

  const autor =
    getDisplayName(
      state.effectiveUser
    );

  /*
   * El comentario NO genera alerta.
   *
   * Solamente queda en historial.
   */
  await createHistoryEntry({
    tipoMovimiento:
      "comentario",

    modulo:
      "bitacora",

    titulo:
      "Nuevo comentario",

    asunto:
      "Comentario",

    mensaje,

    metadata: {
      autor,

      autorCorreo:
        state.effectiveEmail
    }
  });

  closeModal(
    "modalComentario"
  );

  await loadAll();

  showSaveNotice(
    "Comentario guardado correctamente."
  );
}

function getHistoryTypeLabel(item = {}) {
  const tipo = normalizeSearchLocal(item.tipoMovimiento || "");
  const modulo = normalizeSearchLocal(item.modulo || "");

  if (tipo.includes("comentario")) return "Comentario";
  if (tipo.includes("alerta")) return "Alerta";
  if (tipo.includes("reunion")) return "Reunión";
  if (tipo.includes("firma")) return "Firma";
  if (tipo.includes("estado")) return "Estado";
  if (tipo.includes("document")) return "Documento";

  if (modulo === "agenda") return "Reunión";
  if (modulo === "alertas") return "Alerta";
  if (modulo === "bitacora") return "Comentario";

  return "Movimiento";
}

function getHistoryCardClass(item = {}) {
  const tipo = getHistoryTypeLabel(item);

  if (tipo === "Comentario") return "is-comment";
  if (tipo === "Alerta") return "is-alert";
  if (tipo === "Reunión") return "is-meeting";
  if (tipo === "Firma") return "is-sign";
  if (tipo === "Estado") return "is-status";

  return "";
}

function truncateHistoryMessage(value = "", max = 220) {
  const text = cleanText(value || "");
  if (!text) return "";
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
}

async function toggleHistoryStar(historyId) {
  if (!canManageHistoryItems()) {
    alert("No tienes permisos para destacar elementos del historial de este grupo.");
    return;
  }

  const item = state.history.find((x) => x.id === historyId);
  if (!item) return;

  const nextValue = !item.destacado;

  await setDoc(doc(db, HISTORIAL_COLLECTION, historyId), {
    destacado: nextValue,
    destacadoAt: nextValue ? serverTimestamp() : null,
    destacadoPor: nextValue ? getDisplayName(state.effectiveUser) : "",
    destacadoPorCorreo: nextValue ? state.effectiveEmail : ""
  }, { merge: true });

  await loadAll();
}

async function toggleHistoryHidden(historyId) {
  if (!canManageHistoryItems()) {
    alert("No tienes permisos para ocultar elementos del historial de este grupo.");
    return;
  }

  const item = state.history.find((x) => x.id === historyId);
  if (!item) return;

  const nextValue = !item.oculto;
  const actionLabel = nextValue ? "ocultar" : "volver a mostrar";
  const ok = confirm(`¿Quieres ${actionLabel} este item del historial?`);
  if (!ok) return;

  await setDoc(doc(db, HISTORIAL_COLLECTION, historyId), {
    oculto: nextValue,
    ocultadoAt: nextValue ? serverTimestamp() : null,
    ocultadoPor: nextValue ? getDisplayName(state.effectiveUser) : "",
    ocultadoPorCorreo: nextValue ? state.effectiveEmail : ""
  }, { merge: true });

  await loadAll();
}
function syncMeetingTypeVisibility() {
  const type = String($("r_tipo")?.value || "presencial");
  $("wrapDireccion")?.classList.toggle("hidden", type !== "presencial");
  $("wrapLink")?.classList.toggle("hidden", type !== "virtual");
}

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
  if (!editor) return;

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

function renderRichText(id, html, fallback = "—") {
  const el = $(id);
  if (!el) return;

  const safe = sanitizeRichHtml(html || "");
  el.innerHTML = safe || fallback;
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

function stripHistoryHtml(value = "") {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isRichHistoryField(path = "") {
  return [
    "situacion.observacionAdministracion",
    "situacion.observacionOperaciones"
  ].includes(String(path || "").trim());
}

function getHistoryComparable(value, rich = false) {
  if (value === null || value === undefined) return "";

  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);

  if (Array.isArray(value)) {
    return value.map((item) => getHistoryComparable(item, false)).filter(Boolean).join(" | ").trim();
  }

  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  const raw = String(value || "");
  const text = rich ? stripHistoryHtml(raw) : raw;

  return text.replace(/\s+/g, " ").trim();
}

function getHistoryPreview(value, rich = false) {
  const text = getHistoryComparable(value, rich);
  if (!text) return "";
  return text.length > 180 ? `${text.slice(0, 177)}...` : text;
}

function classifyHistoryChangeType({ anterior, nuevo, rich = false } = {}) {
  const oldValue = getHistoryComparable(anterior, rich);
  const newValue = getHistoryComparable(nuevo, rich);

  if (oldValue === newValue) return "sin_cambio";
  if (!oldValue && newValue) return "agregado";
  if (oldValue && !newValue) return "eliminado";
  return "modificado";
}

function buildDetailedChanges(changes = []) {
  return (changes || [])
    .map((item) => {
      const campo = cleanText(item?.campo || "campo");
      const rich = isRichHistoryField(campo);

      const anterior = item?.anterior ?? "";
      const nuevo = item?.nuevo ?? "";
      const tipoCambio = classifyHistoryChangeType({ anterior, nuevo, rich });

      return {
        campo,
        tipoCambio,
        anterior,
        nuevo,
        anteriorPreview: getHistoryPreview(anterior, rich),
        nuevoPreview: getHistoryPreview(nuevo, rich)
      };
    })
    .filter((item) => item.tipoCambio !== "sin_cambio");
}

function buildHistorySubject({ titulo = "", cambios = [] } = {}) {
  const prefix = cleanText(titulo || "Movimiento");
  if (!cambios.length) return prefix;

  const first = cambios[0];
  const actionLabel = {
    agregado: "Agregado",
    eliminado: "Eliminado",
    modificado: "Modificado"
  }[first.tipoCambio] || "Cambio";

  if (cambios.length === 1) {
    return `${prefix} · ${actionLabel} ${prettyLabel(first.campo)}`;
  }

  return `${prefix} · ${actionLabel} ${prettyLabel(first.campo)} (+${cambios.length - 1})`;
}

function buildHistorySummary(cambios = []) {
  if (!cambios.length) return "";

  return cambios.map((item) => {
    const base = `${capitalize(item.tipoCambio)} ${prettyLabel(item.campo)}`;

    if (item.tipoCambio === "agregado") {
      return `${base}: ${item.nuevoPreview || "sin valor"}`;
    }

    if (item.tipoCambio === "eliminado") {
      return `${base}: ${item.anteriorPreview || "sin valor"}`;
    }

    return `${base}: ${item.anteriorPreview || "vacío"} → ${item.nuevoPreview || "vacío"}`;
  }).join(" | ");
}

/* =========================================================
   SAVE DATA
========================================================= */
async function saveDatos() {
  if (!canEditGroup()) {
    alert(getBlockedEditMessage());
    return;
  }

  const patch = {};
  const cambios = [];

  const destinoSeleccionado =
    normalizeDestinoCanonical(
      $("d_destinoPrincipal")?.value || ""
    );

  const destinoPrincipalOtro =
    normalizeTextUpper(
      $("d_destinoPrincipalOtro")?.value || ""
    );

  const programaOptions =
    getProgramOptionsByDestino(
      destinoSeleccionado
    );

  const programaSeleccionado =
    findCanonicalOption(
      programaOptions.length
        ? programaOptions
        : ["OTRO"],
      $("d_programa")?.value || ""
    );

  const programaOtro =
    normalizeTextUpper(
      $("d_programaOtro")?.value || ""
    );

  const tramoSeleccionado =
    findCanonicalOption(
      TRAMO_OPTIONS,
      $("d_tramo")?.value || ""
    );

  const tramoOtro =
    normalizeTextUpper(
      $("d_tramoOtro")?.value || ""
    );

  const mesViajeSeleccionado =
    findCanonicalOption(
      MES_VIAJE_OPTIONS,
      $("d_mesViaje")?.value || ""
    );

  const mesViajeOtro =
    normalizeTextUpper(
      $("d_mesViajeOtro")?.value || ""
    );

  const values = {
    colegio:
      normalizeTextUpper(
        $("d_colegio")?.value ||
        state.group?.colegio ||
        ""
      ),

    curso:
      normalizeCursoInput(
        $("d_curso")?.value || ""
      ),

    anoViaje:
      parseNumberOrText(
        $("d_anoViaje")?.value
      ),

    cantidadGrupo:
      parseNumberOrText(
        $("d_cantidadGrupo")?.value
      ),

    destinoPrincipal:
      destinoSeleccionado === "OTRO"
        ? "OTRO"
        : normalizeTextUpper(
            destinoSeleccionado
          ),

    destinoPrincipalOtro:
      destinoSeleccionado === "OTRO"
        ? destinoPrincipalOtro
        : "",

    programa:
      programaSeleccionado === "OTRO"
        ? "OTRO"
        : normalizeTextUpper(
            programaSeleccionado
          ),

    programaOtro:
      programaSeleccionado === "OTRO"
        ? programaOtro
        : "",

    tramo:
      tramoSeleccionado === "OTRO"
        ? "OTRO"
        : normalizeTextUpper(
            tramoSeleccionado
          ),

    tramoOtro:
      tramoSeleccionado === "OTRO"
        ? tramoOtro
        : "",

    mesViaje:
      mesViajeSeleccionado === "OTRO"
        ? "OTRO"
        : normalizeTextUpper(
            mesViajeSeleccionado
          ),

    mesViajeOtro:
      mesViajeSeleccionado === "OTRO"
        ? mesViajeOtro
        : "",

    semanaViaje:
      mesViajeSeleccionado === "OTRO"
        ? mesViajeOtro
        : normalizeTextUpper(
            mesViajeSeleccionado
          ),

    comunaCiudad:
      normalizeTextUpper(
        $("d_comunaCiudad")?.value || ""
      ),

    nombreCliente:
      normalizeTextUpper(
        $("d_nombreCliente")?.value || ""
      ),

    rolCliente:
      normalizeTextUpper(
        $("d_rolCliente")?.value || ""
      ),

    correoCliente:
      normalizeEmail(
        $("d_correoCliente")?.value || ""
      ),

    celularCliente:
      sanitizeChileMobileForSave(
        $("d_celularCliente")?.value || ""
      ),

    nombreCliente2:
      normalizeTextUpper(
        $("d_nombreCliente2")?.value || ""
      ),

    rolCliente2:
      normalizeTextUpper(
        $("d_rolCliente2")?.value || ""
      ),

    correoCliente2:
      normalizeEmail(
        $("d_correoCliente2")?.value || ""
      ),

    celularCliente2:
      sanitizeChileMobileForSave(
        $("d_celularCliente2")?.value || ""
      )
  };

  /*
   * El vendedor puede editar datos,
   * pero no cambiar el nombre del colegio.
   */
  if (!canEditSchoolName()) {
    values.colegio =
      normalizeTextUpper(
        state.group?.colegio || ""
      );
  }

  /*
   * =========================================================
   * DETECTAR CAMBIOS REALES
   * =========================================================
   */

  for (const path of DATA_FIELDS) {
    const nuevo =
      values[path];

    const anterior =
      getByPath(
        state.group,
        path
      );

    if (
      !sameValue(
        anterior,
        nuevo
      )
    ) {
      setNestedValue(
        patch,
        path,
        nuevo
      );

      cambios.push({
        campo:
          path,

        anterior,

        nuevo
      });
    }
  }

  /*
   * =========================================================
   * CONFIRMACIÓN DATOS PROVISIONALES
   * =========================================================
   */

  if (
    state.group?.cursoPorConfirmar === true &&
    values.curso &&
    values.curso !== "0"
  ) {
    patch.cursoPorConfirmar =
      false;

    cambios.push({
      campo:
        "cursoPorConfirmar",

      anterior:
        true,

      nuevo:
        false
    });
  }

  if (
    state.group?.anoViajePorConfirmar === true &&
    values.anoViaje
  ) {
    patch.anoViajePorConfirmar =
      false;

    cambios.push({
      campo:
        "anoViajePorConfirmar",

      anterior:
        true,

      nuevo:
        false
    });
  }

  /*
   * Si no cambió nada, no guardamos.
   */
  if (!cambios.length) {
    closeModal(
      "modalDatos"
    );

    return;
  }

  const changedFields =
    new Set(
      cambios.map(
        (c) => c.campo
      )
    );

  const changed =
    (field) =>
      changedFields.has(field);

  const changedAny =
    (...fields) =>
      fields.some(
        (field) =>
          changedFields.has(field)
      );

  /*
   * =========================================================
   * VALIDACIONES
   * =========================================================
   */

  if (
    changed("colegio") &&
    !values.colegio
  ) {
    alert(
      "El nombre del colegio no puede quedar vacío."
    );

    return;
  }

  if (changed("curso")) {
    if (!values.curso) {
      alert(
        "Si modificas el curso, no puede quedar vacío."
      );

      return;
    }

    if (
      !hasValidCursoFormat(
        values.curso
      )
    ) {
      alert(
        "El curso debe comenzar con un número válido (1 a 11) y luego puede llevar letras, todo junto y sin espacios. Ejemplo: 4C, 3DAVINCI, 10A."
      );

      return;
    }
  }

  if (
    changed("anoViaje") &&
    !values.anoViaje
  ) {
    alert(
      "Si modificas el año de viaje, no puede quedar vacío."
    );

    return;
  }

  if (
    changedAny(
      "destinoPrincipal",
      "destinoPrincipalOtro"
    )
  ) {
    if (!values.destinoPrincipal) {
      alert(
        "Si modificas el destino principal, debes seleccionar uno."
      );

      return;
    }

    if (
      values.destinoPrincipal === "OTRO" &&
      !values.destinoPrincipalOtro
    ) {
      alert(
        "Debes especificar el otro destino principal."
      );

      return;
    }
  }

  if (
    changedAny(
      "programa",
      "programaOtro"
    )
  ) {
    if (!values.programa) {
      alert(
        "Si modificas el programa, debes seleccionar uno."
      );

      return;
    }

    if (
      values.programa === "OTRO" &&
      !values.programaOtro
    ) {
      alert(
        "Debes especificar el otro programa."
      );

      return;
    }
  }

  if (
    changedAny(
      "tramo",
      "tramoOtro"
    )
  ) {
    if (!values.tramo) {
      alert(
        "Si modificas el tramo, debes seleccionar uno."
      );

      return;
    }

    if (
      values.tramo === "OTRO" &&
      !values.tramoOtro
    ) {
      alert(
        "Debes especificar el otro tramo."
      );

      return;
    }
  }

  if (
    changedAny(
      "mesViaje",
      "mesViajeOtro"
    )
  ) {
    if (!values.mesViaje) {
      alert(
        "Si modificas el mes de viaje, debes seleccionar uno."
      );

      return;
    }

    if (
      values.mesViaje === "OTRO" &&
      !values.mesViajeOtro
    ) {
      alert(
        "Debes especificar el otro mes de viaje."
      );

      return;
    }
  }

  /*
   * =========================================================
   * RECALCULAR ALIAS
   * =========================================================
   */

  if (
    changedAny(
      "colegio",
      "curso",
      "anoViaje"
    )
  ) {
    const {
      anoBase,
      cursoViaje,
      aliasGrupo,
      aliasTripKey
    } =
      buildDatosAliasPayload();

    if (!values.colegio) {
      alert(
        "No se encontró el colegio del grupo."
      );

      return;
    }

    if (!values.curso) {
      alert(
        "Para reconstruir el alias, el curso no puede quedar vacío."
      );

      return;
    }

    if (
      !hasValidCursoFormat(
        values.curso
      )
    ) {
      alert(
        "El curso debe comenzar con un número válido (1 a 11) y luego puede llevar letras, todo junto y sin espacios. Ejemplo: 4C, 3DAVINCI, 10A."
      );

      return;
    }

    if (!values.anoViaje) {
      alert(
        "Para reconstruir el alias, el año de viaje no puede quedar vacío."
      );

      return;
    }

    if (
      !cursoViaje ||
      !aliasGrupo ||
      !aliasTripKey
    ) {
      alert(
        "No se pudo reconstruir el alias del grupo. Revisa colegio, curso y año de viaje."
      );

      return;
    }

    const derivedValues = {
      anoBaseCurso:
        String(
          anoBase
        ),

      cursoViaje,

      aliasTripKey
    };

    /*
     * Si el nombre fue editado manualmente desde la ficha,
     * no pisamos aliasGrupo.
     */
    if (
      state.group?.nombreGrupoManual !== true
    ) {
      derivedValues.aliasGrupo =
        aliasGrupo;
    }

    Object.entries(
      derivedValues
    ).forEach(
      ([path, nuevo]) => {
        const anterior =
          getByPath(
            state.group,
            path
          );

        if (
          !sameValue(
            anterior,
            nuevo
          )
        ) {
          setNestedValue(
            patch,
            path,
            nuevo
          );

          cambios.push({
            campo:
              path,

            anterior,

            nuevo
          });
        }
      }
    );
  }

  /*
   * =========================================================
   * ESPEJO GRUPO -> FICHA
   * =========================================================
   *
   * Si ya existe ficha, los datos compartidos
   * quedan inmediatamente iguales.
   *
   * Si todavía no existe ficha, no se crea aquí:
   * hydrateFicha() los tomará desde el grupo.
   */

  const fichaMirror =
    buildFichaMirrorFromGroupValues(
      values
    );

  if (fichaMirror) {
    patch.ficha =
      fichaMirror;
  }

  /*
   * Mantiene las reglas críticas existentes:
   * reapertura, PDF, firmas, etc.
   */
  await applyCriticalChangeRules(
    patch,
    cambios
  );

  await saveGroupPatch(
    patch,
    {
      tipoMovimiento:
        "edicion_datos",

      modulo:
        "grupo",

      titulo:
        "Modificación manual de datos",

      mensaje:
        `${getDisplayName(state.effectiveUser)} modificó datos del grupo.`,

      cambios
    }
  );

  closeModal(
    "modalDatos"
  );

  showSaveNotice(
    "Datos guardados correctamente."
  );
}

async function saveSituacion() {
if (!canEditSituacionGrupo()) {
    alert(getBlockedEditMessage());
    return;
  }

  const patch = {};
  const cambios = [];

  const estadoAnterior = normalizeState(state.group.estado || "a_contactar");
  const estadoNuevo = normalizeState($("s_estado")?.value || "a_contactar");
  const mensajeHistorial = cleanText($("s_mensajeHistorial")?.value || "");
  const fechaReunionRaw = $("s_fechaReunion")?.value || "";

  const isGanada = estadoNuevo === "ganada";
  const isReunionConfirmada = estadoNuevo === "reunion_confirmada";

  // Siempre obligatorio
  if (!mensajeHistorial) {
    alert("Debes escribir un mensaje del cambio.");
    return;
  }

  if (isReunionConfirmada && !fechaReunionRaw) {
    alert("Debes indicar la fecha de la reunión cuando el estado es Reunión confirmada.");
    return;
  }

  const flujoNormal = {
    a_contactar: ["contactado"],
    contactado: ["cotizando"],
    cotizando: ["reunion_confirmada"],
    reunion_confirmada: ["ganada", "perdida", "recotizando"],
    perdida: ["recotizando"],
    recotizando: ["cotizando", "reunion_confirmada", "ganada", "perdida"],
    ganada: ["contactado", "cotizando", "reunion_confirmada", "recotizando", "perdida"]
  };
  
  const cambioEstado = estadoNuevo !== estadoAnterior;
  const esSaltoFlujo =
    cambioEstado &&
    estadoNuevo !== "ganada" &&
    !(flujoNormal[estadoAnterior] || []).includes(estadoNuevo);
  
  const esGanadaSaltando =
    cambioEstado &&
    estadoNuevo === "ganada" &&
    estadoAnterior !== "reunion_confirmada";
  
  let justificacionSalto = "";
  
  if (esSaltoFlujo || esGanadaSaltando) {
    const omitidos =
      esGanadaSaltando
        ? getPasosOmitidosHastaGanada(estadoAnterior)
        : [];
  
    const ok = confirm(
      [
        "Estás realizando un cambio fuera del flujo comercial normal.",
        "",
        `Cambio: ${getEstadoLabel(estadoAnterior)} → ${getEstadoLabel(estadoNuevo)}`,
        omitidos.length ? `Pasos omitidos: ${omitidos.map(getEstadoLabel).join(", ")}` : "",
        "",
        "Este salto quedará registrado en el historial.",
        "¿Deseas continuar?"
      ].filter(Boolean).join("\n")
    );
  
    if (!ok) return;
  
    justificacionSalto = cleanText(
      window.prompt(
        "Justifica el salto de flujo. Esto quedará en el historial:",
        mensajeHistorial
      ) || ""
    );
  
    if (!justificacionSalto) {
      alert("Debes justificar el salto de flujo.");
      return;
    }
  }

  // 1) Cambio de estado
  if (estadoNuevo !== estadoAnterior) {
    patch.estado = estadoNuevo;
    cambios.push({
      campo: "estado",
      anterior: estadoAnterior,
      nuevo: estadoNuevo
    });
  }

  // 2) Si queda en reunión confirmada, además crear/agendar la primera reunión real
  if (isReunionConfirmada) {
    try {
      const meetingResult = await createMeetingFromSituacionChange({
        fechaReunionRaw,
        mensajeHistorial
      });

      if (meetingResult?.patch) {
        Object.assign(patch, meetingResult.patch);
      }

      const fechaAnteriorTxt = toDatetimeLocal(
        toDate(state.group.proximaReunionFecha || getNextMeeting()?.fechaInicio || null)
      );

      if (fechaAnteriorTxt !== fechaReunionRaw) {
        cambios.push({
          campo: "proximaReunionFecha",
          anterior: fechaAnteriorTxt || "",
          nuevo: fechaReunionRaw
        });
      }
    } catch (error) {
      alert(error.message || "No se pudo crear la reunión.");
      return;
    }
  }

    // Si el grupo venía como legacy, pero recién ahora entra a GANADA
  // y todavía no tiene firmas reales ni flujo avanzado,
  // lo dejamos listo para iniciar el flujo nuevo desde cero.
  if (isGanada) {
    const flowActual = state.group.flowFicha || {};
    const fichaEstadoActual = normalizeSearchLocal(
      state.group?.fichaEstado ||
      state.group?.ficha?.estado ||
      ""
    );

    const hasRealFlowStarted =
      !!flowActual?.vendedor?.firmado ||
      !!flowActual?.jefaVentas?.firmado ||
      !!flowActual?.administracion?.firmado ||
      !!state.group?.autorizada ||
      [
        "lista_vendedor",
        "revisada_jefa_ventas",
        "autorizada_admin",
        "confirmada_pdf",
        "pdf_confirmado",
        "ok"
      ].includes(fichaEstadoActual);

    const veniaLegacy = getFichaFlowMode(state.group) === "legacy";

    if (veniaLegacy && !hasRealFlowStarted) {
      patch.fichaFlujoModo = "";
      patch.fichaEstado = "pendiente";
      patch.firmaVendedor = "";
      patch.firmaSupervision = "";
      patch.firmaAdministracion = "";
      patch.autorizada = false;

      patch.ficha = {
        ...(state.group.ficha || {}),
        flujoModo: "",
        estado: "pendiente",
        confirmada: false,
        pdfPendienteGeneracion: false,
        pdfUrl: "",
        pdfNombre: ""
      };

      patch.flowFicha = {
        ...(state.group.flowFicha || {}),
        modo: "",
        legacy: false,
        estado: "pendiente",
        requiereActualizacion: false,
        requiereRefirmaAdministracion: false,

        vendedor: {
          ...(flowActual.vendedor || {}),
          firmado: false,
          firmadoAt: null,
          firmadoPor: "",
          firmadoPorCorreo: "",
          observacion: ""
        },

        jefaVentas: {
          ...(flowActual.jefaVentas || {}),
          firmado: false,
          firmadoAt: null,
          firmadoPor: "",
          firmadoPorCorreo: "",
          observacion: ""
        },

        administracion: {
          ...(flowActual.administracion || {}),
          firmado: false,
          firmadoAt: null,
          firmadoPor: "",
          firmadoPorCorreo: "",
          observacion: ""
        }
      };

      patch.documentos = {
        ...(state.group.documentos || {}),
        fichaGrupo: {
          ...(state.group.documentos?.fichaGrupo || {}),
          estado: "pendiente"
        }
      };

      if (!sameValue(state.group?.fichaFlujoModo || "", "")) {
        cambios.push({
          campo: "fichaFlujoModo",
          anterior: state.group?.fichaFlujoModo || "",
          nuevo: ""
        });
      }

      if (!sameValue(state.group?.fichaEstado || "", "pendiente")) {
        cambios.push({
          campo: "fichaEstado",
          anterior: state.group?.fichaEstado || "",
          nuevo: "pendiente"
        });
      }
    }
  }

  // 3) Si queda en ganada, guardar observaciones enriquecidas
  if (isGanada) {
    const adminNuevo = getRichEditorHtml("s_obsAdmin");
    const opsNuevo = getRichEditorHtml("s_obsOperaciones");

    const adminAnterior = getSharedObsAdministracion(state.group);
    const opsAnterior = getSharedObsOperaciones(state.group);
    
    if (normalizeRichHtml(adminAnterior) !== normalizeRichHtml(adminNuevo)) {
      // espejo grupo
      setNestedValue(patch, "situacion.observacionAdministracion", adminNuevo);
      patch.observacionesAdministracion = adminNuevo;
    
      // espejo ficha
      setNestedValue(patch, "ficha.infoAdministracionHtml", adminNuevo);
    
      cambios.push({
        campo: "situacion.observacionAdministracion",
        anterior: adminAnterior,
        nuevo: adminNuevo
      });
    }
    
    if (normalizeRichHtml(opsAnterior) !== normalizeRichHtml(opsNuevo)) {
      // espejo grupo
      setNestedValue(patch, "situacion.observacionOperaciones", opsNuevo);
      patch.observacionesOperaciones = opsNuevo;
    
      // espejo ficha
      setNestedValue(patch, "ficha.infoOperacionesHtml", opsNuevo);
    
      cambios.push({
        campo: "situacion.observacionOperaciones",
        anterior: opsAnterior,
        nuevo: opsNuevo
      });
    }
  }

  if (!cambios.length) {
    alert("No hay cambios para guardar.");
    return;
  }

  await applyCriticalChangeRules(patch, cambios);

  const omitidosFinal = getPasosOmitidosHastaGanada(estadoAnterior);
  
  const mensajeFinal = [
    mensajeHistorial,
    (esSaltoFlujo || esGanadaSaltando)
      ? `⚠️ Cambio con salto de flujo comercial: ${getEstadoLabel(estadoAnterior)} → ${getEstadoLabel(estadoNuevo)}.`
      : "",
    esGanadaSaltando && omitidosFinal.length
      ? `Pasos omitidos: ${omitidosFinal.map(getEstadoLabel).join(", ")}.`
      : "",
    justificacionSalto
      ? `Justificación del salto: ${justificacionSalto}.`
      : ""
  ].filter(Boolean).join("\n\n");
  
  await saveGroupPatch(patch, {
    tipoMovimiento: (esSaltoFlujo || esGanadaSaltando)
      ? "cambio_estado_salto_flujo"
      : "cambio_estado",
    modulo: "grupo",
    titulo: (esSaltoFlujo || esGanadaSaltando)
      ? "Cambio de situación con salto de flujo"
      : "Actualización de situación",
    asunto: `Cambio de situación · ${getEstadoLabel(estadoAnterior)} → ${getEstadoLabel(estadoNuevo)}`,
    mensaje: mensajeFinal,
    cambios,
    metadata: {
      saltoFlujo: esSaltoFlujo || esGanadaSaltando,
      estadoAnterior,
      estadoNuevo,
      pasosOmitidos: esGanadaSaltando ? omitidosFinal : [],
      justificacionSalto
    }
  });

  closeModal("modalSituacion");
  showSaveNotice("Situación guardada correctamente.");
}

function getPasosOmitidosHastaGanada(estadoAnterior = "") {
  const orden = ["contactado", "cotizando", "reunion_confirmada", "ganada"];
  const fromIndex = orden.indexOf(normalizeState(estadoAnterior));
  const toIndex = orden.indexOf("ganada");

  if (fromIndex < 0 || fromIndex >= toIndex) return [];

  return orden.slice(fromIndex + 1, toIndex);
}

async function saveDocumentos() {
    if (!canEditDocuments()) {
    alert("Solo administración y supervisión pueden editar el estado de documentos.");
    return;
  }
  
  const patch = {};
  const cambios = [];

  const fichaPdfUrl = getFichaDocumentoPdfUrl(state.group);
  
  const values = {
    fichaMedicaEstado: $("doc_fichaMedicaEstado")?.value || "pendiente",
    nominaEstado: $("doc_nominaEstado")?.value || "pendiente",
  
    // Si ya existe PDF real, este documento debe quedar cumplido.
    fichaEstado: fichaPdfUrl
      ? "ok"
      : ($("doc_fichaEstado")?.value || "pendiente"),
  
    contratoEstado: $("doc_contratoEstado")?.value || "pendiente",
    cortesiaEstado: $("doc_cortesiaEstado")?.value || "pendiente"
  };

  for (const path of DOC_FIELDS) {
    const nuevo = values[path];
    const anterior = normalizeDocState(getByPath(state.group, path));

    if (!sameValue(anterior, nuevo)) {
      patch[path] = nuevo;
      cambios.push({ campo: path, anterior, nuevo });
    }
  }

  if (!sameValue(getByPath(state.group, "documentos.fichaMedica.estado"), values.fichaMedicaEstado)) {
    setNestedValue(patch, "documentos.fichaMedica.estado", values.fichaMedicaEstado);
  }
  if (!sameValue(getByPath(state.group, "documentos.nomina.estado"), values.nominaEstado)) {
    setNestedValue(patch, "documentos.nomina.estado", values.nominaEstado);
  }
  if (!sameValue(getByPath(state.group, "documentos.fichaGrupo.estado"), values.fichaEstado)) {
    setNestedValue(patch, "documentos.fichaGrupo.estado", values.fichaEstado);
  }
  if (!sameValue(getByPath(state.group, "documentos.contrato.estado"), values.contratoEstado)) {
    setNestedValue(patch, "documentos.contrato.estado", values.contratoEstado);
  }
  if (!sameValue(getByPath(state.group, "documentos.cortesia.estado"), values.cortesiaEstado)) {
    setNestedValue(patch, "documentos.cortesia.estado", values.cortesiaEstado);
  }

  if (!cambios.length) {
    closeModal("modalDocumentos");
    return;
  }

  await applyCriticalChangeRules(patch, cambios);
  await saveGroupPatch(patch, {
    tipoMovimiento: "documento_actualizado",
    modulo: "documentos",
    titulo: "Actualización de documentos",
    mensaje: `${getDisplayName(state.effectiveUser)} actualizó el control documental del grupo.`,
    cambios
  });

  closeModal("modalDocumentos");
  showSaveNotice("Documentos guardados correctamente.");
}

async function saveMeeting() {
  if (!canManageMeetings()) {
    alert("No tienes permisos para guardar reuniones en este grupo.");
    return;
  }

  const titulo = cleanText($("r_titulo")?.value);
  const tipo = String($("r_tipo")?.value || "presencial");
  const fecha = $("r_fecha")?.value || "";
  const horaInicio = $("r_horaInicio")?.value || "";
  const direccion = cleanText($("r_direccion")?.value);
  const link = cleanText($("r_link")?.value);
  const observaciones = cleanText($("r_observaciones")?.value);

  if (!titulo) {
    alert("Debes ingresar un título para la reunión.");
    return;
  }

  if (!fecha || !horaInicio) {
    alert("Debes ingresar la fecha y la hora de inicio.");
    return;
  }

  if (tipo === "presencial" && !direccion) {
    alert("Para reuniones presenciales debes ingresar dirección.");
    return;
  }

  if (tipo === "virtual" && !link) {
    alert("Para reuniones virtuales debes ingresar link.");
    return;
  }

  const fechaInicio = new Date(`${fecha}T${horaInicio}`);
  if (Number.isNaN(fechaInicio.getTime())) {
    alert("La fecha u hora ingresada no es válida.");
    return;
  }

  // duración interna referencial de 1 hora
  const fechaFin = new Date(fechaInicio.getTime() + 60 * 60 * 1000);

  const data = {
    idGrupo: String(state.groupId),
    codigoRegistro: cleanText(state.group.codigoRegistro),
    aliasGrupo: cleanText(state.group.aliasGrupo),
    colegio: cleanText(state.group.colegio),
    vendedora: cleanText(state.group.vendedora),
    vendedoraCorreo: normalizeEmail(state.group.vendedoraCorreo || ""),

    titulo,
    tipo,
    modalidad: tipo,
    fechaInicio: Timestamp.fromDate(fechaInicio),
    fechaFin: Timestamp.fromDate(fechaFin),
    direccion: tipo === "presencial" ? direccion : "",
    link: tipo === "virtual" ? link : "",
    estadoReunion: "agendada",
    resultado: "",
    observaciones,
    creadaDesde: "grupo",
    origenCalendario: true,

    creadoPor: getDisplayName(state.effectiveUser),
    creadoPorCorreo: state.effectiveEmail,
    fechaCreacion: serverTimestamp(),
    actualizadoPor: "",
    actualizadoPorCorreo: "",
    fechaActualizacion: null
  };

  if (state.editingMeetingId) {
    const current = state.meetings.find((m) => m.id === state.editingMeetingId);

    await updateDoc(doc(db, REUNIONES_COLLECTION, state.editingMeetingId), {
      titulo,
      tipo,
      modalidad: tipo,
      fechaInicio: Timestamp.fromDate(fechaInicio),
      fechaFin: Timestamp.fromDate(fechaFin),
      direccion: tipo === "presencial" ? direccion : "",
      link: tipo === "virtual" ? link : "",
      observaciones,
      actualizadoPor: getDisplayName(state.effectiveUser),
      actualizadoPorCorreo: state.effectiveEmail,
      fechaActualizacion: serverTimestamp()
    });

    await createHistoryEntry({
      tipoMovimiento: "reunion_editada",
      modulo: "agenda",
      titulo: "Reunión editada",
      mensaje: `${getDisplayName(state.effectiveUser)} editó la reunión "${titulo}".`,
      metadata: {
        cambios: [
          { campo: "reunion.titulo", anterior: current?.titulo || "", nuevo: titulo },
          { campo: "reunion.tipo", anterior: current?.tipo || "", nuevo: tipo },
          { campo: "reunion.fechaInicio", anterior: current?.fechaInicio || "", nuevo: fechaInicio.toISOString() },
          { campo: "reunion.lugar", anterior: meetingPlaceLabel(current || {}), nuevo: tipo === "presencial" ? direccion : link },
          { campo: "reunion.observaciones", anterior: current?.observaciones || "", nuevo: observaciones }
        ]
      }
    });

  } else {
    await addDoc(collection(db, REUNIONES_COLLECTION), data);

    const patch = buildMeetingSummaryPatchAfterCreate(data);
    await saveGroupPatch(patch, {
      tipoMovimiento: "reunion_creada",
      modulo: "agenda",
      titulo: "Nueva reunión agendada",
      mensaje: `${getDisplayName(state.effectiveUser)} agendó una reunión ${tipo}.`,
      cambios: [
        { campo: "proximaReunionFecha", anterior: state.group.proximaReunionFecha || "", nuevo: fechaInicio.toISOString() },
        { campo: "proximaReunionTipo", anterior: state.group.proximaReunionTipo || "", nuevo: tipo }
      ],
      reloadAfterSave: false
    });

    await createHistoryEntry({
      tipoMovimiento: "reunion_creada",
      modulo: "agenda",
      titulo: "Nueva reunión agendada",
      mensaje: `${getDisplayName(state.effectiveUser)} agendó "${titulo}".`,
      metadata: {
        cambios: [
          { campo: "reunion.tipo", anterior: "", nuevo: tipo },
          { campo: "reunion.fechaInicio", anterior: "", nuevo: fechaInicio.toISOString() },
          { campo: "reunion.lugar", anterior: "", nuevo: tipo === "presencial" ? direccion : link }
        ]
      }
    });
  }

  state.editingMeetingId = "";
  closeModal("modalReunion");
  await loadAll();
  showSaveNotice("Reunión guardada correctamente.");
}

async function completeMeeting(id) {
  if (!canManageMeetings()) {
    alert("No tienes permisos para modificar reuniones en este grupo.");
    return;
  }

  const meeting = state.meetings.find((m) => m.id === id);
  if (!meeting) return;

  const ok = confirm(`¿Marcar como realizada la reunión "${meeting.titulo || "Reunión"}"?`);
  if (!ok) return;

  await updateDoc(doc(db, REUNIONES_COLLECTION, id), {
    estadoReunion: "realizada",
    actualizadoPor: getDisplayName(state.effectiveUser),
    actualizadoPorCorreo: state.effectiveEmail,
    fechaActualizacion: serverTimestamp()
  });

  await createHistoryEntry({
    tipoMovimiento: "reunion_realizada",
    modulo: "agenda",
    titulo: "Reunión realizada",
    mensaje: `${getDisplayName(state.effectiveUser)} marcó como realizada la reunión "${meeting.titulo || "Reunión"}".`,
    metadata: {
      cambios: [
        {
          campo: "reunion.estadoReunion",
          anterior: meeting.estadoReunion || "agendada",
          nuevo: "realizada"
        }
      ]
    }
  });

  await loadAll();
  showSaveNotice("Reunión marcada como realizada.");
}

async function saveManualAlert() {
  /*
   * REGLA:
   * crear alertas manuales no depende
   * de permisos de edición del grupo.
   */
  if (!canCreateAlertsAndComments()) {
    alert(
      "No tienes permisos para acceder a este grupo."
    );

    return;
  }

  const titulo =
    cleanText(
      $("a_titulo")?.value || ""
    );

  const mensaje =
    cleanText(
      $("a_mensaje")?.value || ""
    );

  const nivelRaw =
    normalizeSearchLocal(
      $("a_nivel")?.value || ""
    );

  /*
   * Blindaje:
   * aunque quedara algún HTML antiguo con "info",
   * una alerta manual nueva solo puede guardarse
   * como warning o critica.
   */
  const nivel =
    nivelRaw === "critica"
      ? "critica"
      : "warning";

  if (!titulo) {
    alert(
      "Debes escribir un título para la alerta."
    );

    return;
  }

  if (!mensaje) {
    alert(
      "Debes escribir el detalle de la alerta."
    );

    return;
  }

  const creadoPor =
    getDisplayName(
      state.effectiveUser
    );

  const alertaRef =
    await addDoc(
      collection(
        db,
        ALERTAS_COLLECTION
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
            state.group?.aliasGrupo
          ),

        colegio:
          cleanText(
            state.group?.colegio
          ),

        tipo:
          "manual",

        origen:
          "manual",

        modulo:
          "grupo",

        nivel,

        titulo,

        mensaje,

        activa:
          true,

        visibleEnIndex:
          true,

        visibleEnGrupo:
          true,

        resuelta:
          false,

        creadoPor,

        creadoPorCorreo:
          state.effectiveEmail,

        fechaCreacion:
          serverTimestamp()
      }
    );

  /*
   * También dejamos trazabilidad
   * de la creación en historial.
   */
  await createHistoryEntry({
    tipoMovimiento:
      "alerta_manual_creada",

    modulo:
      "alertas",

    titulo:
      "Alerta manual creada",

    asunto:
      titulo,

    mensaje:
      `${creadoPor} creó una alerta manual "${titulo}". Detalle: ${mensaje}`,

    metadata: {
      alertaId:
        alertaRef.id,

      nivel,

      titulo,

      mensaje,

      creadoPor,

      creadoPorCorreo:
        state.effectiveEmail
    }
  });

  closeModal(
    "modalAlerta"
  );

  await loadAll();

  showSaveNotice(
    "Alerta creada correctamente."
  );
}

async function resolveManualAlert(alertId) {
  const item =
    state.alertsManual.find(
      (x) => x.id === alertId
    );

  if (!item) {
    return;
  }

  /*
   * REGLA:
   * cualquier usuario que tenga acceso al grupo
   * puede resolver una alerta manual.
   */
  if (!canAccessGroup(state.group)) {
    alert(
      "No tienes permisos para resolver alertas de este grupo."
    );
    return;
  }

  const resolucionRaw =
    window.prompt(
      [
        `Resolver alerta: "${item.titulo || "Alerta"}"`,
        "",
        "Indica brevemente cómo se resolvió:"
      ].join("\n"),
      ""
    );

  /*
   * Cancelar no hace nada.
   */
  if (resolucionRaw === null) {
    return;
  }

  const resolucion =
    cleanText(
      resolucionRaw
    );

  if (!resolucion) {
    alert(
      "Debes indicar cómo se resolvió la alerta."
    );
    return;
  }

  const nombre =
    getDisplayName(
      state.effectiveUser
    );

  /*
   * Cerramos la alerta.
   */
  await setDoc(
    doc(
      db,
      ALERTAS_COLLECTION,
      alertId
    ),
    {
      activa: false,
      resuelta: true,

      resolucion,

      resueltaPor:
        nombre,

      resueltaPorCorreo:
        state.effectiveEmail,

      fechaResolucion:
        serverTimestamp()
    },
    {
      merge: true
    }
  );

  /*
   * Historial permanente.
   *
   * Conservamos:
   * - qué alerta era;
   * - cuál era el mensaje original;
   * - cómo se resolvió;
   * - quién la resolvió.
   */
  await createHistoryEntry({
    tipoMovimiento:
      "alerta_manual_resuelta",

    modulo:
      "alertas",

    titulo:
      "Alerta resuelta",

    asunto:
      item.titulo ||
      "Alerta manual",

    mensaje:
      `${nombre} resolvió la alerta "${item.titulo || "Alerta"}". Resolución: ${resolucion}`,

    metadata: {
      alertaId:
        alertId,

      nivel:
        item.nivel || "",

      mensajeOriginal:
        item.mensaje || "",

      resolucion,

      resueltaPor:
        nombre,

      resueltaPorCorreo:
        state.effectiveEmail,

      cambios: [
        {
          campo:
            "alerta.activa",

          anterior:
            true,

          nuevo:
            false
        },
        {
          campo:
            "alerta.resuelta",

          anterior:
            false,

          nuevo:
            true
        }
      ]
    }
  });

  await loadAll();

  showSaveNotice(
    "Alerta resuelta correctamente."
  );
}

/* =========================================================
   FLOW / FIRMAS
========================================================= */
function getPendingFichaUpdateRequests() {
  return state.requests.filter((item) => {
    return normalizeSearchLocal(item.tipoSolicitud || "") === "actualizacion_ficha"
      && normalizeSearchLocal(item.estadoSolicitud || "") === "pendiente";
  });
}

async function markPendingFichaUpdateRequestsAsCompleted({
  resolvedBy = getDisplayName(state.effectiveUser),
  resolvedByCorreo = state.effectiveEmail,
  newStatus = "completada"
} = {}) {
  const pending = getPendingFichaUpdateRequests();

  for (const item of pending) {
    await setDoc(doc(db, SOLICITUDES_COLLECTION, item.id), {
      estadoSolicitud: newStatus,
      resuelta: true,
      resueltaPor: resolvedBy,
      resueltaPorCorreo: resolvedByCorreo,
      fechaResolucion: serverTimestamp()
    }, { merge: true });
  }

  return pending.length;
}

async function signFlow(step) {
  if (!state.group) return;

  const flow = state.group.flowFicha || {};
  const nombre = getDisplayName(state.effectiveUser);

  if (step === "vendedor") {
    if (!canEditGroup()) {
      alert(getBlockedEditMessage());
      return;
    }

    if (normalizeState(state.group.estado) !== "ganada") {
      alert("La firma de vendedor(a) solo se habilita cuando el grupo está GANADA.");
      return;
    }

    if (flow?.vendedor?.firmado) {
      alert("La firma de vendedor(a) ya está registrada.");
      return;
    }

    const patch = {
      fichaFlujoModo: "v2",
      fichaEstado: "lista_vendedor",
      firmaVendedor: nombre,

      documentos: {
        ...(state.group.documentos || {}),
        fichaGrupo: {
          ...(state.group.documentos?.fichaGrupo || {}),
          estado: "lista_vendedor"
        }
      },

      ficha: {
        ...(state.group.ficha || {}),
        flujoModo: "v2",
        estado: "lista_vendedor"
      },

      flowFicha: {
        ...(state.group.flowFicha || {}),
        modo: "v2",
        legacy: false,
        habilitada: true,
        estado: "lista_vendedor",
        bloqueadaParaVendedor: true,
        requiereActualizacion: false,
        vendedor: {
          ...(state.group.flowFicha?.vendedor || {}),
          firmado: true,
          firmadoAt: serverTimestamp(),
          firmadoPor: nombre,
          firmadoPorCorreo: state.effectiveEmail,
          observacion: ""
        }
      }
    };

    await saveGroupPatch(patch, {
      tipoMovimiento: "firma_vendedor",
      modulo: "ficha",
      titulo: "Firma de vendedor(a)",
      mensaje: `${nombre} dejó la ficha lista como vendedor(a).`,
      cambios: [
        { campo: "fichaEstado", anterior: state.group.fichaEstado || "", nuevo: "lista_vendedor" }
      ]
    });
    return;
  }

  if (step === "jefaVentas") {
    if (!isJefaVentas()) {
      alert("Esta firma solo puede realizarla la jefa de ventas.");
      return;
    }

    if (!flow?.vendedor?.firmado) {
      alert("Primero debe firmar el vendedor(a).");
      return;
    }

    if (flow?.jefaVentas?.firmado) {
      alert("La firma de jefa de ventas ya está registrada.");
      return;
    }

    const hadPendingRequest = getPendingFichaUpdateRequests().length > 0;

    const flowPatch = {
      ...(state.group.flowFicha || {}),
      modo: "v2",
      legacy: false,
      estado: "revisada_jefa_ventas",
      jefaVentas: {
        ...(state.group.flowFicha?.jefaVentas || {}),
        firmado: true,
        firmadoAt: serverTimestamp(),
        firmadoPor: nombre,
        firmadoPorCorreo: state.effectiveEmail,
        observacion: ""
      }
    };

    if (hadPendingRequest) {
      flowPatch.ultimaSolicitudActualizacion = {
        ...(state.group.flowFicha?.ultimaSolicitudActualizacion || {}),
        estado: "revisada_jefa_ventas",
        revisadaPor: nombre,
        revisadaPorCorreo: state.effectiveEmail,
        fechaRevisionJefa: serverTimestamp()
      };
    }

    const patch = {
      fichaFlujoModo: "v2",
      fichaEstado: "revisada_jefa_ventas",
      firmaSupervision: nombre,

      documentos: {
        ...(state.group.documentos || {}),
        fichaGrupo: {
          ...(state.group.documentos?.fichaGrupo || {}),
          estado: "revisada_jefa_ventas"
        }
      },

      ficha: {
        ...(state.group.ficha || {}),
        flujoModo: "v2",
        estado: "revisada_jefa_ventas"
      },

      flowFicha: flowPatch
    };

    await saveGroupPatch(patch, {
      tipoMovimiento: "firma_jefa_ventas",
      modulo: "ficha",
      titulo: hadPendingRequest ? "Refirma jefa de ventas" : "Firma jefa de ventas",
      mensaje: hadPendingRequest
        ? `${nombre} revisó nuevamente la ficha tras una solicitud de actualización.`
        : `${nombre} revisó la ficha como jefa de ventas.`,
      cambios: [
        { campo: "fichaEstado", anterior: state.group.fichaEstado || "", nuevo: "revisada_jefa_ventas" }
      ]
    });
    return;
  }

  if (step === "administracion") {
    if (!isAdministracion()) {
      alert("Esta firma solo puede realizarla administración.");
      return;
    }

    if (!flow?.jefaVentas?.firmado) {
      alert("Primero debe firmar jefa de ventas.");
      return;
    }

    if (flow?.administracion?.firmado) {
      alert("La firma de administración ya está registrada.");
      return;
    }

    const hadPendingRequest = getPendingFichaUpdateRequests().length > 0;

    const flowPatch = {
      ...(state.group.flowFicha || {}),
      modo: "v2",
      legacy: false,
      estado: "autorizada_admin",
      requiereActualizacion: false,
      requiereRefirmaAdministracion: false,
      administracion: {
        ...(state.group.flowFicha?.administracion || {}),
        firmado: true,
        firmadoAt: serverTimestamp(),
        firmadoPor: nombre,
        firmadoPorCorreo: state.effectiveEmail,
        observacion: ""
      }
    };

    if (hadPendingRequest) {
      flowPatch.ultimaSolicitudActualizacion = {
        ...(state.group.flowFicha?.ultimaSolicitudActualizacion || {}),
        estado: "completada",
        cerradaPor: nombre,
        cerradaPorCorreo: state.effectiveEmail,
        fechaCierre: serverTimestamp()
      };

      flowPatch.ultimaActualizacionCerradaAt = serverTimestamp();
      flowPatch.ultimaActualizacionCerradaPor = nombre;
      flowPatch.ultimaActualizacionCerradaPorCorreo = state.effectiveEmail;
    }

    const patch = {
      fichaFlujoModo: "v2",
      fichaEstado: "autorizada_admin",
      firmaAdministracion: nombre,
      autorizada: true,

      documentos: {
        ...(state.group.documentos || {}),
        fichaGrupo: {
          ...(state.group.documentos?.fichaGrupo || {}),
          estado: "autorizada_admin"
        }
      },

      ficha: {
        ...(state.group.ficha || {}),
        flujoModo: "v2",
        estado: "autorizada_admin",
        pdfPendienteGeneracion: true
      },

      flowFicha: flowPatch
    };

    await saveGroupPatch(patch, {
      tipoMovimiento: "firma_administracion",
      modulo: "ficha",
      titulo: hadPendingRequest ? "Refirma administración" : "Firma administración",
      mensaje: hadPendingRequest
        ? `${nombre} aprobó nuevamente la ficha desde administración y cerró la solicitud de actualización.`
        : `${nombre} autorizó el grupo desde administración.`,
      cambios: [
        { campo: "autorizada", anterior: !!state.group.autorizada, nuevo: true },
        { campo: "fichaEstado", anterior: state.group.fichaEstado || "", nuevo: "autorizada_admin" }
      ],
      reloadAfterSave: false
    });

    if (hadPendingRequest) {
      await markPendingFichaUpdateRequestsAsCompleted({
        resolvedBy: nombre,
        resolvedByCorreo: state.effectiveEmail
      });
    }

    await loadAll();
  }
}

async function applyCriticalChangeRules(patch, cambios) {
  if (!state.group?.autorizada) return;

  const criticalFields = new Set([
    "curso",
    "anoViaje",
    "cantidadGrupo",
    "destinoPrincipal",
    "destinoPrincipalOtro",
    "programa",
    "programaOtro",
    "tramo",
    "tramoOtro",
    "mesViaje",
    "mesViajeOtro",
    "semanaViaje",
    "asistenciaMed",
    "fechaViaje",
    "estado",
    "fichaEstado",
    "contratoEstado",
    "nominaEstado",
    "fichaMedicaEstado"
  ]);

  const touchedCritical = cambios.some((c) => {
    const root = String(c.campo || "").split(".")[0];
    return criticalFields.has(c.campo) || criticalFields.has(root);
  });

  if (!touchedCritical) return;

  patch.autorizada = false;
  patch.fichaEstado = normalizeSearchLocal(state.group.fichaEstado) === "autorizada_admin"
    ? "revisada_jefa_ventas"
    : (patch.fichaEstado || state.group.fichaEstado || "pendiente");

  patch.flowFicha = {
    ...(state.group.flowFicha || {}),
    requiereRefirmaAdministracion: true,
    administracion: {
      firmado: false,
      firmadoAt: null,
      firmadoPor: "",
      firmadoPorCorreo: "",
      observacion: ""
    }
  };
}

/* =========================================================
   SAVE CORE
========================================================= */
async function saveGroupPatch(patch, {
  tipoMovimiento = "edicion_datos",
  modulo = "grupo",
  titulo = "Actualización",
  asunto = "",
  mensaje = "",
  cambios = [],
  metadata = {},
  reloadAfterSave = true
} = {}) {
  // Si dentro de los cambios viene "estado",
  // dejamos automáticamente fecha de último cambio de estado
  // y última gestión, tanto para cambios automáticos como manuales.
  applyEstadoAuditFields(patch, cambios);

  patch.actualizadoPor = getDisplayName(state.effectiveUser);
  patch.actualizadoPorCorreo = state.effectiveEmail;
  patch.fechaActualizacion = serverTimestamp();

  await setDoc(doc(db, "ventas_cotizaciones", state.groupDocId), patch, { merge: true });

  await createHistoryEntry({
    tipoMovimiento,
    modulo,
    titulo,
    asunto,
    mensaje,
    cambios,
    metadata
  });

  if (reloadAfterSave) {
    await loadAll();
  }
}

function sanitizeHistoryValue(value) {
  if (value === undefined) return null;
  if (value === null) return null;

  if (value instanceof Date) return value;
  if (isTimestampLike(value)) return value;

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeHistoryValue(item));
  }

  if (value && typeof value === "object") {
    const out = {};
    Object.entries(value).forEach(([key, itemValue]) => {
      out[key] = sanitizeHistoryValue(itemValue);
    });
    return out;
  }

  return value;
}

async function createHistoryEntry({
  tipoMovimiento = "movimiento",
  modulo = "grupo",
  titulo = "Movimiento",
  asunto = "",
  mensaje = "",
  cambios = [],
  metadata = {}
} = {}) {
  const rawChanges =
    Array.isArray(cambios) && cambios.length
      ? cambios
      : (Array.isArray(metadata?.cambios) ? metadata.cambios : []);

  // Limpia undefined para que Firestore no rechace el historial
  const baseChanges = rawChanges.map((item) => ({
    campo: cleanText(item?.campo || ""),
    anterior: sanitizeHistoryValue(item?.anterior),
    nuevo: sanitizeHistoryValue(item?.nuevo)
  }));

  const cambiosDetallados = buildDetailedChanges(baseChanges);
  const metadataSafe = sanitizeHistoryValue(metadata || {});

  const asuntoFinal =
    cleanText(asunto) ||
    buildHistorySubject({ titulo, cambios: cambiosDetallados }) ||
    cleanText(titulo) ||
    "Movimiento";

  const resumenCambios = buildHistorySummary(cambiosDetallados);
  const mensajeFinal =
    cleanText(mensaje) ||
    resumenCambios ||
    asuntoFinal;

  await addDoc(collection(db, HISTORIAL_COLLECTION), {
    idGrupo: String(state.groupId),
    codigoRegistro: cleanText(state.group?.codigoRegistro),
    aliasGrupo: cleanText(state.group?.aliasGrupo),
    colegio: cleanText(state.group?.colegio),

    tipoMovimiento,
    modulo,
    titulo,
    asunto: asuntoFinal,
    mensaje: mensajeFinal,

    metadata: {
      ...metadataSafe,
      totalCambios: cambiosDetallados.length,
      resumenCambios,
      cambios: baseChanges,
      cambiosDetallados
    },

    destacado: false,
    destacadoAt: null,
    destacadoPor: "",
    destacadoPorCorreo: "",

    oculto: false,
    ocultadoAt: null,
    ocultadoPor: "",
    ocultadoPorCorreo: "",

    creadoPor: getDisplayName(state.effectiveUser),
    creadoPorCorreo: state.effectiveEmail,
    fecha: serverTimestamp()
  });
}

/* =========================================================
   HELPERS DATA
========================================================= */
function buildMeetingSummaryPatchAfterCreate(meetingData) {
  const nextMeeting = getEarliestUpcomingMeeting([
    ...state.meetings,
    meetingData
  ]);

  const patch = {
    ultimaGestionAt: serverTimestamp(),
    ultimaGestionTipo: "reunion"
  };

  if (nextMeeting) {
    patch.proximaReunionFecha = nextMeeting.fechaInicio;
    patch.proximaReunionTipo = nextMeeting.tipo || "";
    patch.proximaReunionLugar = meetingPlaceLabel(nextMeeting);
    patch.proximaReunionLink = nextMeeting.link || "";
  }

  const estadoActual = normalizeState(state.group.estado);
  if (!["ganada", "perdida"].includes(estadoActual)) {
    patch.estado = "reunion_confirmada";
  }

  return patch;
}

function getNextMeeting() {
  return getEarliestUpcomingMeeting(state.meetings);
}

function getEarliestUpcomingMeeting(list = []) {
  const now = nowDate().getTime();

  return list
    .filter((item) => normalizeSearchLocal(item.estadoReunion || "agendada") !== "cancelada")
    .map((item) => ({ ...item, __date: toDate(item.fechaInicio) }))
    .filter((item) => item.__date && item.__date.getTime() >= now)
    .sort((a, b) => a.__date.getTime() - b.__date.getTime())[0] || null;
}

function setDefaultMeetingDates() {
  const now = new Date();
  now.setSeconds(0, 0);

  const start = new Date(now);
  start.setHours(start.getHours() + 2);

  const yyyy = start.getFullYear();
  const mm = String(start.getMonth() + 1).padStart(2, "0");
  const dd = String(start.getDate()).padStart(2, "0");
  const hh = String(start.getHours()).padStart(2, "0");
  const mi = String(start.getMinutes()).padStart(2, "0");

  setFormValue("r_fecha", `${yyyy}-${mm}-${dd}`);
  setFormValue("r_horaInicio", `${hh}:${mi}`);
}

function itemData(label, value, full = false) {
  return {
    label,
    value: stringValue(value),
    full
  };
}

function getFichaDocumentoPdfUrl(groupData = {}) {
  return cleanText(
    groupData.fichaPdfUrl ||
    getByPath(groupData, "ficha.pdfUrl") ||
    getByPath(groupData, "ficha.urlPdf") ||
    ""
  );
}

function resolveFichaDocumentoEstado(groupData = {}) {
  const pdfUrl = getFichaDocumentoPdfUrl(groupData);

  // Si existe PDF real guardado, la ficha del grupo debe verse como cumplida.
  if (pdfUrl) return "ok";

  return normalizeDocState(
    groupData.fichaEstado ||
    getByPath(groupData, "documentos.fichaGrupo.estado") ||
    getByPath(groupData, "ficha.estado") ||
    ""
  );
}

function renderDocChip(key, value, options = {}) {
  const normalized = normalizeDocState(value);
  const href = cleanText(options.href || "");
  const label = `${DOC_LABELS[key] || key} · ${getDocStateLabel(normalized)}`;

  if (href) {
    return `
      <a
        class="doc-chip ${docStateClass(normalized)}"
        href="${escapeHtml(href)}"
        target="_blank"
        rel="noopener noreferrer"
        title="${escapeHtml(label)}"
      >
        ${escapeHtml(label)}
      </a>
    `;
  }

  return `
    <span class="doc-chip ${docStateClass(normalized)}">
      ${escapeHtml(label)}
    </span>
  `;
}

function renderFlowStep(label, data = {}) {
  const signed = !!data?.firmado;
  const who = data?.firmadoPor || "";
  const when = formatDateTime(data?.firmadoAt);
  const obs = data?.observacion || "";

  return `
    <div class="flow-step">
      <div class="flow-step-top">
        <div class="flow-step-title">${escapeHtml(label)}</div>
        <span class="flow-step-status ${signed ? "signed" : ""}">
          ${signed ? "Firmado" : "Pendiente"}
        </span>
      </div>

      <div class="flow-step-meta">
        ${signed ? escapeHtml(`${who} · ${when}`) : "Sin firma aún"}
        ${obs ? `<br>${escapeHtml(obs)}` : ""}
      </div>
    </div>
  `;
}

function getBlockedEditMessage() {
  if (!state.canModify) {
    return "Tu rol actual es solo de lectura en este grupo.";
  }

  const isVendor = String(state.effectiveUser?.rol || "").toLowerCase() === "vendedor";
  if (isAdministracionBlockedFromGroupEdit()) {
    return "Administración no puede editar datos del grupo después de la firma del vendedor. Solo puede editar N° negocio, usuario ficha y clave administrativa desde la ficha, o solicitar corrección.";
  }

  if (isVendor && isVendorLockedByFlow(state.group)) {
    return "Ya firmaste la ficha. Desde este momento no puedes modificar el grupo ni la ficha; debes solicitar actualización a jefa de ventas.";
  }

  if (state.group?.autorizada && isVendor) {
    return "El grupo ya está autorizado. El vendedor(a) debe solicitar actualización y la modificación final debe hacerla jefa de ventas.";
  }

  return "No tienes permisos para editar este grupo.";
}

function prettyLabel(path = "") {
  const map = {
    aliasGrupo: "Alias grupo",
    estado: "Estado",
    colegio: "Colegio",
    curso: "Curso",
    anoViaje: "Año viaje",
    cantidadGrupo: "Cantidad grupo",
    destinoPrincipal: "Destino principal",
    destinoPrincipalOtro: "Otro destino principal",
    programa: "Programa",
    programaOtro: "Otro programa",
    tramo: "Tramo",
    tramoOtro: "Otro tramo",
    mesViaje: "Mes de viaje",
    mesViajeOtro: "Otro mes de viaje",
    semanaViaje: "Mes de viaje",
    asistenciaMed: "Asistencia médica",
    cursoViaje: "Curso proyectado",
    aliasTripKey: "Clave alias viaje",
    fechaViaje: "Fecha viaje",
    comunaCiudad: "Comuna / ciudad",
    nombreCliente: "1° Contacto",
    rolCliente: "Rol 1° Contacto",
    correoCliente: "Correo 1° Contacto",
    celularCliente: "Celular 1° Contacto",
    nombreCliente2: "2° Contacto",
    rolCliente2: "Rol 2° Contacto",
    correoCliente2: "Correo 2° Contacto",
    celularCliente2: "Celular 2° Contacto",
    autorizada: "Autorizada",
    cerrada: "Cerrada",
    fichaEstado: "Ficha del grupo",
    contratoEstado: "Contrato",
    nominaEstado: "Nómina",
    fichaMedicaEstado: "Fichas médicas",
    cortesiaEstado: "Cortesías",
    "situacion.resumen": "Resumen",
    "situacion.proximoPaso": "Próximo paso",
    "situacion.observacionVentas": "Observación ventas",
    "situacion.observacionJefaVentas": "Observación jefa ventas",
    "situacion.observacionAdministracion": "Observaciones administración",
    "situacion.observacionOperaciones": "Observaciones operaciones"
  };

  return map[path] || String(path)
    .replaceAll(".", " / ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .trim();
}

function getEstadoLabel(value = "") {
  const key = normalizeState(value);
  return ESTADO_META[key]?.label || "A contactar";
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

function getDocStateLabel(value = "") {
  const v = normalizeDocState(value);
  if (v === "ok") return "Ok";
  if (v === "no_aplica") return "No aplica";
  return "Pendiente";
}

function docStateClass(value = "") {
  const v = normalizeDocState(value);
  if (v === "ok" || v === "realizada") return "ok";
  if (v === "no_aplica" || v === "cancelada") return "no_aplica";
  return "pendiente";
}

function normalizeState(value = "") {
  const v = normalizeSearchLocal(value).replaceAll("_", " ");
  if (!v) return "a_contactar";
  if (v.includes("reunion confirm")) return "reunion_confirmada";
  if (v.includes("recot")) return "recotizando";
  if (v.includes("cotiz")) return "cotizando";
  if (v.includes("contactad")) return "contactado";
  if (v.includes("ganad")) return "ganada";
  if (v.includes("perdid")) return "perdida";
  return "a_contactar";
}

function normalizeDocState(value) {
  if (typeof value === "boolean") {
    return value ? "ok" : "pendiente";
  }

  const v = normalizeSearchLocal(value);

  if (!v) return "pendiente";
  if (v.includes("no aplica") || v === "na" || v === "n/a") return "no_aplica";

  if (
    v.includes("ok") ||
    v.includes("completo") ||
    v.includes("cumpl") ||
    v.includes("entreg") ||
    v.includes("confirmada_pdf") ||
    v.includes("pdf_confirmado") ||
    v.includes("confirmada")
  ) {
    return "ok";
  }

  if (v.includes("pend")) return "pendiente";

  return "pendiente";
}

function meetingPlaceLabel(meeting = {}) {
  if (normalizeSearchLocal(meeting.tipo) === "virtual") {
    return meeting.link || "Sin link";
  }
  return meeting.direccion || "Sin dirección";
}

function getDisplayName(user) {
  const name = [user?.nombre, user?.apellido].filter(Boolean).join(" ").trim();
  return name || user?.email || state.effectiveEmail || "Usuario";
}

function getInitials(text = "") {
  const parts = String(text || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "RT";
  return parts.slice(0, 2).map((p) => p[0]?.toUpperCase() || "").join("");
}

function stringValue(value) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (Array.isArray(value)) return value.map(stringValue).filter(Boolean).join(" · ");
  if (isTimestampLike(value)) return formatDateTime(value);
  return String(value);
}

function sameValue(a, b) {
  return normalizeComparable(a) === normalizeComparable(b);
}

function normalizeComparable(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(normalizeComparable).join("|");
  if (isTimestampLike(value)) return String(toDate(value)?.getTime() || "");
  return String(value).trim();
}

function setNestedValue(target, path, value) {
  const parts = String(path).split(".");
  let ref = target;

  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i];
    if (!ref[key] || typeof ref[key] !== "object" || Array.isArray(ref[key])) {
      ref[key] = {};
    }
    ref = ref[key];
  }

  ref[parts[parts.length - 1]] = value;
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

function setFormValue(id, value) {
  const el = $(id);
  if (!el) return;
  el.value = value == null ? "" : String(value);
}

function setText(id, value) {
  const el = $(id);
  if (!el) return;
  el.textContent = String(value ?? "");
}

function cleanText(value = "") {
  return String(value || "").trim();
}

function parseNumberOrText(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const num = Number(raw);
  return Number.isFinite(num) ? num : raw;
}

function nowDate() {
  return new Date();
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

function dateValue(value) {
  return toDate(value)?.getTime() || 0;
}

function isTimestampLike(value) {
  return (
    value &&
    typeof value === "object" &&
    (
      typeof value.toDate === "function" ||
      (typeof value.seconds === "number" && typeof value.nanoseconds === "number")
    )
  );
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

function toDatetimeLocal(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d)) return "";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

function formatInputDate(value) {
  if (!value) return "";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = toDate(value);
  if (!d) return "";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function daysBetween(a, b) {
  if (!(a instanceof Date) || !(b instanceof Date)) return 9999;
  const ms = b.setHours(0,0,0,0) - a.setHours(0,0,0,0);
  return Math.round(ms / 86400000);
}

function capitalize(value = "") {
  const s = String(value || "").trim();
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function normalizeSearchLocal(value = "") {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function insertVariableAtActiveField(variable, allowedIds = []) {
  const active = document.activeElement;

  const isValidTarget =
    active &&
    allowedIds.includes(active.id) &&
    (active.tagName === "TEXTAREA" || active.tagName === "INPUT");

  const target = isValidTarget
    ? active
    : $(allowedIds[allowedIds.length - 1]);

  if (!target) return;

  const start = target.selectionStart ?? target.value.length;
  const end = target.selectionEnd ?? target.value.length;

  const before = target.value.slice(0, start);
  const after = target.value.slice(end);

  target.value = `${before}${variable}${after}`;

  const nextPos = start + variable.length;
  target.focus();
  target.setSelectionRange(nextPos, nextPos);
}

function escapeHtml(value = "") {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getNombrePublicoInscripcion(item = {}) {
  const nombres =
    getByPath(item, "identificacion.nombres") ||
    item.nombres ||
    "";

  const primerApellido =
    getByPath(item, "identificacion.primerApellido") ||
    item.primerApellido ||
    "";

  const segundoApellido =
    getByPath(item, "identificacion.segundoApellido") ||
    item.segundoApellido ||
    "";

  const nombreCompleto =
    getByPath(item, "identificacion.nombreCompleto") ||
    item.nombreCompleto ||
    "";

  return cleanText(
    nombreCompleto || [nombres, primerApellido, segundoApellido].filter(Boolean).join(" ")
  );
}

function buildNominaPublicaRows() {
  return state.inscripciones
    .filter((item) => item?.privacidad?.estado !== "eliminada_logica")
    .map((item) => {
      const fechaOriginal = getFechaFormularioInscripcion(item);

      return {
        nombre: getNombrePublicoInscripcion(item),
        fechaInscripcion: formatPublicDateTime(fechaOriginal),
        fechaOrden: getPublicDateTimeMs(fechaOriginal),
        tipo: formatInscripcionValue(item.tipoViajante || item.tipoParticipacion || "")
      };
    })
    .filter((x) => x.nombre)
    .sort((a, b) => a.fechaOrden - b.fechaOrden);
}

function formatPublicDateTime(value) {
  let d = null;

  if (!value) return "—";

  if (value?.toDate) {
    d = value.toDate();
  } else if (value instanceof Date) {
    d = value;
  } else {
    d = new Date(value);
  }

  if (!d || Number.isNaN(d.getTime())) return "—";

  return d.toLocaleString("es-CL", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function getPublicDateTimeMs(value) {
  let d = null;

  if (!value) return 0;

  if (value?.toDate) {
    d = value.toDate();
  } else if (value instanceof Date) {
    d = value;
  } else {
    d = new Date(value);
  }

  if (!d || Number.isNaN(d.getTime())) return 0;

  return d.getTime();
}

function getNominaPublicaLink(token = "") {
  return `${location.origin}${location.pathname.replace(/grupo\.html$/i, "nomina.html")}?t=${encodeURIComponent(token)}`;
}

async function generarLinkNominaPublica() {
  if (!state.groupDocId || !state.groupId) {
    alert("No se pudo identificar el grupo.");
    return;
  }

  const ok = confirm(
    "Se generará un link público de nómina viva. Cada vez que se abra, mostrará la nómina actual del grupo. Solo incluirá nombres, apellidos y fecha de inscripción. ¿Continuar?"
  );

  if (!ok) return;

  const tokenExistente = cleanText(state.group?.nominaPublica?.token || "");
  const token = tokenExistente || generateInscripcionToken(40);
  const link = getNominaPublicaLink(token);

  const payloadNominaPublica = {
    token,
    activo: true,

    idGrupo: String(state.groupId),
    groupDocId: String(state.groupDocId),

    colegio: cleanText(state.group?.colegio || ""),
    curso: cleanText(state.group?.curso || ""),
    anoViaje: cleanText(state.group?.anoViaje || ""),
    destino:
      cleanText(state.group?.destinoPrincipal || "") ||
      cleanText(state.group?.destino || ""),
    nombreGrupo:
      cleanText(state.group?.aliasGrupo || "") ||
      cleanText(state.group?.nombreGrupo || "") ||
      cleanText(state.group?.colegio || ""),

    tipo: "nomina_viva",
    actualizadoEn: serverTimestamp(),
    actualizadoPor: getDisplayName(state.effectiveUser),
    actualizadoPorCorreo: state.effectiveEmail || ""
  };

  if (!tokenExistente) {
    payloadNominaPublica.creadoEn = serverTimestamp();
  }

  await setDoc(
    doc(db, "nominas_publicas", token),
    payloadNominaPublica,
    { merge: true }
  );

  await saveGroupPatch(
    {
      nominaPublica: {
        activo: true,
        token,
        link,
        tipo: "nomina_viva",
        actualizadoEn: serverTimestamp(),
        actualizadoPor: getDisplayName(state.effectiveUser),
        actualizadoPorCorreo: state.effectiveEmail || ""
      }
    },
    {
      tipoMovimiento: "nomina_publica_generada",
      modulo: "inscripcion",
      titulo: "Link público de nómina viva generado",
      mensaje: `${getDisplayName(state.effectiveUser)} generó o actualizó el link público de nómina viva.`
    }
  );

  try {
    await navigator.clipboard.writeText(link);
    showSaveNotice("Link de nómina viva copiado.");
  } catch {
    alert(`Link de nómina viva:\n\n${link}`);
  }
}

/* =========================================================
   IMPORTAR NÓMINA DESDE SISTEMA DE PAGOS · CONSOLA
========================================================= */

const API_PAGOS_DETALLE_URL = "/api/pagos";

function capitalizarNombrePagos(value = "") {
  return cleanText(value)
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

function normalizarRutPagos(value = "") {
  return String(value || "")
    .toUpperCase()
    .replace(/\./g, "")
    .replace(/-/g, "")
    .replace(/\s+/g, "")
    .trim();
}

function calcularDvRutImport(cuerpo = "") {
  const rut = String(cuerpo || "").replace(/\D/g, "");
  if (!rut) return "";

  let suma = 0;
  let multiplo = 2;

  for (let i = rut.length - 1; i >= 0; i--) {
    suma += Number(rut[i]) * multiplo;
    multiplo = multiplo === 7 ? 2 : multiplo + 1;
  }

  const resto = 11 - (suma % 11);
  if (resto === 11) return "0";
  if (resto === 10) return "K";
  return String(resto);
}

function formatearRutDesdePagos(rutRaw = "") {
  const limpio = normalizarRutPagos(rutRaw);
  if (!limpio) return { rut: "", rutNumero: "", rutDv: "", documentoNormalizado: "" };

  const cuerpo = limpio.slice(0, -1);
  const dv = limpio.slice(-1) || calcularDvRutImport(cuerpo);
  const rut = cuerpo && dv ? `${cuerpo}-${dv}` : limpio;

  return {
    rut,
    rutNumero: cuerpo,
    rutDv: dv,
    documentoNormalizado: `RUT_${rut}`
  };
}

function separarApellidosPagos(apellidos = "") {
  const partes = capitalizarNombrePagos(apellidos).split(/\s+/).filter(Boolean);

  return {
    primerApellido: partes[0] || "",
    segundoApellido: partes.slice(1).join(" ")
  };
}

function generoDesdeSexoPagos(sexo = "") {
  const s = String(sexo || "").toUpperCase().trim();
  if (s === "M") return "masculino";
  if (s === "F") return "femenino";
  return "";
}

function tipoViajanteDesdeCategoriaPagos(categoria = "") {
  const c = normalizeSearchLocal(categoria || "");

  if (c.includes("estudiante")) return "estudiante";
  if (c.includes("profesor") || c.includes("docente") || c.includes("coordinador")) return "profesor";
  return "adulto_acompanante";
}

function buildPayloadInscripcionDesdePagos(p = {}, grupo = {}, groupDocId = "") {
  const rutInfo = formatearRutDesdePagos(p.rut || "");
  const apellidos = separarApellidosPagos(p.apellidos || "");
  const genero = generoDesdeSexoPagos(p.sexo || "");
  const tipoViajante = tipoViajanteDesdeCategoriaPagos(p.ocupacion_categoria || "");

  const esEstudiante = tipoViajante === "estudiante";
  const esProfesor = tipoViajante === "profesor";
  const esAcompanante = tipoViajante === "adulto_acompanante";

  const nombres = capitalizarNombrePagos(p.nombres || "");
  const nombreCompleto = [
    nombres,
    apellidos.primerApellido,
    apellidos.segundoApellido
  ].filter(Boolean).join(" ");

  return {
    tipoRegistro: "inscripcion_pasajero",

    faseInscripcion: "nomina_final",
    contextoFormulario: "sistema_pagos",
    estadoInscripcion: "sistema_pagos",
    tipoInscripcion: "sistema_pagos",
    tipoInscripcionLabel: "Sistema de Pagos",
    estadoCupo: "confirmado",

    tipoViajante,
    tipoParticipacion: tipoViajante,
    esEstudiante,
    esProfesor,
    esAcompanante,
    esAdulto: !esEstudiante,
    esMenor: false,

    grupo: {
      idGrupo: String(groupDocId || ""),
      aliasGrupo: cleanText(grupo.aliasGrupo || ""),
      nombreGrupo: cleanText(grupo.nombreGrupo || ""),
      colegio: cleanText(grupo.colegio || ""),
      cursoBase: cleanText(grupo.curso || grupo.cursoBase || ""),
      cursoActualInscripcion: cleanText(grupo.curso || grupo.cursoBase || ""),
      cantidadGrupo: grupo.cantidadGrupo ?? grupo.cantidadgrupo ?? null,
      anoViaje: grupo.anoViaje ?? null,
      destinoPrincipal: cleanText(grupo.destinoPrincipal || grupo.destino || ""),
      internacional: false
    },

    identificacion: {
      tipoIdentificacion: rutInfo.rut ? "rut" : "sin_rut",
      documento: rutInfo.rut,
      documentoNormalizado: rutInfo.documentoNormalizado,
      rut: rutInfo.rut,
      rutNumero: rutInfo.rutNumero,
      rutDv: rutInfo.rutDv,

      nombres,
      primerApellido: apellidos.primerApellido,
      segundoApellido: apellidos.segundoApellido,
      sinSegundoApellido: !apellidos.segundoApellido,
      nombreCompleto,

      fechaNacimiento: p.fecha_nacimiento || "",
      genero,
      generoFinal: genero,
      sexoPagos: p.sexo || "",
      ocupacionCategoriaPagos: p.ocupacion_categoria || "",

      nacionalidadBase: "",
      nacionalidadDetalle: "",

      correoViajante: "",
      telefonoViajante: "",
      tallaPolera: ""
    },

    contactoPrincipal: {
      aplica: true,
      nombre: "",
      relacion: "",
      relacionBase: "",
      telefono: cleanText(p.telefono || ""),
      celular: cleanText(p.telefono || ""),
      esWhatsapp: true,
      whatsappAlternativo: "",
      correo: normalizeEmail(p.email || "")
    },

    contactoSecundario: {
      aplica: false,
      nombre: "",
      relacion: "",
      relacionBase: "",
      telefono: "",
      celular: "",
      correo: "",
      esWhatsapp: false,
      whatsappAlternativo: ""
    },

    documentoIdentidad: {
      aplica: !!rutInfo.rut,
      nombreCoincideDocumento: "si",
      nombresDocumento: "",
      primerApellidoDocumento: "",
      segundoApellidoDocumento: "",
      sexoDocumento: genero,
      declaraActualizacionDocumento: false
    },

    emergencia: {
      nombre: "",
      relacion: "",
      relacionBase: "",
      telefono: "",
      esWhatsapp: false,
      whatsappAlternativo: ""
    },

    emergenciaSecundaria: {
      aplica: false,
      nombre: "",
      relacion: "",
      relacionBase: "",
      telefono: "",
      esWhatsapp: false,
      whatsappAlternativo: ""
    },

    profesor: {
      aplica: esProfesor,
      tipoProfesor: "",
      tipoProfesorBase: "",
      tipoProfesorOtro: "",
      interesConoceRaitrai: false
    },

    adultoAcompanante: {
      aplica: esAcompanante,
      relacionCurso: "",
      relacionCursoBase: "",
      relacionCursoOtro: "",
      estudianteRelacionado: "",
      estudianteRelacionadoNombres: "",
      estudianteRelacionadoPrimerApellido: "",
      estudianteRelacionadoSegundoApellido: "",
      acompananteTieneHijosViaje: "",
      interesConoceRaitrai: false
    },

    adultoCompromiso: {
      aplica: !esEstudiante,
      aceptaCompromiso: false,
      observaciones: ""
    },

    salud: {},

    privacidad: {
      estado: "activa",
      anonimizada: false,
      eliminada: false,
      motivo: ""
    },

    sistemaPagos: {
      origen: "importado_desde_pagos",
      pasajeroId: p.pasajero_id || "",
      viaja: Number(p.viaja) === 1,
      bloqueado: Number(p.bloqueado) === 1,
      tieneCredencial: Number(p.tiene_credencial) === 1,
      tipoPago: p.tipo_pago || "",
      ocupacionCategoria: p.ocupacion_categoria || "",
      importadoAtCliente: new Date().toISOString()
    },

    meta: {
      canal: "sistema_pagos",
      estado: "precargado_desde_pagos",
      requiereCompletarNominaFinal: true,
      fechaInscripcion: new Date().toISOString(),
      fechaFormularioCliente: new Date().toISOString(),
      versionFormulario: 4,
      creadoDesde: "importacion_consola_grupo_js"
    }
  };
}

async function buscarGrupoPorNumeroNegocio(numeroNegocio) {
  const n = String(numeroNegocio || "").trim();

  const intentos = [
    query(collection(db, "ventas_cotizaciones"), where("numeroNegocio", "==", n)),
    query(collection(db, "ventas_cotizaciones"), where("numeroNegocio", "==", Number(n))),
    query(collection(db, "ventas_cotizaciones"), where("ficha.numeroNegocio", "==", n)),
    query(collection(db, "ventas_cotizaciones"), where("ficha.numeroNegocio", "==", Number(n)))
  ];

  for (const qRef of intentos) {
    const snap = await getDocs(qRef);
    if (!snap.empty) {
      const d = snap.docs[0];
      return { docId: d.id, data: d.data() || {} };
    }
  }

  throw new Error(`No encontré grupo con numeroNegocio ${n}`);
}

async function consultarNominaPagos(numeroNegocio) {
  const url = `${API_PAGOS_DETALLE_URL}?modo=detalle&numeroNegocio=${encodeURIComponent(numeroNegocio)}`;
  const res = await fetch(url);

  if (!res.ok) throw new Error(`Error consultando pagos HTTP ${res.status}`);

  const data = await res.json();
  const pasajeros = data?.nominas?.data?.pasajeros || [];

  return pasajeros.map((x) => x.pasajero || {}).filter((p) => p && Object.keys(p).length);
}

/* =========================================================
   RECONCILIAR NOMBRES DESDE SISTEMA DE PAGOS

   FUENTE DE VERDAD PARA EL NOMBRE:
   Sistema de Pagos.

   MATCH:
   exclusivamente por RUT.

   CORRIGE:
   - nómina oficial
   - nómina pública

   NO MODIFICA:
   - RUT
   - fecha inscripción
   - fecha nacimiento
   - correo
   - teléfono
   - ficha médica
   - estado
========================================================= */

function normalizarNombreComparacionPagos(
  value = ""
) {
  return String(
    value || ""
  )
    .normalize("NFD")
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .replace(
      /[\u200B-\u200D\uFEFF]/g,
      ""
    )
    .replace(
      /[^\p{L}\p{N}]+/gu,
      " "
    )
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

function construirNombreDesdePagos(
  pasajeroPagos = {}
) {
  const nombres =
    capitalizarNombrePagos(
      pasajeroPagos.nombres ||
      ""
    );

  const apellidos =
    separarApellidosPagos(
      pasajeroPagos.apellidos ||
      ""
    );

  const primerApellido =
    cleanText(
      apellidos.primerApellido ||
      ""
    );

  const segundoApellido =
    cleanText(
      apellidos.segundoApellido ||
      ""
    );

  const nombreCompleto =
    [
      nombres,
      primerApellido,
      segundoApellido
    ]
      .filter(Boolean)
      .join(" ")
      .trim();

  return {
    nombres,
    primerApellido,
    segundoApellido,
    nombreCompleto
  };
}

function construirNombreOficialActual(
  item = {}
) {
  const identificacion =
    item.identificacion ||
    {};

  const nombres =
    cleanText(
      identificacion.nombres ||
      ""
    );

  const primerApellido =
    cleanText(
      identificacion.primerApellido ||
      ""
    );

  const segundoApellido =
    cleanText(
      identificacion.segundoApellido ||
      ""
    );

  const nombreCompleto =
    [
      nombres,
      primerApellido,
      segundoApellido
    ]
      .filter(Boolean)
      .join(" ")
      .trim();

  return {
    nombres,
    primerApellido,
    segundoApellido,
    nombreCompleto
  };
}

async function corregirNombrePublicoPorRutDesdePagos({
  groupDocId = "",
  rutKey = "",
  nombrePagos = {},
  dryRun = true
} = {}) {
  if (
    !groupDocId ||
    !rutKey
  ) {
    return {
      estado:
        "sin_datos"
    };
  }

  const publicaSnap =
    await getDocs(
      query(
        collection(
          db,
          "inscripciones_pendientes_publicas"
        ),
        where(
          "idGrupo",
          "==",
          String(
            groupDocId
          )
        )
      )
    );

  const candidatos =
    publicaSnap.docs
      .map(
        (docPub) => {
          const data =
            docPub.data() ||
            {};

          const payload =
            data.payload ||
            {};

          const rutPayload =
            normalizarRutKeyGrupo(
              getRutKeyInscripcionPublicaGrupo(
                payload
              )
            );

          const rutDoc =
            normalizarRutKeyGrupo(
              docPub.id
            );

          return {
            docPub,
            data,
            payload,
            ruts:
              new Set(
                [
                  rutPayload,
                  rutDoc
                ]
                  .filter(Boolean)
              )
          };
        }
      )
      .filter(
        (item) =>
          item.ruts.has(
            rutKey
          )
      );

  if (
    candidatos.length ===
    0
  ) {
    return {
      estado:
        "sin_publica"
    };
  }

  if (
    candidatos.length >
    1
  ) {
    return {
      estado:
        "publica_ambigua",

      cantidad:
        candidatos.length
    };
  }

  const candidato =
    candidatos[0];

  const nombrePublicoActual =
    getNombrePublicoInscripcionGrupo(
      candidato.payload
    );

  const nombreNuevo =
    nombrePagos.nombreCompleto;

  if (
    normalizarNombreComparacionPagos(
      nombrePublicoActual
    ) ===
    normalizarNombreComparacionPagos(
      nombreNuevo
    )
  ) {
    return {
      estado:
        "publica_ok",

      nombrePublicoActual
    };
  }

  if (!dryRun) {
    await updateDoc(
      candidato.docPub.ref,
      {
        "payload.identificacion.nombres":
          nombrePagos.nombres,

        "payload.identificacion.primerApellido":
          nombrePagos.primerApellido,

        "payload.identificacion.segundoApellido":
          nombrePagos.segundoApellido,

        "payload.identificacion.nombreCompleto":
          nombrePagos.nombreCompleto
      }
    );
  }

  return {
    estado:
      dryRun
        ? "repararia_publica"
        : "publica_reparada",

    idPublico:
      candidato.docPub.id,

    nombrePublicoActual,

    nombreNuevo
  };
}

window.sincronizarNombresGrupoDesdeSistemaPagos =
async function (
  groupDocIdParam = "",
  {
    dryRun = true
  } = {}
) {
  const groupDocId =
    String(
      groupDocIdParam ||
      state.groupDocId ||
      ""
    ).trim();

  if (!groupDocId) {
    throw new Error(
      "Falta idGrupo / groupDocId."
    );
  }

  /*
    =====================================================
    1. LEEMOS EL GRUPO
    =====================================================
  */

  const grupoRef =
    doc(
      db,
      "ventas_cotizaciones",
      groupDocId
    );

  const grupoSnap =
    await getDoc(
      grupoRef
    );

  if (!grupoSnap.exists()) {
    throw new Error(
      `No existe ventas_cotizaciones/${groupDocId}`
    );
  }

  const grupo =
    grupoSnap.data() ||
    {};

  const numeroNegocio =
    String(
      grupo.numeroNegocio ||
      grupo?.ficha?.numeroNegocio ||
      ""
    ).trim();

  if (!numeroNegocio) {
    throw new Error(
      `El grupo ${groupDocId} no tiene numeroNegocio.`
    );
  }

  console.log(
    dryRun
      ? "🔎 [NOMBRES SP] SIMULACIÓN"
      : "🛠️ [NOMBRES SP] EJECUCIÓN REAL",
    {
      groupDocId,
      numeroNegocio,
      grupo:
        grupo.aliasGrupo ||
        grupo.nombreGrupo ||
        grupo.colegio ||
        ""
    }
  );

  /*
    =====================================================
    2. CONSULTAMOS SISTEMA DE PAGOS
    =====================================================
  */

  const pasajerosPagos =
    await consultarNominaPagos(
      numeroNegocio
    );

  /*
    =====================================================
    3. CARGAMOS NÓMINA OFICIAL
    =====================================================
  */

  const oficialSnap =
    await getDocs(
      collection(
        db,
        "ventas_cotizaciones",
        groupDocId,
        "inscripciones"
      )
    );

  const oficialesPorRut =
    new Map();

  oficialSnap.docs.forEach(
    (inscDoc) => {
      const item = {
        id:
          inscDoc.id,

        ...inscDoc.data()
      };

      const estadoPrivacidad =
        normalizeSearchLocal(
          item?.privacidad?.estado ||
          ""
        );

      if (
        estadoPrivacidad ===
          "archivada" ||
        estadoPrivacidad ===
          "eliminada_logica"
      ) {
        return;
      }

      const rutKey =
        normalizarRutKeyGrupo(
          getInscripcionDocumento(
            item
          ) ||
          item.id ||
          ""
        );

      if (!rutKey) {
        return;
      }

      if (
        !oficialesPorRut.has(
          rutKey
        )
      ) {
        oficialesPorRut.set(
          rutKey,
          []
        );
      }

      oficialesPorRut
        .get(
          rutKey
        )
        .push({
          ref:
            inscDoc.ref,

          item
        });
    }
  );

  const resultados =
    [];

  let revisados =
    0;

  let iguales =
    0;

  let diferentes =
    0;

  let oficialesCorregidos =
    0;

  let publicosCorregidos =
    0;

  let publicosYaCorrectos =
    0;

  let publicosRepararian =
    0;

  let sinOficial =
    0;

  let ambiguosOficial =
    0;

  let sinRut =
    0;

  let sinPublica =
    0;

  let publicaAmbigua =
    0;

  /*
    =====================================================
    4. CRUZAMOS PASAJEROS POR RUT
    =====================================================
  */

  for (
    const pasajeroPagos
    of pasajerosPagos
  ) {
    revisados++;

    const rutInfo =
      formatearRutDesdePagos(
        pasajeroPagos.rut ||
        ""
      );

    const rutKey =
      normalizarRutKeyGrupo(
        rutInfo.rut ||
        rutInfo.documentoNormalizado ||
        ""
      );

    const nombrePagos =
      construirNombreDesdePagos(
        pasajeroPagos
      );

    if (!rutKey) {
      sinRut++;

      resultados.push({
        accion:
          "SIN_RUT_SP",

        rut:
          "",

        nombreSistemaPagos:
          nombrePagos.nombreCompleto,

        nombreOficial:
          "",

        publica:
          ""
      });

      continue;
    }

    const candidatosOficiales =
      oficialesPorRut.get(
        rutKey
      ) ||
      [];

    /*
      ===================================================
      NO EXISTE EN OFICIAL
      ===================================================
    */

    if (
      candidatosOficiales.length ===
      0
    ) {
      sinOficial++;

      resultados.push({
        accion:
          "NO_EXISTE_EN_OFICIAL",

        rut:
          rutInfo.rut ||
          rutKey,

        nombreSistemaPagos:
          nombrePagos.nombreCompleto,

        nombreOficial:
          "",

        publica:
          ""
      });

      continue;
    }

    /*
      ===================================================
      RUT DUPLICADO EN OFICIAL
      ===================================================
    */

    if (
      candidatosOficiales.length >
      1
    ) {
      ambiguosOficial++;

      resultados.push({
        accion:
          "RUT_DUPLICADO_OFICIAL",

        rut:
          rutInfo.rut ||
          rutKey,

        nombreSistemaPagos:
          nombrePagos.nombreCompleto,

        nombreOficial:
          candidatosOficiales
            .map(
              (x) =>
                construirNombreOficialActual(
                  x.item
                )
                  .nombreCompleto
            )
            .join(" | "),

        publica:
          ""
      });

      continue;
    }

    const oficial =
      candidatosOficiales[0];

    const nombreOficial =
      construirNombreOficialActual(
        oficial.item
      );

    const coincideNombreOficial =
      normalizarNombreComparacionPagos(
        nombrePagos.nombreCompleto
      ) ===
      normalizarNombreComparacionPagos(
        nombreOficial.nombreCompleto
      );

    /*
      ===================================================
      5. REVISAMOS / CORREGIMOS OFICIAL
      ===================================================
    */

    if (coincideNombreOficial) {
      iguales++;
    } else {
      diferentes++;

      if (!dryRun) {
        await updateDoc(
          oficial.ref,
          {
            "identificacion.nombres":
              nombrePagos.nombres,

            "identificacion.primerApellido":
              nombrePagos.primerApellido,

            "identificacion.segundoApellido":
              nombrePagos.segundoApellido,

            "identificacion.nombreCompleto":
              nombrePagos.nombreCompleto,

            "auditoriaCorreccionNombrePagos.actualizadoAt":
              serverTimestamp(),

            "auditoriaCorreccionNombrePagos.origen":
              "sistema_pagos",

            "auditoriaCorreccionNombrePagos.numeroNegocio":
              numeroNegocio
          }
        );

        oficialesCorregidos++;
      }
    }

    /*
      ===================================================
      6. SIEMPRE REVISAMOS LA PÚBLICA

      ESTE ES EL CAMBIO IMPORTANTE.

      Aunque:
      SP == OFICIAL

      igualmente buscamos:
      SP vs PÚBLICA

      Si la pública existe y está mal,
      se corrige.
      ===================================================
    */

    const resultadoPublica =
      await corregirNombrePublicoPorRutDesdePagos({
        groupDocId,
        rutKey,
        nombrePagos,
        dryRun
      });

    if (
      resultadoPublica.estado ===
      "publica_reparada"
    ) {
      publicosCorregidos++;
    }

    if (
      resultadoPublica.estado ===
      "repararia_publica"
    ) {
      publicosRepararian++;
    }

    if (
      resultadoPublica.estado ===
      "publica_ok"
    ) {
      publicosYaCorrectos++;
    }

    /*
      Que no exista pública NO significa necesariamente
      un error.

      Puede ser que esa persona todavía no haya
      completado la ficha médica.

      Lo seguimos informando, pero NO creamos nada.
    */
    if (
      resultadoPublica.estado ===
      "sin_publica"
    ) {
      sinPublica++;
    }

    if (
      resultadoPublica.estado ===
      "publica_ambigua"
    ) {
      publicaAmbigua++;
    }

    /*
      ===================================================
      7. RESULTADO DE ESA PERSONA
      ===================================================
    */

    let accion =
      "OK";

    if (
      !coincideNombreOficial
    ) {
      accion =
        dryRun
          ? "REPARARIA_OFICIAL"
          : "OFICIAL_REPARADA";
    }

    if (
      resultadoPublica.estado ===
      "repararia_publica"
    ) {
      accion =
        !coincideNombreOficial
          ? "REPARARIA_OFICIAL_Y_PUBLICA"
          : "REPARARIA_PUBLICA";
    }

    if (
      resultadoPublica.estado ===
      "publica_reparada"
    ) {
      accion =
        !coincideNombreOficial
          ? "OFICIAL_Y_PUBLICA_REPARADAS"
          : "PUBLICA_REPARADA";
    }

    resultados.push({
      accion,

      rut:
        rutInfo.rut ||
        rutKey,

      nombreSistemaPagos:
        nombrePagos.nombreCompleto,

      nombreOficial:
        nombreOficial.nombreCompleto,

      publica:
        resultadoPublica.estado,

      nombrePublicoActual:
        resultadoPublica
          ?.nombrePublicoActual ||
        "",

      nombrePublicoNuevo:
        resultadoPublica
          ?.nombreNuevo ||
        ""
    });
  }

  /*
    =====================================================
    8. RESUMEN
    =====================================================
  */

  const resumen = {
    groupDocId,
    numeroNegocio,
    dryRun,

    totalSistemaPagos:
      pasajerosPagos.length,

    revisados,

    iguales,

    diferentes,

    oficialesCorregidos,

    publicosCorregidos,

    publicosRepararian,

    publicosYaCorrectos,

    sinOficial,

    ambiguosOficial,

    sinRut,

    sinPublica,

    publicaAmbigua
  };

  console.log(
    "🏁 [NOMBRES SP] GRUPO TERMINADO",
    {
      groupDocId,
      numeroNegocio
    }
  );

  console.table(
    resultados
  );

  console.table([
    resumen
  ]);

  return {
    resumen,
    resultados
  };
};

/* =========================================================
   SINCRONIZACIÓN MASIVA DE NOMBRES DESDE SISTEMA DE PAGOS
   SOLO:
   - estado = "Ganada"
   - anoViaje = 2026

   IMPORTANTE:
   - Reutiliza sincronizarNombresGrupoDesdeSistemaPagos()
   - El match de pasajeros es por RUT.
   - Corrige oficial + pública.
   - NO crea pasajeros.
   - NO toca fechas.
   - NO toca RUT.
========================================================= */

window.sincronizarNombresGanadas2026DesdeSistemaPagos =
async function ({
  dryRun = true
} = {}) {
  console.log(
    dryRun
      ? "🔎 [NOMBRES SP MASIVO] SIMULACIÓN · GANADAS 2026"
      : "🛠️ [NOMBRES SP MASIVO] EJECUCIÓN REAL · GANADAS 2026"
  );

  /*
    =====================================================
    1. BUSCAMOS LOS GRUPOS QUE CORRESPONDEN
    =====================================================
  */

  const gruposSnap =
    await getDocs(
      query(
        collection(
          db,
          "ventas_cotizaciones"
        ),
        where(
          "estado",
          "==",
          "Ganada"
        ),
        where(
          "anoViaje",
          "==",
          2026
        )
      )
    );

  console.log(
    `📦 Grupos Ganada 2026 encontrados: ${gruposSnap.docs.length}`
  );

  const resultadosGrupos =
    [];

  let totalGruposProcesados = 0;
  let totalGruposConError = 0;

  let totalPasajerosRevisados = 0;
  let totalIguales = 0;
  let totalDiferentes = 0;

  let totalOficialesCorregidos = 0;
  let totalPublicosCorregidos = 0;

  let totalSinOficial = 0;
  let totalAmbiguosOficial = 0;
  let totalSinRut = 0;
  let totalSinPublica = 0;
  let totalPublicaAmbigua = 0;

  /*
    =====================================================
    2. PROCESAMOS GRUPO POR GRUPO
    =====================================================
  */

  for (
    let index = 0;
    index < gruposSnap.docs.length;
    index += 1
  ) {
    const grupoDoc =
      gruposSnap.docs[index];

    const grupo =
      grupoDoc.data() ||
      {};

    const groupDocId =
      grupoDoc.id;

    const numeroNegocio =
      String(
        grupo.numeroNegocio ||
        grupo?.ficha?.numeroNegocio ||
        ""
      ).trim();

    const nombreGrupo =
      grupo.aliasGrupo ||
      grupo.nombreGrupo ||
      grupo.colegio ||
      groupDocId;

    console.log(
      `\n📋 [${index + 1}/${gruposSnap.docs.length}]`,
      {
        groupDocId,
        numeroNegocio,
        grupo:
          nombreGrupo
      }
    );

    /*
      Si no tiene número de negocio,
      no podemos consultar Sistema de Pagos.
    */
    if (!numeroNegocio) {
      console.warn(
        "⚠️ Grupo sin numeroNegocio",
        {
          groupDocId,
          grupo:
            nombreGrupo
        }
      );

      resultadosGrupos.push({
        groupDocId,
        numeroNegocio:
          "",

        grupo:
          nombreGrupo,

        estado:
          "SIN_NUMERO_NEGOCIO",

        revisados:
          0,

        iguales:
          0,

        diferentes:
          0,

        oficialesCorregidos:
          0,

        publicosCorregidos:
          0,

        sinOficial:
          0,

        ambiguosOficial:
          0,

        sinRut:
          0,

        sinPublica:
          0,

        publicaAmbigua:
          0
      });

      continue;
    }

    try {
      const resultado =
        await window
          .sincronizarNombresGrupoDesdeSistemaPagos(
            groupDocId,
            {
              dryRun
            }
          );

      const resumen =
        resultado?.resumen ||
        {};

      totalGruposProcesados++;

      totalPasajerosRevisados +=
        Number(
          resumen.revisados ||
          0
        );

      totalIguales +=
        Number(
          resumen.iguales ||
          0
        );

      totalDiferentes +=
        Number(
          resumen.diferentes ||
          0
        );

      totalOficialesCorregidos +=
        Number(
          resumen.oficialesCorregidos ||
          0
        );

      totalPublicosCorregidos +=
        Number(
          resumen.publicosCorregidos ||
          0
        );

      totalSinOficial +=
        Number(
          resumen.sinOficial ||
          0
        );

      totalAmbiguosOficial +=
        Number(
          resumen.ambiguosOficial ||
          0
        );

      totalSinRut +=
        Number(
          resumen.sinRut ||
          0
        );

      totalSinPublica +=
        Number(
          resumen.sinPublica ||
          0
        );

      totalPublicaAmbigua +=
        Number(
          resumen.publicaAmbigua ||
          0
        );

      resultadosGrupos.push({
        groupDocId,

        numeroNegocio,

        grupo:
          nombreGrupo,

        estado:
          "OK",

        revisados:
          Number(
            resumen.revisados ||
            0
          ),

        iguales:
          Number(
            resumen.iguales ||
            0
          ),

        diferentes:
          Number(
            resumen.diferentes ||
            0
          ),

        oficialesCorregidos:
          Number(
            resumen.oficialesCorregidos ||
            0
          ),

        publicosCorregidos:
          Number(
            resumen.publicosCorregidos ||
            0
          ),

        sinOficial:
          Number(
            resumen.sinOficial ||
            0
          ),

        ambiguosOficial:
          Number(
            resumen.ambiguosOficial ||
            0
          ),

        sinRut:
          Number(
            resumen.sinRut ||
            0
          ),

        sinPublica:
          Number(
            resumen.sinPublica ||
            0
          ),

        publicaAmbigua:
          Number(
            resumen.publicaAmbigua ||
            0
          )
      });
    } catch (error) {
      totalGruposConError++;

      console.error(
        "❌ [NOMBRES SP MASIVO] Error en grupo",
        {
          groupDocId,
          numeroNegocio,
          grupo:
            nombreGrupo,
          error
        }
      );

      resultadosGrupos.push({
        groupDocId,

        numeroNegocio,

        grupo:
          nombreGrupo,

        estado:
          "ERROR",

        revisados:
          0,

        iguales:
          0,

        diferentes:
          0,

        oficialesCorregidos:
          0,

        publicosCorregidos:
          0,

        sinOficial:
          0,

        ambiguosOficial:
          0,

        sinRut:
          0,

        sinPublica:
          0,

        publicaAmbigua:
          0,

        error:
          error?.message ||
          "Error desconocido"
      });
    }
  }

  /*
    =====================================================
    3. RESUMEN GENERAL
    =====================================================
  */

  const resumenGeneral = {
    dryRun,

    gruposEncontrados:
      gruposSnap.docs.length,

    gruposProcesados:
      totalGruposProcesados,

    gruposConError:
      totalGruposConError,

    pasajerosRevisados:
      totalPasajerosRevisados,

    nombresIguales:
      totalIguales,

    nombresDiferentes:
      totalDiferentes,

    oficialesCorregidos:
      totalOficialesCorregidos,

    publicosCorregidos:
      totalPublicosCorregidos,

    sinOficial:
      totalSinOficial,

    ambiguosOficial:
      totalAmbiguosOficial,

    sinRut:
      totalSinRut,

    sinPublica:
      totalSinPublica,

    publicaAmbigua:
      totalPublicaAmbigua
  };

  console.log(
    "\n🏁 [NOMBRES SP MASIVO] PROCESO TERMINADO"
  );

  console.log(
    "\n📋 RESULTADO POR GRUPO"
  );

  console.table(
    resultadosGrupos
  );

  console.log(
    "\n📊 RESUMEN GENERAL"
  );

  console.table([
    resumenGeneral
  ]);

  /*
    Grupos donde ocurrió algo relevante.
  */
  const gruposConNovedades =
    resultadosGrupos.filter(
      (item) =>
        item.estado !==
          "OK" ||
        Number(
          item.diferentes ||
          0
        ) > 0 ||
        Number(
          item.sinOficial ||
          0
        ) > 0 ||
        Number(
          item.ambiguosOficial ||
          0
        ) > 0 ||
        Number(
          item.sinRut ||
          0
        ) > 0 ||
        Number(
          item.sinPublica ||
          0
        ) > 0 ||
        Number(
          item.publicaAmbigua ||
          0
        ) > 0
    );

  console.log(
    "\n⚠️ GRUPOS CON NOVEDADES"
  );

  console.table(
    gruposConNovedades
  );

  return {
    resumen:
      resumenGeneral,

    grupos:
      resultadosGrupos,

    gruposConNovedades
  };
};

/* =========================================================
   DIAGNÓSTICO DE PASAJEROS QUE ESTÁN EN SISTEMA DE PAGOS
   PERO NO APARECEN POR RUT EN LA NÓMINA OFICIAL

   SOLO LECTURA.
   NO MODIFICA FIREBASE.

   CLASIFICACIONES:
   - MISMO_RUT_NO_ACTIVO
   - MISMO_NOMBRE_RUT_DISTINTO
   - POSIBLE_NOMBRE_RUT_DISTINTO
   - FALTANTE_PROBABLE
========================================================= */

function normalizarNombreDiagnosticoPagos(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

function getNombreCompletoDiagnosticoOficial(item = {}) {
  const identificacion =
    item.identificacion ||
    {};

  const nombres =
    cleanText(
      identificacion.nombres ||
      getInscripcionNombres(item) ||
      ""
    );

  const primerApellido =
    cleanText(
      identificacion.primerApellido ||
      ""
    );

  const segundoApellido =
    cleanText(
      identificacion.segundoApellido ||
      ""
    );

  const directo =
    [
      nombres,
      primerApellido,
      segundoApellido
    ]
      .filter(Boolean)
      .join(" ")
      .trim();

  if (directo) {
    return directo;
  }

  return [
    getInscripcionNombres(item),
    getInscripcionApellidos(item)
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
}

function getEstadoDiagnosticoOficial(item = {}) {
  const privacidad =
    normalizeSearchLocal(
      item?.privacidad?.estado ||
      ""
    );

  if (
    privacidad === "archivada"
  ) {
    return "ARCHIVADA";
  }

  if (
    privacidad ===
    "eliminada_logica"
  ) {
    return "ELIMINADA_LOGICA";
  }

  if (
    typeof estaInscripcionAnulada ===
      "function" &&
    estaInscripcionAnulada(item)
  ) {
    return "ANULADA";
  }

  if (item.viaja === false) {
    return "NO_VIAJA";
  }

  return "ACTIVA";
}

function calcularSimilitudNombreDiagnostico(
  nombreA = "",
  nombreB = ""
) {
  const a =
    normalizarNombreDiagnosticoPagos(
      nombreA
    );

  const b =
    normalizarNombreDiagnosticoPagos(
      nombreB
    );

  if (!a || !b) {
    return {
      score: 0,
      tokensComunes: 0
    };
  }

  if (a === b) {
    return {
      score: 1,
      tokensComunes:
        a.split(/\s+/).length
    };
  }

  const tokensA =
    new Set(
      a.split(/\s+/)
        .filter(Boolean)
    );

  const tokensB =
    new Set(
      b.split(/\s+/)
        .filter(Boolean)
    );

  const comunes =
    [...tokensA]
      .filter(
        (token) =>
          tokensB.has(token)
      );

  const union =
    new Set([
      ...tokensA,
      ...tokensB
    ]);

  return {
    score:
      union.size
        ? comunes.length /
          union.size
        : 0,

    tokensComunes:
      comunes.length
  };
}

window.diagnosticarSinOficialGrupoDesdeSistemaPagos =
async function (
  groupDocIdParam = ""
) {
  const groupDocId =
    String(
      groupDocIdParam ||
      state.groupDocId ||
      ""
    ).trim();

  if (!groupDocId) {
    throw new Error(
      "Falta idGrupo / groupDocId."
    );
  }

  /*
    =====================================================
    1. GRUPO
    =====================================================
  */

  const grupoSnap =
    await getDoc(
      doc(
        db,
        "ventas_cotizaciones",
        groupDocId
      )
    );

  if (!grupoSnap.exists()) {
    throw new Error(
      `No existe ventas_cotizaciones/${groupDocId}`
    );
  }

  const grupo =
    grupoSnap.data() ||
    {};

  const numeroNegocio =
    String(
      grupo.numeroNegocio ||
      grupo?.ficha?.numeroNegocio ||
      ""
    ).trim();

  if (!numeroNegocio) {
    throw new Error(
      `El grupo ${groupDocId} no tiene numeroNegocio.`
    );
  }

  console.log(
    "🔎 [SIN OFICIAL] DIAGNÓSTICO",
    {
      groupDocId,
      numeroNegocio,
      grupo:
        grupo.aliasGrupo ||
        grupo.nombreGrupo ||
        grupo.colegio ||
        ""
    }
  );

  /*
    =====================================================
    2. SISTEMA DE PAGOS
    =====================================================
  */

  const pasajerosPagos =
    await consultarNominaPagos(
      numeroNegocio
    );

  /*
    =====================================================
    3. TODA LA NÓMINA OFICIAL

    IMPORTANTE:
    aquí NO excluimos archivados, anulados ni no-viaja,
    porque queremos saber si la persona existe ahí.
    =====================================================
  */

  const oficialSnap =
    await getDocs(
      collection(
        db,
        "ventas_cotizaciones",
        groupDocId,
        "inscripciones"
      )
    );

  const oficiales =
    oficialSnap.docs.map(
      (inscDoc) => {
        const item = {
          id: inscDoc.id,
          ...inscDoc.data()
        };

        const rut =
          getInscripcionDocumento(
            item
          );

        const nombre =
          getNombreCompletoDiagnosticoOficial(
            item
          );

        return {
          id:
            inscDoc.id,

          item,

          rut,

          rutKey:
            normalizarRutKeyGrupo(
              rut ||
              inscDoc.id ||
              ""
            ),

          nombre,

          nombreKey:
            normalizarNombreDiagnosticoPagos(
              nombre
            ),

          estado:
            getEstadoDiagnosticoOficial(
              item
            )
        };
      }
    );

  /*
    =====================================================
    4. RUTS ACTIVOS
    =====================================================
  */

  const rutsActivos =
    new Set(
      oficiales
        .filter(
          (item) =>
            item.estado ===
            "ACTIVA"
        )
        .map(
          (item) =>
            item.rutKey
        )
        .filter(Boolean)
    );

  const resultados =
    [];

  /*
    =====================================================
    5. REVISAMOS SOLO LOS QUE NO ESTÁN POR RUT ACTIVO
    =====================================================
  */

  for (
    const pasajeroPagos
    of pasajerosPagos
  ) {
    const rutInfo =
      formatearRutDesdePagos(
        pasajeroPagos.rut ||
        ""
      );

    const rutKey =
      normalizarRutKeyGrupo(
        rutInfo.rut ||
        rutInfo.documentoNormalizado ||
        ""
      );

    /*
      Sin RUT no podemos decidir nada.
    */
    if (!rutKey) {
      continue;
    }

    /*
      Ya está correctamente encontrado
      por RUT en la oficial activa.
    */
    if (
      rutsActivos.has(
        rutKey
      )
    ) {
      continue;
    }

    const nombrePagosObj =
      construirNombreDesdePagos(
        pasajeroPagos
      );

    const nombreSistemaPagos =
      nombrePagosObj
        .nombreCompleto;

    const nombrePagosKey =
      normalizarNombreDiagnosticoPagos(
        nombreSistemaPagos
      );

    /*
      ===================================================
      A. MISMO RUT, PERO ESTÁ NO ACTIVO
      ===================================================
    */

    const mismoRutNoActivo =
      oficiales.filter(
        (oficial) =>
          oficial.rutKey ===
            rutKey &&
          oficial.estado !==
            "ACTIVA"
      );

    if (
      mismoRutNoActivo.length
    ) {
      resultados.push({
        clasificacion:
          "MISMO_RUT_NO_ACTIVO",

        groupDocId,

        numeroNegocio,

        rutSistemaPagos:
          rutInfo.rut ||
          rutKey,

        nombreSistemaPagos,

        rutOficial:
          mismoRutNoActivo
            .map(
              (x) => x.rut
            )
            .join(" | "),

        nombreOficial:
          mismoRutNoActivo
            .map(
              (x) => x.nombre
            )
            .join(" | "),

        estadoOficial:
          mismoRutNoActivo
            .map(
              (x) => x.estado
            )
            .join(" | "),

        similitud:
          100,

        detalle:
          "El mismo RUT existe en la nómina, pero no está activo."
      });

      continue;
    }

    /*
      ===================================================
      B. MISMO NOMBRE EXACTO, RUT DIFERENTE
      ===================================================
    */

    const mismoNombre =
      oficiales.filter(
        (oficial) =>
          oficial.nombreKey &&
          oficial.nombreKey ===
            nombrePagosKey
      );

    if (
      mismoNombre.length
    ) {
      resultados.push({
        clasificacion:
          "MISMO_NOMBRE_RUT_DISTINTO",

        groupDocId,

        numeroNegocio,

        rutSistemaPagos:
          rutInfo.rut ||
          rutKey,

        nombreSistemaPagos,

        rutOficial:
          mismoNombre
            .map(
              (x) => x.rut
            )
            .join(" | "),

        nombreOficial:
          mismoNombre
            .map(
              (x) => x.nombre
            )
            .join(" | "),

        estadoOficial:
          mismoNombre
            .map(
              (x) => x.estado
            )
            .join(" | "),

        similitud:
          100,

        detalle:
          "Existe el mismo nombre completo en la oficial, pero con otro RUT."
      });

      continue;
    }

    /*
      ===================================================
      C. NOMBRE PARECIDO, RUT DIFERENTE
      ===================================================
    */

    const candidatosParecidos =
      oficiales
        .map(
          (oficial) => {
            const sim =
              calcularSimilitudNombreDiagnostico(
                nombreSistemaPagos,
                oficial.nombre
              );

            return {
              ...oficial,

              score:
                sim.score,

              tokensComunes:
                sim.tokensComunes
            };
          }
        )
        .filter(
          (oficial) =>
            oficial.score >=
              0.5 &&
            oficial.tokensComunes >=
              2
        )
        .sort(
          (a, b) =>
            b.score -
            a.score
        );

    const mejor =
      candidatosParecidos[0] ||
      null;

    if (mejor) {
      resultados.push({
        clasificacion:
          "POSIBLE_NOMBRE_RUT_DISTINTO",

        groupDocId,

        numeroNegocio,

        rutSistemaPagos:
          rutInfo.rut ||
          rutKey,

        nombreSistemaPagos,

        rutOficial:
          mejor.rut,

        nombreOficial:
          mejor.nombre,

        estadoOficial:
          mejor.estado,

        similitud:
          Math.round(
            mejor.score *
            100
          ),

        detalle:
          "Hay una inscripción con nombre parecido. Revisar antes de importar como persona nueva."
      });

      continue;
    }

    /*
      ===================================================
      D. NO APARECE POR RUT NI POR NOMBRE

      ESTE ES EL CANDIDATO REAL A INCORPORAR.
      ===================================================
    */

    resultados.push({
      clasificacion:
        "FALTANTE_PROBABLE",

      groupDocId,

      numeroNegocio,

      rutSistemaPagos:
        rutInfo.rut ||
        rutKey,

      nombreSistemaPagos,

      rutOficial:
        "",

      nombreOficial:
        "",

      estadoOficial:
        "",

      similitud:
        0,

      detalle:
        "No aparece por RUT ni encontramos un nombre equivalente en la nómina oficial. Candidato a importar desde Sistema de Pagos."
    });
  }

  /*
    =====================================================
    6. RESUMEN
    =====================================================
  */

  const resumen = {
    groupDocId,
    numeroNegocio,

    totalSistemaPagos:
      pasajerosPagos.length,

    totalOficial:
      oficiales.length,

    totalSinOficial:
      resultados.length,

    mismoRutNoActivo:
      resultados.filter(
        (x) =>
          x.clasificacion ===
          "MISMO_RUT_NO_ACTIVO"
      ).length,

    mismoNombreRutDistinto:
      resultados.filter(
        (x) =>
          x.clasificacion ===
          "MISMO_NOMBRE_RUT_DISTINTO"
      ).length,

    posibleNombreRutDistinto:
      resultados.filter(
        (x) =>
          x.clasificacion ===
          "POSIBLE_NOMBRE_RUT_DISTINTO"
      ).length,

    faltanteProbable:
      resultados.filter(
        (x) =>
          x.clasificacion ===
          "FALTANTE_PROBABLE"
      ).length
  };

  console.log(
    "🏁 [SIN OFICIAL] DIAGNÓSTICO TERMINADO"
  );

  console.table(
    resultados
  );

  console.table([
    resumen
  ]);

  return {
    resumen,
    resultados
  };
};


/* =========================================================
   DIAGNÓSTICO MASIVO SIN OFICIAL
   GANADA + AÑO VIAJE 2026

   SOLO LECTURA.
========================================================= */

window.diagnosticarSinOficialGanadas2026 =
async function () {
  console.log(
    "🔎 [SIN OFICIAL MASIVO] GANADAS 2026"
  );

  const gruposSnap =
    await getDocs(
      query(
        collection(
          db,
          "ventas_cotizaciones"
        ),
        where(
          "estado",
          "==",
          "Ganada"
        ),
        where(
          "anoViaje",
          "==",
          2026
        )
      )
    );

  const casos =
    [];

  const resumenGrupos =
    [];

  for (
    let index = 0;
    index <
      gruposSnap.docs.length;
    index += 1
  ) {
    const grupoDoc =
      gruposSnap.docs[index];

    const grupo =
      grupoDoc.data() ||
      {};

    const numeroNegocio =
      String(
        grupo.numeroNegocio ||
        grupo?.ficha
          ?.numeroNegocio ||
        ""
      ).trim();

    console.log(
      `📋 ${index + 1}/${gruposSnap.docs.length}`,
      {
        groupDocId:
          grupoDoc.id,

        numeroNegocio,

        grupo:
          grupo.aliasGrupo ||
          grupo.nombreGrupo ||
          grupo.colegio ||
          ""
      }
    );

    if (!numeroNegocio) {
      resumenGrupos.push({
        groupDocId:
          grupoDoc.id,

        numeroNegocio:
          "",

        grupo:
          grupo.aliasGrupo ||
          grupo.nombreGrupo ||
          grupo.colegio ||
          "",

        estado:
          "SIN_NUMERO_NEGOCIO",

        sinOficial:
          0
      });

      continue;
    }

    try {
      const resultado =
        await window
          .diagnosticarSinOficialGrupoDesdeSistemaPagos(
            grupoDoc.id
          );

      const detalle =
        resultado?.resultados ||
        [];

      casos.push(
        ...detalle.map(
          (item) => ({
            grupo:
              grupo.aliasGrupo ||
              grupo.nombreGrupo ||
              grupo.colegio ||
              "",

            ...item
          })
        )
      );

      resumenGrupos.push({
        groupDocId:
          grupoDoc.id,

        numeroNegocio,

        grupo:
          grupo.aliasGrupo ||
          grupo.nombreGrupo ||
          grupo.colegio ||
          "",

        estado:
          "OK",

        sinOficial:
          detalle.length,

        mismoRutNoActivo:
          resultado
            ?.resumen
            ?.mismoRutNoActivo ||
          0,

        mismoNombreRutDistinto:
          resultado
            ?.resumen
            ?.mismoNombreRutDistinto ||
          0,

        posibleNombreRutDistinto:
          resultado
            ?.resumen
            ?.posibleNombreRutDistinto ||
          0,

        faltanteProbable:
          resultado
            ?.resumen
            ?.faltanteProbable ||
          0
      });
    } catch (error) {
      console.error(
        "❌ [SIN OFICIAL] Error en grupo",
        grupoDoc.id,
        error
      );

      resumenGrupos.push({
        groupDocId:
          grupoDoc.id,

        numeroNegocio,

        grupo:
          grupo.aliasGrupo ||
          grupo.nombreGrupo ||
          grupo.colegio ||
          "",

        estado:
          "ERROR",

        error:
          error?.message ||
          "Error desconocido"
      });
    }
  }

  const resumenGeneral = {
    gruposRevisados:
      gruposSnap.docs.length,

    casosSinOficial:
      casos.length,

    mismoRutNoActivo:
      casos.filter(
        (x) =>
          x.clasificacion ===
          "MISMO_RUT_NO_ACTIVO"
      ).length,

    mismoNombreRutDistinto:
      casos.filter(
        (x) =>
          x.clasificacion ===
          "MISMO_NOMBRE_RUT_DISTINTO"
      ).length,

    posibleNombreRutDistinto:
      casos.filter(
        (x) =>
          x.clasificacion ===
          "POSIBLE_NOMBRE_RUT_DISTINTO"
      ).length,

    faltanteProbable:
      casos.filter(
        (x) =>
          x.clasificacion ===
          "FALTANTE_PROBABLE"
      ).length
  };

  console.log(
    "\n🏁 [SIN OFICIAL MASIVO] TERMINADO"
  );

  console.log(
    "\n📊 RESUMEN GENERAL"
  );

  console.table([
    resumenGeneral
  ]);

  console.log(
    "\n📋 CASOS SIN OFICIAL"
  );

  console.table(
    casos
  );

  console.log(
    "\n📦 GRUPOS CON CASOS"
  );

  console.table(
    resumenGrupos.filter(
      (item) =>
        Number(
          item.sinOficial ||
          0
        ) > 0 ||
        item.estado !==
          "OK"
    )
  );

  return {
    resumen:
      resumenGeneral,

    casos,

    grupos:
      resumenGrupos
  };
};

window.importarNominaPagosPorNumeroNegocio = async function (numeroNegocio, options = {}) {
  const dryRun = options.dryRun !== false;

  const grupo = await buscarGrupoPorNumeroNegocio(numeroNegocio);
  const pasajeros = await consultarNominaPagos(numeroNegocio);

  const resultado = {
    numeroNegocio: String(numeroNegocio),
    groupDocId: grupo.docId,
    totalPagos: pasajeros.length,
    creados: 0,
    existentes: 0,
    omitidosSinRut: 0,
    dryRun,
    detalle: []
  };

  for (const p of pasajeros) {
    const rutInfo = formatearRutDesdePagos(p.rut || "");

    if (!rutInfo.rut) {
      resultado.omitidosSinRut += 1;
      resultado.detalle.push({
        accion: "omitido_sin_rut",
        nombre: capitalizarNombrePagos(`${p.nombres || ""} ${p.apellidos || ""}`)
      });
      continue;
    }

    const docId = rutInfo.documentoNormalizado;
    const ref = doc(db, "ventas_cotizaciones", grupo.docId, "inscripciones", docId);
    const snap = await getDoc(ref);
    const payload = buildPayloadInscripcionDesdePagos(p, grupo.data, grupo.docId);

    if (snap.exists()) {
      resultado.existentes += 1;
      resultado.detalle.push({
        accion: "ya_existia",
        docId,
        rut: rutInfo.rut,
        nombre: payload.identificacion.nombreCompleto
      });
      continue;
    }

    resultado.detalle.push({
      accion: dryRun ? "simular_creacion" : "creado",
      docId,
      rut: rutInfo.rut,
      nombre: payload.identificacion.nombreCompleto,
      tipoViajante: payload.tipoViajante,
      correo: payload.contactoPrincipal.correo,
      telefono: payload.contactoPrincipal.telefono,
      viaja: payload.sistemaPagos.viaja
    });

    if (!dryRun) {
      await setDoc(ref, {
        ...payload,
        creadoPor: getDisplayName(state.effectiveUser),
        creadoPorCorreo: state.effectiveEmail,
        creadoAt: serverTimestamp(),
        actualizadoPor: getDisplayName(state.effectiveUser),
        actualizadoPorCorreo: state.effectiveEmail,
        actualizadoAt: serverTimestamp()
      });
    }

    resultado.creados += 1;
  }

  console.table(resultado.detalle);
  console.log("RESULTADO IMPORTACIÓN:", resultado);

  if (!dryRun) {
    await loadInscripciones();
    renderInscripcionPasajerosPanel();
    syncButtons();
    showSaveNotice(`Importación lista: ${resultado.creados} creados, ${resultado.existentes} ya existían.`);
  }

  return resultado;
};

window.importarNominasPagosCompuestasEnGrupoActual = async function (
  numerosNegocio = [],
  options = {}
) {
  const dryRun = options.dryRun !== false;

  if (!state.groupDocId) {
    throw new Error(
      "No hay un grupo abierto. Ejecuta esta función desde grupo.html con el grupo correspondiente abierto."
    );
  }

  const numeros = [
    ...new Set(
      (Array.isArray(numerosNegocio)
        ? numerosNegocio
        : [numerosNegocio]
      )
        .map((n) => String(n || "").trim())
        .filter(Boolean)
    )
  ];

  if (!numeros.length) {
    throw new Error(
      "Debes indicar al menos un número de negocio."
    );
  }

  console.log(
    "===================================================="
  );
  console.log(
    dryRun
      ? "🧪 IMPORTACIÓN COMPUESTA · SIMULACIÓN"
      : "🚀 IMPORTACIÓN COMPUESTA · EJECUCIÓN REAL"
  );
  console.log(
    "===================================================="
  );

  console.log("Grupo destino:", {
    groupDocId: state.groupDocId,
    idGrupo: state.groupId,
    numeroNegocioGuardado:
      state.group?.numeroNegocio ||
      state.group?.ficha?.numeroNegocio ||
      ""
  });

  console.log(
    "Números Sistema de Pagos:",
    numeros
  );

  const resultadoGeneral = {
    groupDocId: String(state.groupDocId),
    groupId: String(state.groupId || ""),
    numerosNegocio: numeros,
    dryRun,

    totalPagos: 0,
    creados: 0,
    existentes: 0,
    omitidosSinRut: 0,

    negocios: [],
    detalle: []
  };

  for (
    let index = 0;
    index < numeros.length;
    index += 1
  ) {
    const numeroNegocio =
      numeros[index];

    console.log(
      `▶️ ${index + 1}/${numeros.length} · Consultando nómina ${numeroNegocio}`
    );

    try {
      /*
        IMPORTANTE:
        aquí NO buscamos el grupo por numeroNegocio.

        El grupo destino es SIEMPRE el grupo
        actualmente abierto en grupo.html.
      */
      const pasajeros =
        await consultarNominaPagos(
          numeroNegocio
        );

      const resultadoNegocio = {
        numeroNegocio,
        estado: "OK",
        totalPagos: pasajeros.length,
        creados: 0,
        existentes: 0,
        omitidosSinRut: 0
      };

      resultadoGeneral.totalPagos +=
        pasajeros.length;

      for (const p of pasajeros) {
        const rutInfo =
          formatearRutDesdePagos(
            p.rut || ""
          );

        if (!rutInfo.rut) {
          resultadoNegocio.omitidosSinRut +=
            1;

          resultadoGeneral.omitidosSinRut +=
            1;

          resultadoGeneral.detalle.push({
            numeroNegocio,
            accion: "omitido_sin_rut",
            nombre:
              capitalizarNombrePagos(
                `${p.nombres || ""} ${p.apellidos || ""}`
              )
          });

          continue;
        }

        const docId =
          rutInfo.documentoNormalizado;

        const ref =
          doc(
            db,
            "ventas_cotizaciones",
            String(state.groupDocId),
            "inscripciones",
            docId
          );

        const snap =
          await getDoc(ref);

        const payload =
          buildPayloadInscripcionDesdePagos(
            p,
            state.group,
            state.groupDocId
          );

        /*
          Dejamos además registrado desde cuál
          número del Sistema de Pagos llegó
          específicamente esta persona.
        */
        payload.sistemaPagos = {
          ...(payload.sistemaPagos || {}),

          numeroNegocioOrigen:
            String(numeroNegocio),

          importacionCompuesta:
            true
        };

        if (snap.exists()) {
          resultadoNegocio.existentes +=
            1;

          resultadoGeneral.existentes +=
            1;

          resultadoGeneral.detalle.push({
            numeroNegocio,
            accion: "ya_existia",
            docId,
            rut: rutInfo.rut,
            nombre:
              payload.identificacion
                ?.nombreCompleto || ""
          });

          continue;
        }

        resultadoGeneral.detalle.push({
          numeroNegocio,

          accion:
            dryRun
              ? "simular_creacion"
              : "creado",

          docId,
          rut: rutInfo.rut,

          nombre:
            payload.identificacion
              ?.nombreCompleto || "",

          tipoViajante:
            payload.tipoViajante,

          viaja:
            payload.sistemaPagos?.viaja
        });

        if (!dryRun) {
          await setDoc(
            ref,
            {
              ...payload,

              creadoPor:
                getDisplayName(
                  state.effectiveUser
                ),

              creadoPorCorreo:
                state.effectiveEmail,

              creadoAt:
                serverTimestamp(),

              actualizadoPor:
                getDisplayName(
                  state.effectiveUser
                ),

              actualizadoPorCorreo:
                state.effectiveEmail,

              actualizadoAt:
                serverTimestamp()
            }
          );
        }

        resultadoNegocio.creados +=
          1;

        resultadoGeneral.creados +=
          1;
      }

      resultadoGeneral.negocios.push(
        resultadoNegocio
      );

      console.log(
        `✅ Nómina ${numeroNegocio} terminada`,
        resultadoNegocio
      );

    } catch (error) {
      console.error(
        `❌ Error consultando negocio ${numeroNegocio}`,
        error
      );

      resultadoGeneral.negocios.push({
        numeroNegocio,
        estado: "ERROR",
        error:
          error?.message ||
          String(error)
      });
    }
  }

  console.log(
    "===================================================="
  );
  console.log(
    "🏁 IMPORTACIÓN COMPUESTA TERMINADA"
  );
  console.log(
    "===================================================="
  );

  console.table(
    resultadoGeneral.negocios
  );

  console.log(
    "RESULTADO GENERAL:",
    resultadoGeneral
  );

  if (!dryRun) {
    await loadInscripciones();

    state.nominaVisible = true;

    renderInscripcionPasajerosPanel();
    syncButtons();

    showSaveNotice(
      `Importación compuesta lista: ${resultadoGeneral.creados} creados, ${resultadoGeneral.existentes} ya existían.`
    );
  }

  return resultadoGeneral;
};

window.importarTodasNominasPagos = async function (options = {}) {
  const {
    dryRun = true
  } = options;

  const gruposSnap = await getDocs(collection(db, "ventas_cotizaciones"));

  let procesados = 0;
  let importados = 0;
  let omitidosSinNumeroNegocio = 0;
  let omitidosConInscripcionInicial = 0;
  let errores = 0;

  for (const grupoDoc of gruposSnap.docs) {
    const grupo = grupoDoc.data() || {};

    const numeroNegocio = String(
      grupo.numeroNegocio ||
      grupo.ficha?.numeroNegocio ||
      ""
    ).trim();

    if (!numeroNegocio) {
      omitidosSinNumeroNegocio++;
      console.log(`⏭️ ${grupoDoc.id}: sin numeroNegocio.`);
      continue;
    }

    procesados++;

    try {
      const inscSnap = await getDocs(
        collection(
          db,
          "ventas_cotizaciones",
          grupoDoc.id,
          "inscripciones"
        )
      );

      const tieneInscripcionInicial = inscSnap.docs.some((d) => {
        const data = d.data() || {};

        const estadoPrivacidad = normalizeSearchLocal(
          data?.privacidad?.estado || ""
        );

        if (
          estadoPrivacidad === "archivada" ||
          estadoPrivacidad === "eliminada_logica"
        ) {
          return false;
        }

        const tipo = normalizeSearchLocal(
          getInscripcionTipoReal({
            id: d.id,
            ...data
          })
        );

        return (
          tipo === "nomina_inicial" ||
          tipo === "inscripcion_comercial"
        );
      });

      if (tieneInscripcionInicial) {
        omitidosConInscripcionInicial++;

        console.log(
          `⏭️ ${numeroNegocio}: tiene inscripción inicial; no se importa desde Sistema de Pagos.`
        );

        continue;
      }

      console.log(
        `▶️ Importando numeroNegocio ${numeroNegocio} · doc ${grupoDoc.id}`
      );

      await window.importarNominaPagosPorNumeroNegocio(
        numeroNegocio,
        { dryRun }
      );

      importados++;

    } catch (error) {
      errores++;

      console.error(
        `❌ Error importando ${numeroNegocio}:`,
        error
      );
    }
  }

  const resumen = {
    dryRun,
    procesados,
    importados,
    omitidosSinNumeroNegocio,
    omitidosConInscripcionInicial,
    errores
  };

  console.table([resumen]);

  return resumen;
};

window.importarNominasPagosAno = async function ({
  anoViaje = 2026,
  dryRun = true
} = {}) {
  const gruposSnap = await getDocs(
    collection(db, "ventas_cotizaciones")
  );

  const gruposDelAno = gruposSnap.docs
    .map((grupoDoc) => ({
      id: grupoDoc.id,
      data: grupoDoc.data() || {}
    }))
    .filter(({ data }) => {
      const ano = Number(
        data.anoViaje ??
        data.ficha?.anoViaje ??
        0
      );

      return ano === Number(anoViaje);
    })
    .sort((a, b) => {
      const numeroA = Number(
        a.data.numeroNegocio ||
        a.data.ficha?.numeroNegocio ||
        a.id ||
        0
      );

      const numeroB = Number(
        b.data.numeroNegocio ||
        b.data.ficha?.numeroNegocio ||
        b.id ||
        0
      );

      return numeroA - numeroB;
    });

  console.log(
    `📋 Grupos encontrados para el año ${anoViaje}:`,
    gruposDelAno.length
  );

  let procesados = 0;
  let importados = 0;
  let omitidosSinNumeroNegocio = 0;
  let omitidosConInscripcionInicial = 0;
  let errores = 0;

  for (let i = 0; i < gruposDelAno.length; i++) {
    const { id: grupoDocId, data: grupo } = gruposDelAno[i];

    const numeroNegocio = String(
      grupo.numeroNegocio ||
      grupo.ficha?.numeroNegocio ||
      ""
    ).trim();

    console.log(
      `⏳ ${i + 1}/${gruposDelAno.length} · Grupo ${grupoDocId} · Negocio ${numeroNegocio || "sin número"}`
    );

    if (!numeroNegocio) {
      omitidosSinNumeroNegocio++;

      console.warn(
        `⏭️ ${grupoDocId}: no tiene numeroNegocio.`
      );

      continue;
    }

    procesados++;

    try {
      /*
       * Solo se omite si el grupo ya tiene una Inscripción Inicial.
       *
       * Una lista de espera, un nuevo ingreso o un liberado
       * NO deben impedir traer la nómina desde Sistema de Pagos.
       */
      const inscripcionesSnap = await getDocs(
        collection(
          db,
          "ventas_cotizaciones",
          grupoDocId,
          "inscripciones"
        )
      );

      const tieneInscripcionInicial = inscripcionesSnap.docs.some((docSnap) => {
        const data = docSnap.data() || {};

        const estadoPrivacidad = normalizeSearchLocal(
          data?.privacidad?.estado || ""
        );

        if (
          estadoPrivacidad === "archivada" ||
          estadoPrivacidad === "eliminada_logica"
        ) {
          return false;
        }

        const tipo = normalizeSearchLocal(
          getInscripcionTipoReal({
            id: docSnap.id,
            ...data
          })
        );

        return (
          tipo === "nomina_inicial" ||
          tipo === "inscripcion_comercial"
        );
      });

      if (tieneInscripcionInicial) {
        omitidosConInscripcionInicial++;

        console.log(
          `⏭️ ${numeroNegocio}: tiene Inscripción Inicial; no se importa desde Sistema de Pagos.`
        );

        continue;
      }

      console.log(
        `▶️ Importando negocio ${numeroNegocio} · año ${anoViaje}`
      );

      const resultado =
        await window.importarNominaPagosPorNumeroNegocio(
          numeroNegocio,
          { dryRun }
        );

      importados++;

      console.log(
        `✅ ${numeroNegocio} terminado`,
        resultado
      );

    } catch (error) {
      errores++;

      console.error(
        `❌ Error importando ${numeroNegocio}:`,
        error
      );
    }
  }

  const resumen = {
    anoViaje,
    dryRun,
    gruposEncontrados: gruposDelAno.length,
    procesados,
    importados,
    omitidosSinNumeroNegocio,
    omitidosConInscripcionInicial,
    errores
  };

  console.log(
    `🏁 Importación del año ${anoViaje} terminada`
  );

  console.table([resumen]);

  return resumen;
};

window.sincronizarNominaPublicaConOficial =
async function (
  groupDocIdParam = "",
  {
    dryRun = true
  } = {}
) {
  const groupDocId =
    String(
      groupDocIdParam ||
      state.groupDocId ||
      ""
    ).trim();

  if (!groupDocId) {
    console.error(
      "Falta groupDocId."
    );

    return null;
  }

  console.log(
    dryRun
      ? "🔎 [SYNC NÓMINA PÚBLICA] SIMULACIÓN"
      : "🛠️ [SYNC NÓMINA PÚBLICA] EJECUCIÓN REAL",
    {
      groupDocId
    }
  );

  /*
    =====================================================
    1. CARGAMOS NÓMINA OFICIAL
    =====================================================
  */

  const oficialSnap =
    await getDocs(
      collection(
        db,
        "ventas_cotizaciones",
        groupDocId,
        "inscripciones"
      )
    );

  const oficialesActivos =
    [];

  for (
    const documentoOficial
    of oficialSnap.docs
  ) {
    const item = {
      id:
        documentoOficial.id,

      ...documentoOficial.data()
    };

    const estadoPrivacidad =
      normalizeSearchLocal(
        item?.privacidad?.estado ||
        ""
      );

    if (
      estadoPrivacidad ===
        "archivada" ||
      estadoPrivacidad ===
        "eliminada_logica"
    ) {
      continue;
    }

    const rutKey =
      normalizarRutKeyGrupo(
        getInscripcionDocumento(
          item
        ) ||
        item.id ||
        ""
      );

    const nombres =
      cleanText(
        getInscripcionNombres(
          item
        )
      );

    const identificacion =
      item.identificacion ||
      {};

    const primerApellido =
      cleanText(
        identificacion.primerApellido ||
        ""
      );

    const segundoApellido =
      cleanText(
        identificacion.segundoApellido ||
        ""
      );

    const apellidosCompletos =
      cleanText(
        getInscripcionApellidos(
          item
        )
      );

    const nombreCompleto =
      [
        nombres,
        primerApellido,
        segundoApellido
      ]
        .filter(Boolean)
        .join(" ")
        .trim() ||
      [
        nombres,
        apellidosCompletos
      ]
        .filter(Boolean)
        .join(" ")
        .trim();

    oficialesActivos.push({
      id:
        item.id,

      item,

      rutKey,

      nombres,

      primerApellido,

      segundoApellido,

      apellidosCompletos,

      nombreCompleto,

      nombreKey:
        normalizeSearchLocal(
          nombreCompleto
        )
    });
  }

  /*
    =====================================================
    2. CARGAMOS NÓMINA PÚBLICA
    =====================================================
  */

  const publicaSnap =
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

  const resultados =
    [];

  let revisados =
    0;

  let nombresDiferentes =
    0;

  let nombresActualizados =
    0;

  let eliminados =
    0;

  let sinCoincidencia =
    0;

  let ambiguos =
    0;

  for (
    const docPub
    of publicaSnap.docs
  ) {
    revisados++;

    const itemPublico = {
      id:
        docPub.id,

      ...docPub.data()
    };

    const payload =
      itemPublico.payload ||
      {};

    const estadoPublico =
      normalizeSearchLocal(
        itemPublico.estado ||
        ""
      );

    const privacidadPublica =
      normalizeSearchLocal(
        payload
          ?.privacidad
          ?.estado ||
        ""
      );

    /*
      Si ya está archivado/eliminado públicamente,
      no tocamos su nombre.
    */
    if (
      estadoPublico ===
        "eliminada_logica" ||
      privacidadPublica ===
        "eliminada_logica" ||
      privacidadPublica ===
        "archivada"
    ) {
      continue;
    }

    const rutPublico =
      normalizarRutKeyGrupo(
        getRutKeyInscripcionPublicaGrupo(
          payload
        ) ||
        itemPublico.id ||
        ""
      );

    const nombrePublico =
      getNombrePublicoInscripcionGrupo(
        payload
      );

    const nombrePublicoKey =
      normalizeSearchLocal(
        nombrePublico
      );

    /*
      ===================================================
      MATCH PRINCIPAL: RUT
      ===================================================
    */
    let candidatos =
      oficialesActivos.filter(
        (oficial) =>
          rutPublico &&
          oficial.rutKey &&
          rutPublico ===
            oficial.rutKey
      );

    /*
      Si el RUT no permitió encontrarlo,
      usamos nombre como respaldo.
    */
    if (
      candidatos.length ===
        0 &&
      nombrePublicoKey
    ) {
      candidatos =
        oficialesActivos.filter(
          (oficial) =>
            oficial.nombreKey ===
            nombrePublicoKey
        );
    }

    /*
      ===================================================
      NO EXISTE EN OFICIAL
      ===================================================
    */
    if (
      candidatos.length ===
      0
    ) {
      sinCoincidencia++;

      resultados.push({
        accion:
          "SIN_COINCIDENCIA",

        idPublico:
          docPub.id,

        rut:
          rutPublico,

        nombrePublico,

        nombreOficial:
          "",

        detalle:
          "No se encontró coincidencia oficial"
      });

      /*
        En dryRun NO se modifica nada.

        En ejecución real conserva el comportamiento
        anterior y marca el registro público como
        eliminado lógico.
      */
      if (!dryRun) {
        await updateDoc(
          doc(
            db,
            "inscripciones_pendientes_publicas",
            docPub.id
          ),
          {
            estado:
              "eliminada_logica",

            "payload.privacidad.estado":
              "eliminada_logica",

            eliminadaPorSyncNomina:
              true,

            eliminadaPorSyncAt:
              serverTimestamp(),

            eliminadaPorSyncGrupo:
              groupDocId
          }
        );

        eliminados++;
      }

      continue;
    }

    /*
      Si aparecen varios candidatos,
      no modificamos nada.
    */
    if (
      candidatos.length >
      1
    ) {
      ambiguos++;

      resultados.push({
        accion:
          "AMBIGUO",

        idPublico:
          docPub.id,

        rut:
          rutPublico,

        nombrePublico,

        nombreOficial:
          candidatos
            .map(
              (x) =>
                x.nombreCompleto
            )
            .join(" | "),

        detalle:
          `${candidatos.length} coincidencias`
      });

      continue;
    }

    const oficial =
      candidatos[0];

    const nombreOficial =
      oficial.nombreCompleto;

    /*
      ===================================================
      MISMO NOMBRE
      ===================================================
    */
    if (
      normalizeSearchLocal(
        nombrePublico
      ) ===
      normalizeSearchLocal(
        nombreOficial
      )
    ) {
      resultados.push({
        accion:
          "OK",

        idPublico:
          docPub.id,

        rut:
          rutPublico,

        nombrePublico,

        nombreOficial,

        detalle:
          "Sin cambios"
      });

      continue;
    }

    /*
      ===================================================
      NOMBRE DIFERENTE
      ===================================================
    */

    nombresDiferentes++;

    resultados.push({
      accion:
        dryRun
          ? "REPARARÍA_NOMBRE"
          : "NOMBRE_REPARADO",

      idPublico:
        docPub.id,

      rut:
        rutPublico,

      nombrePublico,

      nombreOficial,

      detalle:
        "Solo se corrige nombre/apellidos"
    });

    if (dryRun) {
      continue;
    }

    /*
      ===================================================
      ÚNICA REPARACIÓN

      NO TOCAMOS:
      - fecha
      - RUT
      - contacto
      - ficha
      - estados
      - documentos
      - archivos
      ===================================================
    */

    await updateDoc(
      doc(
        db,
        "inscripciones_pendientes_publicas",
        docPub.id
      ),
      {
        "payload.identificacion.nombres":
          oficial.nombres,

        "payload.identificacion.primerApellido":
          oficial.primerApellido,

        "payload.identificacion.segundoApellido":
          oficial.segundoApellido,

        "payload.identificacion.nombreCompleto":
          nombreOficial
      }
    );

    nombresActualizados++;
  }

  const resumen = {
    groupDocId,

    dryRun,

    oficialesActivos:
      oficialesActivos.length,

    publicosRevisados:
      revisados,

    nombresDiferentes,

    nombresActualizados,

    sinCoincidencia,

    ambiguos,

    eliminados
  };

  console.log(
    "🏁 [SYNC NÓMINA PÚBLICA] TERMINADO"
  );

  console.table(
    resultados
  );

  console.table([
    resumen
  ]);

  /*
    IMPORTANTE:
    SIN ALERT().
    Todo el resultado queda en consola.
  */

  return {
    resumen,
    resultados
  };
};

/* =========================================================
   REVISIÓN MASIVA NÓMINAS PÚBLICAS
   GRUPOS GANADOS · AÑO VIAJE 2026

   IMPORTANTE:
   - dryRun:true NO modifica Firebase.
   - Reutiliza sincronizarNominaPublicaConOficial().
========================================================= */

window.sincronizarNominasPublicasGanadas2026 =
async function ({
  dryRun = true
} = {}) {
  console.log(
    dryRun
      ? "🔎 [SYNC MASIVO] SIMULACIÓN · GANADAS 2026"
      : "🛠️ [SYNC MASIVO] EJECUCIÓN REAL · GANADAS 2026"
  );

  /*
    Buscamos exclusivamente:

    estado = "Ganada"
    anoViaje = 2026

    anoViaje es número, NO string.
  */
  const gruposSnap =
    await getDocs(
      query(
        collection(
          db,
          "ventas_cotizaciones"
        ),
        where(
          "estado",
          "==",
          "Ganada"
        ),
        where(
          "anoViaje",
          "==",
          2026
        )
      )
    );

  console.log(
    `📦 Grupos encontrados: ${gruposSnap.docs.length}`
  );

  const resultados =
    [];

  for (
    let index = 0;
    index < gruposSnap.docs.length;
    index += 1
  ) {
    const grupoDoc =
      gruposSnap.docs[index];

    const data =
      grupoDoc.data() ||
      {};

    const nombreGrupo =
      data.aliasGrupo ||
      data.nombreGrupo ||
      data.colegio ||
      grupoDoc.id;

    console.log(
      `\n📋 [${index + 1}/${gruposSnap.docs.length}]`,
      {
        groupDocId:
          grupoDoc.id,

        idGrupo:
          data.idGrupo ||
          "",

        numeroNegocio:
          data.numeroNegocio ||
          "",

        grupo:
          nombreGrupo
      }
    );

    try {
      const resultado =
        await window
          .sincronizarNominaPublicaConOficial(
            grupoDoc.id,
            {
              dryRun
            }
          );

      resultados.push({
        groupDocId:
          grupoDoc.id,

        idGrupo:
          data.idGrupo ||
          "",

        numeroNegocio:
          data.numeroNegocio ||
          "",

        grupo:
          nombreGrupo,

        estado:
          "OK",

        publicosRevisados:
          resultado
            ?.resumen
            ?.publicosRevisados ||
          0,

        nombresDiferentes:
          resultado
            ?.resumen
            ?.nombresDiferentes ||
          0,

        nombresActualizados:
          resultado
            ?.resumen
            ?.nombresActualizados ||
          0,

        sinCoincidencia:
          resultado
            ?.resumen
            ?.sinCoincidencia ||
          0,

        ambiguos:
          resultado
            ?.resumen
            ?.ambiguos ||
          0
      });
    } catch (error) {
      console.error(
        "❌ [SYNC MASIVO] Error en grupo",
        grupoDoc.id,
        error
      );

      resultados.push({
        groupDocId:
          grupoDoc.id,

        idGrupo:
          data.idGrupo ||
          "",

        numeroNegocio:
          data.numeroNegocio ||
          "",

        grupo:
          nombreGrupo,

        estado:
          "ERROR",

        error:
          error?.message ||
          "Error desconocido"
      });
    }
  }

  /*
    =====================================================
    RESUMEN GENERAL
    =====================================================
  */

  const resumenGeneral = {
    gruposRevisados:
      resultados.length,

    gruposConDiferencias:
      resultados.filter(
        (item) =>
          Number(
            item.nombresDiferentes ||
            0
          ) > 0
      ).length,

    totalNombresDiferentes:
      resultados.reduce(
        (total, item) =>
          total +
          Number(
            item.nombresDiferentes ||
            0
          ),
        0
      ),

    totalNombresActualizados:
      resultados.reduce(
        (total, item) =>
          total +
          Number(
            item.nombresActualizados ||
            0
          ),
        0
      ),

    totalSinCoincidencia:
      resultados.reduce(
        (total, item) =>
          total +
          Number(
            item.sinCoincidencia ||
            0
          ),
        0
      ),

    totalAmbiguos:
      resultados.reduce(
        (total, item) =>
          total +
          Number(
            item.ambiguos ||
            0
          ),
        0
      ),

    errores:
      resultados.filter(
        (item) =>
          item.estado ===
          "ERROR"
      ).length
  };

  console.log(
    "\n🏁 [SYNC MASIVO 2026] PROCESO TERMINADO"
  );

  console.log(
    "\n📋 RESULTADO POR GRUPO"
  );

  console.table(
    resultados
  );

  console.log(
    "\n📊 RESUMEN GENERAL"
  );

  console.table([
    resumenGeneral
  ]);

  if (dryRun) {
    console.warn(
      "⚠️ SIMULACIÓN: NO SE MODIFICÓ FIREBASE."
    );
  } else {
    console.warn(
      "✅ EJECUCIÓN REAL: se aplicaron las reparaciones detectadas."
    );
  }

  return {
    resumen:
      resumenGeneral,

    grupos:
      resultados
  };
};

function normalizarRutKeyGrupo(value = "") {
  return String(value || "")
    .toUpperCase()
    .trim()

    /*
      Compatibilidad con IDs/documentos públicos:
      RUT_23008922-1
      RUT-23008922-1
      RUT 23008922-1
    */
    .replace(/^RUT[_\-\s]*/i, "")

    /*
      Dejamos solamente cuerpo + DV.
    */
    .replace(/\./g, "")
    .replace(/-/g, "")
    .replace(/\s+/g, "")
    .trim();
}

function getRutKeyInscripcionPublicaGrupo(item = {}) {
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

  return normalizarRutKeyGrupo(documento);
}

function getNombrePublicoInscripcionGrupo(item = {}) {
  const identificacion = item.identificacion || {};

  return cleanText([
    identificacion.nombres || item.nombres,
    identificacion.primerApellido || item.primerApellido,
    identificacion.segundoApellido || item.segundoApellido
  ].filter(Boolean).join(" ") ||
    identificacion.nombreCompleto ||
    item.nombreCompleto ||
    item.nombre ||
    item.pasajero ||
    ""
  );
}

async function marcarInscripcionPublicaComoEliminada(inscripcionOficial = {}) {
  const rutKey = normalizarRutKeyGrupo(
    getInscripcionDocumento(inscripcionOficial) || inscripcionOficial.id || ""
  );

  const nombreKey = normalizeSearchLocal(
    `${getInscripcionNombres(inscripcionOficial)} ${getInscripcionApellidos(inscripcionOficial)}`
  );

  const publicaSnap = await getDocs(
    query(
      collection(db, "inscripciones_pendientes_publicas"),
      where("idGrupo", "==", String(state.groupDocId))
    )
  );

  for (const docPub of publicaSnap.docs) {
    const itemPub = { id: docPub.id, ...docPub.data() };
    const payload = itemPub.payload || {};

    const rutPub = normalizarRutKeyGrupo(
      getRutKeyInscripcionPublicaGrupo(payload) || itemPub.id || ""
    );

    const nombrePub = normalizeSearchLocal(
      getNombrePublicoInscripcionGrupo(payload)
    );

    const coincide =
      (rutKey && rutPub && rutKey === rutPub) ||
      (nombreKey && nombrePub && nombreKey === nombrePub);

    if (!coincide) continue;

    await updateDoc(doc(db, "inscripciones_pendientes_publicas", docPub.id), {
      estado: "eliminada_logica",
      "payload.privacidad.estado": "eliminada_logica",
      eliminadaPorSyncNomina: true,
      eliminadaPorSyncAt: serverTimestamp(),
      eliminadaPorSyncGrupo: String(state.groupDocId || ""),
      eliminadaPorSyncInscripcionId: String(inscripcionOficial.id || "")
    });

    console.log("[sync pública] marcada eliminada:", {
      idPublico: docPub.id,
      nombre: getNombrePublicoInscripcionGrupo(payload),
      rutPub
    });
  }
}

async function sincronizarInscripcionPublicaPostEdicion(inscripcionOficial = {}) {
  const estadoPrivacidad = normalizeSearchLocal(inscripcionOficial?.privacidad?.estado || "");

  if (estadoPrivacidad === "archivada" || estadoPrivacidad === "eliminada_logica") {
    await marcarInscripcionPublicaComoEliminada(inscripcionOficial);
  }
}

window.buscarCorreosEnInscripciones = async function (correos = []) {
  const buscados = new Set(
    (Array.isArray(correos) ? correos : String(correos).split(/[,\n;]/))
      .map(c => normalizeEmail(c))
      .filter(Boolean)
  );

  const resultados = [];
  const gruposSnap = await getDocs(collection(db, "ventas_cotizaciones"));

  let revisados = 0;

  for (const grupoDoc of gruposSnap.docs) {
    revisados++;

    const grupo = grupoDoc.data() || {};
    const numeroNegocio = grupo.numeroNegocio || grupo.ficha?.numeroNegocio || "";
    const nombreGrupo = grupo.nombreGrupo || grupo.aliasGrupo || grupo.colegio || "";

    console.log(`🔎 ${revisados}/${gruposSnap.size} revisando ${numeroNegocio || grupoDoc.id} · ${nombreGrupo}`);

    const inscSnap = await getDocs(
      collection(db, "ventas_cotizaciones", grupoDoc.id, "inscripciones")
    );

    for (const inscDoc of inscSnap.docs) {
      const p = inscDoc.data() || {};

      const correosPersona = [
        p.contactoPrincipal?.correo,
        p.contactoPrincipal?.email,
        p.contactoSecundario?.correo,
        p.contactoSecundario?.email,
        p.identificacion?.correoViajante,
        p.identificacion?.correoPersonaQueViaja,
        p.correo,
        p.email
      ].map(normalizeEmail).filter(Boolean);

      const match = correosPersona.find(c => buscados.has(c));
      if (!match) continue;

      const item = {
        correoBuscado: match,
        pasajero: p.identificacion?.nombreCompleto || [
          p.identificacion?.nombres,
          p.identificacion?.primerApellido,
          p.identificacion?.segundoApellido
        ].filter(Boolean).join(" "),
        rut: p.identificacion?.rut || p.identificacion?.documento || inscDoc.id,
        responsable1: p.contactoPrincipal?.nombre || "",
        responsable2: p.contactoSecundario?.nombre || "",
        tipoInscripcion: p.tipoInscripcion || "",
        tipoViajante: p.tipoViajante || "",
        numeroNegocio,
        grupo: nombreGrupo,
        colegio: grupo.colegio || "",
        curso: grupo.curso || "",
        anoViaje: grupo.anoViaje || "",
        grupoDocId: grupoDoc.id,
        inscripcionDocId: inscDoc.id
      };

      resultados.push(item);
      console.log("✅ ENCONTRADO:", item);
    }
  }

  console.log(`✅ Búsqueda terminada. Coincidencias: ${resultados.length}`);
  console.table(resultados);
  return resultados;
};

window.repararIdentificacionInscripcion11190 = async function repararIdentificacionInscripcion11190() {
  const idGrupo = "11190";
  const inscripcionId = "RUT_23739403-8";

  const ref = doc(
    db,
    "ventas_cotizaciones",
    idGrupo,
    "inscripciones",
    inscripcionId
  );

  await updateDoc(ref, {
    "identificacion.documento": "23739403-8",
    "identificacion.documentoNormalizado": "RUT_23739403-8",
    "identificacion.rut": "23739403-8",
    "identificacion.rutNumero": "23739403",
    "identificacion.rutDv": "8",

    "identificacion.nombres": "Eleana Carolina",
    "identificacion.primerApellido": "Fuentes",
    "identificacion.segundoApellido": "Melgarejo",
    "identificacion.nombreCompleto": "Eleana Carolina Fuentes Melgarejo",

    "identificacion.fechaNacimiento": "2011-09-08",
    "identificacion.nacionalidadBase": "chilena",
    "identificacion.nacionalidadDetalle": "",
    "identificacion.tipoIdentificacion": "rut",
    "identificacion.tallaPolera": "M",

    actualizadoPor: "Reparación consola",
    actualizadoAt: new Date()
  });

  console.log("✅ Identificación reparada:", inscripcionId);
}

window.repararAlertasInscripcionesGrupo = async function () {
  if (!state.canSeeAll) {
    alert("Solo Admin/Supervisión puede reparar alertas de inscripciones.");
    return;
  }

  let corregidas = 0;
  let alertasSync = 0;

  for (const item of state.inscripciones) {
    const tipo = normalizeSearchLocal(getInscripcionTipoReal(item));
    const estadoCupo = normalizeSearchLocal(item.estadoCupo || "");

    const patch = {};

    if (tipo === "nuevo_ingreso" && !estadoCupo) {
      patch.estadoCupo = "pendiente_confirmacion";
    }

    if (tipo === "lista_espera" && !estadoCupo) {
      patch.estadoCupo = "pendiente_pago";
    }

    if (Object.keys(patch).length) {
      const ref = doc(
        db,
        "ventas_cotizaciones",
        String(state.groupDocId),
        "inscripciones",
        String(item.id)
      );

      await updateDoc(ref, patch);
      corregidas++;
    }

    await sincronizarAlertaInscripcion({
      ...item,
      ...patch
    });

    alertasSync++;
  }

  await loadInscripciones();
  renderInscripcionPasajerosPanel();
  syncButtons();

  console.log("Reparación alertas inscripciones finalizada", {
    grupo: state.groupId,
    corregidas,
    alertasSync
  });

  return {
    grupo: state.groupId,
    corregidas,
    alertasSync
  };
};

window.marcarNuevoIngresoPendiente = async function ({ rut = "", inscripcionId = "" } = {}) {
  if (!canEditarNominaInscripcion()) {
    alert("No tienes permisos para modificar esta inscripción.");
    return null;
  }

  const rutBuscado = normalizeSearchLocal(rut || "")
    .replace(/\./g, "")
    .replace(/-/g, "");

  const item = state.inscripciones.find((x) => {
    if (inscripcionId && String(x.id) === String(inscripcionId)) return true;

    const docu = normalizeSearchLocal(getInscripcionDocumento(x))
      .replace(/\./g, "")
      .replace(/-/g, "");

    return rutBuscado && docu === rutBuscado;
  });

  if (!item) {
    console.warn("No encontré la inscripción.");
    return null;
  }

  const ref = doc(
    db,
    "ventas_cotizaciones",
    String(state.groupDocId),
    "inscripciones",
    String(item.id)
  );

  await updateDoc(ref, {
    tipoInscripcion: "nuevo_ingreso",
    estadoCupo: "pendiente_confirmacion",

    nuevoIngresoConfirmado: false,
    nuevoIngresoConfirmadoPor: deleteField(),
    nuevoIngresoConfirmadoPorCorreo: deleteField(),
    nuevoIngresoConfirmadoAt: deleteField(),

    corregidoComoNuevoIngresoPendiente: true,
    corregidoComoNuevoIngresoPendienteAt: serverTimestamp(),
    corregidoComoNuevoIngresoPendientePor: getDisplayName(state.effectiveUser),
    corregidoComoNuevoIngresoPendientePorCorreo: state.effectiveEmail
  });

  await sincronizarAlertaInscripcion({
    ...item,
    tipoInscripcion: "nuevo_ingreso",
    estadoCupo: "pendiente_confirmacion"
  });

  await createHistoryEntry({
    tipoMovimiento: "correccion_nuevo_ingreso_pendiente",
    modulo: "inscripcion",
    titulo: "Nuevo ingreso corregido a pendiente",
    mensaje: `${getDisplayName(state.effectiveUser)} corrigió a ${buildNombreCompletoInscripcion(item) || "una inscripción"} como Nuevo ingreso pendiente.`,
    metadata: {
      inscripcionId: item.id,
      documento: getInscripcionDocumento(item),
      nombreCompleto: buildNombreCompletoInscripcion(item)
    }
  });

  await loadInscripciones();
  renderInscripcionPasajerosPanel();
  syncButtons();

  console.log("Nuevo ingreso corregido a pendiente:", {
    grupo: state.groupId,
    inscripcionId: item.id,
    documento: getInscripcionDocumento(item)
  });

  return item.id;
};

window.catastroConsentimientos2026 = async function () {
  console.log(
    "🔎 Buscando grupos GANADOS 2026..."
  );

  const gruposSnap =
    await getDocs(
      query(
        collection(
          db,
          "ventas_cotizaciones"
        ),
        where(
          "anoViaje",
          "==",
          2026
        )
      )
    );

  const grupos =
    gruposSnap.docs
      .map((d) => ({
        docId: d.id,
        ...d.data()
      }))
      .filter((grupo) => {
        return (
          normalizeSearchLocal(
            grupo.estado || ""
          ) === "ganada"
        );
      })
      .sort((a, b) => {
        return Number(
          a.numeroNegocio || 0
        ) -
        Number(
          b.numeroNegocio || 0
        );
      });

  console.log(
    `✅ Grupos ganados 2026 encontrados: ${grupos.length}`
  );

  const resumen =
    [];

  const detalleSi =
    [];

  const detalleNo =
    [];

  const detalleSinRespuesta =
    [];

  let totalInscripciones =
    0;

  let totalActivos =
    0;

  let totalRespondieron =
    0;

  let totalSi =
    0;

  let totalNo =
    0;

  let totalSinRespuesta =
    0;

  for (
    let i = 0;
    i < grupos.length;
    i += 1
  ) {
    const grupo =
      grupos[i];

    const numeroNegocio =
      String(
        grupo.numeroNegocio ||
        ""
      ).trim();

    console.log(
      `📋 ${i + 1}/${grupos.length} · Negocio ${numeroNegocio || "SIN N°"}`
    );

    const inscripcionesSnap =
      await getDocs(
        collection(
          db,
          "ventas_cotizaciones",
          grupo.docId,
          "inscripciones"
        )
      );

    const inscripciones =
      inscripcionesSnap.docs
        .map((d) => ({
          id: d.id,
          ...d.data()
        }));

    totalInscripciones +=
      inscripciones.length;

    const activos =
      inscripciones.filter(
        (item) =>
          !estaInscripcionAnulada(
            item
          )
      );

    totalActivos +=
      activos.length;

    let si =
      0;

    let no =
      0;

    let sinRespuesta =
      0;

    activos.forEach(
      (item) => {
        const respuesta =
          item?.consentimiento
            ?.autorizaApoderadoCoordinador;

        const nombre =
          buildNombreCompletoInscripcion(
            item
          ) ||
          item?.identificacion
            ?.nombreCompleto ||
          "SIN NOMBRE";

        const documento =
          getInscripcionDocumento(
            item
          ) ||
          item?.identificacion
            ?.documento ||
          item.id;

        const base = {
          numeroNegocio,
          idGrupo:
            grupo.idGrupo ||
            grupo.docId,

          colegio:
            grupo.colegio ||
            "",

          curso:
            grupo.curso ||
            "",

          nombre,

          documento,

          tipoInscripcion:
            item.tipoInscripcion ||
            "",

          fichaMedica:
            item.fichaMedicaEstado ||
            (
              item.fichaMedicaCompleta ===
              true
                ? "completa"
                : ""
            )
        };

        if (
          respuesta === true
        ) {
          si += 1;
          totalSi += 1;
          totalRespondieron += 1;

          detalleSi.push({
            ...base,
            respuesta: "SÍ"
          });

          return;
        }

        if (
          respuesta === false
        ) {
          no += 1;
          totalNo += 1;
          totalRespondieron += 1;

          detalleNo.push({
            ...base,
            respuesta: "NO"
          });

          return;
        }

        sinRespuesta += 1;
        totalSinRespuesta += 1;

        detalleSinRespuesta.push({
          ...base,
          respuesta:
            "SIN RESPUESTA"
        });
      }
    );

    resumen.push({
      numeroNegocio,

      idGrupo:
        grupo.idGrupo ||
        grupo.docId,

      colegio:
        grupo.colegio ||
        "",

      curso:
        grupo.curso ||
        "",

      activos:
        activos.length,

      respondieron:
        si + no,

      si,

      no,

      sinRespuesta
    });
  }

  console.log(
    "======================================"
  );

  console.log(
    "📊 RESUMEN CONSENTIMIENTOS 2026"
  );

  console.log(
    "======================================"
  );

  console.table(
    resumen
  );

  console.log(
    "📌 TOTALES GENERALES",
    {
      gruposGanados:
        grupos.length,

      documentosInscripcion:
        totalInscripciones,

      pasajerosActivos:
        totalActivos,

      respondieron:
        totalRespondieron,

      si:
        totalSi,

      no:
        totalNo,

      sinRespuesta:
        totalSinRespuesta
    }
  );

  console.log(
    `✅ SÍ AUTORIZAN (${detalleSi.length})`
  );

  console.table(
    detalleSi
  );

  console.log(
    `🚨 NO AUTORIZAN (${detalleNo.length})`
  );

  console.table(
    detalleNo
  );

  console.log(
    `⚪ SIN RESPUESTA (${detalleSinRespuesta.length})`
  );

  console.table(
    detalleSinRespuesta
  );

  console.log(
    "======================================"
  );

  console.log(
    "🚨 PERSONAS QUE RESPONDIERON NO"
  );

  console.log(
    "======================================"
  );

  detalleNo.forEach(
    (item) => {
      console.log(
        `Negocio ${item.numeroNegocio} · ${item.nombre} · ${item.documento}`
      );
    }
  );

  const resultado = {
    totales: {
      gruposGanados:
        grupos.length,

      totalInscripciones,

      totalActivos,

      respondieron:
        totalRespondieron,

      si:
        totalSi,

      no:
        totalNo,

      sinRespuesta:
        totalSinRespuesta
    },

    resumenPorGrupo:
      resumen,

    si:
      detalleSi,

    no:
      detalleNo,

    sinRespuesta:
      detalleSinRespuesta
  };

  window.__catastroConsentimientos2026 =
    resultado;

  console.log(
    "✅ Resultado completo guardado en:"
  );

  console.log(
    "window.__catastroConsentimientos2026"
  );

  return resultado;
};

window.catastroTallasPolera2026 = async function () {
  console.log(
    "👕 Buscando tallas de grupos GANADOS 2026..."
  );

  const gruposSnap =
    await getDocs(
      query(
        collection(
          db,
          "ventas_cotizaciones"
        ),
        where(
          "anoViaje",
          "==",
          2026
        )
      )
    );

  const grupos =
    gruposSnap.docs
      .map((d) => ({
        docId: d.id,
        ...d.data()
      }))
      .filter((grupo) => {
        return (
          normalizeSearchLocal(
            grupo.estado || ""
          ) === "ganada"
        );
      })
      .sort((a, b) => {
        return Number(
          a.numeroNegocio || 0
        ) -
        Number(
          b.numeroNegocio || 0
        );
      });

  const resumenGrupo = [];
  const detalle = [];
  const gruposConError = [];

  const totalPorTalla = {};

  let totalActivos = 0;
  let totalConTalla = 0;
  let totalSinTalla = 0;

  for (
    let i = 0;
    i < grupos.length;
    i += 1
  ) {
    const grupo = grupos[i];

    const numeroNegocio =
      String(
        grupo.numeroNegocio ||
        ""
      ).trim();

    console.log(
      `👕 ${i + 1}/${grupos.length} · Negocio ${numeroNegocio || "SIN N°"}`
    );

    const incluyePolera =
      grupo?.elementosIncluidos
        ?.polera !== false;

    try {
      const snap =
        await getDocs(
          collection(
            db,
            "ventas_cotizaciones",
            grupo.docId,
            "inscripciones"
          )
        );

      const activos =
        snap.docs
          .map((d) => ({
            id: d.id,
            ...d.data()
          }))
          .filter(
            (item) =>
              !estaInscripcionAnulada(
                item
              )
          );

      totalActivos +=
        activos.length;

      const tallasGrupo = {};

      let conTalla = 0;
      let sinTalla = 0;

      activos.forEach(
        (item) => {
          const tallaRaw =
            item?.identificacion
              ?.tallaPolera ||
            item?.elementos
              ?.tallaPolera ||
            item?.tallaPolera ||
            item?.talla ||
            "";

          const talla =
            String(
              tallaRaw ||
              ""
            )
              .trim()
              .toUpperCase();

          const nombre =
            buildNombreCompletoInscripcion(
              item
            ) ||
            item?.identificacion
              ?.nombreCompleto ||
            "SIN NOMBRE";

          const documento =
            getInscripcionDocumento(
              item
            ) ||
            item?.identificacion
              ?.documento ||
            item.id;

          if (talla) {
            conTalla += 1;
            totalConTalla += 1;

            tallasGrupo[talla] =
              (
                tallasGrupo[talla] ||
                0
              ) + 1;

            totalPorTalla[talla] =
              (
                totalPorTalla[talla] ||
                0
              ) + 1;
          } else {
            sinTalla += 1;
            totalSinTalla += 1;
          }

          detalle.push({
            numeroNegocio,

            idGrupo:
              grupo.idGrupo ||
              grupo.docId,

            colegio:
              grupo.colegio ||
              "",

            curso:
              grupo.curso ||
              "",

            incluyePolera:
              incluyePolera
                ? "SÍ"
                : "NO",

            nombre,

            documento,

            talla:
              talla ||
              "SIN TALLA"
          });
        }
      );

      resumenGrupo.push({
        numeroNegocio,

        idGrupo:
          grupo.idGrupo ||
          grupo.docId,

        colegio:
          grupo.colegio ||
          "",

        curso:
          grupo.curso ||
          "",

        incluyePolera:
          incluyePolera
            ? "SÍ"
            : "NO",

        pasajerosActivos:
          activos.length,

        conTalla,

        sinTalla,

        XS:
          tallasGrupo.XS ||
          0,

        S:
          tallasGrupo.S ||
          0,

        M:
          tallasGrupo.M ||
          0,

        L:
          tallasGrupo.L ||
          0,

        XL:
          tallasGrupo.XL ||
          0,

        XXL:
          tallasGrupo.XXL ||
          0,

        otras:
          Object.entries(
            tallasGrupo
          )
            .filter(
              ([talla]) =>
                ![
                  "XS",
                  "S",
                  "M",
                  "L",
                  "XL",
                  "XXL"
                ].includes(
                  talla
                )
            )
            .reduce(
              (
                suma,
                [, cantidad]
              ) =>
                suma +
                Number(
                  cantidad ||
                  0
                ),
              0
            )
      });
    } catch (error) {
      console.error(
        `❌ Error procesando negocio ${numeroNegocio || grupo.docId}:`,
        error
      );

      gruposConError.push({
        numeroNegocio:
          numeroNegocio ||
          "",

        idGrupo:
          grupo.idGrupo ||
          grupo.docId,

        colegio:
          grupo.colegio ||
          "",

        curso:
          grupo.curso ||
          "",

        error:
          error?.message ||
          String(error)
      });

      resumenGrupo.push({
        numeroNegocio,

        idGrupo:
          grupo.idGrupo ||
          grupo.docId,

        colegio:
          grupo.colegio ||
          "",

        curso:
          grupo.curso ||
          "",

        incluyePolera:
          incluyePolera
            ? "SÍ"
            : "NO",

        pasajerosActivos:
          "ERROR",

        conTalla:
          "ERROR",

        sinTalla:
          "ERROR",

        XS: 0,
        S: 0,
        M: 0,
        L: 0,
        XL: 0,
        XXL: 0,
        otras: 0
      });

      continue;
    }
  }

  console.log(
    "======================================"
  );

  console.log(
    "👕 RESUMEN TALLAS POR GRUPO"
  );

  console.log(
    "======================================"
  );

  console.table(
    resumenGrupo
  );

  console.log(
    "======================================"
  );

  console.log(
    "👕 TOTAL GENERAL POR TALLA"
  );

  console.log(
    "======================================"
  );

  const tablaTotalTallas =
    Object.entries(
      totalPorTalla
    )
      .map(
        ([talla, cantidad]) => ({
          talla,
          cantidad
        })
      )
      .sort(
        (a, b) =>
          b.cantidad -
          a.cantidad
      );

  console.table(
    tablaTotalTallas
  );

  const sinTalla =
    detalle.filter(
      (item) =>
        item.talla ===
        "SIN TALLA"
    );

  console.log(
    "======================================"
  );

  console.log(
    "👤 DETALLE DE PERSONAS Y TALLAS"
  );

  console.log(
    "======================================"
  );

  console.table(
    detalle
  );

  console.log(
    `⚠️ PERSONAS SIN TALLA (${sinTalla.length})`
  );

  console.table(
    sinTalla
  );

  if (
    gruposConError.length >
    0
  ) {
    console.log(
      "======================================"
    );

    console.log(
      `❌ GRUPOS CON ERROR (${gruposConError.length})`
    );

    console.log(
      "======================================"
    );

    console.table(
      gruposConError
    );
  }

  /*
    =====================================================
    RESUMEN FINAL COMPACTO
    =====================================================
  */

  const formatoNumero = (
    valor
  ) =>
    Number(
      valor ||
      0
    ).toLocaleString(
      "es-CL"
    );

  const tallasPrincipales = [
    "XS",
    "S",
    "M",
    "L",
    "XL",
    "XXL"
  ];

  const totalOtrasTallas =
    Object.entries(
      totalPorTalla
    )
      .filter(
        ([talla]) =>
          !tallasPrincipales.includes(
            talla
          )
      )
      .reduce(
        (
          suma,
          [, cantidad]
        ) =>
          suma +
          Number(
            cantidad ||
            0
          ),
        0
      );

  console.log("");
  console.log(
    "======================================"
  );
  console.log(
    "👕 RESUMEN FINAL POLERAS 2026"
  );
  console.log(
    "======================================"
  );

  console.log(
    `GRUPOS GANADOS: ${formatoNumero(grupos.length)}`
  );

  console.log(
    `PASAJEROS ACTIVOS: ${formatoNumero(totalActivos)}`
  );

  console.log(
    `TOTAL CON TALLA: ${formatoNumero(totalConTalla)}`
  );

  console.log("");

  tallasPrincipales.forEach(
    (talla) => {
      console.log(
        `${talla}: ${formatoNumero(
          totalPorTalla[talla] ||
          0
        )}`
      );
    }
  );

  if (
    totalOtrasTallas >
    0
  ) {
    console.log(
      `OTRAS TALLAS: ${formatoNumero(totalOtrasTallas)}`
    );
  }

  console.log("");

  console.log(
    `⚠️ SIN TALLA: ${formatoNumero(totalSinTalla)}`
  );

  console.log(
    `❌ GRUPOS CON ERROR: ${formatoNumero(gruposConError.length)}`
  );

  console.log(
    "======================================"
  );

  const resultado = {
    totales: {
      gruposGanados:
        grupos.length,

      pasajerosActivos:
        totalActivos,

      conTalla:
        totalConTalla,

      sinTalla:
        totalSinTalla,

      porTalla:
        totalPorTalla,

      otrasTallas:
        totalOtrasTallas,

      gruposConError:
        gruposConError.length
    },

    resumenPorGrupo:
      resumenGrupo,

    detalle,

    sinTalla,

    gruposConError
  };

  window.__catastroTallasPolera2026 =
    resultado;

  console.log(
    "✅ Resultado completo guardado en:"
  );

  console.log(
    "window.__catastroTallasPolera2026"
  );

  return resultado;
};

/* =========================================================
   MIGRACIÓN MANUAL PASAJEROS ENTRE GRUPOS

   CASO ESPECIAL:
   11053 -> 11184

   OBJETIVO:
   - Migrar exactamente las 11 personas indicadas.
   - Leer inscripciones oficiales del 11053.
   - Si falta alguien, buscar respaldo archivado.
   - Si sigue faltando, recuperar desde
     inscripciones_pendientes_publicas.
   - Caso confirmado:
     THIAGO AGUSTIN LEON ACUÑA
     RUT 23639272-4
     está en pública como eliminada_logica.
   - Crear/copiar inscripción completa en 11184.
   - Dejar activas las inscripciones en destino.
   - Archivar las originales que todavía existan en 11053.
   - Reactivar y reasignar los registros públicos.
   - NO sobreescribir si alguien ya existe en destino.
   - dryRun=true por defecto.
========================================================= */

window.migrarPasajeros11053a11184 = async function ({
  dryRun = true,
  confirmar = false
} = {}) {

  const GRUPO_ORIGEN = "11053";
  const GRUPO_DESTINO = "11184";

  /*
    =====================================================
    0. PASAJEROS OBJETIVO

    Thiago incluye:
    - nombre correcto: ACUÑA
    - variante usada anteriormente: ACAUNA
    - RUT confirmado desde inscripción pública
    =====================================================
  */

  const OBJETIVOS = [
    {
      nombre: "THIAGO AGUSTIN LEON ACUNA",
      aliases: [
        "THIAGO AGUSTIN LEON ACAUNA"
      ],
      rut: "23639272-4"
    },
    {
      nombre: "MATIAS ALEJANDR HEYSER HUILIPAN"
    },
    {
      nombre: "CRISTOBAL MATUS JOFRE"
    },
    {
      nombre: "LISSETTE GRACIELA ACUNA GALAZ"
    },
    {
      nombre: "VALENTIN ALONSO DIAZ MORAGREGA"
    },
    {
      nombre: "MATEO ALBERTO GARRIDO ALIAGA"
    },
    {
      nombre: "NANCY LYHA ALIAGA AGUERO"
    },
    {
      nombre: "LUIS ALBERTO GARRIDO FLORES"
    },
    {
      nombre: "MONSERRAT BELEN AGURTO ACEVEDO"
    },
    {
      nombre: "VICENTE AGUSTIN SOLAR SASSI"
    },
    {
      nombre: "AMANDA ISIDORA NUNEZ BECAR"
    }
  ].map((obj) => ({
    ...obj,

    nombreKey:
      normalizeSearchLocal(
        obj.nombre
      ),

    aliasKeys:
      [
        obj.nombre,
        ...(obj.aliases || [])
      ].map(
        normalizeSearchLocal
      ),

    rutKey:
      obj.rut
        ? normalizarRutKeyGrupo(
            obj.rut
          )
        : ""
  }));

  /*
    =====================================================
    HELPERS LOCALES
    =====================================================
  */

  function getNombreMigracion(
    item = {}
  ) {
    return cleanText(
      `${getInscripcionNombres(item)} ${getInscripcionApellidos(item)}`
    );
  }

  function getNombreKeyMigracion(
    item = {}
  ) {
    return normalizeSearchLocal(
      getNombreMigracion(item)
    );
  }

  function getRutMigracion(
    item = {}
  ) {
    return normalizarRutKeyGrupo(
      getInscripcionDocumento(item) ||
      item.id ||
      ""
    );
  }

  function encontrarObjetivoPorItem(
    item = {}
  ) {
    const nombreKey =
      getNombreKeyMigracion(item);

    const rutKey =
      getRutMigracion(item);

    return OBJETIVOS.find(
      (objetivo) => {

        if (
          objetivo.rutKey &&
          rutKey &&
          objetivo.rutKey === rutKey
        ) {
          return true;
        }

        return objetivo.aliasKeys.includes(
          nombreKey
        );
      }
    ) || null;
  }

  function getObjetivoKey(
    objetivo
  ) {
    return objetivo.rutKey
      ? `RUT:${objetivo.rutKey}`
      : `NOMBRE:${objetivo.nombreKey}`;
  }

  function getItemObjetivoKey(
    item = {}
  ) {
    const objetivo =
      encontrarObjetivoPorItem(
        item
      );

    return objetivo
      ? getObjetivoKey(objetivo)
      : "";
  }

  function quitarCamposSoloJs(
    item = {}
  ) {
    const {
      id: _idSoloJs,
      esResumenNomina: _esResumenSoloJs,

      _origenMigracion: _origenMigracion,
      _archivoIdMigracion: _archivoId,
      _publicaDocIdMigracion: _publicaId,
      _publicaEstadoOriginal: _publicaEstado,

      ...resto
    } = item;

    return resto;
  }

  console.log(
    "===================================================="
  );

  console.log(
    dryRun
      ? "🔎 SIMULACIÓN MIGRACIÓN 11053 → 11184"
      : "🚚 MIGRACIÓN REAL 11053 → 11184"
  );

  console.log(
    "===================================================="
  );

  /*
    =====================================================
    1. RESOLVER GRUPOS
    =====================================================
  */

  const origen =
    await resolveGroupByParam(
      GRUPO_ORIGEN
    );

  const destino =
    await resolveGroupByParam(
      GRUPO_DESTINO
    );

  if (!origen) {
    console.error(
      `❌ No encontré el grupo origen ${GRUPO_ORIGEN}.`
    );

    return null;
  }

  if (!destino) {
    console.error(
      `❌ No encontré el grupo destino ${GRUPO_DESTINO}.`
    );

    return null;
  }

  if (
    String(origen.docId) ===
    String(destino.docId)
  ) {
    console.error(
      "❌ Origen y destino son el mismo documento."
    );

    return null;
  }

  console.log(
    "Grupo origen:",
    {
      solicitado:
        GRUPO_ORIGEN,

      docId:
        origen.docId,

      idGrupo:
        origen.groupId,

      nombre:
        origen.data?.aliasGrupo ||
        origen.data?.nombreGrupo ||
        origen.data?.colegio ||
        ""
    }
  );

  console.log(
    "Grupo destino:",
    {
      solicitado:
        GRUPO_DESTINO,

      docId:
        destino.docId,

      idGrupo:
        destino.groupId,

      nombre:
        destino.data?.aliasGrupo ||
        destino.data?.nombreGrupo ||
        destino.data?.colegio ||
        ""
    }
  );

  /*
    =====================================================
    2. LEER INSCRIPCIONES OFICIALES ORIGEN
    =====================================================
  */

  const origenSnap =
    await getDocs(
      collection(
        db,
        "ventas_cotizaciones",
        String(origen.docId),
        "inscripciones"
      )
    );

  const todasOrigen =
    origenSnap.docs.map(
      (d) => ({
        id:
          d.id,

        ...d.data(),

        _origenMigracion:
          "inscripciones"
      })
    );

  /*
    Solamente conservamos personas objetivo.
  */

  let encontrados =
    todasOrigen.filter(
      (item) =>
        !!encontrarObjetivoPorItem(
          item
        )
    );

  /*
    =====================================================
    3. DETERMINAR FALTANTES
    =====================================================
  */

  function obtenerObjetivosFaltantes() {

    const presentes =
      new Set(
        encontrados
          .map(
            getItemObjetivoKey
          )
          .filter(Boolean)
      );

    return OBJETIVOS.filter(
      (objetivo) =>
        !presentes.has(
          getObjetivoKey(
            objetivo
          )
        )
    );
  }

  let faltantesObjetivos =
    obtenerObjetivosFaltantes();

  /*
    =====================================================
    4. BUSCAR FALTANTES EN INSCRIPCIONES_ARCHIVADAS
    =====================================================
  */

  if (
    faltantesObjetivos.length
  ) {

    console.warn(
      "⚠️ Faltan pasajeros en inscripciones. Buscando en inscripciones_archivadas...",
      faltantesObjetivos.map(
        (x) => x.nombre
      )
    );

    const archivadasSnap =
      await getDocs(
        collection(
          db,
          "ventas_cotizaciones",
          String(origen.docId),
          "inscripciones_archivadas"
        )
      );

    const recuperadosArchivo =
      [];

    archivadasSnap.docs.forEach(
      (archivoDoc) => {

        const archivo =
          archivoDoc.data() ||
          {};

        const registros =
          Array.isArray(
            archivo.inscripciones
          )
            ? archivo.inscripciones
            : [];

        registros.forEach(
          (registro) => {

            const data =
              registro?.data ||
              {};

            /*
              Reconstruimos objeto temporal para poder
              usar las mismas funciones de identificación.
            */

            const item = {
              ...data,

              id:
                registro.id ||
                data.id ||
                "",

              _origenMigracion:
                "inscripciones_archivadas",

              _archivoIdMigracion:
                archivoDoc.id
            };

            const objetivo =
              encontrarObjetivoPorItem(
                item
              );

            if (!objetivo) {
              return;
            }

            const faltaba =
              faltantesObjetivos.some(
                (x) =>
                  getObjetivoKey(x) ===
                  getObjetivoKey(objetivo)
              );

            if (!faltaba) {
              return;
            }

            const yaRecuperado =
              recuperadosArchivo.some(
                (x) =>
                  getItemObjetivoKey(x) ===
                  getObjetivoKey(objetivo)
              );

            if (yaRecuperado) {
              return;
            }

            if (!item.id) {
              console.error(
                "❌ Respaldo archivado sin ID.",
                {
                  archivoId:
                    archivoDoc.id,

                  objetivo:
                    objetivo.nombre
                }
              );

              return;
            }

            recuperadosArchivo.push(
              item
            );
          }
        );
      }
    );

    if (
      recuperadosArchivo.length
    ) {

      console.log(
        "♻️ Recuperados desde archivo:"
      );

      console.table(
        recuperadosArchivo.map(
          (item) => ({
            id:
              item.id,

            documento:
              getInscripcionDocumento(
                item
              ),

            nombre:
              getNombreMigracion(
                item
              ),

            archivo:
              item._archivoIdMigracion
          })
        )
      );

      encontrados = [
        ...encontrados,
        ...recuperadosArchivo
      ];
    }
  }

  /*
    Recalcular después de archivos.
  */

  faltantesObjetivos =
    obtenerObjetivosFaltantes();

  /*
    =====================================================
    5. BUSCAR FALTANTES EN INSCRIPCIONES PÚBLICAS

    Este es el camino confirmado para Thiago.
    =====================================================
  */

  let todasPublicasOrigen =
    [];

  if (
    faltantesObjetivos.length
  ) {

    console.warn(
      "🌎 Faltan pasajeros. Buscando en inscripciones_pendientes_publicas...",
      faltantesObjetivos.map(
        (x) => x.nombre
      )
    );

    /*
      Primero buscamos todos los documentos públicos
      asociados originalmente al 11053.
    */

    const publicasOrigenSnap =
      await getDocs(
        query(
          collection(
            db,
            "inscripciones_pendientes_publicas"
          ),
          where(
            "idGrupo",
            "==",
            String(origen.docId)
          )
        )
      );

    todasPublicasOrigen =
      publicasOrigenSnap.docs.map(
        (d) => ({
          id:
            d.id,

          ...d.data()
        })
      );

    const recuperadosPublica =
      [];

    todasPublicasOrigen.forEach(
      (publica) => {

        const payload =
          publica.payload ||
          {};

        /*
          El payload público contiene prácticamente
          la inscripción completa original.
        */

        const inscripcionId =
          cleanText(
            publica.inscripcionId ||
            payload?.identificacion
              ?.documentoNormalizado ||
            ""
          );

        const item = {
          ...payload,

          id:
            inscripcionId,

          _origenMigracion:
            "inscripciones_pendientes_publicas",

          _publicaDocIdMigracion:
            publica.id,

          _publicaEstadoOriginal:
            publica.estado ||
            ""
        };

        const objetivo =
          encontrarObjetivoPorItem(
            item
          );

        if (!objetivo) {
          return;
        }

        const faltaba =
          faltantesObjetivos.some(
            (x) =>
              getObjetivoKey(x) ===
              getObjetivoKey(objetivo)
          );

        if (!faltaba) {
          return;
        }

        const yaRecuperado =
          recuperadosPublica.some(
            (x) =>
              getItemObjetivoKey(x) ===
              getObjetivoKey(objetivo)
          );

        if (yaRecuperado) {
          return;
        }

        if (!inscripcionId) {
          console.error(
            "❌ Encontré formulario público pero no pude determinar inscripcionId.",
            {
              publicaDocId:
                publica.id,

              objetivo:
                objetivo.nombre
            }
          );

          return;
        }

        recuperadosPublica.push(
          item
        );
      }
    );

    if (
      recuperadosPublica.length
    ) {

      console.log(
        "♻️ Recuperados desde formulario público:"
      );

      console.table(
        recuperadosPublica.map(
          (item) => ({
            id:
              item.id,

            documento:
              getInscripcionDocumento(
                item
              ),

            nombre:
              getNombreMigracion(
                item
              ),

            publicaDoc:
              item._publicaDocIdMigracion,

            estadoOriginal:
              item._publicaEstadoOriginal
          })
        )
      );

      encontrados = [
        ...encontrados,
        ...recuperadosPublica
      ];
    }
  }

  /*
    =====================================================
    6. VALIDACIÓN DEFINITIVA: DEBEN SER EXACTAMENTE 11
    =====================================================
  */

  faltantesObjetivos =
    obtenerObjetivosFaltantes();

  console.log(
    `Encontrados ${encontrados.length} de ${OBJETIVOS.length} pasajeros.`
  );

  console.table(
    encontrados.map(
      (item) => {

        const objetivo =
          encontrarObjetivoPorItem(
            item
          );

        return {
          id:
            item.id,

          documento:
            getInscripcionDocumento(
              item
            ),

          nombre:
            getNombreMigracion(
              item
            ),

          objetivo:
            objetivo?.nombre ||
            "",

          tipo:
            getInscripcionTipoReal(
              item
            ),

          privacidad:
            item?.privacidad?.estado ||
            (
              item._origenMigracion ===
                "inscripciones_pendientes_publicas"
                ? item._publicaEstadoOriginal
                : ""
            ) ||
            "activa",

          encontradoEn:
            item._origenMigracion
        };
      })
  );

  if (
    faltantesObjetivos.length
  ) {

    console.error(
      "❌ SIGUEN FALTANDO PASAJEROS. NO SE EJECUTARÁ LA MIGRACIÓN."
    );

    console.table(
      faltantesObjetivos.map(
        (item) => ({
          nombre:
            item.nombre,

          rut:
            item.rut ||
            ""
        })
      )
    );

    return {
      estado:
        "FALTAN_PASAJEROS",

      encontrados:
        encontrados.length,

      esperados:
        OBJETIVOS.length,

      faltantes:
        faltantesObjetivos
    };
  }

  /*
    Verificar que no tengamos una misma persona
    recuperada dos veces desde fuentes distintas.
  */

  const keysEncontrados =
    encontrados
      .map(
        getItemObjetivoKey
      )
      .filter(Boolean);

  const keysUnicos =
    new Set(
      keysEncontrados
    );

  if (
    encontrados.length !==
      OBJETIVOS.length ||
    keysUnicos.size !==
      OBJETIVOS.length
  ) {

    console.error(
      "❌ La cantidad encontrada no es consistente.",
      {
        encontrados:
          encontrados.length,

        unicos:
          keysUnicos.size,

        esperados:
          OBJETIVOS.length
      }
    );

    return {
      estado:
        "CANTIDAD_INCONSISTENTE",

      encontrados:
        encontrados.length,

      unicos:
        keysUnicos.size,

      esperados:
        OBJETIVOS.length
    };
  }

  /*
    =====================================================
    7. LEER DESTINO Y DETECTAR DUPLICADOS
    =====================================================
  */

  const destinoSnap =
    await getDocs(
      collection(
        db,
        "ventas_cotizaciones",
        String(destino.docId),
        "inscripciones"
      )
    );

  const pasajerosDestino =
    destinoSnap.docs.map(
      (d) => ({
        id:
          d.id,

        ...d.data()
      })
    );

  const plan = [];

  for (
    const item
    of encontrados
  ) {

    const objetivo =
      encontrarObjetivoPorItem(
        item
      );

    const rut =
      getRutMigracion(
        item
      );

    const nombreKey =
      getNombreKeyMigracion(
        item
      );

    const duplicado =
      pasajerosDestino.find(
        (dest) => {

          const rutDest =
            getRutMigracion(
              dest
            );

          const nombreDest =
            getNombreKeyMigracion(
              dest
            );

          if (
            rut &&
            rutDest &&
            rut === rutDest
          ) {
            return true;
          }

          if (
            objetivo &&
            encontrarObjetivoPorItem(dest) &&
            getItemObjetivoKey(dest) ===
              getObjetivoKey(objetivo)
          ) {
            return true;
          }

          return (
            nombreKey &&
            nombreDest &&
            nombreKey === nombreDest
          );
        }
      );

    plan.push({
      item,

      objetivo,

      rut,

      nombre:
        getNombreMigracion(
          item
        ),

      estadoOrigen:
        item?.privacidad?.estado ||
        item._publicaEstadoOriginal ||
        "activa",

      encontradoEn:
        item._origenMigracion,

      duplicadoDestino:
        duplicado
          ? duplicado.id
          : "",

      accion:
        duplicado
          ? "YA_EXISTE_DESTINO"
          : "MIGRAR"
    });
  }

  console.log(
    "📋 PLAN DE MIGRACIÓN"
  );

  console.table(
    plan.map(
      (x) => ({
        documento:
          x.rut,

        nombre:
          x.nombre,

        estadoOrigen:
          x.estadoOrigen,

        encontradoEn:
          x.encontradoEn,

        accion:
          x.accion,

        duplicadoDestino:
          x.duplicadoDestino ||
          ""
      })
    )
  );

  const duplicados =
    plan.filter(
      (x) =>
        x.accion ===
        "YA_EXISTE_DESTINO"
    );

  if (
    duplicados.length
  ) {

    console.error(
      "❌ Hay pasajeros que ya existen en el grupo 11184."
    );

    console.table(
      duplicados.map(
        (x) => ({
          nombre:
            x.nombre,

          documento:
            x.rut,

          duplicadoDestino:
            x.duplicadoDestino
        })
      )
    );

    console.error(
      "NO se ejecutará la migración para evitar sobreescribir datos."
    );

    return {
      estado:
        "DUPLICADOS_DESTINO",

      duplicados
    };
  }

  /*
    =====================================================
    8. DRY RUN
    =====================================================
  */

  if (dryRun) {

    console.warn(
      "⚠️ SIMULACIÓN TERMINADA. NO SE MODIFICÓ FIREBASE."
    );

    console.log(
      "Si los 11 aparecen como MIGRAR, ejecutar:"
    );

    console.log(
      "await migrarPasajeros11053a11184({ dryRun:false, confirmar:true })"
    );

    return {
      estado:
        "DRY_RUN_OK",

      total:
        plan.length,

      plan
    };
  }

  /*
    =====================================================
    9. DOBLE PROTECCIÓN PARA EJECUCIÓN REAL
    =====================================================
  */

  if (!confirmar) {

    console.error(
      "❌ Para ejecutar realmente debes usar confirmar:true."
    );

    return null;
  }

  const confirmacion =
    window.confirm(
      `MIGRACIÓN DEFINITIVA\n\n` +
      `Grupo ${GRUPO_ORIGEN} → ${GRUPO_DESTINO}\n\n` +
      `Se migrarán exactamente ${plan.length} pasajeros.\n\n` +
      `Los documentos existentes en 11053 quedarán archivados.\n` +
      `Thiago será reconstruido desde su formulario público original.\n` +
      `Los registros públicos serán reasignados a 11184.\n\n` +
      `¿Continuar?`
    );

  if (!confirmacion) {

    console.warn(
      "Migración cancelada."
    );

    return null;
  }

  /*
    =====================================================
    10. CARGAR TODOS LOS REGISTROS PÚBLICOS DEL ORIGEN

    Aunque antes quizá ya los cargamos por Thiago,
    hacemos aquí una lectura fresca antes de modificar.
    =====================================================
  */

  const publicasOrigenSnap =
    await getDocs(
      query(
        collection(
          db,
          "inscripciones_pendientes_publicas"
        ),
        where(
          "idGrupo",
          "==",
          String(origen.docId)
        )
      )
    );

  todasPublicasOrigen =
    publicasOrigenSnap.docs.map(
      (d) => ({
        id:
          d.id,

        ...d.data()
      })
    );

  console.log(
    `Registros públicos disponibles en 11053: ${todasPublicasOrigen.length}`
  );

  const resultados = [];

  /*
    =====================================================
    11. MIGRAR UNO A UNO
    =====================================================
  */

  for (
    const registro
    of plan
  ) {

    const item =
      registro.item;

    const objetivo =
      registro.objetivo;

    const inscripcionId =
      String(
        item.id
      ).trim();

    const nombre =
      registro.nombre;

    const rut =
      registro.rut;

    console.log(
      `🚚 Migrando ${nombre} · ${rut || inscripcionId}`
    );

    if (!inscripcionId) {
      throw new Error(
        `No se pudo determinar inscripcionId para ${nombre}.`
      );
    }

    /*
      ===================================================
      11A. LIMPIAR PRIVACIDAD PARA DESTINO
      ===================================================
    */

    const privacidadOriginal = {
      ...(item.privacidad || {})
    };

    delete privacidadOriginal.archivadaAt;
    delete privacidadOriginal.archivadaPor;
    delete privacidadOriginal.archivadaPorCorreo;
    delete privacidadOriginal.motivoArchivo;
    delete privacidadOriginal.archivoId;
    delete privacidadOriginal.migradaAGrupo;

    const privacidadDestino = {
      ...privacidadOriginal,

      estado:
        "activa",

      eliminada:
        false,

      anonimizada:
        false,

      motivo:
        "",

      migradaDesdeGrupo:
        String(origen.docId),

      migradaAt:
        serverTimestamp(),

      migradaPor:
        getDisplayName(
          state.effectiveUser
        ),

      migradaPorCorreo:
        state.effectiveEmail
    };

    /*
      ===================================================
      11B. QUITAR CAMPOS TEMPORALES
      ===================================================
    */

    const datosInscripcionParaMigrar =
      quitarCamposSoloJs(
        item
      );

    /*
      ===================================================
      11C. ACTUALIZAR CONTEXTO DEL GRUPO

      Conservamos toda la información personal/médica,
      pero la asociación al grupo debe quedar en 11184.

      Esto evita que internamente siga diciendo 1A/11053.
      ===================================================
    */

    const grupoAnterior =
      datosInscripcionParaMigrar.grupo ||
      {};

    const cursoDestino =
      cleanText(
        destino.data?.curso ||
        grupoAnterior.cursoBase ||
        ""
      );

    const anoBaseDestino =
      getDocBaseYear(
        destino.data ||
        {}
      );

    const grupoDestino = {
      ...grupoAnterior,

      idGrupo:
        String(destino.docId),

      aliasGrupo:
        cleanText(
          destino.data?.aliasGrupo ||
          destino.data?.nombreGrupo ||
          grupoAnterior.aliasGrupo ||
          ""
        ),

      nombreGrupo:
        cleanText(
          destino.data?.nombreGrupo ||
          destino.data?.aliasGrupo ||
          grupoAnterior.nombreGrupo ||
          ""
        ),

      colegio:
        cleanText(
          destino.data?.colegio ||
          grupoAnterior.colegio ||
          ""
        ),

      anoViaje:
        cleanText(
          destino.data?.anoViaje ||
          grupoAnterior.anoViaje ||
          ""
        ),

      cursoBase:
        cursoDestino ||
        grupoAnterior.cursoBase ||
        "",

      cursoActualInscripcion:
        cursoDestino
          ? `${cursoDestino} (${anoBaseDestino})`
          : (
              grupoAnterior
                .cursoActualInscripcion ||
              ""
            ),

      destinoPrincipal:
        cleanText(
          destino.data?.destinoPrincipal ||
          grupoAnterior.destinoPrincipal ||
          ""
        )
    };

    /*
      ===================================================
      11D. CREAR INSCRIPCIÓN EN GRUPO 11184
      ===================================================
    */

    const destinoRef =
      doc(
        db,
        "ventas_cotizaciones",
        String(destino.docId),
        "inscripciones",
        inscripcionId
      );

    await setDoc(
      destinoRef,
      {
        ...datosInscripcionParaMigrar,

        idGrupo:
          String(destino.docId),

        groupDocId:
          String(destino.docId),

        grupo:
          grupoDestino,

        privacidad:
          privacidadDestino,

        migracionGrupo: {
          origenDocId:
            String(origen.docId),

          origenIdGrupo:
            String(origen.groupId),

          destinoDocId:
            String(destino.docId),

          destinoIdGrupo:
            String(destino.groupId),

          origenRegistro:
            item._origenMigracion,

          archivoOrigenId:
            item._archivoIdMigracion ||
            "",

          publicaOrigenId:
            item._publicaDocIdMigracion ||
            "",

          migradoAt:
            serverTimestamp(),

          migradoPor:
            getDisplayName(
              state.effectiveUser
            ),

          migradoPorCorreo:
            state.effectiveEmail
        },

        actualizadoAt:
          serverTimestamp(),

        actualizadoPor:
          getDisplayName(
            state.effectiveUser
          ),

        actualizadoPorCorreo:
          state.effectiveEmail
      }
    );

    /*
      ===================================================
      11E. ARCHIVAR ORIGINAL SI TODAVÍA EXISTE

      Los 10 normales entran aquí.

      Thiago NO entra aquí porque su fuente es:
      inscripciones_pendientes_publicas
      ===================================================
    */

    if (
      item._origenMigracion ===
      "inscripciones"
    ) {

      const origenRef =
        doc(
          db,
          "ventas_cotizaciones",
          String(origen.docId),
          "inscripciones",
          inscripcionId
        );

      await updateDoc(
        origenRef,
        {
          privacidad: {
            ...(item.privacidad || {}),

            estado:
              "archivada",

            archivadaAt:
              serverTimestamp(),

            archivadaPor:
              getDisplayName(
                state.effectiveUser
              ),

            archivadaPorCorreo:
              state.effectiveEmail,

            motivoArchivo:
              `Migrado al grupo ${GRUPO_DESTINO}`,

            migradaAGrupo:
              String(destino.docId)
          },

          migracionGrupoDestino:
            String(destino.docId),

          migracionGrupoAt:
            serverTimestamp(),

          migracionGrupoPor:
            getDisplayName(
              state.effectiveUser
            ),

          migracionGrupoPorCorreo:
            state.effectiveEmail
        }
      );

    } else {

      console.log(
        `ℹ️ ${nombre}: no existe inscripción oficial activa en 11053 que archivar.`,
        {
          origenRegistro:
            item._origenMigracion,

          archivo:
            item._archivoIdMigracion ||
            "",

          publica:
            item._publicaDocIdMigracion ||
            ""
        }
      );
    }

    /*
      ===================================================
      11F. ENCONTRAR Y MIGRAR REGISTRO(S) PÚBLICO(S)

      La comparación se hace:
      1. RUT
      2. objetivo identificado
      3. nombre exacto normalizado
      ===================================================
    */

    let publicosMigrados =
      0;

    for (
      const publica
      of todasPublicasOrigen
    ) {

      const payload =
        publica.payload ||
        {};

      const itemPublicoTemporal = {
        ...payload,

        id:
          publica.inscripcionId ||
          payload?.identificacion
            ?.documentoNormalizado ||
          publica.id
      };

      const objetivoPublico =
        encontrarObjetivoPorItem(
          itemPublicoTemporal
        );

      const rutPublico =
        getRutMigracion(
          itemPublicoTemporal
        );

      const nombrePublicoKey =
        getNombreKeyMigracion(
          itemPublicoTemporal
        );

      const nombreActualKey =
        getNombreKeyMigracion(
          item
        );

      const coincide =
        (
          rut &&
          rutPublico &&
          rut === rutPublico
        ) ||
        (
          objetivo &&
          objetivoPublico &&
          getObjetivoKey(objetivo) ===
            getObjetivoKey(
              objetivoPublico
            )
        ) ||
        (
          nombreActualKey &&
          nombrePublicoKey &&
          nombreActualKey ===
            nombrePublicoKey
        );

      if (!coincide) {
        continue;
      }

      const privacidadPublica = {
        ...(payload?.privacidad || {})
      };

      delete privacidadPublica.archivadaAt;
      delete privacidadPublica.archivadaPor;
      delete privacidadPublica.archivadaPorCorreo;
      delete privacidadPublica.motivoArchivo;
      delete privacidadPublica.archivoId;

      const grupoPublicoAnterior =
        payload.grupo ||
        {};

      const grupoPublicoDestino = {
        ...grupoPublicoAnterior,

        idGrupo:
          String(destino.docId),

        aliasGrupo:
          cleanText(
            destino.data?.aliasGrupo ||
            destino.data?.nombreGrupo ||
            grupoPublicoAnterior.aliasGrupo ||
            ""
          ),

        nombreGrupo:
          cleanText(
            destino.data?.nombreGrupo ||
            destino.data?.aliasGrupo ||
            grupoPublicoAnterior.nombreGrupo ||
            ""
          ),

        colegio:
          cleanText(
            destino.data?.colegio ||
            grupoPublicoAnterior.colegio ||
            ""
          ),

        anoViaje:
          cleanText(
            destino.data?.anoViaje ||
            grupoPublicoAnterior.anoViaje ||
            ""
          ),

        cursoBase:
          cursoDestino ||
          grupoPublicoAnterior.cursoBase ||
          "",

        cursoActualInscripcion:
          cursoDestino
            ? `${cursoDestino} (${anoBaseDestino})`
            : (
                grupoPublicoAnterior
                  .cursoActualInscripcion ||
                ""
              ),

        destinoPrincipal:
          cleanText(
            destino.data?.destinoPrincipal ||
            grupoPublicoAnterior
              .destinoPrincipal ||
            ""
          )
      };

      const publicaRef =
        doc(
          db,
          "inscripciones_pendientes_publicas",
          publica.id
        );

      await updateDoc(
        publicaRef,
        {
          idGrupo:
            String(destino.docId),

          groupDocId:
            String(destino.docId),

          /*
            Thiago está hoy como eliminada_logica.
            Lo devolvemos al estado normal procesado.
          */
          estado:
            normalizeSearchLocal(
              publica.estado ||
              ""
            ) === "eliminada_logica"
              ? "procesado"
              : (
                  publica.estado ||
                  "procesado"
                ),

          "payload.idGrupo":
            String(destino.docId),

          "payload.groupDocId":
            String(destino.docId),

          "payload.grupo":
            grupoPublicoDestino,

          "payload.privacidad": {
            ...privacidadPublica,

            estado:
              "activa",

            eliminada:
              false,

            anonimizada:
              false,

            motivo:
              ""
          },

          migracionGrupo: {
            origenDocId:
              String(origen.docId),

            destinoDocId:
              String(destino.docId),

            migradoAt:
              serverTimestamp(),

            migradoPor:
              getDisplayName(
                state.effectiveUser
              ),

            migradoPorCorreo:
              state.effectiveEmail
          },

          /*
            Quitar marcas creadas por la sincronización
            que dejó a Thiago como eliminada_logica.
          */
          eliminadaPorSyncNomina:
            deleteField(),

          eliminadaPorSyncAt:
            deleteField(),

          eliminadaPorSyncGrupo:
            deleteField(),

          eliminadaPorSyncInscripcionId:
            deleteField()
        }
      );

      publicosMigrados++;
    }

    /*
      ===================================================
      11G. RESULTADO INDIVIDUAL
      ===================================================
    */

    resultados.push({
      documento:
        rut,

      nombre,

      inscripcionId,

      origen:
        origen.docId,

      destino:
        destino.docId,

      recuperadoDesde:
        item._origenMigracion,

      publicaOrigen:
        item._publicaDocIdMigracion ||
        "",

      publicosMigrados,

      estado:
        "MIGRADO"
    });

    console.log(
      `✅ ${nombre} migrado correctamente.`,
      {
        inscripcionId,

        fuente:
          item._origenMigracion,

        publicosMigrados
      }
    );
  }

  /*
    =====================================================
    12. RESULTADO FINAL
    =====================================================
  */

  console.log(
    "===================================================="
  );

  console.log(
    "✅ MIGRACIÓN FINALIZADA"
  );

  console.log(
    "===================================================="
  );

  console.table(
    resultados
  );

  const recuperadosPublica =
    resultados.filter(
      (x) =>
        x.recuperadoDesde ===
        "inscripciones_pendientes_publicas"
    );

  console.log({
    totalMigrados:
      resultados.length,

    origen:
      origen.docId,

    destino:
      destino.docId,

    recuperadosDesdePublica:
      recuperadosPublica.length,

    recuperadosDesdeArchivo:
      resultados.filter(
        (x) =>
          x.recuperadoDesde ===
          "inscripciones_archivadas"
      ).length
  });

  /*
    =====================================================
    13. RECARGAR NÓMINA SI ESTAMOS EN UNO DE LOS GRUPOS
    =====================================================
  */

  if (
    String(state.groupDocId) ===
      String(origen.docId) ||
    String(state.groupDocId) ===
      String(destino.docId)
  ) {

    /*
      Dejamos margen a los triggers que generan
      nomina_resumen.
    */

    await esperar(
      1500
    );

    state.inscripcionesCargadas =
      false;

    state.inscripcionesDetalleCache =
      new Map();

    await asegurarNominaCargada({
      mostrar: true,
      renderizar: true
    });
  }

  alert(
    `Migración terminada.\n\n` +
    `${resultados.length} pasajeros migrados.\n` +
    `${GRUPO_ORIGEN} → ${GRUPO_DESTINO}\n\n` +
    `Recuperados desde pública: ${recuperadosPublica.length}`
  );

  return {
    estado:
      "OK",

    total:
      resultados.length,

    resultados
  };
};

/* =========================================================
   LIMPIEZA DEFINITIVA POST-MIGRACIÓN
   11053 -> 11184

   SOLO elimina del grupo 11053 las 11 inscripciones
   que ya fueron migradas al grupo 11184.

   NO toca:
   - inscripciones del 11184
   - inscripciones_pendientes_publicas
   - documentos/archivos en Storage
   - otros pasajeros del 11053

   dryRun=true por defecto.
========================================================= */

window.eliminarDefinitivamenteMigrados11053 = async function ({
  dryRun = true,
  confirmar = false
} = {}) {

  const GRUPO_ORIGEN = "11053";
  const GRUPO_DESTINO = "11184";

  const RUTS_OBJETIVO = new Set([
    "14126961-5", // Nancy Lyha Aliaga Aguero
    "14147208-9", // Luis Alberto Garrido Flores
    "14629963-6", // Lissette Graciela Acuña Galaz
    "23639272-4", // Thiago Agustín Leon Acuña
    "23641896-0", // Amanda Isidora Nuñez Becar
    "23704449-5", // Valentin Alonso Diaz Moragrega
    "23745236-4", // Matías Alejandr Heyser Huilipan
    "23775305-4", // Vicente Agustín Solar Sassi
    "23837287-9", // Mateo Alberto Garrido Aliaga
    "23940284-4", // Cristóbal Matus Jofré
    "23945044-K"  // Monserrat Belen Agurto Acevedo
  ].map(
    normalizarRutKeyGrupo
  ));

  console.log(
    "===================================================="
  );

  console.log(
    dryRun
      ? "🔎 SIMULACIÓN BORRADO DEFINITIVO 11053"
      : "🗑️ BORRADO DEFINITIVO 11053"
  );

  console.log(
    "===================================================="
  );

  /*
    =====================================================
    1. VERIFICAR GRUPOS
    =====================================================
  */

  const origen =
    await resolveGroupByParam(
      GRUPO_ORIGEN
    );

  const destino =
    await resolveGroupByParam(
      GRUPO_DESTINO
    );

  if (!origen) {
    console.error(
      `❌ No encontré grupo origen ${GRUPO_ORIGEN}.`
    );

    return null;
  }

  if (!destino) {
    console.error(
      `❌ No encontré grupo destino ${GRUPO_DESTINO}.`
    );

    return null;
  }

  /*
    =====================================================
    2. LEER INSCRIPCIONES COMPLETAS DEL 11053
    =====================================================
  */

  const origenSnap =
    await getDocs(
      collection(
        db,
        "ventas_cotizaciones",
        String(origen.docId),
        "inscripciones"
      )
    );

  const origenItems =
    origenSnap.docs.map(
      (d) => ({
        id:
          d.id,

        ...d.data()
      })
    );

  const candidatos =
    origenItems.filter(
      (item) => {

        const rut =
          normalizarRutKeyGrupo(
            getInscripcionDocumento(item) ||
            item.id ||
            ""
          );

        return RUTS_OBJETIVO.has(
          rut
        );
      }
    );

  /*
    =====================================================
    3. VERIFICAR QUE ESOS MISMOS RUT EXISTAN EN 11184

    Este es el blindaje principal:
    NO borraremos a nadie del 11053 si no existe
    previamente en el destino.
    =====================================================
  */

  const destinoSnap =
    await getDocs(
      collection(
        db,
        "ventas_cotizaciones",
        String(destino.docId),
        "inscripciones"
      )
    );

  const destinoItems =
    destinoSnap.docs.map(
      (d) => ({
        id:
          d.id,

        ...d.data()
      })
    );

  const rutsDestino =
    new Set(
      destinoItems.map(
        (item) =>
          normalizarRutKeyGrupo(
            getInscripcionDocumento(item) ||
            item.id ||
            ""
          )
      ).filter(Boolean)
    );

  const plan =
    candidatos.map(
      (item) => {

        const rut =
          normalizarRutKeyGrupo(
            getInscripcionDocumento(item) ||
            item.id ||
            ""
          );

        const existeDestino =
          rutsDestino.has(
            rut
          );

        return {
          item,

          id:
            item.id,

          rut,

          nombre:
            cleanText(
              `${getInscripcionNombres(item)} ${getInscripcionApellidos(item)}`
            ),

          privacidad:
            item?.privacidad?.estado ||
            "",

          existeDestino,

          accion:
            existeDestino
              ? "BORRAR_11053"
              : "NO_BORRAR_FALTA_11184"
        };
      }
    );

  console.log(
    "📋 PLAN DE LIMPIEZA"
  );

  console.table(
    plan.map(
      (x) => ({
        id:
          x.id,

        rut:
          x.rut,

        nombre:
          x.nombre,

        privacidad:
          x.privacidad,

        existeEn11184:
          x.existeDestino,

        accion:
          x.accion
      })
    )
  );

  /*
    =====================================================
    4. VALIDACIONES
    =====================================================
  */

  if (
    candidatos.length !==
    RUTS_OBJETIVO.size
  ) {

    console.error(
      "❌ No encontré exactamente los 11 documentos en 11053.",
      {
        encontrados:
          candidatos.length,

        esperados:
          RUTS_OBJETIVO.size
      }
    );

    return {
      estado:
        "CANTIDAD_ORIGEN_INCORRECTA",

      encontrados:
        candidatos.length,

      esperados:
        RUTS_OBJETIVO.size,

      plan
    };
  }

  const noMigrados =
    plan.filter(
      (x) =>
        !x.existeDestino
    );

  if (
    noMigrados.length
  ) {

    console.error(
      "❌ Hay pasajeros que NO existen en 11184. No borraré nada."
    );

    console.table(
      noMigrados.map(
        (x) => ({
          rut:
            x.rut,

          nombre:
            x.nombre
        })
      )
    );

    return {
      estado:
        "FALTAN_EN_DESTINO",

      noMigrados
    };
  }

  /*
    =====================================================
    5. DRY RUN
    =====================================================
  */

  if (dryRun) {

    console.warn(
      "⚠️ SIMULACIÓN TERMINADA. NO SE BORRÓ NADA."
    );

    console.log(
      "Si aparecen exactamente 11 con BORRAR_11053:"
    );

    console.log(
      "await eliminarDefinitivamenteMigrados11053({ dryRun:false, confirmar:true })"
    );

    return {
      estado:
        "DRY_RUN_OK",

      total:
        plan.length,

      plan
    };
  }

  /*
    =====================================================
    6. CONFIRMACIÓN REAL
    =====================================================
  */

  if (!confirmar) {

    console.error(
      "❌ Debes usar confirmar:true."
    );

    return null;
  }

  const ok =
    window.confirm(
      `BORRADO DEFINITIVO\n\n` +
      `Se eliminarán físicamente ${plan.length} inscripciones del grupo ${GRUPO_ORIGEN}.\n\n` +
      `Ya se verificó que existen en el grupo ${GRUPO_DESTINO}.\n\n` +
      `NO se borrarán sus registros públicos ni sus copias del grupo destino.\n\n` +
      `¿Continuar?`
    );

  if (!ok) {

    console.warn(
      "Borrado cancelado."
    );

    return null;
  }

  /*
    =====================================================
    7. BORRAR DEL 11053
    =====================================================
  */

  const borrados = [];

  for (
    const registro
    of plan
  ) {

    const ref =
      doc(
        db,
        "ventas_cotizaciones",
        String(origen.docId),
        "inscripciones",
        String(registro.id)
      );

    console.log(
      `🗑️ Eliminando de 11053: ${registro.nombre} · ${registro.rut}`
    );

    await deleteDoc(
      ref
    );

    borrados.push({
      id:
        registro.id,

      rut:
        registro.rut,

      nombre:
        registro.nombre
    });
  }

  /*
    =====================================================
    8. HISTORIAL
    =====================================================
  */

  try {

    await addDoc(
      collection(
        db,
        HISTORIAL_COLLECTION
      ),
      {
        idGrupo:
          String(origen.groupId),

        groupDocId:
          String(origen.docId),

        tipoMovimiento:
          "limpieza_post_migracion_11053_11184",

        modulo:
          "inscripcion",

        titulo:
          "Limpieza definitiva post migración",

        mensaje:
          `${getDisplayName(state.effectiveUser)} eliminó definitivamente del grupo ${GRUPO_ORIGEN} las ${borrados.length} inscripciones previamente migradas al grupo ${GRUPO_DESTINO}.`,

        fecha:
          serverTimestamp(),

        creadoPor:
          getDisplayName(
            state.effectiveUser
          ),

        creadoPorCorreo:
          state.effectiveEmail,

        metadata: {
          grupoOrigen:
            GRUPO_ORIGEN,

          grupoDestino:
            GRUPO_DESTINO,

          total:
            borrados.length,

          pasajeros:
            borrados
        }
      }
    );

  } catch (error) {

    console.warn(
      "⚠️ Las inscripciones fueron borradas, pero no se pudo guardar historial.",
      error
    );
  }

  /*
    =====================================================
    9. RESULTADO
    =====================================================
  */

  console.log(
    "===================================================="
  );

  console.log(
    `✅ BORRADO TERMINADO: ${borrados.length} inscripciones eliminadas del 11053`
  );

  console.log(
    "===================================================="
  );

  console.table(
    borrados
  );

  /*
    Dar margen al trigger que actualiza nomina_resumen.
  */

  await esperar(
    1500
  );

  if (
    String(state.groupDocId) ===
    String(origen.docId)
  ) {

    state.inscripcionesCargadas =
      false;

    state.inscripcionesDetalleCache =
      new Map();

    await asegurarNominaCargada({
      mostrar: true,
      renderizar: true
    });
  }

  return {
    estado:
      "OK",

    total:
      borrados.length,

    borrados
  };
};
