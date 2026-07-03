export interface DashboardNavItem {
  label: string;
  href: string;
  icon: string;
}

export const DASHBOARD_NAV: DashboardNavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: "📊" },
  { label: "Products", href: "/dashboard/products", icon: "📦" },
  { label: "Downloads", href: "/dashboard/downloads", icon: "⬇️" },
  { label: "Licenses", href: "/dashboard/licenses", icon: "🔑" },
  { label: "Orders", href: "/dashboard/orders", icon: "🧾" },
  { label: "Profile", href: "/dashboard/profile", icon: "👤" },
  { label: "Settings", href: "/dashboard/settings", icon: "⚙️" },
];