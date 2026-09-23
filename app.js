import { store, save, today, logReview, newCountToday, bumpNew, streak, exportData, importData, resetAll } from "./storage.js";
import { newCard, knownCard, excludedCard, schedule, preview, humanize, isMature, DAY, LEECH_LAPSES } from "./srs.js";
import { playWord, closeVideo } from "./video.js";
import { lookup, playAudio } from "./dict.js";
import { hasKey, checkSentence, makeMnemonic, makeStory, testConnection } from "./ai.js";
import * as cloud from "./cloud.js";

const LEVELS = ["B1", "B2"];
const LEVEL_DESC = { B1: "Orta", B2: "Orta üstü" };
const MODES = {
  classic: { label: "Klasik kart", icon: "🃏" },
  quiz: { label: "Çoktan seçmeli", icon: "🎯" },
  write: { label: "Yazma", icon: "✍️" },
  listen: { label: "Dinleme", icon: "🎧" },
};
const POS_EMOJI = { "n.": "📘", "v.": "🏃", "adj.": "🎨", "adv.": "⚡" };
const LEARN_AHEAD = 20 * 60 * 1000;
const STATUS_TR = { new: "Yeni", learning: "Öğreniliyor", review: "Biliniyor", mature: "Kalıcı", known: "Bildiklerim", leech: "Zorlandıklarım" };
// Ayara göre: kelimeyi tamamen ele ya da uzun aralıkla kontrol et
const knowCard = () => (S().settings.knownMode === "check" ? knownCard() : excludedCard());
const isExcluded = (w) => cardOf(w)?.state === "excluded";

let WORDS = [];
const $ = (s, el = document) => el.querySelector(s);
const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const S = () => store();

// ---------- Veri ----------
async function getJSON(url) {
  try { const r = await fetch(url); return r.ok ? r.json() : {}; } catch { return {}; }
}

async function loadData() {
  const words = await fetch("data/words.json").then((r) => r.json());
  const [content, extra] = await Promise.all([getJSON("data/content.json"), getJSON("data/extra.json")]);
  WORDS = words.map((w) => {
    const c = content[w.id] || [];
    const x = extra[w.id] || [];
    return {
      ...w,
      tr: c[0] || "",
      ex: c[1] || "",
      exTr: c[2] || "",
      emoji: c[3] || POS_EMOJI[w.pos.split(/[ ,/]/)[0]] || "🔤",
      col: x[0] || "",
      fam: x[1] || "",
      syn: x[2] || "",
      ant: x[3] || "",
      ex2: x[4] || "",
      ex2Tr: x[5] || "",
      ipa: x[6] || "",
      order: hash(w.id),
    };
  });
}

function hash(n) {
  let x = (n + 1) * 2654435761;
  x ^= x >>> 16;
  return (x * 2246822519) >>> 0;
}

const cardKey = (w, dir = "f") => (dir === "r" ? `${w.id}r` : String(w.id));
const cardOf = (w, dir = "f") => S().cards[cardKey(w, dir)];

function statusOf(w) {
  const c = cardOf(w);
  if (!c || c.state === "new") return "new";
  if (c.known) return "known";
  if (c.state !== "review") return "learning";
  return isMature(c) ? "mature" : "review";
}
const isLearned = (w) => ["review", "mature", "known"].includes(statusOf(w));
const isLeech = (w) => Boolean(cardOf(w)?.leech || cardOf(w, "r")?.leech);

// ---------- Yardımcılar ----------
function toast(msg, ms = 2000) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove("show"), ms);
}

function applyTheme() {
  const t = S().settings.theme;
  if (t === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}

let voices = [];
function loadVoices() { voices = speechSynthesis?.getVoices?.() || []; }
if ("speechSynthesis" in window) { loadVoices(); speechSynthesis.onvoiceschanged = loadVoices; }

function tts(text, rate = 0.95) {
  if (!("speechSynthesis" in window) || !text) return;
  const lang = S().settings.accent === "uk" ? "en-GB" : "en-US";
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  u.rate = rate;
  const v = voices.find((v) => v.lang === lang && /natural|neural|google|online/i.test(v.name)) || voices.find((v) => v.lang === lang);
  if (v) u.voice = v;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

// Kelimeyi seslendir: varsa gerçek insan kaydı, yoksa tarayıcı sesi
async function sayWord(w, rate) {
  if (rate) return tts(w.word, rate);
  const d = await lookupQuick(w);
  const url = d && (S().settings.accent === "uk" ? d.audioUK : d.audioUS);
  if (!playAudio(url)) tts(w.word);
}
// Ses gecikmesin diye sözlüğe en fazla 700 ms beklenir
function lookupQuick(w) {
  return Promise.race([lookup(w), new Promise((r) => setTimeout(() => r(null), 700))]);
}

// Örnek cümlede kelimeyi (çekimli halleri dahil) vurgular
function wordPattern(w) {
  const bases = w.word.split(/,\s*/).map((b) => b.trim()).filter(Boolean);
  const parts = bases.map((b) => {
    const e = b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    const stem = b.length > 3 && /e$/.test(b) ? e.slice(0, -1) : e;
    return `${stem}[a-z]*`;
  });
  return new RegExp(`\\b(${parts.join("|")})\\b`, "gi");
}
const highlight = (w, s) => esc(s).replace(wordPattern(w), "<mark>$1</mark>");
const cloze = (w, s) => esc(s).replace(wordPattern(w), "_____");

function normalize(s) {
  return s.toLowerCase().replace(/[’']/g, "'").replace(/[^a-z' -]/g, "").replace(/\s+/g, " ").trim();
}
function answers(w) {
  const list = [w.word, ...w.word.split(/,\s*/)];
  if (w.word.includes("-")) list.push(w.word.replace(/-/g, " "));
  return list.map(normalize);
}

function levelStats(lv) {
  const ws = WORDS.filter((w) => w.level === lv);
  const s = { total: ws.length, new: 0, learning: 0, review: 0, mature: 0, known: 0 };
  for (const w of ws) s[statusOf(w)]++;
  return s;
}

function newOrder(list) {
  const pr = S().priority;
  const alpha = S().settings.newOrder === "alpha";
  return list.sort((a, b) => (pr[b.id] ? 1 : 0) - (pr[a.id] ? 1 : 0) || (alpha ? a.id - b.id : a.order - b.order));
}

// ---------- Tekrar kuyruğu ----------
// Kuyruk öğesi: { w, dir: "f" (İngilizce → Türkçe) | "r" (Türkçe → İngilizce) }
function collect(levels, now = Date.now()) {
  const due = [], ahead = [], unseen = [];
  for (const w of WORDS) {
    if (!levels.includes(w.level)) continue;
    for (const dir of ["f", "r"]) {
      const c = cardOf(w, dir);
      if (!c) { if (dir === "f") unseen.push(w); continue; }
      if (c.state === "excluded") break; // "bir daha sorma" denen kelime hiç gelmez
      if (dir === "r" && !S().settings.reverse) continue;
      if (c.due <= now) due.push({ w, dir, c });
      else if (c.state !== "review" && c.due <= now + LEARN_AHEAD) ahead.push({ w, dir, c });
    }
  }
  due.sort((a, b) => a.c.due - b.c.due);
  ahead.sort((a, b) => a.c.due - b.c.due);
  return { due, ahead, unseen };
}

function queueInfo(levels) {
  const { due, unseen } = collect(levels);
  let learn = 0, rev = 0;
  for (const it of due) (it.c.state === "review" ? rev++ : learn++);
  const newLeft = Math.min(unseen.length, Math.max(0, S().settings.dailyNew - newCountToday()));
  return { learn, rev, newLeft };
}

function pickNext(session) {
  const { due, ahead, unseen } = collect(session.levels);
  const canNew = unseen.length && newCountToday() < S().settings.dailyNew;
  const avoid = (list) => list.find((it) => it.w.id !== session.lastId) || list[0];
  const fresh = () => ({ w: newOrder(unseen)[0], dir: "f" });

  if (canNew && (!due.length || session.shown % 3 === 2)) return fresh();
  if (due.length) return avoid(due);
  if (canNew) return fresh();
  if (ahead.length) return avoid(ahead);
  return null;
}

// ---------- Yönlendirme ----------
const views = { home: renderHome, study: renderStudy, words: renderWords, story: renderStory, stats: renderStats, settings: renderSettings, login: renderLogin };

function route() {
  if (!$("#modal").hidden) closeModal();
  closeVideo();
  document.removeEventListener("keydown", studyKeys);
  let [name = "home", arg] = location.hash.replace(/^#\/?/, "").split("/");
  // Hesap sistemi açıksa giriş yapmadan (ya da "hesapsız devam" demeden) uygulamaya geçilmez
  if (cloud.enabled && !cloud.currentUser() && !cloud.isGuest()) name = "login";
  else if (name === "login") name = "home";
  document.body.classList.toggle("auth", name === "login");
  const fn = views[name] || renderHome;
  const tab = views[name] ? name : "home";
  document.querySelectorAll(".tabbar a").forEach((a) => a.classList.toggle("active", a.dataset.tab === tab));
  document.body.classList.toggle("studying", name === "study");
  $("#streakPill").textContent = `🔥 ${streak()}`;
  const view = $("#view");
  view.style.animation = "none";
  void view.offsetWidth;
  view.style.animation = "";
  fn(view, arg);
  window.scrollTo(0, 0);
}

// ---------- Ana sayfa ----------
function renderHome(v) {
  const st = S().settings;
  const q = queueInfo(st.levels);
  const totalDue = q.learn + q.rev + q.newLeft;
  const learned = WORDS.filter(isLearned).length;
  const pool = WORDS.filter((w) => w.tr);
  const dayNum = Math.floor(Date.now() / 86400000);
  const wotd = pool[(dayNum * 7919) % pool.length] || WORDS[0];
  const hour = new Date().getHours();
  const greet = hour < 6 ? "İyi geceler" : hour < 12 ? "Günaydın" : hour < 18 ? "İyi günler" : "İyi akşamlar";
  const started = WORDS.some((w) => cardOf(w));
  const leeches = WORDS.filter(isLeech).length;

  v.innerHTML = `
    <section class="hero">
      <div class="hero-main">
        <h1 class="h-display">${greet}! 👋</h1>
        <p class="sub">${totalDue ? "Bugünkü kartların seni bekliyor." : "Bugünlük hepsi tamam — harika iş!"}</p>
        <div class="hero-stats">
          <div><b>${q.newLeft}</b><span>yeni</span></div>
          <div><b>${q.learn}</b><span>öğreniliyor</span></div>
          <div><b>${q.rev}</b><span>tekrar</span></div>
          <div><b>${learned}</b><span>bildiğin</span></div>
        </div>
        <div class="chips" style="margin-bottom:16px">
          ${Object.entries(MODES).map(([k, m]) => `<button class="chip" data-mode="${k}" aria-pressed="${st.mode === k}">${m.icon} ${m.label}</button>`).join("")}
        </div>
        <a class="btn btn-primary btn-lg" href="#/study">Çalışmaya başla →</a>
        <p class="sub" style="font-size:13px;margin-top:12px">Seçili seviyeler: ${st.levels.join(", ")}</p>
      </div>
      <div class="panel wotd" id="wotd">
        <div>
          <div class="section-title" style="margin:0 0 12px">Günün kelimesi</div>
          <div class="wotd-emoji">${wotd.emoji}</div>
          <div class="wotd-word">${esc(wotd.word)}</div>
          <div class="pos">${esc(wotd.pos)} ${wotd.note ? `· ${esc(wotd.note)}` : ""}</div>
          <div class="wotd-tr">${esc(wotd.tr)}</div>
        </div>
        <div style="margin-top:14px"><span class="lvl lvl-${wotd.level}">${wotd.level}</span></div>
      </div>
    </section>

    ${!started ? `<a class="panel tip-card" href="#/study">
      <span class="tip-icon">⚡</span>
      <span><b>Hadi başlayalım</b><small>Her kelimede Kolay / Orta / Zor de; kolay dediklerin listeden düşer, zorlar sık sık geri gelir.</small></span>
      <span class="tip-go">→</span></a>` : ""}

    <h2 class="section-title">Seviyeler</h2>
    <div class="levels">
      ${LEVELS.map((lv) => {
        const s = levelStats(lv);
        const pct = Math.round(((s.review + s.mature + s.known) / s.total) * 100);
        const lq = queueInfo([lv]);
        return `<div class="level-card ${lv}">
          <button class="lc-main" data-level="${lv}">
            <div class="lc-top">
              <div><div class="lc-name">${lv}</div><div class="lc-desc">${LEVEL_DESC[lv]}</div><span class="lc-film">🎬 video sahneli</span></div>
              <div class="ring" style="--p:${pct}"><span>${pct}%</span></div>
            </div>
            <div class="lc-meta"><span>${s.total} kelime · ${s.new} yeni</span><span>${lq.learn + lq.rev} tekrar</span></div>
          </button>
        </div>`;
      }).join("")}
    </div>

    <h2 class="section-title">Pratik</h2>
    <div class="practice">
      <a class="panel practice-card" href="#/story"><span class="pc-icon">📖</span><b>Hikâye oku</b><small>Öğrendiğin kelimelerle sana özel kısa hikâye</small></a>
      <a class="panel practice-card" href="#/words/leech"><span class="pc-icon">🩹</span><b>Zorlandıklarım</b><small>${leeches ? `${leeches} kelime ekstra ilgi istiyor` : "Şimdilik yok — süper!"}</small></a>
    </div>`;

  v.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => {
    S().settings.mode = b.dataset.mode; S().settings._ts = Date.now(); save();
    v.querySelectorAll("[data-mode]").forEach((x) => x.setAttribute("aria-pressed", x === b));
  }));
  v.querySelectorAll("[data-level]").forEach((b) => b.addEventListener("click", () => { location.hash = `#/study/${b.dataset.level}`; }));
  $("#wotd").addEventListener("click", () => openWord(wotd));
}

// ---------- Çalışma ----------
let session = null;

function renderStudy(v, lvArg) {
  const levels = LEVELS.includes(lvArg) ? [lvArg] : S().settings.levels;
  session = { levels, shown: 0, done: 0, lastId: null, v };
  nextCard();
}

function nextCard() {
  const { v, levels } = session;
  closeVideo();
  const item = pickNext(session);
  const q = queueInfo(levels);
  const remaining = q.learn + q.rev + q.newLeft;
  const pct = session.done + remaining ? (session.done / (session.done + remaining)) * 100 : 100;

  if (!item) {
    v.innerHTML = `
      <div class="panel done">
        <div class="big">🎉</div>
        <h1 class="h-display">Tebrikler!</h1>
        <p class="sub">${levels.join(", ")} için bugünlük tüm kartları bitirdin${session.done ? ` (${session.done} kart)` : ""}.</p>
        <div class="chips" style="justify-content:center;margin-top:20px">
          <button class="btn" id="moreNew">+10 yeni kelime</button>
          <a class="btn" href="#/story">📖 Hikâye oku</a>
          <a class="btn btn-primary" href="#/home">Ana sayfa</a>
        </div>
      </div>`;
    $("#moreNew").addEventListener("click", () => { S().settings.dailyNew += 10; save(); toast("Günlük yeni kelime sınırı +10"); nextCard(); });
    return;
  }

  const { w, dir } = item;
  const mode = S().settings.mode;
  const card = cardOf(w, dir) || newCard();
  const isNew = !cardOf(w, dir) || card.state === "new";
  Object.assign(session, { current: w, dir, revealed: false, suggested: "medium" });

  // Üretim kartında (Türkçe → İngilizce) dinleme yerine yazma kullanılır
  const kind = mode === "classic" ? "classic" : mode === "quiz" ? "quiz" : dir === "r" ? "write" : mode;

  v.innerHTML = `
    <div class="study-top">
      <a class="icon-btn" href="#/home" aria-label="Çık">✕</a>
      <div class="progress"><i style="width:${pct}%"></i></div>
      <div class="counts" title="yeni · öğreniliyor · tekrar">
        <span class="c-new">${q.newLeft}</span><span class="c-learn">${q.learn}</span><span class="c-rev">${q.rev}</span>
      </div>
    </div>
    <div class="card-scene">
      <div class="flashcard card-${w.level}" id="flashcard">
        <div class="face front">${frontHtml(w, dir, kind, isNew)}</div>
        <div class="face back">${backHtml(w)}${richHtml(w)}</div>
      </div>
    </div>
    <div class="answer-area" id="answerArea">${answerHtml(w, dir, kind, card)}</div>
    <div class="video-box card-${w.level}" id="videoBox" hidden></div>`;

  bindCardCommon(w, v);
  if (kind === "quiz") bindQuiz(w);
  if (kind === "write" || kind === "listen") bindTyping(w);
  if (kind === "classic") {
    $("#flashcard").addEventListener("click", (e) => { if (!session.revealed && !e.target.closest("button")) reveal(); });
    $("#showBtn").addEventListener("click", () => reveal());
    $("#knowBtn")?.addEventListener("click", markKnown);
  }
  document.addEventListener("keydown", studyKeys);
  if (dir === "f" && (kind === "listen" || (S().settings.autoSpeak && kind !== "write"))) setTimeout(() => sayWord(w), 250);
}

function frontHtml(w, dir, kind, isNew) {
  const badges = `${isNew ? `<span class="lvl" style="background:var(--easy)">YENİ</span>` : ""}${dir === "r" ? `<span class="lvl" style="background:var(--accent)">TR → EN</span>` : ""}${isLeech(w) ? `<span class="lvl" style="background:var(--warn)">🩹</span>` : ""}`;
  const corner = `<div class="corner"><span class="lvl lvl-${w.level}">${w.level}</span>${badges}</div>`;
  const spk = `<div class="corner-r"><button class="icon-btn" data-speak aria-label="Dinle">🔊</button></div>`;
  if (dir === "r" || kind === "write") {
    return `${corner}
      <div class="emoji-bubble">${w.emoji}</div>
      <div class="meaning" style="margin-top:20px">${esc(w.tr || "—")}</div>
      <div class="pos">${esc(w.pos)}${w.note ? ` · ${esc(w.note)}` : ""}</div>
      ${w.ex ? `<div class="cloze">${cloze(w, w.ex)}</div>` : ""}
      <div class="tap-hint">${kind === "classic" ? "İngilizcesini aklından söyle, sonra çevir" : kind === "quiz" ? "İngilizcesini seç" : "İngilizcesini yaz"}</div>`;
  }
  if (kind === "listen") {
    return `${corner}
      <button class="emoji-bubble" data-speak style="border:0;cursor:pointer;font-size:64px" aria-label="Tekrar dinle">🎧</button>
      <div class="tap-hint">Duyduğun kelimeyi yaz · tekrar dinlemek için dokun</div>
      <div class="speak-row" style="margin-top:12px"><button class="chip" data-slow>🐢 Yavaş</button></div>`;
  }
  return `${corner}${spk}
    <div class="emoji-bubble">${w.emoji}</div>
    <div class="big-word">${esc(w.word)}</div>
    <div class="pos">${esc(w.pos)}</div>
    ${w.note ? `<div class="note">(${esc(w.note)})</div>` : ""}
    ${kind === "classic" ? `<div class="tap-hint">Çevirmek için dokun ya da <span class="kbd">Boşluk</span></div>` : ""}`;
}

function backHtml(w) {
  return `
    <div class="corner"><span class="lvl lvl-${w.level}">${w.level}</span>${isLeech(w) ? `<span class="lvl" style="background:var(--warn)">🩹 zorlandığın kelime</span>` : ""}</div>
    <div class="corner-r"><button class="icon-btn" data-speak aria-label="Dinle">🔊</button></div>
    <div class="back-head">
      <span class="mini-emoji">${w.emoji}</span>
      <div>
        <div class="bw">${esc(w.word)}</div>
        <div class="pos" style="text-align:left">${esc(w.pos)}${w.note ? ` · ${esc(w.note)}` : ""} <span class="ipa" data-ipa>${esc(w.ipa)}</span></div>
      </div>
    </div>
    <div class="meaning">${esc(w.tr || "Anlam henüz eklenmedi")}</div>
    <div class="en-def" data-def></div>
    ${exampleHtml(w, w.ex, w.exTr, "ex")}`;
}

function exampleHtml(w, en, tr, key) {
  if (!en) return "";
  return `<div class="example">
    <p class="en">${highlight(w, en)} <button class="chip mini" data-say="${key}" aria-label="Cümleyi dinle">🔊</button></p>
    ${tr ? `<p class="tr">${esc(tr)}</p>` : ""}
  </div>`;
}

const chipList = (s) => s.split(/;\s*/).filter(Boolean).map((x) => `<span class="tag">${esc(x)}</span>`).join("");

function richHtml(w) {
  const note = S().notes[w.id] || {};
  const syn = w.syn && w.syn !== "-" ? w.syn : "";
  const ant = w.ant && w.ant !== "-" ? w.ant : "";
  return `
    ${exampleHtml(w, w.ex2, w.ex2Tr, "ex2")}
    <div class="rich">
      ${w.col ? `<div class="rich-row"><h4>🔗 Kalıplar</h4><div class="tags">${chipList(w.col)}</div></div>` : ""}
      ${w.fam && w.fam !== "-" ? `<div class="rich-row"><h4>🌳 Kelime ailesi</h4><div class="tags">${chipList(w.fam)}</div></div>` : ""}
      ${syn || ant ? `<div class="rich-row"><h4>⇄ Eş / zıt anlam</h4><div class="tags">${syn ? syn.split(/,\s*/).map((x) => `<span class="tag syn">≈ ${esc(x)}</span>`).join("") : ""}${ant ? ant.split(/,\s*/).map((x) => `<span class="tag ant">≠ ${esc(x)}</span>`).join("") : ""}</div></div>` : ""}
    </div>
    <details class="tool" ${note.sentence ? "open" : ""}>
      <summary>✍️ Kendi cümleni yaz</summary>
      <p class="hint">Kelimeyi kendi cümlende kullanmak onu kalıcı hale getirmenin en etkili yollarından biri.</p>
      <textarea data-sentence rows="2" placeholder="“${esc(w.word)}” kelimesiyle bir cümle yaz…">${esc(note.sentence || "")}</textarea>
      <div class="tool-actions">
        <button class="btn" data-check>${hasKey() ? "Claude kontrol etsin" : "Kaydet"}</button>
      </div>
      <div class="feedback" data-feedback>${note.feedback ? feedbackHtml(note.feedback) : ""}</div>
    </details>
    <details class="tool" ${note.mnemonic || isLeech(w) ? "open" : ""}>
      <summary>💡 Hafıza ipucu</summary>
      <textarea data-mnemonic rows="2" placeholder="Kelimeyi hatırlamana yardım edecek bir çağrışım yaz…">${esc(note.mnemonic || "")}</textarea>
      <div class="tool-actions">
        <button class="btn" data-save-mn>Kaydet</button>
        <button class="btn" data-ai-mn>✨ Claude'dan ipucu iste</button>
      </div>
    </details>`;
}

function feedbackHtml(f) {
  const label = { correct: "✓ Doğru ve doğal", minor: "≈ Küçük düzeltmeler", wrong: "✗ Kelime yanlış kullanılmış" }[f.verdict] || "";
  return `<div class="fb fb-${f.verdict}"><b>${label}</b>
    ${f.verdict !== "correct" ? `<p><span class="muted">Düzeltilmiş:</span> ${esc(f.corrected)}</p>` : ""}
    <p>${esc(f.explanation_tr)}</p>
    <p><span class="muted">Başka bir örnek:</span> <i>${esc(f.alternative)}</i></p></div>`;
}

// Kartın arka yüzündeki etkileşimleri bağlar (çalışma ekranı ve kelime penceresi)
function bindRich(w, root) {
  root.querySelectorAll("[data-say]").forEach((b) => b.addEventListener("click", (e) => {
    e.stopPropagation();
    tts(b.dataset.say === "ex2" ? w.ex2 : w.ex);
  }));
  const notes = () => Object.assign((S().notes[w.id] ||= {}), { updated: Date.now() });
  root.querySelector("[data-check]")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const text = root.querySelector("[data-sentence]").value.trim();
    if (!text) return toast("Önce bir cümle yaz");
    notes().sentence = text;
    save();
    if (!hasKey()) return toast("Cümlen kaydedildi. Geri bildirim için Ayarlar'dan API anahtarı ekleyebilirsin.", 3000);
    btn.disabled = true;
    btn.textContent = "Kontrol ediliyor…";
    try {
      const f = await checkSentence(w, text);
      notes().feedback = f;
      save();
      root.querySelector("[data-feedback]").innerHTML = feedbackHtml(f);
    } catch (err) { toast(err.message, 3500); }
    btn.disabled = false;
    btn.textContent = "Claude kontrol etsin";
  });
  root.querySelector("[data-save-mn]")?.addEventListener("click", () => {
    notes().mnemonic = root.querySelector("[data-mnemonic]").value.trim();
    save();
    toast("İpucu kaydedildi ✓");
  });
  root.querySelector("[data-ai-mn]")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = "Düşünüyor…";
    try {
      const m = await makeMnemonic(w);
      const ta = root.querySelector("[data-mnemonic]");
      ta.value = `${m.mnemonic_tr}\n${m.tip_tr}`;
      notes().mnemonic = ta.value;
      save();
    } catch (err) { toast(err.message, 3500); }
    btn.disabled = false;
    btn.textContent = "✨ Claude'dan ipucu iste";
  });
  // Metin kutularına yazarken kısayollar çalışmasın
  root.querySelectorAll("textarea, details").forEach((el) => el.addEventListener("click", (e) => e.stopPropagation()));
  fillDict(w, root);
}

async function fillDict(w, root) {
  const d = await lookup(w);
  if (!d) return;
  const ipa = root.querySelectorAll("[data-ipa]");
  if (!w.ipa) ipa.forEach((el) => { el.textContent = d.ipa || ""; });
  root.querySelectorAll("[data-def]").forEach((el) => { if (d.def) el.innerHTML = `<span class="muted">EN:</span> ${esc(d.def)}`; });
}

const GRADES = [
  { level: "hard", label: "😰 Zor", cls: "g1" },
  { level: "medium", label: "🙂 Orta", cls: "g2" },
  { level: "easy", label: "😀 Kolay", cls: "g4" },
];

function gradesHtml(card) {
  return `<div class="grades three">${GRADES.map((g, i) => `
    <button class="grade ${g.cls}" data-grade="${g.level}">${g.label}<small>${preview(card, g.level)} <span class="kbd">${i + 1}</span></small></button>`).join("")}</div>`;
}

function answerHtml(w, dir, kind, card) {
  const grades = `<div id="grades" hidden>${gradesHtml(card)}</div>
    <div class="never-row"><button class="linkish" data-never>🚫 Bu kelimeyi bir daha gösterme <span class="kbd">0</span></button></div>`;
  const knowBtn = dir === "f" && !cardOf(w) ? `<button class="btn" id="knowBtn" title="Bu kelimeyi zaten biliyorum">✓ Biliyorum</button>` : "";
  if (kind === "classic") {
    return `<div class="show-row">${knowBtn}<button class="btn btn-primary btn-lg" id="showBtn">Cevabı göster</button></div>${grades}`;
  }
  if (kind === "quiz") {
    const opts = distractors(w, 3).concat(w).sort(() => Math.random() - 0.5);
    const label = (o) => esc(dir === "r" ? o.word : o.tr || o.word);
    return `<div class="options" id="options">${opts.map((o, i) => `<button class="option" data-id="${o.id}"><span class="kbd">${i + 1}</span> ${label(o)}</button>`).join("")}</div>${grades}`;
  }
  return `<form class="type-row" id="typeForm" autocomplete="off">
      <input id="typeInput" placeholder="${kind === "listen" ? "Duyduğun kelime…" : "İngilizce kelime…"}" autocapitalize="off" spellcheck="false" enterkeyhint="done">
      <button class="btn btn-primary" type="submit">Kontrol</button>
    </form>
    <div class="verdict" id="verdict"></div>
    <button class="btn btn-ghost" id="giveUp" style="margin-top:6px">Bilmiyorum 🤷</button>${grades}`;
}

function distractors(w, n) {
  const pool = WORDS.filter((x) => x.id !== w.id && x.tr && x.tr !== w.tr && x.word !== w.word);
  const samePos = pool.filter((x) => x.pos.split(",")[0] === w.pos.split(",")[0] && x.level === w.level);
  const src = samePos.length >= n * 3 ? samePos : pool;
  const out = new Set();
  while (out.size < Math.min(n, src.length)) out.add(src[Math.floor(Math.random() * src.length)]);
  return [...out];
}

function bindCardCommon(w, root) {
  root.querySelectorAll("[data-speak]").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); sayWord(w); }));
  root.querySelectorAll("[data-slow]").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); sayWord(w, 0.6); }));
  root.querySelectorAll("[data-grade]").forEach((b) => b.addEventListener("click", () => grade(b.dataset.grade)));
  root.querySelectorAll("[data-never]").forEach((b) => b.addEventListener("click", neverShow));
  bindRich(w, root.querySelector(".face.back"));
}

function reveal(suggested) {
  if (session.revealed) return;
  session.revealed = true;
  const w = session.current;
  const fc = $("#flashcard");
  fc.classList.add("flipped");
  // Çevirme animasyonundan sonra arka yüz normal akışa geçer (uzun içerik kaydırılabilsin)
  setTimeout(() => { if (fc.isConnected) fc.classList.add("static", "revealed"); }, 620);
  $(".show-row")?.remove();
  const g = $("#grades");
  g.hidden = false;
  $("#answerArea").classList.add("sticky");
  if (suggested) {
    session.suggested = suggested;
    g.querySelector(`[data-grade="${suggested}"]`)?.classList.add("suggested");
  }
  if (session.dir === "r" || (S().settings.autoSpeak && S().settings.mode !== "classic")) sayWord(w);
  showVideoBox(w);
}

function showVideoBox(w, box = $("#videoBox")) {
  if (!box) return;
  box.hidden = false;
  box.innerHTML = `
    <button class="video-btn" data-video>
      <span class="vb-icon">🎬</span>
      <span>“${esc(w.word)}” gerçek sahnelerde<small>Film, dizi ve konuşmalardan kelimenin geçtiği anı izle</small></span>
    </button>
    <div class="video-host"></div>
    <div class="video-status"></div>`;
  box.querySelector("[data-video]").addEventListener("click", (e) => {
    e.currentTarget.hidden = true;
    playWord(box.querySelector(".video-host"), box.querySelector(".video-status"), w.word.split(",")[0], S().settings.accent);
  });
}

function bindQuiz(w) {
  $("#options").addEventListener("click", (e) => {
    const b = e.target.closest(".option");
    if (!b || session.revealed) return;
    const ok = Number(b.dataset.id) === w.id;
    $("#options").querySelectorAll(".option").forEach((o) => {
      o.disabled = true;
      if (Number(o.dataset.id) === w.id) o.classList.add("right");
    });
    if (!ok) b.classList.add("wrong");
    reveal(ok ? "medium" : "hard");
  });
}

function bindTyping(w) {
  const input = $("#typeInput");
  setTimeout(() => input.focus(), 50);
  const check = (given) => {
    if (session.revealed) return;
    const val = normalize(given);
    const ok = val && answers(w).includes(val);
    const close = !ok && val && answers(w).some((a) => levenshtein(a, val) <= (a.length > 5 ? 2 : 1));
    input.classList.add(ok ? "right" : "wrong");
    input.disabled = true;
    const verdict = $("#verdict");
    verdict.className = `verdict ${ok ? "ok" : "no"}`;
    verdict.textContent = ok ? "✓ Doğru!" : close ? `Neredeyse! Doğrusu: ${w.word}` : `✗ Doğrusu: ${w.word}`;
    $("#giveUp").remove();
    reveal(ok ? "medium" : close ? "medium" : "hard");
  };
  $("#typeForm").addEventListener("submit", (e) => { e.preventDefault(); check(input.value); });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); check(input.value); } });
  $("#giveUp").addEventListener("click", () => check(""));
}

function levenshtein(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

function markKnown() {
  const w = session.current;
  S().cards[cardKey(w)] = knowCard();
  delete S().cards[cardKey(w, "r")];
  delete S().priority[w.id];
  logReview();
  save();
  toast(S().settings.knownMode === "check" ? `“${w.word}” bilinenlere eklendi` : `“${w.word}” artık karşına çıkmayacak`);
  session.lastId = w.id;
  nextCard();
}

function neverShow() {
  const w = session?.current;
  if (!w) return;
  S().cards[cardKey(w)] = excludedCard();
  delete S().cards[cardKey(w, "r")];
  delete S().priority[w.id];
  logReview();
  save();
  toast(`“${w.word}” bir daha gösterilmeyecek`);
  session.lastId = w.id;
  nextCard();
}

function grade(g) {
  const { current: w, dir } = session;
  if (!w || !session.revealed) return;
  const key = cardKey(w, dir);
  const prev = S().cards[key];
  if (!prev && dir === "f") bumpNew();
  const next = schedule(prev || newCard(), g);
  if (g === "hard" && prev?.state === "review") {
    delete next.known;
    if (next.lapses >= LEECH_LAPSES && !next.leech) {
      next.leech = true;
      toast("🩹 Bu kelimeyi sık unutuyorsun. Kartın altından bir hafıza ipucu eklemeyi dene.", 4000);
    }
  }
  S().cards[key] = next;
  delete S().priority[w.id];
  // Tanıma kartı ilk kez "biliniyor" olunca ertesi gün üretim kartı (Türkçe → İngilizce) açılır
  if (dir === "f" && next.state === "review" && !S().cards[cardKey(w, "r")]) {
    S().cards[cardKey(w, "r")] = { ...newCard(), due: Date.now() + DAY, last: Date.now() };
  }
  logReview();
  save();
  session.shown++;
  session.done++;
  session.lastId = w.id;
  $("#streakPill").textContent = `🔥 ${streak()}`;
  nextCard();
}

function studyKeys(e) {
  if (!session?.current || e.target.matches("input, textarea, summary") || e.metaKey || e.ctrlKey || e.altKey) return;
  const kind = $("#options") ? "quiz" : $("#typeInput") ? "type" : "classic";
  if ((e.key === " " || e.key === "Enter") && !session.revealed && kind === "classic") { e.preventDefault(); reveal(); return; }
  if ((e.key === " " || e.key === "Enter") && session.revealed) { e.preventDefault(); grade(session.suggested); return; }
  if (/^[1-4]$/.test(e.key) && !session.revealed && kind === "quiz") {
    $("#options").querySelectorAll(".option")[Number(e.key) - 1]?.click();
    return;
  }
  if (/^[1-3]$/.test(e.key) && session.revealed) { grade(GRADES[Number(e.key) - 1].level); return; }
  if (e.key === "0") { e.preventDefault(); neverShow(); return; }
  if (e.key.toLowerCase() === "r") sayWord(session.current);
}

// ---------- Kelime listesi ----------
let listState = { q: "", level: "all", status: "all", limit: 120 };

function renderWords(v, arg) {
  if (arg === "leech") listState = { ...listState, status: "leech", limit: 120 };
  const statuses = ["all", "new", "learning", "review", "mature", "known", "leech"];
  v.innerHTML = `
    <h1 class="h-display">Kelimeler</h1>
    <p class="sub">${WORDS.length} kelime · Oxford 3000 (CEFR B1–B2)</p>
    <div class="toolbar">
      <input class="search" id="q" type="search" placeholder="İngilizce ya da Türkçe ara…" value="${esc(listState.q)}">
    </div>
    <div class="toolbar">
      <div class="chips" id="lvChips">${["all", ...LEVELS].map((l) => `<button class="chip" data-v="${l}" aria-pressed="${listState.level === l}">${l === "all" ? "Tümü" : l}</button>`).join("")}</div>
      <div class="chips" id="stChips">${statuses.map((s) => `<button class="chip" data-v="${s}" aria-pressed="${listState.status === s}">${s === "all" ? "Hepsi" : STATUS_TR[s]}</button>`).join("")}</div>
    </div>
    <div class="word-list" id="list"></div>
    <button class="btn list-more" id="more" hidden>Daha fazla göster</button>`;

  const draw = () => {
    const q = normalize(listState.q);
    const qtr = listState.q.toLocaleLowerCase("tr").trim();
    const items = WORDS.filter((w) =>
      (listState.level === "all" || w.level === listState.level) &&
      (listState.status === "all" || (listState.status === "leech" ? isLeech(w) : statusOf(w) === listState.status)) &&
      (!qtr || w.word.toLowerCase().includes(q || qtr) || w.tr.toLocaleLowerCase("tr").includes(qtr)));
    $("#list").innerHTML = items.slice(0, listState.limit).map((w) => {
      const s = statusOf(w);
      return `<div class="word-row" data-id="${w.id}">
        <div class="wr-emoji">${w.emoji}</div>
        <div style="min-width:0"><div class="wr-word">${esc(w.word)} <span class="pos">${esc(w.pos)}</span></div><div class="wr-tr">${esc(w.tr)}</div></div>
        <div class="wr-right">${isLeech(w) ? "🩹" : ""}${S().notes[w.id]?.sentence ? "✍️" : ""}<span class="dot ${s}" title="${STATUS_TR[s]}"></span><span class="lvl lvl-${w.level}">${w.level}</span></div>
      </div>`;
    }).join("") || `<p class="sub">${listState.status === "leech" ? "Zorlandığın kelime yok. 4 kez unutulan kelimeler burada toplanır." : "Sonuç bulunamadı."}</p>`;
    $("#more").hidden = items.length <= listState.limit;
  };
  draw();

  $("#q").addEventListener("input", (e) => { listState.q = e.target.value; listState.limit = 120; draw(); });
  const chipGroup = (id, key) => $(id).addEventListener("click", (e) => {
    const b = e.target.closest(".chip"); if (!b) return;
    listState[key] = b.dataset.v; listState.limit = 120;
    $(id).querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", c === b));
    draw();
  });
  chipGroup("#lvChips", "level");
  chipGroup("#stChips", "status");
  $("#more").addEventListener("click", () => { listState.limit += 200; draw(); });
  $("#list").addEventListener("click", (e) => {
    const r = e.target.closest(".word-row");
    if (r) openWord(WORDS[Number(r.dataset.id)]);
  });
}

function openWord(w) {
  const c = cardOf(w);
  const s = statusOf(w);
  const body = $("#modalBody");
  body.innerHTML = `
    <div class="flashcard static revealed card-${w.level}"><div class="face back" style="box-shadow:none;border:0;padding:40px 0 0">${backHtml(w)}${richHtml(w)}</div></div>
    <div class="video-box card-${w.level}" id="modalVideo" hidden></div>
    <div class="modal-foot">
      <span>Durum: <b>${STATUS_TR[s]}</b>${c && c.state === "review" ? ` · sonraki tekrar ${humanize(Math.max(0, c.due - Date.now()))} sonra` : ""}</span>
      ${isExcluded(w) ? `<button class="btn" id="mStudy">↩️ Tekrar çalış</button>` : `<button class="btn" id="mKnow">✓ Biliyorum, sorma</button>`}
    </div>`;
  body.querySelectorAll("[data-speak]").forEach((b) => b.addEventListener("click", () => sayWord(w)));
  bindRich(w, body);
  showVideoBox(w, $("#modalVideo"));
  $("#mKnow")?.addEventListener("click", () => {
    S().cards[cardKey(w)] = knowCard();
    delete S().cards[cardKey(w, "r")];
    delete S().priority[w.id];
    save();
    toast(S().settings.knownMode === "check" ? "Bilinenlere eklendi" : "Bu kelime artık karşına çıkmayacak");
    closeModal();
    route();
  });
  $("#mStudy")?.addEventListener("click", () => {
    for (const dir of ["f", "r"]) { delete S().cards[cardKey(w, dir)]; S().removed[cardKey(w, dir)] = Date.now(); }
    save();
    toast("Kelime çalışma listesine geri alındı");
    closeModal();
    route();
  });
  $("#modal").hidden = false;
  if (S().settings.autoSpeak) sayWord(w);
}

function closeModal() {
  closeVideo();
  $("#modal").hidden = true;
  $("#modalBody").innerHTML = "";
}

// ---------- Hikâyeler ----------
function storyWords() {
  // Son 14 günde çalışılan, henüz kalıcı olmayan kelimeler öncelikli
  const since = Date.now() - 14 * DAY;
  const recent = WORDS.filter((w) => {
    const c = cardOf(w);
    return c && !c.known && (c.last || 0) >= since;
  });
  const pool = recent.length >= 4 ? recent : WORDS.filter((w) => cardOf(w) && !cardOf(w).known);
  return pool.sort(() => Math.random() - 0.5).slice(0, 8);
}

function renderStory(v, arg) {
  const stories = S().stories;
  const idx = arg === undefined ? -1 : Number(arg);
  if (idx >= 0 && stories[idx]) return drawStory(v, stories[idx], idx);
  const candidates = storyWords();
  v.innerHTML = `
    <h1 class="h-display">Hikâyeler</h1>
    <p class="sub">Claude, son çalıştığın kelimelerle sana özel kısa bir hikâye yazar. Kelimeyi bağlam içinde tekrar görmek hatırlamayı güçlendirir.</p>
    <div class="panel" style="margin-top:16px">
      ${candidates.length < 3
        ? `<p>Hikâye için en az 3 kelime çalışmış olmalısın. Biraz kart çalıştıktan sonra tekrar gel.</p><a class="btn btn-primary" href="#/study">Çalışmaya başla</a>`
        : `<div class="section-title" style="margin-top:0">Kullanılacak kelimeler</div>
           <div class="tags">${candidates.map((w) => `<span class="tag">${esc(w.word)}</span>`).join("")}</div>
           <div class="tool-actions" style="margin-top:14px">
             <button class="btn btn-primary" id="genStory">✨ Hikâye oluştur</button>
             <button class="btn" id="shuffleWords">🔀 Başka kelimeler</button>
           </div>
           ${hasKey() ? "" : `<p class="hint">Bu özellik için <a href="#/settings">Ayarlar</a>'dan Claude API anahtarını girmen gerekiyor.</p>`}`}
    </div>
    ${stories.length ? `<h2 class="section-title">Önceki hikâyeler</h2>
      <div class="word-list">${stories.map((s, i) => `<a class="word-row" href="#/story/${i}"><div class="wr-emoji">📖</div><div style="min-width:0"><div class="wr-word">${esc(s.title)}</div><div class="wr-tr">${esc(s.words.join(", "))}</div></div><div class="wr-right"><span class="pos">${esc(s.date)}</span></div></a>`).reverse().join("")}</div>` : ""}`;

  $("#shuffleWords")?.addEventListener("click", () => renderStory(v));
  $("#genStory")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = "Claude yazıyor… (15-30 sn)";
    const level = candidates.some((w) => w.level === "B2") ? "B2" : "B1";
    try {
      const res = await makeStory(candidates, level);
      stories.push({ ...res, words: candidates.map((w) => w.word), ids: candidates.map((w) => w.id), date: today(), answers: {} });
      if (stories.length > 30) stories.shift();
      save();
      location.hash = `#/story/${stories.length - 1}`;
    } catch (err) {
      toast(err.message, 4000);
      btn.disabled = false;
      btn.textContent = "✨ Hikâye oluştur";
    }
  });
}

function drawStory(v, s, idx) {
  const byWord = new Map();
  for (const id of s.ids || []) byWord.set(WORDS[id].word.toLowerCase(), WORDS[id]);
  const findWord = (txt) => {
    const t = txt.toLowerCase();
    for (const [k, w] of byWord) if (t.startsWith(k.slice(0, Math.max(3, k.length - 2)))) return w;
    return null;
  };
  const body = esc(s.story).replace(/\*\*(.+?)\*\*/g, (_, t) => {
    const w = findWord(t);
    return `<mark class="story-word" ${w ? `data-id="${w.id}"` : ""}>${t}</mark>`;
  }).split(/\n+/).map((p) => `<p>${p}</p>`).join("");

  v.innerHTML = `
    <div class="study-top"><a class="icon-btn" href="#/story" aria-label="Geri">←</a><div class="pos" style="font-style:normal">${esc(s.date)}</div></div>
    <article class="panel story">
      <h1 class="h-display">${esc(s.title)}</h1>
      <div class="story-actions"><button class="chip" id="readStory">🔊 Sesli oku</button><button class="chip" id="showTr">🇹🇷 Özet</button></div>
      <p class="hint" id="storyTr" hidden>${esc(s.summary_tr)}</p>
      <div class="story-body">${body}</div>
      <p class="hint">Vurgulu kelimelere dokunarak kartını açabilirsin.</p>
    </article>
    <h2 class="section-title">Anladın mı?</h2>
    <div class="questions">${s.questions.map((q, qi) => `
      <div class="panel question" data-q="${qi}">
        <b>${qi + 1}. ${esc(q.question)}</b>
        <div class="options">${q.options.map((o, oi) => `<button class="option" data-o="${oi}">${esc(o)}</button>`).join("")}</div>
      </div>`).join("")}</div>`;

  v.querySelectorAll(".story-word[data-id]").forEach((m) => m.addEventListener("click", () => openWord(WORDS[Number(m.dataset.id)])));
  $("#readStory").addEventListener("click", () => tts(s.story.replace(/\*\*/g, ""), 0.9));
  $("#showTr").addEventListener("click", () => { $("#storyTr").hidden = !$("#storyTr").hidden; });
  const mark = (box, qi, oi) => {
    const q = s.questions[qi];
    box.querySelectorAll(".option").forEach((o) => {
      o.disabled = true;
      if (Number(o.dataset.o) === q.answer) o.classList.add("right");
      else if (Number(o.dataset.o) === oi) o.classList.add("wrong");
    });
  };
  v.querySelectorAll(".question").forEach((box) => {
    const qi = Number(box.dataset.q);
    if (s.answers?.[qi] !== undefined) mark(box, qi, s.answers[qi]);
    box.addEventListener("click", (e) => {
      const b = e.target.closest(".option");
      if (!b || b.disabled) return;
      const oi = Number(b.dataset.o);
      (s.answers ||= {})[qi] = oi;
      S().stories[idx] = s;
      save();
      mark(box, qi, oi);
    });
  });
}

// ---------- İstatistik ----------
function renderStats(v) {
  const all = { new: 0, learning: 0, review: 0, mature: 0, known: 0 };
  for (const w of WORDS) all[statusOf(w)]++;
  const act = S().activity;
  const totalReviews = Object.values(act).reduce((a, b) => a + b, 0);
  const days = 7 * 18;
  const start = new Date(); start.setDate(start.getDate() - days + 1);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); // pazartesiden başlat
  const cells = [];
  for (let d = new Date(start); d <= new Date(); d.setDate(d.getDate() + 1)) {
    const n = act[today(d)] || 0;
    const l = n === 0 ? 0 : n < 10 ? 1 : n < 30 ? 2 : n < 60 ? 3 : 4;
    cells.push(`<i data-l="${l}" title="${today(d)}: ${n} tekrar"></i>`);
  }
  const cards = Object.values(S().cards);
  const fc = Array.from({ length: 7 }, (_, i) => {
    const end = new Date(); end.setHours(23, 59, 59, 999); end.setDate(end.getDate() + i);
    const from = i === 0 ? 0 : end.getTime() - 86400000;
    return cards.filter((c) => c.due > from && c.due <= end.getTime()).length;
  });
  const fmax = Math.max(1, ...fc);
  const dayNames = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];
  const colors = { learning: "var(--warn)", review: "var(--good)", mature: "var(--easy)", known: "var(--accent)" };
  const reverseLearned = WORDS.filter((w) => cardOf(w, "r")?.state === "review").length;

  v.innerHTML = `
    <h1 class="h-display">İstatistik</h1>
    <div class="stat-grid" style="margin-top:16px">
      <div class="panel stat"><b>🔥 ${streak()}</b><span>günlük seri</span></div>
      <div class="panel stat"><b>${all.review + all.mature + all.known}</b><span>bildiğin kelime</span></div>
      <div class="panel stat"><b>${reverseLearned}</b><span>aktif kullanabildiğin (TR → EN)</span></div>
      <div class="panel stat"><b>${totalReviews}</b><span>toplam tekrar</span></div>
    </div>
    <h2 class="section-title">Seviyelere göre ilerleme</h2>
    <div class="panel bars">
      ${LEVELS.map((lv) => {
        const s = levelStats(lv);
        return `<div class="bar-row"><span class="lvl lvl-${lv}">${lv}</span>
          <div class="stack">${["known", "mature", "review", "learning"].map((k) => `<i style="width:${(s[k] / s.total) * 100}%;background:${colors[k]}"></i>`).join("")}</div>
          <span class="pos" style="font-style:normal">${s.review + s.mature + s.known}/${s.total}</span></div>`;
      }).join("")}
      <div class="legend">${["learning", "review", "mature", "known"].map((k) => `<span style="--c:${colors[k]}">${STATUS_TR[k]}</span>`).join("")}</div>
    </div>
    <h2 class="section-title">Önümüzdeki 7 gün</h2>
    <div class="panel"><div class="forecast">${fc.map((n, i) => {
      const d = new Date(); d.setDate(d.getDate() + i);
      return `<div><span>${n}</span><i style="height:${(n / fmax) * 80}%"></i><span>${i === 0 ? "Bugün" : dayNames[d.getDay()]}</span></div>`;
    }).join("")}</div></div>
    <h2 class="section-title">Çalışma takvimi</h2>
    <div class="panel"><div class="heat">${cells.join("")}</div></div>`;
}

// ---------- Ayarlar ----------
function renderSettings(v) {
  const st = S().settings;
  const opt = (val, cur, label) => `<option value="${val}" ${cur === val ? "selected" : ""}>${label}</option>`;
  v.innerHTML = `
    <h1 class="h-display">Ayarlar</h1>
    <div class="settings" style="margin-top:16px">
      <div class="panel setting"><div><label>Çalışılacak seviyeler</label><p>"Çalış" butonu bu seviyelerden kart getirir.</p></div>
        <div class="chips" id="setLevels">${LEVELS.map((l) => `<button class="chip" data-v="${l}" aria-pressed="${st.levels.includes(l)}">${l}</button>`).join("")}</div></div>
      <div class="panel setting"><div><label for="dailyNew">Günlük yeni kelime</label><p>Önerilen: 10–15. Günlük tekrar yükü zamanla bunun yaklaşık 10 katına çıkar.</p></div>
        <input type="number" id="dailyNew" min="1" max="200" value="${st.dailyNew}" style="width:90px"></div>
      <div class="panel setting"><div><label for="newOrder">Yeni kelime sırası</label><p>Karışık sıra, benzer kelimelerin birbirine karışmasını önler.</p></div>
        <select id="newOrder">${opt("shuffle", st.newOrder, "Karışık")}${opt("alpha", st.newOrder, "Alfabetik")}</select></div>
      <div class="panel setting"><div><label for="knownMode">Bildiğim kelimeler</label><p>"Biliyorum" dediğin kelimelere ne olsun?</p></div>
        <select id="knownMode">${opt("never", st.knownMode, "Bir daha karşıma çıkmasın")}${opt("check", st.knownMode, "1-2 ayda bir kontrol et")}</select></div>
      <div class="panel setting"><div><label>Türkçe → İngilizce kartları</label><p>Öğrendiğin her kelime ertesi gün ters yönde de sorulur (kelimeyi aktif kullanabilmek için).</p></div>
        <label class="switch"><input type="checkbox" id="reverse" ${st.reverse ? "checked" : ""}><span></span></label></div>
      <div class="panel setting"><div><label for="mode">Çalışma modu</label></div>
        <select id="mode">${Object.entries(MODES).map(([k, m]) => opt(k, st.mode, `${m.icon} ${m.label}`)).join("")}</select></div>
      <div class="panel setting"><div><label for="accent">Aksan</label><p>Telaffuz ve video sahneleri için.</p></div>
        <select id="accent">${opt("us", st.accent, "Amerikan (US)")}${opt("uk", st.accent, "İngiliz (UK)")}</select></div>
      <div class="panel setting"><div><label>Otomatik seslendir</label><p>Kart açılınca kelimeyi oku.</p></div>
        <label class="switch"><input type="checkbox" id="autoSpeak" ${st.autoSpeak ? "checked" : ""}><span></span></label></div>
      <div class="panel setting"><div><label for="theme">Tema</label></div>
        <select id="theme">${opt("auto", st.theme, "Sistem")}${opt("light", st.theme, "Açık")}${opt("dark", st.theme, "Koyu")}</select></div>

      <div class="panel setting col">
        <div><label for="apiKey">✨ Claude API anahtarı</label>
          <p>Cümle kontrolü, hafıza ipucu ve hikâye özellikleri için gerekli. Anahtarı <a href="https://platform.claude.com/settings/keys" target="_blank" rel="noopener">platform.claude.com</a> adresinden alabilirsin. Anahtar yalnızca bu tarayıcıda saklanır, yedek dosyasına yazılmaz ve sadece Anthropic'e gönderilir. Kullanım başına küçük bir ücret çıkar.</p></div>
        <div class="key-row">
          <input type="password" id="apiKey" placeholder="sk-ant-…" value="${esc(st.apiKey)}" autocomplete="off" spellcheck="false">
          <select id="aiModel">${opt("claude-opus-5", st.aiModel, "Claude Opus 5 (en iyi)")}${opt("claude-haiku-4-5", st.aiModel, "Claude Haiku 4.5 (daha ucuz)")}</select>
          <button class="btn" id="testKey">Test et</button>
        </div>
      </div>

      ${accountHtml()}
      <div class="panel setting"><div><label>Yedekleme</label><p>İlerlemeni dosya olarak indir ya da geri yükle.</p></div>
        <div class="chips"><button class="btn" id="exp">⬇️ Dışa aktar</button><button class="btn" id="imp">⬆️ İçe aktar</button><input type="file" id="impFile" accept="application/json" hidden></div></div>
      <div class="panel setting"><div><label>Sıfırla</label><p>Tüm ilerlemeyi siler.</p></div>
        <button class="btn" id="reset" style="color:var(--bad)">Sıfırla</button></div>
    </div>`;

  const set = (k, val) => { st[k] = val; if (k !== "apiKey") st._ts = Date.now(); save(); };
  $("#setLevels").addEventListener("click", (e) => {
    const b = e.target.closest(".chip"); if (!b) return;
    const lv = b.dataset.v;
    const next = st.levels.includes(lv) ? st.levels.filter((x) => x !== lv) : [...st.levels, lv];
    if (!next.length) return toast("En az bir seviye seçmelisin");
    set("levels", LEVELS.filter((l) => next.includes(l)));
    b.setAttribute("aria-pressed", next.includes(lv));
  });
  $("#dailyNew").addEventListener("change", (e) => set("dailyNew", Math.max(1, Math.min(200, Number(e.target.value) || 15))));
  $("#newOrder").addEventListener("change", (e) => set("newOrder", e.target.value));
  $("#reverse").addEventListener("change", (e) => set("reverse", e.target.checked));
  $("#knownMode").addEventListener("change", (e) => {
    set("knownMode", e.target.value);
    // Daha önce "biliyorum" denen kelimeleri yeni ayara uydur
    let n = 0;
    for (const [k, c] of Object.entries(S().cards)) {
      if (!c.known) continue;
      if (e.target.value === "never" && c.state !== "excluded") { S().cards[k] = { ...excludedCard(), last: c.last || Date.now() }; n++; }
      else if (e.target.value === "check" && c.state === "excluded") { S().cards[k] = { ...knownCard(), last: c.last || Date.now() }; n++; }
    }
    save();
    if (n) toast(`${n} kelime yeni ayara göre güncellendi`);
  });
  $("#mode").addEventListener("change", (e) => set("mode", e.target.value));
  $("#accent").addEventListener("change", (e) => set("accent", e.target.value));
  $("#autoSpeak").addEventListener("change", (e) => set("autoSpeak", e.target.checked));
  $("#theme").addEventListener("change", (e) => { set("theme", e.target.value); applyTheme(); });
  $("#apiKey").addEventListener("change", (e) => { set("apiKey", e.target.value.trim()); toast(e.target.value.trim() ? "Anahtar kaydedildi" : "Anahtar silindi"); });
  $("#aiModel").addEventListener("change", (e) => set("aiModel", e.target.value));
  $("#testKey").addEventListener("click", async (e) => {
    set("apiKey", $("#apiKey").value.trim());
    const btn = e.currentTarget;
    btn.disabled = true; btn.textContent = "…";
    try { await testConnection(); toast("✓ Claude bağlantısı çalışıyor"); }
    catch (err) { toast(err.message, 4000); }
    btn.disabled = false; btn.textContent = "Test et";
  });
  $("#exp").addEventListener("click", () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([exportData()], { type: "application/json" }));
    a.download = `oxford3000-yedek-${today()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
  $("#imp").addEventListener("click", () => $("#impFile").click());
  $("#impFile").addEventListener("change", async (e) => {
    try { importData(await e.target.files[0].text()); applyTheme(); toast("Yedek yüklendi ✓"); route(); }
    catch (err) { toast(err.message); }
  });
  bindAccount();
  $("#reset").addEventListener("click", () => {
    if (confirm("Tüm ilerleme silinecek. Emin misin?")) { resetAll(); applyTheme(); toast("Sıfırlandı"); route(); }
  });
}

// ---------- Hesap ----------
function renderLogin(v) {
  let mode = "login"; // login | register | reset
  const draw = () => {
    const title = { login: "Giriş yap", register: "Hesap oluştur", reset: "Şifreni sıfırla" }[mode];
    v.innerHTML = `
      <div class="auth-wrap">
        <div class="auth-brand">
          <span class="brand-mark big">3K</span>
          <h1 class="h-display">Oxford 3000</h1>
          <p class="sub">B1–B2 kelimelerini öğren. İlerlemen hesabında saklanır; telefonda ve bilgisayarda kaldığın yerden devam edersin.</p>
        </div>
        <form class="panel auth-card" id="authForm" novalidate>
          ${mode !== "reset"
            ? `<div class="seg"><button type="button" data-m="login" aria-pressed="${mode === "login"}">Giriş yap</button><button type="button" data-m="register" aria-pressed="${mode === "register"}">Kayıt ol</button></div>`
            : `<h2>${title}</h2><p class="hint">E-posta adresine bir sıfırlama bağlantısı göndereceğiz.</p>`}
          <label class="field"><span>E-posta</span><input type="email" id="aEmail" autocomplete="email" inputmode="email" required></label>
          ${mode !== "reset" ? `<label class="field"><span>Şifre</span><input type="password" id="aPass" autocomplete="${mode === "register" ? "new-password" : "current-password"}" minlength="6" required></label>` : ""}
          ${mode === "register" ? `<label class="field"><span>Şifre (tekrar)</span><input type="password" id="aPass2" autocomplete="new-password" minlength="6" required></label><p class="hint">En az 6 karakter.</p>` : ""}
          <div class="auth-error" id="aErr" role="alert"></div>
          <button class="btn btn-primary btn-lg" type="submit" id="aSubmit">${mode === "reset" ? "Bağlantı gönder" : title}</button>
          <div class="auth-links">
            ${mode === "login" ? `<button type="button" class="linkish" data-m="reset">Şifremi unuttum</button>` : ""}
            ${mode === "reset" ? `<button type="button" class="linkish" data-m="login">← Girişe dön</button>` : ""}
          </div>
        </form>
        <button class="linkish guest" id="guest">Hesapsız devam et (ilerleme sadece bu cihazda kalır)</button>
      </div>`;
    v.querySelectorAll("[data-m]").forEach((b) => b.addEventListener("click", () => { mode = b.dataset.m; draw(); }));
    $("#guest").addEventListener("click", () => { cloud.setGuest(true); location.hash = "#/home"; route(); });
    $("#authForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = $("#aEmail").value;
      const pass = $("#aPass")?.value || "";
      const err = $("#aErr");
      const btn = $("#aSubmit");
      err.textContent = "";
      if (mode === "register" && pass !== $("#aPass2").value) { err.textContent = "Şifreler aynı değil."; return; }
      const label = btn.textContent;
      btn.disabled = true;
      btn.textContent = "Lütfen bekle…";
      try {
        if (mode === "login") await cloud.login(email, pass);
        else if (mode === "register") await cloud.register(email, pass);
        else {
          await cloud.resetPassword(email);
          toast("Sıfırlama e-postası gönderildi. Gelen kutunu (ve spam klasörünü) kontrol et.", 5000);
          mode = "login";
          draw();
        }
        // Oturum açılınca onCloudChange ana sayfaya yönlendirir
      } catch (ex) {
        err.textContent = ex.message;
        btn.disabled = false;
        btn.textContent = label;
      }
    });
  };
  draw();
}

const STATUS_LABEL = {
  synced: "☁️ Senkronize",
  syncing: "⏳ Kaydediliyor…",
  offline: "📴 Çevrimdışı — bağlanınca kaydedilecek",
  error: "⚠️ Senkronizasyon hatası",
};

function accountHtml() {
  if (!cloud.enabled) return "";
  const u = cloud.currentUser();
  if (!u) {
    return `<div class="panel setting"><div><label>Hesap</label><p>Şu an hesapsız kullanıyorsun; ilerlemen sadece bu cihazda. Giriş yaparsan bu cihazdaki ilerleme hesabına aktarılır ve tüm cihazlarında senkronize olur.</p></div>
      <button class="btn btn-primary" id="goLogin">Giriş yap / Kayıt ol</button></div>`;
  }
  return `<div class="panel setting"><div><label>Hesap</label><p><b>${esc(u.email)}</b><br><span id="syncState">${STATUS_LABEL[cloud.syncStatus()]}</span></p></div>
    <button class="btn" id="logout">Çıkış yap</button></div>`;
}

function bindAccount() {
  $("#goLogin")?.addEventListener("click", () => { cloud.setGuest(false); location.hash = "#/login"; route(); });
  $("#logout")?.addEventListener("click", async () => {
    if (!confirm("Çıkış yapılsın mı? İlerlemen hesabında kayıtlı kalır.")) return;
    await cloud.logout();
    applyTheme();
    location.hash = "#/login";
    route();
  });
}

function onCloudChange(reason) {
  applyTheme();
  if (reason === "auth") {
    if (cloud.currentUser()) {
      location.hash = "#/home";
      toast("Hoş geldin! İlerlemen hesabınla senkronize ediliyor.");
    }
    route();
    return;
  }
  // Başka cihazdan gelen güncelleme: çalışma ekranını bölmeden sadece sayaçları yenile
  $("#streakPill").textContent = `🔥 ${streak()}`;
  const h = location.hash;
  if (!h.startsWith("#/study") && !h.startsWith("#/settings") && $("#modal").hidden) route();
}

cloud.onStatus((st) => {
  const el = $("#syncDot");
  if (el) {
    el.textContent = { synced: "☁️", syncing: "⏳", offline: "📴", error: "⚠️" }[st];
    el.title = STATUS_LABEL[st];
    el.hidden = !cloud.currentUser();
  }
  const s2 = document.getElementById("syncState");
  if (s2) s2.textContent = STATUS_LABEL[st];
});
document.addEventListener("visibilitychange", () => { if (document.hidden) cloud.flush(); });

// ---------- Başlat ----------
document.addEventListener("click", (e) => { if (e.target.closest("[data-close]")) closeModal(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#modal").hidden) closeModal(); });
window.addEventListener("hashchange", route);

applyTheme();
loadData().then(() => cloud.init(onCloudChange)).then(route).catch((err) => {
  $("#view").innerHTML = `<div class="panel"><h2>Veriler yüklenemedi</h2><p class="sub">${esc(err.message)}</p>
    <p class="sub">Uygulamayı <b>baslat.bat</b> ile (yerel sunucu üzerinden) açtığından emin ol.</p></div>`;
});

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  // Yeni sürüm yayınlandığında uygulama kendini bir kez yeniler
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });
  navigator.serviceWorker.register("sw.js").then((reg) => {
    reg.update();
    setInterval(() => reg.update(), 60 * 60 * 1000);
  }).catch(() => {});
}
