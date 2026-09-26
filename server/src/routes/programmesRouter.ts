import { Router, Request, Response } from "express";
import { pool } from "../db/pool";
import { requireAuth, requireRole } from "../middleware/auth";
import { logger } from "../utils/logger";
import { publicPlans, businessRebatePct, BUSINESS_REBATE_TIERS, MORE_PLANS, type MorePlanId } from "../utils/plans";
import {
  startSubscription, changePlan, cancelSubscription, getLiveSubscription, mapSubscription, SubscriptionError,
} from "../services/subscriptions";
import { storeCreditBalance, storeCreditEntries, netMerchandiseValue } from "../services/programmes";

/**
 * BallylifeMORE subscriptions, store credit, Ballylife for Business and
 * the admin views over them. Plan prices and rules: utils/plans.ts.
 */
const router: ReturnType<typeof Router> = Router();
const MANAGER_ROLES = ["marketplace_admin"] as const;

const fail = (res: Response, err: unknown, fallback: string) => {
  if (err instanceof SubscriptionError) { res.status(err.status).json({ success: false, error: err.message }); return; }
  logger.error("programmes.request_failed", { error: err instanceof Error ? err.message : String(err) });
  res.status(500).json({ success: false, error: fallback });
};

// ── Public ─────────────────────────────────────────────────────────────────
router.get("/plans", (_req: Request, res: Response) => {
  res.set("Cache-Control", "public, max-age=300");
  res.json({ success: true, data: publicPlans() });
});

// ── BallylifeMORE ──────────────────────────────────────────────────────────
router.get("/subscriptions/me", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const s = await getLiveSubscription(req.user!.userId);
  const { rows: payments } = s
    ? await pool!.query(`SELECT amount, status, plan, period_start, period_end, created_at FROM mkt_subscription_payments WHERE subscription_id = $1 ORDER BY created_at DESC`, [s.id])
    : { rows: [] as any[] };
  const { rows: prior } = await pool!.query(`SELECT 1 FROM mkt_subscriptions WHERE user_id = $1 AND commenced_at IS NOT NULL LIMIT 1`, [req.user!.userId]);
  res.json({
    success: true,
    data: {
      subscription: s && s.status !== "pending_payment" ? mapSubscription(s) : null,
      trialAvailable: prior.length === 0,
      payments: payments.map(p => ({ amount: Number(p.amount), status: p.status, plan: p.plan, periodStart: p.period_start, periodEnd: p.period_end, paidAt: p.created_at })),
    },
  });
});

router.post("/subscriptions", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { rows } = await pool!.query(`SELECT email FROM users WHERE id = $1`, [req.user!.userId]);
    const result = await startSubscription({ userId: req.user!.userId, email: rows[0]?.email ?? "" }, String(req.body?.plan ?? ""));
    res.status(201).json({ success: true, data: result });
  } catch (err) { fail(res, err, "Couldn't start your subscription — please try again."); }
});

router.post("/subscriptions/change", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await changePlan(req.user!.userId, String(req.body?.plan ?? ""));
    res.json({ success: true, data: { ...result, subscription: mapSubscription(await getLiveSubscription(req.user!.userId)) } });
  } catch (err) { fail(res, err, "Couldn't change your plan — please try again."); }
});

router.post("/subscriptions/cancel", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await cancelSubscription(req.user!.userId);
    res.json({ success: true, data: result });
  } catch (err) { fail(res, err, "Couldn't cancel your subscription — please try again."); }
});

// ── Store credit ───────────────────────────────────────────────────────────
router.get("/store-credit/me", requireAuth, async (req: Request, res: Response): Promise<void> => {
  res.json({ success: true, data: { balance: await storeCreditBalance(req.user!.userId), entries: await storeCreditEntries(req.user!.userId) } });
});

// ── Ballylife for Business ────────────────────────────────────────────────
const mapBusiness = (r: any) => r && ({
  id: r.id, userId: r.user_id, companyName: r.company_name, registrationNumber: r.registration_number,
  vatNumber: r.vat_number, status: r.status, decidedAt: r.decided_at, decisionNote: r.decision_note, createdAt: r.created_at,
});

// South African formats: CIPC company registration YYYY/NNNNNN/NN, VAT
// number 10 digits starting with 4. Either one qualifies (per the terms).
const REG_NO = /^\d{4}\/\d{6}\/\d{2}$/;
const VAT_NO = /^4\d{9}$/;

router.post("/business/apply", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const companyName = String(req.body?.companyName ?? "").trim();
  const registrationNumber = String(req.body?.registrationNumber ?? "").trim() || null;
  const vatNumber = String(req.body?.vatNumber ?? "").replace(/\s/g, "") || null;
  if (companyName.length < 2 || companyName.length > 200) { res.status(400).json({ success: false, error: "Enter your registered company name." }); return; }
  if (!registrationNumber && !vatNumber) { res.status(400).json({ success: false, error: "A company registration number or VAT number is required." }); return; }
  if (registrationNumber && !REG_NO.test(registrationNumber)) { res.status(400).json({ success: false, error: "Company registration numbers look like 2019/123456/07." }); return; }
  if (vatNumber && !VAT_NO.test(vatNumber)) { res.status(400).json({ success: false, error: "VAT numbers are 10 digits starting with 4." }); return; }

  const { rows: existing } = await pool!.query(`SELECT * FROM mkt_business_accounts WHERE user_id = $1`, [req.user!.userId]);
  if (existing.length && ["pending", "approved"].includes(existing[0].status)) {
    res.status(409).json({ success: false, error: existing[0].status === "approved" ? "Your business account is already approved." : "Your application is already being reviewed." }); return;
  }
  const { rows } = existing.length
    ? await pool!.query(`UPDATE mkt_business_accounts SET company_name = $2, registration_number = $3, vat_number = $4, status = 'pending', decided_at = NULL, decision_note = NULL, created_at = now() WHERE user_id = $1 RETURNING *`,
        [req.user!.userId, companyName, registrationNumber, vatNumber])
    : await pool!.query(`INSERT INTO mkt_business_accounts (user_id, company_name, registration_number, vat_number) VALUES ($1,$2,$3,$4) RETURNING *`,
        [req.user!.userId, companyName, registrationNumber, vatNumber]);
  logger.info("business.applied", { userId: req.user!.userId });
  res.status(201).json({ success: true, data: mapBusiness(rows[0]) });
});

router.get("/business/me", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { rows } = await pool!.query(`SELECT * FROM mkt_business_accounts WHERE user_id = $1`, [req.user!.userId]);
  const account = rows[0] ?? null;
  let thisMonth = null;
  if (account?.status === "approved") {
    const now = new Date();
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const spend = await netMerchandiseValue(req.user!.userId, from, now);
    const pct = businessRebatePct(spend);
    const next = BUSINESS_REBATE_TIERS.find(t => t.minMonthlySpendZar > spend) ?? null;
    thisMonth = { netSpendZar: spend, rebatePct: pct, estimatedRebateZar: Math.round(spend * pct) / 100, nextTier: next };
  }
  const { rows: rebates } = await pool!.query(
    `SELECT amount, description, created_at FROM mkt_store_credit_ledger WHERE user_id = $1 AND source = 'business_rebate' ORDER BY created_at DESC LIMIT 24`, [req.user!.userId]
  );
  res.json({ success: true, data: { account: mapBusiness(account), thisMonth, rebates: rebates.map(r => ({ amount: Number(r.amount), description: r.description, creditedAt: r.created_at })) } });
});

router.post("/business/leave", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { rows } = await pool!.query(`UPDATE mkt_business_accounts SET status = 'left', decided_at = now() WHERE user_id = $1 AND status IN ('pending','approved') RETURNING *`, [req.user!.userId]);
  if (!rows.length) { res.status(404).json({ success: false, error: "No active business account." }); return; }
  res.json({ success: true, data: mapBusiness(rows[0]) });
});

// ── Admin ─────────────────────────────────────────────────────────────────
router.get("/admin/business-accounts", requireAuth, requireRole(...MANAGER_ROLES), async (req: Request, res: Response): Promise<void> => {
  const status = typeof req.query.status === "string" ? req.query.status : null;
  const { rows } = await pool!.query(
    `SELECT b.*, u.name AS user_name, u.email AS user_email FROM mkt_business_accounts b LEFT JOIN users u ON u.id::text = b.user_id
     ${status ? "WHERE b.status = $1" : ""} ORDER BY b.created_at DESC LIMIT 200`, status ? [status] : []
  );
  res.json({ success: true, data: rows.map(r => ({ ...mapBusiness(r), userName: r.user_name, userEmail: r.user_email })) });
});

router.patch("/admin/business-accounts/:id", requireAuth, requireRole(...MANAGER_ROLES), async (req: Request, res: Response): Promise<void> => {
  const decision = req.body?.decision;
  if (!["approve", "reject"].includes(decision)) { res.status(400).json({ success: false, error: "decision must be approve or reject" }); return; }
  const { rows } = await pool!.query(
    `UPDATE mkt_business_accounts SET status = $2, decided_at = now(), decision_note = $3 WHERE id::text = $1 AND status = 'pending' RETURNING *`,
    [req.params.id, decision === "approve" ? "approved" : "rejected", typeof req.body?.note === "string" ? req.body.note.slice(0, 500) : null]
  );
  if (!rows.length) { res.status(409).json({ success: false, error: "Only pending applications can be decided." }); return; }
  logger.info("business.decided", { actorId: req.user!.userId, accountId: rows[0].id, decision });
  res.json({ success: true, data: mapBusiness(rows[0]) });
});

router.get("/admin/subscriptions", requireAuth, requireRole(...MANAGER_ROLES), async (_req: Request, res: Response): Promise<void> => {
  const { rows } = await pool!.query(
    `SELECT s.*, u.name AS user_name, u.email AS user_email FROM mkt_subscriptions s LEFT JOIN users u ON u.id::text = s.user_id
     WHERE s.status <> 'pending_payment' ORDER BY s.created_at DESC LIMIT 300`
  );
  const counts: Record<string, number> = {};
  let mrr = 0;
  for (const s of rows) {
    counts[s.status] = (counts[s.status] ?? 0) + 1;
    if (s.status === "active" && !s.cancel_at) mrr += MORE_PLANS[s.plan as MorePlanId]?.monthlyPriceZar ?? 0;
  }
  const { rows: refunds } = await pool!.query(`SELECT COUNT(*)::int AS n FROM mkt_subscription_payments WHERE status = 'refund_due'`);
  res.json({
    success: true,
    data: rows.map(r => ({ ...mapSubscription(r), userName: r.user_name, userEmail: r.user_email })),
    meta: { counts, monthlyRecurringRevenueZar: mrr, refundsDue: refunds[0].n },
  });
});

export default router;
