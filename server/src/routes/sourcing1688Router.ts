import { Router, Request, Response } from "express";
import { pool } from "../db/pool";
import { requireAuth, requireRole } from "../middleware/auth";
import { logger } from "../utils/logger";
import { isApifyConfigured } from "../services/apifyClient";
import { isCjConfigured } from "../services/cjDropshippingClient";
import {
  get1688Settings, save1688Settings, run1688Research, is1688Running, setOfferStatus, sendOfferToCj, syncCjSourcing,
  SourcingError, PICK_STATUSES,
} from "../services/sourcing1688";

/**
 * Admin: 1688 product research and CJ sourcing requests. Nothing here is
 * public -- 1688 finds only reach shoppers once CJ has sourced them.
 */
const router: ReturnType<typeof Router> = Router();
const admin = [requireAuth, requireRole("marketplace_admin")];

const fail = (res: Response, err: unknown, fallback: string) => {
  if (err instanceof SourcingError) { res.status(err.status).json({ success: false, error: err.message }); return; }
  logger.error("sourcing1688.request_failed", { error: err instanceof Error ? err.message : String(err) });
  res.status(500).json({ success: false, error: fallback });
};

const mapOffer = (r: Record<string, any>) => ({
  id: r.id, offerId: r.offer_id, title: r.title, url: r.url, priceCny: Number(r.price_cny), priceRangeCny: r.price_range_cny,
  moq: r.moq, unit: r.unit, stock: r.stock, outOfStock: r.out_of_stock, soldCount: r.sold_count,
  repurchaseRate: r.repurchase_rate !== null ? Number(r.repurchase_rate) : null, starLevel: r.star_level !== null ? Number(r.star_level) : null,
  supplierName: r.supplier_name, supplierType: r.supplier_type, supplierYears: r.supplier_years, location: r.location,
  categoryPath: r.category_path, images: Array.isArray(r.images) ? r.images : [], videoUrl: r.video_url, totalVariants: r.total_variants,
  supportsDropship: r.supports_dropship, deliveryLimitDays: r.delivery_limit_days, keyword: r.source_keyword, productClass: r.product_class,
  estimate: r.estimate, status: r.status, cjSourcingId: r.cj_sourcing_id, cjSourcingStatus: r.cj_sourcing_status, cjFailReason: r.cj_fail_reason,
  cjProductId: r.cj_product_id, storeProductId: r.store_product_id, sentToCjAt: r.sent_to_cj_at, firstSeenAt: r.first_seen_at, lastSeenAt: r.last_seen_at,
});

router.get("/admin/sourcing-1688/settings", ...admin, async (_req: Request, res: Response): Promise<void> => {
  try {
    res.json({ success: true, data: { settings: await get1688Settings(), apifyConfigured: isApifyConfigured(), cjConfigured: isCjConfigured(), running: is1688Running() } });
  } catch (err) { fail(res, err, "Couldn't load the settings."); }
});

router.put("/admin/sourcing-1688/settings", ...admin, async (req: Request, res: Response): Promise<void> => {
  try { res.json({ success: true, data: await save1688Settings(req.body?.settings ?? req.body, req.user!.userId) }); }
  catch (err) { fail(res, err, "Couldn't save the settings."); }
});

// Background: a multi-keyword run can take several minutes.
router.post("/admin/sourcing-1688/run", ...admin, async (_req: Request, res: Response): Promise<void> => {
  if (!isApifyConfigured()) { res.status(503).json({ success: false, error: "APIFY_API_TOKEN isn't set on the server." }); return; }
  if (is1688Running()) { res.status(409).json({ success: false, error: "A research run is already in progress." }); return; }
  void run1688Research({ force: true });
  res.status(202).json({ success: true, data: { started: true } });
});

router.get("/admin/sourcing-1688/runs", ...admin, async (_req: Request, res: Response): Promise<void> => {
  try {
    const { rows } = await pool!.query(`SELECT * FROM sourcing_1688_runs ORDER BY started_at DESC LIMIT 50`);
    res.json({ success: true, data: rows.map(r => ({
      id: r.id, apifyRunId: r.apify_run_id, keywords: r.keywords, status: r.status, items: r.items, created: r.created, updated: r.updated,
      skipped: r.skipped, excluded: r.excluded, error: r.error, startedAt: r.started_at, finishedAt: r.finished_at,
    })) });
  } catch (err) { fail(res, err, "Couldn't load run history."); }
});

const SORTS: Record<string, string> = {
  sold: "sold_count DESC NULLS LAST", price: "price_cny ASC", newest: "first_seen_at DESC", supplier: "supplier_years DESC NULLS LAST",
};

router.get("/admin/sourcing-1688/offers", ...admin, async (req: Request, res: Response): Promise<void> => {
  try {
    const { status, keyword, search, sort } = req.query as Record<string, string | undefined>;
    const where: string[] = [];
    const params: unknown[] = [];
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    if (status) where.push(`status = ${p(status)}`);
    if (keyword) where.push(`source_keyword = ${p(keyword)}`);
    if (search) where.push(`title ILIKE ${p(`%${search}%`)}`);
    const { rows } = await pool!.query(
      `SELECT * FROM sourcing_1688_offers ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY ${SORTS[sort ?? ""] ?? SORTS.sold} LIMIT 300`, params
    );
    const { rows: counts } = await pool!.query(`SELECT status, COUNT(*)::int AS n FROM sourcing_1688_offers GROUP BY status`);
    res.json({ success: true, data: rows.map(mapOffer), meta: { byStatus: Object.fromEntries(counts.map((c: { status: string; n: number }) => [c.status, c.n])) } });
  } catch (err) { fail(res, err, "Couldn't load offers."); }
});

router.patch("/admin/sourcing-1688/offers/:id", ...admin, async (req: Request, res: Response): Promise<void> => {
  const status = req.body?.status;
  if (!PICK_STATUSES.includes(status)) { res.status(400).json({ success: false, error: "Status must be new, shortlisted or dismissed." }); return; }
  try {
    const row = await setOfferStatus(req.params.id, status);
    if (!row) { res.status(409).json({ success: false, error: "This offer is already with CJ." }); return; }
    res.json({ success: true, data: mapOffer(row) });
  } catch (err) { fail(res, err, "Couldn't update it."); }
});

router.post("/admin/sourcing-1688/offers/:id/send-to-cj", ...admin, async (req: Request, res: Response): Promise<void> => {
  try { res.json({ success: true, data: mapOffer(await sendOfferToCj(req.params.id)) }); }
  catch (err) { fail(res, err, "Couldn't send it to CJ."); }
});

router.post("/admin/sourcing-1688/sync-cj", ...admin, async (_req: Request, res: Response): Promise<void> => {
  try { res.json({ success: true, data: await syncCjSourcing() }); }
  catch (err) { fail(res, err, "Couldn't check CJ."); }
});

export default router;
