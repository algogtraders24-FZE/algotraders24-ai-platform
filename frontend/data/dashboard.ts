export interface DashboardStat {
  label: string;
  value: string;
  change: string;
  up: boolean;
}

export interface ActivityItem {
  id: string;
  text: string;
  time: string;
}

export const DASHBOARD_STATS: DashboardStat[] = [
  { label: "Active Licenses", value: "3", change: "+1", up: true },
  { label: "Total Downloads", value: "12", change: "+4", up: true },
  { label: "Orders", value: "5", change: "+2", up: true },
  { label: "Spent", value: "$1,175", change: "+$299", up: true },
];

export const RECENT_ACTIVITY: ActivityItem[] = [
  { id: "a1", text: "Downloaded AI Trend Master EA v1.4.2", time: "2h ago" },
  { id: "a2", text: "License activated: AXON-4F2A-9C1B", time: "1d ago" },
  { id: "a3", text: "Order paid: Quantum Scalper Pro", time: "3d ago" },
];