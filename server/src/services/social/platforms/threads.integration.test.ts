import { describe, it, expect, beforeAll, vi, afterEach } from "vitest";
import { createTestDb } from "../../../test/testDb";

const { pool } = createTestDb();
vi.mock("../../../db/pool", () => ({ pool, hasDb: true }));

const calls: string[] = [];
function fakeThreads(opts: { failAuth?: boolean } = {}) {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    const params = init?.body ? new URLSearchParams(String(init.body)) : u.searchParams;
    calls.push(`${init?.method ?? "GET"} ${u.pathname} ${params.get("media_type") ?? ""}`.trim());
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
    if (opts.failAuth) return json({ error: { message: "Error validating access token", code: 190 } }, 400);
    if (u.pathname === "/access_token") return json({ access_token: "long-lived", expires_in: 5184000 });
    if (u.pathname === "/v1.0/me") return json({ id: "42", username: "ballylife" });
    if (u.pathname === "/v1.0/42/threads") return json({ id: `c${calls.length}` });
    if (u.pathname === "/v1.0/42/threads_publish") return json({ id: "post-1" });
    if (/^\/v1\.0\/c\d+$/.test(u.pathname)) return json({ status: "FINISHED" });
    if (u.pathname === "/v1.0/post-1") return json({ permalink: "https://www.threads.net/@ballylife/post/abc" });
    return json({ error: { message: `unexpected ${u.pathname}` } }, 404);
  }));
}

const product = { id: "p", name: "Desk Fan", priceZar: 199, compareAtZar: null, description: "", url: "https://www.ballylife.com/product/p", images: ["https://x/0", "https://x/1"], category: null };

beforeAll(() => {
  process.env.THREADS_ACCESS_TOKEN = "short-lived";
  process.env.THREADS_APP_SECRET = "s";
  process.env.ALIEXPRESS_TOKEN_KEY ??= "k".repeat(64);
});
afterEach(() => { vi.unstubAllGlobals(); calls.length = 0; });

describe("Threads", () => {
  it("exchanges the token, posts a carousel and returns the link", async () => {
    fakeThreads();
    const { postToThreads, threadsPoster } = await import("./threads");
    expect(await threadsPoster.describe!()).toBe("@ballylife");
    const r = await postToThreads({ product, caption: "New in" });
    expect(r).toEqual({ externalId: "post-1", externalUrl: "https://www.threads.net/@ballylife/post/abc" });
    expect(calls).toContain("GET /access_token");
    expect(calls).toContain("POST /v1.0/42/threads CAROUSEL");
    expect(calls.filter(c => c === "POST /v1.0/42/threads IMAGE")).toHaveLength(2);
    const { rows } = await pool.query(`SELECT access_token_enc, expires_at FROM social_tokens WHERE platform = 'threads'`);
    expect(rows[0].access_token_enc).not.toContain("long-lived"); // stored encrypted
    expect(rows[0].expires_at).toBeTruthy();
  });

  it("a revoked token is not retried", async () => {
    fakeThreads({ failAuth: true });
    const { postToThreads } = await import("./threads");
    const { NonRetryable } = await import("./index");
    await expect(postToThreads({ product, caption: "x" })).rejects.toBeInstanceOf(NonRetryable);
  });
});
