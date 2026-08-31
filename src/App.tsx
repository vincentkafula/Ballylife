import { Suspense, lazy } from "react";
import { Toaster } from "sonner";
import { ErrorBoundary } from "./components/ErrorBoundary";

const VinkMarketplace = lazy(() =>
  import("./components/VinkMarketplace").then((m) => ({ default: m.VinkMarketplace }))
);

/**
 * Standalone entry shell for the marketplace — previously mounted deep
 * inside VINK-GRUP-LIMITED's App.tsx behind ~20 state flags shared with
 * the banking/fleet/MVNO parts of that app. Here the marketplace *is*
 * the whole app: no separate landing/gate screen, no "Start Shopping"
 * step — it opens straight into the shop, which is now the home page.
 */
export default function App() {
  return (
    <>
      <ErrorBoundary label="Marketplace">
        <Suspense fallback={null}>
          <VinkMarketplace />
        </Suspense>
      </ErrorBoundary>
      <Toaster position="top-right" richColors closeButton duration={4000} />
    </>
  );
}
