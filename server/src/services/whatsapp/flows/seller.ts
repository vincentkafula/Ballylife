/**
 * Seller application on WhatsApp. Creates the same records as the
 * website's seller sign-up (a "seller" user plus an mkt_sellers row with
 * status pending_kyc), so the application shows up in the existing admin
 * Seller Approval screen.
 *
 * Bank account holder/number and the ID number are encrypted the moment
 * they arrive and are never written to the message log. Documents are
 * downloaded from WhatsApp, encrypted, and stored in the private bucket.
 */
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { pool } from "../../../db/pool";
import { logger } from "../../../utils/logger";
import { sendText, sendButtons, sendList, downloadMedia } from "../client";
import { updateContact } from "../store";
import * as v from "../validate";
import { encryptText, maskTail } from "../../../utils/secureData";
import { putDocument, deleteDocument, isDocumentStoreConfigured, ALLOWED_DOCUMENT_TYPES, MAX_DOCUMENT_BYTES } from "../../documentStore";
import { computeAccountStatus, sendEmailVerification } from "../../accountVerification";
import { sendEmail } from "../../emailService";
import { uniqueUsername } from "./customer";
import { CONSENT_VERSION, type Flow, type Input, type Ctx, type StepResult } from "../types";

const SITE = () => (process.env.MARKETPLACE_PUBLIC_URL || "https://www.ballylife.com").replace(/\/$/, "");
const BUSINESS_TYPES = [
  { id: "individual", title: "Individual / sole trader", description: "Selling in your own name" },
  { id: "company", title: "Registered company", description: "(Pty) Ltd with a CIPC number" },
  { id: "other", title: "Partnership / other", description: "Partnership, trust, NPO…" },
];
const MAX_CATEGORIES = 3;

export async function topCategories(): Promise<{ id: string; name: string }[]> {
  const { rows } = await pool!.query(
    `SELECT c.id, c.name, COUNT(p.id)::int AS n FROM mkt_categories c
       LEFT JOIN mkt_products p ON p.category_id = c.id AND p.status = 'active'
      WHERE c.parent_id IS NULL GROUP BY c.id, c.name ORDER BY n DESC, c.name LIMIT 9`);
  return rows.map((r: any) => ({ id: String(r.id), name: String(r.name) }));
}

/** Handles a document step: downloads, checks and stores the file. */
async function takeDocument(input: Input, ctx: Ctx, kind: "id_document" | "proof_of_address"): Promise<StepResult> {
  if (input.kind !== "media") return { ok: false, retry: "Please send a *photo* or *PDF* of the document (tap 📎 then Camera, Gallery or Document)." };
  if (!ALLOWED_DOCUMENT_TYPES.includes(input.mimeType)) return { ok: false, retry: "That file type isn't supported — please send a photo (JPG/PNG) or a PDF." };
  if (!isDocumentStoreConfigured()) return { ok: false, retry: "Sorry, we can't accept documents right now. Please try again later." };
  const file = await downloadMedia(input.mediaId);
  if (file.size > MAX_DOCUMENT_BYTES) return { ok: false, retry: "That file is larger than 10 MB — please send a smaller photo or PDF." };
  const key = await putDocument(`seller-applications/${ctx.phone}`, file.bytes, file.mimeType);
  const previous = ctx.data.docs?.[kind];
  if (previous?.key) void deleteDocument(previous.key).catch(() => undefined); // replaced via "edit"
  return { ok: true, set: { docs: { ...(ctx.data.docs ?? {}), [kind]: { key, mimeType: file.mimeType, size: file.size } } } };
}

export const sellerFlow: Flow = {
  id: "seller",
  confirmStep: "s_confirm",
  steps: [
    {
      id: "s_name", label: "Your name",
      ask: async ctx => {
        await sendText(ctx.phone, "Let's get your shop on Ballylife! 🏪\n\nYou'll need your *ID or company registration* and a *proof of address* (photo or PDF). Type *cancel* any time.\n\nWhat's your *full name*?");
      },
      handle: async input => {
        const name = input.kind === "text" ? v.personName(input.text) : null;
        return name ? { ok: true, set: { name } } : { ok: false, retry: "Please send your first and last name, e.g. *Sipho Dlamini*." };
      },
    },
    {
      id: "s_email", label: "Email",
      ask: async ctx => { await sendText(ctx.phone, "Your *email address*? We'll send your application updates and sales reports there."); },
      handle: async input => {
        const email = input.kind === "text" ? v.email(input.text) : null;
        if (!email) return { ok: false, retry: "That doesn't look like an email address. Please try again." };
        const { rows } = await pool!.query(`SELECT 1 FROM users WHERE LOWER(email) = $1`, [email]);
        if (rows.length) return { ok: false, retry: `That email already has a Ballylife account. Please use a different email, or apply from your account at ${SITE()}.` };
        return { ok: true, set: { email } };
      },
    },
    {
      id: "s_business", label: "Business name",
      ask: async ctx => { await sendText(ctx.phone, "What's your *business / shop name*? This is what customers will see."); },
      handle: async input => {
        const businessName = input.kind === "text" ? v.businessName(input.text) : null;
        return businessName ? { ok: true, set: { businessName } } : { ok: false, retry: "Please send a shop name of 2–60 characters." };
      },
    },
    {
      id: "s_type", label: "Business type & ID number",
      ask: async ctx => { await sendList(ctx.phone, "What *type of business* is it?", "Choose type", [{ rows: BUSINESS_TYPES }]); },
      handle: async input => {
        const t = input.kind === "choice" ? BUSINESS_TYPES.find(b => b.id === input.id) : null;
        return t ? { ok: true, set: { businessType: t.id, businessTypeLabel: t.title } } : { ok: false, retry: "Please choose an option from the list.", reask: true };
      },
    },
    {
      id: "s_idnum", sensitive: true, continues: true,
      ask: async ctx => {
        await sendText(ctx.phone, ctx.data.businessType === "company"
          ? "Your *CIPC company registration number*? (e.g. 2021/123456/07)"
          : "Your *South African ID number* (13 digits)?\n🔒 It's encrypted and only used to verify you.");
      },
      handle: async (input, ctx) => {
        if (input.kind !== "text") return { ok: false, retry: "Please type the number." };
        const value = ctx.data.businessType === "company" ? v.cipcNumber(input.text) : v.saIdNumber(input.text);
        if (!value) return { ok: false, retry: ctx.data.businessType === "company" ? "That doesn't look like a CIPC number — the format is *YYYY/NNNNNN/NN*." : "That ID number isn't valid — please check the 13 digits." };
        return { ok: true, set: { idNumberEnc: encryptText(value), idNumberMask: maskTail(value, 3) } };
      },
    },
    {
      id: "s_categories", label: "Product categories", resetOnEdit: ["categoryIds", "categoryNames"],
      ask: async ctx => {
        const chosen: string[] = ctx.data.categoryIds ?? [];
        const cats = (await topCategories()).filter(c => !chosen.includes(c.id));
        const rows = [...(chosen.length ? [{ id: "done", title: "✅ Done", description: `Chosen: ${(ctx.data.categoryNames ?? []).join(", ")}` }] : []), ...cats.map(c => ({ id: `cat:${c.id}`, title: c.name }))];
        await sendList(ctx.phone, chosen.length ? `Added! Pick another category (up to ${MAX_CATEGORIES}), or tap *Done*.` : `Which *product categories* will you sell? Pick one now — you can add up to ${MAX_CATEGORIES}.`, "Choose category", [{ rows }]);
      },
      handle: async (input, ctx) => {
        if (input.kind !== "choice") return { ok: false, retry: "Please choose from the list.", reask: true };
        const ids: string[] = ctx.data.categoryIds ?? [];
        const names: string[] = ctx.data.categoryNames ?? [];
        if (input.id === "done" && ids.length) return { ok: true };
        if (!input.id.startsWith("cat:")) return { ok: false, retry: "Please choose from the list.", reask: true };
        const next = { categoryIds: [...ids, input.id.slice(4)], categoryNames: [...names, input.title] };
        // Stay on this step until they tap Done or reach the maximum.
        return next.categoryIds.length >= MAX_CATEGORIES ? { ok: true, set: next } : { ok: true, set: next, next: "s_categories" };
      },
    },
    {
      id: "s_bank", label: "Bank details", sensitive: true,
      ask: async ctx => {
        await sendText(ctx.phone, "Next, your *payout bank details* — this is where we pay your earnings.\n🔒 They're encrypted and only used to pay you. Tip: after sending, you can long-press your messages and delete them from this chat.");
        await sendList(ctx.phone, "Which *bank*?", "Choose bank", [{ rows: v.BANKS.map(b => ({ id: `bank:${b.id}`, title: b.name })) }]);
      },
      handle: async input => {
        const bank = input.kind === "choice" ? v.BANKS.find(b => `bank:${b.id}` === input.id) : null;
        return bank ? { ok: true, set: { bank: { id: bank.id, name: bank.name, defaultBranch: bank.branch } } } : { ok: false, retry: "Please choose your bank from the list.", reask: true };
      },
    },
    {
      id: "s_bank_other", sensitive: true, continues: true,
      skip: d => d.bank?.id !== "other",
      ask: async ctx => { await sendText(ctx.phone, "What's the *name of your bank*?"); },
      handle: async (input, ctx) => {
        const name = input.kind === "text" ? v.businessName(input.text) : null;
        return name ? { ok: true, set: { bank: { ...ctx.data.bank, name } } } : { ok: false, retry: "Please type your bank's name." };
      },
    },
    {
      id: "s_holder", sensitive: true, continues: true,
      ask: async ctx => { await sendText(ctx.phone, "*Account holder name* (exactly as the bank has it)?"); },
      handle: async input => {
        const holder = input.kind === "text" ? v.businessName(input.text) : null;
        return holder ? { ok: true, set: { holderEnc: encryptText(holder) } } : { ok: false, retry: "Please type the account holder's name." };
      },
    },
    {
      id: "s_account", sensitive: true, continues: true,
      ask: async ctx => { await sendText(ctx.phone, "*Account number*? (digits only)"); },
      handle: async input => {
        const acc = input.kind === "text" ? v.accountNumber(input.text) : null;
        return acc ? { ok: true, set: { accountEnc: encryptText(acc), accountMask: maskTail(acc) } } : { ok: false, retry: "That doesn't look like an account number — please send 6 to 13 digits." };
      },
    },
    {
      id: "s_branch", sensitive: true, continues: true,
      ask: async ctx => {
        const def = ctx.data.bank?.defaultBranch;
        if (def) await sendButtons(ctx.phone, `*Branch code*? ${ctx.data.bank.name}'s universal code is *${def}*.`, [{ id: "use", title: `✅ Use ${def}` }, { id: "other", title: "✏️ Different" }]);
        else await sendText(ctx.phone, "*Branch code*? (6 digits)");
      },
      handle: async (input, ctx) => {
        if (input.kind === "choice" && input.id === "use" && ctx.data.bank?.defaultBranch) return { ok: true, set: { branch: ctx.data.bank.defaultBranch } };
        if (input.kind === "choice" && input.id === "other") return { ok: false, retry: "Please type the 6-digit branch code." };
        const branch = input.kind === "text" ? v.branchCode(input.text) : null;
        return branch ? { ok: true, set: { branch } } : { ok: false, retry: "A branch code has 6 digits — please try again." };
      },
    },
    {
      id: "s_acctype", sensitive: true, continues: true,
      ask: async ctx => { await sendButtons(ctx.phone, "*Account type*?", [{ id: "cheque", title: "Cheque / Current" }, { id: "savings", title: "Savings" }]); },
      handle: async input => {
        if (input.kind === "choice" && (input.id === "cheque" || input.id === "savings")) return { ok: true, set: { accountType: input.id } };
        return { ok: false, retry: "Please tap *Cheque / Current* or *Savings*.", reask: true };
      },
    },
    {
      id: "s_doc_id", label: "ID / registration document",
      ask: async ctx => {
        await sendText(ctx.phone, ctx.data.businessType === "company"
          ? "Please send a *photo or PDF of your company registration certificate* (CIPC)."
          : "Please send a *photo or PDF of your ID* (green ID book or smart ID card, both sides).");
      },
      handle: (input, ctx) => takeDocument(input, ctx, "id_document"),
    },
    {
      id: "s_doc_address", label: "Proof of address",
      ask: async ctx => { await sendText(ctx.phone, "Now your *proof of address* — a utility bill, bank statement or lease, not older than 3 months (photo or PDF)."); },
      handle: (input, ctx) => takeDocument(input, ctx, "proof_of_address"),
    },
    {
      id: "s_consent",
      ask: async ctx => {
        await sendButtons(ctx.phone,
          `Almost done! Please confirm:\n\n• The information and documents are true and belong to you or your business.\n` +
          `• Ballylife may use them to verify you and to pay you (POPIA). We keep them encrypted.\n` +
          `• Seller terms: ${SITE()}/business-terms\n• Privacy: ${SITE()}/privacy-policy`,
          [{ id: "agree", title: "✅ I agree" }, { id: "decline", title: "❌ No" }]);
      },
      handle: async input => {
        if (input.kind === "choice" && input.id === "agree") return { ok: true, set: { consentAt: new Date().toISOString() } };
        if (input.kind === "choice" && input.id === "decline") return { ok: true, cancel: "Understood — we've discarded your application and documents. Type *menu* any time." };
        return { ok: false, retry: "Please tap *I agree* or *No*.", reask: true };
      },
    },
    {
      id: "s_confirm",
      ask: async ctx => {
        const d = ctx.data;
        await sendButtons(ctx.phone,
          `Please check your application:\n\n👤 ${d.name}\n📧 ${d.email}\n🏪 ${d.businessName} (${d.businessTypeLabel})\n🪪 ${d.idNumberMask}\n` +
          `🏷️ ${(d.categoryNames ?? []).join(", ")}\n🏦 ${d.bank?.name} ${d.accountMask} (${d.accountType === "savings" ? "Savings" : "Cheque"}, branch ${d.branch})\n` +
          `📎 ID document ✓ · Proof of address ✓`,
          [{ id: "submit", title: "📨 Submit" }, { id: "edit", title: "✏️ Edit" }, { id: "cancel", title: "❌ Cancel" }]);
      },
      handle: async input => {
        if (input.kind === "choice" && input.id === "submit") return { ok: true, finish: true };
        return { ok: false, retry: "Tap *Submit*, *Edit* or *Cancel*.", reask: true };
      },
    },
  ],

  async finish(ctx) {
    const d = ctx.data;
    const client = await pool!.connect();
    let userId: string, sellerId: string;
    try {
      await client.query("BEGIN");
      const username = await uniqueUsername(d.email);
      const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10);
      const status = computeAccountStatus(false, true, true);
      const { rows } = await client.query(
        `INSERT INTO users (username, password_hash, role, name, email, phone, email_verified, phone_verified, account_status)
         VALUES ($1, $2, 'seller', $3, $4, $5, false, true, $6) RETURNING id`,
        [username, passwordHash, d.name, d.email, `+${ctx.phone}`, status]);
      userId = rows[0].id;
      sellerId = `sel-${userId.slice(0, 8)}`;
      let slug = String(d.businessName).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "shop";
      if ((await client.query(`SELECT 1 FROM mkt_sellers WHERE store_slug = $1`, [slug])).rows.length) slug = `${slug}-${crypto.randomBytes(2).toString("hex")}`;
      const applicationData = {
        source: "whatsapp", whatsappPhone: ctx.phone, submittedAt: new Date().toISOString(), consentAt: d.consentAt, consentVersion: CONSENT_VERSION,
        businessType: d.businessType, idNumberEnc: d.idNumberEnc, idNumberMask: d.idNumberMask,
        categoryIds: d.categoryIds ?? [], categoryNames: d.categoryNames ?? [],
        bank: { name: d.bank?.name, branch: d.branch, accountType: d.accountType, holderEnc: d.holderEnc, accountEnc: d.accountEnc, accountMask: d.accountMask },
      };
      await client.query(
        `INSERT INTO mkt_sellers (id, user_id, store_name, store_slug, description, email, phone, status, kyc_verified, tax_id, application_data)
         VALUES ($1, $2, $3, $4, '', $5, $6, 'pending_kyc', false, NULL, $7)`,
        [sellerId, userId, d.businessName, slug, d.email, `+${ctx.phone}`, JSON.stringify(applicationData)]);
      for (const [kind, doc] of Object.entries((d.docs ?? {}) as Record<string, { key: string; mimeType: string; size: number }>)) {
        await client.query(
          `INSERT INTO seller_documents (seller_id, phone, kind, object_key, mime_type, size_bytes) VALUES ($1, $2, $3, $4, $5, $6)`,
          [sellerId, ctx.phone, kind, doc.key, doc.mimeType, doc.size]);
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
    await updateContact(ctx.phone, { user_id: userId, consent_at: d.consentAt ?? new Date().toISOString(), consent_version: CONSENT_VERSION });
    await sendEmailVerification(userId, d.email).catch(err => logger.warn("whatsapp.verify_email_failed", { error: String(err) }));
    const admin = process.env.ADMIN_ALERT_EMAIL?.trim();
    if (admin) {
      await sendEmail({
        to: admin, subject: `New seller application (WhatsApp): ${d.businessName}`,
        html: `<p>${d.name} applied to sell as <strong>${d.businessName}</strong> (${d.businessTypeLabel}) via WhatsApp.</p><p>Categories: ${(d.categoryNames ?? []).join(", ")}</p><p>Review it in the Manager dashboard → Seller Approval (reference ${sellerId}).</p>`,
      }).catch(() => undefined);
    }
    logger.info("whatsapp.seller_applied", { sellerId });
    await sendText(ctx.phone, `✅ Application received! Your reference is *${sellerId.toUpperCase()}*.\n\nWe review applications within 1–2 business days and will message you here with the result. We've also emailed you a link to confirm your email address.`);
  },
};
