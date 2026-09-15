import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { OAuth2Client } from "google-auth-library";
import { pool } from "../db/pool";
import { requireAuth, JWT_SECRET, JWT_EXPIRES } from "../middleware/auth";
import { sendPasswordResetEmail, isEmailConfigured } from "../services/emailService";

const router: ReturnType<typeof Router> = Router();

const mapUser = (r: any) => ({
  id: r.id, username: r.username, role: r.role, name: r.name, email: r.email,
});

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
    const { rows } = await pool!.query(
      `UPDATE users SET oauth_provider = $1, oauth_id = $2 WHERE id = $3 RETURNING *`,
      [provider, providerId, byEmail.rows[0].id]
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
  const { rows } = await pool!.query(
    `INSERT INTO users (username, password_hash, role, name, email, oauth_provider, oauth_id)
     VALUES ($1, $2, 'customer', $3, $4, $5, $6) RETURNING *`,
    [username, randomPasswordHash, name || username, email, provider, providerId]
  );
  return rows[0];
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
    await pool!.query(`UPDATE users SET last_login = now() WHERE id = $1`, [user.id]);
    const token = jwt.sign({ userId: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
    res.json({ success: true, data: { token, user: mapUser(user) } });
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
    await pool!.query(`UPDATE users SET last_login = now() WHERE id = $1`, [user.id]);
    const token = jwt.sign({ userId: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
    res.json({ success: true, data: { token, user: mapUser(user) } });
  } catch (err) {
    console.error("[auth] Facebook sign-in failed:", err);
    res.status(401).json({ success: false, error: "Could not verify that Facebook sign-in — please try again." });
  }
});

// ── Register — new marketplace account (customer by default) ─────────────
router.post("/register", async (req: Request, res: Response): Promise<void> => {
  const { username, password, name, email } = req.body ?? {};
  if (!username || !password || !name || !email) {
    res.status(400).json({ success: false, error: "username, password, name and email are required" });
    return;
  }
  if (typeof password !== "string" || password.length < 8) {
    res.status(400).json({ success: false, error: "Password must be at least 8 characters" });
    return;
  }

  const existing = await pool!.query(`SELECT id FROM users WHERE username = $1`, [username]);
  if (existing.rows.length) {
    res.status(409).json({ success: false, error: "That username is already taken" });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const { rows } = await pool!.query(
    `INSERT INTO users (username, password_hash, role, name, email)
     VALUES ($1, $2, 'customer', $3, $4) RETURNING *`,
    [username, passwordHash, name, email]
  );
  const user = rows[0];
  const token = jwt.sign({ userId: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
  res.status(201).json({ success: true, data: { token, user: mapUser(user) } });
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

  await pool!.query(`UPDATE users SET last_login = now() WHERE id = $1`, [user.id]);
  const token = jwt.sign({ userId: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
  res.json({ success: true, data: { token, user: mapUser(user) } });
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
  await pool!.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [passwordHash, user.id]);
  res.json({ success: true, message: "Password updated successfully" });
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
  await pool!.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [passwordHash, resetRow.user_id]);
  await pool!.query(`UPDATE password_reset_tokens SET used_at = now() WHERE id = $1`, [resetRow.id]);
  res.json({ success: true, message: "Password reset successfully — you can now sign in with your new password." });
});

export default router;
