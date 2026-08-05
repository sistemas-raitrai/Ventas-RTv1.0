// RENOMBRAR COMO: ficha-medica.js

import {
  $,
  auth,
  onAuthStateChanged,
  clean,
  passengerName,
  passengerDocument,
  getCurrentSystemUser,
  canViewMedicalData,
  resolveGroup,
  loadInscription,
  renderMedicalSheet
} from "./ficha-medica-common.js";

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
    await loadPage();
  });
}

async function loadPage() {
  try {
    const params = new URLSearchParams(location.search);
    const groupParam = clean(params.get("grupo") || params.get("group"));
    const inscriptionId = clean(params.get("id") || params.get("rut"));

    if (!groupParam || !inscriptionId) {
      throw new Error("La URL debe incluir ?grupo=ID_GRUPO&id=ID_INSCRIPCION.");
    }

    const resolved = await resolveGroup(groupParam);
    if (!resolved) throw new Error("No se encontró el grupo.");

    const item = await loadInscription(resolved.docId, inscriptionId);
    if (!item) throw new Error("No se encontró la ficha del pasajero.");

    document.title = `Ficha médica · ${passengerDocument(item)}`;
    $("pageSubtitle").textContent = passengerName(item);
    $("btnVolver").href = `gestion-fichas-medicas.html?id=${encodeURIComponent(resolved.docId)}`;

    $("sheetContainer").innerHTML = renderMedicalSheet(
      resolved.data,
      item,
      { groupId: resolved.groupId }
    );

    $("loadingBox").classList.add("hidden");

    if (params.get("print") === "1") {
      setTimeout(() => window.print(), 350);
    }
  } catch (error) {
    console.error(error);
    showError(error.message || "No fue posible cargar la ficha.");
  }
}

function showError(message) {
  $("loadingBox").classList.add("hidden");
  $("errorBox").textContent = message;
  $("errorBox").classList.remove("hidden");
}
