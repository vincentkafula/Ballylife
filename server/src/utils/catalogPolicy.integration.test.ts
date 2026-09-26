import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import express, { type Express } from "express";
import bcrypt from "bcryptjs";
import { createTestDb } from "../test/testDb";

const { pool } = createTestDb();
vi.mock("../db/pool", () => ({ pool, hasDb: true }));

let app: Express;
let adminToken: string;
let sellerToken: string;
let sellerId: string;
let cjItemId: string;
let manualItemId: string;

beforeAll(async () => {
  const authRouter = (await import("../routes/authRouter")).default;
  const marketplaceRouter = (await import("../routes/marketplaceRouter")).default;
  app = express();
  app.use(express.json());
  app.use("/api/auth", authRouter);
  app.use("/api/marketplace", marketplaceRouter);

  await pool.query(`INSERT INTO mkt_categories (id, name, slug, icon) VALUES ('cat-01','Electronics','electronics','📱')`);
  await pool.query(`INSERT INTO mkt_fx_rates (currency, rate_to_zar) VALUES ('USD', 18.5)`);
  await pool.query(`INSERT INTO mkt_suppliers (id, name, country, status) VALUES ('sup-cjdropshipping','CJdropshipping','CN','active'), ('sup-manual','Local Co','ZA','active')`);
  const { rows: a } = await pool.query(`INSERT INTO mkt_supplier_products (supplier_id, category_id, name, cost_price, retail_price, origin_country, status, external_source, external_id)
    VALUES ('sup-cjdropshipping','cat-01','CJ Earbuds',10,277.5,'CN','active','cjdropshipping','pid-1') RETURNING id`);
  const { rows: b } = await pool.query(`INSERT INTO mkt_supplier_products (supplier_id, category_id, name, cost_price, retail_price, origin_country, status)
    VALUES ('sup-manual','cat-01','Hand-made Item',5,150,'ZA','active') RETURNING id`);
  cjItemId = a[0].id; manualItemId = b[0].id;

  const hash = await bcrypt.hash("AdminPass123", 10);
  await pool.query(`INSERT INTO users (username, password_hash, role, name, email) VALUES ('poladmin','${hash}','marketplace_admin','Admin','poladmin@example.com')`);
  adminToken = (await request(app).post("/api/auth/login").send({ username: "poladmin", password: "AdminPass123" })).body.data.token;
  const reg = await request(app).post("/api/marketplace/sellers/register").send({
    username: "polseller", password: "SellerPass123", name: "S", email: "polseller@example.com", storeName: "Pol Store",
  });
  sellerToken = reg.body.token; sellerId = reg.body.seller.id;
  await pool.query(`UPDATE mkt_sellers SET status = 'active' WHERE id = $1`, [sellerId]);

  process.env.CJ_ONLY_CATALOG = "true";
});
afterAll(() => { process.env.CJ_ONLY_CATALOG = "false"; });

describe("CJ-only catalogue policy", () => {
  it("sellers can't create their own products", async () => {
    const res = await request(app).post(`/api/marketplace/sellers/${sellerId}/products`).set("Authorization", `Bearer ${sellerToken}`)
      .send({ categoryId: "cat-01", name: "My Own Thing", price: 100 });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("CJ_ONLY_CATALOG");
  });

  it("nobody can add catalogue items by hand, singly or by CSV", async () => {
    const single = await request(app).post("/api/marketplace/admin/supplier-products").set("Authorization", `Bearer ${adminToken}`)
      .send({ supplierId: "sup-manual", name: "X", costPrice: 1, originCountry: "ZA" });
    expect(single.status).toBe(403);
    const csv = await request(app).post("/api/marketplace/admin/supplier-products/bulk-import").set("Authorization", `Bearer ${adminToken}`)
      .send({ csv: "supplierId,name,costPrice\nsup-manual,Y,1" });
    expect(csv.status).toBe(403);
  });

  it("sellers only see and can only import CJ items", async () => {
    const list = await request(app).get("/api/marketplace/supplier-catalog").set("Authorization", `Bearer ${sellerToken}`);
    expect(list.body.data.map((i: { name: string }) => i.name)).toEqual(["CJ Earbuds"]);

    const bad = await request(app).post(`/api/marketplace/sellers/${sellerId}/import-listing`).set("Authorization", `Bearer ${sellerToken}`)
      .send({ supplierProductId: manualItemId, retailPrice: 200 });
    expect(bad.status).toBe(403);
    const good = await request(app).post(`/api/marketplace/sellers/${sellerId}/import-listing`).set("Authorization", `Bearer ${sellerToken}`)
      .send({ supplierProductId: cjItemId, retailPrice: 399 });
    expect(good.status).toBe(201);

    const approve = await request(app).patch(`/api/marketplace/admin/products/${good.body.data.id}/approve`).set("Authorization", `Bearer ${adminToken}`);
    expect(approve.status).toBe(200);
  });

  it("an admin can't approve a non-CJ listing or re-activate a non-CJ catalogue item", async () => {
    const { rows } = await pool.query(`INSERT INTO mkt_products (seller_id, category_id, name, slug, price, status) VALUES ($1,'cat-01','Legacy','legacy-1',50,'pending_review') RETURNING id`, [sellerId]);
    const approve = await request(app).patch(`/api/marketplace/admin/products/${rows[0].id}/approve`).set("Authorization", `Bearer ${adminToken}`);
    expect(approve.status).toBe(409);
    const reactivate = await request(app).patch(`/api/marketplace/admin/supplier-products/${manualItemId}`).set("Authorization", `Bearer ${adminToken}`).send({ status: "active" });
    expect(reactivate.status).toBe(409);
  });

  it("at boot, takes every non-CJ product and catalogue item off sale -- and leaves CJ ones", async () => {
    const { enforceCjOnlyCatalog } = await import("../services/cjCatalog");
    await pool.query(`UPDATE mkt_products SET status = 'active' WHERE slug = 'legacy-1'`);
    const result = await enforceCjOnlyCatalog();
    expect(result.products).toBe(1);
    expect(result.catalogItems).toBe(1);
    const { rows } = await pool.query(`SELECT name, status FROM mkt_products ORDER BY name`);
    expect(rows).toEqual([{ name: "CJ Earbuds", status: "active" }, { name: "Legacy", status: "inactive" }]);
  });
});
