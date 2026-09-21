import { useState, useEffect } from "react";

/**
 * Tracks real browser connectivity (navigator.onLine + the online/offline
 * window events), not just "did the last fetch fail" -- a failed fetch
 * could be a server error with the network perfectly fine, which isn't
 * the same thing to tell the user. This is genuinely relevant for a PWA
 * that's meant to be installed and opened without necessarily having a
 * live connection at that moment.
 *
 * navigator.onLine has a known limitation worth being honest about: it
 * reliably reports actually-offline (no network interface), but "online"
 * only means the OS thinks it has a connection, not that this specific
 * server is reachable (e.g. Wi-Fi connected but no internet, or a
 * captive portal). Good enough for "tell the user their device has no
 * network at all," not a substitute for handling a failed API call on
 * its own terms.
 */
export function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState(() => (typeof navigator !== "undefined" ? navigator.onLine : true));

  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  return isOnline;
}
