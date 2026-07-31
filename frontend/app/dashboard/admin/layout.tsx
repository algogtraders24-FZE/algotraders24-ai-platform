// app/dashboard/admin/layout.tsx
// Sprint L2.6 - Phase 1: server-side requireRole("admin") gate before any
// admin page renders. Every API route under /api/private/admin/* enforces
// the same check independently, so the UI gate is never the only defense.
// Sprint D1.0 - Retrofitted onto AdminNavTabs (the shared Tabs primitive's
// visual language) + tokens (slate chrome -> border/text). The nav is a set
// of route Links styled as tabs, so it keeps working without JS.
import { requireRole } from "@/lib/auth/protectedRoute";
import AdminNavTabs from "@/components/admin/AdminNavTabs";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireRole("admin", "/dashboard");

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-text sm:text-3xl">Admin Control Center</h1>
        <p className="mt-1 text-sm text-text-2">
          Real, database-backed platform administration. Every action here is audit-logged.
        </p>
      </header>

      <AdminNavTabs />

      <div>{children}</div>
    </div>
  );
}
