import { Router, Request, Response } from "express";
import { pool } from "../db/pool";
import { requireAuth, requireRole } from "../middleware/auth";
import { isCjConfigured, listCjProducts, getCjProductDetail, getCjCategories } from "../services/cjDropshippingClient";
import { convertToZar } from "../utils/pricing";
import { logger } from "../utils/logger";
import { dedupeImages, isPhotoUrl, parseSupplierImageList, scrubSupplierBranding, splitSupplierDescription } from "../utils/supplierWhiteLabel";
import type { CjProductSummary } from "../services/cjDropshippingClient";
import type { ExternalVariant } from "../utils/cjVariants";
import { processFulfillment, syncOne } from "../services/cjFulfillment";

const router: ReturnType<typeof Router> = Router();
const MANAGER_ROLES = ["marketplace_admin"] as const;

const CJ_SUPPLIER_ID = "sup-cjdropshipping";

async function ensureCjSupplierExists(): Promise<void> {
  await pool!.query(
    `INSERT INTO mkt_suppliers (id, name, country, platform, dropship_supported, verified, status)
     VALUES ($1, 'CJdropshipping', 'CN', 'CJdropshipping', true, true, 'active')
     ON CONFLICT (id) DO NOTHING`,
    [CJ_SUPPLIER_ID]
  );
}

/**
 * The list endpoint only returns one thumbnail per product; the real
 * gallery (main shots, per-variant shots, and the detail photos embedded
 * in the description HTML) is only on /product/query. One detail call per
 * product, spaced by the client's rate-limit queue. If it fails, the
 * product still imports with the list thumbnail rather than being dropped.
 *
 * Names and descriptions are scrubbed of supplier branding here, before
 * they ever reach the database, so no later code path can leak them.
 */
async function buildWhiteLabelledProduct(p: CjProductSummary): Promise<{ name: string; description: string; images: string[]; variants: ExternalVariant[]; detailOk: boolean }> {
  const fallbackName = scrubSupplierBranding(p.productNameEn || p.productName);
  try {
    const d = await getCjProductDetail(p.pid);
    const desc = splitSupplierDescription(d.description);
    const images = dedupeImages([
      ...parseSupplierImageList(d.productImageSet),
      ...parseSupplierImageList(d.productImage),
      ...parseSupplierImageList(p.productImage),
      ...(d.variants ?? []).map(v => v.variantImage).filter(isPhotoUrl),
      ...desc.imageUrls,
    ]);
    return {
      name: scrubSupplierBranding(d.productNameEn || d.productName) || fallbackName,
      description: desc.text || scrubSupplierBranding(p.remark),
      images,
      // Needed to place real orders: createOrderV2 takes a CJ vid per line.
      variants: (d.variants ?? []).filter(v => v.vid).map(v => ({
        vid: v.vid,
        key: scrubSupplierBranding(v.variantKey || v.variantNameEn || "") || "Standard",
        priceUsd: Number(v.variantSellPrice ?? p.sellPrice),
        ...(isPhotoUrl(v.variantImage) ? { image: v.variantImage } : {}),
      })),
      detailOk: true,
    };
  } catch (err) {
    logger.warn("cj.product_detail_fallback", { pid: p.pid, error: err instanceof Error ? err.message : String(err) });
    return { name: fallbackName, description: scrubSupplierBranding(p.remark), images: parseSupplierImageList(p.productImage), variants: [], detailOk: false };
  }
}

router.get("/admin/cj/status", requireAuth, requireRole(...MANAGER_ROLES), (_req: Request, res: Response) => {
  res.json({ success: true, data: { configured: isCjConfigured() } });
});

router.get("/admin/cj/categories", requireAuth, requireRole(...MANAGER_ROLES), async (_req: Request, res: Response): Promise<void> => {
  if (!isCjConfigured()) { res.status(503).json({ success: false, error: "CJdropshipping isn't configured yet — set CJ_EMAIL and CJ_API_KEY." }); return; }
  try {
    const categories = await getCjCategories();
    res.json({ success: true, data: categories });
  } catch (err) {
    logger.error("cj.categories_failed", { error: err instanceof Error ? err.message : String(err) });
    res.status(502).json({ success: false, error: "Couldn't reach CJdropshipping — please try again." });
  }
});

/**
 * Pulls one page of CJ's real product catalog and upserts it into the
 * existing mkt_supplier_products table under a single CJdropshipping
 * supplier record, reusing the whole existing supplier-catalog/seller-
 * import flow rather than building a parallel product system.
 *
 * Deliberately bounded to one page per call (max 50 products), not "sync
 * everything" -- an admin-triggered, on-demand action they page through,
 * same reasoning as the reconciliation endpoint and the prerender
 * script's capped product count elsewhere in this codebase: predictable
 * cost and duration, not an unbounded operation hidden behind one click.
 *
 * retail_price is seeded at zero markup (the USD cost price converted to
 * ZAR, nothing added) -- deliberately not inventing a markup percentage,
 * which is a real business decision for whoever reviews these imports,
 * not something to decide unilaterally in a sync script. Every imported
 * row starts in the same 'pending_review' status manual supplier
 * submissions already use, so nothing goes live without a person looking
 * at it first.
 */
router.post("/admin/cj/sync", requireAuth, requireRole(...MANAGER_ROLES), async (req: Request, res: Response): Promise<void> => {
  if (!isCjConfigured()) { res.status(503).json({ success: false, error: "CJdropshipping isn't configured yet — set CJ_EMAIL and CJ_API_KEY." }); return; }

  const { pageNum, pageSize, categoryId } = req.body ?? {};
  const boundedPageSize = Math.min(50, Math.max(1, Number(pageSize) || 20));

  try {
    const result = await listCjProducts({ pageNum: Number(pageNum) || 1, pageSize: boundedPageSize, categoryId });
    await ensureCjSupplierExists();

    const { rows: fxRows } = await pool!.query(`SELECT * FROM mkt_fx_rates`);
    const fxByCurrency = new Map(fxRows.map((r: { currency: string; rate_to_zar: string }) => [r.currency, Number(r.rate_to_zar)]));
    const usdToZar = convertToZar(1, "USD", fxByCurrency);

    let imported = 0, updated = 0, skippedNoRate = 0, withPhotos = 0, detailFailures = 0;
    for (const p of result.list) {
      if (usdToZar === null) { skippedNoRate++; continue; } // no USD rate on file yet -- flagged, not silently guessed
      const retailPriceZar = Math.round(Number(p.sellPrice) * usdToZar * 100) / 100;

      const { name, description, images, variants, detailOk } = await buildWhiteLabelledProduct(p);
      if (!detailOk) detailFailures++;
      if (images.length) withPhotos++;

      const { rows: existing } = await pool!.query(
        `SELECT id FROM mkt_supplier_products WHERE supplier_id = $1 AND external_id = $2`,
        [CJ_SUPPLIER_ID, p.pid]
      );
      if (existing.length) {
        // GREATEST: a cost increase raises the floor, but a re-sync never
        // wipes out a price a manager has already marked up by hand.
        await pool!.query(
          `UPDATE mkt_supplier_products SET name = $1, description = $2, cost_price = $3, retail_price = GREATEST(retail_price, $4::numeric), images = $5, updated_at = now() WHERE id = $6`,
          [name, description, p.sellPrice, retailPriceZar, JSON.stringify(images), existing[0].id]
        );
        // Seller listings copied the catalog photos at import time -- keep them on CJ's current set.
        if (images.length) {
          await pool!.query(`UPDATE mkt_products SET images = $1, updated_at = now() WHERE supplier_product_id = $2`, [JSON.stringify(images), existing[0].id]);
        }
        // Only overwrite variants from a successful detail call -- a failed
        // one must never wipe the vids that live orders depend on.
        if (detailOk && variants.length) {
          await pool!.query(`UPDATE mkt_supplier_products SET external_variants = $1 WHERE id = $2`, [JSON.stringify(variants), existing[0].id]);
        }
        updated++;
      } else {
        await pool!.query(
          `INSERT INTO mkt_supplier_products (supplier_id, name, description, cost_price, currency, retail_price, moq, images, origin_country, status, external_source, external_id, external_variants)
           VALUES ($1,$2,$3,$4,'USD',$5,1,$6,'CN','pending_review','cjdropshipping',$7,$8)`,
          [CJ_SUPPLIER_ID, name, description, p.sellPrice, retailPriceZar, JSON.stringify(images), p.pid, JSON.stringify(variants)]
        );
        imported++;
      }
    }

    logger.info("cj.sync_run", { actorId: req.user!.userId, pageNum: Number(pageNum) || 1, pageSize: boundedPageSize, imported, updated, skippedNoRate, withPhotos, detailFailures });
    res.json({ success: true, data: { imported, updated, skippedNoRate, withPhotos, detailFailures, totalAvailable: result.total, pageNum: result.pageNum, pageSize: result.pageSize } });
  } catch (err) {
    logger.error("cj.sync_failed", { error: err instanceof Error ? err.message : String(err) });
    res.status(502).json({ success: false, error: "Couldn't sync from CJdropshipping — please try again." });
  }
});

router.get("/admin/cj/products/:pid", requireAuth, requireRole(...MANAGER_ROLES), async (req: Request, res: Response): Promise<void> => {
  if (!isCjConfigured()) { res.status(503).json({ success: false, error: "CJdropshipping isn't configured yet — set CJ_EMAIL and CJ_API_KEY." }); return; }
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
  if (!isCjConfigured()) { res.status(503).json({ success: false, error: "CJdropshipping isn't configured yet — set CJ_EMAIL and CJ_API_KEY." }); return; }
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
  if (!isCjConfigured()) { res.status(503).json({ success: false, error: "CJdropshipping isn't configured yet — set CJ_EMAIL and CJ_API_KEY." }); return; }
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
