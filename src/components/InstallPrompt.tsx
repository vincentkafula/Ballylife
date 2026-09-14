import { useEffect, useState } from "react";
import { X, Download } from "lucide-react";
import ballylifeLogo from "../imports/ballylife-logo-compact.png";

// Chrome/Edge/Android fire "beforeinstallprompt" when the site qualifies
// as an installable PWA (valid manifest + service worker + HTTPS) and the
// browser's own install heuristics are satisfied. Without this listener,
// installability is real but easy to miss -- it sits behind a small icon
// in the address bar most people never notice. This surfaces it directly.
// iOS Safari never fires this event (Apple doesn't support it) and only
// offers installation through Share -> Add to Home Screen, so this banner
// only ever appears on browsers that actually support the prompt.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISSED_KEY = "ballylife-install-prompt-dismissed";

export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (sessionStorage.getItem(DISMISSED_KEY)) return;
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setVisible(true);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const dismiss = () => {
    setVisible(false);
    sessionStorage.setItem(DISMISSED_KEY, "1");
  };

  const install = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    setVisible(false);
  };

  if (!visible || !deferredPrompt) return null;

  return (
    <div className="fixed bottom-3 left-3 right-3 sm:left-auto sm:right-4 sm:bottom-4 sm:w-80 z-[100] bg-white rounded-2xl shadow-xl border border-gray-100 p-4 flex items-center gap-3">
      <img src={ballylifeLogo} alt="" className="w-11 h-11 rounded-xl shrink-0 object-cover" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-gray-900">Install Ballylife</p>
        <p className="text-xs text-gray-500">Add it to your home screen for quick access</p>
      </div>
      <button onClick={install} className="shrink-0 flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-3.5 py-2 rounded-full transition-colors">
        <Download className="w-3.5 h-3.5" /> Install
      </button>
      <button onClick={dismiss} aria-label="Dismiss" className="shrink-0 text-gray-300 hover:text-gray-500 transition-colors">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
