// utils.js

export const $ = (id) => document.getElementById(id);

export function setText(id, value) {
  const el = $(id);
  if (el) el.textContent = value;
}

export function normalizeEmail(email = "") {
  return String(email || "").trim().toLowerCase();
}

export function normalizeText(value = "") {
  return String(value || "").trim();
}

export function normalizeSearch(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function escapeHtml(value = "") {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function formatNombreDesdeEmail(email = "") {
  const base = String(email || "")
    .split("@")[0]
    .replace(/[._-]+/g, " ")
    .trim();

  return base.replace(/\b\w/g, l => l.toUpperCase());
}

export function getNombreUsuario(user) {
  if (!user) return "";
  return user.nombre || formatNombreDesdeEmail(user.email);
}

export function getRolLabel(role = "") {
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

export function formatNowForFile() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}`;
}
