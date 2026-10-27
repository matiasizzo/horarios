// Ventas: informes del TPV (por artículo de cada mes y diario), comparados mes a mes y cruzados con los escandallos.
import {
  estado, acciones, registrarVista, pintar, api, $, esc, num, eur, pct, plural, nombreMes, toast, ventana, hoyIso,
  barras, selectorPeriodo, mesesDe, ventasDeMes, textoHasta, articulos, ventasDePlato, calcular, conEscandallo, sinIva, mayuscula,
} from './gestion-base.js';
import { leerInforme, pareceBebida, diasDelMes, mesDe, redondear } from './gestion-comun.js';
import { verPlato } from './gestion-escandallos.js';

const NOMBRES_DIA = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const INICIAL = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];

const mesesConArticulos = () => Object.keys(estado.datos.ventas).sort();
const mesesConDiario = () => [...new Set(Object.keys(estado.datos.diario).map(mesDe))].sort();

function pintarVentas() {
  const cont = $('#v-ventas');
  const hayAlgo = mesesConArticulos().length || mesesConDiario().length;
  cont.innerHTML = `
    <div class="titulo-vista">
      <div><h2>Ventas</h2><p>Los informes del TPV: el de ventas por artículo de cada mes y el diario. Importes con IVA, como salen del TPV.</p></div>
      <span class="espacio"></span>
      ${hayAlgo ? selectorPeriodo() : ''}
      <button class="btn" data-accion="importar-tpv">Importar informe del TPV</button>
    </div>
    ${hayAlgo ? `
    <h3 class="seccion">Mes a mes</h3>
    <div class="tarjeta" id="ventas-meses"></div>
    <h3 class="seccion">Plato a plato · ${esc(nombreMes(estado.periodo))}</h3>
    <div id="ventas-articulos" style="display:grid;gap:18px"></div>
    <h3 class="seccion" id="titulo-dias"></h3>
    <div id="ventas-dias" style="display:grid;gap:18px"></div>`
    : '<div class="tarjeta vacio"><b>Todavía no hay ventas</b>Importa el informe del TPV (CSV) con el botón de arriba.</div>'}`;
  if (!hayAlgo) return;
  pintarMeses();
  pintarArticulos();
  pintarDias();
}

function pintarMeses() {
  const cont = $('#ventas-meses');
  const meses = mesesConArticulos().slice(-4);
  if (!meses.length) {
    cont.innerHTML = '<p class="vacio">Para comparar meses hace falta el informe de ventas por artículo de cada mes.</p>';
    return;
  }
  const t = Object.fromEntries(meses.map((m) => [m, ventasDeMes(m)]));
  const fila = (etiqueta, f, fuerte) => `<tr><td>${fuerte ? `<b>${etiqueta}</b>` : etiqueta}</td>${meses.map((m) => `<td class="d">${fuerte ? `<b>${f(t[m], m)}</b>` : f(t[m], m)}</td>`).join('')}</tr>`;
  let nota = '';
  if (meses.length >= 2) {
    const [a, b] = meses.slice(-2);
    const ritmo = (t[b].conIva / t[b].dias) / (t[a].conIva / t[a].dias) - 1;
    const ritmoBruto = (t[b].facturado / t[b].dias) / (t[a].facturado / t[a].dias) - 1;
    nota = `Por día, ${nombreMes(b, false).toLowerCase()} va un ${pct(Math.abs(ritmo))} ${ritmo < 0 ? 'por debajo' : 'por encima'} de ${nombreMes(a, false).toLowerCase()}`
      + (Math.abs(ritmoBruto - ritmo) > 0.02 ? `; antes de descuentos la diferencia es del ${pct(Math.abs(ritmoBruto))}.` : '.');
  }
  cont.innerHTML = `<div class="tabla-cont"><table>
    <thead><tr><th></th>${meses.map((m) => `<th class="d">${nombreMes(m, false)}<br><small style="text-transform:none;letter-spacing:0">${textoHasta(t[m])}</small></th>`).join('')}</tr></thead>
    <tbody>
      ${fila('Facturado', (v) => eur(v.facturado, 0))}
      ${fila('Descuentos e invitaciones', (v) => `${eur(v.descuentos, 0)} <span class="estado ${-v.descuentos / v.facturado > 0.1 ? 'mal' : 'neutro'}">${pct(-v.descuentos / v.facturado, 1)}</span>`)}
      ${fila('Vendido (con IVA)', (v) => eur(v.conIva, 0), true)}
      ${fila('Vendido sin IVA', (v) => eur(sinIva(v.conIva), 0))}
      ${fila('Comida', (v) => `${eur(v.comida, 0)} · ${pct(v.comida / v.facturado)}`)}
      ${fila('Bebida', (v) => `${eur(v.bebida, 0)} · ${pct(v.bebida / v.facturado)}`)}
      ${fila('Vendido por día', (v) => eur(v.conIva / v.dias, 0))}
    </tbody></table></div>
    ${nota ? `<p class="bajada" style="margin:10px 0 0">${esc(nota)}</p>` : ''}`;
}

function pintarArticulos() {
  const cont = $('#ventas-articulos');
  const meses = mesesDe(estado.periodo).filter((m) => estado.datos.ventas[m]);
  if (!meses.length) {
    cont.innerHTML = `<div class="tarjeta vacio"><b>No hay informe por artículos de ${esc(nombreMes(estado.periodo).toLowerCase())}</b>Impórtalo desde el TPV para ver qué platos se venden.</div>`;
    return;
  }
  const comidaL = articulos('comida', meses);
  const bebidaL = articulos('bebida', meses);
  const comida = comidaL.reduce((s, a) => s + a[2], 0);
  const bebida = bebidaL.reduce((s, a) => s + a[2], 0);
  const descuentos = meses.reduce((s, m) => s + estado.datos.ventas[m].descuentos, 0);
  const bruto = comida + bebida;
  const cuando = meses.length === 1 ? `${nombreMes(meses[0]).toLowerCase()} (${textoHasta(ventasDeMes(meses[0]))})` : `${plural(meses.length, 'mes', 'meses')}`;
  const aBarras = (lista, n) => lista.slice(0, n).map(([nombre, uds, imp]) => ({ etiqueta: mayuscula(nombre.toLowerCase()), valor: imp, extra: `${num(uds, 0)} unidades` }));
  const filas = conEscandallo().map((p) => ({ p, v: ventasDePlato(p, meses), c: calcular(p) })).filter(({ v }) => v);
  cont.innerHTML = `
    <div class="rejilla-4">
      <div class="cifra"><span class="et">Vendido, descontadas invitaciones</span><span class="val">${eur(bruto + descuentos, 0)}</span><span class="det">con IVA · ${esc(cuando)}</span></div>
      <div class="cifra"><span class="et">Comida</span><span class="val">${eur(comida, 0)}</span><span class="det">${pct(comida / bruto)} de lo facturado</span></div>
      <div class="cifra"><span class="et">Bebida</span><span class="val">${eur(bebida, 0)}</span><span class="det">${pct(bebida / bruto)} de lo facturado</span></div>
      <div class="cifra"><span class="et">Descuentos e invitaciones</span><span class="val">${eur(descuentos, 0)}</span><span class="det">${pct(-descuentos / bruto, 1)} de lo facturado</span></div>
    </div>
    <div class="rejilla-2">
      <div class="tarjeta"><h3>Comida que más factura</h3><p class="bajada">Importe con IVA. Las 12 primeras de ${comidaL.length}.</p><div class="barras" id="g-comida"></div></div>
      <div class="tarjeta"><h3>Bebida que más factura</h3><p class="bajada">Importe con IVA. Las 8 primeras de ${bebidaL.length}.</p><div class="barras" id="g-bebida"></div></div>
    </div>
    <div class="tarjeta">
      <h3>Lo que dejan los platos con escandallo</h3>
      <p class="bajada">Ventas sin IVA menos lo que costaron los ingredientes de esas raciones, con los precios de los albaranes.</p>
      ${filas.length ? `<div class="tabla-cont"><table>
        <thead><tr><th>Plato</th><th class="d">Raciones</th><th class="d">Precio medio cobrado</th><th class="d">Ventas sin IVA</th><th class="d">Coste</th><th class="d">Margen</th><th></th></tr></thead>
        <tbody>${filas.map(({ p, v: [, uds, imp], c }) => {
    const costeTotal = c?.coste != null ? uds * c.coste : null;
    return `<tr class="clic" data-ver-plato="${p.id}"><td>${esc(p.nombre)}</td><td class="d">${num(uds, 0)}</td><td class="d">${eur(imp / uds)}</td>
          <td class="d">${eur(sinIva(imp))}</td><td class="d">${costeTotal != null ? eur(costeTotal) : '—'}</td>
          <td class="d"><b>${costeTotal != null ? `${c.completo ? '' : '≤ '}${eur(sinIva(imp) - costeTotal)}` : '—'}</b></td>
          <td>${costeTotal == null ? '<span class="estado neutro">Falta precio de compra</span>' : c.completo ? '' : '<span class="estado neutro">Coste incompleto</span>'}</td></tr>`;
  }).join('')}</tbody></table></div>
        <p class="bajada" style="margin:10px 0 0">El precio medio cobrado sale por encima del de carta porque incluye el 10 % de terraza.</p>`
    : '<p class="vacio">Ningún plato con escandallo tiene ventas en este periodo. Revisa su "nombre en el TPV".</p>'}
    </div>`;
  barras($('#g-comida'), aBarras(comidaL, 12), comida);
  barras($('#g-bebida'), aBarras(bebidaL, 8), bebida);
}

function pintarDias() {
  const conDiario = mesesConDiario();
  const mes = estado.periodo !== 'todo' && conDiario.includes(estado.periodo) ? estado.periodo : estado.periodo === 'todo' ? conDiario.at(-1) : null;
  $('#titulo-dias').textContent = mes ? `${nombreMes(mes)} día a día` : 'Día a día';
  const cont = $('#ventas-dias');
  if (!mes) {
    cont.innerHTML = `<div class="tarjeta vacio"><b>No hay informe diario de ${esc(nombreMes(estado.periodo).toLowerCase())}</b>Importa el informe diario del TPV para ver cada día.</div>`;
    return;
  }
  const parciales = estado.datos.parciales;
  const dias = Object.entries(estado.datos.diario).filter(([f]) => f.startsWith(mes)).map(([f, [c, i]]) => [f, c, i]).sort((a, b) => a[0].localeCompare(b[0]));
  const total = dias.reduce((s, d) => s + d[2], 0);
  const cuentas = dias.reduce((s, d) => s + d[1], 0);
  const ultimo = dias.at(-1)[0];
  const parcialTxt = dias.filter(([f]) => parciales[f]).map(([f]) => `el ${Number(f.slice(8))} está incompleto (${parciales[f]})`).join('; ');
  cont.innerHTML = `
    <div class="rejilla-4">
      <div class="cifra"><span class="et">Ventas con IVA</span><span class="val">${eur(total, 0)}</span><span class="det">${plural(dias.length, 'día abierto', 'días abiertos')} · hasta el ${Number(ultimo.slice(8))}</span></div>
      <div class="cifra"><span class="et">Ventas sin IVA (10 %)</span><span class="val">${eur(sinIva(total), 0)}</span><span class="det">la base para comparar con las compras</span></div>
      <div class="cifra"><span class="et">Cuentas cobradas</span><span class="val">${num(cuentas, 0)}</span><span class="det">${num(cuentas / dias.length, 0)} por día</span></div>
      <div class="cifra"><span class="et">Ticket medio</span><span class="val">${cuentas ? eur(total / cuentas) : '—'}</span><span class="det">por cuenta, no por persona</span></div>
    </div>
    <div class="rejilla-ancha">
      <div class="tarjeta"><h3>Ventas por día</h3><p class="bajada">Importe con IVA de cada día abierto.${parcialTxt ? ` ${esc(mayuscula(parcialTxt))}.` : ''}</p><div id="g-dias"></div></div>
      <div class="tarjeta"><h3>Media por día de la semana</h3><p class="bajada">Sin contar los días incompletos.</p><div class="barras" id="g-semana"></div></div>
    </div>`;

  const ancho = 640;
  const alto = 230;
  const m = { l: 58, r: 8, t: 16, b: 38 };
  const maxDia = dias.reduce((a, d) => (d[2] > a[2] ? d : a));
  const paso1000 = maxDia[2] > 6000 ? 2000 : 1000;
  const maxEje = Math.max(paso1000, Math.ceil((maxDia[2] * 1.1) / paso1000) * paso1000);
  const paso = (ancho - m.l - m.r) / dias.length;
  const grosor = Math.max(4, Math.min(22, paso - 4));
  const Y = (v) => m.t + (1 - v / maxEje) * (alto - m.t - m.b);
  const marcas = [];
  for (let v = 0; v <= maxEje; v += paso1000) marcas.push(v);
  const rejilla = marcas.map((v) => `<line x1="${m.l}" x2="${ancho - m.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--rejilla)" stroke-width="1"/>
    <text x="${m.l - 8}" y="${Y(v) + 4}" font-size="11" text-anchor="end" fill="var(--texto-3)">${v ? eur(v, 0) : '0 €'}</text>`).join('');
  const columnas = dias.map(([f, n, imp], i) => {
    const d = new Date(`${f}T12:00:00`);
    const x = m.l + i * paso + (paso - grosor) / 2;
    const y = Y(Math.max(0, imp));
    const h = alto - m.b - y;
    const parcial = Boolean(parciales[f]);
    const r = Math.min(4, h);
    const forma = `M${x},${alto - m.b} V${y + r} Q${x},${y} ${x + r},${y} H${x + grosor - r} Q${x + grosor},${y} ${x + grosor},${y + r} V${alto - m.b} Z`;
    const tip = `${d.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' })} · ${eur(imp)} · ${n} cuentas${n ? ` · ticket medio ${eur(imp / n)}` : ''}${parcial ? ` · incompleto (${parciales[f]})` : ''}`;
    return `<g data-tip="${esc(tip)}">
      <rect x="${x - 2}" y="${m.t}" width="${grosor + 4}" height="${alto - m.b - m.t}" fill="transparent"/>
      <path d="${forma}" fill="var(--barra)" fill-opacity="${parcial ? 0.4 : 1}"/>
      ${f === maxDia[0] ? `<text x="${x + grosor / 2}" y="${y - 5}" font-size="11" text-anchor="middle" fill="var(--texto)">${eur(imp, 0)}</text>` : ''}
      <text x="${x + grosor / 2}" y="${alto - m.b + 14}" font-size="10.5" text-anchor="middle" fill="var(--texto-2)">${d.getDate()}</text>
      <text x="${x + grosor / 2}" y="${alto - m.b + 27}" font-size="10" text-anchor="middle" fill="var(--texto-3)">${INICIAL[d.getDay()]}</text>
    </g>`;
  }).join('');
  $('#g-dias').innerHTML = `<svg class="dias" viewBox="0 0 ${ancho} ${alto}" role="img" aria-label="Ventas con IVA de cada día">${rejilla}${columnas}</svg>`;

  const grupos = {};
  for (const [f, , imp] of dias) {
    if (parciales[f]) continue;
    (grupos[new Date(`${f}T12:00:00`).getDay()] ??= []).push(imp);
  }
  barras($('#g-semana'), [1, 2, 3, 4, 5, 6, 0].filter((w) => grupos[w]).map((w) => ({
    etiqueta: NOMBRES_DIA[w],
    valor: grupos[w].reduce((s, v) => s + v, 0) / grupos[w].length,
    extra: `media de ${plural(grupos[w].length, 'día', 'días')}`,
  })), 0);
}

// --- Importar informes ---

function decodificar(buffer) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer); } catch { return new TextDecoder('windows-1252').decode(buffer); }
}

function mesPorDefecto() {
  const hoy = hoyIso();
  if (Number(hoy.slice(8)) > 3) return hoy.slice(0, 7);
  const d = new Date(`${hoy.slice(0, 7)}-01T12:00:00`);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
const ultimoDia = (mes) => `${mes}-${String(diasDelMes(mes)).padStart(2, '0')}`;
const hastaPorDefecto = (mes) => (hoyIso().startsWith(mes) ? hoyIso() : ultimoDia(mes));

function abrirImportar() {
  let informe = null;
  let guardando = false;
  const tipos = {}; // artículo nuevo → 'comida' | 'bebida'
  const { velo, forzarCierre } = ventana(`
    <h3 style="font-size:1.15rem">Importar informe del TPV</h3>
    <p class="bajada" style="margin:0">El informe diario (ventas de cada día) o el de ventas por artículo de un mes, en CSV. Si ya había datos de esos días o de ese mes, se sustituyen.</p>
    <label class="soltar" style="display:block;cursor:pointer"><b>Elegir el archivo</b><br><input type="file" id="imp-archivo" accept=".csv,.txt,text/csv,text/plain"></label>
    <div id="imp-vista" style="display:grid;gap:12px"></div>
    <p class="error-txt" id="imp-error" hidden></p>
    <div class="acciones" style="justify-content:flex-end"><button class="btn sec" data-cerrar>Cancelar</button><button class="btn" id="imp-guardar" disabled>Guardar</button></div>`,
  { ancho: true, ocupado: () => guardando });
  const vista = $('#imp-vista', velo);
  const error = (t) => { $('#imp-error', velo).hidden = !t; $('#imp-error', velo).textContent = t || ''; };

  // Clasificación ya conocida de cada artículo, por los meses importados antes.
  const conocidos = {};
  for (const v of Object.values(estado.datos.ventas)) {
    for (const [n] of v.comida) conocidos[n] = 'comida';
    for (const [n] of v.bebida) conocidos[n] = 'bebida';
  }

  function vistaDiario() {
    const dias = informe.dias;
    const ultimo = dias.at(-1)[0];
    const yaEstaban = dias.filter(([f]) => estado.datos.diario[f]).length;
    const total = dias.reduce((s, d) => s + d[2], 0);
    vista.innerHTML = `
      <div class="cuadre"><span class="estado bien">Informe diario</span> ${plural(dias.length, 'día', 'días')}, del ${new Date(`${dias[0][0]}T12:00:00`).toLocaleDateString('es-ES')} al ${new Date(`${ultimo}T12:00:00`).toLocaleDateString('es-ES')} · <b class="num">${eur(total)}</b> con IVA · ${num(dias.reduce((s, d) => s + d[1], 0), 0)} cuentas</div>
      ${yaEstaban ? `<p class="ayuda" style="margin:0">${plural(yaEstaban, 'día ya estaba cargado y se sustituye', 'días ya estaban cargados y se sustituyen')}.</p>` : ''}
      <label class="chk"><input type="checkbox" id="imp-parcial"${ultimo === hoyIso() ? ' checked' : ''}> El ${Number(ultimo.slice(8))} está incompleto: el informe se sacó antes de cerrar</label>`;
  }

  function vistaArticulos() {
    const mes = $('#imp-mes', velo)?.value || mesPorDefecto();
    const hasta = $('#imp-hasta', velo)?.value || hastaPorDefecto(mes);
    const neto = informe.articulos.reduce((s, a) => s + a[2], 0) + informe.descuentos;
    const facturado = neto - informe.descuentos;
    const nuevos = informe.articulos.filter(([n]) => !conocidos[n]);
    for (const [n] of nuevos) tipos[n] ??= pareceBebida(n) ? 'bebida' : 'comida';
    const previo = estado.datos.ventas[mes];
    const cuadra = informe.registrado == null || Math.abs(redondear(neto) - informe.registrado) < 0.05;
    vista.innerHTML = `
      <div class="cuadre"><span class="estado bien">Ventas por artículo</span> ${plural(informe.articulos.length, 'artículo', 'artículos')} · facturado <b class="num">${eur(facturado)}</b> · descuentos <b class="num">${eur(informe.descuentos)}</b> · vendido <b class="num">${eur(neto)}</b>
        ${informe.registrado != null ? (cuadra ? '<span class="estado bien">Coincide con el total del informe</span>' : `<span class="estado aviso">El informe dice ${eur(informe.registrado)}</span>`) : ''}</div>
      <p class="ayuda" style="margin:0">Este informe no trae fechas: indica de qué mes es y hasta qué día llega.</p>
      <div class="form-rejilla">
        <div class="campo"><label for="imp-mes">Mes</label><input type="month" id="imp-mes" value="${mes}"></div>
        <div class="campo"><label for="imp-hasta">Hasta el día</label><input type="date" id="imp-hasta" value="${hasta.startsWith(mes) ? hasta : hastaPorDefecto(mes)}" min="${mes}-01" max="${ultimoDia(mes)}"></div>
      </div>
      ${previo ? `<div class="alerta aviso"><span class="ico">!</span><span><span class="t">Ya hay un informe de ${esc(nombreMes(mes).toLowerCase())} (${esc(textoHasta(ventasDeMes(mes)))}). Se sustituye por este.</span></span><span></span></div>` : ''}
      ${nuevos.length ? `<div><p class="ayuda" style="margin:0 0 6px">${plural(nuevos.length, 'artículo nuevo', 'artículos nuevos')}: comprueba si es comida o bebida.</p>
        <div class="clasificar">${nuevos.map(([n, , imp]) => `<div><span>${esc(n)} <span class="ayuda">${eur(imp, 0)}</span></span>
          <span class="filtros"><button type="button" data-tipo-art="${esc(n)}" data-tipo="comida" aria-pressed="${tipos[n] === 'comida'}">Comida</button><button type="button" data-tipo-art="${esc(n)}" data-tipo="bebida" aria-pressed="${tipos[n] === 'bebida'}">Bebida</button></span></div>`).join('')}</div></div>` : ''}`;
  }

  const pintarVista = () => (informe.tipo === 'diario' ? vistaDiario() : vistaArticulos());

  $('#imp-archivo', velo).addEventListener('change', async (ev) => {
    error('');
    const f = ev.target.files[0];
    if (!f) return;
    try {
      informe = leerInforme(decodificar(await f.arrayBuffer()));
      pintarVista();
      $('#imp-guardar', velo).disabled = false;
    } catch (e) {
      informe = null;
      vista.innerHTML = '';
      $('#imp-guardar', velo).disabled = true;
      error(e.message);
    }
  });
  velo.addEventListener('change', (ev) => {
    if (ev.target.id === 'imp-mes' && ev.target.value) {
      $('#imp-hasta', velo).value = hastaPorDefecto(ev.target.value);
      vistaArticulos();
    }
  });
  velo.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-tipo-art]');
    if (!b) return;
    tipos[b.dataset.tipoArt] = b.dataset.tipo;
    b.parentElement.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  });
  $('#imp-guardar', velo).addEventListener('click', async (ev) => {
    error('');
    const boton = ev.currentTarget;
    let cuerpo;
    let periodo;
    if (informe.tipo === 'diario') {
      const parcial = $('#imp-parcial', velo).checked ? informe.dias.at(-1)[0] : null;
      cuerpo = { accion: 'importarDiario', dias: informe.dias, parcial, nota: 'informe sacado antes del cierre' };
      periodo = mesDe(informe.dias.at(-1)[0]);
    } else {
      const mes = $('#imp-mes', velo).value;
      const hasta = $('#imp-hasta', velo).value;
      if (!mes || !hasta || !hasta.startsWith(mes)) return error('Indica el mes y un día de ese mes.');
      const tipo = (n) => conocidos[n] || tipos[n];
      cuerpo = {
        accion: 'importarVentas',
        ventas: {
          mes, hasta, completo: hasta === ultimoDia(mes) && hasta < hoyIso(), descuentos: informe.descuentos,
          comida: informe.articulos.filter(([n]) => tipo(n) === 'comida'),
          bebida: informe.articulos.filter(([n]) => tipo(n) === 'bebida'),
        },
      };
      periodo = mes;
    }
    guardando = true;
    boton.disabled = true;
    boton.textContent = 'Guardando…';
    try {
      await api(cuerpo);
      guardando = false;
      forzarCierre();
      estado.periodo = periodo;
      pintar();
      toast('Informe importado');
    } catch (e) {
      guardando = false;
      boton.disabled = false;
      boton.textContent = 'Guardar';
      error(e.message);
    }
  });
}

Object.assign(acciones, { 'importar-tpv': () => abrirImportar() });
registrarVista('ventas', pintarVentas);

export function iniciarVentas() {
  $('#v-ventas').addEventListener('click', (ev) => {
    const p = ev.target.closest('[data-ver-plato]');
    if (p) verPlato(p.dataset.verPlato);
  });
}
