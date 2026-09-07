import express, { type Router } from "express";

/**
 * A minimal Express app for integration tests — body parsing only, none
 * of index.ts's rate limiting/CORS/helmet, since those aren't what a
 * route-behavior test is checking and would just make a test suite that
 * fires many requests flaky or slow. Mount whichever router(s) the test
 * file needs at the same base path production uses.
 */
export function buildTestApp(basePath: string, router: Router) {
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: true, limit: "2mb" }));
  app.use(basePath, router);
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error("[test app error]", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  });
  return app;
}
