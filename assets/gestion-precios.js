// Precios de compra: último precio de cada ingrediente, su historial y en qué platos se usa.
import {
  estado, registrarVista, pintar, api, $, esc, num, fecha, fechaLarga, cant, precioTxt, toast,
} from './gestion-base.js';
import { tablaPrecios, historial, normalizar } from './gestion-comun.js';
import { verAlbaran } from './gestion-albaranes.js';
import { verPlato } from './gestion-escandallos.js';

let categoria = 'Todas';
let busqueda = '';
let seleccionado = null;

function filas() {
  const q = normalizar(busqueda);
  return tablaPrecios(estado.datos.albaranes)
    .filter((p) => (categoria === 'Todas' || p.categoria === categoria) && (!q || normalizar(`${p.ing} ${p.proveedor}`).includes(q)))
    .sort((x, y) => x.categoria.localeCompare(y.categoria, 'es') || x.ing.localeCompare(y.ing, 'es'));
}

function etiquetaCambio(c) {
  if (c == null) return '<span style="color:var(--texto-3)">Primer precio</span>';
  if (Math.abs(c) < 0.005) return '<span class="estado neutro">Igual</span>';
  return `<span class="estado ${c > 0 ? (c >= 0.05 ? 'mal' : 'aviso') : 'bien'}">${c > 0 ? '+' : '−'}${num(Math.abs(c) * 100, 1)} %</span>`;
}

function pintarPrecios() {
  const cont = $('#v-precios');
  const todas = tablaPrecios(estado.datos.albaranes);
  const categorias = ['Todas', ...new Set(todas.map((p) => p.categoria))];
  if (!categorias.includes(categoria)) categoria = 'Todas';
  const lista = filas();
  if (!lista.some((p) => normalizar(p.ing) === normalizar(seleccionado || ''))) seleccionado = lista[0]?.ing || null;
  cont.innerHTML = `
    <div class="titulo-vista"><div><h2>Precios de compra</h2>
      <p>El último precio de cada ingrediente, sacado de los albaranes, y cuánto cambió desde la compra anterior. Precio sin IVA y con los descuentos ya aplicados.</p></div></div>
    ${todas.length ? `
    <div class="filtros">${categorias.map((c) => `<button data-cat="${esc(c)}" aria-pressed="${c === categoria}">${esc(c)}</button>`).join('')}
      <span style="flex:1"></span><input class="buscar" id="buscar-precio" placeholder="Buscar ingrediente o proveedor" value="${esc(busqueda)}" aria-label="Buscar ingrediente"></div>
    <div class="rejilla-ancha">
      <div class="tabla-cont"><table>
        <thead><tr><th>Ingrediente</th><th>Proveedor</th><th class="d">Último precio</th><th class="d">Cambio</th><th class="d">Fecha</th></tr></thead>
        <tbody>${lista.map((p) => `<tr class="clic" data-ing="${esc(p.ing)}" aria-selected="${p.ing === seleccionado}">
          <td>${esc(p.ing)}</td><td>${esc(p.proveedor)}</td>
          <td class="d">${precioTxt(p.precio)}/${esc(p.ud)}</td><td class="d">${etiquetaCambio(p.cambio)}</td><td class="d">${fecha(p.fecha)}</td></tr>`).join('')
        || '<tr><td colspan="5" class="vacio">Ningún ingrediente con ese nombre.</td></tr>'}</tbody>
      </table></div>
      <div class="tarjeta" id="detalle-precio"></div>
    </div>` : '<div class="tarjeta vacio"><b>Todavía no hay precios</b>Aparecen al subir albaranes.</div>'}`;
  if (todas.length) pintarDetalle();
}

function grafico(compras, ud) {
  const h = compras.filter((c) => c.ud === ud);
  if (h.length < 2) return '<p class="cuadre">Solo hay una compra. Con el próximo albarán que lo traiga se verá si ha cambiado el precio.</p>';
  const ancho = 320;
  const alto = 130;
  const m = { l: 8, r: 52, t: 14, b: 22 };
  const ys = h.map((x) => x.precio);
  const margen = Math.max((Math.max(...ys) - Math.min(...ys)) * 0.15, Math.max(...ys) * 0.02);
  const min = Math.min(...ys) - margen;
  const max = Math.max(...ys) + margen;
  const X = (i) => m.l + (i * (ancho - m.l - m.r)) / (h.length - 1);
  const Y = (v) => m.t + (1 - (v - min) / (max - min)) * (alto - m.t - m.b);
  const linea = h.map((x, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(x.precio).toFixed(1)}`).join(' ');
  const area = `${linea} L${X(h.length - 1).toFixed(1)},${alto - m.b} L${X(0).toFixed(1)},${alto - m.b} Z`;
  const marcas = [Math.min(...ys), Math.max(...ys)].map((v) => `<line x1="${m.l}" x2="${ancho - m.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--rejilla)" stroke-width="1"/><text x="${ancho - m.r + 6}" y="${Y(v) + 4}" font-size="11" fill="var(--texto-3)">${num(v, v < 10 ? 2 : 1)} €</text>`).join('');
  return `<svg class="chispa" viewBox="0 0 ${ancho} ${alto}" role="img" aria-label="Precio en cada compra">
    ${marcas}
    <path d="${area}" fill="var(--barra)" fill-opacity="0.1"/>
    <path d="${linea}" fill="none" stroke="var(--barra)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    ${h.map((x, i) => `<circle cx="${X(i)}" cy="${Y(x.precio)}" r="${i === h.length - 1 ? 5 : 9}" fill="${i === h.length - 1 ? 'var(--barra)' : 'transparent'}" stroke="${i === h.length - 1 ? 'var(--superficie)' : 'none'}" stroke-width="2" data-tip="${fecha(x.fecha)} · ${esc(x.proveedor)} · ${precioTxt(x.precio)}/${esc(ud)}"/>`).join('')}
    <text x="${X(0)}" y="${alto - 6}" font-size="11" fill="var(--texto-3)">${fecha(h[0].fecha)}</text>
    <text x="${X(h.length - 1)}" y="${alto - 6}" font-size="11" fill="var(--texto-3)" text-anchor="end">${fecha(h.at(-1).fecha)}</text>
  </svg>`;
}

function pintarDetalle() {
  const cont = $('#detalle-precio');
  if (!seleccionado) { cont.innerHTML = '<p class="bajada">Elige un ingrediente.</p>'; return; }
  const compras = historial(estado.datos.albaranes, seleccionado);
  const ultima = compras.at(-1);
  const usado = estado.datos.carta.filter((p) => p.comps.some((c) => normalizar(c.ing) === normalizar(seleccionado)));
  cont.innerHTML = `
    <h3>${esc(seleccionado)}</h3>
    <p class="bajada">${esc(ultima.proveedor)} · última compra ${fechaLarga(ultima.fecha)}</p>
    <div class="grande num" style="font-size:2rem">${precioTxt(ultima.precio)}<span style="font-size:1rem;color:var(--texto-3)">/${esc(ultima.ud)}</span></div>
    <div style="margin-top:12px">${grafico(compras, ultima.ud)}</div>
    ${usado.length ? `<p style="margin:12px 0 0;font-size:0.9rem">Se usa en: ${usado.map((u) => `<button class="btn sec peq" data-ver-plato="${u.id}">${esc(u.nombre)}</button>`).join(' ')}</p>` : ''}
    <h3 style="margin-top:16px;font-size:0.92rem">Compras</h3>
    <div class="tabla-cont" style="margin-top:6px"><table>
      <thead><tr><th>Fecha</th><th>Proveedor</th><th class="d">Cantidad</th><th class="d">Precio</th></tr></thead>
      <tbody>${[...compras].reverse().map((c) => `<tr class="clic" data-ver-albaran="${c.albaran}" title="Ver el albarán">
        <td>${fecha(c.fecha)}</td><td>${esc(c.proveedor)}</td><td class="d">${cant(c.cant)} ${esc(c.ud)}</td><td class="d">${precioTxt(c.precio)}/${esc(c.ud)}</td></tr>`).join('')}</tbody>
    </table></div>
    <form id="form-renombrar" style="margin-top:16px;display:grid;gap:6px">
      <label class="ayuda" for="nuevo-nombre">Cambiar el nombre en todos los albaranes y escandallos. Si es el mismo producto que otro de la lista, escribe ese nombre y quedan unidos.</label>
      <div class="dos-campos"><span class="campo" style="flex:1"><input id="nuevo-nombre" list="dl-ingredientes" value="${esc(seleccionado)}" autocomplete="off"></span><button class="btn sec">Cambiar</button></div>
    </form>`;
}

registrarVista('precios', pintarPrecios);

export function verIngrediente(ing) {
  seleccionado = ing;
  categoria = 'Todas';
  busqueda = '';
}

export function iniciarPrecios() {
  const cont = $('#v-precios');
  cont.addEventListener('click', (ev) => {
    const c = ev.target.closest('[data-cat]');
    if (c) { categoria = c.dataset.cat; return pintarPrecios(); }
    const fila = ev.target.closest('[data-ing]');
    if (fila) {
      seleccionado = fila.dataset.ing;
      cont.querySelectorAll('[data-ing]').forEach((tr) => tr.setAttribute('aria-selected', String(tr.dataset.ing === seleccionado)));
      pintarDetalle();
      if (window.innerWidth < 760) $('#detalle-precio').scrollIntoView({ block: 'start', behavior: 'smooth' });
      return;
    }
    const alb = ev.target.closest('[data-ver-albaran]');
    if (alb) return verAlbaran(alb.dataset.verAlbaran);
    const plato = ev.target.closest('[data-ver-plato]');
    if (plato) return verPlato(plato.dataset.verPlato);
  });
  cont.addEventListener('input', (ev) => {
    if (ev.target.id !== 'buscar-precio') return;
    busqueda = ev.target.value;
    const pos = ev.target.selectionStart;
    pintarPrecios();
    const el = $('#buscar-precio');
    el.focus();
    el.setSelectionRange(pos, pos);
  });
  cont.addEventListener('submit', async (ev) => {
    if (ev.target.id !== 'form-renombrar') return;
    ev.preventDefault();
    const a = $('#nuevo-nombre').value.trim();
    if (!a || a === seleccionado) return;
    const existe = tablaPrecios(estado.datos.albaranes).some((p) => normalizar(p.ing) === normalizar(a));
    if (!confirm(existe ? `"${seleccionado}" se unirá con "${a}" en todos los albaranes y escandallos. ¿Seguir?` : `¿Cambiar "${seleccionado}" por "${a}" en todos los albaranes y escandallos?`)) return;
    try {
      const r = await api({ accion: 'renombrar', de: seleccionado, a });
      seleccionado = a;
      pintar();
      toast(`Cambiado en ${r.cambios} ${r.cambios === 1 ? 'línea' : 'líneas'} de albarán`);
    } catch (e) { toast(e.message); }
  });
}
