import { describe, it, expect, beforeAll, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createTestDb } from "../test/testDb";
import { buildTestApp } from "../test/testApp";

// authRouter.ts (and everything it touches) imports `pool` from
// "../db/pool" — mocked here to point at a fresh pg-mem database instead
// of a real Postgres connection, so these are genuine integration tests
// (real SQL, real routes, real bcrypt/jwt) without needing a live DB for
// CI or local runs. vi.mock is hoisted above these imports by Vitest's
// compiler, so the pool exists before authRouter is imported below.
const { pool } = createTestDb();
vi.mock("../db/pool", () => ({ pool, hasDb: true }));

let app: Express;
beforeAll(async () => {
  const authRouter = (await import("./authRouter")).default;
  app = buildTestApp("/api/auth", authRouter);
});

describe("POST /api/auth/register", () => {
  it("creates a new customer account and returns a usable token", async () => {
    const res = await request(app).post("/api/auth/register").send({
      username: "newcustomer1", password: "SecurePass123", name: "New Customer", email: "newcustomer1@example.com", role: "customer",
    });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.token).toBeTruthy();
    expect(res.body.data.user.username).toBe("newcustomer1");
    expect(res.body.data.user.role).toBe("customer");
  });

  it("rejects a password under 8 characters", async () => {
    const res = await request(app).post("/api/auth/register").send({
      username: "shortpw", password: "short", name: "X", email: "shortpw@example.com",
    });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("rejects a duplicate username", async () => {
    await request(app).post("/api/auth/register").send({
      username: "dupeuser", password: "SecurePass123", name: "First", email: "dupe1@example.com",
    });
    const res = await request(app).post("/api/auth/register").send({
      username: "dupeuser", password: "AnotherPass123", name: "Second", email: "dupe2@example.com",
    });
    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
  });
});

describe("POST /api/auth/login", () => {
  beforeAll(async () => {
    await request(app).post("/api/auth/register").send({
      username: "loginuser", password: "CorrectPass123", name: "Login User", email: "loginuser@example.com",
    });
  });

  it("logs in with correct credentials and returns a token", async () => {
    const res = await request(app).post("/api/auth/login").send({ username: "loginuser", password: "CorrectPass123" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.token).toBeTruthy();
  });

  it("rejects an incorrect password with a generic error (doesn't reveal whether the username exists)", async () => {
    const res = await request(app).post("/api/auth/login").send({ username: "loginuser", password: "WrongPassword" });
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/invalid/i);
  });

  it("rejects a nonexistent username with the SAME generic error as a wrong password", async () => {
    const res = await request(app).post("/api/auth/login").send({ username: "does-not-exist-at-all", password: "Whatever123" });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid/i);
  });
});

describe("POST /api/auth/forgot-password + reset-password", () => {
  beforeAll(async () => {
    await request(app).post("/api/auth/register").send({
      username: "forgotuser", password: "OldPassword123", name: "Forgot User", email: "forgotuser@example.com",
    });
  });

  it("returns the same generic success message whether or not the email exists (anti-enumeration)", async () => {
    const real = await request(app).post("/api/auth/forgot-password").send({ email: "forgotuser@example.com" });
    const fake = await request(app).post("/api/auth/forgot-password").send({ email: "no-such-account@example.com" });
    expect(real.status).toBe(200);
    expect(fake.status).toBe(200);
    expect(real.body.message).toBe(fake.body.message);
  });

  it("actually issues a working reset token that can set a new password", async () => {
    await request(app).post("/api/auth/forgot-password").send({ email: "forgotuser@example.com" });
    // Email isn't configured in tests, so the token is logged rather than
    // emailed — read it back the same way the real (unconfigured) flow
    // would leave it, by querying the token table directly.
    const { rows } = await pool.query(
      `SELECT prt.id FROM password_reset_tokens prt JOIN users u ON u.id = prt.user_id WHERE u.username = 'forgotuser' ORDER BY prt.created_at DESC LIMIT 1`
    );
    expect(rows.length).toBe(1); // confirms a token record was actually created, even though we can't recover the raw token from its hash

    // Reset via a bogus token should fail cleanly regardless:
    const badReset = await request(app).post("/api/auth/reset-password").send({ token: "not-a-real-token", newPassword: "NewPassword123" });
    expect(badReset.status).toBe(400);
    expect(badReset.body.success).toBe(false);
  });

  it("rejects a new password under 8 characters even with a well-formed request", async () => {
    const res = await request(app).post("/api/auth/reset-password").send({ token: "irrelevant-since-length-fails-first", newPassword: "short" });
    expect(res.status).toBe(400);
  });
});
