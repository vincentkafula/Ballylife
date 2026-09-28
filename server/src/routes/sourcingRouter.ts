import { Router, Request, Response } from "express";
import { pool } from "../db/pool";
import { requireAuth, requireRole } from "../middleware/auth";
import { logger } from "../utils/logger";
import {
  searchSourcing, getSourcedProduct, fileInCatalogue, supplierStates, setSupplierEnabled, usageSummary, getSetting, setSetting,
  SourcingUnavailableError, SETTING_DEFAULTS,
} from "../services/sourcing/sourcingService";
import { quotaStatus, checkQuota, recordUsage, setSellerPlan, planLimits, QuotaError, PLAN_IDS, PLAN_NAMES, type PlanId } from "../services/sourcing/quotas";
import { sourcingOverview, sellerSourcingList, savePlanLimits, clearSourcingCache } from "../services/sourcing/analytics";
import { createImportedListing } from "./marketplaceRouter";

/**
 * The supplier sourcing network (adapter layer).
 *  - Sellers: search suppliers, open a product, import it into their store
 *    with their own price -- within their plan's limits.
 *  - Managers: suppliers on/off, settings, usage, seller plans, test search.
 * Everything returned is white-labelled by the sourcing service.
 */
const router: ReturnType<typeof Router> = Router();
const manager = [requireAuth, requireRole("marketplace_admin", "super_admin")];
const seller = [requireAuth, requireRole("seller")];

const fail = (res: Response, err: unknown, fallback: string) => {
  if (err instanceof QuotaError) { res.status(429).json({ success: false, error: err.message, code: "SOURCING_QUOTA", limit: err.limit }); return; }
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

// ── Sellers ────────────────────────────────────────────────────────────────
interface SellerRow { id: string; status: string; commission_pct: string | number }

/** The signed-in seller's store, if it's approved to trade. */
async function activeSeller(req: Request, res: Response): Promise<SellerRow | null> {
  const { rows } = await pool!.query(`SELECT id, status, commission_pct FROM mkt_sellers WHERE user_id = $1`, [req.user!.userId]);
  const s = rows[0] as SellerRow | undefined;
  if (!s) { res.status(404).json({ success: false, error: "No store found for this account." }); return null; }
  if (s.status !== "active") { res.status(403).json({ success: false, error: "Your store needs to be approved before you can add products.", code: "SELLER_NOT_ACTIVE" }); return null; }
  return s;
}

const commissionOf = (s: SellerRow) => { const n = Number(s.commission_pct); return Number.isFinite(n) ? n : 8; };
/** Lowest price that doesn't lose money: base cost plus Ballylife's commission on the sale. */
export const breakEvenPrice = (baseCostZar: number, commissionPct: number) => Math.ceil(baseCostZar / (1 - commissionPct / 100));

router.get("/sourcing/quota", ...seller, async (req: Request, res: Response): Promise<void> => {
  const s = await activeSeller(req, res); if (!s) return;
  try { res.json({ success: true, data: { ...(await quotaStatus(s.id)), commissionPct: commissionOf(s) } }); }
  catch (err) { fail(res, err, "Couldn't load your plan."); }
});

router.get("/sourcing/search", ...seller, async (req: Request, res: Response): Promise<void> => {
  const s = await activeSeller(req, res); if (!s) return;
  const q = req.query as Record<string, string>;
  const keyword = String(q.q ?? "").trim();
  if (keyword.length < 2) { res.status(400).json({ success: false, error: "Type at least 2 letters to search." }); return; }
  try {
    await checkQuota(s.id, "search");
    const data = await searchSourcing({
      keyword, ...(q.category ? { category: q.category } : {}),
      minPriceZar: num(q.minPrice), maxPriceZar: num(q.maxPrice), page: num(q.page) ?? 1,
    }, { userId: req.user!.userId, sellerId: s.id });
    await recordUsage(s.id, "search");
    res.json({ success: true, data });
  } catch (err) { fail(res, err, "Search failed. Please try again."); }
});

router.get("/sourcing/product/:ref", ...seller, async (req: Request, res: Response): Promise<void> => {
  const s = await activeSeller(req, res); if (!s) return;
  try {
    await checkQuota(s.id, "view");
    const data = await getSourcedProduct(req.params.ref, { userId: req.user!.userId, sellerId: s.id });
    if (!data) { res.status(404).json({ success: false, error: "Product not found. Search again and pick it from the results." }); return; }
    await recordUsage(s.id, "view");
    const pct = commissionOf(s);
    res.json({ success: true, data: { ...data, commissionPct: pct, minPriceZar: breakEvenPrice(data.baseCostZar, pct) } });
  } catch (err) { fail(res, err, "Couldn't load the product. Please try again."); }
});

router.post("/sourcing/import", ...seller, async (req: Request, res: Response): Promise<void> => {
  const s = await activeSeller(req, res); if (!s) return;
  const { ref, retailPrice, compareAtPrice } = req.body ?? {};
  const price = Number(retailPrice);
  if (typeof ref !== "string" || !ref) { res.status(400).json({ success: false, error: "Pick a product to import." }); return; }
  if (!Number.isFinite(price) || price <= 0) { res.status(400).json({ success: false, error: "Set your selling price." }); return; }
  const compare = compareAtPrice === undefined || compareAtPrice === null || compareAtPrice === "" ? null : Number(compareAtPrice);
  if (compare !== null && (!Number.isFinite(compare) || compare <= price)) { res.status(400).json({ success: false, error: "The \"was\" price must be higher than your selling price." }); return; }
  try {
    await checkQuota(s.id, "import");
    const { supplierProductId, product, stock } = await fileInCatalogue(ref, { userId: req.user!.userId, sellerId: s.id });
    const min = breakEvenPrice(product.baseCostZar, commissionOf(s));
    if (price < min) { res.status(400).json({ success: false, error: `Your price must be at least R${min} to cover the product, delivery and Ballylife's commission.`, code: "PRICE_TOO_LOW", minPriceZar: min }); return; }
    const { rows: dup } = await pool!.query(
      `SELECT id FROM mkt_products WHERE seller_id = $1 AND supplier_product_id = $2 AND status IN ('active','pending_review','out_of_stock')`, [s.id, supplierProductId]);
    if (dup.length) { res.status(409).json({ success: false, error: "This product is already in your store.", code: "ALREADY_IMPORTED" }); return; }
    const r = await createImportedListing(s.id, supplierProductId, { stock, retailPrice: price, compareAtPrice: compare });
    if (r.status === 201) await recordUsage(s.id, "import");
    res.status(r.status).json(r.body);
  } catch (err) { fail(res, err, "Couldn't import the product. Please try again."); }
});

// ── Managers: dashboard, plans, cache ──────────────────────────────────────
router.get("/admin/sourcing/overview", ...manager, async (req: Request, res: Response): Promise<void> => {
  try {
    const days = Math.min(90, Math.max(1, Number(req.query.days) || 14));
    const [overview, suppliers, plans, cacheHours, fxBufferPct] = await Promise.all([
      sourcingOverview(days), supplierStates(), planLimits(), getSetting("cacheHours"), getSetting("fxBufferPct"),
    ]);
    res.json({ success: true, data: { ...overview, suppliers, plans, planNames: PLAN_NAMES, settings: { cacheHours, fxBufferPct } } });
  } catch (err) { fail(res, err, "Couldn't load sourcing."); }
});

router.get("/admin/sourcing/sellers", ...manager, async (req: Request, res: Response): Promise<void> => {
  try { res.json({ success: true, data: await sellerSourcingList(String(req.query.search ?? ""), 100) }); }
  catch (err) { fail(res, err, "Couldn't load sellers."); }
});

router.patch("/admin/sourcing/plans", ...manager, async (req: Request, res: Response): Promise<void> => {
  try { await savePlanLimits(req.body); res.json({ success: true, data: await planLimits() }); }
  catch (err) {
    if (err instanceof RangeError) { res.status(400).json({ success: false, error: err.message }); return; }
    fail(res, err, "Couldn't save the plans.");
  }
});

router.delete("/admin/sourcing/cache", ...manager, async (req: Request, res: Response): Promise<void> => {
  try {
    const cleared = await clearSourcingCache();
    logger.info("sourcing.cache_cleared", { by: req.user!.userId, cleared });
    res.json({ success: true, data: { cleared } });
  } catch (err) { fail(res, err, "Couldn't clear the cache."); }
});

// ── Managers: seller plans ─────────────────────────────────────────────────
router.patch("/admin/sourcing/sellers/:id/plan", ...manager, async (req: Request, res: Response): Promise<void> => {
  const plan = String(req.body?.plan ?? "") as PlanId;
  if (!PLAN_IDS.includes(plan)) { res.status(400).json({ success: false, error: `plan must be one of ${PLAN_IDS.join(", ")}` }); return; }
  try {
    if (!(await setSellerPlan(req.params.id, plan))) { res.status(404).json({ success: false, error: "Seller not found" }); return; }
    res.json({ success: true, data: await quotaStatus(req.params.id) });
  } catch (err) { fail(res, err, "Couldn't change the plan."); }
});

export default router;
