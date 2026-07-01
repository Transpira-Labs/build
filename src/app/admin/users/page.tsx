import Link from "next/link";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";

export const dynamic = "force-dynamic";

export default async function AdminUsers() {
  const rows = await db.select().from(users).orderBy(desc(users.createdAt)).limit(200);

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold">Users</h1>
      <p className="mt-1 text-sm text-muted-foreground">{rows.length} users</p>

      <div className="mt-6 overflow-hidden rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-semibold">User</th>
              <th className="px-4 py-2 font-semibold">Role</th>
              <th className="px-4 py-2 font-semibold">API access</th>
              <th className="px-4 py-2 font-semibold">Status</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id} className="border-t border-border">
                <td className="px-4 py-2">
                  <div className="font-medium">{u.name ?? "-"}</div>
                  <div className="text-xs text-muted-foreground">{u.email}</div>
                </td>
                <td className="px-4 py-2">
                  {u.role === "admin" ? (
                    <span className="rounded bg-accent/15 px-2 py-0.5 text-xs font-semibold text-accent">
                      admin
                    </span>
                  ) : (
                    <span className="text-muted-foreground">user</span>
                  )}
                </td>
                <td className="px-4 py-2">
                  {u.role === "admin" || u.apiAccess ? (
                    <span className="rounded bg-accent/15 px-2 py-0.5 text-xs font-semibold text-accent">
                      {u.role === "admin" ? "admin" : "granted"}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">none</span>
                  )}
                </td>
                <td className="px-4 py-2">
                  {u.suspended ? (
                    <span className="text-[var(--bad,#B0503E)]">suspended</span>
                  ) : (
                    <span className="text-muted-foreground">active</span>
                  )}
                </td>
                <td className="px-4 py-2 text-right">
                  <Link
                    href={`/admin/users/${u.id}`}
                    className="text-sm font-semibold text-accent hover:underline"
                  >
                    Manage
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
