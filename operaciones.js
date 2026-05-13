import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.7.3/firebase-auth.js";
import {
  collection,
  getDocs,
  doc,
  setDoc,
  addDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";

import {
  auth,
  db,
  VENTAS_USERS,
  normalizeEmail,
  puedeVerGeneral
} from "./firebase-init.js";

import {
  ACTING_USER_KEY,
  getRealUser,
  getEffectiveUser
} from "./roles.js";

import {
  setHeaderState,
  renderActingUserSwitcher,
  bindLayoutButtons,
  waitForLayoutReady
} from "./ui.js";

const $ = (id) => document.getElementById(id);

const GITHUB_HOME_URL = "https://sistemas-raitrai.github.io/Ventas-RT/";
const SOLICITUDES_COLLECTION = "ventas_solicitudes_actualizacion";
const HISTORIAL_COLLECTION = "ventas_historial";

const state = {
  realUser: null,
  effectiveUser: null,
  effectiveEmail: "",
  canSeeAll: false,

  allRows: [],
  solicitudesRows: [],
  filteredRows: [],

  anoFiltro: String(getAnoOperativoActual()),

  sets: {
    ganadas: [],
    firmar: [],
    actualizacion: [],
    correccion: [],
    programa: [],
    autorizadas: []
  }
};

initPage();

async function initPage() {
  await waitForLayoutReady();
  bindEvents();

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      location.href = "login.html";
      return;
    }

    await bootstrapFromSession();
    setHeaderAndScope();
    await loadOperaciones();
  });
}

async function bootstrapFromSession() {
  state.realUser = getRealUser();
  state.effectiveUser = getEffectiveUser();

  state.effectiveEmail = normalizeEmail(
    state.effectiveUser?.email ||
    state.realUser?.email ||
    auth.currentUser?.email ||
    ""
  );

  state.canSeeAll = puedeVerGeneral(state.effectiveEmail);
}

function setHeaderAndScope() {
  setHeaderState({
    realUser: state.realUser,
    effectiveUser: state.effectiveUser,
    scopeText: "Operaciones"
  });

  renderActingUserSwitcher({
    realUser: state.realUser,
    effectiveUser: state.effectiveUser,
    users: VENTAS_USERS
  });

  bindLayoutButtons({
    homeUrl: GITHUB_HOME_URL,
    onLogout: async () => {
      try {
        sessionStorage.removeItem(ACTING_USER_KEY);
        await signOut(auth);
        location.href = "login.html";
      } catch (error) {
        alert("Error al cerrar sesión: " + error.message);
      }
    },
    onActAs: async (selectedEmail) => {
      if (!state.realUser || state.realUser.rol !== "admin") return;
      if (!selectedEmail) return;

      sessionStorage.setItem(ACTING_USER_KEY, selectedEmail);
      await bootstrapFromSession();
      setHeaderAndScope();
      await loadOperaciones();
    },
    onResetActAs: async () => {
      sessionStorage.removeItem(ACTING_USER_KEY);
      await bootstrapFromSession();
      setHeaderAndScope();
      await loadOperaciones();
    }
  });
}

function bindEvents() {
  $("filtroAnoOps")?.addEventListener("change", () => {
    state.anoFiltro = $("filtroAnoOps").value;
    applyFiltersAndRender();
  });

  $("filtroDestinoOps")?.addEventListener("change", applyFiltersAndRender);
  $("filtroDocOps")?.addEventListener("change", applyFiltersAndRender);
  $("buscadorOps")?.addEventListener("input", debounce(applyFiltersAndRender, 180));

  $("btnRecargarOps")?.addEventListener("click", loadOperaciones);
  $("btnExportarOps")?.addEventListener("click", exportarXlsx);

  document.querySelectorAll("[data-modal]").forEach((btn) => {
    btn.addEventListener("click", () => {
      abrirModal(btn.dataset.modal);
    });
  });

  $("btnCerrarModalOps")?.addEventListener("click", () => closeDialog($("modalOps")));

  $("modalOps")?.addEventListener("click", (e) => {
    if (e.target === $("modalOps")) closeDialog($("modalOps"));
  });

  bindTableScrollSync();

  document.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-ops-toggle]");
    if (!btn) return;

    const idGrupo = btn.dataset.opsToggle || "";
    if (!idGrupo) return;

    await toggleOperacionesEstado(idGrupo);
  });
}

async function loadOperaciones() {
  renderEmpty("Cargando grupos...");

  try {
    const [groupsSnap, solicitudesSnap] = await Promise.all([
      getDocs(collection(db, "ventas_cotizaciones")),
      getDocs(collection(db, SOLICITUDES_COLLECTION))
    ]);

    state.allRows = groupsSnap.docs.map((docSnap) => {
      const data = docSnap.data() || {};
      return mapRow(docSnap.id, data);
    });

    state.solicitudesRows = solicitudesSnap.docs.map((docSnap) => ({
      id: docSnap.id,
      ...docSnap.data()
    }));

    fillYearFilter();
    fillDestinoFilter();
    applyFiltersAndRender();
  } catch (error) {
    console.error("[operaciones] loadOperaciones", error);
    renderEmpty("No se pudieron cargar los grupos.");
  }
}

document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-toggle-motivo]");
  if (!btn) return;

  const targetId = btn.dataset.toggleMotivo;
  const box = document.getElementById(targetId);
  if (!box) return;

  const isHidden = box.hidden;
  box.hidden = !isHidden;
  btn.textContent = isHidden ? "Ocultar motivo" : "Ver motivo";
});

function mapRow(docId, data = {}) {
  const idGrupo = cleanText(data.idGrupo || docId);
  const programa = data.programaGrupo || {};
  const ficha = data.ficha || {};
  const flow = data.flowFicha || {};

  const programaOriginalUrl = cleanText(programa.archivoUrl || "");
  const programaOriginalNombre = cleanText(programa.archivoNombre || "");
  const programaOriginalTipo = cleanText(programa.archivoTipo || "");

  const fichaProgramaPdfUrl = cleanText(ficha.programaPdfUrl || "");
  const fichaProgramaPendiente = ficha.pdfPendienteGeneracion === true;
  
  const programaPdfUrl = cleanText(
    programa.pdfUrl ||
    data.programaPdfUrl ||
    (!fichaProgramaPendiente ? fichaProgramaPdfUrl : "") ||
    ""
  );

  const fichaPdfUrl = cleanText(
    data.fichaPdfUrl ||
    ficha.pdfUrl ||
    ""
  );

  const fichaPdfNombre = cleanText(
    data.fichaPdfNombre ||
    ficha.pdfNombre ||
    ""
  );

  const alias = cleanText(
    data.aliasGrupo ||
    data.nombreGrupo ||
    data.colegio ||
    `Grupo ${idGrupo}`
  );

  const anoViaje = getYear(data.anoViaje);

  return {
    docId,
    idGrupo,
    alias,
    displayGrupo: buildDisplayGrupo(data, alias, anoViaje),
    colegio: cleanText(data.colegio),
    curso: cleanText(data.curso),
    anoViaje,
    pax: cleanText(data.cantidadGrupo || ""),
    tramo: cleanText(data.tramo || data.tramoOtro || ""),
    estado: normalizeEstado(data.estado),
    estadoOriginal: cleanText(data.estado),
    destino: cleanText(data.destinoPrincipal || data.destino || "Sin destino"),
    vendedora: cleanText(data.vendedora || ""),
    vendedoraCorreo: normalizeEmail(data.vendedoraCorreo || ""),
    numeroNegocio: cleanText(data.numeroNegocio || ficha.numeroNegocio || ""),
    nombrePrograma: cleanText(ficha.nombrePrograma || data.programa || data.programaOtro || ""),
    fichaEstado: cleanText(data.fichaEstado || ficha.estado || ""),
    fichaFlujoAbierto: data.fichaFlujoAbierto === true,
    autorizada: data.autorizada === true,
    flow,
    opsEstado: cleanText(data.operacionesEstado || "pendiente"),
    opsEstadoPor: cleanText(data.operacionesEstadoPor || ""),
    opsEstadoPorCorreo: normalizeEmail(data.operacionesEstadoPorCorreo || ""),
    opsEstadoAt: data.operacionesEstadoAt || null,

    programaOriginalUrl,
    programaOriginalNombre,
    programaOriginalTipo,
    programaPdfUrl,
    fichaPdfUrl,
    fichaPdfNombre,

    searchIndex: normalizeSearch([
      idGrupo,
      alias,
      buildDisplayGrupo(data, alias, anoViaje),
      data.colegio,
      data.curso,
      anoViaje,
      data.vendedora,
      data.vendedoraCorreo,
      data.destinoPrincipal,
      data.destino,
      data.numeroNegocio,
      ficha.numeroNegocio,
      ficha.nombrePrograma,
      data.programa,
      data.programaOtro,
      data.estado,
      data.fichaEstado
    ].join(" "))
  };
}

function applyFiltersAndRender() {
  const ano = String($("filtroAnoOps")?.value || state.anoFiltro || "");
  const filtroDestino = $("filtroDestinoOps")?.value || "todos";
  const filtroDoc = $("filtroDocOps")?.value || "todos";
  const q = normalizeSearch($("buscadorOps")?.value || "");

  let rows = state.allRows.filter((row) => {
    return row.estado === "ganada";
  });

  if (ano && ano !== "todos") {
    rows = rows.filter((row) => String(row.anoViaje || "") === String(ano));
  }
  if (filtroDestino !== "todos") {
    rows = rows.filter((row) => normalizeSearch(row.destino || "") === normalizeSearch(filtroDestino));
  }

  rows = rows.filter((row) => {
    if (filtroDoc === "todos") return true;
    if (filtroDoc === "programa_pendiente") return !hasPrograma(row);
    if (filtroDoc === "ficha_pendiente") return !hasFichaPdfVigente(row);
    if (filtroDoc === "todo_ok") return hasPrograma(row) && hasFichaPdfVigente(row);
    return true;
  });

  if (q) {
    rows = rows.filter((row) => row.searchIndex.includes(q));
  }

  rows.sort((a, b) => {
    return getAliasSortKey(a.displayGrupo).localeCompare(getAliasSortKey(b.displayGrupo), "es", {
      sensitivity: "base",
      numeric: true
    });
  });

  state.filteredRows = rows;

  buildSummarySets(rows);
  renderSummary();
  renderTable(rows);
}

function buildSummarySets(rows = []) {
  const solicitudesActualizacionAbiertas = getSolicitudesAbiertas("actualizacion_ficha");
  const solicitudesCorreccionAbiertas = getSolicitudesAbiertas("correccion_ficha");

  state.sets.ganadas = rows;

  state.sets.actualizacion = rows.filter((row) =>
    solicitudesActualizacionAbiertas.has(row.idGrupo)
  );

  state.sets.correccion = rows.filter((row) => {
    // Si el flujo real ya NO está pendiente, no mostrar aunque exista solicitud vieja.
    if (!isCorreccionFichaPendiente(row)) return false;
  
    return (
      solicitudesCorreccionAbiertas.has(row.idGrupo) ||
      isCorreccionFichaPendiente(row)
    );
  });

  state.sets.firmar = rows.filter((row) => {
    if (solicitudesActualizacionAbiertas.has(row.idGrupo)) return false;
    if (solicitudesCorreccionAbiertas.has(row.idGrupo)) return false;
    if (isCorreccionFichaPendiente(row)) return false;
    if (isActualizacionFichaPendiente(row)) return false;
    return isFichaPorFirmarGeneral(row);
  });

  state.sets.programa = rows.filter((row) => !hasPrograma(row));
  state.sets.autorizadas = rows.filter((row) => row.autorizada === true && hasFichaPdfVigente(row));
}

function renderSummary() {
  setText("opsCountGanadas", state.sets.ganadas.length);
  setText("opsCountFirmar", state.sets.firmar.length);
  setText("opsCountActualizacion", state.sets.actualizacion.length);
  setText("opsCountCorreccion", state.sets.correccion.length);
  setText("opsCountProgramaPendiente", state.sets.programa.length);
  setText("opsCountAutorizadas", state.sets.autorizadas.length);
}

function renderTable(rows = []) {
  const tbody = $("tbodyOperaciones");
  if (!tbody) return;

  if (!rows.length) {
    renderEmpty("No hay grupos para los filtros seleccionados.");
    syncTableScrollWidth();
    return;
  }

  tbody.innerHTML = rows.map(renderRow).join("");

  syncTableScrollWidth();
}

function renderRow(row) {
  return `
    <tr>
      <td class="ops-col-grupo" title="${escapeAttr(row.displayGrupo)}">
        <div class="ops-group-title">${escapeHtml(row.displayGrupo)}</div>
        <div class="ops-group-sub" title="${escapeAttr(formatGrupoId(row))} · ${escapeAttr(row.colegio || "")} · ${escapeAttr(row.curso || "")}">
          ${escapeHtml(formatGrupoId(row))} · ${escapeHtml(row.colegio || "Sin colegio")} · ${escapeHtml(row.curso || "Sin curso")}
        </div>
      </td>

      <td title="${escapeAttr(row.vendedora || row.vendedoraCorreo || "—")}">${escapeHtml(row.vendedora || row.vendedoraCorreo || "—")}</td>
      <td title="${escapeAttr(row.destino || "—")}">${escapeHtml(row.destino || "—")}</td>
      <td title="${escapeAttr(row.anoViaje || "—")}">${escapeHtml(row.anoViaje || "—")}</td>
      <td title="${escapeAttr(row.pax || "—")}">${escapeHtml(row.pax || "—")}</td>
      <td title="${escapeAttr(row.tramo || "—")}">${escapeHtml(row.tramo || "—")}</td>

      <td>
        ${renderEstadoOperativoButton(row)}
      </td>

      <td title="${escapeAttr(row.opsEstadoPor || row.opsEstadoPorCorreo || "Sin usuario")}">
        ${escapeHtml(row.opsEstadoPor || row.opsEstadoPorCorreo || "—")}
      </td>

      <td>
        <div class="ops-docs">
          ${renderDocLink({
            label: "Programa original",
            icon: "📄",
            url: row.programaOriginalUrl,
            ok: hasPrograma(row),
            title: row.programaOriginalNombre || "Programa"
          })}

          ${renderDocLink({
            label: "Programa PDF",
            icon: "📑",
            url: row.programaPdfUrl,
            ok: !!row.programaPdfUrl,
            title: "Programa PDF convertido"
          })}

          ${renderDocLink({
            label: "Ficha PDF",
            icon: "🧾",
            url: row.fichaPdfUrl,
            ok: hasFichaPdfVigente(row),
            title: row.fichaPdfNombre || "Ficha PDF"
          })}
        </div>
      </td>

      <td>
        <div class="ops-docs">
          <a class="ops-pill ops-muted" href="grupo.html?id=${encodeURIComponent(row.idGrupo)}" target="_blank" rel="noopener">Grupo</a>
          <a class="ops-pill ops-muted" href="fichas.html?id=${encodeURIComponent(row.idGrupo)}" target="_blank" rel="noopener">Ficha</a>
        </div>
      </td>
    </tr>
  `;
}

function renderDocLink({ label, icon, url, ok, title }) {
  const css = ok ? "ops-ok" : "ops-warn";

  if (url) {
    return `
      <a
        class="ops-doc ${css}"
        href="${escapeAttr(url)}"
        target="_blank"
        rel="noopener"
        title="${escapeAttr(label)} · ${escapeAttr(title || "Abrir")}"
      >${icon}</a>
    `;
  }

  return `
    <span
      class="ops-doc ${css}"
      title="${escapeAttr(label)} pendiente"
    >${icon}</span>
  `;
}

function renderEstadoOperativo(row) {
  if (isCorreccionFichaPendiente(row)) {
    return `<span class="ops-pill ops-warn">Corrección</span>`;
  }

  if (isActualizacionFichaPendiente(row)) {
    return `<span class="ops-pill ops-warn">Actualización</span>`;
  }

  if (!hasPrograma(row)) {
    return `<span class="ops-pill ops-warn">Falta programa</span>`;
  }

  if (!hasFichaPdfVigente(row)) {
    return `<span class="ops-pill ops-warn">Falta ficha PDF</span>`;
  }

  return `<span class="ops-pill ops-ok">OK operaciones</span>`;
}

function renderEstadoOperativoButton(row) {
  const ok = normalizeSearch(row.opsEstado) === "ok";
  const css = ok ? "ops-ok" : "ops-warn";
  const label = ok ? "OK" : "Pendiente";
  const disabled = canEditOperacionesEstado() ? "" : "disabled";

  return `
    <button
      type="button"
      class="ops-pill ops-status-btn ${css}"
      data-ops-toggle="${escapeAttr(row.idGrupo)}"
      ${disabled}
      title="${canEditOperacionesEstado() ? "Cambiar estado operativo" : "Solo operaciones/admin puede cambiar este estado"}"
    >
      ${label}
    </button>
  `;
}

function renderEmpty(message) {
  const tbody = $("tbodyOperaciones");
  if (!tbody) return;

  tbody.innerHTML = `
    <tr>
      <td colspan="10" class="ops-empty">${escapeHtml(message)}</td>
    </tr>
  `;
}

function abrirModal(tipo = "") {
  const map = {
    ganadas: {
      titulo: "Grupos ganados",
      subtitulo: "Grupos ganados del año seleccionado.",
      rows: state.sets.ganadas
    },
    firmar: {
      titulo: "Fichas por firmar",
      subtitulo: "Grupos ganados que aún no completan las firmas.",
      rows: state.sets.firmar
    },
    actualizacion: {
      titulo: "Fichas en actualización",
      subtitulo: "Solicitudes de actualización abiertas.",
      rows: state.sets.actualizacion
    },
    correccion: {
      titulo: "Fichas en corrección",
      subtitulo: "Correcciones pendientes del flujo de ficha.",
      rows: state.sets.correccion
    },
    programa: {
      titulo: "Programa pendiente",
      subtitulo: "Grupos ganados sin programa cargado.",
      rows: state.sets.programa
    },
    autorizadas: {
      titulo: "Fichas autorizadas",
      subtitulo: "Grupos con PDF final vigente y autorización.",
      rows: state.sets.autorizadas
    }
  };

  const config = map[tipo] || map.ganadas;

  setText("modalOpsTitulo", config.titulo);
  setText("modalOpsSubtitulo", `${config.subtitulo} Total: ${config.rows.length}`);

  const input = $("modalOpsBuscador");
  if (input) input.value = "";

  renderModalRows(config.rows);

  if (input && !input.dataset.boundOps) {
    input.dataset.boundOps = "1";
    input.addEventListener("input", () => {
      const q = normalizeSearch(input.value || "");
      const baseRows = map[tipo]?.rows || [];
      const filtered = q
        ? baseRows.filter((row) => row.searchIndex.includes(q))
        : baseRows;

      renderModalRows(filtered);
    });
  }

  openDialog($("modalOps"));
}

function renderModalRows(rows = []) {
  const cont = $("modalOpsContenido");
  if (!cont) return;

  if (!rows.length) {
    cont.innerHTML = `<div class="ops-empty">No hay registros.</div>`;
    return;
  }

  cont.innerHTML = rows.map((row) => {
    const solActualizacion = getSolicitudByGrupo(row.idGrupo, "actualizacion_ficha");
    const solCorreccion = getSolicitudByGrupo(row.idGrupo, "correccion_ficha");

    const motivoActualizacion = solActualizacion?.detalle || "";
    const motivoCorreccion = solCorreccion?.detalle || getCorreccionDetalle(row);

    return `
      <div class="ops-list-row">
        <div style="min-width:0;">
          <div class="ops-list-title">${escapeHtml(row.alias)}</div>

          <div class="ops-list-text">
            ${escapeHtml(formatGrupoId(row))}<br>
            Colegio: ${escapeHtml(row.colegio || "Sin colegio")} · Curso: ${escapeHtml(row.curso || "Sin curso")} · Año: ${escapeHtml(row.anoViaje || "—")}<br>
            Vendedor(a): ${escapeHtml(row.vendedora || row.vendedoraCorreo || "—")}<br>
            Programa: ${hasPrograma(row) ? "OK" : "Pendiente"} · Ficha PDF: ${hasFichaPdfVigente(row) ? "OK" : "Pendiente"}
          </div>

          ${motivoActualizacion ? renderMotivoBox({
            id: `actualizacion-${row.idGrupo}`,
            titulo: "Motivo actualización",
            texto: motivoActualizacion
          }) : ""}

          ${motivoCorreccion ? renderMotivoBox({
            id: `correccion-${row.idGrupo}`,
            titulo: "Motivo corrección",
            texto: motivoCorreccion
          }) : ""}
        </div>

        <div class="ops-docs">
          <a class="ops-pill ops-muted" href="fichas.html?id=${encodeURIComponent(row.idGrupo)}" target="_blank" rel="noopener">Ficha</a>
          <a class="ops-pill ops-muted" href="grupo.html?id=${encodeURIComponent(row.idGrupo)}" target="_blank" rel="noopener">Grupo</a>
        </div>
      </div>
    `;
  }).join("");
}

function fillYearFilter() {
  const select = $("filtroAnoOps");
  if (!select) return;

  const years = [...new Set(
    state.allRows
      .map((row) => row.anoViaje)
      .filter(Boolean)
      .map(String)
  )].sort();

  const defaultYear = String(getAnoOperativoActual());

  if (!years.includes(defaultYear)) years.unshift(defaultYear);

  select.innerHTML = years.map((year) => `
    <option value="${escapeAttr(year)}">${escapeHtml(year)}</option>
  `).join("");

  select.value = years.includes(state.anoFiltro) ? state.anoFiltro : defaultYear;
  state.anoFiltro = select.value;
}

function fillDestinoFilter() {
  const select = $("filtroDestinoOps");
  if (!select) return;

  const previous = select.value || "todos";

  // =========================================
  // NORMALIZADOR ÚNICO DE DESTINOS
  // =========================================
  function normalizarDestino(valor = "") {
    const v = normalizeSearch(valor);

    if (!v) return "Sin destino";

    // SIN DESTINO
    if (v.includes("sin destino")) return "Sin destino";

    // SUR DE CHILE Y BARILOCHE
    if (
      (v.includes("sur de chile") && v.includes("bariloche")) ||
      v.includes("sur y bariloche")
    ) {
      return "Sur de Chile y Bariloche";
    }

    // BARILOCHE
    if (v.includes("bariloche")) return "Bariloche";

    // SUR DE CHILE
    if (v.includes("sur de chile")) return "Sur de Chile";

    // NORTE DE CHILE
    if (v.includes("norte de chile")) return "Norte de Chile";

    // BRASIL
    if (v.includes("brasil")) return "Brasil";

    // REPÚBLICA DOMINICANA
    if (
      v.includes("republica dominicana") ||
      v.includes("rep dominicana") ||
      v.includes("dominicana")
    ) {
      return "República Dominicana";
    }

    // OTRO
    return "Otro";
  }

  // =========================================
  // ACTUALIZAR TODAS LAS FILAS EN MEMORIA
  // =========================================
  state.allRows.forEach((row) => {
    row.destino = normalizarDestino(row.destino);
  });

  // =========================================
  // OPCIONES FIJAS Y LIMPIAS
  // =========================================
  const destinosOrdenados = [
    "Bariloche",
    "Sur de Chile y Bariloche",
    "Sur de Chile",
    "Norte de Chile",
    "Brasil",
    "República Dominicana",
    "Otro",
    "Sin destino"
  ];

  select.innerHTML = `
    <option value="todos">Todos</option>
    ${destinosOrdenados.map((destino) => `
      <option value="${escapeAttr(destino)}">${escapeHtml(destino)}</option>
    `).join("")}
  `;

  select.value = destinosOrdenados.includes(previous) ? previous : "todos";
}

function exportarXlsx() {
  if (typeof XLSX === "undefined") {
    alert("No se encontró la librería XLSX.");
    return;
  }

  if (!state.filteredRows.length) {
    alert("No hay registros para exportar.");
    return;
  }

  const data = state.filteredRows.map((row) => ({
    "ID GRUPO": row.idGrupo,
    "N° NEGOCIO": row.numeroNegocio,
    "ID + N°": formatGrupoId(row),
    "GRUPO": row.displayGrupo || row.alias,
    "COLEGIO": row.colegio,
    "CURSO": row.curso,
    "AÑO VIAJE": row.anoViaje,
    "VENDEDOR(A)": row.vendedora || row.vendedoraCorreo,
    "DESTINO": row.destino,
    "PROGRAMA": hasPrograma(row) ? "OK" : "PENDIENTE",
    "PROGRAMA ORIGINAL": row.programaOriginalUrl,
    "PROGRAMA PDF": row.programaPdfUrl,
    "FICHA PDF": hasFichaPdfVigente(row) ? "OK" : "PENDIENTE",
    "FICHA PDF URL": row.fichaPdfUrl,
    "FICHA ESTADO": row.fichaEstado,
    "AUTORIZADA": row.autorizada ? "SI" : "NO"
  }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(data);
  XLSX.utils.book_append_sheet(wb, ws, "Operaciones");
  XLSX.writeFile(wb, `operaciones_${fileStamp()}.xlsx`);
}

/* =========================================================
   REGLAS
========================================================= */

function hasPrograma(row = {}) {
  return !!(
    row.programaOriginalUrl ||
    row.programaPdfUrl
  );
}

function hasFichaPdfVigente(row = {}) {
  if (!row.fichaPdfUrl) return false;
  if (row.fichaFlujoAbierto) return false;

  const estado = normalizeSearch(row.fichaEstado);
  if (estado.includes("confirmada_pdf") || estado.includes("pdf_confirmado")) return true;

  return row.autorizada === true;
}

function getFichaStatus(row = {}) {
  if (hasFichaPdfVigente(row)) {
    return { label: "PDF OK", css: "ops-ok" };
  }

  if (row.fichaFlujoAbierto) {
    return { label: "Abierta", css: "ops-warn" };
  }

  const flow = row.flow || {};

  if (!flow?.vendedor?.firmado) {
    return { label: "Falta vendedor", css: "ops-warn" };
  }

  if (!flow?.jefaVentas?.firmado) {
    return { label: "Falta jefa", css: "ops-warn" };
  }

  if (!flow?.administracion?.firmado) {
    return { label: "Falta admin", css: "ops-warn" };
  }

  return { label: "PDF pendiente", css: "ops-warn" };
}

function isFichaPorFirmarGeneral(row = {}) {
  const flow = row.flow || {};

  return !(
    flow?.vendedor?.firmado &&
    flow?.jefaVentas?.firmado &&
    flow?.administracion?.firmado
  );
}

function isCorreccionFichaPendiente(row = {}) {
  const flow = row.flow || {};
  const modo = normalizeSearch(flow.modo || "");
  const correccionEstado = normalizeSearch(flow.correccionEstado || "");

  const firmasCompletas = !!(
    flow?.vendedor?.firmado &&
    flow?.jefaVentas?.firmado &&
    flow?.administracion?.firmado
  );

  const pdfVigente = hasFichaPdfVigente(row);
  const flujoCerrado = row.fichaFlujoAbierto !== true;

  // Si ya está cerrada, firmada y con PDF vigente, NO debe caer en corrección.
  if (
    correccionEstado === "cerrada" ||
    (
      firmasCompletas &&
      pdfVigente &&
      flujoCerrado &&
      flow.correccionPendiente !== true
    )
  ) {
    return false;
  }

  return (
    modo === "correccion" ||
    flow.correccionPendiente === true ||
    correccionEstado.startsWith("pendiente")
  );
}

function isActualizacionFichaPendiente(row = {}) {
  const flow = row.flow || {};
  return flow.requiereActualizacion === true;
}

function getSolicitudesAbiertas(tipo = "") {
  const set = new Set();

  state.solicitudesRows.forEach((sol) => {
    const tipoSol = normalizeSearch(sol.tipoSolicitud || "");
    const estado = normalizeSearch(sol.estadoSolicitud || "");

    if (tipoSol !== tipo) return;
    if (sol.resuelta === true) return;
    if (estado === "completada" || estado === "cerrada") return;

    const idGrupo = cleanText(sol.idGrupo || "");
    if (idGrupo) set.add(idGrupo);
  });

  return set;
}

/* =========================================================
   HELPERS
========================================================= */

function getSolicitudByGrupo(idGrupo = "", tipo = "") {
  return (state.solicitudesRows || []).find((sol) => {
    const mismoGrupo = cleanText(sol.idGrupo || "") === cleanText(idGrupo);
    const mismoTipo = normalizeSearch(sol.tipoSolicitud || "") === normalizeSearch(tipo);
    const estado = normalizeSearch(sol.estadoSolicitud || "");

    return (
      mismoGrupo &&
      mismoTipo &&
      sol.resuelta !== true &&
      estado !== "completada" &&
      estado !== "cerrada"
    );
  }) || null;
}

function getCorreccionDetalle(row = {}) {
  return cleanText(
    row?.flow?.ultimaCorreccion?.detalle ||
    row?.flow?.ultimaCorreccion?.asunto ||
    row?.ultimaCorreccion?.detalle ||
    row?.ultimaCorreccion?.asunto ||
    ""
  );
}

function getTextoResumen(texto = "", max = 90) {
  const clean = cleanText(texto);
  if (clean.length <= max) return clean;
  return clean.slice(0, max).trim() + "...";
}

function renderMotivoBox({ id = "", titulo = "Motivo", texto = "" } = {}) {
  const detalle = cleanText(texto);
  if (!detalle) return "";

  const uid = `ops-motivo-${id}`;

  return `
    <div style="margin-top:10px; padding:10px 12px; border-radius:14px; background:#fff8eb; border:1px solid #f0c27a; color:#5f3b00; font-size:13px; line-height:1.45;">
      <strong>${escapeHtml(titulo)}:</strong> ${escapeHtml(getTextoResumen(detalle, 90))}

      <button
        type="button"
        data-toggle-motivo="${escapeAttr(uid)}"
        style="margin-left:8px; border:0; background:#f2dfbd; color:#4b2d00; border-radius:999px; padding:5px 9px; font-weight:800; cursor:pointer;"
      >
        Ver motivo
      </button>

      <div
        id="${escapeAttr(uid)}"
        hidden
        style="margin-top:10px; padding-top:10px; border-top:1px solid #e8c98f;"
      >
        <strong>${escapeHtml(titulo)} completo:</strong><br>
        ${escapeHtml(detalle)}
      </div>
    </div>
  `;
}

function getAnoOperativoActual() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();

  return month < 2 ? year - 1 : year;
}

function getYear(value) {
  const match = String(value ?? "").match(/\d{4}/);
  return match ? Number(match[0]) : "";
}

function normalizeEstado(value = "") {
  const v = normalizeSearch(value);

  if (v.includes("ganad")) return "ganada";
  if (v.includes("perdid")) return "perdida";
  if (v.includes("reunion") && v.includes("confirm")) return "reunion_confirmada";
  if (v.includes("recot")) return "recotizando";
  if (v.includes("cotiz")) return "cotizando";
  if (v.includes("contactad")) return "contactado";
  if (v.includes("a contactar")) return "a_contactar";

  return v || "";
}

function normalizeSearch(value = "") {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function getAliasSortKey(value = "") {
  return normalizeSearch(value)
    .replace(/^\s*\d+[a-zA-Z]*\s*\(\d{4}\)\s*/g, "")
    .replace(/^\s*\d+[a-zA-Z]*\s*/g, "")
    .trim();
}

function cleanText(value = "") {
  return String(value ?? "").trim();
}

function formatGrupoId(row = {}) {
  const id = row.idGrupo || row.id || "—";
  const numeroNegocio = cleanText(row.numeroNegocio || "");

  return numeroNegocio ? `ID ${id} (N° ${numeroNegocio})` : `ID ${id}`;
}

function setText(id, value) {
  const el = $(id);
  if (el) el.textContent = String(value ?? "");
}

function openDialog(dialog) {
  if (!dialog) return;
  if (typeof dialog.showModal === "function") {
    if (!dialog.open) dialog.showModal();
    return;
  }
  dialog.setAttribute("open", "open");
}

function closeDialog(dialog) {
  if (!dialog) return;
  if (typeof dialog.close === "function") {
    dialog.close();
    return;
  }
  dialog.removeAttribute("open");
}

function debounce(fn, wait = 150) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

function fileStamp() {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
    "_",
    String(d.getHours()).padStart(2, "0"),
    String(d.getMinutes()).padStart(2, "0")
  ].join("");
}

function escapeHtml(value = "") {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttr(value = "") {
  return escapeHtml(value);
}

function bindTableScrollSync() {
  const top = $("opsScrollTop");
  const wrap = $("opsTableWrap");
  const inner = $("opsScrollTopInner");

  if (!top || !wrap || !inner) return;
  if (top.dataset.bound === "1") return;

  top.dataset.bound = "1";

  top.addEventListener("scroll", () => {
    wrap.scrollLeft = top.scrollLeft;
  });

  wrap.addEventListener("scroll", () => {
    top.scrollLeft = wrap.scrollLeft;
  });

  window.addEventListener("resize", syncTableScrollWidth);

  setTimeout(syncTableScrollWidth, 300);
}

function syncTableScrollWidth() {
  const wrap = $("opsTableWrap");
  const inner = $("opsScrollTopInner");

  if (!wrap || !inner) return;

  requestAnimationFrame(() => {
    inner.style.width = `${wrap.scrollWidth}px`;
  });
}

function canEditOperacionesEstado() {
  const email = normalizeEmail(state.effectiveEmail || "");
  const rol = String(state.effectiveUser?.rol || "").toLowerCase();

  return (
    rol === "admin" ||
    email === "aleoperaciones@raitrai.cl" ||
    email === "operaciones@raitrai.cl"
  );
}

async function toggleOperacionesEstado(idGrupo = "") {
  if (!canEditOperacionesEstado()) {
    alert("Solo Operaciones o Admin puede cambiar este estado.");
    return;
  }

  const row = state.allRows.find((item) => String(item.idGrupo) === String(idGrupo));
  if (!row) {
    alert("No encontré el grupo.");
    return;
  }

  const actual = normalizeSearch(row.opsEstado) === "ok" ? "ok" : "pendiente";
  const nuevo = actual === "ok" ? "pendiente" : "ok";

  const ok = confirm(`Vas a cambiar el estado operativo de "${row.displayGrupo}" de ${actual.toUpperCase()} a ${nuevo.toUpperCase()}.`);
  if (!ok) return;

  const userName = getDisplayName(state.effectiveUser);

  try {
    await setDoc(doc(db, "ventas_cotizaciones", row.docId), {
      operacionesEstado: nuevo,
      operacionesEstadoPor: userName,
      operacionesEstadoPorCorreo: state.effectiveEmail,
      operacionesEstadoAt: serverTimestamp()
    }, { merge: true });

    await addDoc(collection(db, HISTORIAL_COLLECTION), {
      idGrupo: String(row.idGrupo),
      aliasGrupo: row.displayGrupo || row.alias || "",
      colegio: row.colegio || "",
      modulo: "operaciones",
      tipoMovimiento: "estado_operativo",
      titulo: "Cambio de estado operativo",
      mensaje: `${userName} cambió estado operativo de ${actual.toUpperCase()} a ${nuevo.toUpperCase()}.`,
      metadata: {
        cambios: [
          {
            campo: "operacionesEstado",
            anterior: actual,
            nuevo
          }
        ]
      },
      creadoPor: userName,
      creadoPorCorreo: state.effectiveEmail,
      fecha: serverTimestamp()
    });

    await loadOperaciones();
  } catch (error) {
    console.error("[operaciones] toggleOperacionesEstado", error);
    alert("No se pudo guardar el estado operativo: " + error.message);
  }
}

function getDisplayName(user = {}) {
  const full = [user?.nombre, user?.apellido].filter(Boolean).join(" ").trim();
  return full || user?.email || state.effectiveEmail || "Usuario";
}

function buildDisplayGrupo(data = {}, alias = "", anoViaje = "") {
  const colegio = cleanText(data.colegio || "");
  const curso = cleanText(data.curso || "");
  const year = cleanText(anoViaje || data.anoViaje || "");

  const aliasClean = cleanText(alias || "");

  if (!colegio) return aliasClean;

  const cursoYear = [curso, year ? `(${year})` : ""].filter(Boolean).join(" ");

  if (cursoYear) {
    return `${colegio} ${cursoYear}`;
  }

  return colegio;
}
