/**
 * Admin: seller sourcing -- which suppliers are on, cache and price
 * settings, plan limits, each seller's plan and usage, supplier-call spend,
 * and a test search that shows exactly what sellers see.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCircle, Loader2, RefreshCw, Search, Trash2, XCircle } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from "recharts";
import { mktSourcingAdmin, ApiConnectionError } from "../services/marketplaceApi";

type R = Record<string, any>;
type Limits = { searchesPerDay: number; viewsPerDay: number; activeImports: number; importsPerMonth: number };
const PLAN_IDS = ["starter", "standard", "pro"] as const;
const LIMIT_LABELS: [keyof Limits, string][] = [
  ["searchesPerDay", "Searches / day"], ["viewsPerDay", "Products opened / day"], ["activeImports", "Imported in store"], ["importsPerMonth", "Imports / month"],
];
const SUPPLIER_LABEL: Record<string, string> = { aliexpress: "AliExpress", cj: "CJdropshipping (incl. 1688 via CJ)" };
const rand = (n: number) => `R${Math.round(n).toLocaleString("en-ZA")}`;
const errMessage = (err: unknown, fallback: string) => (err instanceof ApiConnectionError ? err.message : fallback);

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-3">
      <p className="text-lg font-black text-gray-900">{value}</p>
      <p className="text-[11px] text-gray-500">{label}</p>
      {sub && <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

function Card({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4 mb-4">
      <div className="flex items-center justify-between mb-3"><p className="text-sm font-bold text-gray-900">{title}</p>{action}</div>
      {children}
    </div>
  );
}

export function SourcingAdminPanel() {
  const [data, setData] = useState<R | null>(null);
  const [days, setDays] = useState(14);
  const [busy, setBusy] = useState<string | null>(null);
  const [settings, setSettings] = useState({ cacheHours: "", fxBufferPct: "" });
  const [plans, setPlans] = useState<Record<string, Limits> | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await mktSourcingAdmin.overview(days);
      if (!r.success) { toast.error(r.error ?? "Couldn't load sourcing."); return; }
      setData(r.data);
      setSettings({ cacheHours: String(r.data.settings.cacheHours), fxBufferPct: String(r.data.settings.fxBufferPct) });
      setPlans(r.data.plans);
    } catch (err) { toast.error(errMessage(err, "Couldn't load sourcing.")); }
  }, [days]);
  useEffect(() => { void load(); }, [load]);

  const run = async (key: string, fn: () => Promise<{ success: boolean; error?: string }>, done: string) => {
    setBusy(key);
    try { const r = await fn(); if (r.success) { toast.success(done); await load(); } else toast.error(r.error ?? "That didn't work."); }
    catch (err) { toast.error(errMessage(err, "That didn't work.")); }
    finally { setBusy(null); }
  };

  if (!data) return <div className="flex items-center justify-center h-40"><Loader2 className="w-6 h-6 animate-spin text-gray-500" /></div>;
  const t = data.totals;
  const usageBy = new Map<string, R>((data.byAdapter ?? []).map((a: R) => [a.adapter, a]));

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div>
          <p className="text-base font-bold text-gray-900">Seller sourcing</p>
          <p className="text-xs text-gray-500">Sellers search suppliers through Ballylife. They never see supplier names, links or supplier prices.</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={days} onChange={e => setDays(Number(e.target.value))} className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white">
            {[7, 14, 30, 90].map(d => <option key={d} value={d}>Last {d} days</option>)}
          </select>
          <button onClick={() => void load()} className="p-1.5 rounded-lg border border-gray-200 bg-white" aria-label="Refresh"><RefreshCw className="w-4 h-4 text-gray-600" /></button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Stat label="Supplier calls" value={t.live.toLocaleString()} sub={`${t.errors} failed`} />
        <Stat label="Answered from cache" value={t.cached.toLocaleString()} sub={`${Math.round(t.cacheHitRate * 100)}% of requests · ${t.cachedEntries} saved`} />
        <Stat label="Seller products (live / waiting)" value={`${data.listings.active} / ${data.listings.pending}`} sub={`${data.listings.outOfStock} out of stock`} />
        <Stat label="Sales of sourced products" value={rand(data.sales.grossZar)} sub={`${data.sales.units} units · ${rand(data.sales.commissionZar)} commission`} />
      </div>

      <AwaitingOrders onChanged={load} />

      <Card title="Supplier requests per day">
        <div style={{ height: 200 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.daily}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
              <XAxis dataKey="day" tickFormatter={(d: string) => d.slice(5)} fontSize={10} />
              <YAxis allowDecimals={false} fontSize={10} width={32} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="live" name="Supplier calls" stackId="a" fill="#B8862E" />
              <Bar dataKey="cached" name="From cache" stackId="a" fill="#0B5C2E" />
            </BarChart>
          </ResponsiveContainer>
        </div>
        {data.capped && <p className="text-[11px] text-amber-700 mt-1">Very busy period: only the most recent 200,000 requests are counted.</p>}
      </Card>

      <Card title="Suppliers">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="text-left text-gray-500"><th className="py-1.5">Supplier</th><th>Keys set up</th><th>Calls</th><th>Cache</th><th>Failed</th><th>New orders</th><th className="text-right">On</th></tr></thead>
            <tbody>
              {data.suppliers.map((s: R) => {
                const u = usageBy.get(s.key) ?? {};
                return (
                  <tr key={s.key} className="border-t border-gray-100">
                    <td className="py-2 font-semibold text-gray-900">{SUPPLIER_LABEL[s.key] ?? s.key}</td>
                    <td>{s.configured ? <span className="text-emerald-700">Yes</span> : <span className="text-red-600">No — check keys / connection</span>}</td>
                    <td>{u.live ?? 0}</td><td>{u.cached ?? 0}</td><td>{u.errors ?? 0}</td>
                    <td>
                      <select value={s.orderMode} disabled={busy === `mode-${s.key}`}
                        onChange={e => void run(`mode-${s.key}`, () => mktSourcingAdmin.setOrderMode(s.key, e.target.value as "auto" | "approval"), e.target.value === "auto" ? "Orders go to the supplier automatically" : "Orders now wait for your approval")}
                        className="border border-gray-200 rounded-md px-1.5 py-1 text-xs bg-white">
                        <option value="auto">Place automatically</option>
                        <option value="approval">I approve first</option>
                      </select>
                    </td>
                    <td className="text-right">
                      <button disabled={busy === `sup-${s.key}`}
                        onClick={() => void run(`sup-${s.key}`, () => mktSourcingAdmin.setSupplier(s.key, !s.enabled), s.enabled ? "Supplier switched off" : "Supplier switched on")}
                        className="px-3 py-1 rounded-full text-[11px] font-semibold disabled:opacity-40"
                        style={{ background: s.enabled ? "#0B5C2E" : "#E5E7EB", color: s.enabled ? "white" : "#374151" }}>
                        {s.enabled ? "On" : "Off"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Settings" action={
        <button disabled={busy === "cache"} onClick={() => { if (confirm("Clear all saved supplier answers? The next searches will call suppliers again.")) void run("cache", () => mktSourcingAdmin.clearCache(), "Cache cleared"); }}
          className="flex items-center gap-1 text-xs font-semibold text-red-700 disabled:opacity-40"><Trash2 className="w-3.5 h-3.5" />Clear cache</button>
      }>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-gray-600">Keep supplier answers for (hours)
            <input type="number" min={1} max={336} value={settings.cacheHours} onChange={e => setSettings({ ...settings, cacheHours: e.target.value })} className="block w-32 border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm mt-1" />
          </label>
          <label className="text-xs text-gray-600">Exchange-rate buffer (%)
            <input type="number" min={0} max={25} step="0.5" value={settings.fxBufferPct} onChange={e => setSettings({ ...settings, fxBufferPct: e.target.value })} className="block w-32 border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm mt-1" />
          </label>
          <button disabled={busy === "settings"} onClick={() => void run("settings", () => mktSourcingAdmin.saveSettings({ cacheHours: Number(settings.cacheHours), fxBufferPct: Number(settings.fxBufferPct) }), "Settings saved")}
            className="px-4 py-2 rounded-lg text-white text-xs font-semibold disabled:opacity-40" style={{ background: "#B8862E" }}>Save</button>
        </div>
        <p className="text-[11px] text-gray-500 mt-2">A longer cache means fewer supplier calls but slower price and stock updates. The buffer is added to supplier costs to absorb rand movements.</p>
      </Card>

      {plans && (
        <Card title="Plan limits" action={
          <button disabled={busy === "plans"} onClick={() => void run("plans", () => mktSourcingAdmin.savePlans(plans), "Plan limits saved")}
            className="px-4 py-1.5 rounded-lg text-white text-xs font-semibold disabled:opacity-40" style={{ background: "#B8862E" }}>Save</button>
        }>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-left text-gray-500"><th className="py-1.5">Limit</th>{PLAN_IDS.map(p => <th key={p}>{data.planNames[p]}</th>)}</tr></thead>
              <tbody>
                {LIMIT_LABELS.map(([k, label]) => (
                  <tr key={k} className="border-t border-gray-100">
                    <td className="py-1.5 text-gray-700">{label}</td>
                    {PLAN_IDS.map(p => (
                      <td key={p}>
                        <input type="number" min={0} value={plans[p][k]} onChange={e => setPlans({ ...plans, [p]: { ...plans[p], [k]: Number(e.target.value) } })}
                          className="w-20 border border-gray-200 rounded-md px-2 py-1 text-xs" />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <BillingCard billing={data.billing} onChanged={load} />

      <SellerPlans planNames={data.planNames} />
      <TestSearch />
    </div>
  );
}

function AwaitingOrders({ onChanged }: { onChanged: () => void }) {
  const [rows, setRows] = useState<R[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { const r = await mktSourcingAdmin.awaiting(); if (r.success) setRows(r.data); }
    catch (err) { toast.error(errMessage(err, "Couldn't load waiting orders.")); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const act = async (o: R, approve: boolean) => {
    let reason = "";
    if (!approve) {
      const r = prompt(`Why aren't you approving ${o.orderNumber}? (The customer will need a refund.)`);
      if (r === null) return;
      reason = r;
    }
    setBusy(o.id);
    try {
      const r = approve ? await mktSourcingAdmin.approve(o.supplier, o.id) : await mktSourcingAdmin.reject(o.supplier, o.id, reason);
      if (r.success) toast.success(r.message ?? "Done"); else toast.error(r.error ?? "That didn't work.");
      await load(); onChanged();
    } catch (err) { toast.error(errMessage(err, "That didn't work.")); }
    finally { setBusy(null); }
  };

  if (!rows || rows.length === 0) return null;
  return (
    <Card title={`Orders waiting for approval (${rows.length})`}>
      <div className="space-y-2">
        {rows.map(o => (
          <div key={o.id} className="border border-amber-200 bg-amber-50/40 rounded-lg p-3 flex flex-wrap items-start justify-between gap-3">
            <div className="text-xs">
              <p className="font-bold text-gray-900">{o.orderNumber} <span className="font-normal text-gray-500">· {SUPPLIER_LABEL[o.supplier] ?? o.supplier} · {new Date(o.placedAt).toLocaleString("en-ZA", { dateStyle: "medium", timeStyle: "short" })}{o.customerCity ? ` · ${o.customerCity}` : ""}</span></p>
              {o.lines.map((l: R, i: number) => <p key={i} className="text-gray-700">{l.quantity} × {l.name}{l.sellerName ? <span className="text-gray-500"> ({l.sellerName})</span> : null}</p>)}
              <p className="mt-1 text-gray-600">Sale {rand(o.saleZar)} · Supplier cost {o.supplierCostZar === null ? "unknown" : rand(o.supplierCostZar)} ·{" "}
                <span className="font-semibold" style={{ color: o.marginZar === null ? "#6B7280" : o.marginZar > 0 ? "#0B5C2E" : "#DC2626" }}>margin {o.marginZar === null ? "unknown" : rand(o.marginZar)}</span></p>
            </div>
            <div className="flex gap-2">
              <button disabled={busy === o.id} onClick={() => void act(o, true)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-white text-xs font-semibold disabled:opacity-40" style={{ background: "#0B5C2E" }}><CheckCircle className="w-3.5 h-3.5" />Approve</button>
              <button disabled={busy === o.id} onClick={() => void act(o, false)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold border border-red-200 text-red-700 bg-white disabled:opacity-40"><XCircle className="w-3.5 h-3.5" />Don't approve</button>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function BillingCard({ billing, onChanged }: { billing: R; onChanged: () => void }) {
  const [price, setPrice] = useState(String(billing.priceZar));
  const [busy, setBusy] = useState(false);
  useEffect(() => { setPrice(String(billing.priceZar)); }, [billing.priceZar]);
  const save = async (body: { enabled?: boolean; priceZar?: number }, done: string) => {
    setBusy(true);
    try { const r = await mktSourcingAdmin.saveBilling(body); if (r.success) { toast.success(done); onChanged(); } else toast.error(r.error ?? "Couldn't save."); }
    catch (err) { toast.error(errMessage(err, "Couldn't save.")); }
    finally { setBusy(false); }
  };
  const toggle = () => {
    const turningOn = !billing.enabled;
    const msg = turningOn
      ? `Start charging sellers R${Number(billing.priceZar).toLocaleString("en-ZA")}/month for product sourcing? From now on, sellers without a subscription (or free access) can't search or add new products. Products already in their stores keep selling.`
      : "Stop requiring a subscription? Every approved seller can use sourcing for free. Existing subscriptions keep billing until cancelled on PayFast or by the seller.";
    if (confirm(msg)) void save({ enabled: turningOn }, turningOn ? "Sourcing billing is on" : "Sourcing billing is off");
  };
  return (
    <Card title="Seller billing" action={
      <button disabled={busy} onClick={toggle} className="px-3 py-1 rounded-full text-[11px] font-semibold disabled:opacity-40"
        style={{ background: billing.enabled ? "#0B5C2E" : "#E5E7EB", color: billing.enabled ? "white" : "#374151" }}>
        {billing.enabled ? "On — sellers pay" : "Off — sourcing is free"}
      </button>
    }>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        <Stat label="Paying sellers" value={String(billing.active)} />
        <Stat label="Payment overdue" value={String(billing.pastDue)} />
        <Stat label="Free access" value={String(billing.exempt)} />
        <Stat label="Monthly revenue" value={rand(billing.monthlyRevenueZar)} />
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-gray-600">Monthly price for new subscriptions (R)
          <input type="number" min={10} value={price} onChange={e => setPrice(e.target.value)} className="block w-36 border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm mt-1" />
        </label>
        <button disabled={busy || Number(price) === Number(billing.priceZar)} onClick={() => void save({ priceZar: Number(price) }, "Price saved")}
          className="px-4 py-2 rounded-lg text-white text-xs font-semibold disabled:opacity-40" style={{ background: "#B8862E" }}>Save price</button>
      </div>
      <p className="text-[11px] text-gray-500 mt-2">Billed monthly by card through PayFast. A new price applies to new subscriptions; existing ones keep their price. Give a store free access from the Sellers list below.</p>
    </Card>
  );
}

const BILLING_LABEL: Record<string, string> = { exempt: "Free access", active: "Paying", past_due: "Overdue", cancelling: "Cancelling", none: "—" };

function SellerPlans({ planNames }: { planNames: Record<string, string> }) {
  const [rows, setRows] = useState<R[] | null>(null);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async (q: string) => {
    try { const r = await mktSourcingAdmin.sellers(q); if (r.success) setRows(r.data); }
    catch (err) { toast.error(errMessage(err, "Couldn't load sellers.")); }
  }, []);
  useEffect(() => { const t = setTimeout(() => void load(search), 300); return () => clearTimeout(t); }, [search, load]);

  const setExempt = async (sellerId: string, exempt: boolean) => {
    setSaving(sellerId);
    try {
      const r = await mktSourcingAdmin.setExempt(sellerId, exempt);
      if (r.success) { toast.success(exempt ? "Free access given" : "Free access removed"); await load(search); } else toast.error(r.error ?? "Couldn't update.");
    } catch (err) { toast.error(errMessage(err, "Couldn't update.")); }
    finally { setSaving(null); }
  };

  const setPlan = async (sellerId: string, plan: string) => {
    setSaving(sellerId);
    try {
      const r = await mktSourcingAdmin.setSellerPlan(sellerId, plan);
      if (r.success) { toast.success(`Plan changed to ${planNames[plan]}`); await load(search); } else toast.error(r.error ?? "Couldn't change the plan.");
    } catch (err) { toast.error(errMessage(err, "Couldn't change the plan.")); }
    finally { setSaving(null); }
  };

  return (
    <Card title="Sellers" action={
      <div className="relative">
        <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2 top-1/2 -translate-y-1/2" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Find a store" className="border border-gray-200 rounded-lg pl-7 pr-2 py-1 text-xs w-40" />
      </div>
    }>
      {!rows ? <Loader2 className="w-5 h-5 animate-spin text-gray-400" /> : rows.length === 0 ? <p className="text-xs text-gray-500">No sellers found.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="text-left text-gray-500"><th className="py-1.5">Store</th><th>Searches today</th><th>Opened today</th><th>In store</th><th>This month</th><th>Plan</th><th>Billing</th></tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.sellerId} className="border-t border-gray-100">
                  <td className="py-2"><span className="font-semibold text-gray-900">{r.storeName}</span>{r.status !== "active" && <span className="ml-1 text-[10px] text-amber-700">({r.status})</span>}</td>
                  <td>{r.searchesToday}</td><td>{r.viewsToday}</td><td>{r.activeImports}</td><td>{r.importsThisMonth}</td>
                  <td>
                    <select value={r.plan} disabled={saving === r.sellerId} onChange={e => void setPlan(r.sellerId, e.target.value)} className="border border-gray-200 rounded-md px-1.5 py-1 text-xs bg-white">
                      {PLAN_IDS.map(p => <option key={p} value={p}>{planNames[p]}</option>)}
                    </select>
                  </td>
                  <td>
                    <span className="mr-2">{BILLING_LABEL[r.billing] ?? r.billing}</span>
                    <button disabled={saving === r.sellerId} onClick={() => void setExempt(r.sellerId, r.billing !== "exempt")} className="text-[11px] underline text-gray-600 disabled:opacity-40">
                      {r.billing === "exempt" ? "Remove free access" : "Give free access"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function TestSearch() {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<R[] | null>(null);
  const [loading, setLoading] = useState(false);
  const go = async (e: React.FormEvent) => {
    e.preventDefault();
    if (q.trim().length < 2) return;
    setLoading(true);
    try { const r = await mktSourcingAdmin.testSearch(q.trim()); if (r.success) setHits(r.data); else toast.error(r.error ?? "Search failed."); }
    catch (err) { toast.error(errMessage(err, "Search failed.")); }
    finally { setLoading(false); }
  };
  return (
    <Card title="Test search (what sellers see)">
      <form onSubmit={go} className="flex gap-2 mb-3">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="e.g. phone holder" className="flex-1 border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm" />
        <button type="submit" disabled={loading} className="px-4 py-1.5 rounded-lg text-white text-xs font-semibold disabled:opacity-40" style={{ background: "#14110D" }}>{loading ? "Searching..." : "Search"}</button>
      </form>
      {hits && (hits.length === 0 ? <p className="text-xs text-gray-500">Nothing found.</p> : (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
          {hits.slice(0, 24).map(h => (
            <div key={h.ref} className="border border-gray-100 rounded-lg p-2">
              <div className="bg-gray-50 rounded-md overflow-hidden mb-1" style={{ aspectRatio: "1 / 1" }}>
                {h.image ? <img src={h.image} alt={h.title} loading="lazy" className="w-full h-full object-contain" /> : null}
              </div>
              <p className="text-[11px] text-gray-900 line-clamp-2">{h.title}</p>
              <p className="text-[11px] font-bold">{rand(h.fromCostZar)}</p>
            </div>
          ))}
        </div>
      ))}
    </Card>
  );
}
