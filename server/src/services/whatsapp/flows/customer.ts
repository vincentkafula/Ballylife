/**
 * Customer registration on WhatsApp: name, email, delivery address,
 * consent, review. The phone number comes from WhatsApp itself.
 *
 * If the email already has a Ballylife account we never create a second
 * one: we email that address a link, and clicking it connects this
 * WhatsApp number to the existing account.
 */
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { pool } from "../../../db/pool";
import { logger } from "../../../utils/logger";
import { sendText, sendButtons } from "../client";
import { updateContact } from "../store";
import * as v from "../validate";
import { createMagicToken, magicLoginUrl, linkConfirmUrl, MAGIC_LINK_MINUTES } from "../../magicLink";
import { sendEmail } from "../../emailService";
import { computeAccountStatus, sendEmailVerification } from "../../accountVerification";
import { CONSENT_VERSION, type Flow } from "../types";
import { newAccountPassword, sendLoginDetails } from "../loginDetails";

const SITE = () => (process.env.MARKETPLACE_PUBLIC_URL || "https://www.ballylife.com").replace(/\/$/, "");
export const consentText = () =>
  `Before we create your account:\n\n` +
  `• We use your name, email, phone and address only to run your orders and support you (POPIA).\n` +
  `• You can type *STOP* any time to stop messages.\n` +
  `• Terms: ${SITE()}/terms\n• Privacy: ${SITE()}/privacy-policy\n\nDo you agree?`;

export async function uniqueUsername(email: string): Promise<string> {
  const base = email.split("@")[0].toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 24) || "customer";
  const { rows } = await pool!.query(`SELECT 1 FROM users WHERE username = $1`, [base]);
  return rows.length ? `${base}-${crypto.randomBytes(3).toString("hex")}` : base;
}

/** Sends a fresh one-time sign-in link over WhatsApp. */
export async function sendSignInLink(phone: string, userId: string, intro: string): Promise<void> {
  const token = await createMagicToken(userId, "login", phone);
  await sendText(phone, `${intro}\n\n🔐 Tap to sign in (works once, for ${MAGIC_LINK_MINUTES} minutes):\n${magicLoginUrl(token)}`,
    { previewUrl: false, logAs: `${intro}\n\n🔐 [sign-in link]` });
}

export const customerFlow: Flow = {
  id: "customer",
  confirmStep: "c_confirm",
  steps: [
    {
      id: "c_name", label: "Name",
      ask: async ctx => { await sendText(ctx.phone, "Great! Let's set up your Ballylife account — it takes 1 minute.\n\nWhat's your *full name*?"); },
      handle: async input => {
        const name = input.kind === "text" ? v.personName(input.text) : null;
        return name ? { ok: true, set: { name } } : { ok: false, retry: "Please send your first and last name, e.g. *Thandi Mokoena*." };
      },
    },
    {
      id: "c_email", label: "Email",
      ask: async ctx => { await sendText(ctx.phone, `Thanks, ${String(ctx.data.name).split(" ")[0]}. What's your *email address*? We'll send order receipts there.`); },
      handle: async input => {
        const email = input.kind === "text" ? v.email(input.text) : null;
        return email ? { ok: true, set: { email } } : { ok: false, retry: "That doesn't look like an email address. Please try again, e.g. *thandi@gmail.com*." };
      },
    },
    {
      id: "c_address", label: "Delivery address",
      ask: async ctx => { await sendText(ctx.phone, "What's your *delivery address*? Include street, suburb, city and postal code.\n\nYou can also send a 📍 location pin."); },
      handle: async input => {
        if (input.kind === "location") {
          const full = [input.name, input.address].filter(Boolean).join(", ") || `Pin ${input.lat.toFixed(5)}, ${input.lng.toFixed(5)}`;
          const parsed = v.address(full);
          return { ok: true, set: { address: parsed ?? { line1: full, city: "", postalCode: "", full }, location: { lat: input.lat, lng: input.lng } } };
        }
        const address = input.kind === "text" ? v.address(input.text) : null;
        return address ? { ok: true, set: { address } } : { ok: false, retry: "Please include your street, suburb, city and a 4-digit postal code, e.g. *12 Main Rd, Rondebosch, Cape Town, 7700*." };
      },
    },
    {
      id: "c_consent",
      ask: async ctx => { await sendButtons(ctx.phone, consentText(), [{ id: "agree", title: "✅ I agree" }, { id: "decline", title: "❌ No thanks" }]); },
      handle: async input => {
        if (input.kind === "choice" && input.id === "agree") return { ok: true, set: { consentAt: new Date().toISOString() } };
        if (input.kind === "choice" && input.id === "decline") return { ok: true, cancel: "No problem — we haven't created an account or kept your answers. Type *menu* any time." };
        return { ok: false, retry: "Please tap *I agree* or *No thanks*.", reask: true };
      },
    },
    {
      id: "c_confirm",
      ask: async ctx => {
        const d = ctx.data;
        await sendButtons(ctx.phone,
          `Please check your details:\n\n👤 ${d.name}\n📧 ${d.email}\n🏠 ${d.address?.full}\n📱 ${v.maskPhone(ctx.phone)} (this WhatsApp)`,
          [{ id: "create", title: "✅ Create account" }, { id: "edit", title: "✏️ Edit" }, { id: "cancel", title: "❌ Cancel" }]);
      },
      handle: async input => {
        if (input.kind === "choice" && input.id === "create") return { ok: true, finish: true };
        return { ok: false, retry: "Tap *Create account*, *Edit* or *Cancel*.", reask: true };
      },
    },
  ],

  async finish(ctx) {
    const d = ctx.data;
    const { rows: existing } = await pool!.query(`SELECT id, account_status FROM users WHERE LOWER(email) = $1 LIMIT 1`, [d.email]);
    if (existing[0]) {
      // Prove ownership of the email before linking this number to that account.
      if (existing[0].account_status !== "removed") {
        const token = await createMagicToken(existing[0].id, "link_whatsapp", ctx.phone, 60);
        await sendEmail({
          to: d.email,
          subject: "Connect WhatsApp to your Ballylife account",
          html: `<p>Someone asked to connect the WhatsApp number ending in ${ctx.phone.slice(-4)} to your Ballylife account.</p>` +
            `<p><a href="${linkConfirmUrl(token)}">Click here to connect it</a> — this link expires in 1 hour.</p>` +
            `<p>If this wasn't you, ignore this email and nothing will change.</p>`,
        });
      }
      await sendText(ctx.phone, `That email already has a Ballylife account. We've emailed *${d.email}* a link — tap it to connect this WhatsApp number to that account (it expires in 1 hour).`);
      return;
    }

    const client = await pool!.connect();
    let userId: string, password: string, passwordHash: string;
    try {
      await client.query("BEGIN");
      const username = await uniqueUsername(d.email);
      // A temporary password, sent on WhatsApp below; the website makes them choose their own at first sign-in.
      ({ password, passwordHash } = await newAccountPassword());
      const status = computeAccountStatus(false, true, true); // the WhatsApp number is proven; the email isn't yet
      const { rows } = await client.query(
        `INSERT INTO users (username, password_hash, role, name, email, phone, email_verified, phone_verified, account_status, must_change_password)
         VALUES ($1, $2, 'customer', $3, $4, $5, false, true, $6, true) RETURNING id`,
        [username, passwordHash, d.name, d.email, `+${ctx.phone}`, status]);
      userId = rows[0].id;
      const [first, ...rest] = String(d.name).split(" ");
      await client.query(
        `INSERT INTO mkt_addresses (user_id, label, first_name, last_name, line1, city, postal_code, country, phone, is_default)
         VALUES ($1, 'Home', $2, $3, $4, $5, $6, 'ZA', $7, true)`,
        [userId, first, rest.join(" "), d.address?.full ?? "", d.address?.city ?? "", d.address?.postalCode ?? "", `+${ctx.phone}`]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
    await updateContact(ctx.phone, { user_id: userId, consent_at: d.consentAt ?? new Date().toISOString(), consent_version: CONSENT_VERSION });
    await sendEmailVerification(userId, d.email).catch(err => logger.warn("whatsapp.verify_email_failed", { error: String(err) }));
    logger.info("whatsapp.customer_registered", { userId });
    await sendLoginDetails(ctx.phone, userId, `🎉 Your Ballylife account is ready, ${String(d.name).split(" ")[0]}!\nWe've emailed you a link to confirm your email address. Confirm it, then sign in on any computer with the details below.`, password);
  },
};
