// Control de stock: datos cifrados en el repo, PINs del jefe y de los cocineros, validación.
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { leerArchivo, guardarArchivo, limpiar, cifrar, descifrar, pinValido } from './_lib.js';
import { UNIDADES, cantidadSugerida, ultimasCantidades } from '../assets/stock-comun.js';

const RUTA = 'data/stock.json';
const NOTA = 'Control de stock (catálogo, proveedores y pedidos), cifrado.';
const MAX_HISTORIAL = 400;

export class ErrorStock extends Error {
  constructor(mensaje, status = 400, extra = {}) {
    super(mensaje);
    this.status = status;
    this.extra = extra;
  }
}

// Sin STOCK_CLAVE no se puede leer ni guardar nada: nunca se escribe el stock sin cifrar.
export function claveStock() {
  const clave = limpiar(process.env.STOCK_CLAVE);
  return clave ? createHash('sha256').update(`horarios-stock:${clave}`).digest() : null;
}

export async function leerStock() {
  const archivo = await leerArchivo(RUTA);
  // El archivo viene con el catálogo inicial: si falta, se está leyendo otra rama y no se crea uno vacío.
  if (!archivo) throw new ErrorStock(`No se encuentra ${RUTA} en el repositorio. Revisa GITHUB_BRANCH en Vercel.`, 500);
  const stock = descifrar(archivo.texto, claveStock());
  // Nunca se sobrescribe un archivo que no se pudo leer: se perderían el catálogo y el historial.
  if (!stock) throw new ErrorStock('STOCK_CLAVE no corresponde a los datos guardados. Revisa la variable en Vercel.', 500);
  return { stock, sha: archivo.sha };
}

// Lee, modifica y guarda; reintenta si otra petición escribió a la vez. Devuelve el stock guardado.
export async function modificarStock(cambio, mensaje) {
  for (let intento = 0; ; intento++) {
    const { stock, sha } = await leerStock();
    await cambio(stock);
    if (stock.historial.length > MAX_HISTORIAL) stock.historial.length = MAX_HISTORIAL;
    try {
      await guardarArchivo(RUTA, cifrar(stock, claveStock(), NOTA), mensaje, sha);
      return stock;
    } catch (e) {
      if (intento < 3 && (e.status === 409 || e.status === 422)) continue;
      throw e;
    }
  }
}

// --- PINs ---

export function hashPin(pin) {
  const sal = randomBytes(16);
  return `${sal.toString('base64')}:${scryptSync(pin, sal, 32).toString('base64')}`;
}

export function pinCoincide(pin, guardado) {
  if (!guardado || typeof pin !== 'string' || !pin) return false;
  const [sal, hash] = guardado.split(':');
  return timingSafeEqual(scryptSync(pin, Buffer.from(sal, 'base64'), 32), Buffer.from(hash, 'base64'));
}

// El PIN del editor de horarios también entra como jefe (sirve para configurar los demás).
export function rolDe(pin, stock) {
  if (pinValido(pin) || pinCoincide(pin, stock.pines.jefe)) return 'jefe';
  if (pinCoincide(pin, stock.pines.cocina)) return 'cocina';
  return null;
}

export const PIN_NUEVO = /^\d{4,8}$/;

// --- Lo que ve cada uno ---

function resumenControl(control) {
  if (!control) return null;
  const zonas = {};
  for (const [id, z] of Object.entries(control.zonas)) zonas[id] = { por: z.por, enviado: z.enviado };
  return { id: control.id, inicio: control.inicio, pedidoPor: control.pedidoPor, zonas };
}

// Los cocineros no ven teléfonos, pedidos ni historial: solo lo que tienen que contar.
export function vistaCocina(stock) {
  const ultimas = ultimasCantidades(stock.historial);
  return {
    rol: 'cocina',
    ajustes: stock.ajustes,
    zonas: stock.zonas,
    proveedores: stock.proveedores.map(({ id, nombre }) => ({ id, nombre })),
    productos: stock.productos.filter((p) => p.activo !== false).map((p) => ({
      id: p.id, nombre: p.nombre, zona: p.zona, proveedor: p.proveedor, unidad: p.unidad, sugerido: cantidadSugerida(p, ultimas),
    })),
    control: resumenControl(stock.control),
  };
}

export function vistaJefe(stock) {
  const { pines, avisos, ...resto } = stock;
  return {
    rol: 'jefe',
    ...resto,
    pinesConfigurados: { jefe: Boolean(pines.jefe), cocina: Boolean(pines.cocina) },
  };
}

export const vista = (stock, rol) => (rol === 'jefe' ? vistaJefe(stock) : vistaCocina(stock));

// --- Validación de lo que llega del móvil ---

const ID = /^[a-z0-9-]{1,40}$/;
const TELEFONO = /^[+\d\s().-]{0,30}$/;

export function texto(valor, max, campo, obligatorio = false) {
  const t = String(valor ?? '').trim().replace(/\s+/g, ' ');
  if (obligatorio && !t) throw new ErrorStock(`Falta ${campo}`);
  if (t.length > max) throw new ErrorStock(`${campo} es demasiado largo`);
  return t;
}

export function cantidad(valor) {
  const c = Number(valor);
  if (!Number.isFinite(c) || c < 0 || c > 99999) throw new ErrorStock('Cantidad inválida');
  return Math.round(c * 100) / 100;
}

function idValido(id, que) {
  if (typeof id !== 'string' || !ID.test(id)) throw new ErrorStock(`Identificador inválido en ${que}`);
  return id;
}

function sinRepetidos(lista, que) {
  const ids = new Set(lista.map((x) => x.id));
  if (ids.size !== lista.length) throw new ErrorStock(`Hay ${que} repetidos`);
  return ids;
}

export function validarCatalogo({ zonas, proveedores, productos } = {}) {
  if (!Array.isArray(zonas) || !Array.isArray(proveedores) || !Array.isArray(productos)) {
    throw new ErrorStock('Catálogo incompleto');
  }
  if (!zonas.length) throw new ErrorStock('Tiene que haber al menos una zona');
  if (zonas.length > 30 || proveedores.length > 200 || productos.length > 1500) throw new ErrorStock('Catálogo demasiado grande');
  const limpio = {
    zonas: zonas.map((z) => ({ id: idValido(z.id, 'zonas'), nombre: texto(z.nombre, 40, 'el nombre de la zona', true) })),
    proveedores: proveedores.map((p) => {
      const entrega = Array.isArray(p.entrega) ? [...new Set(p.entrega)].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6) : [];
      for (const tel of [p.telefono, p.telefono2]) {
        if (tel && !TELEFONO.test(tel)) throw new ErrorStock(`Teléfono inválido en ${p.nombre}`);
      }
      return {
        id: idValido(p.id, 'proveedores'),
        nombre: texto(p.nombre, 60, 'el nombre del proveedor', true),
        contacto: texto(p.contacto, 40, 'el contacto'),
        telefono: texto(p.telefono, 30, 'el teléfono'),
        telefono2: texto(p.telefono2, 30, 'el segundo teléfono'),
        whatsapp: Boolean(p.whatsapp),
        entrega: entrega.sort(),
        notas: texto(p.notas, 200, 'cómo pedir'),
      };
    }),
  };
  const idsZonas = sinRepetidos(limpio.zonas, 'zonas');
  const idsProveedores = sinRepetidos(limpio.proveedores, 'proveedores');
  limpio.productos = productos.map((p) => {
    const nombre = texto(p.nombre, 80, 'el nombre del producto', true);
    if (!idsZonas.has(p.zona)) throw new ErrorStock(`${nombre}: zona desconocida`);
    if (!idsProveedores.has(p.proveedor)) throw new ErrorStock(`${nombre}: proveedor desconocido`);
    if (!UNIDADES.includes(p.unidad)) throw new ErrorStock(`${nombre}: unidad desconocida`);
    const producto = {
      id: idValido(p.id, 'productos'), nombre, zona: p.zona, proveedor: p.proveedor, unidad: p.unidad, activo: p.activo !== false,
    };
    if (p.habitual !== null && p.habitual !== undefined && p.habitual !== '') producto.habitual = cantidad(p.habitual);
    return producto;
  });
  sinRepetidos(limpio.productos, 'productos');
  return limpio;
}

// Recuento de una zona: solo productos de esa zona, con estado "hay" o "pedir" y nota opcional.
export function validarItems(items, stock, zona) {
  if (!items || typeof items !== 'object') throw new ErrorStock('Recuento vacío');
  const deLaZona = new Set(stock.productos.filter((p) => p.zona === zona).map((p) => p.id));
  const limpio = {};
  for (const [id, item] of Object.entries(items)) {
    if (!deLaZona.has(id) || !item) continue;
    const nota = texto(item.n, 200, 'la nota');
    if (item.e === 'ok') limpio[id] = { e: 'ok' };
    else if (item.e === 'pedir') limpio[id] = { e: 'pedir', c: cantidad(item.c) };
    else continue;
    if (nota) limpio[id].n = nota;
  }
  return limpio;
}
