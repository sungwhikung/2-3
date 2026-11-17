// 항상 최신 내용을 먼저 받고, 인터넷이 안 될 때만 저장해 둔 것을 보여 준다
const PREFIX = "class23-";
const CACHE = PREFIX + "v1";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", event => {
  // 같은 주소(github.io)를 쓰는 다른 사이트의 캐시는 건드리지 않는다
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith(PREFIX) && key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  const cacheable = url.origin === self.location.origin || url.hostname === "cdn.jsdelivr.net";
  if (request.method !== "GET" || !cacheable) return;

  event.respondWith(
    fetch(request)
      .then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => (await caches.match(request, { ignoreSearch: url.origin === self.location.origin })) || Response.error())
  );
});
