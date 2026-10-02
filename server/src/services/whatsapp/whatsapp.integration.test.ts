import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import crypto from "crypto";
import request from "supertest";
import express, { type Express } from "express";
import { createTestDb } from "../../test/testDb";

const { pool } = createTestDb();
vi.mock("../../db/pool", () => ({ pool, hasDb: true }));

const stored = new Map<string, Buffer>();
vi.mock("../documentStore", () => ({
  MAX_DOCUMENT_BYTES: 10 * 1024 * 1024,
  ALLOWED_DOCUMENT_TYPES: ["image/jpeg", "image/png", "application/pdf"],
  isDocumentStoreConfigured: () => true,
  putDocument: async (prefix: string, body: Buffer) => { const k = `${prefix}/${stored.size}.bin`; stored.set(k, body); return k; },
  getDocument: async (k: string) => stored.get(k)!,
  deleteDocument: async (k: string) => { stored.delete(k); },
  putProductPhoto: async () => "11111111-2222-3333-4444-555555555555",
  getProductPhoto: async () => ({ bytes: Buffer.from("x"), mimeType: "image/jpeg" }),
}));
const emails: { to: string; subject: string; html: string }[] = [];
vi.mock("../emailService", () => ({
  sendEmail: async (e: { to: string; subject: string; html: string }) => { emails.push(e); return { sent: true }; },
  sendVerificationEmail: async () => ({ sent: true }),
  sendPasswordResetEmail: async () => ({ sent: true }),
  sendOrderConfirmationEmail: async () => ({ sent: true }),
  isEmailConfigured: () => true,
}));

// ---- fake WhatsApp Cloud API: records what we send
type Sent = { to: string; type: string; text?: string; image?: string; buttons?: string[]; rows?: string[]; template?: string };
let sent: Sent[] = [];
let outCounter = 0;
const templatePosts: any[] = [];
const profilePosts: any[] = [];
function fakeWhatsApp() {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    if (url.endsWith("/messages")) {
      const b = JSON.parse(String(init!.body));
      if (b.status === "read") return json({ success: true });
      sent.push({
        to: b.to, type: b.type,
        text: b.text?.body ?? b.interactive?.body?.text ?? b.image?.caption,
        image: b.interactive?.header?.image?.link ?? b.image?.link,
        buttons: b.interactive?.action?.buttons?.map((x: any) => x.reply.id),
        rows: b.interactive?.action?.sections?.flatMap((s: any) => s.rows.map((r: any) => r.id)),
        template: b.template?.name,
      });
      return json({ messages: [{ id: `wamid.out.${++outCounter}` }] });
    }
    if (url.includes("/message_templates")) {
      if (init?.method === "POST") { templatePosts.push(JSON.parse(String(init.body))); return json({ id: "tpl-1", status: "PENDING" }); }
      return json({ data: [{ name: "order_status_update", status: "APPROVED", language: "en", category: "UTILITY" }] });
    }
    if (url.includes("/whatsapp_business_profile")) {
      if (init?.method === "POST") { profilePosts.push(JSON.parse(String(init.body))); return json({ success: true }); }
      return json({ data: [{ about: "old", websites: [] }] });
    }
    if (url.includes("/media-")) return json({ url: "https://lookaside.fbsbx.com/file", mime_type: "image/jpeg", file_size: 5 });
    if (url.startsWith("https://lookaside.fbsbx.com/")) return new Response(Buffer.from("JPEG!"), { status: 200 });
    return new Response("{}", { status: 404 });
  }));
}

let E: typeof import("./engine");
let app: Express;
let n = 0;
const PHONE = "27821234567";
// Same as the webhook: record the incoming message, then handle it.
const say = async (input: any, phone = PHONE) => {
  const wamid = `wamid.in.${++n}`;
  const { recordInbound } = await import("./store");
  await recordInbound(wamid, phone, input.kind, input.kind === "media" ? { id: input.mediaId, mime: input.mimeType } : null);
  return E.handleIncoming({ phone, profileName: "Thandi", wamid, input });
};
const text = (t: string, phone = PHONE) => say({ kind: "text", text: t }, phone);
const tap = (id: string, title = id, phone = PHONE) => say({ kind: "choice", id, title }, phone);
const last = () => sent[sent.length - 1];
const lastText = () => sent.filter(s => s.text).map(s => s.text!).pop() ?? "";

beforeAll(async () => {
  process.env.WHATSAPP_TOKEN = "test-token";
  process.env.WHATSAPP_PHONE_NUMBER_ID = "123";
  process.env.META_APP_SECRET = "app-secret";
  process.env.WHATSAPP_VERIFY_TOKEN = "verify-me";
  process.env.WHATSAPP_FLOOD_PER_MINUTE = "100000"; // tests send far faster than a person
  fakeWhatsApp();
  E = await import("./engine");
  const { whatsappRouter, whatsappAdminRouter } = await import("../../routes/whatsappRouter");
  const authRouter = (await import("../../routes/authRouter")).default;
  app = express();
  app.use(express.json({ verify: (req, _res, buf) => { (req as any).rawBody = Buffer.from(buf); } }));
  app.use("/api/whatsapp", whatsappRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/marketplace", whatsappAdminRouter);
  await pool.query(`INSERT INTO mkt_categories (id, name, slug, icon) VALUES ('cat-home','Home & Garden','home','🏠'), ('cat-toys','Toys','toys','🧸')`);
});
beforeEach(() => { sent = []; emails.length = 0; });

describe("webhook security", () => {
  it("answers Meta's verification only with the right verify token", async () => {
    expect((await request(app).get("/api/whatsapp/webhook").query({ "hub.mode": "subscribe", "hub.verify_token": "verify-me", "hub.challenge": "42" })).text).toBe("42");
    expect((await request(app).get("/api/whatsapp/webhook").query({ "hub.mode": "subscribe", "hub.verify_token": "wrong", "hub.challenge": "42" })).status).toBe(403);
  });

  it("rejects webhook posts without a valid signature", async () => {
    const body = JSON.stringify({ entry: [] });
    expect((await request(app).post("/api/whatsapp/webhook").set("Content-Type", "application/json").send(body)).status).toBe(401);
    const sig = "sha256=" + crypto.createHmac("sha256", "app-secret").update(body).digest("hex");
    expect((await request(app).post("/api/whatsapp/webhook").set("Content-Type", "application/json").set("X-Hub-Signature-256", sig).send(body)).status).toBe(200);
  });
});

describe("customer registration", () => {
  let signInToken = "";
  let tempPassword = "";

  it("greets a new number with Customer / Seller / Question", async () => {
    await text("Hi");
    expect(last().buttons).toEqual(["menu:customer", "menu:seller", "menu:question"]);
  });

  it("validates answers, supports back and edit, and creates the account", async () => {
    await tap("menu:customer");
    await text("Thandi"); // only one name
    expect(lastText()).toMatch(/first and last name/);
    await text("thandi mokoena");
    await text("not-an-email");
    expect(lastText()).toMatch(/doesn't look like an email/);
    await text("back");
    expect(lastText()).toMatch(/full name/);
    await text("Thandi Mokoena");
    await text("thandi@example.com");
    await text("12 Main Rd, Rondebosch, Cape Town, 7700");
    await tap("agree");
    expect(lastText()).toMatch(/Thandi Mokoena[\s\S]*thandi@example.com[\s\S]*7700/);
    // edit the email from the review screen
    await tap("edit");
    expect(last().rows).toEqual(["edit:c_name", "edit:c_email", "edit:c_address"]);
    await tap("edit:c_email");
    await text("thandi.m@example.com");
    expect(lastText()).toMatch(/Please check your details[\s\S]*thandi.m@example.com/);
    await tap("create");

    const { rows } = await pool.query(`SELECT id, role, phone, phone_verified, email_verified FROM users WHERE email = 'thandi.m@example.com'`);
    expect(rows[0]).toMatchObject({ role: "customer", phone: "+27821234567", phone_verified: true, email_verified: false });
    expect((await pool.query(`SELECT user_id FROM wa_contacts WHERE phone = $1`, [PHONE])).rows[0].user_id).toBe(rows[0].id);
    expect((await pool.query(`SELECT postal_code FROM mkt_addresses WHERE user_id = $1`, [rows[0].id])).rows[0].postal_code).toBe("7700");
    const link = lastText().match(/wa-login\?t=([\w-]+)/);
    expect(link).toBeTruthy();
    signInToken = link![1];
    // website login details: username and a temporary password
    expect(lastText()).toMatch(/Username: \*thandi\.m\*/);
    tempPassword = lastText().match(/Temporary password: \*([\w-]+)\*/)![1];
    expect(tempPassword).toMatch(/^[\w]{4}-[\w]{4}-[\w]{4}$/);
    // neither the sign-in link nor the password is ever written to the message log
    const { rows: log } = await pool.query(`SELECT body FROM wa_messages WHERE direction = 'out'`);
    expect(log.some((r: { body: string }) => r.body?.includes(signInToken) || r.body?.includes(tempPassword))).toBe(false);
  });

  it("the same login works on the website by username, email or phone, and asks for a new password first", async () => {
    // (they confirm their email from the link we emailed)
    await pool.query(`UPDATE users SET email_verified = true, account_status = 'active' WHERE email = 'thandi.m@example.com'`);
    for (const id of ["thandi.m", "Thandi.M@example.com", "082 123 4567", "+27821234567"]) {
      const r = await request(app).post("/api/auth/login").send({ username: id, password: tempPassword });
      expect(r.status).toBe(200);
      expect(r.body.data.user).toMatchObject({ username: "thandi.m", mustChangePassword: true, temporaryPassword: true });
    }
    expect((await request(app).post("/api/auth/login").send({ username: "thandi.m", password: "wrong-pass-1" })).status).toBe(401);
    const token = (await request(app).post("/api/auth/login").send({ username: "thandi.m", password: tempPassword })).body.data.token;
    const ch = await request(app).post("/api/auth/change-password").set("Authorization", `Bearer ${token}`).send({ currentPassword: tempPassword, newPassword: "Sunflower-Road-88" });
    expect(ch.status).toBe(200);
    const again = await request(app).post("/api/auth/login").send({ username: "thandi.m@example.com", password: "Sunflower-Road-88" });
    expect(again.status).toBe(200);
    expect(again.body.data.user.mustChangePassword).toBeUndefined();
  });

  it("login on WhatsApp shows the username without changing the password; new password replaces it", async () => {
    await text("login");
    expect(lastText()).toMatch(/Username: \*thandi\.m\*[\s\S]*Type \*new password\*/);
    expect((await request(app).post("/api/auth/login").send({ username: "thandi.m", password: "Sunflower-Road-88" })).status).toBe(200);

    await text("new password");
    const fresh = lastText().match(/Temporary password: \*([\w-]+)\*/)![1];
    expect((await request(app).post("/api/auth/login").send({ username: "thandi.m", password: "Sunflower-Road-88" })).status).toBe(401);
    const r = await request(app).post("/api/auth/login").send({ username: "thandi.m", password: fresh });
    expect(r.status).toBe(200);
    expect(r.body.data.user.temporaryPassword).toBe(true);
    const { rows: log } = await pool.query(`SELECT body FROM wa_messages WHERE direction = 'out'`);
    expect(log.some((x: { body: string }) => x.body?.includes(fresh))).toBe(false);
  });

  it("the magic link signs in once, and only once", async () => {
    const r = await request(app).post("/api/auth/magic-login").send({ token: signInToken });
    expect(r.status).toBe(200);
    expect(r.body.data.token).toBeTruthy();
    expect(r.body.data.user.email).toBe("thandi.m@example.com");
    expect((await request(app).post("/api/auth/magic-login").send({ token: signInToken })).status).toBe(400);
  });

  it("greets a registered number by name", async () => {
    await text("hello");
    expect(lastText()).toMatch(/Welcome back, \*Thandi\*/);
  });
});

describe("existing account", () => {
  const P = "27831112222";
  it("emails a confirm link instead of creating a second account, then links the number", async () => {
    await pool.query(`INSERT INTO users (username, password_hash, role, name, email) VALUES ('sipho', 'x', 'customer', 'Sipho Dlamini', 'sipho@example.com')`);
    await tap("menu:customer", "Customer", P);
    await text("Sipho Dlamini", P);
    await text("sipho@example.com", P);
    await text("5 Long St, Cape Town, 8001", P);
    await tap("agree", "agree", P);
    await tap("create", "create", P);
    expect((await pool.query(`SELECT COUNT(*)::int AS n FROM users WHERE email = 'sipho@example.com'`)).rows[0].n).toBe(1);
    expect(emails[0].to).toBe("sipho@example.com");
    const t = emails[0].html.match(/link\?t=([^"]+)"/)![1];
    const r = await request(app).get("/api/whatsapp/link").query({ t: decodeURIComponent(t) });
    expect(r.status).toBe(200);
    const { rows } = await pool.query(`SELECT c.user_id, u.phone FROM wa_contacts c JOIN users u ON u.id = c.user_id WHERE c.phone = $1`, [P]);
    expect(rows[0].phone).toBe("+27831112222");
    expect(lastText()).toMatch(/now connected/);
  });
});

describe("seller application", () => {
  const P = "27845556666";
  it("collects everything, encrypts bank and ID details, stores documents, and creates a pending seller", async () => {
    await tap("menu:seller", "Seller", P);
    await text("Lerato Nkosi", P);
    await text("lerato@example.com", P);
    await text("Lerato's Crafts", P);
    await tap("individual", "Individual", P);
    await text("8001015009087", P);
    await tap("cat:cat-home", "Home & Garden", P);
    expect(last().rows).toContain("done");
    await tap("done", "Done", P);
    await tap("bank:fnb", "FNB", P);
    await text("Lerato Nkosi", P);
    await text("62812345678", P);
    await tap("use", "Use 250655", P);
    await tap("savings", "Savings", P);
    await text("here is my id", P);
    expect(lastText()).toMatch(/photo.*PDF/);
    await say({ kind: "media", mediaId: "media-1", mimeType: "image/jpeg" }, P);
    await say({ kind: "media", mediaId: "media-2", mimeType: "image/jpeg" }, P);
    await tap("agree", "agree", P);
    expect(lastText()).toMatch(/Lerato's Crafts[\s\S]*FNB •••• 5678[\s\S]*branch 250655/);
    await tap("submit", "Submit", P);

    const { rows } = await pool.query(`SELECT s.id, s.status, s.application_data::text AS app FROM mkt_sellers s WHERE s.store_name = $1`, ["Lerato's Crafts"]);
    expect(rows[0].status).toBe("pending_kyc");
    expect(rows[0].app).not.toContain("62812345678");
    expect(rows[0].app).not.toContain("8001015009087");
    expect(rows[0].app).toContain("•••• 5678");
    const docs = (await pool.query(`SELECT kind FROM seller_documents WHERE seller_id = $1 ORDER BY kind`, [rows[0].id])).rows.map((r: any) => r.kind);
    expect(docs).toEqual(["id_document", "proof_of_address"]);
    // bank details and ID number never reach the message log
    const { rows: log } = await pool.query(`SELECT body FROM wa_messages`);
    expect(log.some((r: any) => /62812345678|8001015009087/.test(r.body ?? ""))).toBe(false);
    expect(sent.map(s => s.text ?? "").join("\n")).toMatch(/Application received[\s\S]*Username: \*lerato\*[\s\S]*Temporary password/);

    // admin approves -> the seller gets a sign-in link on WhatsApp
    const { notifySellerDecision } = await import("./notifications");
    await notifySellerDecision(rows[0].id, "approved");
    expect(lastText()).toMatch(/approved[\s\S]*wa-login\?t=/);
  });
});

describe("cancel and opt-out", () => {
  const P = "27860000000";
  it("cancel deletes answers and uploaded documents", async () => {
    await tap("menu:seller", "Seller", P);
    await text("cancel", P);
    expect(sent.some(s => /Cancelled/.test(s.text ?? ""))).toBe(true);
    expect((await pool.query(`SELECT flow FROM wa_conversations WHERE phone = $1`, [P])).rows[0].flow).toBeNull();
  });

  it("STOP silences the bot until START", async () => {
    await text("STOP", P);
    expect(lastText()).toMatch(/unsubscribed/);
    sent = [];
    await text("hello", P);
    expect(sent).toHaveLength(0);
    await text("START", P);
    expect(sent.length).toBeGreaterThan(0);
  });

  it("re-delivered webhooks are handled once", async () => {
    const { recordInbound } = await import("./store");
    expect(await recordInbound("wamid.dup", P, "text")).toBe(true);
    expect(await recordInbound("wamid.dup", P, "text")).toBe(false);
  });
});

describe("validators", () => {
  it("checks SA ID numbers, CIPC numbers and addresses", async () => {
    const v = await import("./validate");
    expect(v.saIdNumber("8001015009087")).toBe("8001015009087");
    expect(v.saIdNumber("8001015009088")).toBeNull();
    expect(v.cipcNumber("2021/123456/07")).toBe("2021/123456/07");
    expect(v.cipcNumber("21/123/07")).toBeNull();
    expect(v.address("12 Main Rd, Rondebosch, Cape Town, 7700")?.postalCode).toBe("7700");
    expect(v.address("somewhere")).toBeNull();
  });
});

// ---------------------------------------------------------------- Phase 2

describe("Phase 2: shopping, orders and seller tools", () => {
  const LERATO = "27845556666";
  let productId = "";
  let leratoSeller = "";

  beforeAll(async () => {
    const q = (sql: string, p: unknown[] = []) => pool.query(sql, p);
    await q(`INSERT INTO mkt_sellers (id, store_name, store_slug, status) VALUES ('sel-ballylife','Ballylife','ballylife','active')`);
    productId = (await q(`INSERT INTO mkt_products (seller_id, category_id, name, slug, price, images, status, stock, total_sold, avg_rating)
      VALUES ('sel-ballylife','cat-home','Wireless Earbuds Pro','earbuds',349,'["https://ae01.alicdn.com/e.jpg"]','active',10,40,4.6) RETURNING id`)).rows[0].id;
    await q(`INSERT INTO mkt_products (seller_id, category_id, name, slug, price, images, status, stock) VALUES ('sel-ballylife','cat-home','Wireless Mouse','mouse',99,'["#111"]','active',5)`);
    leratoSeller = (await q(`SELECT id FROM mkt_sellers WHERE store_name = $1`, ["Lerato's Crafts"])).rows[0].id;
    await q(`UPDATE mkt_sellers SET status = 'active' WHERE id = $1`, [leratoSeller]);
  });

  it("searches products, shows a photo card, and Buy now fills the cart and sends a checkout link", async () => {
    await text("shop");
    await text("wireless");
    expect(last().rows).toEqual([`prod:${productId}`, "search"]); // the mouse has no real photo
    await tap(`prod:${productId}`, "Wireless Earbuds Pro");
    expect(last().image).toMatch(new RegExp(`/api/marketplace/media/p/${productId}/0$`)); // supplier photo via our proxy
    expect(last().text).toMatch(/R349[\s\S]*delivery included/);
    await tap("buy", "Buy now");
    const userId = (await pool.query(`SELECT user_id FROM wa_contacts WHERE phone = $1`, [PHONE])).rows[0].user_id;
    const cart = (await pool.query(`SELECT items FROM mkt_carts WHERE user_id = $1`, [userId])).rows[0].items;
    expect(cart[0]).toMatchObject({ productId, quantity: 1, unitPrice: 349 });
    expect(lastText()).toMatch(/wa-login\?t=[\w-]+&next=%2Fcheckout/);
    expect((await pool.query(`SELECT flow FROM wa_conversations WHERE phone = $1`, [PHONE])).rows[0].flow).toBeNull();
  });

  it("an unregistered number is asked to create an account before buying", async () => {
    const P = "27870001111";
    await text("shop", P);
    await text("earbuds", P);
    await tap(`prod:${productId}`, "Earbuds", P);
    await tap("buy", "Buy now", P);
    expect(last().buttons).toEqual(["register", "back"]);
    await tap("register", "Create account", P);
    expect(lastText()).toMatch(/full name/);
  });

  it("lists orders and shows one with tracking", async () => {
    const userId = (await pool.query(`SELECT user_id FROM wa_contacts WHERE phone = $1`, [PHONE])).rows[0].user_id;
    const orderId = (await pool.query(`INSERT INTO mkt_orders (order_number, user_id, items, total_amount, status, payment_status, tracking_number)
      VALUES ('BL-1001', $1, $2, 349, 'shipped', 'payment_confirmed', 'TRK123') RETURNING id`,
      [userId, JSON.stringify([{ productId, name: "Wireless Earbuds Pro", quantity: 1, unitPrice: 349, sellerId: "sel-ballylife" }])])).rows[0].id;
    await text("orders");
    expect(last().rows).toEqual([`order:${orderId}`]);
    await tap(`order:${orderId}`, "BL-1001");
    expect(lastText()).toMatch(/BL-1001[\s\S]*On its way[\s\S]*TRK123/);
  });

  it("sends order updates to the customer and one new-order alert to the seller -- never about old orders", async () => {
    const { runOrderAlerts } = await import("./orderAlerts");
    expect(await runOrderAlerts()).toEqual({ customers: 0, sellers: 0 }); // first run: baseline only
    const userId = (await pool.query(`SELECT user_id FROM wa_contacts WHERE phone = $1`, [PHONE])).rows[0].user_id;
    const orderId = (await pool.query(`INSERT INTO mkt_orders (order_number, user_id, items, total_amount, status, payment_status)
      VALUES ('BL-1002', $1, $2, 500, 'confirmed', 'payment_confirmed') RETURNING id`,
      [userId, JSON.stringify([{ productId: "x", name: "Beaded Necklace", quantity: 2, unitPrice: 250, sellerId: leratoSeller }])])).rows[0].id;
    sent = [];
    expect(await runOrderAlerts()).toEqual({ customers: 1, sellers: 1 });
    expect(sent.find(s => s.to === PHONE)?.text).toMatch(/received your payment for order \*BL-1002\*/);
    expect(sent.find(s => s.to === LERATO)?.text).toMatch(/New order BL-1002[\s\S]*Beaded Necklace × 2[\s\S]*R500/);
    expect(await runOrderAlerts()).toEqual({ customers: 0, sellers: 0 }); // nothing twice
    await pool.query(`UPDATE mkt_orders SET status = 'shipped', tracking_number = 'TRK9' WHERE id = $1`, [orderId]);
    sent = [];
    expect(await runOrderAlerts()).toEqual({ customers: 1, sellers: 0 });
    expect(lastText()).toMatch(/BL-1002\* is on its way[\s\S]*TRK9/);
  });

  it("sellers update stock and pause products -- only their own, and never the price", async () => {
    const own = (await pool.query(`INSERT INTO mkt_products (seller_id, category_id, name, slug, price, images, status, stock)
      VALUES ($1,'cat-home','Beaded Necklace','necklace',250,'[]','active',3) RETURNING id`, [leratoSeller])).rows[0].id;
    await tap("menu:products", "My products", LERATO);
    expect(last().rows).toEqual([`prod:${own}`]); // not the Ballylife store's products
    await tap(`prod:${own}`, "Beaded Necklace", LERATO);
    expect(last().buttons).toEqual(["stock", "pause", "list"]);
    await tap("stock", "Update stock", LERATO);
    await text("12", LERATO);
    expect((await pool.query(`SELECT stock FROM mkt_products WHERE id = $1`, [own])).rows[0].stock).toBe(12);
    await tap("pause", "Pause", LERATO);
    expect((await pool.query(`SELECT status FROM mkt_products WHERE id = $1`, [own])).rows[0].status).toBe("inactive");
  });

  it("adding a product follows the catalog policy, and creates a product waiting for approval", async () => {
    delete process.env.CJ_ONLY_CATALOG;
    await text("menu", LERATO);
    await tap("menu:add_product", "Add a product", LERATO);
    expect(lastText()).toMatch(/paused on Ballylife/);
    process.env.CJ_ONLY_CATALOG = "off";
    await tap("menu:add_product", "Add a product", LERATO);
    await text("Handmade Beaded Bracelet", LERATO);
    await tap("cat:cat-home", "Home & Garden", LERATO);
    await text("R149.50", LERATO);
    await text("8", LERATO);
    await text("skip", LERATO);
    await say({ kind: "media", mediaId: "media-9", mimeType: "image/jpeg" }, LERATO);
    await tap("done", "Done", LERATO);
    expect(lastText()).toMatch(/Handmade Beaded Bracelet[\s\S]*R150[\s\S]*1 photo/);
    await tap("submit", "Submit", LERATO);
    const { rows } = await pool.query(`SELECT status, price, stock, images FROM mkt_products WHERE name = 'Handmade Beaded Bracelet'`);
    expect(rows[0]).toMatchObject({ status: "pending_review", stock: 8 });
    expect(Number(rows[0].price)).toBe(149.5);
    expect(rows[0].images[0]).toMatch(/\/api\/whatsapp\/photos\/11111111-2222-3333-4444-555555555555$/);
    delete process.env.CJ_ONLY_CATALOG;
  });

  it("the magic link can open checkout after signing in, but only our own pages", async () => {
    const { magicLoginUrl } = await import("../magicLink");
    expect(magicLoginUrl("abc", "/checkout")).toMatch(/wa-login\?t=abc&next=%2Fcheckout$/);
    expect(magicLoginUrl("abc", "https://evil.example")).toMatch(/wa-login\?t=abc$/);
  });
});

// ---------------------------------------------------------------- Phase 3

describe("Phase 3: AI assistant, handoff and the staff inbox", () => {
  const STAFF = "27829990000";
  const requests: any[] = [];
  let script: Array<(params: any) => any> = [];
  const reply = (content: any[], stop_reason = "end_turn") => ({
    content, stop_reason, stop_details: null,
    usage: { input_tokens: 900, output_tokens: 120, cache_read_input_tokens: 1500, cache_creation_input_tokens: 0 },
  });
  let adminToken = "";

  beforeAll(async () => {
    const A = await import("./assistant");
    A._setAnthropicClientForTests({ beta: { messages: { create: async (params: any) => {
      requests.push(JSON.parse(JSON.stringify(params)));
      const next = script.shift();
      if (!next) throw new Error("unexpected Claude call");
      return next(params);
    } } } });
    process.env.ADMIN_ALERT_EMAIL = "team@ballylife.test";
    process.env.WHATSAPP_STAFF_NUMBER = `+${STAFF}`;
    const bcrypt = (await import("bcryptjs")).default;
    await pool.query(`INSERT INTO users (username, password_hash, role, name, email) VALUES ('boss', $1, 'marketplace_admin', 'Boss', 'boss@ballylife.test')`, [await bcrypt.hash("Pass-12345", 4)]);
    adminToken = (await request(app).post("/api/auth/login").send({ username: "boss", password: "Pass-12345" })).body.data.token;
  });
  beforeEach(() => { requests.length = 0; script = []; process.env.ANTHROPIC_API_KEY = "test-key"; });

  it("answers a free-text question using the live catalogue, with safe request settings", async () => {
    script = [
      () => reply([{ type: "tool_use", id: "t1", name: "search_products", input: { query: "earbuds" } }], "tool_use"),
      () => reply([{ type: "text", text: "Yes! *Wireless Earbuds Pro* are R349 with delivery included." }]),
    ];
    await text("do you sell earbuds and how long is delivery");
    expect(lastText()).toMatch(/Wireless Earbuds Pro\* are R349/);
    const first = requests[0];
    expect(first).toMatchObject({ model: "claude-opus-5", fallbacks: "default", betas: ["server-side-fallback-2026-07-01"], output_config: { effort: "low" } });
    expect(first.system[0].cache_control).toEqual({ type: "ephemeral" });
    const toolResult = requests[1].messages.at(-1).content[0];
    expect(toolResult).toMatchObject({ type: "tool_result", tool_use_id: "t1" });
    expect(toolResult.content).toMatch(/Wireless Earbuds Pro[\s\S]*R349[\s\S]*3–5 business days[\s\S]*\/product\//); // no delivery profile = local seller times
    const { rows } = await pool.query(`SELECT sent_by FROM wa_messages WHERE phone = $1 AND direction = 'out' ORDER BY created_at DESC LIMIT 1`, [PHONE]);
    expect(rows[0].sent_by).toBe("ai");
    const usage = (await pool.query(`SELECT answers, api_calls FROM ai_usage_daily`)).rows[0];
    expect(usage).toMatchObject({ answers: 1, api_calls: 2 });
  });

  it("order lookups only ever see the orders of the account linked to this number", async () => {
    script = [
      () => reply([{ type: "tool_use", id: "t2", name: "get_order", input: { order_number: "bl-1002" } }], "tool_use"),
      () => reply([{ type: "text", text: "Order BL-1002 is on its way." }]),
    ];
    await text("where is my order BL-1002");
    expect(requests[1].messages.at(-1).content[0].content).toMatch(/BL-1002[\s\S]*On its way[\s\S]*TRK9/);
    // A number without an account gets nothing.
    script = [
      () => reply([{ type: "tool_use", id: "t3", name: "get_order", input: { order_number: "BL-1002" } }], "tool_use"),
      () => reply([{ type: "text", text: "I can't see that order." }]),
    ];
    await text("where is order BL-1002", "27875550000");
    expect(requests[3].messages.at(-1).content[0].content).toMatch(/Not linked/);
  });

  it("hands over to a person: alerts staff, the bot goes quiet, staff reply from the inbox, then resolve", async () => {
    script = [() => reply([{ type: "tool_use", id: "t4", name: "handoff_to_human", input: { reason: "Wants a refund for a broken kettle" } }], "tool_use")];
    await text("my kettle arrived broken I want my money back");
    const contact = (await pool.query(`SELECT handoff, handoff_reason FROM wa_contacts WHERE phone = $1`, [PHONE])).rows[0];
    expect(contact).toMatchObject({ handoff: true, handoff_reason: "Wants a refund for a broken kettle" });
    expect(sent.some(s => s.to === PHONE && /passed this chat to the Ballylife team/.test(s.text ?? ""))).toBe(true);
    expect(emails.some(e => e.to === "team@ballylife.test" && /broken kettle/.test(e.html))).toBe(true);
    expect(sent.some(s => s.to === STAFF)).toBe(true);

    sent = [];
    await text("hello? anyone there");
    expect(sent).toHaveLength(0); // the bot stays quiet while a person has the chat
    expect(requests).toHaveLength(1);

    const auth = { Authorization: `Bearer ${adminToken}` };
    const inbox = (await request(app).get("/api/marketplace/admin/whatsapp/inbox").set(auth)).body.data;
    const row = inbox.conversations.find((c: any) => c.phone === PHONE);
    expect(row).toMatchObject({ handoff: true, windowOpen: true });
    expect(row.unread).toBeGreaterThan(0);
    expect(inbox.ai.enabled).toBe(true);

    const thread = (await request(app).get(`/api/marketplace/admin/whatsapp/inbox/${PHONE}`).set(auth)).body.data;
    expect(thread.messages.some((m: any) => m.text === "hello? anyone there")).toBe(true);

    const r = await request(app).post(`/api/marketplace/admin/whatsapp/inbox/${PHONE}/reply`).set(auth).send({ text: "Hi Thandi, sorry about that — we'll collect it tomorrow." });
    expect(r.body.success).toBe(true);
    expect(lastText()).toMatch(/we'll collect it tomorrow/);
    const { rows } = await pool.query(`SELECT sent_by FROM wa_messages WHERE phone = $1 AND direction = 'out' ORDER BY created_at DESC LIMIT 1`, [PHONE]);
    expect(rows[0].sent_by).toBe("boss");

    await request(app).post(`/api/marketplace/admin/whatsapp/inbox/${PHONE}/resolve`).set(auth);
    expect((await pool.query(`SELECT handoff FROM wa_contacts WHERE phone = $1`, [PHONE])).rows[0].handoff).toBe(false);
    expect(lastText()).toMatch(/marked your question as sorted/);
  });

  it("the customer can type menu to get the bot back", async () => {
    await request(app).post(`/api/marketplace/admin/whatsapp/inbox/${PHONE}/take`).set({ Authorization: `Bearer ${adminToken}` });
    expect((await pool.query(`SELECT handoff FROM wa_contacts WHERE phone = $1`, [PHONE])).rows[0].handoff).toBe(true);
    await text("menu");
    expect((await pool.query(`SELECT handoff FROM wa_contacts WHERE phone = $1`, [PHONE])).rows[0].handoff).toBe(false);
    expect(last().rows).toContain("menu:human");
  });

  it("the inbox is for managers only", async () => {
    expect((await request(app).get("/api/marketplace/admin/whatsapp/inbox")).status).toBe(401);
  });

  it("a declined request goes to a person instead of failing", async () => {
    const P = "27876660000";
    script = [() => ({ ...reply([]), stop_reason: "refusal", stop_details: { category: "cyber" } })];
    await text("something the model declines", P);
    expect((await pool.query(`SELECT handoff FROM wa_contacts WHERE phone = $1`, [P])).rows[0].handoff).toBe(true);
  });

  it("without an API key, questions go straight to the team", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const P = "27877770000";
    await tap("menu:question", "Just a question", P);
    await text("Do you deliver to Polokwane?", P);
    expect(requests).toHaveLength(0);
    expect((await pool.query(`SELECT handoff FROM wa_contacts WHERE phone = $1`, [P])).rows[0].handoff).toBe(true);
  });
});

// ---------------------------------------------------------------- Phase 4

describe("Phase 4: deals, my details, customer photos, templates and profile", () => {
  let auth: Record<string, string> = {};
  let productId = "";

  beforeAll(async () => {
    const token = (await request(app).post("/api/auth/login").send({ username: "boss", password: "Pass-12345" })).body.data.token;
    auth = { Authorization: `Bearer ${token}` };
    productId = (await pool.query(`SELECT id FROM mkt_products WHERE name = 'Wireless Earbuds Pro'`)).rows[0].id;
    delete process.env.ANTHROPIC_API_KEY;
    process.env.WHATSAPP_WABA_ID = "999";
  });

  it("deals are opt-in, sent only after confirming, at most every few days, and STOP DEALS works", async () => {
    await text("deals");
    expect(last().buttons).toEqual(["deals:yes", "deals:no"]);
    await tap("deals:yes", "Yes, send deals");
    expect((await pool.query(`SELECT deals_opt_in_at FROM wa_contacts WHERE phone = $1`, [PHONE])).rows[0].deals_opt_in_at).toBeTruthy();

    const stats = (await request(app).get("/api/marketplace/admin/whatsapp/deals").set(auth)).body.data;
    expect(stats).toMatchObject({ subscribers: 1, reachableNow: 1 });
    expect((await request(app).post("/api/marketplace/admin/whatsapp/deals/broadcast").set(auth).send({ productId })).status).toBe(400); // not confirmed

    sent = [];
    const r = await request(app).post("/api/marketplace/admin/whatsapp/deals/broadcast").set(auth).send({ productId, confirm: true });
    expect(r.body.data.recipients).toBe(1);
    await new Promise(res => setTimeout(res, 500));
    expect(sent.find(s => s.to === PHONE)?.text).toMatch(/New on Ballylife: \*Wireless Earbuds Pro\*[\s\S]*STOP DEALS/); // inside the 24h window: a free photo message
    const b = (await request(app).get("/api/marketplace/admin/whatsapp/deals").set(auth)).body.data.broadcasts[0];
    expect(b).toMatchObject({ status: "done", sent: 1, failed: 0 });

    const again = await request(app).post("/api/marketplace/admin/whatsapp/deals/broadcast").set(auth).send({ productId, confirm: true });
    expect(again.body.error).toMatch(/Nobody is due/);

    await text("stop deals");
    expect(lastText()).toMatch(/won't get deals messages/);
    expect((await request(app).get("/api/marketplace/admin/whatsapp/deals").set(auth)).body.data.subscribers).toBe(0);
  });

  it("customers update their delivery address in WhatsApp", async () => {
    await text("my details");
    expect(last().buttons).toEqual(["address", "email", "done"]);
    await tap("address", "Address");
    await text("7 Oak Ave, Sea Point, Cape Town, 8005");
    const userId = (await pool.query(`SELECT user_id FROM wa_contacts WHERE phone = $1`, [PHONE])).rows[0].user_id;
    const { rows } = await pool.query(`SELECT line1, postal_code FROM mkt_addresses WHERE user_id = $1 AND is_default = true`, [userId]);
    expect(rows[0]).toMatchObject({ postal_code: "8005" });
    expect(rows[0].line1).toMatch(/7 Oak Ave/);
  });

  it("a photo sent outside a form goes to the team, and staff can open it in the inbox", async () => {
    await say({ kind: "media", mediaId: "media-77", mimeType: "image/jpeg", caption: "the box was crushed" });
    expect((await pool.query(`SELECT handoff, handoff_reason FROM wa_contacts WHERE phone = $1`, [PHONE])).rows[0])
      .toMatchObject({ handoff: true, handoff_reason: "Sent a photo: the box was crushed" });
    const thread = (await request(app).get(`/api/marketplace/admin/whatsapp/inbox/${PHONE}`).set(auth)).body.data;
    const photo = thread.messages.find((m: any) => m.media);
    expect(photo.text).toBe("[photo: the box was crushed]");
    const file = await request(app).get(`/api/marketplace/admin/whatsapp/media/${photo.id}`).set(auth);
    expect(file.status).toBe(200);
    expect(file.headers["content-type"]).toMatch(/image\/jpeg/);
    await request(app).post(`/api/marketplace/admin/whatsapp/inbox/${PHONE}/resolve`).set(auth);
  });

  it("submits only the missing templates, with the placeholders the code fills", async () => {
    const status = (await request(app).get("/api/marketplace/admin/whatsapp/templates").set(auth)).body.data;
    expect(status.find((t: any) => t.name === "order_status_update").status).toBe("APPROVED");
    expect(status.find((t: any) => t.name === "new_arrival").status).toBe("NOT_SUBMITTED");
    const r = (await request(app).post("/api/marketplace/admin/whatsapp/templates/submit").set(auth)).body.data;
    expect(r.submitted).not.toContain("order_status_update");
    expect(r.submitted).toEqual(expect.arrayContaining(["seller_application_approved", "seller_new_order", "staff_handoff_alert", "new_arrival"]));
    const newArrival = templatePosts.find(t => t.name === "new_arrival");
    expect(newArrival).toMatchObject({ category: "MARKETING", language: "en" });
    expect(newArrival.components[0].text.match(/\{\{\d\}\}/g)).toHaveLength(3); // first name, product, price
    const authTemplate = templatePosts.find(t => t.name === "ballylife_verification_code");
    expect(authTemplate).toMatchObject({ category: "AUTHENTICATION", components: [{ type: "BODY", add_security_recommendation: true }, { type: "FOOTER", code_expiration_minutes: 10 }, { type: "BUTTONS", buttons: [{ type: "OTP", otp_type: "COPY_CODE" }] }] });
    for (const t of templatePosts.filter(x => x.category !== "AUTHENTICATION")) { // Meta writes authentication texts itself
      const body: string = t.components[0].text;
      expect(body.trim().startsWith("{{")).toBe(false); // Meta rejects templates that start or end with a placeholder
      expect(body.trim().endsWith("}}")).toBe(false);
    }
  });

  it("updates the WhatsApp business profile", async () => {
    const r = await request(app).post("/api/marketplace/admin/whatsapp/profile").set(auth)
      .send({ about: "x".repeat(200), description: "Shop Ballylife", websites: ["https://www.ballylife.com", "not-a-url"] });
    expect(r.body.success).toBe(true);
    expect(profilePosts[0].about).toHaveLength(139);
    expect(profilePosts[0].websites).toEqual(["https://www.ballylife.com"]);
  });
});
