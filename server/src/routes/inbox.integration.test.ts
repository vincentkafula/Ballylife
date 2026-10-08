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
let receivingOn = false, domainsForbidden = false, openTracking = false;
let sent: { from: string; to: string[]; subject: string; text: string; html?: string; headers?: Record<string, string>; reply_to?: string; attachments?: { filename: string; content: string }[] }[] = [];
function fakeResend(url: string, init?: { body?: string; method?: string }) {
  const json = (b: unknown, s = 200) => Promise.resolve(new Response(JSON.stringify(b), { status: s }));
  if (url === "https://api.resend.com/domains") return domainsForbidden
    ? json({ message: "This API key is restricted to only send emails" }, 401)
    : json({ data: [{ id: "dom_1", name: "ballylife.com", status: "verified", capabilities: { sending: "enabled", receiving: receivingOn ? "enabled" : "disabled" } }] });
  if (url === "https://api.resend.com/domains/dom_1" && init?.method === "PATCH") {
    const b = JSON.parse(String(init.body));
    if (b.capabilities) receivingOn = b.capabilities.receiving === "enabled";
    if ("open_tracking" in b) openTracking = Boolean(b.open_tracking);
    return json({ id: "dom_1" });
  }
  if (url === "https://api.resend.com/domains/dom_1") return json({ id: "dom_1", status: "verified", open_tracking: openTracking, capabilities: { receiving: receivingOn ? "enabled" : "disabled" },
    records: [
      { record: "SPF", type: "MX", name: "send", value: "feedback-smtp.eu-west-1.amazonses.com", status: "verified" },
      { record: "SPF", type: "TXT", name: "send", value: "v=spf1 include:amazonses.com ~all", status: "verified" },
      { record: "DKIM", type: "TXT", name: "resend._domainkey", value: "p=MIGf...", status: "not_started" },
      { record: "Receiving", type: "MX", value: "inbound-smtp.eu-west-1.amazonaws.com", priority: 10, status: receivingOn ? "verified" : "not_started" },
    ] });
  if (url === "https://api.resend.com/domains/dom_1/verify") return json({ id: "dom_1" });
  if (url.startsWith("https://api.resend.com/emails/receiving?")) return json({ object: "list", has_more: false, data: [...received.values()].map(e => ({ id: e.id, created_at: new Date().toISOString() })).reverse() });
  const m = url.match(/\/emails\/receiving\/([^/?]+)(\/attachments)?/);
  if (m && m[2]) return json({ data: [] });
  if (m) return received.has(m[1]) ? json(received.get(m[1])) : json({ message: "not found" }, 404);
  if (url === "https://api.resend.com/emails") { sent.push(JSON.parse(String(init?.body))); return json({ id: `sent_${++sentCount}` }); }
  if (/\/emails\/sent_\d+$/.test(url)) return json({ object: "email", last_event: "delivered" });
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
  app.use(express.json({ limit: "15mb", verify: (req, _res, buf) => { (req as express.Request & { rawBody?: Buffer }).rawBody = Buffer.from(buf); } }));
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

describe("Safety net when a webhook notice never arrives", () => {
  it("'Check for new mail' pulls in received emails we don't have yet, once", async () => {
    received.set("in_missed", { id: "in_missed", object: "email", from: "Thandi <thandi@example.com>", to: ["info@ballylife.com"], subject: "Bulk order", text: "Hi", headers: {}, attachments: [] });
    const r = await request(app).post("/api/marketplace/admin/inbox/sync").set(auth());
    expect(r.status).toBe(200);
    expect(r.body.data.imported).toBe(1);
    const again = await request(app).post("/api/marketplace/admin/inbox/sync").set(auth());
    expect(again.body.data.imported).toBe(0);
    const { rows } = await pool.query(`SELECT counterpart_email FROM email_threads WHERE subject = 'Bulk order'`);
    expect(rows).toEqual([{ counterpart_email: "thandi@example.com" }]);
  });
});

describe("Departments: managers only use their department's addresses", () => {
  let superToken: string, ordersToken: string, ordersManagerId: string, deptId: string;
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    const hash = await bcrypt.hash("Passw0rd!23", 10);
    await pool.query(`INSERT INTO users (username, password_hash, role, name, email) VALUES
      ('boss','${hash}','super_admin','Boss','boss@example.com'), ('ordersmgr','${hash}','marketplace_admin','Orders Person','orders.person@example.com')`);
    superToken = (await request(app).post("/api/auth/login").send({ username: "boss", password: "Passw0rd!23" })).body.data.token;
    ordersToken = (await request(app).post("/api/auth/login").send({ username: "ordersmgr", password: "Passw0rd!23" })).body.data.token;
    ordersManagerId = (await pool.query(`SELECT id FROM users WHERE username = 'ordersmgr'`)).rows[0].id;
  });

  it("only the super admin can create departments, with valid @ballylife.com addresses", async () => {
    expect((await request(app).post("/api/marketplace/admin/departments").set(auth()).send({ name: "Orders", mailboxes: ["orders@ballylife.com"] })).status).toBe(403);
    expect((await request(app).post("/api/marketplace/admin/departments").set(as(superToken)).send({ name: "Orders", mailboxes: ["orders@gmail.com"] })).status).toBe(400);
    const r = await request(app).post("/api/marketplace/admin/departments").set(as(superToken))
      .send({ name: "Customer Service", mailboxes: ["orders@ballylife.com", "Support@ballylife.com"], memberIds: [ordersManagerId] });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ name: "Customer Service", mailboxes: ["orders@ballylife.com", "support@ballylife.com"], members: [{ username: "ordersmgr" }] });
    deptId = r.body.data.id;
  });

  it("a department manager sees and uses only the department's addresses", async () => {
    const mb = await request(app).get("/api/marketplace/admin/inbox/mailboxes").set(as(ordersToken));
    expect(mb.body.data.mailboxes.map((m: { address: string }) => m.address)).toEqual(["orders@ballylife.com", "support@ballylife.com"]);
    expect(mb.body.data.access).toEqual({ all: false, departments: ["Customer Service"], isSuperAdmin: false });

    const list = await request(app).get("/api/marketplace/admin/inbox/threads?status=").set(as(ordersToken));
    expect(list.body.data.length).toBeGreaterThan(0);
    expect(list.body.data.every((t: { mailbox: string }) => t.mailbox === "orders@ballylife.com")).toBe(true);
    expect((await request(app).get("/api/marketplace/admin/inbox/threads?mailbox=legal@ballylife.com").set(as(ordersToken))).body.data).toEqual([]);

    const { rows: legal } = await pool.query(`SELECT id FROM email_threads WHERE mailbox = 'legal@ballylife.com' LIMIT 1`);
    expect((await request(app).get(`/api/marketplace/admin/inbox/threads/${legal[0].id}`).set(as(ordersToken))).status).toBe(404);
    expect((await request(app).post(`/api/marketplace/admin/inbox/threads/${legal[0].id}/reply`).set(as(ordersToken)).send({ text: "x" })).status).toBe(404);
    expect((await request(app).post("/api/marketplace/admin/inbox/compose").set(as(ordersToken))
      .send({ mailbox: "legal@ballylife.com", to: "a@b.co", subject: "x", text: "x" })).status).toBe(403);
    expect((await request(app).post("/api/marketplace/admin/inbox/compose").set(as(ordersToken))
      .send({ mailbox: "support@ballylife.com", to: "a@b.co", subject: "Hello", text: "Hi" })).status).toBe(200);
  });

  it("managers outside every department see nothing once departments exist; the super admin sees everything", async () => {
    const outsider = await request(app).get("/api/marketplace/admin/inbox/mailboxes").set(auth());
    expect(outsider.body.data.mailboxes).toEqual([]);
    expect((await request(app).get("/api/marketplace/admin/inbox/threads?status=").set(auth())).body.data).toEqual([]);
    const boss = await request(app).get("/api/marketplace/admin/inbox/mailboxes").set(as(superToken));
    expect(boss.body.data.access.all).toBe(true);
    expect(boss.body.data.mailboxes.map((m: { address: string }) => m.address)).toEqual(expect.arrayContaining(["info@ballylife.com", "legal@ballylife.com", "orders@ballylife.com"]));
  });

  it("shows Resend's delivery status for emails we sent", async () => {
    const { rows } = await pool.query(`SELECT t.id FROM email_threads t JOIN email_messages m ON m.thread_id = t.id WHERE m.auto_reply = true LIMIT 1`);
    const t = await request(app).get(`/api/marketplace/admin/inbox/threads/${rows[0].id}`).set(as(superToken));
    expect(t.body.data.messages.find((m: { autoReply: boolean }) => m.autoReply).deliveryStatus).toBe("delivered");
  });

  it("the super admin can move people and addresses, or delete the department", async () => {
    const r = await request(app).patch(`/api/marketplace/admin/departments/${deptId}`).set(as(superToken)).send({ mailboxes: ["legal@ballylife.com"], memberIds: [] });
    expect(r.body.data).toMatchObject({ mailboxes: ["legal@ballylife.com"], members: [] });
    expect((await request(app).delete(`/api/marketplace/admin/departments/${deptId}`).set(as(superToken))).status).toBe(200);
    // No departments left: managers have full access again.
    expect((await request(app).get("/api/marketplace/admin/inbox/mailboxes").set(auth())).body.data.access.all).toBe(true);
  });
});

describe("Attachments, read receipts and email health", () => {
  const pdf = Buffer.from("%PDF-1.4 quote for chairs").toString("base64");
  let threadId: string;

  beforeAll(async () => {
    await deliver("in_att_1", {
      from: "Chanda <chanda@example.com>", to: ["b2b@ballylife.com"], subject: "Quote please", text: "Send me a quote.",
      message_id: "<att-1@example.com>", headers: { from: "Chanda <chanda@example.com>" }, attachments: [],
    });
    const { rows } = await pool.query(`SELECT id FROM email_threads WHERE counterpart_email = 'chanda@example.com'`);
    threadId = rows[0].id;
  });

  it("sends a reply with a document attached and lists it in the conversation", async () => {
    const r = await request(app).post(`/api/marketplace/admin/inbox/threads/${threadId}/reply`).set(auth())
      .send({ text: "Quote attached.", attachments: [{ filename: "Quote BL.pdf", contentBase64: pdf }] });
    expect(r.status).toBe(200);
    expect(sent[0].attachments).toEqual([{ filename: "Quote BL.pdf", content: pdf, content_type: "application/pdf" }]);
    expect(sent[0].text).toBe("Quote attached.");     // plain-text version always included
    expect(sent[0].html).toMatch(/^<!doctype html><html lang="en">/);
    const out = r.body.data.messages.filter((m: { direction: string; autoReply: boolean }) => m.direction === "out" && !m.autoReply).pop();
    expect(out.attachments).toEqual([expect.objectContaining({ filename: "Quote BL.pdf", contentType: "application/pdf" })]);
  });

  it("can send attachments with no message text", async () => {
    const r = await request(app).post(`/api/marketplace/admin/inbox/threads/${threadId}/reply`).set(auth())
      .send({ text: "", attachments: [{ filename: "price-list.xlsx", contentBase64: Buffer.from("PK..").toString("base64") }] });
    expect(r.status).toBe(200);
    expect(sent[0].text).toBe("Please find the attached document(s).");
  });

  it("new emails carry attachments too", async () => {
    const r = await request(app).post("/api/marketplace/admin/inbox/compose").set(auth())
      .send({ mailbox: "b2b@ballylife.com", to: "buyer@example.com", subject: "Catalogue", text: "Hi", attachments: [{ filename: "catalogue.pdf", contentBase64: pdf }] });
    expect(r.status).toBe(200);
    expect(sent[0].attachments?.[0].filename).toBe("catalogue.pdf");
  });

  it("refuses programs, renamed programs, too many or too large files", async () => {
    const send = (attachments: unknown) => request(app).post(`/api/marketplace/admin/inbox/threads/${threadId}/reply`).set(auth()).send({ text: "x", attachments });
    expect((await send([{ filename: "setup.exe", contentBase64: pdf }])).body.error).toMatch(/can't be attached/);
    expect((await send([{ filename: "invoice.pdf", contentBase64: Buffer.from("MZ\x90\x00binary").toString("base64") }])).body.error).toMatch(/isn't a document/);
    expect((await send(Array.from({ length: 6 }, (_, i) => ({ filename: `f${i}.pdf`, contentBase64: pdf })))).status).toBe(400);
    expect((await send([{ filename: "big.pdf", contentBase64: Buffer.alloc(11 * 1024 * 1024, 1).toString("base64") }])).body.error).toMatch(/10 MB/);
    expect(sent).toHaveLength(0);
  });

  it("marks a sent email Read when Resend reports it opened, and never moves it back", async () => {
    const { rows } = await pool.query(`SELECT provider_id FROM email_messages WHERE thread_id = $1 AND direction = 'out' AND auto_reply = false ORDER BY created_at LIMIT 1`, [threadId]);
    const id = rows[0].provider_id;
    expect((await signedPost({ type: "email.opened", created_at: "2026-10-08T10:00:00Z", data: { email_id: id, created_at: "2026-10-08T10:00:00Z" } })).status).toBe(200);
    await signedPost({ type: "email.delivered", data: { email_id: id } }); // arrives late: ignored
    let t = await request(app).get(`/api/marketplace/admin/inbox/threads/${threadId}`).set(auth());
    let m = t.body.data.messages.find((x: { direction: string; autoReply: boolean }) => x.direction === "out" && !x.autoReply);
    expect(m.deliveryStatus).toBe("opened");
    expect(new Date(m.openedAt).toISOString()).toBe("2026-10-08T10:00:00.000Z");

    // A spam complaint still wins over "read".
    await signedPost({ type: "email.complained", data: { email_id: id } });
    t = await request(app).get(`/api/marketplace/admin/inbox/threads/${threadId}`).set(auth());
    m = t.body.data.messages.find((x: { direction: string; autoReply: boolean }) => x.direction === "out" && !x.autoReply);
    expect(m.deliveryStatus).toBe("complained");
    expect(m.openedAt).toBeTruthy();
  });

  it("ignores delivery events for emails it didn't send, and unsigned ones", async () => {
    expect((await signedPost({ type: "email.opened", data: { email_id: "someone_else" } })).status).toBe(200);
    expect((await request(app).post("/api/email/inbound").send({ type: "email.opened", data: { email_id: "x" } })).status).toBe(401);
  });

  it("reports email health and switches read tracking on", async () => {
    const h = await request(app).get("/api/marketplace/admin/inbox/deliverability").set(auth());
    expect(h.status).toBe(200);
    const byKey = Object.fromEntries(h.body.data.checks.map((c: { key: string; ok: boolean }) => [c.key, c.ok]));
    expect(byKey).toMatchObject({ domain: true, spf: true, dkim: false });
    expect(h.body.data.readTracking).toBe(false);

    const on = await request(app).post("/api/marketplace/admin/inbox/read-tracking").set(auth()).send({ on: true });
    expect(on.status).toBe(200);
    expect(on.body.data.readTracking).toBe(true);
    expect(receivingOn).toBe(true); // switching tracking on doesn't touch receiving
  });
});
