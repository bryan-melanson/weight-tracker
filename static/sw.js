/* The service worker: what makes the installed app open without a network.

   Everything the app needs is listed below and cached on install — there is
   no CDN and no API to reach, so once this succeeds the app is fully offline
   and stays that way.

   Updating: bump CACHE_VERSION. The new worker precaches alongside the old
   one and takes over on the next launch rather than mid-session, so a running
   app can never end up with half its ES modules from each version. */

const CACHE_VERSION = 'v2';
const CACHE_NAME = `weight-tracker-${CACHE_VERSION}`;

const PRECACHE = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/api.js',
  'js/app.js',
  'js/download.js',
  'js/format.js',
  'js/kpis.js',
  'js/persistence.js',
  'js/pwa.js',
  'js/stats.js',
  'js/table.js',
  'js/backend/csv.js',
  'js/backend/http.js',
  'js/backend/idb.js',
  'js/backend/limits.js',
  'js/backend/local.js',
  'js/backend/store.js',
  'js/backend/validate.js',
  'js/backup/config.js',
  'js/backup/github.js',
  'js/backup/panel.js',
  'js/backup/service.js',
  'js/charts/balance.js',
  'js/charts/calories.js',
  'js/charts/core.js',
  'js/charts/weight.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE)),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) => Promise.all(
      names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name)),
    )),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  /* Only this app's own files are ours to serve. Anything cross-origin — the
     GitHub API a backup talks to — goes straight to the network, so an
     authenticated response can never meet this cache. */
  if (new URL(request.url).origin !== self.location.origin) return;

  /* A navigation to any URL in scope is the app itself: serve the shell, so
     opening the app offline works however it was launched. */
  if (request.mode === 'navigate') {
    event.respondWith(
      caches.match('index.html', { cacheName: CACHE_NAME })
        .then((cached) => cached || fetch(request)),
    );
    return;
  }

  event.respondWith(
    caches.match(request, { cacheName: CACHE_NAME }).then((cached) => cached || fetch(request)),
  );
});
