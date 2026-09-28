/**
 * Admin: WhatsApp Inbox. Chats that were handed to a person come first
 * (with unread counts); staff read the whole conversation (customer, bot,
 * AI assistant and staff messages), reply, take a chat over, or hand it
 * back to the bot with "Resolve". Also shows today's AI assistant usage
 * and estimated cost. Refreshes every 15 seconds.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Bot, CheckCircle, Loader2, MessageCircle, RefreshCw, Send, UserRound } from "lucide-react";
import { mktWhatsApp, fetchWhatsAppMedia, ApiConnectionError } from "../services/marketplaceApi";
import { WhatsAppSetupPanel } from "./WhatsAppSetup";

type R = Record<string, any>;
const errMessage = (err: unknown, fallback: string) => (err instanceof ApiConnectionError ? err.message : fallback);
const time = (d: string) => new Date(d).toLocaleString("en-ZA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const who = (m: R) => (m.direction === "in" ? "Customer" : m.sentBy === "ai" ? "AI assistant" : !m.sentBy || m.sentBy === "bot" ? "Bot" : m.sentBy);

export function WhatsAppInboxPanel() {
  const [inbox, setInbox] = useState<{ conversations: R[]; ai: R } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [thread, setThread] = useState<R | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const loadInbox = useCallback(async () => {
    try { const r = await mktWhatsApp.inbox(); if (r.success) setInbox(r.data); }
    catch (err) { toast.error(errMessage(err, "Couldn't load the inbox.")); }
  }, []);
  const loadThread = useCallback(async (phone: string) => {
    try { const r = await mktWhatsApp.thread(phone); if (r.success) setThread(r.data); }
    catch (err) { toast.error(errMessage(err, "Couldn't load the conversation.")); }
  }, []);

  useEffect(() => { void loadInbox(); }, [loadInbox]);
  useEffect(() => { if (selected) void loadThread(selected); else setThread(null); }, [selected, loadThread]);
  useEffect(() => {
    const t = setInterval(() => { void loadInbox(); if (selected) void loadThread(selected); }, 15_000);
    return () => clearInterval(t);
  }, [selected, loadInbox, loadThread]);
  useEffect(() => { bottom.current?.scrollIntoView({ block: "end" }); }, [thread?.messages?.length]);

  const act = async (key: string, fn: () => Promise<{ success: boolean; error?: string }>, ok: string) => {
    setBusy(key);
    try {
      const r = await fn();
      if (r.success) { toast.success(ok); if (key === "reply") setDraft(""); await Promise.all([loadInbox(), selected ? loadThread(selected) : null]); }
      else toast.error(r.error ?? "That didn't work.");
    } catch (err) { toast.error(errMessage(err, "That didn't work.")); }
    finally { setBusy(null); }
  };

  const openMedia = async (messageId: string) => {
    const tab = window.open("", "_blank"); // open first: pop-up blockers stop tabs opened after an await
    try {
      const url = URL.createObjectURL(await fetchWhatsAppMedia(messageId));
      if (tab) tab.location.href = url; else window.location.href = url;
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) { tab?.close(); toast.error(errMessage(err, "Couldn't open that file.")); }
  };

  if (!inbox) return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>;
  const waiting = inbox.conversations.filter(c => c.handoff).length;

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-gray-100 px-5 py-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <span className="font-bold text-gray-900 flex items-center gap-1.5"><MessageCircle className="w-4 h-4 text-[#1E7B4D]" /> WhatsApp Inbox</span>
        <span className="text-gray-600"><b className={waiting ? "text-amber-600" : "text-gray-900"}>{waiting}</b> waiting for a person</span>
        <span className="text-gray-600 flex items-center gap-1"><Bot className="w-4 h-4" />
          {inbox.ai.enabled
            ? <>AI assistant on · today {inbox.ai.today.answers} answers (≈ ${inbox.ai.today.usd.toFixed(2)}) · 30 days {inbox.ai.last30Days.answers} (≈ ${inbox.ai.last30Days.usd.toFixed(2)})</>
            : <>AI assistant off — add ANTHROPIC_API_KEY on Railway to turn it on</>}
        </span>
        <button onClick={() => void loadInbox()} className="ml-auto text-xs text-gray-500 hover:text-gray-800 flex items-center gap-1"><RefreshCw className="w-3.5 h-3.5" /> Refresh</button>
      </div>

      <div className="grid md:grid-cols-[320px_1fr] gap-4">
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden max-h-[70vh] overflow-y-auto">
          {inbox.conversations.length === 0 && <p className="text-sm text-gray-500 p-6 text-center">No WhatsApp conversations yet.</p>}
          {inbox.conversations.map(c => (
            <button key={c.phone} onClick={() => setSelected(c.phone)}
              className={`w-full text-left px-4 py-3 border-b border-gray-50 hover:bg-gray-50 ${selected === c.phone ? "bg-emerald-50/60" : ""}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-gray-900 truncate">{c.name ?? `+${c.phone}`}</span>
                {c.unread > 0 && <span className="text-[10px] font-bold bg-[#1E7B4D] text-white rounded-full px-1.5 py-0.5">{c.unread}</span>}
              </div>
              <div className="text-[11px] text-gray-500">+{c.phone}{c.lastInboundAt ? ` · ${time(c.lastInboundAt)}` : ""}</div>
              {c.handoff && <div className="mt-1 text-[11px] font-medium text-amber-700 flex items-center gap-1"><UserRound className="w-3 h-3" /> Waiting for a person{c.handoffReason ? `: ${c.handoffReason}` : ""}</div>}
              {!c.handoff && c.lastMessage && <div className="mt-1 text-[11px] text-gray-500 truncate">{c.lastMessage.direction === "in" ? "" : "↪ "}{c.lastMessage.text}</div>}
            </button>
          ))}
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 flex flex-col min-h-[420px] max-h-[70vh]">
          {!thread ? <p className="text-sm text-gray-500 m-auto">Choose a conversation.</p> : (
            <>
              <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-bold text-gray-900">{thread.name ?? `+${thread.phone}`}</div>
                  <div className="text-[11px] text-gray-500">+{thread.phone}{thread.email ? ` · ${thread.email}` : ""}{thread.linked ? " · has an account" : " · no account"}{thread.optedOut ? " · opted out (STOP)" : ""}</div>
                </div>
                <div className="ml-auto flex gap-2">
                  {thread.handoff
                    ? <button onClick={() => void act("resolve", () => mktWhatsApp.resolve(thread.phone), "Handed back to the bot.")} disabled={busy !== null}
                        className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-[#1E7B4D] hover:bg-[#17633D] text-white flex items-center gap-1 disabled:opacity-50"><CheckCircle className="w-3.5 h-3.5" /> Resolve</button>
                    : <button onClick={() => void act("take", () => mktWhatsApp.take(thread.phone), "You've taken over — the bot is paused for this chat.")} disabled={busy !== null}
                        className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50">Take over</button>}
                </div>
              </div>
              <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 bg-[#F5F6F8]">
                {(thread.messages as R[]).map(m => (
                  <div key={m.id} className={`flex ${m.direction === "in" ? "justify-start" : "justify-end"}`}>
                    <div className={`max-w-[80%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap break-words ${m.direction === "in" ? "bg-white border border-gray-100 text-gray-900" : m.sentBy && !["bot", "ai"].includes(m.sentBy) ? "bg-[#1E7B4D] text-white" : "bg-emerald-50 text-gray-900"}`}>
                      <div className={`text-[10px] mb-0.5 ${m.direction !== "in" && m.sentBy && !["bot", "ai"].includes(m.sentBy) ? "text-emerald-100" : "text-gray-400"}`}>{who(m)} · {time(m.at)}{m.status === "failed" ? " · ⚠️ not delivered" : ""}</div>
                      {m.text}
                      {m.media && <button onClick={() => void openMedia(String(m.id))} className="mt-1 block text-xs font-semibold underline">{String(m.media.mimeType ?? "").startsWith("image/") ? "📷 View photo" : "📎 Open file"}</button>}
                    </div>
                  </div>
                ))}
                <div ref={bottom} />
              </div>
              <div className="border-t border-gray-100 p-3">
                {!thread.windowOpen && <p className="text-[11px] text-amber-700 mb-2">More than 24 hours since the customer's last message — WhatsApp won't deliver a normal reply until they message again.</p>}
                <form onSubmit={e => { e.preventDefault(); if (draft.trim()) void act("reply", () => mktWhatsApp.reply(thread.phone, draft.trim()), "Sent."); }} className="flex gap-2">
                  <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={2} placeholder={thread.handoff ? "Reply to the customer…" : "Replying takes the chat over from the bot…"}
                    onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); (e.currentTarget.form as HTMLFormElement).requestSubmit(); } }}
                    className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#1E7B4D] resize-none" disabled={!thread.windowOpen || thread.optedOut} />
                  <button type="submit" disabled={!draft.trim() || busy !== null || !thread.windowOpen || thread.optedOut}
                    className="px-4 rounded-lg bg-[#1E7B4D] hover:bg-[#17633D] text-white text-sm font-semibold flex items-center gap-1.5 disabled:opacity-40">
                    {busy === "reply" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Send
                  </button>
                </form>
              </div>
            </>
          )}
        </div>
      </div>

      <WhatsAppSetupPanel />
    </div>
  );
}
