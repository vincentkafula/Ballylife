import { describe, it, expect, beforeAll, vi } from "vitest";
import request from "supertest";
import express, { type Express } from "express";
import bcrypt from "bcryptjs";
import { createTestDb } from "../test/testDb";
import { registerAndVerifyCustomer } from "../test/authHelpers";
import { variantIdForVid } from "../utils/cjVariants";

const { pool } = createTestDb();
vi.mock("../db/pool", () => ({ pool, hasDb: true }));

let app: Express;
let adminToken: string;
let sellerToken: string;
let customerToken: string;
let customerId: string;
let orderId: string;
const PRODUCT_ID = "66666666-6666-6666-6666-666666666666";
const WHITE = variantIdForVid("14:175#White");

beforeAll(async () => {
  const authRouter = (await import("./authRouter")).default;
  const marketplaceRouter = (await import("./marketplaceRouter")).default;
  const sourcingRouter = (await import("./sourcingRouter")).default;
  app = express();
  app.use(express.json());
  app.use("/api/auth", authRouter);
  app.use("/api/marketplace", marketplaceRouter);
  app.use("/api/marketplace", sourcingRouter);

  await pool.query(`INSERT INTO mkt_tax_rates (country, vat_rate_pct, default_duty_rate_pct) VALUES ('ZA', 15, 20)`);
  await pool.query(`INSERT INTO mkt_categories (id, name, slug, icon) VALUES ('cat-01','Electronics','electronics','📱')`);
  await pool.query(`INSERT INTO mkt_warehouses (id, name, country, type) VALUES ('wh-origin-cn','Guangzhou Hub','CN','origin'), ('wh-dest-za','Cape Town Hub','ZA','destination')`);
  await pool.query(`INSERT INTO mkt_fx_rates (currency, rate_to_zar) VALUES ('USD', 18)`);
  await pool.query(`INSERT INTO mkt_suppliers (id, name, country, status) VALUES ('sup-aliexpress','AliExpress','CN','active')`);

  const hash = await bcrypt.hash("AdminPass123", 10);
  await pool.query(`INSERT INTO users (username, password_hash, role, name, email) VALUES ('ordadmin','${hash}','marketplace_admin','Admin','ordadmin@example.com')`);
  adminToken = (await request(app).post("/api/auth/login").send({ username: "ordadmin", password: "AdminPass123" })).body.data.token;
  const reg = await request(app).post("/api/marketplace/sellers/register").send({
    username: "ordseller", password: "SellerPass123", name: "S", email: "ordseller@example.com", storeName: "Ord Store",
  });
  sellerToken = reg.body.token;
  const sellerId = reg.body.seller.id;
  await pool.query(`UPDATE mkt_sellers SET status = 'active', commission_pct = 8 WHERE id = $1`, [sellerId]);

  // A sourced AliExpress item ($10 black / $12 white, $2 delivery) listed by the seller at R399 (+R40 for white).
  const { rows } = await pool.query(
    `INSERT INTO mkt_supplier_products (supplier_id, category_id, name, cost_price, currency, retail_price, origin_country, status, external_source, external_id, external_variants, est_shipping_usd)
     VALUES ('sup-aliexpress','cat-01','Wireless Earbuds',10,'USD',223,'CN','active','aliexpress','1005001234567890',$1,2) RETURNING id`,
    [JSON.stringify([{ vid: "14:193#Black", key: "Black", priceUsd: 10 }, { vid: "14:175#White", key: "White", priceUsd: 12 }])]);
  await pool.query(
    `INSERT INTO mkt_products (id, seller_id, category_id, name, slug, price, currency, images, status, stock, fulfillment_type, supplier_product_id, variants)
     VALUES ($1,$2,'cat-01','Wireless Earbuds','wireless-earbuds-x',399,'ZAR','[]','active',10,'imported',$3,$4)`,
    [PRODUCT_ID, sellerId, rows[0].id, JSON.stringify([
      { id: variantIdForVid("14:193#Black"), type: "Option", value: "Black", stock: 10, additionalPrice: 0 },
      { id: WHITE, type: "Option", value: "White", stock: 10, additionalPrice: 40 },
    ])]);

  const c = await registerAndVerifyCustomer(app, pool, { username: "ordcust", email: "ordcust@example.com", name: "Ord Customer" });
  customerToken = c.token; customerId = c.userId;
  await request(app).post(`/api/marketplace/addresses/${customerId}`).set("Authorization", `Bearer ${customerToken}`).send({
    firstName: "Ord", lastName: "Cust", line1: "1 Test Street", city: "Durban", postalCode: "4001", country: "ZA", phone: "0821234567",
  });
});

describe("Supplier orders: payouts, approval and seller earnings", () => {
  it("charges the seller for the chosen option plus delivery, not just the cheapest option", async () => {
    const add = await request(app).post(`/api/marketplace/cart/${customerId}/add`).set("Authorization", `Bearer ${customerToken}`)
      .send({ productId: PRODUCT_ID, variantId: WHITE, quantity: 1 });
    expect(add.status).toBe(200);
    const order = await request(app).post("/api/marketplace/orders").set("Authorization", `Bearer ${customerToken}`).send({ paymentMethod: "bank_transfer" });
    expect(order.body.success).toBe(true);
    orderId = order.body.data.id;

    const { rows } = await pool.query(`SELECT * FROM mkt_order_line_settlements WHERE order_id = $1`, [orderId]);
    expect(Number(rows[0].gross_amount)).toBe(439);
    expect(Number(rows[0].supplier_cost_amount)).toBe(14);            // $12 white + $2 delivery
    expect(Number(rows[0].supplier_cost_amount_zar)).toBe(252);       // x R18
    expect(Number(rows[0].seller_payout_amount)).toBeCloseTo(439 - 35.12 - 252, 2);
  });

  it("holds paid orders for approval when the supplier is set to approval", async () => {
    const mode = await request(app).patch("/api/marketplace/admin/sourcing/suppliers/aliexpress").set("Authorization", `Bearer ${adminToken}`).send({ orderMode: "approval" });
    expect(mode.status).toBe(200);
    expect(mode.body.data.find((s: { key: string }) => s.key === "aliexpress").orderMode).toBe("approval");

    await pool.query(`UPDATE mkt_orders SET payment_status = 'payment_confirmed', placed_at = $2 WHERE id = $1`, [orderId, new Date()]);
    const { enqueueAliExpressOrders } = await import("../services/aliexpressFulfillment");
    expect(await enqueueAliExpressOrders()).toBe(1);
    const { rows } = await pool.query(`SELECT status FROM aliexpress_fulfillments WHERE order_id = $1`, [orderId]);
    expect(rows[0].status).toBe("awaiting_approval");
  });

  it("shows waiting orders with the margin, and approval releases them to the supplier worker", async () => {
    const list = await request(app).get("/api/marketplace/admin/sourcing/orders/awaiting").set("Authorization", `Bearer ${adminToken}`);
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    const o = list.body.data[0];
    expect(o).toMatchObject({ supplier: "aliexpress", saleZar: 439, supplierCostZar: 252, marginZar: 187, customerCity: "Durban" });
    expect(o.lines[0]).toMatchObject({ name: "Wireless Earbuds", quantity: 1, sellerName: "Ord Store" });

    const seller = await request(app).get("/api/marketplace/admin/sourcing/orders/awaiting").set("Authorization", `Bearer ${sellerToken}`);
    expect(seller.status).toBe(403);

    const ok = await request(app).post(`/api/marketplace/admin/sourcing/orders/aliexpress/${o.id}/approve`).set("Authorization", `Bearer ${adminToken}`);
    expect(ok.status).toBe(200);
    const { rows } = await pool.query(`SELECT status FROM aliexpress_fulfillments WHERE id = $1`, [o.id]);
    expect(rows[0].status).toBe("queued");

    const again = await request(app).post(`/api/marketplace/admin/sourcing/orders/aliexpress/${o.id}/reject`).set("Authorization", `Bearer ${adminToken}`).send({ reason: "late" });
    expect(again.status).toBe(409);
  });

  it("rejecting a waiting order stops it, with a note to refund", async () => {
    const { rows: f } = await pool.query(`SELECT id FROM aliexpress_fulfillments WHERE order_id = $1`, [orderId]);
    await pool.query(`UPDATE aliexpress_fulfillments SET status = 'awaiting_approval' WHERE id = $1`, [f[0].id]);
    const res = await request(app).post(`/api/marketplace/admin/sourcing/orders/aliexpress/${f[0].id}/reject`).set("Authorization", `Bearer ${adminToken}`).send({ reason: "Suspicious order" });
    expect(res.status).toBe(200);
    const { rows } = await pool.query(`SELECT status, last_error FROM aliexpress_fulfillments WHERE id = $1`, [f[0].id]);
    expect(rows[0].status).toBe("cancelled");
    expect(rows[0].last_error).toMatch(/Suspicious order.*refund/);
  });

  it("shows the seller what they earn on the order, and that Ballylife ships it", async () => {
    const { rows } = await pool.query(`SELECT seller_id FROM mkt_products WHERE id = $1`, [PRODUCT_ID]);
    const res = await request(app).get(`/api/marketplace/sellers/${rows[0].seller_id}/orders`).set("Authorization", `Bearer ${sellerToken}`);
    expect(res.status).toBe(200);
    const e = res.body.data.find((o: { id: string }) => o.id === orderId).sellerEarnings;
    expect(e).toMatchObject({ salesZar: 439, commissionZar: 35.12, productAndDeliveryZar: 252, earningsZar: 151.88, paidOut: false, ballylifeShips: true });
    expect(JSON.stringify(res.body)).not.toMatch(/aliexpress|1005001234567890/i);
  });

  it("Ballylife's own store orders are never held, even when approval is on", async () => {
    await request(app).patch("/api/marketplace/admin/sourcing/suppliers/aliexpress").set("Authorization", `Bearer ${adminToken}`).send({ orderMode: "approval" });
    await pool.query(`INSERT INTO users (id, username, password_hash, role, name, email) VALUES ('77777777-7777-7777-7777-777777777777','ballylifehouse','x','seller','Ballylife','house@example.com')`);
    await pool.query(`INSERT INTO mkt_sellers (id, user_id, store_name, store_slug, status) VALUES ('sel-ballylife','77777777-7777-7777-7777-777777777777','Ballylife','ballylife','active')`);
    const { rows: sp } = await pool.query(`SELECT id FROM mkt_supplier_products WHERE external_source = 'aliexpress'`);
    const HOUSE_PRODUCT = "88888888-8888-8888-8888-888888888888";
    await pool.query(
      `INSERT INTO mkt_products (id, seller_id, category_id, name, slug, price, currency, images, status, stock, fulfillment_type, supplier_product_id)
       VALUES ($1,'sel-ballylife','cat-01','Wireless Earbuds','wireless-earbuds-house',299,'ZAR','[]','active',10,'imported',$2)`, [HOUSE_PRODUCT, sp[0].id]);
    await request(app).post(`/api/marketplace/cart/${customerId}/add`).set("Authorization", `Bearer ${customerToken}`).send({ productId: HOUSE_PRODUCT, quantity: 1 });
    const order = await request(app).post("/api/marketplace/orders").set("Authorization", `Bearer ${customerToken}`).send({ paymentMethod: "bank_transfer" });
    expect(order.body.success).toBe(true);
    await pool.query(`UPDATE mkt_orders SET payment_status = 'payment_confirmed', placed_at = $2 WHERE id = $1`, [order.body.data.id, new Date()]);
    const { enqueueAliExpressOrders } = await import("../services/aliexpressFulfillment");
    await enqueueAliExpressOrders();
    const { rows } = await pool.query(`SELECT status FROM aliexpress_fulfillments WHERE order_id = $1`, [order.body.data.id]);
    expect(rows[0].status).toBe("queued");
  });

  it("automatic suppliers go straight to the worker", async () => {
    await request(app).patch("/api/marketplace/admin/sourcing/suppliers/aliexpress").set("Authorization", `Bearer ${adminToken}`).send({ orderMode: "auto" });
    const { initialFulfilmentStatus } = await import("../services/sourcing/orderRouting");
    expect(await initialFulfilmentStatus("aliexpress")).toBe("queued");
    expect(await initialFulfilmentStatus("cj")).toBe("queued"); // never set: automatic, as before
  });
});
