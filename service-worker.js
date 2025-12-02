// service-worker.js
const VERSION = 'v6';
const PRECACHE = [
  './',
  './index.html',
  './dashboard.html',
  './ordem-servico.html',
  './calendario.html',
  './local.html',
  './tecnico.html',
  './cliente.html',
  './css/style.css',
  './js/script.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './offline.html'
];

// Instala o SW e faz cache dos arquivos definidos acima
self.addEventListener('install', (event) => {
  console.log('[SW] Instalando versão', VERSION);
  event.waitUntil(
    caches.open(VERSION).then(cache => cache.addAll(PRECACHE))
  );
});

// Remove caches antigos ao ativar nova versão
self.addEventListener('activate', (event) => {
  console.log('[SW] Ativando nova versão', VERSION);
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))
    )
  );
});

// Intercepta requisições para trabalhar offline
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  event.respondWith(
    caches.match(req).then(cached => {
      const fetchPromise = fetch(req).then(res => {
        const copy = res.clone();
        caches.open(VERSION).then(cache => cache.put(req, copy));
        return res;
      }).catch(() => cached || caches.match('./offline.html'));
      return cached || fetchPromise;
    })
  );
});
