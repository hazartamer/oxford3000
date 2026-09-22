// Claude API: cümle kontrolü, hafıza ipucu ve hikâye üretimi.
// Anahtar kullanıcının kendi tarayıcısında saklanır ve istekler doğrudan api.anthropic.com'a gider.
import { store } from "./storage.js";

const SDK_URL = "https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk/+esm";
let sdk = null;

async function loadSdk() {
  if (!sdk) sdk = import(SDK_URL).then((m) => m.default);
  return sdk;
}

export const hasKey = () => Boolean(store().settings.apiKey.trim());

export class AiError extends Error {}

// Şemaya uygun JSON döndüren tek bir istek
async function askJSON({ system, prompt, schema, maxTokens = 4000 }) {
  if (!hasKey()) throw new AiError("Bu özellik için Ayarlar'dan Claude API anahtarını gir.");
  const Anthropic = await loadSdk().catch(() => { sdk = null; throw new AiError("Claude kütüphanesi yüklenemedi (internet bağlantısını kontrol et)."); });
  const { apiKey, aiModel } = store().settings;
  const client = new Anthropic({ apiKey: apiKey.trim(), dangerouslyAllowBrowser: true });
  const base = {
    model: aiModel,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: prompt }],
  };
  let res;
  try {
    if (aiModel === "claude-opus-5") {
      res = await client.beta.messages.create({
        ...base,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "low", format: { type: "json_schema", schema } },
      });
    } else {
      res = await client.messages.create({ ...base, output_config: { format: { type: "json_schema", schema } } });
    }
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new AiError("API anahtarı geçersiz. Ayarlar'dan kontrol et.");
    if (err instanceof Anthropic.PermissionDeniedError) throw new AiError("Bu anahtarın bu modele erişimi yok.");
    if (err instanceof Anthropic.RateLimitError) throw new AiError("Çok fazla istek gönderildi, biraz sonra tekrar dene.");
    if (err instanceof Anthropic.BadRequestError) throw new AiError(`İstek reddedildi: ${err.message}`);
    if (err instanceof Anthropic.APIConnectionError) throw new AiError("Claude'a bağlanılamadı (internet bağlantısını kontrol et).");
    if (err instanceof Anthropic.APIError) throw new AiError(`Claude hatası (${err.status}): ${err.message}`);
    throw err;
  }
  if (res.stop_reason === "refusal") throw new AiError("Claude bu isteği yanıtlamadı.");
  if (res.stop_reason === "max_tokens") throw new AiError("Yanıt yarıda kesildi, tekrar dene.");
  const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  try { return JSON.parse(text); } catch { throw new AiError("Claude'un yanıtı okunamadı, tekrar dene."); }
}

const TUTOR = "You are a friendly English teacher for a Turkish learner at CEFR B1-B2 level. " +
  "Explanations must be in Turkish, short and encouraging. English examples must sound natural.";

export function checkSentence(w, sentence) {
  return askJSON({
    system: TUTOR,
    prompt: `Target word: "${w.word}" (${w.pos}${w.note ? `, sense: ${w.note}` : ""}; Turkish meaning: ${w.tr}).
The learner wrote this sentence to practise the word:
"""${sentence}"""
Evaluate grammar and whether the target word is used correctly and naturally.
verdict: "correct" (natural and correct), "minor" (understandable but has small mistakes or sounds unnatural), "wrong" (the word is misused or there are serious errors).
corrected: the learner's sentence with minimal corrections (same as the original if already correct).
explanation_tr: 1-3 sentences in Turkish explaining the mistakes, or praising what is good.
alternative: one more natural example sentence using the word in a similar situation.`,
    schema: {
      type: "object",
      properties: {
        verdict: { type: "string", enum: ["correct", "minor", "wrong"] },
        corrected: { type: "string" },
        explanation_tr: { type: "string" },
        alternative: { type: "string" },
      },
      required: ["verdict", "corrected", "explanation_tr", "alternative"],
      additionalProperties: false,
    },
  });
}

export function makeMnemonic(w) {
  return askJSON({
    system: TUTOR,
    prompt: `The learner keeps forgetting the English word "${w.word}" (${w.pos}${w.note ? `, sense: ${w.note}` : ""}), which means "${w.tr}" in Turkish.
Create a memorable Turkish memory aid (keyword method): link the sound or spelling of "${w.word}" to a similar-sounding Turkish word or a vivid, funny mental image that connects to the meaning.
mnemonic_tr: 1-2 sentences in Turkish.
tip_tr: one short extra tip in Turkish (e.g. a word it is often confused with, or a common collocation to remember).`,
    schema: {
      type: "object",
      properties: { mnemonic_tr: { type: "string" }, tip_tr: { type: "string" } },
      required: ["mnemonic_tr", "tip_tr"],
      additionalProperties: false,
    },
  });
}

export function makeStory(words, level) {
  const list = words.map((w) => `${w.word} (${w.pos}${w.note ? `, ${w.note}` : ""})`).join(", ");
  return askJSON({
    system: TUTOR,
    maxTokens: 8000,
    prompt: `Write an engaging short story (160-220 words) for a ${level} English learner.
Use EVERY one of these target words at least once, in the given sense: ${list}.
Wrap each occurrence of a target word (including inflected forms) in double asterisks, like **word**.
Keep the rest of the vocabulary at ${level} level or easier. Give it a clear plot with a small surprise at the end.
title: an English title.
summary_tr: a 1-2 sentence Turkish summary.
questions: exactly 3 English multiple-choice comprehension questions, each with 4 options and the index (0-3) of the correct option.`,
    schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        story: { type: "string" },
        summary_tr: { type: "string" },
        questions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              question: { type: "string" },
              options: { type: "array", items: { type: "string" } },
              answer: { type: "integer" },
            },
            required: ["question", "options", "answer"],
            additionalProperties: false,
          },
        },
      },
      required: ["title", "story", "summary_tr", "questions"],
      additionalProperties: false,
    },
  });
}

export function testConnection() {
  return askJSON({
    system: "Reply with the requested JSON only.",
    prompt: 'Return {"ok": true}.',
    maxTokens: 1000,
    schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false },
  });
}
