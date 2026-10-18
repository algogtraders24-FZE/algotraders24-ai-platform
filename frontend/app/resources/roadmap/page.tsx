// app/resources/roadmap/page.tsx
// Company roadmap: where Algotraders24 AI is heading over the next five years, as five phases. It is a direction, not a
// promise: no calendar dates, and later phases depend on earlier results and on regulation. Phase 1 lists only what is live
// today (checked against the product); Phase 3's "Prop Mode" is real (components/live-results/PropGauges.tsx).
import type { Metadata } from "next";
import Link from "next/link";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/sections/Footer";
import PageHero from "@/components/marketing/PageHero";
import Card from "@/components/ui/Card";

export const metadata: Metadata = {
  title: "Roadmap",
  description:
    "Where Algotraders24 AI is heading over the next five years: from a trusted retail platform to a marketplace, professional tools, a developer platform and institutional reporting.",
  alternates: { canonical: "/resources/roadmap" },
};

interface Phase {
  label: string;
  theme: string;
  summary: string;
  items: string[];
  now?: boolean;
}

const PHASES: readonly Phase[] = [
  {
    label: "Year 1 - Foundation",
    theme: "A trusted retail platform",
    summary: "Built and live today. This year is about growing users, sellers and trust.",
    items: [
      "AI market intelligence that explains its evidence, risk and confidence",
      "Quant Lite (free) and Quant Pro for building and backtesting strategies",
      "Marketplace with clear Validated, Checked and Not checked labels",
      "Live Sync and Live Results for real, terminal-reported account performance",
      "Public research and a live calibration scoreboard",
    ],
    now: true,
  },
  {
    label: "Year 2 - Growth",
    theme: "A marketplace and seller ecosystem",
    summary: "Turn the marketplace into the trusted place to buy and sell trading software.",
    items: [
      "Outside sellers listing their own products, self-serve",
      "More platforms: cTrader, NinjaTrader and TradingView",
      "More ways to pay",
      "Stronger buyer protection, including reports and automatic suspension",
      "More Indian-market and crypto products",
    ],
  },
  {
    label: "Year 3 - Professional",
    theme: "Professional traders and prop firms",
    summary: "Tools for people who trade under rules and for teams.",
    items: [
      "Prop-firm rule tracking, growing from Prop Mode in Live Results (daily loss, max loss, profit target and trading days)",
      "Team accounts",
      "Validated research on more instruments",
      "Better volatility models",
    ],
  },
  {
    label: "Year 4 - Developers",
    theme: "A developer platform",
    summary: "Let others build on our evidence.",
    items: ["A public API and SDK", "A broader MCP server for AI tools", "Partners and integrations", "Developer documentation"],
  },
  {
    label: "Year 5 - Institutions",
    theme: "Institutional tools",
    summary: "Evidence and reporting for firms that need to show their work.",
    items: [
      "Audit-grade reporting for hedge funds and institutions",
      "A white-label version of the evidence engine",
      "Compliance support for institutional use",
    ],
  },
];

const CONSTANTS = [
  "No buy-or-sell signals. We show evidence, risk and confidence.",
  "Every number comes with how it was made, and we say when data is missing.",
  "We test our own features and publish the results, including the ones that fail.",
  "We label what has been checked and what has not.",
] as const;

export default function RoadmapPage() {
  return (
    <main className="min-h-screen bg-ink text-text">
      <Navbar />
      <PageHero
        eyebrow="Resources / Roadmap"
        title="Where we are going"
        subtitle="Five phases over the next five years. A direction, not a promise: there are no dates, and the plan changes as we learn."
      />

      <section className="px-6 py-12">
        <ol className="mx-auto max-w-3xl space-y-5">
          {PHASES.map((p, i) => (
            <li key={p.label}>
              <Card padding="lg" className={p.now ? "border-gold/50" : ""}>
                <div className="flex items-center gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control border border-gold/30 bg-gold/10 text-sm font-semibold text-gold">
                    {i + 1}
                  </span>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">{p.label}</p>
                  {p.now && (
                    <span className="rounded-control border border-gold/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gold">Now</span>
                  )}
                </div>
                <h2 className="mt-3 text-xl font-semibold">{p.theme}</h2>
                <p className="mt-2 text-sm leading-6 text-text-2">{p.summary}</p>
                <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-6 text-text-2">
                  {p.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </Card>
            </li>
          ))}
        </ol>

        <div className="mx-auto mt-12 max-w-3xl rounded-card border border-border bg-ink-2/60 p-6">
          <h2 className="text-base font-semibold">What stays the same in every phase</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-text-2">
            {CONSTANTS.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <p className="mt-4 text-xs leading-5 text-text-3">
            Later phases depend on how the earlier ones go and on regulation in each market, and they may change or move. Nothing here is a
            commitment to deliver a feature at a given time, and nothing on this page is investment advice. What is live today is in the{" "}
            <Link href="/resources/release-notes" className="text-gold underline-offset-4 hover:underline">
              release notes
            </Link>
            .
          </p>
        </div>
      </section>

      <Footer />
    </main>
  );
}
