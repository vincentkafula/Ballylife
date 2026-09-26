/**
 * Removes the demo data the project was seeded with from everything
 * managers and shoppers see: the six made-up stores (TechZone, Fashion Hub,
 * ...) and their ~200k placeholder products, the five made-up suppliers
 * and their catalogue, the demo logins, the demo pay-later providers, and
 * any order placed by a demo account or containing only demo products. Also
 * removes cartoon-character / unlicensed-character products from the live
 * catalogue.
 *
 * Nothing is deleted: rows are archived (status 'archived', orders flagged
 * is_demo, demo logins closed) and every dashboard query skips them, so a
 * real record caught by mistake can be restored. Runs once per version.
 */
import { pool } from "../db/pool";
import { logger } from "../utils/logger";
import { isExcludedFromStore } from "../utils/cjCategoryMap";

export const DEMO_SELLER_IDS = ["sel-01", "sel-02", "sel-03", "sel-04", "sel-05", "sel-06"];
export const DEMO_SUPPLIER_IDS = ["sup-cn-01", "sup-cn-02", "sup-jp-01", "sup-kr-01", "sup-kr-02"];
export const DEMO_USERNAMES = ["seller1", "supplier1", "customer1", "sars1", "shipping1", "credit1", "credit2"];
const FLAG = "demo_data_archived_v1";

type Row = Record<string, any>;
const inList = (values: string[], offset = 0) => values.map((_, i) => `$${i + 1 + offset}`).join(",");

export async function archiveDemoDataOnce(): Promise<Record<string, number> | null> {
  const { rows: done } = await pool!.query(`SELECT 1 FROM app_flags WHERE key = $1`, [FLAG]);
  if (done.length) return null;
  const counts: Record<string, number> = {};
  const run = async (key: string, sql: string, params: unknown[] = []) => {
    const r = await pool!.query(sql, params);
    counts[key] = (counts[key] ?? 0) + (r.rowCount ?? r.rows?.length ?? 0);
    return r;
  };

  // Stores and their products. Placeholder products (colour swatches / emoji, no real photo) anywhere go too.
  await run("sellers", `UPDATE mkt_sellers SET status = 'archived' WHERE id IN (${inList(DEMO_SELLER_IDS)}) AND status <> 'archived'`, DEMO_SELLER_IDS);
  await run("products", `UPDATE mkt_products SET status = 'archived', updated_at = now() WHERE seller_id IN (${inList(DEMO_SELLER_IDS)}) AND status <> 'archived'`, DEMO_SELLER_IDS);
  await run("products",
    `UPDATE mkt_products SET status = 'archived', updated_at = now()
     WHERE status <> 'archived' AND source IS NULL AND supplier_product_id IS NULL
       AND images::text NOT LIKE '%"http%' AND images::text NOT LIKE '%"/api/%'`);

  // Made-up suppliers and their catalogue.
  await run("suppliers", `UPDATE mkt_suppliers SET status = 'archived' WHERE id IN (${inList(DEMO_SUPPLIER_IDS)}) AND status <> 'archived'`, DEMO_SUPPLIER_IDS);
  await run("supplierProducts", `UPDATE mkt_supplier_products SET status = 'archived' WHERE supplier_id IN (${inList(DEMO_SUPPLIER_IDS)}) AND status <> 'archived'`, DEMO_SUPPLIER_IDS);
  await run("products",
    `UPDATE mkt_products SET status = 'archived', updated_at = now()
     WHERE status <> 'archived' AND supplier_product_id IN (SELECT id FROM mkt_supplier_products WHERE supplier_id IN (${inList(DEMO_SUPPLIER_IDS)}))`, DEMO_SUPPLIER_IDS);

  // Demo logins: closed and signed out (the seeded admin is kept so nobody is locked out).
  const { rows: demoUsers } = await pool!.query(`SELECT id FROM users WHERE username IN (${inList(DEMO_USERNAMES)})`, DEMO_USERNAMES);
  const demoUserIds = demoUsers.map((u: Row) => String(u.id));
  await run("accounts",
    `UPDATE users SET account_status = 'removed', removed_at = now(), removal_reason = 'Demo account removed', token_version = token_version + 1
     WHERE username IN (${inList(DEMO_USERNAMES)}) AND account_status <> 'removed'`, DEMO_USERNAMES);

  // Demo pay-later providers: checkout stops offering them.
  await run("creditProviders", `UPDATE mkt_credit_providers SET status = 'inactive' WHERE status = 'active'`);

  // Orders: by a demo account, or with nothing but demo products in them.
  const { rows: archivedIds } = await pool!.query(`SELECT id FROM mkt_products WHERE status = 'archived'`);
  const archived = new Set(archivedIds.map((r: Row) => String(r.id)));
  const { rows: orders } = await pool!.query(`SELECT id, user_id, items FROM mkt_orders WHERE is_demo = false`);
  for (const o of orders) {
    const items = (Array.isArray(o.items) ? o.items : []) as Row[];
    const demo = demoUserIds.includes(String(o.user_id)) || (items.length > 0 && items.every(i => archived.has(String(i.productId))));
    if (demo) await run("orders", `UPDATE mkt_orders SET is_demo = true WHERE id = $1`, [o.id]);
  }

  counts.excludedProducts = await archiveExcludedProducts();
  await pool!.query(`INSERT INTO app_flags (key, detail) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`, [FLAG, JSON.stringify(counts)]);
  logger.info("demo.archived", counts);
  return counts;
}

/**
 * Live products that may not be sold (cartoon / unlicensed characters,
 * adult items, weapons... -- see isExcludedFromStore) are archived; their
 * supplier catalogue entries are hidden so they aren't re-listed.
 */
export async function archiveExcludedProducts(): Promise<number> {
  const { rows } = await pool!.query(`SELECT id, name, supplier_product_id FROM mkt_products WHERE status IN ('active', 'out_of_stock', 'pending_review')`);
  let n = 0;
  for (const r of rows) {
    if (!isExcludedFromStore(r.name)) continue;
    await pool!.query(`UPDATE mkt_products SET status = 'archived', updated_at = now() WHERE id = $1`, [r.id]);
    if (r.supplier_product_id) await pool!.query(`UPDATE mkt_supplier_products SET status = 'inactive' WHERE id = $1`, [r.supplier_product_id]);
    n++;
  }
  if (n) logger.info("catalog.excluded_products_archived", { count: n });
  return n;
}
