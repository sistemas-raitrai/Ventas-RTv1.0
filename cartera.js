import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.7.3/firebase-auth.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  writeBatch,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";

import {
  getStorage,
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
  deleteObject
} from "https://www.gstatic.com/firebasejs/11.7.3/firebase-storage.js";

import { auth, db, VENTAS_USERS } from "./firebase-init.js";

import {
  $,
  normalizeEmail,
  normalizeText,
  normalizeSearch,
  escapeHtml,
  getNombreUsuario,
  formatNowForFile
} from "./utils.js";

import {
  ACTING_USER_KEY,
  getRealUser,
  getEffectiveUser,
  isActingAsAnother,
  getVendorUsers,
  canManageVentasRole,
  canObserveOnlyRole,
  isVendedorRole
} from "./roles.js";

import {
  setHeaderState,
  renderActingUserSwitcher,
  bindLayoutButtons,
  setProgressStatus,
  clearProgressStatus,
  waitForLayoutReady
} from "./ui.js";

/* =========================================================
   CONFIG
========================================================= */
const GITHUB_HOME_URL = "https://sistemas-raitrai.github.io/Ventas-RT/";
const WRITE_BATCH_LIMIT = 400;
const storage = getStorage();

/* =========================================================
   ESTADO
========================================================= */
const state = {
  realUser: null,
  effectiveUser: null,
  rows: [],
  filteredRows: [],
  pageRows: [],
  vendorFilter: "",
  statusFilter: "ok",
  search: "",
  modalMode: "create",
  editingOriginal: null,
  vendors: [],
  selectedKeys: new Set(),
  pendingLogoFile: null,
  removeCurrentLogo: false,
  logoPreviewObjectUrl: "",
  pageSize: 8,
  currentPage: 1,
  sort: {
    key: "numeroColegio",
    dir: "asc"
  }
};

/* =========================================================
   HELPERS
========================================================= */
function getRoleHintText() {
  if (canManageVentasRole(state.effectiveUser)) return "Modo gestión";
  if (canObserveOnlyRole(state.effectiveUser)) return "Modo observador";
  return "Vista del vendedor(a)";
}

function getVendorNameByEmail(email = "") {
  const seller = state.vendors.find(v => normalizeEmail(v.email) === normalizeEmail(email));
  return seller ? `${seller.nombre} ${seller.apellido}`.trim() : email;
}

function getAliasList(user) {
  // Soporta ambas variantes:
  // - aliascartera  (como está hoy en firebase-init.js)
  // - aliasCartera  (por si después normalizas el nombre)
  const raw = user?.aliascartera ?? user?.aliasCartera;

  if (Array.isArray(raw)) {
    return raw.map(a => normalizeSearch(a)).filter(Boolean);
  }

  if (typeof raw === "string") {
    return [normalizeSearch(raw)].filter(Boolean);
  }

  return [];
}

function findVendorByAlias(alias = "") {
  const target = normalizeSearch(alias);
  if (!target) return null;

  for (const vendor of state.vendors) {
    const aliases = getAliasList(vendor);
    if (aliases.includes(target)) return vendor;
  }

  for (const vendor of state.vendors) {
    const fullName = normalizeSearch(`${vendor.nombre} ${vendor.apellido}`.trim());
    const firstName = normalizeSearch(vendor.nombre);
    if (target === fullName || target === firstName) return vendor;
  }

  return null;
}

function buildScopeText() {
  if (!state.effectiveUser) {
    return "Cartera · Cargando usuario...";
  }

  let texto = "Cartera · Vista general";

  if (isVendedorRole(state.effectiveUser)) {
    texto = `Cartera · Vista personal de ${getNombreUsuario(state.effectiveUser)}`;
  } else if (canObserveOnlyRole(state.effectiveUser)) {
    texto = "Cartera · Observador";
  } else {
    texto = `Cartera · ${state.effectiveUser.rol || "sin rol"}`;
  }

  if (state.vendorFilter && !isVendedorRole(state.effectiveUser)) {
    texto += ` · Filtrada por ${getVendorNameByEmail(state.vendorFilter)}`;
  }

  if (state.realUser && isActingAsAnother(state.realUser, state.effectiveUser)) {
    return `Navegando como ${getNombreUsuario(state.effectiveUser)} · ${state.effectiveUser.rol || "sin rol"} · ${texto}`;
  }

  return texto;
}

function mapDocToRow(docId, data) {
  return {
    numeroColegio: normalizeText(data.numeroColegio || docId),
    colegio: normalizeText(data.colegio),
    nombreVendedor: normalizeText(data.nombreVendedor),
    apellidoVendedor: normalizeText(data.apellidoVendedor),
    correoVendedor: normalizeEmail(data.correoVendedor),
    comuna: normalizeText(data.comuna),
    ciudad: normalizeText(data.ciudad),
    estatus: normalizeText(data.estatus),
    observaciones: normalizeText(data.observaciones),

    // Compatibilidad:
    // seguimos usando logoUrl/logoPath en la vista actual de cartera,
    // pero además exponemos logoColegioUrl/logoColegioPath.
    logoUrl: String(data.logoColegioUrl || data.logoUrl || "").trim(),
    logoPath: String(data.logoColegioPath || data.logoPath || "").trim(),
    logoColegioUrl: String(data.logoColegioUrl || data.logoUrl || "").trim(),
    logoColegioPath: String(data.logoColegioPath || data.logoPath || "").trim()
  };
}

function buildItemPayload(input, existing = null) {
  const nextLogoUrl =
    input.logoUrl !== undefined && input.logoUrl !== null
      ? String(input.logoUrl).trim()
      : String(input.logoColegioUrl ?? existing?.logoUrl ?? existing?.logoColegioUrl ?? "").trim();

  const nextLogoPath =
    input.logoPath !== undefined && input.logoPath !== null
      ? String(input.logoPath).trim()
      : String(input.logoColegioPath ?? existing?.logoPath ?? existing?.logoColegioPath ?? "").trim();

  return {
    numeroColegio: normalizeText(input.numeroColegio),
    colegio: normalizeText(input.colegio),
    colegioNormalizado: normalizeSearch(input.colegio),
    nombreVendedor: normalizeText(input.nombreVendedor),
    apellidoVendedor: normalizeText(input.apellidoVendedor),
    correoVendedor: normalizeEmail(input.correoVendedor),
    comuna: normalizeText(input.comuna),
    ciudad: normalizeText(
      input.ciudad !== undefined && input.ciudad !== null && input.ciudad !== ""
        ? input.ciudad
        : existing?.ciudad || ""
    ),
    estatus: normalizeText(input.estatus),
    observaciones: normalizeText(
      input.observaciones !== undefined && input.observaciones !== null && input.observaciones !== ""
        ? input.observaciones
        : existing?.observaciones || ""
    ),

    // Se guardan ambos nombres en paralelo
    logoUrl: nextLogoUrl,
    logoPath: nextLogoPath,
    logoColegioUrl:
      input.logoColegioUrl !== undefined && input.logoColegioUrl !== null
        ? String(input.logoColegioUrl).trim()
        : nextLogoUrl,
    logoColegioPath:
      input.logoColegioPath !== undefined && input.logoColegioPath !== null
        ? String(input.logoColegioPath).trim()
        : nextLogoPath,

    actualizadoPor: normalizeEmail(state.realUser?.email || ""),
    fechaActualizacion: serverTimestamp()
  };
}

function buildParentVendorPayload(vendor) {
  return {
    correoVendedor: normalizeEmail(vendor.email || vendor.correoVendedor),
    nombreVendedor: normalizeText(vendor.nombre || vendor.nombreVendedor),
    apellidoVendedor: normalizeText(vendor.apellido || vendor.apellidoVendedor),
    actualizadoPor: normalizeEmail(state.realUser?.email || ""),
    fechaActualizacion: serverTimestamp()
  };
}

function slugStoragePart(value = "") {
  return String(value || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "") || "sin_valor";
}

function revokeLogoPreviewObjectUrl() {
  if (state.logoPreviewObjectUrl) {
    try {
      URL.revokeObjectURL(state.logoPreviewObjectUrl);
    } catch {}
    state.logoPreviewObjectUrl = "";
  }
}

function setLogoPreview(url = "") {
  const img = $("logoPreviewImg");
  const empty = $("logoPreviewEmpty");

  if (!img || !empty) return;

  if (url) {
    img.src = url;
    img.classList.remove("hidden");
    empty.classList.add("hidden");
  } else {
    img.removeAttribute("src");
    img.classList.add("hidden");
    empty.classList.remove("hidden");
  }
}

function refreshLogoPreview() {
  const removeWrap = $("quitarLogoWrap");
  const hasExistingLogo = !!state.editingOriginal?.logoUrl;

  if (removeWrap) {
    removeWrap.classList.toggle("hidden", !hasExistingLogo);
  }

  revokeLogoPreviewObjectUrl();

  if (state.pendingLogoFile) {
    state.logoPreviewObjectUrl = URL.createObjectURL(state.pendingLogoFile);
    setLogoPreview(state.logoPreviewObjectUrl);
    return;
  }

  if (hasExistingLogo && !state.removeCurrentLogo) {
    setLogoPreview(state.editingOriginal.logoUrl);
    return;
  }

  setLogoPreview("");
}

function resetLogoModalState() {
  state.pendingLogoFile = null;
  state.removeCurrentLogo = false;

  if ($("logoInput")) $("logoInput").value = "";
  if ($("quitarLogoCheck")) $("quitarLogoCheck").checked = false;

  refreshLogoPreview();
}

async function uploadSchoolLogo(file, input) {
  const ext =
    (file?.name || "").includes(".")
      ? file.name.split(".").pop().toLowerCase().replace(/[^a-z0-9]/g, "")
      : "bin";

  const sellerPart = slugStoragePart(input.correoVendedor);
  const schoolPart = slugStoragePart(input.numeroColegio);
  const path = `ventas_cartera_logos/${sellerPart}/${schoolPart}_${Date.now()}.${ext || "bin"}`;

  const fileRef = storageRef(storage, path);

  await uploadBytes(fileRef, file, {
    contentType: file.type || "application/octet-stream"
  });

  const url = await getDownloadURL(fileRef);

  return {
    logoPath: path,
    logoUrl: url
  };
}

async function deleteLogoFromStorage(path = "") {
  if (!path) return;

  try {
    await deleteObject(storageRef(storage, path));
  } catch (error) {
    if (error?.code !== "storage/object-not-found") {
      console.warn("No se pudo eliminar logo antiguo:", error);
    }
  }
}

/* =========================================================
   HEADER / LAYOUT
========================================================= */
function renderHeaderState() {
  const pageScope = $("carteraScope");

  if (!state.effectiveUser) {
    setHeaderState({
      realUser: state.realUser,
      effectiveUser: null,
      scopeText: "Cartera · Cargando usuario..."
    });

    renderActingUserSwitcher({
      realUser: state.realUser,
      effectiveUser: null,
      users: VENTAS_USERS
    });

    if (pageScope) {
      pageScope.textContent = "Cargando permisos de usuario...";
    }

    return;
  }

  setHeaderState({
    realUser: state.realUser,
    effectiveUser: state.effectiveUser,
    scopeText: buildScopeText()
  });

  renderActingUserSwitcher({
    realUser: state.realUser,
    effectiveUser: state.effectiveUser,
    users: VENTAS_USERS
  });

  if (pageScope) {
    if (canManageVentasRole(state.effectiveUser)) {
      pageScope.textContent = "Administra la cartera de colegios/clientes por vendedor(a).";
    } else if (canObserveOnlyRole(state.effectiveUser)) {
      pageScope.textContent = "Vista observador de la cartera.";
    } else {
      pageScope.textContent = "Vista personal de la cartera asignada al vendedor(a).";
    }
  }
}

function bindHeaderActions() {
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
      await loadData();
    },
    onResetActAs: async () => {
      sessionStorage.removeItem(ACTING_USER_KEY);
      await bootstrapFromSession();
      await loadData();
    }
  });
}

/* =========================================================
   UI LOCAL
========================================================= */
function renderRoleButtons() {
  const allowManage = state.effectiveUser ? canManageVentasRole(state.effectiveUser) : false;
  const importLabel = $("labelImportar");
  const addBtn = $("btnAgregar");
  const deleteSelectedBtn = $("btnEliminarSeleccionados");

  if (importLabel) importLabel.classList.toggle("hidden", !allowManage);
  if (addBtn) addBtn.classList.toggle("hidden", !allowManage);
  if (deleteSelectedBtn) {
    deleteSelectedBtn.classList.toggle("hidden", !allowManage);
    deleteSelectedBtn.disabled = !allowManage || state.selectedKeys.size === 0;
  }
}

function renderVendorFilter() {
  const wrap = $("vendorFilterWrap");
  const select = $("vendorFilter");
  if (!wrap || !select || !state.effectiveUser) return;

  if (isVendedorRole(state.effectiveUser)) {
    wrap.classList.add("hidden");
    return;
  }

  wrap.classList.remove("hidden");
  select.innerHTML = `<option value="">Todos</option>`;

  state.vendors.forEach((vendor) => {
    const opt = document.createElement("option");
    opt.value = normalizeEmail(vendor.email);
    opt.textContent = `${vendor.nombre} ${vendor.apellido}`.trim();
    select.appendChild(opt);
  });

  select.value = state.vendorFilter || "";
}

function getSearchTarget(row) {
  return normalizeSearch([
    row.numeroColegio,
    row.nombreVendedor,
    row.apellidoVendedor,
    row.colegio,
    row.comuna,
    row.ciudad,
    row.estatus,
    row.observaciones
  ].join(" "));
}

const SORTABLE_COLUMNS = [
  "numeroColegio",
  "vendedor",
  "colegio",
  "comuna",
  "estatus",
  "observaciones"
];

const COLUMN_LABELS = {
  numeroColegio: "N° Colegio",
  vendedor: "Vendedor(a)",
  colegio: "Colegio",
  comuna: "Comuna",
  estatus: "Estatus",
  observaciones: "Observaciones"
};

function getColumnLabel(key = "") {
  return COLUMN_LABELS[key] || key;
}

function getCellValue(row, key) {
  if (key === "vendedor") {
    return normalizeText(`${row.nombreVendedor || ""} ${row.apellidoVendedor || ""}`.trim());
  }
  return normalizeText(row?.[key] ?? "");
}

function getSortValue(row, key) {
  const raw = getCellValue(row, key).trim();

  if (!raw) {
    return { empty: true, num: null, text: "" };
  }

  if (key === "numeroColegio") {
    const onlyNum = String(raw).replace(/[^\d.-]/g, "");
    const num = Number(onlyNum);
    if (Number.isFinite(num)) {
      return { empty: false, num, text: raw };
    }
  }

  if (/^-?\d+(?:[.,]\d+)?$/.test(raw)) {
    const num = Number(raw.replace(",", "."));
    if (Number.isFinite(num)) {
      return { empty: false, num, text: raw };
    }
  }

  return {
    empty: false,
    num: null,
    text: normalizeText(raw).toLocaleLowerCase("es-CL")
  };
}

function getSortedRows(rows = []) {
  const sortKey = state.sort.key || "numeroColegio";
  const dir = state.sort.dir === "desc" ? -1 : 1;

  return [...rows].sort((a, b) => {
    const av = getSortValue(a, sortKey);
    const bv = getSortValue(b, sortKey);

    if (av.empty && bv.empty) return 0;
    if (av.empty) return 1;
    if (bv.empty) return -1;

    if (av.num !== null && bv.num !== null && av.num !== bv.num) {
      return (av.num - bv.num) * dir;
    }

    const cmp = av.text.localeCompare(bv.text, "es", {
      numeric: true,
      sensitivity: "base"
    });

    if (cmp !== 0) return cmp * dir;

    return String(a.numeroColegio || "").localeCompare(
      String(b.numeroColegio || ""),
      "es",
      { numeric: true, sensitivity: "base" }
    );
  });
}

function getPaginationData(rows = []) {
  const sortedRows = getSortedRows(rows);

  if (state.pageSize === "all") {
    state.currentPage = 1;
    return {
      sortedRows,
      pageRows: sortedRows,
      totalPages: sortedRows.length ? 1 : 1
    };
  }

  const pageSize = Number(state.pageSize) || 8;
  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize));

  if (state.currentPage < 1) state.currentPage = 1;
  if (state.currentPage > totalPages) state.currentPage = totalPages;

  const start = (state.currentPage - 1) * pageSize;
  const pageRows = sortedRows.slice(start, start + pageSize);

  return {
    sortedRows,
    pageRows,
    totalPages
  };
}

function renderPaginationControls(totalFiltered, totalPages) {
  const pageSizeSelect = $("pageSizeSelect");
  const btnPrevPage = $("btnPrevPage");
  const btnNextPage = $("btnNextPage");
  const pageIndicator = $("pageIndicator");

  if (pageSizeSelect) {
    pageSizeSelect.value = String(state.pageSize);
  }

  const showingAll = state.pageSize === "all";

  if (pageIndicator) {
    if (!totalFiltered) {
      pageIndicator.textContent = "Página 0 de 0";
    } else if (showingAll) {
      pageIndicator.textContent = `Todos (${totalFiltered})`;
    } else {
      pageIndicator.textContent = `Página ${state.currentPage} de ${totalPages}`;
    }
  }

  if (btnPrevPage) {
    btnPrevPage.disabled = !totalFiltered || showingAll || state.currentPage <= 1;
  }

  if (btnNextPage) {
    btnNextPage.disabled = !totalFiltered || showingAll || state.currentPage >= totalPages;
  }
}

function renderSortButton(key) {
  const isActive = state.sort.key === key;
  const arrow = isActive
    ? (state.sort.dir === "asc" ? "↑" : "↓")
    : "↕";

  return `
    <button
      class="th-sort ${isActive ? "active" : ""}"
      type="button"
      data-action="sort"
      data-key="${escapeHtml(key)}"
    >
      <span>${escapeHtml(getColumnLabel(key))}</span>
      <span class="sort-arrow" aria-hidden="true">${arrow}</span>
    </button>
  `;
}

function applyFilters() {
  let rows = [...state.rows];

  if (state.vendorFilter) {
    rows = rows.filter(r => normalizeEmail(r.correoVendedor) === normalizeEmail(state.vendorFilter));
  }

  if (state.statusFilter === "ok") {
    rows = rows.filter(r => normalizeText(r.estatus) === "OK");
  } else if (state.statusFilter === "pending") {
    rows = rows.filter(r => normalizeText(r.estatus) !== "OK");
  }
  // "all" no filtra por estatus

  const q = normalizeSearch(state.search);
  if (q) {
    rows = rows.filter(r => getSearchTarget(r).includes(q));
  }

  state.filteredRows = rows;
  state.currentPage = 1;
  renderTable();
  renderHeaderState();
}

function renderTable() {
  const thead = document.querySelector(".cartera-table thead");
  const tbody = $("tbodyCartera");
  const empty = $("emptyState");
  const summary = $("tableSummary");

  if (!thead || !tbody || !empty || !summary) return;

  const allowManage = canManageVentasRole(state.effectiveUser);
  const { sortedRows, pageRows, totalPages } = getPaginationData(state.filteredRows);
  state.pageRows = pageRows;

  summary.textContent = `${pageRows.length} registro(s) mostrados · ${sortedRows.length} filtrados · ${state.rows.length} total`;

  thead.innerHTML = `
    <tr>
      ${allowManage ? `
        <th class="check-col check-head">
          <input id="checkAllRows" type="checkbox" />
        </th>
      ` : ""}
      <th>${renderSortButton("numeroColegio")}</th>
      <th>${renderSortButton("vendedor")}</th>
      <th class="logo-col logo-head">Logo</th>
      <th>${renderSortButton("colegio")}</th>
      <th>${renderSortButton("comuna")}</th>
      <th>${renderSortButton("estatus")}</th>
      <th>${renderSortButton("observaciones")}</th>
      <th class="actions-col actions-head">Acciones</th>
    </tr>
  `;

  renderPaginationControls(sortedRows.length, totalPages);

  if (!sortedRows.length) {
    tbody.innerHTML = "";
    empty.classList.remove("hidden");

    const checkAll = $("checkAllRows");
    if (checkAll) {
      checkAll.checked = false;
      checkAll.indeterminate = false;
    }

    renderRoleButtons();
    return;
  }

  empty.classList.add("hidden");

  tbody.innerHTML = pageRows.map((row) => {
    const sellerName = `${row.nombreVendedor} ${row.apellidoVendedor}`.trim();
    const rowKey = `${normalizeEmail(row.correoVendedor)}__${String(row.numeroColegio)}`;
    const checked = state.selectedKeys.has(rowKey) ? "checked" : "";

    const actions = allowManage
      ? `
        <div class="table-actions">
          <button class="btn-mini edit" data-action="edit" data-id="${escapeHtml(row.numeroColegio)}" data-email="${escapeHtml(row.correoVendedor)}">Editar</button>
          <button class="btn-mini delete" data-action="delete" data-id="${escapeHtml(row.numeroColegio)}" data-email="${escapeHtml(row.correoVendedor)}">Eliminar</button>
        </div>
      `
      : `
        <div class="table-actions">
          <button class="btn-mini view" type="button" disabled>Observador</button>
        </div>
      `;

    const logoHtml = row.logoUrl
      ? `<img class="school-logo-thumb" src="${escapeHtml(row.logoUrl)}" alt="Logo ${escapeHtml(row.colegio || row.numeroColegio)}" loading="lazy" />`
      : `<div class="school-logo-empty">—</div>`;

    return `
      <tr>
        ${allowManage ? `
          <td class="check-col">
            <input
              class="row-check"
              type="checkbox"
              data-action="toggle-row"
              data-key="${escapeHtml(rowKey)}"
              ${checked}
            />
          </td>
        ` : ""}
        <td>${escapeHtml(row.numeroColegio)}</td>
        <td>${escapeHtml(sellerName)}</td>
        <td class="logo-col">${logoHtml}</td>
        <td>${escapeHtml(row.colegio)}</td>
        <td>${escapeHtml(row.comuna)}</td>
        <td>${escapeHtml(row.estatus)}</td>
        <td>${escapeHtml(row.observaciones)}</td>
        <td class="actions-col">${actions}</td>
      </tr>
    `;
  }).join("");

  const checkAll = $("checkAllRows");
  if (checkAll) {
    const visibleKeys = pageRows.map(
      row => `${normalizeEmail(row.correoVendedor)}__${String(row.numeroColegio)}`
    );
    const selectedVisible = visibleKeys.filter(key => state.selectedKeys.has(key)).length;

    checkAll.checked = visibleKeys.length > 0 && selectedVisible === visibleKeys.length;
    checkAll.indeterminate = selectedVisible > 0 && selectedVisible < visibleKeys.length;
  }

  renderRoleButtons();
}

/* =========================================================
   FIRESTORE
========================================================= */
async function loadVendorItems(email) {
  const sellerEmail = normalizeEmail(email);

  setProgressStatus({
    text: "Cargando cartera...",
    meta: `Vendedor(a): ${sellerEmail}`,
    progress: 10
  });

  const snap = await getDocs(collection(db, "ventas_cartera", sellerEmail, "items"));
  const rows = snap.docs.map(d => mapDocToRow(d.id, d.data()));

  setProgressStatus({
    text: "Cartera cargada.",
    meta: `${rows.length} registro(s) encontrados`,
    progress: 100,
    type: "success"
  });
  clearProgressStatus();

  return rows;
}

async function loadAllItems() {
  setProgressStatus({
    text: "Cargando cartera...",
    meta: "Leyendo vendedores...",
    progress: 5
  });

  const sellersSnap = await getDocs(collection(db, "ventas_cartera"));
  const sellerDocs = sellersSnap.docs;

  if (!sellerDocs.length) {
    setProgressStatus({
      text: "Cartera cargada.",
      meta: "No hay vendedores con registros todavía.",
      progress: 100,
      type: "success"
    });
    clearProgressStatus();
    return [];
  }

  const rows = [];
  let processed = 0;

  for (const sellerDoc of sellerDocs) {
    const sellerEmail = sellerDoc.id;
    const itemsSnap = await getDocs(collection(db, "ventas_cartera", sellerEmail, "items"));
    itemsSnap.docs.forEach(d => rows.push(mapDocToRow(d.id, d.data())));

    processed += 1;
    const pct = 5 + Math.round((processed / sellerDocs.length) * 85);

    setProgressStatus({
      text: "Cargando cartera...",
      meta: `Vendedores procesados: ${processed}/${sellerDocs.length}`,
      progress: pct
    });
  }

  setProgressStatus({
    text: "Cartera cargada.",
    meta: `${rows.length} registro(s) encontrados`,
    progress: 100,
    type: "success"
  });
  clearProgressStatus();

  return rows;
}

async function loadData() {
  try {
    if (isVendedorRole(state.effectiveUser)) {
      state.vendorFilter = normalizeEmail(state.effectiveUser.email);
      state.rows = await loadVendorItems(state.effectiveUser.email);
    } else {
      state.rows = await loadAllItems();
    }

    renderRoleButtons();
    renderVendorFilter();
    applyFilters();
  } catch (error) {
    console.error(error);
    setProgressStatus({
      text: "Error cargando cartera.",
      meta: error.message || "No se pudo leer Firestore.",
      progress: 100,
      type: "error"
    });
  }
}

/* =========================================================
   MODAL
========================================================= */
function fillVendorSelectModal(selectedEmail = "") {
  const select = $("vendedorSelectModal");
  if (!select) return;

  select.innerHTML = `<option value="">Seleccionar vendedor(a)</option>`;

  state.vendors.forEach((vendor) => {
    const opt = document.createElement("option");
    opt.value = normalizeEmail(vendor.email);
    opt.textContent = `${vendor.nombre} ${vendor.apellido}`.trim();
    if (normalizeEmail(vendor.email) === normalizeEmail(selectedEmail)) {
      opt.selected = true;
    }
    select.appendChild(opt);
  });

  updateVendorPreview();
}

function updateVendorPreview() {
  const select = $("vendedorSelectModal");
  const vendor = state.vendors.find(
    v => normalizeEmail(v.email) === normalizeEmail(select?.value || "")
  );

  $("nombrePreview").textContent = vendor?.nombre || "—";
  $("apellidoPreview").textContent = vendor?.apellido || "—";
  $("correoPreview").textContent = vendor?.email || "—";
}

function openCreateModal() {
  state.modalMode = "create";
  state.editingOriginal = null;

  $("modalTitle").textContent = "Agregar colegio";
  $("numeroColegioInput").value = "";
  $("colegioInput").value = "";
  $("comunaInput").value = "";
  $("ciudadInput").value = "";
  $("estatusInput").value = "";
  $("observacionesInput").value = "";

  fillVendorSelectModal("");
  resetLogoModalState();
  $("modalForm").classList.add("show");
}

function openEditModal(row) {
  state.modalMode = "edit";
  state.editingOriginal = { ...row };

  $("modalTitle").textContent = "Editar colegio";
  $("numeroColegioInput").value = row.numeroColegio || "";
  $("colegioInput").value = row.colegio || "";
  $("comunaInput").value = row.comuna || "";
  $("ciudadInput").value = row.ciudad || "";
  $("estatusInput").value = row.estatus || "";
  $("observacionesInput").value = row.observaciones || "";

  fillVendorSelectModal(row.correoVendedor || "");
  resetLogoModalState();
  refreshLogoPreview();
  $("modalForm").classList.add("show");
}

function closeModal() {
  revokeLogoPreviewObjectUrl();
  state.pendingLogoFile = null;
  state.removeCurrentLogo = false;
  $("modalForm").classList.remove("show");
}

function readModalInput() {
  const sellerEmail = normalizeEmail($("vendedorSelectModal")?.value || "");
  const vendor = state.vendors.find(v => normalizeEmail(v.email) === sellerEmail);

  return {
    numeroColegio: normalizeText($("numeroColegioInput")?.value || ""),
    colegio: normalizeText($("colegioInput")?.value || ""),
    comuna: normalizeText($("comunaInput")?.value || ""),
    ciudad: normalizeText($("ciudadInput")?.value || ""),
    estatus: normalizeText($("estatusInput")?.value || ""),
    observaciones: normalizeText($("observacionesInput")?.value || ""),
    correoVendedor: sellerEmail,
    nombreVendedor: vendor?.nombre || "",
    apellidoVendedor: vendor?.apellido || ""
  };
}

function validateRowInput(input) {
  if (!input.numeroColegio) return "Debes indicar el N° Colegio.";
  if (!input.colegio) return "Debes indicar el nombre del colegio.";
  if (!input.correoVendedor) return "Debes seleccionar un vendedor(a).";
  if (!input.nombreVendedor) return "No se pudo determinar el nombre del vendedor(a).";
  return "";
}

async function saveModal() {
  if (!canManageVentasRole(state.effectiveUser)) return;

  const input = readModalInput();
  const validation = validateRowInput(input);
  if (validation) {
    alert(validation);
    return;
  }

  const newItemRef = doc(db, "ventas_cartera", input.correoVendedor, "items", input.numeroColegio);
  const newParentRef = doc(db, "ventas_cartera", input.correoVendedor);

  try {
    setProgressStatus({
      text: "Guardando registro...",
      meta: state.modalMode === "create" ? "Creando colegio..." : "Actualizando colegio...",
      progress: 20
    });

    let oldLogoPathToDelete = "";

    if (state.modalMode === "create") {
      const exists = await getDoc(newItemRef);
      if (exists.exists()) {
        alert("Ya existe un colegio con ese N° dentro de la cartera de ese vendedor(a).");
        return;
      }

      let logoData = { logoUrl: "", logoPath: "" };

      if (state.pendingLogoFile) {
        setProgressStatus({
          text: "Guardando registro...",
          meta: "Subiendo logo...",
          progress: 45
        });

        logoData = await uploadSchoolLogo(state.pendingLogoFile, input);
      }

      await setDoc(newParentRef, buildParentVendorPayload(input), { merge: true });
      await setDoc(newItemRef, {
        ...buildItemPayload({ ...input, ...logoData }),
        creadoPor: normalizeEmail(state.realUser?.email || ""),
        fechaCreacion: serverTimestamp()
      }, { merge: true });

      setProgressStatus({
        text: "Registro guardado.",
        meta: "Colegio agregado correctamente.",
        progress: 100,
        type: "success"
      });
    } else {
      const old = state.editingOriginal;
      const oldItemRef = doc(db, "ventas_cartera", old.correoVendedor, "items", old.numeroColegio);

      const samePath =
        normalizeEmail(old.correoVendedor) === normalizeEmail(input.correoVendedor) &&
        normalizeText(old.numeroColegio) === normalizeText(input.numeroColegio);

      if (samePath) {
        const existingSnap = await getDoc(newItemRef);
        const existingData = existingSnap.exists() ? existingSnap.data() : null;

        let logoUrl = String(existingData?.logoUrl || "").trim();
        let logoPath = String(existingData?.logoPath || "").trim();

        if (state.removeCurrentLogo) {
          oldLogoPathToDelete = logoPath || "";
          logoUrl = "";
          logoPath = "";
        }

        if (state.pendingLogoFile) {
          setProgressStatus({
            text: "Guardando registro...",
            meta: "Subiendo nuevo logo...",
            progress: 50
          });

          const uploadedLogo = await uploadSchoolLogo(state.pendingLogoFile, input);
          oldLogoPathToDelete = logoPath || "";
          logoUrl = uploadedLogo.logoUrl;
          logoPath = uploadedLogo.logoPath;
        }

        await setDoc(newParentRef, buildParentVendorPayload(input), { merge: true });
        await setDoc(newItemRef, {
          ...buildItemPayload({ ...input, logoUrl, logoPath }, existingData)
        }, { merge: true });

        if (oldLogoPathToDelete && oldLogoPathToDelete !== logoPath) {
          await deleteLogoFromStorage(oldLogoPathToDelete);
        }
      } else {
        const targetExists = await getDoc(newItemRef);
        if (targetExists.exists()) {
          alert("Ya existe un colegio con ese N° en la cartera destino.");
          return;
        }

        const oldSnap = await getDoc(oldItemRef);
        const oldData = oldSnap.exists() ? oldSnap.data() : null;

        let logoUrl = String(oldData?.logoUrl || "").trim();
        let logoPath = String(oldData?.logoPath || "").trim();

        if (state.removeCurrentLogo) {
          oldLogoPathToDelete = logoPath || "";
          logoUrl = "";
          logoPath = "";
        }

        if (state.pendingLogoFile) {
          setProgressStatus({
            text: "Guardando registro...",
            meta: "Subiendo nuevo logo...",
            progress: 50
          });

          const uploadedLogo = await uploadSchoolLogo(state.pendingLogoFile, input);
          oldLogoPathToDelete = logoPath || "";
          logoUrl = uploadedLogo.logoUrl;
          logoPath = uploadedLogo.logoPath;
        }

        const batch = writeBatch(db);
        batch.set(newParentRef, buildParentVendorPayload(input), { merge: true });
        batch.set(newItemRef, {
          ...buildItemPayload({ ...input, logoUrl, logoPath }, oldData),
          creadoPor: oldData?.creadoPor || normalizeEmail(state.realUser?.email || ""),
          fechaCreacion: oldData?.fechaCreacion || serverTimestamp()
        }, { merge: true });
        batch.delete(oldItemRef);
        await batch.commit();

        if (oldLogoPathToDelete && oldLogoPathToDelete !== logoPath) {
          await deleteLogoFromStorage(oldLogoPathToDelete);
        }
      }

      setProgressStatus({
        text: "Registro guardado.",
        meta: "Colegio actualizado correctamente.",
        progress: 100,
        type: "success"
      });
    }

    closeModal();
    clearProgressStatus();
    await loadData();
  } catch (error) {
    console.error(error);
    setProgressStatus({
      text: "Error guardando registro.",
      meta: error.message || "No se pudo guardar.",
      progress: 100,
      type: "error"
    });
  }
}

async function deleteRow(numeroColegio, correoVendedor) {
  if (!canManageVentasRole(state.effectiveUser)) return;

  const ok = confirm(`¿Seguro que quieres eliminar el colegio ${numeroColegio} de la cartera?`);
  if (!ok) return;

  try {
    setProgressStatus({
      text: "Eliminando registro...",
      meta: `${numeroColegio} · ${correoVendedor}`,
      progress: 30
    });

    const itemRef = doc(db, "ventas_cartera", normalizeEmail(correoVendedor), "items", String(numeroColegio));
    const snap = await getDoc(itemRef);
    const data = snap.exists() ? snap.data() : null;
    const logoPath = String(data?.logoPath || "").trim();

    await deleteDoc(itemRef);

    if (logoPath) {
      await deleteLogoFromStorage(logoPath);
    }

    setProgressStatus({
      text: "Registro eliminado.",
      meta: "El colegio fue eliminado correctamente.",
      progress: 100,
      type: "success"
    });
    clearProgressStatus();
    await loadData();
  } catch (error) {
    console.error(error);
    setProgressStatus({
      text: "Error eliminando registro.",
      meta: error.message || "No se pudo eliminar.",
      progress: 100,
      type: "error"
    });
  }
}

async function deleteSelectedRows() {
  if (!canManageVentasRole(state.effectiveUser)) return;
  if (!state.selectedKeys.size) return;

  const ok = confirm(`¿Seguro que quieres eliminar ${state.selectedKeys.size} colegio(s) seleccionados?`);
  if (!ok) return;

  try {
    const selectedEntries = [...state.selectedKeys].map((key) => {
      const [correoVendedor, numeroColegio] = key.split("__");
      return { correoVendedor, numeroColegio };
    });

    setProgressStatus({
      text: "Eliminando seleccionados...",
      meta: `Registros a eliminar: ${selectedEntries.length}`,
      progress: 15
    });

    let processed = 0;

    for (let i = 0; i < selectedEntries.length; i += WRITE_BATCH_LIMIT) {
      const chunk = selectedEntries.slice(i, i + WRITE_BATCH_LIMIT);
      const batch = writeBatch(db);

      chunk.forEach(({ correoVendedor, numeroColegio }) => {
        batch.delete(doc(db, "ventas_cartera", normalizeEmail(correoVendedor), "items", String(numeroColegio)));
      });

      await batch.commit();
      processed += chunk.length;

      const pct = 15 + Math.round((processed / selectedEntries.length) * 85);
      setProgressStatus({
        text: "Eliminando seleccionados...",
        meta: `Procesados: ${processed}/${selectedEntries.length}`,
        progress: pct
      });
    }

    state.selectedKeys.clear();

    setProgressStatus({
      text: "Eliminación lista.",
      meta: `${selectedEntries.length} registro(s) eliminados.`,
      progress: 100,
      type: "success"
    });
    clearProgressStatus();
    await loadData();
  } catch (error) {
    console.error(error);
    setProgressStatus({
      text: "Error eliminando seleccionados.",
      meta: error.message || "No se pudo completar la eliminación masiva.",
      progress: 100,
      type: "error"
    });
  }
}

/* =========================================================
   IMPORTAR XLSX
========================================================= */
function normalizeHeader(value = "") {
  return normalizeSearch(value).replace(/\s+/g, " ");
}

function mapImportRow(rawRow) {
  const normalized = {};
  Object.entries(rawRow || {}).forEach(([key, value]) => {
    normalized[normalizeHeader(key)] = normalizeText(value);
  });

  const getAny = (...keys) => {
    for (const key of keys) {
      const val = normalized[normalizeHeader(key)];
      if (val !== undefined) return val;
    }
    return "";
  };

  const alias = getAny("vendedor", "nombre vendedor", "vendedor(a)");
  const vendor = findVendorByAlias(alias);

  return {
    numeroColegio: getAny("nro", "numero colegio", "número colegio", "numero", "número"),
    colegio: getAny("colegio", "nombre colegio"),
    comuna: getAny("comuna"),
    estatus: getAny("estatus", "estado"),
    observaciones: "",
    ciudad: "",
    nombreVendedor: vendor?.nombre || "",
    apellidoVendedor: vendor?.apellido || "",
    correoVendedor: vendor?.email || "",
    vendedorAliasOriginal: alias,
    __sourceRow: rawRow?.__sourceRow || "",
    __sheetName: rawRow?.__sheetName || ""
  };
}

async function readWorkbookRows(file) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });

  const allRows = [];
  const sheetNames = workbook.SheetNames;

  for (let s = 0; s < sheetNames.length; s++) {
    const sheetName = workbook.SheetNames[s];
    const sheet = workbook.Sheets[sheetName];

    setProgressStatus({
      text: "Importando XLSX...",
      meta: `Leyendo hoja ${s + 1}/${sheetNames.length}: ${sheetName}`,
      progress: 5 + Math.round(((s + 1) / sheetNames.length) * 15)
    });

    const matrix = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: ""
    });

    if (!matrix.length) continue;

    // Buscar automáticamente la fila de encabezados
    let headerIndex = -1;

    for (let r = 0; r < matrix.length; r++) {
      const row = matrix[r].map(cell => normalizeHeader(cell));
      const hasNro = row.includes("nro") || row.includes("numero colegio") || row.includes("número colegio");
      const hasVendedor = row.includes("vendedor") || row.includes("nombre vendedor") || row.includes("vendedor(a)");
      const hasColegio = row.includes("colegio") || row.includes("nombre colegio");

      if (hasNro && hasVendedor && hasColegio) {
        headerIndex = r;
        break;
      }
    }

    if (headerIndex === -1) {
      continue;
    }

    const headers = matrix[headerIndex].map(h => normalizeText(h));

    for (let r = headerIndex + 1; r < matrix.length; r++) {
      const values = matrix[r] || [];

      // Saltar filas vacías
      const hasContent = values.some(v => normalizeText(v) !== "");
      if (!hasContent) continue;

      const obj = {};
      headers.forEach((header, idx) => {
        obj[header] = normalizeText(values[idx] ?? "");
      });

      allRows.push({
        ...obj,
        __sourceRow: r + 1,
        __sheetName: sheetName
      });
    }
  }

  return allRows;
}

async function importXlsx(file) {
  if (!canManageVentasRole(state.effectiveUser)) return;
  if (!file) return;

  try {
    if (typeof XLSX === "undefined") {
      alert("No se encontró la librería XLSX.");
      return;
    }

    setProgressStatus({
      text: "Importando XLSX...",
      meta: "Leyendo archivo...",
      progress: 10
    });

    const rawRows = await readWorkbookRows(file);

    setProgressStatus({
      text: "Importando XLSX...",
      meta: `Filas detectadas: ${rawRows.length}`,
      progress: 20
    });

    if (!rawRows.length) {
      setProgressStatus({
        text: "Importación detenida.",
        meta: "El archivo no tiene filas útiles.",
        progress: 100,
        type: "error"
      });
      return;
    }

    const parsedRows = [];
    const errors = [];

    for (let i = 0; i < rawRows.length; i++) {
      const row = mapImportRow(rawRows[i]);
    
      if (!row.numeroColegio || !row.colegio || !row.vendedorAliasOriginal) {
        continue;
      }
    
      if (!row.correoVendedor) {
        errors.push(`Fila ${row.__sourceRow || i + 1}: no se pudo resolver el vendedor "${row.vendedorAliasOriginal}" con aliasCartera.`);
        continue;
      }
    
      parsedRows.push(row);
    
      const pct = 20 + Math.round(((i + 1) / rawRows.length) * 20);
      setProgressStatus({
        text: "Importando XLSX...",
        meta: `Validando filas... ${i + 1}/${rawRows.length}`,
        progress: pct
      });
    }

    if (errors.length) {
      setProgressStatus({
        text: "Importación detenida.",
        meta: errors.slice(0, 3).join(" | "),
        progress: 100,
        type: "error"
      });
      return;
    }

    if (!parsedRows.length) {
      setProgressStatus({
        text: "Importación detenida.",
        meta: "No quedaron filas válidas para guardar.",
        progress: 100,
        type: "error"
      });
      return;
    }

    const touchedVendors = new Map();
    let createdCount = 0;
    let updatedCount = 0;

    for (let i = 0; i < parsedRows.length; i++) {
      const row = parsedRows[i];
      const email = normalizeEmail(row.correoVendedor);

      if (!touchedVendors.has(email)) {
        touchedVendors.set(email, {
          correoVendedor: email,
          nombreVendedor: row.nombreVendedor,
          apellidoVendedor: row.apellidoVendedor
        });
      }

      const parentRef = doc(db, "ventas_cartera", email);
      const itemRef = doc(db, "ventas_cartera", email, "items", normalizeText(row.numeroColegio));
      const existingSnap = await getDoc(itemRef);
      const existingData = existingSnap.exists() ? existingSnap.data() : null;

      await setDoc(parentRef, buildParentVendorPayload({
        correoVendedor: email,
        nombreVendedor: row.nombreVendedor,
        apellidoVendedor: row.apellidoVendedor
      }), { merge: true });

      await setDoc(itemRef, {
        ...buildItemPayload(row, existingData),
        ...(existingSnap.exists()
          ? {}
          : {
              creadoPor: normalizeEmail(state.realUser?.email || ""),
              fechaCreacion: serverTimestamp()
            })
      }, { merge: true });

      if (existingSnap.exists()) {
        updatedCount += 1;
      } else {
        createdCount += 1;
      }

      const pct = 45 + Math.round(((i + 1) / parsedRows.length) * 55);
      setProgressStatus({
        text: "Importando XLSX...",
        meta: `Guardando filas... ${i + 1}/${parsedRows.length}`,
        progress: pct
      });
    }

    setProgressStatus({
      text: "Importación lista.",
      meta: `${createdCount} nuevos · ${updatedCount} actualizados · ${parsedRows.length} total`,
      progress: 100,
      type: "success"
    });
    clearProgressStatus({}, 3000);

    $("fileInputXlsx").value = "";
    await loadData();
  } catch (error) {
    console.error(error);
    setProgressStatus({
      text: "Error importando XLSX.",
      meta: error.message || "No se pudo importar.",
      progress: 100,
      type: "error"
    });
  }
}

/* =========================================================
   EXPORTAR XLSX
========================================================= */
async function exportXlsx() {
  try {
    if (typeof XLSX === "undefined") {
      alert("No se encontró la librería XLSX.");
      return;
    }

    setProgressStatus({
      text: "Exportando XLSX...",
      meta: "Preparando datos visibles...",
      progress: 15
    });

    const exportRows = getSortedRows(state.filteredRows).map((row) => ({
      "NRO": row.numeroColegio,
      "VENDEDOR": `${row.nombreVendedor} ${row.apellidoVendedor}`.trim(),
      "COLEGIO": row.colegio,
      "COMUNA": row.comuna,
      "ESTATUS": row.estatus,
      "CIUDAD": row.ciudad,
      "OBSERVACIONES": row.observaciones
    }));

    setProgressStatus({
      text: "Exportando XLSX...",
      meta: `Registros a exportar: ${exportRows.length}`,
      progress: 45
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(exportRows);
    XLSX.utils.book_append_sheet(wb, ws, "Cartera");

    const filename = `cartera_${formatNowForFile()}.xlsx`;

    setProgressStatus({
      text: "Exportando XLSX...",
      meta: "Generando archivo...",
      progress: 80
    });

    XLSX.writeFile(wb, filename);

    setProgressStatus({
      text: "Exportación lista.",
      meta: filename,
      progress: 100,
      type: "success"
    });
    clearProgressStatus();
  } catch (error) {
    console.error(error);
    setProgressStatus({
      text: "Error exportando XLSX.",
      meta: error.message || "No se pudo exportar.",
      progress: 100,
      type: "error"
    });
  }
}

/* =========================================================
   EVENTOS
========================================================= */
function bindPageEvents() {
  const searchInput = $("searchInput");
  const vendorFilter = $("vendorFilter");
  const statusFilter = $("statusFilter");
  const btnRecargar = $("btnRecargar");
  const btnAgregar = $("btnAgregar");
  const btnEliminarSeleccionados = $("btnEliminarSeleccionados");
  const btnGuardarModal = $("btnGuardarModal");
  const btnCancelarModal = $("btnCancelarModal");
  const modalCloseBtn = $("modalCloseBtn");
  const vendedorSelectModal = $("vendedorSelectModal");
  const logoInput = $("logoInput");
  const quitarLogoCheck = $("quitarLogoCheck");
  const fileInputXlsx = $("fileInputXlsx");
  const btnExportar = $("btnExportar");
  const pageSizeSelect = $("pageSizeSelect");
  const btnPrevPage = $("btnPrevPage");
  const btnNextPage = $("btnNextPage");
  const thead = document.querySelector(".cartera-table thead");
  const tbody = $("tbodyCartera");
  const modalBackdrop = $("modalForm");

  if (searchInput && !searchInput.dataset.bound) {
    searchInput.dataset.bound = "1";
    searchInput.addEventListener("input", (e) => {
      state.search = e.target.value || "";
      applyFilters();
    });
  }

  if (vendorFilter && !vendorFilter.dataset.bound) {
    vendorFilter.dataset.bound = "1";
    vendorFilter.addEventListener("change", (e) => {
      state.vendorFilter = normalizeEmail(e.target.value || "");
      applyFilters();
    });
  }

    if (statusFilter && !statusFilter.dataset.bound) {
    statusFilter.dataset.bound = "1";
    statusFilter.value = state.statusFilter || "ok";

    statusFilter.addEventListener("change", (e) => {
      state.statusFilter = e.target.value || "ok";
      applyFilters();
    });
  }

  if (btnRecargar && !btnRecargar.dataset.bound) {
    btnRecargar.dataset.bound = "1";
    btnRecargar.addEventListener("click", async () => {
      await loadData();
    });
  }

  if (btnAgregar && !btnAgregar.dataset.bound) {
    btnAgregar.dataset.bound = "1";
    btnAgregar.addEventListener("click", () => {
      if (!canManageVentasRole(state.effectiveUser)) return;
      openCreateModal();
    });
  }

  if (btnEliminarSeleccionados && !btnEliminarSeleccionados.dataset.bound) {
    btnEliminarSeleccionados.dataset.bound = "1";
    btnEliminarSeleccionados.addEventListener("click", deleteSelectedRows);
  }

  if (btnGuardarModal && !btnGuardarModal.dataset.bound) {
    btnGuardarModal.dataset.bound = "1";
    btnGuardarModal.addEventListener("click", saveModal);
  }

  if (btnCancelarModal && !btnCancelarModal.dataset.bound) {
    btnCancelarModal.dataset.bound = "1";
    btnCancelarModal.addEventListener("click", closeModal);
  }

  if (modalCloseBtn && !modalCloseBtn.dataset.bound) {
    modalCloseBtn.dataset.bound = "1";
    modalCloseBtn.addEventListener("click", closeModal);
  }

  if (vendedorSelectModal && !vendedorSelectModal.dataset.bound) {
    vendedorSelectModal.dataset.bound = "1";
    vendedorSelectModal.addEventListener("change", updateVendorPreview);
  }

  if (logoInput && !logoInput.dataset.bound) {
    logoInput.dataset.bound = "1";
    logoInput.addEventListener("change", (e) => {
      const file = e.target.files?.[0] || null;

      if (file && !String(file.type || "").startsWith("image/")) {
        alert("El archivo debe ser una imagen válida.");
        e.target.value = "";
        return;
      }

      state.pendingLogoFile = file;

      if (file) {
        state.removeCurrentLogo = false;
        if ($("quitarLogoCheck")) $("quitarLogoCheck").checked = false;
      }

      refreshLogoPreview();
    });
  }

  if (quitarLogoCheck && !quitarLogoCheck.dataset.bound) {
    quitarLogoCheck.dataset.bound = "1";
    quitarLogoCheck.addEventListener("change", (e) => {
      state.removeCurrentLogo = !!e.target.checked;

      if (state.removeCurrentLogo) {
        state.pendingLogoFile = null;
        if ($("logoInput")) $("logoInput").value = "";
      }

      refreshLogoPreview();
    });
  }

  if (fileInputXlsx && !fileInputXlsx.dataset.bound) {
    fileInputXlsx.dataset.bound = "1";
    fileInputXlsx.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      await importXlsx(file);
    });
  }

  if (btnExportar && !btnExportar.dataset.bound) {
    btnExportar.dataset.bound = "1";
    btnExportar.addEventListener("click", exportXlsx);
  }

  if (pageSizeSelect && !pageSizeSelect.dataset.bound) {
    pageSizeSelect.dataset.bound = "1";
    pageSizeSelect.addEventListener("change", (e) => {
      const value = e.target.value || "8";
      state.pageSize = value === "all" ? "all" : (Number(value) || 8);
      state.currentPage = 1;
      renderTable();
    });
  }

  if (btnPrevPage && !btnPrevPage.dataset.bound) {
    btnPrevPage.dataset.bound = "1";
    btnPrevPage.addEventListener("click", () => {
      if (state.pageSize === "all") return;
      if (state.currentPage <= 1) return;
      state.currentPage -= 1;
      renderTable();
    });
  }

  if (btnNextPage && !btnNextPage.dataset.bound) {
    btnNextPage.dataset.bound = "1";
    btnNextPage.addEventListener("click", () => {
      if (state.pageSize === "all") return;

      const pageSize = Number(state.pageSize) || 8;
      const totalPages = Math.max(1, Math.ceil(state.filteredRows.length / pageSize));

      if (state.currentPage >= totalPages) return;
      state.currentPage += 1;
      renderTable();
    });
  }

  if (thead && !thead.dataset.bound) {
    thead.dataset.bound = "1";

    thead.addEventListener("click", (e) => {
      const target = e.target instanceof Element ? e.target : null;
      if (!target) return;

      const sortBtn = target.closest('button[data-action="sort"]');
      if (!sortBtn) return;

      const key = sortBtn.dataset.key || "";
      if (!key) return;

      if (state.sort.key === key) {
        state.sort.dir = state.sort.dir === "asc" ? "desc" : "asc";
      } else {
        state.sort.key = key;
        state.sort.dir = "asc";
      }

      state.currentPage = 1;
      renderTable();
    });

    thead.addEventListener("change", (e) => {
      const target = e.target;
      if (!(target instanceof HTMLInputElement)) return;
      if (target.id !== "checkAllRows") return;

      const checked = !!target.checked;

      state.pageRows.forEach((row) => {
        const rowKey = `${normalizeEmail(row.correoVendedor)}__${String(row.numeroColegio)}`;
        if (checked) {
          state.selectedKeys.add(rowKey);
        } else {
          state.selectedKeys.delete(rowKey);
        }
      });

      renderTable();
    });
  }

  if (tbody && !tbody.dataset.bound) {
    tbody.dataset.bound = "1";
    tbody.addEventListener("click", async (e) => {
      const rowCheck = e.target.closest('input[data-action="toggle-row"]');
      if (rowCheck) {
        const key = rowCheck.dataset.key || "";
        if (rowCheck.checked) {
          state.selectedKeys.add(key);
        } else {
          state.selectedKeys.delete(key);
        }
        renderTable();
        return;
      }

      const btn = e.target.closest("button[data-action]");
      if (!btn) return;

      const action = btn.dataset.action;
      const numeroColegio = btn.dataset.id || "";
      const correoVendedor = normalizeEmail(btn.dataset.email || "");

      const row = state.rows.find(r =>
        String(r.numeroColegio) === String(numeroColegio) &&
        normalizeEmail(r.correoVendedor) === correoVendedor
      );

      if (!row) return;

      if (action === "edit") openEditModal(row);
      if (action === "delete") await deleteRow(numeroColegio, correoVendedor);
    });
  }

  if (modalBackdrop && !modalBackdrop.dataset.bound) {
    modalBackdrop.dataset.bound = "1";
    modalBackdrop.addEventListener("click", (e) => {
      if (e.target === modalBackdrop) closeModal();
    });
  }
}

/* =========================================================
   INIT
========================================================= */
async function bootstrapFromSession() {
  state.vendors = getVendorUsers();
  state.realUser = getRealUser();
  state.effectiveUser = getEffectiveUser();
  state.search = "";

  if (!state.realUser || !state.effectiveUser) return;

  state.vendorFilter = isVendedorRole(state.effectiveUser)
    ? normalizeEmail(state.effectiveUser.email)
    : "";
}

async function initPage() {
  await waitForLayoutReady();

  await bootstrapFromSession();
  bindHeaderActions();
  bindPageEvents();

  if (state.effectiveUser) {
    renderHeaderState();
    renderRoleButtons();
    renderVendorFilter();
  }

  onAuthStateChanged(auth, async (user) => {
    if (!user) return;
  
    await bootstrapFromSession();
  
    renderHeaderState();
    bindHeaderActions(); // ← volver a enlazar navegar como / volver a mi usuario
  
    renderRoleButtons();
    renderVendorFilter();
  
    await loadData();
  });
}
initPage();
