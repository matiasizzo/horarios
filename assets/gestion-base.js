// Gestión: estado compartido, llamadas al servidor, formato y cálculos que usan varias secciones.
import {
  IVA_VENTA, OBJETIVO, calcularPlato, diasDelMes, gastoDe, mesDe, normalizar,
} from './gestion-comun.js';

export const estado = {
  clave: null,
  datos: null,
  vista: 'resumen',
  periodo: null, // 'AAAA-MM' o 'todo'
};

// Acciones de los botones (data-accion) y pintores de cada sección; los registra cada módulo.
export const acciones = {};
const pintores = {};
export const registrarVista = (vista, pintar) => { pintores[vista] = pintar; };
export const pintar = (vista = estado.vista) => {
  pintores[vista]?.();
  const pendientes = porRevisar().length;
  const cuenta = document.getElementById('cuenta-albaranes');
  cuenta.hidden = !pendientes;
  cuenta.textContent = pendientes;
};

// Antes de cambiar de sección se pregunta a quien tenga cambios sin guardar (devuelve false para quedarse).
export const guardas = { salir: null };
const VISTAS = ['resumen', 'albaranes', 'editor', 'precios', 'escandallos', 'ventas', 'ajustes'];

export function mostrar(vista, { forzar = false } = {}) {
  vista = VISTAS.includes(vista) ? vista : 'resumen';
  if (!forzar && vista !== estado.vista && guardas.salir && !guardas.salir()) return false;
  if (vista !== 'editor') guardas.salir = null;
  estado.vista = vista;
  for (const id of VISTAS) document.getElementById(`v-${id}`).hidden = id !== vista;
  const enNav = vista === 'editor' ? 'albaranes' : vista;
  document.querySelectorAll('.nav button').forEach((b) => {
    if (b.dataset.vista === enNav) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  if (vista !== 'editor') {
    try { history.replaceState(null, '', `#${vista}`); } catch { /* sin historial */ }
  }
  pintar(vista);
  window.scrollTo(0, 0);
  return true;
}

// --- Almacenamiento local (puede fallar en modo privado) ---
export const local = {
  leer(clave) {
    try { return localStorage.getItem(clave) ?? sessionStorage.getItem(clave); } catch { return null; }
  },
  escribir(clave, valor, recordar = true) {
    try { (recordar ? localStorage : sessionStorage).setItem(clave, valor); } catch { /* sin almacenamiento */ }
  },
  borrar(clave) {
    try { localStorage.removeItem(clave); sessionStorage.removeItem(clave); } catch { /* sin almacenamiento */ }
  },
};

// --- Servidor ---
let alCaducar = () => {};
export const siCaduca = (f) => { alCaducar = f; };
const MENSAJES = {
  413: 'El archivo es demasiado grande.',
  504: 'Tardó demasiado en responder. Prueba otra vez o página por página.',
};

export async function api(cuerpo) {
  let res;
  try {
    res = await fetch('/api/gestion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clave: estado.clave, ...cuerpo }),
    });
  } catch {
    throw new Error('Sin conexión. Comprueba internet y vuelve a probar.');
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && estado.datos) alCaducar();
    throw Object.assign(new Error(json.error || MENSAJES[res.status] || `Error ${res.status}`), json, { status: res.status });
  }
  if (json.datos) aplicarDatos(json.datos);
  return json;
}

export function aplicarDatos(datos) {
  estado.datos = datos;
  const meses = mesesConDatos();
  if (!estado.periodo || (estado.periodo !== 'todo' && !meses.includes(estado.periodo))) estado.periodo = meses[0] || 'todo';
  actualizarListas();
}

// --- Formato ---
export const $ = (s, raiz = document) => raiz.querySelector(s);
export const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const num = (n, d = 2) => Number(n).toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d });
export const eur = (n, d = 2) => `${num(n, d)} €`;
export const pct = (n, d = 0) => `${num(n * 100, d)} %`;
export const fecha = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
export const fechaLarga = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
export const cant = (n) => (n == null ? '—' : num(n, Number.isInteger(n) ? 0 : (String(n).split('.')[1] || '').length > 2 ? 3 : 2));
export const precioTxt = (p) => `${num(p, Math.abs(p) < 1 ? 3 : 2)} €`;
export const plural = (n, uno, varios) => `${num(n, 0)} ${n === 1 ? uno : varios}`;
export const mayuscula = (t) => t.charAt(0).toUpperCase() + t.slice(1);
export const hoyIso = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date());
export function nombreMes(mes, conAnio = true) {
  if (mes === 'todo') return 'Todo';
  const t = new Date(`${mes}-15T12:00:00`).toLocaleDateString('es-ES', conAnio ? { month: 'long', year: 'numeric' } : { month: 'long' });
  return mayuscula(t);
}

export function toast(mensaje) {
  document.querySelector('.toast')?.remove();
  const t = document.createElement('div');
  t.className = 'toast';
  t.setAttribute('role', 'status');
  t.textContent = mensaje;
  document.body.append(t);
  setTimeout(() => t.remove(), Math.max(3000, mensaje.length * 70));
}

// Ventana sobre la página. Se cierra con el fondo, con [data-cerrar] o con Escape, salvo que ocupado() diga que no.
export function ventana(html, { ancho = false, ocupado = () => false, alCerrar = () => {} } = {}) {
  const velo = document.createElement('div');
  velo.className = 'velo';
  velo.innerHTML = `<div class="modal${ancho ? ' ancho' : ''}" role="dialog" aria-modal="true">${html}</div>`;
  const cerrar = () => {
    if (ocupado()) return;
    velo.remove();
    document.removeEventListener('keydown', tecla);
    alCerrar();
  };
  const tecla = (ev) => { if (ev.key === 'Escape') cerrar(); };
  velo.addEventListener('click', (ev) => { if (ev.target === velo || ev.target.closest('[data-cerrar]')) cerrar(); });
  document.addEventListener('keydown', tecla);
  document.body.append(velo);
  velo.querySelector('input, select, button:not([data-cerrar])')?.focus();
  return { velo, cerrar, forzarCierre: () => { velo.remove(); document.removeEventListener('keydown', tecla); alCerrar(); } };
}

export function barras(cont, datos, total) {
  if (!datos.length) {
    cont.innerHTML = '<p class="vacio">Sin datos en este periodo.</p>';
    return;
  }
  const max = Math.max(...datos.map((d) => d.valor), 0.01);
  cont.innerHTML = datos.map((d) => `
    <div class="barra-fila" data-tip="${esc(d.etiqueta)} · ${eur(d.valor)}${total ? ` · ${pct(d.valor / total)} del total` : ''}${d.extra ? ` · ${esc(d.extra)}` : ''}">
      <span class="et">${esc(d.etiqueta)}${d.marca ? ` <span class="est">${esc(d.marca)}</span>` : ''}</span>
      <span class="barra-pista"><i style="width:${Math.max(0, d.valor / max) * 78}%"></i><span>${eur(d.valor, 0)}${total ? ` <small>${pct(d.valor / total)}</small>` : ''}</span></span>
    </div>`).join('');
}

// Listas para autocompletar (ingredientes, proveedores, secciones de la carta y nombres del TPV).
function actualizarListas() {
  const d = estado.datos;
  const listas = {
    'dl-ingredientes': [...new Set(d.albaranes.flatMap((a) => a.lineas.map((l) => l.ing)).concat(d.carta.flatMap((p) => p.comps.map((c) => c.ing))))].sort((a, b) => a.localeCompare(b, 'es')),
    'dl-proveedores': d.proveedores.map((p) => p.nombre).sort((a, b) => a.localeCompare(b, 'es')),
    'dl-secciones': [...new Set(d.carta.map((p) => p.seccion))],
    'dl-tpv': [...new Set(Object.values(d.ventas).flatMap((v) => v.comida.map((a) => a[0])))].sort(),
  };
  for (const [id, valores] of Object.entries(listas)) {
    let dl = document.getElementById(id);
    if (!dl) {
      dl = document.createElement('datalist');
      dl.id = id;
      document.body.append(dl);
    }
    dl.innerHTML = valores.map((v) => `<option value="${esc(v)}"></option>`).join('');
  }
}

// --- Datos derivados ---
export const objetivo = () => estado.datos.ajustes.objetivo ?? OBJETIVO;
export const calcular = (plato) => calcularPlato(plato, estado.datos.albaranes, objetivo());
export const albaranDe = (id) => estado.datos.albaranes.find((a) => a.id === id);
export const platoDe = (id) => estado.datos.carta.find((p) => p.id === id);
export const conEscandallo = () => estado.datos.carta.filter((p) => p.comps.length);
export const porRevisar = () => estado.datos.albaranes.filter((a) => a.estado !== 'revisado');

// Meses con albaranes o ventas, del más reciente al más antiguo.
export function mesesConDatos() {
  const d = estado.datos;
  const meses = new Set([
    ...d.albaranes.map((a) => mesDe(a.fecha)), ...Object.keys(d.ventas), ...Object.keys(d.diario).map(mesDe),
  ]);
  return [...meses].sort().reverse();
}
export const mesesDe = (periodo) => (periodo === 'todo' ? mesesConDatos() : [periodo]);
export const enPeriodo = (iso, periodo = estado.periodo) => periodo === 'todo' || iso.startsWith(periodo);

export function selectorPeriodo() {
  return `<select class="selector-periodo" data-periodo aria-label="Periodo">
    ${mesesConDatos().map((m) => `<option value="${m}"${m === estado.periodo ? ' selected' : ''}>${nombreMes(m)}</option>`).join('')}
    <option value="todo"${estado.periodo === 'todo' ? ' selected' : ''}>Todos los meses</option>
  </select>`;
}

const suma = (lista) => lista.reduce((s, a) => s + a[2], 0);

// Lo vendido en un mes: el informe por artículos si está; si no, la suma del informe diario.
export function ventasDeMes(mes) {
  const v = estado.datos.ventas[mes];
  if (v) {
    const comida = suma(v.comida);
    const bebida = suma(v.bebida);
    return {
      fuente: 'articulos', comida, bebida, facturado: comida + bebida, descuentos: v.descuentos,
      conIva: comida + bebida + v.descuentos, hasta: v.hasta, completo: v.completo, dias: Number(v.hasta.slice(8)),
    };
  }
  const dias = Object.entries(estado.datos.diario).filter(([f]) => f.startsWith(mes));
  if (!dias.length) return null;
  const hasta = dias.map(([f]) => f).sort().at(-1);
  return {
    fuente: 'diario', conIva: dias.reduce((s, [, [, i]]) => s + i, 0), hasta,
    completo: Number(hasta.slice(8)) === diasDelMes(mes) && !estado.datos.parciales[hasta], dias: Number(hasta.slice(8)),
  };
}

// Suma de ventas de un periodo; "parcial" si algún mes no está completo.
export function ventasDePeriodo(periodo = estado.periodo) {
  const meses = mesesDe(periodo).map((m) => [m, ventasDeMes(m)]).filter(([, v]) => v);
  if (!meses.length) return null;
  return {
    conIva: meses.reduce((s, [, v]) => s + v.conIva, 0),
    meses,
    parcial: meses.some(([, v]) => !v.completo),
  };
}

export const gastoDePeriodo = (periodo = estado.periodo) => estado.datos.albaranes
  .filter((a) => enPeriodo(a.fecha, periodo)).reduce((s, a) => s + gastoDe(a), 0);

export function textoHasta(v) {
  if (v.completo) return 'mes completo';
  return `hasta el ${Number(v.hasta.slice(8))}${estado.datos.parciales[v.hasta] ? ' (incompleto)' : ''}`;
}

// Artículos del TPV de varios meses (comida o bebida), sumados y ordenados por importe.
export function articulos(tipo, meses) {
  const juntos = new Map();
  for (const m of meses) {
    for (const [n, u, i] of estado.datos.ventas[m]?.[tipo] || []) {
      const a = juntos.get(n) || [n, 0, 0];
      a[1] += u;
      a[2] += i;
      juntos.set(n, a);
    }
  }
  return [...juntos.values()].sort((a, b) => b[2] - a[2]);
}

export function ventasDePlato(plato, meses) {
  if (!plato.tpv) return null;
  const n = normalizar(plato.tpv);
  return articulos('comida', meses).find(([nombre]) => normalizar(nombre) === n) || null;
}

export const sinIva = (conIva) => conIva / IVA_VENTA;

export function estadoCoste(c, plato) {
  if (!c || c.coste == null) return '<span class="estado neutro">Falta precio de compra</span>';
  const incompleto = !c.completo;
  const o = objetivo();
  if (incompleto && c.porcentaje > o) return '<span class="estado mal">Alto solo con lo que hay</span>';
  if (incompleto) return `<span class="estado neutro">${plato.falta ? 'Faltan ingredientes' : 'Falta algún precio'}</span>`;
  if (c.porcentaje <= o) return '<span class="estado bien">En objetivo</span>';
  if (c.porcentaje <= o + 0.05) return '<span class="estado aviso">Algo alto</span>';
  return '<span class="estado mal">Alto</span>';
}
export const minimo = (c) => (c && !c.completo ? '≥ ' : '');
