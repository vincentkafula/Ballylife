import { Router, Request, Response } from "express";
import { pool } from "../db/pool";
import { requireAuth, requireRole } from "../middleware/auth";
import { isCjConfigured, getCjProductDetail, getCjCategories } from "../services/cjDropshippingClient";
import { convertToZar } from "../utils/pricing";
import { logger } from "../utils/logger";
import { processFulfillment, syncOne } from "../services/cjFulfillment";
import { syncCjPage, startCatalogSync, getCatalogSyncJob, hideDemoCatalogOnce } from "../services/cjCatalog";

const router: ReturnType<typeof Router> = Router();
const MANAGER_ROLES = ["marketplace_admin"] as const;
const NOT_CONFIGURED = "CJdropshipping isn't configured yet — set CJ_EMAIL and CJ_API_KEY.";

router.get("/admin/cj/status", requireAuth, requireRole(...MANAGER_ROLES), (_req: Request, res: Response) => {
  res.json({ success: true, data: { configured: isCjConfigured() } });
});

router.get("/admin/cj/categories", requireAuth, requireRole(...MANAGER_ROLES), async (_req: Request, res: Response): Promise<void> => {
  if (!isCjConfigured()) { res.status(503).json({ success: false, error: NOT_CONFIGURED }); return; }
  try {
    const categories = await getCjCategories();
    res.json({ success: true, data: categories });
  } catch (err) {
    logger.error("cj.categories_failed", { error: err instanceof Error ? err.message : String(err) });
    res.status(502).json({ success: false, error: "Couldn't reach CJdropshipping — please try again." });
  }
});

/**
 * Syncs CJ's catalogue into our database (services/cjCatalog.ts), listing
 * each product with photos in the Ballylife store at landed cost + markup.
 *
 * With `pages`, starts a background job that the worker advances one page
 * per minute and returns 202 straight away -- poll GET /admin/cj/sync.
 * Without it, syncs a single page inline (max 50 products).
 */
router.post("/admin/cj/sync", requireAuth, requireRole(...MANAGER_ROLES), async (req: Request, res: Response): Promise<void> => {
  if (!isCjConfigured()) { res.status(503).json({ success: false, error: NOT_CONFIGURED }); return; }

  const { pageNum, pageSize, categoryId, pages } = req.body ?? {};
  const boundedPageSize = Math.min(50, Math.max(1, Number(pageSize) || 20));
  const startPage = Math.max(1, Number(pageNum) || 1);

  if (pages !== undefined) {
    const boundedPages = Math.min(500, Math.max(1, Number(pages) || 1));
    const job = await startCatalogSync({ startPage, pages: boundedPages, pageSize: boundedPageSize, categoryId: categoryId || null });
    logger.info("cj.sync_requested", { actorId: req.user!.userId, startPage, pages: boundedPages, pageSize: boundedPageSize });
    res.status(202).json({ success: true, data: mapJob(job) });
    return;
  }

  try {
    const result = await syncCjPage({ pageNum: startPage, pageSize: boundedPageSize, categoryId });
    await hideDemoCatalogOnce();
    logger.info("cj.sync_run", { actorId: req.user!.userId, ...result });
    res.json({ success: true, data: result });
  } catch (err) {
    logger.error("cj.sync_failed", { error: err instanceof Error ? err.message : String(err) });
    res.status(502).json({ success: false, error: "Couldn't sync from CJdropshipping — please try again." });
  }
});

const mapJob = (j: any) => j && ({
  status: j.status, nextPage: j.next_page, endPage: j.end_page, pageSize: j.page_size, totals: j.totals ?? {},
  totalAvailable: j.total_available, lastError: j.last_error, startedAt: j.started_at, finishedAt: j.finished_at, updatedAt: j.updated_at,
});

router.get("/admin/cj/sync", requireAuth, requireRole(...MANAGER_ROLES), async (_req: Request, res: Response): Promise<void> => {
  res.json({ success: true, data: mapJob(await getCatalogSyncJob()) });
});

router.get("/admin/cj/products/:pid", requireAuth, requireRole(...MANAGER_ROLES), async (req: Request, res: Response): Promise<void> => {
  if (!isCjConfigured()) { res.status(503).json({ success: false, error: NOT_CONFIGURED }); return; }
  try {
    const detail = await getCjProductDetail(req.params.pid);
    res.json({ success: true, data: detail });
  } catch (err) {
    logger.error("cj.product_detail_failed", { pid: req.params.pid, error: err instanceof Error ? err.message : String(err) });
    res.status(502).json({ success: false, error: "Couldn't fetch that product from CJdropshipping." });
  }
});

// ── Fulfilment (admin only) ───────────────────────────────────────────────
// The only place CJ order ids, CJ costs and fulfilment errors are exposed.

const mapFulfillment = (r: any, usdToZar: number | null) => {
  const cjCostUsd = r.cj_order_amount !== null ? Number(r.cj_order_amount) : null;
  const cjCostZar = cjCostUsd !== null && usdToZar ? Math.round(cjCostUsd * usdToZar * 100) / 100 : null;
  return {
    id: r.id, orderId: r.order_id, orderNumber: r.order_number, customerName: r.customer_name,
    orderTotal: Number(r.total_amount), orderCurrency: r.currency, orderStatus: r.order_status,
    status: r.status, attempts: r.attempts, nextAttemptAt: r.next_attempt_at, lastError: r.last_error,
    cjOrderId: r.cj_order_id, cjOrderStatus: r.cj_order_status, logisticName: r.logistic_name,
    trackingNumber: r.tracking_number, trackingUrl: r.tracking_url,
    cjProductAmountUsd: r.cj_product_amount !== null ? Number(r.cj_product_amount) : null,
    cjPostageAmountUsd: r.cj_postage_amount !== null ? Number(r.cj_postage_amount) : null,
    cjCostUsd, cjCostZar,
    // Margin before the seller's payout/commission split -- the platform's gross on this order.
    grossMarginZar: cjCostZar !== null ? Math.round((Number(r.total_amount) - cjCostZar) * 100) / 100 : null,
    autoPaid: r.pay_type === 2, placedAt: r.placed_at, shippedAt: r.shipped_at, deliveredAt: r.delivered_at,
    lastSyncedAt: r.last_synced_at, createdAt: r.created_at, updatedAt: r.updated_at,
  };
};

async function loadUsdToZar(): Promise<number | null> {
  const { rows } = await pool!.query(`SELECT * FROM mkt_fx_rates`);
  return convertToZar(1, "USD", new Map(rows.map((r: { currency: string; rate_to_zar: string }) => [r.currency, Number(r.rate_to_zar)])));
}

const FULFILLMENT_SELECT = `SELECT f.*, o.order_number, o.customer_name, o.total_amount, o.currency, o.status AS order_status
  FROM cj_fulfillments f JOIN mkt_orders o ON o.id = f.order_id`;

router.get("/admin/cj/fulfillments", requireAuth, requireRole(...MANAGER_ROLES), async (req: Request, res: Response): Promise<void> => {
  const status = typeof req.query.status === "string" && req.query.status ? req.query.status : null;
  const { rows } = await pool!.query(
    `${FULFILLMENT_SELECT} ${status ? "WHERE f.status = $1" : ""} ORDER BY f.created_at DESC LIMIT 200`,
    status ? [status] : []
  );
  const { rows: countRows } = await pool!.query(`SELECT status, COUNT(*)::int AS n FROM cj_fulfillments GROUP BY status`);
  const usdToZar = await loadUsdToZar();
  res.json({
    success: true,
    data: rows.map(r => mapFulfillment(r, usdToZar)),
    meta: { counts: Object.fromEntries(countRows.map((r: { status: string; n: number }) => [r.status, r.n])), autoPay: /^(1|true|yes)$/i.test(process.env.CJ_AUTO_PAY ?? "") },
  });
});

/** Re-queues a failed / needs-attention job and attempts it right away. */
router.post("/admin/cj/fulfillments/:id/retry", requireAuth, requireRole(...MANAGER_ROLES), async (req: Request, res: Response): Promise<void> => {
  if (!isCjConfigured()) { res.status(503).json({ success: false, error: NOT_CONFIGURED }); return; }
  const { rows } = await pool!.query(
    `UPDATE cj_fulfillments SET status = 'queued', attempts = 0, next_attempt_at = now(), updated_at = now()
     WHERE id::text = $1 AND status IN ('failed', 'needs_attention', 'queued', 'cancelled') AND cj_order_id IS NULL RETURNING id`,
    [req.params.id]
  );
  if (!rows.length) { res.status(409).json({ success: false, error: "Only jobs that haven't reached the supplier yet can be retried. For a placed order, use Refresh." }); return; }
  logger.info("cj.fulfillment_manual_retry", { actorId: req.user!.userId, fulfillmentId: rows[0].id });
  await processFulfillment(rows[0].id);
  const { rows: after } = await pool!.query(`${FULFILLMENT_SELECT} WHERE f.id = $1`, [rows[0].id]);
  res.json({ success: true, data: mapFulfillment(after[0], await loadUsdToZar()) });
});

/** Pulls the latest status/tracking for a placed job now, instead of waiting for the hourly sync. */
router.post("/admin/cj/fulfillments/:id/refresh", requireAuth, requireRole(...MANAGER_ROLES), async (req: Request, res: Response): Promise<void> => {
  if (!isCjConfigured()) { res.status(503).json({ success: false, error: NOT_CONFIGURED }); return; }
  const { rows } = await pool!.query(`SELECT * FROM cj_fulfillments WHERE id::text = $1 AND cj_order_id IS NOT NULL`, [req.params.id]);
  if (!rows.length) { res.status(409).json({ success: false, error: "This job hasn't been placed with the supplier yet." }); return; }
  try {
    // needs_attention rows (e.g. held by CJ) are refreshed too, and go back
    // to 'placed' so the normal tracking flow resumes once the hold clears.
    if (rows[0].status === "needs_attention") {
      await pool!.query(`UPDATE cj_fulfillments SET status = 'placed' WHERE id = $1`, [rows[0].id]);
      rows[0].status = "placed";
    }
    await syncOne(rows[0]);
  } catch (err) {
    logger.error("cj.fulfillment_refresh_failed", { fulfillmentId: rows[0].id, error: err instanceof Error ? err.message : String(err) });
    res.status(502).json({ success: false, error: "Couldn't reach the supplier — please try again." }); return;
  }
  const { rows: after } = await pool!.query(`${FULFILLMENT_SELECT} WHERE f.id = $1`, [rows[0].id]);
  res.json({ success: true, data: mapFulfillment(after[0], await loadUsdToZar()) });
});

export default router;
