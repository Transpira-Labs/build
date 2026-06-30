// Client-safe helpers for turning a failed API response into a user-facing
// message. Access/auth failures (403/401) get an actionable hint. The thrown
// ApiError carries `code`/`status` so UI can branch (e.g. link to /account).

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

// Fallback if the server didn't include a message. Kept in sync with
// ACCESS_MESSAGE in src/lib/access.ts.
const ACCESS_FALLBACK = "API access required. Text Adi at 678-313-6244 to request access.";

type ErrorBody = { error?: string; code?: string; contact?: string } | null;

export function apiErrorFrom(status: number, body: ErrorBody, fallback: string): ApiError {
  const code = body?.code;
  let message = body?.error || fallback;

  if (status === 401) {
    message = "Please sign in to continue.";
  } else if (status === 403) {
    if (code === "no_api_access") {
      message = body?.error || ACCESS_FALLBACK;
    } else if (code === "suspended") {
      message = "Your account is suspended. Contact support.";
    }
  }

  return new ApiError(message, status, code);
}
