/**
 * Seller tools on WhatsApp, for approved sellers only.
 *
 *  - My products: pick a product, update its stock, pause / reactivate it.
 *    Prices can't be changed here -- on Ballylife only managers set prices,
 *    exactly like the website's seller dashboard.
 *  - Add a product: name, category, price, stock, description, photos. It's
 *    created with status pending_review (admin approval), through the same
 *    function the website uses -- and only when the catalog policy allows
 *    sellers' own products (CJ_ONLY_CATALOG off).
 */
import { pool } from "../../../db/pool";
import { logger } from "../../../utils/logger";
import { sendText, sendButtons, sendList, downloadMedia } from "../client";
import { putProductPhoto, isDocumentStoreConfigured, MAX_DOCUMENT_BYTES } from "../../documentStore";
import { cjOnlyCatalog } from "../../../utils/catalogPolicy";
import { topCategories } from "./seller";
import { zar } from "./shop";
import type { Flow } from "../types";

type Row = Record<string, any>;
const API = () => (process.env.PUBLIC_API_URL || "https://ballylife-backend-production.up.railway.app").replace(/\/$/, "");
const MAX_PHOTOS = 3;

/** The approved seller store belonging to this account, if any. */
export async function activeSellerFor(userId: string | null): Promise<{ id: string; storeName: string; status: string } | null> {
  if (!userId) return null;
  const { rows } = await pool!.query(`SELECT id, store_name, status FROM mkt_sellers WHERE user_id = $1 LIMIT 1`, [userId]);
  return rows[0] ? { id: String(rows[0].id), storeName: String(rows[0].store_name), status: String(rows[0].status) } : null;
}

async function mySellerId(userId: string | null): Promise<string | null> {
  const s = await activeSellerFor(userId);
  return s?.status === "active" ? s.id : null;
}

const statusLabel = (s: string) => (s === "active" ? "live" : s === "inactive" ? "paused" : s === "pending_review" ? "waiting for approval" : s);

export const sellerProductsFlow: Flow = {
  id: "seller_products",
  steps: [
    {
      id: "sp_list",
      ask: async ctx => {
        const sellerId = await mySellerId(ctx.userId);
        const { rows } = sellerId
          ? await pool!.query(`SELECT id, name, price, stock, status FROM mkt_products WHERE seller_id = $1 AND status <> 'archived' ORDER BY created_at DESC LIMIT 9`, [sellerId])
          : { rows: [] };
        if (!rows.length) { await sendText(ctx.phone, "You don't have any products yet. Type *menu* to go back."); return; }
        await sendList(ctx.phone, "🏷️ Your products — tap one to update it:", "My products", [{
          rows: rows.map((p: Row) => ({ id: `prod:${p.id}`, title: String(p.name), description: `${zar(p.price)} · stock ${p.stock} · ${statusLabel(p.status)}` })),
        }]);
      },
      handle: async input => {
        if (input.kind === "choice" && input.id.startsWith("prod:")) return { ok: true, set: { productId: input.id.slice(5) } };
        return { ok: false, retry: "Please pick a product from the list, or type *menu*.", reask: true };
      },
    },
    {
      id: "sp_item",
      ask: async ctx => {
        const sellerId = await mySellerId(ctx.userId);
        const { rows } = await pool!.query(`SELECT name, price, stock, status FROM mkt_products WHERE id::text = $1 AND seller_id = $2`, [ctx.data.productId, sellerId]);
        const p = rows[0];
        if (!p) { await sendText(ctx.phone, "That product isn't in your store. Type *menu* to go back."); return; }
        const toggle = p.status === "active" ? [{ id: "pause", title: "⏸️ Pause" }] : p.status === "inactive" ? [{ id: "activate", title: "▶️ Make live" }] : [];
        await sendButtons(ctx.phone,
          `*${p.name}*\nPrice: ${zar(p.price)} (price changes: ask the Ballylife team)\nStock: *${p.stock}*\nStatus: ${statusLabel(p.status)}`,
          [{ id: "stock", title: "📦 Update stock" }, ...toggle, { id: "list", title: "⬅️ My products" }]);
      },
      handle: async (input, ctx) => {
        if (input.kind !== "choice") return { ok: false, retry: "Please tap one of the buttons.", reask: true };
        if (input.id === "stock") return { ok: true, next: "sp_stock" };
        if (input.id === "list") return { ok: true, next: "sp_list" };
        if (input.id === "pause" || input.id === "activate") {
          const sellerId = await mySellerId(ctx.userId);
          const [from, to] = input.id === "pause" ? ["active", "inactive"] : ["inactive", "active"];
          const r = await pool!.query(`UPDATE mkt_products SET status = $1, updated_at = now() WHERE id::text = $2 AND seller_id = $3 AND status = $4`, [to, ctx.data.productId, sellerId, from]);
          await sendText(ctx.phone, r.rowCount ? (to === "active" ? "▶️ It's live again." : "⏸️ Paused — customers won't see it until you make it live again.") : "That couldn't be changed right now.");
          return { ok: true, next: "sp_item" };
        }
        return { ok: false, retry: "Please tap one of the buttons.", reask: true };
      },
    },
    {
      id: "sp_stock",
      ask: async ctx => { await sendText(ctx.phone, "How many do you have in stock now? Send a number, e.g. *25*."); },
      handle: async (input, ctx) => {
        const n = input.kind === "text" && /^\d{1,6}$/.test(input.text.trim()) ? Number(input.text.trim()) : NaN;
        if (!Number.isFinite(n) || n > 100000) return { ok: false, retry: "Please send a whole number, e.g. *25* (0 if sold out)." };
        const sellerId = await mySellerId(ctx.userId);
        const r = await pool!.query(`UPDATE mkt_products SET stock = $1, updated_at = now() WHERE id::text = $2 AND seller_id = $3`, [n, ctx.data.productId, sellerId]);
        await sendText(ctx.phone, r.rowCount ? `✅ Stock updated to *${n}*.` : "That product isn't in your store.");
        return { ok: true, next: "sp_item" };
      },
    },
  ],
  async finish() { /* navigation flow */ },
};

export const addProductFlow: Flow = {
  id: "add_product",
  confirmStep: "ap_confirm",
  steps: [
    {
      id: "ap_name", label: "Name",
      ask: async ctx => { await sendText(ctx.phone, "➕ Let's add a product. It goes to the Ballylife team for approval before it's live.\n\nWhat's the *product name*? (e.g. *Handmade beaded necklace*)"); },
      handle: async input => {
        const name = input.kind === "text" ? input.text.replace(/\s+/g, " ").trim() : "";
        return name.length >= 3 && name.length <= 80 ? { ok: true, set: { name } } : { ok: false, retry: "Please send a name of 3–80 characters." };
      },
    },
    {
      id: "ap_category", label: "Category",
      ask: async ctx => {
        const cats = await topCategories();
        await sendList(ctx.phone, "Which *category*?", "Choose category", [{ rows: cats.map(c => ({ id: `cat:${c.id}`, title: c.name })) }]);
      },
      handle: async input => {
        if (input.kind === "choice" && input.id.startsWith("cat:")) return { ok: true, set: { categoryId: input.id.slice(4), categoryName: input.title } };
        return { ok: false, retry: "Please choose a category from the list.", reask: true };
      },
    },
    {
      id: "ap_price", label: "Price",
      ask: async ctx => { await sendText(ctx.phone, "Your *selling price* in rand, including delivery? (e.g. *249.99*)"); },
      handle: async input => {
        const n = input.kind === "text" ? Number(input.text.replace(/[rR\s,]/g, "")) : NaN;
        return Number.isFinite(n) && n >= 1 && n <= 100000 ? { ok: true, set: { price: Math.round(n * 100) / 100 } } : { ok: false, retry: "Please send a price between R1 and R100 000, e.g. *249.99*." };
      },
    },
    {
      id: "ap_stock", label: "Stock",
      ask: async ctx => { await sendText(ctx.phone, "How many do you have in *stock*?"); },
      handle: async input => {
        const t = input.kind === "text" ? input.text.trim() : "";
        return /^\d{1,6}$/.test(t) && Number(t) <= 100000 ? { ok: true, set: { stock: Number(t) } } : { ok: false, retry: "Please send a whole number, e.g. *10*." };
      },
    },
    {
      id: "ap_description", label: "Description",
      ask: async ctx => { await sendText(ctx.phone, "Describe it in a few sentences — size, material, what's in the box. (Type *skip* to leave it out.)"); },
      handle: async input => {
        if (input.kind !== "text") return { ok: false, retry: "Please type a description, or *skip*." };
        const t = input.text.trim();
        if (/^skip$/i.test(t)) return { ok: true, set: { description: "" } };
        return t.length >= 10 && t.length <= 1500 ? { ok: true, set: { description: t } } : { ok: false, retry: "Please write 10–1500 characters, or type *skip*." };
      },
    },
    {
      id: "ap_photos", label: "Photos", resetOnEdit: ["photoIds"],
      ask: async ctx => {
        const n = (ctx.data.photoIds ?? []).length;
        if (!n) await sendText(ctx.phone, `Now send up to ${MAX_PHOTOS} *photos* of the product (clear, on a plain background works best).`);
        else await sendButtons(ctx.phone, `📸 Photo ${n} of ${MAX_PHOTOS} added. Send another, or tap *Done*.`, [{ id: "done", title: "✅ Done" }]);
      },
      handle: async (input, ctx) => {
        const ids: string[] = ctx.data.photoIds ?? [];
        if (input.kind === "choice" && input.id === "done" && ids.length) return { ok: true };
        if (input.kind !== "media" || !input.mimeType.startsWith("image/")) return { ok: false, retry: "Please send a *photo* (not a document or text)." };
        if (!isDocumentStoreConfigured()) return { ok: false, retry: "Sorry, we can't accept photos right now. Please try again later." };
        const file = await downloadMedia(input.mediaId);
        if (file.size > MAX_DOCUMENT_BYTES) return { ok: false, retry: "That photo is over 10 MB — please send a smaller one." };
        const id = await putProductPhoto(file.bytes, file.mimeType);
        const next = [...ids, id];
        return next.length >= MAX_PHOTOS ? { ok: true, set: { photoIds: next } } : { ok: true, set: { photoIds: next }, next: "ap_photos" };
      },
    },
    {
      id: "ap_confirm",
      ask: async ctx => {
        const d = ctx.data;
        await sendButtons(ctx.phone,
          `Please check your product:\n\n🏷️ ${d.name}\n📂 ${d.categoryName}\n💰 ${zar(d.price)} (delivery included)\n📦 Stock: ${d.stock}\n📸 ${(d.photoIds ?? []).length} photo(s)\n📝 ${d.description ? String(d.description).slice(0, 200) : "No description"}`,
          [{ id: "submit", title: "📨 Submit" }, { id: "edit", title: "✏️ Edit" }, { id: "cancel", title: "❌ Cancel" }]);
      },
      handle: async input => {
        if (input.kind === "choice" && input.id === "submit") return { ok: true, finish: true };
        return { ok: false, retry: "Tap *Submit*, *Edit* or *Cancel*.", reask: true };
      },
    },
  ],
  async finish(ctx) {
    const sellerId = await mySellerId(ctx.userId);
    if (!sellerId) { await sendText(ctx.phone, "Only approved sellers can add products."); return; }
    if (cjOnlyCatalog()) { await sendText(ctx.phone, "Adding your own products is paused on Ballylife right now — we'll let you know when it opens again."); return; }
    const d = ctx.data;
    const { createSellerProduct } = await import("../../../routes/marketplaceRouter");
    const product = await createSellerProduct(sellerId, {
      categoryId: d.categoryId, name: d.name, price: d.price, stock: d.stock,
      description: d.description ?? "", shortDescription: String(d.description ?? "").slice(0, 160),
      images: (d.photoIds ?? []).map((id: string) => `${API()}/api/whatsapp/photos/${id}`),
    });
    logger.info("whatsapp.product_submitted", { sellerId, productId: product.id });
    await sendText(ctx.phone, `📨 *${d.name}* has been submitted! The Ballylife team reviews new products within 1–2 business days — you'll see it in *My products* as "waiting for approval" until then.`);
  },
};
