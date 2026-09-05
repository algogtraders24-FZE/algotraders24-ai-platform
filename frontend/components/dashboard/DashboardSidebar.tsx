"use client";

// Sprint D1.0 - Retrofitted onto the approved token system (ink/gold/
// border), previously bg-[#0C1324]/border-[#1F2937]/bg-blue-600/text-blue-
// 500 - a different, unrelated palette from the homepage's.
// Sprint IA1 - Backoffice IA refactor. Renders the new grouped/nested
// DASHBOARD_NAV_GROUPS (section headings + optional child links) instead
// of the old flat DASHBOARD_NAV list.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { DASHBOARD_NAV_GROUPS } from "@/config/dashboard.config";
import { useUserContext } from "@/context/UserContext";
import BrandLogo from "@/components/brand/BrandLogo";

export default function DashboardSidebar() {
  const pathname = usePathname();
  const { user } = useUserContext();

  return (
    <aside className="w-64 shrink-0 bg-ink-2 border-r border-border min-h-screen p-4 hidden md:block overflow-y-auto">
      <Link href="/" aria-label="Algotraders24 AI home" className="block px-3 py-4">
        <BrandLogo variant="full" size="sm" withDescriptor={false} />
      </Link>
      <nav className="mt-2 space-y-5">
        {DASHBOARD_NAV_GROUPS.map((group, groupIndex) => {
          // Sprint L2.6 - discoverability only; the real gate is
          // server-side (requireRole in app/dashboard/admin/layout.tsx).
          const items = group.items.filter((item) => !item.adminOnly || user?.role === "admin");
          if (items.length === 0) return null;
          // Two groups are ungrouped (label: null) - Dashboard at the top
          // and Admin at the bottom - so the key can't be the label alone.
          return (
            <div key={group.label ?? `ungrouped-${groupIndex}`}>
              {group.label && (
                <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-text-3">
                  {group.label}
                </p>
              )}
              <div className="space-y-1">
                {items.map((item) => (
                  <div key={item.href}>
                    <Link
                      href={item.href}
                      className={`flex items-center gap-3 rounded-control px-3 py-2 text-sm transition ${
                        pathname === item.href
                          ? "bg-gold/10 text-gold"
                          : "text-text-2 hover:bg-ink-3 hover:text-text"
                      }`}
                    >
                      <span className="font-mono text-xs text-text-3">{item.icon}</span>
                      {item.label}
                    </Link>
                    {item.children && item.children.length > 0 && (
                      <div className="ml-6 mt-1 space-y-1 border-l border-border pl-3">
                        {item.children.map((child) => (
                          <Link
                            key={child.href}
                            href={child.href}
                            className={`block rounded-control px-2 py-1.5 text-sm transition ${
                              pathname === child.href
                                ? "text-gold"
                                : "text-text-3 hover:text-text"
                            }`}
                          >
                            {child.label}
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
