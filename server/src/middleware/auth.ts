import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

// Own JWT secret — deliberately NOT shared with VINK-GRUP-LIMITED's
// middleware/auth.ts. A marketplace token must never be valid against
// Vink's backend, or vice versa; that's the whole point of separating
// these into two account systems. Set MARKETPLACE_JWT_SECRET in Railway.
//
// The insecure fallback below exists ONLY for local development
// (NODE_ENV !== "production"). In production, a missing secret throws
// at import time -- before app.listen() ever runs -- rather than
// silently signing tokens with a string that sits in this public repo.
// A silent fallback here would mean anyone who read this file on
// GitHub could forge a valid token for any role, including
// marketplace_admin, the moment this variable was ever accidentally
// unset. Confirmed via Railway's variable list before this was written
// that MARKETPLACE_JWT_SECRET is currently set in production, so this
// change does not change today's runtime behavior -- it only prevents
// a future misconfiguration from failing silently.
const rawJwtSecret = process.env.MARKETPLACE_JWT_SECRET;
if (!rawJwtSecret && process.env.NODE_ENV === "production") {
  throw new Error(
    "MARKETPLACE_JWT_SECRET is not set. Refusing to start in production with an insecure default JWT secret -- set it in Railway's environment variables."
  );
}
export const JWT_SECRET = rawJwtSecret ?? "ballylife-dev-secret-change-in-prod";
export const JWT_EXPIRES = "8h";

export interface MktAuthPayload {
  userId: string;
  username: string;
  role: "customer" | "seller" | "marketplace_admin" | "supplier" | "revenue_authority" | "shipping_company" | "credit_provider";
}

declare global {
  namespace Express {
    interface Request {
      user?: MktAuthPayload;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ success: false, error: "Missing or invalid Authorization header" });
    return;
  }
  try {
    const token = header.slice(7);
    const payload = jwt.verify(token, JWT_SECRET) as MktAuthPayload;
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ success: false, error: "Token expired or invalid" });
  }
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    try {
      req.user = jwt.verify(header.slice(7), JWT_SECRET) as MktAuthPayload;
    } catch {
      // Invalid/expired token on an optional-auth route — proceed as
      // logged-out rather than rejecting.
    }
  }
  next();
}

export function requireRole(...roles: MktAuthPayload["role"][]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ success: false, error: "Not authenticated" });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ success: false, error: "Insufficient privileges" });
      return;
    }
    next();
  };
}
