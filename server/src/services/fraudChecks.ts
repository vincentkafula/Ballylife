import { pool, hasDb } from "../db/pool";

/**
 * Fraud & risk basics for the marketplace — rule-based, flag-only,
 * deliberately narrow (velocity checks only). Never auto-blocks; every
 * flag lands in front of a human reviewer. Ported from
 * VINK-GRUP-LIMITED's fraudRiskChecks.ts pattern but against this
 * backend's own mkt_fraud_flags table.
 */

const PAYMENT_VELOCITY_WINDOW_MINUTES = 60;
const PAYMENT_VELOCITY_THRESHOLD = 5; // 5+ orders from the same account within the window

async function createFlagIfNotOpen(
  rule: string,
  severity: "info" | "warning" | "critical",
  subjectType: "user" | "order",
  subjectId: string,
  relatedIds: string[],
  message: string,
): Promise<void> {
  if (!hasDb || !pool) return;
  const { rows: existing } = await pool.query(
    `SELECT 1 FROM mkt_fraud_flags WHERE rule = $1 AND subject_type = $2 AND subject_id = $3 AND status = 'open'`,
    [rule, subjectType, subjectId]
  );
  if (existing.length) return;

  await pool.query(
    `INSERT INTO mkt_fraud_flags (rule, severity, subject_type, subject_id, related_ids, message)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [rule, severity, subjectType, subjectId, JSON.stringify(relatedIds), message]
  );
}

export async function checkPaymentVelocity(orderId: string, userId: string): Promise<void> {
  if (!hasDb || !pool) return;
  const { rows } = await pool.query(
    `SELECT o.id FROM mkt_orders o
     WHERE o.user_id = $1 AND o.placed_at > now() - ($2 || ' minutes')::interval`,
    [userId, PAYMENT_VELOCITY_WINDOW_MINUTES]
  );
  if (rows.length >= PAYMENT_VELOCITY_THRESHOLD) {
    await createFlagIfNotOpen(
      "velocity_payments", "warning", "order", orderId,
      rows.map((r) => r.id),
      `${rows.length} orders placed by the same account within ${PAYMENT_VELOCITY_WINDOW_MINUTES} minutes.`
    );
  }
}
