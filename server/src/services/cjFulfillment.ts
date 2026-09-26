import { pool } from "../db/pool";
import { logger } from "../utils/logger";
import { sendEmail } from "./emailService";
import {
  isCjConfigured, createCjOrder, getCjOrderDetail, calculateCjFreight, CjApiError,
  type CjCreateOrderRequest, type CjOrderDetail,
} from "./cjDropshippingClient";
import { parseExternalVariants, resolveVid } from "../utils/cjVariants";

/**
 * Places paid customer orders with CJdropshipping using the platform's one
 * CJ account, then follows each CJ order until delivery.
 *
 *   customer pays -> order.payment_status = payment_confirmed (any path:
 *   PayFast ITN, reconciliation, credit approval, demo checkout)
 *     -> enqueueNewlyPaidOrders() finds it (scan, so no payment path can
 *        forget to call us) and creates a cj_fulfillments row
 *     -> placeDueFulfillments() calls createOrderV2, retrying transient
 *        failures with backoff; anything a retry can't fix goes straight
 *        to needs_attention and the admin is emailed
 *     -> syncPlacedFulfillments() polls getOrderDetail and copies tracking
 *        onto the customer's order under our own branding
 *
 * White-labelling: the customer's email is never sent to CJ (CJ would
 * email them), CJ's carrier names are relabelled before customers see
 * them, and nothing from cj_fulfillments is exposed outside admin routes.
 *
 * Safe to run on several instances at once: each row is claimed with a
 * conditional UPDATE, and our order number doubles as CJ's orderNumber,
 * so a retry after an ambiguous failure adopts the existing CJ order
 * instead of placing a second one.
 */

const AUTO_PAY = /^(1|true|yes)$/i.test(process.env.CJ_AUTO_PAY ?? "");
const SANDBOX = /^(1|true|yes)$/i.test(process.env.CJ_SANDBOX ?? "");
const FROM_COUNTRY = (process.env.CJ_FROM_COUNTRY || "CN").toUpperCase();
const FIXED_LOGISTIC = process.env.CJ_LOGISTIC_NAME?.trim() || null;
const ALERT_EMAIL = process.env.ADMIN_ALERT_EMAIL?.trim() || null;
const WHITE_LABEL_CARRIER = process.env.WHITE_LABEL_CARRIER_NAME?.trim() || "Ballylife Express";

// Minutes to wait before attempt N+1. After the last one the job is marked
// failed and the admin alerted -- about 10.5 hours of retries in total.
const BACKOFF_MINUTES = [1, 5, 15, 60, 180, 360];
export const MAX_ATTEMPTS = BACKOFF_MINUTES.length + 1;
const SYNC_EVERY_MS = 60 * 60 * 1000;
const STUCK_PLACING_MS = 10 * 60 * 1000;
const LOOKBACK_DAYS = 30;

/** A problem retrying can't fix (bad address, missing variant...). Goes straight to an admin. */
export class NeedsAttention extends Error {}

type Row = Record<string, any>;

// ── 1. Enqueue ─────────────────────────────────────────────────────────────

export async function enqueueNewlyPaidOrders(): Promise<number> {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const { rows } = await pool!.query(
    `SELECT DISTINCT o.id FROM mkt_orders o
       JOIN mkt_supplier_orders so ON so.order_id = o.id
       JOIN mkt_supplier_products sp ON sp.id = so.supplier_product_id
       LEFT JOIN cj_fulfillments f ON f.order_id = o.id
     WHERE o.payment_status = 'payment_confirmed' AND sp.external_source = 'cjdropshipping'
       AND f.id IS NULL AND o.placed_at > $1`,
    [since]
  );
  for (const r of rows) {
    await pool!.query(`INSERT INTO cj_fulfillments (order_id) VALUES ($1) ON CONFLICT (order_id) DO NOTHING`, [r.id]);
  }
  if (rows.length) logger.info("cj.fulfillment_enqueued", { count: rows.length });
  return rows.length;
}

// ── 2. Place ───────────────────────────────────────────────────────────────

export async function placeDueFulfillments(limit = 5): Promise<number> {
  // Rows left in 'placing' by a crashed process are picked up again; the
  // idempotency check in placeOne stops that from double-ordering.
  const stuckBefore = new Date(Date.now() - STUCK_PLACING_MS);
  const { rows } = await pool!.query(
    `SELECT id FROM cj_fulfillments
     WHERE (status = 'queued' AND next_attempt_at <= now()) OR (status = 'placing' AND updated_at < $1)
     ORDER BY next_attempt_at LIMIT $2`,
    [stuckBefore, limit]
  );
  let handled = 0;
  for (const { id } of rows) {
    if (await processFulfillment(id)) handled++;
  }
  return handled;
}

/** Claims and attempts one fulfilment. Returns false if another worker already has it. */
export async function processFulfillment(id: string): Promise<boolean> {
  const stuckBefore = new Date(Date.now() - STUCK_PLACING_MS);
  const { rows } = await pool!.query(
    `UPDATE cj_fulfillments SET status = 'placing', attempts = attempts + 1, updated_at = now()
     WHERE id = $1 AND (status = 'queued' OR (status = 'placing' AND updated_at < $2)) RETURNING *`,
    [id, stuckBefore]
  );
  const f = rows[0];
  if (!f) return false;

  try {
    await placeOne(f);
  } catch (err) {
    await recordFailure(f, err);
  }
  return true;
}

async function placeOne(f: Row): Promise<void> {
  const { rows: orderRows } = await pool!.query(`SELECT * FROM mkt_orders WHERE id = $1`, [f.order_id]);
  const order = orderRows[0];
  if (!order || order.payment_status !== "payment_confirmed" || ["cancelled", "refunded", "payment_failed"].includes(order.status)) {
    await pool!.query(`UPDATE cj_fulfillments SET status = 'cancelled', last_error = $2, updated_at = now() WHERE id = $1`,
      [f.id, "Customer order is no longer paid/active — nothing was ordered from the supplier."]);
    return;
  }

  // Idempotency: an earlier attempt may have reached CJ even though we
  // never saw the response (timeout, crash). Our order number is CJ's
  // orderNumber, and getOrderDetail accepts it, so look before placing.
  if (f.attempts > 1 || f.cj_order_id) {
    const existing = await findCjOrder(order.order_number);
    if (existing) {
      await markPlaced(f, order, {
        orderId: existing.orderId, orderStatus: existing.orderStatus, logisticName: existing.logisticName ?? f.logistic_name,
        productAmount: existing.productAmount, postageAmount: existing.postageAmount, orderAmount: existing.orderAmount,
      });
      logger.info("cj.fulfillment_adopted_existing", { fulfillmentId: f.id, orderNumber: order.order_number });
      return;
    }
  }

  const request = await buildCjOrderRequest(order);
  const result = await createCjOrder(request);
  await markPlaced(f, order, { ...result, logisticName: request.logisticName });

  if (result.interceptOrderReasons?.length) {
    const reasons = result.interceptOrderReasons.map(r => r.message ?? String(r.code)).join("; ");
    throw new NeedsAttention(`Supplier accepted the order but is holding it: ${reasons}`);
  }
}

async function findCjOrder(orderNumber: string): Promise<CjOrderDetail | null> {
  try {
    const d = await getCjOrderDetail(orderNumber);
    return d?.orderId ? d : null;
  } catch (err) {
    if (err instanceof CjApiError && err.httpStatus < 500) return null; // "not found" comes back as a business error
    throw err;
  }
}

export async function buildCjOrderRequest(order: Row): Promise<CjCreateOrderRequest> {
  const { rows: lines } = await pool!.query(
    `SELECT so.product_id, so.quantity, sp.external_variants, sp.name AS catalog_name, sp.est_logistic_name
     FROM mkt_supplier_orders so JOIN mkt_supplier_products sp ON sp.id = so.supplier_product_id
     WHERE so.order_id = $1 AND sp.external_source = 'cjdropshipping'`,
    [order.id]
  );
  if (!lines.length) throw new NeedsAttention("No supplier-fulfilled lines found on this order.");

  const items: Row[] = Array.isArray(order.items) ? order.items : [];
  const qtyByVid = new Map<string, number>();
  for (const line of lines) {
    const variants = parseExternalVariants(line.external_variants);
    if (!variants.length) throw new NeedsAttention(`"${line.catalog_name}" has no supplier variant on file — re-sync it from the Supplier Catalog, then retry.`);
    const item = items.find(i => i.productId === line.product_id);
    const vid = resolveVid(variants, item?.variantId);
    if (!vid) throw new NeedsAttention(`Customer's option for "${line.catalog_name}" doesn't match a supplier variant — confirm the option with the customer, then retry.`);
    qtyByVid.set(vid, (qtyByVid.get(vid) ?? 0) + Number(line.quantity));
  }
  const products = [...qtyByVid].map(([vid, quantity]) => ({ vid, quantity }));
  if (products.length > 20) throw new NeedsAttention("More than 20 supplier lines on one order — split it manually.");

  const a: Row = order.shipping_address ?? {};
  const countryCode = String(a.country ?? "").toUpperCase();
  const name = `${a.firstName ?? ""} ${a.lastName ?? ""}`.trim();
  const missing = [!name && "name", !a.line1 && "street address", !a.city && "city", !/^[A-Z]{2}$/.test(countryCode) && "country"].filter(Boolean);
  if (missing.length) throw new NeedsAttention(`Shipping address is missing: ${missing.join(", ")}.`);

  return {
    orderNumber: order.order_number,
    shippingCountryCode: countryCode,
    shippingCountry: countryName(countryCode),
    shippingProvince: a.state || a.city,
    shippingCity: a.city,
    shippingAddress: a.line1,
    ...(a.line2 ? { shippingAddress2: a.line2 } : {}),
    ...(a.postalCode ? { shippingZip: String(a.postalCode) } : {}),
    ...(a.phone ? { shippingPhone: String(a.phone) } : {}),
    shippingCustomerName: name,
    logisticName: await chooseLogistic(countryCode, a.postalCode, products, lines.map(l => l.est_logistic_name)),
    fromCountryCode: FROM_COUNTRY,
    payType: AUTO_PAY ? 2 : 3,
    ...(SANDBOX ? { isSandbox: 1 as const } : {}),
    products,
    // Deliberately no `email` or `remark`: CJ would email the customer, and
    // remarks can surface on packing slips.
  };
}

const PRICING_COUNTRY = (process.env.CJ_PRICING_COUNTRY || "ZA").toUpperCase();

async function chooseLogistic(countryCode: string, zip: string | undefined, products: { vid: string; quantity: number }[], savedLines: (string | null)[] = []): Promise<string> {
  if (FIXED_LOGISTIC) return FIXED_LOGISTIC;
  // The catalogue sync already found the cheapest line to the pricing country
  // for each product. If every item shares that line and the order goes
  // there, use it -- no freight quote, so no CJ API points spent.
  const saved = [...new Set(savedLines)];
  if (countryCode === PRICING_COUNTRY && saved.length === 1 && saved[0]) return saved[0];
  const options = await calculateCjFreight({ startCountryCode: FROM_COUNTRY, endCountryCode: countryCode, ...(zip ? { zip: String(zip) } : {}), products }, "order");
  const cheapest = [...(options ?? [])].sort((x, y) => Number(x.logisticPrice) - Number(y.logisticPrice))[0];
  if (!cheapest?.logisticName) throw new NeedsAttention(`The supplier has no shipping route from ${FROM_COUNTRY} to ${countryCode} for these items.`);
  return cheapest.logisticName;
}

function countryName(code: string): string {
  try { return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code; } catch { return code; }
}

async function markPlaced(f: Row, order: Row, r: { orderId: string; orderStatus?: string; logisticName?: string | null; productAmount?: number; postageAmount?: number; orderAmount?: number }) {
  await pool!.query(
    `UPDATE cj_fulfillments SET status = 'placed', cj_order_id = $2, cj_order_status = $3, logistic_name = $4,
       cj_product_amount = $5, cj_postage_amount = $6, cj_order_amount = $7, pay_type = $8,
       last_error = NULL, placed_at = COALESCE(placed_at, now()), last_synced_at = now(), updated_at = now()
     WHERE id = $1`,
    [f.id, r.orderId, r.orderStatus ?? null, r.logisticName ?? null, r.productAmount ?? null, r.postageAmount ?? null, r.orderAmount ?? null, AUTO_PAY ? 2 : 3]
  );
  // An all-supplier order is out of local couriers' hands from here -- move
  // it off 'confirmed' so it doesn't show up as claimable on their dashboard.
  if (await isAllSupplierOrder(order)) {
    await pool!.query(`UPDATE mkt_orders SET status = 'processing' WHERE id = $1 AND status = 'confirmed'`, [order.id]);
  }
  logger.info("cj.fulfillment_placed", { fulfillmentId: f.id, orderNumber: order.order_number, autoPaid: AUTO_PAY });
}

async function isAllSupplierOrder(order: Row): Promise<boolean> {
  const items: Row[] = Array.isArray(order.items) ? order.items : [];
  const { rows } = await pool!.query(
    `SELECT DISTINCT so.product_id FROM mkt_supplier_orders so JOIN mkt_supplier_products sp ON sp.id = so.supplier_product_id
     WHERE so.order_id = $1 AND sp.external_source = 'cjdropshipping'`, [order.id]
  );
  const cjProducts = new Set(rows.map(r => String(r.product_id)));
  return items.length > 0 && items.every(i => cjProducts.has(String(i.productId)));
}

async function recordFailure(f: Row, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  // A NeedsAttention thrown after the order was placed (held by CJ) keeps
  // its CJ id, so it can still be tracked once an admin clears the hold.
  const permanent = err instanceof NeedsAttention;
  const exhausted = f.attempts >= MAX_ATTEMPTS;
  const status = permanent ? "needs_attention" : exhausted ? "failed" : "queued";
  const retryAt = new Date(Date.now() + (BACKOFF_MINUTES[f.attempts - 1] ?? 60) * 60 * 1000);

  await pool!.query(
    `UPDATE cj_fulfillments SET status = $2, last_error = $3, next_attempt_at = $4, updated_at = now() WHERE id = $1`,
    [f.id, status, message.slice(0, 1000), retryAt]
  );
  logger.warn("cj.fulfillment_attempt_failed", { fulfillmentId: f.id, attempt: f.attempts, status, error: message });
  if (status !== "queued") await alertAdmin(f.id, status, message);
}

// ── 3. Track ───────────────────────────────────────────────────────────────

export async function syncPlacedFulfillments(limit = 20): Promise<number> {
  const staleBefore = new Date(Date.now() - SYNC_EVERY_MS);
  const { rows } = await pool!.query(
    `SELECT * FROM cj_fulfillments WHERE status IN ('placed', 'shipped') AND cj_order_id IS NOT NULL
       AND (last_synced_at IS NULL OR last_synced_at < $1)
     ORDER BY created_at LIMIT $2`,
    [staleBefore, limit]
  );
  let synced = 0;
  for (const f of rows) {
    try {
      await syncOne(f);
      synced++;
    } catch (err) {
      await pool!.query(`UPDATE cj_fulfillments SET last_synced_at = now(), last_error = $2 WHERE id = $1`,
        [f.id, `Tracking sync failed: ${err instanceof Error ? err.message : String(err)}`.slice(0, 1000)]);
    }
  }
  return synced;
}

export async function syncOne(f: Row): Promise<void> {
  const d = await getCjOrderDetail(f.cj_order_id);
  const { rows: orderRows } = await pool!.query(`SELECT * FROM mkt_orders WHERE id = $1`, [f.order_id]);
  const order = orderRows[0];
  const cjStatus = String(d.orderStatus ?? "").toUpperCase();

  await pool!.query(
    `UPDATE cj_fulfillments SET cj_order_status = $2, tracking_number = COALESCE($3, tracking_number), tracking_url = COALESCE($4, tracking_url),
       logistic_name = COALESCE($5, logistic_name), cj_order_amount = COALESCE($6, cj_order_amount),
       last_synced_at = now(), last_error = NULL, updated_at = now() WHERE id = $1`,
    [f.id, cjStatus, d.trackNumber || null, d.trackingUrl || null, d.logisticName || null, d.orderAmount ?? null]
  );

  if (cjStatus === "CANCELLED") {
    await setStatus(f.id, "needs_attention", "The supplier cancelled this order. Re-place it or refund the customer.");
    await alertAdmin(f.id, "needs_attention", "The supplier cancelled this order.");
    return;
  }

  // Customer cancelled/refunded after we'd already ordered from CJ -- a
  // person has to cancel the CJ side before it ships.
  if (order && ["cancelled", "refunded"].includes(order.status) && !["SHIPPED", "DELIVERED"].includes(cjStatus)) {
    await setStatus(f.id, "needs_attention", "Customer order was cancelled/refunded — cancel the supplier order before it ships.");
    await alertAdmin(f.id, "needs_attention", "Customer cancelled after the supplier order was placed.");
    return;
  }

  const allSupplier = order ? await isAllSupplierOrder(order) : false;
  const carrier = whiteLabelCarrier(d.logisticName ?? f.logistic_name);

  if ((cjStatus === "SHIPPED" || cjStatus === "DELIVERED") && d.trackNumber && f.status === "placed") {
    await setStatus(f.id, "shipped");
    await pool!.query(`UPDATE cj_fulfillments SET shipped_at = COALESCE(shipped_at, now()) WHERE id = $1`, [f.id]);
    await pool!.query(`UPDATE mkt_supplier_orders SET status = 'shipped_to_customer', updated_at = now() WHERE order_id = $1 AND supplier_product_id IN (SELECT id FROM mkt_supplier_products WHERE external_source = 'cjdropshipping')`, [f.order_id]);
    if (allSupplier) {
      await pool!.query(
        `UPDATE mkt_orders SET tracking_number = $2, carrier = $3, shipping_status = 'in_transit', shipped_at = COALESCE(shipped_at, now()),
           status = CASE WHEN status IN ('confirmed', 'processing') THEN 'shipped' ELSE status END
         WHERE id = $1`,
        [f.order_id, d.trackNumber, carrier]
      );
    } else {
      // Mixed order: local items travel separately, so don't overwrite the
      // order-level status -- but give the customer this parcel's tracking if there's none yet.
      await pool!.query(`UPDATE mkt_orders SET tracking_number = COALESCE(tracking_number, $2), carrier = COALESCE(carrier, $3) WHERE id = $1`, [f.order_id, d.trackNumber, carrier]);
    }
  }

  if (cjStatus === "DELIVERED") {
    await setStatus(f.id, "delivered");
    await pool!.query(`UPDATE cj_fulfillments SET delivered_at = COALESCE(delivered_at, now()) WHERE id = $1`, [f.id]);
    await pool!.query(`UPDATE mkt_supplier_orders SET status = 'delivered', updated_at = now() WHERE order_id = $1 AND supplier_product_id IN (SELECT id FROM mkt_supplier_products WHERE external_source = 'cjdropshipping')`, [f.order_id]);
    if (allSupplier) {
      await pool!.query(`UPDATE mkt_orders SET status = 'delivered', shipping_status = 'delivered', delivered_at = COALESCE(delivered_at, now()) WHERE id = $1`, [f.order_id]);
    }
  }
}

/** Customers see the real carrier name (e.g. "DHL") unless it names the supplier. */
export function whiteLabelCarrier(logisticName: string | null | undefined): string {
  if (!logisticName || /\bcj|1688/i.test(logisticName)) return WHITE_LABEL_CARRIER; // "CJPacket Ordinary" etc.
  return logisticName;
}

async function setStatus(id: string, status: string, lastError?: string) {
  await pool!.query(`UPDATE cj_fulfillments SET status = $2, last_error = COALESCE($3, last_error), updated_at = now() WHERE id = $1`, [id, status, lastError ?? null]);
}

async function alertAdmin(fulfillmentId: string, status: string, message: string): Promise<void> {
  const { rows } = await pool!.query(`UPDATE cj_fulfillments SET alerted_at = now() WHERE id = $1 RETURNING order_id`, [fulfillmentId]);
  const { rows: orderRows } = rows.length
    ? await pool!.query(`SELECT order_number, total_amount, currency FROM mkt_orders WHERE id = $1`, [rows[0].order_id])
    : { rows: [] as Row[] };
  const o = orderRows[0];
  logger.error("cj.fulfillment_needs_admin", { fulfillmentId, status, orderNumber: o?.order_number, error: message });
  if (!ALERT_EMAIL || !o) return;
  await sendEmail({
    to: ALERT_EMAIL,
    subject: `Action needed: order ${o.order_number} could not be fulfilled`,
    html: `<p>Order <b>${escapeHtml(o.order_number)}</b> (${escapeHtml(o.currency)} ${Number(o.total_amount).toFixed(2)}, already paid by the customer) is <b>${escapeHtml(status.replace(/_/g, " "))}</b>.</p>
           <p>${escapeHtml(message)}</p>
           <p>Open Admin → Fulfilment to retry it, or refund the customer from the order page.</p>`,
  }).catch(() => undefined);
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

// ── Worker ─────────────────────────────────────────────────────────────────

let running = false;

export async function runCjFulfillmentCycle(): Promise<void> {
  if (running || !isCjConfigured()) return;
  running = true;
  try {
    await enqueueNewlyPaidOrders();
    await placeDueFulfillments();
    await syncPlacedFulfillments();
  } catch (err) {
    logger.error("cj.fulfillment_cycle_failed", { error: err instanceof Error ? err.message : String(err) });
  } finally {
    running = false;
  }
}

export function startCjFulfillmentWorker(intervalMs = 60_000): NodeJS.Timeout | null {
  if (/^(0|false|off|no)$/i.test(process.env.CJ_FULFILLMENT_WORKER ?? "")) return null;
  const timer = setInterval(() => { void runCjFulfillmentCycle(); }, intervalMs);
  timer.unref();
  logger.info("cj.fulfillment_worker_started", { intervalMs, autoPay: AUTO_PAY, sandbox: SANDBOX });
  return timer;
}
