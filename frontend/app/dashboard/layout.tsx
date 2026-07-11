// app/dashboard/layout.tsx
// Sprint 14C - Real auth. Requires an authenticated user (redirects to /login),
// provides the real user to client components, and renders a logout control.
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import { requireUser } from "@/lib/auth/protectedRoute";
import { UserProvider, type CurrentUser } from "@/context/UserContext";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Server-side guard: redirects to /login if not authenticated.
  const sessionUser = await requireUser();
  const p = sessionUser.profile;

  const currentUser: CurrentUser = {
    id: p.id,
    authId: p.authId,
    email: p.email,
    name: p.name,
    role: p.role,
    planId: p.planId,
    status: p.status,
    emailVerified: p.emailVerified,
  };

  return (
    <UserProvider initialUser={currentUser}>
      <div className="min-h-screen bg-[#050816] text-white flex">
        <DashboardSidebar />
        <div className="flex-1 flex flex-col">
          <DashboardHeader userName={currentUser.name} />
          <div className="flex-1 p-6">{children}</div>
        </div>
      </div>
    </UserProvider>
  );
}
