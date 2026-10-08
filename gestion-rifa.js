import { auth } from "./firebase-init.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.7.3/firebase-auth.js";
import { getEffectiveUser } from "./roles.js";
import { waitForLayoutReady } from "./ui.js";

const RIFA_API = "https://southamerica-west1-sist-op-rt.cloudfunctions.net/gestionRifaRaiTrai";
const RELACIONES = { estudiante: "ESTUDIANTE", apoderado: "APODERADO(A)", profesor: "PROFESOR(A)", otro: "OTRO" };
const $ = id => document.getElementById(id);
const texto = v => String(v ?? "").trim();
const mayus = v => texto(v).toLocaleUpperCase("es-CL");
const normalizar = v => texto(v).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const nombre = p => [p?.nombres, p?.apellidos].map(texto).filter(Boolean).join(" ");
const asistentes = r => [...(r.contacto?.asiste === false ? [] : [r.contacto || {}]), ...(r.asistentesAdicionales || [])];
const totalCalculado = r => asistentes(r).length;
const state = { reservas: [], grupos: [], actual: null, nuevo: false, busy: false, usuario: null, solicitudId: "", foco: null };

function fecha(v) {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : new Intl.DateTimeFormat("es-CL", { dateStyle: "short", timeStyle: "short", timeZone: "America/Santiago" }).format(d);
}
function mensaje(id, valor, error = false) {
  const el = $(id);
  el.textContent = mayus(valor);
  el.classList.toggle("rifa-hidden", !valor);
  el.classList.toggle("error", error);
}
function aviso(v, e = false) { mensaje("rifaEstadoCarga", v, e); }
function avisoDetalle(v, e = false) { mensaje("rifaDialogEstado", v, e); }
function bloquear(valor) {
  state.busy = valor;
  ["rifaNueva", "rifaExportar", "rifaRecargar", "rifaGuardar", "rifaArchivar", "rifaRestaurar", "rifaCerrar", "rifaAgregarPersona", "rifaNuevoGrupo", "rifaBuscarNuevoGrupo"].forEach(id => $(id).disabled = valor || !state.usuario);
}
async function solicitar(accion, datos = {}) {
  const user = auth.currentUser;
  if (!user) throw new Error("INICIA SESIÓN PARA CONTINUAR.");
  const efectivo = getEffectiveUser();
  if (!efectivo) throw new Error("TU CUENTA NO TIENE ACCESO A VENTAS.");
  if (accion !== "listar" && efectivo.email !== state.usuario?.email) throw new Error("EL USUARIO DE LA VISTA CAMBIÓ. RECARGA ANTES DE CONTINUAR.");
  const token = await user.getIdToken();
  const respuesta = await fetch(RIFA_API, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ...datos, accion, actuarComo: efectivo.email })
  });
  const resultado = await respuesta.json().catch(() => null);
  if (!respuesta.ok || !resultado?.ok) throw new Error(resultado?.error || "NO SE PUDO CONSULTAR LA GESTIÓN DE RIFA. REVISA EL DESPLIEGUE DEL BACKEND.");
  return resultado;
}
async function cargarReservas() {
  if (state.busy || !auth.currentUser) return;
  bloquear(true);
  aviso("CARGANDO RESERVAS...");
  try {
    const datos = await solicitar("listar");
    state.usuario = datos.usuario;
    state.reservas = datos.reservas.sort((a, b) => (Date.parse(b.creadoEn) || 0) - (Date.parse(a.creadoEn) || 0) || a.id.localeCompare(b.id));
    state.grupos = datos.grupos.sort((a, b) => a.colegio.localeCompare(b.colegio, "es") || a.curso.localeCompare(b.curso, "es", { numeric: true }) || a.anoViaje.localeCompare(b.anoViaje) || a.idGrupo.localeCompare(b.idGrupo));
    $("rifaAlcance").textContent = mayus(state.usuario.rol === "vendedor" ? `GRUPOS DE ${state.usuario.nombre}` : "VISTA GENERAL · TODOS LOS VENDEDORES");
    poblarFiltros();
    render();
    aviso("");
  } catch (error) {
    // No mantener información de una vista anterior si cambia la sesión o el alcance.
    state.reservas = []; state.grupos = []; state.usuario = null;
    render();
    aviso(error.message, true);
  } finally {
    bloquear(false);
    $("rifaRecargar").disabled = !auth.currentUser;
  }
}
function opciones(id, mapa, inicial, ordenar = true) {
  const select = $(id), elegido = select.value;
  select.replaceChildren(new Option(inicial, ""));
  const entradas = [...mapa];
  if (ordenar) entradas.sort((a, b) => a[1].localeCompare(b[1], "es", { numeric: true }));
  entradas.forEach(([valor, etiqueta]) => select.add(new Option(mayus(etiqueta), valor)));
  if (mapa.has(elegido)) select.value = elegido;
}
function claveVendedor(r) { return texto(r.vendedoraCorreo) || `nombre:${normalizar(r.vendedora)}`; }
function poblarFiltros() {
  opciones("rifaVendedor", new Map(state.reservas.map(r => [claveVendedor(r), r.vendedora])), "TODOS LOS VENDEDORES");
  opciones("rifaAno", new Map(state.reservas.filter(r => r.anoViaje).map(r => [r.anoViaje, r.anoViaje])), "TODOS LOS AÑOS");
  opciones("rifaGrupo", new Map(state.reservas.map(r => [r.idGrupo, `${r.idGrupo} · ${r.colegio} · ${r.curso} · ${r.anoViaje}`])), "TODOS LOS GRUPOS");
  $("rifaVendedor").classList.toggle("rifa-hidden", state.usuario?.rol === "vendedor");
}
function reservasBaseFiltradas() {
  const q = normalizar($("rifaBuscar").value);
  return state.reservas.filter(r => {
    if ($("rifaGrupo").value && r.idGrupo !== $("rifaGrupo").value) return false;
    if ($("rifaAno").value && r.anoViaje !== $("rifaAno").value) return false;
    if ($("rifaVendedor").value && claveVendedor(r) !== $("rifaVendedor").value) return false;
    return normalizar([r.idGrupo, r.colegio, r.curso, r.anoViaje, r.vendedora, nombre(r.contacto), r.contacto?.telefono, r.contacto?.correo, ...(r.asistentesAdicionales || []).map(nombre)].join(" ")).includes(q);
  });
}
function reservasVisibles() {
  const filtro = $("rifaEstado").value;
  return reservasBaseFiltradas().filter(r => filtro === "todos" || r.estado === filtro);
}
function render() {
  // KPI del alcance y filtros de búsqueda/grupo/año/vendedor, independientes del selector de estado.
  const base = reservasBaseFiltradas(), activas = base.filter(r => r.estado === "confirmada");
  $("kpiReservas").textContent = activas.length;
  $("kpiAsistentes").textContent = activas.reduce((n, r) => n + totalCalculado(r), 0);
  $("kpiGrupos").textContent = new Set(activas.map(r => r.idGrupo)).size;
  $("kpiArchivadas").textContent = base.length - activas.length;
  const tbody = $("rifaFilas"); tbody.replaceChildren();
  const visibles = reservasVisibles();
  if (!visibles.length) {
    const tr = document.createElement("tr"), td = document.createElement("td");
    td.colSpan = 12; td.textContent = "NO HAY RESERVAS PARA ESTOS FILTROS."; tr.append(td); tbody.append(tr); return;
  }
  visibles.forEach((r, indice) => {
    const tr = document.createElement("tr");
    const celda = v => { const td = document.createElement("td"); td.textContent = mayus(v) || "—"; tr.append(td); return td; };
    celda(indice + 1); celda(`${r.colegio} · ${r.curso}`); celda(r.idGrupo); celda(r.anoViaje);
    celda(r.vendedora); celda(nombre(r.contacto)); celda(r.contacto?.telefono);
    const nombres = celda(asistentes(r).map((p, i) => `${i + 1}. ${nombre(p)} · ${RELACIONES[p.relacion] || "OTRO"}${p.relacion === "otro" && p.otraRelacion ? `: ${p.otraRelacion}` : ""}`).join("\n"));
    nombres.className = "nombres";
    celda(totalCalculado(r)); celda(fecha(r.creadoEn));
    const tdEstado = celda(""); tdEstado.replaceChildren();
    const badge = document.createElement("span"); badge.className = `rifa-status ${r.estado === "archivada" ? "archivada" : ""}`;
    badge.textContent = r.estado === "archivada" ? "ARCHIVADA" : "CONFIRMADA"; tdEstado.append(badge);
    const tdAccion = celda(""); tdAccion.replaceChildren();
    const boton = document.createElement("button"); boton.type = "button"; boton.className = "rifa-btn"; boton.textContent = "VER / EDITAR";
    boton.addEventListener("click", () => { if (!state.busy) abrirDetalle(r.id); }); tdAccion.append(boton); tbody.append(tr);
  });
}
function mostrarModal() {
  if ($("rifaOverlay").classList.contains("rifa-hidden")) state.foco = document.activeElement;
  $("rifaOverlay").classList.remove("rifa-hidden");
  document.body.style.overflow = "hidden";
  $("rifaCerrar").focus();
}
function cerrarDetalle() {
  if (state.busy) return;
  $("rifaOverlay").classList.add("rifa-hidden"); document.body.style.overflow = "";
  state.actual = null; state.nuevo = false;
  state.foco?.focus?.();
}
function llenarFormulario(r = {}) {
  const c = r.contacto || {};
  $("rifaEditarForm").reset();
  $("rifaContactoNombres").value = mayus(c.nombres); $("rifaContactoApellidos").value = mayus(c.apellidos);
  $("rifaContactoTelefono").value = texto(c.telefono); $("rifaContactoCorreo").value = texto(c.correo);
  $("rifaContactoRelacion").value = RELACIONES[c.relacion] ? c.relacion : "apoderado";
  $("rifaContactoOtra").value = mayus(c.otraRelacion); $("rifaContactoAsiste").checked = c.asiste !== false;
  $("rifaPersonas").replaceChildren(); (r.asistentesAdicionales || []).forEach(agregarPersona);
  avisoDetalle(""); actualizarTotalEditado();
}
function abrirDetalle(id) {
  const r = state.reservas.find(r => r.id === id); if (!r || state.busy) return;
  state.actual = r; state.nuevo = false;
  llenarFormulario(r);
  $("rifaSeleccionGrupo").classList.add("rifa-hidden"); $("rifaNuevoGrupo").required = false;
  $("rifaDialogTitulo").textContent = `RESERVA · ${r.idGrupo}`;
  $("rifaDialogGrupo").textContent = mayus(`${r.colegio} · ${r.curso} · AÑO ${r.anoViaje || "—"} · VENDEDOR ${r.vendedora} · REGISTRADA ${fecha(r.creadoEn)}${r.archivadoMotivo ? ` · MOTIVO DE ARCHIVO: ${r.archivadoMotivo}` : ""}`);
  $("rifaGuardar").textContent = "GUARDAR CAMBIOS";
  $("rifaArchivar").classList.toggle("rifa-hidden", r.estado === "archivada");
  $("rifaRestaurar").classList.toggle("rifa-hidden", r.estado !== "archivada"); mostrarModal();
}
function abrirNueva() {
  if (state.busy || !state.usuario) return;
  if (!state.grupos.length) return aviso("NO HAY GRUPOS GANADA DISPONIBLES PARA TU USUARIO.", true);
  state.actual = null; state.nuevo = true; state.solicitudId = crypto.randomUUID();
  llenarFormulario(); $("rifaBuscarNuevoGrupo").value = "";
  $("rifaNuevoGrupo").replaceChildren(new Option("SELECCIONA UN GRUPO", ""));
  poblarNuevosGrupos(); $("rifaSeleccionGrupo").classList.remove("rifa-hidden"); $("rifaNuevoGrupo").required = true;
  $("rifaDialogTitulo").textContent = "AGREGAR RESERVA"; $("rifaDialogGrupo").textContent = "SELECCIONA UN GRUPO GANADA DE CUALQUIER AÑO.";
  $("rifaGuardar").textContent = "CREAR RESERVA";
  $("rifaArchivar").classList.add("rifa-hidden"); $("rifaRestaurar").classList.add("rifa-hidden"); mostrarModal();
}
function poblarNuevosGrupos() {
  const q = normalizar($("rifaBuscarNuevoGrupo").value), elegido = $("rifaNuevoGrupo").value;
  const grupos = state.grupos.filter(g => g.idGrupo === elegido || normalizar(`${g.idGrupo} ${g.colegio} ${g.curso} ${g.anoViaje} ${g.vendedora}`).includes(q));
  opciones("rifaNuevoGrupo", new Map(grupos.map(g => [g.idGrupo, `${g.idGrupo} · ${g.colegio} · ${g.curso} · ${g.anoViaje} · ${g.vendedora}`])), "SELECCIONA UN GRUPO", false);
}
function seleccionarNuevoGrupo() {
  const g = state.grupos.find(g => g.idGrupo === $("rifaNuevoGrupo").value);
  if (!g) { $("rifaDialogGrupo").textContent = "SELECCIONA UN GRUPO."; return; }
  const existente = state.reservas.find(r => r.idGrupo === g.idGrupo && r.estado === "confirmada");
  if (existente) { abrirDetalle(existente.id); avisoDetalle("EL GRUPO YA TIENE ESTA RESERVA ACTIVA. PUEDES EDITARLA O AGREGAR ASISTENTES."); return; }
  $("rifaDialogGrupo").textContent = mayus(`${g.colegio} · ${g.curso} · ID ${g.idGrupo} · AÑO ${g.anoViaje} · VENDEDOR ${g.vendedora}`);
}
function agregarPersona(p = {}) {
  if ($("rifaPersonas").children.length >= 20) return avisoDetalle("MÁXIMO 20 ASISTENTES ADICIONALES.", true);
  const bloque = document.createElement("div"); bloque.className = "rifa-persona";
  const head = document.createElement("div"); head.className = "rifa-persona-head";
  const titulo = document.createElement("strong"); titulo.textContent = "ASISTENTE ADICIONAL";
  const quitar = document.createElement("button"); quitar.type = "button"; quitar.className = "rifa-btn secondary"; quitar.textContent = "QUITAR";
  quitar.addEventListener("click", () => { if (!state.busy) { bloque.remove(); actualizarTotalEditado(); } }); head.append(titulo, quitar);
  const grid = document.createElement("div"); grid.className = "rifa-grid";
  function campo(etiqueta, valor, selector = false, requerido = true) {
    const label = document.createElement("label"); label.className = "rifa-field";
    const span = document.createElement("span"); span.textContent = etiqueta;
    const input = document.createElement(selector ? "select" : "input");
    if (selector) Object.entries(RELACIONES).forEach(([v, t]) => input.add(new Option(t, v)));
    else input.maxLength = requerido ? 100 : 80;
    input.value = selector ? valor : mayus(valor); input.required = requerido;
    label.append(span, input); grid.append(label); return input;
  }
  bloque._campos = {
    nombres: campo("NOMBRE(S)", p.nombres), apellidos: campo("APELLIDOS", p.apellidos),
    relacion: campo("RELACIÓN", RELACIONES[p.relacion] ? p.relacion : "apoderado", true),
    otraRelacion: campo("ESPECIFICAR SI ES OTRO", p.otraRelacion, false, false)
  };
  bloque.append(head, grid); $("rifaPersonas").append(bloque); actualizarTotalEditado();
}
function actualizarTotalEditado() { $("rifaTotalEditado").textContent = `PERSONAS QUE ASISTIRÁN: ${$("rifaPersonas").children.length + ($("rifaContactoAsiste").checked ? 1 : 0)}`; }
function validarNombre(v, etiqueta, max = 100) {
  const limpio = mayus(v).replace(/\s+/g, " ");
  if (limpio.length < 2 || limpio.length > max) throw new Error(`${etiqueta}: INGRESA ENTRE 2 Y ${max} CARACTERES.`);
  return limpio;
}
function relacionValida(relacion, otra) {
  if (!RELACIONES[relacion]) throw new Error("SELECCIONA UNA RELACIÓN VÁLIDA.");
  return { relacion, otraRelacion: relacion === "otro" ? validarNombre(otra, "RELACIÓN OTRO", 80) : "" };
}
function leerEdicion() {
  const digitos = $("rifaContactoTelefono").value.replace(/\D/g, "");
  const telefono = /^9\d{8}$/.test(digitos) ? `+56${digitos}` : /^569\d{8}$/.test(digitos) ? `+${digitos}` : "";
  if (!telefono) throw new Error("INGRESA UN CELULAR CHILENO VÁLIDO.");
  const correo = texto($("rifaContactoCorreo").value).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) throw new Error("INGRESA UN CORREO VÁLIDO.");
  const contacto = {
    nombres: validarNombre($("rifaContactoNombres").value, "NOMBRE DEL CONTACTO"), apellidos: validarNombre($("rifaContactoApellidos").value, "APELLIDOS DEL CONTACTO"),
    telefono, correo, asiste: $("rifaContactoAsiste").checked,
    ...relacionValida($("rifaContactoRelacion").value, $("rifaContactoOtra").value)
  };
  const asistentesAdicionales = [...$("rifaPersonas").children].map((bloque, i) => {
    const c = bloque._campos;
    return { nombres: validarNombre(c.nombres.value, `NOMBRE ${i + 1}`), apellidos: validarNombre(c.apellidos.value, `APELLIDOS ${i + 1}`), ...relacionValida(c.relacion.value, c.otraRelacion.value) };
  });
  const personas = asistentes({ contacto, asistentesAdicionales });
  if (!personas.length) throw new Error("DEBE QUEDAR AL MENOS UN ASISTENTE.");
  const claves = personas.map(p => normalizar(nombre(p)));
  if (new Set(claves).size !== claves.length) throw new Error("HAY UNA PERSONA REPETIDA EN LA RESERVA.");
  return { contacto, asistentesAdicionales };
}
async function guardarDetalle(event) {
  event.preventDefault(); if (state.busy || (!state.nuevo && !state.actual)) return;
  try {
    const datos = leerEdicion();
    if (state.nuevo && !$("rifaNuevoGrupo").value) throw new Error("SELECCIONA UN GRUPO.");
    await mutarReserva(state.nuevo ? "crear" : "editar", datos);
  } catch (error) { avisoDetalle(error.message, true); }
}
async function cambiarArchivo(archivar) {
  if (!state.actual || state.busy) return;
  let motivo = "";
  if (archivar) {
    const respuesta = prompt("MOTIVO PARA ARCHIVAR ESTA RESERVA:", ""); if (respuesta === null) return;
    motivo = mayus(respuesta);
    if (motivo.length < 5 || motivo.length > 250) return avisoDetalle("INDICA UN MOTIVO DE 5 A 250 CARACTERES.", true);
  }
  if (!confirm(archivar ? "¿ARCHIVAR LA RESERVA Y DESCONTAR SUS ASISTENTES?" : "¿RESTAURAR LA RESERVA Y VOLVER A CONTAR SUS ASISTENTES?")) return;
  try { await mutarReserva(archivar ? "archivar" : "restaurar", { motivo }); }
  catch (error) { avisoDetalle(error.message, true); }
}
async function mutarReserva(accion, datos) {
  bloquear(true); avisoDetalle("GUARDANDO...");
  let guardado = false;
  try {
    await solicitar(accion, {
      ...datos, idGrupo: state.nuevo ? $("rifaNuevoGrupo").value : state.actual?.idGrupo,
      reservaId: state.actual?.id, version: state.actual?.version, solicitudId: state.solicitudId
    });
    guardado = true;
  } finally { bloquear(false); }
  if (guardado) { cerrarDetalle(); await cargarReservas(); }
}
function exportarExcel() {
  if (state.busy || !state.usuario) return;
  if (!window.XLSX) return aviso("NO SE CARGÓ LA LIBRERÍA DE EXCEL. RECARGA LA PÁGINA.", true);
  const visibles = reservasVisibles();
  if (!visibles.length) return aviso("NO HAY RESERVAS PARA EXPORTAR CON ESTOS FILTROS.", true);
  const cabecera = ["N.º", "N.º RESERVA", "IDGRUPO", "COLEGIO", "CURSO", "AÑO VIAJE", "VENDEDOR", "ASISTENTE", "RELACIÓN", "CONTACTO", "CELULAR", "CORREO", "ESTADO", "REGISTRADA", "ORIGEN"];
  const filas = [];
  visibles.forEach((r, i) => asistentes(r).forEach(p => filas.push([
    filas.length + 1, i + 1, r.idGrupo, mayus(r.colegio), mayus(r.curso), r.anoViaje,
    mayus(r.vendedora), mayus(nombre(p)), mayus(p.relacion === "otro" ? p.otraRelacion || "OTRO" : RELACIONES[p.relacion] || p.relacion),
    mayus(nombre(r.contacto)), texto(r.contacto?.telefono), mayus(r.contacto?.correo),
    r.estado === "archivada" ? "ARCHIVADA" : "CONFIRMADA", fecha(r.creadoEn), mayus(r.origen)
  ])));
  const hoja = XLSX.utils.aoa_to_sheet([cabecera, ...filas]);
  hoja["!cols"] = [6, 12, 12, 40, 16, 12, 24, 35, 24, 35, 20, 35, 16, 22, 12].map(wch => ({ wch }));
  hoja["!autofilter"] = { ref: hoja["!ref"] };
  const libro = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(libro, hoja, "ASISTENTES");
  const resumen = XLSX.utils.aoa_to_sheet([
    ["RIFA RAI TRAI 2026", "17 DE OCTUBRE · CLUB PROVIDENCIA"],
    ["USUARIO DE LA VISTA", mayus(state.usuario.nombre)],
    ["ESTADO EXPORTADO", mayus($("rifaEstado").selectedOptions[0].textContent)],
    ["BÚSQUEDA", mayus($("rifaBuscar").value)],
    ["VENDEDOR", mayus($("rifaVendedor").value ? $("rifaVendedor").selectedOptions[0].textContent : state.usuario.rol === "vendedor" ? state.usuario.nombre : "TODOS")],
    ["AÑO", $("rifaAno").value || "TODOS"],
    ["GRUPO", $("rifaGrupo").value || "TODOS"],
    ["RESERVAS EXPORTADAS", visibles.length], ["ASISTENTES EXPORTADOS", filas.length],
    ["GENERADO", fecha(new Date().toISOString())]
  ]);
  resumen["!cols"] = [{ wch: 28 }, { wch: 70 }]; XLSX.utils.book_append_sheet(libro, resumen, "RESUMEN");
  const dia = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Santiago" }).format(new Date());
  XLSX.writeFile(libro, `RIFA_RAI_TRAI_2026_${dia}.xlsx`);
}
async function init() {
  await waitForLayoutReady();
  $("rifaRecargar").addEventListener("click", cargarReservas);
  $("rifaNueva").addEventListener("click", abrirNueva); $("rifaExportar").addEventListener("click", exportarExcel);
  $("rifaBuscar").addEventListener("input", render);
  ["rifaGrupo", "rifaVendedor", "rifaAno", "rifaEstado"].forEach(id => $(id).addEventListener("change", render));
  $("rifaLimpiar").addEventListener("click", () => {
    ["rifaBuscar", "rifaGrupo", "rifaVendedor", "rifaAno"].forEach(id => $(id).value = ""); $("rifaEstado").value = "confirmada"; render();
  });
  $("rifaCerrar").addEventListener("click", cerrarDetalle);
  $("rifaOverlay").addEventListener("click", e => { if (e.target === $("rifaOverlay")) cerrarDetalle(); });
  document.addEventListener("keydown", e => {
    if ($("rifaOverlay").classList.contains("rifa-hidden")) return;
    if (e.key === "Escape") cerrarDetalle();
    if (e.key === "Tab") {
      const elementos = [...$("rifaOverlay").querySelectorAll("button, input, select")].filter(el => !el.disabled && el.getClientRects().length);
      const primero = elementos[0], ultimo = elementos.at(-1);
      if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo?.focus(); }
      else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero?.focus(); }
    }
  });
  $("rifaBuscarNuevoGrupo").addEventListener("input", poblarNuevosGrupos); $("rifaNuevoGrupo").addEventListener("change", seleccionarNuevoGrupo);
  $("rifaAgregarPersona").addEventListener("click", () => { if (!state.busy) agregarPersona(); });
  $("rifaContactoAsiste").addEventListener("change", actualizarTotalEditado);
  $("rifaEditarForm").addEventListener("submit", guardarDetalle);
  $("rifaArchivar").addEventListener("click", () => cambiarArchivo(true)); $("rifaRestaurar").addEventListener("click", () => cambiarArchivo(false));
  onAuthStateChanged(auth, user => {
    if (!user) { state.usuario = null; state.reservas = []; state.grupos = []; render(); bloquear(false); location.replace("login.html"); return; }
    cargarReservas();
  });
}
init().catch(error => { console.error(error); aviso("NO SE PUDO INICIAR LA PÁGINA. RECARGA PARA CONTINUAR.", true); });
