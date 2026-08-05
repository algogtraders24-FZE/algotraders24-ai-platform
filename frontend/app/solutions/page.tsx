// app/solutions/page.tsx
// Sprint D2.4.A1 - Retail Traders and Professional Traders ship as real
// pages per the user's Phase-1 amendment; Prop Firms, Hedge Funds, and
// Brokers remain honestly labeled upcoming (no real audience-specific
// content exists for them yet) rather than each getting a fabricated page.
import type { Metadata } from "next";
import Link from "next/link";
import { User, Briefcase, Building2, Landmark, Network } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/sections/Footer";
import PageHero from "@/components/marketing/PageHero";

export const metadata: Metadata = {
  title: "Solutions",
  description: "Algotraders24 AI for retail traders, professional traders, and beyond.",
  alternates: { canonical: "/solutions" },
};

const LIVE: { title: string; description: string; href: string; icon: LucideIcon }[] = [
  { title: "Retail Traders", description: "Explainable decision support, starting on the Free plan.", href: "/solutions/retail-traders", icon: User },
  { title: "Professional Traders", description: "Auditable, category-level reasoning you can verify, not just trust.", href: "/solutions/professional-traders", icon: Briefcase },
];

const UPCOMING: { title: string; icon: LucideIcon }[] = [
  { title: "Prop Firms", icon: Building2 },
  { title: "Hedge Funds", icon: Landmark },
  { title: "Brokers", icon: Network },
];

export default function SolutionsHubPage() {
  return (
    <main className="min-h-screen bg-ink text-text">
      <Navbar />
      <PageHero eyebrow="Solutions" title="Built for how you actually trade" />

      <section className="px-6 py-12">
        <div className="mx-auto max-w-4xl">
          <div className="grid gap-6 sm:grid-cols-2">
            {LIVE.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="group flex items-start gap-4 rounded-card border border-border bg-ink-2 p-6 transition-all duration-300 hover:-translate-y-1 hover:border-gold hover:shadow-raised"
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
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
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
