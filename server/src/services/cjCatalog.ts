import { pool } from "../db/pool";
import { logger } from "../utils/logger";
import { convertToZar, round2 } from "../utils/pricing";
import {
  isCjConfigured, listCjProducts, getCjProductDetail, calculateCjFreight, getCjCategories, isCjPointsError, type CjPointsError,
  type CjProductSummary, type CjProductDetail,
} from "./cjDropshippingClient";
import { dedupeImages, isPhotoUrl, parseSupplierImageList, scrubSupplierBranding, splitSupplierDescription } from "../utils/supplierWhiteLabel";
import { variantIdForVid, type ExternalVariant } from "../utils/cjVariants";
import { matchCjCategory, resolveCategory, isExcludedFromStore } from "../utils/cjCategoryMap";

/**
 * CJ catalogue -> our own database -> storefront.
 *
 * Every synced CJ product lands in mkt_supplier_products (the catalogue
 * sellers browse). Products with real photos, a known shipping cost and at
 * least one orderable variant are also listed straight away in the
 * platform's own "Ballylife" store at landed cost x (1 + CJ_MARKUP_PCT).
 * Search and browsing only ever read our database, never CJ live.
 */

export const CJ_SUPPLIER_ID = "sup-cjdropshipping";
export const HOUSE_SELLER_ID = "sel-ballylife";
const MARKUP = (Number(process.env.CJ_MARKUP_PCT ?? 50) || 0) / 100;
const PRICING_COUNTRY = (process.env.CJ_PRICING_COUNTRY || "ZA").toUpperCase();
const FROM_COUNTRY = (process.env.CJ_FROM_COUNTRY || "CN").toUpperCase();
const DEFAULT_CATEGORY = process.env.CJ_DEFAULT_CATEGORY_ID || "cat-03";
const INITIAL_SYNC_PAGES = Number(process.env.CJ_INITIAL_SYNC_PAGES ?? 5);
const MAX_STOCK = 999;

type Row = Record<string, any>;

export async function ensureCjSupplierExists(): Promise<void> {
  await pool!.query(
    `INSERT INTO mkt_suppliers (id, name, country, platform, dropship_supported, verified, status)
     VALUES ($1, 'CJdropshipping', 'CN', 'CJdropshipping', true, true, 'active')
     ON CONFLICT (id) DO NOTHING`,
    [CJ_SUPPLIER_ID]
  );
}

export async function ensureHouseStore(): Promise<void> {
  await pool!.query(
    `INSERT INTO mkt_sellers (id, store_name, store_slug, description, country, status, kyc_verified, commission_pct)
     VALUES ($1, 'Ballylife', 'ballylife', 'Official Ballylife store — quality products shipped to your door.', 'ZA', 'active', true, 0)
     ON CONFLICT DO NOTHING`,
    [HOUSE_SELLER_ID]
  );
}

// ── Category mapping (rules live in utils/cjCategoryMap.ts) ───────────────

/** Our category id for a CJ category/product name, most specific first. Defaults to CJ_DEFAULT_CATEGORY_ID. */
export function mapCjCategory(...levels: (string | undefined)[]): string {
  return matchCjCategory(...levels)?.fine ?? DEFAULT_CATEGORY;
}

/** CJ list prices are sometimes a range ("3.25 -- 5.10"); the lowest is the base. */
export function parseCjPrice(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const nums = String(value ?? "").match(/\d+(?:\.\d+)?/g)?.map(Number).filter(Number.isFinite) ?? [];
  return nums.length ? Math.min(...nums) : null;
}

// ── One product ──────────────────────────────────────────────────────────

export interface WhiteLabelledProduct {
  name: string; description: string; images: string[]; variants: ExternalVariant[];
  stock: number | null; cjCategoryName: string; detailOk: boolean;
  /** CJ's product video references (features=enable_video), as CJ returns them. */
  videos: string[];
}

/**
 * The list endpoint only returns one thumbnail per product; the real
 * gallery (main shots, per-variant shots, and the detail photos embedded
 * in the description HTML) and the variant ids needed to order are only on
 * /product/query. If that call fails the product still syncs with the list
 * thumbnail, but can't be listed or ordered until a later sync succeeds.
 *
 * Names and descriptions are scrubbed of supplier branding here, before
 * they reach the database, so no later code path can leak them.
 */
export async function buildWhiteLabelledProduct(p: CjProductSummary): Promise<WhiteLabelledProduct> {
  const fallbackName = scrubSupplierBranding(p.productNameEn || p.productName);
  try {
    const d: CjProductDetail = await getCjProductDetail(p.pid);
    const desc = splitSupplierDescription(d.description);
    const images = dedupeImages([
      ...parseSupplierImageList(d.productImageSet),
      ...parseSupplierImageList(d.productImage),
      ...parseSupplierImageList(p.productImage),
      ...(d.variants ?? []).map(v => v.variantImage).filter(isPhotoUrl),
      ...desc.imageUrls,
    ]);
    const baseUsd = parseCjPrice(p.sellPrice) ?? 0;
    const variants: ExternalVariant[] = (d.variants ?? []).filter(v => v.vid).map(v => ({
      vid: v.vid,
      key: scrubSupplierBranding(v.variantKey || v.variantNameEn || "") || "Standard",
      priceUsd: parseCjPrice(v.variantSellPrice) ?? baseUsd,
      ...(isPhotoUrl(v.variantImage) ? { image: v.variantImage } : {}),
    }));
    const inventories = (d.variants ?? []).flatMap(v => v.inventories ?? []);
    const stock = inventories.length ? Math.min(MAX_STOCK, inventories.reduce((n, i) => n + (Number(i.totalInventory) || 0), 0)) : null;
    return {
      name: scrubSupplierBranding(d.productNameEn || d.productName) || fallbackName,
      description: desc.text || scrubSupplierBranding(p.remark),
      images, variants, stock,
      cjCategoryName: d.categoryName ?? p.categoryName ?? "",
      videos: parseVideoList(d.productVideo, p.pid),
      detailOk: true,
    };
  } catch (err) {
    if (isCjPointsError(err)) throw err; // out of points: stop the page, don't save a half-fetched product
    logger.warn("cj.product_detail_fallback", { pid: p.pid, error: err instanceof Error ? err.message : String(err) });
    return {
      name: fallbackName, description: scrubSupplierBranding(p.remark), images: parseSupplierImageList(p.productImage),
      variants: [], stock: null, cjCategoryName: p.categoryName ?? "", detailOk: false, videos: [],
    };
  }
}

let videoSampleLogged = false;

/** CJ documents productVideo as a "video ID list"; accept an array, JSON string or comma list. */
function parseVideoList(value: unknown, pid: string): string[] {
  let list: string[] = [];
  if (Array.isArray(value)) list = value.map(String);
  else if (typeof value === "string" && value.trim()) {
    const v = value.trim();
    try { list = v.startsWith("[") ? (JSON.parse(v) as unknown[]).map(String) : v.split(","); } catch { list = v.split(","); }
  }
  list = list.map(x => x.trim()).filter(Boolean).slice(0, 5);
  // Logged once so the format (bare ids vs playable URLs) can be confirmed
  // against live data before the storefront starts rendering videos.
  if (list.length && !videoSampleLogged) { videoSampleLogged = true; logger.info("cj.video_sample", { pid, sample: list[0].slice(0, 200) }); }
  return list;
}

/** CJ's cheapest shipping quote (USD) for one unit to the pricing country, or null if unavailable. */
async function estimateShipping(vid: string | undefined): Promise<{ usd: number; logisticName: string } | null> {
  if (!vid) return null;
  try {
    const options = await calculateCjFreight({ startCountryCode: FROM_COUNTRY, endCountryCode: PRICING_COUNTRY, products: [{ vid, quantity: 1 }] });
    const valid = (options ?? []).filter(o => o.logisticName && Number.isFinite(Number(o.logisticPrice)) && Number(o.logisticPrice) >= 0);
    if (!valid.length) return null;
    const cheapest = valid.reduce((a, b) => (Number(b.logisticPrice) < Number(a.logisticPrice) ? b : a));
    return { usd: Number(cheapest.logisticPrice), logisticName: cheapest.logisticName };
  } catch (err) {
    if (isCjPointsError(err)) throw err;
    logger.warn("cj.freight_estimate_failed", { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

// ── One page ─────────────────────────────────────────────────────────────

export interface PageResult {
  imported: number; updated: number; skippedNoRate: number; withPhotos: number; detailFailures: number; listed: number; skippedFresh: number; excluded: number; withVideo: number;
  listedPricesZar: number[];
  totalAvailable: number; pageNum: number; pageSize: number;
}

export async function syncCjPage(opts: {
  pageNum: number; pageSize: number; categoryId?: string;
  /** CJ's own names for `categoryId`, most specific first -- authoritative when given (the category sweep passes it). */
  categoryPath?: string[];
  /** Skip the detail + freight calls for products synced within this many hours (saves CJ quota during big sweeps). */
  skipFreshHours?: number;
  /** Search CJ by English product name instead of browsing a category. */
  keyword?: string;
}): Promise<PageResult> {
  const result = await listCjProducts({ pageNum: opts.pageNum, pageSize: opts.pageSize, categoryId: opts.categoryId, productNameEn: opts.keyword });
  await ensureCjSupplierExists();
  await ensureHouseStore();

  const { rows: fxRows } = await pool!.query(`SELECT * FROM mkt_fx_rates`);
  const usdToZar = convertToZar(1, "USD", new Map(fxRows.map((r: { currency: string; rate_to_zar: string }) => [r.currency, Number(r.rate_to_zar)])));

  const { rows: catRows } = await pool!.query(`SELECT id FROM mkt_categories`);
  const knownCategories = new Set(catRows.map((r: { id: string }) => r.id));
  const pathCategory = opts.categoryPath?.length ? resolveCategory(matchCjCategory(...opts.categoryPath), knownCategories, DEFAULT_CATEGORY) : null;
  const freshSince = opts.skipFreshHours ? new Date(Date.now() - opts.skipFreshHours * 3600_000) : null;

  const counts = { imported: 0, updated: 0, skippedNoRate: 0, withPhotos: 0, detailFailures: 0, listed: 0, skippedFresh: 0, excluded: 0, withVideo: 0 };
  const listedPricesZar: number[] = [];
  for (const p of result.list ?? []) {
    if (usdToZar === null) { counts.skippedNoRate++; continue; } // no USD rate on file -- flagged, never guessed
    const costUsd = parseCjPrice(p.sellPrice);
    if (costUsd === null) continue;
    if (isExcludedFromStore(p.productNameEn, p.categoryName, ...(opts.categoryPath ?? []))) { counts.excluded++; continue; }

    const { rows: existing } = await pool!.query(
      `SELECT id, updated_at FROM mkt_supplier_products WHERE supplier_id = $1 AND external_id = $2`, [CJ_SUPPLIER_ID, p.pid]
    );
    if (existing.length && freshSince && new Date(existing[0].updated_at) > freshSince) {
      // Recently synced -- no CJ calls. Just file it under the sweep's category.
      if (pathCategory) await setCategory(existing[0].id, pathCategory);
      counts.skippedFresh++;
      continue;
    }

    const w = await buildWhiteLabelledProduct(p);
    if (!w.detailOk) counts.detailFailures++;
    if (w.images.length) counts.withPhotos++;
    if (w.videos.length) counts.withVideo++;

    const shipping = w.detailOk ? await estimateShipping(w.variants[0]?.vid) : null;
    const shippingUsd = shipping?.usd ?? null;
    // What sellers see as the base price they mark up from: landed cost
    // (goods + shipping) when CJ quoted shipping, goods only otherwise.
    const baseZar = round2((costUsd + (shippingUsd ?? 0)) * usdToZar);
    const categoryId = pathCategory ?? resolveCategory(matchCjCategory(w.cjCategoryName, w.name), knownCategories, DEFAULT_CATEGORY);
    const listable = categoryId !== null && w.detailOk && w.images.length > 0 && w.variants.length > 0 && shippingUsd !== null;

    let supplierProductId: string;
    if (existing.length) {
      supplierProductId = existing[0].id;
      // GREATEST: a cost increase raises the floor, but a re-sync never
      // wipes out a price a manager has already marked up by hand.
      await pool!.query(
        `UPDATE mkt_supplier_products SET name = $1, description = $2, cost_price = $3, retail_price = GREATEST(retail_price, $4::numeric),
           images = $5, category_id = COALESCE(category_id, $6), est_shipping_usd = COALESCE($7, est_shipping_usd), est_logistic_name = COALESCE($9, est_logistic_name), updated_at = now()
         WHERE id = $8`,
        [w.name, w.description, costUsd, baseZar, JSON.stringify(w.images), categoryId, shippingUsd, supplierProductId, shipping?.logisticName ?? null]
      );
      if (pathCategory) await setCategory(supplierProductId, pathCategory);
      // Only overwrite variants from a successful detail call -- a failed
      // one must never wipe the vids that live orders depend on.
      if (w.detailOk && w.variants.length) {
        await pool!.query(`UPDATE mkt_supplier_products SET external_variants = $1, videos = $2 WHERE id = $3`, [JSON.stringify(w.variants), JSON.stringify(w.videos), supplierProductId]);
      }
      // Seller listings copied the catalogue photos at import time -- keep them on CJ's current set.
      if (w.images.length) {
        await pool!.query(`UPDATE mkt_products SET images = $1, updated_at = now() WHERE supplier_product_id = $2`, [JSON.stringify(w.images), supplierProductId]);
      }
      counts.updated++;
    } else {
      const { rows } = await pool!.query(
        `INSERT INTO mkt_supplier_products (supplier_id, category_id, name, description, cost_price, currency, retail_price, moq, images, origin_country, status,
           external_source, external_id, external_variants, est_shipping_usd, videos, est_logistic_name)
         VALUES ($1,$2,$3,$4,$5,'USD',$6,1,$7,'CN','pending_review','cjdropshipping',$8,$9,$10,$11,$12) RETURNING id`,
        [CJ_SUPPLIER_ID, categoryId, w.name, w.description, costUsd, baseZar, JSON.stringify(w.images), p.pid, JSON.stringify(w.variants), shippingUsd, JSON.stringify(w.videos), shipping?.logisticName ?? null]
      );
      supplierProductId = rows[0].id;
      counts.imported++;
    }

    if (listable) {
      listedPricesZar.push(await listInHouseStore(supplierProductId, { ...w, costUsd, shippingUsd: shippingUsd!, usdToZar, categoryId: categoryId! }));
      counts.listed++;
    }
  }

  logger.info("cj.sync_page", { pageNum: opts.pageNum, pageSize: opts.pageSize, cjCategoryId: opts.categoryId, keyword: opts.keyword, ...counts });
  return { ...counts, listedPricesZar, totalAvailable: Number(result.total ?? 0), pageNum: Number(result.pageNum ?? opts.pageNum), pageSize: Number(result.pageSize ?? opts.pageSize) };
}

/** Files a catalogue item (and the Ballylife listing of it) under a category. Sellers' own listings keep theirs. */
async function setCategory(supplierProductId: string, categoryId: string): Promise<void> {
  await pool!.query(`UPDATE mkt_supplier_products SET category_id = $1 WHERE id = $2`, [categoryId, supplierProductId]);
  await pool!.query(`UPDATE mkt_products SET category_id = $1 WHERE supplier_product_id = $2 AND seller_id = $3`, [categoryId, supplierProductId, HOUSE_SELLER_ID]);
}

/**
 * Puts one CJ product live in the Ballylife store (or refreshes it). The
 * house store's price always follows CJ: landed cost x (1 + markup),
 * rounded up to the next whole rand. The catalogue item is marked active
 * so sellers can add it to their own stores too.
 */
async function listInHouseStore(supplierProductId: string, w: WhiteLabelledProduct & { costUsd: number; shippingUsd: number; usdToZar: number; categoryId: string }): Promise<number> {
  const factor = w.usdToZar * (1 + MARKUP);
  const price = Math.ceil((w.costUsd + w.shippingUsd) * factor);
  const variants = w.variants.length > 1
    ? w.variants.map(v => ({
        id: variantIdForVid(v.vid), type: "Option", value: v.key, sku: null, stock: w.stock ?? 100,
        additionalPrice: Math.max(0, Math.ceil((v.priceUsd - w.costUsd) * factor)),
      }))
    : [];
  const stock = w.stock ?? 100;
  const shortDescription = w.description.split("\n")[0].slice(0, 160);

  await pool!.query(`UPDATE mkt_supplier_products SET status = 'active' WHERE id = $1 AND status = 'pending_review'`, [supplierProductId]);

  const { rows: existing } = await pool!.query(
    `SELECT id FROM mkt_products WHERE seller_id = $1 AND supplier_product_id = $2`, [HOUSE_SELLER_ID, supplierProductId]
  );
  if (existing.length) {
    await pool!.query(
      `UPDATE mkt_products SET name = $1, description = $2, short_description = $3, price = $4, images = $5, variants = $6, stock = $7, category_id = $8, delivery_profile = 'international', updated_at = now()
       WHERE id = $9`,
      [w.name, w.description, shortDescription, price, JSON.stringify(w.images), JSON.stringify(variants), stock, w.categoryId, existing[0].id]
    );
    return price;
  }
  const slug = `${w.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 80)}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  await pool!.query(
    `INSERT INTO mkt_products (seller_id, category_id, name, slug, short_description, description, price, currency, images, emoji, status, stock,
       brand, variants, fulfillment_type, supplier_product_id, delivery_profile)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'ZAR',$8,'📦','active',$9,'Ballylife',$10,'imported',$11,'international')`,
    [HOUSE_SELLER_ID, w.categoryId, w.name, slug, shortDescription, w.description, price, JSON.stringify(w.images), stock, JSON.stringify(variants), supplierProductId]
  );
  return price;
}

// ── Hide the generated demo catalogue, once ────────────────────────────────

const HIDE_DEMO_FLAG = "hide_products_without_photos_v1";

/**
 * Takes every product with no real photo (the generated demo catalogue:
 * colour swatches + emoji) off the storefront -- once, and only after real
 * products are live, so the shop is never left empty. Nothing is deleted;
 * `UPDATE mkt_products SET status = 'active' WHERE status = 'inactive'`
 * reverses it. Returns the number of products hidden, or null if skipped.
 */
export async function hideDemoCatalogOnce(): Promise<number | null> {
  const { rows: flag } = await pool!.query(`SELECT 1 FROM app_flags WHERE key = $1`, [HIDE_DEMO_FLAG]);
  if (flag.length) return null;
  const { rows: live } = await pool!.query(`SELECT COUNT(*)::int AS n FROM mkt_products WHERE seller_id = $1 AND status = 'active'`, [HOUSE_SELLER_ID]);
  if (!live[0].n) return null;

  const { rows } = await pool!.query(
    `UPDATE mkt_products SET status = 'inactive', updated_at = now()
     WHERE status IN ('active', 'out_of_stock') AND images::text NOT LIKE '%"http%' AND images::text NOT LIKE '%"/api/%'
     RETURNING id`
  );
  await pool!.query(`INSERT INTO app_flags (key, detail) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`, [HIDE_DEMO_FLAG, `hid ${rows.length} products`]);
  logger.info("catalog.demo_products_hidden", { count: rows.length });
  return rows.length;
}

// ── Background catalogue sync ─────────────────────────────────────────────

export async function startCatalogSync(opts: { startPage: number; pages: number; pageSize: number; categoryId?: string | null }): Promise<Row> {
  const { rows } = await pool!.query(
    `INSERT INTO cj_sync_jobs (id, status, next_page, end_page, page_size, category_id, totals, total_available, last_error, started_at, finished_at, updated_at)
     VALUES ('catalog', 'running', $1, $2, $3, $4, '{}', NULL, NULL, now(), NULL, now())
     ON CONFLICT (id) DO UPDATE SET status = 'running', next_page = $1, end_page = $2, page_size = $3, category_id = $4,
       totals = '{}', total_available = NULL, last_error = NULL, started_at = now(), finished_at = NULL, updated_at = now()
     RETURNING *`,
    [opts.startPage, opts.startPage + opts.pages - 1, opts.pageSize, opts.categoryId ?? null]
  );
  logger.info("cj.catalog_sync_started", { startPage: opts.startPage, pages: opts.pages, pageSize: opts.pageSize });
  return rows[0];
}

export async function getCatalogSyncJob(): Promise<Row | null> {
  const { rows } = await pool!.query(`SELECT * FROM cj_sync_jobs WHERE id = 'catalog'`);
  return rows[0] ?? null;
}

let lastPauseLogAt = 0;

/** Records a points pause on a job without logging an error every minute. */
async function notePointsPause(jobId: string, err: CjPointsError): Promise<void> {
  const until = err.retryAt.toISOString().slice(11, 16);
  await pool!.query(`UPDATE cj_sync_jobs SET last_error = $1, updated_at = now() WHERE id = $2`,
    [`Paused until about ${until} UTC — pacing to stay within CJ's daily API points. Resumes automatically.`, jobId]);
  if (Date.now() - lastPauseLogAt > 30 * 60_000) { lastPauseLogAt = Date.now(); logger.info("cj.catalog_paused_for_points", { job: jobId, retryAt: err.retryAt.toISOString(), reason: err.message }); }
}

/** Processes one page of a running job. Safe to call often; does nothing when idle. */
export async function runCatalogSyncTick(): Promise<void> {
  let job = await getCatalogSyncJob();

  // First boot with CJ connected and no CJ products yet: fill the store.
  if (!job && INITIAL_SYNC_PAGES > 0) {
    const { rows } = await pool!.query(`SELECT COUNT(*)::int AS n FROM mkt_supplier_products WHERE supplier_id = $1`, [CJ_SUPPLIER_ID]);
    if (!rows[0].n) job = await startCatalogSync({ startPage: 1, pages: INITIAL_SYNC_PAGES, pageSize: 20 });
  }
  if (!job || job.status !== "running") {
    // Nothing manual running: work on the every-category sweep instead.
    try {
      // The sourcing list (targeted products) goes first; the sweep resumes after.
      const sourcing = await maybeAutoStartSourcing();
      if (sourcing?.status === "running") {
        await runSourcingTick(sourcing);
      } else {
        const sweep = await maybeAutoStartSweep(job);
        if (sweep?.status === "running") await runSweepTick(sweep);
      }
    } catch (err) {
      logger.error("cj.sweep_tick_failed", { error: err instanceof Error ? err.message : String(err) });
    }
    await hideDemoCatalogOnce();
    return;
  }

  const page = Number(job.next_page);
  try {
    const r = await syncCjPage({ pageNum: page, pageSize: Number(job.page_size), categoryId: job.category_id ?? undefined });
    const totals = { ...(job.totals ?? {}) } as Record<string, number>;
    for (const k of ["imported", "updated", "listed", "withPhotos", "detailFailures", "skippedNoRate"] as const) totals[k] = (totals[k] ?? 0) + r[k];
    const lastPage = Math.max(1, Math.ceil(r.totalAvailable / Number(job.page_size)));
    const done = page >= Number(job.end_page) || page >= lastPage;
    await pool!.query(
      `UPDATE cj_sync_jobs SET next_page = $1, totals = $2, total_available = $3, status = $4, finished_at = $5, updated_at = now() WHERE id = 'catalog'`,
      [page + 1, JSON.stringify(totals), r.totalAvailable, done ? "done" : "running", done ? new Date() : null]
    );
  } catch (err) {
    if (isCjPointsError(err)) { await notePointsPause("catalog", err); return; }
    // Leave it running; the next tick retries the same page. The CJ client
    // already retried rate limits, so this is an outage or bad credentials.
    const message = err instanceof Error ? err.message : String(err);
    await pool!.query(`UPDATE cj_sync_jobs SET last_error = $1, updated_at = now() WHERE id = 'catalog'`, [message.slice(0, 500)]);
    logger.error("cj.catalog_sync_page_failed", { page, error: message });
  }
  await hideDemoCatalogOnce();
}

let catalogRunning = false;

export function startCjCatalogWorker(intervalMs = 60_000): NodeJS.Timeout | null {
  if (/^(0|false|off|no)$/i.test(process.env.CJ_CATALOG_WORKER ?? "")) return null;
  const tick = async () => {
    if (catalogRunning || !isCjConfigured()) return;
    catalogRunning = true;
    try { await runCatalogSyncTick(); }
    catch (err) { logger.error("cj.catalog_tick_failed", { error: err instanceof Error ? err.message : String(err) }); }
    finally { catalogRunning = false; }
  };
  const timer = setInterval(() => { void tick(); }, intervalMs);
  timer.unref();
  setTimeout(() => { void tick(); }, 5_000).unref(); // don't wait a full minute after deploy
  logger.info("cj.catalog_worker_started", { intervalMs, markupPct: MARKUP * 100, pricingCountry: PRICING_COUNTRY });
  return timer;
}

// ── Every-category sweep ────────────────────────────────────────────────────
// Walks CJ's whole category tree breadth-first: page 1 of every leaf
// category, then page 2 of every leaf, and so on up to pages_per_category.
// That fills every storefront category within the first pass instead of
// exhausting one category before starting the next. Leaves are interleaved
// round-robin by the storefront category they map to, so even the first
// hour touches every department. Runs as its own job row ('sweep') so a
// manual page sync never clobbers it, and restarts every CJ_RESWEEP_DAYS to
// pick up new CJ products and refresh prices/stock.

const SWEEP_PAGES_PER_CATEGORY = Number(process.env.CJ_SWEEP_PAGES_PER_CATEGORY ?? 5);
const RESWEEP_DAYS = Number(process.env.CJ_RESWEEP_DAYS ?? 7);
const TICK_BUDGET_MS = 50_000;
// Products synced within this many days aren't re-fetched by the sweep: every
// re-fetch costs CJ API points (about 20 per product) that new products need.
const REFRESH_DAYS = Number(process.env.CJ_REFRESH_DAYS ?? 7);
const SWEEP_PAGE_SIZE = 20;

export interface SweepEntry { id: string; path: string[]; target: string; lastPage?: number }

interface CjCategoryTree {
  categoryFirstName: string;
  categoryFirstList?: { categorySecondName: string; categorySecondList?: { categoryId: string; categoryName: string }[] }[];
}

export function buildSweepPlan(tree: CjCategoryTree[]): SweepEntry[] {
  const groups = new Map<string, SweepEntry[]>();
  for (const first of tree ?? []) {
    for (const second of first.categoryFirstList ?? []) {
      for (const leaf of second.categorySecondList ?? []) {
        const path = [leaf.categoryName, second.categorySecondName, first.categoryFirstName];
        if (!leaf.categoryId || isExcludedFromStore(...path)) continue;
        const target = matchCjCategory(...path)?.fine ?? DEFAULT_CATEGORY;
        if (!groups.has(target)) groups.set(target, []);
        groups.get(target)!.push({ id: leaf.categoryId, path, target });
      }
    }
  }
  // Round-robin across storefront categories.
  const queues = [...groups.values()];
  const plan: SweepEntry[] = [];
  for (let i = 0; queues.some(q => i < q.length); i++) for (const q of queues) if (i < q.length) plan.push(q[i]);
  return plan;
}

export async function startCategorySweep(pagesPerCategory = SWEEP_PAGES_PER_CATEGORY): Promise<Row> {
  const plan = buildSweepPlan((await getCjCategories()) as unknown as CjCategoryTree[]);
  const { rows } = await pool!.query(
    `INSERT INTO cj_sync_jobs (id, mode, status, plan, plan_index, next_page, end_page, page_size, totals, total_available, last_error, started_at, finished_at, updated_at)
     VALUES ('sweep', 'sweep', 'running', $1, 0, 1, $2, $3, '{}', NULL, NULL, now(), NULL, now())
     ON CONFLICT (id) DO UPDATE SET status = 'running', plan = $1, plan_index = 0, next_page = 1, end_page = $2, page_size = $3,
       totals = '{}', total_available = NULL, last_error = NULL, started_at = now(), finished_at = NULL, updated_at = now()
     RETURNING *`,
    [JSON.stringify(plan), Math.max(1, pagesPerCategory), SWEEP_PAGE_SIZE]
  );
  const perTarget: Record<string, number> = {};
  for (const e of plan) perTarget[e.target] = (perTarget[e.target] ?? 0) + 1;
  logger.info("cj.sweep_started", { cjCategories: plan.length, pagesPerCategory, perStorefrontCategory: perTarget });
  return rows[0];
}

export async function getSweepJob(): Promise<Row | null> {
  const { rows } = await pool!.query(`SELECT * FROM cj_sync_jobs WHERE id = 'sweep'`);
  return rows[0] ?? null;
}

/** Advances a running sweep for up to ~50s (as many pages as fit). */
async function runSweepTick(job: Row): Promise<void> {
  const plan: SweepEntry[] = Array.isArray(job.plan) ? job.plan : [];
  let index = Number(job.plan_index);
  let pass = Number(job.next_page);
  const endPass = Number(job.end_page);
  const pageSize = Number(job.page_size);
  const totals = { ...(job.totals ?? {}) } as Record<string, number>;
  const deadline = Date.now() + TICK_BUDGET_MS;
  let done = false;

  while (Date.now() < deadline) {
    if (index >= plan.length) { index = 0; pass++; }
    if (pass > endPass || !plan.length) { done = true; break; }
    const entry = plan[index];
    if (entry.lastPage !== undefined && pass > entry.lastPage) { index++; continue; } // this CJ category has no more pages

    try {
      const r = await syncCjPage({ pageNum: pass, pageSize, categoryId: entry.id, categoryPath: entry.path, skipFreshHours: REFRESH_DAYS * 24 });
      entry.lastPage = Math.max(1, Math.ceil(r.totalAvailable / pageSize));
      for (const k of ["imported", "updated", "listed", "withPhotos", "detailFailures", "skippedFresh", "excluded", "skippedNoRate"] as const) totals[k] = (totals[k] ?? 0) + r[k];
      totals.pages = (totals.pages ?? 0) + 1;
      index++;
      await pool!.query(
        `UPDATE cj_sync_jobs SET plan = $1, plan_index = $2, next_page = $3, totals = $4, last_error = NULL, updated_at = now() WHERE id = 'sweep'`,
        [JSON.stringify(plan), index, pass, JSON.stringify(totals)]
      );
    } catch (err) {
      // Leave the cursor where it is; the next tick retries this page.
      if (isCjPointsError(err)) { await notePointsPause("sweep", err); return; }
      const message = err instanceof Error ? err.message : String(err);
      await pool!.query(`UPDATE cj_sync_jobs SET last_error = $1, updated_at = now() WHERE id = 'sweep'`, [`${entry.path[0]}: ${message}`.slice(0, 500)]);
      logger.error("cj.sweep_page_failed", { cjCategory: entry.path.join(" < "), page: pass, error: message });
      return;
    }
  }

  if (done) {
    await pool!.query(`UPDATE cj_sync_jobs SET status = 'done', finished_at = now(), updated_at = now() WHERE id = 'sweep'`);
    logger.info("cj.sweep_finished", totals);
  }
}

/** Starts the sweep automatically once the first fill is done, and again every CJ_RESWEEP_DAYS after it finishes. */
async function maybeAutoStartSweep(catalogJob: Row | null): Promise<Row | null> {
  if (SWEEP_PAGES_PER_CATEGORY <= 0) return null;
  if (catalogJob?.status === "running") return null; // let the first fill / a manual sync finish first
  const sweep = await getSweepJob();
  if (sweep?.status === "running") return sweep;
  const due = !sweep || (sweep.finished_at && Date.now() - new Date(sweep.finished_at).getTime() > RESWEEP_DAYS * 86400_000);
  return due ? startCategorySweep() : null;
}

// ── CJ-only catalogue enforcement ───────────────────────────────────────────

/**
 * With the CJ-only policy on (utils/catalogPolicy.ts), takes every product
 * and catalogue item that did NOT come from CJ off sale. Runs at boot;
 * idempotent, deletes nothing (status -> 'inactive').
 */
export async function enforceCjOnlyCatalog(): Promise<{ products: number; catalogItems: number }> {
  const { rows: products } = await pool!.query(
    `UPDATE mkt_products SET status = 'inactive', updated_at = now()
     WHERE status IN ('active', 'out_of_stock', 'pending_review')
       AND (supplier_product_id IS NULL
            OR supplier_product_id NOT IN (SELECT id FROM mkt_supplier_products WHERE external_source = 'cjdropshipping'))
     RETURNING id`
  );
  const { rows: items } = await pool!.query(
    `UPDATE mkt_supplier_products SET status = 'inactive', updated_at = now()
     WHERE status <> 'inactive' AND (external_source IS NULL OR external_source <> 'cjdropshipping')
     RETURNING id`
  );
  if (products.length || items.length) logger.info("catalog.cj_only_enforced", { products: products.length, catalogItems: items.length });
  return { products: products.length, catalogItems: items.length };
}

// ── Sourcing list (market-research products, all from CJ) ────────────────
// The products from the African-market sourcing report, searched on CJ's
// Product API by name. Each keyword's CJ matches are synced and listed like
// any other CJ product, and the job records what CJ actually offers --
// how many matches, the rand prices they list at, how many have video --
// so the report is built from CJ's real catalogue, not estimates.

export const SOURCING_LIST: { keyword: string; group: "mass" | "premium"; label: string }[] = [
  { keyword: "wireless earbuds", group: "mass", label: "Wireless earbuds" },
  { keyword: "power bank", group: "mass", label: "Power banks" },
  { keyword: "smart watch", group: "mass", label: "Smartwatches / fitness bands" },
  { keyword: "phone case", group: "mass", label: "Phone cases" },
  { keyword: "fast charger", group: "mass", label: "Chargers & cables" },
  { keyword: "car phone holder", group: "mass", label: "Car phone mounts" },
  { keyword: "dash cam", group: "mass", label: "Dash cams" },
  { keyword: "car vacuum cleaner", group: "mass", label: "Car vacuums" },
  { keyword: "solar lantern", group: "mass", label: "Solar lanterns / lights" },
  { keyword: "sneakers", group: "mass", label: "Sneakers" },
  { keyword: "handbag", group: "mass", label: "Handbags" },
  { keyword: "hair straightener", group: "mass", label: "Hair straighteners" },
  { keyword: "wig", group: "mass", label: "Wigs" },
  { keyword: "vegetable chopper", group: "mass", label: "Kitchen gadgets (choppers)" },
  { keyword: "led strip light", group: "mass", label: "LED strip lights" },
  { keyword: "smart plug", group: "mass", label: "Smart plugs" },
  { keyword: "wifi camera", group: "mass", label: "Wi-Fi security cameras" },
  { keyword: "gamepad", group: "mass", label: "Gaming controllers" },
  { keyword: "baby carrier", group: "mass", label: "Baby products (carriers)" },
  { keyword: "laptop", group: "premium", label: "Laptops" },
  { keyword: "mini pc", group: "premium", label: "Mini PCs" },
  { keyword: "standing desk", group: "premium", label: "Standing desks" },
  { keyword: "computer desk", group: "premium", label: "Computer / compact desks" },
  { keyword: "office desk", group: "premium", label: "Executive / office desks" },
  { keyword: "ergonomic office chair", group: "premium", label: "Ergonomic office chairs" },
  { keyword: "usb microphone", group: "premium", label: "USB streaming microphones" },
  { keyword: "podcast microphone", group: "premium", label: "Podcast microphones" },
  { keyword: "conference speakerphone", group: "premium", label: "Conference speakerphones" },
  { keyword: "portable monitor", group: "premium", label: "Monitors (portable)" },
  { keyword: "monitor", group: "premium", label: "Monitors" },
  { keyword: "webcam", group: "premium", label: "Webcams" },
  { keyword: "laptop stand", group: "premium", label: "Laptop stands" },
  { keyword: "monitor arm", group: "premium", label: "Monitor arms" },
  { keyword: "mechanical keyboard", group: "premium", label: "Mechanical keyboards" },
  { keyword: "usb c hub", group: "premium", label: "USB-C docks / hubs" },
];

const SOURCING_PAGES = Number(process.env.CJ_SOURCING_PAGES_PER_KEYWORD ?? 2);
const SOURCING_FLAG = "cj_sourcing_list_v1";

export interface KeywordStats {
  label: string; group: string; cjMatches: number; synced: number; listed: number; withVideo: number;
  priceMinZar: number | null; priceMaxZar: number | null; priceMedianZar: number | null;
}

export async function startSourcingRun(pages = SOURCING_PAGES): Promise<Row> {
  const plan = SOURCING_LIST.map(k => ({ ...k }));
  const { rows } = await pool!.query(
    `INSERT INTO cj_sync_jobs (id, mode, status, plan, plan_index, next_page, end_page, page_size, totals, total_available, last_error, started_at, finished_at, updated_at)
     VALUES ('sourcing', 'sourcing', 'running', $1, 0, 1, $2, 20, '{}', NULL, NULL, now(), NULL, now())
     ON CONFLICT (id) DO UPDATE SET status = 'running', plan = $1, plan_index = 0, next_page = 1, end_page = $2, page_size = 20,
       totals = '{}', total_available = NULL, last_error = NULL, started_at = now(), finished_at = NULL, updated_at = now()
     RETURNING *`,
    [JSON.stringify(plan), Math.max(1, pages)]
  );
  await pool!.query(`INSERT INTO app_flags (key, detail) VALUES ($1, 'started') ON CONFLICT (key) DO NOTHING`, [SOURCING_FLAG]);
  logger.info("cj.sourcing_started", { keywords: plan.length, pagesPerKeyword: pages });
  return rows[0];
}

export async function getSourcingJob(): Promise<Row | null> {
  const { rows } = await pool!.query(`SELECT * FROM cj_sync_jobs WHERE id = 'sourcing'`);
  return rows[0] ?? null;
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** Works through the sourcing list: each keyword's pages, one keyword after another, for up to ~50s. */
async function runSourcingTick(job: Row): Promise<void> {
  const plan: { keyword: string; group: string; label: string }[] = Array.isArray(job.plan) ? job.plan : [];
  let index = Number(job.plan_index);
  let page = Number(job.next_page);
  const endPage = Number(job.end_page);
  const totals = { ...(job.totals ?? {}) } as { byKeyword?: Record<string, KeywordStats & { prices?: number[] }> };
  const byKeyword = totals.byKeyword ?? {};
  const deadline = Date.now() + TICK_BUDGET_MS;

  while (Date.now() < deadline && index < plan.length) {
    const k = plan[index];
    const stats = byKeyword[k.keyword] ?? { label: k.label, group: k.group, cjMatches: 0, synced: 0, listed: 0, withVideo: 0, priceMinZar: null, priceMaxZar: null, priceMedianZar: null, prices: [] };
    try {
      const r = await syncCjPage({ pageNum: page, pageSize: 20, keyword: k.keyword, skipFreshHours: 24 });
      stats.cjMatches = r.totalAvailable;
      stats.synced += r.imported + r.updated + r.skippedFresh;
      stats.listed += r.listed;
      stats.withVideo += r.withVideo;
      stats.prices = [...(stats.prices ?? []), ...r.listedPricesZar];
      stats.priceMinZar = stats.prices.length ? Math.min(...stats.prices) : null;
      stats.priceMaxZar = stats.prices.length ? Math.max(...stats.prices) : null;
      stats.priceMedianZar = median(stats.prices);
      byKeyword[k.keyword] = stats;
      const lastPage = Math.max(1, Math.ceil(r.totalAvailable / 20));
      if (page >= endPage || page >= lastPage) { index++; page = 1; } else page++;
      await pool!.query(
        `UPDATE cj_sync_jobs SET plan_index = $1, next_page = $2, totals = $3, last_error = NULL, updated_at = now() WHERE id = 'sourcing'`,
        [index, page, JSON.stringify({ byKeyword }), ]
      );
    } catch (err) {
      if (isCjPointsError(err)) { await notePointsPause("sourcing", err); return; }
      const message = err instanceof Error ? err.message : String(err);
      await pool!.query(`UPDATE cj_sync_jobs SET last_error = $1, updated_at = now() WHERE id = 'sourcing'`, [`${k.keyword}: ${message}`.slice(0, 500)]);
      logger.error("cj.sourcing_page_failed", { keyword: k.keyword, page, error: message });
      return;
    }
  }

  if (index >= plan.length) {
    await pool!.query(`UPDATE cj_sync_jobs SET status = 'done', finished_at = now(), updated_at = now() WHERE id = 'sourcing'`);
    // One line per keyword, without the raw price arrays, for the sourcing report.
    const report = Object.fromEntries(Object.entries(byKeyword).map(([kw, { prices: _p, ...rest }]) => [kw, rest]));
    logger.info("cj.sourcing_report", report);
  }
}

/** Runs the sourcing list once automatically (flagged), ahead of the every-category sweep. */
async function maybeAutoStartSourcing(): Promise<Row | null> {
  const job = await getSourcingJob();
  if (job) return job;
  const { rows } = await pool!.query(`SELECT 1 FROM app_flags WHERE key = $1`, [SOURCING_FLAG]);
  return rows.length ? null : startSourcingRun();
}
