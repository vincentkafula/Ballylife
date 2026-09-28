import { useState, useEffect, useCallback } from "react";
import { Search, Loader2, X, Star, Truck, PackageCheck } from "lucide-react";
import { mktSourcing } from "../services/marketplaceApi";

// Sellers search Ballylife's supplier network, check their profit and add
// products to their store. Everything here is white-labelled by the server:
// no supplier names, links or supplier prices ever reach this screen.

interface Hit { ref: string; title: string; image: string | null; fromCostZar: number; orders: number | null; rating: number | null }
interface Variant { ref: string; label: string; baseCostZar: number; stock: number; inStock: boolean; image: string | null }
interface Product {
  ref: string; title: string; description: string; images: string[]; variants: Variant[];
  baseCostZar: number; deliveryZar: number | null; delivery: { minDays: number | null; maxDays: number | null };
  available: boolean; commissionPct: number; minPriceZar: number;
}
interface Quota {
  plan: string; planName: string; commissionPct: number;
  limits: { searchesPerDay: number; viewsPerDay: number; activeImports: number; importsPerMonth: number };
  used: { searchesToday: number; viewsToday: number; activeImports: number; importsThisMonth: number };
}

const GOLD = "#B8862E";
const rand = (n: number) => `R${Number(n ?? 0).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** A starting price: about 60% on top of cost, ending in 9. */
const suggestedPrice = (min: number, base: number) => Math.max(min, Math.ceil((base * 1.6) / 10) * 10 - 1);

function Meter({ label, used, limit }: { label: string; used: number; limit: number }) {
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 100;
  return (
    <div className="min-w-[120px] flex-1">
      <div className="flex justify-between text-[11px] text-gray-500"><span>{label}</span><span className="font-semibold text-gray-700">{used}/{limit}</span></div>
      <div className="h-1.5 rounded-full bg-gray-100 mt-1 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${pct}%`, background: pct >= 100 ? "#DC2626" : GOLD }} /></div>
    </div>
  );
}

export function SellerSourcing({ onImported }: { onImported: () => void }) {
  const [quota, setQuota] = useState<Quota | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [keyword, setKeyword] = useState("");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openRef, setOpenRef] = useState<string | null>(null);

  const loadQuota = useCallback(async () => {
    try {
      const r = await mktSourcing.quota();
      if (r.success) { setQuota(r.data as Quota); setBlocked(null); }
      else setBlocked(r.error ?? "Product sourcing isn't available for your store yet.");
    } catch { setBlocked("We couldn't load product sourcing. Please try again."); }
  }, []);
  useEffect(() => { loadQuota(); }, [loadQuota]);

  const search = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (keyword.trim().length < 2) { setError("Type at least 2 letters to search."); return; }
    setSearching(true); setError(null);
    try {
      const p: Record<string, string> = { q: keyword.trim() };
      if (minPrice) p.minPrice = minPrice;
      if (maxPrice) p.maxPrice = maxPrice;
      const r = await mktSourcing.search(p);
      if (r.success) setHits(r.data as Hit[]); else setError(r.error ?? "Search failed. Please try again.");
    } catch { setError("Search failed. Please check your connection and try again."); }
    setSearching(false);
    loadQuota();
  };

  if (blocked) return <p className="text-sm text-gray-600 p-6 text-center bg-white rounded-xl border border-gray-100">{blocked}</p>;

  const searchesLeft = quota ? quota.limits.searchesPerDay - quota.used.searchesToday : 1;
  return (
    <div>
      <div className="mb-4">
        <p className="text-sm font-bold text-gray-900 mb-1">Find products</p>
        <p className="text-xs text-gray-500">Search our supplier network, set your own price and add products to your store. Ballylife buys, ships and tracks every order for you. Your store never shows where a product comes from.</p>
      </div>

      {quota && (
        <div className="bg-white rounded-xl border border-gray-100 p-3 mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-gray-900">{quota.planName} plan</span>
            <span className="text-[11px] text-gray-500">Resets daily at midnight</span>
          </div>
          <div className="flex flex-wrap gap-4">
            <Meter label="Searches today" used={quota.used.searchesToday} limit={quota.limits.searchesPerDay} />
            <Meter label="Products opened today" used={quota.used.viewsToday} limit={quota.limits.viewsPerDay} />
            <Meter label="Imported in your store" used={quota.used.activeImports} limit={quota.limits.activeImports} />
            <Meter label="Imported this month" used={quota.used.importsThisMonth} limit={quota.limits.importsPerMonth} />
          </div>
        </div>
      )}

      <form onSubmit={search} className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input placeholder="What do you want to sell? e.g. wireless earbuds" value={keyword} onChange={e => setKeyword(e.target.value)} maxLength={100}
            className="w-full border border-gray-200 rounded-lg pl-8 pr-3 py-2 text-sm" />
        </div>
        <input type="number" min={0} placeholder="Min cost R" value={minPrice} onChange={e => setMinPrice(e.target.value)} className="w-28 border border-gray-200 rounded-lg px-2.5 py-2 text-sm" />
        <input type="number" min={0} placeholder="Max cost R" value={maxPrice} onChange={e => setMaxPrice(e.target.value)} className="w-28 border border-gray-200 rounded-lg px-2.5 py-2 text-sm" />
        <button type="submit" disabled={searching || searchesLeft <= 0}
          className="px-4 py-2 rounded-lg text-white text-sm font-semibold disabled:opacity-40" style={{ background: GOLD }}>
          {searching ? "Searching..." : "Search"}
        </button>
      </form>

      {error && <div className="mb-3 text-xs font-medium px-3 py-2 rounded-lg bg-amber-50 text-amber-800 border border-amber-200">{error}</div>}

      {searching ? (
        <div className="flex items-center justify-center h-32"><Loader2 className="w-6 h-6 animate-spin text-gray-500" /></div>
      ) : hits === null ? (
        <p className="text-sm text-gray-500 p-6 text-center bg-white rounded-xl border border-gray-100">Search for a product to get started. Each search counts towards your daily limit.</p>
      ) : hits.length === 0 ? (
        <p className="text-sm text-gray-500 p-6 text-center bg-white rounded-xl border border-gray-100">Nothing found. Try a different or simpler word.</p>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {hits.map(h => (
            <button key={h.ref} onClick={() => setOpenRef(h.ref)} className="text-left bg-white rounded-xl border border-gray-100 p-3 hover:border-gray-300 transition-colors">
              <div className="mb-2 rounded-lg overflow-hidden bg-gray-50" style={{ aspectRatio: "1 / 1" }}>
                {h.image ? <img src={h.image} alt={h.title} loading="lazy" className="w-full h-full object-contain" /> : <div className="w-full h-full flex items-center justify-center text-3xl">📦</div>}
              </div>
              <p className="text-xs font-semibold text-gray-900 leading-tight line-clamp-2 mb-1">{h.title}</p>
              <p className="text-xs text-gray-600">Cost from <span className="font-bold text-gray-900">{rand(h.fromCostZar)}</span></p>
              <div className="flex items-center gap-2 mt-1 text-[11px] text-gray-500">
                {h.rating ? <span className="flex items-center gap-0.5"><Star className="w-3 h-3 fill-amber-400 text-amber-400" />{h.rating}</span> : null}
                {h.orders ? <span>{h.orders.toLocaleString()} sold</span> : null}
              </div>
            </button>
          ))}
        </div>
      )}

      {openRef && <ProductPanel refId={openRef} onClose={() => { setOpenRef(null); loadQuota(); }} onImported={() => { onImported(); loadQuota(); }} />}
    </div>
  );
}

function ProductPanel({ refId, onClose, onImported }: { refId: string; onClose: () => void; onImported: () => void }) {
  const [product, setProduct] = useState<Product | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [price, setPrice] = useState("");
  const [compareAt, setCompareAt] = useState("");
  const [photo, setPhoto] = useState(0);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let live = true;
    mktSourcing.product(refId).then(r => {
      if (!live) return;
      if (r.success) {
        const p = r.data as Product;
        setProduct(p);
        setPrice(String(suggestedPrice(p.minPriceZar, p.baseCostZar)));
      } else setLoadError(r.error ?? "Couldn't load this product.");
    }).catch(() => live && setLoadError("Couldn't load this product. Please try again."));
    return () => { live = false; };
  }, [refId]);

  const sell = Number(price) || 0;
  const commission = product ? Math.round(sell * product.commissionPct) / 100 : 0;
  const profit = product ? sell - commission - product.baseCostZar : 0;
  const margin = sell > 0 ? (profit / sell) * 100 : 0;
  const tooLow = product ? sell < product.minPriceZar : true;

  const importIt = async () => {
    if (!product) return;
    setSaving(true); setResult(null);
    try {
      const r = await mktSourcing.importProduct({ ref: product.ref, retailPrice: sell, ...(compareAt ? { compareAtPrice: Number(compareAt) } : {}) });
      if (r.success) { setResult({ ok: true, text: r.message ?? "Added to your store. It goes live once the Ballylife team approves it." }); onImported(); }
      else setResult({ ok: false, text: r.error ?? "Couldn't add this product." });
    } catch { setResult({ ok: false, text: "Couldn't add this product. Please check your connection and try again." }); }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-3xl max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl p-4 sm:p-5" onClick={e => e.stopPropagation()}>
        <div className="flex justify-end"><button onClick={onClose} aria-label="Close" className="p-1 text-gray-500 hover:text-gray-800"><X className="w-5 h-5" /></button></div>
        {loadError ? <p className="text-sm text-gray-600 p-6 text-center">{loadError}</p> : !product ? (
          <div className="flex items-center justify-center h-40"><Loader2 className="w-6 h-6 animate-spin text-gray-500" /></div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-5">
            <div>
              <div className="rounded-xl overflow-hidden bg-gray-50 border border-gray-100" style={{ aspectRatio: "1 / 1" }}>
                {product.images[photo] ? <img src={product.images[photo]} alt={product.title} className="w-full h-full object-contain" /> : <div className="w-full h-full flex items-center justify-center text-5xl">📦</div>}
              </div>
              {product.images.length > 1 && (
                <div className="flex gap-1.5 mt-2 overflow-x-auto">
                  {product.images.slice(0, 8).map((src, i) => (
                    <button key={src} onClick={() => setPhoto(i)} className="w-12 h-12 shrink-0 rounded-md overflow-hidden border" style={{ borderColor: i === photo ? GOLD : "#E5E7EB" }}>
                      <img src={src} alt="" loading="lazy" className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
              <p className="text-xs text-gray-600 mt-3 whitespace-pre-line line-clamp-[10]">{product.description}</p>
            </div>

            <div>
              <p className="text-base font-bold text-gray-900 leading-snug mb-2">{product.title}</p>
              <div className="flex items-center gap-1.5 text-xs text-gray-600 mb-1"><Truck className="w-3.5 h-3.5" />
                Delivery to South Africa{product.delivery.minDays ? ` in about ${product.delivery.minDays}–${product.delivery.maxDays} days` : ""}, handled by Ballylife
              </div>
              {!product.available && <p className="text-xs font-semibold text-red-600 mb-2">Out of stock right now</p>}
              {product.variants.length > 1 && (
                <div className="mb-3">
                  <p className="text-[11px] text-gray-500 mb-1">Options your customers can choose</p>
                  <div className="flex flex-wrap gap-1.5">
                    {product.variants.map(v => (
                      <span key={v.ref} className="text-[11px] px-2 py-0.5 rounded-full border" style={{ borderColor: "#E5E7EB", color: v.inStock ? "#374151" : "#9CA3AF", textDecoration: v.inStock ? "none" : "line-through" }}>{v.label}</span>
                    ))}
                  </div>
                </div>
              )}

              <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 mb-3">
                <p className="text-xs font-bold text-gray-900 mb-2">Profit calculator</p>
                <label className="block mb-2">
                  <span className="text-[11px] text-gray-500">Your selling price (R)</span>
                  <input type="number" min={product.minPriceZar} step="1" value={price} onChange={e => setPrice(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm mt-1 bg-white" />
                </label>
                <label className="block mb-3">
                  <span className="text-[11px] text-gray-500">"Was" price (optional, shows a discount)</span>
                  <input type="number" min={0} step="1" value={compareAt} onChange={e => setCompareAt(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm mt-1 bg-white" />
                </label>
                <dl className="text-xs space-y-1">
                  <div className="flex justify-between"><dt className="text-gray-600">Customer pays</dt><dd className="font-semibold">{rand(sell)}</dd></div>
                  <div className="flex justify-between"><dt className="text-gray-600">Product and delivery</dt><dd>− {rand(product.baseCostZar)}</dd></div>
                  <div className="flex justify-between"><dt className="text-gray-600">Ballylife commission ({product.commissionPct}%)</dt><dd>− {rand(commission)}</dd></div>
                  <div className="flex justify-between border-t border-gray-200 pt-1 mt-1">
                    <dt className="font-bold text-gray-900">Your profit per sale</dt>
                    <dd className="font-bold" style={{ color: profit > 0 ? "#0B5C2E" : "#DC2626" }}>{rand(profit)}{sell > 0 ? ` (${margin.toFixed(0)}%)` : ""}</dd>
                  </div>
                </dl>
                {tooLow && <p className="text-[11px] text-red-600 mt-2">Your price must be at least {rand(product.minPriceZar)} to cover costs.</p>}
              </div>

              {result && (
                <div className={`mb-3 text-xs font-medium px-3 py-2 rounded-lg border ${result.ok ? "bg-green-50 text-green-800 border-green-200" : "bg-amber-50 text-amber-800 border-amber-200"}`}>
                  {result.ok && <PackageCheck className="w-3.5 h-3.5 inline mr-1" />}{result.text}
                </div>
              )}
              <button onClick={importIt} disabled={saving || tooLow || !product.available || result?.ok}
                className="w-full px-4 py-2.5 rounded-lg text-white text-sm font-semibold disabled:opacity-40" style={{ background: GOLD }}>
                {saving ? "Adding..." : result?.ok ? "Added to your store" : "Add to my store"}
              </button>
              <p className="text-[11px] text-gray-500 mt-2">Costs can change with the exchange rate. After your listing is live, price changes need Ballylife's approval.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
