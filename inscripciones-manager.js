import {
  collection, doc, getDoc, getDocs, query, where, limit,
  updateDoc, setDoc, serverTimestamp, deleteField
} from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";

const PUBLIC_FORM_URL = "https://sistemas-raitrai.github.io/Ventas-RT/inscripcion.html";
const ALERTAS_INSCRIPCIONES_COLLECTION = "ventas_alertas_inscripciones";

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

  function puedeMarcarListaEsperaPagada() {
    return esAdminOSupervision() || [
      "yenny@raitrai.cl",
      "administracion@raitrai.cl",
      "raitrai@raitrai.cl",
      "sistemas@raitrai.cl"
    ].includes(email);
  }

  function puedeConfirmarIngresoOCupo() {
    return esAdminOSupervision() || rol === "registro" || [
      "yenny@raitrai.cl",
      "administracion@raitrai.cl",
      "raitrai@raitrai.cl",
      "giras@raitrai.cl",
      "sistemas@raitrai.cl"
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

  const CAMPOS_EDITABLES_NOMINA = new Set([
    "identificacion.documento",
    "identificacion.rutCompleto",

    "identificacion.nombres",
    "identificacion.primerApellido",
    "identificacion.segundoApellido",
    "identificacion.fechaNacimiento",
    "identificacion.nacionalidad",
    "identificacion.genero",

    "tipoViajante",
    "tipoParticipacion",

    "contactoPrincipal.nombre",
    "contactoPrincipal.correo",
    "contactoPrincipal.celular"
  ]);

  const CAMPOS_CRITICOS_SISTEMA_PAGOS = new Set([
    "identificacion.documento",
    "identificacion.rutCompleto",

    "identificacion.nombres",
    "identificacion.primerApellido",
    "identificacion.segundoApellido",
    "identificacion.fechaNacimiento",
    "identificacion.nacionalidad",
    "identificacion.genero",

    "tipoViajante",
    "tipoParticipacion",

    "contactoPrincipal.nombre",
    "contactoPrincipal.correo",
    "contactoPrincipal.celular"
  ]);

  function getByPathManager(
    object = {},
    path = ""
  ) {
    return String(path || "")
      .split(".")
      .reduce(
        (current, key) =>
          current?.[key],
        object
      );
  }

  function valoresIgualesManager(
    anterior,
    nuevo
  ) {
    return JSON.stringify(
      anterior ?? ""
    ) === JSON.stringify(
      nuevo ?? ""
    );
  }

  function getNombrePasajeroManager(
    item = {}
  ) {
    return [
      nombres(item),
      apellidos(item)
    ]
      .filter(Boolean)
      .join(" ")
      .trim() ||
      "Pasajero";
  }

  async function registrarHistorialNominaPasajero(
    grupoCtx,
    inscripcion,
    {
      motivo = "",
      cambios = [],
      tipoMovimiento =
        "edicion_nomina_inscripcion",
      titulo =
        "Edición de nómina",
      origen =
        "gestion_nomina"
    } = {}
  ) {
    const inscripcionRef =
      doc(
        db,
        "ventas_cotizaciones",
        String(grupoCtx.docId),
        "inscripciones",
        String(inscripcion.id)
      );

    /*
      HISTORIAL INDIVIDUAL DEL PASAJERO
    */
    await setDoc(
      doc(
        collection(
          inscripcionRef,
          "historial_nomina"
        )
      ),
      {
        fecha:
          serverTimestamp(),

        usuarioNombre:
          nombreUsuario,

        usuarioCorreo:
          email,

        motivo:
          texto(motivo),

        cambios:
          Array.isArray(cambios)
            ? cambios
            : [],

        origen:
          texto(origen),

        tipoMovimiento
      }
    );

    /*
      HISTORIAL GENERAL DEL GRUPO.

      grupo.js ya consulta ventas_historial,
      por lo tanto aparecerá automáticamente allí.
    */
    await setDoc(
      doc(
        collection(
          db,
          "ventas_historial"
        )
      ),
      {
        idGrupo:
          grupoCtx.groupId,

        groupDocId:
          grupoCtx.docId,

        tipoMovimiento,

        modulo:
          "inscripcion",

        titulo,

        mensaje:
          `${nombreUsuario} modificó la nómina de ${getNombrePasajeroManager(
            inscripcion
          )}. Motivo: ${texto(motivo)}`,

        cambios:
          Array.isArray(cambios)
            ? cambios
            : [],

        metadata: {
          inscripcionId:
            String(
              inscripcion.id ||
              ""
            ),

          documento:
            documento(
              inscripcion
            ),

          nombreCompleto:
            getNombrePasajeroManager(
              inscripcion
            ),

          motivo:
            texto(motivo),

          origen:
            texto(origen)
        },

        fecha:
          serverTimestamp(),

        creadoPor:
          nombreUsuario,

        creadoPorCorreo:
          email
      }
    );
  }

  async function guardarAlertaCambioDatosCriticos(
    grupoCtx,
    inscripcion,
    cambios = [],
    {
      origen =
        "gestion_nomina",
      motivo =
        ""
    } = {}
  ) {
    const cambiosCriticos =
      cambios.filter(
        (cambio) =>
          CAMPOS_CRITICOS_SISTEMA_PAGOS.has(
            String(
              cambio?.campo ||
              ""
            )
          )
      );

    if (!cambiosCriticos.length) {
      return false;
    }

    const inscripcionId =
      String(
        inscripcion?.id ||
        ""
      ).trim();

    if (!inscripcionId) {
      return false;
    }

    /*
      Usamos un ID distinto a las alertas de
      Nuevo ingreso / Lista de espera para no
      sobrescribirlas.
    */
    const alertaId =
      `${String(
        grupoCtx.docId ||
        grupoCtx.groupId ||
        ""
      )}_${inscripcionId}_cambio_datos_criticos`;

    await setDoc(
      doc(
        db,
        ALERTAS_INSCRIPCIONES_COLLECTION,
        alertaId
      ),
      {
        activa:
          true,

        resuelta:
          false,

        tipoAlerta:
          "cambio_datos_criticos",

        requiereActualizarSistemaPagos:
          true,

        idGrupo:
          String(
            grupoCtx.groupId ||
            ""
          ),

        groupDocId:
          String(
            grupoCtx.docId ||
            ""
          ),

        inscripcionId,

        anoViaje:
          grupoCtx?.data?.anoViaje ||
          "",

        colegio:
          texto(
            grupoCtx?.data?.colegio
          ),

        curso:
          texto(
            grupoCtx?.data?.curso
          ),

        aliasGrupo:
          texto(
            grupoCtx?.data?.aliasGrupo ||
            grupoCtx?.data?.nombreGrupo ||
            grupoCtx?.data?.colegio
          ),

        numeroNegocio:
          texto(
            grupoCtx?.data?.numeroNegocio
          ),

        vendedora:
          texto(
            grupoCtx?.data?.vendedora ||
            grupoCtx?.data?.vendedoraCorreo
          ),

        vendedoraCorreo:
          normalizarEmail(
            grupoCtx?.data?.vendedoraCorreo ||
            ""
          ),

        documento:
          documento(
            inscripcion
          ),

        nombreParticipante:
          getNombrePasajeroManager(
            inscripcion
          ),

        nombreResponsable:
          texto(
            getByPathManager(
              inscripcion,
              "contactoPrincipal.nombre"
            )
          ),

        correoResponsable:
          normalizarEmail(
            getByPathManager(
              inscripcion,
              "contactoPrincipal.correo"
            )
          ),

        telefonoResponsable:
          texto(
            getByPathManager(
              inscripcion,
              "contactoPrincipal.celular"
            ) ||
            getByPathManager(
              inscripcion,
              "contactoPrincipal.telefono"
            )
          ),

        cambios:
          cambiosCriticos,

        motivo:
          texto(motivo),

        origen:
          texto(origen),

        actualizadoAt:
          serverTimestamp(),

        actualizadoPor:
          nombreUsuario,

        actualizadoPorCorreo:
          email
      },
      {
        merge:
          true
      }
    );

    return true;
  }

  async function actualizarDatosNomina(
    grupoCtx,
    inscripcionId,
    valores = {},
    motivo = ""
  ) {
    if (!puedeAdministrarNomina()) {
      throw new Error(
        "No tienes permisos para editar la nómina."
      );
    }

    const motivoLimpio =
      texto(
        motivo
      );

    if (!motivoLimpio) {
      throw new Error(
        "Debes indicar el motivo de la modificación."
      );
    }

    const item =
      await cargarInscripcionCompleta(
        grupoCtx,
        inscripcionId
      );

    if (!item) {
      throw new Error(
        "No se encontró la inscripción seleccionada."
      );
    }

    const patch =
      {};

    const cambios =
      [];

    for (
      const [
        path,
        nuevoValor
      ]
      of Object.entries(
        valores ||
        {}
      )
    ) {
      if (
        !CAMPOS_EDITABLES_NOMINA.has(
          path
        )
      ) {
        console.warn(
          "[inscripciones-manager] Campo de nómina rechazado:",
          path
        );

        continue;
      }

      const anterior =
        getByPathManager(
          item,
          path
        );

      if (
        valoresIgualesManager(
          anterior,
          nuevoValor
        )
      ) {
        continue;
      }

      patch[path] =
        nuevoValor;

      cambios.push({
        campo:
          path,

        anterior:
          anterior ?? "",

        nuevo:
          nuevoValor ?? ""
      });
    }

    if (!cambios.length) {
      return {
        ok:
          true,

        sinCambios:
          true,

        cambios:
          []
      };
    }

    /*
      Si cambió nombre o apellidos,
      mantenemos nombreCompleto consistente.

      IMPORTANTE:
      solamente actualizamos esta ruta puntual.
      NO reemplazamos identificacion completa.
    */
    const cambiaNombre =
      [
        "identificacion.nombres",
        "identificacion.primerApellido",
        "identificacion.segundoApellido"
      ].some(
        (path) =>
          Object.prototype
            .hasOwnProperty
            .call(
              patch,
              path
            )
      );

    if (cambiaNombre) {
      const nuevosNombres =
        patch[
          "identificacion.nombres"
        ] ??
        getByPathManager(
          item,
          "identificacion.nombres"
        ) ??
        "";

      const nuevoApellido1 =
        patch[
          "identificacion.primerApellido"
        ] ??
        getByPathManager(
          item,
          "identificacion.primerApellido"
        ) ??
        "";

      const nuevoApellido2 =
        patch[
          "identificacion.segundoApellido"
        ] ??
        getByPathManager(
          item,
          "identificacion.segundoApellido"
        ) ??
        "";

      patch[
        "identificacion.nombreCompleto"
      ] =
        [
          nuevosNombres,
          nuevoApellido1,
          nuevoApellido2
        ]
          .filter(Boolean)
          .join(" ")
          .trim();
    }

    patch[
      "auditoriaNomina.actualizadoAt"
    ] =
      serverTimestamp();

    patch[
      "auditoriaNomina.actualizadoPor"
    ] =
      nombreUsuario;

    patch[
      "auditoriaNomina.actualizadoPorCorreo"
    ] =
      email;

    patch[
      "auditoriaNomina.motivoUltimoCambio"
    ] =
      motivoLimpio;

    patch[
      "auditoriaNomina.version"
    ] =
      Number(
        item?.auditoriaNomina
          ?.version ||
        0
      ) + 1;

    patch.actualizadoAt =
      serverTimestamp();

    patch.actualizadoPor =
      nombreUsuario;

    patch.actualizadoPorCorreo =
      email;

    const inscripcionRef =
      doc(
        db,
        "ventas_cotizaciones",
        String(
          grupoCtx.docId
        ),
        "inscripciones",
        String(
          inscripcionId
        )
      );

    /*
      ESTE ES EL GUARDADO SEGURO.

      patch contiene exclusivamente rutas
      específicas que realmente cambiaron.
    */
    await updateDoc(
      inscripcionRef,
      patch
    );

    await registrarHistorialNominaPasajero(
      grupoCtx,
      item,
      {
        motivo:
          motivoLimpio,

        cambios,

        origen:
          "gestion_nomina",

        tipoMovimiento:
          "edicion_nomina_inscripcion",

        titulo:
          "Edición de nómina"
      }
    );

    await guardarAlertaCambioDatosCriticos(
      grupoCtx,
      item,
      cambios,
      {
        origen:
          "gestion_nomina",

        motivo:
          motivoLimpio
      }
    );

    cacheDetalle.delete(
      `${grupoCtx.docId}:${inscripcionId}`
    );

    await notificarCambio(
      grupoCtx,
      "edicion_nomina_inscripcion",
      {
        inscripcionId:
          String(
            inscripcionId
          ),

        motivo:
          motivoLimpio,

        campos:
          cambios.map(
            (item) =>
              item.campo
          )
      }
    );

    return {
      ok:
        true,

      sinCambios:
        false,

      cambios
    };
  }

  async function archivarPasajero(
    grupoCtx,
    inscripcionId,
    motivo = ""
  ) {
    if (!puedeAdministrarNomina()) {
      throw new Error(
        "No tienes permisos para archivar pasajeros."
      );
    }

    const motivoLimpio =
      texto(
        motivo
      );

    if (!motivoLimpio) {
      throw new Error(
        "Debes indicar por qué se archivará al pasajero."
      );
    }

    const item =
      await cargarInscripcionCompleta(
        grupoCtx,
        inscripcionId
      );

    if (!item) {
      throw new Error(
        "No se encontró la inscripción seleccionada."
      );
    }

    const estadoAnterior =
      texto(
        item?.privacidad?.estado
      );

    const inscripcionRef =
      doc(
        db,
        "ventas_cotizaciones",
        String(
          grupoCtx.docId
        ),
        "inscripciones",
        String(
          inscripcionId
        )
      );

    /*
      Archivo lógico:
      NO borra el documento.
    */
    await updateDoc(
      inscripcionRef,
      {
        "privacidad.estado":
          "archivada",

        "privacidad.archivadaAt":
          serverTimestamp(),

        "privacidad.archivadaPor":
          nombreUsuario,

        "privacidad.archivadaPorCorreo":
          email,

        "privacidad.motivoArchivo":
          motivoLimpio,

        actualizadoAt:
          serverTimestamp(),

        actualizadoPor:
          nombreUsuario,

        actualizadoPorCorreo:
          email
      }
    );

    const cambios = [
      {
        campo:
          "privacidad.estado",

        anterior:
          estadoAnterior,

        nuevo:
          "archivada"
      }
    ];

    await registrarHistorialNominaPasajero(
      grupoCtx,
      item,
      {
        motivo:
          motivoLimpio,

        cambios,

        origen:
          "gestion_nomina",

        tipoMovimiento:
          "pasajero_archivado",

        titulo:
          "Pasajero archivado"
      }
    );

    cacheDetalle.delete(
      `${grupoCtx.docId}:${inscripcionId}`
    );

    await notificarCambio(
      grupoCtx,
      "pasajero_archivado",
      {
        inscripcionId:
          String(
            inscripcionId
          ),

        motivo:
          motivoLimpio
      }
    );

    return {
      ok:
        true
    };
  }


  function getAlertaInscripcionId(grupoCtx, inscripcionId) {
    return `${String(grupoCtx?.docId || grupoCtx?.groupId || "").trim()}_${String(inscripcionId || "").trim()}`;
  }

  async function guardarAlertaInscripcion(
    grupoCtx,
    inscripcion,
    {
      tipoAlerta = "",
      activa = true,
      resuelta = false
    } = {}
  ) {
    const inscripcionId = String(inscripcion?.id || "").trim();

    if (!inscripcionId) {
      return;
    }

    const alertaRef = doc(
      db,
      ALERTAS_INSCRIPCIONES_COLLECTION,
      getAlertaInscripcionId(grupoCtx, inscripcionId)
    );

    const payload = {
      activa: activa === true,
      resuelta: resuelta === true,

      tipoAlerta,
      tipoInscripcion: tipo(inscripcion),
      estadoCupo: texto(inscripcion?.estadoCupo),

      idGrupo: String(grupoCtx?.groupId || ""),
      groupDocId: String(grupoCtx?.docId || ""),
      inscripcionId,

      anoViaje: grupoCtx?.data?.anoViaje || "",
      colegio: texto(grupoCtx?.data?.colegio),
      curso: texto(grupoCtx?.data?.curso),
      aliasGrupo:
        texto(grupoCtx?.data?.aliasGrupo) ||
        texto(grupoCtx?.data?.nombreGrupo) ||
        texto(grupoCtx?.data?.colegio) ||
        String(grupoCtx?.groupId || ""),

      vendedora:
        texto(grupoCtx?.data?.vendedora) ||
        texto(grupoCtx?.data?.vendedoraCorreo),

      vendedoraCorreo:
        normalizarEmail(
          grupoCtx?.data?.vendedoraCorreo ||
          ""
        ),

      documento: documento(inscripcion),

      nombreParticipante:
        [nombres(inscripcion), apellidos(inscripcion)]
          .filter(Boolean)
          .join(" ")
          .trim(),

      nombreResponsable:
        texto(
          valor(
            inscripcion,
            [
              "contactoPrincipal.nombre",
              "contactoPrincipal.nombreCompleto",
              "responsable.nombre",
              "apoderado.nombre"
            ]
          )
        ),

      correoResponsable:
        normalizarEmail(
          valor(
            inscripcion,
            [
              "contactoPrincipal.correo",
              "responsable.correo",
              "apoderado.correo",
              "correo"
            ]
          )
        ),

      telefonoResponsable:
        texto(
          valor(
            inscripcion,
            [
              "contactoPrincipal.celular",
              "contactoPrincipal.telefono",
              "contactoPrincipal.whatsapp",
              "responsable.telefono",
              "apoderado.telefono",
              "telefono"
            ]
          )
        ),

      fechaFormulario:
        valor(
          inscripcion,
          [
            "meta.fechaInscripcion",
            "meta.fechaFormularioCliente",
            "fechaInscripcion",
            "fechaFormularioCliente",
            "creadoEn",
            "createdAt",
            "fechaCreacion",
            "fechaAprobacion"
          ]
        ) || null,

      actualizadoAt: serverTimestamp(),
      actualizadoPor: nombreUsuario,
      actualizadoPorCorreo: email
    };

    if (resuelta === true) {
      payload.resueltaAt = serverTimestamp();
      payload.resueltaPor = nombreUsuario;
      payload.resueltaPorCorreo = email;
    } else {
      payload.resueltaAt = deleteField();
      payload.resueltaPor = deleteField();
      payload.resueltaPorCorreo = deleteField();
    }

    await setDoc(
      alertaRef,
      payload,
      {
        merge: true
      }
    );
  }

  async function registrarHistorialOperacion(
    grupoCtx,
    {
      tipoMovimiento,
      titulo,
      mensaje,
      inscripcion
    }
  ) {
    try {
      await setDoc(
        doc(
          collection(
            db,
            "ventas_historial"
          )
        ),
        {
          idGrupo: grupoCtx.groupId,
          groupDocId: grupoCtx.docId,

          tipoMovimiento,
          modulo: "inscripcion",
          titulo,
          mensaje,

          metadata: {
            inscripcionId:
              String(
                inscripcion?.id ||
                ""
              ),

            documento:
              documento(
                inscripcion
              ),

            nombreCompleto:
              [
                nombres(inscripcion),
                apellidos(inscripcion)
              ]
                .filter(Boolean)
                .join(" ")
                .trim()
          },

          fecha: serverTimestamp(),
          creadoPor: nombreUsuario,
          creadoPorCorreo: email
        }
      );
    } catch (error) {
      console.warn(
        "[inscripciones-manager] registrarHistorialOperacion",
        error
      );
    }
  }

  async function esperarActualizacionResumen(
    grupoCtx,
    inscripcionId,
    {
      tipoEsperado = "",
      estadoCupoEsperado = "",
      intentos = 7,
      esperaMs = 450
    } = {}
  ) {
    const normalTipo =
      normalizar(
        tipoEsperado
      )
        .replace(
          /\s+/g,
          "_"
        );

    const normalEstado =
      normalizar(
        estadoCupoEsperado
      )
        .replace(
          /\s+/g,
          "_"
        );

    for (
      let intento = 0;
      intento < intentos;
      intento += 1
    ) {
      await new Promise(
        (resolve) =>
          window.setTimeout(
            resolve,
            esperaMs
          )
      );

      try {
        const snap =
          await getDoc(
            doc(
              db,
              "ventas_cotizaciones",
              String(grupoCtx.docId),
              "nomina_resumen",
              String(inscripcionId)
            )
          );

        if (!snap.exists()) {
          continue;
        }

        const data =
          snap.data() ||
          {};

        const tipoActual =
          normalizar(
            data.tipoInscripcion ||
            data.estadoInscripcion ||
            ""
          )
            .replace(
              /\s+/g,
              "_"
            );

        const estadoActual =
          normalizar(
            data.estadoCupo ||
            ""
          )
            .replace(
              /\s+/g,
              "_"
            );

        const coincideTipo =
          !normalTipo ||
          tipoActual ===
            normalTipo;

        const coincideEstado =
          !normalEstado ||
          estadoActual ===
            normalEstado;

        if (
          coincideTipo &&
          coincideEstado
        ) {
          return true;
        }
      } catch (error) {
        console.warn(
          "[inscripciones-manager] esperando nomina_resumen",
          error
        );
      }
    }

    return false;
  }

  async function marcarListaEsperaPagada(
    grupoCtx,
    inscripcionId
  ) {
    if (!puedeMarcarListaEsperaPagada()) {
      throw new Error(
        "Solo Administración, Supervisión o Admin pueden marcar la lista de espera como pagada."
      );
    }

    const item =
      await cargarInscripcionCompleta(
        grupoCtx,
        inscripcionId
      );

    if (!item) {
      throw new Error(
        "No se encontró la inscripción seleccionada."
      );
    }

    const tipoActual =
      normalizar(
        tipo(item)
      )
        .replace(
          /\s+/g,
          "_"
        );

    const estadoActual =
      normalizar(
        item.estadoCupo ||
        ""
      )
        .replace(
          /\s+/g,
          "_"
        );

    const esListaPendiente =
      tipoActual ===
        "lista_espera" &&
      ![
        "pagado",
        "confirmado"
      ].includes(
        estadoActual
      );

    if (!esListaPendiente) {
      throw new Error(
        "Esta inscripción ya no está como lista de espera pendiente."
      );
    }

    await updateDoc(
      doc(
        db,
        "ventas_cotizaciones",
        String(grupoCtx.docId),
        "inscripciones",
        String(inscripcionId)
      ),
      {
        tipoInscripcion:
          "lista_espera_pagada",

        estadoCupo:
          "pagado",

        listaEsperaPagada:
          true,

        listaEsperaPagadaPor:
          nombreUsuario,

        listaEsperaPagadaPorCorreo:
          email,

        listaEsperaPagadaAt:
          serverTimestamp(),

        actualizadoAt:
          serverTimestamp(),

        actualizadoPor:
          nombreUsuario,

        actualizadoPorCorreo:
          email
      }
    );

    const actualizado = {
      ...item,
      tipoInscripcion:
        "lista_espera_pagada",
      estadoCupo:
        "pagado",
      listaEsperaPagada:
        true
    };

    /*
      La alerta no desaparece:
      cambia desde "pendiente de pago" a
      "pagada pendiente de confirmar".
    */
    await guardarAlertaInscripcion(
      grupoCtx,
      actualizado,
      {
        tipoAlerta:
          "lista_espera_pagada_pendiente_confirmar",

        activa:
          true,

        resuelta:
          false
      }
    );

    await registrarHistorialOperacion(
      grupoCtx,
      {
        tipoMovimiento:
          "inscripcion_lista_espera_pagada",

        titulo:
          "Lista de espera pagada",

        mensaje:
          `${nombreUsuario} marcó como pagada la lista de espera de ${
            [
              nombres(item),
              apellidos(item)
            ]
              .filter(Boolean)
              .join(" ")
              .trim() ||
            "una persona"
          }.`,

        inscripcion:
          item
      }
    );

    cacheDetalle.delete(
      `${grupoCtx.docId}:${inscripcionId}`
    );

    await esperarActualizacionResumen(
      grupoCtx,
      inscripcionId,
      {
        tipoEsperado:
          "lista_espera_pagada",

        estadoCupoEsperado:
          "pagado"
      }
    );

    await notificarCambio(
      grupoCtx,
      "lista_espera_pagada",
      {
        inscripcionId:
          String(inscripcionId)
      }
    );

    return actualizado;
  }

  async function confirmarCupoListaEspera(
    grupoCtx,
    inscripcionId
  ) {
    if (!puedeConfirmarIngresoOCupo()) {
      throw new Error(
        "Solo Registro, Administración, Supervisión o Admin pueden confirmar el cupo."
      );
    }

    const item =
      await cargarInscripcionCompleta(
        grupoCtx,
        inscripcionId
      );

    if (!item) {
      throw new Error(
        "No se encontró la inscripción seleccionada."
      );
    }

    const estadoActual =
      normalizar(
        item.estadoCupo ||
        ""
      )
        .replace(
          /\s+/g,
          "_"
        );

    if (
      estadoActual !==
      "pagado"
    ) {
      throw new Error(
        "Antes de confirmar el cupo, la lista de espera debe estar marcada como pagada."
      );
    }

    await updateDoc(
      doc(
        db,
        "ventas_cotizaciones",
        String(grupoCtx.docId),
        "inscripciones",
        String(inscripcionId)
      ),
      {
        tipoInscripcion:
          "lista_espera_confirmada",

        estadoCupo:
          "confirmado",

        confirmadoDesdeListaEspera:
          true,

        confirmadoCupoPor:
          nombreUsuario,

        confirmadoCupoPorCorreo:
          email,

        confirmadoCupoAt:
          serverTimestamp(),

        actualizadoAt:
          serverTimestamp(),

        actualizadoPor:
          nombreUsuario,

        actualizadoPorCorreo:
          email
      }
    );

    const actualizado = {
      ...item,
      tipoInscripcion:
        "lista_espera_confirmada",
      estadoCupo:
        "confirmado",
      confirmadoDesdeListaEspera:
        true
    };

    await guardarAlertaInscripcion(
      grupoCtx,
      actualizado,
      {
        tipoAlerta:
          "",

        activa:
          false,

        resuelta:
          true
      }
    );

    await registrarHistorialOperacion(
      grupoCtx,
      {
        tipoMovimiento:
          "inscripcion_lista_espera_confirmada",

        titulo:
          "Cupo confirmado desde lista de espera pagada",

        mensaje:
          `${nombreUsuario} confirmó cupo para ${
            [
              nombres(item),
              apellidos(item)
            ]
              .filter(Boolean)
              .join(" ")
              .trim() ||
            "una persona"
          } desde lista de espera pagada.`,

        inscripcion:
          item
      }
    );

    cacheDetalle.delete(
      `${grupoCtx.docId}:${inscripcionId}`
    );

    await esperarActualizacionResumen(
      grupoCtx,
      inscripcionId,
      {
        tipoEsperado:
          "lista_espera_confirmada",

        estadoCupoEsperado:
          "confirmado"
      }
    );

    await notificarCambio(
      grupoCtx,
      "lista_espera_confirmada",
      {
        inscripcionId:
          String(inscripcionId)
      }
    );

    return actualizado;
  }

  async function confirmarNuevoIngreso(
    grupoCtx,
    inscripcionId
  ) {
    if (!puedeConfirmarIngresoOCupo()) {
      throw new Error(
        "Solo Registro, Administración, Supervisión o Admin pueden confirmar nuevos ingresos."
      );
    }

    const item =
      await cargarInscripcionCompleta(
        grupoCtx,
        inscripcionId
      );

    if (!item) {
      throw new Error(
        "No se encontró la inscripción seleccionada."
      );
    }

    const tipoActual =
      normalizar(
        tipo(item)
      )
        .replace(
          /\s+/g,
          "_"
        );

    const estadoActual =
      normalizar(
        item.estadoCupo ||
        ""
      )
        .replace(
          /\s+/g,
          "_"
        );

    if (
      tipoActual !==
        "nuevo_ingreso" ||
      estadoActual ===
        "confirmado"
    ) {
      throw new Error(
        "Esta inscripción ya no está como nuevo ingreso pendiente."
      );
    }

    await updateDoc(
      doc(
        db,
        "ventas_cotizaciones",
        String(grupoCtx.docId),
        "inscripciones",
        String(inscripcionId)
      ),
      {
        tipoInscripcion:
          "nuevo_ingreso_confirmado",

        estadoCupo:
          "confirmado",

        nuevoIngresoConfirmado:
          true,

        nuevoIngresoConfirmadoPor:
          nombreUsuario,

        nuevoIngresoConfirmadoPorCorreo:
          email,

        nuevoIngresoConfirmadoAt:
          serverTimestamp(),

        actualizadoAt:
          serverTimestamp(),

        actualizadoPor:
          nombreUsuario,

        actualizadoPorCorreo:
          email
      }
    );

    const actualizado = {
      ...item,
      tipoInscripcion:
        "nuevo_ingreso_confirmado",
      estadoCupo:
        "confirmado",
      nuevoIngresoConfirmado:
        true
    };

    await guardarAlertaInscripcion(
      grupoCtx,
      actualizado,
      {
        tipoAlerta:
          "",

        activa:
          false,

        resuelta:
          true
      }
    );

    await registrarHistorialOperacion(
      grupoCtx,
      {
        tipoMovimiento:
          "inscripcion_nuevo_ingreso_confirmado",

        titulo:
          "Nuevo ingreso confirmado",

        mensaje:
          `${nombreUsuario} confirmó como nuevo ingreso a ${
            [
              nombres(item),
              apellidos(item)
            ]
              .filter(Boolean)
              .join(" ")
              .trim() ||
            "una persona"
          }.`,

        inscripcion:
          item
      }
    );

    cacheDetalle.delete(
      `${grupoCtx.docId}:${inscripcionId}`
    );

    await esperarActualizacionResumen(
      grupoCtx,
      inscripcionId,
      {
        tipoEsperado:
          "nuevo_ingreso_confirmado",

        estadoCupoEsperado:
          "confirmado"
      }
    );

    await notificarCambio(
      grupoCtx,
      "nuevo_ingreso_confirmado",
      {
        inscripcionId:
          String(inscripcionId)
      }
    );

    return actualizado;
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
    resolverGrupo,
    recargarGrupo,
    detectarOrigenNomina,
    cargarNomina,
    cargarInscripcionCompleta,

    obtenerEstadoFases,
    abrirFase,
    cerrarFase,

    marcarCargadoPagos,
    actualizarPasajero,

    /*
      NUEVO EDITOR SEGURO
    */
    actualizarDatosNomina,
    archivarPasajero,

    marcarListaEsperaPagada,
    confirmarCupoListaEspera,
    confirmarNuevoIngreso,

    resetearCiclo,
    archivarNomina,

    puedeGestionarLinks,
    puedeAdministrarNomina,
    puedeMarcarListaEsperaPagada,
    puedeConfirmarIngresoOCupo,
    esAdminOSupervision
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
function documento(i) {
  return texto(
    valor(
      i,
      [
        "identificacion.documento",
        "identificacion.rutCompleto",
        "identificacion.documentoNormalizado",
        "rut",
        "documento",
        "pasajero.rut",
        "datosPersonales.rut",
        "participante.rut"
      ]
    ) || i?.id
  );
}

function nombres(i) {
  return texto(
    valor(
      i,
      [
        "identificacion.nombres",
        "identificacion.nombre",
        "nombre",
        "nombres",
        "pasajero.nombre",
        "pasajero.nombres",
        "datosPersonales.nombre",
        "datosPersonales.nombres",
        "participante.nombre",
        "participante.nombres"
      ]
    )
  );
}

function apellidos(i) {
  const directo =
    texto(
      valor(
        i,
        [
          "identificacion.apellidos",
          "apellido",
          "apellidos",
          "pasajero.apellido",
          "pasajero.apellidos",
          "datosPersonales.apellido",
          "datosPersonales.apellidos",
          "participante.apellido",
          "participante.apellidos"
        ]
      )
    );

  if (directo) {
    return directo;
  }

  const primerApellido =
    texto(
      valor(
        i,
        [
          "identificacion.primerApellido",
          "primerApellido",
          "pasajero.primerApellido",
          "datosPersonales.primerApellido",
          "participante.primerApellido"
        ]
      )
    );

  const segundoApellido =
    texto(
      valor(
        i,
        [
          "identificacion.segundoApellido",
          "segundoApellido",
          "pasajero.segundoApellido",
          "datosPersonales.segundoApellido",
          "participante.segundoApellido"
        ]
      )
    );

  return [
    primerApellido,
    segundoApellido
  ]
    .filter(Boolean)
    .join(" ");
}
function tipo(i) { return texto(valor(i,["tipoInscripcion","tipo","pasajero.tipo"])); }
function estado(i) { return texto(valor(i,["estado","estadoInscripcion","estadoCupo","pasajero.estado"])); }
function correo(i) { return texto(valor(i,["correo","contactoPrincipal.correo","pasajero.correo","datosContacto.correo"])); }
function telefono(i) { return texto(valor(i,["telefono","contactoPrincipal.telefono","contactoPrincipal.celular","pasajero.telefono"])); }
export function fichaCompleta(
  i = {}
) {
  const tipoNormalizado =
    normalizar(
      valor(
        i,
        [
          "tipoInscripcion",
          "tipo",
          "estadoInscripcion",
          "faseInscripcion",
          "pasajero.tipo"
        ]
      )
    )
      .replace(
        /\s+/g,
        "_"
      );

  /*
    Regla de negocio:

    Los formularios públicos exigen completar
    la ficha médica antes de poder guardarse.

    Por lo tanto, estas inscripciones siempre
    tienen ficha médica completa.
  */
  const tiposFormularioCompleto =
    new Set([
      "inscripcion_inicial",
      "nomina_inicial",
      "normal",

      "nomina_final",
      "nomina_final_ficha_medica",

      "nuevo_ingreso",
      "nuevo_ingreso_confirmado",
      "nuevos",
      "nuevo_inscrito",

      "lista_espera",
      "lista_espera_pagada",
      "lista_espera_confirmada",

      "liberado",
      "cupo_liberado"
    ]);

  if (
    tiposFormularioCompleto.has(
      tipoNormalizado
    )
  ) {
    return true;
  }

  /*
    Único origen que puede tener una ficha médica
    realmente pendiente:

    Sistema de Pagos.

    En ese caso revisamos las marcas explícitas
    que indican que posteriormente completó
    la ficha médica.
  */
  if (
    tipoNormalizado ===
      "sistema_pagos" ||
    tipoNormalizado ===
      "sistema_de_pagos"
  ) {
    const marcaBooleana =
      valor(
        i,
        [
          "fichaCompleta",
          "fichaMedicaCompleta",
          "nominaFinalCompleta",
          "fichaMedicaCompletada",
          "nominaFinalCompletada",
          "fichaMedica.completa"
        ]
      );

    if (
      marcaBooleana ===
      true
    ) {
      return true;
    }

    const estadoFicha =
      normalizar(
        valor(
          i,
          [
            "fichaMedicaEstado",
            "estadoFichaMedica",
            "fichaMedica.estado"
          ]
        )
      )
        .replace(
          /\s+/g,
          "_"
        );

    return [
      "completa",
      "completada",
      "completo",
      "ok",
      "confirmada"
    ].includes(
      estadoFicha
    );
  }

  /*
    Respaldo para inscripciones antiguas o con
    un tipo no reconocido.

    No las declaramos completas automáticamente:
    revisamos sus marcas explícitas.
  */
  const marcaBooleana =
    valor(
      i,
      [
        "fichaCompleta",
        "fichaMedicaCompleta",
        "nominaFinalCompleta",
        "fichaMedicaCompletada",
        "nominaFinalCompletada",
        "fichaMedica.completa"
      ]
    );

  if (
    marcaBooleana ===
    true
  ) {
    return true;
  }

  const estadoFicha =
    normalizar(
      valor(
        i,
        [
          "fichaMedicaEstado",
          "estadoFichaMedica",
          "fichaMedica.estado"
        ]
      )
    )
      .replace(
        /\s+/g,
        "_"
      );

  return [
    "completa",
    "completada",
    "completo",
    "ok",
    "confirmada"
  ].includes(
    estadoFicha
  );
}
function tieneCarnet(i) { return valor(i,["tieneCarnet","tieneCarnetIdentidad","sistemaPagos.tieneCarnet","documentos.carnetIdentidad"]) === true; }
function estaAnulada(i) { return i?.anulado === true || i?.anulada === true || normalizar(estado(i)).includes("anulad") || normalizar(i?.estadoViaje).includes("no viaja"); }
function texto(v) { return String(v ?? "").trim(); }
function normalizar(v) { return texto(v).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); }
function normalizarEmail(v) { return normalizar(v).replace(/\s+/g, ""); }
