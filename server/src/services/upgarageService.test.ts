import { describe, it, expect } from "vitest";
import { parseUpgarageItem, parseUpgarageRun, parseYen } from "./upgarageService";

describe("parseYen", () => {
  it.each([["¥12,800（税込）", 12800], ["12800", 12800], [12800, 12800], ["", null], ["価格未定", null], [0, null]])("%s -> %s", (v, n) => {
    expect(parseYen(v)).toBe(n);
  });
});

describe("parseUpgarageItem", () => {
  it("maps the fields we sell on", () => {
    const p = parseUpgarageItem({
      id: "UG123", name: "RAYS VOLK TE37 17インチ", price: "¥50,000", priceTaxIncluded: "¥55,000", category: "ホイール",
      condition: "B", shopName: "UP-GARAGE 横浜店", prefecture: "神奈川県", maker: "Toyota", carModel: "86",
      images: ["https://img.upgarage.com/a.jpg", "//img.upgarage.com/b.jpg", "not a url"], url: "https://www.upgarage.com/goods/UG123",
    })!;
    expect(p).toMatchObject({
      listingId: "UG123", priceJpy: 50000, priceJpyTaxIncl: 55000, condition: "B", shop: "UP-GARAGE 横浜店", location: "神奈川県",
      fitment: "Toyota 86", soldOut: false,
    });
    expect(p.images).toEqual(["https://img.upgarage.com/a.jpg", "https://img.upgarage.com/b.jpg"]);
  });

  it("derives the tax-included price (10% consumption tax) and the id from the URL when missing", () => {
    const p = parseUpgarageItem({ title: "マフラー", price: 20000, detailUrl: "https://www.upgarage.com/goods/detail/AB9876" })!;
    expect(p.listingId).toBe("AB9876");
    expect(p.priceJpyTaxIncl).toBe(22000);
  });

  it("recognises sold-out listings", () => {
    expect(parseUpgarageItem({ id: "1", name: "x", price: 1000, status: "売り切れ" })!.soldOut).toBe(true);
  });

  it("returns null without an id or a name", () => {
    expect(parseUpgarageItem({ price: 1000 })).toBeNull();
  });
});

describe("parseUpgarageRun", () => {
  it("flags output it mostly can't read as a probable schema change", () => {
    const r = parseUpgarageRun([{ foo: 1 }, { foo: 2 }, { foo: 3 }, { id: "a", name: "b", price: 100 }]);
    expect(r.parts).toHaveLength(1);
    expect(r.schemaSuspect).toBe(true);
    expect(r.sampleKeys).toEqual(["foo"]);
  });
});
