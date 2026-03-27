// layout.js — Header y menú global de Sistema Ventas RT

const page = document.body.dataset.page || "";

import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.7.3/firebase-auth.js";
import { auth, getVentasUser } from "./firebase-init.js";

const menuItems = [
  {
    key: "registrar-contacto",
    href: "registrar-contacto.html",
    label: "Registrar contacto",
    roles: ["admin", "supervision", "registro", "vendedor"]
  },
  {
    key: "buscar",
    href: "buscar.html",
    label: "Buscar",
    roles: ["admin", "supervision", "registro", "vendedor"]
  },
  {
    key: "cartera",
    href: "cartera.html",
    label: "Cartera",
    roles: ["admin", "supervision", "registro", "vendedor"]
  },
  {
    key: "editar-asignados",
    href: "editar-asignados.html",
    label: "Editar Asignados",
    roles: ["admin", "supervision"]
  },
  {
    key: "clientes",
    href: "clientes.html",
    label: "Clientes",
    roles: ["admin", "supervision"]
  },
  {
    key: "informe-excel",
    href: "informe-excel.html",
    label: "Informe Excel",
    roles: ["admin", "supervision"]
  }
];

const ICON_HOME = `
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M3 10.5L12 3l9 7.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
    <path d="M5 9.5V21h14V9.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
  </svg>
`;

const ICON_LOGOUT = `
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M10 17l5-5-5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
    <path d="M15 12H4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
    <path d="M20 4v16" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
  </svg>
`;

function getVisibleMenuItems(user) {
  const rol = user?.rol || "";
  if (!rol) return [];
  return menuItems.filter(item => item.roles.includes(rol));
}

function renderMenuLinks(user) {
  const isHomeActive = ["", "index", "home", "dashboard"].includes(page);

  const homeLink = `
    <a
      href="index.html"
      class="menu-link menu-pill menu-link-home ${isHomeActive ? "active" : ""}"
      data-menu-key="home"
      aria-current="${isHomeActive ? "page" : "false"}"
    >
      <span class="menu-link-icon">${ICON_HOME}</span>
      <span class="menu-link-text">Inicio</span>
    </a>
  `;

  const otherLinks = getVisibleMenuItems(user).map(item => {
    const classes = ["menu-link", "menu-pill"];
    if (page === item.key) classes.push("active");

    return `
      <a
        href="${item.href}"
        class="${classes.join(" ")}"
        data-menu-key="${item.key}"
        aria-current="${page === item.key ? "page" : "false"}"
      >
        <span class="menu-link-text">${item.label}</span>
      </a>
    `;
  }).join("");

  return homeLink + otherLinks;
}

function renderLayoutTop(user) {
  return `
    <!-- HEADER -->
    <header class="ventas-header app-header">
      <div class="ventas-header-inner">
        <div class="ventas-brand">
          <a href="index.html" class="brand-link" aria-label="Ir al inicio">
            <div class="logo-box brand-mark">
              <img src="IMG/logo-raitrai.png" alt="Logo Rai Trai" class="logo-img">
            </div>
          </a>

          <div class="saludo-wrap header-user-block">
            <div class="header-kicker">Sistema Ventas RT</div>
            <h1 id="saludo-usuario" class="header-greeting">
              ${user ? "Hola, Usuario(a)" : "Cargando..."}
            </h1>
            <div id="usuario-conectado" class="usuario-conectado">
              ${user?.email || ""}
            </div>
          </div>
        </div>

        <div class="ventas-header-right header-actions">
          <a
            href="index.html"
            id="btn-home"
            class="header-icon icon-btn"
            title="Inicio"
            aria-label="Inicio"
          >
            ${ICON_HOME}
          </a>
        
          <a
            href="#"
            id="btn-logout"
            class="header-icon icon-btn icon-btn-danger"
            title="Cerrar sesión"
            aria-label="Cerrar sesión"
          >
            ${ICON_LOGOUT}
          </a>
        </div>
      </div>

      <nav class="ventas-menu app-nav" aria-label="Navegación principal">
        <div class="ventas-menu-inner menu-pills">
          ${renderMenuLinks(user)}
        </div>
      </nav>
    </header>

    <!-- HERRAMIENTAS GLOBALES DEL HEADER -->
    <section class="header-tools-wrap">
      <div class="header-tools-inner">
        <div id="admin-switcher" class="admin-switcher admin-switcher-card hidden">
          <div class="admin-switcher-row">
            <select id="select-acting-user">
              <option value="">Elegir usuario</option>
            </select>

            <button id="btn-acting-user" class="btn-primary">
              Entrar como
            </button>

            <button id="btn-reset-acting-user" class="btn-secundario">
              Volver a mi usuario
            </button>
          </div>
        </div>
      </div>
    </section>
  `;
}

function mountLayoutTop() {
  const slot = document.getElementById("layout-top");
  if (!slot) return;

  slot.innerHTML = renderLayoutTop(null);

  onAuthStateChanged(auth, (firebaseUser) => {
    const ventasUser = firebaseUser ? getVentasUser(firebaseUser.email || "") : null;
    slot.innerHTML = renderLayoutTop(ventasUser);
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mountLayoutTop, { once: true });
} else {
  mountLayoutTop();
}
