"use client";

// Sprint D1.0 - Retrofitted onto the approved token system (ink/gold/
// border), previously bg-[#0C1324]/border-[#1F2937]/bg-blue-600/text-blue-
// 500 - a different, unrelated palette from the homepage's.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { DASHBOARD_NAV } from "@/config/dashboard.config";
import { useUserContext } from "@/context/UserContext";
import BrandLogo from "@/components/brand/BrandLogo";

export default function DashboardSidebar() {
  const pathname = usePathname();
  const { user } = useUserContext();
  // Sprint L2.6 - discoverability only; the real gate is server-side
  // (requireRole in app/dashboard/admin/layout.tsx).
  const items = DASHBOARD_NAV.filter((item) => !item.adminOnly || user?.role === "admin");

  return (
    <aside className="w-64 shrink-0 bg-ink-2 border-r border-border min-h-screen p-4 hidden md:block">
      <Link href="/" aria-label="Algotraders24 AI home" className="block px-3 py-4">
        <BrandLogo variant="full" size="sm" withDescriptor={false} />
      </Link>
      <nav className="mt-4 space-y-1">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center gap-3 rounded-control px-3 py-2 text-sm transition ${
              pathname === item.href
                ? "bg-gold/10 text-gold"
                : "text-text-2 hover:bg-ink-3 hover:text-text"
            }`}
          >
            <span>{item.icon}</span>
            {item.label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
