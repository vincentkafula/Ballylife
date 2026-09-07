import { useState, useEffect } from "react";
import { X, User, Store, Loader2, Eye, EyeOff } from "lucide-react";
import { mktAuth, type MktAuthUser } from "../services/marketplaceApi";
import ballylifeLogo from "../imports/ballylife-logo-compact.png";
import { SellerApplicationWizard } from "./SellerApplicationWizard";

type Tab = "signin" | "customer" | "seller" | "forgot" | "reset";

interface Props {
  onClose: () => void;
  onAuthenticated: (user: MktAuthUser, seller: { id: string; storeName: string; status: string } | null, supplier?: Record<string, unknown> | null, authority?: Record<string, unknown> | null) => void;
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
  const [message, setMessage] = useState<string | null>(null);
  const [showWizard, setShowWizard] = useState(false);

  // Sign in
  const [siUsername, setSiUsername] = useState("");
  const [siPassword, setSiPassword] = useState("");

  // Forgot / reset password
  const [fpEmail, setFpEmail] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [rpPassword, setRpPassword] = useState("");
  const [rpConfirm, setRpConfirm] = useState("");

  // A password-reset email link lands back here as ?resetToken=... — jump
  // straight to the reset form instead of making the person find sign-in
  // and a "forgot password" link on their own.
  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("resetToken");
    if (token) { setResetToken(token); setTab("reset"); }
  }, []);

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
    if (r.success && r.token) onAuthenticated(r.user, JSON.parse(localStorage.getItem("mkt_seller") ?? "null"), JSON.parse(localStorage.getItem("mkt_supplier") ?? "null"), JSON.parse(localStorage.getItem("mkt_authority") ?? "null"));
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

  const handleForgotPassword = async () => {
    setError(null); setMessage(null);
    if (!fpEmail) { setError("Enter the email address on your account."); return; }
    setLoading(true);
    const r = await mktAuth.forgotPassword(fpEmail);
    setLoading(false);
    if (r.success) setMessage(r.message ?? "If an account exists with that email, a password reset link has been sent.");
    else setError(r.error ?? "Something went wrong — please try again.");
  };

  const handleResetPassword = async () => {
    setError(null); setMessage(null);
    if (!rpPassword || !rpConfirm) { setError("Enter and confirm your new password."); return; }
    if (rpPassword.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (rpPassword !== rpConfirm) { setError("Passwords don't match."); return; }
    setLoading(true);
    const r = await mktAuth.resetPassword(resetToken, rpPassword);
    setLoading(false);
    if (r.success) {
      setMessage(r.message ?? "Password reset successfully — you can now sign in.");
      // Clean the token out of the URL now that it's been used, and drop
      // back to the sign-in form after a moment so it doesn't look stuck.
      window.history.replaceState({}, "", window.location.pathname);
      setTimeout(() => { setTab("signin"); setMessage(null); }, 2000);
    } else {
      setError(r.error ?? "This reset link is invalid or has expired — request a new one.");
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.5)" }} onClick={onClose}>
      <div className="w-full max-w-md bg-white rounded-xl shadow-2xl overflow-hidden max-h-[92vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
          <img src={ballylifeLogo} alt="Ballylife" className="h-7 w-auto" />
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-gray-100"><X className="w-4 h-4 text-gray-500" /></button>
        </div>

        {tab !== "forgot" && tab !== "reset" && (
          <div className="flex border-b border-gray-100 shrink-0">
            {([
              { id: "signin" as Tab, label: "Sign In" },
              { id: "customer" as Tab, label: "New Customer" },
              { id: "seller" as Tab, label: "Sell on Ballylife" },
            ]).map(t => (
              <button key={t.id} onClick={() => { setTab(t.id); setError(null); setMessage(null); }}
                className="flex-1 text-xs font-semibold py-2.5 border-b-2 transition-colors"
                style={{ borderColor: tab === t.id ? "#D4A54A" : "transparent", color: tab === t.id ? "#14110D" : "#9CA3AF" }}>
                {t.label}
              </button>
            ))}
          </div>
        )}

        <div className="p-5 overflow-y-auto">
          {error && <div className="mb-3 px-3 py-2 rounded-lg bg-red-50 text-red-600 text-xs font-medium">{error}</div>}
          {message && <div className="mb-3 px-3 py-2 rounded-lg bg-green-50 text-green-700 text-xs font-medium">{message}</div>}

          {tab === "signin" && (
            <div>
              <Field label="Username" value={siUsername} onChange={setSiUsername} />
              <Field label="Password" value={siPassword} onChange={setSiPassword} type="password" />
              <button onClick={handleSignIn} disabled={loading}
                className="w-full mt-2 py-2.5 rounded-lg font-bold text-sm text-white flex items-center justify-center gap-2 disabled:opacity-60"
                style={{ background: "#D4A54A" }}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <><User className="w-4 h-4" /> Sign In</>}
              </button>
              <button onClick={() => { setTab("forgot"); setError(null); setMessage(null); }} className="block w-full text-center text-[11px] text-gray-500 hover:text-gray-800 mt-3 hover:underline">
                Forgot your password?
              </button>
              <p className="text-[11px] text-gray-400 mt-2 text-center">Don't have an account? Use the tabs above to register.</p>
            </div>
          )}

          {tab === "forgot" && (
            <div>
              <p className="text-xs text-gray-500 mb-3">Enter the email address on your account and we'll send you a link to reset your password.</p>
              <Field label="Email" value={fpEmail} onChange={setFpEmail} type="email" />
              <button onClick={handleForgotPassword} disabled={loading}
                className="w-full mt-2 py-2.5 rounded-lg font-bold text-sm text-white flex items-center justify-center gap-2 disabled:opacity-60"
                style={{ background: "#D4A54A" }}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Send reset link"}
              </button>
              <button onClick={() => { setTab("signin"); setError(null); setMessage(null); }} className="block w-full text-center text-[11px] text-gray-500 hover:text-gray-800 mt-3 hover:underline">
                Back to sign in
              </button>
            </div>
          )}

          {tab === "reset" && (
            <div>
              <p className="text-xs text-gray-500 mb-3">Choose a new password for your account.</p>
              <Field label="New password" value={rpPassword} onChange={setRpPassword} type="password" placeholder="At least 8 characters" />
              <Field label="Confirm new password" value={rpConfirm} onChange={setRpConfirm} type="password" />
              <button onClick={handleResetPassword} disabled={loading}
                className="w-full mt-2 py-2.5 rounded-lg font-bold text-sm text-white flex items-center justify-center gap-2 disabled:opacity-60"
                style={{ background: "#D4A54A" }}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Reset password"}
              </button>
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
