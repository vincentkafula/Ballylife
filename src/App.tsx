import { useState, useCallback, Suspense, lazy } from "react";
import { Toaster } from "sonner";

const MarketplaceLandingViewer = lazy(() =>
  import("./components/MarketplaceLandingViewer").then((m) => ({ default: m.MarketplaceLandingViewer }))
);
const VinkMarketplace = lazy(() =>
  import("./components/VinkMarketplace").then((m) => ({ default: m.VinkMarketplace }))
);

/**
 * Standalone entry shell for the marketplace — previously mounted deep
 * inside VINK-GRUP-LIMITED's App.tsx behind ~20 state flags shared with
 * the banking/fleet/MVNO parts of that app. Here the marketplace *is*
 * the whole app: it opens straight to the landing view, "Shop"/"Sell"
 * open the main marketplace view, and closing it returns to landing
 * instead of to a Vink homepage that no longer exists in this deployment.
 */
export default function App() {
  const [showMarketplace, setShowMarketplace] = useState(false);
  const [initialAction, setInitialAction] = useState<"sell" | "shop" | null>(null);
  const [initialProductId, setInitialProductId] = useState<string | null>(null);

  const openShop = useCallback((productId?: string) => {
    setInitialAction(productId ? null : "shop");
    setInitialProductId(productId ?? null);
    setShowMarketplace(true);
  }, []);

  const openSell = useCallback(() => {
    setInitialAction("sell");
    setInitialProductId(null);
    setShowMarketplace(true);
  }, []);

  const closeMarketplace = useCallback(() => setShowMarketplace(false), []);

  return (
    <>
      <Suspense fallback={null}>
        <MarketplaceLandingViewer
          isOpen={!showMarketplace}
          onClose={() => { /* nothing above this to close to — landing is the home view */ }}
          onShop={openShop}
          onSell={openSell}
        />
      </Suspense>
      <Suspense fallback={null}>
        <VinkMarketplace
          isOpen={showMarketplace}
          onClose={closeMarketplace}
          initialAction={initialAction}
          initialProductId={initialProductId}
        />
      </Suspense>
      <Toaster position="top-right" richColors closeButton duration={4000} />
    </>
  );
}
