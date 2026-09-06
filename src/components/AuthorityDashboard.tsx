import { useState, useEffect } from "react";
import { BarChart3, Percent, Globe2, CheckCircle, Clock, Loader2 } from "lucide-react";
import { mktAuthoritySelf, type MktAuthUser } from "../services/marketplaceApi";

type R = Record<string, unknown>;

function StatCard({ label, value, icon, accent }: { label: string; value: string; icon: React.ReactNode; accent: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: `${accent}15`, color: accent }}>{icon}</span>
      </div>
      <p className="text-xl font-black text-gray-900">{value}</p>
      <p className="text-[11px] text-gray-500 mt-0.5">{label}</p>
    </div>
  );
}

const fmtZAR = (n: number) => `R${Number(n ?? 0).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface Props {
  user: MktAuthUser;
  authority: R;
  onSignOut: () => void;
}

// Read-only, country-scoped view of what Ballylife has calculated and
// collected on behalf of this authority's country — never another
// country's figures, never anything editable. Being able to sign in here
// does not by itself constitute a reporting agreement between Ballylife
// and the authority; that's a separate, real institutional relationship.
export function AuthorityDashboard({ user, authority, onSignOut }: Props) {
  const [data, setData] = useState<R | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    mktAuthoritySelf.taxSummary(String(authority.id)).then(res => {
      if (res.success) setData(res.data as R);
      setLoading(false);
    });
  }, [authority.id]);

  const totals = (data?.totals as R) ?? {};
  const byPeriod = (data?.byPeriod as R[]) ?? [];
  const customsByStatus = (data?.customsByStatus as R[]) ?? [];

  return (
    <div className="flex-1 flex min-h-0 overflow-hidden bg-[#EAEDED]">
      <aside className="w-56 shrink-0 bg-white border-r border-gray-100 p-3 overflow-y-auto flex flex-col">
        <div className="px-1 pb-3 mb-2 border-b border-gray-100">
          <p className="font-serif text-base text-gray-900 leading-tight" style={{ fontWeight: 600 }}>{String(authority.name)}</p>
          <p className="text-[11px] mt-1 text-gray-400">{String(authority.country)} · read-only view</p>
        </div>
        <div className="space-y-0.5 flex-1">
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-left text-sm font-medium" style={{ background: "#EAF7EE", color: "#0B5C2E" }}>
            <BarChart3 className="w-4 h-4" /><span>Tax Summary</span>
          </div>
        </div>
        <button onClick={onSignOut} className="text-xs text-gray-400 hover:text-gray-700 px-3 py-2 text-left">Sign out</button>
      </aside>

      <div className="flex-1 overflow-y-auto p-5">
        {loading ? (
          <div className="flex items-center justify-center h-40"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
        ) : (
          <div>
            <p className="text-lg font-bold text-gray-900 mb-1">Welcome, {user.name}</p>
            <p className="text-sm text-gray-500 mb-5">VAT collected and import duty liability for orders delivered to {String(authority.country)}, calculated at the point of sale based on the buyer's delivery address.</p>

            <div className="grid sm:grid-cols-4 gap-3 mb-6">
              <StatCard label="VAT collected (all-time)" value={fmtZAR(Number(totals.totalVatCollected ?? 0))} icon={<Percent className="w-4 h-4" />} accent="#059669" />
              <StatCard label="Import duty estimated" value={fmtZAR(Number(totals.totalDutyEstimated ?? 0))} icon={<Globe2 className="w-4 h-4" />} accent="#B8862E" />
              <StatCard label="Duty cleared at customs" value={fmtZAR(Number(totals.totalDutyCleared ?? 0))} icon={<CheckCircle className="w-4 h-4" />} accent="#10B981" />
              <StatCard label="Duty outstanding" value={fmtZAR(Number(totals.totalDutyOutstanding ?? 0))} icon={<Clock className="w-4 h-4" />} accent="#DC2626" />
            </div>

            <div className="bg-white rounded-xl border border-gray-100 overflow-hidden mb-5">
              <div className="px-4 py-3 border-b border-gray-100"><span className="text-sm font-bold text-gray-900">VAT & duty by month</span></div>
              <table className="w-full text-sm">
                <thead><tr className="text-left text-[11px] text-gray-400 border-b border-gray-100">
                  <th className="px-4 py-2 font-medium">Period</th><th className="px-4 py-2 font-medium">Orders</th>
                  <th className="px-4 py-2 font-medium">Subtotal</th><th className="px-4 py-2 font-medium">VAT collected</th><th className="px-4 py-2 font-medium">Duty liability</th>
                </tr></thead>
                <tbody>
                  {byPeriod.map((r, i) => (
                    <tr key={i} className="border-b border-gray-50 last:border-0">
                      <td className="px-4 py-2.5 font-semibold text-gray-900">{String(r.period)}</td>
                      <td className="px-4 py-2.5 text-gray-500">{String(r.orderCount)}</td>
                      <td className="px-4 py-2.5 text-gray-600">{fmtZAR(Number(r.subtotal))}</td>
                      <td className="px-4 py-2.5 font-medium text-green-700">{fmtZAR(Number(r.vatCollected))}</td>
                      <td className="px-4 py-2.5 font-medium text-amber-700">{fmtZAR(Number(r.dutyLiability))}</td>
                    </tr>
                  ))}
                  {!byPeriod.length && <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-gray-400">No orders delivered to {String(authority.country)} yet.</td></tr>}
                </tbody>
              </table>
            </div>

            {customsByStatus.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-100 overflow-hidden mb-5">
                <div className="px-4 py-3 border-b border-gray-100"><span className="text-sm font-bold text-gray-900">Customs records by status</span></div>
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-[11px] text-gray-400 border-b border-gray-100">
                    <th className="px-4 py-2 font-medium">Status</th><th className="px-4 py-2 font-medium">Shipments</th>
                    <th className="px-4 py-2 font-medium">Declared value</th><th className="px-4 py-2 font-medium">Duty</th>
                    <th className="px-4 py-2 font-medium">Import VAT</th><th className="px-4 py-2 font-medium">Total payable</th>
                  </tr></thead>
                  <tbody>
                    {customsByStatus.map((r, i) => (
                      <tr key={i} className="border-b border-gray-50 last:border-0">
                        <td className="px-4 py-2.5 font-semibold text-gray-900 capitalize">{String(r.status).replace(/_/g, " ")}</td>
                        <td className="px-4 py-2.5 text-gray-500">{String(r.recordCount)}</td>
                        <td className="px-4 py-2.5 text-gray-600">{fmtZAR(Number(r.declaredValue))}</td>
                        <td className="px-4 py-2.5 text-gray-600">{fmtZAR(Number(r.dutyAmount))}</td>
                        <td className="px-4 py-2.5 text-gray-600">{fmtZAR(Number(r.vatAmount))}</td>
                        <td className="px-4 py-2.5 font-medium text-gray-800">{fmtZAR(Number(r.totalPayable))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <p className="text-[11px] text-gray-400">
              These figures are calculated by Ballylife based on order data and shared with you for visibility — nothing here is a remittance,
              and no funds move through this system. Actual payment, if and when an agreement is in place, happens through the channel that agreement specifies.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
