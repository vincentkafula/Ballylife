import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import express, { type Express } from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { createTestDb } from "../test/testDb";
import { registerAndVerifyCustomer } from "../test/authHelpers";

process.env.PAYFAST_MERCHANT_ID = "10000100";
process.env.PAYFAST_MERCHANT_KEY = "46f0cd694581a";
process.env.MARKETPLACE_PUBLIC_URL = "https://shop.example";
process.env.MARKETPLACE_API_PUBLIC_URL = "https://api.example";

const { pool } = createTestDb();
vi.mock("../db/pool", () => ({ pool, hasDb: true }));

let app: Express;
let subs: typeof import("./subscriptions");
let prog: typeof import("./programmes");
let token: string;
let userId: string;
let adminToken: string;
let productId: string;
let dealProductId: string;
let fetchMock: ReturnType<typeof vi.fn<any[], Promise<unknown>>>;

const DAY = 86400_000;
const q = (sql: string, params: unknown[] = []) => pool.query(sql, params);
const sub = async () => (await q(`SELECT * FROM mkt_subscriptions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`, [userId])).rows[0];
const auth = (r: request.Test) => r.set("Authorization", `Bearer ${token}`);

beforeAll(async () => {
  subs = await import("./subscriptions");
  prog = await import("./programmes");
  const authRouter = (await import("../routes/authRouter")).default;
  const marketplaceRouter = (await import("../routes/marketplaceRouter")).default;
  const programmesRouter = (await import("../routes/programmesRouter")).default;
  app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true, verify: (req, _res, buf) => { (req as any).rawBody = buf.toString("utf8"); } }));
  app.use("/api/auth", authRouter);
  app.use("/api/marketplace", marketplaceRouter);
  app.use("/api/marketplace", programmesRouter);

  await q(`INSERT INTO mkt_tax_rates (country, vat_rate_pct, default_duty_rate_pct) VALUES ('ZA', 15, 20)`);
  await q(`INSERT INTO mkt_categories (id, name, slug, icon) VALUES ('cat-01','Electronics','electronics','📱')`);
  await q(`INSERT INTO mkt_sellers (id, store_name, store_slug, status) VALUES ('sel-ballylife','Ballylife','ballylife','active')`);
  const { rows: p1 } = await q(`INSERT INTO mkt_products (seller_id, category_id, name, slug, price, stock, status) VALUES ('sel-ballylife','cat-01','Lamp','lamp',1000,50,'active') RETURNING id`);
  const { rows: p2 } = await q(`INSERT INTO mkt_products (seller_id, category_id, name, slug, price, stock, status, is_flash_deal) VALUES ('sel-ballylife','cat-01','Deal','deal',200,50,'active',true) RETURNING id`);
  productId = p1[0].id; dealProductId = p2[0].id;
  await q(`UPDATE mkt_products SET delivery_profile = 'international'`); // CJ items: delivery included, so totals are goods + VAT

  ({ token, userId } = await registerAndVerifyCustomer(app, pool, { username: "member1", email: "member1@example.com" }));
  await request(app).post(`/api/marketplace/addresses/${userId}`).set("Authorization", `Bearer ${token}`).send({
    firstName: "M", lastName: "One", line1: "1 St", city: "Cape Town", postalCode: "8001", country: "ZA", phone: "0821234567",
  });
  await q(`INSERT INTO users (username, password_hash, role, name, email) VALUES ('progadmin', $1, 'marketplace_admin', 'A', 'progadmin@example.com')`, [await bcrypt.hash("AdminPass123", 4)]);
  adminToken = (await request(app).post("/api/auth/login").send({ username: "progadmin", password: "AdminPass123" })).body.data.token;
});

beforeEach(() => {
  fetchMock = vi.fn(async (): Promise<unknown> => ({ ok: true, status: 200, text: async () => "VALID", json: async () => ({}) }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); });

async function cartWith(pid: string, qty = 1) {
  await auth(request(app).delete(`/api/marketplace/cart/${userId}/item/${productId}`));
  await auth(request(app).delete(`/api/marketplace/cart/${userId}/item/${dealProductId}`));
  await q(`UPDATE mkt_products SET stock = 50`); // pg-mem evaluates checkout's "stock - $1" backwards; reset between orders
  return (await auth(request(app).post(`/api/marketplace/cart/${userId}/add`)).send({ productId: pid, quantity: qty })).body.data;
}

describe("plans", () => {
  it("publishes one source of truth for prices and rules", async () => {
    const res = await request(app).get("/api/marketplace/plans");
    expect(res.body.data.more.plans.map((p: any) => [p.id, p.monthlyPriceZar, p.orderDiscountPct])).toEqual([["standard", 49, 5], ["premium", 99, 10]]);
    expect(res.body.data.more.trialDays).toBe(30);
    expect(res.body.data.business.tiers).toHaveLength(8);
    expect(res.body.data.creditRewards.rewardPct).toBe(1);
  });
});

describe("BallylifeMORE", () => {
  it("first subscription: PayFast authorises the card for R0 and the first charge is due when the 30-day trial ends", async () => {
    const res = await auth(request(app).post("/api/marketplace/subscriptions")).send({ plan: "premium" });
    expect(res.status).toBe(201);
    expect(res.body.data.trial).toBe(true);
    const f = res.body.data.redirect.fields;
    expect(f).toMatchObject({ amount: "0.00", recurring_amount: "99.00", frequency: "3", cycles: "0", subscription_type: "1", item_name: "BallylifeMORE Premium" });
    const due = new Date(f.billing_date).getTime();
    // billing_date is a calendar date, so it lands 29-30 days out depending on the time of day.
    expect(Math.round((due - Date.now()) / DAY)).toBeGreaterThanOrEqual(29);
    expect(Math.round((due - Date.now()) / DAY)).toBeLessThanOrEqual(30);
    expect(f.m_payment_id).toMatch(/^sub_/);
    expect(f.signature).toMatch(/^[0-9a-f]{32}$/);
  });

  it("starts the trial when PayFast's (verified) notification arrives, via the normal webhook", async () => {
    const s = await sub();
    const fields: Record<string, string> = { m_payment_id: `sub_${s.id}`, pf_payment_id: "pf-0", payment_status: "COMPLETE", amount_gross: "0.00", token: "tok-123" };
    const str = Object.entries(fields).map(([k, v]) => `${k}=${encodeURIComponent(v).replace(/%20/g, "+")}`).join("&");
    const signature = crypto.createHash("md5").update(str).digest("hex");
    const res = await request(app).post("/api/marketplace/payfast/notify").type("form").send({ ...fields, signature });
    expect(res.status).toBe(200);

    const after = await sub();
    expect(after.status).toBe("trialing");
    expect(after.payfast_token).toBe("tok-123");
    const me = await auth(request(app).get("/api/marketplace/subscriptions/me"));
    expect(me.body.data.subscription).toMatchObject({ plan: "premium", status: "trialing", benefitsActive: true });
    expect(me.body.data.trialAvailable).toBe(false);
  });

  it("applies the member discount in the cart -- plus the deal extra on deal items for Premium", async () => {
    const lamp = await cartWith(productId);
    expect(lamp.memberDiscount).toBe(100);          // 10% of R1,000
    expect(lamp.memberPlan).toBe("premium");
    const deal = await cartWith(dealProductId);
    expect(deal.memberDiscount).toBe(30);           // (10% + 5%) of R200
  });

  it("records the membership on the order and uses the benefit (ending cooling-off refund eligibility)", async () => {
    await cartWith(productId);
    const res = await auth(request(app).post("/api/marketplace/orders")).send({ paymentMethod: "bank_transfer" });
    expect(res.body.data.memberPlan).toBe("premium");
    expect(res.body.data.memberDiscount).toBe(100);
    expect(res.body.data.prioritySupport).toBe(true);
    expect(res.body.data.totalAmount).toBe(1050);   // 1000 + 15% VAT - 100
    expect((await sub()).benefit_used).toBe(true);
  });

  it("downgrades from the next period; upgrading back cancels the pending downgrade", async () => {
    let r = await auth(request(app).post("/api/marketplace/subscriptions/change")).send({ plan: "standard" });
    expect(r.status).toBe(200);
    expect(r.body.data.subscription).toMatchObject({ plan: "premium", pendingPlan: "standard" });
    expect(fetchMock.mock.calls.some(([u, init]) => String(u).includes("/subscriptions/tok-123/update") && JSON.parse((init as any).body).amount === "4900")).toBe(true);
    r = await auth(request(app).post("/api/marketplace/subscriptions/change")).send({ plan: "premium" });
    expect(r.body.data.subscription).toMatchObject({ plan: "premium", pendingPlan: null });
  });

  it("renews on PayFast's recurring charge, and never double-counts a repeated notification", async () => {
    const s = await sub();
    const itn = { m_payment_id: `sub_${s.id}`, pf_payment_id: "pf-1", payment_status: "COMPLETE", amount_gross: "99.00", token: "tok-123" };
    await subs.handleSubscriptionItn(itn);
    await subs.handleSubscriptionItn(itn);
    const after = await sub();
    expect(after.status).toBe("active");
    const { rows } = await q(`SELECT * FROM mkt_subscription_payments WHERE subscription_id = $1`, [s.id]);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].amount)).toBe(99);
  });

  it("pauses benefits when a renewal is missed, and ends the subscription after 3 missed periods", async () => {
    const s = await sub();
    await q(`UPDATE mkt_subscriptions SET current_period_end = $2 WHERE id = $1`, [s.id, new Date(Date.now() - 5 * DAY)]);
    await subs.runSubscriptionMaintenance();
    expect((await sub()).status).toBe("past_due");
    expect(await subs.activeMembership(userId)).toBeNull();
    expect((await cartWith(productId)).memberDiscount).toBe(0);

    for (let i = 0; i < 2; i++) {
      await q(`UPDATE mkt_subscriptions SET current_period_end = $2 WHERE id = $1`, [s.id, new Date(Date.now() - 5 * DAY)]);
      await subs.runSubscriptionMaintenance();
    }
    const ended = (await q(`SELECT status FROM mkt_subscriptions WHERE id = $1`, [s.id])).rows[0];
    expect(ended.status).toBe("expired");
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/subscriptions/tok-123/cancel"))).toBe(true);
  });

  it("a returning subscriber pays the first month up front (no second trial), and cooling-off cancellation refunds it", async () => {
    const res = await auth(request(app).post("/api/marketplace/subscriptions")).send({ plan: "standard" });
    expect(res.body.data.trial).toBe(false);
    expect(res.body.data.redirect.fields.amount).toBe("49.00");
    const s = await sub();
    await subs.handleSubscriptionItn({ m_payment_id: `sub_${s.id}`, pf_payment_id: "pf-2", payment_status: "COMPLETE", amount_gross: "49.00", token: "tok-456" });
    expect((await sub()).status).toBe("active");

    const c = await auth(request(app).post("/api/marketplace/subscriptions/cancel"));
    expect(c.body.data.refund).toBe(true);
    expect((await q(`SELECT status FROM mkt_subscriptions WHERE id = $1`, [s.id])).rows[0].status).toBe("cancelled");
    expect((await q(`SELECT status FROM mkt_subscription_payments WHERE processor_ref = 'pf-2'`)).rows[0].status).toBe("refund_due");
  });

  it("outside cooling-off, cancelling keeps benefits until the paid period ends", async () => {
    await auth(request(app).post("/api/marketplace/subscriptions")).send({ plan: "standard" });
    const s = await sub();
    await subs.handleSubscriptionItn({ m_payment_id: `sub_${s.id}`, pf_payment_id: "pf-3", payment_status: "COMPLETE", amount_gross: "49.00", token: "tok-789" });
    await q(`UPDATE mkt_subscriptions SET commenced_at = $2 WHERE id = $1`, [s.id, new Date(Date.now() - 10 * DAY)]);
    const c = await auth(request(app).post("/api/marketplace/subscriptions/cancel"));
    expect(c.body.data.refund).toBe(false);
    expect(new Date(c.body.data.endsAt).getTime()).toBeGreaterThan(Date.now() + 20 * DAY);
    expect(await subs.activeMembership(userId)).not.toBeNull();   // still a member until then
  });

  it("admin sees subscribers, recurring revenue and refunds due", async () => {
    const res = await request(app).get("/api/marketplace/admin/subscriptions").set("Authorization", `Bearer ${adminToken}`);
    expect(res.body.meta.refundsDue).toBe(1);
    expect(res.body.meta.counts.expired).toBe(1);
  });
});

describe("returns window", () => {
  it("is 7 days normally and 30 days for orders placed as a Premium member", async () => {
    const { rows } = await q(`SELECT id FROM mkt_orders WHERE user_id = $1 AND member_plan = 'premium' LIMIT 1`, [userId]);
    await q(`UPDATE mkt_orders SET status = 'delivered', delivered_at = $2 WHERE id = $1`, [rows[0].id, new Date(Date.now() - 20 * DAY)]);
    expect((await auth(request(app).post(`/api/marketplace/orders/${rows[0].id}/request-return`))).status).toBe(200);

    await cartWith(productId);
    const o = await auth(request(app).post("/api/marketplace/orders")).send({ paymentMethod: "bank_transfer" });
    await q(`UPDATE mkt_orders SET status = 'delivered', delivered_at = $2, member_plan = NULL WHERE id = $1`, [o.body.data.id, new Date(Date.now() - 20 * DAY)]);
    const r = await auth(request(app).post(`/api/marketplace/orders/${o.body.data.id}/request-return`));
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/within 7 days/);
  });
});

describe("Ballylife for Business and store credit", () => {
  beforeAll(async () => { await q(`UPDATE mkt_subscriptions SET status = 'cancelled', cancel_at = now()`); }); // no member discount muddying these totals

  it("validates applications and lets an admin approve them", async () => {
    const bad = await auth(request(app).post("/api/marketplace/business/apply")).send({ companyName: "Acme", vatNumber: "123" });
    expect(bad.status).toBe(400);
    const ok = await auth(request(app).post("/api/marketplace/business/apply")).send({ companyName: "Acme (Pty) Ltd", registrationNumber: "2019/123456/07" });
    expect(ok.status).toBe(201);
    const list = await request(app).get("/api/marketplace/admin/business-accounts?status=pending").set("Authorization", `Bearer ${adminToken}`);
    const app1 = list.body.data.find((a: any) => a.companyName === "Acme (Pty) Ltd");
    const d = await request(app).patch(`/api/marketplace/admin/business-accounts/${app1.id}`).set("Authorization", `Bearer ${adminToken}`).send({ decision: "approve" });
    expect(d.body.data.status).toBe("approved");
  });

  it("credits last month's rebate at the tier for the month's net spend -- once", async () => {
    await q(`UPDATE mkt_business_accounts SET decided_at = $1`, [new Date(Date.UTC(2026, 6, 1))]);
    // August 2026: R12,000 of paid orders -> the 1% tier.
    await q(`INSERT INTO mkt_orders (order_number, user_id, items, subtotal, total_amount, status, payment_status, placed_at)
             VALUES ('B-1', $1, '[]', 12000, 13800, 'delivered', 'payment_confirmed', $2),
                    ('B-2', $1, '[]', 5000, 5750, 'cancelled', 'payment_confirmed', $2)`, [userId, new Date(Date.UTC(2026, 7, 15))]);
    const septFirst = new Date(Date.UTC(2026, 8, 1, 1));
    expect(await prog.runBusinessRebates(septFirst)).toBe(1);
    expect(await prog.runBusinessRebates(septFirst)).toBe(0);
    const { rows } = await q(`SELECT amount FROM mkt_store_credit_ledger WHERE source = 'business_rebate'`);
    expect(Number(rows[0].amount)).toBe(120);
  });

  it("store credit pays part of an order, leaving the rest for the card", async () => {
    await cartWith(dealProductId); // R200 + 15% VAT = R230, no membership now
    const res = await auth(request(app).post("/api/marketplace/orders")).send({ paymentMethod: "bank_transfer", useStoreCredit: true });
    expect(res.body.data.storeCreditApplied).toBe(120);    // the whole R120 balance
    expect(res.body.data.totalAmount).toBe(110);
    expect((await auth(request(app).get("/api/marketplace/store-credit/me"))).body.data.balance).toBe(0);
  });

  it("store credit can pay an order in full (confirmed without a card), and comes back if it's cancelled", async () => {
    await prog.addLedgerEntry(pool, { userId, amount: 500, source: "business_rebate", reference: "test-topup", expiresAt: new Date(Date.now() + 365 * DAY) });
    await cartWith(dealProductId);
    const res = await auth(request(app).post("/api/marketplace/orders")).send({ paymentMethod: "card", useStoreCredit: true });
    expect(res.status).toBe(201);
    expect(res.body.meta.paidWithStoreCredit).toBe(true);
    expect(res.body.data).toMatchObject({ status: "confirmed", totalAmount: 0, storeCreditApplied: 230 });
    expect(await prog.storeCreditBalance(userId)).toBe(270);

    const c = await auth(request(app).post(`/api/marketplace/orders/${res.body.data.id}/cancel`));
    expect(c.status).toBe(200);
    expect(await prog.storeCreditBalance(userId)).toBe(500);
  });
});

describe("Ballylife.credit Rewards", () => {
  it("accrues 1% once the order has been delivered 30 days, spendable from the next quarter", async () => {
    await q(`INSERT INTO mkt_credit_providers (id, name, provider_key, status) VALUES ('cp-1','PayFlex','payflex','active')`).catch(() => undefined);
    await q(`INSERT INTO mkt_orders (order_number, user_id, items, subtotal, total_amount, status, payment_status, credit_provider_id, credit_decision, delivered_at)
             VALUES ('C-1', $1, '[]', 1000, 1150, 'delivered', 'payment_confirmed', 'cp-1', 'approved', $2)`, [userId, new Date(Date.UTC(2026, 6, 20))]);
    expect(await prog.runCreditRewards(new Date(Date.UTC(2026, 7, 10)))).toBe(0);   // only 21 days after delivery
    expect(await prog.runCreditRewards(new Date(Date.UTC(2026, 7, 25)))).toBe(1);
    const { rows } = await q(`SELECT amount, available_at FROM mkt_store_credit_ledger WHERE source = 'credit_reward'`);
    expect(Number(rows[0].amount)).toBe(11.5);
    expect(new Date(rows[0].available_at).toISOString().slice(0, 10)).toBe("2026-10-01"); // Q4 payout
  });
});
