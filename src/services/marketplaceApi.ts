import { isDemoMode, setDemoMode, DEMO_TOKEN, mktMock } from "./demoMode";
import { API_BASE as BASE } from "./config";
export { API_BASE as BASE } from "./config";

let _token: string | null = localStorage.getItem("mkt_token");
export const setMktToken = (t: string | null) => { _token = t; if (t) localStorage.setItem("mkt_token", t); else localStorage.removeItem("mkt_token"); };
export const getMktToken = () => _token;

async function api<T>(path: string, opts: RequestInit = {}): Promise<T> {
  if (isDemoMode()) return mktDemoResponse(path, opts) as T;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (_token) headers["Authorization"] = `Bearer ${_token}`;
  // Previously no timeout existed here at all -- a genuinely stalled
  // connection (not an error response, just no response ever) would
  // hang indefinitely regardless of any try/catch at the call site,
  // since neither resolve nor reject would ever fire.
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
    // Auth requests never silently fall back to demo/mock data on a
    // network failure — a login or registration is either real or it
    // isn't; pretending it worked (or didn't) against fake data is worse
    // than surfacing the real connection error and letting the person retry.
    const isAuthPath = path.startsWith("/api/auth/") || path.includes("/sellers/register");
    if (!isAuthPath && (err instanceof TypeError || (err instanceof Error && err.message.includes("fetch")))) {
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
  if (path.includes("/admin/customs-records/generate")) return mktMock.adminGenerateCustomsRecord(body);
  if (path.includes("/admin/customs-records") && method === "PATCH") return mktMock.adminUpdateCustomsRecord(path.split("/admin/customs-records/")[1], body);
  if (path.includes("/admin/customs-records"))   return mktMock.adminCustomsRecords();
  if (path.includes("/sellers") && path.includes("/supplier-orders")) return mktMock.sellerSupplierOrders(path.split("/sellers/")[1].split("/supplier-orders")[0]);
  if (path.includes("/sellers"))                 return mktMock.sellers();
  if (path.includes("/admin/stats"))             return mktMock.adminStats();
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
  place:  (body: unknown) => api<{ success: boolean; data: unknown; error?: string }>("/api/marketplace/orders", { method: "POST", body: JSON.stringify(body) }),
  cancel: (id: string) => api<{ success: boolean; data: unknown; error?: string }>(`/api/marketplace/orders/${id}/cancel`, { method: "POST" }),
  requestReturn: (id: string, reason: string) => api<{ success: boolean; data: unknown; error?: string }>(`/api/marketplace/orders/${id}/request-return`, { method: "POST", body: JSON.stringify({ reason }) }),
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
  customers: () => api<{ success: boolean; data: unknown[] }>("/api/marketplace/admin/customers"),
  reportUrl: (report: "orders" | "products") => `${BASE}/api/marketplace/admin/reports/${report}.csv`,
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
export const mktAuth = {
  login: async (username: string, password: string) => {
    const r = await api<{ success: boolean; data?: { token: string; user: MktAuthUser }; error?: string }>("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });
    if (r.success && r.data?.token) {
      const { token, user } = r.data;
      setMktToken(token);
      localStorage.setItem("mkt_user", JSON.stringify(user));
      // A plain login (unlike registration) doesn't come with the
      // seller/supplier record already in hand — look it up by role so
      // the app knows which store/supplier this account owns.
      if (user.role === "seller") {
        const sellerRes = await api<{ success: boolean; data: unknown }>(`/api/marketplace/sellers/by-user/${user.id}`);
        if (sellerRes.success) localStorage.setItem("mkt_seller", JSON.stringify(sellerRes.data));
      } else if (user.role === "supplier") {
        const supplierRes = await api<{ success: boolean; data: unknown }>(`/api/marketplace/suppliers/by-user/${user.id}`);
        if (supplierRes.success) localStorage.setItem("mkt_supplier", JSON.stringify(supplierRes.data));
      }
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
  registerSeller: async (body: { username: string; password: string; name: string; email: string; storeName: string; description?: string; phone?: string; taxId?: string; applicationData?: unknown }) => {
    const r = await mktSellers.register(body) as { success: boolean; token: string; user: MktAuthUser; seller: unknown; error?: string };
    if (r.success && r.token) { setMktToken(r.token); localStorage.setItem("mkt_user", JSON.stringify(r.user)); localStorage.setItem("mkt_seller", JSON.stringify(r.seller)); }
    return r;
  },
  logout: () => { setMktToken(null); localStorage.removeItem("mkt_user"); localStorage.removeItem("mkt_seller"); localStorage.removeItem("mkt_supplier"); },
  changePassword: (currentPassword: string, newPassword: string) =>
    api<{ success: boolean; message?: string; error?: string }>("/api/auth/change-password", { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) }),
  restoreSession: (): { user: MktAuthUser; seller: { id: string; storeName: string; status: string } | null; supplier: Record<string, unknown> | null } | null => {
    if (!getMktToken()) return null;
    const raw = localStorage.getItem("mkt_user");
    if (!raw) return null;
    try {
      const user = JSON.parse(raw) as MktAuthUser;
      const sellerRaw = localStorage.getItem("mkt_seller");
      const supplierRaw = localStorage.getItem("mkt_supplier");
      return { user, seller: sellerRaw ? JSON.parse(sellerRaw) : null, supplier: supplierRaw ? JSON.parse(supplierRaw) : null };
    } catch { return null; }
  },
};
