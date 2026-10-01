/**
 * LinkedIn posting (Posts API), as either:
 *  - "member" (default): the signed-in person's own profile. Needs the
 *    self-service products "Share on LinkedIn" (w_member_social) and
 *    "Sign In with LinkedIn using OpenID Connect" (to know who they are).
 *  - "organization": the Ballylife Company Page. Needs the Community
 *    Management API, which LinkedIn approves by hand (usually on an app
 *    that has no other products).
 *
 * Railway variables:
 *   LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET   from linkedin.com/developers (secret: Railway only)
 *   LINKEDIN_POST_AS     member (default) | organization
 *   LINKEDIN_ORG_ID      optional -- which Company Page, if you admin several
 *   LINKEDIN_API_VERSION optional -- LinkedIn's monthly API version (YYYYMM)
 *
 * Connect once from the Social Media tab ("Connect LinkedIn"). Access
 * tokens last 60 days; with the Community Management API LinkedIn also
 * issues a refresh token (a year), used automatically. Otherwise the panel
 * shows when to reconnect. Changing LINKEDIN_POST_AS needs a reconnect.
 */
import { logger } from "../../../utils/logger";
import { missing, saveToken, storedToken, NonRetryable, type Poster, type PostInput, type PostResult } from "./index";
import { callbackUrl, newState } from "../oauth";

const REQUIRED = ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"];
const STORE_KEY = "linkedin";
const VERSION = () => process.env.LINKEDIN_API_VERSION?.trim() || "202608";
const DAY = 24 * 3600_000;
export const postAs = (): "member" | "organization" => (/^org/i.test(process.env.LINKEDIN_POST_AS?.trim() ?? "") ? "organization" : "member");

export class LinkedInError extends Error {
  constructor(message: string, public status?: number) { super(message); }
}

async function tokenRequest(params: Record<string, string>): Promise<any> {
  const res = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.LINKEDIN_CLIENT_ID!.trim(), client_secret: process.env.LINKEDIN_CLIENT_SECRET!.trim(), ...params }),
    signal: AbortSignal.timeout(30_000),
  });
  const j = await res.json().catch(() => ({})) as any;
  if (!res.ok || j.error) throw new LinkedInError(`LinkedIn: ${j.error_description || j.error || `HTTP ${res.status}`}`, res.status);
  return j;
}

async function rest(method: "GET" | "POST", path: string, token: string, body?: unknown): Promise<{ json: any; headers: Headers }> {
  const res = await fetch(`https://api.linkedin.com/rest${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`, "LinkedIn-Version": VERSION(), "X-Restli-Protocol-Version": "2.0.0",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30_000),
  });
  const json = await res.json().catch(() => ({})) as any;
  if (!res.ok) throw new LinkedInError(`LinkedIn: ${json.message || `HTTP ${res.status}`}`, res.status);
  return { json, headers: res.headers };
}

async function saveTokens(j: any, meta: Record<string, unknown>): Promise<void> {
  await saveToken(STORE_KEY, j.access_token, new Date(Date.now() + Number(j.expires_in ?? 5184000) * 1000), j.refresh_token ?? null, {
    ...meta, refreshExpiresAt: j.refresh_token_expires_in ? new Date(Date.now() + Number(j.refresh_token_expires_in) * 1000).toISOString() : meta.refreshExpiresAt ?? null,
  });
}

export async function linkedinAuthorizeUrl(): Promise<string> {
  const state = await newState("linkedin");
  const q = new URLSearchParams({
    response_type: "code", client_id: process.env.LINKEDIN_CLIENT_ID!.trim(), redirect_uri: callbackUrl("linkedin"), state,
    scope: postAs() === "organization" ? "w_organization_social r_organization_social rw_organization_admin" : "openid profile w_member_social",
  });
  return `https://www.linkedin.com/oauth/v2/authorization?${q}`;
}

/** The callback: tokens, then who the posts will come from (the person, or which Company Page). */
export async function completeLinkedIn(code: string): Promise<string> {
  const j = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: callbackUrl("linkedin") });
  if (postAs() === "member") {
    const res = await fetch("https://api.linkedin.com/v2/userinfo", { headers: { Authorization: `Bearer ${j.access_token}` }, signal: AbortSignal.timeout(30_000) });
    const me = await res.json().catch(() => ({})) as { sub?: string; name?: string };
    if (!res.ok || !me.sub) throw new LinkedInError("LinkedIn didn't say who signed in — add \"Sign In with LinkedIn using OpenID Connect\" to the app's products.", res.status);
    const author = `urn:li:person:${me.sub}`;
    await saveTokens(j, { org: author, orgName: me.name ?? "", mode: "member", connectedAt: new Date().toISOString() });
    logger.info("social.linkedin.connected", { mode: "member", name: me.name });
    return me.name ? `${me.name} (personal profile)` : "your personal profile";
  }
  const { json } = await rest("GET", "/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED", j.access_token);
  const orgs = ((json.elements ?? []) as any[]).map(e => String(e.organization ?? e.organizationTarget ?? "")).filter(u => u.startsWith("urn:li:organization:"));
  if (!orgs.length) throw new LinkedInError("This LinkedIn account isn't an admin of any Company Page.");
  const wanted = process.env.LINKEDIN_ORG_ID?.trim();
  const org = wanted ? orgs.find(u => u.endsWith(`:${wanted}`)) : orgs[0];
  if (!org) throw new LinkedInError(`LINKEDIN_ORG_ID ${wanted} isn't one of this account's pages (${orgs.join(", ")}).`);
  let name = "";
  try { name = (await rest("GET", `/organizations/${org.split(":").pop()}`, j.access_token)).json.localizedName ?? ""; } catch { /* display only */ }
  await saveTokens(j, { org, orgName: name, otherOrgs: orgs.filter(o => o !== org), mode: "organization", connectedAt: new Date().toISOString() });
  logger.info("social.linkedin.connected", { mode: "organization", org, name });
  return name || org;
}

async function accessToken(): Promise<{ token: string; org: string }> {
  const t = await storedToken(STORE_KEY);
  if (!t) throw new NonRetryable("LinkedIn isn't connected yet — use Connect LinkedIn in the Social Media tab.");
  const org = String(t.meta.org ?? ""); // the post author: urn:li:organization:… or urn:li:person:…
  const savedMode = t.meta.mode === "member" ? "member" : "organization";
  if (savedMode !== postAs()) throw new NonRetryable(`LinkedIn is connected as ${savedMode === "member" ? "a personal profile" : "a company page"} but LINKEDIN_POST_AS is ${postAs()} — use Connect LinkedIn again.`);
  if (t.expiresAt && t.expiresAt.getTime() - Date.now() > 7 * DAY) return { token: t.accessToken, org };
  if (t.refreshToken) {
    try {
      const j = await tokenRequest({ grant_type: "refresh_token", refresh_token: t.refreshToken });
      await saveTokens(j, t.meta);
      logger.info("social.linkedin.token_refreshed");
      return { token: j.access_token, org };
    } catch (err) {
      logger.warn("social.linkedin.refresh_failed", { error: (err as Error).message });
    }
  }
  if (t.expiresAt && t.expiresAt.getTime() > Date.now()) return { token: t.accessToken, org }; // still valid a few more days
  throw new NonRetryable("LinkedIn sign-in expired — use Connect LinkedIn again.");
}

/** LinkedIn's post text treats some characters as markup: escape them, and turn #tags into real hashtags. */
export function littleText(s: string): string {
  const escaped = s.replace(/[\\|{}@[\]()<>*_~]/g, c => `\\${c}`);
  return escaped.replace(/#(\w+)/g, (_m, tag) => `{hashtag|\\#|${tag}}`);
}

async function uploadImage(token: string, org: string, url: string): Promise<string> {
  const photo = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!photo.ok) throw new LinkedInError(`Couldn't fetch the product photo (HTTP ${photo.status}).`);
  const bytes = Buffer.from(await photo.arrayBuffer());
  const { json } = await rest("POST", "/images?action=initializeUpload", token, { initializeUploadRequest: { owner: org } });
  const uploadUrl = json.value?.uploadUrl, image = json.value?.image;
  if (!uploadUrl || !image) throw new LinkedInError("LinkedIn didn't return an upload address.");
  const put = await fetch(uploadUrl, { method: "PUT", headers: { Authorization: `Bearer ${token}` }, body: bytes, signal: AbortSignal.timeout(60_000) });
  if (!put.ok) throw new LinkedInError(`LinkedIn photo upload failed (HTTP ${put.status}).`, put.status);
  return String(image);
}

export async function postToLinkedIn({ product, caption }: PostInput): Promise<PostResult> {
  const { token, org } = await accessToken();
  try {
    const image = product.images[0] ? await uploadImage(token, org, product.images[0]) : null;
    const { headers } = await rest("POST", "/posts", token, {
      author: org,
      commentary: littleText(caption),
      visibility: "PUBLIC",
      distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
      ...(image ? { content: { media: { title: product.name.slice(0, 200), id: image } } } : {}),
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
    });
    const urn = headers.get("x-restli-id") ?? headers.get("x-linkedin-id") ?? "";
    return { externalId: urn || "posted", externalUrl: urn ? `https://www.linkedin.com/feed/update/${urn}` : undefined };
  } catch (err) {
    if (err instanceof LinkedInError && (err.status === 401 || err.status === 403)) throw new NonRetryable(`${err.message} — use Connect LinkedIn again.`);
    throw err;
  }
}

export const linkedinPoster: Poster = {
  isConfigured: () => missing(REQUIRED).length === 0,
  missingVariables: () => missing(REQUIRED),
  post: postToLinkedIn,
  refreshToken: async () => { await accessToken(); },
  describe: async () => {
    const t = await storedToken(STORE_KEY);
    if (!t) throw new Error("Not connected — click Connect LinkedIn.");
    const days = t.expiresAt ? Math.floor((t.expiresAt.getTime() - Date.now()) / DAY) : null;
    const soon = !t.refreshToken && days !== null && days < 10 ? ` (reconnect within ${Math.max(days, 0)} days)` : "";
    return `${t.meta.mode === "member" ? "Profile" : "Page"}: ${t.meta.orgName || t.meta.org}${soon}`;
  },
};
