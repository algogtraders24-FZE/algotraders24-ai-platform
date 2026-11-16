// app/solutions/page.tsx
// Solutions hub: every audience now has a real page (retail, professional, prop firms, brokers and platforms, funds and allocators).
import type { Metadata } from "next";
import Link from "next/link";
import { User, Briefcase, Building2, Landmark, Scale } from "lucide-react";
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
  { title: "Prop Firms", description: "Evidence and analytics services that sit next to your stack: rule monitoring, consistency checks, applicant and EA screening.", href: "/solutions/prop-firms", icon: Building2 },
  { title: "Brokers and Platforms", description: "Evidence-based market context for your clients, plus strategy-provider vetting. Pilot basis.", href: "/solutions/institutions", icon: Landmark },
  { title: "Hedge Funds and Allocators", description: "Auditable evidence tools for analysts, an independent volatility cross-check and a track-record screening aid. Not alpha. Pilot basis.", href: "/solutions/hedge-funds", icon: Scale },
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
        </div>
      </section>

      <Footer />
    </main>
  );
}
