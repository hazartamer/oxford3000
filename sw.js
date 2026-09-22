// Çevrimdışı çalışma: uygulama dosyalarını önbelleğe alır (önce ağ, olmazsa önbellek).
const CACHE = "ox3000-v3";
const SHELL = ["./", "index.html", "styles.css", "app.js", "storage.js", "srs.js", "video.js", "ai.js", "dict.js", "manifest.json", "icon.svg", "icon-192.png", "icon-512.png", "data/words.json", "data/content.json", "data/extra.json"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return; // YouGlish, fontlar vb. doğrudan ağdan
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
