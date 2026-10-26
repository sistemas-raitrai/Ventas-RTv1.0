import {
  collection,
  doc,
  getDoc,
  getDocs,
  writeBatch,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";

/* =========================================================
   FECHAS Y CLASIFICACIÓN DE GESTIONES
========================================================= */

export function fechaGestion(value) {
  if (!value) return null;

  if (typeof value.toDate === "function") {
    return value.toDate();
  }

  if (value instanceof Date) {
    return value;
  }

  const valor = String(value);

  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(valor)
    ? new Date(`${valor}T12:00:00`)
    : new Date(value);

  return Number.isNaN(fecha.getTime()) ? null : fecha;
}

export function esGestionComercial(item = {}) {
  if (
    item.esGestionComercial === true ||
    item.tipoMovimiento === "gestion_comercial"
  ) {
    return true;
  }

  /*
    Compatibilidad con gestiones registradas desde el formulario
    anterior de Cartera.

    No se consideran como gestión las ediciones o creaciones
    administrativas del colegio.
  */
  const tiposAnteriores = [
    "Seguimiento comercial",
    "Seguimiento / visita"
  ];

  return (
    tiposAnteriores.includes(item.tipo) &&
    !!(
      item.metadata?.fechaGestion ||
      item.metadata?.fechaVisita
    )
  );
}

export function fechaEventoGestion(item = {}) {
  return fechaGestion(
    item.fechaGestion ||
    item.metadata?.fechaGestion ||
    item.metadata?.fechaVisita ||
    item.fecha
  );
}

export function gestionEn30Dias(item = {}, ahora = new Date()) {
  const fecha = fechaEventoGestion(item);

  if (!fecha) return false;

  /*
    Se consideran 30 días calendario:
    hoy y los 29 días anteriores.
  */
  const inicio = new Date(ahora);
  inicio.setHours(0, 0, 0, 0);
  inicio.setDate(inicio.getDate() - 29);

  const fin = new Date(ahora);
  fin.setHours(23, 59, 59, 999);

  return fecha >= inicio && fecha <= fin;
}

/* =========================================================
   FUNCIONES AUXILIARES
========================================================= */

function texto(value) {
  return String(value ?? "").trim();
}

function email(value) {
  return texto(value).toLowerCase();
}

function normal(value) {
  return texto(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function hoy() {
  const fecha = new Date();

  const yyyy = fecha.getFullYear();

  const mm = String(fecha.getMonth() + 1)
    .padStart(2, "0");

  const dd = String(fecha.getDate())
    .padStart(2, "0");

  return `${yyyy}-${mm}-${dd}`;
}

/* =========================================================
   FORMULARIO COMPARTIDO DE GESTIÓN COMERCIAL

   - Desde Cartera: registra una gestión del colegio.
   - Desde Grupo: registra la gestión en el grupo y
     en la cartera del colegio seleccionado.
========================================================= */

export function abrirRegistroGestion({
  db,
  usuario,
  usuarioReal,
  puedeGuardar,
  colegio = null,
  grupo = null,
  onSaved
}) {
  if (!puedeGuardar()) {
    alert("No tienes permisos para registrar esta gestión.");
    return;
  }

  /*
    Evita abrir el mismo formulario más de una vez.
  */
  if (document.getElementById("registroGestionComercial")) {
    return;
  }

  const dialog = document.createElement("dialog");

  dialog.id = "registroGestionComercial";

  dialog.style.cssText = [
    "width:min(560px, 90vw)",
    "max-height:90vh",
    "overflow:auto",
    "border:1px solid #ddd",
    "border-radius:14px",
    "padding:24px",
    "box-sizing:border-box"
  ].join(";");

  dialog.innerHTML = `
    <form style="display:grid;gap:12px">

      <h2 style="margin:0">
        Registrar gestión
      </h2>

      <p
        data-contexto
        style="margin:0"
      ></p>

      <fieldset data-vinculo>
        <legend>
          Colegio de la cartera
        </legend>

        <div style="display:grid;gap:10px">

          <label>
            Correo del vendedor de la cartera

            <input
              name="vendedor"
              type="email"
              style="display:block;width:95%"
            >
          </label>

          <button
            type="button"
            data-cargar
          >
            Cargar colegios
          </button>

          <label>
            Colegio

            <select
              name="colegio"
              style="display:block;width:100%"
            ></select>
          </label>

          <small>
            Confirma el colegio. La gestión del grupo contará
            para este colegio.
          </small>

        </div>
      </fieldset>

      <label>
        Tipo de gestión

        <select
          name="tipo"
          required
          style="display:block;width:100%"
        >
          <option value="">Seleccionar</option>
          <option value="LLAMADA">LLAMADA</option>
          <option value="CORREO">CORREO</option>
          <option value="VISITA">VISITA</option>
          <option value="REUNION">REUNIÓN</option>
          <option value="WHATSAPP">WHATSAPP</option>
          <option value="OTRO">OTRO</option>
        </select>
      </label>

      <label>
        Fecha de la gestión

        <input
          name="fecha"
          type="date"
          required
        >
      </label>

      <label>
        Asunto

        <input
          name="asunto"
          required
          maxlength="200"
          style="display:block;width:95%"
        >
      </label>

      <label>
        Detalle

        <textarea
          name="detalle"
          required
          rows="4"
          maxlength="10000"
          style="display:block;width:95%"
        ></textarea>
      </label>

      <p
        data-error
        role="alert"
        style="color:#a21b1b;margin:0"
      ></p>

      <div>
        <button type="submit">
          Guardar gestión
        </button>

        <button
          type="button"
          data-cerrar
        >
          Cancelar
        </button>
      </div>

    </form>
  `;

  /* =========================================================
   ESTILOS DEL FORMULARIO DE GESTIÓN

   Se aplican tanto en Grupo como en Cartera.
  ========================================================= */
  
  const estilosGestion = document.createElement("style");
  
  estilosGestion.textContent = `
    #registroGestionComercial {
      width: min(580px, calc(100vw - 32px)) !important;
      max-width: 580px;
      max-height: calc(100vh - 32px) !important;
  
      padding: 0 !important;
  
      border: 1px solid #ded9e6 !important;
      border-radius: 18px !important;
  
      background: #ffffff;
      color: #30263c;
  
      box-shadow: 0 24px 70px rgba(25, 15, 38, 0.28);
  
      overflow-y: auto;
      box-sizing: border-box;
  
      font-family: Arial, sans-serif;
    }
  
    #registroGestionComercial::backdrop {
      background: rgba(20, 12, 30, 0.55);
    }
  
    #registroGestionComercial form {
      display: grid;
      gap: 14px !important;
  
      padding: 0 22px 22px;
    }
  
    #registroGestionComercial h2 {
      margin: 0 -22px !important;
      padding: 19px 22px;
  
      background: var(--header, #2e1942);
      color: #ffffff;
  
      font-size: 21px;
      font-weight: 800;
      line-height: 1.2;
    }
  
    #registroGestionComercial [data-contexto] {
      margin: 2px 0 0 !important;
  
      color: #655b70;
      font-size: 13px;
      font-weight: 600;
      line-height: 1.4;
    }
  
    #registroGestionComercial fieldset {
      min-width: 0;
  
      margin: 0;
      padding: 14px;
  
      border: 1px solid #ddd4e8;
      border-radius: 12px;
  
      background: #faf8fd;
    }
  
    #registroGestionComercial fieldset[hidden] {
      display: none !important;
    }
  
    #registroGestionComercial legend {
      padding: 0 7px;
  
      color: #4c3265;
      font-size: 13px;
      font-weight: 800;
    }
  
    #registroGestionComercial label {
      display: flex;
      flex-direction: column;
      gap: 6px;
  
      color: #453750;
      font-size: 13px;
      font-weight: 700;
      line-height: 1.35;
    }
  
    #registroGestionComercial input,
    #registroGestionComercial select,
    #registroGestionComercial textarea {
      display: block;
  
      width: 100% !important;
      min-width: 0;
      min-height: 42px;
  
      padding: 10px 12px;
  
      border: 1px solid #cfc8d9;
      border-radius: 9px;
  
      background: #ffffff;
      color: #30263c;
  
      box-sizing: border-box;
  
      font: inherit;
      font-size: 14px;
      font-weight: 400;
    }
  
    #registroGestionComercial textarea {
      min-height: 105px;
      resize: vertical;
    }
  
    #registroGestionComercial input:focus,
    #registroGestionComercial select:focus,
    #registroGestionComercial textarea:focus {
      outline: none;
  
      border-color: #8060a5;
  
      box-shadow: 0 0 0 3px rgba(128, 96, 165, 0.16);
    }
  
    #registroGestionComercial small {
      color: #6c6375;
      font-size: 12px;
      line-height: 1.4;
    }
  
    #registroGestionComercial button {
      min-height: 40px;
  
      padding: 9px 15px;
  
      border: none;
      border-radius: 9px;
  
      cursor: pointer;
  
      font-family: inherit;
      font-size: 13px;
      font-weight: 800;
  
      transition: opacity 0.15s ease, transform 0.15s ease;
    }
  
    #registroGestionComercial button:hover:not(:disabled) {
      opacity: 0.9;
      transform: translateY(-1px);
    }
  
    #registroGestionComercial button:disabled {
      cursor: wait;
      opacity: 0.6;
    }
  
    #registroGestionComercial [data-cargar] {
      width: fit-content;
  
      background: #eae3f2;
      color: #4c3265;
    }
  
    #registroGestionComercial button[type="submit"] {
      background: #157347;
      color: #ffffff;
    }
  
    #registroGestionComercial [data-cerrar] {
      background: #eeeaf1;
      color: #51465c;
    }
  
    #registroGestionComercial form > div:last-child {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      flex-wrap: wrap;
  
      margin-top: 4px;
      padding-top: 14px;
  
      border-top: 1px solid #ebe7ef;
    }
  
    #registroGestionComercial [data-error] {
      color: #b42318 !important;
      font-size: 13px;
      font-weight: 700;
      line-height: 1.4;
    }
  
    #registroGestionComercial [data-error]:empty {
      display: none;
    }
  
    @media (max-width: 600px) {
      #registroGestionComercial {
        width: calc(100vw - 24px) !important;
        max-height: calc(100vh - 24px) !important;
      }
  
      #registroGestionComercial form {
        padding-right: 16px;
        padding-left: 16px;
      }
  
      #registroGestionComercial h2 {
        margin-right: -16px !important;
        margin-left: -16px !important;
        padding-right: 16px;
        padding-left: 16px;
      }
  
      #registroGestionComercial form > div:last-child button {
        flex: 1 1 auto;
      }
    }
  `;
  
  dialog.appendChild(estilosGestion);

  const form = dialog.querySelector("form");

  const campo = (name) => {
    return form.elements.namedItem(name);
  };

  const errorEl = dialog.querySelector("[data-error]");

  let saving = false;
  let opciones = [];

  function cerrar() {
    if (saving) return;

    dialog.close();
    dialog.remove();
  }

  dialog.querySelector("[data-cerrar]").onclick = cerrar;

  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    cerrar();
  });

  dialog.querySelector("[data-contexto]").textContent = grupo
    ? `Grupo: ${
        grupo.data.aliasGrupo ||
        grupo.data.colegio ||
        grupo.id
      }`
    : `Colegio: ${
        colegio.colegio ||
        colegio.numeroColegio
      }`;

  campo("fecha").value = hoy();
  campo("fecha").max = hoy();

  const enlace = grupo?.data?.carteraVinculo;

  campo("vendedor").value =
    enlace?.correoVendedor ||
    grupo?.data?.vendedoraCorreo ||
    "";

  /*
    La selección de colegio solo se muestra cuando
    la gestión se registra desde un grupo.

    En Cartera ya sabemos a qué colegio corresponde.
  */
  const fieldsetVinculo = dialog.querySelector("[data-vinculo]");
  
  /*
    Desde Cartera ya se conoce el colegio.
  
    Desde Grupo intentaremos encontrarlo automáticamente.
    El selector solo aparecerá si no podemos identificarlo
    de forma segura.
  */
  fieldsetVinculo.hidden = true;
  fieldsetVinculo.disabled = !grupo;
  /* =======================================================
     CARGAR COLEGIOS DE LA CARTERA DEL VENDEDOR
  ======================================================= */

  async function cargarColegios() {
    errorEl.textContent = "";
  
    const vendedor = email(campo("vendedor").value);
  
    opciones = [];
  
    campo("colegio").replaceChildren(
      new Option("Seleccionar colegio", "")
    );
  
    /*
      Si no conocemos la cartera de la vendedora,
      mostramos los campos para que se puedan completar.
    */
    if (!vendedor || vendedor.includes("/")) {
      fieldsetVinculo.hidden = false;
      fieldsetVinculo.disabled = false;
  
      errorEl.textContent =
        "Indica el correo de la cartera para identificar el colegio.";
  
      return;
    }
  
    try {
      const snap = await getDocs(
        collection(
          db,
          "ventas_cartera",
          vendedor,
          "items"
        )
      );
  
      opciones = snap.docs.map((documento) => ({
        ...documento.data(),
  
        numeroColegio: documento.id,
  
        correoVendedor: vendedor
      }));
  
      opciones.sort((a, b) => {
        return texto(a.colegio).localeCompare(
          texto(b.colegio)
        );
      });
  
      opciones.forEach((registro, indice) => {
        const nombre =
          registro.colegio ||
          registro.numeroColegio;
  
        const comuna = registro.comuna || "";
  
        const etiqueta =
          `${nombre} · ${comuna} · N° ${registro.numeroColegio}`;
  
        campo("colegio").add(
          new Option(etiqueta, String(indice))
        );
      });
  
      /*
        1. Primero buscamos el vínculo que ya se guardó
           anteriormente en el grupo.
      */
      let indiceSeleccionado = opciones.findIndex((registro) => {
        return (
          enlace &&
          email(enlace.correoVendedor) === vendedor &&
          String(enlace.numeroColegio) ===
            String(registro.numeroColegio)
        );
      });
  
      /*
        Si el grupo tenía un vínculo guardado pero ya no
        existe en esa cartera, pedimos revisar la selección.
      */
      if (enlace && indiceSeleccionado < 0) {
        fieldsetVinculo.hidden = false;
        fieldsetVinculo.disabled = false;
  
        errorEl.textContent =
          "El colegio vinculado anteriormente no se encontró. " +
          "Selecciona nuevamente el colegio de la cartera.";
  
        return;
      }
  
      /*
        2. Si todavía no existe vínculo, buscamos una
           coincidencia única por nombre y comuna.
      */
      if (indiceSeleccionado < 0) {
        const nombreGrupo = normal(grupo?.data?.colegio);
  
        const comunaGrupo = normal(
          grupo?.data?.comunaCiudad ||
          grupo?.data?.comuna ||
          ""
        );
  
        const coincidencias = opciones
          .map((registro, indice) => ({
            registro,
            indice
          }))
          .filter(({ registro }) => {
            const nombreCartera = normal(registro.colegio);
  
            if (!nombreGrupo || nombreCartera !== nombreGrupo) {
              return false;
            }
  
            const comunaCartera = normal(
              registro.comuna || ""
            );
  
            /*
              Si ambas comunas existen, deben coincidir.
              Si alguna está vacía, seguimos considerando
              la coincidencia por nombre.
            */
            if (comunaGrupo && comunaCartera) {
              return comunaGrupo === comunaCartera;
            }
  
            return true;
          });
  
        if (coincidencias.length === 1) {
          indiceSeleccionado = coincidencias[0].indice;
        }
      }
  
      /*
        Si encontramos un único colegio, lo seleccionamos
        internamente y ocultamos el selector.
      */
      if (indiceSeleccionado >= 0) {
        campo("colegio").value = String(indiceSeleccionado);
  
        fieldsetVinculo.hidden = true;
        fieldsetVinculo.disabled = false;
  
        return;
      }
  
      /*
        Si no hay coincidencia o hay varias, dejamos
        que el usuario indique el colegio correcto.
      */
      fieldsetVinculo.hidden = false;
      fieldsetVinculo.disabled = false;
  
      if (!opciones.length) {
        errorEl.textContent =
          "No se encontraron colegios en esta cartera. " +
          "Revisa el correo de la vendedora.";
      } else {
        errorEl.textContent =
          "No se pudo identificar un colegio único. " +
          "Selecciona el colegio correspondiente.";
      }
  
    } catch (error) {
      console.error(
        "No se pudieron cargar los colegios:",
        error
      );
  
      fieldsetVinculo.hidden = false;
      fieldsetVinculo.disabled = false;
  
      errorEl.textContent =
        "No se pudo consultar la cartera: " +
        (error.message || "error desconocido");
    }
  }
  dialog.querySelector("[data-cargar]").onclick =
    cargarColegios;

  campo("vendedor").oninput = () => {
    opciones = [];

    campo("colegio").replaceChildren(
      new Option(
        "Carga los colegios de este vendedor",
        ""
      )
    );
  };

  /* =======================================================
     GUARDAR GESTIÓN
  ======================================================= */

  form.onsubmit = async (event) => {
    event.preventDefault();

    if (saving) return;

    errorEl.textContent = "";

    if (!puedeGuardar()) {
      errorEl.textContent =
        "No tienes permisos para registrar esta gestión.";

      return;
    }

    const seleccionado = campo("colegio").value;

    const destino = grupo
      ? (
          seleccionado === ""
            ? null
            : opciones[Number(seleccionado)]
        )
      : colegio;

    if (!destino) {
      if (grupo) {
        fieldsetVinculo.hidden = false;
        fieldsetVinculo.disabled = false;
      }
    
      errorEl.textContent =
        "Aún no se ha identificado el colegio de la cartera. " +
        "Espera la búsqueda o selecciona el colegio correspondiente.";
    
      return;
    }

    const fecha = campo("fecha").value;

    const tipo = campo("tipo").value;

    const asunto = texto(campo("asunto").value);

    const detalle = texto(campo("detalle").value);

    if (
      !tipo ||
      !fechaGestion(fecha) ||
      fecha > hoy() ||
      !asunto ||
      !detalle
    ) {
      errorEl.textContent =
        "Completa el tipo, asunto, detalle y una fecha que no sea futura.";

      return;
    }

    saving = true;

    form
      .querySelectorAll("button, input, select, textarea")
      .forEach((elemento) => {
        elemento.disabled = true;
      });

    try {
      const colegioRef = doc(
        db,
        "ventas_cartera",
        email(destino.correoVendedor),
        "items",
        String(destino.numeroColegio)
      );

      const colegioSnap = await getDoc(colegioRef);

      if (!colegioSnap.exists()) {
        throw new Error(
          "El colegio ya no existe en esa cartera."
        );
      }

      const historyRef = doc(
        collection(colegioRef, "historial")
      );

      const autor = texto(
        usuario?.nombre ||
        usuario?.name ||
        usuario?.email
      );

      const origen = grupo ? "grupo" : "cartera";

      const idGrupo = grupo
        ? String(grupo.id)
        : "";

      const aliasGrupo = grupo
        ? texto(
            grupo.data.aliasGrupo ||
            grupo.data.colegio
          )
        : "";

      const data = {
        esGestionComercial: true,

        tipoMovimiento: "gestion_comercial",

        tipo,

        fechaGestion: fecha,

        asunto,

        mensaje: detalle,

        origen,

        gestionId: historyRef.id,

        hechoPor: autor,

        hechoPorCorreo: email(
          usuarioReal?.email ||
          usuario?.email
        ),

        fecha: serverTimestamp(),

        metadata: {
          fechaGestion: fecha,

          origen,

          idGrupo,

          aliasGrupo
        }
      };

      const batch = writeBatch(db);

      /*
        Siempre se guarda la gestión en el historial
        del colegio en Cartera.
      */
      batch.set(historyRef, data);

      if (grupo) {
        const titulo =
          `Gestión comercial · ${data.tipo}`;

        /*
          Cuando se registra desde un grupo, también
          queda en el historial de ese grupo.
        */
        const historialGrupoRef = doc(
          db,
          "ventas_historial",
          historyRef.id
        );

        batch.set(historialGrupoRef, {
          ...data,

          idGrupo: String(grupo.id),

          colegio: texto(grupo.data.colegio),

          codigoRegistro: texto(
            grupo.data.codigoRegistro
          ),

          aliasGrupo: texto(
            grupo.data.aliasGrupo
          ),

          modulo: "gestion_comercial",

          titulo,

          asunto: `${data.asunto} · ${fecha}`,

          cambios: [],

          creadoPor: autor,

          creadoPorCorreo: email(usuario?.email),

          destacado: false,

          oculto: false
        });

        /*
          Se guarda la referencia al colegio de cartera
          para facilitar las próximas gestiones.
        */
        const grupoRef = doc(
          db,
          "ventas_cotizaciones",
          grupo.docId
        );

        batch.set(
          grupoRef,
          {
            carteraVinculo: {
              correoVendedor: email(
                destino.correoVendedor
              ),

              numeroColegio: String(
                destino.numeroColegio
              )
            }
          },
          {
            merge: true
          }
        );
      }

      /*
        Las escrituras del batch se guardan juntas.
      */
      await batch.commit();

    } catch (error) {
      console.error(
        "No se pudo guardar la gestión:",
        error
      );

      errorEl.textContent =
        `No se guardó la gestión: ${
          error.message || "Error desconocido"
        }`;

      saving = false;

      form
        .querySelectorAll("button, input, select, textarea")
        .forEach((elemento) => {
          elemento.disabled = false;
        });

      return;
    }

    saving = false;

    cerrar();

    try {
      if (onSaved) {
        await onSaved();
      }

    } catch (error) {
      console.error(
        "La gestión se guardó, pero no se actualizó la vista:",
        error
      );

      alert(
        "La gestión quedó guardada. " +
        "Recarga la página para actualizar la vista."
      );
    }
  };

  document.body.append(dialog);

  dialog.showModal();

  /*
    Si se abre desde un grupo y ya conocemos el correo
    de la cartera, intentamos cargar sus colegios.
  */
  if (grupo) {
    if (campo("vendedor").value) {
      void cargarColegios();
    } else {
      fieldsetVinculo.hidden = false;
      fieldsetVinculo.disabled = false;
  
      errorEl.textContent =
        "No se encontró el correo de la cartera. " +
        "Indícalo para buscar el colegio.";
    }
  }
}
