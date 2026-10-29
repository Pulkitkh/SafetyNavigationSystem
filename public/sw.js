// SafeNav service worker: keeps the app shell (including the SOS and Help
// screens) available offline. API calls are never cached here.
const VERSION = "safenav-v4";
const SHELL = ["/", "/help", "/journey", "/contacts", "/fake-call", "/timer", "/safety", "/manifest.webmanifest", "/icons/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(SHELL).catch(() => undefined))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/") || url.pathname.startsWith("/t/")) return;

  // Pages: network first so updates arrive, cache as fallback when offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match("/help"))),
    );
    return;
  }

  // Build assets are content-hashed, so cache first is safe.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(req, copy));
            return res;
          }),
      ),
    );
  }
});

// Alerts for trusted contacts. An SOS stays on screen until dismissed and
// vibrates hard, so it isn't missed like an ordinary notification.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "SafeNav alert", body: event.data ? event.data.text() : "" };
  }
  const sos = data.kind === "sos";
  // "Are you OK?" and lost-touch warnings need an answer too, so they stay until tapped.
  const urgent = sos || data.kind === "checkin" || data.kind === "warning";
  event.waitUntil(
    self.registration.showNotification(data.title || "SafeNav alert", {
      body: data.body || "",
      tag: data.tag || data.kind || "safenav",
      renotify: true,
      requireInteraction: urgent,
      vibrate: sos ? [600, 200, 600, 200, 600, 200, 1200] : urgent ? [500, 200, 500, 200, 500] : [200, 100, 200],
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-72.png",
      data: { url: data.url || "/" },
      actions: data.url ? [{ action: "open", title: sos ? "See live location" : data.kind === "checkin" ? "Open SafeNav" : "Open" }] : [],
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      const target = new URL(url, self.location.origin).href;
      for (const w of wins) {
        if (w.url === target && "focus" in w) return w.focus();
      }
      return self.clients.openWindow(target);
    }),
  );
});
