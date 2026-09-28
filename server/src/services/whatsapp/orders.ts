/**
 * Order tracking on WhatsApp: a customer's recent orders and one order's
 * details, and a seller's recent paid orders for their store. Read-only;
 * everything comes from the same mkt_orders table the website uses.
 */
import { pool } from "../../db/pool";
import { sendText, sendList } from "./client";
import { zar } from "./flows/shop";

type Row = Record<string, any>;
const SITE = () => (process.env.MARKETPLACE_PUBLIC_URL || "https://www.ballylife.com").replace(/\/$/, "");
const items = (o: Row): Row[] => (typeof o.items === "string" ? JSON.parse(o.items) : (o.items ?? []));
const date = (d: string | Date) => new Date(d).toLocaleDateString("en-ZA", { day: "numeric", month: "short" });

/** What an order's state means for the customer, in plain words. */
export function customerStatus(o: Row): { key: string; label: string } {
  const s = String(o.status ?? "").toLowerCase();
  if (s === "cancelled" || o.cancelled_at) return { key: "cancelled", label: "Cancelled" };
  if (s === "refunded") return { key: "refunded", label: "Refunded" };
  if (s === "delivered" || o.delivered_at) return { key: "delivered", label: "Delivered ✅" };
  if (s === "shipped" || s === "in_transit" || s === "out_for_delivery" || o.shipped_at || o.shipping_status === "shipped") return { key: "shipped", label: "On its way 🚚" };
  if (o.payment_status === "payment_confirmed") return { key: "confirmed", label: "Paid — being prepared 📦" };
  return { key: "pending", label: "Awaiting payment" };
}

export async function sendMyOrders(phone: string, userId: string): Promise<void> {
  const { rows } = await pool!.query(
    `SELECT id, order_number, total_amount, status, payment_status, shipping_status, shipped_at, delivered_at, cancelled_at, placed_at
       FROM mkt_orders WHERE user_id = $1 AND NOT is_demo ORDER BY placed_at DESC LIMIT 9`, [userId]);
  if (!rows.length) { await sendText(phone, "You don't have any orders yet. Type *shop* to find something you like! 🛍️"); return; }
  await sendList(phone, "📦 Your recent orders — tap one for details and tracking:", "My orders", [{
    rows: rows.map((o: Row) => ({ id: `order:${o.id}`, title: String(o.order_number), description: `${customerStatus(o).label} · ${zar(o.total_amount)} · ${date(o.placed_at)}` })),
  }]);
}

export async function sendOrderDetail(phone: string, userId: string, orderId: string): Promise<void> {
  const { rows } = await pool!.query(`SELECT * FROM mkt_orders WHERE id::text = $1 AND user_id = $2`, [orderId, userId]);
  const o = rows[0];
  if (!o) { await sendText(phone, "I couldn't find that order. Type *orders* to see your orders."); return; }
  const lines = items(o).slice(0, 8).map(i => `• ${i.name ?? "Item"}${i.variantLabel ? ` (${i.variantLabel})` : ""} × ${i.quantity ?? 1}`);
  const tracking = o.tracking_number ? `\n🚚 Tracking: *${o.tracking_number}*${o.carrier ? ` (${o.carrier})` : ""}` : "";
  const eta = o.estimated_delivery ? `\n📅 Expected by ${date(o.estimated_delivery)}` : "";
  const pay = o.payment_status !== "payment_confirmed" && !o.cancelled_at ? `\n\n💳 Not paid yet — pay from *My Orders* on ${SITE()}/orders` : "";
  await sendText(phone, `*Order ${o.order_number}* (${date(o.placed_at)})\nStatus: *${customerStatus(o).label}*${tracking}${eta}\n\n${lines.join("\n")}\n\nTotal: *${zar(o.total_amount)}*${pay}\n\nMore details: ${SITE()}/orders`);
}

/** A seller's store: their lines in the most recent paid orders. */
export async function sendSellerOrders(phone: string, sellerId: string): Promise<void> {
  const { rows } = await pool!.query(
    `SELECT id, order_number, items, status, payment_status, shipped_at, delivered_at, cancelled_at, shipping_status, placed_at FROM mkt_orders
      WHERE items::text LIKE $1 AND NOT is_demo AND payment_status = 'payment_confirmed' ORDER BY placed_at DESC LIMIT 5`, [`%"sellerId":"${sellerId}"%`]);
  if (!rows.length) { await sendText(phone, "🧾 No paid orders for your store yet. We'll message you here the moment one comes in."); return; }
  const blocks = rows.map((o: Row) => {
    const mine = items(o).filter(i => i.sellerId === sellerId);
    const total = mine.reduce((s, i) => s + Number(i.unitPrice ?? 0) * Number(i.quantity ?? 1), 0);
    return `*${o.order_number}* · ${date(o.placed_at)} · ${customerStatus(o).label}\n${mine.slice(0, 4).map(i => `  • ${i.name} × ${i.quantity}`).join("\n")}\n  Your total: ${zar(total)}`;
  });
  await sendText(phone, `🧾 *Your latest orders*\n\n${blocks.join("\n\n")}\n\nManage and ship orders in your seller dashboard (type *menu* → Sign-in link).`);
}
