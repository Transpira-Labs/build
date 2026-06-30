// API-access gating. The compute-consuming routes (build/run/train/eval/generate)
// require the current user to be an admin OR to have been granted apiAccess by an
// admin. Everyone else gets a 403 telling them how to request access. There is no
// billing — access is a simple admin-granted permission.
import "server-only";
import { requireUser, AuthError, isAdmin } from "@/lib/dal";
import { startJob, getJob, type JobKind } from "@/lib/synth-backend";
import type { User } from "@/db/schema";

// Shown to users who try to use a gated action without access. Also surfaced
// client-side via apiError.ts (status 403, code "no_api_access").
export const ACCESS_CONTACT = "Adi at 678-313-6244";
export const ACCESS_MESSAGE = `API access required. Text ${ACCESS_CONTACT} to request access.`;

export function hasApiAccess(user: User): boolean {
  return isAdmin(user) || user.apiAccess;
}

type AccessResult =
  | { ok: true; user: User }
  | { ok: false; response: Response };

/**
 * Resolve the current user and confirm they may use a gated action. Returns a
 * ready-to-send Response on failure: 401 (signed out), 403 suspended, or 403
 * no_api_access (with the contact message).
 */
export async function checkApiAccess(): Promise<AccessResult> {
  let user: User;
  try {
    user = await requireUser();
  } catch (e) {
    if (e instanceof AuthError) {
      return { ok: false, response: Response.json({ error: e.message }, { status: e.status }) };
    }
    throw e;
  }

  if (user.suspended) {
    return {
      ok: false,
      response: Response.json(
        { error: "Your account is suspended.", code: "suspended" },
        { status: 403 },
      ),
    };
  }

  if (!hasApiAccess(user)) {
    return {
      ok: false,
      response: Response.json(
        { error: ACCESS_MESSAGE, code: "no_api_access", contact: ACCESS_CONTACT },
        { status: 403 },
      ),
    };
  }

  return { ok: true, user };
}

type JobRouteConfig = {
  jobKind: JobKind;
  // Validate + shape the raw body into the startJob payload. Return an error to
  // reject (no job started).
  prepare: (
    body: Record<string, unknown>,
  ) => { error: string; status?: number } | { jobBody: Record<string, unknown> };
};

/**
 * Build a POST handler for a job-style gated route: parse → check access →
 * validate → startJob. Returns 403 (with the contact message) when the user
 * lacks access, 401 when signed out.
 */
export function gatedJobPOST(cfg: JobRouteConfig): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return Response.json({ error: "invalid JSON body" }, { status: 400 });
    }

    const access = await checkApiAccess();
    if (!access.ok) return access.response;

    const prepared = cfg.prepare(body);
    if ("error" in prepared) {
      return Response.json({ error: prepared.error }, { status: prepared.status ?? 400 });
    }

    const r = await startJob(cfg.jobKind, prepared.jobBody);
    if (r.error || !r.jobId) {
      return Response.json({ error: r.error ?? "Failed to start job." }, { status: r.status ?? 500 });
    }
    return Response.json({ jobId: r.jobId });
  };
}

/** Shared GET poll handler — just relays job status (reading status is not gated). */
export async function jobGET(req: Request): Promise<Response> {
  const jobId = new URL(req.url).searchParams.get("jobId");
  if (!jobId) return Response.json({ error: "jobId required" }, { status: 400 });
  const job = await getJob(jobId);
  if (!job) return Response.json({ error: "job not found" }, { status: 404 });
  return Response.json(job);
}
