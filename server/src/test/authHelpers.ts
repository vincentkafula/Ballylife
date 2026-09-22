import type { Express } from "express";
import crypto from "crypto";
import request from "supertest";

type QueryablePool = { query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }> };

/**
 * Registers a customer and drives the REAL verify-email route to
 * completion, rather than bypassing the verification requirement --
 * most callers of this helper aren't testing verification itself, they
 * just need a normal, usable logged-in customer to set up their own
 * scenario, now that registering alone no longer returns a usable
 * token.
 *
 * email_verification_tokens stores only a SHA-256 hash of the raw
 * token (correctly -- same reason password_hash isn't the raw
 * password), so there's no way to recover the route-generated raw
 * token from the DB. Same constraint the existing reset-password test
 * in authRouter.integration.test.ts already works around, using the
 * same fix: insert a token whose raw/hash pair is known to this
 * helper, exercising the real verify-email route end-to-end instead of
 * stopping short of it.
 *
 * No phone number is passed to register, so email verification alone
 * reaches "active" -- computeAccountStatus in authRouter.ts only
 * requires phone verification for accounts that actually have a phone
 * on file.
 */
export async function registerAndVerifyCustomer(
  app: Express,
  pool: QueryablePool,
  overrides: { username?: string; password?: string; name?: string; email?: string } = {}
): Promise<{ token: string; userId: string; username: string }> {
  const username = overrides.username ?? `testcustomer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const password = overrides.password ?? "SecurePass123";
  const regRes = await request(app).post("/api/auth/register").send({
    username, password,
    name: overrides.name ?? "Test Customer",
    email: overrides.email ?? `${username}@example.com`,
  });
  if (regRes.status !== 201) {
    throw new Error(`registerAndVerifyCustomer: registration failed (${regRes.status}): ${JSON.stringify(regRes.body)}`);
  }
  const userId = regRes.body.data.user.id as string;

  const rawToken = crypto.randomBytes(16).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  await pool.query(
    `INSERT INTO email_verification_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '30 minutes')`,
    [userId, tokenHash]
  );

  const verifyRes = await request(app).post("/api/auth/verify-email").send({ token: rawToken });
  if (verifyRes.status !== 200 || !verifyRes.body.data?.token) {
    throw new Error(`registerAndVerifyCustomer: verify-email did not return a token (${verifyRes.status}): ${JSON.stringify(verifyRes.body)}`);
  }
  return { token: verifyRes.body.data.token as string, userId, username };
}
