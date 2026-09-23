// Avisos push en el móvil del empleado: alta, baja y estado.

const CLAVE = 'horarios-avisos-empleado';

export const estadoAvisos = {
  publica: null, // null = el servidor aún no tiene avisos configurados
  empleado: null, // empleado suscrito en este móvil
  permiso: typeof Notification === 'undefined' ? 'no-soportado' : Notification.permission,
};

function leerLocal() {
  try { return localStorage.getItem(CLAVE); } catch { return null; }
}
function guardarLocal(valor) {
  try {
    if (valor) localStorage.setItem(CLAVE, valor);
    else localStorage.removeItem(CLAVE);
  } catch { /* sin almacenamiento */ }
}

export function soporte() {
  const esIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const instalada = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if (esIos && !instalada) return 'ios-sin-instalar';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || typeof Notification === 'undefined') return 'no-soportado';
  return 'ok';
}

function claveBinaria(base64url) {
  const b64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function base64url(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Una suscripción creada con otra clave pública (p. ej. antes de cambiar las claves) ya no sirve.
function mismaClave(sub) {
  const clave = sub.options?.applicationServerKey;
  if (!clave) return true; // El navegador no la expone: no se puede comprobar.
  return base64url(clave) === String(estadoAvisos.publica).replace(/=+$/, '');
}

async function registro() {
  return navigator.serviceWorker.register('/sw.js');
}

async function pedir(cuerpo) {
  const res = await fetch('/api/suscribir', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Error ${res.status}`);
  return json;
}

// Carga el estado al abrir la app. Nunca lanza: si algo falla, los avisos simplemente no se muestran.
export async function cargarAvisos(alCambiar) {
  try {
    const res = await fetch('/api/avisos');
    estadoAvisos.publica = (await res.json()).publica;
  } catch {
    estadoAvisos.publica = null;
  }
  estadoAvisos.empleado = leerLocal();
  alCambiar?.();
  if (soporte() !== 'ok') return;
  estadoAvisos.permiso = Notification.permission;
  try {
    const reg = await registro();
    const sub = await reg.pushManager.getSubscription();
    const empleado = leerLocal();
    if (sub && empleado && estadoAvisos.publica && Notification.permission === 'granted') {
      // Si cambiaron las claves o el servidor ya no la tiene, se renueva sin que el empleado haga nada.
      const vigente = mismaClave(sub)
        && (await pedir({ comprobar: true, empleado, suscripcion: sub.toJSON() })).existe;
      if (!vigente) {
        await sub.unsubscribe();
        await activarAvisos(empleado);
        return;
      }
    }
    estadoAvisos.empleado = sub ? empleado : null;
    if (!sub) guardarLocal(null);
  } catch {
    estadoAvisos.empleado = null;
  }
}

export async function activarAvisos(empleado) {
  const permiso = await Notification.requestPermission();
  estadoAvisos.permiso = permiso;
  if (permiso !== 'granted') throw new Error('Sin permiso para mostrar avisos');
  const reg = await registro();
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (sub && !mismaClave(sub)) {
    await sub.unsubscribe();
    sub = null;
  }
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: claveBinaria(estadoAvisos.publica),
    });
  }
  await pedir({ empleado, suscripcion: sub.toJSON() });
  guardarLocal(empleado);
  estadoAvisos.empleado = empleado;
}

export async function desactivarAvisos() {
  const reg = await registro();
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    await pedir({ baja: true, suscripcion: sub.toJSON() }).catch(() => {});
    await sub.unsubscribe();
  }
  guardarLocal(null);
  estadoAvisos.empleado = null;
}
