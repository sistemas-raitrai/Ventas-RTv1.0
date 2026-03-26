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
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M3 10.5L12 3l9 7.5"></path>
    <path d="M5 9.5V21h14V9.5"></path>
  </svg>
`;

const ICON_LOGOUT = `
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M10 17l5-5-5-5"></path>
    <path d="M15 12H4"></path>
    <path d="M20 21H12"></path>
    <path d="M20 3H12"></path>
    <path d="M20 3v18"></path>
  </svg>
`;

function getVisibleMenuItems(user) {
  const rol = user?.rol || "";
  return menuItems.filter(item => item.roles.includes(rol));
}

function renderMenuLinks(user) {
  const isHomeActive = ["", "index", "home", "dashboard"].includes(page);

  const homeLink = `
    <a
      href="index.html"
      class="menu-link menu-link-home ${isHomeActive ? "active" : ""}"
      data-menu-key="home"
    >
      <span class="menu-link-icon">${ICON_HOME}</span>
      <span>Inicio</span>
    </a>
  `;

  const otherLinks = getVisibleMenuItems(user).map(item => {
    const classes = ["menu-link"];
    if (page === item.key) classes.push("active");

    return `
      <a
        href="${item.href}"
        class="${classes.join(" ")}"
        data-menu-key="${item.key}"
      >
        <span>${item.label}</span>
      </a>
    `;
  }).join("");

  return homeLink + otherLinks;
}

function renderLayoutTop(user) {
  return `
    <!-- HEADER -->
    <header class="ventas-header app-header">
      <div class="ventas-header-shell">
        <div class="ventas-header-left">
          <a href="index.html" class="logo-box brand-mark" aria-label="Ir al inicio">
            <img src="IMG/logo-raitrai.png" alt="Logo Rai Trai" class="logo-img">
          </a>

          <div class="header-divider"></div>

          <div class="saludo-wrap header-user-block">
            <div class="header-kicker">Sistema Ventas RT</div>
            <h1 id="saludo-usuario" class="header-greeting">Hola, Usuario(a)</h1>
            <div class="header-user-meta">
              <div id="usuario-conectado" class="usuario-conectado"></div>
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
    </header>

    <!-- MENU -->
    <nav class="ventas-menu app-nav" aria-label="Navegación principal">
      <div class="ventas-menu-shell">
        ${renderMenuLinks(user)}
      </div>
    </nav>

    <!-- HERRAMIENTAS GLOBALES DEL HEADER -->
    <section class="header-tools-wrap">
      <div class="header-tools-inner">
        <div id="admin-switcher" class="admin-switcher hidden">
          <div class="admin-switcher-row">
            <select id="select-acting-user">
              <option value="">Elegir usuario</option>
            </select>

            <button id="btn-acting-user">Entrar como</button>

            <button id="btn-reset-acting-user" class="btn-secundario">
              Volver a mi usuario
            </button>
          </div>
        </div>
      </div>
    </section>
  `;
}

const slot = document.getElementById("layout-top");

if (slot) {
  onAuthStateChanged(auth, (firebaseUser) => {
    const ventasUser = firebaseUser ? getVentasUser(firebaseUser.email || "") : null;
    slot.innerHTML = renderLayoutTop(ventasUser);
  });
}
