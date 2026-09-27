import { Router, Request, Response } from "express";
import { requireAuth, requireRole } from "../middleware/auth";
import { logger } from "../utils/logger";
import { PLATFORMS, captionFor, type PlatformId } from "../services/social/socialCaptions";
import { platformStatus, recentPosts, shareNow, retryPost, loadSocialProduct, dailyCap, autopostOn, shareCandidates } from "../services/social/socialPosting";
import { metaStatus } from "../services/social/platforms/meta";

/** Social media auto-posting: status, post log, "Share now", caption preview. Admin-only. */
const router: ReturnType<typeof Router> = Router();
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
