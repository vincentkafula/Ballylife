import { pool } from "../db/pool";

/**
 * Real CJdropshipping API v2.0 integration, verified against their own
 * docs (developers.cjdropshipping.com/en/api/api2/) before writing any
 * of this -- not guessed. Ships functional but inactive until real
 * credentials exist, same discipline as payfastProcessor.ts,
 * emailService.ts, and smsService.ts.
 *
 * Required env vars to actually connect:
 *   CJ_API_KEY -- "CJUserNum@api@...", from CJ's API authorization page (API Key type)
 *
 * getAccessToken is rate-limited to one call per 5 minutes on CJ's own
 * side, and the resulting access token is valid for up to 15 days
 * (their docs show conflicting numbers across pages -- 15 days in the
 * field-length table, 180 days in a separate MCP guide; this treats 15
 * days as the trustworthy figure since it's the one in the actual field
 * definition, and refreshes proactively rather than waiting to find out
 * which figure is real in production). The refresh token lasts 180
 * days. Both are cached in cj_dropshipping_auth (a single row) rather
 * than re-authenticating on every request, which the rate limit alone
 * makes a hard requirement, not just an optimization.
 */

// CJ's current getAccessToken takes the API key alone ("CJUserNum@api@...").
// Sending an email alongside it switches CJ to the retired email/password
// mode, which rejects the request -- so CJ_EMAIL is no longer used.
const CJ_API_KEY = process.env.CJ_API_KEY?.trim();
const BASE_URL = "https://developers.cjdropshipping.com/api2.0/v1";

export function isCjConfigured(): boolean {
  return Boolean(CJ_API_KEY);
}

// After a failed login, don't ask CJ again for a while: a wrong key won't
// fix itself, and hammering the auth endpoint every minute risks CJ
// throttling the account.
const AUTH_FAILURE_COOLDOWN_MS = 5 * 60 * 1000;
let lastAuthFailure: { at: number; message: string } | null = null;

interface CjApiResponse<T> {
  code: number;
  result: boolean;
  message: string;
  data: T;
  requestId: string;
}

async function fetchNewAccessToken(): Promise<string> {
  const res = await fetch(`${BASE_URL}/authentication/getAccessToken`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey: CJ_API_KEY }),
  });
  const json = (await res.json().catch(() => null)) as CjApiResponse<{
    accessToken: string; accessTokenExpiryDate: string; refreshToken: string; refreshTokenExpiryDate: string;
  }> | null;
  if (!res.ok || !json?.result) {
    const message = `CJ authentication failed: ${json?.message ?? res.status}`;
    lastAuthFailure = { at: Date.now(), message };
    throw new Error(message);
  }
  lastAuthFailure = null;
  const { accessToken, accessTokenExpiryDate, refreshToken, refreshTokenExpiryDate } = json.data;
  await pool!.query(
    `INSERT INTO cj_dropshipping_auth (id, access_token, access_token_expires_at, refresh_token, refresh_token_expires_at, updated_at)
     VALUES ('cj', $1, $2, $3, $4, now())
     ON CONFLICT (id) DO UPDATE SET access_token = $1, access_token_expires_at = $2, refresh_token = $3, refresh_token_expires_at = $4, updated_at = now()`,
    [accessToken, accessTokenExpiryDate, refreshToken, refreshTokenExpiryDate]
  );
  return accessToken;
}

async function refreshAccessToken(refreshToken: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/authentication/refreshAccessToken`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });
  const json = (await res.json()) as CjApiResponse<{
    accessToken: string; accessTokenExpiryDate: string; refreshToken: string; refreshTokenExpiryDate: string;
  }>;
  if (!res.ok || !json.result) throw new Error(`CJ token refresh failed: ${json.message ?? res.status}`);
  const { accessToken, accessTokenExpiryDate, refreshToken: newRefreshToken, refreshTokenExpiryDate } = json.data;
  await pool!.query(
    `UPDATE cj_dropshipping_auth SET access_token = $1, access_token_expires_at = $2, refresh_token = $3, refresh_token_expires_at = $4, updated_at = now() WHERE id = 'cj'`,
    [accessToken, accessTokenExpiryDate, newRefreshToken, refreshTokenExpiryDate]
  );
  return accessToken;
}

/**
 * The one function every other call in this file routes through --
 * returns a token that's genuinely valid right now, fetching a new one
 * (or refreshing) only when actually necessary, never on every call.
 * That's not just good practice here, it's required by CJ's own 5-
 * minute rate limit on the auth endpoint.
 */
async function getValidAccessToken(): Promise<string> {
  if (!isCjConfigured()) throw new Error("CJdropshipping is not configured — set CJ_API_KEY.");
  const { rows } = await pool!.query(`SELECT * FROM cj_dropshipping_auth WHERE id = 'cj'`);
  const cached = rows[0];
  const now = Date.now();

  if (cached?.access_token && cached.access_token_expires_at && new Date(cached.access_token_expires_at).getTime() > now) {
    return cached.access_token;
  }
  if (cached?.refresh_token && cached.refresh_token_expires_at && new Date(cached.refresh_token_expires_at).getTime() > now) {
    try {
      return await refreshAccessToken(cached.refresh_token);
    } catch {
      // Refresh token might genuinely be invalid despite not having
      // expired yet (revoked, account issue) -- fall through to a full
      // re-authentication rather than failing outright.
    }
  }
  if (lastAuthFailure && Date.now() - lastAuthFailure.at < AUTH_FAILURE_COOLDOWN_MS) {
    throw new Error(`${lastAuthFailure.message} (not retrying until ${new Date(lastAuthFailure.at + AUTH_FAILURE_COOLDOWN_MS).toISOString()})`);
  }
  return await fetchNewAccessToken();
}

export function _resetCjAuthStateForTests() { lastAuthFailure = null; }

// CJ enforces a per-account QPS limit (1 req/s on the base tier) and
// answers bursts with HTTP 429 or code 1600200. A product-page sync makes
// one detail call per product, so every request is spaced through one
// shared queue and rate-limit responses are retried with backoff rather
// than failing the whole sync.
const MIN_INTERVAL_MS = Number(process.env.CJ_MIN_REQUEST_INTERVAL_MS ?? 1100);
const MAX_RETRIES = 3;
let queue: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;

function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    lastRequestAt = Date.now();
    return fn();
  });
  queue = run.catch(() => undefined);
  return run;
}

function isRateLimited(status: number, json: Partial<CjApiResponse<unknown>> | null): boolean {
  return status === 429 || json?.code === 1600200 || /too many|too much request/i.test(json?.message ?? "");
}

/** A CJ API failure. `code` is CJ's own error code (or the HTTP status when there's no body). */
export class CjApiError extends Error {
  constructor(message: string, readonly code: number | null, readonly httpStatus: number) {
    super(message);
    this.name = "CjApiError";
  }
}

// ── API points ───────────────────────────────────────────────────────────
// CJ meters its API in points: 50,000/day base (+100 per USD of the largest
// monthly transaction amount in the last 3 months), replenished per minute
// (total / 1440), reset 00:00 UTC. Only some endpoints cost points
// (developers.cjdropshipping.cn .../standard/points.html); order placement
// and order status are free. Catalogue syncing is the big spender, so it
// draws from a local budget that refills at CJ_CATALOG_POINTS_PER_MIN --
// below CJ's own refill rate -- leaving headroom for order-time calls.
export const POINT_COSTS: Record<string, number> = {
  "/product/list": 50,
  "/product/listV2": 50,
  "/product/query": 10,
  "/logistic/freightCalculate": 10,
};

export type CjPurpose = "catalog" | "order";

const CATALOG_POINTS_PER_MIN = Number(process.env.CJ_CATALOG_POINTS_PER_MIN ?? 25);
const CATALOG_BUCKET_MAX = Number(process.env.CJ_CATALOG_POINTS_BUCKET ?? 3000);
let catalogBucket = CATALOG_BUCKET_MAX / 2;
let catalogBucketAt = Date.now();
let pausedUntil = 0; // set when CJ itself says we're out of points

function refillCatalogBucket() {
  const now = Date.now();
  catalogBucket = Math.min(CATALOG_BUCKET_MAX, catalogBucket + ((now - catalogBucketAt) / 60_000) * CATALOG_POINTS_PER_MIN);
  catalogBucketAt = now;
}

/** Thrown before calling CJ when the catalogue budget can't cover a call, or after CJ reports points exhausted. */
export class CjPointsError extends Error {
  constructor(message: string, readonly retryAt: Date) {
    super(message);
    this.name = "CjPointsError";
  }
}

export function isCjPointsError(err: unknown): err is CjPointsError {
  return err instanceof CjPointsError;
}

/** Points the catalogue budget currently holds (for progress displays / tests). */
export function catalogPointsAvailable(): number {
  refillCatalogBucket();
  return Math.floor(catalogBucket);
}

export function _setCatalogPointsForTests(points: number) { catalogBucket = points; catalogBucketAt = Date.now(); pausedUntil = 0; }

async function cjRequest<T>(method: "GET" | "POST" | "PATCH", path: string, opts: { params?: Record<string, string | undefined>; body?: unknown; purpose?: CjPurpose } = {}): Promise<T> {
  const cost = POINT_COSTS[path] ?? 0;
  if (cost > 0 && (opts.purpose ?? "catalog") === "catalog") {
    if (Date.now() < pausedUntil) throw new CjPointsError("Waiting for CJ API points to replenish.", new Date(pausedUntil));
    refillCatalogBucket();
    if (catalogBucket < cost) {
      const wait = ((cost - catalogBucket) / Math.max(1, CATALOG_POINTS_PER_MIN)) * 60_000;
      throw new CjPointsError("Catalogue sync is pacing itself to stay within CJ's daily API points.", new Date(Date.now() + wait));
    }
    catalogBucket -= cost;
  }

  const token = await getValidAccessToken();
  const url = new URL(`${BASE_URL}${path}`);
  if (opts.params) for (const [k, v] of Object.entries(opts.params)) if (v) url.searchParams.set(k, v);
  const init: RequestInit = {
    method,
    headers: { "CJ-Access-Token": token, ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}) },
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  };

  for (let attempt = 0; ; attempt++) {
    const res = await throttled(() => fetch(url.toString(), init));
    const json = (await res.json().catch(() => null)) as CjApiResponse<T> | null;
    if (isRateLimited(res.status, json) && attempt < MAX_RETRIES) {
      await new Promise(r => setTimeout(r, MIN_INTERVAL_MS * 2 ** (attempt + 1)));
      continue;
    }
    // Error text carries only CJ's message and the path -- never the token or full URL.
    if (!res.ok || !json?.result) {
      const message = json?.message ?? "";
      if (/insufficient api points/i.test(message)) {
        // "Used today: N, Remaining: R, Required: C" -- wait long enough for
        // CJ's per-minute refill to cover it, and hold all catalogue calls.
        const remaining = Number(/Remaining:\s*(\d+)/i.exec(message)?.[1] ?? 0);
        const required = Number(/Required:\s*(\d+)/i.exec(message)?.[1] ?? cost) || 50;
        const refillPerMin = 50_000 / 1440;
        pausedUntil = Date.now() + Math.max(5, Math.ceil((required * 20 - remaining) / refillPerMin)) * 60_000;
        catalogBucket = 0;
        throw new CjPointsError(`CJ API points exhausted for now (${path}).`, new Date(pausedUntil));
      }
      throw new CjApiError(`CJ API error (${path}): ${message || res.status}`, json?.code ?? null, res.status);
    }
    return json.data;
  }
}

function cjFetch<T>(path: string, params?: Record<string, string | undefined>): Promise<T> {
  return cjRequest<T>("GET", path, { params });
}

export interface CjProductSummary {
  pid: string; productName: string; productNameEn: string; productSku: string;
  productImage: string; productWeight: number; categoryId: string; categoryName: string;
  sellPrice: number; remark?: string;
}

export interface CjProductListResult {
  pageNum: number; pageSize: number; total: number; list: CjProductSummary[];
}

export function listCjProducts(params: {
  pageNum?: number; pageSize?: number; categoryId?: string; productType?: "ORDINARY_PRODUCT" | "SUPPLIER_PRODUCT"; productNameEn?: string;
} = {}): Promise<CjProductListResult> {
  return cjFetch<CjProductListResult>("/product/list", {
    pageNum: params.pageNum ? String(params.pageNum) : undefined,
    pageSize: params.pageSize ? String(params.pageSize) : undefined,
    categoryId: params.categoryId,
    productType: params.productType,
    productNameEn: params.productNameEn,
  });
}

// productImage on the detail endpoint is often a JSON-encoded string array
// rather than a single URL -- parse with parseSupplierImageList, never use raw.
export interface CjProductDetail extends Omit<CjProductSummary, "productImage"> {
  productImage?: string | string[];
  description?: string;
  productImageSet?: string[] | string;
  /** Returned only when requested with features=enable_video (see getCjProductDetail). */
  productVideo?: string[] | string;
  variants?: { vid: string; variantSku: string; variantSellPrice: number | string; variantImage?: string; variantNameEn?: string; variantKey?: string; inventories?: { countryCode?: string; totalInventory?: number }[] }[];
}

// CJ only includes a product's videos when asked (features=enable_video).
// If CJ ever rejects that parameter, stop sending it rather than failing
// every product sync -- videos are a bonus, the product data isn't.
let videoFeatureSupported = true;

export async function getCjProductDetail(pid: string): Promise<CjProductDetail> {
  if (videoFeatureSupported) {
    try {
      return await cjFetch<CjProductDetail>("/product/query", { pid, features: "enable_video" });
    } catch (err) {
      // Only a rejected parameter disables videos -- not an outage or a points pause.
      if (!(err instanceof CjApiError) || err.httpStatus >= 500) throw err;
      const plain = await cjFetch<CjProductDetail>("/product/query", { pid }); // throws if the product itself is the problem
      videoFeatureSupported = false;
      return plain;
    }
  }
  return cjFetch<CjProductDetail>("/product/query", { pid });
}

export interface CjCategory {
  categoryFirstName: string;
  categoryFirstList: { categorySecondName: string; categorySecondList: { categoryId: string; categoryName: string }[] }[];
}

export function getCjCategories(): Promise<CjCategory[]> {
  return cjFetch<CjCategory[]>("/product/getCategory");
}

// ── Orders & logistics ──────────────────────────────────────────────────
// Field names below are CJ's own, from developers.cjdropshipping.com
// (shopping.html / logistic.html), not guessed.

export interface CjFreightOption {
  logisticName: string; logisticPrice: number; logisticAging?: string; totalPostageFee?: number;
}

export function calculateCjFreight(body: {
  startCountryCode: string; endCountryCode: string; zip?: string; products: { vid: string; quantity: number }[];
}, purpose: CjPurpose = "catalog"): Promise<CjFreightOption[]> {
  return cjRequest<CjFreightOption[]>("POST", "/logistic/freightCalculate", { body, purpose });
}

export interface CjCreateOrderRequest {
  orderNumber: string;
  shippingCountryCode: string; shippingCountry: string; shippingProvince: string; shippingCity: string;
  shippingAddress: string; shippingAddress2?: string; shippingZip?: string; shippingPhone?: string;
  shippingCustomerName: string;
  logisticName: string; fromCountryCode: string;
  /** 2 = pay from CJ wallet balance immediately, 3 = create only (pay later in CJ's dashboard). */
  payType: 2 | 3;
  isSandbox?: 0 | 1;
  products: { vid: string; quantity: number }[];
}

export interface CjCreateOrderResult {
  orderId: string; orderNumber: string; orderStatus: string;
  orderAmount?: number; productAmount?: number; postageAmount?: number; actualPayment?: number;
  interceptOrderReasons?: { code?: string | number; message?: string }[];
}

export function createCjOrder(body: CjCreateOrderRequest): Promise<CjCreateOrderResult> {
  return cjRequest<CjCreateOrderResult>("POST", "/shopping/order/createOrderV2", { body });
}

export interface CjOrderDetail {
  orderId: string; orderNum?: string; cjOrderId?: string; orderStatus: string; subStatus?: string | null;
  trackNumber?: string | null; logisticName?: string | null; trackingUrl?: string | null;
  orderAmount?: number; productAmount?: number; postageAmount?: number;
}

/** Accepts either CJ's order id or our own order number (CJ looks up both). */
export function getCjOrderDetail(orderId: string): Promise<CjOrderDetail> {
  return cjRequest<CjOrderDetail>("GET", "/shopping/order/getOrderDetail", { params: { orderId } });
}
