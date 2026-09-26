/**
 * 1688 product research -> CJ sourcing -> Ballylife store.
 *
 *  1. Research: the Apify actor searches 1688 for the admin's keywords
 *     (one run for all keywords), results are upserted by offer id into
 *     sourcing_1688_offers with an estimated SA landed cost and resale
 *     price. Admin-triggered or scheduled (off by default).
 *  2. Pick: the admin shortlists / dismisses offers.
 *  3. Source: "Send to CJ" files a CJ sourcing request (product name,
 *     photo, 1688 link, target USD price). CJ finds and stocks it.
 *  4. List: a worker polls CJ; when CJ reports success with a product id,
 *     that CJ product is imported and listed like any other CJ product --
 *     priced from CJ's cost, fulfilled by CJ. Failures record CJ's reason.
 *
 * Selling before CJ has it (listing.autoList): eligible finds (MOQ within
 * listing.maxMoq, photos, known options) are also listed in the Ballylife
 * store straight away -- priced from the estimate (goods + China shipping +
 * agent fee + freight + duty + VAT + markup), white-labelled like CJ items,
 * and fulfilled by hand: a paid order becomes a task in the buy-and-forward
 * queue (staff buy on 1688 through a China agent). With autoSendToCj each
 * listed find is also sent to CJ (up to a daily cap); when CJ sources it the
 * CJ listing replaces the agent listing.
 */
import { pool } from "../db/pool";
import { logger } from "../utils/logger";
import { runApifyActor, isApifyConfigured, ApifyError } from "./apifyClient";
import { createCjSourcing, queryCjSourcing, isCjConfigured, isCjPointsError } from "./cjDropshippingClient";
import { importCjProductByPid, HOUSE_SELLER_ID, ensureHouseStore, productSlug } from "./cjCatalog";
import { categorizeProduct } from "../utils/productCategorizer";
import { cleanProductName, cleanDescriptionText } from "../utils/productNaming";
import { setChinaAgentDeliveryDays } from "../utils/delivery";
import { variantIdForVid } from "../utils/cjVariants";
import {
  normalise1688Settings, DEFAULT_1688_SETTINGS, actorInput, parse1688Run, estimate1688, classFor,
  type Sourcing1688Settings, type Offer1688, type Variant1688,
} from "../utils/sourcing1688";

type Row = Record<string, any>;
export const ACTOR_1688 = process.env.SOURCING_1688_ACTOR_ID || "sourabhbgp~1688-scraper";
export const SOURCE_1688 = "1688";
const FALLBACK_CATEGORY = process.env.CJ_DEFAULT_CATEGORY_ID || "cat-03";

// ── Settings ─────────────────────────────────────────────────────────────

export async function get1688Settings(): Promise<Sourcing1688Settings> {
  const { rows } = await pool!.query(`SELECT settings FROM sourcing_1688_settings WHERE id = 'default'`);
  const s = normalise1688Settings(rows[0]?.settings ?? DEFAULT_1688_SETTINGS);
  setChinaAgentDeliveryDays(s.listing.deliveryDays);
  return s;
}

export async function save1688Settings(input: unknown, userId: string): Promise<{ settings: Sourcing1688Settings; reestimated: number }> {
  const settings = normalise1688Settings(input);
  const { rows } = await pool!.query(`SELECT 1 FROM sourcing_1688_settings WHERE id = 'default'`);
  if (rows.length) await pool!.query(`UPDATE sourcing_1688_settings SET settings = $1, updated_at = now(), updated_by = $2 WHERE id = 'default'`, [JSON.stringify(settings), userId]);
  else await pool!.query(`INSERT INTO sourcing_1688_settings (id, settings, updated_by) VALUES ('default', $1, $2)`, [JSON.stringify(settings), userId]);
  setChinaAgentDeliveryDays(settings.listing.deliveryDays);
  const reestimated = await reestimateAll(settings);
  logger.info("sourcing1688.settings_saved", { by: userId, enabled: settings.enabled, keywords: settings.keywords.length });
  return { settings, reestimated };
}

async function rates(): Promise<{ cny: number | null; usd: number | null }> {
  const { rows } = await pool!.query(`SELECT currency, rate_to_zar FROM mkt_fx_rates WHERE currency IN ('CNY', 'USD')`);
  const get = (c: string) => { const n = Number(rows.find((r: Row) => r.currency === c)?.rate_to_zar); return Number.isFinite(n) && n > 0 ? n : null; };
  return { cny: get("CNY"), usd: get("USD") };
}

/** Recomputes every offer's estimate (after settings or rate changes) -- no actor calls. */
/** Also re-prices direct listings. Called on settings save and when the yuan rate moves. */
export async function reestimateAll(settings?: Sourcing1688Settings): Promise<number> {
  const s = settings ?? await get1688Settings();
  const { cny, usd } = await rates();
  if (!cny) return 0;
  const { rows } = await pool!.query(`SELECT id, title, price_cny, source_keyword, direct_product_id, variants FROM sourcing_1688_offers`);
  for (const r of rows) {
    const kwClass = s.keywords.find(k => k.keyword === r.source_keyword)?.productClass ?? "auto";
    const cls = classFor(r.title, kwClass);
    await pool!.query(`UPDATE sourcing_1688_offers SET product_class = $1, estimate = $2 WHERE id = $3`,
      [cls, JSON.stringify(estimate1688(Number(r.price_cny), cls, cny, usd, s)), r.id]);
    if (r.direct_product_id) {
      const pricing = listingPricing(Number(r.price_cny), Array.isArray(r.variants) ? r.variants : [], cls, cny, usd, s);
      await pool!.query(`UPDATE mkt_products SET price = $1, variants = $2, price_breakdown = $3, updated_at = now() WHERE id::text = $4`,
        [pricing.price, JSON.stringify(pricing.variants.map(v => ({ ...v, stock: v.stock }))), JSON.stringify(pricing.breakdown), r.direct_product_id]);
    }
  }
  return rows.length;
}

// ── Direct listings (bought through a China agent) ───────────────────────

interface ListingVariant { id: string; type: string; value: string; sku: string; stock: number; additionalPrice: number }

/** Store price for an offer: the estimate's resale price, per option. */
function listingPricing(priceCny: number, variants: Variant1688[], cls: string, cny: number, usd: number | null, s: Sourcing1688Settings, stockCap = s.listing.stockCap) {
  const priced = variants.map(v => ({ v, resale: estimate1688(v.priceCny ?? priceCny, cls, cny, usd, s).resaleZar }));
  const base = priced.length ? Math.min(...priced.map(x => x.resale)) : estimate1688(priceCny, cls, cny, usd, s).resaleZar;
  const breakdown = estimate1688(priced.length ? (Math.min(...variants.map(v => v.priceCny ?? priceCny))) : priceCny, cls, cny, usd, s);
  const listingVariants: ListingVariant[] = variants.length > 1 ? priced.map(({ v, resale }) => ({
    id: variantIdForVid(`1688:${v.skuId}`), type: "Option", value: v.label, sku: v.skuId,
    stock: Math.max(0, Math.min(stockCap, v.stock ?? stockCap)), additionalPrice: Math.max(0, resale - base),
  })) : [];
  return { price: base, variants: listingVariants, breakdown };
}

function whyNotListable(o: Offer1688, s: Sourcing1688Settings): string | null {
  if (o.outOfStock) return "Out of stock on 1688";
  if (o.moq !== null && o.moq > s.listing.maxMoq) return `MOQ ${o.moq} is above ${s.listing.maxMoq}`;
  if (!o.images.length) return "No photos";
  if ((o.totalVariants ?? 0) > 1 && o.variants.length < 2) return "Has options, but the options weren't returned";
  return null;
}

function listingDescription(o: Offer1688): string {
  const lines = [...o.sellingPoints, ...o.specs].map(l => cleanDescriptionText(l)).filter(Boolean);
  return lines.length ? lines.join("\n") : cleanProductName(o.title);
}

/** Lists (or refreshes) one find in the Ballylife store, or records why it can't be. */
async function listOffer(offerRowId: string, o: Offer1688, cls: string, s: Sourcing1688Settings, cny: number, usd: number | null, known: Set<string>): Promise<"listed" | "updated" | "skipped"> {
  const { rows: offerRows } = await pool!.query(`SELECT status, direct_product_id FROM sourcing_1688_offers WHERE id = $1`, [offerRowId]);
  const state = offerRows[0];
  if (!state || state.status === "dismissed" || state.status === "listed") return "skipped"; // dismissed, or CJ's listing has taken over
  const reason = whyNotListable(o, s);
  const existingId: string | null = state.direct_product_id ?? null;
  if (reason) {
    await pool!.query(`UPDATE sourcing_1688_offers SET not_listed_reason = $1 WHERE id = $2`, [reason, offerRowId]);
    if (existingId) await pool!.query(`UPDATE mkt_products SET status = 'out_of_stock', updated_at = now() WHERE id::text = $1 AND status = 'active'`, [existingId]);
    return "skipped";
  }
  const name = cleanProductName(o.title) || o.title;
  const description = listingDescription(o);
  const categoryId = categorizeProduct(name, [o.categoryPath], known, FALLBACK_CATEGORY) ?? FALLBACK_CATEGORY;
  const pricing = listingPricing(o.priceCny, o.variants, cls, cny, usd, s);
  const stock = pricing.variants.length ? pricing.variants.reduce((n, v) => n + v.stock, 0) : Math.min(s.listing.stockCap, o.stock ?? s.listing.stockCap);
  const images = [...o.images, ...o.variants.map(v => v.image).filter((x): x is string => Boolean(x))].filter((u, i, a) => a.indexOf(u) === i).slice(0, 12);
  const common = [name, description, description.split("\n")[0].slice(0, 160), pricing.price, JSON.stringify(images), JSON.stringify(pricing.variants), stock,
    categoryId, o.url, o.sourceKeyword, o.priceCny, JSON.stringify(pricing.breakdown), stock > 0 ? "active" : "out_of_stock"];

  if (existingId) {
    const { rows } = await pool!.query(
      `UPDATE mkt_products SET name = $1, description = $2, short_description = $3, price = $4, images = $5, variants = $6, stock = $7, category_id = $8,
         source_url = $9, source_keyword = $10, original_price = $11, price_breakdown = $12, status = $13, source_status = 'listed', source_last_seen_at = now(), updated_at = now()
       WHERE id::text = $14 AND status <> 'inactive' RETURNING id`,
      [...common, existingId]
    );
    await pool!.query(`UPDATE sourcing_1688_offers SET not_listed_reason = NULL WHERE id = $1`, [offerRowId]);
    return rows.length ? "updated" : "skipped";
  }
  const slug = productSlug(name, `cn-${o.offerId}`);
  const { rows } = await pool!.query(
    `INSERT INTO mkt_products (name, description, short_description, price, images, variants, stock, category_id, source_url, source_keyword, original_price, price_breakdown, status,
       seller_id, slug, currency, emoji, brand, fulfillment_type, delivery_profile, source, source_listing_id, source_status, source_last_seen_at, original_currency, original_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'ZAR','📦','Ballylife','imported','china_agent',$16,$17,'listed',now(),'CNY',$18) RETURNING id`,
    [...common, HOUSE_SELLER_ID, slug, SOURCE_1688, o.offerId, o.title]
  );
  await pool!.query(`UPDATE sourcing_1688_offers SET direct_product_id = $1, not_listed_reason = NULL WHERE id = $2`, [String(rows[0].id), offerRowId]);
  return "listed";
}

/** Direct listings whose find wasn't in the last two runs: take them off sale (they come back if it reappears). */
async function markMissingListings(seenOfferIds: Set<string>, keywords: string[], s: Sourcing1688Settings): Promise<number> {
  const graceMs = s.refreshHours * 1.5 * 3600_000;
  const { rows } = await pool!.query(
    `SELECT offer_id, direct_product_id, last_seen_at, source_keyword FROM sourcing_1688_offers WHERE direct_product_id IS NOT NULL AND status <> 'listed'`
  );
  let removed = 0;
  for (const r of rows) {
    if (seenOfferIds.has(String(r.offer_id)) || !keywords.includes(r.source_keyword)) continue;
    if (Date.now() - new Date(r.last_seen_at).getTime() < graceMs) continue;
    const { rows: upd } = await pool!.query(
      `UPDATE mkt_products SET status = 'out_of_stock', source_status = 'removed', updated_at = now() WHERE id::text = $1 AND status = 'active' RETURNING id`, [r.direct_product_id]
    );
    removed += upd.length;
  }
  return removed;
}

/** Sends the best-selling listed finds that aren't with CJ yet, up to the daily cap. */
export async function autoSendToCj(s: Sourcing1688Settings): Promise<number> {
  if (!s.listing.autoSendToCj || !isCjConfigured() || s.listing.maxCjRequestsPerDay <= 0) return 0;
  const { rows: today } = await pool!.query(`SELECT COUNT(*)::int AS n FROM sourcing_1688_offers WHERE sent_to_cj_at > $1`, [new Date(Date.now() - 86400_000)]);
  const room = s.listing.maxCjRequestsPerDay - Number(today[0].n);
  if (room <= 0) return 0;
  const { rows } = await pool!.query(
    `SELECT id FROM sourcing_1688_offers WHERE direct_product_id IS NOT NULL AND cj_sourcing_id IS NULL AND status IN ('new', 'shortlisted')
     ORDER BY sold_count DESC NULLS LAST LIMIT $1`, [room]
  );
  let sent = 0;
  for (const r of rows) {
    try { await sendOfferToCj(r.id); sent++; }
    catch (err) { logger.warn("sourcing1688.auto_send_failed", { id: r.id, error: err instanceof Error ? err.message : String(err) }); }
  }
  if (sent) logger.info("sourcing1688.auto_sent_to_cj", { sent });
  return sent;
}

// ── Research run ─────────────────────────────────────────────────────────

let running = false;
export const is1688Running = () => running;

async function upsertOffer(o: Offer1688, s: Sourcing1688Settings, cny: number, usd: number | null): Promise<"created" | "updated"> {
  const kwClass = s.keywords.find(k => k.keyword === o.sourceKeyword)?.productClass ?? "auto";
  const cls = classFor(o.title, kwClass);
  const estimate = JSON.stringify(estimate1688(o.priceCny, cls, cny, usd, s));
  const values = [o.title, o.url, o.priceCny, o.priceRangeCny, o.moq, o.unit, o.stock, o.outOfStock, o.soldCount, o.repurchaseRate, o.starLevel,
    o.supplierName, o.supplierType, o.supplierYears, o.location, o.categoryPath, JSON.stringify(o.images), o.videoUrl, o.totalVariants,
    o.supportsDropship, o.deliveryLimitDays, o.sourceKeyword, cls, estimate];
  const { rows } = await pool!.query(`SELECT id FROM sourcing_1688_offers WHERE offer_id = $1`, [o.offerId]);
  if (rows.length) {
    await pool!.query(
      `UPDATE sourcing_1688_offers SET title = $1, url = $2, price_cny = $3, price_range_cny = $4, moq = $5, unit = $6, stock = $7, out_of_stock = $8,
         sold_count = $9, repurchase_rate = $10, star_level = $11, supplier_name = $12, supplier_type = $13, supplier_years = $14, location = $15,
         category_path = $16, images = $17, video_url = $18, total_variants = $19, supports_dropship = $20, delivery_limit_days = $21,
         source_keyword = COALESCE($22, source_keyword), product_class = $23, estimate = $24, last_seen_at = now(), updated_at = now()
       WHERE id = $25`,
      [...values, rows[0].id]
    );
    return "updated";
  }
  await pool!.query(
    `INSERT INTO sourcing_1688_offers (title, url, price_cny, price_range_cny, moq, unit, stock, out_of_stock, sold_count, repurchase_rate, star_level,
       supplier_name, supplier_type, supplier_years, location, category_path, images, video_url, total_variants, supports_dropship, delivery_limit_days,
       source_keyword, product_class, estimate, offer_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)`,
    [...values, o.offerId]
  );
  return "created";
}

async function saveOfferExtras(o: Offer1688): Promise<{ id: string; cls: string }> {
  const { rows } = await pool!.query(
    `UPDATE sourcing_1688_offers SET variants = $1, specs = $2, selling_points = $3 WHERE offer_id = $4 RETURNING id, product_class`,
    [JSON.stringify(o.variants), JSON.stringify(o.specs), JSON.stringify(o.sellingPoints), o.offerId]
  );
  return { id: rows[0].id, cls: rows[0].product_class };
}

export interface Run1688Result { ran: boolean; reason?: string; status?: string; items?: number; created?: number; updated?: number; listed?: number; error?: string }

/** One actor run covering every enabled keyword. Never throws. */
export async function run1688Research(opts: { force?: boolean } = {}): Promise<Run1688Result> {
  if (running) return { ran: false, reason: "A research run is already in progress." };
  running = true;
  const startedAt = new Date();
  const out = { status: "ok", items: 0, created: 0, updated: 0, skipped: 0, excluded: 0, listed: 0, removed: 0, error: null as string | null, runId: null as string | null };
  let keywords: string[] = [];
  try {
    const s = await get1688Settings();
    if (!s.enabled && !opts.force) return { ran: false, reason: "1688 research is switched off in settings." };
    if (!isApifyConfigured()) return { ran: false, reason: "APIFY_API_TOKEN isn't set on the server." };
    const input = actorInput(s);
    keywords = input.keywords;
    if (!keywords.length) return { ran: false, reason: "No keywords are enabled." };
    const { cny, usd } = await rates();
    if (!cny) { logger.error("sourcing1688.no_cny_rate", {}); return { ran: false, reason: "No CNY exchange rate on file." }; }

    try {
      const { runId, items } = await runApifyActor(ACTOR_1688, input);
      out.runId = runId;
      out.items = items.length;
      const parsed = parse1688Run(items);
      out.skipped = parsed.skipped;
      out.excluded = parsed.excluded;
      if (parsed.schemaSuspect) {
        out.status = "schema_changed";
        out.error = `Only ${parsed.offers.length} of ${items.length} rows had an offer id, title and price. Fields received: ${parsed.sampleKeys.join(", ") || "(none)"}`;
        logger.error("sourcing1688.schema_changed", { items: items.length, usable: parsed.offers.length, sampleKeys: parsed.sampleKeys });
      } else {
        if (!items.length) out.status = "empty";
        const { rows: catRows } = await pool!.query(`SELECT id FROM mkt_categories`);
        const known = new Set<string>(catRows.map((r: Row) => r.id));
        if (s.listing.autoList) await ensureHouseStore();
        for (const o of parsed.offers) {
          out[await upsertOffer(o, s, cny, usd)]++;
          const { id, cls } = await saveOfferExtras(o);
          if (s.listing.autoList) {
            const outcome = await listOffer(id, o, cls, s, cny, usd, known);
            if (outcome === "listed") out.listed++;
          }
        }
        if (s.listing.autoList && items.length) out.removed = await markMissingListings(new Set(parsed.offers.map(o => o.offerId)), keywords, s);
      }
    } catch (err) {
      out.status = "failed";
      out.error = `${err instanceof ApifyError ? err.kind : "internal"}: ${err instanceof Error ? err.message : String(err)}`.slice(0, 500);
      logger.error("sourcing1688.run_failed", { error: out.error });
    }
    await pool!.query(
      `INSERT INTO sourcing_1688_runs (apify_run_id, keywords, status, items, created, updated, skipped, excluded, error, started_at, finished_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())`,
      [out.runId, JSON.stringify(keywords), out.status, out.items, out.created, out.updated, out.skipped, out.excluded, out.error, startedAt]
    ).catch(() => undefined);
    logger.info("sourcing1688.run_finished", { ...out, keywords: keywords.length });
    if (out.status === "ok") await autoSendToCj(s).catch(err => logger.error("sourcing1688.auto_send_crashed", { error: err instanceof Error ? err.message : String(err) }));
    return { ran: true, status: out.status, items: out.items, created: out.created, updated: out.updated, listed: out.listed, error: out.error ?? undefined };
  } catch (err) {
    logger.error("sourcing1688.run_crashed", { error: err instanceof Error ? err.message : String(err) });
    return { ran: false, reason: "Research run failed -- see server logs." };
  } finally {
    running = false;
  }
}

// ── Picks and CJ sourcing ────────────────────────────────────────────────

export const PICK_STATUSES = ["new", "shortlisted", "dismissed"] as const;

export async function setOfferStatus(id: string, status: typeof PICK_STATUSES[number]): Promise<Row | null> {
  const { rows } = await pool!.query(
    `UPDATE sourcing_1688_offers SET status = $1, updated_at = now() WHERE id::text = $2 AND status IN ('new', 'shortlisted', 'dismissed') RETURNING *`, [status, id]
  );
  const o = rows[0];
  if (o?.direct_product_id) {
    // Dismissing a find takes its listing down; restoring it puts it back.
    if (status === "dismissed") await pool!.query(`UPDATE mkt_products SET status = 'inactive', updated_at = now() WHERE id::text = $1`, [o.direct_product_id]);
    else await pool!.query(`UPDATE mkt_products SET status = CASE WHEN stock > 0 THEN 'active' ELSE 'out_of_stock' END, updated_at = now() WHERE id::text = $1 AND status = 'inactive'`, [o.direct_product_id]);
  }
  return o ?? null;
}

export class SourcingError extends Error { constructor(message: string, readonly status = 400) { super(message); } }

/** Files a CJ sourcing request for one offer. */
export async function sendOfferToCj(id: string): Promise<Row> {
  if (!isCjConfigured()) throw new SourcingError("CJ isn't connected.", 503);
  const { rows } = await pool!.query(`SELECT * FROM sourcing_1688_offers WHERE id::text = $1`, [id]);
  const o = rows[0];
  if (!o) throw new SourcingError("Offer not found.", 404);
  if (o.cj_sourcing_id && o.status !== "sourcing_failed") throw new SourcingError("Already sent to CJ.", 409);
  const image = (Array.isArray(o.images) ? o.images : []).find((u: string) => typeof u === "string" && u.length <= 200);
  if (!image) throw new SourcingError("CJ needs a product photo (with a link under 200 characters) -- this offer has none.");
  const estimate = o.estimate ?? {};
  const res = await createCjSourcing({
    productName: o.title,
    productImage: image,
    productUrl: o.url ?? undefined,
    thirdProductId: o.offer_id,
    price: typeof estimate.unitUsd === "number" ? estimate.unitUsd : undefined,
    remark: [o.moq ? `1688 MOQ ${o.moq}` : null, o.price_range_cny ? `1688 price ¥${o.price_range_cny}` : `1688 price ¥${o.price_cny}`, "Please source for dropshipping to South Africa."].filter(Boolean).join(". "),
  });
  if (!res?.cjSourcingId) throw new SourcingError("CJ didn't return a sourcing id.", 502);
  const { rows: updated } = await pool!.query(
    `UPDATE sourcing_1688_offers SET status = 'sent_to_cj', cj_sourcing_id = $1, cj_sourcing_status = 'Submitted', cj_fail_reason = NULL,
       sent_to_cj_at = now(), updated_at = now() WHERE id = $2 RETURNING *`,
    [String(res.cjSourcingId), o.id]
  );
  logger.info("sourcing1688.sent_to_cj", { offerId: o.offer_id, cjSourcingId: res.cjSourcingId });
  return updated[0];
}

/** Checks CJ on every open sourcing request; imports and lists the ones CJ has sourced. */
export async function syncCjSourcing(): Promise<{ checked: number; sourced: number; failed: number; listed: number }> {
  const result = { checked: 0, sourced: 0, failed: 0, listed: 0 };
  if (!isCjConfigured()) return result;
  const { rows } = await pool!.query(`SELECT id, offer_id, cj_sourcing_id, cj_product_id, direct_product_id, status FROM sourcing_1688_offers WHERE status IN ('sent_to_cj', 'sourced') AND cj_sourcing_id IS NOT NULL`);
  if (!rows.length) return result;
  const pending = rows.filter((r: Row) => r.status === "sent_to_cj");
  for (let i = 0; i < pending.length; i += 100) {
    const batch = pending.slice(i, i + 100);
    let records;
    try { records = await queryCjSourcing(batch.map((r: Row) => String(r.cj_sourcing_id))); }
    catch (err) { logger.warn("sourcing1688.cj_query_failed", { error: err instanceof Error ? err.message : String(err) }); continue; }
    for (const rec of records ?? []) {
      const row = batch.find((r: Row) => String(r.cj_sourcing_id) === String(rec.sourceId));
      if (!row) continue;
      result.checked++;
      if (rec.sourceStatus === "3" && rec.cjProductId) {
        result.sourced++;
        await pool!.query(`UPDATE sourcing_1688_offers SET status = 'sourced', cj_sourcing_status = $1, cj_product_id = $2, updated_at = now() WHERE id = $3`,
          [rec.sourceStatusStr ?? "Sourcing succeeded", String(rec.cjProductId), row.id]);
        row.status = "sourced"; row.cj_product_id = String(rec.cjProductId);
      } else if (rec.sourceStatus === "5") {
        result.failed++;
        await pool!.query(`UPDATE sourcing_1688_offers SET status = 'sourcing_failed', cj_sourcing_status = $1, cj_fail_reason = $2, updated_at = now() WHERE id = $3`,
          [rec.sourceStatusStr ?? "Sourcing failed", rec.failReasonStr ?? (rec.failReason !== null && rec.failReason !== undefined ? `CJ code ${rec.failReason}` : null), row.id]);
      } else {
        await pool!.query(`UPDATE sourcing_1688_offers SET cj_sourcing_status = $1, updated_at = now() WHERE id = $2`, [rec.sourceStatusStr ?? `Status ${rec.sourceStatus}`, row.id]);
      }
    }
  }
  // Sourced by CJ but not listed yet (just now, or an earlier import that failed): import it.
  for (const row of rows.filter((r: Row) => r.status === "sourced" && r.cj_product_id)) {
    try {
      const { listed, productId } = await importCjProductByPid(row.cj_product_id);
      if (listed && productId) {
        result.listed++;
        await pool!.query(`UPDATE sourcing_1688_offers SET status = 'listed', store_product_id = $1, updated_at = now() WHERE id = $2`, [productId, row.id]);
        // CJ now stocks and ships it: retire the agent listing in favour of CJ's.
        if (row.direct_product_id) {
          await pool!.query(`UPDATE mkt_products SET status = 'inactive', source_status = 'replaced_by_cj', updated_at = now() WHERE id::text = $1`, [row.direct_product_id]);
        }
      }
    } catch (err) {
      if (isCjPointsError(err)) break; // try the rest on the next pass
      logger.warn("sourcing1688.import_failed", { offerId: row.offer_id, cjProductId: row.cj_product_id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  if (result.checked || result.listed) logger.info("sourcing1688.cj_synced", result);
  return result;
}

// ── Worker ───────────────────────────────────────────────────────────────

const TICK_MS = 30 * 60 * 1000;
const CJ_SYNC_MS = 2 * 60 * 60 * 1000;
let lastCjSync = 0;

export async function run1688Tick(): Promise<void> {
  if (Date.now() - lastCjSync > CJ_SYNC_MS) {
    lastCjSync = Date.now();
    await syncCjSourcing().catch(err => logger.error("sourcing1688.cj_sync_failed", { error: err instanceof Error ? err.message : String(err) }));
  }
  const s = await get1688Settings();
  if (!s.enabled || !isApifyConfigured()) return;
  const { rows } = await pool!.query(`SELECT started_at FROM sourcing_1688_runs ORDER BY started_at DESC LIMIT 1`);
  if (rows[0] && Date.now() - new Date(rows[0].started_at).getTime() < s.refreshHours * 3600_000) return;
  await run1688Research();
}

export function start1688Worker(): NodeJS.Timeout | null {
  if (!pool) return null;
  const run = () => run1688Tick().catch(err => logger.error("sourcing1688.tick_failed", { error: err instanceof Error ? err.message : String(err) }));
  setTimeout(run, 90_000).unref();
  const timer = setInterval(run, TICK_MS);
  timer.unref();
  logger.info("sourcing1688.worker_started", { apifyConfigured: isApifyConfigured(), tickMinutes: TICK_MS / 60_000 });
  return timer;
}
