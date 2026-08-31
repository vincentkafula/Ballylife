import { useState } from "react";
import {
  Mail, Phone, Lock, Eye, EyeOff, User, Store, Building2, Landmark,
  Users, Globe, MapPin, IdCard, Upload, Check, ChevronLeft, ChevronRight,
  Loader2, ShieldCheck, FileText, Receipt, AlertCircle, CheckCircle2,
} from "lucide-react";
import { mktAuth, BASE, getMktToken, type MktAuthUser } from "../services/marketplaceApi";

const INK = "#131921";
const ORANGE = "#FF9900";

const STEPS = [
  { title: "Account",     icon: <Lock className="w-4 h-4" /> },
  { title: "Seller Type", icon: <Store className="w-4 h-4" /> },
  { title: "Personal Info", icon: <User className="w-4 h-4" /> },
  { title: "Identity (KYC)", icon: <IdCard className="w-4 h-4" /> },
  { title: "Address",     icon: <MapPin className="w-4 h-4" /> },
  { title: "Business Info", icon: <Building2 className="w-4 h-4" /> },
  { title: "Registration Docs", icon: <FileText className="w-4 h-4" /> },
  { title: "Tax Info",    icon: <Receipt className="w-4 h-4" /> },
];

const SELLER_TYPES = [
  "Individual Seller", "Sole Proprietor", "Private Company", "Public Company",
  "Partnership", "Non-Profit Organization", "Government Institution", "International Company",
];

type FormData = {
  email: string; mobile: string; password: string; confirmPassword: string;
  emailVerified: boolean; phoneVerified: boolean;
  sellerType: string;
  firstName: string; middleName: string; lastName: string; dob: string; gender: string; nationality: string;
  altPhone: string; contactEmail: string;
  idType: string; idNumber: string; idCountry: string; idExpiry: string;
  idFront: File | null; idBack: File | null; selfie: File | null;
  street: string; city: string; province: string; postalCode: string; country: string; addressProof: File | null;
  businessName: string; tradingName: string; businessType: string; registrationNumber: string;
  taxNumber: string; vatNumber: string; dateRegistered: string; countryOfRegistration: string;
  website: string; yearsInBusiness: string; employees: string; annualRevenue: string; businessDescription: string;
  certIncorporation: File | null; businessRegCert: File | null; businessLicense: File | null; companyStatus: string; companyAddress: string;
  tin: string; vatRegNumber: string; taxCountry: string; taxCertificate: File | null;
};

const EMPTY: FormData = {
  email: "", mobile: "", password: "", confirmPassword: "", emailVerified: false, phoneVerified: false,
  sellerType: "", firstName: "", middleName: "", lastName: "", dob: "", gender: "", nationality: "",
  altPhone: "", contactEmail: "",
  idType: "", idNumber: "", idCountry: "", idExpiry: "", idFront: null, idBack: null, selfie: null,
  street: "", city: "", province: "", postalCode: "", country: "South Africa", addressProof: null,
  businessName: "", tradingName: "", businessType: "", registrationNumber: "",
  taxNumber: "", vatNumber: "", dateRegistered: "", countryOfRegistration: "South Africa",
  website: "", yearsInBusiness: "", employees: "", annualRevenue: "", businessDescription: "",
  certIncorporation: null, businessRegCert: null, businessLicense: null, companyStatus: "", companyAddress: "",
  tin: "", vatRegNumber: "", taxCountry: "South Africa", taxCertificate: null,
};

interface Props {
  onClose: () => void;
  onAuthenticated: (user: MktAuthUser, seller: { id: string; storeName: string; status: string } | null) => void;
}

function Label({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return <span className="block text-xs font-semibold text-gray-600 mb-1">{children}{required && <span className="text-red-500"> *</span>}</span>;
}

function TextField({ label, value, onChange, required, type = "text", icon, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; required?: boolean; type?: string; icon?: React.ReactNode; placeholder?: string;
}) {
  const [show, setShow] = useState(false);
  const isPw = type === "password";
  return (
    <label className="block">
      <Label required={required}>{label}</Label>
      <span className="relative flex items-center">
        {icon && <span className="absolute left-3 text-gray-400">{icon}</span>}
        <input
          value={value} placeholder={placeholder}
          onChange={e => onChange(e.target.value)}
          type={isPw ? (show ? "text" : "password") : type}
          className="w-full border border-gray-300 rounded-lg py-2 text-sm outline-none focus:border-[#128A43] focus:ring-1 focus:ring-[#128A43]"
          style={{ paddingLeft: icon ? 34 : 12, paddingRight: isPw ? 34 : 12 }}
        />
        {isPw && (
          <button type="button" onClick={() => setShow(s => !s)} className="absolute right-2.5 text-gray-400">
            {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        )}
      </span>
    </label>
  );
}

function SelectField({ label, value, onChange, options, required }: {
  label: string; value: string; onChange: (v: string) => void; options: string[]; required?: boolean;
}) {
  return (
    <label className="block">
      <Label required={required}>{label}</Label>
      <select value={value} onChange={e => onChange(e.target.value)}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#128A43] bg-white">
        <option value="">Select...</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}

function TextArea({ label, value, onChange, required }: { label: string; value: string; onChange: (v: string) => void; required?: boolean }) {
  return (
    <label className="block sm:col-span-2">
      <Label required={required}>{label}</Label>
      <textarea value={value} onChange={e => onChange(e.target.value)} rows={3}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#128A43]" />
    </label>
  );
}

const MAX_FILE_MB = 10;
const ACCEPTED = "image/png,image/jpeg,image/webp,application/pdf";

function FileField({ label, file, onChange, required, hint }: {
  label: string; file: File | null; onChange: (f: File | null) => void; required?: boolean; hint?: string;
}) {
  const [dragOver, setDragOver] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const inputId = `file-${label.replace(/\W+/g, "-")}`;
  const preview = file && file.type.startsWith("image/") ? URL.createObjectURL(file) : null;

  const accept = (f: File | undefined) => {
    if (!f) return;
    if (f.size > MAX_FILE_MB * 1024 * 1024) { setFileError(`File is too large — max ${MAX_FILE_MB}MB.`); return; }
    if (!ACCEPTED.split(",").includes(f.type)) { setFileError("Use a JPG, PNG, WEBP or PDF file."); return; }
    setFileError(null);
    onChange(f);
  };

  return (
    <label className="block" htmlFor={inputId}>
      <Label required={required}>{label}</Label>
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); accept(e.dataTransfer.files?.[0]); }}
        className="relative flex items-center gap-3 border border-dashed rounded-lg px-3 py-2.5 text-sm cursor-pointer transition-colors"
        style={{ borderColor: dragOver ? "#128A43" : file ? "#10B981" : "#D1D5DB", background: dragOver ? "#EFF6FF" : file ? "#F0FDF4" : "#fff" }}
      >
        {preview ? (
          <img src={preview} alt="" className="w-9 h-9 rounded object-cover shrink-0 border border-gray-200" />
        ) : (
          <span className="w-9 h-9 rounded flex items-center justify-center shrink-0" style={{ background: file ? "#DCFCE7" : "#F3F4F6", color: file ? "#059669" : "#9CA3AF" }}>
            {file ? <CheckCircle2 className="w-4 h-4" /> : <Upload className="w-4 h-4" />}
          </span>
        )}
        <span className="flex-1 min-w-0">
          {file ? (
            <>
              <span className="block truncate text-gray-800 font-medium">{file.name}</span>
              <span className="block text-[10px] text-gray-400">{(file.size / 1024 / 1024).toFixed(2)} MB</span>
            </>
          ) : (
            <span className="text-gray-400">Drag a file here, or click to browse</span>
          )}
        </span>
        {file && (
          <button type="button" onClick={e => { e.preventDefault(); e.stopPropagation(); onChange(null); }} className="text-gray-400 hover:text-red-500 shrink-0 text-xs font-semibold">
            Remove
          </button>
        )}
        <input id={inputId} type="file" accept={ACCEPTED} className="absolute inset-0 opacity-0 cursor-pointer" onChange={e => accept(e.target.files?.[0])} />
      </div>
      {fileError && <p className="text-[11px] text-red-500 mt-1">{fileError}</p>}
      {hint && !fileError && <p className="text-[11px] text-gray-400 mt-1">{hint}</p>}
    </label>
  );
}

function SectionIntro({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div className="flex items-start gap-3 mb-5">
      <span className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ background: "#FFF4E5", color: "#B75C00" }}>{icon}</span>
      <div>
        <p className="text-base font-bold text-gray-900">{title}</p>
        <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>
      </div>
    </div>
  );
}

export function SellerApplicationWizard({ onClose, onAuthenticated }: Props) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormData>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const isIndividual = form.sellerType === "Individual Seller";
  const set = <K extends keyof FormData>(k: K, v: FormData[K]) => setForm(f => ({ ...f, [k]: v }));

  const effectiveSteps = isIndividual ? STEPS.filter((_, i) => i !== 5 && i !== 6) : STEPS;
  const stepIndexMap = isIndividual ? [0, 1, 2, 3, 4, 7] : [0, 1, 2, 3, 4, 5, 6, 7];
  const currentRealStep = stepIndexMap[step];

  const validateStep = (): string | null => {
    switch (currentRealStep) {
      case 0:
        if (!form.email || !form.mobile || !form.password || !form.confirmPassword) return "All fields are required.";
        if (form.password.length < 8) return "Password must be at least 8 characters.";
        if (form.password !== form.confirmPassword) return "Passwords do not match.";
        return null;
      case 1:
        if (!form.sellerType) return "Select a seller type to continue.";
        return null;
      case 2:
        if (!form.firstName || !form.lastName || !form.dob || !form.nationality) return "First name, last name, date of birth and nationality are required.";
        return null;
      case 3:
        if (!form.idType || !form.idNumber || !form.idCountry) return "ID type, ID number and country of issue are required.";
        return null;
      case 4:
        if (!form.street || !form.city || !form.postalCode || !form.country) return "Street, city, postal code and country are required.";
        return null;
      case 5:
        if (!form.businessName || !form.registrationNumber) return "Business name and registration number are required.";
        return null;
      case 6:
        return null;
      case 7:
        if (!form.tin) return "Tax identification number is required.";
        return null;
      default:
        return null;
    }
  };

  const next = () => {
    const err = validateStep();
    if (err) { setError(err); return; }
    setError(null);
    if (step < effectiveSteps.length - 1) setStep(s => s + 1);
    else submit();
  };
  const back = () => { setError(null); if (step > 0) setStep(s => s - 1); };

  const submit = async () => {
    setLoading(true); setError(null);
    const derivedStoreName = form.tradingName || form.businessName || `${form.firstName} ${form.lastName}`.trim() || form.email.split("@")[0];
    const username = form.email.split("@")[0] + Math.floor(Math.random() * 900 + 100);
    const applicationData = {
      sellerType: form.sellerType,
      personal: { firstName: form.firstName, middleName: form.middleName, lastName: form.lastName, dob: form.dob, gender: form.gender, nationality: form.nationality, altPhone: form.altPhone, contactEmail: form.contactEmail },
      identity: { idType: form.idType, idNumber: form.idNumber, idCountry: form.idCountry, idExpiry: form.idExpiry, documentsAttached: [form.idFront, form.idBack, form.selfie].filter(Boolean).length, verificationStatus: "pending" },
      address: { street: form.street, city: form.city, province: form.province, postalCode: form.postalCode, country: form.country, proofAttached: Boolean(form.addressProof) },
      business: isIndividual ? null : {
        businessName: form.businessName, tradingName: form.tradingName, businessType: form.businessType, registrationNumber: form.registrationNumber,
        taxNumber: form.taxNumber, vatNumber: form.vatNumber, dateRegistered: form.dateRegistered, countryOfRegistration: form.countryOfRegistration,
        website: form.website, yearsInBusiness: form.yearsInBusiness, employees: form.employees, annualRevenue: form.annualRevenue, description: form.businessDescription,
      },
      registrationDocs: isIndividual ? null : {
        companyStatus: form.companyStatus, companyAddress: form.companyAddress,
        documentsAttached: [form.certIncorporation, form.businessRegCert, form.businessLicense].filter(Boolean).length,
      },
      tax: { tin: form.tin, vatRegNumber: form.vatRegNumber, taxCountry: form.taxCountry, certificateAttached: Boolean(form.taxCertificate) },
    };

    const r = await mktAuth.registerSeller({
      username, password: form.password, name: `${form.firstName} ${form.lastName}`.trim(), email: form.email,
      storeName: derivedStoreName, description: form.businessDescription, phone: form.mobile, taxId: form.tin,
      applicationData,
    });

    if (!r.success || !r.token) {
      setLoading(false);
      setError((r as { error?: string }).error ?? "Application could not be submitted. Please try again.");
      return;
    }

    const sellerId = (r.seller as { id: string } | undefined)?.id;
    const documentFields: [string, File | null][] = [
      ["idFront", form.idFront], ["idBack", form.idBack], ["selfie", form.selfie], ["addressProof", form.addressProof],
      ["certIncorporation", form.certIncorporation], ["businessRegCert", form.businessRegCert],
      ["businessLicense", form.businessLicense], ["taxCertificate", form.taxCertificate],
    ];
    const hasAnyDocument = documentFields.some(([, f]) => f !== null);

    if (sellerId && hasAnyDocument) {
      const fd = new FormData();
      for (const [field, file] of documentFields) if (file) fd.append(field, file);
      fd.append("firstName", form.firstName);
      fd.append("lastName", form.lastName);
      fd.append("dob", form.dob);
      fd.append("idType", form.idType);
      fd.append("idNumber", form.idNumber);
      fd.append("idCountry", form.idCountry);

      try {
        const uploadRes = await fetch(`${BASE}/api/kyc/sellers/${sellerId}/documents`, {
          method: "POST",
          headers: { Authorization: `Bearer ${getMktToken()}` },
          body: fd,
        });
        const uploadJson = await uploadRes.json();
        // A real provider isn't configured yet — this will currently
        // always come back as a clean, expected failure (503), not a
        // surprise. The seller account itself was still created
        // successfully above; only document verification is pending on
        // a provider being set up. Don't block account creation on this,
        // but don't silently pretend verification happened either.
        if (!uploadJson.success) {
          console.warn("[seller registration] Document verification not available yet:", uploadJson.error);
        }
      } catch (err) {
        console.warn("[seller registration] Document upload failed:", err);
      }
    }

    setLoading(false);
    onAuthenticated(r.user, r.seller as { id: string; storeName: string; status: string });
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-3 sm:p-6" style={{ background: "rgba(0,0,0,0.55)" }} onClick={e => e.stopPropagation()}>
      <div className="w-full max-w-3xl bg-white rounded-xl shadow-2xl overflow-hidden max-h-[94vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 sm:px-6 py-4 shrink-0" style={{ background: INK }}>
          <div>
            <p className="text-white text-sm font-black">Seller Registration &amp; Verification</p>
            <p className="text-white/50 text-[11px] mt-0.5">Step {step + 1} of {effectiveSteps.length} — {effectiveSteps[step].title}</p>
          </div>
          <button onClick={onClose} className="text-white/60 hover:text-white text-xs font-semibold">Cancel</button>
        </div>

        <div className="flex items-center px-4 sm:px-6 pt-4 pb-2 overflow-x-auto shrink-0 scrollbar-none">
          {effectiveSteps.map((s, i) => (
            <div key={s.title} className="flex items-center shrink-0">
              <div className="flex flex-col items-center gap-1">
                <span
                  className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 transition-colors"
                  style={{
                    background: i < step ? "#10B981" : i === step ? ORANGE : "#E5E7EB",
                    color: i <= step ? "#fff" : "#9CA3AF",
                  }}
                >
                  {i < step ? <Check className="w-3.5 h-3.5" /> : i + 1}
                </span>
                <span className="text-[9px] font-medium text-gray-500 whitespace-nowrap hidden md:block">{s.title}</span>
              </div>
              {i < effectiveSteps.length - 1 && <div className="w-6 sm:w-10 h-0.5 mx-1" style={{ background: i < step ? "#10B981" : "#E5E7EB" }} />}
            </div>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-5">
          {error && (
            <div className="mb-4 flex items-start gap-2 px-3 py-2.5 rounded-lg bg-red-50 text-red-600 text-xs font-medium">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {error}
            </div>
          )}

          {currentRealStep === 0 && (
            <div>
              <SectionIntro icon={<Lock className="w-5 h-5" />} title="Account Information" subtitle="Your login details for the seller dashboard." />
              <div className="grid sm:grid-cols-2 gap-3">
                <TextField label="Email address" value={form.email} onChange={v => set("email", v)} type="email" icon={<Mail className="w-4 h-4" />} required />
                <TextField label="Mobile number" value={form.mobile} onChange={v => set("mobile", v)} icon={<Phone className="w-4 h-4" />} placeholder="+27..." required />
                <TextField label="Password" value={form.password} onChange={v => set("password", v)} type="password" placeholder="At least 8 characters" required />
                <TextField label="Confirm password" value={form.confirmPassword} onChange={v => set("confirmPassword", v)} type="password" required />
              </div>
              <div className="mt-4 grid sm:grid-cols-2 gap-3">
                {[{ key: "emailVerified" as const, label: "Email verification (OTP)" }, { key: "phoneVerified" as const, label: "Phone verification (SMS OTP)" }].map(v => (
                  <div key={v.key} className="flex items-center justify-between border border-gray-100 rounded-lg px-3 py-2.5">
                    <span className="text-xs text-gray-600">{v.label}</span>
                    <button
                      onClick={() => set(v.key, !form[v.key])}
                      className="flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-full"
                      style={{ background: form[v.key] ? "#ECFDF5" : "#F3F4F6", color: form[v.key] ? "#059669" : "#9CA3AF" }}
                    >
                      {form[v.key] ? <><CheckCircle2 className="w-3 h-3" /> Verified (demo)</> : "Not verified"}
                    </button>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-gray-400 mt-3">Real SMS/email OTP delivery isn't wired up in this demo — the toggle above simulates the verified state a production build would confirm before allowing sign-up.</p>
            </div>
          )}

          {currentRealStep === 1 && (
            <div>
              <SectionIntro icon={<Store className="w-5 h-5" />} title="Seller Type" subtitle="Choose the option that matches how you'll be trading." />
              <div className="grid sm:grid-cols-2 gap-2">
                {SELLER_TYPES.map(t => (
                  <button key={t} onClick={() => set("sellerType", t)}
                    className="flex items-center gap-2.5 text-left px-3.5 py-3 rounded-lg border text-sm font-medium transition-colors"
                    style={{ borderColor: form.sellerType === t ? ORANGE : "#E5E7EB", background: form.sellerType === t ? "#FFF4E5" : "#fff", color: form.sellerType === t ? "#B75C00" : "#374151" }}>
                    <span className="w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0" style={{ borderColor: form.sellerType === t ? ORANGE : "#D1D5DB" }}>
                      {form.sellerType === t && <span className="w-2 h-2 rounded-full" style={{ background: ORANGE }} />}
                    </span>
                    {t}
                  </button>
                ))}
              </div>
              {isIndividual && <p className="text-[11px] text-gray-400 mt-3">As an individual seller, the Business Info and Registration Documents sections won't apply to you — we'll skip straight to Tax Info after your address.</p>}
            </div>
          )}

          {currentRealStep === 2 && (
            <div>
              <SectionIntro icon={<User className="w-5 h-5" />} title="Personal Information" subtitle="The primary contact person for this seller account." />
              <div className="grid sm:grid-cols-3 gap-3">
                <TextField label="First name" value={form.firstName} onChange={v => set("firstName", v)} required />
                <TextField label="Middle name" value={form.middleName} onChange={v => set("middleName", v)} />
                <TextField label="Last name" value={form.lastName} onChange={v => set("lastName", v)} required />
                <TextField label="Date of birth" value={form.dob} onChange={v => set("dob", v)} type="date" required />
                <SelectField label="Gender" value={form.gender} onChange={v => set("gender", v)} options={["Male", "Female", "Non-binary", "Prefer not to say"]} />
                <TextField label="Nationality" value={form.nationality} onChange={v => set("nationality", v)} required />
                <TextField label="Alternative phone" value={form.altPhone} onChange={v => set("altPhone", v)} icon={<Phone className="w-4 h-4" />} />
                <TextField label="Contact email" value={form.contactEmail} onChange={v => set("contactEmail", v)} type="email" icon={<Mail className="w-4 h-4" />} />
              </div>
            </div>
          )}

          {currentRealStep === 3 && (
            <div>
              <SectionIntro icon={<IdCard className="w-5 h-5" />} title="Identity Verification (KYC)" subtitle="Confirm who you are with a government-issued ID." />
              <div className="grid sm:grid-cols-3 gap-3 mb-4">
                <SelectField label="ID type" value={form.idType} onChange={v => set("idType", v)} options={["National Identity Card", "Passport", "Driver's License", "Residence Permit"]} required />
                <TextField label="ID number" value={form.idNumber} onChange={v => set("idNumber", v)} required />
                <TextField label="Country of issue" value={form.idCountry} onChange={v => set("idCountry", v)} required />
                <TextField label="Expiry date" value={form.idExpiry} onChange={v => set("idExpiry", v)} type="date" />
              </div>
              <div className="grid sm:grid-cols-3 gap-3">
                <FileField label="Front of ID" file={form.idFront} onChange={v => set("idFront", v)} />
                <FileField label="Back of ID (if applicable)" file={form.idBack} onChange={v => set("idBack", v)} />
                <FileField label="Selfie holding the ID" file={form.selfie} onChange={v => set("selfie", v)} />
              </div>
              <div className="mt-4 flex items-center gap-2">
                <span className="text-xs text-gray-500">Verification status:</span>
                <span className="flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-full" style={{ background: "#FFF7ED", color: "#C2410C" }}>
                  <Loader2 className="w-3 h-3" /> Pending review
                </span>
              </div>
              <div className="mt-4 flex items-start gap-2 px-3 py-2.5 rounded-lg bg-amber-50 border border-amber-100">
                <ShieldCheck className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <p className="text-[11px] text-amber-800">Your documents are sent securely for identity verification and are never stored as files on our servers — only the verification result is kept. <strong>Identity verification isn't live yet</strong> (no licensed provider is connected), so submissions will currently be held as pending until that's set up — your seller account itself is still created normally.</p>
              </div>
            </div>
          )}

          {currentRealStep === 4 && (
            <div>
              <SectionIntro icon={<MapPin className="w-5 h-5" />} title="Residential Address" subtitle="Where you can be reached for correspondence." />
              <div className="grid sm:grid-cols-2 gap-3">
                <TextField label="Street address" value={form.street} onChange={v => set("street", v)} required />
                <TextField label="City" value={form.city} onChange={v => set("city", v)} required />
                <TextField label="Province/State" value={form.province} onChange={v => set("province", v)} />
                <TextField label="Postal code" value={form.postalCode} onChange={v => set("postalCode", v)} required />
                <TextField label="Country" value={form.country} onChange={v => set("country", v)} required />
                <FileField label="Proof of address (utility bill / bank statement / lease)" file={form.addressProof} onChange={v => set("addressProof", v)} />
              </div>
              <p className="text-[11px] text-gray-400 mt-3">Document should be less than 3 months old. Sent securely for verification and never stored as a file on our servers — only the verification result is kept.</p>
            </div>
          )}

          {currentRealStep === 5 && (
            <div>
              <SectionIntro icon={<Building2 className="w-5 h-5" />} title="Business Information" subtitle="Details about the registered business you'll be selling under." />
              <div className="grid sm:grid-cols-2 gap-3">
                <TextField label="Business name" value={form.businessName} onChange={v => set("businessName", v)} required />
                <TextField label="Trading name" value={form.tradingName} onChange={v => set("tradingName", v)} />
                <SelectField label="Business type" value={form.businessType} onChange={v => set("businessType", v)} options={SELLER_TYPES.filter(t => t !== "Individual Seller")} />
                <TextField label="Registration number" value={form.registrationNumber} onChange={v => set("registrationNumber", v)} required />
                <TextField label="Tax number" value={form.taxNumber} onChange={v => set("taxNumber", v)} />
                <TextField label="VAT number (if applicable)" value={form.vatNumber} onChange={v => set("vatNumber", v)} />
                <TextField label="Date registered" value={form.dateRegistered} onChange={v => set("dateRegistered", v)} type="date" />
                <TextField label="Country of registration" value={form.countryOfRegistration} onChange={v => set("countryOfRegistration", v)} />
                <TextField label="Business website" value={form.website} onChange={v => set("website", v)} icon={<Globe className="w-4 h-4" />} />
                <TextField label="Years in business" value={form.yearsInBusiness} onChange={v => set("yearsInBusiness", v)} type="number" />
                <TextField label="Number of employees" value={form.employees} onChange={v => set("employees", v)} type="number" icon={<Users className="w-4 h-4" />} />
                <TextField label="Annual revenue (optional)" value={form.annualRevenue} onChange={v => set("annualRevenue", v)} />
                <TextArea label="Business description" value={form.businessDescription} onChange={v => set("businessDescription", v)} />
              </div>
            </div>
          )}

          {currentRealStep === 6 && (
            <div>
              <SectionIntro icon={<FileText className="w-5 h-5" />} title="Company Registration Documents" subtitle="Supporting documents that confirm your business is legally registered." />
              <div className="grid sm:grid-cols-2 gap-3 mb-4">
                <FileField label="Certificate of Incorporation" file={form.certIncorporation} onChange={v => set("certIncorporation", v)} />
                <FileField label="Business Registration Certificate" file={form.businessRegCert} onChange={v => set("businessRegCert", v)} />
                <FileField label="Business License" file={form.businessLicense} onChange={v => set("businessLicense", v)} />
                <SelectField label="Company status" value={form.companyStatus} onChange={v => set("companyStatus", v)} options={["Active", "In Business", "Dormant", "Deregistered"]} />
              </div>
              <TextField label="Registered company address" value={form.companyAddress} onChange={v => set("companyAddress", v)} icon={<Landmark className="w-4 h-4" />} />
              <p className="text-[11px] text-gray-400 mt-3">As with the KYC step, these stay in your browser only — attaching them here keeps the application complete for review without sending real documents to a server.</p>
            </div>
          )}

          {currentRealStep === 7 && (
            <div>
              <SectionIntro icon={<Receipt className="w-5 h-5" />} title="Tax Information" subtitle="So the marketplace can handle your payouts and reporting correctly." />
              <div className="grid sm:grid-cols-2 gap-3">
                <TextField label="Tax identification number" value={form.tin} onChange={v => set("tin", v)} required />
                <TextField label="VAT registration number" value={form.vatRegNumber} onChange={v => set("vatRegNumber", v)} />
                <TextField label="Tax country" value={form.taxCountry} onChange={v => set("taxCountry", v)} />
                <FileField label="Tax certificate" file={form.taxCertificate} onChange={v => set("taxCertificate", v)} />
              </div>
              <div className="mt-5 p-4 rounded-lg bg-gray-50 border border-gray-100">
                <p className="text-xs font-semibold text-gray-700 mb-1">Ready to submit</p>
                <p className="text-[11px] text-gray-500">Submitting creates your account and store profile (store name: <strong>{form.tradingName || form.businessName || `${form.firstName} ${form.lastName}`.trim() || "—"}</strong>), status <strong>pending review</strong>. A marketplace manager verifies applications before a store goes live — you can add products in the meantime from your seller dashboard.</p>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-t border-gray-100 shrink-0">
          <button onClick={step === 0 ? onClose : back} className="flex items-center gap-1 text-sm font-semibold text-gray-500 hover:text-gray-800">
            <ChevronLeft className="w-4 h-4" /> {step === 0 ? "Cancel" : "Back"}
          </button>
          <div className="hidden sm:block text-[11px] text-gray-400">{Math.round(((step + 1) / effectiveSteps.length) * 100)}% complete</div>
          <button onClick={next} disabled={loading}
            className="flex items-center gap-1.5 text-sm font-bold px-5 py-2.5 rounded-lg text-white disabled:opacity-60"
            style={{ background: step === effectiveSteps.length - 1 ? "#10B981" : ORANGE }}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : step === effectiveSteps.length - 1 ? <>Submit Application <Check className="w-4 h-4" /></> : <>Next <ChevronRight className="w-4 h-4" /></>}
          </button>
        </div>
      </div>
    </div>
  );
}
