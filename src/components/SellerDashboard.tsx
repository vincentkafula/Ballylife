import { useState, useEffect, useCallback } from "react";
import {
  BarChart3, Package, ShoppingBag, Star, Settings, Plus, Trash2, Edit2, Loader2,
  TrendingUp, Users, AlertTriangle, CheckCircle, Clock,
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { mktSellers, mktAdmin, type MktAuthUser } from "../services/marketplaceApi";

type R = Record<string, unknown>;
type Tab = "overview" | "orders" | "products" | "inventory" | "reviews" | "settings";

const fmtZAR = (n: number) => `R${Number(n ?? 0).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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

function SideNavButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button onClick={onClick}
      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left text-sm font-medium transition-colors"
      style={{ background: active ? "#EAF7EE" : "transparent", color: active ? "#0B5C2E" : "#374151" }}>
      {icon}<span>{label}</span>
    </button>
  );
}

interface Props {
  user: MktAuthUser;
  seller: { id: string; storeName: string; status: string };
  onSignOut: () => void;
}

export function SellerDashboard({ user, seller, onSignOut }: Props) {
  const [tab, setTab] = useState<Tab>("overview");
  const [sellerData, setSellerData] = useState<R | null>(null);
  const [products, setProducts] = useState<R[]>([]);
  const [orders, setOrders] = useState<R[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [analyticsRes, ordersRes] = await Promise.allSettled([
      mktSellers.analytics(seller.id), mktSellers.myOrders(seller.id),
    ]);
    if (analyticsRes.status === "fulfilled") {
      const d = analyticsRes.value.data as R;
      setSellerData(d);
      setProducts((d.products as R[]) ?? []);
    }
    if (ordersRes.status === "fulfilled") setOrders(ordersRes.value.data as R[]);
    setLoading(false);
  }, [seller.id]);

  useEffect(() => { load(); }, [load]);

  const revenue = (sellerData?.revenue as R[]) ?? [];
  const topProducts = (sellerData?.topProducts as R[]) ?? [];
  const inStock = products.filter(p => Number(p.stock) > 10);
  const lowStock = products.filter(p => Number(p.stock) > 0 && Number(p.stock) <= 10);
  const outOfStock = products.filter(p => Number(p.stock) === 0);

  const NAV: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "overview", label: "Overview", icon: <BarChart3 className="w-4 h-4" /> },
    { id: "orders", label: "Orders", icon: <ShoppingBag className="w-4 h-4" /> },
    { id: "products", label: "Products", icon: <Package className="w-4 h-4" /> },
    { id: "inventory", label: "Inventory", icon: <AlertTriangle className="w-4 h-4" /> },
    { id: "reviews", label: "Reviews", icon: <Star className="w-4 h-4" /> },
    { id: "settings", label: "Store Settings", icon: <Settings className="w-4 h-4" /> },
  ];

  return (
    <div className="flex-1 flex min-h-0 overflow-hidden bg-[#EAEDED]">
      <aside className="w-56 shrink-0 bg-white border-r border-gray-100 p-3 overflow-y-auto flex flex-col">
        <div className="px-1 pb-3 mb-2 border-b border-gray-100">
          <p className="text-sm font-bold text-gray-900">{seller.storeName}</p>
          <p className="text-[11px] mt-0.5" style={{ color: seller.status === "active" ? "#10B981" : "#F59E0B" }}>
            {seller.status === "active" ? "● Store live" : "● Pending approval"}
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
        ) : seller.status !== "active" ? (
          <div className="bg-white rounded-xl border border-amber-200 p-6 text-center max-w-lg mx-auto mt-10">
            <Clock className="w-8 h-8 text-amber-500 mx-auto mb-3" />
            <p className="text-sm font-bold text-gray-900 mb-1">Your store is pending approval</p>
            <p className="text-xs text-gray-500">The marketplace team reviews new sellers before they go live — you can still add products below, they'll appear once your store and each listing are approved.</p>
            <button onClick={() => setTab("products")} className="mt-4 px-4 py-2 rounded-lg text-white text-sm font-semibold" style={{ background: "#128A43" }}>Add your first product</button>
          </div>
        ) : null}

        {!loading && (
          <>
            {tab === "overview" && (
              <div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
                  <StatCard label="Total revenue" value={fmtZAR(Number((sellerData?.seller as R)?.totalRevenue ?? 0))} icon={<TrendingUp className="w-4 h-4" />} accent="#10B981" />
                  <StatCard label="Total orders" value={String(orders.length)} icon={<ShoppingBag className="w-4 h-4" />} accent="#128A43" />
                  <StatCard label="Products" value={String(products.length)} icon={<Package className="w-4 h-4" />} accent="#34A853" />
                  <StatCard label="Avg. rating" value={String((sellerData?.seller as R)?.avgRating ?? 0)} icon={<Star className="w-4 h-4" />} accent="#F59E0B" />
                </div>

                <div className="bg-white rounded-xl border border-gray-100 p-4 mb-5">
                  <p className="text-sm font-bold text-gray-900 mb-3">Daily Revenue (last 7 days)</p>
                  <p className="text-[11px] text-gray-400 mb-2">Illustrative — day-by-day revenue history isn't tracked yet, this samples typical daily variance.</p>
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={revenue}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="day" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} /><Tooltip formatter={(v: number) => fmtZAR(v)} /><Bar dataKey="revenue" fill="#128A43" radius={[4,4,0,0]} /></BarChart>
                  </ResponsiveContainer>
                </div>

                <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                  <div className="px-4 py-3 border-b border-gray-100"><span className="text-sm font-bold text-gray-900">Top Products</span></div>
                  {topProducts.length === 0 ? <p className="text-sm text-gray-400 p-6 text-center">No sales yet.</p> : topProducts.map((p, i) => (
                    <div key={i} className="flex items-center justify-between px-4 py-3 border-b border-gray-50 last:border-0">
                      <div className="flex items-center gap-3"><span className="text-xl">{String(p.emoji)}</span><span className="text-sm font-medium text-gray-800">{String(p.name)}</span></div>
                      <div className="text-right"><p className="text-sm font-bold text-gray-900">{fmtZAR(Number(p.revenue))}</p><p className="text-[11px] text-gray-400">{String(p.sold)} sold</p></div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {tab === "orders" && (
              <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100"><span className="text-sm font-bold text-gray-900">Orders containing your products</span></div>
                {orders.length === 0 ? <p className="text-sm text-gray-400 p-6 text-center">No orders yet.</p> : (
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-[11px] text-gray-400 border-b border-gray-100">
                      <th className="px-4 py-2 font-medium">Order</th><th className="px-4 py-2 font-medium">Customer</th>
                      <th className="px-4 py-2 font-medium">Amount</th><th className="px-4 py-2 font-medium">Status</th><th className="px-4 py-2 font-medium">Action</th>
                    </tr></thead>
                    <tbody>
                      {orders.map((o, i) => (
                        <SellerOrderRow key={i} order={o} onUpdated={load} />
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {tab === "products" && <ProductManagement sellerId={seller.id} products={products} onChanged={load} />}

            {tab === "inventory" && (
              <div className="grid sm:grid-cols-3 gap-4 mb-5">
                {[{ label: "In Stock", list: inStock, color: "#10B981" }, { label: "Low Stock (≤10)", list: lowStock, color: "#F59E0B" }, { label: "Out of Stock", list: outOfStock, color: "#EF4444" }].map(g => (
                  <div key={g.label} className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                    <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                      <span className="text-sm font-bold" style={{ color: g.color }}>{g.label}</span>
                      <span className="text-xs font-bold text-gray-400">{g.list.length}</span>
                    </div>
                    {g.list.slice(0, 8).map((p, i) => (
                      <div key={i} className="flex items-center justify-between px-4 py-2 border-b border-gray-50 last:border-0 text-sm">
                        <span className="text-gray-700 truncate">{String(p.name)}</span>
                        <span className="text-gray-400 text-xs shrink-0 ml-2">{String(p.stock)} left</span>
                      </div>
                    ))}
                    {g.list.length === 0 && <p className="text-xs text-gray-300 p-4 text-center">None</p>}
                  </div>
                ))}
              </div>
            )}

            {tab === "reviews" && <SellerReviews products={products} />}
            {tab === "settings" && <StoreSettings seller={seller} onSaved={load} />}
          </>
        )}
      </div>
    </div>
  );
}

function SellerOrderRow({ order, onUpdated }: { order: R; onUpdated: () => void }) {
  const [saving, setSaving] = useState(false);
  const advance = async (status: string) => {
    setSaving(true);
    await mktAdmin.updateOrderStatus(String(order.id), { status });
    setSaving(false);
    onUpdated();
  };
  const status = String(order.status);
  const next: Record<string, string> = { pending: "confirmed", confirmed: "processing", processing: "shipped", shipped: "delivered" };

  return (
    <tr className="border-b border-gray-50 last:border-0">
      <td className="px-4 py-3 font-semibold text-gray-900">{String(order.orderNumber)}</td>
      <td className="px-4 py-3 text-gray-500">{String(order.customerName)}</td>
      <td className="px-4 py-3 font-bold text-gray-700">{fmtZAR(Number(order.totalAmount))}</td>
      <td className="px-4 py-3 capitalize text-gray-600">{status.replace("_", " ")}</td>
      <td className="px-4 py-3">
        {next[status] ? (
          <button onClick={() => advance(next[status])} disabled={saving}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg text-white disabled:opacity-50" style={{ background: "#128A43" }}>
            {saving ? "..." : `Mark ${next[status]}`}
          </button>
        ) : <span className="text-xs text-gray-300">—</span>}
      </td>
    </tr>
  );
}

function ProductManagement({ sellerId, products, onChanged }: { sellerId: string; products: R[]; onChanged: () => void }) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ categoryId: "cat-01", name: "", price: "", stock: "", brand: "", emoji: "📦", shortDescription: "" });
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!form.name || !form.price) return;
    setSaving(true);
    await mktSellers.addProduct(sellerId, { ...form, price: Number(form.price), stock: Number(form.stock) || 0 });
    setSaving(false);
    setAdding(false);
    setForm({ categoryId: "cat-01", name: "", price: "", stock: "", brand: "", emoji: "📦", shortDescription: "" });
    onChanged();
  };

  const remove = async (productId: string) => { await mktSellers.deleteProduct(sellerId, productId); onChanged(); };

  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <span className="text-sm font-bold text-gray-900">My Products</span>
        <button onClick={() => setAdding(a => !a)} className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg text-white" style={{ background: "#131921" }}>
          <Plus className="w-3.5 h-3.5" /> Add product
        </button>
      </div>

      {adding && (
        <div className="p-4 border-b border-gray-100 grid sm:grid-cols-3 gap-2">
          <input placeholder="Product name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="border border-gray-200 rounded px-2.5 py-1.5 text-sm" />
          <input placeholder="Price (ZAR)" type="number" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} className="border border-gray-200 rounded px-2.5 py-1.5 text-sm" />
          <input placeholder="Stock" type="number" value={form.stock} onChange={e => setForm({ ...form, stock: e.target.value })} className="border border-gray-200 rounded px-2.5 py-1.5 text-sm" />
          <input placeholder="Brand" value={form.brand} onChange={e => setForm({ ...form, brand: e.target.value })} className="border border-gray-200 rounded px-2.5 py-1.5 text-sm" />
          <input placeholder="Emoji (e.g. 📱)" value={form.emoji} onChange={e => setForm({ ...form, emoji: e.target.value })} className="border border-gray-200 rounded px-2.5 py-1.5 text-sm" />
          <select value={form.categoryId} onChange={e => setForm({ ...form, categoryId: e.target.value })} className="border border-gray-200 rounded px-2.5 py-1.5 text-sm">
            {["cat-01","cat-02","cat-03","cat-04","cat-05","cat-06","cat-07","cat-08","cat-09"].map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <input placeholder="Short description" value={form.shortDescription} onChange={e => setForm({ ...form, shortDescription: e.target.value })} className="border border-gray-200 rounded px-2.5 py-1.5 text-sm sm:col-span-2" />
          <button onClick={submit} disabled={saving} className="py-1.5 rounded text-white text-sm font-semibold" style={{ background: "#128A43" }}>{saving ? "Saving..." : "Submit for approval"}</button>
        </div>
      )}

      {products.length === 0 ? <p className="text-sm text-gray-400 p-6 text-center">No products yet.</p> : (
        <table className="w-full text-sm">
          <thead><tr className="text-left text-[11px] text-gray-400 border-b border-gray-100">
            <th className="px-4 py-2 font-medium">Product</th><th className="px-4 py-2 font-medium">Price</th>
            <th className="px-4 py-2 font-medium">Stock</th><th className="px-4 py-2 font-medium">Status</th><th className="px-4 py-2 font-medium">Sold</th><th className="px-4 py-2"></th>
          </tr></thead>
          <tbody>
            {products.map((p, i) => (
              <tr key={i} className="border-b border-gray-50 last:border-0">
                <td className="px-4 py-3"><span className="mr-2">{String(p.emoji)}</span><span className="font-medium text-gray-800">{String(p.name)}</span></td>
                <td className="px-4 py-3 text-gray-700">{fmtZAR(Number(p.price))}</td>
                <td className="px-4 py-3 text-gray-500">{String(p.stock)}</td>
                <td className="px-4 py-3">
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{
                    background: p.status === "active" ? "#ECFDF5" : p.status === "pending_review" ? "#FFF7ED" : "#F3F4F6",
                    color: p.status === "active" ? "#059669" : p.status === "pending_review" ? "#C2410C" : "#6B7280",
                  }}>{String(p.status).replace("_"," ")}</span>
                </td>
                <td className="px-4 py-3 text-gray-500">{String(p.totalSold)}</td>
                <td className="px-4 py-3"><button onClick={() => remove(String(p.id))} className="text-gray-300 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function SellerReviews({ products }: { products: R[] }) {
  const totalReviews = products.reduce((s, p) => s + Number(p.reviewCount ?? 0), 0);
  const avgRating = products.length ? (products.reduce((s, p) => s + Number(p.avgRating ?? 0), 0) / products.length).toFixed(1) : "0.0";
  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <span className="text-sm font-bold text-gray-900">Reviews</span>
        <span className="text-xs text-gray-400">{totalReviews} total · {avgRating}★ average</span>
      </div>
      {products.filter(p => Number(p.reviewCount) > 0).map((p, i) => (
        <div key={i} className="flex items-center justify-between px-4 py-3 border-b border-gray-50 last:border-0">
          <div className="flex items-center gap-2"><span>{String(p.emoji)}</span><span className="text-sm text-gray-800">{String(p.name)}</span></div>
          <div className="flex items-center gap-1 text-sm"><Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" /><span className="font-semibold">{String(p.avgRating)}</span><span className="text-gray-400">({String(p.reviewCount)})</span></div>
        </div>
      ))}
      {products.filter(p => Number(p.reviewCount) > 0).length === 0 && <p className="text-sm text-gray-400 p-6 text-center">No reviews yet.</p>}
    </div>
  );
}

function StoreSettings({ seller, onSaved }: { seller: { id: string; storeName: string; status: string }; onSaved: () => void }) {
  const [description, setDescription] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const submit = async () => {
    setSaving(true);
    await mktSellers.updateProfile(seller.id, { description, phone });
    setSaving(false);
    setSaved(true);
    onSaved();
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5 max-w-md">
      <p className="text-sm font-bold text-gray-900 mb-1">Store Settings</p>
      <p className="text-xs text-gray-400 mb-4">{seller.storeName}</p>
      {saved && <div className="mb-3 px-3 py-2 rounded-lg bg-green-50 text-green-700 text-xs font-medium flex items-center gap-1"><CheckCircle className="w-3.5 h-3.5" /> Saved</div>}
      <label className="block mb-3">
        <span className="block text-xs font-semibold text-gray-600 mb-1">Store description</span>
        <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#128A43]" />
      </label>
      <label className="block mb-4">
        <span className="block text-xs font-semibold text-gray-600 mb-1">Contact phone</span>
        <input value={phone} onChange={e => setPhone(e.target.value)}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#128A43]" />
      </label>
      <button onClick={submit} disabled={saving} className="py-2 px-4 rounded-lg text-white text-sm font-semibold" style={{ background: "#131921" }}>
        {saving ? "Saving..." : "Save changes"}
      </button>
      <p className="text-[11px] text-gray-400 mt-4">Logo/banner upload, coupon creation and advertising campaigns aren't available in this demo yet.</p>
    </div>
  );
}
