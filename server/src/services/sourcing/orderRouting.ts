/**
 * Order routing for supplier-sourced products.
 *
 * Paid orders are picked up by each supplier's fulfilment worker (CJ:
 * cjFulfillment, AliExpress: aliexpressFulfillment), which places, pays,
 * retries and tracks them. This module decides whether a new supplier order
 * goes straight to the worker ("auto") or waits for a manager ("approval"),
 * per supplier (sourcing_suppliers.order_mode), and runs the approval queue.
 *
 * Suppliers with no saved setting stay on "auto" -- how orders flowed before.
 * Approval only ever holds orders that contain another seller's product:
 * orders for Ballylife's own store always go straight to the supplier.
 */
import { pool } from "../../db/pool";
import { logger } from "../../utils/logger";
import { isEmailConfigured, sendEmail } from "../emailService";
import { HOUSE_SELLER_ID } from "../cjCatalog";

export type OrderMode = "auto" | "approval";
export const ORDER_MODES: OrderMode[] = ["auto", "approval"];

/** Adapter key -> its fulfilment queue and catalogue source. */
export const FULFILMENT_QUEUES: Record<string, { table: string; source: string }> = {
  cj: { table: "cj_fulfillments", source: "cjdropshipping" },
  aliexpress: { table: "aliexpress_fulfillments", source: "aliexpress" },
};
export const AWAITING = "awaiting_approval";

export async function orderMode(adapterKey: string): Promise<OrderMode> {
  try {
    const { rows } = await pool!.query(`SELECT order_mode FROM sourcing_suppliers WHERE key = $1`, [adapterKey]);
    return rows[0]?.order_mode === "approval" ? "approval" : "auto";
  } catch { return "auto"; }
}

export async function setOrderMode(adapterKey: string, mode: OrderMode): Promise<void> {
  if (!FULFILMENT_QUEUES[adapterKey]) throw new Error("Unknown supplier");
  if (!ORDER_MODES.includes(mode)) throw new Error("Unknown order mode");
  await pool!.query(
    `INSERT INTO sourcing_suppliers (key, enabled, order_mode, updated_at) VALUES ($1, true, $2, now())
     ON CONFLICT (key) DO UPDATE SET order_mode = EXCLUDED.order_mode, updated_at = now()`, [adapterKey, mode]);
}

/** Status a newly paid supplier order starts in. Workers only pick up 'queued'. */
export async function initialFulfilmentStatus(adapterKey: string, orderId?: string): Promise<"queued" | typeof AWAITING> {
  if ((await orderMode(adapterKey)) !== "approval") return "queued";
  if (!orderId) return AWAITING;
  const q = FULFILMENT_QUEUES[adapterKey];
  const { rows } = await pool!.query(
    `SELECT 1 FROM mkt_supplier_orders so
       JOIN mkt_products p ON p.id = so.product_id
       JOIN mkt_supplier_products sp ON sp.id = so.supplier_product_id
     WHERE so.order_id = $1 AND sp.external_source = $2 AND p.seller_id <> $3 LIMIT 1`, [orderId, q.source, HOUSE_SELLER_ID]);
  return rows.length ? AWAITING : "queued";
}

const ALERT_EMAIL = process.env.ADMIN_ALERT_EMAIL?.trim() || null;
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

/** Tells managers orders are waiting (email, when configured). Never throws. */
export async function notifyAwaiting(adapterKey: string, orderIds: string[]): Promise<void> {
  if (!orderIds.length) return;
  logger.info("sourcing.orders_awaiting_approval", { adapter: adapterKey, count: orderIds.length });
  if (!ALERT_EMAIL || !isEmailConfigured()) return;
  try {
    const { rows } = await pool!.query(
      `SELECT order_number FROM mkt_orders WHERE id IN (${orderIds.map((_, i) => `$${i + 1}`).join(",")})`, orderIds);
    const numbers = rows.map((r: { order_number: string }) => r.order_number).join(", ");
    await sendEmail({
      to: ALERT_EMAIL,
      subject: `Ballylife: ${orderIds.length} supplier order${orderIds.length > 1 ? "s" : ""} waiting for approval`,
      html: `<p>${esc(numbers)} ${orderIds.length > 1 ? "are" : "is"} paid and waiting for your approval before the supplier order is placed.</p><p>Manager dashboard → Seller Sourcing → Orders waiting for approval.</p>`,
    });
  } catch (err) { logger.warn("sourcing.approval_alert_failed", { error: String(err) }); }
}

export interface AwaitingOrder {
  id: string; supplier: string; orderId: string; orderNumber: string; placedAt: string; customerCity: string | null;
  lines: { name: string; quantity: number; sellerName: string | null; priceZar: number }[];
  saleZar: number; supplierCostZar: number | null; marginZar: number | null;
}

/** Everything waiting for a manager, oldest first, with the supplier cost so the margin is visible. */
export async function awaitingOrders(): Promise<AwaitingOrder[]> {
  const { rows: fx } = await pool!.query(`SELECT currency, rate_to_zar FROM mkt_fx_rates`);
  const rate = new Map(fx.map((r: { currency: string; rate_to_zar: string }) => [String(r.currency).toUpperCase(), Number(r.rate_to_zar)]));
  const out: AwaitingOrder[] = [];
  for (const [supplier, q] of Object.entries(FULFILMENT_QUEUES)) {
    const { rows } = await pool!.query(
      `SELECT f.id, f.order_id, o.order_number, o.placed_at, o.shipping_address FROM ${q.table} f JOIN mkt_orders o ON o.id = f.order_id
       WHERE f.status = $1 ORDER BY f.created_at`, [AWAITING]);
    for (const r of rows) {
      const { rows: lines } = await pool!.query(
        `SELECT p.name, so.quantity, s.store_name, sp.cost_price, sp.currency, sp.est_shipping_usd, st.gross_amount, st.supplier_cost_amount_zar
         FROM mkt_supplier_orders so
         JOIN mkt_supplier_products sp ON sp.id = so.supplier_product_id
         JOIN mkt_products p ON p.id = so.product_id
         LEFT JOIN mkt_sellers s ON s.id = p.seller_id
         LEFT JOIN mkt_order_line_settlements st ON st.order_id = so.order_id AND st.product_id = so.product_id
         WHERE so.order_id = $1 AND sp.external_source = $2`, [r.order_id, q.source]);
      let cost: number | null = 0;
      let sale = 0;
      for (const l of lines) {
        sale += Number(l.gross_amount ?? 0);
        // The settlement already has the chosen option + delivery at the order-time rate.
        if (l.supplier_cost_amount_zar !== null && l.supplier_cost_amount_zar !== undefined) {
          if (cost !== null) cost += Number(l.supplier_cost_amount_zar);
          continue;
        }
        const toZar = rate.get(String(l.currency ?? "USD").toUpperCase());
        if (!toZar || cost === null) { cost = null; continue; }
        cost += (Number(l.cost_price) + Number(l.est_shipping_usd ?? 0)) * Number(l.quantity) * toZar;
      }
      const addr = typeof r.shipping_address === "string" ? safeJson(r.shipping_address) : r.shipping_address;
      out.push({
        id: r.id, supplier, orderId: r.order_id, orderNumber: r.order_number, placedAt: r.placed_at,
        customerCity: addr?.city ?? null,
        lines: lines.map((l: any) => ({ name: l.name, quantity: Number(l.quantity), sellerName: l.store_name ?? null, priceZar: Number(l.gross_amount ?? 0) })),
        saleZar: round2(sale), supplierCostZar: cost === null ? null : round2(cost), marginZar: cost === null ? null : round2(sale - cost),
      });
    }
  }
  return out.sort((a, b) => new Date(a.placedAt).getTime() - new Date(b.placedAt).getTime());
}

const round2 = (n: number) => Math.round(n * 100) / 100;
function safeJson(s: string): any { try { return JSON.parse(s); } catch { return null; } }

/** Sends a waiting order to the supplier's worker. False if it wasn't waiting. */
export async function approveOrder(supplier: string, id: string, managerId: string): Promise<boolean> {
  const q = FULFILMENT_QUEUES[supplier];
  if (!q) return false;
  const r = await pool!.query(
    `UPDATE ${q.table} SET status = 'queued', next_attempt_at = now(), last_error = NULL, updated_at = now() WHERE id = $1 AND status = $2`, [id, AWAITING]);
  if (r.rowCount) logger.info("sourcing.order_approved", { supplier, fulfilmentId: id, managerId });
  return (r.rowCount ?? 0) > 0;
}

/** Stops a waiting order: nothing is ordered from the supplier; the customer needs a refund or manual fulfilment. */
export async function rejectOrder(supplier: string, id: string, managerId: string, reason: string): Promise<boolean> {
  const q = FULFILMENT_QUEUES[supplier];
  if (!q) return false;
  const note = `Not approved${reason ? `: ${reason.slice(0, 300)}` : ""}. Nothing was ordered from the supplier — refund the customer or fulfil it another way.`;
  const r = await pool!.query(
    `UPDATE ${q.table} SET status = 'cancelled', last_error = $3, updated_at = now() WHERE id = $1 AND status = $2`, [id, AWAITING, note]);
  if (r.rowCount) logger.info("sourcing.order_rejected", { supplier, fulfilmentId: id, managerId });
  return (r.rowCount ?? 0) > 0;
}
