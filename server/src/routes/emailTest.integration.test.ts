import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import request from "supertest";
import express, { type Express } from "express";
import bcrypt from "bcryptjs";
import { createTestDb } from "../test/testDb";

const { pool } = createTestDb();
vi.mock("../db/pool", () => ({ pool, hasDb: true }));

let app: Express;
let adminToken: string;
let customerToken: string;

beforeAll(async () => {
  const authRouter = (await import("./authRouter")).default;
  const marketplaceRouter = (await import("./marketplaceRouter")).default;
  app = express();
  app.use(express.json());
  app.use("/api/auth", authRouter);
  app.use("/api/marketplace", marketplaceRouter);
  const hash = await bcrypt.hash("Passw0rd!23", 10);
  await pool.query(`INSERT INTO users (username, password_hash, role, name, email) VALUES ('mailadmin','${hash}','marketplace_admin','Vincent Kafula','manager@example.com'), ('mailcust','${hash}','customer','C','cust@example.com')`);
  adminToken = (await request(app).post("/api/auth/login").send({ username: "mailadmin", password: "Passw0rd!23" })).body.data.token;
  customerToken = (await request(app).post("/api/auth/login").send({ username: "mailcust", password: "Passw0rd!23" })).body.data?.token ?? "";
});
afterEach(() => { vi.unstubAllGlobals(); delete process.env.RESEND_API_KEY; });

describe("Manager email check", () => {
  it("shows email as off without a key, and won't 'send'", async () => {
    const s = await request(app).get("/api/marketplace/admin/email/status").set("Authorization", `Bearer ${adminToken}`);
    expect(s.body.data).toMatchObject({ configured: false, provider: null });
    const t = await request(app).post("/api/marketplace/admin/email/test").set("Authorization", `Bearer ${adminToken}`);
    expect(t.status).toBe(503);
  });

  it("sends the test only to the signed-in manager, through Resend", async () => {
    process.env.RESEND_API_KEY = "re_test";
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ id: "e1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    const s = await request(app).get("/api/marketplace/admin/email/status").set("Authorization", `Bearer ${adminToken}`);
    expect(s.body.data).toMatchObject({ configured: true, provider: "resend" });
    expect(JSON.stringify(s.body)).not.toContain("re_test");
    const t = await request(app).post("/api/marketplace/admin/email/test").set("Authorization", `Bearer ${adminToken}`).send({ to: "someone-else@example.com" });
    expect(t.status).toBe(200);
    expect(t.body.data.to).toBe("manager@example.com");
    expect(JSON.parse(String((fetchSpy.mock.calls[0] as unknown as [string, RequestInit])[1].body)).to).toEqual(["manager@example.com"]);
  });

  it("is manager-only", async () => {
    const r = await request(app).post("/api/marketplace/admin/email/test").set("Authorization", `Bearer ${customerToken}`);
    expect([401, 403]).toContain(r.status);
  });
});
