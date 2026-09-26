/**
 * "Japan Used Parts": UP-GARAGE listings sold in the Ballylife store.
 *
 *  - Settings (keywords, pricing) live in jp_parts_settings, edited from the
 *    admin panel.
 *  - A scheduled refresh runs each enabled keyword through the Apify actor
 *    (billed per result -- never on a page load), and upserts listings keyed
 *    by UP-GARAGE's listing id. A failed keyword is logged and skipped; it
 *    never takes a listing down.
 *  - A listing that's sold out on UP-GARAGE, or missing from two refreshes
 *    in a row, goes out of stock (source_status 'removed'); it comes back if
 *    it reappears -- unless we sold it.
 *  - Prices are recalculated from the stored yen price whenever the admin
 *    changes pricing settings or the yen rate moves -- no actor calls.
 *  - UP-GARAGE has no order API, so a paid order line for a Japan part
 *    becomes a jp_parts_fulfillments task for staff (buy, forward, track).
 */
import { pool } from "../db/pool";
import { logger } from "../utils/logger";
import { sendEmail } from "./emailService";
import { HOUSE_SELLER_ID, ensureHouseStore, productSlug } from "./cjCatalog";
import { isApifyConfigured, parseUpgarageRun, runUpgarageSearch, UpgarageError, type UpgaragePart } from "./upgarageService";
import {
  normaliseJapanPartsSettings, priceJapanPart, DEFAULT_JAPAN_PARTS_SETTINGS,
  type JapanPartsSettings, type JapanPartsKeyword,
} from "../utils/japanPartsPricing";
import { setJapanImportDeliveryDays } from "../utils/delivery";

type Row = Record<string, any>;

export const JAPAN_PARTS_CATEGORY_ID = "cat-jp-parts";
export const JAPAN_PARTS_SOURCE = "upgarage";
const ALERT_EMAIL = process.env.ADMIN_ALERT_EMAIL?.trim() || null;
const MAX_NAME = 150;
const MAX_IMAGES = 12;

// ── Settings ─────────────────────────────────────────────────────────────

export async function getJapanPartsSettings(): Promise<JapanPartsSettings> {
  const { rows } = await pool!.query(`SELECT settings FROM jp_parts_settings WHERE id = 'default'`);
  const s = normaliseJapanPartsSettings(rows[0]?.settings ?? DEFAULT_JAPAN_PARTS_SETTINGS);
  setJapanImportDeliveryDays(s.deliveryDays);
  return s;
}

/** Saves settings and re-prices every listing with them (no actor calls). */
export async function saveJapanPartsSettings(input: unknown, userId: string): Promise<{ settings: JapanPartsSettings; repriced: number }> {
  const settings = normaliseJapanPartsSettings(input);
  const { rows } = await pool!.query(`SELECT 1 FROM jp_parts_settings WHERE id = 'default'`);
  if (rows.length) {
    await pool!.query(`UPDATE jp_parts_settings SET settings = $1, updated_at = now(), updated_by = $2 WHERE id = 'default'`, [JSON.stringify(settings), userId]);
  } else {
    await pool!.query(`INSERT INTO jp_parts_settings (id, settings, updated_by) VALUES ('default', $1, $2)`, [JSON.stringify(settings), userId]);
  }
  setJapanImportDeliveryDays(settings.deliveryDays);
  const repriced = await repriceJapanParts(settings);
  logger.info("jp_parts.settings_saved", { by: userId, enabled: settings.enabled, keywords: settings.keywords.length, markupPct: settings.markupPct, repriced });
  return { settings, repriced };
}

export async function ensureJapanPartsCategory(): Promise<void> {
  const { rows } = await pool!.query(`SELECT 1 FROM mkt_categories WHERE id = $1`, [JAPAN_PARTS_CATEGORY_ID]);
  if (!rows.length) {
    await pool!.query(`INSERT INTO mkt_categories (id, name, slug, icon) VALUES ($1, 'Japan Used Parts', 'japan-used-parts', '🔧')`, [JAPAN_PARTS_CATEGORY_ID]);
  }
}

async function jpyToZar(): Promise<number | null> {
  const { rows } = await pool!.query(`SELECT rate_to_zar FROM mkt_fx_rates WHERE currency = 'JPY'`);
  const rate = Number(rows[0]?.rate_to_zar);
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

// ── Listing content ──────────────────────────────────────────────────────

function listingName(part: UpgaragePart, kw: JapanPartsKeyword): string {
  // Shoppers read English; the UP-GARAGE title is Japanese. Lead with the
  // keyword's English label so the listing is findable and understandable.
  const label = kw.label.trim();
  return (label && !part.name.toLowerCase().startsWith(label.toLowerCase()) ? `${label} — ${part.name}` : part.name).slice(0, MAX_NAME);
}

function listingDescription(part: UpgaragePart, kw: JapanPartsKeyword): string {
  const lines = [
    `Used ${kw.label.toLowerCase() || "car part"} sourced from UP-GARAGE in Japan.`,
    part.condition && `Condition grade: ${part.condition}`,
    part.fitment && `Fits: ${part.fitment}`,
    part.year && `Year: ${part.year}`,
    part.mileage && `Mileage: ${part.mileage}`,
    `Original listing: ${part.name}`,
    part.category && `UP-GARAGE category: ${part.category}`,
    "This is a pre-owned part, sold as described by the Japanese seller. Please check fitment for your vehicle before ordering.",
    "Price includes shipping from Japan, South African customs duty and import VAT.",
  ];
  return lines.filter(Boolean).join("\n");
}

// ── Refresh ──────────────────────────────────────────────────────────────

export interface KeywordResult { keyword: string; status: string; items: number; created: number; updated: number; removed: number; skipped: number; error?: string }

/** Parts we sold (a live fulfilment task) must never be relisted by a refresh. */
async function soldProductIds(): Promise<Set<string>> {
  const { rows } = await pool!.query(`SELECT product_id FROM jp_parts_fulfillments WHERE status NOT IN ('cancelled', 'unavailable')`);
  return new Set(rows.map((r: Row) => String(r.product_id)));
}

async function upsertPart(part: UpgaragePart, kw: JapanPartsKeyword, s: JapanPartsSettings, rate: number, sold: Set<string>): Promise<"created" | "updated" | "skipped"> {
  const breakdown = priceJapanPart(part.priceJpyTaxIncl!, kw.partsCategory, rate, s);
  const name = listingName(part, kw);
  const description = listingDescription(part, kw);
  const images = part.images.slice(0, MAX_IMAGES);
  const attributes = { conditionGrade: part.condition, fitment: part.fitment, year: part.year, mileage: part.mileage, shop: part.shop, location: part.location, originalName: part.name };
  const available = !part.soldOut;

  const { rows: existing } = await pool!.query(
    `SELECT id, slug, stock, source_status FROM mkt_products WHERE source = $1 AND source_listing_id = $2`, [JAPAN_PARTS_SOURCE, part.listingId]
  );
  if (existing.length) {
    const p = existing[0];
    const weSoldIt = sold.has(String(p.id));
    const inStock = available && !weSoldIt;
    await pool!.query(
      `UPDATE mkt_products SET name = $1, description = $2, short_description = $3, price = $4, attributes = $5, original_name = $6, original_currency = 'JPY',
         original_price = $7, original_price_tax_incl = $8, condition_grade = $9,
         source_shop = $10, source_location = $11, source_url = $12, source_keyword = $13, parts_category = $14, price_breakdown = $15,
         source_last_seen_at = now(), source_status = $16, stock = $17, status = $18, updated_at = now()
       WHERE id = $19`,
      [name, description, description.split("\n")[0], breakdown.priceZar, JSON.stringify(attributes), part.name,
       part.priceJpy, part.priceJpyTaxIncl, part.condition, part.shop, part.location, part.url, kw.keyword, kw.partsCategory,
       JSON.stringify(breakdown), available ? "listed" : "removed", inStock ? 1 : 0, inStock ? "active" : "out_of_stock", p.id]
    );
    // Keep the photos we have if this run returned none.
    if (images.length) await pool!.query(`UPDATE mkt_products SET images = $1 WHERE id = $2`, [JSON.stringify(images), p.id]);
    return "updated";
  }
  if (!available) return "skipped"; // never list something already sold out
  const slug = productSlug(name.replace(/[^\x20-\x7E]+/g, " "), `jp-${part.listingId}`.toLowerCase().replace(/[^a-z0-9-]/g, ""));
  await pool!.query(
    `INSERT INTO mkt_products (seller_id, category_id, name, slug, short_description, description, price, currency, images, emoji, status, stock,
       brand, tags, attributes, fulfillment_type, condition, delivery_profile,
       source, source_listing_id, source_url, source_keyword, source_status, source_last_seen_at, source_shop, source_location,
       original_name, original_currency, original_price, original_price_tax_incl, condition_grade, parts_category, price_breakdown)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'ZAR',$8,'🔧','active',1,$9,$10,$11,'imported','used','japan_import',
       $12,$13,$14,$15,'listed',now(),$16,$17,$18,'JPY',$19,$20,$21,$22,$23)`,
    [HOUSE_SELLER_ID, JAPAN_PARTS_CATEGORY_ID, name, slug, description.split("\n")[0], description, breakdown.priceZar, JSON.stringify(images),
     "Japan import", JSON.stringify(["japan-used-parts", "used", kw.partsCategory]), JSON.stringify(attributes),
     JAPAN_PARTS_SOURCE, part.listingId, part.url, kw.keyword, part.shop, part.location,
     part.name, part.priceJpy, part.priceJpyTaxIncl, part.condition, kw.partsCategory, JSON.stringify(breakdown)]
  );
  return "created";
}

/**
 * Listings this keyword found before but not now: gone from UP-GARAGE, or
 * just outside this run's top results. Only take one down after it's been
 * missing for two refreshes, so a ranking wobble doesn't flicker listings.
 */
async function markMissing(keyword: string, seen: Set<string>, s: JapanPartsSettings): Promise<number> {
  const graceMs = s.refreshHours * 1.5 * 3600_000;
  const { rows } = await pool!.query(
    `SELECT id, source_listing_id, source_last_seen_at FROM mkt_products WHERE source = $1 AND source_keyword = $2 AND source_status = 'listed'`,
    [JAPAN_PARTS_SOURCE, keyword]
  );
  let removed = 0;
  for (const r of rows) {
    if (seen.has(String(r.source_listing_id))) continue;
    if (r.source_last_seen_at && Date.now() - new Date(r.source_last_seen_at).getTime() < graceMs) continue;
    await pool!.query(`UPDATE mkt_products SET source_status = 'removed', status = 'out_of_stock', stock = 0, updated_at = now() WHERE id = $1`, [r.id]);
    removed++;
  }
  return removed;
}

async function recordRun(r: KeywordResult, startedAt: Date): Promise<void> {
  await pool!.query(
    `INSERT INTO jp_parts_refresh_runs (keyword, status, items, created, updated, removed, skipped, error, started_at, finished_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())`,
    [r.keyword, r.status, r.items, r.created, r.updated, r.removed, r.skipped, r.error ?? null, startedAt]
  );
}

export async function refreshKeyword(kw: JapanPartsKeyword, s: JapanPartsSettings, rate: number): Promise<KeywordResult> {
  const startedAt = new Date();
  const result: KeywordResult = { keyword: kw.keyword, status: "ok", items: 0, created: 0, updated: 0, removed: 0, skipped: 0 };
  try {
    const items = await runUpgarageSearch(kw.keyword, s.maxItemsPerKeyword);
    result.items = items.length;
    const { parts, skipped, schemaSuspect, sampleKeys } = parseUpgarageRun(items);
    result.skipped = skipped;
    if (schemaSuspect) {
      // Don't touch existing listings on output we can't read.
      result.status = "schema_changed";
      result.error = `Only ${parts.length} of ${items.length} items had a usable id, name and price. Fields received: ${sampleKeys.join(", ") || "(none)"}`;
      logger.error("jp_parts.schema_changed", { keyword: kw.keyword, items: items.length, usable: parts.length, sampleKeys });
    } else {
      if (!items.length) {
        result.status = "empty";
        logger.warn("jp_parts.empty_result", { keyword: kw.keyword, hint: "No results -- the keyword may be too narrow, or UP-GARAGE may be blocking the actor. Check the actor's run log on Apify." });
      }
      const sold = await soldProductIds();
      const seen = new Set<string>();
      for (const part of parts) {
        seen.add(part.listingId);
        const outcome = await upsertPart(part, kw, s, rate, sold);
        result[outcome]++;
      }
      // An empty result can't prove anything was removed -- it's as likely a block.
      if (items.length) result.removed = await markMissing(kw.keyword, seen, s);
    }
  } catch (err) {
    result.status = "failed";
    const kind = err instanceof UpgarageError ? err.kind : "internal";
    result.error = `${kind}: ${err instanceof Error ? err.message : String(err)}`.slice(0, 500);
    logger.error("jp_parts.keyword_failed", { keyword: kw.keyword, kind, error: result.error });
  }
  await recordRun(result, startedAt).catch(() => undefined);
  logger.info("jp_parts.keyword_refreshed", { ...result });
  return result;
}

let refreshing = false;

/** Refreshes every enabled keyword, one at a time. Never throws. */
export async function refreshJapanParts(opts: { force?: boolean } = {}): Promise<{ ran: boolean; reason?: string; results: KeywordResult[] }> {
  if (refreshing) return { ran: false, reason: "A refresh is already running.", results: [] };
  refreshing = true;
  try {
    const s = await getJapanPartsSettings();
    if (!s.enabled && !opts.force) return { ran: false, reason: "Japan Used Parts is switched off in settings.", results: [] };
    if (!isApifyConfigured()) return { ran: false, reason: "APIFY_API_TOKEN isn't set on the server.", results: [] };
    const rate = await jpyToZar();
    if (!rate) {
      logger.error("jp_parts.no_jpy_rate", {});
      return { ran: false, reason: "No JPY exchange rate on file.", results: [] };
    }
    await ensureHouseStore();
    await ensureJapanPartsCategory();
    const results: KeywordResult[] = [];
    for (const kw of s.keywords.filter(k => k.enabled)) results.push(await refreshKeyword(kw, s, rate));
    return { ran: true, results };
  } catch (err) {
    logger.error("jp_parts.refresh_failed", { error: err instanceof Error ? err.message : String(err) });
    return { ran: false, reason: "Refresh failed -- see server logs.", results: [] };
  } finally {
    refreshing = false;
  }
}

export function isJapanPartsRefreshing(): boolean { return refreshing; }

/** Recalculates every Japan part's price from its stored yen price. */
export async function repriceJapanParts(settings?: JapanPartsSettings): Promise<number> {
  const s = settings ?? await getJapanPartsSettings();
  const rate = await jpyToZar();
  if (!rate) return 0;
  const { rows } = await pool!.query(
    `SELECT id, original_price_tax_incl, parts_category FROM mkt_products WHERE source = $1 AND original_price_tax_incl IS NOT NULL`, [JAPAN_PARTS_SOURCE]
  );
  for (const r of rows) {
    const b = priceJapanPart(Number(r.original_price_tax_incl), r.parts_category || "small", rate, s);
    await pool!.query(`UPDATE mkt_products SET price = $1, price_breakdown = $2, updated_at = now() WHERE id = $3`, [b.priceZar, JSON.stringify(b), r.id]);
  }
  if (rows.length) logger.info("jp_parts.repriced", { count: rows.length, jpyToZar: rate });
  return rows.length;
}

// ── Fulfilment (manual: buy in Japan, ship via forwarder) ─────────────────

const LOOKBACK_DAYS = 30;

export async function enqueueJapanPartOrders(): Promise<number> {
  const { rows: parts } = await pool!.query(`SELECT id, source_url FROM mkt_products WHERE source = $1`, [JAPAN_PARTS_SOURCE]);
  if (!parts.length) return 0;
  const urlById = new Map(parts.map((p: Row) => [String(p.id), p.source_url as string | null]));
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86400_000);
  const { rows: orders } = await pool!.query(
    `SELECT id, order_number, items, placed_at FROM mkt_orders WHERE payment_status = 'payment_confirmed' AND placed_at > $1`, [since]
  );
  const created: { order: string; name: string; url: string | null }[] = [];
  for (const o of orders) {
    const items = (Array.isArray(o.items) ? o.items : []) as Row[];
    for (const item of items) {
      const pid = String(item.productId ?? "");
      if (!urlById.has(pid)) continue;
      const { rows: exists } = await pool!.query(`SELECT 1 FROM jp_parts_fulfillments WHERE order_id = $1 AND product_id = $2`, [o.id, pid]);
      if (exists.length) continue;
      await pool!.query(
        `INSERT INTO jp_parts_fulfillments (order_id, product_id, product_name, quantity, source_url) VALUES ($1,$2,$3,$4,$5)`,
        [o.id, pid, item.productName ?? null, Number(item.quantity) || 1, urlById.get(pid) ?? null]
      );
      // Used parts are one-offs: take it off sale now it's sold.
      await pool!.query(`UPDATE mkt_products SET stock = 0, status = 'out_of_stock', updated_at = now() WHERE id::text = $1`, [pid]);
      created.push({ order: o.order_number, name: String(item.productName ?? pid), url: urlById.get(pid) ?? null });
    }
  }
  if (created.length) {
    logger.info("jp_parts.fulfillment_enqueued", { count: created.length });
    if (ALERT_EMAIL) {
      await sendEmail({
        to: ALERT_EMAIL,
        subject: `Japan parts to buy: ${created.length} new paid order line${created.length === 1 ? "" : "s"}`,
        html: `<p>These Japan used parts have been paid for and need buying on UP-GARAGE and shipping via the forwarder:</p><ul>${
          created.map(c => `<li>${esc(c.order)} — ${esc(c.name)}${c.url ? ` — <a href="${esc(c.url)}">UP-GARAGE listing</a>` : ""}</li>`).join("")
        }</ul><p>Update each one in Admin → Japan Parts as you go. If a part is no longer available, mark it unavailable and refund the customer.</p>`,
      }).catch(() => undefined);
    }
  }
  return created.length;
}

const FULFILMENT_STATUSES = ["to_buy", "bought", "shipped", "delivered", "unavailable", "cancelled"] as const;
export type JapanFulfilmentStatus = typeof FULFILMENT_STATUSES[number];
export const isJapanFulfilmentStatus = (s: unknown): s is JapanFulfilmentStatus => FULFILMENT_STATUSES.includes(s as JapanFulfilmentStatus);

export async function updateJapanFulfillment(id: string, patch: { status?: JapanFulfilmentStatus; purchaseRef?: string; forwarder?: string; trackingNumber?: string; carrier?: string; notes?: string }): Promise<Row | null> {
  const { rows } = await pool!.query(`SELECT * FROM jp_parts_fulfillments WHERE id::text = $1`, [id]);
  const f = rows[0];
  if (!f) return null;
  const next = {
    status: patch.status ?? f.status,
    purchase_ref: patch.purchaseRef ?? f.purchase_ref,
    forwarder: patch.forwarder ?? f.forwarder,
    tracking_number: patch.trackingNumber ?? f.tracking_number,
    carrier: patch.carrier ?? f.carrier,
    notes: patch.notes ?? f.notes,
  };
  const { rows: updated } = await pool!.query(
    `UPDATE jp_parts_fulfillments SET status = $1, purchase_ref = $2, forwarder = $3, tracking_number = $4, carrier = $5, notes = $6, updated_at = now()
     WHERE id = $7 RETURNING *`,
    [next.status, next.purchase_ref, next.forwarder, next.tracking_number, next.carrier, next.notes, f.id]
  );

  // Customer-facing order state follows the parcel.
  if (next.status === "shipped" && next.tracking_number) {
    await pool!.query(
      `UPDATE mkt_orders SET tracking_number = COALESCE(tracking_number, $2), carrier = COALESCE(carrier, $3), shipping_status = 'in_transit', shipped_at = COALESCE(shipped_at, now()) WHERE id = $1`,
      [f.order_id, next.tracking_number, next.carrier || "Ballylife Express"]
    );
  }
  if (next.status === "delivered") {
    // Only close the whole order when every line in it was a Japan part and all are delivered.
    const { rows: order } = await pool!.query(`SELECT items FROM mkt_orders WHERE id = $1`, [f.order_id]);
    const lines = (Array.isArray(order[0]?.items) ? order[0].items : []) as Row[];
    const { rows: tasks } = await pool!.query(`SELECT product_id, status FROM jp_parts_fulfillments WHERE order_id = $1`, [f.order_id]);
    const allJapan = lines.every(l => tasks.some((t: Row) => String(t.product_id) === String(l.productId)));
    if (allJapan && tasks.every((t: Row) => t.status === "delivered")) {
      await pool!.query(`UPDATE mkt_orders SET status = 'delivered', shipping_status = 'delivered', delivered_at = COALESCE(delivered_at, now()) WHERE id = $1`, [f.order_id]);
    }
  }
  if (next.status === "unavailable" && f.status !== "unavailable") {
    logger.warn("jp_parts.unavailable_after_sale", { fulfillmentId: f.id, orderId: f.order_id, productId: f.product_id });
    if (ALERT_EMAIL) {
      await sendEmail({
        to: ALERT_EMAIL,
        subject: "Refund needed: a sold Japan part is no longer available",
        html: `<p>${esc(String(f.product_name ?? f.product_id))} was marked unavailable after the customer paid. Please refund the customer for this line.</p>`,
      }).catch(() => undefined);
    }
  }
  return updated[0];
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

// ── Worker ───────────────────────────────────────────────────────────────

const TICK_MS = 15 * 60 * 1000;

async function lastRefreshAt(): Promise<Date | null> {
  const { rows } = await pool!.query(`SELECT started_at FROM jp_parts_refresh_runs ORDER BY started_at DESC LIMIT 1`);
  return rows[0] ? new Date(rows[0].started_at) : null;
}

export async function runJapanPartsTick(): Promise<void> {
  await enqueueJapanPartOrders().catch(err => logger.error("jp_parts.enqueue_failed", { error: err instanceof Error ? err.message : String(err) }));
  const s = await getJapanPartsSettings();
  if (!s.enabled || !isApifyConfigured()) return;
  const last = await lastRefreshAt();
  if (last && Date.now() - last.getTime() < s.refreshHours * 3600_000) return;
  await refreshJapanParts();
}

export function startJapanPartsWorker(): NodeJS.Timeout | null {
  if (!pool) return null;
  const run = () => runJapanPartsTick().catch(err => logger.error("jp_parts.tick_failed", { error: err instanceof Error ? err.message : String(err) }));
  // Load settings early so delivery promises reflect them, then work in the background.
  void getJapanPartsSettings().catch(() => undefined);
  setTimeout(run, 60_000).unref();
  const timer = setInterval(run, TICK_MS);
  timer.unref();
  logger.info("jp_parts.worker_started", { apifyConfigured: isApifyConfigured(), tickMinutes: TICK_MS / 60_000 });
  return timer;
}
