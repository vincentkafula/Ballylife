import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

import authRouter from "./routes/authRouter";
import marketplaceRouter from "./routes/marketplaceRouter";
import geoRouter from "./routes/geoRouter";
import sitemapRouter from "./routes/sitemapRouter";
import reconciliationRouter from "./routes/reconciliationRouter";
import cjDropshippingRouter from "./routes/cjDropshippingRouter";
import mediaRouter from "./routes/mediaRouter";
import programmesRouter from "./routes/programmesRouter";
import { startCjFulfillmentWorker } from "./services/cjFulfillment";
import { startCjCatalogWorker, enforceCjOnlyCatalog, tidyCatalogOnce } from "./services/cjCatalog";
import { cjOnlyCatalog } from "./utils/catalogPolicy";
import { startFxRefreshWorker } from "./services/fxRates";
import { secureDemoAccounts } from "./services/demoAccounts";
import { startProgrammesWorker } from "./services/programmes";
import { migrate } from "./db/migrate";
import { hasDb, pool } from "./db/pool";
import { logger } from "./utils/logger";

const app = express();
const PORT = Number(process.env.PORT) || 3001;

// Railway (and most PaaS hosts) sit the app behind a reverse proxy --
// without this, req.ip always reflects the proxy's own internal
// address rather than the real visitor's, which silently breaks
// IP-based geolocation (every request looks like it's coming from a
// private IP and falls back to the default country).
app.set("trust proxy", 1);

// ── CORS ────────────────────────────────────────────────────────────────
// Set MARKETPLACE_ALLOWED_ORIGINS (comma-separated) in Railway to the
// marketplace frontend's deployed URL(s). Falls back to allowing
// localhost dev origins only, so a misconfigured deploy fails closed
// (rejects unknown origins) rather than open.
const allowedOrigins = (process.env.MARKETPLACE_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true; // same-origin / server-to-server requests
  if (origin.startsWith("http://localhost") || origin.startsWith("http://127.0.0.1")) return true;
  return allowedOrigins.includes(origin);
}

app.use(helmet());
app.use(cors({ origin: (origin, cb) => cb(null, isAllowedOrigin(origin)), credentials: true }));
app.use(express.json({ limit: "2mb" }));
// PayFast's ITN webhook posts form-urlencoded, not JSON, and its own
// validate callback (payfastProcessor.confirmWithPayfast) needs the exact
// raw body PayFast sent, not a reconstruction from the parsed object —
// the verify callback stashes it on the request before parsing.
app.use(express.urlencoded({
  extended: true, limit: "2mb",
  verify: (req, _res, buf) => { (req as express.Request & { rawBody?: string }).rawBody = buf.toString("utf8"); },
}));
// Product-photo proxy sits ahead of the general limiter -- see mediaRouter.ts.
app.use("/api/marketplace", mediaRouter);
app.use(rateLimit({ windowMs: 60_000, max: 300, standardHeaders: true, legacyHeaders: false }));
// Auth endpoints get a tighter limit on top of the general one above —
// 300/min was generous enough to make credential-stuffing/brute-force
// login attempts cheap; this caps login/register attempts specifically.
app.use("/api/auth", rateLimit({ windowMs: 60_000, max: 20, standardHeaders: true, legacyHeaders: false }));
// Same limit for the account-creating routes that live under /api/marketplace
// (seller, supplier, shipping-company, credit-provider sign-up).
app.use(/^\/api\/marketplace\/[a-z-]+\/register$/, rateLimit({ windowMs: 60_000, max: 20, standardHeaders: true, legacyHeaders: false }));

const startedAt = Date.now();
app.get("/health", async (_req, res) => {
  // Deliberately still always 200 -- this endpoint doubles as Railway's
  // own container healthcheck (server/Dockerfile's HEALTHCHECK), and
  // changing that to fail on a transient DB blip risks an unwanted
  // restart loop rather than the observability improvement this is
  // meant to be. dbReachable is enrichment for a human or monitoring
  // tool to read, not a signal for the orchestrator to act on.
  let dbReachable = false;
  if (hasDb && pool) {
    try {
      await pool.query("SELECT 1");
      dbReachable = true;
    } catch {
      dbReachable = false;
    }
  }
  res.json({
    status: "ok", db: hasDb, dbReachable, service: "ballylife-backend",
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    timestamp: new Date().toISOString(),
  });
});

app.use("/api/auth", authRouter);
app.use("/api/marketplace", marketplaceRouter);
app.use("/api/marketplace", reconciliationRouter);
app.use("/api/marketplace", cjDropshippingRouter);
app.use("/api/marketplace", programmesRouter);
app.use("/api", geoRouter);
// Mounted at root, not under /api -- sitemaps are conventionally fetched
// from a site's own domain root; referenced this way (cross-domain, from
// the frontend's robots.txt) since this service and the frontend are
// separate Railway services on separate domains. See sitemapRouter.ts.
app.use("/", sitemapRouter);

app.use((_req, res) => {
  res.status(404).json({ success: false, error: "Not found" });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error("http.unhandled_error", { method: req.method, path: req.path, error: err instanceof Error ? err.message : String(err) });
  res.status(500).json({ success: false, error: "Internal server error" });
});

async function start() {
  if (!hasDb) {
    console.error("[fatal] DATABASE_URL is not set. Set it in Railway's environment variables — this backend has no in-memory fallback mode.");
    process.exit(1);
  }
  await migrate();
  startCjFulfillmentWorker();
  await secureDemoAccounts().catch(err => logger.error("security.demo_check_failed", { error: err instanceof Error ? err.message : String(err) }));
  if (cjOnlyCatalog()) await enforceCjOnlyCatalog();
  // Background: a few thousand small updates shouldn't hold up startup.
  void tidyCatalogOnce().catch(err => logger.error("catalog.tidy_failed", { error: err instanceof Error ? err.message : String(err) }));
  startCjCatalogWorker();
  startFxRefreshWorker();
  startProgrammesWorker();
  app.listen(PORT, () => {
    console.log(`Ballylife backend listening on port ${PORT}`);
    console.log(`  Health → http://localhost:${PORT}/health`);
    console.log(`  API    → http://localhost:${PORT}/api`);
  });
}

start().catch((err) => {
  console.error("[fatal] Failed to start:", err);
  process.exit(1);
});
