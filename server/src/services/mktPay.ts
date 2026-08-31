import { randomUUID } from "crypto";
import { pool, hasDb } from "../db/pool";

/**
 * Marketplace's own payment engine — independent of VINK-GRUP-LIMITED's
 * VinkPay. Same discipline VinkPay uses: submitPayment() only ever means
 * "the processor accepted this for processing", never "the money
 * arrived" — payment_status only ever moves to "confirmed" through
 * handleWebhook() (a verified callback) or a reconciliation job actively
 * calling verifyTransaction(), never optimistically from the order
 * endpoint itself.
 *
 * Every call site in this backend talks to this interface, never to a
 * processor's SDK directly. Swapping/adding the real processor later
 * means writing one object that implements MktPayProcessor and adding it
 * to PROCESSORS below — nothing in the order flow needs to change.
 *
 * Ships with one processor, "manual" — records the charge and leaves it
 * pending until someone confirms it was actually paid (bank transfer /
 * cash-on-delivery style). This is a placeholder, not a real payment
 * gateway: wire up Stripe / Paystack / Flutterwave / PayFast (or
 * whichever processor you choose) as a second MktPayProcessor before
 * taking real payments.
 */

export type PaymentStatus = "submitted" | "confirmed" | "failed";

export interface ChargeRequest {
  orderId: string;
  orderNumber: string;
  amount: number;
  currency: string;
  paymentMethod: string;
  customerEmail: string;
  paymentDetails?: Record<string, unknown>;
}

export interface SubmitResult {
  success: boolean;
  processorRef?: string;
  error?: string;
}

export interface VerifyResult {
  status: PaymentStatus;
  error?: string;
}

export interface RefundResult {
  success: boolean;
  refundRef?: string;
  error?: string;
}

export interface MktPayProcessor {
  name: string;
  isConfigured(): boolean;
  submitPayment(req: ChargeRequest): Promise<SubmitResult>;
  verifyTransaction(processorRef: string): Promise<VerifyResult>;
  refund(processorRef: string, amount?: number): Promise<RefundResult>;
}

// ── "manual" processor — accepts any charge, marks it pending confirmation ─
const manualProcessor: MktPayProcessor = {
  name: "manual",
  isConfigured: () => true,
  async submitPayment(req) {
    return { success: true, processorRef: `manual_${randomUUID()}` };
  },
  async verifyTransaction() {
    // Manual processor never auto-confirms — someone with admin access
    // must mark the order's payment as received (bank statement, EFT
    // proof, etc.). Replace with a real gateway's webhook-driven
    // verification once one is configured.
    return { status: "submitted" };
  },
  async refund() {
    return { success: false, error: "Manual processor does not support automated refunds — refund outside the system and update the order manually." };
  },
};

const PROCESSORS: Record<string, MktPayProcessor> = {
  card: manualProcessor,
  bank_transfer: manualProcessor,
  wallet: manualProcessor,
  // Add real processors here, e.g.:
  // card: stripeProcessor,
};

async function recordSubmission(req: ChargeRequest, processorName: string, result: SubmitResult): Promise<string | undefined> {
  if (!hasDb || !pool) return undefined;
  const { rows } = await pool.query(
    `INSERT INTO mkt_pay_transactions (order_id, processor, payment_method, amount, currency, status, processor_ref, error_message)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [req.orderId, processorName, req.paymentMethod, req.amount, req.currency,
     result.success ? "submitted" : "failed", result.processorRef ?? null, result.error ?? null]
  );
  return rows[0]?.id;
}

export interface SubmitOrderPaymentResult {
  accepted: boolean;
  mktPayTransactionId?: string;
  error?: string;
}

export async function submitOrderPayment(req: ChargeRequest): Promise<SubmitOrderPaymentResult> {
  const processor = PROCESSORS[req.paymentMethod];
  if (!processor) return { accepted: false, error: `No processor configured for payment method: ${req.paymentMethod}` };
  if (!processor.isConfigured()) {
    const txId = await recordSubmission(req, processor.name, { success: false, error: `${processor.name} is not configured` });
    return { accepted: false, mktPayTransactionId: txId, error: `${processor.name} is not configured.` };
  }

  const result = await processor.submitPayment(req);
  const txId = await recordSubmission(req, processor.name, result);

  if (!result.success) return { accepted: false, mktPayTransactionId: txId, error: result.error };
  return { accepted: true, mktPayTransactionId: txId };
}

export async function getOrderTransactions(orderId: string) {
  if (!hasDb || !pool) return [];
  const { rows } = await pool.query(
    `SELECT id, processor, payment_method, amount, currency, status, processor_ref, error_message, webhook_received_at, created_at
     FROM mkt_pay_transactions WHERE order_id = $1 ORDER BY created_at DESC`,
    [orderId]
  );
  return rows;
}

export async function refundOrder(processorName: string, processorRef: string, amount?: number): Promise<RefundResult> {
  const processor = PROCESSORS[processorName] ?? Object.values(PROCESSORS).find(p => p.name === processorName);
  if (!processor) return { success: false, error: `Unknown processor: ${processorName}` };
  return processor.refund(processorRef, amount);
}
