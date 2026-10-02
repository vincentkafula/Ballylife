import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/index.css";
import App from "./App";
import { initCurrency } from "./services/currencyStore";
import { registerSW } from "virtual:pwa-register";

// The site works offline through a service worker, which used to keep
// showing the previous release until the visit after a deploy. Now: check
// for a new release when the page opens and whenever its tab comes back
// into view; when one is found it installs and the page reloads into it
// (autoUpdate). Checks only happen on open/return -- never in the middle
// of someone typing at checkout.
const updateSW = registerSW({
  immediate: true,
  onRegisteredSW(_url, registration) {
    if (!registration) return;
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void registration.update().catch(() => undefined);
    });
  },
});
void updateSW;

// After every deployment, this build's chunk files get replaced with new
// ones under new hashed filenames. Anyone who already had the site open
// from before the deploy is still running the old index.html, so the
// moment they navigate to a lazy-loaded section, the browser 404s trying
// to fetch a file that no longer exists. Vite dispatches a
// "vite:preloadError" event for exactly this failure mode; reloading
// once re-fetches the current index.html and fixes it. Guarded with
// sessionStorage so a genuine, unrelated network outage doesn't loop.
window.addEventListener("vite:preloadError", () => {
  const key = "vink-marketplace-reloaded-after-preload-error";
  if (sessionStorage.getItem(key)) return;
  sessionStorage.setItem(key, "1");
  window.location.reload();
});

const root = document.getElementById("root");
if (!root) throw new Error("No #root element found in index.html");

initCurrency();

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);
