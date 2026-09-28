/**
 * Places paid Ballylife orders for AliExpress products on the connected
 * AliExpress buyer account, then follows them to delivery.
 *
 *   queued -> placing -> placed -> shipped -> delivered
 *                  \-> needs_attention (address/option problems; an admin fixes and retries)
 *
 * Payment: with ALIEXPRESS_AUTO_PAY=true the order asks AliExpress to charge
 * the account's saved payment method straight away; otherwise it's created
 * unpaid and the admin is emailed to pay it in AliExpress (orders left
 * unpaid there are cancelled by AliExpress after a while).
 *
 * A job stuck in "placing" is never retried automatically: the order may
 * exist on AliExpress already, so an admin checks before anything is placed
 * twice. Customers see the tracking number under a white-labelled carrier.
 */
import { pool } from "../db/pool";
import { logger } from "../utils/logger";
import { sendEmail } from "./emailService";
import { callAsBuyer, AliExpressError, connectionStatus } from "./aliexpressClient";
import { parseExternalVariants, resolveVid } from "../utils/cjVariants";
import { initialFulfilmentStatus, notifyAwaiting, AWAITING } from "./sourcing/orderRouting";

type Row = Record<string, any>;
const AUTO_PAY = /^(1|true|yes)$/i.test(process.env.ALIEXPRESS_AUTO_PAY ?? "");
const ALERT_EMAIL = process.env.ADMIN_ALERT_EMAIL?.trim() || null;
const CARRIER = process.env.WHITE_LABEL_CARRIER_NAME?.trim() || "Ballylife Shipping";
const BACKOFF_MINUTES = [1, 5, 15, 60, 180, 360];
const LOOKBACK_DAYS = 30;
const STUCK_PLACING_MS = 10 * 60_000;
const DIAL_CODES: Record<string, string> = { ZA: "27", ZM: "260", BW: "267", NA: "264", ZW: "263", LS: "266", SZ: "268", MZ: "258" };

export class NeedsAttention extends Error {}

export async function enqueueAliExpressOrders(): Promise<number> {
  const { rows } = await pool!.query(
    `SELECT DISTINCT o.id FROM mkt_orders o
       JOIN mkt_supplier_orders so ON so.order_id = o.id
       JOIN mkt_supplier_products sp ON sp.id = so.supplier_product_id
       LEFT JOIN aliexpress_fulfillments f ON f.order_id = o.id
     WHERE o.payment_status = 'payment_confirmed' AND sp.external_source = 'aliexpress' AND f.id IS NULL AND o.placed_at > $1`,
    [new Date(Date.now() - LOOKBACK_DAYS * 86400_000)]
  );
  const status = rows.length ? await initialFulfilmentStatus("aliexpress") : "queued";
  for (const r of rows) await pool!.query(`INSERT INTO aliexpress_fulfillments (order_id, status) VALUES ($1, $2) ON CONFLICT (order_id) DO NOTHING`, [r.id, status]);
  if (rows.length) logger.info("aliexpress.fulfillment_enqueued", { count: rows.length, status });
  if (status === AWAITING) await notifyAwaiting("aliexpress", rows.map((r: { id: string }) => r.id));
  return rows.length;
}

/** The ds.order.create request for one Ballylife order's AliExpress lines. */
export async function buildAeOrderRequest(order: Row): Promise<{ logistics_address: Row; product_items: Row[] }> {
  const { rows: lines } = await pool!.query(
    `SELECT so.product_id, so.quantity, sp.external_id, sp.external_variants, sp.name AS catalog_name, sp.est_logistic_name
     FROM mkt_supplier_orders so JOIN mkt_supplier_products sp ON sp.id = so.supplier_product_id
     WHERE so.order_id = $1 AND sp.external_source = 'aliexpress'`, [order.id]
  );
  if (!lines.length) throw new NeedsAttention("No AliExpress lines on this order.");
  const items: Row[] = Array.isArray(order.items) ? order.items : [];
  const product_items = lines.map(line => {
    const variants = parseExternalVariants(line.external_variants);
    const item = items.find(i => i.productId === line.product_id);
    const skuAttr = variants.length ? resolveVid(variants, item?.variantId) : "";
    if (variants.length && !skuAttr) throw new NeedsAttention(`The customer's option for "${line.catalog_name}" doesn't match an AliExpress option — re-import the product, then retry.`);
    return {
      product_id: Number(line.external_id), product_count: Number(line.quantity),
      ...(skuAttr ? { sku_attr: skuAttr } : {}),
      ...(line.est_logistic_name ? { logistics_service_name: line.est_logistic_name } : {}),
    };
  });

  const a: Row = order.shipping_address ?? {};
  const country = String(a.country ?? "").toUpperCase();
  const name = `${a.firstName ?? ""} ${a.lastName ?? ""}`.trim();
  const phone = String(a.phone ?? "").replace(/\D/g, "").replace(/^0/, "");
  const missing = [!name && "name", !a.line1 && "street address", !a.city && "city", !/^[A-Z]{2}$/.test(country) && "country", !phone && "phone number"].filter(Boolean);
  if (missing.length) throw new NeedsAttention(`Shipping address is missing: ${missing.join(", ")}.`);
  return {
    logistics_address: {
      full_name: name, contact_person: name, address: a.line1, ...(a.line2 ? { address2: a.line2 } : {}),
      city: a.city, province: a.state || a.province || a.city, zip: a.postalCode ? String(a.postalCode) : undefined, country,
      mobile_no: phone.replace(new RegExp(`^${DIAL_CODES[country] ?? "x"}`), ""), phone_country: `+${DIAL_CODES[country] ?? ""}`, locale: "en_US",
    },
    product_items,
  };
}

function parseCreateResponse(json: Row): { ok: true; orderIds: string[] } | { ok: false; code: string; message: string } {
  const r = (json.aliexpress_ds_order_create_response ?? json.aliexpress_trade_buy_placeorder_response ?? Object.values(json)[0]) as Row;
  const result = r?.result ?? r;
  if (result?.is_success === true || result?.is_success === "true") {
    const raw = result.order_list?.number ?? result.order_list ?? [];
    return { ok: true, orderIds: (Array.isArray(raw) ? raw : [raw]).map(String).filter(Boolean) };
  }
  return { ok: false, code: String(result?.error_code ?? r?.rsp_code ?? "UNKNOWN"), message: String(result?.error_msg ?? r?.rsp_msg ?? "AliExpress didn't place the order") };
}

// Problems retrying can't fix.
const NEEDS_ADMIN = /ADDRESS|INVALID_COUNTRIES|INVALID_ZONE|SUSPICIOUS|ACCOUNT|BLACKLIST|DISABLED|DELIVERY_METHOD|INVENTORY|A00\d/i;

async function place(f: Row): Promise<void> {
  const { rows } = await pool!.query(`SELECT * FROM mkt_orders WHERE id = $1`, [f.order_id]);
  const order = rows[0];
  if (!order || order.status === "cancelled") {
    await pool!.query(`UPDATE aliexpress_fulfillments SET status = 'cancelled', updated_at = now() WHERE id = $1`, [f.id]);
    return;
  }
  const claimed = await pool!.query(`UPDATE aliexpress_fulfillments SET status = 'placing', attempts = attempts + 1, updated_at = now() WHERE id = $1 AND status = 'queued' RETURNING id`, [f.id]);
  if (!claimed.rows.length) return;
  try {
    const req = await buildAeOrderRequest(order);
    const json = await callAsBuyer("aliexpress.ds.order.create", {
      param_place_order_request4_open_api_d_t_o: { ...req, out_order_id: order.order_number },
      ds_extend_request: { payment: { pay_currency: "USD", try_to_pay: AUTO_PAY ? "true" : "false" }, trade_extra_param: { business_model: "retail" } },
    });
    const r = parseCreateResponse(json);
    if (!r.ok) {
      if (NEEDS_ADMIN.test(r.code) || r.code === "REPEATED_ORDER_ERROR") throw new NeedsAttention(`${r.code}: ${r.message}`);
      throw new Error(`${r.code}: ${r.message}`);
    }
    await pool!.query(`UPDATE aliexpress_fulfillments SET status = 'placed', ae_order_ids = $1, last_error = NULL, updated_at = now() WHERE id = $2`, [JSON.stringify(r.orderIds), f.id]);
    logger.info("aliexpress.order_placed", { orderNumber: order.order_number, aeOrderIds: r.orderIds, autoPay: AUTO_PAY });
    if (!AUTO_PAY) await alert(f.id, order.order_number, "is placed on AliExpress and waiting for payment",
      `Pay AliExpress order${r.orderIds.length > 1 ? "s" : ""} ${r.orderIds.join(", ")} in your AliExpress account (My Orders → Awaiting payment) so it ships.`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof NeedsAttention || (err instanceof AliExpressError && (err.kind === "config" || err.kind === "not_connected"))) {
      await pool!.query(`UPDATE aliexpress_fulfillments SET status = 'needs_attention', last_error = $1, updated_at = now() WHERE id = $2`, [message.slice(0, 500), f.id]);
      await alert(f.id, order.order_number, "couldn't be placed on AliExpress", message);
      return;
    }
    const attempts = Number(f.attempts) + 1;
    const delay = BACKOFF_MINUTES[attempts - 1];
    if (delay === undefined) {
      await pool!.query(`UPDATE aliexpress_fulfillments SET status = 'failed', last_error = $1, updated_at = now() WHERE id = $2`, [message.slice(0, 500), f.id]);
      await alert(f.id, order.order_number, "failed to place on AliExpress after several tries", message);
    } else {
      await pool!.query(`UPDATE aliexpress_fulfillments SET status = 'queued', last_error = $1, next_attempt_at = $2, updated_at = now() WHERE id = $3`,
        [message.slice(0, 500), new Date(Date.now() + delay * 60_000), f.id]);
    }
    logger.warn("aliexpress.order_place_failed", { orderNumber: order.order_number, attempts, error: message });
  }
}

export async function placeDueOrders(limit = 5): Promise<number> {
  // Stuck mid-placement: the order may exist on AliExpress already -- an admin checks.
  const { rows: stuck } = await pool!.query(`SELECT id, order_id FROM aliexpress_fulfillments WHERE status = 'placing' AND updated_at < $1`, [new Date(Date.now() - STUCK_PLACING_MS)]);
  for (const s of stuck) {
    await pool!.query(`UPDATE aliexpress_fulfillments SET status = 'needs_attention', last_error = $1, updated_at = now() WHERE id = $2`,
      ["Placement was interrupted. Check your AliExpress orders for this order number before retrying, so it isn't ordered twice.", s.id]);
  }
  const { rows } = await pool!.query(`SELECT * FROM aliexpress_fulfillments WHERE status = 'queued' AND next_attempt_at <= now() ORDER BY created_at LIMIT $1`, [limit]);
  for (const f of rows) await place(f);
  return rows.length;
}

// WAIT_SELLER_SEND_GOODS = paid, seller hasn't shipped yet; these mean at least part is on its way.
const SHIPPED = /SELLER_PART_SEND_GOODS|WAIT_BUYER_ACCEPT|SHIPPED/i;
const DONE = /FINISH|COMPLETED/i;
const CANCELLED = /CANCEL|CLOSED|FAILED/i;
const PAID = /WAIT_SELLER|SEND_GOODS|WAIT_BUYER|FUND_PROCESSING|FINISH|IN_ISSUE|IN_FROZEN/i;

export async function syncPlacedOrders(limit = 20): Promise<number> {
  const { rows } = await pool!.query(
    `SELECT * FROM aliexpress_fulfillments WHERE status IN ('placed', 'shipped') AND (last_synced_at IS NULL OR last_synced_at < $1) ORDER BY last_synced_at NULLS FIRST LIMIT $2`,
    [new Date(Date.now() - 3600_000), limit]
  );
  for (const f of rows) {
    const ids: string[] = Array.isArray(f.ae_order_ids) ? f.ae_order_ids : [];
    try {
      let status = f.ae_status as string | null;
      let tracking: string | null = f.tracking_number;
      let service: string | null = f.logistics_service;
      for (const id of ids) {
        const json = await callAsBuyer("aliexpress.trade.ds.order.get", { single_order_query: { order_id: id } });
        const r = ((json.aliexpress_trade_ds_order_get_response ?? Object.values(json)[0]) as Row)?.result ?? {};
        status = String(r.order_status ?? status ?? "");
        const logistics = (r.logistics_info_list?.ae_order_logistics_info ?? r.logistics_info_list ?? []) as Row[];
        const first = (Array.isArray(logistics) ? logistics : [logistics])[0];
        if (first?.logistics_no) { tracking = String(first.logistics_no); service = String(first.logistics_service ?? service ?? ""); }
      }
      const next = status && DONE.test(status) ? "delivered" : status && CANCELLED.test(status) ? "cancelled" : tracking || (status && SHIPPED.test(status)) ? "shipped" : f.status;
      await pool!.query(
        `UPDATE aliexpress_fulfillments SET ae_status = $1, tracking_number = $2, logistics_service = $3, paid = $4, status = $5, last_synced_at = now(), updated_at = now() WHERE id = $6`,
        [status, tracking, service, Boolean(status && PAID.test(status)), next, f.id]
      );
      if (tracking && !f.tracking_number) {
        await pool!.query(`UPDATE mkt_orders SET tracking_number = COALESCE(tracking_number, $2), carrier = COALESCE(carrier, $3), shipping_status = 'in_transit', shipped_at = COALESCE(shipped_at, now()) WHERE id = $1`,
          [f.order_id, tracking, CARRIER]);
      }
      if (next === "delivered") await pool!.query(`UPDATE mkt_orders SET status = 'delivered', shipping_status = 'delivered', delivered_at = COALESCE(delivered_at, now()) WHERE id = $1`, [f.order_id]);
      if (next === "cancelled" && f.status !== "cancelled") {
        const { rows: o } = await pool!.query(`SELECT order_number FROM mkt_orders WHERE id = $1`, [f.order_id]);
        await alert(f.id, o[0]?.order_number ?? "?", "was cancelled on AliExpress", `AliExpress status: ${status}. The customer has paid — re-place it or refund them.`);
      }
    } catch (err) {
      logger.warn("aliexpress.order_sync_failed", { id: f.id, error: err instanceof Error ? err.message : String(err) });
      await pool!.query(`UPDATE aliexpress_fulfillments SET last_synced_at = now() WHERE id = $1`, [f.id]);
    }
  }
  return rows.length;
}

async function alert(fulfilmentId: string, orderNumber: string, what: string, detail: string): Promise<void> {
  logger.warn("aliexpress.fulfillment_alert", { fulfilmentId, orderNumber, what, detail });
  if (!ALERT_EMAIL) return;
  await sendEmail({
    to: ALERT_EMAIL,
    subject: `AliExpress: order ${orderNumber} ${what}`,
    html: `<p>Order <b>${esc(orderNumber)}</b> ${esc(what)}.</p><p>${esc(detail)}</p><p>See Admin → AliExpress.</p>`,
  }).catch(() => undefined);
  await pool!.query(`UPDATE aliexpress_fulfillments SET alerted_at = now() WHERE id = $1`, [fulfilmentId]).catch(() => undefined);
}

function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

export async function retryFulfillment(id: string): Promise<Row | null> {
  const { rows } = await pool!.query(
    `UPDATE aliexpress_fulfillments SET status = 'queued', next_attempt_at = now(), last_error = NULL, updated_at = now()
     WHERE id::text = $1 AND status IN ('needs_attention', 'failed') RETURNING *`, [id]
  );
  return rows[0] ?? null;
}

export async function runAliExpressCycle(): Promise<void> {
  const s = await connectionStatus();
  if (!s.configured || !s.connected) return;
  await enqueueAliExpressOrders();
  await placeDueOrders();
  await syncPlacedOrders();
}

// ── Worker ───────────────────────────────────────────────────────────────

let lastRefresh = 0;
export function startAliExpressWorker(): NodeJS.Timeout | null {
  if (!pool) return null;
  const run = async () => {
    try {
      await runAliExpressCycle();
      const { runAeSourcingTick } = await import("./aliexpressAutoSource");
      await runAeSourcingTick();
      if (Date.now() - lastRefresh > 3600_000) {
        lastRefresh = Date.now();
        const s = await connectionStatus();
        if (s.configured && s.connected) {
          const { refreshAeProducts } = await import("./aliexpressCatalog");
          await refreshAeProducts(30);
        }
      }
    } catch (err) {
      logger.error("aliexpress.cycle_failed", { error: err instanceof Error ? err.message : String(err) });
    }
  };
  setTimeout(() => void run(), 45_000).unref();
  const timer = setInterval(() => void run(), 60_000);
  timer.unref();
  logger.info("aliexpress.worker_started", { autoPay: AUTO_PAY });
  return timer;
}
