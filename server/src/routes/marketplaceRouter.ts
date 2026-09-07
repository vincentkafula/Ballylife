import { Router, Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { pool } from "../db/pool";
import { requireAuth, requireRole, JWT_SECRET, JWT_EXPIRES } from "../middleware/auth";
import { submitOrderPayment, getOrderTransactions, refundOrder } from "../services/mktPay";
import { verifyItnSignature, confirmWithPayfast } from "../services/payfastProcessor";
import { sendOrderConfirmationEmail } from "../services/emailService";
import { checkPaymentVelocity } from "../services/fraudChecks";

// Standalone marketplace has one manager role, not Vink's RBAC roles
// (owner/superadmin/noc_engineer/billing_admin were Vink-side authority
// roles that don't exist in this backend's own users.role column).
const MANAGER_ROLES = ["marketplace_admin"] as const;

// Only the account owner (or a marketplace manager) may read/write a
// customer's own cart, wishlist, addresses, or stats — a valid login alone
// isn't enough, the :userId in the URL must match the signed-in user.
function requireSelf(req: Request, res: Response, next: NextFunction): void {
  if (req.user!.userId !== req.params.userId && !MANAGER_ROLES.includes(req.user!.role as any)) {
    res.status(403).json({ success: false, error: "You can only access your own account" });
    return;
  }
  next();
}

// Only the seller who owns this store (or a marketplace manager) may manage
// its products, orders, or profile.
async function requireSellerOwner(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (MANAGER_ROLES.includes(req.user!.role as any)) { next(); return; }
  const { rows } = await pool!.query(`SELECT user_id FROM mkt_sellers WHERE id = $1`, [req.params.id]);
  if (!rows.length || rows[0].user_id !== req.user!.userId) {
    res.status(403).json({ success: false, error: "You can only manage your own store" });
    return;
  }
  next();
}

// Only the supplier account linked to this record (or a marketplace
// manager) may view/manage its own catalog, orders, or profile — a
// supplier never gets access to another supplier's data.
async function requireSupplierOwner(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (MANAGER_ROLES.includes(req.user!.role as any)) { next(); return; }
  const { rows } = await pool!.query(`SELECT user_id FROM mkt_suppliers WHERE id = $1`, [req.params.id]);
  if (!rows.length || rows[0].user_id !== req.user!.userId) {
    res.status(403).json({ success: false, error: "You can only manage your own supplier account" });
    return;
  }
  next();
}

// Only the revenue-authority account linked to this record (or a
// marketplace manager) may view it — a country's authority never sees
// another country's figures, and never anything beyond read access.
async function requireAuthorityOwner(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (MANAGER_ROLES.includes(req.user!.role as any)) { next(); return; }
  const { rows } = await pool!.query(`SELECT user_id FROM mkt_revenue_authorities WHERE id = $1`, [req.params.id]);
  if (!rows.length || rows[0].user_id !== req.user!.userId) {
    res.status(403).json({ success: false, error: "You can only view your own authority's data" });
    return;
  }
  next();
}

const router: ReturnType<typeof Router> = Router();

// ─── Row → API shape mappers (snake_case columns → camelCase JSON) ──────────
const mapCategory = (r: any) => ({
  id: r.id, name: r.name, slug: r.slug, icon: r.icon, parentId: r.parent_id,
  productCount: Number(r.product_count ?? 0), featured: r.featured,
});

const mapSeller = (r: any) => ({
  id: r.id, userId: r.user_id, storeName: r.store_name, storeSlug: r.store_slug,
  description: r.description, logoUrl: r.logo_url, bannerUrl: r.banner_url, email: r.email,
  phone: r.phone, country: r.country, status: r.status, kycVerified: r.kyc_verified, taxId: r.tax_id,
  totalProducts: Number(r.total_products ?? 0), totalSales: r.total_sales, totalRevenue: Number(r.total_revenue),
  avgRating: Number(r.avg_rating), reviewCount: r.review_count, joinedAt: r.joined_at, commissionPct: Number(r.commission_pct),
  applicationData: r.application_data ?? {},
});

const mapProduct = (r: any, sellerName?: string, categoryName?: string) => ({
  id: r.id, sellerId: r.seller_id, sellerName: sellerName ?? r.seller_name,
  categoryId: r.category_id, categoryName: categoryName ?? r.category_name,
  name: r.name, slug: r.slug, description: r.description, shortDescription: r.short_description,
  price: Number(r.price), compareAtPrice: r.compare_at_price !== null ? Number(r.compare_at_price) : null,
  currency: r.currency, images: r.images, emoji: r.emoji, status: r.status, stock: r.stock, sku: r.sku,
  brand: r.brand, tags: r.tags, attributes: r.attributes, variants: r.variants,
  avgRating: Number(r.avg_rating), reviewCount: r.review_count, totalSold: r.total_sold,
  isFeatured: r.is_featured, isFlashDeal: r.is_flash_deal, flashDealEndsAt: r.flash_deal_ends_at,
  fulfillmentType: r.fulfillment_type ?? "local", supplierProductId: r.supplier_product_id ?? null,
  vehicleDetails: r.vehicle_details ?? null, condition: r.condition ?? null, nrcsApproved: r.nrcs_approved ?? false, nrcsReference: r.nrcs_reference ?? null,
  createdAt: r.created_at, updatedAt: r.updated_at,
});

const mapSupplier = (r: any) => ({
  id: r.id, name: r.name, country: r.country, contactName: r.contact_name, contactEmail: r.contact_email,
  contactPhone: r.contact_phone, platform: r.platform, paymentTerms: r.payment_terms, leadTimeDays: r.lead_time_days,
  dropshipSupported: r.dropship_supported, verified: r.verified, status: r.status, notes: r.notes, userId: r.user_id ?? null, createdAt: r.created_at,
});

const mapSupplierProduct = (r: any) => ({
  id: r.id, supplierId: r.supplier_id, supplierName: r.supplier_name, supplierCountry: r.supplier_country,
  categoryId: r.category_id, name: r.name, description: r.description, costPrice: Number(r.cost_price),
  currency: r.currency, retailPrice: Number(r.retail_price), compareAtPrice: r.compare_at_price !== null && r.compare_at_price !== undefined ? Number(r.compare_at_price) : null,
  moq: r.moq, images: r.images, emoji: r.emoji, originCountry: r.origin_country,
  status: r.status, importCount: r.import_count,
  vehicleDetails: r.vehicle_details ?? null, condition: r.condition ?? null, nrcsApproved: r.nrcs_approved ?? false, nrcsReference: r.nrcs_reference ?? null,
  createdAt: r.created_at, updatedAt: r.updated_at,
});

const mapWarehouse = (r: any) => ({
  id: r.id, name: r.name, country: r.country, type: r.type, address: r.address, status: r.status, createdAt: r.created_at,
});

const mapShipment = (r: any) => ({
  id: r.id, originWarehouseId: r.origin_warehouse_id, originWarehouseName: r.origin_warehouse_name,
  destinationWarehouseId: r.destination_warehouse_id, destinationWarehouseName: r.destination_warehouse_name,
  status: r.status, carrier: r.carrier, trackingNumber: r.tracking_number, dispatchedAt: r.dispatched_at,
  receivedAt: r.received_at, customsClearedAt: r.customs_cleared_at, closedAt: r.closed_at,
  orderCount: r.order_count !== undefined ? Number(r.order_count) : undefined, createdAt: r.created_at,
});

const mapSupplierOrder = (r: any) => ({
  id: r.id, orderId: r.order_id, orderNumber: r.order_number, productId: r.product_id, productName: r.product_name,
  supplierId: r.supplier_id, supplierName: r.supplier_name, supplierProductId: r.supplier_product_id,
  sellerId: r.seller_id, sellerName: r.seller_name, quantity: r.quantity, costAmount: Number(r.cost_amount),
  originWarehouseId: r.origin_warehouse_id, originWarehouseName: r.origin_warehouse_name,
  destinationWarehouseId: r.destination_warehouse_id, destinationWarehouseName: r.destination_warehouse_name,
  shipmentId: r.shipment_id, status: r.status, qcNotes: r.qc_notes, createdAt: r.created_at, updatedAt: r.updated_at,
});

// Destination warehouse is picked from the customer's shipping country —
// each supplier order routes to whichever of the two destination hubs
// (South Africa / Zambia) serves that customer, defaulting to South Africa
// for any other/unrecognised country rather than failing the order.
const DESTINATION_WAREHOUSE_BY_COUNTRY: Record<string, string> = { ZA: "wh-dest-za", ZM: "wh-dest-zm" };
const ORIGIN_WAREHOUSE_BY_SUPPLIER_COUNTRY: Record<string, string> = { CN: "wh-origin-cn", JP: "wh-origin-jp", KR: "wh-origin-kr" };

// Valid forward transitions for a supplier order's two-leg status machine —
// used to reject an admin trying to skip steps or move backwards.
const SUPPLIER_ORDER_TRANSITIONS: Record<string, string[]> = {
  ordered_from_supplier: ["received_at_origin_hub"],
  received_at_origin_hub: ["qc_passed_origin", "qc_failed_origin"],
  qc_passed_origin: ["in_transit_to_destination"],
  qc_failed_origin: [], // terminal — handled manually (refund/reorder) outside this state machine
  in_transit_to_destination: ["received_at_destination_hub"],
  received_at_destination_hub: ["customs_cleared"],
  customs_cleared: ["shipped_to_customer"],
  shipped_to_customer: ["delivered"],
  delivered: [],
};

const mapOrder = (r: any) => ({
  id: r.id, orderNumber: r.order_number, userId: r.user_id, customerName: r.customer_name,
  customerEmail: r.customer_email, items: r.items, subtotal: Number(r.subtotal),
  shippingCost: Number(r.shipping_cost), taxAmount: Number(r.tax_amount), dutyAmount: Number(r.duty_amount ?? 0), discountAmount: Number(r.discount_amount),
  totalAmount: Number(r.total_amount), currency: r.currency, status: r.status, paymentStatus: r.payment_status,
  paymentMethod: r.payment_method, shippingAddress: r.shipping_address, shippingStatus: r.shipping_status,
  trackingNumber: r.tracking_number, carrier: r.carrier, estimatedDelivery: r.estimated_delivery,
  couponCode: r.coupon_code, notes: r.notes, placedAt: r.placed_at, confirmedAt: r.confirmed_at,
  shippedAt: r.shipped_at, deliveredAt: r.delivered_at, cancelledAt: r.cancelled_at, refundedAmount: Number(r.refunded_amount ?? 0),
});

const mapOrderRefund = (r: any) => ({
  id: r.id, orderId: r.order_id, orderNumber: r.order_number, productId: r.product_id, productName: r.product_name,
  quantity: r.quantity, amount: Number(r.amount), reason: r.reason, status: r.status,
  processorRef: r.processor_ref, initiatedBy: r.initiated_by, createdAt: r.created_at,
});

const mapTaxRate = (r: any) => ({
  country: r.country, vatRatePct: Number(r.vat_rate_pct), defaultDutyRatePct: Number(r.default_duty_rate_pct),
  notes: r.notes, updatedAt: r.updated_at,
});

const mapDutyRate = (r: any) => ({
  id: r.id, country: r.country, categoryId: r.category_id, categoryName: r.category_name,
  dutyRatePct: Number(r.duty_rate_pct), notes: r.notes,
});

const mapCustomsRecord = (r: any) => ({
  id: r.id, shipmentId: r.shipment_id, destinationCountry: r.destination_country, declaredValue: Number(r.declared_value),
  dutyAmount: Number(r.duty_amount), vatAmount: Number(r.vat_amount), totalPayable: Number(r.total_payable), currency: r.currency,
  clearingAgent: r.clearing_agent, referenceNumber: r.reference_number, status: r.status,
  prepaidAt: r.prepaid_at, declaredAt: r.declared_at, clearedAt: r.cleared_at, notes: r.notes,
  originWarehouseName: r.origin_warehouse_name, destinationWarehouseName: r.destination_warehouse_name,
  orderCount: r.order_count !== undefined ? Number(r.order_count) : undefined,
  createdAt: r.created_at, updatedAt: r.updated_at,
});

const mapRevenueAuthority = (r: any) => ({
  id: r.id, name: r.name, country: r.country, contactName: r.contact_name, contactEmail: r.contact_email,
  status: r.status, notes: r.notes, userId: r.user_id ?? null, createdAt: r.created_at,
});

const mapVehicleDutyZm = (r: any) => ({
  id: r.id, bodyType: r.body_type, engineCcMin: r.engine_cc_min, engineCcMax: r.engine_cc_max,
  ageBand: r.age_band, dutyKwacha: Number(r.duty_kwacha), carbonSurtaxKwacha: Number(r.carbon_surtax_kwacha), notes: r.notes,
});

const mapFxRate = (r: any) => ({ currency: r.currency, rateToZar: Number(r.rate_to_zar), notes: r.notes, updatedAt: r.updated_at });

const mapSettlement = (r: any) => ({
  id: r.id, orderId: r.order_id, orderNumber: r.order_number, productId: r.product_id, productName: r.product_name,
  sellerId: r.seller_id, sellerName: r.seller_name, supplierId: r.supplier_id, supplierName: r.supplier_name,
  quantity: r.quantity, grossAmount: Number(r.gross_amount), platformFeePct: Number(r.platform_fee_pct), platformFeeAmount: Number(r.platform_fee_amount),
  supplierCostAmount: r.supplier_cost_amount !== null ? Number(r.supplier_cost_amount) : null, supplierCostCurrency: r.supplier_cost_currency,
  supplierCostAmountZar: r.supplier_cost_amount_zar !== null ? Number(r.supplier_cost_amount_zar) : null,
  sellerPayoutAmount: Number(r.seller_payout_amount), supplierPayoutStatus: r.supplier_payout_status, sellerPayoutStatus: r.seller_payout_status,
  supplierPayoutReference: r.supplier_payout_reference, sellerPayoutReference: r.seller_payout_reference,
  supplierPaidAt: r.supplier_paid_at, sellerPaidAt: r.seller_paid_at, createdAt: r.created_at,
});

// Valid forward transitions for a customs record — mirrors the real
// workflow: computed in-system, funds handed to whichever accredited
// courier/broker declares it, that declaration accepted, goods released.
// "held" can be reached from prepaid/declared (customs queries/inspects)
// and can resolve back to declared or forward to cleared.
const CUSTOMS_RECORD_TRANSITIONS: Record<string, string[]> = {
  duty_calculated: ["prepaid_to_agent"],
  prepaid_to_agent: ["declared_to_customs", "held"],
  declared_to_customs: ["cleared", "held"],
  held: ["declared_to_customs", "cleared"],
  cleared: [],
};

const mapReview = (r: any) => ({
  id: r.id, productId: r.product_id, userId: r.user_id, orderId: r.order_id, rating: r.rating,
  title: r.title, body: r.body, verifiedPurchase: r.verified_purchase, status: r.status,
  helpful: r.helpful, images: r.images, createdAt: r.created_at, reviewerName: r.reviewer_name,
});

const mapAddress = (r: any) => ({
  id: r.id, userId: r.user_id, label: r.label, firstName: r.first_name, lastName: r.last_name,
  line1: r.line1, line2: r.line2, city: r.city, state: r.state, postalCode: r.postal_code,
  country: r.country, phone: r.phone, isDefault: r.is_default,
});

const cartRowToApi = (r: any) => ({
  id: r.id, userId: r.user_id, items: r.items, couponCode: r.coupon_code, couponDiscount: Number(r.coupon_discount),
  subtotal: Number(r.subtotal), shipping: Number(r.shipping), tax: Number(r.tax), total: Number(r.total),
  createdAt: r.created_at, updatedAt: r.updated_at,
});

function recalcCartTotals(items: any[], coupon: any | null) {
  const subtotal = +items.reduce((s, i) => s + i.unitPrice * i.quantity, 0).toFixed(2);
  let couponDiscount = 0;
  if (coupon) {
    if (coupon.type === "percentage") couponDiscount = Math.min(+(subtotal * Number(coupon.value) / 100).toFixed(2), coupon.max_discount_amount ? Number(coupon.max_discount_amount) : Infinity);
    else if (coupon.type === "fixed_amount") couponDiscount = Math.min(Number(coupon.value), subtotal);
  }
  const shipping = subtotal > 500 || coupon?.type === "free_shipping" ? 0 : (items.length ? 99 : 0);
  const tax = +(subtotal * 0.15).toFixed(2);
  const total = +(subtotal + shipping + tax - couponDiscount).toFixed(2);
  return { subtotal, shipping, tax, total, couponDiscount };
}

// ── CATEGORIES ────────────────────────────────────────────────────────────────
router.get("/categories", async (_req: Request, res: Response): Promise<void> => {
  const { rows } = await pool!.query(`
    SELECT c.*, COUNT(p.id)::int AS product_count
    FROM mkt_categories c
    LEFT JOIN mkt_products p ON p.category_id = c.id AND p.status = 'active'
    GROUP BY c.id ORDER BY c.name`);
  res.json({ success: true, data: rows.map(mapCategory) });
});

// ── PRODUCTS ──────────────────────────────────────────────────────────────────
router.get("/products", async (req: Request, res: Response): Promise<void> => {
  const { category, search, minPrice, maxPrice, brand, rating, sort, page: pg, limit: lim, featured, flashDeal } = req.query as Record<string, string>;
  const page = Math.max(1, Number(pg) || 1);
  const limit = Math.min(80, Number(lim) || 12);

  const where: string[] = [`p.status = 'active'`];
  const params: unknown[] = [];
  const p = (val: unknown) => { params.push(val); return `$${params.length}`; };

  if (category)  where.push(`(p.category_id = ${p(category)} OR LOWER(c.name) = LOWER(${p(category)}))`);
  if (search)    where.push(`(LOWER(p.name) LIKE ${p(`%${search.toLowerCase()}%`)} OR LOWER(p.brand) LIKE ${p(`%${search.toLowerCase()}%`)} OR p.tags::text ILIKE ${p(`%${search.toLowerCase()}%`)})`);
  if (minPrice)  where.push(`p.price >= ${p(Number(minPrice))}`);
  if (maxPrice)  where.push(`p.price <= ${p(Number(maxPrice))}`);
  if (brand)     where.push(`LOWER(p.brand) = LOWER(${p(brand)})`);
  if (rating)    where.push(`p.avg_rating >= ${p(Number(rating))}`);
  if (featured === "true")  where.push(`p.is_featured = ${p(true)}`);
  if (flashDeal === "true") where.push(`p.is_flash_deal = ${p(true)}`);

  let orderBy = "p.created_at DESC";
  if (sort === "price_asc") orderBy = "p.price ASC";
  else if (sort === "price_desc") orderBy = "p.price DESC";
  else if (sort === "rating") orderBy = "p.avg_rating DESC";
  else if (sort === "popular") orderBy = "p.total_sold DESC";
  else if (sort === "newest") orderBy = "p.created_at DESC";

  const baseQuery = `FROM mkt_products p JOIN mkt_sellers s ON s.id = p.seller_id JOIN mkt_categories c ON c.id = p.category_id WHERE ${where.join(" AND ")}`;
  const { rows: countRows } = await pool!.query(`SELECT COUNT(*)::int AS total ${baseQuery}`, params);
  const total = countRows[0].total;

  const { rows } = await pool!.query(
    `SELECT p.*, s.store_name AS seller_name, c.name AS category_name ${baseQuery} ORDER BY ${orderBy} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, (page - 1) * limit]
  );
  const { rows: brandRows } = await pool!.query(`SELECT DISTINCT brand FROM mkt_products WHERE status = 'active' ORDER BY brand`);

  res.json({
    success: true,
    data: rows.map(r => mapProduct(r)),
    meta: { page, limit, total, pages: Math.ceil(total / limit), brands: brandRows.map(b => b.brand) },
  });
});

router.get("/products/search-suggest", async (req: Request, res: Response): Promise<void> => {
  const q = String(req.query.q ?? "").toLowerCase();
  if (!q || q.length < 2) { res.json({ success: true, data: [] }); return; }
  const { rows } = await pool!.query(
    `SELECT id, name, price, emoji, (SELECT name FROM mkt_categories WHERE id = category_id) AS category
     FROM mkt_products WHERE LOWER(name) LIKE $1 OR LOWER(brand) LIKE $1 LIMIT 6`,
    [`%${q}%`]
  );
  res.json({ success: true, data: rows.map(r => ({ id: r.id, name: r.name, price: Number(r.price), emoji: r.emoji, category: r.category })) });
});

router.get("/products/:id", async (req: Request, res: Response): Promise<void> => {
  const { rows } = await pool!.query(
    `SELECT p.*, s.store_name AS seller_name, c.name AS category_name
     FROM mkt_products p JOIN mkt_sellers s ON s.id = p.seller_id JOIN mkt_categories c ON c.id = p.category_id
     WHERE p.id::text = $1 OR p.slug = $1`, [req.params.id]
  );
  if (!rows.length) { res.status(404).json({ success: false, error: "Product not found" }); return; }
  const product = mapProduct(rows[0]);
  const [{ rows: sellerRows }, { rows: reviewRows }, { rows: relatedRows }] = await Promise.all([
    pool!.query(`SELECT * FROM mkt_sellers WHERE id = $1`, [product.sellerId]),
    pool!.query(`SELECT * FROM mkt_reviews WHERE product_id = $1 AND status = 'approved' ORDER BY created_at DESC`, [product.id]),
    pool!.query(`SELECT p.*, s.store_name AS seller_name, c.name AS category_name FROM mkt_products p
       JOIN mkt_sellers s ON s.id = p.seller_id JOIN mkt_categories c ON c.id = p.category_id
       WHERE p.category_id = $1 AND p.id != $2 AND p.status = 'active' LIMIT 4`, [product.categoryId, product.id]),
  ]);
  res.json({
    success: true,
    data: {
      product, seller: sellerRows[0] ? mapSeller(sellerRows[0]) : null,
      reviews: reviewRows.map(mapReview), related: relatedRows.map(r => mapProduct(r)),
    },
  });
});

// ── SUPPLIER CATALOG (sellers browse/import; never exposed to customers) ────
// Requires auth (any signed-in seller account) but not requireSellerOwner —
// every seller may browse the same shared catalog, they just each decide
// independently whether to import a given item into their own store.
router.get("/supplier-catalog", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { country, category, search, page: pg, limit: lim } = req.query as Record<string, string>;
  const page = Math.max(1, Number(pg) || 1);
  const limit = Math.min(60, Number(lim) || 20);
  const where: string[] = [`sp.status = 'active'`];
  const params: unknown[] = [];
  const p = (val: unknown) => { params.push(val); return `$${params.length}`; };
  if (country)  where.push(`sp.origin_country = ${p(country)}`);
  if (category) where.push(`sp.category_id = ${p(category)}`);
  if (search)   where.push(`LOWER(sp.name) LIKE ${p(`%${search.toLowerCase()}%`)}`);

  const baseQuery = `FROM mkt_supplier_products sp JOIN mkt_suppliers s ON s.id = sp.supplier_id WHERE ${where.join(" AND ")}`;
  const { rows: countRows } = await pool!.query(`SELECT COUNT(*)::int AS total ${baseQuery}`, params);
  const { rows } = await pool!.query(
    `SELECT sp.*, s.name AS supplier_name, s.country AS supplier_country ${baseQuery}
     ORDER BY sp.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, (page - 1) * limit]
  );
  res.json({ success: true, data: rows.map(mapSupplierProduct), meta: { page, limit, total: countRows[0].total, pages: Math.ceil(countRows[0].total / limit) } });
});

router.get("/supplier-catalog/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { rows } = await pool!.query(
    `SELECT sp.*, s.name AS supplier_name, s.country AS supplier_country
     FROM mkt_supplier_products sp JOIN mkt_suppliers s ON s.id = sp.supplier_id WHERE sp.id::text = $1`, [req.params.id]
  );
  if (!rows.length) { res.status(404).json({ success: false, error: "Catalog item not found" }); return; }
  res.json({ success: true, data: mapSupplierProduct(rows[0]) });
});

// ── CART ──────────────────────────────────────────────────────────────────────
router.get("/cart/:userId", requireAuth, requireSelf, async (req: Request, res: Response): Promise<void> => {
  const { rows } = await pool!.query(`SELECT * FROM mkt_carts WHERE user_id = $1`, [req.params.userId]);
  res.json({ success: true, data: rows[0] ? cartRowToApi(rows[0]) : null });
});

async function getOrCreateCart(userId: string) {
  const { rows } = await pool!.query(`SELECT * FROM mkt_carts WHERE user_id = $1`, [userId]);
  if (rows.length) return rows[0];
  const { rows: inserted } = await pool!.query(
    `INSERT INTO mkt_carts (user_id, items) VALUES ($1, '[]') RETURNING *`, [userId]
  );
  return inserted[0];
}

async function saveCart(cartId: string, items: any[], couponCode: string | null) {
  let coupon = null;
  if (couponCode) {
    const { rows } = await pool!.query(`SELECT * FROM mkt_coupons WHERE code = $1 AND active = true`, [couponCode]);
    coupon = rows[0] ?? null;
  }
  const totals = recalcCartTotals(items, coupon);
  const { rows } = await pool!.query(
    `UPDATE mkt_carts SET items = $1, coupon_code = $2, coupon_discount = $3, subtotal = $4,
       shipping = $5, tax = $6, total = $7, updated_at = now() WHERE id = $8 RETURNING *`,
    [JSON.stringify(items), couponCode, totals.couponDiscount, totals.subtotal, totals.shipping, totals.tax, totals.total, cartId]
  );
  return rows[0];
}

router.post("/cart/:userId/add", requireAuth, requireSelf, async (req: Request, res: Response): Promise<void> => {
  const { productId, variantId, quantity } = req.body;
  const { rows: productRows } = await pool!.query(
    `SELECT p.*, s.store_name AS seller_name FROM mkt_products p JOIN mkt_sellers s ON s.id = p.seller_id WHERE p.id::text = $1`, [productId]
  );
  if (!productRows.length) { res.status(404).json({ success: false, error: "Product not found" }); return; }
  const product = mapProduct(productRows[0]);
  if (product.stock <= 0) { res.status(409).json({ success: false, error: "This product is out of stock." }); return; }

  const cartRow = await getOrCreateCart(req.params.userId);
  const items: any[] = cartRow.items;
  const existing = items.find(i => i.productId === productId && i.variantId === (variantId ?? null));
  const requestedQty = (existing?.quantity ?? 0) + (quantity ?? 1);
  if (requestedQty > product.stock) {
    res.status(409).json({ success: false, error: `Only ${product.stock} left in stock.` });
    return;
  }
  if (existing) existing.quantity += (quantity ?? 1);
  else items.push({ productId, variantId: variantId ?? null, quantity: quantity ?? 1, unitPrice: product.price, name: product.name, emoji: product.emoji, sellerId: product.sellerId, sellerName: product.sellerName, maxStock: product.stock });

  const updated = await saveCart(cartRow.id, items, cartRow.coupon_code);
  res.json({ success: true, data: cartRowToApi(updated) });
});

router.patch("/cart/:userId/item/:productId", requireAuth, requireSelf, async (req: Request, res: Response): Promise<void> => {
  const { rows } = await pool!.query(`SELECT * FROM mkt_carts WHERE user_id = $1`, [req.params.userId]);
  if (!rows.length) { res.status(404).json({ success: false, error: "Cart not found" }); return; }
  let items: any[] = rows[0].items;
  const { quantity } = req.body;
  if (quantity <= 0) items = items.filter(i => i.productId !== req.params.productId);
  else { const item = items.find(i => i.productId === req.params.productId); if (item) item.quantity = quantity; }
  const updated = await saveCart(rows[0].id, items, rows[0].coupon_code);
  res.json({ success: true, data: cartRowToApi(updated) });
});

router.delete("/cart/:userId/item/:productId", requireAuth, requireSelf, async (req: Request, res: Response): Promise<void> => {
  const { rows } = await pool!.query(`SELECT * FROM mkt_carts WHERE user_id = $1`, [req.params.userId]);
  if (!rows.length) { res.status(404).json({ success: false, error: "Cart not found" }); return; }
  const items = (rows[0].items as any[]).filter(i => i.productId !== req.params.productId);
  const updated = await saveCart(rows[0].id, items, rows[0].coupon_code);
  res.json({ success: true, data: cartRowToApi(updated) });
});

router.post("/cart/:userId/coupon", requireAuth, requireSelf, async (req: Request, res: Response): Promise<void> => {
  const { rows } = await pool!.query(`SELECT * FROM mkt_carts WHERE user_id = $1`, [req.params.userId]);
  if (!rows.length) { res.status(404).json({ success: false, error: "Cart not found" }); return; }
  const { rows: couponRows } = await pool!.query(`SELECT * FROM mkt_coupons WHERE code = $1 AND active = true`, [String(req.body.code ?? "").toUpperCase()]);
  if (!couponRows.length) { res.status(400).json({ success: false, error: "Invalid or expired coupon code" }); return; }
  const coupon = couponRows[0];
  const currentSubtotal = Number(rows[0].subtotal);
  if (currentSubtotal < Number(coupon.min_order_amount)) { res.status(400).json({ success: false, error: `Minimum order of R${coupon.min_order_amount} required` }); return; }
  const updated = await saveCart(rows[0].id, rows[0].items, coupon.code);
  res.json({ success: true, data: cartRowToApi(updated), message: `Coupon applied — you save R${Number(updated.coupon_discount).toFixed(2)}!` });
});

// ── PAYFAST ITN WEBHOOK ─────────────────────────────────────────────────────
// PayFast POSTs here (form-urlencoded, see index.ts's express.urlencoded
// middleware) once a payment actually completes or fails — this is the
// ONLY place a payment gets marked confirmed; nothing in the order-
// creation flow does that optimistically. Always responds 200 unless the
// signature check fails, since PayFast retries on anything else and a
// 5xx here would just cause a hammering retry loop for a problem on our
// side, not theirs.
//
// Signature check is the first of PayFast's two recommended layers — a
// source-IP allowlist against PayFast's published ranges (or the second
// POST-back to their /eng/query/validate endpoint) isn't implemented
// here yet; add one before relying on this for real payments.
// Signature check is the first of PayFast's two recommended layers; the
// server-to-server confirmWithPayfast round-trip below is the second —
// together they mean a forged request can't be accepted just by
// replicating the signature formula, it has to actually be echoed back
// as valid by PayFast's own servers.
router.post("/payfast/notify", async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as Record<string, string>;
    if (!verifyItnSignature(body)) {
      console.error("[payfast] ITN signature mismatch — rejecting", { m_payment_id: body?.m_payment_id });
      res.status(400).send("invalid signature");
      return;
    }
    const rawBody = (req as Request & { rawBody?: string }).rawBody;
    if (!rawBody || !(await confirmWithPayfast(rawBody))) {
      console.error("[payfast] Validate callback did not confirm — rejecting", { m_payment_id: body?.m_payment_id });
      res.status(400).send("not confirmed by payfast");
      return;
    }
    const processorRef = body.m_payment_id;
    const paymentStatus = body.payment_status; // COMPLETE | FAILED | PENDING (PayFast's vocabulary)
    const newStatus = paymentStatus === "COMPLETE" ? "confirmed" : paymentStatus === "FAILED" ? "failed" : "submitted";

    const { rows: txRows } = await pool!.query(
      `UPDATE mkt_pay_transactions SET status = $1, webhook_received_at = now() WHERE processor_ref = $2 RETURNING order_id`,
      [newStatus, processorRef]
    );
    if (!txRows.length) { console.error("[payfast] No matching transaction for", processorRef); res.status(200).send("OK"); return; }
    const orderId = txRows[0].order_id;

    if (newStatus === "confirmed") {
      await pool!.query(`UPDATE mkt_orders SET status = 'confirmed', payment_status = 'payment_confirmed', confirmed_at = now() WHERE id = $1`, [orderId]);
    } else if (newStatus === "failed") {
      await pool!.query(`UPDATE mkt_orders SET status = 'payment_failed', payment_status = 'payment_failed' WHERE id = $1`, [orderId]);
    }
    res.status(200).send("OK");
  } catch (err) {
    console.error("[payfast] ITN handling failed:", err);
    res.status(200).send("OK"); // still 200 -- see comment above on why
  }
});

// ── ORDERS ────────────────────────────────────────────────────────────────────
// Public order tracking — no login required, since a guest checkout buyer
// still needs to check on their order. Requires both the order number and
// the email it was placed with (a lightweight anti-enumeration check, not
// full auth) — a mismatch returns the same 404 as a nonexistent order
// number, so this can't be used to confirm whether an email placed an
// order at all. Returns customer-safe fields only: no supplier names, no
// cost/margin figures, no internal warehouse identifiers — just enough to
// show a timeline.
router.get("/orders/track", async (req: Request, res: Response): Promise<void> => {
  const { orderNumber, email } = req.query as Record<string, string>;
  if (!orderNumber || !email) { res.status(400).json({ success: false, error: "orderNumber and email are required" }); return; }

  const { rows } = await pool!.query(`SELECT * FROM mkt_orders WHERE order_number = $1`, [orderNumber]);
  if (!rows.length || rows[0].customer_email.toLowerCase() !== email.toLowerCase()) {
    res.status(404).json({ success: false, error: "No order found with that order number and email" });
    return;
  }
  const order = rows[0];

  const { rows: supplierOrders } = await pool!.query(
    `SELECT so.status, so.quantity, p.name AS product_name, p.emoji
     FROM mkt_supplier_orders so JOIN mkt_products p ON p.id = so.product_id
     WHERE so.order_id = $1 ORDER BY so.created_at`,
    [order.id]
  );

  res.json({
    success: true,
    data: {
      orderNumber: order.order_number, status: order.status, shippingStatus: order.shipping_status,
      paymentStatus: order.payment_status, totalAmount: Number(order.total_amount), currency: order.currency,
      trackingNumber: order.tracking_number, carrier: order.carrier, estimatedDelivery: order.estimated_delivery,
      placedAt: order.placed_at, shippedAt: order.shipped_at, deliveredAt: order.delivered_at,
      items: order.items,
      importedItems: supplierOrders.map((so: any) => ({ productName: so.product_name, emoji: so.emoji, quantity: so.quantity, status: so.status })),
    },
  });
});

router.get("/orders", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { status, page: pg, limit: lim } = req.query as Record<string, string>;
  const isManager = MANAGER_ROLES.includes(req.user!.role as any);
  // Non-managers can only ever see their own orders — a userId query param
  // from anyone else is ignored, not trusted.
  const userId = isManager ? (req.query.userId as string | undefined) : req.user!.userId;
  const page = Math.max(1, Number(pg) || 1);
  const limit = Math.min(80, Number(lim) || 12);
  const where: string[] = []; const params: unknown[] = [];
  if (userId) { params.push(userId); where.push(`user_id = $${params.length}`); }
  if (status) { params.push(status); where.push(`status = $${params.length}`); }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const { rows: countRows } = await pool!.query(`SELECT COUNT(*)::int AS total FROM mkt_orders ${whereSql}`, params);
  const { rows } = await pool!.query(
    `SELECT * FROM mkt_orders ${whereSql} ORDER BY placed_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, (page - 1) * limit]
  );
  res.json({ success: true, data: rows.map(mapOrder), meta: { page, limit, total: countRows[0].total, pages: Math.ceil(countRows[0].total / limit) } });
});

router.get("/orders/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { rows } = await pool!.query(`SELECT * FROM mkt_orders WHERE id::text = $1 OR order_number = $1`, [req.params.id]);
  if (!rows.length) { res.status(404).json({ success: false, error: "Order not found" }); return; }
  const order = rows[0];
  const isManager = MANAGER_ROLES.includes(req.user!.role as any);
  if (!isManager && order.user_id !== req.user!.userId) {
    res.status(403).json({ success: false, error: "You can only view your own orders" });
    return;
  }
  res.json({ success: true, data: mapOrder(order) });
});

// Line-level (or, with no productId, whole-order) refund. Attempts an
// automated refund against whichever processor actually handled the
// order's payment (via mkt_pay_transactions) — for the manual placeholder
// processor and for PayFast (no automated refund API wired up yet) this
// will come back unsuccessful, which is expected and non-fatal: the
// refund record is still created as 'pending' so admins can see it needs
// a manual bank transfer, and the order/settlement bookkeeping updates
// regardless of whether the processor-side refund itself succeeded.
router.post("/admin/orders/:id/refund", requireAuth, requireRole(...MANAGER_ROLES), async (req: Request, res: Response): Promise<void> => {
  const { productId, quantity, reason } = req.body;
  const { rows: orderRows } = await pool!.query(`SELECT * FROM mkt_orders WHERE id::text = $1 OR order_number = $1`, [req.params.id]);
  if (!orderRows.length) { res.status(404).json({ success: false, error: "Order not found" }); return; }
  const order = orderRows[0];

  let amount: number;
  let refundQuantity: number | null = null;
  if (productId) {
    const items = (order.items as any[]) ?? [];
    const item = items.find(i => i.productId === productId);
    if (!item) { res.status(404).json({ success: false, error: "That product isn't part of this order" }); return; }
    const qtyToRefund: number = quantity ? Math.min(Number(quantity), item.quantity) : item.quantity;
    refundQuantity = qtyToRefund;
    amount = +(Number(item.unitPrice) * qtyToRefund).toFixed(2);
  } else {
    amount = Number(order.total_amount) - Number(order.refunded_amount ?? 0);
  }
  if (amount <= 0) { res.status(400).json({ success: false, error: "Nothing left to refund on this order/item." }); return; }
  if (Number(order.refunded_amount ?? 0) + amount > Number(order.total_amount) + 0.01) {
    res.status(400).json({ success: false, error: "This refund would exceed the order's total — check what's already been refunded." });
    return;
  }

  const client = await pool!.connect();
  try {
    await client.query("BEGIN");

    // Best-effort processor-side refund — see function comment above for
    // why a failure here doesn't abort the whole operation.
    const { rows: txRows } = await client.query(
      `SELECT processor, processor_ref FROM mkt_pay_transactions WHERE order_id = $1 AND status = 'confirmed' ORDER BY created_at DESC LIMIT 1`,
      [order.id]
    );
    let processorRefundStatus: "pending" | "processed" | "failed" = "pending";
    let processorRefundRef: string | null = null;
    if (txRows.length) {
      const pr = await refundOrder(txRows[0].processor, txRows[0].processor_ref, amount);
      processorRefundStatus = pr.success ? "processed" : "pending"; // "pending" (not "failed") since it just means: not automated, still needs a manual transfer
      processorRefundRef = pr.refundRef ?? null;
    }

    const { rows: refundRows } = await client.query(
      `INSERT INTO mkt_order_refunds (order_id, product_id, quantity, amount, reason, status, processor_ref, initiated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [order.id, productId ?? null, refundQuantity, amount, reason ?? null, processorRefundStatus, processorRefundRef, req.user!.userId]
    );

    const newRefundedTotal = +(Number(order.refunded_amount ?? 0) + amount).toFixed(2);
    const fullyRefunded = newRefundedTotal >= Number(order.total_amount) - 0.01;
    await client.query(
      `UPDATE mkt_orders SET refunded_amount = $1, status = $2, payment_status = $3 WHERE id = $4`,
      [newRefundedTotal, fullyRefunded ? "refunded" : "partially_refunded", fullyRefunded ? "refunded" : order.payment_status, order.id]
    );

    // A refunded line can't still be owed to the seller/supplier — flag
    // its settlement so a payout isn't issued (or, if one already went
    // out before the refund, so it's visibly flagged for manual chase-back
    // rather than silently looking like a normal pending/paid line).
    if (productId) {
      await client.query(
        `UPDATE mkt_order_line_settlements SET seller_payout_status = 'refunded',
           supplier_payout_status = CASE WHEN supplier_payout_status != 'n/a' THEN 'refunded' ELSE supplier_payout_status END
         WHERE order_id = $1 AND product_id = $2`,
        [order.id, productId]
      );
    } else {
      await client.query(
        `UPDATE mkt_order_line_settlements SET seller_payout_status = 'refunded',
           supplier_payout_status = CASE WHEN supplier_payout_status != 'n/a' THEN 'refunded' ELSE supplier_payout_status END
         WHERE order_id = $1`,
        [order.id]
      );
    }

    await client.query("COMMIT");
    res.status(201).json({
      success: true, data: mapOrderRefund(refundRows[0]),
      message: processorRefundStatus === "processed" ? "Refunded automatically through the payment processor." : "Refund recorded — process the actual transfer through your payment processor's dashboard, since it isn't automated for this method yet.",
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[marketplace] Refund failed:", err);
    res.status(500).json({ success: false, error: "Could not process this refund, please try again." });
  } finally {
    client.release();
  }
});

router.get("/admin/orders/:id/refunds", requireAuth, requireRole(...MANAGER_ROLES), async (req: Request, res: Response): Promise<void> => {
  const { rows } = await pool!.query(
    `SELECT r.*, o.order_number, p.name AS product_name FROM mkt_order_refunds r
     JOIN mkt_orders o ON o.id = r.order_id LEFT JOIN mkt_products p ON p.id = r.product_id
     WHERE r.order_id::text = $1 OR o.order_number = $1 ORDER BY r.created_at DESC`,
    [req.params.id]
  );
  res.json({ success: true, data: rows.map(mapOrderRefund) });
});

const CANCELLABLE_STATUSES = ["pending", "confirmed", "processing"];

router.post("/orders/:id/cancel", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const isManager = MANAGER_ROLES.includes(req.user!.role as any);
  const client = await pool!.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(`SELECT * FROM mkt_orders WHERE id::text = $1 FOR UPDATE`, [req.params.id]);
    if (!rows.length) { await client.query("ROLLBACK"); res.status(404).json({ success: false, error: "Order not found" }); return; }
    const order = rows[0];
    if (!isManager && order.user_id !== req.user!.userId) { await client.query("ROLLBACK"); res.status(403).json({ success: false, error: "You can only cancel your own orders" }); return; }
    if (!CANCELLABLE_STATUSES.includes(order.status)) {
      await client.query("ROLLBACK");
      res.status(400).json({ success: false, error: `Orders that are already ${order.status} can't be cancelled.` });
      return;
    }
    // Restock every item so cancelling doesn't leave inventory short.
    for (const item of order.items as any[]) {
      await client.query(`UPDATE mkt_products SET stock = stock + $1, total_sold = GREATEST(0, total_sold - $1) WHERE id::text = $2`, [item.quantity, item.productId]);
    }
    const { rows: updated } = await client.query(`UPDATE mkt_orders SET status = 'cancelled', cancelled_at = now() WHERE id = $1 RETURNING *`, [order.id]);
    await client.query("COMMIT");
    res.json({ success: true, data: mapOrder(updated[0]) });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[marketplace] Order cancel failed:", err);
    res.status(500).json({ success: false, error: "Could not cancel order, please try again." });
  } finally {
    client.release();
  }
});

router.post("/orders/:id/request-return", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { rows } = await pool!.query(`SELECT * FROM mkt_orders WHERE id::text = $1`, [req.params.id]);
  if (!rows.length) { res.status(404).json({ success: false, error: "Order not found" }); return; }
  const order = rows[0];
  if (order.user_id !== req.user!.userId) { res.status(403).json({ success: false, error: "You can only request returns on your own orders" }); return; }
  if (order.status !== "delivered") { res.status(400).json({ success: false, error: "Only delivered orders are eligible for a return." }); return; }
  const { rows: updated } = await pool!.query(
    `UPDATE mkt_orders SET status = 'return_requested', notes = COALESCE(notes || E'\\n', '') || $1 WHERE id = $2 RETURNING *`,
    [`Return requested: ${req.body.reason ?? "No reason given"}`, order.id]
  );
  res.json({ success: true, data: mapOrder(updated[0]) });
});

router.post("/orders", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.userId; // always the signed-in customer, never trusted from the body
  const { addressId, paymentMethod } = req.body;
  const [{ rows: cartRows }, { rows: userRows }] = await Promise.all([
    pool!.query(`SELECT * FROM mkt_carts WHERE user_id = $1`, [userId]),
    pool!.query(`SELECT email FROM users WHERE id = $1`, [userId]),
  ]);
  const cart = cartRows[0];
  if (!cart || !cart.items.length) { res.status(400).json({ success: false, error: "Cart is empty" }); return; }
  const customerEmail = userRows[0]?.email ?? "customer@example.com";

  const { rows: addrRows } = await pool!.query(
    addressId ? `SELECT * FROM mkt_addresses WHERE id::text = $1 AND user_id = $2` : `SELECT * FROM mkt_addresses WHERE user_id = $1 LIMIT 1`,
    addressId ? [addressId, userId] : [userId]
  );
  const addr = addrRows[0] ?? {};

  const items = cart.items.map((i: any) => ({
    productId: i.productId, productName: i.name, emoji: i.emoji, variantId: i.variantId, variantLabel: null,
    quantity: i.quantity, unitPrice: i.unitPrice, totalPrice: i.unitPrice * i.quantity, sellerId: i.sellerId ?? "sel-01", sellerName: i.sellerName,
  }));
  const shippingAddress = {
    label: "Home", firstName: addr.first_name ?? "Customer", lastName: addr.last_name ?? "", line1: addr.line1 ?? "",
    line2: null, city: addr.city ?? "", state: addr.state ?? "", postalCode: addr.postal_code ?? "", country: addr.country ?? "ZA", phone: addr.phone ?? "",
  };

  const client = await pool!.connect();
  try {
    await client.query("BEGIN");

    // Lock and validate stock for every item before committing to the order —
    // FOR UPDATE prevents two simultaneous checkouts from both succeeding on
    // the last unit of the same product.
    for (const item of items) {
      const { rows: stockRows } = await client.query(`SELECT stock, name FROM mkt_products WHERE id::text = $1 FOR UPDATE`, [item.productId]);
      if (!stockRows.length) { throw { code: "OUT_OF_STOCK", message: `${item.productName} is no longer available.` }; }
      if (stockRows[0].stock < item.quantity) {
        throw { code: "OUT_OF_STOCK", message: `Only ${stockRows[0].stock} of "${stockRows[0].name}" left in stock — reduce the quantity in your cart.` };
      }
    }
    for (const item of items) {
      await client.query(`UPDATE mkt_products SET stock = stock - $1, total_sold = total_sold + $1 WHERE id::text = $2`, [item.quantity, item.productId]);
    }

    const { rows: countRows } = await client.query(`SELECT COUNT(*)::int AS n FROM mkt_orders`);
    const orderNumber = `VNK-ORD-${String(100000 + countRows[0].n).padStart(6, "0")}`;

    // Look up each item's fulfilment type once, up front — used both to
    // pick a realistic delivery estimate (local-only orders ship in days;
    // an order with any supplier-sourced line needs the supplier's lead
    // time plus international shipping/customs, not the same 5-day promise)
    // and, further down, to open the two-leg supplier-order records.
    const itemFulfillment = new Map<string, { fulfillmentType: string; supplierProductId: string | null; supplierId: string | null; costPrice: number | null; originCountry: string | null; leadTimeDays: number | null; categoryId: string | null; vehicleDetails: any; condition: string | null; nrcsApproved: boolean; costCurrency: string | null; commissionPct: number }>();
    let maxLeadTimeDays = 0;
    for (const item of items) {
      const { rows: prodRows } = await client.query(
        `SELECT p.fulfillment_type, p.supplier_product_id, p.category_id, p.vehicle_details, p.condition, p.nrcs_approved, sp.supplier_id, sp.cost_price, sp.currency AS cost_currency, sp.origin_country, sup.lead_time_days, s.commission_pct
         FROM mkt_products p
         LEFT JOIN mkt_supplier_products sp ON sp.id = p.supplier_product_id
         LEFT JOIN mkt_suppliers sup ON sup.id = sp.supplier_id
         JOIN mkt_sellers s ON s.id = p.seller_id
         WHERE p.id::text = $1`, [item.productId]
      );
      const p = prodRows[0];
      itemFulfillment.set(item.productId, {
        fulfillmentType: p?.fulfillment_type ?? "local", supplierProductId: p?.supplier_product_id ?? null,
        supplierId: p?.supplier_id ?? null, costPrice: p?.cost_price ?? null, costCurrency: p?.cost_currency ?? null, originCountry: p?.origin_country ?? null,
        leadTimeDays: p?.lead_time_days ?? null, categoryId: p?.category_id ?? null,
        vehicleDetails: p?.vehicle_details ?? null, condition: p?.condition ?? null, nrcsApproved: p?.nrcs_approved ?? false,
        commissionPct: p?.commission_pct !== undefined && p?.commission_pct !== null ? Number(p.commission_pct) : 8,
      });
      if (p?.fulfillment_type === "imported" && p?.lead_time_days) maxLeadTimeDays = Math.max(maxLeadTimeDays, Number(p.lead_time_days));

      // Vehicle compliance — checked against THIS order's actual delivery
      // country, since the same listing can be legal for one country and
      // not another (Zambia allows used-vehicle imports; South Africa's
      // ITAC does not, for commercial resale). Applies regardless of new/
      // used: South Africa also requires an NRCS Letter of Authority
      // (type-approval) on every vehicle, new or used, before it can be
      // delivered there.
      if (p?.category_id === "cat-07" && shippingAddress.country === "ZA") {
        if (p.condition === "used") {
          throw { code: "VEHICLE_COMPLIANCE", message: `"${item.productName}" can't be delivered to a South African address — South Africa (ITAC) restricts commercial resale of used vehicles to narrow personal exemptions only. This vehicle can still be ordered for delivery to Zambia.` };
        }
        if (!p.nrcs_approved) {
          throw { code: "VEHICLE_COMPLIANCE", message: `"${item.productName}" doesn't yet have NRCS type-approval on file, which South Africa requires for every imported vehicle before it can be delivered. Contact support once approval is obtained.` };
        }
      }
    }
    // 12-day buffer covers origin-hub QC + consolidated freight + customs +
    // last-mile once it lands — matches the 10-30 day range international
    // dropship realistically takes. Local-only orders keep the original
    // 5-day promise.
    const estimatedDeliveryDays = maxLeadTimeDays > 0 ? maxLeadTimeDays + 12 : 5;

    // VAT is domestic sales tax charged to the customer on every order
    // regardless of fulfilment type — the cart's running total only ever
    // assumed a flat 15% (SA) since it's built before an address is
    // necessarily chosen. Now that we have the real shipping country,
    // recompute it properly (SA 15%, ZM 16%, ...) rather than trust the
    // cart's estimate for money that actually gets charged and remitted.
    const { rows: taxRateRows } = await client.query(`SELECT * FROM mkt_tax_rates WHERE country = $1`, [shippingAddress.country]);
    const vatRatePct = taxRateRows.length ? Number(taxRateRows[0].vat_rate_pct) : 15;
    const defaultDutyRatePct = taxRateRows.length ? Number(taxRateRows[0].default_duty_rate_pct) : 20;
    const { rows: dutyRateRows } = await client.query(`SELECT category_id, duty_rate_pct FROM mkt_duty_rates WHERE country = $1`, [shippingAddress.country]);
    const dutyRateByCategory = new Map(dutyRateRows.map((r: any) => [r.category_id, Number(r.duty_rate_pct)]));
    // Fetched once, reused for both the duty calculation below (a
    // supplier's cost, and Zambia's flat vehicle duty, are both quoted in
    // a foreign currency and need converting to ZAR before they mean
    // anything alongside the rest of this order) and the settlement
    // calculation further down.
    const { rows: fxRows } = await client.query(`SELECT * FROM mkt_fx_rates`);
    const fxByCurrency = new Map(fxRows.map((r: any) => [r.currency, Number(r.rate_to_zar)]));
    // Zambia taxes used vehicles 2+ years old on ZRA's flat specific-duty
    // schedule (kwacha, by body type/engine size/age band) instead of a
    // percentage of value — a fundamentally different mechanism from
    // mkt_duty_rates, looked up separately only when relevant.
    const { rows: vehicleDutyZmRows } = shippingAddress.country === "ZM"
      ? await client.query(`SELECT * FROM mkt_vehicle_duty_zm`)
      : { rows: [] as any[] };

    const taxAmount = +(cart.subtotal * vatRatePct / 100).toFixed(2);
    // Import duty is never charged to the customer directly — it's a cost
    // Ballylife carries and settles at the border (see mkt_customs_records
    // once the shipment is batched). Computed here on the supplier cost
    // value (the actual CIF-ish base customs assesses against), converted
    // to ZAR via mkt_fx_rates so it's actually comparable to the rest of
    // this order's figures — purely so an order's full landed-cost
    // picture is visible to admins reconciling against what's later
    // declared.
    let dutyAmount = 0;
    for (const item of items) {
      const f = itemFulfillment.get(item.productId);
      if (!f?.fulfillmentType || f.fulfillmentType !== "imported" || !f.costPrice) continue;

      if (f.categoryId === "cat-07" && shippingAddress.country === "ZM" && f.vehicleDetails) {
        // ZRA specific duty only applies to vehicles 2+ years old; under 2
        // and all hybrids/EVs fall through to the ordinary percentage
        // method below (ZRA's own ad valorem rule for those categories).
        const vd = f.vehicleDetails;
        const ageYears = new Date().getFullYear() - Number(vd.year ?? new Date().getFullYear());
        const ageBand = ageYears >= 5 ? "5_plus" : ageYears >= 2 ? "2_to_5" : null;
        const match = ageBand && vd.fuelType !== "hybrid" && vd.fuelType !== "electric"
          ? vehicleDutyZmRows.find((r: any) => r.body_type === vd.bodyType && r.age_band === ageBand && Number(vd.engineCc) >= r.engine_cc_min && (r.engine_cc_max === null || Number(vd.engineCc) <= r.engine_cc_max))
          : null;
        if (match) {
          // ZRA's schedule is in Zambian Kwacha — converted to ZAR here
          // via mkt_fx_rates (currency "ZMW") rather than added raw, so
          // this stays comparable to the rest of the order. If no ZMW
          // rate is on file yet, the kwacha figure is skipped entirely
          // (flagged via console) rather than silently added unconverted.
          const zmwRate = fxByCurrency.get("ZMW");
          if (zmwRate) {
            dutyAmount += (Number(match.duty_kwacha) + Number(match.carbon_surtax_kwacha)) * item.quantity * zmwRate;
          } else {
            console.error(`[orders] No ZMW FX rate on file — Zambia vehicle duty for order ${orderNumber} item ${item.productId} was skipped, not silently added unconverted. Add a ZMW rate under Payouts > Manage FX rates.`);
          }
          continue;
        }
      }

      const rate = f.categoryId ? (dutyRateByCategory.get(f.categoryId) ?? defaultDutyRatePct) : defaultDutyRatePct;
      const costRate = f.costCurrency ? fxByCurrency.get(f.costCurrency) : undefined;
      if (costRate) {
        dutyAmount += Number(f.costPrice) * costRate * item.quantity * (rate / 100);
      } else {
        console.error(`[orders] No FX rate on file for ${f.costCurrency} — duty for order ${orderNumber} item ${item.productId} was skipped, not silently computed in the wrong currency. Add a rate under Payouts > Manage FX rates.`);
      }
    }
    dutyAmount = +dutyAmount.toFixed(2);
    const totalAmount = +(cart.subtotal + cart.shipping + taxAmount - cart.coupon_discount).toFixed(2);

    const { rows } = await client.query(
      `INSERT INTO mkt_orders (order_number, user_id, customer_name, customer_email, items, subtotal, shipping_cost,
         tax_amount, duty_amount, discount_amount, total_amount, currency, status, payment_status, payment_method, shipping_address,
         shipping_status, estimated_delivery, coupon_code, confirmed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'ZAR','pending','pending_payment',$12,$13,'not_shipped', now() + ($15 || ' days')::interval, $14, NULL)
       RETURNING *`,
      [orderNumber, userId, `${shippingAddress.firstName} ${shippingAddress.lastName}`, customerEmail,
       JSON.stringify(items), cart.subtotal, cart.shipping, taxAmount, dutyAmount, cart.coupon_discount, totalAmount,
       paymentMethod ?? "card", JSON.stringify(shippingAddress), cart.coupon_code, estimatedDeliveryDays]
    );
    const order = rows[0];

    // For every line that's an imported (supplier-sourced) listing, open a
    // mkt_supplier_orders row that starts the two-leg fulfilment pipeline —
    // local-seller lines (fulfillment_type='local') need no such record,
    // the seller ships those themselves via the existing shipping_status
    // on mkt_orders. Destination warehouse is picked by the customer's
    // country (ZA/ZM); origin by the supplier's country (CN/JP/KR).
    const destinationWarehouseId = DESTINATION_WAREHOUSE_BY_COUNTRY[shippingAddress.country] ?? "wh-dest-za";
    for (const item of items) {
      const p = itemFulfillment.get(item.productId);
      if (!p || p.fulfillmentType !== "imported" || !p.supplierProductId) continue;
      const originWarehouseId = ORIGIN_WAREHOUSE_BY_SUPPLIER_COUNTRY[p.originCountry ?? ""] ?? "wh-origin-cn";
      await client.query(
        `INSERT INTO mkt_supplier_orders (order_id, product_id, supplier_id, supplier_product_id, seller_id, quantity,
           cost_amount, origin_warehouse_id, destination_warehouse_id, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'ordered_from_supplier')`,
        [order.id, item.productId, p.supplierId, p.supplierProductId, item.sellerId, item.quantity,
         Number(p.costPrice) * item.quantity, originWarehouseId, destinationWarehouseId]
      );
    }

    // Settlement — the four-way split: platform fee (seller's commission
    // rate, already existed but was display-only until now), what the
    // supplier is owed (imported lines only, converted to ZAR via
    // mkt_fx_rates, fetched earlier alongside the duty calculation), and
    // what's left for the seller. Tax/duty are already tracked separately
    // on the order and in mkt_customs_records — this is purely the payout
    // side. One row per line, since a single order can span multiple
    // sellers and suppliers.
    for (const item of items) {
      const f = itemFulfillment.get(item.productId);
      if (!f) continue;
      const grossAmount = Number(item.unitPrice) * item.quantity;
      const platformFeePct = f.commissionPct;
      const platformFeeAmount = +(grossAmount * platformFeePct / 100).toFixed(2);
      let supplierCostAmount: number | null = null, supplierCostCurrency: string | null = null, supplierCostAmountZar: number | null = null;
      if (f.fulfillmentType === "imported" && f.costPrice) {
        supplierCostAmount = +(Number(f.costPrice) * item.quantity).toFixed(2);
        supplierCostCurrency = f.costCurrency;
        const rate = f.costCurrency ? fxByCurrency.get(f.costCurrency) : undefined;
        supplierCostAmountZar = rate ? +(supplierCostAmount * rate).toFixed(2) : null; // null if no FX rate on file yet — flagged for admin, not silently assumed
      }
      const sellerPayoutAmount = +(grossAmount - platformFeeAmount - (supplierCostAmountZar ?? 0)).toFixed(2);
      await client.query(
        `INSERT INTO mkt_order_line_settlements (order_id, product_id, seller_id, supplier_id, quantity, gross_amount,
           platform_fee_pct, platform_fee_amount, supplier_cost_amount, supplier_cost_currency, supplier_cost_amount_zar,
           seller_payout_amount, supplier_payout_status, seller_payout_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'pending')`,
        [order.id, item.productId, item.sellerId, f.supplierId, item.quantity, grossAmount,
         platformFeePct, platformFeeAmount, supplierCostAmount, supplierCostCurrency, supplierCostAmountZar,
         sellerPayoutAmount, f.fulfillmentType === "imported" ? "pending" : "n/a"]
      );
    }

    await client.query(`UPDATE mkt_carts SET items = '[]', coupon_code = NULL, coupon_discount = 0, subtotal = 0, shipping = 0, tax = 0, total = 0, updated_at = now() WHERE id = $1`, [cart.id]);
    await client.query("COMMIT");

    // Deliberately fire-and-forget, same discipline as the application risk
    // check in applicationsRouter.ts -- advisory only (Section 5.1.4: flags,
    // never blocks), so a failure here must never delay order confirmation
    // or the payment submission call right below it.
    checkPaymentVelocity(order.id, userId).catch(err => console.error("[fraud-risk] Payment velocity check failed:", err));

    // Best-effort — an email failure should never fail the order itself.
    // Logs the email instead of sending if SMTP isn't configured yet
    // (see emailService.ts).
    sendOrderConfirmationEmail(customerEmail, order.order_number, Number(order.total_amount), order.currency)
      .catch(err => console.error("[email] Order confirmation failed:", err));

    // Submit the charge *after* releasing the stock locks — a payment
    // gateway call is a network round trip and shouldn't hold a
    // transaction (and the FOR UPDATE locks from the stock check above)
    // open while it waits on an external service.
    //
    // This is a SUBMISSION, not a confirmation. success:true here means
    // "the processor accepted this for processing" — the order stays in
    // pending_payment either way. The only things that can move it to
    // payment_confirmed are a verified webhook handler (once a real
    // processor is wired into mktPay.ts) or a reconciliation job actively
    // querying the processor after a timeout. Never this endpoint.
    const submission = await submitOrderPayment({
      orderId: order.id,
      orderNumber: order.order_number,
      amount: Number(order.total_amount),
      currency: order.currency,
      paymentMethod: (paymentMethod === "bank_transfer" ? "bank_transfer" : "card"),
      customerEmail,
      paymentDetails: req.body.paymentDetails,
    });

    if (submission.accepted) {
      // 202 Accepted, not 201 Created-and-done — the order exists, but
      // payment is still in flight. The frontend should poll
      // GET /orders/:id to see the real, confirmed status.
      res.status(202).json({
        success: true,
        data: mapOrder(order),
        meta: { paymentStatus: "pending_payment", mktPayTransactionId: submission.mktPayTransactionId, redirect: submission.redirect },
      });
      return;
    }

    // The processor rejected the submission outright (not "still
    // processing" — an actual immediate failure, e.g. not configured or a
    // hard decline). Restock immediately rather than waiting on a webhook
    // that will never come for a submission that was never accepted.
    const restockClient = await pool!.connect();
    try {
      await restockClient.query("BEGIN");
      for (const item of items) {
        await restockClient.query(`UPDATE mkt_products SET stock = stock + $1, total_sold = GREATEST(0, total_sold - $1) WHERE id::text = $2`, [item.quantity, item.productId]);
      }
      await restockClient.query(`UPDATE mkt_orders SET status = 'payment_failed', payment_status = 'payment_failed' WHERE id = $1`, [order.id]);
      await restockClient.query("COMMIT");
    } catch (restockErr) {
      await restockClient.query("ROLLBACK");
      console.error("[marketplace] Restock after failed payment submission also failed:", restockErr);
    } finally {
      restockClient.release();
    }

    res.status(402).json({ success: false, error: submission.error ?? "Payment could not be submitted.", data: { orderId: order.id, orderNumber: order.order_number } });
    return;
  } catch (err: any) {
    await client.query("ROLLBACK");
    if (err?.code === "OUT_OF_STOCK") { res.status(409).json({ success: false, error: err.message }); return; }
    if (err?.code === "VEHICLE_COMPLIANCE") { res.status(409).json({ success: false, error: err.message }); return; }
    console.error("[marketplace] Order placement failed:", err);
    res.status(500).json({ success: false, error: "Could not place order, please try again." });
    return;
  } finally {
    client.release();
  }
});

// GET /orders/:id/transactions — mktPay's ledger for this order: every
// charge attempt, which processor handled it, and the outcome. Real audit
// trail, not just the current payment_status snapshot on the order itself.
router.get("/orders/:id/transactions", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { rows } = await pool!.query(`SELECT user_id FROM mkt_orders WHERE id::text = $1`, [req.params.id]);
  if (!rows.length) { res.status(404).json({ success: false, error: "Order not found" }); return; }
  const isManager = MANAGER_ROLES.includes(req.user!.role as any);
  if (!isManager && rows[0].user_id !== req.user!.userId) { res.status(403).json({ success: false, error: "You can only view your own order's transactions" }); return; }

  const transactions = await getOrderTransactions(req.params.id);
  res.json({ success: true, data: transactions });
});

// ── REVIEWS ───────────────────────────────────────────────────────────────────
router.get("/products/:id/reviews", async (req: Request, res: Response): Promise<void> => {
  const { rows } = await pool!.query(`SELECT * FROM mkt_reviews WHERE product_id = $1 AND status = 'approved' ORDER BY created_at DESC`, [req.params.id]);
  const avg = rows.length ? +(rows.reduce((s, r) => s + r.rating, 0) / rows.length).toFixed(1) : 0;
  const dist = [5, 4, 3, 2, 1].map(stars => ({ stars, count: rows.filter(r => r.rating === stars).length }));
  res.json({ success: true, data: rows.map(mapReview), meta: { total: rows.length, avg, distribution: dist } });
});

router.post("/products/:id/reviews", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { userId, orderId, rating, title, body } = req.body;
  if (!rating || rating < 1 || rating > 5) { res.status(400).json({ success: false, error: "rating must be 1-5" }); return; }
  const { rows } = await pool!.query(
    `INSERT INTO mkt_reviews (product_id, user_id, order_id, rating, title, body, verified_purchase, status)
     VALUES ($1,$2,$3,$4,$5,$6,true,'approved') RETURNING *`,
    [req.params.id, userId, orderId, rating, title, body]
  );
  res.status(201).json({ success: true, data: mapReview(rows[0]) });
});

// ── WISHLIST ──────────────────────────────────────────────────────────────────
router.get("/wishlist/:userId", requireAuth, requireSelf, async (req: Request, res: Response): Promise<void> => {
  const { rows } = await pool!.query(
    `SELECT p.*, s.store_name AS seller_name, c.name AS category_name FROM mkt_wishlist_items w
     JOIN mkt_products p ON p.id = w.product_id JOIN mkt_sellers s ON s.id = p.seller_id
     JOIN mkt_categories c ON c.id = p.category_id WHERE w.user_id = $1`, [req.params.userId]
  );
  res.json({ success: true, data: rows.map(r => mapProduct(r)), meta: { total: rows.length } });
});

router.post("/wishlist/:userId", requireAuth, requireSelf, async (req: Request, res: Response): Promise<void> => {
  const { rows } = await pool!.query(`SELECT 1 FROM mkt_wishlist_items WHERE user_id = $1 AND product_id = $2`, [req.params.userId, req.body.productId]);
  const exists = rows.length > 0;
  if (!exists) await pool!.query(`INSERT INTO mkt_wishlist_items (user_id, product_id) VALUES ($1,$2)`, [req.params.userId, req.body.productId]);
  res.json({ success: true, message: exists ? "Already in wishlist" : "Added to wishlist" });
});

router.delete("/wishlist/:userId/:productId", requireAuth, requireSelf, async (req: Request, res: Response): Promise<void> => {
  await pool!.query(`DELETE FROM mkt_wishlist_items WHERE user_id = $1 AND product_id = $2`, [req.params.userId, req.params.productId]);
  res.json({ success: true });
});

// ── SELLERS ───────────────────────────────────────────────────────────────────
router.get("/sellers", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { status } = req.query as Record<string, string>;
  const { rows } = await pool!.query(status ? `SELECT * FROM mkt_sellers WHERE status = $1` : `SELECT * FROM mkt_sellers`, status ? [status] : []);
  res.json({ success: true, data: rows.map(mapSeller), meta: { total: rows.length } });
});

// Looks up the seller record owned by a given user — needed on a plain
// login (as opposed to right after registration, where the frontend
// already has the fresh seller object in hand) so the app knows which
// store this account owns. Self-lookup only, or a manager checking on
// someone's behalf.
router.get("/sellers/by-user/:userId", requireAuth, async (req: Request, res: Response): Promise<void> => {
  if (req.user!.userId !== req.params.userId && !MANAGER_ROLES.includes(req.user!.role as any)) {
    res.status(403).json({ success: false, error: "Forbidden" }); return;
  }
  const { rows } = await pool!.query(`SELECT * FROM mkt_sellers WHERE user_id = $1`, [req.params.userId]);
  if (!rows.length) { res.status(404).json({ success: false, error: "No seller store linked to this account" }); return; }
  res.json({ success: true, data: mapSeller(rows[0]) });
});

router.get("/sellers/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { rows } = await pool!.query(`SELECT * FROM mkt_sellers WHERE id = $1`, [req.params.id]);
  if (!rows.length) { res.status(404).json({ success: false, error: "Seller not found" }); return; }
  const { rows: productRows } = await pool!.query(`SELECT p.*, s.store_name AS seller_name, c.name AS category_name FROM mkt_products p JOIN mkt_sellers s ON s.id=p.seller_id JOIN mkt_categories c ON c.id=p.category_id WHERE p.seller_id = $1`, [req.params.id]);
  const { rows: orderCountRows } = await pool!.query(`SELECT COUNT(*)::int AS n FROM mkt_orders WHERE items::text LIKE $1`, [`%"sellerId":"${req.params.id}"%`]);
  res.json({ success: true, data: { seller: mapSeller(rows[0]), products: productRows.map(r => mapProduct(r)), orderCount: orderCountRows[0].n } });
});

router.get("/sellers/:id/analytics", requireAuth, requireSellerOwner, async (req: Request, res: Response): Promise<void> => {
  const { rows } = await pool!.query(`SELECT * FROM mkt_sellers WHERE id = $1`, [req.params.id]);
  if (!rows.length) { res.status(404).json({ success: false, error: "Seller not found" }); return; }
  const { rows: productRows } = await pool!.query(`SELECT p.*, s.store_name AS seller_name, c.name AS category_name FROM mkt_products p JOIN mkt_sellers s ON s.id=p.seller_id JOIN mkt_categories c ON c.id=p.category_id WHERE p.seller_id = $1`, [req.params.id]);
  const revenue = Array.from({ length: 7 }, (_, i) => ({
    day: new Date(Date.now() - (6 - i) * 86400000).toLocaleDateString("en", { weekday: "short" }),
    revenue: Math.floor(Math.random() * 20000 + 5000), orders: Math.floor(Math.random() * 20 + 5),
  }));
  const products = productRows.map(r => mapProduct(r));
  res.json({ success: true, data: { seller: mapSeller(rows[0]), products, revenue, topProducts: products.slice(0, 3).map(p => ({ id: p.id, name: p.name, emoji: p.emoji, sold: p.totalSold, revenue: p.totalSold * p.price })) } });
});

router.patch("/sellers/:id", requireAuth, requireSellerOwner, async (req: Request, res: Response): Promise<void> => {
  const { storeName, description, logoUrl, bannerUrl, phone } = req.body;
  const sets: string[] = []; const vals: unknown[] = [];
  const push = (col: string, val: unknown) => { if (val !== undefined) { vals.push(val); sets.push(`${col} = $${vals.length}`); } };
  push("store_name", storeName); push("description", description); push("logo_url", logoUrl); push("banner_url", bannerUrl); push("phone", phone);
  if (!sets.length) { res.status(400).json({ success: false, error: "No fields to update" }); return; }
  vals.push(req.params.id);
  const { rows } = await pool!.query(`UPDATE mkt_sellers SET ${sets.join(", ")} WHERE id = $${vals.length} RETURNING *`, vals);
  if (!rows.length) { res.status(404).json({ success: false, error: "Seller not found" }); return; }
  res.json({ success: true, data: mapSeller(rows[0]) });
});

// ── ADMIN ─────────────────────────────────────────────────────────────────────
router.get("/admin/stats", requireAuth, requireRole(...MANAGER_ROLES), async (_req: Request, res: Response): Promise<void> => {
  const [{ rows: p }, { rows: s }, { rows: o }, { rows: rev }, { rows: pr }, { rows: ps }] = await Promise.all([
    pool!.query(`SELECT COUNT(*)::int AS n FROM mkt_products`),
    pool!.query(`SELECT COUNT(*)::int AS n FROM mkt_sellers`),
    pool!.query(`SELECT COUNT(*)::int AS n FROM mkt_orders`),
    pool!.query(`SELECT COALESCE(SUM(total_amount),0)::float AS n FROM mkt_orders`),
    pool!.query(`SELECT COUNT(*)::int AS n FROM mkt_reviews WHERE status = 'pending'`),
    pool!.query(`SELECT COUNT(*)::int AS n FROM mkt_sellers WHERE status = 'pending_kyc'`),
  ]);
  const { rows: cats } = await pool!.query(`SELECT c.name, COUNT(p.id)::int AS count FROM mkt_categories c LEFT JOIN mkt_products p ON p.category_id = c.id GROUP BY c.name ORDER BY count DESC LIMIT 5`);
  res.json({ success: true, data: {
    totalProducts: p[0].n, totalSellers: s[0].n, totalOrders: o[0].n, totalRevenue: rev[0].n,
    activeCustomers: 0, pendingReviews: pr[0].n, pendingSellerApprovals: ps[0].n, topCategories: cats,
  }});
});

router.get("/admin/orders", requireAuth, requireRole(...MANAGER_ROLES), async (req: Request, res: Response): Promise<void> => {
  const { status } = req.query as Record<string, string>;
  const { rows } = await pool!.query(status ? `SELECT * FROM mkt_orders WHERE status = $1 ORDER BY placed_at DESC` : `SELECT * FROM mkt_orders ORDER BY placed_at DESC`, status ? [status] : []);
  res.json({ success: true, data: rows.map(mapOrder), meta: { total: rows.length } });
});

router.patch("/admin/orders/:id/status", requireAuth, requireRole(...MANAGER_ROLES, "seller"), async (req: Request, res: Response): Promise<void> => {
  const isManager = MANAGER_ROLES.includes(req.user!.role as any);
  if (!isManager) {
    // Sellers may only advance orders that actually contain one of their own products.
    const { rows: sellerRows } = await pool!.query(`SELECT id FROM mkt_sellers WHERE user_id = $1`, [req.user!.userId]);
    const sellerId = sellerRows[0]?.id;
    const { rows: ownedOrder } = await pool!.query(
      `SELECT 1 FROM mkt_orders WHERE id::text = $1 AND items::text LIKE $2`, [req.params.id, `%"sellerId":"${sellerId}"%`]
    );
    if (!sellerId || !ownedOrder.length) { res.status(403).json({ success: false, error: "You can only update orders containing your own products" }); return; }
  }
  const { rows } = await pool!.query(
    `UPDATE mkt_orders SET status = $1, tracking_number = COALESCE($2, tracking_number) WHERE id::text = $3 RETURNING *`,
    [req.body.status, req.body.trackingNumber ?? null, req.params.id]
  );
  if (!rows.length) { res.status(404).json({ success: false, error: "Order not found" }); return; }
  res.json({ success: true, data: mapOrder(rows[0]) });
});

router.get("/admin/products/pending", requireAuth, requireRole(...MANAGER_ROLES), async (_req: Request, res: Response): Promise<void> => {
  const { rows } = await pool!.query(`SELECT p.*, s.store_name AS seller_name, c.name AS category_name FROM mkt_products p JOIN mkt_sellers s ON s.id=p.seller_id JOIN mkt_categories c ON c.id=p.category_id WHERE p.status = 'pending_review'`);
  res.json({ success: true, data: rows.map(r => mapProduct(r)), meta: { total: rows.length } });
});

router.patch("/admin/products/:id/approve", requireAuth, requireRole(...MANAGER_ROLES), async (req: Request, res: Response): Promise<void> => {
  const { rows } = await pool!.query(`UPDATE mkt_products SET status = 'active', updated_at = now() WHERE id::text = $1 RETURNING *`, [req.params.id]);
  if (!rows.length) { res.status(404).json({ success: false, error: "Product not found" }); return; }
  res.json({ success: true, data: mapProduct(rows[0]) });
});

// Full product browse for managers — search across every listing (any
// status, any seller) so price/discount can be set on something already
// live, not just items still pending first approval.
router.get("/admin/products", requireAuth, requireRole(...MANAGER_ROLES), async (req: Request, res: Response): Promise<void> => {
  const { search, fulfillmentType, page: pg, limit: lim } = req.query as Record<string, string>;
  const page = Math.max(1, Number(pg) || 1);
  const limit = Math.min(60, Number(lim) || 24);
  const where: string[] = []; const params: unknown[] = [];
  const p = (val: unknown) => { params.push(val); return `$${params.length}`; };
  if (search) where.push(`(LOWER(p.name) LIKE ${p(`%${search.toLowerCase()}%`)} OR LOWER(s.store_name) LIKE ${p(`%${search.toLowerCase()}%`)})`);
  if (fulfillmentType) where.push(`p.fulfillment_type = ${p(fulfillmentType)}`);
  const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const baseQuery = `FROM mkt_products p JOIN mkt_sellers s ON s.id = p.seller_id JOIN mkt_categories c ON c.id = p.category_id ${whereClause}`;
  const { rows: countRows } = await pool!.query(`SELECT COUNT(*)::int AS total ${baseQuery}`, params);
  const { rows } = await pool!.query(
    `SELECT p.*, s.store_name AS seller_name, c.name AS category_name ${baseQuery} ORDER BY p.updated_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, (page - 1) * limit]
  );
  res.json({ success: true, data: rows.map(r => mapProduct(r)), meta: { page, limit, total: countRows[0].total, pages: Math.ceil(countRows[0].total / limit) } });
});

// Dedicated manager price/discount edit — separate from the seller-facing
// PATCH /sellers/:id/products/:productId (which now rejects price changes
// from non-managers) so this doesn't need a sellerId in the URL at all.
router.patch("/admin/products/:id/price", requireAuth, requireRole(...MANAGER_ROLES), async (req: Request, res: Response): Promise<void> => {
  const { price, compareAtPrice } = req.body;
  if (price === undefined) { res.status(400).json({ success: false, error: "price is required" }); return; }
  const { rows } = await pool!.query(
    `UPDATE mkt_products SET price = $1, compare_at_price = $2, updated_at = now() WHERE id::text = $3 RETURNING *`,
    [price, compareAtPrice ?? null, req.params.id]
  );
  if (!rows.length) { res.status(404).json({ success: false, error: "Product not found" }); return; }
  res.json({ success: true, data: mapProduct(rows[0]) });
});

// ── ADDRESSES ─────────────────────────────────────────────────────────────────
router.get("/addresses/:userId", requireAuth, requireSelf, async (req: Request, res: Response): Promise<void> => {
  const { rows } = await pool!.query(`SELECT * FROM mkt_addresses WHERE user_id = $1`, [req.params.userId]);
  res.json({ success: true, data: rows.map(mapAddress) });
});

router.post("/addresses/:userId", requireAuth, requireSelf, async (req: Request, res: Response): Promise<void> => {
  const { label, firstName, lastName, line1, line2, city, state, postalCode, country, phone, isDefault } = req.body;
  if (!firstName || !lastName || !line1 || !city || !postalCode || !phone) {
    res.status(400).json({ success: false, error: "firstName, lastName, line1, city, postalCode and phone are required" });
    return;
  }
  if (isDefault) await pool!.query(`UPDATE mkt_addresses SET is_default = false WHERE user_id = $1`, [req.params.userId]);
  const { rows } = await pool!.query(
    `INSERT INTO mkt_addresses (user_id, label, first_name, last_name, line1, line2, city, state, postal_code, country, phone, is_default)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [req.params.userId, label ?? "Home", firstName, lastName, line1, line2 ?? null, city, state ?? "", postalCode, country ?? "ZA", phone, Boolean(isDefault)]
  );
  res.status(201).json({ success: true, data: mapAddress(rows[0]) });
});

router.delete("/addresses/:userId/:addressId", requireAuth, requireSelf, async (req: Request, res: Response): Promise<void> => {
  await pool!.query(`DELETE FROM mkt_addresses WHERE id::text = $1 AND user_id = $2`, [req.params.addressId, req.params.userId]);
  res.json({ success: true });
});

// ── CUSTOMER DASHBOARD ───────────────────────────────────────────────────────
router.get("/customers/:userId/stats", requireAuth, requireSelf, async (req: Request, res: Response): Promise<void> => {
  const userId = req.params.userId;
  const { rows: statusRows } = await pool!.query(
    `SELECT status, COUNT(*)::int AS n FROM mkt_orders WHERE user_id = $1 GROUP BY status`, [userId]
  );
  const counts = { inProgress: 0, delivered: 0, cancelled: 0, returned: 0 };
  for (const r of statusRows) {
    if (["pending", "confirmed", "processing", "shipped"].includes(r.status)) counts.inProgress += r.n;
    else if (r.status === "delivered") counts.delivered += r.n;
    // A payment_failed order is bucketed with cancelled — it never
    // completed, and stock was already restocked automatically, the same
    // real-world outcome as a cancellation. Without this, a failed-payment
    // order matched none of these branches and silently vanished from the
    // customer's total order count instead of being counted anywhere.
    else if (r.status === "cancelled" || r.status === "payment_failed") counts.cancelled += r.n;
    else if (["return_requested", "returned", "refunded"].includes(r.status)) counts.returned += r.n;
  }
  const { rows: recent } = await pool!.query(
    `SELECT * FROM mkt_orders WHERE user_id = $1 ORDER BY placed_at DESC LIMIT 5`, [userId]
  );
  const { rows: spentRows } = await pool!.query(
    `SELECT COALESCE(SUM(total_amount),0)::float AS total FROM mkt_orders WHERE user_id = $1 AND payment_status = 'payment_confirmed'`, [userId]
  );
  // Reward points: a simple, transparent, deterministic formula (1 point per R10 spent) — not a black box.
  const rewardPoints = Math.floor(Number(spentRows[0].total) / 10);
  res.json({
    success: true,
    data: {
      orderCounts: counts,
      totalSpent: Number(spentRows[0].total),
      rewardPoints,
      membership: rewardPoints >= 1000 ? "Premium" : "Standard",
      recentOrders: recent.map(mapOrder),
    },
  });
});

router.get("/customers/:userId/spending", requireAuth, requireSelf, async (req: Request, res: Response): Promise<void> => {
  const userId = req.params.userId;
  const { rows: monthly } = await pool!.query(
    `SELECT to_char(placed_at, 'Mon') AS month, date_trunc('month', placed_at) AS m, SUM(total_amount)::float AS total
     FROM mkt_orders WHERE user_id = $1 AND payment_status = 'payment_confirmed' AND placed_at > now() - interval '6 months'
     GROUP BY month, m ORDER BY m`, [userId]
  );
  const { rows: orders } = await pool!.query(`SELECT items FROM mkt_orders WHERE user_id = $1 AND payment_status = 'payment_confirmed'`, [userId]);
  const catTotals: Record<string, number> = {};
  for (const o of orders) {
    for (const item of (o.items as any[])) catTotals[item.sellerName ?? "Other"] = (catTotals[item.sellerName ?? "Other"] ?? 0) + item.totalPrice;
  }
  res.json({
    success: true,
    data: {
      monthly: monthly.map(m => ({ month: m.month, total: Number(m.total) })),
      byCategory: Object.entries(catTotals).map(([name, total]) => ({ name, total })),
    },
  });
});

// ── SELLER REGISTRATION ──────────────────────────────────────────────────────
router.post("/sellers/register", async (req: Request, res: Response): Promise<void> => {
  const { username, password, name, email, storeName, description, phone, taxId, applicationData } = req.body;
  if (!username || !password || !name || !email || !storeName) {
    res.status(400).json({ success: false, error: "username, password, name, email and storeName are required" });
    return;
  }
  if (password.length < 8) { res.status(400).json({ success: false, error: "password must be at least 8 characters" }); return; }

  const { rows: existing } = await pool!.query(`SELECT 1 FROM users WHERE username = $1 OR email = $2`, [username, email]);
  if (existing.length) { res.status(409).json({ success: false, error: "An account with that username or email already exists" }); return; }

  const slug = String(storeName).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  const { rows: slugExists } = await pool!.query(`SELECT 1 FROM mkt_sellers WHERE store_slug = $1`, [slug]);
  if (slugExists.length) { res.status(409).json({ success: false, error: "That store name is already taken" }); return; }

  const client = await pool!.connect();
  try {
    await client.query("BEGIN");
    const passwordHash = await bcrypt.hash(password, 10);
    const { rows: userRows } = await client.query(
      `INSERT INTO users (username, password_hash, role, name, email) VALUES ($1,$2,'seller',$3,$4) RETURNING *`,
      [username, passwordHash, name, email]
    );
    const user = userRows[0];
    const sellerId = `sel-${user.id.slice(0, 8)}`;
    await client.query(
      `INSERT INTO mkt_sellers (id, user_id, store_name, store_slug, description, email, phone, status, kyc_verified, tax_id, application_data)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'pending_kyc',false,$8,$9)`,
      [sellerId, user.id, storeName, slug, description ?? "", email, phone ?? "", taxId ?? null, JSON.stringify(applicationData ?? {})]
    );
    await client.query("COMMIT");
    const token = jwt.sign({ userId: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
    res.status(201).json({
      success: true, token,
      user: { id: user.id, username: user.username, name: user.name, email: user.email, role: user.role },
      seller: { id: sellerId, storeName, status: "pending_kyc" },
      message: "Seller account created — your application is pending review before your store goes live.",
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[marketplace] Seller registration failed:", err);
    res.status(500).json({ success: false, error: "Registration failed, please try again" });
  } finally {
    client.release();
  }
});

// ── SELLER: my orders / my products (CRUD) ──────────────────────────────────
router.get("/sellers/:id/orders", requireAuth, requireSellerOwner, async (req: Request, res: Response): Promise<void> => {
  const { rows } = await pool!.query(
    `SELECT * FROM mkt_orders WHERE items::text LIKE $1 ORDER BY placed_at DESC`, [`%"sellerId":"${req.params.id}"%`]
  );
  res.json({ success: true, data: rows.map(mapOrder), meta: { total: rows.length } });
});

// Read-only view into the fulfilment pipeline for this seller's imported
// lines — where each one currently sits between "ordered from supplier"
// and "delivered". Sellers can see this but never change it; only admins
// (PATCH /admin/supplier-orders/:id/status) advance the pipeline.
router.get("/sellers/:id/supplier-orders", requireAuth, requireSellerOwner, async (req: Request, res: Response): Promise<void> => {
  const { rows } = await pool!.query(
    `SELECT so.*, o.order_number, p.name AS product_name, sup.name AS supplier_name,
       ow.name AS origin_warehouse_name, dw.name AS destination_warehouse_name
     FROM mkt_supplier_orders so
     JOIN mkt_orders o ON o.id = so.order_id
     JOIN mkt_products p ON p.id = so.product_id
     JOIN mkt_suppliers sup ON sup.id = so.supplier_id
     JOIN mkt_warehouses ow ON ow.id = so.origin_warehouse_id
     JOIN mkt_warehouses dw ON dw.id = so.destination_warehouse_id
     WHERE so.seller_id = $1 ORDER BY so.created_at DESC LIMIT 100`,
    [req.params.id]
  );
  res.json({ success: true, data: rows.map(mapSupplierOrder), meta: { total: rows.length } });
});

router.post("/sellers/:id/products", requireAuth, requireSellerOwner, async (req: Request, res: Response): Promise<void> => {
  const { categoryId, name, shortDescription, description, price, compareAtPrice, stock, sku, brand, tags, attributes, emoji, images } = req.body;
  if (!categoryId || !name || !price) { res.status(400).json({ success: false, error: "categoryId, name and price are required" }); return; }
  const slug = `${String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}-${Date.now().toString(36)}`;
  const { rows } = await pool!.query(
    `INSERT INTO mkt_products (seller_id, category_id, name, slug, short_description, description, price, compare_at_price,
       currency, images, emoji, status, stock, sku, brand, tags, attributes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'ZAR',$9,$10,'pending_review',$11,$12,$13,$14,$15) RETURNING *`,
    [req.params.id, categoryId, name, slug, shortDescription ?? "", description ?? "", price, compareAtPrice ?? null,
     JSON.stringify(images ?? []), emoji ?? "📦", stock ?? 0, sku ?? null, brand ?? "", JSON.stringify(tags ?? []), JSON.stringify(attributes ?? {})]
  );
  res.status(201).json({ success: true, data: mapProduct(rows[0]), message: "Product submitted — it will appear once approved by the marketplace team." });
});

// Import a supplier-catalog item into this seller's own store — the
// seller picks their own retail price (their markup on top of the
// supplier's price), same as the business actually runs: supplier sets
// their price, seller adds their profit margin on top. sp.retail_price is
// now only a manager-set *suggested* starting point shown to the seller,
// not the enforced price — but a manager can still edit/override any
// listing's price after the fact via PATCH /sellers/:id/products/:id or
// PATCH /admin/products/:id/price, which stay manager-only.
router.post("/sellers/:id/import-listing", requireAuth, requireSellerOwner, async (req: Request, res: Response): Promise<void> => {
  const { supplierProductId, stock, retailPrice, compareAtPrice } = req.body;
  if (!supplierProductId) { res.status(400).json({ success: false, error: "supplierProductId is required" }); return; }

  const { rows: spRows } = await pool!.query(
    `SELECT * FROM mkt_supplier_products WHERE id::text = $1 AND status = 'active'`, [supplierProductId]
  );
  if (!spRows.length) { res.status(404).json({ success: false, error: "Supplier catalog item not found or no longer available" }); return; }
  const sp = spRows[0];

  if (!sp.category_id) { res.status(400).json({ success: false, error: "This catalog item has no category set — ask the marketplace team to assign one before importing." }); return; }
  // Seller's own price if they gave one; otherwise fall back to the
  // manager's suggested price on the catalog item, if any was set.
  const finalRetailPrice = retailPrice !== undefined && retailPrice !== null && retailPrice !== "" ? Number(retailPrice) : Number(sp.retail_price);
  if (!finalRetailPrice || finalRetailPrice <= 0) { res.status(400).json({ success: false, error: "Set a retail price for this listing (your price on top of the supplier's cost)." }); return; }
  const finalCompareAtPrice = compareAtPrice !== undefined && compareAtPrice !== null && compareAtPrice !== "" ? Number(compareAtPrice) : (sp.compare_at_price ?? null);
  // Note: a used vehicle can still be listed here even though it can never
  // be delivered to a South African address — Zambia allows used-vehicle
  // imports freely, so the same listing legitimately serves Zambian
  // buyers. The compliance check (condition + NRCS) happens at order
  // time instead, based on where THIS customer is actually shipping to.

  const slug = `${String(sp.name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}-${Date.now().toString(36)}`;
  const client = await pool!.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO mkt_products (seller_id, category_id, name, slug, short_description, description, price, compare_at_price,
         currency, images, emoji, status, stock, brand, fulfillment_type, supplier_product_id, vehicle_details, condition, nrcs_approved, nrcs_reference)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'ZAR',$9,$10,'pending_review',$11,$12,'imported',$13,$14,$15,$16,$17) RETURNING *`,
      [req.params.id, sp.category_id, sp.name, slug, sp.description ?? "", sp.description ?? "", finalRetailPrice, finalCompareAtPrice,
       JSON.stringify(sp.images ?? []), sp.emoji ?? "📦", stock ?? 0, "Imported", supplierProductId,
       sp.vehicle_details ? JSON.stringify(sp.vehicle_details) : null, sp.condition ?? null, sp.nrcs_approved ?? false, sp.nrcs_reference ?? null]
    );
    await client.query(`UPDATE mkt_supplier_products SET import_count = import_count + 1 WHERE id = $1`, [supplierProductId]);
    await client.query("COMMIT");
    res.status(201).json({ success: true, data: mapProduct(rows[0]), message: "Imported to your store — it will appear once approved by the marketplace team." });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[marketplace] Import listing failed:", err);
    res.status(500).json({ success: false, error: "Could not import this item, please try again." });
  } finally {
    client.release();
  }
});

router.patch("/sellers/:id/products/:productId", requireAuth, requireSellerOwner, async (req: Request, res: Response): Promise<void> => {
  const { rows: existing } = await pool!.query(`SELECT * FROM mkt_products WHERE id::text = $1 AND seller_id = $2`, [req.params.productId, req.params.id]);
  if (!existing.length) { res.status(404).json({ success: false, error: "Product not found" }); return; }

  // Price and discount (compareAtPrice) are manager-only, regardless of
  // fulfillment type — for imported listings they come from the supplier
  // relationship (mkt_supplier_products.retail_price/compare_at_price) and
  // for local listings they still need marketplace-team sign-off before
  // changing. A seller's own request never carries these through, even if
  // they own the store — requireSellerOwner lets a manager through too, so
  // check the actual role, not just ownership.
  const isManager = MANAGER_ROLES.includes(req.user!.role as any);
  if (!isManager && (req.body.price !== undefined || req.body.compareAtPrice !== undefined)) {
    res.status(403).json({ success: false, error: "Only the marketplace team can change price or discount — everything else on this listing is still yours to edit." });
    return;
  }

  const fields = isManager
    ? (["name","shortDescription","description","price","compareAtPrice","stock","sku","brand","emoji"] as const)
    : (["name","shortDescription","description","stock","sku","brand","emoji"] as const);
  const colMap: Record<string,string> = { name:"name", shortDescription:"short_description", description:"description", price:"price", compareAtPrice:"compare_at_price", stock:"stock", sku:"sku", brand:"brand", emoji:"emoji" };
  const sets: string[] = []; const vals: unknown[] = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) { vals.push(req.body[f]); sets.push(`${colMap[f]} = $${vals.length}`); }
  }
  if (!sets.length) { res.status(400).json({ success: false, error: "No fields to update" }); return; }
  vals.push(req.params.productId);
  const { rows } = await pool!.query(`UPDATE mkt_products SET ${sets.join(", ")}, updated_at = now() WHERE id::text = $${vals.length} RETURNING *`, vals);
  res.json({ success: true, data: mapProduct(rows[0]) });
});

router.delete("/sellers/:id/products/:productId", requireAuth, requireSellerOwner, async (req: Request, res: Response): Promise<void> => {
  await pool!.query(`UPDATE mkt_products SET status = 'inactive', updated_at = now() WHERE id::text = $1 AND seller_id = $2`, [req.params.productId, req.params.id]);
  res.json({ success: true });
});

// ── ADMIN: seller approval ───────────────────────────────────────────────────
router.get("/admin/sellers/pending", requireAuth, requireRole(...MANAGER_ROLES), async (_req: Request, res: Response): Promise<void> => {
  const { rows } = await pool!.query(
    `SELECT s.*, k.status AS kyc_status, k.provider AS kyc_provider, k.document_types_submitted AS kyc_documents_submitted,
            k.rejection_reason AS kyc_rejection_reason, k.submitted_at AS kyc_submitted_at
     FROM mkt_sellers s
     LEFT JOIN LATERAL (
       SELECT * FROM seller_kyc_verifications WHERE seller_id = s.id ORDER BY created_at DESC LIMIT 1
     ) k ON true
     WHERE s.status = 'pending_kyc' ORDER BY s.joined_at DESC`
  );
  res.json({
    success: true,
    data: rows.map(r => ({
      ...mapSeller(r),
      kyc: {
        status: r.kyc_status ?? "not_submitted",
        provider: r.kyc_provider,
        documentsSubmitted: r.kyc_documents_submitted ?? [],
        rejectionReason: r.kyc_rejection_reason,
        submittedAt: r.kyc_submitted_at,
      },
    })),
    meta: { total: rows.length },
  });
});

router.patch("/admin/sellers/:id/approve", requireAuth, requireRole(...MANAGER_ROLES), async (req: Request, res: Response): Promise<void> => {
  const { rows } = await pool!.query(`UPDATE mkt_sellers SET status = 'active', kyc_verified = true WHERE id = $1 RETURNING *`, [req.params.id]);
  if (!rows.length) { res.status(404).json({ success: false, error: "Seller not found" }); return; }
  res.json({ success: true, data: mapSeller(rows[0]) });
});

router.patch("/admin/sellers/:id/reject", requireAuth, requireRole(...MANAGER_ROLES), async (req: Request, res: Response): Promise<void> => {
  const { rows } = await pool!.query(`UPDATE mkt_sellers SET status = 'rejected' WHERE id = $1 RETURNING *`, [req.params.id]);
  if (!rows.length) { res.status(404).json({ success: false, error: "Seller not found" }); return; }
  res.json({ success: true, data: mapSeller(rows[0]) });
});

// ── ADMIN: customers list (User Management) ──────────────────────────────────
router.get("/admin/customers", requireAuth, requireRole(...MANAGER_ROLES), async (req: Request, res: Response): Promise<void> => {
  const { rows } = await pool!.query(`SELECT id, username, name, email, role, last_login, created_at FROM users WHERE role = 'customer' ORDER BY created_at DESC`);
  res.json({ success: true, data: rows.map(u => ({ id: u.id, username: u.username, name: u.name, email: u.email, role: u.role, lastLogin: u.last_login, createdAt: u.created_at })), meta: { total: rows.length } });
});

// ── REPORTS (CSV export) ─────────────────────────────────────────────────────
function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [headers.join(","), ...rows.map(r => headers.map(h => esc(r[h])).join(","))].join("\n");
}

router.get("/admin/reports/orders.csv", requireAuth, requireRole(...MANAGER_ROLES), async (_req: Request, res: Response): Promise<void> => {
  const { rows } = await pool!.query(`SELECT order_number, user_id, status, payment_status, total_amount, currency, placed_at FROM mkt_orders ORDER BY placed_at DESC`);
  const csv = toCsv(rows.map(r => ({ orderNumber: r.order_number, userId: r.user_id, status: r.status, paymentStatus: r.payment_status, totalAmount: r.total_amount, currency: r.currency, placedAt: r.placed_at })));
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="orders-${new Date().toISOString().slice(0,10)}.csv"`);
  res.send(csv);
});

router.get("/admin/reports/products.csv", requireAuth, requireRole(...MANAGER_ROLES), async (_req: Request, res: Response): Promise<void> => {
  const { rows } = await pool!.query(`SELECT p.name, p.sku, p.brand, p.price, p.stock, p.status, p.total_sold, s.store_name FROM mkt_products p JOIN mkt_sellers s ON s.id = p.seller_id ORDER BY p.total_sold DESC`);
  const csv = toCsv(rows.map(r => ({ name: r.name, sku: r.sku, brand: r.brand, price: r.price, stock: r.stock, status: r.status, totalSold: r.total_sold, seller: r.store_name })));
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="products-${new Date().toISOString().slice(0,10)}.csv"`);
  res.send(csv);
});

// ── TAX & DUTY REVENUE SUMMARY ───────────────────────────────────────────────
// Aggregates what's actually been calculated and collected — VAT charged to
// customers (mkt_orders.tax_amount, grouped by month + destination country)
// and import duty liability (mkt_orders.duty_amount, the estimate; and
// mkt_customs_records, the per-shipment figure once a shipment is batched
// and priced). This is reporting only: it tells you what's owed and what's
// been cleared, exactly like the customs-tracking module — filing the
// actual return with SARS/ZRA still happens outside this system.
router.get("/admin/tax-summary", requireAuth, requireRole(...MANAGER_ROLES), async (_req: Request, res: Response): Promise<void> => {
  const { rows: byPeriod } = await pool!.query(
    `SELECT to_char(placed_at, 'YYYY-MM') AS period, shipping_address->>'country' AS country,
       COUNT(*)::int AS order_count, SUM(subtotal) AS subtotal, SUM(tax_amount) AS vat_collected,
       SUM(duty_amount) AS duty_liability, SUM(total_amount) AS total_amount
     FROM mkt_orders
     WHERE status != 'refunded'
     GROUP BY period, country ORDER BY period DESC, country`
  );
  const { rows: customsByStatus } = await pool!.query(
    `SELECT status, destination_country, COUNT(*)::int AS record_count, SUM(declared_value) AS declared_value,
       SUM(duty_amount) AS duty_amount, SUM(vat_amount) AS vat_amount, SUM(total_payable) AS total_payable
     FROM mkt_customs_records GROUP BY status, destination_country ORDER BY destination_country, status`
  );
  const { rows: totalsRows } = await pool!.query(
    `SELECT
       COALESCE((SELECT SUM(tax_amount) FROM mkt_orders WHERE status != 'refunded'), 0) AS total_vat_collected,
       COALESCE((SELECT SUM(duty_amount) FROM mkt_orders WHERE status != 'refunded'), 0) AS total_duty_estimated,
       COALESCE((SELECT SUM(total_payable) FROM mkt_customs_records WHERE status = 'cleared'), 0) AS total_duty_cleared,
       COALESCE((SELECT SUM(total_payable) FROM mkt_customs_records WHERE status != 'cleared'), 0) AS total_duty_outstanding`
  );
  const t = totalsRows[0];
  res.json({
    success: true,
    data: {
      byPeriod: byPeriod.map(r => ({ period: r.period, country: r.country, orderCount: r.order_count, subtotal: Number(r.subtotal), vatCollected: Number(r.vat_collected), dutyLiability: Number(r.duty_liability), totalAmount: Number(r.total_amount) })),
      customsByStatus: customsByStatus.map(r => ({ status: r.status, country: r.destination_country, recordCount: r.record_count, declaredValue: Number(r.declared_value), dutyAmount: Number(r.duty_amount), vatAmount: Number(r.vat_amount), totalPayable: Number(r.total_payable) })),
      totals: {
        totalVatCollected: Number(t.total_vat_collected), totalDutyEstimated: Number(t.total_duty_estimated),
        totalDutyCleared: Number(t.total_duty_cleared), totalDutyOutstanding: Number(t.total_duty_outstanding),
      },
    },
  });
});

router.get("/admin/reports/tax.csv", requireAuth, requireRole(...MANAGER_ROLES), async (_req: Request, res: Response): Promise<void> => {
  const { rows } = await pool!.query(
    `SELECT to_char(placed_at, 'YYYY-MM') AS period, shipping_address->>'country' AS country,
       COUNT(*)::int AS order_count, SUM(subtotal) AS subtotal, SUM(tax_amount) AS vat_collected,
       SUM(duty_amount) AS duty_liability, SUM(total_amount) AS total_amount
     FROM mkt_orders WHERE status != 'refunded' GROUP BY period, country ORDER BY period DESC, country`
  );
  const csv = toCsv(rows.map(r => ({ period: r.period, country: r.country, orderCount: r.order_count, subtotal: r.subtotal, vatCollected: r.vat_collected, dutyLiability: r.duty_liability, totalAmount: r.total_amount })));
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="tax-summary-${new Date().toISOString().slice(0,10)}.csv"`);
  res.send(csv);
});

// ── SUPPLIER SELF-SERVICE (only for suppliers an admin has onboarded with
// a login via POST /admin/suppliers/:id/create-login — most suppliers have
// none and are managed entirely by Ballylife staff through the admin
// routes below). A supplier can see and edit their own profile and
// catalog, and see (read-only) their own fulfilment pipeline — never
// pricing shown to customers, another supplier's data, or anyone's cost/
// margin figures beyond their own.
router.get("/suppliers/by-user/:userId", requireAuth, async (req: Request, res: Response): Promise<void> => {
  if (req.user!.userId !== req.params.userId && !MANAGER_ROLES.includes(req.user!.role as any)) {
    res.status(403).json({ success: false, error: "Forbidden" }); return;
  }
  const { rows } = await pool!.query(`SELECT * FROM mkt_suppliers WHERE user_id = $1`, [req.params.userId]);
  if (!rows.length) { res.status(404).json({ success: false, error: "No supplier account linked to this login" }); return; }
  res.json({ success: true, data: mapSupplier(rows[0]) });
});

router.get("/suppliers/:id", requireAuth, requireSupplierOwner, async (req: Request, res: Response): Promise<void> => {
  const { rows } = await pool!.query(`SELECT * FROM mkt_suppliers WHERE id = $1`, [req.params.id]);
  if (!rows.length) { res.status(404).json({ success: false, error: "Supplier not found" }); return; }
  res.json({ success: true, data: mapSupplier(rows[0]) });
});

// A supplier may update their own operational contact/terms info, but
// never their own verified flag, status, or country — those stay
// admin-controlled (verification in particular has to mean something).
router.patch("/suppliers/:id", requireAuth, requireSupplierOwner, async (req: Request, res: Response): Promise<void> => {
  const fields = ["contactName", "contactEmail", "contactPhone", "platform", "paymentTerms", "leadTimeDays", "dropshipSupported"] as const;
  const colMap: Record<string, string> = { contactName: "contact_name", contactEmail: "contact_email", contactPhone: "contact_phone", platform: "platform", paymentTerms: "payment_terms", leadTimeDays: "lead_time_days", dropshipSupported: "dropship_supported" };
  const sets: string[] = []; const vals: unknown[] = [];
  for (const f of fields) { if (req.body[f] !== undefined) { vals.push(req.body[f]); sets.push(`${colMap[f]} = $${vals.length}`); } }
  if (!sets.length) { res.status(400).json({ success: false, error: "No fields to update" }); return; }
  vals.push(req.params.id);
  const { rows } = await pool!.query(`UPDATE mkt_suppliers SET ${sets.join(", ")} WHERE id = $${vals.length} RETURNING *`, vals);
  if (!rows.length) { res.status(404).json({ success: false, error: "Supplier not found" }); return; }
  res.json({ success: true, data: mapSupplier(rows[0]) });
});

router.get("/suppliers/:id/products", requireAuth, requireSupplierOwner, async (req: Request, res: Response): Promise<void> => {
  const { rows } = await pool!.query(
    `SELECT sp.*, s.name AS supplier_name, s.country AS supplier_country, c.name AS category_name
     FROM mkt_supplier_products sp JOIN mkt_suppliers s ON s.id = sp.supplier_id LEFT JOIN mkt_categories c ON c.id = sp.category_id
     WHERE sp.supplier_id = $1 ORDER BY sp.created_at DESC`,
    [req.params.id]
  );
  res.json({ success: true, data: rows.map(r => ({ ...mapSupplierProduct(r), categoryName: r.category_name })) });
});

// A supplier can propose a new catalog item, but it lands as
// pending_review with no category and no retail price — a manager has to
// classify it, price it, and approve it (same shape as a seller's new
// product listing) before it's importable. originCountry is fixed to the
// supplier's own country, not something they choose per item.
router.post("/suppliers/:id/products", requireAuth, requireSupplierOwner, async (req: Request, res: Response): Promise<void> => {
  const { name, description, costPrice, currency, moq, images, emoji, vehicleDetails, condition } = req.body;
  if (!name || costPrice === undefined) { res.status(400).json({ success: false, error: "name and costPrice are required" }); return; }
  const { rows: supRows } = await pool!.query(`SELECT country FROM mkt_suppliers WHERE id = $1`, [req.params.id]);
  const { rows } = await pool!.query(
    `INSERT INTO mkt_supplier_products (supplier_id, category_id, name, description, cost_price, currency, retail_price, compare_at_price, moq, images, emoji, origin_country, status, vehicle_details, condition)
     VALUES ($1,NULL,$2,$3,$4,$5,0,NULL,$6,$7,$8,$9,'pending_review',$10,$11) RETURNING *`,
    [req.params.id, name, description ?? "", costPrice, currency ?? "USD", moq ?? 1, JSON.stringify(images ?? []), emoji ?? "📦", supRows[0]?.country ?? "CN",
     vehicleDetails ? JSON.stringify(vehicleDetails) : null, condition ?? null]
  );
  res.status(201).json({ success: true, data: mapSupplierProduct(rows[0]), message: "Submitted — a manager will categorize, price, and approve it before it's importable." });
});

// A supplier can edit their own item's operational details (including
// vehicle specs and condition, which they're best placed to know), but
// never its category, retail/compare price, status, or NRCS approval —
// that last one is a compliance sign-off Ballylife's team makes after
// actually obtaining the Letter of Authority, not something a supplier
// can self-certify.
router.patch("/suppliers/:id/products/:productId", requireAuth, requireSupplierOwner, async (req: Request, res: Response): Promise<void> => {
  const { rows: existing } = await pool!.query(`SELECT id FROM mkt_supplier_products WHERE id::text = $1 AND supplier_id = $2`, [req.params.productId, req.params.id]);
  if (!existing.length) { res.status(404).json({ success: false, error: "Catalog item not found" }); return; }
  const fields = ["name", "description", "costPrice", "currency", "moq", "emoji", "images", "vehicleDetails", "condition"] as const;
  const colMap: Record<string, string> = { name: "name", description: "description", costPrice: "cost_price", currency: "currency", moq: "moq", emoji: "emoji", images: "images", vehicleDetails: "vehicle_details", condition: "condition" };
  const sets: string[] = []; const vals: unknown[] = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) { vals.push(f === "images" || f === "vehicleDetails" ? JSON.stringify(req.body[f]) : req.body[f]); sets.push(`${colMap[f]} = $${vals.length}`); }
  }
  if (!sets.length) { res.status(400).json({ success: false, error: "No fields to update" }); return; }
  vals.push(req.params.productId);
  const { rows } = await pool!.query(`UPDATE mkt_supplier_products SET ${sets.join(", ")}, updated_at = now() WHERE id::text = $${vals.length} RETURNING *`, vals);
  res.json({ success: true, data: mapSupplierProduct(rows[0]) });
});

// Read-only view of this supplier's own order lines moving through the
// fulfilment pipeline — visibility only, they never advance or resolve it
// themselves (that stays with admins/ops, who are physically doing the
// QC and freight).
router.get("/suppliers/:id/orders", requireAuth, requireSupplierOwner, async (req: Request, res: Response): Promise<void> => {
  const { rows } = await pool!.query(
    `SELECT so.*, o.order_number, p.name AS product_name, sel.store_name AS seller_name,
       ow.name AS origin_warehouse_name, dw.name AS destination_warehouse_name
     FROM mkt_supplier_orders so
     JOIN mkt_orders o ON o.id = so.order_id JOIN mkt_products p ON p.id = so.product_id JOIN mkt_sellers sel ON sel.id = so.seller_id
     JOIN mkt_warehouses ow ON ow.id = so.origin_warehouse_id JOIN mkt_warehouses dw ON dw.id = so.destination_warehouse_id
     WHERE so.supplier_id = $1 ORDER BY so.created_at DESC LIMIT 100`,
    [req.params.id]
  );
  res.json({ success: true, data: rows.map(mapSupplierOrder), meta: { total: rows.length } });
});

// ── REVENUE AUTHORITY SELF-SERVICE (read-only, country-scoped) ─────────────
// Only for an authority an admin has onboarded with a login. Everything
// here is read-only by design — an authority views what's been calculated
// for its own country; it can't edit rates, orders, or anything else.
router.get("/revenue-authorities/by-user/:userId", requireAuth, async (req: Request, res: Response): Promise<void> => {
  if (req.user!.userId !== req.params.userId && !MANAGER_ROLES.includes(req.user!.role as any)) {
    res.status(403).json({ success: false, error: "Forbidden" }); return;
  }
  const { rows } = await pool!.query(`SELECT * FROM mkt_revenue_authorities WHERE user_id = $1`, [req.params.userId]);
  if (!rows.length) { res.status(404).json({ success: false, error: "No revenue authority account linked to this login" }); return; }
  res.json({ success: true, data: mapRevenueAuthority(rows[0]) });
});

router.get("/revenue-authorities/:id", requireAuth, requireAuthorityOwner, async (req: Request, res: Response): Promise<void> => {
  const { rows } = await pool!.query(`SELECT * FROM mkt_revenue_authorities WHERE id = $1`, [req.params.id]);
  if (!rows.length) { res.status(404).json({ success: false, error: "Revenue authority not found" }); return; }
  res.json({ success: true, data: mapRevenueAuthority(rows[0]) });
});

// The same shape as /admin/tax-summary, but hard-filtered to this
// authority's own country at the query level — never returns another
// country's figures, regardless of what's requested.
router.get("/revenue-authorities/:id/tax-summary", requireAuth, requireAuthorityOwner, async (req: Request, res: Response): Promise<void> => {
  const { rows: authRows } = await pool!.query(`SELECT country FROM mkt_revenue_authorities WHERE id = $1`, [req.params.id]);
  if (!authRows.length) { res.status(404).json({ success: false, error: "Revenue authority not found" }); return; }
  const country = authRows[0].country;

  const { rows: byPeriod } = await pool!.query(
    `SELECT to_char(placed_at, 'YYYY-MM') AS period, COUNT(*)::int AS order_count, SUM(subtotal) AS subtotal,
       SUM(tax_amount) AS vat_collected, SUM(duty_amount) AS duty_liability, SUM(total_amount) AS total_amount
     FROM mkt_orders WHERE status != 'refunded' AND shipping_address->>'country' = $1
     GROUP BY period ORDER BY period DESC`,
    [country]
  );
  const { rows: customsByStatus } = await pool!.query(
    `SELECT status, COUNT(*)::int AS record_count, SUM(declared_value) AS declared_value,
       SUM(duty_amount) AS duty_amount, SUM(vat_amount) AS vat_amount, SUM(total_payable) AS total_payable
     FROM mkt_customs_records WHERE destination_country = $1 GROUP BY status ORDER BY status`,
    [country]
  );
  const { rows: totalsRows } = await pool!.query(
    `SELECT
       COALESCE((SELECT SUM(tax_amount) FROM mkt_orders WHERE status != 'refunded' AND shipping_address->>'country' = $1), 0) AS total_vat_collected,
       COALESCE((SELECT SUM(duty_amount) FROM mkt_orders WHERE status != 'refunded' AND shipping_address->>'country' = $1), 0) AS total_duty_estimated,
       COALESCE((SELECT SUM(total_payable) FROM mkt_customs_records WHERE destination_country = $1 AND status = 'cleared'), 0) AS total_duty_cleared,
       COALESCE((SELECT SUM(total_payable) FROM mkt_customs_records WHERE destination_country = $1 AND status != 'cleared'), 0) AS total_duty_outstanding`,
    [country]
  );
  const t = totalsRows[0];
  res.json({
    success: true,
    data: {
      country,
      byPeriod: byPeriod.map(r => ({ period: r.period, orderCount: r.order_count, subtotal: Number(r.subtotal), vatCollected: Number(r.vat_collected), dutyLiability: Number(r.duty_liability), totalAmount: Number(r.total_amount) })),
      customsByStatus: customsByStatus.map(r => ({ status: r.status, recordCount: r.record_count, declaredValue: Number(r.declared_value), dutyAmount: Number(r.duty_amount), vatAmount: Number(r.vat_amount), totalPayable: Number(r.total_payable) })),
      totals: {
        totalVatCollected: Number(t.total_vat_collected), totalDutyEstimated: Number(t.total_duty_estimated),
        totalDutyCleared: Number(t.total_duty_cleared), totalDutyOutstanding: Number(t.total_duty_outstanding),
      },
    },
  });
});

// ── ADMIN: SUPPLY CHAIN (suppliers, catalog, warehouses, shipments) ─────────
// All gated to marketplace_admin — this is Ballylife's own sourcing/ops
// team managing supplier relationships and the fulfilment pipeline, never
// exposed to sellers or customers beyond the read-only supplier-catalog
// browse route above.

router.get("/admin/suppliers", requireAuth, requireRole(...MANAGER_ROLES), async (_req: Request, res: Response): Promise<void> => {
  const { rows } = await pool!.query(`SELECT * FROM mkt_suppliers ORDER BY created_at DESC`);
  res.json({ success: true, data: rows.map(mapSupplier) });
});

router.post("/admin/suppliers", requireAuth, requireRole(...MANAGER_ROLES), async (req: Request, res: Response): Promise<void> => {
  const { name, country, contactName, contactEmail, contactPhone, platform, paymentTerms, leadTimeDays, dropshipSupported, verified, notes } = req.body;
  if (!name || !country) { res.status(400).json({ success: false, error: "name and country are required" }); return; }
  if (!["CN", "JP", "KR"].includes(country)) { res.status(400).json({ success: false, error: "country must be CN, JP or KR" }); return; }
  const id = `sup-${country.toLowerCase()}-${Date.now().toString(36)}`;
  const { rows } = await pool!.query(
    `INSERT INTO mkt_suppliers (id, name, country, contact_name, contact_email, contact_phone, platform, payment_terms, lead_time_days, dropship_supported, verified, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [id, name, country, contactName ?? null, contactEmail ?? null, contactPhone ?? null, platform ?? null,
     paymentTerms ?? null, leadTimeDays ?? 14, dropshipSupported ?? true, verified ?? false, notes ?? null]
  );
  res.status(201).json({ success: true, data: mapSupplier(rows[0]) });
});

router.patch("/admin/suppliers/:id", requireAuth, requireRole(...MANAGER_ROLES), async (req: Request, res: Response): Promise<void> => {
  const fields = ["name","contactName","contactEmail","contactPhone","platform","paymentTerms","leadTimeDays","dropshipSupported","verified","status","notes"] as const;
  const colMap: Record<string,string> = { name:"name", contactName:"contact_name", contactEmail:"contact_email", contactPhone:"contact_phone",
    platform:"platform", paymentTerms:"payment_terms", leadTimeDays:"lead_time_days", dropshipSupported:"dropship_supported", verified:"verified", status:"status", notes:"notes" };
  const sets: string[] = []; const vals: unknown[] = [];
  for (const f of fields) { if (req.body[f] !== undefined) { vals.push(req.body[f]); sets.push(`${colMap[f]} = $${vals.length}`); } }
  if (!sets.length) { res.status(400).json({ success: false, error: "No fields to update" }); return; }
  vals.push(req.params.id);
  const { rows } = await pool!.query(`UPDATE mkt_suppliers SET ${sets.join(", ")} WHERE id = $${vals.length} RETURNING *`, vals);
  if (!rows.length) { res.status(404).json({ success: false, error: "Supplier not found" }); return; }
  res.json({ success: true, data: mapSupplier(rows[0]) });
});

// Onboards a supplier with their own dashboard login — most suppliers
// never get this (managed entirely by staff instead); use only for a
// supplier you actually want self-servicing their own catalog/profile.
router.post("/admin/suppliers/:id/create-login", requireAuth, requireRole(...MANAGER_ROLES), async (req: Request, res: Response): Promise<void> => {
  const { username, password } = req.body;
  if (!username || !password) { res.status(400).json({ success: false, error: "username and password are required" }); return; }
  if (typeof password !== "string" || password.length < 8) { res.status(400).json({ success: false, error: "Password must be at least 8 characters" }); return; }

  const { rows: supRows } = await pool!.query(`SELECT * FROM mkt_suppliers WHERE id = $1`, [req.params.id]);
  if (!supRows.length) { res.status(404).json({ success: false, error: "Supplier not found" }); return; }
  if (supRows[0].user_id) { res.status(409).json({ success: false, error: "This supplier already has a login" }); return; }

  const { rows: existingUser } = await pool!.query(`SELECT id FROM users WHERE username = $1`, [username]);
  if (existingUser.length) { res.status(409).json({ success: false, error: "That username is already taken" }); return; }

  const client = await pool!.connect();
  try {
    await client.query("BEGIN");
    const passwordHash = await bcrypt.hash(password, 10);
    const { rows: userRows } = await client.query(
      `INSERT INTO users (username, password_hash, role, name, email) VALUES ($1,$2,'supplier',$3,$4) RETURNING id`,
      [username, passwordHash, supRows[0].name, supRows[0].contact_email ?? `${username}@ballylife.example`]
    );
    await client.query(`UPDATE mkt_suppliers SET user_id = $1 WHERE id = $2`, [userRows[0].id, req.params.id]);
    await client.query("COMMIT");
    res.status(201).json({ success: true, message: "Login created — share the username and password with the supplier directly; they aren't stored anywhere else." });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[marketplace] Supplier login creation failed:", err);
    res.status(500).json({ success: false, error: "Could not create a login for this supplier, please try again." });
  } finally {
    client.release();
  }
});

router.get("/admin/supplier-products", requireAuth, requireRole(...MANAGER_ROLES), async (req: Request, res: Response): Promise<void> => {
  const { supplierId } = req.query as Record<string, string>;
  const where = supplierId ? `WHERE sp.supplier_id = $1` : "";
  const { rows } = await pool!.query(
    `SELECT sp.*, s.name AS supplier_name, s.country AS supplier_country FROM mkt_supplier_products sp
     JOIN mkt_suppliers s ON s.id = sp.supplier_id ${where} ORDER BY sp.created_at DESC`,
    supplierId ? [supplierId] : []
  );
  res.json({ success: true, data: rows.map(mapSupplierProduct) });
});

router.post("/admin/supplier-products", requireAuth, requireRole(...MANAGER_ROLES), async (req: Request, res: Response): Promise<void> => {
  const { supplierId, categoryId, name, description, costPrice, currency, retailPrice, compareAtPrice, moq, images, emoji, originCountry, vehicleDetails, condition, nrcsApproved, nrcsReference } = req.body;
  if (!supplierId || !name || costPrice === undefined || !originCountry) {
    res.status(400).json({ success: false, error: "supplierId, name, costPrice and originCountry are required" }); return;
  }
  const { rows } = await pool!.query(
    `INSERT INTO mkt_supplier_products (supplier_id, category_id, name, description, cost_price, currency, retail_price, compare_at_price, moq, images, emoji, origin_country, vehicle_details, condition, nrcs_approved, nrcs_reference)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
    [supplierId, categoryId ?? null, name, description ?? "", costPrice, currency ?? "USD", retailPrice ?? 0, compareAtPrice ?? null, moq ?? 1, JSON.stringify(images ?? []), emoji ?? "📦", originCountry,
     vehicleDetails ? JSON.stringify(vehicleDetails) : null, condition ?? null, nrcsApproved ?? false, nrcsReference ?? null]
  );
  res.status(201).json({ success: true, data: mapSupplierProduct(rows[0]) });
});

router.patch("/admin/supplier-products/:id", requireAuth, requireRole(...MANAGER_ROLES), async (req: Request, res: Response): Promise<void> => {
  const fields = ["categoryId","name","description","costPrice","currency","retailPrice","compareAtPrice","moq","emoji","status","vehicleDetails","condition","nrcsApproved","nrcsReference"] as const;
  const colMap: Record<string,string> = { categoryId:"category_id", name:"name", description:"description", costPrice:"cost_price", currency:"currency", retailPrice:"retail_price", compareAtPrice:"compare_at_price", moq:"moq", emoji:"emoji", status:"status", vehicleDetails:"vehicle_details", condition:"condition", nrcsApproved:"nrcs_approved", nrcsReference:"nrcs_reference" };
  const sets: string[] = []; const vals: unknown[] = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) { vals.push(f === "vehicleDetails" ? JSON.stringify(req.body[f]) : req.body[f]); sets.push(`${colMap[f]} = $${vals.length}`); }
  }
  if (!sets.length) { res.status(400).json({ success: false, error: "No fields to update" }); return; }
  vals.push(req.params.id);
  const { rows } = await pool!.query(`UPDATE mkt_supplier_products SET ${sets.join(", ")}, updated_at = now() WHERE id::text = $${vals.length} RETURNING *`, vals);
  if (!rows.length) { res.status(404).json({ success: false, error: "Catalog item not found" }); return; }
  res.json({ success: true, data: mapSupplierProduct(rows[0]) });
});

router.get("/admin/warehouses", requireAuth, requireRole(...MANAGER_ROLES), async (_req: Request, res: Response): Promise<void> => {
  const { rows } = await pool!.query(`SELECT * FROM mkt_warehouses ORDER BY type, country`);
  res.json({ success: true, data: rows.map(mapWarehouse) });
});

router.post("/admin/warehouses", requireAuth, requireRole(...MANAGER_ROLES), async (req: Request, res: Response): Promise<void> => {
  const { name, country, type, address } = req.body;
  if (!name || !country || !type) { res.status(400).json({ success: false, error: "name, country and type are required" }); return; }
  if (!["origin", "destination"].includes(type)) { res.status(400).json({ success: false, error: "type must be origin or destination" }); return; }
  const id = `wh-${type === "origin" ? "origin" : "dest"}-${country.toLowerCase()}-${Date.now().toString(36)}`;
  const { rows } = await pool!.query(
    `INSERT INTO mkt_warehouses (id, name, country, type, address) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [id, name, country, type, address ?? null]
  );
  res.status(201).json({ success: true, data: mapWarehouse(rows[0]) });
});

// ── ADMIN: supplier orders (per-order-line fulfilment tracking) ────────────
router.get("/admin/supplier-orders", requireAuth, requireRole(...MANAGER_ROLES), async (req: Request, res: Response): Promise<void> => {
  const { status, originWarehouseId, shipmentId } = req.query as Record<string, string>;
  const where: string[] = []; const params: unknown[] = [];
  const p = (val: unknown) => { params.push(val); return `$${params.length}`; };
  if (status)            where.push(`so.status = ${p(status)}`);
  if (originWarehouseId) where.push(`so.origin_warehouse_id = ${p(originWarehouseId)}`);
  if (shipmentId)        where.push(`so.shipment_id::text = ${p(shipmentId)}`);
  const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const { rows } = await pool!.query(
    `SELECT so.*, o.order_number, p.name AS product_name, sup.name AS supplier_name, sel.store_name AS seller_name,
       ow.name AS origin_warehouse_name, dw.name AS destination_warehouse_name
     FROM mkt_supplier_orders so
     JOIN mkt_orders o ON o.id = so.order_id
     JOIN mkt_products p ON p.id = so.product_id
     JOIN mkt_suppliers sup ON sup.id = so.supplier_id
     JOIN mkt_sellers sel ON sel.id = so.seller_id
     JOIN mkt_warehouses ow ON ow.id = so.origin_warehouse_id
     JOIN mkt_warehouses dw ON dw.id = so.destination_warehouse_id
     ${whereClause} ORDER BY so.created_at DESC LIMIT 200`,
    params
  );
  res.json({ success: true, data: rows.map(mapSupplierOrder), meta: { total: rows.length } });
});

// Advances (or fails) a supplier order one step through its two-leg status
// machine. Rejects skips/backward moves so ops can't accidentally mark
// something "delivered" without it ever clearing customs, etc.
router.patch("/admin/supplier-orders/:id/status", requireAuth, requireRole(...MANAGER_ROLES), async (req: Request, res: Response): Promise<void> => {
  const { status, qcNotes } = req.body;
  if (!status) { res.status(400).json({ success: false, error: "status is required" }); return; }
  const { rows: existing } = await pool!.query(`SELECT status FROM mkt_supplier_orders WHERE id::text = $1`, [req.params.id]);
  if (!existing.length) { res.status(404).json({ success: false, error: "Supplier order not found" }); return; }
  const current = existing[0].status;
  const allowed = SUPPLIER_ORDER_TRANSITIONS[current] ?? [];
  if (!allowed.includes(status)) {
    res.status(409).json({ success: false, error: `Cannot move from "${current}" to "${status}" — valid next step(s): ${allowed.join(", ") || "none (terminal state)"}` });
    return;
  }
  const { rows } = await pool!.query(
    `UPDATE mkt_supplier_orders SET status = $1, qc_notes = COALESCE($2, qc_notes), updated_at = now() WHERE id::text = $3 RETURNING *`,
    [status, qcNotes ?? null, req.params.id]
  );
  res.json({ success: true, data: mapSupplierOrder(rows[0]) });
});

// A failed origin-hub QC check is a dead end for the normal status
// machine (SUPPLIER_ORDER_TRANSITIONS has no forward move from
// qc_failed_origin) — this is the deliberate off-ramp: either refund the
// customer's payment for that line, or reorder the same quantity from the
// supplier and send it back through the pipeline from the start.
router.post("/admin/supplier-orders/:id/resolve", requireAuth, requireRole(...MANAGER_ROLES), async (req: Request, res: Response): Promise<void> => {
  const { action, notes } = req.body;
  if (!["refund", "reorder"].includes(action)) { res.status(400).json({ success: false, error: "action must be 'refund' or 'reorder'" }); return; }
  const { rows: existing } = await pool!.query(`SELECT * FROM mkt_supplier_orders WHERE id::text = $1`, [req.params.id]);
  if (!existing.length) { res.status(404).json({ success: false, error: "Supplier order not found" }); return; }
  if (existing[0].status !== "qc_failed_origin") { res.status(409).json({ success: false, error: `Only a failed-QC order can be resolved — this one is "${existing[0].status}"` }); return; }

  const client = await pool!.connect();
  try {
    await client.query("BEGIN");
    if (action === "refund") {
      await client.query(
        `UPDATE mkt_supplier_orders SET status = 'refunded', qc_notes = COALESCE($1, qc_notes), updated_at = now() WHERE id::text = $2`,
        [notes ?? null, req.params.id]
      );
      // Refunds the whole parent order's payment status — this backend
      // doesn't yet support partial/line-level refunds on mkt_orders, so a
      // failed-QC item on a mixed cart currently refunds the full order.
      // Worth revisiting once mkt_pay_transactions supports partial amounts.
      await client.query(
        `UPDATE mkt_orders SET status = 'refunded', payment_status = 'refunded' WHERE id = $1`,
        [existing[0].order_id]
      );
    } else {
      await client.query(
        `UPDATE mkt_supplier_orders SET status = 'ordered_from_supplier', qc_notes = $1, updated_at = now() WHERE id::text = $2`,
        [notes ?? "Reordered after failed origin QC.", req.params.id]
      );
    }
    await client.query("COMMIT");
    const { rows } = await pool!.query(
      `SELECT so.*, o.order_number, p.name AS product_name, sup.name AS supplier_name, sel.store_name AS seller_name,
         ow.name AS origin_warehouse_name, dw.name AS destination_warehouse_name
       FROM mkt_supplier_orders so
       JOIN mkt_orders o ON o.id = so.order_id JOIN mkt_products p ON p.id = so.product_id
       JOIN mkt_suppliers sup ON sup.id = so.supplier_id JOIN mkt_sellers sel ON sel.id = so.seller_id
       JOIN mkt_warehouses ow ON ow.id = so.origin_warehouse_id JOIN mkt_warehouses dw ON dw.id = so.destination_warehouse_id
       WHERE so.id::text = $1`, [req.params.id]
    );
    res.json({ success: true, data: mapSupplierOrder(rows[0]), message: action === "refund" ? "Order refunded." : "Sent back to the supplier for reorder." });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[marketplace] Supplier order resolution failed:", err);
    res.status(500).json({ success: false, error: "Could not resolve this order, please try again." });
  } finally {
    client.release();
  }
});

// ── ADMIN: shipments (batches the 2nd leg — origin hub -> destination hub) ──
router.get("/admin/shipments", requireAuth, requireRole(...MANAGER_ROLES), async (_req: Request, res: Response): Promise<void> => {
  const { rows } = await pool!.query(
    `SELECT sh.*, ow.name AS origin_warehouse_name, dw.name AS destination_warehouse_name,
       (SELECT COUNT(*)::int FROM mkt_supplier_orders WHERE shipment_id = sh.id) AS order_count
     FROM mkt_shipments sh
     JOIN mkt_warehouses ow ON ow.id = sh.origin_warehouse_id
     JOIN mkt_warehouses dw ON dw.id = sh.destination_warehouse_id
     ORDER BY sh.created_at DESC`
  );
  res.json({ success: true, data: rows.map(mapShipment) });
});

// Creates a shipment and batches every mkt_supplier_orders row that is
// currently qc_passed_origin at the given origin/destination pair into it —
// this is the consolidation step: many small QC'd orders become one
// international freight movement instead of shipping individually.
router.post("/admin/shipments", requireAuth, requireRole(...MANAGER_ROLES), async (req: Request, res: Response): Promise<void> => {
  const { originWarehouseId, destinationWarehouseId, carrier, trackingNumber } = req.body;
  if (!originWarehouseId || !destinationWarehouseId) { res.status(400).json({ success: false, error: "originWarehouseId and destinationWarehouseId are required" }); return; }

  const client = await pool!.connect();
  try {
    await client.query("BEGIN");
    const { rows: batchRows } = await client.query(
      `SELECT id FROM mkt_supplier_orders WHERE origin_warehouse_id = $1 AND destination_warehouse_id = $2 AND status = 'qc_passed_origin' FOR UPDATE`,
      [originWarehouseId, destinationWarehouseId]
    );
    if (!batchRows.length) {
      await client.query("ROLLBACK");
      res.status(400).json({ success: false, error: "No QC-passed orders waiting at this origin/destination pair to batch into a shipment." });
      return;
    }
    const { rows: shipRows } = await client.query(
      `INSERT INTO mkt_shipments (origin_warehouse_id, destination_warehouse_id, carrier, tracking_number, status, dispatched_at)
       VALUES ($1,$2,$3,$4,'in_transit', now()) RETURNING *`,
      [originWarehouseId, destinationWarehouseId, carrier ?? null, trackingNumber ?? null]
    );
    const shipment = shipRows[0];
    const ids = batchRows.map(r => r.id);
    await client.query(
      `UPDATE mkt_supplier_orders SET shipment_id = $1, status = 'in_transit_to_destination', updated_at = now() WHERE id = ANY($2::uuid[])`,
      [shipment.id, ids]
    );
    await client.query("COMMIT");
    res.status(201).json({ success: true, data: mapShipment(shipment), message: `${ids.length} order(s) batched into this shipment.` });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[marketplace] Shipment batching failed:", err);
    res.status(500).json({ success: false, error: "Could not create shipment, please try again." });
  } finally {
    client.release();
  }
});

// Advances a shipment's own status and, on arrival/customs, cascades that
// to every supplier order riding in it — so ops updates one shipment
// record instead of dozens of individual order rows by hand.
router.patch("/admin/shipments/:id/status", requireAuth, requireRole(...MANAGER_ROLES), async (req: Request, res: Response): Promise<void> => {
  const { status } = req.body;
  const CASCADE: Record<string, string> = { received_at_destination: "received_at_destination_hub", customs_cleared: "customs_cleared" };
  const timestampCol: Record<string, string> = { received_at_destination: "received_at", customs_cleared: "customs_cleared_at", closed: "closed_at" };
  if (!status || !["in_transit", "received_at_destination", "customs_cleared", "closed"].includes(status)) {
    res.status(400).json({ success: false, error: "status must be one of in_transit, received_at_destination, customs_cleared, closed" }); return;
  }
  const client = await pool!.connect();
  try {
    await client.query("BEGIN");
    const col = timestampCol[status];
    const { rows } = await client.query(
      `UPDATE mkt_shipments SET status = $1${col ? `, ${col} = now()` : ""} WHERE id::text = $2 RETURNING *`,
      [status, req.params.id]
    );
    if (!rows.length) { await client.query("ROLLBACK"); res.status(404).json({ success: false, error: "Shipment not found" }); return; }
    if (CASCADE[status]) {
      await client.query(`UPDATE mkt_supplier_orders SET status = $1, updated_at = now() WHERE shipment_id::text = $2`, [CASCADE[status], req.params.id]);
    }
    await client.query("COMMIT");
    res.json({ success: true, data: mapShipment(rows[0]) });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[marketplace] Shipment status update failed:", err);
    res.status(500).json({ success: false, error: "Could not update shipment status, please try again." });
  } finally {
    client.release();
  }
});

// ── ADMIN: tax rates & customs (VAT/duty maintenance, customs clearance
// tracking). Everything here computes and records — it never submits a
// declaration or moves money to SARS/ZRA. See schema.sql for the fuller
// explanation of why that boundary exists.
router.get("/admin/tax-rates", requireAuth, requireRole(...MANAGER_ROLES), async (_req: Request, res: Response): Promise<void> => {
  const { rows } = await pool!.query(`SELECT * FROM mkt_tax_rates ORDER BY country`);
  res.json({ success: true, data: rows.map(mapTaxRate) });
});

router.patch("/admin/tax-rates/:country", requireAuth, requireRole(...MANAGER_ROLES), async (req: Request, res: Response): Promise<void> => {
  const { vatRatePct, defaultDutyRatePct, notes } = req.body;
  const sets: string[] = []; const vals: unknown[] = [];
  if (vatRatePct !== undefined) { vals.push(vatRatePct); sets.push(`vat_rate_pct = $${vals.length}`); }
  if (defaultDutyRatePct !== undefined) { vals.push(defaultDutyRatePct); sets.push(`default_duty_rate_pct = $${vals.length}`); }
  if (notes !== undefined) { vals.push(notes); sets.push(`notes = $${vals.length}`); }
  if (!sets.length) { res.status(400).json({ success: false, error: "No fields to update" }); return; }
  vals.push(req.params.country);
  const { rows } = await pool!.query(`UPDATE mkt_tax_rates SET ${sets.join(", ")}, updated_at = now() WHERE country = $${vals.length} RETURNING *`, vals);
  if (!rows.length) { res.status(404).json({ success: false, error: "Country not found — create it first via POST /admin/tax-rates" }); return; }
  res.json({ success: true, data: mapTaxRate(rows[0]) });
});

router.post("/admin/tax-rates", requireAuth, requireRole(...MANAGER_ROLES), async (req: Request, res: Response): Promise<void> => {
  const { country, vatRatePct, defaultDutyRatePct, notes } = req.body;
  if (!country || vatRatePct === undefined) { res.status(400).json({ success: false, error: "country and vatRatePct are required" }); return; }
  const { rows } = await pool!.query(
    `INSERT INTO mkt_tax_rates (country, vat_rate_pct, default_duty_rate_pct, notes) VALUES ($1,$2,$3,$4)
     ON CONFLICT (country) DO UPDATE SET vat_rate_pct = $2, default_duty_rate_pct = $3, notes = $4, updated_at = now() RETURNING *`,
    [country, vatRatePct, defaultDutyRatePct ?? 0, notes ?? null]
  );
  res.status(201).json({ success: true, data: mapTaxRate(rows[0]) });
});

router.get("/admin/duty-rates", requireAuth, requireRole(...MANAGER_ROLES), async (req: Request, res: Response): Promise<void> => {
  const { country } = req.query as Record<string, string>;
  const where = country ? `WHERE d.country = $1` : "";
  const { rows } = await pool!.query(
    `SELECT d.*, c.name AS category_name FROM mkt_duty_rates d JOIN mkt_categories c ON c.id = d.category_id ${where} ORDER BY d.country, c.name`,
    country ? [country] : []
  );
  res.json({ success: true, data: rows.map(mapDutyRate) });
});

router.post("/admin/duty-rates", requireAuth, requireRole(...MANAGER_ROLES), async (req: Request, res: Response): Promise<void> => {
  const { country, categoryId, dutyRatePct, notes } = req.body;
  if (!country || !categoryId || dutyRatePct === undefined) { res.status(400).json({ success: false, error: "country, categoryId and dutyRatePct are required" }); return; }
  const { rows } = await pool!.query(
    `INSERT INTO mkt_duty_rates (country, category_id, duty_rate_pct, notes) VALUES ($1,$2,$3,$4)
     ON CONFLICT (country, category_id) DO UPDATE SET duty_rate_pct = $3, notes = $4 RETURNING *`,
    [country, categoryId, dutyRatePct, notes ?? null]
  );
  res.status(201).json({ success: true, data: mapDutyRate(rows[0]) });
});

router.patch("/admin/duty-rates/:id", requireAuth, requireRole(...MANAGER_ROLES), async (req: Request, res: Response): Promise<void> => {
  const { dutyRatePct, notes } = req.body;
  const sets: string[] = []; const vals: unknown[] = [];
  if (dutyRatePct !== undefined) { vals.push(dutyRatePct); sets.push(`duty_rate_pct = $${vals.length}`); }
  if (notes !== undefined) { vals.push(notes); sets.push(`notes = $${vals.length}`); }
  if (!sets.length) { res.status(400).json({ success: false, error: "No fields to update" }); return; }
  vals.push(req.params.id);
  const { rows } = await pool!.query(`UPDATE mkt_duty_rates SET ${sets.join(", ")} WHERE id::text = $${vals.length} RETURNING *`, vals);
  if (!rows.length) { res.status(404).json({ success: false, error: "Duty rate not found" }); return; }
  res.json({ success: true, data: mapDutyRate(rows[0]) });
});

// ── ADMIN: VEHICLE DEPARTMENT (ZRA specific-duty schedule for Zambia) ──────
router.get("/admin/vehicle-duty-zm", requireAuth, requireRole(...MANAGER_ROLES), async (_req: Request, res: Response): Promise<void> => {
  const { rows } = await pool!.query(`SELECT * FROM mkt_vehicle_duty_zm ORDER BY body_type, engine_cc_min, age_band`);
  res.json({ success: true, data: rows.map(mapVehicleDutyZm) });
});

router.post("/admin/vehicle-duty-zm", requireAuth, requireRole(...MANAGER_ROLES), async (req: Request, res: Response): Promise<void> => {
  const { bodyType, engineCcMin, engineCcMax, ageBand, dutyKwacha, carbonSurtaxKwacha, notes } = req.body;
  if (!bodyType || !ageBand || dutyKwacha === undefined) { res.status(400).json({ success: false, error: "bodyType, ageBand and dutyKwacha are required" }); return; }
  const { rows } = await pool!.query(
    `INSERT INTO mkt_vehicle_duty_zm (body_type, engine_cc_min, engine_cc_max, age_band, duty_kwacha, carbon_surtax_kwacha, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (body_type, engine_cc_min, engine_cc_max, age_band) DO UPDATE SET duty_kwacha = $5, carbon_surtax_kwacha = $6, notes = $7
     RETURNING *`,
    [bodyType, engineCcMin ?? 0, engineCcMax ?? null, ageBand, dutyKwacha, carbonSurtaxKwacha ?? 0, notes ?? null]
  );
  res.status(201).json({ success: true, data: mapVehicleDutyZm(rows[0]) });
});

router.patch("/admin/vehicle-duty-zm/:id", requireAuth, requireRole(...MANAGER_ROLES), async (req: Request, res: Response): Promise<void> => {
  const { dutyKwacha, carbonSurtaxKwacha, notes } = req.body;
  const sets: string[] = []; const vals: unknown[] = [];
  if (dutyKwacha !== undefined) { vals.push(dutyKwacha); sets.push(`duty_kwacha = $${vals.length}`); }
  if (carbonSurtaxKwacha !== undefined) { vals.push(carbonSurtaxKwacha); sets.push(`carbon_surtax_kwacha = $${vals.length}`); }
  if (notes !== undefined) { vals.push(notes); sets.push(`notes = $${vals.length}`); }
  if (!sets.length) { res.status(400).json({ success: false, error: "No fields to update" }); return; }
  vals.push(req.params.id);
  const { rows } = await pool!.query(`UPDATE mkt_vehicle_duty_zm SET ${sets.join(", ")} WHERE id::text = $${vals.length} RETURNING *`, vals);
  if (!rows.length) { res.status(404).json({ success: false, error: "Rate not found" }); return; }
  res.json({ success: true, data: mapVehicleDutyZm(rows[0]) });
});

// ── ADMIN: FX RATES & SETTLEMENTS (platform fee + supplier/seller payouts) ──
router.get("/admin/fx-rates", requireAuth, requireRole(...MANAGER_ROLES), async (_req: Request, res: Response): Promise<void> => {
  const { rows } = await pool!.query(`SELECT * FROM mkt_fx_rates ORDER BY currency`);
  res.json({ success: true, data: rows.map(mapFxRate) });
});

router.post("/admin/fx-rates", requireAuth, requireRole(...MANAGER_ROLES), async (req: Request, res: Response): Promise<void> => {
  const { currency, rateToZar, notes } = req.body;
  if (!currency || rateToZar === undefined) { res.status(400).json({ success: false, error: "currency and rateToZar are required" }); return; }
  const { rows } = await pool!.query(
    `INSERT INTO mkt_fx_rates (currency, rate_to_zar, notes) VALUES ($1,$2,$3)
     ON CONFLICT (currency) DO UPDATE SET rate_to_zar = $2, notes = $3, updated_at = now() RETURNING *`,
    [currency, rateToZar, notes ?? null]
  );
  res.status(201).json({ success: true, data: mapFxRate(rows[0]) });
});

// Every order line's platform fee / supplier / seller split, filterable
// by seller, supplier, or payout status — the actual "who's owed what"
// view. Marking something paid here only records that Ballylife settled
// it through whatever real channel it used; no money moves through this
// endpoint itself.
router.get("/admin/settlements", requireAuth, requireRole(...MANAGER_ROLES), async (req: Request, res: Response): Promise<void> => {
  const { sellerId, supplierId, supplierPayoutStatus, sellerPayoutStatus } = req.query as Record<string, string>;
  const where: string[] = []; const params: unknown[] = [];
  const p = (val: unknown) => { params.push(val); return `$${params.length}`; };
  if (sellerId) where.push(`s.seller_id = ${p(sellerId)}`);
  if (supplierId) where.push(`s.supplier_id = ${p(supplierId)}`);
  if (supplierPayoutStatus) where.push(`s.supplier_payout_status = ${p(supplierPayoutStatus)}`);
  if (sellerPayoutStatus) where.push(`s.seller_payout_status = ${p(sellerPayoutStatus)}`);
  const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const { rows } = await pool!.query(
    `SELECT s.*, o.order_number, p.name AS product_name, sel.store_name AS seller_name, sup.name AS supplier_name
     FROM mkt_order_line_settlements s
     JOIN mkt_orders o ON o.id = s.order_id
     JOIN mkt_products p ON p.id = s.product_id
     JOIN mkt_sellers sel ON sel.id = s.seller_id
     LEFT JOIN mkt_suppliers sup ON sup.id = s.supplier_id
     ${whereClause} ORDER BY s.created_at DESC LIMIT 300`,
    params
  );
  const totals = rows.reduce((acc: any, r: any) => {
    acc.platformFeeTotal += Number(r.platform_fee_amount);
    if (r.seller_payout_status === "pending") acc.sellerOwedTotal += Number(r.seller_payout_amount);
    if (r.supplier_payout_status === "pending") acc.supplierOwedTotal += Number(r.supplier_cost_amount_zar ?? 0);
    return acc;
  }, { platformFeeTotal: 0, sellerOwedTotal: 0, supplierOwedTotal: 0 });
  res.json({ success: true, data: rows.map(mapSettlement), meta: { total: rows.length, totals } });
});

router.patch("/admin/settlements/:id", requireAuth, requireRole(...MANAGER_ROLES), async (req: Request, res: Response): Promise<void> => {
  const { supplierPayoutStatus, sellerPayoutStatus, supplierPayoutReference, sellerPayoutReference } = req.body;
  const sets: string[] = []; const vals: unknown[] = [];
  if (supplierPayoutStatus !== undefined) {
    vals.push(supplierPayoutStatus); sets.push(`supplier_payout_status = $${vals.length}`);
    if (supplierPayoutStatus === "paid") sets.push(`supplier_paid_at = now()`);
  }
  if (sellerPayoutStatus !== undefined) {
    vals.push(sellerPayoutStatus); sets.push(`seller_payout_status = $${vals.length}`);
    if (sellerPayoutStatus === "paid") sets.push(`seller_paid_at = now()`);
  }
  if (supplierPayoutReference !== undefined) { vals.push(supplierPayoutReference); sets.push(`supplier_payout_reference = $${vals.length}`); }
  if (sellerPayoutReference !== undefined) { vals.push(sellerPayoutReference); sets.push(`seller_payout_reference = $${vals.length}`); }
  if (!sets.length) { res.status(400).json({ success: false, error: "No fields to update" }); return; }
  vals.push(req.params.id);
  const { rows } = await pool!.query(`UPDATE mkt_order_line_settlements SET ${sets.join(", ")} WHERE id::text = $${vals.length} RETURNING *`, vals);
  if (!rows.length) { res.status(404).json({ success: false, error: "Settlement not found" }); return; }
  res.json({ success: true, data: mapSettlement(rows[0]) });
});

// ── ADMIN: REVENUE AUTHORITIES ───────────────────────────────────────────────
router.get("/admin/revenue-authorities", requireAuth, requireRole(...MANAGER_ROLES), async (_req: Request, res: Response): Promise<void> => {
  const { rows } = await pool!.query(`SELECT * FROM mkt_revenue_authorities ORDER BY country`);
  res.json({ success: true, data: rows.map(mapRevenueAuthority) });
});

router.post("/admin/revenue-authorities", requireAuth, requireRole(...MANAGER_ROLES), async (req: Request, res: Response): Promise<void> => {
  const { name, country, contactName, contactEmail, status, notes } = req.body;
  if (!name || !country) { res.status(400).json({ success: false, error: "name and country are required" }); return; }
  const { rows: taxRateRows } = await pool!.query(`SELECT 1 FROM mkt_tax_rates WHERE country = $1`, [country]);
  if (!taxRateRows.length) { res.status(400).json({ success: false, error: "Set a VAT/duty rate for this country under Tax Rates before adding its authority." }); return; }
  const id = `auth-${String(country).toLowerCase()}-${Date.now().toString(36)}`;
  const { rows } = await pool!.query(
    `INSERT INTO mkt_revenue_authorities (id, name, country, contact_name, contact_email, status, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [id, name, country, contactName ?? null, contactEmail ?? null, status ?? "not_agreed", notes ?? null]
  );
  res.status(201).json({ success: true, data: mapRevenueAuthority(rows[0]) });
});

router.patch("/admin/revenue-authorities/:id", requireAuth, requireRole(...MANAGER_ROLES), async (req: Request, res: Response): Promise<void> => {
  const fields = ["name", "contactName", "contactEmail", "status", "notes"] as const;
  const colMap: Record<string, string> = { name: "name", contactName: "contact_name", contactEmail: "contact_email", status: "status", notes: "notes" };
  const sets: string[] = []; const vals: unknown[] = [];
  for (const f of fields) { if (req.body[f] !== undefined) { vals.push(req.body[f]); sets.push(`${colMap[f]} = $${vals.length}`); } }
  if (!sets.length) { res.status(400).json({ success: false, error: "No fields to update" }); return; }
  vals.push(req.params.id);
  const { rows } = await pool!.query(`UPDATE mkt_revenue_authorities SET ${sets.join(", ")} WHERE id = $${vals.length} RETURNING *`, vals);
  if (!rows.length) { res.status(404).json({ success: false, error: "Revenue authority not found" }); return; }
  res.json({ success: true, data: mapRevenueAuthority(rows[0]) });
});

// Onboards a revenue authority with its own read-only dashboard login.
// Doing this does NOT constitute or imply a real reporting agreement —
// status on the authority record tracks that separately, and starts at
// 'not_agreed' regardless of whether a login exists.
router.post("/admin/revenue-authorities/:id/create-login", requireAuth, requireRole(...MANAGER_ROLES), async (req: Request, res: Response): Promise<void> => {
  const { username, password } = req.body;
  if (!username || !password) { res.status(400).json({ success: false, error: "username and password are required" }); return; }
  if (typeof password !== "string" || password.length < 8) { res.status(400).json({ success: false, error: "Password must be at least 8 characters" }); return; }

  const { rows: authRows } = await pool!.query(`SELECT * FROM mkt_revenue_authorities WHERE id = $1`, [req.params.id]);
  if (!authRows.length) { res.status(404).json({ success: false, error: "Revenue authority not found" }); return; }
  if (authRows[0].user_id) { res.status(409).json({ success: false, error: "This authority already has a login" }); return; }

  const { rows: existingUser } = await pool!.query(`SELECT id FROM users WHERE username = $1`, [username]);
  if (existingUser.length) { res.status(409).json({ success: false, error: "That username is already taken" }); return; }

  const client = await pool!.connect();
  try {
    await client.query("BEGIN");
    const passwordHash = await bcrypt.hash(password, 10);
    const { rows: userRows } = await client.query(
      `INSERT INTO users (username, password_hash, role, name, email) VALUES ($1,$2,'revenue_authority',$3,$4) RETURNING id`,
      [username, passwordHash, authRows[0].name, authRows[0].contact_email ?? `${username}@ballylife.example`]
    );
    await client.query(`UPDATE mkt_revenue_authorities SET user_id = $1 WHERE id = $2`, [userRows[0].id, req.params.id]);
    await client.query("COMMIT");
    res.status(201).json({ success: true, message: "Login created — share the username and password with the authority directly; they aren't stored anywhere else." });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[marketplace] Revenue authority login creation failed:", err);
    res.status(500).json({ success: false, error: "Could not create a login for this authority, please try again." });
  } finally {
    client.release();
  }
});

router.get("/admin/customs-records", requireAuth, requireRole(...MANAGER_ROLES), async (req: Request, res: Response): Promise<void> => {
  const { status } = req.query as Record<string, string>;
  const where = status ? `WHERE cr.status = $1` : "";
  const { rows } = await pool!.query(
    `SELECT cr.*, ow.name AS origin_warehouse_name, dw.name AS destination_warehouse_name,
       (SELECT COUNT(*)::int FROM mkt_supplier_orders WHERE shipment_id = cr.shipment_id) AS order_count
     FROM mkt_customs_records cr
     JOIN mkt_shipments sh ON sh.id = cr.shipment_id
     JOIN mkt_warehouses ow ON ow.id = sh.origin_warehouse_id
     JOIN mkt_warehouses dw ON dw.id = sh.destination_warehouse_id
     ${where} ORDER BY cr.created_at DESC`,
    status ? [status] : []
  );
  res.json({ success: true, data: rows.map(mapCustomsRecord) });
});

// Computes duty + VAT for a shipment from its linked (QC-passed or later)
// supplier orders — declared_value is the sum of supplier cost_amount
// (the real CIF-ish base), duty uses each item's category rate for the
// destination country, VAT uses that country's rate on the same base
// (import VAT, distinct from the retail VAT already charged to customers
// on mkt_orders.tax_amount). One record per shipment — calling this twice
// on the same shipment updates the existing record rather than duplicating.
router.post("/admin/customs-records/generate", requireAuth, requireRole(...MANAGER_ROLES), async (req: Request, res: Response): Promise<void> => {
  const { shipmentId } = req.body;
  if (!shipmentId) { res.status(400).json({ success: false, error: "shipmentId is required" }); return; }

  const { rows: shipRows } = await pool!.query(
    `SELECT sh.*, dw.country AS destination_country FROM mkt_shipments sh JOIN mkt_warehouses dw ON dw.id = sh.destination_warehouse_id WHERE sh.id::text = $1`,
    [shipmentId]
  );
  if (!shipRows.length) { res.status(404).json({ success: false, error: "Shipment not found" }); return; }
  const shipment = shipRows[0];

  const { rows: lineRows } = await pool!.query(
    `SELECT so.cost_amount, p.category_id, sp.currency AS cost_currency
     FROM mkt_supplier_orders so JOIN mkt_products p ON p.id = so.product_id
     LEFT JOIN mkt_supplier_products sp ON sp.id = so.supplier_product_id
     WHERE so.shipment_id::text = $1`,
    [shipmentId]
  );
  if (!lineRows.length) { res.status(400).json({ success: false, error: "This shipment has no supplier orders to base a customs record on." }); return; }

  const { rows: taxRateRows } = await pool!.query(`SELECT * FROM mkt_tax_rates WHERE country = $1`, [shipment.destination_country]);
  const vatRatePct = taxRateRows.length ? Number(taxRateRows[0].vat_rate_pct) : 15;
  const defaultDutyRatePct = taxRateRows.length ? Number(taxRateRows[0].default_duty_rate_pct) : 20;
  const { rows: dutyRateRows } = await pool!.query(`SELECT category_id, duty_rate_pct FROM mkt_duty_rates WHERE country = $1`, [shipment.destination_country]);
  const dutyRateByCategory = new Map(dutyRateRows.map((r: any) => [r.category_id, Number(r.duty_rate_pct)]));
  // mkt_supplier_orders.cost_amount is quoted in the supplier's own
  // currency (USD/CNY/JPY/KRW), same as everywhere else in this system —
  // converted to ZAR here via mkt_fx_rates rather than added raw, so
  // declared_value/duty actually mean something in the currency this
  // record is stored in.
  const { rows: fxRows } = await pool!.query(`SELECT * FROM mkt_fx_rates`);
  const fxByCurrency = new Map(fxRows.map((r: any) => [r.currency, Number(r.rate_to_zar)]));

  let declaredValue = 0, dutyAmount = 0;
  for (const line of lineRows) {
    const fxRate = line.cost_currency ? fxByCurrency.get(line.cost_currency) : undefined;
    if (!fxRate) {
      console.error(`[customs] No FX rate on file for ${line.cost_currency} — a line was skipped generating the customs record for shipment ${shipmentId}, not silently added in the wrong currency.`);
      continue;
    }
    const costZar = Number(line.cost_amount) * fxRate;
    declaredValue += costZar;
    const rate = line.category_id ? (dutyRateByCategory.get(line.category_id) ?? defaultDutyRatePct) : defaultDutyRatePct;
    dutyAmount += costZar * (rate / 100);
  }
  if (declaredValue === 0) {
    res.status(400).json({ success: false, error: "Couldn't compute a declared value — missing FX rate(s) for this shipment's currency. Add one under Payouts > Manage FX rates and try again." });
    return;
  }
  // Import VAT is assessed on the customs value plus duty already applied
  // (SARS' "Added Tax Value" method) — a reasonable general approximation
  // across jurisdictions even though the exact uplift formula varies.
  const vatAmount = (declaredValue + dutyAmount) * (vatRatePct / 100);
  const totalPayable = dutyAmount + vatAmount;

  const { rows } = await pool!.query(
    `INSERT INTO mkt_customs_records (shipment_id, destination_country, declared_value, duty_amount, vat_amount, total_payable, currency)
     VALUES ($1,$2,$3,$4,$5,$6,'ZAR')
     ON CONFLICT (shipment_id) DO UPDATE SET declared_value = $3, duty_amount = $4, vat_amount = $5, total_payable = $6, updated_at = now()
     RETURNING *`,
    [shipmentId, shipment.destination_country, declaredValue.toFixed(2), dutyAmount.toFixed(2), vatAmount.toFixed(2), totalPayable.toFixed(2)]
  );
  res.status(201).json({ success: true, data: mapCustomsRecord(rows[0]) });
});

router.patch("/admin/customs-records/:id", requireAuth, requireRole(...MANAGER_ROLES), async (req: Request, res: Response): Promise<void> => {
  const { status, clearingAgent, referenceNumber, notes } = req.body;
  const { rows: existing } = await pool!.query(`SELECT status FROM mkt_customs_records WHERE id::text = $1`, [req.params.id]);
  if (!existing.length) { res.status(404).json({ success: false, error: "Customs record not found" }); return; }

  const sets: string[] = ["updated_at = now()"]; const vals: unknown[] = [];
  if (clearingAgent !== undefined) { vals.push(clearingAgent); sets.push(`clearing_agent = $${vals.length}`); }
  if (referenceNumber !== undefined) { vals.push(referenceNumber); sets.push(`reference_number = $${vals.length}`); }
  if (notes !== undefined) { vals.push(notes); sets.push(`notes = $${vals.length}`); }
  if (status !== undefined) {
    const current = existing[0].status;
    const allowed = CUSTOMS_RECORD_TRANSITIONS[current] ?? [];
    if (!allowed.includes(status)) {
      res.status(409).json({ success: false, error: `Cannot move from "${current}" to "${status}" — valid next step(s): ${allowed.join(", ") || "none (terminal state)"}` });
      return;
    }
    vals.push(status); sets.push(`status = $${vals.length}`);
    const timestampCol: Record<string, string> = { prepaid_to_agent: "prepaid_at", declared_to_customs: "declared_at", cleared: "cleared_at" };
    if (timestampCol[status]) sets.push(`${timestampCol[status]} = now()`);
  }
  if (sets.length === 1) { res.status(400).json({ success: false, error: "No fields to update" }); return; }
  vals.push(req.params.id);
  const { rows } = await pool!.query(`UPDATE mkt_customs_records SET ${sets.join(", ")} WHERE id::text = $${vals.length} RETURNING *`, vals);
  res.json({ success: true, data: mapCustomsRecord(rows[0]) });
});

export default router;
