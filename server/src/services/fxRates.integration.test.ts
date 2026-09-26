import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { createTestDb } from "../test/testDb";

const { pool } = createTestDb();
vi.mock("../db/pool", () => ({ pool, hasDb: true }));

let fx: typeof import("./fxRates");

const market = (rates: Record<string, number>) => ({
  ok: true, status: 200,
  json: async () => ({ result: "success", base_code: "ZAR", rates: { ZAR: 1, ...rates } }),
});

beforeAll(async () => {
  fx = await import("./fxRates");
  await pool.query(`INSERT INTO mkt_fx_rates (currency, rate_to_zar) VALUES ('USD', 18.2), ('ZMW', 0.68), ('KES', 0.142)`);
  await pool.query(`INSERT INTO mkt_categories (id, name, slug, icon) VALUES ('cat-01','Electronics','electronics','📱')`);
  await pool.query(`INSERT INTO mkt_sellers (id, store_name, store_slug, status) VALUES ('sel-ballylife','Ballylife','ballylife','active'), ('sel-x','Other','other','active')`);
  await pool.query(`INSERT INTO mkt_suppliers (id, name, country, status) VALUES ('sup-cjdropshipping','CJ','CN','active')`);
  const { rows } = await pool.query(
    `INSERT INTO mkt_supplier_products (supplier_id, name, cost_price, retail_price, origin_country, status, external_source, external_id, est_shipping_usd, external_variants)
     VALUES ('sup-cjdropshipping','Earbuds',10,0,'CN','active','cjdropshipping','p1',5,$1) RETURNING id`,
    [JSON.stringify([{ vid: "a", key: "Black", priceUsd: 10 }, { vid: "b", key: "White", priceUsd: 12 }])]
  );
  await pool.query(`INSERT INTO mkt_products (seller_id, category_id, name, slug, price, stock, supplier_product_id) VALUES
    ('sel-ballylife','cat-01','Earbuds','earbuds',410,20,$1), ('sel-x','cat-01','Earbuds (seller)','earbuds-2',599,20,$1)`, [rows[0].id]);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("refreshFxRates", () => {
  it("updates known currencies from the market, rejects implausible jumps, and re-prices Ballylife listings", async () => {
    vi.stubGlobal("fetch", vi.fn(async (): Promise<unknown> => market({ USD: 1 / 16.3, ZMW: 1.2, KES: 70, EUR: 0.05 })));
    const r = await fx.refreshFxRates();

    expect(r.updated).toBe(2);             // USD, ZMW
    expect(r.rejected).toEqual(["KES"]);   // 0.142 -> 0.0143 is a 10x move: bad data, not applied
    const { rows } = await pool.query(`SELECT currency, rate_to_zar FROM mkt_fx_rates ORDER BY currency`);
    const rate = Object.fromEntries(rows.map((x: any) => [x.currency, Number(x.rate_to_zar)]));
    expect(rate.USD).toBeCloseTo(16.3, 6);
    expect(rate.ZMW).toBeCloseTo(1 / 1.2, 6);
    expect(rate.KES).toBe(0.142);
    expect(rate.EUR).toBeUndefined();      // not in our table: not added

    expect(r.repriced).toBe(1);
    const { rows: p } = await pool.query(`SELECT seller_id, price, variants FROM mkt_products ORDER BY seller_id`);
    expect(Number(p[0].price)).toBe(367);  // (10 + 5) * 16.3 * 1.5 = 366.75 -> 367
    expect(p[0].variants.find((v: any) => v.value === "White").additionalPrice).toBe(49); // (12-10) * 16.3 * 1.5 = 48.9 -> 49
    expect(Number(p[1].price)).toBe(599);  // a seller's own price is theirs, never touched
  });

  it("refuses a response that isn't a ZAR-based rate table", async () => {
    vi.stubGlobal("fetch", vi.fn(async (): Promise<unknown> => ({ ok: true, status: 200, json: async () => ({ result: "success", base_code: "USD", rates: { ZAR: 16 } }) })));
    await expect(fx.refreshFxRates()).rejects.toThrow(/unusable/);
  });
});
