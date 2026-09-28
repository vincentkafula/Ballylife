/**
 * One-time sign-in links, sent over WhatsApp instead of passwords.
 *
 * A link carries a random 32-byte token; only its SHA-256 hash is stored.
 * It works once, within 15 minutes. Purpose "link_whatsapp" is used for
 * the email we send when someone registers on WhatsApp with an email that
 * already has an account: clicking it proves they own that email, and
 * connects the WhatsApp number to the existing account.
 */
import crypto from "crypto";
import { pool } from "../db/pool";

const SITE = () => (process.env.MARKETPLACE_PUBLIC_URL || "https://www.ballylife.com").replace(/\/$/, "");
const API = () => (process.env.PUBLIC_API_URL || "https://ballylife-backend-production.up.railway.app").replace(/\/$/, "");
export const MAGIC_LINK_MINUTES = 15;

const hash = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

export async function createMagicToken(userId: string, purpose: "login" | "link_whatsapp" = "login", phone: string | null = null, minutes = MAGIC_LINK_MINUTES): Promise<string> {
  const token = crypto.randomBytes(32).toString("base64url");
  await pool!.query(
    `INSERT INTO magic_login_tokens (user_id, token_hash, purpose, phone, expires_at) VALUES ($1, $2, $3, $4, $5)`,
    [userId, hash(token), purpose, phone, new Date(Date.now() + minutes * 60_000)]);
  return token;
}

/** The website sign-in link for a login token. */
export const magicLoginUrl = (token: string) => `${SITE()}/wa-login?t=${token}`;
/** The confirm link (served by the backend) for linking WhatsApp to an existing account. */
export const linkConfirmUrl = (token: string) => `${API()}/api/whatsapp/link?t=${encodeURIComponent(token)}`;

/**
 * Uses up a token. Returns its user and phone, or null when it's unknown,
 * expired, already used, or for a different purpose.
 */
export async function consumeMagicToken(token: string, purpose: "login" | "link_whatsapp"): Promise<{ userId: string; phone: string | null } | null> {
  if (!token || token.length < 20 || token.length > 100) return null;
  const { rows } = await pool!.query(
    `SELECT id, user_id, phone, expires_at, used_at, purpose FROM magic_login_tokens WHERE token_hash = $1`, [hash(token)]);
  const row = rows[0];
  if (!row || row.purpose !== purpose || row.used_at || new Date(row.expires_at).getTime() < Date.now()) return null;
  // Mark used first; the "used_at IS NULL" guard means two clicks can't both succeed.
  const upd = await pool!.query(`UPDATE magic_login_tokens SET used_at = now() WHERE id = $1 AND used_at IS NULL`, [row.id]);
  if (!upd.rowCount) return null;
  return { userId: String(row.user_id), phone: row.phone ?? null };
}
