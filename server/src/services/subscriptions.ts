import { pool } from "../db/pool";
import { logger } from "../utils/logger";
import { sendEmail } from "./emailService";
import {
  MORE_PLANS, MORE_TRIAL_DAYS, COOLING_OFF_DAYS, PAYMENT_GRACE_DAYS, MAX_MISSED_PERIODS,
  type MorePlan, type MorePlanId,
} from "../utils/plans";
import {
  isPayfastConfigured, buildSubscriptionRedirect, cancelPayfastSubscription, updatePayfastSubscriptionAmount,
} from "./payfastProcessor";

/**
 * BallylifeMORE subscriptions, implementing the published terms:
 *  - first-time subscribers get a MORE_TRIAL_DAYS free trial: PayFast
 *    authorises the card for R0, and the first charge is on the trial's last day
 *  - billed monthly in advance; a missed renewal pauses benefits, and
 *    MAX_MISSED_PERIODS unpaid periods end the subscription
 *  - upgrades apply now (new price from the next charge); downgrades from
 *    the next period
 *  - cancelling keeps benefits to the end of the period; within the
 *    COOLING_OFF_DAYS of starting, with no benefit used, it ends at once and
 *    any payment is refunded
 * Billing state only ever changes from PayFast's ITN (handleSubscriptionItn)
 * or the time-based maintenance run -- never optimistically.
 */

const LIVE = ["pending_payment", "trialing", "active", "past_due"];
const DAY = 86400_000;

export class SubscriptionError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

type Row = Record<string, any>;

function addMonths(d: Date, n: number): Date {
  const x = new Date(d);
  const day = x.getUTCDate();
  x.setUTCMonth(x.getUTCMonth() + n);
  if (x.getUTCDate() < day) x.setUTCDate(0); // 31st -> last day of a shorter month, per the terms
  return x;
}

export async function getLiveSubscription(userId: string): Promise<Row | null> {
  const { rows } = await pool!.query(
    `SELECT * FROM mkt_subscriptions WHERE user_id = $1 AND status IN ('pending_payment','trialing','active','past_due') ORDER BY created_at DESC LIMIT 1`,
    [userId]
  );
  return rows[0] ?? null;
}

/** The plan whose benefits apply right now, or null. Paused (past_due) and ended memberships give nothing. */
export async function activeMembership(userId: string): Promise<{ subscriptionId: string; plan: MorePlan } | null> {
  const s = await getLiveSubscription(userId);
  if (!s || !["trialing", "active"].includes(s.status)) return null;
  if (s.cancel_at && new Date(s.cancel_at) <= new Date()) return null;
  const plan = MORE_PLANS[s.plan as MorePlanId];
  return plan ? { subscriptionId: s.id, plan } : null;
}

export async function markBenefitUsed(subscriptionId: string): Promise<void> {
  await pool!.query(`UPDATE mkt_subscriptions SET benefit_used = true, updated_at = now() WHERE id = $1 AND NOT benefit_used`, [subscriptionId]);
}

// ── Subscribe ──────────────────────────────────────────────────────────────

export async function startSubscription(user: { userId: string; email: string }, planId: string) {
  const plan = MORE_PLANS[planId as MorePlanId];
  if (!plan) throw new SubscriptionError("Choose the Standard or Premium plan.");
  if (!isPayfastConfigured()) throw new SubscriptionError("Subscriptions open as soon as card payments are switched on. Please check back soon.", 503);

  const live = await getLiveSubscription(user.userId);
  if (live && live.status !== "pending_payment") throw new SubscriptionError("You already have a BallylifeMORE plan — change or cancel it from your subscription page.", 409);
  if (live) await pool!.query(`UPDATE mkt_subscriptions SET status = 'expired', updated_at = now() WHERE id = $1`, [live.id]); // abandoned checkout

  // One free trial per person, ever (the terms: "one per person, not one per plan").
  const { rows: prior } = await pool!.query(`SELECT 1 FROM mkt_subscriptions WHERE user_id = $1 AND commenced_at IS NOT NULL LIMIT 1`, [user.userId]);
  const trial = prior.length === 0;

  const { rows } = await pool!.query(
    `INSERT INTO mkt_subscriptions (user_id, plan, status) VALUES ($1, $2, 'pending_payment') RETURNING *`, [user.userId, plan.id]
  );
  const now = new Date();
  const redirect = buildSubscriptionRedirect({
    subscriptionId: rows[0].id, email: user.email, planName: plan.name,
    initialAmount: trial ? 0 : plan.monthlyPriceZar,
    recurringAmount: plan.monthlyPriceZar,
    billingDate: trial ? new Date(now.getTime() + MORE_TRIAL_DAYS * DAY) : addMonths(now, 1),
  });
  logger.info("subscription.checkout_started", { subscriptionId: rows[0].id, plan: plan.id, trial });
  return { subscriptionId: rows[0].id, trial, redirect };
}

// ── PayFast notifications ──────────────────────────────────────────────────

/** Handles an already-verified PayFast ITN whose m_payment_id is `sub_<id>`. */
export async function handleSubscriptionItn(body: Record<string, string>): Promise<void> {
  const id = String(body.m_payment_id ?? "").replace(/^sub_/, "");
  const { rows } = await pool!.query(`SELECT * FROM mkt_subscriptions WHERE id::text = $1`, [id]);
  const s = rows[0];
  if (!s) { logger.error("subscription.itn_unknown", { m_payment_id: body.m_payment_id }); return; }
  const status = String(body.payment_status ?? "").toUpperCase();
  const amount = Number(body.amount_gross ?? body.amount ?? 0);
  const now = new Date();

  if (status === "CANCELLED") {
    if (["cancelled", "expired"].includes(s.status)) return;
    await pool!.query(
      `UPDATE mkt_subscriptions SET status = 'cancelled', cancelled_at = COALESCE(cancelled_at, now()), cancel_at = COALESCE(cancel_at, now()), updated_at = now() WHERE id = $1`, [s.id]
    );
    logger.info("subscription.cancelled_at_payfast", { subscriptionId: s.id });
    return;
  }
  if (status !== "COMPLETE") { logger.warn("subscription.itn_not_complete", { subscriptionId: s.id, status }); return; }

  if (s.status === "pending_payment") {
    // The card has just been authorised: the subscription starts now.
    if (amount <= 0) {
      const trialEnd = new Date(now.getTime() + MORE_TRIAL_DAYS * DAY);
      await pool!.query(
        `UPDATE mkt_subscriptions SET status = 'trialing', payfast_token = $2, commenced_at = now(), trial_ends_at = $3,
           current_period_start = now(), current_period_end = $3, updated_at = now() WHERE id = $1`, [s.id, body.token ?? null, trialEnd]
      );
    } else {
      const end = addMonths(now, 1);
      await pool!.query(
        `UPDATE mkt_subscriptions SET status = 'active', payfast_token = $2, commenced_at = now(),
           current_period_start = now(), current_period_end = $3, updated_at = now() WHERE id = $1`, [s.id, body.token ?? null, end]
      );
      await recordPayment(s.id, s.plan, amount, now, end, body.pf_payment_id);
    }
    logger.info("subscription.started", { subscriptionId: s.id, plan: s.plan, trial: amount <= 0 });
    return;
  }

  // A renewal charge. The new period starts where the last one ended (or
  // now, if it was already overdue); a scheduled downgrade takes effect.
  if (amount <= 0) return;
  const lastEnd = s.current_period_end ? new Date(s.current_period_end) : now;
  const start = lastEnd > now ? lastEnd : now;
  const end = addMonths(start, 1);
  const plan = s.pending_plan ?? s.plan;
  const inserted = await recordPayment(s.id, plan, amount, start, end, body.pf_payment_id);
  if (!inserted) return; // duplicate ITN
  await pool!.query(
    `UPDATE mkt_subscriptions SET status = CASE WHEN status IN ('trialing','active','past_due') THEN 'active' ELSE status END,
       plan = $2, pending_plan = NULL, current_period_start = $3, current_period_end = $4, missed_periods = 0,
       payfast_token = COALESCE($5, payfast_token), updated_at = now() WHERE id = $1`,
    [s.id, plan, start, end, body.token ?? null]
  );
  logger.info("subscription.renewed", { subscriptionId: s.id, plan, amount });
}

async function recordPayment(subscriptionId: string, plan: string, amount: number, start: Date, end: Date, ref?: string): Promise<boolean> {
  const { rows } = await pool!.query(
    `INSERT INTO mkt_subscription_payments (subscription_id, amount, status, plan, period_start, period_end, processor_ref)
     VALUES ($1,$2,'paid',$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING id`,
    [subscriptionId, amount, plan, start, end, ref ?? null]
  );
  return rows.length > 0;
}

// ── Change plan ────────────────────────────────────────────────────────────

export async function changePlan(userId: string, planId: string) {
  const target = MORE_PLANS[planId as MorePlanId];
  if (!target) throw new SubscriptionError("Choose the Standard or Premium plan.");
  const s = await getLiveSubscription(userId);
  if (!s || !["trialing", "active"].includes(s.status)) {
    throw new SubscriptionError(s?.status === "past_due" ? "Settle the outstanding payment before switching plans." : "You don't have an active plan to change.", 409);
  }
  if (s.cancel_at) throw new SubscriptionError("This plan is set to end — resubscribe after it ends to choose a new plan.", 409);
  const current = MORE_PLANS[s.plan as MorePlanId];

  if (target.id === s.plan) {
    if (!s.pending_plan) throw new SubscriptionError(`You're already on ${target.name}.`, 409);
    await applyPayfastAmount(s, current.monthlyPriceZar);
    await pool!.query(`UPDATE mkt_subscriptions SET pending_plan = NULL, updated_at = now() WHERE id = $1`, [s.id]);
    return { effective: "now", plan: current.id };
  }

  await applyPayfastAmount(s, target.monthlyPriceZar);
  if (target.monthlyPriceZar > current.monthlyPriceZar) {
    // Upgrade: benefits now; the higher price from the next charge.
    await pool!.query(`UPDATE mkt_subscriptions SET plan = $2, pending_plan = NULL, updated_at = now() WHERE id = $1`, [s.id, target.id]);
    return { effective: "now", plan: target.id };
  }
  // Downgrade: from the first day of the next period.
  await pool!.query(`UPDATE mkt_subscriptions SET pending_plan = $2, updated_at = now() WHERE id = $1`, [s.id, target.id]);
  return { effective: s.current_period_end, plan: target.id };
}

async function applyPayfastAmount(s: Row, amount: number) {
  if (!s.payfast_token) return;
  try { await updatePayfastSubscriptionAmount(s.payfast_token, amount); }
  catch (err) {
    logger.error("subscription.payfast_update_failed", { subscriptionId: s.id, error: err instanceof Error ? err.message : String(err) });
    throw new SubscriptionError("Couldn't update your card billing just now — please try again.", 502);
  }
}

// ── Cancel ─────────────────────────────────────────────────────────────────

export async function cancelSubscription(userId: string) {
  const s = await getLiveSubscription(userId);
  if (!s) throw new SubscriptionError("You don't have a BallylifeMORE plan to cancel.", 404);
  if (s.cancel_at) return { endsAt: s.cancel_at, refund: false };

  if (s.payfast_token) {
    try { await cancelPayfastSubscription(s.payfast_token); }
    catch (err) {
      logger.error("subscription.payfast_cancel_failed", { subscriptionId: s.id, error: err instanceof Error ? err.message : String(err) });
      throw new SubscriptionError("Couldn't stop card billing just now — please try again.", 502);
    }
  }

  const now = new Date();
  const inCoolingOff = s.commenced_at && now.getTime() - new Date(s.commenced_at).getTime() <= COOLING_OFF_DAYS * DAY && !s.benefit_used;
  const endNow = s.status === "pending_payment" || s.status === "past_due" || inCoolingOff;

  if (endNow) {
    await pool!.query(`UPDATE mkt_subscriptions SET status = 'cancelled', cancelled_at = now(), cancel_at = now(), updated_at = now() WHERE id = $1`, [s.id]);
    let refund = false;
    if (inCoolingOff) {
      const { rows } = await pool!.query(
        `UPDATE mkt_subscription_payments SET status = 'refund_due' WHERE subscription_id = $1 AND status = 'paid' RETURNING amount, processor_ref`, [s.id]
      );
      refund = rows.length > 0;
      if (refund) await alertRefundDue(s, rows);
    }
    logger.info("subscription.cancelled", { subscriptionId: s.id, immediate: true, coolingOff: Boolean(inCoolingOff) });
    return { endsAt: now, refund };
  }

  // Otherwise benefits continue to the end of what's been paid for (or the trial).
  const endsAt = s.status === "trialing" ? s.trial_ends_at : s.current_period_end;
  await pool!.query(`UPDATE mkt_subscriptions SET cancelled_at = now(), cancel_at = $2, pending_plan = NULL, updated_at = now() WHERE id = $1`, [s.id, endsAt]);
  logger.info("subscription.cancelled", { subscriptionId: s.id, endsAt });
  return { endsAt, refund: false };
}

async function alertRefundDue(s: Row, payments: Row[]) {
  const total = payments.reduce((n, p) => n + Number(p.amount), 0);
  logger.warn("subscription.refund_due", { subscriptionId: s.id, amount: total, refs: payments.map(p => p.processor_ref) });
  const to = process.env.ADMIN_ALERT_EMAIL;
  if (!to) return;
  await sendEmail({
    to, subject: `Refund due: BallylifeMORE cooling-off cancellation (R${total.toFixed(2)})`,
    html: `<p>A subscriber cancelled within the ${COOLING_OFF_DAYS}-day cooling-off period without using any benefit, so they're owed a full refund of <b>R${total.toFixed(2)}</b>.</p>
           <p>Refund PayFast payment(s) ${payments.map(p => p.processor_ref ?? "?").join(", ")} from the PayFast dashboard.</p>`,
  }).catch(() => undefined);
}

// ── Time-based maintenance ────────────────────────────────────────────────

/** Ends cancellations that are due, pauses unpaid renewals, and ends subscriptions after too many missed periods. */
export async function runSubscriptionMaintenance(now = new Date()): Promise<{ ended: number; paused: number; expired: number }> {
  const graceCutoff = new Date(now.getTime() - PAYMENT_GRACE_DAYS * DAY);
  const { rows: ended } = await pool!.query(
    `UPDATE mkt_subscriptions SET status = 'cancelled', updated_at = now()
     WHERE status IN ('trialing','active','past_due') AND cancel_at IS NOT NULL AND cancel_at <= $1 RETURNING id`, [now]
  );
  const { rows: abandoned } = await pool!.query(
    `UPDATE mkt_subscriptions SET status = 'expired', updated_at = now() WHERE status = 'pending_payment' AND created_at < $1 RETURNING id`,
    [new Date(now.getTime() - DAY)]
  );

  let paused = 0, expired = abandoned.length;
  const { rows: overdue } = await pool!.query(
    `SELECT * FROM mkt_subscriptions WHERE status IN ('trialing','active','past_due') AND cancel_at IS NULL AND current_period_end < $1`, [graceCutoff]
  );
  for (const s of overdue) {
    // Each whole unpaid period counts as one missed payment.
    const missed = Number(s.missed_periods) + 1;
    const nextStart = new Date(s.current_period_end);
    if (missed >= MAX_MISSED_PERIODS) {
      if (s.payfast_token) await cancelPayfastSubscription(s.payfast_token).catch(() => undefined);
      await pool!.query(`UPDATE mkt_subscriptions SET status = 'expired', missed_periods = $2, cancel_at = now(), updated_at = now() WHERE id = $1`, [s.id, missed]);
      expired++;
    } else {
      await pool!.query(
        `UPDATE mkt_subscriptions SET status = 'past_due', missed_periods = $2, current_period_start = $3, current_period_end = $4, updated_at = now() WHERE id = $1`,
        [s.id, missed, nextStart, addMonths(nextStart, 1)]
      );
      paused++;
    }
  }
  if (ended.length || paused || expired) logger.info("subscription.maintenance", { ended: ended.length, paused, expired });
  return { ended: ended.length, paused, expired };
}

export function mapSubscription(s: Row | null) {
  if (!s) return null;
  const plan = MORE_PLANS[s.plan as MorePlanId];
  return {
    id: s.id, plan: s.plan, planName: plan?.name, monthlyPriceZar: plan?.monthlyPriceZar, status: s.status,
    pendingPlan: s.pending_plan, trialEndsAt: s.trial_ends_at, currentPeriodStart: s.current_period_start,
    currentPeriodEnd: s.current_period_end, nextBillingDate: s.cancel_at ? null : s.current_period_end,
    cancelAt: s.cancel_at, cancelledAt: s.cancelled_at, commencedAt: s.commenced_at,
    benefitsActive: ["trialing", "active"].includes(s.status) && (!s.cancel_at || new Date(s.cancel_at) > new Date()),
    missedPeriods: s.missed_periods,
  };
}
