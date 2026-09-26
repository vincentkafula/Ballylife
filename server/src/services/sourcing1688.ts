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
 * Shoppers never see 1688 data: nothing here is served by storefront routes.
 */
import { pool } from "../db/pool";
import { logger } from "../utils/logger";
import { runApifyActor, isApifyConfigured, ApifyError } from "./apifyClient";
import { createCjSourcing, queryCjSourcing, isCjConfigured, isCjPointsError } from "./cjDropshippingClient";
import { importCjProductByPid } from "./cjCatalog";
import {
  normalise1688Settings, DEFAULT_1688_SETTINGS, actorInput, parse1688Run, estimate1688, classFor,
  type Sourcing1688Settings, type Offer1688,
} from "../utils/sourcing1688";

type Row = Record<string, any>;
export const ACTOR_1688 = process.env.SOURCING_1688_ACTOR_ID || "sourabhbgp~1688-scraper";

// ── Settings ─────────────────────────────────────────────────────────────

export async function get1688Settings(): Promise<Sourcing1688Settings> {
  const { rows } = await pool!.query(`SELECT settings FROM sourcing_1688_settings WHERE id = 'default'`);
  return normalise1688Settings(rows[0]?.settings ?? DEFAULT_1688_SETTINGS);
}

export async function save1688Settings(input: unknown, userId: string): Promise<{ settings: Sourcing1688Settings; reestimated: number }> {
  const settings = normalise1688Settings(input);
  const { rows } = await pool!.query(`SELECT 1 FROM sourcing_1688_settings WHERE id = 'default'`);
  if (rows.length) await pool!.query(`UPDATE sourcing_1688_settings SET settings = $1, updated_at = now(), updated_by = $2 WHERE id = 'default'`, [JSON.stringify(settings), userId]);
  else await pool!.query(`INSERT INTO sourcing_1688_settings (id, settings, updated_by) VALUES ('default', $1, $2)`, [JSON.stringify(settings), userId]);
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
export async function reestimateAll(settings?: Sourcing1688Settings): Promise<number> {
  const s = settings ?? await get1688Settings();
  const { cny, usd } = await rates();
  if (!cny) return 0;
  const { rows } = await pool!.query(`SELECT id, title, price_cny, source_keyword FROM sourcing_1688_offers`);
  for (const r of rows) {
    const kwClass = s.keywords.find(k => k.keyword === r.source_keyword)?.productClass ?? "auto";
    const cls = classFor(r.title, kwClass);
    await pool!.query(`UPDATE sourcing_1688_offers SET product_class = $1, estimate = $2 WHERE id = $3`,
      [cls, JSON.stringify(estimate1688(Number(r.price_cny), cls, cny, usd, s)), r.id]);
  }
  return rows.length;
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

export interface Run1688Result { ran: boolean; reason?: string; status?: string; items?: number; created?: number; updated?: number; error?: string }

/** One actor run covering every enabled keyword. Never throws. */
export async function run1688Research(opts: { force?: boolean } = {}): Promise<Run1688Result> {
  if (running) return { ran: false, reason: "A research run is already in progress." };
  running = true;
  const startedAt = new Date();
  const out = { status: "ok", items: 0, created: 0, updated: 0, skipped: 0, excluded: 0, error: null as string | null, runId: null as string | null };
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
        for (const o of parsed.offers) out[await upsertOffer(o, s, cny, usd)]++;
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
    return { ran: true, status: out.status, items: out.items, created: out.created, updated: out.updated, error: out.error ?? undefined };
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
  return rows[0] ?? null;
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
  const { rows } = await pool!.query(`SELECT id, offer_id, cj_sourcing_id, cj_product_id, status FROM sourcing_1688_offers WHERE status IN ('sent_to_cj', 'sourced') AND cj_sourcing_id IS NOT NULL`);
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
