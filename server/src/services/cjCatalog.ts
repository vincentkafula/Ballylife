import { pool } from "../db/pool";
import { logger } from "../utils/logger";
import { convertToZar, round2 } from "../utils/pricing";
import {
  isCjConfigured, listCjProducts, getCjProductDetail, calculateCjFreight,
  type CjProductSummary, type CjProductDetail,
} from "./cjDropshippingClient";
import { dedupeImages, isPhotoUrl, parseSupplierImageList, scrubSupplierBranding, splitSupplierDescription } from "../utils/supplierWhiteLabel";
import { variantIdForVid, type ExternalVariant } from "../utils/cjVariants";

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

// ── Category mapping ──────────────────────────────────────────────────────
// CJ's leaf category names ("Wireless Earphones", "Women's Dresses") mapped
// onto our top-level categories by keyword. First match wins, so the more
// specific groups come first.
const CATEGORY_KEYWORDS: [string, RegExp][] = [
  ["cat-04", /beauty|makeup|cosmetic|skin|hair|nail|lip|eyelash|perfume|fragrance|health|massage|personal care|shaver|razor|oral|tooth/i],
  ["cat-05", /sport|fitness|gym|yoga|outdoor|camping|hiking|cycling|bicycle|fishing|swim|running|ball|golf|climbing/i],
  ["cat-08", /car |car-|automobile|motorcycle|vehicle|auto part|auto accessor/i],
  ["cat-01", /phone|mobile|earphone|headphone|earbud|headset|speaker|audio|electronic|computer|laptop|tablet|keyboard|mouse|camera|charger|cable|usb|power bank|smart ?watch|gadget|drone|gaming|console|projector|led strip|bluetooth|wireless/i],
  ["cat-02", /women|men's|mens|dress|shirt|t-shirt|blouse|jacket|coat|pants|jeans|skirt|shoe|sneaker|boot|sandal|bag|handbag|wallet|backpack|jewel|necklace|ring|earring|bracelet|watch|sunglass|hat|cap|scarf|sock|underwear|lingerie|clothing|apparel|fashion/i],
  ["cat-06", /book|stationery|office|school|pen|notebook|art supplies|music|instrument/i],
  ["cat-03", /home|kitchen|garden|furniture|decor|bed|bath|storage|tool|lighting|lamp|pet|baby|kid|toy|clean|household|curtain|rug|mug|cup/i],
];

export function mapCjCategory(...texts: (string | undefined)[]): string {
  const hay = texts.filter(Boolean).join(" ");
  return CATEGORY_KEYWORDS.find(([, re]) => re.test(hay))?.[0] ?? DEFAULT_CATEGORY;
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
  stock: number | null; categoryHint: string; detailOk: boolean;
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
      categoryHint: `${d.categoryName ?? p.categoryName ?? ""} ${d.productNameEn ?? p.productNameEn ?? ""}`,
      detailOk: true,
    };
  } catch (err) {
    logger.warn("cj.product_detail_fallback", { pid: p.pid, error: err instanceof Error ? err.message : String(err) });
    return {
      name: fallbackName, description: scrubSupplierBranding(p.remark), images: parseSupplierImageList(p.productImage),
      variants: [], stock: null, categoryHint: `${p.categoryName ?? ""} ${p.productNameEn ?? ""}`, detailOk: false,
    };
  }
}

/** CJ's cheapest shipping quote (USD) for one unit to the pricing country, or null if unavailable. */
async function estimateShippingUsd(vid: string | undefined): Promise<number | null> {
  if (!vid) return null;
  try {
    const options = await calculateCjFreight({ startCountryCode: FROM_COUNTRY, endCountryCode: PRICING_COUNTRY, products: [{ vid, quantity: 1 }] });
    const prices = (options ?? []).map(o => Number(o.logisticPrice)).filter(n => Number.isFinite(n) && n >= 0);
    return prices.length ? Math.min(...prices) : null;
  } catch (err) {
    logger.warn("cj.freight_estimate_failed", { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

// ── One page ─────────────────────────────────────────────────────────────

export interface PageResult {
  imported: number; updated: number; skippedNoRate: number; withPhotos: number; detailFailures: number; listed: number;
  totalAvailable: number; pageNum: number; pageSize: number;
}

export async function syncCjPage(opts: { pageNum: number; pageSize: number; categoryId?: string }): Promise<PageResult> {
  const result = await listCjProducts({ pageNum: opts.pageNum, pageSize: opts.pageSize, categoryId: opts.categoryId });
  await ensureCjSupplierExists();
  await ensureHouseStore();

  const { rows: fxRows } = await pool!.query(`SELECT * FROM mkt_fx_rates`);
  const usdToZar = convertToZar(1, "USD", new Map(fxRows.map((r: { currency: string; rate_to_zar: string }) => [r.currency, Number(r.rate_to_zar)])));

  const { rows: catRows } = await pool!.query(`SELECT id FROM mkt_categories`);
  const knownCategories = new Set(catRows.map((r: { id: string }) => r.id));
  const counts = { imported: 0, updated: 0, skippedNoRate: 0, withPhotos: 0, detailFailures: 0, listed: 0 };
  for (const p of result.list ?? []) {
    if (usdToZar === null) { counts.skippedNoRate++; continue; } // no USD rate on file -- flagged, never guessed
    const costUsd = parseCjPrice(p.sellPrice);
    if (costUsd === null) continue;

    const w = await buildWhiteLabelledProduct(p);
    if (!w.detailOk) counts.detailFailures++;
    if (w.images.length) counts.withPhotos++;

    const shippingUsd = w.detailOk ? await estimateShippingUsd(w.variants[0]?.vid) : null;
    // What sellers see as the base price they mark up from: landed cost
    // (goods + shipping) when CJ quoted shipping, goods only otherwise.
    const baseZar = round2((costUsd + (shippingUsd ?? 0)) * usdToZar);
    const mapped = mapCjCategory(w.categoryHint);
    const categoryId = knownCategories.has(mapped) ? mapped : knownCategories.has(DEFAULT_CATEGORY) ? DEFAULT_CATEGORY : null;
    const listable = categoryId !== null && w.detailOk && w.images.length > 0 && w.variants.length > 0 && shippingUsd !== null;

    const { rows: existing } = await pool!.query(
      `SELECT id FROM mkt_supplier_products WHERE supplier_id = $1 AND external_id = $2`, [CJ_SUPPLIER_ID, p.pid]
    );
    let supplierProductId: string;
    if (existing.length) {
      supplierProductId = existing[0].id;
      // GREATEST: a cost increase raises the floor, but a re-sync never
      // wipes out a price a manager has already marked up by hand.
      await pool!.query(
        `UPDATE mkt_supplier_products SET name = $1, description = $2, cost_price = $3, retail_price = GREATEST(retail_price, $4::numeric),
           images = $5, category_id = COALESCE(category_id, $6), est_shipping_usd = COALESCE($7, est_shipping_usd), updated_at = now()
         WHERE id = $8`,
        [w.name, w.description, costUsd, baseZar, JSON.stringify(w.images), categoryId, shippingUsd, supplierProductId]
      );
      // Only overwrite variants from a successful detail call -- a failed
      // one must never wipe the vids that live orders depend on.
      if (w.detailOk && w.variants.length) {
        await pool!.query(`UPDATE mkt_supplier_products SET external_variants = $1 WHERE id = $2`, [JSON.stringify(w.variants), supplierProductId]);
      }
      // Seller listings copied the catalogue photos at import time -- keep them on CJ's current set.
      if (w.images.length) {
        await pool!.query(`UPDATE mkt_products SET images = $1, updated_at = now() WHERE supplier_product_id = $2`, [JSON.stringify(w.images), supplierProductId]);
      }
      counts.updated++;
    } else {
      const { rows } = await pool!.query(
        `INSERT INTO mkt_supplier_products (supplier_id, category_id, name, description, cost_price, currency, retail_price, moq, images, origin_country, status,
           external_source, external_id, external_variants, est_shipping_usd)
         VALUES ($1,$2,$3,$4,$5,'USD',$6,1,$7,'CN','pending_review','cjdropshipping',$8,$9,$10) RETURNING id`,
        [CJ_SUPPLIER_ID, categoryId, w.name, w.description, costUsd, baseZar, JSON.stringify(w.images), p.pid, JSON.stringify(w.variants), shippingUsd]
      );
      supplierProductId = rows[0].id;
      counts.imported++;
    }

    if (listable) {
      await listInHouseStore(supplierProductId, { ...w, costUsd, shippingUsd: shippingUsd!, usdToZar, categoryId: categoryId! });
      counts.listed++;
    }
  }

  logger.info("cj.sync_page", { pageNum: opts.pageNum, pageSize: opts.pageSize, ...counts });
  return { ...counts, totalAvailable: Number(result.total ?? 0), pageNum: Number(result.pageNum ?? opts.pageNum), pageSize: Number(result.pageSize ?? opts.pageSize) };
}

/**
 * Puts one CJ product live in the Ballylife store (or refreshes it). The
 * house store's price always follows CJ: landed cost x (1 + markup),
 * rounded up to the next whole rand. The catalogue item is marked active
 * so sellers can add it to their own stores too.
 */
async function listInHouseStore(supplierProductId: string, w: WhiteLabelledProduct & { costUsd: number; shippingUsd: number; usdToZar: number; categoryId: string }) {
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
      `UPDATE mkt_products SET name = $1, description = $2, short_description = $3, price = $4, images = $5, variants = $6, stock = $7, updated_at = now()
       WHERE id = $8`,
      [w.name, w.description, shortDescription, price, JSON.stringify(w.images), JSON.stringify(variants), stock, existing[0].id]
    );
    return;
  }
  const slug = `${w.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 80)}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  await pool!.query(
    `INSERT INTO mkt_products (seller_id, category_id, name, slug, short_description, description, price, currency, images, emoji, status, stock,
       brand, variants, fulfillment_type, supplier_product_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'ZAR',$8,'📦','active',$9,'Ballylife',$10,'imported',$11)`,
    [HOUSE_SELLER_ID, w.categoryId, w.name, slug, shortDescription, w.description, price, JSON.stringify(w.images), stock, JSON.stringify(variants), supplierProductId]
  );
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

/** Processes one page of a running job. Safe to call often; does nothing when idle. */
export async function runCatalogSyncTick(): Promise<void> {
  let job = await getCatalogSyncJob();

  // First boot with CJ connected and no CJ products yet: fill the store.
  if (!job && INITIAL_SYNC_PAGES > 0) {
    const { rows } = await pool!.query(`SELECT COUNT(*)::int AS n FROM mkt_supplier_products WHERE supplier_id = $1`, [CJ_SUPPLIER_ID]);
    if (!rows[0].n) job = await startCatalogSync({ startPage: 1, pages: INITIAL_SYNC_PAGES, pageSize: 20 });
  }
  if (!job || job.status !== "running") return;

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
