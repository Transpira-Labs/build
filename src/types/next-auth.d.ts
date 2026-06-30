import type { DefaultSession } from "next-auth";
import type { UserRole } from "@/db/schema";

// Surface our app columns on the session so client components can read the
// user's role + API-access status without an extra round-trip.
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: UserRole;
      apiAccess: boolean;
    } & DefaultSession["user"];
  }
}
