import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import express, { type Express } from "express";
import bcrypt from "bcryptjs";
import { createTestDb } from "../test/testDb";
import { registerAndVerifyCustomer } from "../test/authHelpers";

process.env.CJ_EMAIL = "test@example.com";
process.env.CJ_API_KEY = "test-cj-api-key";
process.env.CJ_MIN_REQUEST_INTERVAL_MS = "0";

const { pool } = createTestDb();
vi.mock("../db/pool", () => ({ pool, hasDb: true }));

let app: Express;
let adminToken: string;
let sellerToken: string;
let sellerId: string;
let custToken: string;
let custId: string;
let productId: string;
let fulfillment: typeof import("./cjFulfillment");
let variantIds: { black: string; red: string };

const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => ({ code: 200, result: true, message: "Success", data }) });
const cjError = (status: number, message: string) => ({ ok: false, status, json: async () => ({ code: status, result: false, message }) });

// Per-test CJ behaviour, routed by endpoint.
let cj: {
  freight: () => unknown; create: (body: any) => unknown; detail: (id: string) => unknown;
};
let fetchMock: ReturnType<typeof vi.fn<any[], Promise<unknown>>>;
const calls = (path: string) => fetchMock.mock.calls.filter(([url]) => String(url).includes(path));

beforeAll(async () => {
  fulfillment = await import("./cjFulfillment");
  const authRouter = (await import("../routes/authRouter")).default;
  const marketplaceRouter = (await import("../routes/marketplaceRouter")).default;
  const cjRouter = (await import("../routes/cjDropshippingRouter")).default;
  app = express();
  app.use(express.json());
  app.use("/api/auth", authRouter);
  app.use("/api/marketplace", marketplaceRouter);
  app.use("/api/marketplace", cjRouter);

  await pool.query(`INSERT INTO mkt_tax_rates (country, vat_rate_pct, default_duty_rate_pct) VALUES ('ZA', 15, 20)`);
  await pool.query(`INSERT INTO mkt_categories (id, name, slug, icon) VALUES ('cat-01','Electronics','electronics','📱')`);
  await pool.query(`INSERT INTO mkt_warehouses (id, name, country, type) VALUES ('wh-origin-cn','Guangzhou Hub','CN','origin'), ('wh-dest-za','Cape Town Hub','ZA','destination')`);
  await pool.query(`INSERT INTO mkt_fx_rates (currency, rate_to_zar) VALUES ('USD', 18.5)`);

  const adminHash = await bcrypt.hash("AdminPass123", 10);
  await pool.query(`INSERT INTO users (username, password_hash, role, name, email) VALUES ('fuladmin','${adminHash}','marketplace_admin','Admin','fuladmin@example.com')`);
  adminToken = (await request(app).post("/api/auth/login").send({ username: "fuladmin", password: "AdminPass123" })).body.data.token;

  const sellerReg = await request(app).post("/api/marketplace/sellers/register").send({
    username: "fulseller", password: "SellerPass123", name: "Seller", email: "fulseller@example.com", storeName: "Gadget Store",
  });
  sellerToken = sellerReg.body.token;
  sellerId = sellerReg.body.seller.id;
  await pool.query(`UPDATE mkt_sellers SET status = 'active' WHERE id = $1`, [sellerId]);

  // A synced CJ catalog item with two options at different CJ prices.
  await pool.query(`INSERT INTO mkt_suppliers (id, name, country, platform, verified, status) VALUES ('sup-cjdropshipping','CJdropshipping','CN','CJdropshipping',true,'active')`);
  const { rows: sp } = await pool.query(
    `INSERT INTO mkt_supplier_products (supplier_id, category_id, name, description, cost_price, currency, retail_price, moq, images, origin_country, status, external_source, external_id, external_variants)
     VALUES ('sup-cjdropshipping','cat-01','Wireless Earbuds','Great sound.',10,'USD',185,1,'[]','CN','active','cjdropshipping','pid-1',$1) RETURNING id`,
    [JSON.stringify([{ vid: "vid-black", key: "Black", priceUsd: 10 }, { vid: "vid-red", key: "Red", priceUsd: 12 }])]
  );

  const imp = await request(app).post(`/api/marketplace/sellers/${sellerId}/import-listing`).set("Authorization", `Bearer ${sellerToken}`)
    .send({ supplierProductId: sp[0].id, retailPrice: 370, stock: 20 }); // 2x markup on R185
  productId = imp.body.data.id;
  await pool.query(`UPDATE mkt_products SET status = 'active' WHERE id = $1`, [productId]);
  const variants = imp.body.data.variants as { id: string; value: string }[];
  variantIds = { black: variants.find(v => v.value === "Black")!.id, red: variants.find(v => v.value === "Red")!.id };

  ({ token: custToken, userId: custId } = await registerAndVerifyCustomer(app, pool, { username: "fulcust", email: "fulcust@example.com" }));
  await request(app).post(`/api/marketplace/addresses/${custId}`).set("Authorization", `Bearer ${custToken}`).send({
    firstName: "Thandi", lastName: "Mokoena", line1: "12 Long St", city: "Cape Town", postalCode: "8001", country: "ZA", phone: "0821234567",
  });
});

beforeEach(() => {
  cj = {
    freight: () => ok([{ logisticName: "DHL Express", logisticPrice: 20 }, { logisticName: "CJPacket Ordinary", logisticPrice: 6 }]),
    create: (body: any) => ok({ orderId: `CJ-${body.orderNumber}`, orderNumber: body.orderNumber, orderStatus: "UNPAID", productAmount: 12, postageAmount: 6, orderAmount: 18 }),
    detail: () => cjError(400, "order not found"),
  };
  fetchMock = vi.fn(async (input: unknown, init?: any): Promise<unknown> => {
    const url = String(input);
    if (url.includes("getAccessToken")) return ok({ accessToken: "t", accessTokenExpiryDate: new Date(Date.now() + 864e5).toISOString(), refreshToken: "r", refreshTokenExpiryDate: new Date(Date.now() + 864e5).toISOString() });
    if (url.includes("/logistic/freightCalculate")) return cj.freight();
    if (url.includes("/shopping/order/createOrderV2")) return cj.create(JSON.parse(init.body));
    if (url.includes("/shopping/order/getOrderDetail")) return cj.detail(new URL(url).searchParams.get("orderId")!);
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); });

async function paidOrder(variantId: string | null): Promise<{ id: string; orderNumber: string }> {
  await request(app).delete(`/api/marketplace/cart/${custId}/item/${productId}`).set("Authorization", `Bearer ${custToken}`);
  // pg-mem evaluates checkout's `stock - $1` as `$1 - stock`; real Postgres doesn't. Reset between orders.
  await pool.query(`UPDATE mkt_products SET stock = 20 WHERE id = $1`, [productId]);
  const add = await request(app).post(`/api/marketplace/cart/${custId}/add`).set("Authorization", `Bearer ${custToken}`).send({ productId, variantId, quantity: 2 });
  if (add.status !== 200) throw new Error("cart add failed: " + JSON.stringify(add.body));
  const res = await request(app).post("/api/marketplace/orders").set("Authorization", `Bearer ${custToken}`).send({ paymentMethod: "bank_transfer" });
  const order = res.body.data;
  if (!order) throw new Error("checkout failed: " + JSON.stringify(res.body));
  // What the PayFast ITN / reconciliation paths do once money has actually arrived.
  await pool.query(`UPDATE mkt_orders SET status = 'confirmed', payment_status = 'payment_confirmed', confirmed_at = now() WHERE id = $1`, [order.id]);
  return { id: order.id, orderNumber: order.orderNumber };
}

const fulfillmentFor = async (orderId: string) => (await pool.query(`SELECT * FROM cj_fulfillments WHERE order_id = $1`, [orderId])).rows[0];

describe("Seller import + customer choice of a supplier option", () => {
  it("turns supplier options into listing variants with opaque ids and a markup-scaled surcharge", async () => {
    const res = await request(app).get(`/api/marketplace/products/${productId}`);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain("vid-"); // CJ variant ids never leave the server
    expect(variantIds.black).toMatch(/^v_[0-9a-f]{16}$/);
    const red = (res.body.data.product ?? res.body.data).variants.find((v: { value: string }) => v.value === "Red");
    expect(red.additionalPrice).toBe(74); // (12 - 10) USD * 18.5 * 2x seller markup
  });

  it("won't add a multi-option supplier product to the cart without a choice", async () => {
    const res = await request(app).post(`/api/marketplace/cart/${custId}/add`).set("Authorization", `Bearer ${custToken}`).send({ productId, quantity: 1 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VARIANT_REQUIRED");
  });

  it("charges the chosen option's price", async () => {
    const res = await request(app).post(`/api/marketplace/cart/${custId}/add`).set("Authorization", `Bearer ${custToken}`).send({ productId, variantId: variantIds.red, quantity: 1 });
    expect(res.status).toBe(200);
    expect(res.body.data.items[0].unitPrice).toBe(444);
    await request(app).delete(`/api/marketplace/cart/${custId}/item/${productId}`).set("Authorization", `Bearer ${custToken}`);
  });
});

describe("Placing the paid order with CJ", () => {
  let order: { id: string; orderNumber: string };

  it("does nothing for an order that hasn't been paid", async () => {
    await request(app).post(`/api/marketplace/cart/${custId}/add`).set("Authorization", `Bearer ${custToken}`).send({ productId, variantId: variantIds.black, quantity: 1 });
    const res = await request(app).post("/api/marketplace/orders").set("Authorization", `Bearer ${custToken}`).send({ paymentMethod: "bank_transfer" });
    await fulfillment.runCjFulfillmentCycle();
    expect(await fulfillmentFor(res.body.data.id)).toBeUndefined();
    expect(calls("createOrderV2").length).toBe(0);
  });

  it("charges no delivery fee and promises 10-20 business days, even for a cart saved before the item was flagged", async () => {
    const product = await request(app).get(`/api/marketplace/products/${productId}`);
    expect((product.body.data.product ?? product.body.data)).toMatchObject({ shippingIncluded: true, deliveryDays: { min: 10, max: 20 } });

    await pool.query(`UPDATE mkt_products SET stock = 20 WHERE id = $1`, [productId]); // pg-mem stock quirk, see paidOrder()
    await request(app).delete(`/api/marketplace/cart/${custId}/item/${productId}`).set("Authorization", `Bearer ${custToken}`);
    await request(app).post(`/api/marketplace/cart/${custId}/add`).set("Authorization", `Bearer ${custToken}`).send({ productId, variantId: variantIds.black, quantity: 1 });
    // Simulate an old cart: item stored without the flag and charged R99.
    await pool.query(`UPDATE mkt_carts SET items = $1, shipping = 99 WHERE user_id = $2`,
      [JSON.stringify((await pool.query(`SELECT items FROM mkt_carts WHERE user_id = $1`, [custId])).rows[0].items.map((i: any) => ({ ...i, shippingIncluded: undefined }))), custId]);
    await pool.query(`UPDATE mkt_products SET stock = 20 WHERE id = $1`, [productId]);

    const res = await request(app).post("/api/marketplace/orders").set("Authorization", `Bearer ${custToken}`).send({ paymentMethod: "bank_transfer" });
    const { rows } = await pool.query(`SELECT shipping_cost, placed_at, estimated_delivery FROM mkt_orders WHERE id = $1`, [res.body.data.id]);
    expect(Number(rows[0].shipping_cost)).toBe(0);
    const days = (new Date(rows[0].estimated_delivery).getTime() - new Date(rows[0].placed_at).getTime()) / 86400_000;
    expect(days).toBeGreaterThanOrEqual(26); // 20 business days = 26-28 calendar days
    expect(days).toBeLessThanOrEqual(28.1);
    await pool.query(`UPDATE mkt_orders SET status = 'cancelled' WHERE id = $1`, [res.body.data.id]); // keep it out of the fulfilment tests below
  });

  it("places it with the customer's chosen variant, the cheapest route, and our order number -- no customer email", async () => {
    order = await paidOrder(variantIds.red);
    await fulfillment.runCjFulfillmentCycle();

    const create = calls("createOrderV2");
    expect(create.length).toBe(1);
    const body = JSON.parse((create[0][1] as any).body);
    expect(body.orderNumber).toBe(order.orderNumber);
    expect(body.products).toEqual([{ vid: "vid-red", quantity: 2 }]);
    expect(body.logisticName).toBe("CJPacket Ordinary");
    expect(body.shippingCountryCode).toBe("ZA");
    expect(body.shippingCountry).toBe("South Africa");
    expect(body.shippingProvince).toBe("Cape Town"); // no province on file -> city
    expect(body.payType).toBe(3); // CJ_AUTO_PAY not set: create only, pay in CJ
    expect(body).not.toHaveProperty("email");
    expect(body).not.toHaveProperty("remark");

    const f = await fulfillmentFor(order.id);
    expect(f.status).toBe("placed");
    expect(f.cj_order_id).toBe(`CJ-${order.orderNumber}`);
    expect(Number(f.cj_order_amount)).toBe(18);

    const { rows } = await pool.query(`SELECT status FROM mkt_orders WHERE id = $1`, [order.id]);
    expect(rows[0].status).toBe("processing"); // off local couriers' claimable list
  });

  it("never places the same order twice", async () => {
    await fulfillment.runCjFulfillmentCycle();
    expect(calls("createOrderV2").length).toBe(0);
  });

  it("copies tracking back under our brand when CJ ships, and never exposes CJ data to the customer", async () => {
    cj.detail = () => ok({ orderId: `CJ-${order.orderNumber}`, orderStatus: "SHIPPED", trackNumber: "YT123456789", logisticName: "CJPacket Ordinary", trackingUrl: "https://t.example/YT1" });
    await pool.query(`UPDATE cj_fulfillments SET last_synced_at = NULL WHERE order_id = $1`, [order.id]);
    await fulfillment.runCjFulfillmentCycle();

    const { rows } = await pool.query(`SELECT * FROM mkt_orders WHERE id = $1`, [order.id]);
    expect(rows[0].status).toBe("shipped");
    expect(rows[0].tracking_number).toBe("YT123456789");
    expect(rows[0].carrier).toBe("Ballylife Express");
    expect((await fulfillmentFor(order.id)).status).toBe("shipped");

    const res = await request(app).get(`/api/marketplace/orders/${order.id}`).set("Authorization", `Bearer ${custToken}`);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toMatch(/cj|vid-/i);
  });

  it("marks it delivered when CJ does", async () => {
    cj.detail = () => ok({ orderId: `CJ-${order.orderNumber}`, orderStatus: "DELIVERED", trackNumber: "YT123456789" });
    await pool.query(`UPDATE cj_fulfillments SET last_synced_at = NULL WHERE order_id = $1`, [order.id]);
    await fulfillment.runCjFulfillmentCycle();
    const { rows } = await pool.query(`SELECT status, shipping_status FROM mkt_orders WHERE id = $1`, [order.id]);
    expect(rows[0]).toMatchObject({ status: "delivered", shipping_status: "delivered" });
    expect((await fulfillmentFor(order.id)).status).toBe("delivered");
  });

  it("shows the admin CJ cost vs what the customer paid", async () => {
    const res = await request(app).get("/api/marketplace/admin/cj/fulfillments").set("Authorization", `Bearer ${adminToken}`);
    const row = res.body.data.find((r: { orderId: string }) => r.orderId === order.id);
    expect(row.cjCostUsd).toBe(18);
    expect(row.cjCostZar).toBe(333);
    expect(row.grossMarginZar).toBeCloseTo(row.orderTotal - 333, 2);
  });

  it("is admin-only", async () => {
    const res = await request(app).get("/api/marketplace/admin/cj/fulfillments").set("Authorization", `Bearer ${sellerToken}`);
    expect(res.status).toBe(403);
  });
});

describe("When placement fails", () => {
  it("retries a transient failure with backoff, then adopts the CJ order if the first attempt actually got through", async () => {
    const order = await paidOrder(variantIds.black);
    cj.create = () => cjError(500, "upstream timeout");
    await fulfillment.runCjFulfillmentCycle();

    let f = await fulfillmentFor(order.id);
    expect(f.status).toBe("queued");
    expect(f.attempts).toBe(1);
    expect(new Date(f.next_attempt_at).getTime()).toBeGreaterThan(Date.now());
    expect(f.last_error).toMatch(/upstream timeout/);

    // CJ had in fact created it; the retry must find it rather than order again.
    cj.detail = (id: string) => (id === order.orderNumber ? ok({ orderId: "CJ-ADOPTED", orderStatus: "UNPAID", orderAmount: 14 }) : cjError(400, "not found"));
    await pool.query(`UPDATE cj_fulfillments SET next_attempt_at = now() WHERE id = $1`, [f.id]);
    fetchMock.mockClear();
    await fulfillment.runCjFulfillmentCycle();

    f = await fulfillmentFor(order.id);
    expect(f.status).toBe("placed");
    expect(f.cj_order_id).toBe("CJ-ADOPTED");
    expect(calls("createOrderV2").length).toBe(0);
  });

  it("sends problems a retry can't fix straight to needs_attention, and a manual retry works once fixed", async () => {
    const order = await paidOrder(variantIds.black);
    cj.freight = () => ok([]); // no route to the destination
    await fulfillment.runCjFulfillmentCycle();

    const f = await fulfillmentFor(order.id);
    expect(f.status).toBe("needs_attention");
    expect(f.last_error).toMatch(/no shipping route/i);
    expect(f.alerted_at).not.toBeNull();
    expect(calls("createOrderV2").length).toBe(0);

    cj.freight = () => ok([{ logisticName: "DHL Express", logisticPrice: 20 }]);
    const res = await request(app).post(`/api/marketplace/admin/cj/fulfillments/${f.id}/retry`).set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("placed");
    expect(res.body.data.logisticName).toBe("DHL Express");
  });

  it("gives up after the last backoff step and marks it failed", async () => {
    const order = await paidOrder(variantIds.black);
    cj.create = () => cjError(500, "still down");
    await fulfillment.runCjFulfillmentCycle();
    const f = await fulfillmentFor(order.id);
    await pool.query(`UPDATE cj_fulfillments SET attempts = $2, next_attempt_at = now() WHERE id = $1`, [f.id, fulfillment.MAX_ATTEMPTS - 1]);
    await fulfillment.runCjFulfillmentCycle();
    const after = await fulfillmentFor(order.id);
    expect(after.status).toBe("failed");
    expect(after.alerted_at).not.toBeNull();
  });

  it("doesn't order from CJ if the customer cancelled before placement", async () => {
    const order = await paidOrder(variantIds.black);
    await pool.query(`UPDATE mkt_orders SET status = 'cancelled' WHERE id = $1`, [order.id]);
    await fulfillment.runCjFulfillmentCycle();
    expect((await fulfillmentFor(order.id)).status).toBe("cancelled");
    expect(calls("createOrderV2").length).toBe(0);
  });
});

describe("whiteLabelCarrier", () => {
  it("hides supplier-branded carrier names but keeps real carriers", () => {
    expect(fulfillment.whiteLabelCarrier("CJPacket Ordinary")).toBe("Ballylife Express");
    expect(fulfillment.whiteLabelCarrier("DHL Express")).toBe("DHL Express");
    expect(fulfillment.whiteLabelCarrier(null)).toBe("Ballylife Express");
  });
});
