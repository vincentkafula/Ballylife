/**
 * Shopping on WhatsApp: search, see a product (photo, price, rating),
 * then "Buy now" -- which puts it in the customer's normal Ballylife cart
 * (same rules as the website: stock, colour/size choice) and sends a
 * one-time sign-in link that opens checkout. Payment stays on the website
 * (PayFast), so no card details ever go through WhatsApp.
 */
import { pool } from "../../../db/pool";
import { sendText, sendButtons, sendList, sendButtonsWithImage } from "../client";
import { createMagicToken, magicLoginUrl, MAGIC_LINK_MINUTES } from "../../magicLink";
import { publicImages } from "../../../utils/supplierWhiteLabel";
import type { Flow } from "../types";

type Row = Record<string, any>;
const API = () => (process.env.PUBLIC_API_URL || "https://ballylife-backend-production.up.railway.app").replace(/\/$/, "");
const SITE = () => (process.env.MARKETPLACE_PUBLIC_URL || "https://www.ballylife.com").replace(/\/$/, "");
export const zar = (n: number) => `R${Math.round(Number(n)).toLocaleString("en-ZA")}`;

/** Active products matching the words, best sellers first. */
export async function searchProducts(query: string, limit = 9): Promise<Row[]> {
  const words = query.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, " ").split(/\s+/).filter(w => w.length > 1).slice(0, 4);
  if (!words.length) return [];
  const params = words.map(w => `%${w}%`);
  const { rows } = await pool!.query(
    `SELECT id, name, price, compare_at_price, avg_rating, total_sold, images FROM mkt_products
      WHERE status = 'active' AND stock > 0 AND ${words.map((_, i) => `LOWER(name) LIKE $${i + 1}`).join(" AND ")}
      ORDER BY total_sold DESC, avg_rating DESC LIMIT ${Number(limit) * 3}`, params);
  // Only products with a real photo -- colour placeholders aren't worth showing.
  return rows.filter((r: Row) => (Array.isArray(r.images) ? r.images : []).some((i: unknown) => typeof i === "string" && /^https?:\/\//.test(i))).slice(0, limit);
}

/** A public https URL for a product's first photo (supplier photos go through our proxy). */
export function productPhotoUrl(p: Row): string | null {
  const first = publicImages("p", String(p.id), p.images).find(i => typeof i === "string" && (i.startsWith("/") || /^https:\/\//.test(i)));
  if (typeof first !== "string") return null;
  return first.startsWith("/") ? `${API()}${first}` : first;
}

async function loadProduct(id: string): Promise<Row | null> {
  const { rows } = await pool!.query(
    `SELECT id, name, price, compare_at_price, avg_rating, review_count, stock, images, short_description, status FROM mkt_products WHERE id::text = $1`, [id]);
  return rows[0] ?? null;
}

export const shopFlow: Flow = {
  id: "shop",
  steps: [
    {
      id: "sh_query",
      ask: async ctx => { await sendText(ctx.phone, "🛍️ What are you looking for? Type a product, e.g. *wireless earbuds*, *air fryer* or *kids shoes*."); },
      handle: async input => {
        if (input.kind !== "text" || input.text.trim().length < 2) return { ok: false, retry: "Type what you're looking for, e.g. *phone holder*." };
        const results = await searchProducts(input.text);
        if (!results.length) return { ok: false, retry: `Sorry, nothing found for "${input.text.trim().slice(0, 40)}". Try other words, or browse everything at ${SITE()}/catalog` };
        return { ok: true, set: { query: input.text.trim(), resultIds: results.map(r => String(r.id)) } };
      },
    },
    {
      id: "sh_pick",
      ask: async ctx => {
        const ids: string[] = ctx.data.resultIds ?? [];
        const { rows } = ids.length ? await pool!.query(`SELECT id, name, price, avg_rating FROM mkt_products WHERE id::text IN (${ids.map((_, i) => "$" + (i + 1)).join(",")})`, ids) : { rows: [] };
        const byId = new Map(rows.map((r: Row) => [String(r.id), r]));
        const ordered = ids.map(id => byId.get(id)).filter(Boolean) as Row[];
        await sendList(ctx.phone, `Here's what I found for *${ctx.data.query}* — tap one to see it:`, "See products", [{
          rows: [
            ...ordered.map(r => ({ id: `prod:${r.id}`, title: String(r.name), description: `${zar(r.price)}${Number(r.avg_rating) > 0 ? ` · ★${Number(r.avg_rating).toFixed(1)}` : ""} · delivery included` })),
            { id: "search", title: "🔍 New search" },
          ],
        }]);
      },
      handle: async input => {
        if (input.kind === "choice" && input.id === "search") return { ok: true, next: "sh_query" };
        if (input.kind === "choice" && input.id.startsWith("prod:")) return { ok: true, set: { productId: input.id.slice(5) } };
        if (input.kind === "text" && input.text.trim().length >= 2) { // a new search typed straight in
          const results = await searchProducts(input.text);
          if (!results.length) return { ok: false, retry: `Sorry, nothing found for "${input.text.trim().slice(0, 40)}". Try other words.` };
          return { ok: true, next: "sh_pick", set: { query: input.text.trim(), resultIds: results.map(r => String(r.id)) } };
        }
        return { ok: false, retry: "Please pick a product from the list.", reask: true };
      },
    },
    {
      id: "sh_product",
      ask: async ctx => {
        const p = await loadProduct(ctx.data.productId);
        if (!p || p.status !== "active") { await sendText(ctx.phone, "Sorry, that product is no longer available. Type *shop* to search again."); return; }
        const was = p.compare_at_price && Number(p.compare_at_price) > Number(p.price) ? ` ~${zar(p.compare_at_price)}~` : "";
        const rating = Number(p.avg_rating) > 0 ? `\n★ ${Number(p.avg_rating).toFixed(1)} (${p.review_count ?? 0} reviews)` : "";
        const blurb = String(p.short_description ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
        const text = `*${p.name}*\n\n💰 *${zar(p.price)}*${was} — delivery included${rating}${blurb ? `\n\n${blurb}` : ""}\n\n🔗 ${SITE()}/product/${p.id}`;
        const buttons = [{ id: "buy", title: "🛒 Buy now" }, { id: "search", title: "🔍 New search" }, { id: "back", title: "⬅️ Back to list" }];
        const photo = productPhotoUrl(p);
        if (photo) await sendButtonsWithImage(ctx.phone, photo, text, buttons);
        else await sendButtons(ctx.phone, text, buttons);
      },
      handle: async (input, ctx) => {
        if (input.kind !== "choice") return { ok: false, retry: "Tap *Buy now*, *New search* or *Back to list*.", reask: true };
        if (input.id === "search") return { ok: true, next: "sh_query" };
        if (input.id === "back") return { ok: true, next: "sh_pick" };
        if (input.id !== "buy") return { ok: false, retry: "Tap *Buy now*, *New search* or *Back to list*.", reask: true };
        if (!ctx.userId) return { ok: true, next: "sh_account" };
        const { addToCart } = await import("../../../routes/marketplaceRouter");
        const r = await addToCart(ctx.userId, ctx.data.productId, null, 1);
        if (!r.ok && r.code === "VARIANT_REQUIRED") {
          const token = await createMagicToken(ctx.userId, "login", ctx.phone);
          await sendText(ctx.phone, `This product comes in different options (colour/size). Tap to choose yours and check out (link works once, for ${MAGIC_LINK_MINUTES} minutes):\n${magicLoginUrl(token, `/product/${ctx.data.productId}`)}`,
            { logAs: "[choose-option link]" });
          return { ok: true, done: true };
        }
        if (!r.ok) return { ok: false, retry: `Sorry — ${r.error}` };
        const token = await createMagicToken(ctx.userId, "login", ctx.phone);
        await sendText(ctx.phone,
          `✅ Added to your cart!\n\nTap to check out securely — card, EFT or pay later (link works once, for ${MAGIC_LINK_MINUTES} minutes):\n${magicLoginUrl(token, "/checkout")}\n\nType *shop* to keep shopping or *orders* to track orders.`,
          { logAs: "✅ Added to your cart! [checkout link]" });
        return { ok: true, done: true };
      },
    },
    {
      id: "sh_account",
      ask: async ctx => {
        await sendButtons(ctx.phone, "To order you need a free Ballylife account — it takes 1 minute, right here in WhatsApp.",
          [{ id: "register", title: "✅ Create account" }, { id: "back", title: "⬅️ Back" }]);
      },
      handle: async input => {
        if (input.kind === "choice" && input.id === "register") return { ok: true, startFlow: "customer" };
        if (input.kind === "choice" && input.id === "back") return { ok: true, next: "sh_product" };
        return { ok: false, retry: "Tap *Create account* or *Back*.", reask: true };
      },
    },
  ],
  async finish() { /* navigation flow: ends with done */ },
};
