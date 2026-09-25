import { Router, Request, Response } from "express";
import { pool } from "../db/pool";
import { requireAuth, requireRole } from "../middleware/auth";
import { isCjConfigured, listCjProducts, getCjProductDetail, getCjCategories } from "../services/cjDropshippingClient";
import { convertToZar } from "../utils/pricing";
import { logger } from "../utils/logger";

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

    let imported = 0, updated = 0, skippedNoRate = 0;
    for (const p of result.list) {
      if (usdToZar === null) { skippedNoRate++; continue; } // no USD rate on file yet -- flagged, not silently guessed
      const retailPriceZar = Math.round(Number(p.sellPrice) * usdToZar * 100) / 100;

      const { rows: existing } = await pool!.query(
        `SELECT id FROM mkt_supplier_products WHERE supplier_id = $1 AND external_id = $2`,
        [CJ_SUPPLIER_ID, p.pid]
      );
      if (existing.length) {
        await pool!.query(
          `UPDATE mkt_supplier_products SET name = $1, cost_price = $2, retail_price = $3, images = $4, updated_at = now() WHERE id = $5`,
          [p.productNameEn || p.productName, p.sellPrice, retailPriceZar, JSON.stringify([p.productImage].filter(Boolean)), existing[0].id]
        );
        updated++;
      } else {
        await pool!.query(
          `INSERT INTO mkt_supplier_products (supplier_id, name, description, cost_price, currency, retail_price, moq, images, origin_country, status, external_source, external_id)
           VALUES ($1,$2,$3,$4,'USD',$5,1,$6,'CN','pending_review','cjdropshipping',$7)`,
          [CJ_SUPPLIER_ID, p.productNameEn || p.productName, p.remark ?? null, p.sellPrice, retailPriceZar, JSON.stringify([p.productImage].filter(Boolean)), p.pid]
        );
        imported++;
      }
    }

    logger.info("cj.sync_run", { actorId: req.user!.userId, pageNum: Number(pageNum) || 1, pageSize: boundedPageSize, imported, updated, skippedNoRate });
    res.json({ success: true, data: { imported, updated, skippedNoRate, totalAvailable: result.total, pageNum: result.pageNum, pageSize: result.pageSize } });
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

export default router;
