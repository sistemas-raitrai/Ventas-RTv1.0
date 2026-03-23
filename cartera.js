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

/* =========================================================
   ESTADO
========================================================= */
const state = {
  realUser: null,
  effectiveUser: null,
  rows: [],
  filteredRows: [],
  vendorFilter: "",
  search: "",
  modalMode: "create",
  editingOriginal: null,
  vendors: []
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
  const raw = user?.aliasCartera;
  if (Array.isArray(raw)) return raw.map(a => normalizeSearch(a)).filter(Boolean);
  if (typeof raw === "string") return [normalizeSearch(raw)].filter(Boolean);
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
  let texto = "Cartera · Vista general";

  if (isVendedorRole(state.effectiveUser)) {
    texto = `Cartera · Vista personal de ${getNombreUsuario(state.effectiveUser)}`;
  } else if (canObserveOnlyRole(state.effectiveUser)) {
    texto = "Cartera · Observador";
  } else {
    texto = `Cartera · ${state.effectiveUser.rol}`;
  }

  if (state.vendorFilter && !isVendedorRole(state.effectiveUser)) {
    texto += ` · Filtrada por ${getVendorNameByEmail(state.vendorFilter)}`;
  }

  if (isActingAsAnother(state.realUser, state.effectiveUser)) {
    return `Navegando como ${getNombreUsuario(state.effectiveUser)} · ${state.effectiveUser.rol} · ${texto}`;
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
    observaciones: normalizeText(data.observaciones)
  };
}

function buildItemPayload(input, existing = null) {
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

/* =========================================================
   HEADER / LAYOUT
========================================================= */
function renderHeaderState() {
  const pageScope = $("carteraScope");

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
  const allowManage = canManageVentasRole(state.effectiveUser);
  const importLabel = $("labelImportar");
  const addBtn = $("btnAgregar");

  if (importLabel) importLabel.classList.toggle("hidden", !allowManage);
  if (addBtn) addBtn.classList.toggle("hidden", !allowManage);
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

function applyFilters() {
  let rows = [...state.rows];

  if (state.vendorFilter) {
    rows = rows.filter(r => normalizeEmail(r.correoVendedor) === normalizeEmail(state.vendorFilter));
  }

  const q = normalizeSearch(state.search);
  if (q) {
    rows = rows.filter(r => getSearchTarget(r).includes(q));
  }

  rows.sort((a, b) => {
    const aNum = String(a.numeroColegio || "");
    const bNum = String(b.numeroColegio || "");
    return aNum.localeCompare(bNum, "es", { numeric: true }) || a.colegio.localeCompare(b.colegio, "es");
  });

  state.filteredRows = rows;
  renderTable();
  renderHeaderState();
}

function renderTable() {
  const tbody = $("tbodyCartera");
  const empty = $("emptyState");
  const summary = $("tableSummary");
  if (!tbody || !empty || !summary) return;

  const allowManage = canManageVentasRole(state.effectiveUser);
  summary.textContent = `${state.filteredRows.length} registro(s) mostrados · ${state.rows.length} total`;

  if (!state.filteredRows.length) {
    tbody.innerHTML = "";
    empty.classList.remove("hidden");
    return;
  }

  empty.classList.add("hidden");

  tbody.innerHTML = state.filteredRows.map((row) => {
    const sellerName = `${row.nombreVendedor} ${row.apellidoVendedor}`.trim();

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

    return `
      <tr>
        <td>${escapeHtml(row.numeroColegio)}</td>
        <td>${escapeHtml(sellerName)}</td>
        <td>${escapeHtml(row.colegio)}</td>
        <td>${escapeHtml(row.comuna)}</td>
        <td>${escapeHtml(row.estatus)}</td>
        <td>${escapeHtml(row.observaciones)}</td>
        <td class="actions-col">${actions}</td>
      </tr>
    `;
  }).join("");
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
  const vendor = state.vendors.find(v => normalizeEmail(v.email) === normalizeEmail(select?.value || ""));

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
  $("modalForm").classList.add("show");
}

function closeModal() {
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
      progress: 35
    });

    if (state.modalMode === "create") {
      const exists = await getDoc(newItemRef);
      if (exists.exists()) {
        alert("Ya existe un colegio con ese N° dentro de la cartera de ese vendedor(a).");
        return;
      }

      await setDoc(newParentRef, buildParentVendorPayload(input), { merge: true });
      await setDoc(newItemRef, {
        ...buildItemPayload(input),
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

        await setDoc(newParentRef, buildParentVendorPayload(input), { merge: true });
        await setDoc(newItemRef, {
          ...buildItemPayload(input, existingData)
        }, { merge: true });
      } else {
        const targetExists = await getDoc(newItemRef);
        if (targetExists.exists()) {
          alert("Ya existe un colegio con ese N° en la cartera destino.");
          return;
        }

        const oldSnap = await getDoc(oldItemRef);
        const oldData = oldSnap.exists() ? oldSnap.data() : null;

        const batch = writeBatch(db);
        batch.set(newParentRef, buildParentVendorPayload(input), { merge: true });
        batch.set(newItemRef, {
          ...buildItemPayload(input, oldData),
          creadoPor: normalizeEmail(state.realUser?.email || ""),
          fechaCreacion: serverTimestamp()
        }, { merge: true });
        batch.delete(oldItemRef);
        await batch.commit();
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
      progress: 40
    });

    await deleteDoc(doc(db, "ventas_cartera", normalizeEmail(correoVendedor), "items", String(numeroColegio)));

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
    vendedorAliasOriginal: alias
  };
}

async function readWorkbookRows(file) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });

  const allRows = [];
  const sheetNames = workbook.SheetNames;

  for (let s = 0; s < sheetNames.length; s++) {
    const sheetName = sheetNames[s];
    const sheet = workbook.Sheets[sheetName];

    setProgressStatus({
      text: "Importando XLSX...",
      meta: `Leyendo hoja ${s + 1}/${sheetNames.length}: ${sheetName}`,
      progress: 5 + Math.round(((s + 1) / sheetNames.length) * 15)
    });

    const rawRows = XLSX.utils.sheet_to_json(sheet, {
      defval: "",
      range: 2
    });

    rawRows.forEach((row) => allRows.push(row));
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
        errors.push(`Fila ${i + 4}: no se pudo resolver el vendedor "${row.vendedorAliasOriginal}" con aliasCartera.`);
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

    const exportRows = state.filteredRows.map((row) => ({
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
  const vendor = state.vendors.find(v => normalizeEmail(v.email) === normalizeEmail(select?.value || ""));

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
  $("modalForm").classList.add("show");
}

function closeModal() {
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

function bindPageEvents() {
  const searchInput = $("searchInput");
  const vendorFilter = $("vendorFilter");
  const btnRecargar = $("btnRecargar");
  const btnAgregar = $("btnAgregar");
  const btnGuardarModal = $("btnGuardarModal");
  const btnCancelarModal = $("btnCancelarModal");
  const modalCloseBtn = $("modalCloseBtn");
  const vendedorSelectModal = $("vendedorSelectModal");
  const fileInputXlsx = $("fileInputXlsx");
  const btnExportar = $("btnExportar");
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

  if (tbody && !tbody.dataset.bound) {
    tbody.dataset.bound = "1";
    tbody.addEventListener("click", async (e) => {
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
  renderHeaderState();
  renderRoleButtons();
  renderVendorFilter();

  onAuthStateChanged(auth, async (user) => {
    if (!user) return;
    await bootstrapFromSession();
    renderHeaderState();
    renderRoleButtons();
    renderVendorFilter();
    await loadData();
  });
}

initPage();
