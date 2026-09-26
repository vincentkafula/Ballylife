import { pool } from "../db/pool";
import { logger } from "../utils/logger";
import { repriceHouseListings } from "./cjCatalog";

/**
 * Keeps mkt_fx_rates current. Every catalogue price is in ZAR, and these
 * rates drive both what shoppers see in their own currency and what CJ's
 * USD costs convert to when products are priced -- a stale USD rate means
 * every CJ product is mispriced.
 *
 * Source: ExchangeRate-API's open endpoint (no key; updates daily;
 * attribution shown in the storefront's currency popover). Only
 * currencies already in mkt_fx_rates are updated, and any move bigger than
 * MAX_JUMP is rejected as bad data rather than applied.
 */

const FX_URL = process.env.FX_RATES_URL || "https://open.er-api.com/v6/latest/ZAR";
const REFRESH_MS = 12 * 60 * 60 * 1000;
const MAX_JUMP = 3; // a currency moving more than 3x in one refresh is almost certainly bad data
const REPRICE_THRESHOLD = 0.005; // re-price listings when USD moves by more than 0.5%

export interface FxRefreshResult { updated: number; rejected: string[]; usdToZar: number | null; repriced: number }

export async function refreshFxRates(): Promise<FxRefreshResult> {
  const res = await fetch(FX_URL, { signal: AbortSignal.timeout(15_000) });
  const json = (await res.json().catch(() => null)) as { result?: string; base_code?: string; rates?: Record<string, number> } | null;
  if (!res.ok || json?.result !== "success" || json.base_code !== "ZAR" || !json.rates) {
    throw new Error(`FX source returned an unusable response (${res.status})`);
  }

  const { rows } = await pool!.query(`SELECT currency, rate_to_zar FROM mkt_fx_rates`);
  const before = new Map(rows.map((r: { currency: string; rate_to_zar: string }) => [r.currency, Number(r.rate_to_zar)]));
  let updated = 0;
  const rejected: string[] = [];

  for (const [currency, oldRateToZar] of before) {
    if (currency === "ZAR") continue;
    const perZar = json.rates[currency]; // units of `currency` per 1 ZAR
    if (!(typeof perZar === "number" && perZar > 0)) continue;
    const rateToZar = 1 / perZar;
    if (oldRateToZar > 0 && (rateToZar / oldRateToZar > MAX_JUMP || oldRateToZar / rateToZar > MAX_JUMP)) {
      rejected.push(currency);
      continue;
    }
    await pool!.query(`UPDATE mkt_fx_rates SET rate_to_zar = $1, updated_at = now() WHERE currency = $2`, [rateToZar, currency]);
    updated++;
  }

  const oldUsd = before.get("USD") ?? null;
  const usdPerZar = json.rates.USD;
  const usdToZar = typeof usdPerZar === "number" && usdPerZar > 0 && !rejected.includes("USD") ? 1 / usdPerZar : null;
  let repriced = 0;
  if (usdToZar && oldUsd && Math.abs(usdToZar - oldUsd) / oldUsd > REPRICE_THRESHOLD) {
    repriced = await repriceHouseListings(usdToZar);
  }

  logger.info("fx.rates_refreshed", { updated, rejected, usdToZar, previousUsdToZar: oldUsd, repriced });
  if (rejected.length) logger.warn("fx.rates_rejected", { currencies: rejected });
  return { updated, rejected, usdToZar, repriced };
}

export function startFxRefreshWorker(): NodeJS.Timeout | null {
  if (/^(0|false|off|no)$/i.test(process.env.FX_AUTO_UPDATE ?? "")) return null;
  const run = () => refreshFxRates().catch(err => logger.error("fx.refresh_failed", { error: err instanceof Error ? err.message : String(err) }));
  setTimeout(run, 10_000).unref();
  const timer = setInterval(run, REFRESH_MS);
  timer.unref();
  return timer;
}
