/**
 * WhatsApp endpoints.
 *
 *   GET  /api/whatsapp/webhook   Meta's one-time verification (hub.challenge)
 *   POST /api/whatsapp/webhook   incoming messages + delivery statuses,
 *                                accepted only with a valid X-Hub-Signature-256
 *   GET  /api/whatsapp/link      the emailed "connect WhatsApp to my account" link
 *
 * Admin (mounted under /api/marketplace):
 *   GET /admin/sellers/:id/application   WhatsApp application details (bank masked)
 *   GET /admin/seller-documents/:docId   a decrypted ID / proof-of-address file
 *
 * Railway variables: WHATSAPP_VERIFY_TOKEN (the phrase you type in Meta's
 * webhook settings), META_APP_SECRET (signs webhooks; WHATSAPP_APP_SECRET
 * overrides it if WhatsApp lives in a different app).
 */
import crypto from "crypto";
import { Router, Request, Response } from "express";
import { pool } from "../db/pool";
import { logger } from "../utils/logger";
import { requireAuth, requireRole } from "../middleware/auth";
import { handleIncoming } from "../services/whatsapp/engine";
import { recordInbound, recordStatus, updateContact } from "../services/whatsapp/store";
import { sendSignInLink } from "../services/whatsapp/flows/customer";
import { consumeMagicToken } from "../services/magicLink";
import { computeAccountStatus } from "../services/accountVerification";
import { getDocument, getProductPhoto } from "../services/documentStore";
import { startHandoff, endHandoff, sendStaffReply, releaseStaleHandoffs } from "../services/whatsapp/handoff";
import { estimateUsd, isAssistantConfigured } from "../services/whatsapp/assistant";
import { templateStatus, submitMissingTemplates, getBusinessProfile, updateBusinessProfile, DEFAULT_PROFILE } from "../services/whatsapp/setup";
import { subscriberCount, recentBroadcasts, startBroadcast } from "../services/whatsapp/deals";
import { downloadMedia } from "../services/whatsapp/client";
import type { Input } from "../services/whatsapp/types";

export const whatsappRouter: ReturnType<typeof Router> = Router();
export const whatsappAdminRouter: ReturnType<typeof Router> = Router();

const appSecret = () => (process.env.WHATSAPP_APP_SECRET || process.env.META_APP_SECRET || "").trim();

/** Meta signs each webhook body with the app secret; anything else is rejected. */
export function validSignature(rawBody: Buffer | undefined, header: string | undefined): boolean {
  const secret = appSecret();
  if (!secret || !rawBody || !header?.startsWith("sha256=")) return false;
  const expected = Buffer.from(`sha256=${crypto.createHmac("sha256", secret).update(rawBody).digest("hex")}`);
  const given = Buffer.from(header);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

whatsappRouter.get("/webhook", (req: Request, res: Response) => {
  const mode = req.query["hub.mode"], token = req.query["hub.verify_token"], challenge = req.query["hub.challenge"];
  const expected = process.env.WHATSAPP_VERIFY_TOKEN?.trim();
  if (mode === "subscribe" && expected && token === expected && typeof challenge === "string") {
    logger.info("whatsapp.webhook_verified");
    res.status(200).type("text/plain").send(challenge);
    return;
  }
  res.sendStatus(403);
});

/** WhatsApp's message JSON -> our Input shape. */
export function toInput(m: any): Input {
  switch (m.type) {
    case "text": return { kind: "text", text: String(m.text?.body ?? "") };
    case "interactive":
      if (m.interactive?.type === "button_reply") return { kind: "choice", id: String(m.interactive.button_reply.id), title: String(m.interactive.button_reply.title) };
      if (m.interactive?.type === "list_reply") return { kind: "choice", id: String(m.interactive.list_reply.id), title: String(m.interactive.list_reply.title) };
      return { kind: "other", type: "interactive" };
    case "button": return { kind: "text", text: String(m.button?.text ?? "") }; // quick-reply on a template
    case "image": return { kind: "media", mediaId: String(m.image.id), mimeType: String(m.image.mime_type ?? ""), caption: m.image.caption };
    case "document": return { kind: "media", mediaId: String(m.document.id), mimeType: String(m.document.mime_type ?? ""), filename: m.document.filename, caption: m.document.caption };
    case "location": return { kind: "location", lat: Number(m.location.latitude), lng: Number(m.location.longitude), address: m.location.address, name: m.location.name };
    default: return { kind: "other", type: String(m.type) };
  }
}

whatsappRouter.post("/webhook", async (req: Request, res: Response): Promise<void> => {
  if (!validSignature((req as Request & { rawBody?: Buffer }).rawBody, req.get("x-hub-signature-256"))) {
    logger.warn("whatsapp.bad_signature");
    res.sendStatus(401);
    return;
  }
  res.sendStatus(200); // answer Meta straight away; the work happens below
  try {
    for (const entry of req.body?.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value ?? {};
        for (const st of value.statuses ?? []) {
          await recordStatus(String(st.id), String(st.status), st.errors?.[0] ? `${st.errors[0].code}: ${st.errors[0].title}` : null).catch(() => undefined);
          if (st.status === "failed") logger.warn("whatsapp.delivery_failed", { error: st.errors?.[0]?.title });
        }
        const names = new Map<string, string>((value.contacts ?? []).map((c: any) => [String(c.wa_id), String(c.profile?.name ?? "")]));
        for (const m of value.messages ?? []) {
          const phone = String(m.from);
          if (!/^\d{8,15}$/.test(phone)) continue;
          const input = toInput(m);
          const media = input.kind === "media" ? { id: input.mediaId, mime: input.mimeType } : null;
          if (!(await recordInbound(String(m.id), phone, input.kind, media))) continue; // re-delivery
          void handleIncoming({ phone, profileName: names.get(phone) || null, wamid: String(m.id), input });
        }
      }
    }
  } catch (err) {
    logger.error("whatsapp.webhook_failed", { error: err instanceof Error ? err.message : String(err) });
  }
});

const page = (title: string, body: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>` +
  `<style>body{font-family:system-ui,sans-serif;background:#F5F6F8;margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:16px}` +
  `div{background:#fff;border-radius:16px;padding:28px;max-width:420px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.08)}h1{color:#1E7B4D;font-size:20px}</style></head>` +
  `<body><div><h1>${title}</h1><p>${body}</p></div></body></html>`;

/** The link emailed when someone registers on WhatsApp with an email that already has an account. */
whatsappRouter.get("/link", async (req: Request, res: Response): Promise<void> => {
  const used = await consumeMagicToken(String(req.query.t ?? ""), "link_whatsapp");
  if (!used?.phone) { res.status(400).type("html").send(page("Link expired", "This link has expired or was already used. Register again on WhatsApp to get a new one.")); return; }
  const { rows } = await pool!.query(`SELECT * FROM users WHERE id = $1`, [used.userId]);
  const user = rows[0];
  if (!user || user.account_status === "removed") { res.status(400).type("html").send(page("Can't connect", "This account is closed.")); return; }
  // They clicked a link in their email, and the number came from WhatsApp itself: both are now verified.
  const status = computeAccountStatus(true, true, true);
  await pool!.query(
    `UPDATE users SET phone = COALESCE(phone, $2), email_verified = true, phone_verified = true, account_status = CASE WHEN account_status = 'active' THEN 'active' ELSE $3 END WHERE id = $1`,
    [user.id, `+${used.phone}`, status]);
  await updateContact(used.phone, { user_id: user.id });
  await sendSignInLink(used.phone, String(user.id), `✅ Your WhatsApp is now connected to your Ballylife account, ${String(user.name).split(" ")[0]}!`).catch(() => undefined);
  logger.info("whatsapp.account_linked", { userId: user.id });
  res.type("html").send(page("WhatsApp connected ✅", "Your WhatsApp number is now linked to your Ballylife account. You can close this page and go back to WhatsApp."));
});

/** Product photos sellers sent on WhatsApp (public -- they appear on the product page). */
whatsappRouter.get("/photos/:id", async (req: Request, res: Response): Promise<void> => {
  if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) { res.sendStatus(404); return; }
  try {
    const photo = await getProductPhoto(req.params.id);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.type(photo.mimeType).send(photo.bytes);
  } catch {
    res.sendStatus(404);
  }
});

// ---------------------------------------------------------------- admin

const admin = [requireAuth, requireRole("marketplace_admin", "super_admin")];

whatsappAdminRouter.get("/admin/sellers/:id/application", ...admin, async (req: Request, res: Response): Promise<void> => {
  const { rows } = await pool!.query(`SELECT id, store_name, status, application_data FROM mkt_sellers WHERE id = $1`, [req.params.id]);
  if (!rows[0]) { res.status(404).json({ success: false, error: "Seller not found" }); return; }
  const app = typeof rows[0].application_data === "string" ? JSON.parse(rows[0].application_data) : (rows[0].application_data ?? {});
  const docs = (await pool!.query(`SELECT id, kind, mime_type, size_bytes, created_at FROM seller_documents WHERE seller_id = $1 ORDER BY created_at`, [req.params.id])).rows;
  res.json({ success: true, data: {
    source: app.source ?? "website", submittedAt: app.submittedAt ?? null, whatsappPhone: app.whatsappPhone ? `+${app.whatsappPhone}` : null,
    businessType: app.businessType ?? null, idNumber: app.idNumberMask ?? null, categories: app.categoryNames ?? [],
    bank: app.bank ? { name: app.bank.name, branch: app.bank.branch, accountType: app.bank.accountType, account: app.bank.accountMask } : null,
    documents: docs.map((d: any) => ({ id: d.id, kind: d.kind, mimeType: d.mime_type, size: d.size_bytes, uploadedAt: d.created_at })),
  } });
});

whatsappAdminRouter.get("/admin/seller-documents/:docId", ...admin, async (req: Request, res: Response): Promise<void> => {
  const { rows } = await pool!.query(`SELECT * FROM seller_documents WHERE id::text = $1`, [req.params.docId]);
  if (!rows[0]) { res.status(404).json({ success: false, error: "Document not found" }); return; }
  try {
    const bytes = await getDocument(rows[0].object_key);
    logger.info("whatsapp.document_viewed", { docId: rows[0].id, by: req.user?.userId ?? null });
    res.setHeader("Cache-Control", "no-store");
    res.type(rows[0].mime_type).send(bytes);
  } catch (err) {
    logger.error("whatsapp.document_read_failed", { error: err instanceof Error ? err.message : String(err) });
    res.status(502).json({ success: false, error: "Couldn't load the document." });
  }
});

// ---------------------------------------------------------------- WhatsApp Inbox (staff)

const phoneParam = (req: Request) => String(req.params.phone ?? "").replace(/\D/g, "");

whatsappAdminRouter.get("/admin/whatsapp/inbox", ...admin, async (_req: Request, res: Response): Promise<void> => {
  const { rows: contacts } = await pool!.query(
    `SELECT c.phone, c.profile_name, c.handoff, c.handoff_reason, c.handoff_at, c.last_inbound_at, c.staff_seen_at, c.opted_out, u.name AS user_name
       FROM wa_contacts c LEFT JOIN users u ON u.id = c.user_id
      WHERE c.last_inbound_at IS NOT NULL
      ORDER BY c.handoff DESC, c.last_inbound_at DESC LIMIT 60`);
  const data = [];
  for (const c of contacts) {
    const { rows: last } = await pool!.query(`SELECT direction, body, sent_by, created_at FROM wa_messages WHERE phone = $1 AND body IS NOT NULL ORDER BY created_at DESC LIMIT 1`, [c.phone]);
    const { rows: unread } = await pool!.query(
      `SELECT COUNT(*)::int AS n FROM wa_messages WHERE phone = $1 AND direction = 'in' AND created_at > $2`, [c.phone, c.staff_seen_at ?? new Date(0)]);
    data.push({
      phone: c.phone, name: c.user_name ?? c.profile_name ?? null, handoff: c.handoff, handoffReason: c.handoff_reason, handoffAt: c.handoff_at,
      lastInboundAt: c.last_inbound_at, optedOut: c.opted_out,
      windowOpen: Boolean(c.last_inbound_at && Date.now() - new Date(c.last_inbound_at).getTime() < 24 * 3600_000),
      unread: c.handoff ? Number(unread[0]?.n ?? 0) : 0,
      lastMessage: last[0] ? { direction: last[0].direction, text: String(last[0].body).slice(0, 120), sentBy: last[0].sent_by, at: last[0].created_at } : null,
    });
  }
  const since = new Date(Date.now() - 30 * 24 * 3600_000).toISOString().slice(0, 10);
  const { rows: usage } = await pool!.query(`SELECT * FROM ai_usage_daily WHERE day >= $1`, [since]);
  const todayKey = new Date().toISOString().slice(0, 10);
  const todayRow = usage.find((r: any) => new Date(r.day).toISOString().slice(0, 10) === todayKey);
  res.json({ success: true, data: {
    conversations: data,
    ai: {
      enabled: isAssistantConfigured(),
      today: { answers: Number(todayRow?.answers ?? 0), usd: todayRow ? Math.round(estimateUsd(todayRow) * 100) / 100 : 0 },
      last30Days: { answers: usage.reduce((n: number, r: any) => n + Number(r.answers), 0), usd: Math.round(usage.reduce((t: number, r: any) => t + estimateUsd(r), 0) * 100) / 100 },
    },
  } });
});

whatsappAdminRouter.get("/admin/whatsapp/inbox/:phone", ...admin, async (req: Request, res: Response): Promise<void> => {
  const phone = phoneParam(req);
  const { rows: contact } = await pool!.query(
    `SELECT c.*, u.name AS user_name, u.email AS user_email FROM wa_contacts c LEFT JOIN users u ON u.id = c.user_id WHERE c.phone = $1`, [phone]);
  if (!contact[0]) { res.status(404).json({ success: false, error: "Conversation not found" }); return; }
  const { rows: msgs } = await pool!.query(
    `SELECT id, direction, kind, body, sent_by, status, error, media_id, media_mime, created_at FROM wa_messages WHERE phone = $1 AND body IS NOT NULL ORDER BY created_at DESC LIMIT 100`, [phone]);
  await pool!.query(`UPDATE wa_contacts SET staff_seen_at = now() WHERE phone = $1`, [phone]);
  const c = contact[0];
  res.json({ success: true, data: {
    phone, name: c.user_name ?? c.profile_name ?? null, email: c.user_email ?? null, linked: Boolean(c.user_id),
    handoff: c.handoff, handoffReason: c.handoff_reason, optedOut: c.opted_out,
    windowOpen: Boolean(c.last_inbound_at && Date.now() - new Date(c.last_inbound_at).getTime() < 24 * 3600_000),
    messages: msgs.reverse().map((m: any) => ({ id: m.id, direction: m.direction, kind: m.kind, text: m.body, sentBy: m.sent_by, status: m.status, error: m.error, at: m.created_at, media: m.media_id ? { mimeType: m.media_mime } : null })),
  } });
});

whatsappAdminRouter.post("/admin/whatsapp/inbox/:phone/reply", ...admin, async (req: Request, res: Response): Promise<void> => {
  const text = String(req.body?.text ?? "").trim();
  if (!text) { res.status(400).json({ success: false, error: "Type a message first." }); return; }
  const r = await sendStaffReply(phoneParam(req), text, req.user?.username ?? "staff");
  if (!r.ok) { res.status(400).json({ success: false, error: r.error }); return; }
  logger.info("whatsapp.staff_replied", { by: req.user?.userId ?? null });
  res.json({ success: true });
});

whatsappAdminRouter.post("/admin/whatsapp/inbox/:phone/take", ...admin, async (req: Request, res: Response): Promise<void> => {
  await startHandoff(phoneParam(req), `Taken over by ${req.user?.username ?? "staff"}`, { silent: true });
  res.json({ success: true });
});

whatsappAdminRouter.post("/admin/whatsapp/inbox/:phone/resolve", ...admin, async (req: Request, res: Response): Promise<void> => {
  await endHandoff(phoneParam(req), "staff");
  res.json({ success: true });
});

/** A photo or file the customer sent (fetched from WhatsApp, which keeps media for about 30 days). */
whatsappAdminRouter.get("/admin/whatsapp/media/:messageId", ...admin, async (req: Request, res: Response): Promise<void> => {
  const { rows } = await pool!.query(`SELECT media_id FROM wa_messages WHERE id::text = $1 AND media_id IS NOT NULL`, [req.params.messageId]);
  if (!rows[0]) { res.status(404).json({ success: false, error: "No file on that message." }); return; }
  try {
    const file = await downloadMedia(String(rows[0].media_id));
    res.setHeader("Cache-Control", "no-store");
    res.type(file.mimeType || "application/octet-stream").send(file.bytes);
  } catch {
    res.status(410).json({ success: false, error: "WhatsApp no longer has this file (media expires after about 30 days)." });
  }
});

// ---------------------------------------------------------------- setup: templates & business profile

whatsappAdminRouter.get("/admin/whatsapp/templates", ...admin, async (_req: Request, res: Response): Promise<void> => {
  try { res.json({ success: true, data: await templateStatus() }); }
  catch (err) { res.status(502).json({ success: false, error: err instanceof Error ? err.message : String(err) }); }
});

whatsappAdminRouter.post("/admin/whatsapp/templates/submit", ...admin, async (req: Request, res: Response): Promise<void> => {
  try {
    const r = await submitMissingTemplates();
    logger.info("whatsapp.templates_submitted", { by: req.user?.userId ?? null, submitted: r.submitted, failed: r.failed.length });
    res.json({ success: true, data: r });
  } catch (err) { res.status(502).json({ success: false, error: err instanceof Error ? err.message : String(err) }); }
});

whatsappAdminRouter.get("/admin/whatsapp/profile", ...admin, async (_req: Request, res: Response): Promise<void> => {
  try { res.json({ success: true, data: { current: await getBusinessProfile(), suggested: DEFAULT_PROFILE } }); }
  catch (err) { res.status(502).json({ success: false, error: err instanceof Error ? err.message : String(err) }); }
});

whatsappAdminRouter.post("/admin/whatsapp/profile", ...admin, async (req: Request, res: Response): Promise<void> => {
  const b = req.body ?? {};
  try {
    await updateBusinessProfile({
      about: typeof b.about === "string" ? b.about : undefined,
      description: typeof b.description === "string" ? b.description : undefined,
      email: typeof b.email === "string" ? b.email : undefined,
      address: typeof b.address === "string" ? b.address : undefined,
      websites: Array.isArray(b.websites) ? b.websites.map(String) : undefined,
    });
    res.json({ success: true });
  } catch (err) { res.status(502).json({ success: false, error: err instanceof Error ? err.message : String(err) }); }
});

// ---------------------------------------------------------------- deals broadcasts

whatsappAdminRouter.get("/admin/whatsapp/deals", ...admin, async (_req: Request, res: Response): Promise<void> => {
  res.json({ success: true, data: { ...(await subscriberCount()), broadcasts: await recentBroadcasts() } });
});

whatsappAdminRouter.post("/admin/whatsapp/deals/broadcast", ...admin, async (req: Request, res: Response): Promise<void> => {
  const productId = String(req.body?.productId ?? "");
  if (req.body?.confirm !== true) { res.status(400).json({ success: false, error: "Confirm the broadcast first." }); return; }
  try { res.json({ success: true, data: await startBroadcast(productId, req.user?.username ?? "staff") }); }
  catch (err) { res.status(400).json({ success: false, error: err instanceof Error ? err.message : String(err) }); }
});

// ---------------------------------------------------------------- housekeeping

/** Daily POPIA clean-up: old message logs, abandoned conversations and their uploads. */
export async function whatsappHousekeeping(): Promise<void> {
  await pool!.query(`DELETE FROM wa_messages WHERE created_at < now() - interval '90 days'`);
  const { rows: stale } = await pool!.query(`SELECT phone, data FROM wa_conversations WHERE updated_at < now() - interval '30 days'`);
  const { deleteDocument } = await import("../services/documentStore");
  for (const c of stale) {
    const data = typeof c.data === "string" ? JSON.parse(c.data) : (c.data ?? {});
    const docs = { ...(data.docs ?? {}), ...(data.paused?.data?.docs ?? {}) } as Record<string, { key: string }>;
    for (const d of Object.values(docs)) await deleteDocument(d.key).catch(() => undefined);
    await pool!.query(`DELETE FROM wa_conversations WHERE phone = $1`, [c.phone]);
  }
  await pool!.query(`DELETE FROM magic_login_tokens WHERE expires_at < now() - interval '7 days'`);
  if (stale.length) logger.info("whatsapp.housekeeping", { abandonedConversations: stale.length });
}

export function startWhatsAppHousekeeping(): NodeJS.Timeout | null {
  if (!pool) return null;
  void import("../services/whatsapp/client").then(m => m.checkWhatsAppSetup()).catch(() => undefined);
  void import("../services/whatsapp/orderAlerts").then(m => m.startOrderAlerts()).catch(() => undefined);
  // Handed-off chats nobody answered for 48 hours go back to the bot.
  setInterval(() => void releaseStaleHandoffs().catch(err => logger.error("whatsapp.release_handoffs_failed", { error: String(err) })), 3600_000).unref();
  const run = () => void whatsappHousekeeping().catch(err => logger.error("whatsapp.housekeeping_failed", { error: String(err) }));
  setTimeout(run, 60_000).unref();
  const t = setInterval(run, 24 * 3600_000);
  t.unref();
  return t;
}
