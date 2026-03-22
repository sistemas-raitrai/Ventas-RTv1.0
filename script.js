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

// 🔁 CAMBIA ESTA URL CUANDO CREES EL REPO DE VENTAS EN GITHUB
const GITHUB_HOME_URL = "https://sistemas-raitrai.github.io/Ventas-RT/";

/* =========================================================
   HELPERS DOM
========================================================= */
const $ = (id) => document.getElementById(id);

function setText(id, value) {
  const el = $(id);
  if (el) el.textContent = value;
}

function formatNombreDesdeEmail(email = "") {
  const base = String(email || "")
    .split("@")[0]
    .replace(/[._-]+/g, " ")
    .trim();

  return base.replace(/\b\w/g, l => l.toUpperCase());
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

  // No lo mostramos visualmente como campo separado,
  // pero dejamos el dato disponible por si luego quieres ponerlo.
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

  // Limpiar
  select.innerHTML = "";

  // Si es vendedor, solo ve su propia opción y el selector queda bloqueado
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

  // Supervisor / admin
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

function aplicarScopeVisual(currentUser, vendedorSeleccionadoEmail = "") {
  const scope = $("scope-actual");
  if (!scope) return;

  if (currentUser.rol === "vendedor") {
    scope.textContent = `Vista personal: ${currentUser.nombre || formatNombreDesdeEmail(currentUser.email)}`;
    return;
  }

  if (vendedorSeleccionadoEmail) {
    const user = VENTAS_USERS.find(u => u.email === vendedorSeleccionadoEmail);
    const nombre = user?.nombre || formatNombreDesdeEmail(vendedorSeleccionadoEmail);
    scope.textContent = `Vista filtrada por vendedor(a): ${nombre}`;
  } else {
    scope.textContent = "Vista general";
  }
}

/* =========================================================
   SESIÓN / UI GLOBAL
========================================================= */
onAuthStateChanged(auth, (user) => {
  if (!user) return;

  const email = (user.email || "").toLowerCase();
  const ventasUser = getVentasUser(email);

  if (!ventasUser) return;

  // Correo conectado
  setText("usuario-conectado", email);

  // Saludo
  const saludo = $("saludo-usuario");
  if (saludo) {
    if (ventasUser.rol === "admin") {
      saludo.textContent = "Hola, Administrador(a)";
    } else if (ventasUser.rol === "supervision") {
      saludo.textContent = "Hola, Supervisor(a)";
    } else {
      saludo.textContent = "Hola, Vendedor(a)";
    }
  }

  // Scope visual
  aplicarScopeVisual(ventasUser);

  // Selector vendedores
  poblarSelectorVendedores(ventasUser);

  // Dashboard por ahora en cero
  inicializarDashboardEnCeros();
});

/* =========================================================
   EVENTOS
========================================================= */
const btnIrVendedor = $("btn-ir-vendedor");
const btnIrGrupo = $("btn-ir-grupo");
const selectGrupo = $("select-grupo");

if (btnIrVendedor) {
  btnIrVendedor.addEventListener("click", () => {
    const select = $("select-vendedor");
    if (!select) return;

    const selectedEmail = select.value || "";
    const user = auth.currentUser;
    if (!user) return;

    const email = (user.email || "").toLowerCase();
    const ventasUser = getVentasUser(email);
    if (!ventasUser) return;

    aplicarScopeVisual(ventasUser, selectedEmail);

    // Por ahora solo cambia el scope visual.
    // En la siguiente etapa aquí llamaremos la carga real desde Firestore.
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
