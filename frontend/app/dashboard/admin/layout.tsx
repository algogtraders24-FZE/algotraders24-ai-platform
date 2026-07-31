// app/dashboard/admin/layout.tsx
// Sprint L2.6 - Phase 1: Admin Authentication & Authorization. Server-side
// guard using the existing, already-real requireRole("admin", ...) helper
// (lib/auth/protectedRoute.ts) - correctly implemented since Sprint 14C but
// never actually called anywhere until this sprint (see the L2.6 audit).
// A non-admin hitting any /dashboard/admin/* URL is redirected back to
// /dashboard before any admin page renders or fetches anything - this is
// the real, server-enforced gate; every API route under
// app/api/private/admin/* enforces the same check independently
// (lib/auth/adminRoute.ts) so the UI gate is never the only line of defense.
import Link from "next/link";
import { requireRole } from "@/lib/auth/protectedRoute";

const ADMIN_NAV = [
  { label: "Overview", href: "/dashboard/admin" },
  { label: "Users", href: "/dashboard/admin/users" },
  { label: "Subscriptions", href: "/dashboard/admin/subscriptions" },
  { label: "Knowledge", href: "/dashboard/admin/knowledge" },
  { label: "AI Usage Analytics", href: "/dashboard/admin/analytics" },
  { label: "System Health", href: "/dashboard/admin/health" },
  { label: "Audit Logs", href: "/dashboard/admin/audit-logs" },
  // Sprint R1.2
  { label: "Beta Overview", href: "/dashboard/admin/beta" },
  { label: "Feedback", href: "/dashboard/admin/feedback" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireRole("admin", "/dashboard");

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-white sm:text-3xl">Admin Control Center</h1>
        <p className="mt-1 text-sm text-slate-400">
          Real, database-backed platform administration. Every action here is audit-logged.
        </p>
      </header>

      <nav className="flex flex-wrap gap-2 border-b border-slate-800 pb-3">
        {ADMIN_NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-400 transition hover:bg-slate-900 hover:text-white"
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <div>{children}</div>
    </div>
  );
}
