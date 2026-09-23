// Lógica compartida de las funciones. Los archivos con "_" no son rutas en Vercel.
import { readFile, writeFile } from 'node:fs/promises';
import { timingSafeEqual } from 'node:crypto';
import path from 'node:path';

const RUTA_DATOS = 'data/horarios.json';
const REPO = process.env.GITHUB_REPO || 'matiasizzo/horarios';
const RAMA = process.env.GITHUB_BRANCH || 'main';
const LOCAL = process.env.LOCAL_WRITE === '1';

export function pinValido(pin) {
  const esperado = process.env.ADMIN_PIN || '';
  if (!esperado || typeof pin !== 'string') return false;
  const a = Buffer.from(pin);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Frena los intentos de adivinar el PIN.
export const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function github(ruta, opciones = {}) {
  const res = await fetch(`https://api.github.com/repos/${REPO}/${ruta}`, {
    ...opciones,
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...opciones.headers,
    },
  });
  if (!res.ok) {
    const texto = await res.text();
    throw new Error(`GitHub ${res.status}: ${texto.slice(0, 200)}`);
  }
  return res.json();
}

export async function leerDatos() {
  if (LOCAL || !process.env.GITHUB_TOKEN) {
    const texto = await readFile(path.join(process.cwd(), RUTA_DATOS), 'utf8');
    return { datos: JSON.parse(texto), sha: null };
  }
  const archivo = await github(`contents/${RUTA_DATOS}?ref=${encodeURIComponent(RAMA)}`);
  const texto = Buffer.from(archivo.content, 'base64').toString('utf8');
  return { datos: JSON.parse(texto), sha: archivo.sha };
}

export async function guardarDatos(datos, mensaje) {
  const texto = JSON.stringify(datos, null, 2) + '\n';
  if (LOCAL) {
    await writeFile(path.join(process.cwd(), RUTA_DATOS), texto);
    return;
  }
  if (!process.env.GITHUB_TOKEN) throw new Error('Falta configurar GITHUB_TOKEN en Vercel');
  const { sha } = await leerDatos();
  await github(`contents/${RUTA_DATOS}`, {
    method: 'PUT',
    body: JSON.stringify({
      message: mensaje,
      content: Buffer.from(texto, 'utf8').toString('base64'),
      sha,
      branch: RAMA,
    }),
  });
}

const HORA = /^([01]\d|2[0-3]):(00|30)$/;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

// Comprueba la forma de los datos antes de escribirlos en el repo.
export function validar(datos) {
  if (!datos || typeof datos !== 'object') return 'Datos vacíos';
  const { empleados, semanas } = datos;
  if (!empleados || !Array.isArray(empleados.sala) || !Array.isArray(empleados.cocina)) return 'Faltan empleados';
  const ids = new Set([...empleados.sala, ...empleados.cocina].map((e) => e.id));
  if (!semanas || typeof semanas !== 'object') return 'Faltan semanas';
  for (const [fecha, semana] of Object.entries(semanas)) {
    if (!FECHA.test(fecha)) return `Fecha inválida: ${fecha}`;
    for (const [id, dias] of Object.entries(semana)) {
      if (!ids.has(id)) return `Empleado desconocido: ${id}`;
      if (!Array.isArray(dias) || dias.length !== 7) return `Días inválidos para ${id}`;
      for (const tramos of dias) {
        if (!Array.isArray(tramos) || tramos.length > 2) return `Tramos inválidos para ${id}`;
        for (const t of tramos) {
          if (!Array.isArray(t) || t.length !== 2 || !HORA.test(t[0]) || !HORA.test(t[1])) {
            return `Hora inválida para ${id}`;
          }
        }
      }
    }
  }
  return null;
}
