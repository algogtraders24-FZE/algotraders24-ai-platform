// components/shell/AppShell.tsx
// Sprint UI-01 - AT24 Premium UI Foundation. The one layout wrapper for
// every authenticated route (app/dashboard/layout.tsx). Owns the shell
// geometry so no page hand-rolls its own sidebar/topbar/content column:
//   - SidebarProvider: shared collapse + mobile-drawer state
//   - DashboardSidebar: desktop rail (expanded / collapsed)
//   - MobileNav: the < md slide-in Drawer (same nav data)
//   - Topbar: sticky header with breadcrumb, search, notifications, account
//   - <main>: a centered, gutter-padded content column (max var(--app-max-w))
// Server component: it only composes. All interactivity lives in the
// children it renders (SidebarProvider, Sidebar, Topbar are "use client").
import type { ReactNode } from "react";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import MobileNav from "@/components/dashboard/MobileNav";
import Topbar from "@/components/shell/Topbar";
import { SidebarProvider } from "@/components/shell/SidebarContext";

export default function AppShell({ userName, children }: { userName: string; children: ReactNode }) {
  return (
    <SidebarProvider>
      <div className="flex min-h-screen bg-ink text-text">
        <DashboardSidebar />
        <MobileNav />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar userName={userName} />
          <main id="dashboard-main" className="flex-1">
            <div className="mx-auto w-full max-w-[var(--app-max-w)] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
