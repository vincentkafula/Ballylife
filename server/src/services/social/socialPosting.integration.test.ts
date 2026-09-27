import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { createTestDb } from "../../test/testDb";
import { captionFor, type SocialProduct } from "./socialCaptions";

const { pool } = createTestDb();
vi.mock("../../db/pool", () => ({ pool, hasDb: true }));

let S: typeof import("./socialPosting");
let POSTERS: typeof import("./platforms").POSTERS;
const calls: Record<string, number> = { facebook: 0, instagram: 0 };
let igFails = false;
const ids: string[] = [];

beforeAll(async () => {
  process.env.SOCIAL_DAILY_CAP = "2";
  process.env.SOCIAL_HOURS = "0-24";
  process.env.SOCIAL_AUTOPOST = "on";
  S = await import("./socialPosting");
  POSTERS = (await import("./platforms")).POSTERS;
  POSTERS.facebook = { isConfigured: () => true, missingVariables: () => [], post: async () => ({ externalId: `fb-${++calls.facebook}` }) };
  POSTERS.instagram = { isConfigured: () => true, missingVariables: () => [],
    post: async () => { calls.instagram++; if (igFails) throw new Error("token expired"); return { externalId: `ig-${calls.instagram}` }; } };

  const q = (sql: string, p: unknown[] = []) => pool.query(sql, p);
  await q(`INSERT INTO mkt_categories (id, name, slug, icon) VALUES ('cat-01','Home & Décor','home','🏠')`);
  await q(`INSERT INTO mkt_sellers (id, store_name, store_slug, status) VALUES ('sel-ballylife','Ballylife','ballylife','active')`);
  for (const [name, sold, images] of [["Desk Fan", 50, '["https://ae01.alicdn.com/a.jpg"]'], ["LED Strip", 5, '["https://ae01.alicdn.com/b.jpg"]'], ["Placeholder", 900, '["#111","#222"]'], ["Mug", 0, '["https://ae01.alicdn.com/c.jpg"]']] as const) {
    ids.push((await q(`INSERT INTO mkt_products (seller_id, category_id, name, slug, price, images, status, total_sold, description) VALUES ('sel-ballylife','cat-01',$1,$2,199,$3,'active',$4,'Keeps you cool. Quiet motor.') RETURNING id`, [name, name.toLowerCase().replace(/ /g, "-"), images, sold])).rows[0].id);
  }
});

beforeEach(() => { igFails = false; });

describe("social auto-posting", () => {
  it("only lists platforms that are set up", () => {
    expect(S.activePlatforms()).toEqual(["facebook", "instagram"]);
    const st = S.platformStatus();
    expect(st.find(p => p.platform === "linkedin")).toMatchObject({ built: false, active: false });
  });

  it("picks the best new products with real photos, best seller first", async () => {
    const picked = await S.pickBestNew("facebook", 5);
    expect(picked[0]).toBe(ids[0]);
    expect(picked).not.toContain(ids[2]); // colour placeholder, nothing to post
  });

  it("posts to each platform independently and logs every attempt", async () => {
    igFails = true;
    expect(await S.planAutoPosts()).toBe(2);
    const r = await S.processDuePosts();
    expect(r).toEqual({ posted: 1, failed: 1 });
    const log = await S.recentPosts();
    expect(log.find(p => p.platform === "facebook")).toMatchObject({ status: "posted", externalId: "fb-1", productName: "Desk Fan" });
    expect(log.find(p => p.platform === "instagram")).toMatchObject({ status: "queued", lastError: "token expired", attempts: 1 });
  });

  it("spreads posts out and respects the daily cap", async () => {
    expect(await S.planAutoPosts()).toBe(0); // too soon after the last one
    const later = new Date(Date.now() + 13 * 3600_000);
    await S.planAutoPosts(later);
    await S.planAutoPosts(new Date(later.getTime() + 13 * 3600_000));
    const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM social_posts WHERE platform = 'facebook' AND trigger = 'auto'`);
    expect(rows[0].n).toBeLessThanOrEqual(3);
  });

  it("Share now posts straight away and never posts the same product twice", async () => {
    const out = await S.shareNow(ids[3], ["facebook"]);
    expect(out).toEqual({ facebook: "queued" });
    await new Promise(r => setTimeout(r, 50));
    await S.processDuePosts();
    expect(await S.shareNow(ids[3], ["facebook"])).toEqual({ facebook: "already_posted" });
    await expect(S.shareNow(ids[2])).rejects.toThrow(/no photos/);
  });

  it("stops retrying after 3 attempts and can be retried by hand", async () => {
    igFails = true;
    await pool.query(`UPDATE social_posts SET scheduled_for = now() - interval '1 minute' WHERE platform = 'instagram' AND status = 'queued'`);
    await S.processDuePosts();
    await pool.query(`UPDATE social_posts SET scheduled_for = now() - interval '1 minute' WHERE platform = 'instagram' AND status = 'queued'`);
    await S.processDuePosts();
    const row = (await pool.query(`SELECT id, status, attempts FROM social_posts WHERE platform = 'instagram' AND product_id = $1`, [ids[0]])).rows[0];
    expect(row).toMatchObject({ status: "failed", attempts: 3 });
    igFails = false;
    expect(await S.retryPost(row.id)).toBe(true);
    await S.processDuePosts();
    expect((await pool.query(`SELECT status FROM social_posts WHERE id = $1`, [row.id])).rows[0].status).toBe("posted");
  });
});

describe("captions", () => {
  const p: SocialProduct = { id: "x", name: "USB Desk Fan", priceZar: 199, compareAtZar: 299, description: "Keeps you cool. Quiet motor.", url: "https://www.ballylife.com/product/x", images: [], category: "Home & Décor" };
  it("fits each platform", () => {
    expect(captionFor("facebook", p)).toContain("https://www.ballylife.com/product/x");
    expect(captionFor("instagram", p)).toContain("link in our bio");
    expect(captionFor("instagram", p)).not.toContain("https://");
    expect(captionFor("instagram", p)).toContain("#HomeAndDecor");
    expect(captionFor("facebook", p)).toContain("R199 (was R299)");
    expect(captionFor("threads", { ...p, description: "x".repeat(3000), name: "Fan ".repeat(200) }).length).toBeLessThanOrEqual(500);
    expect(captionFor("linkedin", p)).not.toMatch(/[✨💰🛒🔥]/u);
  });
});
