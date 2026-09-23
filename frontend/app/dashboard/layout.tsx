// app/dashboard/layout.tsx
// Sprint 14C - Real auth. Requires an authenticated user (redirects to /login)
// and provides the real user to client components.
// Sprint UI-01 - the inline sidebar/header/content markup moved into the
// shared <AppShell> (components/shell/AppShell.tsx). This file now only does
// the auth guard + user context; AppShell owns all shell geometry.
import AppShell from "@/components/shell/AppShell";
import FeedbackWidget from "@/components/dashboard/FeedbackWidget";
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
      <AppShell userName={currentUser.name}>{children}</AppShell>
      <FeedbackWidget />
    </UserProvider>
  );
}
