/**
 * Manager: the Ballylife email inbox. Every @ballylife.com address
 * (info@, orders@, legal@...) arrives here; replies go out from that same
 * address and stay in the customer's thread. New conversations get an
 * automatic acknowledgement from the server.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Inbox, Loader2, Mail, Paperclip, PenSquare, RefreshCw, Search, Send, ShieldAlert, X } from "lucide-react";
import { mktInbox, getMktToken, ApiConnectionError } from "../services/marketplaceApi";
import { API_BASE } from "../services/config";

type R = Record<string, any>;
const when = (d: string) => {
  const t = new Date(d);
  return t.toDateString() === new Date().toDateString()
    ? t.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })
    : t.toLocaleDateString("en-ZA", { day: "numeric", month: "short" });
};
const errMessage = (err: unknown, fallback: string) => (err instanceof ApiConnectionError ? err.message : fallback);

/** Shows an email's own HTML isolated from our page: no scripts, no access to the site, links open in a new tab. */
function EmailHtml({ html }: { html: string }) {
  const doc = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data: cid:; style-src 'unsafe-inline'; font-src https: data:">
<base target="_blank"><style>body{font-family:Arial,sans-serif;font-size:14px;color:#111;margin:0;word-wrap:break-word}img{max-width:100%;height:auto}</style>
</head><body>${html}</body></html>`;
  const [height, setHeight] = useState(240);
  return (
    <iframe title="Email" sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={doc} className="w-full border-0 bg-white"
      style={{ height }} onLoad={e => {
        // Can't read a sandboxed frame's height; grow to a sensible size for long emails.
        const lines = html.replace(/<[^>]+>/g, " ").length / 90 + (html.match(/<(p|br|div|tr|li|img)/gi)?.length ?? 0);
        setHeight(Math.min(900, Math.max(160, Math.round(lines * 22))));
        void e;
      }} />
  );
}

async function downloadAttachment(id: string, filename: string) {
  try {
    const res = await fetch(`${API_BASE}/api/marketplace/admin/inbox/attachments/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${getMktToken() ?? ""}` } });
    if (!res.ok) { toast.error("That attachment isn't available."); return; }
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  } catch { toast.error("Couldn't download the attachment."); }
}

export function EmailInboxPanel() {
  const [mailboxes, setMailboxes] = useState<R[]>([]);
  const [receiving, setReceiving] = useState(true);
  const [mailbox, setMailbox] = useState<string>("");          // "" = all
  const [status, setStatus] = useState<"open" | "closed" | "">("open");
  const [q, setQ] = useState("");
  const [threads, setThreads] = useState<R[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [thread, setThread] = useState<R | null>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [composing, setComposing] = useState(false);
  const [recv, setRecv] = useState<R | null>(null);
  const [recvError, setRecvError] = useState<string | null>(null);
  const [recvBusy, setRecvBusy] = useState(false);
  const loadReceiving = useCallback(async () => {
    try { const r = await mktInbox.receiving(); if (r.success) { setRecv(r.data); setRecvError(null); } else setRecvError(r.error ?? null); }
    catch { /* shown as unknown */ }
  }, []);
  useEffect(() => { void loadReceiving(); }, [loadReceiving]);
  const switchOnReceiving = async () => {
    setRecvBusy(true);
    try {
      const r = await mktInbox.enableReceiving();
      if (r.success) { setRecv(r.data); setRecvError(null); toast.success("Receiving is switched on in Resend."); }
      else { setRecvError(r.error ?? "Resend didn't switch it on."); toast.error(r.error ?? "Resend didn't switch it on."); }
    } catch (err) { toast.error(errMessage(err, "Couldn't reach the server.")); }
    finally { setRecvBusy(false); }
  };
  // Fully on only when Resend has receiving enabled AND has verified the MX record.
  const receivingOn = recv?.receiving === "enabled" && (!recv?.mx || String(recv.mx.status).toLowerCase() === "verified");

  const loadMailboxes = useCallback(async () => {
    try { const r = await mktInbox.mailboxes(); if (r.success) { setMailboxes(r.data.mailboxes); setReceiving(r.data.receiving); } }
    catch (err) { toast.error(errMessage(err, "Couldn't load the mailboxes.")); }
  }, []);
  const loadThreads = useCallback(async () => {
    try {
      const params: Record<string, string> = {};
      if (mailbox) params.mailbox = mailbox;
      if (status) params.status = status;
      if (q.trim()) params.q = q.trim();
      const r = await mktInbox.threads(params);
      if (r.success) setThreads(r.data);
    } catch (err) { toast.error(errMessage(err, "Couldn't load the conversations.")); }
  }, [mailbox, status, q]);
  const loadThread = useCallback(async (id: string) => {
    setThread(null);
    try { const r = await mktInbox.thread(id); if (r.success) { setThread(r.data); void loadMailboxes(); } else toast.error(r.error ?? "Couldn't open it."); }
    catch (err) { toast.error(errMessage(err, "Couldn't open the conversation.")); }
  }, [loadMailboxes]);

  useEffect(() => { void loadMailboxes(); }, [loadMailboxes]);
  useEffect(() => { const t = setTimeout(() => void loadThreads(), 250); return () => clearTimeout(t); }, [loadThreads]);
  useEffect(() => { if (openId) void loadThread(openId); }, [openId, loadThread]);
  // New mail arrives by itself: refresh every minute.
  useEffect(() => { const t = setInterval(() => { void loadMailboxes(); void loadThreads(); }, 60_000); return () => clearInterval(t); }, [loadMailboxes, loadThreads]);

  const sendReply = async () => {
    if (!thread || !reply.trim()) return;
    setBusy(true);
    try {
      const r = await mktInbox.reply(thread.id, reply);
      if (r.success) { setThread(r.data); setReply(""); toast.success(`Reply sent from ${thread.mailbox}`); void loadThreads(); }
      else toast.error(r.error ?? "The reply wasn't sent.");
    } catch (err) { toast.error(errMessage(err, "The reply wasn't sent.")); }
    finally { setBusy(false); }
  };
  const toggleStatus = async () => {
    if (!thread) return;
    const next = thread.status === "open" ? "closed" : "open";
    try {
      const r = await mktInbox.setStatus(thread.id, next);
      if (r.success) { setThread({ ...thread, status: next }); void loadThreads(); void loadMailboxes(); }
    } catch (err) { toast.error(errMessage(err, "Couldn't update it.")); }
  };

  const totalUnread = mailboxes.reduce((n, m) => n + Number(m.unread ?? 0), 0);

  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
      {(!receivingOn || recvError) && (
        <div className="px-4 py-2.5 text-xs bg-amber-50 text-amber-900 border-b border-amber-100 flex items-center gap-3 flex-wrap">
          <ShieldAlert className="w-4 h-4 shrink-0" />
          <span className="flex-1 min-w-[200px]">
            {recvError ? recvError
              : recv ? <>Resend isn't accepting mail for ballylife.com yet (receiving: <b>{String(recv.receiving ?? "off")}</b>{recv.mx ? <>, MX record {recv.mx.value}: <b>{recv.mx.status}</b></> : null}), so emails to our addresses bounce.</>
                : "Checking whether Resend accepts mail for ballylife.com…"}
          </span>
          <button onClick={switchOnReceiving} disabled={recvBusy} className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-40" style={{ background: "#14110D" }}>
            {recvBusy ? "Switching on…" : "Switch on receiving"}
          </button>
        </div>
      )}
      {!receiving && (
        <div className="px-4 py-2.5 text-xs bg-amber-50 text-amber-800 border-b border-amber-100 flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 shrink-0" />
          Receiving isn't switched on yet: add RESEND_WEBHOOK_SECRET on the backend and point ballylife.com's MX record to Resend. Replies and new emails already work.
        </div>
      )}
      <div className="grid lg:grid-cols-[220px_minmax(0,320px)_minmax(0,1fr)] min-h-[620px]">
        {/* Mailboxes */}
        <aside className={`border-r border-gray-100 p-3 space-y-1 ${openId ? "hidden lg:block" : ""}`}>
          <button onClick={() => setComposing(true)} className="w-full flex items-center justify-center gap-2 px-3 py-2 mb-2 rounded-lg text-sm font-semibold text-white" style={{ background: "#14110D" }}>
            <PenSquare className="w-4 h-4" /> New email
          </button>
          {[{ address: "", label: "All mailboxes", unread: totalUnread }, ...mailboxes].map(m => (
            <button key={m.address || "all"} onClick={() => { setMailbox(m.address); setOpenId(null); }}
              className={`w-full text-left px-2.5 py-2 rounded-lg text-sm flex items-center justify-between gap-2 ${mailbox === m.address ? "bg-emerald-50 text-emerald-900" : "hover:bg-gray-50 text-gray-700"}`}>
              <span className="min-w-0">
                <span className="block truncate font-medium">{m.address ? m.address.split("@")[0] + "@" : m.label}</span>
                {m.address && <span className="block text-[11px] text-gray-500 truncate">{m.label}</span>}
              </span>
              {Number(m.unread) > 0 && <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-600 text-white">{m.unread}</span>}
            </button>
          ))}
        </aside>

        {/* Conversations */}
        <section className={`border-r border-gray-100 flex flex-col min-w-0 ${openId ? "hidden lg:flex" : ""}`}>
          <div className="p-3 border-b border-gray-100 space-y-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, email, subject" className="w-full border border-gray-200 rounded-lg pl-8 pr-2 py-1.5 text-sm" />
            </div>
            <div className="flex items-center gap-1.5">
              {(["open", "closed", ""] as const).map(s => (
                <button key={s || "all"} onClick={() => setStatus(s)} className={`text-xs px-2.5 py-1 rounded-full border ${status === s ? "bg-gray-900 text-white border-gray-900" : "border-gray-200 text-gray-600"}`}>
                  {s === "" ? "All" : s === "open" ? "Open" : "Closed"}
                </button>
              ))}
              <button onClick={() => { void loadThreads(); void loadMailboxes(); }} aria-label="Refresh" className="ml-auto p-1.5 rounded-lg hover:bg-gray-100"><RefreshCw className="w-3.5 h-3.5 text-gray-500" /></button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {threads === null ? <div className="p-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
              : threads.length === 0 ? <div className="p-8 text-center text-sm text-gray-500"><Inbox className="w-8 h-8 mx-auto mb-2 text-gray-300" />No conversations here.</div>
                : threads.map(t => (
                  <button key={t.id} onClick={() => setOpenId(t.id)}
                    className={`w-full text-left px-3 py-2.5 border-b border-gray-50 ${openId === t.id ? "bg-emerald-50" : "hover:bg-gray-50"}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className={`text-sm truncate ${t.unread ? "font-bold text-gray-900" : "text-gray-700"}`}>{t.counterpartName || t.counterpartEmail}</span>
                      <span className="text-[11px] text-gray-500 shrink-0">{when(t.lastMessageAt)}</span>
                    </div>
                    <p className={`text-xs truncate ${t.unread ? "font-semibold text-gray-800" : "text-gray-600"}`}>{t.subject}</p>
                    <p className="text-[11px] text-gray-400 truncate">{t.ref} · {t.mailbox}{t.status === "closed" ? " · closed" : ""}</p>
                  </button>
                ))}
          </div>
        </section>

        {/* Conversation */}
        <section className={`min-w-0 flex flex-col ${openId ? "" : "hidden lg:flex"}`}>
          {!openId ? <div className="flex-1 flex items-center justify-center text-sm text-gray-400"><Mail className="w-5 h-5 mr-2" />Choose a conversation</div>
            : !thread ? <div className="flex-1 flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
              : (
                <>
                  <div className="p-4 border-b border-gray-100 flex items-start gap-3">
                    <button onClick={() => setOpenId(null)} className="lg:hidden p-1 -ml-1" aria-label="Back"><ArrowLeft className="w-4 h-4" /></button>
                    <div className="min-w-0 flex-1">
                      <p className="text-base font-bold text-gray-900 truncate">{thread.subject}</p>
                      <p className="text-xs text-gray-500">{thread.ref} · {thread.counterpartName ? `${thread.counterpartName} <${thread.counterpartEmail}>` : thread.counterpartEmail} · to {thread.mailbox} ({thread.mailboxLabel})</p>
                    </div>
                    <button onClick={toggleStatus} className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 shrink-0">
                      {thread.status === "open" ? "Mark closed" : "Reopen"}
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50">
                    {(thread.messages as R[]).map(m => (
                      <div key={m.id} className={`rounded-xl border ${m.direction === "out" ? "border-emerald-100 bg-emerald-50/50 ml-6" : "border-gray-200 bg-white mr-6"}`}>
                        <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between gap-2 text-xs">
                          <span className="text-gray-700 truncate">
                            <b>{m.direction === "out" ? (m.autoReply ? "Automatic reply" : "Ballylife") : (thread.counterpartName || m.from)}</b>
                            <span className="text-gray-500"> · {m.from}</span>
                            {m.direction === "in" && m.senderVerified === false && <span className="ml-2 text-amber-700">⚠ sender not verified — be careful with links</span>}
                          </span>
                          <span className="text-gray-500 shrink-0">{new Date(m.createdAt).toLocaleString("en-ZA", { dateStyle: "medium", timeStyle: "short" })}</span>
                        </div>
                        <div className="px-3 py-2">
                          {m.direction === "in" && m.html ? <EmailHtml html={m.html} /> : <p className="text-sm text-gray-800 whitespace-pre-wrap">{m.text}</p>}
                          {(m.attachments as R[]).length > 0 && (
                            <div className="flex flex-wrap gap-2 mt-2">
                              {(m.attachments as R[]).map(a => (
                                <button key={a.id} disabled={!a.available} onClick={() => void downloadAttachment(a.id, a.filename)}
                                  className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg border border-gray-200 bg-white disabled:opacity-50">
                                  <Paperclip className="w-3 h-3" />{a.filename} <span className="text-gray-400">({Math.max(1, Math.round(a.size / 1024))} KB)</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="p-3 border-t border-gray-100">
                    <textarea value={reply} onChange={e => setReply(e.target.value)} rows={4} placeholder={`Reply to ${thread.counterpartEmail} from ${thread.mailbox}…`}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#1E7B4D]" />
                    <div className="flex items-center justify-between mt-2">
                      <p className="text-[11px] text-gray-500">Sent from {thread.mailbox}, with the Ballylife signature, in the same email thread.</p>
                      <button onClick={sendReply} disabled={busy || !reply.trim()} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-40" style={{ background: "#1E7B4D" }}>
                        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Send reply
                      </button>
                    </div>
                  </div>
                </>
              )}
        </section>
      </div>

      {composing && <ComposeDialog mailboxes={mailboxes} defaultMailbox={mailbox || "info@ballylife.com"} onClose={() => setComposing(false)}
        onSent={t => { setComposing(false); setOpenId(t.id); setThread(t); void loadThreads(); }} />}
    </div>
  );
}

function ComposeDialog({ mailboxes, defaultMailbox, onClose, onSent }: { mailboxes: R[]; defaultMailbox: string; onClose: () => void; onSent: (t: R) => void }) {
  const [from, setFrom] = useState(defaultMailbox);
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      const r = await mktInbox.compose({ mailbox: from, to, subject, text });
      if (r.success) { toast.success(`Sent from ${from}`); onSent(r.data); } else toast.error(r.error ?? "The email wasn't sent.");
    } catch (err) { toast.error(errMessage(err, "The email wasn't sent.")); }
    finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-lg p-5 space-y-3" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between"><p className="text-base font-bold text-gray-900">New email</p><button onClick={onClose} aria-label="Close"><X className="w-5 h-5 text-gray-500" /></button></div>
        <label className="block text-xs text-gray-600">From
          <select value={from} onChange={e => setFrom(e.target.value)} className="block w-full border border-gray-200 rounded-lg px-2.5 py-2 text-sm mt-1 bg-white">
            {mailboxes.map(m => <option key={m.address} value={m.address}>{m.address} — {m.label}</option>)}
          </select>
        </label>
        <label className="block text-xs text-gray-600">To
          <input value={to} onChange={e => setTo(e.target.value)} placeholder="name@example.com" className="block w-full border border-gray-200 rounded-lg px-2.5 py-2 text-sm mt-1" />
        </label>
        <label className="block text-xs text-gray-600">Subject
          <input value={subject} onChange={e => setSubject(e.target.value)} className="block w-full border border-gray-200 rounded-lg px-2.5 py-2 text-sm mt-1" />
        </label>
        <textarea value={text} onChange={e => setText(e.target.value)} rows={7} placeholder="Write your message…" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm border border-gray-200">Cancel</button>
          <button onClick={send} disabled={busy || !to.trim() || !subject.trim() || !text.trim()} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-40" style={{ background: "#1E7B4D" }}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Send
          </button>
        </div>
      </div>
    </div>
  );
}
