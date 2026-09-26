import { pool } from "../db/pool";
import { logger } from "../utils/logger";
import { round2 } from "../utils/pricing";
import {
  businessRebatePct, CREDIT_REWARD_PCT, CREDIT_REWARD_DELAY_DAYS, STORE_CREDIT_EXPIRY_YEARS,
} from "../utils/plans";
import { runSubscriptionMaintenance } from "./subscriptions";

/**
 * Store credit and the two programmes that pay into it:
 *  - Ballylife for Business: a monthly rebate on the previous month's Net
 *    Merchandise Value (goods excl. VAT, delivery and discounts), tiered
 *  - Ballylife.credit Rewards: CREDIT_REWARD_PCT of what was paid with a
 *    Ballylife.credit account, accruing CREDIT_REWARD_DELAY_DAYS after
 *    delivery and released at the next quarter start
 * The ledger is append-only and every entry has a unique reference, so a
 * rebate, reward or redemption can never be applied twice.
 */

const DAY = 86400_000;
type Queryable = { query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }> };

function yearsFrom(d: Date, years: number) { const x = new Date(d); x.setUTCFullYear(x.getUTCFullYear() + years); return x; }

/** Spendable balance: earned credit that's released and unexpired, less what's been spent. */
export async function storeCreditBalance(userId: string, db: Queryable = pool!): Promise<number> {
  const { rows } = await db.query(
    `SELECT amount, available_at, expires_at FROM mkt_store_credit_ledger WHERE user_id = $1`, [userId]
  );
  const now = Date.now();
  let balance = 0;
  for (const r of rows) {
    const amt = Number(r.amount);
    if (amt < 0) { balance += amt; continue; }
    if (new Date(r.available_at).getTime() > now) continue;
    if (r.expires_at && new Date(r.expires_at).getTime() <= now) continue;
    balance += amt;
  }
  return Math.max(0, round2(balance));
}

export async function addLedgerEntry(db: Queryable, e: {
  userId: string; amount: number; source: string; reference: string; description?: string; availableAt?: Date; expiresAt?: Date | null;
}): Promise<boolean> {
  // Checked explicitly as well as by the unique index, so a repeat run is a
  // no-op on any database, not just ones that honour ON CONFLICT.
  const { rows: seen } = await db.query(`SELECT 1 FROM mkt_store_credit_ledger WHERE reference = $1`, [e.reference]);
  if (seen.length) return false;
  const { rows } = await db.query(
    `INSERT INTO mkt_store_credit_ledger (user_id, amount, source, reference, description, available_at, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (reference) DO NOTHING RETURNING id`,
    [e.userId, round2(e.amount), e.source, e.reference, e.description ?? null, e.availableAt ?? new Date(), e.expiresAt ?? null]
  );
  return rows.length > 0;
}

export async function storeCreditEntries(userId: string) {
  const { rows } = await pool!.query(
    `SELECT amount, source, description, available_at, expires_at, created_at FROM mkt_store_credit_ledger WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100`, [userId]
  );
  return rows.map(r => ({
    amount: Number(r.amount), source: r.source, description: r.description,
    availableAt: r.available_at, expiresAt: r.expires_at, createdAt: r.created_at,
  }));
}

// ── Ballylife for Business ────────────────────────────────────────────────

const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
const monthStart = (y: number, m: number) => new Date(Date.UTC(y, m, 1));

/** Net Merchandise Value of a user's paid, un-cancelled orders placed in [from, to). */
export async function netMerchandiseValue(userId: string, from: Date, to: Date): Promise<number> {
  const { rows } = await pool!.query(
    `SELECT subtotal, discount_amount, refunded_amount, status, payment_status FROM mkt_orders
     WHERE user_id = $1 AND placed_at >= $2 AND placed_at < $3`, [userId, from, to]
  );
  let nmv = 0;
  for (const o of rows) {
    if (o.payment_status !== "payment_confirmed" || ["cancelled", "refunded", "payment_failed"].includes(o.status)) continue;
    nmv += Number(o.subtotal) - Number(o.discount_amount ?? 0) - Number(o.refunded_amount ?? 0);
  }
  return Math.max(0, round2(nmv));
}

/** Credits last month's rebate to every approved business (idempotent per business per month). */
export async function runBusinessRebates(now = new Date()): Promise<number> {
  const to = monthStart(now.getUTCFullYear(), now.getUTCMonth());
  const from = monthStart(to.getUTCFullYear(), to.getUTCMonth() - 1);
  const key = monthKey(from);
  const { rows: accounts } = await pool!.query(`SELECT * FROM mkt_business_accounts WHERE status = 'approved' AND decided_at < $1`, [to]);
  let credited = 0;
  for (const a of accounts) {
    const nmv = await netMerchandiseValue(a.user_id, from, to);
    const pct = businessRebatePct(nmv);
    if (!pct) continue;
    const ok = await addLedgerEntry(pool!, {
      userId: a.user_id, amount: nmv * pct / 100, source: "business_rebate", reference: `rebate:${a.id}:${key}`,
      description: `Ballylife for Business rebate for ${key}: ${pct}% of R${nmv.toFixed(2)}`,
      expiresAt: yearsFrom(now, STORE_CREDIT_EXPIRY_YEARS),
    });
    if (ok) credited++;
  }
  if (credited) logger.info("business.rebates_credited", { month: key, count: credited });
  return credited;
}

// ── Ballylife.credit Rewards ───────────────────────────────────────────────

function nextQuarterStart(d: Date): Date {
  const q = Math.floor(d.getUTCMonth() / 3);
  return monthStart(d.getUTCFullYear(), (q + 1) * 3);
}

/** Accrues rewards on delivered Ballylife.credit orders once the returns window has passed. */
export async function runCreditRewards(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - CREDIT_REWARD_DELAY_DAYS * DAY);
  const { rows } = await pool!.query(
    `SELECT id, user_id, order_number, total_amount, refunded_amount, delivered_at, credit_provider_id FROM mkt_orders
     WHERE credit_decision = 'approved' AND status = 'delivered'`
  );
  let accrued = 0;
  for (const o of rows) {
    // Date and provider checks in code: simple, and portable across Postgres and the in-memory test database.
    if (!o.credit_provider_id || !o.delivered_at || new Date(o.delivered_at) > cutoff) continue;
    const paid = Number(o.total_amount) - Number(o.refunded_amount ?? 0);
    if (paid <= 0) continue;
    const earnedAt = new Date(new Date(o.delivered_at).getTime() + CREDIT_REWARD_DELAY_DAYS * DAY);
    const ok = await addLedgerEntry(pool!, {
      userId: o.user_id, amount: paid * CREDIT_REWARD_PCT / 100, source: "credit_reward", reference: `credit-reward:${o.id}`,
      description: `Ballylife.credit reward on order ${o.order_number} (${CREDIT_REWARD_PCT}%)`,
      availableAt: nextQuarterStart(earnedAt), expiresAt: yearsFrom(nextQuarterStart(earnedAt), STORE_CREDIT_EXPIRY_YEARS),
    });
    if (ok) accrued++;
  }
  if (accrued) logger.info("credit_rewards.accrued", { count: accrued });
  return accrued;
}

// ── Worker ────────────────────────────────────────────────────────────────

let running = false;
export async function runProgrammesCycle(): Promise<void> {
  if (running) return;
  running = true;
  try {
    await runSubscriptionMaintenance();
    await runBusinessRebates();
    await runCreditRewards();
  } catch (err) {
    logger.error("programmes.cycle_failed", { error: err instanceof Error ? err.message : String(err) });
  } finally {
    running = false;
  }
}

export function startProgrammesWorker(intervalMs = 60 * 60 * 1000): NodeJS.Timeout {
  setTimeout(() => { void runProgrammesCycle(); }, 20_000).unref();
  const t = setInterval(() => { void runProgrammesCycle(); }, intervalMs);
  t.unref();
  return t;
}
