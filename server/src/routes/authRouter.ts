import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { pool } from "../db/pool";
import { requireAuth, JWT_SECRET, JWT_EXPIRES } from "../middleware/auth";

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

export default router;
