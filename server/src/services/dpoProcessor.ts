/**
 * DPO Pay (Network International) -- card and mobile-money payments for
 * shoppers outside South Africa. South African shoppers keep PayFast.
 *
 * Flow (DPO's hosted payment page; card details never touch Ballylife):
 *  1. createToken: the order total (rand) is converted to US dollars with
 *     the FX table and a payment token is created for that amount.
 *  2. The shopper pays on DPO's page (payv2.php?ID=<token>).
 *  3. DPO sends the browser back to /api/marketplace/dpo/return, and may
 *     also push a server-to-server notice to /api/marketplace/dpo/notify.
 *     Neither is trusted: both only trigger verifyToken, a call from our
 *     server to DPO, and the order is marked paid only if DPO says the
 *     token is paid for the exact amount and currency we asked for.
 *  4. A background check re-verifies unfinished DPO payments, for shoppers
 *     who close the browser before coming back.
 *
 * Needs DPO_COMPANY_TOKEN and DPO_SERVICE_TYPE (issued by DPO), plus the
 * public URLs PayFast already uses. Until then DPO is simply unavailable
 * and non-South-African shoppers keep paying through PayFast.
 */
import { pool, hasDb } from "../db/pool";
import { logger } from "../utils/logger";
import type { MktPayProcessor, VerifyResult } from "./mktPay";

const COMPANY_TOKEN = process.env.DPO_COMPANY_TOKEN?.trim();
const SERVICE_TYPE = process.env.DPO_SERVICE_TYPE?.trim();
const API_URL = process.env.DPO_API_URL?.trim() || "https://secure.3gdirectpay.com/API/v6/";
const PAY_URL = process.env.DPO_PAYMENT_URL?.trim() || "https://secure.3gdirectpay.com/payv2.php";
const PUBLIC_APP_URL = process.env.MARKETPLACE_PUBLIC_URL ?? "";
const API_PUBLIC_URL = process.env.MARKETPLACE_API_PUBLIC_URL ?? "";
/** Hours a DPO payment link stays valid. */
const PAYMENT_TIME_LIMIT_HOURS = Number(process.env.DPO_PTL_HOURS ?? 24);
export const DPO_CURRENCY = "USD";

export function isDpoConfigured(): boolean {
  return Boolean(COMPANY_TOKEN && SERVICE_TYPE && PUBLIC_APP_URL && API_PUBLIC_URL);
}

/** DPO is used for delivery addresses outside South Africa. */
export function usesDpo(country: string | null | undefined): boolean {
  return isDpoConfigured() && String(country ?? "ZA").toUpperCase() !== "ZA";
}

export const dpoPaymentPageUrl = (token: string) => `${PAY_URL}?ID=${encodeURIComponent(token)}`;

// ── XML helpers (DPO's API3G format is flat) ───────────────────────────────
const esc = (v: unknown) => String(v ?? "").replace(/[<>&'"]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]!));
const unesc = (v: string) => v.replace(/&lt;|&gt;|&amp;|&apos;|&quot;/g, e => ({ "&lt;": "<", "&gt;": ">", "&amp;": "&", "&apos;": "'", "&quot;": '"' }[e]!));
export function xmlField(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i"));
  return m ? unesc(m[1].trim()) : null;
}

async function call(request: string, body: string): Promise<string> {
  if (!COMPANY_TOKEN) throw new Error("DPO is not configured");
  const xml = `<?xml version="1.0" encoding="utf-8"?><API3G><CompanyToken>${esc(COMPANY_TOKEN)}</CompanyToken><Request>${request}</Request>${body}</API3G>`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(API_URL, {
      method: "POST", headers: { "Content-Type": "application/xml; charset=utf-8", Accept: "application/xml" }, body: xml, signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`DPO ${request} HTTP ${res.status}`);
    return text;
  } finally { clearTimeout(timer); }
}

async function usdPerZar(): Promise<number | null> {
  if (!hasDb || !pool) return null;
  const { rows } = await pool.query(`SELECT rate_to_zar FROM mkt_fx_rates WHERE UPPER(currency) = 'USD'`);
  const rate = Number(rows[0]?.rate_to_zar);
  return rate > 0 ? 1 / rate : null;
}

/** Rand -> US dollars, rounded up to the cent (never undercharge). */
export async function zarToUsd(amountZar: number): Promise<number | null> {
  const r = await usdPerZar();
  return r === null ? null : Math.ceil(amountZar * r * 100) / 100;
}

const dpoDate = (d = new Date()) => `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;

// ── Processor ──────────────────────────────────────────────────────────────
export const dpoProcessor: MktPayProcessor = {
  name: "dpo",
  isConfigured: isDpoConfigured,

  async submitPayment(req) {
    const usd = await zarToUsd(req.amount);
    if (usd === null || usd <= 0) return { success: false, error: "No US dollar exchange rate on file — add one under Payouts > Manage FX rates." };
    const d = (req.paymentDetails ?? {}) as { firstName?: string; lastName?: string; country?: string; phone?: string };
    const body =
      `<Transaction>` +
      `<PaymentAmount>${usd.toFixed(2)}</PaymentAmount><PaymentCurrency>${DPO_CURRENCY}</PaymentCurrency>` +
      `<CompanyRef>${esc(req.orderNumber)}</CompanyRef>` +
      `<RedirectURL>${esc(`${API_PUBLIC_URL}/api/marketplace/dpo/return`)}</RedirectURL>` +
      `<BackURL>${esc(`${PUBLIC_APP_URL}/?dpo=cancelled&order=${encodeURIComponent(req.orderNumber)}`)}</BackURL>` +
      `<CompanyRefUnique>1</CompanyRefUnique><PTL>${PAYMENT_TIME_LIMIT_HOURS}</PTL>` +
      (req.customerEmail ? `<customerEmail>${esc(req.customerEmail)}</customerEmail>` : "") +
      (d.firstName ? `<customerFirstName>${esc(d.firstName)}</customerFirstName>` : "") +
      (d.lastName ? `<customerLastName>${esc(d.lastName)}</customerLastName>` : "") +
      (d.country ? `<customerCountry>${esc(String(d.country).toUpperCase())}</customerCountry>` : "") +
      `</Transaction>` +
      `<Services><Service><ServiceType>${esc(SERVICE_TYPE)}</ServiceType>` +
      `<ServiceDescription>${esc(`Ballylife order ${req.orderNumber}`)}</ServiceDescription>` +
      `<ServiceDate>${dpoDate()}</ServiceDate></Service></Services>`;
    try {
      const xml = await call("createToken", body);
      const result = xmlField(xml, "Result");
      const token = xmlField(xml, "TransToken");
      if (result !== "000" || !token) {
        const why = xmlField(xml, "ResultExplanation") ?? "unknown error";
        logger.error("dpo.create_token_failed", { orderNumber: req.orderNumber, result, why });
        return { success: false, error: result === "940" ? "This order has already been paid." : "Couldn't start the payment — please try again." };
      }
      logger.info("dpo.token_created", { orderNumber: req.orderNumber, usd, transRef: xmlField(xml, "TransRef") });
      return { success: true, processorRef: token, chargedAmount: usd, chargedCurrency: DPO_CURRENCY };
    } catch (err) {
      logger.error("dpo.create_token_error", { orderNumber: req.orderNumber, error: err instanceof Error ? err.message : String(err) });
      return { success: false, error: "Couldn't reach the payment provider — please try again." };
    }
  },

  async verifyTransaction(token) {
    return (await verifyDpoToken(token)).status;
  },

  async refund(token, amountZar) {
    // Refunds are in the currency charged (USD): the same share of what was paid.
    if (!hasDb || !pool) return { success: false, error: "No database" };
    const { rows } = await pool.query(
      `SELECT t.charged_amount, t.charged_currency, o.total_amount FROM mkt_pay_transactions t JOIN mkt_orders o ON o.id = t.order_id
       WHERE t.processor = 'dpo' AND t.processor_ref = $1 LIMIT 1`, [token]);
    const t = rows[0];
    if (!t || !t.charged_amount) return { success: false, error: "DPO payment not found." };
    const paid = Number(t.charged_amount);
    const usd = amountZar === undefined ? paid : Math.min(paid, Math.round((paid * amountZar / Number(t.total_amount)) * 100) / 100);
    try {
      const xml = await call("refundToken",
        `<TransactionToken>${esc(token)}</TransactionToken><refundAmount>${usd.toFixed(2)}</refundAmount><refundDetails>Ballylife refund</refundDetails>`);
      const result = xmlField(xml, "Result");
      if (result !== "000") {
        const why = xmlField(xml, "ResultExplanation") ?? "unknown";
        logger.warn("dpo.refund_failed", { result, why });
        return { success: false, error: `DPO didn't process the refund (${why}). Refund it from the DPO dashboard.` };
      }
      logger.info("dpo.refunded", { usd });
      return { success: true, refundRef: `dpo_refund_${token}_${usd.toFixed(2)}` };
    } catch (err) {
      return { success: false, error: `Couldn't reach DPO (${err instanceof Error ? err.message : String(err)}). Refund it from the DPO dashboard.` };
    }
  },
};

export interface DpoVerification { status: VerifyResult; result: string | null; amount: number | null; currency: string | null; explanation: string | null }

export async function verifyDpoToken(token: string): Promise<DpoVerification> {
  try {
    const xml = await call("verifyToken", `<TransactionToken>${esc(token)}</TransactionToken>`);
    const result = xmlField(xml, "Result");
    const amount = xmlField(xml, "TransactionAmount");
    const status: VerifyResult["status"] = result === "000" ? "confirmed" : ["901", "903", "904"].includes(result ?? "") ? "failed" : "submitted";
    return {
      status: { status }, result, amount: amount !== null ? Number(amount) : null,
      currency: xmlField(xml, "TransactionCurrency"), explanation: xmlField(xml, "ResultExplanation"),
    };
  } catch (err) {
    return { status: { status: "submitted", error: err instanceof Error ? err.message : String(err) }, result: null, amount: null, currency: null, explanation: null };
  }
}

/**
 * Asks DPO about one payment and records the outcome. Paid only if DPO
 * says so for the exact amount/currency we created. Returns the order
 * number and outcome for the redirect page.
 */
export async function settleDpoPayment(token: string): Promise<{ orderNumber: string | null; outcome: "paid" | "pending" | "failed" | "unknown" }> {
  if (!hasDb || !pool) return { orderNumber: null, outcome: "unknown" };
  const { rows } = await pool.query(
    `SELECT t.*, o.order_number FROM mkt_pay_transactions t JOIN mkt_orders o ON o.id = t.order_id WHERE t.processor = 'dpo' AND t.processor_ref = $1 LIMIT 1`, [token]);
  const tx = rows[0];
  if (!tx) { logger.warn("dpo.unknown_token", {}); return { orderNumber: null, outcome: "unknown" }; }
  if (tx.status === "confirmed") return { orderNumber: tx.order_number, outcome: "paid" };

  const v = await verifyDpoToken(token);
  if (v.status.status === "confirmed") {
    const expected = Number(tx.charged_amount);
    if (v.amount === null || Math.abs(v.amount - expected) > 0.009 || String(v.currency ?? "").toUpperCase() !== String(tx.charged_currency).toUpperCase()) {
      logger.error("dpo.amount_mismatch", { orderNumber: tx.order_number, expected, got: v.amount, currency: v.currency });
      await pool.query(`UPDATE mkt_pay_transactions SET error_message = $2 WHERE id = $1`,
        [tx.id, `DPO reports ${v.amount} ${v.currency} paid, expected ${expected} ${tx.charged_currency} — check before shipping.`]);
      return { orderNumber: tx.order_number, outcome: "pending" };
    }
    const { rows: done } = await pool.query(
      `UPDATE mkt_pay_transactions SET status = 'confirmed', webhook_received_at = now(), error_message = NULL WHERE id = $1 AND status <> 'confirmed' RETURNING id`, [tx.id]);
    if (done.length) {
      await pool.query(
        `UPDATE mkt_orders SET status = CASE WHEN status = 'pending' THEN 'confirmed' ELSE status END, payment_status = 'payment_confirmed', confirmed_at = COALESCE(confirmed_at, now()) WHERE id = $1`,
        [tx.order_id]);
      logger.info("dpo.payment_confirmed", { orderNumber: tx.order_number, usd: expected });
    }
    return { orderNumber: tx.order_number, outcome: "paid" };
  }
  if (v.status.status === "failed") {
    // The payment attempt is over; the order stays unpaid so the shopper can pay again.
    await pool.query(`UPDATE mkt_pay_transactions SET status = 'failed', error_message = $2 WHERE id = $1 AND status = 'submitted'`,
      [tx.id, `DPO ${v.result}: ${v.explanation ?? ""}`.slice(0, 500)]);
    return { orderNumber: tx.order_number, outcome: "failed" };
  }
  return { orderNumber: tx.order_number, outcome: "pending" };
}

/** Background check for DPO payments whose shopper never came back. */
export async function reconcileDpoPayments(limit = 25): Promise<number> {
  if (!isDpoConfigured() || !hasDb || !pool) return 0;
  const { rows } = await pool.query(
    `SELECT processor_ref FROM mkt_pay_transactions WHERE processor = 'dpo' AND status = 'submitted' AND processor_ref IS NOT NULL
       AND created_at < $1 AND created_at > $2 ORDER BY created_at LIMIT $3`,
    [new Date(Date.now() - 2 * 60_000), new Date(Date.now() - (PAYMENT_TIME_LIMIT_HOURS + 24) * 3600_000), limit]);
  for (const r of rows) {
    try { await settleDpoPayment(r.processor_ref); }
    catch (err) { logger.warn("dpo.reconcile_failed", { error: err instanceof Error ? err.message : String(err) }); }
  }
  return rows.length;
}

export function startDpoWorker(intervalMs = 5 * 60_000): NodeJS.Timeout | null {
  if (!isDpoConfigured()) return null;
  const t = setInterval(() => { void reconcileDpoPayments(); }, intervalMs);
  t.unref();
  logger.info("dpo.worker_started", { intervalMs });
  return t;
}
