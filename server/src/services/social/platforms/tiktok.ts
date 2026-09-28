/**
 * TikTok posting (Content Posting API, photo posts).
 *
 * Railway variables:
 *   TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET   from developers.tiktok.com (secret: Railway only)
 *   TIKTOK_VERIFY_FILENAME, TIKTOK_VERIFY_CONTENT
 *        the URL-prefix verification file TikTok gives you, served at
 *        /api/marketplace/media/<filename> so TikTok accepts our photo links
 *
 * Connect once from the Social Media tab ("Connect TikTok"). Access tokens
 * last 24 hours and are renewed automatically with the refresh token (valid
 * a year, renewed on each use).
 *
 * Until TikTok audits the app, TikTok only allows private posts
 * ("Only me"). We always use the most public option TikTok offers the
 * account, so posts become public by themselves once the audit is approved.
 */
import { logger } from "../../../utils/logger";
import { missing, saveToken, storedToken, NonRetryable, type Poster, type PostInput, type PostResult } from "./index";
import { callbackUrl, newState } from "../oauth";

const API = "https://open.tiktokapis.com";
const REQUIRED = ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"];
const STORE_KEY = "tiktok";
const OUR_MEDIA = () => `${(process.env.PUBLIC_API_URL || "https://ballylife-backend-production.up.railway.app").replace(/\/$/, "")}/api/marketplace/media/`;

export class TikTokError extends Error {
  constructor(message: string, public code?: string) { super(message); }
}

async function tokenRequest(params: Record<string, string>): Promise<any> {
  const res = await fetch(`${API}/v2/oauth/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_key: process.env.TIKTOK_CLIENT_KEY!.trim(), client_secret: process.env.TIKTOK_CLIENT_SECRET!.trim(), ...params }),
    signal: AbortSignal.timeout(30_000),
  });
  const j = await res.json().catch(() => ({})) as any;
  if (!res.ok || j.error) throw new TikTokError(`TikTok: ${j.error_description || j.error || `HTTP ${res.status}`}`, j.error);
  return j;
}

async function call(path: string, token: string, body: unknown): Promise<any> {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const j = await res.json().catch(() => ({})) as any;
  if (!res.ok || (j.error && j.error.code && j.error.code !== "ok")) throw new TikTokError(`TikTok: ${j.error?.message || `HTTP ${res.status}`}`, j.error?.code);
  return j.data ?? {};
}

async function saveTokens(j: any, meta: Record<string, unknown>): Promise<void> {
  await saveToken(STORE_KEY, j.access_token, new Date(Date.now() + Number(j.expires_in ?? 86400) * 1000), j.refresh_token ?? null, {
    ...meta, openId: j.open_id ?? meta.openId, refreshExpiresAt: j.refresh_expires_in ? new Date(Date.now() + Number(j.refresh_expires_in) * 1000).toISOString() : meta.refreshExpiresAt ?? null,
  });
}

/** Where the admin is sent to sign in to TikTok. */
export async function tiktokAuthorizeUrl(): Promise<string> {
  const state = await newState("tiktok");
  const q = new URLSearchParams({ client_key: process.env.TIKTOK_CLIENT_KEY!.trim(), scope: "user.info.basic,video.publish", response_type: "code", redirect_uri: callbackUrl("tiktok"), state });
  return `https://www.tiktok.com/v2/auth/authorize/?${q}`;
}

/** The callback: swaps the code for tokens and remembers which account it is. */
export async function completeTikTok(code: string): Promise<string> {
  const j = await tokenRequest({ code, grant_type: "authorization_code", redirect_uri: callbackUrl("tiktok") });
  let username = "";
  try {
    const res = await fetch(`${API}/v2/user/info/?fields=open_id,display_name`, { headers: { Authorization: `Bearer ${j.access_token}` }, signal: AbortSignal.timeout(20_000) });
    const u = await res.json() as any;
    username = u?.data?.user?.display_name || ""; // "username" needs the extra user.info.profile scope
  } catch { /* the name is only for display */ }
  await saveTokens(j, { username, connectedAt: new Date().toISOString() });
  logger.info("social.tiktok.connected", { username });
  return username;
}

/** A valid access token, renewed first if it expires within the hour. */
async function accessToken(): Promise<string> {
  const t = await storedToken(STORE_KEY);
  if (!t) throw new NonRetryable("TikTok isn't connected yet — use Connect TikTok in the Social Media tab.");
  if (t.expiresAt && t.expiresAt.getTime() - Date.now() > 3600_000) return t.accessToken;
  if (!t.refreshToken) throw new NonRetryable("TikTok sign-in expired — use Connect TikTok again.");
  try {
    const j = await tokenRequest({ grant_type: "refresh_token", refresh_token: t.refreshToken });
    await saveTokens(j, t.meta);
    logger.info("social.tiktok.token_refreshed");
    return j.access_token;
  } catch (err) {
    throw new NonRetryable(`${(err as Error).message} — use Connect TikTok again.`);
  }
}

export async function postToTikTok({ product, caption }: PostInput): Promise<PostResult> {
  const token = await accessToken();
  // TikTok only fetches photos from the URL prefix we verified: our own photo proxy.
  const photos = product.images.filter(u => u.startsWith(OUR_MEDIA())).slice(0, 10);
  if (!photos.length) throw new NonRetryable("No photos on Ballylife's verified photo address for this product.");
  const creator = await call("/v2/post/publish/creator_info/query/", token, {});
  const options: string[] = creator.privacy_level_options ?? [];
  const privacy = ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"].find(o => options.includes(o)) ?? "SELF_ONLY";
  const title = `${product.name}`.slice(0, 90);
  const data = await call("/v2/post/publish/content/init/", token, {
    post_info: { title, description: caption.slice(0, 4000), privacy_level: privacy, disable_comment: false, auto_add_music: true },
    source_info: { source: "PULL_FROM_URL", photo_cover_index: 0, photo_images: photos },
    post_mode: "DIRECT_POST",
    media_type: "PHOTO",
  });
  const publishId = String(data.publish_id ?? "");
  if (!publishId) throw new TikTokError("TikTok didn't return a publish id.");
  logger.info("social.tiktok.submitted", { publishId, privacy });
  // TikTok finishes processing in the background; the post id arrives later, so the publish id is what we keep.
  return { externalId: publishId };
}

export const tiktokPoster: Poster = {
  isConfigured: () => missing(REQUIRED).length === 0,
  missingVariables: () => missing(REQUIRED),
  post: postToTikTok,
  refreshToken: async () => { await accessToken(); },
  describe: async () => {
    const t = await storedToken(STORE_KEY);
    if (!t) throw new Error("Not connected — click Connect TikTok.");
    return `@${t.meta.username || "connected"}`;
  },
};
