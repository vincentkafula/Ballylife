/**
 * Pure pricing/tax/duty/settlement math, extracted out of the route
 * handlers so it can actually be unit tested — previously this exact
 * logic was duplicated inline in POST /orders and
 * POST /admin/customs-records/generate, which is how the currency-mixing
 * bug (raw foreign-currency cost multiplied by a duty rate with no FX
 * conversion) went unnoticed for a while: the same mistake had to be
 * independently caught and fixed in two places. Having one tested
 * source of truth for this math is the actual fix, not just the
 * individual bug fix that prompted it.
 *
 * Every function here is pure (no DB, no I/O) — inputs in, a number out,
 * nothing else. Route handlers fetch the DB rows (tax rates, duty rates,
 * FX rates) and call these to do the arithmetic.
 */

export function round2(n: number): number {
  return +n.toFixed(2);
}

/** Domestic VAT on the order subtotal — applies regardless of fulfilment type. */
export function calculateVat(subtotal: number, vatRatePct: number): number {
  return round2(subtotal * (vatRatePct / 100));
}

/**
 * Converts an amount from a foreign currency into ZAR using a rate map
 * (currency -> ZAR per unit). Returns null — not a silently-wrong number
 * — when no rate is on file for that currency, so a missing rate is a
 * visible gap for the caller to handle (skip + log, reject, etc.), never
 * a currency mismatch masquerading as a real figure.
 */
export function convertToZar(amount: number, currency: string | null | undefined, fxRates: Map<string, number> | Record<string, number>): number | null {
  if (!currency) return null;
  const rate = fxRates instanceof Map ? fxRates.get(currency) : fxRates[currency];
  if (rate === undefined || rate === null) return null;
  return amount * rate;
}

/** Import duty as a percentage of the ZAR-converted customs value. */
export function calculatePercentageDuty(costPriceForeign: number, quantity: number, fxRateToZar: number, dutyRatePct: number): number {
  return costPriceForeign * fxRateToZar * quantity * (dutyRatePct / 100);
}

/** Zambia's ZRA flat specific-duty schedule — a fixed kwacha amount per unit, not a percentage. */
export function calculateZmVehicleDuty(dutyKwacha: number, carbonSurtaxKwacha: number, quantity: number, kwachaToZarRate: number): number {
  return (dutyKwacha + carbonSurtaxKwacha) * quantity * kwachaToZarRate;
}

/** Ballylife's cut of a sale — the seller's own commission rate, applied to the gross line amount. */
export function calculatePlatformFee(grossAmount: number, commissionPct: number): number {
  return round2(grossAmount * (commissionPct / 100));
}

/** What's left for the seller after the platform fee and (for an imported line) the supplier's ZAR-converted cost. */
export function calculateSellerPayout(grossAmount: number, platformFeeAmount: number, supplierCostAmountZar: number | null): number {
  return round2(grossAmount - platformFeeAmount - (supplierCostAmountZar ?? 0));
}

/**
 * Zambia's flat vehicle duty only applies to used vehicles 2+ years old,
 * and never to hybrids/EVs (which fall through to the ordinary
 * percentage method regardless of age, per ZRA's own rule). Returns the
 * matching age band, or null if this vehicle doesn't qualify for the
 * flat schedule at all.
 */
export function zmVehicleAgeBand(vehicleYear: number, fuelType: string | null | undefined, currentYear: number): "2_to_5" | "5_plus" | null {
  if (fuelType === "hybrid" || fuelType === "electric") return null;
  const ageYears = currentYear - vehicleYear;
  if (ageYears >= 5) return "5_plus";
  if (ageYears >= 2) return "2_to_5";
  return null;
}
