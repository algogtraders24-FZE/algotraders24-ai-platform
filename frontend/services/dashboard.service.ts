import { DASHBOARD_STATS, RECENT_ACTIVITY } from "@/data/dashboard";
import type { DashboardStat, ActivityItem } from "@/data/dashboard";

export const dashboardService = {
  getStats: (): DashboardStat[] => DASHBOARD_STATS,
  getRecentActivity: (): ActivityItem[] => RECENT_ACTIVITY,
};