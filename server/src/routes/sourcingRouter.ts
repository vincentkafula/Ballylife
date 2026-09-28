import { Router, Request, Response } from "express";
import { requireAuth, requireRole } from "../middleware/auth";
import { logger } from "../utils/logger";
import {
  searchSourcing, getSourcedProduct, supplierStates, setSupplierEnabled, usageSummary, getSetting, setSetting,
  SourcingUnavailableError, SETTING_DEFAULTS,
} from "../services/sourcing/sourcingService";

/**
 * Manager: the supplier sourcing network (adapter layer). Seller-facing
 * search/import with quotas arrives in Phase 2 and uses the same service,
 * which only ever returns white-labelled results.
 */
const router: ReturnType<typeof Router> = Router();
const manager = [requireAuth, requireRole("marketplace_admin", "super_admin")];

const fail = (res: Response, err: unknown, fallback: string) => {
  if (err instanceof SourcingUnavailableError) { res.status(503).json({ success: false, error: err.message }); return; }
  logger.error("sourcing.request_failed", { error: err instanceof Error ? err.message : String(err) });
  res.status(500).json({ success: false, error: fallback });
};

const num = (v: unknown) => (v === undefined || v === "" || !Number.isFinite(Number(v)) ? undefined : Number(v));

router.get("/admin/sourcing/suppliers", ...manager, async (_req: Request, res: Response): Promise<void> => {
  try { res.json({ success: true, data: await supplierStates() }); }
  catch (err) { fail(res, err, "Couldn't load the suppliers."); }
});

router.patch("/admin/sourcing/suppliers/:key", ...manager, async (req: Request, res: Response): Promise<void> => {
  if (typeof req.body?.enabled !== "boolean") { res.status(400).json({ success: false, error: "enabled must be true or false" }); return; }
  try { await setSupplierEnabled(req.params.key, req.body.enabled); res.json({ success: true, data: await supplierStates() }); }
  catch (err) {
    if (err instanceof Error && err.message === "Unknown supplier") { res.status(404).json({ success: false, error: err.message }); return; }
    fail(res, err, "Couldn't update the supplier.");
  }
});

router.get("/admin/sourcing/settings", ...manager, async (_req: Request, res: Response): Promise<void> => {
  try {
    const keys = Object.keys(SETTING_DEFAULTS) as (keyof typeof SETTING_DEFAULTS)[];
    res.json({ success: true, data: Object.fromEntries(await Promise.all(keys.map(async k => [k, await getSetting(k)]))) });
  } catch (err) { fail(res, err, "Couldn't load the settings."); }
});

router.patch("/admin/sourcing/settings", ...manager, async (req: Request, res: Response): Promise<void> => {
  const body = req.body ?? {};
  const limits: Record<keyof typeof SETTING_DEFAULTS, [number, number]> = { cacheHours: [1, 24 * 14], fxBufferPct: [0, 25] };
  try {
    for (const k of Object.keys(limits) as (keyof typeof SETTING_DEFAULTS)[]) {
      if (body[k] === undefined) continue;
      const v = Number(body[k]);
      if (!Number.isFinite(v) || v < limits[k][0] || v > limits[k][1]) { res.status(400).json({ success: false, error: `${k} must be between ${limits[k][0]} and ${limits[k][1]}` }); return; }
      await setSetting(k, v);
    }
    res.json({ success: true });
  } catch (err) { fail(res, err, "Couldn't save the settings."); }
});

router.get("/admin/sourcing/usage", ...manager, async (req: Request, res: Response): Promise<void> => {
  try { res.json({ success: true, data: await usageSummary(Math.min(90, Math.max(1, Number(req.query.days) || 7))) }); }
  catch (err) { fail(res, err, "Couldn't load usage."); }
});

// Test search / product: exactly what a seller will see (white-labelled).
router.get("/admin/sourcing/search", ...manager, async (req: Request, res: Response): Promise<void> => {
  const q = req.query as Record<string, string>;
  try {
    const data = await searchSourcing({
      keyword: String(q.q ?? ""), ...(q.category ? { category: q.category } : {}),
      minPriceZar: num(q.minPrice), maxPriceZar: num(q.maxPrice), page: num(q.page) ?? 1,
    }, { userId: req.user!.userId, sellerId: null });
    res.json({ success: true, data });
  } catch (err) { fail(res, err, "Search failed. Please try again."); }
});

router.get("/admin/sourcing/product/:ref", ...manager, async (req: Request, res: Response): Promise<void> => {
  try {
    const data = await getSourcedProduct(req.params.ref, { userId: req.user!.userId, sellerId: null });
    if (!data) { res.status(404).json({ success: false, error: "Product not found" }); return; }
    res.json({ success: true, data });
  } catch (err) { fail(res, err, "Couldn't load the product. Please try again."); }
});

export default router;
