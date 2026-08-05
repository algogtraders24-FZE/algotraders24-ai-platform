// app/platform/workspace/page.tsx
// Sprint D2.4.A1 - assembled from sections/DashboardShowcase.tsx (real,
// unedited screenshots — public/showcase/*.png — and its callout copy) per
// the approved D2.4.A1 IA plan. No workspace-specific screenshot exists
// separately from these two, so both real shots are used as-is rather than
// inventing a third.
import type { Metadata } from "next";
import Image from "next/image";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/sections/Footer";
import PageHero from "@/components/marketing/PageHero";
import PlatformCTA from "@/components/marketing/PlatformCTA";
import { Link2, ShieldAlert, Gauge, Repeat2 } from "lucide-react";

export const metadata: Metadata = {
  title: "Trading Workspace",
  description: "See the real platform, not a mockup — actual screenshots from a live analysis run, honestly reported.",
  alternates: { canonical: "/platform/workspace" },
};

const CALLOUTS = [
  { icon: Link2, text: "Every claim carries an attributed source and timestamp." },
  { icon: ShieldAlert, text: "Risk is assessed across eight categories and disclosed." },
  { icon: Gauge, text: "Confidence is scored 0–100 from real evidence, never asserted." },
  { icon: Repeat2, text: "Deterministic — the same evidence returns the same analysis." },
];

export default function WorkspacePlatformPage() {
  return (
    <main className="min-h-screen bg-ink text-text">
      <Navbar />
      <PageHero
        eyebrow="Platform / Trading Workspace"
        title="See the real platform, not a mockup"
        subtitle="Actual screenshots from the live product — including a real analysis run. Nothing staged, nothing retouched."
      />

      <section className="px-6 py-12">
        <div className="mx-auto max-w-6xl">
          <div className="overflow-hidden rounded-panel border border-border bg-ink-2 shadow-raised">
            <div className="flex items-center gap-3 border-b border-border px-4 py-3">
              <span className="text-xs font-medium text-text-2">Market Intelligence — Explainable Analysis</span>
              <span className="ml-auto rounded-control border border-gold/30 bg-gold/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-gold">
                Live screenshot
              </span>
            </div>
            <Image
              src="/showcase/market-intelligence.png"
              alt="A real EUR/USD analysis: overall risk High, confidence Low (20/100), with supporting evidence and an eight-category risk breakdown."
              width={1440}
              height={1010}
              className="h-auto w-full"
              sizes="100vw"
            />
          </div>

          <div className="mt-8 grid gap-8 lg:grid-cols-5">
            <div className="lg:col-span-3" />
            <div className="lg:col-span-2">
              <p className="text-sm font-semibold uppercase tracking-[0.14em] text-gold">A real run — EUR/USD</p>
              <p className="mt-3 text-sm leading-7 text-text-2">
                This isn&apos;t a rendered demo. It&apos;s the deterministic pipeline analysing live price evidence — and
                honestly reporting <span className="text-text">High risk</span> and{" "}
                <span className="text-text">Low confidence</span> because most evidence types weren&apos;t available. It
                never pretends to know more than it does.
              </p>
              <ul className="mt-6 space-y-4">
                {CALLOUTS.map((c) => (
                  <li key={c.text} className="flex gap-3">
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-control border border-gold/30 bg-gold/10">
                      <c.icon className="h-4 w-4 text-gold" aria-hidden="true" />
                    </span>
                    <span className="text-sm leading-6 text-text-2">{c.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      <PlatformCTA dashboardHref="/dashboard/workspace" dashboardLabel="Open the Workspace" />
      <Footer />
    </main>
  );
}
