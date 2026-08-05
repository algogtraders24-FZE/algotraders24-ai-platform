// app/resources/page.tsx
// Sprint D2.4.A1 - the Resources nav dropdown's landing page. FAQ is the one
// real destination; the rest (Blog, Documentation, Roadmap, Release Notes,
// Research Papers, Tutorials) are named honestly as upcoming rather than
// each getting its own empty page - per the approved D2.4.A1 IA plan
// (Phase 2, gated on real content).
import type { Metadata } from "next";
import Link from "next/link";
import { HelpCircle, BookOpen, FileText, Map, ScrollText, GraduationCap, Newspaper } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/sections/Footer";
import PageHero from "@/components/marketing/PageHero";

export const metadata: Metadata = {
  title: "Resources",
  description: "FAQ, documentation, and guides for Algotraders24 AI.",
  alternates: { canonical: "/resources" },
};

const LIVE: { title: string; description: string; href: string; icon: LucideIcon } = {
  title: "FAQ",
  description: "Questions, answered plainly — no hedging.",
  href: "/resources/faq",
  icon: HelpCircle,
};

const UPCOMING: { title: string; icon: LucideIcon }[] = [
  { title: "Blog", icon: Newspaper },
  { title: "Documentation", icon: BookOpen },
  { title: "Roadmap", icon: Map },
  { title: "Release Notes", icon: ScrollText },
  { title: "Research Papers", icon: FileText },
  { title: "Tutorials", icon: GraduationCap },
];

export default function ResourcesHubPage() {
  return (
    <main className="min-h-screen bg-ink text-text">
      <Navbar />
      <PageHero eyebrow="Resources" title="Guides, answers, and documentation" />

      <section className="px-6 py-12">
        <div className="mx-auto max-w-4xl">
          <Link
            href={LIVE.href}
            className="group flex items-center gap-4 rounded-card border border-border bg-ink-2 p-6 transition-all duration-300 hover:-translate-y-1 hover:border-gold hover:shadow-raised"
          >
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control border border-gold/30 bg-gold/10">
              <LIVE.icon className="h-5 w-5 text-gold" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-lg font-semibold">{LIVE.title}</h2>
              <p className="mt-1 text-sm leading-6 text-text-2">{LIVE.description}</p>
            </div>
          </Link>

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
