import { describe, it, expect, beforeAll, vi } from "vitest";
import request from "supertest";
import express, { type Express } from "express";
import bcrypt from "bcryptjs";
import { createTestDb } from "../test/testDb";
import { registerAndVerifyCustomer } from "../test/authHelpers";

const { pool } = createTestDb();
vi.mock("../db/pool", () => ({ pool, hasDb: true }));

let app: Express;
let customerToken: string;
let ownerToken: string;
let adminToken: string;
let sellerId: string;
let productId: string;
const PRIVATE = ["email", "phone", "taxId", "applicationData", "userId"];

beforeAll(async () => {
  const authRouter = (await import("./authRouter")).default;
  const marketplaceRouter = (await import("./marketplaceRouter")).default;
  app = express();
  app.use(express.json());
  app.use("/api/auth", authRouter);
  app.use("/api/marketplace", marketplaceRouter);

  await pool.query(`INSERT INTO mkt_categories (id, name, slug, icon) VALUES ('cat-01','Electronics','electronics','📱')`);
  const reg = await request(app).post("/api/marketplace/sellers/register").send({
    username: "privseller", password: "SellerPass123", name: "Priv", email: "priv@example.com", storeName: "Priv Store",
  });
  ownerToken = reg.body.token; sellerId = reg.body.seller.id;
  await pool.query(`UPDATE mkt_sellers SET status = 'active', phone = '0821234567', tax_id = 'TAX-123', application_data = '{"idNumber":"8001015009087"}' WHERE id = $1`, [sellerId]);
  const { rows } = await pool.query(`INSERT INTO mkt_products (seller_id, category_id, name, slug, price, stock, status) VALUES ($1,'cat-01','Thing','thing',100,5,'active') RETURNING id`, [sellerId]);
  productId = rows[0].id;

  ({ token: customerToken } = await registerAndVerifyCustomer(app, pool, { username: "privcust", email: "privcust@example.com" }));
  await pool.query(`INSERT INTO users (username, password_hash, role, name, email) VALUES ('privadmin', $1, 'marketplace_admin', 'A', 'privadmin@example.com')`, [await bcrypt.hash("AdminPass123", 4)]);
  adminToken = (await request(app).post("/api/auth/login").send({ username: "privadmin", password: "AdminPass123" })).body.data.token;
});

describe("seller privacy", () => {
  it("the public product page shows only the store's public profile", async () => {
    const res = await request(app).get(`/api/marketplace/products/${productId}`);
    expect(res.body.data.seller.storeName).toBe("Priv Store");
    for (const f of PRIVATE) expect(res.body.data.seller).not.toHaveProperty(f);
    expect(JSON.stringify(res.body)).not.toMatch(/8001015009087|TAX-123|0821234567/);
  });

  it("customers can't read other stores' contact, tax or KYC details", async () => {
    const one = await request(app).get(`/api/marketplace/sellers/${sellerId}`).set("Authorization", `Bearer ${customerToken}`);
    for (const f of PRIVATE) expect(one.body.data.seller).not.toHaveProperty(f);
    const list = await request(app).get(`/api/marketplace/sellers`).set("Authorization", `Bearer ${customerToken}`);
    expect(JSON.stringify(list.body)).not.toMatch(/8001015009087|TAX-123|0821234567|priv@example.com/);
  });

  it("the store's owner and the marketplace team still see everything", async () => {
    const own = await request(app).get(`/api/marketplace/sellers/${sellerId}`).set("Authorization", `Bearer ${ownerToken}`);
    expect(own.body.data.seller.taxId).toBe("TAX-123");
    const admin = await request(app).get(`/api/marketplace/sellers`).set("Authorization", `Bearer ${adminToken}`);
    expect(admin.body.data.find((s: { id: string }) => s.id === sellerId).applicationData).toEqual({ idNumber: "8001015009087" });
  });
});
