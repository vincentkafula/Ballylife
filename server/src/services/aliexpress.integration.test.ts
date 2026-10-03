import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import express, { type Express } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { createTestDb } from "../test/testDb";

process.env.ALIEXPRESS_APP_KEY = "548928";
process.env.ALIEXPRESS_APP_SECRET = "test-ae-secret";
process.env.MARKETPLACE_PUBLIC_URL = "https://www.ballylife.test";

const { pool } = createTestDb();
vi.mock("../db/pool", () => ({ pool, hasDb: true }));

let app: Express;
let adminToken: string;
let client: typeof import("./aliexpressClient");
let catalog: typeof import("./aliexpressCatalog");
let fulfil: typeof import("./aliexpressFulfillment");
let fetchMock: ReturnType<typeof vi.fn<any[], Promise<unknown>>>;
const calls: { url: string; params: Record<string, string> }[] = [];

// What the fake AliExpress returns.
let orderCreate: unknown = { aliexpress_ds_order_create_response: { result: { is_success: true, order_list: { number: [8123456789] } } } };
let searchResponse: unknown = { aliexpress_ds_text_search_response: { data: { products: { selection_search_product: [
  { itemId: "1005000000000001", title: "Kids Building Blocks Set", targetSalePrice: "9.99", orders: "1200", itemMainPic: "https://ae01.alicdn.com/kf/x.jpg" },
  { itemId: "1005000000000002", title: "Plush Bear Toy", targetSalePrice: "6.50", orders: "10", itemMainPic: "https://ae01.alicdn.com/kf/y.jpg" },
] } } } };
let orderGet: unknown = { aliexpress_trade_ds_order_get_response: { result: { order_status: "WAIT_SELLER_SEND_GOODS" } } };

const PRODUCT = {
  aliexpress_ds_product_get_response: {
    rsp_code: "200",
    result: {
      ae_item_base_info_dto: { subject: "Wireless Bluetooth Earbuds TWS Hot Sale 2026", detail: "<p>Great sound.</p><p>首单减8元</p>", product_status_type: "onSelling", avg_evaluation_rating: "4.8", evaluation_count: "320", sales_count: "5000" },
      ae_multimedia_info_dto: { image_urls: "https://ae01.alicdn.com/kf/a.jpg;https://ae01.alicdn.com/kf/b.jpg" },
      ae_item_properties: { ae_item_property: [{ attr_name: "Battery", attr_value: "400mAh" }] },
      ae_item_sku_info_dtos: { ae_item_sku_info_d_t_o: [
        { sku_id: "12000001", sku_attr: "14:193", offer_sale_price: "10.00", sku_available_stock: 500,
          ae_sku_property_dtos: { ae_sku_property_d_t_o: [{ sku_property_name: "Color", sku_property_value: "black", property_value_definition_name: "Black" }] } },
        { sku_id: "12000002", sku_attr: "14:29", offer_sale_price: "12.00", sku_available_stock: 80,
          ae_sku_property_dtos: { ae_sku_property_d_t_o: [{ sku_property_name: "Color", sku_property_value: "white", property_value_definition_name: "白色" }] } },
      ] },
      ae_store_info: { store_name: "Audio Store" },
    },
  },
};
const FREIGHT = { aliexpress_logistics_buyer_freight_calculate_response: { result: { success: true, aeop_freight_calculate_result_for_buyer_d_t_o_list: {
  aeop_freight_calculate_result_for_buyer_dto: [
    { service_name: "CAINIAO_STANDARD", freight: { amount: "3.50", currency_code: "USD" }, estimated_delivery_time: "15-25" },
    { service_name: "AE_PREMIUM", freight: { amount: "9.00", currency_code: "USD" }, estimated_delivery_time: "7-12" },
  ] } } } };

beforeAll(async () => {
  client = await import("./aliexpressClient");
  catalog = await import("./aliexpressCatalog");
  fulfil = await import("./aliexpressFulfillment");
  const authRouter = (await import("../routes/authRouter")).default;
  const marketplaceRouter = (await import("../routes/marketplaceRouter")).default;
  const aeRouter = (await import("../routes/aliexpressRouter")).default;
  app = express();
  app.use(express.json());
  app.use("/api/auth", authRouter);
  app.use("/api/marketplace", marketplaceRouter);
  app.use("/api/marketplace", aeRouter);

  await pool.query(`INSERT INTO mkt_categories (id, name, slug, icon) VALUES ('cat-01','Electronics','electronics','📱'), ('cat-03','Home & Garden','home-garden','🏠')`);
  await pool.query(`INSERT INTO mkt_fx_rates (currency, rate_to_zar) VALUES ('USD', 18)`);
  await pool.query(`INSERT INTO mkt_warehouses (id, name, country, type) VALUES ('wh-origin-cn','Guangzhou Hub','CN','origin'), ('wh-dest-za','Cape Town Hub','ZA','destination')`);
  const hash = await bcrypt.hash("AdminPass123", 5);
  await pool.query(`INSERT INTO users (username, password_hash, role, name, email) VALUES ('aeadmin','${hash}','marketplace_admin','Admin','ae@example.com')`);
  adminToken = (await request(app).post("/api/auth/login").send({ username: "aeadmin", password: "AdminPass123" })).body.data.token;
});

beforeEach(() => {
  fetchMock = vi.fn(async (input: unknown, init?: RequestInit): Promise<unknown> => {
    const url = String(input);
    const params = Object.fromEntries(new URLSearchParams(String(init?.body ?? "")));
    calls.push({ url, params });
    const json = (d: unknown) => ({ ok: true, status: 200, text: async () => JSON.stringify(d) });
    if (url.endsWith("/rest/auth/token/create")) return json({ access_token: "AT-1", refresh_token: "RT-1", expire_time: Date.now() + 30 * 86400_000, refresh_token_valid_time: Date.now() + 60 * 86400_000, account: "buyer@ballylife" });
    if (url.endsWith("/rest/auth/token/refresh")) return json({ access_token: "AT-2", refresh_token: "RT-2", expire_time: Date.now() + 30 * 86400_000 });
    if (url.endsWith("/sync")) {
      if (params.method === "aliexpress.ds.product.get") return json(PRODUCT);
      if (params.method === "aliexpress.logistics.buyer.freight.calculate") return json(FREIGHT);
      if (params.method === "aliexpress.ds.order.create") return json(orderCreate);
      if (params.method === "aliexpress.trade.ds.order.get") return json(orderGet);
      if (params.method === "aliexpress.ds.text.search") return json(searchResponse);
      if (params.method === "aliexpress.ds.feedname.get") return json({ aliexpress_ds_feedname_get_response: { resp_result: { result: { promos: { promo: [{ promo_name: "DS_TopSellers" }] } } } } });
      if (params.method === "aliexpress.ds.recommend.feed.get") return json({ aliexpress_ds_recommend_feed_get_response: { result: { products: { traffic_product_d_t_o: [{ product_id: 3005000000000003, product_title: "LED Desk Lamp", target_sale_price: "8.00", lastest_volume: 900, product_main_image_url: "https://ae01.alicdn.com/kf/l.jpg" }] } } } });
    }
    throw new Error(`unexpected fetch ${url} ${params.method ?? ""}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); });

const lastCall = (method: string) => [...calls].reverse().find(c => c.params.method === method);

describe("signing", () => {
  it("signs the sorted parameters with HMAC-SHA256, uppercase hex (API path first for /rest)", () => {
    const params = { b: "2", a: "1", method: "x.y" };
    const expected = crypto.createHmac("sha256", "s").update("a1b2methodx.y").digest("hex").toUpperCase();
    expect(client.signParams(params, "", "s")).toBe(expected);
    expect(client.signParams({ code: "c" }, "/auth/token/create", "s")).toBe(crypto.createHmac("sha256", "s").update("/auth/token/createcodec").digest("hex").toUpperCase());
  });
});

describe("Connecting the AliExpress account", () => {
  let state: string;

  it("isn't connected yet, and the connect link carries the app key, callback and a one-time state", async () => {
    const status = await request(app).get("/api/marketplace/admin/aliexpress/status").set("Authorization", `Bearer ${adminToken}`);
    expect(status.body.data).toMatchObject({ configured: true, connected: false });
    const res = await request(app).post("/api/marketplace/admin/aliexpress/connect").set("Authorization", `Bearer ${adminToken}`);
    const url = new URL(res.body.data.url);
    expect(url.origin + url.pathname).toBe("https://api-sg.aliexpress.com/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("548928");
    expect(url.searchParams.get("redirect_uri")).toBe("https://ballylife-backend-production.up.railway.app/api/marketplace/aliexpress/oauth/callback");
    state = url.searchParams.get("state")!;
    expect(state).toHaveLength(48);
  });

  it("is admin-only", async () => {
    expect((await request(app).post("/api/marketplace/admin/aliexpress/connect")).status).toBe(401);
  });

  it("rejects a callback with a state it didn't issue", async () => {
    const res = await request(app).get("/api/marketplace/aliexpress/oauth/callback?code=abc&state=forged");
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^https:\/\/www\.ballylife\.test\/\?aliexpress=error/);
  });

  it("exchanges the code, stores the tokens encrypted, and the state can't be reused", async () => {
    const res = await request(app).get(`/api/marketplace/aliexpress/oauth/callback?code=CODE123&state=${state}`);
    expect(res.headers.location).toBe("https://www.ballylife.test/?aliexpress=connected");
    const tokenCall = calls.find(c => c.url.endsWith("/auth/token/create"))!;
    expect(tokenCall.params.code).toBe("CODE123");
    expect(tokenCall.params.sign).toBe(client.signParams(Object.fromEntries(Object.entries(tokenCall.params).filter(([k]) => k !== "sign")), "/auth/token/create"));
    const { rows } = await pool.query(`SELECT * FROM aliexpress_auth`);
    expect(rows[0].access_token_enc).not.toContain("AT-1");
    expect(client.decrypt(rows[0].access_token_enc)).toBe("AT-1");
    const again = await request(app).get(`/api/marketplace/aliexpress/oauth/callback?code=CODE123&state=${state}`);
    expect(again.headers.location).toMatch(/aliexpress=error/);
  });

  it("refreshes the session automatically when it's about to expire", async () => {
    await pool.query(`UPDATE aliexpress_auth SET expires_at = $1`, [new Date(Date.now() + 3600_000)]);
    expect(await client.getSession()).toBe("AT-2");
  });
});

describe("Importing products", () => {
  let listingId: string;

  it("imports by AliExpress link: English, cheapest shipping to SA, sliding markup, options", async () => {
    const res = await request(app).post("/api/marketplace/admin/aliexpress/import").set("Authorization", `Bearer ${adminToken}`)
      .send({ items: ["https://www.aliexpress.com/item/1005006349486340.html?spm=abc"] });
    expect(res.status).toBe(200);
    const r = res.body.data[0];
    expect(r).toMatchObject({ productId: "1005006349486340", listed: true });
    // (10.00 goods + 3.50 cheapest shipping) x R18 = R243 landed; flat +25% = 303.75 -> 304
    expect(r.priceZar).toBe(304);
    listingId = r.storeProductId;

    const get = lastCall("aliexpress.ds.product.get")!;
    expect(get.params).toMatchObject({ product_id: "1005006349486340", ship_to_country: "ZA", target_currency: "USD", session: "AT-2", app_key: "548928", sign_method: "sha256" });

    const { rows } = await pool.query(`SELECT * FROM mkt_products WHERE id = $1`, [listingId]);
    const p = rows[0];
    expect(p).toMatchObject({ status: "active", delivery_profile: "international", seller_id: "sel-ballylife" });
    expect(p.name).toBe("Wireless Bluetooth Earbuds TWS");        // marketplace jargon stripped
    expect(p.description).toContain("Great sound.");
    expect(p.description).not.toMatch(/[一-鿿]/);           // Chinese promo line dropped
    expect(p.variants.map((v: { value: string }) => v.value)).toEqual(["Black", "White"]); // 白色 translated
    expect(p.variants[1].additionalPrice).toBeGreaterThan(0);
    const { rows: sp } = await pool.query(`SELECT external_source, est_logistic_name, est_shipping_usd FROM mkt_supplier_products WHERE external_id = '1005006349486340'`);
    expect(sp[0]).toMatchObject({ external_source: "aliexpress", est_logistic_name: "CAINIAO_STANDARD" });
  });

  it("re-importing updates instead of duplicating", async () => {
    await request(app).post("/api/marketplace/admin/aliexpress/import").set("Authorization", `Bearer ${adminToken}`).send({ items: ["1005006349486340"] });
    const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM mkt_products WHERE supplier_product_id IS NOT NULL`);
    expect(rows[0].n).toBe(1);
  });

  it("survives the CJ-only catalogue rule", async () => {
    const { enforceCjOnlyCatalog } = await import("./cjCatalog");
    await enforceCjOnlyCatalog();
    const { rows } = await pool.query(`SELECT status FROM mkt_products WHERE id = $1`, [listingId]);
    expect(rows[0].status).toBe("active");
  });

  it("shows no AliExpress links or images to shoppers", async () => {
    const res = await request(app).get(`/api/marketplace/products/${listingId}`);
    expect(JSON.stringify(res.body)).not.toMatch(/aliexpress|alicdn/i);
  });

  describe("orders", () => {
    let orderId: string;

    it("places a paid order on AliExpress with the customer's option, address and the saved shipping line", async () => {
      const { rows: p } = await pool.query(`SELECT variants, supplier_product_id FROM mkt_products WHERE id = $1`, [listingId]);
      const white = p[0].variants[1];
      const { rows: o } = await pool.query(
        `INSERT INTO mkt_orders (order_number, user_id, items, total_amount, status, payment_status, shipping_address)
         VALUES ('VNK-ORD-AE1', 'u1', $1, 400, 'confirmed', 'payment_confirmed', $2) RETURNING id`,
        [JSON.stringify([{ productId: listingId, quantity: 2, variantId: white.id, variantLabel: white.value }]),
         JSON.stringify({ firstName: "Thandi", lastName: "Mokoena", line1: "12 Long St", city: "Cape Town", state: "Western Cape", postalCode: "8001", country: "ZA", phone: "082 123 4567" })]
      );
      orderId = o[0].id;
      await pool.query(
        `INSERT INTO mkt_supplier_orders (order_id, product_id, supplier_id, supplier_product_id, seller_id, quantity, cost_amount, origin_warehouse_id, destination_warehouse_id)
         VALUES ($1, $2, 'sup-aliexpress', $3, 'sel-ballylife', 2, 24, 'wh-origin-cn', 'wh-dest-za')`,
        [orderId, listingId, p[0].supplier_product_id]
      );
      await pool.query(
        `INSERT INTO mkt_order_line_settlements (order_id, product_id, seller_id, supplier_id, quantity, gross_amount, platform_fee_pct, platform_fee_amount,
           supplier_cost_amount, supplier_cost_currency, supplier_cost_amount_zar, seller_payout_amount, supplier_payout_status, seller_payout_status)
         VALUES ($1, $2, 'sel-ballylife', 'sup-aliexpress', 2, 400, 8, 32, 24, 'USD', 444, -76, 'pending', 'pending')`,
        [orderId, listingId]
      );

      await fulfil.runAliExpressCycle();
      const call = lastCall("aliexpress.ds.order.create")!;
      const req = JSON.parse(call.params.param_place_order_request4_open_api_d_t_o);
      expect(req.product_items).toEqual([{ product_id: 1005006349486340, product_count: 2, sku_attr: "14:29", logistics_service_name: "CAINIAO_STANDARD" }]);
      expect(req.logistics_address).toMatchObject({ full_name: "Thandi Mokoena", address: "12 Long St", city: "Cape Town", province: "Western Cape", zip: "8001", country: "ZA", mobile_no: "821234567", phone_country: "+27" });
      expect(JSON.parse(call.params.ds_extend_request).payment.try_to_pay).toBe("false"); // ALIEXPRESS_AUTO_PAY not set
      const { rows: f } = await pool.query(`SELECT status, ae_order_ids FROM aliexpress_fulfillments WHERE order_id = $1`, [orderId]);
      expect(f[0]).toMatchObject({ status: "placed", ae_order_ids: ["8123456789"] });
    });

    it("never places the same order twice", async () => {
      const before = calls.filter(c => c.params.method === "aliexpress.ds.order.create").length;
      await fulfil.runAliExpressCycle();
      expect(calls.filter(c => c.params.method === "aliexpress.ds.order.create").length).toBe(before);
    });

    it("follows it to shipped and gives the customer tracking under our carrier name", async () => {
      orderGet = { aliexpress_trade_ds_order_get_response: { result: { order_status: "WAIT_BUYER_ACCEPT_GOODS", logistics_info_list: { ae_order_logistics_info: [{ logistics_no: "LP00123456789CN", logistics_service: "CAINIAO_STANDARD" }] } } } };
      await pool.query(`UPDATE aliexpress_fulfillments SET last_synced_at = NULL`);
      await fulfil.syncPlacedOrders();
      const { rows: f } = await pool.query(`SELECT status, tracking_number, paid FROM aliexpress_fulfillments WHERE order_id = $1`, [orderId]);
      expect(f[0]).toMatchObject({ status: "shipped", tracking_number: "LP00123456789CN", paid: true });
      const { rows: o } = await pool.query(`SELECT tracking_number, carrier, shipping_status FROM mkt_orders WHERE id = $1`, [orderId]);
      expect(o[0]).toMatchObject({ tracking_number: "LP00123456789CN", carrier: "Ballylife Shipping", shipping_status: "in_transit" });
      // AliExpress shows it paid, so the supplier's share is settled first.
      const { rows: s } = await pool.query(`SELECT supplier_payout_status, supplier_payout_reference FROM mkt_order_line_settlements WHERE order_id = $1`, [orderId]);
      expect(s[0]).toMatchObject({ supplier_payout_status: "paid", supplier_payout_reference: "AliExpress 8123456789" });
    });

    it("an address AliExpress rejects goes to an admin, and can be retried", async () => {
      orderCreate = { aliexpress_ds_order_create_response: { result: { is_success: false, error_code: "B_DROPSHIPPER_DELIVERY_ADDRESS_VALIDATE_FAIL", error_msg: "address invalid" } } };
      const { rows: o } = await pool.query(
        `INSERT INTO mkt_orders (order_number, user_id, items, total_amount, status, payment_status, shipping_address) VALUES ('VNK-ORD-AE2', 'u1', $1, 400, 'confirmed', 'payment_confirmed', $2) RETURNING id`,
        [JSON.stringify([{ productId: listingId, quantity: 1, variantId: null }]), JSON.stringify({ firstName: "A", lastName: "B", line1: "1 St", city: "Durban", postalCode: "4001", country: "ZA", phone: "0831112222" })]
      );
      const { rows: p } = await pool.query(`SELECT supplier_product_id FROM mkt_products WHERE id = $1`, [listingId]);
      await pool.query(
        `INSERT INTO mkt_supplier_orders (order_id, product_id, supplier_id, supplier_product_id, seller_id, quantity, cost_amount, origin_warehouse_id, destination_warehouse_id)
         VALUES ($1, $2, 'sup-aliexpress', $3, 'sel-ballylife', 1, 10, 'wh-origin-cn', 'wh-dest-za')`, [o[0].id, listingId, p[0].supplier_product_id]
      );
      await fulfil.runAliExpressCycle();
      const { rows: f } = await pool.query(`SELECT id, status, last_error FROM aliexpress_fulfillments WHERE order_id = $1`, [o[0].id]);
      // The customer chose no option on a two-option product: that's caught before AliExpress is even called.
      expect(f[0].status).toBe("needs_attention");
      expect(f[0].last_error).toMatch(/option/);
      const retry = await request(app).post(`/api/marketplace/admin/aliexpress/fulfillments/${f[0].id}/retry`).set("Authorization", `Bearer ${adminToken}`);
      expect(retry.body.data.status).toBe("queued");
    });
  });
});

describe("Automatic import", () => {
  it("searches each product type and imports well-selling results it doesn't have yet", async () => {
    process.env.ALIEXPRESS_AUTO_KEYWORDS = "building blocks toys";
    const auto = await import("./aliexpressAutoSource");
    await auto.startAeSourcing();
    await auto.runAeSourcingTick();
    const search = lastCall("aliexpress.ds.text.search")!;
    expect(search.params).toMatchObject({ keyWord: "building blocks toys", countryCode: "ZA", currency: "USD" });
    const { rows } = await pool.query(`SELECT external_id FROM mkt_supplier_products WHERE supplier_id = 'sup-aliexpress' ORDER BY external_id`);
    const ids = rows.map((r: { external_id: string }) => r.external_id);
    expect(ids).toContain("1005000000000001");
    expect(ids).not.toContain("1005000000000002"); // only 10 orders: below the minimum
    const job = await auto.getAeSourcingJob();
    expect(job!.totals).toMatchObject({ listed: 1, mode: "search" });
  });

  it("finishes when every product type is done", async () => {
    const auto = await import("./aliexpressAutoSource");
    await auto.runAeSourcingTick();
    expect((await auto.getAeSourcingJob())!.status).toBe("done");
  });

  it("falls back to AliExpress's product feeds when keyword search isn't available to the app", async () => {
    searchResponse = { error_response: { code: "InsufficientPermission", msg: "App does not have permission to call this API" } };
    const auto = await import("./aliexpressAutoSource");
    await auto.startAeSourcing();
    await auto.runAeSourcingTick();
    const job = await auto.getAeSourcingJob();
    expect(job!.totals.mode).toBe("feeds");
    const { rows } = await pool.query(`SELECT 1 FROM mkt_supplier_products WHERE external_id = '3005000000000003'`);
    expect(rows).toHaveLength(1);
  });
});
