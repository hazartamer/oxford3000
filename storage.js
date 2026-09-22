// İlerleme verisini tarayıcıda (localStorage) saklar.
const KEY = "ox3000.v1";

const defaults = () => ({
  cards: {},          // "id" (tanıma) veya "id r" (üretim) -> { due, interval, ease, reps, lapses, step, state, known?, leech? }
  activity: {},       // "YYYY-MM-DD" -> tekrar sayısı
  newToday: { date: "", count: 0 },
  notes: {},          // id -> { sentence, feedback, mnemonic }
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
    apiKey: "",
    aiModel: "claude-opus-5",
  },
});

let state = load();

function merge(d) {
  const base = defaults();
  const out = { ...base, ...d, settings: { ...base.settings, ...(d.settings || {}) } };
  out.settings.levels = out.settings.levels.filter((l) => l === "B1" || l === "B2");
  if (!out.settings.levels.length) out.settings.levels = ["B1"];
  return out;
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? merge(JSON.parse(raw)) : defaults();
  } catch {
    return defaults();
  }
}

export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* depolama kapalı olabilir */ }
}

export const store = () => state;

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
  const key = state.settings.apiKey;
  state = merge(d);
  if (!state.settings.apiKey) state.settings.apiKey = key;
  save();
}

export function resetAll() {
  const key = state.settings.apiKey;
  state = defaults();
  state.settings.apiKey = key;
  save();
}
