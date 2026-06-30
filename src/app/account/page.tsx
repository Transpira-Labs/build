import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser, isAdmin } from "@/lib/dal";
import { hasApiAccess, ACCESS_CONTACT } from "@/lib/access";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/signin?callbackUrl=/account");

  const access = hasApiAccess(user);
  const admin = isAdmin(user);

  return (
    <div className="h-full overflow-y-auto bg-background">
      <header className="flex items-center gap-3 border-b border-border bg-card px-6 py-3">
        <Link href="/" className="font-display text-base font-semibold hover:text-accent">
          Transpira
        </Link>
        <span className="text-muted-foreground/40">/</span>
        <span className="text-sm font-semibold text-muted-foreground">Account</span>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-8">
        <section className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="flex items-center gap-3">
            {user.image ? (
              // eslint-disable-next-line @next/next/no-img-element -- external Google avatar
              <img
                src={user.image}
                alt=""
                className="h-12 w-12 rounded-full border border-border object-cover"
              />
            ) : (
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent/15 text-lg font-semibold text-accent">
                {(user.name?.[0] ?? user.email?.[0] ?? "?").toUpperCase()}
              </span>
            )}
            <div>
              <p className="font-display text-lg font-semibold">{user.name ?? user.email}</p>
              <p className="text-sm text-muted-foreground">{user.email}</p>
            </div>
            {admin && (
              <span className="ml-auto rounded bg-accent/15 px-2 py-0.5 text-xs font-semibold text-accent">
                admin
              </span>
            )}
          </div>
        </section>

        <section className="mt-6 rounded-2xl border border-border bg-card p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            API access
          </p>

          {access ? (
            <>
              <p className="mt-2 font-display text-2xl font-semibold text-accent">
                <span aria-hidden className="mr-1">✦</span> Active
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                You can build environments, run tasksets, train models, and use AI assist.
                {admin && " (Granted automatically as an admin.)"}
              </p>
            </>
          ) : (
            <>
              <p className="mt-2 font-display text-2xl font-semibold">Not enabled</p>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Building environments and using AI assist require API access. To request
                it, text{" "}
                <span className="font-semibold text-foreground">{ACCESS_CONTACT}</span>.
                Once granted, this page will show your access as active.
              </p>
            </>
          )}
        </section>

        {user.suspended && (
          <section className="mt-6 rounded-2xl border border-[var(--bad,#B0503E)]/40 bg-[var(--bad,#B0503E)]/5 p-6">
            <p className="text-sm font-medium text-[var(--bad,#B0503E)]">
              Your account is suspended — actions are disabled. Contact support.
            </p>
          </section>
        )}

        <p className="mt-8 text-center text-sm">
          <Link href="/" className="text-muted-foreground hover:text-foreground">
            ← Back to environments
          </Link>
        </p>
      </main>
    </div>
  );
}
