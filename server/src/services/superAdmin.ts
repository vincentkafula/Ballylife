/**
 * The super admin: one account, defined entirely by Railway variables and
 * re-applied at every boot, so its credentials live in one place and can't
 * be changed (or locked out) from inside the app:
 *
 *   SUPER_ADMIN_USERNAME   login name
 *   SUPER_ADMIN_PASSWORD   at least 12 characters, not a common password
 *   SUPER_ADMIN_EMAIL      optional contact address (default: none)
 *   SUPER_ADMIN_NAME       optional display name (default "Super Admin")
 *
 * Changing SUPER_ADMIN_PASSWORD in Railway and redeploying changes the
 * password and signs out every existing super-admin session. Changing
 * SUPER_ADMIN_USERNAME moves super-admin rights to the new account; the old
 * one is demoted to a customer and signed out.
 *
 * Only the super admin can make someone a manager (marketplace_admin),
 * take manager rights away, remove any account, or restore one.
 * The password itself is never logged.
 */
import bcrypt from "bcryptjs";
import { pool } from "../db/pool";
import { logger } from "../utils/logger";
import { hashPassword, passwordProblem } from "../utils/authSecurity";

export const SUPER_ADMIN_ROLE = "super_admin";
const MIN_SUPER_ADMIN_PASSWORD = 12;
/** Audit-log actor for changes made at boot from the environment (mkt_audit_log.actor_id is a UUID). */
const SYSTEM_ACTOR = "00000000-0000-0000-0000-000000000000";

type Row = Record<string, any>;

export async function writeAudit(actorId: string, actorRole: string, entityType: string, entityId: string, action: string, before: unknown, after: unknown): Promise<void> {
  await pool!.query(
    `INSERT INTO mkt_audit_log (actor_id, actor_role, entity_type, entity_id, action, before, after) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [actorId, actorRole, entityType, entityId, action, JSON.stringify(before), JSON.stringify(after)]
  );
}

export function superAdminEnvProblem(username: string | undefined, password: string | undefined): string | null {
  if (!username?.trim() || !password) return "SUPER_ADMIN_USERNAME and SUPER_ADMIN_PASSWORD aren't both set";
  if (password.length < MIN_SUPER_ADMIN_PASSWORD) return `SUPER_ADMIN_PASSWORD must be at least ${MIN_SUPER_ADMIN_PASSWORD} characters`;
  return passwordProblem(password, username, process.env.SUPER_ADMIN_EMAIL);
}

/** Creates or updates the super-admin account from the environment. Never throws. */
export async function ensureSuperAdminFromEnv(): Promise<"created" | "updated" | "unchanged" | "not_configured" | "invalid"> {
  const username = process.env.SUPER_ADMIN_USERNAME?.trim();
  const password = process.env.SUPER_ADMIN_PASSWORD;
  const email = process.env.SUPER_ADMIN_EMAIL?.trim() || "";
  const name = process.env.SUPER_ADMIN_NAME?.trim() || "Super Admin";
  try {
    if (!username && !password) { logger.info("super_admin.not_configured", {}); return "not_configured"; }
    const problem = superAdminEnvProblem(username, password);
    if (problem) { logger.error("super_admin.invalid_config", { problem }); return "invalid"; }

    // Only one super admin: anyone else holding the role (e.g. after the
    // username variable changed) is demoted and signed out.
    const { rows: others } = await pool!.query(`SELECT id, username FROM users WHERE role = $1 AND username <> $2`, [SUPER_ADMIN_ROLE, username]);
    for (const o of others) {
      await pool!.query(`UPDATE users SET role = 'customer', token_version = token_version + 1 WHERE id = $1`, [o.id]);
      await writeAudit(SYSTEM_ACTOR, "system", "user", o.id, "super_admin_revoked", { role: SUPER_ADMIN_ROLE }, { role: "customer" });
      logger.warn("super_admin.previous_demoted", { username: o.username });
    }

    const { rows } = await pool!.query(`SELECT * FROM users WHERE username = $1`, [username]);
    const existing = rows[0];
    if (!existing) {
      const hash = await hashPassword(password!);
      const { rows: created } = await pool!.query(
        `INSERT INTO users (username, password_hash, role, name, email, email_verified, phone_verified, account_status)
         VALUES ($1, $2, $3, $4, $5, true, true, 'active') RETURNING id`,
        [username, hash, SUPER_ADMIN_ROLE, name, email]
      );
      await writeAudit(SYSTEM_ACTOR, "system", "user", created[0].id, "super_admin_created", null, { username });
      logger.info("super_admin.created", { username });
      return "created";
    }

    const passwordMatches = await bcrypt.compare(password!, existing.password_hash).catch(() => false);
    const needsUpdate = !passwordMatches || existing.role !== SUPER_ADMIN_ROLE || existing.account_status !== "active" || (email && existing.email !== email) || existing.name !== name;
    if (!needsUpdate) return "unchanged";
    const hash = passwordMatches ? existing.password_hash : await hashPassword(password!);
    // A new password or a role change signs out every existing session.
    const revoke = !passwordMatches || existing.role !== SUPER_ADMIN_ROLE;
    await pool!.query(
      `UPDATE users SET password_hash = $1, role = $2, name = $3, email = CASE WHEN $4 = '' THEN email ELSE $4 END, account_status = 'active',
         email_verified = true, removed_at = NULL, removed_by = NULL, removal_reason = NULL,
         token_version = token_version + $5 WHERE id = $6`,
      [hash, SUPER_ADMIN_ROLE, name, email, revoke ? 1 : 0, existing.id]
    );
    await writeAudit(SYSTEM_ACTOR, "system", "user", existing.id, "super_admin_updated", { role: existing.role }, { role: SUPER_ADMIN_ROLE, passwordChanged: !passwordMatches });
    logger.info("super_admin.updated", { username, passwordChanged: !passwordMatches });
    return "updated";
  } catch (err) {
    logger.error("super_admin.ensure_failed", { error: err instanceof Error ? err.message : String(err) });
    return "invalid";
  }
}

// ── Account management (super admin only) ────────────────────────────────

export class AccountError extends Error { constructor(message: string, readonly status = 400) { super(message); } }

async function loadTarget(id: string, actorId: string): Promise<Row> {
  const { rows } = await pool!.query(`SELECT * FROM users WHERE id::text = $1`, [id]);
  const u = rows[0];
  if (!u) throw new AccountError("Account not found.", 404);
  if (u.id === actorId) throw new AccountError("You can't do this to your own account.");
  if (u.role === SUPER_ADMIN_ROLE) throw new AccountError("The super admin account is managed through Railway variables.", 403);
  return u;
}

/** Closes an account: signs it out everywhere and blocks sign-in. Sellers' stores are suspended and their products hidden. */
export async function removeAccount(id: string, actor: { userId: string; role: string }, reason?: string): Promise<Row> {
  const u = await loadTarget(id, actor.userId);
  if (u.account_status === "removed") throw new AccountError("That account is already removed.", 409);
  const { rows } = await pool!.query(
    `UPDATE users SET account_status = 'removed', removed_at = now(), removed_by = $1, removal_reason = $2, token_version = token_version + 1
     WHERE id = $3 RETURNING *`,
    [actor.userId, reason?.trim().slice(0, 500) || null, u.id]
  );
  const { rows: stores } = await pool!.query(
    `UPDATE mkt_sellers SET status = 'suspended', suspended_by_removal = true WHERE user_id = $1 AND status <> 'suspended' RETURNING id`, [String(u.id)]
  );
  for (const s of stores) {
    await pool!.query(`UPDATE mkt_products SET status = 'inactive', updated_at = now() WHERE seller_id = $1 AND status IN ('active', 'out_of_stock')`, [s.id]);
  }
  await writeAudit(actor.userId, actor.role, "user", u.id, "account_removed",
    { role: u.role, accountStatus: u.account_status }, { accountStatus: "removed", reason: reason ?? null, storesSuspended: stores.length });
  logger.warn("account.removed", { targetId: u.id, role: u.role, by: actor.userId, storesSuspended: stores.length });
  return rows[0];
}

/** Reopens a removed account. Stores suspended by the removal are reopened, but their products stay hidden until the seller or a manager relists them. */
export async function restoreAccount(id: string, actor: { userId: string; role: string }): Promise<Row> {
  const u = await loadTarget(id, actor.userId);
  if (u.account_status !== "removed") throw new AccountError("That account isn't removed.", 409);
  const { rows } = await pool!.query(
    `UPDATE users SET account_status = 'active', removed_at = NULL, removed_by = NULL, removal_reason = NULL WHERE id = $1 RETURNING *`, [u.id]
  );
  const { rows: stores } = await pool!.query(
    `UPDATE mkt_sellers SET status = 'active', suspended_by_removal = false WHERE user_id = $1 AND suspended_by_removal = true RETURNING id`, [String(u.id)]
  );
  await writeAudit(actor.userId, actor.role, "user", u.id, "account_restored", { accountStatus: "removed" }, { accountStatus: "active", storesReopened: stores.length });
  logger.info("account.restored", { targetId: u.id, by: actor.userId });
  return rows[0];
}

/** Creates a new manager account with a temporary password the super admin hands over. */
export async function createManager(input: { username?: unknown; name?: unknown; email?: unknown; password?: unknown }, actor: { userId: string; role: string }): Promise<Row> {
  const username = String(input.username ?? "").trim().toLowerCase();
  const name = String(input.name ?? "").trim();
  const email = String(input.email ?? "").trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) throw new AccountError("Username must be 3–40 characters: letters, numbers, dots, dashes or underscores.");
  if (!name) throw new AccountError("Name is required.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AccountError("A valid email is required.");
  const problem = passwordProblem(input.password, username, email);
  if (problem) throw new AccountError(problem);
  const { rows: taken } = await pool!.query(`SELECT 1 FROM users WHERE username = $1 OR email = $2`, [username, email]);
  if (taken.length) throw new AccountError("That username or email is already in use — change the existing account's role instead.", 409);
  const hash = await hashPassword(String(input.password));
  const { rows } = await pool!.query(
    `INSERT INTO users (username, password_hash, role, name, email, email_verified, phone_verified, account_status)
     VALUES ($1, $2, 'marketplace_admin', $3, $4, true, true, 'active') RETURNING *`,
    [username, hash, name, email]
  );
  await writeAudit(actor.userId, actor.role, "user", rows[0].id, "manager_created", null, { username, email });
  logger.info("account.manager_created", { username, by: actor.userId });
  return rows[0];
}
