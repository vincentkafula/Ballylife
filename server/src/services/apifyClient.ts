/**
 * Runs an Apify Actor and returns its dataset items -- server-side only,
 * with APIFY_API_TOKEN in the Authorization header (never a URL or a log).
 *
 * Uses a normal (asynchronous) run plus polling rather than
 * run-sync-get-dataset-items, which Apify caps at 300 seconds: a
 * multi-keyword search can take longer than that.
 */
const APIFY_BASE = "https://api.apify.com/v2";
const WAIT_SECS = 60; // Apify holds each status request open up to this long

export function isApifyConfigured(): boolean {
  return Boolean(process.env.APIFY_API_TOKEN?.trim());
}

export class ApifyError extends Error {
  constructor(message: string, readonly kind: "config" | "http" | "blocked" | "timeout" | "run_failed" | "bad_response", readonly status?: number) {
    super(message);
  }
}

async function call(path: string, init: RequestInit = {}): Promise<unknown> {
  const token = process.env.APIFY_API_TOKEN?.trim();
  if (!token) throw new ApifyError("APIFY_API_TOKEN is not set", "config");
  let res: Response;
  try {
    res = await fetch(`${APIFY_BASE}${path}`, {
      ...init,
      headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout((WAIT_SECS + 30) * 1000),
    });
  } catch (err) {
    throw new ApifyError(`Apify request failed: ${err instanceof Error ? err.message : String(err)}`, "http");
  }
  const text = await res.text();
  if (!res.ok) {
    let detail = text.slice(0, 300);
    try { detail = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? detail; } catch { /* keep text */ }
    throw new ApifyError(`Apify ${res.status}: ${detail}`, /block|captcha|forbidden|denied/i.test(detail) ? "blocked" : "http", res.status);
  }
  try { return JSON.parse(text); } catch { throw new ApifyError(`Apify returned non-JSON: ${text.slice(0, 200)}`, "bad_response"); }
}

interface ApifyRun { id: string; status: string; statusMessage?: string | null; defaultDatasetId: string }

export interface ApifyResult { runId: string; items: Record<string, unknown>[] }

export async function runApifyActor(actorId: string, input: unknown, opts: { maxWaitMs?: number } = {}): Promise<ApifyResult> {
  const maxWaitMs = opts.maxWaitMs ?? 20 * 60_000;
  const started = Date.now();
  const actor = actorId.replace("/", "~");
  let run = ((await call(`/acts/${actor}/runs?waitForFinish=${WAIT_SECS}`, { method: "POST", body: JSON.stringify(input) })) as { data?: ApifyRun }).data;
  if (!run?.id) throw new ApifyError("Apify didn't return a run", "bad_response");

  while (run.status === "READY" || run.status === "RUNNING") {
    if (Date.now() - started > maxWaitMs) {
      throw new ApifyError(`Run ${run.id} still ${run.status} after ${Math.round(maxWaitMs / 60_000)} min -- check it on Apify`, "timeout");
    }
    run = ((await call(`/actor-runs/${run.id}?waitForFinish=${WAIT_SECS}`)) as { data: ApifyRun }).data;
  }
  if (run.status !== "SUCCEEDED") {
    const msg = run.statusMessage ?? "";
    throw new ApifyError(`Actor run ${run.status}${msg ? `: ${msg}` : ""} (run ${run.id})`, /block|captcha|403|forbidden|denied/i.test(msg) ? "blocked" : run.status === "TIMED-OUT" ? "timeout" : "run_failed");
  }
  const items = await call(`/datasets/${run.defaultDatasetId}/items?clean=true&format=json`);
  if (!Array.isArray(items)) throw new ApifyError("Dataset items weren't an array", "bad_response");
  return { runId: run.id, items: items.filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object") };
}
