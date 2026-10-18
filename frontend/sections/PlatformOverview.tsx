// sections/PlatformOverview.tsx
// Sprint H1.4 Phase 2, upgraded in H1.5 - "What is Algotraders24 AI?" Real
// capabilities, each labeled honestly: nothing here is a marketing
// exaggeration or invented feature.
//
// Sprint D2.4.A2 - dropped the click-to-expand "How it works" detail text
// (already covered on each capability's dedicated /platform/* page).
//
// Sprint D2.4.A3 - homepage optimization pass. This section now replaces
// BOTH the old 4-card PlatformOverview AND the separate 8-chip
// PlatformModules section (deleted) with ONE curated 6-card grid - the
// same four capabilities plus Trading Workspace and Research, matching
// exactly what the /platform hub's first six cards already are. The
// remaining three modules (AI News, Trading Copilot, Automation, AI
// Agents are NOT among these six) still live in full on the /platform hub,
// reachable via "Explore All Modules" below - this is a curated subset for
// the homepage, not the full breadth, avoiding the repetition of two
// homepage sections both listing "AI Assistant" and "Market Intelligence."
import Link from "next/link";
import { MessagesSquare, Compass, BarChart3, PenLine, BookOpen, Microscope } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import RevealOnScroll from "@/components/motion/RevealOnScroll";

const CAPABILITIES: { title: string; description: string; href: string; icon: LucideIcon; group: "think" | "work" }[] = [
  {
    title: "AI Assistant",
    description: "A conversational interface grounded in real evidence, not a generic chatbot.",
    href: "/platform/assistant",
    icon: MessagesSquare,
    group: "think",
  },
  {
    title: "Trading Workspace",
    description: "The real dashboard — live snapshot, computed indicators, and an AI restatement.",
    href: "/platform/workspace",
    icon: Compass,
    group: "work",
  },
  {
    title: "Market Intelligence",
    description: "Evidence, reasoning, risk, and confidence, checked step by step, the same way every time.",
    href: "/platform/market-intelligence",
    icon: BarChart3,
    group: "think",
  },
  {
    title: "Publishing",
    description: "Turn a finished analysis into a scored, scheduled, publishable write-up.",
    href: "/platform/publishing",
    icon: PenLine,
    group: "work",
  },
  {
    title: "Knowledge Base",
    description: "A retrieval-augmented knowledge layer the Assistant draws on for grounded answers.",
    href: "/platform/knowledge-base",
    icon: BookOpen,
    group: "work",
  },
  {
    title: "Research",
    description: "Ask a question in plain language and get an answer backed by real reasoning.",
    href: "/platform/research",
    icon: Microscope,
    group: "think",
  },
] as const;

const GROUPS: { id: "think" | "work"; title: string; blurb: string }[] = [
  { id: "think", title: "How the AI thinks", blurb: "Evidence in, a reasoned answer out. You can see every step." },
  { id: "work", title: "How you work", blurb: "Where you look at markets, keep your notes and share what you write." },
];

export default function PlatformOverview() {
  return (
    <section className="bg-ink py-16 text-text md:py-24">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-gold">Platform Overview</p>
          <h2 className="mt-4 font-display text-4xl font-medium md:text-5xl">What is Algotraders24 AI?</h2>
          <p className="mt-5 text-lg text-text-2">
            Six tools, one engine. Here is how they fit together.
          </p>
        </div>

        <RevealOnScroll>
          {GROUPS.map((group) => (
            <div key={group.id} className="mt-14 first:mt-16">
              <h3 className="font-display text-2xl font-medium">{group.title}</h3>
              <p className="mt-1 text-sm text-text-2">{group.blurb}</p>
              <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {CAPABILITIES.filter((capability) => capability.group === group.id).map((capability) => (
                  <Link
                    key={capability.href}
                    href={capability.href}
                    className="group flex flex-col rounded-card border border-border bg-ink-2 p-6 transition-all duration-300 hover:-translate-y-1 hover:border-gold hover:shadow-raised"
                  >
                    <span className="flex h-11 w-11 items-center justify-center rounded-control border border-gold/30 bg-gold/10">
                      <capability.icon className="h-5 w-5 text-gold" aria-hidden="true" />
                    </span>
                    <h4 className="mt-5 text-lg font-semibold">{capability.title}</h4>
                    <p className="mt-2 text-sm leading-6 text-text-2">{capability.description}</p>
                    <span className="mt-4 text-sm font-semibold text-gold transition-colors group-hover:text-gold-strong">
                      Learn More →
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </RevealOnScroll>

        <div className="mt-10 text-center">
          <Link href="/platform" className="text-sm font-semibold text-gold transition-colors hover:text-gold-strong">
            Explore All Modules →
          </Link>
        </div>
      </div>
    </section>
  );
}
