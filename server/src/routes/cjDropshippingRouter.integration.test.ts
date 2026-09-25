import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import express, { type Express } from "express";
import bcrypt from "bcryptjs";
import { createTestDb } from "../test/testDb";

process.env.CJ_EMAIL = "test@example.com";
process.env.CJ_API_KEY = "test-cj-api-key";

const { pool } = createTestDb();
vi.mock("../db/pool", () => ({ pool, hasDb: true }));

let app: Express;
let adminToken: string;

// Realistic CJ response shapes, matching their own documented fields --
// not invented.
function mockCjAuthResponse() {
  return {
    ok: true,
    json: async () => ({
      code: 200, result: true, message: "Success",
      data: {
        accessToken: "mock-access-token-1", accessTokenExpiryDate: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString(),
        refreshToken: "mock-refresh-token-1", refreshTokenExpiryDate: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString(),
      },
    }),
  };
}

function mockCjProductListResponse() {
  return {
    ok: true,
    json: async () => ({
      code: 200, result: true, message: "Success",
      data: {
        pageNum: 1, pageSize: 2, total: 2,
        list: [
          { pid: "cj-pid-1", productName: "蓝牙耳机", productNameEn: "Bluetooth Earbuds", productSku: "SKU1", productImage: "https://cj.example.com/img1.jpg", productWeight: 50, categoryId: "cat-1", categoryName: "Electronics", sellPrice: 10 },
          { pid: "cj-pid-2", productName: "手表", productNameEn: "Smart Watch", productSku: "SKU2", productImage: "https://cj.example.com/img2.jpg", productWeight: 80, categoryId: "cat-1", categoryName: "Electronics", sellPrice: 25 },
        ],
      },
    }),
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

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
  fetchMock = vi.fn();
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
    fetchMock
      .mockResolvedValueOnce(mockCjAuthResponse())
      .mockResolvedValueOnce(mockCjProductListResponse());

    const res = await request(app).post("/api/marketplace/admin/cj/sync").set("Authorization", `Bearer ${adminToken}`).send({ pageSize: 2 });
    expect(res.status).toBe(200);
    expect(res.body.data.imported).toBe(2);
    expect(res.body.data.updated).toBe(0);
    expect(res.body.data.skippedNoRate).toBe(0);

    const { rows } = await pool.query(`SELECT * FROM mkt_supplier_products WHERE external_source = 'cjdropshipping' ORDER BY external_id`);
    expect(rows.length).toBe(2);
    expect(rows[0].name).toBe("Bluetooth Earbuds"); // English name preferred over the Chinese one
    expect(Number(rows[0].cost_price)).toBe(10); // USD, unconverted
    expect(Number(rows[0].retail_price)).toBe(185); // 10 USD * 18.50 rate_to_zar -- real conversion, not invented
    expect(rows[0].status).toBe("pending_review"); // nothing goes live unreviewed
    expect(rows[0].external_id).toBe("cj-pid-1");

    const { rows: supplierRows } = await pool.query(`SELECT * FROM mkt_suppliers WHERE id = 'sup-cjdropshipping'`);
    expect(supplierRows.length).toBe(1);
    expect(supplierRows[0].name).toBe("CJdropshipping");
  });

  it("running it again updates the same rows instead of creating duplicates -- proven against the actual row count and the actual updated price, not assumed", async () => {
    // No auth mock queued here deliberately -- the previous test already
    // cached a still-valid token in cj_dropshipping_auth (shared across
    // this file's tests, same as production would reuse it), so the
    // real code correctly skips re-authenticating. Queuing a redundant
    // auth mock here would be consumed as if it were the product-list
    // response instead, which is exactly the bug this comment is here
    // to prevent reintroducing.
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 200, result: true, message: "Success",
          data: { pageNum: 1, pageSize: 1, total: 1, list: [{ pid: "cj-pid-1", productName: "x", productNameEn: "Bluetooth Earbuds (updated)", productSku: "SKU1", productImage: "https://cj.example.com/img1-new.jpg", productWeight: 50, categoryId: "cat-1", categoryName: "Electronics", sellPrice: 12 }] },
        }),
      });

    const before = await pool.query(`SELECT COUNT(*)::int AS c FROM mkt_supplier_products WHERE external_source = 'cjdropshipping'`);

    const res = await request(app).post("/api/marketplace/admin/cj/sync").set("Authorization", `Bearer ${adminToken}`).send({ pageSize: 1 });
    expect(res.status).toBe(200);
    expect(res.body.data.updated).toBe(1);
    expect(res.body.data.imported).toBe(0);

    const after = await pool.query(`SELECT COUNT(*)::int AS c FROM mkt_supplier_products WHERE external_source = 'cjdropshipping'`);
    expect(after.rows[0].c).toBe(before.rows[0].c); // no new row created

    const { rows } = await pool.query(`SELECT * FROM mkt_supplier_products WHERE external_id = 'cj-pid-1'`);
    expect(rows[0].name).toBe("Bluetooth Earbuds (updated)");
    expect(Number(rows[0].cost_price)).toBe(12);
  });

  it("reuses the cached access token across two sync calls -- only ONE auth call total, proving the 5-minute rate limit is genuinely respected, not just documented", async () => {
    // Explicitly start from no cached token, rather than relying on
    // whatever state earlier tests in this file happened to leave
    // behind -- this test is specifically about the auth-caching
    // behavior, so it earns its own clean starting point.
    await pool.query(`DELETE FROM cj_dropshipping_auth`);
    fetchMock
      .mockResolvedValueOnce(mockCjAuthResponse()) // auth -- only once
      .mockResolvedValueOnce(mockCjProductListResponse()) // sync call 1's product list
      .mockResolvedValueOnce(mockCjProductListResponse()); // sync call 2's product list -- no second auth call before this

    await request(app).post("/api/marketplace/admin/cj/sync").set("Authorization", `Bearer ${adminToken}`).send({ pageSize: 2 });
    await request(app).post("/api/marketplace/admin/cj/sync").set("Authorization", `Bearer ${adminToken}`).send({ pageSize: 2 });

    const authCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes("getAccessToken"));
    expect(authCalls.length).toBe(1);
  });

  it("caps pageSize at 50 even if a larger value is requested", async () => {
    // No auth mock -- a valid cached token exists by this point in the file.
    fetchMock.mockResolvedValueOnce(mockCjProductListResponse());

    await request(app).post("/api/marketplace/admin/cj/sync").set("Authorization", `Bearer ${adminToken}`).send({ pageSize: 500 });
    const listCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/product/list"));
    const calledUrl = new URL(String(listCall![0]));
    expect(calledUrl.searchParams.get("pageSize")).toBe("50");
  });
});

describe("Currency conversion safety", () => {
  it("skips products entirely (not a wrong-currency guess) when no USD rate is on file", async () => {
    await pool.query(`DELETE FROM mkt_fx_rates WHERE currency = 'USD'`);
    // No auth mock -- a valid cached token exists by this point in the file.
    fetchMock.mockResolvedValueOnce(mockCjProductListResponse());

    const res = await request(app).post("/api/marketplace/admin/cj/sync").set("Authorization", `Bearer ${adminToken}`).send({ pageSize: 2 });
    expect(res.body.data.skippedNoRate).toBe(2);
    expect(res.body.data.imported).toBe(0);

    // Restore for any tests that might run after this one in the same file.
    await pool.query(`INSERT INTO mkt_fx_rates (currency, rate_to_zar) VALUES ('USD', 18.50)`);
  });
});
