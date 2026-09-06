import fs from "fs";
import path from "path";
import bcrypt from "bcryptjs";
import { pool, hasDb } from "./pool";
import { CATEGORIES, SELLERS, PRODUCTS, COUPONS, WAREHOUSES, SUPPLIERS, SUPPLIER_PRODUCTS, TAX_RATES, DUTY_RATES } from "./seedData";

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
    // Supply chain was added after this catalog-seed gate existed, so an
    // already-deployed database (products already at target count) still
    // needs its own, independently-gated chance to seed on first boot
    // after the upgrade — never short-circuit past it.
    await seedSupplyChain();
    await seedTaxRates();
    await seedDefaultLogins();
    await seedDefaultSupplierLogin();
    await seedDefaultCustomerLogin();
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

  await seedSupplyChain();
  await seedTaxRates();
  await seedDefaultLogins();
  await seedDefaultSupplierLogin();
  await seedDefaultCustomerLogin();
}

/**
 * Seeds the supply-chain domain (warehouses, suppliers, supplier catalog)
 * independently of the main catalog seed above, gated on its own table
 * (mkt_suppliers) rather than mkt_products — this feature was added after
 * the marketplace catalog, so an already-deployed database with products
 * already seeded still needs this to run once on its first deploy after
 * the upgrade.
 */
async function seedSupplyChain(): Promise<void> {
  const { rows } = await pool!.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM mkt_suppliers");
  if (Number(rows[0].count) > 0) {
    console.log("[db] Supply chain already seeded — skipping.");
    return;
  }

  console.log("[db] Seeding supply chain (warehouses, suppliers, supplier catalog)...");
  const client = await pool!.connect();
  try {
    await client.query("BEGIN");

    for (const w of WAREHOUSES) {
      await client.query(
        `INSERT INTO mkt_warehouses (id, name, country, type, address, status, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
        [w.id, w.name, w.country, w.type, w.address, w.status, w.createdAt]
      );
    }

    for (const s of SUPPLIERS) {
      await client.query(
        `INSERT INTO mkt_suppliers (id, name, country, contact_name, contact_email, contact_phone, platform,
           payment_terms, lead_time_days, dropship_supported, verified, status, notes, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT (id) DO NOTHING`,
        [s.id, s.name, s.country, s.contactName, s.contactEmail, s.contactPhone, s.platform, s.paymentTerms,
         s.leadTimeDays, s.dropshipSupported, s.verified, s.status, s.notes, s.createdAt]
      );
    }

    for (const sp of SUPPLIER_PRODUCTS) {
      await client.query(
        `INSERT INTO mkt_supplier_products (id, supplier_id, category_id, name, description, cost_price, currency, retail_price, compare_at_price,
           moq, images, emoji, origin_country, status, import_count, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) ON CONFLICT (id) DO NOTHING`,
        [sp.id, sp.supplierId, sp.categoryId, sp.name, sp.description, sp.costPrice, sp.currency, sp.retailPrice, sp.compareAtPrice,
         sp.moq, JSON.stringify(sp.images), sp.emoji, sp.originCountry, sp.status, sp.importCount, sp.createdAt, sp.updatedAt]
      );
    }

    await client.query("COMMIT");
    console.log(`[db] Seeded ${WAREHOUSES.length} warehouses, ${SUPPLIERS.length} suppliers, ${SUPPLIER_PRODUCTS.length} supplier catalog items.`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[db] Supply chain seed failed, rolled back:", err);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Seeds starting VAT/duty rates (mkt_tax_rates, mkt_duty_rates) — gated on
 * mkt_tax_rates independently of every other seed step above, same reasoning
 * as seedSupplyChain: this feature landed after those gates existed, so an
 * already-deployed database needs its own first-boot chance to pick it up.
 */
async function seedTaxRates(): Promise<void> {
  const { rows } = await pool!.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM mkt_tax_rates");
  if (Number(rows[0].count) > 0) {
    console.log("[db] Tax/duty rates already seeded — skipping.");
    return;
  }

  console.log("[db] Seeding tax/duty rates...");
  const client = await pool!.connect();
  try {
    await client.query("BEGIN");
    for (const t of TAX_RATES) {
      await client.query(
        `INSERT INTO mkt_tax_rates (country, vat_rate_pct, default_duty_rate_pct, notes, updated_at)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (country) DO NOTHING`,
        [t.country, t.vatRatePct, t.defaultDutyRatePct, t.notes, t.updatedAt]
      );
    }
    for (const d of DUTY_RATES) {
      await client.query(
        `INSERT INTO mkt_duty_rates (id, country, category_id, duty_rate_pct, notes)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING`,
        [d.id, d.country, d.categoryId, d.dutyRatePct, d.notes]
      );
    }
    await client.query("COMMIT");
    console.log(`[db] Seeded ${TAX_RATES.length} country tax rates, ${DUTY_RATES.length} category duty overrides.`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[db] Tax/duty rate seed failed, rolled back:", err);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Creates one default manager login and one default seller login so the
 * dashboards have something to sign in with immediately after a fresh
 * deploy — gated on no marketplace_admin user existing yet, so this only
 * ever runs once and is safe to leave in place across redeploys.
 *
 * SECURITY: these are throwaway starter credentials, not meant to stay in
 * use. Sign in and change both passwords (Settings -> change password)
 * before putting real data or real customers on this deployment.
 */
async function seedDefaultLogins(): Promise<void> {
  const { rows } = await pool!.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM users WHERE role = 'marketplace_admin'");
  if (Number(rows[0].count) > 0) {
    console.log("[db] Default logins already seeded — skipping.");
    return;
  }

  console.log("[db] Seeding default dashboard logins...");
  const client = await pool!.connect();
  try {
    await client.query("BEGIN");

    const adminHash = await bcrypt.hash("Ballylife@2026", 10);
    await client.query(
      `INSERT INTO users (username, password_hash, role, name, email)
       VALUES ('admin', $1, 'marketplace_admin', 'Ballylife Admin', 'admin@ballylife.example')
       ON CONFLICT (username) DO NOTHING`,
      [adminHash]
    );

    const sellerHash = await bcrypt.hash("Ballylife@2026", 10);
    const { rows: sellerUserRows } = await client.query(
      `INSERT INTO users (username, password_hash, role, name, email)
       VALUES ('seller1', $1, 'seller', 'TechZone Seller', 'store@techzone.example')
       ON CONFLICT (username) DO NOTHING RETURNING id`,
      [sellerHash]
    );
    // Link the new login to the first seeded store (sel-01 / TechZone) so
    // the Seller Dashboard has real products/orders to show immediately,
    // rather than an empty freshly-registered store.
    if (sellerUserRows.length) {
      await client.query(`UPDATE mkt_sellers SET user_id = $1 WHERE id = 'sel-01'`, [sellerUserRows[0].id]);
    }

    await client.query("COMMIT");
    console.log("[db] Seeded default logins: admin/marketplace_admin and seller1/seller (linked to TechZone).");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[db] Default login seed failed, rolled back:", err);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Creates one default supplier dashboard login, linked to the first
 * seeded supplier (sup-cn-01 / Guangzhou Fortune Trading Co.) — gated
 * independently of seedDefaultLogins (mkt_suppliers.user_id, not
 * users.role), since that gate already tripped in production before this
 * feature existed and would otherwise never run again.
 *
 * SECURITY: same as the other default logins — a throwaway starter
 * credential. Sign in and change the password before real use.
 */
async function seedDefaultSupplierLogin(): Promise<void> {
  const { rows } = await pool!.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM mkt_suppliers WHERE user_id IS NOT NULL");
  if (Number(rows[0].count) > 0) {
    console.log("[db] Default supplier login already seeded — skipping.");
    return;
  }

  console.log("[db] Seeding default supplier login...");
  const client = await pool!.connect();
  try {
    await client.query("BEGIN");
    const passwordHash = await bcrypt.hash("Ballylife@2026", 10);
    const { rows: userRows } = await client.query(
      `INSERT INTO users (username, password_hash, role, name, email)
       VALUES ('supplier1', $1, 'supplier', 'Guangzhou Fortune Trading Co.', 'liwei@fortunetrading.example')
       ON CONFLICT (username) DO NOTHING RETURNING id`,
      [passwordHash]
    );
    if (userRows.length) {
      await client.query(`UPDATE mkt_suppliers SET user_id = $1 WHERE id = 'sup-cn-01'`, [userRows[0].id]);
    }
    await client.query("COMMIT");
    console.log("[db] Seeded default supplier login: supplier1 (linked to Guangzhou Fortune Trading Co.).");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[db] Default supplier login seed failed, rolled back:", err);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Creates one default customer/buyer login — a plain shopper account with
 * no store or supplier attached, just for browsing/buying on the storefront.
 * Gated on the specific username 'customer1' existing, since role='customer'
 * alone isn't a safe gate (real shopper signups will use that role too).
 */
async function seedDefaultCustomerLogin(): Promise<void> {
  const { rows } = await pool!.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM users WHERE username = 'customer1'");
  if (Number(rows[0].count) > 0) {
    console.log("[db] Default customer login already seeded — skipping.");
    return;
  }

  console.log("[db] Seeding default customer login...");
  const passwordHash = await bcrypt.hash("Ballylife@2026", 10);
  await pool!.query(
    `INSERT INTO users (username, password_hash, role, name, email)
     VALUES ('customer1', $1, 'customer', 'Demo Customer', 'customer1@ballylife.example')
     ON CONFLICT (username) DO NOTHING`,
    [passwordHash]
  );
  console.log("[db] Seeded default customer login: customer1.");
}
