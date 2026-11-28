const VERSION = 'tm-v20';
const SHELL = ['./', 'index.html', 'css/app.css', 'js/app.js', 'js/util.js', 'js/hours.js', 'js/store.js', 'js/geocode.js', 'js/help.js',
  'js/vendor/leaflet.js', 'js/vendor/leaflet.css', 'manifest.webmanifest', 'icons/icon-192.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;           // 地圖圖磚、API 一律走網路
  if (u.pathname.endsWith('/data.json')) {                                          // 資料：網路優先，離線用快取
    e.respondWith(fetch(e.request).then(r => { const cp = r.clone(); caches.open(VERSION).then(c => c.put('data.json', cp)); return r; })
      .catch(() => caches.match('data.json')));
    return;
  }
  e.respondWith(fetch(e.request).then(r => { const cp = r.clone(); caches.open(VERSION).then(c => c.put(e.request, cp)); return r; })   // 程式：網路優先，離線備援
    .catch(() => caches.match(e.request, { ignoreSearch: true })));
});
