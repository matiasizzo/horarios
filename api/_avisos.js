// Avisos push: suscripciones cifradas en el repo y envío de mensajes personalizados.
import { createCipheriv, createDecipheriv, createECDH, createHash, randomBytes } from 'node:crypto';
import webpush from 'web-push';
import { leerArchivo, guardarArchivo } from './_lib.js';
import {
  DIAS_ABIERTOS, DIAS_CORTOS, diasDe, formatoHoras, minutosSemana, rangoSemana,
} from '../assets/common.js';

const RUTA = 'data/avisos.json';
const MAX_SUSCRIPCIONES = 100;
// Solo se aceptan direcciones de los servicios de push de los navegadores.
const HOSTS_PUSH = /(^|\.)(fcm\.googleapis\.com|push\.apple\.com|push\.services\.mozilla\.com|notify\.windows\.com)$/;

// Quita espacios, saltos de línea, comillas y el "=" final que se cuelan al pegar en Vercel.
const limpiar = (v) => (v || '').replace(/[\s"']/g, '').replace(/=+$/, '');

export function clavesAvisos() {
  const publica = limpiar(process.env.VAPID_PUBLIC_KEY);
  const privada = limpiar(process.env.VAPID_PRIVATE_KEY);
  return publica && privada ? { publica, privada } : null;
}

// Comprueba que la clave pública corresponde a la privada (si se copiaron de dos
// generaciones distintas, Apple y Google rechazan todos los envíos).
export function clavesCoinciden() {
  const claves = clavesAvisos();
  if (!claves) return false;
  try {
    const ecdh = createECDH('prime256v1');
    ecdh.setPrivateKey(Buffer.from(claves.privada, 'base64url'));
    return ecdh.getPublicKey().toString('base64url') === claves.publica;
  } catch {
    return false;
  }
}

function claveCifrado() {
  return createHash('sha256').update(`horarios-avisos:${clavesAvisos()?.privada}`).digest();
}

// El repo es público: el archivo se guarda cifrado con una clave derivada de VAPID_PRIVATE_KEY.
function cifrar(obj) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', claveCifrado(), iv);
  const datos = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return JSON.stringify({
    nota: 'Suscripciones a los avisos, cifradas.',
    iv: iv.toString('base64'),
    tag: c.getAuthTag().toString('base64'),
    datos: datos.toString('base64'),
  }, null, 2) + '\n';
}

function descifrar(texto) {
  try {
    const { iv, tag, datos } = JSON.parse(texto);
    const d = createDecipheriv('aes-256-gcm', claveCifrado(), Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    const plano = Buffer.concat([d.update(Buffer.from(datos, 'base64')), d.final()]).toString('utf8');
    return JSON.parse(plano);
  } catch {
    // Si cambiaron las claves, las suscripciones viejas ya no sirven: se empieza de cero.
    return null;
  }
}

const vacio = () => ({ suscripciones: [], avisadas: {} });

export async function leerAvisos() {
  const archivo = await leerArchivo(RUTA);
  return { avisos: (archivo && descifrar(archivo.texto)) || vacio(), sha: archivo?.sha ?? null };
}

// Lee, modifica y guarda; reintenta si otra petición escribió a la vez.
export async function modificarAvisos(cambio, mensaje) {
  for (let intento = 0; ; intento++) {
    const { avisos, sha } = await leerAvisos();
    const resultado = await cambio(avisos);
    try {
      await guardarArchivo(RUTA, cifrar(avisos), mensaje, sha);
      return resultado;
    } catch (e) {
      if (intento < 3 && (e.status === 409 || e.status === 422)) continue;
      throw e;
    }
  }
}

export function suscripcionValida(s) {
  try {
    const url = new URL(s.endpoint);
    return url.protocol === 'https:' && HOSTS_PUSH.test(url.hostname)
      && typeof s.keys?.p256dh === 'string' && typeof s.keys?.auth === 'string';
  } catch {
    return false;
  }
}

export function agregarSuscripcion(avisos, empleado, s) {
  avisos.suscripciones = avisos.suscripciones.filter((x) => x.endpoint !== s.endpoint);
  avisos.suscripciones.push({
    empleado,
    endpoint: s.endpoint,
    keys: { p256dh: s.keys.p256dh, auth: s.keys.auth },
    creada: new Date().toISOString(),
  });
  if (avisos.suscripciones.length > MAX_SUSCRIPCIONES) avisos.suscripciones.shift();
}

// Quién necesita aviso en una semana: todos si nunca se avisó, o solo a quien le cambió.
export function estadoSemana(datos, avisos, semana) {
  const empleados = [...datos.empleados.sala, ...datos.empleados.cocina];
  const previas = avisos.avisadas[semana];
  const cambiados = previas
    ? empleados.filter((e) => previas[e.id] !== JSON.stringify(diasDe(datos.semanas[semana], e.id))).map((e) => e.id)
    : [];
  const suscritos = [...new Set(avisos.suscripciones.map((s) => s.empleado))];
  return { avisada: Boolean(previas), cambiados, suscritos };
}

function mensaje(datos, semana, empleado, cambio) {
  const dias = diasDe(datos.semanas[semana], empleado.id);
  const turnos = DIAS_ABIERTOS
    .filter((i) => dias[i].length)
    .map((i) => `${DIAS_CORTOS[i]} ${dias[i].map(([a, b]) => `${a}–${b}`).join(' y ')}`);
  const detalle = turnos.length ? `${turnos.join(' · ')} · ${formatoHoras(minutosSemana(dias))} h` : 'Libre toda la semana';
  return {
    title: cambio ? `${empleado.nombre}, cambió tu horario` : `${empleado.nombre}, ya está tu horario`,
    body: `Semana ${rangoSemana(semana)}\n${detalle}`,
    url: `/#/yo/${empleado.id}`,
    tag: `horarios-${semana}`,
  };
}

// Envía los avisos a los empleados indicados. Devuelve el resumen y una función
// que aplica el resultado (semana avisada, suscripciones caducadas) al archivo.
export async function enviarAvisos(datos, avisos, semana, ids, origen) {
  const { publica, privada } = clavesAvisos();
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || origen, publica, privada);
  const empleados = [...datos.empleados.sala, ...datos.empleados.cocina].filter((e) => ids.includes(e.id));
  const cambio = Boolean(avisos.avisadas[semana]);
  const caducadas = new Set();
  let enviados = 0;
  let fallidos = 0;
  const errores = [];

  await Promise.all(avisos.suscripciones.map(async (s) => {
    const empleado = empleados.find((e) => e.id === s.empleado);
    if (!empleado) return;
    try {
      await webpush.sendNotification(s, JSON.stringify(mensaje(datos, semana, empleado, cambio)), { TTL: 60 * 60 * 24 * 3 });
      enviados++;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) caducadas.add(s.endpoint);
      else if (/VapidPkHashMismatch/.test(e.body || '')) {
        // Suscrita con claves anteriores: se borra y el móvil se renueva solo al abrir la app.
        caducadas.add(s.endpoint);
        fallidos++;
        errores.push(`${empleado.nombre}: tiene que abrir la app una vez para renovar los avisos`);
      } else {
        fallidos++;
        const detalle = String(e.body || e.message || '').replace(/\s+/g, ' ').slice(0, 160);
        errores.push(`${empleado.nombre}: ${e.statusCode ?? 'sin respuesta'} ${detalle}`.trim());
        console.error('Aviso fallido', new URL(s.endpoint).hostname, e.statusCode, e.body || e.message);
      }
    }
  }));

  const conAviso = new Set(avisos.suscripciones.filter((s) => !caducadas.has(s.endpoint)).map((s) => s.empleado));
  const aplicar = (av) => {
    av.suscripciones = av.suscripciones.filter((s) => !caducadas.has(s.endpoint));
    av.avisadas[semana] ??= {};
    for (const e of empleados) av.avisadas[semana][e.id] = JSON.stringify(diasDe(datos.semanas[semana], e.id));
  };
  return {
    resumen: { enviados, fallidos, errores, sinAvisos: empleados.filter((e) => !conAviso.has(e.id)).map((e) => e.nombre) },
    aplicar,
  };
}
