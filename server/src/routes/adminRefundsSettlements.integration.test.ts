import { describe, it, expect, beforeAll, vi } from "vitest";
import request from "supertest";
import express, { type Express } from "express";
import bcrypt from "bcryptjs";
import { createTestDb } from "../test/testDb";

const { pool } = createTestDb();
vi.mock("../db/pool", () => ({ pool, hasDb: true }));

let app: Express;
let adminToken: string;
let customerToken: string;
let customerUserId: string;
let orderId: string;
const orderProductId = "66666666-6666-6666-6666-666666666666";

beforeAll(async () => {
  const authRouter = (await import("../routes/authRouter")).default;
  const marketplaceRouter = (await import("../routes/marketplaceRouter")).default;
  app = express();
  app.use(express.json());
  app.use("/api/auth", authRouter);
  app.use("/api/marketplace", marketplaceRouter);

  await pool.query(`INSERT INTO mkt_tax_rates (country, vat_rate_pct, default_duty_rate_pct) VALUES ('ZA', 15, 20)`);
  await pool.query(`INSERT INTO mkt_categories (id, name, slug, icon) VALUES ('cat-01','Electronics','electronics','📱')`);
  await pool.query(`INSERT INTO users (id, username, password_hash, role, name, email) VALUES ('77777777-7777-7777-7777-777777777777','sellerowner2','x','seller','Seller Owner','seller2@example.com')`);
  await pool.query(`INSERT INTO mkt_sellers (id, user_id, store_name, store_slug, status, commission_pct) VALUES ('sel-2','77777777-7777-7777-7777-777777777777','Test Store 2','test-store-2','active',10)`);
  await pool.query(
    `INSERT INTO mkt_products (id, seller_id, category_id, name, slug, price, currency, images, status, stock, brand)
     VALUES ('${orderProductId}','sel-2','cat-01','Bluetooth Speaker','bluetooth-speaker',200,'ZAR','[]','active',20,'SoundCo')`
  );

  // Admin account — /register always creates 'customer' accounts, so a
  // manager login has to be inserted directly, the same way the real
  // seed scripts do it, then authenticated through the real login route.
  const adminHash = await bcrypt.hash("AdminPass123", 10);
  await pool.query(`INSERT INTO users (id, username, password_hash, role, name, email) VALUES ('88888888-8888-8888-8888-888888888888','admintest','${adminHash}','marketplace_admin','Admin Test','admin@example.com')`);
  const adminLogin = await request(app).post("/api/auth/login").send({ username: "admintest", password: "AdminPass123" });
  adminToken = adminLogin.body.data.token;

  // A real customer order, via the real flow, so the refund/settlement
  // tests below act on a genuine order record with a genuine settlement
  // row — not one hand-inserted to look like the real shape.
  const registerRes = await request(app).post("/api/auth/register").send({
    username: "refundtestcustomer", password: "TestPass123", name: "Refund Test Customer", email: "refundtest@example.com",
  });
  customerToken = registerRes.body.data.token;
  customerUserId = registerRes.body.data.user.id;
  await request(app).post(`/api/marketplace/addresses/${customerUserId}`).set("Authorization", `Bearer ${customerToken}`).send({
    firstName: "Refund", lastName: "Test", line1: "1 Test Street", city: "Cape Town", postalCode: "8001", country: "ZA", phone: "0821234567",
  });
  await request(app).post(`/api/marketplace/cart/${customerUserId}/add`).set("Authorization", `Bearer ${customerToken}`).send({ productId: orderProductId, quantity: 3 });
  const orderRes = await request(app).post("/api/marketplace/orders").set("Authorization", `Bearer ${customerToken}`).send({ paymentMethod: "bank_transfer" });
  orderId = orderRes.body.data.id;
});

describe("Admin auth requirement", () => {
  it("rejects a customer trying to access admin refund/settlement routes", async () => {
    const refundRes = await request(app).post(`/api/marketplace/admin/orders/${orderId}/refund`)
      .set("Authorization", `Bearer ${customerToken}`).send({ reason: "test" });
    expect(refundRes.status).toBe(403);

    const settlementsRes = await request(app).get("/api/marketplace/admin/settlements").set("Authorization", `Bearer ${customerToken}`);
    expect(settlementsRes.status).toBe(403);
  });

  it("rejects any request with no token at all", async () => {
    const res = await request(app).get("/api/marketplace/admin/settlements");
    expect(res.status).toBe(401);
  });
});

describe("GET /api/marketplace/admin/settlements", () => {
  it("lists the settlement row created for the real order above, with the seller's 10% commission applied", async () => {
    const res = await request(app).get("/api/marketplace/admin/settlements").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const row = res.body.data.find((s: { orderId: string }) => s.orderId === orderId);
    expect(row).toBeTruthy();
    expect(row.platformFeePct).toBe(10);
    expect(row.grossAmount).toBe(600); // 200 * 3
    expect(row.platformFeeAmount).toBeCloseTo(60, 2);
    expect(row.sellerPayoutAmount).toBeCloseTo(540, 2); // 600 - 60, no supplier cost on a local line
  });

  it("includes running totals reflecting pending payouts", async () => {
    const res = await request(app).get("/api/marketplace/admin/settlements").set("Authorization", `Bearer ${adminToken}`);
    expect(res.body.meta.totals.platformFeeTotal).toBeGreaterThanOrEqual(60);
    expect(res.body.meta.totals.sellerOwedTotal).toBeGreaterThanOrEqual(540);
  });
});

describe("PATCH /api/marketplace/admin/settlements/:id — marking a payout paid", () => {
  it("marks the seller side paid and records a reference", async () => {
    const listRes = await request(app).get("/api/marketplace/admin/settlements").set("Authorization", `Bearer ${adminToken}`);
    const settlementId = listRes.body.data.find((s: { orderId: string }) => s.orderId === orderId).id;

    const patchRes = await request(app).patch(`/api/marketplace/admin/settlements/${settlementId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ sellerPayoutStatus: "paid", sellerPayoutReference: "EFT-TEST-001" });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.data.sellerPayoutStatus).toBe("paid");
    expect(patchRes.body.data.sellerPayoutReference).toBe("EFT-TEST-001");
    expect(patchRes.body.data.sellerPaidAt).toBeTruthy();
  });
});

describe("POST /api/marketplace/admin/orders/:id/refund", () => {
  it("issues a partial (line-quantity) refund and updates the order's refunded_amount", async () => {
    const res = await request(app).post(`/api/marketplace/admin/orders/${orderId}/refund`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ productId: orderProductId, quantity: 1, reason: "Customer changed mind about one unit" });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.amount).toBe(200); // 1 unit at 200 each
    expect(res.body.data.quantity).toBe(1);

    const orderRes = await pool.query(`SELECT status, refunded_amount, total_amount FROM mkt_orders WHERE id = $1`, [orderId]);
    expect(Number(orderRes.rows[0].refunded_amount)).toBe(200);
    expect(orderRes.rows[0].status).toBe("partially_refunded"); // less than the full total was refunded
  });

  it("flags the line's settlement as refunded so no payout is issued for it", async () => {
    const settlementRes = await pool.query(
      `SELECT seller_payout_status FROM mkt_order_line_settlements WHERE order_id = $1 AND product_id = $2`,
      [orderId, orderProductId]
    );
    expect(settlementRes.rows[0].seller_payout_status).toBe("refunded");
  });

  it("refunds exactly what's left when no product is specified (whole-order refund), then rejects a further refund", async () => {
    const res = await request(app).post(`/api/marketplace/admin/orders/${orderId}/refund`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reason: "Refunding the rest of the order" });
    expect(res.status).toBe(201);

    const orderRes = await pool.query(`SELECT status, refunded_amount, total_amount FROM mkt_orders WHERE id = $1`, [orderId]);
    expect(orderRes.rows[0].status).toBe("refunded"); // now fully refunded
    expect(Number(orderRes.rows[0].refunded_amount)).toBeCloseTo(Number(orderRes.rows[0].total_amount), 2);

    // A further refund attempt now has nothing left to refund.
    const overRes = await request(app).post(`/api/marketplace/admin/orders/${orderId}/refund`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reason: "Nothing left" });
    expect(overRes.status).toBe(400);
    expect(overRes.body.error).toMatch(/nothing left to refund/i);
  });
});
