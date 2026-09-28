/**
 * "Just a question" / "Talk to a person". Phase 1 forwards the question to
 * the team by email (ADMIN_ALERT_EMAIL) and flags the chat for handoff;
 * Phase 3 adds AI answers and a dashboard inbox to reply from.
 */
import { sendText } from "../client";
import { updateContact } from "../store";
import { sendEmail } from "../../emailService";
import { logger } from "../../../utils/logger";
import type { Flow } from "../types";

export const questionFlow: Flow = {
  id: "question",
  steps: [
    {
      id: "q_text",
      ask: async ctx => { await sendText(ctx.phone, "Sure — type your question in one message and our team will get back to you."); },
      handle: async input => {
        if (input.kind !== "text" || input.text.trim().length < 3) return { ok: false, retry: "Please type your question as a message." };
        return { ok: true, set: { question: input.text.trim().slice(0, 1000) }, finish: true };
      },
    },
  ],
  async finish(ctx) {
    await updateContact(ctx.phone, { handoff: true, handoff_at: new Date().toISOString() });
    const admin = process.env.ADMIN_ALERT_EMAIL?.trim();
    if (admin) {
      await sendEmail({
        to: admin,
        subject: `WhatsApp question from ${ctx.profileName ?? "a customer"} (+${ctx.phone})`,
        html: `<p><strong>${ctx.profileName ?? "Customer"}</strong> (+${ctx.phone}${ctx.userId ? ", has an account" : ""}) asked:</p><blockquote>${String(ctx.data.question).replace(/</g, "&lt;")}</blockquote><p>Please reply by phone or email for now — the WhatsApp inbox arrives in Phase 3.</p>`,
      }).catch(err => logger.warn("whatsapp.question_email_failed", { error: String(err) }));
    }
    await sendText(ctx.phone, "Thanks! 🙏 We've passed your question to the Ballylife team. Someone will get back to you within 1 business day (Mon–Fri, 8:00–17:00).\n\nType *menu* for other options.");
  },
};
