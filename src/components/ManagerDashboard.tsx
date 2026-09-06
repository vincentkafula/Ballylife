import { useState, useEffect, useCallback } from "react";
import {
  BarChart3, Users, Store, Package, ShoppingBag, DollarSign, CheckCircle, XCircle,
  Download, Loader2, Clock, Shield, Percent, FileText, Globe2, Warehouse, Truck, Plus,
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { mktAdmin, mktSellers, mktCategories, getMktToken, type MktAuthUser } from "../services/marketplaceApi";
import { toast } from "sonner";

type R = Record<string, unknown>;
type Tab = "overview" | "users" | "sellerApproval" | "productApproval" | "orders" | "supplyChain" | "financial" | "reports" | "security";

// Maps a specific granted Marketplace Management position (from the job
// application flow) to which of the 8 real tabs this dashboard already
// has actually fit that role -- same approach as Bank Management: a
// handful of meaningful tiers reusing existing real functionality,
// rather than 60 separate dashboards for 60 distinct roles. A position
// with no more specific mapping (Engineering, Product/Design, Marketing,
// HR, Data & Analytics, Specialized Divisions -- roles that genuinely
// don't map to one narrower slice of this particular dashboard) falls
// through to the full admin view, matching this dashboard's behavior
// before position-based routing existed.
const EXECUTIVE_POSITIONS = [
  "Board of Directors", "Chief Executive Officer (CEO)", "President / COO", "Chief Financial Officer (CFO)", "Chief Strategy Officer",
];
const MARKETPLACE_OPS_POSITIONS = [
  "Head of Marketplace / Third-Party Sellers", "Seller Support Lead", "Category Manager", "Vendor Relationship Manager",
];
const FULFILLMENT_POSITIONS = [
  "Chief Operating Officer (COO)", "VP of Supply Chain / Logistics", "Warehouse / Fulfillment Center Manager",
  "Inventory Management Lead", "Procurement / Sourcing Manager", "Last-Mile Delivery Manager",
  "Warehouse Staff / Picker / Packer", "Delivery Driver",
  "VP of Customer Service", "Customer Support Representative", "Returns / Refunds Manager", "Customer Experience / Insights Analyst",
];
const FINANCE_SECURITY_POSITIONS = [
  "Controller / Chief Accountant", "Treasury Manager", "Tax Compliance Lead", "General Counsel / Legal Team",
  "Payments / Fraud Prevention Lead", "Chief Information Security Officer (CISO)",
];

type MarketTier = "executive" | "marketplace_ops" | "fulfillment" | "finance_security" | "admin";

const TIER_TABS: Record<MarketTier, Tab[]> = {
  executive: ["overview", "financial", "reports"],
  marketplace_ops: ["overview", "sellerApproval", "productApproval"],
  fulfillment: ["overview", "orders", "supplyChain"],
  finance_security: ["overview", "financial", "security", "reports"],
  admin: ["overview", "users", "sellerApproval", "productApproval", "orders", "supplyChain", "financial", "reports", "security"],
};

function positionToMarketTier(position: string | null): MarketTier {
  if (position && EXECUTIVE_POSITIONS.includes(position)) return "executive";
  if (position && MARKETPLACE_OPS_POSITIONS.includes(position)) return "marketplace_ops";
  if (position && FULFILLMENT_POSITIONS.includes(position)) return "fulfillment";
  if (position && FINANCE_SECURITY_POSITIONS.includes(position)) return "finance_security";
  return "admin";
}

const fmtZAR = (n: number) => `R${Number(n ?? 0).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function StatCard({ label, value, icon, accent }: { label: string; value: string; icon: React.ReactNode; accent: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4">
      <span className="w-9 h-9 rounded-full flex items-center justify-center mb-2" style={{ background: `${accent}15`, color: accent }}>{icon}</span>
      <p className="text-xl font-black text-gray-900">{value}</p>
      <p className="text-[11px] text-gray-500 mt-0.5">{label}</p>
    </div>
  );
}

function SideNavButton({ active, onClick, icon, label, badge }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; badge?: number }) {
  return (
    <button onClick={onClick}
      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left text-sm font-medium transition-colors"
      style={{ background: active ? "#F3E8FF" : "transparent", color: active ? "#D4A54A" : "#374151" }}>
      {icon}<span className="flex-1">{label}</span>
      {Boolean(badge) && <span className="text-[10px] font-bold text-white rounded-full w-4 h-4 flex items-center justify-center" style={{ background: "#EF4444" }}>{badge}</span>}
    </button>
  );
}

interface Props { user: MktAuthUser; onSignOut: () => void; }

export function ManagerDashboard({ user, onSignOut }: Props) {
  const [tab, setTab] = useState<Tab>("overview");
  const [tier, setTier] = useState<MarketTier>("admin");
  const [tierPosition, setTierPosition] = useState<string | null>(null);

  // Standalone marketplace has no cross-department RBAC / job-position
  // grant system like Vink's — every authenticated manager account just
  // gets the full "admin" tier (all tabs), which is what `tier` and
  // `tierPosition` already default to above. If a real role-tiering
  // system is added later, restore a fetch here that calls setTier /
  // setTierPosition based on the signed-in manager's granted position.

  // The report endpoints require auth -- a plain <a href> can't attach an
  // Authorization header, which is exactly the bug already found and
  // fixed for document/image viewing elsewhere in the app (a browser
  // loading a link directly doesn't send custom headers the way fetch()
  // does). Fetch properly here and trigger the download via a temporary
  // blob-backed link instead.
  const [downloading, setDownloading] = useState<string | null>(null);
  const downloadReport = async (report: "orders" | "products") => {
    setDownloading(report);
    try {
      const res = await fetch(mktAdmin.reportUrl(report), { headers: { Authorization: `Bearer ${getMktToken() ?? ""}` } });
      if (!res.ok) { throw new Error("download failed"); }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${report}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error(`Could not download the ${report} report — please try again.`);
    } finally {
      setDownloading(null);
    }
  };
  const [stats, setStats] = useState<R | null>(null);
  const [pendingSellers, setPendingSellers] = useState<R[]>([]);
  const [pendingProducts, setPendingProducts] = useState<R[]>([]);
  const [orders, setOrders] = useState<R[]>([]);
  const [customers, setCustomers] = useState<R[]>([]);
  const [sellers, setSellers] = useState<R[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [statsRes, psRes, ppRes, ordersRes, custRes, sellRes] = await Promise.allSettled([
      mktAdmin.stats(), mktAdmin.pendingSellers(), mktAdmin.pendingProducts(), mktAdmin.orders(), mktAdmin.customers(), mktSellers.list(),
    ]);
    if (statsRes.status === "fulfilled") setStats(statsRes.value.data as R);
    if (psRes.status === "fulfilled") setPendingSellers(psRes.value.data as R[]);
    if (ppRes.status === "fulfilled") setPendingProducts(ppRes.value.data as R[]);
    if (ordersRes.status === "fulfilled") setOrders(ordersRes.value.data as R[]);
    if (custRes.status === "fulfilled") setCustomers(custRes.value.data as R[]);
    if (sellRes.status === "fulfilled") setSellers(sellRes.value.data as R[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const ALL_NAV: { id: Tab; label: string; icon: React.ReactNode; badge?: number }[] = [
    { id: "overview", label: "Overview", icon: <BarChart3 className="w-4 h-4" /> },
    { id: "users", label: "User Management", icon: <Users className="w-4 h-4" /> },
    { id: "sellerApproval", label: "Seller Approval", icon: <Store className="w-4 h-4" />, badge: pendingSellers.length },
    { id: "productApproval", label: "Product Approval", icon: <Package className="w-4 h-4" />, badge: pendingProducts.length },
    { id: "orders", label: "Order Monitoring", icon: <ShoppingBag className="w-4 h-4" /> },
    { id: "supplyChain", label: "Supply Chain", icon: <Globe2 className="w-4 h-4" /> },
    { id: "financial", label: "Financial", icon: <DollarSign className="w-4 h-4" /> },
    { id: "reports", label: "Reports", icon: <FileText className="w-4 h-4" /> },
    { id: "security", label: "Security & Fraud", icon: <Shield className="w-4 h-4" /> },
  ];
  const NAV = ALL_NAV.filter(item => TIER_TABS[tier].includes(item.id));

  const topCategories = (stats?.topCategories as R[]) ?? [];

  return (
    <div className="flex-1 flex min-h-0 overflow-hidden bg-[#EAEDED]">
      <aside className="w-60 shrink-0 bg-white border-r border-gray-100 p-3 overflow-y-auto flex flex-col">
        <div className="px-1 pb-3 mb-2 border-b border-gray-100">
          <p className="font-serif text-base text-gray-900" style={{ fontWeight: 600 }}>{user.name}</p>
          <p className="text-[11px] text-gray-400">{tierPosition ?? "Marketplace Manager"}</p>
        </div>
        <div className="space-y-0.5 flex-1">
          {NAV.map(n => <SideNavButton key={n.id} active={tab === n.id} onClick={() => setTab(n.id)} icon={n.icon} label={n.label} badge={n.badge} />)}
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
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
                  <StatCard label="Total customers" value={String(customers.length)} icon={<Users className="w-4 h-4" />} accent="#B8862E" />
                  <StatCard label="Total sellers" value={String(sellers.length)} icon={<Store className="w-4 h-4" />} accent="#34A853" />
                  <StatCard label="Total products" value={String(stats?.totalProducts ?? 0)} icon={<Package className="w-4 h-4" />} accent="#10B981" />
                  <StatCard label="Total orders" value={String(stats?.totalOrders ?? 0)} icon={<ShoppingBag className="w-4 h-4" />} accent="#F59E0B" />
                  <StatCard label="Platform revenue" value={fmtZAR(Number(stats?.totalRevenue ?? 0))} icon={<DollarSign className="w-4 h-4" />} accent="#059669" />
                  <StatCard label="Pending seller approvals" value={String(pendingSellers.length)} icon={<Clock className="w-4 h-4" />} accent="#DC2626" />
                  <StatCard label="Pending product approvals" value={String(pendingProducts.length)} icon={<Clock className="w-4 h-4" />} accent="#DC2626" />
                  <StatCard label="Pending reviews" value={String(stats?.pendingReviews ?? 0)} icon={<Clock className="w-4 h-4" />} accent="#6B7280" />
                </div>

                <div className="bg-white rounded-xl border border-gray-100 p-4">
                  <p className="text-sm font-bold text-gray-900 mb-3">Top Categories</p>
                  {topCategories.length === 0 ? <p className="text-sm text-gray-400 text-center py-8">No data yet.</p> : (
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={topCategories}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="name" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} /><Tooltip /><Bar dataKey="count" fill="#34A853" radius={[4,4,0,0]} /></BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>
            )}

            {tab === "users" && (
              <div className="grid lg:grid-cols-2 gap-4">
                <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                  <div className="px-4 py-3 border-b border-gray-100"><span className="text-sm font-bold text-gray-900">Customers ({customers.length})</span></div>
                  <div className="max-h-96 overflow-y-auto">
                    {customers.length === 0 ? <p className="text-sm text-gray-400 p-6 text-center">No customers yet.</p> : customers.map((c, i) => (
                      <div key={i} className="flex items-center justify-between px-4 py-2.5 border-b border-gray-50 last:border-0">
                        <div><p className="text-sm font-medium text-gray-800">{String(c.name)}</p><p className="text-[11px] text-gray-400">{String(c.email)}</p></div>
                        <p className="text-[11px] text-gray-400">{c.lastLogin ? new Date(String(c.lastLogin)).toLocaleDateString() : "Never signed in"}</p>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                  <div className="px-4 py-3 border-b border-gray-100"><span className="text-sm font-bold text-gray-900">Sellers ({sellers.length})</span></div>
                  <div className="max-h-96 overflow-y-auto">
                    {sellers.map((s, i) => (
                      <div key={i} className="flex items-center justify-between px-4 py-2.5 border-b border-gray-50 last:border-0">
                        <div><p className="text-sm font-medium text-gray-800">{String(s.storeName)}</p><p className="text-[11px] text-gray-400">{String(s.email)}</p></div>
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: s.status === "active" ? "#ECFDF5" : "#FFF7ED", color: s.status === "active" ? "#059669" : "#C2410C" }}>{String(s.status)}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <p className="lg:col-span-2 text-[11px] text-gray-400">Suspend/ban actions aren't wired up in this demo — this is a read-only directory.</p>
              </div>
            )}

            {tab === "sellerApproval" && (
              <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100"><span className="text-sm font-bold text-gray-900">Pending Seller Applications</span></div>
                {pendingSellers.length === 0 ? <p className="text-sm text-gray-400 p-6 text-center">No pending applications.</p> : pendingSellers.map((s, i) => (
                  <div key={i} className="flex items-center justify-between px-4 py-3 border-b border-gray-50 last:border-0">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{String(s.storeName)}</p>
                      <p className="text-[11px] text-gray-400">{String(s.email)} · {String(s.description ?? "No description provided")}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button onClick={async () => { await mktAdmin.rejectSeller(String(s.id)); load(); }} className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg text-red-600 border border-red-200"><XCircle className="w-3.5 h-3.5" /> Reject</button>
                      <button onClick={async () => { await mktAdmin.approveSeller(String(s.id)); load(); }} className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg text-white" style={{ background: "#10B981" }}><CheckCircle className="w-3.5 h-3.5" /> Approve</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {tab === "productApproval" && (
              <div>
                <div className="bg-white rounded-xl border border-gray-100 overflow-hidden mb-5">
                  <div className="px-4 py-3 border-b border-gray-100"><span className="text-sm font-bold text-gray-900">Pending Product Listings</span></div>
                  {pendingProducts.length === 0 ? <p className="text-sm text-gray-400 p-6 text-center">No pending listings.</p> : pendingProducts.map((p, i) => (
                    <div key={i} className="flex items-center justify-between px-4 py-3 border-b border-gray-50 last:border-0">
                      <div className="flex items-center gap-3">
                        <span className="text-xl">{String(p.emoji)}</span>
                        <div><p className="text-sm font-semibold text-gray-900">{String(p.name)}</p><p className="text-[11px] text-gray-400">{String(p.sellerName)} · {fmtZAR(Number(p.price))}</p></div>
                      </div>
                      <button onClick={async () => { await mktAdmin.approveProduct(String(p.id)); load(); }} className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg text-white shrink-0" style={{ background: "#10B981" }}><CheckCircle className="w-3.5 h-3.5" /> Approve</button>
                    </div>
                  ))}
                </div>
                <AllProductsPricing />
              </div>
            )}

            {tab === "orders" && (
              <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100"><span className="text-sm font-bold text-gray-900">All Orders ({orders.length})</span></div>
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-[11px] text-gray-400 border-b border-gray-100">
                    <th className="px-4 py-2 font-medium">Order</th><th className="px-4 py-2 font-medium">Customer</th>
                    <th className="px-4 py-2 font-medium">Amount</th><th className="px-4 py-2 font-medium">Status</th><th className="px-4 py-2 font-medium">Date</th>
                  </tr></thead>
                  <tbody>
                    {orders.slice(0, 50).map((o, i) => (
                      <tr key={i} className="border-b border-gray-50 last:border-0">
                        <td className="px-4 py-2.5 font-semibold text-gray-900">{String(o.orderNumber)}</td>
                        <td className="px-4 py-2.5 text-gray-500">{String(o.customerName)}</td>
                        <td className="px-4 py-2.5 font-bold text-gray-700">{fmtZAR(Number(o.totalAmount))}</td>
                        <td className="px-4 py-2.5 capitalize text-gray-600">{String(o.status).replace("_", " ")}</td>
                        <td className="px-4 py-2.5 text-gray-400">{new Date(String(o.placedAt)).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {tab === "supplyChain" && <SupplyChainPanel />}


            {tab === "financial" && (
              <div>
                <div className="grid sm:grid-cols-3 gap-3 mb-5">
                  <StatCard label="Platform revenue" value={fmtZAR(Number(stats?.totalRevenue ?? 0))} icon={<DollarSign className="w-4 h-4" />} accent="#059669" />
                  <StatCard label="Average commission" value={`${sellers.length ? (sellers.reduce((s, x) => s + Number(x.commissionPct ?? 0), 0) / sellers.length).toFixed(1) : 0}%`} icon={<Percent className="w-4 h-4" />} accent="#34A853" />
                  <StatCard label="Total orders" value={String(orders.length)} icon={<ShoppingBag className="w-4 h-4" />} accent="#B8862E" />
                </div>
                <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                  <div className="px-4 py-3 border-b border-gray-100"><span className="text-sm font-bold text-gray-900">Commission by Seller</span></div>
                  {sellers.map((s, i) => (
                    <div key={i} className="flex items-center justify-between px-4 py-2.5 border-b border-gray-50 last:border-0">
                      <span className="text-sm text-gray-800">{String(s.storeName)}</span>
                      <span className="text-sm font-semibold text-gray-600">{String(s.commissionPct)}%</span>
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-gray-400 mt-3">Payout scheduling, chargebacks and tax computation aren't wired up in this demo — commission rates shown are the seller-level percentages used elsewhere in the platform.</p>
              </div>
            )}

            {tab === "reports" && (
              <div className="bg-white rounded-xl border border-gray-100 p-5 max-w-md">
                <p className="text-sm font-bold text-gray-900 mb-1">Download Reports</p>
                <p className="text-xs text-gray-400 mb-4">Real exports of current marketplace data, generated on demand.</p>
                <div className="space-y-2">
                  <button onClick={() => downloadReport("orders")} disabled={downloading === "orders"}
                    className="w-full flex items-center gap-2 px-4 py-2.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                    <Download className="w-4 h-4" /> {downloading === "orders" ? "Downloading…" : "Orders report (CSV)"}
                  </button>
                  <button onClick={() => downloadReport("products")} disabled={downloading === "products"}
                    className="w-full flex items-center gap-2 px-4 py-2.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                    <Download className="w-4 h-4" /> {downloading === "products" ? "Downloading…" : "Products report (CSV)"}
                  </button>
                </div>
              </div>
            )}

            {tab === "security" && (
              <div className="bg-white rounded-xl border border-gray-100 p-5">
                <div className="flex items-center gap-2 mb-3"><Shield className="w-5 h-5 text-gray-400" /><p className="text-sm font-bold text-gray-900">Security & Fraud Monitoring</p></div>
                <p className="text-sm text-gray-500 mb-4">Live fraud detection, IP monitoring and audit logging aren't implemented in this demo — building real versions of these needs actual traffic/behavioural data and dedicated infrastructure. What's genuinely enforced right now:</p>
                <ul className="space-y-2 text-sm text-gray-700">
                  <li className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-green-500 shrink-0" /> Passwords are hashed with bcrypt, never stored in plain text</li>
                  <li className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-green-500 shrink-0" /> All dashboard routes require a valid signed-in session (JWT)</li>
                  <li className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-green-500 shrink-0" /> New products and sellers require manual approval before going live</li>
                  <li className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-green-500 shrink-0" /> API requests are rate-limited (300/min per IP)</li>
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// Ops view over the whole international sourcing pipeline: which suppliers
// exist, what's sitting at each of the 5 warehouse hubs, and the two-leg
// journey (origin QC -> consolidated shipment -> destination customs) every
// imported order line travels through.
const SUPPLIER_ORDER_NEXT: Record<string, string[]> = {
  ordered_from_supplier: ["received_at_origin_hub"],
  received_at_origin_hub: ["qc_passed_origin", "qc_failed_origin"],
  qc_passed_origin: ["in_transit_to_destination"],
  qc_failed_origin: [],
  in_transit_to_destination: ["received_at_destination_hub"],
  received_at_destination_hub: ["customs_cleared"],
  customs_cleared: ["shipped_to_customer"],
  shipped_to_customer: ["delivered"],
  delivered: [],
};

function SupplyChainPanel() {
  const [subTab, setSubTab] = useState<"suppliers" | "warehouses" | "orders" | "shipments" | "catalog">("orders");
  const [suppliers, setSuppliers] = useState<R[]>([]);
  const [warehouses, setWarehouses] = useState<R[]>([]);
  const [supplierOrders, setSupplierOrders] = useState<R[]>([]);
  const [shipments, setShipments] = useState<R[]>([]);
  const [catalog, setCatalog] = useState<R[]>([]);
  const [categories, setCategories] = useState<R[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [supRes, whRes, soRes, shRes, catRes, catgRes] = await Promise.allSettled([
      mktAdmin.suppliers.list(), mktAdmin.warehouses.list(), mktAdmin.supplierOrders.list(), mktAdmin.shipments.list(),
      mktAdmin.supplierProducts.list(), mktCategories(),
    ]);
    if (supRes.status === "fulfilled") setSuppliers(supRes.value.data as R[]);
    if (whRes.status === "fulfilled") setWarehouses(whRes.value.data as R[]);
    if (soRes.status === "fulfilled") setSupplierOrders(soRes.value.data as R[]);
    if (shRes.status === "fulfilled") setShipments(shRes.value.data as R[]);
    if (catRes.status === "fulfilled") setCatalog(catRes.value.data as R[]);
    if (catgRes.status === "fulfilled") setCategories(catgRes.value.data as R[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const advanceOrder = async (id: string, status: string) => {
    setBusyId(id);
    const res = await mktAdmin.supplierOrders.updateStatus(id, { status });
    setBusyId(null);
    if (!res.success) toast.error(res.error ?? "Could not update this order.");
    load();
  };

  const advanceShipment = async (id: string, status: string) => {
    setBusyId(id);
    const res = await mktAdmin.shipments.updateStatus(id, { status });
    setBusyId(null);
    if (!res.success) toast.error(res.error ?? "Could not update this shipment.");
    load();
  };

  const resolveOrder = async (id: string, action: "refund" | "reorder") => {
    if (action === "refund" && !confirm("Refund the customer for this order? This can't be undone.")) return;
    setBusyId(id);
    const res = await mktAdmin.supplierOrders.resolve(id, { action });
    setBusyId(null);
    if (!res.success) toast.error(res.error ?? "Could not resolve this order.");
    else toast.success(res.message ?? "Resolved.");
    load();
  };

  const SUB_TABS: { id: typeof subTab; label: string; icon: React.ReactNode }[] = [
    { id: "orders", label: "Supplier Orders", icon: <Package className="w-3.5 h-3.5" /> },
    { id: "shipments", label: "Shipments", icon: <Truck className="w-3.5 h-3.5" /> },
    { id: "warehouses", label: "Warehouses", icon: <Warehouse className="w-3.5 h-3.5" /> },
    { id: "suppliers", label: "Suppliers", icon: <Globe2 className="w-3.5 h-3.5" /> },
    { id: "catalog", label: "Supplier Catalog", icon: <Store className="w-3.5 h-3.5" /> },
  ];

  if (loading) return <div className="flex items-center justify-center h-40"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>;

  return (
    <div>
      <div className="flex gap-1 mb-4">
        {SUB_TABS.map(t => (
          <button key={t.id} onClick={() => setSubTab(t.id)}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg"
            style={{ background: subTab === t.id ? "#14110D" : "#F3F4F6", color: subTab === t.id ? "white" : "#374151" }}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {subTab === "orders" && (
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100"><span className="text-sm font-bold text-gray-900">Supplier Orders — two-leg fulfilment ({supplierOrders.length})</span></div>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[11px] text-gray-400 border-b border-gray-100">
              <th className="px-4 py-2 font-medium">Order</th><th className="px-4 py-2 font-medium">Product</th>
              <th className="px-4 py-2 font-medium">Seller</th><th className="px-4 py-2 font-medium">Route</th>
              <th className="px-4 py-2 font-medium">Status</th><th className="px-4 py-2 font-medium">Action</th>
            </tr></thead>
            <tbody>
              {supplierOrders.map((so, i) => {
                const next = SUPPLIER_ORDER_NEXT[String(so.status)] ?? [];
                return (
                  <tr key={i} className="border-b border-gray-50 last:border-0">
                    <td className="px-4 py-2.5 font-semibold text-gray-900">{String(so.orderNumber)}</td>
                    <td className="px-4 py-2.5 text-gray-600">{String(so.productName)}</td>
                    <td className="px-4 py-2.5 text-gray-500">{String(so.sellerName)}</td>
                    <td className="px-4 py-2.5 text-gray-400 text-xs">{String(so.originWarehouseName)} → {String(so.destinationWarehouseName)}</td>
                    <td className="px-4 py-2.5 capitalize text-gray-600 text-xs">{String(so.status).replace(/_/g, " ")}</td>
                    <td className="px-4 py-2.5">
                      {so.status === "qc_failed_origin" ? (
                        <>
                          <button onClick={() => resolveOrder(String(so.id), "refund")} disabled={busyId === so.id}
                            className="text-[11px] font-semibold px-2.5 py-1 rounded-lg text-white mr-1 disabled:opacity-50" style={{ background: "#DC2626" }}>
                            {busyId === so.id ? "..." : "Refund customer"}
                          </button>
                          <button onClick={() => resolveOrder(String(so.id), "reorder")} disabled={busyId === so.id}
                            className="text-[11px] font-semibold px-2.5 py-1 rounded-lg text-white disabled:opacity-50" style={{ background: "#B8862E" }}>
                            {busyId === so.id ? "..." : "Reorder from supplier"}
                          </button>
                        </>
                      ) : next.length ? next.map(n => (
                        <button key={n} onClick={() => advanceOrder(String(so.id), n)} disabled={busyId === so.id}
                          className="text-[11px] font-semibold px-2.5 py-1 rounded-lg text-white mr-1 disabled:opacity-50" style={{ background: n.includes("failed") ? "#DC2626" : "#B8862E" }}>
                          {busyId === so.id ? "..." : n.replace(/_/g, " ")}
                        </button>
                      )) : <span className="text-xs text-gray-300">—</span>}
                    </td>
                  </tr>
                );
              })}
              {!supplierOrders.length && <tr><td colSpan={6} className="px-4 py-6 text-center text-sm text-gray-400">No supplier orders yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {subTab === "shipments" && (
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100"><span className="text-sm font-bold text-gray-900">Shipments — consolidated 2nd-leg freight ({shipments.length})</span></div>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[11px] text-gray-400 border-b border-gray-100">
              <th className="px-4 py-2 font-medium">Route</th><th className="px-4 py-2 font-medium">Carrier</th>
              <th className="px-4 py-2 font-medium">Orders</th><th className="px-4 py-2 font-medium">Status</th><th className="px-4 py-2 font-medium">Action</th>
            </tr></thead>
            <tbody>
              {shipments.map((sh, i) => {
                const next: Record<string, string> = { in_transit: "received_at_destination", received_at_destination: "customs_cleared", customs_cleared: "closed" };
                const n = next[String(sh.status)];
                return (
                  <tr key={i} className="border-b border-gray-50 last:border-0">
                    <td className="px-4 py-2.5 text-gray-600 text-xs">{String(sh.originWarehouseName)} → {String(sh.destinationWarehouseName)}</td>
                    <td className="px-4 py-2.5 text-gray-500">{String(sh.carrier ?? "—")}</td>
                    <td className="px-4 py-2.5 text-gray-500">{String(sh.orderCount ?? 0)}</td>
                    <td className="px-4 py-2.5 capitalize text-gray-600 text-xs">{String(sh.status).replace(/_/g, " ")}</td>
                    <td className="px-4 py-2.5">
                      {n ? (
                        <button onClick={() => advanceShipment(String(sh.id), n)} disabled={busyId === sh.id}
                          className="text-[11px] font-semibold px-2.5 py-1 rounded-lg text-white disabled:opacity-50" style={{ background: "#B8862E" }}>
                          {busyId === sh.id ? "..." : `Mark ${n.replace(/_/g, " ")}`}
                        </button>
                      ) : <span className="text-xs text-gray-300">—</span>}
                    </td>
                  </tr>
                );
              })}
              {!shipments.length && <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-gray-400">No shipments yet — batch QC-passed orders once enough have accumulated at an origin hub.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {subTab === "warehouses" && <WarehouseManagement warehouses={warehouses} onChanged={load} />}

      {subTab === "suppliers" && <SupplierManagement suppliers={suppliers} onChanged={load} />}

      {subTab === "catalog" && <SupplierCatalogManagement catalog={catalog} suppliers={suppliers} categories={categories} onChanged={load} />}
    </div>
  );
}

function WarehouseManagement({ warehouses, onChanged }: { warehouses: R[]; onChanged: () => void }) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", country: "CN", type: "origin", address: "" });
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!form.name) return;
    setSaving(true);
    const res = await mktAdmin.warehouses.create(form);
    setSaving(false);
    if (!res.success) { toast.error(res.error ?? "Could not create warehouse."); return; }
    setAdding(false);
    setForm({ name: "", country: "CN", type: "origin", address: "" });
    onChanged();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-bold text-gray-900">Warehouses ({warehouses.length})</span>
        <button onClick={() => setAdding(a => !a)} className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg text-white" style={{ background: "#14110D" }}>
          <Plus className="w-3.5 h-3.5" /> Add warehouse
        </button>
      </div>

      {adding && (
        <div className="bg-white rounded-xl border border-gray-100 p-4 grid sm:grid-cols-2 gap-2 mb-4">
          <input placeholder="Warehouse name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="border border-gray-200 rounded px-2.5 py-1.5 text-sm" />
          <select value={form.country} onChange={e => setForm({ ...form, country: e.target.value })} className="border border-gray-200 rounded px-2.5 py-1.5 text-sm">
            {["CN", "JP", "KR", "ZA", "ZM"].map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} className="border border-gray-200 rounded px-2.5 py-1.5 text-sm">
            <option value="origin">Origin (near suppliers)</option>
            <option value="destination">Destination (customer-facing)</option>
          </select>
          <input placeholder="Address" value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} className="border border-gray-200 rounded px-2.5 py-1.5 text-sm" />
          <button onClick={submit} disabled={saving || !form.name} className="sm:col-span-2 py-1.5 rounded text-white text-sm font-semibold disabled:opacity-50" style={{ background: "#B8862E" }}>{saving ? "Saving..." : "Add warehouse"}</button>
        </div>
      )}

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {warehouses.map((w, i) => (
          <div key={i} className="bg-white rounded-xl border border-gray-100 p-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-bold text-gray-900">{String(w.name)}</span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: w.type === "origin" ? "#EFF6FF" : "#ECFDF5", color: w.type === "origin" ? "#1D4ED8" : "#059669" }}>{String(w.type)}</span>
            </div>
            <p className="text-xs text-gray-400">{String(w.country)} · {String(w.address ?? "")}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function SupplierManagement({ suppliers, onChanged }: { suppliers: R[]; onChanged: () => void }) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", country: "CN", contactName: "", contactEmail: "", contactPhone: "", platform: "", paymentTerms: "", leadTimeDays: "14", verified: false });
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!form.name) return;
    setSaving(true);
    const res = await mktAdmin.suppliers.create({ ...form, leadTimeDays: Number(form.leadTimeDays) || 14 });
    setSaving(false);
    if (!res.success) { toast.error(res.error ?? "Could not create supplier."); return; }
    setAdding(false);
    setForm({ name: "", country: "CN", contactName: "", contactEmail: "", contactPhone: "", platform: "", paymentTerms: "", leadTimeDays: "14", verified: false });
    onChanged();
  };

  const toggleVerified = async (s: R) => {
    await mktAdmin.suppliers.update(String(s.id), { verified: !s.verified });
    onChanged();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-bold text-gray-900">Suppliers ({suppliers.length})</span>
        <button onClick={() => setAdding(a => !a)} className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg text-white" style={{ background: "#14110D" }}>
          <Plus className="w-3.5 h-3.5" /> Add supplier
        </button>
      </div>

      {adding && (
        <div className="bg-white rounded-xl border border-gray-100 p-4 grid sm:grid-cols-3 gap-2 mb-4">
          <input placeholder="Supplier / company name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="border border-gray-200 rounded px-2.5 py-1.5 text-sm sm:col-span-2" />
          <select value={form.country} onChange={e => setForm({ ...form, country: e.target.value })} className="border border-gray-200 rounded px-2.5 py-1.5 text-sm">
            {["CN", "JP", "KR"].map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <input placeholder="Contact name" value={form.contactName} onChange={e => setForm({ ...form, contactName: e.target.value })} className="border border-gray-200 rounded px-2.5 py-1.5 text-sm" />
          <input placeholder="Contact email" value={form.contactEmail} onChange={e => setForm({ ...form, contactEmail: e.target.value })} className="border border-gray-200 rounded px-2.5 py-1.5 text-sm" />
          <input placeholder="Contact phone" value={form.contactPhone} onChange={e => setForm({ ...form, contactPhone: e.target.value })} className="border border-gray-200 rounded px-2.5 py-1.5 text-sm" />
          <input placeholder="Platform (e.g. Alibaba, KOTRA)" value={form.platform} onChange={e => setForm({ ...form, platform: e.target.value })} className="border border-gray-200 rounded px-2.5 py-1.5 text-sm" />
          <input placeholder="Payment terms" value={form.paymentTerms} onChange={e => setForm({ ...form, paymentTerms: e.target.value })} className="border border-gray-200 rounded px-2.5 py-1.5 text-sm" />
          <input placeholder="Lead time (days)" type="number" value={form.leadTimeDays} onChange={e => setForm({ ...form, leadTimeDays: e.target.value })} className="border border-gray-200 rounded px-2.5 py-1.5 text-sm" />
          <label className="flex items-center gap-2 text-xs text-gray-600 px-1">
            <input type="checkbox" checked={form.verified} onChange={e => setForm({ ...form, verified: e.target.checked })} /> Verified (sample order confirmed)
          </label>
          <button onClick={submit} disabled={saving || !form.name} className="sm:col-span-3 py-1.5 rounded text-white text-sm font-semibold disabled:opacity-50" style={{ background: "#B8862E" }}>{saving ? "Saving..." : "Add supplier"}</button>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-[11px] text-gray-400 border-b border-gray-100">
            <th className="px-4 py-2 font-medium">Name</th><th className="px-4 py-2 font-medium">Country</th>
            <th className="px-4 py-2 font-medium">Platform</th><th className="px-4 py-2 font-medium">Lead time</th>
            <th className="px-4 py-2 font-medium">Payment terms</th><th className="px-4 py-2 font-medium">Verified</th>
          </tr></thead>
          <tbody>
            {suppliers.map((s, i) => (
              <tr key={i} className="border-b border-gray-50 last:border-0">
                <td className="px-4 py-2.5 font-semibold text-gray-900">{String(s.name)}</td>
                <td className="px-4 py-2.5 text-gray-500">{String(s.country)}</td>
                <td className="px-4 py-2.5 text-gray-500">{String(s.platform ?? "—")}</td>
                <td className="px-4 py-2.5 text-gray-500">{String(s.leadTimeDays)} days</td>
                <td className="px-4 py-2.5 text-gray-400 text-xs">{String(s.paymentTerms ?? "—")}</td>
                <td className="px-4 py-2.5">
                  <button onClick={() => toggleVerified(s)} className="flex items-center gap-1">
                    {s.verified ? <CheckCircle className="w-4 h-4 text-green-500" /> : <Clock className="w-4 h-4 text-amber-400" />}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SupplierCatalogManagement({ catalog, suppliers, categories, onChanged }: { catalog: R[]; suppliers: R[]; categories: R[]; onChanged: () => void }) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ supplierId: "", categoryId: "", name: "", description: "", costPrice: "", currency: "USD", retailPrice: "", compareAtPrice: "", moq: "10", originCountry: "CN", emoji: "📦" });
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [priceEdit, setPriceEdit] = useState({ retailPrice: "", compareAtPrice: "" });
  const [savingPrice, setSavingPrice] = useState(false);

  const submit = async () => {
    if (!form.supplierId || !form.name || !form.costPrice) return;
    setSaving(true);
    const res = await mktAdmin.supplierProducts.create({
      ...form, costPrice: Number(form.costPrice), moq: Number(form.moq) || 1,
      retailPrice: Number(form.retailPrice) || 0, compareAtPrice: form.compareAtPrice ? Number(form.compareAtPrice) : undefined,
    });
    setSaving(false);
    if (!res.success) { toast.error(res.error ?? "Could not add catalog item."); return; }
    setAdding(false);
    setForm({ supplierId: "", categoryId: "", name: "", description: "", costPrice: "", currency: "USD", retailPrice: "", compareAtPrice: "", moq: "10", originCountry: "CN", emoji: "📦" });
    onChanged();
  };

  const startEditPrice = (item: R) => {
    setEditingId(String(item.id));
    setPriceEdit({ retailPrice: String(item.retailPrice ?? ""), compareAtPrice: item.compareAtPrice !== null && item.compareAtPrice !== undefined ? String(item.compareAtPrice) : "" });
  };

  const savePrice = async (id: string) => {
    if (!priceEdit.retailPrice) return;
    setSavingPrice(true);
    const res = await mktAdmin.supplierProducts.update(id, {
      retailPrice: Number(priceEdit.retailPrice),
      compareAtPrice: priceEdit.compareAtPrice ? Number(priceEdit.compareAtPrice) : null,
    });
    setSavingPrice(false);
    if (!res.success) { toast.error(res.error ?? "Could not update price."); return; }
    setEditingId(null);
    onChanged();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-bold text-gray-900">Supplier Catalog ({catalog.length}) — what sellers can import</span>
        <button onClick={() => setAdding(a => !a)} className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg text-white" style={{ background: "#14110D" }}>
          <Plus className="w-3.5 h-3.5" /> Add catalog item
        </button>
      </div>
      <p className="text-xs text-gray-400 mb-3">Retail price and discount are set here by the marketplace team on the supplier's behalf — sellers who import an item get this price as-is and can't change it themselves.</p>

      {adding && (
        <div className="bg-white rounded-xl border border-gray-100 p-4 grid sm:grid-cols-3 gap-2 mb-4">
          <select value={form.supplierId} onChange={e => {
            const sup = suppliers.find(s => s.id === e.target.value);
            setForm({ ...form, supplierId: e.target.value, originCountry: (sup?.country as string) ?? form.originCountry });
          }} className="border border-gray-200 rounded px-2.5 py-1.5 text-sm sm:col-span-2">
            <option value="">Select supplier...</option>
            {suppliers.map(s => <option key={String(s.id)} value={String(s.id)}>{String(s.name)} ({String(s.country)})</option>)}
          </select>
          <select value={form.categoryId} onChange={e => setForm({ ...form, categoryId: e.target.value })} className="border border-gray-200 rounded px-2.5 py-1.5 text-sm">
            <option value="">Select category...</option>
            {categories.map(c => <option key={String(c.id)} value={String(c.id)}>{String(c.name)}</option>)}
          </select>
          <input placeholder="Item name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="border border-gray-200 rounded px-2.5 py-1.5 text-sm sm:col-span-2" />
          <input placeholder="Emoji" value={form.emoji} onChange={e => setForm({ ...form, emoji: e.target.value })} className="border border-gray-200 rounded px-2.5 py-1.5 text-sm" />
          <input placeholder="Cost price" type="number" step="0.01" value={form.costPrice} onChange={e => setForm({ ...form, costPrice: e.target.value })} className="border border-gray-200 rounded px-2.5 py-1.5 text-sm" />
          <select value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value })} className="border border-gray-200 rounded px-2.5 py-1.5 text-sm">
            {["USD", "CNY", "JPY", "KRW"].map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <input placeholder="MOQ" type="number" value={form.moq} onChange={e => setForm({ ...form, moq: e.target.value })} className="border border-gray-200 rounded px-2.5 py-1.5 text-sm" />
          <input placeholder="Retail price (ZAR)" type="number" step="0.01" value={form.retailPrice} onChange={e => setForm({ ...form, retailPrice: e.target.value })} className="border border-gray-200 rounded px-2.5 py-1.5 text-sm" />
          <input placeholder="Discount / was-price (ZAR, optional)" type="number" step="0.01" value={form.compareAtPrice} onChange={e => setForm({ ...form, compareAtPrice: e.target.value })} className="border border-gray-200 rounded px-2.5 py-1.5 text-sm sm:col-span-2" />
          <input placeholder="Description" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className="border border-gray-200 rounded px-2.5 py-1.5 text-sm sm:col-span-3" />
          <button onClick={submit} disabled={saving || !form.supplierId || !form.name || !form.costPrice} className="sm:col-span-3 py-1.5 rounded text-white text-sm font-semibold disabled:opacity-50" style={{ background: "#B8862E" }}>{saving ? "Saving..." : "Add to catalog"}</button>
        </div>
      )}

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {catalog.map((item, i) => (
          <div key={i} className="bg-white rounded-xl border border-gray-100 p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-2xl">{String(item.emoji ?? "📦")}</span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">{String(item.originCountry)}</span>
            </div>
            <p className="text-sm font-bold text-gray-900 leading-tight mb-1">{String(item.name)}</p>
            <p className="text-[11px] text-gray-400 mb-1">{String(item.supplierName)} · MOQ {String(item.moq)}</p>
            <p className="text-xs font-semibold text-gray-600 mb-2">Cost: {String(item.currency)} {Number(item.costPrice).toFixed(2)} · Imported {String(item.importCount ?? 0)}x</p>

            {editingId === item.id ? (
              <div className="space-y-1.5">
                <input placeholder="Retail price (ZAR)" type="number" step="0.01" value={priceEdit.retailPrice}
                  onChange={e => setPriceEdit({ ...priceEdit, retailPrice: e.target.value })}
                  className="w-full border border-gray-200 rounded px-2 py-1 text-xs" />
                <input placeholder="Discount / was-price (optional)" type="number" step="0.01" value={priceEdit.compareAtPrice}
                  onChange={e => setPriceEdit({ ...priceEdit, compareAtPrice: e.target.value })}
                  className="w-full border border-gray-200 rounded px-2 py-1 text-xs" />
                <div className="flex gap-1.5">
                  <button onClick={() => savePrice(String(item.id))} disabled={savingPrice || !priceEdit.retailPrice}
                    className="flex-1 text-[11px] font-semibold px-2 py-1.5 rounded-lg text-white disabled:opacity-50" style={{ background: "#B8862E" }}>
                    {savingPrice ? "Saving..." : "Save"}
                  </button>
                  <button onClick={() => setEditingId(null)} className="text-[11px] font-semibold px-2 py-1.5 rounded-lg border border-gray-200 text-gray-600">Cancel</button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <div className="flex items-baseline gap-1.5">
                  {Number(item.retailPrice) > 0 ? (
                    <>
                      <span className="text-sm font-bold text-gray-900">R{Number(item.retailPrice).toFixed(2)}</span>
                      {item.compareAtPrice && Number(item.compareAtPrice) > Number(item.retailPrice) && (
                        <span className="text-[11px] text-gray-400 line-through">R{Number(item.compareAtPrice).toFixed(2)}</span>
                      )}
                    </>
                  ) : <span className="text-xs font-semibold text-amber-600">No price set</span>}
                </div>
                <button onClick={() => startEditPrice(item)} className="text-[11px] font-semibold text-amber-700 hover:underline">Edit price</button>
              </div>
            )}
          </div>
        ))}
        {!catalog.length && <p className="text-sm text-gray-400 p-6 text-center col-span-full">No catalog items yet.</p>}
      </div>
    </div>
  );
}

// Browse every listing (any status/seller/fulfilment type) and edit its
// price + discount directly — the manager-only counterpart to sellers no
// longer being able to touch price/compareAtPrice themselves.
function AllProductsPricing() {
  const [products, setProducts] = useState<R[]>([]);
  const [search, setSearch] = useState("");
  const [fulfillmentFilter, setFulfillmentFilter] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [priceEdit, setPriceEdit] = useState({ price: "", compareAtPrice: "" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const params: Record<string, string> = {};
    if (search) params.search = search;
    if (fulfillmentFilter) params.fulfillmentType = fulfillmentFilter;
    const res = await mktAdmin.allProducts(params);
    if (res.success) setProducts(res.data as R[]);
    setLoading(false);
  }, [search, fulfillmentFilter]);

  useEffect(() => { load(); }, [load]);

  const startEdit = (p: R) => {
    setEditingId(String(p.id));
    setPriceEdit({ price: String(p.price ?? ""), compareAtPrice: p.compareAtPrice !== null && p.compareAtPrice !== undefined ? String(p.compareAtPrice) : "" });
  };

  const save = async (id: string) => {
    if (!priceEdit.price) return;
    setSaving(true);
    const res = await mktAdmin.updateProductPrice(id, { price: Number(priceEdit.price), compareAtPrice: priceEdit.compareAtPrice ? Number(priceEdit.compareAtPrice) : null });
    setSaving(false);
    if (!res.success) { toast.error(res.error ?? "Could not update price."); return; }
    setEditingId(null);
    load();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-bold text-gray-900">All Products & Pricing</span>
      </div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input placeholder="Search by product or store name..." value={search} onChange={e => setSearch(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm w-64" />
        {[{ id: "", label: "All" }, { id: "local", label: "Local" }, { id: "imported", label: "Imported" }].map(f => (
          <button key={f.id} onClick={() => setFulfillmentFilter(f.id)}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg border"
            style={{ background: fulfillmentFilter === f.id ? "#14110D" : "white", color: fulfillmentFilter === f.id ? "white" : "#374151", borderColor: fulfillmentFilter === f.id ? "#14110D" : "#E5E7EB" }}>
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-32"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[11px] text-gray-400 border-b border-gray-100">
              <th className="px-4 py-2 font-medium">Product</th><th className="px-4 py-2 font-medium">Store</th>
              <th className="px-4 py-2 font-medium">Source</th><th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Price / Discount</th><th className="px-4 py-2 font-medium">Action</th>
            </tr></thead>
            <tbody>
              {products.map((p, i) => (
                <tr key={i} className="border-b border-gray-50 last:border-0 align-top">
                  <td className="px-4 py-2.5 font-semibold text-gray-900">{String(p.emoji ?? "📦")} {String(p.name)}</td>
                  <td className="px-4 py-2.5 text-gray-500">{String(p.sellerName)}</td>
                  <td className="px-4 py-2.5 text-gray-500 capitalize">{String(p.fulfillmentType ?? "local")}</td>
                  <td className="px-4 py-2.5 text-gray-500 capitalize">{String(p.status).replace("_", " ")}</td>
                  <td className="px-4 py-2.5">
                    {editingId === p.id ? (
                      <div className="flex items-center gap-1.5">
                        <input type="number" step="0.01" placeholder="Price" value={priceEdit.price} onChange={e => setPriceEdit({ ...priceEdit, price: e.target.value })} className="border border-gray-200 rounded px-2 py-1 text-xs w-20" />
                        <input type="number" step="0.01" placeholder="Was" value={priceEdit.compareAtPrice} onChange={e => setPriceEdit({ ...priceEdit, compareAtPrice: e.target.value })} className="border border-gray-200 rounded px-2 py-1 text-xs w-20" />
                      </div>
                    ) : (
                      <span className="text-gray-700 font-medium">
                        {fmtZAR(Number(p.price))}
                        {p.compareAtPrice ? <span className="text-gray-400 line-through ml-1.5 text-xs">{fmtZAR(Number(p.compareAtPrice))}</span> : null}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    {editingId === p.id ? (
                      <div className="flex gap-1">
                        <button onClick={() => save(String(p.id))} disabled={saving} className="text-[11px] font-semibold px-2.5 py-1 rounded-lg text-white disabled:opacity-50" style={{ background: "#B8862E" }}>{saving ? "..." : "Save"}</button>
                        <button onClick={() => setEditingId(null)} className="text-[11px] font-semibold px-2.5 py-1 rounded-lg border border-gray-200 text-gray-600">Cancel</button>
                      </div>
                    ) : (
                      <button onClick={() => startEdit(p)} className="text-[11px] font-semibold text-amber-700 hover:underline">Edit price</button>
                    )}
                  </td>
                </tr>
              ))}
              {!products.length && <tr><td colSpan={6} className="px-4 py-6 text-center text-sm text-gray-400">No products match this filter.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
