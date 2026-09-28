/**
 * Manager analytics for seller sourcing: supplier calls vs cache, spend,
 * errors, which sellers use it most, and what sourced products earn.
 */
import { pool } from "../../db/pool";
import { HOUSE_SELLER_ID } from "../cjCatalog";
import { PLAN_IDS, PLAN_NAMES, planLimits, startOfSaDay, startOfSaMonth, type PlanId } from "./quotas";

const DAY = 86400_000;
const MAX_LEDGER_ROWS = 200_000;

export interface AdapterUsage { adapter: string; live: number; cached: number; errors: number; costUsd: number }

export async function sourcingOverview(days = 14) {
  const since = new Date(Date.now() - days * DAY);
  // Aggregated in JS so the day buckets follow South African time.
  const { rows } = await pool!.query(
    `SELECT adapter, cached, ok, cost_estimate, created_at FROM supplier_api_calls WHERE created_at > $1 ORDER BY created_at DESC LIMIT ${MAX_LEDGER_ROWS}`, [since]);

  const byAdapter = new Map<string, AdapterUsage>();
  const daily = new Map<string, { day: string; live: number; cached: number; errors: number }>();
  for (let i = days - 1; i >= 0; i--) {
    const d = saDay(new Date(Date.now() - i * DAY));
    daily.set(d, { day: d, live: 0, cached: 0, errors: 0 });
  }
  for (const r of rows as { adapter: string; cached: boolean; ok: boolean; cost_estimate: string; created_at: Date }[]) {
    const a = byAdapter.get(r.adapter) ?? { adapter: r.adapter, live: 0, cached: 0, errors: 0, costUsd: 0 };
    const d = daily.get(saDay(new Date(r.created_at)));
    if (r.cached) { a.cached++; if (d) d.cached++; }
    else { a.live++; if (d) d.live++; a.costUsd += Number(r.cost_estimate) || 0; }
    if (!r.ok) { a.errors++; if (d) d.errors++; }
    byAdapter.set(r.adapter, a);
  }
  const totals = [...byAdapter.values()].reduce((t, a) => ({ live: t.live + a.live, cached: t.cached + a.cached, errors: t.errors + a.errors, costUsd: t.costUsd + a.costUsd }),
    { live: 0, cached: 0, errors: 0, costUsd: 0 });

  const { rows: cacheRows } = await pool!.query(`SELECT COUNT(*)::int AS n FROM sourcing_cache WHERE expires_at > $1`, [new Date()]);

  // Sellers' imported products (Ballylife's own store excluded).
  const { rows: listingRows } = await pool!.query(
    `SELECT status, COUNT(*)::int AS n FROM mkt_products WHERE fulfillment_type = 'imported' AND seller_id <> $1 GROUP BY status`, [HOUSE_SELLER_ID]);
  const listings = Object.fromEntries(listingRows.map((r: { status: string; n: number }) => [r.status, Number(r.n)]));
  const { rows: salesRows } = await pool!.query(
    `SELECT COUNT(*)::int AS lines, COALESCE(SUM(s.quantity), 0) AS units, COALESCE(SUM(s.gross_amount), 0) AS gross, COALESCE(SUM(s.platform_fee_amount), 0) AS fees
     FROM mkt_order_line_settlements s JOIN mkt_products p ON p.id = s.product_id
     WHERE p.fulfillment_type = 'imported' AND p.seller_id <> $1 AND s.created_at > $2`, [HOUSE_SELLER_ID, since]);
  const sales = salesRows[0] ?? {};

  return {
    days,
    totals: { ...totals, cacheHitRate: totals.live + totals.cached ? totals.cached / (totals.live + totals.cached) : 0, cachedEntries: Number(cacheRows[0]?.n ?? 0) },
    byAdapter: [...byAdapter.values()].sort((x, y) => x.adapter.localeCompare(y.adapter)),
    daily: [...daily.values()],
    listings: { active: listings.active ?? 0, pending: listings.pending_review ?? 0, outOfStock: listings.out_of_stock ?? 0 },
    sales: { orderLines: Number(sales.lines ?? 0), units: Number(sales.units ?? 0), grossZar: Number(sales.gross ?? 0), commissionZar: Number(sales.fees ?? 0) },
    capped: rows.length >= MAX_LEDGER_ROWS,
  };
}

/** "2026-09-28" in South African time. */
function saDay(d: Date): string { return new Date(d.getTime() + 2 * 3600_000).toISOString().slice(0, 10); }

export interface SellerSourcingRow {
  sellerId: string; storeName: string; status: string; plan: PlanId; planName: string;
  searchesToday: number; viewsToday: number; importsThisMonth: number; activeImports: number;
}

/** Sellers with their plan and usage; most active first. */
export async function sellerSourcingList(search = "", limit = 50): Promise<SellerSourcingRow[]> {
  const params: unknown[] = [HOUSE_SELLER_ID];
  let where = `s.id <> $1`;
  if (search.trim()) { params.push(`%${search.trim().toLowerCase()}%`); where += ` AND LOWER(s.store_name) LIKE $${params.length}`; }
  const { rows: sellers } = await pool!.query(
    `SELECT s.id, s.store_name, s.status, s.sourcing_plan FROM mkt_sellers s WHERE ${where} ORDER BY s.store_name LIMIT 500`, params);
  if (!sellers.length) return [];

  const ids = sellers.map((s: { id: string }) => s.id);
  const inList = ids.map((_: string, i: number) => `$${i + 2}`).join(",");
  const day = startOfSaDay(), month = startOfSaMonth();
  const { rows: usage } = await pool!.query(
    `SELECT seller_id, action, created_at FROM sourcing_usage WHERE created_at >= $1 AND seller_id IN (${inList})`,
    [month, ...ids]); // the month always starts on or before today
  const { rows: active } = await pool!.query(
    `SELECT seller_id, COUNT(*)::int AS n FROM mkt_products WHERE fulfillment_type = 'imported' AND status IN ('active','pending_review','out_of_stock')
       AND seller_id IN (${ids.map((_: string, i: number) => `$${i + 1}`).join(",")}) GROUP BY seller_id`, ids);
  const activeBy = new Map(active.map((r: { seller_id: string; n: number }) => [r.seller_id, Number(r.n)]));

  const out = sellers.map((s: { id: string; store_name: string; status: string; sourcing_plan: string }) => {
    const mine = usage.filter((u: { seller_id: string }) => u.seller_id === s.id) as { action: string; created_at: Date }[];
    const today = mine.filter(u => new Date(u.created_at) >= day);
    const plan = (PLAN_IDS.includes(s.sourcing_plan as PlanId) ? s.sourcing_plan : "starter") as PlanId;
    return {
      sellerId: s.id, storeName: s.store_name, status: s.status, plan, planName: PLAN_NAMES[plan],
      searchesToday: today.filter(u => u.action === "search").length,
      viewsToday: today.filter(u => u.action === "view").length,
      importsThisMonth: mine.filter(u => u.action === "import" && new Date(u.created_at) >= month).length,
      activeImports: Number(activeBy.get(s.id) ?? 0),
    };
  });
  out.sort((a: SellerSourcingRow, b: SellerSourcingRow) =>
    (b.searchesToday + b.importsThisMonth + b.activeImports) - (a.searchesToday + a.importsThisMonth + a.activeImports) || a.storeName.localeCompare(b.storeName));
  return out.slice(0, limit);
}

export async function savePlanLimits(input: unknown): Promise<void> {
  const current = await planLimits();
  const body = (input && typeof input === "object" ? input : {}) as Record<string, Record<string, unknown>>;
  const next = { ...current };
  for (const id of PLAN_IDS) {
    if (!body[id]) continue;
    const merged = { ...current[id] };
    for (const k of Object.keys(merged) as (keyof typeof merged)[]) {
      if (body[id][k] === undefined) continue;
      const v = Number(body[id][k]);
      if (!Number.isInteger(v) || v < 0 || v > 100_000) throw new RangeError(`${id}.${k} must be a whole number from 0 to 100000`);
      merged[k] = v;
    }
    next[id] = merged;
  }
  await pool!.query(
    `INSERT INTO sourcing_settings (key, value, updated_at) VALUES ('plans', $1, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [JSON.stringify(next)]);
}

export async function clearSourcingCache(): Promise<number> {
  const r = await pool!.query(`DELETE FROM sourcing_cache`);
  return r.rowCount ?? 0;
}
