// Client helper: start a backend job (POST) then poll it to completion (GET
// ?jobId=…). Deploys/evals run as background jobs now, so the UI kicks one off
// and waits on its result here. Returns the job's `result`; throws on failure.

import { apiErrorFrom } from "@/lib/apiError";

export async function runJob<T>(
  endpoint: string,
  body: unknown,
  opts: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<T> {
  const startRes = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const started = await startRes.json().catch(() => ({}));
  if (!startRes.ok) {
    // 402 (no credits / suspended / over limit) and 401 (signed out) get a clear,
    // actionable message; everything else falls back to the server's error text.
    throw apiErrorFrom(startRes.status, started, `Request failed (${startRes.status})`);
  }
  // No jobId means the route answered synchronously (shouldn't happen now, but
  // tolerate it) — treat the body as the result.
  const jobId: string | undefined = started.jobId;
  if (!jobId) return started as T;

  const interval = opts.intervalMs ?? 2500;
  const timeout = opts.timeoutMs ?? 20 * 60 * 1000;
  const t0 = Date.now();
  let misses = 0;

  for (;;) {
    await new Promise((r) => setTimeout(r, interval));
    if (Date.now() - t0 > timeout) throw new Error("Timed out waiting for the job to finish.");

    const res = await fetch(`${endpoint}?jobId=${encodeURIComponent(jobId)}`);
    if (!res.ok) {
      // Tolerate brief blips (e.g. a not-yet-registered job), but give up if persistent.
      if (++misses > 5) throw new Error(`Lost the job (${res.status}).`);
      continue;
    }
    misses = 0;
    const data = await res.json();
    if (data.status === "done") return data.result as T;
    if (data.status === "error") {
      const r = data.result as { error?: string } | null;
      throw new Error(r?.error || "The job failed.");
    }
    // status === "running" → keep polling
  }
}
