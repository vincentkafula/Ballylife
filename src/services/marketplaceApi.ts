import { isDemoMode, setDemoMode, DEMO_TOKEN, mktMock } from "./demoMode";
import { API_BASE as BASE } from "./config";
export { API_BASE as BASE } from "./config";

let _token: string | null = localStorage.getItem("mkt_token");
export const setMktToken = (t: string | null) => { _token = t; if (t) localStorage.setItem("mkt_token", t); else localStorage.removeItem("mkt_token"); };
export const getMktToken = () => _token;

async function api<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (_token) headers["Authorization"] = `Bearer ${_token}`;
  // Previously no timeout existed here at all -- a genuinely stalled
  // connection (not an error response, just no response ever) would
  // hang indefinitely regardless of any try/catch at the call site,
  // since neither resolve nor reject would ever fire.
  //
  // Demo mode is now self-healing rather than a permanent, one-way
  // trap: previously, once isDemoMode() was ever set true (e.g. by a
  // transient network blip, or the CORS misconfiguration this fix
  // shipped alongside), every future call short-circuited straight to
  // fake data forever -- setDemoMode(true) was called on failure, but
  // nothing ever called it with false, and a real request was never
  // attempted again. Now every call still genuinely tries the real
  // backend first, even while already in demo mode -- just with a
  // much shorter timeout in that case (4s vs 20s) so a still-broken
  // backend doesn't make the whole app feel sluggish while it's being
  // retried. The moment a real request actually succeeds, demo mode
  // clears itself and every subsequent call uses real data again --
  // no manual localStorage clearing, no permanent "stuck in demo"
  // state for whoever's browser happened to be open during an outage.
  const wasInDemoMode = isDemoMode();
  const isAuthPath = path.startsWith("/api/auth/") || path.includes("/sellers/register");
  const controller = new AbortController();
  // Auth always gets the full timeout regardless of demo-mode state --
  // a legitimate slow login shouldn't fail just because unrelated
  // catalog calls happen to be mid-retry.
  const timeoutId = setTimeout(() => controller.abort(), wasInDemoMode && !isAuthPath ? 4000 : 20000);
  try {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers, signal: controller.signal });
    const j = await res.json();
    // A well-formed error body (e.g. 401 "Invalid username or password",
    // 403, 409) is a normal, expected outcome — return it as-is so callers
    // handle it via their own r.success check, exactly like a 200. Only
    // throw when the server responded but didn't give us a shape we can
    // reason about (no JSON body, or a body missing `success` entirely).
    if (!res.ok && typeof j?.success !== "boolean") throw new Error(j?.error ?? `HTTP ${res.status}`);
    if (wasInDemoMode) setDemoMode(false); // the real backend just answered -- stop pretending it can't
    return j;
  } catch (err) {
    // Auth requests never silently fall back to demo/mock data on a
    // network failure — a login or registration is either real or it
    // isn't; pretending it worked (or didn't) against fake data is worse
    // than surfacing the real connection error and letting the person retry.
    const looksLikeNetworkFailure = err instanceof TypeError
      || (err instanceof Error && err.message.includes("fetch"))
      || (err instanceof DOMException && err.name === "AbortError"); // a timeout, including the short demo-mode retry above
    if (!isAuthPath && looksLikeNetworkFailure) {
      setDemoMode(true);
      return mktDemoResponse(path, opts) as T;
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ─── Demo response router ──────────────────────────────────────────────────────
function mktDemoResponse(path: string, opts: RequestInit = {}): unknown {
  const method = (opts.method ?? "GET").toUpperCase();
  const body   = opts.body ? (() => { try { return JSON.parse(opts.body as string); } catch { return {}; } })() : {};
  const qs     = path.includes("?") ? Object.fromEntries(new URLSearchParams(path.split("?")[1])) : {};

  if (path.includes("/categories"))              return mktMock.categories();
  if (path.includes("/auth/forgot-password"))    return { success:true, message:"If an account exists with that email, a password reset link has been sent." };
  if (path.includes("/auth/reset-password"))     return { success:true, message:"Password reset successfully — you can now sign in with your new password." };
  if (path.includes("/search-suggest"))          return mktMock.searchSuggest(qs.q ?? "");
  if (path.includes("/admin/products/") && path.includes("/price")) return mktMock.adminUpdateProductPrice(path.split("/admin/products/")[1].split("/price")[0], body);
  if (path.includes("/admin/products/") && path.includes("/approve")) return mktMock.approveProduct(path.split("/admin/products/")[1].split("/approve")[0]);
  if (path.includes("/admin/products/pending")) return mktMock.pendingProducts();
  if (path.includes("/admin/products")) return mktMock.adminAllProducts(qs);
  if (path.match(/\/products\/[^/?]+$/) && !path.includes("reviews") && method === "GET") return mktMock.productById(path.split("/products/")[1].split("?")[0]);
  if (path.includes("/products") && method === "GET") return mktMock.products(qs);
  if (path.includes("/reviews") && method === "POST") return mktMock.addReview(body);
  if (path.includes("/reviews"))                 return mktMock.reviews(path.split("/products/")[1]?.split("/")[0] ?? "");
  if (path.includes("/cart") && method === "GET")      return mktMock.cart();
  if (path.includes("/cart") && path.includes("/add")) return mktMock.addToCart(body);
  if (path.includes("/cart") && path.includes("/coupon")) return mktMock.applyCoupon(body.code);
  if (path.includes("/cart") && method === "PATCH")    return mktMock.updateCartItem(body);
  if (path.includes("/cart") && method === "DELETE")   return mktMock.removeCartItem(path.split("/item/")[1]);
  if (path.includes("/admin/supplier-orders") && path.includes("/resolve")) return mktMock.adminResolveSupplierOrder(path.split("/admin/supplier-orders/")[1].split("/resolve")[0], body);
  if (path.includes("/admin/supplier-orders") && path.includes("/status")) return mktMock.adminUpdateSupplierOrderStatus(path.split("/admin/supplier-orders/")[1].split("/status")[0], body);
  if (path.includes("/admin/supplier-orders"))  return mktMock.adminSupplierOrders();
  if (path.includes("/orders/track"))            return mktMock.trackOrder(qs);
  if (path.includes("/orders") && method === "POST")   return mktMock.placeOrder(body);
  if (path.includes("/orders"))                  return mktMock.orders();
  if (path.includes("/wishlist") && method === "POST")   return { success: true, message: "Added to wishlist" };
  if (path.includes("/wishlist") && method === "DELETE") return { success: true };
  if (path.includes("/wishlist"))                return mktMock.wishlist();
  if (path.includes("/sellers") && path.includes("/analytics")) return mktMock.sellerAnalytics();
  if (path.includes("/import-listing"))          return mktMock.importListing(body);
  if (path.includes("/supplier-catalog") && !path.match(/\/supplier-catalog\/[^/?]+$/)) return mktMock.supplierCatalog(qs);
  if (path.match(/\/supplier-catalog\/[^/?]+$/)) return mktMock.supplierCatalogItem(path.split("/supplier-catalog/")[1].split("?")[0]);
  if (path.includes("/admin/suppliers") && path.includes("/create-login")) return mktMock.adminCreateSupplierLogin(path.split("/admin/suppliers/")[1].split("/create-login")[0], body);
  if (path.includes("/admin/suppliers") && method === "GET")   return mktMock.adminSuppliers();
  if (path.includes("/admin/suppliers") && method === "POST")  return mktMock.adminCreateSupplier(body);
  if (path.includes("/admin/suppliers") && method === "PATCH") return mktMock.adminUpdateSupplier(path.split("/admin/suppliers/")[1], body);
  if (path.includes("/suppliers/by-user/")) return mktMock.supplierByUser(path.split("/suppliers/by-user/")[1]);
  if (path.match(/\/suppliers\/[^/]+\/products\/[^/?]+$/) && method === "PATCH") return mktMock.supplierUpdateProduct(path.split("/suppliers/")[1].split("/products/")[0], path.split("/products/")[1], body);
  if (path.match(/\/suppliers\/[^/]+\/products$/) && method === "GET") return mktMock.supplierProducts(path.split("/suppliers/")[1].split("/products")[0]);
  if (path.match(/\/suppliers\/[^/]+\/products$/) && method === "POST") return mktMock.supplierAddProduct(path.split("/suppliers/")[1].split("/products")[0], body);
  if (path.match(/\/suppliers\/[^/]+\/orders$/)) return mktMock.supplierOrdersFor(path.split("/suppliers/")[1].split("/orders")[0]);
  if (path.match(/\/suppliers\/[^/?]+$/) && method === "PATCH") return mktMock.supplierUpdateProfile(path.split("/suppliers/")[1], body);
  if (path.match(/\/suppliers\/[^/?]+$/) && method === "GET") return mktMock.supplierGet(path.split("/suppliers/")[1].split("?")[0]);
  if (path.includes("/admin/supplier-products/bulk-import")) return mktMock.adminBulkImportSupplierProducts(body);
  if (path.includes("/admin/supplier-products") && method === "GET")   return mktMock.adminSupplierProducts();
  if (path.includes("/admin/supplier-products") && method === "POST")  return mktMock.adminCreateSupplierProduct(body);
  if (path.includes("/admin/supplier-products") && method === "PATCH") return mktMock.adminUpdateSupplierProduct(path.split("/admin/supplier-products/")[1], body);
  if (path.includes("/admin/warehouses") && method === "GET")  return mktMock.adminWarehouses();
  if (path.includes("/admin/warehouses") && method === "POST") return mktMock.adminCreateWarehouse(body);
  if (path.includes("/admin/shipments") && path.includes("/status")) return mktMock.adminUpdateShipmentStatus(path.split("/admin/shipments/")[1].split("/status")[0], body);
  if (path.includes("/admin/shipments") && method === "POST") return mktMock.adminCreateShipment(body);
  if (path.includes("/admin/shipments"))        return mktMock.adminShipments();
  if (path.includes("/admin/tax-rates") && method === "PATCH") return mktMock.adminUpdateTaxRate(path.split("/admin/tax-rates/")[1], body);
  if (path.includes("/admin/tax-rates") && method === "POST")  return mktMock.adminCreateTaxRate(body);
  if (path.includes("/admin/tax-rates"))         return mktMock.adminTaxRates();
  if (path.includes("/admin/duty-rates") && method === "POST")  return mktMock.adminCreateDutyRate(body);
  if (path.includes("/admin/duty-rates") && method === "PATCH") return mktMock.adminUpdateDutyRate(path.split("/admin/duty-rates/")[1], body);
  if (path.includes("/admin/duty-rates"))        return mktMock.adminDutyRates(qs);
  if (path.includes("/admin/vehicle-duty-zm") && method === "POST")  return mktMock.adminCreateVehicleDutyZm(body);
  if (path.includes("/admin/vehicle-duty-zm") && method === "PATCH") return mktMock.adminUpdateVehicleDutyZm(path.split("/admin/vehicle-duty-zm/")[1], body);
  if (path.includes("/admin/vehicle-duty-zm"))   return mktMock.adminVehicleDutyZm();
  if (path.includes("/admin/fx-rates") && method === "POST") return mktMock.adminCreateFxRate(body);
  if (path.includes("/admin/fx-rates"))          return mktMock.adminFxRates();
  if (path.includes("/admin/settlements") && method === "PATCH") return mktMock.adminUpdateSettlement(path.split("/admin/settlements/")[1], body);
  if (path.includes("/admin/settlements"))       return mktMock.adminSettlements(qs);
  if (path.includes("/admin/customs-records/generate")) return mktMock.adminGenerateCustomsRecord(body);
  if (path.includes("/admin/customs-records") && method === "PATCH") return mktMock.adminUpdateCustomsRecord(path.split("/admin/customs-records/")[1], body);
  if (path.includes("/admin/customs-records"))   return mktMock.adminCustomsRecords();
  if (path.includes("/sellers") && path.includes("/supplier-orders")) return mktMock.sellerSupplierOrders(path.split("/sellers/")[1].split("/supplier-orders")[0]);
  if (path.includes("/sellers"))                 return mktMock.sellers();
  if (path.includes("/admin/revenue-authorities") && path.includes("/create-login")) return mktMock.adminCreateAuthorityLogin(path.split("/admin/revenue-authorities/")[1].split("/create-login")[0], body);
  if (path.includes("/admin/revenue-authorities") && method === "GET")   return mktMock.adminRevenueAuthorities();
  if (path.includes("/admin/revenue-authorities") && method === "POST")  return mktMock.adminCreateRevenueAuthority(body);
  if (path.includes("/admin/revenue-authorities") && method === "PATCH") return mktMock.adminUpdateRevenueAuthority(path.split("/admin/revenue-authorities/")[1], body);
  if (path.includes("/revenue-authorities/by-user/")) return mktMock.authorityByUser(path.split("/revenue-authorities/by-user/")[1]);
  if (path.match(/\/revenue-authorities\/[^/]+\/tax-summary$/)) return mktMock.authorityTaxSummary(path.split("/revenue-authorities/")[1].split("/tax-summary")[0]);
  if (path.match(/\/revenue-authorities\/[^/?]+$/)) return mktMock.authorityGet(path.split("/revenue-authorities/")[1].split("?")[0]);
  if (path.includes("/admin/tax-summary"))       return mktMock.adminTaxSummary();
  if (path.includes("/admin/stats"))             return mktMock.adminStats();
  if (path.includes("/admin/orders") && path.includes("/refund") && method === "POST") return mktMock.adminRefundOrder(path.split("/admin/orders/")[1].split("/refund")[0], body);
  if (path.includes("/admin/orders") && path.includes("/refunds")) return mktMock.adminOrderRefunds(path.split("/admin/orders/")[1].split("/refunds")[0]);
  if (path.includes("/admin/orders"))            return mktMock.orders();
  if (path.includes("/addresses"))               return mktMock.addresses();
  return { success: true, data: {} };
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
  add:      (userId: string, body: unknown) => api<{ success: boolean; data: unknown }>(`/api/marketplace/cart/${userId}/add`, { method: "POST", body: JSON.stringify(body) }),
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
export interface MktAuthUser { id: string; username: string; name: string; email: string; role: string; }

// Shared by login() and the OAuth methods below: none of them get the
// seller/supplier/etc. record back in the initial response, so each
// looks it up by role so the app knows which store/supplier/authority
// this account owns.
async function finishOauthLogin(r: { success: boolean; data?: { token: string; user: MktAuthUser }; error?: string }) {
  if (r.success && r.data?.token) {
    const { token, user } = r.data;
    setMktToken(token);
    localStorage.setItem("mkt_user", JSON.stringify(user));
    await loadRoleRecord(user);
    return { success: true, token, user, error: undefined } as { success: boolean; token: string; user: MktAuthUser; error?: string };
  }
  return { success: false, token: undefined as unknown as string, user: undefined as unknown as MktAuthUser, error: r.error ?? "Sign-in failed" };
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
    const r = await api<{ success: boolean; data?: { token: string; user: MktAuthUser }; error?: string }>("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });
    if (r.success && r.data?.token) {
      const { token, user } = r.data;
      setMktToken(token);
      localStorage.setItem("mkt_user", JSON.stringify(user));
      await loadRoleRecord(user);
      // Flatten to the shape callers expect (token/user at the top level)
      // — the backend nests them under data, but every caller here (and
      // MarketplaceAuthModal) was written against a flat response.
      return { success: true, token, user, error: undefined } as { success: boolean; token: string; user: MktAuthUser; error?: string };
    }
    return { success: false, token: undefined as unknown as string, user: undefined as unknown as MktAuthUser, error: r.error ?? "Invalid username or password" };
  },
  registerCustomer: async (body: { username: string; password: string; name: string; email: string }) => {
    const r = await api<{ success: boolean; data?: { token: string; user: MktAuthUser }; error?: string }>("/api/auth/register", { method: "POST", body: JSON.stringify({ ...body, role: "customer" }) });
    if (r.success && r.data?.token) {
      setMktToken(r.data.token);
      localStorage.setItem("mkt_user", JSON.stringify(r.data.user));
      return { success: true, token: r.data.token, user: r.data.user, error: undefined } as { success: boolean; token: string; user: MktAuthUser; error?: string };
    }
    return { success: false, token: undefined as unknown as string, user: undefined as unknown as MktAuthUser, error: r.error ?? "Registration failed" };
  },
  oauthConfig: () => api<{ success: boolean; data: { googleEnabled: boolean; facebookEnabled: boolean } }>("/api/auth/oauth-config"),
  // Google/Facebook sign-in: same post-login role lookup as login()
  // above (a Google sign-in can land on an existing seller/supplier/etc.
  // account if it was linked by matching email, not just a fresh
  // customer), so this shares that logic rather than assuming customer.
  google: async (credential: string) => {
    const r = await api<{ success: boolean; data?: { token: string; user: MktAuthUser }; error?: string }>("/api/auth/google", { method: "POST", body: JSON.stringify({ credential }) });
    return finishOauthLogin(r);
  },
  facebook: async (accessToken: string) => {
    const r = await api<{ success: boolean; data?: { token: string; user: MktAuthUser }; error?: string }>("/api/auth/facebook", { method: "POST", body: JSON.stringify({ accessToken }) });
    return finishOauthLogin(r);
  },
  registerSeller: async (body: { username: string; password: string; name: string; email: string; storeName: string; description?: string; phone?: string; taxId?: string; applicationData?: unknown }) => {
    const r = await mktSellers.register(body) as { success: boolean; token: string; user: MktAuthUser; seller: unknown; error?: string };
    if (r.success && r.token) { setMktToken(r.token); localStorage.setItem("mkt_user", JSON.stringify(r.user)); localStorage.setItem("mkt_seller", JSON.stringify(r.seller)); }
    return r;
  },
  logout: () => { setMktToken(null); localStorage.removeItem("mkt_user"); localStorage.removeItem("mkt_seller"); localStorage.removeItem("mkt_supplier"); localStorage.removeItem("mkt_authority"); localStorage.removeItem("mkt_shipping"); localStorage.removeItem("mkt_credit"); },
  changePassword: (currentPassword: string, newPassword: string) =>
    api<{ success: boolean; message?: string; error?: string }>("/api/auth/change-password", { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) }),
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
