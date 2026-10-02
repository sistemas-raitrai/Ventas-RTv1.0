import { auth, db, getVentasUser } from './firebase-init.js';
import { collection, collectionGroup, getDocs, getDoc, doc, query, where } from 'https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js';
import { onAuthStateChanged, clean, normalize, escapeHtml, passengerName, passengerDocument, fichaCompleta, loadGroupInscriptions } from './ficha-medica-common.js';

// Los porcentajes usan siempre personas que viajan, dentro del ámbito mostrado.
// Las personas sin ficha siguen formando parte del denominador.
const METRICAS = [
  ['medica','Situaciones médicas','Alergias, enfermedades o medicamentos; cada persona cuenta una vez.','violet'],
  ['neuro','Neurodivergencias','Declaradas, independientemente de si requieren apoyo.','blue'],
  ['dieta','Dietas especiales','Dietas y restricciones alimentarias; alimentación normal queda fuera.','teal'],
  ['apoyo','Necesitan apoyo','Asistencia o apoyos concretos declarados.','orange'],
  ['pendientes','Fichas pendientes','Información médica todavía incompleta.','orange'],
  ['delegadoNo','No autorizan delegado','Negativa explícita a compartir con delegado.','rose'],
  ['delegadoSin','Delegado sin respuesta','No hay una respuesta explícita guardada.','slate'],
  ['nombreNo','Nombre distinto al documento','Declaró que el nombre de uso no coincide con el documento.','blue'],
  ['nombreRevisar','Revisar nombre/documento','Datos documentales incompletos o declaración contradictoria.','rose']
];
const CLAVES = ['total','completas',...METRICAS.map(m=>m[0]),'alergias','enfermedades','medicamentos','contraindicados','delegadoSi','nombreSi','nombreSin','nombreNoAplica','internoNo'];
const ETIQUETAS = Object.fromEntries(METRICAS.map(m=>[m[0],m[1]]));
Object.assign(ETIQUETAS,{alergias:'Alergias',enfermedades:'Enfermedades / antecedentes',medicamentos:'Medicamentos',contraindicados:'Contraindicaciones',delegadoSi:'Autoriza delegado',nombreSi:'Nombre coincide declarado',nombreSin:'Coincidencia sin respuesta',nombreNoAplica:'Coincidencia no aplica',internoNo:'Uso interno restringido',completas:'Fichas completas',total:'Personas que viajan'});
const esc = escapeHtml;
const $ = id => document.getElementById(id);
const texto = v => typeof v==='string'||typeof v==='number'?clean(v):'';
const lista = v => Array.isArray(v)?v:[];
const clave = v => normalize(v).replace(/[\s-]+/g,'_');
const unico = values => [...new Set(values.filter(Boolean))];
const numFmt = new Intl.NumberFormat('es-CL');
const pctFmt = new Intl.NumberFormat('es-CL',{minimumFractionDigits:1,maximumFractionDigits:1});
function flag(v) { const n=normalize(v); return v===true||['si','true','1'].includes(n)?true:v===false||['no','false','0'].includes(n)?false:null; }
function porcentaje(n,total) { return total>0?n/total*100:null; }
function cuenta(n,total) { const p=porcentaje(n,total);return `${numFmt.format(n)} · ${p===null?'—':pctFmt.format(p)+' %'}`; }
function normalizarNegocio(v) {const n=texto(v);return /^\d+$/.test(n)?n.replace(/^0+(?=\d)/,''):n;}
function fechaISO(v) {
  if(!v)return '';
  if(typeof v==='string') {
    if(/^\d{4}-\d{2}-\d{2}/.test(v))return v.slice(0,10);
    const m=v.match(/^(\d{2})[\/-](\d{2})[\/-](\d{4})$/);if(m)return `${m[3]}-${m[2]}-${m[1]}`;
  }
  const d=v?.toDate?v.toDate():v instanceof Date?v:new Date(v);
  return Number.isNaN(d.getTime())?'':[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
}
const fechaTexto = v=>v?v.split('-').reverse().join('-'):'Fecha por confirmar';
function esVendedor(user) { return /^vendedor(?:a|\(a\))?$/.test(normalize(user?.rol).replace(/\s/g,'')); }
function esViajero(p) {
  const estadoPriv=clave(p.privacidad?.estado||p.estadoPrivacidad);
  if(p.archivada===true||p.anulado===true||p.anulada===true||p.noViaja===true||['archivada','eliminada','eliminada_logica'].includes(estadoPriv))return false;
  const estados=[p.estado,p.estadoInscripcion,p.estadoViaje,p.estadoCupo,p.sistemaPagos?.estado,p.sistemaPagos?.estadoViaje].map(clave);
  if(estados.some(x=>x.includes('anulad')||['no_viaja','no_viajan','eliminado_en_sp','eliminada_en_sp','eliminado','eliminada'].includes(x)))return false;
  if([p.viaja,p.sistemaPagos?.viaja].some(x=>flag(x)===false||clave(x)==='no_viaja'))return false;
  if(p.esCupoReservado===true||clave(p.tipoRegistro)==='cupo_reservado')return false;
  let tipo=clave(p.tipoInscripcion||p.estadoInscripcion||p.faseInscripcion||p.tipo||p.pasajero?.tipo||'nomina_inicial');
  const equivalencias={inscripcion_inicial:'nomina_inicial',normal:'nomina_inicial',nomina_final_ficha_medica:'nomina_final',sistema_de_pagos:'sistema_pagos',nuevos:'nuevo_ingreso',nuevo_inscrito:'nuevo_ingreso',lista_de_espera:'lista_espera',cupo_liberado:'liberado',liberados:'liberado',ingreso_liberado:'liberado',liberado_confirmado:'liberado'};
  tipo=equivalencias[tipo]||tipo;
  const estado=clave(p.estadoCupo||p.cupo?.estado||p.estado||'');
  if(['lista_espera','lista_espera_pagada','nuevo_ingreso'].includes(tipo))return estado==='confirmado';
  if(tipo==='liberado')return !['pendiente','por_confirmar','rechazado'].includes(estado);
  return ['nomina_inicial','nomina_inicial_confirmada','nomina_final','sistema_pagos','nuevo_ingreso_confirmado','lista_espera_confirmada'].includes(tipo);
}
function nombreDocumento(p) {
  const d=p.documentoIdentidad||{};
  return [d.nombresDocumento,d.primerApellidoDocumento,d.segundoApellidoDocumento].map(texto).filter(Boolean).join(' ');
}
function nombreNormal(v) {return normalize(v).replace(/\s+/g,' ').trim();}
function coincidenciaNombre(p) {
  const d=p.documentoIdentidad||{},valor=flag(d.nombreCoincideDocumento),nombre=nombreDocumento(p);
  if(d.aplica===false)return {estado:'no_aplica',revisar:false,nombre};
  if(valor===false)return {estado:'no',revisar:!texto(d.nombresDocumento)||!texto(d.primerApellidoDocumento),nombre};
  if(valor===true)return {estado:'si',revisar:!!nombre&&nombreNormal(nombre)!==nombreNormal(passengerName(p)),nombre};
  return {estado:'sin_respuesta',revisar:false,nombre};
}
function autorizacionDelegado(p) {
  const c=p.consentimiento||{};
  const values=[c.autorizaApoderadoCoordinador,c.autorizaEncargadoGrupo,c.autorizaCompartirEncargado,p.autorizaApoderadoCoordinador].map(flag);
  return values.includes(false)?'no':values.includes(true)?'si':'sin_respuesta';
}
function usoInterno(p) {return flag(p.consentimiento?.aceptaUsoInterno)!==false;}
function humanizar(v) {const m={sin_gluten:'Sin gluten',sin_lactosa:'Sin lactosa',vegetariana:'Vegetariana',vegetariano:'Vegetariana',vegana:'Vegana',vegano:'Vegana',alergia_alimentaria:'Alergia alimentaria',cea_tea:'CEA / TEA',tdah:'TDAH',dea:'DEA'};const k=clave(v);return m[k]||texto(v).replace(/_/g,' ');}
function datosSalud(p) {
  const s=p.salud||{}, completa=fichaCompleta(p),interno=usoInterno(p);
  const textoFlag=(f,d)=>flag(s[f])===true||!!texto(s[d]);
  const alergias=unico([texto(s.alergiasDetalle),...lista(s.alergiasAlimentarias).map(a=>texto(a?.alimento||a?.detalle||a))]);
  const tieneAlergia=textoFlag('alergiasFlag','alergiasDetalle')||flag(s.alergiaAlimentariaFlag)===true||alergias.length>0||lista(s.dietaRestricciones).some(x=>clave(x)==='alergia_alimentaria');
  const generales=[['enfermedadBaseFlag','enfermedadBaseDetalle','Enfermedad de base'],['saludGeneralFlag','saludGeneralDetalle','Condición de salud'],['saludMentalFlag','saludMentalDetalle','Salud mental'],['cirugiasPreviasFlag','cirugiasPreviasDetalle','Cirugías / tratamientos'],['emergenciaMedicaFlag','emergenciaMedicaDetalle','Antecedente de emergencia'],['otrosAntecedentesFlag','otrosAntecedentesDetalle','Otros antecedentes']];
  const enfermedades=generales.some(([f,d])=>textoFlag(f,d));
  const medicamentos=textoFlag('medicamentosFlag','medicamentosDetalle'), contraindicados=textoFlag('medicamentosProhibidosFlag','medicamentosProhibidosDetalle');
  const neuro=textoFlag('neurodivergenciaFlag','neurodivergenciaDescripcion')||lista(s.neurodivergenciaTipos).length>0;
  const comunes=new Set(['normal','comun','general','ninguna','ninguno','sin_restricciones','no','no_aplica','']);
  const dietas=unico([s.dietaPrincipal,...lista(s.dietaTipos),...lista(s.dietaRestricciones)].filter(x=>!comunes.has(clave(x))).map(humanizar));
  const dieta=flag(s.dietaFlag)===true||dietas.length>0||!!texto(s.dietaDetalle)||flag(s.alergiaAlimentariaFlag)===true||lista(s.alergiasAlimentarias).length>0;
  const directos=[s.necesitaAsistencia,s.necesitaAsistenciaFlag,s.requiereAsistencia,s.requiereAsistenciaFlag,p.necesitaAsistencia,p.necesitaAsistenciaFlag,p.requiereAsistencia].map(flag);
  const explicito=directos.find(x=>x!==null);
  const apoyo=explicito!==undefined?explicito:flag(s.discapacidadApoyosFlag)===true||flag(s.neuroApoyosFlag)===true||['discapacidadApoyoTipo','discapacidadRecomendaciones','discapacidadAyudaIndicaciones','neuroApoyosDetalle'].some(k=>!!texto(s[k]));
  const detalles=[];
  if(completa&&interno) {
    if(tieneAlergia)detalles.push(`Alergias: ${alergias.join(', ')||'Declaradas; falta detalle'}`);
    for(const [f,d,label] of generales)if(textoFlag(f,d))detalles.push(`${label}: ${texto(s[d])||'Declarado; falta detalle'}`);
    if(medicamentos)detalles.push(`Medicamentos: ${texto(s.medicamentosDetalle)||'Uso declarado; falta detalle'}`);
    if(contraindicados)detalles.push(`Contraindicaciones: ${texto(s.medicamentosProhibidosDetalle)||'Declaradas; falta detalle'}`);
    if(neuro)detalles.push(`Neurodivergencia: ${unico([...lista(s.neurodivergenciaTipos).map(humanizar),texto(s.neurodivergenciaOtra),texto(s.neurodivergenciaDescripcion)]).join(' · ')||'Declarada'}`);
    if(dieta)detalles.push(`Alimentación: ${unico([...dietas,texto(s.dietaDetalle)]).join(' · ')||'Restricción declarada'}`);
    if(flag(s.discapacidadFlag)===true||texto(s.discapacidadDescripcion))detalles.push(`Discapacidad: ${texto(s.discapacidadDescripcion)||lista(s.discapacidadTipos).map(humanizar).join(', ')||'Declarada'}`);
    for(const [k,label] of [['neuroFactores','Factores de sobrecarga'],['neuroEstrategias','Estrategias'],['neuroApoyosDetalle','Apoyo'],['discapacidadApoyoTipo','Asistencia'],['discapacidadRecomendaciones','Recomendaciones'],['discapacidadAyudaTecnica','Ayuda técnica'],['discapacidadAyudaIndicaciones','Indicaciones']])if(texto(s[k]))detalles.push(`${label}: ${texto(s[k])}`);
    if(apoyo&&!['discapacidadApoyoTipo','discapacidadRecomendaciones','discapacidadAyudaIndicaciones','neuroApoyosDetalle'].some(k=>texto(s[k])))detalles.push('Requiere apoyo; consultar indicaciones');
  }
  const visible=completa&&interno,identidad=coincidenciaNombre(p),delegado=autorizacionDelegado(p);
  return {id:p.id,nombre:passengerName(p),documento:passengerDocument(p),nombreDocumento:identidad.nombre,
    nombreSi:identidad.estado==='si',nombreNo:identidad.estado==='no',nombreSin:identidad.estado==='sin_respuesta',nombreNoAplica:identidad.estado==='no_aplica',nombreRevisar:identidad.revisar,
    delegadoSi:delegado==='si',delegadoNo:delegado==='no',delegadoSin:delegado==='sin_respuesta',
    total:true,completas:completa,pendientes:!completa,internoNo:!interno,
    alergias:visible&&!!tieneAlergia,enfermedades:visible&&enfermedades,medicamentos:visible&&medicamentos,contraindicados:visible&&contraindicados,
    medica:visible&&!!(tieneAlergia||enfermedades||medicamentos||contraindicados),neuro:visible&&neuro,dieta:visible&&dieta,apoyo:visible&&apoyo,
    detalles:!completa?['Ficha médica pendiente']:!interno?['Información médica restringida para uso interno']:detalles,
    identidad:identidad.estado};
}
function sumar(grupos) {
  const unicos=new Map(grupos.map(g=>[g.id,g]));
  const result=Object.fromEntries(CLAVES.map(k=>[k,0]));
  result.grupos=unicos.size;result.errores=0;
  for(const g of unicos.values()) {if(g.error){result.errores++;continue;}for(const k of CLAVES)result[k]+=g.cuentas[k]||0;}
  return result;
}
function cuentasPasajeros(pasajeros) {return Object.fromEntries(CLAVES.map(k=>[k,pasajeros.filter(p=>p[k]).length]));}
function agrupar(grupos,modo) {
  if(modo==='grupo')return [{key:'Todos los grupos',grupos}];
  const mapa=new Map();
  for(const g of grupos) {
    const keys=modo==='destino'?[g.destino]:modo==='fecha'?[g.inicio||'__sin_fecha']:
      g.coordinadores.length?g.coordinadores.map(c=>c.id):[g.coordError?'__coord_error':'__sin_coord'];
    for(const key of unico(keys)) {
      if(!mapa.has(key))mapa.set(key,{key,label:modo==='fecha'?fechaTexto(key==='__sin_fecha'?'':key):modo==='coordinador'?key==='__sin_coord'?'Sin coordinador asignado':key==='__coord_error'?'Asignación no disponible':g.coordinadores.find(c=>c.id===key)?.nombre||key:key,grupos:[]});
      mapa.get(key).grupos.push(g);
    }
  }
  return [...mapa.values()].sort((a,b)=>a.key.localeCompare(b.key,'es',{numeric:true}));
}
function indexarOperaciones(docs) {
  const mapa=new Map();
  for(const d of docs) {
    const data=d.data(),n=normalizarNegocio(data.numeroNegocio??data.numNegocio??data.idNegocio??(/^\d{1,4}$/.test(d.id)?d.id:''));
    if(!n)continue;if(!mapa.has(n))mapa.set(n,[]);mapa.get(n).push({id:d.id,data});
  }
  return mapa;
}

export function crearResumenSaludGeneral({getUsuario,getAno}) {
  let grupos=[],visibles=[],ocupado=false,generacion=0,anoCargado=null,instante='',avisos=[],focoAnterior=null,overflowAnterior='';
  function permitido() {
    const efectivo=getUsuario(),real=getVentasUser(auth.currentUser?.email||'');
    return !!auth.currentUser&&!!clean(efectivo?.rol)&&!!clean(real?.rol)&&!esVendedor(efectivo)&&!esVendedor(real);
  }
  function validar() {if(!permitido())throw new Error('No tienes acceso al resumen general de salud.');}
  function actualizarVisibilidad() {
    $('btnResumenSaludGeneral')?.classList.toggle('hidden',!permitido());
    if(!permitido()){generacion++;grupos=[];visibles=[];cerrar();if($('rsgResultados'))render();}
  }
  function montar() {
    if($('rsgModal'))return;
    const style=document.createElement('style');style.textContent=`
    #rsgModal{position:fixed;inset:0;z-index:10000;background:rgba(20,17,35,.62);padding:20px;display:flex;align-items:center;justify-content:center;font:14px/1.45 Arial,sans-serif;color:#263247}
    #rsgModal[hidden]{display:none!important}#rsgModal *{box-sizing:border-box}#rsgModal button,#rsgModal input,#rsgModal select{font:inherit}
    #rsgModal .rsg-shell{width:min(1480px,100%);height:min(94vh,1100px);height:min(94dvh,1100px);background:#f4f6fa;border-radius:20px;box-shadow:0 24px 80px #10182755;display:flex;flex-direction:column;overflow:hidden}
    #rsgModal .rsg-header{background:#fff;padding:22px 26px;border-bottom:1px solid #e3e7ef;flex-shrink:0;display:flex;align-items:center;justify-content:space-between;gap:20px}
    #rsgModal .rsg-eyebrow{color:#746285;font-size:11px;font-weight:800;letter-spacing:1.3px;text-transform:uppercase;margin:0 0 4px}
    #rsgModal h2{margin:0;font-size:25px;color:#2b1940;letter-spacing:-.5px}#rsgModal h3{margin:0;font-size:18px;color:#2b1940}#rsgModal p{margin:5px 0}
    #rsgModal .rsg-muted{color:#65718a;font-size:12px}#rsgModal .rsg-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
    #rsgModal button{border:1px solid #dce1eb;border-radius:9px;padding:9px 13px;background:#fff;color:#354158;font-weight:700;cursor:pointer}
    #rsgModal button:hover{background:#f4f0fa}#rsgModal button:focus-visible,#rsgModal summary:focus-visible,#rsgModal input:focus-visible,#rsgModal select:focus-visible{outline:3px solid #ab90d2;outline-offset:2px}
    #rsgModal button:disabled{opacity:.45;cursor:default}#rsgModal .rsg-primary{background:#2b1940;color:#fff;border-color:#2b1940}#rsgModal .rsg-primary:hover{background:#49305e}
    #rsgModal .rsg-scroll{overflow:auto;min-height:0;flex:1;padding:20px 26px 30px;-webkit-overflow-scrolling:touch;overscroll-behavior:contain}
    #rsgModal .rsg-filters{background:white;border:1px solid #e3e7ef;border-radius:13px;padding:15px;display:grid;grid-template-columns:1.6fr 1fr 1fr 1fr 1fr;gap:12px}
    #rsgModal label{display:flex;flex-direction:column;gap:5px;font-size:11px;font-weight:700;color:#65718a}
    #rsgModal input,#rsgModal select{width:100%;min-width:0;border:1px solid #dce1eb;border-radius:8px;background:#fff;color:#354158;padding:9px;font-size:13px}
    #rsgModal .rsg-controls{display:flex;gap:14px;align-items:end;flex-wrap:wrap;justify-content:space-between;margin:14px 0}
    #rsgModal .rsg-selects{display:flex;gap:12px;flex-wrap:wrap}#rsgModal .rsg-selects label{min-width:175px}
    #rsgModal .rsg-quality{background:#fff3d9;border:1px solid #f0dfb2;border-radius:9px;padding:10px 13px;color:#795a21;font-size:12px;margin:12px 0}#rsgModal .rsg-quality[hidden]{display:none}
    #rsgModal .rsg-status{font-size:12px;color:#65718a;margin:12px 0}#rsgModal .rsg-kpis{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin:16px 0}
    #rsgModal .rsg-kpi{background:white;border:1px solid #e3e7ef;border-radius:13px;padding:15px;text-align:left;position:relative;box-shadow:0 2px 5px #25345404;min-height:118px}
    #rsgModal .rsg-kpi.blue .rsg-value{color:#42659a}#rsgModal .rsg-kpi.teal .rsg-value{color:#29766f}#rsgModal .rsg-kpi.orange .rsg-value{color:#a37324}#rsgModal .rsg-kpi.rose .rsg-value{color:#a24e68}#rsgModal button.rsg-kpi{font-weight:400}#rsgModal .rsg-kpi.active{border:2px solid #8d6caf;padding:14px;background:#faf7ff}
    #rsgModal .rsg-kpi-title{font-size:12px;font-weight:700;color:#65718a;display:block}#rsgModal .rsg-value{font-size:28px;font-weight:800;letter-spacing:-.8px;color:#2b1940;display:block;margin:5px 0 2px}
    #rsgModal .rsg-pct{font-size:13px;font-weight:700;letter-spacing:0;color:#746285;margin-left:8px}#rsgModal .rsg-kpi-help{font-size:10px;color:#65718a;display:block;line-height:1.4}
    #rsgModal .rsg-explainer{font-size:12px;color:#65718a;margin:15px 0}#rsgModal .rsg-grouping{margin:16px 0 26px}
    #rsgModal .rsg-bucket-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:4px 0 12px;border-bottom:1px solid #dce1eb;margin-bottom:14px}
    #rsgModal .rsg-bucket-numbers{font-size:12px;color:#65718a;text-align:right}#rsgModal .rsg-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
    #rsgModal .rsg-group{background:#fff;border:1px solid #e3e7ef;border-radius:14px;padding:18px;min-width:0;box-shadow:0 2px 5px #25345404}
    #rsgModal .rsg-group.alert{border-left:4px solid #d69a38}#rsgModal .rsg-group.issue{border-left:4px solid #cc647e}
    #rsgModal .rsg-group-title{display:flex;justify-content:space-between;gap:12px;align-items:start}#rsgModal .rsg-group-title h4{font-size:16px;margin:0 0 5px;color:#263247;line-height:1.3}
    #rsgModal .rsg-date{white-space:nowrap;border-radius:7px;background:#f1eef7;color:#65517d;font-size:11px;padding:5px 8px;font-weight:bold}
    #rsgModal .rsg-meta{font-size:11px;color:#65718a;margin-bottom:12px}#rsgModal .rsg-coords{display:flex;gap:6px;flex-wrap:wrap;margin:12px 0}
    #rsgModal .rsg-coord{padding:5px 9px;border-radius:7px;background:#eaf0fb;color:#3f5d88;font-size:12px}#rsgModal .rsg-coord em{font-size:10px;font-style:normal;opacity:.8}
    #rsgModal .rsg-medical{padding:12px;border-radius:10px;background:#f7f3fb;margin:12px 0}#rsgModal .rsg-medical strong{color:#5f397f;font-size:15px}
    #rsgModal .rsg-track{height:5px;border-radius:5px;background:#e6dfef;margin-top:8px;overflow:hidden}#rsgModal .rsg-track span{height:100%;display:block;background:#9870bc;border-radius:5px}
    #rsgModal .rsg-mini{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:10px 0}
    #rsgModal .rsg-mini div{background:#f7f9fc;border-radius:8px;padding:8px}#rsgModal .rsg-mini span{display:block;font-size:10px;color:#65718a}#rsgModal .rsg-mini strong{font-size:12px;color:#354158}
    #rsgModal .rsg-group-foot{display:flex;gap:6px;flex-wrap:wrap;margin:12px 0}#rsgModal .rsg-pill{border-radius:6px;padding:4px 7px;font-size:10px;background:#f1f4f8;color:#65718a}
    #rsgModal .rsg-pill.orange{background:#fff3dc;color:#936315}#rsgModal .rsg-pill.rose{background:#fdeef2;color:#a34e66}
    #rsgModal details{border-top:1px solid #e3e7ef;margin-top:12px;padding-top:12px}#rsgModal summary{font-weight:700;font-size:12px;color:#6d4b86;cursor:pointer}
    #rsgModal .rsg-person{padding:12px 0;border-bottom:1px solid #edf0f5}#rsgModal .rsg-person:last-child{border-bottom:0}#rsgModal .rsg-person strong{font-size:13px;color:#263247}
    #rsgModal .rsg-person p{font-size:11px;color:#65718a}#rsgModal .rsg-person ul{margin:7px 0;padding-left:17px;font-size:12px;line-height:1.6}
    #rsgModal .rsg-link{color:#6d4b86;font-weight:700;font-size:11px;text-decoration:none;margin-right:12px}#rsgModal .rsg-empty{background:#fff;padding:35px;text-align:center;border:1px dashed #dce1eb;border-radius:14px;color:#65718a}
    @media(max-width:1050px){#rsgModal .rsg-kpis{grid-template-columns:repeat(3,minmax(0,1fr))}#rsgModal .rsg-filters{grid-template-columns:repeat(3,minmax(0,1fr))}}
    @media(max-width:720px){#rsgModal{padding:6px}#rsgModal .rsg-shell{height:98vh;height:98dvh;border-radius:12px}#rsgModal .rsg-header{padding:14px;align-items:start;gap:8px}#rsgModal h2{font-size:19px}#rsgModal .rsg-header .rsg-actions{justify-content:end;max-width:160px}#rsgModal .rsg-header button{padding:7px 9px;font-size:11px}#rsgModal .rsg-scroll{padding:14px}#rsgModal .rsg-kpis{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}#rsgModal .rsg-filters{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}#rsgModal .rsg-filters label:first-child{grid-column:1/-1}#rsgModal .rsg-grid{grid-template-columns:1fr}#rsgModal .rsg-bucket-head{align-items:start}#rsgModal .rsg-value{font-size:25px}#rsgModal .rsg-pct{font-size:11px}#rsgModal .rsg-bucket-numbers{font-size:10px}}
    `;document.head.append(style);
    const modal=document.createElement('div');modal.id='rsgModal';modal.hidden=true;
    modal.innerHTML=`<section class="rsg-shell" role="dialog" aria-modal="true" aria-labelledby="rsgTitulo" tabindex="-1">
      <header class="rsg-header"><div><p class="rsg-eyebrow">Preparación de viajes</p><h2 id="rsgTitulo">Salud y coordinadores</h2><p id="rsgSubtitulo" class="rsg-muted"></p></div>
      <div class="rsg-actions"><button id="rsgExcel">Excel</button><button id="rsgPdf" class="rsg-primary">PDF</button><button id="rsgCerrar" aria-label="Cerrar resumen de salud">Cerrar ✕</button></div></header>
      <div class="rsg-scroll"><div class="rsg-filters">
        <label>BUSCAR<input id="rsgBuscar" type="search" placeholder="Colegio, ID, negocio o pasajero"></label>
        <label>DESTINO<select id="rsgDestino"><option value="">Todos los destinos</option></select></label>
        <label>COORDINADOR<select id="rsgCoord"><option value="">Todos los coordinadores</option></select></label>
        <label>SALIDA DESDE<input id="rsgDesde" type="date"></label><label>SALIDA HASTA<input id="rsgHasta" type="date"></label>
      </div><div class="rsg-controls"><div class="rsg-selects">
        <label>AGRUPAR POR<select id="rsgAgrupar"><option value="destino">Destino</option><option value="fecha">Día de inicio</option><option value="coordinador">Coordinador</option><option value="grupo">Grupo</option></select></label>
        <label>ORDENAR GRUPOS<select id="rsgOrden"><option value="inicio">Fecha de inicio</option><option value="porcentaje">% con situaciones médicas</option><option value="medica">Cantidad con situaciones médicas</option><option value="neuro">Neurodivergencias</option><option value="dieta">Dietas especiales</option><option value="apoyo">Necesidades de apoyo</option><option value="pendientes">Fichas pendientes</option><option value="nombreRevisar">Revisión nombre/documento</option></select></label>
        <label>MOSTRAR GRUPOS CON<select id="rsgSituacion"><option value="">Todas las situaciones</option>${Object.entries(ETIQUETAS).filter(([k])=>k!=='total').map(([k,v])=>`<option value="${k}">${esc(v)}</option>`).join('')}</select></label>
      </div><div class="rsg-actions"><button id="rsgLimpiar">Limpiar filtros</button><button id="rsgRecargar">Actualizar</button></div></div>
      <div id="rsgMensaje" class="rsg-status" role="status" aria-live="polite"></div><div id="rsgCalidad" class="rsg-quality" hidden></div>
      <div id="rsgKpis" class="rsg-kpis"></div><p class="rsg-explainer" id="rsgBase"></p><div id="rsgResultados"></div></div></section>`;
    document.body.append(modal);
    $('rsgCerrar').onclick=cerrar;modal.addEventListener('click',ev=>{if(ev.target===modal)cerrar();});
    modal.addEventListener('keydown',ev=>{
      if(ev.key==='Escape')cerrar();
      if(ev.key==='Tab') {
        const focusables=[...modal.querySelectorAll('button:not(:disabled),input,select,summary,a[href]')].filter(el=>el.getClientRects().length);
        const first=focusables[0],last=focusables.at(-1);
        if(ev.shiftKey&&document.activeElement===first){ev.preventDefault();last?.focus();}
        else if(!ev.shiftKey&&document.activeElement===last){ev.preventDefault();first?.focus();}
      }
    });
    for(const id of ['rsgBuscar','rsgDestino','rsgCoord','rsgDesde','rsgHasta','rsgAgrupar','rsgOrden','rsgSituacion'])$(id).addEventListener('input',filtrar);
    $('rsgLimpiar').onclick=()=>{for(const id of ['rsgBuscar','rsgDestino','rsgCoord','rsgDesde','rsgHasta','rsgSituacion'])$(id).value='';filtrar();};
    $('rsgRecargar').onclick=()=>cargar();$('rsgExcel').onclick=()=>accion(exportarExcel);$('rsgPdf').onclick=()=>accion(exportarPdf);
    $('rsgKpis').addEventListener('click',ev=>{const b=ev.target.closest('[data-rsg-metrica]');if(!b)return;const key=b.dataset.rsgMetrica;$('rsgSituacion').value=$('rsgSituacion').value===key?'':key;filtrar();});
  }
  function accion(fn){try{validar();fn();}catch(err){mensaje(err.message);}}
  function mensaje(v){if($('rsgMensaje'))$('rsgMensaje').textContent=v;}
  function botones(){for(const id of ['rsgExcel','rsgPdf'])$(id).disabled=ocupado||!visibles.length||!permitido();$('rsgRecargar').disabled=ocupado;}
  async function abrir() {
    validar();montar();focoAnterior=document.activeElement;overflowAnterior=document.body.style.overflow;document.body.style.overflow='hidden';$('rsgModal').hidden=false;$('rsgCerrar').focus();
    await cargar();
  }
  function cerrar(){if($('rsgModal')&&!$('rsgModal').hidden){$('rsgModal').hidden=true;document.body.style.overflow=overflowAnterior;focoAnterior?.focus();}}
  async function leerCoordinadores() {
    const [cat,sets]=await Promise.allSettled([getDocs(collection(db,'coordinadores')),getDocs(collectionGroup(db,'conjuntos'))]);
    const nombres=new Map(),porGrupo=new Map(),errores=[];
    if(cat.status==='fulfilled') {
      for(const d of cat.value.docs)if(d.id!=='_borradores')nombres.set(d.id,texto(d.data().nombre)||`Coordinador ${d.id}`);
    } else errores.push('No se pudo leer el catálogo de coordinadores.');
    if(sets.status==='fulfilled')for(const d of sets.value.docs) {
      const parent=d.ref.parent.parent;if(!parent||parent.parent.id!=='coordinadores'||parent.id==='_borradores')continue;
      const x=d.data();
      for(const gid of lista(x.viajes)) {
        const key=String(gid);if(!porGrupo.has(key))porGrupo.set(key,new Map());
        const anterior=porGrupo.get(key).get(parent.id);
        const nuevo={id:parent.id,nombre:nombres.get(parent.id)||`Coordinador ${parent.id}`,estado:texto(x.estadoCoord)||'pendiente'};
        if(!anterior||clave(nuevo.estado)==='aprobado')porGrupo.get(key).set(parent.id,nuevo);
      }
    } else errores.push('No se pudieron leer las asignaciones de coordinadores.');
    return {nombres,porGrupo,errores};
  }
  function coordsGrupo(ops,indice) {
    if(!ops)return [];
    const o=ops.data,mapa=new Map(indice.porGrupo.get(ops.id)||[]);
    const ids=unico([...lista(o.coordinadorIds),...(o.coordinadorId?[o.coordinadorId]:[])].map(String));
    for(const id of ids)if(!mapa.has(id))mapa.set(id,{id,nombre:indice.nombres.get(id)||`Coordinador ${id}`,estado:'asignado'});
    if(!mapa.size)for(const nombre of lista(o.coordinadores).length?o.coordinadores:typeof o.coordinador==='string'?[o.coordinador]:[]) {
      if(typeof nombre==='string'&&texto(nombre))mapa.set(`nombre:${clave(nombre)}`,{id:`nombre:${clave(nombre)}`,nombre:texto(nombre),estado:'asignado'});
    }
    return [...mapa.values()].sort((a,b)=>a.nombre.localeCompare(b.nombre,'es'));
  }
  async function cargar() {
    if(ocupado)return;validar();ocupado=true;const token=++generacion;anoCargado=Number(getAno());avisos=[];grupos=[];visibles=[];render();botones();
    $('rsgSubtitulo').textContent=`Grupos ganados · Año ${anoCargado}`;mensaje('Cruzando Ventas, Operaciones y coordinadores…');
    try {
      const [ventas,opsResult,coords]=await Promise.all([
        getDocs(query(collection(db,'ventas_grupos_resumen'),where('anoViaje','==',anoCargado))),
        getDocs(collection(db,'grupos')).then(v=>({snap:v,error:''})).catch(err=>({snap:null,error:err.message})),
        leerCoordinadores()
      ]);
      validar();if(token!==generacion)return;
      avisos.push(...coords.errores);if(opsResult.error)avisos.push('No se pudieron leer los grupos de Operaciones: '+opsResult.error);
      const opsIndex=indexarOperaciones(opsResult.snap?.docs||[]);
      const rows=ventas.docs.map(d=>({id:d.id,data:d.data()})).filter(r=>normalize(r.data.estado||r.data.estadoComercial)==='ganada');
      const resultados=new Array(rows.length);let siguiente=0,terminados=0;
      async function worker() {
        while(siguiente<rows.length) {
          validar();if(token!==generacion)return;const i=siguiente++,r=rows[i],id=texto(r.data.groupDocId||r.id);
          try {
            const [v,items]=await Promise.all([getDoc(doc(db,'ventas_cotizaciones',id)),loadGroupInscriptions(id)]);
            if(!v.exists())throw new Error('No se encontró el grupo original de Ventas.');
            const data=v.data(),negocio=normalizarNegocio(data.numeroNegocio||r.data.numeroNegocio||r.data.negocioId);
            const candidatos=negocio?opsIndex.get(negocio)||[]:[],ops=candidatos.length===1?candidatos[0]:null;
            const calidad=[];
            if(!negocio)calidad.push('Sin número de negocio');
            else if(candidatos.length>1)calidad.push('Más de un grupo en Operaciones con el mismo negocio; revisar cruce');
            else if(!ops)calidad.push(opsResult.error?'Operaciones no disponible':'No se encontró el negocio en Operaciones');
            const pasajeros=items.filter(esViajero).map(datosSalud);
            const g={id,gid:texto(data.idGrupo||r.data.idGrupo||id),negocio,titulo:texto(r.data.aliasGrupo)||[texto(data.colegio),texto(data.curso)].filter(Boolean).join(' ')||`Grupo ${id}`,
              destino:humanizar(texto(ops?.data.destino||data.destinoPrincipal||data.destino||r.data.destinoPrincipal||r.data.destino))||'Sin destino',
              inicio:fechaISO(ops?.data.fechaInicio||data.fechaInicio||r.data.fechaInicio),fin:fechaISO(ops?.data.fechaFin||data.fechaFin||r.data.fechaFin),
              coordinadores:coordsGrupo(ops,coords),coordError:!ops||coords.errores.length>0,
              calidad,pasajeros,cuentas:cuentasPasajeros(pasajeros),error:''};
            if(!g.inicio)g.calidad.push('Fecha de inicio pendiente');
            resultados[i]=g;
          } catch(err) {
            console.error('[salud-general] grupo',id,err);
            resultados[i]={id,gid:texto(r.data.idGrupo||id),negocio:normalizarNegocio(r.data.numeroNegocio),titulo:texto(r.data.aliasGrupo)||`Grupo ${id}`,destino:humanizar(r.data.destino)||'Sin destino',inicio:'',fin:'',coordinadores:[],coordError:true,calidad:['Fichas no disponibles'],pasajeros:[],cuentas:Object.fromEntries(CLAVES.map(k=>[k,0])),error:err.message};
          }
          terminados++;if(token===generacion)mensaje(`Leyendo fichas: ${terminados} / ${rows.length} grupos…`);
        }
      }
      await Promise.all(Array.from({length:Math.min(5,rows.length)},worker));validar();if(token!==generacion)return;
      grupos=resultados.filter(Boolean);instante=new Date().toLocaleString('es-CL');llenarFiltros();filtrar();mensaje(`${grupos.length} grupos cargados · Actualizado ${instante}`);
    } catch(err){if(token===generacion)mensaje(err.message);}
    finally{ocupado=false;botones();}
  }
  function llenarFiltros() {
    const anteriorDestino=$('rsgDestino').value,anteriorCoord=$('rsgCoord').value;
    const destinos=unico(grupos.map(g=>g.destino)).sort((a,b)=>a.localeCompare(b,'es'));
    $('rsgDestino').innerHTML='<option value="">Todos los destinos</option>'+destinos.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');
    const coords=new Map(grupos.flatMap(g=>g.coordinadores).map(c=>[c.id,c]));
    $('rsgCoord').innerHTML='<option value="">Todos los coordinadores</option><option value="__sin">Sin coordinador asignado</option><option value="__desconocido">Asignación no disponible</option>'+[...coords.values()].sort((a,b)=>a.nombre.localeCompare(b.nombre,'es')).map(c=>`<option value="${esc(c.id)}">${esc(c.nombre)}</option>`).join('');
    if(destinos.includes(anteriorDestino))$('rsgDestino').value=anteriorDestino;
    if(coords.has(anteriorCoord)||['__sin','__desconocido'].includes(anteriorCoord))$('rsgCoord').value=anteriorCoord;
  }
  function filtrar() {
    if(!permitido()){actualizarVisibilidad();return;}
    const buscar=normalize($('rsgBuscar').value),destino=$('rsgDestino').value,coord=$('rsgCoord').value,desde=$('rsgDesde').value,hasta=$('rsgHasta').value,situacion=$('rsgSituacion').value;
    visibles=grupos.filter(g=>(!buscar||normalize([g.titulo,g.gid,g.negocio,...g.coordinadores.map(c=>c.nombre),...g.pasajeros.flatMap(p=>[p.nombre,p.documento,p.nombreDocumento])].join(' ')).includes(buscar))
      &&(!destino||g.destino===destino)&&(!coord||(coord==='__sin'?!g.coordError&&!g.coordinadores.length:coord==='__desconocido'?g.coordError:g.coordinadores.some(c=>c.id===coord)))
      &&(!desde||(g.inicio&&g.inicio>=desde))&&(!hasta||(g.inicio&&g.inicio<=hasta))&&(!situacion||!g.error&&g.cuentas[situacion]>0));
    const orden=$('rsgOrden').value;
    visibles.sort((a,b)=>{
      if(orden==='porcentaje'){const diferencia=(porcentaje(b.cuentas.medica,b.cuentas.total)||0)-(porcentaje(a.cuentas.medica,a.cuentas.total)||0);if(diferencia)return diferencia;}
      else if(orden!=='inicio'){const diferencia=(b.cuentas[orden]||0)-(a.cuentas[orden]||0);if(diferencia)return diferencia;}
      return (a.inicio||'9999').localeCompare(b.inicio||'9999')||a.titulo.localeCompare(b.titulo,'es');
    });
    render();botones();
  }
  function render() {
    if(!$('rsgResultados'))return;
    const c=sumar(visibles),situacion=$('rsgSituacion').value,modo=$('rsgAgrupar').value;
    $('rsgKpis').innerHTML=`<article class="rsg-kpi"><span class="rsg-kpi-title">Personas que viajan</span><span class="rsg-value">${numFmt.format(c.total)}<span class="rsg-pct">${c.total?'100,0 %':'—'}</span></span><span class="rsg-kpi-help">${c.grupos} grupos visibles · Fichas completas ${cuenta(c.completas,c.total)}</span></article>`+
      METRICAS.map(([k,t,help,color])=>`<button class="rsg-kpi ${color} ${situacion===k?'active':''}" data-rsg-metrica="${k}" aria-pressed="${situacion===k}"><span class="rsg-kpi-title">${esc(t)}</span><span class="rsg-value">${numFmt.format(c[k])}<span class="rsg-pct">${c.total?pctFmt.format(porcentaje(c[k],c.total))+' %':'—'}</span></span><span class="rsg-kpi-help">${esc(k==='medica'?`Alergias ${cuenta(c.alergias,c.total)} · Enfermedades ${cuenta(c.enfermedades,c.total)} · Medicamentos ${cuenta(c.medicamentos,c.total)}`:help)}</span></button>`).join('');
    $('rsgBase').textContent=`Base: ${c.total} personas que viajan en los grupos filtrados. Los porcentajes incluyen a quienes tienen ficha pendiente; son casos declarados conocidos, no una evaluación de gravedad. Las categorías pueden coincidir. Autoriza delegado: ${cuenta(c.delegadoSi,c.total)} · Nombre coincide declarado: ${cuenta(c.nombreSi,c.total)} · Coincidencia sin respuesta: ${cuenta(c.nombreSin,c.total)} · No aplica: ${cuenta(c.nombreNoAplica,c.total)}.${modo==='coordinador'?' Un grupo con varios coordinadores aparece bajo cada uno; el total general lo cuenta una sola vez.':''}`;
    const calidad=unico([...avisos,...(c.errores?[`${c.errores} grupos sin fichas disponibles: quedan fuera del denominador y los totales médicos.`]:[]),...(visibles.some(g=>g.calidad.length)?['Algunos grupos tienen datos operativos por confirmar; revisa las observaciones de sus tarjetas.']:[]),...(c.internoNo?[`Uso interno restringido: ${cuenta(c.internoNo,c.total)}. Esas personas permanecen en la base; sus situaciones médicas no se muestran ni se cuentan en las categorías.`]:[])]);
    $('rsgCalidad').hidden=!calidad.length;$('rsgCalidad').textContent=calidad.join(' ');
    $('rsgResultados').innerHTML=agrupar(visibles,modo).map(bucket=>{
      const t=sumar(bucket.grupos);
      return `<section class="rsg-grouping"><header class="rsg-bucket-head"><h3>${esc(bucket.label||bucket.key)}</h3><div class="rsg-bucket-numbers">${t.grupos} grupos · ${t.total} personas que viajan<br>Situaciones médicas <b>${cuenta(t.medica,t.total)}</b> · Pendientes <b>${cuenta(t.pendientes,t.total)}</b>${t.errores?`<br>${t.errores} grupos no disponibles`:''}</div></header><div class="rsg-grid">${bucket.grupos.map(tarjetaGrupo).join('')}</div></section>`;
    }).join('')||'<div class="rsg-empty">No hay grupos para estos filtros. Prueba limpiar los filtros o cambiar la situación.</div>';
  }
  function tarjetaGrupo(g) {
    const c=g.cuentas,warning=c.pendientes||c.apoyo||!g.coordinadores.length,issue=g.error||c.nombreRevisar;
    const coord=g.coordinadores.length?g.coordinadores.map(x=>`<span class="rsg-coord">${esc(x.nombre)} <em>${esc(x.estado)}</em></span>`).join(''):`<span class="rsg-pill orange">${g.coordError?'Asignación no disponible':'Sin coordinador asignado'}</span>`;
    const base=`<div class="rsg-group-title"><h4>${esc(g.titulo)}</h4><span class="rsg-date">${esc(fechaTexto(g.inicio))}</span></div><div class="rsg-meta">Negocio ${esc(g.negocio||'Pendiente')} · ID Ventas ${esc(g.gid)} · ${esc(g.destino)}<br>${esc(fechaTexto(g.inicio))} a ${esc(fechaTexto(g.fin))}</div><div class="rsg-coords">${coord}</div>`;
    if(g.error)return `<article class="rsg-group issue">${base}<p class="rsg-quality">No se pudieron leer las fichas: ${esc(g.error)}. Totales desconocidos.</p></article>`;
    const p=porcentaje(c.medica,c.total)||0;
    const metricas=[['neuro','Neurodivergencias'],['dieta','Dietas especiales'],['apoyo','Necesitan apoyo'],['alergias','Alergias'],['enfermedades','Enfermedades'],['medicamentos','Medicamentos']];
    const seleccion=$('rsgSituacion').value;
    const relevantes=g.pasajeros.filter(x=>seleccion?x[seleccion]:x.medica||x.neuro||x.dieta||x.apoyo||x.pendientes||x.delegadoNo||x.nombreNo||x.nombreRevisar||x.internoNo);
    const ids=new Set(relevantes.map(x=>x.id)),otros=g.pasajeros.filter(x=>!ids.has(x.id));
    return `<article class="rsg-group ${issue?'issue':warning?'alert':''}">${base}
      <div class="rsg-medical"><strong>${c.medica} de ${c.total} personas con situaciones médicas · ${c.total?pctFmt.format(p)+' %':'—'}</strong><div class="rsg-track"><span style="width:${p}%"></span></div></div>
      <div class="rsg-mini">${metricas.map(([k,t])=>`<div><span>${t}</span><strong>${cuenta(c[k],c.total)}</strong></div>`).join('')}</div>
      <div class="rsg-group-foot"><span class="rsg-pill ${c.pendientes?'orange':''}">Fichas pendientes ${cuenta(c.pendientes,c.total)}</span><span class="rsg-pill">Completas ${cuenta(c.completas,c.total)}</span></div>
      <div class="rsg-mini"><div><span>Autoriza delegado</span><strong>${cuenta(c.delegadoSi,c.total)}</strong></div><div><span>No autoriza</span><strong>${cuenta(c.delegadoNo,c.total)}</strong></div><div><span>Sin respuesta</span><strong>${cuenta(c.delegadoSin,c.total)}</strong></div></div>
      <div class="rsg-group-foot"><span class="rsg-pill">Nombre distinto ${cuenta(c.nombreNo,c.total)}</span><span class="rsg-pill ${c.nombreRevisar?'rose':''}">Revisar nombre ${cuenta(c.nombreRevisar,c.total)}</span><span class="rsg-pill">Coincide declarado ${cuenta(c.nombreSi,c.total)}</span><span class="rsg-pill">Sin respuesta ${cuenta(c.nombreSin,c.total)}</span>${c.nombreNoAplica?`<span class="rsg-pill">No aplica ${cuenta(c.nombreNoAplica,c.total)}</span>`:''}${c.internoNo?`<span class="rsg-pill rose">Uso interno restringido ${cuenta(c.internoNo,c.total)}</span>`:''}</div>
      ${g.calidad.length?`<p class="rsg-muted">${g.calidad.map(esc).join(' · ')}</p>`:''}
      <details><summary>Ver personas y detalle · ${cuenta(relevantes.length,c.total)}</summary>${relevantes.map(x=>tarjetaPersona(x,g)).join('')||'<p class="rsg-muted">No hay personas con esta situación.</p>'}${otros.length?`<details><summary>Ver los demás pasajeros · ${cuenta(otros.length,c.total)}</summary>${otros.map(x=>tarjetaPersona(x,g)).join('')}</details>`:''}
      <p><a class="rsg-link" href="gestion-fichas-medicas.html?id=${encodeURIComponent(g.id)}" target="_blank" rel="noopener">Abrir gestión de fichas médicas ↗</a></p></details></article>`;
  }
  function tarjetaPersona(p,g) {
    const identidad={si:'Coincide, según declaración',no:'Nombre de uso distinto al documento',sin_respuesta:'Sin respuesta sobre coincidencia',no_aplica:'Pregunta de coincidencia no aplica'}[p.identidad];
    const autoriza=p.delegadoSi?'Sí, autoriza':p.delegadoNo?'No autoriza':'Sin respuesta registrada';
    return `<div class="rsg-person"><strong>${esc(p.nombre)}</strong><p>${esc(p.documento)} · ${p.completas?'Ficha completa':'Ficha pendiente'}</p><p>Delegado: <b>${autoriza}</b> · ${esc(identidad)}${p.nombreRevisar?' · REVISAR DATOS':''}</p>${p.nombreDocumento?`<p>Nombre según documento: <b>${esc(p.nombreDocumento)}</b></p>`:''}<ul>${p.detalles.map(x=>`<li>${esc(x)}</li>`).join('')||'<li>Sin situaciones declaradas para uso interno.</li>'}</ul><a class="rsg-link" href="ficha-medica.html?grupo=${encodeURIComponent(g.id)}&id=${encodeURIComponent(p.id)}" target="_blank" rel="noopener">Ver ficha ↗</a></div>`;
  }
  function filtrosTexto() {
    return ['rsgDestino','rsgCoord','rsgSituacion'].map(id=>$(id).value?$(id).selectedOptions[0].textContent:'').concat($('rsgBuscar').value?`Buscar: ${$('rsgBuscar').value}`:'',$('rsgDesde').value?`Desde ${fechaTexto($('rsgDesde').value)}`:'',$('rsgHasta').value?`Hasta ${fechaTexto($('rsgHasta').value)}`:'').filter(Boolean).join(' · ')||'Todos los grupos del año';
  }
  function crearHoja(X,headers,rows,widths) {
    const sheet=X.utils.aoa_to_sheet([headers,...rows]);sheet['!cols']=headers.map((_,i)=>({wch:widths?.[i]||18}));sheet['!autofilter']={ref:sheet['!ref']};return sheet;
  }
  function valorPorcentaje(n,total) {const value=porcentaje(n,total);return value===null?'':value/100;}
  function formatoPorcentajes(sheet,headers,rows) {
    headers.forEach((h,c)=>{if(h.startsWith('% '))for(let r=1;r<=rows.length;r++){const cell=sheet[window.XLSX.utils.encode_cell({r,c})];if(cell&&cell.t==='n')cell.z='0.0%';}});
  }
  function exportarExcel() {
    if(ocupado||!visibles.length)return;
    if(!window.XLSX)throw new Error('No se pudo cargar la herramienta de Excel.');
    const X=window.XLSX,book=X.utils.book_new(),c=sumar(visibles),modo=$('rsgAgrupar').value;
    const info=[['Año',anoCargado],['Generado',instante],['Filtros',filtrosTexto()],['Agrupación',modo],['Base',`${c.total} personas que viajan; fichas pendientes incluidas. ${c.errores} grupos con fichas no disponibles fuera del denominador.`],['Observaciones',avisos.join(' · ')],['Categorías','Una persona puede estar en varias categorías. Situaciones médicas cuenta cada persona una vez.'],['Coordinadores','Un grupo con varios coordinadores aparece en varias agrupaciones; el total general no se duplica.']];
    X.utils.book_append_sheet(book,X.utils.aoa_to_sheet(info),'Información');
    const keys=CLAVES.filter(k=>k!=='total');
    const indicadores=keys.map(k=>[ETIQUETAS[k]||k,c[k],valorPorcentaje(c[k],c.total),c.total]);
    const ik=['Indicador','Personas','% sobre viajeros','Base viajeros'];const is=crearHoja(X,ik,indicadores,{0:35});formatoPorcentajes(is,ik,indicadores);X.utils.book_append_sheet(book,is,'Indicadores');
    const ah=['Agrupación','Grupos','Viajeros',...keys.flatMap(k=>[ETIQUETAS[k]||k,`% ${ETIQUETAS[k]||k}`]),'Grupos sin fichas'];
    const ar=agrupar(visibles,modo).map(b=>{const t=sumar(b.grupos);return [b.label||b.key,t.grupos,t.total,...keys.flatMap(k=>[t[k],valorPorcentaje(t[k],t.total)]),t.errores];});
    const ash=crearHoja(X,ah,ar,{0:35});formatoPorcentajes(ash,ah,ar);X.utils.book_append_sheet(book,ash,'Agrupaciones');
    const gh=['Negocio','ID Ventas','Grupo','Destino','Inicio','Fin','Coordinadores','Viajeros',...keys.flatMap(k=>[ETIQUETAS[k]||k,`% ${ETIQUETAS[k]||k}`]),'Observaciones'];
    const gr=visibles.map(g=>[g.negocio,g.gid,g.titulo,g.destino,g.inicio,g.fin,g.coordinadores.map(x=>`${x.nombre} (${x.estado})`).join(' / '),g.error?'':g.cuentas.total,...keys.flatMap(k=>g.error?['','']:[g.cuentas[k],valorPorcentaje(g.cuentas[k],g.cuentas.total)]),[g.error,...g.calidad].filter(Boolean).join(' · ')]);
    const gs=crearHoja(X,gh,gr,{2:40,6:45});formatoPorcentajes(gs,gh,gr);X.utils.book_append_sheet(book,gs,'Grupos');
    const ph=['Negocio','ID Ventas','Grupo','Destino','Inicio','Coordinadores','Pasajero','Documento','Ficha','Situación médica','Alergias','Enfermedades','Medicamentos','Neurodivergencia','Dieta','Apoyo','Autoriza delegado','Nombre coincide declarado','Nombre según documento','Revisar nombre','Uso interno','Detalle'];
    const pr=visibles.flatMap(g=>g.error?[[g.negocio,g.gid,g.titulo,g.destino,g.inicio,'','','','ERROR','','','','','','','','','','','','',g.error]]:g.pasajeros.map(p=>[g.negocio,g.gid,g.titulo,g.destino,g.inicio,g.coordinadores.map(x=>x.nombre).join(' / '),p.nombre,p.documento,p.completas?'Completa':'Pendiente',...['medica','alergias','enfermedades','medicamentos','neuro','dieta','apoyo'].map(k=>p.internoNo?'Restringido':!p.completas?'Desconocido':p[k]?'Sí':'No'),p.delegadoSi?'Sí':p.delegadoNo?'No':'Sin respuesta',p.nombreSi?'Sí':p.nombreNo?'No':p.nombreNoAplica?'No aplica':'Sin respuesta',p.nombreDocumento,p.nombreRevisar?'Sí':'No',p.internoNo?'Restringido':'Permitido según criterio actual',p.detalles.join(' · ')||'Sin situaciones declaradas']));
    X.utils.book_append_sheet(book,crearHoja(X,ph,pr,{2:40,5:40,6:35,18:35,21:90}),'Pasajeros');
    X.writeFile(book,`salud_coordinadores_${anoCargado}.xlsx`);
  }
  function exportarPdf() {
    if(ocupado||!visibles.length)return;
    if(!window.jspdf?.jsPDF)throw new Error('No se pudo cargar la herramienta de PDF.');
    const pdf=new window.jspdf.jsPDF({orientation:'landscape',unit:'mm',format:'a4'});
    if(typeof pdf.autoTable!=='function')throw new Error('No se pudo cargar el complemento de tablas PDF.');
    const c=sumar(visibles),modo=$('rsgAgrupar').value;
    function titulo(t,sub='') {
      pdf.setFontSize(17);pdf.setTextColor(43,25,64);const lines=pdf.splitTextToSize(t,273);pdf.text(lines,12,15);
      pdf.setFontSize(9);pdf.setTextColor(85,98,120);const l=pdf.splitTextToSize(sub,273);const y=15+lines.length*7;if(sub)pdf.text(l,12,y);return y+(sub?l.length*4:0)+6;
    }
    const y=titulo(`Salud y coordinadores · ${anoCargado}`,`${visibles.length} grupos · ${c.total} personas que viajan · ${instante}\n${filtrosTexto()}\nBase: viajeros, incluyendo fichas pendientes. ${c.errores} grupos sin fichas fuera del denominador. ${avisos.join(' ')}`);
    const opts={margin:{top:12,right:12,bottom:17,left:12},styles:{fontSize:8,cellPadding:3,overflow:'linebreak'},headStyles:{fillColor:[43,25,64]},alternateRowStyles:{fillColor:[246,247,250]}};
    pdf.autoTable({...opts,startY:y,head:[['Indicador','Personas','% sobre viajeros','Base']],body:CLAVES.filter(k=>k!=='total').map(k=>[ETIQUETAS[k]||k,c[k],c.total?pctFmt.format(porcentaje(c[k],c.total))+' %':'—',c.total])});
    for(const b of agrupar(visibles,modo)) {
      pdf.addPage();const t=sumar(b.grupos);const by=titulo(b.label||b.key,`${t.grupos} grupos · ${t.total} viajeros · Situaciones médicas ${cuenta(t.medica,t.total)} · Pendientes ${cuenta(t.pendientes,t.total)}\n${modo==='coordinador'?'Un grupo con varios coordinadores puede figurar en otras agrupaciones.':''}`);
      pdf.autoTable({...opts,startY:by,styles:{...opts.styles,fontSize:7},head:[['Grupo / ID','Inicio','Coordinadores','Viajeros','Médicas n · %','Neuro n · %','Dietas n · %','Apoyo n · %','Pendientes n · %']],body:b.grupos.map(g=>[`${g.titulo}\nID ${g.gid} · Negocio ${g.negocio}`,fechaTexto(g.inicio),g.coordinadores.map(x=>x.nombre).join(' / ')|| (g.coordError?'No disponible':'Sin asignación'),g.error?'No disponible':g.cuentas.total,...['medica','neuro','dieta','apoyo','pendientes'].map(k=>g.error?'—':cuenta(g.cuentas[k],g.cuentas.total))])});
    }
    // Detalle una sola vez por grupo, aunque participe en varias agrupaciones.
    for(const g of visibles) {
      pdf.addPage();const c=g.cuentas;const dy=titulo(`${g.titulo} · ID ${g.gid} · Negocio ${g.negocio||'Pendiente'}`,`${g.destino} · ${fechaTexto(g.inicio)} a ${fechaTexto(g.fin)}\nCoordinadores: ${g.coordinadores.map(x=>`${x.nombre} (${x.estado})`).join(' / ')||(g.coordError?'No disponible':'Sin asignación')}\n${g.error?'Fichas no disponibles':`Viajeros ${c.total} · Médicas ${cuenta(c.medica,c.total)} · Neuro ${cuenta(c.neuro,c.total)} · Dietas ${cuenta(c.dieta,c.total)} · Apoyo ${cuenta(c.apoyo,c.total)} · Pendientes ${cuenta(c.pendientes,c.total)}`}\n${g.calidad.join(' · ')}`);
      pdf.autoTable({...opts,startY:dy,head:[['Pasajero / Documento','Ficha','Delegado / Nombre','Consideraciones operativas']],columnStyles:{0:{cellWidth:58},1:{cellWidth:20},2:{cellWidth:62},3:{cellWidth:133}},body:g.error?[['','','',g.error]]:g.pasajeros.map(p=>[`${p.nombre}\n${p.documento}`,p.completas?'Completa':'Pendiente',`Delegado: ${p.delegadoSi?'Sí':p.delegadoNo?'No':'Sin respuesta'}\nNombre coincide: ${p.nombreSi?'Sí declarado':p.nombreNo?'No declarado':p.nombreNoAplica?'No aplica':'Sin respuesta'}${p.nombreDocumento?`\nDocumento: ${p.nombreDocumento}`:''}${p.nombreRevisar?'\nREVISAR DATOS':''}`,p.detalles.join('\n')||'Sin situaciones declaradas'])});
    }
    const n=pdf.getNumberOfPages();for(let i=1;i<=n;i++){pdf.setPage(i);pdf.setFontSize(8);pdf.setTextColor(100,110,130);pdf.text(`Uso interno · Salud y coordinadores · ${i} / ${n}`,12,203);}
    pdf.save(`salud_coordinadores_${anoCargado}.pdf`);
  }
  onAuthStateChanged(auth,actualizarVisibilidad);
  return {abrir,actualizarVisibilidad};
}
