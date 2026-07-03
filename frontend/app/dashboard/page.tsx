import DashboardStatCard from "@/components/dashboard/DashboardStatCard";
import QuickActions from "@/components/dashboard/QuickActions";
import RecentActivity from "@/components/dashboard/RecentActivity";
import { dashboardService } from "@/services/dashboard.service";
import { authService } from "@/services/auth.service";

export default function DashboardHome() {
  const user = authService.getCurrentUser();
  const stats = dashboardService.getStats();
  const activity = dashboardService.getRecentActivity();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Welcome back, {user?.name ?? "Trader"} 👋</h1>
        <p className="text-gray-400 mt-1">Here&apos;s your account overview.</p>
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