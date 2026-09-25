import { describe, it, expect, beforeAll, vi } from "vitest";
import request from "supertest";
import express, { type Express } from "express";
import bcrypt from "bcryptjs";
import { createTestDb } from "../test/testDb";

// Deliberately NOT setting CJ_EMAIL/CJ_API_KEY here -- this file
// represents this app's real, current environment (same pattern as
// authRouter.integration.test.ts's own "not configured" OAuth
// coverage, kept in a separate file for the same reason: these vars
// are read once at module load, so toggling them within one file that
// also needs them set isn't reliable).

const { pool } = createTestDb();
vi.mock("../db/pool", () => ({ pool, hasDb: true }));

let app: Express;
let adminToken: string;

beforeAll(async () => {
  const authRouter = (await import("./authRouter")).default;
  const cjRouter = (await import("./cjDropshippingRouter")).default;
  app = express();
  app.use(express.json());
  app.use("/api/auth", authRouter);
  app.use("/api/marketplace", cjRouter);

  const adminHash = await bcrypt.hash("AdminPass123", 10);
  await pool.query(`INSERT INTO users (username, password_hash, role, name, email) VALUES ('cjadmin2','${adminHash}','marketplace_admin','CJ Admin','cjadmin2@example.com')`);
  const adminLogin = await request(app).post("/api/auth/login").send({ username: "cjadmin2", password: "AdminPass123" });
  adminToken = adminLogin.body.data.token;
});

describe("CJdropshipping routes with no credentials configured (this app's real, current state)", () => {
  it("status correctly reports not configured", async () => {
    const res = await request(app).get("/api/marketplace/admin/cj/status").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.configured).toBe(false);
  });

  it("sync returns a clean 503, not a crash or a confusing generic error", async () => {
    const res = await request(app).post("/api/marketplace/admin/cj/sync").set("Authorization", `Bearer ${adminToken}`).send({});
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/isn't configured/i);
  });

  it("categories returns a clean 503", async () => {
    const res = await request(app).get("/api/marketplace/admin/cj/categories").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(503);
  });

  it("product detail returns a clean 503", async () => {
    const res = await request(app).get("/api/marketplace/admin/cj/products/some-pid").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(503);
  });
});
