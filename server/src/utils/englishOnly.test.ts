import { describe, it, expect } from "vitest";
import { englishOnly, englishLines, hasChinese } from "./englishOnly";
import { cleanDescriptionText, cleanProductName } from "./productNaming";

describe("englishOnly", () => {
  it.each([
    ["黑色-XL", "Black-XL"],
    ["颜色:白色;尺码:均码", "Colour: White; Size: One Size"],
    ["充电款 3个装", "Rechargeable 3-pack"],
    ["深蓝色", "Navy"],
    ["Ａ１ （户外）", "A1"],
    ["浪漫紫罗兰", "Purple"],
  ])("%s -> %s", (zh, en) => {
    const out = englishOnly(zh);
    expect(hasChinese(out)).toBe(false);
    expect(out).toBe(en);
  });
});

describe("englishLines", () => {
  it("keeps English lines and translatable ones, drops lines still in Chinese", () => {
    expect(englishLines("Material: ABS\n材质：塑料\n颜色：黑色\n首单减8元且免运费")).toBe("Material: ABS\nColour: Black");
  });
});

describe("storefront text", () => {
  it("product names lose any Chinese", () => {
    expect(cleanProductName("Led Neon 灯带 Lights（户外）")).toBe("Led Neon Lights");
  });

  it("descriptions lose marketplace badges and Chinese promo lines", () => {
    expect(cleanDescriptionText("首单减8元且免运费\nSaved by 10+ buyers\nRepurchase Rate 16%\nShips within 20h\nMaterial: ABS")).toBe("Material: ABS");
  });
});
