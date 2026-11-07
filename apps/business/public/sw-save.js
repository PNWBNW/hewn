// THROWAWAY TEST (2026-11-07): a service worker that hands a file made on this phone to the
// browser's own download, at a real address, without any server. The page puts the file in the
// browser's cache; this answers the address from that cache once, then forgets it.
const CACHE = "hewn-save-test";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (!url.pathname.startsWith("/verify/sw-test/file/")) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(url.pathname);
      if (!hit) return new Response("Not here (the helper had nothing for this address).", { status: 404 });
      await cache.delete(url.pathname);
      return hit;
    })(),
  );
});
