/**
 * Admin: the details of one seller application -- where it came from
 * (website or WhatsApp), business type, masked ID and bank details, chosen
 * categories, and the uploaded documents. Documents are fetched with the
 * admin's sign-in and opened in a new tab; they're never public links.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { FileText, Loader2, MessageCircle } from "lucide-react";
import { mktAdmin, fetchSellerDocument } from "../services/marketplaceApi";

type R = Record<string, any>;
const DOC_LABEL: Record<string, string> = { id_document: "ID / registration", proof_of_address: "Proof of address" };
const TYPE_LABEL: Record<string, string> = { individual: "Individual / sole trader", company: "Registered company", other: "Partnership / other" };

export function SellerApplicationDetails({ sellerId }: { sellerId: string }) {
  const [app, setApp] = useState<R | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);

  useEffect(() => {
    mktAdmin.sellerApplication(sellerId)
      .then(r => (r.success ? setApp(r.data) : setError(r.error ?? "Couldn't load the application.")))
      .catch(() => setError("Couldn't load the application."));
  }, [sellerId]);

  const openDoc = async (id: string) => {
    setOpening(id);
    // Open the tab first (browsers block pop-ups opened after an await), then fill it.
    const tab = window.open("", "_blank");
    try {
      const blob = await fetchSellerDocument(id);
      const url = URL.createObjectURL(blob);
      if (tab) tab.location.href = url; else window.location.href = url;
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      tab?.close();
      toast.error("Couldn't open that document.");
    } finally { setOpening(null); }
  };

  if (error) return <p className="text-xs text-red-600 px-4 pb-3">{error}</p>;
  if (!app) return <div className="px-4 pb-3"><Loader2 className="w-4 h-4 animate-spin text-gray-400" /></div>;

  const row = (label: string, value: React.ReactNode) => (
    <div className="flex gap-2 text-xs"><span className="w-32 shrink-0 text-gray-500">{label}</span><span className="text-gray-900">{value}</span></div>
  );
  return (
    <div className="mx-4 mb-3 rounded-lg bg-gray-50 border border-gray-100 p-3 space-y-1.5">
      {row("Applied via", app.source === "whatsapp"
        ? <span className="inline-flex items-center gap-1 text-[#1E7B4D] font-medium"><MessageCircle className="w-3.5 h-3.5" /> WhatsApp {app.whatsappPhone}</span>
        : "Website")}
      {app.submittedAt && row("Submitted", new Date(app.submittedAt).toLocaleString("en-ZA", { dateStyle: "medium", timeStyle: "short" }))}
      {app.businessType && row("Business type", TYPE_LABEL[app.businessType] ?? app.businessType)}
      {app.idNumber && row(app.businessType === "company" ? "CIPC number" : "ID number", app.idNumber)}
      {app.categories?.length > 0 && row("Categories", app.categories.join(", "))}
      {app.bank && row("Payout bank", `${app.bank.name} ${app.bank.account} · branch ${app.bank.branch} · ${app.bank.accountType === "savings" ? "Savings" : "Cheque"}`)}
      {row("Documents", app.documents?.length
        ? <span className="flex flex-wrap gap-2">{(app.documents as R[]).map(d => (
            <button key={d.id} onClick={() => void openDoc(d.id)} disabled={opening === d.id}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-gray-200 bg-white hover:border-[#1E7B4D] disabled:opacity-50">
              {opening === d.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileText className="w-3 h-3" />} {DOC_LABEL[d.kind] ?? d.kind}
            </button>))}</span>
        : <span className="text-gray-500">None uploaded here (website applications upload through identity verification)</span>)}
    </div>
  );
}
