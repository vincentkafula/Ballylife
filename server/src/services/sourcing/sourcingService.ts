/**
 * Seller sourcing: the only way the app asks suppliers for products.
 *
 *  - Asks every supplier that is switched on (sourcing_suppliers) and
 *    configured, and merges the results into one white-labelled list.
 *  - Caches supplier answers (sourcing_cache, default 24h) so the same
 *    search/product isn't fetched from the supplier again.
 *  - Writes a ledger row (supplier_api_calls) for every live call AND every
 *    cache answer, with who asked, so spend and quota use can be audited.
 *
 * Only sellers and managers reach this (routes check roles); buyers browsing
 * the shop never trigger a supplier call. The cache holds raw supplier data
 * server-side; everything returned is normalised by normalize.ts.
 */
import { createHash } from "crypto";
import { pool } from "../../db/pool";
import { logger } from "../../utils/logger";
import { unseal } from "../../utils/sealed";
import { ADAPTERS, adapterFor } from "./adapters";
import { loadFxRates } from "./fx";
import { normalizeHit, normalizeProduct, cleanTitle, cleanDescription, type SourcedHit, type SourcedProduct, type PriceOptions } from "./normalize";
import { categorizeProduct } from "../../utils/productCategorizer";
import { isSupplierImageUrl } from "../../utils/supplierWhiteLabel";
import type { ExternalVariant } from "../../utils/cjVariants";
import type { SourcingEndpoint, SourcingQuery, SupplierAdapter, SupplierHit, SupplierProduct, SupplierShipping } from "./types";

export interface Caller { userId: string | null; sellerId: string | null }

export const SETTING_DEFAULTS = {
  cacheHours: 24,
  fxBufferPct: 3,   // added to converted supplier costs to absorb exchange-rate movement
} as const;
type SettingKey = keyof typeof SETTING_DEFAULTS;

export async function getSetting<K extends SettingKey>(key: K): Promise<(typeof SETTING_DEFAULTS)[K]> {
  try {
    const { rows } = await pool!.query(`SELECT value FROM sourcing_settings WHERE key = $1`, [key]);
    const v = rows[0]?.value;
    return (v === undefined || v === null ? SETTING_DEFAULTS[key] : v) as (typeof SETTING_DEFAULTS)[K];
  } catch { return SETTING_DEFAULTS[key]; }
}

export async function setSetting(key: SettingKey, value: unknown): Promise<void> {
  await pool!.query(
    `INSERT INTO sourcing_settings (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(value)]);
}

// ── Suppliers on/off ───────────────────────────────────────────────────────
export interface SupplierState { key: string; enabled: boolean; configured: boolean; orderMode: string }

export async function supplierStates(): Promise<SupplierState[]> {
  const { rows } = await pool!.query(`SELECT key, enabled, order_mode FROM sourcing_suppliers`);
  const saved = new Map(rows.map((r: { key: string; enabled: boolean; order_mode: string }) => [r.key, r]));
  return Promise.all(ADAPTERS.map(async a => {
    const row = saved.get(a.key);
    let configured = false;
    try { configured = await a.isConfigured(); } catch { /* not configured */ }
    return { key: a.key, enabled: row ? row.enabled : true, configured, orderMode: row?.order_mode === "approval" ? "approval" : "auto" };
  }));
}

export async function setSupplierEnabled(key: string, enabled: boolean): Promise<void> {
  if (!adapterFor(key)) throw new Error("Unknown supplier");
  await pool!.query(
    `INSERT INTO sourcing_suppliers (key, enabled, order_mode, updated_at) VALUES ($1, $2, 'auto', now())
     ON CONFLICT (key) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now()`, [key, enabled]);
}

async function activeAdapters(): Promise<SupplierAdapter[]> {
  const states = await supplierStates();
  return ADAPTERS.filter(a => states.some(s => s.key === a.key && s.enabled && s.configured));
}

// ── Ledger ─────────────────────────────────────────────────────────────────
async function ledger(a: SupplierAdapter, endpoint: SourcingEndpoint, who: Caller, cached: boolean, started: number, error?: unknown) {
  try {
    await pool!.query(
      `INSERT INTO supplier_api_calls (adapter, endpoint, user_id, seller_id, cached, ok, error, cost_estimate, duration_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [a.key, endpoint, who.userId, who.sellerId, cached, !error, error ? String((error as Error)?.message ?? error).slice(0, 500) : null,
       cached ? 0 : (a.costPerCall[endpoint] ?? 0), Date.now() - started]);
  } catch (err) { logger.warn("sourcing: ledger write failed", { error: String(err) }); }
}

// ── Cache ──────────────────────────────────────────────────────────────────
const cacheKey = (adapter: string, kind: string, input: unknown) =>
  createHash("sha256").update(JSON.stringify([adapter, kind, input])).digest("hex");

/** Cached call: a hit is served from sourcing_cache; a miss calls the supplier and stores the answer. */
async function cached<T>(a: SupplierAdapter, endpoint: SourcingEndpoint, kind: "search" | "product" | "shipping", input: unknown, who: Caller, call: () => Promise<T>): Promise<T> {
  const key = cacheKey(a.key, kind, input);
  const started = Date.now();
  const { rows } = await pool!.query(`SELECT payload FROM sourcing_cache WHERE key = $1 AND expires_at > $2`, [key, new Date()]);
  if (rows.length) {
    await pool!.query(`UPDATE sourcing_cache SET hits = hits + 1 WHERE key = $1`, [key]);
    await ledger(a, endpoint, who, true, started);
    return rows[0].payload as T;
  }
  let value: T;
  try { value = await call(); }
  catch (err) { await ledger(a, endpoint, who, false, started, err); throw err; }
  await ledger(a, endpoint, who, false, started);
  const hours = Number(await getSetting("cacheHours")) || SETTING_DEFAULTS.cacheHours;
  await pool!.query(
    `INSERT INTO sourcing_cache (key, adapter, kind, payload, expires_at) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (key) DO UPDATE SET payload = EXCLUDED.payload, created_at = now(), expires_at = EXCLUDED.expires_at, hits = 0`,
    [key, a.key, kind, JSON.stringify(value ?? null), new Date(Date.now() + hours * 3600_000)]);
  return value;
}

async function priceOptions(): Promise<PriceOptions> {
  return { rates: await loadFxRates(), fxBufferPct: Number(await getSetting("fxBufferPct")) || 0 };
}

// ── Public API ─────────────────────────────────────────────────────────────
export class SourcingUnavailableError extends Error {}

export async function searchSourcing(q: SourcingQuery, who: Caller): Promise<SourcedHit[]> {
  const keyword = String(q.keyword ?? "").trim().slice(0, 100);
  if (keyword.length < 2) return [];
  const adapters = await activeAdapters();
  if (!adapters.length) throw new SourcingUnavailableError("Product sourcing isn't available right now.");
  const input = { keyword: keyword.toLowerCase(), category: q.category ?? null, page: Math.max(1, Math.min(10, Number(q.page) || 1)) };
  const o = await priceOptions();

  const perAdapter = await Promise.all(adapters.map(async a => {
    try {
      const hits = await cached<SupplierHit[]>(a, "search", "search", input, who,
        () => a.search({ keyword, ...(q.category ? { category: q.category } : {}), page: input.page }));
      return (hits ?? []).map(h => normalizeHit(a.key, h, o)).filter((h): h is SourcedHit => h !== null);
    } catch (err) {
      logger.warn("sourcing: search failed", { adapter: a.key, error: String((err as Error)?.message ?? err) });
      return [];
    }
  }));

  // Interleave so no single supplier dominates the first page.
  const merged: SourcedHit[] = [];
  for (let i = 0; perAdapter.some(list => i < list.length); i++) for (const list of perAdapter) if (list[i]) merged.push(list[i]);
  return merged.filter(h =>
    (q.minPriceZar === undefined || h.fromCostZar >= q.minPriceZar) &&
    (q.maxPriceZar === undefined || h.fromCostZar <= q.maxPriceZar));
}

/** Server-only: what a sealed ref points at. */
export function openRef(ref: string): { adapter: SupplierAdapter; externalId: string; externalSku?: string } | null {
  const v = unseal<{ a?: string; id?: string; sku?: string }>(ref);
  const adapter = v?.a ? adapterFor(v.a) : undefined;
  if (!adapter || !v?.id) return null;
  return { adapter, externalId: v.id, ...(v.sku ? { externalSku: v.sku } : {}) };
}

interface RawProduct { a: SupplierAdapter; externalId: string; product: SupplierProduct; shipping: SupplierShipping | null }

async function loadRaw(ref: string, who: Caller): Promise<RawProduct | null> {
  const opened = openRef(ref);
  if (!opened) return null;
  const { adapter: a, externalId } = opened;
  const states = await supplierStates();
  if (!states.some(s => s.key === a.key && s.enabled && s.configured)) throw new SourcingUnavailableError("This product isn't available right now.");

  const product = await cached<SupplierProduct>(a, "getProduct", "product", { id: externalId }, who, () => a.getProduct(externalId));
  // Delivery quote for the cheapest variant (CJ quotes per variant).
  const cheapest = [...product.variants].sort((x, y) => x.cost - y.cost)[0];
  let shipping: SupplierShipping | null = null;
  try {
    shipping = await cached<SupplierShipping | null>(a, "getShipping", "shipping", { id: externalId, sku: cheapest?.externalSku ?? null }, who,
      () => a.getShipping(externalId, cheapest?.externalSku));
  } catch (err) { logger.warn("sourcing: shipping quote failed", { adapter: a.key, error: String((err as Error)?.message ?? err) }); }
  return { a, externalId, product, shipping };
}

export async function getSourcedProduct(ref: string, who: Caller): Promise<SourcedProduct | null> {
  const raw = await loadRaw(ref, who);
  return raw ? normalizeProduct(raw.a.key, raw.product, raw.shipping, await priceOptions()) : null;
}

const MAX_LISTING_STOCK = 100;
const FALLBACK_CATEGORY = process.env.CJ_DEFAULT_CATEGORY_ID || "cat-03";

/**
 * Files a sourced product in Ballylife's supplier catalogue (once; later
 * imports reuse the row) so a seller can list it and the existing CJ /
 * AliExpress fulfilment workers can order it. Returns the catalogue id and
 * the rand base cost the seller's price must cover.
 */
export async function fileInCatalogue(ref: string, who: Caller): Promise<{ supplierProductId: string; product: SourcedProduct; stock: number }> {
  const raw = await loadRaw(ref, who);
  if (!raw) throw new SourcingUnavailableError("This product couldn't be found. Search again and pick it from the results.");
  const { a, externalId, product: p, shipping } = raw;
  const sourced = normalizeProduct(a.key, p, shipping, await priceOptions());
  const inStock = p.variants.filter(v => v.stock > 0);
  if (!sourced.available || !inStock.length) throw new SourcingUnavailableError("This product is out of stock right now.");
  if (!shipping) throw new SourcingUnavailableError("This product can't be delivered to South Africa right now.");
  const images = p.images.filter(isSupplierImageUrl);
  if (!images.length || !sourced.title) throw new SourcingUnavailableError("This product can't be listed (no usable photos or name).");

  const { supplierId, source, ensureSupplier } = a.catalogue;
  const { rows: existing } = await pool!.query(
    `SELECT id, status FROM mkt_supplier_products WHERE supplier_id = $1 AND external_id = $2`, [supplierId, externalId]);
  const stock = Math.min(MAX_LISTING_STOCK, inStock.reduce((n, v) => n + v.stock, 0));
  if (existing.length) {
    if (existing[0].status === "inactive") throw new SourcingUnavailableError("This product isn't available on Ballylife.");
    if (existing[0].status !== "active") await pool!.query(`UPDATE mkt_supplier_products SET status = 'active', updated_at = now() WHERE id = $1`, [existing[0].id]);
    return { supplierProductId: existing[0].id, product: sourced, stock };
  }

  await ensureSupplier();
  const { rows: catRows } = await pool!.query(`SELECT id FROM mkt_categories`);
  const known = new Set(catRows.map((r: { id: string }) => r.id));
  const categoryId = categorizeProduct(sourced.title, [p.category], known, FALLBACK_CATEGORY) ?? (known.has(FALLBACK_CATEGORY) ? FALLBACK_CATEGORY : null);
  const cheapest = [...inStock].sort((x, y) => x.cost - y.cost)[0];
  const variants: ExternalVariant[] = inStock.map(v => ({
    vid: v.orderRef ?? v.externalSku, key: cleanTitle(v.label) || "Default", priceUsd: v.cost, ...(v.image && isSupplierImageUrl(v.image) ? { image: v.image } : {}),
  }));
  const { rows } = await pool!.query(
    `INSERT INTO mkt_supplier_products (supplier_id, category_id, name, description, cost_price, currency, retail_price, moq, images, origin_country, status,
       external_source, external_id, external_variants, est_shipping_usd)
     VALUES ($1,$2,$3,$4,$5,$6,$7,1,$8,'CN','active',$9,$10,$11,$12) RETURNING id`,
    [supplierId, categoryId, sourced.title, cleanDescription(p.description), cheapest.cost, p.currency, sourced.baseCostZar, JSON.stringify(images),
     source, externalId, JSON.stringify(variants), shipping.currency === "USD" ? shipping.cost : null]);
  logger.info("sourcing.catalogue_item_created", { adapter: a.key, supplierProductId: rows[0].id });
  return { supplierProductId: rows[0].id, product: sourced, stock };
}

/** Manager dashboard: calls and cache use over the last N days. */
export async function usageSummary(days = 7) {
  const since = new Date(Date.now() - days * 86400_000);
  const { rows } = await pool!.query(
    `SELECT adapter, endpoint, cached, ok, COUNT(*)::int AS calls, COALESCE(SUM(cost_estimate), 0) AS cost
     FROM supplier_api_calls WHERE created_at > $1 GROUP BY adapter, endpoint, cached, ok ORDER BY adapter, endpoint`, [since]);
  return rows.map((r: any) => ({ adapter: r.adapter, endpoint: r.endpoint, cached: r.cached, ok: r.ok, calls: Number(r.calls), costUsd: Number(r.cost) }));
}

/** Housekeeping: drop expired cache rows. */
export async function pruneSourcingCache(): Promise<number> {
  const r = await pool!.query(`DELETE FROM sourcing_cache WHERE expires_at < $1`, [new Date()]);
  return r.rowCount ?? 0;
}
