// components/dashboard/QuickActions.tsx
// Sprint L2.3 - 2 of the previous 4 actions pointed at routes that don't
// exist - replaced with the platform's actual real capabilities, all
// verified to resolve to a real page.
// Sprint D1.0 - Retrofitted onto the Card primitive/token system.
// Sprint UI-01 - real lucide icons instead of emoji, matching the rest of
// the shell (sidebar, topbar). Same 4 actions.
// Beta content pass (reapplied post-UI-01) - "Browse Products" linked to
// /products, a redirect-only route into /marketplace (app/products/page.tsx)
// - relabeled to match the product's own locked "Marketplace" naming
// (Navbar/Footer/dashboard nav all use it) and linked directly, no redirect
// hop.
import Link from "next/link";
import { Bot, Upload, LineChart, Package } from "lucide-react";
import Card from "@/components/ui/Card";

const ACTIONS = [
  { label: "Ask AI Assistant", href: "/dashboard/assistant", icon: Bot },
  { label: "Upload Document", href: "/dashboard/knowledge", icon: Upload },
  { label: "Market Intelligence", href: "/dashboard/market-intelligence", icon: LineChart },
  { label: "Browse Marketplace", href: "/marketplace", icon: Package },
] as const;

export default function QuickActions() {
  return (
    <Card>
      <h3 className="text-title text-text">Quick actions</h3>
      <div className="mt-4 grid grid-cols-2 gap-3">
        {ACTIONS.map((a) => (
          <Link
            key={a.href}
            href={a.href}
            className="flex items-center gap-2.5 rounded-control border border-border bg-ink-3 px-4 py-3 text-sm text-text-2 transition hover:border-gold/60 hover:text-text"
          >
            <a.icon size={16} className="shrink-0 text-text-3" aria-hidden="true" />
            {a.label}
          </Link>
        ))}
      </div>
    </Card>
  );
}
