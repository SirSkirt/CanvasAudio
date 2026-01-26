const CACHE = "canvasaudio-shell-v2";
const CORE = [
  "./",
  "./index.html",
  "./style.css",
  "./canvasaudio.js",
  "./manifest.webmanifest",
  "./version.json"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(CORE)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => (k !== CACHE ? caches.delete(k) : Promise.resolve())));
      await self.clients.claim();
    })()
  );
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  } catch (e) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw e;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok) cache.put(request, response.clone());
  return response;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle same-origin
  if (url.origin !== self.location.origin) return;

  const isCore =
    req.mode === "navigate" ||
    url.pathname.endsWith("/index.html") ||
    url.pathname.endsWith("/canvasaudio.js") ||
    url.pathname.endsWith("/style.css") ||
    url.pathname.endsWith("/version.json") ||
    url.pathname.endsWith("/manifest.webmanifest");

  event.respondWith(isCore ? networkFirst(req) : cacheFirst(req));
});
