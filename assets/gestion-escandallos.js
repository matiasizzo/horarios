// Escandallos: coste de cada plato con los precios de los albaranes, y la carta con sus precios de venta.
import {
  estado, registrarVista, pintar, mostrar, guardas, api, $, esc, num, eur, pct, fecha, toast, objetivo, calcular,
  platoDe, conEscandallo, ventasDePlato, mesesConDatos, estadoCoste, minimo, nombreMes,
} from './gestion-base.js';
import { UNIDADES_PLATO, IVA_VENTA, precioComponente, unidadPrecio, calcularPlato } from './gestion-comun.js';

let seleccionado = null;
let borrador = null; // copia del plato que se está editando
let sucio = false;
let temporizadorObjetivo = null;

const valorNum = (n) => (n == null ? '' : String(n).replace('.', ','));
const numeroDe = (t) => {
  const s = String(t ?? '').trim().replace(/\s|€|%/g, '');
  if (!s) return null;
  const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s);
  return Number.isFinite(n) ? n : null;
};
const copia = (p) => JSON.parse(JSON.stringify(p));
const platoNuevo = () => ({ id: null, seccion: estado.datos.carta.at(-1)?.seccion || '', nombre: '', pvp: 0, tpv: '', falta: '', comps: [] });
const calcularBorrador = () => calcularPlato(borrador, estado.datos.albaranes, objetivo());

function marcarSucio(valor = true) {
  sucio = valor;
  guardas.salir = sucio ? () => {
    if (!confirm('Hay cambios sin guardar en el escandallo. ¿Salir sin guardarlos?')) return false;
    borrador = null;
    sucio = false;
    return true;
  } : null;
  document.querySelectorAll('[data-accion-plato="guardar"], [data-accion-plato="descartar"]').forEach((b) => { b.disabled = !sucio; });
}

function elegir(id) {
  if (sucio && !confirm('Hay cambios sin guardar en el escandallo. ¿Descartarlos?')) return false;
  seleccionado = id;
  borrador = id ? copia(platoDe(id)) : platoNuevo();
  marcarSucio(false);
  return true;
}

function vendidos(plato) {
  const v = ventasDePlato(plato, mesesConDatos());
  return v ? v[1] : null;
}

function pintarEscandallos() {
  const cont = $('#v-escandallos');
  if (seleccionado && !platoDe(seleccionado)) seleccionado = null;
  if (!borrador) {
    seleccionado ??= conEscandallo()[0]?.id || estado.datos.carta[0]?.id || null;
    borrador = seleccionado ? copia(platoDe(seleccionado)) : platoNuevo();
  }
  const platos = conEscandallo();
  cont.innerHTML = `
    <div class="titulo-vista">
      <div><h2>Escandallos</h2>
      <p>Cuánto cuesta servir cada plato con los precios del último albarán y si su precio de carta llega al objetivo. En la carne manda el rendimiento: lo que queda después de limpiar la pieza.</p></div>
      <span class="espacio"></span>
      <div class="campo" style="min-width:170px"><label for="objetivo">Objetivo de coste (% del precio sin IVA)</label>
        <input type="number" id="objetivo" min="10" max="60" step="1" value="${Math.round(objetivo() * 100)}"></div>
    </div>
    <div class="tabla-cont"><table>
      <thead><tr><th>Plato</th><th>Ingrediente principal</th><th class="d">Compra</th><th class="d">Rendim.</th><th class="d">Coste ración</th><th class="d">Precio carta</th><th class="d">% coste</th><th class="d">Vendidos</th><th>Estado</th></tr></thead>
      <tbody>${platos.map((p) => {
    const c = calcular(p);
    const principal = c.comps[0];
    return `<tr class="clic" data-plato="${p.id}" aria-selected="${p.id === seleccionado}">
          <td><b>${esc(p.nombre)}</b></td>
          <td>${esc(principal.ing)}<span class="orig">${principal.precio ? (principal.precio.fuente === 'manual' ? 'precio a mano' : `${esc(principal.precio.proveedor)} · ${fecha(principal.precio.fecha)}`) : 'sin precio de compra'}</span></td>
          <td class="d">${principal.precio ? `${num(principal.precio.valor)} ${unidadPrecio(principal.ud)}` : '—'}</td>
          <td class="d">${num(principal.rend, 0)} %${principal.medido ? '' : ' <span class="est" title="Estimado: falta que lo mida el jefe">Est.</span>'}</td>
          <td class="d">${c.coste != null ? `${minimo(c)}${eur(c.coste)}` : '—'}</td>
          <td class="d">${eur(p.pvp)}</td>
          <td class="d">${c.porcentaje != null ? `${minimo(c)}${pct(c.porcentaje)}` : '—'}</td>
          <td class="d">${vendidos(p) != null ? num(vendidos(p), 0) : '—'}</td>
          <td>${estadoCoste(c, p)}</td></tr>`;
  }).join('') || '<tr><td colspan="9" class="vacio">Ningún plato tiene escandallo todavía. Elige uno de la carta.</td></tr>'}</tbody>
    </table></div>
    <div class="tarjeta" id="editor-plato"></div>
    <div class="tarjeta">
      <div class="titulo-vista" style="margin-bottom:8px"><div><h3>Carta</h3><p class="bajada" style="margin:2px 0 0" id="carta-cobertura"></p></div>
        <span class="espacio"></span><button class="btn sec peq" data-accion-plato="nuevo">＋ Nuevo plato</button></div>
      <div class="tabla-cont"><table>
        <thead><tr><th>Plato</th><th class="d">Carta (con IVA)</th><th class="d">Sin IVA</th><th class="d">% coste</th><th class="d">Vendidos</th><th>Escandallo</th></tr></thead>
        <tbody id="t-carta"></tbody>
      </table></div>
      <p class="bajada" style="margin:10px 0 0">Los precios de la carta llevan el 10 % de IVA incluido. "Vendidos" son las raciones de todos los informes del TPV cargados.</p>
    </div>`;
  pintarCarta();
  pintarEditorPlato();
}

function pintarCarta() {
  const carta = estado.datos.carta;
  const con = carta.filter((p) => p.comps.length && calcular(p)?.coste != null).length;
  $('#carta-cobertura').textContent = `${con} de ${carta.length} platos tienen ya el coste calculado. Pulsa un plato para editarlo o añadirle su escandallo.`;
  let seccion = null;
  $('#t-carta').innerHTML = carta.map((p) => {
    const c = p.comps.length ? calcular(p) : null;
    const cabecera = p.seccion !== seccion ? `<tr class="grupo"><td colspan="6">${esc(p.seccion)}</td></tr>` : '';
    seccion = p.seccion;
    return `${cabecera}<tr class="clic" data-plato="${p.id}" aria-selected="${p.id === seleccionado}"><td>${esc(p.nombre)}</td><td class="d">${eur(p.pvp)}</td><td class="d">${eur(p.pvp / IVA_VENTA)}</td>
      <td class="d">${c?.porcentaje != null ? `${minimo(c)}${pct(c.porcentaje)}` : '—'}</td>
      <td class="d">${vendidos(p) != null ? num(vendidos(p), 0) : '—'}</td>
      <td>${c ? estadoCoste(c, p) : '<span style="color:var(--texto-3)">Sin escandallo</span>'}</td></tr>`;
  }).join('');
}

function filaComp(comp, i) {
  const precio = precioComponente({ ...comp, precio: null }, estado.datos.albaranes);
  const fuente = precio ? `${num(precio.valor)} ${unidadPrecio(comp.ud)} · ${esc(precio.proveedor)} ${fecha(precio.fecha)}` : 'sin albarán: escríbelo a mano';
  return `<tr>
    <td><input data-comp="${i}" data-col="ing" value="${esc(comp.ing)}" list="dl-ingredientes" style="min-width:180px" aria-label="Ingrediente" autocomplete="off"></td>
    <td><input class="d" inputmode="decimal" data-comp="${i}" data-col="cant" value="${valorNum(comp.cant)}" style="min-width:64px" aria-label="Cantidad"></td>
    <td><select data-comp="${i}" data-col="ud" aria-label="Unidad">${UNIDADES_PLATO.map((u) => `<option${u === comp.ud ? ' selected' : ''}>${u}</option>`).join('')}</select></td>
    <td><input class="d" inputmode="decimal" data-comp="${i}" data-col="rend" value="${valorNum(comp.rend)}" style="min-width:52px" aria-label="Rendimiento en %"></td>
    <td style="text-align:center"><input type="checkbox" data-comp="${i}" data-col="medido"${comp.medido ? ' checked' : ''} aria-label="Rendimiento medido" title="Medido por el jefe (si no, es una estimación)"></td>
    <td><input class="d" inputmode="decimal" data-comp="${i}" data-col="precio" value="${valorNum(comp.precio)}" placeholder="${precio ? valorNum(Math.round(precio.valor * 100) / 100) : '—'}" style="min-width:70px" aria-label="Precio a mano">
      <span class="orig" data-fuente="${i}">${comp.precio != null ? 'a mano' : fuente}</span></td>
    <td class="calc" data-coste="${i}"></td>
    <td><button type="button" class="quitar" data-accion-plato="quitar" data-i="${i}" aria-label="Quitar ingrediente">×</button></td>
  </tr>`;
}

function pintarEditorPlato() {
  const p = borrador;
  const cont = $('#editor-plato');
  const nuevo = !p.id;
  cont.innerHTML = `
    <div class="titulo-vista" style="margin-bottom:12px">
      <div><h3 style="font-size:1.15rem">${nuevo ? 'Nuevo plato' : esc(platoDe(p.id).nombre)}</h3>
      <p class="bajada" style="margin:2px 0 0">${nuevo ? 'Se añade a la carta al guardarlo.' : `${esc(platoDe(p.id).seccion)}${p.tpv ? ` · en el TPV: ${esc(p.tpv)}` : ''}`}</p></div>
      <span class="espacio"></span>
      <div class="acciones">
        ${nuevo ? '' : '<button class="btn peligro peq" data-accion-plato="borrar">Borrar plato</button>'}
        <button class="btn sec" data-accion-plato="descartar"${sucio ? '' : ' disabled'}>Descartar cambios</button>
        <button class="btn" data-accion-plato="guardar"${sucio ? '' : ' disabled'}>Guardar</button>
      </div>
    </div>
    <p class="error-txt" id="plato-error" hidden></p>
    <div class="form-rejilla">
      <div class="campo doble"><label for="pl-nombre">Nombre en la carta</label><input id="pl-nombre" data-campo-plato="nombre" value="${esc(p.nombre)}"></div>
      <div class="campo"><label for="pl-seccion">Sección</label><input id="pl-seccion" data-campo-plato="seccion" value="${esc(p.seccion)}" list="dl-secciones" autocomplete="off"></div>
      <div class="campo"><label for="pl-pvp">Precio en carta (con IVA)</label><input id="pl-pvp" data-campo-plato="pvp" inputmode="decimal" value="${valorNum(p.pvp)}"></div>
      <div class="campo doble"><label for="pl-tpv">Nombre en el TPV</label><input id="pl-tpv" data-campo-plato="tpv" value="${esc(p.tpv)}" list="dl-tpv" autocomplete="off" placeholder="Para cruzarlo con las ventas"></div>
    </div>
    <h3 style="margin:16px 0 6px;font-size:0.95rem">Ingredientes de una ración</h3>
    <div class="tabla-cont"><table class="tabla-edit">
      <thead><tr><th>Ingrediente</th><th class="d">Cantidad</th><th>Ud</th><th class="d" title="Lo que queda después de limpiar">Rend. %</th><th title="Rendimiento medido por el jefe">Medido</th><th class="d">Precio compra</th><th class="d">Coste</th><th></th></tr></thead>
      <tbody id="pl-comps">${p.comps.map(filaComp).join('') || '<tr><td colspan="8" class="vacio">Sin ingredientes. Empieza por el principal (la carne, en gramos en crudo y limpios).</td></tr>'}</tbody>
    </table></div>
    <div class="acciones" style="margin-top:8px"><button class="btn sec peq" data-accion-plato="comp-mas">＋ Añadir ingrediente</button></div>
    <p class="ayuda" style="margin:6px 0 0">Cantidad en crudo y limpia. El rendimiento es lo que queda de la pieza después de limpiarla (de 1 kg comprado, cuánto sirve). Si el precio de compra está en blanco se usa el del último albarán.</p>
    <div class="campo" style="margin-top:12px"><label for="pl-falta">Lo que falta por contar</label><input id="pl-falta" data-campo-plato="falta" value="${esc(p.falta)}" placeholder="Por ejemplo: guarnición y salsa"></div>
    <div id="plato-res" style="margin-top:14px"></div>`;
  pintarResultado();
}

function pintarResultado() {
  const p = borrador;
  const c = p.comps.length ? calcularBorrador() : null;
  c?.comps.forEach((x, i) => {
    const celda = document.querySelector(`[data-coste="${i}"]`);
    if (celda) celda.textContent = x.coste != null ? eur(x.coste) : '—';
  });
  const cont = $('#plato-res');
  if (!c) { cont.innerHTML = ''; return; }
  if (c.coste == null) {
    cont.innerHTML = `<div class="nota-falta">Falta el precio de compra de ${esc(c.sinPrecio.join(', '))}. Sube un albarán que lo traiga o escribe el precio a mano en la tabla.</div>`;
    return;
  }
  const o = objetivo();
  const color = c.porcentaje <= o ? 'var(--bien)' : c.porcentaje <= o + 0.05 ? 'var(--aviso)' : 'var(--mal)';
  const escala = 0.6;
  const principal = p.comps[0];
  const tope = Math.min(100, Math.max(75, Math.round(principal.rend / 5) * 5 + 10));
  const rends = [tope - 25, tope - 20, tope - 15, tope - 10, tope - 5, tope];
  const meses = mesesConDatos().filter((m) => estado.datos.ventas[m]);
  const porMes = meses.map((m) => [m, ventasDePlato(p, [m])]).filter(([, v]) => v);
  const total = ventasDePlato(p, meses);
  const avisos = [];
  if (p.falta) avisos.push(`Falta contar ${p.falta}: el coste real es más alto que el que se ve.`);
  if (c.sinPrecio.length) avisos.push(`Sin precio de compra: ${c.sinPrecio.join(', ')}. No se suman al coste.`);
  cont.innerHTML = `
    ${avisos.map((t) => `<div class="nota-falta" style="margin-bottom:10px">${esc(t)}</div>`).join('')}
    <div class="calc">
      <div class="resultado">
        <div>
          <div class="bajada" style="margin:0">Coste sobre el precio sin IVA</div>
          <div class="grande" style="color:var(--texto)">${minimo(c)}${pct(c.porcentaje, 1)} ${estadoCoste(c, p)}</div>
        </div>
        <div>
          <div class="medidor" data-tip="Objetivo ${pct(o)} · actual ${pct(c.porcentaje, 1)}"><i style="width:${Math.min(c.porcentaje / escala, 1) * 100}%;background:${color}"></i><b style="left:${(o / escala) * 100}%"></b></div>
          <div class="medidor-et"><span>0 %</span><span>objetivo ${pct(o)}</span><span>60 %</span></div>
        </div>
        ${principal.ud !== 'ud' && c.raciones ? `<p class="bajada" style="margin:0">De 1 kg de ${esc(principal.ing.toLowerCase())} salen <b class="num">${num(c.raciones, 1)}</b> raciones de ${num(principal.cant, 0)} ${principal.ud}${principal.medido ? '' : ' (rendimiento estimado: falta que el jefe pese una pieza antes y después de limpiarla)'}.</p>` : ''}
      </div>
      <div class="resultado">
        <div class="pares">
          <div class="par"><div class="et">Coste por ración</div><div class="val">${minimo(c)}${eur(c.coste)}</div></div>
          <div class="par"><div class="et">Margen por ración (sin IVA)</div><div class="val">${c.completo ? '' : '≤ '}${eur(c.margen)}</div></div>
          <div class="par"><div class="et">Precio para llegar al ${pct(o)}</div><div class="val">${minimo(c)}${eur(c.sugerido)}</div></div>
          <div class="par"><div class="et">Diferencia con la carta</div><div class="val">${c.sugerido - p.pvp > 0 ? '+' : ''}${eur(c.sugerido - p.pvp)}</div></div>
        </div>
        ${principal.ud !== 'ud' ? `<div>
          <div class="bajada" style="margin:0 0 6px">Si el rendimiento de ${esc(principal.ing.toLowerCase())} fuera otro:</div>
          <div class="sensibilidad">${rends.map((r) => {
    const cc = calcularPlato({ ...p, comps: [{ ...principal, rend: r }, ...p.comps.slice(1)] }, estado.datos.albaranes, o);
    return `<div class="${r === principal.rend ? 'actual' : ''}"><small>${r} %</small><b>${pct(cc.porcentaje)}</b></div>`;
  }).join('')}</div></div>` : ''}
      </div>
    </div>
    ${total ? `<p class="cuadre" style="margin:14px 0 0">Vendidos: ${porMes.map(([m, v]) => `<b class="num">${num(v[1], 0)}</b> en ${nombreMes(m, false).toLowerCase()}`).join(', ')}, a <b class="num">${eur(total[2] / total[1])}</b> de media (con terraza). Dejaron <b class="num">${c.completo ? '' : 'como mucho '}${eur(total[2] / IVA_VENTA - total[1] * c.coste)}</b> después de pagar ${c.completo ? 'los ingredientes' : 'lo que está contado'}.</p>`
    : p.tpv ? '' : '<p class="ayuda" style="margin:12px 0 0">Pon el nombre que tiene en el TPV para ver cuántos se venden.</p>'}`;
}

function leerCampo(ev) {
  const t = ev.target;
  if (t.dataset.campoPlato) {
    const c = t.dataset.campoPlato;
    borrador[c] = c === 'pvp' ? numeroDe(t.value) ?? 0 : t.value;
  } else if (t.dataset.comp) {
    const comp = borrador.comps[Number(t.dataset.comp)];
    const c = t.dataset.col;
    if (c === 'medido') comp.medido = t.checked;
    else if (['cant', 'rend', 'precio'].includes(c)) comp[c] = numeroDe(t.value);
    else comp[c] = t.value;
    if (c === 'precio' || c === 'ing' || c === 'ud') {
      const fuente = document.querySelector(`[data-fuente="${t.dataset.comp}"]`);
      const auto = precioComponente({ ...comp, precio: null }, estado.datos.albaranes);
      if (fuente) fuente.textContent = comp.precio != null ? 'a mano' : auto ? `${num(auto.valor)} ${unidadPrecio(comp.ud)} · ${auto.proveedor} ${fecha(auto.fecha)}` : 'sin albarán: escríbelo a mano';
    }
  } else {
    return false;
  }
  if (!sucio) marcarSucio(true);
  pintarResultado();
  return true;
}

async function guardarPlato() {
  const error = $('#plato-error');
  const fallo = (t) => { error.hidden = false; error.textContent = t; };
  error.hidden = true;
  const p = { ...borrador, comps: borrador.comps.filter((c) => c.ing.trim()) };
  if (!p.nombre.trim()) return fallo('Falta el nombre del plato.');
  if (!p.seccion.trim()) return fallo('Falta la sección de la carta.');
  const mala = p.comps.findIndex((c) => !c.cant || !c.rend || c.rend > 100);
  if (mala >= 0) return fallo(`Revisa la cantidad y el rendimiento de ${p.comps[mala].ing} (el rendimiento va de 1 a 100 %).`);
  try {
    const r = await api({ accion: 'guardarPlato', plato: p });
    seleccionado = r.id;
    borrador = copia(platoDe(r.id));
    marcarSucio(false);
    pintar();
    toast('Plato guardado');
  } catch (e) { fallo(e.message); }
}

export function verPlato(id) {
  if (!elegir(id)) return;
  mostrar('escandallos');
  $('#editor-plato')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

registrarVista('escandallos', pintarEscandallos);

export function iniciarEscandallos() {
  const cont = $('#v-escandallos');
  cont.addEventListener('click', async (ev) => {
    const fila = ev.target.closest('[data-plato]');
    if (fila && fila.dataset.plato !== seleccionado) {
      if (!elegir(fila.dataset.plato)) return;
      cont.querySelectorAll('[data-plato]').forEach((tr) => tr.setAttribute('aria-selected', String(tr.dataset.plato === seleccionado)));
      pintarEditorPlato();
      $('#editor-plato').scrollIntoView({ block: 'start', behavior: 'smooth' });
      return;
    }
    const b = ev.target.closest('[data-accion-plato]');
    if (!b) return;
    const accion = b.dataset.accionPlato;
    if (accion === 'guardar') return guardarPlato();
    if (accion === 'descartar') {
      borrador = seleccionado ? copia(platoDe(seleccionado)) : platoNuevo();
      marcarSucio(false);
      return pintarEditorPlato();
    }
    if (accion === 'nuevo') {
      if (!elegir(null)) return;
      pintarEditorPlato();
      $('#editor-plato').scrollIntoView({ block: 'start', behavior: 'smooth' });
      return $('#pl-nombre').focus();
    }
    if (accion === 'comp-mas') {
      borrador.comps.push({ ing: '', cant: borrador.comps.length ? 50 : 250, ud: 'g', rend: borrador.comps.length ? 100 : 85, precio: null });
      marcarSucio(true);
      pintarEditorPlato();
      return document.querySelector(`[data-comp="${borrador.comps.length - 1}"][data-col="ing"]`)?.focus();
    }
    if (accion === 'quitar') {
      borrador.comps.splice(Number(b.dataset.i), 1);
      marcarSucio(true);
      return pintarEditorPlato();
    }
    if (accion === 'borrar') {
      const p = platoDe(seleccionado);
      if (!confirm(`¿Borrar "${p.nombre}" de la carta y su escandallo?`)) return;
      try {
        await api({ accion: 'borrarPlato', id: p.id });
        seleccionado = null;
        borrador = null;
        marcarSucio(false);
        pintar();
        toast('Plato borrado');
      } catch (e) { toast(e.message); }
    }
  });
  cont.addEventListener('input', (ev) => {
    if (ev.target.id === 'objetivo') {
      const v = Number(ev.target.value);
      if (!(v >= 10 && v <= 60)) return;
      estado.datos.ajustes.objetivo = v / 100;
      pintarCarta();
      pintarResultado();
      clearTimeout(temporizadorObjetivo);
      temporizadorObjetivo = setTimeout(async () => {
        try { await api({ accion: 'ajustes', objetivo: v / 100 }); pintar(); } catch (e) { toast(e.message); }
      }, 800);
      return;
    }
    leerCampo(ev);
  });
  cont.addEventListener('change', (ev) => {
    if (ev.target.dataset.col === 'ud' || ev.target.dataset.col === 'medido') pintarResultado();
  });
}
