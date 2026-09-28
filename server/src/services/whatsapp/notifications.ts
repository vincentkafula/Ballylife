/**
 * Business-initiated WhatsApp messages (seller decisions for now).
 *
 * Within 24 hours of the person's last message a normal message is free
 * and needs no template. Outside that window WhatsApp only allows an
 * approved template, so we send the template -- and fall back to plain
 * text if the template isn't approved yet (that only works inside the window).
 */
import { pool } from "../../db/pool";
import { logger } from "../../utils/logger";
import { sendText, sendTemplate } from "./client";
import { getContact } from "./store";
import { createMagicToken, magicLoginUrl } from "../magicLink";

const APPROVAL_LINK_HOURS = 24;

async function withinWindow(phone: string): Promise<boolean> {
  const c = await getContact(phone);
  return Boolean(c?.last_inbound_at && Date.now() - new Date(c.last_inbound_at).getTime() < 23.5 * 3600_000);
}

export async function templateOrText(phone: string, template: string, params: string[], text: string, opts: { buttonParam?: string; logAs?: string } = {}): Promise<void> {
  if (await withinWindow(phone)) { await sendText(phone, text, { logAs: opts.logAs }); return; }
  try { await sendTemplate(phone, template, params, opts); }
  catch (err) {
    logger.warn("whatsapp.template_failed_fallback_text", { template, error: err instanceof Error ? err.message : String(err) });
    await sendText(phone, text, { logAs: opts.logAs });
  }
}

/** Tells a seller who applied on WhatsApp that they were approved or rejected. */
export async function notifySellerDecision(sellerId: string, decision: "approved" | "rejected", reason?: string): Promise<void> {
  const { rows } = await pool!.query(
    `SELECT s.store_name, s.user_id, s.application_data, u.name FROM mkt_sellers s LEFT JOIN users u ON u.id::text = s.user_id WHERE s.id = $1`, [sellerId]);
  const s = rows[0];
  if (!s) return;
  const app = typeof s.application_data === "string" ? JSON.parse(s.application_data) : (s.application_data ?? {});
  let phone: string | null = app.whatsappPhone ?? null;
  if (!phone && s.user_id) phone = (await pool!.query(`SELECT phone FROM wa_contacts WHERE user_id::text = $1 LIMIT 1`, [s.user_id])).rows[0]?.phone ?? null;
  if (!phone) return; // didn't use WhatsApp
  const contact = await getContact(phone);
  if (contact?.opted_out) return;
  const first = String(s.name ?? "there").split(" ")[0];

  if (decision === "approved") {
    const token = await createMagicToken(String(s.user_id), "login", phone, APPROVAL_LINK_HOURS * 60);
    await templateOrText(phone, "seller_application_approved", [first, s.store_name],
      `🎉 Good news, ${first}! Your Ballylife seller application for *${s.store_name}* has been approved.\n\nTap to sign in and set up your store (works once, for ${APPROVAL_LINK_HOURS} hours):\n${magicLoginUrl(token)}`,
      { buttonParam: token, logAs: `[approved: ${s.store_name}] [sign-in link]` });
  } else {
    const why = (reason?.trim() || "we couldn't verify the documents you sent").slice(0, 300);
    await templateOrText(phone, "seller_application_update", [first, s.store_name, why],
      `Hi ${first}, we've reviewed your Ballylife seller application for *${s.store_name}*. We can't approve it yet because: ${why}.\n\nReply to this message and we'll help you complete it.`);
  }
  logger.info("whatsapp.seller_decision_sent", { sellerId, decision });
}
