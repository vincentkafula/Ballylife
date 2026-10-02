/**
 * Website login details for people who use Ballylife on WhatsApp.
 *
 * Everyone gets the same kind of account whichever way they signed up: a
 * username and password that work on ballylife.com (computer or phone).
 * Accounts made on WhatsApp get a temporary password, sent here once; the
 * website asks them to choose their own the first time they sign in.
 *
 * Passwords are never written to the message log (`logAs` masks them).
 */
import crypto from "crypto";
import { pool } from "../../db/pool";
import { logger } from "../../utils/logger";
import { hashPassword } from "../../utils/authSecurity";
import { createMagicToken, magicLoginUrl, MAGIC_LINK_MINUTES } from "../magicLink";
import { sendText } from "./client";

const SITE = () => (process.env.MARKETPLACE_PUBLIC_URL || "https://www.ballylife.com").replace(/\/$/, "");
// No look-alike characters (0/O, 1/l/I), so it can be typed from a phone screen.
const ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** e.g. "Kp7m-x3Rt-9wQa": 12 random characters, about 70 bits. */
export function temporaryPassword(): string {
  const bytes = crypto.randomBytes(12);
  const chars = [...bytes].map(b => ALPHABET[b % ALPHABET.length]);
  return [chars.slice(0, 4), chars.slice(4, 8), chars.slice(8, 12)].map(g => g.join("")).join("-");
}

/** A fresh temporary password hash for a new account (they must change it at first sign-in). */
export async function newAccountPassword(): Promise<{ password: string; passwordHash: string }> {
  const password = temporaryPassword();
  return { password, passwordHash: await hashPassword(password) };
}

// Manager accounts never get a password over WhatsApp: a lost phone mustn't open the dashboard.
const WHATSAPP_RESET_ROLES = new Set(["customer", "seller"]);

/**
 * Replaces the account's password with a new temporary one (forgot password on
 * WhatsApp). Signs out every other session, like the website's reset does.
 */
export async function resetToTemporaryPassword(userId: string): Promise<string | null> {
  const { rows } = await pool!.query(`SELECT role, account_status FROM users WHERE id = $1`, [userId]);
  const u = rows[0];
  if (!u || u.account_status === "removed" || !WHATSAPP_RESET_ROLES.has(u.role)) return null;
  const { password, passwordHash } = await newAccountPassword();
  await pool!.query(
    `UPDATE users SET password_hash = $1, must_change_password = true, token_version = token_version + 1 WHERE id = $2`,
    [passwordHash, userId]);
  logger.info("whatsapp.password_reset", { userId });
  return password;
}

/**
 * Sends the username (and, if given, the temporary password) plus a one-time
 * sign-in link. Without a password, it tells them how to get a new one.
 */
export async function sendLoginDetails(phone: string, userId: string, intro: string, password: string | null = null): Promise<void> {
  const { rows } = await pool!.query(`SELECT username, email, role FROM users WHERE id = $1`, [userId]);
  const u = rows[0];
  if (!u) return;
  const token = await createMagicToken(userId, "login", phone);
  const head = `${intro}\n\n*Your Ballylife login* — works on ${SITE().replace(/^https?:\/\//, "")} on any computer or phone:\n` +
    `👤 Username: *${u.username}*\n   (your email ${u.email} or this WhatsApp number also work)\n`;
  const pw = password
    ? `🔑 Temporary password: *${password}*\nYou'll choose your own password the first time you sign in. Keep this private — Ballylife will never ask you for your password.\n`
    : WHATSAPP_RESET_ROLES.has(u.role)
      ? `🔑 Use your password. Forgot it? Type *new password* here and we'll send you a new one.\n`
      : `🔑 Use your password.\n`;
  const link = `\n🔐 Or tap to sign in now (works once, for ${MAGIC_LINK_MINUTES} minutes):\n`;
  await sendText(phone, `${head}${pw}${link}${magicLoginUrl(token)}`, {
    previewUrl: false,
    logAs: `${head}${password ? "🔑 Temporary password: [hidden]\n" : pw}${link}[sign-in link]`,
  });
}
