import bcrypt from "bcryptjs";
import crypto from "crypto";
import { pool } from "../db/pool";
import { logger } from "../utils/logger";
import { hashPassword, DEMO_DEFAULT_PASSWORD, demoModeEnabled } from "../utils/authSecurity";

/**
 * The seeded dashboard accounts were created with a password that is public
 * in the repository. On a live store (DEMO_MODE not enabled), any of them
 * still using it is locked at boot: a random password nobody knows, and
 * token_version bumped so existing sessions end. Their owners can still get
 * in through "forgot password" if the account has a real email.
 *
 * `admin` is never locked here -- that could lock the owner out of their own
 * marketplace -- but it's reported loudly, and logging in with the default
 * password makes the dashboard insist it be changed.
 */
const DEMO_ACCOUNTS = ["seller1", "supplier1", "customer1", "sars1", "shipping1", "credit1", "credit2"];

export async function secureDemoAccounts(): Promise<{ locked: string[]; adminOnDefault: boolean }> {
  const { rows } = await pool!.query(
    `SELECT id, username, password_hash FROM users WHERE username IN (${[...DEMO_ACCOUNTS, "admin"].map((_, i) => "$" + (i + 1)).join(", ")})`, [...DEMO_ACCOUNTS, "admin"]
  );
  const locked: string[] = [];
  let adminOnDefault = false;
  for (const u of rows) {
    if (!(await bcrypt.compare(DEMO_DEFAULT_PASSWORD, u.password_hash))) continue;
    if (u.username === "admin") { adminOnDefault = true; continue; }
    if (demoModeEnabled()) continue;
    await pool!.query(`UPDATE users SET password_hash = $1, token_version = token_version + 1 WHERE id = $2`,
      [await hashPassword(crypto.randomBytes(24).toString("hex")), u.id]);
    locked.push(u.username);
  }
  if (locked.length) logger.warn("security.demo_accounts_locked", { accounts: locked });
  if (adminOnDefault) logger.error("security.admin_default_password", { action: "Log in as admin and change the password now — the default is public." });
  return { locked, adminOnDefault };
}
