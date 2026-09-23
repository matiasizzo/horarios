import { leerDatos } from './_lib.js';

// Lee los datos al día desde el repo, sin esperar a que Vercel vuelva a publicar.
export default async function handler(req, res) {
  try {
    const { datos } = await leerDatos();
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(datos);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
