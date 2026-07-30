// app/dashboard/page.tsx
// Sprint 14C - Dashboard home showing the real authenticated user.
// Sprint L2.3 - Stats and activity now come from real Prisma queries
// (services/dashboard.service.ts) instead of a hardcoded array shown
// identically to every user. Added a real profile row (plan, joined date)
// - both already-real fields (session.profile.planId/createdAt) that just
// weren't displayed anywhere before.
import DashboardStatCard from "@/components/dashboard/DashboardStatCard";
import QuickActions from "@/components/dashboard/QuickActions";
import RecentActivity from "@/components/dashboard/RecentActivity";
import { dashboardService } from "@/services/dashboard.service";
import { requireUser } from "@/lib/auth/protectedRoute";
import { signOutAction } from "@/app/(auth)/actions/auth.actions";
import { PLAN_LABELS } from "@/config/billing.config";
import type { PlanId } from "@/types/billing";
import ResendVerificationButton from "@/components/auth/ResendVerificationButton";

export default async function DashboardHome() {
  const sessionUser = await requireUser();
  const user = sessionUser.profile;

  const [overview, activity] = await Promise.all([
    dashboardService.getOverview(user.id),
    dashboardService.getRecentActivity(user.id),
  ]);

  const stats = [
    { label: "Conversations", value: overview.totalConversations },
    { label: "Documents", value: overview.totalDocuments },
    { label: "Indexed Chunks", value: overview.totalChunks },
    { label: "Knowledge Retrievals", value: overview.totalRetrievals },
  ];

  const planLabel = PLAN_LABELS[user.planId as PlanId] ?? user.planId;
  const joinedDate = new Date(user.createdAt).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

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
            {!user.emailVerified && (
              <>
                {" "}
                · email not verified · <ResendVerificationButton />
              </>
            )}
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

      <div className="flex flex-wrap gap-6 rounded-2xl bg-[#0C1324] border border-[#1F2937] p-6">
        <div>
          <p className="text-xs text-gray-500">Plan</p>
          <p className="mt-1 text-sm font-semibold">{planLabel}</p>
        </div>
        <div className="border-l border-[#1F2937] pl-6">
          <p className="text-xs text-gray-500">Joined</p>
          <p className="mt-1 text-sm font-semibold">{joinedDate}</p>
        </div>
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
