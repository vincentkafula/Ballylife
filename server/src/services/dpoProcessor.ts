/**
 * DPO Pay (Network International) -- card and mobile-money payments for
 * shoppers outside South Africa. South African shoppers keep PayFast.
 *
 * Currency and account per delivery country:
 *  - Countries with a local currency set (default Zambia -> ZMW) are
 *    charged in that currency, and DPO's page opens on mobile money
 *    (MTN, Airtel, Zamtel in Zambia). If that country has its own DPO
 *    merchant account (DPO_COMPANY_TOKEN_ZM / DPO_SERVICE_TYPE_ZM), it's
 *    used -- DPO Zambia settles kwacha into a Zambian bank account.
 *  - Every other country is charged in US dollars on the main account
 *    (DPO_COMPANY_TOKEN / DPO_SERVICE_TYPE).
 *
 * Flow (DPO's hosted payment page; card and wallet details never touch Ballylife):
 *  1. createToken: the order total (rand) is converted to the charge
 *     currency with the FX table and a payment token is created.
 *  2. The shopper pays on DPO's page (payv2.php?ID=<token>).
 *  3. DPO sends the browser back to /api/marketplace/dpo/return, and may
 *     also push a server-to-server notice to /api/marketplace/dpo/notify.
 *     Neither is trusted: both only trigger verifyToken, a call from our
 *     server to DPO (on the account that created the token), and the order
 *     is marked paid only if DPO confirms the exact amount and currency.
 *  4. A background check re-verifies unfinished DPO payments, for shoppers
 *     who close the browser before coming back.
 */
import { pool, hasDb } from "../db/pool";
import { logger } from "../utils/logger";
import type { MktPayProcessor, VerifyResult } from "./mktPay";

const API_URL = process.env.DPO_API_URL?.trim() || "https://secure.3gdirectpay.com/API/v6/";
const PAY_URL = process.env.DPO_PAYMENT_URL?.trim() || "https://secure.3gdirectpay.com/payv2.php";
const PUBLIC_APP_URL = process.env.MARKETPLACE_PUBLIC_URL ?? "";
const API_PUBLIC_URL = process.env.MARKETPLACE_API_PUBLIC_URL ?? "";
/** Hours a DPO payment link stays valid. */
const PAYMENT_TIME_LIMIT_HOURS = Number(process.env.DPO_PTL_HOURS ?? 24);
export const DPO_CURRENCY = "USD"; // the default (international) charge currency

/** Delivery country -> local charge currency, e.g. "ZM:ZMW,KE:KES". Default: Zambia in kwacha. */
export const LOCAL_CURRENCIES: Record<string, string> = Object.fromEntries(
  (process.env.DPO_LOCAL_CURRENCIES ?? "ZM:ZMW").split(",").map(p => p.trim().toUpperCase().split(":"))
    .filter(([c, cur]) => /^[A-Z]{2}$/.test(c ?? "") && /^[A-Z]{3}$/.test(cur ?? "")));

/** Mobile money shoppers can expect on DPO's page, by country (shown at checkout). */
export const MOBILE_MONEY: Record<string, string[]> = {
  ZM: ["MTN MoMo", "Airtel Money", "Zamtel Kwacha"],
  KE: ["M-Pesa", "Airtel Money"], TZ: ["M-Pesa", "Tigo Pesa", "Airtel Money"], UG: ["MTN MoMo", "Airtel Money"],
  RW: ["MTN MoMo", "Airtel Money"], GH: ["MTN MoMo", "AirtelTigo Money", "Telecel Cash"], MW: ["Airtel Money", "TNM Mpamba"],
};

interface Account { key: string; token: string; serviceType: string }

function readAccount(key: string, suffix: string): Account | null {
  const token = process.env[`DPO_COMPANY_TOKEN${suffix}`]?.trim();
  const serviceType = process.env[`DPO_SERVICE_TYPE${suffix}`]?.trim();
  return token && serviceType ? { key, token, serviceType } : null;
}
const MAIN = "main";
function accountByKey(key: string | null | undefined): Account | null {
  return !key || key === MAIN ? readAccount(MAIN, "") : readAccount(key, `_${key}`);
}
const urlsSet = () => Boolean(PUBLIC_APP_URL && API_PUBLIC_URL);

/** How a delivery country pays through DPO, or null if DPO doesn't serve it. */
export function dpoPlanFor(country: string | null | undefined): { account: Account; currency: string; mobileMoney: boolean } | null {
  const cc = String(country ?? "ZA").toUpperCase();
  if (cc === "ZA" || !urlsSet()) return null;
  const local = LOCAL_CURRENCIES[cc];
  if (local) {
    const account = readAccount(cc, `_${cc}`) ?? readAccount(MAIN, "");
    return account ? { account, currency: local, mobileMoney: true } : null;
  }
  const account = readAccount(MAIN, "");
  return account ? { account, currency: DPO_CURRENCY, mobileMoney: false } : null;
}

/** Any DPO account is set up. */
export function isDpoConfigured(): boolean {
  return urlsSet() && (Boolean(readAccount(MAIN, "")) || Object.keys(LOCAL_CURRENCIES).some(cc => readAccount(cc, `_${cc}`)));
}

/** DPO is used for this delivery country (outside South Africa, with an account that serves it). */
export function usesDpo(country: string | null | undefined): boolean {
  return dpoPlanFor(country) !== null;
}

export const dpoPaymentPageUrl = (token: string) => `${PAY_URL}?ID=${encodeURIComponent(token)}`;

// ── XML helpers (DPO's API3G format is flat) ───────────────────────────────
const esc = (v: unknown) => String(v ?? "").replace(/[<>&'"]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]!));
const unesc = (v: string) => v.replace(/&lt;|&gt;|&amp;|&apos;|&quot;/g, e => ({ "&lt;": "<", "&gt;": ">", "&amp;": "&", "&apos;": "'", "&quot;": '"' }[e]!));
export function xmlField(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i"));
  return m ? unesc(m[1].trim()) : null;
}

async function call(account: Account, request: string, body: string): Promise<string> {
  const xml = `<?xml version="1.0" encoding="utf-8"?><API3G><CompanyToken>${esc(account.token)}</CompanyToken><Request>${request}</Request>${body}</API3G>`;
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

/** Units of `currency` per rand, from the FX table (rate_to_zar = rand per unit). */
async function perZar(currency: string): Promise<number | null> {
  if (!hasDb || !pool) return null;
  const { rows } = await pool.query(`SELECT rate_to_zar FROM mkt_fx_rates WHERE UPPER(currency) = $1`, [currency.toUpperCase()]);
  const rate = Number(rows[0]?.rate_to_zar);
  return rate > 0 ? 1 / rate : null;
}

/** Rand -> another currency, rounded up to the cent (never undercharge). */
export async function zarTo(currency: string, amountZar: number): Promise<number | null> {
  const r = await perZar(currency);
  return r === null ? null : Math.ceil(amountZar * r * 100) / 100;
}
export const zarToUsd = (amountZar: number) => zarTo(DPO_CURRENCY, amountZar);

/** What checkout needs to show DPO, per country. */
export async function dpoCheckoutInfo() {
  const international = urlsSet() && Boolean(readAccount(MAIN, ""));
  const local: Record<string, { currency: string; per1000Zar: number | null; mobileMoney: string[] }> = {};
  for (const [cc, currency] of Object.entries(LOCAL_CURRENCIES)) {
    if (!dpoPlanFor(cc)) continue;
    local[cc] = { currency, per1000Zar: await zarTo(currency, 1000), mobileMoney: MOBILE_MONEY[cc] ?? [] };
  }
  return {
    available: isDpoConfigured(), provider: "DPO Pay", currency: DPO_CURRENCY, international,
    usdPer1000Zar: international ? await zarToUsd(1000) : null, local,
  };
}

const dpoDate = (d = new Date()) => `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;

async function accountForToken(token: string): Promise<Account | null> {
  if (!hasDb || !pool) return accountByKey(MAIN);
  const { rows } = await pool.query(`SELECT processor_account FROM mkt_pay_transactions WHERE processor = 'dpo' AND processor_ref = $1 LIMIT 1`, [token]);
  return accountByKey(rows[0]?.processor_account ?? MAIN);
}

// ── Processor ──────────────────────────────────────────────────────────────
export const dpoProcessor: MktPayProcessor = {
  name: "dpo",
  isConfigured: isDpoConfigured,

  async submitPayment(req) {
    const d = (req.paymentDetails ?? {}) as { firstName?: string; lastName?: string; country?: string; phone?: string };
    const plan = dpoPlanFor(d.country);
    if (!plan) return { success: false, error: "Online payment isn't available for this delivery country yet." };
    const amount = await zarTo(plan.currency, req.amount);
    if (amount === null || amount <= 0) return { success: false, error: `No ${plan.currency} exchange rate on file — add one under Payouts > Manage FX rates.` };
    const body =
      `<Transaction>` +
      `<PaymentAmount>${amount.toFixed(2)}</PaymentAmount><PaymentCurrency>${plan.currency}</PaymentCurrency>` +
      `<CompanyRef>${esc(req.orderNumber)}</CompanyRef>` +
      `<RedirectURL>${esc(`${API_PUBLIC_URL}/api/marketplace/dpo/return`)}</RedirectURL>` +
      `<BackURL>${esc(`${PUBLIC_APP_URL}/?dpo=cancelled&order=${encodeURIComponent(req.orderNumber)}`)}</BackURL>` +
      `<CompanyRefUnique>1</CompanyRefUnique><PTL>${PAYMENT_TIME_LIMIT_HOURS}</PTL>` +
      (req.customerEmail ? `<customerEmail>${esc(req.customerEmail)}</customerEmail>` : "") +
      (d.firstName ? `<customerFirstName>${esc(d.firstName)}</customerFirstName>` : "") +
      (d.lastName ? `<customerLastName>${esc(d.lastName)}</customerLastName>` : "") +
      (d.country ? `<customerCountry>${esc(String(d.country).toUpperCase())}</customerCountry>` : "") +
      `<DefaultPayment>${plan.mobileMoney ? "MO" : "CC"}</DefaultPayment>` +
      `</Transaction>` +
      `<Services><Service><ServiceType>${esc(plan.account.serviceType)}</ServiceType>` +
      `<ServiceDescription>${esc(`Ballylife order ${req.orderNumber}`)}</ServiceDescription>` +
      `<ServiceDate>${dpoDate()}</ServiceDate></Service></Services>`;
    try {
      const xml = await call(plan.account, "createToken", body);
      const result = xmlField(xml, "Result");
      const token = xmlField(xml, "TransToken");
      if (result !== "000" || !token) {
        const why = xmlField(xml, "ResultExplanation") ?? "unknown error";
        logger.error("dpo.create_token_failed", { orderNumber: req.orderNumber, account: plan.account.key, currency: plan.currency, result, why });
        return { success: false, error: result === "940" ? "This order has already been paid." : "Couldn't start the payment — please try again." };
      }
      logger.info("dpo.token_created", { orderNumber: req.orderNumber, account: plan.account.key, amount, currency: plan.currency, transRef: xmlField(xml, "TransRef") });
      return { success: true, processorRef: token, chargedAmount: amount, chargedCurrency: plan.currency, processorAccount: plan.account.key };
    } catch (err) {
      logger.error("dpo.create_token_error", { orderNumber: req.orderNumber, error: err instanceof Error ? err.message : String(err) });
      return { success: false, error: "Couldn't reach the payment provider — please try again." };
    }
  },

  async verifyTransaction(token) {
    const account = await accountForToken(token);
    return account ? (await verifyDpoToken(token, account)).status : { status: "submitted", error: "DPO account not configured" };
  },

  async refund(token, amountZar) {
    // Refunds are in the currency charged: the same share of what was paid.
    if (!hasDb || !pool) return { success: false, error: "No database" };
    const { rows } = await pool.query(
      `SELECT t.charged_amount, t.charged_currency, t.processor_account, o.total_amount FROM mkt_pay_transactions t JOIN mkt_orders o ON o.id = t.order_id
       WHERE t.processor = 'dpo' AND t.processor_ref = $1 LIMIT 1`, [token]);
    const t = rows[0];
    const account = accountByKey(t?.processor_account);
    if (!t || !t.charged_amount) return { success: false, error: "DPO payment not found." };
    if (!account) return { success: false, error: "The DPO account for this payment isn't set up any more. Refund it from the DPO dashboard." };
    const paid = Number(t.charged_amount);
    const amount = amountZar === undefined ? paid : Math.min(paid, Math.round((paid * amountZar / Number(t.total_amount)) * 100) / 100);
    try {
      const xml = await call(account, "refundToken",
        `<TransactionToken>${esc(token)}</TransactionToken><refundAmount>${amount.toFixed(2)}</refundAmount><refundDetails>Ballylife refund</refundDetails>`);
      const result = xmlField(xml, "Result");
      if (result !== "000") {
        const why = xmlField(xml, "ResultExplanation") ?? "unknown";
        logger.warn("dpo.refund_failed", { result, why });
        return { success: false, error: `DPO didn't process the refund (${why}). Refund it from the DPO dashboard.` };
      }
      logger.info("dpo.refunded", { amount, currency: t.charged_currency, account: account.key });
      return { success: true, refundRef: `dpo_refund_${token}_${amount.toFixed(2)}_${t.charged_currency}` };
    } catch (err) {
      return { success: false, error: `Couldn't reach DPO (${err instanceof Error ? err.message : String(err)}). Refund it from the DPO dashboard.` };
    }
  },
};

export interface DpoVerification { status: VerifyResult; result: string | null; amount: number | null; currency: string | null; explanation: string | null }

export async function verifyDpoToken(token: string, account: Account): Promise<DpoVerification> {
  try {
    const xml = await call(account, "verifyToken", `<TransactionToken>${esc(token)}</TransactionToken>`);
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
  const account = accountByKey(tx.processor_account);
  if (!account) { logger.error("dpo.account_missing", { account: tx.processor_account }); return { orderNumber: tx.order_number, outcome: "pending" }; }

  const v = await verifyDpoToken(token, account);
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
      logger.info("dpo.payment_confirmed", { orderNumber: tx.order_number, amount: expected, currency: tx.charged_currency, account: account.key });
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
  logger.info("dpo.worker_started", { intervalMs, localCurrencies: LOCAL_CURRENCIES });
  return t;
}
