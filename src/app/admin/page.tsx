import Link from "next/link";
import { sql, eq, and } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";

export const dynamic = "force-dynamic";

export default async function AdminOverview() {
  const [[{ userCount }], [{ withAccess }], [{ admins }], [{ suspended }]] = await Promise.all([
    db.select({ userCount: sql<number>`count(*)` }).from(users),
    db
      .select({ withAccess: sql<number>`count(*)` })
      .from(users)
      .where(eq(users.apiAccess, true)),
    db
      .select({ admins: sql<number>`count(*)` })
      .from(users)
      .where(eq(users.role, "admin")),
    db
      .select({ suspended: sql<number>`count(*)` })
      .from(users)
      .where(and(eq(users.suspended, true))),
  ]);

  const stats = [
    { label: "Users", value: Number(userCount).toLocaleString() },
    { label: "With API access", value: Number(withAccess).toLocaleString() },
    { label: "Admins", value: Number(admins).toLocaleString() },
    { label: "Suspended", value: Number(suspended).toLocaleString() },
  ];

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold">Overview</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Grant or revoke API access per user under{" "}
        <Link href="/admin/users" className="text-accent hover:underline">
          Users
        </Link>
        .
      </p>

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {s.label}
            </p>
            <p className="mt-1 font-display text-3xl font-semibold">{s.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
