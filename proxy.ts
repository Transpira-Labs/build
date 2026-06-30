// Next 16 Proxy (formerly middleware). Optimistic auth ONLY: it checks for the
// presence of the Auth.js session cookie and redirects unauthenticated users
// away from /account and /admin. It does NOT hit the database (runs on every
// request incl. prefetches) — real enforcement is in the DAL + route handlers.
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PROTECTED = ["/account", "/admin"];

function hasSessionCookie(req: NextRequest): boolean {
  // Auth.js v5 names the cookie `authjs.session-token`, prefixed `__Secure-` on https.
  return (
    !!req.cookies.get("authjs.session-token")?.value ||
    !!req.cookies.get("__Secure-authjs.session-token")?.value
  );
}

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isProtected = PROTECTED.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  if (isProtected && !hasSessionCookie(req)) {
    const url = new URL("/signin", req.nextUrl);
    url.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    // Run on everything except auth routes, the Stripe webhook, Next internals,
    // and static assets.
    "/((?!api/auth|api/stripe/webhook|_next/static|_next/image|favicon.ico|icon.jpeg).*)",
  ],
};
