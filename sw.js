// Service worker: solo recibe los avisos push. No guarda nada en caché,
// así los empleados siempre ven el horario publicado más reciente.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (ev) => ev.waitUntil(self.clients.claim()));

self.addEventListener('push', (ev) => {
  let aviso = {};
  try { aviso = ev.data.json(); } catch { aviso = { title: 'Horarios', body: ev.data?.text() || '' }; }
  ev.waitUntil(self.registration.showNotification(aviso.title || 'Horarios', {
    body: aviso.body || '',
    icon: '/assets/icono-192.png',
    badge: '/assets/icono-192.png',
    tag: aviso.tag,
    renotify: Boolean(aviso.tag),
    data: { url: aviso.url || '/' },
  }));
});

self.addEventListener('notificationclick', (ev) => {
  ev.notification.close();
  const url = new URL(ev.notification.data?.url || '/', self.location.origin).href;
  ev.waitUntil((async () => {
    const ventanas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const v of ventanas) {
      if (new URL(v.url).origin === self.location.origin) {
        await v.focus();
        return v.navigate(url);
      }
    }
    return self.clients.openWindow(url);
  })());
});
