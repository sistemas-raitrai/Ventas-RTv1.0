import {
  clean,
  escapeHtml,
  passengerName,
  isCancelled
} from "./ficha-medica-common.js";

/*
  AJUSTAR SOLO ESTA RUTA si el logo de Rai Trai
  tiene otro nombre o está en otra carpeta.
*/
const LOGO_RAI_TRAI = "./IMG/logo-raitrai.png";

export const TALLAS_POLERAS = [
  "XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL"
];

export function fechaInicioPoleras(grupo = {}) {
  const valor = grupo.fechaInicio;

  if (!valor) return "";

  if (typeof valor === "string") {
    const coincidencia = valor.match(/^\d{4}-\d{2}-\d{2}/);
    if (coincidencia) return coincidencia[0];

    const fecha = new Date(valor);
    return Number.isNaN(fecha.getTime())
      ? ""
      : fecha.toISOString().slice(0, 10);
  }

  const fecha = valor?.toDate?.() || valor;

  return fecha instanceof Date && !Number.isNaN(fecha.getTime())
    ? fecha.toISOString().slice(0, 10)
    : "";
}

export function nombreGrupoPoleras(grupo = {}, id = "") {
  return clean(
    grupo.aliasGrupo ||
    grupo.nombreGrupo ||
    [grupo.colegio, grupo.curso].filter(Boolean).join(" · ") ||
    grupo.idGrupo ||
    id
  );
}

export function resumirPolerasGrupo(grupo = {}, id = "", inscripciones = []) {
  const personas = inscripciones
    .filter((item) => !isCancelled(item))
    .map((item) => {
      const valor = clean(item?.identificacion?.tallaPolera).toUpperCase();

      return {
        id: item.id || "",
        nombre: clean(passengerName(item)) || "Nombre no registrado",
        talla: TALLAS_POLERAS.includes(valor) ? valor : ""
      };
    })
    .sort((a, b) => {
      const ordenA = TALLAS_POLERAS.indexOf(a.talla);
      const ordenB = TALLAS_POLERAS.indexOf(b.talla);

      const diferencia =
        (ordenA < 0 ? TALLAS_POLERAS.length : ordenA) -
        (ordenB < 0 ? TALLAS_POLERAS.length : ordenB);

      return diferencia || a.nombre.localeCompare(b.nombre, "es", {
        sensitivity: "base"
      });
    });

  const tallas = Object.fromEntries(
    TALLAS_POLERAS.map((talla) => [talla, 0])
  );

  for (const persona of personas) {
    if (persona.talla) tallas[persona.talla]++;
  }

  const conTalla = Object.values(tallas)
    .reduce((total, cantidad) => total + cantidad, 0);

  return {
    id,
    nombre: nombreGrupoPoleras(grupo, id),
    destino: clean(grupo.destino) || "Sin destino",
    anoViaje: clean(grupo.anoViaje),
    fechaInicio: fechaInicioPoleras(grupo),
    totalPersonas: personas.length,
    conTalla,
    sinTalla: personas.length - conTalla,
    tallas,
    personas
  };
}

export function totalesPoleras(resumenes = []) {
  const tallas = Object.fromEntries(
    TALLAS_POLERAS.map((talla) => [talla, 0])
  );

  let totalPersonas = 0;
  let conTalla = 0;
  let sinTalla = 0;

  for (const grupo of resumenes) {
    totalPersonas += grupo.totalPersonas;
    conTalla += grupo.conTalla;
    sinTalla += grupo.sinTalla;

    for (const talla of TALLAS_POLERAS) {
      tallas[talla] += grupo.tallas[talla] || 0;
    }
  }

  return {
    grupos: resumenes.length,
    totalPersonas,
    conTalla,
    sinTalla,
    tallas
  };
}

export function htmlResumenTallas(tallas = {}) {
  return TALLAS_POLERAS.map((talla) => `
    <span class="poleras-talla">
      <strong>${talla}</strong>: ${tallas[talla] || 0}
    </span>
  `).join("");
}

export function htmlDetallePersonasPoleras(personas = []) {
  if (!personas.length) {
    return "<p>No hay participantes no anulados en este grupo.</p>";
  }

  const secciones = [...TALLAS_POLERAS, ""];

  return secciones.map((talla) => {
    const lista = personas.filter((persona) => persona.talla === talla);
    if (!lista.length) return "";

    return `
      <section class="poleras-seccion">
        <h3>${talla || "Sin talla"} · ${lista.length}</h3>
        <ol>
          ${lista.map((persona) => `
            <li>${escapeHtml(persona.nombre)}</li>
          `).join("")}
        </ol>
      </section>
    `;
  }).join("");
}

export function htmlReporteGrupoPoleras(resumen) {
  return `
    <h1>Poleras del grupo</h1>

    <p class="poleras-subtitulo">
      <strong>${escapeHtml(resumen.nombre)}</strong>
      · ${escapeHtml(resumen.destino)}
      ${resumen.fechaInicio
        ? `· Inicio ${escapeHtml(resumen.fechaInicio)}`
        : ""}
    </p>

    <div class="poleras-indicadores">
      <span>Participantes: <strong>${resumen.totalPersonas}</strong></span>
      <span>Con talla: <strong>${resumen.conTalla}</strong></span>
      <span>Sin talla: <strong>${resumen.sinTalla}</strong></span>
    </div>

    <div class="poleras-tallas">
      ${htmlResumenTallas(resumen.tallas)}
    </div>

    <h2>Detalle por participante</h2>
    <div class="poleras-personas">
      ${htmlDetallePersonasPoleras(resumen.personas)}
    </div>
  `;
}

export function imprimirReportePoleras({
  titulo,
  contenido,
  subtitulo = ""
}) {
  const ventana = window.open("", "_blank");

  if (!ventana) {
    alert("El navegador bloqueó la ventana de impresión. Permite ventanas emergentes para este sitio.");
    return;
  }

  const logo = new URL(LOGO_RAI_TRAI, location.href).href;

  ventana.document.open();
  ventana.document.write(`
    <!doctype html>
    <html lang="es">
    <head>
      <meta charset="utf-8">
      <title>${escapeHtml(titulo)}</title>
      <style>
        @page { size: A4; margin: 14mm; }

        * { box-sizing: border-box; }

        body {
          font-family: Arial, sans-serif;
          color: #172334;
          font-size: 10pt;
          margin: 0;
        }

        header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          border-bottom: 2px solid #1b4b79;
          padding-bottom: 10px;
          margin-bottom: 16px;
        }

        header img {
          max-width: 125px;
          max-height: 48px;
          object-fit: contain;
        }

        header .fecha {
          text-align: right;
          color: #667;
          font-size: 8pt;
        }

        h1 { font-size: 17pt; margin: 0 0 5px; }
        h2 { font-size: 11pt; margin: 16px 0 8px; }
        h3 { font-size: 10pt; margin: 0 0 5px; }

        .poleras-subtitulo { margin: 0 0 12px; }

        .poleras-indicadores,
        .poleras-tallas {
          display: flex;
          flex-wrap: wrap;
          gap: 7px 14px;
          padding: 9px;
          margin: 8px 0;
          border: 1px solid #dce4ec;
          border-radius: 5px;
        }

        .poleras-talla { white-space: nowrap; }

        .poleras-personas {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
        }

        .poleras-seccion {
          break-inside: avoid;
          page-break-inside: avoid;
          border: 1px solid #e3e8ee;
          border-radius: 5px;
          padding: 8px 10px;
        }

        .poleras-seccion ol {
          margin: 0;
          padding-left: 20px;
        }

        .poleras-seccion li {
          padding: 2px 0;
        }

        table {
          width: 100%;
          border-collapse: collapse;
          font-size: 8pt;
        }

        th, td {
          border-bottom: 1px solid #dce4ec;
          padding: 6px 4px;
          text-align: right;
        }

        th:first-child, td:first-child { text-align: left; }
        th { background: #eef3f8; }
        thead { display: table-header-group; }
        tr { break-inside: avoid; page-break-inside: avoid; }

        .poleras-nota {
          color: #5c6673;
          font-size: 8pt;
          margin-top: 12px;
        }

        @media screen {
          body { max-width: 900px; margin: 28px auto; padding: 0 18px; }
        }
      </style>
    </head>
    <body>
      <header>
        <img src="${logo}" alt="Rai Trai">
        <div class="fecha">
          ${escapeHtml(subtitulo)}<br>
          Emitido: ${new Date().toLocaleString("es-CL")}
        </div>
      </header>

      ${contenido}

      <p class="poleras-nota">
        Fuente: inscripciones no anuladas. «Sin talla» indica
        participantes que requieren completar ese dato.
      </p>

      <script>
        window.addEventListener("load", async () => {
          const logo = document.querySelector("header img");
      
          if (logo) {
            try {
              if (!logo.complete) {
                await new Promise((resolve, reject) => {
                  logo.addEventListener("load", resolve, { once: true });
                  logo.addEventListener("error", reject, { once: true });
                });
              }
      
              if (!logo.naturalWidth) {
                throw new Error("No se cargó el logo");
              }
      
              if (logo.decode) {
                await logo.decode();
              }
            } catch (error) {
              alert(
                "No se pudo cargar el logo de Rai Trai. " +
                "Revisa que Logo Raitrai.png esté publicado en la raíz."
              );
              return;
            }
          }
      
          window.print();
        });
      <\/script>
    </body>
    </html>
  `);
  ventana.document.close();
}
