// Gestión del restaurante para la dueña: entra con su contraseña y ve compras, precios, escandallos y ventas.
import {
  estado, acciones, registrarVista, pintar, mostrar, api, local, siCaduca, $, esc, eur, pct, num, plural, nombreMes,
  toast, barras, selectorPeriodo, ventasDePeriodo, gastoDePeriodo, enPeriodo, porRevisar, conEscandallo, calcular,
  objetivo, estadoCoste, minimo, sinIva, textoHasta, ventasDeMes,
} from './gestion-base.js';
import {
  gastoDe, reclamable, revisionAlbaran, tablaPrecios, sumaLineas,
} from './gestion-comun.js';
import { iniciarAlbaranes, verAlbaran } from './gestion-albaranes.js';
import { iniciarPrecios, verIngrediente } from './gestion-precios.js';
import { iniciarEscandallos, verPlato } from './gestion-escandallos.js';
import { iniciarVentas } from './gestion-ventas.js';

const CLAVE = 'gestion-clave';
const PERIODO = 'gestion-periodo';
let cargadoEn = 0;

// --- Acceso ---

function pantallaAcceso(mensaje = '') {
  $('#app').hidden = true;
  $('#acceso').hidden = false;
  const error = $('#error-acceso');
  error.hidden = !mensaje;
  error.textContent = mensaje;
  $('#clave').value = '';
  $('#clave').focus();
}

function salir(mensaje) {
  local.borrar(CLAVE);
  estado.clave = null;
  estado.datos = null;
  estado.editor = null;
  pantallaAcceso(mensaje);
}
siCaduca(() => salir('La contraseña ya no es válida. Vuelve a entrar.'));

// recordar: true (en este dispositivo), false (solo esta sesión) o null (ya estaba guardada).
async function entrar(clave, recordar) {
  estado.clave = clave;
  const r = await api({ accion: 'estado' });
  if (r.sinClave) {
    estado.clave = null;
    throw new Error('Falta configurar STOCK_CLAVE en Vercel: sin ella no se pueden leer los datos.');
  }
  if (recordar !== null) {
    local.borrar(CLAVE);
    local.escribir(CLAVE, clave, recordar);
  }
  cargadoEn = Date.now();
  const guardado = local.leer(PERIODO);
  if (guardado && (guardado === 'todo' || /^\d{4}-\d{2}$/.test(guardado))) estado.periodo = guardado;
  $('#acceso').hidden = true;
  $('#app').hidden = false;
  mostrar((location.hash || '').slice(1) || 'resumen', { forzar: true });
}

$('#form-acceso').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const boton = ev.target.querySelector('button');
  boton.disabled = true;
  try {
    await entrar($('#clave').value, $('#recordar').checked);
  } catch (e) {
    estado.clave = null;
    pantallaAcceso(e.status === 401 ? 'Contraseña incorrecta.' : e.message);
  } finally {
    boton.disabled = false;
  }
});

// --- Resumen ---

function alertas() {
  const d = estado.datos;
  const lista = [];
  for (const a of d.albaranes) {
    const r = reclamable(a);
    if (!r) continue;
    const lineas = a.lineas.filter((l) => l.ne).map((l) => l.ing).join(', ');
    lista.push({ tipo: 'mal', ico: '!', titulo: `${a.proveedor} cobra algo que no llegó`, texto: `${lineas}: ${eur(r)} con IVA en el ${a.tipo === 'factura' ? 'la factura' : 'albarán'} ${a.numero}.`, boton: 'Ver albarán', albaran: a.id });
  }
  const sinPaginas = d.albaranes.filter((a) => revisionAlbaran(a).some((x) => x.tipo === 'paginas'));
  if (sinPaginas.length) {
    lista.push({ tipo: 'aviso', ico: '2', titulo: 'Faltan páginas', texto: `${sinPaginas.map((a) => `${a.proveedor} ${a.numero}`).join(', ')}: sin la página que falta no se comprueba el total.`, boton: 'Ver albarán', albaran: sinPaginas[0].id });
  }
  const descuadrados = d.albaranes.filter((a) => revisionAlbaran(a).some((x) => x.tipo === 'cuadre'));
  if (descuadrados.length) {
    lista.push({ tipo: 'aviso', ico: '≠', titulo: 'Albaranes que no cuadran', texto: `${descuadrados.map((a) => `${a.proveedor} ${a.numero} (líneas ${eur(sumaLineas(a))}, base ${eur(a.base)})`).join('; ')}. Falta o sobra alguna línea.`, boton: 'Ver albarán', albaran: descuadrados[0].id });
  }
  // Subidas de precio de las compras de los últimos 45 días.
  const ultimaFecha = d.albaranes.map((a) => a.fecha).sort().at(-1);
  if (ultimaFecha) {
    const desde = new Date(`${ultimaFecha}T12:00:00`);
    desde.setDate(desde.getDate() - 45);
    const limite = desde.toISOString().slice(0, 10);
    const subidas = tablaPrecios(d.albaranes).filter((p) => p.cambio >= 0.03 && p.fecha >= limite).sort((a, b) => b.cambio - a.cambio);
    for (const p of subidas.slice(0, 3)) {
      lista.push({ tipo: 'aviso', ico: '↑', titulo: `${p.ing} sube un ${num(p.cambio * 100, 1)} %`, texto: `${p.proveedor}: de ${num(p.anterior.precio)} a ${num(p.precio)} €/${p.ud} (${new Date(`${p.fecha}T12:00:00`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}).`, boton: 'Ver precio', ing: p.ing });
    }
    if (subidas.length > 3) lista.push({ tipo: 'aviso', ico: '↑', titulo: `${subidas.length - 3} subidas de precio más`, texto: 'En la lista de precios están marcadas en rojo o amarillo.', boton: 'Ver precios', ir: 'precios' });
  }
  const ultimoMes = Object.keys(d.ventas).sort().at(-1);
  if (ultimoMes) {
    const v = ventasDeMes(ultimoMes);
    const parte = -v.descuentos / v.facturado;
    if (parte > 0.1) {
      lista.push({ tipo: 'aviso', ico: '%', titulo: `Los descuentos son el ${pct(parte, 1)} de lo facturado`, texto: `En ${nombreMes(ultimoMes).toLowerCase()}, ${textoHasta(v)}, se han descontado ${eur(-v.descuentos, 0)}.`, boton: 'Ver ventas', ir: 'ventas' });
    }
  }
  const pendientes = porRevisar().length;
  if (pendientes) lista.push({ tipo: 'info', ico: '✓', titulo: `${plural(pendientes, 'documento', 'documentos')} por revisar`, texto: 'Compara las líneas leídas con el papel y dalos por buenos.', boton: 'Revisar', ir: 'pendientes' });
  return lista;
}

function pintarResumen() {
  const cont = $('#v-resumen');
  const d = estado.datos;
  const P = estado.periodo;
  const ventas = ventasDePeriodo(P);
  const docs = d.albaranes.filter((a) => enPeriodo(a.fecha, P));
  const gasto = gastoDePeriodo(P);
  const reclamar = d.albaranes.reduce((s, a) => s + reclamable(a), 0);
  const platos = conEscandallo().map((p) => ({ p, c: calcular(p) })).filter(({ c }) => c?.coste != null);
  const altos = platos.filter(({ c }) => c.porcentaje > objetivo()).length;
  const ventasSinIva = ventas ? sinIva(ventas.conIva) : null;
  const detVentas = ventas
    ? (ventas.meses.length === 1 ? textoHasta(ventas.meses[0][1]) : `${plural(ventas.meses.length, 'mes', 'meses')}${ventas.parcial ? ', alguno incompleto' : ''}`)
    : 'sin informe del TPV';
  const lista = alertas();
  cont.innerHTML = `
    <div class="titulo-vista">
      <div><h2>Resumen</h2><p>Lo gastado en los albaranes subidos, lo vendido según el TPV, lo que hay que revisar y cómo está el coste de los platos.</p></div>
      <span class="espacio"></span>${selectorPeriodo()}
    </div>
    <div class="rejilla-cifras">
      <div class="cifra"><span class="et">Vendido (con IVA)</span><span class="val">${ventas ? eur(ventas.conIva, 0) : '—'}</span><span class="det">${esc(detVentas)}</span></div>
      <div class="cifra"><span class="et">Gastado en compras (sin IVA)</span><span class="val">${eur(gasto, 0)}</span><span class="det">${plural(docs.length, 'documento subido', 'documentos subidos')}</span></div>
      <div class="cifra"><span class="et">Compras sobre ventas</span><span class="val">${ventasSinIva && gasto ? pct(gasto / ventasSinIva, 1) : '—'}</span><span class="det">${ventasSinIva && gasto ? 'las dos sin IVA · solo cuenta lo subido' : 'hacen falta compras y ventas del periodo'}</span></div>
      <div class="cifra"><span class="et">Por revisar</span><span class="val">${porRevisar().length}</span><span class="det">de ${plural(d.albaranes.length, 'documento', 'documentos')} en total</span></div>
      <div class="cifra"><span class="et">A reclamar</span><span class="val">${eur(reclamar)}</span><span class="det">cobrado sin entregar, con IVA</span></div>
      <div class="cifra"><span class="et">Platos por encima del objetivo</span><span class="val">${altos} de ${platos.length}</span><span class="det">de los que tienen coste calculado</span></div>
    </div>
    ${lista.length ? `<div class="tarjeta"><h3>Para revisar</h3><p class="bajada">Lo que sale solo de los albaranes y las ventas.</p>
      <div class="alertas">${lista.map((a) => `
        <div class="alerta ${a.tipo}"><span class="ico" aria-hidden="true">${a.ico}</span>
          <span><b>${esc(a.titulo)}</b><span class="t">${esc(a.texto)}</span></span>
          <button class="btn sec peq"${a.albaran ? ` data-ir-albaran="${a.albaran}"` : ''}${a.ing ? ` data-ir-ing="${esc(a.ing)}"` : ''}${a.ir ? ` data-ir="${a.ir}"` : ''}>${esc(a.boton)}</button>
        </div>`).join('')}</div></div>` : ''}
    <div class="rejilla-2">
      <div class="tarjeta"><h3>Gasto por tipo de producto</h3><p class="bajada">Base imponible, sin IVA: el IVA se recupera y no cuenta como coste.</p><div class="barras" id="g-categoria"></div></div>
      <div class="tarjeta"><h3>Gasto por proveedor</h3><p class="bajada">Base imponible, sin IVA. Los marcados tienen páginas sin subir.</p><div class="barras" id="g-proveedor"></div></div>
    </div>
    <div class="tarjeta">
      <h3>Coste de los platos con escandallo</h3>
      <p class="bajada">% del precio de venta sin IVA que se va en los ingredientes. Objetivo: <b>${pct(objetivo())}</b>.</p>
      ${platos.length ? `<div class="tabla-cont"><table><thead><tr><th>Plato</th><th class="d">Coste ración</th><th class="d">Precio carta</th><th class="d">% coste</th><th>Estado</th></tr></thead>
      <tbody>${platos.map(({ p, c }) => `<tr class="clic" data-ir-plato="${p.id}"><td>${esc(p.nombre)}</td><td class="d">${minimo(c)}${eur(c.coste)}</td><td class="d">${eur(p.pvp)}</td><td class="d">${minimo(c)}${pct(c.porcentaje)}</td><td>${estadoCoste(c, p)}</td></tr>`).join('')}</tbody></table></div>`
    : '<p class="vacio">Ningún plato tiene todavía el coste calculado.</p>'}
    </div>`;

  const cats = {};
  const provs = {};
  for (const a of docs) {
    const g = gastoDe(a);
    if (!g) continue;
    cats[a.categoria] = (cats[a.categoria] || 0) + g;
    provs[a.proveedor] ??= { valor: 0, incompleto: false };
    provs[a.proveedor].valor += g;
    if (revisionAlbaran(a).some((x) => x.tipo === 'paginas')) provs[a.proveedor].incompleto = true;
  }
  barras($('#g-categoria'), Object.entries(cats).map(([etiqueta, valor]) => ({ etiqueta, valor })).sort((a, b) => b.valor - a.valor), gasto);
  barras($('#g-proveedor'), Object.entries(provs).map(([etiqueta, x]) => ({ etiqueta, valor: x.valor, marca: x.incompleto ? 'Incompleto' : '', extra: x.incompleto ? 'falta alguna página' : '' }))
    .sort((a, b) => b.valor - a.valor).slice(0, 12), gasto);
}

// --- Ajustes ---

function pintarAjustes() {
  const d = estado.datos;
  $('#v-ajustes').innerHTML = `
    <div class="titulo-vista"><div><h2>Ajustes</h2><p>Contraseña, lectura automática y copias de los datos.</p></div></div>
    <div class="rejilla-2">
      <form class="tarjeta" id="form-clave" style="display:grid;gap:12px;align-content:start">
        <div><h3>Contraseña de la dueña</h3>
        <p class="bajada" style="margin:2px 0 0">${d.ajustes.claveConfigurada ? 'Ya hay una. Si la cambias, los dispositivos que la recordaban tendrán que volver a entrar.' : 'Todavía no hay: ahora solo se entra con el PIN del editor de horarios. Crea una para la dueña.'} El PIN del editor de horarios también entra siempre.</p></div>
        <div class="campo"><label for="clave-nueva">Contraseña nueva (6 caracteres o más)</label><input type="password" id="clave-nueva" autocomplete="new-password" minlength="6" required></div>
        <div class="campo"><label for="clave-repetida">Repítela</label><input type="password" id="clave-repetida" autocomplete="new-password" minlength="6" required></div>
        <p class="error-txt" id="error-clave" hidden></p>
        <div><button class="btn">Guardar contraseña</button></div>
      </form>
      <div class="tarjeta" style="display:grid;gap:10px;align-content:start">
        <h3>Lectura automática de albaranes</h3>
        ${d.ia
    ? '<p><span class="estado bien">Activada</span></p><p class="bajada" style="margin:0">Cada foto o PDF se envía a Claude (Anthropic) para leer sus líneas; las fotos no se guardan en el servidor, solo en este dispositivo. Cuesta del orden de 5 a 10 céntimos por página.</p>'
    : '<p><span class="estado neutro">Apagada</span></p><p class="bajada" style="margin:0">Para activarla hay que crear una clave en console.anthropic.com y guardarla en Vercel como ANTHROPIC_API_KEY. Mientras tanto, los albaranes se rellenan a mano mirando la foto.</p>'}
      </div>
      <div class="tarjeta" style="display:grid;gap:10px;align-content:start">
        <h3>Copias de los datos</h3>
        <p class="bajada" style="margin:0">Para la gestoría o para guardar aparte. Los importes de los albaranes van sin IVA salvo la columna Total.</p>
        <div class="acciones">
          <button class="btn sec" data-accion="csv-albaranes">Albaranes (CSV)</button>
          <button class="btn sec" data-accion="csv-lineas">Líneas de albarán (CSV)</button>
          <button class="btn sec" data-accion="json-todo">Todo (JSON)</button>
        </div>
      </div>
      <div class="tarjeta" style="display:grid;gap:10px;align-content:start">
        <h3>Este dispositivo</h3>
        <p class="bajada" style="margin:0">Al salir se olvida la contraseña guardada. Las fotos de los albaranes siguen en este dispositivo.</p>
        <div><button class="btn sec" data-accion="salir">Salir</button></div>
      </div>
    </div>`;
}

function descargar(nombre, contenido, tipo) {
  const url = URL.createObjectURL(new Blob([contenido], { type: tipo }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// CSV para Excel en español: punto y coma, coma decimal y BOM para las tildes.
function csv(filas) {
  const celda = (v) => {
    if (v == null) return '';
    if (typeof v === 'number') return String(v).replace('.', ',');
    const t = String(v);
    return /[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  return `﻿${filas.map((f) => f.map(celda).join(';')).join('\r\n')}\r\n`;
}

const hoy = () => new Date().toISOString().slice(0, 10);

Object.assign(acciones, {
  salir: () => { if (confirm('¿Salir de la gestión en este dispositivo?')) salir(); },
  'csv-albaranes': () => descargar(`albaranes-${hoy()}.csv`, csv([
    ['Fecha', 'Proveedor', 'NIF', 'Documento', 'Número', 'Categoría', 'Base', 'IVA', 'Total', 'Suma al gasto', 'Estado', 'A reclamar'],
    ...estado.datos.albaranes.map((a) => [a.fecha, a.proveedor, a.nif, a.tipo === 'factura' ? 'Factura' : 'Albarán', a.numero, a.categoria,
      a.base, a.iva, a.total, a.sumar === false ? 'No' : 'Sí', a.estado === 'revisado' ? 'Revisado' : 'Por revisar', reclamable(a) || null]),
  ]), 'text/csv'),
  'csv-lineas': () => descargar(`lineas-albaranes-${hoy()}.csv`, csv([
    ['Fecha', 'Proveedor', 'Número', 'Texto en el albarán', 'Ingrediente', 'Cantidad', 'Unidad', 'Precio', 'Importe', 'IVA %', 'No entregado'],
    ...estado.datos.albaranes.flatMap((a) => a.lineas.map((l) => [a.fecha, a.proveedor, a.numero, l.orig, l.ing, l.cant, l.ud, l.precio, l.imp, l.iva, l.ne ? 'Sí' : ''])),
  ]), 'text/csv'),
  'json-todo': () => {
    const datos = { ...estado.datos };
    delete datos.ia;
    descargar(`gestion-morelia-${hoy()}.json`, JSON.stringify(datos, null, 2), 'application/json');
  },
});

registrarVista('resumen', pintarResumen);
registrarVista('ajustes', pintarAjustes);

// --- Eventos ---

document.addEventListener('click', (ev) => {
  const t = ev.target;
  const nav = t.closest('.nav button');
  if (nav) return mostrar(nav.dataset.vista);
  const acc = t.closest('[data-accion]');
  if (acc && acciones[acc.dataset.accion]) {
    ev.preventDefault();
    return acciones[acc.dataset.accion](acc, ev);
  }
  const alb = t.closest('[data-ir-albaran]');
  if (alb) return verAlbaran(alb.dataset.irAlbaran);
  const ing = t.closest('[data-ir-ing]');
  if (ing) { verIngrediente(ing.dataset.irIng); return mostrar('precios'); }
  const plato = t.closest('[data-ir-plato]');
  if (plato) return verPlato(plato.dataset.irPlato);
  const ir = t.closest('[data-ir]');
  if (ir) {
    if (ir.dataset.ir === 'pendientes') {
      const primero = porRevisar().at(-1);
      return primero ? verAlbaran(primero.id) : mostrar('albaranes');
    }
    return mostrar(ir.dataset.ir);
  }
});

document.addEventListener('change', (ev) => {
  if (ev.target.matches('[data-periodo]')) {
    estado.periodo = ev.target.value;
    local.escribir(PERIODO, estado.periodo);
    pintar();
  }
});

document.addEventListener('submit', async (ev) => {
  if (ev.target.id !== 'form-clave') return;
  ev.preventDefault();
  const nueva = $('#clave-nueva').value;
  const error = $('#error-clave');
  error.hidden = true;
  if (nueva !== $('#clave-repetida').value) {
    error.hidden = false;
    error.textContent = 'Las dos contraseñas no coinciden.';
    return;
  }
  try {
    const r = await api({ accion: 'ajustes', claveNueva: nueva });
    // Si se entró con la contraseña anterior (no con el PIN), ya no vale: este dispositivo pasa a la nueva.
    if (!r.porPin) {
      const recordada = local.leer(CLAVE) != null && (() => { try { return localStorage.getItem(CLAVE) != null; } catch { return false; } })();
      estado.clave = nueva;
      if (local.leer(CLAVE) != null) local.escribir(CLAVE, nueva, recordada);
    }
    pintar();
    toast('Contraseña guardada. Dásela a la dueña para que entre con ella.');
  } catch (e) {
    error.hidden = false;
    error.textContent = e.message;
  }
});

window.addEventListener('hashchange', () => {
  if (estado.datos) mostrar(location.hash.slice(1));
});

// Al volver a la pestaña se recargan los datos (pueden haber cambiado desde otro dispositivo).
document.addEventListener('visibilitychange', async () => {
  if (document.hidden || !estado.datos || estado.editor || Date.now() - cargadoEn < 120000) return;
  try {
    await api({ accion: 'estado' });
    cargadoEn = Date.now();
    if (estado.vista !== 'editor') pintar();
  } catch { /* se intentará la próxima vez */ }
});

// Tooltip compartido para barras, columnas, puntos y el medidor.
const tip = $('#tip');
document.addEventListener('pointermove', (ev) => {
  const el = ev.target.closest?.('[data-tip]');
  if (!el) { tip.hidden = true; return; }
  tip.textContent = el.dataset.tip;
  tip.hidden = false;
  const x = Math.min(ev.clientX + 14, window.innerWidth - tip.offsetWidth - 8);
  const y = ev.clientY + 16 + tip.offsetHeight > window.innerHeight ? ev.clientY - tip.offsetHeight - 10 : ev.clientY + 16;
  tip.style.left = `${Math.max(8, x)}px`;
  tip.style.top = `${y}px`;
});
document.addEventListener('pointerleave', () => { tip.hidden = true; });

iniciarAlbaranes();
iniciarPrecios();
iniciarEscandallos();
iniciarVentas();

const guardada = local.leer(CLAVE);
if (guardada) {
  entrar(guardada, null).catch((e) => {
    estado.clave = null;
    if (e.status === 401) local.borrar(CLAVE);
    pantallaAcceso(e.status === 401 ? 'La contraseña guardada ya no vale. Vuelve a entrar.' : e.message);
  });
} else {
  pantallaAcceso();
}
