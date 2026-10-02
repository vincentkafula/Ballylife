/**
 * The Ballylife email inbox: every @ballylife.com address (info@, orders@,
 * legal@...) is received by Resend and handled from the manager dashboard.
 *
 *  - Resend calls POST /api/email/inbound (signed with RESEND_WEBHOOK_SECRET)
 *    with only the email's id; we fetch the email from Resend's API.
 *  - Mail is grouped into conversations ("threads") per customer and
 *    mailbox, using the Message-ID headers mail apps send, or the
 *    "[Ref BL-123]" we put in every subject we send.
 *  - A new conversation gets one automatic acknowledgement from the same
 *    address -- never to robots (no-reply, bounces, mailing lists, other
 *    auto-replies) and at most once a day per sender, so two mail systems
 *    can't answer each other forever.
 *  - Managers reply (or write new emails) from the dashboard; replies go
 *    from the mailbox address and stay in the customer's thread.
 */
import crypto from "crypto";
import { pool } from "../../db/pool";
import { logger } from "../../utils/logger";
import { sendEmail } from "../emailService";
import { isDocumentStoreConfigured, putDocument } from "../documentStore";
import { canUseMailbox, type MailboxAccess } from "../departments";

export const DOMAIN = (process.env.INBOX_DOMAIN?.trim() || "ballylife.com").toLowerCase();

/** The addresses shown on the website, with their purpose. Others still arrive (under their own address). */
export const MAILBOXES: { address: string; label: string }[] = [
  { address: `info@${DOMAIN}`, label: "General enquiries" },
  { address: `orders@${DOMAIN}`, label: "Orders & delivery" },
  { address: `b2b@${DOMAIN}`, label: "Business & sellers" },
  { address: `legal@${DOMAIN}`, label: "Legal notices" },
  { address: `security@${DOMAIN}`, label: "Security reports" },
  { address: `speakup@${DOMAIN}`, label: "Speak Up (whistleblowing)" },
  { address: `advertisingcomplaints@${DOMAIN}`, label: "Advertising complaints" },
];
const labelFor = (address: string) => MAILBOXES.find(m => m.address === address)?.label ?? "Other address";
const RESEND_API = "https://api.resend.com";
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const AUTO_REPLY_GAP_MS = 24 * 3600_000;

export class InboxError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

// ── Webhook signature (Resend uses Svix) ───────────────────────────────────
/** True when the request really came from Resend: HMAC-SHA256 over "id.timestamp.body" with the whsec_ secret, within 5 minutes. */
export function verifyResendSignature(rawBody: string, headers: Record<string, string | undefined>, secret = process.env.RESEND_WEBHOOK_SECRET?.trim() ?? "", now = Date.now()): boolean {
  const id = headers["svix-id"], ts = headers["svix-timestamp"], sig = headers["svix-signature"];
  if (!secret || !id || !ts || !sig) return false;
  const seconds = Number(ts);
  if (!Number.isFinite(seconds) || Math.abs(now / 1000 - seconds) > 5 * 60) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = crypto.createHmac("sha256", key).update(`${id}.${ts}.${rawBody}`).digest();
  return sig.split(" ").some(part => {
    const [version, value] = part.split(",");
    if (version !== "v1" || !value) return false;
    const given = Buffer.from(value, "base64");
    return given.length === expected.length && crypto.timingSafeEqual(given, expected);
  });
}

// ── Helpers ────────────────────────────────────────────────────────────────
/** "Mwila Banda <mwila@example.com>" -> { email, name } */
export function parseAddress(raw: string): { email: string; name: string | null } {
  const m = String(raw ?? "").match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { email: m[2].trim().toLowerCase(), name: m[1].trim() || null };
  return { email: String(raw ?? "").trim().toLowerCase(), name: null };
}
const refTag = (refNo: number) => `[Ref BL-${refNo}]`;
const REF_RE = /\[Ref BL-(\d+)\]/i;
const baseSubject = (s: string) => s.replace(REF_RE, "").replace(/^\s*((re|fwd?|aw|sv)\s*:\s*)+/i, "").trim();
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const header = (headers: Record<string, unknown> | undefined, name: string): string =>
  String(Object.entries(headers ?? {}).find(([k]) => k.toLowerCase() === name)?.[1] ?? "");

/** Senders that must never get an automatic reply (robots, bounces, lists, other auto-replies). */
export function isAutomatedSender(fromEmail: string, headers: Record<string, unknown> | undefined): boolean {
  if (/^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|bounces?|notifications?)[@+._-]/i.test(fromEmail)) return true;
  if (fromEmail.endsWith(`@${DOMAIN}`)) return true;
  const auto = header(headers, "auto-submitted").toLowerCase();
  if (auto && auto !== "no") return true;
  if (/^(bulk|list|junk|auto_reply)$/i.test(header(headers, "precedence"))) return true;
  if (header(headers, "list-id") || header(headers, "list-unsubscribe")) return true;
  if (header(headers, "x-autoreply") || header(headers, "x-autorespond")) return true;
  return false;
}

async function resendGet(path: string): Promise<any> {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) throw new InboxError("RESEND_API_KEY isn't set.", 503);
  const res = await fetch(`${RESEND_API}${path}`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20_000) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new InboxError(`Resend ${path}: HTTP ${res.status} ${(j as any)?.message ?? ""}`.trim(), 502);
  return j;
}

// ── Domain receiving switch (Resend) ───────────────────────────────────────
async function resendCall(method: "GET" | "PATCH" | "POST", path: string, body?: unknown): Promise<{ ok: boolean; status: number; json: any }> {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) throw new InboxError("RESEND_API_KEY isn't set.", 503);
  const res = await fetch(`${RESEND_API}${path}`, {
    method, headers: { Authorization: `Bearer ${key}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20_000),
  });
  return { ok: res.ok, status: res.status, json: await res.json().catch(() => ({})) };
}

const keyPermissionHint = "Your Resend API key only has sending access, which can't change domain settings. Either switch on Receiving for ballylife.com in Resend's dashboard, or put a Full access key in RESEND_API_KEY.";

/** What Resend says about ballylife.com: sending/receiving on, and the receiving record's status. */
export async function receivingStatus(): Promise<{ domainId: string; status: string; receiving: string | null; mx: { value: string; priority: number | null; status: string } | null }> {
  const list = await resendCall("GET", "/domains");
  if (!list.ok) throw new InboxError(list.status === 401 || list.status === 403 ? keyPermissionHint : `Resend: ${list.json?.message ?? `HTTP ${list.status}`}`, 502);
  const d = ((list.json.data ?? []) as any[]).find(x => String(x.name).toLowerCase() === DOMAIN);
  if (!d) throw new InboxError(`${DOMAIN} isn't in this Resend account.`, 404);
  const one = await resendCall("GET", `/domains/${encodeURIComponent(d.id)}`);
  const info = one.ok ? one.json : d;
  const recv = ((info.records ?? []) as any[]).find(r => String(r.type).toUpperCase() === "MX" && (r.record === "Receiving" || /inbound/i.test(String(r.value))));
  // DNS records are public anyway; logging them shows exactly what Resend expects.
  logger.info("inbox.receiving_status", {
    domainStatus: info.status ?? null, receiving: info.capabilities?.receiving ?? null,
    records: ((info.records ?? []) as any[]).map(r => ({ record: r.record, type: r.type, name: r.name, value: r.value, priority: r.priority ?? null, status: r.status })),
  });
  return {
    domainId: d.id, status: String(info.status ?? d.status ?? ""),
    receiving: info.capabilities?.receiving ?? d.capabilities?.receiving ?? null,
    mx: recv ? { value: String(recv.value), priority: recv.priority ?? null, status: String(recv.status ?? "") } : null,
  };
}

export async function enableReceiving(): Promise<Awaited<ReturnType<typeof receivingStatus>>> {
  const s = await receivingStatus();
  const r = await resendCall("PATCH", `/domains/${encodeURIComponent(s.domainId)}`, { capabilities: { receiving: "enabled" } });
  if (!r.ok) throw new InboxError(r.status === 401 || r.status === 403 ? keyPermissionHint : `Resend didn't switch it on: ${r.json?.message ?? `HTTP ${r.status}`}`, 502);
  logger.info("inbox.receiving_enabled", { domain: DOMAIN });
  // Ask Resend to check the MX record now (it's already in DNS).
  await resendCall("POST", `/domains/${encodeURIComponent(s.domainId)}/verify`).catch(() => undefined);
  return receivingStatus();
}

// ── Safety net: pull received emails the webhook didn't deliver ────────────
const SYNC_WINDOW_MS = 7 * 24 * 3600_000;
let syncing = false;

/** Asks Resend for recently received emails and files any we don't have yet. Safe to run often. */
export async function syncReceivedEmails(): Promise<{ checked: number; imported: number }> {
  if (syncing || !process.env.RESEND_API_KEY?.trim()) return { checked: 0, imported: 0 };
  syncing = true;
  try {
    const list = await resendGet("/emails/receiving?limit=100");
    const recent = ((list.data ?? []) as { id: string; created_at?: string }[])
      .filter(e => e.id && (!e.created_at || Date.now() - new Date(e.created_at).getTime() < SYNC_WINDOW_MS));
    if (!recent.length) return { checked: 0, imported: 0 };
    const ids = recent.map(e => e.id);
    const { rows } = await pool!.query(`SELECT provider_id FROM email_messages WHERE provider_id IN (${ids.map((_, i) => `$${i + 1}`).join(",")})`, ids);
    const have = new Set(rows.map((r: { provider_id: string }) => r.provider_id));
    let imported = 0;
    // Oldest first, so conversations build up in order.
    for (const e of [...recent].reverse()) {
      if (have.has(e.id)) continue;
      try { if (await ingestReceivedEmail(e.id)) imported++; }
      catch (err) { logger.warn("inbox.sync_item_failed", { error: err instanceof Error ? err.message : String(err) }); }
    }
    if (imported) logger.info("inbox.synced", { checked: recent.length, imported });
    return { checked: recent.length, imported };
  } finally { syncing = false; }
}

export function startInboxSync(intervalMs = 2 * 60_000): NodeJS.Timeout {
  const t = setInterval(() => { void syncReceivedEmails().catch(err => logger.warn("inbox.sync_failed", { error: err instanceof Error ? err.message : String(err) })); }, intervalMs);
  t.unref();
  setTimeout(() => { void syncReceivedEmails().catch(() => undefined); }, 15_000).unref();
  return t;
}

// ── Receiving ──────────────────────────────────────────────────────────────
/** Fetches a received email from Resend and files it. Idempotent: the same email id is stored once. */
export async function ingestReceivedEmail(emailId: string): Promise<{ threadId: string; isNew: boolean; autoReplied: boolean } | null> {
  const { rows: seen } = await pool!.query(`SELECT thread_id FROM email_messages WHERE provider_id = $1`, [emailId]);
  if (seen.length) return null; // Resend retried a webhook we already handled

  const email = await resendGet(`/emails/receiving/${encodeURIComponent(emailId)}`);
  const from = parseAddress(email.headers?.from ?? email.from ?? "");
  const recipients: string[] = [...(email.to ?? []), ...(email.cc ?? []), ...(email.received_for ?? [])].map(a => parseAddress(a).email);
  const mailbox = recipients.find(a => a.endsWith(`@${DOMAIN}`)) ?? MAILBOXES[0].address;
  const subject = String(email.subject ?? "(no subject)").slice(0, 300);
  const messageId = String(email.message_id ?? header(email.headers, "message-id") ?? "") || null;
  const inReplyTo = header(email.headers, "in-reply-to") || null;
  const references = header(email.headers, "references");

  // Which conversation: a reply to one of our messages, or "[Ref BL-n]" in the subject.
  let threadId: string | null = null;
  const refIds = [inReplyTo, ...references.split(/\s+/)].filter(Boolean) as string[];
  if (refIds.length) {
    const ph = refIds.map((_, i) => `$${i + 1}`).join(",");
    const { rows } = await pool!.query(`SELECT thread_id FROM email_messages WHERE message_id IN (${ph}) ORDER BY created_at DESC LIMIT 1`, refIds);
    threadId = rows[0]?.thread_id ?? null;
  }
  const ref = subject.match(REF_RE);
  if (!threadId && ref) {
    const { rows } = await pool!.query(`SELECT id FROM email_threads WHERE ref_no = $1 AND counterpart_email = $2`, [Number(ref[1]), from.email]);
    threadId = rows[0]?.id ?? null;
  }

  const isNew = !threadId;
  if (!threadId) {
    const { rows } = await pool!.query(
      `INSERT INTO email_threads (mailbox, subject, counterpart_email, counterpart_name) VALUES ($1,$2,$3,$4) RETURNING id`,
      [mailbox, baseSubject(subject) || "(no subject)", from.email, from.name]);
    threadId = rows[0].id as string;
  }

  const { rows: msg } = await pool!.query(
    `INSERT INTO email_messages (thread_id, direction, provider_id, message_id, in_reply_to, from_addr, to_addrs, cc_addrs, subject, text_body, html_body, auth_result)
     VALUES ($1,'in',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [threadId, emailId, messageId, inReplyTo, from.email, JSON.stringify(email.to ?? []), JSON.stringify(email.cc ?? []), subject,
     email.text ?? null, email.html ?? null, JSON.stringify(email.authentication ?? null)]);
  await pool!.query(`UPDATE email_threads SET unread = true, status = 'open', last_message_at = now() WHERE id = $1`, [threadId]);

  if (Array.isArray(email.attachments) && email.attachments.length) {
    await saveAttachments(emailId, msg[0].id).catch(err => logger.warn("inbox.attachments_failed", { error: err instanceof Error ? err.message : String(err) }));
  }

  let autoReplied = false;
  if (isNew) autoReplied = await maybeAutoReply(threadId, mailbox, from.email, subject, messageId, email.headers);
  logger.info("inbox.received", { mailbox, isNew, autoReplied, attachments: email.attachments?.length ?? 0 });
  return { threadId, isNew, autoReplied };
}

async function saveAttachments(emailId: string, messageRowId: string): Promise<void> {
  const list = await resendGet(`/emails/receiving/${encodeURIComponent(emailId)}/attachments?limit=50`);
  for (const a of (list.data ?? []) as { filename?: string; content_type?: string; size?: number; download_url?: string }[]) {
    let storageKey: string | null = null;
    if (a.download_url && isDocumentStoreConfigured() && Number(a.size ?? 0) <= MAX_ATTACHMENT_BYTES) {
      const res = await fetch(a.download_url, { signal: AbortSignal.timeout(30_000) });
      if (res.ok) storageKey = await putDocument("inbox", Buffer.from(await res.arrayBuffer()), a.content_type ?? "application/octet-stream");
    }
    await pool!.query(`INSERT INTO email_attachments (message_id, filename, content_type, size, storage_key) VALUES ($1,$2,$3,$4,$5)`,
      [messageRowId, String(a.filename ?? "attachment").slice(0, 200), a.content_type ?? "application/octet-stream", Number(a.size ?? 0), storageKey]);
  }
}

// ── Sending ────────────────────────────────────────────────────────────────
const newMessageId = () => `<${crypto.randomUUID()}@${DOMAIN}>`;
const fromHeader = (mailbox: string) => `Ballylife <${mailbox}>`;

/** Plain text a manager typed -> simple HTML with Ballylife's signature. */
function toHtml(text: string, mailbox: string): string {
  const body = escapeHtml(text.trim()).replace(/\r?\n/g, "<br>");
  return `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#111">${body}<br><br>— Ballylife<br><span style="color:#666">${escapeHtml(mailbox)} · www.ballylife.com</span></div>`;
}

async function sendInThread(threadId: string, opts: { text: string; sentBy: string | null; autoReply?: boolean; html?: string }): Promise<{ messageRowId: string }> {
  const { rows } = await pool!.query(`SELECT * FROM email_threads WHERE id = $1`, [threadId]);
  const t = rows[0];
  if (!t) throw new InboxError("Conversation not found", 404);
  const { rows: last } = await pool!.query(
    `SELECT message_id FROM email_messages WHERE thread_id = $1 ORDER BY created_at DESC LIMIT 20`, [threadId]);
  const refs = last.map((r: { message_id: string | null }) => r.message_id).filter((m): m is string => Boolean(m)).slice(0, 10).reverse();
  const messageId = newMessageId();
  const subject = `Re: ${t.subject} ${refTag(t.ref_no)}`;
  const headers: Record<string, string> = { "Message-ID": messageId };
  if (refs.length) { headers["In-Reply-To"] = refs[refs.length - 1]; headers.References = refs.join(" "); }
  if (opts.autoReply) headers["Auto-Submitted"] = "auto-replied";
  const html = opts.html ?? toHtml(opts.text, t.mailbox);
  const r = await sendEmail({ to: t.counterpart_email, subject, html, text: opts.text, from: fromHeader(t.mailbox), replyTo: t.mailbox, headers });
  if (!r.sent) throw new InboxError(`The email wasn't sent: ${r.error ?? "unknown error"}`, 502);
  const { rows: saved } = await pool!.query(
    `INSERT INTO email_messages (thread_id, direction, provider_id, message_id, in_reply_to, from_addr, to_addrs, subject, text_body, html_body, auto_reply, sent_by)
     VALUES ($1,'out',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [threadId, r.providerId ?? null, messageId, headers["In-Reply-To"] ?? null, t.mailbox, JSON.stringify([t.counterpart_email]), subject, opts.text, html, Boolean(opts.autoReply), opts.sentBy]);
  await pool!.query(`UPDATE email_threads SET last_message_at = now() WHERE id = $1`, [threadId]);
  return { messageRowId: saved[0].id };
}

export function autoReplyText(mailbox: string, refNo: number): string {
  return [
    "Hello,",
    "",
    `Thank you for contacting Ballylife. We've received your message and given it the reference BL-${refNo}.`,
    "Our team replies within 1 business day (Monday to Friday, 08:00–17:00 SAST). Please keep the reference in the subject if you write again.",
    "",
    "For orders, you can also track your order or chat with us on WhatsApp at +27 61 461 5035.",
    "",
    `This is an automatic reply from ${mailbox}.`,
  ].join("\n");
}

async function maybeAutoReply(threadId: string, mailbox: string, fromEmail: string, subject: string, messageId: string | null, headers: Record<string, unknown> | undefined): Promise<boolean> {
  if (isAutomatedSender(fromEmail, headers)) return false;
  // At most one automatic reply per sender a day, across all mailboxes.
  const { rows } = await pool!.query(
    `SELECT 1 FROM email_messages m JOIN email_threads t ON t.id = m.thread_id
     WHERE m.auto_reply = true AND t.counterpart_email = $1 AND m.created_at > $2 LIMIT 1`, [fromEmail, new Date(Date.now() - AUTO_REPLY_GAP_MS)]);
  if (rows.length) return false;
  const { rows: t } = await pool!.query(`SELECT ref_no FROM email_threads WHERE id = $1`, [threadId]);
  try {
    await sendInThread(threadId, { text: autoReplyText(mailbox, Number(t[0].ref_no)), sentBy: null, autoReply: true });
    return true;
  } catch (err) {
    logger.warn("inbox.auto_reply_failed", { error: err instanceof Error ? err.message : String(err), subject: subject.slice(0, 80), hasMessageId: Boolean(messageId) });
    return false;
  }
}

// ── Manager actions (scoped to the manager's departments) ──────────────────
// Every action takes the caller's MailboxAccess: the super admin uses every
// address; other managers only their departments' addresses. A conversation
// outside their access behaves as if it doesn't exist.

async function threadFor(threadId: string, access: MailboxAccess): Promise<any> {
  const { rows } = await pool!.query(`SELECT * FROM email_threads WHERE id = $1`, [threadId]);
  const t = rows[0];
  if (!t || !canUseMailbox(access, t.mailbox)) throw new InboxError("Conversation not found", 404);
  return t;
}

export async function replyToThread(threadId: string, text: string, managerId: string, access: MailboxAccess): Promise<void> {
  await threadFor(threadId, access);
  if (!text.trim()) throw new InboxError("Write a reply first.");
  if (text.length > 20_000) throw new InboxError("That reply is too long.");
  await sendInThread(threadId, { text, sentBy: managerId });
  await pool!.query(`UPDATE email_threads SET unread = false WHERE id = $1`, [threadId]);
}

/** A new email from one of our mailboxes to anyone (starts a conversation). */
export async function composeEmail(input: { mailbox: string; to: string; subject: string; text: string }, managerId: string, access: MailboxAccess): Promise<string> {
  const mailbox = input.mailbox.trim().toLowerCase();
  if (!mailbox.endsWith(`@${DOMAIN}`) || !/^[a-z0-9._+-]+@/.test(mailbox)) throw new InboxError(`Send from an @${DOMAIN} address.`);
  if (!canUseMailbox(access, mailbox)) throw new InboxError(`Your department can't send from ${mailbox}.`, 403);
  const to = parseAddress(input.to).email;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new InboxError("Enter a valid email address to send to.");
  const subject = input.subject.trim().slice(0, 200);
  if (!subject) throw new InboxError("Add a subject.");
  if (!input.text.trim()) throw new InboxError("Write a message first.");
  const { rows } = await pool!.query(
    `INSERT INTO email_threads (mailbox, subject, counterpart_email, unread) VALUES ($1,$2,$3,false) RETURNING id`, [mailbox, subject, to]);
  try { await sendInThread(rows[0].id, { text: input.text, sentBy: managerId }); }
  catch (err) { await pool!.query(`DELETE FROM email_threads WHERE id = $1`, [rows[0].id]); throw err; }
  return rows[0].id;
}

/** Mailboxes this manager can use, with unread/open counts. */
export async function mailboxSummary(access: MailboxAccess) {
  const { rows } = await pool!.query(
    `SELECT mailbox, COUNT(*)::int AS total, SUM(CASE WHEN unread THEN 1 ELSE 0 END)::int AS unread, SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END)::int AS open
     FROM email_threads GROUP BY mailbox`);
  const by = new Map(rows.map((r: { mailbox: string }) => [r.mailbox, r]));
  const counts = (address: string) => ({ unread: Number((by.get(address) as any)?.unread ?? 0), open: Number((by.get(address) as any)?.open ?? 0) });
  const addresses = access.all
    ? [...MAILBOXES.map(m => m.address), ...rows.map((r: { mailbox: string }) => r.mailbox)]
    : [...MAILBOXES.map(m => m.address).filter(a => access.mailboxes.includes(a)), ...access.mailboxes];
  return [...new Set(addresses)].map(address => ({ address, label: labelFor(address), ...counts(address) }));
}

export async function listThreads(filter: { mailbox?: string; status?: string; q?: string }, access: MailboxAccess) {
  const where: string[] = [];
  const params: unknown[] = [];
  const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
  if (filter.mailbox) {
    if (!canUseMailbox(access, filter.mailbox)) return [];
    where.push(`mailbox = ${p(filter.mailbox.toLowerCase())}`);
  } else if (!access.all) {
    if (!access.mailboxes.length) return [];
    where.push(`mailbox IN (${access.mailboxes.map(m => p(m)).join(",")})`);
  }
  if (filter.status === "open" || filter.status === "closed") where.push(`status = ${p(filter.status)}`);
  if (filter.q?.trim()) {
    const like = p(`%${filter.q.trim().toLowerCase()}%`);
    where.push(`(LOWER(subject) LIKE ${like} OR LOWER(counterpart_email) LIKE ${like} OR LOWER(COALESCE(counterpart_name, '')) LIKE ${like})`);
  }
  const { rows } = await pool!.query(
    `SELECT * FROM email_threads ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY last_message_at DESC LIMIT 200`, params);
  return rows.map((t: any) => ({
    id: t.id, ref: `BL-${t.ref_no}`, mailbox: t.mailbox, subject: t.subject, counterpartEmail: t.counterpart_email,
    counterpartName: t.counterpart_name, status: t.status, unread: t.unread, lastMessageAt: t.last_message_at,
  }));
}

const FINAL_DELIVERY = new Set(["delivered", "bounced", "complained", "failed", "canceled"]);

/** Resend's latest delivery event for emails we sent (Delivered, Bounced...), saved once final. */
async function refreshDeliveryStatus(msgs: any[]): Promise<void> {
  const pending = msgs.filter(m => m.direction === "out" && m.provider_id && !FINAL_DELIVERY.has(String(m.delivery_status ?? ""))
    && Date.now() - new Date(m.created_at).getTime() < 7 * 24 * 3600_000).slice(0, 10);
  for (const m of pending) {
    try {
      const e = await resendGet(`/emails/${encodeURIComponent(m.provider_id)}`);
      const status = String(e.last_event ?? "").toLowerCase() || null;
      if (status && status !== m.delivery_status) {
        await pool!.query(`UPDATE email_messages SET delivery_status = $2 WHERE id = $1`, [m.id, status]);
        m.delivery_status = status;
      }
    } catch { /* show what we have */ }
  }
}

export async function getThread(threadId: string, access: MailboxAccess) {
  const t = await threadFor(threadId, access);
  const { rows: msgs } = await pool!.query(`SELECT * FROM email_messages WHERE thread_id = $1 ORDER BY created_at ASC`, [threadId]);
  await refreshDeliveryStatus(msgs);
  const ids = msgs.map((m: { id: string }) => m.id);
  const { rows: atts } = ids.length
    ? await pool!.query(`SELECT id, message_id, filename, content_type, size, storage_key FROM email_attachments WHERE message_id IN (${ids.map((_: string, i: number) => `$${i + 1}`).join(",")})`, ids)
    : { rows: [] as any[] };
  await pool!.query(`UPDATE email_threads SET unread = false WHERE id = $1`, [threadId]);
  return {
    id: t.id, ref: `BL-${t.ref_no}`, mailbox: t.mailbox, mailboxLabel: labelFor(t.mailbox), subject: t.subject,
    counterpartEmail: t.counterpart_email, counterpartName: t.counterpart_name, status: t.status,
    messages: msgs.map((m: any) => ({
      id: m.id, direction: m.direction, from: m.from_addr, to: m.to_addrs, cc: m.cc_addrs, subject: m.subject,
      text: m.text_body, html: m.html_body, autoReply: m.auto_reply, createdAt: m.created_at,
      deliveryStatus: m.direction === "out" ? (m.delivery_status ?? null) : null,
      senderVerified: m.direction === "in" ? (m.auth_result ? String((m.auth_result as any).dmarc ?? (m.auth_result as any).dkim ?? "") === "pass" : null) : null,
      attachments: atts.filter((a: any) => a.message_id === m.id).map((a: any) => ({ id: a.id, filename: a.filename, contentType: a.content_type, size: a.size, available: Boolean(a.storage_key) })),
    })),
  };
}

export async function setThreadStatus(threadId: string, status: "open" | "closed", access: MailboxAccess): Promise<void> {
  await threadFor(threadId, access);
  await pool!.query(`UPDATE email_threads SET status = $2 WHERE id = $1`, [threadId, status]);
}

export async function attachmentFor(id: string, access: MailboxAccess): Promise<{ filename: string; contentType: string; storageKey: string } | null> {
  const { rows } = await pool!.query(
    `SELECT a.filename, a.content_type, a.storage_key, t.mailbox FROM email_attachments a
     JOIN email_messages m ON m.id = a.message_id JOIN email_threads t ON t.id = m.thread_id WHERE a.id = $1`, [id]);
  const a = rows[0];
  if (!a || !canUseMailbox(access, a.mailbox)) return null;
  return a.storage_key ? { filename: a.filename, contentType: a.content_type, storageKey: a.storage_key } : null;
}

export async function unreadCount(access: MailboxAccess): Promise<number> {
  if (access.all) {
    const { rows } = await pool!.query(`SELECT COUNT(*)::int AS n FROM email_threads WHERE unread = true`);
    return Number(rows[0]?.n ?? 0);
  }
  if (!access.mailboxes.length) return 0;
  const { rows } = await pool!.query(
    `SELECT COUNT(*)::int AS n FROM email_threads WHERE unread = true AND mailbox IN (${access.mailboxes.map((_, i) => `$${i + 1}`).join(",")})`, access.mailboxes);
  return Number(rows[0]?.n ?? 0);
}
