// Gestión: lo que comparten la página y el servidor (categorías, unidades, informes del TPV y cálculos).

export const CATEGORIAS = [
  'Carne', 'Pescado', 'Fruta y verdura', 'Lácteos y huevos', 'Despensa', 'Bebidas', 'Limpieza y menaje', 'Otros',
];
// Cómo se factura cada línea de un albarán.
export const UNIDADES_COMPRA = ['kg', 'g', 'l', 'ud', 'caja', 'paquete', 'manojo', 'barril', 'servicio'];
// Cómo se mide cada ingrediente en un plato: gramos y mililitros en crudo, o unidades.
export const UNIDADES_PLATO = ['g', 'ml', 'ud'];
export const IVA_VENTA = 1.10; // la hostelería factura con el 10 % de IVA
export const OBJETIVO = 0.30;

// Para comparar nombres: sin tildes, sin mayúsculas y sin espacios de más.
export const normalizar = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9ñ%,./]+/g, ' ').trim();

// Nombre de empresa sin forma jurídica ni puntuación: "ESCOFET OLIVER, S.L." → "escofet oliver".
const FORMA_JURIDICA = / (s ?l ?u?|s ?a ?u?|s ?coop|s ?l ?n ?e|c ?b|s ?c ?p|sociedad limitada|sociedad anonima)$/;
export const claveEmpresa = (nombre) => normalizar(nombre).replace(/[(),./]/g, ' ').replace(/\s+/g, ' ').trim()
  .replace(FORMA_JURIDICA, '').trim();

// Mismo proveedor aunque el papel ponga el nombre largo ("Coca-Cola Europacific Partners Iberia").
export function mismaEmpresa(a, b) {
  const x = claveEmpresa(a);
  const y = claveEmpresa(b);
  return Boolean(x && y) && (x === y || x.startsWith(`${y} `) || y.startsWith(`${x} `));
}

// El mismo texto del mismo proveedor siempre es el mismo ingrediente: se recuerda la elección.
export const claveEquivalencia = (proveedor, orig) => `${claveEmpresa(proveedor)}|${normalizar(orig)}`;

export const redondear = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

// Líneas que no son producto: no tienen precio que seguir.
const NO_PRODUCTO = /^(portes|flete|envases?|transporte|desplazamiento|recargo|descuento|punto verde)/;
export const esProducto = (linea) => linea.ud !== 'servicio' && !NO_PRODUCTO.test(normalizar(linea.ing));

// --- Albaranes ---

export const sumaLineas = (a) => redondear(a.lineas.reduce((s, l) => s + (l.imp ?? 0), 0));

// Gasto que cuenta: base imponible (el IVA se recupera). Si no se leyó la base, la suma de las líneas.
export const gastoDe = (a) => (a.sumar === false ? 0 : a.base ?? sumaLineas(a));

export const paginasQueFaltan = (a) => (a.pag?.[1] ? Math.max(0, a.pag[1] - a.pag[0]) : 0);

// Lo cobrado sin entregar, con su IVA: lo que se puede reclamar.
export function reclamable(a) {
  if (a.resuelta) return 0;
  return redondear(a.lineas.filter((l) => l.ne).reduce((s, l) => s + (l.imp ?? 0) * (1 + (l.iva ?? 10) / 100), 0));
}

// Avisos de un albarán: no cuadra, faltan páginas, cobra algo no entregado.
export function revisionAlbaran(a) {
  const suma = sumaLineas(a);
  const avisos = [];
  if (a.base != null && Math.abs(suma - a.base) > 0.05) avisos.push({ tipo: 'cuadre', texto: `Las líneas suman ${suma.toFixed(2)} € y la base es ${a.base.toFixed(2)} €` });
  if (a.base != null && a.iva != null && a.total != null && Math.abs(a.base + a.iva - a.total) > 0.05) {
    avisos.push({ tipo: 'cuadre', texto: 'Base más IVA no da el total' });
  }
  if (paginasQueFaltan(a)) avisos.push({ tipo: 'paginas', texto: `Falta${paginasQueFaltan(a) > 1 ? 'n' : ''} ${paginasQueFaltan(a)} de ${a.pag[1]} páginas` });
  if (reclamable(a)) avisos.push({ tipo: 'reclamar', texto: 'Cobra algo que no se entregó' });
  return avisos;
}

// --- Precios ---

// Precio efectivo de una línea: el importe partido por la cantidad, que ya lleva los descuentos.
export function precioLinea(l) {
  if (l.imp != null && l.cant) return l.imp / l.cant;
  return l.precio ?? null;
}

// Pasa el precio a €/kg, €/l o €/ud para poder compararlo con lo que lleva un plato.
export function precioBase(l) {
  const p = precioLinea(l);
  if (p == null) return null;
  if (l.ud === 'kg') return { base: 'kg', valor: p };
  if (l.ud === 'g') return { base: 'kg', valor: p * 1000 };
  if (l.ud === 'l') return { base: 'l', valor: p };
  if (l.ud === 'ud') return { base: 'ud', valor: p };
  return null;
}

// Todas las compras de un ingrediente, de la más antigua a la más nueva.
export function historial(albaranes, ing) {
  const n = normalizar(ing);
  const lista = [];
  for (const a of albaranes) {
    for (const l of a.lineas) {
      if (l.ne || normalizar(l.ing) !== n || precioLinea(l) == null) continue;
      lista.push({ fecha: a.fecha, precio: precioLinea(l), ud: l.ud, proveedor: a.proveedor, albaran: a.id, cant: l.cant });
    }
  }
  return lista.sort((x, y) => x.fecha.localeCompare(y.fecha));
}

// Último precio de cada ingrediente y cuánto cambió respecto a la compra anterior en la misma unidad.
export function tablaPrecios(albaranes) {
  const porIng = new Map();
  for (const a of albaranes) {
    for (const l of a.lineas) {
      if (l.ne || !esProducto(l) || precioLinea(l) == null || !l.ing) continue;
      const clave = normalizar(l.ing);
      if (!porIng.has(clave)) porIng.set(clave, { ing: l.ing, compras: [] });
      porIng.get(clave).compras.push({ fecha: a.fecha, precio: precioLinea(l), ud: l.ud, proveedor: a.proveedor, categoria: a.categoria, albaran: a.id });
    }
  }
  return [...porIng.values()].map(({ ing, compras }) => {
    compras.sort((x, y) => x.fecha.localeCompare(y.fecha) || x.albaran.localeCompare(y.albaran));
    const ultima = compras.at(-1);
    const anterior = compras.slice(0, -1).reverse().find((c) => c.ud === ultima.ud && c.albaran !== ultima.albaran);
    return {
      ing, ...ultima, compras: compras.length,
      cambio: anterior ? ultima.precio / anterior.precio - 1 : null,
      anterior: anterior || null,
    };
  });
}

// --- Escandallos ---

const BASE_DE = { g: 'kg', ml: 'l', ud: 'ud' };
const UNIDAD_PRECIO = { kg: '€/kg', l: '€/l', ud: '€/ud' };
export const unidadPrecio = (ud) => UNIDAD_PRECIO[BASE_DE[ud]];

// Precio que se usa para un ingrediente del plato: el escrito a mano manda; si no, el último albarán.
export function precioComponente(comp, albaranes) {
  if (comp.precio != null) return { valor: comp.precio, fuente: 'manual' };
  const base = BASE_DE[comp.ud];
  const compras = historial(albaranes, comp.ing).reverse();
  for (const c of compras) {
    const pb = precioBase({ ud: c.ud, precio: c.precio });
    if (pb && pb.base === base) return { valor: pb.valor, fuente: 'albaran', fecha: c.fecha, proveedor: c.proveedor };
  }
  return null;
}

export function costeComponente(comp, albaranes) {
  const precio = precioComponente(comp, albaranes);
  if (!precio) return { precio: null, coste: null };
  const cantidad = comp.ud === 'ud' ? comp.cant : comp.cant / 1000;
  return { precio, coste: (cantidad / ((comp.rend || 100) / 100)) * precio.valor };
}

// Coste de un plato y su relación con el precio de carta. "completo" es falso si falta algún precio o ingrediente.
export function calcularPlato(plato, albaranes, objetivo = OBJETIVO) {
  if (!plato.comps?.length) return null;
  const comps = plato.comps.map((c) => ({ ...c, ...costeComponente(c, albaranes) }));
  const conPrecio = comps.filter((c) => c.coste != null);
  if (!conPrecio.length) return { comps, coste: null, sinPrecio: comps.map((c) => c.ing) };
  const coste = conPrecio.reduce((s, c) => s + c.coste, 0);
  const pvpSin = plato.pvp / IVA_VENTA;
  const principal = comps[0];
  return {
    comps,
    coste,
    sinPrecio: comps.filter((c) => c.coste == null).map((c) => c.ing),
    completo: conPrecio.length === comps.length && !plato.falta,
    pvpSin,
    porcentaje: pvpSin ? coste / pvpSin : null,
    margen: pvpSin - coste,
    sugerido: Math.ceil(((coste / objetivo) * IVA_VENTA) * 2) / 2,
    raciones: principal.ud === 'ud' ? null : (1000 * (principal.rend || 100) / 100) / principal.cant,
  };
}

// --- Informes del TPV ---

// "2.411,09" → 2411.09 · "-3.781,77" → -3781.77 · "4,4 %" → 4.4
export function leerNumero(texto) {
  const limpio = String(texto ?? '').replace(/[%€\s]/g, '').replace(/\./g, '').replace(',', '.');
  if (!limpio) return null;
  const n = Number(limpio);
  return Number.isFinite(n) ? n : null;
}

const BEBIDA = /CAÑA|COCKTAIL|AGUA|JARRA|APEROL|COPA|STELLA|COCA|SANGRIA|SAN MIGUEL|ALHAMBRA|VERMOUTH|CLARA|TINTO|LAGAR|CORONA|EFECTE|VINO|CHARDONNAY|AQUARIUS|NESTEA|TANQUERAY|10\.000|SEAGRAMS|ZUMO|BARCELO|FANTA|MALBEC|SAUVIGNON|CABERNET|SPRITE|MONTSANT|TONICA|ATREVIT|LIMONADA|HENDRICKS|MARTINI|BOMBAY|VEGA VELLA|SEVILLA|DUNKEL|ABSOLUT|BOCCHORIS|CRIANZA|JACK|LACUESTA|BALLANTINES|CHUPITO|MALFI|SMIRNOFF|CAMPARI|MASCARO|COINTREAU|FERNET|CODINA|CAFE|CAPUCHINO|CORTADO|CARAJILLO|^TE$|INFUSION|PRIORAT|NORDES|CERVEZA|GIN|RON|WHISK|VODKA|LICOR|REFRESCO|CAVA|RIOJA|RIBERA|VERDEJO|ALBARIÑO|GARNACHA|TEMPRANILLO/;
export const pareceBebida = (nombre) => BEBIDA.test(nombre.toUpperCase());

// Lee los dos informes del TPV (campos separados por "|"):
// - diario: Fecha|Documentos|Importe|Promedio
// - por artículo: Referencia|Código de barras|Nombre|Unidades|Importe|% Total, con "Cargos y descuentos" y "Registros:".
export function leerInforme(texto) {
  const filas = texto.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim()).map((l) => l.split('|').map((c) => c.trim()));
  if (!filas.length) throw new Error('El archivo está vacío');
  const cab = filas[0].map((c) => normalizar(c));
  if (cab[0] === 'fecha' && cab.includes('documentos') && cab.includes('importe')) {
    const iCuentas = cab.indexOf('documentos');
    const iImporte = cab.indexOf('importe');
    const dias = [];
    for (const f of filas.slice(1)) {
      const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(f[0]);
      if (!m) continue;
      const anio = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
      const fecha = `${anio}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
      dias.push([fecha, Math.round(leerNumero(f[iCuentas]) ?? 0), leerNumero(f[iImporte]) ?? 0]);
    }
    if (!dias.length) throw new Error('El informe diario no tiene días');
    dias.sort((a, b) => a[0].localeCompare(b[0]));
    return { tipo: 'diario', dias };
  }
  const iNombre = cab.indexOf('nombre');
  const iUds = cab.indexOf('unidades');
  const iImporte = cab.indexOf('importe');
  if (iNombre >= 0 && iUds >= 0 && iImporte >= 0) {
    const juntos = new Map();
    let descuentos = 0;
    let registrado = null;
    for (const f of filas.slice(1)) {
      const nombre = (f[iNombre] || '').replace(/\s+/g, ' ');
      if (!nombre) continue;
      if (/^registros/i.test(nombre)) { registrado = leerNumero(f[iImporte]); continue; }
      if (/^cargos y descuentos$/i.test(nombre)) { descuentos += leerNumero(f[iImporte]) ?? 0; continue; }
      // Un artículo puede salir dos veces en el mismo informe: se suman.
      const a = juntos.get(nombre) || [nombre, 0, 0];
      a[1] += leerNumero(f[iUds]) ?? 0;
      a[2] += leerNumero(f[iImporte]) ?? 0;
      juntos.set(nombre, a);
    }
    const articulos = [...juntos.values()].map(([n, u, i]) => [n, redondear(u), redondear(i)]).sort((a, b) => b[2] - a[2]);
    if (!articulos.length) throw new Error('El informe por artículos no tiene artículos');
    return { tipo: 'articulos', articulos, descuentos: redondear(descuentos), registrado };
  }
  throw new Error('No reconozco este informe. Tiene que ser el diario (Fecha, Documentos, Importe) o el de artículos (Nombre, Unidades, Importe).');
}

// --- Fechas ---

export const mesDe = (fecha) => fecha.slice(0, 7);
export const diasDelMes = (mes) => new Date(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0).getDate();
