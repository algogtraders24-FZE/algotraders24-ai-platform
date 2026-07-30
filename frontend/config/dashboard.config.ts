// config/dashboard.config.ts
// Sprint L2.3 - Removed 4 dead entries (Products, Downloads, Profile,
// Settings all pointed at routes that don't exist - confirmed via
// filesystem search, not assumption) and added Payments, a real route
// (app/dashboard/payments/page.tsx) that existed but had no navigation
// entry at all, making it undiscoverable. Every remaining href below was
// verified against the actual app/ directory.
export interface DashboardNavItem {
  label: string;
  href: string;
  icon: string;
}
export const DASHBOARD_NAV: DashboardNavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: "DB" },
  { label: "Licenses", href: "/dashboard/licenses", icon: "LC" },
  { label: "AI Signals", href: "/dashboard/signals", icon: "SG" },
  { label: "Market Intel", href: "/dashboard/market-intelligence", icon: "MI" },
  { label: "AI News", href: "/dashboard/news", icon: "NW" },
  { label: "AI Assistant", href: "/dashboard/assistant", icon: "AI" },
  { label: "Trading Copilot", href: "/dashboard/trading-copilot", icon: "CP" },
  { label: "Publishing", href: "/dashboard/publishing", icon: "PB" },
  { label: "Automation", href: "/dashboard/automation", icon: "AU" },
  { label: "AI Agents", href: "/dashboard/agents", icon: "AG" },
  { label: "Knowledge Base", href: "/dashboard/knowledge", icon: "KB" },
  { label: "Orders", href: "/dashboard/orders", icon: "OR" },
  { label: "Payments", href: "/dashboard/payments", icon: "PY" },
  { label: "Billing", href: "/dashboard/billing", icon: "BL" },
];
