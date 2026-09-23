// Anki'nin SM-2 tabanlı aralıklı tekrar algoritmasının sadeleştirilmiş hali.
// Puanlar: 1 = Tekrar, 2 = Zor, 3 = İyi, 4 = Kolay
const MIN = 60 * 1000;
export const DAY = 24 * 60 * MIN;
const LEARN_STEPS = [2, 10];   // dakika: Tekrar = 2 dk (sabit), Zor = 10 dk
const RELEARN_STEP = 10;       // dakika
const EASY_GRADUATE = 4;       // gün

export const newCard = () => ({ state: "new", due: 0, interval: 0, ease: 2.5, reps: 0, lapses: 0, step: 0 });

// "Biliyorum" denen kelime: uzun aralıklı tekrar kartı olarak başlar (1-2 ay sonra kontrol)
export function knownCard(now = Date.now()) {
  const interval = 45 + Math.floor(Math.random() * 30);
  return { state: "review", due: now + interval * DAY, interval, ease: 2.7, reps: 1, lapses: 0, step: 0, known: true, last: now };
}

// "Bir daha sorma" denen kelime: hiç zamanlanmaz, listeden geri alınabilir
export const NEVER = 8.64e15; // JS'in en büyük tarih değeri
export function excludedCard(now = Date.now()) {
  return { state: "excluded", due: NEVER, interval: 0, ease: 2.5, reps: 1, lapses: 0, step: 0, known: true, last: now };
}

// Hızlı taramadaki üç kova: zor = 2 dk, orta = 10 dk, kolay = 4 gün sonra kontrol
export function triageCard(level, now = Date.now()) {
  const base = { ...newCard(), reps: 1, last: now, triage: level };
  if (level === "easy") return { ...base, state: "review", interval: EASY_GRADUATE, due: now + EASY_GRADUATE * DAY };
  if (level === "medium") return { ...base, state: "learning", step: 1, due: now + LEARN_STEPS[1] * MIN };
  return { ...base, state: "learning", step: 0, due: now + LEARN_STEPS[0] * MIN };
}

export const LEECH_LAPSES = 4;

// Üç seviye: hard = 2 dk (sabit), medium = 10 dk (sabit), easy = 4 gün ve sonra açılarak büyür
const LEVEL_OF = { 1: "hard", 2: "medium", 3: "medium", 4: "easy" };

export function schedule(card, level, now = Date.now()) {
  const l = typeof level === "number" ? LEVEL_OF[level] : level;
  const c = { ...card, reps: (card.reps || 0) + 1, last: now };
  const wasReview = card.state === "review";

  if (l === "hard") {
    if (wasReview) {
      c.lapses = (c.lapses || 0) + 1;
      c.ease = Math.max(1.3, (c.ease || 2.5) - 0.2);
      c.interval = Math.max(1, (c.interval || 1) * 0.3);
    }
    c.state = wasReview || card.state === "relearning" ? "relearning" : "learning";
    c.step = 0;
    c.due = now + LEARN_STEPS[0] * MIN;   // her zaman 2 dakika
    return c;
  }

  if (l === "medium") {
    c.state = wasReview || card.state === "relearning" ? "relearning" : "learning";
    c.step = 1;
    c.due = now + LEARN_STEPS[1] * MIN;   // her zaman 10 dakika
    return c;
  }

  // easy: ilk seferde 4 gün, sonraki her "kolay"da aralık büyür
  const prev = card.interval || 0;
  c.ease = Math.min(3.2, (c.ease || 2.5) + 0.05);
  c.interval = prev >= EASY_GRADUATE ? Math.min(3650, Math.round(prev * c.ease)) : EASY_GRADUATE;
  c.state = "review";
  c.step = 0;
  c.due = now + c.interval * DAY;
  delete c.known;
  return c;
}

// Butonların altında gösterilecek "sonraki tekrar" etiketi
export function preview(card, grade) {
  const now = Date.now();
  return humanize(schedule(card, grade, now).due - now);
}

export function humanize(ms) {
  const m = Math.round(ms / MIN);
  if (m < 60) return `${Math.max(1, m)} dk`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} sa`;
  const d = Math.round(ms / DAY);
  if (d < 31) return `${d} g`;
  const mo = d / 30;
  if (mo < 12) return `${mo.toFixed(mo < 10 ? 1 : 0)} ay`;
  return `${(d / 365).toFixed(1)} yıl`;
}

export const isMature = (c) => c && c.state === "review" && c.interval >= 21;
