import { useSyncExternalStore } from "react";

import { API_BASE as BASE } from "./config";
const STORAGE_KEY = "ballylife_country_code";

export interface CountryOption {
  countryCode: string;
  country?: string;
  code: string;   // currency code, e.g. "USD"
  symbol: string; // e.g. "$"
  name: string;   // currency name
}

const ZM_DEFAULT: CountryOption = { countryCode: "ZM", country: "Zambia", code: "ZMW", symbol: "K", name: "Zambian Kwacha" };

interface CurrencyState {
  loading: boolean;
  country: CountryOption;
  countries: CountryOption[];
  rate: number | null; // 1 ZAR = `rate` units of country.code. Every price in the catalogue is in ZAR; null = rate not known (yet)
  ratesStale: boolean;
}

// rate starts null: until the real rate for the detected currency is known,
// prices show in ZAR rather than as ZAR numbers wearing another symbol.
let state: CurrencyState = { loading: true, country: ZM_DEFAULT, countries: [ZM_DEFAULT], rate: null, ratesStale: false };
const listeners = new Set<() => void>();

function setState(patch: Partial<CurrencyState>) {
  state = { ...state, ...patch };
  listeners.forEach(fn => fn());
}

/** Plain, hook-free formatter — safe to call from anywhere (module-level
 *  consts, plain functions, deeply nested components) without prop-drilling
 *  or converting call sites. Reflects whatever currency is currently
 *  resolved; components that need to re-render when it changes should also
 *  call useCurrency()/useCurrencySubscription() once near their root. */
export function formatZAR(zarAmount: number): string {
  const n = Number(zarAmount ?? 0);
  if (state.rate === null || state.country.code === "ZAR") {
    return `R${n.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  const converted = n * state.rate;
  const decimals = ZERO_DECIMAL.has(state.country.code) ? 0 : 2;
  const formatted = converted.toLocaleString("en", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return `${state.country.symbol}${formatted}`;
}

// Currencies whose minor unit isn't used day to day.
const ZERO_DECIMAL = new Set(["JPY", "KRW", "UGX", "TZS", "RWF", "BIF", "XAF", "XOF", "KMF", "GNF", "DJF", "MGA", "NGN", "CDF", "SOS", "SLL", "IDR", "VND", "CLP", "PYG", "ISK"]);

/** True when prices are being shown in a currency other than the one customers are charged in (ZAR). */
export function isShowingConvertedPrices(): boolean {
  return state.rate !== null && state.country.code !== "ZAR";
}

export function convertZAR(zarAmount: number): number {
  return state.rate !== null ? Number(zarAmount ?? 0) * state.rate : Number(zarAmount ?? 0);
}

/** The `/api/currency/rates` table is "1 ZAR = N units" for every currency (ZAR itself = 1). */
function rateFor(code: string, rates: Record<string, number>): number | null {
  const r = rates[code];
  return typeof r === "number" && r > 0 ? r : null;
}

let initialized = false;
export async function initCurrency(): Promise<void> {
  if (initialized) return;
  initialized = true;

  fetch(`${BASE}/api/geo/countries`).then(r => r.json()).then(r => {
    if (r.success) setState({ countries: r.data });
  }).catch(() => {});

  // Resolve the country first (manual override > IP geolocation > ZA default),
  // then fetch rates using that final country code — avoids a race where the
  // rate lookup runs against whichever country happened to be set first.
  let resolvedCountry = ZM_DEFAULT;
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try { resolvedCountry = JSON.parse(saved) as CountryOption; }
    catch { /* corrupt saved value — fall through to IP detection */ }
  }
  if (resolvedCountry === ZM_DEFAULT) {
    try {
      const r = await fetch(`${BASE}/api/geo/detect`).then(res => res.json());
      if (r.success) resolvedCountry = r.data;
    } catch {
      // Silent — ZM_DEFAULT remains active
    }
  }
  setState({ country: resolvedCountry, loading: false });

  try {
    const r = await fetch(`${BASE}/api/currency/rates`).then(res => res.json());
    if (r.success) {
      const rate = rateFor(resolvedCountry.code, r.data.rates);
      setState({ rate, ratesStale: Boolean(r.stale) });
    }
  } catch { /* keep whatever rate state already had (initial default: 1) */ }
}

export function setCountryManually(countryCode: string): void {
  const match = state.countries.find(c => c.countryCode === countryCode);
  if (!match) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(match));
  setState({ country: match, rate: null });
  // Re-fetch/resolve the rate for the newly selected currency.
  fetch(`${BASE}/api/currency/rates`).then(r => r.json()).then(r => {
    if (!r.success) return;
    const rate = rateFor(match.code, r.data.rates);
    setState({ rate });
  }).catch(() => {});
}

/** Uses the browser's own Geolocation API for a real GPS/network-assisted
 *  position -- more precise than IP lookup (no VPN/proxy/corporate-network
 *  skew), at the cost of needing the user to grant permission. Resolves
 *  to true on success, false if permission was denied, the browser
 *  doesn't support geolocation, or the reverse-geocode lookup failed --
 *  callers can use that to show a fallback message rather than hanging. */
export function useLiveLocation(): Promise<boolean> {
  return new Promise(resolve => {
    if (!navigator.geolocation) { resolve(false); return; }
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const res = await fetch(`${BASE}/api/geo/reverse`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ lat: position.coords.latitude, lng: position.coords.longitude }),
          }).then(r => r.json());
          if (!res.success) { resolve(false); return; }
          const match: CountryOption = res.data;
          localStorage.setItem(STORAGE_KEY, JSON.stringify(match));
          setState({ country: match });
          const ratesRes = await fetch(`${BASE}/api/currency/rates`).then(r => r.json());
          if (ratesRes.success) {
            const rate = rateFor(match.code, ratesRes.data.rates);
            setState({ rate });
          }
          resolve(true);
        } catch {
          resolve(false);
        }
      },
      () => resolve(false), // permission denied or position unavailable
      { timeout: 10_000, maximumAge: 5 * 60_000 }
    );
  });
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function getSnapshot() { return state; }

/** Reactive hook — subscribes the calling component (and, since React
 *  re-renders subtrees by default, its children) to currency changes.
 *  Call this once near the top of a page/dashboard so prices update live
 *  once geolocation/rates resolve, without needing to thread the formatter
 *  through every sub-component as a prop. */
export function useCurrency(): CurrencyState {
  return useSyncExternalStore(subscribe, getSnapshot);
}
