import { Router, Request, Response } from "express";
import { pool } from "../db/pool";

const router: ReturnType<typeof Router> = Router();

// The sitemap protocol caps a single file at 50,000 URLs; this stays
// well under that (20,000) so each file generates and transfers quickly
// rather than pushing the limit.
const PRODUCTS_PER_SITEMAP = 20_000;

// Frontend's own domain -- the static-pages sitemap.xml lives there
// (public/sitemap.xml, committed alongside the frontend build), not on
// this service. Referencing it from the index below means Search
// Console only needs pointing at ONE sitemap (this index) to discover
// both the static pages and every product, rather than two disconnected
// sitemaps submitted separately.
const FRONTEND_ORIGIN = "https://www.ballylife.com";

// This route's own origin, for building the product sub-sitemap URLs
// listed in the index below. MARKETPLACE_API_PUBLIC_URL is already set
// for the PayFast integration's own callback URLs (see
// payfastProcessor.ts) -- reused here rather than adding a second env
// var for the same value.
function backendOrigin(req: Request): string {
  return process.env.MARKETPLACE_API_PUBLIC_URL || `${req.protocol}://${req.get("host")}`;
}

// Pure, exported so the "at least one page even with zero products"
// floor can be tested directly without needing a genuinely empty
// database in an integration test (this file's pool is shared and
// already seeded by the time most tests run).
export function computeSitemapPageCount(totalActiveProducts: number): number {
  return Math.max(1, Math.ceil(totalActiveProducts / PRODUCTS_PER_SITEMAP));
}

router.get("/sitemap-index.xml", async (req: Request, res: Response): Promise<void> => {
  const { rows } = await pool!.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM mkt_products WHERE status = 'active'`);
  const total = Number(rows[0]?.count ?? 0);
  const pageCount = computeSitemapPageCount(total);
  const origin = backendOrigin(req);

  const entries = [
    `  <sitemap><loc>${FRONTEND_ORIGIN}/sitemap.xml</loc></sitemap>`,
    ...Array.from({ length: pageCount }, (_, i) => `  <sitemap><loc>${origin}/sitemap-products-${i + 1}.xml</loc></sitemap>`),
  ];

  res.set("Content-Type", "application/xml");
  res.send(
    `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join("\n")}\n</sitemapindex>\n`
  );
});

router.get("/sitemap-products-:page.xml", async (req: Request, res: Response): Promise<void> => {
  const page = Number(req.params.page);
  if (!Number.isInteger(page) || page < 1) {
    res.status(400).type("text/plain").send("Invalid sitemap page");
    return;
  }
  const offset = (page - 1) * PRODUCTS_PER_SITEMAP;

  // Ordered by id so pagination is stable across requests (a product
  // being added/removed between two calls could otherwise shift rows
  // across page boundaries under an unordered or recency-based sort).
  const { rows } = await pool!.query<{ id: string; updated_at: string }>(
    `SELECT id, updated_at FROM mkt_products WHERE status = 'active' ORDER BY id LIMIT $1 OFFSET $2`,
    [PRODUCTS_PER_SITEMAP, offset]
  );

  const urls = rows.map(
    (r) => `  <url><loc>${FRONTEND_ORIGIN}/product/${r.id}</loc><lastmod>${new Date(r.updated_at).toISOString().slice(0, 10)}</lastmod><changefreq>weekly</changefreq></url>`
  );

  res.set("Content-Type", "application/xml");
  res.send(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`
  );
});

export default router;
