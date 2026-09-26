/**
 * AliExpress Open Platform client (Drop Shipping API), server-side only.
 *
 *   ALIEXPRESS_APP_KEY / ALIEXPRESS_APP_SECRET   from the app in the AliExpress App Console
 *
 * Requests go to the Singapore gateway and are signed with HMAC-SHA256 of the
 * sorted parameters (prefixed with the API path for /rest routes), as the
 * platform requires. Buyer-account APIs need a session token obtained through
 * OAuth ("Connect AliExpress" in the admin panel); tokens are stored
 * encrypted and refreshed automatically before they expire.
 */
import crypto from "crypto";
import { pool } from "../db/pool";
import { logger } from "../utils/logger";

const SYNC_URL = "https://api-sg.aliexpress.com/sync";
const REST_URL = "https://api-sg.aliexpress.com/rest";
const AUTHORIZE_URL = "https://api-sg.aliexpress.com/oauth/authorize";
export const ALIEXPRESS_CALLBACK_PATH = "/api/marketplace/aliexpress/oauth/callback";

export function isAliExpressConfigured(): boolean {
  return Boolean(process.env.ALIEXPRESS_APP_KEY?.trim() && process.env.ALIEXPRESS_APP_SECRET?.trim());
}

export class AliExpressError extends Error {
  constructor(message: string, readonly code?: string, readonly kind: "config" | "auth" | "api" | "http" | "not_connected" = "api") {
    super(message);
  }
}

const appKey = () => process.env.ALIEXPRESS_APP_KEY?.trim() ?? "";
const appSecret = () => process.env.ALIEXPRESS_APP_SECRET?.trim() ?? "";

export function callbackUrl(): string {
  const base = (process.env.ALIEXPRESS_CALLBACK_BASE_URL || process.env.PUBLIC_API_URL || "https://ballylife-backend-production.up.railway.app").replace(/\/$/, "");
  return `${base}${ALIEXPRESS_CALLBACK_PATH}`;
}

/** HMAC-SHA256 signature over the sorted parameters (with the API path first for /rest routes). */
export function signParams(params: Record<string, string>, apiPath = "", secret = appSecret()): string {
  const base = apiPath + Object.keys(params).filter(k => params[k] !== undefined && params[k] !== null).sort().map(k => k + params[k]).join("");
  return crypto.createHmac("sha256", secret).update(base, "utf8").digest("hex").toUpperCase();
}

type Json = Record<string, any>;

async function send(url: string, params: Record<string, string>): Promise<Json> {
  const body = new URLSearchParams(params);
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" }, body, signal: AbortSignal.timeout(30_000) });
  } catch (err) {
    throw new AliExpressError(`AliExpress request failed: ${err instanceof Error ? err.message : String(err)}`, undefined, "http");
  }
  const text = await res.text();
  let json: Json;
  try { json = JSON.parse(text); } catch { throw new AliExpressError(`AliExpress returned non-JSON (HTTP ${res.status}): ${text.slice(0, 200)}`, undefined, "http"); }
  const err = json.error_response ?? (json.code && json.code !== "0" && json.code !== 0 && !json.access_token ? json : null);
  if (err) {
    const code = String(err.code ?? err.sub_code ?? "");
    const msg = [err.msg ?? err.message, err.sub_msg].filter(Boolean).join(" — ") || "unknown error";
    const kind = /token|session|auth|IllegalAccessToken|InvalidSession/i.test(`${code} ${msg}`) ? "auth" : "api";
    throw new AliExpressError(`AliExpress ${code}: ${msg}`, code, kind);
  }
  return json;
}

/** Calls a business API method (e.g. aliexpress.ds.product.get). `session` = the buyer account's access token. */
export async function callMethod(method: string, apiParams: Record<string, unknown>, session?: string): Promise<Json> {
  if (!isAliExpressConfigured()) throw new AliExpressError("ALIEXPRESS_APP_KEY / ALIEXPRESS_APP_SECRET aren't set", undefined, "config");
  const params: Record<string, string> = {
    method, app_key: appKey(), sign_method: "sha256", timestamp: String(Date.now()), format: "json", v: "2.0",
    ...(session ? { session } : {}),
  };
  for (const [k, v] of Object.entries(apiParams)) if (v !== undefined && v !== null) params[k] = typeof v === "object" ? JSON.stringify(v) : String(v);
  params.sign = signParams(params);
  return send(SYNC_URL, params);
}

/** Calls a /rest system route (token create/refresh). */
async function callRest(path: string, apiParams: Record<string, string>): Promise<Json> {
  if (!isAliExpressConfigured()) throw new AliExpressError("ALIEXPRESS_APP_KEY / ALIEXPRESS_APP_SECRET aren't set", undefined, "config");
  const params: Record<string, string> = { app_key: appKey(), sign_method: "sha256", timestamp: String(Date.now()), ...apiParams };
  params.sign = signParams(params, path);
  return send(`${REST_URL}${path}`, params);
}

// ── Token storage (encrypted) ───────────────────────────────────────────

function key(): Buffer {
  const secret = process.env.ALIEXPRESS_TOKEN_KEY || process.env.MARKETPLACE_JWT_SECRET || "ballylife-dev-secret-change-in-prod";
  return crypto.createHash("sha256").update(`${secret}:aliexpress-tokens`).digest();
}
export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map(b => b.toString("base64")).join(".");
}
export function decrypt(blob: string): string {
  const [iv, tag, enc] = blob.split(".").map(s => Buffer.from(s, "base64"));
  const d = crypto.createDecipheriv("aes-256-gcm", key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}

interface TokenResponse { access_token?: string; refresh_token?: string; expire_time?: number; expires_in?: number; refresh_token_valid_time?: number; refresh_expires_in?: number; account?: string; user_nick?: string }

const toDate = (ms?: number, secondsFromNow?: number) =>
  ms && ms > 1e12 ? new Date(ms) : secondsFromNow ? new Date(Date.now() + secondsFromNow * 1000) : null;

async function saveTokens(t: TokenResponse, userId: string | null): Promise<void> {
  if (!t.access_token) throw new AliExpressError("AliExpress didn't return an access token", undefined, "auth");
  const values = [encrypt(t.access_token), t.refresh_token ? encrypt(t.refresh_token) : null, toDate(t.expire_time, t.expires_in),
    toDate(t.refresh_token_valid_time, t.refresh_expires_in), t.account ?? t.user_nick ?? null];
  const { rows } = await pool!.query(`SELECT 1 FROM aliexpress_auth WHERE id = 'default'`);
  if (rows.length) {
    await pool!.query(
      `UPDATE aliexpress_auth SET access_token_enc = $1, refresh_token_enc = COALESCE($2, refresh_token_enc), expires_at = $3, refresh_expires_at = COALESCE($4, refresh_expires_at),
         account = COALESCE($5, account), updated_at = now()${userId ? ", connected_by = $6, connected_at = now()" : ""} WHERE id = 'default'`,
      userId ? [...values, userId] : values
    );
  } else {
    await pool!.query(
      `INSERT INTO aliexpress_auth (id, access_token_enc, refresh_token_enc, expires_at, refresh_expires_at, account, connected_by) VALUES ('default', $1, $2, $3, $4, $5, $6)`,
      [...values, userId]
    );
  }
}

// ── OAuth ───────────────────────────────────────────────────────────────

/** The URL the admin opens to link the AliExpress buyer account. */
export async function authorizeUrl(userId: string): Promise<string> {
  if (!isAliExpressConfigured()) throw new AliExpressError("ALIEXPRESS_APP_KEY / ALIEXPRESS_APP_SECRET aren't set", undefined, "config");
  const state = crypto.randomBytes(24).toString("hex");
  await pool!.query(`DELETE FROM aliexpress_oauth_states WHERE created_at < $1`, [new Date(Date.now() - 3600_000)]);
  await pool!.query(`INSERT INTO aliexpress_oauth_states (state, user_id) VALUES ($1, $2)`, [state, userId]);
  const q = new URLSearchParams({ response_type: "code", force_auth: "true", redirect_uri: callbackUrl(), client_id: appKey(), state });
  return `${AUTHORIZE_URL}?${q}`;
}

/** Completes the connect flow: checks the one-time state, exchanges the code for tokens. */
export async function completeAuthorization(code: string, state: string): Promise<{ account: string | null }> {
  const { rows } = await pool!.query(`DELETE FROM aliexpress_oauth_states WHERE state = $1 AND created_at > $2 RETURNING user_id`, [state, new Date(Date.now() - 3600_000)]);
  if (!rows.length) throw new AliExpressError("This connect link has expired — start again from the admin panel.", undefined, "auth");
  const t = (await callRest("/auth/token/create", { code })) as TokenResponse;
  await saveTokens(t, rows[0].user_id);
  logger.info("aliexpress.connected", { account: t.account ?? t.user_nick ?? null });
  return { account: t.account ?? t.user_nick ?? null };
}

export async function disconnect(): Promise<void> {
  await pool!.query(`DELETE FROM aliexpress_auth WHERE id = 'default'`);
}

export async function connectionStatus(): Promise<{ configured: boolean; connected: boolean; account: string | null; expiresAt: string | null; refreshExpiresAt: string | null }> {
  const { rows } = await pool!.query(`SELECT account, expires_at, refresh_expires_at FROM aliexpress_auth WHERE id = 'default'`);
  const r = rows[0];
  return {
    configured: isAliExpressConfigured(), connected: Boolean(r), account: r?.account ?? null,
    expiresAt: r?.expires_at ? new Date(r.expires_at).toISOString() : null,
    refreshExpiresAt: r?.refresh_expires_at ? new Date(r.refresh_expires_at).toISOString() : null,
  };
}

/** A valid session token, refreshed when it's within a day of expiring. */
export async function getSession(): Promise<string> {
  const { rows } = await pool!.query(`SELECT * FROM aliexpress_auth WHERE id = 'default'`);
  const r = rows[0];
  if (!r) throw new AliExpressError("AliExpress isn't connected — use Connect AliExpress in the admin panel.", undefined, "not_connected");
  const expiring = r.expires_at && new Date(r.expires_at).getTime() - Date.now() < 86400_000;
  if (expiring && r.refresh_token_enc) {
    try {
      const t = (await callRest("/auth/token/refresh", { refresh_token: decrypt(r.refresh_token_enc) })) as TokenResponse;
      await saveTokens(t, null);
      logger.info("aliexpress.token_refreshed", {});
      return t.access_token!;
    } catch (err) {
      logger.error("aliexpress.token_refresh_failed", { error: err instanceof Error ? err.message : String(err) });
      if (new Date(r.expires_at).getTime() < Date.now()) throw new AliExpressError("The AliExpress connection has expired — reconnect it in the admin panel.", undefined, "auth");
    }
  }
  return decrypt(r.access_token_enc);
}

/** Business call with the connected account's session. */
export async function callAsBuyer(method: string, params: Record<string, unknown>): Promise<Json> {
  return callMethod(method, params, await getSession());
}
