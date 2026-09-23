import { pinValido, esperar, leerDatos } from './_lib.js';
import { clavesAvisos, clavesCoinciden, leerAvisos, modificarAvisos, estadoSemana, enviarAvisos } from './_avisos.js';

// GET: clave pública para que los móviles se suscriban.
// POST (con PIN): { accion: 'estado' | 'enviar', semana, solo: 'cambios' | 'todos' }.
export default async function handler(req, res) {
  const claves = clavesAvisos();
  if (req.method === 'GET') return res.status(200).json({ publica: claves?.publica ?? null });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const { pin, accion, semana, solo } = req.body || {};
  if (!pinValido(pin)) {
    await esperar(1500);
    return res.status(401).json({ error: 'PIN incorrecto' });
  }
  if (!claves) return res.status(200).json({ configurado: false });
  if (!clavesCoinciden()) return res.status(200).json({ configurado: true, clavesMal: true });

  try {
    const { datos } = await leerDatos();
    if (!datos.semanas[semana]) return res.status(400).json({ error: 'Esa semana no está publicada todavía' });
    const { avisos } = await leerAvisos();
    const estado = estadoSemana(datos, avisos, semana);
    if (accion === 'estado') return res.status(200).json({ configurado: true, ...estado });
    if (accion !== 'enviar') return res.status(400).json({ error: 'Acción desconocida' });

    const todos = [...datos.empleados.sala, ...datos.empleados.cocina].map((e) => e.id);
    const ids = solo === 'cambios' ? estado.cambiados : todos;
    const origen = `https://${req.headers.host}`;
    const { resumen, aplicar } = await enviarAvisos(datos, avisos, semana, ids, origen);
    await modificarAvisos(aplicar, `Avisos: semana del ${semana}`);
    res.status(200).json({ ok: true, ...resumen });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}
