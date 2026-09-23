// Çevrimdışı çalışma: uygulama dosyalarını önbelleğe alır (önce ağ, olmazsa önbellek).
const CACHE = "ox3000-v13";
const SHELL = ["./", "index.html", "styles.css", "app.js", "storage.js", "srs.js", "video.js", "ai.js", "dict.js", "cloud.js", "firebase-config.js", "manifest.json", "icon.svg", "icon-192.png", "icon-512.png", "data/words.json", "data/content.json", "data/extra.json"];

self.addEventListener("install", (e) => {
  // Kurulumda dosyalar sunucudan taze çekilir (tarayıcı önbelleği atlanır)
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(SHELL.map((u) => fetch(u, { cache: "reload" }).then((r) => c.put(u, r))))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  url.search = ""; // ?v=N sürüm etiketi önbellekte tek kopya olarak tutulur
  if (e.request.method !== "GET" || url.origin !== location.origin) return; // YouGlish, fontlar vb. doğrudan ağdan
  e.respondWith(
    // Tarayıcı önbelleği yeni sürümü geciktirmesin diye her istekte sunucuya sorulur
    fetch(new Request(e.request, { cache: "no-cache" }))
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(url.href, copy));
        return res;
      })
      .catch(() => caches.match(url.href))
  );
});
