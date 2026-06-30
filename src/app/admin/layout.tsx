import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser, isAdmin } from "@/lib/dal";

// Guard the whole /admin segment. Signed out → sign in; signed in but not admin
// → home. Individual server actions re-check admin too.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/signin?callbackUrl=/admin");
  if (!isAdmin(user)) redirect("/");

  return (
    <div className="h-full overflow-y-auto bg-background">
      <header className="flex items-center gap-3 border-b border-border bg-card px-6 py-3">
        <Link href="/" className="font-display text-base font-semibold hover:text-accent">
          Transpira
        </Link>
        <span className="text-muted-foreground/40">/</span>
        <span className="text-sm font-semibold text-muted-foreground">Admin</span>
        <nav className="ml-6 flex items-center gap-4 text-sm">
          <Link href="/admin" className="text-muted-foreground hover:text-foreground">
            Overview
          </Link>
          <Link href="/admin/users" className="text-muted-foreground hover:text-foreground">
            Users
          </Link>
        </nav>
        <Link href="/" className="ml-auto text-sm text-muted-foreground hover:text-foreground">
          ← Back to app
        </Link>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}
