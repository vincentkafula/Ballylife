import { describe, it, expect } from "vitest";
import { cleanProductName, cleanDescriptionText } from "./productNaming";

describe("cleanProductName", () => {
  it.each([
    ["Cross-border European And American Women's Casual Top, V-neck Half-zip Lace Splicing Lantern Long-sleeve Loose Shirt, New Style",
      "Women's Casual Top, V-neck Half-zip Lace Splicing Lantern Long-sleeve Loose Shirt"],
    ["2026 Amazon Cross-Border Foreign Trade Autumn Women's Clothing Vintage Distressed Print Lantern Long Sleeve Casual Top",
      "Autumn Women's Clothing Vintage Distressed Print Lantern Long Sleeve Casual Top"],
    ["Cross-border Hot-Selling 66-in-1 Ratchet Screwdriver Set S2 Steel Bits Multifunctional Phone Repair Hardware Tool",
      "66-in-1 Ratchet Screwdriver Set S2 Steel Bits Multifunctional Phone Repair Hardware Tool"],
    ["Bamboo Fiber Onesie European And American Style For Infants And Toddlers", "Bamboo Fiber Onesie For Infants And Toddlers"],
    ["Applicable To Mix3 Display Connection Cable Red And Black Cable Factory Direct Sales", "Mix3 Display Connection Cable Red And Black Cable"],
    ["Suitable For MacBook Customizable Painted Hard Shell", "MacBook Customizable Painted Hard Shell"],
    ["USB wireless network card", "USB Wireless Network Card"],
    ["CJ Wireless Earbuds", "Wireless Earbuds"],
  ])("%s", (raw, expected) => {
    expect(cleanProductName(raw)).toBe(expected);
  });

  it("names no other marketplace and no trade jargon", () => {
    const out = cleanProductName("Amazon Exclusive Wholesale In Stock Best-selling Temu Hot Sale Yoga Mat Factory Stock Available");
    expect(out).toBe("Yoga Mat");
  });

  it("trims keyword run-ons without ending mid-phrase", () => {
    const out = cleanProductName("KP-871 Best-selling Wireless Bluetooth Speaker Portable Handle RGB Lighting Long Battery Life High Sound Quality Factory Stock Available");
    expect(out.length).toBeLessThanOrEqual(90);
    expect(out).toMatch(/^KP-871 Wireless Bluetooth Speaker/);
    expect(out).not.toMatch(/\b(?:High|And|With|For)$/);
  });

  it("keeps a name intact when there's nothing to clean", () => {
    expect(cleanProductName("Stainless Steel Skull Keychain")).toBe("Stainless Steel Skull Keychain");
  });
});

describe("cleanDescriptionText", () => {
  it("drops marketplace jargon but keeps the specs", () => {
    expect(cleanDescriptionText("Cross-border hot selling item.\nSize: 20 x 30 cm\nAmazon best-selling design"))
      .toBe("item.\nSize: 20 x 30 cm\ndesign");
  });
});
