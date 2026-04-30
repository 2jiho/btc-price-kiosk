var CACHE_NAME = "btc-price-kiosk-v1";
var urlsToCache = ["./index.html", "./manifest.json", "./bitcoin-btc-logo.svg"];

self.addEventListener("install", function (event) {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(urlsToCache);
    })
  );
});

function isCDNRequest(url) {
  try {
    var u = new URL(url, self.location.origin);
    return (
      /jsdelivr.net$/.test(u.hostname) ||
      /binance/.test(u.hostname) ||
      /frankfurter.dev$/.test(u.hostname)
    );
  } catch (e) {
    return false;
  }
}

self.addEventListener("fetch", function (event) {
  event.respondWith(
    caches.match(event.request).then(function (response) {
      if (response) {
        return response;
      }
      var fetchRequest = event.request.clone();
      return fetch(fetchRequest).then(function (response) {
        if (!response || response.status !== 200) {
          return response;
        }
        // Cache same-origin and CDN responses for offline usage
        var responseToCache = response.clone();
        caches.open(CACHE_NAME).then(function (cache) {
          // Always cache same-origin requests
          if (event.request && (event.request.url.indexOf(self.location.origin) === 0 || isCDNRequest(event.request.url))) {
            cache.put(event.request, responseToCache);
          }
        });
        return response;
      });
    })
  );
});

self.addEventListener("activate", function (event) {
  self.clients.claim();
  event.waitUntil(
    caches.keys().then(function (cacheNames) {
      return Promise.all(
        cacheNames
          .filter(function (name) {
            return name !== CACHE_NAME;
          })
          .map(function (name) {
            return caches.delete(name);
          })
      );
    })
  );
});
