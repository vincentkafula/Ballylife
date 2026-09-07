import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { pool } from "../db/pool";
import { requireAuth, JWT_SECRET, JWT_EXPIRES } from "../middleware/auth";
import { sendPasswordResetEmail, isEmailConfigured } from "../services/emailService";

const router: ReturnType<typeof Router> = Router();

const mapUser = (r: any) => ({
  id: r.id, username: r.username, role: r.role, name: r.name, email: r.email,
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
