import crypto from "crypto";
import { pool } from "../db/pool";
import type { MktPayProcessor, ChargeRequest, SubmitResult, VerifyResult, RefundResult } from "./mktPay";

/**
 * Real PayFast integration — South Africa's dominant gateway, matching
 * the payment badges already shown in the storefront footer. Inactive
 * until PAYFAST_MERCHANT_ID and PAYFAST_MERCHANT_KEY are set in Railway;
 * until then isConfigured() returns false and mktPay.ts's manual
 * processor keeps handling "card" as a placeholder.
 *
 * PayFast is redirect-based, not a server-to-server charge call: the
 * customer's browser gets POSTed to PayFast's own hosted payment page,
 * and PayFast calls back an ITN (Instant Transaction Notification) to
 * notify_url once the payment actually completes. submitPayment() here
 * only prepares that redirect and stashes the signed fields for the
 * order route to hand back to the frontend — actual confirmation always
 * comes through the webhook in payfastNotify below, never optimistically.
 *
 * Required env vars:
 *   PAYFAST_MERCHANT_ID, PAYFAST_MERCHANT_KEY — from your PayFast account
 *   PAYFAST_PASSPHRASE — optional but strongly recommended (set one in
 *     your PayFast account settings, then mirror it here)
 *   PAYFAST_MODE — "live" to use PayFast's production URL; anything else
 *     (or unset) uses the sandbox
 *   MARKETPLACE_PUBLIC_URL — the deployed frontend URL, e.g.
 *     https://ballylife-frontend-production.up.railway.app
 *   MARKETPLACE_API_PUBLIC_URL — this backend's own public URL, e.g.
 *     https://ballylife-backend-production.up.railway.app (PayFast needs
 *     a real internet-reachable notify_url — localhost won't work)
 *
 * Before taking real payments, also consider adding PayFast's published
 * IP ranges as a further check if you want a third layer — signature
 * verification plus the server-to-server validate callback
 * (confirmWithPayfast, used by the /payfast/notify route) already cover
 * PayFast's two officially recommended checks.
 */

const MERCHANT_ID = process.env.PAYFAST_MERCHANT_ID;
const MERCHANT_KEY = process.env.PAYFAST_MERCHANT_KEY;
const PASSPHRASE = process.env.PAYFAST_PASSPHRASE;
const SANDBOX = process.env.PAYFAST_MODE !== "live";
const BASE_URL = SANDBOX ? "https://sandbox.payfast.co.za" : "https://www.payfast.co.za";
const PUBLIC_APP_URL = process.env.MARKETPLACE_PUBLIC_URL ?? "";
const API_PUBLIC_URL = process.env.MARKETPLACE_API_PUBLIC_URL ?? "";

// PayFast's signature is an MD5 hash of the fields in the exact order
// they're submitted (not alphabetical), URL-encoded with spaces as '+'.
// This must be applied identically when building the outbound redirect
// and when re-checking an inbound ITN's signature.
function pfSignature(params: Record<string, string>): string {
  const pairs = Object.entries(params)
    .filter(([k, v]) => k !== "signature" && v !== undefined && v !== null && String(v).trim() !== "")
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v).trim()).replace(/%20/g, "+")}`);
  let str = pairs.join("&");
  if (PASSPHRASE) str += `&passphrase=${encodeURIComponent(PASSPHRASE.trim()).replace(/%20/g, "+")}`;
  return crypto.createHash("md5").update(str).digest("hex");
}

// Holds the signed redirect fields between submitPayment() preparing them
// and the order route reading them back to send to the frontend — an
// in-memory map is fine here since it's only needed for the few seconds
// between order creation and the browser being redirected; nothing about
// payment confirmation depends on this surviving a restart.
const pendingRedirects = new Map<string, Record<string, string>>();

export const payfastProcessor: MktPayProcessor = {
  name: "payfast",
  isConfigured: () => Boolean(MERCHANT_ID && MERCHANT_KEY && PUBLIC_APP_URL && API_PUBLIC_URL),

  async submitPayment(req: ChargeRequest): Promise<SubmitResult> {
    if (!this.isConfigured()) {
      return { success: false, error: "PayFast is not configured — set PAYFAST_MERCHANT_ID, PAYFAST_MERCHANT_KEY, MARKETPLACE_PUBLIC_URL and MARKETPLACE_API_PUBLIC_URL." };
    }
    const processorRef = `pf_${req.orderId}`;
    const fields: Record<string, string> = {
      merchant_id: MERCHANT_ID!,
      merchant_key: MERCHANT_KEY!,
      return_url: `${PUBLIC_APP_URL}/?payfast=success&order=${encodeURIComponent(req.orderNumber)}`,
      cancel_url: `${PUBLIC_APP_URL}/?payfast=cancelled&order=${encodeURIComponent(req.orderNumber)}`,
      notify_url: `${API_PUBLIC_URL}/api/marketplace/payfast/notify`,
      m_payment_id: processorRef,
      amount: req.amount.toFixed(2),
      item_name: `Ballylife order ${req.orderNumber}`.slice(0, 100),
      email_address: req.customerEmail,
    };
    fields.signature = pfSignature(fields);
    pendingRedirects.set(processorRef, fields);
    return { success: true, processorRef };
  },

  async verifyTransaction(processorRef: string): Promise<VerifyResult> {
    // Deliberately does not call out to PayFast here — real confirmation
    // is the ITN webhook (payfastNotify), which PayFast recommends as the
    // authoritative source. This just reflects whatever that webhook has
    // already recorded for this reference.
    if (!pool) return { status: "submitted" };
    const { rows } = await pool.query(
      `SELECT status FROM mkt_pay_transactions WHERE processor_ref = $1 ORDER BY created_at DESC LIMIT 1`,
      [processorRef]
    );
    if (!rows.length) return { status: "submitted" };
    const status = rows[0].status;
    return { status: status === "confirmed" ? "confirmed" : status === "failed" ? "failed" : "submitted" };
  },

  async refund(): Promise<RefundResult> {
    // PayFast does have a refund API, but it needs separate API-key auth
    // (distinct from the merchant_id/merchant_key pair used for checkout)
    // and a signed timestamped request — not wired up here yet.
    return { success: false, error: "PayFast refunds aren't automated here — process them from the PayFast merchant dashboard, then update the order's payment status manually." };
  },
};

export function getPayfastRedirectFields(processorRef: string): Record<string, string> | undefined {
  return pendingRedirects.get(processorRef);
}

export function payfastRedirectUrl(): string {
  return `${BASE_URL}/eng/process`;
}

// Used by the ITN webhook to confirm the notification actually came from
// PayFast (matches what we'd have signed with the same passphrase). This
// is the first of PayFast's two recommended checks — see
// confirmWithPayfast below for the second, which the webhook also runs.
export function verifyItnSignature(body: Record<string, string>): boolean {
  if (!body.signature) return false;
  return pfSignature(body) === body.signature;
}

// PayFast's second recommended check: post the ITN data straight back to
// their own validate endpoint and confirm they echo "VALID". This is
// what actually stops a forged request from someone who happened to
// guess/leak the passphrase-derived signature format — the request has
// to round-trip through PayFast's own servers, not just match a formula.
// Runs after the signature check, not instead of it.
export async function confirmWithPayfast(rawBody: string): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/eng/query/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: rawBody,
    });
    const text = await res.text();
    return text.trim() === "VALID";
  } catch (err) {
    console.error("[payfast] Validate callback failed:", err);
    return false;
  }
}
