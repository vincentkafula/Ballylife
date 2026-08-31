import { useState, useEffect, useCallback } from "react";
import {
  Package, Heart, MapPin, CreditCard, RotateCcw, Bell, Star, MessageSquare,
  Shield, BarChart3, Plus, Trash2, Loader2, CheckCircle, Truck, Clock, XCircle,
  ChevronRight, Award,
} from "lucide-react";
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import {
  mktCustomer, mktOrders, mktAddresses, mktAddAddress, mktDeleteAddress, mktAuth, type MktAuthUser,
} from "../services/marketplaceApi";
import { formatZAR, useCurrency } from "../services/currencyStore";

type R = Record<string, unknown>;
type Tab = "overview" | "orders" | "addresses" | "payment" | "returns" | "notifications" | "security" | "analytics";

const fmtZAR = formatZAR; // now converts + formats in the shopper's local currency
const PIE_COLORS = ["#128A43", "#FF9900", "#10B981", "#34A853", "#EF4444", "#F59E0B"];

const STATUS_META: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  pending:      { label: "Pending",    color: "#9CA3AF", icon: <Clock className="w-3.5 h-3.5" /> },
  confirmed:    { label: "Confirmed",  color: "#34A853", icon: <CheckCircle className="w-3.5 h-3.5" /> },
  processing:   { label: "Processing", color: "#F59E0B", icon: <Clock className="w-3.5 h-3.5" /> },
  shipped:      { label: "Shipped",    color: "#3B82F6", icon: <Truck className="w-3.5 h-3.5" /> },
  delivered:    { label: "Delivered",  color: "#10B981", icon: <CheckCircle className="w-3.5 h-3.5" /> },
  cancelled:    { label: "Cancelled",  color: "#EF4444", icon: <XCircle className="w-3.5 h-3.5" /> },
  return_requested: { label: "Return requested", color: "#F59E0B", icon: <RotateCcw className="w-3.5 h-3.5" /> },
  returned:     { label: "Returned",   color: "#6B7280", icon: <RotateCcw className="w-3.5 h-3.5" /> },
  refunded:     { label: "Refunded",   color: "#6B7280", icon: <RotateCcw className="w-3.5 h-3.5" /> },
};

function StatCard({ label, value, icon, accent }: { label: string; value: string | number; icon: React.ReactNode; accent: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4 flex items-center gap-3">
      <span className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ background: `${accent}15`, color: accent }}>{icon}</span>
      <div>
        <p className="text-xl font-black text-gray-900 leading-none">{value}</p>
        <p className="text-[11px] text-gray-500 mt-1">{label}</p>
      </div>
    </div>
  );
}

function SideNavButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button onClick={onClick}
      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left text-sm font-medium transition-colors"
      style={{ background: active ? "#FFF4E5" : "transparent", color: active ? "#B75C00" : "#374151" }}>
      {icon}<span>{label}</span>
    </button>
  );
}

interface Props {
  user: MktAuthUser;
  onProduct: (id: string) => void;
  onSignOut: () => void;
}

export function CustomerDashboard({ user, onProduct, onSignOut }: Props) {
  useCurrency(); // subscribes this tree to live currency/rate updates
  const [tab, setTab] = useState<Tab>("overview");
  const [stats, setStats] = useState<R | null>(null);
  const [spending, setSpending] = useState<R | null>(null);
  const [orders, setOrders] = useState<R[]>([]);
  const [addresses, setAddresses] = useState<R[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [statsRes, spendRes, ordersRes, addrRes] = await Promise.allSettled([
      mktCustomer.stats(user.id), mktCustomer.spending(user.id), mktOrders.list({ userId: user.id }), mktAddresses(user.id),
    ]);
    if (statsRes.status === "fulfilled") setStats(statsRes.value.data as R);
    if (spendRes.status === "fulfilled") setSpending(spendRes.value.data as R);
    if (ordersRes.status === "fulfilled") setOrders(ordersRes.value.data as R[]);
    if (addrRes.status === "fulfilled") setAddresses(addrRes.value.data as R[]);
    setLoading(false);
  }, [user.id]);

  useEffect(() => { load(); }, [load]);

  const orderCounts = (stats?.orderCounts as R) ?? { inProgress: 0, delivered: 0, cancelled: 0, returned: 0 };
  const recentOrders = (stats?.recentOrders as R[]) ?? [];
  const returnsOrders = orders.filter(o => ["return_requested", "returned", "refunded"].includes(String(o.status)));

  const notifications = orders.slice(0, 6).map(o => {
    const s = String(o.status);
    const text = s === "delivered" ? `Order ${o.orderNumber} was delivered`
      : s === "shipped" ? `Order ${o.orderNumber} has shipped`
      : s === "cancelled" ? `Order ${o.orderNumber} was cancelled`
      : `Order ${o.orderNumber} is ${STATUS_META[s]?.label.toLowerCase() ?? s}`;
    return { id: o.id, text, at: o.placedAt };
  });

  const NAV: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "overview", label: "Overview", icon: <BarChart3 className="w-4 h-4" /> },
    { id: "orders", label: "Orders", icon: <Package className="w-4 h-4" /> },
    { id: "addresses", label: "Address Book", icon: <MapPin className="w-4 h-4" /> },
    { id: "payment", label: "Payment Methods", icon: <CreditCard className="w-4 h-4" /> },
    { id: "returns", label: "Returns & Refunds", icon: <RotateCcw className="w-4 h-4" /> },
    { id: "notifications", label: "Notifications", icon: <Bell className="w-4 h-4" /> },
    { id: "security", label: "Security", icon: <Shield className="w-4 h-4" /> },
    { id: "analytics", label: "Spending Analytics", icon: <BarChart3 className="w-4 h-4" /> },
  ];

  return (
    <div className="flex-1 flex min-h-0 overflow-hidden bg-[#EAEDED]">
      <aside className="w-56 shrink-0 bg-white border-r border-gray-100 p-3 overflow-y-auto flex flex-col">
        <div className="px-1 pb-3 mb-2 border-b border-gray-100">
          <p className="text-sm font-bold text-gray-900">{user.name}</p>
          <p className="text-[11px] text-gray-400">{String(stats?.membership ?? "Standard")} Member</p>
        </div>
        <div className="space-y-0.5 flex-1">
          {NAV.map(n => <SideNavButton key={n.id} active={tab === n.id} onClick={() => setTab(n.id)} icon={n.icon} label={n.label} />)}
        </div>
        <button onClick={onSignOut} className="text-xs text-gray-400 hover:text-gray-700 px-3 py-2 text-left">Sign out</button>
      </aside>

      <div className="flex-1 overflow-y-auto p-5">
        {loading ? (
          <div className="flex items-center justify-center h-40"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
        ) : (
          <>
            {tab === "overview" && (
              <div>
                <div className="bg-white rounded-xl border border-gray-100 p-5 mb-5 flex items-center justify-between flex-wrap gap-4">
                  <div>
                    <p className="text-xl font-black text-gray-900">Welcome, {user.name.split(" ")[0]}</p>
                    <p className="text-sm text-gray-500 mt-0.5">{String(stats?.membership ?? "Standard")} Member</p>
                  </div>
                  <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-[#FFF4E5]">
                    <Award className="w-4 h-4" style={{ color: "#FF9900" }} />
                    <span className="text-sm font-bold text-[#B75C00]">{String(stats?.rewardPoints ?? 0)} reward points</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
                  <StatCard label="Orders in progress" value={String(orderCounts.inProgress)} icon={<Clock className="w-5 h-5" />} accent="#F59E0B" />
                  <StatCard label="Delivered" value={String(orderCounts.delivered)} icon={<CheckCircle className="w-5 h-5" />} accent="#10B981" />
                  <StatCard label="Returns" value={String(orderCounts.returned)} icon={<RotateCcw className="w-5 h-5" />} accent="#34A853" />
                  <StatCard label="Cancelled" value={String(orderCounts.cancelled)} icon={<XCircle className="w-5 h-5" />} accent="#EF4444" />
                </div>

                <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                  <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                    <span className="text-sm font-bold text-gray-900">Recent Orders</span>
                    <button onClick={() => setTab("orders")} className="text-xs font-semibold" style={{ color: "#128A43" }}>View all</button>
                  </div>
                  {recentOrders.length === 0 ? (
                    <p className="text-sm text-gray-400 p-6 text-center">No orders yet — start shopping to see them here.</p>
                  ) : recentOrders.map((o, i) => (
                    <div key={i} className="flex items-center justify-between px-4 py-3 border-b border-gray-50 last:border-0">
                      <div>
                        <p className="text-sm font-semibold text-gray-900">{String(o.orderNumber)}</p>
                        <p className="text-[11px] text-gray-400">{new Date(String(o.placedAt)).toLocaleDateString()}</p>
                      </div>
                      <span className="text-sm font-bold text-gray-700">{fmtZAR(Number(o.totalAmount))}</span>
                      <span className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full" style={{ color: STATUS_META[String(o.status)]?.color, background: `${STATUS_META[String(o.status)]?.color}15` }}>
                        {STATUS_META[String(o.status)]?.icon} {STATUS_META[String(o.status)]?.label ?? String(o.status)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {tab === "orders" && (
              <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100"><span className="text-sm font-bold text-gray-900">All Orders</span></div>
                {orders.length === 0 ? <p className="text-sm text-gray-400 p-6 text-center">No orders yet.</p> : (
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-[11px] text-gray-400 border-b border-gray-100">
                      <th className="px-4 py-2 font-medium">Order</th><th className="px-4 py-2 font-medium">Date</th>
                      <th className="px-4 py-2 font-medium">Items</th><th className="px-4 py-2 font-medium">Amount</th>
                      <th className="px-4 py-2 font-medium">Status</th><th className="px-4 py-2 font-medium">Actions</th>
                    </tr></thead>
                    <tbody>
                      {orders.map((o, i) => (
                        <OrderRow key={i} order={o} onChanged={load} />
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {tab === "addresses" && <AddressBook userId={user.id} addresses={addresses} onChanged={load} />}
            {tab === "payment" && <PaymentMethodsPanel />}

            {tab === "returns" && (
              <div className="bg-white rounded-xl border border-gray-100 p-5">
                <p className="text-sm font-bold text-gray-900 mb-4">Returns & Refunds</p>
                {returnsOrders.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-6">No returns or refund requests.</p>
                ) : returnsOrders.map((o, i) => (
                  <div key={i} className="mb-4 last:mb-0 border border-gray-100 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-sm font-semibold text-gray-900">{String(o.orderNumber)}</span>
                      <span className="text-xs font-semibold" style={{ color: STATUS_META[String(o.status)]?.color }}>{STATUS_META[String(o.status)]?.label}</span>
                    </div>
                    <div className="flex items-center gap-1 text-[11px] text-gray-400">
                      {["Request Submitted", "Seller Approved", "Courier Pickup", "Refund Processing", "Completed"].map((step, si) => (
                        <span key={step} className="flex items-center gap-1">
                          <span className="px-2 py-1 rounded-full" style={{ background: si === 0 ? "#FFF4E5" : "#F3F4F6", color: si === 0 ? "#B75C00" : "#9CA3AF" }}>{step}</span>
                          {si < 4 && <ChevronRight className="w-3 h-3" />}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {tab === "notifications" && (
              <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100"><span className="text-sm font-bold text-gray-900">Notifications</span></div>
                {notifications.length === 0 ? <p className="text-sm text-gray-400 p-6 text-center">Nothing yet — order activity will show up here.</p> : notifications.map((n, i) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-3 border-b border-gray-50 last:border-0">
                    <Bell className="w-4 h-4 text-gray-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-800">{n.text}</p>
                      <p className="text-[11px] text-gray-400">{new Date(String(n.at)).toLocaleString()}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {tab === "security" && <SecurityPanel />}
            {tab === "analytics" && <SpendingAnalytics spending={spending} />}
          </>
        )}
      </div>
    </div>
  );
}

const CANCELLABLE = ["pending", "confirmed", "processing"];

function downloadInvoice(o: R) {
  const items = o.items as R[];
  const addr = o.shippingAddress as R;
  const lines = [
    `BALLYLIFE — INVOICE`,
    `Order: ${o.orderNumber}`,
    `Placed: ${new Date(String(o.placedAt)).toLocaleString()}`,
    `Status: ${o.status}`,
    ``,
    `Ship to: ${addr?.firstName ?? ""} ${addr?.lastName ?? ""}`,
    `${addr?.line1 ?? ""}, ${addr?.city ?? ""} ${addr?.postalCode ?? ""}`,
    ``,
    `Items:`,
    ...items.map(i => `  ${i.quantity}x ${i.productName}  —  ${fmtZAR(Number(i.totalPrice))}`),
    ``,
    `Subtotal:   ${fmtZAR(Number(o.subtotal))}`,
    `Shipping:   ${fmtZAR(Number(o.shippingCost))}`,
    `Tax:        ${fmtZAR(Number(o.taxAmount))}`,
    Number(o.discountAmount) > 0 ? `Discount:  -${fmtZAR(Number(o.discountAmount))}` : "",
    `Total:      ${fmtZAR(Number(o.totalAmount))}`,
  ].filter(Boolean).join("\n");
  const blob = new Blob([lines], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `${o.orderNumber}-invoice.txt`; a.click();
  URL.revokeObjectURL(url);
}

function OrderRow({ order, onChanged }: { order: R; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [showReturnForm, setShowReturnForm] = useState(false);
  const [reason, setReason] = useState("");
  const status = String(order.status);

  const cancel = async () => {
    if (!confirm("Cancel this order? This can't be undone.")) return;
    setBusy(true);
    const r = await mktOrders.cancel(String(order.id));
    setBusy(false);
    if (!r.success) alert(r.error ?? "Could not cancel order.");
    onChanged();
  };

  const submitReturn = async () => {
    setBusy(true);
    const r = await mktOrders.requestReturn(String(order.id), reason || "No reason given");
    setBusy(false);
    setShowReturnForm(false);
    if (!r.success) alert(r.error ?? "Could not submit return request.");
    onChanged();
  };

  return (
    <>
      <tr className="border-b border-gray-50 last:border-0">
        <td className="px-4 py-3 font-semibold text-gray-900">{String(order.orderNumber)}</td>
        <td className="px-4 py-3 text-gray-500">{new Date(String(order.placedAt)).toLocaleDateString()}</td>
        <td className="px-4 py-3 text-gray-500">{(order.items as R[]).length} item{(order.items as R[]).length !== 1 ? "s" : ""}</td>
        <td className="px-4 py-3 font-bold text-gray-700">{fmtZAR(Number(order.totalAmount))}</td>
        <td className="px-4 py-3">
          <span className="flex items-center gap-1 text-xs font-semibold w-fit px-2.5 py-1 rounded-full" style={{ color: STATUS_META[status]?.color, background: `${STATUS_META[status]?.color}15` }}>
            {STATUS_META[status]?.icon} {STATUS_META[status]?.label ?? status}
          </span>
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => downloadInvoice(order)} className="text-[11px] font-semibold text-gray-500 hover:text-gray-800">Invoice</button>
            {CANCELLABLE.includes(status) && (
              <button onClick={cancel} disabled={busy} className="text-[11px] font-semibold text-red-500 hover:text-red-700 disabled:opacity-50">Cancel</button>
            )}
            {status === "delivered" && (
              <button onClick={() => setShowReturnForm(s => !s)} className="text-[11px] font-semibold" style={{ color: "#34A853" }}>Request return</button>
            )}
          </div>
        </td>
      </tr>
      {showReturnForm && (
        <tr className="border-b border-gray-50">
          <td colSpan={6} className="px-4 py-3 bg-gray-50">
            <div className="flex items-center gap-2">
              <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason for return"
                className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-[#128A43]" />
              <button onClick={submitReturn} disabled={busy} className="px-3 py-1.5 rounded-lg text-white text-xs font-semibold disabled:opacity-50" style={{ background: "#34A853" }}>
                {busy ? "Submitting..." : "Submit request"}
              </button>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function AddressBook({ userId, addresses, onChanged }: { userId: string; addresses: R[]; onChanged: () => void }) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ label: "Home", firstName: "", lastName: "", line1: "", city: "", postalCode: "", phone: "" });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!form.firstName || !form.lastName || !form.line1 || !form.city || !form.postalCode || !form.phone) return;
    setSaving(true);
    await mktAddAddress(userId, form);
    setSaving(false);
    setAdding(false);
    setForm({ label: "Home", firstName: "", lastName: "", line1: "", city: "", postalCode: "", phone: "" });
    onChanged();
  };

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5">
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm font-bold text-gray-900">Address Book</span>
        <button onClick={() => setAdding(a => !a)} className="flex items-center gap-1 text-xs font-semibold" style={{ color: "#128A43" }}>
          <Plus className="w-3.5 h-3.5" /> Add address
        </button>
      </div>

      {adding && (
        <div className="mb-4 p-4 border border-gray-100 rounded-lg grid grid-cols-2 gap-2">
          {(["firstName","lastName","line1","city","postalCode","phone"] as const).map(f => (
            <input key={f} placeholder={f} value={form[f]} onChange={e => setForm(prev => ({ ...prev, [f]: e.target.value }))}
              className="border border-gray-200 rounded px-2.5 py-1.5 text-sm outline-none focus:border-[#128A43]" />
          ))}
          <button onClick={save} disabled={saving} className="col-span-2 mt-1 py-2 rounded-lg text-white text-sm font-semibold" style={{ background: "#131921" }}>
            {saving ? "Saving..." : "Save address"}
          </button>
        </div>
      )}

      {addresses.length === 0 && !adding ? <p className="text-sm text-gray-400 text-center py-6">No saved addresses yet.</p> : (
        <div className="grid sm:grid-cols-2 gap-3">
          {addresses.map((a, i) => (
            <div key={i} className="border border-gray-100 rounded-lg p-3 relative">
              <p className="text-xs font-bold text-gray-500 mb-1">{String(a.label)}{Boolean(a.isDefault) && <span className="ml-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full" style={{ background: "#FFF4E5", color: "#B75C00" }}>Default</span>}</p>
              <p className="text-sm text-gray-800">{String(a.firstName)} {String(a.lastName)}</p>
              <p className="text-xs text-gray-500">{String(a.line1)}, {String(a.city)} {String(a.postalCode)}</p>
              <p className="text-xs text-gray-500">{String(a.phone)}</p>
              <button onClick={async () => { await mktDeleteAddress(userId, String(a.id)); onChanged(); }} className="absolute top-3 right-3 text-gray-300 hover:text-red-500">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Card numbers are never captured or stored here — only a display label and the
// last 4 digits, matching how the rest of the app references cards elsewhere
// (e.g. "Standard Bank ****4291"). Real payment processing isn't wired up in
// this demo; this panel is for display/reference only.
function PaymentMethodsPanel() {
  const [cards, setCards] = useState<{ brand: string; last4: string }[]>([]);
  const [brand, setBrand] = useState("Visa");
  const [last4, setLast4] = useState("");

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5">
      <p className="text-sm font-bold text-gray-900 mb-1">Payment Methods</p>
      <p className="text-xs text-gray-400 mb-4">Reference only — no card numbers are collected or stored in this demo.</p>
      <div className="grid sm:grid-cols-2 gap-3 mb-4">
        {cards.map((c, i) => (
          <div key={i} className="border border-gray-100 rounded-lg p-3 flex items-center gap-3">
            <CreditCard className="w-6 h-6 text-gray-400" />
            <div><p className="text-sm font-semibold text-gray-800">{c.brand}</p><p className="text-xs text-gray-400">•••• {c.last4}</p></div>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <select value={brand} onChange={e => setBrand(e.target.value)} className="border border-gray-200 rounded px-2 py-1.5 text-sm">
          <option>Visa</option><option>Mastercard</option><option>PayPal</option>
        </select>
        <input placeholder="Last 4 digits" maxLength={4} value={last4} onChange={e => setLast4(e.target.value.replace(/\D/g, ""))}
          className="border border-gray-200 rounded px-2.5 py-1.5 text-sm w-32" />
        <button onClick={() => { if (last4.length === 4) { setCards(c => [...c, { brand, last4 }]); setLast4(""); } }}
          className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg text-white" style={{ background: "#131921" }}>
          <Plus className="w-3.5 h-3.5" /> Add card
        </button>
      </div>
    </div>
  );
}

function SecurityPanel() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setMsg(null);
    if (next.length < 8) { setMsg({ ok: false, text: "New password must be at least 8 characters." }); return; }
    setSaving(true);
    const r = await mktAuth.changePassword(current, next);
    setSaving(false);
    if (r.success) { setMsg({ ok: true, text: "Password updated." }); setCurrent(""); setNext(""); }
    else setMsg({ ok: false, text: r.error ?? "Could not update password." });
  };

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5 max-w-md">
      <p className="text-sm font-bold text-gray-900 mb-4">Change Password</p>
      {msg && <div className={`mb-3 px-3 py-2 rounded-lg text-xs font-medium ${msg.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>{msg.text}</div>}
      <input type="password" placeholder="Current password" value={current} onChange={e => setCurrent(e.target.value)}
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-2 outline-none focus:border-[#128A43]" />
      <input type="password" placeholder="New password (min 8 characters)" value={next} onChange={e => setNext(e.target.value)}
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-3 outline-none focus:border-[#128A43]" />
      <button onClick={submit} disabled={saving} className="py-2 px-4 rounded-lg text-white text-sm font-semibold" style={{ background: "#131921" }}>
        {saving ? "Updating..." : "Update password"}
      </button>
      <p className="text-[11px] text-gray-400 mt-4">Two-factor authentication and login-history tracking aren't available in this demo yet.</p>
    </div>
  );
}

function SpendingAnalytics({ spending }: { spending: R | null }) {
  const monthly = (spending?.monthly as R[]) ?? [];
  const byCategory = (spending?.byCategory as R[]) ?? [];
  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <div className="bg-white rounded-xl border border-gray-100 p-4">
        <p className="text-sm font-bold text-gray-900 mb-3">Monthly Spending</p>
        {monthly.length === 0 ? <p className="text-sm text-gray-400 text-center py-10">No paid orders yet.</p> : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={monthly}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="month" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} /><Tooltip formatter={(v: number) => fmtZAR(v)} /><Bar dataKey="total" fill="#128A43" radius={[4,4,0,0]} /></BarChart>
          </ResponsiveContainer>
        )}
      </div>
      <div className="bg-white rounded-xl border border-gray-100 p-4">
        <p className="text-sm font-bold text-gray-900 mb-3">Spending by Seller</p>
        {byCategory.length === 0 ? <p className="text-sm text-gray-400 text-center py-10">No paid orders yet.</p> : (
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={byCategory} dataKey="total" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={(e: R) => String(e.name)}>
                {byCategory.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
              </Pie>
              <Tooltip formatter={(v: number) => fmtZAR(v)} />
            </PieChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
