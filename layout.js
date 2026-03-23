// layout.js — Header y menú global de Sistema Ventas RT

const page = document.body.dataset.page || "";

const menuItems = [
  { key: "informe-excel", href: "informe-excel.html", label: "Informe Excel" },
  { key: "buscar", href: "buscar.html", label: "Buscar" },
  { key: "vendedores", href: "vendedores.html", label: "Vendedores" },
  { key: "registrar-contacto", href: "registrar-contacto.html", label: "Registrar contacto" },
  { key: "editar-asignados", href: "editar-asignados.html", label: "Editar Asignados" }
];

function renderMenuLinks() {
  return menuItems.map(item => {
    const activeClass = page === item.key ? "active" : "";
    return `<a href="${item.href}" class="${activeClass}">${item.label}</a>`;
  }).join("");
}

function renderLayoutTop() {
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
      ${renderMenuLinks()}
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
  slot.innerHTML = renderLayoutTop();
}
