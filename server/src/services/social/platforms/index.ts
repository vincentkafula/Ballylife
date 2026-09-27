/**
 * One Poster per social platform. Each reads only its own Railway
 * variables and succeeds or fails on its own. A platform shows up here
 * once its integration is written; until then the admin panel lists it as
 * "not built yet".
 */
import type { PlatformId, SocialProduct } from "../socialCaptions";
import { pool } from "../../../db/pool";
import { encrypt, decrypt } from "../../aliexpressClient";

export interface PostInput { product: SocialProduct; caption: string }
export interface PostResult { externalId: string; externalUrl?: string }

export interface Poster {
  /** All required variables are set. */
  isConfigured(): boolean;
  /** Names of the Railway variables still missing (never their values). */
  missingVariables(): string[];
  post(input: PostInput): Promise<PostResult>;
  /** Renews the access token when it is close to expiring (optional). */
  refreshToken?(): Promise<void>;
}

export const POSTERS: Partial<Record<PlatformId, Poster>> = {};

/** A failure that retrying won't fix (not connected, token revoked, product gone). */
export class NonRetryable extends Error {}

export function missing(names: string[]): string[] {
  return names.filter(n => !process.env[n]?.trim());
}

// ------------------------------------------------ refreshed-token storage

/** A refreshed token (stored encrypted) if we have one, else the Railway variable. */
export async function currentToken(platform: string, envName: string): Promise<string | null> {
  if (pool) {
    try {
      const { rows } = await pool.query(`SELECT access_token_enc FROM social_tokens WHERE platform = $1`, [platform]);
      if (rows[0]) return decrypt(rows[0].access_token_enc);
    } catch { /* fall back to the variable */ }
  }
  return process.env[envName]?.trim() || null;
}

export async function tokenExpiry(platform: string): Promise<Date | null> {
  if (!pool) return null;
  const { rows } = await pool.query(`SELECT expires_at FROM social_tokens WHERE platform = $1`, [platform]);
  return rows[0]?.expires_at ? new Date(rows[0].expires_at) : null;
}

export async function saveToken(platform: string, accessToken: string, expiresAt: Date | null, refreshToken?: string | null, meta: Record<string, unknown> = {}): Promise<void> {
  if (!pool) return;
  const enc = encrypt(accessToken);
  const refEnc = refreshToken ? encrypt(refreshToken) : null;
  const upd = await pool.query(
    `UPDATE social_tokens SET access_token_enc = $2, refresh_token_enc = COALESCE($3, refresh_token_enc), expires_at = $4, meta = $5, updated_at = now() WHERE platform = $1`,
    [platform, enc, refEnc, expiresAt, JSON.stringify(meta)]);
  if (!upd.rowCount) {
    await pool.query(`INSERT INTO social_tokens (platform, access_token_enc, refresh_token_enc, expires_at, meta) VALUES ($1, $2, $3, $4, $5)`, [platform, enc, refEnc, expiresAt, JSON.stringify(meta)]);
  }
}

/** Stored token row (decrypted) with its non-secret meta, or null. */
export async function storedToken(platform: string): Promise<{ accessToken: string; refreshToken: string | null; expiresAt: Date | null; meta: Record<string, any> } | null> {
  if (!pool) return null;
  const { rows } = await pool.query(`SELECT * FROM social_tokens WHERE platform = $1`, [platform]);
  const r = rows[0];
  if (!r) return null;
  return { accessToken: decrypt(r.access_token_enc), refreshToken: r.refresh_token_enc ? decrypt(r.refresh_token_enc) : null, expiresAt: r.expires_at ? new Date(r.expires_at) : null, meta: typeof r.meta === "string" ? JSON.parse(r.meta) : (r.meta ?? {}) };
}

let lastRefreshCheck = 0;
/** Runs each platform's token refresh, at most every 6 hours; failures are logged per platform. */
export async function refreshTokensIfDue(): Promise<void> {
  if (Date.now() - lastRefreshCheck < 6 * 3600_000) return;
  lastRefreshCheck = Date.now();
  const { logger } = await import("../../../utils/logger");
  for (const [platform, poster] of Object.entries(POSTERS)) {
    if (!poster?.isConfigured() || !poster.refreshToken) continue;
    try { await poster.refreshToken(); }
    catch (err) { logger.error("social.token_refresh_failed", { platform, error: err instanceof Error ? err.message : String(err) }); }
  }
}
