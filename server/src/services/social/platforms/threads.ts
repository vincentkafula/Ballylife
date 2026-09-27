/**
 * Threads posting (Threads API, graph.threads.net).
 *
 * Railway variables:
 *   THREADS_ACCESS_TOKEN   secret: from the Meta app dashboard -> Use cases -> Threads ->
 *                          Settings -> User Token Generator (needs threads_basic +
 *                          threads_content_publish; the Threads account must be added
 *                          as a Threads tester while the app is in Development)
 *   THREADS_APP_SECRET     secret: Threads app secret, used to turn a short-lived token
 *                          into a 60-day one (not needed if the token is already long-lived)
 *   THREADS_APP_ID         not secret, informational
 *
 * Token refresh: long-lived Threads tokens last 60 days and can be renewed
 * once they're a day old. Every 6 hours the worker renews the token when it
 * has less than 30 days left, and stores the new one encrypted, so it never
 * lapses as long as the server runs at least once every ~2 months.
 */
import crypto from "crypto";
import { logger } from "../../../utils/logger";
import { missing, saveToken, storedToken, NonRetryable, type Poster, type PostInput, type PostResult } from "./index";

const API = "https://graph.threads.net";
const REQUIRED = ["THREADS_ACCESS_TOKEN"];
const STORE_KEY = "threads";
const DAY = 24 * 3600_000;

export class ThreadsError extends Error {
  constructor(message: string, public code?: number) { super(message); }
}

async function call(method: "GET" | "POST", path: string, params: Record<string, string>): Promise<any> {
  const body = new URLSearchParams(params);
  const res = await fetch(method === "GET" ? `${API}${path}?${body}` : `${API}${path}`, {
    method,
    ...(method === "POST" ? { body, headers: { "Content-Type": "application/x-www-form-urlencoded" } } : {}),
    signal: AbortSignal.timeout(60_000),
  });
  const j = await res.json().catch(() => ({})) as any;
  if (!res.ok || j?.error) {
    const e = j?.error ?? {};
    throw new ThreadsError(`Threads: ${e.error_user_msg || e.message || `HTTP ${res.status}`}`, e.code);
  }
  return j;
}

const fingerprint = (t: string) => crypto.createHash("sha256").update(t).digest("hex").slice(0, 16);
const isAuthError = (e: unknown) => e instanceof ThreadsError && (e.code === 190 || e.code === 10 || e.code === 200);

interface ThreadsConnection { userId: string; username: string; token: string }

async function connectFromEnv(envToken: string): Promise<ThreadsConnection> {
  let token = envToken;
  let expiresAt: Date | null = null;
  const secret = process.env.THREADS_APP_SECRET?.trim();
  if (secret) {
    try {
      const x = await call("GET", "/access_token", { grant_type: "th_exchange_token", client_secret: secret, access_token: envToken });
      token = x.access_token;
      expiresAt = x.expires_in ? new Date(Date.now() + Number(x.expires_in) * 1000) : null;
    } catch (err) {
      // Already a long-lived token (the dashboard's token generator gives those): use as-is.
      logger.warn("social.threads.exchange_skipped", { error: err instanceof Error ? err.message : String(err) });
    }
  }
  const me = await call("GET", "/v1.0/me", { access_token: token, fields: "id,username" });
  const conn = { userId: String(me.id), username: String(me.username ?? ""), token };
  await saveToken(STORE_KEY, token, expiresAt, null, {
    userId: conn.userId, username: conn.username, sourceFingerprint: fingerprint(envToken), obtainedAt: new Date().toISOString(),
  });
  logger.info("social.threads.connected", { userId: conn.userId, username: conn.username, expiresAt: expiresAt?.toISOString() ?? null });
  return conn;
}

let cached: ThreadsConnection | null = null;
export async function threadsConnection(): Promise<ThreadsConnection> {
  const envToken = process.env.THREADS_ACCESS_TOKEN?.trim();
  if (!envToken) throw new NonRetryable("Threads isn't set up (THREADS_ACCESS_TOKEN).");
  const stored = await storedToken(STORE_KEY);
  if (stored && stored.meta.sourceFingerprint === fingerprint(envToken)) {
    if (stored.expiresAt && stored.expiresAt.getTime() < Date.now()) {
      throw new NonRetryable("The Threads token expired. Generate a new one and paste it into THREADS_ACCESS_TOKEN on Railway.");
    }
    if (!cached || cached.token !== stored.accessToken) cached = { userId: stored.meta.userId, username: stored.meta.username, token: stored.accessToken };
    return cached;
  }
  try { cached = await connectFromEnv(envToken); }
  catch (err) {
    if (isAuthError(err)) throw new NonRetryable(`${(err as Error).message} — generate a new Threads token and paste it into THREADS_ACCESS_TOKEN on Railway.`);
    throw err;
  }
  return cached;
}

/** Renews the 60-day token when it has under 30 days left (it must be at least a day old). */
async function refreshThreads(): Promise<void> {
  await threadsConnection();
  const stored = await storedToken(STORE_KEY);
  if (!stored) return;
  const obtained = stored.meta.obtainedAt ? new Date(stored.meta.obtainedAt).getTime() : 0;
  if (Date.now() - obtained < DAY) return;
  const left = stored.expiresAt ? stored.expiresAt.getTime() - Date.now() : 0; // unknown expiry: renew to learn it
  if (stored.expiresAt && left > 30 * DAY) return;
  const x = await call("GET", "/refresh_access_token", { grant_type: "th_refresh_token", access_token: stored.accessToken });
  const expiresAt = x.expires_in ? new Date(Date.now() + Number(x.expires_in) * 1000) : null;
  await saveToken(STORE_KEY, x.access_token, expiresAt, null, { ...stored.meta, obtainedAt: new Date().toISOString() });
  cached = null;
  logger.info("social.threads.token_refreshed", { expiresAt: expiresAt?.toISOString() ?? null });
}

async function waitUntilReady(containerId: string, token: string): Promise<void> {
  for (let i = 0; i < 20; i++) {
    const { status, error_message } = await call("GET", `/v1.0/${containerId}`, { access_token: token, fields: "status,error_message" });
    if (status === "FINISHED") return;
    if (status === "ERROR" || status === "EXPIRED") throw new ThreadsError(`Threads couldn't process the photo (${error_message || status}).`);
    await new Promise(r => setTimeout(r, 3000));
  }
  throw new ThreadsError("Threads took too long to process the photo.");
}

/** Posts to Threads: text (max 500 chars) with one photo, or a carousel of up to 5. */
export async function postToThreads({ product, caption }: PostInput): Promise<PostResult> {
  const c = await threadsConnection();
  const photos = product.images.slice(0, 5);
  try {
    let creationId: string;
    if (photos.length === 1) {
      creationId = String((await call("POST", `/v1.0/${c.userId}/threads`, { access_token: c.token, media_type: "IMAGE", image_url: photos[0], text: caption })).id);
    } else {
      const children: string[] = [];
      for (const url of photos) {
        children.push(String((await call("POST", `/v1.0/${c.userId}/threads`, { access_token: c.token, media_type: "IMAGE", image_url: url, is_carousel_item: "true" })).id));
      }
      for (const id of children) await waitUntilReady(id, c.token);
      creationId = String((await call("POST", `/v1.0/${c.userId}/threads`, { access_token: c.token, media_type: "CAROUSEL", children: children.join(","), text: caption })).id);
    }
    await waitUntilReady(creationId, c.token);
    const published = await call("POST", `/v1.0/${c.userId}/threads_publish`, { access_token: c.token, creation_id: creationId });
    const mediaId = String(published.id);
    let permalink: string | undefined;
    try { permalink = (await call("GET", `/v1.0/${mediaId}`, { access_token: c.token, fields: "permalink" })).permalink; } catch { /* posted; link optional */ }
    return { externalId: mediaId, externalUrl: permalink };
  } catch (err) {
    if (isAuthError(err)) throw new NonRetryable((err as Error).message);
    throw err;
  }
}

export const threadsPoster: Poster = {
  isConfigured: () => missing(REQUIRED).length === 0,
  missingVariables: () => missing(REQUIRED),
  post: postToThreads,
  refreshToken: refreshThreads,
  describe: async () => { const c = await threadsConnection(); return `@${c.username}`; },
};
