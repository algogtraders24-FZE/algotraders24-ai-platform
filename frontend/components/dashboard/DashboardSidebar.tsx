"use client";

// Sprint D1.0 - Retrofitted onto the approved token system (ink/gold/
// border), previously bg-[#0C1324]/border-[#1F2937]/bg-blue-600/text-blue-
// 500 - a different, unrelated palette from the homepage's.
// Sprint IA1 - Backoffice IA refactor. Renders the new grouped/nested
// DASHBOARD_NAV_GROUPS (section headings + optional child links) instead
// of the old flat DASHBOARD_NAV list.
// Sprint IA2 - group headers (PRODUCTS/INTELLIGENCE/AUTOMATION/WORKSPACE/
// ACCOUNT) are collapsible, and items that carry `children` (Quant,
// Marketplace, AI Assistant, Automations, Settings) render as their own
// click-to-expand dropdown instead of always showing their children
// inline. A dropdown defaults open only when the active page is the item
// itself or one of its children (so the current location is never hidden
// on load); otherwise closed until toggled. Plain in-memory state, not
// persisted - the sidebar lives in the shared dashboard layout and
// survives client-side navigation, so this only resets on a hard reload.
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { DASHBOARD_NAV_GROUPS, type DashboardNavItem } from "@/config/dashboard.config";
import { useUserContext } from "@/context/UserContext";
import BrandLogo from "@/components/brand/BrandLogo";

export default function DashboardSidebar() {
  const pathname = usePathname();
  const { user } = useUserContext();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({});

  const isItemExpanded = (item: DashboardNavItem): boolean => {
    const explicit = expandedItems[item.href];
    if (explicit !== undefined) return explicit;
    return pathname === item.href || (item.children ?? []).some((c) => c.href === pathname);
  };

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
          const groupKey = group.label ?? `ungrouped-${groupIndex}`;
          const isCollapsed = group.label ? (collapsed[groupKey] ?? false) : false;
          return (
            <div key={groupKey}>
              {group.label && (
                <button
                  type="button"
                  onClick={() => setCollapsed((prev) => ({ ...prev, [groupKey]: !isCollapsed }))}
                  aria-expanded={!isCollapsed}
                  className="flex w-full items-center justify-between px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-text-3 transition hover:text-text-2"
                >
                  {group.label}
                  <ChevronDown size={12} className={`transition-transform ${isCollapsed ? "-rotate-90" : ""}`} aria-hidden="true" />
                </button>
              )}
              {!isCollapsed && (
              <div className="space-y-1">
                {items.map((item) => {
                  const children = item.children ?? [];
                  const hasChildren = children.length > 0;
                  const itemExpanded = hasChildren && isItemExpanded(item);
                  return (
                    <div key={item.href}>
                      <div className="flex items-center gap-1">
                        <Link
                          href={item.href}
                          className={`flex flex-1 items-center gap-3 rounded-control px-3 py-2 text-sm transition ${
                            pathname === item.href
                              ? "bg-gold/10 text-gold"
                              : "text-text-2 hover:bg-ink-3 hover:text-text"
                          }`}
                        >
                          <span className="font-mono text-xs text-text-3">{item.icon}</span>
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
                          {item.children!.map((child) => (
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
                  );
                })}
              </div>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
