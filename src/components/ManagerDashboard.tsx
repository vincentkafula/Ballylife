import { useState, useEffect, useCallback } from "react";
import {
  BarChart3, Users, Store, Package, ShoppingBag, DollarSign, CheckCircle, XCircle,
  Download, Loader2, Clock, Shield, Percent, FileText, Globe2, Warehouse, Truck,
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { mktAdmin, mktSellers, getMktToken, type MktAuthUser } from "../services/marketplaceApi";
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
              <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
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
  const [subTab, setSubTab] = useState<"suppliers" | "warehouses" | "orders" | "shipments">("orders");
  const [suppliers, setSuppliers] = useState<R[]>([]);
  const [warehouses, setWarehouses] = useState<R[]>([]);
  const [supplierOrders, setSupplierOrders] = useState<R[]>([]);
  const [shipments, setShipments] = useState<R[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [supRes, whRes, soRes, shRes] = await Promise.allSettled([
      mktAdmin.suppliers.list(), mktAdmin.warehouses.list(), mktAdmin.supplierOrders.list(), mktAdmin.shipments.list(),
    ]);
    if (supRes.status === "fulfilled") setSuppliers(supRes.value.data as R[]);
    if (whRes.status === "fulfilled") setWarehouses(whRes.value.data as R[]);
    if (soRes.status === "fulfilled") setSupplierOrders(soRes.value.data as R[]);
    if (shRes.status === "fulfilled") setShipments(shRes.value.data as R[]);
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

  const SUB_TABS: { id: typeof subTab; label: string; icon: React.ReactNode }[] = [
    { id: "orders", label: "Supplier Orders", icon: <Package className="w-3.5 h-3.5" /> },
    { id: "shipments", label: "Shipments", icon: <Truck className="w-3.5 h-3.5" /> },
    { id: "warehouses", label: "Warehouses", icon: <Warehouse className="w-3.5 h-3.5" /> },
    { id: "suppliers", label: "Suppliers", icon: <Globe2 className="w-3.5 h-3.5" /> },
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
                      {next.length ? next.map(n => (
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

      {subTab === "warehouses" && (
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
      )}

      {subTab === "suppliers" && (
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100"><span className="text-sm font-bold text-gray-900">Suppliers ({suppliers.length})</span></div>
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
                  <td className="px-4 py-2.5">{s.verified ? <CheckCircle className="w-4 h-4 text-green-500" /> : <Clock className="w-4 h-4 text-amber-400" />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
