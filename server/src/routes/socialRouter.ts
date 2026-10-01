import { Router, Request, Response } from "express";
import { requireAuth, requireRole } from "../middleware/auth";
import { logger } from "../utils/logger";
import { PLATFORMS, captionFor, type PlatformId } from "../services/social/socialCaptions";
import { platformStatus, recentPosts, shareNow, retryPost, loadSocialProduct, dailyCap, autopostOn, shareCandidates, connectionDetails } from "../services/social/socialPosting";
import { metaStatus } from "../services/social/platforms/meta";

/** Social media auto-posting: status, post log, "Share now", caption preview. Admin-only. */
const router: ReturnType<typeof Router> = Router();
const SITE = () => (process.env.MARKETPLACE_PUBLIC_URL || "https://www.ballylife.com").replace(/\/$/, "");

// ---------------------------------------------------------------- Connect TikTok / LinkedIn

const CONNECT: Record<string, { configured: () => boolean; url: () => Promise<string>; complete: (code: string) => Promise<string> }> = {
  tiktok: {
    configured: () => Boolean(process.env.TIKTOK_CLIENT_KEY?.trim() && process.env.TIKTOK_CLIENT_SECRET?.trim()),
    url: async () => (await import("../services/social/platforms/tiktok")).tiktokAuthorizeUrl(),
    complete: async code => (await import("../services/social/platforms/tiktok")).completeTikTok(code),
  },
  linkedin: {
    configured: () => Boolean(process.env.LINKEDIN_CLIENT_ID?.trim() && process.env.LINKEDIN_CLIENT_SECRET?.trim()),
    url: async () => (await import("../services/social/platforms/linkedin")).linkedinAuthorizeUrl(),
    complete: async code => (await import("../services/social/platforms/linkedin")).completeLinkedIn(code),
  },
};

/** Where the admin's browser goes to sign in (the dashboard opens this). */
router.post("/admin/social/:platform/connect", requireAuth, requireRole("marketplace_admin"), async (req: Request, res: Response): Promise<void> => {
  const c = CONNECT[req.params.platform];
  if (!c) { res.status(404).json({ success: false, error: "Unknown platform" }); return; }
  if (!c.configured()) { res.status(400).json({ success: false, error: `Add the ${req.params.platform === "tiktok" ? "TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET" : "LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET"} variables on Railway first.` }); return; }
  res.json({ success: true, data: { url: await c.url() } });
});

/** The platform sends the browser back here after the sign-in (public; protected by the one-time state). */
router.get("/social/oauth/:platform/callback", async (req: Request, res: Response): Promise<void> => {
  const platform = req.params.platform;
  const c = CONNECT[platform];
  const back = (result: string, reason?: string) => res.redirect(`${SITE()}/admin?social=${encodeURIComponent(platform)}&result=${result}${reason ? `&reason=${encodeURIComponent(reason.slice(0, 200))}` : ""}`);
  if (!c) { res.sendStatus(404); return; }
  const { code, state, error, error_description } = req.query as Record<string, string | undefined>;
  if (error) {
    logger.warn("social.oauth_refused", { platform, error, description: error_description ?? null });
    back("error", error_description || error);
    return;
  }
  const { consumeState } = await import("../services/social/oauth");
  if (!code || !(await consumeState(String(state ?? ""), platform))) { back("error", "The sign-in expired — please try Connect again."); return; }
  try {
    const who = await c.complete(code);
    logger.info("social.connected", { platform, who });
    back("connected");
  } catch (err) {
    logger.error("social.connect_failed", { platform, error: err instanceof Error ? err.message : String(err) });
    back("error", err instanceof Error ? err.message : "Connection failed");
  }
});

/**
 * TikTok's URL-prefix verification file. TikTok fetches it from the start of
 * our photo addresses (/api/marketplace/media/) to confirm they're ours.
 */
router.get("/media/:file", (req: Request, res: Response, next) => {
  const name = process.env.TIKTOK_VERIFY_FILENAME?.trim();
  if (!name || req.params.file !== name) { next(); return; }
  res.type("text/plain").send(process.env.TIKTOK_VERIFY_CONTENT ?? "");
});

const admin = [requireAuth, requireRole("marketplace_admin")];

router.get("/admin/social/status", ...admin, async (_req: Request, res: Response): Promise<void> => {
  res.json({ success: true, data: {
    platforms: platformStatus(), dailyCap: dailyCap(),
    autopost: autopostOn(),
    hours: process.env.SOCIAL_HOURS || "8-20",
  } });
});

router.get("/admin/social/meta", ...admin, async (_req: Request, res: Response): Promise<void> => {
  try { res.json({ success: true, data: await metaStatus() }); }
  catch (err) { res.status(502).json({ success: false, error: err instanceof Error ? err.message : String(err) }); }
});

router.get("/admin/social/connections", ...admin, async (_req: Request, res: Response): Promise<void> => {
  res.json({ success: true, data: await connectionDetails() });
});

router.get("/admin/social/candidates", ...admin, async (req: Request, res: Response): Promise<void> => {
  res.json({ success: true, data: await shareCandidates(String(req.query.q ?? "").slice(0, 100)) });
});

router.get("/admin/social/posts", ...admin, async (req: Request, res: Response): Promise<void> => {
  res.json({ success: true, data: await recentPosts(Math.min(300, Number(req.query.limit) || 100)) });
});

router.get("/admin/social/preview/:productId", ...admin, async (req: Request, res: Response): Promise<void> => {
  const product = await loadSocialProduct(req.params.productId);
  if (!product) { res.status(404).json({ success: false, error: "Product not found, not active, or has no photos." }); return; }
  res.json({ success: true, data: { image: product.images[0], captions: Object.fromEntries(PLATFORMS.map(p => [p, captionFor(p, product)])) } });
});

router.post("/admin/social/share/:productId", ...admin, async (req: Request, res: Response): Promise<void> => {
  const requested = Array.isArray(req.body?.platforms) ? (req.body.platforms as string[]).filter((p): p is PlatformId => (PLATFORMS as string[]).includes(p)) : undefined;
  try {
    res.json({ success: true, data: await shareNow(req.params.productId, requested) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn("social.share_rejected", { productId: req.params.productId, error: message });
    res.status(400).json({ success: false, error: message });
  }
});

router.post("/admin/social/posts/:id/retry", ...admin, async (req: Request, res: Response): Promise<void> => {
  const ok = await retryPost(req.params.id);
  res.status(ok ? 200 : 404).json({ success: ok, ...(ok ? {} : { error: "Only failed posts can be retried." }) });
});

export default router;
