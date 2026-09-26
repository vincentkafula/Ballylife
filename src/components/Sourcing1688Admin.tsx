/**
 * Admin: 1688 product research. Find products on 1688 (via Apify), judge
 * them on price, MOQ, sales and supplier track record plus an estimated SA
 * landed cost, and send winners to CJ to source. Once CJ has sourced one,
 * it's imported and listed automatically as a normal CJ product.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, ExternalLink, Loader2, Plus, RefreshCw, Send, Star, Trash2, X } from "lucide-react";
import { mkt1688, ApiConnectionError, type Sourcing1688Settings, type Offer1688, type Run1688 } from "../services/marketplaceApi";

const zar = (n: number) => `R${Math.round(n).toLocaleString("en-ZA")}`;
const errMessage = (err: unknown, fallback: string) => (err instanceof ApiConnectionError ? err.message : fallback);

const STATUS_LABEL: Record<string, string> = {
  new: "New", shortlisted: "Shortlisted", dismissed: "Dismissed", sent_to_cj: "With CJ", sourcing_failed: "CJ couldn't source", sourced: "Sourced by CJ", listed: "Listed in store",
};
const STATUS_STYLE: Record<string, string> = {
  shortlisted: "bg-amber-50 text-amber-700", dismissed: "bg-gray-100 text-gray-500", sent_to_cj: "bg-blue-50 text-blue-700",
  sourcing_failed: "bg-red-50 text-red-700", sourced: "bg-emerald-50 text-emerald-700", listed: "bg-emerald-600 text-white", new: "bg-gray-50 text-gray-700",
};
const RUN_STYLE: Record<string, string> = { ok: "bg-emerald-50 text-emerald-700", empty: "bg-amber-50 text-amber-700", failed: "bg-red-50 text-red-700", schema_changed: "bg-red-50 text-red-700" };

export function Sourcing1688AdminPanel() {
  const [settings, setSettings] = useState<Sourcing1688Settings | null>(null);
  const [flags, setFlags] = useState({ apify: false, cj: false, running: false });
  const [offers, setOffers] = useState<Offer1688[]>([]);
  const [runs, setRuns] = useState<Run1688[]>([]);
  const [filter, setFilter] = useState({ status: "", sort: "sold", search: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const loadOffers = useCallback(async () => {
    try {
      const q: Record<string, string> = { sort: filter.sort };
      if (filter.status) q.status = filter.status;
      if (filter.search) q.search = filter.search;
      const r = await mkt1688.offers(q);
      if (r.success) setOffers(r.data);
    } catch (err) { toast.error(errMessage(err, "Couldn't load offers.")); }
  }, [filter]);

  const load = useCallback(async () => {
    try {
      const [s, r] = await Promise.all([mkt1688.settings(), mkt1688.runs()]);
      if (s.success) { setSettings(s.data.settings); setFlags({ apify: s.data.apifyConfigured, cj: s.data.cjConfigured, running: s.data.running }); }
      if (r.success) setRuns(r.data);
    } catch (err) { toast.error(errMessage(err, "Couldn't load 1688 research.")); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadOffers(); }, [loadOffers]);

  if (!settings) return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>;
  const set = <K extends keyof Sourcing1688Settings>(k: K, v: Sourcing1688Settings[K]) => setSettings({ ...settings, [k]: v });
  const setFilterVal = <K extends keyof Sourcing1688Settings["filters"]>(k: K, v: Sourcing1688Settings["filters"][K]) => set("filters", { ...settings.filters, [k]: v });
  const setEst = <K extends keyof Sourcing1688Settings["estimate"]>(k: K, v: Sourcing1688Settings["estimate"][K]) => set("estimate", { ...settings.estimate, [k]: v });
  const optNum = (v: string) => (v.trim() === "" ? null : Number(v));

  const act = async (key: string, fn: () => Promise<{ success: boolean; error?: string }>, ok: string) => {
    setBusy(key);
    try {
      const r = await fn();
      if (r.success) { toast.success(ok); await loadOffers(); } else toast.error(r.error ?? "That didn't work.");
    } catch (err) { toast.error(errMessage(err, "That didn't work.")); } finally { setBusy(null); }
  };

  const save = () => act("save", async () => {
    const r = await mkt1688.saveSettings(settings);
    if (r.success) setSettings(r.data.settings);
    return r;
  }, "Settings saved.");
  const run = () => act("run", async () => {
    const r = await mkt1688.run();
    if (r.success) setFlags(f => ({ ...f, running: true }));
    return r;
  }, "Research run started — it searches every enabled keyword and can take several minutes.");

  const input = "border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm w-full outline-none focus:border-[#B8862E]";
  const card = "bg-white rounded-2xl border border-gray-100 p-5";
  const classes = Object.keys(settings.estimate.classes);

  return (
    <div className="space-y-5">
      {(!flags.apify || !flags.cj) && (
        <div className="flex gap-2 p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-sm text-amber-900">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{!flags.apify ? "Set APIFY_API_TOKEN on the backend to run research. " : ""}{!flags.cj ? "CJ isn't connected, so picks can't be sent for sourcing." : ""}</span>
        </div>
      )}

      <div className={card + " flex flex-wrap items-center justify-between gap-3"}>
        <div>
          <h3 className="font-bold text-gray-900">1688 product research</h3>
          <p className="text-xs text-gray-500 max-w-2xl">Find products on 1688, compare their estimated South African landed cost and resale price, and send winners to CJ to source. Once CJ sources one it's listed in the store automatically, priced and shipped like any CJ product. Shoppers never see 1688.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowSettings(v => !v)} className="text-sm font-semibold px-3 py-1.5 rounded-lg border border-gray-200">{showSettings ? "Hide settings" : "Settings"}</button>
          <button onClick={() => act("sync", mkt1688.syncCj, "Checked CJ for updates.")} disabled={!flags.cj || busy === "sync"} className="text-sm font-semibold px-3 py-1.5 rounded-lg border border-gray-200 disabled:opacity-50">Check CJ now</button>
          <button onClick={run} disabled={!flags.apify || flags.running || busy === "run"} className="flex items-center gap-1.5 text-sm font-bold px-3 py-1.5 rounded-lg text-white disabled:opacity-50" style={{ background: "#14110D" }}>
            <RefreshCw className={`w-3.5 h-3.5 ${flags.running ? "animate-spin" : ""}`} />{flags.running ? "Running…" : "Run research now"}
          </button>
        </div>
      </div>

      {showSettings && (
        <div className={card + " space-y-4"}>
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input type="checkbox" checked={settings.enabled} onChange={e => set("enabled", e.target.checked)} className="w-4 h-4" />
            Scheduled research on (every {settings.refreshHours} hours)
          </label>

          <div>
            <p className="text-xs font-bold text-gray-600 uppercase tracking-wider mb-2">Keywords (English or Chinese)</p>
            <div className="space-y-2">
              {settings.keywords.map((k, i) => (
                <div key={i} className="grid grid-cols-[auto_2fr_1fr_auto] gap-2 items-center">
                  <input type="checkbox" aria-label="Enabled" checked={k.enabled} onChange={e => set("keywords", settings.keywords.map((x, j) => j === i ? { ...x, enabled: e.target.checked } : x))} className="w-4 h-4" />
                  <input className={input} value={k.keyword} placeholder="bluetooth earphone / 蓝牙耳机" onChange={e => set("keywords", settings.keywords.map((x, j) => j === i ? { ...x, keyword: e.target.value } : x))} />
                  <select className={input} value={k.productClass} onChange={e => set("keywords", settings.keywords.map((x, j) => j === i ? { ...x, productClass: e.target.value } : x))}>
                    <option value="auto">auto (from title)</option>
                    {classes.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <button aria-label="Remove keyword" onClick={() => set("keywords", settings.keywords.filter((_, j) => j !== i))} className="p-1.5 text-gray-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
                </div>
              ))}
              <button onClick={() => set("keywords", [...settings.keywords, { keyword: "", productClass: "auto", enabled: true }])} className="flex items-center gap-1 text-xs font-semibold text-[#8A6420]"><Plus className="w-3.5 h-3.5" />Add keyword</button>
            </div>
          </div>

          <div className="grid sm:grid-cols-4 gap-3 text-xs text-gray-600">
            <label className="space-y-1"><span>Results per keyword</span><input type="number" min={1} className={input} value={settings.maxItemsPerKeyword} onChange={e => set("maxItemsPerKeyword", Number(e.target.value))} /></label>
            <label className="space-y-1"><span>Research every (hours)</span><input type="number" min={1} className={input} value={settings.refreshHours} onChange={e => set("refreshHours", Number(e.target.value))} /></label>
            <label className="space-y-1"><span>Sort</span>
              <select className={input} value={settings.filters.sortType} onChange={e => setFilterVal("sortType", e.target.value as Sourcing1688Settings["filters"]["sortType"])}>
                <option value="normal">1688 recommended</option><option value="va_sales360">Most orders (360 days)</option><option value="price">Lowest price</option>
              </select></label>
            <label className="space-y-1"><span>Supplier on 1688 for at least</span>
              <select className={input} value={settings.filters.supplierYears} onChange={e => setFilterVal("supplierYears", e.target.value as Sourcing1688Settings["filters"]["supplierYears"])}>
                <option value="any">Any time</option><option value="5">5 years</option><option value="7">7 years</option><option value="10">10 years</option>
              </select></label>
            <label className="space-y-1"><span>Supplier tier</span>
              <select className={input} value={settings.filters.merchantType} onChange={e => setFilterVal("merchantType", e.target.value as Sourcing1688Settings["filters"]["merchantType"])}>
                <option value="any">Any</option><option value="superFactory">Super Factory</option><option value="certifiedMerchant">Certified Merchant</option>
              </select></label>
            <label className="space-y-1"><span>Max MOQ (blank = any)</span><input type="number" min={1} className={input} value={settings.filters.maxMoq ?? ""} onChange={e => setFilterVal("maxMoq", optNum(e.target.value))} /></label>
            <label className="space-y-1"><span>Min price ¥</span><input type="number" min={0} className={input} value={settings.filters.priceMinCny ?? ""} onChange={e => setFilterVal("priceMinCny", optNum(e.target.value))} /></label>
            <label className="space-y-1"><span>Max price ¥</span><input type="number" min={0} className={input} value={settings.filters.priceMaxCny ?? ""} onChange={e => setFilterVal("priceMaxCny", optNum(e.target.value))} /></label>
            <label className="flex items-center gap-2 sm:col-span-2"><input type="checkbox" checked={settings.filters.fastShippingOnly} onChange={e => setFilterVal("fastShippingOnly", e.target.checked)} className="w-4 h-4" />Only suppliers dispatching within 48h</label>
          </div>

          <div>
            <p className="text-xs font-bold text-gray-600 uppercase tracking-wider mb-2">Estimate: duty and freight per product class</p>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs text-gray-600">
              {Object.entries(settings.estimate.classes).map(([k, v]) => (
                <div key={k} className="space-y-1 border border-gray-100 rounded-lg p-2">
                  <p className="font-semibold text-gray-800 flex justify-between">{k}
                    <button aria-label={`Remove ${k}`} onClick={() => { const { [k]: _, ...rest } = settings.estimate.classes; setEst("classes", rest); }} className="text-gray-400 hover:text-red-600">×</button></p>
                  <label className="block">Duty %<input type="number" min={0} className={input} value={v.dutyPct} onChange={e => setEst("classes", { ...settings.estimate.classes, [k]: { ...v, dutyPct: Number(e.target.value) } })} /></label>
                  <label className="block">Freight R<input type="number" min={0} className={input} value={v.freightZar} onChange={e => setEst("classes", { ...settings.estimate.classes, [k]: { ...v, freightZar: Number(e.target.value) } })} /></label>
                </div>
              ))}
              <button onClick={() => { const name = prompt("New class name (e.g. furniture)")?.trim().toLowerCase(); if (name) setEst("classes", { ...settings.estimate.classes, [name]: { ...settings.estimate.defaultClass } }); }}
                className="border border-dashed border-gray-300 rounded-lg p-2 text-gray-500 hover:border-[#B8862E]">+ Add class</button>
            </div>
            <div className="grid sm:grid-cols-4 gap-3 mt-3 text-xs text-gray-600">
              <label className="space-y-1"><span>Markup %</span><input type="number" min={0} className={input} value={settings.estimate.markupPct} onChange={e => setEst("markupPct", Number(e.target.value))} /></label>
              <label className="space-y-1"><span>Import VAT %</span><input type="number" min={0} className={input} value={settings.estimate.vatPct} onChange={e => setEst("vatPct", Number(e.target.value))} /></label>
              <label className="space-y-1"><span>Default duty %</span><input type="number" min={0} className={input} value={settings.estimate.defaultClass.dutyPct} onChange={e => setEst("defaultClass", { ...settings.estimate.defaultClass, dutyPct: Number(e.target.value) })} /></label>
              <label className="space-y-1"><span>Default freight R</span><input type="number" min={0} className={input} value={settings.estimate.defaultClass.freightZar} onChange={e => setEst("defaultClass", { ...settings.estimate.defaultClass, freightZar: Number(e.target.value) })} /></label>
            </div>
            <p className="text-xs text-gray-500 mt-2">Estimate only, to compare finds: 1688 unit price × live ¥ rate + freight + duty on (unit + freight) + import VAT on (unit × 1.1 + duty), then markup. Products CJ sources are priced from CJ's own cost.</p>
          </div>
          <button onClick={save} disabled={busy === "save"} className="px-5 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-60" style={{ background: "#14110D" }}>{busy === "save" ? "Saving…" : "Save settings"}</button>
        </div>
      )}

      {runs.length > 0 && (
        <div className={card}>
          <h3 className="font-bold text-gray-900 mb-2">Recent runs</h3>
          <div className="space-y-1 text-xs">
            {runs.slice(0, 5).map(r => (
              <div key={r.id} className="flex flex-wrap items-center gap-2">
                <span className="text-gray-500 w-40">{new Date(r.startedAt).toLocaleString()}</span>
                <span className={`px-2 py-0.5 rounded-full font-semibold ${RUN_STYLE[r.status] ?? "bg-gray-100"}`}>{r.status.replace(/_/g, " ")}</span>
                <span>{r.items} rows · {r.created} new · {r.updated} updated{r.excluded ? ` · ${r.excluded} excluded` : ""}</span>
                {r.error && <span className="text-red-700 break-all">{r.error}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className={card}>
        <div className="flex flex-wrap gap-2 mb-3">
          <select className={input + " max-w-[180px]"} value={filter.status} onChange={e => setFilter({ ...filter, status: e.target.value })}>
            <option value="">All statuses</option>
            {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select className={input + " max-w-[180px]"} value={filter.sort} onChange={e => setFilter({ ...filter, sort: e.target.value })}>
            <option value="sold">Best selling</option><option value="price">Cheapest</option><option value="supplier">Longest-trading supplier</option><option value="newest">Newest finds</option>
          </select>
          <input className={input + " max-w-xs"} placeholder="Search titles" value={filter.search} onChange={e => setFilter({ ...filter, search: e.target.value })} />
        </div>
        {offers.length === 0 ? <p className="text-sm text-gray-500 py-6 text-center">No offers yet{flags.apify ? " — run research to find some." : "."}</p> : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {offers.map(o => (
              <div key={o.id} className="border border-gray-100 rounded-xl overflow-hidden flex flex-col">
                <div className="relative bg-white" style={{ aspectRatio: "4 / 3" }}>
                  {o.images[0] && <img src={o.images[0]} alt="" loading="lazy" referrerPolicy="no-referrer" className="absolute inset-0 w-full h-full object-contain" />}
                  <span className={`absolute top-2 left-2 text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_STYLE[o.status] ?? "bg-gray-100"}`}>{STATUS_LABEL[o.status] ?? o.status}</span>
                </div>
                <div className="p-3 text-xs space-y-1.5 flex-1 flex flex-col">
                  <p className="font-semibold text-sm text-gray-900 line-clamp-2" title={o.title}>{o.title}</p>
                  <div className="flex justify-between"><span className="text-gray-500">1688 price</span><span className="font-semibold">¥{o.priceRangeCny ?? o.priceCny}{o.unit ? ` / ${o.unit}` : ""}</span></div>
                  {o.estimate && <>
                    <div className="flex justify-between" title={`Unit ${zar(o.estimate.unitZar)} + freight ${zar(o.estimate.freightZar)} + duty ${zar(o.estimate.dutyZar)} + VAT ${zar(o.estimate.importVatZar)}`}>
                      <span className="text-gray-500">Est. landed in SA ({o.productClass})</span><span>{zar(o.estimate.landedZar)}</span></div>
                    <div className="flex justify-between"><span className="text-gray-500">Est. resale</span><span className="font-bold text-[#8A6420]">{zar(o.estimate.resaleZar)}</span></div>
                  </>}
                  <div className="flex justify-between"><span className="text-gray-500">MOQ · sold</span><span>{o.moq ?? "?"} · {o.soldCount !== null ? o.soldCount.toLocaleString() : "?"}</span></div>
                  <div className="flex justify-between gap-2"><span className="text-gray-500">Supplier</span><span className="text-right truncate" title={o.supplierName ?? ""}>{o.supplierYears ? `${o.supplierYears} yrs · ` : ""}{o.supplierType ?? ""}</span></div>
                  {o.cjSourcingStatus && o.status !== "listed" && <p className="text-blue-700">CJ: {o.cjSourcingStatus}</p>}
                  {o.cjFailReason && <p className="text-red-700">CJ: {o.cjFailReason}</p>}
                  <div className="flex flex-wrap gap-1.5 pt-2 mt-auto">
                    {["new", "shortlisted", "dismissed", "sourcing_failed"].includes(o.status) && (
                      <button onClick={() => act(`send-${o.id}`, () => mkt1688.sendToCj(o.id), "Sent to CJ for sourcing.")} disabled={!flags.cj || busy === `send-${o.id}`}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-white font-semibold disabled:opacity-50" style={{ background: "#14110D" }}>
                        <Send className="w-3 h-3" />{o.status === "sourcing_failed" ? "Resend to CJ" : "Send to CJ"}
                      </button>
                    )}
                    {o.status === "new" && <button onClick={() => act(`s-${o.id}`, () => mkt1688.setStatus(o.id, "shortlisted"), "Shortlisted.")} className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-gray-200"><Star className="w-3 h-3" />Shortlist</button>}
                    {(o.status === "new" || o.status === "shortlisted") && <button onClick={() => act(`d-${o.id}`, () => mkt1688.setStatus(o.id, "dismissed"), "Dismissed.")} className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-gray-200"><X className="w-3 h-3" />Dismiss</button>}
                    {o.status === "dismissed" && <button onClick={() => act(`n-${o.id}`, () => mkt1688.setStatus(o.id, "new"), "Restored.")} className="px-2.5 py-1 rounded-lg border border-gray-200">Restore</button>}
                    {o.url && <a href={o.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-gray-200 text-[#8A6420]">1688 <ExternalLink className="w-3 h-3" /></a>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
