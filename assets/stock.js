// Control de stock en el móvil. Los cocineros cuentan su zona y, al enviarla, al jefe de cocina
// le llega un aviso; él ve el pedido agrupado por proveedor, lo ajusta y lo manda por WhatsApp.
import { DIAS_CORTOS, escapar } from './common.js';
import { estadoAvisos, soporte, cargarClavePublica, suscripcionPush, suscripcionActual } from './avisos.js';
import {
  UNIDADES, cantidadConUnidad, unidadPara, formatoCantidad, textoEntrega, cantidadesPedido, notasControl,
  pedidoPorProveedor, ultimasCantidades, cantidadSugerida, mensajePedido, enlaceWhatsApp, enlaceLlamada,
} from './stock-comun.js';

const app = document.getElementById('app');
const CLAVE_SESION = 'stock-sesion';
const CLAVE_COCINERO = 'stock-cocinero';
const CLAVE_AVISOS = 'stock-avisos-jefe';
const PREFIJO_BORRADOR = 'stock-borrador-';
const DIA = 24 * 60 * 60 * 1000;

const estado = {
  pin: null,
  rol: null,
  datos: null, // lo que devuelve el servidor (cada rol ve lo suyo)
  ultimas: {}, // última cantidad pedida de cada producto (solo jefe)
  cocina: [], // empleados de cocina, del horario
  borradores: {}, // recuento en curso de cada zona (también en el móvil)
  filtro: 'todos',
  notasAbiertas: new Set(),
  enviando: false,
  ultimoEnvio: null,
  // Pedido: cambios del jefe pendientes de guardar.
  cambiosPedido: { cantidades: {}, enviados: {} },
  estadoPedido: 'guardado', // guardado | pendiente | guardando | error
  // Catálogo e historial
  pestanaCatalogo: 'productos',
  pestanaHistorial: 'controles',
  busqueda: '',
  zonaCatalogo: 'todas',
  ordenando: false,
  catalogoOrden: null, // copia del catálogo mientras se ordena
  ocupadoAvisos: false,
};

// --- Almacenamiento local (puede fallar en modo privado) ---
const local = {
  leer(clave) {
    try { return localStorage.getItem(clave); } catch { return null; }
  },
  escribir(clave, valor) {
    try { localStorage.setItem(clave, valor); } catch { /* sin almacenamiento */ }
  },
  borrar(clave) {
    try { localStorage.removeItem(clave); } catch { /* sin almacenamiento */ }
  },
};

function toast(mensaje) {
  document.querySelector('.toast')?.remove();
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = mensaje;
  document.body.append(t);
  setTimeout(() => t.remove(), Math.max(3000, mensaje.length * 70));
}

async function api(cuerpo, pin = estado.pin) {
  const res = await fetch('/api/stock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin, ...cuerpo }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = Object.assign(new Error(json.error || `Error ${res.status}`), json, { status: res.status });
    if (res.status === 401 && estado.pin) {
      salir();
      pantallaPin('El PIN ya no es válido. Vuelve a entrar.');
    }
    throw error;
  }
  return json;
}

// --- Fechas ---
const F_FECHA = new Intl.DateTimeFormat('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
const F_HORA = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' });
const hora = (iso) => F_HORA.format(new Date(iso));
const fecha = (iso) => F_FECHA.format(new Date(iso));
const esHoy = (iso) => new Date(iso).toDateString() === new Date().toDateString();
const cuando = (iso) => (esHoy(iso) ? `hoy ${hora(iso)}` : `${fecha(iso)}, ${hora(iso)}`);
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

// --- Datos ---

function aplicarDatos(r) {
  const { resumen, avisados, existe, ok, ...datos } = r;
  estado.datos = datos;
  estado.cargadoEn = Date.now();
  estado.rol = datos.rol;
  if (datos.rol === 'jefe') {
    estado.ultimas = ultimasCantidades(datos.historial);
    reaplicarCambiosPedido();
  }
}

const zonas = () => estado.datos.zonas;
const zonaDe = (id) => zonas().find((z) => z.id === id);
const productoDe = (id) => estado.datos.productos.find((p) => p.id === id);
const productosZona = (zona) => estado.datos.productos.filter((p) => p.zona === zona && p.activo !== false);
const sugerido = (p) => p.sugerido ?? cantidadSugerida(p, estado.ultimas);
const nombreJefe = () => estado.datos.ajustes.jefe || 'el jefe de cocina';
const aJefe = () => (estado.datos.ajustes.jefe ? `a ${estado.datos.ajustes.jefe}` : 'al jefe de cocina');
const mayuscula = (t) => t.charAt(0).toUpperCase() + t.slice(1);

// Productos agrupados por proveedor, en el orden del catálogo.
function porProveedor(productos) {
  const grupos = new Map(estado.datos.proveedores.map((pv) => [pv.id, { proveedor: pv, productos: [] }]));
  for (const p of productos) grupos.get(p.proveedor)?.productos.push(p);
  return [...grupos.values()].filter((g) => g.productos.length);
}

// --- Recuento en curso (se guarda en el móvil hasta enviarlo) ---

function borrador(zona) {
  if (!estado.borradores[zona]) {
    let b = null;
    try { b = JSON.parse(local.leer(PREFIJO_BORRADOR + zona)); } catch { /* corrupto */ }
    // Un recuento a medias de hace más de un día ya no sirve.
    if (!b || Date.now() - b.creado > DIA) b = { creado: Date.now(), items: {} };
    estado.borradores[zona] = b;
  }
  return estado.borradores[zona];
}

function guardarBorrador(zona) {
  local.escribir(PREFIJO_BORRADOR + zona, JSON.stringify(estado.borradores[zona]));
}

function tieneBorrador(zona) {
  try {
    const b = JSON.parse(local.leer(PREFIJO_BORRADOR + zona));
    return b && Date.now() - b.creado <= DIA && Object.keys(b.items).length ? b : null;
  } catch {
    return null;
  }
}

function borrarBorrador(zona) {
  delete estado.borradores[zona];
  local.borrar(PREFIJO_BORRADOR + zona);
}

// --- Piezas comunes ---

function cabecera(titulo, sub, volver, derecha = '') {
  return `
    <header class="cabecera"><div class="cabecera-fila">
      ${volver ? `<a class="volver" href="${volver}" aria-label="Volver">‹</a>` : ''}
      <div style="flex:1;min-width:0">
        <h1>${escapar(titulo)}</h1>
        ${sub ? `<div class="sub">${escapar(sub)}</div>` : ''}
      </div>
      ${derecha}
    </div></header>`;
}

const ICONOS = {
  control: '<svg viewBox="0 0 24 24"><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4h6v3H9zM9 12l2 2 4-4"/></svg>',
  historial: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  catalogo: '<svg viewBox="0 0 24 24"><path d="M12 3l8 4v10l-8 4-8-4V7z"/><path d="M4 7l8 4 8-4M12 11v10"/></svg>',
  ajustes: '<svg viewBox="0 0 24 24"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/></svg>',
};

function pestanasJefe(actual) {
  const items = [['', 'control', 'Control'], ['historial', 'historial', 'Historial'], ['catalogo', 'catalogo', 'Catálogo'], ['ajustes', 'ajustes', 'Ajustes']];
  return `<nav class="pestanas-abajo">${items.map(([ruta, icono, nombre]) => `
    <a href="#/${ruta}" ${actual === ruta ? 'aria-current="page"' : ''}>${ICONOS[icono]}<span>${nombre}</span></a>`).join('')}</nav>`;
}

function abrirHoja(html, alClick) {
  const fondo = document.createElement('div');
  fondo.className = 'hoja-fondo';
  fondo.innerHTML = `<div class="hoja" role="dialog">${html}</div>`;
  fondo.addEventListener('click', (ev) => {
    if (ev.target === fondo || ev.target.closest('[data-cerrar]')) return fondo.remove();
    alClick?.(ev, fondo);
  });
  document.body.append(fondo);
  return fondo;
}

async function copiar(texto, aviso) {
  try {
    await navigator.clipboard.writeText(texto);
    toast(aviso);
  } catch {
    abrirHoja(`<h3>Copiar</h3><div class="campo"><textarea readonly rows="8">${escapar(texto)}</textarea></div>
      <div class="fila-botones"><button class="boton" data-cerrar>Listo</button></div>`);
  }
}

// --- PIN ---

function pantallaPin(error = '') {
  app.innerHTML = `
    ${cabecera('Control de stock', '')}
    <main>
      <form class="pin" id="form-pin">
        <p>Introduce tu PIN</p>
        <input id="pin" type="password" inputmode="numeric" autocomplete="current-password" autofocus>
        <div class="error">${escapar(error)}</div>
        <button class="boton" style="width:100%">Entrar</button>
        <p class="texto-suave">Los cocineros entran con el PIN de cocina y el jefe con el suyo.</p>
        <p><a class="link-btn" href="./">Ir a los horarios</a></p>
      </form>
    </main>`;
  document.getElementById('form-pin').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const pin = document.getElementById('pin').value.trim();
    const boton = ev.target.querySelector('button');
    boton.disabled = true;
    try {
      const r = await api({ accion: 'estado' }, pin);
      if (r.sinClave) return pantallaSinClave();
      estado.pin = pin;
      local.escribir(CLAVE_SESION, JSON.stringify({ pin }));
      aplicarDatos(r);
      await despuesDeEntrar();
    } catch (e) {
      pantallaPin(e.status === 401 ? 'PIN incorrecto' : `No se pudo entrar: ${e.message}`);
    }
  });
}

function pantallaSinClave() {
  app.innerHTML = `
    ${cabecera('Control de stock', 'Falta un paso', './')}
    <main>
      <div class="tarjeta">
        <div class="tarjeta-titulo">Falta la clave del stock en Vercel</div>
        <p>En Vercel → tu proyecto → <b>Settings → Environment Variables</b> crea la variable <b>STOCK_CLAVE</b>
          con el valor que te pasaron al instalar el control de stock, y después haz <b>Redeploy</b>.</p>
        <p class="texto-suave">El catálogo y los pedidos se guardan cifrados con esa clave: sin ella no se pueden leer.</p>
      </div>
    </main>`;
}

function salir() {
  local.borrar(CLAVE_SESION);
  estado.pin = null;
  estado.datos = null;
  estado.rol = null;
}

// --- Cocinero: quién eres y elegir zona ---

function quienCuenta() {
  return estado.rol === 'jefe' ? estado.datos.ajustes.jefe || 'Jefe de cocina' : local.leer(CLAVE_COCINERO);
}

function pantallaQuienEres() {
  return `
    <p style="margin:0 0 4px;font-size:1.1rem;font-weight:600">¿Quién eres?</p>
    <p class="texto-suave" style="margin-top:0">Así el jefe sabe quién hizo cada recuento.</p>
    <div class="nombres">
      ${estado.cocina.map((e) => `<button class="nombre-btn" data-soy="${escapar(e.nombre)}">${escapar(e.nombre)}</button>`).join('')}
    </div>
    <form class="tarjeta" id="form-otro" style="margin-top:16px">
      <label class="campo"><span>¿No estás en la lista? Escribe tu nombre</span><input id="otro-nombre" maxlength="40" autocomplete="given-name"></label>
      <button class="boton secundario" style="width:100%">Continuar</button>
    </form>`;
}

function chipZona(zona) {
  const enviada = estado.datos.control?.zonas[zona.id];
  if (enviada) return `<span class="chip ok">✓ ${escapar(enviada.por)} · ${cuando(enviada.enviado)}</span>`;
  const b = tieneBorrador(zona.id);
  if (b) return `<span class="chip curso">En curso · ${Object.keys(b.items).length}/${productosZona(zona.id).length}</span>`;
  return '<span class="chip">Pendiente</span>';
}

function inicioCocina() {
  const nombre = local.leer(CLAVE_COCINERO);
  const salirBtn = '<button class="salir" data-accion="salir">Salir</button>';
  const c = estado.datos.control;
  if (!nombre) return `${cabecera('Control de stock', estado.datos.ajustes.restaurante, null, salirBtn)}<main>${pantallaQuienEres()}</main>`;
  return `
    ${cabecera('Control de stock', estado.datos.ajustes.restaurante, null, salirBtn)}
    <main>
      <div class="saludo"><span>Hola, <b>${escapar(nombre)}</b></span><button class="link-btn" data-accion="cambiar-nombre">No soy yo</button></div>
      <div class="tarjeta">
        ${c
          ? `<div class="tarjeta-titulo">Hay un control en marcha</div><div class="texto-suave">Empezó ${cuando(c.inicio)}. Elige tu zona, cuenta y envíasela ${escapar(aJefe())}.</div>`
          : `<div class="tarjeta-titulo">Elige la zona que vas a contar</div><div class="texto-suave">Al enviarla le llega un aviso ${escapar(aJefe())}.</div>`}
      </div>
      <h2>Zonas</h2>
      <div class="zonas">
        ${zonas().map((z) => `
          <a class="zona-card" href="#/contar/${z.id}">
            <div><div class="zona-nombre">${escapar(z.nombre)}</div><div class="zona-sub">${plural(productosZona(z.id).length, 'producto', 'productos')}</div></div>
            ${chipZona(z)}<span class="flecha">›</span>
          </a>`).join('')}
      </div>
      <p class="pie">Lo que vas marcando se guarda en este móvil hasta que lo envías.</p>
    </main>`;
}

// --- Recuento de una zona (cocineros y jefe) ---

function filaItem(p, item) {
  const e = item?.e;
  const conNota = item && (item.n || estado.notasAbiertas.has(p.id));
  return `
    <div class="item ${e || ''}" data-p="${p.id}">
      <div class="item-fila">
        <div class="item-nombre">${escapar(p.nombre)}<small>${escapar(p.unidad)}</small></div>
        <div class="item-botones">
          <button class="btn-hay" data-marcar="ok" aria-pressed="${e === 'ok'}">✓ Hay</button>
          <button class="btn-pedir" data-marcar="pedir" aria-pressed="${e === 'pedir'}">Pedir</button>
        </div>
      </div>
      ${e === 'pedir' ? `
        <div class="item-pedir">
          <span>¿Cuánto pedir?</span>
          <div class="paso">
            <button data-paso="-1" aria-label="Menos">−</button>
            <input id="cant-${p.id}" type="number" inputmode="decimal" min="0" step="any" value="${item.c}" data-cantidad aria-label="Cantidad">
            <button data-paso="1" aria-label="Más">+</button>
          </div>
          <span class="unidad">${escapar(unidadPara(p.unidad, item.c))}</span>
        </div>` : ''}
      ${!item ? '' : conNota
        ? `<input class="item-nota" id="nota-${p.id}" data-nota maxlength="200" placeholder="Nota para ${escapar(nombreJefe())} (opcional)" value="${escapar(item.n || '')}">`
        : '<button class="link-btn item-nota-btn" data-abrir-nota>+ Añadir nota</button>'}
    </div>`;
}

function pantallaContar(zonaId) {
  const zona = zonaDe(zonaId);
  if (!zona) return pantallaNoEncontrada();
  if (estado.rol === 'cocina' && !quienCuenta()) {
    location.hash = '#/';
    return inicioCocina();
  }
  const productos = productosZona(zonaId);
  const { items } = borrador(zonaId);
  const revisados = productos.filter((p) => items[p.id]).length;
  const aPedir = productos.filter((p) => items[p.id]?.e === 'pedir').length;
  const pendientes = productos.length - revisados;
  const enviada = estado.datos.control?.zonas[zonaId];
  const visibles = productos.filter((p) => (estado.filtro === 'pendientes' ? !items[p.id]
    : estado.filtro === 'pedir' ? items[p.id]?.e === 'pedir' : true));
  const grupos = porProveedor(visibles);
  const filtro = (id, texto, n) => `<button data-filtro="${id}" aria-pressed="${estado.filtro === id}">${texto} · ${n}</button>`;
  let vacio = '';
  if (!visibles.length) {
    vacio = estado.filtro === 'pendientes' ? '✓ Ya revisaste todo. Puedes enviarlo.'
      : estado.filtro === 'pedir' ? 'Todavía no marcaste nada para pedir.' : 'Esta zona no tiene productos.';
  }
  return `
    ${cabecera(zona.nombre, `${revisados} de ${productos.length} revisados`, '#/')}
    <main class="con-barra">
      ${enviada ? `<div class="aviso">Esta zona ya la envió <b>${escapar(enviada.por)}</b> (${cuando(enviada.enviado)}). Si la vuelves a enviar, se reemplaza.</div>` : ''}
      <div class="progreso"><div style="width:${productos.length ? (revisados / productos.length) * 100 : 0}%"></div></div>
      <div class="filtros">
        ${filtro('todos', 'Todo', productos.length)}${filtro('pendientes', 'Sin revisar', pendientes)}${filtro('pedir', 'A pedir', aPedir)}
      </div>
      ${vacio ? `<div class="vacio">${vacio}</div>` : grupos.map((g) => `
        <h2>${escapar(g.proveedor.nombre)}</h2>
        <div class="items">${g.productos.map((p) => filaItem(p, items[p.id])).join('')}</div>`).join('')}
      <p class="pie">Toca <b>✓ Hay</b> si hay suficiente o <b>Pedir</b> si falta. Se guarda en este móvil hasta que lo envías.</p>
    </main>
    <div class="barra-inferior">
      <button class="boton" data-accion="enviar-zona" data-zona="${zonaId}" ${estado.enviando ? 'disabled' : ''}>
        ${estado.enviando ? 'Enviando…' : `${estado.rol === 'jefe' ? 'Pasar al pedido' : `Enviar ${escapar(estado.datos.ajustes.jefe ? `a ${estado.datos.ajustes.jefe}` : 'al jefe')}`} · ${aPedir} a pedir`}
      </button>
    </div>`;
}

function marcar(zona, id, valor) {
  const b = borrador(zona);
  const actual = b.items[id];
  if (actual?.e === valor) delete b.items[id]; // tocar otra vez el mismo botón lo deja sin revisar
  else b.items[id] = { ...actual, e: valor, c: actual?.c ?? sugerido(productoDe(id)) };
  guardarBorrador(zona);
  render();
}

async function enviarZona(zonaId, reemplazar = false) {
  const productos = productosZona(zonaId);
  const b = borrador(zonaId);
  const sinRevisar = productos.filter((p) => !b.items[p.id]).length;
  if (!reemplazar && sinRevisar && !confirm(`Quedan ${plural(sinRevisar, 'producto', 'productos')} sin revisar. ¿Enviar igual? Le aparecerán como "sin revisar".`)) {
    estado.filtro = 'pendientes';
    return render();
  }
  // Solo se envía lo de productos que siguen en la zona; la nota vacía no viaja.
  const items = {};
  for (const p of productos) {
    const it = b.items[p.id];
    if (!it) continue;
    items[p.id] = it.e === 'pedir' ? { e: 'pedir', c: it.c } : { e: 'ok' };
    if (it.n?.trim()) items[p.id].n = it.n.trim();
  }
  estado.enviando = true;
  render();
  try {
    const r = await api({ accion: 'enviarZona', zona: zonaId, por: quienCuenta(), items, reemplazar });
    aplicarDatos(r);
    borrarBorrador(zonaId);
    estado.ultimoEnvio = { zona: zonaId, items, avisados: r.avisados };
    estado.filtro = 'todos';
    estado.enviando = false;
    if (estado.rol === 'jefe') {
      toast(`${zonaDe(zonaId).nombre}: recuento añadido al pedido`);
      location.hash = '#/';
    } else {
      location.hash = `#/enviado/${zonaId}`;
    }
  } catch (e) {
    estado.enviando = false;
    render();
    if (e.codigo === 'zona-enviada') {
      if (confirm(`${e.message} ¿Reemplazar ese recuento por el tuyo?`)) enviarZona(zonaId, true);
    } else if (e.status !== 401) {
      toast(e.status ? `No se pudo enviar: ${e.message}` : 'Sin conexión. Tu recuento sigue guardado en este móvil: vuelve a enviarlo cuando tengas señal.');
    }
  }
}

function pantallaEnviado(zonaId) {
  const zona = zonaDe(zonaId);
  const envio = estado.ultimoEnvio?.zona === zonaId ? estado.ultimoEnvio : null;
  if (!zona || !envio) {
    location.hash = '#/';
    return '';
  }
  const pedir = Object.entries(envio.items).filter(([, it]) => it.e === 'pedir')
    .map(([id, it]) => ({ p: productoDe(id), it })).filter((x) => x.p);
  const lista = pedir.map(({ p, it }) => `• ${p.nombre}: ${cantidadConUnidad(it.c, p.unidad)}${it.n ? ` (${it.n})` : ''}`);
  const notas = Object.entries(envio.items).filter(([, it]) => it.e === 'ok' && it.n).map(([id, it]) => `• ${productoDe(id)?.nombre}: ${it.n}`);
  const tel = estado.datos.ajustes.whatsappJefe;
  const textoWa = `Ya está el stock de ${zona.nombre} (${quienCuenta()}): ${plural(pedir.length, 'producto', 'productos')} a pedir.\n${[...lista, ...notas].join('\n')}`;
  const wa = tel && enlaceWhatsApp(tel, textoWa);
  return `
    ${cabecera('Recuento enviado', zona.nombre, '#/')}
    <main>
      <div class="exito">
        <div class="exito-icono">✓</div>
        <h3>¡Listo, ${escapar(quienCuenta())}!</h3>
        <p>${envio.avisados ? `${escapar(mayuscula(aJefe()))} le llegó un aviso al móvil.` : `${escapar(mayuscula(nombreJefe()))} ya lo tiene en su pantalla de stock.`}</p>
      </div>
      <h2>Pediste (${pedir.length})</h2>
      ${pedir.length ? `<div class="lista">${pedir.map(({ p, it }) => `
        <div class="fila envuelve"><span class="quien">${escapar(p.nombre)}</span><span class="estado-item pedir">${escapar(cantidadConUnidad(it.c, p.unidad))}</span>
        ${it.n ? `<span class="nota-fila">“${escapar(it.n)}”</span>` : ''}</div>`).join('')}</div>`
        : '<div class="vacio">No hace falta pedir nada de esta zona.</div>'}
      <div class="acciones">
        ${wa ? `<a class="boton secundario" href="${wa}" target="_blank" rel="noopener">Avisar también por WhatsApp</a>` : ''}
        <a class="boton" href="#/">Volver a las zonas</a>
      </div>
    </main>`;
}

// --- Jefe: control en marcha y pedido por proveedor ---

function pantallaControl() {
  const d = estado.datos;
  const c = d.control;
  const avisoPines = !d.pinesConfigurados.cocina
    ? `<a class="aviso" href="#/ajustes" style="display:block;color:inherit">Falta crear el <b>PIN de los cocineros</b>: sin él no pueden entrar. Créalo en Ajustes ›</a>` : '';
  if (!c) {
    const ultimo = d.historial[0];
    return `
      ${cabecera('Control de stock', d.ajustes.restaurante)}
      <main class="con-barra">
        ${avisoPines}
        <div class="tarjeta">
          <div class="tarjeta-titulo">No hay ningún control en marcha</div>
          <p>Pide a los cocineros que cuenten su zona: les llega un aviso al móvil y, cuando terminan, te llega a ti el pedido por proveedor.</p>
          <button class="boton" data-accion="pedir-control">Pedir el control a los cocineros</button>
          <div class="dos-botones">
            ${zonas().map((z) => `<a class="boton secundario" href="#/contar/${z.id}">Contar ${escapar(z.nombre)} yo</a>`).join('')}
          </div>
        </div>
        ${ultimo ? `<a class="tarjeta" href="#/historial/${ultimo.id}">
          <div class="fila-esp"><span class="texto-suave">Último control</span><span class="flecha">›</span></div>
          <div><b>${fecha(ultimo.inicio)}</b> · ${plural(ultimo.lineas.length, 'producto', 'productos')} de ${plural(Object.keys(ultimo.proveedores).length, 'proveedor', 'proveedores')}</div>
        </a>` : ''}
      </main>
      ${pestanasJefe('')}`;
  }

  const grupos = pedidoPorProveedor(c, d);
  const pendientes = zonas().filter((z) => !c.zonas[z.id]);
  const lineas = grupos.reduce((n, g) => n + g.lineas.length, 0);
  const pedidos = grupos.filter((g) => c.pedido.enviados[g.proveedor.id]).length;
  return `
    ${cabecera('Control de stock', d.ajustes.restaurante)}
    <main class="con-barra">
      ${avisoPines}
      <div class="tarjeta">
        <div class="fila-esp"><div class="tarjeta-titulo">Control en marcha</div><button class="link-btn" data-accion="recargar">Actualizar</button></div>
        <div class="texto-suave">Empezó ${cuando(c.inicio)}${c.pedidoPor === 'jefe' ? ' · lo pediste tú' : ` · lo empezó ${escapar(c.pedidoPor)}`}</div>
        <div style="margin-top:8px">${zonas().map((z) => filaZonaControl(z, c)).join('')}</div>
        ${pendientes.length ? '<button class="boton secundario" data-accion="pedir-control" style="width:100%;margin-top:8px">Avisar a los cocineros</button>' : ''}
      </div>
      <div class="titulo-seccion"><h2>Pedido por proveedor</h2>${estadoGuardado()}</div>
      ${grupos.length ? `<div class="resumen-pedido">${plural(lineas, 'producto', 'productos')} · ${plural(grupos.length, 'proveedor', 'proveedores')} · ${pedidos} ya ${pedidos === 1 ? 'pedido' : 'pedidos'}</div>` : ''}
      ${grupos.length ? grupos.map((g) => tarjetaProveedor(g, c)).join('')
        : '<div class="vacio">Todavía no hay nada que pedir. Aparecerá aquí cuando los cocineros envíen su zona.</div>'}
      <button class="boton secundario" data-accion="anadir-producto" style="width:100%">+ Añadir un producto al pedido</button>
      <div class="acciones">
        <button class="boton" data-accion="cerrar-control">Cerrar el control y guardarlo</button>
        <button class="boton peligro" data-accion="descartar-control">Descartar este control</button>
      </div>
    </main>
    ${pestanasJefe('')}`;
}

function resumenItems(zonaId, items) {
  const valores = Object.values(items);
  const pedir = valores.filter((i) => i.e === 'pedir').length;
  const notas = valores.filter((i) => i.n).length;
  const sinRevisar = Math.max(0, productosZona(zonaId).length - valores.length);
  return [`${pedir} a pedir`, notas && plural(notas, 'nota', 'notas'), sinRevisar && `${sinRevisar} sin revisar`].filter(Boolean).join(' · ');
}

function filaZonaControl(z, c) {
  const enviada = c.zonas[z.id];
  return `
    <a class="zona-fila" href="#/zona/${z.id}">
      <b>${escapar(z.nombre)}</b>
      ${enviada ? `<span class="chip ok">✓ ${escapar(enviada.por)} · ${cuando(enviada.enviado)}</span>` : '<span class="chip">Pendiente</span>'}
      <span class="flecha">›</span>
      ${enviada ? `<span class="det">${resumenItems(z.id, enviada.items)}</span>` : ''}
    </a>`;
}

function estadoGuardado() {
  const textos = { guardado: '', pendiente: 'Sin guardar…', guardando: 'Guardando…', error: 'No se guardó · reintentar' };
  if (estado.estadoPedido === 'error') return `<button class="link-btn estado-guardado error" data-accion="guardar-pedido">${textos.error}</button>`;
  return `<span class="estado-guardado">${textos[estado.estadoPedido]}</span>`;
}

function tarjetaProveedor({ proveedor: pv, lineas }, c) {
  const pedido = c.pedido.enviados[pv.id];
  const texto = mensajePedido(pv, lineas, estado.datos.ajustes.restaurante);
  const wa = pv.whatsapp && enlaceWhatsApp(pv.telefono, texto);
  const llamar = enlaceLlamada(pv.telefono);
  const llamar2 = pv.telefono2 && enlaceLlamada(pv.telefono2);
  const info = [pv.contacto, pv.telefono, pv.telefono2, pv.entrega.length && `entrega ${textoEntrega(pv.entrega)}`].filter(Boolean);
  return `
    <div class="prov ${pedido ? 'pedido' : ''}" data-prov="${pv.id}">
      <div class="prov-cab">
        <div class="prov-nombre">${escapar(pv.nombre)}</div>
        ${pedido ? `<span class="chip ok">✓ Pedido ${hora(pedido)}</span>` : `<span class="chip pedir">${plural(lineas.length, 'producto', 'productos')}</span>`}
      </div>
      ${info.length ? `<div class="prov-info">${escapar(info.join(' · '))}</div>` : ''}
      ${pv.notas ? `<div class="prov-notas">${escapar(pv.notas)}</div>` : ''}
      <div class="prov-lineas">
        ${lineas.map(({ producto: p, cantidad: n, nota }) => `
          <div class="linea" data-p="${p.id}">
            <div class="linea-nombre">${escapar(p.nombre)}${nota ? `<div class="linea-nota">“${escapar(nota)}”</div>` : ''}</div>
            <div class="paso chico">
              <button data-paso-pedido="-1" aria-label="Menos">−</button>
              <input id="ped-${p.id}" type="number" inputmode="decimal" min="0" step="any" value="${n}" data-cantidad-pedido aria-label="Cantidad">
              <button data-paso-pedido="1" aria-label="Más">+</button>
            </div>
            <span class="unidad">${escapar(unidadPara(p.unidad, n))}</span>
            <button class="quitar" data-quitar-linea aria-label="Quitar del pedido">✕</button>
          </div>`).join('')}
      </div>
      <div class="prov-acciones">
        ${wa ? `<a class="boton wa" href="${wa}" target="_blank" rel="noopener">WhatsApp</a>` : ''}
        ${llamar ? `<a class="boton secundario" href="${llamar}">Llamar</a>` : ''}
        ${llamar2 ? `<a class="boton secundario" href="${llamar2}">Llamar 2</a>` : ''}
        <button class="boton secundario" data-copiar-prov="${pv.id}">Copiar</button>
      </div>
      <label class="check"><input type="checkbox" data-pedido-prov="${pv.id}" ${pedido ? 'checked' : ''}> Ya está pedido</label>
    </div>`;
}

// Los cambios del jefe se aplican al momento en pantalla y se guardan agrupados.
let temporizadorPedido = null;

function cambiarPedido(tipo, id, valor, { pintar = true } = {}) {
  const pedido = estado.datos.control.pedido;
  if (tipo === 'cantidades') pedido.cantidades[id] = valor;
  else if (valor) pedido.enviados[id] = new Date().toISOString();
  else delete pedido.enviados[id];
  estado.cambiosPedido[tipo][id] = valor;
  estado.estadoPedido = 'pendiente';
  clearTimeout(temporizadorPedido);
  temporizadorPedido = setTimeout(guardarPedido, 1200);
  if (pintar) render();
  else document.querySelector('.estado-guardado')?.replaceWith(htmlANodo(estadoGuardado()));
}

function htmlANodo(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstChild;
}

const hayCambiosPedido = () => Object.keys(estado.cambiosPedido.cantidades).length + Object.keys(estado.cambiosPedido.enviados).length > 0;

// Si llegan datos del servidor mientras hay cambios sin guardar, se vuelven a poner encima.
function reaplicarCambiosPedido() {
  const pedido = estado.datos.control?.pedido;
  if (!pedido) return;
  Object.assign(pedido.cantidades, estado.cambiosPedido.cantidades);
  for (const [id, v] of Object.entries(estado.cambiosPedido.enviados)) {
    if (v) pedido.enviados[id] ??= new Date().toISOString();
    else delete pedido.enviados[id];
  }
}

async function guardarPedido() {
  clearTimeout(temporizadorPedido);
  if (!hayCambiosPedido() || !estado.datos?.control) return true;
  const envio = estado.cambiosPedido;
  estado.cambiosPedido = { cantidades: {}, enviados: {} };
  estado.estadoPedido = 'guardando';
  document.querySelector('.estado-guardado')?.replaceWith(htmlANodo(estadoGuardado()));
  try {
    const r = await api({ accion: 'pedido', controlId: estado.datos.control.id, ...envio });
    aplicarDatos(r);
    estado.estadoPedido = hayCambiosPedido() ? 'pendiente' : 'guardado';
    if (!document.activeElement?.matches('input')) render();
    else document.querySelector('.estado-guardado')?.replaceWith(htmlANodo(estadoGuardado()));
    return true;
  } catch (e) {
    for (const tipo of ['cantidades', 'enviados']) estado.cambiosPedido[tipo] = { ...envio[tipo], ...estado.cambiosPedido[tipo] };
    estado.estadoPedido = 'error';
    if (e.codigo === 'control-cambiado') {
      estado.cambiosPedido = { cantidades: {}, enviados: {} };
      toast(e.message);
      await cargar();
    } else {
      render();
    }
    return false;
  }
}

function pasoCantidad(actual, paso) {
  const nuevo = Math.round((actual + paso) * 100) / 100;
  return nuevo > 0 ? nuevo : actual;
}

function abrirAnadirProducto() {
  const c = estado.datos.control;
  const enPedido = cantidadesPedido(c);
  let busqueda = '';
  const fondo = abrirHoja('', (ev) => {
    const b = ev.target.closest('[data-anadir]');
    if (!b) return;
    const p = productoDe(b.dataset.anadir);
    cambiarPedido('cantidades', p.id, sugerido(p));
    fondo.remove();
    toast(`${p.nombre} añadido al pedido`);
  });
  const dibujar = () => {
    const q = normalizar(busqueda);
    const candidatos = estado.datos.productos.filter((p) => !(enPedido[p.id] > 0)
      && (!q || normalizar(`${p.nombre} ${estado.datos.proveedores.find((x) => x.id === p.proveedor)?.nombre}`).includes(q)));
    fondo.querySelector('.resultados').innerHTML = porProveedor(candidatos).map((g) => `
      <div class="sub-grupo">${escapar(g.proveedor.nombre)}</div>
      ${g.productos.map((p) => `<button class="cat-fila" data-anadir="${p.id}"><span class="nom">${escapar(p.nombre)}<small>${escapar(p.unidad)}</small></span><span>＋</span></button>`).join('')}`).join('')
      || '<div class="vacio">No hay productos con ese nombre.</div>';
  };
  fondo.querySelector('.hoja').innerHTML = `
    <h3>Añadir al pedido</h3>
    <input class="buscar" placeholder="Buscar producto o proveedor" id="buscar-anadir">
    <div class="lista resultados"></div>
    <div class="fila-botones"><button class="boton secundario" data-cerrar>Cancelar</button></div>`;
  fondo.querySelector('#buscar-anadir').addEventListener('input', (ev) => {
    busqueda = ev.target.value;
    dibujar();
  });
  dibujar();
}

async function cerrarControl() {
  const c = estado.datos.control;
  const grupos = pedidoPorProveedor(c, estado.datos);
  const sinPedir = grupos.filter((g) => !c.pedido.enviados[g.proveedor.id]).map((g) => g.proveedor.nombre);
  const pendientes = zonas().filter((z) => !c.zonas[z.id]).map((z) => z.nombre);
  const avisos = [];
  if (pendientes.length) avisos.push(`Falta el recuento de: ${pendientes.join(', ')}.`);
  if (sinPedir.length) avisos.push(`Sin marcar como pedido: ${sinPedir.join(', ')}.`);
  if (!confirm(`${avisos.join('\n')}${avisos.length ? '\n\n' : ''}¿Cerrar el control y guardarlo en el historial?`)) return;
  if (!(await guardarPedido())) return toast('No se pudo guardar el pedido. Inténtalo de nuevo.');
  try {
    aplicarDatos(await api({ accion: 'cerrar', controlId: c.id }));
    toast('Control guardado en el historial');
    location.hash = `#/historial/${c.id}`;
  } catch (e) {
    toast(`No se pudo cerrar: ${e.message}`);
  }
}

async function descartarControl() {
  if (!confirm('¿Descartar este control? Se borran los recuentos y el pedido, y no queda en el historial.')) return;
  estado.cambiosPedido = { cantidades: {}, enviados: {} };
  try {
    aplicarDatos(await api({ accion: 'descartar', controlId: estado.datos.control.id }));
    toast('Control descartado');
    render();
  } catch (e) {
    toast(`No se pudo descartar: ${e.message}`);
  }
}

async function abrirPedirControl() {
  const fondo = abrirHoja('<h3>Pedir el control</h3><div class="sub">Cargando cocineros…</div>');
  let r;
  try {
    r = await api({ accion: 'destinatarios' });
  } catch (e) {
    fondo.querySelector('.sub').textContent = `No se pudieron cargar: ${e.message}`;
    return;
  }
  const hoy = r.cocineros.filter((c) => c.hoy);
  const nombres = (lista) => lista.map((c) => `${escapar(c.nombre)}${c.avisos || !r.avisosConfigurados ? '' : ' <span class="texto-suave">(sin avisos)</span>'}`).join(', ');
  const opcion = (valor, titulo, detalle, marcada) => `
    <label class="opcion"><input type="radio" name="avisar" value="${valor}" ${marcada ? 'checked' : ''}>
      <span><b>${titulo}</b><small>${detalle}</small></span></label>`;
  fondo.querySelector('.hoja').innerHTML = `
    <h3>${estado.datos.control ? 'Avisar a los cocineros' : 'Pedir el control'}</h3>
    <div class="sub">Les llega un aviso al móvil para que cuenten su zona.</div>
    ${r.avisosConfigurados ? '' : '<div class="aviso">Los avisos al móvil no están configurados (se configuran en el editor de horarios). Díselo en persona.</div>'}
    <div class="opciones">
      ${hoy.length ? opcion('hoy', 'Los que trabajan hoy', nombres(hoy), true) : ''}
      ${opcion('todos', 'Toda la cocina', nombres(r.cocineros), !hoy.length)}
      ${opcion('nadie', 'No avisar', 'Ya se lo dije en persona', false)}
    </div>
    <p class="texto-suave" style="font-size:.85rem">Quien no tiene los avisos activados no recibe nada: los activa desde su horario, en la app.</p>
    <div class="error"></div>
    <div class="fila-botones">
      <button class="boton secundario" data-cerrar>Cancelar</button>
      <button class="boton" data-confirmar>${estado.datos.control ? 'Avisar' : 'Empezar control'}</button>
    </div>`;
  fondo.querySelector('[data-confirmar]').addEventListener('click', async (ev) => {
    const avisar = fondo.querySelector('input[name="avisar"]:checked')?.value || 'nadie';
    ev.target.disabled = true;
    try {
      const res = await api({ accion: 'pedirControl', avisar });
      aplicarDatos(res);
      fondo.remove();
      const { enviados, sinAvisos } = res.resumen;
      let msj = avisar === 'nadie' ? 'Control en marcha.' : `Avisos enviados: ${enviados}.`;
      if (sinAvisos.length) msj += ` Sin avisos activados: ${sinAvisos.join(', ')} (díselo en persona).`;
      toast(msj);
      render();
    } catch (e) {
      ev.target.disabled = false;
      fondo.querySelector('.error').textContent = e.message;
    }
  });
}

// --- Jefe: lo que envió una zona ---

function pantallaZona(zonaId) {
  const zona = zonaDe(zonaId);
  const c = estado.datos.control;
  if (!zona) return pantallaNoEncontrada();
  const enviada = c?.zonas[zonaId];
  if (!enviada) {
    return `
      ${cabecera(zona.nombre, 'Pendiente', '#/')}
      <main class="con-barra">
        <div class="vacio">Todavía nadie envió el recuento de ${escapar(zona.nombre)}.</div>
        <div class="acciones"><a class="boton" href="#/contar/${zonaId}">Contarla yo</a></div>
      </main>
      ${pestanasJefe('')}`;
  }
  const productos = productosZona(zonaId);
  const filas = porProveedor(productos).map((g) => `
    <div class="sub-grupo">${escapar(g.proveedor.nombre)}</div>
    ${g.productos.map((p) => {
      const it = enviada.items[p.id];
      const estadoTxt = !it ? '<span class="estado-item falta">Sin revisar</span>'
        : it.e === 'ok' ? '<span class="estado-item ok">✓ Hay</span>'
          : `<span class="estado-item pedir">Pedir ${escapar(cantidadConUnidad(it.c, p.unidad))}</span>`;
      return `<div class="fila envuelve"><span class="quien">${escapar(p.nombre)}</span>${estadoTxt}
        ${it?.n ? `<span class="nota-fila">“${escapar(it.n)}”</span>` : ''}</div>`;
    }).join('')}`).join('');
  return `
    ${cabecera(zona.nombre, `${enviada.por} · ${cuando(enviada.enviado)}`, '#/')}
    <main class="con-barra">
      <div class="contadores"><span class="chip">${resumenItems(zonaId, enviada.items)}</span></div>
      <div class="lista">${filas}</div>
      <div class="acciones">
        <a class="boton secundario" href="#/contar/${zonaId}">Volver a contarla yo</a>
        <button class="boton peligro" data-accion="borrar-zona" data-zona="${zonaId}">Borrar este recuento</button>
      </div>
    </main>
    ${pestanasJefe('')}`;
}

async function borrarZona(zonaId) {
  if (!confirm('¿Borrar este recuento? La zona vuelve a quedar pendiente.')) return;
  try {
    aplicarDatos(await api({ accion: 'borrarZona', controlId: estado.datos.control.id, zona: zonaId }));
    location.hash = '#/';
  } catch (e) {
    toast(`No se pudo borrar: ${e.message}`);
  }
}

// --- Jefe: historial ---

function pantallaHistorial() {
  const h = estado.datos.historial;
  const pest = (id, nombre) => `<button data-pestana-historial="${id}" aria-pressed="${estado.pestanaHistorial === id}">${nombre}</button>`;
  let cuerpo;
  if (!h.length) {
    cuerpo = '<div class="vacio">Todavía no hay controles cerrados. Cuando cierres el primero, aparecerá aquí.</div>';
  } else if (estado.pestanaHistorial === 'controles') {
    cuerpo = h.map((x) => `
      <a class="tarjeta" href="#/historial/${x.id}">
        <div class="fila-esp"><b>${fecha(x.inicio)}</b><span class="texto-suave">${plural(x.lineas.length, 'producto', 'productos')} ›</span></div>
        <div class="texto-suave" style="font-size:.88rem">${Object.values(x.zonas).map((z) => `${escapar(z.nombre)}: ${escapar(z.por)}`).join(' · ') || 'Sin recuentos'}
          · ${plural(Object.keys(x.proveedores).length, 'proveedor', 'proveedores')}</div>
      </a>`).join('')
      + '<button class="boton secundario" data-accion="csv" style="width:100%">Descargar para Excel (CSV)</button>';
  } else {
    cuerpo = tablaProductos(h);
  }
  return `
    ${cabecera('Historial', plural(h.length, 'control guardado', 'controles guardados'))}
    <main class="con-barra">
      ${h.length ? `<div class="pestanas">${pest('controles', 'Controles')}${pest('productos', 'Por producto')}</div>` : ''}
      ${cuerpo}
    </main>
    ${pestanasJefe('historial')}`;
}

// Cuántas veces y cuánto se pidió de cada producto en los últimos controles.
function tablaProductos(historial) {
  const ultimos = historial.slice(0, 8);
  const datos = new Map();
  for (const control of ultimos) {
    for (const l of control.lineas) {
      const d = datos.get(l.p) || { nombre: l.n, unidad: l.u, veces: 0, total: 0, ultima: control.inicio };
      d.veces++;
      d.total += l.c;
      datos.set(l.p, d);
    }
  }
  const filas = [...datos.values()].sort((a, b) => b.veces - a.veces || a.nombre.localeCompare(b.nombre));
  return `
    <p class="texto-suave" style="margin-top:0">${ultimos.length === 1 ? 'En el último control' : `En los últimos ${ultimos.length} controles`}: cuántas veces se pidió cada producto y cuánto de media.</p>
    <div class="lista">${filas.map((d) => `
      <div class="fila"><span class="quien">${escapar(d.nombre)}<br><small class="texto-suave">último: ${fecha(d.ultima)}</small></span>
        <span class="cuando"><b>${d.veces} de ${ultimos.length}</b><small class="texto-suave">media ${escapar(cantidadConUnidad(d.total / d.veces, d.unidad))}</small></span></div>`).join('')}
    </div>`;
}

function pantallaControlPasado(id) {
  const x = estado.datos.historial.find((h) => h.id === id);
  if (!x) return pantallaNoEncontrada();
  const grupos = Object.entries(x.proveedores).map(([pid, pv]) => ({ pid, pv, lineas: x.lineas.filter((l) => l.v === pid) }));
  return `
    ${cabecera(`Control del ${fecha(x.inicio)}`, `Cerrado ${cuando(x.cierre)}`, '#/historial')}
    <main class="con-barra">
      <h2>Recuentos</h2>
      <div class="lista">${Object.values(x.zonas).map((z) => {
        const sinRevisar = Math.max(0, (z.total || 0) - Object.keys(z.items).length);
        return `<div class="fila"><span class="quien">${escapar(z.nombre)}</span>
          <span class="cuando">${escapar(z.por)} · ${cuando(z.enviado)}${sinRevisar ? `<small class="texto-suave">${sinRevisar} sin revisar</small>` : ''}</span></div>`;
      }).join('') || '<div class="vacio">Sin recuentos</div>'}</div>
      <h2>Pedido (${plural(x.lineas.length, 'producto', 'productos')})</h2>
      ${grupos.map(({ pv, lineas }) => `
        <div class="prov ${pv.pedido ? 'pedido' : ''}">
          <div class="prov-cab"><div class="prov-nombre">${escapar(pv.nombre)}</div>
            ${pv.pedido ? `<span class="chip ok">✓ Pedido ${cuando(pv.pedido)}</span>` : '<span class="chip">Sin marcar</span>'}</div>
          <div class="prov-lineas">${lineas.map((l) => `
            <div class="linea"><div class="linea-nombre">${escapar(l.n)}${l.nota ? `<div class="linea-nota">“${escapar(l.nota)}”</div>` : ''}</div>
              <span class="estado-item pedir">${escapar(cantidadConUnidad(l.c, l.u))}</span></div>`).join('')}</div>
        </div>`).join('') || '<div class="vacio">No se pidió nada.</div>'}
      <div class="acciones">
        <button class="boton secundario" data-accion="copiar-historial" data-id="${x.id}">Copiar el pedido completo</button>
        <button class="boton peligro" data-accion="borrar-historial" data-id="${x.id}">Borrar del historial</button>
      </div>
    </main>
    ${pestanasJefe('historial')}`;
}

function textoHistorial(x) {
  return Object.entries(x.proveedores).map(([pid, pv]) => `${pv.nombre}\n${x.lineas.filter((l) => l.v === pid)
    .map((l) => `• ${l.n}: ${cantidadConUnidad(l.c, l.u)}`).join('\n')}`).join('\n\n');
}

// CSV con punto y coma y coma decimal, que es como lo abre Excel en España.
function descargarCsv() {
  const celda = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const filas = [['Fecha', 'Proveedor', 'Producto', 'Cantidad', 'Unidad', 'Pedido', 'Nota']];
  for (const x of estado.datos.historial) {
    for (const l of x.lineas) {
      const pv = x.proveedores[l.v];
      filas.push([x.inicio.slice(0, 10), pv?.nombre, l.n, formatoCantidad(l.c), l.u, pv?.pedido ? 'sí' : 'no', l.nota]);
    }
  }
  const csv = '﻿' + filas.map((f) => f.map(celda).join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `stock-historial-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function borrarHistorial(id) {
  if (!confirm('¿Borrar este control del historial? No se puede deshacer.')) return;
  try {
    aplicarDatos(await api({ accion: 'borrarHistorial', id }));
    location.hash = '#/historial';
  } catch (e) {
    toast(`No se pudo borrar: ${e.message}`);
  }
}

// --- Jefe: catálogo ---

const normalizar = (t) => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function nuevoId(nombre, lista) {
  const base = normalizar(nombre).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'item';
  const usados = new Set(lista.map((x) => x.id));
  let id = base;
  for (let n = 2; usados.has(id); n++) id = `${base}-${n}`;
  return id;
}

const copiaCatalogo = () => structuredClone({
  zonas: estado.datos.zonas, proveedores: estado.datos.proveedores, productos: estado.datos.productos,
});

async function guardarCatalogo(catalogo, aviso = 'Guardado') {
  try {
    aplicarDatos(await api({ accion: 'catalogo', ...catalogo }));
    toast(aviso);
    render();
    return true;
  } catch (e) {
    toast(`No se pudo guardar: ${e.message}`);
    return false;
  }
}

function pantallaCatalogo() {
  const cat = estado.ordenando ? estado.catalogoOrden : estado.datos;
  const pest = (id, nombre) => `<button data-pestana-catalogo="${id}" aria-pressed="${estado.pestanaCatalogo === id}">${nombre}</button>`;
  let cuerpo;
  if (estado.pestanaCatalogo === 'productos') cuerpo = catalogoProductos(cat);
  else if (estado.pestanaCatalogo === 'proveedores') cuerpo = catalogoProveedores(cat);
  else cuerpo = catalogoZonas(cat);
  return `
    ${cabecera('Catálogo', `${plural(cat.productos.length, 'producto', 'productos')} · ${plural(cat.proveedores.length, 'proveedor', 'proveedores')}`)}
    <main class="con-barra">
      <div class="pestanas">
        ${pest('productos', 'Productos')}${pest('proveedores', 'Proveedores')}${pest('zonas', 'Zonas')}
      </div>
      ${cuerpo}
    </main>
    ${pestanasJefe('catalogo')}`;
}

function barraOrden(nuevo, textoNuevo) {
  if (estado.ordenando) {
    return `<div class="barra-titulo"><span class="texto-suave">Usa ↑ ↓ para cambiar el orden.</span><span class="espacio"></span>
      <button class="link-btn" data-accion="cancelar-orden">Cancelar</button>
      <button class="boton" data-accion="guardar-orden" style="padding:8px 14px">Guardar orden</button></div>`;
  }
  return `<div class="barra-titulo"><button class="boton" data-accion="${nuevo}" style="padding:9px 14px">+ ${textoNuevo}</button>
    <span class="espacio"></span><button class="link-btn" data-accion="ordenar">Ordenar</button></div>`;
}

const botonesMover = (tipo, id) => `<span class="mover"><button data-mover="${tipo}" data-id="${id}" data-dir="-1" aria-label="Subir">↑</button><button data-mover="${tipo}" data-id="${id}" data-dir="1" aria-label="Bajar">↓</button></span>`;

function catalogoProductos(cat) {
  const q = normalizar(estado.busqueda.trim());
  const filtroZona = (id, nombre) => `<button data-zona-catalogo="${id}" aria-pressed="${estado.zonaCatalogo === id}">${escapar(nombre)}</button>`;
  const secciones = cat.zonas.filter((z) => estado.zonaCatalogo === 'todas' || estado.zonaCatalogo === z.id).map((z) => {
    const productos = cat.productos.filter((p) => p.zona === z.id && (estado.ordenando || !q
      || normalizar(`${p.nombre} ${cat.proveedores.find((x) => x.id === p.proveedor)?.nombre}`).includes(q)));
    if (!productos.length) return '';
    const grupos = new Map(cat.proveedores.map((pv) => [pv.id, { pv, ps: [] }]));
    for (const p of productos) grupos.get(p.proveedor)?.ps.push(p);
    return `<h2>${escapar(z.nombre)} (${productos.length})</h2>
      <div class="lista">${[...grupos.values()].filter((g) => g.ps.length).map((g) => `
        <div class="sub-grupo">${escapar(g.pv.nombre)}</div>
        ${g.ps.map((p) => `
          <${estado.ordenando ? 'div' : 'button'} class="cat-fila ${p.activo === false ? 'inactivo' : ''}" ${estado.ordenando ? '' : `data-editar-producto="${p.id}"`}>
            <span class="nom">${escapar(p.nombre)}<small>${escapar(p.unidad)}${p.habitual ? ` · habitual ${escapar(formatoCantidad(p.habitual))}` : ''}${p.activo === false ? ' · no se cuenta' : ''}</small></span>
            ${estado.ordenando ? botonesMover('producto', p.id) : '<span class="texto-suave">›</span>'}
          </${estado.ordenando ? 'div' : 'button'}>`).join('')}`).join('')}
      </div>`;
  }).join('');
  return `
    ${barraOrden('nuevo-producto', 'Producto')}
    ${estado.ordenando ? '' : `<input class="buscar" id="buscar-catalogo" placeholder="Buscar producto o proveedor" value="${escapar(estado.busqueda)}">`}
    <div class="filtros" style="margin-bottom:8px">${filtroZona('todas', 'Todas')}${cat.zonas.map((z) => filtroZona(z.id, z.nombre)).join('')}</div>
    ${secciones || '<div class="vacio">No hay productos con ese nombre.</div>'}`;
}

function catalogoProveedores(cat) {
  return `
    ${barraOrden('nuevo-proveedor', 'Proveedor')}
    <div class="lista">${cat.proveedores.map((pv) => {
      const n = cat.productos.filter((p) => p.proveedor === pv.id).length;
      const det = [pv.contacto, pv.telefono, plural(n, 'producto', 'productos')].filter(Boolean).join(' · ');
      return `<${estado.ordenando ? 'div' : 'button'} class="cat-fila" ${estado.ordenando ? '' : `data-editar-proveedor="${pv.id}"`}>
        <span class="nom">${escapar(pv.nombre)}<small>${escapar(det)}</small></span>
        ${estado.ordenando ? botonesMover('proveedor', pv.id) : '<span class="texto-suave">›</span>'}
      </${estado.ordenando ? 'div' : 'button'}>`;
    }).join('') || '<div class="vacio">No hay proveedores.</div>'}</div>
    <p class="pie">El orden de los proveedores es el orden en que aparecen al contar y en el pedido.</p>`;
}

function catalogoZonas(cat) {
  return `
    ${barraOrden('nueva-zona', 'Zona')}
    <div class="lista">${cat.zonas.map((z) => `
      <${estado.ordenando ? 'div' : 'button'} class="cat-fila" ${estado.ordenando ? '' : `data-editar-zona="${z.id}"`}>
        <span class="nom">${escapar(z.nombre)}<small>${plural(cat.productos.filter((p) => p.zona === z.id).length, 'producto', 'productos')}</small></span>
        ${estado.ordenando ? botonesMover('zona', z.id) : '<span class="texto-suave">›</span>'}
      </${estado.ordenando ? 'div' : 'button'}>`).join('')}</div>
    <p class="pie">Cada cocinero elige su zona al empezar el recuento.</p>`;
}

// Mueve un elemento arriba o abajo; los productos solo se mueven entre los de su misma zona y proveedor.
function mover(tipo, id, dir) {
  const cat = estado.catalogoOrden;
  const lista = { producto: cat.productos, proveedor: cat.proveedores, zona: cat.zonas }[tipo];
  const i = lista.findIndex((x) => x.id === id);
  const mismoGrupo = (x) => tipo !== 'producto' || (x.zona === lista[i].zona && x.proveedor === lista[i].proveedor);
  let j = i + dir;
  while (j >= 0 && j < lista.length && !mismoGrupo(lista[j])) j += dir;
  if (j < 0 || j >= lista.length) return;
  [lista[i], lista[j]] = [lista[j], lista[i]];
  render();
}

function opciones(lista, actual) {
  return lista.map((x) => `<option value="${escapar(x.id)}" ${x.id === actual ? 'selected' : ''}>${escapar(x.nombre)}</option>`).join('');
}

function abrirProducto(id) {
  const existente = id ? productoDe(id) : null;
  const p = existente ? { ...existente } : {
    nombre: '', proveedor: estado.datos.proveedores[0]?.id, zona: estado.zonaCatalogo !== 'todas' ? estado.zonaCatalogo : zonas()[0].id, unidad: 'ud', activo: true,
  };
  if (!estado.datos.proveedores.length) return toast('Primero crea un proveedor');
  const pedidos = existente ? estado.datos.historial.flatMap((h) => h.lineas.filter((l) => l.p === id).map((l) => ({ fecha: h.inicio, l }))).slice(0, 8) : [];
  const fondo = abrirHoja(`
    <h3>${existente ? 'Editar producto' : 'Nuevo producto'}</h3>
    <label class="campo"><span>Nombre</span><input id="f-nombre" maxlength="80" value="${escapar(p.nombre)}"></label>
    <label class="campo"><span>Proveedor</span><select id="f-proveedor">${opciones(estado.datos.proveedores, p.proveedor)}</select></label>
    <label class="campo"><span>Zona donde se cuenta</span><select id="f-zona">${opciones(zonas(), p.zona)}</select></label>
    <label class="campo"><span>Unidad</span><select id="f-unidad">${UNIDADES.map((u) => `<option ${u === p.unidad ? 'selected' : ''}>${u}</option>`).join('')}</select></label>
    <label class="campo"><span>Cantidad habitual (se propone al pedir si no hay pedidos anteriores)</span>
      <input id="f-habitual" type="number" inputmode="decimal" min="0" step="any" value="${p.habitual ?? ''}"></label>
    <label class="check" style="margin-top:4px"><input type="checkbox" id="f-activo" ${p.activo !== false ? 'checked' : ''}> Aparece en el recuento</label>
    ${pedidos.length ? `<div class="campo" style="margin-top:12px"><span>Últimos pedidos</span><div class="historial-producto">
      ${pedidos.map(({ fecha: f, l }) => `<div><span>${fecha(f)}</span><b>${escapar(cantidadConUnidad(l.c, l.u))}</b></div>`).join('')}</div></div>` : ''}
    <div class="error"></div>
    <div class="fila-botones">
      ${existente ? '<button class="boton peligro" data-borrar>Borrar</button>' : ''}
      <button class="boton secundario" data-cerrar>Cancelar</button>
      <button class="boton" data-guardar>Guardar</button>
    </div>`, async (ev, f) => {
    const cat = copiaCatalogo();
    if (ev.target.closest('[data-borrar]')) {
      if (!confirm(`¿Borrar ${existente.nombre} del catálogo? Seguirá apareciendo en los controles pasados. Si solo quieres que no se cuente, desmarca "Aparece en el recuento".`)) return;
      cat.productos = cat.productos.filter((x) => x.id !== id);
      if (await guardarCatalogo(cat, 'Producto borrado')) f.remove();
      return;
    }
    if (!ev.target.closest('[data-guardar]')) return;
    const nombre = f.querySelector('#f-nombre').value.trim();
    const habitual = f.querySelector('#f-habitual').value.replace(',', '.');
    if (!nombre) return (f.querySelector('.error').textContent = 'Escribe el nombre.');
    const datos = {
      nombre,
      proveedor: f.querySelector('#f-proveedor').value,
      zona: f.querySelector('#f-zona').value,
      unidad: f.querySelector('#f-unidad').value,
      activo: f.querySelector('#f-activo').checked,
      ...(habitual ? { habitual: Number(habitual) } : {}),
    };
    if (existente) {
      const i = cat.productos.findIndex((x) => x.id === id);
      const resto = { ...cat.productos[i] };
      delete resto.habitual; // si se borró la cantidad habitual, que no quede la anterior
      // Al cambiar de zona o proveedor se coloca al final de su nuevo grupo.
      if (resto.zona !== datos.zona || resto.proveedor !== datos.proveedor) {
        cat.productos.splice(i, 1);
        cat.productos.push({ ...resto, ...datos });
      } else {
        cat.productos[i] = { ...resto, ...datos };
      }
    } else {
      cat.productos.push({ id: nuevoId(nombre, cat.productos), ...datos });
    }
    f.querySelector('[data-guardar]').disabled = true;
    if (await guardarCatalogo(cat, existente ? 'Producto guardado' : 'Producto añadido')) f.remove();
    else f.querySelector('[data-guardar]').disabled = false;
  });
  if (!existente) fondo.querySelector('#f-nombre').focus();
}

function abrirProveedor(id) {
  const existente = id ? estado.datos.proveedores.find((x) => x.id === id) : null;
  const pv = existente ? structuredClone(existente) : {
    nombre: '', contacto: '', telefono: '', telefono2: '', whatsapp: true, entrega: [], notas: '',
  };
  const productos = existente ? estado.datos.productos.filter((p) => p.proveedor === id).length : 0;
  const dias = () => DIAS_CORTOS.map((d, i) => `<button type="button" data-dia="${i}" aria-pressed="${pv.entrega.includes(i)}">${d.slice(0, 2)}</button>`).join('');
  const fondo = abrirHoja(`
    <h3>${existente ? 'Editar proveedor' : 'Nuevo proveedor'}</h3>
    <label class="campo"><span>Nombre</span><input id="f-nombre" maxlength="60" value="${escapar(pv.nombre)}"></label>
    <label class="campo"><span>Persona de contacto (para el saludo del mensaje)</span><input id="f-contacto" maxlength="40" value="${escapar(pv.contacto)}"></label>
    <label class="campo"><span>Teléfono</span><input id="f-telefono" type="tel" maxlength="30" value="${escapar(pv.telefono)}"></label>
    <label class="campo"><span>Otro teléfono (opcional)</span><input id="f-telefono2" type="tel" maxlength="30" value="${escapar(pv.telefono2)}"></label>
    <label class="check" style="margin:0 0 12px"><input type="checkbox" id="f-whatsapp" ${pv.whatsapp ? 'checked' : ''}> Se le pide por WhatsApp</label>
    <div class="campo"><span>Días de entrega</span><div class="dias-entrega">${dias()}</div></div>
    <label class="campo"><span>Cómo pedir (horario, antelación, mínimos…)</span><textarea id="f-notas" maxlength="200">${escapar(pv.notas)}</textarea></label>
    <div class="error"></div>
    <div class="fila-botones">
      ${existente ? '<button class="boton peligro" data-borrar>Borrar</button>' : ''}
      <button class="boton secundario" data-cerrar>Cancelar</button>
      <button class="boton" data-guardar>Guardar</button>
    </div>`, async (ev, f) => {
    const dia = ev.target.closest('[data-dia]');
    if (dia) {
      const i = Number(dia.dataset.dia);
      pv.entrega = pv.entrega.includes(i) ? pv.entrega.filter((x) => x !== i) : [...pv.entrega, i];
      dia.setAttribute('aria-pressed', pv.entrega.includes(i));
      return;
    }
    const cat = copiaCatalogo();
    if (ev.target.closest('[data-borrar]')) {
      if (productos) return (f.querySelector('.error').textContent = `Tiene ${plural(productos, 'producto', 'productos')}: pásalos a otro proveedor o bórralos antes.`);
      if (!confirm(`¿Borrar ${existente.nombre}?`)) return;
      cat.proveedores = cat.proveedores.filter((x) => x.id !== id);
      if (await guardarCatalogo(cat, 'Proveedor borrado')) f.remove();
      return;
    }
    if (!ev.target.closest('[data-guardar]')) return;
    const valor = (campo) => f.querySelector(campo).value.trim();
    const datos = {
      nombre: valor('#f-nombre'), contacto: valor('#f-contacto'), telefono: valor('#f-telefono'), telefono2: valor('#f-telefono2'),
      whatsapp: f.querySelector('#f-whatsapp').checked, entrega: [...pv.entrega].sort(), notas: valor('#f-notas'),
    };
    if (!datos.nombre) return (f.querySelector('.error').textContent = 'Escribe el nombre.');
    if (existente) Object.assign(cat.proveedores.find((x) => x.id === id), datos);
    else cat.proveedores.push({ id: nuevoId(datos.nombre, cat.proveedores), ...datos });
    if (await guardarCatalogo(cat, existente ? 'Proveedor guardado' : 'Proveedor añadido')) f.remove();
  });
  if (!existente) fondo.querySelector('#f-nombre').focus();
}

function abrirZona(id) {
  const existente = id ? zonaDe(id) : null;
  const productos = existente ? estado.datos.productos.filter((p) => p.zona === id).length : 0;
  const fondo = abrirHoja(`
    <h3>${existente ? 'Editar zona' : 'Nueva zona'}</h3>
    <label class="campo"><span>Nombre</span><input id="f-nombre" maxlength="40" value="${escapar(existente?.nombre || '')}"></label>
    <div class="error"></div>
    <div class="fila-botones">
      ${existente ? '<button class="boton peligro" data-borrar>Borrar</button>' : ''}
      <button class="boton secundario" data-cerrar>Cancelar</button>
      <button class="boton" data-guardar>Guardar</button>
    </div>`, async (ev, f) => {
    const cat = copiaCatalogo();
    if (ev.target.closest('[data-borrar]')) {
      if (productos) return (f.querySelector('.error').textContent = `Tiene ${plural(productos, 'producto', 'productos')}: pásalos a otra zona antes.`);
      if (cat.zonas.length === 1) return (f.querySelector('.error').textContent = 'Tiene que quedar al menos una zona.');
      if (!confirm(`¿Borrar la zona ${existente.nombre}?`)) return;
      cat.zonas = cat.zonas.filter((z) => z.id !== id);
      if (await guardarCatalogo(cat, 'Zona borrada')) f.remove();
      return;
    }
    if (!ev.target.closest('[data-guardar]')) return;
    const nombre = f.querySelector('#f-nombre').value.trim();
    if (!nombre) return (f.querySelector('.error').textContent = 'Escribe el nombre.');
    if (existente) cat.zonas.find((z) => z.id === id).nombre = nombre;
    else cat.zonas.push({ id: nuevoId(nombre, cat.zonas), nombre });
    if (await guardarCatalogo(cat, 'Zona guardada')) f.remove();
  });
  fondo.querySelector('#f-nombre').focus();
}

// --- Jefe: ajustes ---

function tarjetaAvisosJefe() {
  let contenido;
  const tipo = soporte();
  const activos = local.leer(CLAVE_AVISOS) === '1';
  if (!estadoAvisos.publica) {
    contenido = '<p>Los avisos al móvil todavía no están configurados. Se configuran una vez desde el editor de horarios.</p>';
  } else if (tipo === 'ios-sin-instalar') {
    contenido = '<p>En el iPhone, primero añade esta página a la pantalla de inicio (<b>Compartir → Añadir a pantalla de inicio</b>) y ábrela desde ese icono.</p>';
  } else if (tipo !== 'ok') {
    contenido = '<p>Este navegador no admite avisos.</p>';
  } else if (estadoAvisos.permiso === 'denied') {
    contenido = '<p>Los avisos están bloqueados en este móvil. Actívalos en los ajustes de notificaciones del navegador.</p>';
  } else if (activos) {
    contenido = `<p><b class="ok">✓ Activados.</b> Te llega un aviso cuando un cocinero termina su zona.</p>
      <button class="link-btn" data-accion="avisos-jefe-off" ${estado.ocupadoAvisos ? 'disabled' : ''}>Desactivar en este móvil</button>`;
  } else {
    contenido = `<p>Recibe un aviso en este móvil cuando un cocinero envíe su recuento.</p>
      <button class="boton" data-accion="avisos-jefe-on" style="width:100%" ${estado.ocupadoAvisos ? 'disabled' : ''}>${estado.ocupadoAvisos ? 'Activando…' : 'Activar avisos'}</button>`;
  }
  return `<div class="tarjeta"><div class="tarjeta-titulo">Avisos en este móvil</div>${contenido}</div>`;
}

function pantallaAjustes() {
  const d = estado.datos;
  const enlace = `${location.origin}/stock.html`;
  const pin = (quien, texto, configurado, sinTexto) => `
    <div class="fila-esp" style="padding:8px 0;border-top:1px solid var(--borde)">
      <span><b>${texto}</b><br><small class="${configurado ? 'ok' : 'texto-suave'}">${configurado ? '✓ Creado' : sinTexto}</small></span>
      <button class="boton secundario" data-cambiar-pin="${quien}" style="padding:9px 14px">${configurado ? 'Cambiar' : 'Crear'}</button>
    </div>`;
  return `
    ${cabecera('Ajustes', d.ajustes.restaurante)}
    <main class="con-barra">
      <div class="tarjeta">
        <div class="tarjeta-titulo">PINs</div>
        <p class="texto-suave" style="margin-top:2px">El PIN del editor de horarios también entra como jefe.</p>
        ${pin('jefe', 'PIN del jefe de cocina', d.pinesConfigurados.jefe, 'Sin crear')}
        ${pin('cocina', 'PIN de los cocineros', d.pinesConfigurados.cocina, 'Sin crear: los cocineros todavía no pueden entrar')}
      </div>
      <form class="tarjeta" id="form-ajustes">
        <div class="tarjeta-titulo" style="margin-bottom:10px">Datos</div>
        <label class="campo"><span>Nombre del restaurante (sale en los mensajes a proveedores)</span><input id="a-restaurante" maxlength="40" value="${escapar(d.ajustes.restaurante)}"></label>
        <label class="campo"><span>Nombre del jefe de cocina</span><input id="a-jefe" maxlength="40" value="${escapar(d.ajustes.jefe)}"></label>
        <label class="campo"><span>WhatsApp del jefe (opcional: los cocineros pueden avisarle también por ahí)</span><input id="a-whatsapp" type="tel" maxlength="30" value="${escapar(d.ajustes.whatsappJefe)}"></label>
        <button class="boton" style="width:100%">Guardar datos</button>
      </form>
      ${tarjetaAvisosJefe()}
      <div class="tarjeta">
        <div class="tarjeta-titulo">Cómo entran los cocineros</div>
        <p>Desde la app de horarios: en su horario les aparece el botón <b>Control de stock</b>. También pueden abrir esta dirección:</p>
        <div class="fila-esp"><code style="font-size:.85rem;word-break:break-all">${escapar(enlace)}</code>
          <button class="boton secundario" data-accion="copiar-enlace" style="padding:8px 12px;flex:none">Copiar</button></div>
      </div>
      <div class="acciones"><button class="boton peligro" data-accion="salir">Salir de este móvil</button></div>
    </main>
    ${pestanasJefe('ajustes')}`;
}

function abrirCambiarPin(quien) {
  const titulo = quien === 'jefe' ? 'PIN del jefe de cocina' : 'PIN de los cocineros';
  abrirHoja(`
    <h3>${titulo}</h3>
    <div class="sub">De 4 a 8 cifras. ${quien === 'cocina' ? 'Es el mismo para todos los cocineros.' : 'Solo para el jefe de cocina.'}</div>
    <label class="campo"><span>Nuevo PIN</span><input id="p1" type="password" inputmode="numeric" maxlength="8" autocomplete="new-password"></label>
    <label class="campo"><span>Repite el PIN</span><input id="p2" type="password" inputmode="numeric" maxlength="8" autocomplete="new-password"></label>
    <div class="error"></div>
    <div class="fila-botones"><button class="boton secundario" data-cerrar>Cancelar</button><button class="boton" data-guardar>Guardar</button></div>`,
  async (ev, f) => {
    if (!ev.target.closest('[data-guardar]')) return;
    const p1 = f.querySelector('#p1').value.trim();
    const p2 = f.querySelector('#p2').value.trim();
    const error = f.querySelector('.error');
    if (!/^\d{4,8}$/.test(p1)) return (error.textContent = 'Tiene que tener de 4 a 8 cifras.');
    if (p1 !== p2) return (error.textContent = 'Los dos PIN no coinciden.');
    try {
      aplicarDatos(await api({ accion: 'ajustes', [quien === 'jefe' ? 'pinJefe' : 'pinCocina']: p1 }));
      f.remove();
      toast(`${titulo} guardado`);
      render();
    } catch (e) {
      error.textContent = e.message;
    }
  });
}

async function guardarAjustes(form) {
  const boton = form.querySelector('button');
  boton.disabled = true;
  try {
    aplicarDatos(await api({
      accion: 'ajustes',
      restaurante: form.querySelector('#a-restaurante').value,
      jefe: form.querySelector('#a-jefe').value,
      whatsappJefe: form.querySelector('#a-whatsapp').value,
    }));
    toast('Datos guardados');
    render();
  } catch (e) {
    boton.disabled = false;
    toast(`No se pudo guardar: ${e.message}`);
  }
}

async function avisosJefe(activar) {
  estado.ocupadoAvisos = true;
  render();
  try {
    if (activar) {
      const sub = await suscripcionPush();
      await api({ accion: 'avisos', suscripcion: sub.toJSON() });
      local.escribir(CLAVE_AVISOS, '1');
      toast('Avisos activados');
    } else {
      // No se borra la suscripción del navegador: puede usarla también el aviso de horarios.
      const sub = await suscripcionActual();
      if (sub) await api({ accion: 'avisos', baja: true, suscripcion: sub.toJSON() });
      local.borrar(CLAVE_AVISOS);
    }
  } catch (e) {
    if (estadoAvisos.permiso !== 'denied') toast(`No se pudieron ${activar ? 'activar' : 'desactivar'}: ${e.message}`);
  }
  estado.ocupadoAvisos = false;
  render();
}

// Si este móvil tenía los avisos y se perdió la suscripción, se renueva sin que el jefe haga nada.
async function comprobarAvisosJefe() {
  await cargarClavePublica();
  estadoAvisos.permiso = typeof Notification === 'undefined' ? 'no-soportado' : Notification.permission;
  if (local.leer(CLAVE_AVISOS) !== '1' || !estadoAvisos.publica || soporte() !== 'ok') return;
  try {
    let sub = await suscripcionActual();
    if (!sub && Notification.permission === 'granted') sub = await suscripcionPush();
    if (!sub) return local.borrar(CLAVE_AVISOS);
    const { existe } = await api({ accion: 'avisos', comprobar: true, suscripcion: sub.toJSON() });
    if (!existe) await api({ accion: 'avisos', suscripcion: sub.toJSON() });
  } catch { /* se reintentará la próxima vez */ }
}

// --- Navegación ---

function pantallaNoEncontrada() {
  return `${cabecera('No encontrado', '', '#/')}<main><div class="vacio">Esta página no existe.</div></main>`;
}

function rutaActual() {
  return location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
}

function render() {
  if (!estado.datos) return;
  const [ruta, param] = rutaActual();
  let html;
  if (ruta === 'contar') html = pantallaContar(param);
  else if (ruta === 'enviado') html = pantallaEnviado(param);
  else if (estado.rol === 'cocina') html = inicioCocina();
  else if (ruta === 'zona') html = pantallaZona(param);
  else if (ruta === 'historial') html = param ? pantallaControlPasado(param) : pantallaHistorial();
  else if (ruta === 'catalogo') html = pantallaCatalogo();
  else if (ruta === 'ajustes') html = pantallaAjustes();
  else html = pantallaControl();
  if (!html) return;
  // El buscador redibuja la pantalla a cada letra: se le devuelve el foco.
  const buscando = document.activeElement?.id === 'buscar-catalogo';
  const cursor = document.activeElement?.selectionStart;
  app.innerHTML = html;
  if (buscando) {
    const el = document.getElementById('buscar-catalogo');
    el?.focus();
    el?.setSelectionRange(cursor, cursor);
  }
}

app.addEventListener('click', (ev) => {
  const t = ev.target;
  const [, param] = rutaActual();

  const soy = t.closest('[data-soy]');
  if (soy) {
    local.escribir(CLAVE_COCINERO, soy.dataset.soy);
    return render();
  }
  const marcarBtn = t.closest('[data-marcar]');
  if (marcarBtn) return marcar(param, marcarBtn.closest('[data-p]').dataset.p, marcarBtn.dataset.marcar);
  const paso = t.closest('[data-paso]');
  if (paso) {
    const id = paso.closest('[data-p]').dataset.p;
    const item = borrador(param).items[id];
    item.c = pasoCantidad(Number(item.c) || 0, Number(paso.dataset.paso));
    guardarBorrador(param);
    return render();
  }
  if (t.closest('[data-abrir-nota]')) {
    const id = t.closest('[data-p]').dataset.p;
    estado.notasAbiertas.add(id);
    render();
    return document.getElementById(`nota-${id}`)?.focus();
  }
  const filtro = t.closest('[data-filtro]');
  if (filtro) {
    estado.filtro = filtro.dataset.filtro;
    return render();
  }

  // Pedido del jefe
  const pasoPedido = t.closest('[data-paso-pedido]');
  if (pasoPedido) {
    const id = pasoPedido.closest('[data-p]').dataset.p;
    const actual = cantidadesPedido(estado.datos.control)[id] || 0;
    return cambiarPedido('cantidades', id, pasoCantidad(actual, Number(pasoPedido.dataset.pasoPedido)));
  }
  if (t.closest('[data-quitar-linea]')) {
    const p = productoDe(t.closest('[data-p]').dataset.p);
    cambiarPedido('cantidades', p.id, 0);
    return toast(`${p.nombre} quitado del pedido`);
  }
  const copiarProv = t.closest('[data-copiar-prov]');
  if (copiarProv) {
    const g = pedidoPorProveedor(estado.datos.control, estado.datos).find((x) => x.proveedor.id === copiarProv.dataset.copiarProv);
    return copiar(mensajePedido(g.proveedor, g.lineas, estado.datos.ajustes.restaurante), 'Pedido copiado');
  }

  // Pestañas
  const ph = t.closest('[data-pestana-historial]');
  if (ph) {
    estado.pestanaHistorial = ph.dataset.pestanaHistorial;
    return render();
  }
  const pc = t.closest('[data-pestana-catalogo]');
  if (pc) {
    estado.pestanaCatalogo = pc.dataset.pestanaCatalogo;
    estado.ordenando = false;
    return render();
  }
  const zc = t.closest('[data-zona-catalogo]');
  if (zc) {
    estado.zonaCatalogo = zc.dataset.zonaCatalogo;
    return render();
  }
  const mv = t.closest('[data-mover]');
  if (mv) return mover(mv.dataset.mover, mv.dataset.id, Number(mv.dataset.dir));
  const ep = t.closest('[data-editar-producto]');
  if (ep) return abrirProducto(ep.dataset.editarProducto);
  const ev2 = t.closest('[data-editar-proveedor]');
  if (ev2) return abrirProveedor(ev2.dataset.editarProveedor);
  const ez = t.closest('[data-editar-zona]');
  if (ez) return abrirZona(ez.dataset.editarZona);
  const cp = t.closest('[data-cambiar-pin]');
  if (cp) return abrirCambiarPin(cp.dataset.cambiarPin);

  const b = t.closest('[data-accion]');
  if (!b) return;
  const acciones = {
    salir: () => {
      if (!confirm('¿Salir? Tendrás que volver a poner el PIN.')) return;
      salir();
      pantallaPin();
    },
    'cambiar-nombre': () => {
      local.borrar(CLAVE_COCINERO);
      render();
    },
    'enviar-zona': () => enviarZona(b.dataset.zona),
    'pedir-control': abrirPedirControl,
    recargar: () => cargar(),
    'guardar-pedido': guardarPedido,
    'anadir-producto': abrirAnadirProducto,
    'cerrar-control': cerrarControl,
    'descartar-control': descartarControl,
    'borrar-zona': () => borrarZona(b.dataset.zona),
    csv: descargarCsv,
    'copiar-historial': () => copiar(textoHistorial(estado.datos.historial.find((h) => h.id === b.dataset.id)), 'Pedido copiado'),
    'borrar-historial': () => borrarHistorial(b.dataset.id),
    'nuevo-producto': () => abrirProducto(null),
    'nuevo-proveedor': () => abrirProveedor(null),
    'nueva-zona': () => abrirZona(null),
    ordenar: () => {
      estado.ordenando = true;
      estado.catalogoOrden = copiaCatalogo();
      render();
    },
    'cancelar-orden': () => {
      estado.ordenando = false;
      render();
    },
    'guardar-orden': async () => {
      if (await guardarCatalogo(estado.catalogoOrden, 'Orden guardado')) {
        estado.ordenando = false;
        render();
      }
    },
    'avisos-jefe-on': () => avisosJefe(true),
    'avisos-jefe-off': () => avisosJefe(false),
    'copiar-enlace': () => copiar(`${location.origin}/stock.html`, 'Enlace copiado'),
  };
  acciones[b.dataset.accion]?.();
});

app.addEventListener('change', (ev) => {
  const t = ev.target;
  if (t.matches('[data-pedido-prov]')) return cambiarPedido('enviados', t.dataset.pedidoProv, t.checked);
  // Un número inválido vuelve a mostrar el valor guardado.
  if (t.matches('[data-cantidad], [data-cantidad-pedido]')) render();
});

app.addEventListener('input', (ev) => {
  const t = ev.target;
  const [, param] = rutaActual();
  const valor = Number(String(t.value).replace(',', '.'));
  if (t.matches('[data-cantidad]') && valor > 0) {
    borrador(param).items[t.closest('[data-p]').dataset.p].c = valor;
    guardarBorrador(param);
  } else if (t.matches('[data-cantidad-pedido]') && valor > 0) {
    cambiarPedido('cantidades', t.closest('[data-p]').dataset.p, valor, { pintar: false });
  } else if (t.matches('[data-nota]')) {
    borrador(param).items[t.closest('[data-p]').dataset.p].n = t.value;
    guardarBorrador(param);
  } else if (t.id === 'buscar-catalogo') {
    estado.busqueda = t.value;
    render();
  }
});

app.addEventListener('submit', (ev) => {
  ev.preventDefault();
  if (ev.target.id === 'form-otro') {
    const nombre = ev.target.querySelector('#otro-nombre').value.trim();
    if (nombre) local.escribir(CLAVE_COCINERO, nombre.slice(0, 40));
    render();
  } else if (ev.target.id === 'form-ajustes') {
    guardarAjustes(ev.target);
  }
});

window.addEventListener('hashchange', () => {
  estado.ordenando = false;
  render();
  window.scrollTo(0, 0);
  // La app puede quedar abierta horas: al cambiar de pantalla se actualiza si los datos son viejos,
  // y siempre al empezar a contar (para saber si alguien ya envió esa zona).
  const [ruta] = rutaActual();
  if (estado.datos && (ruta === 'contar' || Date.now() - estado.cargadoEn > 60 * 1000)) cargar();
});

window.addEventListener('beforeunload', (ev) => {
  if (hayCambiosPedido()) {
    guardarPedido();
    ev.preventDefault();
  }
});

// --- Carga ---

async function cargar() {
  try {
    if (hayCambiosPedido()) await guardarPedido();
    aplicarDatos(await api({ accion: 'estado' }));
    render();
  } catch (e) {
    if (e.status === 401) return;
    if (!estado.datos) {
      app.innerHTML = `${cabecera('Control de stock')}<main><div class="vacio">No se pudo cargar: ${escapar(e.message)}.<br>Revisa tu conexión y recarga la página.</div></main>`;
    } else {
      toast('Sin conexión: se muestran los últimos datos cargados');
    }
  }
}

async function cargarCocina() {
  try {
    const res = await fetch('data/horarios.json', { cache: 'no-cache' });
    estado.cocina = (await res.json()).empleados.cocina;
  } catch {
    estado.cocina = [];
  }
}

async function despuesDeEntrar() {
  render();
  if (estado.rol === 'cocina') {
    await cargarCocina();
    render();
  } else {
    comprobarAvisosJefe().then(() => location.hash.startsWith('#/ajustes') && render());
  }
}

// Desde el horario se llega con ?yo=<id> para no tener que elegir el nombre.
async function iniciar() {
  const yo = new URLSearchParams(location.search).get('yo');
  if (yo) {
    await cargarCocina();
    const e = estado.cocina.find((x) => x.id === yo);
    if (e) local.escribir(CLAVE_COCINERO, e.nombre);
    history.replaceState(null, '', `stock.html${location.hash}`);
  }
  let sesion = null;
  try { sesion = JSON.parse(local.leer(CLAVE_SESION)); } catch { /* sin sesión */ }
  if (!sesion?.pin) return pantallaPin();
  estado.pin = sesion.pin;
  app.innerHTML = '<main><div class="vacio">Cargando…</div></main>';
  await cargar();
  if (estado.datos) await despuesDeEntrar();
}

iniciar();

// Al volver a la app (por ejemplo, después de mandar un WhatsApp) se actualiza el control.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !estado.datos) return;
  const [ruta] = rutaActual();
  if (!ruta || ruta === 'zona') cargar();
});

// Mientras el jefe mira el control, se actualiza solo cada minuto para ver llegar los recuentos.
setInterval(() => {
  const [ruta] = rutaActual();
  if (estado.rol === 'jefe' && !ruta && document.visibilityState === 'visible' && !hayCambiosPedido()
    && !document.querySelector('.hoja-fondo') && !document.activeElement?.matches('input')) cargar();
}, 60 * 1000);
