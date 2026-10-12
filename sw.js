// Picture Portal: minimal service worker so the site can be added to the home screen as an app.
// It deliberately caches nothing, so guests and the organiser always get the latest pages and photos.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  if (e.request.mode === "navigate" && new URL(e.request.url).origin === self.location.origin) {
    e.respondWith(fetch(e.request));
  }
});
