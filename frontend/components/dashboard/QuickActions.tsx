// components/dashboard/QuickActions.tsx
// Sprint L2.3 - 2 of the previous 4 actions ("My Downloads", "Support")
// pointed at routes that don't exist - replaced with the platform's actual
// real capabilities, all verified to resolve to a real page.
// Sprint D1.0 - Retrofitted onto the Card primitive/token system
// (bg-[#0C1324]/bg-[#111827]/hover:border-blue-500 -> ink-2/ink-3/gold).
import Link from "next/link";
import Card from "@/components/ui/Card";

const ACTIONS = [
  { label: "Ask AI Assistant", href: "/dashboard/assistant", icon: "🤖" },
  { label: "Upload Document", href: "/dashboard/knowledge", icon: "📄" },
  { label: "Market Intelligence", href: "/dashboard/market-intelligence", icon: "📊" },
  { label: "Browse Products", href: "/products", icon: "📦" },
];

export default function QuickActions() {
  return (
    <Card>
      <h3 className="font-bold mb-4 text-text">Quick Actions</h3>
      <div className="grid grid-cols-2 gap-3">
        {ACTIONS.map((a) => (
          <Link
            key={a.href}
            href={a.href}
            className="flex items-center gap-2 rounded-control bg-ink-3 border border-border px-4 py-3 text-sm text-text-2 transition hover:border-gold/60 hover:text-text"
          >
            <span>{a.icon}</span>
            {a.label}
          </Link>
        ))}
      </div>
    </Card>
  );
}
