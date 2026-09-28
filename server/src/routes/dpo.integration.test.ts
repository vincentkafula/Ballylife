import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import express, { type Express } from "express";
import bcrypt from "bcryptjs";
import { createTestDb } from "../test/testDb";
import { registerAndVerifyCustomer } from "../test/authHelpers";

// Test DPO merchant (read when the DPO module loads, below). No real calls: fetch is simulated.
process.env.DPO_COMPANY_TOKEN = "TEST-COMPANY-TOKEN";
process.env.DPO_SERVICE_TYPE = "5525";
process.env.MARKETPLACE_PUBLIC_URL = "https://www.ballylife.com";
process.env.MARKETPLACE_API_PUBLIC_URL = "https://api.example.test";

const { pool } = createTestDb();
vi.mock("../db/pool", () => ({ pool, hasDb: true }));

// ── Simulated DPO API ──────────────────────────────────────────────────────
const dpo = { requests: [] as string[], verifyResult: "900", verifyAmount: "0", verifyCurrency: "USD", tokens: 0 };
function fakeDpo(_url: string, init?: { body?: string }) {
  const body = String(init?.body ?? "");
  dpo.requests.push(body);
  const req = body.match(/<Request>(\w+)<\/Request>/)?.[1];
  const xml = (inner: string) => new Response(`<?xml version="1.0" encoding="utf-8"?><API3G>${inner}</API3G>`, { status: 200 });
  if (req === "createToken") { dpo.tokens++; return Promise.resolve(xml(`<Result>000</Result><ResultExplanation>Transaction created</ResultExplanation><TransToken>TOK-${dpo.tokens}-ABCDEF</TransToken><TransRef>R${dpo.tokens}</TransRef>`)); }
  if (req === "verifyToken") return Promise.resolve(xml(`<Result>${dpo.verifyResult}</Result><ResultExplanation>x</ResultExplanation><TransactionAmount>${dpo.verifyAmount}</TransactionAmount><TransactionCurrency>${dpo.verifyCurrency}</TransactionCurrency>`));
  if (req === "refundToken") return Promise.resolve(xml(`<Result>000</Result><ResultExplanation>Refund successful</ResultExplanation>`));
  return Promise.resolve(xml(`<Result>803</Result>`));
}

let app: Express;
let customerToken: string;
let customerId: string;
let adminToken: string;
let zaAddressId: string;
let order: { id: string; orderNumber: string; totalAmount: number };
let usd: number;
const token = "TOK-1-ABCDEF";

beforeAll(async () => {
  vi.stubGlobal("fetch", vi.fn(fakeDpo));
  const authRouter = (await import("./authRouter")).default;
  const marketplaceRouter = (await import("./marketplaceRouter")).default;
  const dpoRouter = (await import("./dpoRouter")).default;
  app = express();
  app.use(express.json());
  app.use("/api/auth", authRouter);
  app.use("/api/marketplace", marketplaceRouter);
  app.use("/api/marketplace", dpoRouter);

  await pool.query(`INSERT INTO mkt_tax_rates (country, vat_rate_pct, default_duty_rate_pct) VALUES ('ZA', 15, 20), ('ZM', 16, 25)`);
  await pool.query(`INSERT INTO mkt_categories (id, name, slug, icon) VALUES ('cat-01','Electronics','electronics','📱')`);
  await pool.query(`INSERT INTO mkt_fx_rates (currency, rate_to_zar) VALUES ('USD', 18)`);
  await pool.query(`INSERT INTO users (id, username, password_hash, role, name, email) VALUES ('22222222-2222-2222-2222-222222222222','dposeller','x','seller','S','dposeller@example.com')`);
  await pool.query(`INSERT INTO mkt_sellers (id, user_id, store_name, store_slug, status, commission_pct) VALUES ('sel-1','22222222-2222-2222-2222-222222222222','Store','store','active',8)`);
  await pool.query(`INSERT INTO mkt_products (id, seller_id, category_id, name, slug, price, currency, images, status, stock) VALUES
    ('33333333-3333-3333-3333-333333333333','sel-1','cat-01','Solar Lantern','solar-lantern',450,'ZAR','[]','active',50)`);
  const hash = await bcrypt.hash("AdminPass123", 10);
  await pool.query(`INSERT INTO users (username, password_hash, role, name, email) VALUES ('dpoadmin','${hash}','marketplace_admin','Admin','dpoadmin@example.com')`);
  adminToken = (await request(app).post("/api/auth/login").send({ username: "dpoadmin", password: "AdminPass123" })).body.data.token;

  const c = await registerAndVerifyCustomer(app, pool, { username: "lusakabuyer", email: "lusaka@example.com", name: "Mwila Banda" });
  customerToken = c.token; customerId = c.userId;
  const auth = { Authorization: `Bearer ${customerToken}` };
  await request(app).post(`/api/marketplace/addresses/${customerId}`).set(auth).send({
    firstName: "Mwila", lastName: "Banda", line1: "Plot 12 Cairo Road", city: "Lusaka", postalCode: "10101", country: "ZM", phone: "+260971234567",
  });
  const za = await request(app).post(`/api/marketplace/addresses/${customerId}`).set(auth).send({
    firstName: "Mwila", lastName: "Banda", line1: "1 Long Street", city: "Cape Town", postalCode: "8001", country: "ZA", phone: "0821234567",
  });
  zaAddressId = za.body.data?.id ?? (await pool.query(`SELECT id FROM mkt_addresses WHERE country = 'ZA'`)).rows[0].id;
});
afterAll(() => { vi.unstubAllGlobals(); });

const auth = () => ({ Authorization: `Bearer ${customerToken}` });
const settled = async () => (await pool.query(`SELECT * FROM mkt_pay_transactions WHERE processor_ref = $1`, [token])).rows[0];
// pg-mem applies `stock = stock - $1` backwards (see orders.integration.test.ts), so top stock up before each add.
const restock = () => pool.query(`UPDATE mkt_products SET stock = 50`);
const orderRow = async () => (await pool.query(`SELECT status, payment_status FROM mkt_orders WHERE id = $1`, [order.id])).rows[0];

describe("DPO Pay for shoppers outside South Africa", () => {
  it("checkout lists DPO, charged in US dollars", async () => {
    const res = await request(app).get("/api/marketplace/payments/methods");
    expect(res.body.data.dpo).toEqual({ available: true, provider: "DPO Pay", currency: "USD", usdPer1000Zar: Math.ceil(1000 / 18 * 100) / 100 });
  });

  it("a Zambian card order creates a DPO payment in USD and sends the shopper to DPO's page", async () => {
    const { rows: addr } = await pool.query(`SELECT id FROM mkt_addresses WHERE country = 'ZM'`);
    await restock(); await request(app).post(`/api/marketplace/cart/${customerId}/add`).set(auth()).send({ productId: "33333333-3333-3333-3333-333333333333", quantity: 1 });
    const res = await request(app).post("/api/marketplace/orders").set(auth()).send({ addressId: addr[0].id, paymentMethod: "card" });
    expect(res.body.success).toBe(true);
    order = res.body.data;
    expect(res.body.meta.redirect).toEqual({ url: `https://secure.3gdirectpay.com/payv2.php?ID=${token}`, fields: {} });
    expect(res.body.meta.paymentStatus).toBe("pending_payment");

    usd = Math.ceil(Number(order.totalAmount) / 18 * 100) / 100;
    const tx = await settled();
    expect(tx).toMatchObject({ processor: "dpo", status: "submitted", currency: "ZAR", charged_currency: "USD" });
    expect(Number(tx.amount)).toBe(Number(order.totalAmount)); // reconciliation keeps working in rand
    expect(Number(tx.charged_amount)).toBe(usd);

    const create = dpo.requests.find(b => b.includes("<Request>createToken</Request>"))!;
    expect(create).toContain(`<PaymentAmount>${usd.toFixed(2)}</PaymentAmount><PaymentCurrency>USD</PaymentCurrency>`);
    expect(create).toContain(`<CompanyRef>${order.orderNumber}</CompanyRef>`);
    expect(create).toContain("<CompanyRefUnique>1</CompanyRefUnique>");
    expect(create).toContain("<customerCountry>ZM</customerCountry>");
    expect(create).toContain("<ServiceType>5525</ServiceType>");
    expect(create).toContain("<RedirectURL>https://api.example.test/api/marketplace/dpo/return</RedirectURL>");
  });

  it("coming back before DPO has the money leaves the order unpaid", async () => {
    dpo.verifyResult = "900";
    const res = await request(app).get(`/api/marketplace/dpo/return?TransactionToken=${token}&CompanyRef=${order.orderNumber}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`https://www.ballylife.com/?dpo=pending&order=${order.orderNumber}`);
    expect((await orderRow()).payment_status).toBe("pending_payment");
  });

  it("a notice claiming payment for the wrong amount does not mark the order paid", async () => {
    dpo.verifyResult = "000"; dpo.verifyAmount = "1.00"; dpo.verifyCurrency = "USD";
    const res = await request(app).post("/api/marketplace/dpo/notify").set("Content-Type", "application/xml")
      .send(`<?xml version="1.0"?><API3G><Result>000</Result><TransactionToken>${token}</TransactionToken></API3G>`);
    expect(res.status).toBe(200);
    expect(res.text).toContain("<Response>OK</Response>");
    expect((await orderRow()).payment_status).toBe("pending_payment");
    expect((await settled()).error_message).toMatch(/expected/);
  });

  it("marks the order paid only when DPO confirms the exact amount", async () => {
    dpo.verifyAmount = usd.toFixed(2);
    const res = await request(app).get(`/api/marketplace/dpo/return?TransactionToken=${token}`);
    expect(res.headers.location).toBe(`https://www.ballylife.com/?dpo=paid&order=${order.orderNumber}`);
    expect(await orderRow()).toEqual({ status: "confirmed", payment_status: "payment_confirmed" });
    expect((await settled()).status).toBe("confirmed");

    const before = dpo.requests.length;
    await request(app).post("/api/marketplace/dpo/notify").set("Content-Type", "application/xml").send(`<API3G><TransactionToken>${token}</TransactionToken></API3G>`);
    expect(dpo.requests.length).toBe(before); // already paid: no second look-up, nothing changes
  });

  it("ignores junk and unknown tokens", async () => {
    const junk = await request(app).get(`/api/marketplace/dpo/return?TransactionToken=<script>&CompanyRef=x"y`);
    expect(junk.headers.location).toBe("https://www.ballylife.com/?dpo=pending");
    const unknown = await request(app).get(`/api/marketplace/dpo/return?TransactionToken=UNKNOWN-TOKEN-123`);
    expect(unknown.headers.location).toBe("https://www.ballylife.com/?dpo=pending");
  });

  it("refunds through DPO in the currency charged", async () => {
    const res = await request(app).post(`/api/marketplace/admin/orders/${order.id}/refund`).set("Authorization", `Bearer ${adminToken}`).send({ reason: "Customer cancelled" });
    expect(res.status).toBe(201);
    const refund = dpo.requests.find(b => b.includes("<Request>refundToken</Request>"))!;
    expect(refund).toContain(`<TransactionToken>${token}</TransactionToken><refundAmount>${usd.toFixed(2)}</refundAmount>`);
    expect(res.body.message).toMatch(/automatically/);
  });

  it("a declined payment ends that attempt, and the shopper can pay again", async () => {
    await restock(); await request(app).post(`/api/marketplace/cart/${customerId}/add`).set(auth()).send({ productId: "33333333-3333-3333-3333-333333333333", quantity: 1 });
    const { rows: addr } = await pool.query(`SELECT id FROM mkt_addresses WHERE country = 'ZM'`);
    const placed = await request(app).post("/api/marketplace/orders").set(auth()).send({ addressId: addr[0].id, paymentMethod: "card" });
    const second = placed.body.data;
    const tok = placed.body.meta.redirect.url.split("ID=")[1];
    dpo.verifyResult = "901";
    const back = await request(app).get(`/api/marketplace/dpo/return?TransactionToken=${tok}`);
    expect(back.headers.location).toContain("?dpo=failed");
    const { rows } = await pool.query(`SELECT status, payment_status FROM mkt_orders WHERE id = $1`, [second.id]);
    expect(rows[0].payment_status).toBe("pending_payment");
    const again = await request(app).post(`/api/marketplace/orders/${second.id}/pay`).set(auth());
    expect(again.status).toBe(200);
    expect(again.body.data.redirect.url).toMatch(/payv2\.php\?ID=TOK-/);
  });

  it("South African addresses don't use DPO", async () => {
    await restock(); await request(app).post(`/api/marketplace/cart/${customerId}/add`).set(auth()).send({ productId: "33333333-3333-3333-3333-333333333333", quantity: 1 });
    const res = await request(app).post("/api/marketplace/orders").set(auth()).send({ addressId: zaAddressId, paymentMethod: "card" });
    expect(res.body.success).toBe(true);
    const { rows } = await pool.query(`SELECT processor FROM mkt_pay_transactions WHERE order_id = $1`, [res.body.data.id]);
    expect(rows[0].processor).not.toBe("dpo");
  });
});
