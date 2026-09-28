/**
 * Handing a WhatsApp chat to a person.
 *
 * While a chat is handed off the bot stays quiet: the customer's messages
 * only land in the dashboard's WhatsApp Inbox, where staff read and reply.
 * Staff are alerted by email (ADMIN_ALERT_EMAIL) and on WhatsApp
 * (WHATSAPP_STAFF_NUMBER, via the staff_handoff_alert template). The
 * customer can type "menu" to go back to the bot; staff can hand the chat
 * back with "Resolve". Chats nobody touched for 48 hours go back to the bot
 * automatically (housekeeping).
 */
import { pool } from "../../db/pool";
import { logger } from "../../utils/logger";
import { sendText } from "./client";
import { getContact, updateContact } from "./store";
import { templateOrText } from "./notifications";
import { sendEmail } from "../emailService";

const SITE = () => (process.env.MARKETPLACE_PUBLIC_URL || "https://www.ballylife.com").replace(/\/$/, "");
const STAFF_NUMBER = () => (process.env.WHATSAPP_STAFF_NUMBER ?? "").replace(/\D/g, "");

/** Hands the chat to a person and tells everyone who needs to know. */
export async function startHandoff(phone: string, reason: string, opts: { profileName?: string | null; silent?: boolean } = {}): Promise<void> {
  const contact = await getContact(phone);
  if (contact?.handoff) return; // already with a person
  const why = reason.trim().slice(0, 500) || "Asked to speak to a person";
  await updateContact(phone, { handoff: true, handoff_at: new Date().toISOString(), handoff_reason: why });
  logger.info("whatsapp.handoff_started", { phoneTail: phone.slice(-4) });

  if (!opts.silent) {
    await sendText(phone,
      "👩‍💼 I've passed this chat to the Ballylife team — a person will reply right here (Mon–Fri 8:00–17:00, usually within a few hours).\n\nType *menu* any time to go back to the automatic assistant.");
  }
  const name = opts.profileName ?? contact?.profile_name ?? "A customer";
  const admin = process.env.ADMIN_ALERT_EMAIL?.trim();
  if (admin) {
    await sendEmail({
      to: admin,
      subject: `WhatsApp: ${name} wants to talk to a person`,
      html: `<p><strong>${escapeHtml(name)}</strong> (+${phone}) asked for a person:</p><blockquote>${escapeHtml(why)}</blockquote>` +
        `<p>Reply in the Manager dashboard → <strong>WhatsApp Inbox</strong>: ${SITE()}/admin</p>`,
    }).catch(err => logger.warn("whatsapp.handoff_email_failed", { error: String(err) }));
  }
  const staff = STAFF_NUMBER();
  if (staff && staff !== phone) {
    await templateOrText(staff, "staff_handoff_alert", [name, `+${phone}`, why.slice(0, 200)],
      `🔔 ${name} (+${phone}) wants to talk to a person:\n"${why.slice(0, 300)}"\n\nReply in the dashboard → WhatsApp Inbox.`)
      .catch(err => logger.warn("whatsapp.handoff_staff_alert_failed", { error: String(err) }));
  }
}

/** Gives the chat back to the bot. */
export async function endHandoff(phone: string, by: "customer" | "staff" | "timeout"): Promise<void> {
  await updateContact(phone, { handoff: false, handoff_reason: null });
  logger.info("whatsapp.handoff_ended", { phoneTail: phone.slice(-4), by });
  if (by === "staff") {
    await sendText(phone, "✅ Our team has marked your question as sorted. If you need anything else, just type *menu*.").catch(() => undefined);
  }
}

/**
 * A staff reply from the inbox. WhatsApp only allows free-form messages
 * within 24 hours of the customer's last message.
 */
export async function sendStaffReply(phone: string, text: string, staffName: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const contact = await getContact(phone);
  if (!contact) return { ok: false, error: "Unknown conversation." };
  if (contact.opted_out) return { ok: false, error: "This customer opted out (STOP) — they can't be messaged." };
  const last = contact.last_inbound_at ? new Date(contact.last_inbound_at).getTime() : 0;
  if (Date.now() - last > 24 * 3600_000) {
    return { ok: false, error: "More than 24 hours since the customer's last message — WhatsApp only allows approved templates now. Ask them to message us again, or contact them by email/phone." };
  }
  try {
    await sendText(phone, text.slice(0, 4000), { sentBy: staffName.slice(0, 60) || "staff" });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "WhatsApp didn't accept the message." };
  }
  // A person replying means the chat is with a person.
  if (!contact.handoff) await updateContact(phone, { handoff: true, handoff_at: new Date().toISOString(), handoff_reason: "Staff joined the chat" });
  await updateContact(phone, { staff_seen_at: new Date().toISOString() });
  return { ok: true };
}

/** Chats left with a person for 48 hours without anyone replying go back to the bot. */
export async function releaseStaleHandoffs(): Promise<number> {
  const { rows } = await pool!.query(
    `SELECT phone FROM wa_contacts WHERE handoff = true AND handoff_at < now() - interval '48 hours'
       AND phone NOT IN (SELECT phone FROM wa_messages WHERE direction = 'out' AND sent_by NOT IN ('bot', 'ai') AND created_at > now() - interval '48 hours')`);
  for (const r of rows) await endHandoff(String(r.phone), "timeout");
  return rows.length;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
