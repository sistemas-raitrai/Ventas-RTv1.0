// ui.js

import { $, setText, getNombreUsuario, getRolLabel, normalizeEmail } from "./utils.js";
import { isActingAsAnother } from "./roles.js";

const progressTimers = new Map();

export function setFlowNumbers(prefix, topText, bottomText = "") {
  const top = $(`${prefix}-top`);
  const bottom = $(`${prefix}-bottom`);

  if (top) top.textContent = topText;
  if (bottom) bottom.textContent = bottomText;
}

export function updateClockDataset() {
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

export function setHeaderState({ realUser, effectiveUser, scopeText = "" }) {
  if (!realUser || !effectiveUser) return;

  setText("usuario-conectado", normalizeEmail(realUser.email));
  setText("saludo-usuario", `Hola, ${getNombreUsuario(effectiveUser)}`);
  setText("scope-actual", scopeText);
}

export function renderActingUserSwitcher({ realUser, effectiveUser, users = [] }) {
  const box = $("admin-switcher");
  const select = $("select-acting-user");
  const btnReset = $("btn-reset-acting-user");

  if (!box || !select || !btnReset || !realUser || !effectiveUser) return;

  const isAdmin = realUser.rol === "admin";

  if (!isAdmin) {
    box.classList.add("hidden");
    return;
  }

  box.classList.remove("hidden");
  select.innerHTML = `<option value="">Elegir usuario</option>`;

  [...users]
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

  btnReset.disabled = !isActingAsAnother(realUser, effectiveUser);
}

export function bindLayoutButtons({
  homeUrl,
  onLogout,
  onActAs,
  onResetActAs
}) {
  const btnHome = $("btn-home");
  const btnLogout = $("btn-logout");
  const btnActingUser = $("btn-acting-user");
  const btnResetActingUser = $("btn-reset-acting-user");

  if (btnHome && !btnHome.dataset.bound) {
    btnHome.dataset.bound = "1";
    btnHome.addEventListener("click", (e) => {
      e.preventDefault();
      if (location.hostname.includes("github.io")) {
        location.href = homeUrl;
      } else {
        location.href = "index.html";
      }
    });
  }

  if (btnLogout && !btnLogout.dataset.bound) {
    btnLogout.dataset.bound = "1";
    btnLogout.addEventListener("click", async (e) => {
      e.preventDefault();
      if (typeof onLogout === "function") {
        await onLogout();
      }
    });
  }

  if (btnActingUser && !btnActingUser.dataset.bound) {
    btnActingUser.dataset.bound = "1";
    btnActingUser.addEventListener("click", async () => {
      const selectedEmail = normalizeEmail($("select-acting-user")?.value || "");
      if (typeof onActAs === "function") {
        await onActAs(selectedEmail);
      }
    });
  }

  if (btnResetActingUser && !btnResetActingUser.dataset.bound) {
    btnResetActingUser.dataset.bound = "1";
    btnResetActingUser.addEventListener("click", async () => {
      if (typeof onResetActAs === "function") {
        await onResetActAs();
      }
    });
  }
}

export function setProgressStatus({
  text,
  meta = "",
  progress = 0,
  type = "working",
  cardId = "statusCard",
  textId = "statusText",
  metaId = "statusMeta",
  barId = "progressBar"
}) {
  const card = $(cardId);
  const textEl = $(textId);
  const metaEl = $(metaId);
  const bar = $(barId);

  if (!card || !textEl || !metaEl || !bar) return;

  card.classList.remove("hidden", "success", "error");

  if (type === "success") card.classList.add("success");
  if (type === "error") card.classList.add("error");

  textEl.textContent = text;
  metaEl.textContent = meta;
  bar.style.width = `${Math.max(0, Math.min(100, progress))}%`;
}

export function clearProgressStatus({ cardId = "statusCard" } = {}, delay = 2200) {
  const card = $(cardId);
  if (!card) return;

  const prev = progressTimers.get(cardId);
  if (prev) window.clearTimeout(prev);

  const t = window.setTimeout(() => {
    card.classList.add("hidden");
  }, delay);

  progressTimers.set(cardId, t);
}

export function waitForElement(id, maxChecks = 80, delay = 50) {
  return new Promise((resolve, reject) => {
    let checks = 0;

    const tick = () => {
      const el = $(id);
      if (el) {
        resolve(el);
        return;
      }

      checks += 1;
      if (checks >= maxChecks) {
        reject(new Error(`No se encontró el elemento #${id}`));
        return;
      }

      setTimeout(tick, delay);
    };

    tick();
  });
}

export async function waitForLayoutReady() {
  await waitForElement("btn-home");
}
