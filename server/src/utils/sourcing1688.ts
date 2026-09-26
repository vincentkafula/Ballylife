/**
 * 1688 product research: settings, parsing of the Apify actor
 * `sourabhbgp/1688-scraper` (search mode), and an estimate of what a find
 * would cost landed in South Africa and sell for -- so the admin can judge
 * a product before asking CJ to source it. The estimate never prices a
 * live listing: 1688 finds only reach the store through CJ, which then
 * prices them like every other CJ product.
 */
import { classifyProductName } from "./productCategorizer";
import { isExcludedFromStore } from "./cjCategoryMap";

export interface Sourcing1688Keyword {
  /** English or Chinese (e.g. "bluetooth earphone" or 蓝牙耳机). */
  keyword: string;
  /** Product class for the estimate, or "auto" to infer it from each title. */
  productClass: string;
  enabled: boolean;
}

export interface ProductClassRates { dutyPct: number; freightZar: number }

export interface Sourcing1688Settings {
  enabled: boolean;
  keywords: Sourcing1688Keyword[];
  maxItemsPerKeyword: number;
  refreshHours: number;
  filters: {
    sortType: "normal" | "va_sales360" | "price";
    merchantType: "any" | "superFactory" | "certifiedMerchant";
    supplierYears: "any" | "5" | "7" | "10";
    fastShippingOnly: boolean;
    /** Largest MOQ to accept; null = any. */
    maxMoq: number | null;
    priceMinCny: number | null;
    priceMaxCny: number | null;
  };
  estimate: {
    markupPct: number;
    vatPct: number;
    vatUpliftPct: number;
    classes: Record<string, ProductClassRates>;
    defaultClass: ProductClassRates;
  };
}

export const DEFAULT_1688_SETTINGS: Sourcing1688Settings = {
  enabled: false, // nothing is fetched (or billed) until an admin switches it on
  keywords: [
    { keyword: "bluetooth earphone", productClass: "electronics", enabled: true },
    { keyword: "phone holder", productClass: "electronics", enabled: true },
    { keyword: "led strip light", productClass: "electronics", enabled: true },
    { keyword: "kitchen gadget", productClass: "home", enabled: true },
    { keyword: "storage organizer", productClass: "home", enabled: true },
    { keyword: "women handbag", productClass: "bags", enabled: true },
    { keyword: "hair accessories", productClass: "beauty", enabled: true },
    { keyword: "educational toys", productClass: "toys", enabled: true },
  ],
  maxItemsPerKeyword: 50,
  refreshHours: 24 * 7,
  filters: { sortType: "normal", merchantType: "any", supplierYears: "5", fastShippingOnly: false, maxMoq: null, priceMinCny: null, priceMaxCny: null },
  estimate: {
    markupPct: 50,
    vatPct: 15,
    vatUpliftPct: 10,
    // SA customs duty is set per tariff heading; these are typical rates for each class.
    classes: {
      apparel: { dutyPct: 45, freightZar: 120 },
      shoes: { dutyPct: 45, freightZar: 180 },
      bags: { dutyPct: 20, freightZar: 150 },
      electronics: { dutyPct: 15, freightZar: 150 },
      home: { dutyPct: 20, freightZar: 200 },
      beauty: { dutyPct: 20, freightZar: 100 },
      toys: { dutyPct: 20, freightZar: 150 },
      jewellery: { dutyPct: 20, freightZar: 60 },
      sports: { dutyPct: 20, freightZar: 180 },
    },
    defaultClass: { dutyPct: 20, freightZar: 150 },
  },
};

// Storefront category -> estimate class, for productClass "auto".
const CLASS_BY_CATEGORY: Record<string, string> = {
  "cat-csv-fashion": "apparel", "cat-csv-shoes": "shoes", "cat-csv-bags": "bags", "cat-csv-travel": "bags",
  "cat-csv-jewellery": "jewellery", "cat-csv-beauty": "beauty", "cat-csv-health": "beauty",
  "cat-csv-toys": "toys", "cat-csv-baby": "toys", "cat-csv-sports": "sports",
  "cat-01": "electronics", "cat-csv-audio": "electronics", "cat-csv-mobile-acc": "electronics", "cat-csv-computer-acc": "electronics",
  "cat-csv-cameras": "electronics", "cat-csv-gaming": "electronics", "cat-csv-networking": "electronics", "cat-csv-smart-home": "electronics",
  "cat-csv-tv": "electronics", "cat-csv-smartphones": "electronics", "cat-csv-batteries": "electronics", "cat-csv-solar": "electronics",
};

export function classFor(title: string, keywordClass: string): string {
  if (keywordClass && keywordClass !== "auto") return keywordClass;
  const cat = classifyProductName(title);
  return (cat && CLASS_BY_CATEGORY[cat]) || "home";
}

const num = (v: unknown, fallback: number, min = 0, max = 1_000_000) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const optNum = (v: unknown, min = 0, max = 1_000_000): number | null => (v === null || v === undefined || v === "" ? null : num(v, 0, min, max));
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);
const rates = (v: unknown, d: ProductClassRates): ProductClassRates => {
  const o = (v && typeof v === "object" ? v : {}) as Partial<ProductClassRates>;
  return { dutyPct: num(o.dutyPct, d.dutyPct, 0, 100), freightZar: num(o.freightZar, d.freightZar, 0, 100_000) };
};

export function normalise1688Settings(input: unknown): Sourcing1688Settings {
  const d = DEFAULT_1688_SETTINGS;
  const s = (input && typeof input === "object" ? input : {}) as Record<string, any>;
  const f = (s.filters && typeof s.filters === "object" ? s.filters : {}) as Record<string, unknown>;
  const e = (s.estimate && typeof s.estimate === "object" ? s.estimate : {}) as Record<string, any>;
  const classesIn = (e.classes && typeof e.classes === "object" ? e.classes : d.estimate.classes) as Record<string, unknown>;
  const classes: Record<string, ProductClassRates> = {};
  for (const [k, v] of Object.entries(classesIn)) {
    const key = k.trim().toLowerCase().slice(0, 30);
    if (key) classes[key] = rates(v, d.estimate.defaultClass);
  }
  return {
    enabled: s.enabled === undefined ? d.enabled : Boolean(s.enabled),
    keywords: Array.isArray(s.keywords)
      ? (s.keywords as Partial<Sourcing1688Keyword>[])
          .map(k => ({ keyword: String(k?.keyword ?? "").trim().slice(0, 80), productClass: String(k?.productClass ?? "auto").trim().toLowerCase().slice(0, 30) || "auto", enabled: k?.enabled !== false }))
          .filter(k => k.keyword).slice(0, 50)
      : d.keywords,
    maxItemsPerKeyword: Math.round(num(s.maxItemsPerKeyword, d.maxItemsPerKeyword, 1, 500)),
    refreshHours: num(s.refreshHours, d.refreshHours, 1, 24 * 90),
    filters: {
      sortType: oneOf(f.sortType, ["normal", "va_sales360", "price"] as const, d.filters.sortType),
      merchantType: oneOf(f.merchantType, ["any", "superFactory", "certifiedMerchant"] as const, d.filters.merchantType),
      supplierYears: oneOf(String(f.supplierYears ?? d.filters.supplierYears), ["any", "5", "7", "10"] as const, d.filters.supplierYears),
      fastShippingOnly: Boolean(f.fastShippingOnly),
      maxMoq: optNum(f.maxMoq, 1, 100_000),
      priceMinCny: optNum(f.priceMinCny),
      priceMaxCny: optNum(f.priceMaxCny),
    },
    estimate: {
      markupPct: num(e.markupPct, d.estimate.markupPct, 0, 500),
      vatPct: num(e.vatPct, d.estimate.vatPct, 0, 100),
      vatUpliftPct: num(e.vatUpliftPct, d.estimate.vatUpliftPct, 0, 100),
      classes,
      defaultClass: rates(e.defaultClass, d.estimate.defaultClass),
    },
  };
}

/** The actor input for one research run (every enabled keyword in a single run). */
export function actorInput(s: Sourcing1688Settings) {
  const keywords = s.keywords.filter(k => k.enabled).map(k => k.keyword);
  return {
    mode: "search",
    keywords,
    maxItems: Math.min(10_000, keywords.length * s.maxItemsPerKeyword),
    sortType: s.filters.sortType,
    merchantType: s.filters.merchantType,
    supplierYears: s.filters.supplierYears,
    fastShippingOnly: s.filters.fastShippingOnly,
    ...(s.filters.maxMoq ? { minOrderQuantity: s.filters.maxMoq } : {}),
    ...(s.filters.priceMinCny !== null ? { priceMin: s.filters.priceMinCny } : {}),
    ...(s.filters.priceMaxCny !== null ? { priceMax: s.filters.priceMaxCny } : {}),
    includeSkuDetails: false,
    proxyConfiguration: { useApifyProxy: true },
  };
}

// ── Parsing ──────────────────────────────────────────────────────────────

export interface Offer1688 {
  offerId: string; title: string; url: string | null;
  priceCny: number; priceRangeCny: string | null; moq: number | null; unit: string | null;
  stock: number | null; outOfStock: boolean; soldCount: number | null; repurchaseRate: number | null; starLevel: number | null;
  supplierName: string | null; supplierType: string | null; supplierYears: number | null; location: string | null;
  categoryPath: string | null; images: string[]; videoUrl: string | null; totalVariants: number | null;
  supportsDropship: boolean | null; deliveryLimitDays: number | null; sourceKeyword: string | null;
}

const toNum = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const m = v.replace(/[,\s]/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]) * (/万/.test(v) ? 10_000 : 1); // "1.2万+" sold
  return Number.isFinite(n) ? n : null;
};
const toStr = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return v.map(x => (typeof x === "object" && x ? (x as { name?: string }).name ?? "" : String(x))).filter(Boolean).join(" > ") || null;
  if (typeof v === "object") return null;
  const s = String(v).trim();
  return s || null;
};
const images = (v: unknown): string[] =>
  (Array.isArray(v) ? v : typeof v === "string" ? [v] : [])
    .map(x => (typeof x === "string" ? x : typeof x === "object" && x ? String((x as { url?: unknown }).url ?? "") : ""))
    .map(u => (u.startsWith("//") ? `https:${u}` : u))
    .filter(u => /^https?:\/\//i.test(u))
    .slice(0, 12);

/** One search row -> an offer, or null for rows that aren't products (or lack an id, title or price). */
export function parse1688Item(item: Record<string, unknown>): Offer1688 | null {
  const offerId = toStr(item.offerId);
  const title = toStr(item.title);
  const priceCny = toNum(item.priceCny) ?? toNum(item.priceRangeCny);
  if (!offerId || !title || priceCny === null || priceCny <= 0) return null;
  return {
    offerId, title, url: toStr(item.url) ?? `https://detail.1688.com/offer/${offerId}.html`,
    priceCny, priceRangeCny: toStr(item.priceRangeCny), moq: toNum(item.minOrderQuantity), unit: toStr(item.unit),
    stock: toNum(item.stock), outOfStock: item.isOutOfStock === true,
    soldCount: toNum(item.soldCount ?? item.salesCount ?? item.sales), repurchaseRate: toNum(item.repurchaseRate), starLevel: toNum(item.starLevel),
    supplierName: toStr(item.supplierName), supplierType: toStr(item.supplierType), supplierYears: toNum(item.supplierYearsOnPlatform),
    location: toStr(item.locationCn), categoryPath: toStr(item.categoryPath) ?? toStr(item.categoryNameCn),
    images: images(item.images), videoUrl: toStr(item.videoUrl), totalVariants: toNum(item.totalVariants),
    supportsDropship: typeof item.supportsDropship === "boolean" ? item.supportsDropship : null,
    deliveryLimitDays: toNum(item.deliveryLimitDays), sourceKeyword: toStr(item.sourceKeyword),
  };
}

export function parse1688Run(items: Record<string, unknown>[]): { offers: Offer1688[]; skipped: number; excluded: number; schemaSuspect: boolean; sampleKeys: string[] } {
  const offers: Offer1688[] = [];
  let skipped = 0, excluded = 0;
  for (const item of items) {
    const o = parse1688Item(item);
    if (!o) { skipped++; continue; }
    if (isExcludedFromStore(o.title, o.categoryPath)) { excluded++; continue; }
    offers.push(o);
  }
  return {
    offers, skipped, excluded,
    schemaSuspect: items.length >= 3 && offers.length + excluded < items.length / 2,
    sampleKeys: items[0] ? Object.keys(items[0]).slice(0, 40) : [],
  };
}

// ── Estimate ─────────────────────────────────────────────────────────────

export interface Estimate1688 {
  productClass: string; cnyToZar: number; unitZar: number; freightZar: number; dutyZar: number; importVatZar: number;
  landedZar: number; markupPct: number; resaleZar: number; unitUsd: number | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function estimate1688(priceCny: number, productClass: string, cnyToZar: number, usdToZar: number | null, s: Sourcing1688Settings): Estimate1688 {
  const rates = s.estimate.classes[productClass] ?? s.estimate.defaultClass;
  const unitZar = priceCny * cnyToZar;
  const dutyZar = (rates.dutyPct / 100) * (unitZar + rates.freightZar);
  const importVatZar = (s.estimate.vatPct / 100) * (unitZar * (1 + s.estimate.vatUpliftPct / 100) + dutyZar);
  const landedZar = unitZar + rates.freightZar + dutyZar + importVatZar;
  return {
    productClass, cnyToZar, unitZar: r2(unitZar), freightZar: r2(rates.freightZar), dutyZar: r2(dutyZar), importVatZar: r2(importVatZar),
    landedZar: r2(landedZar), markupPct: s.estimate.markupPct, resaleZar: Math.ceil(landedZar * (1 + s.estimate.markupPct / 100) - 1e-9),
    unitUsd: usdToZar ? r2(unitZar / usdToZar) : null,
  };
}
