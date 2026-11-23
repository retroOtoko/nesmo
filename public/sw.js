// NesMo service worker. On install it downloads the whole app (page, code,
// the ca65/ld65 assembler and icons) so NesMo opens and builds with no
// connection after the first visit. The build fills in VERSION and PRECACHE.
const VERSION = '__VERSION__';
const PRECACHE = [/* __PRECACHE__ */];
const CACHE = 'nesmo-' + VERSION;
const PAGE_TIMEOUT_MS = 3500;

const scope = () => self.registration.scope;
const url = (path) => new URL(path, scope()).href;

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(PRECACHE.map((p) => new Request(url(p), { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('nesmo-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'version') e.source?.postMessage({ version: VERSION, files: PRECACHE.length });
});

function timeout(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));
}

async function cachedPage(req) {
  return (
    (await caches.match(req, { ignoreSearch: true, ignoreVary: true })) ||
    (await caches.match(url('./'), { ignoreVary: true })) ||
    (await caches.match(url('index.html'), { ignoreVary: true })) ||
    Response.error()
  );
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;

  if (req.mode === 'navigate') {
    // Page: try the network briefly so updates arrive, fall back to the saved copy.
    e.respondWith(
      Promise.race([fetch(req), timeout(PAGE_TIMEOUT_MS)])
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
            return res;
          }
          return cachedPage(req).then((r) => (r.type === 'error' ? res : r));
        })
        .catch(() => cachedPage(req)),
    );
    return;
  }

  // Everything else: saved copy first (file names carry content hashes), then network.
  e.respondWith(
    caches.match(req, { ignoreSearch: true, ignoreVary: true }).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
