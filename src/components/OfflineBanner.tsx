import { useEffect, useRef } from "react";
import { WifiOff } from "lucide-react";
import { toast } from "sonner";
import { useOnlineStatus } from "../hooks/useOnlineStatus";

/**
 * A toast (sonner, already used elsewhere in this app) is right for a
 * one-off event but wrong for an ongoing state -- the user should be
 * able to glance up and still see "you're offline" a minute later, not
 * just catch a notification that already faded. This renders a fixed
 * banner for as long as isOnline is false, and fires a brief toast
 * (sonner's own auto-dismiss) when connectivity actually returns, since
 * that transition *is* a one-off event worth a lighter-weight
 * acknowledgment rather than another persistent banner.
 */
export function OfflineBanner() {
  const isOnline = useOnlineStatus();
  const wasOffline = useRef(false);

  useEffect(() => {
    if (!isOnline) {
      wasOffline.current = true;
    } else if (wasOffline.current) {
      wasOffline.current = false;
      toast.success("Back online");
    }
  }, [isOnline]);

  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-0 left-0 right-0 z-[100] flex items-center justify-center gap-2 py-2 text-xs font-semibold text-white"
      style={{ background: "#374151" }}
    >
      <WifiOff className="w-3.5 h-3.5" />
      You're offline — some pages and actions won't work until your connection is back.
    </div>
  );
}
