"use client";

// components/dashboard/MobileNav.tsx
// Sprint D2.3 (P3) - added because the desktop sidebar is hidden < md, so
// there was no way to navigate on mobile.
// Sprint IA1/IA2 - renders the grouped/nested DASHBOARD_NAV_GROUPS with
// collapsible groups and items-with-children.
// Sprint UI-01 - now driven by the shared SidebarContext (the hamburger
// lives in Topbar) and built on the Drawer primitive instead of a
// hand-rolled overlay. Same nav data, active-state and admin filtering as
// the desktop DashboardSidebar - one source, two presentations. Real
// lucide icons per the config change.
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { DASHBOARD_NAV_GROUPS, type DashboardNavItem } from "@/config/dashboard.config";
import { useUserContext } from "@/context/UserContext";
import { useSidebar } from "@/components/shell/SidebarContext";
import Drawer from "@/components/ui/Drawer";
import BrandLogo from "@/components/brand/BrandLogo";

function isActive(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  if (href === "/dashboard") return false;
  const base = href.split("#")[0];
  return pathname.startsWith(`${base}/`);
}

export default function MobileNav() {
  const { mobileOpen, closeMobile } = useSidebar();
  const [groupCollapsed, setGroupCollapsed] = useState<Record<string, boolean>>({});
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({});
  const pathname = usePathname();
  const { user } = useUserContext();

  const isItemExpanded = (item: DashboardNavItem): boolean => {
    const explicit = expandedItems[item.href];
    if (explicit !== undefined) return explicit;
    return isActive(pathname, item.href) || (item.children ?? []).some((c) => isActive(pathname, c.href));
  };

  return (
    <Drawer open={mobileOpen} onClose={closeMobile} side="left" hideHeader title="Dashboard navigation">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <Link href="/" aria-label="Algotraders24 AI home" onClick={closeMobile}>
          <BrandLogo variant="full" size="sm" />
        </Link>
        <button
          type="button"
          aria-label="Close navigation menu"
          onClick={closeMobile}
          className="flex h-9 w-9 items-center justify-center rounded-control text-text-2 transition hover:text-text"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <nav className="space-y-5 p-4">
        {DASHBOARD_NAV_GROUPS.map((group, groupIndex) => {
          const items = group.items.filter((item) => !item.adminOnly || user?.role === "admin");
          if (items.length === 0) return null;
          const groupKey = group.label ?? `ungrouped-${groupIndex}`;
          const isCollapsed = group.label ? (groupCollapsed[groupKey] ?? false) : false;

          return (
            <div key={groupKey}>
              {group.label && (
                <button
                  type="button"
                  onClick={() => setGroupCollapsed((prev) => ({ ...prev, [groupKey]: !isCollapsed }))}
                  aria-expanded={!isCollapsed}
                  className="flex w-full items-center justify-between px-3 pb-2 text-eyebrow uppercase text-text-3 transition hover:text-text-2"
                >
                  {group.label}
                  <ChevronDown size={12} className={`transition-transform ${isCollapsed ? "-rotate-90" : ""}`} aria-hidden="true" />
                </button>
              )}

              {!isCollapsed && (
                <div className="space-y-1">
                  {items.map((item) => {
                    const Icon = item.icon;
                    const children = item.children ?? [];
                    const hasChildren = children.length > 0;
                    const itemExpanded = hasChildren && isItemExpanded(item);
                    return (
                      <div key={item.href}>
                        <div className="flex items-center gap-1">
                          <Link
                            href={item.href}
                            onClick={closeMobile}
                            className={[
                              "flex flex-1 items-center gap-3 rounded-control px-3 py-2.5 text-sm transition",
                              isActive(pathname, item.href)
                                ? "bg-gold/10 font-semibold text-gold"
                                : "text-text-2 hover:bg-ink-3 hover:text-text",
                            ].join(" ")}
                          >
                            <Icon size={17} aria-hidden="true" className={isActive(pathname, item.href) ? "text-gold" : "text-text-3"} />
                            {item.label}
                          </Link>
                          {hasChildren && (
                            <button
                              type="button"
                              onClick={() => setExpandedItems((prev) => ({ ...prev, [item.href]: !itemExpanded }))}
                              aria-expanded={itemExpanded}
                              aria-label={`${itemExpanded ? "Collapse" : "Expand"} ${item.label}`}
                              className="rounded-control p-2 text-text-3 transition hover:bg-ink-3 hover:text-text"
                            >
                              <ChevronDown size={14} className={`transition-transform ${itemExpanded ? "" : "-rotate-90"}`} aria-hidden="true" />
                            </button>
                          )}
                        </div>
                        {hasChildren && itemExpanded && (
                          <div className="ml-6 mt-1 space-y-1 border-l border-border pl-3">
                            {children.map((child) => (
                              <Link
                                key={child.href}
                                href={child.href}
                                onClick={closeMobile}
                                className={[
                                  "block rounded-control px-2 py-1.5 text-sm transition",
                                  isActive(pathname, child.href) ? "text-gold" : "text-text-3 hover:text-text",
                                ].join(" ")}
                              >
                                {child.label}
                              </Link>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>
    </Drawer>
  );
}
