import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import { OAuth2Client } from "google-auth-library";
import { pool } from "../db/pool";
import { requireAuth, JWT_SECRET, JWT_EXPIRES } from "../middleware/auth";
import { sendPasswordResetEmail, isEmailConfigured } from "../services/emailService";
import { computeAccountStatus, sendEmailVerification, sendPhoneVerification } from "../services/accountVerification";

const router: ReturnType<typeof Router> = Router();

// Resend endpoints get their own tighter limit on top of /api/auth's
// blanket 20/min (index.ts) -- same reasoning as the order-tracking and
// order-creation limiters added earlier: an unauthenticated endpoint
// that triggers an outbound email/SMS send is worth capping specifically
// rather than trusting the general limit alone.
const resendLimiter = rateLimit({ windowMs: 60_000, max: 5, standardHeaders: true, legacyHeaders: false });

const mapUser = (r: any) => ({
  id: r.id, username: r.username, role: r.role, name: r.name, email: r.email,
  phone: r.phone ?? null, emailVerified: r.email_verified, phoneVerified: r.phone_verified, accountStatus: r.account_status,
});

// Phone verification is only required if SMS is actually configured --
// otherwise every new signup with a phone number would be permanently
// stuck below "active" waiting on a step that can never be completed.
// The moment real Twilio credentials exist, this starts requiring it
// for real, for every signup from then on -- accounts that already
// reached "active" under the looser rule are not retroactively
// downgraded. Lives in accountVerification.ts now, not here, so seller
// registration (marketplaceRouter.ts) can share the exact same logic
// rather than a second copy that could drift out of sync.

// ── Google / Facebook sign-in ────────────────────────────────────────────
// Both are "identity provider already did the login" flows: the
// frontend gets a credential (Google's signed ID token, or Facebook's
// access token) directly from that provider's own JS SDK, and these
// routes only ever verify it and issue this app's own JWT -- neither
// route ever sees or needs the user's Google/Facebook password.
//
// Real sign-in only works once GOOGLE_CLIENT_ID (and the matching
// VITE_GOOGLE_CLIENT_ID at build time) / FACEBOOK_APP_ID are set --
// isGoogleConfigured/isFacebookConfigured below gate that the same way
// isEmailConfigured() already gates password-reset email elsewhere in
// this file, and the frontend only renders a provider's button once
// its VITE_ env var is present, so there's nothing to configure beyond
// setting those values once real credentials exist.
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? "";
const FACEBOOK_APP_ID = process.env.FACEBOOK_APP_ID ?? "";
export function isGoogleConfigured(): boolean { return Boolean(GOOGLE_CLIENT_ID); }
export function isFacebookConfigured(): boolean { return Boolean(FACEBOOK_APP_ID); }
const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

/**
 * Finds the user row for a given OAuth identity, linking it to an
 * existing password-based account with the same email if one exists
 * (so someone who registered normally and later clicks "Continue with
 * Google" using the same email ends up signed into their one existing
 * account, not a confusing second one) -- otherwise creates a new
 * customer account. The random password_hash is never actually
 * checked against for these users; POST /login's bcrypt.compare would
 * just always fail for it, which is fine since OAuth users never use
 * that route.
 */
async function findOrCreateOauthUser(provider: "google" | "facebook", providerId: string, email: string, name: string) {
  const byIdentity = await pool!.query(`SELECT * FROM users WHERE oauth_provider = $1 AND oauth_id = $2`, [provider, providerId]);
  if (byIdentity.rows.length) return byIdentity.rows[0];

  const byEmail = await pool!.query(`SELECT * FROM users WHERE email = $1`, [email]);
  if (byEmail.rows.length) {
    const existing = byEmail.rows[0];
    // Google/Facebook have just verified this exact email address as
    // part of this very sign-in -- that's a legitimate verification
    // signal in its own right, so an account that registered via
    // password and never clicked its verification email gets
    // email_verified = true here rather than staying stuck unverified
    // forever with no way to complete that step (there's no password-
    // reset-style link for "verify via the OAuth account you just
    // proved you own"). Previously this update didn't touch
    // verification fields at all, and neither /google nor /facebook
    // checked account_status before issuing a token -- meaning
    // registering with a password (deliberately left unverified) and
    // then immediately signing in via Google with the same email would
    // hand back a working token regardless, a real bypass of the
    // verification requirement this phase exists to enforce.
    const newStatus = computeAccountStatus(true, existing.phone_verified, Boolean(existing.phone));
    const { rows } = await pool!.query(
      `UPDATE users SET oauth_provider = $1, oauth_id = $2, email_verified = true, account_status = $3 WHERE id = $4 RETURNING *`,
      [provider, providerId, newStatus, existing.id]
    );
    return rows[0];
  }

  // Username has to be unique and this app doesn't ask an OAuth user to
  // pick one -- start from their email's local part and disambiguate
  // with a short random suffix only if that's already taken.
  let username = email.split("@")[0].toLowerCase().replace(/[^a-z0-9._-]/g, "") || `${provider}user`;
  const usernameTaken = await pool!.query(`SELECT 1 FROM users WHERE username = $1`, [username]);
  if (usernameTaken.rows.length) username = `${username}-${crypto.randomBytes(3).toString("hex")}`;

  const randomPasswordHash = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10);
  // Deliberately not setting email_verified/phone_verified/account_status
  // here -- they get the schema's DEFAULT true/true/'active' as a result,
  // which is correct, not an oversight: Google and Facebook only ever
  // hand back an email they've already verified themselves, so there's
  // nothing this app needs to re-verify. No phone number exists to
  // verify either.
  const { rows } = await pool!.query(
    `INSERT INTO users (username, password_hash, role, name, email, oauth_provider, oauth_id)
     VALUES ($1, $2, 'customer', $3, $4, $5, $6) RETURNING *`,
    [username, randomPasswordHash, name || username, email, provider, providerId]
  );
  return rows[0];
}

// Shared by /login, /google, and /facebook -- issues a real token when
// (and only when) the account is actually active, or the same
// structured "needs verification" shape login already used, so the
// frontend handles all three sign-in paths with one code path rather
// than three slightly different ones. Centralizing this is what closes
// the gap where /google and /facebook could previously issue a token
// for an account that hadn't met the verification requirement at all.
async function respondWithSessionOrVerificationNeeded(user: any, res: Response): Promise<void> {
  if (user.account_status !== "active") {
    res.status(403).json({
      success: false,
      error: "Please verify your account before logging in.",
      data: {
        needsVerification: true, username: user.username,
        emailVerified: user.email_verified, phoneVerified: user.phone_verified,
        hasPhone: Boolean(user.phone), accountStatus: user.account_status,
      },
    });
    return;
  }
  await pool!.query(`UPDATE users SET last_login = now() WHERE id = $1`, [user.id]);
  const token = jwt.sign({ userId: user.id, username: user.username, role: user.role, tokenVersion: user.token_version }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
  res.json({ success: true, data: { token, user: mapUser(user) } });
}

router.get("/oauth-config", (_req: Request, res: Response) => {
  res.json({ success: true, data: { googleEnabled: isGoogleConfigured(), facebookEnabled: isFacebookConfigured() } });
});

router.post("/google", async (req: Request, res: Response): Promise<void> => {
  if (!googleClient) { res.status(503).json({ success: false, error: "Google sign-in isn't configured yet." }); return; }
  const { credential } = req.body ?? {};
  if (!credential) { res.status(400).json({ success: false, error: "credential is required" }); return; }

  try {
    const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email) { res.status(401).json({ success: false, error: "Invalid Google credential" }); return; }

    const user = await findOrCreateOauthUser("google", payload.sub, payload.email, payload.name ?? "");
    await respondWithSessionOrVerificationNeeded(user, res);
  } catch (err) {
    console.error("[auth] Google sign-in failed:", err);
    res.status(401).json({ success: false, error: "Could not verify that Google sign-in — please try again." });
  }
});

router.post("/facebook", async (req: Request, res: Response): Promise<void> => {
  if (!isFacebookConfigured()) { res.status(503).json({ success: false, error: "Facebook sign-in isn't configured yet." }); return; }
  const { accessToken } = req.body ?? {};
  if (!accessToken) { res.status(400).json({ success: false, error: "accessToken is required" }); return; }

  try {
    // Calling Facebook's own Graph API with the token both fetches the
    // profile and validates the token in one step -- a forged or
    // expired token gets rejected by Facebook itself, not trusted
    // client-side.
    const fbRes = await fetch(`https://graph.facebook.com/me?fields=id,name,email&access_token=${encodeURIComponent(accessToken)}`);
    const profile = await fbRes.json() as { id?: string; name?: string; email?: string; error?: { message: string } };
    if (!fbRes.ok || !profile.id) {
      console.error("[auth] Facebook token verification failed:", profile.error?.message ?? "unknown error");
      res.status(401).json({ success: false, error: "Could not verify that Facebook sign-in — please try again." });
      return;
    }
    if (!profile.email) {
      // Facebook accounts can lack a verified email (or the user
      // declined that permission) -- this app's users table requires
      // one, so there's genuinely nothing to create an account with.
      res.status(400).json({ success: false, error: "Your Facebook account doesn't have an email address we can use — try signing up with email instead." });
      return;
    }

    const user = await findOrCreateOauthUser("facebook", profile.id, profile.email, profile.name ?? "");
    await respondWithSessionOrVerificationNeeded(user, res);
  } catch (err) {
    console.error("[auth] Facebook sign-in failed:", err);
    res.status(401).json({ success: false, error: "Could not verify that Facebook sign-in — please try again." });
  }
});

// ── Register — new marketplace account (customer by default) ─────────────
router.post("/register", async (req: Request, res: Response): Promise<void> => {
  const { username, password, name, email, phone } = req.body ?? {};
  if (!username || !password || !name || !email) {
    res.status(400).json({ success: false, error: "username, password, name and email are required" });
    return;
  }
  if (typeof password !== "string" || password.length < 8) {
    res.status(400).json({ success: false, error: "Password must be at least 8 characters" });
    return;
  }
  if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ success: false, error: "Please enter a valid email address" });
    return;
  }
  // E.164 format (a leading + and 7-15 digits) -- what Twilio itself
  // requires the To/From numbers to be in, so validating this shape at
  // signup avoids a silently-failed SMS send later over a format issue
  // rather than an actually-wrong number.
  if (phone && (typeof phone !== "string" || !/^\+[1-9]\d{6,14}$/.test(phone))) {
    res.status(400).json({ success: false, error: "Phone number must be in international format, e.g. +27821234567" });
    return;
  }

  const existing = await pool!.query(`SELECT id FROM users WHERE username = $1`, [username]);
  if (existing.rows.length) {
    res.status(409).json({ success: false, error: "That username is already taken" });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const accountStatus = computeAccountStatus(false, false, Boolean(phone));
  const { rows } = await pool!.query(
    `INSERT INTO users (username, password_hash, role, name, email, phone, email_verified, phone_verified, account_status)
     VALUES ($1, $2, 'customer', $3, $4, $5, false, false, $6) RETURNING *`,
    [username, passwordHash, name, email, phone ?? null, accountStatus]
  );
  const user = rows[0];

  await sendEmailVerification(user.id, email);
  if (phone) await sendPhoneVerification(user.id, phone);

  // Deliberately no token here -- registering isn't the same as being
  // logged in while account_status isn't "active" yet (see the brief:
  // "block login... until Active"). The frontend routes to a
  // verification screen using just the username, the same
  // unauthenticated pattern password-reset already uses.
  res.status(201).json({ success: true, data: { user: mapUser(user), needsVerification: accountStatus !== "active" } });
});

// ── Login ───────────────────────────────────────────────────────────────
router.post("/login", async (req: Request, res: Response): Promise<void> => {
  const { username, password } = req.body ?? {};
  if (!username || !password) {
    res.status(400).json({ success: false, error: "username and password are required" });
    return;
  }

  const { rows } = await pool!.query(`SELECT * FROM users WHERE username = $1`, [username]);
  const user = rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    res.status(401).json({ success: false, error: "Invalid username or password" });
    return;
  }

  // Credentials being correct but the account not yet active gets a
  // 403 (not 401) inside the shared helper below, deliberately distinct
  // so the frontend can tell "wrong password" apart from "right
  // password, just not verified yet" and show the right screen for each.
  await respondWithSessionOrVerificationNeeded(user, res);
});

// ── Account verification ───────────────────────────────────────────────
// After either verification step succeeds, recompute account_status and
// -- if it just became "active" -- issue a real token in the same
// response, so completing the last required step logs the person
// straight in rather than sending them back to a manual login screen.
async function maybeIssueTokenIfNowActive(user: any): Promise<{ token: string } | Record<string, never>> {
  const newStatus = computeAccountStatus(user.email_verified, user.phone_verified, Boolean(user.phone));
  if (newStatus === user.account_status) return {};
  await pool!.query(`UPDATE users SET account_status = $1 WHERE id = $2`, [newStatus, user.id]);
  user.account_status = newStatus;
  if (newStatus !== "active") return {};
  await pool!.query(`UPDATE users SET last_login = now() WHERE id = $1`, [user.id]);
  const token = jwt.sign({ userId: user.id, username: user.username, role: user.role, tokenVersion: user.token_version }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
  return { token };
}

router.post("/verify-email", async (req: Request, res: Response): Promise<void> => {
  const { token } = req.body ?? {};
  if (!token || typeof token !== "string") {
    res.status(400).json({ success: false, error: "Verification token is required" });
    return;
  }
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const { rows } = await pool!.query(
    `SELECT * FROM email_verification_tokens WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()`,
    [tokenHash]
  );
  if (!rows.length) {
    res.status(400).json({ success: false, error: "This verification link is invalid or has expired. Request a new one." });
    return;
  }
  const tokenRow = rows[0];
  await pool!.query(`UPDATE email_verification_tokens SET used_at = now() WHERE id = $1`, [tokenRow.id]);
  await pool!.query(`UPDATE users SET email_verified = true WHERE id = $1`, [tokenRow.user_id]);

  const { rows: userRows } = await pool!.query(`SELECT * FROM users WHERE id = $1`, [tokenRow.user_id]);
  const extra = await maybeIssueTokenIfNowActive(userRows[0]);
  res.json({ success: true, data: { user: mapUser(userRows[0]), ...extra } });
});

router.post("/resend-verification-email", resendLimiter, async (req: Request, res: Response): Promise<void> => {
  const { username } = req.body ?? {};
  if (!username) { res.status(400).json({ success: false, error: "username is required" }); return; }
  const { rows } = await pool!.query(`SELECT * FROM users WHERE username = $1`, [username]);
  // Same non-enumeration shape as forgot-password below: always 200
  // regardless of whether the account exists or is already verified.
  if (!rows.length || rows[0].email_verified) { res.json({ success: true }); return; }
  const user = rows[0];
  await sendEmailVerification(user.id, user.email);
  res.json({ success: true });
});

router.post("/verify-phone", async (req: Request, res: Response): Promise<void> => {
  const { username, code } = req.body ?? {};
  if (!username || !code) {
    res.status(400).json({ success: false, error: "username and code are required" });
    return;
  }
  const { rows: userRows } = await pool!.query(`SELECT * FROM users WHERE username = $1`, [username]);
  if (!userRows.length) { res.status(400).json({ success: false, error: "Invalid or expired code" }); return; }
  const user = userRows[0];

  const { rows } = await pool!.query(
    `SELECT * FROM phone_verification_codes WHERE user_id = $1 AND used_at IS NULL AND expires_at > now() ORDER BY created_at DESC LIMIT 1`,
    [user.id]
  );
  if (!rows.length) { res.status(400).json({ success: false, error: "Invalid or expired code. Request a new one." }); return; }
  const codeRow = rows[0];

  // Caps guesses against this specific code, independent of the general
  // /api/auth rate limit -- a 6-digit OTP has only a million
  // possibilities, worth a tighter, explicit lockout on the code itself.
  if (codeRow.attempts >= 5) {
    res.status(400).json({ success: false, error: "Too many incorrect attempts. Request a new code." });
    return;
  }

  const codeHash = crypto.createHash("sha256").update(String(code)).digest("hex");
  if (codeHash !== codeRow.code_hash) {
    await pool!.query(`UPDATE phone_verification_codes SET attempts = attempts + 1 WHERE id = $1`, [codeRow.id]);
    res.status(400).json({ success: false, error: "Incorrect code. Please try again." });
    return;
  }

  await pool!.query(`UPDATE phone_verification_codes SET used_at = now() WHERE id = $1`, [codeRow.id]);
  await pool!.query(`UPDATE users SET phone_verified = true WHERE id = $1`, [user.id]);

  const { rows: freshUserRows } = await pool!.query(`SELECT * FROM users WHERE id = $1`, [user.id]);
  const extra = await maybeIssueTokenIfNowActive(freshUserRows[0]);
  res.json({ success: true, data: { user: mapUser(freshUserRows[0]), ...extra } });
});

router.post("/resend-phone-otp", resendLimiter, async (req: Request, res: Response): Promise<void> => {
  const { username } = req.body ?? {};
  if (!username) { res.status(400).json({ success: false, error: "username is required" }); return; }
  const { rows } = await pool!.query(`SELECT * FROM users WHERE username = $1`, [username]);
  if (!rows.length || !rows[0].phone || rows[0].phone_verified) { res.json({ success: true }); return; }
  const user = rows[0];
  await sendPhoneVerification(user.id, user.phone);
  res.json({ success: true });
});

// ── Who am I ────────────────────────────────────────────────────────────
router.get("/me", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { rows } = await pool!.query(`SELECT * FROM users WHERE id = $1`, [req.user!.userId]);
  if (!rows.length) { res.status(404).json({ success: false, error: "User not found" }); return; }
  res.json({ success: true, data: mapUser(rows[0]) });
});

// ── Change password ────────────────────────────────────────────────────
router.post("/change-password", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { currentPassword, newPassword } = req.body ?? {};
  if (!currentPassword || !newPassword) {
    res.status(400).json({ success: false, error: "currentPassword and newPassword are required" });
    return;
  }
  if (typeof newPassword !== "string" || newPassword.length < 8) {
    res.status(400).json({ success: false, error: "New password must be at least 8 characters" });
    return;
  }

  const { rows } = await pool!.query(`SELECT * FROM users WHERE id = $1`, [req.user!.userId]);
  const user = rows[0];
  if (!user || !(await bcrypt.compare(currentPassword, user.password_hash))) {
    res.status(401).json({ success: false, error: "Current password is incorrect" });
    return;
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  // Bumping token_version invalidates every other token issued for this
  // account (e.g. a session on another device) the moment this request
  // completes -- the whole point of a password change, security-wise.
  // Re-signing a fresh token for *this* response means the current
  // session doesn't get logged out from under the user for the same
  // reason; only sessions elsewhere are affected.
  const { rows: updatedRows } = await pool!.query(
    `UPDATE users SET password_hash = $1, token_version = token_version + 1 WHERE id = $2 RETURNING *`,
    [passwordHash, user.id]
  );
  const updatedUser = updatedRows[0];
  const token = jwt.sign(
    { userId: updatedUser.id, username: updatedUser.username, role: updatedUser.role, tokenVersion: updatedUser.token_version },
    JWT_SECRET, { expiresIn: JWT_EXPIRES }
  );
  res.json({ success: true, message: "Password updated successfully", data: { token } });
});

// ── Forgot password ─────────────────────────────────────────────────────
// Always responds with the same generic message regardless of whether
// the email exists — same anti-enumeration discipline as order tracking
// elsewhere in this app. If email isn't configured yet (see
// emailService.ts), the reset link is logged server-side instead of
// actually being sent, so this route still works end-to-end for testing
// without live SMTP credentials.
router.post("/forgot-password", async (req: Request, res: Response): Promise<void> => {
  const { email } = req.body ?? {};
  if (!email) { res.status(400).json({ success: false, error: "email is required" }); return; }

  const generic = { success: true, message: "If an account exists with that email, a password reset link has been sent." };
  const { rows } = await pool!.query(`SELECT id FROM users WHERE email = $1`, [email]);
  if (!rows.length) { res.json(generic); return; }
  const userId = rows[0].id;

  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  await pool!.query(
    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 hour')`,
    [userId, tokenHash]
  );

  const appUrl = process.env.MARKETPLACE_PUBLIC_URL ?? "";
  const resetUrl = `${appUrl}/?resetToken=${token}`;
  const result = await sendPasswordResetEmail(email, resetUrl);
  if (!result.sent && !isEmailConfigured()) {
    console.log(`[auth] Password reset link for ${email}: ${resetUrl}`);
  }
  res.json(generic);
});

// ── Reset password (using the token from the email) ────────────────────
router.post("/reset-password", async (req: Request, res: Response): Promise<void> => {
  const { token, newPassword } = req.body ?? {};
  if (!token || !newPassword) { res.status(400).json({ success: false, error: "token and newPassword are required" }); return; }
  if (typeof newPassword !== "string" || newPassword.length < 8) {
    res.status(400).json({ success: false, error: "New password must be at least 8 characters" });
    return;
  }

  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const { rows } = await pool!.query(
    `SELECT * FROM password_reset_tokens WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()`,
    [tokenHash]
  );
  if (!rows.length) { res.status(400).json({ success: false, error: "This reset link is invalid or has expired — request a new one." }); return; }
  const resetRow = rows[0];

  const passwordHash = await bcrypt.hash(newPassword, 10);
  // Bumps token_version too -- a forgot-password reset is exactly the
  // case where any existing session (possibly the compromised one that
  // prompted the reset) should stop working, not just the password.
  await pool!.query(`UPDATE users SET password_hash = $1, token_version = token_version + 1 WHERE id = $2`, [passwordHash, resetRow.user_id]);
  await pool!.query(`UPDATE password_reset_tokens SET used_at = now() WHERE id = $1`, [resetRow.id]);
  res.json({ success: true, message: "Password reset successfully — you can now sign in with your new password." });
});

export default router;
