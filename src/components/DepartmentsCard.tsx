/**
 * Super admin: manager departments. Each department handles some
 * @ballylife.com addresses; its managers can only read, reply from and send
 * from those addresses in the Email Inbox. The super admin uses every address.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Building2, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { mktDepartments, mktInbox, mktSuperAdmin, ApiConnectionError } from "../services/marketplaceApi";

type R = Record<string, any>;
const errMessage = (err: unknown, fallback: string) => (err instanceof ApiConnectionError ? err.message : fallback);
const DOMAIN = "ballylife.com";

export function DepartmentsCard() {
  const [departments, setDepartments] = useState<R[] | null>(null);
  const [managers, setManagers] = useState<R[]>([]);
  const [knownMailboxes, setKnownMailboxes] = useState<R[]>([]);
  const [editing, setEditing] = useState<R | null>(null); // {} for a new department

  const load = useCallback(async () => {
    try {
      const [d, m, mb] = await Promise.all([mktDepartments.list(), mktSuperAdmin.managers(), mktInbox.mailboxes()]);
      if (d.success) setDepartments(d.data); else toast.error(d.error ?? "Couldn't load departments.");
      if (m.success) setManagers((m.data as R[]).filter(u => u.role === "marketplace_admin" && u.accountStatus !== "removed"));
      if (mb.success) setKnownMailboxes(mb.data.mailboxes);
    } catch (err) { toast.error(errMessage(err, "Couldn't load departments.")); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const remove = async (d: R) => {
    if (!confirm(`Delete the ${d.name} department? Its managers lose access to its email addresses (the emails themselves are kept).`)) return;
    try { const r = await mktDepartments.remove(d.id); if (r.success) { toast.success("Department deleted"); void load(); } else toast.error(r.error ?? "Couldn't delete it."); }
    catch (err) { toast.error(errMessage(err, "Couldn't delete it.")); }
  };

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Building2 className="w-4 h-4 text-emerald-700" />
        <span className="text-sm font-bold text-gray-900">Departments</span>
        <span className="text-[11px] text-gray-500 flex-1">Managers only see, reply from and send from their department's email addresses. You see them all.</span>
        <button onClick={() => setEditing({})} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-white" style={{ background: "#14110D" }}>
          <Plus className="w-3.5 h-3.5" /> New department
        </button>
      </div>
      {departments === null ? <Loader2 className="w-4 h-4 animate-spin text-gray-300" />
        : departments.length === 0
          ? <p className="text-xs text-gray-500">No departments yet. Until you create one, every manager can use every email address.</p>
          : (
            <div className="space-y-2">
              {departments.map(d => (
                <div key={d.id} className="border border-gray-100 rounded-lg p-3 flex items-start gap-3">
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <p className="text-sm font-semibold text-gray-900">{d.name}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {(d.mailboxes as string[]).length ? (d.mailboxes as string[]).map(a => <span key={a} className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800">{a}</span>)
                        : <span className="text-[11px] text-gray-400">No email addresses</span>}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {(d.members as R[]).length ? (d.members as R[]).map(m => <span key={m.id} className="text-[11px] px-2 py-0.5 rounded-full border border-gray-200 text-gray-700">{m.name} <span className="text-gray-400">@{m.username}</span></span>)
                        : <span className="text-[11px] text-gray-400">No managers yet</span>}
                    </div>
                  </div>
                  <button onClick={() => setEditing(d)} aria-label={`Edit ${d.name}`} className="p-1.5 rounded-lg hover:bg-gray-100"><Pencil className="w-3.5 h-3.5 text-gray-600" /></button>
                  <button onClick={() => void remove(d)} aria-label={`Delete ${d.name}`} className="p-1.5 rounded-lg hover:bg-red-50"><Trash2 className="w-3.5 h-3.5 text-red-600" /></button>
                </div>
              ))}
            </div>
          )}
      {editing && <DepartmentDialog department={editing} managers={managers} knownMailboxes={knownMailboxes}
        onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} />}
    </div>
  );
}

function DepartmentDialog({ department, managers, knownMailboxes, onClose, onSaved }: { department: R; managers: R[]; knownMailboxes: R[]; onClose: () => void; onSaved: () => void }) {
  const isNew = !department.id;
  const [name, setName] = useState<string>(department.name ?? "");
  const [mailboxes, setMailboxes] = useState<string[]>(department.mailboxes ?? []);
  const [memberIds, setMemberIds] = useState<string[]>((department.members ?? []).map((m: R) => String(m.id)));
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const options = [...new Set([...knownMailboxes.map(m => String(m.address)), ...mailboxes])];
  const labelOf = (a: string) => knownMailboxes.find(m => m.address === a)?.label;
  const toggle = (list: string[], set: (v: string[]) => void, value: string) => set(list.includes(value) ? list.filter(v => v !== value) : [...list, value]);

  const addCustom = () => {
    const local = custom.trim().toLowerCase().replace(new RegExp(`@${DOMAIN}$`), "");
    if (!/^[a-z0-9._+-]+$/.test(local)) { toast.error("Use letters, numbers, dots or dashes before @ballylife.com"); return; }
    const address = `${local}@${DOMAIN}`;
    if (!mailboxes.includes(address)) setMailboxes([...mailboxes, address]);
    setCustom("");
  };

  const save = async () => {
    setBusy(true);
    try {
      const body = { name, mailboxes, memberIds };
      const r = isNew ? await mktDepartments.create(body) : await mktDepartments.update(department.id, body);
      if (r.success) { toast.success(isNew ? "Department created" : "Department saved"); onSaved(); }
      else toast.error(r.error ?? "Couldn't save the department.");
    } catch (err) { toast.error(errMessage(err, "Couldn't save the department.")); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-lg p-5 space-y-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <p className="text-base font-bold text-gray-900">{isNew ? "New department" : `Edit ${department.name}`}</p>
          <button onClick={onClose} aria-label="Close"><X className="w-5 h-5 text-gray-500" /></button>
        </div>
        <label className="block text-xs text-gray-600">Name
          <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Customer Service" className="block w-full border border-gray-200 rounded-lg px-2.5 py-2 text-sm mt-1" />
        </label>
        <div>
          <p className="text-xs text-gray-600 mb-1.5">Email addresses this department handles</p>
          <div className="grid sm:grid-cols-2 gap-1.5">
            {options.map(a => (
              <label key={a} className="flex items-start gap-2 text-xs p-2 rounded-lg border border-gray-100 cursor-pointer hover:bg-gray-50">
                <input type="checkbox" checked={mailboxes.includes(a)} onChange={() => toggle(mailboxes, setMailboxes, a)} className="mt-0.5" />
                <span><span className="font-medium text-gray-900">{a}</span>{labelOf(a) ? <span className="block text-gray-500">{labelOf(a)}</span> : null}</span>
              </label>
            ))}
          </div>
          <div className="flex gap-2 mt-2">
            <div className="flex-1 flex items-center border border-gray-200 rounded-lg overflow-hidden">
              <input value={custom} onChange={e => setCustom(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addCustom(); } }} placeholder="another address, e.g. support" className="flex-1 px-2.5 py-1.5 text-xs outline-none" />
              <span className="text-xs text-gray-400 pr-2">@{DOMAIN}</span>
            </div>
            <button onClick={addCustom} className="px-3 py-1.5 rounded-lg text-xs border border-gray-200">Add</button>
          </div>
        </div>
        <div>
          <p className="text-xs text-gray-600 mb-1.5">Managers in this department</p>
          {managers.length === 0 ? <p className="text-xs text-gray-400">No managers yet. Add them in the Managers card first.</p> : (
            <div className="space-y-1">
              {managers.map(m => (
                <label key={String(m.id)} className="flex items-center gap-2 text-xs p-1.5 rounded-lg hover:bg-gray-50 cursor-pointer">
                  <input type="checkbox" checked={memberIds.includes(String(m.id))} onChange={() => toggle(memberIds, setMemberIds, String(m.id))} />
                  <span className="text-gray-900">{String(m.name)}</span><span className="text-gray-400">@{String(m.username)} · {String(m.email)}</span>
                </label>
              ))}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm border border-gray-200">Cancel</button>
          <button onClick={save} disabled={busy || name.trim().length < 2} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-40" style={{ background: "#1E7B4D" }}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}{isNew ? "Create department" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
