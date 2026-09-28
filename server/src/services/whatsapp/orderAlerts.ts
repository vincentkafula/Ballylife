/**
 * Order updates on WhatsApp.
 *
 * Every 2 minutes, looks at recent orders and tells people what changed:
 *   - customers: paid, shipped (with tracking), delivered, cancelled, refunded
 *   - sellers:   one "new order" alert when an order with their items is paid
 * Payments are confirmed in several places (PayFast, EFT, admin), so a
 * check of the orders themselves catches them all. wa_order_notifications
 * remembers what each person was last told, so nothing is sent twice.
 *
 * Only numbers that registered or linked on WhatsApp are messaged, never
 * opted-out ones. On its very first run it only records existing orders
 * (no messages about old orders).
 */
import { pool } from "../../db/pool";
import { logger } from "../../utils/logger";
import { templateOrText } from "./notifications";
import { customerStatus } from "./orders";
import { zar } from "./flows/shop";

type Row = Record<string, any>;
const BASELINE_FLAG = "wa_order_alerts_baseline_v1";
const SITE = () => (process.env.MARKETPLACE_PUBLIC_URL || "https://www.ballylife.com").replace(/\/$/, "");
const items = (o: Row): Row[] => (typeof o.items === "string" ? JSON.parse(o.items) : (o.items ?? []));

async function lastTold(orderId: string, audience: string): Promise<string | null> {
  const { rows } = await pool!.query(`SELECT last_status FROM wa_order_notifications WHERE order_id = $1 AND audience = $2`, [orderId, audience]);
  return rows[0]?.last_status ?? null;
}

async function remember(orderId: string, audience: string, status: string): Promise<void> {
  const upd = await pool!.query(`UPDATE wa_order_notifications SET last_status = $3, notified_at = now() WHERE order_id = $1 AND audience = $2`, [orderId, audience, status]);
  if (!upd.rowCount) await pool!.query(`INSERT INTO wa_order_notifications (order_id, audience, last_status) VALUES ($1, $2, $3)`, [orderId, audience, status]);
}

/** The WhatsApp number linked to an account, unless they opted out. */
async function phoneFor(userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const { rows } = await pool!.query(`SELECT phone FROM wa_contacts WHERE user_id::text = $1 AND NOT opted_out LIMIT 1`, [userId]);
  return rows[0]?.phone ?? null;
}

function customerMessage(o: Row, key: string, first: string): { label: string; extra: string; text: string } | null {
  const n = o.order_number;
  const tracking = o.tracking_number ? ` Tracking number: ${o.tracking_number}${o.carrier ? ` (${o.carrier})` : ""}.` : "";
  switch (key) {
    case "confirmed": return { label: "paid", extra: "We're preparing it now and will let you know when it ships.",
      text: `✅ Hi ${first}, we've received your payment for order *${n}* (${zar(o.total_amount)}). We're preparing it now — we'll message you when it ships.` };
    case "shipped": return { label: "on its way", extra: `It has been shipped.${tracking}`,
      text: `🚚 Good news, ${first}! Your order *${n}* is on its way.${tracking}\n\nTrack it any time: type *orders*.` };
    case "delivered": return { label: "delivered", extra: "Enjoy! Reply to this message if anything isn't right.",
      text: `📦 Your order *${n}* has been delivered. Enjoy, ${first}! If anything isn't right, reply here or see ${SITE()}/returns-policy.` };
    case "cancelled": return { label: "cancelled", extra: "If you already paid, your refund will follow. Reply with any questions.",
      text: `Your order *${n}* was cancelled. If you already paid, your refund will follow. Reply here with any questions.` };
    case "refunded": return { label: "refunded", extra: "The money is on its way back to you.",
      text: `💸 Your refund for order *${n}* has been processed — the money is on its way back to you.` };
    default: return null;
  }
}

/** First run: remember every existing order as "already told", without sending anything. */
async function baselineOnce(): Promise<boolean> {
  const { rows } = await pool!.query(`SELECT 1 FROM app_flags WHERE key = $1`, [BASELINE_FLAG]);
  if (rows.length) return false;
  const { rows: orders } = await pool!.query(`SELECT * FROM mkt_orders WHERE placed_at > now() - interval '30 days'`);
  for (const o of orders) {
    const key = customerStatus(o).key;
    if (key !== "pending") await remember(o.id, "customer", key);
    if (o.payment_status === "payment_confirmed") {
      for (const sid of new Set(items(o).map(i => String(i.sellerId ?? "")).filter(Boolean))) await remember(o.id, `seller:${sid}`, "new_order");
    }
  }
  await pool!.query(`INSERT INTO app_flags (key, detail) VALUES ($1, $2)`, [BASELINE_FLAG, JSON.stringify({ orders: orders.length })]);
  logger.info("whatsapp.order_alerts_baseline", { orders: orders.length });
  return true;
}

export async function runOrderAlerts(): Promise<{ customers: number; sellers: number }> {
  const sent = { customers: 0, sellers: 0 };
  if (await baselineOnce()) return sent;
  const { rows: orders } = await pool!.query(
    `SELECT o.*, u.name AS user_name FROM mkt_orders o LEFT JOIN users u ON u.id::text = o.user_id
      WHERE o.placed_at > now() - interval '30 days' AND NOT o.is_demo ORDER BY o.placed_at LIMIT 500`);
  for (const o of orders as Row[]) {
    try {
      // Customer: tell them when the status moves on.
      const key = customerStatus(o).key;
      if (key !== "pending" && (await lastTold(o.id, "customer")) !== key) {
        const phone = await phoneFor(o.user_id);
        const first = String(o.user_name ?? o.customer_name ?? "there").split(" ")[0];
        const msg = customerMessage(o, key, first);
        if (phone && msg) {
          await templateOrText(phone, "order_status_update", [first, String(o.order_number), msg.label, msg.extra], msg.text);
          sent.customers++;
        }
        await remember(o.id, "customer", key);
      }
      // Sellers: one alert per paid order that contains their items.
      if (o.payment_status === "payment_confirmed" && !o.cancelled_at) {
        const bySeller = new Map<string, Row[]>();
        for (const i of items(o)) if (i.sellerId) bySeller.set(String(i.sellerId), [...(bySeller.get(String(i.sellerId)) ?? []), i]);
        for (const [sellerId, lines] of bySeller) {
          const audience = `seller:${sellerId}`;
          if (await lastTold(o.id, audience)) continue;
          const { rows: s } = await pool!.query(`SELECT user_id FROM mkt_sellers WHERE id = $1`, [sellerId]);
          const phone = await phoneFor(s[0]?.user_id ?? null);
          if (phone) {
            const count = lines.reduce((n, i) => n + Number(i.quantity ?? 1), 0);
            const total = zar(lines.reduce((t, i) => t + Number(i.unitPrice ?? 0) * Number(i.quantity ?? 1), 0));
            await templateOrText(phone, "seller_new_order", [String(o.order_number), String(count), total],
              `🔔 *New order ${o.order_number}!*\n\n${lines.slice(0, 5).map(i => `• ${i.name}${i.variantLabel ? ` (${i.variantLabel})` : ""} × ${i.quantity}`).join("\n")}\n\nYour total: *${total}*. Please prepare it for dispatch. Type *store orders* to see recent orders.`);
            sent.sellers++;
          }
          await remember(o.id, audience, "new_order");
        }
      }
    } catch (err) {
      logger.error("whatsapp.order_alert_failed", { orderId: o.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  if (sent.customers || sent.sellers) logger.info("whatsapp.order_alerts_sent", sent);
  return sent;
}

export function startOrderAlerts(): NodeJS.Timeout | null {
  if (!pool) return null;
  const run = () => void runOrderAlerts().catch(err => logger.error("whatsapp.order_alerts_failed", { error: String(err) }));
  setTimeout(run, 30_000).unref();
  const t = setInterval(run, 2 * 60_000);
  t.unref();
  return t;
}
