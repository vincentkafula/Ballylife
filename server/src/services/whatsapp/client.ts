/**
 * WhatsApp Cloud API: sending messages and downloading media.
 *
 * Railway variables:
 *   WHATSAPP_TOKEN            secret: permanent system-user token (whatsapp_business_messaging)
 *   WHATSAPP_PHONE_NUMBER_ID  the number we send from (test number now, the new SIM later)
 *   WHATSAPP_WABA_ID          WhatsApp Business Account id (templates)
 *
 * Every send is logged in wa_messages. Sending never throws into the
 * conversation logic: a failed send is logged and returns null, so one bad
 * message can't break a whole flow. Bank details are masked in the log.
 */
import { pool } from "../../db/pool";
import { logger } from "../../utils/logger";

const GRAPH = () => `https://graph.facebook.com/${process.env.WHATSAPP_GRAPH_VERSION || "v23.0"}`;
export const isWhatsAppConfigured = () => Boolean(process.env.WHATSAPP_TOKEN?.trim() && process.env.WHATSAPP_PHONE_NUMBER_ID?.trim());

// WhatsApp's limits for interactive messages.
const BUTTON_TITLE_MAX = 20;
const ROW_TITLE_MAX = 24;
const ROW_DESC_MAX = 72;
const clip = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n - 1) + "…");

export interface Button { id: string; title: string }
export interface ListRow { id: string; title: string; description?: string }
export interface ListSection { title?: string; rows: ListRow[] }

export class WhatsAppError extends Error {
  constructor(message: string, public code?: number) { super(message); }
}

async function graph(path: string, body: unknown): Promise<any> {
  const res = await fetch(`${GRAPH()}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN!.trim()}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const j = await res.json().catch(() => ({})) as any;
  if (!res.ok || j?.error) {
    const e = j?.error ?? {};
    throw new WhatsAppError(`WhatsApp (code ${e.code ?? res.status}${e.error_subcode ? `/${e.error_subcode}` : ""}): ${e.error_data?.details || e.message || `HTTP ${res.status}`}`, e.code);
  }
  return j;
}

async function logOut(phone: string, kind: string, body: string, wamid: string | null, error: string | null) {
  try {
    await pool!.query(`INSERT INTO wa_messages (wamid, phone, direction, kind, body, status, error) VALUES ($1, $2, 'out', $3, $4, $5, $6)`,
      [wamid, phone, kind, body.slice(0, 4000), error ? "failed" : "sent", error]);
  } catch (err) { logger.warn("whatsapp.log_failed", { error: String(err) }); }
}

async function send(phone: string, kind: string, logBody: string, payload: Record<string, unknown>): Promise<string | null> {
  if (!isWhatsAppConfigured()) { logger.warn("whatsapp.not_configured", { kind }); await logOut(phone, kind, logBody, null, "not configured"); return null; }
  try {
    const r = await graph(`/${process.env.WHATSAPP_PHONE_NUMBER_ID!.trim()}/messages`, { messaging_product: "whatsapp", recipient_type: "individual", to: phone, ...payload });
    const wamid = r?.messages?.[0]?.id ?? null;
    await logOut(phone, kind, logBody, wamid, null);
    return wamid;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("whatsapp.send_failed", { kind, error: message });
    await logOut(phone, kind, logBody, null, message);
    if (err instanceof WhatsAppError && kind === "template") throw err; // callers fall back to plain text
    return null;
  }
}

export function sendText(phone: string, text: string, opts: { previewUrl?: boolean; logAs?: string } = {}) {
  return send(phone, "text", opts.logAs ?? text, { type: "text", text: { body: text.slice(0, 4096), preview_url: Boolean(opts.previewUrl) } });
}

/** Up to 3 reply buttons. */
export function sendButtons(phone: string, text: string, buttons: Button[], header?: string) {
  return send(phone, "button", `${text}\n[${buttons.map(b => b.title).join("] [")}]`, {
    type: "interactive",
    interactive: {
      type: "button",
      ...(header ? { header: { type: "text", text: clip(header, 60) } } : {}),
      body: { text: text.slice(0, 1024) },
      action: { buttons: buttons.slice(0, 3).map(b => ({ type: "reply", reply: { id: b.id, title: clip(b.title, BUTTON_TITLE_MAX) } })) },
    },
  });
}

/** A list menu (up to 10 rows in total). */
export function sendList(phone: string, text: string, buttonLabel: string, sections: ListSection[]) {
  let left = 10;
  const trimmed = sections.map(s => {
    const rows = s.rows.slice(0, left); left -= rows.length;
    return {
      ...(s.title ? { title: clip(s.title, 24) } : {}),
      rows: rows.map(r => ({ id: r.id, title: clip(r.title, ROW_TITLE_MAX), ...(r.description ? { description: clip(r.description, ROW_DESC_MAX) } : {}) })),
    };
  }).filter(s => s.rows.length);
  return send(phone, "list", `${text}\n(${trimmed.flatMap(s => s.rows.map(r => r.title)).join(" · ")})`, {
    type: "interactive",
    interactive: { type: "list", body: { text: text.slice(0, 1024) }, action: { button: clip(buttonLabel, BUTTON_TITLE_MAX), sections: trimmed } },
  });
}

/**
 * A pre-approved template (for messages outside the 24-hour window).
 * `buttonParam` fills a dynamic URL button, e.g. the sign-in token.
 * Throws WhatsAppError if WhatsApp rejects it (e.g. template not approved yet).
 */
export function sendTemplate(phone: string, name: string, bodyParams: string[], opts: { buttonParam?: string; logAs?: string } = {}) {
  const components: unknown[] = [];
  if (bodyParams.length) components.push({ type: "body", parameters: bodyParams.map(t => ({ type: "text", text: t })) });
  if (opts.buttonParam) components.push({ type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: opts.buttonParam }] });
  return send(phone, "template", opts.logAs ?? `[template ${name}] ${bodyParams.join(" | ")}`, {
    type: "template", template: { name, language: { code: process.env.WHATSAPP_TEMPLATE_LANG || "en" }, components },
  });
}

/** Marks a received message as read (blue ticks) -- best effort. */
export async function markRead(wamid: string): Promise<void> {
  if (!isWhatsAppConfigured()) return;
  try { await graph(`/${process.env.WHATSAPP_PHONE_NUMBER_ID!.trim()}/messages`, { messaging_product: "whatsapp", status: "read", message_id: wamid }); }
  catch { /* not important */ }
}

/**
 * Start-up check: the token works, the phone number is reachable, and the
 * WhatsApp Business Account is subscribed to this app -- without that last
 * one Meta never delivers incoming messages to the webhook. Subscribes it
 * if needed. Logs what it finds (never the token).
 */
export async function checkWhatsAppSetup(): Promise<void> {
  if (!isWhatsAppConfigured()) return;
  const auth = { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN!.trim()}` };
  const get = async (path: string) => {
    const r = await fetch(`${GRAPH()}${path}`, { headers: auth, signal: AbortSignal.timeout(20_000) });
    const j = await r.json().catch(() => ({})) as any;
    if (!r.ok || j?.error) throw new WhatsAppError(j?.error?.message ?? `HTTP ${r.status}`, j?.error?.code);
    return j;
  };
  try {
    const num = await get(`/${process.env.WHATSAPP_PHONE_NUMBER_ID!.trim()}?fields=display_phone_number,verified_name,quality_rating,code_verification_status`);
    logger.info("whatsapp.number_ok", { number: num.display_phone_number, name: num.verified_name, quality: num.quality_rating });
    try {
      const perms = await get("/me/permissions");
      const granted = ((perms.data ?? []) as any[]).filter(x => x.status === "granted").map(x => String(x.permission));
      logger.info("whatsapp.token_permissions", { granted, missing: ["whatsapp_business_messaging", "whatsapp_business_management"].filter(n => !granted.includes(n)) });
    } catch (err) { logger.warn("whatsapp.permissions_check_failed", { error: err instanceof Error ? err.message : String(err) }); }
  } catch (err) {
    logger.error("whatsapp.number_check_failed", { error: err instanceof Error ? err.message : String(err) });
    return;
  }
  const waba = process.env.WHATSAPP_WABA_ID?.trim();
  if (!waba) return;
  try {
    // Subscribing is idempotent and always subscribes the token's own app
    // (Ballylife). Other apps on the list (e.g. Meta's dashboard test app)
    // don't count -- they receive the messages instead of us.
    await graph(`/${waba}/subscribed_apps`, {});
    const subs = await get(`/${waba}/subscribed_apps`);
    const apps = ((subs.data ?? []) as any[]).map(a => a.whatsapp_business_api_data?.name ?? a.whatsapp_business_api_data?.id ?? "?");
    logger.info("whatsapp.waba_subscribed", { apps });
  } catch (err) {
    logger.error("whatsapp.waba_subscription_failed", { error: err instanceof Error ? err.message : String(err) });
  }
}

/** Downloads a file the user sent (photo / PDF). */
export async function downloadMedia(mediaId: string): Promise<{ bytes: Buffer; mimeType: string; size: number }> {
  const auth = { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN!.trim()}` };
  const metaRes = await fetch(`${GRAPH()}/${encodeURIComponent(mediaId)}`, { headers: auth, signal: AbortSignal.timeout(30_000) });
  const meta = await metaRes.json() as any;
  if (!metaRes.ok || !meta?.url) throw new WhatsAppError(`WhatsApp media: ${meta?.error?.message ?? `HTTP ${metaRes.status}`}`);
  const fileRes = await fetch(meta.url, { headers: auth, signal: AbortSignal.timeout(60_000) });
  if (!fileRes.ok) throw new WhatsAppError(`WhatsApp media download: HTTP ${fileRes.status}`);
  const bytes = Buffer.from(await fileRes.arrayBuffer());
  return { bytes, mimeType: String(meta.mime_type ?? fileRes.headers.get("content-type") ?? "").split(";")[0], size: bytes.length };
}
