"use client";

// components/shell/Topbar.tsx
// Sprint UI-01 - AT24 Premium UI Foundation. The one sticky top bar for
// every authenticated route. Replaces the previous DashboardHeader
// (breadcrumb + avatar menu only) and adds two reusable slots wired for
// future backends: GlobalSearch (Cmd/Ctrl+K) and NotificationBell.
//   left  : mobile menu button (< md) + breadcrumb label
//   right : search · notifications · account menu
// Breadcrumb text comes from getBreadcrumbLabel, which walks the same nav
// data the sidebar renders (one source of truth for "what is this page").
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { signOutAction } from "@/app/(auth)/actions/auth.actions";
import { getBreadcrumbLabel } from "@/config/dashboard.config";
import { useSidebar } from "@/components/shell/SidebarContext";
import Dropdown from "@/components/ui/Dropdown";
import GlobalSearch from "@/components/shell/GlobalSearch";
import NotificationBell from "@/components/shell/NotificationBell";

export default function Topbar({ userName }: { userName: string }) {
  const pathname = usePathname();
  const { openMobile } = useSidebar();
  const initial = userName.trim().charAt(0).toUpperCase() || "?";

  return (
    <header className="sticky top-0 z-30 flex h-[var(--topbar-h)] items-center justify-between gap-3 border-b border-border bg-ink/80 px-4 backdrop-blur-sm md:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          aria-label="Open navigation menu"
          onClick={openMobile}
          className="flex h-9 w-9 items-center justify-center rounded-control border border-border text-text-2 transition hover:border-gold/40 md:hidden"
        >
          <Menu size={18} aria-hidden="true" />
        </button>
        <span className="truncate text-sm text-text-3">{getBreadcrumbLabel(pathname)}</span>
      </div>

      <div className="flex items-center gap-2 sm:gap-3">
        <GlobalSearch />
        <NotificationBell />
        <Dropdown
          trigger={
            <span className="flex items-center gap-2.5">
              <span className="hidden text-sm text-text-2 sm:inline">{userName}</span>
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gold/15 text-sm font-bold text-gold">
                {initial}
              </span>
            </span>
          }
          items={[{ label: "Sign out", tone: "danger", onSelect: () => void signOutAction() }]}
        />
      </div>
    </header>
  );
}
