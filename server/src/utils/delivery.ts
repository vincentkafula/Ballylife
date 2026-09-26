/**
 * Delivery promises. Supplier-fulfilled ("international") products ship
 * from the supplier's warehouse straight to the customer: their listing
 * price already includes that shipping, and they take longer than items a
 * local seller dispatches. Local items keep the flat local delivery fee
 * (see cart.ts) and the original 3-5 business day promise.
 */

export const INTERNATIONAL_DELIVERY_DAYS = {
  min: Number(process.env.INTERNATIONAL_DELIVERY_MIN_BUSINESS_DAYS ?? 10),
  max: Number(process.env.INTERNATIONAL_DELIVERY_MAX_BUSINESS_DAYS ?? 20),
};
export const LOCAL_DELIVERY_DAYS = { min: 3, max: 5 };

// Japan used parts: bought in Japan once ordered, then forwarded -- slower
// than supplier dropship. Admin-editable (Japan Parts settings), so kept in
// memory and refreshed whenever those settings are loaded or saved.
export const JAPAN_IMPORT_DELIVERY_DAYS = { min: 15, max: 30 };
export function setJapanImportDeliveryDays(days: { min: number; max: number }): void {
  JAPAN_IMPORT_DELIVERY_DAYS.min = days.min;
  JAPAN_IMPORT_DELIVERY_DAYS.max = days.max;
}

export type DeliveryProfile = "local" | "international" | "japan_import";

export function deliveryInfo(profile: string | null | undefined) {
  if (profile === "japan_import") {
    return { deliveryProfile: "japan_import" as DeliveryProfile, shippingIncluded: true, deliveryDays: { ...JAPAN_IMPORT_DELIVERY_DAYS } };
  }
  const international = profile === "international";
  return {
    deliveryProfile: (international ? "international" : "local") as DeliveryProfile,
    shippingIncluded: international,
    deliveryDays: international ? INTERNATIONAL_DELIVERY_DAYS : LOCAL_DELIVERY_DAYS,
  };
}

/** `days` business days (Mon-Fri) after `from`. */
export function addBusinessDays(from: Date, days: number): Date {
  const d = new Date(from);
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return d;
}

/** Calendar days from `from` until `days` business days have passed. */
export function calendarDaysForBusinessDays(from: Date, days: number): number {
  return Math.round((addBusinessDays(from, days).getTime() - from.getTime()) / 86400_000);
}
