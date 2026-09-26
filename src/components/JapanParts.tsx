/**
 * Japan Used Parts (UP-GARAGE): the storefront badge and disclosure, and
 * the admin panel (settings, refresh history, listings, buy-and-forward queue).
 */
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { AlertTriangle, ExternalLink, Info, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import {
  mktJapanParts, ApiConnectionError,
  type JapanPartsSettings, type JapanPartsRun, type JapanPartsListing, type JapanPartsTask,
} from "../services/marketplaceApi";

type R = Record<string, unknown>;
const zar = (n: number) => `R${Math.round(n).toLocaleString("en-ZA")}`;

// ── Storefront ───────────────────────────────────────────────────────────

export function JapanPartBadge({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 bg-white/95 border border-red-200 text-red-700 text-[9px] font-bold px-2 py-0.5 rounded-full ${className}`}>
      <span className="w-2 h-2 rounded-full bg-red-600" aria-hidden="true" />USED · FROM JAPAN
    </span>
  );
}

export function JapanPartDisclosure({ part, deliveryWindow, soldOut }: { part: R; deliveryWindow: string; soldOut: boolean }) {
  const rows: [string, unknown][] = [
    ["Condition grade", part.conditionGrade],
    ["Fits", part.fitment],
    ["Year", part.year],
    ["Mileage", part.mileage],
    ["Located in", part.location ? `${part.location}, Japan` : "Japan"],
  ];
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5 space-y-2.5">
      <div className="flex items-start gap-2">
        <Info className="w-4 h-4 text-amber-700 mt-0.5 shrink-0" />
        <div className="text-xs text-amber-900 space-y-1">
          <p className="font-bold">Used part, sourced from Japan</p>
          <p>This is a pre-owned part from UP-GARAGE, Japan's largest used car-parts chain, sold as graded by the Japanese seller. We buy it in Japan once you order and ship it to you ({deliveryWindow}). The price includes shipping, customs duty and import VAT.</p>
          <p>Please check it fits your vehicle before ordering.</p>
        </div>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        {rows.filter(([, v]) => v).map(([k, v]) => (
          <div key={k} className="contents"><dt className="text-amber-800">{k}</dt><dd className="font-semibold text-gray-900">{String(v)}</dd></div>
        ))}
      </dl>
      {soldOut && <p className="text-xs font-semibold text-red-700">This part has been sold or is no longer available in Japan.</p>}
    </div>
  );
}

// ── Admin ────────────────────────────────────────────────────────────────

const RUN_STYLE: Record<string, string> = {
  ok: "bg-emerald-50 text-emerald-700", empty: "bg-amber-50 text-amber-700", failed: "bg-red-50 text-red-700", schema_changed: "bg-red-50 text-red-700",
};
const TASK_STATUSES = ["to_buy", "bought", "shipped", "delivered", "unavailable", "cancelled"];
const label = (s: string) => s.replace(/_/g, " ");

function errMessage(err: unknown, fallback: string) {
  return err instanceof ApiConnectionError ? err.message : fallback;
}

export function JapanPartsAdminPanel() {
  const [settings, setSettings] = useState<JapanPartsSettings | null>(null);
  const [apifyConfigured, setApifyConfigured] = useState(false);
  const [runs, setRuns] = useState<JapanPartsRun[]>([]);
  const [listings, setListings] = useState<JapanPartsListing[]>([]);
  const [tasks, setTasks] = useState<JapanPartsTask[]>([]);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [newFreight, setNewFreight] = useState({ key: "", amount: "" });

  const load = useCallback(async () => {
    try {
      const [s, r, l, t] = await Promise.all([mktJapanParts.settings(), mktJapanParts.runs(), mktJapanParts.listings(), mktJapanParts.tasks("upgarage")]);
      if (s.success) { setSettings(s.data.settings); setApifyConfigured(s.data.apifyConfigured); setRefreshing(s.data.refreshing); }
      if (r.success) setRuns(r.data);
      if (l.success) setListings(l.data);
      if (t.success) setTasks(t.data);
    } catch (err) { toast.error(errMessage(err, "Couldn't load Japan Parts.")); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (!settings) return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>;

  const set = <K extends keyof JapanPartsSettings>(k: K, v: JapanPartsSettings[K]) => setSettings({ ...settings, [k]: v });
  const setNum = (k: keyof JapanPartsSettings) => (e: React.ChangeEvent<HTMLInputElement>) => set(k, Number(e.target.value) as never);

  const save = async () => {
    setSaving(true);
    try {
      const res = await mktJapanParts.saveSettings(settings);
      if (res.success) { setSettings(res.data.settings); toast.success(`Saved. ${res.data.repriced} listing${res.data.repriced === 1 ? "" : "s"} re-priced.`); void load(); }
      else toast.error(res.error ?? "Couldn't save.");
    } catch (err) { toast.error(errMessage(err, "Couldn't save.")); } finally { setSaving(false); }
  };

  const refresh = async () => {
    try {
      const res = await mktJapanParts.refresh();
      if (res.success) { setRefreshing(true); toast.success("Refresh started — it runs each keyword in turn and can take a few minutes."); }
      else toast.error(res.error ?? "Couldn't start the refresh.");
    } catch (err) { toast.error(errMessage(err, "Couldn't start the refresh.")); }
  };

  const updateTask = async (t: JapanPartsTask, patch: Parameters<typeof mktJapanParts.updateTask>[1]) => {
    try {
      const res = await mktJapanParts.updateTask(t.id, patch);
      if (res.success) setTasks(ts => ts.map(x => (x.id === t.id ? res.data : x)));
      else toast.error(res.error ?? "Couldn't update.");
    } catch (err) { toast.error(errMessage(err, "Couldn't update.")); }
  };

  const input = "border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm w-full outline-none focus:border-[#B8862E]";
  const card = "bg-white rounded-2xl border border-gray-100 p-5";
  const byStatus = listings.reduce<Record<string, number>>((m, l) => { m[l.status] = (m[l.status] ?? 0) + 1; return m; }, {});
  const openTasks = tasks.filter(t => !["delivered", "cancelled", "unavailable"].includes(t.status));

  return (
    <div className="space-y-5">
      {!apifyConfigured && (
        <div className="flex gap-2 p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-sm text-amber-900">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>Set <code>APIFY_API_TOKEN</code> on the backend service (Railway → Variables) to enable refreshes. The token stays on the server.</span>
        </div>
      )}

      <div className="grid sm:grid-cols-4 gap-3">
        {[["Live", byStatus.active ?? 0], ["Out of stock / removed", byStatus.out_of_stock ?? 0], ["To buy / in progress", openTasks.length], ["Keywords on", settings.keywords.filter(k => k.enabled).length]].map(([k, v]) => (
          <div key={k as string} className={card}><p className="text-xs text-gray-500">{k}</p><p className="text-2xl font-black text-gray-900">{v}</p></div>
        ))}
      </div>

      {/* Settings */}
      <div className={card + " space-y-4"}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h3 className="font-bold text-gray-900">Settings</h3>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-sm font-semibold">
              <input type="checkbox" checked={settings.enabled} onChange={e => set("enabled", e.target.checked)} className="w-4 h-4" />
              Scheduled refresh on
            </label>
            <button onClick={refresh} disabled={!apifyConfigured || refreshing}
              className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-lg border border-gray-200 disabled:opacity-50">
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />{refreshing ? "Refreshing…" : "Refresh now"}
            </button>
          </div>
        </div>

        <div>
          <p className="text-xs font-bold text-gray-600 uppercase tracking-wider mb-2">Search keywords</p>
          <p className="text-xs text-gray-500 mb-2">Japanese search terms work best on UP-GARAGE (e.g. ホイール wheels, マフラー exhaust, レカロ Recaro). The English label is shown to shoppers; the freight class sets the shipping cost.</p>
          <div className="space-y-2">
            {settings.keywords.map((k, i) => (
              <div key={i} className="grid grid-cols-[auto_1fr_1fr_1fr_auto] gap-2 items-center">
                <input type="checkbox" checked={k.enabled} aria-label="Enabled" onChange={e => set("keywords", settings.keywords.map((x, j) => j === i ? { ...x, enabled: e.target.checked } : x))} className="w-4 h-4" />
                <input className={input} value={k.keyword} placeholder="Keyword (ホイール)" onChange={e => set("keywords", settings.keywords.map((x, j) => j === i ? { ...x, keyword: e.target.value } : x))} />
                <input className={input} value={k.label} placeholder="English label" onChange={e => set("keywords", settings.keywords.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} />
                <select className={input} value={k.partsCategory} onChange={e => set("keywords", settings.keywords.map((x, j) => j === i ? { ...x, partsCategory: e.target.value } : x))}>
                  {[...new Set([...Object.keys(settings.freightByCategory), k.partsCategory])].map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <button aria-label="Remove keyword" onClick={() => set("keywords", settings.keywords.filter((_, j) => j !== i))} className="p-1.5 text-gray-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
              </div>
            ))}
            <button onClick={() => set("keywords", [...settings.keywords, { keyword: "", label: "", partsCategory: "small", enabled: true }])}
              className="flex items-center gap-1 text-xs font-semibold text-[#8A6420]"><Plus className="w-3.5 h-3.5" />Add keyword</button>
          </div>
        </div>

        <div className="grid sm:grid-cols-4 gap-3">
          {([
            ["markupPct", "Markup %"], ["forwarderFeeZar", "Forwarding fee (R/part)"], ["dutyPct", "Customs duty %"], ["vatPct", "Import VAT %"],
            ["vatUpliftPct", "VAT uplift % (SARS)"], ["defaultFreightZar", "Default freight (R)"], ["maxItemsPerKeyword", "Results per keyword"], ["refreshHours", "Refresh every (hours)"],
          ] as [keyof JapanPartsSettings, string][]).map(([k, l]) => (
            <label key={k} className="text-xs text-gray-600 space-y-1"><span>{l}</span>
              <input type="number" min={0} className={input} value={settings[k] as number} onChange={setNum(k)} />
            </label>
          ))}
          <label className="text-xs text-gray-600 space-y-1"><span>Delivery: min business days</span>
            <input type="number" min={1} className={input} value={settings.deliveryDays.min} onChange={e => set("deliveryDays", { ...settings.deliveryDays, min: Number(e.target.value) })} />
          </label>
          <label className="text-xs text-gray-600 space-y-1"><span>Delivery: max business days</span>
            <input type="number" min={1} className={input} value={settings.deliveryDays.max} onChange={e => set("deliveryDays", { ...settings.deliveryDays, max: Number(e.target.value) })} />
          </label>
        </div>

        <div>
          <p className="text-xs font-bold text-gray-600 uppercase tracking-wider mb-2">Freight by part class (R)</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {Object.entries(settings.freightByCategory).map(([k, v]) => (
              <label key={k} className="text-xs text-gray-600 space-y-1"><span className="flex justify-between">{k}
                <button aria-label={`Remove ${k}`} onClick={() => { const { [k]: _, ...rest } = settings.freightByCategory; set("freightByCategory", rest); }} className="text-gray-400 hover:text-red-600">×</button></span>
                <input type="number" min={0} className={input} value={v} onChange={e => set("freightByCategory", { ...settings.freightByCategory, [k]: Number(e.target.value) })} />
              </label>
            ))}
            <div className="text-xs text-gray-600 space-y-1"><span>Add class</span>
              <div className="flex gap-1">
                <input className={input} placeholder="name" value={newFreight.key} onChange={e => setNewFreight({ ...newFreight, key: e.target.value })} />
                <input className={input} placeholder="R" type="number" value={newFreight.amount} onChange={e => setNewFreight({ ...newFreight, amount: e.target.value })} />
                <button className="px-2 rounded-lg border border-gray-200" aria-label="Add freight class" onClick={() => {
                  const key = newFreight.key.trim().toLowerCase();
                  if (!key) return;
                  set("freightByCategory", { ...settings.freightByCategory, [key]: Number(newFreight.amount) || 0 });
                  setNewFreight({ key: "", amount: "" });
                }}><Plus className="w-3.5 h-3.5" /></button>
              </div>
            </div>
          </div>
        </div>

        <p className="text-xs text-gray-500">Price = (UP-GARAGE price incl. tax × live ¥ rate) + forwarding + freight + duty on (part + freight) + import VAT on (part × (1 + uplift) + duty), then markup, rounded up. Saving re-prices every listing. If Ballylife claims import VAT back as input tax, set import VAT to 0.</p>
        <button onClick={save} disabled={saving} className="px-5 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-60" style={{ background: "#14110D" }}>
          {saving ? "Saving…" : "Save settings"}
        </button>
      </div>

      {/* Buy-and-forward queue */}
      <div className={card}>
        <h3 className="font-bold text-gray-900 mb-1">To buy & ship</h3>
        <p className="text-xs text-gray-500 mb-3">Paid orders for Japan parts. Buy the part on UP-GARAGE, send it through the forwarder, then add tracking and mark it shipped. If it's gone, mark it unavailable and refund the customer.</p>
        {tasks.length === 0 ? <p className="text-sm text-gray-500">Nothing yet.</p> : (
          <div className="space-y-2">
            {tasks.map(t => <TaskRow key={t.id} t={t} onUpdate={patch => updateTask(t, patch)} />)}
          </div>
        )}
      </div>

      {/* Refresh history */}
      <div className={card}>
        <h3 className="font-bold text-gray-900 mb-3">Refresh history</h3>
        {runs.length === 0 ? <p className="text-sm text-gray-500">No refreshes yet.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-left text-gray-500"><th className="py-1.5 pr-3">When</th><th className="pr-3">Keyword</th><th className="pr-3">Result</th><th className="pr-3">Items</th><th className="pr-3">New</th><th className="pr-3">Updated</th><th className="pr-3">Removed</th><th>Problem</th></tr></thead>
              <tbody>
                {runs.map(r => (
                  <tr key={r.id} className="border-t border-gray-50 align-top">
                    <td className="py-1.5 pr-3 whitespace-nowrap">{new Date(r.startedAt).toLocaleString()}</td>
                    <td className="pr-3">{r.keyword}</td>
                    <td className="pr-3"><span className={`px-2 py-0.5 rounded-full font-semibold ${RUN_STYLE[r.status] ?? "bg-gray-100"}`}>{label(r.status)}</span></td>
                    <td className="pr-3">{r.items}</td><td className="pr-3">{r.created}</td><td className="pr-3">{r.updated}</td><td className="pr-3">{r.removed}</td>
                    <td className="text-red-700 max-w-md break-words">{r.error}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Listings */}
      <div className={card}>
        <h3 className="font-bold text-gray-900 mb-3">Listings ({listings.length})</h3>
        {listings.length === 0 ? <p className="text-sm text-gray-500">None yet.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-left text-gray-500"><th className="py-1.5 pr-3">Part</th><th className="pr-3">Grade</th><th className="pr-3">¥ incl. tax</th><th className="pr-3">Landed</th><th className="pr-3">Price</th><th className="pr-3">Status</th><th /></tr></thead>
              <tbody>
                {listings.map(l => (
                  <tr key={l.id} className="border-t border-gray-50">
                    <td className="py-1.5 pr-3 max-w-xs truncate" title={l.name}>{l.name}</td>
                    <td className="pr-3">{l.conditionGrade ?? "—"}</td>
                    <td className="pr-3">{l.jpyTaxIncl !== null ? `¥${l.jpyTaxIncl.toLocaleString()}` : "—"}</td>
                    <td className="pr-3" title={l.priceBreakdown ? `Part ${zar(Number(l.priceBreakdown.partZar))} + forwarding ${zar(Number(l.priceBreakdown.forwarderZar))} + freight ${zar(Number(l.priceBreakdown.freightZar))} + duty ${zar(Number(l.priceBreakdown.dutyZar))} + VAT ${zar(Number(l.priceBreakdown.importVatZar))}` : ""}>
                      {l.priceBreakdown ? zar(Number(l.priceBreakdown.landedZar)) : "—"}
                    </td>
                    <td className="pr-3 font-semibold">{zar(l.price)}</td>
                    <td className="pr-3">{l.sourceStatus === "removed" ? "removed in Japan" : label(l.status)}</td>
                    <td>{l.sourceUrl && <a href={l.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-[#8A6420]" aria-label="Open on UP-GARAGE"><ExternalLink className="w-3.5 h-3.5" /></a>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export function TaskRow({ t, onUpdate }: { t: JapanPartsTask; onUpdate: (patch: Parameters<typeof mktJapanParts.updateTask>[1]) => void }) {
  const [tracking, setTracking] = useState(t.trackingNumber ?? "");
  const [carrier, setCarrier] = useState(t.carrier ?? "");
  const [ref, setRef] = useState(t.purchaseRef ?? "");
  const input = "border border-gray-200 rounded-lg px-2 py-1 text-xs w-full";
  return (
    <div className="rounded-xl border border-gray-100 p-3 grid sm:grid-cols-[1.4fr_1fr_1fr_1fr_auto] gap-2 items-center text-xs">
      <div className="min-w-0">
        <p className="font-semibold text-gray-900 truncate" title={t.productName ?? ""}>{t.productName ?? t.productId}</p>
        {t.variantLabel && <p className="text-gray-700">Option: <b>{t.variantLabel}</b>{t.supplierSku ? <span className="text-gray-500"> · SKU {t.supplierSku}</span> : null}</p>}
        <p className="text-gray-500">{t.orderNumber} · qty {t.quantity}
          {t.sourceUrl && <> · <a href={t.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-[#8A6420] inline-flex items-center gap-0.5">{t.source === "1688" ? "1688" : "UP-GARAGE"} <ExternalLink className="w-3 h-3" /></a></>}
        </p>
      </div>
      <input className={input} placeholder={t.source === "1688" ? "Agent order ref" : "UP-GARAGE order ref"} value={ref} onChange={e => setRef(e.target.value)} onBlur={() => ref !== (t.purchaseRef ?? "") && onUpdate({ purchaseRef: ref })} />
      <input className={input} placeholder="Tracking number" value={tracking} onChange={e => setTracking(e.target.value)} onBlur={() => tracking !== (t.trackingNumber ?? "") && onUpdate({ trackingNumber: tracking })} />
      <input className={input} placeholder="Carrier" value={carrier} onChange={e => setCarrier(e.target.value)} onBlur={() => carrier !== (t.carrier ?? "") && onUpdate({ carrier })} />
      <select className={input} value={t.status} onChange={e => onUpdate({ status: e.target.value, trackingNumber: tracking || undefined, carrier: carrier || undefined })}>
        {TASK_STATUSES.map(s => <option key={s} value={s}>{label(s)}</option>)}
      </select>
    </div>
  );
}
