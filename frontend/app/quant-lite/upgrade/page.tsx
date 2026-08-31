// app/quant-lite/upgrade/page.tsx
// Sprint Q0.8 - Upgrade (Screen 8). Purely informational/comparison -
// no payment, no subscription logic, no Quant Pro API calls, per
// explicit instruction (Q0.8 Part 16, and at24-quant-engine/ remains
// untouched/unopened per every prior sprint's boundary).
import type { Metadata } from "next";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/sections/Footer";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import ButtonLink from "@/components/ui/ButtonLink";

export const metadata: Metadata = {
  title: "Upgrade - Quant Lite",
  alternates: { canonical: "/quant-lite/upgrade" },
};

const LITE_FEATURES = [
  "Strategy creation with 10 supported indicators",
  "Deterministic backtesting on the canonical execution engine",
  "Real, time-varying spread modeling",
  "Strategy library (research/discovery evidence)",
  "Equity curve and trade-level detail",
];

const PRO_FEATURES = [
  "Advanced execution modeling",
  "Tick-level / higher-fidelity backtest replay",
  "Robustness and walk-forward analysis",
  "Advanced validation tooling",
  "Institutional-style research capabilities",
];

export default function UpgradePage() {
  return (
    <main className="min-h-screen bg-ink pt-20 text-text">
      <Navbar />
      <section className="mx-auto max-w-4xl px-6 py-16">
        <div className="text-center">
          <p className="text-xs font-semibold uppercase tracking-wider text-gold">Upgrade</p>
          <h1 className="mt-2 text-3xl font-semibold text-text">Quant Pro is a separate, advanced product</h1>
          <p className="mx-auto mt-3 max-w-xl text-sm text-text-2">
            Quant Lite stays free, simple, and deterministic. Quant Pro is a genuinely separate, more
            advanced execution and research platform - not a set of features unlocked inside Quant Lite.
          </p>
        </div>

        <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2">
          <Card padding="lg">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-text">Quant Lite</h2>
              <Badge tone="success">Free</Badge>
            </div>
            <p className="mb-4 text-sm text-text-3">Basic strategy research, built on the transparent legacy execution engine.</p>
            <ul className="space-y-2 text-sm text-text-2">
              {LITE_FEATURES.map((f) => (
                <li key={f} className="flex gap-2">
                  <span className="text-gold">&bull;</span>
                  {f}
                </li>
              ))}
            </ul>
          </Card>

          <Card padding="lg" raised>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-text">Quant Pro</h2>
              <Badge tone="gold">Advanced</Badge>
            </div>
            <p className="mb-4 text-sm text-text-3">Advanced research and execution tooling for serious strategy development.</p>
            <ul className="space-y-2 text-sm text-text-2">
              {PRO_FEATURES.map((f) => (
                <li key={f} className="flex gap-2">
                  <span className="text-gold">&bull;</span>
                  {f}
                </li>
              ))}
            </ul>
            <p className="mt-4 text-xs text-text-3">Not yet available. Details are being finalized separately from Quant Lite.</p>
          </Card>
        </div>

        <div className="mt-10 text-center">
          <ButtonLink href="/quant-lite/builder" size="lg">
            Continue with Quant Lite
          </ButtonLink>
        </div>
      </section>
      <Footer />
    </main>
  );
}
