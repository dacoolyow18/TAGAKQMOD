/* Build replaces these constants with the dependency list and its content hash. */
const release = '__POS_RELEASE__';
const assets = __POS_ASSETS__;
const cacheName = 'tagak-pos-shell-' + release;

self.addEventListener('install', event => {
  event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(Object.entries(assets).map(([path,integrity]) => new Request(path,{cache:'reload',integrity})))));
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('tagak-pos-shell-') && key !== cacheName) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== 'GET') return;
  const path = url.pathname === '/pos-app/' ? '/pos-app/index.html' : url.pathname;
  if (!Object.hasOwn(assets,path)) return;
  event.respondWith(caches.open(cacheName).then(async cache => await cache.match(path) || fetch(event.request)));
});
