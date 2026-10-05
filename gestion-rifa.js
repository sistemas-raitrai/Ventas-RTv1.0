import { auth, db, normalizeEmail } from "./firebase-init.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.7.3/firebase-auth.js";
import { collection, doc, getDocs, runTransaction, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";
import { getRealUser } from "./roles.js";
import { waitForLayoutReady } from "./ui.js";

/*
  Gestiona documentos de rifa_raitrai_2026_reservas.
  Los permisos REALES deben coincidir con las reglas de Firestore.
  Ajusta la lista de correos según el equipo autorizado.
  Nunca habilites lectura pública de esta colección.
*/
const COLECCION = "rifa_raitrai_2026_reservas";
const CORREOS_GESTORES = new Set([
  "sistemas@raitrai.cl",
  "administracion@raitrai.cl",
  "anamaria@raitrai.cl",
  "yenny@raitrai.cl",
  "chernandez@raitrai.cl",
  "griveros@raitrai.cl",
  "tomas@raitrai.cl",
  "victoria@raitrai.cl"
]);
const RELACIONES = { estudiante: "Estudiante", apoderado: "Apoderado(a)", profesor: "Profesor(a)", otro: "Otro" };
const $ = id => document.getElementById(id);
const state = { reservas: [], actual: null, busy: false, email: "", ultimaActualizacion: null };

init();

async function init() {
  await waitForLayoutReady();
  $("rifaRecargar").addEventListener("click", cargarReservas);
  $("rifaBuscar").addEventListener("input", render);
  $("rifaGrupo").addEventListener("change", render);
  $("rifaEstado").addEventListener("change", render);
  $("rifaLimpiar").addEventListener("click", () => {
    $("rifaBuscar").value = "";
    $("rifaGrupo").value = "";
    $("rifaEstado").value = "confirmada";
    render();
  });
  $("rifaCerrar").addEventListener("click", cerrarDetalle);
  $("rifaOverlay").addEventListener("click", event => {
    if (event.target === $("rifaOverlay")) cerrarDetalle();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !$("rifaOverlay").classList.contains("rifa-hidden")) cerrarDetalle();
  });
  $("rifaAgregarPersona").addEventListener("click", () => {
    if ($("rifaPersonas").children.length >= 20) return avisoDetalle("Máximo 20 personas adicionales.", true);
    agregarPersona({ nombres: "", apellidos: "", relacion: "apoderado", otraRelacion: "" });
  });
  $("rifaContactoAsiste").addEventListener("change", actualizarTotalEditado);
  $("rifaEditarForm").addEventListener("submit", guardarDetalle);
  $("rifaArchivar").addEventListener("click", () => cambiarArchivo(true));
  $("rifaRestaurar").addEventListener("click", () => cambiarArchivo(false));

  onAuthStateChanged(auth, async user => {
    if (!user) {
      aviso("Inicia sesión en el programa de ventas para gestionar la rifa.", true);
      window.location.href = "login.html";
      return;
    }
    // La identidad real evita que un usuario simulado eleve permisos.
    state.email = normalizeEmail(getRealUser()?.email || user.email || "");
    if (!CORREOS_GESTORES.has(state.email)) {
      aviso("Tu cuenta no tiene acceso a la gestión de la rifa.", true);
      return;
    }
    await cargarReservas();
  });
}

function aviso(mensaje, error = false) {
  const el = $("rifaEstadoCarga");
  el.textContent = mensaje;
  el.classList.toggle("error", error);
}
function avisoDetalle(mensaje, error = false) {
  const el = $("rifaDialogEstado");
  el.textContent = mensaje;
  el.classList.remove("rifa-hidden");
  el.classList.toggle("error", error);
}
function texto(valor) { return String(valor ?? "").trim(); }
function normalizar(valor) {
  return texto(valor).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}
function nombre(p) { return [p?.nombres, p?.apellidos].map(texto).filter(Boolean).join(" "); }
function fecha(valor) {
  const d = valor?.toDate?.();
  return d ? new Intl.DateTimeFormat("es-CL", { dateStyle: "short", timeStyle: "short" }).format(d) : "—";
}
function estado(reserva) { return reserva.estado === "archivada" ? "archivada" : "confirmada"; }
function totalCalculado(reserva) {
  return (reserva.contacto?.asiste === false ? 0 : 1) + (Array.isArray(reserva.asistentesAdicionales) ? reserva.asistentesAdicionales.length : 0);
}

async function cargarReservas() {
  if (state.busy || !CORREOS_GESTORES.has(state.email)) return;
  state.busy = true;
  $("rifaRecargar").disabled = true;
  aviso("Cargando reservas...");
  try {
    const snap = await getDocs(collection(db, COLECCION));
    state.reservas = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    state.reservas.sort((a, b) => (b.creadoEn?.toMillis?.() || 0) - (a.creadoEn?.toMillis?.() || 0));
    poblarGrupos();
    render();
    aviso(`${state.reservas.length} reservas cargadas.`);
  } catch (error) {
    console.error("Error cargando reservas de rifa:", error);
    aviso("No se pudieron leer las reservas. Revisa las reglas de Firestore y tu sesión.", true);
  } finally {
    state.busy = false;
    $("rifaRecargar").disabled = false;
  }
}

function poblarGrupos() {
  const select = $("rifaGrupo");
  const elegido = select.value;
  select.replaceChildren(new Option("Todos los grupos", ""));
  const mapa = new Map();
  state.reservas.forEach(r => mapa.set(texto(r.idGrupo), `${texto(r.idGrupo)} · ${texto(r.colegio)} · ${texto(r.curso)}`));
  [...mapa].sort((a, b) => a[1].localeCompare(b[1], "es")).forEach(([id, etiqueta]) => select.add(new Option(etiqueta, id)));
  if (mapa.has(elegido)) select.value = elegido;
}

function render() {
  const activas = state.reservas.filter(r => estado(r) === "confirmada");
  $("kpiReservas").textContent = String(activas.length);
  $("kpiAsistentes").textContent = String(activas.reduce((n, r) => n + totalCalculado(r), 0));
  $("kpiGrupos").textContent = String(new Set(activas.map(r => texto(r.idGrupo))).size);
  $("kpiArchivadas").textContent = String(state.reservas.length - activas.length);

  const q = normalizar($("rifaBuscar").value);
  const filtroGrupo = $("rifaGrupo").value;
  const filtroEstado = $("rifaEstado").value;
  const visibles = state.reservas.filter(r => {
    if (filtroGrupo && texto(r.idGrupo) !== filtroGrupo) return false;
    if (filtroEstado !== "todos" && estado(r) !== filtroEstado) return false;
    const busqueda = [r.idGrupo, r.colegio, r.curso, r.contacto?.nombres, r.contacto?.apellidos,
      r.contacto?.telefono, r.contacto?.correo, ...(r.asistentesAdicionales || []).flatMap(p => [p.nombres, p.apellidos])].join(" ");
    return normalizar(busqueda).includes(q);
  });
  $("rifaConteo").textContent = `${visibles.length} reservas visibles · ${visibles.reduce((n, r) => n + (estado(r) === "confirmada" ? totalCalculado(r) : 0), 0)} asistentes activos`;
  const tbody = $("rifaFilas");
  tbody.replaceChildren();
  if (!visibles.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 8;
    td.textContent = "No hay reservas para estos filtros.";
    tr.append(td);
    tbody.append(tr);
    return;
  }
  visibles.forEach(r => {
    const tr = document.createElement("tr");
    const celda = value => {
      const td = document.createElement("td");
      td.textContent = String(value ?? "—");
      tr.append(td);
      return td;
    };
    celda(`${texto(r.colegio)} · ${texto(r.curso)}`);
    celda(r.idGrupo);
    celda(nombre(r.contacto));
    celda(r.contacto?.telefono);
    celda(totalCalculado(r));
    celda(fecha(r.creadoEn));
    const tdEstado = celda("");
    const badge = document.createElement("span");
    badge.className = `rifa-status ${estado(r) === "archivada" ? "archivada" : ""}`;
    badge.textContent = estado(r) === "archivada" ? "Archivada" : "Confirmada";
    tdEstado.append(badge);
    const tdAccion = celda("");
    const boton = document.createElement("button");
    boton.className = "rifa-btn secondary";
    boton.type = "button";
    boton.textContent = "Ver / editar";
    boton.addEventListener("click", () => abrirDetalle(r.id));
    tdAccion.append(boton);
    tbody.append(tr);
  });
}

function abrirDetalle(id) {
  const r = state.reservas.find(item => item.id === id);
  if (!r) return;
  state.actual = r;
  state.ultimaActualizacion = r.actualizadoEn?.toMillis?.() ?? null;
  $("rifaDialogTitulo").textContent = `Reserva · ${r.idGrupo}`;
  $("rifaDialogGrupo").textContent = `${texto(r.colegio)} · ${texto(r.curso)} · ID ${texto(r.idGrupo)} · Registrada ${fecha(r.creadoEn)}${r.archivadoMotivo ? ` · Motivo archivo: ${r.archivadoMotivo}` : ""}`;
  $("rifaDialogEstado").classList.add("rifa-hidden");
  const c = r.contacto || {};
  $("rifaContactoNombres").value = texto(c.nombres);
  $("rifaContactoApellidos").value = texto(c.apellidos);
  $("rifaContactoTelefono").value = texto(c.telefono);
  $("rifaContactoCorreo").value = texto(c.correo);
  $("rifaContactoRelacion").value = RELACIONES[c.relacion] ? c.relacion : "otro";
  $("rifaContactoOtra").value = texto(c.otraRelacion);
  $("rifaContactoAsiste").checked = c.asiste !== false;
  $("rifaPersonas").replaceChildren();
  (Array.isArray(r.asistentesAdicionales) ? r.asistentesAdicionales : []).forEach(agregarPersona);
  $("rifaArchivar").classList.toggle("rifa-hidden", estado(r) === "archivada");
  $("rifaRestaurar").classList.toggle("rifa-hidden", estado(r) !== "archivada");
  actualizarTotalEditado();
  $("rifaOverlay").classList.remove("rifa-hidden");
  $("rifaCerrar").focus();
}

function cerrarDetalle() {
  if (state.busy) return;
  $("rifaOverlay").classList.add("rifa-hidden");
  state.actual = null;
}

function agregarPersona(persona) {
  const bloque = document.createElement("div");
  bloque.className = "rifa-persona";
  const cabecera = document.createElement("div");
  cabecera.className = "rifa-persona-head";
  const titulo = document.createElement("strong");
  titulo.textContent = "Asistente adicional";
  const quitar = document.createElement("button");
  quitar.type = "button";
  quitar.className = "rifa-btn secondary";
  quitar.textContent = "Quitar";
  quitar.addEventListener("click", () => { bloque.remove(); actualizarTotalEditado(); });
  cabecera.append(titulo, quitar);
  const grid = document.createElement("div");
  grid.className = "rifa-grid";
  const campo = (etiqueta, valor, tipo = "text") => {
    const label = document.createElement("label");
    label.className = "rifa-field";
    const span = document.createElement("span");
    span.textContent = etiqueta;
    const input = document.createElement(tipo === "select" ? "select" : "input");
    if (tipo === "select") Object.entries(RELACIONES).forEach(([v, t]) => input.add(new Option(t, v)));
    else input.maxLength = etiqueta.includes("Especificar") ? 80 : 100;
    input.value = texto(valor);
    input.required = !etiqueta.includes("Especificar");
    label.append(span, input);
    grid.append(label);
    return input;
  };
  const nombres = campo("Nombre(s)", persona.nombres);
  const apellidos = campo("Apellidos", persona.apellidos);
  const relacion = campo("Relación", RELACIONES[persona.relacion] ? persona.relacion : "otro", "select");
  const otraRelacion = campo("Especificar si es «Otro»", persona.otraRelacion);
  bloque._campos = { nombres, apellidos, relacion, otraRelacion };
  bloque.append(cabecera, grid);
  $("rifaPersonas").append(bloque);
  actualizarTotalEditado();
}

function actualizarTotalEditado() {
  $("rifaTotalEditado").textContent = `Personas que asistirán: ${$("rifaPersonas").children.length + ($("rifaContactoAsiste").checked ? 1 : 0)}`;
}

function validarNombre(valor, etiqueta, max = 100) {
  const v = texto(valor).replace(/\s+/g, " ");
  if (v.length < 2 || v.length > max) throw new Error(`${etiqueta}: ingresa entre 2 y ${max} caracteres.`);
  return v;
}
function relacionValida(relacion, otra) {
  if (!RELACIONES[relacion]) throw new Error("Selecciona una relación válida.");
  return { relacion, otraRelacion: relacion === "otro" ? validarNombre(otra, "Relación «Otro»", 80) : "" };
}
function leerEdicion() {
  const digitos = $("rifaContactoTelefono").value.replace(/\D/g, "");
  const telefono = /^9\d{8}$/.test(digitos) ? `+56${digitos}` : /^569\d{8}$/.test(digitos) ? `+${digitos}` : "";
  if (!telefono) throw new Error("Ingresa un celular chileno válido.");
  const correo = texto($("rifaContactoCorreo").value).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) throw new Error("Ingresa un correo válido.");
  const contacto = {
    nombres: validarNombre($("rifaContactoNombres").value, "Nombre del contacto"),
    apellidos: validarNombre($("rifaContactoApellidos").value, "Apellidos del contacto"),
    telefono, correo, asiste: $("rifaContactoAsiste").checked,
    ...relacionValida($("rifaContactoRelacion").value, $("rifaContactoOtra").value)
  };
  const asistentesAdicionales = [...$("rifaPersonas").children].map((bloque, i) => {
    const c = bloque._campos;
    return { nombres: validarNombre(c.nombres.value, `Nombre ${i + 1}`), apellidos: validarNombre(c.apellidos.value, `Apellidos ${i + 1}`),
      ...relacionValida(c.relacion.value, c.otraRelacion.value) };
  });
  const totalAsistentes = asistentesAdicionales.length + (contacto.asiste ? 1 : 0);
  if (!totalAsistentes) throw new Error("Debe quedar al menos un asistente.");
  return { contacto, asistentesAdicionales, totalAsistentes };
}

async function guardarDetalle(event) {
  event.preventDefault();
  if (!state.actual || state.busy) return;
  try {
    const cambios = leerEdicion();
    if (JSON.stringify({ contacto: state.actual.contacto, asistentesAdicionales: state.actual.asistentesAdicionales || [], totalAsistentes: totalCalculado(state.actual) }) === JSON.stringify(cambios)) {
      avisoDetalle("No hay cambios para guardar."); return;
    }
    await mutarReserva("edicion", cambios);
  } catch (error) { avisoDetalle(error.message || "No se pudieron guardar los cambios.", true); }
}

async function cambiarArchivo(archivar) {
  if (!state.actual || state.busy) return;
  let motivo = "";
  if (archivar) {
    motivo = prompt("Motivo para archivar esta reserva:", "");
    if (motivo === null) return;
    motivo = texto(motivo);
    if (motivo.length < 5 || motivo.length > 250) return avisoDetalle("Indica un motivo de 5 a 250 caracteres.", true);
  }
  if (!confirm(archivar ? "¿Archivar esta reserva completa y descontar sus asistentes?" : "¿Restaurar esta reserva y volver a contar sus asistentes?")) return;
  try { await mutarReserva(archivar ? "archivo" : "restauracion", { motivo }); }
  catch (error) { avisoDetalle(error.message || "No se pudo cambiar el estado.", true); }
}

async function mutarReserva(tipo, datos) {
  const id = state.actual.id;
  state.busy = true;
  ["rifaGuardar", "rifaArchivar", "rifaRestaurar"].forEach(key => $(key).disabled = true);
  avisoDetalle("Guardando...");
  try {
    const referencia = doc(db, COLECCION, id);
    const historial = doc(collection(db, COLECCION, id, "historial"));
    await runTransaction(db, async tx => {
      const snap = await tx.get(referencia);
      if (!snap.exists()) throw new Error("La reserva ya no existe.");
      const actual = snap.data();
      const versionActual = actual.actualizadoEn?.toMillis?.() ?? null;
      if (versionActual !== state.ultimaActualizacion) throw new Error("Otra persona modificó esta reserva. Recarga antes de editar.");
      const base = { actualizadoEn: serverTimestamp(), actualizadoPor: state.email };
      let cambio;
      if (tipo === "edicion") cambio = { ...base, ...datos };
      else if (tipo === "archivo") {
        if (actual.estado === "archivada") throw new Error("Esta reserva ya está archivada.");
        cambio = { ...base, estado: "archivada", archivadoMotivo: datos.motivo, archivadoEn: serverTimestamp(), archivadoPor: state.email };
      } else {
        if (actual.estado !== "archivada") throw new Error("Esta reserva ya está activa.");
        cambio = { ...base, estado: "confirmada", archivadoMotivo: "", archivadoEn: null, archivadoPor: "" };
      }
      tx.update(referencia, cambio);
      tx.set(historial, {
        tipo, usuario: state.email, fecha: serverTimestamp(),
        anterior: { estado: actual.estado || "confirmada", contacto: actual.contacto || {}, asistentesAdicionales: actual.asistentesAdicionales || [], totalAsistentes: totalCalculado(actual) },
        nuevo: tipo === "edicion" ? datos : { estado: cambio.estado, motivo: datos.motivo || "" }
      });
    });
    $("rifaOverlay").classList.add("rifa-hidden");
    state.actual = null;
    aviso("Cambio guardado correctamente.");
  } finally {
    state.busy = false;
    ["rifaGuardar", "rifaArchivar", "rifaRestaurar"].forEach(key => $(key).disabled = false);
    if (!state.actual) await cargarReservas();
  }
}
