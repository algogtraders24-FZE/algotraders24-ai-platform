"use client";

// components/dashboard/DashboardSidebar.tsx
// Sprint D1.0 - Retrofitted onto the approved token system (ink/gold/border).
// Sprint IA1 - renders the grouped/nested DASHBOARD_NAV_GROUPS (the locked
// AT24 IA) instead of the old flat list.
// Sprint IA2 - group headers and items-with-children are click-to-expand.
// Sprint UI-01 - AT24 Premium UI Foundation. The desktop rail now has two
// states driven by SidebarContext:
//   - expanded  (var(--sidebar-w))          : icon + label, group headings,
//                                             inline child disclosure.
//   - collapsed (var(--sidebar-w-collapsed)): icon-only. Childless items get
//                                             a hover tooltip; parents get a
//                                             hover flyout listing children.
// Nav icons are now real lucide components (config change, not an IA change).
// A persisted collapse toggle sits at the foot of the rail. The mobile
// (< md) presentation is unchanged and still lives in MobileNav.
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { DASHBOARD_NAV_GROUPS, type DashboardNavItem } from "@/config/dashboard.config";
import { useUserContext } from "@/context/UserContext";
import { useSidebar } from "@/components/shell/SidebarContext";
import BrandLogo from "@/components/brand/BrandLogo";

function isActive(pathname: string, href: string): boolean {
  // Exact match, or a descendant route (but "/dashboard" must not light up
  // for every /dashboard/* page).
  if (pathname === href) return true;
  if (href === "/dashboard") return false;
  const base = href.split("#")[0];
  return pathname.startsWith(`${base}/`);
}

export default function DashboardSidebar() {
  const pathname = usePathname();
  const { user } = useUserContext();
  const { collapsed, ready, toggleCollapsed } = useSidebar();
  const [groupCollapsed, setGroupCollapsed] = useState<Record<string, boolean>>({});
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({});

  const isItemExpanded = (item: DashboardNavItem): boolean => {
    const explicit = expandedItems[item.href];
    if (explicit !== undefined) return explicit;
    return isActive(pathname, item.href) || (item.children ?? []).some((c) => isActive(pathname, c.href));
  };

  return (
    <aside
      data-collapsed={collapsed || undefined}
      className={[
        "sticky top-0 hidden h-screen shrink-0 flex-col overflow-y-auto border-r border-border bg-ink-2 md:flex",
        ready ? "transition-[width] duration-200 ease-out" : "",
        collapsed ? "w-[var(--sidebar-w-collapsed)] px-2 py-3" : "w-[var(--sidebar-w)] px-3 py-4",
      ].join(" ")}
    >
      <Link href="/" aria-label="Algotraders24 AI home" className={collapsed ? "flex justify-center py-2" : "block px-2 py-2"}>
        <BrandLogo variant={collapsed ? "icon" : "full"} size="sm" withDescriptor={false} />
      </Link>

      <nav className={collapsed ? "mt-3 flex-1 space-y-2" : "mt-3 flex-1 space-y-5"}>
        {DASHBOARD_NAV_GROUPS.map((group, groupIndex) => {
          // Sprint L2.6 - discoverability only; the real gate is server-side.
          const items = group.items.filter((item) => !item.adminOnly || user?.role === "admin");
          if (items.length === 0) return null;
          const groupKey = group.label ?? `ungrouped-${groupIndex}`;
          const headingCollapsed = group.label ? (groupCollapsed[groupKey] ?? false) : false;

          return (
            <div key={groupKey} className={collapsed && groupIndex > 0 ? "border-t border-border pt-2" : ""}>
              {group.label && !collapsed && (
                <button
                  type="button"
                  onClick={() => setGroupCollapsed((prev) => ({ ...prev, [groupKey]: !headingCollapsed }))}
                  aria-expanded={!headingCollapsed}
                  className="flex w-full items-center justify-between px-3 pb-2 text-eyebrow uppercase text-text-3 transition hover:text-text-2"
                >
                  {group.label}
                  <ChevronDown size={12} className={`transition-transform ${headingCollapsed ? "-rotate-90" : ""}`} aria-hidden="true" />
                </button>
              )}

              {!headingCollapsed && (
                <div className="space-y-1">
                  {items.map((item) => (
                    <NavRow
                      key={item.href}
                      item={item}
                      collapsed={collapsed}
                      pathname={pathname}
                      expanded={(item.children?.length ?? 0) > 0 && isItemExpanded(item)}
                      onToggleChildren={() => setExpandedItems((prev) => ({ ...prev, [item.href]: !isItemExpanded(item) }))}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <button
        type="button"
        onClick={toggleCollapsed}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        className={[
          "mt-2 flex items-center gap-2 rounded-control border border-border text-text-3 transition hover:border-gold/50 hover:text-text",
          collapsed ? "justify-center p-2" : "px-3 py-2 text-sm",
        ].join(" ")}
      >
        {collapsed ? (
          <PanelLeftOpen size={16} aria-hidden="true" />
        ) : (
          <>
            <PanelLeftClose size={16} aria-hidden="true" />
            Collapse
          </>
        )}
      </button>
    </aside>
  );
}

function NavRow({
  item,
  collapsed,
  pathname,
  expanded,
  onToggleChildren,
}: {
  item: DashboardNavItem;
  collapsed: boolean;
  pathname: string;
  expanded: boolean;
  onToggleChildren: () => void;
}) {
  const Icon = item.icon;
  const children = item.children ?? [];
  const hasChildren = children.length > 0;
  const active = isActive(pathname, item.href);

  // --- Collapsed rail: icon only, with a hover tooltip / child flyout. ---
  if (collapsed) {
    return (
      <div className="group/nav relative">
        <Link
          href={item.href}
          aria-label={item.label}
          className={[
            "flex items-center justify-center rounded-control p-2.5 transition",
            active ? "bg-gold/10 text-gold" : "text-text-3 hover:bg-ink-3 hover:text-text",
          ].join(" ")}
        >
          <Icon size={19} aria-hidden="true" />
        </Link>
        <div
          role="tooltip"
          className="pointer-events-none absolute left-full top-0 z-40 ml-2 hidden min-w-40 rounded-card border border-border bg-ink-2 p-1.5 shadow-floating group-hover/nav:block"
        >
          <p className="px-2 py-1 text-xs font-semibold text-text">{item.label}</p>
          {hasChildren && (
            <div className="mt-0.5 border-t border-border pt-1">
              {children.map((child) => (
                <Link
                  key={child.href}
                  href={child.href}
                  className={[
                    "pointer-events-auto block rounded-control px-2 py-1.5 text-xs transition",
                    isActive(pathname, child.href) ? "text-gold" : "text-text-3 hover:bg-ink-3 hover:text-text",
                  ].join(" ")}
                >
                  {child.label}
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // --- Expanded rail: icon + label, inline child disclosure. ---
  return (
    <div>
      <div className="flex items-center gap-1">
        <Link
          href={item.href}
          className={[
            "flex flex-1 items-center gap-3 rounded-control px-3 py-2 text-sm transition",
            active ? "bg-gold/10 font-semibold text-gold" : "text-text-2 hover:bg-ink-3 hover:text-text",
          ].join(" ")}
        >
          <Icon size={17} aria-hidden="true" className={active ? "text-gold" : "text-text-3"} />
          {item.label}
        </Link>
        {hasChildren && (
          <button
            type="button"
            onClick={onToggleChildren}
            aria-expanded={expanded}
            aria-label={`${expanded ? "Collapse" : "Expand"} ${item.label}`}
            className="rounded-control p-2 text-text-3 transition hover:bg-ink-3 hover:text-text"
          >
            <ChevronDown size={14} className={`transition-transform ${expanded ? "" : "-rotate-90"}`} aria-hidden="true" />
          </button>
        )}
      </div>
      {hasChildren && expanded && (
        <div className="ml-6 mt-1 space-y-1 border-l border-border pl-3">
          {children.map((child) => (
            <Link
              key={child.href}
              href={child.href}
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
}
