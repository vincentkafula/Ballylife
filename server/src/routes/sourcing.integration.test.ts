import { describe, it, expect, beforeAll, vi } from "vitest";
import request from "supertest";
import express, { type Express } from "express";
import bcrypt from "bcryptjs";
import { createTestDb } from "../test/testDb";
import type { SupplierAdapter } from "../services/sourcing/types";

const { pool } = createTestDb();
vi.mock("../db/pool", () => ({ pool, hasDb: true }));

// Fake suppliers: raw data full of the things sellers must never see.
const calls = { ae: 0, cj: 0 };
const fakeAe: SupplierAdapter = {
  key: "aliexpress", isConfigured: () => true, costPerCall: { search: 0.01 },
  catalogue: {
    supplierId: "sup-aliexpress", source: "aliexpress",
    async ensureSupplier() { await pool.query(`INSERT INTO mkt_suppliers (id, name, country, status) VALUES ('sup-aliexpress','AliExpress','CN','active') ON CONFLICT (id) DO NOTHING`); },
  },
  async search() {
    calls.ae++;
    return [{ externalId: "1005001234567890", title: "AliExpress Wireless Earbuds", cost: 10, currency: "USD", image: "https://ae01.alicdn.com/kf/earbuds.jpg", orders: 500, rating: 4.8 }];
  },
  async getProduct(id) {
    return {
      externalId: id, title: "Wireless Earbuds", description: "Great sound. Visit https://www.aliexpress.com/item/1005001234567890.html for more. Sold on AliExpress.",
      images: ["https://ae01.alicdn.com/kf/earbuds.jpg", "https://evil.example.com/x.jpg"], currency: "USD", category: "Audio", available: true,
      variants: [
        { externalSku: "12000012345", orderRef: "14:193#Black", label: "Black", cost: 10, stock: 40, image: "https://ae01.alicdn.com/kf/black.jpg" },
        { externalSku: "12000012346", orderRef: "14:175#White", label: "White", cost: 12, stock: 0 },
      ],
    };
  },
  async getShipping() { return { cost: 2, currency: "USD", minDays: 7, maxDays: 15 }; },
};
const fakeCj: SupplierAdapter = {
  key: "cj", isConfigured: () => true, costPerCall: {},
  catalogue: { supplierId: "sup-cjdropshipping", source: "cjdropshipping", async ensureSupplier() { /* not used */ } },
  async search() {
    calls.cj++;
    return [{ externalId: "CJ-PID-777", title: "Phone Stand", cost: 3, currency: "USD", image: "https://cf.cjdropshipping.com/stand.jpg", orders: null, rating: null }];
  },
  async getProduct() { throw new Error("unused"); }, async getShipping() { return null; },
};

// Words, ids and hosts that must never reach a seller or buyer.
const LEAKS = [/aliexpress/i, /alicdn/i, /cjdropshipping/i, /\bcj\b/i, /1005001234567890/, /12000012345/, /CJ-PID-777/, /evil\.example/, /https?:\/\//i];
const expectNoLeaks = (body: unknown) => { const s = JSON.stringify(body); for (const re of LEAKS) expect(s).not.toMatch(re); };

let app: Express;
let adminToken: string;
let sellerToken: string;
let buyerToken: string;
let sellerId: string;

beforeAll(async () => {
  (await import("../services/sourcing/adapters"))._setAdaptersForTests([fakeAe, fakeCj]);
  const authRouter = (await import("./authRouter")).default;
  const marketplaceRouter = (await import("./marketplaceRouter")).default;
  const sourcingRouter = (await import("./sourcingRouter")).default;
  const mediaRouter = (await import("./mediaRouter")).default;
  app = express();
  app.use(express.json());
  app.use("/api/auth", authRouter);
  app.use("/api/marketplace", mediaRouter);
  app.use("/api/marketplace", marketplaceRouter);
  app.use("/api/marketplace", sourcingRouter);

  await pool.query(`INSERT INTO mkt_fx_rates (currency, rate_to_zar) VALUES ('USD', 18)`);
  const hash = await bcrypt.hash("AdminPass123", 10);
  await pool.query(`INSERT INTO users (username, password_hash, role, name, email) VALUES ('srcadmin','${hash}','marketplace_admin','Admin','srcadmin@example.com')`);
  adminToken = (await request(app).post("/api/auth/login").send({ username: "srcadmin", password: "AdminPass123" })).body.data.token;
  const reg = await request(app).post("/api/marketplace/sellers/register").send({
    username: "srcseller", password: "SellerPass123", name: "S", email: "srcseller@example.com", storeName: "Src Store",
  });
  sellerToken = reg.body.token; sellerId = reg.body.seller.id;
  await pool.query(`INSERT INTO mkt_categories (id, name, slug, icon) VALUES ('cat-03','Electronics','electronics','📱')`);
  await pool.query(`INSERT INTO users (username, password_hash, role, name, email) VALUES ('srcbuyer','${await bcrypt.hash("BuyerPass123", 10)}','customer','B','srcbuyer@example.com')`);
  buyerToken = (await request(app).post("/api/auth/login").send({ username: "srcbuyer", password: "BuyerPass123" })).body.data.token;
});

describe("Supplier sourcing (adapter layer)", () => {
  it("merges suppliers into white-labelled results priced in rand", async () => {
    const res = await request(app).get("/api/marketplace/admin/sourcing/search?q=earbuds").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    const [first] = res.body.data;
    expect(first.title).toBe("Wireless Earbuds");          // supplier name scrubbed
    expect(first.fromCostZar).toBe(Math.ceil(10 * 18 * 1.03)); // USD -> ZAR + 3% FX buffer
    expect(first.image).toMatch(/^\/api\/marketplace\/media\/s\/[A-Za-z0-9_-]+$/);
    expectNoLeaks(res.body);
  });

  it("serves a repeated search from the cache and records both in the ledger", async () => {
    const before = { ...calls };
    await request(app).get("/api/marketplace/admin/sourcing/search?q=Earbuds").set("Authorization", `Bearer ${adminToken}`);
    expect(calls).toEqual(before);
    const { rows } = await pool.query(`SELECT adapter, cached FROM supplier_api_calls WHERE endpoint = 'search' ORDER BY created_at`);
    expect(rows.filter((r: { cached: boolean }) => !r.cached)).toHaveLength(2);
    expect(rows.filter((r: { cached: boolean }) => r.cached)).toHaveLength(2);
  });

  it("filters by rand price", async () => {
    const res = await request(app).get("/api/marketplace/admin/sourcing/search?q=earbuds&maxPrice=100").set("Authorization", `Bearer ${adminToken}`);
    expect(res.body.data.map((h: { title: string }) => h.title)).toEqual(["Phone Stand"]);
  });

  it("opens a product by its sealed ref without leaking the supplier, and drops unknown image hosts", async () => {
    const search = await request(app).get("/api/marketplace/admin/sourcing/search?q=earbuds").set("Authorization", `Bearer ${adminToken}`);
    const ref = search.body.data.find((h: { title: string }) => h.title === "Wireless Earbuds").ref;
    const res = await request(app).get(`/api/marketplace/admin/sourcing/product/${ref}`).set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.images).toHaveLength(1);
    expect(res.body.data.baseCostZar).toBe(Math.ceil(10 * 18 * 1.03) + Math.ceil(2 * 18 * 1.03));
    expect(res.body.data.delivery).toEqual({ minDays: 7, maxDays: 15 });
    expect(res.body.data.description).toBe("Great sound.");
    expectNoLeaks(res.body);
  });

  it("rejects tampered refs and tampered image tokens", async () => {
    const bad = await request(app).get(`/api/marketplace/admin/sourcing/product/${"A".repeat(60)}`).set("Authorization", `Bearer ${adminToken}`);
    expect(bad.status).toBe(404);
    const img = await request(app).get(`/api/marketplace/media/s/${"A".repeat(60)}`);
    expect(img.status).toBe(404);
  });

  it("switching a supplier off removes it from results", async () => {
    const off = await request(app).patch("/api/marketplace/admin/sourcing/suppliers/cj").set("Authorization", `Bearer ${adminToken}`).send({ enabled: false });
    expect(off.status).toBe(200);
    const res = await request(app).get("/api/marketplace/admin/sourcing/search?q=earbuds").set("Authorization", `Bearer ${adminToken}`);
    expect(res.body.data.map((h: { title: string }) => h.title)).toEqual(["Wireless Earbuds"]);
    await request(app).patch("/api/marketplace/admin/sourcing/suppliers/cj").set("Authorization", `Bearer ${adminToken}`).send({ enabled: true });
  });

  it("is manager-only; buyers can't reach the supplier catalog at all", async () => {
    for (const token of [sellerToken, buyerToken]) {
      const res = await request(app).get("/api/marketplace/admin/sourcing/search?q=earbuds").set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(403);
    }
    const catalog = await request(app).get("/api/marketplace/supplier-catalog").set("Authorization", `Bearer ${buyerToken}`);
    expect(catalog.status).toBe(403);
    const sellerCatalog = await request(app).get("/api/marketplace/supplier-catalog").set("Authorization", `Bearer ${sellerToken}`);
    expect(sellerCatalog.status).toBe(200);
  });
});

describe("Seller sourcing (search, profit, import, plan limits)", () => {
  const auth = () => ({ Authorization: `Bearer ${sellerToken}` });
  const setPlans = (value: unknown) => pool.query(
    `INSERT INTO sourcing_settings (key, value) VALUES ('plans', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [JSON.stringify(value)]);

  it("needs an approved store", async () => {
    const res = await request(app).get("/api/marketplace/sourcing/search?q=earbuds").set(auth());
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("SELLER_NOT_ACTIVE");
    await pool.query(`UPDATE mkt_sellers SET status = 'active' WHERE id = $1`, [sellerId]);
  });

  it("shows the seller's plan (Starter by default)", async () => {
    const res = await request(app).get("/api/marketplace/sourcing/quota").set(auth());
    expect(res.status).toBe(200);
    expect(res.body.data.plan).toBe("starter");
    expect(res.body.data.limits).toEqual({ searchesPerDay: 20, viewsPerDay: 60, activeImports: 25, importsPerMonth: 50 });
    expect(res.body.data.commissionPct).toBe(8);
  });

  it("searches without leaking the supplier and counts each search", async () => {
    const res = await request(app).get("/api/marketplace/sourcing/search?q=earbuds").set(auth());
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expectNoLeaks(res.body);
    const q = await request(app).get("/api/marketplace/sourcing/quota").set(auth());
    expect(q.body.data.used.searchesToday).toBe(1);
    const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM supplier_api_calls WHERE seller_id = $1`, [sellerId]);
    expect(rows[0].n).toBeGreaterThan(0);
  });

  it("stops searches at the plan's daily limit", async () => {
    await setPlans({ starter: { searchesPerDay: 2 } });
    const second = await request(app).get("/api/marketplace/sourcing/search?q=earbuds").set(auth());
    expect(second.status).toBe(200);
    const third = await request(app).get("/api/marketplace/sourcing/search?q=earbuds").set(auth());
    expect(third.status).toBe(429);
    expect(third.body.code).toBe("SOURCING_QUOTA");
    await setPlans({});
  });

  let ref: string;
  it("opens a product with the lowest price that still makes a profit", async () => {
    const search = await request(app).get("/api/marketplace/sourcing/search?q=earbuds").set(auth());
    ref = search.body.data.find((h: { title: string }) => h.title === "Wireless Earbuds").ref;
    const res = await request(app).get(`/api/marketplace/sourcing/product/${ref}`).set(auth());
    expect(res.status).toBe(200);
    const base = Math.ceil(10 * 18 * 1.03) + Math.ceil(2 * 18 * 1.03);
    expect(res.body.data.baseCostZar).toBe(base);
    expect(res.body.data.minPriceZar).toBe(Math.ceil(base / 0.92));
    expectNoLeaks(res.body);
  });

  it("won't import below the break-even price", async () => {
    const res = await request(app).post("/api/marketplace/sourcing/import").set(auth()).send({ ref, retailPrice: 100 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("PRICE_TOO_LOW");
  });

  it("imports into the seller's store for review, ready for the fulfilment worker", async () => {
    const res = await request(app).post("/api/marketplace/sourcing/import").set(auth()).send({ ref, retailPrice: 399 });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe("pending_review");
    expect(Number(res.body.data.price)).toBe(399);
    expectNoLeaks(res.body);
    const { rows } = await pool.query(`SELECT * FROM mkt_supplier_products WHERE external_source = 'aliexpress'`);
    expect(rows).toHaveLength(1);
    expect(rows[0].external_id).toBe("1005001234567890");
    expect(rows[0].name).toBe("Wireless Earbuds");
    expect(rows[0].external_variants).toEqual([{ vid: "14:193#Black", key: "Black", priceUsd: 10, image: "https://ae01.alicdn.com/kf/black.jpg" }]);
    expect(rows[0].images).toEqual(["https://ae01.alicdn.com/kf/earbuds.jpg"]);
  });

  it("won't import the same product twice, and a manager can approve it", async () => {
    const again = await request(app).post("/api/marketplace/sourcing/import").set(auth()).send({ ref, retailPrice: 399 });
    expect(again.status).toBe(409);
    const { rows } = await pool.query(`SELECT id FROM mkt_products WHERE seller_id = $1`, [sellerId]);
    const approve = await request(app).patch(`/api/marketplace/admin/products/${rows[0].id}/approve`).set("Authorization", `Bearer ${adminToken}`);
    expect(approve.status).toBe(200);
  });

  it("enforces the active-imports limit, and a manager can move the seller to a bigger plan", async () => {
    await setPlans({ starter: { activeImports: 1 } });
    const blocked = await request(app).post("/api/marketplace/sourcing/import").set(auth()).send({ ref, retailPrice: 399 });
    expect(blocked.status).toBe(429);
    expect(blocked.body.limit).toBe("activeImports");
    const up = await request(app).patch(`/api/marketplace/admin/sourcing/sellers/${sellerId}/plan`).set("Authorization", `Bearer ${adminToken}`).send({ plan: "pro" });
    expect(up.status).toBe(200);
    expect(up.body.data.limits.activeImports).toBe(500);
    await setPlans({});
  });
});

describe("Manager sourcing dashboard", () => {
  const admin = () => ({ Authorization: `Bearer ${adminToken}` });

  it("summarises calls, cache use, suppliers, plans and seller imports", async () => {
    const res = await request(app).get("/api/marketplace/admin/sourcing/overview?days=7").set(admin());
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.totals.live).toBeGreaterThan(0);
    expect(d.totals.cached).toBeGreaterThan(0);
    expect(d.byAdapter.map((a: { adapter: string }) => a.adapter)).toEqual(["aliexpress", "cj"]);
    expect(d.daily).toHaveLength(7);
    expect(d.daily.reduce((n: number, x: { live: number; cached: number }) => n + x.live + x.cached, 0)).toBe(d.totals.live + d.totals.cached);
    expect(d.listings.active).toBe(1);
    expect(d.suppliers).toHaveLength(2);
    expect(d.plans.starter.searchesPerDay).toBe(20);
    expect(d.settings).toEqual({ cacheHours: 24, fxBufferPct: 3 });
  });

  it("lists sellers with their plan and usage", async () => {
    const res = await request(app).get("/api/marketplace/admin/sourcing/sellers").set(admin());
    expect(res.status).toBe(200);
    const row = res.body.data.find((r: { sellerId: string }) => r.sellerId === sellerId);
    expect(row).toMatchObject({ storeName: "Src Store", plan: "pro", activeImports: 1, importsThisMonth: 1 });
    expect(row.searchesToday).toBeGreaterThan(0);
  });

  it("edits plan limits, rejecting bad numbers", async () => {
    const bad = await request(app).patch("/api/marketplace/admin/sourcing/plans").set(admin()).send({ starter: { searchesPerDay: -1 } });
    expect(bad.status).toBe(400);
    const ok = await request(app).patch("/api/marketplace/admin/sourcing/plans").set(admin()).send({ standard: { searchesPerDay: 150 } });
    expect(ok.status).toBe(200);
    expect(ok.body.data.standard.searchesPerDay).toBe(150);
    expect(ok.body.data.standard.activeImports).toBe(125);
    expect(ok.body.data.starter.searchesPerDay).toBe(20);
  });

  it("clears the cache, so the next search asks the supplier again", async () => {
    const res = await request(app).delete("/api/marketplace/admin/sourcing/cache").set(admin());
    expect(res.status).toBe(200);
    expect(res.body.data.cleared).toBeGreaterThan(0);
    const before = calls.ae;
    await request(app).get("/api/marketplace/admin/sourcing/search?q=earbuds").set(admin());
    expect(calls.ae).toBe(before + 1);
  });

  it("is manager-only", async () => {
    for (const path of ["/overview", "/sellers"]) {
      const res = await request(app).get(`/api/marketplace/admin/sourcing${path}`).set("Authorization", `Bearer ${sellerToken}`);
      expect(res.status).toBe(403);
    }
  });
});
