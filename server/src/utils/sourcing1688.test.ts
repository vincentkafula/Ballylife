import { describe, it, expect } from "vitest";
import { parse1688Item, parse1688Run, estimate1688, normalise1688Settings, actorInput, classFor, DEFAULT_1688_SETTINGS } from "./sourcing1688";

const ROW = {
  offerId: "617247852601", title: "Wireless Bluetooth Earphones TWS", url: "https://detail.1688.com/offer/617247852601.html",
  priceCny: 25.5, priceRangeCny: "25.50-32.00", minOrderQuantity: 2, unit: "pair", stock: 5000, isOutOfStock: false,
  soldCount: "1.2万+", repurchaseRate: 38, starLevel: 4.5, supplierName: "Shenzhen Audio Co.", supplierType: "superFactory",
  supplierYearsOnPlatform: 8, locationCn: "广东 深圳", categoryPath: ["数码", "耳机"], images: ["https://cbu01.alicdn.com/img/a.jpg"],
  totalVariants: 6, supportsDropship: true, deliveryLimitDays: 2, sourceKeyword: "bluetooth earphone",
};

describe("parse1688Item", () => {
  it("maps a search row", () => {
    expect(parse1688Item(ROW)).toMatchObject({
      offerId: "617247852601", priceCny: 25.5, moq: 2, soldCount: 12000, supplierYears: 8, location: "广东 深圳",
      categoryPath: "数码 > 耳机", images: ["https://cbu01.alicdn.com/img/a.jpg"], supportsDropship: true, sourceKeyword: "bluetooth earphone",
    });
  });

  it("falls back to the low end of the price range", () => {
    expect(parse1688Item({ ...ROW, priceCny: undefined })!.priceCny).toBe(25.5);
  });

  it("ignores rows that aren't products", () => {
    expect(parse1688Item({ reviewId: "r1", text: "good" })).toBeNull();
  });
});

describe("parse1688Run", () => {
  it("drops products that may not be listed, and flags unreadable output", () => {
    const r = parse1688Run([ROW, { ...ROW, offerId: "2", title: "Adult toy" }, { foo: 1 }, { foo: 2 }, { foo: 3 }]);
    expect(r.offers).toHaveLength(1);
    expect(r.excluded).toBe(1);
    expect(r.schemaSuspect).toBe(true);
  });
});

describe("estimate1688", () => {
  // Without the China-side costs, so the duty/VAT arithmetic is easy to follow.
  const s = normalise1688Settings({ ...DEFAULT_1688_SETTINGS, estimate: { ...DEFAULT_1688_SETTINGS.estimate, agentFeePct: 0, domesticShippingCny: 0 } });

  it("works out landed cost and resale price with the class's duty and freight", () => {
    // ¥25.50 x R2.50 = R63.75; electronics: freight R150, duty 15%
    const e = estimate1688(25.5, "electronics", 2.5, 18, s);
    expect(e.unitZar).toBe(63.75);
    expect(e.dutyZar).toBe(32.06);        // 15% x (63.75 + 150)
    expect(e.importVatZar).toBe(15.33);   // 15% x (63.75 x 1.1 + 32.06)
    expect(e.landedZar).toBe(261.14);
    expect(e.resaleZar).toBe(392);        // ceil(261.14 x 1.5)
    expect(e.unitUsd).toBe(3.54);
  });

  it("adds the China buying agent fee and domestic shipping to the unit cost", () => {
    const withAgent = normalise1688Settings(DEFAULT_1688_SETTINGS); // 5% agent fee, ¥10 China shipping
    expect(estimate1688(25.5, "electronics", 2.5, 18, withAgent).unitZar).toBe(93.19); // (25.5 + 10) x 2.5 x 1.05
    expect(estimate1688(25.5, "electronics", 2.5, 18, withAgent).unitUsd).toBe(3.54); // CJ target stays the bare goods price
  });

  it("charges apparel the 45% clothing duty", () => {
    expect(estimate1688(40, "apparel", 2.5, 18, s).dutyZar).toBe(99);  // 45% x (100 + 120)
  });
});

describe("settings", () => {
  it("start off, with the 5-years-on-1688 supplier filter and single-unit offers", () => {
    const s = normalise1688Settings(undefined);
    expect(s.enabled).toBe(false);
    expect(s.filters.supplierYears).toBe("5");
    expect(s.filters.maxMoq).toBe(1);
    expect(s.listing).toMatchObject({ autoList: true, maxMoq: 1, autoSendToCj: true });
  });

  it("build one actor run for all enabled keywords", () => {
    const s = normalise1688Settings({ ...DEFAULT_1688_SETTINGS, maxItemsPerKeyword: 10, keywords: [
      { keyword: "a", productClass: "auto", enabled: true }, { keyword: "b", productClass: "auto", enabled: false }, { keyword: "c", productClass: "auto", enabled: true },
    ], filters: { ...DEFAULT_1688_SETTINGS.filters, maxMoq: 3 } });
    expect(actorInput(s)).toMatchObject({ mode: "search", keywords: ["a", "c"], maxItems: 20, supplierYears: "5", minOrderQuantity: 3, includeSkuDetails: true }); // options are needed to list multi-option finds
  });

  it("infer a product class from the title when the keyword doesn't set one", () => {
    expect(classFor("Women's Summer Floral Dress", "auto")).toBe("apparel");
    expect(classFor("Women's Summer Floral Dress", "home")).toBe("home");
  });
});

describe("parse1688Item variants", () => {
  it("reads the SKU matrix", () => {
    const o = parse1688Item({ ...ROW, variants: [
      { skuId: "s1", skuSpec: "Color:Black;Size:M", price: 25.5, stock: 100, image: "//cbu01.alicdn.com/b.jpg" },
      { skuId: "s2", specs: { Color: "White", Size: "L" }, discountPrice: "28.00", stock: 0 },
      { price: 1 },
    ] })!;
    expect(o.variants).toEqual([
      { skuId: "s1", label: "Color:Black / Size:M", priceCny: 25.5, stock: 100, image: "https://cbu01.alicdn.com/b.jpg" },
      { skuId: "s2", label: "White / L", priceCny: 28, stock: 0, image: null },
    ]);
  });
});
