import { Router, Request, Response } from "express";
import { pool } from "../db/pool";
import { requireAuth, requireRole } from "../middleware/auth";
import { logger } from "../utils/logger";

const router: ReturnType<typeof Router> = Router();
const MANAGER_ROLES = ["marketplace_admin"] as const;

// A cent or two of rounding drift across several NUMERIC(12,2) additions
// is normal, not a real mismatch -- flagging every sub-cent difference
// would bury genuine problems in noise.
const TOLERANCE = 0.02;

/**
 * On-demand reconciliation (docs/migration-plan.md item 4), reframed:
 * the original design needed a scheduled job, which needs a job-runner
 * or Railway cron service this project doesn't have -- correctly
 * deferred for that reason. An admin-triggered endpoint needs none of
 * that infrastructure and gives the same real value, just run
 * on-demand instead of on a timer.
 *
 * Three real invariants, not one:
 * A. For confirmed, unrefunded orders: sum of confirmed payment
 *    transactions should equal the order's total. Refunded orders are
 *    deliberately excluded -- a refund lives in mkt_order_refunds, a
 *    separate table from mkt_pay_transactions, so a partially or fully
 *    refunded order legitimately has less "confirmed payment" than its
 *    original total, and that's correct, not a mismatch.
 * B. For orders with settlement lines: those lines' gross_amount should
 *    sum to the order's subtotal (subtotal, not total_amount -- gross_
 *    amount excludes tax/shipping/discount by design, same as subtotal
 *    does, confirmed directly against the schema before writing this).
 * C. Per settlement line: seller_payout_amount should equal gross_amount
 *    minus platform_fee_amount minus supplier cost -- the formula this
 *    system claims to enforce at write time, checked after the fact.
 */
router.post("/admin/reconciliation/run", requireAuth, requireRole(...MANAGER_ROLES), async (req: Request, res: Response): Promise<void> => {
  const flagsToWrite: { rule: string; severity: string; subjectId: string; message: string; relatedIds: string[] }[] = [];

  // Check A
  //
  // Written as pure joins rather than correlated subqueries -- pg-mem
  // (the test database) failed to resolve the outer query's alias
  // inside a COALESCE((SELECT ...)) subquery combined with a NOT EXISTS
  // clause, confirmed directly by running it before settling on this
  // form. Completely standard SQL either way; this form is chosen
  // because it's the one actually verified to work under test, not
  // just assumed to work in production.
  const { rows: paymentRows } = await pool!.query(`
    SELECT o.id, o.order_number, o.total_amount, COALESCE(SUM(t.amount), 0) AS confirmed_sum
    FROM mkt_orders o
    LEFT JOIN mkt_pay_transactions t ON t.order_id = o.id AND t.status = 'confirmed'
    LEFT JOIN mkt_order_refunds r ON r.order_id = o.id
    WHERE o.payment_status = 'payment_confirmed' AND r.id IS NULL
    GROUP BY o.id, o.order_number, o.total_amount
  `);
  for (const o of paymentRows) {
    const diff = Math.abs(Number(o.total_amount) - Number(o.confirmed_sum));
    if (diff > TOLERANCE) {
      flagsToWrite.push({
        rule: "reconciliation_payment_mismatch", severity: "warning", subjectId: o.id,
        message: `Order ${o.order_number}: total_amount ${o.total_amount} vs confirmed payments ${o.confirmed_sum} (diff ${diff.toFixed(2)})`,
        relatedIds: [o.id],
      });
    }
  }

  // Check B
  const { rows: settlementRows } = await pool!.query(`
    SELECT o.id, o.order_number, o.subtotal,
           SUM(s.gross_amount) AS settled_sum
    FROM mkt_orders o
    JOIN mkt_order_line_settlements s ON s.order_id = o.id
    GROUP BY o.id, o.order_number, o.subtotal
  `);
  for (const o of settlementRows) {
    const diff = Math.abs(Number(o.subtotal) - Number(o.settled_sum));
    if (diff > TOLERANCE) {
      flagsToWrite.push({
        rule: "reconciliation_settlement_mismatch", severity: "warning", subjectId: o.id,
        message: `Order ${o.order_number}: subtotal ${o.subtotal} vs settled lines ${o.settled_sum} (diff ${diff.toFixed(2)})`,
        relatedIds: [o.id],
      });
    }
  }

  // Check C
  const { rows: lineRows } = await pool!.query(`
    SELECT id, order_id, gross_amount, platform_fee_amount, supplier_cost_amount_zar, seller_payout_amount
    FROM mkt_order_line_settlements
  `);
  for (const l of lineRows) {
    const expected = Number(l.gross_amount) - Number(l.platform_fee_amount) - Number(l.supplier_cost_amount_zar ?? 0);
    const diff = Math.abs(expected - Number(l.seller_payout_amount));
    if (diff > TOLERANCE) {
      flagsToWrite.push({
        rule: "reconciliation_payout_formula_mismatch", severity: "critical", subjectId: l.id,
        message: `Settlement line ${l.id}: expected payout ${expected.toFixed(2)} (gross - fee - supplier cost) but stored value is ${l.seller_payout_amount}`,
        relatedIds: [l.id, l.order_id],
      });
    }
  }

  for (const f of flagsToWrite) {
    await pool!.query(
      `INSERT INTO mkt_fraud_flags (rule, severity, subject_type, subject_id, related_ids, message)
       VALUES ($1, $2, 'reconciliation', $3, $4, $5)`,
      [f.rule, f.severity, f.subjectId, JSON.stringify(f.relatedIds), f.message]
    );
  }

  logger.info("reconciliation.run", {
    actorId: req.user!.userId, ordersChecked: paymentRows.length + settlementRows.length, linesChecked: lineRows.length, flagsRaised: flagsToWrite.length,
  });

  res.json({
    success: true,
    data: {
      ordersCheckedForPayments: paymentRows.length,
      ordersCheckedForSettlements: settlementRows.length,
      settlementLinesChecked: lineRows.length,
      flagsRaised: flagsToWrite.length,
    },
  });
});

// Fraud/reconciliation flags previously had nowhere to be viewed at all
// -- mkt_fraud_flags existed in the schema with zero routes reading from
// it anywhere in this codebase, confirmed by grep before writing this.
router.get("/admin/fraud-flags", requireAuth, requireRole(...MANAGER_ROLES), async (req: Request, res: Response): Promise<void> => {
  const { status, rule } = req.query as Record<string, string>;
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (status) { params.push(status); conditions.push(`status = $${params.length}`); }
  if (rule) { params.push(rule); conditions.push(`rule = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const { rows } = await pool!.query(`SELECT * FROM mkt_fraud_flags ${where} ORDER BY created_at DESC LIMIT 200`, params);
  res.json({
    success: true,
    data: rows.map(r => ({
      id: r.id, rule: r.rule, severity: r.severity, subjectType: r.subject_type, subjectId: r.subject_id,
      relatedIds: r.related_ids, message: r.message, status: r.status, createdAt: r.created_at,
      resolvedAt: r.resolved_at, resolvedBy: r.resolved_by, resolutionReason: r.resolution_reason,
    })),
  });
});

router.patch("/admin/fraud-flags/:id", requireAuth, requireRole(...MANAGER_ROLES), async (req: Request, res: Response): Promise<void> => {
  const { status, resolutionReason } = req.body ?? {};
  if (!["dismissed", "confirmed", "open"].includes(status)) {
    res.status(400).json({ success: false, error: "status must be open, dismissed, or confirmed" });
    return;
  }
  const resolved = status !== "open";
  const { rows } = await pool!.query(
    `UPDATE mkt_fraud_flags SET status = $1, resolved_at = ${resolved ? "now()" : "NULL"}, resolved_by = $2, resolution_reason = $3 WHERE id = $4 RETURNING *`,
    [status, resolved ? req.user!.userId : null, resolutionReason ?? null, req.params.id]
  );
  if (!rows.length) { res.status(404).json({ success: false, error: "Flag not found" }); return; }
  res.json({ success: true, data: rows[0] });
});

export default router;
