import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { vi } from "vitest";
import request from "supertest";
import express, { type Express } from "express";
import bcrypt from "bcryptjs";
import { createTestDb } from "../test/testDb";
import { registerAndVerifyCustomer } from "../test/authHelpers";

const { pool } = createTestDb();
vi.mock("../db/pool", () => ({ pool, hasDb: true }));

let app: Express;
let sa: typeof import("./superAdmin");
let managerToken: string;
let customer: { token: string; userId: string; username: string };
let sellerUser: { token: string; userId: string; username: string };

const SUPER = { SUPER_ADMIN_USERNAME: "owner", SUPER_ADMIN_PASSWORD: "Correct-Horse-Battery-9", SUPER_ADMIN_EMAIL: "owner@ballylife.test", SUPER_ADMIN_NAME: "Owner" };
const setEnv = (vars: Record<string, string | undefined>) => { for (const [k, v] of Object.entries(vars)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } };
const login = (username: string, password: string) => request(app).post("/api/auth/login").send({ username, password });
const as = (token: string) => ({ Authorization: `Bearer ${token}` });
const user = async (username: string) => (await pool.query(`SELECT * FROM users WHERE username = $1`, [username])).rows[0];

beforeAll(async () => {
  sa = await import("./superAdmin");
  const authRouter = (await import("../routes/authRouter")).default;
  const marketplaceRouter = (await import("../routes/marketplaceRouter")).default;
  const superAdminRouter = (await import("../routes/superAdminRouter")).default;
  app = express();
  app.use(express.json());
  app.use("/api/auth", authRouter);
  app.use("/api/marketplace", marketplaceRouter);
  app.use("/api/marketplace", superAdminRouter);

  const hash = await bcrypt.hash("ManagerPass123", 5);
  await pool.query(`INSERT INTO users (username, password_hash, role, name, email) VALUES ('mgr1', '${hash}', 'marketplace_admin', 'Manager One', 'mgr1@example.com')`);
  managerToken = (await login("mgr1", "ManagerPass123")).body.data.token;
  customer = await registerAndVerifyCustomer(app, pool, { username: "buyer1", email: "buyer1@example.com" });
  sellerUser = await registerAndVerifyCustomer(app, pool, { username: "seller1", email: "seller1@example.com" });
  await pool.query(`UPDATE users SET role = 'seller' WHERE id = $1`, [sellerUser.userId]);
  await pool.query(`INSERT INTO mkt_sellers (id, user_id, store_name, store_slug, status) VALUES ('sel-x', $1, 'Seller One', 'seller-one', 'active')`, [sellerUser.userId]);
  await pool.query(`INSERT INTO mkt_categories (id, name, slug, icon) VALUES ('cat-01','Electronics','electronics','📱')`);
  await pool.query(`INSERT INTO mkt_products (seller_id, category_id, name, slug, price, images, status, stock) VALUES ('sel-x','cat-01','Gadget','gadget',100,'[]','active',5)`);
});
afterEach(() => setEnv({ SUPER_ADMIN_USERNAME: undefined, SUPER_ADMIN_PASSWORD: undefined, SUPER_ADMIN_EMAIL: undefined, SUPER_ADMIN_NAME: undefined }));

describe("Super admin from Railway variables", () => {
  it("does nothing when the variables aren't set", async () => {
    expect(await sa.ensureSuperAdminFromEnv()).toBe("not_configured");
  });

  it("refuses a weak password and creates nothing", async () => {
    setEnv({ ...SUPER, SUPER_ADMIN_PASSWORD: "short1" });
    expect(await sa.ensureSuperAdminFromEnv()).toBe("invalid");
    expect(await user("owner")).toBeUndefined();
  });

  it("creates the account at boot, which can sign in", async () => {
    setEnv(SUPER);
    expect(await sa.ensureSuperAdminFromEnv()).toBe("created");
    expect(await user("owner")).toMatchObject({ role: "super_admin", account_status: "active", email: "owner@ballylife.test" });
    const res = await login("owner", SUPER.SUPER_ADMIN_PASSWORD);
    expect(res.status).toBe(200);
    expect(res.body.data.user.role).toBe("super_admin");
  });

  it("is a no-op on the next boot when nothing changed", async () => {
    setEnv(SUPER);
    expect(await sa.ensureSuperAdminFromEnv()).toBe("unchanged");
  });

  it("changing SUPER_ADMIN_PASSWORD changes the password and signs out old sessions", async () => {
    setEnv(SUPER);
    const oldToken = (await login("owner", SUPER.SUPER_ADMIN_PASSWORD)).body.data.token;
    setEnv({ ...SUPER, SUPER_ADMIN_PASSWORD: "Another-Strong-Pass-42" });
    expect(await sa.ensureSuperAdminFromEnv()).toBe("updated");
    expect((await request(app).get("/api/marketplace/admin/users").set(as(oldToken))).status).toBe(401);
    expect((await login("owner", SUPER.SUPER_ADMIN_PASSWORD)).status).toBe(401);
    expect((await login("owner", "Another-Strong-Pass-42")).status).toBe(200);
    setEnv(SUPER);
    await sa.ensureSuperAdminFromEnv(); // back to the original for the tests below
  });

  it("can't change its password in the app, or get a reset link", async () => {
    const token = (await login("owner", SUPER.SUPER_ADMIN_PASSWORD)).body.data.token;
    const res = await request(app).post("/api/auth/change-password").set(as(token)).send({ currentPassword: SUPER.SUPER_ADMIN_PASSWORD, newPassword: "Whatever-New-Pass-1" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Railway/);
    await request(app).post("/api/auth/forgot-password").send({ email: "owner@ballylife.test" });
    const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM password_reset_tokens WHERE user_id = (SELECT id FROM users WHERE username = 'owner')`);
    expect(rows[0].n).toBe(0);
  });
});

describe("Managers", () => {
  const superToken = async () => (await login("owner", SUPER.SUPER_ADMIN_PASSWORD)).body.data.token as string;

  it("the super admin can use every manager screen", async () => {
    const res = await request(app).get("/api/marketplace/admin/users").set(as(await superToken()));
    expect(res.status).toBe(200);
  });

  it("a manager can no longer make someone a manager, or demote a manager", async () => {
    const promote = await request(app).patch(`/api/marketplace/admin/users/${customer.userId}/role`).set(as(managerToken)).send({ role: "marketplace_admin" });
    expect(promote.status).toBe(403);
    const mgr = await user("mgr1");
    const hash = await bcrypt.hash("ManagerPass456", 5);
    await pool.query(`INSERT INTO users (username, password_hash, role, name, email) VALUES ('mgr2', '${hash}', 'marketplace_admin', 'Manager Two', 'mgr2@example.com')`);
    const mgr2 = await user("mgr2");
    const demote = await request(app).patch(`/api/marketplace/admin/users/${mgr2.id}/role`).set(as(managerToken)).send({ role: "customer" });
    expect(demote.status).toBe(403);
    expect(mgr.role).toBe("marketplace_admin");
  });

  it("nobody can change the super admin's role", async () => {
    const owner = await user("owner");
    const res = await request(app).patch(`/api/marketplace/admin/users/${owner.id}/role`).set(as(managerToken)).send({ role: "customer" });
    expect(res.status).toBe(403);
  });

  it("the super admin adds a manager, who can then sign in", async () => {
    const res = await request(app).post("/api/marketplace/admin/managers").set(as(await superToken())).send({ username: "newmgr", name: "New Manager", email: "newmgr@example.com", password: "Temp-Pass-2026x" });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ username: "newmgr", role: "marketplace_admin" });
    expect((await login("newmgr", "Temp-Pass-2026x")).body.data.user.role).toBe("marketplace_admin");
  });

  it("rejects a weak manager password and duplicate usernames", async () => {
    const t = await superToken();
    expect((await request(app).post("/api/marketplace/admin/managers").set(as(t)).send({ username: "x2", name: "X", email: "x2@example.com", password: "password" })).status).toBe(400);
    expect((await request(app).post("/api/marketplace/admin/managers").set(as(t)).send({ username: "newmgr", name: "X", email: "other@example.com", password: "Temp-Pass-2026x" })).status).toBe(409);
  });

  it("the super admin can promote an existing account to manager, and demote it again", async () => {
    const t = await superToken();
    expect((await request(app).patch(`/api/marketplace/admin/users/${customer.userId}/role`).set(as(t)).send({ role: "marketplace_admin" })).status).toBe(200);
    expect((await request(app).patch(`/api/marketplace/admin/users/${customer.userId}/role`).set(as(t)).send({ role: "customer" })).status).toBe(200);
  });

  it("lists managers for the super admin only", async () => {
    expect((await request(app).get("/api/marketplace/admin/managers").set(as(managerToken))).status).toBe(403);
    const res = await request(app).get("/api/marketplace/admin/managers").set(as(await superToken()));
    expect(res.body.data.map((u: { username: string }) => u.username)).toEqual(expect.arrayContaining(["owner", "mgr1", "newmgr"]));
  });
});

describe("Removing accounts", () => {
  const superToken = async () => (await login("owner", SUPER.SUPER_ADMIN_PASSWORD)).body.data.token as string;

  it("only the super admin can remove accounts", async () => {
    expect((await request(app).post(`/api/marketplace/admin/users/${customer.userId}/remove`).set(as(managerToken))).status).toBe(403);
  });

  it("removing a buyer signs them out everywhere and blocks sign-in", async () => {
    const buyerToken = (await login("buyer1", "SecurePass123")).body.data.token;
    const res = await request(app).post(`/api/marketplace/admin/users/${customer.userId}/remove`).set(as(await superToken())).send({ reason: "Fraudulent chargebacks" });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ accountStatus: "removed", removalReason: "Fraudulent chargebacks" });
    expect((await request(app).get("/api/marketplace/orders").set(as(buyerToken))).status).toBe(401);
    const again = await login("buyer1", "SecurePass123");
    expect(again.status).toBe(403);
    expect(again.body.error).toMatch(/closed/);
  });

  it("a removed account can't get a password reset link", async () => {
    await request(app).post("/api/auth/forgot-password").send({ email: "buyer1@example.com" });
    const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM password_reset_tokens WHERE user_id = $1`, [customer.userId]);
    expect(rows[0].n).toBe(0);
  });

  it("removing a seller suspends their store and hides their products", async () => {
    await request(app).post(`/api/marketplace/admin/users/${sellerUser.userId}/remove`).set(as(await superToken()));
    const { rows: s } = await pool.query(`SELECT status, suspended_by_removal FROM mkt_sellers WHERE id = 'sel-x'`);
    expect(s[0]).toMatchObject({ status: "suspended", suspended_by_removal: true });
    const { rows: p } = await pool.query(`SELECT status FROM mkt_products WHERE seller_id = 'sel-x'`);
    expect(p[0].status).toBe("inactive");
  });

  it("the super admin can remove a manager", async () => {
    const mgr2 = await user("mgr2");
    expect((await request(app).post(`/api/marketplace/admin/users/${mgr2.id}/remove`).set(as(await superToken()))).status).toBe(200);
    expect((await login("mgr2", "ManagerPass456")).status).toBe(403);
  });

  it("can't remove itself", async () => {
    const owner = await user("owner");
    expect((await request(app).post(`/api/marketplace/admin/users/${owner.id}/remove`).set(as(await superToken()))).status).toBe(400);
  });

  it("a removed account's role can't be changed until it's restored", async () => {
    const res = await request(app).patch(`/api/marketplace/admin/users/${customer.userId}/role`).set(as(managerToken)).send({ role: "seller" });
    expect(res.status).toBe(409);
  });

  it("restoring reopens the account and the store it suspended", async () => {
    const t = await superToken();
    expect((await request(app).post(`/api/marketplace/admin/users/${sellerUser.userId}/restore`).set(as(t))).status).toBe(200);
    expect((await login("seller1", "SecurePass123")).status).toBe(200);
    const { rows } = await pool.query(`SELECT status, suspended_by_removal FROM mkt_sellers WHERE id = 'sel-x'`);
    expect(rows[0]).toMatchObject({ status: "active", suspended_by_removal: false });
  });

  it("every action is in the audit log", async () => {
    const { rows } = await pool.query(`SELECT action FROM mkt_audit_log WHERE entity_type = 'user'`);
    expect(rows.map(r => r.action)).toEqual(expect.arrayContaining(["super_admin_created", "manager_created", "account_removed", "account_restored"]));
  });

  it("moving SUPER_ADMIN_USERNAME to a new account demotes the old one", async () => {
    setEnv({ ...SUPER, SUPER_ADMIN_USERNAME: "owner2", SUPER_ADMIN_EMAIL: "owner2@ballylife.test" });
    await sa.ensureSuperAdminFromEnv();
    expect((await user("owner")).role).toBe("customer");
    expect((await user("owner2")).role).toBe("super_admin");
  });
});
