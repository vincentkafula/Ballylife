import { Suspense, lazy } from "react";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "sonner";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { InstallPrompt } from "./components/InstallPrompt";
import { OfflineBanner } from "./components/OfflineBanner";

const VinkMarketplace = lazy(() =>
  import("./components/VinkMarketplace").then((m) => ({ default: m.VinkMarketplace }))
);

/**
 * Standalone entry shell for the marketplace — previously mounted deep
 * inside VINK-GRUP-LIMITED's App.tsx behind ~20 state flags shared with
 * the banking/fleet/MVNO parts of that app. Here the marketplace *is*
 * the whole app: no separate landing/gate screen, no "Start Shopping"
 * step — it opens straight into the shop, which is now the home page.
 *
 * BrowserRouter wraps everything so VinkMarketplace can give every
 * page (home, product, catalog, static pages, etc.) a real, unique,
 * shareable URL instead of the single-URL, state-only navigation this
 * app used before -- nginx.conf already had the correct SPA fallback
 * (try_files ... /index.html) ready for this; only the app itself
 * needed to adopt real routing.
 */
export default function App() {
  return (
    <BrowserRouter>
      <OfflineBanner />
      <ErrorBoundary label="Marketplace">
        <Suspense fallback={null}>
          <VinkMarketplace />
        </Suspense>
      </ErrorBoundary>
      <Toaster position="top-right" richColors closeButton duration={4000} />
      <InstallPrompt />
    </BrowserRouter>
  );
}
