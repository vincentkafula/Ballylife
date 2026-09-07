import { useState } from "react";
import { Search, Package, Truck, CheckCircle, Clock, MapPin, Loader2 } from "lucide-react";
import { mktOrders } from "../services/marketplaceApi";

type R = Record<string, unknown>;

const ORDER_STAGES = ["pending", "confirmed", "processing", "shipped", "delivered"];

const PIPELINE_STAGE_META: Record<string, { label: string; color: string }> = {
  ordered_from_supplier: { label: "Ordered from supplier", color: "#6B7280" },
  received_at_origin_hub: { label: "Received at origin hub", color: "#2563EB" },
  qc_passed_origin: { label: "Quality check passed", color: "#2563EB" },
  qc_failed_origin: { label: "Under review", color: "#DC2626" },
  refunded: { label: "Refunded", color: "#DC2626" },
  in_transit_to_destination: { label: "In transit", color: "#B8862E" },
  received_at_destination_hub: { label: "Arrived in-country", color: "#B8862E" },
  customs_cleared: { label: "Customs cleared", color: "#059669" },
  shipped_to_customer: { label: "Out for delivery", color: "#059669" },
  delivered: { label: "Delivered", color: "#10B981" },
};

function StageStep({ label, active, done, icon }: { label: string; active: boolean; done: boolean; icon: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center flex-1">
      <div className="w-10 h-10 rounded-full flex items-center justify-center mb-1.5"
        style={{ background: done || active ? "#B8862E" : "#F3F4F6", color: done || active ? "white" : "#9CA3AF" }}>
        {icon}
      </div>
      <span className="text-[11px] text-center font-medium" style={{ color: done || active ? "#14110D" : "#9CA3AF" }}>{label}</span>
    </div>
  );
}

export function OrderTracking({ onBack }: { onBack: () => void }) {
  const [orderNumber, setOrderNumber] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<R | null>(null);

  const search = async () => {
    if (!orderNumber.trim() || !email.trim()) { setError("Enter both your order number and the email you ordered with."); return; }
    setLoading(true);
    setError(null);
    setOrder(null);
    const res = await mktOrders.track(orderNumber.trim(), email.trim());
    setLoading(false);
    if (!res.success) { setError(res.error ?? "No order found with that order number and email."); return; }
    setOrder(res.data as R);
  };

  const stageIndex = order ? Math.max(0, ORDER_STAGES.indexOf(String(order.status))) : -1;
  const items = (order?.items as R[]) ?? [];
  const importedItems = (order?.importedItems as R[]) ?? [];

  return (
    <div className="max-w-2xl mx-auto px-4 py-10">
      <button onClick={onBack} className="text-sm text-gray-500 hover:text-gray-800 mb-4">← Back to shopping</button>
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Track your order</h1>
      <p className="text-sm text-gray-500 mb-6">Enter your order number and the email address you ordered with.</p>

      <div className="bg-white rounded-xl border border-gray-100 p-4 flex flex-col sm:flex-row gap-2 mb-4">
        <input placeholder="Order number (e.g. VNK-ORD-100003)" value={orderNumber} onChange={e => setOrderNumber(e.target.value)}
          className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm" />
        <input placeholder="Email address" value={email} onChange={e => setEmail(e.target.value)}
          className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm" />
        <button onClick={search} disabled={loading} className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-white text-sm font-semibold disabled:opacity-50" style={{ background: "#14110D" }}>
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />} Track
        </button>
      </div>

      {error && <div className="mb-4 text-sm font-medium px-4 py-3 rounded-lg bg-red-50 text-red-700 border border-red-200">{error}</div>}

      {order && (
        <div>
          <div className="bg-white rounded-xl border border-gray-100 p-5 mb-4">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-sm font-bold text-gray-900">{String(order.orderNumber)}</p>
                <p className="text-xs text-gray-400">Placed {new Date(String(order.placedAt)).toLocaleDateString()}</p>
              </div>
              <span className="text-xs font-semibold px-3 py-1 rounded-full capitalize" style={{ background: "#EAF7EE", color: "#0B5C2E" }}>{String(order.status).replace(/_/g, " ")}</span>
            </div>

            {String(order.status) !== "cancelled" && (
              <div className="flex items-start mb-2">
                <StageStep label="Placed" done={stageIndex >= 0} active={stageIndex === 0} icon={<Clock className="w-4 h-4" />} />
                <StageStep label="Confirmed" done={stageIndex >= 1} active={stageIndex === 1} icon={<CheckCircle className="w-4 h-4" />} />
                <StageStep label="Processing" done={stageIndex >= 2} active={stageIndex === 2} icon={<Package className="w-4 h-4" />} />
                <StageStep label="Shipped" done={stageIndex >= 3} active={stageIndex === 3} icon={<Truck className="w-4 h-4" />} />
                <StageStep label="Delivered" done={stageIndex >= 4} active={stageIndex === 4} icon={<MapPin className="w-4 h-4" />} />
              </div>
            )}

            <div className="grid sm:grid-cols-2 gap-3 mt-5 pt-4 border-t border-gray-50 text-sm">
              <div><span className="text-gray-400">Total</span><p className="font-semibold text-gray-800">R{Number(order.totalAmount).toFixed(2)}</p></div>
              <div><span className="text-gray-400">Estimated delivery</span><p className="font-semibold text-gray-800">{order.estimatedDelivery ? new Date(String(order.estimatedDelivery)).toLocaleDateString() : "—"}</p></div>
              {order.trackingNumber ? (<div><span className="text-gray-400">Tracking number</span><p className="font-semibold text-gray-800">{String(order.trackingNumber)}</p></div>) : null}
              {order.carrier ? (<div><span className="text-gray-400">Carrier</span><p className="font-semibold text-gray-800">{String(order.carrier)}</p></div>) : null}
            </div>
          </div>

          {importedItems.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-100 overflow-hidden mb-4">
              <div className="px-4 py-3 border-b border-gray-100"><span className="text-sm font-bold text-gray-900">Imported items — international shipping pipeline</span></div>
              {importedItems.map((it, i) => {
                const meta = PIPELINE_STAGE_META[String(it.status)] ?? { label: String(it.status).replace(/_/g, " "), color: "#6B7280" };
                return (
                  <div key={i} className="flex items-center justify-between px-4 py-3 border-b border-gray-50 last:border-0">
                    <span className="text-sm text-gray-700">{String(it.emoji ?? "📦")} {String(it.productName)} × {String(it.quantity)}</span>
                    <span className="text-xs font-semibold px-2.5 py-1 rounded-full" style={{ color: meta.color, background: `${meta.color}15` }}>{meta.label}</span>
                  </div>
                );
              })}
            </div>
          )}

          {items.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100"><span className="text-sm font-bold text-gray-900">Items in this order</span></div>
              {items.map((it, i) => (
                <div key={i} className="flex items-center justify-between px-4 py-2.5 border-b border-gray-50 last:border-0 text-sm">
                  <span className="text-gray-700">{String(it.name ?? it.productName ?? "Item")} × {String(it.quantity ?? 1)}</span>
                  <span className="text-gray-500">R{Number(it.price ?? 0).toFixed(2)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
