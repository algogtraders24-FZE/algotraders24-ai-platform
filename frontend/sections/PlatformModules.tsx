// sections/PlatformModules.tsx
// Sprint D2.1 (Phase 5/6) - the platform's breadth, finally surfaced on the
// homepage. Every card maps to a REAL dashboard route (verified against
// config/dashboard.config.ts and the app/dashboard tree) - nothing here is
// an invented or "coming soon" feature. Descriptions are deliberately
// capability-level, not data-level: several of these modules run on seeded/
// mock content today, so the copy describes what each module IS and the
// shape of what it does, never claiming a specific live market result.
//
// "AI Signals" is a real module but is intentionally not featured here: the
// whole point of this homepage is to read as an AI Trading Intelligence
// Platform, not a signal-selling site. Omitting it from a curated showcase
// is an editorial choice, not a fabrication - it remains fully available
// inside the dashboard.
//
// Sprint D2.4.A2 - homepage compression dropped the per-card description
// paragraph (icon + title chips only now). Every description is preserved,
// unabridged, on the /platform hub page's now nine-module grid - this is a
// shorter view of the same list, not a smaller list.
//
// Server Component: static content + links, no interactivity needed.
import Link from "next/link";
import {
  MessagesSquare,
  BarChart3,
  Newspaper,
  Compass,
  Workflow,
  Bot,
  BookOpen,
  PenLine,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

const MODULES: { title: string; href: string; icon: LucideIcon }[] = [
  { title: "AI Assistant", href: "/dashboard/assistant", icon: MessagesSquare },
  { title: "Market Intelligence", href: "/dashboard/market-intelligence", icon: BarChart3 },
  { title: "AI News", href: "/dashboard/news", icon: Newspaper },
  { title: "Trading Copilot", href: "/dashboard/trading-copilot", icon: Compass },
  { title: "Automation", href: "/dashboard/automation", icon: Workflow },
  { title: "AI Agents", href: "/dashboard/agents", icon: Bot },
  { title: "Knowledge Base", href: "/dashboard/knowledge", icon: BookOpen },
  { title: "Publishing", href: "/dashboard/publishing", icon: PenLine },
];

export default function PlatformModules() {
  return (
    <section className="bg-ink py-16 text-text md:py-24">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-gold">Platform Modules</p>
          <h2 className="mt-4 font-display text-4xl font-medium md:text-5xl">One platform, every part of the workflow</h2>
          <p className="mt-5 text-lg text-text-2">
            Eight modules on one shared foundation — every module reasons over the same evidence, the same way.
          </p>
        </div>

        <div className="mt-10 flex flex-wrap justify-center gap-3">
          {MODULES.map((module) => (
            <Link
              key={module.href}
              href={module.href}
              className="group flex items-center gap-2.5 rounded-control border border-border bg-ink-2 px-4 py-2.5 text-sm font-medium text-text transition-colors hover:border-gold"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-control border border-gold/30 bg-gold/10">
                <module.icon className="h-3.5 w-3.5 text-gold" aria-hidden="true" />
              </span>
              {module.title}
            </Link>
          ))}
        </div>

        <div className="mt-8 text-center">
          <Link href="/platform" className="text-sm font-semibold text-gold transition-colors hover:text-gold-strong">
            Explore the Platform →
          </Link>
        </div>
      </div>
    </section>
  );
}
