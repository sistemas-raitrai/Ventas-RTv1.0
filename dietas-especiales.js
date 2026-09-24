import {
  auth, db, onAuthStateChanged, collection, clean, escapeHtml,
  getCurrentSystemUser, canViewMedicalData, loadGroupInscriptions,
  passengerName, isCancelled
} from './ficha-medica-common.js';
import { getDocs, getDoc, doc, query, where } from 'https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js';

const $ = id => document.getElementById(id);
const estado = { filas: [], filtradas: [], incidencias: [], cargando: false };
const DESTINOS_SERVICIOS = ['BRASIL', 'BARILOCHE', 'SUR DE CHILE', 'NORTE DE CHILE'];

function normalizar(v) {
  return String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase().replace(/\s+/g, ' ').trim();
}
function fechaISO(v) {
  if (!v) return '';
  if (typeof v === 'string') {
    const iso = v.match(/^(\d{4}-\d{2}-\d{2})/);
    if (iso) return iso[1];
    const lat = v.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
    if (lat) return `${lat[3]}-${lat[2].padStart(2,'0')}-${lat[1].padStart(2,'0')}`;
  }
  const d = v?.toDate?.() || v;
  return d instanceof Date && !Number.isNaN(d.getTime())
    ? `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` : '';
}
function fechaVisible(iso) { return iso ? iso.split('-').reverse().join('-') : 'Sin fecha'; }
function numerosNegocio(g = {}) { return String(g.numeroNegocio ?? g.negocioId ?? '').trim(); }
function destinosDeGrupo(g = {}) {
  const s = normalizar([g.destinoPrincipal, g.destino].filter(Boolean).join(' '));
  if (s.includes('BRASIL')) return ['BRASIL'];
  if (s.includes('BARILOCHE') && s.includes('SUR DE CHILE')) return ['BARILOCHE','SUR DE CHILE'];
  return DESTINOS_SERVICIOS.filter(d => s.includes(d));
}
function datosAlimentacion(items) {
  return items.filter(i => !isCancelled(i)).map(i => {
    const s = i.salud || {};
    const tipos = Array.isArray(s.dietaTipos) ? s.dietaTipos.map(clean).filter(Boolean) : [];
    const restricciones = Array.isArray(s.dietaRestricciones) ? s.dietaRestricciones.map(clean).filter(Boolean) : [];
    const alergias = Array.isArray(s.alergiasAlimentarias)
      ? s.alergiasAlimentarias.map(a => clean(typeof a === 'string' ? a : a?.alimento || a?.detalle)).filter(Boolean) : [];
    const detalle = clean(s.dietaDetalle);
    const informada = normalizar(s.dietaFlag) === 'SI' || tipos.length || restricciones.length || alergias.length || detalle;
    return informada ? {
      id: i.id || '', nombre: clean(passengerName(i)) || 'Nombre no registrado',
      tipos, restricciones, alergias, detalle,
      pendiente: !tipos.length && !restricciones.length && !alergias.length && !detalle
    } : null;
  }).filter(Boolean).sort((a,b) => a.nombre.localeCompare(b.nombre,'es',{sensitivity:'base'}));
}
function resumenPersonas(personas) {
  const tipos = new Map();
  for (const p of personas) for (const t of p.tipos) tipos.set(t,(tipos.get(t)||0)+1);
  return [...tipos].map(([t,n]) => `${t}: ${n}`).join(' · ') || 'Ver detalle';
}
function itemHotel(h) {
  const nombre = clean(h.hotelNombre || h.nombre || h.hotel?.nombre);
  const desde = fechaISO(h.checkIn);
  const hasta = fechaISO(h.checkOut);
  return nombre ? { nombre, desde, hasta, id: String(h.hotelId || h.id || normalizar(nombre)) } : null;
}
function esComida(nombre, dato = {}) {
  const texto = normalizar(nombre);
  const clase = normalizar(dato.tipoComida || dato.comidaIncluida || '');
  if (/\bALMUERZO\b/.test(texto) || clase.includes('ALMUERZO')) return 'Almuerzo';
  if (/\bCENA\b/.test(texto) || clase.includes('CENA')) return 'Cena';
  if (/\bDESAYUNO\b/.test(texto) || clase.includes('DESAYUNO')) return 'Desayuno';
  return '';
}
async function cargarCatalogo(ano) {
  const mapa = new Map();
  for (const destino of DESTINOS_SERVICIOS) {
    const snap = await getDocs(collection(db,'ServiciosPorAno',String(ano),'Destinos',destino,'Listado'));
    for (const d of snap.docs) {
      const x = d.data() || {};
      const nombre = clean(x.servicio || d.id);
      mapa.set(`${destino}|${normalizar(nombre)}`, {
        nombre, destino, proveedor: clean(x.proveedor || x.Proveedor) || 'Proveedor no identificado',
        comida: esComida(nombre,x)
      });
    }
  }
  return mapa;
}
function claveGrupoCalendario(g) {
  return String(g.numeroNegocio || '').trim();
}
function filtrarFilas() {
  const desde = $('deDesde').value, hasta = $('deHasta').value;
  if (desde && hasta && desde > hasta) throw new Error('La fecha desde es posterior a la fecha hasta.');
  const grupo = $('deGrupo').value, hotel = $('deHotel').value;
  const proveedor = $('deProveedor').value, tipo = $('deTipo').value;
  return estado.filas.filter(r => {
    if (grupo && r.idGrupo !== grupo) return false;
    if (hotel && !(r.tipo === 'hotel' && r.entidadId === hotel)) return false;
    if (proveedor && !(r.tipo === 'servicio' && r.proveedor === proveedor)) return false;
    if (tipo && r.tipo !== tipo) return false;
    if (desde && (!(r.fechaFin || r.fecha) || (r.fechaFin || r.fecha) < desde)) return false;
    if (hasta && (!r.fecha || r.fecha > hasta)) return false;
    return true;
  }).sort((a,b) => (a.fecha||'9999').localeCompare(b.fecha||'9999') || a.grupo.localeCompare(b.grupo,'es'));
}
function llenarSelect(id, values, nombreTodos) {
  const el = $(id), anterior = el.value;
  el.replaceChildren(new Option(nombreTodos,''),...values.map(v => new Option(v.label,v.value)));
  if (values.some(v => v.value === anterior)) el.value = anterior;
}
async function cargar() {
  if (estado.cargando) return;
  estado.cargando = true; estado.filas = []; estado.filtradas = []; estado.incidencias = [];
  $('deResultados').hidden = true; $('deImprimir').disabled = true; $('deCargar').disabled = true;
  const ano = Number($('deAno').value);
  try {
    $('deEstado').textContent = `Cargando grupos ${ano}…`;
    const [res, cal, catalogo] = await Promise.all([
      getDocs(query(collection(db,'ventas_grupos_resumen'),where('anoViaje','==',ano))),
      getDocs(collection(db,'operaciones_calendario_resumen')),
      cargarCatalogo(ano)
    ]);
    const resumenes = res.docs.filter(d => normalizar(d.data().estado || d.data().estadoComercial) === 'GANADA');
    const calendario = new Map();
    for (const d of cal.docs) {
      const g = d.data() || {};
      if (String(g.anoViaje || '') !== String(ano)) continue;
      const n = claveGrupoCalendario(g);
      if (n) calendario.set(n,g);
    }
    const filas = [];
    for (let i=0;i<resumenes.length;i+=5) {
      const lote = await Promise.all(resumenes.slice(i,i+5).map(async d => {
        const x = d.data() || {}, docId = String(x.groupDocId || d.id);
        const ref = await getDoc(doc(db,'ventas_cotizaciones',docId));
        if (!ref.exists()) throw new Error(`Falta grupo de Ventas ${docId}`);
        const g = ref.data() || {}, negocio = numerosNegocio(g) || numerosNegocio(x);
        if (!negocio) { estado.incidencias.push(`Grupo ${docId} sin N.º de negocio`); return []; }
        const c = calendario.get(negocio);
        if (!c) { estado.incidencias.push(`Negocio ${negocio} sin calendario operativo`); return []; }
        const inscripciones = await loadGroupInscriptions(docId);
        const personas = datosAlimentacion(inscripciones);
        if (!personas.length) return [];
        const nombre = clean(x.aliasGrupo || g.aliasGrupo || g.nombreGrupo || c.aliasGrupo || negocio);
        const base = { idGrupo:docId, negocio, grupo:nombre, personas, destino:clean(c.destino || g.destino) };
        const out = [];
        for (const raw of (Array.isArray(c.hoteles) ? c.hoteles : [])) {
          const h = itemHotel(raw); if (!h) continue;
          out.push({...base,tipo:'hotel',entidad:h.nombre,entidadId:h.id,proveedor:h.nombre,
            fecha:h.desde,fechaFin:h.hasta});
        }
        for (const [dia,actividades] of Object.entries(c.itinerario || {})) {
          if (!Array.isArray(actividades)) continue;
          for (const actividad of actividades) {
            const nombreActividad = clean(actividad?.actividad);
            const coincidencias = destinosDeGrupo({...g,...c}).map(dest => catalogo.get(`${dest}|${normalizar(nombreActividad)}`)).filter(Boolean);
            const unicas = [...new Map(coincidencias.map(s=>[`${s.destino}|${normalizar(s.nombre)}`,s])).values()];
            if (unicas.length > 1) { estado.incidencias.push(`${negocio} · ${dia}: servicio ambiguo ${nombreActividad}`); continue; }
            const servicio = unicas[0];
            if (!servicio) {
              if (/ALMUERZO|CENA|DESAYUNO|TOM WESLEY|BETO CARRERO/i.test(normalizar(nombreActividad)))
                estado.incidencias.push(`${negocio} · ${dia}: comida sin servicio asociado: ${nombreActividad}`);
              continue;
            }
            if (!servicio.comida) {
              if (/TOM WESLEY|BETO CARRERO/.test(normalizar(nombreActividad)))
                estado.incidencias.push(`${negocio} · ${dia}: confirmar si incluye comida: ${nombreActividad}`);
              continue;
            }
            const asistentes = Number(actividad.adultos || 0) + Number(actividad.estudiantes || 0);
            const pasajeros = inscripciones.filter(p => !isCancelled(p)).length;
            if (asistentes > 0 && asistentes < pasajeros)
              estado.incidencias.push(`${negocio} · ${dia}: ${nombreActividad} registra ${asistentes} asistentes frente a ${pasajeros} pasajeros; confirmar cuáles requieren dieta.`);
            out.push({...base,tipo:'servicio',entidad:`${servicio.comida} · ${servicio.nombre}`,
              entidadId:`${servicio.destino}|${normalizar(servicio.nombre)}`,proveedor:servicio.proveedor,fecha:fechaISO(dia),fechaFin:''});
          }
        }
        return out;
      }));
      filas.push(...lote.flat());
      $('deEstado').textContent = `Revisados ${Math.min(i+5,resumenes.length)} de ${resumenes.length} grupos ganados…`;
    }
    estado.filas = [...new Map(filas.map(r => [[r.idGrupo,r.tipo,r.entidadId,r.fecha].join('|'),r])).values()];
    llenarSelect('deGrupo',[...new Map(estado.filas.map(r=>[r.idGrupo,{value:r.idGrupo,label:`${r.grupo} · ${r.negocio}`}])).values()].sort((a,b)=>a.label.localeCompare(b.label,'es')),'Todos');
    const grupoSolicitado = new URLSearchParams(location.search).get('id');
    if (grupoSolicitado) $('deGrupo').value = grupoSolicitado;
    llenarSelect('deHotel',[...new Map(estado.filas.filter(r=>r.tipo==='hotel').map(r=>[r.entidadId,{value:r.entidadId,label:r.entidad}])).values()].sort((a,b)=>a.label.localeCompare(b.label,'es')),'Todos');
    llenarSelect('deProveedor',[...new Set(estado.filas.filter(r=>r.tipo==='servicio').map(r=>r.proveedor))].sort((a,b)=>a.localeCompare(b,'es')).map(v=>({value:v,label:v})),'Todos');
    mostrar();
  } catch(e) {
    console.error('[dietas]',e); $('deEstado').textContent = `No se completó la consulta: ${e.message}`;
    $('deEstado').className = 'de-danger'; estado.filas=[]; $('deResultados').hidden=true;
  } finally { estado.cargando=false; $('deCargar').disabled=false; }
}
function personasHTML(personas) {
  return `<ol>${personas.map(p=>`<li><strong>${escapeHtml(p.nombre)}</strong> — ${escapeHtml(p.tipos.join(', ') || 'Tipo sin especificar')}${p.detalle?` · ${escapeHtml(p.detalle)}`:''}${p.restricciones.length?` · Restricciones: ${escapeHtml(p.restricciones.join(', '))}`:''}${p.alergias.length?` · Alergias alimentarias: ${escapeHtml(p.alergias.join(', '))}`:''}${p.pendiente?' · PENDIENTE DE DETALLE':''}</li>`).join('')}</ol>`;
}
function mostrar() {
  try { estado.filtradas = filtrarFilas(); }
  catch(e) { $('deEstado').textContent=e.message; return; }
  const filas = estado.filtradas, grupos = new Set(filas.map(r=>r.idGrupo));
  const comidas = filas.filter(r => r.tipo === 'servicio');
  $('deTotales').textContent = `${filas.length} asignaciones · ${grupos.size} grupos · ${comidas.reduce((n,r)=>n+r.personas.length,0)} requerimientos potenciales por servicio de comida. Confirmar asistencia antes de informar cantidades definitivas. Las filas de hotel informan la estadía y no se suman como comidas.`;
  $('deFilas').innerHTML = filas.map((r,i)=>`<tr><td>${escapeHtml(fechaVisible(r.fecha))}${r.fechaFin?` → ${escapeHtml(fechaVisible(r.fechaFin))}`:''}</td><td>${escapeHtml(r.grupo)} · ${escapeHtml(r.negocio)}</td><td>${r.tipo==='hotel'?'Hotel':'Comida'}</td><td>${escapeHtml(r.entidad)}</td><td>${escapeHtml(r.proveedor)}</td><td>${r.personas.length} · ${escapeHtml(resumenPersonas(r.personas))}</td><td><button type="button" data-de="${i}">Ver personas</button></td></tr>`).join('') || '<tr><td colspan="7">Sin asignaciones para estos filtros.</td></tr>';
  $('deResultados').hidden=false; $('deImprimir').disabled=!filas.length;
  $('deEstado').className = 'de-muted';
  $('deEstado').textContent = `${estado.incidencias.length} vinculaciones requieren revisión.`;
  $('deRevision').hidden = !estado.incidencias.length;
  $('deRevisionLista').innerHTML = estado.incidencias.map(v=>`<li>${escapeHtml(v)}</li>`).join('');
}
function imprimir() {
  if (!estado.filtradas.length) return;
  const w=window.open('','_blank'); if (!w) { alert('Permite ventanas emergentes para imprimir.'); return; }
  const html=estado.filtradas.map(r=>`<section><h2>${escapeHtml(r.tipo==='hotel'?'Hotel':'Comida')} · ${escapeHtml(r.entidad)}</h2><p>${escapeHtml(fechaVisible(r.fecha))}${r.fechaFin?` → ${escapeHtml(fechaVisible(r.fechaFin))}`:''} · ${escapeHtml(r.grupo)} · Negocio ${escapeHtml(r.negocio)} · Proveedor: ${escapeHtml(r.proveedor)}</p><p>${r.personas.length} personas con requerimientos</p>${personasHTML(r.personas)}</section>`).join('');
  w.document.open(); w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Dietas especiales</title><style>@page{size:A4;margin:13mm}body{font:10pt Arial;color:#172334}header{display:flex;justify-content:space-between;border-bottom:2px solid #173d63}header img{max-width:110px;max-height:55px}section{break-inside:avoid;border-bottom:1px solid #ddd;padding:8px 0}h1{font-size:17pt}h2{font-size:11pt;margin:7px 0}p{margin:5px 0}li{padding:3px 0}small{color:#555}</style></head><body><header><img src="${new URL('IMG/logo-raitrai.png',location.href).href}" alt="Rai Trai"><small>Emitido ${new Date().toLocaleString('es-CL')}</small></header><h1>Dietas especiales</h1><p>${escapeHtml($('deAno').value)} · ${estado.filtradas.length} asignaciones</p>${html}<small>Fuente: fichas de pasajeros no anulados. Revisar los casos pendientes de detalle antes de comunicar al proveedor.</small><script>window.onload=()=>{const i=document.querySelector('header img');if(i?.complete)window.print();else if(i)i.onload=()=>window.print();else window.print()}<\/script></body></html>`); w.document.close();
}
onAuthStateChanged(auth, async user => {
  if (!user) { location.href='login.html'; return; }
  if (!canViewMedicalData(getCurrentSystemUser(user))) { $('deEstado').textContent='Sin permiso para ver datos médicos.'; return; }
  const ano = new Date().getFullYear();
  for (let n=ano-1;n<=ano+2;n++) $('deAno').add(new Option(String(n),String(n)));
  $('deAno').value=String(ano);
  $('deCargar').addEventListener('click',cargar);
  $('deImprimir').addEventListener('click',imprimir);
  for (const id of ['deGrupo','deHotel','deProveedor','deTipo','deDesde','deHasta']) $(id).addEventListener('change',mostrar);
  $('deAno').addEventListener('change',()=>{estado.filas=[];estado.filtradas=[];$('deResultados').hidden=true;$('deImprimir').disabled=true;$('deEstado').textContent='Pulsa Consultar para el año seleccionado.'});
  $('deFilas').addEventListener('click',e=>{const b=e.target.closest('[data-de]');if(!b)return;const r=estado.filtradas[Number(b.dataset.de)];if(!r)return;const el=document.createElement('div');el.className='de-overlay';el.innerHTML=`<div class="de-detalle"><button type="button" data-cerrar>Cerrar</button><h2>${escapeHtml(r.entidad)}</h2><p>${escapeHtml(r.grupo)} · ${escapeHtml(fechaVisible(r.fecha))}</p>${personasHTML(r.personas)}</div>`;el.addEventListener('click',ev=>{if(ev.target===el||ev.target.closest('[data-cerrar]'))el.remove()});document.body.append(el)});
  await cargar();
});
