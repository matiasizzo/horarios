import { pinValido, esperar } from './_lib.js';
import {
  ErrorGestion, claveGestion, leerGestion, modificarGestion, accesoValido, hashClave, vista, nuevoId,
  validarAlbaran, validarPlato, validarVentasMes, validarDiario, aprender, renombrar, texto, numero,
} from './_gestion.js';
import { leerDocumento } from './_lector.js';
import { normalizar, mismaEmpresa } from '../assets/gestion-comun.js';

// Todo va por POST con la contraseña: { clave, accion, ... }. Solo entra la dueña (o el ADMIN_PIN).
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
  const cuerpo = req.body || {};
  if (!claveGestion()) {
    if (pinValido(cuerpo.clave)) return res.status(200).json({ sinClave: true });
    await esperar(1500);
    return res.status(503).json({ error: 'La gestión todavía no está configurada.' });
  }
  try {
    const { gestion } = await leerGestion();
    if (!accesoValido(cuerpo.clave, gestion)) {
      await esperar(1500);
      return res.status(401).json({ error: 'Contraseña incorrecta' });
    }
    const accion = ACCIONES[cuerpo.accion];
    if (!accion) throw new ErrorGestion('Acción desconocida');
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(await accion({ cuerpo, gestion }));
  } catch (e) {
    if (!(e instanceof ErrorGestion)) console.error('Gestión', e);
    res.status(e instanceof ErrorGestion ? e.status : 502).json({ error: e.message, ...e.extra });
  }
}

// Guarda y devuelve los datos como quedaron, más lo que devuelva el cambio.
async function guardar(cambio, mensaje) {
  const { gestion, resultado } = await modificarGestion(cambio, mensaje);
  return { datos: vista(gestion), ...resultado };
}

const mismoDocumento = (a, b) => a.id !== b.id && a.tipo === b.tipo && a.numero && normalizar(a.numero) === normalizar(b.numero)
  && mismaEmpresa(a.proveedor, b.proveedor);

const ACCIONES = {
  estado: ({ gestion }) => ({ datos: vista(gestion) }),

  // Lee una foto o un PDF; no guarda nada.
  leer: async ({ cuerpo, gestion }) => ({ borrador: await leerDocumento(cuerpo.archivo, gestion) }),

  guardarAlbaran: ({ cuerpo }) => {
    const nuevo = validarAlbaran(cuerpo.albaran);
    return guardar((g) => {
      const previo = nuevo.id && g.albaranes.find((a) => a.id === nuevo.id);
      if (nuevo.id && !previo) throw new ErrorGestion('Ese albarán ya no existe. Recarga la página.', 409);
      const repetido = g.albaranes.find((a) => mismoDocumento(a, nuevo));
      if (repetido && !cuerpo.repetidoOk) {
        throw new ErrorGestion(`Ya hay ${repetido.tipo === 'factura' ? 'una factura' : 'un albarán'} ${repetido.numero} de ${repetido.proveedor}.`, 409, {
          codigo: 'repetido', repetido: repetido.id,
        });
      }
      const ahora = new Date().toISOString();
      const id = previo ? previo.id : nuevoId('a');
      if (previo) Object.assign(previo, nuevo, { id, creado: previo.creado, actualizado: ahora });
      else g.albaranes.push({ ...nuevo, id, creado: ahora });
      g.albaranes.sort((x, y) => y.fecha.localeCompare(x.fecha));
      aprender(g, nuevo);
      return { id };
    }, `Gestión: ${nuevo.tipo === 'factura' ? 'factura' : 'albarán'} ${nuevo.proveedor} ${nuevo.numero}`.trim());
  },

  // Solo el estado: revisado, o la incidencia resuelta.
  marcarAlbaran: ({ cuerpo }) => guardar((g) => {
    const a = g.albaranes.find((x) => x.id === cuerpo.id);
    if (!a) throw new ErrorGestion('Ese albarán ya no existe. Recarga la página.', 409);
    if (cuerpo.estado) a.estado = cuerpo.estado === 'revisado' ? 'revisado' : 'pendiente';
    if (cuerpo.resuelta !== undefined) a.resuelta = Boolean(cuerpo.resuelta);
    a.actualizado = new Date().toISOString();
  }, 'Gestión: estado de un albarán'),

  borrarAlbaran: ({ cuerpo }) => guardar((g) => {
    const i = g.albaranes.findIndex((x) => x.id === cuerpo.id);
    if (i < 0) throw new ErrorGestion('Ese albarán ya no existe.', 409);
    g.albaranes.splice(i, 1);
  }, 'Gestión: albarán borrado'),

  // Cambia el nombre de un ingrediente en todos los albaranes, equivalencias y escandallos (sirve para unir dos).
  renombrar: ({ cuerpo }) => {
    const de = texto(cuerpo.de, 80, 'el nombre actual', true);
    const a = texto(cuerpo.a, 80, 'el nombre nuevo', true);
    return guardar((g) => ({ cambios: renombrar(g, de, a) }), `Gestión: ${de} pasa a llamarse ${a}`);
  },

  guardarPlato: ({ cuerpo }) => {
    const plato = validarPlato(cuerpo.plato);
    return guardar((g) => {
      const previo = plato.id && g.carta.find((p) => p.id === plato.id);
      if (plato.id && !previo) throw new ErrorGestion('Ese plato ya no existe. Recarga la página.', 409);
      if (previo) {
        Object.assign(previo, plato);
        return { id: previo.id };
      }
      const id = nuevoId('p');
      // Va al final de su sección, o al final de la carta si la sección es nueva.
      const ultimo = g.carta.findLastIndex((p) => p.seccion === plato.seccion);
      g.carta.splice(ultimo < 0 ? g.carta.length : ultimo + 1, 0, { ...plato, id });
      return { id };
    }, `Gestión: plato ${plato.nombre}`);
  },

  borrarPlato: ({ cuerpo }) => guardar((g) => {
    const i = g.carta.findIndex((p) => p.id === cuerpo.id);
    if (i < 0) throw new ErrorGestion('Ese plato ya no existe.', 409);
    g.carta.splice(i, 1);
  }, 'Gestión: plato borrado'),

  // Informe del TPV por artículos de un mes; si ya había uno de ese mes, lo sustituye.
  importarVentas: ({ cuerpo }) => {
    const { mes, datos } = validarVentasMes(cuerpo.ventas);
    return guardar((g) => { g.ventas[mes] = datos; }, `Gestión: ventas por artículo de ${mes}`);
  },

  importarDiario: ({ cuerpo }) => {
    const { dias, parcial, nota } = validarDiario(cuerpo);
    return guardar((g) => {
      for (const [f, cuentas, importe] of dias) {
        g.diario[f] = [cuentas, importe];
        delete g.parciales[f];
      }
      if (parcial) g.parciales[parcial] = nota || 'informe sacado antes del cierre';
    }, `Gestión: ventas diarias del ${dias[0][0]} al ${dias.at(-1)[0]}`);
  },

  borrarVentas: ({ cuerpo }) => guardar((g) => {
    if (!g.ventas[cuerpo.mes]) throw new ErrorGestion('No hay ventas de ese mes.', 409);
    delete g.ventas[cuerpo.mes];
  }, `Gestión: ventas de ${cuerpo.mes} borradas`),

  ajustes: ({ cuerpo }) => {
    const objetivo = numero(cuerpo.objetivo, 'Objetivo', { min: 0.1, max: 0.6, decimales: 3 });
    let clave = null;
    if (cuerpo.claveNueva !== undefined) {
      clave = String(cuerpo.claveNueva);
      if (clave.length < 6 || clave.length > 64) throw new ErrorGestion('La contraseña tiene que tener entre 6 y 64 caracteres');
    }
    return guardar((g) => {
      if (objetivo != null) g.ajustes.objetivo = objetivo;
      if (clave) g.ajustes.clave = hashClave(clave);
      // Si se entró con la contraseña de la dueña, la página tiene que pasar a usar la nueva.
      return { porPin: pinValido(cuerpo.clave) };
    }, clave ? 'Gestión: contraseña nueva' : 'Gestión: ajustes');
  },
};
