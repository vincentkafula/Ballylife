/**
 * Advertising measurement (TikTok Pixel), only with the visitor's consent.
 *
 * Nothing loads and nothing is sent until the visitor taps "Accept all" on
 * the cookie banner (POPIA; TikTok's terms). "Essential only" keeps it off.
 * The choice is remembered on this device and can be changed from the
 * Privacy Policy page ("Cookie settings").
 *
 * Events: ViewContent (product page), AddToCart, InitiateCheckout,
 * CompletePayment (back from PayFast). Pixel id: VITE_TIKTOK_PIXEL_ID.
 */
const PIXEL_ID = String(import.meta.env.VITE_TIKTOK_PIXEL_ID ?? "DATB0NRC77U054TKSLUG").trim();
const CONSENT_KEY = "bl_cookie_consent"; // "all" | "essential"
export const CONSENT_EVENT = "bl:consent-changed";

type Consent = "all" | "essential" | null;
type Ttq = { load: (id: string) => void; page: () => void; track: (e: string, p?: Record<string, unknown>) => void; [k: string]: unknown };
declare global { interface Window { ttq?: Ttq; TiktokAnalyticsObject?: string } }

export function getConsent(): Consent {
  try { const v = localStorage.getItem(CONSENT_KEY); return v === "all" || v === "essential" ? v : null; } catch { return null; }
}

export function setConsent(v: "all" | "essential"): void {
  try { localStorage.setItem(CONSENT_KEY, v); } catch { /* storage unavailable: the choice lasts this visit */ }
  if (v === "all") loadPixel();
  window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: v }));
  // Withdrawing consent: reload so the already-loaded pixel is gone.
  if (v === "essential" && window.ttq) window.location.reload();
}

let loaded = false;
/** TikTok's standard pixel base code, run only after consent. */
export function loadPixel(): void {
  if (loaded || !PIXEL_ID || getConsent() !== "all") return;
  loaded = true;
  const w = window as any, t = "ttq";
  w.TiktokAnalyticsObject = t;
  const ttq = w[t] = w[t] || [];
  ttq.methods = ["page", "track", "identify", "instances", "debug", "on", "off", "once", "ready", "alias", "group", "enableCookie", "disableCookie", "holdConsent", "revokeConsent", "grantConsent"];
  ttq.setAndDefer = (o: any, m: string) => { o[m] = (...args: unknown[]) => { o.push([m, ...args]); }; };
  for (const m of ttq.methods) ttq.setAndDefer(ttq, m);
  ttq.instance = (id: string) => { const e = ttq._i[id] || []; for (const m of ttq.methods) ttq.setAndDefer(e, m); return e; };
  ttq.load = (id: string, opts?: Record<string, unknown>) => {
    const src = "https://analytics.tiktok.com/i18n/pixel/events.js";
    ttq._i = ttq._i || {}; ttq._i[id] = []; ttq._i[id]._u = src;
    ttq._t = ttq._t || {}; ttq._t[id] = +new Date();
    ttq._o = ttq._o || {}; ttq._o[id] = opts || {};
    const s = document.createElement("script");
    s.type = "text/javascript"; s.async = true; s.src = `${src}?sdkid=${id}&lib=${t}`;
    const first = document.getElementsByTagName("script")[0];
    first.parentNode!.insertBefore(s, first);
  };
  ttq.load(PIXEL_ID);
  ttq.page();
}

/** Sends one event, if the visitor agreed to advertising cookies. */
export function track(event: "ViewContent" | "AddToCart" | "InitiateCheckout" | "CompletePayment", params: Record<string, unknown> = {}): void {
  if (getConsent() !== "all") return;
  loadPixel();
  try { window.ttq?.track(event, { currency: "ZAR", ...params }); } catch { /* measurement must never break the shop */ }
}

/** A product in TikTok's event format. */
export const ttProduct = (p: Record<string, unknown>, quantity = 1) => ({
  contents: [{ content_id: String(p.id), content_type: "product", content_name: String(p.name ?? ""), quantity, price: Number(p.price ?? 0) }],
  value: Number(p.price ?? 0) * quantity,
});
