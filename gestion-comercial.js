import { collection, doc, getDoc, getDocs, writeBatch, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";

export function fechaGestion(value) {
if (!value) return null;
if (value.toDate) return value.toDate();
if (value instanceof Date) return value;
const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? ${value}T12:00:00 : value);
return Number.isNaN(d.getTime()) ? null : d;
}
export function esGestionComercial(item = {}) {
if (item.esGestionComercial === true || item.tipoMovimiento === "gestion_comercial") return true;
// Compatibilidad con el formulario anterior de Cartera. No incluir Edición/Creación.
return ["Seguimiento comercial", "Seguimiento / visita"].includes(item.tipo) &&
!!(item.metadata?.fechaGestion || item.metadata?.fechaVisita);
}
export function fechaEventoGestion(item = {}) {
return fechaGestion(item.fechaGestion || item.metadata?.fechaGestion || item.metadata?.fechaVisita || item.fecha);
}
export function gestionEn30Dias(item = {}, ahora = new Date()) {
const d = fechaEventoGestion(item);
const inicio = new Date(ahora); inicio.setHours(0, 0, 0, 0); inicio.setDate(inicio.getDate() - 29);
const fin = new Date(ahora); fin.setHours(23, 59, 59, 999);
return !!d && d >= inicio && d <= fin;
}
const texto = v => String(v ?? "").trim();
const email = v => texto(v).toLowerCase();
const normal = v => texto(v).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ");
function hoy() {
const d = new Date();
return ${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")};
}

// Un mismo formulario para Colegio y Grupo. No envía correos: registra el contacto realizado.
export function abrirRegistroGestion({ db, usuario, usuarioReal, puedeGuardar, colegio = null, grupo = null, onSaved }) {
if (!puedeGuardar()) { alert("No tienes permisos para registrar esta gestión."); return; }
if (document.getElementById("registroGestionComercial")) return;
const dialog = document.createElement("dialog");
dialog.id = "registroGestionComercial";
dialog.style.cssText = "width(560px,90vw);border:1px solid #ddd;border-radius:14px;padding:24px";
dialog.innerHTML = 
    <form style="display:grid;gap:12px">
      <h2 style="margin:0">Registrar gestión</h2>
      <p data-contexto style="margin:0"></p>
      <fieldset data-vinculo style="display:grid;gap:10px">
        <legend>Colegio de la cartera</legend>
        <label>Correo del vendedor de la cartera
          <input name="vendedor" type="email" style="display:block;width:95%">
        </label>
        <button type="button" data-cargar>Cargar colegios</button>
        <label>Colegio <select name="colegio" style="display:block;width:100%"></select></label>
        <small>Confirma el colegio. La gestión del grupo contará para este colegio.</small>
      </fieldset>
      <label>Tipo <select name="tipo" required style="display:block;width:100%">
        <option value="">Seleccionar</option><option>LLAMADA</option><option>CORREO</option>
        <option>VISITA</option><option>REUNIÓN</option><option>WHATSAPP</option><option>OTRO</option>
      </select></label>
      <label>Fecha de la gestión <input name="fecha" type="date" required></label>
      <label>Asunto <input name="asunto" required maxlength="200" style="display:block;width:95%"></label>
      <label>Detalle <textarea name="detalle" required rows="4" maxlength="10000" style="display:block;width:95%"></textarea></label>
      <p data-error role="alert" style="color:#a21b1b;margin:0"></p>
      <div><button type="submit">Guardar gestión</button> <button type="button" data-cerrar>Cancelar</button></div>
    </form>;
const form = dialog.querySelector("form");
const campo = name => form.elements.namedItem(name);
const errorEl = dialog.querySelector("[data-error]");
let saving = false;
let opciones = [];
const cerrar = () => { if (!saving) { dialog.close(); dialog.remove(); } };
dialog.querySelector("[data-cerrar]").onclick = cerrar;
dialog.addEventListener("cancel", e => { e.preventDefault(); cerrar(); });
dialog.querySelector("[data-contexto]").textContent = grupo
? Grupo: ${grupo.data.aliasGrupo || grupo.data.colegio || grupo.id}
: Colegio: ${colegio.colegio || colegio.numeroColegio};
campo("fecha").value = hoy(); campo("fecha").max = hoy();
const enlace = grupo?.data?.carteraVinculo;
campo("vendedor").value = enlace?.correoVendedor || grupo?.data?.vendedoraCorreo || "";
dialog.querySelector("[data-vinculo]").hidden = !grupo;
async function cargar() {
errorEl.textContent = "";
const vendedor = email(campo("vendedor").value);
opciones = []; campo("colegio").replaceChildren(new Option("Seleccionar colegio", ""));
if (!vendedor || vendedor.includes("/")) { errorEl.textContent = "Indica el correo del vendedor de la cartera."; return; }
try {
const snap = await getDocs(collection(db, "ventas_cartera", vendedor, "items"));
opciones = snap.docs.map(d => ({...d.data(), numeroColegio.id, correoVendedor}));
opciones.sort((a,b) => texto(a.colegio).localeCompare(texto(b.colegio)));
opciones.forEach((r,i) => campo("colegio").add(new Option(${r.colegio || r.numeroColegio} · ${r.comuna || ""} · N° ${r.numeroColegio}, String(i))));
let indice = opciones.findIndex(r => enlace && email(enlace.correoVendedor) === vendedor && String(enlace.numeroColegio) === r.numeroColegio);
if (indice < 0) {
const matches = opciones.map((r,i)=>({r,i})).filter(({r})=>normal(r.colegio)===normal(grupo?.data.colegio) && (!r.comuna || !grupo?.data.comunaCiudad || normal(r.comuna)===normal(grupo.data.comunaCiudad)));
if (matches.length === 1) indice = matches[0].i;
}
if (indice >= 0) campo("colegio").value = String(indice);
if (!opciones.length) errorEl.textContent = "No hay colegios en esta cartera. Revisa el correo.";
} catch(e) { errorEl.textContent = e.message; }
}
dialog.querySelector("[data-cargar]").onclick = cargar;
campo("vendedor").oninput = () => { opciones=[]; campo("colegio").replaceChildren(new Option("Carga los colegios de este vendedor", "")); };
form.onsubmit = async e => {
e.preventDefault(); if (saving) return;
errorEl.textContent = "";
if (!puedeGuardar()) { errorEl.textContent="No tienes permisos."; return; }
const selected = campo("colegio").value;
const destino = grupo ? (selected === "" ? null : opciones[Number(selected)]) : colegio;
if (!destino) { errorEl.textContent="Selecciona el colegio de la cartera."; return; }
const fecha = campo("fecha").value;
if (!fechaGestion(fecha) || fecha > hoy() || !texto(campo("asunto").value) || !texto(campo("detalle").value)) {
errorEl.textContent="Completa asunto, detalle y una fecha que no sea futura."; return;
}
saving=true;
form.querySelectorAll("button, input, select, textarea").forEach(el=>el.disabled=true);
try {
const base = doc(db,"ventas_cartera",email(destino.correoVendedor),"items",String(destino.numeroColegio));
if (!(await getDoc(base)).exists()) throw new Error("El colegio ya no existe en esa cartera.");
const historyRef=doc(collection(base,"historial"));
const autor=texto(usuario?.nombre || usuario?.name || usuario?.email);
const data={
esGestionComercial, tipoMovimiento:"gestion_comercial",
tipo("tipo").value, fechaGestion,
asunto(campo("asunto").value), mensaje(campo("detalle").value),
origen ? "grupo" : "cartera", gestionId.id,
hechoPor, hechoPorCorreo(usuarioReal?.email || usuario?.email),
fecha(),
metadata:{fechaGestion, origen ? "grupo" : "cartera", idGrupo ? String(grupo.id) : "", aliasGrupo ? texto(grupo.data.aliasGrupo || grupo.data.colegio) : ""}
};
const batch=writeBatch(db);
batch.set(historyRef,data);
if(grupo) {
const titulo=Gestión comercial · ${data.tipo};
batch.set(doc(db,"ventas_historial",historyRef.id),{
...data, idGrupo(grupo.id), colegio(grupo.data.colegio),
codigoRegistro(grupo.data.codigoRegistro), aliasGrupo(grupo.data.aliasGrupo),
modulo:"gestion_comercial", titulo,
asunto:${data.asunto} · ${fecha}, cambios:[],
creadoPor, creadoPorCorreo(usuario?.email),
destacado, oculto
});
batch.set(doc(db,"ventas_cotizaciones",grupo.docId),{
carteraVinculo:{correoVendedor(destino.correoVendedor),numeroColegio(destino.numeroColegio)}
},{merge});
}
await batch.commit();
} catch(err) {
errorEl.textContent=No se guardó la gestión: ${err.message};
saving=false;
form.querySelectorAll("button, input, select, textarea").forEach(el=>el.disabled=false);
return;
}
saving=false; cerrar();
try { await onSaved?.(); } catch(err) { alert(La gestión quedó guardada. Recarga la página para actualizar la vista: ${err.message}); }
};
document.body.append(dialog); dialog.showModal();
if (grupo && campo("vendedor").value) void cargar();
}

