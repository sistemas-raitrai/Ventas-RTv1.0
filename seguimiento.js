import {
  auth,
  db,
  puedeVerGeneral,
  normalizeEmail,
  VENTAS_USERS,
  getVentasUser,
  getVentasUserEmails
} from "./firebase-init.js";

import {
  collection,
  getDocs
} from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";

import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/11.7.3/firebase-auth.js";

import {
  ACTING_USER_KEY,
  getRealUser,
  getEffectiveUser
} from "./roles.js";

import {
  bindLayoutButtons,
  waitForLayoutReady
} from "./ui.js";

/* =========================================================
   CONFIG
========================================================= */
const $ = (id) => document.getElementById(id);
const CURRENT_YEAR = new Date().getFullYear();

const state = {
  allRows: [],
  filteredRows: [],
  visibleRows: [],
  authEmail: "",
  effectiveEmail: "",
  currentUser: null,
  realUser: null,
  canSeeAll: false,

  // filtro recibido desde dashboard
  dashboardPreset: {
    bucket: "",
    ano: "",
    archivados: false,
    vendor: ""
  },

  // Perdidas oculto por defecto
  hiddenSummaryStates: new Set(["perdida"]),

  // Orden default pedido: por vendedor
  sortKey: "vendedora",
  sortDir: "asc"
};

const STAGE_META = {
  a_contactar:        { label: "A contactar",        steps: 1, fillClass: "seg-fill-red",    order: 1 },
  contactado:         { label: "Contactado",         steps: 2, fillClass: "seg-fill-orange", order: 2 },
  cotizando:          { label: "Cotizando",          steps: 3, fillClass: "seg-fill-yellow", order: 3 },
  recotizando:        { label: "Recotizando",        steps: 3, fillClass: "seg-fill-yellow", order: 4 },
  reunion_confirmada: { label: "Reunión confirmada", steps: 4, fillClass: "seg-fill-mix",    order: 5 },
  ganada:             { label: "Ganada",             steps: 5, fillClass: "seg-fill-green",  order: 6 },
  perdida:            { label: "Perdida",            steps: 5, fillClass: "seg-fill-red",    order: 7 }
};

const DOCS_META = [
  { key: "fichaMedicaEstado", label: "Fichas médicas",       icon: "🩺" },
  { key: "nominaEstado",      label: "Nómina de viaje",      icon: "📋" },
  { key: "fichaEstado",       label: "Ficha del grupo",      icon: "🧾" },
  { key: "contratoEstado",    label: "Contrato",             icon: "✍️" },
  { key: "cortesiaEstado",    label: "Estadías de cortesía", icon: "🎁" }
];

/* =========================================================
   INIT
========================================================= */
initPage();

async function initPage() {
  bindEvents();
  await waitForLayoutReady();
  bindHeaderActions();

  onAuthStateChanged(auth, async (user) => {
    if (!user) return;
  
    await bootstrapFromSession();
    renderActingUserSwitcherSimple();
    bindHeaderActions(); // reengancha entrar como / volver a mi usuario
  
    updateSummaryButtonsUI();
    updateSortHeaderUI();
    await loadSeguimiento();
  });
}

async function bootstrapFromSession() {
  state.realUser = getRealUser();
  state.currentUser = getEffectiveUser();
  
  const resolvedRealUser = getVentasUser(state.realUser?.email || auth.currentUser?.email || "");
  const resolvedEffectiveUser = getVentasUser(state.currentUser?.email || state.realUser?.email || auth.currentUser?.email || "");
  
  if (resolvedRealUser) {
    state.realUser = { ...state.realUser, ...resolvedRealUser };
  }
  
  if (resolvedEffectiveUser) {
    state.currentUser = { ...state.currentUser, ...resolvedEffectiveUser };
  }
  
  state.authEmail = normalizeEmail(state.realUser?.email || auth.currentUser?.email || "");
  state.effectiveEmail = normalizeEmail(state.currentUser?.email || state.authEmail);

  // IMPORTANTE:
  // usar solo el usuario efectivo, para que "Entrar como" sí respete
  // la vista del vendedor.
  state.canSeeAll = puedeVerGeneral(state.effectiveEmail);

  document.body.classList.toggle(
    "is-vendedor-view",
    String(state.currentUser?.rol || "").toLowerCase() === "vendedor"
  );
}

function bindHeaderActions() {
  bindLayoutButtons({
    homeUrl: "index.html",
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
      renderActingUserSwitcherSimple();
      updateSummaryButtonsUI();
      updateSortHeaderUI();
      await loadSeguimiento();
    },
    onResetActAs: async () => {
      sessionStorage.removeItem(ACTING_USER_KEY);
      await bootstrapFromSession();
      renderActingUserSwitcherSimple();
      updateSummaryButtonsUI();
      updateSortHeaderUI();
      await loadSeguimiento();
    }
  });
}

function renderActingUserSwitcherSimple() {
  const wrap = document.getElementById("admin-switcher");
  const select = document.getElementById("select-acting-user");
  if (!wrap || !select) return;

  if (!state.realUser || state.realUser.rol !== "admin") {
    wrap.classList.add("hidden");
    return;
  }

  wrap.classList.remove("hidden");

  const current = select.value || "";
  const options = VENTAS_USERS
    .map((u) => {
      const nombreCompleto = [u.nombre, u.apellido].filter(Boolean).join(" ");
      return {
        email: u.email,
        label: `${nombreCompleto || u.email} · ${u.rol}`
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label, "es"));

  select.innerHTML = `
    <option value="">Elegir usuario</option>
    ${options.map((opt) => `<option value="${opt.email}">${opt.label}</option>`).join("")}
  `;

  select.value = options.some((opt) => opt.email === state.effectiveEmail)
    ? state.effectiveEmail
    : current;
}

/* =========================================================
   EVENTOS
========================================================= */
function bindEvents() {
  $("filtroAno")?.addEventListener("change", applyFiltersAndRender);
  $("filtroEstado")?.addEventListener("change", applyFiltersAndRender);
  $("filtroVendedora")?.addEventListener("change", applyFiltersAndRender);

  $("toggleAnteriores")?.addEventListener("change", () => {
    fillYearFilter(state.allRows);
    applyFiltersAndRender();
  });

  $("buscadorSeguimiento")?.addEventListener("input", debounce(() => {
    applyFiltersAndRender();
  }, 180));

  $("btnRecargarSeguimiento")?.addEventListener("click", async () => {
    await loadSeguimiento();
  });

  $("btnExportarSeguimiento")?.addEventListener("click", exportVisibleRowsToXlsx);

  document.querySelectorAll(".summary-filter").forEach((btn) => {
    btn.addEventListener("click", () => {
      const summaryState = String(btn.dataset.summaryState || "");

      if (!summaryState) return;

      // Total = mostrar todos
      if (summaryState === "__all__") {
        state.hiddenSummaryStates.clear();
      } else {
        if (state.hiddenSummaryStates.has(summaryState)) {
          state.hiddenSummaryStates.delete(summaryState);
        } else {
          state.hiddenSummaryStates.add(summaryState);
        }
      }

      updateSummaryButtonsUI();
      applyFiltersAndRender();
    });
  });

  document.querySelectorAll(".th-sort").forEach((btn) => {
    btn.addEventListener("click", () => {
      const sortKey = String(btn.dataset.sort || "");
      if (!sortKey) return;

      if (state.sortKey === sortKey) {
        state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
      } else {
        state.sortKey = sortKey;
        state.sortDir = "asc";
      }

      updateSortHeaderUI();
      applyFiltersAndRender();
    });
  });
}

function updateSummaryButtonsUI() {
  document.querySelectorAll(".summary-filter").forEach((btn) => {
    const summaryState = String(btn.dataset.summaryState || "");

    if (summaryState === "__all__") {
      const allVisible = state.hiddenSummaryStates.size === 0;
      btn.classList.toggle("is-active", allVisible);
      btn.classList.toggle("is-off", !allVisible);
      return;
    }

    const isHidden = state.hiddenSummaryStates.has(summaryState);
    btn.classList.toggle("is-active", !isHidden);
    btn.classList.toggle("is-off", isHidden);
  });
}

function updateSortHeaderUI() {
  document.querySelectorAll(".th-sort").forEach((btn) => {
    const key = String(btn.dataset.sort || "");
    const active = key === state.sortKey;

    btn.classList.toggle("active", active);

    const arrow = btn.querySelector(".sort-arrow");
    if (!arrow) return;

    if (!active) {
      arrow.textContent = "↕";
    } else {
      arrow.textContent = state.sortDir === "asc" ? "↑" : "↓";
    }
  });
}

/* =========================================================
   CARGA PRINCIPAL
========================================================= */
async function loadSeguimiento() {
  renderEmpty("Cargando grupos...");

  try {
    const snap = await getDocs(collection(db, "ventas_cotizaciones"));
    const rows = [];

    snap.forEach((docSnap) => {
      rows.push(mapClienteDoc(docSnap.id, docSnap.data() || {}));
    });

    state.allRows = rows;
    
    fillVendorFilter(rows);
    applyDashboardPreset();
    updateSummaryButtonsUI();
    applyFiltersAndRender();
  } catch (err) {
    console.error("[seguimiento] error cargando clientes:", err);
    renderEmpty("No se pudieron cargar los grupos.");
  }
}

/* =========================================================
   MAPEO DE DATOS
========================================================= */
function mapClienteDoc(id, data) {
  const aliasGrupo = cleanText(data.aliasGrupo);

  const nombreApoderado = cleanText(
    data.nombreCliente ||
    data.nombreApoderado ||
    data.apoderado ||
    ""
  );

  const nombreGrupo = cleanText(
    data.nombreGrupo ||
    data.colegio ||
    ""
  );

  const colegio = cleanText(data.colegio);
  const curso = cleanText(data.curso);
  const anoViaje = Number(data.anoViaje || 0) || 0;

  const destino = cleanText(
    data.destinoPrincipal ||
    data.destino ||
    "Sin destino"
  );

  const estado = normalizeEstado(
    data.estado ||
    data.estadoGrupo ||
    data.estadoComercial ||
    data.etapaComercial
  );

  const autorizada = resolveAutorizada(data);
  const cerrada = resolveCerrada(data);

  const imagen = cleanText(
    data.imagen ||
    data.imagenUrl ||
    ""
  );

  const ultimaGestionAt = toDate(
    data.ultimaGestionAt ||
    data.fechaActualizacion ||
    data.actualizadoEl ||
    data.updatedAt ||
    data.fechaCreacion ||
    null
  );

  const fechaUltimaReunion = toDate(
    data.fechaUltimaReunion ||
    data.ultimaReunion ||
    data.fechaReunion ||
    null
  );

  const vendedora = cleanText(data.vendedora || "");
  const vendedoraCorreo = normalizeEmail(data.vendedoraCorreo || "");

  const fichaMedicaEstado = normalizeDocState(data.fichaMedicaEstado);
  const nominaEstado = normalizeDocState(data.nominaEstado);
  const fichaEstado = normalizeDocState(data.fichaEstado);
  const contratoEstado = normalizeDocState(data.contratoEstado);
  const cortesiaEstado = normalizeDocState(data.cortesiaEstado);

  const displayTitle = aliasGrupo || nombreApoderado || nombreGrupo || `Grupo ${id}`;

  let subtitleParts = [];

  if (aliasGrupo) {
    subtitleParts = [
      anoViaje ? `Año ${anoViaje}` : ""
    ].filter(Boolean);
  } else {
    subtitleParts = [
      colegio || nombreGrupo || "",
      anoViaje ? `Año ${anoViaje}` : ""
    ].filter(Boolean);
  }

  return {
    id,
    idGrupo: cleanText(data.idGrupo || id),
    aliasGrupo,
    nombreApoderado,
    nombreGrupo,
    colegio,
    curso,
    anoViaje,
    destino,
    estado,
    autorizada,
    cerrada,
    imagen,
    ultimaGestionAt,
    fechaUltimaReunion,
    vendedora,
    vendedoraCorreo,
    fichaMedicaEstado,
    nominaEstado,
    fichaEstado,
    contratoEstado,
    cortesiaEstado,
    displayTitle,
    subtitleParts,
    hasAlias: !!aliasGrupo,
    avatarBaseText: colegio || nombreGrupo || nombreApoderado || displayTitle,
    searchIndex: normalizeText([
      id,
      data.idGrupo || id,
      aliasGrupo,
      nombreApoderado,
      nombreGrupo,
      colegio,
      curso,
      destino,
      vendedora,
      vendedoraCorreo,
      anoViaje
    ].join(" "))
  };
}

/* =========================================================
   FILTROS
========================================================= */
function applyFiltersAndRender() {
  const filtroAno = $("filtroAno")?.value || "todos";
  const filtroEstado = $("filtroEstado")?.value || "todos";
  const filtroVendedora = $("filtroVendedora")?.value || "todos";
  const verAnteriores = !!$("toggleAnteriores")?.checked;
  const search = normalizeText($("buscadorSeguimiento")?.value || "");

  const currentVendorFullName = normalizeText([
    state.currentUser?.nombre,
    state.currentUser?.apellido
  ].filter(Boolean).join(" "));

  const rawAliases =
    state.currentUser?.aliasCartera ??
    state.currentUser?.aliascartera ??
    [];
  
  const currentVendorAliases = Array.isArray(rawAliases)
    ? rawAliases.map(normalizeText)
    : (rawAliases ? [normalizeText(rawAliases)] : []);
  
  const currentVendorEmails = getVentasUserEmails(state.currentUser);

  let rows = [...state.allRows];

  // Restricción por rol
  rows = rows.filter((row) => {
    if (state.canSeeAll) return true;

    const rowVendorEmail = normalizeEmail(row.vendedoraCorreo);
    const rowVendorName = normalizeText(row.vendedora);

    if (rowVendorEmail && currentVendorEmails.includes(rowVendorEmail)) return true;

    if (currentVendorFullName && rowVendorName.includes(currentVendorFullName)) return true;

    if (currentVendorAliases.length) {
      return currentVendorAliases.some((alias) => rowVendorName.includes(alias));
    }

    return false;
  });

  // Filtro año
  rows = rows.filter((row) => {
    if (filtroAno !== "todos") {
      return String(row.anoViaje || "") === String(filtroAno);
    }

    if (verAnteriores) return true;
    return !row.anoViaje || row.anoViaje >= CURRENT_YEAR;
  });

  // Filtro estado selector
  rows = rows.filter((row) => {
    if (filtroEstado === "todos") return true;
    return row.estado === filtroEstado;
  });

  // Filtro extra recibido desde dashboard
  rows = rows.filter((row) => {
    const bucket = state.dashboardPreset?.bucket || "";
    if (!bucket) return true;
  
    if (bucket === "a_contactar") {
      return row.estado === "a_contactar";
    }
  
    if (bucket === "contactados") {
      return row.estado === "contactado";
    }
  
    // AUTORIZADAS se filtra por flag, no por estado textual
    if (bucket === "autorizadas") {
      return !!row.autorizada;
    }
  
    // CERRADAS se filtra por flag, no por estado textual
    if (bucket === "cerradas") {
      return !!row.cerrada;
    }
  
    return true;
  });

  // Filtro vendedor selector
  rows = rows.filter((row) => {
    if (!state.canSeeAll) return true;
    if (filtroVendedora === "todos") return true;

    const vendorFilter = normalizeText(filtroVendedora);

    return (
      normalizeEmail(row.vendedoraCorreo) === normalizeEmail(filtroVendedora) ||
      normalizeText(row.vendedora) === vendorFilter
    );
  });

  // Buscador
  rows = rows.filter((row) => {
    if (!search) return true;
    return row.searchIndex.includes(search);
  });

  state.filteredRows = rows;

  // El resumen refleja filtros normales, no los botones toggle
  renderSummary(rows);
  updateSummaryButtonsUI();

  // Aplicar ocultamiento por botones resumen
  rows = rows.filter((row) => {
    const bucket = getSummaryBucket(row.estado);
    return !state.hiddenSummaryStates.has(bucket);
  });

  // Orden final
  rows.sort((a, b) => compareRows(a, b, state.sortKey, state.sortDir));

  state.visibleRows = rows;
  renderRows(rows);
}

/* =========================================================
   RENDER
========================================================= */
function renderRows(rows) {
  const tbody = $("tbodySeguimiento");
  if (!tbody) return;

  if (!rows.length) {
    renderEmpty("No hay grupos para los filtros seleccionados.");
    return;
  }

  tbody.innerHTML = rows.map(renderRow).join("");
}

function renderRow(row) {
  const progressHtml = renderProgress(row.estado);
  const docsHtml = renderDocs(row);
  const avatarHtml = renderAvatar(row);

  const ultimaGestion = formatDateTime(row.ultimaGestionAt, "Sin registro");
  const ultimaReunion = formatDateTime(row.fechaUltimaReunion, "Sin reunión");

  return `
    <td>
      <a
        class="seg-group-link"
        href="grupo.html?id=${encodeURIComponent(row.idGrupo || row.id)}"
        target="_blank"
        rel="noopener noreferrer"
      >
        <div class="seg-avatar">${avatarHtml}</div>
      
          <div class="seg-group-info">
            <div class="seg-group-title">${escapeHtml(row.displayTitle)}</div>
      
            <div class="seg-group-sub">
              ${row.subtitleParts.map((part) => `<span>${escapeHtml(part)}</span>`).join("")}
            </div>
          </div>
        </a>
      </td>

      <td class="td-vendedor">
        ${escapeHtml(row.vendedora || row.vendedoraCorreo || "—")}
      </td>

      <td class="seg-destino">${escapeHtml(row.destino || "Sin destino")}</td>

      <td>${progressHtml}</td>

      <td>
        ${
          row.autorizada
            ? `<span class="seg-badge seg-badge-blue">Autorizada</span>`
            : `<span class="seg-badge seg-badge-muted">—</span>`
        }
      </td>

      <td>
        ${
          row.cerrada
            ? `<span class="seg-badge seg-badge-green-dark">Cerrada</span>`
            : `<span class="seg-badge seg-badge-muted">—</span>`
        }
      </td>

      <td class="seg-date">
        ${escapeHtml(ultimaGestion.main)}
        <small>${escapeHtml(ultimaGestion.sub)}</small>
      </td>

      <td class="seg-date">
        ${escapeHtml(ultimaReunion.main)}
        <small>${escapeHtml(ultimaReunion.sub)}</small>
      </td>

      <td>
        <div class="seg-docs">
          ${docsHtml}
        </div>
      </td>
    </tr>
  `;
}

function renderProgress(estado) {
  const meta = STAGE_META[estado] || STAGE_META.a_contactar;
  const blocks = [];

  for (let i = 1; i <= 5; i++) {
    const fillClass = i <= meta.steps ? meta.fillClass : "";
    blocks.push(`<span class="seg-step ${fillClass}"></span>`);
  }

  return `
    <div class="seg-progress-wrap">
      <div class="seg-progress-bar">${blocks.join("")}</div>
      <div class="seg-progress-label">${escapeHtml(meta.label)}</div>
    </div>
  `;
}

function renderDocs(row) {
  return DOCS_META.map((item) => {
    const value = row[item.key];
    const css = getDocCss(value);
    const label = getDocLabel(value);

    return `
      <span
        class="seg-doc ${css}"
        title="${escapeAttr(item.label)} · ${escapeAttr(label)}"
        aria-label="${escapeAttr(item.label)}"
      >${item.icon}</span>
    `;
  }).join("");
}

function renderAvatar(row) {
  if (row.imagen) {
    return `
      <img
        src="${escapeAttr(row.imagen)}"
        alt="${escapeAttr(row.displayTitle)}"
        onerror="this.parentNode.textContent='${escapeJs(getInitials(row.avatarBaseText || row.displayTitle))}'"
      />
    `;
  }

  return escapeHtml(getInitials(row.avatarBaseText || row.displayTitle));
}

function renderSummary(rows) {
  const totals = {
    total: rows.length,
    a_contactar: 0,
    contactado: 0,
    cotizando: 0,
    reunion_confirmada: 0,
    ganada: 0,
    perdida: 0
  };

  for (const row of rows) {
    const bucket = getSummaryBucket(row.estado);

    if (bucket === "a_contactar") totals.a_contactar++;
    else if (bucket === "contactado") totals.contactado++;
    else if (bucket === "cotizando") totals.cotizando++;
    else if (bucket === "reunion_confirmada") totals.reunion_confirmada++;
    else if (bucket === "ganada") totals.ganada++;
    else if (bucket === "perdida") totals.perdida++;
  }

  setText("sumTotal", totals.total);
  setText("sumAContactar", totals.a_contactar);
  setText("sumContactado", totals.contactado);
  setText("sumCotizando", totals.cotizando);
  setText("sumReunion", totals.reunion_confirmada);
  setText("sumGanadas", totals.ganada);
  setText("sumPerdidas", totals.perdida);
}

function renderEmpty(message) {
  const tbody = $("tbodySeguimiento");
  if (!tbody) return;

  const colspan = document.body.classList.contains("is-vendedor-view") ? 8 : 9;

  tbody.innerHTML = `
    <tr>
      <td colspan="${colspan}" class="seg-empty">${escapeHtml(message)}</td>
    </tr>
  `;
}

/* =========================================================
   EXPORTAR
========================================================= */
function exportVisibleRowsToXlsx() {
  try {
    if (typeof XLSX === "undefined") {
      alert("No se encontró la librería XLSX.");
      return;
    }

    if (!state.visibleRows.length) {
      alert("No hay registros visibles para exportar.");
      return;
    }

    const rowsToExport = state.visibleRows.map((row) => ({
      "GRUPO": row.displayTitle || "",
      "VENDEDOR(A)": row.vendedora || row.vendedoraCorreo || "",
      "COLEGIO": row.colegio || row.nombreGrupo || "",
      "CURSO": row.curso || "",
      "AÑO VIAJE": row.anoViaje || "",
      "DESTINO": row.destino || "",
      "PROGRESO": STAGE_META[row.estado]?.label || row.estado || "",
      "AUTORIZADA": row.autorizada ? "SI" : "NO",
      "CERRADA": row.cerrada ? "SI" : "NO",
      "ÚLT. GESTIÓN": formatDateTimeText(row.ultimaGestionAt),
      "ÚLT. REUNIÓN": formatDateTimeText(row.fechaUltimaReunion),
      "FICHAS MÉDICAS": getDocLabel(row.fichaMedicaEstado),
      "NÓMINA": getDocLabel(row.nominaEstado),
      "FICHA DEL GRUPO": getDocLabel(row.fichaEstado),
      "CONTRATO": getDocLabel(row.contratoEstado),
      "CORTESÍAS": getDocLabel(row.cortesiaEstado)
    }));

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rowsToExport);
    XLSX.utils.book_append_sheet(wb, ws, "Seguimiento");
    XLSX.writeFile(wb, `seguimiento_grupos_${fileStamp()}.xlsx`);
  } catch (error) {
    console.error("[seguimiento] error exportando xlsx:", error);
    alert("No se pudo exportar el XLSX.");
  }
}

function getDashboardQueryPreset() {
  const params = new URLSearchParams(window.location.search);

  return {
    bucket: normalizeText(params.get("dashboardBucket") || ""),
    ano: String(params.get("ano") || "").trim(),
    archivados: params.get("archivados") === "1",
    vendor: normalizeEmail(params.get("vendor") || "")
  };
}

function applyDashboardPreset() {
  const preset = getDashboardQueryPreset();
  state.dashboardPreset = preset;

  const toggleAnteriores = $("toggleAnteriores");
  const filtroAno = $("filtroAno");
  const filtroEstado = $("filtroEstado");
  const filtroVendedora = $("filtroVendedora");

  // Si viene archivados=1 o viene un año menor al actual,
  // activamos archivados para que ese año se pueda mostrar.
  if (
    toggleAnteriores &&
    (preset.archivados || (preset.ano && Number(preset.ano) < CURRENT_YEAR))
  ) {
    toggleAnteriores.checked = true;
  }

  // Rehacer selector de años después de aplicar archivados
  fillYearFilter(state.allRows);

  // Aplicar año
  if (
    preset.ano &&
    filtroAno &&
    [...filtroAno.options].some((opt) => opt.value === preset.ano)
  ) {
    filtroAno.value = preset.ano;
  }

  // Aplicar estado
  const bucketToEstado = {
    a_contactar: "a_contactar",
    contactados: "contactado",
    cotizando: "cotizando",
    recotizando: "recotizando",
    reunion: "reunion_confirmada",
    reunion_confirmada: "reunion_confirmada",
    ganadas: "ganada",
    ganada: "ganada",
    perdidas: "perdida",
    perdida: "perdida"
  };

  if (filtroEstado) {
    filtroEstado.value = bucketToEstado[preset.bucket] || "todos";
  }

  // Aplicar vendedor en el selector visual
  if (preset.vendor && filtroVendedora) {
    const matchingOption = [...filtroVendedora.options].find(
      (opt) => normalizeEmail(opt.value) === preset.vendor
    );

    if (matchingOption) {
      filtroVendedora.value = matchingOption.value;
    }
  }

  // Si vienen desde pérdidas, dejarla visible
  if (preset.bucket === "perdidas" || preset.bucket === "perdida") {
    state.hiddenSummaryStates.delete("perdida");
  }
}

/* =========================================================
   FILTROS AUXILIARES / SORT
========================================================= */
function getSummaryBucket(estado) {
  const normalized = normalizeEstado(estado);
  if (normalized === "recotizando") return "cotizando";
  return normalized;
}

function compareRows(a, b, sortKey, sortDir) {
  let result = 0;

  switch (sortKey) {
    case "grupo":
      result = compareText(a.displayTitle, b.displayTitle);
      break;

    case "vendedora":
      result = compareText(a.vendedora || a.vendedoraCorreo, b.vendedora || b.vendedoraCorreo);
      break;

    case "destino":
      result = compareText(a.destino, b.destino);
      break;

    case "estado":
      result = compareText(STAGE_META[a.estado]?.label || a.estado, STAGE_META[b.estado]?.label || b.estado);
      break;

    case "autorizada":
      result = compareNumber(a.autorizada ? 1 : 0, b.autorizada ? 1 : 0);
      break;

    case "cerrada":
      result = compareNumber(a.cerrada ? 1 : 0, b.cerrada ? 1 : 0);
      break;

    case "ultimaGestion":
      result = compareNumber(
        a.ultimaGestionAt ? a.ultimaGestionAt.getTime() : 0,
        b.ultimaGestionAt ? b.ultimaGestionAt.getTime() : 0
      );
      break;

    case "ultimaReunion":
      result = compareNumber(
        a.fechaUltimaReunion ? a.fechaUltimaReunion.getTime() : 0,
        b.fechaUltimaReunion ? b.fechaUltimaReunion.getTime() : 0
      );
      break;

    case "documentos":
      result = compareText(getDocsSortText(a), getDocsSortText(b));
      break;

    default:
      result = compareText(a.displayTitle, b.displayTitle);
      break;
  }

  return sortDir === "desc" ? -result : result;
}

function compareText(a, b) {
  return String(a || "").localeCompare(String(b || ""), "es", {
    sensitivity: "base",
    numeric: true
  });
}

function compareNumber(a, b) {
  return Number(a || 0) - Number(b || 0);
}

function getDocsSortText(row) {
  return DOCS_META.map((item) => `${item.label}:${getDocLabel(row[item.key])}`).join(" | ");
}

/* =========================================================
   OPCIONES DE FILTROS
========================================================= */
function fillYearFilter(rows) {
  const select = $("filtroAno");
  if (!select) return;

  const previous = select.value || "todos";
  const showOld = !!$("toggleAnteriores")?.checked;

  let years = [...new Set(
    rows
      .map((r) => Number(r.anoViaje || 0))
      .filter(Boolean)
  )].sort((a, b) => a - b);

  if (!showOld) {
    years = years.filter((year) => year >= CURRENT_YEAR);
  }

  select.innerHTML = `
    <option value="todos">Todos</option>
    ${years.map((year) => `<option value="${year}">${year}</option>`).join("")}
  `;

  if ([...select.options].some((opt) => opt.value === previous)) {
    select.value = previous;
  } else {
    select.value = "todos";
  }
}

function fillVendorFilter(rows) {
  const select = $("filtroVendedora");
  if (!select) return;

  if (!state.canSeeAll) {
    select.innerHTML = `<option value="todos">Solo mis grupos</option>`;
    select.disabled = true;
    return;
  }

  const previous = select.value || "todos";
  const vendorMap = new Map();

  for (const row of rows) {
    if (!row.vendedora && !row.vendedoraCorreo) continue;

    const value = row.vendedoraCorreo || row.vendedora;
    const label = row.vendedora || row.vendedoraCorreo;

    if (!vendorMap.has(value)) {
      vendorMap.set(value, { value, label });
    }
  }

  const vendors = [...vendorMap.values()].sort((a, b) =>
    a.label.localeCompare(b.label, "es", { sensitivity: "base" })
  );

  select.disabled = false;
  select.innerHTML = `
    <option value="todos">Todos</option>
    ${vendors.map((v) => `<option value="${escapeAttr(v.value)}">${escapeHtml(v.label)}</option>`).join("")}
  `;

  if ([...select.options].some((opt) => opt.value === previous)) {
    select.value = previous;
  } else {
    select.value = "todos";
  }
}

/* =========================================================
   REGLAS DE NEGOCIO
========================================================= */
function normalizeEstado(value) {
  const v = normalizeText(value);

  if (!v) return "a_contactar";
  if (v.includes("perdid")) return "perdida";
  if (v.includes("reunion confirm") || v.includes("reunión confirm")) return "reunion_confirmada";
  if (v.includes("reunion") && v.includes("confirm")) return "reunion_confirmada";
  if (v.includes("recotiz")) return "recotizando";
  if (v.includes("cotiz")) return "cotizando";
  if (v.includes("contactad")) return "contactado";
  if (v.includes("ganad")) return "ganada";
  if (v.includes("cerrad")) return "ganada";
  if (v.includes("a contactar")) return "a_contactar";
  if (v.includes("contactar")) return "a_contactar";

  return "a_contactar";
}

function resolveAutorizada(data) {
  const raw = data.autorizada ?? data.autorizacion ?? data.estadoAutorizacion ?? null;

  if (typeof raw === "boolean") return raw;
  if (Array.isArray(raw)) return raw.some((v) => normalizeText(v).includes("autoriz"));
  if (typeof raw === "string") {
    const v = normalizeText(raw);
    return v.includes("autoriz") || v === "si" || v === "sí" || v === "true";
  }

  return false;
}

function resolveCerrada(data) {
  const raw = data.cerrada ?? data.cierre ?? data.estadoCierre ?? null;

  if (typeof raw === "boolean") return raw;
  if (Array.isArray(raw)) return raw.some((v) => normalizeText(v).includes("cerrad"));
  if (typeof raw === "string") {
    const v = normalizeText(raw);
    return v.includes("cerrad") || v === "si" || v === "sí" || v === "true";
  }

  return false;
}

function normalizeDocState(value) {
  if (typeof value === "boolean") {
    return value ? "ok" : "pendiente";
  }

  const v = normalizeText(value);

  if (!v) return "pendiente";
  if (v.includes("no aplica") || v === "na" || v === "n/a") return "no_aplica";
  if (v.includes("ok") || v.includes("completo") || v.includes("cumpl") || v.includes("entreg")) return "ok";
  if (v.includes("pend")) return "pendiente";

  return "pendiente";
}

function getDocCss(value) {
  if (value === "ok") return "seg-doc-ok";
  if (value === "pendiente") return "seg-doc-pendiente";
  if (value === "no_aplica") return "seg-doc-no-aplica";
  return "seg-doc-default";
}

function getDocLabel(value) {
  if (value === "ok") return "Cumplido";
  if (value === "pendiente") return "Pendiente";
  if (value === "no_aplica") return "No aplica";
  return "Sin definir";
}

/* =========================================================
   HELPERS
========================================================= */
function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function toDate(value) {
  if (!value) return null;

  if (value instanceof Date && !isNaN(value)) return value;

  if (typeof value?.toDate === "function") {
    const d = value.toDate();
    return isNaN(d) ? null : d;
  }

  if (typeof value === "number") {
    const d = new Date(value);
    return isNaN(d) ? null : d;
  }

  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!isNaN(parsed)) return parsed;

    const match = value.match(/^(\d{2})[-/](\d{2})[-/](\d{2,4})(?:\s+(\d{2}):(\d{2}))?$/);
    if (match) {
      const dd = Number(match[1]);
      const mm = Number(match[2]) - 1;
      let yy = Number(match[3]);
      if (yy < 100) yy += 2000;
      const hh = Number(match[4] || 0);
      const mi = Number(match[5] || 0);
      const d = new Date(yy, mm, dd, hh, mi);
      return isNaN(d) ? null : d;
    }
  }

  return null;
}

function formatDateTime(date, emptySub = "Sin registro") {
  if (!date) {
    return {
      main: "—",
      sub: emptySub
    };
  }

  return {
    main: date.toLocaleDateString("es-CL"),
    sub: date.toLocaleTimeString("es-CL", {
      hour: "2-digit",
      minute: "2-digit"
    })
  };
}

function formatDateTimeText(date) {
  if (!date) return "";
  return `${date.toLocaleDateString("es-CL")} ${date.toLocaleTimeString("es-CL", {
    hour: "2-digit",
    minute: "2-digit"
  })}`;
}

function getInitials(text) {
  const parts = String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!parts.length) return "G";
  return parts.slice(0, 2).map((p) => p[0]?.toUpperCase() || "").join("");
}

function setText(id, value) {
  const el = $(id);
  if (el) el.textContent = String(value ?? "");
}

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttr(str) {
  return escapeHtml(str);
}

function escapeJs(str) {
  return String(str ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'");
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
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}${mm}${dd}_${hh}${mi}`;
}
