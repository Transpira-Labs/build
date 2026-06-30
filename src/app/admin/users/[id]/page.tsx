import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { setApiAccess, setSuspended, setRole, setFeatureFlag, removeFeatureFlag } from "@/app/admin/actions";

export const dynamic = "force-dynamic";

export default async function AdminUserDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await db.query.users.findFirst({ where: eq(users.id, id) });
  if (!user) notFound();

  const flags = Object.entries(user.featureFlags ?? {});
  const effectiveAccess = user.role === "admin" || user.apiAccess;

  return (
    <div>
      <Link href="/admin/users" className="text-sm text-muted-foreground hover:text-foreground">
        ← All users
      </Link>
      <h1 className="mt-2 font-display text-2xl font-semibold">{user.name ?? user.email}</h1>
      <p className="text-sm text-muted-foreground">{user.email}</p>

      <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
        <span className="rounded bg-muted px-2 py-1">
          API access:{" "}
          <strong className={effectiveAccess ? "text-accent" : ""}>
            {user.role === "admin" ? "admin (always)" : user.apiAccess ? "granted" : "none"}
          </strong>
        </span>
        <span className="rounded bg-muted px-2 py-1">
          Role: <strong>{user.role}</strong>
        </span>
        <span className="rounded bg-muted px-2 py-1">
          {user.suspended ? "Suspended" : "Active"}
        </span>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2">
        {/* API access */}
        <form action={setApiAccess} className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <h2 className="font-display text-base font-semibold">API access</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Lets this user build environments, run/train/eval, and use AI assist.
            Admins always have access.
          </p>
          <input type="hidden" name="userId" value={user.id} />
          <input type="hidden" name="apiAccess" value={user.apiAccess ? "false" : "true"} />
          <button
            disabled={user.role === "admin"}
            className={`mt-3 rounded-md px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${
              user.apiAccess
                ? "border border-[var(--bad,#B0503E)] text-[var(--bad,#B0503E)]"
                : "bg-accent text-accent-foreground"
            }`}
          >
            {user.role === "admin"
              ? "Granted via admin role"
              : user.apiAccess
                ? "Revoke access"
                : "Grant access"}
          </button>
        </form>

        {/* Suspend */}
        <form action={setSuspended} className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <h2 className="font-display text-base font-semibold">Account status</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Suspended users cannot use any gated action, even with access.
          </p>
          <input type="hidden" name="userId" value={user.id} />
          <input type="hidden" name="suspended" value={user.suspended ? "false" : "true"} />
          <button
            className={`mt-3 rounded-md px-4 py-2 text-sm font-semibold ${
              user.suspended
                ? "bg-accent text-accent-foreground"
                : "border border-[var(--bad,#B0503E)] text-[var(--bad,#B0503E)]"
            }`}
          >
            {user.suspended ? "Reinstate account" : "Suspend account"}
          </button>
        </form>

        {/* Role */}
        <form action={setRole} className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <h2 className="font-display text-base font-semibold">Role</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Admins can access this panel, manage all users, and always have API access.
          </p>
          <input type="hidden" name="userId" value={user.id} />
          <select
            name="role"
            defaultValue={user.role}
            className="mt-3 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          >
            <option value="user">user</option>
            <option value="admin">admin</option>
          </select>
          <button className="mt-3 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground">
            Save role
          </button>
        </form>
      </div>

      {/* Feature flags */}
      <section className="mt-6 rounded-xl border border-border bg-card p-5 shadow-sm">
        <h2 className="font-display text-base font-semibold">Feature flags</h2>
        {flags.length === 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">No flags set.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {flags.map(([key, val]) => (
              <li key={key} className="flex items-center gap-3 text-sm">
                <span className="font-mono">{key}</span>
                <span className={val ? "text-accent" : "text-muted-foreground"}>
                  {val ? "on" : "off"}
                </span>
                <form action={setFeatureFlag} className="ml-auto">
                  <input type="hidden" name="userId" value={user.id} />
                  <input type="hidden" name="key" value={key} />
                  <input type="hidden" name="enabled" value={val ? "false" : "true"} />
                  <button className="rounded border border-border px-2 py-1 text-xs hover:bg-muted">
                    Toggle
                  </button>
                </form>
                <form action={removeFeatureFlag}>
                  <input type="hidden" name="userId" value={user.id} />
                  <input type="hidden" name="key" value={key} />
                  <button className="rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted">
                    Remove
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
        <form action={setFeatureFlag} className="mt-4 flex flex-wrap items-center gap-2">
          <input type="hidden" name="userId" value={user.id} />
          <input
            type="text"
            name="key"
            placeholder="flag_name"
            required
            className="rounded-md border border-border bg-background px-3 py-2 text-sm font-mono"
          />
          <input type="hidden" name="enabled" value="true" />
          <button className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground">
            Add &amp; enable
          </button>
        </form>
      </section>
    </div>
  );
}
