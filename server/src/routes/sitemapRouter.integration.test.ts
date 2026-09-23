import { describe, it, expect, beforeAll, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createTestDb } from "../test/testDb";
import { buildTestApp } from "../test/testApp";

const { pool } = createTestDb();
vi.mock("../db/pool", () => ({ pool, hasDb: true }));

let app: Express;
let computeSitemapPageCount: (total: number) => number;
beforeAll(async () => {
  const sitemapModule = await import("./sitemapRouter");
  app = buildTestApp("/", sitemapModule.default);
  computeSitemapPageCount = sitemapModule.computeSitemapPageCount;

  await pool.query(`INSERT INTO mkt_categories (id, name, slug, icon) VALUES ('cat-01','Electronics','electronics','📱')`);
  await pool.query(`INSERT INTO mkt_sellers (id, store_name, store_slug, status) VALUES ('sel-01','TechZone','techzone','active')`);

  // 5 active products, plus one of each non-active status -- the
  // non-active ones must never appear in any sitemap output.
  for (let i = 1; i <= 5; i++) {
    await pool.query(
      `INSERT INTO mkt_products (seller_id, category_id, name, slug, price, status) VALUES ('sel-01','cat-01',$1,$2,10,'active')`,
      [`Active Product ${i}`, `active-product-${i}`]
    );
  }
  for (const status of ["pending_review", "inactive", "rejected", "out_of_stock"]) {
    await pool.query(
      `INSERT INTO mkt_products (seller_id, category_id, name, slug, price, status) VALUES ('sel-01','cat-01',$1,$2,10,$3)`,
      [`${status} product`, `${status}-product`, status]
    );
  }
});

describe("GET /sitemap-index.xml", () => {
  it("returns valid XML referencing the frontend's static sitemap and at least one product sitemap page", async () => {
    const res = await request(app).get("/sitemap-index.xml");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/xml/);
    expect(res.text).toContain("<sitemapindex");
    expect(res.text).toContain("https://www.ballylife.com/sitemap.xml");
    expect(res.text).toContain("/sitemap-products-1.xml");
  });

  it("still returns a valid index (one product page reference) even with zero active products", async () => {
    // computeSitemapPageCount is the exact function the route uses to
    // decide how many product sub-sitemap entries to list -- tested
    // directly here since forcing a genuinely empty products table
    // through this file's shared, already-seeded pool isn't practical,
    // and this is the real logic the "floor at 1" behavior lives in.
    expect(computeSitemapPageCount(0)).toBe(1);
    expect(computeSitemapPageCount(1)).toBe(1);
    expect(computeSitemapPageCount(20_000)).toBe(1);
    expect(computeSitemapPageCount(20_001)).toBe(2);
    expect(computeSitemapPageCount(40_000)).toBe(2);
    expect(computeSitemapPageCount(200_000)).toBe(10);
  });
});

describe("GET /sitemap-products-:page.xml", () => {
  it("lists only active products, with correct product URLs and a lastmod date", async () => {
    const res = await request(app).get("/sitemap-products-1.xml");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/xml/);
    expect(res.text).toContain("<urlset");

    // All 5 active products present, by real URL.
    const activeRows = await pool.query(`SELECT id FROM mkt_products WHERE status = 'active'`);
    expect(activeRows.rows.length).toBe(5);
    for (const row of activeRows.rows) {
      expect(res.text).toContain(`https://www.ballylife.com/product/${row.id}`);
    }
    expect(res.text).toMatch(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);

    // None of the non-active ones.
    const nonActiveRows = await pool.query(`SELECT id FROM mkt_products WHERE status != 'active'`);
    for (const row of nonActiveRows.rows) {
      expect(res.text).not.toContain(`/product/${row.id}`);
    }
  });

  it("returns an empty (but valid) urlset for a page beyond the real data, rather than an error", async () => {
    const res = await request(app).get("/sitemap-products-999.xml");
    expect(res.status).toBe(200);
    expect(res.text).toContain("<urlset");
    expect(res.text).not.toContain("<url>");
  });

  it("rejects a non-numeric or non-positive page with 400, not a confusing empty result", async () => {
    for (const bad of ["abc", "0", "-1"]) {
      const res = await request(app).get(`/sitemap-products-${bad}.xml`);
      expect(res.status).toBe(400);
    }
  });
});
