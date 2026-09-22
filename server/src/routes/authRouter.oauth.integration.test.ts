import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createTestDb } from "../test/testDb";
import { buildTestApp } from "../test/testApp";

// This file simulates having real Google/Facebook credentials --
// setting the env vars *before* authRouter is imported below, since
// its GOOGLE_CLIENT_ID/FACEBOOK_APP_ID/googleClient are read once at
// module load time, not on every request. authRouter.integration.test.ts
// covers the actual current environment (neither configured); this one
// proves the rest of the logic (verification, account linking, account
// creation) actually works once real credentials exist, without
// needing them to exist yet.
process.env.GOOGLE_CLIENT_ID = "test-google-client-id.apps.googleusercontent.com";
process.env.FACEBOOK_APP_ID = "test-facebook-app-id";
// Also simulated as configured (read once at module load, same as the
// two above) so this file can prove phone verification is genuinely
// still required through an OAuth link, not just when signing in with
// a password -- without this, isSmsConfigured() would be false and
// computeAccountStatus would correctly-but-uninterestingly skip the
// phone requirement entirely regardless of what this file tests.
process.env.TWILIO_ACCOUNT_SID = "test-twilio-sid";
process.env.TWILIO_AUTH_TOKEN = "test-twilio-token";
process.env.TWILIO_FROM_NUMBER = "+15017122661";

const { pool } = createTestDb();
vi.mock("../db/pool", () => ({ pool, hasDb: true }));

// google-auth-library's OAuth2Client.verifyIdToken does real JWKS/
// signature verification against Google's servers -- not something to
// exercise in a unit/integration test. Mocked so each test controls
// exactly what payload "Google" returned, the same way a real verified
// token would hand authRouter a payload.
const verifyIdToken = vi.fn();
vi.mock("google-auth-library", () => ({
  OAuth2Client: vi.fn().mockImplementation(() => ({ verifyIdToken })),
}));

let app: Express;
beforeAll(async () => {
  const authRouter = (await import("./authRouter")).default;
  app = buildTestApp("/api/auth", authRouter);
});

beforeEach(() => {
  verifyIdToken.mockReset();
  vi.unstubAllGlobals();
});

describe("GET /api/auth/oauth-config -- configured", () => {
  it("reports both providers enabled", async () => {
    const res = await request(app).get("/api/auth/oauth-config");
    expect(res.body.data).toEqual({ googleEnabled: true, facebookEnabled: true });
  });
});

describe("POST /api/auth/google", () => {
  it("rejects a request with no credential", async () => {
    const res = await request(app).post("/api/auth/google").send({});
    expect(res.status).toBe(400);
  });

  it("rejects a credential that fails verification", async () => {
    verifyIdToken.mockRejectedValue(new Error("invalid token signature"));
    const res = await request(app).post("/api/auth/google").send({ credential: "bad-token" });
    expect(res.status).toBe(401);
  });

  it("creates a new customer account on first sign-in", async () => {
    verifyIdToken.mockResolvedValue({ getPayload: () => ({ sub: "google-sub-1", email: "newgoogleuser@example.com", name: "New Google User" }) });
    const res = await request(app).post("/api/auth/google").send({ credential: "good-token" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user.email).toBe("newgoogleuser@example.com");
    expect(res.body.data.user.role).toBe("customer");
    expect(res.body.data.token).toBeTruthy();
  });

  it("signs the same person back into the same account on a second sign-in, not a duplicate", async () => {
    verifyIdToken.mockResolvedValue({ getPayload: () => ({ sub: "google-sub-1", email: "newgoogleuser@example.com", name: "New Google User" }) });
    const first = await request(app).post("/api/auth/google").send({ credential: "good-token" });
    const second = await request(app).post("/api/auth/google").send({ credential: "good-token-again" });
    expect(second.body.data.user.id).toBe(first.body.data.user.id);
  });

  it("links to an existing password-based account with the same email instead of creating a second one", async () => {
    await request(app).post("/api/auth/register").send({
      username: "existingemailuser", password: "SecurePass123", name: "Existing User", email: "linkme@example.com", role: "customer",
    });
    verifyIdToken.mockResolvedValue({ getPayload: () => ({ sub: "google-sub-linked", email: "linkme@example.com", name: "Existing User" }) });
    const res = await request(app).post("/api/auth/google").send({ credential: "good-token" });
    expect(res.status).toBe(200);
    expect(res.body.data.user.username).toBe("existingemailuser"); // the original account, not a new one
  });

  it("linking does NOT bypass phone verification for an account that has an unverified phone on file", async () => {
    // The exact scenario that was a real bypass before this was fixed:
    // register with a password (unverified), sign in via Google with
    // the same email -- Google has genuinely verified the email, so
    // that requirement is legitimately satisfied by linking, but Google
    // never asserted anything about the phone number, so the account
    // must NOT become active on the strength of the email proof alone.
    await request(app).post("/api/auth/register").send({
      username: "phoneandemail", password: "SecurePass123", name: "X", email: "phoneandemail@example.com", phone: "+27821234567",
    });
    verifyIdToken.mockResolvedValue({ getPayload: () => ({ sub: "google-sub-phonelink", email: "phoneandemail@example.com", name: "X" }) });
    const res = await request(app).post("/api/auth/google").send({ credential: "good-token" });
    // Correctly blocked, same 403 + needsVerification shape as a
    // password login on an unverified account -- not a 200 with a
    // working token, which is exactly what the bypass used to hand back.
    expect(res.status).toBe(403);
    expect(res.body.data.needsVerification).toBe(true);
    expect(res.body.data.accountStatus).toBe("partially_verified"); // email now verified via Google, phone still isn't
  });
});

describe("POST /api/auth/facebook", () => {
  it("rejects a request with no accessToken", async () => {
    const res = await request(app).post("/api/auth/facebook").send({});
    expect(res.status).toBe(400);
  });

  it("rejects a token Facebook's own Graph API rejects", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: { message: "Invalid OAuth access token" } }) }));
    const res = await request(app).post("/api/auth/facebook").send({ accessToken: "bad-token" });
    expect(res.status).toBe(401);
  });

  it("rejects a Facebook profile with no email -- nothing to create an account with", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "fb-no-email", name: "No Email User" }) }));
    const res = await request(app).post("/api/auth/facebook").send({ accessToken: "token" });
    expect(res.status).toBe(400);
  });

  it("creates a new customer account from a valid Facebook profile", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "fb-user-1", name: "New FB User", email: "newfbuser@example.com" }) }));
    const res = await request(app).post("/api/auth/facebook").send({ accessToken: "token" });
    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe("newfbuser@example.com");
    expect(res.body.data.user.role).toBe("customer");
  });

  it("keeps Google and Facebook identities on the same email as two links to one account, not two accounts", async () => {
    verifyIdToken.mockResolvedValue({ getPayload: () => ({ sub: "google-sub-both", email: "both@example.com", name: "Both Provider User" }) });
    const googleRes = await request(app).post("/api/auth/google").send({ credential: "token" });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "fb-both", name: "Both Provider User", email: "both@example.com" }) }));
    const fbRes = await request(app).post("/api/auth/facebook").send({ accessToken: "token" });

    expect(fbRes.body.data.user.id).toBe(googleRes.body.data.user.id);
  });
});
