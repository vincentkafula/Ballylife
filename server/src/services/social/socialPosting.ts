/**
 * Social media auto-posting: picks the best new arrivals and posts them to
 * each connected platform, capped per platform per day and spread through
 * the day, plus "Share now" for any product from the admin dashboard.
 *
 * Every platform is an independent Poster (see ./platforms). A platform
 * only takes part when its Railway variables are set, and one failing
 * (expired token, API outage, rejected image) never stops the others:
 * each (product, platform) pair is its own row in social_posts, which is
 * both the queue and the log.
 *
 * Settings (Railway variables):
 *   SOCIAL_AUTOPOST          "on" starts automatic posting (off until then; Share now always works)
 *   SOCIAL_DAILY_CAP         posts per platform per day (default 5)
 *   SOCIAL_HOURS             posting window, South African time (default "8-20")
 *   SOCIAL_DISABLED          comma list of platforms to leave out, e.g. "linkedin"
 *   SOCIAL_NEW_WITHIN_DAYS   how new a product must be to auto-post (default 7)
 */
import { pool } from "../../db/pool";
import { logger } from "../../utils/logger";
import { captionFor, PLATFORMS, type PlatformId, type SocialProduct } from "./socialCaptions";
import { POSTERS, NonRetryable, type PostResult } from "./platforms";
import { facebookPoster, instagramPoster } from "./platforms/meta";
import { threadsPoster } from "./platforms/threads";
import { tiktokPoster } from "./platforms/tiktok";
import { linkedinPoster } from "./platforms/linkedin";

POSTERS.facebook = facebookPoster;
POSTERS.instagram = instagramPoster;
POSTERS.threads = threadsPoster;
POSTERS.tiktok = tiktokPoster;
POSTERS.linkedin = linkedinPoster;
export { NonRetryable };

type Row = Record<string, any>;

const SITE = (process.env.MARKETPLACE_PUBLIC_URL || "https://www.ballylife.com").replace(/\/$/, "");
// Platforms fetch the photo themselves, so it must be a public URL. Our own
// photo proxy serves it without revealing the supplier.
const API = (process.env.PUBLIC_API_URL || "https://ballylife-backend-production.up.railway.app").replace(/\/$/, "");
const MAX_ATTEMPTS = 3;

const num = (v: string | undefined, d: number) => (Number.isFinite(Number(v)) && v !== "" && v != null ? Number(v) : d);
export const autopostOn = () => (process.env.SOCIAL_AUTOPOST ?? "off").toLowerCase() === "on";
export const dailyCap = () => Math.max(0, num(process.env.SOCIAL_DAILY_CAP, 5));
const newWithinDays = () => Math.max(1, num(process.env.SOCIAL_NEW_WITHIN_DAYS, 7));
function postingHours(): [number, number] {
  const m = /^(\d{1,2})\s*-\s*(\d{1,2})$/.exec(process.env.SOCIAL_HOURS ?? "");
  return m ? [Number(m[1]), Number(m[2])] : [8, 20];
}
const SAST_OFFSET_H = 2; // South Africa has no daylight saving

/** Platforms that are set up (variables present) and not switched off. */
export function activePlatforms(): PlatformId[] {
  const off = new Set((process.env.SOCIAL_DISABLED ?? "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean));
  return PLATFORMS.filter(p => POSTERS[p]?.isConfigured() && !off.has(p));
}

export function platformStatus() {
  const active = new Set(activePlatforms());
  return PLATFORMS.map(p => ({
    platform: p,
    built: Boolean(POSTERS[p]),
    configured: Boolean(POSTERS[p]?.isConfigured()),
    active: active.has(p),
    missing: POSTERS[p]?.missingVariables() ?? [],
  }));
}

// ---------------------------------------------------------------- products

export async function loadSocialProduct(productId: string): Promise<SocialProduct | null> {
  const { rows } = await pool!.query(
    `SELECT p.id, p.name, p.price, p.compare_at_price, p.short_description, p.description, p.images, c.name AS category
       FROM mkt_products p LEFT JOIN mkt_categories c ON c.id = p.category_id
      WHERE p.id::text = $1 AND p.status = 'active'`, [productId]);
  const r = rows[0];
  if (!r) return null;
  const images = (Array.isArray(r.images) ? r.images : []) as unknown[];
  const photoCount = images.filter(i => typeof i === "string" && /^https?:\/\//i.test(i)).length;
  if (!photoCount) return null; // colour placeholders can't be posted
  return {
    id: r.id, name: r.name, priceZar: Number(r.price),
    compareAtZar: r.compare_at_price != null ? Number(r.compare_at_price) : null,
    description: String(r.short_description || r.description || ""),
    url: `${SITE}/product/${r.id}`,
    images: Array.from({ length: Math.min(photoCount, 10) }, (_, i) => `${API}/api/marketplace/media/p/${r.id}/${i}`),
    category: r.category ?? null,
  };
}

/**
 * Best new arrivals not yet posted on `platform`: new, active, with real
 * photos, ranked by sales, rating, photo count and a small discount bonus.
 */
export async function pickBestNew(platform: PlatformId, limit: number): Promise<string[]> {
  const { rows } = await pool!.query(
    `SELECT p.id, p.total_sold, p.avg_rating, p.images, p.price, p.compare_at_price
       FROM mkt_products p
       LEFT JOIN social_posts sp ON sp.product_id = p.id AND sp.platform = $1
      WHERE p.status = 'active' AND sp.id IS NULL
        AND p.created_at > now() - ($2 || ' days')::interval
      ORDER BY p.created_at DESC
      LIMIT 500`, [platform, String(newWithinDays())]);
  const scored = rows
    .map((r: Row) => {
      const photos = (Array.isArray(r.images) ? r.images : []).filter((i: unknown) => typeof i === "string" && /^https?:\/\//i.test(i)).length;
      if (!photos) return null;
      const discount = r.compare_at_price && Number(r.compare_at_price) > Number(r.price) ? 1 - Number(r.price) / Number(r.compare_at_price) : 0;
      const score = Math.log1p(Number(r.total_sold) || 0) * 3 + (Number(r.avg_rating) || 0) + Math.min(photos, 6) * 0.5 + discount * 4;
      return { id: String(r.id), score };
    })
    .filter((x): x is { id: string; score: number } => x !== null)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(x => x.id);
}

// ------------------------------------------------------------------ queue

async function existing(productId: string, platform: PlatformId): Promise<Row | undefined> {
  return (await pool!.query(`SELECT * FROM social_posts WHERE product_id::text = $1 AND platform = $2`, [productId, platform])).rows[0];
}

async function enqueue(productId: string, platform: PlatformId, trigger: "auto" | "manual", when: Date): Promise<"queued" | "already_posted" | "already_queued"> {
  const row = await existing(productId, platform);
  if (row?.status === "posted") return "already_posted";
  if (row?.status === "posting") return "already_queued";
  if (row?.status === "queued") {
    if (trigger === "auto") return "already_queued";
    // Share now on something scheduled for later: bring it forward.
    await pool!.query(`UPDATE social_posts SET trigger = 'manual', scheduled_for = $2, updated_at = now() WHERE id = $1`,
      [row.id, new Date(Math.min(new Date(row.scheduled_for).getTime(), when.getTime()))]);
    return "queued";
  }
  if (row) {
    await pool!.query(`UPDATE social_posts SET status = 'queued', trigger = $2, attempts = 0, last_error = NULL, scheduled_for = $3, updated_at = now() WHERE id = $1`, [row.id, trigger, when]);
  } else {
    await pool!.query(`INSERT INTO social_posts (product_id, platform, trigger, scheduled_for) VALUES ($1, $2, $3, $4)`, [productId, platform, trigger, when]);
  }
  logger.info("social.queued", { productId, platform, trigger });
  return "queued";
}

/** "Share now" from the admin dashboard: posts straight away, outside the daily cap. */
export async function shareNow(productId: string, platforms?: PlatformId[]) {
  const product = await loadSocialProduct(productId);
  if (!product) throw new Error("Product not found, not active, or has no photos to post.");
  const targets = (platforms?.length ? platforms : activePlatforms()).filter(p => activePlatforms().includes(p));
  if (!targets.length) throw new Error("No social platforms are connected yet.");
  const out: Record<string, string> = {};
  for (const p of targets) out[p] = await enqueue(productId, p, "manual", new Date());
  void processDuePosts().catch(err => logger.error("social.process_failed", { error: String(err) }));
  return out;
}

function sastHour(d: Date) { return (d.getUTCHours() + SAST_OFFSET_H) % 24; }
function startOfSastDay(d: Date) {
  const s = new Date(d.getTime() + SAST_OFFSET_H * 3600_000);
  s.setUTCHours(0, 0, 0, 0);
  return new Date(s.getTime() - SAST_OFFSET_H * 3600_000);
}

/**
 * Automatic plan: within posting hours, each platform gets at most
 * SOCIAL_DAILY_CAP automatic posts per day, at least (window / cap) apart,
 * so they're spread through the day instead of arriving in a burst.
 */
export async function planAutoPosts(now = new Date()): Promise<number> {
  if (!autopostOn()) return 0;
  const cap = dailyCap();
  const [from, to] = postingHours();
  const h = sastHour(now);
  if (!cap || h < from || h >= to) return 0;
  const gapMs = ((to - from) * 3600_000) / cap;
  const dayStart = startOfSastDay(now);
  let planned = 0;
  for (const platform of activePlatforms()) {
    try {
      // Keys set but not connected yet (e.g. TikTok before "Connect TikTok"): wait, rather than
      // using up new products on posts that can only fail.
      const describe = POSTERS[platform]?.describe;
      if (describe && !(await describe().then(() => true, () => false))) continue;
      const { rows } = await pool!.query(
        `SELECT COUNT(*)::int AS n, MAX(scheduled_for) AS last FROM social_posts WHERE platform = $1 AND trigger = 'auto' AND scheduled_for >= $2`,
        [platform, dayStart]);
      const n = Number(rows[0]?.n ?? 0);
      const last = rows[0]?.last ? new Date(rows[0].last) : null;
      if (n >= cap || (last && now.getTime() - last.getTime() < gapMs)) continue;
      const [productId] = await pickBestNew(platform, 1);
      if (!productId) continue;
      if ((await enqueue(productId, platform, "auto", now)) === "queued") planned++;
    } catch (err) {
      logger.error("social.plan_failed", { platform, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return planned;
}

/** Posts everything due. Each row is independent: one failure never blocks the rest. */
export async function processDuePosts(limit = 10): Promise<{ posted: number; failed: number }> {
  const { rows } = await pool!.query(
    `SELECT * FROM social_posts WHERE status = 'queued' AND scheduled_for <= now() ORDER BY scheduled_for LIMIT $1`, [limit]);
  let posted = 0, failed = 0;
  for (const row of rows as Row[]) {
    // Claim it so two runs can't post the same thing twice.
    const claim = await pool!.query(`UPDATE social_posts SET status = 'posting', attempts = attempts + 1, updated_at = now() WHERE id = $1 AND status = 'queued'`, [row.id]);
    if (!claim.rowCount) continue;
    const platform = row.platform as PlatformId;
    const poster = POSTERS[platform];
    try {
      if (!poster?.isConfigured()) throw new NonRetryable(`${platform} is not connected`);
      const product = await loadSocialProduct(String(row.product_id));
      if (!product) throw new NonRetryable("Product is no longer active or has no photos");
      const caption = captionFor(platform, product);
      await pool!.query(`UPDATE social_posts SET caption = $2, image_url = $3 WHERE id = $1`, [row.id, caption, product.images[0]]);
      const result: PostResult = await poster.post({ product, caption });
      await pool!.query(
        `UPDATE social_posts SET status = 'posted', external_id = $2, external_url = $3, last_error = NULL, posted_at = now(), updated_at = now() WHERE id = $1`,
        [row.id, result.externalId, result.externalUrl ?? null]);
      logger.info("social.posted", { platform, productId: row.product_id, externalId: result.externalId, trigger: row.trigger });
      posted++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const attempts = Number(row.attempts) + 1;
      const retry = !(err instanceof NonRetryable) && attempts < MAX_ATTEMPTS;
      await pool!.query(
        `UPDATE social_posts SET status = $2, last_error = $3, scheduled_for = $4, updated_at = now() WHERE id = $1`,
        [row.id, retry ? "queued" : "failed", message.slice(0, 1000), new Date(Date.now() + attempts * 15 * 60_000)]);
      logger.error("social.post_failed", { platform, productId: row.product_id, attempts, willRetry: retry, error: message });
      failed++;
    }
  }
  return { posted, failed };
}


export async function recentPosts(limit = 100) {
  const { rows } = await pool!.query(
    `SELECT sp.*, p.name AS product_name FROM social_posts sp LEFT JOIN mkt_products p ON p.id = sp.product_id
      ORDER BY sp.updated_at DESC LIMIT $1`, [limit]);
  return rows.map((r: Row) => ({
    id: r.id, productId: r.product_id, productName: r.product_name, platform: r.platform, status: r.status, trigger: r.trigger,
    caption: r.caption, externalId: r.external_id, externalUrl: r.external_url, attempts: r.attempts, lastError: r.last_error,
    scheduledFor: r.scheduled_for, postedAt: r.posted_at,
  }));
}

export async function retryPost(id: string) {
  const r = await pool!.query(`UPDATE social_posts SET status = 'queued', attempts = 0, last_error = NULL, scheduled_for = now(), updated_at = now() WHERE id::text = $1 AND status IN ('failed','skipped')`, [id]);
  return (r.rowCount ?? 0) > 0;
}

export function startSocialWorker(): NodeJS.Timeout | null {
  if (!pool) return null;
  const run = async () => {
    if (!activePlatforms().length) return;
    try {
      const { refreshTokensIfDue } = await import("./platforms");
      await refreshTokensIfDue();
      // Keeps connection details current (Page renamed, Instagram linked) even when nothing is posting.
      await connectionDetails();
      await planAutoPosts();
      await processDuePosts();
    } catch (err) {
      logger.error("social.cycle_failed", { error: err instanceof Error ? err.message : String(err) });
    }
  };
  // Connect right away: the token pasted into Railway may only be valid for an hour.
  if (activePlatforms().some(p => p === "facebook" || p === "instagram")) {
    void import("./platforms/meta").then(m => m.metaStatus())
      .then(st => logger.info("social.meta.status", st))
      .catch(err => logger.error("social.meta.connect_failed", { error: err instanceof Error ? err.message : String(err) }));
  }
  // Same for Threads: a freshly generated token should be made long-lived at once.
  if (activePlatforms().includes("threads")) {
    void POSTERS.threads!.describe!()
      .then(who => logger.info("social.threads.status", { account: who }))
      .catch(err => logger.error("social.threads.connect_failed", { error: err instanceof Error ? err.message : String(err) }));
  }
  const timer = setInterval(() => void run(), 5 * 60_000);
  timer.unref();
  logger.info("social.worker_started", { platforms: activePlatforms(), dailyCap: dailyCap() });
  return timer;
}

/** Products the admin can share: newest first, or matching `q`, with where each is already posted. */
export async function shareCandidates(q = "", limit = 30) {
  const params: unknown[] = [];
  let where = `p.status = 'active'`;
  if (q.trim()) { params.push(`%${q.trim().toLowerCase()}%`); where += ` AND LOWER(p.name) LIKE $${params.length}`; }
  params.push(limit * 3);
  const { rows } = await pool!.query(
    `SELECT p.id, p.name, p.price, p.images, p.total_sold, p.created_at FROM mkt_products p WHERE ${where} ORDER BY p.created_at DESC LIMIT $${params.length}`, params);
  const withPhotos = (rows as Row[]).filter(r => (Array.isArray(r.images) ? r.images : []).some((i: unknown) => typeof i === "string" && /^https?:\/\//i.test(i))).slice(0, limit);
  const ids = withPhotos.map(r => String(r.id));
  const posts = ids.length
    ? (await pool!.query(`SELECT product_id, platform, status FROM social_posts WHERE product_id::text = ANY($1)`, [ids])).rows as Row[]
    : [];
  return withPhotos.map(r => ({
    id: r.id, name: r.name, priceZar: Number(r.price), totalSold: Number(r.total_sold) || 0, createdAt: r.created_at,
    image: `${API}/api/marketplace/media/p/${r.id}/0`,
    posts: posts.filter(p => String(p.product_id) === String(r.id)).map(p => ({ platform: p.platform, status: p.status })),
  }));
}

/** For the admin panel: who each connected platform posts as, or why it can't. */
export async function connectionDetails() {
  const out: Record<string, { ok: boolean; detail: string }> = {};
  for (const p of activePlatforms()) {
    const poster = POSTERS[p]!;
    if (!poster.describe) { out[p] = { ok: true, detail: "Connected" }; continue; }
    try { out[p] = { ok: true, detail: await poster.describe() }; }
    catch (err) { out[p] = { ok: false, detail: err instanceof Error ? err.message : String(err) }; }
  }
  return out;
}
