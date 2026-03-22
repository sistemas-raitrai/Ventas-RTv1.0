// script.js — Dashboard base Ventas RT

import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.7.3/firebase-auth.js";
import {
  auth,
  VENTAS_USERS,
  getVentasUser,
  puedeNavegarComo
} from "./firebase-init.js";

/* =========================================================
   CONFIG
========================================================= */

// 🔁 CAMBIA ESTA URL CUANDO CREES EL REPO DE VENTAS EN GITHUB
const GITHUB_HOME_URL = "https://sistemas-raitrai.github.io/Ventas-RT/";
const ACTING_USER_KEY = "ventas_acting_user_email";

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

  const scope = $("scope-actual");
  if (scope && !scope.dataset.baseText) {
    scope.dataset.baseText = scope.textContent;
  }

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

  if (!puedeNavegarComo(realUser.email)) {
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
   SELECTOR DE USUARIO EFECTIVO (ADMIN / SUPERVISION)
========================================================= */
function renderActingUserSwitcher(realUser, effectiveUser) {
  const box = $("admin-switcher");
  const select = $("select-acting-user");
  const btnApply = $("btn-acting-user");
  const btnReset = $("btn-reset-acting-user");

  if (!box || !select || !btnApply || !btnReset) return;

  const puede = realUser && puedeNavegarComo(realUser.email);

  if (!puede) {
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
      opt.textContent = `${getNombreUsuario(user)} — ${user.rol}`;
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
  return VENTAS_USERS.filter(u => u.rol === "vendedor");
}

function poblarSelectorVendedores(currentUser) {
  const select = $("select-vendedor");
  const btn = $("btn-ir-vendedor");
  if (!select || !btn) return;

  const role = currentUser.rol;

  select.innerHTML = "";

  if (role === "vendedor") {
    const option = document.createElement("option");
    option.value = currentUser.email;
    option.textContent = currentUser.nombre || formatNombreDesdeEmail(currentUser.email);
    option.selected = true;
    select.appendChild(option);

    select.disabled = true;
    btn.disabled = true;
    return;
  }

  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = "Seleccionar Vendedor(a)";
  defaultOption.selected = true;
  select.appendChild(defaultOption);

  getVendedores().forEach(v => {
    const option = document.createElement("option");
    option.value = v.email;
    option.textContent = v.nombre || formatNombreDesdeEmail(v.email);
    select.appendChild(option);
  });

  select.disabled = false;
  btn.disabled = false;
}

function aplicarScopeVisual(realUser, effectiveUser, vendedorSeleccionadoEmail = "") {
  const scope = $("scope-actual");
  if (!scope) return;

  let texto = "Vista general";

  if (effectiveUser.rol === "vendedor") {
    texto = `Vista personal: ${getNombreUsuario(effectiveUser)}`;
  } else if (effectiveUser.rol === "registro") {
    texto = "Vista general · solo registro de cotizaciones";
  } else if (vendedorSeleccionadoEmail) {
    const user = VENTAS_USERS.find(u => normalizeEmail(u.email) === normalizeEmail(vendedorSeleccionadoEmail));
    const nombre = user?.nombre || formatNombreDesdeEmail(vendedorSeleccionadoEmail);
    texto = `Vista filtrada por vendedor(a): ${nombre}`;
  }

  if (estaNavegandoComoOtro(realUser, effectiveUser)) {
    scope.textContent = `Navegando como ${getNombreUsuario(effectiveUser)} · ${effectiveUser.rol} · ${texto}`;
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
    if (!realUser || !puedeNavegarComo(realUser.email)) return;

    const selectedEmail = normalizeEmail($("select-acting-user")?.value || "");
    if (!selectedEmail) return;

    sessionStorage.setItem(ACTING_USER_KEY, selectedEmail);
    renderPantalla();
  });
}

const btnResetActingUser = $("btn-reset-acting-user");
if (btnResetActingUser) {
  btnResetActingUser.addEventListener("click", () => {
    sessionStorage.removeItem(ACTING_USER_KEY);
    renderPantalla();
  });
}

const btnIrVendedor = $("btn-ir-vendedor");
const btnIrGrupo = $("btn-ir-grupo");
const selectGrupo = $("select-grupo");

if (btnIrVendedor) {
  btnIrVendedor.addEventListener("click", () => {
    const select = $("select-vendedor");
    if (!select) return;

    const selectedEmail = select.value || "";
    const realUser = getRealUser();
    const effectiveUser = getEffectiveUser();
    if (!realUser || !effectiveUser) return;

    aplicarScopeVisual(realUser, effectiveUser, selectedEmail);
    inicializarDashboardEnCeros();
  });
}

if (btnIrGrupo) {
  btnIrGrupo.addEventListener("click", () => {
    const grupoSeleccionado = selectGrupo?.value || "";
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
