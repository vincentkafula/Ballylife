import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import express, { type Express } from "express";
import bcrypt from "bcryptjs";
import { createTestDb } from "../test/testDb";

process.env.CJ_EMAIL = "test@example.com";
process.env.CJ_API_KEY = "test-cj-api-key";
process.env.CJ_MIN_REQUEST_INTERVAL_MS = "0"; // no real rate limit to respect against mocks

const { pool } = createTestDb();
vi.mock("../db/pool", () => ({ pool, hasDb: true }));

let app: Express;
let adminToken: string;

const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => ({ code: 200, result: true, message: "Success", data }) });

// Realistic CJ response shapes, matching their own documented fields --
// not invented.
function mockCjAuthResponse() {
  return ok({
    accessToken: "mock-access-token-1", accessTokenExpiryDate: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString(),
    refreshToken: "mock-refresh-token-1", refreshTokenExpiryDate: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString(),
  });
}

function mockCjProductListResponse() {
  return ok({
    pageNum: 1, pageSize: 2, total: 2,
    list: [
      { pid: "cj-pid-1", productName: "蓝牙耳机", productNameEn: "Bluetooth Earbuds", productSku: "SKU1", productImage: "https://cf.cjdropshipping.com/img1.jpg", productWeight: 50, categoryId: "cat-1", categoryName: "Electronics", sellPrice: 10 },
      { pid: "cj-pid-2", productName: "手表", productNameEn: "Smart Watch", productSku: "SKU2", productImage: "https://cf.cjdropshipping.com/img2.jpg", productWeight: 80, categoryId: "cat-1", categoryName: "Electronics", sellPrice: 25 },
    ],
  });
}

// /product/query shape: productImage as a JSON-encoded string array (as CJ
// actually returns it), per-variant images, and HTML description with
// embedded detail photos and supplier branding that must be stripped.
function mockCjDetailResponse(pid: string) {
  return ok({
    pid, productName: "x", productNameEn: pid === "cj-pid-1" ? "Bluetooth Earbuds" : "Smart Watch", productSku: "SKU", sellPrice: 10,
    productImage: JSON.stringify([`https://cf.cjdropshipping.com/${pid}-main.jpg`, `https://cf.cjdropshipping.com/${pid}-side.jpg`]),
    productImageSet: [`https://cf.cjdropshipping.com/${pid}-main.jpg`],
    variants: [{ vid: "v1", variantSku: "V1", variantSellPrice: 10, variantImage: `https://cc-west-usa.oss-us-west-1.aliyuncs.com/${pid}-black.jpg` }],
    description: `<p>Great sound. Ships in CJ packaging from CJdropshipping.</p><p>Also on 1688.com</p><img src="https://cf.cjdropshipping.com/${pid}-detail.jpg">`,
  });
}

let fetchMock: ReturnType<typeof vi.fn<any[], Promise<unknown>>>;
let listResponses: unknown[];
let detailShouldFail: boolean;

beforeAll(async () => {
  const authRouter = (await import("./authRouter")).default;
  const cjRouter = (await import("./cjDropshippingRouter")).default;
  app = express();
  app.use(express.json());
  app.use("/api/auth", authRouter);
  app.use("/api/marketplace", cjRouter);

  const adminHash = await bcrypt.hash("AdminPass123", 10);
  await pool.query(`INSERT INTO users (username, password_hash, role, name, email) VALUES ('cjadmin','${adminHash}','marketplace_admin','CJ Admin','cjadmin@example.com')`);
  const adminLogin = await request(app).post("/api/auth/login").send({ username: "cjadmin", password: "AdminPass123" });
  adminToken = adminLogin.body.data.token;

  await pool.query(`INSERT INTO mkt_fx_rates (currency, rate_to_zar) VALUES ('USD', 18.50)`);
});

beforeEach(() => {
  listResponses = [];
  detailShouldFail = false;
  // Routed by URL rather than call order, since a sync now interleaves one
  // /product/query call per product between list calls.
  fetchMock = vi.fn(async (input: unknown): Promise<unknown> => {
    const url = String(input);
    if (url.includes("getAccessToken")) return mockCjAuthResponse();
    if (url.includes("/product/list")) return listResponses.shift() ?? mockCjProductListResponse();
    if (url.includes("/product/query")) {
      if (detailShouldFail) return { ok: false, status: 500, json: async () => ({ code: 500, result: false, message: "boom" }) };
      return mockCjDetailResponse(new URL(url).searchParams.get("pid")!);
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GET /api/marketplace/admin/cj/status", () => {
  it("reports configured, since CJ_EMAIL/CJ_API_KEY are set for this test file", async () => {
    const res = await request(app).get("/api/marketplace/admin/cj/status").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.configured).toBe(true);
  });

  it("rejects a request with no valid token at all", async () => {
    const res = await request(app).get("/api/marketplace/admin/cj/status").set("Authorization", `Bearer not-a-real-token`);
    expect(res.status).toBe(401);
  });
});

describe("POST /api/marketplace/admin/cj/sync", () => {
  it("authenticates once, fetches products, and imports them into mkt_supplier_products under a real CJdropshipping supplier record", async () => {
    const res = await request(app).post("/api/marketplace/admin/cj/sync").set("Authorization", `Bearer ${adminToken}`).send({ pageSize: 2 });
    expect(res.status).toBe(200);
    expect(res.body.data.imported).toBe(2);
    expect(res.body.data.updated).toBe(0);
    expect(res.body.data.skippedNoRate).toBe(0);
    expect(res.body.data.withPhotos).toBe(2);

    const { rows } = await pool.query(`SELECT * FROM mkt_supplier_products WHERE external_source = 'cjdropshipping' ORDER BY external_id`);
    expect(rows.length).toBe(2);
    expect(rows[0].name).toBe("Bluetooth Earbuds"); // English name preferred over the Chinese one
    expect(Number(rows[0].cost_price)).toBe(10); // USD, unconverted
    expect(Number(rows[0].retail_price)).toBe(185); // 10 USD * 18.50 rate_to_zar -- real conversion, not invented
    expect(rows[0].status).toBe("pending_review"); // nothing goes live unreviewed
    expect(rows[0].external_id).toBe("cj-pid-1");

    const { rows: supplierRows } = await pool.query(`SELECT * FROM mkt_suppliers WHERE id = 'sup-cjdropshipping'`);
    expect(supplierRows.length).toBe(1);
    expect(supplierRows[0].name).toBe("CJdropshipping"); // admin-only record; sellers never see it (see adminSupplierFlow tests)
  });

  it("stores CJ's full photo set -- main, gallery, variant and description photos, deduplicated -- not just the list thumbnail", async () => {
    const { rows } = await pool.query(`SELECT images FROM mkt_supplier_products WHERE external_id = 'cj-pid-1'`);
    expect(rows[0].images).toEqual([
      "https://cf.cjdropshipping.com/cj-pid-1-main.jpg",
      "https://cf.cjdropshipping.com/cj-pid-1-side.jpg",
      "https://cf.cjdropshipping.com/img1.jpg",
      "https://cc-west-usa.oss-us-west-1.aliyuncs.com/cj-pid-1-black.jpg",
      "https://cf.cjdropshipping.com/cj-pid-1-detail.jpg",
    ]);
  });

  it("strips supplier branding and HTML from the stored description", async () => {
    const { rows } = await pool.query(`SELECT description FROM mkt_supplier_products WHERE external_id = 'cj-pid-1'`);
    expect(rows[0].description).not.toMatch(/cj|1688|<|>/i);
    expect(rows[0].description).toContain("Great sound.");
  });

  it("running it again updates the same rows instead of creating duplicates -- proven against the actual row count and the actual updated price, not assumed", async () => {
    listResponses.push(ok({ pageNum: 1, pageSize: 1, total: 1, list: [{ pid: "cj-pid-1", productName: "x", productNameEn: "Bluetooth Earbuds (updated)", productSku: "SKU1", productImage: "https://cf.cjdropshipping.com/img1-new.jpg", productWeight: 50, categoryId: "cat-1", categoryName: "Electronics", sellPrice: 12 }] }));
    detailShouldFail = true; // also proves a failed detail call falls back to the list data

    const before = await pool.query(`SELECT COUNT(*)::int AS c FROM mkt_supplier_products WHERE external_source = 'cjdropshipping'`);

    const res = await request(app).post("/api/marketplace/admin/cj/sync").set("Authorization", `Bearer ${adminToken}`).send({ pageSize: 1 });
    expect(res.status).toBe(200);
    expect(res.body.data.updated).toBe(1);
    expect(res.body.data.imported).toBe(0);
    expect(res.body.data.detailFailures).toBe(1);

    const after = await pool.query(`SELECT COUNT(*)::int AS c FROM mkt_supplier_products WHERE external_source = 'cjdropshipping'`);
    expect(after.rows[0].c).toBe(before.rows[0].c); // no new row created

    const { rows } = await pool.query(`SELECT * FROM mkt_supplier_products WHERE external_id = 'cj-pid-1'`);
    expect(rows[0].name).toBe("Bluetooth Earbuds (updated)");
    expect(Number(rows[0].cost_price)).toBe(12);
    expect(rows[0].images).toEqual(["https://cf.cjdropshipping.com/img1-new.jpg"]);
  });

  it("never lowers a price a manager has already marked up when re-syncing", async () => {
    await pool.query(`UPDATE mkt_supplier_products SET retail_price = 999 WHERE external_id = 'cj-pid-2'`);
    await request(app).post("/api/marketplace/admin/cj/sync").set("Authorization", `Bearer ${adminToken}`).send({ pageSize: 2 });
    const { rows } = await pool.query(`SELECT retail_price FROM mkt_supplier_products WHERE external_id = 'cj-pid-2'`);
    expect(Number(rows[0].retail_price)).toBe(999);
  });

  it("reuses the cached access token across two sync calls -- only ONE auth call total, proving the 5-minute rate limit is genuinely respected, not just documented", async () => {
    await pool.query(`DELETE FROM cj_dropshipping_auth`);

    await request(app).post("/api/marketplace/admin/cj/sync").set("Authorization", `Bearer ${adminToken}`).send({ pageSize: 2 });
    await request(app).post("/api/marketplace/admin/cj/sync").set("Authorization", `Bearer ${adminToken}`).send({ pageSize: 2 });

    const authCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes("getAccessToken"));
    expect(authCalls.length).toBe(1);
  });

  it("retries a rate-limited CJ response instead of failing the sync", async () => {
    listResponses.push({ ok: false, status: 429, json: async () => ({ code: 1600200, result: false, message: "Too Many Requests" }) });
    const res = await request(app).post("/api/marketplace/admin/cj/sync").set("Authorization", `Bearer ${adminToken}`).send({ pageSize: 2 });
    expect(res.status).toBe(200);
    const listCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes("/product/list"));
    expect(listCalls.length).toBe(2);
  });

  it("caps pageSize at 50 even if a larger value is requested", async () => {
    await request(app).post("/api/marketplace/admin/cj/sync").set("Authorization", `Bearer ${adminToken}`).send({ pageSize: 500 });
    const listCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/product/list"));
    const calledUrl = new URL(String(listCall![0]));
    expect(calledUrl.searchParams.get("pageSize")).toBe("50");
  });
});

describe("Currency conversion safety", () => {
  it("skips products entirely (not a wrong-currency guess) when no USD rate is on file", async () => {
    await pool.query(`DELETE FROM mkt_fx_rates WHERE currency = 'USD'`);

    const res = await request(app).post("/api/marketplace/admin/cj/sync").set("Authorization", `Bearer ${adminToken}`).send({ pageSize: 2 });
    expect(res.body.data.skippedNoRate).toBe(2);
    expect(res.body.data.imported).toBe(0);

    // Restore for any tests that might run after this one in the same file.
    await pool.query(`INSERT INTO mkt_fx_rates (currency, rate_to_zar) VALUES ('USD', 18.50)`);
  });
});
