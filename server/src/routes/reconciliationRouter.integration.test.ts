import { describe, it, expect, beforeAll, vi } from "vitest";
import request from "supertest";
import express, { type Express } from "express";
import bcrypt from "bcryptjs";
import { createTestDb } from "../test/testDb";
import { registerAndVerifyCustomer } from "../test/authHelpers";

const { pool } = createTestDb();
vi.mock("../db/pool", () => ({ pool, hasDb: true }));

let app: Express;
let adminToken: string;
let customerToken: string;

async function makeOrder(orderNumber: string, subtotal: number, totalAmount: number): Promise<string> {
  const { userId } = await registerAndVerifyCustomer(app, pool, { username: `buyer-${orderNumber}`, email: `${orderNumber}@example.com` });
  const { rows } = await pool.query(
    `INSERT INTO mkt_orders (order_number, user_id, subtotal, total_amount, payment_status) VALUES ($1,$2,$3,$4,'payment_confirmed') RETURNING id`,
    [orderNumber, userId, subtotal, totalAmount]
  );
  return rows[0].id;
}

beforeAll(async () => {
  const authRouter = (await import("../routes/authRouter")).default;
  const reconciliationRouter = (await import("./reconciliationRouter")).default;
  app = express();
  app.use(express.json());
  app.use("/api/auth", authRouter);
  app.use("/api/marketplace", reconciliationRouter);

  await pool.query(`INSERT INTO mkt_categories (id, name, slug, icon) VALUES ('cat-01','Electronics','electronics','📱')`);
  await pool.query(`INSERT INTO mkt_sellers (id, store_name, store_slug, status, commission_pct) VALUES ('sel-01','TechZone','techzone','active',10)`);
  const prod = await pool.query(
    `INSERT INTO mkt_products (seller_id, category_id, name, slug, price, currency, status, stock) VALUES ('sel-01','cat-01','Speaker','speaker',200,'ZAR','active',20) RETURNING id`
  );
  const productId = prod.rows[0].id;

  const adminHash = await bcrypt.hash("AdminPass123", 10);
  await pool.query(`INSERT INTO users (username, password_hash, role, name, email) VALUES ('reconadmin','${adminHash}','marketplace_admin','Admin','recon-admin@example.com')`);
  const adminLogin = await request(app).post("/api/auth/login").send({ username: "reconadmin", password: "AdminPass123" });
  adminToken = adminLogin.body.data.token;

  const { token } = await registerAndVerifyCustomer(app, pool, { username: "reconcustomer", email: "reconcustomer@example.com" });
  customerToken = token;

  // Order 1: everything correct -- confirmed payment matches total,
  // settlement matches subtotal, payout formula correct. Must raise
  // NO flags at all -- this is the "don't false-positive" proof.
  const order1 = await makeOrder("RECON-OK-1", 200, 200);
  await pool.query(`INSERT INTO mkt_pay_transactions (order_id, processor, payment_method, amount, status) VALUES ($1,'payfast','card',200,'confirmed')`, [order1]);
  await pool.query(
    `INSERT INTO mkt_order_line_settlements (order_id, product_id, seller_id, quantity, gross_amount, platform_fee_pct, platform_fee_amount, seller_payout_amount)
     VALUES ($1,$2,'sel-01',1,200,10,20,180)`,
    [order1, productId]
  );

  // Order 2: payment mismatch -- confirmed transactions only sum to 150,
  // but total_amount is 200. Should raise a Check A flag.
  const order2 = await makeOrder("RECON-PAYMISMATCH", 150, 200);
  await pool.query(`INSERT INTO mkt_pay_transactions (order_id, processor, payment_method, amount, status) VALUES ($1,'payfast','card',150,'confirmed')`, [order2]);

  // Order 3: the SAME kind of payment mismatch as order 2, but this
  // order has a refund on file -- must be excluded from Check A
  // entirely (a refund legitimately means less confirmed payment than
  // the original total, that's correct, not a bug).
  const order3 = await makeOrder("RECON-REFUNDED", 150, 200);
  await pool.query(`INSERT INTO mkt_pay_transactions (order_id, processor, payment_method, amount, status) VALUES ($1,'payfast','card',150,'confirmed')`, [order3]);
  await pool.query(`INSERT INTO mkt_order_refunds (order_id, amount, status) VALUES ($1, 50, 'processed')`, [order3]);

  // Order 4: settlement mismatch -- the line's gross_amount (150) doesn't
  // match the order's own subtotal (200). Should raise a Check B flag
  // (and ONLY that one -- a matching confirmed payment is seeded too so
  // this order doesn't also trip Check A, which would conflate two
  // different tests into one).
  const order4 = await makeOrder("RECON-SETTLEMISMATCH", 200, 200);
  await pool.query(`INSERT INTO mkt_pay_transactions (order_id, processor, payment_method, amount, status) VALUES ($1,'payfast','card',200,'confirmed')`, [order4]);
  await pool.query(
    `INSERT INTO mkt_order_line_settlements (order_id, product_id, seller_id, quantity, gross_amount, platform_fee_pct, platform_fee_amount, seller_payout_amount)
     VALUES ($1,$2,'sel-01',1,150,10,15,135)`,
    [order4, productId]
  );

  // Order 5: the payout formula itself is wrong -- gross(200) - fee(20)
  // = 180, but seller_payout_amount is stored as 999. Should raise a
  // Check C flag (critical severity, this one's an internal bookkeeping
  // bug, not just an external mismatch) -- again with a matching
  // confirmed payment and a correct settlement sum so this order
  // doesn't also trip Checks A or B.
  const order5 = await makeOrder("RECON-FORMULAWRONG", 200, 200);
  await pool.query(`INSERT INTO mkt_pay_transactions (order_id, processor, payment_method, amount, status) VALUES ($1,'payfast','card',200,'confirmed')`, [order5]);
  await pool.query(
    `INSERT INTO mkt_order_line_settlements (order_id, product_id, seller_id, quantity, gross_amount, platform_fee_pct, platform_fee_amount, seller_payout_amount)
     VALUES ($1,$2,'sel-01',1,200,10,20,999)`,
    [order5, productId]
  );
});

describe("POST /api/marketplace/admin/reconciliation/run", () => {
  it("rejects a non-admin", async () => {
    const res = await request(app).post("/api/marketplace/admin/reconciliation/run").set("Authorization", `Bearer ${customerToken}`);
    expect(res.status).toBe(403);
  });

  it("raises exactly the three real mismatches -- not the correct order, not the excluded refunded one", async () => {
    const res = await request(app).post("/api/marketplace/admin/reconciliation/run").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.flagsRaised).toBe(3); // payment mismatch, settlement mismatch, formula mismatch -- NOT the refunded one

    const flagsRes = await request(app).get("/api/marketplace/admin/fraud-flags").set("Authorization", `Bearer ${adminToken}`);
    const rules = flagsRes.body.data.map((f: { rule: string }) => f.rule);
    expect(rules.filter((r: string) => r === "reconciliation_payment_mismatch").length).toBe(1);
    expect(rules.filter((r: string) => r === "reconciliation_settlement_mismatch").length).toBe(1);
    expect(rules.filter((r: string) => r === "reconciliation_payout_formula_mismatch").length).toBe(1);

    const formulaFlag = flagsRes.body.data.find((f: { rule: string }) => f.rule === "reconciliation_payout_formula_mismatch");
    expect(formulaFlag.severity).toBe("critical");
    expect(formulaFlag.message).toContain("180.00"); // the correctly-computed expected value, not the wrong stored one
  });

  it("running it again doesn't duplicate flags endlessly -- each run adds its own set (idempotency isn't required at this stage, but the count should be predictable)", async () => {
    const before = await request(app).get("/api/marketplace/admin/fraud-flags").set("Authorization", `Bearer ${adminToken}`);
    const beforeCount = before.body.data.length;
    await request(app).post("/api/marketplace/admin/reconciliation/run").set("Authorization", `Bearer ${adminToken}`);
    const after = await request(app).get("/api/marketplace/admin/fraud-flags").set("Authorization", `Bearer ${adminToken}`);
    expect(after.body.data.length).toBe(beforeCount + 3); // same 3 real mismatches raised again, nothing new or missing
  });
});

describe("GET/PATCH /api/marketplace/admin/fraud-flags", () => {
  it("filters by status and by rule", async () => {
    const byRule = await request(app).get("/api/marketplace/admin/fraud-flags?rule=reconciliation_payment_mismatch").set("Authorization", `Bearer ${adminToken}`);
    expect(byRule.body.data.every((f: { rule: string }) => f.rule === "reconciliation_payment_mismatch")).toBe(true);

    const byStatus = await request(app).get("/api/marketplace/admin/fraud-flags?status=open").set("Authorization", `Bearer ${adminToken}`);
    expect(byStatus.body.data.every((f: { status: string }) => f.status === "open")).toBe(true);
  });

  it("resolving a flag sets resolved_at and resolved_by, and it stops showing under status=open", async () => {
    const list = await request(app).get("/api/marketplace/admin/fraud-flags?status=open").set("Authorization", `Bearer ${adminToken}`);
    const flagId = list.body.data[0].id;

    const patchRes = await request(app).patch(`/api/marketplace/admin/fraud-flags/${flagId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "dismissed", resolutionReason: "Known test data, not a real issue" });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.data.resolved_at).toBeTruthy();
    expect(patchRes.body.data.resolved_by).toBeTruthy();

    const stillOpen = await request(app).get("/api/marketplace/admin/fraud-flags?status=open").set("Authorization", `Bearer ${adminToken}`);
    expect(stillOpen.body.data.some((f: { id: string }) => f.id === flagId)).toBe(false);
  });

  it("rejects an invalid status value", async () => {
    const list = await request(app).get("/api/marketplace/admin/fraud-flags").set("Authorization", `Bearer ${adminToken}`);
    const flagId = list.body.data[0].id;
    const res = await request(app).patch(`/api/marketplace/admin/fraud-flags/${flagId}`).set("Authorization", `Bearer ${adminToken}`).send({ status: "not-a-real-status" });
    expect(res.status).toBe(400);
  });
});
