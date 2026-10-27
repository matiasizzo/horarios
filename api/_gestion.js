// Gestión del restaurante: albaranes, carta con escandallos y ventas del TPV, cifrados en el repo.
import { createHash, randomBytes } from 'node:crypto';
import { leerArchivo, guardarArchivo, limpiar, cifrar, descifrar, pinValido } from './_lib.js';
import { hashPin, pinCoincide } from './_stock.js';
import {
  CATEGORIAS, UNIDADES_COMPRA, UNIDADES_PLATO, claveEquivalencia, claveEmpresa, normalizar, redondear,
} from '../assets/gestion-comun.js';

const RUTA = 'data/gestion.json';
const NOTA = 'Gestión (albaranes, carta y ventas), cifrado.';
const MAX_EQUIVALENCIAS = 4000;

export class ErrorGestion extends Error {
  constructor(mensaje, status = 400, extra = {}) {
    super(mensaje);
    this.status = status;
    this.extra = extra;
  }
}

// Misma variable que el stock, con otra derivación: una clave menos que configurar en Vercel.
export function claveGestion() {
  const clave = limpiar(process.env.STOCK_CLAVE);
  return clave ? createHash('sha256').update(`horarios-gestion:${clave}`).digest() : null;
}

export async function leerGestion() {
  const archivo = await leerArchivo(RUTA);
  if (!archivo) throw new ErrorGestion(`No se encuentra ${RUTA} en el repositorio. Revisa GITHUB_BRANCH en Vercel.`, 500);
  const gestion = descifrar(archivo.texto, claveGestion());
  if (!gestion) throw new ErrorGestion('STOCK_CLAVE no corresponde a los datos de gestión. Revisa la variable en Vercel.', 500);
  return { gestion, sha: archivo.sha };
}

// Lee, modifica y guarda; si otra petición escribió a la vez, vuelve a empezar con lo nuevo.
export async function modificarGestion(cambio, mensaje) {
  for (let intento = 0; ; intento++) {
    const { gestion, sha } = await leerGestion();
    const resultado = await cambio(gestion);
    try {
      await guardarArchivo(RUTA, cifrar(gestion, claveGestion(), NOTA), mensaje, sha);
      return { gestion, resultado };
    } catch (e) {
      if (intento < 3 && (e.status === 409 || e.status === 422)) continue;
      throw e;
    }
  }
}

export const cifrarGestion = (gestion) => cifrar(gestion, claveGestion(), NOTA);

// Entra el ADMIN_PIN (para configurarlo) o la contraseña de la dueña.
export const accesoValido = (clave, gestion) => pinValido(clave) || pinCoincide(clave, gestion.ajustes.clave);
export const hashClave = hashPin;

export function vista(gestion) {
  const { clave, ...ajustes } = gestion.ajustes;
  return { ...gestion, ajustes: { ...ajustes, claveConfigurada: Boolean(clave) }, ia: Boolean(process.env.ANTHROPIC_API_KEY) };
}

export const nuevoId = (prefijo) => `${prefijo}${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;

// --- Validación ---

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const MES = /^\d{4}-\d{2}$/;
const ID = /^[a-z0-9-]{1,40}$/;

export function texto(valor, max, campo, obligatorio = false, multilinea = false) {
  let t = String(valor ?? '').trim();
  t = multilinea ? t.replace(/[^\S\n]+/g, ' ').replace(/\n{3,}/g, '\n\n') : t.replace(/\s+/g, ' ');
  if (obligatorio && !t) throw new ErrorGestion(`Falta ${campo}`);
  if (t.length > max) throw new ErrorGestion(`${campo} es demasiado largo`);
  return t;
}

// Número opcional (null si viene vacío); admite negativos para abonos y descuentos.
export function numero(valor, campo, { min = -1e6, max = 1e6, decimales = 4 } = {}) {
  if (valor === null || valor === undefined || valor === '') return null;
  const n = Number(valor);
  if (!Number.isFinite(n) || n < min || n > max) throw new ErrorGestion(`${campo}: número inválido`);
  return redondear(n, decimales);
}

function fecha(valor, campo) {
  if (typeof valor !== 'string' || !FECHA.test(valor) || Number.isNaN(Date.parse(valor))) throw new ErrorGestion(`${campo}: fecha inválida`);
  return valor;
}

function linea(l, i) {
  const que = `Línea ${i + 1}`;
  const ing = texto(l.ing, 80, `${que}: el ingrediente`) || texto(l.orig, 80, `${que}: el texto`);
  if (!ing) throw new ErrorGestion(`${que}: falta el ingrediente`);
  if (!UNIDADES_COMPRA.includes(l.ud)) throw new ErrorGestion(`${que}: unidad desconocida`);
  const limpia = {
    orig: texto(l.orig, 160, `${que}: el texto del albarán`),
    ing,
    cant: numero(l.cant, `${que}: cantidad`),
    ud: l.ud,
    precio: numero(l.precio, `${que}: precio`),
    imp: numero(l.imp, `${que}: importe`),
    iva: numero(l.iva, `${que}: IVA`, { min: 0, max: 30, decimales: 1 }),
  };
  if (l.ne) limpia.ne = true;
  const nota = texto(l.nota, 200, `${que}: la nota`);
  if (nota) limpia.nota = nota;
  return limpia;
}

export function validarAlbaran(a) {
  if (!a || typeof a !== 'object') throw new ErrorGestion('Albarán vacío');
  if (!['albaran', 'factura'].includes(a.tipo)) throw new ErrorGestion('Tipo de documento desconocido');
  if (!CATEGORIAS.includes(a.categoria)) throw new ErrorGestion('Categoría desconocida');
  if (!Array.isArray(a.lineas) || a.lineas.length > 300) throw new ErrorGestion('Líneas inválidas');
  const pag = Array.isArray(a.pag) ? a.pag : [1, null];
  const subidas = Math.round(numero(pag[0], 'Páginas', { min: 1, max: 99, decimales: 0 }) ?? 1);
  const total = numero(pag[1], 'Páginas', { min: 1, max: 99, decimales: 0 });
  return {
    id: a.id && ID.test(a.id) ? a.id : null,
    tipo: a.tipo,
    proveedor: texto(a.proveedor, 80, 'el proveedor', true),
    nif: texto(a.nif, 20, 'el NIF').toUpperCase().replace(/[\s.-]/g, ''),
    categoria: a.categoria,
    numero: texto(a.numero, 40, 'el número'),
    fecha: fecha(a.fecha, 'Fecha'),
    pag: [subidas, total == null ? null : Math.max(total, subidas)],
    base: numero(a.base, 'Base'),
    iva: numero(a.iva, 'IVA'),
    total: numero(a.total, 'Total'),
    sumar: a.sumar !== false,
    estado: a.estado === 'revisado' ? 'revisado' : 'pendiente',
    resuelta: Boolean(a.resuelta),
    notas: texto(a.notas, 1500, 'las notas', false, true),
    lineas: a.lineas.map(linea),
  };
}

function componente(c, plato) {
  const que = `${plato}: ingrediente`;
  if (!UNIDADES_PLATO.includes(c.ud)) throw new ErrorGestion(`${que} con unidad desconocida`);
  const comp = {
    ing: texto(c.ing, 80, que, true),
    cant: numero(c.cant, `${que}: cantidad`, { min: 0.001, max: 100000, decimales: 3 }) ?? 0,
    ud: c.ud,
    rend: numero(c.rend, `${que}: rendimiento`, { min: 1, max: 100, decimales: 1 }) ?? 100,
    precio: numero(c.precio, `${que}: precio`, { min: 0, max: 100000 }),
  };
  if (!comp.cant) throw new ErrorGestion(`${que}: falta la cantidad`);
  if (c.medido) comp.medido = true;
  return comp;
}

export function validarPlato(p) {
  if (!p || typeof p !== 'object') throw new ErrorGestion('Plato vacío');
  const nombre = texto(p.nombre, 80, 'el nombre del plato', true);
  if (!Array.isArray(p.comps) || p.comps.length > 25) throw new ErrorGestion(`${nombre}: ingredientes inválidos`);
  return {
    id: p.id && ID.test(p.id) ? p.id : null,
    seccion: texto(p.seccion, 40, 'la sección', true),
    nombre,
    pvp: numero(p.pvp, `${nombre}: precio`, { min: 0, max: 10000 }) ?? 0,
    tpv: texto(p.tpv, 80, `${nombre}: nombre en el TPV`),
    falta: texto(p.falta, 300, `${nombre}: lo que falta`),
    comps: p.comps.map((c) => componente(c, nombre)),
  };
}

function articulo(a) {
  if (!Array.isArray(a) || a.length !== 3) throw new ErrorGestion('Artículo inválido');
  return [texto(a[0], 80, 'el artículo', true), numero(a[1], 'Unidades') ?? 0, numero(a[2], 'Importe') ?? 0];
}

export function validarVentasMes(v) {
  if (!v || !MES.test(v.mes)) throw new ErrorGestion('Mes inválido');
  const hasta = fecha(v.hasta, 'Hasta');
  if (!hasta.startsWith(v.mes)) throw new ErrorGestion('El último día tiene que ser del mismo mes');
  if (!Array.isArray(v.comida) || !Array.isArray(v.bebida) || v.comida.length + v.bebida.length > 1500) {
    throw new ErrorGestion('Artículos inválidos');
  }
  return {
    mes: v.mes,
    datos: {
      hasta,
      completo: Boolean(v.completo),
      descuentos: numero(v.descuentos, 'Descuentos') ?? 0,
      comida: v.comida.map(articulo),
      bebida: v.bebida.map(articulo),
    },
  };
}

export function validarDiario(d) {
  if (!d || !Array.isArray(d.dias) || !d.dias.length || d.dias.length > 400) throw new ErrorGestion('Días inválidos');
  const dias = d.dias.map((x) => {
    if (!Array.isArray(x) || x.length !== 3) throw new ErrorGestion('Día inválido');
    return [fecha(x[0], 'Día'), Math.round(numero(x[1], 'Cuentas', { min: 0, max: 100000 }) ?? 0), numero(x[2], 'Importe') ?? 0];
  });
  const parcial = d.parcial ? fecha(d.parcial, 'Día incompleto') : null;
  if (parcial && !dias.some(([f]) => f === parcial)) throw new ErrorGestion('El día incompleto no está en el informe');
  return { dias, parcial, nota: texto(d.nota, 80, 'la nota') };
}

// --- Cambios que se repiten ---

// Recuerda proveedor y equivalencias de cada albarán guardado, para el siguiente.
export function aprender(gestion, a) {
  const nif = a.nif;
  let prov = gestion.proveedores.find((p) => (nif && p.nif === nif) || claveEmpresa(p.nombre) === claveEmpresa(a.proveedor));
  if (!prov) {
    prov = { nombre: a.proveedor, nif, categoria: a.categoria };
    gestion.proveedores.push(prov);
  }
  Object.assign(prov, { nombre: a.proveedor, categoria: a.categoria }, nif ? { nif } : {});
  for (const l of a.lineas) {
    if (l.orig && l.ing) gestion.equivalencias[claveEquivalencia(a.proveedor, l.orig)] = l.ing;
  }
  const claves = Object.keys(gestion.equivalencias);
  for (const c of claves.slice(0, Math.max(0, claves.length - MAX_EQUIVALENCIAS))) delete gestion.equivalencias[c];
}

export function renombrar(gestion, de, a) {
  const n = normalizar(de);
  let cambios = 0;
  for (const alb of gestion.albaranes) {
    for (const l of alb.lineas) if (normalizar(l.ing) === n) { l.ing = a; cambios++; }
  }
  for (const [k, v] of Object.entries(gestion.equivalencias)) if (normalizar(v) === n) gestion.equivalencias[k] = a;
  for (const p of gestion.carta) for (const c of p.comps) if (normalizar(c.ing) === n) c.ing = a;
  return cambios;
}
