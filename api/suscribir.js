import { leerDatos } from './_lib.js';
import { clavesAvisos, modificarAvisos, suscripcionValida, agregarSuscripcion } from './_avisos.js';

// Alta o baja de un móvil en los avisos. Es público: cualquiera con la web puede activarlos.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
  if (!clavesAvisos()) return res.status(503).json({ error: 'Los avisos todavía no están configurados' });
  const { empleado, suscripcion, baja } = req.body || {};
  if (!suscripcion || !suscripcionValida(suscripcion)) return res.status(400).json({ error: 'Suscripción inválida' });
  try {
    if (baja) {
      await modificarAvisos((av) => {
        av.suscripciones = av.suscripciones.filter((s) => s.endpoint !== suscripcion.endpoint);
      }, 'Avisos: baja');
      return res.status(200).json({ ok: true });
    }
    const { datos } = await leerDatos();
    const existe = [...datos.empleados.sala, ...datos.empleados.cocina].some((e) => e.id === empleado);
    if (!existe) return res.status(400).json({ error: 'Empleado desconocido' });
    await modificarAvisos((av) => agregarSuscripcion(av, empleado, suscripcion), 'Avisos: nueva suscripción');
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}
