import { describe, it, expect } from "vitest";
import { recalcCartTotals } from "./cart";
import { addBusinessDays, calendarDaysForBusinessDays, deliveryInfo } from "./delivery";

describe("delivery fee for supplier-fulfilled items", () => {
  it("charges nothing when every item already includes delivery in its price", () => {
    expect(recalcCartTotals([{ unitPrice: 120, quantity: 1, shippingIncluded: true }], null).shipping).toBe(0);
  });

  it("charges the local fee only for local items, with the threshold measured on those alone", () => {
    // R450 local + R900 supplier-fulfilled: local part is under R500, so R99 applies.
    expect(recalcCartTotals([
      { unitPrice: 450, quantity: 1 },
      { unitPrice: 900, quantity: 1, shippingIncluded: true },
    ], null).shipping).toBe(99);
    // R600 local: over the threshold, free.
    expect(recalcCartTotals([
      { unitPrice: 600, quantity: 1 },
      { unitPrice: 50, quantity: 1, shippingIncluded: true },
    ], null).shipping).toBe(0);
  });
});

describe("business days", () => {
  it("skips weekends", () => {
    const friday = new Date("2026-09-25T10:00:00Z");
    expect(addBusinessDays(friday, 1).getUTCDay()).toBe(1); // Monday
    expect(calendarDaysForBusinessDays(friday, 20)).toBe(28); // 4 full weeks
  });

  it("describes each delivery profile", () => {
    expect(deliveryInfo("international")).toMatchObject({ shippingIncluded: true, deliveryDays: { min: 10, max: 20 } });
    expect(deliveryInfo(null)).toMatchObject({ deliveryProfile: "local", shippingIncluded: false, deliveryDays: { min: 3, max: 5 } });
  });
});
