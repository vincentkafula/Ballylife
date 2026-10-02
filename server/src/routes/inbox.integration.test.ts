import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import request from "supertest";
import express, { type Express } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { createTestDb } from "../test/testDb";

process.env.RESEND_API_KEY = "re_test";
const SECRET_BYTES = crypto.randomBytes(24);
process.env.RESEND_WEBHOOK_SECRET = `whsec_${SECRET_BYTES.toString("base64")}`;

const { pool } = createTestDb();
vi.mock("../db/pool", () => ({ pool, hasDb: true }));

// ── Simulated Resend ───────────────────────────────────────────────────────
const received = new Map<string, Record<string, unknown>>();
let sentCount = 0; // Resend ids are unique across the whole run
let receivingOn = false, domainsForbidden = false;
let sent: { from: string; to: string[]; subject: string; text: string; headers?: Record<string, string>; reply_to?: string }[] = [];
function fakeResend(url: string, init?: { body?: string; method?: string }) {
  const json = (b: unknown, s = 200) => Promise.resolve(new Response(JSON.stringify(b), { status: s }));
  if (url === "https://api.resend.com/domains") return domainsForbidden
    ? json({ message: "This API key is restricted to only send emails" }, 401)
    : json({ data: [{ id: "dom_1", name: "ballylife.com", status: "verified", capabilities: { sending: "enabled", receiving: receivingOn ? "enabled" : "disabled" } }] });
  if (url === "https://api.resend.com/domains/dom_1" && init?.method === "PATCH") { receivingOn = JSON.parse(String(init.body)).capabilities?.receiving === "enabled"; return json({ id: "dom_1" }); }
  if (url === "https://api.resend.com/domains/dom_1") return json({ id: "dom_1", status: "verified", capabilities: { receiving: receivingOn ? "enabled" : "disabled" },
    records: [{ record: "Receiving", type: "MX", value: "inbound-smtp.eu-west-1.amazonaws.com", priority: 10, status: receivingOn ? "verified" : "not_started" }] });
  if (url === "https://api.resend.com/domains/dom_1/verify") return json({ id: "dom_1" });
  const m = url.match(/\/emails\/receiving\/([^/?]+)(\/attachments)?/);
  if (m && m[2]) return json({ data: [] });
  if (m) return received.has(m[1]) ? json(received.get(m[1])) : json({ message: "not found" }, 404);
  if (url === "https://api.resend.com/emails") { sent.push(JSON.parse(String(init?.body))); return json({ id: `sent_${++sentCount}` }); }
  return json({ message: `unexpected ${url}` }, 404);
}

let app: Express;
let adminToken: string;
let customerToken: string;

function signedPost(body: unknown, opts: { secret?: Buffer; ageSeconds?: number } = {}) {
  const raw = JSON.stringify(body);
  const id = `msg_${crypto.randomUUID()}`;
  const ts = String(Math.floor(Date.now() / 1000) - (opts.ageSeconds ?? 0));
  const sig = crypto.createHmac("sha256", opts.secret ?? SECRET_BYTES).update(`${id}.${ts}.${raw}`).digest("base64");
  return request(app).post("/api/email/inbound").set({ "svix-id": id, "svix-timestamp": ts, "svix-signature": `v1,${sig}`, "Content-Type": "application/json" }).send(raw);
}
const deliver = (id: string, email: Record<string, unknown>) => { received.set(id, { id, object: "email", ...email }); return signedPost({ type: "email.received", data: { email_id: id } }); };
const auth = () => ({ Authorization: `Bearer ${adminToken}` });

beforeAll(async () => {
  vi.stubGlobal("fetch", vi.fn(fakeResend));
  const authRouter = (await import("./authRouter")).default;
  const { inboundRouter, inboxAdminRouter } = await import("./inboxRouter");
  app = express();
  app.use(express.json({ verify: (req, _res, buf) => { (req as express.Request & { rawBody?: Buffer }).rawBody = Buffer.from(buf); } }));
  app.use("/api/auth", authRouter);
  app.use("/api/email", inboundRouter);
  app.use("/api/marketplace", inboxAdminRouter);
  const hash = await bcrypt.hash("Passw0rd!23", 10);
  await pool.query(`INSERT INTO users (username, password_hash, role, name, email) VALUES ('inboxadmin','${hash}','marketplace_admin','Admin','admin@example.com'), ('inboxcust','${hash}','customer','C','c@example.com')`);
  adminToken = (await request(app).post("/api/auth/login").send({ username: "inboxadmin", password: "Passw0rd!23" })).body.data.token;
  customerToken = (await request(app).post("/api/auth/login").send({ username: "inboxcust", password: "Passw0rd!23" })).body.data?.token ?? "";
});
beforeEach(() => { sent = []; });

describe("Receiving @ballylife.com email", () => {
  it("refuses unsigned, wrongly signed or stale notices", async () => {
    expect((await request(app).post("/api/email/inbound").send({ type: "email.received", data: { email_id: "x" } })).status).toBe(401);
    expect((await signedPost({ type: "email.received", data: { email_id: "x" } }, { secret: crypto.randomBytes(24) })).status).toBe(401);
    expect((await signedPost({ type: "email.received", data: { email_id: "x" } }, { ageSeconds: 600 })).status).toBe(401);
  });

  let threadId: string;
  it("files a new email under its mailbox and sends one automatic reply from that address", async () => {
    const r = await deliver("in_1", {
      from: "Mwila Banda <mwila@example.com>", to: ["orders@ballylife.com"], subject: "Where is my order?",
      text: "Hi, order VNK-ORD-100001 hasn't arrived.", html: "<p>Hi, order VNK-ORD-100001 hasn't arrived.</p>",
      message_id: "<cust-1@example.com>", headers: { from: "Mwila Banda <mwila@example.com>" }, authentication: { spf: "pass", dkim: "pass", dmarc: "pass" }, attachments: [],
    });
    expect(r.status).toBe(200);
    const { rows } = await pool.query(`SELECT * FROM email_threads`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ mailbox: "orders@ballylife.com", counterpart_email: "mwila@example.com", counterpart_name: "Mwila Banda", subject: "Where is my order?", unread: true });
    threadId = rows[0].id;

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ from: "Ballylife <orders@ballylife.com>", to: ["mwila@example.com"], reply_to: "orders@ballylife.com" });
    expect(sent[0].subject).toBe(`Re: Where is my order? [Ref BL-${rows[0].ref_no}]`);
    expect(sent[0].text).toContain(`BL-${rows[0].ref_no}`);
    expect(sent[0].headers).toMatchObject({ "In-Reply-To": "<cust-1@example.com>", "Auto-Submitted": "auto-replied" });
  });

  it("ignores a repeated notice for the same email", async () => {
    await signedPost({ type: "email.received", data: { email_id: "in_1" } });
    expect((await pool.query(`SELECT COUNT(*)::int AS n FROM email_messages WHERE direction = 'in'`)).rows[0].n).toBe(1);
    expect(sent).toHaveLength(0);
  });

  it("keeps the customer's reply in the same conversation, without another automatic reply", async () => {
    const { rows: ours } = await pool.query(`SELECT message_id FROM email_messages WHERE direction = 'out'`);
    await deliver("in_2", { from: "mwila@example.com", to: ["orders@ballylife.com"], subject: "Re: Where is my order?", text: "Any news?",
      message_id: "<cust-2@example.com>", headers: { "in-reply-to": ours[0].message_id }, attachments: [] });
    expect((await pool.query(`SELECT COUNT(*)::int AS n FROM email_threads`)).rows[0].n).toBe(1);
    expect(sent).toHaveLength(0);
  });

  it("never auto-replies to robots, mailing lists or other auto-replies", async () => {
    await deliver("in_3", { from: "no-reply@shop.example", to: ["info@ballylife.com"], subject: "Your receipt", text: "x", headers: {}, attachments: [] });
    await deliver("in_4", { from: "person@example.org", to: ["info@ballylife.com"], subject: "Out of office", text: "x", headers: { "auto-submitted": "auto-replied" }, attachments: [] });
    await deliver("in_5", { from: "news@example.org", to: ["info@ballylife.com"], subject: "Newsletter", text: "x", headers: { "list-unsubscribe": "<mailto:u@x>" }, attachments: [] });
    expect(sent).toHaveLength(0);
    expect((await pool.query(`SELECT COUNT(*)::int AS n FROM email_threads`)).rows[0].n).toBe(4); // still filed
  });

  it("auto-replies at most once a day per sender", async () => {
    await deliver("in_6", { from: "mwila@example.com", to: ["legal@ballylife.com"], subject: "A different question", text: "x", headers: {}, attachments: [] });
    expect(sent).toHaveLength(0);
  });

  it("managers see mailboxes with unread counts, read a conversation and reply from the mailbox in-thread", async () => {
    const mb = await request(app).get("/api/marketplace/admin/inbox/mailboxes").set(auth());
    expect(mb.status).toBe(200);
    expect(mb.body.data.mailboxes.find((m: { address: string }) => m.address === "orders@ballylife.com")).toMatchObject({ unread: 1, open: 1 });
    expect(mb.body.data.receiving).toBe(true);

    const list = await request(app).get("/api/marketplace/admin/inbox/threads?mailbox=orders@ballylife.com").set(auth());
    expect(list.body.data[0]).toMatchObject({ id: threadId, subject: "Where is my order?", unread: true });

    const t = await request(app).get(`/api/marketplace/admin/inbox/threads/${threadId}`).set(auth());
    expect(t.body.data.messages.map((m: { direction: string; autoReply: boolean }) => `${m.direction}${m.autoReply ? "-auto" : ""}`)).toEqual(["in", "out-auto", "in"]);
    expect(t.body.data.messages[0].senderVerified).toBe(true);

    const reply = await request(app).post(`/api/marketplace/admin/inbox/threads/${threadId}/reply`).set(auth()).send({ text: "Hi Mwila,\nIt ships tomorrow <b>not bold</b>." });
    expect(reply.status).toBe(200);
    expect(sent[0]).toMatchObject({ from: "Ballylife <orders@ballylife.com>", to: ["mwila@example.com"] });
    expect(sent[0].headers!["In-Reply-To"]).toBe("<cust-2@example.com>");
    expect(sent[0].headers!.References).toContain("<cust-1@example.com>");
    expect(JSON.stringify(sent[0])).toContain("&lt;b&gt;not bold&lt;/b&gt;"); // typed text is never treated as HTML

    expect((await request(app).patch(`/api/marketplace/admin/inbox/threads/${threadId}`).set(auth()).send({ status: "closed" })).status).toBe(200);
  });

  it("managers can write a new email from any mailbox", async () => {
    const r = await request(app).post("/api/marketplace/admin/inbox/compose").set(auth())
      .send({ mailbox: "b2b@ballylife.com", to: "Supplier <sales@supplier.example>", subject: "Partnership", text: "Hello" });
    expect(r.status).toBe(200);
    expect(sent[0]).toMatchObject({ from: "Ballylife <b2b@ballylife.com>", to: ["sales@supplier.example"] });
    expect(sent[0].subject).toMatch(/^Re: Partnership \[Ref BL-\d+\]$/);
    const bad = await request(app).post("/api/marketplace/admin/inbox/compose").set(auth()).send({ mailbox: "me@gmail.com", to: "a@b.co", subject: "x", text: "x" });
    expect(bad.status).toBe(400);
  });

  it("is manager-only", async () => {
    for (const path of ["/api/marketplace/admin/inbox/mailboxes", "/api/marketplace/admin/inbox/threads"]) {
      const r = await request(app).get(path).set({ Authorization: `Bearer ${customerToken}` });
      expect([401, 403]).toContain(r.status);
    }
  });
});

describe("Switching on receiving in Resend", () => {
  it("explains when the API key isn't allowed to change domain settings", async () => {
    domainsForbidden = true;
    const r = await request(app).post("/api/marketplace/admin/inbox/receiving").set(auth());
    expect(r.status).toBe(502);
    expect(r.body.error).toMatch(/sending access/);
    domainsForbidden = false;
  });

  it("switches receiving on for ballylife.com and reports the MX record", async () => {
    const before = await request(app).get("/api/marketplace/admin/inbox/receiving").set(auth());
    expect(before.body.data).toMatchObject({ receiving: "disabled", mx: { value: "inbound-smtp.eu-west-1.amazonaws.com", status: "not_started" } });
    const r = await request(app).post("/api/marketplace/admin/inbox/receiving").set(auth());
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ receiving: "enabled", mx: { status: "verified" } });
  });
});
