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
let nextSourcingId = 285;

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
  const japanPartsRouter = (await import("../routes/japanPartsRouter")).default;
  app = express();
  app.use(express.json());
  app.use("/api/auth", authRouter);
  app.use("/api/marketplace", marketplaceRouter);
  app.use("/api/marketplace", router);
  app.use("/api/marketplace", japanPartsRouter);

  await pool.query(`INSERT INTO mkt_categories (id, name, slug, icon) VALUES ('cat-01','Electronics','electronics','📱'), ('cat-03','Home & Garden','home-garden','🏠')`);
  await pool.query(`INSERT INTO mkt_fx_rates (currency, rate_to_zar) VALUES ('USD', 18), ('CNY', 2.5)`);
  const hash = await bcrypt.hash("AdminPass123", 5);
  await pool.query(`INSERT INTO users (username, password_hash, role, name, email) VALUES ('s1688admin','${hash}','marketplace_admin','Admin','s1688@example.com')`);
  adminToken = (await request(app).post("/api/auth/login").send({ username: "s1688admin", password: "AdminPass123" })).body.data.token;
  // Manual CJ hand-off first; automatic sending is covered at the end.
  await s1688.save1688Settings({ listing: { autoSendToCj: false } }, "test");
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
      if (path === "/product/sourcing/create") return cj({ cjSourcingId: String(nextSourcingId++), result: "success" });
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
    expect(o.estimate).toMatchObject({ unitZar: 93.19, resaleZar: 451, unitUsd: 3.54 }); // incl. 5% agent fee + ¥10 China shipping
    expect(o).toMatchObject({ direct_product_id: null, not_listed_reason: "MOQ 2 is above 1" }); // we sell one at a time
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
    sourcingRecords = [{ sourceId: (await offer("700000000001")).cj_sourcing_id, sourceStatus: "5", sourceStatusStr: "Sourcing failed", failReason: 31, failReasonStr: "The product link is invalid" }];
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

describe("Selling 1688 finds directly (China agent), then handing them to CJ", () => {
  const FAN = {
    offerId: "800000000001", title: "USB Desk Fan Rechargeable", url: "https://detail.1688.com/offer/800000000001.html", priceCny: 20, minOrderQuantity: 1,
    soldCount: 90000, supplierYearsOnPlatform: 9, images: ["https://cbu01.alicdn.com/img/fan.jpg"], totalVariants: 2, sourceKeyword: "desk fan",
    sellingPoints: ["3 speeds", "USB-C rechargeable"],
    variants: [{ skuId: "sku-white", skuSpec: "Color:White", price: 20, stock: 500 }, { skuId: "sku-pink", skuSpec: "Color:Pink", price: 24, stock: 3 }],
  };
  let fanProductId: string;

  it("lists an eligible find in the store straight away, priced per option from the estimate", async () => {
    datasetItems = [FAN];
    const out = await s1688.run1688Research({ force: true });
    expect(out.listed).toBe(1);
    const o = await offer("800000000001");
    fanProductId = o.direct_product_id;
    const { rows } = await pool.query(`SELECT * FROM mkt_products WHERE id::text = $1`, [fanProductId]);
    const p = rows[0];
    expect(p).toMatchObject({ source: "1688", source_listing_id: "800000000001", status: "active", delivery_profile: "china_agent", seller_id: "sel-ballylife", original_currency: "CNY" });
    expect(p.variants).toHaveLength(2);
    const [white, pink] = p.variants;
    expect(white).toMatchObject({ value: "Color:White", sku: "sku-white", stock: 20, additionalPrice: 0 }); // stock capped at 20
    expect(pink).toMatchObject({ value: "Color:Pink", sku: "sku-pink", stock: 3 });
    expect(pink.additionalPrice).toBeGreaterThan(0);
    expect(p.description).toContain("USB-C rechargeable");
  });

  it("is white-labelled on the storefront, with the China-agent delivery window", async () => {
    const res = await request(app).get(`/api/marketplace/products/${fanProductId}`);
    const p = res.body.data.product ?? res.body.data;
    expect(p).toMatchObject({ shippingIncluded: true, deliveryDays: { min: 15, max: 25 } });
    expect(JSON.stringify(res.body)).not.toMatch(/1688|alicdn/);
  });

  it("turns a paid order into a buy task with the exact option and 1688 SKU", async () => {
    const { rows: p } = await pool.query(`SELECT variants, name FROM mkt_products WHERE id::text = $1`, [fanProductId]);
    const pink = p[0].variants[1];
    await pool.query(
      `INSERT INTO mkt_orders (order_number, user_id, items, total_amount, status, payment_status) VALUES ('VNK-ORD-CN1', 'u1', $1, 500, 'confirmed', 'payment_confirmed')`,
      [JSON.stringify([{ productId: fanProductId, productName: p[0].name, quantity: 2, variantId: pink.id, variantLabel: pink.value }])]
    );
    const { enqueueJapanPartOrders } = await import("./japanParts");
    expect(await enqueueJapanPartOrders()).toBe(1);
    const res = await request(app).get("/api/marketplace/admin/japan-parts/fulfillments?source=1688").set("Authorization", `Bearer ${adminToken}`);
    expect(res.body.data[0]).toMatchObject({ orderNumber: "VNK-ORD-CN1", source: "1688", quantity: 2, variantLabel: "Color:Pink ×2", supplierSku: "sku-pink", sourceUrl: FAN.url });
    // Not a one-off: stays on sale.
    const { rows } = await pool.query(`SELECT status FROM mkt_products WHERE id::text = $1`, [fanProductId]);
    expect(rows[0].status).toBe("active");
    // And it isn't mixed into the Japan parts queue.
    const jp = await request(app).get("/api/marketplace/admin/japan-parts/fulfillments").set("Authorization", `Bearer ${adminToken}`);
    expect(jp.body.data.find((t: { orderNumber: string }) => t.orderNumber === "VNK-ORD-CN1")).toBeUndefined();
  });

  it("survives the CJ-only catalogue rule", async () => {
    const { enforceCjOnlyCatalog } = await import("./cjCatalog");
    await enforceCjOnlyCatalog();
    const { rows } = await pool.query(`SELECT status FROM mkt_products WHERE id::text = $1`, [fanProductId]);
    expect(rows[0].status).toBe("active");
  });

  it("re-prices listings when the pricing settings change", async () => {
    const before = Number((await pool.query(`SELECT price FROM mkt_products WHERE id::text = $1`, [fanProductId])).rows[0].price);
    const s = await s1688.get1688Settings();
    await s1688.save1688Settings({ ...s, estimate: { ...s.estimate, markupPct: 100 } }, "test");
    const after = Number((await pool.query(`SELECT price FROM mkt_products WHERE id::text = $1`, [fanProductId])).rows[0].price);
    expect(after).toBeGreaterThan(before);
  });

  it("sends listed finds to CJ automatically, best sellers first, within the daily cap", async () => {
    const s = await s1688.get1688Settings();
    await s1688.save1688Settings({ ...s, listing: { ...s.listing, autoSendToCj: true, maxCjRequestsPerDay: 20 } }, "test");
    expect(await s1688.autoSendToCj(await s1688.get1688Settings())).toBe(1);
    expect((await offer("800000000001")).status).toBe("sent_to_cj");
  });

  it("when CJ sources it, CJ's listing takes over and the agent listing is retired", async () => {
    sourcingRecords = [{ sourceId: (await offer("800000000001")).cj_sourcing_id, sourceStatus: "3", sourceStatusStr: "Sourcing succeeded", cjProductId: "cj-pid-1" }];
    await s1688.syncCjSourcing();
    const o = await offer("800000000001");
    expect(o.status).toBe("listed");
    const { rows } = await pool.query(`SELECT status, source_status FROM mkt_products WHERE id::text = $1`, [fanProductId]);
    expect(rows[0]).toMatchObject({ status: "inactive", source_status: "replaced_by_cj" });
    const { rows: cjListing } = await pool.query(`SELECT status FROM mkt_products WHERE id::text = $1`, [o.store_product_id]);
    expect(cjListing[0].status).toBe("active");
  });

  it("a later research run doesn't bring the retired agent listing back", async () => {
    datasetItems = [FAN];
    await s1688.run1688Research({ force: true });
    const { rows } = await pool.query(`SELECT status FROM mkt_products WHERE id::text = $1`, [fanProductId]);
    expect(rows[0].status).toBe("inactive");
  });
});
