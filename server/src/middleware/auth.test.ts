import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

describe("JWT_SECRET fail-fast behavior", () => {
  const originalSecret = process.env.MARKETPLACE_JWT_SECRET;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    delete process.env.MARKETPLACE_JWT_SECRET;
  });
  afterEach(() => {
    if (originalSecret === undefined) delete process.env.MARKETPLACE_JWT_SECRET;
    else process.env.MARKETPLACE_JWT_SECRET = originalSecret;
    process.env.NODE_ENV = originalNodeEnv;
    vi.resetModules();
  });

  it("throws at import time in production when MARKETPLACE_JWT_SECRET is missing -- never silently signs with the public dev fallback", async () => {
    process.env.NODE_ENV = "production";
    vi.resetModules();
    await expect(import("./auth")).rejects.toThrow(/MARKETPLACE_JWT_SECRET is not set/);
  });

  it("still starts in development with the dev-only fallback -- doesn't break local dev over this", async () => {
    process.env.NODE_ENV = "development";
    vi.resetModules();
    const { JWT_SECRET } = await import("./auth");
    expect(JWT_SECRET).toBe("ballylife-dev-secret-change-in-prod");
  });

  it("uses the real secret when it's actually set, in any environment", async () => {
    process.env.NODE_ENV = "production";
    process.env.MARKETPLACE_JWT_SECRET = "a-real-production-secret";
    vi.resetModules();
    const { JWT_SECRET } = await import("./auth");
    expect(JWT_SECRET).toBe("a-real-production-secret");
  });
});
