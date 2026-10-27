// «حرف» service worker — precache app shell; models live in their own cache (harf-models-v1).
const VERSION = 'harf-v1.0.0';
const ASSETS = ['./', 'index.html', 'css/app.css', 'manifest.webmanifest', 'fonts/Vazirmatn-Variable.woff2',
  'js/app.js', 'js/store.js', 'js/voice.js', 'js/audio.js', 'js/model-cache.js', 'js/templates.js', 'js/whisper-worker.js',
  'js/core/normalizer.js', 'js/core/cleanup.js', 'js/core/memory.js', 'js/core/snippets.js', 'js/core/seed.js',
  'vendor/transformers.min.js', 'vendor/ort-wasm-simd-threaded.jsep.mjs', 'vendor/ort-wasm-simd-threaded.jsep.wasm',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/maskable-512.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION && k !== 'harf-models-v1').map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.includes('/models/')) return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request).then((r) => {
    if (r.ok) { const cp = r.clone(); caches.open(VERSION).then((c) => c.put(e.request, cp)); } return r;
  }).catch(() => (e.request.mode === 'navigate' ? caches.match('index.html') : Response.error()))));
});
