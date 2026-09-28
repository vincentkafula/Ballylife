import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import express, { type Express } from "express";
import bcrypt from "bcryptjs";
import { createTestDb } from "../test/testDb";
import { registerAndVerifyCustomer } from "../test/authHelpers";

// Test DPO merchants (read when the DPO module loads, below): a main account
// (US dollars) and a DPO Zambia account (kwacha). No real calls: fetch is simulated.
process.env.DPO_COMPANY_TOKEN = "MAIN-COMPANY-TOKEN";
process.env.DPO_SERVICE_TYPE = "5525";
process.env.DPO_COMPANY_TOKEN_ZM = "ZM-COMPANY-TOKEN";
process.env.DPO_SERVICE_TYPE_ZM = "6001";
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
const lastRequest = (name: string) => [...dpo.requests].reverse().find(b => b.includes(`<Request>${name}</Request>`))!;

let app: Express;
let customerToken: string;
let customerId: string;
let adminToken: string;
const addressIds: Record<string, string> = {};

const up = (n: number) => Math.ceil(n * 100) / 100;
const USD_RATE = 18, ZMW_RATE = 0.7;

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

  await pool.query(`INSERT INTO mkt_tax_rates (country, vat_rate_pct, default_duty_rate_pct) VALUES ('ZA', 15, 20), ('ZM', 16, 25), ('KE', 16, 25)`);
  await pool.query(`INSERT INTO mkt_categories (id, name, slug, icon) VALUES ('cat-01','Electronics','electronics','📱')`);
  await pool.query(`INSERT INTO mkt_fx_rates (currency, rate_to_zar) VALUES ('USD', ${USD_RATE}), ('ZMW', ${ZMW_RATE})`);
  await pool.query(`INSERT INTO users (id, username, password_hash, role, name, email) VALUES ('22222222-2222-2222-2222-222222222222','dposeller','x','seller','S','dposeller@example.com')`);
  await pool.query(`INSERT INTO mkt_sellers (id, user_id, store_name, store_slug, status, commission_pct) VALUES ('sel-1','22222222-2222-2222-2222-222222222222','Store','store','active',8)`);
  await pool.query(`INSERT INTO mkt_products (id, seller_id, category_id, name, slug, price, currency, images, status, stock) VALUES
    ('33333333-3333-3333-3333-333333333333','sel-1','cat-01','Solar Lantern','solar-lantern',450,'ZAR','[]','active',50)`);
  const hash = await bcrypt.hash("AdminPass123", 10);
  await pool.query(`INSERT INTO users (username, password_hash, role, name, email) VALUES ('dpoadmin','${hash}','marketplace_admin','Admin','dpoadmin@example.com')`);
  adminToken = (await request(app).post("/api/auth/login").send({ username: "dpoadmin", password: "AdminPass123" })).body.data.token;

  const c = await registerAndVerifyCustomer(app, pool, { username: "africabuyer", email: "buyer@example.com", name: "Mwila Banda" });
  customerToken = c.token; customerId = c.userId;
  const places = [
    { country: "ZM", line1: "Plot 12 Cairo Road", city: "Lusaka", postalCode: "10101", phone: "+260971234567" },
    { country: "KE", line1: "12 Moi Avenue", city: "Nairobi", postalCode: "00100", phone: "+254712345678" },
    { country: "ZA", line1: "1 Long Street", city: "Cape Town", postalCode: "8001", phone: "0821234567" },
  ];
  for (const p of places) await request(app).post(`/api/marketplace/addresses/${customerId}`).set(auth()).send({ firstName: "Mwila", lastName: "Banda", ...p });
  const { rows } = await pool.query(`SELECT id, country FROM mkt_addresses WHERE user_id = $1`, [customerId]);
  for (const r of rows) addressIds[r.country] = r.id;
});
afterAll(() => { vi.unstubAllGlobals(); });

const auth = () => ({ Authorization: `Bearer ${customerToken}` });
// pg-mem applies `stock = stock - $1` backwards (see orders.integration.test.ts), so top stock up before each add.
const restock = () => pool.query(`UPDATE mkt_products SET stock = 50`);
async function placeOrder(country: string) {
  await restock();
  await request(app).post(`/api/marketplace/cart/${customerId}/add`).set(auth()).send({ productId: "33333333-3333-3333-3333-333333333333", quantity: 1 });
  const res = await request(app).post("/api/marketplace/orders").set(auth()).send({ addressId: addressIds[country], paymentMethod: "card" });
  expect(res.body.success).toBe(true);
  const redirect = res.body.meta.redirect as { url: string; fields: Record<string, string> } | undefined;
  return { order: res.body.data as { id: string; orderNumber: string; totalAmount: number }, redirect, token: redirect?.url.split("ID=")[1] ?? "" };
}
const tx = async (token: string) => (await pool.query(`SELECT * FROM mkt_pay_transactions WHERE processor_ref = $1`, [token])).rows[0];
const orderRow = async (id: string) => (await pool.query(`SELECT status, payment_status FROM mkt_orders WHERE id = $1`, [id])).rows[0];

describe("DPO Pay: Zambia in kwacha with mobile money", () => {
  let zm: Awaited<ReturnType<typeof placeOrder>>;
  let kwacha: number;

  it("checkout offers Zambian mobile money in kwacha, and US dollars elsewhere", async () => {
    const res = await request(app).get("/api/marketplace/payments/methods");
    expect(res.body.data.dpo).toEqual({
      available: true, provider: "DPO Pay", currency: "USD", international: true, usdPer1000Zar: up(1000 / USD_RATE),
      local: { ZM: { currency: "ZMW", per1000Zar: up(1000 / ZMW_RATE), mobileMoney: ["MTN MoMo", "Airtel Money", "Zamtel Kwacha"] } },
    });
  });

  it("a Zambian order is charged in ZMW on the DPO Zambia account, opening on mobile money", async () => {
    zm = await placeOrder("ZM");
    expect(zm.redirect).toEqual({ url: `https://secure.3gdirectpay.com/payv2.php?ID=${zm.token}`, fields: {} });
    kwacha = up(Number(zm.order.totalAmount) / ZMW_RATE);
    const create = lastRequest("createToken");
    expect(create).toContain("<CompanyToken>ZM-COMPANY-TOKEN</CompanyToken>");
    expect(create).toContain(`<PaymentAmount>${kwacha.toFixed(2)}</PaymentAmount><PaymentCurrency>ZMW</PaymentCurrency>`);
    expect(create).toContain("<DefaultPayment>MO</DefaultPayment>");
    expect(create).toContain("<ServiceType>6001</ServiceType>");
    expect(create).toContain("<customerCountry>ZM</customerCountry>");
    expect(create).toContain(`<CompanyRef>${zm.order.orderNumber}</CompanyRef>`);
    expect(create).toContain("<CompanyRefUnique>1</CompanyRefUnique>");
    expect(create).toContain("<RedirectURL>https://api.example.test/api/marketplace/dpo/return</RedirectURL>");
    const t = await tx(zm.token);
    expect(t).toMatchObject({ processor: "dpo", status: "submitted", currency: "ZAR", charged_currency: "ZMW", processor_account: "ZM" });
    expect(Number(t.amount)).toBe(Number(zm.order.totalAmount)); // reconciliation keeps working in rand
    expect(Number(t.charged_amount)).toBe(kwacha);
  });

  it("coming back before DPO has the money leaves the order unpaid", async () => {
    dpo.verifyResult = "900";
    const res = await request(app).get(`/api/marketplace/dpo/return?TransactionToken=${zm.token}&CompanyRef=${zm.order.orderNumber}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`https://www.ballylife.com/?dpo=pending&order=${zm.order.orderNumber}`);
    expect((await orderRow(zm.order.id)).payment_status).toBe("pending_payment");
    expect(lastRequest("verifyToken")).toContain("<CompanyToken>ZM-COMPANY-TOKEN</CompanyToken>"); // asks the account that took it
  });

  it("a notice claiming payment in the wrong currency or amount doesn't mark the order paid", async () => {
    dpo.verifyResult = "000"; dpo.verifyAmount = kwacha.toFixed(2); dpo.verifyCurrency = "USD";
    const res = await request(app).post("/api/marketplace/dpo/notify").set("Content-Type", "application/xml")
      .send(`<?xml version="1.0"?><API3G><Result>000</Result><TransactionToken>${zm.token}</TransactionToken></API3G>`);
    expect(res.status).toBe(200);
    expect(res.text).toContain("<Response>OK</Response>");
    expect((await orderRow(zm.order.id)).payment_status).toBe("pending_payment");
    expect((await tx(zm.token)).error_message).toMatch(/expected/);
  });

  it("marks the order paid only when DPO confirms the exact kwacha amount", async () => {
    dpo.verifyCurrency = "ZMW";
    const res = await request(app).get(`/api/marketplace/dpo/return?TransactionToken=${zm.token}`);
    expect(res.headers.location).toBe(`https://www.ballylife.com/?dpo=paid&order=${zm.order.orderNumber}`);
    expect(await orderRow(zm.order.id)).toEqual({ status: "confirmed", payment_status: "payment_confirmed" });

    const before = dpo.requests.length;
    await request(app).post("/api/marketplace/dpo/notify").set("Content-Type", "application/xml").send(`<API3G><TransactionToken>${zm.token}</TransactionToken></API3G>`);
    expect(dpo.requests.length).toBe(before); // already paid: nothing changes
  });

  it("refunds in kwacha on the Zambian account", async () => {
    const res = await request(app).post(`/api/marketplace/admin/orders/${zm.order.id}/refund`).set("Authorization", `Bearer ${adminToken}`).send({ reason: "Customer cancelled" });
    expect(res.status).toBe(201);
    const refund = lastRequest("refundToken");
    expect(refund).toContain("<CompanyToken>ZM-COMPANY-TOKEN</CompanyToken>");
    expect(refund).toContain(`<TransactionToken>${zm.token}</TransactionToken><refundAmount>${kwacha.toFixed(2)}</refundAmount>`);
    expect(res.body.message).toMatch(/automatically/);
  });

  it("a declined payment ends that attempt, and the shopper can pay again", async () => {
    const second = await placeOrder("ZM");
    dpo.verifyResult = "901";
    const back = await request(app).get(`/api/marketplace/dpo/return?TransactionToken=${second.token}`);
    expect(back.headers.location).toContain("?dpo=failed");
    expect((await orderRow(second.order.id)).payment_status).toBe("pending_payment");
    const again = await request(app).post(`/api/marketplace/orders/${second.order.id}/pay`).set(auth());
    expect(again.status).toBe(200);
    expect(again.body.data.redirect.url).toMatch(/payv2\.php\?ID=TOK-/);
    expect(lastRequest("createToken")).toContain("<PaymentCurrency>ZMW</PaymentCurrency>");
  });

  it("ignores junk and unknown tokens", async () => {
    const junk = await request(app).get(`/api/marketplace/dpo/return?TransactionToken=<script>&CompanyRef=x"y`);
    expect(junk.headers.location).toBe("https://www.ballylife.com/?dpo=pending");
    const unknown = await request(app).get(`/api/marketplace/dpo/return?TransactionToken=UNKNOWN-TOKEN-123`);
    expect(unknown.headers.location).toBe("https://www.ballylife.com/?dpo=pending");
  });
});

describe("DPO Pay: other African countries in US dollars", () => {
  it("a Kenyan order is charged in USD on the main account, opening on card", async () => {
    const ke = await placeOrder("KE");
    const usd = up(Number(ke.order.totalAmount) / USD_RATE);
    const create = lastRequest("createToken");
    expect(create).toContain("<CompanyToken>MAIN-COMPANY-TOKEN</CompanyToken>");
    expect(create).toContain(`<PaymentAmount>${usd.toFixed(2)}</PaymentAmount><PaymentCurrency>USD</PaymentCurrency>`);
    expect(create).toContain("<DefaultPayment>CC</DefaultPayment>");
    expect(create).toContain("<ServiceType>5525</ServiceType>");
    expect(await tx(ke.token)).toMatchObject({ charged_currency: "USD", processor_account: "main" });

    dpo.verifyResult = "000"; dpo.verifyAmount = usd.toFixed(2); dpo.verifyCurrency = "USD";
    const res = await request(app).get(`/api/marketplace/dpo/return?TransactionToken=${ke.token}`);
    expect(res.headers.location).toContain("?dpo=paid");
    expect(lastRequest("verifyToken")).toContain("<CompanyToken>MAIN-COMPANY-TOKEN</CompanyToken>");
  });

  it("South African addresses don't use DPO", async () => {
    const za = await placeOrder("ZA");
    const { rows } = await pool.query(`SELECT processor FROM mkt_pay_transactions WHERE order_id = $1`, [za.order.id]);
    expect(rows[0].processor).not.toBe("dpo");
  });
});
