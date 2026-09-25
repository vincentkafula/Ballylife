import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import express, { type Express } from "express";
import bcrypt from "bcryptjs";
import { createTestDb } from "../test/testDb";

process.env.CJ_EMAIL = "test@example.com";
process.env.CJ_API_KEY = "test-cj-api-key";
process.env.CJ_MIN_REQUEST_INTERVAL_MS = "0";

const { pool } = createTestDb();
vi.mock("../db/pool", () => ({ pool, hasDb: true }));

let app: Express;
let adminToken: string;
let catalog: typeof import("./cjCatalog");
let fetchMock: ReturnType<typeof vi.fn<any[], Promise<unknown>>>;

const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => ({ code: 200, result: true, message: "Success", data }) });

const LIST = {
  pageNum: 1, pageSize: 20, total: 2,
  list: [
    { pid: "pid-earbuds", productName: "x", productNameEn: "CJ Wireless Earbuds", productSku: "S1", productImage: "https://cf.cjdropshipping.com/e.jpg", productWeight: 50, categoryId: "c1", categoryName: "Earphones", sellPrice: "10.00 -- 12.00" },
    { pid: "pid-noimg", productName: "y", productNameEn: "Plain Mug", productSku: "S2", productImage: "", productWeight: 300, categoryId: "c2", categoryName: "Kitchen", sellPrice: 3 },
  ],
};
const DETAIL: Record<string, unknown> = {
  "pid-earbuds": {
    pid: "pid-earbuds", productNameEn: "CJ Wireless Earbuds", categoryName: "Earphones", sellPrice: 10,
    productImageSet: ["https://cf.cjdropshipping.com/e1.jpg", "https://cf.cjdropshipping.com/e2.jpg"],
    description: "<p>Deep bass. Ships in CJ packaging.</p>",
    variants: [
      { vid: "vid-black", variantKey: "Black", variantSellPrice: 10, inventories: [{ countryCode: "CN", totalInventory: 40 }] },
      { vid: "vid-white", variantKey: "White", variantSellPrice: 12, inventories: [{ countryCode: "CN", totalInventory: 20 }] },
    ],
  },
  "pid-noimg": { pid: "pid-noimg", productNameEn: "Plain Mug", categoryName: "Kitchen", sellPrice: 3, variants: [{ vid: "vid-mug", variantKey: "", variantSellPrice: 3 }] },
};

beforeAll(async () => {
  catalog = await import("./cjCatalog");
  const authRouter = (await import("../routes/authRouter")).default;
  const marketplaceRouter = (await import("../routes/marketplaceRouter")).default;
  const cjRouter = (await import("../routes/cjDropshippingRouter")).default;
  app = express();
  app.use(express.json());
  app.use("/api/auth", authRouter);
  app.use("/api/marketplace", marketplaceRouter);
  app.use("/api/marketplace", cjRouter);

  await pool.query(`INSERT INTO mkt_categories (id, name, slug, icon) VALUES ('cat-01','Electronics','electronics','📱'), ('cat-03','Home & Garden','home-garden','🏠')`);
  await pool.query(`INSERT INTO mkt_fx_rates (currency, rate_to_zar) VALUES ('USD', 18.5)`);
  // A generated demo product (colour swatches, no photo) and a real seller product with a photo.
  await pool.query(`INSERT INTO mkt_sellers (id, store_name, store_slug, status) VALUES ('sel-01','TechZone','techzone','active')`);
  await pool.query(`INSERT INTO mkt_products (seller_id, category_id, name, slug, price, images, status) VALUES
    ('sel-01','cat-01','HomePro Stock Graphics 0149','demo-1',99,'["#dc2626","#991b1b"]','active'),
    ('sel-01','cat-01','Real Photo Product','real-1',199,'["https://example.com/p.jpg"]','active')`);

  const adminHash = await bcrypt.hash("AdminPass123", 10);
  await pool.query(`INSERT INTO users (username, password_hash, role, name, email) VALUES ('catadmin','${adminHash}','marketplace_admin','Admin','catadmin@example.com')`);
  adminToken = (await request(app).post("/api/auth/login").send({ username: "catadmin", password: "AdminPass123" })).body.data.token;
});

beforeEach(() => {
  fetchMock = vi.fn(async (input: unknown): Promise<unknown> => {
    const url = String(input);
    if (url.includes("getAccessToken")) return ok({ accessToken: "t", accessTokenExpiryDate: new Date(Date.now() + 864e5).toISOString(), refreshToken: "r", refreshTokenExpiryDate: new Date(Date.now() + 864e5).toISOString() });
    if (url.includes("/product/list")) return ok(LIST);
    if (url.includes("/product/query")) return ok(DETAIL[new URL(url).searchParams.get("pid")!]);
    if (url.includes("/logistic/freightCalculate")) return ok([{ logisticName: "A", logisticPrice: 8 }, { logisticName: "B", logisticPrice: 5 }]);
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); });

const houseListing = async () => (await pool.query(`SELECT * FROM mkt_products WHERE seller_id = 'sel-ballylife'`)).rows;

describe("helpers", () => {
  it("parses CJ price ranges to the lowest price", () => {
    expect(catalog.parseCjPrice("10.00 -- 12.00")).toBe(10);
    expect(catalog.parseCjPrice(7.5)).toBe(7.5);
    expect(catalog.parseCjPrice("")).toBeNull();
  });
  it("maps CJ category names onto ours", () => {
    expect(catalog.mapCjCategory("Wireless Earphones")).toBe("cat-01");
    expect(catalog.mapCjCategory("Women's Dresses")).toBe("cat-02");
    expect(catalog.mapCjCategory("Makeup Brushes")).toBe("cat-04");
    expect(catalog.mapCjCategory("Something Unheard Of")).toBe("cat-03");
  });
});

describe("Hiding the demo catalogue", () => {
  it("does nothing while there are no real listings yet, so the shop is never empty", async () => {
    expect(await catalog.hideDemoCatalogOnce()).toBeNull();
    const { rows } = await pool.query(`SELECT status FROM mkt_products WHERE slug = 'demo-1'`);
    expect(rows[0].status).toBe("active");
  });
});

describe("First-boot catalogue fill", () => {
  it("starts a sync on its own when no CJ products exist, and lists products with photos in the Ballylife store", async () => {
    await catalog.runCatalogSyncTick();

    const job = await catalog.getCatalogSyncJob();
    expect(job!.status).toBe("done"); // CJ only has 1 page here
    expect(job!.totals).toMatchObject({ imported: 2, listed: 1 });

    const listings = await houseListing();
    expect(listings.length).toBe(1); // the mug has no photo -> not listed
    const p = listings[0];
    expect(p.name).toBe("Wireless Earbuds"); // branding scrubbed
    expect(p.status).toBe("active");
    expect(p.category_id).toBe("cat-01");
    // (10 USD goods + 5 USD cheapest shipping) * 18.5 * 1.5 = 416.25 -> 417
    expect(Number(p.price)).toBe(417);
    expect(p.stock).toBe(60);
    const white = p.variants.find((v: { value: string }) => v.value === "White");
    expect(white.additionalPrice).toBe(56); // (12 - 10) * 18.5 * 1.5 = 55.5 -> 56
    expect(white.id).toMatch(/^v_/);

    const { rows: sp } = await pool.query(`SELECT * FROM mkt_supplier_products WHERE external_id = 'pid-earbuds'`);
    expect(sp[0].status).toBe("active"); // sellers can add it too
    expect(Number(sp[0].retail_price)).toBe(277.5); // seller base = landed cost, no markup
    const { rows: mug } = await pool.query(`SELECT status FROM mkt_supplier_products WHERE external_id = 'pid-noimg'`);
    expect(mug[0].status).toBe("pending_review");
  });

  it("then hides products with no real photo -- once -- and keeps real ones", async () => {
    const { rows } = await pool.query(`SELECT slug, status FROM mkt_products WHERE seller_id = 'sel-01' ORDER BY slug`);
    expect(rows).toEqual([{ slug: "demo-1", status: "inactive" }, { slug: "real-1", status: "active" }]);
    expect(await catalog.hideDemoCatalogOnce()).toBeNull(); // flag set: never runs again
  });

  it("the storefront now shows only real products, with photos served from our own domain", async () => {
    const res = await request(app).get("/api/marketplace/products?limit=50");
    const names = res.body.data.map((p: { name: string }) => p.name).sort();
    expect(names).toEqual(["Real Photo Product", "Wireless Earbuds"]);
    const earbuds = res.body.data.find((p: { name: string }) => p.name === "Wireless Earbuds");
    expect(earbuds.sellerName).toBe("Ballylife");
    expect(earbuds.images[0]).toMatch(/^\/api\/marketplace\/media\/p\//);
    expect(JSON.stringify(res.body)).not.toMatch(/cjdropshipping|vid-/i);
  });

  it("re-syncing updates the listing instead of duplicating it", async () => {
    await catalog.syncCjPage({ pageNum: 1, pageSize: 20 });
    expect((await houseListing()).length).toBe(1);
  });
});

describe("Admin background sync", () => {
  it("starts a multi-page job and reports progress", async () => {
    const start = await request(app).post("/api/marketplace/admin/cj/sync").set("Authorization", `Bearer ${adminToken}`).send({ pages: 3, pageSize: 20 });
    expect(start.status).toBe(202);
    expect(start.body.data).toMatchObject({ status: "running", nextPage: 1, endPage: 3 });

    await catalog.runCatalogSyncTick();
    const status = await request(app).get("/api/marketplace/admin/cj/sync").set("Authorization", `Bearer ${adminToken}`);
    expect(status.body.data.status).toBe("done"); // stops at CJ's last page, not the requested 3
    expect(status.body.data.totals.updated).toBe(2);
  });

  it("is admin-only", async () => {
    expect((await request(app).get("/api/marketplace/admin/cj/sync")).status).toBe(401);
  });
});
