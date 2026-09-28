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
type Sent = { to: string; type: string; text?: string; buttons?: string[]; rows?: string[]; template?: string };
let sent: Sent[] = [];
let outCounter = 0;
function fakeWhatsApp() {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    if (url.endsWith("/messages")) {
      const b = JSON.parse(String(init!.body));
      if (b.status === "read") return json({ success: true });
      sent.push({
        to: b.to, type: b.type,
        text: b.text?.body ?? b.interactive?.body?.text,
        buttons: b.interactive?.action?.buttons?.map((x: any) => x.reply.id),
        rows: b.interactive?.action?.sections?.flatMap((s: any) => s.rows.map((r: any) => r.id)),
        template: b.template?.name,
      });
      return json({ messages: [{ id: `wamid.out.${++outCounter}` }] });
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
const say = (input: any, phone = PHONE) => E.handleIncoming({ phone, profileName: "Thandi", wamid: `wamid.in.${++n}`, input });
const text = (t: string, phone = PHONE) => say({ kind: "text", text: t }, phone);
const tap = (id: string, title = id, phone = PHONE) => say({ kind: "choice", id, title }, phone);
const last = () => sent[sent.length - 1];
const lastText = () => sent.filter(s => s.text).map(s => s.text!).pop() ?? "";

beforeAll(async () => {
  process.env.WHATSAPP_TOKEN = "test-token";
  process.env.WHATSAPP_PHONE_NUMBER_ID = "123";
  process.env.META_APP_SECRET = "app-secret";
  process.env.WHATSAPP_VERIFY_TOKEN = "verify-me";
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
    // the sign-in link is never written to the message log
    const { rows: log } = await pool.query(`SELECT body FROM wa_messages WHERE direction = 'out'`);
    expect(log.some((r: { body: string }) => r.body?.includes(signInToken))).toBe(false);
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
    expect(lastText()).toMatch(/Application received/);

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
