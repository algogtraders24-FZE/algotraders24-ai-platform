// app/resources/page.tsx
// Sprint D2.4.A1 - the Resources nav dropdown's landing page. FAQ is the one
// real destination. Phase 1 of the "Soon" items (Documentation, Tutorials,
// Release Notes, Research, Market Insights, Blog) now has real pages and is
// listed in LIVE below; only Roadmap is still named honestly as upcoming.
import type { Metadata } from "next";
import Link from "next/link";
import { HelpCircle, BookOpen, FileText, Map, ScrollText, GraduationCap, Newspaper, BarChart3 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/sections/Footer";
import PageHero from "@/components/marketing/PageHero";

export const metadata: Metadata = {
  title: "Resources",
  description: "FAQ, documentation, and guides for Algotraders24 AI.",
  alternates: { canonical: "/resources" },
};

const LIVE: { title: string; description: string; href: string; icon: LucideIcon }[] = [
  { title: "FAQ", description: "Questions, answered plainly — no hedging.", href: "/resources/faq", icon: HelpCircle },
  { title: "Documentation", description: "What each part of AT24 is and how it behaves.", href: "/resources/documentation", icon: BookOpen },
  { title: "Tutorials", description: "Step-by-step guides for the most common tasks.", href: "/resources/tutorials", icon: GraduationCap },
  { title: "Market Insights", description: "Daily, weekly and fundamental market reports.", href: "/resources/market-insights", icon: BarChart3 },
  { title: "Research", description: "What we tested, including what failed.", href: "/resources/research", icon: FileText },
  { title: "Release Notes", description: "What is new, in plain language.", href: "/resources/release-notes", icon: ScrollText },
  { title: "Blog", description: "Evidence-backed market analysis.", href: "/blog", icon: Newspaper },
];

const UPCOMING: { title: string; icon: LucideIcon }[] = [{ title: "Roadmap", icon: Map }];

export default function ResourcesHubPage() {
  return (
    <main className="min-h-screen bg-ink text-text">
      <Navbar />
      <PageHero eyebrow="Resources" title="Guides, answers, and documentation" />

      <section className="px-6 py-12">
        <div className="mx-auto max-w-4xl">
          <div className="grid gap-4 sm:grid-cols-2">
            {LIVE.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="group flex items-center gap-4 rounded-card border border-border bg-ink-2 p-6 transition-all duration-300 hover:-translate-y-1 hover:border-gold hover:shadow-raised"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control border border-gold/30 bg-gold/10">
                  <item.icon className="h-5 w-5 text-gold" aria-hidden="true" />
                </span>
                <div>
                  <h2 className="text-lg font-semibold">{item.title}</h2>
                  <p className="mt-1 text-sm leading-6 text-text-2">{item.description}</p>
                </div>
              </Link>
            ))}
          </div>

          <p className="mt-10 text-center text-xs font-semibold uppercase tracking-[0.2em] text-text-3">Coming soon</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {UPCOMING.map((item) => (
              <div
                key={item.title}
                className="flex items-center gap-3 rounded-card border border-dashed border-border bg-ink-2/50 p-5 opacity-70"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control border border-border">
                  <item.icon className="h-4 w-4 text-text-3" aria-hidden="true" />
                </span>
                <span className="text-sm font-medium text-text-2">{item.title}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
