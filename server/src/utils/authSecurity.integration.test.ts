import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import request from "supertest";
import express, { type Express } from "express";
import bcrypt from "bcryptjs";
import { createTestDb } from "../test/testDb";
import { passwordProblem, _resetLoginThrottleForTests } from "./authSecurity";

const { pool } = createTestDb();
vi.mock("../db/pool", () => ({ pool, hasDb: true }));

let app: Express;

beforeAll(async () => {
  const authRouter = (await import("../routes/authRouter")).default;
  app = express();
  app.use(express.json());
  app.use("/api/auth", authRouter);
  // An account hashed at a lower work factor than current, and demo accounts on the public default password.
  await pool.query(`INSERT INTO users (username, password_hash, role, name, email) VALUES
    ('oldhash', $1, 'customer', 'Old', 'old@example.com'),
    ('admin', $2, 'marketplace_admin', 'Admin', 'admin@example.com'),
    ('shipping1', $2, 'shipping_company', 'Ship', 'ship@example.com')`,
    [await bcrypt.hash("CorrectPass123", 4), await bcrypt.hash("Ballylife@2026", 4)]);
});
beforeEach(() => _resetLoginThrottleForTests());

const login = (username: string, password: string) => request(app).post("/api/auth/login").send({ username, password });

describe("login hardening", () => {
  it("locks an account after 5 failures, whatever the IP, and doesn't reveal whether it exists", async () => {
    for (let i = 0; i < 5; i++) expect((await login("oldhash", "wrong-" + i)).status).toBe(401);
    const locked = await login("oldhash", "CorrectPass123");
    expect(locked.status).toBe(429);
    expect(locked.body.error).toMatch(/Too many failed attempts/);

    // Unknown usernames fail the same way (and are throttled the same way).
    const unknown = await login("nobody-here", "whatever-123");
    expect(unknown.status).toBe(401);
    expect(unknown.body.error).toBe("Invalid username or password");
  });

  it("upgrades an old password hash to the current work factor on a successful login", async () => {
    const res = await login("oldhash", "CorrectPass123");
    expect(res.status).toBe(200);
    const { rows } = await pool.query(`SELECT password_hash FROM users WHERE username = 'oldhash'`);
    expect(bcrypt.getRounds(rows[0].password_hash)).toBe(Number(process.env.BCRYPT_COST));
  });

  it("tells the frontend when someone logs in with the public default password", async () => {
    const res = await login("admin", "Ballylife@2026");
    expect(res.status).toBe(200);
    expect(res.body.data.user.mustChangePassword).toBe(true);
  });
});

describe("password policy", () => {
  it("rejects short, common and identity-based passwords", () => {
    expect(passwordProblem("short")).toMatch(/at least 8/);
    expect(passwordProblem("Password123")).toMatch(/too common/);
    expect(passwordProblem("aaaaaaaaaa")).toMatch(/repeated/);
    expect(passwordProblem("thandi-2026!", "thandi", "thandi@example.com")).toMatch(/username or email/);
    expect(passwordProblem("Correct-Horse-9")).toBeNull();
  });

  it("is enforced at registration", async () => {
    const res = await request(app).post("/api/auth/register").send({ username: "newbie", password: "password123", name: "N", email: "newbie@example.com" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/too common/);
  });
});

describe("demo accounts on a live store", () => {
  it("locks non-admin demo accounts still on the public password, and only reports admin", async () => {
    const prev = process.env.DEMO_MODE;
    process.env.DEMO_MODE = "false";
    const { secureDemoAccounts } = await import("../services/demoAccounts");
    const r = await secureDemoAccounts();
    process.env.DEMO_MODE = prev;

    expect(r.locked).toEqual(["shipping1"]);
    expect(r.adminOnDefault).toBe(true);
    expect((await login("shipping1", "Ballylife@2026")).status).toBe(401);
    expect((await login("admin", "Ballylife@2026")).status).toBe(200); // never locked out of their own store
  });
});
