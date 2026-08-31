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
    if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
    return j;
  } catch (err) {
    if (err instanceof TypeError || (err instanceof Error && err.message.includes("fetch"))) {
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
  if (path.match(/\/products\/[^/?]+$/) && !path.includes("reviews") && method === "GET") return mktMock.productById(path.split("/products/")[1].split("?")[0]);
  if (path.includes("/products") && method === "GET") return mktMock.products(qs);
  if (path.includes("/reviews") && method === "POST") return mktMock.addReview(body);
  if (path.includes("/reviews"))                 return mktMock.reviews(path.split("/products/")[1]?.split("/")[0] ?? "");
  if (path.includes("/cart") && method === "GET")      return mktMock.cart();
  if (path.includes("/cart") && path.includes("/add")) return mktMock.addToCart(body);
  if (path.includes("/cart") && path.includes("/coupon")) return mktMock.applyCoupon(body.code);
  if (path.includes("/cart") && method === "PATCH")    return mktMock.updateCartItem(body);
  if (path.includes("/cart") && method === "DELETE")   return mktMock.removeCartItem(path.split("/item/")[1]);
  if (path.includes("/orders") && method === "POST")   return mktMock.placeOrder(body);
  if (path.includes("/orders"))                  return mktMock.orders();
  if (path.includes("/wishlist") && method === "POST")   return { success: true, message: "Added to wishlist" };
  if (path.includes("/wishlist") && method === "DELETE") return { success: true };
  if (path.includes("/wishlist"))                return mktMock.wishlist();
  if (path.includes("/sellers") && path.includes("/analytics")) return mktMock.sellerAnalytics();
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
};

export const mktAddresses = (userId: string) =>
  api<{ success: boolean; data: unknown[] }>(`/api/marketplace/addresses/${userId}`);
export const mktAddAddress = (userId: string, body: unknown) =>
  api<{ success: boolean; data: unknown }>(`/api/marketplace/addresses/${userId}`, { method: "POST", body: JSON.stringify(body) });
export const mktDeleteAddress = (userId: string, addressId: string) =>
  api(`/api/marketplace/addresses/${userId}/${addressId}`, { method: "DELETE" });

export const mktCustomer = {
  stats:    (userId: string) => api<{ success: boolean; data: unknown }>(`/api/marketplace/customers/${userId}/stats`),
  spending: (userId: string) => api<{ success: boolean; data: unknown }>(`/api/marketplace/customers/${userId}/spending`),
};

// ── Marketplace auth (separate from the site's admin login) ─────────────────
export interface MktAuthUser { id: string; username: string; name: string; email: string; role: string; }
export const mktAuth = {
  login: async (username: string, password: string) => {
    const r = await api<{ success: boolean; token: string; user: MktAuthUser; error?: string }>("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });
    if (r.success && r.token) { setMktToken(r.token); localStorage.setItem("mkt_user", JSON.stringify(r.user)); }
    return r;
  },
  registerCustomer: async (body: { username: string; password: string; name: string; email: string }) => {
    const r = await api<{ success: boolean; token: string; user: MktAuthUser; error?: string }>("/api/auth/register", { method: "POST", body: JSON.stringify({ ...body, role: "customer" }) });
    if (r.success && r.token) { setMktToken(r.token); localStorage.setItem("mkt_user", JSON.stringify(r.user)); }
    return r;
  },
  registerSeller: async (body: { username: string; password: string; name: string; email: string; storeName: string; description?: string; phone?: string; taxId?: string; applicationData?: unknown }) => {
    const r = await mktSellers.register(body) as { success: boolean; token: string; user: MktAuthUser; seller: unknown; error?: string };
    if (r.success && r.token) { setMktToken(r.token); localStorage.setItem("mkt_user", JSON.stringify(r.user)); localStorage.setItem("mkt_seller", JSON.stringify(r.seller)); }
    return r;
  },
  logout: () => { setMktToken(null); localStorage.removeItem("mkt_user"); localStorage.removeItem("mkt_seller"); },
  changePassword: (currentPassword: string, newPassword: string) =>
    api<{ success: boolean; message?: string; error?: string }>("/api/auth/change-password", { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) }),
  restoreSession: (): { user: MktAuthUser; seller: { id: string; storeName: string; status: string } | null } | null => {
    if (!getMktToken()) return null;
    const raw = localStorage.getItem("mkt_user");
    if (!raw) return null;
    try {
      const user = JSON.parse(raw) as MktAuthUser;
      const sellerRaw = localStorage.getItem("mkt_seller");
      return { user, seller: sellerRaw ? JSON.parse(sellerRaw) : null };
    } catch { return null; }
  },
};
