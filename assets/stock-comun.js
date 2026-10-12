// Utilidades del control de stock compartidas entre el móvil y el servidor.
import { DIAS_CORTOS } from './common.js';

export const UNIDADES = [
  'ud', 'kg', 'g', 'L', 'caja', 'pack', 'bolsa', 'saco', 'pieza', 'garrafa', 'bidón', 'cubeta', 'bandeja', 'docena', 'servicio',
];
const PLURALES = {
  caja: 'cajas', pack: 'packs', bolsa: 'bolsas', saco: 'sacos', pieza: 'piezas', garrafa: 'garrafas',
  bidón: 'bidones', cubeta: 'cubetas', bandeja: 'bandejas', docena: 'docenas', servicio: 'servicios',
};

export function unidadPara(unidad, cantidad) {
  return cantidad === 1 ? unidad : PLURALES[unidad] || unidad;
}

// Cantidades con coma decimal, como se escriben en España.
export function formatoCantidad(c) {
  return String(Math.round(c * 100) / 100).replace('.', ',');
}

export function cantidadConUnidad(c, unidad) {
  return `${formatoCantidad(c)} ${unidadPara(unidad, c)}`;
}

// Días de entrega guardados como índices (0 = lunes): "mar y vie".
export function textoEntrega(dias = []) {
  const nombres = [...dias].sort().map((i) => DIAS_CORTOS[i].toLowerCase());
  if (nombres.length <= 1) return nombres.join('');
  return `${nombres.slice(0, -1).join(', ')} y ${nombres.at(-1)}`;
}

// Cantidad a pedir de cada producto: lo que marcaron los cocineros, con los cambios del jefe encima.
export function cantidadesPedido(control) {
  const cantidades = {};
  for (const zona of Object.values(control.zonas)) {
    for (const [id, item] of Object.entries(zona.items)) {
      if (item.e === 'pedir') cantidades[id] = item.c;
    }
  }
  return { ...cantidades, ...control.pedido.cantidades };
}

export function notasControl(control) {
  const notas = {};
  for (const zona of Object.values(control.zonas)) {
    for (const [id, item] of Object.entries(zona.items)) if (item.n) notas[id] = item.n;
  }
  return notas;
}

// Pedido agrupado por proveedor, en el orden del catálogo. Solo proveedores con algo que pedir.
export function pedidoPorProveedor(control, catalogo) {
  const cantidades = cantidadesPedido(control);
  const notas = notasControl(control);
  const grupos = [];
  for (const proveedor of catalogo.proveedores) {
    const lineas = catalogo.productos
      .filter((p) => p.proveedor === proveedor.id && cantidades[p.id] > 0)
      .map((producto) => ({ producto, cantidad: cantidades[producto.id], nota: notas[producto.id] || '' }));
    if (lineas.length) grupos.push({ proveedor, lineas });
  }
  return grupos;
}

// Última cantidad pedida de cada producto según el historial (el más reciente va primero).
export function ultimasCantidades(historial) {
  const ultimas = {};
  for (const control of historial) {
    for (const linea of control.lineas) ultimas[linea.p] ??= linea.c;
  }
  return ultimas;
}

export function cantidadSugerida(producto, ultimas) {
  return ultimas[producto.id] ?? producto.habitual ?? 1;
}

export function mensajePedido(proveedor, lineas, restaurante) {
  const saludo = proveedor.contacto
    ? `Hola ${proveedor.contacto}, te paso el pedido de ${restaurante}:`
    : `Hola, os paso el pedido de ${restaurante}:`;
  const lista = lineas.map(({ producto, cantidad }) => `• ${producto.nombre}: ${cantidadConUnidad(cantidad, producto.unidad)}`);
  return `${saludo}\n${lista.join('\n')}\n\n¡Gracias!`;
}

// Teléfonos españoles de 9 cifras; si ya traen prefijo internacional se respeta.
function internacional(telefono) {
  let cifras = String(telefono || '').replace(/\D/g, '');
  if (cifras.startsWith('00')) cifras = cifras.slice(2);
  if (cifras.length === 9) cifras = `34${cifras}`;
  return cifras;
}

export function enlaceWhatsApp(telefono, texto) {
  const numero = internacional(telefono);
  return numero ? `https://wa.me/${numero}?text=${encodeURIComponent(texto)}` : null;
}

export function enlaceLlamada(telefono) {
  const numero = internacional(telefono);
  return numero ? `tel:+${numero}` : null;
}
