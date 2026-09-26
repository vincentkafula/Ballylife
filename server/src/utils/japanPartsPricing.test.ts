import { describe, it, expect } from "vitest";
import { priceJapanPart, normaliseJapanPartsSettings, DEFAULT_JAPAN_PARTS_SETTINGS } from "./japanPartsPricing";

describe("priceJapanPart", () => {
  const s = normaliseJapanPartsSettings({ ...DEFAULT_JAPAN_PARTS_SETTINGS, markupPct: 30, forwarderFeeZar: 150, dutyPct: 20, vatPct: 15, vatUpliftPct: 10, freightByCategory: { wheels: 1800 }, defaultFreightZar: 900 });

  it("works through part, forwarding, freight, duty, import VAT and markup", () => {
    // ¥55,000 incl. tax at R0.12/¥ = R6,600
    const b = priceJapanPart(55_000, "wheels", 0.12, s);
    expect(b.partZar).toBe(6600);
    expect(b.freightZar).toBe(1800);
    expect(b.dutyZar).toBe(1680);                 // 20% x (6600 + 1800)
    expect(b.importVatZar).toBe(1341);            // 15% x (6600 x 1.1 + 1680)
    expect(b.landedZar).toBe(11571);              // 6600 + 150 + 1800 + 1680 + 1341
    expect(b.priceZar).toBe(15043);               // ceil(11571 x 1.3 = 15042.3)
  });

  it("uses the default freight for a category without its own rate", () => {
    expect(priceJapanPart(10_000, "mystery", 0.12, s).freightZar).toBe(900);
  });

  it("with no duty, VAT or markup the price is just the landed cost, rounded up", () => {
    const flat = normaliseJapanPartsSettings({ ...s, dutyPct: 0, vatPct: 0, markupPct: 0, forwarderFeeZar: 0, defaultFreightZar: 0, freightByCategory: {} });
    expect(priceJapanPart(10_000, "small", 0.12, flat).priceZar).toBe(1200);
  });
});

describe("normaliseJapanPartsSettings", () => {
  it("clamps nonsense and drops empty keywords", () => {
    const s = normaliseJapanPartsSettings({ markupPct: -5, dutyPct: 900, maxItemsPerKeyword: 10_000, keywords: [{ keyword: " ", label: "x" }, { keyword: "ホイール", label: "Wheels", partsCategory: "WHEELS" }] });
    expect(s.markupPct).toBe(0);
    expect(s.dutyPct).toBe(100);
    expect(s.maxItemsPerKeyword).toBe(200);
    expect(s.keywords).toEqual([{ keyword: "ホイール", label: "Wheels", partsCategory: "wheels", enabled: true }]);
  });

  it("starts switched off, so nothing is fetched or billed until an admin turns it on", () => {
    expect(normaliseJapanPartsSettings(undefined).enabled).toBe(false);
  });
});
