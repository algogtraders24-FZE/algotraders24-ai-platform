// components/dashboard/QuickActions.tsx
// Sprint L2.3 - 2 of the previous 4 actions ("My Downloads", "Support")
// pointed at routes that don't exist (/dashboard/downloads, /contact -
// confirmed via filesystem search). Replaced with the platform's actual
// real capabilities, all verified to resolve to a real page.
import Link from "next/link";

const ACTIONS = [
  { label: "Ask AI Assistant", href: "/dashboard/assistant", icon: "🤖" },
  { label: "Upload Document", href: "/dashboard/knowledge", icon: "📄" },
  { label: "Market Intelligence", href: "/dashboard/market-intelligence", icon: "📊" },
  { label: "Browse Products", href: "/products", icon: "📦" },
];

export default function QuickActions() {
  return (
    <div className="rounded-2xl bg-[#0C1324] border border-[#1F2937] p-6">
      <h3 className="font-bold mb-4">Quick Actions</h3>
      <div className="grid grid-cols-2 gap-3">
        {ACTIONS.map((a) => (
          <Link
            key={a.href}
            href={a.href}
            className="flex items-center gap-2 rounded-xl bg-[#111827] border border-[#1F2937] px-4 py-3 text-sm hover:border-blue-500 transition"
          >
            <span>{a.icon}</span>
            {a.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
