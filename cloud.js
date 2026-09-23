// Hesap (e-posta + şifre) ve cihazlar arası senkronizasyon: Firebase Authentication + Cloud Firestore.
import { FIREBASE_CONFIG } from "./firebase-config.js?v=13";
import { store, replaceState, setSaveHook, clearLocal, normalize } from "./storage.js?v=13";

const V = "12.19.0";
const CDN = `https://www.gstatic.com/firebasejs/${V}`;
const DEVICE = (() => {
  try {
    let id = localStorage.getItem("ox3000.device");
    if (!id) { id = Math.random().toString(36).slice(2); localStorage.setItem("ox3000.device", id); }
    return id;
  } catch { return Math.random().toString(36).slice(2); }
})();

export const enabled = Boolean(FIREBASE_CONFIG?.apiKey);

let fb = null;          // { auth, db, a: auth modülü, f: firestore modülü }
let user = null;
let unsubscribe = null;
let pushTimer = null;
let onChange = () => {};
let status = "offline"; // offline | syncing | synced | error
const listeners = new Set();

export const currentUser = () => user;
export const syncStatus = () => status;
export const onStatus = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
function setStatus(s) { status = s; listeners.forEach((fn) => fn(s)); }

export function isGuest() {
  try { return localStorage.getItem("ox3000.guest") === "1"; } catch { return false; }
}
export function setGuest(v) {
  try { v ? localStorage.setItem("ox3000.guest", "1") : localStorage.removeItem("ox3000.guest"); } catch { /* yok say */ }
}

async function load() {
  if (fb) return fb;
  const [app, a, f] = await Promise.all([
    import(`${CDN}/firebase-app.js`),
    import(`${CDN}/firebase-auth.js`),
    import(`${CDN}/firebase-firestore.js`),
  ]);
  const fapp = app.initializeApp(FIREBASE_CONFIG);
  const auth = a.getAuth(fapp);
  auth.languageCode = "tr";
  const db = f.getFirestore(fapp);
  fb = { auth, db, a, f };
  return fb;
}

// Uygulama açılırken çağrılır; oturum durumu belli olunca (ya da 5 sn sonra) çözülür
export async function init(changed) {
  onChange = changed;
  if (!enabled) return null;
  try {
    const { auth, a } = await load();
    await new Promise((resolve) => {
      let first = true;
      const t = setTimeout(resolve, 5000);
      a.onAuthStateChanged(auth, async (u) => {
        user = u;
        if (u) await startSync(u);
        else stopSync();
        if (first) { first = false; clearTimeout(t); resolve(); }
        else onChange("auth");
      });
    });
  } catch (err) {
    console.warn("Firebase yüklenemedi:", err);
    setStatus("error");
  }
  return user;
}

const docRef = (u) => fb.f.doc(fb.db, "users", u.uid);

function serialize(s) {
  return JSON.stringify({ ...s, settings: { ...s.settings, apiKey: "" } });
}

async function startSync(u) {
  const { f } = fb;
  setGuest(false);
  // Bu cihazdaki veri başka bir hesaba aitse karıştırma
  if (store().owner && store().owner !== u.uid) clearLocal();
  setStatus("syncing");
  try {
    const snap = await f.getDoc(docRef(u));
    const remote = snap.exists() ? JSON.parse(snap.data().data || "{}") : null;
    const merged = remote ? mergeStates(store(), remote) : store();
    merged.owner = u.uid;
    replaceState(merged);
    await push(true);
  } catch (err) {
    console.warn("Senkronizasyon hatası:", err);
    setStatus("error");
  }
  setSaveHook(() => schedulePush());
  unsubscribe?.();
  unsubscribe = f.onSnapshot(docRef(u), (snap) => {
    if (!snap.exists() || snap.metadata.hasPendingWrites) return;
    const d = snap.data();
    if (d.device === DEVICE) return;
    replaceState({ ...mergeStates(store(), JSON.parse(d.data || "{}")), owner: u.uid });
    setStatus("synced");
    onChange("remote");
  }, () => setStatus("error"));
}

function stopSync() {
  unsubscribe?.();
  unsubscribe = null;
  setSaveHook(null);
  clearTimeout(pushTimer);
  setStatus("offline");
}

function schedulePush() {
  if (!user) return;
  setStatus("syncing");
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => push(), 1500);
}

async function push() {
  if (!user || !fb) return;
  const { f } = fb;
  try {
    await f.setDoc(docRef(user), { data: serialize(store()), device: DEVICE, updatedAt: f.serverTimestamp() });
    setStatus("synced");
  } catch (err) {
    console.warn("Buluta yazılamadı:", err);
    setStatus(navigator.onLine ? "error" : "offline");
  }
}

export function flush() {
  if (pushTimer) { clearTimeout(pushTimer); return push(); }
}

// ---------- Hesap işlemleri ----------
const MESSAGES = {
  "auth/invalid-email": "E-posta adresi geçersiz.",
  "auth/missing-password": "Şifre girmelisin.",
  "auth/weak-password": "Şifre en az 6 karakter olmalı.",
  "auth/email-already-in-use": "Bu e-postayla zaten bir hesap var. Giriş yapmayı dene.",
  "auth/invalid-credential": "E-posta ya da şifre hatalı.",
  "auth/wrong-password": "E-posta ya da şifre hatalı.",
  "auth/user-not-found": "Bu e-postayla kayıtlı hesap yok.",
  "auth/too-many-requests": "Çok fazla deneme yapıldı. Biraz bekleyip tekrar dene.",
  "auth/network-request-failed": "İnternet bağlantısı yok.",
  "auth/user-disabled": "Bu hesap devre dışı bırakılmış.",
};
const friendly = (err) => new Error(MESSAGES[err?.code] || `Bir hata oluştu (${err?.code || err?.message}).`);

export async function register(email, password) {
  const { auth, a } = await load();
  try { await a.createUserWithEmailAndPassword(auth, email.trim(), password); } catch (e) { throw friendly(e); }
}

export async function login(email, password) {
  const { auth, a } = await load();
  try { await a.signInWithEmailAndPassword(auth, email.trim(), password); } catch (e) { throw friendly(e); }
}

export async function resetPassword(email) {
  const { auth, a } = await load();
  try { await a.sendPasswordResetEmail(auth, email.trim()); } catch (e) { throw friendly(e); }
}

export async function logout() {
  const { auth, a } = await load();
  await flush();
  await a.signOut(auth);
  clearLocal();
}

// ---------- Birleştirme ----------
// İki cihazın ilerlemesini kayıpsız birleştirir: her kart için en son çalışılan sürüm kazanır.
export function mergeStates(aIn, bIn) {
  const a = normalize(aIn), b = normalize(bIn);
  const out = normalize({});
  out.owner = a.owner || b.owner;
  out.resetAt = Math.max(a.resetAt || 0, b.resetAt || 0);

  out.removed = { ...a.removed };
  for (const [k, t] of Object.entries(b.removed)) out.removed[k] = Math.max(out.removed[k] || 0, t);

  const stamp = (c) => c?.last || 0;
  for (const k of new Set([...Object.keys(a.cards), ...Object.keys(b.cards)])) {
    const x = a.cards[k], y = b.cards[k];
    const pick = !x ? y : !y ? x : stamp(y) > stamp(x) || (stamp(y) === stamp(x) && (y.reps || 0) > (x.reps || 0)) ? y : x;
    if (stamp(pick) <= (out.removed[k] || 0) || stamp(pick) < out.resetAt) continue;
    out.cards[k] = pick;
  }

  for (const src of [a.activity, b.activity])
    for (const [d, n] of Object.entries(src)) out.activity[d] = Math.max(out.activity[d] || 0, n);

  out.newToday = a.newToday.date === b.newToday.date
    ? { date: a.newToday.date, count: Math.max(a.newToday.count, b.newToday.count) }
    : a.newToday.date > b.newToday.date ? a.newToday : b.newToday;

  for (const k of new Set([...Object.keys(a.notes), ...Object.keys(b.notes)])) {
    const x = a.notes[k], y = b.notes[k];
    out.notes[k] = !x ? y : !y ? x : (y.updated || 0) > (x.updated || 0) ? { ...x, ...y } : { ...y, ...x };
  }

  for (const k of new Set([...Object.keys(a.priority), ...Object.keys(b.priority)]))
    if (!out.cards[k]) out.priority[k] = true;

  const seen = new Set();
  out.stories = [...a.stories, ...b.stories].filter((s) => {
    const id = `${s.date}|${s.title}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  }).slice(-30);

  out.settings = (b.settings._ts || 0) > (a.settings._ts || 0) ? { ...b.settings } : { ...a.settings };
  out.settings.apiKey = a.settings.apiKey || "";
  return out;
}
