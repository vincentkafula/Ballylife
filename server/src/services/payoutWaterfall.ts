/**
 * The order customer money is paid out in, per order line:
 *
 *   1. Supplier (CJ / AliExpress): paid first, from Ballylife's supplier
 *      balance when the supplier order is placed. We mark it paid as soon as
 *      the supplier shows the order as paid (auto-pay, or paid by hand in
 *      their dashboard) -- see the CJ and AliExpress sync workers.
 *   2. Ballylife: keeps its commission (platform_fee_amount). Nothing to move;
 *      the money is already in Ballylife's account.
 *   3. Seller: their share becomes "ready" only once the supplier is paid and
 *      the order was delivered more than SELLER_PAYOUT_HOLD_DAYS ago (the
 *      return window). A manager pays ready payouts by bank transfer and
 *      marks them paid; a seller can never be paid before the supplier.
 *
 * Customer card/EFT/DPO money always lands in Ballylife's merchant account
 * first: no payment gateway can pay a CJ or AliExpress wallet directly.
 */
import { pool } from "../db/pool";
import { logger } from "../utils/logger";

export const payoutHoldDays = () => {
  const n = Number(process.env.SELLER_PAYOUT_HOLD_DAYS);
  return Number.isFinite(n) && n >= 0 ? n : 7;
};

/** Step 1 done: the supplier has been paid for this order's lines from that source. */
export async function markSupplierPaid(orderId: string, source: "cjdropshipping" | "aliexpress", reference: string | null): Promise<number> {
  const { rows } = await pool!.query(
    `SELECT s.id FROM mkt_order_line_settlements s
     JOIN mkt_products p ON p.id = s.product_id
     JOIN mkt_supplier_products sp ON sp.id = p.supplier_product_id
     WHERE s.order_id = $1 AND s.supplier_payout_status = 'pending' AND sp.external_source = $2`, [orderId, source]);
  for (const r of rows) {
    await pool!.query(
      `UPDATE mkt_order_line_settlements SET supplier_payout_status = 'paid', supplier_paid_at = now(),
         supplier_payout_reference = COALESCE(supplier_payout_reference, $2) WHERE id = $1 AND supplier_payout_status = 'pending'`,
      [r.id, reference ? `${source === "aliexpress" ? "AliExpress" : "CJ"} ${reference}`.slice(0, 200) : null]);
  }
  if (rows.length) logger.info("payout.supplier_paid", { orderId, source, lines: rows.length });
  return rows.length;
}

/** Step 3 unlocks: seller shares whose supplier is paid and whose order is past the return window. */
export async function releaseSellerPayouts(): Promise<number> {
  const cutoff = new Date(Date.now() - payoutHoldDays() * 86_400_000);
  const { rows } = await pool!.query(
    `SELECT s.id FROM mkt_order_line_settlements s JOIN mkt_orders o ON o.id = s.order_id
     WHERE s.seller_payout_status = 'pending' AND s.supplier_payout_status IN ('paid', 'n/a')
       AND o.payment_status = 'payment_confirmed' AND o.status = 'delivered' AND o.delivered_at <= $1`, [cutoff]);
  for (const r of rows) {
    await pool!.query(
      `UPDATE mkt_order_line_settlements SET seller_payout_status = 'ready', seller_payout_ready_at = now() WHERE id = $1 AND seller_payout_status = 'pending'`, [r.id]);
  }
  if (rows.length) logger.info("payout.seller_ready", { lines: rows.length });
  return rows.length;
}

/** Where a seller's share stands, for the seller and manager screens. */
export function sellerPayoutStage(r: { seller_payout_status: string; supplier_payout_status: string }): "paid" | "ready" | "waiting_supplier" | "waiting_delivery" | "refunded" {
  if (r.seller_payout_status === "paid" || r.seller_payout_status === "refunded" || r.seller_payout_status === "ready") return r.seller_payout_status;
  return r.supplier_payout_status === "pending" ? "waiting_supplier" : "waiting_delivery";
}

export function startPayoutWorker(intervalMs = 60 * 60 * 1000): NodeJS.Timeout {
  const run = () => releaseSellerPayouts().catch(err => logger.warn("payout.release_failed", { error: String(err) }));
  void run();
  return setInterval(run, intervalMs);
}
