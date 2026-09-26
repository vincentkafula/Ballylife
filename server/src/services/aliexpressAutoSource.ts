/**
 * Fills the store from AliExpress automatically, like the CJ sweep.
 *
 * Works through a list of product types (ALIEXPRESS_AUTO_KEYWORDS, or the
 * defaults below): for each it searches AliExpress (ds.text.search), keeps
 * well-selling results not already imported, and imports each one --
 * English, cheapest shipping to South Africa, sliding markup, listed like
 * any CJ product. If keyword search isn't available to the app (it can be
 * restricted while the app is in "Test" status), it uses AliExpress's own
 * dropshipping product feeds instead (ds.feedname.get + ds.recommend.feed.get).
 *
 * Paced (a few imports a minute) to stay within the app's API call limits,
 * runs once automatically after the account is connected, and can be
 * restarted from the admin panel. Progress is kept in cj_sync_jobs (id
 * 'aliexpress') so it resumes after a restart.
 */
import { pool } from "../db/pool";
import { logger } from "../utils/logger";
import { connectionStatus, callAsBuyer, AliExpressError } from "./aliexpressClient";
import { searchAe, importAeProduct, AE_SUPPLIER_ID, type AeSearchHit } from "./aliexpressCatalog";
import { cleanProductName } from "../utils/productNaming";
import { isPhotoUrl } from "../utils/supplierWhiteLabel";

type Row = Record<string, any>;
const JOB_ID = "aliexpress";
const AUTO_FLAG = "aliexpress_autosource_v1";
const PER_KEYWORD = Number(process.env.ALIEXPRESS_PER_KEYWORD ?? 12);
const IMPORTS_PER_TICK = Number(process.env.ALIEXPRESS_IMPORTS_PER_TICK ?? 4);
const MIN_ORDERS = Number(process.env.ALIEXPRESS_MIN_ORDERS ?? 50);

export const DEFAULT_AE_KEYWORDS = [
  // Categories that are thin in the store
  "educational toys", "building blocks toys", "plush toys", "rc car toy", "kids puzzle",
  "bedside table", "shoe rack organizer", "folding chair", "solar garden lights", "solar power bank",
  "safety door lock", "car jump starter",
  // Proven sellers
  "wireless earbuds", "smart watch", "phone holder car", "led strip lights", "kitchen gadgets", "vegetable chopper",
  "storage organizer", "makeup brush set", "hair straightener", "women handbag", "men wallet", "sneakers men",
  "yoga mat", "resistance bands", "pet grooming brush", "dog toys", "baby carrier", "water bottle",
];

export function aeKeywords(): string[] {
  const env = process.env.ALIEXPRESS_AUTO_KEYWORDS?.split(",").map(s => s.trim()).filter(Boolean);
  return env?.length ? env : DEFAULT_AE_KEYWORDS;
}

export async function getAeSourcingJob(): Promise<Row | null> {
  const { rows } = await pool!.query(`SELECT * FROM cj_sync_jobs WHERE id = $1`, [JOB_ID]);
  return rows[0] ?? null;
}

export async function startAeSourcing(): Promise<Row> {
  const plan = aeKeywords();
  const totals = { imported: 0, listed: 0, skipped: 0, failed: 0, mode: "search", byKeyword: {} };
  const { rows: existing } = await pool!.query(`SELECT 1 FROM cj_sync_jobs WHERE id = $1`, [JOB_ID]);
  if (existing.length) {
    await pool!.query(
      `UPDATE cj_sync_jobs SET status = 'running', mode = 'aliexpress', plan = $1, plan_index = 0, next_page = 1, end_page = 1, totals = $2,
         last_error = NULL, started_at = now(), finished_at = NULL, updated_at = now() WHERE id = $3`,
      [JSON.stringify(plan), JSON.stringify(totals), JOB_ID]
    );
  } else {
    await pool!.query(
      `INSERT INTO cj_sync_jobs (id, status, mode, plan, plan_index, next_page, end_page, page_size, totals, started_at, updated_at)
       VALUES ($1, 'running', 'aliexpress', $2, 0, 1, 1, $3, $4, now(), now())`,
      [JOB_ID, JSON.stringify(plan), PER_KEYWORD, JSON.stringify(totals)]
    );
  }
  await pool!.query(`INSERT INTO app_flags (key, detail) VALUES ($1, 'started') ON CONFLICT (key) DO NOTHING`, [AUTO_FLAG]);
  logger.info("aliexpress.autosource_started", { keywords: plan.length, perKeyword: PER_KEYWORD });
  return (await getAeSourcingJob())!;
}

// ── Candidates ──────────────────────────────────────────────────────────

const list = (v: unknown): Row[] => Array.isArray(v) ? v : v && typeof v === "object" ? ((Object.values(v as Row).find(x => Array.isArray(x)) as Row[]) ?? []) : [];
const num = (v: unknown): number | null => { const n = Number(String(v ?? "").replace(/[^\d.]/g, "")); return Number.isFinite(n) && n > 0 ? n : null; };

/** Products from AliExpress's dropshipping feeds -- the fallback when keyword search is unavailable. */
async function feedCandidates(page: number): Promise<AeSearchHit[]> {
  const names = await callAsBuyer("aliexpress.ds.feedname.get", {});
  const r = Object.values(names)[0] as Row;
  const feeds = list(r?.resp_result?.result?.promos ?? r?.result?.promos ?? r?.resp_result?.result ?? r?.result)
    .map(f => String(f.promo_name ?? f.feed_name ?? f.name ?? "")).filter(Boolean);
  const feed = feeds[(page - 1) % Math.max(1, feeds.length)];
  if (!feed) return [];
  const json = await callAsBuyer("aliexpress.ds.recommend.feed.get", {
    feed_name: feed, country: "ZA", target_currency: "USD", target_language: "EN", page_size: 50, page_no: Math.floor((page - 1) / Math.max(1, feeds.length)) + 1, sort: "volumeDesc",
  });
  const res = Object.values(json)[0] as Row;
  return list(res?.result?.products ?? res?.resp_result?.result?.products ?? res?.result).map(i => {
    const productId = String(i.product_id ?? i.productId ?? "");
    return {
      productId, title: cleanProductName(i.product_title ?? i.title ?? "") || "",
      priceUsd: num(i.target_sale_price ?? i.sale_price), image: [i.product_main_image_url].find(isPhotoUrl) ?? null,
      orders: num(i.lastest_volume ?? i.volume), rating: i.evaluate_rate ?? null, url: `https://www.aliexpress.com/item/${productId}.html`,
    };
  }).filter(h => h.productId && h.title);
}

async function alreadyImported(ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const { rows } = await pool!.query(
    `SELECT external_id FROM mkt_supplier_products WHERE supplier_id = $1 AND external_id IN (${ids.map((_, i) => `$${i + 2}`).join(",")})`,
    [AE_SUPPLIER_ID, ...ids]
  );
  return new Set(rows.map((r: Row) => String(r.external_id)));
}

// ── Tick ────────────────────────────────────────────────────────────────

export async function runAeSourcingTick(): Promise<void> {
  const status = await connectionStatus();
  if (!status.configured || !status.connected) return;
  let job = await getAeSourcingJob();
  if (!job) {
    const { rows: flag } = await pool!.query(`SELECT 1 FROM app_flags WHERE key = $1`, [AUTO_FLAG]);
    if (flag.length) return;
    job = await startAeSourcing(); // first time connected: fill the store
  }
  if (job.status !== "running") return;

  const plan: string[] = Array.isArray(job.plan) ? job.plan : [];
  const totals = { imported: 0, listed: 0, skipped: 0, failed: 0, mode: "search", byKeyword: {} as Record<string, number>, ...(job.totals ?? {}) };
  let index = Number(job.plan_index);
  let page = Number(job.next_page);
  let budget = IMPORTS_PER_TICK;

  try {
    while (budget > 0) {
      const done = totals.mode === "search" ? index >= plan.length : page > 30;
      if (done) {
        await pool!.query(`UPDATE cj_sync_jobs SET status = 'done', totals = $1, finished_at = now(), updated_at = now() WHERE id = $2`, [JSON.stringify(totals), JOB_ID]);
        logger.info("aliexpress.autosource_done", totals);
        return;
      }
      const keyword = plan[index];
      let hits: AeSearchHit[];
      try {
        hits = totals.mode === "search" ? await searchAe(keyword, 1) : await feedCandidates(page);
      } catch (err) {
        if (totals.mode === "search" && err instanceof AliExpressError && err.kind === "api") {
          // Keyword search not available to this app: switch to the product feeds.
          logger.warn("aliexpress.search_unavailable_using_feeds", { error: err.message });
          totals.mode = "feeds";
          page = 1;
          continue;
        }
        throw err;
      }
      const bucket = totals.mode === "search" ? keyword : `feed page ${page}`;
      const already = await alreadyImported(hits.map(h => h.productId));
      const taken = totals.byKeyword[bucket] ?? 0;
      const fresh = hits.filter(h => !already.has(h.productId) && (h.orders === null || h.orders >= MIN_ORDERS)).slice(0, Math.max(0, PER_KEYWORD - taken));
      if (!fresh.length) {
        if (totals.mode === "search") index++; else page++;
        continue;
      }
      for (const h of fresh.slice(0, budget)) {
        budget--;
        try {
          const r = await importAeProduct(h.productId);
          totals.imported++;
          if (r.listed) totals.listed++; else totals.skipped++;
        } catch (err) {
          if (err instanceof AliExpressError && err.kind !== "api") throw err;
          totals.failed++;
          // Record it so the same product isn't retried every tick.
          logger.warn("aliexpress.autosource_import_failed", { productId: h.productId, error: err instanceof Error ? err.message : String(err) });
        }
        totals.byKeyword[bucket] = (totals.byKeyword[bucket] ?? 0) + 1;
      }
      if ((totals.byKeyword[bucket] ?? 0) >= PER_KEYWORD) { if (totals.mode === "search") index++; else page++; }
      await pool!.query(`UPDATE cj_sync_jobs SET plan_index = $1, next_page = $2, totals = $3, last_error = NULL, updated_at = now() WHERE id = $4`,
        [index, page, JSON.stringify(totals), JOB_ID]);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await pool!.query(`UPDATE cj_sync_jobs SET plan_index = $1, next_page = $2, totals = $3, last_error = $4, updated_at = now() WHERE id = $5`,
      [index, page, JSON.stringify(totals), message.slice(0, 500), JOB_ID]);
    logger.error("aliexpress.autosource_failed", { keyword: plan[index], error: message });
  }
}
