import { useState, useEffect, useCallback } from "react";
import { Banknote, Clock, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { mktCreditSelf, type MktAuthUser } from "../services/marketplaceApi";

type R = Record<string, unknown>;

const fmtZAR = (n: number) => `R${Number(n ?? 0).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface Props {
  user: MktAuthUser;
  credit: R;
  onSignOut: () => void;
}

// A credit provider's whole job here: decide whether to lend on each
// order a customer chose to pay for with this provider's BNPL plan.
// Approving is what actually moves the order out of pending_payment --
// there is no other path to confirmed for a BNPL order. Declining
// restocks the items, same as any other rejected payment.
export function CreditProviderDashboard({ user, credit, onSignOut }: Props) {
  const [orders, setOrders] = useState<R[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    mktCreditSelf.orders(String(credit.id)).then(res => {
      if (res.success) setOrders(res.data as R[]);
      setLoading(false);
    });
  }, [credit.id]);

  useEffect(() => { load(); }, [load]);

  const act = async (fn: () => Promise<unknown>, orderId: string) => {
    setBusyId(orderId);
    await fn();
    setBusyId(null);
    load();
  };

  const pending = orders.filter(o => o.creditDecision === "pending");
  const decided = orders.filter(o => o.creditDecision !== "pending");

  return (
    <div className="flex-1 flex min-h-0 overflow-hidden bg-[#EAEDED]">
      <aside className="w-56 shrink-0 bg-white border-r border-gray-100 p-3 overflow-y-auto flex flex-col">
        <div className="px-1 pb-3 mb-2 border-b border-gray-100">
          <p className="font-serif text-base text-gray-900 leading-tight" style={{ fontWeight: 600 }}>{String(credit.name)}</p>
          <p className="text-[11px] mt-1 text-gray-400">Buy-now-pay-later partner</p>
        </div>
        <div className="space-y-0.5 flex-1">
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-left text-sm font-medium" style={{ background: "#EAF7EE", color: "#0B5C2E" }}>
            <Banknote className="w-4 h-4" /><span>Lending Decisions</span>
          </div>
        </div>
        <button onClick={onSignOut} className="text-xs text-gray-400 hover:text-gray-700 px-3 py-2 text-left">Sign out</button>
      </aside>

      <div className="flex-1 overflow-y-auto p-5">
        {loading ? (
          <div className="flex items-center justify-center h-40"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
        ) : (
          <div>
            <p className="text-lg font-bold text-gray-900 mb-1">Welcome, {user.name}</p>
            <p className="text-sm text-gray-500 mb-5">Every order a customer chose to pay for with {String(credit.name)} lands here until you decide whether to lend.</p>

            <div className="bg-white rounded-xl border border-gray-100 overflow-hidden mb-5">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2"><Clock className="w-4 h-4 text-amber-500" /><span className="text-sm font-bold text-gray-900">Awaiting your decision ({pending.length})</span></div>
              {pending.map(o => (
                <div key={String(o.id)} className="flex items-center justify-between px-4 py-3 border-b border-gray-50 last:border-0">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900">{String(o.orderNumber)}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{String(o.customerName)} · {String(o.customerEmail)}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-sm font-bold" style={{ color: "#B8862E" }}>{fmtZAR(Number(o.totalAmount))}</span>
                    <button disabled={busyId === o.id} onClick={() => act(() => mktCreditSelf.decline(String(credit.id), String(o.id)), String(o.id))}
                      className="text-xs font-bold px-3 py-1.5 rounded-full border border-gray-200 text-gray-600 hover:border-red-300 hover:text-red-600 disabled:opacity-50">
                      Decline
                    </button>
                    <button disabled={busyId === o.id} onClick={() => act(() => mktCreditSelf.approve(String(credit.id), String(o.id)), String(o.id))}
                      className="text-xs font-bold px-3 py-1.5 rounded-full text-white disabled:opacity-50" style={{ background: "#0B5C2E" }}>
                      {busyId === o.id ? "…" : "Approve & Lend"}
                    </button>
                  </div>
                </div>
              ))}
              {!pending.length && <p className="px-4 py-6 text-center text-sm text-gray-400">No pending lending decisions right now.</p>}
            </div>

            {decided.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100"><span className="text-sm font-bold text-gray-900">Decision history</span></div>
                {decided.map(o => (
                  <div key={String(o.id)} className="flex items-center justify-between px-4 py-3 border-b border-gray-50 last:border-0">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900">{String(o.orderNumber)}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{String(o.customerName)}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-sm text-gray-600">{fmtZAR(Number(o.totalAmount))}</span>
                      {o.creditDecision === "approved" ? (
                        <span className="flex items-center gap-1 text-xs font-bold text-green-700"><CheckCircle2 className="w-3.5 h-3.5" />Approved</span>
                      ) : (
                        <span className="flex items-center gap-1 text-xs font-bold text-red-600"><XCircle className="w-3.5 h-3.5" />Declined</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
