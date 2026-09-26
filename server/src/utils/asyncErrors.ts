/**
 * Express 4 doesn't catch errors thrown inside async route handlers: a
 * rejected promise escapes to the process and, on Node 15+, crashes the whole
 * server -- one broken page takes the site down for everyone. This wraps
 * every registered route handler so a rejection goes to Express's error
 * handler (a 500 for that one request) instead.
 *
 * Call once, after every router is mounted.
 */
import type { Express, Request, Response, NextFunction } from "express";

type Handler = (req: Request, res: Response, next: NextFunction) => unknown;
interface Layer { handle: Handler & { stack?: Layer[] }; route?: { stack: Layer[] }; name?: string }

function wrap(fn: Handler): Handler {
  if ((fn as { __asyncSafe?: boolean }).__asyncSafe || fn.length > 3) return fn; // already wrapped, or an error handler
  const wrapped: Handler = (req, res, next) => {
    try {
      const out = fn(req, res, next);
      if (out && typeof (out as Promise<unknown>).catch === "function") (out as Promise<unknown>).catch(next);
      return out;
    } catch (err) {
      next(err);
    }
  };
  (wrapped as { __asyncSafe?: boolean }).__asyncSafe = true;
  return wrapped;
}

function walk(stack: Layer[] | undefined): number {
  let n = 0;
  for (const layer of stack ?? []) {
    if (layer.route) {
      for (const l of layer.route.stack) { l.handle = wrap(l.handle); n++; }
    } else if (layer.name === "router" && layer.handle.stack) {
      n += walk(layer.handle.stack);
    } else if (typeof layer.handle === "function" && layer.handle.length <= 3) {
      layer.handle = wrap(layer.handle);
    }
  }
  return n;
}

export function catchAsyncErrors(app: Express): number {
  return walk((app as unknown as { _router?: { stack: Layer[] } })._router?.stack);
}
