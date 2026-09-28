/**
 * Cookie banner: "Accept all" allows advertising measurement (TikTok Pixel);
 * "Essential only" keeps the site to the cookies it needs to work. Shown
 * until the visitor chooses; they can change their mind any time from the
 * Privacy Policy ("Cookie settings" re-opens this banner).
 */
import { useEffect, useState } from "react";
import { getConsent, setConsent, loadPixel } from "../services/tracking";

export const OPEN_COOKIE_SETTINGS = "bl:open-cookie-settings";

export function CookieConsent() {
  const [open, setOpen] = useState(() => getConsent() === null);

  useEffect(() => {
    if (getConsent() === "all") loadPixel(); // returning visitor who already agreed
    const reopen = () => setOpen(true);
    window.addEventListener(OPEN_COOKIE_SETTINGS, reopen);
    return () => window.removeEventListener(OPEN_COOKIE_SETTINGS, reopen);
  }, []);

  if (!open) return null;
  const choose = (v: "all" | "essential") => { setConsent(v); setOpen(false); };
  return (
    <div role="dialog" aria-label="Cookie settings"
      className="fixed bottom-20 sm:bottom-4 left-3 right-3 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 sm:w-[560px] z-[95] bg-white rounded-2xl shadow-xl border border-gray-100 p-4 text-sm">
      <p className="text-gray-700">
        🍪 We use essential cookies to run Ballylife. With your permission we also use advertising cookies (TikTok) to measure our ads and show you relevant offers.{" "}
        <a href="/privacy-policy#cookies" className="text-[#1E7B4D] underline">Privacy Policy</a>
      </p>
      <div className="flex gap-2 mt-3 justify-end">
        <button onClick={() => choose("essential")} className="px-3 py-1.5 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 font-medium">Essential only</button>
        <button onClick={() => choose("all")} className="px-3 py-1.5 rounded-lg bg-[#1E7B4D] hover:bg-[#17633D] text-white font-semibold">Accept all</button>
      </div>
    </div>
  );
}
