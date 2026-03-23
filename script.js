// script.js — Dashboard base Ventas RT

import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.7.3/firebase-auth.js";
import {
  auth,
  VENTAS_USERS,
  getVentasUser
} from "./firebase-init.js";

/* =========================================================
   CONFIG
========================================================= */

const GITHUB_HOME_URL = "https://sistemas-raitrai.github.io/Ventas-RT/";
const ACTING_USER_KEY = "ventas_acting_user_email";
const VENDOR_FILTER_KEY = "ventas_vendor_filter_email";
const GROUP_FILTER_KEY = "ventas_group_filter_value";

/* =========================================================
   HELPERS DOM
========================================================= */
const $ = (id) => document.getElementById(id);

function setText(id, value) {
  const el = $(id);
  if (el) el.textContent = value;
}

function normalizeEmail(email = "") {
  return String(email || "").trim().toLowerCase();
}

function formatNombreDesdeEmail(email = "") {
  const base = String(email || "")
    .split("@")[0]
    .replace(/[._-]+/g, " ")
    .trim();

  return base.replace(/\b\w/g, l => l.toUpperCase());
}

function getNombreUsuario(user) {
  if (!user) return "";
  return user.nombre || formatNombreDesdeEmail(user.email);
}

function getRolLabel(role = "") {
  switch (role) {
    case "admin":
      return "Administrador(a)";
    case "supervision":
      return "Supervisor(a)";
    case "registro":
      return "Registro";
    case "vendedor":
      return "Vendedor(a)";
    default:
      return "Usuario(a)";
  }
}

function setFlowNumbers(prefix, topText, bottomText = "") {
  const top = $(`${prefix}-top`);
  const bottom = $(`${prefix}-bottom`);

  if (top) top.textContent = topText;
  if (bottom) bottom.textContent = bottomText;
}

function actualizarReloj() {
  const ahora = new Date();
  const hora = ahora.toLocaleTimeString("es-CL", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });

  const fecha = ahora.toLocaleDateString("es-CL", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric"
  });

  document.body.dataset.reloj = `${hora} | ${fecha}`;
}

/* =========================================================
   DASHBOARD BASE (FASE 1)
========================================================= */
function inicializarDashboardEnCeros() {
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
   USUARIO REAL / USUARIO EFECTIVO
========================================================= */
function getRealUser() {
  const firebaseUser = auth.currentUser;
  if (!firebaseUser) return null;
  return getVentasUser(firebaseUser.email || "");
}

function getEffectiveUser() {
  const realUser = getRealUser();
  if (!realUser) return null;

  // Solo ADMIN puede navegar como otro usuario
  if (realUser.rol !== "admin") {
    sessionStorage.removeItem(ACTING_USER_KEY);
    return realUser;
  }

  const actingEmail = normalizeEmail(sessionStorage.getItem(ACTING_USER_KEY));
  if (!actingEmail) return realUser;

  const actingUser = getVentasUser(actingEmail);
  return actingUser || realUser;
}

function estaNavegandoComoOtro(realUser, effectiveUser) {
  if (!realUser || !effectiveUser) return false;
  return normalizeEmail(realUser.email) !== normalizeEmail(effectiveUser.email);
}

/* =========================================================
   FILTRO DE VENDEDOR
========================================================= */
function setVendorFilter(email = "") {
  const safe = normalizeEmail(email);
  if (!safe) {
    sessionStorage.removeItem(VENDOR_FILTER_KEY);
    return;
  }
  sessionStorage.setItem(VENDOR_FILTER_KEY, safe);
}

function getVendorFilter(effectiveUser) {
  if (!effectiveUser) return "";

  // Si el usuario efectivo es vendedor, siempre se filtra a sí mismo
  if (effectiveUser.rol === "vendedor") {
    return normalizeEmail(effectiveUser.email);
  }

  return normalizeEmail(sessionStorage.getItem(VENDOR_FILTER_KEY));
}

/* =========================================================
   FILTRO DE GRUPO
========================================================= */
function setGroupFilter(value = "") {
  const safe = String(value || "").trim();
  if (!safe) {
    sessionStorage.removeItem(GROUP_FILTER_KEY);
    return;
  }
  sessionStorage.setItem(GROUP_FILTER_KEY, safe);
}

function getGroupFilter() {
  return String(sessionStorage.getItem(GROUP_FILTER_KEY) || "").trim();
}

/* =========================================================
   SELECTOR NAVEGAR COMO (SOLO ADMIN)
========================================================= */
function renderActingUserSwitcher(realUser, effectiveUser) {
  const box = $("admin-switcher");
  const select = $("select-acting-user");
  const btnApply = $("btn-acting-user");
  const btnReset = $("btn-reset-acting-user");

  if (!box || !select || !btnApply || !btnReset) return;

  const isAdmin = realUser?.rol === "admin";

  if (!isAdmin) {
    box.classList.add("hidden");
    return;
  }

  box.classList.remove("hidden");

  select.innerHTML = `<option value="">Elegir usuario</option>`;

  [...VENTAS_USERS]
    .sort((a, b) => getNombreUsuario(a).localeCompare(getNombreUsuario(b), "es"))
    .forEach((user) => {
      const opt = document.createElement("option");
      opt.value = normalizeEmail(user.email);
      opt.textContent = `${getNombreUsuario(user)} — ${getRolLabel(user.rol)}`;

      if (normalizeEmail(user.email) === normalizeEmail(effectiveUser.email)) {
        opt.selected = true;
      }

      select.appendChild(opt);
    });

  btnReset.disabled = !estaNavegandoComoOtro(realUser, effectiveUser);
}

/* =========================================================
   SELECTOR DE VENDEDORES
========================================================= */
function getVendedores() {
  return VENTAS_USERS
    .filter(u => u.rol === "vendedor")
    .sort((a, b) => getNombreUsuario(a).localeCompare(getNombreUsuario(b), "es"));
}

function poblarSelectorVendedores(effectiveUser) {
  const select = $("select-vendedor");
  const btn = $("btn-ir-vendedor");

  if (!select || !btn || !effectiveUser) return;

  const role = effectiveUser.rol;
  const vendorFilter = getVendorFilter(effectiveUser);

  select.innerHTML = "";

  // VENDEDOR: solo se ve a sí mismo y ocultamos botón Ir
  if (role === "vendedor") {
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

  // ADMIN / SUPERVISION / REGISTRO
  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = "Todos";
  select.appendChild(defaultOption);

  getVendedores().forEach((v) => {
    const option = document.createElement("option");
    option.value = normalizeEmail(v.email);
    option.textContent = getNombreUsuario(v);
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

  if (effectiveUser.rol === "vendedor") {
    defaultOption.textContent = "Seleccionar Grupo";
  } else if (vendorFilter) {
    const vendedor = VENTAS_USERS.find(u => normalizeEmail(u.email) === vendorFilter);
    defaultOption.textContent = `Seleccionar Grupo (${getNombreUsuario(vendedor)})`;
  } else {
    defaultOption.textContent = "Seleccionar Grupo";
  }

  select.appendChild(defaultOption);

  // Por ahora no cargamos grupos reales todavía.
  // En la siguiente etapa aquí los llenaremos desde Firestore.
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
function aplicarScopeVisual(realUser, effectiveUser) {
  const scope = $("scope-actual");
  if (!scope) return;

  const vendorFilter = getVendorFilter(effectiveUser);
  let texto = "Vista general";

  if (effectiveUser.rol === "vendedor") {
    texto = `Vista personal: ${getNombreUsuario(effectiveUser)}`;
  } else if (effectiveUser.rol === "registro") {
    if (vendorFilter) {
      const vendedor = VENTAS_USERS.find(u => normalizeEmail(u.email) === vendorFilter);
      texto = `Vista observador · filtrada por vendedor(a): ${getNombreUsuario(vendedor)}`;
    } else {
      texto = "Vista general · observador";
    }
  } else {
    if (vendorFilter) {
      const vendedor = VENTAS_USERS.find(u => normalizeEmail(u.email) === vendorFilter);
      texto = `Vista filtrada por vendedor(a): ${getNombreUsuario(vendedor)}`;
    } else {
      texto = "Vista general";
    }
  }

  if (estaNavegandoComoOtro(realUser, effectiveUser)) {
    scope.textContent = `Navegando como ${getNombreUsuario(effectiveUser)} · ${getRolLabel(effectiveUser.rol)} · ${texto}`;
  } else {
    scope.textContent = texto;
  }
}

/* =========================================================
   SESIÓN / UI GLOBAL
========================================================= */
function renderPantalla() {
  const realUser = getRealUser();
  const effectiveUser = getEffectiveUser();

  if (!realUser || !effectiveUser) return;

  // Si el usuario efectivo es vendedor, siempre fijamos su filtro
  if (effectiveUser.rol === "vendedor") {
    setVendorFilter(effectiveUser.email);
  }

  setText("usuario-conectado", normalizeEmail(realUser.email));

  const saludo = $("saludo-usuario");
  if (saludo) {
    if (effectiveUser.rol === "admin") {
      saludo.textContent = "Hola, Administrador(a)";
    } else if (effectiveUser.rol === "supervision") {
      saludo.textContent = "Hola, Supervisor(a)";
    } else if (effectiveUser.rol === "registro") {
      saludo.textContent = "Hola, Registro";
    } else {
      saludo.textContent = "Hola, Vendedor(a)";
    }
  }

  renderActingUserSwitcher(realUser, effectiveUser);
  poblarSelectorVendedores(effectiveUser);
  poblarSelectorGrupos(effectiveUser);
  aplicarScopeVisual(realUser, effectiveUser);
  inicializarDashboardEnCeros();
}

onAuthStateChanged(auth, (user) => {
  if (!user) return;
  renderPantalla();
});

/* =========================================================
   EVENTOS
========================================================= */
const btnActingUser = $("btn-acting-user");
if (btnActingUser) {
  btnActingUser.addEventListener("click", () => {
    const realUser = getRealUser();
    if (!realUser || realUser.rol !== "admin") return;

    const selectedEmail = normalizeEmail($("select-acting-user")?.value || "");
    if (!selectedEmail) return;

    sessionStorage.setItem(ACTING_USER_KEY, selectedEmail);

    // Al navegar como otro usuario, limpiamos filtro manual de vendedor
    // para que parta desde el comportamiento natural de ese rol.
    sessionStorage.removeItem(VENDOR_FILTER_KEY);
    renderPantalla();
  });
}

const btnResetActingUser = $("btn-reset-acting-user");
if (btnResetActingUser) {
  btnResetActingUser.addEventListener("click", () => {
    sessionStorage.removeItem(ACTING_USER_KEY);
    sessionStorage.removeItem(VENDOR_FILTER_KEY);
    renderPantalla();
  });
}

const btnIrVendedor = $("btn-ir-vendedor");
if (btnIrVendedor) {
  btnIrVendedor.addEventListener("click", () => {
    const effectiveUser = getEffectiveUser();
    if (!effectiveUser) return;

    if (effectiveUser.rol === "vendedor") {
      setVendorFilter(effectiveUser.email);
    } else {
      const selectedEmail = normalizeEmail($("select-vendedor")?.value || "");
      setVendorFilter(selectedEmail);
    }

    // Cuando cambia vendedor, limpiamos el grupo seleccionado
    sessionStorage.removeItem(GROUP_FILTER_KEY);
    renderPantalla();
  });
}

const btnIrGrupo = $("btn-ir-grupo");
const selectGrupo = $("select-grupo");

if (btnIrGrupo) {
  btnIrGrupo.addEventListener("click", () => {
    const grupoSeleccionado = String(selectGrupo?.value || "").trim();
    setGroupFilter(grupoSeleccionado);

    console.log("Grupo seleccionado:", grupoSeleccionado);

    // Más adelante aquí cargaremos el detalle real del grupo
  });
}

const btnHome = $("btn-home");
if (btnHome) {
  btnHome.addEventListener("click", (e) => {
    e.preventDefault();

    if (location.hostname.includes("github.io")) {
      location.href = GITHUB_HOME_URL;
    } else {
      location.href = "/";
    }
  });
}

const btnLogout = $("btn-logout");
if (btnLogout) {
  btnLogout.addEventListener("click", async (e) => {
    e.preventDefault();

    try {
      sessionStorage.removeItem(ACTING_USER_KEY);
      sessionStorage.removeItem(VENDOR_FILTER_KEY);
      sessionStorage.removeItem(GROUP_FILTER_KEY);
      await signOut(auth);
      location.href = "login.html";
    } catch (error) {
      alert("Error al cerrar sesión: " + error.message);
    }
  });
}

/* =========================================================
   RELOJ INTERNO
========================================================= */
setInterval(actualizarReloj, 1000);
actualizarReloj();
