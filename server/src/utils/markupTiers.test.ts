import { describe, it, expect } from "vitest";
import { parseMarkupTiers, priceWithMarkup, markupPctFor, DEFAULT_MARKUP_TIERS } from "./markupTiers";

describe("sliding markup", () => {
  const tiers = parseMarkupTiers(DEFAULT_MARKUP_TIERS);

  it.each([[100, 40, 140], [300, 30, 390], [800, 25, 1000], [2000, 20, 2400]])("R%s landed -> +%s%% -> R%s", (landed, pct, price) => {
    expect(markupPctFor(landed, tiers)).toBe(pct);
    expect(priceWithMarkup(landed, tiers)).toBe(price);
  });

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

  it("accepts a flat rate and falls back to the defaults on nonsense", () => {
    expect(priceWithMarkup(100, parseMarkupTiers("*:35"))).toBe(135);
    expect(parseMarkupTiers("garbage")).toEqual(tiers);
  });
});
