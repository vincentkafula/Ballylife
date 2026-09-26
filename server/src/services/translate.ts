/**
 * Machine translation into English for supplier text that a dictionary
 * can't handle (Japanese part titles, above all). Uses DeepL when
 * DEEPL_API_KEY is set in Railway -- the free plan's 500,000 characters a
 * month is plenty, and every result is cached in text_translations, so a
 * title is only ever translated once. Without a key, returns nothing and
 * callers fall back to their dictionary.
 */
import crypto from "crypto";
import { pool } from "../db/pool";
import { logger } from "../utils/logger";

export function isTranslationConfigured(): boolean {
  return Boolean(process.env.DEEPL_API_KEY?.trim());
}

const hashOf = (lang: string, text: string) => crypto.createHash("sha256").update(`${lang}\n${text}`).digest("hex");

/** English for each text (null where unavailable). `sourceLang` e.g. "JA", "ZH". */
export async function translateToEnglish(texts: string[], sourceLang: string): Promise<(string | null)[]> {
  const out: (string | null)[] = texts.map(() => null);
  if (!texts.length) return out;
  const keys = texts.map(t => hashOf(sourceLang, t));
  const { rows } = await pool!.query(`SELECT source_hash, english FROM text_translations WHERE source_hash IN (${keys.map((_, i) => `$${i + 1}`).join(",")})`, keys);
  const cached = new Map(rows.map((r: { source_hash: string; english: string }) => [r.source_hash, r.english]));
  const missing: number[] = [];
  texts.forEach((_, i) => { if (cached.has(keys[i])) out[i] = cached.get(keys[i])!; else missing.push(i); });

  const key = process.env.DEEPL_API_KEY?.trim();
  if (!missing.length || !key) return out;
  // Free-plan keys end in ":fx" and use their own host.
  const host = key.endsWith(":fx") ? "https://api-free.deepl.com" : "https://api.deepl.com";
  for (let start = 0; start < missing.length; start += 50) {
    const batch = missing.slice(start, start + 50);
    try {
      const res = await fetch(`${host}/v2/translate`, {
        method: "POST",
        headers: { Authorization: `DeepL-Auth-Key ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ text: batch.map(i => texts[i]), source_lang: sourceLang, target_lang: "EN-GB" }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) {
        logger.warn("translate.deepl_failed", { status: res.status, hint: res.status === 456 ? "DeepL monthly quota used up" : res.status === 403 ? "DEEPL_API_KEY rejected" : undefined });
        return out;
      }
      const json = (await res.json()) as { translations?: { text: string }[] };
      for (let j = 0; j < batch.length; j++) {
        const english = json.translations?.[j]?.text?.trim();
        if (!english) continue;
        const i = batch[j];
        out[i] = english;
        await pool!.query(
          `INSERT INTO text_translations (source_hash, source_lang, source_text, english) VALUES ($1,$2,$3,$4) ON CONFLICT (source_hash) DO NOTHING`,
          [keys[i], sourceLang, texts[i], english]
        ).catch(() => undefined);
      }
    } catch (err) {
      logger.warn("translate.deepl_error", { error: err instanceof Error ? err.message : String(err) });
      return out;
    }
  }
  return out;
}
