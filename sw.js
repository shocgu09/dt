const CACHE = 'dt-club-v2';
const STATIC = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/firebase-config.js',
  '/icon-192.png',
  '/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(STATIC)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  // Firebase / 외부 API는 캐시 건너뜀
  if (!e.request.url.startsWith(self.location.origin)) return;
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});

/* ===== 푸시 알림 수신 ===== */
self.addEventListener('push', event => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }

  const { title, body, convId } = data;

  event.waitUntil(
    self.registration.showNotification(title || 'DT Club', {
      body: body || '새 메시지가 도착했습니다',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: convId ? `dm-${convId}` : 'dm-general',
      renotify: true,
      data: { convId }
    })
  );
});

/* ===== 알림 클릭 → 앱 열기 & DM 이동 ===== */
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const convId = event.notification.data?.convId;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      // 이미 열려 있는 창 찾기
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin)) {
          client.focus();
          client.postMessage({ type: 'OPEN_DM', convId });
          return;
        }
      }
      // 새 창 열기
      return clients.openWindow('/' + (convId ? '?dm=' + convId : ''));
    })
  );
});
