import { useRef, type RefObject } from "react";
import ballylifeLogo from "../imports/ballylife-logo-compact.png";

// Shared wrapper for every standalone footer page (Contact, Terms,
// Privacy, Returns, etc.) rendered via an iframe. Previously each page
// duplicated its own plain "<- Back to shopping" text link with no
// branding -- pulling it into one component means every one of those
// pages gets the same polish from a single place, and any future
// improvement here lifts all of them at once instead of needing 12
// separate edits.
export function PolicyPageFrame({
  title,
  srcDoc,
  onBack,
}: {
  title: string;
  srcDoc: string;
  onBack: () => void;
}) {
  const iframeRef: RefObject<HTMLIFrameElement> = useRef(null);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-white">
      <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-2.5 border-b border-gray-200 bg-white shadow-sm shrink-0">
        <img src={ballylifeLogo} alt="Ballylife" className="h-6 w-auto shrink-0" />
        <button
          onClick={onBack}
          className="group flex items-center gap-1.5 text-sm font-medium text-gray-600 hover:text-emerald-700 rounded-full pl-2.5 pr-3.5 py-1.5 hover:bg-emerald-50 transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="transition-transform group-hover:-translate-x-0.5">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          Back to shopping
        </button>
      </div>
      <iframe
        ref={iframeRef}
        title={title}
        srcDoc={srcDoc}
        className="flex-1 w-full border-0"
        style={{ minHeight: 0 }}
      />
    </div>
  );
}
