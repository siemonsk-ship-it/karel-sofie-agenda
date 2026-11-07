// Service worker: offline shell + push notifications
const CACHE = "ks-agenda-v3";
const SHELL = ["./", "index.html", "styles.css", "app.js", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

// Network first for our own files, so updates arrive right away; cache when offline.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return res; })
      .catch(() => caches.match(e.request).then((r) => r || caches.match("index.html")))
  );
});

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: "Karel & Sofie", body: e.data && e.data.text() }; }
  const title = d.title || "Karel & Sofie";
  e.waitUntil(
    self.registration.showNotification(title, {
      body: d.body || "",
      tag: d.tag || "agenda",
      renotify: true,
      icon: "icons/icon-192.png",
      badge: "icons/badge-96.png",
      data: { url: /wil iets/.test(title) ? "./#verzoeken" : "./" },
    })
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const target = new URL(e.notification.data?.url || "./", self.registration.scope).href;
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url.startsWith(self.registration.scope)) {
          if (target.endsWith("#verzoeken")) c.postMessage("open-requests");
          return c.focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
