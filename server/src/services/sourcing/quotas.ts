/**
 * Seller sourcing plans and limits. Every seller is on a plan (mkt_sellers.
 * sourcing_plan, default starter); managers can move a seller between plans
 * and change the numbers (sourcing_settings "plans").
 *
 * Days and months are counted in South African time.
 */
import { pool } from "../../db/pool";

export type PlanId = "starter" | "standard" | "pro";
export interface PlanLimits { searchesPerDay: number; viewsPerDay: number; activeImports: number; importsPerMonth: number }
export type UsageAction = "search" | "view" | "import";

const STARTER: PlanLimits = { searchesPerDay: 20, viewsPerDay: 60, activeImports: 25, importsPerMonth: 50 };
const times = (n: number): PlanLimits => ({
  searchesPerDay: STARTER.searchesPerDay * n, viewsPerDay: STARTER.viewsPerDay * n,
  activeImports: STARTER.activeImports * n, importsPerMonth: STARTER.importsPerMonth * n,
});
export const PLAN_DEFAULTS: Record<PlanId, PlanLimits> = { starter: STARTER, standard: times(5), pro: times(20) };
export const PLAN_IDS = Object.keys(PLAN_DEFAULTS) as PlanId[];
export const PLAN_NAMES: Record<PlanId, string> = { starter: "Starter", standard: "Standard", pro: "Pro" };

export class QuotaError extends Error {
  constructor(message: string, public limit: keyof PlanLimits) { super(message); }
}

const SA_OFFSET_MS = 2 * 3600_000; // South Africa: UTC+2, no daylight saving
export function startOfSaDay(now = new Date()): Date {
  const sa = new Date(now.getTime() + SA_OFFSET_MS);
  return new Date(Date.UTC(sa.getUTCFullYear(), sa.getUTCMonth(), sa.getUTCDate()) - SA_OFFSET_MS);
}
export function startOfSaMonth(now = new Date()): Date {
  const sa = new Date(now.getTime() + SA_OFFSET_MS);
  return new Date(Date.UTC(sa.getUTCFullYear(), sa.getUTCMonth(), 1) - SA_OFFSET_MS);
}

export async function planLimits(): Promise<Record<PlanId, PlanLimits>> {
  let saved: Partial<Record<PlanId, Partial<PlanLimits>>> = {};
  try {
    const { rows } = await pool!.query(`SELECT value FROM sourcing_settings WHERE key = 'plans'`);
    if (rows[0]?.value && typeof rows[0].value === "object") saved = rows[0].value;
  } catch { /* defaults */ }
  return Object.fromEntries(PLAN_IDS.map(id => [id, { ...PLAN_DEFAULTS[id], ...(saved[id] ?? {}) }])) as Record<PlanId, PlanLimits>;
}

export async function sellerPlan(sellerId: string): Promise<PlanId> {
  const { rows } = await pool!.query(`SELECT sourcing_plan FROM mkt_sellers WHERE id = $1`, [sellerId]);
  const p = rows[0]?.sourcing_plan;
  return PLAN_IDS.includes(p) ? p : "starter";
}

async function countUsage(sellerId: string, action: UsageAction, since: Date): Promise<number> {
  const { rows } = await pool!.query(
    `SELECT COUNT(*)::int AS n FROM sourcing_usage WHERE seller_id = $1 AND action = $2 AND created_at >= $3`, [sellerId, action, since]);
  return Number(rows[0]?.n ?? 0);
}

/** Listings in the seller's store that came from the supplier catalogue and are live or waiting for review. */
async function activeImportCount(sellerId: string): Promise<number> {
  const { rows } = await pool!.query(
    `SELECT COUNT(*)::int AS n FROM mkt_products WHERE seller_id = $1 AND fulfillment_type = 'imported'
       AND status IN ('active', 'pending_review', 'out_of_stock')`, [sellerId]);
  return Number(rows[0]?.n ?? 0);
}

export interface QuotaStatus {
  plan: PlanId; planName: string; limits: PlanLimits;
  used: { searchesToday: number; viewsToday: number; activeImports: number; importsThisMonth: number };
}

export async function quotaStatus(sellerId: string): Promise<QuotaStatus> {
  const [plan, limits] = await Promise.all([sellerPlan(sellerId), planLimits()]);
  const day = startOfSaDay(), month = startOfSaMonth();
  const [searchesToday, viewsToday, activeImports, importsThisMonth] = await Promise.all([
    countUsage(sellerId, "search", day), countUsage(sellerId, "view", day), activeImportCount(sellerId), countUsage(sellerId, "import", month),
  ]);
  return { plan, planName: PLAN_NAMES[plan], limits: limits[plan], used: { searchesToday, viewsToday, activeImports, importsThisMonth } };
}

const UPGRADE = "Ask the Ballylife team about a bigger plan.";

/** Throws QuotaError when the seller has used up this action; otherwise nothing. */
export async function checkQuota(sellerId: string, action: UsageAction): Promise<void> {
  const q = await quotaStatus(sellerId);
  if (action === "search" && q.used.searchesToday >= q.limits.searchesPerDay)
    throw new QuotaError(`You've used all ${q.limits.searchesPerDay} product searches for today. They reset at midnight. ${UPGRADE}`, "searchesPerDay");
  if (action === "view" && q.used.viewsToday >= q.limits.viewsPerDay)
    throw new QuotaError(`You've opened ${q.limits.viewsPerDay} products today, the most your plan allows. They reset at midnight. ${UPGRADE}`, "viewsPerDay");
  if (action === "import") {
    if (q.used.activeImports >= q.limits.activeImports)
      throw new QuotaError(`Your plan allows ${q.limits.activeImports} imported products in your store. Remove one to add another. ${UPGRADE}`, "activeImports");
    if (q.used.importsThisMonth >= q.limits.importsPerMonth)
      throw new QuotaError(`You've imported ${q.limits.importsPerMonth} products this month, the most your plan allows. ${UPGRADE}`, "importsPerMonth");
  }
}

export async function recordUsage(sellerId: string, action: UsageAction): Promise<void> {
  await pool!.query(`INSERT INTO sourcing_usage (seller_id, action) VALUES ($1, $2)`, [sellerId, action]);
}

export async function setSellerPlan(sellerId: string, plan: PlanId): Promise<boolean> {
  if (!PLAN_IDS.includes(plan)) throw new Error("Unknown plan");
  const r = await pool!.query(`UPDATE mkt_sellers SET sourcing_plan = $1 WHERE id = $2`, [plan, sellerId]);
  return (r.rowCount ?? 0) > 0;
}
