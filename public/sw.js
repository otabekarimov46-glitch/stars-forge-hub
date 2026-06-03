// Starment Mini App service worker — aggressive static caching
const CACHE = "starment-static-v3";
const STATIC_PATTERNS = [
  /\.(?:js|css|woff2?|ttf|otf|eot|ico|png|jpg|jpeg|webp|svg|gif)(\?.*)?$/i,
];
const SKIP_HOSTS = ["api.telegram.org", "supabase.co"];

self.addEventListener("install", (e) => {
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (SKIP_HOSTS.some((h) => url.hostname.includes(h))) return;
  // Don't cache HTML navigations (avoid stale shell)
  if (req.mode === "navigate") return;
  const isStatic = STATIC_PATTERNS.some((re) => re.test(url.pathname));
  if (!isStatic) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req);
    if (cached) {
      // SWR: refresh in background
      fetch(req).then((res) => { if (res && res.ok) cache.put(req, res.clone()); }).catch(() => {});
      return cached;
    }
    try {
      const res = await fetch(req);
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    } catch (e) {
      return cached || Response.error();
    }
  })());
});
