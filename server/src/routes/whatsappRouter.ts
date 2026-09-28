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
    case "image": return { kind: "media", mediaId: String(m.image.id), mimeType: String(m.image.mime_type ?? "") };
    case "document": return { kind: "media", mediaId: String(m.document.id), mimeType: String(m.document.mime_type ?? ""), filename: m.document.filename };
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
          if (!(await recordInbound(String(m.id), phone, input.kind))) continue; // re-delivery
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
  const run = () => void whatsappHousekeeping().catch(err => logger.error("whatsapp.housekeeping_failed", { error: String(err) }));
  setTimeout(run, 60_000).unref();
  const t = setInterval(run, 24 * 3600_000);
  t.unref();
  return t;
}
