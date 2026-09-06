import { useState, useEffect, useCallback } from "react";
import {
  BarChart3, Package, ShoppingBag, Settings, Plus, Loader2, Clock,
} from "lucide-react";
import { mktSuppliersSelf, type MktAuthUser } from "../services/marketplaceApi";

type R = Record<string, unknown>;
type Tab = "overview" | "catalog" | "orders" | "settings";

function SideNavButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button onClick={onClick}
      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left text-sm font-medium transition-colors"
      style={{ background: active ? "#EAF7EE" : "transparent", color: active ? "#0B5C2E" : "#374151" }}>
      {icon}<span>{label}</span>
    </button>
  );
}

function StatCard({ label, value, icon, accent }: { label: string; value: string; icon: React.ReactNode; accent: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: `${accent}15`, color: accent }}>{icon}</span>
      </div>
      <p className="text-xl font-black text-gray-900">{value}</p>
      <p className="text-[11px] text-gray-500 mt-0.5">{label}</p>
    </div>
  );
}

// Pipeline stage labels/colours — same vocabulary sellers see on their own
// Import pipeline view, since it's the same underlying mkt_supplier_orders
// status a supplier's items travel through.
const PIPELINE_STAGE_META: Record<string, { label: string; color: string }> = {
  ordered_from_supplier: { label: "New order — awaiting your shipment", color: "#6B7280" },
  received_at_origin_hub: { label: "Received at origin hub", color: "#2563EB" },
  qc_passed_origin: { label: "QC passed", color: "#2563EB" },
  qc_failed_origin: { label: "QC failed — under review", color: "#DC2626" },
  refunded: { label: "Refunded", color: "#DC2626" },
  in_transit_to_destination: { label: "In transit to destination", color: "#B8862E" },
  received_at_destination_hub: { label: "Arrived at destination hub", color: "#B8862E" },
  customs_cleared: { label: "Customs cleared", color: "#059669" },
  shipped_to_customer: { label: "Shipped to customer", color: "#059669" },
  delivered: { label: "Delivered", color: "#10B981" },
};

interface Props {
  user: MktAuthUser;
  supplier: R;
  onSignOut: () => void;
}

export function SupplierDashboard({ user, supplier, onSignOut }: Props) {
  const [tab, setTab] = useState<Tab>("overview");
  const [profile, setProfile] = useState<R>(supplier);
  const [products, setProducts] = useState<R[]>([]);
  const [orders, setOrders] = useState<R[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [profileRes, productsRes, ordersRes] = await Promise.allSettled([
      mktSuppliersSelf.get(String(supplier.id)), mktSuppliersSelf.products(String(supplier.id)), mktSuppliersSelf.orders(String(supplier.id)),
    ]);
    if (profileRes.status === "fulfilled" && profileRes.value.success) setProfile(profileRes.value.data as R);
    if (productsRes.status === "fulfilled") setProducts(productsRes.value.data as R[]);
    if (ordersRes.status === "fulfilled") setOrders(ordersRes.value.data as R[]);
    setLoading(false);
  }, [supplier.id]);

  useEffect(() => { load(); }, [load]);

  const activeCount = products.filter(p => p.status === "active").length;
  const pendingCount = products.filter(p => p.status === "pending_review").length;
  const openOrders = orders.filter(o => !["delivered", "refunded"].includes(String(o.status)));

  const NAV: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "overview", label: "Overview", icon: <BarChart3 className="w-4 h-4" /> },
    { id: "catalog", label: "My Catalog", icon: <Package className="w-4 h-4" /> },
    { id: "orders", label: "Orders", icon: <ShoppingBag className="w-4 h-4" /> },
    { id: "settings", label: "Profile", icon: <Settings className="w-4 h-4" /> },
  ];

  return (
    <div className="flex-1 flex min-h-0 overflow-hidden bg-[#EAEDED]">
      <aside className="w-56 shrink-0 bg-white border-r border-gray-100 p-3 overflow-y-auto flex flex-col">
        <div className="px-1 pb-3 mb-2 border-b border-gray-100">
          <p className="font-serif text-base text-gray-900" style={{ fontWeight: 600 }}>{String(profile.name)}</p>
          <p className="text-[11px] mt-0.5 text-gray-400">{String(profile.country)} · {String(profile.platform ?? "")}</p>
          <p className="text-[11px] mt-1" style={{ color: profile.verified ? "#10B981" : "#F59E0B" }}>
            {profile.verified ? "● Verified supplier" : "● Verification pending"}
          </p>
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
                <p className="text-lg font-bold text-gray-900 mb-1">Welcome back, {user.name}</p>
                <p className="text-sm text-gray-500 mb-5">Ballylife sources from your catalog and handles pricing, warehousing, customs, and delivery — you manage what you're offering and can see where your orders stand.</p>
                <div className="grid sm:grid-cols-3 gap-3 mb-6">
                  <StatCard label="Active catalog items" value={String(activeCount)} icon={<Package className="w-4 h-4" />} accent="#10B981" />
                  <StatCard label="Awaiting approval" value={String(pendingCount)} icon={<Clock className="w-4 h-4" />} accent="#F59E0B" />
                  <StatCard label="Open orders" value={String(openOrders.length)} icon={<ShoppingBag className="w-4 h-4" />} accent="#2563EB" />
                </div>
                {openOrders.length > 0 && (
                  <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                    <div className="px-4 py-3 border-b border-gray-100"><span className="text-sm font-bold text-gray-900">Orders needing attention</span></div>
                    {openOrders.slice(0, 5).map((o, i) => {
                      const meta = PIPELINE_STAGE_META[String(o.status)] ?? { label: String(o.status).replace(/_/g, " "), color: "#6B7280" };
                      return (
                        <div key={i} className="flex items-center justify-between px-4 py-2.5 border-b border-gray-50 last:border-0">
                          <span className="text-sm text-gray-700">{String(o.productName)} · qty {String(o.quantity)}</span>
                          <span className="text-xs font-semibold px-2.5 py-1 rounded-full" style={{ color: meta.color, background: `${meta.color}15` }}>{meta.label}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {tab === "catalog" && <SupplierCatalogManagement supplierId={String(supplier.id)} products={products} onChanged={load} />}

            {tab === "orders" && (
              <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100">
                  <span className="text-sm font-bold text-gray-900">Orders ({orders.length})</span>
                  <span className="text-[11px] text-gray-400 ml-2">View only — Ballylife ops advances each stage as it happens</span>
                </div>
                {orders.length === 0 ? <p className="text-sm text-gray-400 p-6 text-center">No orders yet.</p> : (
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-[11px] text-gray-400 border-b border-gray-100">
                      <th className="px-4 py-2 font-medium">Order</th><th className="px-4 py-2 font-medium">Product</th>
                      <th className="px-4 py-2 font-medium">Qty</th><th className="px-4 py-2 font-medium">Route</th><th className="px-4 py-2 font-medium">Stage</th>
                    </tr></thead>
                    <tbody>
                      {orders.map((o, i) => {
                        const meta = PIPELINE_STAGE_META[String(o.status)] ?? { label: String(o.status).replace(/_/g, " "), color: "#6B7280" };
                        return (
                          <tr key={i} className="border-b border-gray-50 last:border-0">
                            <td className="px-4 py-2.5 font-semibold text-gray-900">{String(o.orderNumber)}</td>
                            <td className="px-4 py-2.5 text-gray-600">{String(o.productName)}</td>
                            <td className="px-4 py-2.5 text-gray-500">{String(o.quantity)}</td>
                            <td className="px-4 py-2.5 text-gray-400 text-xs">{String(o.originWarehouseName)} → {String(o.destinationWarehouseName)}</td>
                            <td className="px-4 py-2.5"><span className="text-xs font-semibold px-2.5 py-1 rounded-full" style={{ color: meta.color, background: `${meta.color}15` }}>{meta.label}</span></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {tab === "settings" && <SupplierProfileSettings profile={profile} onSaved={load} />}
          </>
        )}
      </div>
    </div>
  );
}

// Suppliers propose new items and edit their own operational details
// (name, description, cost, MOQ, images) — category and retail/discount
// pricing are always set by a manager (see mkt_duty_rates/mkt_supplier_
// products.retail_price), so new items sit at pending_review until that
// happens.
function SupplierCatalogManagement({ supplierId, products, onChanged }: { supplierId: string; products: R[]; onChanged: () => void }) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", costPrice: "", currency: "USD", moq: "10", emoji: "📦" });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const submit = async () => {
    if (!form.name || !form.costPrice) return;
    setSaving(true);
    setMessage(null);
    const res = await mktSuppliersSelf.addProduct(supplierId, { ...form, costPrice: Number(form.costPrice), moq: Number(form.moq) || 1 });
    setSaving(false);
    if (!res.success) { setMessage(res.error ?? "Could not submit this item."); return; }
    setMessage(res.message ?? "Submitted for review.");
    setAdding(false);
    setForm({ name: "", description: "", costPrice: "", currency: "USD", moq: "10", emoji: "📦" });
    onChanged();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-bold text-gray-900">My Catalog ({products.length})</span>
        <button onClick={() => setAdding(a => !a)} className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg text-white" style={{ background: "#14110D" }}>
          <Plus className="w-3.5 h-3.5" /> Propose new item
        </button>
      </div>
      <p className="text-xs text-gray-400 mb-3">New items and edits to cost/description are yours to manage — category and the retail price sellers see are set by Ballylife's team once an item is approved.</p>
      {message && <div className="mb-3 text-xs font-medium px-3 py-2 rounded-lg bg-amber-50 text-amber-800 border border-amber-200">{message}</div>}

      {adding && (
        <div className="bg-white rounded-xl border border-gray-100 p-4 grid sm:grid-cols-3 gap-2 mb-4">
          <input placeholder="Item name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="border border-gray-200 rounded px-2.5 py-1.5 text-sm sm:col-span-2" />
          <input placeholder="Emoji" value={form.emoji} onChange={e => setForm({ ...form, emoji: e.target.value })} className="border border-gray-200 rounded px-2.5 py-1.5 text-sm" />
          <input placeholder="Cost price" type="number" step="0.01" value={form.costPrice} onChange={e => setForm({ ...form, costPrice: e.target.value })} className="border border-gray-200 rounded px-2.5 py-1.5 text-sm" />
          <select value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value })} className="border border-gray-200 rounded px-2.5 py-1.5 text-sm">
            {["USD", "CNY", "JPY", "KRW"].map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <input placeholder="MOQ" type="number" value={form.moq} onChange={e => setForm({ ...form, moq: e.target.value })} className="border border-gray-200 rounded px-2.5 py-1.5 text-sm" />
          <input placeholder="Description" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className="border border-gray-200 rounded px-2.5 py-1.5 text-sm sm:col-span-3" />
          <button onClick={submit} disabled={saving || !form.name || !form.costPrice} className="sm:col-span-3 py-1.5 rounded text-white text-sm font-semibold disabled:opacity-50" style={{ background: "#B8862E" }}>{saving ? "Submitting..." : "Submit for review"}</button>
        </div>
      )}

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {products.map((item, i) => (
          <div key={i} className="bg-white rounded-xl border border-gray-100 p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-2xl">{String(item.emoji ?? "📦")}</span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                style={{ background: item.status === "active" ? "#ECFDF5" : item.status === "pending_review" ? "#FFFBEB" : "#F3F4F6", color: item.status === "active" ? "#059669" : item.status === "pending_review" ? "#B45309" : "#6B7280" }}>
                {item.status === "active" ? "Live" : item.status === "pending_review" ? "Pending review" : "Inactive"}
              </span>
            </div>
            <p className="text-sm font-bold text-gray-900 leading-tight mb-1">{String(item.name)}</p>
            <p className="text-xs text-gray-400 mb-2 line-clamp-2">{String(item.description ?? "")}</p>
            <p className="text-[11px] text-gray-500">MOQ {String(item.moq)} · Cost {String(item.currency)} {Number(item.costPrice).toFixed(2)}</p>
            {item.status === "active" && <p className="text-[11px] text-gray-400 mt-1">Imported by sellers {String(item.importCount ?? 0)}x</p>}
            {!item.categoryId && item.status === "pending_review" && <p className="text-[11px] text-amber-600 mt-1">Awaiting category & pricing from Ballylife</p>}
          </div>
        ))}
        {!products.length && <p className="text-sm text-gray-400 p-6 text-center col-span-full">No catalog items yet — propose your first one above.</p>}
      </div>
    </div>
  );
}

function SupplierProfileSettings({ profile, onSaved }: { profile: R; onSaved: () => void }) {
  const [form, setForm] = useState({
    contactName: String(profile.contactName ?? ""), contactEmail: String(profile.contactEmail ?? ""),
    contactPhone: String(profile.contactPhone ?? ""), platform: String(profile.platform ?? ""),
    paymentTerms: String(profile.paymentTerms ?? ""), leadTimeDays: String(profile.leadTimeDays ?? ""),
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setMessage(null);
    const res = await mktSuppliersSelf.updateProfile(String(profile.id), { ...form, leadTimeDays: Number(form.leadTimeDays) || undefined });
    setSaving(false);
    if (!res.success) { setMessage(res.error ?? "Could not save changes."); return; }
    setMessage("Saved.");
    onSaved();
  };

  return (
    <div className="max-w-xl">
      <p className="text-sm font-bold text-gray-900 mb-1">Profile</p>
      <p className="text-xs text-gray-400 mb-4">Your operational details — company name, country, and verification status are set by Ballylife's team and can't be changed here.</p>
      {message && <div className="mb-3 text-xs font-medium px-3 py-2 rounded-lg bg-amber-50 text-amber-800 border border-amber-200">{message}</div>}
      <div className="bg-white rounded-xl border border-gray-100 p-4 space-y-3">
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs text-gray-500">Contact name</span>
            <input value={form.contactName} onChange={e => setForm({ ...form, contactName: e.target.value })} className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-sm mt-1" />
          </label>
          <label className="block">
            <span className="text-xs text-gray-500">Contact email</span>
            <input value={form.contactEmail} onChange={e => setForm({ ...form, contactEmail: e.target.value })} className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-sm mt-1" />
          </label>
          <label className="block">
            <span className="text-xs text-gray-500">Contact phone</span>
            <input value={form.contactPhone} onChange={e => setForm({ ...form, contactPhone: e.target.value })} className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-sm mt-1" />
          </label>
          <label className="block">
            <span className="text-xs text-gray-500">Platform (e.g. Alibaba, KOTRA)</span>
            <input value={form.platform} onChange={e => setForm({ ...form, platform: e.target.value })} className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-sm mt-1" />
          </label>
          <label className="block">
            <span className="text-xs text-gray-500">Payment terms</span>
            <input value={form.paymentTerms} onChange={e => setForm({ ...form, paymentTerms: e.target.value })} className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-sm mt-1" />
          </label>
          <label className="block">
            <span className="text-xs text-gray-500">Lead time (days)</span>
            <input type="number" value={form.leadTimeDays} onChange={e => setForm({ ...form, leadTimeDays: e.target.value })} className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-sm mt-1" />
          </label>
        </div>
        <button onClick={save} disabled={saving} className="text-sm font-semibold px-4 py-2 rounded-lg text-white disabled:opacity-50" style={{ background: "#B8862E" }}>
          {saving ? "Saving..." : "Save changes"}
        </button>
      </div>
    </div>
  );
}
