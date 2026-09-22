// YouGlish gömülü oynatıcısı: kelimenin geçtiği gerçek videoları tam o anından oynatır.
// Belgeler: https://youglish.com/api/doc/js-api
const SCRIPT = "https://youglish.com/public/emb/widget.js";
const COMPONENTS = 4 + 8 + 16 + 64; // başlık + altyazı + hız + kontrol butonları

let ready = null;
let widget = null;
let counter = 0;

function loadApi() {
  if (ready) return ready;
  ready = new Promise((resolve, reject) => {
    window.onYouglishAPIReady = () => resolve(window.YG);
    const s = document.createElement("script");
    s.src = SCRIPT;
    s.async = true;
    s.onerror = () => { ready = null; reject(new Error("YouGlish yüklenemedi")); };
    document.head.appendChild(s);
    setTimeout(() => reject(new Error("YouGlish zaman aşımı")), 15000);
  });
  return ready;
}

export function closeVideo() {
  try { widget?.close(); } catch { /* zaten kapalı */ }
  widget = null;
}

// host: videonun yerleşeceği eleman, status: durum mesajı için eleman
export async function playWord(host, status, word, accent = "us") {
  closeVideo();
  host.innerHTML = "";
  const el = document.createElement("div");
  el.id = `yg-widget-${++counter}`;
  host.appendChild(el);
  status.textContent = "Sahneler aranıyor…";
  try {
    const YG = await loadApi();
    if (!document.body.contains(el)) return; // kullanıcı bu arada başka karta geçti
    const dark = document.documentElement.dataset.theme === "dark";
    widget = new YG.Widget(el.id, {
      width: Math.min(host.clientWidth || 640, 720),
      components: COMPONENTS,
      autoStart: 1,
      backgroundColor: dark ? "#16161f" : "#ffffff",
      titleColor: dark ? "#e8e8f0" : "#1d1d2b",
      captionColor: dark ? "#e8e8f0" : "#1d1d2b",
      linkColor: "#7c5cff",
      captionSize: 20,
      events: {
        onFetchDone: (e) => {
          status.textContent = e.totalResult
            ? `“${word}” için ${e.totalResult.toLocaleString("tr-TR")} sahne bulundu`
            : `“${word}” için sahne bulunamadı`;
        },
        onVideoChange: (e) => {
          if (e.trackNumber) status.textContent = `Sahne ${e.trackNumber}`;
        },
        onError: () => { status.textContent = "Video oynatılamadı."; },
      },
    });
    widget.fetch(word, "english", accent);
  } catch (err) {
    status.textContent = navigator.onLine ? err.message : "Videolar için internet bağlantısı gerekli.";
  }
}

export const videoControls = {
  next: () => widget?.next(),
  previous: () => widget?.previous(),
  replay: () => widget?.replay(),
};
