import fs from "fs";
import path from "path";
import { pool, hasDb } from "./pool";

/**
 * Applies schema.sql (idempotent — every statement is CREATE ... IF NOT
 * EXISTS) and seeds a starter category list on first run only, so a fresh
 * database isn't a completely empty marketplace with nothing to browse.
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

  const { rows } = await pool.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM mkt_categories");
  if (Number(rows[0].count) === 0) {
    const categories: [string, string, string, string][] = [
      ["electronics", "Electronics", "electronics", "📱"],
      ["fashion", "Fashion", "fashion", "👗"],
      ["home", "Home & Living", "home-living", "🛋️"],
      ["beauty", "Beauty & Health", "beauty-health", "💄"],
      ["groceries", "Groceries", "groceries", "🛒"],
      ["sports", "Sports & Outdoors", "sports-outdoors", "⚽"],
    ];
    for (const [id, name, slug, icon] of categories) {
      await pool.query(
        `INSERT INTO mkt_categories (id, name, slug, icon, featured) VALUES ($1, $2, $3, $4, true) ON CONFLICT (id) DO NOTHING`,
        [id, name, slug, icon]
      );
    }
    console.log("[db] Seeded starter categories.");
  }
}
