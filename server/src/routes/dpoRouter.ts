import express, { Router, Request, Response } from "express";
import { logger } from "../utils/logger";
import { settleDpoPayment, xmlField } from "../services/dpoProcessor";

/**
 * DPO Pay return and notification endpoints. Neither trusts what it's
 * sent: both only pass the payment token to settleDpoPayment, which asks
 * DPO directly (verifyToken) before anything is marked paid.
 */
const router: ReturnType<typeof Router> = Router();
const PUBLIC_APP_URL = process.env.MARKETPLACE_PUBLIC_URL ?? "";
const TOKEN_RE = /^[A-Za-z0-9-]{8,64}$/;

// The shopper's browser, sent back by DPO after paying (or failing to).
router.get("/dpo/return", async (req: Request, res: Response): Promise<void> => {
  const token = String(req.query.TransactionToken ?? req.query.TransID ?? "");
  let outcome = "pending";
  let order = String(req.query.CompanyRef ?? "");
  if (TOKEN_RE.test(token)) {
    try {
      const r = await settleDpoPayment(token);
      outcome = r.outcome === "unknown" ? "pending" : r.outcome;
      order = r.orderNumber ?? order;
    } catch (err) { logger.error("dpo.return_failed", { error: err instanceof Error ? err.message : String(err) }); }
  }
  const safeOrder = /^[A-Za-z0-9-]{1,40}$/.test(order) ? order : "";
  res.redirect(302, `${PUBLIC_APP_URL}/?dpo=${outcome}${safeOrder ? `&order=${encodeURIComponent(safeOrder)}` : ""}`);
});

// DPO's server-to-server payment notice (XML, or form fields).
router.post("/dpo/notify", express.text({ type: ["application/xml", "text/xml", "text/plain"], limit: "64kb" }), async (req: Request, res: Response): Promise<void> => {
  const ok = () => res.status(200).type("application/xml").send(`<?xml version="1.0" encoding="utf-8"?><API3G><Response>OK</Response></API3G>`);
  try {
    const body = req.body as unknown;
    const token = typeof body === "string" ? xmlField(body, "TransactionToken") : String((body as Record<string, unknown>)?.TransactionToken ?? "");
    if (token && TOKEN_RE.test(token)) await settleDpoPayment(token);
    else logger.warn("dpo.notify_without_token", {});
  } catch (err) { logger.error("dpo.notify_failed", { error: err instanceof Error ? err.message : String(err) }); }
  ok(); // always acknowledge; the background check retries anything missed
});

export default router;
