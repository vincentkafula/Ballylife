import { describe, it, expect, beforeAll, vi } from "vitest";
import request from "supertest";
import express, { type Express } from "express";
import bcrypt from "bcryptjs";
import { createTestDb } from "../test/testDb";
import { isExcludedFromStore } from "../utils/cjCategoryMap";

const { pool } = createTestDb();
vi.mock("../db/pool", () => ({ pool, hasDb: true }));

let app: Express;
let adminToken: string;
let realProductId: string;
let cartoonProductId: string;
let demoProductId: string;

beforeAll(async () => {
  const authRouter = (await import("../routes/authRouter")).default;
  const marketplaceRouter = (await import("../routes/marketplaceRouter")).default;
  app = express();
  app.use(express.json());
  app.use("/api/auth", authRouter);
  app.use("/api/marketplace", marketplaceRouter);

  const q = (sql: string, params: unknown[] = []) => pool.query(sql, params);
  await q(`INSERT INTO mkt_categories (id, name, slug, icon) VALUES ('cat-01','Electronics','electronics','📱')`);
  await q(`INSERT INTO mkt_sellers (id, store_name, store_slug, status) VALUES ('sel-01','TechZone','techzone','active'), ('sel-ballylife','Ballylife','ballylife','active')`);
  await q(`INSERT INTO mkt_suppliers (id, name, country) VALUES ('sup-cn-01','Guangzhou Fortune Trading Co.','CN'), ('sup-cjdropshipping','CJdropshipping','CN')`);
  await q(`INSERT INTO mkt_supplier_products (supplier_id, name, cost_price, currency, retail_price, images, origin_country, status) VALUES ('sup-cn-01','Demo Widget',5,'USD',100,'[]','CN','active')`);
  demoProductId = (await q(`INSERT INTO mkt_products (seller_id, category_id, name, slug, price, images, status) VALUES ('sel-01','cat-01','Galaxy S25 Ultra','galaxy',9999,'["#111","#222"]','inactive') RETURNING id`)).rows[0].id;
  realProductId = (await q(`INSERT INTO mkt_products (seller_id, category_id, name, slug, price, images, status, source) VALUES ('sel-ballylife','cat-01','USB Desk Fan','fan',199,'["https://ae01.alicdn.com/a.jpg"]','active','1688') RETURNING id`)).rows[0].id;
  cartoonProductId = (await q(`INSERT INTO mkt_products (seller_id, category_id, name, slug, price, images, status, source) VALUES ('sel-ballylife','cat-01','Cute Cartoon Pikachu Plush Doll','pika',150,'["https://ae01.alicdn.com/p.jpg"]','active','1688') RETURNING id`)).rows[0].id;

  const hash = await bcrypt.hash("Pass-12345", 5);
  const demoUser = (await q(`INSERT INTO users (username, password_hash, role, name, email) VALUES ('customer1','${hash}','customer','Demo','c1@example.com') RETURNING id`)).rows[0].id;
  const realUser = (await q(`INSERT INTO users (username, password_hash, role, name, email) VALUES ('thandi','${hash}','customer','Thandi','t@example.com') RETURNING id`)).rows[0].id;
  await q(`INSERT INTO users (username, password_hash, role, name, email) VALUES ('boss','${hash}','marketplace_admin','Boss','b@example.com')`);
  await q(`INSERT INTO mkt_credit_providers (id, name, provider_key, contact_name, contact_email, status) VALUES ('cp-1','PayFlex','payflex','x','x@example.com','active')`);
  await q(`INSERT INTO mkt_orders (order_number, user_id, items, total_amount, payment_status) VALUES ('DEMO-1', $1, $2, 500, 'payment_confirmed')`, [demoUser, JSON.stringify([{ productId: realProductId, quantity: 1 }])]);
  await q(`INSERT INTO mkt_orders (order_number, user_id, items, total_amount, payment_status) VALUES ('DEMO-2', $1, $2, 9999, 'payment_confirmed')`, [realUser, JSON.stringify([{ productId: demoProductId, quantity: 1 }])]);
  await q(`INSERT INTO mkt_orders (order_number, user_id, items, total_amount, payment_status) VALUES ('REAL-1', $1, $2, 199, 'payment_confirmed')`, [realUser, JSON.stringify([{ productId: realProductId, quantity: 1 }])]);

  adminToken = (await request(app).post("/api/auth/login").send({ username: "boss", password: "Pass-12345" })).body.data.token;
  const { archiveDemoDataOnce } = await import("./demoCleanup");
  await archiveDemoDataOnce();
});

const status = async (table: string, id: string) => (await pool.query(`SELECT status FROM ${table} WHERE id::text = $1`, [id])).rows[0].status;

describe("Archiving demo data", () => {
  it("archives demo stores, their products and made-up suppliers -- and keeps real ones", async () => {
    expect(await status("mkt_sellers", "sel-01")).toBe("archived");
    expect(await status("mkt_sellers", "sel-ballylife")).toBe("active");
    expect(await status("mkt_products", demoProductId)).toBe("archived");
    expect(await status("mkt_products", realProductId)).toBe("active");
    expect(await status("mkt_suppliers", "sup-cn-01")).toBe("archived");
    expect(await status("mkt_suppliers", "sup-cjdropshipping")).toBe("active");
  });

  it("archives cartoon / unlicensed-character products", async () => {
    expect(await status("mkt_products", cartoonProductId)).toBe("archived");
  });

  it("flags orders by demo accounts or containing only demo products, not real ones", async () => {
    const { rows } = await pool.query(`SELECT order_number, is_demo FROM mkt_orders ORDER BY order_number`);
    expect(Object.fromEntries(rows.map((r: { order_number: string; is_demo: boolean }) => [r.order_number, r.is_demo]))).toEqual({ "DEMO-1": true, "DEMO-2": true, "REAL-1": false });
  });

  it("closes demo logins and switches off the demo pay-later providers", async () => {
    const { rows } = await pool.query(`SELECT account_status FROM users WHERE username = 'customer1'`);
    expect(rows[0].account_status).toBe("removed");
    expect((await request(app).post("/api/auth/login").send({ username: "customer1", password: "Pass-12345" })).status).toBe(403);
    expect(await status("mkt_credit_providers", "cp-1")).toBe("inactive");
  });

  it("the dashboard shows only real data", async () => {
    const auth = { Authorization: `Bearer ${adminToken}` };
    const stats = (await request(app).get("/api/marketplace/admin/stats").set(auth)).body.data;
    expect(stats).toMatchObject({ totalProducts: 1, totalOrders: 1, totalRevenue: 199, totalSellers: 1 });
    const orders = (await request(app).get("/api/marketplace/admin/orders").set(auth)).body.data;
    expect(orders.map((o: { orderNumber: string }) => o.orderNumber)).toEqual(["REAL-1"]);
    const products = (await request(app).get("/api/marketplace/admin/products").set(auth)).body.data;
    expect(products.map((p: { name: string }) => p.name)).toEqual(["USB Desk Fan"]);
    const sellers = (await request(app).get("/api/marketplace/sellers").set(auth)).body.data;
    expect(sellers.map((s: { id: string }) => s.id)).toEqual(["sel-ballylife"]);
    const customers = (await request(app).get("/api/marketplace/admin/customers").set(auth)).body.data;
    expect(customers.map((c: { username: string }) => c.username)).toEqual(["thandi"]);
  });

  it("runs only once", async () => {
    const { archiveDemoDataOnce } = await import("./demoCleanup");
    expect(await archiveDemoDataOnce()).toBeNull();
  });
});

describe("isExcludedFromStore: cartoons and characters", () => {
  it.each([
    ["Cute Cartoon Coin Purse", true], ["Peluche Pokemon Gengar 24cm", true], ["30cm Snoopy Plush Pillow", true], ["Hello Kitty Backpack", true],
    ["Diamond Painting Cross-stitch Kit", false], ["Frozen Food Storage Box", false], ["One Piece Swimsuit Women", false], ["Sonic Electric Toothbrush", false],
  ])("%s -> %s", (name, excluded) => {
    expect(isExcludedFromStore(name)).toBe(excluded);
  });
});
