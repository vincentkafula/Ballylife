/**
 * Turns supplier listing titles into storefront product names.
 *
 * Supplier titles are written for wholesale buyers and search engines:
 * "Cross-border European And American New Style Women's Shirt ... In Stock",
 * "2026 Amazon Hot-selling ... Factory Wholesale". That trade jargon names
 * other marketplaces, reveals the product is resold, and reads as spam to a
 * shopper. This strips it, keeps what the product actually is, and trims
 * run-on keyword lists to a readable length.
 *
 * Supplier *brand* names (CJ, 1688, ...) are handled separately by
 * scrubSupplierBranding in supplierWhiteLabel.ts; cleanProductName runs it too.
 */
import { scrubSupplierBranding } from "./supplierWhiteLabel";

/** Bump when the rules below change: stored names are re-cleaned once per version. */
export const NAMING_RULES_VERSION = 1;

const MAX_NAME_LENGTH = 90;

// Phrases removed wherever they appear. Order matters: longer phrases first.
const TRADE_JARGON: RegExp[] = [
  /\b(?:amazon|temu|shein|ebay|tik ?tok|walmart|etsy|lazada|shopee)(?:\.com)?\s*(?:exclusive|hot[- ]?selling|best[- ]?selling|same style|explosive|popular|new)?\b/gi,
  /\b(?:cross|across)[- ]?border(?:\s+(?:e-?commerce|exclusive|foreign trade|new|hot[- ]?selling|best[- ]?selling))*\b/gi,
  /\bforeign trade\b/gi,
  /\b(?:european\s*(?:and|&)\s*american|euro-?american)(?:\s*(?:style|fashion|foreign trade))?\b/gi,
  /\b(?:factory|manufacturers?)\s*(?:direct(?:ly)?(?:\s+sales?)?|supply|stock(?:\s+available)?|wholesale|outlet|price|sales?)\b/gi,
  /\b(?:direct\s+)?(?:from\s+)?(?:factory|manufacturers?)\s+wholesale\b/gi,
  /\bwholesale\b/gi,
  /\b(?:in[- ]stock|spot goods|stock available|available (?:in stock|now)|ready (?:stock|to ship)|fast delivery|free shipping|dropshipping|drop shipping)\b/gi,
  /\b(?:hot[- ]?(?:selling|sale|sell)|best[- ]?(?:selling|seller)|explosive(?: models?)?|top[- ]selling|trending|popular)\b/gi,
  /\b(?:new(?:ly)?[- ]arrivals?|new[- ]style|new[- ]product|new(?:ly)? (?:listed|launched)|latest(?: style)?)\b/gi,
  /\bprivate (?:model|label|mould|mold)\b/gi,
  /\b(?:20[12]\d)(?:\s*new)?\b/g, // "2026 New ..." -- dates a listing, says nothing about the product
  /\bone (?:piece|pc) dropshipping\b/gi,
];

// Leading words that are filler once the jargon is gone.
const LEADING_FILLER = /^(?:(?:new|hot|the|a|an|and|with|for|style)\b[\s,/&-]*)+/i;

function titleCaseWord(w: string): string {
  // Leave anything with capitals or digits alone (USB, iPhone, 3D, 20W).
  if (/[A-Z0-9]/.test(w) || w.length === 0) return w;
  if (/^(and|or|for|with|of|to|in|on|the|a|an|by|at)$/.test(w)) return w;
  return w[0].toUpperCase() + w.slice(1);
}

// A name cut short must not end mid-phrase ("... Long Battery Life High", "... Paired With A").
const DANGLING = /[\s,/&(-]+(?:and|or|for|with|of|to|in|on|the|a|an|by|at|from|that|featuring|features|new|high|low|large|small|long|short|super|ultra|extra|multi|suitable|plus)$/i;

function dropDanglingWords(s: string): string {
  let out = s.replace(/[\s,/&(-]+$/, "");
  for (let prev = ""; prev !== out; ) { prev = out; out = out.replace(DANGLING, ""); }
  return out;
}

/** Trims a keyword run-on at a natural break (comma, " - ", " | ") or a word boundary. */
function shorten(name: string): string {
  if (name.length <= MAX_NAME_LENGTH) return name;
  const parts = name.split(/\s*(?:,|;|\||\s-\s|\s–\s)\s*/);
  let out = "";
  for (const part of parts) {
    const next = out ? `${out}, ${part}` : part;
    if (next.length > MAX_NAME_LENGTH) break;
    out = next;
  }
  if (out.length >= 25) return dropDanglingWords(out);
  const cut = name.slice(0, MAX_NAME_LENGTH);
  return dropDanglingWords(cut.slice(0, Math.max(cut.lastIndexOf(" "), 40)));
}

export function cleanProductName(raw: string | null | undefined): string {
  let s = scrubSupplierBranding(raw);
  if (!s) return "";
  for (const re of TRADE_JARGON) s = s.replace(re, " ");
  s = s
    // "Applicable To iPad Mini 6 Case" / "Suitable For MacBook ..." -> "For ..."
    .replace(/^\s*(?:applicable|suitable|compatible|adapted|apply)\s+(?:to|for|with)\b/i, "For")
    .replace(/\b(?:is\s+)?(?:applicable|suitable) (?:to|for)\b/gi, "for")
    // Punctuation left behind by removals: ", ,", "( )", "- -", leading/trailing separators.
    .replace(/\(\s*\)|\[\s*\]/g, " ")
    .replace(/\s*,\s*(?:,\s*)+/g, ", ")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/^[\s,.;:/&|–—-]+|[\s,.;:/&|–—-]+$/g, "")
    .trim();
  s = s.replace(/^['’]s\b\s*/, "").replace(LEADING_FILLER, "").trim();
  s = shorten(s);
  s = s.split(" ").map(titleCaseWord).join(" ");
  if (s) s = s[0].toUpperCase() + s.slice(1);
  // Never return something unusable: fall back to the branding-scrubbed original.
  return s.length >= 3 ? s : scrubSupplierBranding(raw);
}

/**
 * Descriptions: drop the same marketplace and trade jargon, but only at
 * phrase level -- descriptions are prose, and sizes/specs must survive.
 */
export function cleanDescriptionText(text: string | null | undefined): string {
  if (!text) return "";
  let s = text;
  for (const re of TRADE_JARGON.slice(0, 8)) s = s.replace(re, " ");
  return s.split("\n").map(l => l.replace(/[ \t]{2,}/g, " ").replace(/\s+([,.;:!?])/g, "$1").replace(/^[\s,;:]+/, "").trim()).filter(Boolean).join("\n");
}
