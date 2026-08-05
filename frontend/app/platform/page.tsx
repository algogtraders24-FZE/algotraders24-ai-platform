// app/platform/page.tsx
// Sprint D2.4.A1 - the Platform nav dropdown's landing page. Card grid
// mirrors sections/PlatformModules.tsx's pattern for the 6 modules that
// have a dedicated marketing page (Research redirects to Assistant - see
// that route - so it isn't a 7th card here).
import type { Metadata } from "next";
import Link from "next/link";
import {
  MessagesSquare,
  BarChart3,
  Compass,
  PenLine,
  BookOpen,
  ArrowUpRight,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/sections/Footer";
import PageHero from "@/components/marketing/PageHero";

export const metadata: Metadata = {
  title: "Platform",
  description: "The six modules of the Algotraders24 AI platform, all reasoning from the same deterministic evidence layer.",
  alternates: { canonical: "/platform" },
};

const MODULES: { title: string; description: string; href: string; icon: LucideIcon }[] = [
  {
    title: "AI Assistant",
    description: "A conversational interface grounded in real, indexed evidence — not a generic chatbot.",
    href: "/platform/assistant",
    icon: MessagesSquare,
  },
  {
    title: "Market Intelligence",
    description: "Evidence, reasoning, risk, and confidence, run through a deterministic pipeline in full view.",
    href: "/platform/market-intelligence",
    icon: BarChart3,
  },
  {
    title: "Trading Workspace",
    description: "The real dashboard — live snapshot, computed indicators, and an AI restatement, never a mockup.",
    href: "/platform/workspace",
    icon: Compass,
  },
  {
    title: "Publishing",
    description: "Turn a finished analysis into a scored, scheduled, publishable write-up.",
    href: "/platform/publishing",
    icon: PenLine,
  },
  {
    title: "Knowledge Base",
    description: "A retrieval-augmented knowledge layer the Assistant draws on for grounded, sourced answers.",
    href: "/platform/knowledge-base",
    icon: BookOpen,
  },
];

export default function PlatformHubPage() {
  return (
    <main className="min-h-screen bg-ink text-text">
      <Navbar />
      <PageHero
        eyebrow="Platform"
        title="One platform, every part of the workflow"
        subtitle="Six modules on one shared foundation — every module reasons over the same evidence, the same way."
      />
      <section className="px-6 py-16">
        <div className="mx-auto grid max-w-6xl gap-6 sm:grid-cols-2 lg:grid-cols-3">
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
                <ArrowUpRight className="h-4 w-4 text-text-3 transition-colors group-hover:text-gold" aria-hidden="true" />
              </div>
              <h2 className="mt-5 text-lg font-semibold">{module.title}</h2>
              <p className="mt-2 text-sm leading-6 text-text-2">{module.description}</p>
            </Link>
          ))}
        </div>
      </section>
      <Footer />
    </main>
  );
}
