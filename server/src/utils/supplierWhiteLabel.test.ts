import { describe, it, expect } from "vitest";
import { isSupplierImageUrl, publicImages, scrubSupplierBranding, splitSupplierDescription, parseSupplierImageList, dedupeImages } from "./supplierWhiteLabel";

describe("isSupplierImageUrl (also the media proxy's SSRF allowlist)", () => {
  it("accepts CJ and 1688 CDN hosts", () => {
    expect(isSupplierImageUrl("https://cf.cjdropshipping.com/a.jpg")).toBe(true);
    expect(isSupplierImageUrl("https://cc-west-usa.oss-us-west-1.aliyuncs.com/a.jpg")).toBe(true);
    expect(isSupplierImageUrl("https://cbu01.alicdn.com/img/a.jpg")).toBe(true);
  });
  it("rejects everything else, including look-alike hosts and internal addresses", () => {
    expect(isSupplierImageUrl("https://cjdropshipping.com.evil.example/a.jpg")).toBe(false);
    expect(isSupplierImageUrl("http://169.254.169.254/latest/meta-data")).toBe(false);
    expect(isSupplierImageUrl("file:///etc/passwd")).toBe(false);
    expect(isSupplierImageUrl("#1a1a2e")).toBe(false);
  });
});

describe("publicImages", () => {
  it("rewrites only supplier URLs, by position, and leaves colours and other URLs alone", () => {
    expect(publicImages("p", "id-1", ["https://cf.cjdropshipping.com/a.jpg", "#123456", "https://example.com/own.jpg"]))
      .toEqual(["/api/marketplace/media/p/id-1/0", "#123456", "https://example.com/own.jpg"]);
  });
});

describe("branding scrub", () => {
  it("removes supplier names from product titles", () => {
    expect(scrubSupplierBranding("CJ Wireless Earbuds (1688)")).toBe("Wireless Earbuds");
    expect(scrubSupplierBranding("Smart Watch - CJdropshipping")).toBe("Smart Watch");
  });
  it("drops description sentences that mention a supplier and keeps the rest", () => {
    const { text, imageUrls } = splitSupplierDescription(
      `<p>Waterproof to 50m. Ships in CJ packaging.</p><p>Battery lasts 7 days.</p><img src="//cf.cjdropshipping.com/d.jpg"><p>Wholesale on 1688.com</p>`
    );
    expect(text).toBe("Waterproof to 50m.\nBattery lasts 7 days.");
    expect(imageUrls).toEqual(["https://cf.cjdropshipping.com/d.jpg"]);
  });
});

describe("image list parsing", () => {
  it("handles CJ's array, JSON-string and comma-list forms", () => {
    expect(parseSupplierImageList(["https://a/1.jpg"])).toEqual(["https://a/1.jpg"]);
    expect(parseSupplierImageList('["https://a/1.jpg","https://a/2.jpg"]')).toEqual(["https://a/1.jpg", "https://a/2.jpg"]);
    expect(parseSupplierImageList("https://a/1.jpg, https://a/2.jpg")).toEqual(["https://a/1.jpg", "https://a/2.jpg"]);
    expect(parseSupplierImageList(undefined)).toEqual([]);
  });
  it("dedupes ignoring query strings", () => {
    expect(dedupeImages(["https://a/1.jpg?x=1", "https://a/1.jpg", "https://a/2.jpg"])).toEqual(["https://a/1.jpg?x=1", "https://a/2.jpg"]);
  });
});
