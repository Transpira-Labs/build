import { Dashboard } from "@/components/dashboard/Dashboard";
import { getCurrentUser } from "@/lib/dal";
import type { SessionUser } from "@/components/auth/UserMenu";

// Server component: resolve the signed-in user (if any) and hand a serializable
// snapshot to the client Dashboard for the header user menu + credit balance.
export default async function Home() {
  const user = await getCurrentUser();
  const initialUser: SessionUser | null = user
    ? {
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
        role: user.role,
        apiAccess: user.apiAccess,
      }
    : null;
  return <Dashboard initialUser={initialUser} />;
}
