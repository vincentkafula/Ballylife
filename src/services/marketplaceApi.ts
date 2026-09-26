import { API_BASE as BASE } from "./config";
export { API_BASE as BASE } from "./config";

let _token: string | null = localStorage.getItem("mkt_token");
export const setMktToken = (t: string | null) => { _token = t; if (t) localStorage.setItem("mkt_token", t); else localStorage.removeItem("mkt_token"); };
export const getMktToken = () => _token;

// A real production storefront doesn't silently substitute fake catalog/
// order data for real data when the backend is unreachable -- a shopper
// seeing an "in stock" quantity, a price, or an order status that isn't
// actually real is a worse outcome than an honest "we're having trouble
// connecting" message. This is a distinct error type so call sites (and
// the app's top-level ErrorBoundary) can show that message specifically,
// rather than a generic failure.
export class ApiConnectionError extends Error {
  constructor(message = "We're having trouble connecting right now — please check your connection and try again.") {
    super(message);
    this.name = "ApiConnectionError";
  }
}

async function api<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (_token) headers["Authorization"] = `Bearer ${_token}`;
  // A genuinely stalled connection (not an error response, just no
  // response ever) would otherwise hang indefinitely regardless of any
  // try/catch at the call site, since neither resolve nor reject would
  // ever fire without this.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers, signal: controller.signal });
    const j = await res.json();
    // A well-formed error body (e.g. 401 "Invalid username or password",
    // 403, 409) is a normal, expected outcome — return it as-is so callers
    // handle it via their own r.success check, exactly like a 200. Only
    // throw when the server responded but didn't give us a shape we can
    // reason about (no JSON body, or a body missing `success` entirely).
    if (!res.ok && typeof j?.success !== "boolean") throw new Error(j?.error ?? `HTTP ${res.status}`);
    return j;
  } catch (err) {
    const looksLikeNetworkFailure = err instanceof TypeError
      || (err instanceof Error && err.message.includes("fetch"))
      || (err instanceof DOMException && err.name === "AbortError"); // a timeout
    if (looksLikeNetworkFailure) throw new ApiConnectionError();
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

export interface CjSyncJob {
  status: "idle" | "running" | "done" | "failed"; nextPage: number; endPage: number; pageSize: number;
  totals: Partial<Record<"imported" | "updated" | "listed" | "withPhotos" | "detailFailures" | "skippedNoRate" | "skippedFresh" | "excluded" | "pages", number>>;
  totalAvailable: number | null; lastError: string | null; startedAt: string | null; finishedAt: string | null;
}

export interface CjSourcingResult {
  keyword: string; label: string; group: "mass" | "premium"; cjMatches: number; synced: number; listed: number; withVideo: number;
  priceMinZar: number | null; priceMaxZar: number | null; priceMedianZar: number | null;
}
export interface CjSourcingJob extends CjSyncJob { keywordIndex: number; keywords: number; results: CjSourcingResult[] }

export interface CjSweepJob extends CjSyncJob {
  pass: number; passes: number; categoryIndex: number; categories: number; currentCategory: string | null;
}

// ─── API exports ───────────────────────────────────────────────────────────────
export const mktCategories = () => api<{ success: boolean; data: unknown[] }>("/api/marketplace/categories");

export const mktProducts = {
  list:    (p?: Record<string, string>) => api<{ success: boolean; data: unknown[]; meta: Record<string, unknown> }>(`/api/marketplace/products?${new URLSearchParams(p)}`),
  suggest: (q: string) => api<{ success: boolean; data: unknown[] }>(`/api/marketplace/products/search-suggest?q=${encodeURIComponent(q)}`),
  get:     (id: string) => api<{ success: boolean; data: { product: unknown; seller: unknown; reviews: unknown[]; related: unknown[] } }>(`/api/marketplace/products/${id}`),
  reviews: (id: string) => api<{ success: boolean; data: unknown[]; meta: unknown }>(`/api/marketplace/products/${id}/reviews`),
  addReview: (id: string, body: unknown) => api(`/api/marketplace/products/${id}/reviews`, { method: "POST", body: JSON.stringify(body) }),
};

export const mktCart = {
  get:      (userId: string) => api<{ success: boolean; data: unknown | null }>(`/api/marketplace/cart/${userId}`),
  add:      (userId: string, body: unknown) => api<{ success: boolean; data: unknown; error?: string; code?: string }>(`/api/marketplace/cart/${userId}/add`, { method: "POST", body: JSON.stringify(body) }),
  update:   (userId: string, productId: string, quantity: number) => api(`/api/marketplace/cart/${userId}/item/${productId}`, { method: "PATCH", body: JSON.stringify({ quantity }) }),
  remove:   (userId: string, productId: string) => api(`/api/marketplace/cart/${userId}/item/${productId}`, { method: "DELETE" }),
  coupon:   (userId: string, code: string) => api<{ success: boolean; data: unknown; message: string }>(`/api/marketplace/cart/${userId}/coupon`, { method: "POST", body: JSON.stringify({ code }) }),
};

export const mktOrders = {
  list:   (p?: Record<string, string>) => api<{ success: boolean; data: unknown[] }>(`/api/marketplace/orders?${new URLSearchParams(p)}`),
  get:    (id: string) => api<{ success: boolean; data: unknown }>(`/api/marketplace/orders/${id}`),
  place:  (body: unknown) => api<{ success: boolean; data: unknown; error?: string; meta?: { paymentStatus?: string; mktPayTransactionId?: string; redirect?: { url: string; fields: Record<string, string> } } }>("/api/marketplace/orders", { method: "POST", body: JSON.stringify(body) }),
  cancel: (id: string) => api<{ success: boolean; data: unknown; error?: string }>(`/api/marketplace/orders/${id}/cancel`, { method: "POST" }),
  requestReturn: (id: string, reason: string) => api<{ success: boolean; data: unknown; error?: string }>(`/api/marketplace/orders/${id}/request-return`, { method: "POST", body: JSON.stringify({ reason }) }),
  /** Fresh PayFast redirect for an order still awaiting card payment. */
  pay: (id: string) => api<{ success: boolean; data?: { redirect: { url: string; fields: Record<string, string> } }; error?: string }>(`/api/marketplace/orders/${id}/pay`, { method: "POST" }),
  track: (orderNumber: string, email: string) => api<{ success: boolean; data: unknown; error?: string }>(`/api/marketplace/orders/track?${new URLSearchParams({ orderNumber, email })}`),
};

export const mktWishlist = {
  get:    (userId: string) => api<{ success: boolean; data: unknown[] }>(`/api/marketplace/wishlist/${userId}`),
  add:    (userId: string, productId: string) => api(`/api/marketplace/wishlist/${userId}`, { method: "POST", body: JSON.stringify({ productId }) }),
  remove: (userId: string, productId: string) => api(`/api/marketplace/wishlist/${userId}/${productId}`, { method: "DELETE" }),
};

export const mktSellers = {
  list:     () => api<{ success: boolean; data: unknown[] }>("/api/marketplace/sellers"),
  get:      (id: string) => api<{ success: boolean; data: unknown }>(`/api/marketplace/sellers/${id}`),
  analytics:(id: string) => api<{ success: boolean; data: unknown }>(`/api/marketplace/sellers/${id}/analytics`),
  register: (body: unknown) => api<{ success: boolean; token: string; user: unknown; seller: unknown; message: string }>("/api/marketplace/sellers/register", { method: "POST", body: JSON.stringify(body) }),
  myOrders: (sellerId: string) => api<{ success: boolean; data: unknown[] }>(`/api/marketplace/sellers/${sellerId}/orders`),
  addProduct:    (sellerId: string, body: unknown) => api<{ success: boolean; data: unknown; message: string }>(`/api/marketplace/sellers/${sellerId}/products`, { method: "POST", body: JSON.stringify(body) }),
  updateProduct: (sellerId: string, productId: string, body: unknown) => api<{ success: boolean; data: unknown }>(`/api/marketplace/sellers/${sellerId}/products/${productId}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteProduct: (sellerId: string, productId: string) => api(`/api/marketplace/sellers/${sellerId}/products/${productId}`, { method: "DELETE" }),
  updateProfile: (sellerId: string, body: unknown) => api<{ success: boolean; data: unknown }>(`/api/marketplace/sellers/${sellerId}`, { method: "PATCH", body: JSON.stringify(body) }),
  importListing: (sellerId: string, body: unknown) => api<{ success: boolean; data: unknown; error?: string; message?: string }>(`/api/marketplace/sellers/${sellerId}/import-listing`, { method: "POST", body: JSON.stringify(body) }),
  supplierOrders: (sellerId: string) => api<{ success: boolean; data: unknown[]; meta: unknown }>(`/api/marketplace/sellers/${sellerId}/supplier-orders`),
};

export const mktAdmin = {
  stats: () => api<{ success: boolean; data: unknown }>("/api/marketplace/admin/stats"),
  orders: (status?: string) => api<{ success: boolean; data: unknown[] }>(`/api/marketplace/admin/orders${status ? `?status=${status}` : ""}`),
  updateOrderStatus: (id: string, body: unknown) => api<{ success: boolean; data: unknown }>(`/api/marketplace/admin/orders/${id}/status`, { method: "PATCH", body: JSON.stringify(body) }),
  pendingProducts: () => api<{ success: boolean; data: unknown[] }>("/api/marketplace/admin/products/pending"),
  approveProduct: (id: string) => api<{ success: boolean; data: unknown }>(`/api/marketplace/admin/products/${id}/approve`, { method: "PATCH" }),
  pendingSellers: () => api<{ success: boolean; data: unknown[] }>("/api/marketplace/admin/sellers/pending"),
  approveSeller: (id: string) => api<{ success: boolean; data: unknown }>(`/api/marketplace/admin/sellers/${id}/approve`, { method: "PATCH" }),
  rejectSeller:  (id: string) => api<{ success: boolean; data: unknown }>(`/api/marketplace/admin/sellers/${id}/reject`, { method: "PATCH" }),
  taxSummary: () => api<{ success: boolean; data: unknown }>("/api/marketplace/admin/tax-summary"),
  revenueAuthorities: {
    list:        () => api<{ success: boolean; data: unknown[] }>("/api/marketplace/admin/revenue-authorities"),
    create:      (body: unknown) => api<{ success: boolean; data: unknown; error?: string }>("/api/marketplace/admin/revenue-authorities", { method: "POST", body: JSON.stringify(body) }),
    update:      (id: string, body: unknown) => api<{ success: boolean; data: unknown; error?: string }>(`/api/marketplace/admin/revenue-authorities/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    createLogin: (id: string, body: unknown) => api<{ success: boolean; message?: string; error?: string }>(`/api/marketplace/admin/revenue-authorities/${id}/create-login`, { method: "POST", body: JSON.stringify(body) }),
  },
  customers: () => api<{ success: boolean; data: unknown[] }>("/api/marketplace/admin/customers"),
  reportUrl: (report: "orders" | "products" | "tax") => `${BASE}/api/marketplace/admin/reports/${report}.csv`,
  refundOrder: (orderId: string, body: unknown) => api<{ success: boolean; data: unknown; error?: string; message?: string }>(`/api/marketplace/admin/orders/${orderId}/refund`, { method: "POST", body: JSON.stringify(body) }),
  orderRefunds: (orderId: string) => api<{ success: boolean; data: unknown[] }>(`/api/marketplace/admin/orders/${orderId}/refunds`),
  allProducts: (params?: Record<string, string>) => api<{ success: boolean; data: unknown[]; meta: Record<string, unknown> }>(`/api/marketplace/admin/products?${new URLSearchParams(params)}`),
  updateProductPrice: (id: string, body: unknown) => api<{ success: boolean; data: unknown; error?: string }>(`/api/marketplace/admin/products/${id}/price`, { method: "PATCH", body: JSON.stringify(body) }),
  suppliers: {
    list:   () => api<{ success: boolean; data: unknown[] }>("/api/marketplace/admin/suppliers"),
    create: (body: unknown) => api<{ success: boolean; data: unknown; error?: string }>("/api/marketplace/admin/suppliers", { method: "POST", body: JSON.stringify(body) }),
    update: (id: string, body: unknown) => api<{ success: boolean; data: unknown; error?: string }>(`/api/marketplace/admin/suppliers/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    createLogin: (id: string, body: unknown) => api<{ success: boolean; message?: string; error?: string }>(`/api/marketplace/admin/suppliers/${id}/create-login`, { method: "POST", body: JSON.stringify(body) }),
  },
  supplierProducts: {
    list:   (supplierId?: string) => api<{ success: boolean; data: unknown[] }>(`/api/marketplace/admin/supplier-products${supplierId ? `?supplierId=${supplierId}` : ""}`),
    create: (body: unknown) => api<{ success: boolean; data: unknown; error?: string }>("/api/marketplace/admin/supplier-products", { method: "POST", body: JSON.stringify(body) }),
    update: (id: string, body: unknown) => api<{ success: boolean; data: unknown; error?: string }>(`/api/marketplace/admin/supplier-products/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    bulkImport: (csv: string) => api<{ success: boolean; created: number; errorCount: number; errors: { row: number; error: string }[]; message?: string; error?: string }>("/api/marketplace/admin/supplier-products/bulk-import", { method: "POST", body: JSON.stringify({ csv }) }),
  },
  cj: {
    status: () => api<{ success: boolean; data: { configured: boolean } }>("/api/marketplace/admin/cj/status"),
    syncStatus: () => api<{ success: boolean; data: CjSyncJob | null }>("/api/marketplace/admin/cj/sync"),
    sweepStatus: () => api<{ success: boolean; data: CjSweepJob | null }>("/api/marketplace/admin/cj/sweep"),
    sourcingStatus: () => api<{ success: boolean; data: CjSourcingJob | null }>("/api/marketplace/admin/cj/sourcing"),
    startSweep: (pagesPerCategory: number) =>
      api<{ success: boolean; data?: CjSweepJob; error?: string }>("/api/marketplace/admin/cj/sweep", { method: "POST", body: JSON.stringify({ pagesPerCategory }) }),
    startSync: (body: { pageNum?: number; pages: number; pageSize?: number; categoryId?: string }) =>
      api<{ success: boolean; data?: CjSyncJob; error?: string }>("/api/marketplace/admin/cj/sync", { method: "POST", body: JSON.stringify(body) }),
    sync: (body: { pageNum?: number; pageSize?: number; categoryId?: string }) =>
      api<{ success: boolean; data?: { imported: number; updated: number; skippedNoRate: number; withPhotos?: number; detailFailures?: number; totalAvailable: number; pageNum: number; pageSize: number }; error?: string }>(
        "/api/marketplace/admin/cj/sync", { method: "POST", body: JSON.stringify(body) }
      ),
    fulfillments: (status?: string) =>
      api<{ success: boolean; data: Record<string, unknown>[]; meta: { counts: Record<string, number>; autoPay: boolean }; error?: string }>(
        `/api/marketplace/admin/cj/fulfillments${status ? `?status=${encodeURIComponent(status)}` : ""}`
      ),
    retry: (id: string) => api<{ success: boolean; data?: Record<string, unknown>; error?: string }>(`/api/marketplace/admin/cj/fulfillments/${id}/retry`, { method: "POST" }),
    refresh: (id: string) => api<{ success: boolean; data?: Record<string, unknown>; error?: string }>(`/api/marketplace/admin/cj/fulfillments/${id}/refresh`, { method: "POST" }),
  },
  warehouses: {
    list:   () => api<{ success: boolean; data: unknown[] }>("/api/marketplace/admin/warehouses"),
    create: (body: unknown) => api<{ success: boolean; data: unknown; error?: string }>("/api/marketplace/admin/warehouses", { method: "POST", body: JSON.stringify(body) }),
  },
  supplierOrders: {
    list:         (params?: Record<string, string>) => api<{ success: boolean; data: unknown[]; meta: Record<string, unknown> }>(`/api/marketplace/admin/supplier-orders?${new URLSearchParams(params)}`),
    updateStatus: (id: string, body: unknown) => api<{ success: boolean; data: unknown; error?: string }>(`/api/marketplace/admin/supplier-orders/${id}/status`, { method: "PATCH", body: JSON.stringify(body) }),
    resolve:      (id: string, body: unknown) => api<{ success: boolean; data: unknown; error?: string; message?: string }>(`/api/marketplace/admin/supplier-orders/${id}/resolve`, { method: "POST", body: JSON.stringify(body) }),
  },
  shipments: {
    list:         () => api<{ success: boolean; data: unknown[] }>("/api/marketplace/admin/shipments"),
    create:       (body: unknown) => api<{ success: boolean; data: unknown; error?: string; message?: string }>("/api/marketplace/admin/shipments", { method: "POST", body: JSON.stringify(body) }),
    updateStatus: (id: string, body: unknown) => api<{ success: boolean; data: unknown; error?: string }>(`/api/marketplace/admin/shipments/${id}/status`, { method: "PATCH", body: JSON.stringify(body) }),
  },
  taxRates: {
    list:   () => api<{ success: boolean; data: unknown[] }>("/api/marketplace/admin/tax-rates"),
    update: (country: string, body: unknown) => api<{ success: boolean; data: unknown; error?: string }>(`/api/marketplace/admin/tax-rates/${country}`, { method: "PATCH", body: JSON.stringify(body) }),
    create: (body: unknown) => api<{ success: boolean; data: unknown; error?: string }>("/api/marketplace/admin/tax-rates", { method: "POST", body: JSON.stringify(body) }),
  },
  dutyRates: {
    list:   (country?: string) => api<{ success: boolean; data: unknown[] }>(`/api/marketplace/admin/duty-rates${country ? `?country=${country}` : ""}`),
    create: (body: unknown) => api<{ success: boolean; data: unknown; error?: string }>("/api/marketplace/admin/duty-rates", { method: "POST", body: JSON.stringify(body) }),
    update: (id: string, body: unknown) => api<{ success: boolean; data: unknown; error?: string }>(`/api/marketplace/admin/duty-rates/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  },
  vehicleDutyZm: {
    list:   () => api<{ success: boolean; data: unknown[] }>("/api/marketplace/admin/vehicle-duty-zm"),
    create: (body: unknown) => api<{ success: boolean; data: unknown; error?: string }>("/api/marketplace/admin/vehicle-duty-zm", { method: "POST", body: JSON.stringify(body) }),
    update: (id: string, body: unknown) => api<{ success: boolean; data: unknown; error?: string }>(`/api/marketplace/admin/vehicle-duty-zm/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  },
  fxRates: {
    list:   () => api<{ success: boolean; data: unknown[] }>("/api/marketplace/admin/fx-rates"),
    create: (body: unknown) => api<{ success: boolean; data: unknown; error?: string }>("/api/marketplace/admin/fx-rates", { method: "POST", body: JSON.stringify(body) }),
  },
  settlements: {
    list:   (params?: Record<string, string>) => api<{ success: boolean; data: unknown[]; meta: { total: number; totals: { platformFeeTotal: number; sellerOwedTotal: number; supplierOwedTotal: number } } }>(`/api/marketplace/admin/settlements?${new URLSearchParams(params)}`),
    update: (id: string, body: unknown) => api<{ success: boolean; data: unknown; error?: string }>(`/api/marketplace/admin/settlements/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  },
  customsRecords: {
    list:     (status?: string) => api<{ success: boolean; data: unknown[] }>(`/api/marketplace/admin/customs-records${status ? `?status=${status}` : ""}`),
    generate: (shipmentId: string) => api<{ success: boolean; data: unknown; error?: string }>("/api/marketplace/admin/customs-records/generate", { method: "POST", body: JSON.stringify({ shipmentId }) }),
    update:   (id: string, body: unknown) => api<{ success: boolean; data: unknown; error?: string }>(`/api/marketplace/admin/customs-records/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  },
  auditLog: (params?: Record<string, string>) => api<{ success: boolean; data: unknown[]; meta: { page: number; limit: number; total: number; pages: number } }>(`/api/marketplace/admin/audit-log?${new URLSearchParams(params)}`),
  users: (params?: Record<string, string>) => api<{ success: boolean; data: unknown[]; meta: { total: number } }>(`/api/marketplace/admin/users?${new URLSearchParams(params)}`),
  changeUserRole: (userId: string, role: string) => api<{ success: boolean; data?: unknown; error?: string }>(`/api/marketplace/admin/users/${userId}/role`, { method: "PATCH", body: JSON.stringify({ role }) }),
};

export const mktAddresses = (userId: string) =>
  api<{ success: boolean; data: unknown[] }>(`/api/marketplace/addresses/${userId}`);
export const mktAddAddress = (userId: string, body: unknown) =>
  api<{ success: boolean; data: unknown }>(`/api/marketplace/addresses/${userId}`, { method: "POST", body: JSON.stringify(body) });
export const mktDeleteAddress = (userId: string, addressId: string) =>
  api(`/api/marketplace/addresses/${userId}/${addressId}`, { method: "DELETE" });

// ── Revenue authority self-service (read-only, country-scoped) ───────────────
export const mktAuthoritySelf = {
  byUser:     (userId: string) => api<{ success: boolean; data: unknown; error?: string }>(`/api/marketplace/revenue-authorities/by-user/${userId}`),
  get:        (id: string) => api<{ success: boolean; data: unknown; error?: string }>(`/api/marketplace/revenue-authorities/${id}`),
  taxSummary: (id: string) => api<{ success: boolean; data: unknown; error?: string }>(`/api/marketplace/revenue-authorities/${id}/tax-summary`),
};

// ── Shipping company self-service (claim, pick up, deliver-with-signature) ──
export const mktShippingSelf = {
  byUser:  (userId: string) => api<{ success: boolean; data: unknown; error?: string }>(`/api/marketplace/shipping-companies/by-user/${userId}`),
  get:     (id: string) => api<{ success: boolean; data: unknown; error?: string }>(`/api/marketplace/shipping-companies/${id}`),
  orders:  (id: string) => api<{ success: boolean; data: unknown[]; meta: unknown }>(`/api/marketplace/shipping-companies/${id}/orders`),
  claim:   (id: string, orderId: string) => api<{ success: boolean; data?: unknown; error?: string }>(`/api/marketplace/shipping-companies/${id}/orders/${orderId}/claim`, { method: "POST" }),
  pickup:  (id: string, orderId: string) => api<{ success: boolean; data?: unknown; error?: string }>(`/api/marketplace/shipping-companies/${id}/orders/${orderId}/pickup`, { method: "POST" }),
  deliver: (id: string, orderId: string, signedBy: string) => api<{ success: boolean; data?: unknown; error?: string }>(`/api/marketplace/shipping-companies/${id}/orders/${orderId}/deliver`, { method: "POST", body: JSON.stringify({ signedBy }) }),
};

// ── Credit provider self-service (approve/decline a BNPL lending decision) ──
export const mktCreditSelf = {
  byUser:  (userId: string) => api<{ success: boolean; data: unknown; error?: string }>(`/api/marketplace/credit-providers/by-user/${userId}`),
  get:     (id: string) => api<{ success: boolean; data: unknown; error?: string }>(`/api/marketplace/credit-providers/${id}`),
  orders:  (id: string) => api<{ success: boolean; data: unknown[]; meta: unknown }>(`/api/marketplace/credit-providers/${id}/orders`),
  approve: (id: string, orderId: string) => api<{ success: boolean; data?: unknown; error?: string }>(`/api/marketplace/credit-providers/${id}/orders/${orderId}/approve`, { method: "POST" }),
  decline: (id: string, orderId: string) => api<{ success: boolean; data?: unknown; error?: string }>(`/api/marketplace/credit-providers/${id}/orders/${orderId}/decline`, { method: "POST" }),
};

// ── Supplier self-service (only for suppliers an admin has onboarded with
// a login — see mktAdmin.createSupplierLogin below) ──────────────────────────
export const mktSuppliersSelf = {
  byUser:        (userId: string) => api<{ success: boolean; data: unknown; error?: string }>(`/api/marketplace/suppliers/by-user/${userId}`),
  get:           (id: string) => api<{ success: boolean; data: unknown; error?: string }>(`/api/marketplace/suppliers/${id}`),
  updateProfile: (id: string, body: unknown) => api<{ success: boolean; data: unknown; error?: string }>(`/api/marketplace/suppliers/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  products:      (id: string) => api<{ success: boolean; data: unknown[] }>(`/api/marketplace/suppliers/${id}/products`),
  addProduct:    (id: string, body: unknown) => api<{ success: boolean; data: unknown; error?: string; message?: string }>(`/api/marketplace/suppliers/${id}/products`, { method: "POST", body: JSON.stringify(body) }),
  updateProduct: (id: string, productId: string, body: unknown) => api<{ success: boolean; data: unknown; error?: string }>(`/api/marketplace/suppliers/${id}/products/${productId}`, { method: "PATCH", body: JSON.stringify(body) }),
  orders:        (id: string) => api<{ success: boolean; data: unknown[]; meta: unknown }>(`/api/marketplace/suppliers/${id}/orders`),
};

// ── Supplier catalog (sellers browse; admins manage) ─────────────────────────
export const mktSupplierCatalog = {
  list: (p?: Record<string, string>) => api<{ success: boolean; data: unknown[]; meta: Record<string, unknown> }>(`/api/marketplace/supplier-catalog?${new URLSearchParams(p)}`),
  get:  (id: string) => api<{ success: boolean; data: unknown }>(`/api/marketplace/supplier-catalog/${id}`),
};

export const mktCustomer = {
  stats:    (userId: string) => api<{ success: boolean; data: unknown }>(`/api/marketplace/customers/${userId}/stats`),
  spending: (userId: string) => api<{ success: boolean; data: unknown }>(`/api/marketplace/customers/${userId}/spending`),
};

// ── Marketplace auth (separate from the site's admin login) ─────────────────
export interface MktAuthUser { id: string; username: string; name: string; email: string; role: string; phone?: string | null; emailVerified?: boolean; phoneVerified?: boolean; accountStatus?: string; mustChangePassword?: boolean; }

// The shape login/register/verify-*/google/facebook all return when the
// account isn't active yet -- carried through to the caller (rather than
// collapsed into a generic error string) so the UI can route to a
// verification screen with the specifics it needs, not just an error toast.
export interface MktNeedsVerification { needsVerification: true; username: string; emailVerified: boolean; phoneVerified: boolean; hasPhone: boolean; accountStatus: string; }

// Shared by login() and the OAuth methods below: none of them get the
// seller/supplier/etc. record back in the initial response, so each
// looks it up by role so the app knows which store/supplier/authority
// this account owns.
async function finishOauthLogin(r: { success: boolean; data?: { token?: string; user: MktAuthUser } & Partial<MktNeedsVerification>; error?: string }) {
  if (r.success && r.data?.token) {
    const { token, user } = r.data;
    setMktToken(token);
    localStorage.setItem("mkt_user", JSON.stringify(user));
    await loadRoleRecord(user);
    return { success: true, token, user, error: undefined, verification: undefined } as const;
  }
  if (r.data?.needsVerification) {
    return { success: false, token: undefined, user: undefined, error: r.error ?? "Please verify your account.", verification: r.data as MktNeedsVerification };
  }
  return { success: false, token: undefined as unknown as string, user: undefined as unknown as MktAuthUser, error: r.error ?? "Sign-in failed", verification: undefined };
}

// Shared by verifyEmail() and verifyPhone(): if this call was the last
// required step, the backend hands back a real token in the same
// response (authRouter.ts's maybeIssueTokenIfNowActive) -- when that
// happens, log the person straight in rather than sending them back to
// a manual sign-in screen. If not, just return the (updated) user so
// the verification screen can show what's still outstanding.
async function applyVerificationResult(r: { success: boolean; data?: { token?: string; user: MktAuthUser }; error?: string }) {
  if (r.success && r.data?.token) {
    const { token, user } = r.data;
    setMktToken(token);
    localStorage.setItem("mkt_user", JSON.stringify(user));
    await loadRoleRecord(user);
  }
  return r;
}

async function loadRoleRecord(user: MktAuthUser): Promise<void> {
  if (user.role === "seller") {
    const sellerRes = await api<{ success: boolean; data: unknown }>(`/api/marketplace/sellers/by-user/${user.id}`);
    if (sellerRes.success) localStorage.setItem("mkt_seller", JSON.stringify(sellerRes.data));
  } else if (user.role === "supplier") {
    const supplierRes = await api<{ success: boolean; data: unknown }>(`/api/marketplace/suppliers/by-user/${user.id}`);
    if (supplierRes.success) localStorage.setItem("mkt_supplier", JSON.stringify(supplierRes.data));
  } else if (user.role === "revenue_authority") {
    const authorityRes = await api<{ success: boolean; data: unknown }>(`/api/marketplace/revenue-authorities/by-user/${user.id}`);
    if (authorityRes.success) localStorage.setItem("mkt_authority", JSON.stringify(authorityRes.data));
  } else if (user.role === "shipping_company") {
    const shippingRes = await api<{ success: boolean; data: unknown }>(`/api/marketplace/shipping-companies/by-user/${user.id}`);
    if (shippingRes.success) localStorage.setItem("mkt_shipping", JSON.stringify(shippingRes.data));
  } else if (user.role === "credit_provider") {
    const creditRes = await api<{ success: boolean; data: unknown }>(`/api/marketplace/credit-providers/by-user/${user.id}`);
    if (creditRes.success) localStorage.setItem("mkt_credit", JSON.stringify(creditRes.data));
  }
}

export const mktAuth = {
  login: async (username: string, password: string) => {
    const r = await api<{ success: boolean; data?: { token?: string; user: MktAuthUser } & Partial<MktNeedsVerification>; error?: string }>("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });
    if (r.success && r.data?.token) {
      const { token, user } = r.data;
      setMktToken(token);
      localStorage.setItem("mkt_user", JSON.stringify(user));
      await loadRoleRecord(user);
      // Flatten to the shape callers expect (token/user at the top level)
      // — the backend nests them under data, but every caller here (and
      // MarketplaceAuthModal) was written against a flat response.
      return { success: true, token, user, error: undefined, verification: undefined } as const;
    }
    if (r.data?.needsVerification) {
      // Correct credentials, account just isn't active yet -- carry the
      // verification details through rather than a bare error string,
      // so the caller can route to the verification screen with them.
      return { success: false, token: undefined, user: undefined, error: r.error ?? "Please verify your account.", verification: r.data as MktNeedsVerification };
    }
    return { success: false, token: undefined as unknown as string, user: undefined as unknown as MktAuthUser, error: r.error ?? "Invalid username or password", verification: undefined };
  },
  registerCustomer: async (body: { username: string; password: string; name: string; email: string; phone?: string }) => {
    const r = await api<{ success: boolean; data?: { user: MktAuthUser; needsVerification?: boolean }; error?: string }>("/api/auth/register", { method: "POST", body: JSON.stringify({ ...body, role: "customer" }) });
    // Registering never returns a usable token anymore -- the account
    // isn't active until it's verified (see docs/threat-model.md /
    // authRouter.ts). The caller routes to the verification screen
    // using just the returned user's username, no token required for
    // that screen's own verify/resend calls.
    if (r.success && r.data?.user) {
      return { success: true, user: r.data.user, needsVerification: Boolean(r.data.needsVerification), error: undefined };
    }
    return { success: false, user: undefined as unknown as MktAuthUser, needsVerification: false, error: r.error ?? "Registration failed" };
  },
  verifyEmail: (token: string) =>
    api<{ success: boolean; data?: { token?: string; user: MktAuthUser }; error?: string }>("/api/auth/verify-email", { method: "POST", body: JSON.stringify({ token }) })
      .then(applyVerificationResult),
  resendVerificationEmail: (username: string) =>
    api<{ success: boolean; error?: string }>("/api/auth/resend-verification-email", { method: "POST", body: JSON.stringify({ username }) }),
  verifyPhone: (username: string, code: string) =>
    api<{ success: boolean; data?: { token?: string; user: MktAuthUser }; error?: string }>("/api/auth/verify-phone", { method: "POST", body: JSON.stringify({ username, code }) })
      .then(applyVerificationResult),
  resendPhoneOtp: (username: string) =>
    api<{ success: boolean; error?: string }>("/api/auth/resend-phone-otp", { method: "POST", body: JSON.stringify({ username }) }),
  oauthConfig: () => api<{ success: boolean; data: { googleEnabled: boolean; facebookEnabled: boolean } }>("/api/auth/oauth-config"),
  // Google/Facebook sign-in: same post-login role lookup as login()
  // above (a Google sign-in can land on an existing seller/supplier/etc.
  // account if it was linked by matching email, not just a fresh
  // customer), so this shares that logic rather than assuming customer.
  google: async (credential: string) => {
    const r = await api<{ success: boolean; data?: { token?: string; user: MktAuthUser } & Partial<MktNeedsVerification>; error?: string }>("/api/auth/google", { method: "POST", body: JSON.stringify({ credential }) });
    return finishOauthLogin(r);
  },
  facebook: async (accessToken: string) => {
    const r = await api<{ success: boolean; data?: { token?: string; user: MktAuthUser } & Partial<MktNeedsVerification>; error?: string }>("/api/auth/facebook", { method: "POST", body: JSON.stringify({ accessToken }) });
    return finishOauthLogin(r);
  },
  registerSeller: async (body: { username: string; password: string; name: string; email: string; storeName: string; description?: string; phone?: string; taxId?: string; applicationData?: unknown }) => {
    const r = await mktSellers.register(body) as { success: boolean; token: string; user: MktAuthUser; seller: unknown; error?: string };
    if (r.success && r.token) { setMktToken(r.token); localStorage.setItem("mkt_user", JSON.stringify(r.user)); localStorage.setItem("mkt_seller", JSON.stringify(r.seller)); }
    return r;
  },
  logout: () => { setMktToken(null); localStorage.removeItem("mkt_user"); localStorage.removeItem("mkt_seller"); localStorage.removeItem("mkt_supplier"); localStorage.removeItem("mkt_authority"); localStorage.removeItem("mkt_shipping"); localStorage.removeItem("mkt_credit"); },
  // A password change signs out every other session (token_version bump) and
  // returns a fresh token for this one -- keep it, or this session is
  // signed out on its next request too.
  changePassword: async (currentPassword: string, newPassword: string) => {
    const r = await api<{ success: boolean; message?: string; error?: string; data?: { token?: string } }>("/api/auth/change-password", { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) });
    if (r.success && r.data?.token) setMktToken(r.data.token);
    return r;
  },
  forgotPassword: (email: string) =>
    api<{ success: boolean; message?: string; error?: string }>("/api/auth/forgot-password", { method: "POST", body: JSON.stringify({ email }) }),
  resetPassword: (token: string, newPassword: string) =>
    api<{ success: boolean; message?: string; error?: string }>("/api/auth/reset-password", { method: "POST", body: JSON.stringify({ token, newPassword }) }),
  restoreSession: (): { user: MktAuthUser; seller: { id: string; storeName: string; status: string } | null; supplier: Record<string, unknown> | null; authority: Record<string, unknown> | null; shipping: Record<string, unknown> | null; credit: Record<string, unknown> | null } | null => {
    if (!getMktToken()) return null;
    const raw = localStorage.getItem("mkt_user");
    if (!raw) return null;
    try {
      const user = JSON.parse(raw) as MktAuthUser;
      const sellerRaw = localStorage.getItem("mkt_seller");
      const supplierRaw = localStorage.getItem("mkt_supplier");
      const authorityRaw = localStorage.getItem("mkt_authority");
      const shippingRaw = localStorage.getItem("mkt_shipping");
      const creditRaw = localStorage.getItem("mkt_credit");
      return {
        user, seller: sellerRaw ? JSON.parse(sellerRaw) : null, supplier: supplierRaw ? JSON.parse(supplierRaw) : null,
        authority: authorityRaw ? JSON.parse(authorityRaw) : null, shipping: shippingRaw ? JSON.parse(shippingRaw) : null,
        credit: creditRaw ? JSON.parse(creditRaw) : null,
      };
    } catch { return null; }
  },
};

// ─── Plans, BallylifeMORE, store credit, Ballylife for Business ─────────────
export interface MorePlanInfo {
  id: "standard" | "premium"; name: string; monthlyPriceZar: number; orderDiscountPct: number;
  dealExtraDiscountPct: number; returnWindowDays: number; prioritySupport: boolean; benefits: string[];
}
export interface PlansInfo {
  currency: "ZAR";
  more: { plans: MorePlanInfo[]; trialDays: number; coolingOffDays: number };
  business: { tiers: { minMonthlySpendZar: number; rebatePct: number }[]; creditExpiryYears: number };
  creditRewards: { rewardPct: number; delayDays: number; payout: string; creditExpiryYears: number };
  standardReturnWindowDays: number;
}
export interface SubscriptionInfo {
  id: string; plan: "standard" | "premium"; planName: string; monthlyPriceZar: number;
  status: "trialing" | "active" | "past_due" | "cancelled" | "expired"; pendingPlan: string | null;
  trialEndsAt: string | null; currentPeriodEnd: string | null; nextBillingDate: string | null;
  cancelAt: string | null; commencedAt: string | null; benefitsActive: boolean; missedPeriods: number;
}
type Ok<T> = { success: boolean; data: T; error?: string; meta?: Record<string, unknown> };

export const mktPayments = {
  methods: () => api<Ok<import("../components/PaymentBadges").PaymentMethodsInfo>>("/api/marketplace/payments/methods"),
};

export const mktProgrammes = {
  plans: () => api<Ok<PlansInfo>>("/api/marketplace/plans"),
  subscription: {
    me: () => api<Ok<{ subscription: SubscriptionInfo | null; trialAvailable: boolean; payments: { amount: number; status: string; plan: string; periodStart: string; periodEnd: string; paidAt: string }[] }>>("/api/marketplace/subscriptions/me"),
    start: (plan: string) => api<Ok<{ subscriptionId: string; trial: boolean; redirect: { url: string; fields: Record<string, string> } }>>("/api/marketplace/subscriptions", { method: "POST", body: JSON.stringify({ plan }) }),
    change: (plan: string) => api<Ok<{ effective: string; plan: string; subscription: SubscriptionInfo }>>("/api/marketplace/subscriptions/change", { method: "POST", body: JSON.stringify({ plan }) }),
    cancel: () => api<Ok<{ endsAt: string; refund: boolean }>>("/api/marketplace/subscriptions/cancel", { method: "POST" }),
  },
  storeCredit: () => api<Ok<{ balance: number; entries: { amount: number; source: string; description: string | null; availableAt: string; expiresAt: string | null; createdAt: string }[] }>>("/api/marketplace/store-credit/me"),
  business: {
    me: () => api<Ok<{ account: Record<string, unknown> | null; thisMonth: { netSpendZar: number; rebatePct: number; estimatedRebateZar: number; nextTier: { minMonthlySpendZar: number; rebatePct: number } | null } | null; rebates: { amount: number; description: string; creditedAt: string }[] }>>("/api/marketplace/business/me"),
    apply: (body: { companyName: string; registrationNumber?: string; vatNumber?: string }) => api<Ok<Record<string, unknown>>>("/api/marketplace/business/apply", { method: "POST", body: JSON.stringify(body) }),
    leave: () => api<Ok<Record<string, unknown>>>("/api/marketplace/business/leave", { method: "POST" }),
  },
  admin: {
    subscriptions: () => api<Ok<(SubscriptionInfo & { userName?: string; userEmail?: string })[]>>("/api/marketplace/admin/subscriptions"),
    businessAccounts: (status?: string) => api<Ok<Record<string, unknown>[]>>(`/api/marketplace/admin/business-accounts${status ? `?status=${status}` : ""}`),
    decideBusiness: (id: string, decision: "approve" | "reject", note?: string) => api<Ok<Record<string, unknown>>>(`/api/marketplace/admin/business-accounts/${id}`, { method: "PATCH", body: JSON.stringify({ decision, note }) }),
  },
};

// ── Japan Used Parts (admin) ──────────────────────────────────────────────
export interface JapanPartsKeyword { keyword: string; label: string; partsCategory: string; enabled: boolean }
export interface JapanPartsSettings {
  enabled: boolean; keywords: JapanPartsKeyword[]; maxItemsPerKeyword: number; refreshHours: number;
  markupPct: number; forwarderFeeZar: number; dutyPct: number; vatPct: number; vatUpliftPct: number;
  freightByCategory: Record<string, number>; defaultFreightZar: number; deliveryDays: { min: number; max: number };
}
export interface JapanPartsRun { id: string; keyword: string; status: string; items: number; created: number; updated: number; removed: number; skipped: number; error: string | null; startedAt: string; finishedAt: string | null }
export interface JapanPartsListing { id: string; name: string; price: number; status: string; stock: number; conditionGrade: string | null; sourceUrl: string | null; sourceStatus: string | null; keyword: string | null; lastSeenAt: string | null; jpyTaxIncl: number | null; partsCategory: string | null; priceBreakdown: Record<string, number | string> | null }
export interface JapanPartsTask { id: string; orderNumber: string | null; placedAt: string | null; productId: string; productName: string | null; quantity: number; sourceUrl: string | null; status: string; purchaseRef: string | null; forwarder: string | null; trackingNumber: string | null; carrier: string | null; notes: string | null; updatedAt: string }

export const mktJapanParts = {
  settings: () => api<Ok<{ settings: JapanPartsSettings; apifyConfigured: boolean; refreshing: boolean }>>("/api/marketplace/admin/japan-parts/settings"),
  saveSettings: (settings: JapanPartsSettings) => api<Ok<{ settings: JapanPartsSettings; repriced: number }>>("/api/marketplace/admin/japan-parts/settings", { method: "PUT", body: JSON.stringify({ settings }) }),
  refresh: () => api<Ok<{ started: boolean }>>("/api/marketplace/admin/japan-parts/refresh", { method: "POST" }),
  runs: () => api<Ok<JapanPartsRun[]>>("/api/marketplace/admin/japan-parts/runs"),
  listings: () => api<Ok<JapanPartsListing[]>>("/api/marketplace/admin/japan-parts/listings"),
  tasks: () => api<Ok<JapanPartsTask[]>>("/api/marketplace/admin/japan-parts/fulfillments"),
  updateTask: (id: string, patch: Partial<Pick<JapanPartsTask, "status" | "purchaseRef" | "forwarder" | "trackingNumber" | "carrier" | "notes">>) =>
    api<Ok<JapanPartsTask>>(`/api/marketplace/admin/japan-parts/fulfillments/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
};

/** PayFast is redirect-based: post the signed fields to its hosted page. */
export function submitToPayfast(url: string, fields: Record<string, string>): void {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = url;
  for (const [k, v] of Object.entries(fields)) {
    const input = document.createElement("input");
    input.type = "hidden"; input.name = k; input.value = v;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
}
