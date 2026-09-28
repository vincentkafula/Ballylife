/**
 * CJdropshipping adapter -- wraps the existing official CJ API client.
 * CJ is also how Ballylife reaches 1688: CJ sources 1688 products and ships
 * them, under CJ's own supplier agreements, so no 1688 scraping is involved.
 *
 * CJ meters its API in "points"; the client paces catalog calls itself and
 * raises CjPointsError when the budget is used up (treated as "try later").
 */
import { isCjConfigured, listCjProducts, getCjProductDetail, calculateCjFreight } from "../../cjDropshippingClient";
import { parseSupplierImageList, splitSupplierDescription, dedupeImages, isPhotoUrl } from "../../../utils/supplierWhiteLabel";
import { cleanProductName } from "../../../utils/productNaming";
import { englishLines } from "../../../utils/englishOnly";
import { AdapterUnsupportedError, type SupplierAdapter } from "../types";

function dayRange(aging: string | undefined): [number | null, number | null] {
  const n = String(aging ?? "").match(/\d+/g)?.map(Number) ?? [];
  return n.length ? [Math.min(...n), Math.max(...n)] : [null, null];
}

export const cjAdapter: SupplierAdapter = {
  key: "cj",
  // CJ points: roughly 1 per list/detail call; recorded so spend can be compared with revenue.
  costPerCall: { search: 0, getProduct: 0, getShipping: 0 },
  isConfigured: () => isCjConfigured(),

  async search(q) {
    const r = await listCjProducts({ productNameEn: q.keyword, pageNum: q.page ?? 1, pageSize: 20 });
    return (r.list ?? []).map(p => ({
      externalId: String(p.pid),
      title: cleanProductName(p.productNameEn || p.productName) || "",
      cost: Number(p.sellPrice) || 0, currency: "USD",
      image: [p.productImage].find(isPhotoUrl) ?? parseSupplierImageList(p.productImage)[0] ?? null,
      orders: null, rating: null,
    })).filter(h => h.title && h.cost > 0);
  },

  async getProduct(externalId) {
    const d = await getCjProductDetail(externalId);
    const desc = splitSupplierDescription(d.description);
    const images = dedupeImages([...parseSupplierImageList(d.productImageSet), ...parseSupplierImageList(d.productImage), ...desc.imageUrls]);
    const variants = (d.variants ?? []).map(v => ({
      externalSku: String(v.vid),
      label: String(v.variantNameEn || v.variantKey || v.variantSku || "Default"),
      cost: Number(v.variantSellPrice) || Number(d.sellPrice) || 0,
      stock: (v.inventories ?? []).reduce((n, i) => n + Number(i.totalInventory ?? 0), 0),
      ...(v.variantImage && isPhotoUrl(v.variantImage) ? { image: v.variantImage } : {}),
    }));
    return {
      externalId,
      title: cleanProductName(d.productNameEn || d.productName) || "",
      description: englishLines(desc.text).slice(0, 4000),
      images, currency: "USD",
      variants: variants.length ? variants : [{ externalSku: externalId, label: "Default", cost: Number(d.sellPrice) || 0, stock: 0 }],
      category: d.categoryName ?? null,
      available: true,
    };
  },

  async getShipping(externalId, externalSku) {
    const vid = externalSku && externalSku !== externalId ? externalSku : null;
    if (!vid) return null; // CJ quotes freight per variant
    const options = await calculateCjFreight({ startCountryCode: "CN", endCountryCode: "ZA", products: [{ vid, quantity: 1 }] });
    const best = [...options].sort((a, b) => Number(a.logisticPrice) - Number(b.logisticPrice))[0];
    if (!best) return null;
    const [minDays, maxDays] = dayRange(best.logisticAging);
    return { cost: Number(best.logisticPrice), currency: "USD", minDays, maxDays };
  },

  async placeOrder() { throw new AdapterUnsupportedError("CJ orders are placed by the CJ fulfilment worker (adapter routing arrives in Phase 4)."); },
  async trackOrder() { throw new AdapterUnsupportedError("CJ tracking is synced by the CJ fulfilment worker (adapter routing arrives in Phase 4)."); },
};
