import { describe, it, expect } from "vitest";
import { recalcCartTotals } from "./cart";

describe("recalcCartTotals", () => {
  it("computes subtotal as the sum of unitPrice * quantity across items", () => {
    const totals = recalcCartTotals([{ unitPrice: 100, quantity: 2 }, { unitPrice: 50, quantity: 1 }], null);
    expect(totals.subtotal).toBe(250);
  });

  it("applies flat R99 shipping under the R500 free-shipping threshold", () => {
    const totals = recalcCartTotals([{ unitPrice: 100, quantity: 1 }], null);
    expect(totals.shipping).toBe(99);
  });

  it("gives free shipping once the subtotal exceeds R500", () => {
    const totals = recalcCartTotals([{ unitPrice: 501, quantity: 1 }], null);
    expect(totals.shipping).toBe(0);
  });

  it("gives no shipping charge for an empty cart", () => {
    const totals = recalcCartTotals([], null);
    expect(totals.shipping).toBe(0);
  });

  it("estimates VAT at a flat 15% of subtotal (the real rate is recomputed later once the address is known)", () => {
    const totals = recalcCartTotals([{ unitPrice: 1000, quantity: 1 }], null);
    expect(totals.tax).toBe(150);
  });

  it("applies a percentage coupon, capped at max_discount_amount when set", () => {
    const totals = recalcCartTotals([{ unitPrice: 1000, quantity: 1 }], { type: "percentage", value: 50, max_discount_amount: 100 });
    expect(totals.couponDiscount).toBe(100); // 50% of 1000 = 500, capped to 100
  });

  it("applies an uncapped percentage coupon when no max_discount_amount is set", () => {
    const totals = recalcCartTotals([{ unitPrice: 1000, quantity: 1 }], { type: "percentage", value: 10 });
    expect(totals.couponDiscount).toBe(100);
  });

  it("applies a fixed-amount coupon, never exceeding the subtotal", () => {
    const totals = recalcCartTotals([{ unitPrice: 50, quantity: 1 }], { type: "fixed_amount", value: 200 });
    expect(totals.couponDiscount).toBe(50); // can't discount more than the subtotal itself
  });

  it("waives shipping for a free_shipping coupon even under the R500 threshold", () => {
    const totals = recalcCartTotals([{ unitPrice: 100, quantity: 1 }], { type: "free_shipping", value: 0 });
    expect(totals.shipping).toBe(0);
  });

  it("computes total as subtotal + shipping + tax - couponDiscount", () => {
    const totals = recalcCartTotals([{ unitPrice: 100, quantity: 1 }], null);
    // subtotal 100, shipping 99 (under threshold), tax 15, discount 0
    expect(totals.total).toBe(100 + 99 + 15 - 0);
  });
});
