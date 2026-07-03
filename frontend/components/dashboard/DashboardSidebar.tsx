"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DASHBOARD_NAV } from "@/config/dashboard.config";

export default function DashboardSidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 shrink-0 bg-[#0C1324] border-r border-[#1F2937] min-h-screen p-4 hidden md:block">
      <Link href="/" className="block text-lg font-bold px-3 py-4">
        Algotraders<span className="text-blue-500">24</span> AI
      </Link>
      <nav className="mt-4 space-y-1">
        {DASHBOARD_NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition ${
              pathname === item.href
                ? "bg-blue-600 text-white"
                : "text-gray-400 hover:bg-[#111827] hover:text-white"
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