import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

import authRouter from "./routes/authRouter";
import marketplaceRouter from "./routes/marketplaceRouter";
import { migrate } from "./db/migrate";
import { hasDb } from "./db/pool";

const app = express();
const PORT = Number(process.env.PORT) || 3001;

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
app.use(rateLimit({ windowMs: 60_000, max: 300, standardHeaders: true, legacyHeaders: false }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok", db: hasDb, service: "ballylife-backend" });
});

app.use("/api/auth", authRouter);
app.use("/api/marketplace", marketplaceRouter);

app.use((_req, res) => {
  res.status(404).json({ success: false, error: "Not found" });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[error]", err);
  res.status(500).json({ success: false, error: "Internal server error" });
});

async function start() {
  if (!hasDb) {
    console.error("[fatal] DATABASE_URL is not set. Set it in Railway's environment variables — this backend has no in-memory fallback mode.");
    process.exit(1);
  }
  await migrate();
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
