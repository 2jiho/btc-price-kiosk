// Increment the version when changing the offline shell.
const SCOPE = new URL(self.registration.scope);
const CACHE_PREFIX = "btc-price-kiosk:" + SCOPE.pathname + ":";
const CACHE_NAME = CACHE_PREFIX + "v3";
const INDEX_URL = new URL("index.html", SCOPE).href;
const SHELL_URLS = ["index.html", "manifest.json", "bitcoin-btc-logo.svg", "wake-lock.js", "market-data.js"]
  .map(function (path) { return new URL(path, SCOPE).href; });
self.addEventListener("message", function (event) {
  if (event.data && event.data.type === "GET_APP_VERSION" && event.ports && event.ports[0]) {
    event.ports[0].postMessage({ type: "APP_VERSION", cacheName: CACHE_NAME });
  }
});
self.addEventListener("install", function (event) {
  event.waitUntil((async function () {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(SHELL_URLS.map(function (url) { return new Request(url, { cache: "reload" }); }));
    await self.skipWaiting();
  })());
});
self.addEventListener("activate", function (event) {
  event.waitUntil((async function () {
    const names = await caches.keys();
    await Promise.all(names.map(async function (name) {
      if (name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME) {
        await caches.delete(name);
      } else if (name === "btc-price-kiosk-v1") {
        // Only migrate the unscoped legacy cache if it contains this app's index.
        const legacy = await caches.open(name);
        if (await legacy.match(INDEX_URL)) await caches.delete(name);
      }
    }));
    await self.clients.claim();
  })());
});
async function networkFirst(request, cacheKey, event) {
  const controller = new AbortController();
  const timeout = setTimeout(function () { controller.abort(); }, 5000);
  try {
    const response = await fetch(request, { cache: "no-cache", signal: controller.signal });
    if (!response.ok) throw new Error("Shell HTTP " + response.status);
    // Cache storage must not prevent delivery of a successful online response.
    // Keep the write alive separately from the navigation/asset response.
    const copy = response.clone();
    event.waitUntil(caches.open(CACHE_NAME).then(function (cache) {
      return cache.put(cacheKey, copy);
    }).catch(function (error) { console.warn("Offline cache write failed:", error); }));
    return response;
  } catch (error) {
    const cached = await caches.open(CACHE_NAME).then(function (cache) { return cache.match(cacheKey); });
    if (cached) return cached;
    throw error;
  } finally { clearTimeout(timeout); }
}
self.addEventListener("fetch", function (event) {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== SCOPE.origin || !url.pathname.startsWith(SCOPE.pathname)) return;
  const isAppHTML = url.pathname === SCOPE.pathname || url.pathname === new URL(INDEX_URL).pathname;
  if (isAppHTML) {
    // Root and index share one offline copy, including navigation query strings.
    event.respondWith(networkFirst(request, INDEX_URL, event));
  } else if (SHELL_URLS.includes(url.href)) {
    event.respondWith(networkFirst(request, url.href, event));
  }
  // Live market sockets and remote assets are never stored in this cache.
});
