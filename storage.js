// İlerleme verisini tarayıcıda (localStorage) saklar; hesap açıksa cloud.js buluta senkronize eder.
const KEY = "ox3000.v1";

const defaults = () => ({
  owner: "",          // bu verinin ait olduğu hesap (uid); boşsa hesapsız kullanım
  cards: {},          // "id" (tanıma) veya "id r" (üretim) -> { due, interval, ease, reps, lapses, step, state, last, known?, leech? }
  resetAt: 0,         // "Sıfırla" zamanı: bundan eski kartlar senkronizasyonda geri gelmez
  removed: {},        // geri alınan kartlar: anahtar -> silinme zamanı (senkronizasyonda geri gelmesinler)
  activity: {},       // "YYYY-MM-DD" -> tekrar sayısı
  newToday: { date: "", count: 0 },
  notes: {},          // id -> { sentence, feedback, mnemonic, updated }
  priority: {},       // taramada "bilmiyorum" denen kelimeler önce gelir
  stories: [],        // yapay zekâ ile üretilen hikâyeler
  settings: {
    dailyNew: 15,
    levels: ["B1"],
    accent: "us",      // us | uk
    autoSpeak: true,
    theme: "auto",     // auto | light | dark
    mode: "classic",   // classic | quiz | write | listen
    newOrder: "shuffle", // shuffle | alpha
    reverse: true,     // öğrenilen kelimeler için Türkçe → İngilizce kartları
    knownMode: "never", // never = bildiklerim bir daha sorulmaz | check = 1-2 ayda bir kontrol
    apiKey: "",        // yalnızca bu cihazda kalır, buluta gönderilmez
    aiModel: "claude-opus-5",
    _ts: 0,            // ayarların son değişme zamanı
  },
});

let state = load();
let saveHook = null;

export function normalize(d) {
  const base = defaults();
  const out = { ...base, ...d, settings: { ...base.settings, ...(d?.settings || {}) } };
  out.settings.levels = out.settings.levels.filter((l) => l === "B1" || l === "B2");
  if (!out.settings.levels.length) out.settings.levels = ["B1"];
  return out;
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? normalize(JSON.parse(raw)) : defaults();
  } catch {
    return defaults();
  }
}

function writeLocal() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* depolama kapalı olabilir */ }
}

export function save() {
  writeLocal();
  saveHook?.(state);
}

export const store = () => state;
export const setSaveHook = (fn) => { saveHook = fn; };

// Buluttan gelen birleşik veriyi yerine koyar (API anahtarı cihazda kalır)
export function replaceState(next) {
  const key = state.settings.apiKey;
  state = normalize(next);
  state.settings.apiKey = key;
  writeLocal();
}

export function today(d = new Date()) {
  const z = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

export function logReview() {
  const t = today();
  state.activity[t] = (state.activity[t] || 0) + 1;
}

export function newCountToday() {
  if (state.newToday.date !== today()) state.newToday = { date: today(), count: 0 };
  return state.newToday.count;
}

export function bumpNew() {
  newCountToday();
  state.newToday.count++;
}

export function streak() {
  let n = 0;
  const d = new Date();
  if (!state.activity[today(d)]) d.setDate(d.getDate() - 1); // bugün henüz çalışılmadıysa seri bozulmaz
  while (state.activity[today(d)]) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

// API anahtarı yedeğe yazılmaz
export function exportData() {
  return JSON.stringify({ ...state, settings: { ...state.settings, apiKey: "" } }, null, 1);
}

export function importData(text) {
  const d = JSON.parse(text);
  if (!d || typeof d.cards !== "object") throw new Error("Geçersiz yedek dosyası");
  const { apiKey } = state.settings;
  const owner = state.owner;
  state = normalize(d);
  state.owner = owner;
  if (!state.settings.apiKey) state.settings.apiKey = apiKey;
  save();
}

export function resetAll() {
  const { apiKey } = state.settings;
  const owner = state.owner;
  state = defaults();
  state.owner = owner;
  state.resetAt = Date.now();
  state.settings.apiKey = apiKey;
  save();
}

// Çıkış yapınca bu cihazdaki hesap verisini temizler
export function clearLocal() {
  const { apiKey } = state.settings;
  state = defaults();
  state.settings.apiKey = apiKey;
  writeLocal();
}
