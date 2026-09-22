// app/dashboard/page.tsx
// Sprint 14C - Dashboard home showing the real authenticated user.
// Sprint L2.3 - Stats and activity now come from real Prisma queries
// (services/dashboard.service.ts) instead of a hardcoded array shown
// identically to every user. Added a real profile row (plan, joined date)
// - both already-real fields (session.profile.planId/createdAt) that just
// weren't displayed anywhere before.
// Sprint UI-01 - AT24 Premium UI Foundation reference implementation: the
// hand-rolled <h1>/grid markup is now built entirely from the shared system
// (PageHeader, StatCard, the same Card/EmptyState RecentActivity and
// QuickActions already used). No data, query or behavior change - same
// overview/activity from dashboardService, same new-user branch, same
// email-verification notice.
import { MessageSquare, FileText, Database, Search } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/StatCard";
import ButtonLink from "@/components/ui/ButtonLink";
import QuickActions from "@/components/dashboard/QuickActions";
import RecentActivity from "@/components/dashboard/RecentActivity";
import NewUserOnboarding from "@/components/dashboard/NewUserOnboarding";
import { dashboardService } from "@/services/dashboard.service";
import { requireUser } from "@/lib/auth/protectedRoute";
import { PLAN_LABELS } from "@/config/billing.config";
import type { PlanId } from "@/types/billing";
import ResendVerificationButton from "@/components/auth/ResendVerificationButton";
import Card from "@/components/ui/Card";

export default async function DashboardHome() {
  const sessionUser = await requireUser();
  const user = sessionUser.profile;

  const [overview, activity] = await Promise.all([
    dashboardService.getOverview(user.id),
    dashboardService.getRecentActivity(user.id),
  ]);

  // Best available real signal for "hasn't used the product yet" - no
  // conversations and no documents. Deliberately not schema-backed (see
  // dashboard.service.ts's disclosed gap on tracked analyses); this sprint
  // doesn't add new persistence, so it's inferred from existing counts.
  const isNewUser = overview.totalConversations === 0 && overview.totalDocuments === 0;

  if (isNewUser) {
    return <NewUserOnboarding name={user.name} email={user.email} emailVerified={user.emailVerified} />;
  }

  const stats = [
    {
      label: "Conversations",
      value: overview.totalConversations,
      icon: MessageSquare,
      hint: "AI Assistant conversations you've started.",
    },
    {
      label: "Documents",
      value: overview.totalDocuments,
      icon: FileText,
      hint: "Documents you've uploaded to your Knowledge Base.",
    },
    {
      label: "Indexed chunks",
      value: overview.totalChunks,
      icon: Database,
      hint: "Passages your documents were split into so the AI Assistant can search and cite them.",
    },
    {
      label: "Knowledge retrievals",
      value: overview.totalRetrievals,
      icon: Search,
      hint: "Times the AI Assistant pulled a passage from your documents to answer a question.",
    },
  ];

  const planLabel = PLAN_LABELS[user.planId as PlanId] ?? user.planId;
  const joinedDate = new Date(user.createdAt).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Account"
        title={`Welcome back, ${user.name}`}
        description={
          <>
            {user.email}
            {!user.emailVerified && (
              <>
                {" "}
                · email not verified · <ResendVerificationButton />
              </>
            )}
          </>
        }
        action={
          <ButtonLink href="/dashboard/billing" variant="secondary" size="sm">
            Manage plan
          </ButtonLink>
        }
      />

      <Card className="flex flex-wrap gap-6">
        <div>
          <p className="text-xs text-text-3">Plan</p>
          <p className="mt-1 text-sm font-semibold text-text">{planLabel}</p>
        </div>
        <div className="border-l border-border pl-6">
          <p className="text-xs text-text-3">Joined</p>
          <p className="mt-1 text-sm font-semibold text-text">{joinedDate}</p>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((stat) => (
          <StatCard key={stat.label} label={stat.label} value={stat.value} icon={stat.icon} hint={stat.hint} />
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <RecentActivity items={activity} />
        <QuickActions />
      </div>
    </div>
  );
}
