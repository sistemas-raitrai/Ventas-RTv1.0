import {
  auth, db, puedeVerGeneral, normalizeEmail, getVentasUser
} from "./firebase-init.js";
import {
  ACTING_USER_KEY, getRealUser, getEffectiveUser
} from "./roles.js";
import {
  bindLayoutButtons, waitForLayoutReady
} from "./ui.js";
import {
  crearInscripcionesManager, camposPasajero, esPersonaViajeraConteo
} from "./inscripciones-manager.js";
import {
  collection, getDocs, query, where
} from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";
import {
  onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/11.7.3/firebase-auth.js";
import {
  getFunctions, httpsCallable
} from "https://www.gstatic.com/firebasejs/11.7.3/firebase-functions.js";

const api = httpsCallable(
  getFunctions(auth.app, "southamerica-west1"),
  "buzonCorreoApi",
  { timeout: 180000 }
);

const $ = id => document.getElementById(id);
const texto = value => String(value ?? "").trim();
const normalizar = value => texto(value).normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "").toLowerCase();
const correoValido = value => /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(value);
const tipos = {
  estudiante: "estudiantes",
  adulto_acompanante: "adultos",
  profesor: "profesores"
};

const filtrosNomina = ["fNombreDocumento", "fInteres", "fCercanos", "fNacionalidad", "fPaisDestino", "fAutorizaEncargado"];

const state = {
  real: null,
  efectivo: null,
  correo: "",
  puedeVerTodo: false,
  manager: null,
  grupos: [],
  personas: [],
  nominasCargadas: new Set(),
  estadisticas: new Map(),
  libroCodigos: null,
  codigos: [],
  versionExcel: 0,
  cargandoExcel: false,
  revision: null,
  grupoSinEnvio: "",
  gruposMarcados: new Set(),
  personasMarcadas: new Set(),
  imagen: "",
  versionImagen: 0,
  cargandoImagen: false,
  borrador: null,
  ocupado: false,
  autorizado: false,
  version: 0
};

async function llamar(accion, datos = {}) {
  const respuesta = await api({ ...datos, accion });
  return respuesta.data;
}

function informar(mensaje, esError = false) {
  $("mensaje").textContent = mensaje;
  $("mensaje").classList.toggle("error", esError);
}

function mostrarError(error) {
  informar(error.message || "Ocurrió un error.", true);
  $("mensaje").scrollIntoView({ block: "nearest" });
}

function evento(id, ejecutar) {
  const boton = $(id);
  boton.addEventListener("click", async () => {
    if (!state.autorizado || state.ocupado) return;

    state.ocupado = true;
    boton.disabled = true;
    const version = state.version;

    try {
      await ejecutar(version);
    } catch (error) {
      if (version === state.version && state.autorizado) mostrarError(error);
    } finally {
      state.ocupado = false;
      boton.disabled = false;
      $("enviar").textContent = state.borrador ? "Continuar preparación" : "Revisar envío";
    }
  });
}

function fechaISO(value) {
  if (!value) return "";

  if (typeof value === "string") {
    const iso = value.match(/^\d{4}-\d{2}-\d{2}(?=$|T|\s)/);
    if (iso) return iso[0];

    const local = value.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);
    return local ? `${local[3]}-${local[2]}-${local[1]}` : "";
  }

  const date = typeof value.toDate === "function" ? value.toDate() : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";

  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);

  const parte = tipo => partes.find(item => item.type === tipo)?.value;
  return `${parte("year")}-${parte("month")}-${parte("day")}`;
}

function filaSeleccion(panel, etiqueta, checked, disabled, cambiar) {
  const fila = document.createElement("label");
  fila.className = "buzon-fila";

  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  input.disabled = disabled;
  input.onchange = () => cambiar(input.checked);

  fila.append(input, ` ${etiqueta}`);
  panel.append(fila);
}

function marcar(set, id, checked) {
  if (checked) set.add(id);
  else set.delete(id);
}

function grupoPermitido(grupo) {
  if (state.puedeVerTodo) return true;

  const nombre = normalizar([state.efectivo?.nombre, state.efectivo?.apellido]
    .filter(Boolean).join(" "));

  return !!state.correo && grupo.vendedoraCorreo === state.correo ||
    !!nombre && normalizar(grupo.vendedora).includes(nombre);
}

function gruposVisibles() {
  const term = normalizar($("buscarGrupo").value);
  const destino = $("destino").value;
  const desde = $("desde").value;
  const hasta = $("hasta").value;

  return state.grupos.filter(g =>
    (!term || normalizar(`${g.nombre} ${g.id} ${g.negocio}`).includes(term)) &&
    (!destino || normalizar(g.destino) === destino) &&
    (!desde || (g.fecha && g.fecha >= desde)) &&
    (!hasta || (g.fecha && g.fecha <= hasta))
  );
}

function renderGrupos() {
  const panel = $("grupos");
  panel.replaceChildren();
  const visibles = gruposVisibles();

  for (const g of visibles) {
    const stats = state.estadisticas.get(g.id);
    const total = stats ? `${stats.total} confirmados` :
      g.totalResumen !== null ? `${g.totalResumen} confirmados (resumen)` : "Total por cargar";
    const sinEnvio = stats ? `${stats.sinEnvio} sin envío` : "Contactos por revisar";
    const etiqueta = [g.id, g.nombre, g.negocio, g.destino, g.fecha || "Sin fecha", total, sinEnvio]
      .filter(Boolean).join(" · ");

    filaSeleccion(panel, etiqueta, state.gruposMarcados.has(g.id), false, checked => {
      marcar(state.gruposMarcados, g.id, checked);
      renderPersonas();
      renderGrupos();
    });
    if (stats?.sinEnvio && state.gruposMarcados.has(g.id)) {
      const boton = document.createElement("button");
      boton.type = "button";
      boton.className = "buzon-enlace";
      boton.textContent = `Ver personas sin envío del grupo ${g.id}`;
      boton.onclick = () => abrirSinEnvio(g.id);
      panel.append(boton);
    }
  }

  renderResumenGrupos(visibles.length);
}

function renderResumenGrupos(visibles = gruposVisibles().length) {
  $("cuentaGrupos").textContent = state.gruposMarcados.size ? `· ${state.gruposMarcados.size} seleccionados` : "";
  $("resumenGrupos").textContent =
    `${state.gruposMarcados.size} seleccionados · ${visibles} visibles de ${state.grupos.length}.`;
}

async function cargarGrupos(version = state.version) {
  const ano = Number($("ano").value);
  if (!Number.isInteger(ano) || ano < 2020 || ano > 2100) {
    throw new Error("Ingresa un año válido.");
  }

  informar(`Cargando grupos ${ano}…`);
  const snap = await getDocs(query(
    collection(db, "ventas_grupos_resumen"),
    where("anoViaje", "==", ano)
  ));
  if (version !== state.version) return;

  state.grupos = snap.docs.flatMap(documento => {
    const g = documento.data();
    if (normalizar(g.estado || g.estadoComercial) !== "ganada") return [];

    return [{
      id: texto(g.idGrupo || documento.id),
      docId: texto(g.groupDocId || documento.id),
      nombre: texto(g.aliasGrupo || [g.colegio, g.curso].filter(Boolean).join(" ") || documento.id),
      negocio: texto(g.numeroNegocio || g.negocioId),
      colegio: texto(g.colegio),
      curso: texto(g.curso),
      destino: texto(g.destinoPrincipal || g.destino),
      fecha: fechaISO(g.fechaInicio || g.fechaSalida),
      totalResumen: g.totalViajan == null || !Number.isFinite(Number(g.totalViajan))
        ? null : Number(g.totalViajan),
      vendedora: texto(g.vendedora || g.vendedoraCorreo),
      vendedoraCorreo: normalizeEmail(g.vendedoraCorreo || "")
    }];
  }).filter(grupoPermitido).sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

  const destinos = new Map(state.grupos.filter(g => g.destino)
    .map(g => [normalizar(g.destino), g.destino]));
  const destino = $("destino");
  destino.replaceChildren(new Option("Todos", ""));

  for (const [key, label] of [...destinos].sort((a, b) => a[1].localeCompare(b[1], "es"))) {
    destino.add(new Option(label, key));
  }

  state.gruposMarcados.clear();
  state.personasMarcadas.clear();
  state.personas = [];
  state.nominasCargadas.clear();
  state.estadisticas.clear();
  renderGrupos();
  renderPersonas();
  informar(`${state.grupos.length} grupos ganados cargados para ${ano}.`);
}

function nombreContacto(contacto) {
  return texto(contacto.nombre || contacto.nombreCompleto ||
    [contacto.nombres, contacto.primerApellido, contacto.segundoApellido].filter(Boolean).join(" "));
}

async function cargarPersonas(version) {
  const seleccion = state.grupos.filter(g => state.gruposMarcados.has(g.id));
  if (!seleccion.length) throw new Error("Selecciona al menos un grupo.");

  const manager = state.manager;
  const cargadas = new Map();
  const gruposCargados = new Set();
  const fallidos = [];

  for (let i = 0; i < seleccion.length; i += 6) {
    if (version !== state.version) return;

    const lote = seleccion.slice(i, i + 6);
    informar(`Cargando nóminas ${i + 1}–${i + lote.length} de ${seleccion.length}…`);

    const resultados = await Promise.allSettled(lote.map(async g => {
      const grupo = await manager.resolverGrupo(g.id);
      if (!grupo) throw new Error(`Grupo ${g.id} no encontrado.`);

      return (await manager.cargarNomina(grupo, { completa: true }))
        .filter(p => esPersonaViajeraConteo(p))
        .map((p, index) => {
          const tipo = normalizar(p.tipoViajante || p.tipoParticipacion).replace(/\s+/g, "_");

          const identificacion = p.identificacion || {};
          const contacto = p.contactoPrincipal || {};
          const nombre = texto(identificacion.nombreCompleto ||
            [camposPasajero.nombres(p), camposPasajero.apellidos(p)].filter(Boolean).join(" "));


          const documento = normalizar(camposPasajero.documento(p)).replace(/[^a-z0-9]/g, "");
          const identidad = documento && !["sinrut", "sindocumento"].includes(documento)
            ? documento
            : p.id || `sin-identificador-${index + 1}`;

          return {
            id: `${g.docId}:${identidad}`,
            idGrupo: g.id,
            tipo,
            nombre: nombre || "Viajero sin nombre",
            identificable: !!p.id && !!nombre,
            grupo: g.nombre,
            destino: g.destino,
            colegio: g.colegio || texto(grupo.colegio),
            curso: g.curso || texto(grupo.curso),
            fechaSalida: (g.fecha || fechaISO(grupo.fechaInicio || grupo.fechaSalida)).split("-").reverse().join("/"),
            nacionalidad: [identificacion.nacionalidadBase, identificacion.nacionalidadDetalle,
              identificacion.nacionalidad].map(normalizar).filter(Boolean).join(" "),
            coincideDocumento: p.documentoIdentidad?.nombreCoincideDocumento,
            interes: tipo === "profesor" ? p.profesor?.interesConoceRaitrai : p.adultoAcompanante?.interesConoceRaitrai,
            cercanos: p.adultoAcompanante?.acompananteTieneHijosViaje,
            nacionalidadDestino: p.documentacion?.nacionalidadPaisDestino,
            autorizaEncargado: p.consentimiento?.autorizaApoderadoCoordinador,
            correoViajero: identificacion.correoViajante,
            correoResponsable: contacto.correo,
            responsable: nombreContacto(contacto),
            autorizado: identificacion.autorizaCorreosPreviosPersonaQueViaja === true
          };
        });
    }));

    resultados.forEach((resultado, index) => {
      if (resultado.status === "rejected") {
        fallidos.push(lote[index].id);
        return;
      }

      gruposCargados.add(lote[index].id);
      for (const persona of resultado.value) {
        if (!cargadas.has(persona.id)) cargadas.set(persona.id, persona);
      }
    });
  }

  if (version !== state.version) return;
  state.nominasCargadas = gruposCargados;
  state.personas = [...cargadas.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  state.personasMarcadas.clear();
  renderPersonas();
  renderGrupos();

  informar(
    fallidos.length
      ? `${state.personas.length} viajeros cargados. Grupos con error: ${fallidos.join(", ")}.`
      : `${state.personas.length} viajeros confirmados cargados.`,
    !!fallidos.length
  );
}

function destinatario(persona) {
  if (!persona.identificable) return { email: "", motivo: "Falta nombre o identificación" };
  if (!Object.hasOwn(tipos, persona.tipo)) return { email: "", motivo: "Tipo de viajero sin clasificar" };
  const esEstudiante = persona.tipo === "estudiante";
  const responsable = esEstudiante && $("rutaEstudiante").value === "responsable";

  if (esEstudiante && !responsable && !persona.autorizado) {
    return { email: "", motivo: "Sin autorización de correo directo" };
  }

  const email = normalizeEmail(texto(responsable ? persona.correoResponsable : persona.correoViajero));
  if (!email) return { email: "", motivo: responsable ? "Sin correo del responsable principal" : "Sin correo del viajero" };
  if (!correoValido(email)) return { email: "", motivo: "Correo inválido" };

  return {
    email,
    nombreDestinatario: responsable ? persona.responsable : persona.nombre
  };
}

function respuestaNomina(valor) {
  const v = normalizar(valor);
  if (["true", "si"].includes(v)) return "si";
  if (["false", "no"].includes(v)) return "no";
  return v === "prefiere_no" ? v : "sin";
}

function coincideFiltrosNomina(p) {
  const distinto = respuestaNomina(p.coincideDocumento);
  const estadoNombre = distinto === "no" ? "si" : distinto === "si" ? "no" : "sin";
  const interes = $("fInteres").value;
  const cercanos = $("fCercanos").value;
  const nacionalidad = normalizar($("fNacionalidad").value);
  const filtroNombre = $("fNombreDocumento").value;
  const filtroPais = $("fPaisDestino").value;
  const filtroEncargado = $("fAutorizaEncargado").value;

  return (!filtroNombre || estadoNombre === filtroNombre) &&
    (!interes || (p.tipo === interes && respuestaNomina(p.interes) === "si")) &&
    (!cercanos || (p.tipo === "adulto_acompanante" && respuestaNomina(p.cercanos) === cercanos)) &&
    (!nacionalidad || p.nacionalidad.includes(nacionalidad)) &&
    (!filtroPais || respuestaNomina(p.nacionalidadDestino) === filtroPais) &&
    (!filtroEncargado || respuestaNomina(p.autorizaEncargado) === filtroEncargado);
}

function tipoIncluido(p) {
  return !Object.hasOwn(tipos, p.tipo) || !!$(tipos[p.tipo])?.checked;
}

function personaEnGruposYTipos(persona) {
  return state.gruposMarcados.has(persona.idGrupo) &&
    tipoIncluido(persona) && coincideFiltrosNomina(persona);
}

function personasVisibles() {
  const term = normalizar($("buscarPersona").value);
  return state.personas.filter(p =>
    personaEnGruposYTipos(p) &&
    normalizar(`${p.nombre} ${p.grupo} ${p.idGrupo} ${destinatario(p).email}`).includes(term)
  );
}

function seleccionActual() {
  return state.personas
    .filter(p => personaEnGruposYTipos(p) && state.personasMarcadas.has(p.id))
    .flatMap(p => {
      const contacto = destinatario(p);
      if (!contacto.email) return [];

      return [{
        id: p.id,
        nombre: p.nombre,
        grupo: p.grupo,
        destino: p.destino,
        email: contacto.email,
        nombreDestinatario: contacto.nombreDestinatario,
        nombreEstudiante: p.tipo === "estudiante" ? p.nombre : "",
        colegio: p.colegio,
        curso: p.curso,
        fechaSalida: p.fechaSalida
      }];
    });
}

function renderPersonas() {
  const panel = $("personas");
  panel.replaceChildren();

  for (const p of personasVisibles()) {
    const contacto = destinatario(p);
    filaSeleccion(
      panel,
      `${p.nombre} · ${p.grupo} · ${contacto.email || contacto.motivo}`,
      state.personasMarcadas.has(p.id) && !!contacto.email,
      !contacto.email,
      checked => {
        marcar(state.personasMarcadas, p.id, checked);
        renderResumenPersonas();
      }
    );
  }

  renderResumenPersonas();
}

function personasSinEnvio() {
  return state.personas.filter(persona => state.gruposMarcados.has(persona.idGrupo) &&
    personaEnGruposYTipos(persona) &&
    !destinatario(persona).email);
}

function renderSinEnvio() {
  const panel = $("listaSinEnvio");
  const termino = normalizar($("buscarSinEnvio").value);
  panel.replaceChildren();
  for (const persona of personasSinEnvio()) {
    if (state.grupoSinEnvio && persona.idGrupo !== state.grupoSinEnvio) continue;
    const motivo = destinatario(persona).motivo;
    const textoFila = `${persona.nombre} · ${persona.idGrupo} · ${persona.grupo} · ${motivo}`;
    if (!normalizar(textoFila).includes(termino)) continue;
    const fila = document.createElement("p");
    fila.className = "buzon-fila";
    fila.textContent = textoFila;
    panel.append(fila);
  }
  if (!panel.childElementCount) panel.textContent = "No hay resultados para la búsqueda.";
}

function renderResumenPersonas() {
  const seleccion = seleccionActual();
  const correos = new Set(seleccion.map(p => p.email));
  const sinEnvio = personasSinEnvio();
  const pendientes = [...state.gruposMarcados].filter(id => !state.nominasCargadas.has(id)).length;
  const confirmados = state.personas.filter(p => state.gruposMarcados.has(p.idGrupo)).length;

  $("resumenPersonas").textContent =
    `${confirmados} viajeros confirmados en nóminas cargadas · ${seleccion.length} seleccionados · ${seleccion.length} correos · ${correos.size} direcciones únicas` +
    (pendientes ? ` · ${pendientes} grupos sin nómina cargada.` : ".");

  const boton = $("verSinEnvio");
  boton.hidden = state.gruposMarcados.size === 0 || confirmados === 0;
  boton.textContent = `Ver ${sinEnvio.length} viajeros sin envío disponible`;

  state.estadisticas = new Map([...state.nominasCargadas].map(id => [id, { total: 0, sinEnvio: 0 }]));
  for (const p of state.personas) {
    const stats = state.estadisticas.get(p.idGrupo);
    if (!stats) continue;
    stats.total++;
    if (tipoIncluido(p) && coincideFiltrosNomina(p) && !destinatario(p).email) stats.sinEnvio++;
  }

  const muestra = $("muestra");
  const anterior = muestra.value;
  muestra.replaceChildren(new Option("Datos de ejemplo", ""));
  for (const p of seleccion) muestra.add(new Option(`${p.nombre} · ${p.grupo}`, p.id));
  if (seleccion.some(p => p.id === anterior)) muestra.value = anterior;
}

function modoCodigos() {
  return $("tipoCampana").value === "descuento" && $("incluirCodigos").checked
    ? $("modoCodigos").value : "ninguno";
}

function sincronizarCodigos() {
  const modo = modoCodigos();
  $("configCodigos").hidden = $("tipoCampana").value !== "descuento";
  $("origenCodigos").hidden = modo === "ninguno";
  $("opcionesCodigo").hidden = modo !== "generados";
  $("opcionesExcel").hidden = modo !== "excel";
  $("resumenCodigos").hidden = modo !== "excel";
  $("agregarCodigo").hidden = modo === "ninguno";
  $("insertarCodigo").hidden = modo === "ninguno";
}

function hojaCodigos() {
  return state.libroCodigos?.Sheets[$("hojaCodigos").value];
}

function cargarColumnasExcel() {
  const select = $("columnaCodigos");
  select.replaceChildren();
  const hoja = hojaCodigos();
  if (!hoja?.["!ref"]) return leerCodigosExcel();

  const rango = XLSX.utils.decode_range(hoja["!ref"]);
  const filaCabecera = Math.max(0, Number($("filaCodigos").value) - 2);
  for (let c = rango.s.c; c <= Math.min(rango.e.c, rango.s.c + 199); c++) {
    const letra = XLSX.utils.encode_col(c);
    const cabecera = texto(hoja[XLSX.utils.encode_cell({ r: filaCabecera, c })]?.v);
    select.add(new Option(cabecera ? `${letra} · ${cabecera}` : letra, String(c)));
    if (["codigo", "codigos", "code", "codes"].includes(normalizar(cabecera))) select.value = String(c);
  }
  leerCodigosExcel();
}

function leerCodigosExcel() {
  state.codigos = [];
  const hoja = hojaCodigos();
  const columna = $("columnaCodigos").value;
  const fila = Number($("filaCodigos").value);
  if (!hoja?.["!ref"] || columna === "" || !Number.isSafeInteger(fila) || fila < 1) {
    $("resumenCodigos").textContent = "Elige una hoja, columna y fila inicial válidas.";
    return;
  }

  const rango = XLSX.utils.decode_range(hoja["!ref"]);
  if (rango.e.r - fila + 2 > 10000) {
    $("resumenCodigos").textContent = "Selecciona una columna con un máximo de 10.000 filas desde el inicio indicado.";
    return;
  }

  let vacios = 0;
  let duplicados = 0;
  let invalidos = 0;
  let numericos = 0;
  const vistos = new Set();
  const encoder = new TextEncoder();
  for (let r = fila - 1; r <= rango.e.r; r++) {
    const celda = hoja[XLSX.utils.encode_cell({ r, c: Number(columna) })];
    const codigo = texto(celda?.t === "n" ? celda.w ?? celda.v : celda?.v);
    if (celda?.f || (codigo && (!["n", "s", "str"].includes(celda.t) ||
        encoder.encode(codigo).length > 64 || /[\u0000-\u001F\u007F]/.test(codigo)))) {
      invalidos++;
      continue;
    }
    if (!codigo) {
      vacios++;
      continue;
    }
    const clave = codigo.normalize("NFC").toUpperCase();
    if (vistos.has(clave)) {
      duplicados++;
      continue;
    }
    vistos.add(clave);
    if (celda.t === "n") numericos++;
    state.codigos.push(codigo);
  }

  $("resumenCodigos").textContent =
    `${state.codigos.length} códigos válidos · ${duplicados} duplicados, ${vacios} vacíos y ${invalidos} inválidos omitidos.` +
    (numericos ? " Para conservar ceros iniciales y códigos largos, guarda la columna como texto en Excel." : "");
}

async function importarExcel() {
  const version = ++state.versionExcel;
  const archivo = $("archivoCodigos").files[0];
  state.libroCodigos = null;
  state.codigos = [];
  state.cargandoExcel = !!archivo;
  $("hojaCodigos").replaceChildren();
  $("columnaCodigos").replaceChildren();
  $("resumenCodigos").textContent = archivo ? "Leyendo Excel…" : "";
  if (!archivo) return;

  try {
    if (!globalThis.XLSX) throw new Error("No se pudo cargar el lector de Excel.");
    if (archivo.size > 10 * 1024 * 1024) throw new Error("El Excel supera los 10 MB.");
    const datos = await archivo.arrayBuffer();
    if (version !== state.versionExcel) return;

    state.libroCodigos = XLSX.read(datos, { type: "array", cellText: true });
    for (const nombre of state.libroCodigos.SheetNames) $("hojaCodigos").add(new Option(nombre, nombre));
    cargarColumnasExcel();
  } catch (error) {
    if (version === state.versionExcel) $("resumenCodigos").textContent = error.message;
  } finally {
    if (version === state.versionExcel) state.cargandoExcel = false;
  }
}

function agregarCapa(contenido = "") {
  const panel = $("capas");
  if (panel.children.length >= 8) throw new Error("Puedes agregar hasta ocho cuadros de texto.");

  const capa = $("plantillaCapa").content.firstElementChild.cloneNode(true);
  const campo = key => capa.querySelector(`[data-k="${key}"]`);

  campo("texto").value = contenido;
  capa.querySelector("[data-quitar]").onclick = () => capa.remove();

  capa.querySelector("[data-posicion]").onchange = event => {
    if (!event.target.value) return;
    const [x, y, alineacion] = event.target.value.split(",");
    campo("x").value = x;
    campo("y").value = y;
    campo("alineacion").value = alineacion;
  };

  capa.querySelector("[data-insertar]").onchange = event => {
    const key = event.target.value;
    event.target.value = "";
    if (!key) return;

    if (key === "codigo" && modoCodigos() === "ninguno") {
      informar("Activa Incluir códigos para insertar un código.", true);
      return;
    }

    const input = campo("texto");
    input.setRangeText(`{{${key}}}`, input.selectionStart, input.selectionEnd, "end");
    input.focus();
  };

  panel.append(capa);
}

async function prepararImagen() {
  const version = ++state.versionImagen;
  const file = $("imagen").files[0];

  state.imagen = "";
  state.cargandoImagen = !!file;
  $("infoImagen").textContent = file ? "Preparando imagen…" : "";
  $("preview").hidden = true;
  if (!file) return;

  try {
    const bitmap = await createImageBitmap(file);

    try {
      if (version !== state.versionImagen) return;

      for (const lado of [1600, 1200, 900]) {
        const escala = Math.min(1, lado / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(bitmap.width * escala));
        canvas.height = Math.max(1, Math.round(bitmap.height * escala));

        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

        const imagen = canvas.toDataURL("image/jpeg", 0.84).split(",")[1];
        if (imagen && imagen.length <= 600000) {
          state.imagen = imagen;
          $("infoImagen").textContent = `Imagen lista · ${canvas.width} × ${canvas.height} px.`;
          return;
        }
      }

      throw new Error("No se pudo reducir la imagen al tamaño admitido.");
    } finally {
      bitmap.close();
    }
  } catch (error) {
    if (version === state.versionImagen) {
      $("imagen").value = "";
      $("infoImagen").textContent = "";
      mostrarError(error);
    }
  } finally {
    if (version === state.versionImagen) state.cargandoImagen = false;
  }
}

function receta(exigirCorreo = true) {
  if (state.cargandoImagen) throw new Error("Espera a que termine de cargar la imagen.");

  const capas = Array.from($("capas").children, capa =>
    Object.fromEntries(Array.from(capa.querySelectorAll("[data-k]"), input => [
      input.dataset.k,
      input.type === "checkbox" ? input.checked : input.value
    ]))
  ).filter(capa => texto(capa.texto));

  const datos = {
    asunto: texto($("asunto").value),
    cuerpo: texto($("cuerpo").value),
    tipo: $("tipoCampana").value,
    modoCodigos: modoCodigos(),
    responderA: $("responderA").value,
    prefijo: texto($("prefijo").value),
    largo: Number($("largo").value),
    imagen: state.imagen,
    modoImagen: $("modoImagen").value,
    capas
  };

  if (exigirCorreo && (!datos.asunto || (!datos.cuerpo && !datos.imagen))) {
    throw new Error("Ingresa un asunto y un mensaje o imagen.");
  }
  if (capas.length && !datos.imagen) {
    throw new Error("Sube una imagen base para usar los cuadros de texto.");
  }

  return datos;
}

function muestraActual() {
  return seleccionActual().find(p => p.id === $("muestra").value) || null;
}

async function cargarHistorial(version = state.version) {
  const items = await llamar("historial");
  if (version !== state.version) return;

  const panel = $("historial");
  panel.replaceChildren();
  $("detalle").replaceChildren();

  if (!items.length) {
    panel.textContent = "Aún no hay campañas registradas para esta cuenta.";
    return;
  }

  for (const item of items) {
    const fila = document.createElement("div");
    fila.className = "buzon-fila";

    const boton = document.createElement("button");
    boton.type = "button";
    boton.textContent = "Ver envíos";
    boton.onclick = async () => {
      boton.disabled = true;
      try {
        await verDetalle(item.id, version);
      } catch (error) {
        if (version === state.version) mostrarError(error);
      } finally {
        boton.disabled = false;
      }
    };

    fila.append(
      `${item.asunto} · ${item.estado} · ${item.correosPreparados ?? item.total} correos preparados · ` +
      `${item.direccionesUnicas ?? item.total} direcciones únicas · Responder a ${item.responderA || "administracion@raitrai.cl"} `,
      boton
    );
    if (item.modoCodigos && item.modoCodigos !== "ninguno") {
      fila.append(" ", botonExcel(item.id, "asignados", "Descargar códigos asignados", version));
    }
    if (item.modoCodigos === "excel" && item.disponibleParaExportar) {
      fila.append(" ", botonExcel(item.id, "disponibles", "Descargar códigos disponibles", version));
    }
    panel.append(fila);
  }
}

function botonExcel(id, clase, etiqueta, version) {
  const boton = document.createElement("button");
  boton.type = "button";
  boton.textContent = etiqueta;
  boton.onclick = async () => {
    boton.disabled = true;
    try {
      if (!globalThis.XLSX) throw new Error("No se pudo cargar el exportador de Excel.");
      const filas = clase === "asignados" ? [["Código", "Viajero", "Grupo", "Estado de envío"]] : [["Código"]];
      let cursor = "";
      do {
        const pagina = await llamar("exportarCodigos", { id, clase, cursor });
        if (version !== state.version) return;
        for (const fila of pagina.filas) {
          filas.push(clase === "asignados"
            ? [fila.codigo, fila.viajero, fila.grupo, fila.estado] : [fila.codigo]);
        }
        cursor = pagina.siguiente;
      } while (cursor);

      const libro = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet(filas), "Códigos");
      XLSX.writeFile(libro, `codigos-${clase}-${id.slice(0, 8)}.xlsx`);
    } catch (error) {
      if (version === state.version) mostrarError(error);
    } finally {
      boton.disabled = false;
    }
  };
  return boton;
}

async function verDetalle(id, version) {
  const items = await llamar("detalle", { id });
  if (version !== state.version) return;

  const panel = $("detalle");
  panel.replaceChildren();

  for (const item of items) {
    const fila = document.createElement("div");
    fila.className = "buzon-fila";

    const nombres = item.personas.map(p => p.codigo ? `${p.nombre} (${p.codigo})` : p.nombre);
    fila.textContent = [item.estado, item.email, nombres.join(", "), item.error]
      .filter(Boolean).join(" · ");

    if (item.estado === "Rechazado") {
      const boton = document.createElement("button");
      boton.type = "button";
      boton.textContent = "Reintentar";
      boton.onclick = async () => {
        boton.disabled = true;
        try {
          await llamar("reintentar", { id, envioId: item.id });
          if (version !== state.version) return;
          informar("Correo devuelto a la cola con sus códigos originales.");
          await verDetalle(id, version);
        } catch (error) {
          if (version === state.version) mostrarError(error);
          boton.disabled = false;
        }
      };
      fila.append(" ", boton);
    }

    panel.append(fila);
  }
}

function revisarEnvio() {
  if (!state.borrador) {
    const personas = seleccionActual();
    const lotes = personas.map(persona => [persona]);
    const direccionesUnicas = new Set(personas.map(persona => persona.email)).size;
    const configuracion = receta();
    if (!lotes.length) throw new Error("Selecciona al menos un viajero con correo disponible.");


    const codigos = configuracion.modoCodigos === "excel" ? [...state.codigos] : [];
    if (configuracion.modoCodigos === "excel") {
      if (state.cargandoExcel) throw new Error("Espera a que termine de cargar el Excel.");
      if (codigos.length < personas.length) {
        throw new Error(`Faltan ${personas.length - codigos.length} códigos para este envío.`);
      }
    }

    state.revision = {
      id: crypto.randomUUID(), configuracion, lotes, codigos,
      totalViajeros: personas.length, direccionesUnicas, sinEnvio: personasSinEnvio().length,
      pendientes: [...state.gruposMarcados].filter(id => !state.nominasCargadas.has(id)).length,
      siguiente: 0
    };
  }

  const envio = state.borrador || state.revision;
  const resumen = $("revisionEnvio");
  resumen.replaceChildren();
  const tipo = envio.configuracion.tipo === "viaje" ? "Información del viaje" : "Marketing · Descuentos y promociones";
  const lineas = [
    envio.configuracion.asunto, tipo,
    `${envio.totalViajeros} viajeros · ${envio.lotes.length} correos · ${envio.direccionesUnicas} direcciones únicas`,
    `Responder a ${envio.configuracion.responderA}`,
    `${envio.sinEnvio} viajeros sin envío disponible según los filtros`
  ];
  if (envio.pendientes) lineas.push(`${envio.pendientes} grupos sin nómina cargada quedan fuera del envío.`);
  if (envio.configuracion.modoCodigos !== "ninguno") lineas.push(`${envio.totalViajeros} códigos por asignar`);
  for (const linea of lineas) {
    const p = document.createElement("p");
    p.textContent = linea;
    resumen.append(p);
  }
  $("dialogoEnvio").showModal();
}

async function iniciarCampana(version) {
  if (!state.borrador) state.borrador = state.revision;
  if (!state.borrador) return;
  $("dialogoEnvio").close();

  const borrador = state.borrador;
  try {
    await llamar("crear", {
      id: borrador.id,
      receta: borrador.configuracion,
      total: borrador.lotes.length,
      totalViajeros: borrador.totalViajeros,
      porViajero: true,
      codigos: borrador.codigos
    });
  } catch (error) {
    if (["functions/invalid-argument", "functions/failed-precondition"].includes(error.code) &&
        borrador.siguiente === 0) state.borrador = null;
    throw error;
  }

  while (borrador.siguiente < borrador.lotes.length) {
    if (version !== state.version) return;

    const inicio = borrador.siguiente;
    const lote = borrador.lotes.slice(inicio, inicio + 10);
    informar(`Preparando correos ${inicio + 1}–${inicio + lote.length} de ${borrador.lotes.length}…`);

    await llamar("cargarLote", { id: borrador.id, lotes: lote });
    borrador.siguiente += lote.length;
  }

  if (version !== state.version) return;
  await llamar("iniciar", { id: borrador.id });
  if (version !== state.version) return;

  state.borrador = null;
  state.revision = null;
  informar(`Campaña en cola con ${borrador.lotes.length} correos. Ya puedes cerrar la pantalla.`);
  await cargarHistorial(version);
}

async function cargarUsuarioEfectivo() {
  const version = ++state.version;
  state.real = getRealUser();
  const efectivo = getEffectiveUser() || {};
  const correo = efectivo.email || state.real?.email || auth.currentUser?.email || "";
  const perfil = getVentasUser(correo) || {};

  state.efectivo = { ...efectivo, ...perfil, email: correo };
  state.correo = normalizeEmail(correo);
  state.puedeVerTodo = puedeVerGeneral(state.correo);
  state.manager = crearInscripcionesManager({ db, usuario: state.efectivo });

  state.grupos = [];
  state.personas = [];
  state.nominasCargadas.clear();
  state.estadisticas.clear();
  state.gruposMarcados.clear();
  state.personasMarcadas.clear();
  $("historial").replaceChildren();
  $("detalle").replaceChildren();
  renderGrupos();
  renderPersonas();

  const resultados = await Promise.allSettled([
    cargarGrupos(version),
    cargarHistorial(version)
  ]);

  if (version !== state.version) return;
  const error = resultados.find(resultado => resultado.status === "rejected");
  if (error) throw error.reason;
}

function vincularCabecera() {
  bindLayoutButtons({
    homeUrl: "index.html",

    onLogout: async () => {
      state.version++;
      state.autorizado = false;
      sessionStorage.removeItem(ACTING_USER_KEY);
      await signOut(auth);
      location.href = "./login.html";
    },

    onActAs: async selected => {
      if (state.real?.rol !== "admin" || !selected || state.ocupado) return;
      if (state.borrador) {
        informar("Termina de preparar la campaña antes de cambiar de usuario efectivo.", true);
        return;
      }

      sessionStorage.setItem(ACTING_USER_KEY, selected);
      try {
        await cargarUsuarioEfectivo();
      } catch (error) {
        mostrarError(error);
      }
    },

    onResetActAs: async () => {
      if (state.ocupado) return;
      if (state.borrador) {
        informar("Termina de preparar la campaña antes de cambiar de usuario efectivo.", true);
        return;
      }

      sessionStorage.removeItem(ACTING_USER_KEY);
      try {
        await cargarUsuarioEfectivo();
      } catch (error) {
        mostrarError(error);
      }
    }
  });
}

evento("cargarGrupos", cargarGrupos);
evento("cargarPersonas", cargarPersonas);
evento("actualizar", cargarHistorial);
evento("enviar", revisarEnvio);
evento("confirmarEnvio", iniciarCampana);
$("volverEdicion").onclick = () => $("dialogoEnvio").close();
$("dialogoEnvio").addEventListener("close", () => { state.revision = null; });

function abrirSinEnvio(grupoId = "") {
  state.grupoSinEnvio = grupoId;
  $("buscarSinEnvio").value = "";
  renderSinEnvio();
  $("dialogoSinEnvio").showModal();
}
evento("verSinEnvio", () => abrirSinEnvio());
$("buscarSinEnvio").addEventListener("input", renderSinEnvio);
evento("agregarCapa", () => agregarCapa());
evento("agregarCodigo", () => agregarCapa("Tu código es {{codigo}}"));

evento("marcarGrupos", () => {
  for (const grupo of gruposVisibles()) state.gruposMarcados.add(grupo.id);
  renderGrupos();
  renderPersonas();
});

evento("limpiarGrupos", () => {
  state.gruposMarcados.clear();
  state.personasMarcadas.clear();
  renderGrupos();
  renderPersonas();
});

evento("marcarPersonas", () => {
  for (const persona of personasVisibles()) {
    if (destinatario(persona).email) state.personasMarcadas.add(persona.id);
  }
  renderPersonas();
});

evento("limpiarPersonas", () => {
  state.personasMarcadas.clear();
  renderPersonas();
});

evento("previsualizar", async version => {
  const configuracion = receta(false);
  if (!configuracion.imagen) throw new Error("Sube una imagen base.");

  const resultado = await llamar("preview", { receta: configuracion, persona: muestraActual() });
  if (version !== state.version) return;

  $("preview").src = `data:image/jpeg;base64,${resultado.imagen}`;
  $("preview").hidden = false;
  informar("Vista previa generada.");
});

evento("prueba", async version => {
  await llamar("prueba", { receta: receta(), persona: muestraActual() });
  if (version === state.version) {
    informar(`SendGrid aceptó el correo de prueba para ${auth.currentUser.email}.`);
  }
});

$("imagen").addEventListener("change", prepararImagen);

for (const id of ["tipoCampana", "incluirCodigos", "modoCodigos"]) {
  $(id).addEventListener("change", sincronizarCodigos);
}
sincronizarCodigos();
$("archivoCodigos").addEventListener("change", importarExcel);
$("hojaCodigos").addEventListener("change", cargarColumnasExcel);
$("columnaCodigos").addEventListener("change", leerCodigosExcel);
$("filaCodigos").addEventListener("change", cargarColumnasExcel);

for (const id of ["destino", "desde", "hasta", "buscarGrupo"]) {
  $(id).addEventListener("input", renderGrupos);
}

for (const id of ["estudiantes", "adultos", "profesores", "rutaEstudiante", "buscarPersona"]) {
  $(id).addEventListener("input", () => {
    renderPersonas();
    if (id !== "buscarPersona") renderGrupos();
  });
}

for (const id of filtrosNomina) {
  $(id).addEventListener("input", () => {
    renderPersonas();
    renderGrupos();
  });
}
evento("limpiarFiltrosNomina", () => {
  for (const id of filtrosNomina) $(id).value = "";
  renderPersonas();
  renderGrupos();
});

let campoRedaccion = null;
for (const id of ["asunto", "cuerpo"]) {
  $(id).addEventListener("focus", event => { campoRedaccion = event.currentTarget; });
}
$("insertarDato").addEventListener("click", event => {
  const boton = event.target.closest("button[data-dato]");
  if (!boton) return;

  const campo = campoRedaccion || $("cuerpo");
  const inicio = campoRedaccion ? campo.selectionStart : campo.value.length;
  const fin = campoRedaccion ? campo.selectionEnd : campo.value.length;
  const variable = `{{${boton.dataset.dato}}}`;
  if (campo.maxLength >= 0 && campo.value.length - (fin - inicio) + variable.length > campo.maxLength) {
    informar("El campo alcanzó su largo máximo.", true);
    return;
  }
  campo.setRangeText(variable, inicio, fin, "end");
  campo.focus();
});

await waitForLayoutReady();

onAuthStateChanged(auth, async user => {
  const version = ++state.version;
  state.autorizado = false;
  state.borrador = null;
  state.revision = null;
  $("app").hidden = true;

  if (!user) {
    informar("Inicia sesión en Ventas RT y vuelve al buzón.", true);
    return;
  }

  state.real = getRealUser();
  vincularCabecera();

  try {
    await user.reload();
    const { claims } = await user.getIdTokenResult(true);
    if (version !== state.version) return;

    const correo = normalizeEmail(texto(claims.email));
    if (!correo) throw new Error("Firebase no devolvió un correo para esta sesión.");

    try {
      const acceso = await llamar("acceso");
      if (version !== state.version) return;
      const responderA = $("responderA");
      const etiquetas = {
        "administracion@raitrai.cl": "Administración",
        "operaciones@raitrai.cl": "Operaciones"
      };
      responderA.replaceChildren();
      for (const casilla of acceso.opcionesResponderA || ["administracion@raitrai.cl"]) {
        responderA.add(new Option(etiquetas[casilla] ? `${etiquetas[casilla]} · ${casilla}` : casilla, casilla));
      }
    } catch (error) {
      if (error.code === "functions/permission-denied") {
        throw new Error(`La API del buzón rechazó el acceso de ${correo}.`);
      }
      throw error;
    }

    if (version !== state.version) return;
    state.autorizado = true;
    $("app").hidden = false;
    await cargarUsuarioEfectivo();
  } catch (error) {
    if (version === state.version || state.autorizado) mostrarError(error);
  }
});
