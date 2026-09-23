import { pinValido, esperar, validar, guardarDatos } from './_lib.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
  const { pin, datos, semana } = req.body || {};
  if (!pinValido(pin)) {
    await esperar(1500);
    return res.status(401).json({ error: 'PIN incorrecto' });
  }
  const error = validar(datos);
  if (error) return res.status(400).json({ error });
  try {
    await guardarDatos(datos, `Horarios: semana del ${semana || 'sin fecha'}`);
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}
