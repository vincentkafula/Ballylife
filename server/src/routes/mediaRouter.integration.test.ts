import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import { createTestDb } from "../test/testDb";
import { buildTestApp } from "../test/testApp";

const { pool } = createTestDb();
vi.mock("../db/pool", () => ({ pool, hasDb: true }));

let app: ReturnType<typeof buildTestApp>;
let productId: string;
let fetchMock: ReturnType<typeof vi.fn<any[], Promise<unknown>>>;

beforeAll(async () => {
  const mediaRouter = (await import("./mediaRouter")).default;
  app = buildTestApp("/api/marketplace", mediaRouter);
  await pool.query(`INSERT INTO mkt_categories (id, name, slug, icon) VALUES ('cat-01','Electronics','electronics','📱')`);
  await pool.query(`INSERT INTO mkt_sellers (id, user_id, store_name, store_slug, status) VALUES ('sel-m','u-m','Media Store','media-store','active')`);
  const { rows } = await pool.query(
    `INSERT INTO mkt_products (seller_id, category_id, name, slug, price, images) VALUES ('sel-m','cat-01','Earbuds','earbuds',100,$1) RETURNING id`,
    [JSON.stringify(["https://cf.cjdropshipping.com/a.jpg", "https://evil.example/b.jpg", "#ffffff"])]
  );
  productId = rows[0].id;
});

beforeEach(async () => {
  (await import("./mediaRouter"))._clearMediaCacheForTests();
  fetchMock = vi.fn(async (): Promise<unknown> => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/jpeg" } }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("GET /api/marketplace/media/:kind/:id/:index", () => {
  it("streams the supplier photo from our own domain, cacheable and embeddable cross-origin", async () => {
    const res = await request(app).get(`/api/marketplace/media/p/${productId}/0`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("image/jpeg");
    expect(res.headers["cross-origin-resource-policy"]).toBe("cross-origin");
    expect(res.headers["cache-control"]).toMatch(/public/);
    expect(fetchMock).toHaveBeenCalledWith("https://cf.cjdropshipping.com/a.jpg", expect.anything());
  });

  it("serves repeat requests from its cache without re-hitting the supplier CDN", async () => {
    await request(app).get(`/api/marketplace/media/p/${productId}/0`);
    await request(app).get(`/api/marketplace/media/p/${productId}/0`);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refuses to proxy anything off the supplier allowlist (SSRF guard)", async () => {
    const res = await request(app).get(`/api/marketplace/media/p/${productId}/1`);
    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("404s for colour placeholders, out-of-range indexes and malformed ids", async () => {
    expect((await request(app).get(`/api/marketplace/media/p/${productId}/2`)).status).toBe(404);
    expect((await request(app).get(`/api/marketplace/media/p/${productId}/99`)).status).toBe(404);
    expect((await request(app).get(`/api/marketplace/media/p/not-a-uuid/0`)).status).toBe(404);
    expect((await request(app).get(`/api/marketplace/media/x/${productId}/0`)).status).toBe(404);
  });

  it("rejects a non-image upstream response", async () => {
    fetchMock.mockResolvedValueOnce(new Response("<html>", { status: 200, headers: { "content-type": "text/html" } }));
    expect((await request(app).get(`/api/marketplace/media/p/${productId}/0`)).status).toBe(502);
  });
});
