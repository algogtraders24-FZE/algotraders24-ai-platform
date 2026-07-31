"use client";
// components/admin/AdminNavTabs.tsx
// Sprint D1.0 - The admin section nav, styled to match the shared Tabs
// primitive (gold underline for the active tab) but built from real Next
// Links so it survives with JS disabled and supports open-in-new-tab. The
// active tab is derived from the current pathname.
import Link from "next/link";
import { usePathname } from "next/navigation";

const ADMIN_NAV = [
  { label: "Overview", href: "/dashboard/admin" },
  { label: "Users", href: "/dashboard/admin/users" },
  { label: "Subscriptions", href: "/dashboard/admin/subscriptions" },
  { label: "Knowledge", href: "/dashboard/admin/knowledge" },
  { label: "AI Usage Analytics", href: "/dashboard/admin/analytics" },
  { label: "System Health", href: "/dashboard/admin/health" },
  { label: "Audit Logs", href: "/dashboard/admin/audit-logs" },
  { label: "Beta Overview", href: "/dashboard/admin/beta" },
  { label: "Feedback", href: "/dashboard/admin/feedback" },
];

export default function AdminNavTabs() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-wrap gap-1 border-b border-border">
      {ADMIN_NAV.map((item) => {
        // Overview (/dashboard/admin) must match exactly; the others match
        // their own subtree so a nested page keeps its tab highlighted.
        const active = item.href === "/dashboard/admin" ? pathname === item.href : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-t-control border-b-2 px-3 py-2 text-sm font-medium transition ${
              active ? "border-gold text-gold" : "border-transparent text-text-3 hover:text-text"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
