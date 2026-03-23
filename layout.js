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
    key: "vendedores",
    href: "vendedores.html",
    label: "Catálogo",
    roles: ["admin", "supervision", "registro", "vendedor"]
  },
  {
    key: "editar-asignados",
    href: "editar-asignados.html",
    label: "Editar Asignados",
    roles: ["admin", "supervision"]
  },
  {
    key: "informe-excel",
    href: "informe-excel.html",
    label: "Informe Excel",
    roles: ["admin", "supervision"]
  }
];

function getVisibleMenuItems(user) {
  const rol = user?.rol || "";
  return menuItems.filter(item => item.roles.includes(rol));
}

function renderMenuLinks(user) {
  return getVisibleMenuItems(user).map(item => {
    const activeClass = page === item.key ? "active" : "";
    return `<a href="${item.href}" class="${activeClass}">${item.label}</a>`;
  }).join("");
}

function renderLayoutTop(user) {
  return `
    <!-- HEADER -->
    <header class="ventas-header">
      <div class="ventas-header-left">
        <div class="logo-box">
          <img src="IMG/logo-raitrai.png" alt="Logo Rai Trai" class="logo-img">
        </div>

        <div class="header-divider"></div>

        <div class="saludo-wrap">
          <h1 id="saludo-usuario">Hola, Usuario(a)</h1>
          <div id="usuario-conectado" class="usuario-conectado"></div>
          <div id="scope-actual" class="scope-actual">Vista general</div>
        </div>
      </div>

      <div class="ventas-header-right">
        <a href="#" id="btn-home" class="header-icon" title="Inicio">⌂</a>
        <a href="#" id="btn-logout" class="header-icon" title="Cerrar sesión">⇥</a>
      </div>
    </header>

    <!-- MENU -->
    <nav class="ventas-menu">
      ${renderMenuLinks(user)}
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
