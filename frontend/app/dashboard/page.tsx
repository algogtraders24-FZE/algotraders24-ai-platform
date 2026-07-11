// app/dashboard/page.tsx
// Sprint 14C - Dashboard home showing the real authenticated user.
import DashboardStatCard from "@/components/dashboard/DashboardStatCard";
import QuickActions from "@/components/dashboard/QuickActions";
import RecentActivity from "@/components/dashboard/RecentActivity";
import { dashboardService } from "@/services/dashboard.service";
import { requireUser } from "@/lib/auth/protectedRoute";
import { signOutAction } from "@/app/(auth)/actions/auth.actions";

export default async function DashboardHome() {
  const sessionUser = await requireUser();
  const user = sessionUser.profile;
  const stats = dashboardService.getStats();
  const activity = dashboardService.getRecentActivity();

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">
            Welcome back, {user.name} &#128075;
          </h1>
          <p className="text-gray-400 mt-1">Here&apos;s your account overview.</p>
          <p className="text-xs text-gray-500 mt-1">
            {user.email}
            {user.emailVerified ? "" : " · email not verified"}
          </p>
        </div>
        <form action={signOutAction}>
          <button
            type="submit"
            className="rounded-lg border border-neutral-700 px-4 py-2 text-sm text-neutral-300 transition hover:bg-neutral-800"
          >
            Sign out
          </button>
        </form>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat) => (
          <DashboardStatCard key={stat.label} stat={stat} />
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <RecentActivity items={activity} />
        <QuickActions />
      </div>
    </div>
  );
}
