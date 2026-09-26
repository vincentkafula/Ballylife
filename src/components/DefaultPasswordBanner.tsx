import { useState } from "react";
import { ShieldAlert } from "lucide-react";
import { mktAuth, type MktAuthUser } from "../services/marketplaceApi";

/**
 * Shown to anyone who signed in with the public demo password (the server
 * flags it as mustChangePassword). That password is published in the code
 * repository, so the account is effectively open to anyone until it's
 * changed -- the banner stays until it is.
 */
export function DefaultPasswordBanner({ user }: { user: MktAuthUser | null }) {
  const [done, setDone] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  if (!user?.mustChangePassword || done) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    const r = await mktAuth.changePassword(current, next).catch(() => ({ success: false, error: "Couldn't reach the server." }));
    setSaving(false);
    if (!r.success) { setError(r.error ?? "Could not change the password."); return; }
    try {
      const stored = JSON.parse(localStorage.getItem("mkt_user") ?? "null");
      if (stored) { delete stored.mustChangePassword; localStorage.setItem("mkt_user", JSON.stringify(stored)); }
    } catch { /* stored user unreadable -- the flag disappears at next login anyway */ }
    setDone(true);
  };

  return (
    <div role="alert" className="bg-red-700 text-white px-4 py-3">
      <form onSubmit={submit} className="max-w-5xl mx-auto flex flex-wrap items-center gap-2 text-sm">
        <ShieldAlert className="w-5 h-5 shrink-0" />
        <p className="font-semibold mr-2">This account uses the default password, which is public. Change it now.</p>
        <input type="password" autoComplete="current-password" placeholder="Current password" value={current} onChange={e => setCurrent(e.target.value)}
          className="px-2.5 py-1.5 rounded text-gray-900 text-sm w-40" required />
        <input type="password" autoComplete="new-password" placeholder="New password (8+ chars)" value={next} onChange={e => setNext(e.target.value)}
          className="px-2.5 py-1.5 rounded text-gray-900 text-sm w-48" minLength={8} required />
        <button type="submit" disabled={saving} className="px-3 py-1.5 rounded bg-white text-red-800 font-bold text-sm disabled:opacity-60">
          {saving ? "Saving…" : "Change password"}
        </button>
        {error && <p className="basis-full text-xs text-red-100">{error}</p>}
      </form>
    </div>
  );
}
