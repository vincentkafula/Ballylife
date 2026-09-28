/**
 * "Connect TikTok" / "Connect LinkedIn": the one-time sign-in an admin does
 * from the Social Media tab. The platform redirects back to
 * /api/marketplace/social/oauth/<platform>/callback with a code, which the
 * platform module swaps for tokens (stored encrypted in social_tokens).
 *
 * A random single-use state (10 minutes) ties the callback to a sign-in we
 * started, so nobody can attach their own account to Ballylife's.
 */
import crypto from "crypto";
import { pool } from "../../db/pool";

const API = () => (process.env.PUBLIC_API_URL || "https://ballylife-backend-production.up.railway.app").replace(/\/$/, "");

/** The redirect URI to register in each developer portal. */
export const callbackUrl = (platform: string) => `${API()}/api/marketplace/social/oauth/${platform}/callback`;

export async function newState(platform: string): Promise<string> {
  const state = crypto.randomBytes(24).toString("base64url");
  await pool!.query(`INSERT INTO social_oauth_states (state, platform) VALUES ($1, $2)`, [state, platform]);
  return state;
}

export async function consumeState(state: string, platform: string): Promise<boolean> {
  if (!state) return false;
  const { rows } = await pool!.query(`SELECT platform, created_at FROM social_oauth_states WHERE state = $1`, [state]);
  await pool!.query(`DELETE FROM social_oauth_states WHERE state = $1 OR created_at < now() - interval '1 day'`, [state]);
  return Boolean(rows[0] && rows[0].platform === platform && Date.now() - new Date(rows[0].created_at).getTime() < 10 * 60_000);
}
