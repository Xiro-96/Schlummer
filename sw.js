/* Service Worker: App-Shell offline verfügbar halten. */
const CACHE = 'schlummer-v50';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/audio.js',
  './js/data.js',
  './js/experiment.js',
  './js/explain.js',
  './js/learning.js',
  './js/norms.js',
  './js/schedule.js',
  './js/sounds.js',
  './js/store.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/*
 * Der eigene Code (Seite, Skripte, Stile) wird zuerst aus dem Netz geholt,
 * alles andere zuerst aus dem Speicher.
 *
 * Vorher war es ueberall umgekehrt, und das hatte eine unangenehme Folge:
 * Nach einer neuen Version zeigte der erste Start noch die alte aus dem
 * Cache, und erst der zweite die neue. Wer einmal nachgeschaut und nichts
 * Neues gesehen hat, schaut kein zweites Mal - fuer ihn war das Update
 * schlicht nicht da. Bilder und Klaenge aendern sich dagegen nie und
 * duerfen weiter sofort aus dem Speicher kommen.
 */
function istAppCode(url) {
  return (
    url.pathname.endsWith('/') ||
    /\.(html|js|css|webmanifest)$/.test(url.pathname)
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  const url = new URL(request.url);

  const ausDemNetz = () =>
    fetch(request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy));
      }
      return response;
    });

  if (request.mode === 'navigate' || istAppCode(url)) {
    event.respondWith(
      ausDemNetz().catch(() =>
        caches.match(request).then((cached) => cached || caches.match('./index.html'))
      )
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => cached || ausDemNetz().catch(() => caches.match('./index.html')))
  );
});
