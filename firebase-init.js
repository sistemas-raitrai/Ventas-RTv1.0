// firebase-init.js — Sistema Ventas RT (mismo Firebase que Operaciones)

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.7.3/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/11.7.3/firebase-auth.js";
import { initializeFirestore } from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = initializeFirestore(app, {
  experimentalAutoDetectLongPolling: true
});

/* =========================================================
   USUARIOS / ROLES DE VENTAS (FASE 1 SIMPLE)
   ---------------------------------------------------------
   Aquí defines quién entra al sistema de ventas y con qué rol.
   Más adelante esto lo moveremos a Firestore.
========================================================= */
export const VENTAS_USERS = [
  {
    email: "sistemas@raitrai.cl",
    nombre: "Ignacio",
    rol: "admin"
  },
  {
    email: "anamaria@raitrai.cl",
    nombre: "Ana María",
    rol: "supervision"
  },
  {
    email: "chernandez@raitrai.cl",
    nombre: "Caro Hernández",
    rol: "supervision"
  },
  {
    email: "yenny@raitrai.cl",
    nombre: "Yenny",
    rol: "supervision"
  },
  {
    email: "secretaria@raitrai.cl",
    nombre: "Andrea",
    rol: "registro"
  },
  {
    email: "elagos@raitrai.cl",
    nombre: "Elías",
    rol: "vendedor"
  }

  // 🔽 SIGUE AGREGANDO AQUÍ EL RESTO DE VENDEDORES / USUARIOS
  // ,{ email: "correo@raitrai.cl", nombre: "Nombre", rol: "vendedor" }
];

/* =========================================================
   HELPERS
========================================================= */
export function normalizeEmail(email = "") {
  return String(email || "").trim().toLowerCase();
}

export function getVentasUser(email = "") {
  const safeEmail = normalizeEmail(email);
  return VENTAS_USERS.find(u => normalizeEmail(u.email) === safeEmail) || null;
}

export function getRolVentas(email = "") {
  return getVentasUser(email)?.rol || null;
}

export function getNombreVentas(email = "") {
  return getVentasUser(email)?.nombre || "";
}

export function esAdmin(email = "") {
  return getRolVentas(email) === "admin";
}

export function esSupervisor(email = "") {
  return getRolVentas(email) === "supervision";
}

export function esVendedor(email = "") {
  return getRolVentas(email) === "vendedor";
}

export function esRegistro(email = "") {
  return getRolVentas(email) === "registro";
}

export function puedeNavegarComo(email = "") {
  return esAdmin(email) || esSupervisor(email);
}

export function puedeVerGeneral(email = "") {
  return esAdmin(email) || esSupervisor(email) || esRegistro(email);
}

export function puedeModificarVentas(email = "") {
  return esAdmin(email) || esSupervisor(email) || esVendedor(email);
}

export function puedeCrearCotizaciones(email = "") {
  return esAdmin(email) || esSupervisor(email) || esVendedor(email) || esRegistro(email);
}

/* =========================================================
   GUARDIA GLOBAL
========================================================= */
const PUBLIC_PAGES = new Set(["login.html"]);

onAuthStateChanged(auth, async (user) => {
  const currentPage = (location.pathname.split("/").pop() || "index.html").toLowerCase();

  // Si no hay usuario, solo permitimos login.html
  if (!user) {
    if (!PUBLIC_PAGES.has(currentPage)) {
      location.replace("login.html");
    }
    return;
  }

  const email = (user.email || "").toLowerCase();
  const ventasUser = getVentasUser(email);

  // Usuario logueado pero sin permiso en Ventas
  if (!ventasUser) {
    try {
      await signOut(auth);
    } catch (e) {
      console.warn("No se pudo cerrar sesión del usuario sin acceso a Ventas", e);
    }

    if (currentPage !== "login.html") {
      alert("Tu correo no tiene acceso al sistema de Ventas.");
      location.replace("login.html");
    }
    return;
  }

  // Si ya está logueado y entra a login, lo mandamos al home
  if (currentPage === "login.html") {
    location.replace("index.html");
  }
});
