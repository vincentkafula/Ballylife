import { describe, it, expect, beforeAll, vi } from "vitest";
import request from "supertest";
import express, { type Express } from "express";
import bcrypt from "bcryptjs";
import { createTestDb } from "../test/testDb";
import type { SupplierAdapter } from "../services/sourcing/types";

// PayFast's public sandbox test merchant (read when the PayFast module loads, below).
process.env.PAYFAST_MERCHANT_ID = "10000100";
process.env.PAYFAST_MERCHANT_KEY = "46f0cd694581a";
process.env.PAYFAST_MODE = "sandbox";
process.env.MARKETPLACE_PUBLIC_URL = "https://www.ballylife.com";
process.env.MARKETPLACE_API_PUBLIC_URL = "https://api.example.test";

const { pool } = createTestDb();
vi.mock("../db/pool", () => ({ pool, hasDb: true }));

const fake: SupplierAdapter = {
  key: "aliexpress", isConfigured: () => true, costPerCall: {},
  catalogue: { supplierId: "sup-aliexpress", source: "aliexpress", async ensureSupplier() { /* unused */ } },
  async search() { return [{ externalId: "1", title: "Phone Stand", cost: 3, currency: "USD", image: null, orders: null, rating: null }]; },
  async getProduct() { throw new Error("unused"); },
  async getShipping() { return null; },
};

let app: Express;
let adminToken: string;
let sellerToken: string;
let sellerId: string;
const admin = () => ({ Authorization: `Bearer ${adminToken}` });
const seller = () => ({ Authorization: `Bearer ${sellerToken}` });
const search = () => request(app).get("/api/marketplace/sourcing/search?q=stand").set(seller());

beforeAll(async () => {
  (await import("../services/sourcing/adapters"))._setAdaptersForTests([fake]);
  const authRouter = (await import("./authRouter")).default;
  const marketplaceRouter = (await import("./marketplaceRouter")).default;
  const sourcingRouter = (await import("./sourcingRouter")).default;
  app = express();
  app.use(express.json());
  app.use("/api/auth", authRouter);
  app.use("/api/marketplace", marketplaceRouter);
  app.use("/api/marketplace", sourcingRouter);

  await pool.query(`INSERT INTO mkt_fx_rates (currency, rate_to_zar) VALUES ('USD', 18)`);
  const hash = await bcrypt.hash("AdminPass123", 10);
  await pool.query(`INSERT INTO users (username, password_hash, role, name, email) VALUES ('billadmin','${hash}','marketplace_admin','Admin','billadmin@example.com')`);
  adminToken = (await request(app).post("/api/auth/login").send({ username: "billadmin", password: "AdminPass123" })).body.data.token;
  const reg = await request(app).post("/api/marketplace/sellers/register").send({
    username: "billseller", password: "SellerPass123", name: "S", email: "billseller@example.com", storeName: "Bill Store",
  });
  sellerToken = reg.body.token; sellerId = reg.body.seller.id;
  await pool.query(`UPDATE mkt_sellers SET status = 'active' WHERE id = $1`, [sellerId]);
});

describe("Seller sourcing subscription (PayFast, behind a switch)", () => {
  it("is off by default: sourcing is free", async () => {
    const q = await request(app).get("/api/marketplace/sourcing/quota").set(seller());
    expect(q.body.data.billing).toMatchObject({ required: false, hasAccess: true, priceZar: 1850, subscription: null });
    expect((await search()).status).toBe(200);
    const sub = await request(app).post("/api/marketplace/sourcing/billing/subscribe").set(seller());
    expect(sub.status).toBe(409);
  });

  it("when a manager switches it on, sourcing needs a subscription", async () => {
    const bad = await request(app).patch("/api/marketplace/admin/sourcing/billing").set(admin()).send({ priceZar: 1 });
    expect(bad.status).toBe(400);
    const on = await request(app).patch("/api/marketplace/admin/sourcing/billing").set(admin()).send({ enabled: true });
    expect(on.status).toBe(200);
    expect(on.body.data).toEqual({ enabled: true, priceZar: 1850 });
    const s = await search();
    expect(s.status).toBe(402);
    expect(s.body.code).toBe("SOURCING_SUBSCRIPTION_REQUIRED");
    const sellerCant = await request(app).patch("/api/marketplace/admin/sourcing/billing").set(seller()).send({ enabled: false });
    expect(sellerCant.status).toBe(403);
  });

  let subscriptionId: string;
  it("subscribing sends the seller to PayFast for a monthly card subscription", async () => {
    const res = await request(app).post("/api/marketplace/sourcing/billing/subscribe").set(seller());
    expect(res.status).toBe(200);
    const f = res.body.data.redirect.fields;
    expect(f.m_payment_id).toBe(`ssub_${res.body.data.subscriptionId}`);
    expect(f).toMatchObject({ amount: "1850.00", recurring_amount: "1850.00", subscription_type: "1", frequency: "3", cycles: "0" });
    expect(f.item_name).toBe("Ballylife product sourcing (monthly)");
    expect(f.return_url).toMatch(/\?sourcing=success$/);
    expect(f.signature).toMatch(/^[a-f0-9]{32}$/);
    subscriptionId = res.body.data.subscriptionId;
    expect((await search()).status).toBe(402); // not paid yet
  });

  it("PayFast's payment notification activates it (and a repeated notification is ignored)", async () => {
    const { handleSellerSubscriptionItn } = await import("../services/sourcing/billing");
    const itn = { m_payment_id: `ssub_${subscriptionId}`, payment_status: "COMPLETE", amount_gross: "1850.00", token: "tok-123", pf_payment_id: "pf-1" };
    await handleSellerSubscriptionItn(itn);
    await handleSellerSubscriptionItn(itn);
    const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM seller_sourcing_payments`);
    expect(rows[0].n).toBe(1);
    expect((await search()).status).toBe(200);
    const q = await request(app).get("/api/marketplace/sourcing/quota").set(seller());
    expect(q.body.data.billing.subscription).toMatchObject({ status: "active", priceZar: 1850 });
  });

  it("a price change applies to new subscribers only", async () => {
    await request(app).patch("/api/marketplace/admin/sourcing/billing").set(admin()).send({ priceZar: 1999 });
    const q = await request(app).get("/api/marketplace/sourcing/quota").set(seller());
    expect(q.body.data.billing.priceZar).toBe(1999);
    expect(q.body.data.billing.subscription.priceZar).toBe(1850);
  });

  it("cancelling stops the card and keeps access to the end of the paid month", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => { calls.push(String(url)); return new Response("{}", { status: 200 }); });
    const res = await request(app).post("/api/marketplace/sourcing/billing/cancel").set(seller());
    vi.unstubAllGlobals();
    expect(res.status).toBe(200);
    expect(calls.some(u => u.includes("/subscriptions/tok-123/cancel"))).toBe(true);
    expect((await search()).status).toBe(200);

    const { runSellerBillingMaintenance } = await import("../services/sourcing/billing");
    await runSellerBillingMaintenance(new Date(Date.now() + 40 * 86400_000));
    const { rows } = await pool.query(`SELECT status FROM seller_sourcing_subscriptions WHERE id = $1`, [subscriptionId]);
    expect(rows[0].status).toBe("cancelled");
    expect((await search()).status).toBe(402);
  });

  it("a manager can give a store free access, and sees billing in the dashboard", async () => {
    const res = await request(app).patch(`/api/marketplace/admin/sourcing/sellers/${sellerId}/billing-exempt`).set(admin()).send({ exempt: true });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ exempt: true, hasAccess: true });
    expect((await search()).status).toBe(200);
    const overview = await request(app).get("/api/marketplace/admin/sourcing/overview").set(admin());
    expect(overview.body.data.billing).toMatchObject({ enabled: true, priceZar: 1999, exempt: 1, active: 0 });
    const sellers = await request(app).get("/api/marketplace/admin/sourcing/sellers").set(admin());
    expect(sellers.body.data.find((r: { sellerId: string }) => r.sellerId === sellerId).billing).toBe("exempt");
  });
});
