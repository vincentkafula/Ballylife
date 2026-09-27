/**
 * Facebook Page + Instagram Business posting (Meta Graph API).
 *
 * Railway variables (secrets, never in code):
 *   META_APP_SECRET          app secret (Meta dashboard -> Settings -> Basic)
 *   META_USER_ACCESS_TOKEN   a user token from Graph API Explorer, with pages_show_list,
 *                            pages_manage_posts, pages_read_engagement, business_management,
 *                            instagram_basic, instagram_content_publish
 * Optional:
 *   META_APP_ID              found automatically from the token when not set
 *   META_PAGE_ID             which Page to post as, when the token manages several
 *   META_GRAPH_VERSION       default v23.0
 *
 * Token refresh: the user token from Graph API Explorer expires within
 * hours. On first use it is exchanged for a 60-day token, and from that a
 * Page token that doesn't expire; both are stored encrypted in
 * social_tokens. Pasting a new META_USER_ACCESS_TOKEN into Railway
 * reconnects (it's fingerprinted, so a change is noticed). Every 6 hours
 * the Page token is checked and re-derived if Meta invalidated it.
 */
import crypto from "crypto";
import { logger } from "../../../utils/logger";
import { missing, saveToken, storedToken, NonRetryable, type Poster, type PostInput, type PostResult } from "./index";

const GRAPH = () => `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || "v23.0"}`;
const REQUIRED = ["META_APP_SECRET", "META_USER_ACCESS_TOKEN"];
const STORE_KEY = "meta";

export class MetaError extends Error {
  constructor(message: string, public code?: number, public subcode?: number) { super(message); }
}

async function graph(method: "GET" | "POST", path: string, params: Record<string, string>): Promise<any> {
  const body = new URLSearchParams(params);
  const url = method === "GET" ? `${GRAPH()}${path}?${body}` : `${GRAPH()}${path}`;
  const res = await fetch(url, {
    method,
    ...(method === "POST" ? { body, headers: { "Content-Type": "application/x-www-form-urlencoded" } } : {}),
    signal: AbortSignal.timeout(60_000),
  });
  const j = await res.json().catch(() => ({})) as any;
  if (!res.ok || j?.error) {
    const e = j?.error ?? {};
    throw new MetaError(`Meta: ${e.error_user_msg || e.message || `HTTP ${res.status}`}`, e.code, e.error_subcode);
  }
  return j;
}

const fingerprint = (t: string) => crypto.createHash("sha256").update(t).digest("hex").slice(0, 16);
// Token problems (expired / revoked / missing permission) won't fix themselves on retry.
const isAuthError = (e: unknown) => e instanceof MetaError && (e.code === 190 || e.code === 102 || e.code === 10 || e.code === 200);

export interface MetaConnection {
  pageId: string; pageName: string; pageToken: string;
  igId: string | null; igUsername: string | null;
}

/** Exchanges the Railway user token for a long-lived one and finds the Page + Instagram account. */
async function connectFromUserToken(userToken: string): Promise<MetaConnection> {
  const secret = process.env.META_APP_SECRET!.trim();
  const appId = process.env.META_APP_ID?.trim() || String((await graph("GET", "/app", { access_token: userToken })).id);
  let longLived = userToken;
  let userExpires: Date | null = null;
  try {
    const x = await graph("GET", "/oauth/access_token", { grant_type: "fb_exchange_token", client_id: appId, client_secret: secret, fb_exchange_token: userToken });
    longLived = x.access_token;
    userExpires = x.expires_in ? new Date(Date.now() + Number(x.expires_in) * 1000) : null;
  } catch (err) {
    // Already long-lived, or a Page token was pasted: carry on with it as-is.
    logger.warn("social.meta.exchange_skipped", { error: err instanceof Error ? err.message : String(err) });
  }
  const { data } = await graph("GET", "/me/accounts", { access_token: longLived, fields: "id,name,access_token,instagram_business_account{id,username}", limit: "100" });
  const pages = (data ?? []) as any[];
  if (!pages.length) throw new MetaError("The token doesn't manage any Facebook Page. Generate it with pages_show_list and pages_manage_posts, and select your Page when Meta asks.");
  const wanted = process.env.META_PAGE_ID?.trim();
  const page = wanted ? pages.find(p => String(p.id) === wanted) : pages[0];
  if (!page) throw new MetaError(`META_PAGE_ID ${wanted} isn't one of the Pages this token manages (${pages.map(p => `${p.name} ${p.id}`).join(", ")}).`);
  const conn: MetaConnection = {
    pageId: String(page.id), pageName: page.name, pageToken: page.access_token,
    igId: page.instagram_business_account?.id ?? null, igUsername: page.instagram_business_account?.username ?? null,
  };
  await saveToken(STORE_KEY, conn.pageToken, null, longLived, {
    appId, pageId: conn.pageId, pageName: conn.pageName, igId: conn.igId, igUsername: conn.igUsername,
    userTokenExpires: userExpires?.toISOString() ?? null, sourceFingerprint: fingerprint(userToken),
    otherPages: pages.filter(p => p !== page).map(p => ({ id: p.id, name: p.name })),
  });
  logger.info("social.meta.connected", { pageId: conn.pageId, pageName: conn.pageName, igId: conn.igId, igUsername: conn.igUsername, pages: pages.length });
  return conn;
}

let cached: MetaConnection | null = null;
/** The current connection: stored one, or a fresh one when the Railway token is new. */
export async function metaConnection(): Promise<MetaConnection> {
  const envToken = process.env.META_USER_ACCESS_TOKEN?.trim();
  if (!envToken || !process.env.META_APP_SECRET?.trim()) throw new NonRetryable("Facebook/Instagram aren't set up (META_APP_SECRET, META_USER_ACCESS_TOKEN).");
  const stored = await storedToken(STORE_KEY);
  if (stored && stored.meta.sourceFingerprint === fingerprint(envToken) && (!process.env.META_PAGE_ID || stored.meta.pageId === process.env.META_PAGE_ID.trim())) {
    if (!cached || cached.pageToken !== stored.accessToken) {
      cached = { pageId: stored.meta.pageId, pageName: stored.meta.pageName, pageToken: stored.accessToken, igId: stored.meta.igId ?? null, igUsername: stored.meta.igUsername ?? null };
    }
    return cached;
  }
  try {
    cached = await connectFromUserToken(envToken);
  } catch (err) {
    if (isAuthError(err)) throw new NonRetryable(`${(err as Error).message} — generate a new token in Graph API Explorer and paste it into META_USER_ACCESS_TOKEN on Railway.`);
    throw err;
  }
  return cached;
}

/** Checks the Page token still works; re-derives it from the stored 60-day user token if not. */
async function refreshMeta(): Promise<void> {
  const stored = await storedToken(STORE_KEY);
  if (!stored) { await metaConnection(); return; }
  try {
    await graph("GET", `/${stored.meta.pageId}`, { access_token: stored.accessToken, fields: "id" });
  } catch (err) {
    if (!isAuthError(err) || !stored.refreshToken) throw err;
    logger.warn("social.meta.page_token_invalid", { error: (err as Error).message });
    cached = await connectFromUserToken(stored.refreshToken);
  }
}

// ------------------------------------------------------------------ Facebook

/** Posts to the Facebook Page: up to 4 photos in one post, caption with a clickable link. */
export async function postToFacebook({ product, caption }: PostInput): Promise<PostResult> {
  const c = await metaConnection();
  const photos = product.images.slice(0, 4);
  try {
    if (photos.length === 1) {
      const r = await graph("POST", `/${c.pageId}/photos`, { access_token: c.pageToken, url: photos[0], caption, published: "true" });
      const id = String(r.post_id ?? r.id);
      return { externalId: id, externalUrl: `https://www.facebook.com/${id}` };
    }
    const mediaIds: string[] = [];
    for (const url of photos) {
      const r = await graph("POST", `/${c.pageId}/photos`, { access_token: c.pageToken, url, published: "false" });
      mediaIds.push(String(r.id));
    }
    const params: Record<string, string> = { access_token: c.pageToken, message: caption };
    mediaIds.forEach((id, i) => { params[`attached_media[${i}]`] = JSON.stringify({ media_fbid: id }); });
    const r = await graph("POST", `/${c.pageId}/feed`, params);
    return { externalId: String(r.id), externalUrl: `https://www.facebook.com/${r.id}` };
  } catch (err) {
    if (isAuthError(err)) throw new NonRetryable((err as Error).message);
    throw err;
  }
}

// ----------------------------------------------------------------- Instagram

async function waitUntilReady(containerId: string, token: string): Promise<void> {
  for (let i = 0; i < 20; i++) {
    const { status_code } = await graph("GET", `/${containerId}`, { access_token: token, fields: "status_code" });
    if (status_code === "FINISHED") return;
    if (status_code === "ERROR" || status_code === "EXPIRED") throw new MetaError(`Instagram couldn't process the photo (${status_code}). Instagram needs JPEG photos.`);
    await new Promise(r => setTimeout(r, 3000));
  }
  throw new MetaError("Instagram took too long to process the photo.");
}

/** Posts to Instagram: a carousel of up to 5 photos (a single photo when there's only one). */
export async function postToInstagram({ product, caption }: PostInput): Promise<PostResult> {
  const c = await metaConnection();
  if (!c.igId) throw new NonRetryable(`No Instagram Business account is linked to the Facebook Page "${c.pageName}". Link it in Meta Business Suite, then generate a new token.`);
  const token = c.pageToken;
  const photos = product.images.slice(0, 5);
  try {
    let creationId: string;
    if (photos.length === 1) {
      creationId = String((await graph("POST", `/${c.igId}/media`, { access_token: token, image_url: photos[0], caption })).id);
    } else {
      const children: string[] = [];
      for (const url of photos) {
        children.push(String((await graph("POST", `/${c.igId}/media`, { access_token: token, image_url: url, is_carousel_item: "true" })).id));
      }
      for (const id of children) await waitUntilReady(id, token);
      creationId = String((await graph("POST", `/${c.igId}/media`, { access_token: token, media_type: "CAROUSEL", children: children.join(","), caption })).id);
    }
    await waitUntilReady(creationId, token);
    const published = await graph("POST", `/${c.igId}/media_publish`, { access_token: token, creation_id: creationId });
    const mediaId = String(published.id);
    let permalink: string | undefined;
    try { permalink = (await graph("GET", `/${mediaId}`, { access_token: token, fields: "permalink" })).permalink; } catch { /* the post is up; the link is a nice-to-have */ }
    return { externalId: mediaId, externalUrl: permalink };
  } catch (err) {
    if (isAuthError(err)) throw new NonRetryable((err as Error).message);
    throw err;
  }
}

/** What's connected, for the admin panel and the start-up log. Never includes tokens. */
export async function metaStatus() {
  const c = await metaConnection();
  const stored = await storedToken(STORE_KEY);
  return { pageId: c.pageId, pageName: c.pageName, instagramId: c.igId, instagramUsername: c.igUsername,
    otherPages: stored?.meta.otherPages ?? [], userTokenExpires: stored?.meta.userTokenExpires ?? null };
}

export const facebookPoster: Poster = {
  isConfigured: () => missing(REQUIRED).length === 0,
  missingVariables: () => missing(REQUIRED),
  post: postToFacebook,
  refreshToken: refreshMeta,
};

export const instagramPoster: Poster = {
  isConfigured: () => missing(REQUIRED).length === 0,
  missingVariables: () => missing(REQUIRED),
  post: postToInstagram,
};
