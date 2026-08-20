// RENOMBRAR COMO: fichas-medicas-grupo.js

import {
  $,
  auth,
  onAuthStateChanged,
  clean,
  passengerName,
  fichaCompleta,
  medicalAlerts,
  isCancelled,
  getCurrentSystemUser,
  canViewMedicalData,
  resolveGroup,
  loadGroupInscriptions,
  renderMedicalSheet
} from "./ficha-medica-common.js";

const state = {
  group: null,
  groupDocId: "",
  groupId: "",
  items: []
};

init();

function init() {
  onAuthStateChanged(auth, async (firebaseUser) => {
    if (!firebaseUser) {
      location.href = "login.html";
      return;
    }

    const user = getCurrentSystemUser(firebaseUser);

    if (!canViewMedicalData(user)) {
      showError("No tienes permisos para acceder a información médica.");
      return;
    }

    $("btnPrint")?.addEventListener("click", () => window.print());
    $("printFilter")?.addEventListener("change", renderSheets);

    await loadPage();
  });
}

async function loadPage() {
  try {
    const params = new URLSearchParams(location.search);
    const requested = clean(params.get("id") || params.get("grupo"));

    if (!requested) throw new Error("Falta el parámetro ?id= del grupo.");

    const resolved = await resolveGroup(requested);
    if (!resolved) throw new Error("No se encontró el grupo.");

    state.group = resolved.data;
    state.groupDocId = resolved.docId;
    state.groupId = resolved.groupId;
    state.items = await loadGroupInscriptions(state.groupDocId);

    $("pageSubtitle").textContent = [
      state.group.aliasGrupo || state.group.nombreGrupo || state.groupId,
      state.group.colegio,
      state.group.curso,
      state.group.anoViaje
    ].filter(Boolean).join(" · ");

    $("btnVolver").href =
      `gestion-fichas-medicas.html?id=${encodeURIComponent(
        state.groupDocId
      )}`;
    
    $("btnResumenOperativo").href =
      `resumen-operativo-fichas-medicas.html?id=${encodeURIComponent(
        state.groupDocId
      )}`;

    $("loadingBox").classList.add("hidden");
    $("summaryPanel").classList.remove("hidden");

    renderSheets();

    if (params.get("print") === "1") {
      setTimeout(() => window.print(), 500);
    }
  } catch (error) {
    console.error(error);
    showError(error.message || "No fue posible cargar las fichas.");
  }
}

function getFilteredItems() {
  const filter = $("printFilter").value;

  if (filter === "completas") {
    return state.items.filter((item) => fichaCompleta(item) && !isCancelled(item));
  }

  if (filter === "alertas") {
    return state.items.filter((item) => medicalAlerts(item).length > 0 && !isCancelled(item));
  }

  if (filter === "todas") {
    return state.items;
  }

  return state.items.filter((item) => !isCancelled(item));
}

function renderSheets() {
  const items = getFilteredItems();

  $("summaryText").textContent = `${items.length} ficha(s) seleccionada(s). `;

  $("sheetsContainer").innerHTML = items.length
    ? items.map((item, index) => `
        ${renderMedicalSheet(state.group, item, { groupId: state.groupId })}
        ${index < items.length - 1 ? `<div class="print-page-break"></div>` : ""}
      `).join("")
    : `<section class="loading">No hay fichas para el filtro seleccionado.</section>`;

  document.title = `Fichas médicas · ${state.group.aliasGrupo || state.groupId}`;
}

function showError(message) {
  $("loadingBox").classList.add("hidden");
  $("errorBox").textContent = message;
  $("errorBox").classList.remove("hidden");
}
