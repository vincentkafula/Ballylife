/**
 * Catalogue policy: every product on Ballylife is sourced from
 * CJdropshipping's Product API (synced by services/cjCatalog.ts). Sellers
 * list products only by importing them from that catalogue; nobody can
 * create a product -- or a catalogue item -- by hand.
 *
 * On by default. CJ_ONLY_CATALOG=false turns it off (e.g. to onboard a
 * local supplier later); it's read per call so it can be flipped in tests.
 */
export function cjOnlyCatalog(): boolean {
  return !/^(0|false|off|no)$/i.test(process.env.CJ_ONLY_CATALOG ?? "");
}

export const CJ_ONLY_MESSAGE =
  "All Ballylife products come from our supplier catalogue. Add products to your store by importing them from the catalogue.";

/** SQL condition: the product's catalogue item came from CJ. `p` = mkt_products alias. */
export const IS_CJ_PRODUCT_SQL =
  `p.supplier_product_id IN (SELECT id FROM mkt_supplier_products WHERE external_source = 'cjdropshipping')`;
