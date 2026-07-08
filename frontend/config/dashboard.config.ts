export interface DashboardNavItem {
  label: string;
  href: string;
  icon: string;
}
export const DASHBOARD_NAV: DashboardNavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: "DB" },
  { label: "Products", href: "/dashboard/products", icon: "PR" },
  { label: "Downloads", href: "/dashboard/downloads", icon: "DL" },
  { label: "Licenses", href: "/dashboard/licenses", icon: "LC" },
  { label: "AI Signals", href: "/dashboard/signals", icon: "SG" },
  { label: "Market Intel", href: "/dashboard/market-intelligence", icon: "MI" },
  { label: "AI News", href: "/dashboard/news", icon: "NW" },
  { label: "AI Assistant", href: "/dashboard/assistant", icon: "AI" },
  { label: "Trading Copilot", href: "/dashboard/trading-copilot", icon: "CP" },
  { label: "Publishing", href: "/dashboard/publishing", icon: "PB" },
  { label: "Orders", href: "/dashboard/orders", icon: "OR" },
  { label: "Profile", href: "/dashboard/profile", icon: "PF" },
  { label: "Settings", href: "/dashboard/settings", icon: "ST" },
];
