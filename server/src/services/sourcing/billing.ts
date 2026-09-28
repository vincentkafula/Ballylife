/**
 * Seller sourcing subscription: a monthly fee (default R1,850 ~ $100) for
 * using product sourcing, billed by card through PayFast recurring billing.
 *
 *  - OFF until a manager switches it on (sourcing_settings "billing").
 *    While off, every approved seller can use sourcing on their plan.
 *  - While on, searching, opening and importing need a paid subscription
 *    (or a manager-granted free pass, mkt_sellers.sourcing_billing_exempt).
 *    Products already imported stay listed and keep selling either way.
 *  - Billed monthly in advance, no trial. Cancelling stops the card and
 *    keeps access to the end of the paid month. A missed renewal pauses
 *    access after PAYMENT_GRACE_DAYS; MAX_MISSED unpaid months end it.
 *  - A price change applies to new subscriptions; existing ones keep the
 *    price they signed up at (it's fixed on their PayFast token).
 * Billing state changes only from PayFast's ITN or the maintenance run.
 */
import { pool } from "../../db/pool";
import { logger } from "../../utils/logger";
import { isPayfastConfigured, buildSubscriptionRedirect, cancelPayfastSubscription } from "../payfastProcessor";

export const ITN_PREFIX = "ssub_";
const DAY = 86400_000;
const PAYMENT_GRACE_DAYS = 7;
const MAX_MISSED = 2;

export class BillingError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

type Row = Record<string, any>;

export interface BillingSettings { enabled: boolean; priceZar: number }
export const BILLING_DEFAULTS: BillingSettings = { enabled: false, priceZar: 1850 };

export async function billingSettings(): Promise<BillingSettings> {
  try {
    const { rows } = await pool!.query(`SELECT value FROM sourcing_settings WHERE key = 'billing'`);
    const v = rows[0]?.value ?? {};
    return {
      enabled: typeof v.enabled === "boolean" ? v.enabled : BILLING_DEFAULTS.enabled,
      priceZar: Number.isFinite(Number(v.priceZar)) && Number(v.priceZar) > 0 ? Number(v.priceZar) : BILLING_DEFAULTS.priceZar,
    };
  } catch { return { ...BILLING_DEFAULTS }; }
}

export async function saveBillingSettings(input: Partial<BillingSettings>): Promise<BillingSettings> {
  const next = { ...(await billingSettings()) };
  if (input.enabled !== undefined) {
    if (typeof input.enabled !== "boolean") throw new BillingError("enabled must be true or false");
    if (input.enabled && !isPayfastConfigured()) throw new BillingError("Card payments (PayFast) aren't set up, so sellers couldn't subscribe. Set up PayFast first.", 409);
    next.enabled = input.enabled;
  }
  if (input.priceZar !== undefined) {
    const p = Number(input.priceZar);
    if (!Number.isFinite(p) || p < 10 || p > 100_000) throw new BillingError("The monthly price must be between R10 and R100,000.");
    next.priceZar = Math.round(p * 100) / 100;
  }
  await pool!.query(
    `INSERT INTO sourcing_settings (key, value, updated_at) VALUES ('billing', $1, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [JSON.stringify(next)]);
  return next;
}

function addMonths(d: Date, n: number): Date {
  const x = new Date(d);
  const day = x.getUTCDate();
  x.setUTCMonth(x.getUTCMonth() + n);
  if (x.getUTCDate() < day) x.setUTCDate(0);
  return x;
}

export async function liveSubscription(sellerId: string): Promise<Row | null> {
  const { rows } = await pool!.query(
    `SELECT * FROM seller_sourcing_subscriptions WHERE seller_id = $1 AND status IN ('pending_payment','active','past_due') ORDER BY created_at DESC LIMIT 1`, [sellerId]);
  return rows[0] ?? null;
}

async function isExempt(sellerId: string): Promise<boolean> {
  const { rows } = await pool!.query(`SELECT sourcing_billing_exempt FROM mkt_sellers WHERE id = $1`, [sellerId]);
  return Boolean(rows[0]?.sourcing_billing_exempt);
}

export interface BillingStatus {
  required: boolean;          // billing is switched on
  hasAccess: boolean;         // may use sourcing now
  exempt: boolean;            // free pass from a manager
  priceZar: number;           // what a new subscription costs
  subscription: null | { status: string; priceZar: number; currentPeriodEnd: string | null; cancelAt: string | null };
}

export async function billingStatus(sellerId: string): Promise<BillingStatus> {
  const [settings, exempt, sub] = await Promise.all([billingSettings(), isExempt(sellerId), liveSubscription(sellerId)]);
  const paidUp = Boolean(sub && sub.status === "active" && (!sub.cancel_at || new Date(sub.cancel_at) > new Date()));
  return {
    required: settings.enabled, exempt, priceZar: settings.priceZar,
    hasAccess: !settings.enabled || exempt || paidUp,
    subscription: sub ? { status: sub.status, priceZar: Number(sub.price_zar), currentPeriodEnd: sub.current_period_end, cancelAt: sub.cancel_at } : null,
  };
}

export async function startSellerSubscription(seller: { sellerId: string; storeName: string }, email: string) {
  const settings = await billingSettings();
  if (!settings.enabled) throw new BillingError("Product sourcing is free right now — there's nothing to pay.", 409);
  if (!isPayfastConfigured()) throw new BillingError("Card payments aren't available right now. Please try again later.", 503);
  if (await isExempt(seller.sellerId)) throw new BillingError("Your store has free access to product sourcing.", 409);
  const live = await liveSubscription(seller.sellerId);
  if (live && live.status !== "pending_payment") throw new BillingError("You already have a sourcing subscription.", 409);
  if (live) await pool!.query(`UPDATE seller_sourcing_subscriptions SET status = 'expired', updated_at = now() WHERE id = $1`, [live.id]); // abandoned checkout

  const { rows } = await pool!.query(
    `INSERT INTO seller_sourcing_subscriptions (seller_id, status, price_zar) VALUES ($1, 'pending_payment', $2) RETURNING *`, [seller.sellerId, settings.priceZar]);
  const redirect = buildSubscriptionRedirect({
    subscriptionId: rows[0].id, email, planName: "",
    initialAmount: settings.priceZar, recurringAmount: settings.priceZar, billingDate: addMonths(new Date(), 1),
    mPaymentId: `${ITN_PREFIX}${rows[0].id}`, itemName: "Ballylife product sourcing (monthly)", returnQuery: "sourcing",
  });
  logger.info("sourcing_billing.checkout_started", { sellerId: seller.sellerId, subscriptionId: rows[0].id, priceZar: settings.priceZar });
  return { subscriptionId: rows[0].id, redirect };
}

/** Handles an already-verified PayFast ITN whose m_payment_id starts with ITN_PREFIX. */
export async function handleSellerSubscriptionItn(body: Record<string, string>): Promise<void> {
  const id = String(body.m_payment_id ?? "").slice(ITN_PREFIX.length);
  const { rows } = await pool!.query(`SELECT * FROM seller_sourcing_subscriptions WHERE id::text = $1`, [id]);
  const s = rows[0];
  if (!s) { logger.error("sourcing_billing.itn_unknown", { m_payment_id: body.m_payment_id }); return; }
  const status = String(body.payment_status ?? "").toUpperCase();
  const amount = Number(body.amount_gross ?? body.amount ?? 0);
  const now = new Date();

  if (status === "CANCELLED") {
    if (["cancelled", "expired"].includes(s.status)) return;
    // Cancelled at PayFast (by the seller or the bank): access runs to the end of what's paid.
    const endsAt = s.current_period_end && new Date(s.current_period_end) > now ? new Date(s.current_period_end) : now;
    await pool!.query(
      `UPDATE seller_sourcing_subscriptions SET cancelled_at = COALESCE(cancelled_at, now()), cancel_at = COALESCE(cancel_at, $2),
         status = $3, updated_at = now() WHERE id = $1`, [s.id, endsAt, endsAt <= now ? 'cancelled' : s.status]);
    logger.info("sourcing_billing.cancelled_at_payfast", { subscriptionId: s.id });
    return;
  }
  if (status !== "COMPLETE" || amount <= 0) { logger.warn("sourcing_billing.itn_not_complete", { subscriptionId: s.id, status }); return; }

  const lastEnd = s.current_period_end ? new Date(s.current_period_end) : now;
  const start = s.status === "pending_payment" || lastEnd < now ? now : lastEnd;
  const end = addMonths(start, 1);
  const { rows: paid } = await pool!.query(
    `INSERT INTO seller_sourcing_payments (subscription_id, amount, period_start, period_end, processor_ref)
     VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING id`, [s.id, amount, start, end, body.pf_payment_id ?? null]);
  if (!paid.length) return; // duplicate ITN
  await pool!.query(
    `UPDATE seller_sourcing_subscriptions SET status = CASE WHEN status IN ('pending_payment','active','past_due') THEN 'active' ELSE status END,
       payfast_token = COALESCE($2, payfast_token), commenced_at = COALESCE(commenced_at, now()),
       current_period_start = $3, current_period_end = $4, missed_periods = 0, updated_at = now() WHERE id = $1`,
    [s.id, body.token ?? null, start, end]);
  logger.info(s.status === "pending_payment" ? "sourcing_billing.started" : "sourcing_billing.renewed", { subscriptionId: s.id, amount });
}

export async function cancelSellerSubscription(sellerId: string): Promise<{ endsAt: Date | string }> {
  const s = await liveSubscription(sellerId);
  if (!s) throw new BillingError("You don't have a sourcing subscription to cancel.", 404);
  if (s.cancel_at) return { endsAt: s.cancel_at };
  if (s.payfast_token) {
    try { await cancelPayfastSubscription(s.payfast_token); }
    catch (err) {
      logger.error("sourcing_billing.payfast_cancel_failed", { subscriptionId: s.id, error: err instanceof Error ? err.message : String(err) });
      throw new BillingError("Couldn't stop card billing just now — please try again.", 502);
    }
  }
  if (s.status !== "active") {
    await pool!.query(`UPDATE seller_sourcing_subscriptions SET status = 'cancelled', cancelled_at = now(), cancel_at = now(), updated_at = now() WHERE id = $1`, [s.id]);
    return { endsAt: new Date() };
  }
  await pool!.query(`UPDATE seller_sourcing_subscriptions SET cancelled_at = now(), cancel_at = $2, updated_at = now() WHERE id = $1`, [s.id, s.current_period_end]);
  logger.info("sourcing_billing.cancelled", { subscriptionId: s.id, endsAt: s.current_period_end });
  return { endsAt: s.current_period_end };
}

export async function setBillingExempt(sellerId: string, exempt: boolean): Promise<boolean> {
  const r = await pool!.query(`UPDATE mkt_sellers SET sourcing_billing_exempt = $1 WHERE id = $2`, [exempt, sellerId]);
  return (r.rowCount ?? 0) > 0;
}

/** Ends due cancellations, drops abandoned checkouts, pauses unpaid renewals, ends long-unpaid ones. */
export async function runSellerBillingMaintenance(now = new Date()): Promise<{ ended: number; paused: number; expired: number }> {
  const { rows: ended } = await pool!.query(
    `UPDATE seller_sourcing_subscriptions SET status = 'cancelled', updated_at = now()
     WHERE status IN ('active','past_due') AND cancel_at IS NOT NULL AND cancel_at <= $1 RETURNING id`, [now]);
  const { rows: abandoned } = await pool!.query(
    `UPDATE seller_sourcing_subscriptions SET status = 'expired', updated_at = now() WHERE status = 'pending_payment' AND created_at < $1 RETURNING id`,
    [new Date(now.getTime() - DAY)]);
  let paused = 0, expired = abandoned.length;
  const { rows: overdue } = await pool!.query(
    `SELECT * FROM seller_sourcing_subscriptions WHERE status IN ('active','past_due') AND cancel_at IS NULL AND current_period_end < $1`,
    [new Date(now.getTime() - PAYMENT_GRACE_DAYS * DAY)]);
  for (const s of overdue) {
    const missed = Number(s.missed_periods) + 1;
    const nextStart = new Date(s.current_period_end);
    if (missed >= MAX_MISSED) {
      if (s.payfast_token) await cancelPayfastSubscription(s.payfast_token).catch(() => undefined);
      await pool!.query(`UPDATE seller_sourcing_subscriptions SET status = 'expired', missed_periods = $2, cancel_at = now(), updated_at = now() WHERE id = $1`, [s.id, missed]);
      expired++;
    } else {
      await pool!.query(
        `UPDATE seller_sourcing_subscriptions SET status = 'past_due', missed_periods = $2, current_period_start = $3, current_period_end = $4, updated_at = now() WHERE id = $1`,
        [s.id, missed, nextStart, addMonths(nextStart, 1)]);
      paused++;
    }
  }
  if (ended.length || paused || expired) logger.info("sourcing_billing.maintenance", { ended: ended.length, paused, expired });
  return { ended: ended.length, paused, expired };
}

/** Manager overview: paying sellers and monthly revenue. */
export async function billingSummary() {
  const { rows } = await pool!.query(
    `SELECT status, COUNT(*)::int AS n, COALESCE(SUM(price_zar), 0) AS mrr FROM seller_sourcing_subscriptions WHERE status IN ('active','past_due') GROUP BY status`);
  const by = Object.fromEntries(rows.map((r: { status: string; n: number; mrr: string }) => [r.status, r]));
  const { rows: ex } = await pool!.query(`SELECT COUNT(*)::int AS n FROM mkt_sellers WHERE sourcing_billing_exempt`);
  return {
    active: Number(by.active?.n ?? 0), pastDue: Number(by.past_due?.n ?? 0), exempt: Number(ex[0]?.n ?? 0),
    monthlyRevenueZar: Number(by.active?.mrr ?? 0),
  };
}
