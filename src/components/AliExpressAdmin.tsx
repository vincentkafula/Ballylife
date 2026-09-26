/**
 * Admin: AliExpress -- connect the buyer account, import products (by link
 * or search), and follow orders placed on AliExpress for customers.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle, ExternalLink, Link2, Loader2, RefreshCw, Search } from "lucide-react";
import { mktAliExpress, ApiConnectionError } from "../services/marketplaceApi";

type R = Record<string, any>;
const zar = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `R${Math.round(n).toLocaleString("en-ZA")}`);
const errMessage = (err: unknown, fallback: string) => (err instanceof ApiConnectionError ? err.message : fallback);
const ORDER_STYLE: Record<string, string> = {
  queued: "bg-gray-100 text-gray-700", placing: "bg-blue-50 text-blue-700", placed: "bg-blue-50 text-blue-700", shipped: "bg-emerald-50 text-emerald-700",
  delivered: "bg-emerald-600 text-white", needs_attention: "bg-red-50 text-red-700", failed: "bg-red-50 text-red-700", cancelled: "bg-gray-100 text-gray-500",
};

export function AliExpressAdminPanel() {
  const [status, setStatus] = useState<R | null>(null);
  const [products, setProducts] = useState<R[]>([]);
  const [orders, setOrders] = useState<R[]>([]);
  const [links, setLinks] = useState("");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<R[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, p, o] = await Promise.all([mktAliExpress.status(), mktAliExpress.products(), mktAliExpress.orders()]);
      if (s.success) setStatus(s.data);
      if (p.success) setProducts(p.data);
      if (o.success) setOrders(o.data);
    } catch (err) { toast.error(errMessage(err, "Couldn't load AliExpress.")); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const run = async <T,>(key: string, fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(key);
    try { return await fn(); }
    catch (err) { toast.error(errMessage(err, "That didn't work.")); return undefined; }
    finally { setBusy(null); }
  };

  const connect = () => run("connect", async () => {
    const r = await mktAliExpress.connect();
    if (r.success) window.location.href = r.data.url; else toast.error(r.error ?? "Couldn't start the connection.");
  });
  const disconnect = () => run("disconnect", async () => {
    if (!window.confirm("Disconnect the AliExpress account? Orders won't be placed until it's connected again.")) return;
    await mktAliExpress.disconnect(); toast.success("Disconnected."); void load();
  });
  const test = () => run("test", async () => {
    const r = await mktAliExpress.test();
    setTestResult(r.success
      ? `Working. Test product "${r.data.title}": ${r.data.variants} options, from $${r.data.cheapestUsd}; cheapest shipping to South Africa ${r.data.shipping ? `$${r.data.shipping.usd} (${r.data.shipping.service})` : "not available"}.`
      : `Failed: ${r.error}`);
  });
  const importItems = (items: string[]) => run(`import-${items.join(",")}`, async () => {
    const r = await mktAliExpress.import(items);
    if (!r.success) { toast.error(r.error ?? "Import failed."); return; }
    const listed = r.data.filter((x: R) => x.listed).length;
    toast.success(`${listed} of ${r.data.length} listed in the store.`);
    for (const x of r.data.filter((x: R) => !x.listed)) toast(`${x.title ?? x.productId}: ${x.reason}`);
    setLinks(""); void load();
  });
  const search = () => run("search", async () => {
    const r = await mktAliExpress.search(query);
    if (r.success) { setHits(r.data); if (!r.data.length) toast("No results."); } else toast.error(r.error ?? "Search failed.");
  });
  const retry = (id: string) => run(`retry-${id}`, async () => {
    const r = await mktAliExpress.retry(id);
    if (r.success) { toast.success("Queued — it will be placed within a minute."); void load(); } else toast.error(r.error ?? "Couldn't retry.");
  });

  if (!status) return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>;
  const card = "bg-white rounded-2xl border border-gray-100 p-5";
  const input = "border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm w-full outline-none focus:border-[#1E7B4D]";

  return (
    <div className="space-y-5">
      {!status.configured && (
        <div className="flex gap-2 p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-sm text-amber-900">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>Add <code>ALIEXPRESS_APP_KEY</code> and <code>ALIEXPRESS_APP_SECRET</code> to the backend service in Railway, then reload this page.</span>
        </div>
      )}

      <div className={card + " flex flex-wrap items-center justify-between gap-3"}>
        <div>
          <h3 className="font-bold text-gray-900 flex items-center gap-2">
            AliExpress {status.connected ? <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 inline-flex items-center gap-1"><CheckCircle className="w-3 h-3" />Connected{status.account ? ` as ${status.account}` : ""}</span>
              : <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">Not connected</span>}
          </h3>
          <p className="text-xs text-gray-500 max-w-2xl mt-1">
            Imported products are listed like CJ products: English, cheapest shipping to South Africa, the store's sliding markup, delivery included.
            Paid orders are placed on your AliExpress account automatically{status.autoPay ? " and paid with its saved payment method" : " — you pay each one in AliExpress (you're emailed when one is waiting)"}.
          </p>
        </div>
        <div className="flex gap-2">
          {status.connected && <button onClick={test} disabled={busy === "test"} className="text-sm font-semibold px-3 py-1.5 rounded-lg border border-gray-200 disabled:opacity-50">{busy === "test" ? "Testing…" : "Test connection"}</button>}
          {status.connected
            ? <button onClick={disconnect} className="text-sm font-semibold px-3 py-1.5 rounded-lg border border-red-200 text-red-700">Disconnect</button>
            : <button onClick={connect} disabled={!status.configured || busy === "connect"} className="flex items-center gap-1.5 text-sm font-bold px-3 py-1.5 rounded-lg text-white bg-[#1E7B4D] hover:bg-[#17633D] disabled:opacity-50"><Link2 className="w-3.5 h-3.5" />Connect AliExpress</button>}
        </div>
        {testResult && <p className={`w-full text-xs ${testResult.startsWith("Failed") ? "text-red-700" : "text-emerald-700"}`}>{testResult}</p>}
      </div>

      {status.connected && (
        <div className="grid lg:grid-cols-2 gap-5">
          <div className={card + " space-y-2"}>
            <h3 className="font-bold text-gray-900">Import by link</h3>
            <p className="text-xs text-gray-500">Paste AliExpress product links or ids, one per line (up to 20).</p>
            <textarea className={input + " h-28 font-mono text-xs"} value={links} onChange={e => setLinks(e.target.value)} placeholder="https://www.aliexpress.com/item/1005006349486340.html" />
            <button onClick={() => importItems(links.split(/\s+/).filter(Boolean))} disabled={!links.trim() || busy?.startsWith("import")}
              className="text-sm font-bold px-4 py-2 rounded-lg text-white bg-[#1E7B4D] hover:bg-[#17633D] disabled:opacity-50">{busy?.startsWith("import") ? "Importing…" : "Import and list"}</button>
          </div>
          <div className={card + " space-y-2"}>
            <h3 className="font-bold text-gray-900">Search AliExpress</h3>
            <div className="flex gap-2">
              <input className={input} value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === "Enter" && query.trim() && search()} placeholder="e.g. wireless earbuds" />
              <button onClick={search} disabled={!query.trim() || busy === "search"} className="px-3 rounded-lg border border-gray-200 disabled:opacity-50" aria-label="Search"><Search className="w-4 h-4" /></button>
            </div>
            <div className="max-h-72 overflow-y-auto divide-y divide-gray-50">
              {hits.map(h => (
                <div key={h.productId} className="flex items-center gap-2 py-2 text-xs">
                  {h.image && <img src={h.image} alt="" referrerPolicy="no-referrer" className="w-10 h-10 object-contain rounded bg-white border border-gray-100" />}
                  <div className="flex-1 min-w-0"><p className="truncate font-medium text-gray-800" title={h.title}>{h.title}</p>
                    <p className="text-gray-500">{h.priceUsd !== null ? `$${h.priceUsd}` : ""}{h.orders ? ` · ${h.orders.toLocaleString()} sold` : ""}</p></div>
                  <a href={h.url} target="_blank" rel="noopener noreferrer" className="text-gray-400" aria-label="Open on AliExpress"><ExternalLink className="w-3.5 h-3.5" /></a>
                  <button onClick={() => importItems([h.productId])} disabled={busy === `import-${h.productId}`} className="px-2.5 py-1 rounded-lg text-white bg-[#1E7B4D] disabled:opacity-50">Import</button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className={card}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-gray-900">Orders on AliExpress</h3>
          <button onClick={() => void load()} className="text-gray-400" aria-label="Refresh"><RefreshCw className="w-4 h-4" /></button>
        </div>
        {orders.length === 0 ? <p className="text-sm text-gray-500">None yet.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-left text-gray-500"><th className="py-1.5 pr-3">Order</th><th className="pr-3">Status</th><th className="pr-3">AliExpress order</th><th className="pr-3">Paid</th><th className="pr-3">Tracking</th><th>Problem</th><th /></tr></thead>
              <tbody>
                {orders.map(o => (
                  <tr key={o.id} className="border-t border-gray-50 align-top">
                    <td className="py-1.5 pr-3 font-medium">{o.orderNumber}</td>
                    <td className="pr-3"><span className={`px-2 py-0.5 rounded-full font-semibold ${ORDER_STYLE[o.status] ?? "bg-gray-100"}`}>{String(o.status).replace(/_/g, " ")}</span></td>
                    <td className="pr-3">{(o.aeOrderIds ?? []).join(", ") || "—"}</td>
                    <td className="pr-3">{o.paid ? "Yes" : o.status === "placed" ? <span className="text-amber-700 font-semibold">Pay in AliExpress</span> : "—"}</td>
                    <td className="pr-3">{o.trackingNumber ?? "—"}</td>
                    <td className="pr-3 text-red-700 max-w-sm">{o.lastError}</td>
                    <td>{(o.status === "needs_attention" || o.status === "failed") && <button onClick={() => retry(o.id)} className="px-2.5 py-1 rounded-lg border border-gray-200">Retry</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className={card}>
        <h3 className="font-bold text-gray-900 mb-3">Imported products ({products.length})</h3>
        {products.length === 0 ? <p className="text-sm text-gray-500">None yet.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-left text-gray-500"><th className="py-1.5 pr-3">Product</th><th className="pr-3">Cost</th><th className="pr-3">Shipping</th><th className="pr-3">Store price</th><th className="pr-3">Status</th><th /></tr></thead>
              <tbody>
                {products.map(p => (
                  <tr key={p.aliexpressId} className="border-t border-gray-50">
                    <td className="py-1.5 pr-3 max-w-xs truncate" title={p.name}>{p.name}</td>
                    <td className="pr-3">${p.costUsd.toFixed(2)}</td>
                    <td className="pr-3">{p.shippingUsd !== null ? `$${p.shippingUsd.toFixed(2)}` : "—"}{p.shippingService ? <span className="text-gray-400"> · {p.shippingService}</span> : null}</td>
                    <td className="pr-3 font-semibold">{zar(p.priceZar)}</td>
                    <td className="pr-3">{String(p.status).replace(/_/g, " ")}</td>
                    <td><a href={p.url} target="_blank" rel="noopener noreferrer" className="text-[#17633D]" aria-label="Open on AliExpress"><ExternalLink className="w-3.5 h-3.5" /></a></td>
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
