// roles.js

import { auth, VENTAS_USERS, getVentasUser } from "./firebase-init.js";
import { normalizeEmail, normalizeText } from "./utils.js";

export const ACTING_USER_KEY = "ventas_acting_user_email";
export const VENDOR_FILTER_KEY = "ventas_vendor_filter_email";
export const GROUP_FILTER_KEY = "ventas_group_filter_value";

function resolveRole(input = "") {
  if (!input) return "";
  if (typeof input === "string") return input;
  return input.rol || "";
}

export function isAdminRole(input = "") {
  return resolveRole(input) === "admin";
}

export function isSupervisionRole(input = "") {
  return resolveRole(input) === "supervision";
}

export function isRegistroRole(input = "") {
  return resolveRole(input) === "registro";
}

export function isVendedorRole(input = "") {
  return resolveRole(input) === "vendedor";
}

export function canManageVentasRole(input = "") {
  const role = resolveRole(input);
  return role === "admin" || role === "supervision";
}

export function canObserveOnlyRole(input = "") {
  return resolveRole(input) === "registro";
}

export function getRealUser() {
  const firebaseUser = auth.currentUser;
  if (!firebaseUser) return null;
  return getVentasUser(firebaseUser.email || "");
}

export function getEffectiveUser() {
  const realUser = getRealUser();
  if (!realUser) return null;

  // Solo admin puede navegar como otro usuario
  if (!isAdminRole(realUser)) {
    sessionStorage.removeItem(ACTING_USER_KEY);
    return realUser;
  }

  const actingEmail = normalizeEmail(sessionStorage.getItem(ACTING_USER_KEY));
  if (!actingEmail) return realUser;

  const actingUser = getVentasUser(actingEmail);
  return actingUser || realUser;
}

export function isActingAsAnother(realUser, effectiveUser) {
  if (!realUser || !effectiveUser) return false;
  return normalizeEmail(realUser.email) !== normalizeEmail(effectiveUser.email);
}

export function setVendorFilter(email = "") {
  const safe = normalizeEmail(email);
  if (!safe) {
    sessionStorage.removeItem(VENDOR_FILTER_KEY);
    return;
  }
  sessionStorage.setItem(VENDOR_FILTER_KEY, safe);
}

export function clearVendorFilter() {
  sessionStorage.removeItem(VENDOR_FILTER_KEY);
}

export function getVendorFilter(effectiveUser) {
  if (!effectiveUser) return "";

  // Un vendedor siempre queda filtrado a sí mismo
  if (isVendedorRole(effectiveUser)) {
    return normalizeEmail(effectiveUser.email);
  }

  return normalizeEmail(sessionStorage.getItem(VENDOR_FILTER_KEY));
}

export function setGroupFilter(value = "") {
  const safe = String(value || "").trim();
  if (!safe) {
    sessionStorage.removeItem(GROUP_FILTER_KEY);
    return;
  }
  sessionStorage.setItem(GROUP_FILTER_KEY, safe);
}

export function getGroupFilter() {
  return String(sessionStorage.getItem(GROUP_FILTER_KEY) || "").trim();
}

export function clearGroupFilter() {
  sessionStorage.removeItem(GROUP_FILTER_KEY);
}

export function getVendorParts(user) {
  if (!user) return { nombre: "", apellido: "" };

  if (user.apellido) {
    return {
      nombre: normalizeText(user.nombre || ""),
      apellido: normalizeText(user.apellido || "")
    };
  }

  const fullName = normalizeText(user.nombre || "");
  if (!fullName) return { nombre: "", apellido: "" };

  const parts = fullName.split(/\s+/).filter(Boolean);

  if (parts.length === 1) {
    return { nombre: parts[0], apellido: "" };
  }

  return {
    nombre: parts[0],
    apellido: parts.slice(1).join(" ")
  };
}

export function getVendorUsers() {
  return VENTAS_USERS
    .filter((u) => u.rol === "vendedor")
    .map((u) => ({
      ...u,
      email: normalizeEmail(u.email),
      ...getVendorParts(u)
    }))
    .sort((a, b) =>
      `${a.nombre} ${a.apellido}`.localeCompare(`${b.nombre} ${b.apellido}`, "es")
    );
}
