import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, Crown, Loader2, Building2, Wallet, BadgePercent } from "lucide-react";
import {
  mktProgrammes, submitToPayfast, type PlansInfo, type SubscriptionInfo, type MorePlanInfo,
} from "../services/marketplaceApi";
import { formatZAR, isShowingConvertedPrices } from "../services/currencyStore";

/**
 * BallylifeMORE, store credit and Ballylife for Business screens. Every
 * price and rule comes from GET /api/marketplace/plans (server/src/utils/plans.ts),
 * so what's shown is exactly what the server charges and applies.
 */

const rands = (n: number) => `R${Number(n).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—");

function usePlans() {
  const [plans, setPlans] = useState<PlansInfo | null>(null);
  useEffect(() => { mktProgrammes.plans().then(r => { if (r.success) setPlans(r.data); }).catch(() => undefined); }, []);
  return plans;
}

/** Price in the shopper's currency, with the rand amount actually billed when it differs. */
function Price({ zar, suffix = "" }: { zar: number; suffix?: string }) {
  return (
    <span>
      <span className="text-3xl font-black text-gray-900">{formatZAR(zar)}</span>
      <span className="text-sm text-gray-500">{suffix}</span>
      {isShowingConvertedPrices() && <span className="block text-[11px] text-gray-500">Billed as {rands(zar)}{suffix}</span>}
    </span>
  );
}

// ── Public plans page ──────────────────────────────────────────────────────

export function MorePlansPage({ loggedIn, onSignIn, onManage, onTerms }: {
  loggedIn: boolean; onSignIn: () => void; onManage: () => void; onTerms: () => void;
}) {
  const plans = usePlans();
  const [current, setCurrent] = useState<SubscriptionInfo | null>(null);
  const [trialAvailable, setTrialAvailable] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!loggedIn) return;
    mktProgrammes.subscription.me().then(r => { if (r.success) { setCurrent(r.data.subscription); setTrialAvailable(r.data.trialAvailable); } }).catch(() => undefined);
  }, [loggedIn]);

  const subscribe = async (plan: MorePlanInfo) => {
    if (!loggedIn) { onSignIn(); return; }
    setBusy(plan.id);
    try {
      const r = await mktProgrammes.subscription.start(plan.id);
      if (!r.success) { toast.error(r.error ?? "Couldn't start your subscription."); return; }
      submitToPayfast(r.data.redirect.url, r.data.redirect.fields); // card authorisation on PayFast
    } catch { toast.error("Couldn't reach the server — please try again."); }
    finally { setBusy(null); }
  };

  if (!plans) return <div className="flex-1 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>;
  const { trialDays } = plans.more;

  return (
    <div className="flex-1 overflow-y-auto" style={{ background: "#FAF6EC" }}>
      <div className="max-w-4xl mx-auto px-4 py-10">
        <div className="text-center mb-8">
          <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-emerald-800 bg-emerald-50 px-3 py-1 rounded-full">
            <Crown className="w-3.5 h-3.5" /> BallylifeMORE
          </span>
          <h1 className="font-serif text-3xl sm:text-4xl text-gray-900 mt-3" style={{ fontWeight: 600 }}>Save on every order</h1>
          <p className="text-gray-600 mt-2">
            {trialAvailable ? `Try it free for ${trialDays} days. ` : ""}Cancel anytime — you keep your benefits until the end of what you've paid for.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          {plans.more.plans.map(plan => {
            const isCurrent = current?.plan === plan.id && current.benefitsActive;
            const featured = plan.id === "premium";
            return (
              <div key={plan.id} className={`bg-white rounded-2xl p-6 flex flex-col border-2 ${featured ? "border-[#8A6420] shadow-lg" : "border-gray-200"}`}>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-xl font-bold text-gray-900">{plan.name}</h2>
                  {featured && <span className="text-[10px] font-bold uppercase tracking-wider text-white bg-[#8A6420] px-2 py-0.5 rounded-full">Best value</span>}
                </div>
                <Price zar={plan.monthlyPriceZar} suffix="/month" />
                {trialAvailable && <p className="text-xs text-emerald-700 font-semibold mt-1">First {trialDays} days free</p>}
                <ul className="mt-5 space-y-2 flex-1">
                  {plan.benefits.map(b => (
                    <li key={b} className="flex items-start gap-2 text-sm text-gray-700"><Check className="w-4 h-4 text-emerald-700 mt-0.5 shrink-0" />{b}</li>
                  ))}
                </ul>
                {isCurrent ? (
                  <button onClick={onManage} className="mt-6 w-full py-3 rounded-xl text-sm font-bold border-2 border-gray-300 text-gray-800">Your plan · Manage</button>
                ) : current?.benefitsActive ? (
                  <button onClick={onManage} className="mt-6 w-full py-3 rounded-xl text-sm font-bold text-white bg-emerald-700 hover:bg-emerald-800">Switch to {plan.name}</button>
                ) : (
                  <button onClick={() => subscribe(plan)} disabled={busy !== null}
                    className={`mt-6 w-full py-3 rounded-xl text-sm font-bold text-white disabled:opacity-60 ${featured ? "bg-[#8A6420] hover:bg-[#735218]" : "bg-emerald-700 hover:bg-emerald-800"}`}>
                    {busy === plan.id ? "Opening secure checkout…" : trialAvailable ? `Start free ${trialDays}-day trial` : `Join ${plan.name}`}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <p className="text-xs text-gray-600 text-center mt-6 leading-relaxed">
          {trialAvailable
            ? `Your card is verified today but not charged until your trial ends; then ${rands(plans.more.plans[0].monthlyPriceZar)} or ${rands(plans.more.plans[1].monthlyPriceZar)} a month, billed in South African rand.`
            : "Billed monthly in South African rand, in advance."}{" "}
          Cancel within {plans.more.coolingOffDays} days without using a benefit for a full refund.{" "}
          <button onClick={onTerms} className="underline">BallylifeMORE terms</button>
        </p>
      </div>
    </div>
  );
}

// ── Customer dashboard: membership ────────────────────────────────────────

const STATUS_LABEL: Record<string, { label: string; tone: string }> = {
  trialing: { label: "Free trial", tone: "bg-emerald-50 text-emerald-800" },
  active: { label: "Active", tone: "bg-emerald-50 text-emerald-800" },
  past_due: { label: "Payment overdue — benefits paused", tone: "bg-red-50 text-red-700" },
  cancelled: { label: "Cancelled", tone: "bg-gray-100 text-gray-700" },
  expired: { label: "Ended", tone: "bg-gray-100 text-gray-700" },
};

export function MembershipTab({ onBrowsePlans }: { onBrowsePlans: () => void }) {
  const plans = usePlans();
  const [data, setData] = useState<Awaited<ReturnType<typeof mktProgrammes.subscription.me>>["data"] | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { mktProgrammes.subscription.me().then(r => { if (r.success) setData(r.data); }).catch(() => undefined); }, []);
  useEffect(load, [load]);

  if (!data || !plans) return <div className="flex items-center justify-center h-32"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>;
  const s = data.subscription;
  if (!s) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6 max-w-xl">
        <p className="text-base font-bold text-gray-900 mb-1">You're not a BallylifeMORE member yet</p>
        <p className="text-sm text-gray-600 mb-4">Save {plans.more.plans[0].orderDiscountPct}–{plans.more.plans[1].orderDiscountPct}% on every order{data.trialAvailable ? `, free for your first ${plans.more.trialDays} days` : ""}.</p>
        <button onClick={onBrowsePlans} className="px-5 py-2.5 rounded-lg text-sm font-bold text-white bg-emerald-700 hover:bg-emerald-800">See plans</button>
      </div>
    );
  }

  const other = plans.more.plans.find(p => p.id !== s.plan)!;
  const st = STATUS_LABEL[s.status] ?? { label: s.status, tone: "bg-gray-100 text-gray-700" };
  const change = async (plan: string) => {
    setBusy(true);
    const r = await mktProgrammes.subscription.change(plan).catch(() => ({ success: false, error: "Couldn't reach the server." } as { success: false; error: string }));
    setBusy(false);
    if (!r.success) { toast.error(r.error ?? "Couldn't change your plan."); return; }
    toast.success(r.data.effective === "now" ? `You're now on ${r.data.subscription.planName}.` : `You'll move to ${other.name} on ${fmtDate(r.data.effective)}.`);
    load();
  };
  const cancel = async () => {
    if (!confirm("Cancel your BallylifeMORE membership?")) return;
    setBusy(true);
    const r = await mktProgrammes.subscription.cancel().catch(() => ({ success: false, error: "Couldn't reach the server." } as { success: false; error: string }));
    setBusy(false);
    if (!r.success) { toast.error(r.error ?? "Couldn't cancel."); return; }
    toast.success(r.data.refund ? "Cancelled — you'll receive a full refund." : `Cancelled. Your benefits continue until ${fmtDate(r.data.endsAt)}.`);
    load();
  };

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider">BallylifeMORE</p>
            <p className="text-xl font-bold text-gray-900">{s.planName} · {rands(s.monthlyPriceZar)}/month</p>
          </div>
          <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${st.tone}`}>{st.label}</span>
        </div>
        <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-2 mt-4 text-sm">
          {s.status === "trialing" && <div><dt className="text-gray-600">Trial ends</dt><dd className="font-semibold text-gray-900">{fmtDate(s.trialEndsAt)}</dd></div>}
          {s.cancelAt
            ? <div><dt className="text-gray-600">Benefits end</dt><dd className="font-semibold text-gray-900">{fmtDate(s.cancelAt)}</dd></div>
            : <div><dt className="text-gray-600">Next payment</dt><dd className="font-semibold text-gray-900">{fmtDate(s.nextBillingDate)} · {rands(plans.more.plans.find(p => p.id === (s.pendingPlan ?? s.plan))!.monthlyPriceZar)}</dd></div>}
          {s.pendingPlan && <div><dt className="text-gray-600">Plan change</dt><dd className="font-semibold text-gray-900">Moves to {plans.more.plans.find(p => p.id === s.pendingPlan)?.name} on {fmtDate(s.currentPeriodEnd)}</dd></div>}
        </dl>
        {s.status === "past_due" && <p className="mt-3 text-sm text-red-700">Your last payment didn't go through. Update your card in your PayFast account; benefits resume as soon as payment is received.</p>}
        {s.benefitsActive && !s.cancelAt && (
          <div className="flex flex-wrap gap-2 mt-5">
            {s.pendingPlan
              ? <button onClick={() => change(s.plan)} disabled={busy} className="px-4 py-2 rounded-lg text-sm font-semibold border border-gray-300 disabled:opacity-50">Keep {s.planName}</button>
              : <button onClick={() => change(other.id)} disabled={busy} className="px-4 py-2 rounded-lg text-sm font-bold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50">
                  {other.monthlyPriceZar > s.monthlyPriceZar ? `Upgrade to ${other.name}` : `Switch to ${other.name}`}
                </button>}
            <button onClick={cancel} disabled={busy} className="px-4 py-2 rounded-lg text-sm font-semibold text-red-700 border border-red-200 hover:bg-red-50 disabled:opacity-50">Cancel membership</button>
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <p className="px-5 py-3 text-sm font-bold text-gray-900 border-b border-gray-100">Payment history</p>
        {data.payments.length === 0
          ? <p className="px-5 py-4 text-sm text-gray-600">No payments yet{s.status === "trialing" ? " — you're on your free trial." : "."}</p>
          : <table className="w-full text-sm"><tbody>
              {data.payments.map((p, i) => (
                <tr key={i} className="border-b border-gray-50 last:border-0">
                  <td className="px-5 py-2.5 text-gray-700">{fmtDate(p.paidAt)}</td>
                  <td className="px-5 py-2.5 text-gray-700 capitalize">{p.plan}</td>
                  <td className="px-5 py-2.5 text-gray-600">{fmtDate(p.periodStart)} – {fmtDate(p.periodEnd)}</td>
                  <td className="px-5 py-2.5 font-semibold text-gray-900">{rands(p.amount)}{p.status !== "paid" ? ` · ${p.status.replace("_", " ")}` : ""}</td>
                </tr>
              ))}
            </tbody></table>}
      </div>
    </div>
  );
}

// ── Customer dashboard: store credit ──────────────────────────────────────

const SOURCE_LABEL: Record<string, string> = {
  business_rebate: "Business rebate", credit_reward: "Ballylife.credit reward", order_redemption: "Used at checkout", order_reversal: "Returned (order cancelled)",
};

export function StoreCreditTab() {
  const [data, setData] = useState<{ balance: number; entries: { amount: number; source: string; description: string | null; availableAt: string; expiresAt: string | null; createdAt: string }[] } | null>(null);
  useEffect(() => { mktProgrammes.storeCredit().then(r => { if (r.success) setData(r.data); }).catch(() => undefined); }, []);
  if (!data) return <div className="flex items-center justify-center h-32"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>;
  const pending = data.entries.filter(e => e.amount > 0 && new Date(e.availableAt) > new Date());
  return (
    <div className="space-y-4 max-w-2xl">
      <div className="bg-white rounded-xl border border-gray-200 p-5 flex items-center gap-4">
        <span className="w-11 h-11 rounded-full bg-emerald-50 text-emerald-800 flex items-center justify-center"><Wallet className="w-5 h-5" /></span>
        <div>
          <p className="text-sm text-gray-600">Store credit you can spend</p>
          <p className="text-2xl font-black text-gray-900">{formatZAR(data.balance)}</p>
          {pending.length > 0 && <p className="text-xs text-gray-600">+ {formatZAR(pending.reduce((n, e) => n + e.amount, 0))} releasing {fmtDate(pending[pending.length - 1].availableAt)}</p>}
        </div>
      </div>
      <p className="text-xs text-gray-600">Use it at checkout. Earned from Ballylife for Business rebates and Ballylife.credit rewards; it expires 3 years after it's earned.</p>
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {data.entries.length === 0 ? <p className="px-5 py-4 text-sm text-gray-600">No store credit activity yet.</p> : (
          <table className="w-full text-sm"><tbody>
            {data.entries.map((e, i) => (
              <tr key={i} className="border-b border-gray-50 last:border-0">
                <td className="px-5 py-2.5 text-gray-700">{fmtDate(e.createdAt)}</td>
                <td className="px-5 py-2.5 text-gray-800">{e.description ?? SOURCE_LABEL[e.source] ?? e.source}</td>
                <td className={`px-5 py-2.5 font-semibold text-right ${e.amount < 0 ? "text-gray-700" : "text-emerald-800"}`}>{e.amount < 0 ? "−" : "+"}{rands(Math.abs(e.amount))}</td>
              </tr>
            ))}
          </tbody></table>
        )}
      </div>
    </div>
  );
}

// ── Customer dashboard: Ballylife for Business ────────────────────────────

export function BusinessTab() {
  const plans = usePlans();
  const [data, setData] = useState<Awaited<ReturnType<typeof mktProgrammes.business.me>>["data"] | null>(null);
  const [form, setForm] = useState({ companyName: "", registrationNumber: "", vatNumber: "" });
  const [saving, setSaving] = useState(false);
  const load = useCallback(() => { mktProgrammes.business.me().then(r => { if (r.success) setData(r.data); }).catch(() => undefined); }, []);
  useEffect(load, [load]);

  if (!data || !plans) return <div className="flex items-center justify-center h-32"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>;
  const a = data.account as Record<string, any> | null;

  const apply = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const r = await mktProgrammes.business.apply({ companyName: form.companyName, registrationNumber: form.registrationNumber || undefined, vatNumber: form.vatNumber || undefined })
      .catch(() => ({ success: false, error: "Couldn't reach the server." } as { success: false; error: string }));
    setSaving(false);
    if (!r.success) { toast.error(r.error ?? "Couldn't submit your application."); return; }
    toast.success("Application submitted — we'll review it shortly.");
    load();
  };

  const tiersTable = (
    <table className="w-full text-sm mt-3">
      <thead><tr className="text-left text-xs text-gray-600"><th className="py-1.5">Monthly spend (excl. VAT)</th><th className="py-1.5">Rebate</th></tr></thead>
      <tbody>{plans.business.tiers.map(t => (
        <tr key={t.minMonthlySpendZar} className={`border-t border-gray-100 ${data.thisMonth?.rebatePct === t.rebatePct ? "font-bold text-emerald-800" : "text-gray-700"}`}>
          <td className="py-1.5">{rands(t.minMonthlySpendZar)}+</td><td className="py-1.5">{t.rebatePct}%</td>
        </tr>
      ))}</tbody>
    </table>
  );

  if (!a || ["rejected", "left"].includes(a.status)) {
    return (
      <div className="grid md:grid-cols-2 gap-4 max-w-4xl">
        <form onSubmit={apply} className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
          <p className="text-base font-bold text-gray-900 flex items-center gap-2"><Building2 className="w-5 h-5 text-emerald-800" /> Ballylife for Business</p>
          <p className="text-sm text-gray-600">Buying for a company? Earn a rebate on every month's spend, paid as store credit.</p>
          {a?.status === "rejected" && <p className="text-sm text-red-700">Your last application wasn't approved{a.decisionNote ? `: ${a.decisionNote}` : "."} You can apply again.</p>}
          <label className="block text-xs font-semibold text-gray-700">Registered company name
            <input required value={form.companyName} onChange={e => setForm({ ...form, companyName: e.target.value })} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" /></label>
          <label className="block text-xs font-semibold text-gray-700">Company registration number
            <input placeholder="2019/123456/07" value={form.registrationNumber} onChange={e => setForm({ ...form, registrationNumber: e.target.value })} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" /></label>
          <label className="block text-xs font-semibold text-gray-700">or VAT number
            <input placeholder="4123456789" value={form.vatNumber} onChange={e => setForm({ ...form, vatNumber: e.target.value })} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" /></label>
          <button disabled={saving} className="w-full py-2.5 rounded-lg text-sm font-bold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60">{saving ? "Submitting…" : "Apply"}</button>
        </form>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-sm font-bold text-gray-900 flex items-center gap-2"><BadgePercent className="w-4 h-4 text-emerald-800" /> Rebate tiers</p>
          {tiersTable}
        </div>
      </div>
    );
  }

  if (a.status === "pending") {
    return <div className="bg-white rounded-xl border border-gray-200 p-5 max-w-xl"><p className="font-bold text-gray-900">{a.companyName}</p><p className="text-sm text-gray-600 mt-1">Your application is being reviewed. We'll let you know once it's approved.</p></div>;
  }

  const m = data.thisMonth!;
  return (
    <div className="grid md:grid-cols-2 gap-4 max-w-4xl">
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Ballylife for Business</p>
        <p className="text-lg font-bold text-gray-900">{a.companyName}</p>
        <div className="mt-4 text-sm space-y-1">
          <p className="text-gray-700">This month's qualifying spend: <b className="text-gray-900">{rands(m.netSpendZar)}</b></p>
          <p className="text-gray-700">Current rebate: <b className="text-gray-900">{m.rebatePct}%</b> {m.rebatePct > 0 && <>≈ <b>{rands(m.estimatedRebateZar)}</b> in store credit next month</>}</p>
          {m.nextTier && <p className="text-emerald-800">Spend {rands(m.nextTier.minMonthlySpendZar - m.netSpendZar)} more this month to reach {m.nextTier.rebatePct}%.</p>}
        </div>
        {data.rebates.length > 0 && (
          <div className="mt-4 border-t border-gray-100 pt-3">
            <p className="text-xs font-semibold text-gray-600 mb-1">Rebates received</p>
            {data.rebates.map((r, i) => <p key={i} className="text-sm text-gray-700 flex justify-between"><span>{r.description}</span><b>{rands(r.amount)}</b></p>)}
          </div>
        )}
      </div>
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <p className="text-sm font-bold text-gray-900">Rebate tiers</p>
        {tiersTable}
      </div>
    </div>
  );
}

// ── Admin ─────────────────────────────────────────────────────────────────

export function ProgrammesAdminPanel() {
  const [subs, setSubs] = useState<{ rows: Record<string, any>[]; meta: Record<string, any> } | null>(null);
  const [apps, setApps] = useState<Record<string, any>[]>([]);
  const load = useCallback(async () => {
    const [s, a] = await Promise.all([mktProgrammes.admin.subscriptions(), mktProgrammes.admin.businessAccounts()]).catch(() => [null, null] as const);
    if (s?.success) setSubs({ rows: s.data, meta: s.meta ?? {} });
    if (a?.success) setApps(a.data);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const decide = async (id: string, decision: "approve" | "reject") => {
    const note = decision === "reject" ? prompt("Reason (shown to the applicant):") ?? undefined : undefined;
    const r = await mktProgrammes.admin.decideBusiness(id, decision, note).catch(() => null);
    if (!r?.success) { toast.error(r?.error ?? "Couldn't save the decision."); return; }
    toast.success(decision === "approve" ? "Approved." : "Rejected.");
    void load();
  };

  const counts = (subs?.meta.counts ?? {}) as Record<string, number>;
  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-4 gap-3">
        {[
          ["Monthly recurring revenue", rands(Number(subs?.meta.monthlyRecurringRevenueZar ?? 0))],
          ["Paying members", String(counts.active ?? 0)],
          ["On free trial", String(counts.trialing ?? 0)],
          ["Payment overdue", String(counts.past_due ?? 0)],
        ].map(([label, value]) => (
          <div key={label} className="bg-white rounded-xl border border-gray-100 p-4"><p className="text-xs text-gray-600">{label}</p><p className="text-xl font-bold text-gray-900">{value}</p></div>
        ))}
      </div>
      {Number(subs?.meta.refundsDue ?? 0) > 0 && (
        <p className="text-sm px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-900">
          {subs!.meta.refundsDue} cooling-off refund(s) due — process them in the PayFast dashboard (details were emailed to ADMIN_ALERT_EMAIL).
        </p>
      )}

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <p className="px-4 py-3 text-sm font-bold text-gray-900 border-b border-gray-100">Ballylife for Business applications</p>
        {apps.length === 0 ? <p className="px-4 py-3 text-sm text-gray-600">No applications yet.</p> : (
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr className="text-left text-[11px] text-gray-600 border-b border-gray-100">
              <th className="px-4 py-2 font-medium">Company</th><th className="px-4 py-2 font-medium">Reg. / VAT</th><th className="px-4 py-2 font-medium">Applicant</th><th className="px-4 py-2 font-medium">Status</th><th className="px-4 py-2" />
            </tr></thead>
            <tbody>{apps.map(a => (
              <tr key={a.id} className="border-b border-gray-50 last:border-0">
                <td className="px-4 py-2.5 font-semibold text-gray-900">{a.companyName}</td>
                <td className="px-4 py-2.5 text-gray-700">{a.registrationNumber ?? "—"} {a.vatNumber ? `· VAT ${a.vatNumber}` : ""}</td>
                <td className="px-4 py-2.5 text-gray-700">{a.userName ?? a.userEmail ?? a.userId}</td>
                <td className="px-4 py-2.5 capitalize text-gray-700">{a.status}</td>
                <td className="px-4 py-2.5 whitespace-nowrap">{a.status === "pending" && (<>
                  <button onClick={() => decide(a.id, "approve")} className="text-xs font-bold px-3 py-1 rounded-lg text-white bg-emerald-700 mr-1">Approve</button>
                  <button onClick={() => decide(a.id, "reject")} className="text-xs font-bold px-3 py-1 rounded-lg border border-gray-300">Reject</button>
                </>)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <p className="px-4 py-3 text-sm font-bold text-gray-900 border-b border-gray-100">BallylifeMORE subscribers</p>
        {!subs?.rows.length ? <p className="px-4 py-3 text-sm text-gray-600">No subscribers yet.</p> : (
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr className="text-left text-[11px] text-gray-600 border-b border-gray-100">
              <th className="px-4 py-2 font-medium">Member</th><th className="px-4 py-2 font-medium">Plan</th><th className="px-4 py-2 font-medium">Status</th><th className="px-4 py-2 font-medium">Next payment / ends</th>
            </tr></thead>
            <tbody>{subs.rows.map(s => (
              <tr key={s.id} className="border-b border-gray-50 last:border-0">
                <td className="px-4 py-2.5 text-gray-900">{s.userName ?? s.userEmail}</td>
                <td className="px-4 py-2.5 text-gray-700">{s.planName}{s.pendingPlan ? ` → ${s.pendingPlan}` : ""}</td>
                <td className="px-4 py-2.5 text-gray-700">{STATUS_LABEL[s.status]?.label ?? s.status}</td>
                <td className="px-4 py-2.5 text-gray-700">{fmtDate(s.cancelAt ?? s.nextBillingDate)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
    </div>
  );
}
