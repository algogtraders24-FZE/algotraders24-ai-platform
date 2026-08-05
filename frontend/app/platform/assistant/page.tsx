// app/platform/assistant/page.tsx
// Sprint D2.4.A1 - assembled (not new copy) from sections/PlatformOverview.tsx's
// "AI Assistant" card and sections/AssistantPreview.tsx's illustrative panel,
// both already-shipped homepage content, per the approved D2.4.A1 IA plan.
import type { Metadata } from "next";
import Link from "next/link";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/sections/Footer";
import PageHero from "@/components/marketing/PageHero";
import PlatformCTA from "@/components/marketing/PlatformCTA";

export const metadata: Metadata = {
  title: "AI Assistant",
  description: "A conversational interface grounded in real evidence, not a generic chatbot — every answer traces to what's actually indexed.",
  alternates: { canonical: "/platform/assistant" },
};

export default function AssistantPlatformPage() {
  return (
    <main className="min-h-screen bg-ink text-text">
      <Navbar />
      <PageHero
        eyebrow="Platform / AI Assistant"
        title="Ask a question, see the reasoning"
        subtitle="A conversational interface grounded in real evidence, not a generic chatbot. Ask a question in plain language and get an answer backed by the same reasoning the platform uses everywhere else."
      />

      <section className="px-6 py-12">
        <div className="mx-auto max-w-3xl rounded-panel border border-border bg-ink-2 p-8">
          <p className="text-sm leading-6 text-text-2">
            Every response is generated from the Knowledge Base&apos;s retrieval layer, not from open-ended completion
            alone — the Assistant only draws on what&apos;s actually indexed.
          </p>
        </div>
      </section>

      <section className="px-6 py-8">
        <div className="mx-auto max-w-4xl rounded-panel border border-border bg-ink-2 p-8">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm font-medium text-text-2">Sample conversation</span>
            <span className="rounded-control border border-gold/30 bg-gold/10 px-3 py-1 text-xs font-medium text-gold">
              Illustrative example — not a live market analysis
            </span>
          </div>
          <div className="space-y-6">
            <div className="ml-auto max-w-md rounded-card bg-ink-3 px-5 py-3 text-sm text-text">
              What&apos;s your view on gold right now?
            </div>
            <div className="max-w-lg space-y-3 rounded-card border border-border bg-ink px-5 py-4">
              <p className="text-sm leading-6 text-text-2">Here&apos;s what the available evidence shows, and what it doesn&apos;t.</p>
              <p className="text-sm leading-6 text-text-2">Supporting evidence points one way; at least one source disagrees — I&apos;ll never average that away.</p>
              <p className="text-sm leading-6 text-text-2">Confidence reflects how much evidence exists and how well it agrees, not a guess dressed up as certainty.</p>
              <p className="text-sm leading-6 text-text-2">Risk is broken down by category, not collapsed into one number.</p>
            </div>
          </div>
        </div>
        <p className="mx-auto mt-6 max-w-4xl text-center text-sm text-text-3">
          Real coverage depends on what&apos;s indexed in your Knowledge Base and the connected market-data provider —
          see{" "}
          <Link href="/platform/market-intelligence" className="text-gold hover:text-gold-strong">
            Market Intelligence
          </Link>{" "}
          and{" "}
          <Link href="/platform/knowledge-base" className="text-gold hover:text-gold-strong">
            Knowledge Base
          </Link>{" "}
          for how the evidence layer they share is built.
        </p>
      </section>

      <PlatformCTA dashboardHref="/dashboard/assistant" dashboardLabel="Open the AI Assistant" />
      <Footer />
    </main>
  );
}
