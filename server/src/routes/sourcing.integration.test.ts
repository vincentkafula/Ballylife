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
  async search() {
    calls.ae++;
    return [{ externalId: "1005001234567890", title: "AliExpress Wireless Earbuds", cost: 10, currency: "USD", image: "https://ae01.alicdn.com/kf/earbuds.jpg", orders: 500, rating: 4.8 }];
  },
  async getProduct(id) {
    return {
      externalId: id, title: "Wireless Earbuds", description: "Great sound. Visit https://www.aliexpress.com/item/1005001234567890.html for more. Sold on AliExpress.",
      images: ["https://ae01.alicdn.com/kf/earbuds.jpg", "https://evil.example.com/x.jpg"], currency: "USD", category: "Audio", available: true,
      variants: [{ externalSku: "12000012345", label: "Black", cost: 10, stock: 40, image: "https://ae01.alicdn.com/kf/black.jpg" }],
    };
  },
  async getShipping() { return { cost: 2, currency: "USD", minDays: 7, maxDays: 15 }; },
  async placeOrder() { throw new Error("no"); }, async trackOrder() { throw new Error("no"); },
};
const fakeCj: SupplierAdapter = {
  key: "cj", isConfigured: () => true, costPerCall: {},
  async search() {
    calls.cj++;
    return [{ externalId: "CJ-PID-777", title: "Phone Stand", cost: 3, currency: "USD", image: "https://cf.cjdropshipping.com/stand.jpg", orders: null, rating: null }];
  },
  async getProduct() { throw new Error("unused"); }, async getShipping() { return null; },
  async placeOrder() { throw new Error("no"); }, async trackOrder() { throw new Error("no"); },
};

// Words, ids and hosts that must never reach a seller or buyer.
const LEAKS = [/aliexpress/i, /alicdn/i, /cjdropshipping/i, /\bcj\b/i, /1005001234567890/, /12000012345/, /CJ-PID-777/, /evil\.example/, /https?:\/\//i];
const expectNoLeaks = (body: unknown) => { const s = JSON.stringify(body); for (const re of LEAKS) expect(s).not.toMatch(re); };

let app: Express;
let adminToken: string;
let sellerToken: string;
let buyerToken: string;

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
  sellerToken = reg.body.token;
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
