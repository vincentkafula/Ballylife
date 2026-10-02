import { Router, Request, Response } from "express";
import { requireAuth, requireRole } from "../middleware/auth";
import { logger } from "../utils/logger";
import { getDocument } from "../services/documentStore";
import {
  verifyResendSignature, ingestReceivedEmail, mailboxSummary, listThreads, getThread, replyToThread, composeEmail,
  setThreadStatus, attachmentFor, unreadCount, InboxError, receivingStatus, enableReceiving,
} from "../services/inbox/inbox";

/**
 * Email inbox.
 *  - inboundRouter (mounted at /api/email): Resend's "email received" webhook.
 *  - inboxAdminRouter (mounted at /api/marketplace): manager inbox, replies, new emails.
 */
export const inboundRouter: ReturnType<typeof Router> = Router();
export const inboxAdminRouter: ReturnType<typeof Router> = Router();
const manager = [requireAuth, requireRole("marketplace_admin", "super_admin")];

const fail = (res: Response, err: unknown, fallback: string) => {
  if (err instanceof InboxError) { res.status(err.status).json({ success: false, error: err.message }); return; }
  logger.error("inbox.request_failed", { error: err instanceof Error ? err.message : String(err) });
  res.status(500).json({ success: false, error: fallback });
};

// Resend → us. Signed (Svix): anything unsigned or stale is refused.
inboundRouter.post("/inbound", async (req: Request, res: Response): Promise<void> => {
  const raw = (req as Request & { rawBody?: Buffer }).rawBody?.toString("utf8") ?? "";
  const headers = { "svix-id": req.header("svix-id"), "svix-timestamp": req.header("svix-timestamp"), "svix-signature": req.header("svix-signature") };
  if (!verifyResendSignature(raw, headers)) {
    logger.warn("inbox.webhook_rejected", { hasSecret: Boolean(process.env.RESEND_WEBHOOK_SECRET), hasSignature: Boolean(headers["svix-signature"]) });
    res.status(401).json({ success: false, error: "Invalid signature" });
    return;
  }
  const event = req.body as { type?: string; data?: { email_id?: string } };
  if (event.type !== "email.received" || !event.data?.email_id) { res.json({ success: true, ignored: event.type ?? "unknown" }); return; }
  try {
    await ingestReceivedEmail(event.data.email_id);
    res.json({ success: true });
  } catch (err) {
    // 5xx so Resend retries later (e.g. a brief API hiccup); it's idempotent.
    logger.error("inbox.ingest_failed", { error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ success: false, error: "Couldn't store the email yet" });
  }
});

inboxAdminRouter.get("/admin/inbox/mailboxes", ...manager, async (_req: Request, res: Response): Promise<void> => {
  try { res.json({ success: true, data: { mailboxes: await mailboxSummary(), unread: await unreadCount(), receiving: Boolean(process.env.RESEND_WEBHOOK_SECRET?.trim()) } }); }
  catch (err) { fail(res, err, "Couldn't load the mailboxes."); }
});

inboxAdminRouter.get("/admin/inbox/receiving", ...manager, async (_req: Request, res: Response): Promise<void> => {
  try { res.json({ success: true, data: await receivingStatus() }); }
  catch (err) { fail(res, err, "Couldn't ask Resend."); }
});

inboxAdminRouter.post("/admin/inbox/receiving", ...manager, async (_req: Request, res: Response): Promise<void> => {
  try { res.json({ success: true, data: await enableReceiving() }); }
  catch (err) { fail(res, err, "Couldn't switch receiving on."); }
});

inboxAdminRouter.get("/admin/inbox/threads", ...manager, async (req: Request, res: Response): Promise<void> => {
  const q = req.query as Record<string, string>;
  try { res.json({ success: true, data: await listThreads({ mailbox: q.mailbox, status: q.status, q: q.q }) }); }
  catch (err) { fail(res, err, "Couldn't load the conversations."); }
});

inboxAdminRouter.get("/admin/inbox/threads/:id", ...manager, async (req: Request, res: Response): Promise<void> => {
  try { res.json({ success: true, data: await getThread(req.params.id) }); }
  catch (err) { fail(res, err, "Couldn't load the conversation."); }
});

inboxAdminRouter.post("/admin/inbox/threads/:id/reply", ...manager, async (req: Request, res: Response): Promise<void> => {
  try {
    await replyToThread(req.params.id, String(req.body?.text ?? ""), req.user!.userId);
    res.json({ success: true, data: await getThread(req.params.id) });
  } catch (err) { fail(res, err, "Couldn't send the reply."); }
});

inboxAdminRouter.patch("/admin/inbox/threads/:id", ...manager, async (req: Request, res: Response): Promise<void> => {
  const status = req.body?.status;
  if (status !== "open" && status !== "closed") { res.status(400).json({ success: false, error: "status must be open or closed" }); return; }
  try { await setThreadStatus(req.params.id, status); res.json({ success: true }); }
  catch (err) { fail(res, err, "Couldn't update the conversation."); }
});

inboxAdminRouter.post("/admin/inbox/compose", ...manager, async (req: Request, res: Response): Promise<void> => {
  const b = req.body ?? {};
  try {
    const id = await composeEmail({ mailbox: String(b.mailbox ?? ""), to: String(b.to ?? ""), subject: String(b.subject ?? ""), text: String(b.text ?? "") }, req.user!.userId);
    res.json({ success: true, data: await getThread(id) });
  } catch (err) { fail(res, err, "Couldn't send the email."); }
});

inboxAdminRouter.get("/admin/inbox/attachments/:id", ...manager, async (req: Request, res: Response): Promise<void> => {
  try {
    const a = await attachmentFor(req.params.id);
    if (!a) { res.status(404).json({ success: false, error: "Attachment not available" }); return; }
    const bytes = await getDocument(a.storageKey);
    // Always a download, never rendered in our page (attachments are untrusted).
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${a.filename.replace(/["\\\r\n]/g, "_")}"`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(bytes);
  } catch (err) { fail(res, err, "Couldn't download the attachment."); }
});
