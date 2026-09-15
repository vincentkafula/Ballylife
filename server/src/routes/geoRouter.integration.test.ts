import { describe, it, expect, beforeAll, vi } from "vitest";
import request from "supertest";
import express, { type Express } from "express";
import { createTestDb } from "../test/testDb";

const { pool } = createTestDb();
vi.mock("../db/pool", () => ({ pool, hasDb: true }));

let app: Express;

beforeAll(async () => {
  const geoRouter = (await import("./geoRouter")).default;
  app = express();
  app.use(express.json());
  app.set("trust proxy", 1);
  app.use("/api", geoRouter);

  await pool.query(
    `INSERT INTO mkt_fx_rates (currency, rate_to_zar) VALUES ('USD', 18.20), ('CNY', 2.52), ('JPY', 0.122), ('KRW', 0.0134), ('ZMW', 0.68), ('NGN', 0.0114), ('KES', 0.142)`
  );
});

describe("GET /api/geo/countries", () => {
  it("returns all 54 African countries plus the non-African reference currencies, each with a working currency", async () => {
    const res = await request(app).get("/api/geo/countries");
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(58); // 54 African + US/CN/JP/KR
    const codes = res.body.data.map((c: { countryCode: string }) => c.countryCode);
    expect(codes).toEqual(expect.arrayContaining(["ZM", "ZA", "ZW", "NG", "EG", "KE", "GH", "US"]));
  });

  it("gives Zimbabwe USD rather than its own currency", async () => {
    const res = await request(app).get("/api/geo/countries");
    const zw = res.body.data.find((c: { countryCode: string }) => c.countryCode === "ZW");
    expect(zw.code).toBe("USD");
  });
});

describe("GET /api/geo/detect", () => {
  it("falls back to the Zambia default for a private/local IP rather than querying an external service", async () => {
    // supertest's default request IP is a loopback address -- this
    // exercises the exact fallback path that fixes the original bug
    // (every request silently defaulting to Zambia) without needing a
    // real external geolocation call in a test.
    const res = await request(app).get("/api/geo/detect");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.countryCode).toBe("ZM");
  });
});

describe("POST /api/geo/reverse", () => {
  it("rejects a request with no lat/lng", async () => {
    const res = await request(app).post("/api/geo/reverse").send({});
    expect(res.status).toBe(400);
  });

  it("rejects non-numeric lat/lng", async () => {
    const res = await request(app).post("/api/geo/reverse").send({ lat: "not-a-number", lng: 10 });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/currency/rates", () => {
  it("inverts rate_to_zar correctly (1 ZAR -> N units of currency, not N ZAR -> 1 unit)", async () => {
    const res = await request(app).get("/api/currency/rates");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // 1 USD = 18.20 ZAR, so 1 ZAR should buy 1/18.20 USD
    expect(res.body.data.rates.USD).toBeCloseTo(1 / 18.20, 6);
    expect(res.body.data.rates.ZMW).toBeCloseTo(1 / 0.68, 6);
    expect(res.body.data.rates.ZAR).toBe(1);
    // Same inversion for a newly-added African currency -- proves this
    // isn't special-cased to the original 5, it's generic.
    expect(res.body.data.rates.NGN).toBeCloseTo(1 / 0.0114, 6);
  });

  it("reports rates as fresh right after being seeded", async () => {
    const res = await request(app).get("/api/currency/rates");
    expect(res.body.stale).toBe(false);
  });
});
