import {
  collection, doc, getDoc, getDocs, query, where, limit,
  updateDoc, setDoc, serverTimestamp, deleteField
} from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";

const PUBLIC_FORM_URL = "https://sistemas-raitrai.github.io/Ventas-RT/inscripcion.html";

export function crearInscripcionesManager({ db, usuario = {}, onChange = null } = {}) {
  if (!db) throw new Error("crearInscripcionesManager requiere db.");

  const cacheDetalle = new Map();
  const email = normalizarEmail(usuario.email || "");
  const rol = normalizar(usuario.rol || "");
  const nombreUsuario = [usuario.nombre, usuario.apellido].filter(Boolean).join(" ").trim() || email;

  function esAdminOSupervision() {
    return rol === "admin" || rol === "supervision";
  }

  function puedeAdministrarNomina() {
    return esAdminOSupervision() || rol === "registro" || [
      "yenny@raitrai.cl", "administracion@raitrai.cl", "raitrai@raitrai.cl",
      "giras@raitrai.cl", "sistemas@raitrai.cl"
    ].includes(email);
  }

  function puedeGestionarLinks(grupo = {}) {
    if (normalizar(grupo.estado) !== "ganada") return false;
    if (esAdminOSupervision()) return true;
    if (rol !== "vendedor") return false;
    const correoGrupo = normalizarEmail(grupo.vendedoraCorreo || "");
    return !correoGrupo || correoGrupo === email;
  }

  async function resolverGrupo(id) {
    const valor = String(id || "").trim();
    if (!valor) return null;

    const directa = await getDoc(doc(db, "ventas_cotizaciones", valor));
    if (directa.exists()) return mapGrupo(directa);

    const snap = await getDocs(query(
      collection(db, "ventas_cotizaciones"),
      where("idGrupo", "==", valor),
      limit(1)
    ));
    if (snap.empty) return null;
    return mapGrupo(snap.docs[0]);
  }

  async function detectarOrigenNomina(grupoCtx) {
    const grupo = grupoCtx.data || {};
    const directo = normalizar(
      grupo.origenNomina || grupo.nominaOrigen || grupo.inscripcion?.origenNomina || ""
    ).replace(/\s+/g, "_");

    if (["sistema_pagos", "sistema_de_pagos"].includes(directo) ||
        grupo.sistemaPagos?.nominaImportada === true ||
        grupo.nominaImportadaPagos === true ||
        grupo.nominaImportadaSistemaPagos === true) return "sistema_pagos";

    try {
      const snap = await getDocs(query(
        collection(db, "ventas_cotizaciones", grupoCtx.docId, "inscripciones"),
        where("tipoInscripcion", "in", ["sistema_pagos", "sistema_de_pagos", "Sistema de Pagos"]),
        limit(1)
      ));
      return snap.empty ? "inscripcion_inicial" : "sistema_pagos";
    } catch {
      return "inscripcion_inicial";
    }
  }

  async function cargarNomina(
    grupoCtx,
    {
      completa = false
    } = {}
  ) {
    cacheDetalle.clear();
  
    if (!grupoCtx?.docId) {
      throw new Error(
        "No se pudo determinar el documento del grupo."
      );
    }
  
    const groupDocId =
      String(grupoCtx.docId);
  
    const resumenSnap =
      await getDocs(
        collection(
          db,
          "ventas_cotizaciones",
          groupDocId,
          "nomina_resumen"
        )
      );
  
    let items = [];
  
    if (
      !resumenSnap.empty &&
      !completa
    ) {
      items =
        resumenSnap.docs.map(
          (documento) => ({
            id: documento.id,
            ...documento.data(),
            esResumenNomina: true
          })
        );
    } else {
      const inscripcionesSnap =
        await getDocs(
          collection(
            db,
            "ventas_cotizaciones",
            groupDocId,
            "inscripciones"
          )
        );
  
      items =
        inscripcionesSnap.docs.map(
          (documento) => ({
            id: documento.id,
            ...documento.data(),
            esResumenNomina: false
          })
        );
    }
  
    return ordenarNomina(
      items.filter(noEliminada)
    );
  }

  async function cargarInscripcionCompleta(grupoCtx, id) {
    const key = `${grupoCtx.docId}:${id}`;
    if (cacheDetalle.has(key)) return cacheDetalle.get(key);
    const snap = await getDoc(doc(db, "ventas_cotizaciones", grupoCtx.docId, "inscripciones", String(id)));
    if (!snap.exists()) return null;
    const item = { id: snap.id, ...snap.data(), esResumenNomina: false };
    cacheDetalle.set(key, item);
    return item;
  }

  function obtenerEstadoFases(grupoCtx, origen = "inscripcion_inicial") {
    const g = grupoCtx.data || {};
    const fasePrincipal = normalizar(g.inscripcion?.faseActual || g.inscripcionEstado || "");
    const principalActivo = g.inscripcionHabilitada === true && fasePrincipal !== "cerrada";

    return {
      origen,
      principal: {
        clave: origen === "sistema_pagos" ? "nomina_final" : "inscripcion_inicial",
        label: origen === "sistema_pagos" ? "Nómina final / ficha médica" : "Inscripción inicial",
        activo: principalActivo,
        fase: fasePrincipal,
        token: texto(g.tokenInscripcion || g.inscripcion?.tokenActual),
        link: texto(g.linkInscripcion || g.inscripcion?.linkActual)
      },
      nuevos: estadoSecundario(g.inscripcionNuevos, "nuevo_ingreso", "Nuevo ingreso"),
      listaEspera: estadoSecundario(g.inscripcionListaEspera, "lista_espera", "Lista de espera"),
      liberados: {
        ...estadoSecundario(g.inscripcionLiberados, "liberados", "Cupos liberados"),
        activo: g.linkLiberadosActivo === true || g.inscripcionLiberados?.activo === true,
        token: texto(g.tokenInscripcionLiberados || g.inscripcionLiberados?.tokenActual)
      }
    };
  }

  async function abrirFase(grupoCtx, fase, { tienePolera = null } = {}) {
    if (!puedeGestionarLinks(grupoCtx.data)) throw new Error("No tienes permisos para gestionar links de este grupo.");
    const clave = normalizar(fase).replace(/\s+/g, "_");
    const token = generarToken();
    const link = `${PUBLIC_FORM_URL}?token=${encodeURIComponent(token)}`;
    const auditoria = {
      actualizadoPor: nombreUsuario,
      actualizadoPorCorreo: email,
      actualizadoAt: serverTimestamp()
    };
    const patch = {};

    if (tienePolera !== null) {
      patch["elementosIncluidos.polera"] = tienePolera === true;
      patch["elementosIncluidos.actualizadoPor"] = nombreUsuario;
      patch["elementosIncluidos.actualizadoPorCorreo"] = email;
      patch["elementosIncluidos.actualizadoAt"] = serverTimestamp();
    }

    if (clave === "inscripcion_inicial" || clave === "nomina_final") {
      Object.assign(patch, {
        inscripcionHabilitada: true,
        tokenInscripcion: token,
        linkInscripcion: link,
        inscripcionEstado: clave,
        "inscripcion.faseActual": clave,
        "inscripcion.tokenActual": token,
        "inscripcion.linkActual": link,
        "inscripcion.abiertaAt": serverTimestamp(),
        "inscripcion.abiertaPor": nombreUsuario,
        "inscripcion.abiertaPorCorreo": email
      });
    } else {
      const campo = campoFase(clave);
      Object.assign(patch, {
        [`${campo}.activo`]: true,
        [`${campo}.tokenActual`]: token,
        [`${campo}.linkActual`]: link,
        [`${campo}.abiertoAt`]: serverTimestamp(),
        [`${campo}.abiertoPor`]: nombreUsuario,
        [`${campo}.abiertoPorCorreo`]: email
      });
      if (clave === "liberados") {
        patch.linkLiberadosActivo = true;
        patch.tokenInscripcionLiberados = token;
      }
    }

    Object.assign(patch, auditoria);
    await updateDoc(doc(db, "ventas_cotizaciones", grupoCtx.docId), patch);
    await notificarCambio(grupoCtx, "fase_abierta", { fase: clave, link });
    return { token, link };
  }

  async function cerrarFase(grupoCtx, fase) {
    if (!puedeGestionarLinks(grupoCtx.data)) throw new Error("No tienes permisos para gestionar links de este grupo.");
    const clave = normalizar(fase).replace(/\s+/g, "_");
    const patch = {
      actualizadoPor: nombreUsuario,
      actualizadoPorCorreo: email,
      actualizadoAt: serverTimestamp()
    };

    if (clave === "inscripcion_inicial" || clave === "nomina_final") {
      Object.assign(patch, {
        inscripcionHabilitada: false,
        inscripcionEstado: "cerrada",
        "inscripcion.faseActual": "cerrada",
        "inscripcion.cerradaAt": serverTimestamp(),
        "inscripcion.cerradaPor": nombreUsuario,
        "inscripcion.cerradaPorCorreo": email,
        [`inscripcion.fasesCerradas.${clave}`]: true
      });
    } else {
      const campo = campoFase(clave);
      Object.assign(patch, {
        [`${campo}.activo`]: false,
        [`${campo}.cerradoAt`]: serverTimestamp(),
        [`${campo}.cerradoPor`]: nombreUsuario,
        [`${campo}.cerradoPorCorreo`]: email
      });
      if (clave === "liberados") patch.linkLiberadosActivo = false;
    }

    await updateDoc(doc(db, "ventas_cotizaciones", grupoCtx.docId), patch);
    await notificarCambio(grupoCtx, "fase_cerrada", { fase: clave });
  }

  async function marcarCargadoPagos(grupoCtx, valor = true) {
    if (!puedeAdministrarNomina()) throw new Error("No tienes permisos para marcar cargado a pagos.");
    await updateDoc(doc(db, "ventas_cotizaciones", grupoCtx.docId), {
      nominaCargadaPagos: valor === true,
      nominaCargadaPagosAt: valor ? serverTimestamp() : deleteField(),
      nominaCargadaPagosPor: valor ? nombreUsuario : deleteField(),
      nominaCargadaPagosPorCorreo: valor ? email : deleteField(),
      actualizadoAt: serverTimestamp()
    });
    await notificarCambio(grupoCtx, "nomina_cargada_pagos", { valor: valor === true });
  }

  async function actualizarPasajero(grupoCtx, id, cambios = {}) {
    if (!puedeAdministrarNomina()) throw new Error("No tienes permisos para editar la nómina.");
    const permitidos = ["estado", "anulado", "correo", "telefono", "tipoInscripcion", "fichaCompleta"];
    const patch = {};
    for (const key of permitidos) if (Object.prototype.hasOwnProperty.call(cambios, key)) patch[key] = cambios[key];
    patch.actualizadoAt = serverTimestamp();
    patch.actualizadoPor = nombreUsuario;
    patch.actualizadoPorCorreo = email;
    await updateDoc(doc(db, "ventas_cotizaciones", grupoCtx.docId, "inscripciones", String(id)), patch);
    cacheDetalle.delete(`${grupoCtx.docId}:${id}`);
    await notificarCambio(grupoCtx, "pasajero_actualizado", { inscripcionId: String(id), campos: Object.keys(patch) });
  }

  async function resetearCiclo(grupoCtx) {
    if (!esAdminOSupervision()) throw new Error("Solo Admin o Supervisión pueden resetear el ciclo.");
    await updateDoc(doc(db, "ventas_cotizaciones", grupoCtx.docId), {
      inscripcionHabilitada: false,
      inscripcionEstado: "cerrada",
      tokenInscripcion: deleteField(),
      linkInscripcion: deleteField(),
      inscripcion: deleteField(),
      inscripcionNuevos: deleteField(),
      inscripcionListaEspera: deleteField(),
      inscripcionLiberados: deleteField(),
      linkLiberadosActivo: false,
      tokenInscripcionLiberados: deleteField(),
      actualizadoAt: serverTimestamp(),
      actualizadoPor: nombreUsuario,
      actualizadoPorCorreo: email
    });
    await notificarCambio(grupoCtx, "ciclo_reseteado", {});
  }

  async function archivarNomina(grupoCtx, valor = true) {
    if (!puedeAdministrarNomina()) throw new Error("No tienes permisos para archivar la nómina.");
    await updateDoc(doc(db, "ventas_cotizaciones", grupoCtx.docId), {
      nominaArchivada: valor === true,
      nominaArchivadaAt: valor ? serverTimestamp() : deleteField(),
      nominaArchivadaPor: valor ? nombreUsuario : deleteField(),
      nominaArchivadaPorCorreo: valor ? email : deleteField(),
      actualizadoAt: serverTimestamp()
    });
    await notificarCambio(grupoCtx, "nomina_archivada", { valor: valor === true });
  }

  async function recargarGrupo(grupoCtx) {
    const snap = await getDoc(doc(db, "ventas_cotizaciones", grupoCtx.docId));
    if (!snap.exists()) return null;
    return mapGrupo(snap);
  }

  async function notificarCambio(grupoCtx, tipo, metadata) {
    try {
      await setDoc(doc(collection(db, "ventas_historial")), {
        idGrupo: grupoCtx.groupId,
        groupDocId: grupoCtx.docId,
        tipoMovimiento: tipo,
        modulo: "gestion_nomina",
        titulo: tipo.replaceAll("_", " "),
        mensaje: `${nombreUsuario} realizó una acción en gestión de nómina.`,
        metadata: metadata || {},
        fecha: serverTimestamp(),
        creadoPor: nombreUsuario,
        creadoPorCorreo: email
      });
    } catch (error) {
      console.warn("[inscripciones-manager] historial", error);
    }
    if (typeof onChange === "function") await onChange({ grupoCtx, tipo, metadata });
  }

  return {
    resolverGrupo, recargarGrupo, detectarOrigenNomina, cargarNomina,
    cargarInscripcionCompleta, obtenerEstadoFases, abrirFase, cerrarFase,
    marcarCargadoPagos, actualizarPasajero, resetearCiclo, archivarNomina,
    puedeGestionarLinks, puedeAdministrarNomina, esAdminOSupervision
  };
}

export function resumirNomina(items = []) {
  const activos = items.filter(i => !estaAnulada(i));
  return {
    total: items.length,
    activos: activos.length,
    anulados: items.length - activos.length,
    fichaCompleta: activos.filter(fichaCompleta).length,
    fichaPendiente: activos.filter(i => !fichaCompleta(i)).length,
    conCarnet: activos.filter(tieneCarnet).length,
    sinCarnet: activos.filter(i => !tieneCarnet(i)).length
  };
}

export function exportarNominaCsv(items = [], nombre = "nomina.csv") {
  const columnas = ["RUT", "NOMBRE", "APELLIDO", "TIPO", "ESTADO", "FICHA COMPLETA", "ANULADO", "CORREO", "TELEFONO", "CARNET"];
  const filas = items.map(i => [
    documento(i), nombres(i), apellidos(i), tipo(i), estado(i), fichaCompleta(i) ? "SI" : "NO",
    estaAnulada(i) ? "SI" : "NO", correo(i), telefono(i), tieneCarnet(i) ? "SI" : "NO"
  ]);
  const csv = [columnas, ...filas].map(f => f.map(v => `"${String(v ?? "").replaceAll('"', '""')}"`).join(";")).join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = nombre; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const camposPasajero = { documento, nombres, apellidos, tipo, estado, correo, telefono, fichaCompleta, tieneCarnet, estaAnulada };

function mapGrupo(snap) { return { docId: snap.id, groupId: String(snap.data()?.idGrupo || snap.id), data: snap.data() || {} }; }
function estadoSecundario(data = {}, clave, label) { return { clave, label, activo: data?.activo === true, token: texto(data?.tokenActual), link: texto(data?.linkActual) }; }
function campoFase(clave) { if (clave === "nuevo_ingreso") return "inscripcionNuevos"; if (clave === "lista_espera") return "inscripcionListaEspera"; if (clave === "liberados") return "inscripcionLiberados"; throw new Error("Fase inválida."); }
function generarToken() { const bytes = new Uint8Array(24); crypto.getRandomValues(bytes); return [...bytes].map(b => b.toString(16).padStart(2, "0")).join(""); }
function noEliminada(i) { const e = normalizar(i?.privacidad?.estado); return e !== "eliminada_logica" && e !== "archivada"; }
function ordenarNomina(items) { return [...items].sort((a,b) => Number(estaAnulada(a))-Number(estaAnulada(b)) || nombres(a).localeCompare(nombres(b), "es")); }
function valor(i, paths) { for (const p of paths) { const v = p.split(".").reduce((o,k)=>o?.[k], i); if (v !== undefined && v !== null && String(v).trim() !== "") return v; } return ""; }
function documento(i) { return texto(valor(i,["rut","documento","pasajero.rut","datosPersonales.rut","participante.rut"])); }
function nombres(i) { return texto(valor(i,["nombre","nombres","pasajero.nombre","datosPersonales.nombres","participante.nombres"])); }
function apellidos(i) { const directo=texto(valor(i,["apellido","apellidos","pasajero.apellido","datosPersonales.apellidos"])); if(directo)return directo; return [valor(i,["primerApellido","datosPersonales.primerApellido"]),valor(i,["segundoApellido","datosPersonales.segundoApellido"])].filter(Boolean).join(" "); }
function tipo(i) { return texto(valor(i,["tipoInscripcion","tipo","pasajero.tipo"])); }
function estado(i) { return texto(valor(i,["estado","estadoInscripcion","estadoCupo","pasajero.estado"])); }
function correo(i) { return texto(valor(i,["correo","contactoPrincipal.correo","pasajero.correo","datosContacto.correo"])); }
function telefono(i) { return texto(valor(i,["telefono","contactoPrincipal.telefono","contactoPrincipal.celular","pasajero.telefono"])); }
function fichaCompleta(i) { return valor(i,["fichaCompleta","fichaMedicaCompleta","fichaMedica.completa","estadoFichaMedica"]) === true || ["completa","completo","ok","confirmada"].includes(normalizar(valor(i,["fichaCompleta","estadoFichaMedica"]))); }
function tieneCarnet(i) { return valor(i,["tieneCarnet","tieneCarnetIdentidad","sistemaPagos.tieneCarnet","documentos.carnetIdentidad"]) === true; }
function estaAnulada(i) { return i?.anulado === true || i?.anulada === true || normalizar(estado(i)).includes("anulad") || normalizar(i?.estadoViaje).includes("no viaja"); }
function texto(v) { return String(v ?? "").trim(); }
function normalizar(v) { return texto(v).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); }
function normalizarEmail(v) { return normalizar(v).replace(/\s+/g, ""); }
