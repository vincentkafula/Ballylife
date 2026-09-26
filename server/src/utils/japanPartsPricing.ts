/**
 * Japan used parts (UP-GARAGE): settings and the resale price formula.
 *
 * The stored listing price is the final rand price the customer pays
 * before South African VAT on the sale (added at checkout like every other
 * product) -- never the raw yen price. Per part:
 *
 *   part (ZAR)   = UP-GARAGE price incl. Japanese consumption tax x JPY->ZAR rate
 *   forwarding   = flat fee per part (Japan forwarder handling)
 *   freight      = flat amount by part category (the actor returns no weight/size)
 *   customs duty = duty % x (part + freight)
 *   import VAT   = VAT % x (part x (1 + uplift %) + duty)     -- SARS "added tax value"
 *   landed cost  = part + forwarding + freight + duty + import VAT
 *   price        = landed cost x (1 + markup %), rounded up to the next rand
 *
 * Every rate is admin-editable (jp_parts_settings). If Ballylife claims
 * import VAT back as input tax, set vatPct to 0 so it isn't passed on.
 */

export interface JapanPartsKeyword {
  /** Search term sent to UP-GARAGE -- Japanese works best (ホイール, マフラー...). */
  keyword: string;
  /** English name shown to shoppers in front of the Japanese listing title. */
  label: string;
  /** Freight class used for pricing: a key of freightByCategory. */
  partsCategory: string;
  enabled: boolean;
}

export interface JapanPartsSettings {
  enabled: boolean;
  keywords: JapanPartsKeyword[];
  /** Results fetched per keyword per refresh. The actor bills per result (~US$0.002). */
  maxItemsPerKeyword: number;
  refreshHours: number;
  markupPct: number;
  forwarderFeeZar: number;
  dutyPct: number;
  vatPct: number;
  vatUpliftPct: number;
  freightByCategory: Record<string, number>;
  defaultFreightZar: number;
  deliveryDays: { min: number; max: number };
}

export const DEFAULT_JAPAN_PARTS_SETTINGS: JapanPartsSettings = {
  enabled: false, // off until the admin has checked the settings and APIFY_API_TOKEN is set
  keywords: [
    { keyword: "ホイール", label: "Wheels", partsCategory: "wheels", enabled: true },
    { keyword: "マフラー", label: "Exhaust / muffler", partsCategory: "exhaust", enabled: true },
    { keyword: "レカロ", label: "Recaro seat", partsCategory: "seats", enabled: true },
    { keyword: "車高調", label: "Coilovers", partsCategory: "suspension", enabled: true },
    { keyword: "ヘッドライト", label: "Headlight", partsCategory: "lights", enabled: true },
    { keyword: "テールランプ", label: "Tail light", partsCategory: "lights", enabled: true },
    { keyword: "ステアリング", label: "Steering wheel", partsCategory: "interior", enabled: true },
    { keyword: "カーナビ", label: "Car navigation unit", partsCategory: "electronics", enabled: false },
    { keyword: "エアロ", label: "Aero / body kit part", partsCategory: "body", enabled: false },
  ],
  maxItemsPerKeyword: 20,
  refreshHours: 24,
  markupPct: 30,
  forwarderFeeZar: 150,
  dutyPct: 20, // SARS tariff heading 87.08 (parts of motor vehicles)
  vatPct: 15,
  vatUpliftPct: 10,
  freightByCategory: {
    wheels: 1800, tyres: 1500, seats: 1600, exhaust: 1400, body: 1500, suspension: 1100,
    engine: 1200, lights: 650, interior: 600, electronics: 450, small: 450,
  },
  defaultFreightZar: 900,
  deliveryDays: { min: 15, max: 30 },
};

const num = (v: unknown, fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

/** Merges admin input over the defaults, clamping every number to a sane range. */
export function normaliseJapanPartsSettings(input: unknown): JapanPartsSettings {
  const d = DEFAULT_JAPAN_PARTS_SETTINGS;
  const s = (input && typeof input === "object" ? input : {}) as Partial<Record<keyof JapanPartsSettings, unknown>>;
  const keywords = Array.isArray(s.keywords)
    ? (s.keywords as Partial<JapanPartsKeyword>[])
        .map(k => ({
          keyword: String(k?.keyword ?? "").trim().slice(0, 60),
          label: String(k?.label ?? "").trim().slice(0, 60),
          partsCategory: String(k?.partsCategory ?? "").trim().toLowerCase().slice(0, 30) || "small",
          enabled: k?.enabled !== false,
        }))
        .filter(k => k.keyword)
        .slice(0, 50)
    : d.keywords;
  const freightIn = (s.freightByCategory && typeof s.freightByCategory === "object" ? s.freightByCategory : d.freightByCategory) as Record<string, unknown>;
  const freightByCategory: Record<string, number> = {};
  for (const [k, v] of Object.entries(freightIn)) {
    const key = k.trim().toLowerCase().slice(0, 30);
    if (key) freightByCategory[key] = num(v, d.defaultFreightZar, 0, 100_000);
  }
  const days = (s.deliveryDays ?? d.deliveryDays) as { min?: unknown; max?: unknown };
  const minDays = num(days?.min, d.deliveryDays.min, 1, 120);
  return {
    enabled: s.enabled === undefined ? d.enabled : Boolean(s.enabled),
    keywords,
    maxItemsPerKeyword: Math.round(num(s.maxItemsPerKeyword, d.maxItemsPerKeyword, 1, 200)),
    refreshHours: num(s.refreshHours, d.refreshHours, 1, 24 * 30),
    markupPct: num(s.markupPct, d.markupPct, 0, 500),
    forwarderFeeZar: num(s.forwarderFeeZar, d.forwarderFeeZar, 0, 100_000),
    dutyPct: num(s.dutyPct, d.dutyPct, 0, 100),
    vatPct: num(s.vatPct, d.vatPct, 0, 100),
    vatUpliftPct: num(s.vatUpliftPct, d.vatUpliftPct, 0, 100),
    freightByCategory,
    defaultFreightZar: num(s.defaultFreightZar, d.defaultFreightZar, 0, 100_000),
    deliveryDays: { min: minDays, max: Math.max(minDays, num(days?.max, d.deliveryDays.max, 1, 180)) },
  };
}

export interface JapanPartPriceBreakdown {
  jpyTaxIncl: number;
  jpyToZar: number;
  partZar: number;
  forwarderZar: number;
  freightZar: number;
  dutyZar: number;
  importVatZar: number;
  landedZar: number;
  markupPct: number;
  priceZar: number;
  partsCategory: string;
  calculatedAt: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function priceJapanPart(jpyTaxIncl: number, partsCategory: string, jpyToZar: number, s: JapanPartsSettings, now = new Date()): JapanPartPriceBreakdown {
  const partZar = jpyTaxIncl * jpyToZar;
  const freightZar = s.freightByCategory[partsCategory] ?? s.defaultFreightZar;
  const dutyZar = (s.dutyPct / 100) * (partZar + freightZar);
  const importVatZar = (s.vatPct / 100) * (partZar * (1 + s.vatUpliftPct / 100) + dutyZar);
  const landedZar = partZar + s.forwarderFeeZar + freightZar + dutyZar + importVatZar;
  return {
    jpyTaxIncl, jpyToZar,
    partZar: round2(partZar), forwarderZar: round2(s.forwarderFeeZar), freightZar: round2(freightZar),
    dutyZar: round2(dutyZar), importVatZar: round2(importVatZar), landedZar: round2(landedZar),
    markupPct: s.markupPct,
    // Round the unrounded landed cost, and nudge past float noise so R1000.0000001 doesn't become R1001.
    priceZar: Math.ceil(landedZar * (1 + s.markupPct / 100) - 1e-9),
    partsCategory, calculatedAt: now.toISOString(),
  };
}
