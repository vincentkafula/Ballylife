/**
 * Card-scheme marks and payment panels shared by the cart and checkout.
 *
 * Ballylife never collects card numbers: shoppers enter them on PayFast's
 * hosted, PCI DSS Level 1 payment page (our scope is SAQ-A). These panels
 * explain that plainly instead of showing card inputs that went nowhere.
 */
import { Lock, ShieldCheck } from "lucide-react";

export function VisaMark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center justify-center h-6 px-2 rounded border border-gray-200 bg-white ${className}`} aria-label="Visa" role="img">
      <svg viewBox="0 0 48 16" className="h-3" aria-hidden="true">
        <text x="0" y="14" fontFamily="Arial, Helvetica, sans-serif" fontSize="17" fontWeight="900" fontStyle="italic" fill="#1A1F71" letterSpacing="-0.5">VISA</text>
      </svg>
    </span>
  );
}

export function MastercardMark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center justify-center h-6 px-1.5 rounded border border-gray-200 bg-white ${className}`} aria-label="Mastercard" role="img">
      <svg viewBox="0 0 32 20" className="h-4" aria-hidden="true">
        <circle cx="12" cy="10" r="8" fill="#EB001B" />
        <circle cx="20" cy="10" r="8" fill="#F79E1B" />
        <path d="M16 3.07a8 8 0 0 1 0 13.86 8 8 0 0 1 0-13.86z" fill="#FF5F00" />
      </svg>
    </span>
  );
}

export function CardSchemeMarks({ className = "" }: { className?: string }) {
  return <span className={`inline-flex items-center gap-1.5 ${className}`}><VisaMark /><MastercardMark /></span>;
}

export interface PaymentMethodsInfo {
  card: { available: boolean; provider: string; sandbox: boolean };
  eft: { available: boolean; details: EftDetails | null };
  bnpl: { available: boolean; providers: { key: string; name: string }[] };
}

export interface EftDetails { bankName: string; accountName: string; accountNumber: string; branchCode: string; accountType: string }

/** What happens when paying by card -- shown in place of card inputs. */
export function CardPaymentPanel({ sandbox }: { sandbox: boolean }) {
  return (
    <div className="bg-white rounded-2xl p-4 border border-gray-100 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-gray-900">Credit or debit card</p>
        <CardSchemeMarks />
      </div>
      <ol className="space-y-2 text-xs text-gray-600">
        {[
          "Place your order — you'll go straight to PayFast's secure payment page.",
          "Enter your card details there. Your bank may ask you to approve the payment (3-D Secure).",
          "You'll come back here, and we'll confirm your order as soon as the payment clears.",
        ].map((t, i) => (
          <li key={i} className="flex gap-2.5">
            <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0" style={{ background: "#B8862E" }}>{i + 1}</span>
            <span className="pt-0.5">{t}</span>
          </li>
        ))}
      </ol>
      <div className="flex items-start gap-2 rounded-xl bg-gray-50 px-3 py-2.5 text-[11px] text-gray-600">
        <Lock className="w-3.5 h-3.5 mt-0.5 shrink-0 text-emerald-700" />
        <span>Payments are processed by PayFast, a PCI DSS Level 1 certified payment gateway. Ballylife never sees or stores your card number.</span>
      </div>
      {sandbox && (
        <p className="text-[11px] font-semibold text-amber-700 bg-amber-50 rounded-lg px-3 py-2">Test mode: payments go to PayFast's sandbox — no real money is charged.</p>
      )}
    </div>
  );
}

export function EftDetailsTable({ details, reference }: { details: EftDetails; reference?: string }) {
  const rows: [string, string][] = [
    ["Bank", details.bankName],
    ["Account name", details.accountName],
    ["Account number", details.accountNumber],
    ["Branch code", details.branchCode],
    ["Account type", details.accountType],
    ["Reference", reference ?? "Your order number (shown after you place the order)"],
  ];
  return (
    <div className="rounded-xl border border-gray-100 overflow-hidden text-left">
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-3 px-3.5 py-2 text-sm border-b border-gray-50 last:border-0">
          <span className="text-gray-500">{k}</span>
          <span className={`font-semibold text-right ${k === "Reference" && reference ? "text-[#8A6420]" : "text-gray-900"}`}>{v}</span>
        </div>
      ))}
    </div>
  );
}

export function SecureCheckoutNote() {
  return (
    <p className="text-center text-[10px] text-gray-500 mt-1 flex items-center justify-center gap-1">
      <ShieldCheck className="w-3 h-3" />Card payments are processed securely by PayFast
    </p>
  );
}
