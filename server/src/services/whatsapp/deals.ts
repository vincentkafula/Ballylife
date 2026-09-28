/**
 * "Deals on WhatsApp": new-product offers for customers who asked for them.
 *
 * - Opt-in only: the customer taps "Yes, send me deals" (type *deals*); the
 *   time is recorded as their marketing consent (POPIA). "STOP DEALS" stops
 *   just these; "STOP" stops everything.
 * - Staff send one product at a time from the dashboard, after confirming the
 *   number of recipients. Nobody gets more than one offer every 3 days.
 * - Inside the free 24-hour window the offer goes as a photo message; outside
 *   it, as the approved "new_arrival" marketing template (Meta charges per
 *   marketing message).
 */
import { pool } from "../../db/pool";
import { logger } from "../../utils/logger";
import { sendImage, sendText, sendTemplate } from "./client";
import { productPhotoUrl, zar } from "./flows/shop";

type Row = Record<string, any>;
const SITE = () => (process.env.MARKETPLACE_PUBLIC_URL || "https://www.ballylife.com").replace(/\/$/, "");
const MIN_DAYS_BETWEEN = () => Number(process.env.WHATSAPP_DEALS_MIN_DAYS ?? 3);
const PER_SECOND = 5;

export async function dealsOptIn(phone: string): Promise<void> {
  await pool!.query(`UPDATE wa_contacts SET deals_opt_in_at = now(), deals_opt_out_at = NULL, updated_at = now() WHERE phone = $1`, [phone]);
  await sendText(phone, "🔔 Done! We'll send you our best new arrivals — at most one every few days. Reply *STOP DEALS* any time to stop them.");
}

export async function dealsOptOut(phone: string): Promise<void> {
  await pool!.query(`UPDATE wa_contacts SET deals_opt_out_at = now(), updated_at = now() WHERE phone = $1`, [phone]);
  await sendText(phone, "You won't get deals messages any more. You'll still get updates about your own orders. (Type *deals* to turn them back on.)");
}

export async function askDeals(phone: string): Promise<void> {
  const { sendButtons } = await import("./client");
  await sendButtons(phone, "🔔 Want our best *new arrivals and deals* on WhatsApp? At most one message every few days, and you can stop any time.",
    [{ id: "deals:yes", title: "✅ Yes, send deals" }, { id: "deals:no", title: "No thanks" }]);
}

const SUBSCRIBED = `opted_out = false AND deals_opt_in_at IS NOT NULL AND deals_opt_out_at IS NULL`;

export async function subscriberCount(): Promise<{ subscribers: number; reachableNow: number }> {
  const { rows } = await pool!.query(`SELECT last_marketing_at FROM wa_contacts WHERE ${SUBSCRIBED}`);
  const cutoff = Date.now() - MIN_DAYS_BETWEEN() * 24 * 3600_000;
  return { subscribers: rows.length, reachableNow: rows.filter((r: Row) => !r.last_marketing_at || new Date(r.last_marketing_at).getTime() < cutoff).length };
}

export async function recentBroadcasts(limit = 10) {
  const { rows } = await pool!.query(
    `SELECT b.*, p.name AS product_name FROM wa_broadcasts b LEFT JOIN mkt_products p ON p.id = b.product_id ORDER BY b.created_at DESC LIMIT $1`, [limit]);
  return rows.map((b: Row) => ({ id: b.id, productName: b.product_name, status: b.status, recipients: b.recipients, sent: b.sent, failed: b.failed, createdBy: b.created_by, createdAt: b.created_at }));
}

/** Starts sending one product to every subscriber due a message. Returns at once; sending continues in the background. */
export async function startBroadcast(productId: string, createdBy: string): Promise<{ id: string; recipients: number }> {
  const { rows: p } = await pool!.query(`SELECT id, name, price, images, status FROM mkt_products WHERE id::text = $1`, [productId]);
  const product = p[0];
  if (!product || product.status !== "active") throw new Error("Choose an active product.");
  const photo = productPhotoUrl(product);
  if (!photo) throw new Error("That product has no photo to show.");
  const cutoff = new Date(Date.now() - MIN_DAYS_BETWEEN() * 24 * 3600_000);
  const { rows: all } = await pool!.query(
    `SELECT c.phone, c.profile_name, c.last_inbound_at, c.last_marketing_at, u.name AS user_name
       FROM wa_contacts c LEFT JOIN users u ON u.id = c.user_id WHERE ${SUBSCRIBED}`);
  const recipients = (all as Row[]).filter(r => !r.last_marketing_at || new Date(r.last_marketing_at) < cutoff);
  if (!recipients.length) throw new Error("Nobody is due a deals message right now (subscribers get at most one every few days).");
  const { rows } = await pool!.query(`INSERT INTO wa_broadcasts (product_id, created_by, recipients) VALUES ($1, $2, $3) RETURNING id`, [product.id, createdBy, recipients.length]);
  const id = String(rows[0].id);
  logger.info("whatsapp.broadcast_started", { id, recipients: recipients.length });
  void sendAll(id, product, photo, recipients).catch(err => logger.error("whatsapp.broadcast_failed", { id, error: String(err) }));
  return { id, recipients: recipients.length };
}

async function sendAll(id: string, product: Row, photo: string, recipients: Row[]): Promise<void> {
  let sent = 0, failed = 0;
  const link = `${SITE()}/product/${product.id}`;
  for (const r of recipients) {
    const first = String(r.user_name ?? r.profile_name ?? "there").split(" ")[0] || "there";
    const inWindow = r.last_inbound_at && Date.now() - new Date(r.last_inbound_at).getTime() < 23.5 * 3600_000;
    try {
      const ok = inWindow
        ? await sendImage(r.phone, photo, `✨ New on Ballylife: *${product.name}* — ${zar(product.price)}, delivery included.\n\n🛒 ${link}\n\nReply *STOP DEALS* to stop these messages.`)
        : await sendTemplate(r.phone, "new_arrival", [first, String(product.name).slice(0, 60), zar(product.price)], { buttonParam: String(product.id) });
      if (ok) { sent++; await pool!.query(`UPDATE wa_contacts SET last_marketing_at = now() WHERE phone = $1`, [r.phone]); }
      else failed++;
    } catch { failed++; }
    if ((sent + failed) % 10 === 0) await pool!.query(`UPDATE wa_broadcasts SET sent = $2, failed = $3 WHERE id = $1`, [id, sent, failed]);
    await new Promise(res => setTimeout(res, 1000 / PER_SECOND));
  }
  await pool!.query(`UPDATE wa_broadcasts SET sent = $2, failed = $3, status = 'done', finished_at = now() WHERE id = $1`, [id, sent, failed]);
  logger.info("whatsapp.broadcast_done", { id, sent, failed });
}
