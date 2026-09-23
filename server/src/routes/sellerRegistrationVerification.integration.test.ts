import { describe, it, expect, beforeAll, vi } from "vitest";
import request from "supertest";
import crypto from "crypto";
import express, { type Express } from "express";
import { createTestDb } from "../test/testDb";

const { pool } = createTestDb();
vi.mock("../db/pool", () => ({ pool, hasDb: true }));

let app: Express;
beforeAll(async () => {
  const authRouter = (await import("./authRouter")).default;
  const marketplaceRouter = (await import("./marketplaceRouter")).default;
  app = express();
  app.use(express.json());
  app.use("/api/auth", authRouter);
  app.use("/api/marketplace", marketplaceRouter);
});

describe("POST /api/marketplace/sellers/register -- real verification, not simulated (Phase: seller OTP)", () => {
  it("creates the account as genuinely unverified, but still returns a usable token immediately", async () => {
    const res = await request(app).post("/api/marketplace/sellers/register").send({
      username: "sellerverifytest1", password: "SecurePass123", name: "Seller One", email: "sellerverify1@example.com", storeName: "Seller Verify Store 1",
    });
    expect(res.status).toBe(201);
    expect(res.body.token).toBeTruthy(); // deliberately still issued -- see marketplaceRouter.ts's comment on why
    expect(res.body.user.emailVerified).toBe(false);
    expect(res.body.user.accountStatus).toBe("unverified");

    // A working session despite being unverified -- this is the
    // documented, deliberate trade-off (KYC document upload needs it),
    // not an oversight; confirmed the token actually works, not just
    // that one was returned.
    const me = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${res.body.token}`);
    expect(me.status).toBe(200);
    expect(me.body.data.username).toBe("sellerverifytest1");
  });

  it("genuinely creates a findable email-verification token -- not a UI-only toggle", async () => {
    const res = await request(app).post("/api/marketplace/sellers/register").send({
      username: "sellerverifytest2", password: "SecurePass123", name: "Seller Two", email: "sellerverify2@example.com", storeName: "Seller Verify Store 2",
    });
    const { rows } = await pool.query(
      `SELECT 1 FROM email_verification_tokens WHERE user_id = $1 AND used_at IS NULL AND expires_at > now()`,
      [res.body.user.id]
    );
    expect(rows.length).toBe(1);
  });

  it("when a phone is given, genuinely creates a findable phone OTP too", async () => {
    const res = await request(app).post("/api/marketplace/sellers/register").send({
      username: "sellerverifytest3", password: "SecurePass123", name: "Seller Three", email: "sellerverify3@example.com", storeName: "Seller Verify Store 3", phone: "+27821234567",
    });
    const { rows } = await pool.query(
      `SELECT 1 FROM phone_verification_codes WHERE user_id = $1 AND used_at IS NULL AND expires_at > now()`,
      [res.body.user.id]
    );
    expect(rows.length).toBe(1);
  });

  it("the SAME /verify-email route customers use also works for a seller account -- one real implementation, not a separate/parallel one", async () => {
    const res = await request(app).post("/api/marketplace/sellers/register").send({
      username: "sellerverifytest4", password: "SecurePass123", name: "Seller Four", email: "sellerverify4@example.com", storeName: "Seller Verify Store 4",
    });
    const userId = res.body.user.id;

    const rawToken = crypto.randomBytes(16).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    await pool.query(`UPDATE email_verification_tokens SET token_hash = $1 WHERE user_id = $2`, [tokenHash, userId]);

    const verifyRes = await request(app).post("/api/auth/verify-email").send({ token: rawToken });
    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.data.user.emailVerified).toBe(true);
    expect(verifyRes.body.data.user.role).toBe("seller"); // still a seller account, verify-email doesn't touch role
    expect(verifyRes.body.data.user.accountStatus).toBe("active"); // no phone given, email alone is sufficient
  });
});
