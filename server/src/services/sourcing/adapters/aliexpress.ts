/**
 * AliExpress adapter -- wraps the existing, official AliExpress Drop Shipping
 * API integration (aliexpressClient / aliexpressCatalog). Needs the
 * AliExpress account connected (Manager dashboard -> AliExpress).
 *
 * Orders (placeOrder / trackOrder) keep going through the existing
 * aliexpressFulfillment worker until Phase 4 routes them via adapters.
 */
import { isAliExpressConfigured, connectionStatus } from "../../aliexpressClient";
import { searchAe, fetchAeProduct, cheapestShipping, ensureAeSupplier, AE_SUPPLIER_ID, AE_SOURCE } from "../../aliexpressCatalog";
import { AdapterUnsupportedError, type SupplierAdapter } from "../types";
import { loadFxRates } from "../fx";

/** "7-15" / "15" -> [7, 15] */
function dayRange(days: string | null): [number | null, number | null] {
  const n = String(days ?? "").match(/\d+/g)?.map(Number) ?? [];
  return n.length ? [Math.min(...n), Math.max(...n)] : [null, null];
}

export const aliexpressAdapter: SupplierAdapter = {
  key: "aliexpress",
  catalogue: { supplierId: AE_SUPPLIER_ID, source: AE_SOURCE, ensureSupplier: ensureAeSupplier },
  costPerCall: { search: 0, getProduct: 0, getShipping: 0 }, // the DS API is free; calls are rate-limited, so they're still counted
  async isConfigured() {
    if (!isAliExpressConfigured()) return false;
    try { return (await connectionStatus()).connected; } catch { return false; }
  },

  async search(q) {
    const hits = await searchAe(q.keyword, q.page ?? 1);
    return hits.map(h => ({
      externalId: h.productId, title: h.title, cost: h.priceUsd ?? 0, currency: "USD",
      image: h.image, orders: h.orders,
      rating: h.rating ? Math.round(Number(String(h.rating).replace("%", "")) / 20 * 10) / 10 || null : null, // "96.5%" -> 4.8
    })).filter(h => h.cost > 0);
  },

  async getProduct(externalId) {
    const p = await fetchAeProduct(externalId);
    return {
      externalId, title: p.title, description: p.description, images: p.images, currency: "USD",
      variants: p.variants.map(v => ({ externalSku: v.skuId, orderRef: v.skuAttr, label: v.label, cost: v.priceUsd, stock: v.stock, ...(v.image ? { image: v.image } : {}) })),
      category: p.categoryId, available: p.available,
    };
  },

  async getShipping(externalId, externalSku) {
    const best = await cheapestShipping(externalId, externalSku, await loadFxRates());
    if (!best) return null;
    const [minDays, maxDays] = dayRange(best.days);
    return { cost: best.usd, currency: "USD", minDays, maxDays };
  },

  async placeOrder() { throw new AdapterUnsupportedError("AliExpress orders are placed by the AliExpress fulfilment worker (adapter routing arrives in Phase 4)."); },
  async trackOrder() { throw new AdapterUnsupportedError("AliExpress tracking is synced by the AliExpress fulfilment worker (adapter routing arrives in Phase 4)."); },
};
