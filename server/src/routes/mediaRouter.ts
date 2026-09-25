import { Router, Request, Response } from "express";
import { pool } from "../db/pool";
import { isSupplierImageUrl, MAX_PRODUCT_IMAGES } from "../utils/supplierWhiteLabel";
import { logger } from "../utils/logger";

/**
 * Serves supplier product photos from our own domain so the storefront,
 * seller dashboard and network tab only ever see
 * /api/marketplace/media/{p|c}/{id}/{index} -- never the supplier CDN URL
 * stored in the row (see utils/supplierWhiteLabel.ts).
 *
 * Mounted ahead of the global per-IP rate limiter in index.ts: a single
 * category page can legitimately pull 40+ images, and many African mobile
 * networks put thousands of shoppers behind one carrier-grade NAT IP.
 * Responses are browser-cacheable and also held in a small in-process
 * cache so repeat views don't re-hit the supplier CDN.
 */

const router: ReturnType<typeof Router> = Router();

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const CACHE_BUDGET_BYTES = Number(process.env.MEDIA_CACHE_BYTES) || 64 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 10_000;

// Insertion-ordered Map as a simple LRU: re-inserting on hit moves an entry to the end.
const cache = new Map<string, { body: Buffer; contentType: string }>();
let cacheBytes = 0;

function cacheGet(key: string) {
  const hit = cache.get(key);
  if (hit) { cache.delete(key); cache.set(key, hit); }
  return hit;
}

function cachePut(key: string, entry: { body: Buffer; contentType: string }) {
  if (entry.body.length > CACHE_BUDGET_BYTES / 4) return;
  cache.set(key, entry);
  cacheBytes += entry.body.length;
  for (const [k, v] of cache) {
    if (cacheBytes <= CACHE_BUDGET_BYTES) break;
    cache.delete(k);
    cacheBytes -= v.body.length;
  }
}

export function _clearMediaCacheForTests() { cache.clear(); cacheBytes = 0; }

router.get("/media/:kind/:id/:index", async (req: Request, res: Response): Promise<void> => {
  const { kind, id } = req.params;
  const index = Number(req.params.index);
  if ((kind !== "p" && kind !== "c") || !Number.isInteger(index) || index < 0 || index >= MAX_PRODUCT_IMAGES || !/^[0-9a-f-]{36}$/i.test(id)) {
    res.status(404).end(); return;
  }

  const table = kind === "p" ? "mkt_products" : "mkt_supplier_products";
  const { rows } = await pool!.query(`SELECT images FROM ${table} WHERE id::text = $1`, [id]);
  const images = rows[0]?.images;
  const url = Array.isArray(images) ? images[index] : undefined;
  // SSRF guard: only ever proxy the supplier CDN hosts, never an arbitrary URL.
  if (!isSupplierImageUrl(url)) { res.status(404).end(); return; }

  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin"); // storefront is served from a different Railway origin
  res.setHeader("X-Content-Type-Options", "nosniff");
  const CACHEABLE = "public, max-age=86400, stale-while-revalidate=604800";

  const cached = cacheGet(url);
  if (cached) { res.setHeader("Cache-Control", CACHEABLE); res.type(cached.contentType).send(cached.body); return; }

  try {
    // Follow redirects by hand so every hop is re-checked against the allowlist.
    let target = url;
    let upstream = await fetch(target, { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS), redirect: "manual" });
    for (let hop = 0; hop < 3 && upstream.status >= 300 && upstream.status < 400; hop++) {
      const next = new URL(upstream.headers.get("location") ?? "", target).toString();
      if (!isSupplierImageUrl(next)) break;
      target = next;
      upstream = await fetch(target, { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS), redirect: "manual" });
    }
    const contentType = upstream.headers.get("content-type") ?? "";
    const declaredLength = Number(upstream.headers.get("content-length") ?? 0);
    if (!upstream.ok || !contentType.startsWith("image/") || declaredLength > MAX_IMAGE_BYTES) {
      logger.warn("media.upstream_rejected", { kind, id, index, status: upstream.status, contentType });
      res.status(502).end(); return;
    }
    const body = Buffer.from(await upstream.arrayBuffer());
    if (body.length > MAX_IMAGE_BYTES) { res.status(502).end(); return; }
    cachePut(url, { body, contentType });
    res.setHeader("Cache-Control", CACHEABLE);
    res.type(contentType).send(body);
  } catch (err) {
    // Deliberately not logging the upstream URL -- logs are shared more widely than the DB.
    logger.warn("media.upstream_failed", { kind, id, index, error: err instanceof Error ? err.name : String(err) });
    res.status(502).end();
  }
});

export default router;
