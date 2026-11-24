// app/tools/page.tsx
// Hub of the free public trading calculators (no login).
import type { Metadata } from "next";
import Link from "next/link";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/sections/Footer";
import PageHero from "@/components/marketing/PageHero";
import { TOOL_PAGES } from "@/lib/tools/pages";

export const metadata: Metadata = {
  title: "Free Trading Calculators",
  description: "Free calculators for traders, no login: position size, pip value, risk reward and drawdown recovery for forex and gold.",
  alternates: { canonical: "/tools" },
};

export default function ToolsHubPage() {
  return (
    <main className="min-h-screen bg-ink text-text">
      <Navbar />
      <PageHero eyebrow="Free tools" title="Free trading calculators" subtitle="Position size, pip value, risk reward and drawdown recovery. No login, no sign-up, just the arithmetic." />
      <section className="px-6 pb-16 pt-6">
        <div className="mx-auto grid max-w-4xl gap-4 sm:grid-cols-2">
          {TOOL_PAGES.map((t) => (
            <Link key={t.slug} href={`/tools/${t.slug}`} className="rounded-panel border border-border bg-ink-2 p-6 transition hover:border-gold">
              <h2 className="text-lg font-semibold text-text">{t.short}</h2>
              <p className="mt-2 text-sm leading-6 text-text-2">{t.description}</p>
            </Link>
          ))}
        </div>
        <p className="mx-auto mt-10 max-w-3xl text-xs leading-6 text-text-3">
          General education and arithmetic only, not financial advice. Trading involves risk and many traders lose money.
        </p>
      </section>
      <Footer />
    </main>
  );
}
