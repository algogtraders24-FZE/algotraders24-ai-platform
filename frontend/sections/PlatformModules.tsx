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
  ArrowUpRight,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

const MODULES: { title: string; description: string; href: string; icon: LucideIcon }[] = [
  {
    title: "AI Assistant",
    description: "Ask in plain language and get an answer grounded in real, attributed evidence — not open-ended chat.",
    href: "/dashboard/assistant",
    icon: MessagesSquare,
  },
  {
    title: "Market Intelligence",
    description: "Run the full deterministic pipeline on a market — evidence, reasoning, risk, and confidence in one explainable result.",
    href: "/dashboard/market-intelligence",
    icon: BarChart3,
  },
  {
    title: "AI News",
    description: "Market news, an economic calendar, and headline-impact summaries — context you can trace, not just a feed.",
    href: "/dashboard/news",
    icon: Newspaper,
  },
  {
    title: "Trading Copilot",
    description: "A guided market read — bias, confidence, technical view, and a structured setup, each with its reasoning shown.",
    href: "/dashboard/trading-copilot",
    icon: Compass,
  },
  {
    title: "Automation",
    description: "Compose workflows that run research and monitoring on a schedule, with a full, inspectable run history.",
    href: "/dashboard/automation",
    icon: Workflow,
  },
  {
    title: "AI Agents",
    description: "Configure focused agents with their own tasks and memory, all working from the same evidence layer.",
    href: "/dashboard/agents",
    icon: Bot,
  },
  {
    title: "Knowledge Base",
    description: "A retrieval-augmented knowledge layer the Assistant draws on for grounded, sourced answers.",
    href: "/dashboard/knowledge",
    icon: BookOpen,
  },
  {
    title: "Publishing",
    description: "Turn a finished analysis into a scored, scheduled, publishable write-up — analysis made shareable.",
    href: "/dashboard/publishing",
    icon: PenLine,
  },
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

        <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {MODULES.map((module) => (
            <Link
              key={module.href}
              href={module.href}
              className="group flex flex-col rounded-card border border-border bg-ink-2 p-6 transition-all duration-300 hover:-translate-y-1 hover:border-gold hover:shadow-raised"
            >
              <div className="flex items-center justify-between">
                <span className="flex h-11 w-11 items-center justify-center rounded-control border border-gold/30 bg-gold/10">
                  <module.icon className="h-5 w-5 text-gold" aria-hidden="true" />
                </span>
                <ArrowUpRight
                  className="h-4 w-4 text-text-3 transition-colors group-hover:text-gold"
                  aria-hidden="true"
                />
              </div>
              <h3 className="mt-5 text-lg font-semibold">{module.title}</h3>
              <p className="mt-2 text-sm leading-6 text-text-2">{module.description}</p>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
