import { Router, Request, Response } from "express";
import { pool } from "../db/pool";
import { requireAuth, requireRole } from "../middleware/auth";
import { logger } from "../utils/logger";
import { isApifyConfigured } from "../services/upgarageService";
import {
  getJapanPartsSettings, saveJapanPartsSettings, refreshJapanParts, isJapanPartsRefreshing,
  updateJapanFulfillment, isJapanFulfilmentStatus, JAPAN_PARTS_SOURCE,
} from "../services/japanParts";

/**
 * Admin: Japan Used Parts (UP-GARAGE) -- settings, refresh history, the
 * listings with their price breakdown, and the buy-and-forward queue.
 * The Apify token never appears here: only whether it's set.
 */
const router: ReturnType<typeof Router> = Router();
const MANAGER_ROLES = ["marketplace_admin"] as const;
const admin = [requireAuth, requireRole(...MANAGER_ROLES)];

const fail = (res: Response, err: unknown, fallback: string) => {
  logger.error("jp_parts.request_failed", { error: err instanceof Error ? err.message : String(err) });
  res.status(500).json({ success: false, error: fallback });
};

router.get("/admin/japan-parts/settings", ...admin, async (_req: Request, res: Response): Promise<void> => {
  try {
    res.json({ success: true, data: { settings: await getJapanPartsSettings(), apifyConfigured: isApifyConfigured(), refreshing: isJapanPartsRefreshing() } });
  } catch (err) { fail(res, err, "Couldn't load the settings."); }
});

router.put("/admin/japan-parts/settings", ...admin, async (req: Request, res: Response): Promise<void> => {
  try {
    const { settings, repriced } = await saveJapanPartsSettings(req.body?.settings ?? req.body, req.user!.userId);
    res.json({ success: true, data: { settings, repriced } });
  } catch (err) { fail(res, err, "Couldn't save the settings."); }
});

// Runs in the background: a refresh can take several minutes (one actor run per keyword).
router.post("/admin/japan-parts/refresh", ...admin, async (_req: Request, res: Response): Promise<void> => {
  if (!isApifyConfigured()) { res.status(503).json({ success: false, error: "APIFY_API_TOKEN isn't set on the server." }); return; }
  if (isJapanPartsRefreshing()) { res.status(409).json({ success: false, error: "A refresh is already running." }); return; }
  void refreshJapanParts({ force: true });
  res.status(202).json({ success: true, data: { started: true } });
});

router.get("/admin/japan-parts/runs", ...admin, async (_req: Request, res: Response): Promise<void> => {
  try {
    const { rows } = await pool!.query(`SELECT * FROM jp_parts_refresh_runs ORDER BY started_at DESC LIMIT 100`);
    res.json({ success: true, data: rows.map(r => ({
      id: r.id, keyword: r.keyword, status: r.status, items: r.items, created: r.created, updated: r.updated, removed: r.removed,
      skipped: r.skipped, error: r.error, startedAt: r.started_at, finishedAt: r.finished_at,
    })) });
  } catch (err) { fail(res, err, "Couldn't load refresh history."); }
});

router.get("/admin/japan-parts/listings", ...admin, async (req: Request, res: Response): Promise<void> => {
  try {
    const limit = Math.min(200, Number(req.query.limit) || 100);
    const { rows } = await pool!.query(
      `SELECT id, name, price, status, stock, condition_grade, source_url, source_status, source_keyword, source_last_seen_at,
              original_price_tax_incl, parts_category, price_breakdown
       FROM mkt_products WHERE source = $1 ORDER BY source_last_seen_at DESC NULLS LAST LIMIT $2`,
      [JAPAN_PARTS_SOURCE, limit]
    );
    const { rows: count } = await pool!.query(`SELECT status, COUNT(*)::int AS n FROM mkt_products WHERE source = $1 GROUP BY status`, [JAPAN_PARTS_SOURCE]);
    res.json({
      success: true,
      data: rows.map(r => ({
        id: r.id, name: r.name, price: Number(r.price), status: r.status, stock: r.stock, conditionGrade: r.condition_grade,
        sourceUrl: r.source_url, sourceStatus: r.source_status, keyword: r.source_keyword, lastSeenAt: r.source_last_seen_at,
        jpyTaxIncl: r.original_price_tax_incl !== null ? Number(r.original_price_tax_incl) : null, partsCategory: r.parts_category,
        priceBreakdown: r.price_breakdown,
      })),
      meta: { byStatus: Object.fromEntries(count.map((c: { status: string; n: number }) => [c.status, c.n])) },
    });
  } catch (err) { fail(res, err, "Couldn't load listings."); }
});

router.get("/admin/japan-parts/fulfillments", ...admin, async (_req: Request, res: Response): Promise<void> => {
  try {
    const { rows } = await pool!.query(
      `SELECT f.*, o.order_number, o.placed_at FROM jp_parts_fulfillments f JOIN mkt_orders o ON o.id = f.order_id ORDER BY f.created_at DESC LIMIT 200`
    );
    res.json({ success: true, data: rows.map(mapFulfillment) });
  } catch (err) { fail(res, err, "Couldn't load the queue."); }
});

router.patch("/admin/japan-parts/fulfillments/:id", ...admin, async (req: Request, res: Response): Promise<void> => {
  const { status, purchaseRef, forwarder, trackingNumber, carrier, notes } = req.body ?? {};
  if (status !== undefined && !isJapanFulfilmentStatus(status)) { res.status(400).json({ success: false, error: "Unknown status." }); return; }
  if (status === "shipped" && !String(trackingNumber ?? "").trim()) {
    const { rows } = await pool!.query(`SELECT tracking_number FROM jp_parts_fulfillments WHERE id::text = $1`, [req.params.id]);
    if (!rows[0]?.tracking_number) { res.status(400).json({ success: false, error: "Add the tracking number to mark it shipped." }); return; }
  }
  const s = (v: unknown) => (v === undefined ? undefined : String(v).trim().slice(0, 300));
  try {
    const row = await updateJapanFulfillment(req.params.id, { status, purchaseRef: s(purchaseRef), forwarder: s(forwarder), trackingNumber: s(trackingNumber), carrier: s(carrier), notes: s(notes) });
    if (!row) { res.status(404).json({ success: false, error: "Not found." }); return; }
    res.json({ success: true, data: mapFulfillment(row) });
  } catch (err) { fail(res, err, "Couldn't update it."); }
});

function mapFulfillment(r: Record<string, any>) {
  return {
    id: r.id, orderId: r.order_id, orderNumber: r.order_number ?? null, placedAt: r.placed_at ?? null, productId: r.product_id,
    productName: r.product_name, quantity: r.quantity, sourceUrl: r.source_url, status: r.status, purchaseRef: r.purchase_ref,
    forwarder: r.forwarder, trackingNumber: r.tracking_number, carrier: r.carrier, notes: r.notes, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export default router;
