/**
 * Super admin only: add managers and see who they are. The super admin
 * account itself is set by SUPER_ADMIN_* variables in Railway.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, ShieldCheck, UserPlus } from "lucide-react";
import { mktSuperAdmin, ApiConnectionError } from "../services/marketplaceApi";

type R = Record<string, unknown>;

export function SuperAdminManagersCard({ onChanged }: { onChanged: () => void }) {
  const [managers, setManagers] = useState<R[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ username: "", name: "", email: "", password: "" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    mktSuperAdmin.managers().then(r => { if (r.success) setManagers(r.data as R[]); }).catch(() => undefined).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    setSaving(true);
    try {
      const res = await mktSuperAdmin.createManager(form);
      if (!res.success) { toast.error(res.error ?? "Couldn't create the manager."); return; }
      toast.success(`Manager ${form.username} created. Give them the temporary password and ask them to change it after signing in.`);
      setForm({ username: "", name: "", email: "", password: "" });
      load(); onChanged();
    } catch (err) {
      toast.error(err instanceof ApiConnectionError ? err.message : "Couldn't create the manager.");
    } finally { setSaving(false); }
  };

  const input = "border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs outline-none focus:border-[#B8862E] w-full";
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <ShieldCheck className="w-4 h-4 text-emerald-700" />
        <span className="text-sm font-bold text-gray-900">Managers</span>
        <span className="text-[11px] text-gray-500">Only you, the super admin, can add or remove managers and remove accounts.</span>
      </div>
      {loading ? <Loader2 className="w-4 h-4 animate-spin text-gray-300" /> : (
        <div className="flex flex-wrap gap-2">
          {managers.map(m => (
            <span key={String(m.id)} className={`text-xs px-2.5 py-1 rounded-full border ${m.accountStatus === "removed" ? "border-red-200 text-red-600 line-through" : "border-gray-200 text-gray-700"}`}>
              {String(m.name)} <span className="text-gray-400">@{String(m.username)}</span>{m.role === "super_admin" ? " · super admin" : ""}
            </span>
          ))}
        </div>
      )}
      <div className="grid sm:grid-cols-5 gap-2 items-end">
        <input className={input} placeholder="Username" value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} />
        <input className={input} placeholder="Full name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
        <input className={input} placeholder="Email" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
        <input className={input} placeholder="Temporary password" type="password" autoComplete="new-password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />
        <button onClick={create} disabled={saving || !form.username || !form.name || !form.email || !form.password}
          className="flex items-center justify-center gap-1.5 text-xs font-bold px-3 py-2 rounded-lg text-white disabled:opacity-50" style={{ background: "#14110D" }}>
          <UserPlus className="w-3.5 h-3.5" />{saving ? "Adding…" : "Add manager"}
        </button>
      </div>
      <p className="text-[11px] text-gray-500">To make an existing account a manager, or take manager rights away, change its role in the list below.</p>
    </div>
  );
}
