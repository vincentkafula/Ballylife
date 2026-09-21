#!/usr/bin/env node
/**
 * A deliberately small, dependency-free load test -- no autocannon/k6/
 * artillery install needed, just Node's built-in fetch. Covers the two
 * endpoints that matter most for load: GET /api/marketplace/products
 * (the catalog, unauthenticated, the highest-volume path by far) and
 * POST /api/marketplace/orders (the money-moving path, rate-limited at
 * 30/min per IP as of Phase 3 -- this script respects that rather than
 * being surprised by a wall of 429s if run with more concurrency than
 * the limiter allows).
 *
 * SAFETY: defaults to http://localhost:3001, never production, unless
 * you explicitly pass --url pointing elsewhere. Running this against a
 * live Railway deployment costs real money (Railway bills by usage) and
 * could affect real traffic -- do that deliberately, not by accident.
 *
 * Usage:
 *   node scripts/loadtest.mjs [--url http://localhost:3001] [--concurrency 10] [--requests 200] [--endpoint products|orders]
 *
 * Orders load-testing needs a real Bearer token (a real order can't be
 * created anonymously) -- pass one with --token, or that endpoint is
 * skipped with a clear message rather than silently doing nothing.
 */

const args = process.argv.slice(2);
function argValue(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
}

const BASE_URL = argValue("url", "http://localhost:3001");
const CONCURRENCY = Number(argValue("concurrency", "10"));
const TOTAL_REQUESTS = Number(argValue("requests", "200"));
const ENDPOINT = argValue("endpoint", "products"); // "products" | "orders"
const TOKEN = argValue("token", null);

if (BASE_URL.includes("railway.app") || BASE_URL.includes("up.railway.app")) {
  console.log(`⚠️  Target is a live Railway URL (${BASE_URL}). This costs real usage and may affect real traffic.`);
  console.log("   Re-run with an explicit --confirm-production flag to proceed, or point --url at a local stack.");
  if (!args.includes("--confirm-production")) process.exit(1);
}

async function runOne() {
  const start = performance.now();
  try {
    let res;
    if (ENDPOINT === "products") {
      res = await fetch(`${BASE_URL}/api/marketplace/products?limit=12`);
    } else if (ENDPOINT === "orders") {
      if (!TOKEN) throw new Error("orders load test needs --token (a real Bearer token) -- skipping this request");
      res = await fetch(`${BASE_URL}/api/marketplace/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({ paymentMethod: "payfast" }),
      });
    } else {
      throw new Error(`Unknown --endpoint "${ENDPOINT}" -- use "products" or "orders"`);
    }
    const ms = performance.now() - start;
    return { ok: res.ok, status: res.status, ms };
  } catch (err) {
    return { ok: false, status: 0, ms: performance.now() - start, error: err instanceof Error ? err.message : String(err) };
  }
}

async function main() {
  console.log(`Load testing ${ENDPOINT} at ${BASE_URL} — ${TOTAL_REQUESTS} requests, concurrency ${CONCURRENCY}`);
  const results = [];
  let inFlight = 0;
  let launched = 0;

  await new Promise((resolve) => {
    function launchNext() {
      if (launched >= TOTAL_REQUESTS) {
        if (inFlight === 0) resolve();
        return;
      }
      launched++;
      inFlight++;
      runOne().then((r) => {
        results.push(r);
        inFlight--;
        launchNext();
      });
    }
    for (let i = 0; i < CONCURRENCY; i++) launchNext();
  });

  const durations = results.map((r) => r.ms).sort((a, b) => a - b);
  const p50 = durations[Math.floor(durations.length * 0.5)];
  const p95 = durations[Math.floor(durations.length * 0.95)];
  const p99 = durations[Math.floor(durations.length * 0.99)];
  const successCount = results.filter((r) => r.ok).length;
  const statusCounts = {};
  for (const r of results) statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;

  console.log(`\nResults (${results.length} requests):`);
  console.log(`  Success: ${successCount}/${results.length} (${((successCount / results.length) * 100).toFixed(1)}%)`);
  console.log(`  Status codes:`, statusCounts);
  console.log(`  Latency — p50: ${p50?.toFixed(0)}ms, p95: ${p95?.toFixed(0)}ms, p99: ${p99?.toFixed(0)}ms`);
  const errors = results.filter((r) => r.error);
  if (errors.length) console.log(`  Errors (first 3): ${errors.slice(0, 3).map((e) => e.error).join(" | ")}`);
}

main();
