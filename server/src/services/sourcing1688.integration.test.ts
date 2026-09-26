import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import express, { type Express } from "express";
import bcrypt from "bcryptjs";
import { createTestDb } from "../test/testDb";

process.env.APIFY_API_TOKEN = "test-apify-token";
process.env.CJ_EMAIL = "test@example.com";
process.env.CJ_API_KEY = "test-cj-api-key";
process.env.CJ_MIN_REQUEST_INTERVAL_MS = "0";

const { pool } = createTestDb();
vi.mock("../db/pool", () => ({ pool, hasDb: true }));

let app: Express;
let adminToken: string;
let s1688: typeof import("./sourcing1688");
let fetchMock: ReturnType<typeof vi.fn<any[], Promise<unknown>>>;

// What the Apify actor and CJ return in each test.
let datasetItems: unknown[] = [];
let runStatus = "SUCCEEDED";
let sourcingRecords: unknown[] = [];
const cjCalls: { path: string; body?: unknown }[] = [];

const EARBUDS = {
  offerId: "617247852601", title: "Wireless Bluetooth Earphones TWS", url: "https://detail.1688.com/offer/617247852601.html",
  priceCny: 25.5, minOrderQuantity: 2, soldCount: 12000, supplierName: "Shenzhen Audio Co.", supplierYearsOnPlatform: 8,
  images: ["https://cbu01.alicdn.com/img/a.jpg"], sourceKeyword: "bluetooth earphone",
};
const LAMP = { ...EARBUDS, offerId: "700000000001", title: "LED Desk Lamp", priceCny: 30, soldCount: 500, sourceKeyword: "led lamp" };

const json = (data: unknown, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(data), json: async () => data });
const cj = (data: unknown) => json({ code: 200, result: true, message: "Success", data });

const offer = async (offerId: string) => (await pool.query(`SELECT * FROM sourcing_1688_offers WHERE offer_id = $1`, [offerId])).rows[0];
const lastRun = async () => (await pool.query(`SELECT * FROM sourcing_1688_runs ORDER BY started_at DESC LIMIT 1`)).rows[0];

beforeAll(async () => {
  s1688 = await import("./sourcing1688");
  const authRouter = (await import("../routes/authRouter")).default;
  const marketplaceRouter = (await import("../routes/marketplaceRouter")).default;
  const router = (await import("../routes/sourcing1688Router")).default;
  app = express();
  app.use(express.json());
  app.use("/api/auth", authRouter);
  app.use("/api/marketplace", marketplaceRouter);
  app.use("/api/marketplace", router);

  await pool.query(`INSERT INTO mkt_categories (id, name, slug, icon) VALUES ('cat-01','Electronics','electronics','📱'), ('cat-03','Home & Garden','home-garden','🏠')`);
  await pool.query(`INSERT INTO mkt_fx_rates (currency, rate_to_zar) VALUES ('USD', 18), ('CNY', 2.5)`);
  const hash = await bcrypt.hash("AdminPass123", 5);
  await pool.query(`INSERT INTO users (username, password_hash, role, name, email) VALUES ('s1688admin','${hash}','marketplace_admin','Admin','s1688@example.com')`);
  adminToken = (await request(app).post("/api/auth/login").send({ username: "s1688admin", password: "AdminPass123" })).body.data.token;
});

beforeEach(() => {
  runStatus = "SUCCEEDED";
  fetchMock = vi.fn(async (input: unknown, init?: RequestInit): Promise<unknown> => {
    const url = new URL(String(input));
    if (url.hostname === "api.apify.com") {
      if (url.pathname.endsWith("/runs")) return json({ data: { id: "run-1", status: "RUNNING", defaultDatasetId: "ds-1" } });
      if (url.pathname.startsWith("/v2/actor-runs/")) return json({ data: { id: "run-1", status: runStatus, statusMessage: runStatus === "FAILED" ? "Blocked by captcha" : null, defaultDatasetId: "ds-1" } });
      if (url.pathname.startsWith("/v2/datasets/ds-1/items")) return json(datasetItems);
    }
    if (url.hostname.includes("cjdropshipping")) {
      const path = url.pathname.replace(/^.*\/v1/, "");
      cjCalls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (path.includes("getAccessToken")) return cj({ accessToken: "t", accessTokenExpiryDate: new Date(Date.now() + 864e5).toISOString(), refreshToken: "r", refreshTokenExpiryDate: new Date(Date.now() + 864e5).toISOString() });
      if (path === "/product/sourcing/create") return cj({ cjSourcingId: "285", result: "success" });
      if (path === "/product/sourcing/queryList") return cj(sourcingRecords);
      if (path === "/product/query") return cj({
        pid: "cj-pid-1", productNameEn: "Wireless Earbuds TWS", categoryName: "Earphones", sellPrice: 4,
        productImageSet: ["https://cf.cjdropshipping.com/e1.jpg"], variants: [{ vid: "vid-1", variantKey: "Black", variantSellPrice: 4, inventories: [{ totalInventory: 100 }] }],
      });
      if (path === "/logistic/freightCalculate") return cj([{ logisticName: "A", logisticPrice: 3 }]);
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("1688 research", () => {
  it("is admin-only, starts switched off, and never exposes the token", async () => {
    expect((await request(app).get("/api/marketplace/admin/sourcing-1688/settings")).status).toBe(401);
    const res = await request(app).get("/api/marketplace/admin/sourcing-1688/settings").set("Authorization", `Bearer ${adminToken}`);
    expect(res.body.data.settings.enabled).toBe(false);
    expect(res.body.data.apifyConfigured).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain("test-apify-token");
  });

  it("doesn't fetch anything on the schedule while switched off", async () => {
    await s1688.run1688Tick();
    expect(fetchMock.mock.calls.filter(([u]) => String(u).includes("apify"))).toHaveLength(0);
  });

  it("runs all enabled keywords in one actor run and stores offers with an SA estimate", async () => {
    datasetItems = [EARBUDS, LAMP];
    const out = await s1688.run1688Research({ force: true });
    expect(out).toMatchObject({ ran: true, status: "ok", created: 2 });

    const [startUrl, startInit] = fetchMock.mock.calls.find(([u]) => String(u).includes("/runs?"))! as [string, RequestInit];
    expect(startUrl).toContain("/acts/sourabhbgp~1688-scraper/runs");
    expect((startInit.headers as Record<string, string>).Authorization).toBe("Bearer test-apify-token");
    expect(JSON.parse(String(startInit.body))).toMatchObject({ mode: "search", supplierYears: "5", keywords: expect.arrayContaining(["bluetooth earphone"]) });

    const o = await offer("617247852601");
    expect(o).toMatchObject({ status: "new", moq: 2, supplier_years: 8, product_class: "electronics" });
    expect(o.estimate).toMatchObject({ unitZar: 63.75, resaleZar: 392, unitUsd: 3.54 });
  });

  it("updates offers on the next run instead of duplicating them", async () => {
    datasetItems = [{ ...EARBUDS, priceCny: 22 }];
    await s1688.run1688Research({ force: true });
    const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM sourcing_1688_offers`);
    expect(rows[0].n).toBe(2);
    expect(Number((await offer("617247852601")).price_cny)).toBe(22);
  });

  it("records a failed actor run (e.g. blocked) instead of throwing", async () => {
    runStatus = "FAILED";
    const out = await s1688.run1688Research({ force: true });
    expect(out.status).toBe("failed");
    expect((await lastRun()).error).toMatch(/^blocked: Actor run FAILED: Blocked by captcha/);
  });

  it("flags output it can't read as a schema change and stores nothing from it", async () => {
    datasetItems = [{ a: 1 }, { a: 2 }, { a: 3 }];
    await s1688.run1688Research({ force: true });
    const run = await lastRun();
    expect(run.status).toBe("schema_changed");
    expect(run.error).toContain("Fields received: a");
  });

  it("lists offers for admins, best sellers first", async () => {
    const res = await request(app).get("/api/marketplace/admin/sourcing-1688/offers").set("Authorization", `Bearer ${adminToken}`);
    expect(res.body.data.map((o: { offerId: string }) => o.offerId)).toEqual(["617247852601", "700000000001"]);
  });

  it("lets admins shortlist and dismiss", async () => {
    const lamp = await offer("700000000001");
    const res = await request(app).patch(`/api/marketplace/admin/sourcing-1688/offers/${lamp.id}`).set("Authorization", `Bearer ${adminToken}`).send({ status: "dismissed" });
    expect(res.body.data.status).toBe("dismissed");
    expect((await request(app).patch(`/api/marketplace/admin/sourcing-1688/offers/${lamp.id}`).set("Authorization", `Bearer ${adminToken}`).send({ status: "listed" })).status).toBe(400);
  });
});

describe("CJ sourcing", () => {
  it("sends a pick to CJ as a sourcing request with the 1688 link, photo and a USD target price", async () => {
    const o = await offer("617247852601");
    const res = await request(app).post(`/api/marketplace/admin/sourcing-1688/offers/${o.id}/send-to-cj`).set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: "sent_to_cj", cjSourcingId: "285" });
    const call = cjCalls.find(c => c.path === "/product/sourcing/create")!;
    expect(call.body).toMatchObject({
      productName: "Wireless Bluetooth Earphones TWS", productImage: "https://cbu01.alicdn.com/img/a.jpg",
      productUrl: "https://detail.1688.com/offer/617247852601.html", thirdProductId: "617247852601", price: 3.06, // ¥22 x 2.5 / 18
    });
  });

  it("won't send the same offer twice", async () => {
    const o = await offer("617247852601");
    expect((await request(app).post(`/api/marketplace/admin/sourcing-1688/offers/${o.id}/send-to-cj`).set("Authorization", `Bearer ${adminToken}`)).status).toBe(409);
  });

  it("while CJ is still working on it, just records CJ's status", async () => {
    sourcingRecords = [{ sourceId: "285", sourceStatus: "1", sourceStatusStr: "Sourcing in progress" }];
    await s1688.syncCjSourcing();
    expect(await offer("617247852601")).toMatchObject({ status: "sent_to_cj", cj_sourcing_status: "Sourcing in progress" });
  });

  it("once CJ has sourced it, imports the CJ product and lists it in the Ballylife store", async () => {
    sourcingRecords = [{ sourceId: "285", sourceStatus: "3", sourceStatusStr: "Sourcing succeeded", cjProductId: "cj-pid-1" }];
    const out = await s1688.syncCjSourcing();
    expect(out).toMatchObject({ sourced: 1, listed: 1 });
    const o = await offer("617247852601");
    expect(o).toMatchObject({ status: "listed", cj_product_id: "cj-pid-1" });
    const { rows } = await pool.query(`SELECT name, status, delivery_profile FROM mkt_products WHERE id::text = $1`, [o.store_product_id]);
    expect(rows[0]).toMatchObject({ status: "active", delivery_profile: "international" });
  });

  it("records CJ's reason when sourcing fails, and allows resending", async () => {
    await pool.query(`UPDATE sourcing_1688_offers SET status = 'shortlisted', cj_sourcing_id = NULL WHERE offer_id = '700000000001'`);
    const lamp = await offer("700000000001");
    await request(app).post(`/api/marketplace/admin/sourcing-1688/offers/${lamp.id}/send-to-cj`).set("Authorization", `Bearer ${adminToken}`);
    sourcingRecords = [{ sourceId: "285", sourceStatus: "5", sourceStatusStr: "Sourcing failed", failReason: 31, failReasonStr: "The product link is invalid" }];
    await s1688.syncCjSourcing();
    expect(await offer("700000000001")).toMatchObject({ status: "sourcing_failed", cj_fail_reason: "The product link is invalid" });
    const again = await request(app).post(`/api/marketplace/admin/sourcing-1688/offers/${lamp.id}/send-to-cj`).set("Authorization", `Bearer ${adminToken}`);
    expect(again.status).toBe(200);
  });

  it("nothing from 1688 is visible on the storefront", async () => {
    const res = await request(app).get("/api/marketplace/products?limit=50");
    expect(JSON.stringify(res.body)).not.toMatch(/1688|alicdn|Shenzhen Audio/);
  });
});
