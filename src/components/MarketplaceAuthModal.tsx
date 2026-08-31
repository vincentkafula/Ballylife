import { useState } from "react";
import { X, User, Store, Loader2, Eye, EyeOff } from "lucide-react";
import { mktAuth, type MktAuthUser } from "../services/marketplaceApi";
import ballylifeLogo from "../imports/ballylife-logo-compact.png";
import { SellerApplicationWizard } from "./SellerApplicationWizard";

type Tab = "signin" | "customer" | "seller";

interface Props {
  onClose: () => void;
  onAuthenticated: (user: MktAuthUser, seller: { id: string; storeName: string; status: string } | null) => void;
  initialTab?: "signin" | "customer" | "seller";
}

function Field({ label, value, onChange, type = "text", required = true, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; required?: boolean; placeholder?: string;
}) {
  const [show, setShow] = useState(false);
  const isPw = type === "password";
  return (
    <label className="block mb-3">
      <span className="block text-xs font-semibold text-gray-600 mb-1">{label}{required && <span className="text-red-500"> *</span>}</span>
      <span className="relative block">
        <input
          value={value}
          onChange={e => onChange(e.target.value)}
          type={isPw ? (show ? "text" : "password") : type}
          placeholder={placeholder}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#B8862E] focus:ring-1 focus:ring-[#B8862E]"
        />
        {isPw && (
          <button type="button" onClick={() => setShow(s => !s)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400">
            {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        )}
      </span>
    </label>
  );
}

export function MarketplaceAuthModal({ onClose, onAuthenticated, initialTab = "signin" }: Props) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showWizard, setShowWizard] = useState(false);

  // Sign in
  const [siUsername, setSiUsername] = useState("");
  const [siPassword, setSiPassword] = useState("");

  // Customer registration
  const [cName, setCName] = useState("");
  const [cUsername, setCUsername] = useState("");
  const [cEmail, setCEmail] = useState("");
  const [cPassword, setCPassword] = useState("");

  const handleSignIn = async () => {
    setError(null);
    if (!siUsername || !siPassword) { setError("Enter your username and password."); return; }
    setLoading(true);
    const r = await mktAuth.login(siUsername, siPassword);
    setLoading(false);
    if (r.success && r.token) onAuthenticated(r.user, JSON.parse(localStorage.getItem("mkt_seller") ?? "null"));
    else setError((r as { error?: string }).error ?? "Sign in failed. Check your username and password.");
  };

  const handleCustomerRegister = async () => {
    setError(null);
    if (!cName || !cUsername || !cEmail || !cPassword) { setError("All fields are required."); return; }
    if (cPassword.length < 8) { setError("Password must be at least 8 characters."); return; }
    setLoading(true);
    const r = await mktAuth.registerCustomer({ username: cUsername, password: cPassword, name: cName, email: cEmail });
    setLoading(false);
    if (r.success && r.token) onAuthenticated(r.user, null);
    else setError((r as { error?: string }).error ?? "Registration failed.");
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.5)" }} onClick={onClose}>
      <div className="w-full max-w-md bg-white rounded-xl shadow-2xl overflow-hidden max-h-[92vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
          <img src={ballylifeLogo} alt="Ballylife" className="h-7 w-auto" />
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-gray-100"><X className="w-4 h-4 text-gray-500" /></button>
        </div>

        <div className="flex border-b border-gray-100 shrink-0">
          {([
            { id: "signin" as Tab, label: "Sign In" },
            { id: "customer" as Tab, label: "New Customer" },
            { id: "seller" as Tab, label: "Sell on Ballylife" },
          ]).map(t => (
            <button key={t.id} onClick={() => { setTab(t.id); setError(null); }}
              className="flex-1 text-xs font-semibold py-2.5 border-b-2 transition-colors"
              style={{ borderColor: tab === t.id ? "#D4A54A" : "transparent", color: tab === t.id ? "#14110D" : "#9CA3AF" }}>
              {t.label}
            </button>
          ))}
        </div>

        <div className="p-5 overflow-y-auto">
          {error && <div className="mb-3 px-3 py-2 rounded-lg bg-red-50 text-red-600 text-xs font-medium">{error}</div>}

          {tab === "signin" && (
            <div>
              <Field label="Username" value={siUsername} onChange={setSiUsername} />
              <Field label="Password" value={siPassword} onChange={setSiPassword} type="password" />
              <button onClick={handleSignIn} disabled={loading}
                className="w-full mt-2 py-2.5 rounded-lg font-bold text-sm text-white flex items-center justify-center gap-2 disabled:opacity-60"
                style={{ background: "#D4A54A" }}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <><User className="w-4 h-4" /> Sign In</>}
              </button>
              <p className="text-[11px] text-gray-400 mt-3 text-center">Don't have an account? Use the tabs above to register.</p>
            </div>
          )}

          {tab === "customer" && (
            <div>
              <Field label="Full name" value={cName} onChange={setCName} />
              <Field label="Username" value={cUsername} onChange={setCUsername} />
              <Field label="Email" value={cEmail} onChange={setCEmail} type="email" />
              <Field label="Password" value={cPassword} onChange={setCPassword} type="password" placeholder="At least 8 characters" />
              <button onClick={handleCustomerRegister} disabled={loading}
                className="w-full mt-2 py-2.5 rounded-lg font-bold text-sm text-white flex items-center justify-center gap-2 disabled:opacity-60"
                style={{ background: "#14110D" }}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <><User className="w-4 h-4" /> Create customer account</>}
              </button>
            </div>
          )}

          {tab === "seller" && (
            <div className="text-center py-4">
              <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3" style={{ background: "#FFF4E5", color: "#B75C00" }}>
                <Store className="w-6 h-6" />
              </div>
              <p className="font-serif text-base text-gray-900 mb-1" style={{ fontWeight: 600 }}>Sell on Ballylife</p>
              <p className="text-xs text-gray-500 mb-5 max-w-xs mx-auto">Our full seller application covers your account, business details, identity verification, and tax information — about 5 minutes.</p>
              <button onClick={() => setShowWizard(true)}
                className="w-full py-2.5 rounded-lg font-bold text-sm text-white flex items-center justify-center gap-2"
                style={{ background: "#14110D" }}>
                <Store className="w-4 h-4" /> Start seller application
              </button>
              <p className="text-[11px] text-gray-400 mt-3">Your store won't be visible to shoppers until the marketplace team approves your application.</p>
            </div>
          )}
        </div>
      </div>

      {showWizard && (
        <SellerApplicationWizard
          onClose={() => setShowWizard(false)}
          onAuthenticated={(user, seller) => { setShowWizard(false); onAuthenticated(user, seller); }}
        />
      )}
    </div>
  );
}
