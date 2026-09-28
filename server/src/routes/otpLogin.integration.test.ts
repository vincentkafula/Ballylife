import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import request from "supertest";
import express, { type Express } from "express";
import { createTestDb } from "../test/testDb";

const { pool } = createTestDb();
vi.mock("../db/pool", () => ({ pool, hasDb: true }));

// Fake WhatsApp: records template sends (the code is in the body parameter).
type Sent = { to: string; template: string; bodyParam: string; buttonParam: string };
let sent: Sent[] = [];
function fakeWhatsApp() {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/messages")) {
      const b = JSON.parse(String(init!.body));
      const comps = b.template?.components ?? [];
      sent.push({
        to: b.to, template: b.template?.name,
        bodyParam: comps.find((c: any) => c.type === "body")?.parameters?.[0]?.text,
        buttonParam: comps.find((c: any) => c.type === "button")?.parameters?.[0]?.text,
      });
      return new Response(JSON.stringify({ messages: [{ id: `wamid.${sent.length}` }] }), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  }));
}

let app: Express;
const lastCode = () => sent[sent.length - 1]?.bodyParam;

beforeAll(async () => {
  process.env.WHATSAPP_TOKEN = "t"; process.env.WHATSAPP_PHONE_NUMBER_ID = "1";
  process.env.OTP_REQUESTS_PER_MINUTE = "100"; // the per-minute limit is tested by express-rate-limit itself
  fakeWhatsApp();
  const authRouter = (await import("./authRouter")).default;
  app = express();
  app.use(express.json());
  app.use("/api/auth", authRouter);
  await pool.query(`INSERT INTO users (username, password_hash, role, name, email, phone, phone_verified, account_status) VALUES
    ('naledi', 'x', 'customer', 'Naledi M', 'naledi@example.com', '0821234567', false, 'active'),
    ('gone', 'x', 'customer', 'Gone', 'gone@example.com', '0831112222', true, 'removed')`);
});
beforeEach(() => { sent = []; });

describe("Sign in with a WhatsApp code", () => {
  it("isn't offered until the WhatsApp code template is approved (or SMS is set up)", async () => {
    expect((await request(app).get("/api/auth/otp/available")).body.data).toEqual({ available: false, channel: null });
    expect((await request(app).post("/api/auth/otp/request").send({ phone: "0821234567" })).status).toBe(503);
    const { _setWhatsAppOtpReadyForTests } = await import("../services/otpDelivery");
    _setWhatsAppOtpReadyForTests(true);
    expect((await request(app).get("/api/auth/otp/available")).body.data).toEqual({ available: true, channel: "whatsapp" });
  });

  it("sends a 6-digit code on WhatsApp with a Copy code button, and never logs the code", async () => {
    const r = await request(app).post("/api/auth/otp/request").send({ phone: "+27 82 123 4567" });
    expect(r.body.success).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: "27821234567", template: "ballylife_verification_code" });
    expect(lastCode()).toMatch(/^\d{6}$/);
    expect(sent[0].buttonParam).toBe(lastCode());
    const { rows } = await pool.query(`SELECT body FROM wa_messages`);
    expect(rows.every((m: any) => !String(m.body ?? "").includes(lastCode()!))).toBe(true);
  });

  it("gives the same answer for unknown and closed accounts, and sends nothing", async () => {
    const known = (await request(app).post("/api/auth/otp/request").send({ phone: "0829999999" })).body;
    const closed = (await request(app).post("/api/auth/otp/request").send({ phone: "0831112222" })).body;
    expect(known).toEqual(closed);
    expect(sent).toHaveLength(0);
  });

  it("waits 60 seconds between codes", async () => {
    await request(app).post("/api/auth/otp/request").send({ phone: "0821234567" });
    expect(sent).toHaveLength(0);
  });

  it("signs in with the right code once, marks the phone verified, and rejects reuse", async () => {
    await pool.query(`UPDATE phone_verification_codes SET created_at = $1`, [new Date(Date.now() - 120_000)]); // past the cooldown
    await request(app).post("/api/auth/otp/request").send({ phone: "0821234567" });
    const code = lastCode()!;
    const wrong = await request(app).post("/api/auth/otp/verify").send({ phone: "0821234567", code: code === "111111" ? "222222" : "111111" });
    expect(wrong.status).toBe(400);
    const ok = await request(app).post("/api/auth/otp/verify").send({ phone: "082 123 4567", code });
    expect(ok.status).toBe(200);
    expect(ok.body.data.token).toBeTruthy();
    expect(ok.body.data.user.username).toBe("naledi");
    expect((await pool.query(`SELECT phone_verified FROM users WHERE username = 'naledi'`)).rows[0].phone_verified).toBe(true);
    expect((await request(app).post("/api/auth/otp/verify").send({ phone: "0821234567", code })).status).toBe(400);
  });

  it("locks a code after 5 wrong tries", async () => {
    await pool.query(`UPDATE phone_verification_codes SET created_at = $1`, [new Date(Date.now() - 120_000)]);
    await request(app).post("/api/auth/otp/request").send({ phone: "0821234567" });
    const code = lastCode()!;
    const bad = code === "000000" ? "999999" : "000000";
    for (let i = 0; i < 5; i++) await request(app).post("/api/auth/otp/verify").send({ phone: "0821234567", code: bad });
    const r = await request(app).post("/api/auth/otp/verify").send({ phone: "0821234567", code });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/Too many incorrect attempts/);
  });

  it("once codes can be sent, new accounts with a phone must verify it", async () => {
    const { computeAccountStatus } = await import("../services/accountVerification");
    expect(computeAccountStatus(true, false, true)).toBe("partially_verified");
    expect(computeAccountStatus(true, true, true)).toBe("active");
  });
});
