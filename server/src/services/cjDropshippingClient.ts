import { pool } from "../db/pool";

/**
 * Real CJdropshipping API v2.0 integration, verified against their own
 * docs (developers.cjdropshipping.com/en/api/api2/) before writing any
 * of this -- not guessed. Ships functional but inactive until real
 * credentials exist, same discipline as payfastProcessor.ts,
 * emailService.ts, and smsService.ts.
 *
 * Required env vars to actually connect:
 *   CJ_EMAIL   -- the email on your CJdropshipping account
 *   CJ_API_KEY -- generated from your CJ account settings
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

const CJ_EMAIL = process.env.CJ_EMAIL;
const CJ_API_KEY = process.env.CJ_API_KEY;
const BASE_URL = "https://developers.cjdropshipping.com/api2.0/v1";

export function isCjConfigured(): boolean {
  return Boolean(CJ_EMAIL && CJ_API_KEY);
}

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
    body: JSON.stringify({ email: CJ_EMAIL, apiKey: CJ_API_KEY }),
  });
  const json = (await res.json()) as CjApiResponse<{
    accessToken: string; accessTokenExpiryDate: string; refreshToken: string; refreshTokenExpiryDate: string;
  }>;
  if (!res.ok || !json.result) throw new Error(`CJ authentication failed: ${json.message ?? res.status}`);
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
  if (!isCjConfigured()) throw new Error("CJdropshipping is not configured — set CJ_EMAIL and CJ_API_KEY.");
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
  return await fetchNewAccessToken();
}

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

async function cjFetch<T>(path: string, params?: Record<string, string | undefined>): Promise<T> {
  const token = await getValidAccessToken();
  const url = new URL(`${BASE_URL}${path}`);
  if (params) for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, v);

  for (let attempt = 0; ; attempt++) {
    const res = await throttled(() => fetch(url.toString(), { headers: { "CJ-Access-Token": token } }));
    const json = (await res.json().catch(() => null)) as CjApiResponse<T> | null;
    if (isRateLimited(res.status, json) && attempt < MAX_RETRIES) {
      await new Promise(r => setTimeout(r, MIN_INTERVAL_MS * 2 ** (attempt + 1)));
      continue;
    }
    // Error text carries only CJ's message and the path -- never the token or full URL.
    if (!res.ok || !json?.result) throw new Error(`CJ API error (${path}): ${json?.message ?? res.status}`);
    return json.data;
  }
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
  variants?: { vid: string; variantSku: string; variantSellPrice: number; variantImage?: string; variantNameEn?: string }[];
}

export function getCjProductDetail(pid: string): Promise<CjProductDetail> {
  return cjFetch<CjProductDetail>("/product/query", { pid });
}

export interface CjCategory {
  categoryFirstName: string;
  categoryFirstList: { categorySecondName: string; categorySecondList: { categoryId: string; categoryName: string }[] }[];
}

export function getCjCategories(): Promise<CjCategory[]> {
  return cjFetch<CjCategory[]>("/product/getCategory");
}
