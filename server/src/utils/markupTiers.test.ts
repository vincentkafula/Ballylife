import { describe, it, expect } from "vitest";
import { parseMarkupTiers, priceWithMarkup, markupPctFor, DEFAULT_MARKUP_TIERS } from "./markupTiers";

describe("markup: current default (flat 25%)", () => {
  const tiers = parseMarkupTiers(DEFAULT_MARKUP_TIERS);

  it("applies 25% at every price point -- the whole point of a flat rate", () => {
    expect(DEFAULT_MARKUP_TIERS).toBe("*:25");
    for (const landed of [50, 100, 300, 800, 2000, 10000]) {
      expect(markupPctFor(landed, tiers)).toBe(25);
    }
  });

  it("rounds the marked-up price up to the next whole rand", () => {
    expect(priceWithMarkup(100, tiers)).toBe(125);
    expect(priceWithMarkup(151, tiers)).toBe(189); // 151 * 1.25 = 188.75 -> 189
  });

  it("falls back to the current default on nonsense input", () => {
    expect(parseMarkupTiers("garbage")).toEqual(tiers);
  });
});

describe("markup: sliding-scale mode is still fully supported, just not the default", () => {
  // Explicit example tiers, not DEFAULT_MARKUP_TIERS -- this is testing
  // the sliding-scale CAPABILITY itself (still real, still used if
  // HOUSE_MARKUP_TIERS is set to multiple tiers), independent of
  // whichever single value happens to be the current flat default.
  const tiers = parseMarkupTiers("150:40,400:30,1000:25,*:20");

  it.each([[100, 40, 140], [300, 30, 390], [800, 25, 1000], [2000, 20, 2400]])(
    "R%s landed -> +%s%% -> R%s", (landed, pct, price) => {
      expect(markupPctFor(landed, tiers)).toBe(pct);
      expect(priceWithMarkup(landed, tiers)).toBe(price);
    }
  );

  it("never prices a costlier item below one just under a tier boundary", () => {
    expect(priceWithMarkup(150, tiers)).toBe(210);
    expect(priceWithMarkup(151, tiers)).toBe(210); // 151 x 1.3 = 196.3 would undercut R210
    let last = 0;
    for (let landed = 1; landed <= 3000; landed += 0.5) {
      const p = priceWithMarkup(landed, tiers);
      expect(p).toBeGreaterThanOrEqual(last);
      last = p;
    }
  });

  it("a single explicit tier gives a flat rate at any percentage requested", () => {
    expect(priceWithMarkup(100, parseMarkupTiers("*:35"))).toBe(135);
  });
});
