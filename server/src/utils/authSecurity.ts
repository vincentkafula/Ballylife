import bcrypt from "bcryptjs";
import crypto from "crypto";

/**
 * Authentication hardening shared by every login/registration route.
 */

/** bcrypt work factor for new hashes. Existing weaker hashes are upgraded on the next successful login. */
export const BCRYPT_COST = Number(process.env.BCRYPT_COST ?? 12);

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

export function needsRehash(hash: string): boolean {
  try { return bcrypt.getRounds(hash) < BCRYPT_COST; } catch { return false; }
}

// Compared against when the username doesn't exist, so a failed login takes
// the same time either way and response timing can't reveal which
// usernames are registered.
let dummyHash: Promise<string> | null = null;
export async function compareAgainstDummy(password: string): Promise<void> {
  dummyHash ??= bcrypt.hash(crypto.randomBytes(16).toString("hex"), BCRYPT_COST);
  await bcrypt.compare(password, await dummyHash);
}

// ── Per-account login throttling ────────────────────────────────────────
// The per-IP limiter on /api/auth doesn't stop a guessing attack spread
// across many IPs; this caps failures per username regardless of source.
const MAX_FAILURES = Number(process.env.LOGIN_MAX_FAILURES ?? 5);
const WINDOW_MS = 15 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;
const failures = new Map<string, { count: number; firstAt: number; lockedUntil: number }>();

const key = (username: string) => String(username).trim().toLowerCase();

/** Seconds until this username may try again, or 0 if not locked. */
export function loginLockedFor(username: string): number {
  const f = failures.get(key(username));
  if (!f || f.lockedUntil <= Date.now()) return 0;
  return Math.ceil((f.lockedUntil - Date.now()) / 1000);
}

export function recordLoginFailure(username: string): void {
  const k = key(username);
  const now = Date.now();
  const f = failures.get(k);
  if (!f || now - f.firstAt > WINDOW_MS) { failures.set(k, { count: 1, firstAt: now, lockedUntil: 0 }); return; }
  f.count++;
  if (f.count >= MAX_FAILURES) f.lockedUntil = now + LOCK_MS;
  if (failures.size > 50_000) for (const [kk, v] of failures) { if (now - v.firstAt > WINDOW_MS && v.lockedUntil <= now) failures.delete(kk); }
}

export function recordLoginSuccess(username: string): void {
  failures.delete(key(username));
}

export function _resetLoginThrottleForTests() { failures.clear(); }

// ── Password policy ─────────────────────────────────────────────────────
const COMMON_PASSWORDS = new Set([
  "password", "password1", "password12", "password123", "password1234", "12345678", "123456789", "1234567890",
  "qwerty123", "qwertyuiop", "11111111", "00000000", "iloveyou", "letmein123", "welcome123", "admin123",
  "abc12345", "football", "baseball", "sunshine", "princess", "passw0rd", "p@ssw0rd", "p@ssword", "1q2w3e4r",
  "ballylife", "ballylife123", "ballylife@2026", "changeme", "trustno1", "superman", "starwars",
]);

/** Why a password isn't acceptable, or null if it is. */
export function passwordProblem(password: unknown, ...identifiers: (string | null | undefined)[]): string | null {
  if (typeof password !== "string" || password.length < 8) return "Password must be at least 8 characters";
  if (password.length > 200) return "Password is too long";
  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) return "That password is too common — please choose another";
  if (/^(.)\1+$/.test(password)) return "Password can't be a single repeated character";
  for (const id of identifiers) {
    const local = String(id ?? "").toLowerCase().split("@")[0];
    if (local.length >= 3 && lower.includes(local)) return "Password can't contain your username or email";
  }
  return null;
}

// ── Demo accounts ───────────────────────────────────────────────────────
/** The password the seeded demo/dashboard accounts were created with (it's public in the repo). */
export const DEMO_DEFAULT_PASSWORD = "Ballylife@2026";

/** Demo walkthrough shortcuts (e.g. auto-confirming orders without payment) only run when explicitly enabled. */
export function demoModeEnabled(): boolean {
  return /^(1|true|yes)$/i.test(process.env.DEMO_MODE ?? "");
}
