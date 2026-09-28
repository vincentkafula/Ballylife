/**
 * Turns raw supplier data into what a seller may see: Ballylife's own
 * product format, in English, prices as a rand base cost, and nothing that
 * identifies the supplier -- no name, id, link, CDN URL or supplier price.
 *
 *  - ids become sealed refs (utils/sealed.ts) the browser can't read;
 *  - photos become /api/marketplace/media/s/<sealed> (our image proxy);
 *    photos on hosts outside the supplier allowlist are dropped, never passed on;
 *  - titles/descriptions lose supplier names, links and "ships from…" lines.
 */
import { seal } from "../../utils/sealed";
import { isSupplierImageUrl, mentionsSupplier, scrubSupplierBranding } from "../../utils/supplierWhiteLabel";
import { englishOnly, englishLines } from "../../utils/englishOnly";
import { toZar } from "./fx";
import type { SupplierHit, SupplierProduct, SupplierShipping } from "./types";

export interface SourcedHit {
  ref: string;
  title: string;
  image: string | null;
  fromCostZar: number;       // unit cost before delivery, rounded up
  orders: number | null;
  rating: number | null;
}

export interface SourcedVariant { ref: string; label: string; baseCostZar: number; stock: number; inStock: boolean; image: string | null }

export interface SourcedProduct {
  ref: string;
  title: string;
  description: string;
  images: string[];
  variants: SourcedVariant[];
  baseCostZar: number;        // cheapest option, delivered to South Africa
  deliveryZar: number | null; // included in baseCostZar
  delivery: { minDays: number | null; maxDays: number | null };
  category: string | null;
  available: boolean;
}

export interface PriceOptions { rates: Map<string, number>; fxBufferPct: number }

/** Supplier amount -> rand, with a small buffer for exchange-rate movement, rounded up. */
export function zar(amount: number, currency: string, o: PriceOptions): number | null {
  const v = toZar(amount, currency, o.rates);
  return v === null ? null : Math.ceil(v * (1 + o.fxBufferPct / 100));
}

export const photo = (url: string | null | undefined): string | null =>
  url && isSupplierImageUrl(url) ? `/api/marketplace/media/s/${seal({ u: url })}` : null;

const URL_RE = /\b(?:https?:\/\/|www\.)\S+/gi;
const HAS_URL = /\b(?:https?:\/\/|www\.)\S+/i;

export function cleanTitle(s: string): string {
  return scrubSupplierBranding(englishOnly(s.replace(URL_RE, ""))).replace(/\s{2,}/g, " ").trim().slice(0, 150);
}

export function cleanDescription(s: string): string {
  // Whole sentences that name a supplier or carry a link go ("Visit our store at ...").
  const kept = s.replace(/\r\n?/g, "\n").split("\n")
    .map(line => line.split(/(?<=[.!?])\s+/).filter(sentence => !HAS_URL.test(sentence) && !mentionsSupplier(sentence)).join(" ").trim())
    .filter(Boolean)
    .join("\n");
  return englishLines(kept).slice(0, 4000);
}

export function normalizeHit(adapter: string, h: SupplierHit, o: PriceOptions): SourcedHit | null {
  const cost = zar(h.cost, h.currency, o);
  const title = cleanTitle(h.title);
  if (cost === null || !title) return null;
  return { ref: seal({ a: adapter, id: h.externalId }), title, image: photo(h.image), fromCostZar: cost, orders: h.orders, rating: h.rating };
}

export function normalizeProduct(adapter: string, p: SupplierProduct, shipping: SupplierShipping | null, o: PriceOptions): SourcedProduct {
  const delivery = shipping ? zar(shipping.cost, shipping.currency, o) : null;
  const variants: SourcedVariant[] = p.variants.map(v => {
    const unit = zar(v.cost, p.currency, o) ?? 0;
    return {
      ref: seal({ a: adapter, id: p.externalId, sku: v.externalSku }),
      label: cleanTitle(v.label) || "Default",
      baseCostZar: unit + (delivery ?? 0),
      stock: Math.max(0, Math.floor(v.stock)),
      inStock: v.stock > 0,
      image: photo(v.image),
    };
  }).filter(v => v.baseCostZar > 0);
  const images = p.images.map(photo).filter((x): x is string => Boolean(x));
  return {
    ref: seal({ a: adapter, id: p.externalId }),
    title: cleanTitle(p.title),
    description: cleanDescription(p.description),
    images,
    variants,
    baseCostZar: variants.length ? Math.min(...variants.map(v => v.baseCostZar)) : 0,
    deliveryZar: delivery,
    delivery: { minDays: shipping?.minDays ?? null, maxDays: shipping?.maxDays ?? null },
    category: p.category ? cleanTitle(p.category) : null,
    available: p.available && variants.some(v => v.inStock),
  };
}
