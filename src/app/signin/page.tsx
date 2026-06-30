import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { SignInButton } from "./SignInButton";

// If already signed in, bounce to where they were headed (or home).
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const { callbackUrl } = await searchParams;
  const dest = callbackUrl && callbackUrl.startsWith("/") ? callbackUrl : "/";
  const session = await auth();
  if (session?.user) redirect(dest);

  return (
    <div className="flex h-full items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-8 shadow-xl">
        <div className="flex items-baseline gap-2">
          <span className="font-display text-lg font-semibold">Transpira</span>
          <span className="text-muted-foreground/40">/</span>
          <span className="text-sm font-semibold text-muted-foreground">Sign in</span>
        </div>
        <h1 className="mt-4 font-display text-2xl font-semibold">Welcome</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          Sign in to build environments, buy credits, and run training jobs.
        </p>
        <div className="mt-6">
          <SignInButton callbackUrl={dest} />
        </div>
        <p className="mt-6 text-center text-xs text-muted-foreground">
          <Link href="/" className="hover:text-foreground">
            ← Back home
          </Link>
        </p>
      </div>
    </div>
  );
}
