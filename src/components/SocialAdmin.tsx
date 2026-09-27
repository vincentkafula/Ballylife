/**
 * Admin: social media -- which platforms are connected, "Share now" for
 * any product (with a caption preview per platform), and the log of every
 * post with Retry for failed ones.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle, ExternalLink, Loader2, RefreshCw, Search, Send, X } from "lucide-react";
import { mktSocial, ApiConnectionError } from "../services/marketplaceApi";

type R = Record<string, any>;
const zar = (n: number) => `R${Math.round(n).toLocaleString("en-ZA")}`;
const errMessage = (err: unknown, fallback: string) => (err instanceof ApiConnectionError ? err.message : fallback);
const LABEL: Record<string, string> = { facebook: "Facebook", instagram: "Instagram", threads: "Threads", tiktok: "TikTok", linkedin: "LinkedIn" };
const POST_STYLE: Record<string, string> = {
  queued: "bg-gray-100 text-gray-700", posting: "bg-blue-50 text-blue-700", posted: "bg-emerald-50 text-emerald-700",
  failed: "bg-red-50 text-red-700", skipped: "bg-gray-100 text-gray-500",
};
const when = (d: string | null) => (d ? new Date(d).toLocaleString("en-ZA", { dateStyle: "medium", timeStyle: "short" }) : "—");

export function SocialAdminPanel() {
  const [status, setStatus] = useState<R | null>(null);
  const [meta, setMeta] = useState<R | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [posts, setPosts] = useState<R[]>([]);
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<R[]>([]);
  const [preview, setPreview] = useState<{ product: R; image: string; captions: Record<string, string> } | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, p] = await Promise.all([mktSocial.status(), mktSocial.posts()]);
      if (s.success) setStatus(s.data);
      if (p.success) setPosts(p.data ?? []);
      const m = await mktSocial.meta().catch(() => null);
      if (m?.success) { setMeta(m.data); setMetaError(null); } else setMetaError(m?.error ?? null);
    } catch (err) { toast.error(errMessage(err, "Couldn't load social media.")); }
  }, []);
  const findProducts = useCallback(async (q: string) => {
    try { const r = await mktSocial.candidates(q); if (r.success) setCandidates(r.data ?? []); }
    catch (err) { toast.error(errMessage(err, "Couldn't search products.")); }
  }, []);
  useEffect(() => { void load(); void findProducts(""); }, [load, findProducts]);

  const active: string[] = (status?.platforms ?? []).filter((p: R) => p.active).map((p: R) => p.platform);

  const openPreview = async (product: R) => {
    setBusy(`preview-${product.id}`);
    try {
      const r = await mktSocial.preview(product.id);
      if (r.success) { setPreview({ product, ...r.data }); setChosen(active); } else toast.error(r.error ?? "Couldn't preview.");
    } catch (err) { toast.error(errMessage(err, "Couldn't preview.")); }
    finally { setBusy(null); }
  };
  const share = async () => {
    if (!preview || !chosen.length) return;
    setBusy("share");
    try {
      const r = await mktSocial.share(preview.product.id, chosen);
      if (!r.success) { toast.error(r.error ?? "Couldn't share."); return; }
      const lines = Object.entries(r.data).map(([p, s]) => `${LABEL[p] ?? p}: ${s === "queued" ? "posting now" : s === "already_posted" ? "already posted" : "already queued"}`);
      toast.success(lines.join(" · "));
      setPreview(null);
      setTimeout(() => void load(), 4000);
      void findProducts(query);
    } catch (err) { toast.error(errMessage(err, "Couldn't share.")); }
    finally { setBusy(null); }
  };
  const retry = async (id: string) => {
    setBusy(`retry-${id}`);
    try { const r = await mktSocial.retry(id); if (r.success) { toast.success("Queued again."); void load(); } else toast.error(r.error ?? "Couldn't retry."); }
    catch (err) { toast.error(errMessage(err, "Couldn't retry.")); }
    finally { setBusy(null); }
  };

  if (!status) return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>;
  const card = "bg-white rounded-2xl border border-gray-100 p-5";

  return (
    <div className="space-y-5">
      <div className={card}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-gray-900">Social media</h3>
          <button onClick={() => void load()} className="text-xs text-gray-500 hover:text-gray-800 flex items-center gap-1"><RefreshCw className="w-3.5 h-3.5" /> Refresh</button>
        </div>
        <p className="text-sm text-gray-600 mb-4">
          Automatic posting is <b className={status.autopost ? "text-emerald-700" : "text-gray-900"}>{status.autopost ? "on" : "off"}</b>
          {status.autopost ? ` — the best new products, up to ${status.dailyCap} per platform a day, between ${status.hours} (SA time).` : " — set SOCIAL_AUTOPOST=on in Railway to start. Share now works either way."}
        </p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-2">
          {(status.platforms as R[]).map(p => {
            const fbIg = p.platform === "facebook" || p.platform === "instagram";
            const igMissing = p.platform === "instagram" && meta && !meta.instagramId;
            const ok = p.active && !(fbIg && metaError) && !igMissing;
            return (
              <div key={p.platform} className={`rounded-xl border p-3 text-sm ${ok ? "border-emerald-200 bg-emerald-50/50" : "border-gray-200"}`}>
                <div className="font-semibold text-gray-900 flex items-center gap-1.5">
                  {ok ? <CheckCircle className="w-4 h-4 text-emerald-600" /> : <AlertTriangle className="w-4 h-4 text-amber-500" />} {LABEL[p.platform]}
                </div>
                <div className="text-xs text-gray-600 mt-1">
                  {!p.built ? "Not built yet"
                    : !p.configured ? `Needs ${p.missing.join(", ")}`
                    : fbIg && metaError ? metaError
                    : p.platform === "facebook" && meta ? `Page: ${meta.pageName}`
                    : igMissing ? "No Instagram Business account linked to the Page"
                    : p.platform === "instagram" && meta ? `@${meta.instagramUsername}`
                    : "Connected"}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className={card}>
        <h3 className="font-bold text-gray-900 mb-3">Share a product now</h3>
        <form onSubmit={e => { e.preventDefault(); void findProducts(query); }} className="flex gap-2 mb-3">
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search products (newest shown first)"
            className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm w-full outline-none focus:border-[#1E7B4D]" />
          <button className="px-3 rounded-lg bg-gray-900 text-white text-sm flex items-center gap-1"><Search className="w-4 h-4" /> Search</button>
        </form>
        <div className="divide-y divide-gray-100 max-h-[420px] overflow-y-auto">
          {candidates.map(c => (
            <div key={c.id} className="flex items-center gap-3 py-2">
              <img src={c.image} alt="" className="w-12 h-12 rounded-lg object-cover bg-gray-100 shrink-0" loading="lazy" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-gray-900 truncate">{c.name}</div>
                <div className="text-xs text-gray-500">
                  {zar(c.priceZar)} · added {when(c.createdAt)}
                  {(c.posts as R[]).filter(p => p.status === "posted").length > 0 && <> · posted on {(c.posts as R[]).filter(p => p.status === "posted").map(p => LABEL[p.platform]).join(", ")}</>}
                </div>
              </div>
              <button onClick={() => void openPreview(c)} disabled={!active.length || busy === `preview-${c.id}`}
                className="px-3 py-1.5 rounded-lg bg-[#1E7B4D] hover:bg-[#17633D] text-white text-xs font-semibold flex items-center gap-1 disabled:opacity-40 shrink-0">
                {busy === `preview-${c.id}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Share
              </button>
            </div>
          ))}
          {!candidates.length && <p className="text-sm text-gray-500 py-4">No products with photos found.</p>}
        </div>
      </div>

      <div className={card}>
        <h3 className="font-bold text-gray-900 mb-3">Posting log</h3>
        {!posts.length ? <p className="text-sm text-gray-500">Nothing posted yet.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                <th className="py-2 pr-3">Product</th><th className="pr-3">Platform</th><th className="pr-3">Status</th><th className="pr-3">How</th><th className="pr-3">When</th><th></th>
              </tr></thead>
              <tbody className="divide-y divide-gray-50">
                {posts.map(p => (
                  <tr key={p.id} className="align-top">
                    <td className="py-2 pr-3 max-w-[260px]"><div className="truncate text-gray-900">{p.productName ?? p.productId}</div>
                      {p.lastError && <div className="text-xs text-red-600 mt-0.5 break-words">{p.lastError}</div>}</td>
                    <td className="pr-3 py-2">{LABEL[p.platform] ?? p.platform}</td>
                    <td className="pr-3 py-2"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${POST_STYLE[p.status] ?? "bg-gray-100"}`}>{p.status}</span>
                      {p.attempts > 1 && <span className="text-xs text-gray-400 ml-1">×{p.attempts}</span>}</td>
                    <td className="pr-3 py-2 text-xs text-gray-500">{p.trigger === "manual" ? "Share now" : "Automatic"}</td>
                    <td className="pr-3 py-2 text-xs text-gray-500 whitespace-nowrap">{when(p.postedAt ?? p.scheduledFor)}</td>
                    <td className="py-2 text-right whitespace-nowrap">
                      {p.externalUrl && <a href={p.externalUrl} target="_blank" rel="noreferrer" className="text-xs text-[#1E7B4D] inline-flex items-center gap-0.5">View <ExternalLink className="w-3 h-3" /></a>}
                      {p.status === "failed" && <button onClick={() => void retry(p.id)} disabled={busy === `retry-${p.id}`} className="text-xs text-gray-700 underline ml-2">Retry</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {preview && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setPreview(null)}>
          <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 mb-3">
              <h3 className="font-bold text-gray-900">Share “{preview.product.name}”</h3>
              <button onClick={() => setPreview(null)} aria-label="Close"><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <img src={preview.image} alt="" className="w-40 h-40 rounded-xl object-cover bg-gray-100 mb-4" />
            <div className="space-y-3">
              {active.map(p => (
                <label key={p} className="block border border-gray-200 rounded-xl p-3 cursor-pointer">
                  <div className="flex items-center gap-2 text-sm font-semibold text-gray-900 mb-1.5">
                    <input type="checkbox" checked={chosen.includes(p)} onChange={e => setChosen(c => e.target.checked ? [...c, p] : c.filter(x => x !== p))} />
                    {LABEL[p]}
                    {p === "instagram" && meta && !meta.instagramId && <span className="text-xs font-normal text-amber-600">not linked yet — will fail</span>}
                  </div>
                  <pre className="whitespace-pre-wrap text-xs text-gray-700 font-sans bg-gray-50 rounded-lg p-2.5">{preview.captions[p]}</pre>
                </label>
              ))}
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setPreview(null)} className="px-4 py-2 rounded-lg border border-gray-200 text-sm">Cancel</button>
              <button onClick={() => void share()} disabled={!chosen.length || busy === "share"}
                className="px-4 py-2 rounded-lg bg-[#1E7B4D] hover:bg-[#17633D] text-white text-sm font-semibold flex items-center gap-1.5 disabled:opacity-40">
                {busy === "share" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Post now (public)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
