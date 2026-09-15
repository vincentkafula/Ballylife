import { useState, useEffect, useCallback } from "react";
import { Truck, Package, CheckCircle2, Loader2, PenLine } from "lucide-react";
import { mktShippingSelf, type MktAuthUser } from "../services/marketplaceApi";

type R = Record<string, unknown>;

const fmtZAR = (n: number) => `R${Number(n ?? 0).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface Props {
  user: MktAuthUser;
  shipping: R;
  onSignOut: () => void;
}

// A shipping company's whole job here: claim a confirmed order out of the
// open pool, mark it picked up, and close it out with a real delivery
// signature -- never anything about payment or pricing, which stay with
// the credit provider and the platform respectively.
export function ShippingCompanyDashboard({ user, shipping, onSignOut }: Props) {
  const [orders, setOrders] = useState<R[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [signing, setSigning] = useState<string | null>(null);
  const [signedByInput, setSignedByInput] = useState("");

  const load = useCallback(() => {
    mktShippingSelf.orders(String(shipping.id)).then(res => {
      if (res.success) setOrders(res.data as R[]);
      setLoading(false);
    });
  }, [shipping.id]);

  useEffect(() => { load(); }, [load]);

  const act = async (fn: () => Promise<unknown>, orderId: string) => {
    setBusyId(orderId);
    await fn();
    setBusyId(null);
    load();
  };

  const available = orders.filter(o => !o.shippingCompanyId);
  const claimed = orders.filter(o => o.shippingCompanyId && o.shippingStatus !== "delivered");
  const delivered = orders.filter(o => o.shippingStatus === "delivered");

  const OrderRow = ({ o, action }: { o: R; action: React.ReactNode }) => (
    <div className="flex items-center justify-between px-4 py-3 border-b border-gray-50 last:border-0">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-gray-900">{String(o.orderNumber)}</p>
        <p className="text-xs text-gray-500 mt-0.5">{String(o.customerName)} · {String((o.shippingAddress as R)?.city ?? "")}, {String((o.shippingAddress as R)?.country ?? "")}</p>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <span className="text-sm font-bold text-gray-700">{fmtZAR(Number(o.totalAmount))}</span>
        {action}
      </div>
    </div>
  );

  return (
    <div className="flex-1 flex min-h-0 overflow-hidden bg-[#EAEDED]">
      <aside className="w-56 shrink-0 bg-white border-r border-gray-100 p-3 overflow-y-auto flex flex-col">
        <div className="px-1 pb-3 mb-2 border-b border-gray-100">
          <p className="font-serif text-base text-gray-900 leading-tight" style={{ fontWeight: 600 }}>{String(shipping.name)}</p>
          <p className="text-[11px] mt-1 text-gray-400">Fulfilment partner</p>
        </div>
        <div className="space-y-0.5 flex-1">
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-left text-sm font-medium" style={{ background: "#EAF7EE", color: "#0B5C2E" }}>
            <Truck className="w-4 h-4" /><span>Deliveries</span>
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
            <p className="text-sm text-gray-500 mb-5">Claim a confirmed order, mark it picked up, then close it out with a real delivery signature.</p>

            <div className="bg-white rounded-xl border border-gray-100 overflow-hidden mb-5">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2"><Package className="w-4 h-4 text-gray-400" /><span className="text-sm font-bold text-gray-900">Available to claim ({available.length})</span></div>
              {available.map(o => (
                <OrderRow key={String(o.id)} o={o} action={
                  <button disabled={busyId === o.id} onClick={() => act(() => mktShippingSelf.claim(String(shipping.id), String(o.id)), String(o.id))}
                    className="text-xs font-bold px-3 py-1.5 rounded-full text-white disabled:opacity-50" style={{ background: "#0B5C2E" }}>
                    {busyId === o.id ? "Claiming…" : "Claim"}
                  </button>
                } />
              ))}
              {!available.length && <p className="px-4 py-6 text-center text-sm text-gray-400">No confirmed orders waiting to be claimed right now.</p>}
            </div>

            <div className="bg-white rounded-xl border border-gray-100 overflow-hidden mb-5">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2"><Truck className="w-4 h-4 text-gray-400" /><span className="text-sm font-bold text-gray-900">My deliveries in progress ({claimed.length})</span></div>
              {claimed.map(o => (
                <div key={String(o.id)}>
                  <OrderRow o={o} action={
                    o.shippingStatus === "picked_up" ? (
                      signing === o.id ? (
                        <div className="flex items-center gap-1.5">
                          <input value={signedByInput} onChange={e => setSignedByInput(e.target.value)} placeholder="Recipient name"
                            className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 w-28" />
                          <button disabled={!signedByInput.trim() || busyId === o.id}
                            onClick={() => { act(() => mktShippingSelf.deliver(String(shipping.id), String(o.id), signedByInput), String(o.id)); setSigning(null); setSignedByInput(""); }}
                            className="text-xs font-bold px-3 py-1.5 rounded-full text-white disabled:opacity-50" style={{ background: "#0B5C2E" }}>Confirm</button>
                        </div>
                      ) : (
                        <button onClick={() => setSigning(String(o.id))} className="flex items-center gap-1 text-xs font-bold px-3 py-1.5 rounded-full text-white" style={{ background: "#B8862E" }}>
                          <PenLine className="w-3 h-3" />Deliver
                        </button>
                      )
                    ) : (
                      <button disabled={busyId === o.id} onClick={() => act(() => mktShippingSelf.pickup(String(shipping.id), String(o.id)), String(o.id))}
                        className="text-xs font-bold px-3 py-1.5 rounded-full text-white disabled:opacity-50" style={{ background: "#B8862E" }}>
                        {busyId === o.id ? "…" : "Mark Picked Up"}
                      </button>
                    )
                  } />
                </div>
              ))}
              {!claimed.length && <p className="px-4 py-6 text-center text-sm text-gray-400">Nothing claimed yet — claim an order above to start.</p>}
            </div>

            {delivered.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-gray-400" /><span className="text-sm font-bold text-gray-900">Delivered ({delivered.length})</span></div>
                {delivered.map(o => (
                  <OrderRow key={String(o.id)} o={o} action={
                    <span className="text-xs text-gray-500">Signed by <strong className="text-gray-700">{String(o.deliverySignedBy)}</strong></span>
                  } />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
