import { pinValido, esperar, leerDatos } from './_lib.js';
import {
  ErrorStock, claveStock, leerStock, modificarStock, rolDe, hashPin, pinCoincide, PIN_NUEVO, vista,
  texto, cantidad, validarCatalogo, validarItems,
} from './_stock.js';
import {
  clavesAvisos, leerAvisos, modificarAvisos, suscripcionValida, enviarMensaje,
} from './_avisos.js';
import { diasDe, lunesDe, parseFecha } from '../assets/common.js';
import { pedidoPorProveedor } from '../assets/stock-comun.js';

// Todo va por POST con el PIN: { pin, accion, ... }. El PIN decide si es el jefe o un cocinero.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
  const cuerpo = req.body || {};
  if (!claveStock()) {
    // Sin clave no hay datos que leer: solo el encargado ve qué falta configurar.
    if (pinValido(cuerpo.pin)) return res.status(200).json({ sinClave: true });
    await esperar(1500);
    return res.status(503).json({ error: 'El control de stock todavía no está configurado.' });
  }
  try {
    const { stock } = await leerStock();
    const rol = rolDe(cuerpo.pin, stock);
    if (!rol) {
      await esperar(1500);
      return res.status(401).json({ error: 'PIN incorrecto' });
    }
    const accion = ACCIONES[cuerpo.accion];
    if (!accion) throw new ErrorStock('Acción desconocida');
    if (accion.soloJefe && rol !== 'jefe') throw new ErrorStock('Solo el jefe de cocina puede hacer esto', 403);
    const origen = `https://${req.headers.host}`;
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(await accion.hacer({ cuerpo, rol, stock, origen }));
  } catch (e) {
    if (!(e instanceof ErrorStock)) console.error('Stock', e);
    res.status(e instanceof ErrorStock ? e.status : 502).json({ error: e.message, ...e.extra });
  }
}

const ahora = () => new Date().toISOString();

function nuevoControl(pedidoPor) {
  return { id: Date.now().toString(36), inicio: ahora(), pedidoPor, zonas: {}, pedido: { cantidades: {}, enviados: {} } };
}

function controlAbierto(stock, controlId) {
  if (!stock.control || stock.control.id !== controlId) {
    throw new ErrorStock('Este control ya se cerró o cambió. Recarga la pantalla.', 409, { codigo: 'control-cambiado' });
  }
  return stock.control;
}

// Hoy en el restaurante (Vercel trabaja en UTC).
function hoyEnEspana() {
  const iso = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date());
  return parseFecha(iso);
}

// Cocineros con su estado de avisos; "hoy" son los que tienen turno hoy según el horario publicado.
async function cocineros() {
  const [{ datos }, { avisos }] = await Promise.all([leerDatos(), leerAvisos()]);
  const hoy = hoyEnEspana();
  const semana = datos.semanas[lunesDe(hoy)]; // si esta semana aún no está publicada, nadie cuenta como "hoy"
  const indice = (hoy.getDay() + 6) % 7;
  const conAvisos = new Set(avisos.suscripciones.map((s) => s.empleado));
  const lista = datos.empleados.cocina.map((e) => ({
    id: e.id,
    nombre: e.nombre,
    avisos: conAvisos.has(e.id),
    hoy: Boolean(semana && diasDe(semana, e.id)[indice].length),
  }));
  return { lista, avisos };
}

// Avisa al jefe en sus móviles. Un fallo del aviso nunca hace fallar lo que se guardó.
async function avisarJefe(stock, mensaje, origen) {
  try {
    const { enviados, caducadas } = await enviarMensaje(stock.avisos, { url: '/stock.html', ...mensaje }, origen);
    if (caducadas.size) {
      await modificarStock((s) => {
        s.avisos = s.avisos.filter((a) => !caducadas.has(a.endpoint));
      }, 'Stock: avisos caducados');
    }
    return enviados;
  } catch (e) {
    console.error('Aviso al jefe', e);
    return 0;
  }
}

function resumenZona(stock, zonaId) {
  const items = Object.values(stock.control.zonas[zonaId].items);
  const total = stock.productos.filter((p) => p.zona === zonaId && p.activo !== false).length;
  return {
    pedir: items.filter((i) => i.e === 'pedir').length,
    notas: items.filter((i) => i.n).length,
    sinRevisar: Math.max(0, total - items.length),
  };
}

const ACCIONES = {
  estado: {
    hacer: ({ stock, rol }) => vista(stock, rol),
  },

  // Un cocinero (o el jefe) termina una zona: se guarda y le llega un aviso al jefe.
  enviarZona: {
    async hacer({ cuerpo, rol, stock, origen }) {
      const por = texto(cuerpo.por, 40, 'quién hizo el recuento', true);
      const zona = stock.zonas.find((z) => z.id === cuerpo.zona);
      if (!zona) throw new ErrorStock('Esa zona ya no existe. Recarga la pantalla.');
      const guardado = await modificarStock((s) => {
        s.control ??= nuevoControl(rol === 'jefe' ? 'jefe' : por);
        if (!s.zonas.some((z) => z.id === zona.id)) throw new ErrorStock('Esa zona ya no existe. Recarga la pantalla.');
        const previa = s.control.zonas[zona.id];
        if (previa && !cuerpo.reemplazar) {
          throw new ErrorStock(`${zona.nombre} ya la envió ${previa.por}.`, 409, {
            codigo: 'zona-enviada', previa: { por: previa.por, enviado: previa.enviado },
          });
        }
        // Un recuento nuevo de la zona manda sobre los cambios que el jefe hizo al anterior.
        if (previa) {
          for (const p of s.productos) if (p.zona === zona.id) delete s.control.pedido.cantidades[p.id];
        }
        s.control.zonas[zona.id] = { por, enviado: ahora(), items: validarItems(cuerpo.items, s, zona.id) };
      }, `Stock: recuento de ${zona.nombre}`);

      const r = resumenZona(guardado, zona.id);
      const pendientes = guardado.zonas.filter((z) => !guardado.control.zonas[z.id]);
      const detalle = [`${r.pedir} a pedir`];
      if (r.notas) detalle.push(`${r.notas} ${r.notas === 1 ? 'nota' : 'notas'}`);
      if (r.sinRevisar) detalle.push(`${r.sinRevisar} sin revisar`);
      let body = `${por} · ${detalle.join(' · ')}`;
      if (pendientes.length) body += `\nFalta: ${pendientes.map((z) => z.nombre).join(', ')}`;
      else {
        const grupos = pedidoPorProveedor(guardado.control, guardado);
        const lineas = grupos.reduce((n, g) => n + g.lineas.length, 0);
        body += `\nControl completo: ${lineas} productos de ${grupos.length} proveedores`;
      }
      // Si el recuento lo hizo el propio jefe, no hace falta avisarle.
      const avisados = rol === 'jefe' ? 0 : await avisarJefe(guardado, {
        title: `Stock de ${zona.nombre} listo`, body, tag: `stock-${guardado.control.id}-${zona.id}`,
      }, origen);
      return { ...vista(guardado, rol), avisados };
    },
  },

  // A quién se puede avisar para que hagan el recuento.
  destinatarios: {
    soloJefe: true,
    async hacer() {
      const { lista } = await cocineros();
      return { cocineros: lista, avisosConfigurados: Boolean(clavesAvisos()) };
    },
  },

  // El jefe abre el control (si no estaba abierto) y avisa a los cocineros.
  pedirControl: {
    soloJefe: true,
    async hacer({ cuerpo, stock, origen }) {
      let guardado = stock;
      if (!stock.control) {
        guardado = await modificarStock((s) => {
          s.control ??= nuevoControl('jefe');
        }, 'Stock: nuevo control');
      }
      const resumen = { enviados: 0, sinAvisos: [] };
      if (cuerpo.avisar === 'hoy' || cuerpo.avisar === 'todos') {
        const { lista, avisos } = await cocineros();
        const elegidos = lista.filter((c) => cuerpo.avisar === 'todos' || c.hoy);
        const ids = new Set(elegidos.map((c) => c.id));
        resumen.sinAvisos = elegidos.filter((c) => !c.avisos).map((c) => c.nombre);
        const subs = avisos.suscripciones.filter((s) => ids.has(s.empleado));
        const { enviados, caducadas } = await enviarMensaje(subs, {
          title: 'Toca hacer el stock',
          body: 'El jefe de cocina pidió el control de stock. Toca aquí para empezar tu zona.',
          url: '/stock.html',
          tag: `stock-pedido-${guardado.control.id}`,
        }, origen);
        resumen.enviados = enviados;
        if (caducadas.size) {
          await modificarAvisos((av) => {
            av.suscripciones = av.suscripciones.filter((s) => !caducadas.has(s.endpoint));
          }, 'Avisos: suscripciones caducadas').catch((e) => console.error('Avisos caducados', e));
        }
      }
      return { ...vista(guardado, 'jefe'), resumen };
    },
  },

  // Cambios del jefe sobre el pedido: cantidades (null = volver a lo que marcó el cocinero) y proveedores ya pedidos.
  pedido: {
    soloJefe: true,
    async hacer({ cuerpo }) {
      const guardado = await modificarStock((s) => {
        const control = controlAbierto(s, cuerpo.controlId);
        const productos = new Set(s.productos.map((p) => p.id));
        const proveedores = new Set(s.proveedores.map((p) => p.id));
        for (const [id, c] of Object.entries(cuerpo.cantidades || {})) {
          if (!productos.has(id)) continue;
          if (c === null) delete control.pedido.cantidades[id];
          else control.pedido.cantidades[id] = cantidad(c);
        }
        for (const [id, pedido] of Object.entries(cuerpo.enviados || {})) {
          if (!proveedores.has(id)) continue;
          if (pedido) control.pedido.enviados[id] = ahora();
          else delete control.pedido.enviados[id];
        }
      }, 'Stock: pedido');
      return vista(guardado, 'jefe');
    },
  },

  borrarZona: {
    soloJefe: true,
    async hacer({ cuerpo }) {
      const guardado = await modificarStock((s) => {
        delete controlAbierto(s, cuerpo.controlId).zonas[cuerpo.zona];
      }, 'Stock: recuento borrado');
      return vista(guardado, 'jefe');
    },
  },

  // Guarda el control en el historial con los nombres de ese momento (aunque luego cambie el catálogo).
  cerrar: {
    soloJefe: true,
    async hacer({ cuerpo }) {
      const guardado = await modificarStock((s) => {
        const control = controlAbierto(s, cuerpo.controlId);
        const grupos = pedidoPorProveedor(control, s);
        const zonas = {};
        for (const [id, z] of Object.entries(control.zonas)) {
          zonas[id] = {
            ...z,
            nombre: s.zonas.find((x) => x.id === id)?.nombre || id,
            total: s.productos.filter((p) => p.zona === id && p.activo !== false).length,
          };
        }
        s.historial.unshift({
          id: control.id,
          inicio: control.inicio,
          cierre: ahora(),
          pedidoPor: control.pedidoPor,
          zonas,
          lineas: grupos.flatMap(({ proveedor, lineas }) => lineas.map(({ producto, cantidad: c, nota }) => ({
            p: producto.id, n: producto.nombre, u: producto.unidad, v: proveedor.id, c, ...(nota ? { nota } : {}),
          }))),
          proveedores: Object.fromEntries(grupos.map(({ proveedor }) => [proveedor.id, {
            nombre: proveedor.nombre, pedido: control.pedido.enviados[proveedor.id] || null,
          }])),
        });
        s.control = null;
      }, 'Stock: control cerrado');
      return vista(guardado, 'jefe');
    },
  },

  descartar: {
    soloJefe: true,
    async hacer({ cuerpo }) {
      const guardado = await modificarStock((s) => {
        controlAbierto(s, cuerpo.controlId);
        s.control = null;
      }, 'Stock: control descartado');
      return vista(guardado, 'jefe');
    },
  },

  borrarHistorial: {
    soloJefe: true,
    async hacer({ cuerpo }) {
      const guardado = await modificarStock((s) => {
        s.historial = s.historial.filter((h) => h.id !== cuerpo.id);
      }, 'Stock: control borrado del historial');
      return vista(guardado, 'jefe');
    },
  },

  catalogo: {
    soloJefe: true,
    async hacer({ cuerpo }) {
      const catalogo = validarCatalogo(cuerpo);
      const guardado = await modificarStock((s) => Object.assign(s, catalogo), 'Stock: catálogo');
      return vista(guardado, 'jefe');
    },
  },

  ajustes: {
    soloJefe: true,
    async hacer({ cuerpo }) {
      const { pinJefe, pinCocina } = cuerpo;
      for (const pin of [pinJefe, pinCocina]) {
        if (pin !== undefined && !PIN_NUEVO.test(pin)) throw new ErrorStock('El PIN tiene que tener de 4 a 8 cifras');
      }
      const guardado = await modificarStock((s) => {
        if (cuerpo.restaurante !== undefined) s.ajustes.restaurante = texto(cuerpo.restaurante, 40, 'el nombre del restaurante', true);
        if (cuerpo.jefe !== undefined) s.ajustes.jefe = texto(cuerpo.jefe, 40, 'el nombre del jefe');
        if (cuerpo.whatsappJefe !== undefined) {
          const tel = texto(cuerpo.whatsappJefe, 30, 'el WhatsApp del jefe');
          if (!/^[+\d\s().-]*$/.test(tel)) throw new ErrorStock('El WhatsApp del jefe no parece un teléfono');
          s.ajustes.whatsappJefe = tel;
        }
        // Dos PINs iguales harían imposible saber quién entra.
        const choca = (pin, otro) => pinValido(pin) || pinCoincide(pin, otro);
        if (pinJefe !== undefined) {
          if (choca(pinJefe, s.pines.cocina)) throw new ErrorStock('Ese PIN ya lo usa otra persona. Elige otro.');
          s.pines.jefe = hashPin(pinJefe);
        }
        if (pinCocina !== undefined) {
          if (choca(pinCocina, s.pines.jefe)) throw new ErrorStock('Ese PIN ya lo usa otra persona. Elige otro.');
          s.pines.cocina = hashPin(pinCocina);
        }
      }, 'Stock: ajustes');
      return vista(guardado, 'jefe');
    },
  },

  // Móviles del jefe que reciben un aviso cuando llega un recuento.
  avisos: {
    soloJefe: true,
    async hacer({ cuerpo, stock }) {
      const { suscripcion, baja, comprobar } = cuerpo;
      if (!suscripcion || !suscripcionValida(suscripcion)) throw new ErrorStock('Suscripción inválida');
      if (comprobar) return { existe: stock.avisos.some((a) => a.endpoint === suscripcion.endpoint) };
      await modificarStock((s) => {
        s.avisos = s.avisos.filter((a) => a.endpoint !== suscripcion.endpoint);
        if (!baja) {
          s.avisos.push({ endpoint: suscripcion.endpoint, keys: { p256dh: suscripcion.keys.p256dh, auth: suscripcion.keys.auth }, creada: ahora() });
          if (s.avisos.length > 10) s.avisos.shift();
        }
      }, baja ? 'Stock: baja de avisos' : 'Stock: avisos del jefe');
      return { ok: true };
    },
  },
};
