// script.js — Dashboard base Ventas RT

import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.7.3/firebase-auth.js";
import { auth, VENTAS_USERS } from "./firebase-init.js";

import {
  $,
  getNombreUsuario,
  normalizeEmail
} from "./utils.js";

import {
  ACTING_USER_KEY,
  getRealUser,
  getEffectiveUser,
  isActingAsAnother,
  getVendorUsers,
  setVendorFilter,
  getVendorFilter,
  clearVendorFilter,
  setGroupFilter,
  getGroupFilter,
  clearGroupFilter,
  isVendedorRole,
  isRegistroRole
} from "./roles.js";

import {
  setFlowNumbers,
  updateClockDataset,
  setHeaderState,
  renderActingUserSwitcher,
  bindLayoutButtons,
  waitForLayoutReady
} from "./ui.js";

/* =========================================================
   CONFIG
========================================================= */
const GITHUB_HOME_URL = "https://sistemas-raitrai.github.io/Ventas-RT/";

/* =========================================================
   DASHBOARD BASE
========================================================= */
function inicializarDashboardEnCeros() {
  const setText = (id, value) => {
    const el = $(id);
    if (el) el.textContent = value;
  };

  setText("count-sin-asignar", "0");
  setText("count-a-contactar", "0");
  setText("count-fichas-firmar", "0");
  setText("count-reunion-3dias", "0");
  setText("count-pendientes", "0");

  setFlowNumbers("contactados", "00 | 00 | 00 | (00)", "00 | 00 | 00 | (00)");
  setFlowNumbers("cotizando", "00 | 00 | 00 | (00)", "00 | 00 | 00 | (00)");
  setFlowNumbers("reunion", "00 | 00 | 00 | (00)", "00 | 00 | 00 | (00)");
  setFlowNumbers("perdidas", "00 | 00 | 00 | (00)");
  setFlowNumbers("recotizando", "00 | 00 | 00 | (00)");
  setFlowNumbers("ganadas", "00 | 00 | 00 | (00)");
  setFlowNumbers("autorizadas", "00 | 00 | 00 | (00)");
  setFlowNumbers("cerradas", "00");
}

/* =========================================================
   SELECTOR DE VENDEDORES
========================================================= */
function poblarSelectorVendedores(effectiveUser) {
  const select = $("select-vendedor");
  const btn = $("btn-ir-vendedor");

  if (!select || !btn || !effectiveUser) return;

  const vendorFilter = getVendorFilter(effectiveUser);
  const vendedores = getVendorUsers();

  select.innerHTML = "";

  if (isVendedorRole(effectiveUser)) {
    const option = document.createElement("option");
    option.value = normalizeEmail(effectiveUser.email);
    option.textContent = getNombreUsuario(effectiveUser);
    option.selected = true;
    select.appendChild(option);

    select.disabled = true;
    btn.disabled = true;
    btn.classList.add("ui-hidden");
    return;
  }

  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = "Todos";
  select.appendChild(defaultOption);

  vendedores.forEach((v) => {
    const option = document.createElement("option");
    option.value = normalizeEmail(v.email);
    option.textContent = `${v.nombre} ${v.apellido}`.trim() || getNombreUsuario(v);
    select.appendChild(option);
  });

  select.value = vendorFilter || "";
  select.disabled = false;
  btn.disabled = false;
  btn.classList.remove("ui-hidden");
}

/* =========================================================
   SELECTOR DE GRUPOS
========================================================= */
function poblarSelectorGrupos(effectiveUser) {
  const select = $("select-grupo");
  const btn = $("btn-ir-grupo");

  if (!select || !btn || !effectiveUser) return;

  const vendorFilter = getVendorFilter(effectiveUser);
  const savedGroup = getGroupFilter();

  select.innerHTML = "";

  const defaultOption = document.createElement("option");
  defaultOption.value = "";

  if (isVendedorRole(effectiveUser)) {
    defaultOption.textContent = "Seleccionar Grupo";
  } else if (vendorFilter) {
    const vendedores = getVendorUsers();
    const vendedor = vendedores.find(v => normalizeEmail(v.email) === normalizeEmail(vendorFilter));
    defaultOption.textContent = vendedor
      ? `Seleccionar Grupo (${vendedor.nombre} ${vendedor.apellido}`.trim() + ")"
      : "Seleccionar Grupo";
  } else {
    defaultOption.textContent = "Seleccionar Grupo";
  }

  select.appendChild(defaultOption);

  if (savedGroup) {
    const savedOption = document.createElement("option");
    savedOption.value = savedGroup;
    savedOption.textContent = savedGroup;
    select.appendChild(savedOption);
    select.value = savedGroup;
  } else {
    select.value = "";
  }

  btn.disabled = false;
}

/* =========================================================
   SCOPE VISUAL
========================================================= */
function buildScopeText(realUser, effectiveUser) {
  const vendorFilter = getVendorFilter(effectiveUser);
  const vendedores = getVendorUsers();

  let texto = "Vista general";

  if (isVendedorRole(effectiveUser)) {
    texto = `Vista personal: ${getNombreUsuario(effectiveUser)}`;
  } else if (isRegistroRole(effectiveUser)) {
    if (vendorFilter) {
      const vendedor = vendedores.find(v => normalizeEmail(v.email) === normalizeEmail(vendorFilter));
      texto = vendedor
        ? `Vista observador · filtrada por vendedor(a): ${vendedor.nombre} ${vendedor.apellido}`.trim()
        : "Vista general · observador";
    } else {
      texto = "Vista general · observador";
    }
  } else {
    if (vendorFilter) {
      const vendedor = vendedores.find(v => normalizeEmail(v.email) === normalizeEmail(vendorFilter));
      texto = vendedor
        ? `Vista filtrada por vendedor(a): ${vendedor.nombre} ${vendedor.apellido}`.trim()
        : "Vista general";
    } else {
      texto = "Vista general";
    }
  }

  if (isActingAsAnother(realUser, effectiveUser)) {
    return `Navegando como ${getNombreUsuario(effectiveUser)} · ${effectiveUser.rol} · ${texto}`;
  }

  return texto;
}

/* =========================================================
   RENDER
========================================================= */
function renderPantalla() {
  const realUser = getRealUser();
  const effectiveUser = getEffectiveUser();

  if (!realUser || !effectiveUser) return;

  if (isVendedorRole(effectiveUser)) {
    setVendorFilter(effectiveUser.email);
  }

  setHeaderState({
    realUser,
    effectiveUser,
    scopeText: buildScopeText(realUser, effectiveUser)
  });

  renderActingUserSwitcher({
    realUser,
    effectiveUser,
    users: VENTAS_USERS
  });

  poblarSelectorVendedores(effectiveUser);
  poblarSelectorGrupos(effectiveUser);
  inicializarDashboardEnCeros();
}

/* =========================================================
   INIT
========================================================= */
async function initPage() {
  await waitForLayoutReady();

  bindLayoutButtons({
    homeUrl: GITHUB_HOME_URL,
    onLogout: async () => {
      try {
        sessionStorage.removeItem(ACTING_USER_KEY);
        clearVendorFilter();
        clearGroupFilter();
        await signOut(auth);
        location.href = "login.html";
      } catch (error) {
        alert("Error al cerrar sesión: " + error.message);
      }
    },
    onActAs: async (selectedEmail) => {
      const realUser = getRealUser();
      if (!realUser || realUser.rol !== "admin") return;
      if (!selectedEmail) return;

      sessionStorage.setItem(ACTING_USER_KEY, selectedEmail);
      clearVendorFilter();
      renderPantalla();
    },
    onResetActAs: async () => {
      sessionStorage.removeItem(ACTING_USER_KEY);
      clearVendorFilter();
      renderPantalla();
    }
  });

  const btnIrVendedor = $("btn-ir-vendedor");
  const btnIrGrupo = $("btn-ir-grupo");
  const selectGrupo = $("select-grupo");

  if (btnIrVendedor && !btnIrVendedor.dataset.bound) {
    btnIrVendedor.dataset.bound = "1";
    btnIrVendedor.addEventListener("click", () => {
      const effectiveUser = getEffectiveUser();
      if (!effectiveUser) return;

      if (isVendedorRole(effectiveUser)) {
        setVendorFilter(effectiveUser.email);
      } else {
        const selectedEmail = normalizeEmail($("select-vendedor")?.value || "");
        setVendorFilter(selectedEmail);
      }

      clearGroupFilter();
      renderPantalla();
    });
  }

  if (btnIrGrupo && !btnIrGrupo.dataset.bound) {
    btnIrGrupo.dataset.bound = "1";
    btnIrGrupo.addEventListener("click", () => {
      const grupoSeleccionado = String(selectGrupo?.value || "").trim();
      setGroupFilter(grupoSeleccionado);
      console.log("Grupo seleccionado:", grupoSeleccionado);
    });
  }

  onAuthStateChanged(auth, (user) => {
    if (!user) return;
    renderPantalla();
  });

  updateClockDataset();
  setInterval(updateClockDataset, 1000);
}

initPage();
