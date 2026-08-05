import { auth, db, puedeVerGeneral, normalizeEmail, VENTAS_USERS, getVentasUser } from "./firebase-init.js";
import { collection, getDocs, query, where } from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.7.3/firebase-auth.js";
import { ACTING_USER_KEY, getRealUser, getEffectiveUser } from "./roles.js";
import { bindLayoutButtons, waitForLayoutReady } from "./ui.js";
import { crearInscripcionesManager, resumirNomina, exportarNominaCsv, camposPasajero } from "./inscripciones-manager.js";

const $ = id => document.getElementById(id);
const ANO_GESTION = 2026;
const state = { realUser:null, user:null, email:"", canSeeAll:false, rows:[], filtered:[], manager:null, current:null, nomina:[] };

init();
async function init(){
  await waitForLayoutReady(); bindEvents();
  onAuthStateChanged(auth, async user => {
    if(!user) return;
    await bootstrap(); bindHeader(); await cargarGrupos();
  });
}

async function bootstrap(){
  state.realUser = getRealUser(); state.user = getEffectiveUser();
  const resolved = getVentasUser(state.user?.email || state.realUser?.email || auth.currentUser?.email || "");
  if(resolved) state.user = {...state.user,...resolved};
  state.email = normalizeEmail(state.user?.email || auth.currentUser?.email || "");
  state.canSeeAll = puedeVerGeneral(state.email);
  state.manager = crearInscripcionesManager({db, usuario:state.user});
}

function bindHeader(){
  bindLayoutButtons({homeUrl:"index.html", onLogout:async()=>{sessionStorage.removeItem(ACTING_USER_KEY);await signOut(auth);location.href="login.html";},
    onActAs:async selected=>{if(state.realUser?.rol!=="admin"||!selected)return;sessionStorage.setItem(ACTING_USER_KEY,selected);await bootstrap();await cargarGrupos();},
    onResetActAs:async()=>{sessionStorage.removeItem(ACTING_USER_KEY);await bootstrap();await cargarGrupos();}});
}

function bindEvents(){
  $("gnBuscar")?.addEventListener("input", debounce(aplicarFiltros,150));
  $("gnVendedor")?.addEventListener("change", aplicarFiltros); $("gnEstado")?.addEventListener("change", aplicarFiltros);
  $("gnRecargar")?.addEventListener("click", cargarGrupos); $("modalCerrar")?.addEventListener("click", cerrarModal);
  $("gnModal")?.addEventListener("click", e=>{if(e.target===$("gnModal"))cerrarModal();});
  $("gnTbody")?.addEventListener("click", e=>{const tr=e.target.closest("tr[data-id]");if(tr)abrirGrupo(tr.dataset.id);});
  $("fasesContenedor")?.addEventListener("click", manejarFase);
  $("btnExportarCsv")?.addEventListener("click",()=>exportarNominaCsv(state.nomina,`nomina_${state.current?.groupId||"grupo"}.csv`));
  $("btnCargadoPagos")?.addEventListener("click",()=>accionSimple("cargado"));
  $("btnArchivar")?.addEventListener("click",()=>accionSimple("archivar"));
  $("btnResetear")?.addEventListener("click",()=>accionSimple("resetear"));
  $("btnAbrirGrupo")?.addEventListener("click",()=>window.open(`grupo.html?id=${encodeURIComponent(state.current?.groupId||state.current?.docId)}`,"_blank","noopener"));
}

async function cargarGrupos(){
  renderMensaje("Cargando grupos 2026...");
  try{
    const snap=await getDocs(query(collection(db,"ventas_grupos_resumen"),where("anoViaje","==",ANO_GESTION)));
    state.rows=snap.docs.map(d=>mapRow(d.id,d.data()||{})).filter(r=>r.estado==="ganada").filter(accesoRow);
    llenarVendedores(); aplicarFiltros();
  }catch(error){console.error(error);renderMensaje("No se pudieron cargar los grupos.");}
}

function mapRow(id,d){
  const resumen=d.nominaResumen||d.nomina||{};
  return {id,groupId:String(d.idGrupo||id),titulo:d.aliasGrupo||[d.colegio,d.curso].filter(Boolean).join(" ")||`Grupo ${id}`,
    colegio:d.colegio||"",curso:d.curso||"",negocio:d.numeroNegocio||d.negocioId||"",vendedora:d.vendedora||d.vendedoraCorreo||"",vendedoraCorreo:normalizeEmail(d.vendedoraCorreo||""),destino:d.destinoPrincipal||d.destino||"—",estado:normalizar(d.estado),
    total:Number(d.totalInscripciones??resumen.total??d.totalPasajeros??0),pendientes:Number(d.fichasMedicasPendientes??resumen.fichasMedicasPendientes??0),conCarnet:Number(d.conCarnet??resumen.conCarnet??0),sinCarnet:Number(d.sinCarnet??resumen.sinCarnet??0),
    linkActivo:d.inscripcionHabilitada===true||d.linkActivo===true||d.inscripcionNuevosActivo===true||d.inscripcionListaEsperaActivo===true||d.linkLiberadosActivo===true,archivada:d.nominaArchivada===true,
    search:normalizar([id,d.idGrupo,d.numeroNegocio,d.aliasGrupo,d.colegio,d.curso,d.vendedora,d.destinoPrincipal].join(" "))};
}

function accesoRow(r){if(state.canSeeAll)return true; return r.vendedoraCorreo===state.email||normalizar(r.vendedora).includes(normalizar([state.user?.nombre,state.user?.apellido].filter(Boolean).join(" ")));}
function llenarVendedores(){const s=$("gnVendedor");const vals=[...new Set(state.rows.map(r=>r.vendedora).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"es"));s.innerHTML='<option value="todos">Todos</option>'+vals.map(v=>`<option>${esc(v)}</option>`).join("");s.disabled=!state.canSeeAll;}

function aplicarFiltros(){
  const q=normalizar($("gnBuscar")?.value),v=$("gnVendedor")?.value||"todos",e=$("gnEstado")?.value||"todos";
  state.filtered=state.rows.filter(r=>(!q||r.search.includes(q))&&(v==="todos"||r.vendedora===v)&&(e==="todos"||(e==="pendiente"&&r.pendientes>0)||(e==="completa"&&r.total>0&&r.pendientes===0)||(e==="link_activo"&&r.linkActivo)||(e==="archivada"&&r.archivada))).sort((a,b)=>a.titulo.localeCompare(b.titulo,"es"));
  renderRows(); renderSummary();
}

function renderRows(){const tb=$("gnTbody");if(!state.filtered.length){renderMensaje("No hay grupos para los filtros seleccionados.");return;}tb.innerHTML=state.filtered.map(r=>`<tr data-id="${esc(r.groupId)}"><td><div class="gn-group">${esc(r.titulo)}</div><div class="gn-sub">${esc([r.colegio,r.curso].filter(Boolean).join(" · "))}</div></td><td>${esc(r.negocio||"—")}</td><td>${esc(r.vendedora||"—")}</td><td>${esc(r.destino)}</td><td>${r.total||"—"}</td><td><span class="badge ${r.pendientes>0?'warn':'ok'}">${r.pendientes}</span></td><td>${r.conCarnet}/${r.total||0}</td><td>${r.archivada?'<span class="badge muted">Archivada</span>':r.linkActivo?'<span class="badge ok">Link activo</span>':r.pendientes>0?'<span class="badge warn">Pendiente</span>':'<span class="badge ok">Completa</span>'}</td><td><button class="gn-btn">Gestionar</button></td></tr>`).join("");}
function renderMensaje(m){$("gnTbody").innerHTML=`<tr><td colspan="9" class="gn-empty">${esc(m)}</td></tr>`;}
function renderSummary(){set("sumGrupos",state.filtered.length);set("sumPax",sum("total"));set("sumPendientes",sum("pendientes"));set("sumSinCarnet",sum("sinCarnet"));set("sumLinks",state.filtered.filter(r=>r.linkActivo).length);set("sumArchivadas",state.filtered.filter(r=>r.archivada).length);}
function sum(k){return state.filtered.reduce((a,r)=>a+Number(r[k]||0),0);}

async function abrirGrupo(id){
  $("gnModal").classList.add("show");$("modalCargando").classList.remove("hidden");$("modalContenido").classList.add("hidden");
  try{
    state.current=await state.manager.resolverGrupo(id); if(!state.current)throw new Error("Grupo no encontrado.");
    const [origen,nomina]=await Promise.all([state.manager.detectarOrigenNomina(state.current),state.manager.cargarNomina(state.current)]);state.nomina=nomina;
    const fases=state.manager.obtenerEstadoFases(state.current,origen); renderModal(fases);
  }catch(error){console.error(error);$("modalCargando").textContent=error.message||"No se pudo cargar la nómina.";}
}

function renderModal(fases){const g=state.current.data,s=resumirNomina(state.nomina);$("modalTitulo").textContent=g.aliasGrupo||[g.colegio,g.curso].filter(Boolean).join(" ")||`Grupo ${state.current.groupId}`;$("modalSubtitulo").textContent=`Año ${g.anoViaje||2026} · Negocio ${g.numeroNegocio||"—"} · ${fases.origen==="sistema_pagos"?"Sistema de Pagos":"Inscripción inicial"}`;
  [["kTotal",s.total],["kActivos",s.activos],["kAnulados",s.anulados],["kCompleta",s.fichaCompleta],["kPendiente",s.fichaPendiente],["kCarnet",s.conCarnet],["kSinCarnet",s.sinCarnet]].forEach(([i,v])=>set(i,v));
  $("fasesContenedor").innerHTML=[fases.principal,fases.nuevos,fases.listaEspera,fases.liberados].map(renderFase).join("");renderPasajeros();
  $("btnCargadoPagos").textContent=g.nominaCargadaPagos?"Quitar cargado a pagos":"Marcar cargado a pagos";$("btnArchivar").textContent=g.nominaArchivada?"Desarchivar nómina":"Archivar nómina";
  $("btnResetear").classList.toggle("hidden",!state.manager.esAdminOSupervision());
  $("modalCargando").classList.add("hidden");$("modalContenido").classList.remove("hidden");
}
function renderFase(f){return `<div class="gn-fase"><h4>${esc(f.label)}</h4><div class="gn-sub">${f.activo?'Abierta':'Cerrada'}</div><div class="gn-actions">${f.activo?`<button class="gn-btn ok" data-action="copiar" data-fase="${f.clave}" data-link="${esc(f.link)}">Copiar link</button><button class="gn-btn danger" data-action="cerrar" data-fase="${f.clave}">Cerrar</button>`:`<button class="gn-btn" data-action="abrir" data-fase="${f.clave}">Abrir</button>`}</div></div>`;}
function renderPasajeros(){const f=camposPasajero;$("pasajerosTbody").innerHTML=state.nomina.length?state.nomina.map(i=>`<tr><td>${esc(f.documento(i)||"—")}</td><td>${esc(f.nombres(i)||"—")}</td><td>${esc(f.apellidos(i)||"—")}</td><td>${esc(f.tipo(i)||"—")}</td><td>${esc(f.estado(i)||"—")}</td><td><span class="badge ${f.fichaCompleta(i)?'ok':'warn'}">${f.fichaCompleta(i)?'Completa':'Pendiente'}</span></td><td>${f.estaAnulada(i)?'Sí':'No'}</td><td>${esc(f.correo(i)||"—")}</td><td>${esc(f.telefono(i)||"—")}</td><td>${f.tieneCarnet(i)?'Sí':'No'}</td></tr>`).join(""):'<tr><td colspan="10" class="gn-empty">No hay pasajeros.</td></tr>';}

async function manejarFase(e){const b=e.target.closest("button[data-action]");if(!b)return;try{b.disabled=true;if(b.dataset.action==="copiar"){const link=b.dataset.link;if(!link)throw new Error("La fase no tiene link guardado.");await navigator.clipboard.writeText(link);alert("Link copiado.");return;}if(b.dataset.action==="abrir"){let polera=null;if(["inscripcion_inicial","nomina_final"].includes(b.dataset.fase))polera=confirm("¿Este grupo incluye polera?\nAceptar = Sí / Cancelar = No");await state.manager.abrirFase(state.current,b.dataset.fase,{tienePolera:polera});}else if(b.dataset.action==="cerrar"){if(!confirm("¿Cerrar este link?"))return;await state.manager.cerrarFase(state.current,b.dataset.fase);}await refrescarModal();}catch(error){alert(error.message||"No se pudo completar la acción.");}finally{b.disabled=false;}}

async function accionSimple(tipo){try{if(tipo==="cargado"){await state.manager.marcarCargadoPagos(state.current,state.current.data.nominaCargadaPagos!==true);}if(tipo==="archivar"){await state.manager.archivarNomina(state.current,state.current.data.nominaArchivada!==true);}if(tipo==="resetear"){if(!confirm("Esto cerrará y limpiará todos los links del ciclo. ¿Continuar?"))return;await state.manager.resetearCiclo(state.current);}await refrescarModal();await cargarGrupos();}catch(error){alert(error.message||"No se pudo completar la acción.");}}
async function refrescarModal(){state.current=await state.manager.recargarGrupo(state.current);const origen=await state.manager.detectarOrigenNomina(state.current);state.nomina=await state.manager.cargarNomina(state.current);renderModal(state.manager.obtenerEstadoFases(state.current,origen));}
function cerrarModal(){$("gnModal").classList.remove("show");state.current=null;state.nomina=[];}
function set(id,v){const e=$(id);if(e)e.textContent=String(v??"");}function esc(v){return String(v??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;");}function normalizar(v){return String(v??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();}function debounce(fn,w){let t;return(...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),w);};}
