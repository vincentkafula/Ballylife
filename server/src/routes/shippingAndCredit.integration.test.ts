import { describe, it, expect, beforeAll, vi } from "vitest";
import request from "supertest";
import express, { type Express } from "express";
import bcrypt from "bcryptjs";
import { createTestDb } from "../test/testDb";
import { registerAndVerifyCustomer } from "../test/authHelpers";

const { pool } = createTestDb();
vi.mock("../db/pool", () => ({ pool, hasDb: true }));

let app: Express;

async function makeCustomerWithOrder(opts: { username: string; productId: string; paymentMethod: string }) {
  // pg-mem has a documented bug evaluating parameterized "SET stock =
  // stock - $1" (see adminCustomsAndAuthority.integration.test.ts and
  // orders.integration.test.ts for the same note) -- across several
  // orders against the same shared product in this file, that can leave
  // stock at 0 and the next order legitimately rejected as
  // out-of-stock. Not a bug in this app's SQL (which is completely
  // standard); resetting stock before each order sidesteps it the same
  // way the other test files route around it, rather than asserting on
  // exact post-decrement values.
  await pool.query(`UPDATE mkt_products SET stock = 50 WHERE id = $1`, [opts.productId]);
  const { token, userId } = await registerAndVerifyCustomer(app, pool, { username: opts.username, email: `${opts.username}@example.com` });
  await request(app).post(`/api/marketplace/addresses/${userId}`).set("Authorization", `Bearer ${token}`).send({
    firstName: "T", lastName: "C", line1: "1 St", city: "Cape Town", postalCode: "8001", country: "ZA", phone: "0821234567",
  });
  await request(app).post(`/api/marketplace/cart/${userId}/add`).set("Authorization", `Bearer ${token}`).send({ productId: opts.productId, quantity: 1 });
  const orderRes = await request(app).post("/api/marketplace/orders").set("Authorization", `Bearer ${token}`).send({ paymentMethod: opts.paymentMethod });
  return { token, userId, orderId: orderRes.body.data.id as string, orderRes };
}

beforeAll(async () => {
  const authRouter = (await import("../routes/authRouter")).default;
  const marketplaceRouter = (await import("../routes/marketplaceRouter")).default;
  app = express();
  app.use(express.json());
  app.use("/api/auth", authRouter);
  app.use("/api/marketplace", marketplaceRouter);

  await pool.query(`INSERT INTO mkt_tax_rates (country, vat_rate_pct, default_duty_rate_pct) VALUES ('ZA', 15, 20)`);
  await pool.query(`INSERT INTO mkt_categories (id, name, slug, icon) VALUES ('cat-01','Electronics','electronics','📱')`);
  await pool.query(`INSERT INTO users (id, username, password_hash, role, name, email) VALUES ('22222222-2222-2222-2222-222222222222','sellerowner2','x','seller','Seller Owner','seller2@example.com')`);
  await pool.query(`INSERT INTO mkt_sellers (id, user_id, store_name, store_slug, status, commission_pct) VALUES ('sel-1','22222222-2222-2222-2222-222222222222','Test Store','test-store','active',8)`);
  await pool.query(
    `INSERT INTO mkt_products (id, seller_id, category_id, name, slug, price, currency, images, status, stock, brand)
     VALUES ('33333333-3333-3333-3333-333333333333','sel-1','cat-01','Wireless Earbuds','wireless-earbuds',499,'ZAR','[]','active',10,'SoundCo')`
  );

  // Two credit providers, matching the real seeded ones' provider_key
  // convention exactly (bnpl_<key> is how checkout matches them).
  await pool.query(`INSERT INTO mkt_credit_providers (id, name, provider_key, status) VALUES ('cred-payflex','PayFlex','payflex','active')`);
  await pool.query(`INSERT INTO mkt_credit_providers (id, name, provider_key, status) VALUES ('cred-payjustnow','PayJustNow','payjustnow','active')`);

  await pool.query(`INSERT INTO mkt_shipping_companies (id, name, country, status) VALUES ('ship-dhl','DHL Express','ZA','active')`);
  await pool.query(`INSERT INTO mkt_shipping_companies (id, name, country, status) VALUES ('ship-other','Other Courier','ZA','active')`);
});

describe("Credit provider: BNPL orders route to the right provider and need a real lending decision", () => {
  let payflexToken: string;
  let payjustnowToken: string;
  let pendingOrderId: string;
  let payflexProviderUserId: string;

  beforeAll(async () => {
    const hash = await bcrypt.hash("Ballylife@2026", 10);
    const payflexUser = await pool.query(
      `INSERT INTO users (username, password_hash, role, name, email) VALUES ('credittest1', $1, 'credit_provider', 'PayFlex Tester', 'pf@example.com') RETURNING id`,
      [hash]
    );
    payflexProviderUserId = payflexUser.rows[0].id;
    await pool.query(`UPDATE mkt_credit_providers SET user_id = $1 WHERE id = 'cred-payflex'`, [payflexProviderUserId]);
    const payjustnowUser = await pool.query(
      `INSERT INTO users (username, password_hash, role, name, email) VALUES ('credittest2', $1, 'credit_provider', 'PayJustNow Tester', 'pjn@example.com') RETURNING id`,
      [hash]
    );
    await pool.query(`UPDATE mkt_credit_providers SET user_id = $1 WHERE id = 'cred-payjustnow'`, [payjustnowUser.rows[0].id]);

    const login1 = await request(app).post("/api/auth/login").send({ username: "credittest1", password: "Ballylife@2026" });
    payflexToken = login1.body.data.token;
    const login2 = await request(app).post("/api/auth/login").send({ username: "credittest2", password: "Ballylife@2026" });
    payjustnowToken = login2.body.data.token;
  });

  it("routes a bnpl_payflex order to PayFlex specifically, and leaves it genuinely pending (not auto-confirmed) even for a demo-named account", async () => {
    // "customer1" is one of the app's own fixed DEMO_USERNAMES -- this
    // is the exact case the feature exists to prove: a credit purchase
    // is never auto-confirmed, demo account or not.
    const { orderId, orderRes } = await makeCustomerWithOrder({ username: "customer1", productId: "33333333-3333-3333-3333-333333333333", paymentMethod: "bnpl_payflex" });
    pendingOrderId = orderId;
    expect(orderRes.status).toBe(202);
    expect(orderRes.body.meta.paymentStatus).toBe("pending_payment");
    expect(orderRes.body.meta.isDemoAccount).toBe(true);

    const dbRow = await pool.query(`SELECT status, payment_status, credit_provider_id, credit_decision FROM mkt_orders WHERE id = $1`, [orderId]);
    expect(dbRow.rows[0].status).toBe("pending");
    expect(dbRow.rows[0].payment_status).toBe("pending_payment");
    expect(dbRow.rows[0].credit_provider_id).toBe("cred-payflex");
    expect(dbRow.rows[0].credit_decision).toBe("pending");
  });

  it("shows the pending order on PayFlex's dashboard, but not on PayJustNow's", async () => {
    const payflexList = await request(app).get("/api/marketplace/credit-providers/cred-payflex/orders").set("Authorization", `Bearer ${payflexToken}`);
    expect(payflexList.status).toBe(200);
    expect(payflexList.body.data.some((o: { id: string }) => o.id === pendingOrderId)).toBe(true);

    const payjustnowList = await request(app).get("/api/marketplace/credit-providers/cred-payjustnow/orders").set("Authorization", `Bearer ${payjustnowToken}`);
    expect(payjustnowList.status).toBe(200);
    expect(payjustnowList.body.data.some((o: { id: string }) => o.id === pendingOrderId)).toBe(false);
  });

  it("rejects PayJustNow trying to decide on an order that isn't theirs", async () => {
    const res = await request(app).post(`/api/marketplace/credit-providers/cred-payjustnow/orders/${pendingOrderId}/approve`).set("Authorization", `Bearer ${payjustnowToken}`);
    expect(res.status).toBe(409);
  });

  it("approving moves the order to confirmed -- the only path to confirmed a BNPL order has", async () => {
    const res = await request(app).post(`/api/marketplace/credit-providers/cred-payflex/orders/${pendingOrderId}/approve`).set("Authorization", `Bearer ${payflexToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("confirmed");
    expect(res.body.data.paymentStatus).toBe("payment_confirmed");
    expect(res.body.data.creditDecision).toBe("approved");
  });

  it("refuses to approve the same order twice", async () => {
    const res = await request(app).post(`/api/marketplace/credit-providers/cred-payflex/orders/${pendingOrderId}/approve`).set("Authorization", `Bearer ${payflexToken}`);
    expect(res.status).toBe(409);
  });

  it("declining a different order restocks the item and marks payment failed", async () => {
    const { orderId } = await makeCustomerWithOrder({ username: "declinecustomer", productId: "33333333-3333-3333-3333-333333333333", paymentMethod: "bnpl_payflex" });
    const beforeStock = await pool.query(`SELECT stock FROM mkt_products WHERE id = '33333333-3333-3333-3333-333333333333'`);

    const res = await request(app).post(`/api/marketplace/credit-providers/cred-payflex/orders/${orderId}/decline`).set("Authorization", `Bearer ${payflexToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("payment_failed");
    expect(res.body.data.creditDecision).toBe("declined");

    const afterStock = await pool.query(`SELECT stock FROM mkt_products WHERE id = '33333333-3333-3333-3333-333333333333'`);
    expect(Number(afterStock.rows[0].stock)).toBe(Number(beforeStock.rows[0].stock) + 1);
  });

  it("rejects a customer (not a credit provider) from viewing any provider's order list", async () => {
    const { token } = await registerAndVerifyCustomer(app, pool, { username: "notacreditprovider", email: "notcred@example.com" });
    const res = await request(app).get("/api/marketplace/credit-providers/cred-payflex/orders").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it("looks up the provider's own record via by-user", async () => {
    const res = await request(app).get(`/api/marketplace/credit-providers/by-user/${payflexProviderUserId}`).set("Authorization", `Bearer ${payflexToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.providerKey).toBe("payflex");
  });
});

describe("Shipping company: claim, pick up, and deliver with a real signature", () => {
  let dhlToken: string;
  let otherCourierToken: string;
  let confirmedOrderId: string;

  beforeAll(async () => {
    const hash = await bcrypt.hash("Ballylife@2026", 10);
    const dhlUser = await pool.query(
      `INSERT INTO users (username, password_hash, role, name, email) VALUES ('shiptest1', $1, 'shipping_company', 'DHL Tester', 'dhl@example.com') RETURNING id`,
      [hash]
    );
    await pool.query(`UPDATE mkt_shipping_companies SET user_id = $1 WHERE id = 'ship-dhl'`, [dhlUser.rows[0].id]);
    const otherUser = await pool.query(
      `INSERT INTO users (username, password_hash, role, name, email) VALUES ('shiptest2', $1, 'shipping_company', 'Other Tester', 'other@example.com') RETURNING id`,
      [hash]
    );
    await pool.query(`UPDATE mkt_shipping_companies SET user_id = $1 WHERE id = 'ship-other'`, [otherUser.rows[0].id]);

    const login1 = await request(app).post("/api/auth/login").send({ username: "shiptest1", password: "Ballylife@2026" });
    dhlToken = login1.body.data.token;
    const login2 = await request(app).post("/api/auth/login").send({ username: "shiptest2", password: "Ballylife@2026" });
    otherCourierToken = login2.body.data.token;

    // A normal (non-BNPL) order, manually confirmed the way a real
    // payment webhook would -- shipping only ever sees confirmed orders.
    const { orderId } = await makeCustomerWithOrder({ username: "shipflowcustomer", productId: "33333333-3333-3333-3333-333333333333", paymentMethod: "bank_transfer" });
    await pool.query(`UPDATE mkt_orders SET status = 'confirmed', payment_status = 'payment_confirmed' WHERE id = $1`, [orderId]);
    confirmedOrderId = orderId;
  });

  it("shows the confirmed, unclaimed order as available to both shipping companies", async () => {
    const dhlList = await request(app).get("/api/marketplace/shipping-companies/ship-dhl/orders").set("Authorization", `Bearer ${dhlToken}`);
    expect(dhlList.status).toBe(200);
    expect(dhlList.body.data.some((o: { id: string }) => o.id === confirmedOrderId)).toBe(true);
  });

  it("lets DHL claim it", async () => {
    const res = await request(app).post(`/api/marketplace/shipping-companies/ship-dhl/orders/${confirmedOrderId}/claim`).set("Authorization", `Bearer ${dhlToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.shippingCompanyId).toBe("ship-dhl");
  });

  it("refuses to let the other courier claim the same order now that DHL has it", async () => {
    const res = await request(app).post(`/api/marketplace/shipping-companies/ship-other/orders/${confirmedOrderId}/claim`).set("Authorization", `Bearer ${otherCourierToken}`);
    expect(res.status).toBe(409);
  });

  it("refuses to let the other courier pick up or deliver an order it never claimed", async () => {
    const res = await request(app).post(`/api/marketplace/shipping-companies/ship-other/orders/${confirmedOrderId}/pickup`).set("Authorization", `Bearer ${otherCourierToken}`);
    expect(res.status).toBe(404);
  });

  it("marks the order picked up", async () => {
    const res = await request(app).post(`/api/marketplace/shipping-companies/ship-dhl/orders/${confirmedOrderId}/pickup`).set("Authorization", `Bearer ${dhlToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.shippingStatus).toBe("picked_up");
  });

  it("refuses to deliver without a real signedBy name", async () => {
    const res = await request(app).post(`/api/marketplace/shipping-companies/ship-dhl/orders/${confirmedOrderId}/deliver`).set("Authorization", `Bearer ${dhlToken}`).send({});
    expect(res.status).toBe(400);
  });

  it("delivers with a signature, closing out both shipping_status and the order's own status", async () => {
    const res = await request(app).post(`/api/marketplace/shipping-companies/ship-dhl/orders/${confirmedOrderId}/deliver`).set("Authorization", `Bearer ${dhlToken}`).send({ signedBy: "J. Nkosi" });
    expect(res.status).toBe(200);
    expect(res.body.data.shippingStatus).toBe("delivered");
    expect(res.body.data.status).toBe("delivered");
    expect(res.body.data.deliverySignedBy).toBe("J. Nkosi");
    expect(res.body.data.deliverySignedAt).toBeTruthy();
  });

  it("rejects a customer (not a shipping company) from viewing any company's order list", async () => {
    const { token } = await registerAndVerifyCustomer(app, pool, { username: "notashippingco", email: "notship@example.com" });
    const res = await request(app).get("/api/marketplace/shipping-companies/ship-dhl/orders").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});
