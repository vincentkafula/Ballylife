import { Router, Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { pool } from "../db/pool";
import { requireAuth, requireRole, JWT_SECRET, JWT_EXPIRES } from "../middleware/auth";
import { submitOrderPayment, getOrderTransactions } from "../services/mktPay";
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
  createdAt: r.created_at, updatedAt: r.updated_at,
});

const mapOrder = (r: any) => ({
  id: r.id, orderNumber: r.order_number, userId: r.user_id, customerName: r.customer_name,
  customerEmail: r.customer_email, items: r.items, subtotal: Number(r.subtotal),
  shippingCost: Number(r.shipping_cost), taxAmount: Number(r.tax_amount), discountAmount: Number(r.discount_amount),
  totalAmount: Number(r.total_amount), currency: r.currency, status: r.status, paymentStatus: r.payment_status,
  paymentMethod: r.payment_method, shippingAddress: r.shipping_address, shippingStatus: r.shipping_status,
  trackingNumber: r.tracking_number, carrier: r.carrier, estimatedDelivery: r.estimated_delivery,
  couponCode: r.coupon_code, notes: r.notes, placedAt: r.placed_at, confirmedAt: r.confirmed_at,
  shippedAt: r.shipped_at, deliveredAt: r.delivered_at, cancelledAt: r.cancelled_at,
});

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
  const limit = Math.min(48, Number(lim) || 12);

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

// ── ORDERS ────────────────────────────────────────────────────────────────────
router.get("/orders", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { status, page: pg, limit: lim } = req.query as Record<string, string>;
  const isManager = MANAGER_ROLES.includes(req.user!.role as any);
  // Non-managers can only ever see their own orders — a userId query param
  // from anyone else is ignored, not trusted.
  const userId = isManager ? (req.query.userId as string | undefined) : req.user!.userId;
  const page = Math.max(1, Number(pg) || 1);
  const limit = Math.min(48, Number(lim) || 12);
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
    line2: null, city: addr.city ?? "", state: addr.state ?? "", postalCode: addr.postal_code ?? "", country: "ZA", phone: addr.phone ?? "",
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

    const { rows } = await client.query(
      `INSERT INTO mkt_orders (order_number, user_id, customer_name, customer_email, items, subtotal, shipping_cost,
         tax_amount, discount_amount, total_amount, currency, status, payment_status, payment_method, shipping_address,
         shipping_status, estimated_delivery, coupon_code, confirmed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'ZAR','pending','pending_payment',$11,$12,'not_shipped', now() + interval '5 days', $13, NULL)
       RETURNING *`,
      [orderNumber, userId, `${shippingAddress.firstName} ${shippingAddress.lastName}`, customerEmail,
       JSON.stringify(items), cart.subtotal, cart.shipping, cart.tax, cart.coupon_discount, cart.total,
       paymentMethod ?? "card", JSON.stringify(shippingAddress), cart.coupon_code]
    );
    const order = rows[0];

    await client.query(`UPDATE mkt_carts SET items = '[]', coupon_code = NULL, coupon_discount = 0, subtotal = 0, shipping = 0, tax = 0, total = 0, updated_at = now() WHERE id = $1`, [cart.id]);
    await client.query("COMMIT");

    // Deliberately fire-and-forget, same discipline as the application risk
    // check in applicationsRouter.ts -- advisory only (Section 5.1.4: flags,
    // never blocks), so a failure here must never delay order confirmation
    // or the payment submission call right below it.
    checkPaymentVelocity(order.id, userId).catch(err => console.error("[fraud-risk] Payment velocity check failed:", err));

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
        meta: { paymentStatus: "pending_payment", mktPayTransactionId: submission.mktPayTransactionId },
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

router.patch("/sellers/:id/products/:productId", requireAuth, requireSellerOwner, async (req: Request, res: Response): Promise<void> => {
  const { rows: existing } = await pool!.query(`SELECT * FROM mkt_products WHERE id::text = $1 AND seller_id = $2`, [req.params.productId, req.params.id]);
  if (!existing.length) { res.status(404).json({ success: false, error: "Product not found" }); return; }
  const fields = ["name","shortDescription","description","price","compareAtPrice","stock","sku","brand","emoji"] as const;
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

export default router;
