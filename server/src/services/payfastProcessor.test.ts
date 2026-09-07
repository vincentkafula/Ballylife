import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "crypto";

// payfastProcessor.ts reads PAYFAST_PASSPHRASE (and friends) from
// process.env at module load time, not per-call — so each test that
// needs a specific passphrase resets the module registry and imports it
// fresh after setting the env var, rather than mutating a value the
// already-loaded module baked in at import time.
async function freshPayfastModule(env: Record<string, string>) {
  vi.resetModules();
  const prevEnv = { ...process.env };
  Object.assign(process.env, env);
  const mod = await import("./payfastProcessor");
  process.env = prevEnv;
  return mod;
}

// Mirrors payfastProcessor's own pfSignature exactly, so the test can
// build a "genuine" signature to check against without importing a
// private function — this is deliberately a second, independent
// implementation of the same MD5 recipe, so the test can't pass just
// because it shares a bug with the code under test.
function referenceSignature(params: Record<string, string>, passphrase?: string): string {
  const pairs = Object.entries(params)
    .filter(([k, v]) => k !== "signature" && v !== undefined && v !== null && String(v).trim() !== "")
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v).trim()).replace(/%20/g, "+")}`);
  let str = pairs.join("&");
  if (passphrase) str += `&passphrase=${encodeURIComponent(passphrase.trim()).replace(/%20/g, "+")}`;
  return crypto.createHash("md5").update(str).digest("hex");
}

describe("verifyItnSignature", () => {
  it("accepts a correctly-signed notification", async () => {
    const { verifyItnSignature } = await freshPayfastModule({ PAYFAST_PASSPHRASE: "test-passphrase" });
    const body = { m_payment_id: "pf_order123", payment_status: "COMPLETE", amount_gross: "199.00" };
    const signed = { ...body, signature: referenceSignature(body, "test-passphrase") };
    expect(verifyItnSignature(signed)).toBe(true);
  });

  it("rejects a notification with a tampered field (amount changed after signing)", async () => {
    const { verifyItnSignature } = await freshPayfastModule({ PAYFAST_PASSPHRASE: "test-passphrase" });
    const body = { m_payment_id: "pf_order123", payment_status: "COMPLETE", amount_gross: "199.00" };
    const signature = referenceSignature(body, "test-passphrase");
    const tampered = { ...body, amount_gross: "999.00", signature }; // attacker raises the amount after the fact
    expect(verifyItnSignature(tampered)).toBe(false);
  });

  it("rejects a notification with no signature field at all", async () => {
    const { verifyItnSignature } = await freshPayfastModule({ PAYFAST_PASSPHRASE: "test-passphrase" });
    expect(verifyItnSignature({ m_payment_id: "pf_order123" })).toBe(false);
  });

  it("rejects a signature computed with the wrong passphrase", async () => {
    const { verifyItnSignature } = await freshPayfastModule({ PAYFAST_PASSPHRASE: "correct-passphrase" });
    const body = { m_payment_id: "pf_order123", payment_status: "COMPLETE" };
    const signed = { ...body, signature: referenceSignature(body, "wrong-passphrase") };
    expect(verifyItnSignature(signed)).toBe(false);
  });
});

describe("confirmWithPayfast", () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  it("returns true when PayFast's validate endpoint echoes VALID", async () => {
    global.fetch = vi.fn().mockResolvedValue({ text: () => Promise.resolve("VALID") }) as unknown as typeof fetch;
    const { confirmWithPayfast } = await freshPayfastModule({});
    expect(await confirmWithPayfast("m_payment_id=pf_order123&signature=abc")).toBe(true);
  });

  it("returns false when PayFast's validate endpoint echoes INVALID", async () => {
    global.fetch = vi.fn().mockResolvedValue({ text: () => Promise.resolve("INVALID") }) as unknown as typeof fetch;
    const { confirmWithPayfast } = await freshPayfastModule({});
    expect(await confirmWithPayfast("m_payment_id=pf_order123&signature=abc")).toBe(false);
  });

  it("returns false (not a thrown error) if the network call itself fails", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch;
    const { confirmWithPayfast } = await freshPayfastModule({});
    await expect(confirmWithPayfast("m_payment_id=pf_order123")).resolves.toBe(false);
  });
});

describe("payfastProcessor.isConfigured", () => {
  it("is false when merchant credentials are missing", async () => {
    const { payfastProcessor } = await freshPayfastModule({ PAYFAST_MERCHANT_ID: "", PAYFAST_MERCHANT_KEY: "" });
    expect(payfastProcessor.isConfigured()).toBe(false);
  });

  it("is true once merchant id/key and both public URLs are set", async () => {
    const { payfastProcessor } = await freshPayfastModule({
      PAYFAST_MERCHANT_ID: "10000100", PAYFAST_MERCHANT_KEY: "46f0cd694581a",
      MARKETPLACE_PUBLIC_URL: "https://example.com", MARKETPLACE_API_PUBLIC_URL: "https://api.example.com",
    });
    expect(payfastProcessor.isConfigured()).toBe(true);
  });
});
