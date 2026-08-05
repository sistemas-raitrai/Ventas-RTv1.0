import {
  getStorage,
  ref as storageRef,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/11.7.3/firebase-storage.js";

const $ = (id) =>
  document.getElementById(id);

export function crearInscripcionViewer({
  manager,
  getGrupoCtx,
  getGrupoData
} = {}) {
  if (!manager) {
    throw new Error(
      "crearInscripcionViewer requiere manager."
    );
  }

  const state = {
    item: null,
    inscripcionId: "",
    documentos: [],
    documentoActivo: "",
    crop: new Map(),

    dragging: false,
    dragStartX: 0,
    dragStartY: 0
  };

  bindEvents();

  async function abrir(
    inscripcionId
  ) {
    const grupoCtx =
      getGrupoCtx?.();

    if (!grupoCtx) {
      throw new Error(
        "No hay un grupo abierto."
      );
    }

    const id =
      String(
        inscripcionId ||
        ""
      ).trim();

    if (!id) {
      throw new Error(
        "No se pudo identificar la inscripción."
      );
    }

    state.inscripcionId =
      id;

    state.item =
      null;

    state.documentos =
      [];

    setLoading(
      true,
      "Cargando ficha completa..."
    );

    openModal(
      "modalFichaInscripcion"
    );

    try {
      const item =
        await manager
          .cargarInscripcionCompleta(
            grupoCtx,
            id
          );

      if (!item) {
        throw new Error(
          "No se encontró la ficha completa."
        );
      }

      state.item =
        item;

      state.documentos =
        await construirDocumentos(
          item
        );

      renderFicha();
      setLoading(false);
    } catch (error) {
      console.error(
        "[inscripcion-viewer] abrir",
        error
      );

      setLoading(
        true,
        error.message ||
        "No se pudo cargar la ficha."
      );
    }
  }

  function cerrar() {
    closeModal(
      "modalFichaInscripcion"
    );

    state.item =
      null;

    state.inscripcionId =
      "";

    state.documentos =
      [];

    state.crop.clear();
  }

  function bindEvents() {
    $("btnCerrarFichaInscripcion")
      ?.addEventListener(
        "click",
        cerrar
      );

    $("modalFichaInscripcion")
      ?.addEventListener(
        "click",
        (event) => {
          if (
            event.target ===
            $("modalFichaInscripcion")
          ) {
            cerrar();
          }
        }
      );

    $("btnImprimirFichaInscripcion")
      ?.addEventListener(
        "click",
        imprimirFicha
      );

    $("btnPrepararPdfFichaInscripcion")
      ?.addEventListener(
        "click",
        prepararPdf
      );

    $("fichaDocumentosGrid")
      ?.addEventListener(
        "click",
        (event) => {
          const button =
            event.target.closest(
              "[data-view-doc]"
            );

          if (!button) {
            return;
          }

          const key =
            button.dataset.viewDoc;

          const documento =
            state.documentos.find(
              (doc) =>
                doc.key === key
            );

          if (
            documento?.url
          ) {
            window.open(
              documento.url,
              "_blank",
              "noopener"
            );
          }
        }
      );

    $("reencuadreListaViewer")
      ?.addEventListener(
        "click",
        (event) => {
          const button =
            event.target.closest(
              "[data-crop-key]"
            );

          if (!button) {
            return;
          }

          seleccionarDocumento(
            button.dataset.cropKey
          );
        }
      );

    $("btnViewerZoomMenos")
      ?.addEventListener(
        "click",
        () =>
          modificarCrop(
            {
              zoom:
                -0.1
            }
          )
      );

    $("btnViewerZoomMas")
      ?.addEventListener(
        "click",
        () =>
          modificarCrop(
            {
              zoom:
                0.1
            }
          )
      );

    $("btnViewerRotarIzq")
      ?.addEventListener(
        "click",
        () =>
          modificarCrop(
            {
              rotate:
                -90
            }
          )
      );

    $("btnViewerRotarDer")
      ?.addEventListener(
        "click",
        () =>
          modificarCrop(
            {
              rotate:
                90
            }
          )
      );

    $("btnViewerCentrar")
      ?.addEventListener(
        "click",
        centrarCrop
      );

    $("btnCerrarReencuadreViewer")
      ?.addEventListener(
        "click",
        () =>
          closeModal(
            "modalReencuadreViewer"
          )
      );

    $("btnGenerarPdfViewer")
      ?.addEventListener(
        "click",
        generarPdfConRecortes
      );

    const canvas =
      $("viewerCropCanvas");

    canvas
      ?.addEventListener(
        "mousedown",
        iniciarDrag
      );

    canvas
      ?.addEventListener(
        "mousemove",
        moverDrag
      );

    canvas
      ?.addEventListener(
        "mouseup",
        terminarDrag
      );

    canvas
      ?.addEventListener(
        "mouseleave",
        terminarDrag
      );

    document.addEventListener(
      "keydown",
      (event) => {
        if (
          event.key !==
          "Escape"
        ) {
          return;
        }

        if (
          $("modalReencuadreViewer")
            ?.classList.contains(
              "show"
            )
        ) {
          closeModal(
            "modalReencuadreViewer"
          );

          return;
        }

        if (
          $("modalFichaInscripcion")
            ?.classList.contains(
              "show"
            )
        ) {
          cerrar();
        }
      }
    );
  }

  function setLoading(
    loading,
    message = ""
  ) {
    const loadingBox =
      $("fichaInscripcionLoading");

    const content =
      $("fichaInscripcionContent");

    if (loadingBox) {
      loadingBox.textContent =
        message ||
        "Cargando ficha completa...";

      loadingBox.classList.toggle(
        "hidden",
        !loading
      );
    }

    content
      ?.classList.toggle(
        "hidden",
        loading
      );
  }

  function renderFicha() {
    const item =
      state.item ||
      {};

    const grupo =
      getGrupoData?.() ||
      {};

    const nombre =
      getNombreCompleto(
        item
      );

    setText(
      "fichaInscripcionTitulo",
      nombre ||
      "Ficha de inscripción"
    );

    setText(
      "fichaInscripcionSubtitulo",
      [
        getDocumento(
          item
        ),
        getTipo(
          item
        ),
        grupo.aliasGrupo ||
        grupo.colegio ||
        ""
      ]
        .filter(Boolean)
        .join(" · ")
    );

    const secciones = [
      {
        title:
          "Identificación",

        rows: [
          [
            "Documento",
            getDocumento(item)
          ],
          [
            "Nombres",
            first(
              item,
              [
                "identificacion.nombres",
                "identificacion.nombre",
                "nombres",
                "nombre"
              ]
            )
          ],
          [
            "Primer apellido",
            first(
              item,
              [
                "identificacion.primerApellido",
                "primerApellido"
              ]
            )
          ],
          [
            "Segundo apellido",
            first(
              item,
              [
                "identificacion.segundoApellido",
                "segundoApellido"
              ]
            )
          ],
          [
            "Fecha de nacimiento",
            formatValue(
              first(
                item,
                [
                  "identificacion.fechaNacimiento",
                  "fechaNacimiento"
                ]
              )
            )
          ],
          [
            "Nacionalidad",
            first(
              item,
              [
                "identificacion.nacionalidad",
                "nacionalidad"
              ]
            )
          ],
          [
            "Sexo",
            first(
              item,
              [
                "identificacion.sexo",
                "sexo"
              ]
            )
          ],
          [
            "Tipo pasajero",
            first(
              item,
              [
                "identificacion.tipoPasajero",
                "tipoPasajero",
                "pasajero.tipo"
              ]
            )
          ]
        ]
      },

      {
        title:
          "Responsable y contacto",

        rows: [
          [
            "Responsable",
            first(
              item,
              [
                "contactoPrincipal.nombreCompleto",
                "contactoPrincipal.nombre",
                "responsable.nombre",
                "apoderado.nombre"
              ]
            )
          ],
          [
            "Parentesco",
            first(
              item,
              [
                "contactoPrincipal.parentesco",
                "responsable.parentesco",
                "apoderado.parentesco"
              ]
            )
          ],
          [
            "Correo",
            first(
              item,
              [
                "contactoPrincipal.correo",
                "responsable.correo",
                "apoderado.correo",
                "correo"
              ]
            )
          ],
          [
            "Teléfono",
            first(
              item,
              [
                "contactoPrincipal.celular",
                "contactoPrincipal.telefono",
                "responsable.telefono",
                "apoderado.telefono",
                "telefono"
              ]
            )
          ],
          [
            "Contacto de emergencia",
            first(
              item,
              [
                "contactoEmergencia.nombre",
                "emergencia.nombre"
              ]
            )
          ],
          [
            "Teléfono emergencia",
            first(
              item,
              [
                "contactoEmergencia.telefono",
                "contactoEmergencia.celular",
                "emergencia.telefono"
              ]
            )
          ]
        ]
      },

      {
        title:
          "Ficha médica",

        rows: [
          [
            "Ficha médica",
            esFichaCompleta(
              item
            )
              ? "Completa"
              : "Pendiente"
          ],
          [
            "Previsión",
            first(
              item,
              [
                "fichaMedica.prevision",
                "salud.prevision",
                "prevision"
              ]
            )
          ],
          [
            "Alergias",
            first(
              item,
              [
                "fichaMedica.alergiasDetalle",
                "fichaMedica.alergias",
                "salud.alergiasDetalle",
                "salud.alergias",
                "alergias"
              ]
            )
          ],
          [
            "Medicamentos",
            first(
              item,
              [
                "fichaMedica.medicamentosDetalle",
                "fichaMedica.medicamentos",
                "salud.medicamentosDetalle",
                "salud.medicamentos",
                "medicamentos"
              ]
            )
          ],
          [
            "Enfermedades / condiciones",
            first(
              item,
              [
                "fichaMedica.enfermedadesDetalle",
                "fichaMedica.condicionesMedicas",
                "salud.condicionesMedicas",
                "enfermedades"
              ]
            )
          ],
          [
            "Neurodivergencia",
            first(
              item,
              [
                "fichaMedica.neurodivergenciaDetalle",
                "fichaMedica.neurodivergencia",
                "salud.neurodivergenciaDetalle",
                "salud.neurodivergencia"
              ]
            )
          ],
          [
            "Dieta / alimentación",
            first(
              item,
              [
                "fichaMedica.dietaDetalle",
                "fichaMedica.alimentacionEspecial",
                "salud.dietaDetalle",
                "salud.alimentacionEspecial",
                "dieta"
              ]
            )
          ],
          [
            "Observaciones médicas",
            first(
              item,
              [
                "fichaMedica.observaciones",
                "salud.observaciones",
                "observacionesMedicas"
              ]
            )
          ]
        ]
      },

      {
        title:
          "Inscripción y estado",

        rows: [
          [
            "Tipo inscripción",
            getTipo(
              item
            )
          ],
          [
            "Estado cupo",
            first(
              item,
              [
                "estadoCupo",
                "estadoInscripcion",
                "estado"
              ]
            )
          ],
          [
            "Fecha formulario",
            formatValue(
              first(
                item,
                [
                  "meta.fechaInscripcion",
                  "meta.fechaFormularioCliente",
                  "fechaInscripcion",
                  "fechaFormularioCliente",
                  "createdAt",
                  "creadoEn"
                ]
              )
            )
          ],
          [
            "Anulado",
            esAnulada(
              item
            )
              ? "Sí"
              : "No"
          ],
          [
            "Motivo anulación",
            first(
              item,
              [
                "motivoAnulacion",
                "anuladoMotivo",
                "motivoNoViaja"
              ]
            )
          ],
          [
            "Talla",
            first(
              item,
              [
                "elementos.tallaPolera",
                "tallaPolera",
                "talla"
              ]
            )
          ]
        ]
      }
    ];

    const container =
      $("fichaDatosGrid");

    if (container) {
      container.innerHTML =
        secciones.map(
          renderSection
        ).join("");
    }

    renderDocumentos();
  }

  function renderSection(
    section
  ) {
    const rows =
      section.rows.filter(
        ([, value]) =>
          String(
            value ??
            ""
          ).trim() !==
          ""
      );

    return `
      <section class="viewer-section">
        <h3>
          ${esc(
            section.title
          )}
        </h3>

        <div class="viewer-data-grid">
          ${
            rows.length
              ? rows
                  .map(
                    ([label, value]) => `
                      <div class="viewer-data-card">
                        <span>
                          ${esc(
                            label
                          )}
                        </span>

                        <strong>
                          ${esc(
                            value ||
                            "—"
                          )}
                        </strong>
                      </div>
                    `
                  )
                  .join("")
              : `
                <div class="viewer-empty">
                  Sin información registrada.
                </div>
              `
          }
        </div>
      </section>
    `;
  }

  function renderDocumentos() {
    const grid =
      $("fichaDocumentosGrid");

    if (!grid) {
      return;
    }

    if (
      !state.documentos.length
    ) {
      grid.innerHTML = `
        <div class="viewer-empty">
          Esta ficha no tiene imágenes o documentos disponibles.
        </div>
      `;

      return;
    }

    grid.innerHTML =
      state.documentos
        .map(
          (doc) => `
            <article class="viewer-doc-card">
              <div class="viewer-doc-head">
                <strong>
                  ${esc(
                    doc.label
                  )}
                </strong>

                <button
                  type="button"
                  data-view-doc="${esc(
                    doc.key
                  )}"
                >
                  Abrir original
                </button>
              </div>

              ${
                doc.esImagen
                  ? `
                    <img
                      src="${esc(
                        doc.url
                      )}"
                      alt="${esc(
                        doc.label
                      )}"
                    />
                  `
                  : `
                    <div class="viewer-file-box">
                      Documento disponible
                    </div>
                  `
              }
            </article>
          `
        )
        .join("");
  }

  async function construirDocumentos(
    item
  ) {
    const defs = [
      [
        "carnetFrente",
        "Carnet de identidad · Frente",
        [
          "archivosEspeciales.carnetFrente",
          "archivos.carnetFrente",
          "documentos.carnetFrente",
          "documentos.cedulaFrente",
          "carnet.frente"
        ]
      ],
      [
        "carnetReverso",
        "Carnet de identidad · Reverso",
        [
          "archivosEspeciales.carnetReverso",
          "archivos.carnetReverso",
          "documentos.carnetReverso",
          "documentos.cedulaReverso",
          "carnet.reverso"
        ]
      ],
      [
        "comprobantePago",
        "Comprobante de pago",
        [
          "archivosEspeciales.comprobantePago",
          "archivos.comprobantePago",
          "documentos.comprobantePago",
          "comprobantePago"
        ]
      ],
      [
        "pasaporte",
        "Pasaporte",
        [
          "archivosEspeciales.pasaporte",
          "archivos.pasaporte",
          "documentos.pasaporte"
        ]
      ],
      [
        "permisoNotarial",
        "Permiso notarial",
        [
          "archivosEspeciales.permisoNotarial",
          "archivos.permisoNotarial",
          "documentos.permisoNotarial"
        ]
      ]
    ];

    const result =
      [];

    for (
      const [
        key,
        label,
        paths
      ] of defs
    ) {
      const raw =
        firstRaw(
          item,
          paths
        );

      const url =
        await resolverArchivoUrl(
          raw
        );

      if (!url) {
        continue;
      }

      result.push({
        key,
        label,
        url,
        esImagen:
          esUrlImagen(
            url,
            raw
          )
      });
    }

    return result;
  }

  async function resolverArchivoUrl(
    archivo
  ) {
    if (!archivo) {
      return "";
    }

    const raw =
      typeof archivo ===
      "string"
        ? archivo
        : archivo.url ||
          archivo.downloadURL ||
          archivo.publicUrl ||
          archivo.ruta ||
          archivo.path ||
          "";

    const ruta =
      String(
        raw ||
        ""
      ).trim();

    if (!ruta) {
      return "";
    }

    if (
      /^https?:\/\//i.test(
        ruta
      )
    ) {
      return ruta;
    }

    try {
      const storage =
        getStorage();

      return await getDownloadURL(
        storageRef(
          storage,
          ruta
        )
      );
    } catch (error) {
      console.warn(
        "[inscripcion-viewer] Storage",
        error
      );

      return "";
    }
  }

  function esUrlImagen(
    url,
    raw
  ) {
    const mime =
      String(
        raw?.contentType ||
        raw?.mimeType ||
        ""
      ).toLowerCase();

    if (
      mime.startsWith(
        "image/"
      )
    ) {
      return true;
    }

    return /\.(png|jpe?g|webp|gif)(\?|#|$)/i.test(
      url
    );
  }

  async function imprimirFicha() {
    if (!state.item) {
      return;
    }

    generarVentanaImpresion(
      {}
    );
  }

  async function prepararPdf() {
    const imagenes =
      state.documentos.filter(
        (doc) =>
          doc.esImagen
      );

    if (!imagenes.length) {
      generarVentanaImpresion(
        {}
      );

      return;
    }

    state.crop.clear();

    for (
      const documento of imagenes
    ) {
      state.crop.set(
        documento.key,
        {
          key:
            documento.key,

          label:
            documento.label,

          url:
            documento.url,

          image:
            null,

          zoom:
            1,

          rotate:
            0,

          offsetX:
            0,

          offsetY:
            0
        }
      );
    }

    state.documentoActivo =
      imagenes[0].key;

    renderListaCrop();

    openModal(
      "modalReencuadreViewer"
    );

    await seleccionarDocumento(
      state.documentoActivo
    );
  }

  function renderListaCrop() {
    const list =
      $("reencuadreListaViewer");

    if (!list) {
      return;
    }

    list.innerHTML =
      [
        ...state.crop.values()
      ]
        .map(
          (item) => `
            <button
              type="button"
              class="${
                item.key ===
                state.documentoActivo
                  ? "active"
                  : ""
              }"
              data-crop-key="${esc(
                item.key
              )}"
            >
              ${esc(
                item.label
              )}
            </button>
          `
        )
        .join("");
  }

  async function seleccionarDocumento(
    key
  ) {
    const crop =
      state.crop.get(
        key
      );

    if (!crop) {
      return;
    }

    state.documentoActivo =
      key;

    renderListaCrop();

    if (!crop.image) {
      crop.image =
        await loadImage(
          crop.url
        );
    }

    dibujarCrop();
  }

  function modificarCrop({
    zoom = 0,
    rotate = 0
  } = {}) {
    const crop =
      state.crop.get(
        state.documentoActivo
      );

    if (!crop) {
      return;
    }

    crop.zoom =
      Math.max(
        0.2,
        Math.min(
          4,
          crop.zoom +
          zoom
        )
      );

    crop.rotate =
      (
        crop.rotate +
        rotate
      ) % 360;

    dibujarCrop();
  }

  function centrarCrop() {
    const crop =
      state.crop.get(
        state.documentoActivo
      );

    if (!crop) {
      return;
    }

    crop.zoom =
      1;

    crop.rotate =
      0;

    crop.offsetX =
      0;

    crop.offsetY =
      0;

    dibujarCrop();
  }

  function iniciarDrag(
    event
  ) {
    if (
      !state.documentoActivo
    ) {
      return;
    }

    state.dragging =
      true;

    state.dragStartX =
      event.offsetX;

    state.dragStartY =
      event.offsetY;
  }

  function moverDrag(
    event
  ) {
    if (
      !state.dragging
    ) {
      return;
    }

    const crop =
      state.crop.get(
        state.documentoActivo
      );

    if (!crop) {
      return;
    }

    crop.offsetX +=
      event.offsetX -
      state.dragStartX;

    crop.offsetY +=
      event.offsetY -
      state.dragStartY;

    state.dragStartX =
      event.offsetX;

    state.dragStartY =
      event.offsetY;

    dibujarCrop();
  }

  function terminarDrag() {
    state.dragging =
      false;
  }

  function dibujarCrop() {
    const crop =
      state.crop.get(
        state.documentoActivo
      );

    const canvas =
      $("viewerCropCanvas");

    if (
      !crop?.image ||
      !canvas
    ) {
      return;
    }

    const ctx =
      canvas.getContext(
        "2d"
      );

    ctx.clearRect(
      0,
      0,
      canvas.width,
      canvas.height
    );

    ctx.fillStyle =
      "#241b2d";

    ctx.fillRect(
      0,
      0,
      canvas.width,
      canvas.height
    );

    const image =
      crop.image;

    const base =
      Math.min(
        canvas.width /
          image.width,
        canvas.height /
          image.height
      );

    const scale =
      base *
      crop.zoom;

    ctx.save();

    ctx.translate(
      canvas.width / 2 +
      crop.offsetX,
      canvas.height / 2 +
      crop.offsetY
    );

    ctx.rotate(
      crop.rotate *
      Math.PI /
      180
    );

    ctx.drawImage(
      image,
      -image.width *
        scale /
        2,
      -image.height *
        scale /
        2,
      image.width *
        scale,
      image.height *
        scale
    );

    ctx.restore();

    setText(
      "viewerCropEstado",
      `${crop.label} · Zoom ${Math.round(
        crop.zoom *
        100
      )}% · Rotación ${crop.rotate}°`
    );
  }

  async function generarPdfConRecortes() {
    const recortes =
      {};

    for (
      const [
        key,
        crop
      ] of state.crop
    ) {
      if (!crop.image) {
        crop.image =
          await loadImage(
            crop.url
          );
      }

      recortes[key] =
        renderCropDataUrl(
          crop
        );
    }

    closeModal(
      "modalReencuadreViewer"
    );

    generarVentanaImpresion(
      recortes
    );
  }

  function renderCropDataUrl(
    crop
  ) {
    const canvas =
      document.createElement(
        "canvas"
      );

    canvas.width =
      1200;

    canvas.height =
      760;

    const ctx =
      canvas.getContext(
        "2d"
      );

    ctx.fillStyle =
      "#ffffff";

    ctx.fillRect(
      0,
      0,
      canvas.width,
      canvas.height
    );

    const image =
      crop.image;

    const base =
      Math.min(
        canvas.width /
          image.width,
        canvas.height /
          image.height
      );

    const scale =
      base *
      crop.zoom;

    const ratioX =
      canvas.width /
      900;

    const ratioY =
      canvas.height /
      540;

    ctx.save();

    ctx.translate(
      canvas.width / 2 +
      crop.offsetX *
      ratioX,
      canvas.height / 2 +
      crop.offsetY *
      ratioY
    );

    ctx.rotate(
      crop.rotate *
      Math.PI /
      180
    );

    ctx.drawImage(
      image,
      -image.width *
        scale /
        2,
      -image.height *
        scale /
        2,
      image.width *
        scale,
      image.height *
        scale
    );

    ctx.restore();

    return canvas.toDataURL(
      "image/jpeg",
      0.9
    );
  }

  function generarVentanaImpresion(
    recortes = {}
  ) {
    const item =
      state.item;

    if (!item) {
      return;
    }

    const win =
      window.open(
        "",
        "_blank"
      );

    if (!win) {
      alert(
        "El navegador bloqueó la ventana emergente. Permite pop-ups para imprimir la ficha."
      );

      return;
    }

    const grupo =
      getGrupoData?.() ||
      {};

    const datos =
      construirFilasImpresion(
        item
      );

    const docs =
      state.documentos
        .filter(
          (doc) =>
            doc.esImagen
        )
        .map(
          (doc) => ({
            ...doc,
            url:
              recortes[
                doc.key
              ] ||
              doc.url
          })
        );

    const nombre =
      getNombreCompleto(
        item
      );

    const html = `
      <!doctype html>
      <html lang="es">
        <head>
          <meta charset="utf-8" />

          <title>
            ${esc(
              `Ficha ${nombre}`
            )}
          </title>

          <style>
            * {
              box-sizing: border-box;
            }

            body {
              margin: 0;
              padding: 24px;
              font-family: Arial, sans-serif;
              color: #23172f;
            }

            h1 {
              margin: 0;
              font-size: 24px;
            }

            .subtitle {
              margin: 6px 0 18px;
              color: #6b6075;
            }

            .section {
              margin-top: 18px;
              break-inside: avoid;
            }

            .section h2 {
              margin: 0 0 8px;
              padding: 8px 10px;
              background: #ede5f4;
              font-size: 14px;
              text-transform: uppercase;
            }

            .rows {
              border: 1px solid #ddd3e5;
            }

            .row {
              display: grid;
              grid-template-columns: 190px 1fr;
              border-bottom: 1px solid #eee8f2;
            }

            .row:last-child {
              border-bottom: 0;
            }

            .label {
              padding: 8px 10px;
              background: #f7f3fa;
              font-size: 10px;
              font-weight: 800;
              text-transform: uppercase;
            }

            .value {
              padding: 8px 10px;
              white-space: pre-wrap;
            }

            .documents {
              display: grid;
              grid-template-columns: 1fr 1fr;
              gap: 12px;
            }

            .doc {
              break-inside: avoid;
              border: 1px solid #ddd3e5;
              padding: 10px;
            }

            .doc strong {
              display: block;
              margin-bottom: 8px;
            }

            .doc img {
              display: block;
              width: 100%;
              max-height: 430px;
              object-fit: contain;
            }

            .footer {
              margin-top: 18px;
              color: #786c81;
              font-size: 10px;
            }

            @media print {
              body {
                padding: 0;
              }
            }
          </style>
        </head>

        <body>
          <h1>
            Ficha individual de inscripción
          </h1>

          <div class="subtitle">
            ${esc(
              nombre
            )} · ${esc(
              getDocumento(
                item
              )
            )} · Grupo ${esc(
              grupo.aliasGrupo ||
              grupo.colegio ||
              ""
            )}
          </div>

          ${
            datos
              .map(
                (section) => `
                  <section class="section">
                    <h2>
                      ${esc(
                        section.title
                      )}
                    </h2>

                    <div class="rows">
                      ${
                        section.rows
                          .filter(
                            ([, value]) =>
                              String(
                                value ??
                                ""
                              ).trim()
                          )
                          .map(
                            ([label, value]) => `
                              <div class="row">
                                <div class="label">
                                  ${esc(
                                    label
                                  )}
                                </div>

                                <div class="value">
                                  ${esc(
                                    value ||
                                    "—"
                                  )}
                                </div>
                              </div>
                            `
                          )
                          .join("")
                      }
                    </div>
                  </section>
                `
              )
              .join("")
          }

          ${
            docs.length
              ? `
                <section class="section">
                  <h2>
                    Documentos
                  </h2>

                  <div class="documents">
                    ${
                      docs
                        .map(
                          (doc) => `
                            <div class="doc">
                              <strong>
                                ${esc(
                                  doc.label
                                )}
                              </strong>

                              <img
                                src="${esc(
                                  doc.url
                                )}"
                                alt="${esc(
                                  doc.label
                                )}"
                              />
                            </div>
                          `
                        )
                        .join("")
                    }
                  </div>
                </section>
              `
              : ""
          }

          <div class="footer">
            Documento generado el ${esc(
              new Date()
                .toLocaleString(
                  "es-CL"
                )
            )}.
          </div>

          <script>
            window.onload = function () {
              window.print();
            };
          </script>
        </body>
      </html>
    `;

    win.document.open();
    win.document.write(
      html
    );
    win.document.close();
  }

  function construirFilasImpresion(
    item
  ) {
    return [
      {
        title:
          "Identificación",

        rows: [
          [
            "Documento",
            getDocumento(item)
          ],
          [
            "Nombre completo",
            getNombreCompleto(item)
          ],
          [
            "Fecha nacimiento",
            formatValue(
              first(
                item,
                [
                  "identificacion.fechaNacimiento",
                  "fechaNacimiento"
                ]
              )
            )
          ],
          [
            "Nacionalidad",
            first(
              item,
              [
                "identificacion.nacionalidad",
                "nacionalidad"
              ]
            )
          ],
          [
            "Sexo",
            first(
              item,
              [
                "identificacion.sexo",
                "sexo"
              ]
            )
          ],
          [
            "Tipo pasajero",
            first(
              item,
              [
                "identificacion.tipoPasajero",
                "tipoPasajero"
              ]
            )
          ]
        ]
      },

      {
        title:
          "Responsable",

        rows: [
          [
            "Nombre",
            first(
              item,
              [
                "contactoPrincipal.nombreCompleto",
                "contactoPrincipal.nombre",
                "responsable.nombre",
                "apoderado.nombre"
              ]
            )
          ],
          [
            "Correo",
            first(
              item,
              [
                "contactoPrincipal.correo",
                "responsable.correo",
                "apoderado.correo",
                "correo"
              ]
            )
          ],
          [
            "Teléfono",
            first(
              item,
              [
                "contactoPrincipal.celular",
                "contactoPrincipal.telefono",
                "responsable.telefono",
                "telefono"
              ]
            )
          ],
          [
            "Contacto emergencia",
            first(
              item,
              [
                "contactoEmergencia.nombre",
                "emergencia.nombre"
              ]
            )
          ],
          [
            "Teléfono emergencia",
            first(
              item,
              [
                "contactoEmergencia.telefono",
                "contactoEmergencia.celular",
                "emergencia.telefono"
              ]
            )
          ]
        ]
      },

      {
        title:
          "Ficha médica",

        rows: [
          [
            "Estado ficha",
            esFichaCompleta(
              item
            )
              ? "Completa"
              : "Pendiente"
          ],
          [
            "Previsión",
            first(
              item,
              [
                "fichaMedica.prevision",
                "salud.prevision",
                "prevision"
              ]
            )
          ],
          [
            "Alergias",
            first(
              item,
              [
                "fichaMedica.alergiasDetalle",
                "fichaMedica.alergias",
                "salud.alergiasDetalle",
                "salud.alergias",
                "alergias"
              ]
            )
          ],
          [
            "Medicamentos",
            first(
              item,
              [
                "fichaMedica.medicamentosDetalle",
                "fichaMedica.medicamentos",
                "salud.medicamentosDetalle",
                "salud.medicamentos",
                "medicamentos"
              ]
            )
          ],
          [
            "Condiciones médicas",
            first(
              item,
              [
                "fichaMedica.enfermedadesDetalle",
                "fichaMedica.condicionesMedicas",
                "salud.condicionesMedicas",
                "enfermedades"
              ]
            )
          ],
          [
            "Neurodivergencia",
            first(
              item,
              [
                "fichaMedica.neurodivergenciaDetalle",
                "fichaMedica.neurodivergencia",
                "salud.neurodivergenciaDetalle",
                "salud.neurodivergencia"
              ]
            )
          ],
          [
            "Dieta / alimentación",
            first(
              item,
              [
                "fichaMedica.dietaDetalle",
                "fichaMedica.alimentacionEspecial",
                "salud.dietaDetalle",
                "salud.alimentacionEspecial",
                "dieta"
              ]
            )
          ],
          [
            "Observaciones",
            first(
              item,
              [
                "fichaMedica.observaciones",
                "salud.observaciones",
                "observacionesMedicas"
              ]
            )
          ]
        ]
      },

      {
        title:
          "Inscripción",

        rows: [
          [
            "Tipo inscripción",
            getTipo(item)
          ],
          [
            "Estado cupo",
            first(
              item,
              [
                "estadoCupo",
                "estadoInscripcion",
                "estado"
              ]
            )
          ],
          [
            "Fecha formulario",
            formatValue(
              first(
                item,
                [
                  "meta.fechaInscripcion",
                  "meta.fechaFormularioCliente",
                  "fechaInscripcion",
                  "createdAt",
                  "creadoEn"
                ]
              )
            )
          ],
          [
            "Anulado",
            esAnulada(item)
              ? "Sí"
              : "No"
          ],
          [
            "Motivo",
            first(
              item,
              [
                "motivoAnulacion",
                "anuladoMotivo",
                "motivoNoViaja"
              ]
            )
          ]
        ]
      }
    ];
  }

  return {
    abrir,
    cerrar
  };
}

function getDocumento(
  item
) {
  return String(
    first(
      item,
      [
        "identificacion.documento",
        "identificacion.rutCompleto",
        "identificacion.documentoNormalizado",
        "rut",
        "documento"
      ]
    ) ||
    item?.id ||
    ""
  ).trim();
}

function getNombreCompleto(
  item
) {
  const nombres =
    first(
      item,
      [
        "identificacion.nombres",
        "identificacion.nombre",
        "nombres",
        "nombre"
      ]
    );

  const apellidoDirecto =
    first(
      item,
      [
        "identificacion.apellidos",
        "apellidos",
        "apellido"
      ]
    );

  const apellidos =
    apellidoDirecto ||
    [
      first(
        item,
        [
          "identificacion.primerApellido",
          "primerApellido"
        ]
      ),
      first(
        item,
        [
          "identificacion.segundoApellido",
          "segundoApellido"
        ]
      )
    ]
      .filter(Boolean)
      .join(" ");

  return [
    nombres,
    apellidos
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
}

function getTipo(
  item
) {
  return String(
    first(
      item,
      [
        "tipoInscripcion",
        "tipo",
        "estadoInscripcion"
      ]
    ) ||
    "Inscripción"
  )
    .replaceAll(
      "_",
      " "
    );
}

function esFichaCompleta(
  item
) {
  if (
    item?.fichaCompleta ===
      true ||
    item?.fichaMedicaCompleta ===
      true ||
    item?.nominaFinalCompleta ===
      true ||
    item?.fichaMedicaCompletada ===
      true
  ) {
    return true;
  }

  const estado =
    normalize(
      first(
        item,
        [
          "fichaMedicaEstado",
          "estadoFichaMedica",
          "fichaMedica.estado"
        ]
      )
    );

  return [
    "completa",
    "completada",
    "completo",
    "ok",
    "confirmada"
  ].includes(
    estado
  );
}

function esAnulada(
  item
) {
  const estado =
    normalize(
      first(
        item,
        [
          "estado",
          "estadoInscripcion",
          "estadoCupo",
          "estadoViaje"
        ]
      )
    );

  return (
    item?.anulado ===
      true ||
    item?.anulada ===
      true ||
    item?.viaja ===
      false ||
    estado.includes(
      "anulad"
    ) ||
    estado.includes(
      "no viaja"
    )
  );
}

function first(
  object,
  paths
) {
  const raw =
    firstRaw(
      object,
      paths
    );

  if (
    raw === undefined ||
    raw === null
  ) {
    return "";
  }

  if (
    typeof raw ===
      "boolean"
  ) {
    return raw
      ? "Sí"
      : "No";
  }

  if (
    Array.isArray(
      raw
    )
  ) {
    return raw
      .map(
        (value) =>
          typeof value ===
          "object"
            ? JSON.stringify(
                value
              )
            : String(
                value
              )
      )
      .join(", ");
  }

  if (
    typeof raw ===
      "object" &&
    !raw.toDate &&
    typeof raw.seconds !==
      "number"
  ) {
    return Object.entries(
      raw
    )
      .map(
        ([key, value]) =>
          `${key}: ${
            String(
              value ??
              ""
            )
          }`
      )
      .join(" · ");
  }

  return raw;
}

function firstRaw(
  object,
  paths
) {
  for (
    const path of paths
  ) {
    const value =
      path
        .split(".")
        .reduce(
          (current, key) =>
            current?.[key],
          object
        );

    if (
      value !==
        undefined &&
      value !==
        null &&
      String(
        value
      ).trim() !==
        ""
    ) {
      return value;
    }
  }

  return "";
}

function formatValue(
  value
) {
  if (!value) {
    return "";
  }

  let date =
    null;

  if (
    typeof value?.toDate ===
    "function"
  ) {
    date =
      value.toDate();
  } else if (
    typeof value ===
      "object" &&
    typeof value.seconds ===
      "number"
  ) {
    date =
      new Date(
        value.seconds *
        1000
      );
  } else {
    const parsed =
      new Date(
        value
      );

    if (
      !Number.isNaN(
        parsed.getTime()
      )
    ) {
      date =
        parsed;
    }
  }

  if (!date) {
    return String(
      value
    );
  }

  return date.toLocaleString(
    "es-CL",
    {
      day:
        "2-digit",
      month:
        "2-digit",
      year:
        "numeric",
      hour:
        "2-digit",
      minute:
        "2-digit",
      hour12:
        false
    }
  );
}

function loadImage(
  url
) {
  return new Promise(
    (
      resolve,
      reject
    ) => {
      const image =
        new Image();

      image.crossOrigin =
        "anonymous";

      image.onload =
        () =>
          resolve(
            image
          );

      image.onerror =
        () =>
          reject(
            new Error(
              "No se pudo cargar una imagen."
            )
          );

      image.src =
        url;
    }
  );
}

function openModal(
  id
) {
  $(id)
    ?.classList.add(
      "show"
    );

  document.body.classList.add(
    "modal-open"
  );
}

function closeModal(
  id
) {
  $(id)
    ?.classList.remove(
      "show"
    );

  const hayModal =
    document.querySelector(
      ".modal.show"
    );

  if (!hayModal) {
    document.body.classList.remove(
      "modal-open"
    );
  }
}

function setText(
  id,
  value
) {
  const element =
    $(id);

  if (element) {
    element.textContent =
      String(
        value ??
        ""
      );
  }
}

function normalize(
  value
) {
  return String(
    value ??
    ""
  )
    .normalize(
      "NFD"
    )
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .toLowerCase()
    .trim();
}

function esc(
  value
) {
  return String(
    value ??
    ""
  )
    .replaceAll(
      "&",
      "&amp;"
    )
    .replaceAll(
      "<",
      "&lt;"
    )
    .replaceAll(
      ">",
      "&gt;"
    )
    .replaceAll(
      '"',
      "&quot;"
    )
    .replaceAll(
      "'",
      "&#39;"
    );
}
