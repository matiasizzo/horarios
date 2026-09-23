import { pinValido, esperar } from './_lib.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
  if (!pinValido(req.body?.pin)) {
    await esperar(1500);
    return res.status(401).json({ error: 'PIN incorrecto' });
  }
  res.status(200).json({ ok: true });
}
