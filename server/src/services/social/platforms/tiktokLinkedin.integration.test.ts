import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import request from "supertest";
import express, { type Express } from "express";
import { createTestDb } from "../../../test/testDb";

const { pool } = createTestDb();
vi.mock("../../../db/pool", () => ({ pool, hasDb: true }));

type Call = { url: string; method: string; body: any; headers: Record<string, string> };
let calls: Call[] = [];
let tiktokPrivacy = ["SELF_ONLY"];
let linkedinStatus = 201;

function fakeApis() {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const raw = init?.body;
    const body = raw instanceof URLSearchParams ? Object.fromEntries(raw)
      : typeof raw === "string" ? (raw.startsWith("{") ? JSON.parse(raw) : Object.fromEntries(new URLSearchParams(raw)))
      : raw ? "<bytes>" : null;
    calls.push({ url, method, body, headers: (init?.headers ?? {}) as Record<string, string> });
    const json = (b: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(b), { status, headers });
    // TikTok
    if (url === "https://open.tiktokapis.com/v2/oauth/token/") {
      return json({ access_token: `tt-access-${calls.length}`, refresh_token: "tt-refresh", expires_in: 86400, refresh_expires_in: 31536000, open_id: "open-1" });
    }
    if (url.startsWith("https://open.tiktokapis.com/v2/user/info/")) return json({ data: { user: { display_name: "ballylife" } }, error: { code: "ok" } });
    if (url.endsWith("/creator_info/query/")) return json({ data: { privacy_level_options: tiktokPrivacy }, error: { code: "ok" } });
    if (url.endsWith("/content/init/")) return json({ data: { publish_id: "p_pub_1" }, error: { code: "ok" } });
    // LinkedIn
    if (url === "https://www.linkedin.com/oauth/v2/accessToken") return json({ access_token: "li-access", expires_in: 5184000, refresh_token: "li-refresh", refresh_token_expires_in: 31536000 });
    if (url.includes("/rest/organizationAcls")) return json({ elements: [{ organization: "urn:li:organization:777", role: "ADMINISTRATOR" }] });
    if (url.includes("/rest/organizations/777")) return json({ localizedName: "Ballylife" });
    if (url.includes("/rest/images?action=initializeUpload")) return json({ value: { uploadUrl: "https://upload.linkedin.test/img", image: "urn:li:image:ABC" } });
    if (url === "https://upload.linkedin.test/img") return new Response(null, { status: 201 });
    if (url.endsWith("/rest/posts")) return linkedinStatus === 201 ? json({}, 201, { "x-restli-id": "urn:li:share:999" }) : json({ message: "Token revoked" }, linkedinStatus);
    if (url.startsWith("https://api.test/")) return new Response(Buffer.from("JPEG"), { status: 200 });
    return json({ error: `unexpected ${url}` }, 404);
  }));
}

let app: Express;
const product = (images: string[]) => ({ id: "p1", name: "Wireless Earbuds Pro", priceZar: 349, compareAtZar: null, description: "", url: "https://www.ballylife.com/product/p1", images, category: null });

beforeAll(async () => {
  Object.assign(process.env, {
    TIKTOK_CLIENT_KEY: "tt-key", TIKTOK_CLIENT_SECRET: "tt-secret", LINKEDIN_CLIENT_ID: "li-id", LINKEDIN_CLIENT_SECRET: "li-secret",
    PUBLIC_API_URL: "https://api.test", MARKETPLACE_PUBLIC_URL: "https://shop.test",
    TIKTOK_VERIFY_FILENAME: "tiktokABC123.txt", TIKTOK_VERIFY_CONTENT: "tiktok-developers-site-verification=ABC123",
  });
  fakeApis();
  const socialRouter = (await import("../../../routes/socialRouter")).default;
  app = express();
  app.use(express.json());
  app.use("/api/marketplace", socialRouter);
});
beforeEach(() => { calls = []; linkedinStatus = 201; });

describe("Connect TikTok / LinkedIn", () => {
  it("builds the sign-in link with our callback and a one-time state", async () => {
    const { tiktokAuthorizeUrl } = await import("./tiktok");
    const u = new URL(await tiktokAuthorizeUrl());
    expect(u.searchParams.get("client_key")).toBe("tt-key");
    expect(u.searchParams.get("redirect_uri")).toBe("https://api.test/api/marketplace/social/oauth/tiktok/callback");
    expect(u.searchParams.get("scope")).toBe("user.info.basic,video.publish");
    expect(u.searchParams.get("state")).toHaveLength(32);
  });

  it("refuses a callback without a state we issued", async () => {
    const r = await request(app).get("/api/marketplace/social/oauth/tiktok/callback").query({ code: "abc", state: "made-up" });
    expect(r.status).toBe(302);
    expect(r.headers.location).toMatch(/social=tiktok&result=error/);
    expect(calls).toHaveLength(0);
  });

  it("completes TikTok and LinkedIn sign-ins and stores the tokens encrypted", async () => {
    const { newState } = await import("../oauth");
    let r = await request(app).get("/api/marketplace/social/oauth/tiktok/callback").query({ code: "abc", state: await newState("tiktok") });
    expect(r.headers.location).toBe("https://shop.test/admin?social=tiktok&result=connected");
    r = await request(app).get("/api/marketplace/social/oauth/linkedin/callback").query({ code: "def", state: await newState("linkedin") });
    expect(r.headers.location).toBe("https://shop.test/admin?social=linkedin&result=connected");
    const { rows } = await pool.query(`SELECT platform, access_token_enc, meta FROM social_tokens ORDER BY platform`);
    expect(rows.map((x: any) => x.platform)).toEqual(["linkedin", "tiktok"]);
    expect(rows.every((x: any) => !String(x.access_token_enc).includes("access"))).toBe(true);
    expect(rows[0].meta.org).toBe("urn:li:organization:777");
    const { tiktokPoster } = await import("./tiktok");
    const { linkedinPoster } = await import("./linkedin");
    expect(await tiktokPoster.describe!()).toBe("@ballylife");
    expect(await linkedinPoster.describe!()).toBe("Page: Ballylife");
  });
});

describe("posting", () => {
  it("TikTok: photo post from our verified photo address, as public as the account allows", async () => {
    const { postToTikTok } = await import("./tiktok");
    const r = await postToTikTok({ product: product(["https://api.test/api/marketplace/media/p/p1/0", "https://other.cdn/x.jpg"]), caption: "Earbuds for R349 🔥" });
    expect(r.externalId).toBe("p_pub_1");
    const init = calls.find(c => c.url.endsWith("/content/init/"))!;
    expect(init.body).toMatchObject({
      media_type: "PHOTO", post_mode: "DIRECT_POST",
      post_info: { privacy_level: "SELF_ONLY", title: "Wireless Earbuds Pro" },
      source_info: { source: "PULL_FROM_URL", photo_images: ["https://api.test/api/marketplace/media/p/p1/0"] },
    });
    tiktokPrivacy = ["SELF_ONLY", "PUBLIC_TO_EVERYONE"]; // after TikTok's audit
    calls = [];
    await postToTikTok({ product: product(["https://api.test/api/marketplace/media/p/p1/0"]), caption: "x" });
    expect(calls.find(c => c.url.endsWith("/content/init/"))!.body.post_info.privacy_level).toBe("PUBLIC_TO_EVERYONE");
  });

  it("TikTok: refuses products without photos on our address, and renews an expiring token", async () => {
    const { postToTikTok } = await import("./tiktok");
    const { NonRetryable } = await import("./index");
    await expect(postToTikTok({ product: product(["https://other.cdn/x.jpg"]), caption: "x" })).rejects.toBeInstanceOf(NonRetryable);
    await pool.query(`UPDATE social_tokens SET expires_at = now() + interval '10 minutes' WHERE platform = 'tiktok'`);
    calls = [];
    await postToTikTok({ product: product(["https://api.test/api/marketplace/media/p/p1/0"]), caption: "x" });
    const refresh = calls.find(c => c.url === "https://open.tiktokapis.com/v2/oauth/token/")!;
    expect(refresh.body).toMatchObject({ grant_type: "refresh_token", refresh_token: "tt-refresh" });
  });

  it("LinkedIn: uploads the photo and posts to the Company Page with escaped text and real hashtags", async () => {
    const { postToLinkedIn } = await import("./linkedin");
    const r = await postToLinkedIn({ product: product(["https://api.test/api/marketplace/media/p/p1/0"]), caption: "New at Ballylife: Earbuds (wireless)\n\n#Ballylife #ShopOnline" });
    expect(r).toEqual({ externalId: "urn:li:share:999", externalUrl: "https://www.linkedin.com/feed/update/urn:li:share:999" });
    const post = calls.find(c => c.url.endsWith("/rest/posts"))!;
    expect(post.headers["LinkedIn-Version"]).toMatch(/^\d{6}$/);
    expect(post.body).toMatchObject({ author: "urn:li:organization:777", visibility: "PUBLIC", lifecycleState: "PUBLISHED", content: { media: { id: "urn:li:image:ABC" } } });
    expect(post.body.commentary).toBe("New at Ballylife: Earbuds \\(wireless\\)\n\n{hashtag|\\#|Ballylife} {hashtag|\\#|ShopOnline}");
    expect(calls.find(c => c.url === "https://upload.linkedin.test/img")?.method).toBe("PUT");
  });

  it("LinkedIn: a revoked sign-in isn't retried", async () => {
    linkedinStatus = 401;
    const { postToLinkedIn } = await import("./linkedin");
    const { NonRetryable } = await import("./index");
    await expect(postToLinkedIn({ product: product(["https://api.test/api/marketplace/media/p/p1/0"]), caption: "x" })).rejects.toBeInstanceOf(NonRetryable);
  });
});

describe("TikTok photo address verification", () => {
  it("serves TikTok's verification file at the start of our photo addresses", async () => {
    const r = await request(app).get("/api/marketplace/media/tiktokABC123.txt");
    expect(r.status).toBe(200);
    expect(r.text).toBe("tiktok-developers-site-verification=ABC123");
    expect((await request(app).get("/api/marketplace/media/other.txt")).status).toBe(404);
  });
});
