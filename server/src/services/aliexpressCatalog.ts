/**
 * AliExpress products in the Ballylife store.
 *
 * An admin imports products (by AliExpress link / product id, or from a
 * keyword search). Each is fetched with the Drop Shipping API in English,
 * priced in USD for South Africa, given the cheapest shipping line to South
 * Africa, and listed exactly like a CJ product: same white-labelling (names
 * cleaned, photos through our media proxy), same sliding markup on landed
 * cost, delivery included. Imported products are re-checked daily so prices
 * and stock follow AliExpress.
 */
import { pool } from "../db/pool";
import { logger } from "../utils/logger";
import { callAsBuyer, AliExpressError } from "./aliexpressClient";
import { HOUSE_SELLER_ID, ensureHouseStore, listInHouseStore } from "./cjCatalog";
import { convertToZar } from "../utils/pricing";
import { cleanProductName, cleanDescriptionText } from "../utils/productNaming";
import { englishOnly, englishLines } from "../utils/englishOnly";
import { categorizeProduct } from "../utils/productCategorizer";
import { isExcludedFromStore } from "../utils/cjCategoryMap";
import { dedupeImages, isPhotoUrl } from "../utils/supplierWhiteLabel";
import type { ExternalVariant } from "../utils/cjVariants";

type Json = Record<string, any>;
export const AE_SUPPLIER_ID = "sup-aliexpress";
export const AE_SOURCE = "aliexpress";
const SHIP_TO = (process.env.ALIEXPRESS_SHIP_TO || "ZA").toUpperCase();
const FALLBACK_CATEGORY = process.env.CJ_DEFAULT_CATEGORY_ID || "cat-03";
const MAX_STOCK = 100;

/** "https://www.aliexpress.com/item/1005006123456789.html" or "1005006123456789" -> the id. */
export function aliexpressProductId(input: string): string | null {
  const s = String(input ?? "").trim();
  const m = s.match(/(?:item\/|productId=|\/)(\d{9,20})(?:\.html|\b)/) ?? s.match(/^(\d{9,20})$/);
  return m ? m[1] : null;
}

/** AliExpress wraps arrays in an object keyed by the element type ({ ae_item_sku_info_d_t_o: [...] }). */
function list(v: unknown): Json[] {
  if (Array.isArray(v)) return v;
  if (v && typeof v === "object") {
    const inner = Object.values(v as Json).find(x => Array.isArray(x));
    if (inner) return inner as Json[];
  }
  return [];
}
const num = (v: unknown): number | null => { const n = Number(String(v ?? "").replace(/[^\d.]/g, "")); return Number.isFinite(n) && n > 0 ? n : null; };

export interface AeVariant { skuId: string; skuAttr: string; label: string; priceUsd: number; stock: number; image?: string }
export interface AeProduct {
  productId: string; title: string; description: string; images: string[]; variants: AeVariant[];
  categoryId: string | null; storeName: string | null; rating: number | null; reviews: number | null; orders: number | null;
  shipsInDays: number | null; available: boolean;
}

/** Maps aliexpress.ds.product.get's result. */
export function parseAeProduct(result: Json, productId: string): AeProduct {
  const base = result.ae_item_base_info_dto ?? {};
  const media = result.ae_multimedia_info_dto ?? {};
  const photos = String(media.image_urls ?? "").split(/[;,]/).map(s => s.trim()).filter(isPhotoUrl);
  const variants: AeVariant[] = list(result.ae_item_sku_info_dtos).map((sku, i): AeVariant | null => {
    const props = list(sku.ae_sku_property_dtos ?? sku.aeop_s_k_u_propertys);
    const label = englishOnly(props.map(p => p.property_value_definition_name || p.sku_property_value).filter(Boolean).join(" / ")) || `Option ${i + 1}`;
    const image = props.map(p => p.sku_image).find(isPhotoUrl);
    const price = num(sku.offer_sale_price) ?? num(sku.sku_price);
    const skuAttr = String(sku.sku_attr ?? props.map(p => `${p.sku_property_id}:${p.property_value_id_long ?? p.property_value_id}`).join(";"));
    if (!price) return null;
    return {
      skuId: String(sku.sku_id ?? sku.id ?? ""), skuAttr, label, priceUsd: price,
      stock: Number(sku.sku_available_stock ?? sku.s_k_u_available_stock ?? sku.ipm_sku_stock ?? (sku.sku_stock ? MAX_STOCK : 0)) || 0,
      ...(image ? { image } : {}),
    };
  }).filter((v): v is AeVariant => v !== null);
  const specs = list(result.ae_item_properties).map(p => `${p.attr_name}: ${p.attr_value}${p.attr_value_unit ? ` ${p.attr_value_unit}` : ""}`);
  const detailText = String(base.detail ?? base.mobile_detail ?? "").replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "").replace(/<br\s*\/?>|<\/(p|div|li|h\d)>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ");
  const detailImages = [...String(base.detail ?? "").matchAll(/<img[^>]+src=["']([^"']+)["']/gi)].map(m => (m[1].startsWith("//") ? `https:${m[1]}` : m[1])).filter(isPhotoUrl);
  const title = cleanProductName(base.subject) || englishOnly(base.subject);
  return {
    productId, title,
    description: cleanDescriptionText(englishLines([detailText.trim().slice(0, 3000), specs.length ? `Specifications:\n${specs.join("\n")}` : ""].filter(Boolean).join("\n"))),
    images: dedupeImages([...photos, ...variants.map(v => v.image).filter((x): x is string => Boolean(x)), ...detailImages]),
    variants,
    categoryId: base.category_id ? String(base.category_id) : null,
    storeName: result.ae_store_info?.store_name ?? null,
    rating: num(base.avg_evaluation_rating), reviews: num(base.evaluation_count), orders: num(base.sales_count),
    shipsInDays: num(result.logistics_info_dto?.delivery_time),
    available: !/offline|delete|audit/i.test(String(base.product_status_type ?? "onSelling")) && variants.some(v => v.stock > 0),
  };
}

export async function fetchAeProduct(productId: string): Promise<AeProduct> {
  const json = await callAsBuyer("aliexpress.ds.product.get", {
    product_id: productId, ship_to_country: SHIP_TO, target_currency: "USD", target_language: "en", remove_personal_benefit: "false",
  });
  const r = json.aliexpress_ds_product_get_response ?? json;
  if (!r.result) throw new AliExpressError(`AliExpress returned no product for ${productId}${r.rsp_msg ? `: ${r.rsp_msg}` : ""}`, r.rsp_code);
  return parseAeProduct(r.result, productId);
}

/** Cheapest shipping line to South Africa for one unit, in USD. */
export async function cheapestShipping(productId: string, skuId: string | undefined, rates: Map<string, number>): Promise<{ usd: number; service: string; days: string | null } | null> {
  const dto = { country_code: SHIP_TO, product_id: Number(productId), product_num: 1, send_goods_country_code: "CN", ...(skuId ? { sku_id: skuId } : {}) };
  let options: Json[] = [];
  for (const [method, param] of [["aliexpress.logistics.buyer.freight.calculate", "param_aeop_freight_calculate_for_buyer_d_t_o"], ["aliexpress.logistics.buyer.freight.get", "aeopFreightCalculateForBuyerDTO"]] as const) {
    try {
      const json = await callAsBuyer(method, { [param]: dto });
      const r = Object.values(json)[0] as Json;
      options = list(r?.result?.aeop_freight_calculate_result_for_buyer_d_t_o_list ?? r?.result?.aeop_freight_calculate_result_for_buyer_dtolist);
      if (options.length) break;
    } catch (err) {
      logger.warn("aliexpress.freight_failed", { method, productId, error: err instanceof Error ? err.message : String(err) });
    }
  }
  const usdToZar = rates.get("USD");
  const priced = options.map(o => {
    const f = o.freight ?? {};
    const cents = num(f.cent);
    const amount = num(f.amount) ?? (cents !== null ? cents / 100 : 0);
    const cur = String(f.currency_code ?? "USD").toUpperCase();
    const usd = cur === "USD" || !usdToZar ? amount : (convertToZar(amount, cur, rates) ?? NaN) / usdToZar;
    return { usd, service: String(o.service_name ?? ""), days: o.estimated_delivery_time ? String(o.estimated_delivery_time) : null };
  }).filter(o => o.service && Number.isFinite(o.usd)).sort((a, b) => a.usd - b.usd);
  return priced[0] ?? null;
}

export async function ensureAeSupplier(): Promise<void> {
  await pool!.query(
    `INSERT INTO mkt_suppliers (id, name, country, platform, dropship_supported, verified, status) VALUES ($1, 'AliExpress', 'CN', 'AliExpress', true, true, 'active') ON CONFLICT (id) DO NOTHING`,
    [AE_SUPPLIER_ID]
  );
}

async function fxRates(): Promise<Map<string, number>> {
  const { rows } = await pool!.query(`SELECT currency, rate_to_zar FROM mkt_fx_rates`);
  return new Map(rows.map((r: { currency: string; rate_to_zar: string }) => [r.currency, Number(r.rate_to_zar)]));
}

export interface ImportResult { productId: string; listed: boolean; storeProductId: string | null; priceZar: number | null; reason?: string; title?: string }

/** Imports (or refreshes) one AliExpress product and lists it in the Ballylife store when it's sellable. */
export async function importAeProduct(idOrUrl: string): Promise<ImportResult> {
  const productId = aliexpressProductId(idOrUrl);
  if (!productId) throw new AliExpressError("That doesn't look like an AliExpress product link or id.");
  const p = await fetchAeProduct(productId);
  if (isExcludedFromStore(p.title)) return { productId, listed: false, storeProductId: null, priceZar: null, reason: "Not allowed in the store", title: p.title };

  await ensureAeSupplier();
  await ensureHouseStore();
  const rates = await fxRates();
  const usdToZar = rates.get("USD") ?? null;
  const inStock = p.variants.filter(v => v.stock > 0);
  const cheapestSku = [...inStock].sort((a, b) => a.priceUsd - b.priceUsd)[0];
  const shipping = cheapestSku ? await cheapestShipping(productId, cheapestSku.skuId || undefined, rates) : null;
  const costUsd = cheapestSku?.priceUsd ?? null;
  const baseZar = costUsd !== null && usdToZar ? Math.round((costUsd + (shipping?.usd ?? 0)) * usdToZar * 100) / 100 : 0;
  const { rows: catRows } = await pool!.query(`SELECT id FROM mkt_categories`);
  const categoryId = categorizeProduct(p.title, [], new Set(catRows.map((r: { id: string }) => r.id)), FALLBACK_CATEGORY) ?? FALLBACK_CATEGORY;
  const variants: ExternalVariant[] = inStock.map(v => ({ vid: v.skuAttr, key: v.label, priceUsd: v.priceUsd, ...(v.image ? { image: v.image } : {}) }));
  const stock = Math.min(MAX_STOCK, inStock.reduce((n, v) => n + v.stock, 0));

  const values = [p.title, p.description, costUsd ?? 0, baseZar, JSON.stringify(p.images), categoryId, JSON.stringify(variants), shipping?.usd ?? null, shipping?.service ?? null];
  const { rows: existing } = await pool!.query(`SELECT id FROM mkt_supplier_products WHERE supplier_id = $1 AND external_id = $2`, [AE_SUPPLIER_ID, productId]);
  let supplierProductId: string;
  if (existing.length) {
    supplierProductId = existing[0].id;
    await pool!.query(
      `UPDATE mkt_supplier_products SET name = $1, description = $2, cost_price = $3, retail_price = $4, images = $5, category_id = COALESCE(category_id, $6),
         external_variants = $7, est_shipping_usd = $8, est_logistic_name = $9, updated_at = now() WHERE id = $10`,
      [...values, supplierProductId]
    );
  } else {
    const { rows } = await pool!.query(
      `INSERT INTO mkt_supplier_products (name, description, cost_price, retail_price, images, category_id, external_variants, est_shipping_usd, est_logistic_name,
         supplier_id, currency, moq, origin_country, status, external_source, external_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'USD',1,'CN','pending_review',$11,$12) RETURNING id`,
      [...values, AE_SUPPLIER_ID, AE_SOURCE, productId]
    );
    supplierProductId = rows[0].id;
  }

  const MAX_LANDED_MULTIPLE = Number(process.env.ALIEXPRESS_MAX_LANDED_MULTIPLE ?? 5);
  const tooCostlyToShip = shipping && costUsd ? (costUsd + shipping.usd) / costUsd > MAX_LANDED_MULTIPLE : false;
  const reason = !p.available ? "Out of stock on AliExpress" : !usdToZar ? "No USD exchange rate on file" : !shipping ? "AliExpress has no shipping to South Africa for it"
    : !p.images.length ? "No photos" : tooCostlyToShip ? `Shipping would cost more than ${MAX_LANDED_MULTIPLE - 1}× the item` : null;
  if (reason) {
    await pool!.query(`UPDATE mkt_products SET status = 'out_of_stock', stock = 0, updated_at = now() WHERE supplier_product_id = $1 AND seller_id = $2 AND status = 'active'`, [supplierProductId, HOUSE_SELLER_ID]);
    return { productId, listed: false, storeProductId: null, priceZar: null, reason, title: p.title };
  }
  const priceZar = await listInHouseStore(supplierProductId, {
    name: p.title, description: p.description, images: p.images, variants, stock, cjCategoryName: "", detailOk: true, videos: [],
    costUsd: costUsd!, shippingUsd: shipping!.usd, usdToZar: usdToZar!, categoryId,
  });
  const { rows: listing } = await pool!.query(`SELECT id FROM mkt_products WHERE supplier_product_id = $1 AND seller_id = $2`, [supplierProductId, HOUSE_SELLER_ID]);
  logger.info("aliexpress.product_listed", { productId, priceZar, shippingUsd: shipping!.usd, service: shipping!.service });
  return { productId, listed: true, storeProductId: listing[0]?.id ?? null, priceZar, title: p.title };
}

/** Re-checks every imported product's price, stock and shipping (a slice per call). */
export async function refreshAeProducts(limit = 30): Promise<number> {
  const { rows } = await pool!.query(
    // Items a seller added through Find products aren't refreshed here: importing lists in the Ballylife store.
    `SELECT external_id FROM mkt_supplier_products WHERE supplier_id = $1 AND updated_at < $2 AND COALESCE(added_via, '') <> 'seller_sourcing'
     ORDER BY updated_at ASC LIMIT $3`,
    [AE_SUPPLIER_ID, new Date(Date.now() - 20 * 3600_000), limit]
  );
  let n = 0;
  for (const r of rows) {
    try { await importAeProduct(r.external_id); n++; }
    catch (err) {
      if (err instanceof AliExpressError && (err.kind === "auth" || err.kind === "not_connected" || err.kind === "config")) throw err;
      logger.warn("aliexpress.refresh_failed", { productId: r.external_id, error: err instanceof Error ? err.message : String(err) });
      await pool!.query(`UPDATE mkt_supplier_products SET updated_at = now() WHERE supplier_id = $1 AND external_id = $2`, [AE_SUPPLIER_ID, r.external_id]);
    }
  }
  return n;
}

export interface AeSearchHit { productId: string; title: string; priceUsd: number | null; image: string | null; orders: number | null; rating: string | null; url: string }

/** Keyword search (aliexpress.ds.text.search). Results are for the admin to pick from; nothing is listed until imported. */
export async function searchAe(keyword: string, page = 1): Promise<AeSearchHit[]> {
  const json = await callAsBuyer("aliexpress.ds.text.search", {
    keyWord: keyword, local: "en_US", countryCode: SHIP_TO, currency: "USD", pageSize: 30, pageIndex: page, sortBy: "orders,desc",
  });
  const r = (json.aliexpress_ds_text_search_response ?? Object.values(json)[0]) as Json;
  const data = r?.data ?? r?.result ?? r;
  const items = list(data?.products ?? data?.product_list ?? data);
  return items.map(i => {
    const productId = String(i.itemId ?? i.product_id ?? i.productId ?? "");
    return {
      productId,
      title: cleanProductName(i.title ?? i.product_title ?? i.subject ?? "") || "",
      priceUsd: num(i.targetSalePrice ?? i.target_sale_price ?? i.salePrice ?? i.sale_price),
      image: [i.itemMainPic, i.product_main_image_url, i.imageUrl].find(isPhotoUrl) ?? null,
      orders: num(i.orders ?? i.lastest_volume ?? i.volume),
      rating: i.evaluateRate ?? i.evaluate_rate ?? null,
      url: `https://www.aliexpress.com/item/${productId}.html`,
    };
  }).filter(h => h.productId && h.title);
}
