/** Exchange rates (to rand) from the existing FX table, for supplier prices. */
import { pool } from "../../db/pool";
import { convertToZar } from "../../utils/pricing";

export async function loadFxRates(): Promise<Map<string, number>> {
  const { rows } = await pool!.query(`SELECT currency, rate_to_zar FROM mkt_fx_rates`);
  return new Map(rows.map((r: { currency: string; rate_to_zar: string }) => [String(r.currency).toUpperCase(), Number(r.rate_to_zar)]));
}

/** Amount in rand, or null when there's no rate for that currency. */
export function toZar(amount: number, currency: string, rates: Map<string, number>): number | null {
  if (currency.toUpperCase() === "ZAR") return amount;
  return convertToZar(amount, currency, rates);
}
