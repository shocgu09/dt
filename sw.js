const CACHE = 'dt-club-v13';   // 올리면 activate 에서 옛 캐시(쌓인 ?v= 버전·HTML)를 통째로 지운다
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
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
      .then(clients => clients.forEach(client => client.postMessage({ type: 'SW_UPDATED' })))
  );
});

/* 캐시에 넣으면서 같은 경로의 옛 버전(?v=)을 지운다.
 * style.css?v=32 → ?v=33 처럼 배포할 때마다 새 주소가 생기는데, 예전에는 옛 주소가 캐시에 계속 쌓였다. */
function putAndPrune(cache, request, response) {
  const url = new URL(request.url);
  return cache.put(request, response).then(() => {
    if (!url.searchParams.has('v')) return;
    return cache.keys().then(keys => Promise.all(keys
      .filter(k => { const u = new URL(k.url); return u.pathname === url.pathname && u.search !== url.search; })
      .map(k => cache.delete(k))));
  });
}

/* 페이지(HTML) 요청인가 — 주소 이동이거나 HTML 을 달라는 요청 */
function isPageRequest(req) {
  return req.mode === 'navigate' || req.destination === 'document'
    || (req.headers.get('accept') || '').includes('text/html');
}

self.addEventListener('fetch', e => {
  // Firebase / 외부 API는 캐시 건너뜀
  if (!e.request.url.startsWith(self.location.origin)) return;
  // Cache API 는 GET 만 저장할 수 있다 — 그 외는 그대로 네트워크로
  if (e.request.method !== 'GET') return;

  // 페이지(HTML)는 네트워크 우선 — 배포 직후 첫 방문에도 새 HTML(새 ?v= 주소)을 받는다.
  // 쿼리(?code=, ?dm= …)는 떼고 경로 하나로만 저장해 쌓이지 않게 하고, 오프라인일 때만 캐시로 연다.
  if (isPageRequest(e.request)) {
    const url = new URL(e.request.url);
    const key = url.origin + url.pathname;
    e.respondWith(
      fetch(e.request).then(response => {
        if (response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(key, copy));
        }
        return response;
      }).catch(() => caches.open(CACHE).then(cache =>
        cache.match(key).then(hit => hit || cache.match(e.request, { ignoreSearch: true }))
      ).then(hit => hit || Response.error()))
    );
    return;
  }

  // 그 밖의 정적 파일은 Stale-While-Revalidate: 캐시 즉시 반환 + 백그라운드에서 캐시 최신화
  e.respondWith(
    caches.open(CACHE).then(cache =>
      cache.match(e.request).then(cached => {
        const networkFetch = fetch(e.request).then(response => {
          // 정상 응답만 저장한다 — 일시적인 404/5xx 가 캐시에 박혀 계속 내려가는 것을 막는다
          if (response.ok) putAndPrune(cache, e.request, response.clone());
          return response;
        }).catch(() => cached);
        return cached || networkFetch;
      })
    )
  );
});

/* ===== 현재 보고 있는 대화방 ID (앱에서 설정) ===== */
let _viewingConvId = null;

/* ===== 푸시 알림 수신 ===== */
self.addEventListener('push', event => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }

  const { title, body, convId, unreadCount } = data;

  // 해당 대화방을 보고 있으면 알림 생략
  if (convId && _viewingConvId === convId) return;

  event.waitUntil(
    self.registration.showNotification(title || 'DT Club', {
      body: body || '새 메시지가 도착했습니다',
      icon: '/icon-192.png',
      badge: '/icon-badge-96.png',
      tag: convId ? `dm-${convId}` : 'dm-general',
      renotify: true,
      data: { convId }
    }).then(() => {
      if (navigator.setAppBadge) {
        if (unreadCount > 0) return navigator.setAppBadge(unreadCount);
        return self.registration.getNotifications().then(notifications => {
          navigator.setAppBadge(notifications.length || 1);
        });
      }
    })
  );
});

/* ===== 알림 클릭 → 앱 열기 & DM 이동 ===== */
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const convId = event.notification.data?.convId;

  event.waitUntil(
    // 해당 대화의 알림 모두 닫기
    self.registration.getNotifications({ tag: convId ? `dm-${convId}` : undefined }).then(notifications => {
      notifications.forEach(n => n.close());
    }).then(() =>
      // 남은 알림으로 뱃지 업데이트
      self.registration.getNotifications()
    ).then(remaining => {
      if (navigator.setAppBadge) {
        remaining.length > 0 ? navigator.setAppBadge(remaining.length) : navigator.clearAppBadge();
      }
    }).then(() =>
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
        for (const client of windowClients) {
          if (client.url.includes(self.location.origin)) {
            client.focus();
            client.postMessage({ type: 'OPEN_DM', convId });
            return;
          }
        }
        return clients.openWindow('/' + (convId ? '?dm=' + convId : ''));
      })
    )
  );
});

/* ===== 앱에서 메시지 수신 ===== */
self.addEventListener('message', event => {
  // 대화방 열림/닫힘 알림 → 푸시 알림 억제용
  if (event.data?.type === 'DM_VIEWING') {
    _viewingConvId = event.data.convId || null;
  }
  if (event.data?.type === 'CLEAR_NOTIFICATIONS') {
    const convId = event.data.convId;
    self.registration.getNotifications({ tag: convId ? `dm-${convId}` : undefined }).then(notifications => {
      notifications.forEach(n => n.close());
    }).then(() => self.registration.getNotifications()).then(remaining => {
      if (navigator.setAppBadge) {
        remaining.length > 0 ? navigator.setAppBadge(remaining.length) : navigator.clearAppBadge();
      }
    });
  } else if (event.data?.type === 'CLEAR_ALL_BADGES') {
    self.registration.getNotifications().then(notifications => {
      notifications.forEach(n => n.close());
    });
    if (navigator.clearAppBadge) navigator.clearAppBadge();
  }
});
