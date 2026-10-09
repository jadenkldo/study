/* Phone shell service worker: keeps the shell itself (this folder) available offline.
   The study apps, their state and the notes are NOT cached here: the shell keeps those in IndexedDB, stamped with
   Drive's modified time, and the gatekeeper's calls always go straight to the network.
   index.html and apps.json are network-first (so a new upload reaches the phone on the next open, and offline falls
   back to the last copy); the rest of the shell answers from cache and refreshes behind; Google Fonts are kept once fetched. */
const SHELL = 'study-shell-v6', FONTS = 'study-fonts-v1';   /* bump SHELL on every shell upload */
const CORE = ['./', 'index.html', 'diag.html', 'apps.json', 'manifest.webmanifest', 'vendor/marked.min.js',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== SHELL && k !== FONTS).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

function withTimeout(p, ms) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('slow')), ms))]);
}
async function networkFirst(req) {
  const c = await caches.open(SHELL);
  try {
    const r = await withTimeout(fetch(req, { cache: 'no-cache' }), 5000);
    if (r && r.ok) c.put(req, r.clone());
    return r;
  } catch (e) {
    return (await c.match(req, { ignoreSearch: true })) || (await c.match('index.html')) || Response.error();
  }
}
async function cacheFirst(req) {   /* stale-while-revalidate: instant from cache, refreshed for next time */
  const c = await caches.open(SHELL);
  const hit = await c.match(req, { ignoreSearch: true });
  const net = fetch(req, { cache: 'no-cache' }).then(r => { if (r && r.ok) c.put(req, r.clone()); return r; }).catch(() => null);
  return hit || (await net) || Response.error();
}
async function fonts(req) {
  const c = await caches.open(FONTS);
  const hit = await c.match(req);
  const net = fetch(req).then(r => { if (r && (r.ok || r.type === 'opaque')) c.put(req, r.clone()); return r; }).catch(() => null);
  return hit || (await net) || Response.error();
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') { e.respondWith(fonts(req)); return; }
  if (url.origin !== self.location.origin) return;               /* the gatekeeper and everything else: untouched */
  const rel = url.pathname.slice(new URL(self.registration.scope).pathname.length);
  if (rel === '' || rel === 'index.html' || rel === 'apps.json' || rel === 'diag.html' || req.mode === 'navigate') e.respondWith(networkFirst(req));
  else e.respondWith(cacheFirst(req));
});
