// Auth.js (NextAuth v5) configuration: Google sign-in, database sessions backed
// by the Drizzle adapter. The `session` callback copies our app columns (role,
// apiAccess) onto the session; `events.signIn` promotes allow-listed emails to
// admin on every sign-in (idempotent). Exports the universal `auth()` helper
// used in Server Components, Route Handlers, and Server Actions.
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users, accounts, sessions, verificationTokens } from "@/db/schema";

export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  session: { strategy: "database" },
  providers: [Google],
  pages: { signIn: "/signin" },
  // Trust the deployment host (needed when self-hosting outside Vercel). In
  // production set AUTH_URL to your canonical origin.
  trustHost: true,
  callbacks: {
    // With database sessions the `user` arg is the full DB row.
    session({ session, user }) {
      if (session.user) {
        session.user.id = user.id;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        session.user.role = (user as any).role ?? "user";
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        session.user.apiAccess = (user as any).apiAccess ?? false;
      }
      return session;
    },
  },
  events: {
    // Runs after the adapter created/linked the user. Keep admin role in sync
    // with the ADMIN_EMAILS allowlist on each sign-in.
    async signIn({ user }) {
      const email = user.email?.toLowerCase();
      if (email && user.id && adminEmails().includes(email)) {
        await db.update(users).set({ role: "admin" }).where(eq(users.id, user.id));
      }
    },
  },
});
