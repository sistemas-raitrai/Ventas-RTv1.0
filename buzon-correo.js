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

const state = {
  real: null,
  efectivo: null,
  correo: "",
  puedeVerTodo: false,
  manager: null,
  grupos: [],
  personas: [],
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
      $("enviar").textContent = state.borrador ? "Continuar preparación" : "Iniciar campaña";
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
    const etiqueta = [g.id, g.nombre, g.negocio, g.destino, g.fecha || "Sin fecha"]
      .filter(Boolean).join(" · ");

    filaSeleccion(panel, etiqueta, state.gruposMarcados.has(g.id), false, checked => {
      marcar(state.gruposMarcados, g.id, checked);
      renderResumenGrupos();
      renderPersonas();
    });
  }

  renderResumenGrupos(visibles.length);
}

function renderResumenGrupos(visibles = gruposVisibles().length) {
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
      destino: texto(g.destinoPrincipal || g.destino),
      fecha: fechaISO(g.fechaInicio || g.fechaSalida),
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
  const fallidos = [];

  for (let i = 0; i < seleccion.length; i += 6) {
    if (version !== state.version) return;

    const lote = seleccion.slice(i, i + 6);
    informar(`Cargando nóminas ${i + 1}–${i + lote.length} de ${seleccion.length}…`);

    const resultados = await Promise.allSettled(lote.map(async g => {
      const grupo = await manager.resolverGrupo(g.id);
      if (!grupo) throw new Error(`Grupo ${g.id} no encontrado.`);

      return (await manager.cargarNomina(grupo))
        .filter(p => esPersonaViajeraConteo(p))
        .flatMap(p => {
          const tipo = normalizar(p.tipoViajante || p.tipoParticipacion).replace(/\s+/g, "_");
          if (!Object.hasOwn(tipos, tipo) || !p.id) return [];

          const identificacion = p.identificacion || {};
          const contacto = p.contactoPrincipal || {};
          const nombre = texto(identificacion.nombreCompleto ||
            [camposPasajero.nombres(p), camposPasajero.apellidos(p)].filter(Boolean).join(" "));
          if (!nombre) return [];

          const documento = normalizar(camposPasajero.documento(p)).replace(/[^a-z0-9]/g, "");
          const identidad = documento && !["sinrut", "sindocumento"].includes(documento)
            ? documento
            : p.id;

          return [{
            id: `${g.docId}:${identidad}`,
            idGrupo: g.id,
            tipo,
            nombre,
            grupo: g.nombre,
            destino: g.destino,
            correoViajero: identificacion.correoViajante,
            correoResponsable: contacto.correo,
            responsable: nombreContacto(contacto),
            autorizado: identificacion.autorizaCorreosPreviosPersonaQueViaja === true
          }];
        });
    }));

    resultados.forEach((resultado, index) => {
      if (resultado.status === "rejected") {
        fallidos.push(lote[index].id);
        return;
      }

      for (const persona of resultado.value) {
        if (!cargadas.has(persona.id)) cargadas.set(persona.id, persona);
      }
    });
  }

  if (version !== state.version) return;
  state.personas = [...cargadas.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  state.personasMarcadas.clear();
  renderPersonas();

  informar(
    fallidos.length
      ? `${state.personas.length} viajeros cargados. Grupos con error: ${fallidos.join(", ")}.`
      : `${state.personas.length} viajeros confirmados cargados.`,
    !!fallidos.length
  );
}

function destinatario(persona) {
  const esEstudiante = persona.tipo === "estudiante";
  const responsable = esEstudiante && $("rutaEstudiante").value === "responsable";

  if (esEstudiante && !responsable && !persona.autorizado) {
    return { email: "", motivo: "Sin autorización de correo directo" };
  }

  const email = normalizeEmail(texto(responsable ? persona.correoResponsable : persona.correoViajero));
  if (!correoValido(email)) return { email: "", motivo: "Sin correo válido" };

  return {
    email,
    nombreDestinatario: responsable ? persona.responsable : persona.nombre
  };
}

function personaEnGruposYTipos(persona) {
  return state.gruposMarcados.has(persona.idGrupo) && $(tipos[persona.tipo]).checked;
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
        nombreDestinatario: contacto.nombreDestinatario
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

function renderResumenPersonas() {
  const seleccion = seleccionActual();
  const correos = new Set(seleccion.map(p => p.email));
  const sinEnvio = personasVisibles().filter(p => !destinatario(p).email).length;

  $("resumenPersonas").textContent =
    `${seleccion.length} viajeros seleccionados · ${correos.size} correos · ${sinEnvio} visibles sin envío disponible.`;

  const muestra = $("muestra");
  const anterior = muestra.value;
  muestra.replaceChildren(new Option("Datos de ejemplo", ""));

  for (const p of seleccion) muestra.add(new Option(`${p.nombre} · ${p.grupo}`, p.id));
  if (seleccion.some(p => p.id === anterior)) muestra.value = anterior;
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

    if (key === "codigo" && $("tipoCampana").value !== "descuento") {
      informar("Selecciona Descuentos para insertar un código.", true);
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

function agruparPorCorreo(personas) {
  const lotes = new Map();
  for (const persona of personas) {
    if (!lotes.has(persona.email)) lotes.set(persona.email, []);
    lotes.get(persona.email).push(persona);
  }
  return [...lotes.values()];
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

    fila.append(`${item.asunto} · ${item.estado} · ${item.total} correos `, boton);
    panel.append(fila);
  }
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

async function iniciarCampana(version) {
  if (!state.borrador) {
    const personas = seleccionActual();
    const lotes = agruparPorCorreo(personas);

    if (!lotes.length) throw new Error("Selecciona al menos un viajero con correo disponible.");
    if (lotes.some(lote => lote.length > 10)) {
      throw new Error("Una dirección reúne más de diez viajeros. Divide esa selección en campañas.");
    }

    const configuracion = receta();
    if (!window.confirm(`¿Iniciar el envío para ${personas.length} viajeros en ${lotes.length} correos?`)) return;

    state.borrador = {
      id: crypto.randomUUID(),
      configuracion,
      lotes,
      siguiente: 0
    };
  }

  const borrador = state.borrador;
  await llamar("crear", {
    id: borrador.id,
    receta: borrador.configuracion,
    total: borrador.lotes.length
  });

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
evento("enviar", iniciarCampana);
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

$("tipoCampana").addEventListener("change", () => {
  const descuento = $("tipoCampana").value === "descuento";
  $("opcionesCodigo").hidden = !descuento;
  $("agregarCodigo").hidden = !descuento;
});

for (const id of ["destino", "desde", "hasta", "buscarGrupo"]) {
  $(id).addEventListener("input", renderGrupos);
}

for (const id of ["estudiantes", "adultos", "profesores", "rutaEstudiante", "buscarPersona"]) {
  $(id).addEventListener("input", renderPersonas);
}

await waitForLayoutReady();

onAuthStateChanged(auth, async user => {
  const version = ++state.version;
  state.autorizado = false;
  state.borrador = null;
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
      await llamar("acceso");
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
