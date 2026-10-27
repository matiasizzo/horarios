// Lee la foto o el PDF de un albarán con Claude y devuelve sus líneas para revisarlas.
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { CATEGORIAS, UNIDADES_COMPRA, claveEquivalencia, mismaEmpresa } from '../assets/gestion-comun.js';
import { ErrorGestion } from './_gestion.js';

const MODELO = 'claude-opus-5-5';
const TIPOS = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MAX_BYTES = 3.2 * 1024 * 1024; // Vercel no acepta peticiones de más de 4,5 MB

const Linea = z.object({
  texto: z.string().describe('Descripción tal cual está impresa, en su idioma'),
  ingrediente: z.string().describe('Nombre claro en castellano'),
  cantidad: z.number().nullable(),
  unidad: z.enum(UNIDADES_COMPRA),
  precio: z.number().nullable().describe('Precio por unidad sin IVA, con el descuento ya aplicado'),
  importe: z.number().nullable().describe('Importe neto de la línea sin IVA'),
  iva: z.number().nullable().describe('Porcentaje de IVA de la línea'),
  no_entregado: z.boolean(),
  nota: z.string().nullable(),
});

const Documento = z.object({
  es_compra: z.boolean().describe('false si no es un albarán, factura o ticket de compra'),
  tipo: z.enum(['albaran', 'factura']),
  proveedor: z.string().nullable(),
  nif: z.string().nullable(),
  categoria: z.enum(CATEGORIAS),
  numero: z.string().nullable(),
  fecha: z.string().nullable().describe('AAAA-MM-DD'),
  pagina: z.number().nullable(),
  paginas: z.number().nullable(),
  base: z.number().nullable(),
  iva: z.number().nullable(),
  total: z.number().nullable(),
  albaranes_incluidos: z.array(z.string()).describe('Números de albarán que agrupa una factura'),
  lineas: z.array(Linea),
  avisos: z.array(z.string()),
});

const INSTRUCCIONES = `Lees albaranes y facturas de proveedores del restaurante Morelia (Pizza Pija S.L., Barcelona) para registrar lo que se compra y a qué precio. Una persona revisará lo que devuelvas comparándolo con el papel, así que transcribe con exactitud y avisa de lo dudoso en lugar de inventarlo.

- Una línea por cada producto o cargo. "texto" va tal cual está impreso, aunque esté en catalán. "ingrediente" es un nombre corto y claro en castellano; si en la lista de ingredientes conocidos hay uno que es el mismo producto, usa exactamente ese nombre. En bebidas y envasados incluye el formato ("Coca-Cola 23,7 cl", "Barril San Miguel 30 L"); en carne, pescado y verdura a peso, no.
- Importes sin IVA. "importe" es el neto de la línea con los descuentos aplicados; "precio" es lo que cuesta cada unidad facturada después del descuento. "unidad" es la unidad en la que se factura la línea (kg si se cobra por peso).
- Portes, fletes, envases y recargos van como líneas aparte con unidad "servicio" e ingrediente "Portes", "Envases" o "Recargo".
- "no_entregado" es true si a mano o con sello pone que no llegó o no se cargó ("no cargado", "no servido", "falta", línea tachada). Deja su importe como esté impreso y explica la anotación en "nota".
- "base", "iva" y "total" son los del documento, solo si aparecen en esta página; si no, null. No los calcules tú. Si hay varios tipos de IVA, "iva" es la suma de las cuotas.
- La fecha va en formato AAAA-MM-DD; en España el día va primero (21/10/26 es 2026-10-21). "pagina" y "paginas" salen de textos como "Pág. 1 de 2"; si no se indica, null.
- "categoria" es la del proveedor en conjunto. "tipo" es "factura" si el documento se titula factura; si no, "albaran". Si una factura agrupa albaranes, pon sus números en "albaranes_incluidos".
- En "avisos" anota en castellano lo que una persona deba comprobar: cifras dudosas o ilegibles, correcciones a mano, que la suma de líneas no cuadre con la base, vencimientos o forma de pago.`;

export async function leerDocumento(archivo, gestion) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new ErrorGestion('La lectura automática no está activada: falta ANTHROPIC_API_KEY en Vercel.', 501, { codigo: 'sin-ia' });
  }
  if (!archivo || !TIPOS.includes(archivo.tipo) || typeof archivo.datos !== 'string') throw new ErrorGestion('Archivo no válido');
  if (archivo.datos.length * 0.75 > MAX_BYTES) throw new ErrorGestion('El archivo es demasiado grande (máximo 3 MB).');

  const bloque = archivo.tipo === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: archivo.datos } }
    : { type: 'image', source: { type: 'base64', media_type: archivo.tipo, data: archivo.datos } };

  const proveedores = gestion.proveedores.map((p) => `${p.nombre}${p.nif ? ` (${p.nif})` : ''} · ${p.categoria}`);
  const ingredientes = [...new Set(gestion.albaranes.flatMap((a) => a.lineas.map((l) => l.ing)))].slice(0, 500);
  const contexto = `Proveedores conocidos:\n${proveedores.join('\n') || '(ninguno)'}\n\nIngredientes conocidos:\n${ingredientes.join('\n') || '(ninguno)'}`;

  const cliente = new Anthropic({ timeout: 55_000, maxRetries: 0 }); // Vercel corta la función a los 60 s
  let respuesta;
  try {
    respuesta = await cliente.beta.messages.parse({
      model: MODELO,
      max_tokens: 16000,
      // Si el modelo rechaza la petición, la API la repite con el modelo de reserva que corresponda.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: betaZodOutputFormat(Documento) },
      system: INSTRUCCIONES,
      messages: [{ role: 'user', content: [bloque, { type: 'text', text: contexto }] }],
    });
  } catch (e) {
    throw errorLegible(e);
  }
  if (respuesta.stop_reason === 'refusal') throw new ErrorGestion('El lector no quiso procesar este archivo. Rellénalo a mano.', 422);
  if (respuesta.stop_reason === 'max_tokens') throw new ErrorGestion('El documento es demasiado largo para leerlo de una vez. Sube las páginas por separado.', 422);
  const doc = respuesta.parsed_output;
  if (!doc) throw new ErrorGestion('La lectura no devolvió datos. Prueba otra vez o rellénalo a mano.', 502);
  return aBorrador(doc, gestion);
}

function errorLegible(e) {
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
    return new ErrorGestion('La clave de Anthropic no es válida. Revisa ANTHROPIC_API_KEY en Vercel.', 502);
  }
  if (e instanceof Anthropic.RateLimitError) return new ErrorGestion('Demasiadas lecturas seguidas. Espera un minuto.', 429);
  if (e instanceof Anthropic.APIConnectionTimeoutError) {
    return new ErrorGestion('La lectura tardó demasiado. Prueba con una foto más nítida o página por página.', 504);
  }
  if (e instanceof Anthropic.BadRequestError) {
    console.error('Lector', e.message);
    return new ErrorGestion(`No se pudo leer: ${e.message.slice(0, 200)}`, 422);
  }
  if (e instanceof Anthropic.APIError) {
    console.error('Lector', e.status, e.message);
    return new ErrorGestion('El servicio de lectura no responde ahora. Prueba en un rato.', 502);
  }
  return e;
}

// Pasa la respuesta al formato de los albaranes, con los nombres que ya se usaron otras veces.
function aBorrador(doc, gestion) {
  const nif = (doc.nif || '').toUpperCase().replace(/[\s.-]/g, '');
  const conocido = gestion.proveedores.find((p) => (nif && p.nif === nif))
    || gestion.proveedores.find((p) => doc.proveedor && mismaEmpresa(p.nombre, doc.proveedor));
  const proveedor = conocido?.nombre || doc.proveedor || '';
  return {
    esCompra: doc.es_compra,
    tipo: doc.tipo,
    proveedor,
    nif: nif || conocido?.nif || '',
    categoria: conocido?.categoria || doc.categoria,
    numero: doc.numero || '',
    fecha: /^\d{4}-\d{2}-\d{2}$/.test(doc.fecha || '') ? doc.fecha : '',
    pagina: doc.pagina,
    paginas: doc.paginas,
    base: doc.base,
    iva: doc.iva,
    total: doc.total,
    albaranesIncluidos: doc.albaranes_incluidos,
    avisos: doc.avisos,
    lineas: doc.lineas.map((l) => ({
      orig: l.texto,
      ing: gestion.equivalencias[claveEquivalencia(proveedor, l.texto)] || l.ingrediente,
      cant: l.cantidad,
      ud: l.unidad,
      precio: l.precio,
      imp: l.importe,
      iva: l.iva,
      ne: l.no_entregado,
      nota: l.nota || '',
    })),
  };
}
