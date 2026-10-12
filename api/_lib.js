// Lógica compartida de las funciones. Los archivos con "_" no son rutas en Vercel.
import { readFile, writeFile } from 'node:fs/promises';
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';
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

// Quita espacios, saltos de línea, comillas y el "=" final que se cuelan al pegar en Vercel.
export const limpiar = (v) => (v || '').replace(/[\s"']/g, '').replace(/=+$/, '');

// El repo es público: lo que no deba verse se guarda cifrado (AES-256-GCM, clave de 32 bytes).
export function cifrar(obj, clave, nota) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', clave, iv);
  const datos = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return JSON.stringify({
    nota,
    iv: iv.toString('base64'),
    tag: c.getAuthTag().toString('base64'),
    datos: datos.toString('base64'),
  }, null, 2) + '\n';
}

// Devuelve null si el texto no se puede descifrar con esa clave.
export function descifrar(texto, clave) {
  try {
    const { iv, tag, datos } = JSON.parse(texto);
    const d = createDecipheriv('aes-256-gcm', clave, Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    const plano = Buffer.concat([d.update(Buffer.from(datos, 'base64')), d.final()]).toString('utf8');
    return JSON.parse(plano);
  } catch {
    return null;
  }
}

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
    throw Object.assign(new Error(`GitHub ${res.status}: ${texto.slice(0, 200)}`), { status: res.status });
  }
  return res.json();
}

// Lee un archivo del repo (o del disco en local). Devuelve null si no existe.
export async function leerArchivo(ruta) {
  if (LOCAL || !process.env.GITHUB_TOKEN) {
    try {
      return { texto: await readFile(path.join(process.cwd(), ruta), 'utf8'), sha: null };
    } catch (e) {
      if (e.code === 'ENOENT') return null;
      throw e;
    }
  }
  try {
    const archivo = await github(`contents/${ruta}?ref=${encodeURIComponent(RAMA)}`);
    return { texto: Buffer.from(archivo.content, 'base64').toString('utf8'), sha: archivo.sha };
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
}

// Escribe un archivo en el repo. Con sha === undefined lo busca; con null lo crea.
export async function guardarArchivo(ruta, texto, mensaje, sha) {
  if (LOCAL) {
    await writeFile(path.join(process.cwd(), ruta), texto);
    return;
  }
  if (!process.env.GITHUB_TOKEN) throw new Error('Falta configurar GITHUB_TOKEN en Vercel');
  if (sha === undefined) sha = (await leerArchivo(ruta))?.sha ?? null;
  await github(`contents/${ruta}`, {
    method: 'PUT',
    body: JSON.stringify({
      message: mensaje,
      content: Buffer.from(texto, 'utf8').toString('base64'),
      ...(sha ? { sha } : {}),
      branch: RAMA,
    }),
  });
}

export async function leerDatos() {
  const archivo = await leerArchivo(RUTA_DATOS);
  if (!archivo) throw new Error(`No existe ${RUTA_DATOS}`);
  return { datos: JSON.parse(archivo.texto), sha: archivo.sha };
}

export async function guardarDatos(datos, mensaje) {
  await guardarArchivo(RUTA_DATOS, JSON.stringify(datos, null, 2) + '\n', mensaje);
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
