const CACHE='mym-panel-v10-friendly';
const ASSETS=[
  './',
  './index.html',
  './styles.css?v=20260926-2',
  './app.js?v=20260926-2',
  './config.js?v=20260926-2',
  './historical-data.js?v=20260926-2',
  './manifest.json',
  './brand-logo.png?v=20260926-2',
  './brand-cover.png?v=20260926-2'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith((async () => {
    try {
      const fresh = await fetch(event.request, { cache: 'no-store' });
      const cache = await caches.open(CACHE);
      cache.put(event.request, fresh.clone());
      return fresh;
    } catch {
      return (await caches.match(event.request)) || (await caches.match('./index.html'));
    }
  })());
});
