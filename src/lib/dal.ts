// Data Access Layer: the single place server code resolves "who is the current
// user, and are they allowed?". Memoized per-request with React `cache`. Real
// authz lives here and in route handlers — proxy.ts only does optimistic cookie
// checks. requireUser/requireAdmin throw AuthError, which routes map to 401/403.
import "server-only";
import { cache } from "react";
import { eq } from "drizzle-orm";
import { auth, adminEmails } from "@/auth";
import { db } from "@/db";
import { users, type User } from "@/db/schema";

export class AuthError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "AuthError";
  }
}

export const verifySession = cache(async () => {
  const session = await auth();
  if (!session?.user?.id) return null;
  return session;
});

export const getCurrentUser = cache(async (): Promise<User | null> => {
  const session = await verifySession();
  if (!session?.user?.id) return null;
  const row = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
  });
  return row ?? null;
});

export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) throw new AuthError(401, "You must be signed in.");
  return user;
}

export function isAdmin(user: User): boolean {
  if (user.role === "admin") return true;
  const email = user.email?.toLowerCase();
  return !!email && adminEmails().includes(email);
}

export async function requireAdmin(): Promise<User> {
  const user = await requireUser();
  if (!isAdmin(user)) throw new AuthError(403, "Admins only.");
  return user;
}
