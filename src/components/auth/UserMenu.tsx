"use client";

// Header cluster shown on the dashboard. Signed out → a Google sign-in button.
// Signed in → the live credit balance (links to /account), an Admin link for
// admins, and a small menu with account + sign-out. signIn/signOut from
// next-auth/react hit the auth endpoints directly, so no SessionProvider needed.

import { useState } from "react";
import Link from "next/link";
import { signIn, signOut } from "next-auth/react";

export type SessionUser = {
  id: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
  role: "user" | "admin";
  apiAccess: boolean;
};

export function UserMenu({ user }: { user: SessionUser | null }) {
  const [open, setOpen] = useState(false);

  if (!user) {
    return (
      <button
        onClick={() => signIn("google")}
        className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3.5 py-1.5 text-sm font-semibold text-foreground shadow-sm transition hover:border-accent/50 hover:text-accent focus:outline-none focus:ring-2 focus:ring-ring"
      >
        Sign in with Google
      </button>
    );
  }

  const label = user.name || user.email || "Account";
  const initial = (label[0] ?? "?").toUpperCase();
  const hasAccess = user.role === "admin" || user.apiAccess;

  return (
    <div className="flex items-center gap-2">
      {!hasAccess && (
        <Link
          href="/account"
          title="Text Adi at 678-313-6244 to request API access"
          className="inline-flex items-center gap-1.5 rounded-md border border-accent/30 bg-accent/10 px-3 py-1.5 text-sm font-semibold text-accent transition hover:bg-accent/15 focus:outline-none focus:ring-2 focus:ring-ring"
        >
          Request access
        </Link>
      )}

      {user.role === "admin" && (
        <Link
          href="/admin"
          className="rounded-md border border-border bg-card px-3 py-1.5 text-sm font-semibold text-muted-foreground shadow-sm transition hover:border-accent/50 hover:text-accent focus:outline-none focus:ring-2 focus:ring-ring"
        >
          Admin
        </Link>
      )}

      <div className="relative">
        <button
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={open}
          className="flex items-center gap-2 rounded-md px-1.5 py-1 transition hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring"
        >
          {user.image ? (
            // eslint-disable-next-line @next/next/no-img-element -- external Google avatar; next/image would need remotePatterns config
            <img
              src={user.image}
              alt=""
              className="h-7 w-7 rounded-full border border-border object-cover"
            />
          ) : (
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent/15 text-sm font-semibold text-accent">
              {initial}
            </span>
          )}
        </button>

        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <div
              role="menu"
              className="absolute right-0 z-50 mt-2 w-52 overflow-hidden rounded-lg border border-border bg-card py-1 shadow-xl"
            >
              <div className="truncate border-b border-border px-3 py-2 text-xs text-muted-foreground">
                {user.email}
              </div>
              <Link
                href="/account"
                role="menuitem"
                onClick={() => setOpen(false)}
                className="block px-3 py-2 text-sm transition hover:bg-muted"
              >
                Account &amp; access
              </Link>
              {user.role === "admin" && (
                <Link
                  href="/admin"
                  role="menuitem"
                  onClick={() => setOpen(false)}
                  className="block px-3 py-2 text-sm transition hover:bg-muted"
                >
                  Admin panel
                </Link>
              )}
              <button
                role="menuitem"
                onClick={() => signOut({ callbackUrl: "/" })}
                className="block w-full px-3 py-2 text-left text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground"
              >
                Sign out
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
