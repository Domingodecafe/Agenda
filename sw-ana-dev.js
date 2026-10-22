'use strict';
importScripts('./ana-environment.js?v=ana-dev-5');
const environment = self.AnaEnvironment;
if (!environment.isAllowed() || self.registration.scope !== environment.origin + environment.basePath) {
  throw new Error('Service Worker Ana DEV bloqueado fora da origem/escopo de testes.');
}
const CACHE = environment.cacheName;
const FILES = [
  './index.html', './styles.css?v=ana-dev-5', './ana-environment.js?v=ana-dev-5',
  './ana-sync-engine.js?v=ana-dev-5', './cloud-sync.js?v=ana-dev-5', './app.js?v=ana-dev-5',
  './manifest.webmanifest', './icon.svg'
];
const coreURLs = new Set(FILES.map(path => new URL(path, self.registration.scope).href));
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)));
});
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') event.waitUntil(self.skipWaiting());
});
// Não enumera, remove ou consulta caches/workers de outros aplicativos.
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== environment.origin || !url.pathname.startsWith(environment.basePath)) return;
  if (event.request.mode === 'navigate' && (url.pathname === environment.basePath || url.pathname === environment.basePath + 'index.html')) {
    event.respondWith(caches.open(CACHE).then(cache => cache.match('./index.html')).then(cached => cached || fetch(event.request)));
  } else if (coreURLs.has(url.href)) {
    event.respondWith(caches.open(CACHE).then(cache => cache.match(event.request)).then(cached => cached || fetch(event.request)));
  }
});
