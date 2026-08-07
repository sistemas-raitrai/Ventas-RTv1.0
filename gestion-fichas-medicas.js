// RENOMBRAR COMO: gestion-fichas-medicas.js

import {
  $,
  auth,
  db,
  onAuthStateChanged,
  doc,
  updateDoc,
  collection,
  addDoc,
  serverTimestamp,
  clean,
  normalize,
  escapeHtml,
  getByPath,
  formatDate,
  passengerName,
  passengerDocument,
  fichaCompleta,
  medicalAlerts,
  isCancelled,
  getCurrentSystemUser,
  canViewMedicalData,
  canEditMedicalData,
  resolveGroup,
  loadGroupInscriptions,
  EDIT_FIELDS
} from "./ficha-medica-common.js";

const state = {
  groupDocId: "",
  groupId: "",
  group: null,
  items: [],
  user: null,
  editingId: ""
};

init();

function init() {
  onAuthStateChanged(auth, async (firebaseUser) => {
    if (!firebaseUser) {
      location.href = "login.html";
      return;
    }

    state.user = getCurrentSystemUser(firebaseUser);

    if (!canViewMedicalData(state.user)) {
      showError("No tienes permisos para acceder a información médica.");
      return;
    }

    bindEvents();
    await loadPage();
  });
}

function bindEvents() {
  if (document.body.dataset.bound === "1") return;
  document.body.dataset.bound = "1";

  $("btnRecargar")?.addEventListener("click", loadPage);
  $("searchInput")?.addEventListener("input", renderTable);
  $("statusFilter")?.addEventListener("change", renderTable);
  $("typeFilter")?.addEventListener("change", renderTable);
  $("tableBody")?.addEventListener("click", onTableClick);
  $("btnCloseModal")?.addEventListener("click", closeModal);
  $("btnCancelEdit")?.addEventListener("click", closeModal);
  $("editForm")?.addEventListener("submit", saveEdit);
  $("editModal")?.addEventListener("click", (event) => {
    if (event.target?.id === "editModal") closeModal();
  });
}

async function loadPage() {
  showLoading(true);

  try {
    const params = new URLSearchParams(location.search);
    const requested = clean(params.get("id") || params.get("grupo"));

    if (!requested) throw new Error("Falta el parámetro ?id= del grupo.");

    const resolved = await resolveGroup(requested);
    if (!resolved) throw new Error(`No se encontró el grupo ${requested}.`);

    state.groupDocId = resolved.docId;
    state.groupId = resolved.groupId;
    state.group = resolved.data;
    state.items = await loadGroupInscriptions(state.groupDocId);

    $("groupSubtitle").textContent = [
      state.group.aliasGrupo || state.group.nombreGrupo || state.groupId,
      state.group.colegio,
      state.group.curso,
      state.group.anoViaje
    ].filter(Boolean).join(" · ");

    $("btnVolverNomina").href = `gestion-nomina.html?id=${encodeURIComponent(state.groupDocId)}`;
    $("btnVerGrupo").href = `fichas-medicas-grupo.html?id=${encodeURIComponent(state.groupDocId)}`;

    renderKpis();
    renderTypeOptions();
    renderTable();

    $("content").classList.remove("hidden");
  } catch (error) {
    console.error(error);
    showError(error.message || "No fue posible cargar las fichas.");
  } finally {
    showLoading(false);
  }
}

function renderKpis() {
  $("kpiTotal").textContent = state.items.length;
  $("kpiCompletas").textContent = state.items.filter(fichaCompleta).length;
  $("kpiPendientes").textContent = state.items.filter((item) => !fichaCompleta(item) && !isCancelled(item)).length;
  $("kpiAlertas").textContent = state.items.filter((item) => medicalAlerts(item).length > 0 && !isCancelled(item)).length;
  $("kpiAnulados").textContent = state.items.filter(isCancelled).length;
}

function renderTypeOptions() {
  const values = [...new Set(
    state.items.map((item) => clean(item.tipoInscripcion || item.tipoViajante)).filter(Boolean)
  )].sort((a, b) => a.localeCompare(b, "es"));

  $("typeFilter").innerHTML = `
    <option value="">Todos los tipos</option>
    ${values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("")}
  `;
}

function getFilteredItems() {
  const search = normalize($("searchInput")?.value);
  const status = normalize($("statusFilter")?.value);
  const type = clean($("typeFilter")?.value);

  return state.items.filter((item) => {
    const searchable = normalize([
      passengerName(item),
      passengerDocument(item),
      item?.contactoPrincipal?.nombre,
      item?.contactoPrincipal?.correo,
      item?.contactoPrincipal?.telefono,
      item?.identificacion?.correoViajante,
      item?.identificacion?.telefonoViajante
    ].join(" "));

    if (search && !searchable.includes(search)) return false;
    if (type && clean(item.tipoInscripcion || item.tipoViajante) !== type) return false;

    if (status === "completa" && !fichaCompleta(item)) return false;
    if (status === "pendiente" && (fichaCompleta(item) || isCancelled(item))) return false;
    if (status === "alerta" && !medicalAlerts(item).length) return false;
    if (status === "anulado" && !isCancelled(item)) return false;

    return true;
  });
}

function renderTable() {
  const rows = getFilteredItems();

  $("tableBody").innerHTML = rows.length
    ? rows.map((item, index) => {
        const alerts = medicalAlerts(item);
        const statusClass = isCancelled(item)
          ? "status-cancelled"
          : fichaCompleta(item)
            ? "status-complete"
            : "status-pending";

        const statusText = isCancelled(item)
          ? "Anulado"
          : fichaCompleta(item)
            ? "Completa"
            : "Pendiente";

        return `
          <tr>
            <td>${index + 1}</td>
            <td><strong>${escapeHtml(passengerName(item))}</strong></td>
            <td>${escapeHtml(passengerDocument(item))}</td>
            <td>${escapeHtml(item.tipoInscripcion || item.tipoViajante || "—")}</td>
            <td><span class="status ${statusClass}">${statusText}</span></td>
            <td>
              ${alerts.length
                ? alerts.map((alert) => `<span class="alert-chip">${escapeHtml(alert)}</span>`).join("")
                : `<span class="no-alerts">Sin alertas</span>`}
            </td>
            <td>
              ${escapeHtml(item?.contactoPrincipal?.nombre || "—")}<br>
              <small>${escapeHtml(item?.contactoPrincipal?.correo || "")}</small>
            </td>
            <td>${escapeHtml(formatDate(
              item?.auditoriaFichaMedica?.actualizadoAt ||
              item?.meta?.fechaFormularioCliente ||
              item?.meta?.fechaInscripcion
            ))}</td>
            <td>
              <div class="actions">
                <button class="btn-light" type="button" data-view="${escapeHtml(item.id)}">Ver</button>
                <button class="btn-yellow" type="button" data-print="${escapeHtml(item.id)}">PDF</button>
                ${canEditMedicalData(state.user)
                  ? `<button class="btn-primary" type="button" data-edit="${escapeHtml(item.id)}">Editar</button>`
                  : ""}
              </div>
            </td>
          </tr>
        `;
      }).join("")
    : `<tr><td colspan="9">No hay pasajeros que coincidan con los filtros.</td></tr>`;
}

function onTableClick(event) {
  const viewId = event.target.closest("[data-view]")?.dataset.view;
  const printId = event.target.closest("[data-print]")?.dataset.print;
  const editId = event.target.closest("[data-edit]")?.dataset.edit;

  if (viewId) {
    location.href = `ficha-medica.html?grupo=${encodeURIComponent(state.groupDocId)}&id=${encodeURIComponent(viewId)}`;
    return;
  }

  if (printId) {
    location.href = `ficha-medica.html?grupo=${encodeURIComponent(state.groupDocId)}&id=${encodeURIComponent(printId)}&print=1`;
    return;
  }

  if (editId) openEdit(editId);
}

function openEdit(id) {
  if (!canEditMedicalData(state.user)) {
    alert("No tienes permisos para editar fichas médicas.");
    return;
  }

  const item = state.items.find((row) => row.id === id);
  if (!item) return;

  state.editingId = id;
  $("editTitle").textContent = `Editar ficha · ${passengerName(item)}`;
  $("editReason").value = "";

  const sections = [...new Set(EDIT_FIELDS.map((field) => field.section))];

  $("editFields").innerHTML = sections.map((sectionName) => {
    const fields = EDIT_FIELDS.filter((field) => field.section === sectionName);

    return `
      <section class="edit-section">
        <h3>${escapeHtml(sectionName)}</h3>
        <div class="edit-grid">
          ${fields.map((field) => renderInput(field, getByPath(item, field.path))).join("")}
        </div>
      </section>
    `;
  }).join("");

  $("editModal").classList.remove("hidden");
}

function renderInput(field, value) {
  const serialized = field.type === "array"
    ? (Array.isArray(value) ? value.join(", ") : clean(value))
    : clean(value);

  const wideClass = field.type === "textarea" ? "is-wide" : "";

  if (field.type === "textarea") {
    return `
      <div class="field ${wideClass}">
        <label>${escapeHtml(field.label)}</label>
        <textarea data-edit-path="${escapeHtml(field.path)}" data-edit-type="text">${escapeHtml(serialized)}</textarea>
      </div>
    `;
  }

  return `
    <div class="field ${wideClass}">
      <label>${escapeHtml(field.label)}</label>
      <input
        type="${escapeHtml(field.type === "array" ? "text" : field.type || "text")}"
        value="${escapeHtml(serialized)}"
        data-edit-path="${escapeHtml(field.path)}"
        data-edit-type="${escapeHtml(field.type || "text")}"
      >
    </div>
  `;
}

async function saveEdit(event) {
  event.preventDefault();

  if (!state.editingId || !canEditMedicalData(state.user)) return;

  const reason = clean($("editReason").value);
  if (!reason) {
    alert("Debes indicar el motivo de la corrección.");
    return;
  }

  const item = state.items.find((row) => row.id === state.editingId);
  if (!item) return;

  const patch = {};
  const cambios = [];

  document.querySelectorAll("[data-edit-path]").forEach((input) => {
    const path = input.dataset.editPath;
    const type = input.dataset.editType;
    const oldValue = getByPath(item, path);
    const newValue = type === "array"
      ? clean(input.value).split(",").map(clean).filter(Boolean)
      : clean(input.value);

    if (JSON.stringify(oldValue ?? "") !== JSON.stringify(newValue)) {
      patch[path] = newValue;
      cambios.push({
        campo: path,
        anterior: oldValue ?? "",
        nuevo: newValue
      });
    }
  });

  if (!cambios.length) {
    alert("No hay cambios para guardar.");
    return;
  }

  // Mantiene nombreCompleto consistente cuando cambian nombres o apellidos.
  const nombres = patch["identificacion.nombres"] ?? item?.identificacion?.nombres ?? "";
  const apellido1 = patch["identificacion.primerApellido"] ?? item?.identificacion?.primerApellido ?? "";
  const apellido2 = patch["identificacion.segundoApellido"] ?? item?.identificacion?.segundoApellido ?? "";
  patch["identificacion.nombreCompleto"] = [nombres, apellido1, apellido2].filter(Boolean).join(" ");

  patch["auditoriaFichaMedica.actualizadoAt"] = serverTimestamp();
  patch["auditoriaFichaMedica.actualizadoPor"] = state.user.nombre;
  patch["auditoriaFichaMedica.actualizadoPorCorreo"] = state.user.email;
  patch["auditoriaFichaMedica.motivoUltimoCambio"] = reason;
  patch["auditoriaFichaMedica.version"] = Number(item?.auditoriaFichaMedica?.version || 0) + 1;

  const button = $("btnSaveEdit");
  button.disabled = true;
  button.textContent = "Guardando...";

  try {
    const inscriptionRef = doc(
      db,
      "ventas_cotizaciones",
      state.groupDocId,
      "inscripciones",
      state.editingId
    );

    await updateDoc(inscriptionRef, patch);

    await addDoc(collection(inscriptionRef, "historial_ficha"), {
      fecha: serverTimestamp(),
      usuarioNombre: state.user.nombre,
      usuarioCorreo: state.user.email,
      motivo: reason,
      cambios,
      origen: "gestion_fichas_medicas"
    });

    closeModal();
    await loadPage();
    alert("Ficha médica actualizada correctamente.");
  } catch (error) {
    console.error(error);
    alert(`No fue posible guardar: ${error.message || "Error desconocido"}`);
  } finally {
    button.disabled = false;
    button.textContent = "Guardar cambios";
  }
}

function closeModal() {
  state.editingId = "";
  $("editModal").classList.add("hidden");
}

function showLoading(show) {
  $("loadingBox").classList.toggle("hidden", !show);
}

function showError(message) {
  $("errorBox").textContent = message;
  $("errorBox").classList.remove("hidden");
  $("content").classList.add("hidden");
}
