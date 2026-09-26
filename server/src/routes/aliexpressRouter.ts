import { Router, Request, Response } from "express";
import { pool } from "../db/pool";
import { requireAuth, requireRole } from "../middleware/auth";
import { logger } from "../utils/logger";
import { authorizeUrl, completeAuthorization, connectionStatus, disconnect, AliExpressError, callbackUrl } from "../services/aliexpressClient";
import { importAeProduct, searchAe, fetchAeProduct, cheapestShipping, aliexpressProductId, AE_SUPPLIER_ID } from "../services/aliexpressCatalog";
import { retryFulfillment } from "../services/aliexpressFulfillment";

/**
 * AliExpress: connect the buyer account (OAuth), search and import products,
 * and follow the orders placed on AliExpress. Admin-only, except the OAuth
 * callback AliExpress redirects the browser to (protected by a one-time state).
 */
const router: ReturnType<typeof Router> = Router();
const admin = [requireAuth, requireRole("marketplace_admin")];
const SITE = (process.env.MARKETPLACE_PUBLIC_URL || "https://www.ballylife.com").replace(/\/$/, "");

const fail = (res: Response, err: unknown, fallback: string) => {
  if (err instanceof AliExpressError) {
    const status = err.kind === "config" || err.kind === "not_connected" ? 503 : err.kind === "auth" ? 401 : 502;
    res.status(status).json({ success: false, error: err.message, code: err.code ?? null }); return;
  }
  logger.error("aliexpress.request_failed", { error: err instanceof Error ? err.message : String(err) });
  res.status(500).json({ success: false, error: fallback });
};

router.get("/aliexpress/oauth/callback", async (req: Request, res: Response): Promise<void> => {
  const { code, state } = req.query as Record<string, string | undefined>;
  if (!code || !state) { res.redirect(`${SITE}/?aliexpress=error&reason=${encodeURIComponent("AliExpress didn't send an authorisation code.")}`); return; }
  try {
    await completeAuthorization(code, state);
    res.redirect(`${SITE}/?aliexpress=connected`);
  } catch (err) {
    logger.error("aliexpress.oauth_failed", { error: err instanceof Error ? err.message : String(err) });
    res.redirect(`${SITE}/?aliexpress=error&reason=${encodeURIComponent(err instanceof Error ? err.message.slice(0, 200) : "Connection failed")}`);
  }
});

router.get("/admin/aliexpress/status", ...admin, async (_req: Request, res: Response): Promise<void> => {
  try {
    const status = await connectionStatus();
    const { rows: p } = await pool!.query(
      `SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE status = 'active')::int AS active FROM mkt_supplier_products WHERE supplier_id = $1`, [AE_SUPPLIER_ID]
    );
    const { rows: f } = await pool!.query(`SELECT status, COUNT(*)::int AS n FROM aliexpress_fulfillments GROUP BY status`);
    res.json({ success: true, data: { ...status, callbackUrl: callbackUrl(), imported: p[0]?.n ?? 0, autoPay: /^(1|true|yes)$/i.test(process.env.ALIEXPRESS_AUTO_PAY ?? ""),
      orders: Object.fromEntries(f.map((r: { status: string; n: number }) => [r.status, r.n])) } });
  } catch (err) { fail(res, err, "Couldn't load the AliExpress status."); }
});

router.post("/admin/aliexpress/connect", ...admin, async (req: Request, res: Response): Promise<void> => {
  try { res.json({ success: true, data: { url: await authorizeUrl(req.user!.userId) } }); }
  catch (err) { fail(res, err, "Couldn't start the connection."); }
});

router.post("/admin/aliexpress/disconnect", ...admin, async (_req: Request, res: Response): Promise<void> => {
  try { await disconnect(); res.json({ success: true }); }
  catch (err) { fail(res, err, "Couldn't disconnect."); }
});

/** Diagnostics: fetches one product and its shipping to South Africa without listing anything. */
router.post("/admin/aliexpress/test", ...admin, async (req: Request, res: Response): Promise<void> => {
  const id = aliexpressProductId(String(req.body?.product ?? "1005006349486340"));
  if (!id) { res.status(400).json({ success: false, error: "Give an AliExpress product link or id." }); return; }
  try {
    const p = await fetchAeProduct(id);
    const { rows } = await pool!.query(`SELECT currency, rate_to_zar FROM mkt_fx_rates`);
    const shipping = await cheapestShipping(id, p.variants[0]?.skuId || undefined, new Map(rows.map((r: { currency: string; rate_to_zar: string }) => [r.currency, Number(r.rate_to_zar)])));
    res.json({ success: true, data: { productId: id, title: p.title, variants: p.variants.length, images: p.images.length, available: p.available,
      cheapestUsd: Math.min(...p.variants.map(v => v.priceUsd)), shipping } });
  } catch (err) { fail(res, err, "The test call failed."); }
});

router.get("/admin/aliexpress/search", ...admin, async (req: Request, res: Response): Promise<void> => {
  const q = String(req.query.q ?? "").trim();
  if (!q) { res.status(400).json({ success: false, error: "Enter something to search for." }); return; }
  try { res.json({ success: true, data: await searchAe(q, Math.max(1, Number(req.query.page) || 1)) }); }
  catch (err) { fail(res, err, "Search failed."); }
});

router.post("/admin/aliexpress/import", ...admin, async (req: Request, res: Response): Promise<void> => {
  const items = (Array.isArray(req.body?.items) ? req.body.items : [req.body?.item]).map((x: unknown) => String(x ?? "").trim()).filter(Boolean).slice(0, 20);
  if (!items.length) { res.status(400).json({ success: false, error: "Paste one or more AliExpress product links or ids." }); return; }
  const results = [];
  for (const item of items) {
    try { results.push(await importAeProduct(item)); }
    catch (err) {
      if (err instanceof AliExpressError && (err.kind === "config" || err.kind === "not_connected" || err.kind === "auth")) { fail(res, err, "Import failed."); return; }
      results.push({ productId: aliexpressProductId(item) ?? item, listed: false, storeProductId: null, priceZar: null, reason: err instanceof Error ? err.message : String(err) });
    }
  }
  res.json({ success: true, data: results });
});

router.get("/admin/aliexpress/products", ...admin, async (_req: Request, res: Response): Promise<void> => {
  try {
    const { rows } = await pool!.query(
      `SELECT sp.external_id, sp.name, sp.cost_price, sp.est_shipping_usd, sp.est_logistic_name, sp.updated_at, p.id AS product_id, p.price, p.status
       FROM mkt_supplier_products sp LEFT JOIN mkt_products p ON p.supplier_product_id = sp.id AND p.seller_id = 'sel-ballylife'
       WHERE sp.supplier_id = $1 ORDER BY sp.updated_at DESC LIMIT 300`, [AE_SUPPLIER_ID]
    );
    res.json({ success: true, data: rows.map(r => ({
      aliexpressId: r.external_id, name: r.name, costUsd: Number(r.cost_price), shippingUsd: r.est_shipping_usd !== null ? Number(r.est_shipping_usd) : null,
      shippingService: r.est_logistic_name, productId: r.product_id, priceZar: r.price !== null ? Number(r.price) : null, status: r.status ?? "not listed", updatedAt: r.updated_at,
      url: `https://www.aliexpress.com/item/${r.external_id}.html`,
    })) });
  } catch (err) { fail(res, err, "Couldn't load products."); }
});

router.get("/admin/aliexpress/fulfillments", ...admin, async (_req: Request, res: Response): Promise<void> => {
  try {
    const { rows } = await pool!.query(
      `SELECT f.*, o.order_number, o.total_amount FROM aliexpress_fulfillments f JOIN mkt_orders o ON o.id = f.order_id ORDER BY f.created_at DESC LIMIT 200`
    );
    res.json({ success: true, data: rows.map(r => ({
      id: r.id, orderNumber: r.order_number, totalZar: Number(r.total_amount), status: r.status, aeOrderIds: r.ae_order_ids, aeStatus: r.ae_status, paid: r.paid,
      trackingNumber: r.tracking_number, logisticsService: r.logistics_service, lastError: r.last_error, attempts: r.attempts, createdAt: r.created_at, updatedAt: r.updated_at,
    })) });
  } catch (err) { fail(res, err, "Couldn't load orders."); }
});

router.post("/admin/aliexpress/fulfillments/:id/retry", ...admin, async (req: Request, res: Response): Promise<void> => {
  try {
    const row = await retryFulfillment(req.params.id);
    if (!row) { res.status(409).json({ success: false, error: "Only orders that need attention or failed can be retried." }); return; }
    res.json({ success: true, data: { id: row.id, status: row.status } });
  } catch (err) { fail(res, err, "Couldn't retry."); }
});

export default router;
