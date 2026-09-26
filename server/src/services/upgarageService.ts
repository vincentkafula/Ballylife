/**
 * UP-GARAGE (Japan's largest used car-parts chain) listings, fetched through
 * the Apify Actor `fruitful_quintessence/upgarage-parts-scraper`.
 *
 * Server-side only: APIFY_API_TOKEN comes from the environment and is sent
 * in the Authorization header, never in a URL we log or a response we
 * return. The actor bills per result, so this is only ever called by the
 * scheduled refresh (japanParts.ts), never from a storefront request.
 *
 * The actor doesn't publish an output schema and is young (Aug 2026), so
 * parseUpgarageItem accepts the field names a scraper like it plausibly
 * uses, and the refresh flags a run as `schema_changed` -- with the keys it
 * did get -- when most items lack a name or price, instead of silently
 * listing garbage.
 */
import { logger } from "../utils/logger";

const ACTOR_ID = process.env.UPGARAGE_ACTOR_ID || "fruitful_quintessence~upgarage-parts-scraper";
const APIFY_BASE = "https://api.apify.com/v2";
// run-sync waits for the run to finish; Apify caps it at 300s.
const RUN_TIMEOUT_MS = 310_000;

export function isApifyConfigured(): boolean {
  return Boolean(process.env.APIFY_API_TOKEN?.trim());
}

export class UpgarageError extends Error {
  constructor(message: string, readonly kind: "config" | "http" | "blocked" | "timeout" | "bad_response", readonly status?: number) {
    super(message);
  }
}

/** Raw dataset items for one keyword. Throws UpgarageError with a diagnosable `kind`. */
export async function runUpgarageSearch(searchKeyword: string, maxItems: number): Promise<Record<string, unknown>[]> {
  const token = process.env.APIFY_API_TOKEN?.trim();
  if (!token) throw new UpgarageError("APIFY_API_TOKEN is not set", "config");
  const maxPages = Math.max(1, Math.ceil(maxItems / 20)); // the actor pages 20 items at a time
  let res: Response;
  try {
    res = await fetch(`${APIFY_BASE}/acts/${ACTOR_ID}/run-sync-get-dataset-items?format=json&clean=true`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ searchKeyword, maxItems, maxPages }),
      signal: AbortSignal.timeout(RUN_TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    throw new UpgarageError(timedOut ? "Apify run timed out" : `Apify request failed: ${err instanceof Error ? err.message : String(err)}`, timedOut ? "timeout" : "http");
  }
  const text = await res.text();
  if (!res.ok) {
    // 401/403 = our token; 402 = Apify credit; 408 = run took too long; 400 with a run-failed
    // message usually means the actor itself failed (e.g. UP-GARAGE blocking it).
    let detail = text.slice(0, 300);
    try { detail = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? detail; } catch { /* keep text */ }
    const kind = res.status === 408 ? "timeout" : /block|captcha|forbidden|denied|429|403/i.test(detail) ? "blocked" : "http";
    throw new UpgarageError(`Apify ${res.status}: ${detail}`, kind, res.status);
  }
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw new UpgarageError(`Apify returned non-JSON: ${text.slice(0, 200)}`, "bad_response"); }
  if (!Array.isArray(data)) throw new UpgarageError(`Apify returned ${typeof data}, expected an array of items`, "bad_response");
  return data.filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object");
}

// ── Parsing ──────────────────────────────────────────────────────────────

export interface UpgaragePart {
  listingId: string;
  name: string;
  priceJpy: number | null;         // excl. consumption tax
  priceJpyTaxIncl: number | null;
  category: string | null;
  condition: string | null;
  shop: string | null;
  location: string | null;
  year: string | null;
  mileage: string | null;
  fitment: string | null;
  images: string[];
  url: string | null;
  soldOut: boolean;
}

const JP_CONSUMPTION_TAX = 0.1;

function pick(item: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    const v = item[k];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

const str = (v: unknown): string | null => {
  if (v === undefined || v === null) return null;
  if (typeof v === "object") return Array.isArray(v) ? v.filter(x => typeof x === "string" || typeof x === "number").join(", ") || null : null;
  const s = String(v).replace(/\s+/g, " ").trim();
  return s || null;
};

/** "¥12,800（税込）" / "12800" / 12800 -> 12800. */
export function parseYen(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? v : null;
  if (typeof v !== "string") return null;
  const digits = v.replace(/[,，\s]/g, "").match(/\d+(?:\.\d+)?/);
  const n = digits ? Number(digits[0]) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

function imageList(v: unknown): string[] {
  const list = Array.isArray(v) ? v : typeof v === "string" ? v.split(/[,\s]+/) : [];
  return list
    .map(x => (typeof x === "string" ? x : typeof x === "object" && x ? String((x as { url?: unknown; src?: unknown }).url ?? (x as { src?: unknown }).src ?? "") : ""))
    .map(u => (u.startsWith("//") ? `https:${u}` : u))
    .filter(u => /^https?:\/\//i.test(u));
}

/** Maps one actor item to our shape, or null when it lacks an id or a name (counted as skipped). */
export function parseUpgarageItem(item: Record<string, unknown>): UpgaragePart | null {
  const url = str(pick(item, ["url", "detailUrl", "itemUrl", "productUrl", "link", "href"]));
  const idFromUrl = url?.match(/(?:item|goods|detail|product)s?\/(?:detail\/)?([A-Za-z0-9_-]{4,})/i)?.[1] ?? url?.match(/[?&](?:id|item_?id|goods_?id)=([A-Za-z0-9_-]+)/i)?.[1] ?? null;
  const listingId = str(pick(item, ["id", "itemId", "itemCode", "productId", "goodsId", "code", "sku", "listingId"])) ?? idFromUrl;
  const name = str(pick(item, ["name", "title", "productName", "itemName", "partName", "goodsName"]));
  if (!listingId || !name) return null;

  const priceTaxIncl = parseYen(pick(item, ["priceTaxIncluded", "taxIncludedPrice", "priceInclTax", "priceWithTax", "price_tax_included", "priceTaxIn", "taxInPrice", "totalPrice"]));
  const priceEx = parseYen(pick(item, ["price", "priceJpy", "price_jpy", "priceExTax", "priceExclTax", "priceTaxExcluded", "taxExcludedPrice"]));
  const priceJpyTaxIncl = priceTaxIncl ?? (priceEx !== null ? Math.round(priceEx * (1 + JP_CONSUMPTION_TAX)) : null);
  const priceJpy = priceEx ?? (priceTaxIncl !== null ? Math.round(priceTaxIncl / (1 + JP_CONSUMPTION_TAX)) : null);

  const stockText = str(pick(item, ["stock", "status", "availability", "inStock", "soldOut"]));
  const soldOut = item.soldOut === true || item.inStock === false || /sold ?out|売切|売り切れ|在庫なし|品切/i.test(stockText ?? "");

  const maker = str(pick(item, ["maker", "carMaker", "manufacturer"]));
  const model = str(pick(item, ["carModel", "model", "vehicle", "compatibleModel", "compatibleModels", "fitment", "applicableModel", "carType"]));

  return {
    listingId, name, priceJpy, priceJpyTaxIncl,
    category: str(pick(item, ["category", "categoryName", "partCategory", "genre", "genreName"])),
    condition: str(pick(item, ["condition", "conditionGrade", "rank", "grade", "state", "quality"])),
    shop: str(pick(item, ["shop", "shopName", "store", "storeName", "seller"])),
    location: str(pick(item, ["prefecture", "location", "area", "shopArea", "shopAddress", "region"])),
    year: str(pick(item, ["year", "modelYear", "carYear"])),
    mileage: str(pick(item, ["mileage", "distance", "odometer"])),
    fitment: [maker, model].filter(Boolean).join(" ") || null,
    images: imageList(pick(item, ["images", "imageUrls", "photos", "pictures", "image", "imageUrl", "thumbnail", "mainImage"])),
    url,
    soldOut,
  };
}

/**
 * Parses a whole run. `schemaSuspect` is true when most items couldn't be
 * used -- the signature of the actor changing its output (or UP-GARAGE
 * serving a block page the actor scraped as items).
 */
export function parseUpgarageRun(items: Record<string, unknown>[]): { parts: UpgaragePart[]; skipped: number; schemaSuspect: boolean; sampleKeys: string[] } {
  const parts: UpgaragePart[] = [];
  let skipped = 0;
  for (const item of items) {
    const p = parseUpgarageItem(item);
    if (p && p.priceJpyTaxIncl !== null) parts.push(p);
    else skipped++;
  }
  const schemaSuspect = items.length >= 3 && parts.length < items.length / 2;
  const sampleKeys = items[0] ? Object.keys(items[0]).slice(0, 40) : [];
  if (schemaSuspect) logger.warn("upgarage.schema_suspect", { items: items.length, usable: parts.length, sampleKeys });
  return { parts, skipped, schemaSuspect, sampleKeys };
}
