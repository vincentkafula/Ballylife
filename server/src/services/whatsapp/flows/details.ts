/**
 * "My details": a customer with a linked account updates their delivery
 * address or email from WhatsApp. The WhatsApp number itself proves who
 * they are; a new email still has to be confirmed through the link we email.
 */
import { pool } from "../../../db/pool";
import { sendText, sendButtons } from "../client";
import * as v from "../validate";
import { sendEmailVerification } from "../../accountVerification";
import type { Flow } from "../types";

export const detailsFlow: Flow = {
  id: "details",
  steps: [
    {
      id: "d_pick",
      ask: async ctx => {
        const { rows: u } = await pool!.query(`SELECT email FROM users WHERE id = $1`, [ctx.userId]);
        const { rows: a } = await pool!.query(`SELECT line1 FROM mkt_addresses WHERE user_id = $1 ORDER BY is_default DESC LIMIT 1`, [ctx.userId]);
        await sendButtons(ctx.phone, `👤 *Your details*\n\n📧 ${u[0]?.email ?? "—"}\n🏠 ${a[0]?.line1 ?? "No delivery address yet"}\n\nWhat would you like to change?`,
          [{ id: "address", title: "🏠 Address" }, { id: "email", title: "📧 Email" }, { id: "done", title: "✅ Nothing" }]);
      },
      handle: async input => {
        if (input.kind === "choice" && input.id === "address") return { ok: true, next: "d_address" };
        if (input.kind === "choice" && input.id === "email") return { ok: true, next: "d_email" };
        if (input.kind === "choice" && input.id === "done") return { ok: true, done: true };
        return { ok: false, retry: "Please tap one of the buttons.", reask: true };
      },
    },
    {
      id: "d_address",
      ask: async ctx => { await sendText(ctx.phone, "Send your new *delivery address* (street, suburb, city, postal code) — or a 📍 location pin."); },
      handle: async (input, ctx) => {
        let a: { line1: string; city: string; postalCode: string; full: string } | null = null;
        if (input.kind === "location") {
          const full = [input.name, input.address].filter(Boolean).join(", ") || `Pin ${input.lat.toFixed(5)}, ${input.lng.toFixed(5)}`;
          a = v.address(full) ?? { line1: full, city: "", postalCode: "", full };
        } else if (input.kind === "text") a = v.address(input.text);
        if (!a) return { ok: false, retry: "Please include street, suburb, city and a 4-digit postal code." };
        const upd = await pool!.query(
          `UPDATE mkt_addresses SET line1 = $2, city = $3, postal_code = $4 WHERE user_id = $1 AND is_default = true`, [ctx.userId, a.full, a.city, a.postalCode]);
        if (!upd.rowCount) {
          const { rows } = await pool!.query(`SELECT name FROM users WHERE id = $1`, [ctx.userId]);
          const [first, ...rest] = String(rows[0]?.name ?? "").split(" ");
          await pool!.query(
            `INSERT INTO mkt_addresses (user_id, label, first_name, last_name, line1, city, postal_code, country, phone, is_default) VALUES ($1, 'Home', $2, $3, $4, $5, $6, 'ZA', $7, true)`,
            [ctx.userId, first, rest.join(" "), a.full, a.city, a.postalCode, `+${ctx.phone}`]);
        }
        await sendText(ctx.phone, `✅ Delivery address updated:\n${a.full}`);
        return { ok: true, done: true };
      },
    },
    {
      id: "d_email",
      ask: async ctx => { await sendText(ctx.phone, "What's your new *email address*?"); },
      handle: async (input, ctx) => {
        const email = input.kind === "text" ? v.email(input.text) : null;
        if (!email) return { ok: false, retry: "That doesn't look like an email address. Please try again." };
        const { rows } = await pool!.query(`SELECT id FROM users WHERE LOWER(email) = $1 AND id <> $2`, [email, ctx.userId]);
        if (rows.length) return { ok: false, retry: "That email is already used by another Ballylife account. Please use a different one." };
        await pool!.query(`UPDATE users SET email = $2, email_verified = false WHERE id = $1`, [ctx.userId, email]);
        await sendEmailVerification(ctx.userId!, email).catch(() => undefined);
        await sendText(ctx.phone, `✅ Email changed to *${email}*. We've sent a confirmation link there — please tap it.`);
        return { ok: true, done: true };
      },
    },
  ],
  async finish() { /* navigation flow */ },
};
