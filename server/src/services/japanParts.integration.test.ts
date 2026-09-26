import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import express, { type Express } from "express";
import bcrypt from "bcryptjs";
import { createTestDb } from "../test/testDb";
import { registerAndVerifyCustomer } from "../test/authHelpers";

process.env.APIFY_API_TOKEN = "test-apify-token";

const { pool } = createTestDb();
vi.mock("../db/pool", () => ({ pool, hasDb: true }));

let app: Express;
let adminToken: string;
let customerToken: string;
let jp: typeof import("./japanParts");
let apifyItems: unknown = [];
let apifyStatus = 200;
let fetchMock: ReturnType<typeof vi.fn>;

const WHEEL = { id: "UG-1", name: "RAYS VOLK TE37 17インチ", priceTaxIncluded: "¥55,000", condition: "B", shopName: "UP-GARAGE 横浜店", prefecture: "神奈川県", maker: "Toyota", carModel: "86", images: ["https://img.upgarage.com/1.jpg"], url: "https://www.upgarage.com/goods/UG-1" };
const SEAT = { id: "UG-2", name: "レカロ SR-7", priceTaxIncluded: "¥33,000", condition: "C", images: ["https://img.upgarage.com/2.jpg"], url: "https://www.upgarage.com/goods/UG-2" };

const productBySource = async (listingId: string) => (await pool.query(`SELECT * FROM mkt_products WHERE source = 'upgarage' AND source_listing_id = $1`, [listingId])).rows[0];
const lastRun = async () => (await pool.query(`SELECT * FROM jp_parts_refresh_runs ORDER BY started_at DESC LIMIT 1`)).rows[0];

beforeAll(async () => {
  jp = await import("./japanParts");
  const authRouter = (await import("../routes/authRouter")).default;
  const marketplaceRouter = (await import("../routes/marketplaceRouter")).default;
  const japanPartsRouter = (await import("../routes/japanPartsRouter")).default;
  app = express();
  app.use(express.json());
  app.use("/api/auth", authRouter);
  app.use("/api/marketplace", marketplaceRouter);
  app.use("/api/marketplace", japanPartsRouter);

  await pool.query(`INSERT INTO mkt_fx_rates (currency, rate_to_zar) VALUES ('JPY', 0.12)`);
  await pool.query(`INSERT INTO mkt_tax_rates (country, vat_rate_pct, default_duty_rate_pct) VALUES ('ZA', 15, 20)`);
  const adminHash = await bcrypt.hash("AdminPass123", 5);
  await pool.query(`INSERT INTO users (username, password_hash, role, name, email) VALUES ('jpadmin','${adminHash}','marketplace_admin','Admin','jpadmin@example.com')`);
  adminToken = (await request(app).post("/api/auth/login").send({ username: "jpadmin", password: "AdminPass123" })).body.data.token;
  customerToken = (await registerAndVerifyCustomer(app, pool, { username: "jpcustomer", email: "jpcustomer@example.com" })).token;
});

beforeEach(() => {
  apifyStatus = 200;
  fetchMock = vi.fn(async (input: unknown) => {
    const url = String(input);
    if (!url.startsWith("https://api.apify.com/")) throw new Error(`unexpected fetch ${url}`);
    const body = JSON.stringify(apifyItems);
    return { ok: apifyStatus < 400, status: apifyStatus, text: async () => body };
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("Admin settings", () => {
  it("are admin-only", async () => {
    expect((await request(app).get("/api/marketplace/admin/japan-parts/settings")).status).toBe(401);
    expect((await request(app).get("/api/marketplace/admin/japan-parts/settings").set("Authorization", `Bearer ${customerToken}`)).status).toBe(403);
  });

  it("start switched off, and say whether the Apify token is set without ever returning it", async () => {
    const res = await request(app).get("/api/marketplace/admin/japan-parts/settings").set("Authorization", `Bearer ${adminToken}`);
    expect(res.body.data.settings.enabled).toBe(false);
    expect(res.body.data.apifyConfigured).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain("test-apify-token");
  });

  it("does nothing on the schedule while switched off -- no actor calls, nothing billed", async () => {
    await jp.runJapanPartsTick();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("saves keywords and pricing", async () => {
    const res = await request(app).put("/api/marketplace/admin/japan-parts/settings").set("Authorization", `Bearer ${adminToken}`).send({
      settings: {
        enabled: true, maxItemsPerKeyword: 20, refreshHours: 24, markupPct: 30, forwarderFeeZar: 150, dutyPct: 20, vatPct: 15, vatUpliftPct: 10,
        freightByCategory: { wheels: 1800, seats: 1600 }, defaultFreightZar: 900,
        keywords: [{ keyword: "ホイール", label: "Wheels", partsCategory: "wheels", enabled: true }],
      },
    });
    expect(res.status).toBe(200);
    expect(res.body.data.settings.keywords).toHaveLength(1);
  });
});

describe("Refresh", () => {
  it("lists new parts at the final rand price, with the actor called server-side with our token", async () => {
    apifyItems = [WHEEL, SEAT];
    await jp.runJapanPartsTick();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("fruitful_quintessence~upgarage-parts-scraper/run-sync-get-dataset-items");
    expect(url).not.toContain("token");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-apify-token");
    expect(JSON.parse(String(init.body))).toMatchObject({ searchKeyword: "ホイール", maxItems: 20 });

    const wheel = await productBySource("UG-1");
    expect(wheel).toMatchObject({ category_id: "cat-jp-parts", status: "active", stock: 1, condition: "used", condition_grade: "B", source_status: "listed", delivery_profile: "japan_import", original_currency: "JPY" });
    expect(Number(wheel.price)).toBe(15043); // see japanPartsPricing.test.ts for the working
    expect(Number(wheel.original_price_tax_incl)).toBe(55000);
    expect(wheel.name).toBe("Wheels — RAYS VOLK TE37 17インチ");
    expect(await lastRun()).toMatchObject({ keyword: "ホイール", status: "ok", created: 2 });
  });

  it("shows shoppers the condition and Japan origin -- but never the UP-GARAGE link or our margins", async () => {
    const wheel = await productBySource("UG-1");
    const res = await request(app).get(`/api/marketplace/products/${wheel.id}`);
    const p = res.body.data.product ?? res.body.data;
    expect(p.japanPart).toMatchObject({ conditionGrade: "B", fitment: "Toyota 86", location: "神奈川県", stillListedInJapan: true });
    expect(p).toMatchObject({ shippingIncluded: true, deliveryDays: { min: 15, max: 30 } });
    expect(JSON.stringify(res.body)).not.toContain("upgarage.com/goods");
    expect(JSON.stringify(res.body)).not.toContain("landedZar");
  });

  it("doesn't refresh again before the interval is up", async () => {
    await jp.runJapanPartsTick();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("updates listings instead of duplicating them, and follows price changes", async () => {
    apifyItems = [{ ...WHEEL, priceTaxIncluded: "¥44,000" }, SEAT];
    await jp.refreshJapanParts({ force: true });
    const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM mkt_products WHERE source = 'upgarage'`);
    expect(rows[0].n).toBe(2);
    expect(Number((await productBySource("UG-1")).original_price_tax_incl)).toBe(44000);
    expect(await lastRun()).toMatchObject({ status: "ok", created: 0, updated: 2 });
  });

  it("takes a part off sale when UP-GARAGE shows it sold out", async () => {
    apifyItems = [WHEEL, { ...SEAT, status: "売り切れ" }];
    await jp.refreshJapanParts({ force: true });
    expect(await productBySource("UG-2")).toMatchObject({ status: "out_of_stock", stock: 0, source_status: "removed" });
  });

  it("brings it back if it reappears", async () => {
    apifyItems = [WHEEL, SEAT];
    await jp.refreshJapanParts({ force: true });
    expect(await productBySource("UG-2")).toMatchObject({ status: "active", stock: 1, source_status: "listed" });
  });

  it("only takes down a missing part after it's been missing for two refreshes", async () => {
    apifyItems = [WHEEL];
    await jp.refreshJapanParts({ force: true });
    expect((await productBySource("UG-2")).status).toBe("active"); // seen minutes ago: could just be a ranking wobble

    await pool.query(`UPDATE mkt_products SET source_last_seen_at = $1 WHERE source_listing_id = 'UG-2'`, [new Date(Date.now() - 48 * 3600_000)]);
    await jp.refreshJapanParts({ force: true });
    expect(await productBySource("UG-2")).toMatchObject({ status: "out_of_stock", source_status: "removed" });
  });

  it("an empty result proves nothing: listings stay up and the run is flagged", async () => {
    apifyItems = [];
    await pool.query(`UPDATE mkt_products SET source_last_seen_at = $1 WHERE source_listing_id = 'UG-1'`, [new Date(Date.now() - 48 * 3600_000)]);
    await jp.refreshJapanParts({ force: true });
    expect((await productBySource("UG-1")).status).toBe("active");
    expect((await lastRun()).status).toBe("empty");
  });

  it("output it can't read is flagged as a schema change, with the fields it got, and touches nothing", async () => {
    apifyItems = [{ foo: 1, bar: 2 }, { foo: 3 }, { foo: 4 }];
    await jp.refreshJapanParts({ force: true });
    const run = await lastRun();
    expect(run.status).toBe("schema_changed");
    expect(run.error).toContain("foo");
    expect((await productBySource("UG-1")).status).toBe("active");
  });

  it("an Apify failure is logged and skipped, not thrown", async () => {
    apifyStatus = 403;
    apifyItems = { error: { message: "Actor run failed: 403 Forbidden from target site" } };
    const out = await jp.refreshJapanParts({ force: true });
    expect(out.ran).toBe(true);
    const run = await lastRun();
    expect(run.status).toBe("failed");
    expect(run.error).toMatch(/^blocked: Apify 403/);
    expect((await productBySource("UG-1")).status).toBe("active");
  });

  it("re-prices every listing from its yen price when pricing settings change", async () => {
    apifyItems = [WHEEL];
    await jp.refreshJapanParts({ force: true });
    const settings = (await request(app).get("/api/marketplace/admin/japan-parts/settings").set("Authorization", `Bearer ${adminToken}`)).body.data.settings;
    const res = await request(app).put("/api/marketplace/admin/japan-parts/settings").set("Authorization", `Bearer ${adminToken}`).send({ settings: { ...settings, markupPct: 0 } });
    expect(res.body.data.repriced).toBeGreaterThan(0);
    expect(Number((await productBySource("UG-1")).price)).toBe(11571); // landed cost, no markup
  });

  it("survives the CJ-only catalogue rule", async () => {
    const { enforceCjOnlyCatalog } = await import("./cjCatalog");
    await enforceCjOnlyCatalog();
    expect((await productBySource("UG-1")).status).toBe("active");
  });
});

describe("Fulfilment (buy in Japan, forward, track)", () => {
  let orderId: string;
  let taskId: string;

  it("turns a paid order line into a buy task and takes the one-off part off sale", async () => {
    const wheel = await productBySource("UG-1");
    const { rows } = await pool.query(
      `INSERT INTO mkt_orders (order_number, user_id, items, total_amount, status, payment_status) VALUES ('VNK-ORD-JP1', 'u1', $1, 17299, 'confirmed', 'payment_confirmed') RETURNING id`,
      [JSON.stringify([{ productId: wheel.id, productName: wheel.name, quantity: 1 }])]
    );
    orderId = rows[0].id;
    expect(await jp.enqueueJapanPartOrders()).toBe(1);
    expect(await jp.enqueueJapanPartOrders()).toBe(0); // idempotent
    expect(await productBySource("UG-1")).toMatchObject({ stock: 0, status: "out_of_stock" });

    const res = await request(app).get("/api/marketplace/admin/japan-parts/fulfillments").set("Authorization", `Bearer ${adminToken}`);
    expect(res.body.data[0]).toMatchObject({ orderNumber: "VNK-ORD-JP1", status: "to_buy", sourceUrl: "https://www.upgarage.com/goods/UG-1" });
    taskId = res.body.data[0].id;
  });

  it("a refresh never relists a part we sold", async () => {
    apifyItems = [WHEEL];
    await jp.refreshJapanParts({ force: true });
    expect(await productBySource("UG-1")).toMatchObject({ stock: 0, status: "out_of_stock" });
  });

  it("needs a tracking number to mark it shipped, then gives the customer tracking", async () => {
    const url = `/api/marketplace/admin/japan-parts/fulfillments/${taskId}`;
    expect((await request(app).patch(url).set("Authorization", `Bearer ${adminToken}`).send({ status: "shipped" })).status).toBe(400);
    const res = await request(app).patch(url).set("Authorization", `Bearer ${adminToken}`).send({ status: "shipped", trackingNumber: "JP123456789", carrier: "Japan Post EMS" });
    expect(res.status).toBe(200);
    const { rows } = await pool.query(`SELECT tracking_number, carrier, shipping_status FROM mkt_orders WHERE id = $1`, [orderId]);
    expect(rows[0]).toMatchObject({ tracking_number: "JP123456789", carrier: "Japan Post EMS", shipping_status: "in_transit" });
  });

  it("delivering the only line closes the order", async () => {
    await request(app).patch(`/api/marketplace/admin/japan-parts/fulfillments/${taskId}`).set("Authorization", `Bearer ${adminToken}`).send({ status: "delivered" });
    const { rows } = await pool.query(`SELECT status, shipping_status FROM mkt_orders WHERE id = $1`, [orderId]);
    expect(rows[0]).toMatchObject({ status: "delivered", shipping_status: "delivered" });
  });

  it("rejects unknown statuses", async () => {
    const res = await request(app).patch(`/api/marketplace/admin/japan-parts/fulfillments/${taskId}`).set("Authorization", `Bearer ${adminToken}`).send({ status: "teleported" });
    expect(res.status).toBe(400);
  });
});
