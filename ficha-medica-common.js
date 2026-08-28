// RENOMBRAR COMO: ficha-medica-common.js

import { auth, db, VENTAS_USERS, normalizeEmail } from "./firebase-init.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.7.3/firebase-auth.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";

export { auth, db, onAuthStateChanged, collection, doc, getDoc, getDocs, addDoc, updateDoc, serverTimestamp };

export const $ = (id) => document.getElementById(id);

export function clean(value = "") {
  return String(value ?? "").trim();
}

export function normalize(value = "") {
  return clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function escapeHtml(value = "") {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function getByPath(object, path = "") {
  return path.split(".").reduce((acc, key) => acc?.[key], object);
}

export function setByPath(object, path = "", value) {
  const keys = path.split(".");
  let current = object;

  keys.forEach((key, index) => {
    if (index === keys.length - 1) {
      current[key] = value;
      return;
    }

    if (!current[key] || typeof current[key] !== "object" || Array.isArray(current[key])) {
      current[key] = {};
    }

    current = current[key];
  });
}

export function formatValue(value) {
  if (value === true) return "Sí";
  if (value === false) return "No";
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function formatDate(value) {
  if (!value) return "—";

  let date = null;

  if (value?.toDate) date = value.toDate();
  else if (value instanceof Date) date = value;
  else date = new Date(value);

  if (!date || Number.isNaN(date.getTime())) return formatValue(value);

  return new Intl.DateTimeFormat("es-CL", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

export function passengerName(item = {}) {
  return clean(
    item?.identificacion?.nombreCompleto ||
    [
      item?.identificacion?.nombres,
      item?.identificacion?.primerApellido,
      item?.identificacion?.segundoApellido
    ].filter(Boolean).join(" ")
  ) || "Pasajero sin nombre";
}

export function passengerDocument(item = {}) {
  return clean(
    item?.identificacion?.documento ||
    item?.identificacion?.rut ||
    item?.identificacion?.documentoNormalizado ||
    item?.rut ||
    item?.id
  ) || "Sin documento";
}

export function isArchived(item = {}) {
  const status = normalize(item?.privacidad?.estado);
  return status === "archivada" || status === "eliminada_logica";
}

export function isCancelled(item = {}) {
  return item?.anulado === true ||
    item?.estadoViaje === "anulado" ||
    normalize(item?.estado) === "anulado" ||
    normalize(item?.privacidad?.estado) === "anulada";
}

export function fichaCompleta(item = {}) {
  return item?.fichaMedicaCompleta === true ||
    item?.nominaFinalCompleta === true ||
    item?.fichaMedicaCompletada === true ||
    item?.nominaFinalCompletada === true ||
    ["completa", "completada"].includes(normalize(item?.fichaMedicaEstado));
}

export function medicalAlerts(item = {}) {
  const salud = item?.salud || {};
  const alerts = [];

  if (normalize(salud.alergiasFlag) === "si" || clean(salud.alergiasDetalle)) {
    alerts.push("Alergias");
  }

  if (
    normalize(salud.dietaFlag) === "si" ||
    (Array.isArray(salud.dietaTipos) && salud.dietaTipos.length) ||
    (Array.isArray(salud.dietaRestricciones) && salud.dietaRestricciones.length)
  ) {
    alerts.push("Alimentación");
  }

  if (normalize(salud.medicamentosFlag) === "si" || clean(salud.medicamentosDetalle)) {
    alerts.push("Medicamentos");
  }

  if (normalize(salud.enfermedadBaseFlag) === "si" || clean(salud.enfermedadBaseDetalle)) {
    alerts.push("Enfermedad base");
  }

  if (normalize(salud.saludMentalFlag) === "si" || clean(salud.saludMentalDetalle)) {
    alerts.push("Salud mental");
  }

  if (normalize(salud.neurodivergenciaFlag) === "si" || clean(salud.neurodivergenciaDescripcion)) {
    alerts.push("Neurodivergencia");
  }

  if (normalize(salud.discapacidadFlag) === "si" || clean(salud.discapacidadDescripcion)) {
    alerts.push("Apoyos");
  }

  if (normalize(salud.emergenciaMedicaFlag) === "si" || clean(salud.emergenciaMedicaDetalle)) {
    alerts.push("Emergencia médica");
  }

  return [...new Set(alerts)];
}

export function getCurrentSystemUser(firebaseUser) {
  const email = normalizeEmail(firebaseUser?.email || "");

  const users = Array.isArray(VENTAS_USERS)
    ? VENTAS_USERS
    : Object.values(VENTAS_USERS || {});

  const configured = users.find((item) =>
    normalizeEmail(item?.email || item?.correo || "") === email
  );

  return {
    uid: firebaseUser?.uid || "",
    email,
    nombre: clean(
      configured?.nombreCompleto ||
      [configured?.nombre, configured?.apellido].filter(Boolean).join(" ") ||
      firebaseUser?.displayName ||
      email
    ),
    rol: normalize(configured?.rol || "")
  };
}

export function canViewMedicalData(
  user = {}
) {
  return !!user?.email;
}
export function canEditMedicalData(
  user = {}
) {
  return !!user?.email;
}
export async function resolveGroup(groupParam = "") {
  const id = clean(groupParam);
  if (!id) return null;

  const direct = await getDoc(doc(db, "ventas_cotizaciones", id));

  if (direct.exists()) {
    return {
      docId: direct.id,
      groupId: clean(direct.data()?.idGrupo || direct.id),
      data: direct.data() || {}
    };
  }

  // El sistema actual usa normalmente el docId como identificador.
  // Si la URL trae otro identificador, esta primera versión no hace
  // una consulta where para evitar exigir nuevos índices.
  return null;
}

export async function loadGroupInscriptions(groupDocId = "") {
  const snap = await getDocs(
    collection(db, "ventas_cotizaciones", clean(groupDocId), "inscripciones")
  );

  return snap.docs
    .map((item) => ({ id: item.id, ...item.data() }))
    .filter((item) => !isArchived(item))
    .sort((a, b) => passengerName(a).localeCompare(passengerName(b), "es"));
}

export async function loadInscription(groupDocId = "", inscriptionId = "") {
  const snap = await getDoc(
    doc(
      db,
      "ventas_cotizaciones",
      clean(groupDocId),
      "inscripciones",
      clean(inscriptionId)
    )
  );

  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export const EDIT_FIELDS = [
  { section: "Identificación", path: "identificacion.nombres", label: "Nombres" },
  { section: "Identificación", path: "identificacion.primerApellido", label: "Primer apellido" },
  { section: "Identificación", path: "identificacion.segundoApellido", label: "Segundo apellido" },
  { section: "Identificación", path: "identificacion.fechaNacimiento", label: "Fecha de nacimiento", type: "date" },
  { section: "Identificación", path: "identificacion.generoFinal", label: "Género" },
  { section: "Identificación", path: "identificacion.nacionalidadBase", label: "Nacionalidad" },
  { section: "Identificación", path: "identificacion.nacionalidadDetalle", label: "Detalle nacionalidad" },
  { section: "Identificación", path: "identificacion.correoViajante", label: "Correo pasajero", type: "email" },
  { section: "Identificación", path: "identificacion.telefonoViajante", label: "Teléfono pasajero" },
  { section: "Identificación", path: "identificacion.tallaPolera", label: "Talla polera" },

  { section: "Responsable principal", path: "contactoPrincipal.nombre", label: "Nombre" },
  { section: "Responsable principal", path: "contactoPrincipal.relacion", label: "Relación" },
  { section: "Responsable principal", path: "contactoPrincipal.telefono", label: "Teléfono" },
  { section: "Responsable principal", path: "contactoPrincipal.correo", label: "Correo", type: "email" },

  { section: "Responsable secundario", path: "contactoSecundario.nombre", label: "Nombre" },
  { section: "Responsable secundario", path: "contactoSecundario.relacion", label: "Relación" },
  { section: "Responsable secundario", path: "contactoSecundario.telefono", label: "Teléfono" },
  { section: "Responsable secundario", path: "contactoSecundario.correo", label: "Correo", type: "email" },

  { section: "Emergencia", path: "emergencia.nombre", label: "Nombre" },
  { section: "Emergencia", path: "emergencia.relacion", label: "Relación" },
  { section: "Emergencia", path: "emergencia.telefono", label: "Teléfono" },
  { section: "Emergencia secundaria", path: "emergenciaSecundaria.nombre", label: "Nombre" },
  { section: "Emergencia secundaria", path: "emergenciaSecundaria.relacion", label: "Relación" },
  { section: "Emergencia secundaria", path: "emergenciaSecundaria.telefono", label: "Teléfono" },

  { section: "Salud", path: "salud.grupoSanguineo", label: "Grupo sanguíneo" },
  { section: "Salud", path: "salud.enfermedadBaseFlag", label: "¿Enfermedad de base?" },
  { section: "Salud", path: "salud.enfermedadBaseDetalle", label: "Detalle enfermedad de base", type: "textarea" },
  { section: "Salud", path: "salud.saludGeneralFlag", label: "¿Condición general de salud?" },
  { section: "Salud", path: "salud.saludGeneralDetalle", label: "Detalle salud general", type: "textarea" },
  { section: "Salud", path: "salud.cirugiasPreviasFlag", label: "¿Cirugías o tratamientos?" },
  { section: "Salud", path: "salud.cirugiasPreviasDetalle", label: "Detalle cirugías o tratamientos", type: "textarea" },
  { section: "Salud", path: "salud.emergenciaMedicaFlag", label: "¿Antecedente de emergencia médica?" },
  { section: "Salud", path: "salud.emergenciaMedicaDetalle", label: "Detalle emergencia médica", type: "textarea" },
  { section: "Salud", path: "salud.medicamentosFlag", label: "¿Usa medicamentos?" },
  { section: "Salud", path: "salud.medicamentosDetalle", label: "Medicamentos", type: "textarea" },
  { section: "Salud", path: "salud.medicamentosProhibidosFlag", label: "¿Medicamentos prohibidos?" },
  { section: "Salud", path: "salud.medicamentosProhibidosDetalle", label: "Medicamentos prohibidos", type: "textarea" },
  { section: "Salud", path: "salud.alergiasFlag", label: "¿Tiene alergias?" },
  { section: "Salud", path: "salud.alergiasDetalle", label: "Detalle alergias", type: "textarea" },
  { section: "Salud", path: "salud.dietaFlag", label: "¿Dieta o restricción?" },
  { section: "Salud", path: "salud.dietaDetalle", label: "Detalle dieta", type: "textarea" },
  { section: "Salud", path: "salud.dietaTipos", label: "Tipos de dieta (separados por coma)", type: "array" },
  { section: "Salud", path: "salud.dietaRestricciones", label: "Restricciones (separadas por coma)", type: "array" },

  { section: "Apoyos y bienestar", path: "salud.discapacidadFlag", label: "¿Discapacidad?" },
  { section: "Apoyos y bienestar", path: "salud.discapacidadTipos", label: "Tipos (separados por coma)", type: "array" },
  { section: "Apoyos y bienestar", path: "salud.discapacidadDescripcion", label: "Descripción", type: "textarea" },
  { section: "Apoyos y bienestar", path: "salud.discapacidadApoyoTipo", label: "Apoyo requerido", type: "textarea" },
  { section: "Apoyos y bienestar", path: "salud.discapacidadRecomendaciones", label: "Recomendaciones", type: "textarea" },
  { section: "Apoyos y bienestar", path: "salud.neurodivergenciaFlag", label: "¿Neurodivergencia?" },
  { section: "Apoyos y bienestar", path: "salud.neurodivergenciaTipos", label: "Tipos (separados por coma)", type: "array" },
  { section: "Apoyos y bienestar", path: "salud.neurodivergenciaDescripcion", label: "Descripción", type: "textarea" },
  { section: "Apoyos y bienestar", path: "salud.neuroFactores", label: "Factores de sobrecarga", type: "textarea" },
  { section: "Apoyos y bienestar", path: "salud.neuroEstrategias", label: "Estrategias", type: "textarea" },
  { section: "Apoyos y bienestar", path: "salud.neuroApoyosDetalle", label: "Apoyos necesarios", type: "textarea" },
  { section: "Apoyos y bienestar", path: "salud.saludMentalFlag", label: "¿Antecedente de salud mental?" },
  { section: "Apoyos y bienestar", path: "salud.saludMentalDetalle", label: "Detalle salud mental", type: "textarea" },
  { section: "Otros", path: "salud.otrosAntecedentesFlag", label: "¿Otros antecedentes?" },
  { section: "Otros", path: "salud.otrosAntecedentesDetalle", label: "Otros antecedentes", type: "textarea" }
];

export function renderMedicalSheet(group = {}, item = {}, options = {}) {
  const alerts = medicalAlerts(item);
  const salud = item.salud || {};

  const row = (label, value, important = false) => `
    <div class="sheet-row ${important ? "sheet-important" : ""}">
      <div class="sheet-label">${escapeHtml(label)}</div>
      <div class="sheet-value">${escapeHtml(formatValue(value))}</div>
    </div>
  `;

  const section = (title, content) => `
    <section class="sheet-section">
      <h2>${escapeHtml(title)}</h2>
      <div class="sheet-grid">${content}</div>
    </section>
  `;

  return `
    <article class="medical-sheet">
      <header class="sheet-header">
        <div>
          <div class="sheet-kicker">Turismo Rai Trai · Uso interno</div>
          <h1>Ficha médica del pasajero</h1>
          <p>${escapeHtml(passengerName(item))}</p>
        </div>
        <div class="sheet-status ${fichaCompleta(item) ? "is-complete" : "is-pending"}">
          ${fichaCompleta(item) ? "Ficha completa" : "Ficha pendiente"}
        </div>
      </header>

      ${section("Grupo", [
        row("Grupo", group.aliasGrupo || group.nombreGrupo || group.idGrupo || options.groupId),
        row("Colegio", group.colegio),
        row("Curso", group.curso),
        row("Destino", group.destinoPrincipal || group.destino),
        row("Año del viaje", group.anoViaje)
      ].join(""))}

      ${section("Identificación", [
        row("Documento", passengerDocument(item)),
        row("Nombres", item?.identificacion?.nombres),
        row("Primer apellido", item?.identificacion?.primerApellido),
        row("Segundo apellido", item?.identificacion?.segundoApellido),
        row("Fecha de nacimiento", item?.identificacion?.fechaNacimiento),
        row("Edad", item?.identificacion?.edad),
        row("Género", item?.identificacion?.generoFinal || item?.identificacion?.genero),
        row("Nacionalidad", item?.identificacion?.nacionalidadBase),
        row("Detalle nacionalidad", item?.identificacion?.nacionalidadDetalle),
        row("Tipo de pasajero", item.tipoViajante || item.tipoParticipacion),
        row("Talla polera", item?.identificacion?.tallaPolera)
      ].join(""))}

      ${section("Contactos", [
        row("Correo pasajero", item?.identificacion?.correoViajante),
        row("Teléfono pasajero", item?.identificacion?.telefonoViajante),
        row("Responsable principal", item?.contactoPrincipal?.nombre),
        row("Relación", item?.contactoPrincipal?.relacion),
        row("Teléfono responsable", item?.contactoPrincipal?.telefono),
        row("Correo responsable", item?.contactoPrincipal?.correo),
        row("Responsable secundario", item?.contactoSecundario?.nombre),
        row("Teléfono secundario", item?.contactoSecundario?.telefono),
        row("Correo secundario", item?.contactoSecundario?.correo)
      ].join(""))}

      ${section("Contactos de emergencia", [
        row("Contacto", item?.emergencia?.nombre),
        row("Relación", item?.emergencia?.relacion),
        row("Teléfono", item?.emergencia?.telefono),
        row("Segundo contacto", item?.emergenciaSecundaria?.nombre),
        row("Relación segundo contacto", item?.emergenciaSecundaria?.relacion),
        row("Teléfono segundo contacto", item?.emergenciaSecundaria?.telefono)
      ].join(""))}

      <section class="sheet-section">
        <h2>Alertas operativas</h2>
        <div class="alert-list">
          ${alerts.length
            ? alerts.map((alert) => `<span class="alert-chip">${escapeHtml(alert)}</span>`).join("")
            : `<span class="no-alerts">Sin alertas médicas identificadas por el sistema.</span>`
          }
        </div>
      </section>

      ${section("Antecedentes médicos", [
        row("Grupo sanguíneo", salud.grupoSanguineo),
        row("Enfermedad de base", salud.enfermedadBaseDetalle, normalize(salud.enfermedadBaseFlag) === "si"),
        row("Condición general de salud", salud.saludGeneralDetalle, normalize(salud.saludGeneralFlag) === "si"),
        row("Cirugías / hospitalizaciones / tratamientos", salud.cirugiasPreviasDetalle, normalize(salud.cirugiasPreviasFlag) === "si"),
        row("Antecedente de emergencia médica", salud.emergenciaMedicaDetalle, normalize(salud.emergenciaMedicaFlag) === "si"),
        row("Medicamentos", salud.medicamentosDetalle, normalize(salud.medicamentosFlag) === "si"),
        row("Medicamentos prohibidos", salud.medicamentosProhibidosDetalle, normalize(salud.medicamentosProhibidosFlag) === "si"),
        row("Alergias", salud.alergiasDetalle, normalize(salud.alergiasFlag) === "si"),
        row("Dieta", salud.dietaDetalle, normalize(salud.dietaFlag) === "si"),
        row("Tipos de dieta", salud.dietaTipos),
        row("Restricciones alimentarias", salud.dietaRestricciones),
        row("Alergias alimentarias", Array.isArray(salud.alergiasAlimentarias)
          ? salud.alergiasAlimentarias.map((a) => a?.alimento || a?.detalle || JSON.stringify(a)).join(" · ")
          : salud.alergiasAlimentarias)
      ].join(""))}

      ${section("Discapacidad, neurodivergencia y apoyos", [
        row("Discapacidad", salud.discapacidadDescripcion, normalize(salud.discapacidadFlag) === "si"),
        row("Tipos de discapacidad", salud.discapacidadTipos),
        row("Apoyo requerido", salud.discapacidadApoyoTipo),
        row("Recomendaciones", salud.discapacidadRecomendaciones),
        row("Ayuda técnica", salud.discapacidadAyudaTecnica),
        row("Indicaciones ayuda técnica", salud.discapacidadAyudaIndicaciones),
        row("Neurodivergencia", salud.neurodivergenciaDescripcion, normalize(salud.neurodivergenciaFlag) === "si"),
        row("Tipos de neurodivergencia", salud.neurodivergenciaTipos),
        row("Factores de sobrecarga", salud.neuroFactores),
        row("Estrategias", salud.neuroEstrategias),
        row("Apoyos necesarios", salud.neuroApoyosDetalle),
        row("Salud mental", salud.saludMentalDetalle, normalize(salud.saludMentalFlag) === "si"),
        row("Otros antecedentes", salud.otrosAntecedentesDetalle)
      ].join(""))}

      ${section("Registro y consentimiento", [
        row("Tipo inscripción", item.tipoInscripcion),
        row("Estado cupo", item.estadoCupo),
        row("Fecha formulario", formatDate(item?.meta?.fechaFormularioCliente || item?.meta?.fechaInscripcion)),
        row("Acepta veracidad", item?.consentimiento?.aceptaVeracidad),
        row("Autoriza uso interno", item?.consentimiento?.aceptaUsoInterno),
        row("Última edición administrativa", formatDate(item?.auditoriaFichaMedica?.actualizadoAt)),
        row("Editado por", item?.auditoriaFichaMedica?.actualizadoPor)
      ].join(""))}

      <footer class="sheet-footer">
        Documento de uso interno. Contiene información personal y médica sensible.
      </footer>
    </article>
  `;
}
