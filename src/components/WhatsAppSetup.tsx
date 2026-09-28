/**
 * Admin: WhatsApp setup and deals, shown under the WhatsApp Inbox.
 *  - Message templates: approval status of every template the bot uses,
 *    and a button that submits the missing ones to Meta.
 *  - Business profile: what customers see on Ballylife's WhatsApp number.
 *  - Deals broadcast: send one product to customers who asked for deals,
 *    after confirming how many will receive it.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCircle, Clock, Loader2, Megaphone, Search, Send, XCircle } from "lucide-react";
import { mktWhatsApp, mktSocial, ApiConnectionError } from "../services/marketplaceApi";

type R = Record<string, any>;
const errMessage = (err: unknown, fallback: string) => (err instanceof ApiConnectionError ? err.message : fallback);
const card = "bg-white rounded-2xl border border-gray-100 p-5";
const input = "border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm w-full outline-none focus:border-[#1E7B4D]";
const zar = (n: number) => `R${Math.round(n).toLocaleString("en-ZA")}`;

function StatusChip({ status }: { status: string }) {
  if (status === "APPROVED") return <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700"><CheckCircle className="w-3.5 h-3.5" /> Approved</span>;
  if (status === "PENDING" || status === "IN_APPEAL") return <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700"><Clock className="w-3.5 h-3.5" /> In review</span>;
  if (status === "NOT_SUBMITTED") return <span className="text-xs font-medium text-gray-500">Not submitted</span>;
  return <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600"><XCircle className="w-3.5 h-3.5" /> {status.toLowerCase()}</span>;
}

export function WhatsAppSetupPanel() {
  const [templates, setTemplates] = useState<R[] | null>(null);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [profile, setProfile] = useState<R | null>(null);
  const [deals, setDeals] = useState<R | null>(null);
  const [query, setQuery] = useState("");
  const [products, setProducts] = useState<R[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const t = await mktWhatsApp.templates();
      if (t.success) { setTemplates(t.data); setTemplatesError(null); } else setTemplatesError(t.error ?? "Couldn't read templates.");
    } catch (err) { setTemplatesError(errMessage(err, "Couldn't read templates.")); }
    try {
      const p = await mktWhatsApp.profile();
      if (p.success) setProfile({ ...p.data.suggested, ...Object.fromEntries(Object.entries(p.data.current).filter(([, v]) => v !== "" && v != null && !(Array.isArray(v) && !v.length))) });
    } catch { /* shown as empty form */ }
    try { const d = await mktWhatsApp.deals(); if (d.success) setDeals(d.data); } catch { /* ignore */ }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const findProducts = async () => {
    try { const r = await mktSocial.candidates(query); if (r.success) setProducts((r.data ?? []).slice(0, 8)); }
    catch (err) { toast.error(errMessage(err, "Couldn't search products.")); }
  };

  const submitTemplates = async () => {
    setBusy("templates");
    try {
      const r = await mktWhatsApp.submitTemplates();
      if (!r.success) { toast.error(r.error ?? "Couldn't submit templates."); return; }
      if (r.data.submitted.length) toast.success(`Submitted ${r.data.submitted.length} template(s) to Meta for review.`);
      for (const f of r.data.failed) toast.error(`${f.name}: ${f.error}`);
      if (!r.data.submitted.length && !r.data.failed.length) toast("All templates are already with Meta.");
      await load();
    } catch (err) { toast.error(errMessage(err, "Couldn't submit templates.")); }
    finally { setBusy(null); }
  };

  const saveProfile = async () => {
    if (!profile) return;
    setBusy("profile");
    try {
      const r = await mktWhatsApp.saveProfile({ about: profile.about, description: profile.description, email: profile.email, address: profile.address, websites: [String(profile.websites?.[0] ?? "")].filter(Boolean) });
      if (r.success) toast.success("WhatsApp profile updated."); else toast.error(r.error ?? "Couldn't update the profile.");
    } catch (err) { toast.error(errMessage(err, "Couldn't update the profile.")); }
    finally { setBusy(null); }
  };

  const broadcast = async (p: R) => {
    if (!deals?.reachableNow) { toast("Nobody is due a deals message right now."); return; }
    if (!window.confirm(`Send "${p.name}" (${zar(p.priceZar)}) to ${deals.reachableNow} customer(s) who asked for deals?\n\nMessages outside the 24-hour window are paid marketing messages (charged by Meta).`)) return;
    setBusy(`bc-${p.id}`);
    try {
      const r = await mktWhatsApp.broadcast(String(p.id));
      if (r.success) { toast.success(`Sending to ${r.data.recipients} customer(s)…`); setTimeout(() => void load(), 3000); }
      else toast.error(r.error ?? "Couldn't send.");
    } catch (err) { toast.error(errMessage(err, "Couldn't send.")); }
    finally { setBusy(null); }
  };

  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <div className={card}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-gray-900">Message templates</h3>
          <button onClick={() => void submitTemplates()} disabled={busy === "templates" || !templates}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-[#1E7B4D] hover:bg-[#17633D] text-white flex items-center gap-1 disabled:opacity-40">
            {busy === "templates" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Submit missing
          </button>
        </div>
        <p className="text-xs text-gray-500 mb-3">Needed for messages sent more than 24 hours after a customer's last message. Meta reviews each one (usually minutes to a day).</p>
        {templatesError ? <p className="text-sm text-red-600">{templatesError}</p> : !templates ? <Loader2 className="w-4 h-4 animate-spin text-gray-400" /> : (
          <div className="divide-y divide-gray-50">
            {templates.map(t => (
              <div key={t.name} className="py-2 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-gray-900">{t.purpose}</div>
                  <div className="text-[11px] text-gray-500">{t.name} · {String(t.category).toLowerCase()}{t.reason ? ` · ${t.reason}` : ""}</div>
                </div>
                <StatusChip status={t.status} />
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={card}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-gray-900 flex items-center gap-1.5"><Megaphone className="w-4 h-4 text-[#1E7B4D]" /> Deals on WhatsApp</h3>
          {deals && <span className="text-xs text-gray-600"><b className="text-gray-900">{deals.subscribers}</b> subscribed · <b className="text-gray-900">{deals.reachableNow}</b> due a message</span>}
        </div>
        <p className="text-xs text-gray-500 mb-3">Customers join by typing <i>deals</i> in the chat. Each gets at most one offer every 3 days, and <i>STOP DEALS</i> works any time.</p>
        <form onSubmit={e => { e.preventDefault(); void findProducts(); }} className="flex gap-2 mb-2">
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Find a product to send (newest first)" className={input} />
          <button className="px-3 rounded-lg bg-gray-900 text-white text-sm flex items-center gap-1"><Search className="w-4 h-4" /></button>
        </form>
        <div className="divide-y divide-gray-50 max-h-64 overflow-y-auto">
          {products.map(p => (
            <div key={p.id} className="flex items-center gap-3 py-2">
              <img src={p.image} alt="" className="w-10 h-10 rounded-lg object-cover bg-gray-100 shrink-0" loading="lazy" />
              <div className="min-w-0 flex-1"><div className="text-sm text-gray-900 truncate">{p.name}</div><div className="text-[11px] text-gray-500">{zar(p.priceZar)}</div></div>
              <button onClick={() => void broadcast(p)} disabled={busy !== null || !deals?.reachableNow}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-[#1E7B4D] hover:bg-[#17633D] text-white disabled:opacity-40 shrink-0">
                {busy === `bc-${p.id}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Send"}
              </button>
            </div>
          ))}
        </div>
        {deals?.broadcasts?.length > 0 && (
          <div className="mt-3 border-t border-gray-100 pt-2 space-y-1">
            {(deals.broadcasts as R[]).slice(0, 4).map(b => (
              <div key={b.id} className="text-[11px] text-gray-500 flex justify-between gap-2">
                <span className="truncate">{b.productName}</span>
                <span className="shrink-0">{b.status === "done" ? `${b.sent} sent${b.failed ? `, ${b.failed} failed` : ""}` : `sending… ${b.sent}/${b.recipients}`}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={`${card} lg:col-span-2`}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-gray-900">WhatsApp business profile</h3>
          <button onClick={() => void saveProfile()} disabled={busy === "profile" || !profile}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-[#1E7B4D] hover:bg-[#17633D] text-white flex items-center gap-1 disabled:opacity-40">
            {busy === "profile" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />} Save to WhatsApp
          </button>
        </div>
        {!profile ? <p className="text-sm text-gray-500">Couldn't read the profile — check the WhatsApp connection.</p> : (
          <div className="grid md:grid-cols-2 gap-3 text-sm">
            <label className="block"><span className="text-xs text-gray-500">About (max 139)</span>
              <input value={profile.about ?? ""} maxLength={139} onChange={e => setProfile({ ...profile, about: e.target.value })} className={input} /></label>
            <label className="block"><span className="text-xs text-gray-500">Website</span>
              <input value={profile.websites?.[0] ?? ""} onChange={e => setProfile({ ...profile, websites: [e.target.value] })} className={input} /></label>
            <label className="block md:col-span-2"><span className="text-xs text-gray-500">Description (max 512)</span>
              <textarea value={profile.description ?? ""} maxLength={512} rows={3} onChange={e => setProfile({ ...profile, description: e.target.value })} className={`${input} resize-none`} /></label>
            <label className="block"><span className="text-xs text-gray-500">Support email</span>
              <input value={profile.email ?? ""} onChange={e => setProfile({ ...profile, email: e.target.value })} className={input} /></label>
            <label className="block"><span className="text-xs text-gray-500">Address</span>
              <input value={profile.address ?? ""} onChange={e => setProfile({ ...profile, address: e.target.value })} className={input} /></label>
          </div>
        )}
        <p className="text-[11px] text-gray-400 mt-2">The profile photo is set in WhatsApp Manager (business.facebook.com → WhatsApp Manager → Phone numbers → Profile).</p>
      </div>
    </div>
  );
}
