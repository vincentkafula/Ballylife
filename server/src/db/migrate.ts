import fs from "fs";
import path from "path";
import { pool, hasDb } from "./pool";
import { CATEGORIES, SELLERS, PRODUCTS, COUPONS } from "./seedData";

/**
 * Applies schema.sql (idempotent — every statement is CREATE ... IF NOT
 * EXISTS) and seeds a starter catalog (categories, sellers, products,
 * coupons) on first run only, so a fresh database isn't a completely
 * empty marketplace with nothing to browse. Gated on mkt_products being
 * empty, not on `users`, since a fresh signup shouldn't re-trigger this.
 */
export async function migrate(): Promise<void> {
  if (!hasDb || !pool) {
    console.log("[db] DATABASE_URL not set — marketplace backend cannot start without a database (unlike VINK-GRUP-LIMITED, there is no in-memory fallback mode here).");
    return;
  }

  const schemaPath = path.join(__dirname, "schema.sql");
  const schema = fs.readFileSync(schemaPath, "utf-8");
  await pool.query(schema);
  console.log("[db] Schema applied.");

  const { rows } = await pool.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM mkt_products");
  if (Number(rows[0].count) >= PRODUCTS.length) {
    console.log("[db] Catalog already seeded — skipping.");
    return;
  }

  console.log("[db] Seeding/growing starter catalog...");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // A previous, smaller starter-category seed may already be in place
    // (different ids, overlapping slugs). Products reference categories
    // via a FK, so products must be cleared first or this violates the
    // constraint — order matters here.
    await client.query(`DELETE FROM mkt_products`);
    await client.query(`DELETE FROM mkt_categories`);

    for (const c of CATEGORIES) {
      await client.query(
        `INSERT INTO mkt_categories (id, name, slug, icon, parent_id, featured)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`,
        [c.id, c.name, c.slug, c.icon, c.parentId, c.featured]
      );
    }

    for (const s of SELLERS) {
      await client.query(
        `INSERT INTO mkt_sellers (id, user_id, store_name, store_slug, description, logo_url, banner_url,
           email, phone, country, status, kyc_verified, tax_id, total_sales, total_revenue,
           avg_rating, review_count, commission_pct, joined_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
         ON CONFLICT (id) DO NOTHING`,
        [s.id, s.userId || null, s.storeName, s.storeSlug, s.description, s.logoUrl, s.bannerUrl, s.email, s.phone,
         s.country, s.status, s.kycVerified, s.taxId, s.totalSales, s.totalRevenue, s.avgRating, s.reviewCount,
         s.commissionPct, s.joinedAt]
      );
    }

    for (const c of COUPONS) {
      await client.query(
        `INSERT INTO mkt_coupons (code, type, value, min_order_amount, max_discount_amount, usage_limit, usage_count, valid_from, valid_to, active, seller_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (code) DO NOTHING`,
        [c.code, c.type, c.value, c.minOrderAmount, c.maxDiscountAmount, c.usageLimit, c.usageCount, c.validFrom, c.validTo, c.active, c.sellerId]
      );
    }

    for (const p of PRODUCTS) {
      await client.query(
        `INSERT INTO mkt_products (id, seller_id, category_id, name, slug, short_description, description,
           price, compare_at_price, currency, images, emoji, status, stock, sku, brand, tags, attributes,
           variants, avg_rating, review_count, total_sold, is_featured, is_flash_deal, flash_deal_ends_at,
           created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)
         ON CONFLICT (id) DO NOTHING`,
        [p.id, p.sellerId, p.categoryId, p.name, p.slug, p.shortDescription, p.description, p.price,
         p.compareAtPrice, p.currency, JSON.stringify(p.images), p.emoji, p.status, p.stock, p.sku, p.brand,
         JSON.stringify(p.tags), JSON.stringify(p.attributes), JSON.stringify(p.variants), p.avgRating,
         p.reviewCount, p.totalSold, p.isFeatured, p.isFlashDeal, p.flashDealEndsAt, p.createdAt, p.updatedAt]
      );
    }

    await client.query("COMMIT");
    console.log(`[db] Seeded ${CATEGORIES.length} categories, ${SELLERS.length} sellers, ${PRODUCTS.length} products, ${COUPONS.length} coupons.`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[db] Catalog seed failed, rolled back:", err);
    throw err;
  } finally {
    client.release();
  }
}
