import { describe, it, expect, beforeAll, vi } from "vitest";
import request from "supertest";
import express, { type Express } from "express";
import { createTestDb } from "../test/testDb";

const { pool } = createTestDb();
vi.mock("../db/pool", () => ({ pool, hasDb: true }));

let app: Express;
let adminToken: string;
let sellerToken: string;
let sellerUserId: string;
let sellerId: string;
let supplierId: string;
let supplierProductId: string;

beforeAll(async () => {
  const authRouter = (await import("../routes/authRouter")).default;
  const marketplaceRouter = (await import("../routes/marketplaceRouter")).default;
  app = express();
  app.use(express.json());
  app.use("/api/auth", authRouter);
  app.use("/api/marketplace", marketplaceRouter);

  await pool.query(`INSERT INTO mkt_tax_rates (country, vat_rate_pct, default_duty_rate_pct) VALUES ('ZA', 15, 20)`);
  await pool.query(`INSERT INTO mkt_categories (id, name, slug, icon) VALUES ('cat-01','Electronics','electronics','📱')`);
  await pool.query(`INSERT INTO mkt_warehouses (id, name, country, type) VALUES ('wh-origin-cn','Guangzhou Hub','CN','origin'), ('wh-dest-za','Cape Town Hub','ZA','destination')`);
  await pool.query(`INSERT INTO mkt_fx_rates (currency, rate_to_zar) VALUES ('USD', 18.2)`);

  const bcrypt = (await import("bcryptjs")).default;
  const adminHash = await bcrypt.hash("AdminPass123", 10);
  await pool.query(`INSERT INTO users (id, username, password_hash, role, name, email) VALUES ('99999999-9999-9999-9999-999999999999','admintest2','${adminHash}','marketplace_admin','Admin','admin2@example.com')`);
  const adminLogin = await request(app).post("/api/auth/login").send({ username: "admintest2", password: "AdminPass123" });
  adminToken = adminLogin.body.data.token;

  // Real seller registration, then bypass KYC directly (as an admin
  // approving an application would) so the account can actually import.
  const sellerReg = await request(app).post("/api/marketplace/sellers/register").send({
    username: "importtestseller", password: "SellerPass123", name: "Import Test Seller", email: "importseller@example.com", storeName: "Import Test Store",
  });
  sellerToken = sellerReg.body.token;
  sellerUserId = sellerReg.body.user.id;
  sellerId = sellerReg.body.seller.id;
  await pool.query(`UPDATE mkt_sellers SET status = 'active' WHERE id = $1`, [sellerId]);
});

describe("Admin supplier + catalog setup", () => {
  it("creates a supplier", async () => {
    const res = await request(app).post("/api/marketplace/admin/suppliers")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Test Supplier Co", country: "CN" });
    expect(res.status).toBe(201);
    expect(res.body.data.country).toBe("CN");
    supplierId = res.body.data.id;
  });

  it("adds a catalog item under that supplier with a cost price", async () => {
    const res = await request(app).post("/api/marketplace/admin/supplier-products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ supplierId, categoryId: "cat-01", name: "Bluetooth Earbuds", costPrice: 8.5, currency: "USD", moq: 10, originCountry: "CN", retailPrice: 349 });
    expect(res.status).toBe(201);
    expect(res.body.data.costPrice).toBe(8.5);
    expect(res.body.data.retailPrice).toBe(349); // manager's suggested price only, not enforced
    supplierProductId = res.body.data.id;
  });

  it("rejects a non-admin (seller) trying to add a supplier catalog item", async () => {
    const res = await request(app).post("/api/marketplace/admin/supplier-products")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({ supplierId, name: "Should not work", costPrice: 5 });
    expect(res.status).toBe(403);
  });
});

describe("POST /api/marketplace/admin/supplier-products/bulk-import", () => {
  it("creates multiple catalog items from real CSV text via the actual HTTP endpoint", async () => {
    const csv = `supplierId,name,costPrice,currency,moq,originCountry\n${supplierId},Phone Case,1.20,USD,50,CN\n${supplierId},Screen Protector,0.60,USD,100,CN`;
    const res = await request(app).post("/api/marketplace/admin/supplier-products/bulk-import")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ csv });
    expect(res.status).toBe(201);
    expect(res.body.created).toBe(2);
    expect(res.body.errorCount).toBe(0);

    const listRes = await request(app).get("/api/marketplace/admin/supplier-products").set("Authorization", `Bearer ${adminToken}`);
    const names = listRes.body.data.map((p: { name: string }) => p.name);
    expect(names).toEqual(expect.arrayContaining(["Phone Case", "Screen Protector"]));
  });

  it("reports per-row errors without failing rows that are valid", async () => {
    const csv = `supplierId,name,costPrice\n${supplierId},Valid Item,5.00\nnot-a-real-supplier,Bad Row,3.00\n${supplierId},,4.00`;
    const res = await request(app).post("/api/marketplace/admin/supplier-products/bulk-import")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ csv });
    expect(res.body.created).toBe(1); // only "Valid Item"
    expect(res.body.errorCount).toBe(2);
    expect(res.body.errors[0].error).toMatch(/unknown supplierid/i);
    expect(res.body.errors[1].error).toMatch(/name is required/i);
  });
});

describe("Seller sets their own markup at import time (POST /sellers/:id/import-listing)", () => {
  it("uses the SELLER's price, not the supplier's suggested price", async () => {
    const res = await request(app).post(`/api/marketplace/sellers/${sellerId}/import-listing`)
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({ supplierProductId, retailPrice: 599, stock: 25 }); // seller's own price, higher than the 349 suggested
    expect(res.status).toBe(201);
    expect(res.body.data.price).toBe(599);
    expect(res.body.data.fulfillmentType).toBe("imported");
    expect(res.body.data.status).toBe("pending_review"); // needs manager approval before going live
  });

  it("falls back to the supplier's suggested price if the seller doesn't provide one", async () => {
    const csv = `supplierId,name,costPrice,categoryId,retailPrice\n${supplierId},No Markup Item,2.00,cat-01,199`;
    await request(app).post("/api/marketplace/admin/supplier-products/bulk-import").set("Authorization", `Bearer ${adminToken}`).send({ csv });
    const listRes = await request(app).get("/api/marketplace/admin/supplier-products").set("Authorization", `Bearer ${adminToken}`);
    const item = listRes.body.data.find((p: { name: string }) => p.name === "No Markup Item");

    const res = await request(app).post(`/api/marketplace/sellers/${sellerId}/import-listing`)
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({ supplierProductId: item.id }); // no retailPrice given
    expect(res.status).toBe(201);
    expect(res.body.data.price).toBe(199);
  });

  it("a seller cannot import on another seller's behalf", async () => {
    const res = await request(app).post(`/api/marketplace/sellers/some-other-seller-id/import-listing`)
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({ supplierProductId, retailPrice: 100 });
    expect(res.status).toBe(403);
  });
});

describe("Supplier order status transitions (PATCH /admin/supplier-orders/:id/status)", () => {
  let supplierOrderId: string;

  beforeAll(async () => {
    // Approve the imported listing so it's actually purchasable, then a
    // real customer buys it — this is what actually creates the
    // supplier-order record under test below.
    await pool.query(`UPDATE mkt_products SET status = 'active' WHERE price = 599`);
    const custReg = await request(app).post("/api/auth/register").send({
      username: "supplierordercustomer", password: "TestPass123", name: "Customer", email: "supord@example.com",
    });
    const custToken = custReg.body.data.token;
    const custId = custReg.body.data.user.id;
    await request(app).post(`/api/marketplace/addresses/${custId}`).set("Authorization", `Bearer ${custToken}`).send({
      firstName: "S", lastName: "O", line1: "1 St", city: "Cape Town", postalCode: "8001", country: "ZA", phone: "0821234567",
    });
    const prodRes = await pool.query(`SELECT id FROM mkt_products WHERE price = 599`);
    await request(app).post(`/api/marketplace/cart/${custId}/add`).set("Authorization", `Bearer ${custToken}`).send({ productId: prodRes.rows[0].id, quantity: 1 });
    await request(app).post("/api/marketplace/orders").set("Authorization", `Bearer ${custToken}`).send({ paymentMethod: "bank_transfer" });

    const soRes = await pool.query(`SELECT id FROM mkt_supplier_orders WHERE supplier_product_id = $1`, [supplierProductId]);
    supplierOrderId = soRes.rows[0].id;
  });

  it("allows the next legal step in the pipeline", async () => {
    const res = await request(app).patch(`/api/marketplace/admin/supplier-orders/${supplierOrderId}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "received_at_origin_hub" });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("received_at_origin_hub");
  });

  it("rejects skipping a stage, with the valid next step(s) named in the error", async () => {
    const res = await request(app).patch(`/api/marketplace/admin/supplier-orders/${supplierOrderId}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "delivered" }); // can't jump from received_at_origin_hub straight to delivered
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/valid next step/i);
  });
});
