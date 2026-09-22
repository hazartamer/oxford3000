// Ücretsiz sözlük API'sinden (dictionaryapi.dev) fonetik yazım, ses kaydı ve İngilizce tanım.
const API = "https://api.dictionaryapi.dev/api/v2/entries/en/";
const KEY = "ox3000.dict";
const POS_MAP = { "n.": "noun", "v.": "verb", "adj.": "adjective", "adv.": "adverb", "prep.": "preposition", "conj.": "conjunction", "pron.": "pronoun" };

let cache = {};
try { cache = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { cache = {}; }
const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* dolu olabilir */ } };

let down = false; // servis bu oturumda yanıt vermediyse tekrar deneme

export async function lookup(w) {
  const term = w.word.split(",")[0].trim().toLowerCase();
  const ck = `${term}|${w.pos}`;
  if (ck in cache) return cache[ck];
  if (down) return null;
  let data;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(API + encodeURIComponent(term), { signal: ctrl.signal }).finally(() => clearTimeout(timer));
    if (res.status === 404) { cache[ck] = null; persist(); return null; }
    if (!res.ok) return null;
    data = await res.json();
  } catch {
    down = true;
    return null; // çevrimdışı ya da servis yanıt vermiyor: önbelleğe yazma, sonra tekrar dene
  }
  const phon = data.flatMap((e) => e.phonetics || []);
  const pick = (re) => phon.find((p) => p.audio && re.test(p.audio));
  const us = pick(/-us\.mp3$/) , uk = pick(/-uk\.mp3$/), any = phon.find((p) => p.audio);
  const ipa = (us?.text || uk?.text || data.find((e) => e.phonetic)?.phonetic || phon.find((p) => p.text)?.text || "");
  const wanted = POS_MAP[w.pos.split(/[ ,/]/)[0]];
  const meanings = data.flatMap((e) => e.meanings || []);
  const m = meanings.find((x) => x.partOfSpeech === wanted) || meanings[0];
  const out = {
    ipa,
    audioUS: (us || any)?.audio || "",
    audioUK: (uk || any)?.audio || "",
    def: m?.definitions?.[0]?.definition || "",
  };
  cache[ck] = out;
  persist();
  return out;
}

let player = null;
export function playAudio(url) {
  if (!url) return false;
  try { player?.pause(); player = new Audio(url); player.play().catch(() => {}); return true; } catch { return false; }
}
