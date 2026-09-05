// app/quant/page.tsx
// Sprint IA2 - the Quant umbrella landing page. Previously the backoffice
// sidebar's "Quant" entry linked straight into /quant-lite with no page
// explaining that Quant is a product family of two separate engines
// (Sprint IA1's own /dashboard nav; see docs/IA1-BACKOFFICE-NAVIGATION-
// REFACTOR.md). This page states that boundary up front, then routes to
// each real product - it does not re-implement or duplicate either one.
// Feature lists come from data/quant-positioning.ts, the same source
// /quant-lite/upgrade already used, so Lite vs Pro positioning can never
// disagree between the two pages. Quant Pro still has no built engine -
// this page states that as plainly as /quant-lite/upgrade always has.
import type { Metadata } from "next";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/sections/Footer";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import ButtonLink from "@/components/ui/ButtonLink";
import { QUANT_LITE_FEATURES, QUANT_PRO_FEATURES } from "@/data/quant-positioning";

export const metadata: Metadata = {
  title: "Quant",
  description: "AT24 Quant is a product family, not one engine - Quant Lite and Quant Pro are genuinely separate products.",
  alternates: { canonical: "/quant" },
};

export default function QuantLandingPage() {
  return (
    <main className="min-h-screen bg-ink pt-20 text-text">
      <Navbar />
      <section className="mx-auto max-w-4xl px-6 py-16">
        <div className="text-center">
          <p className="text-xs font-semibold uppercase tracking-wider text-gold">Quant</p>
          <h1 className="mt-2 text-3xl font-semibold text-text">Two separate engines, one Quant umbrella</h1>
          <p className="mx-auto mt-3 max-w-xl text-sm text-text-2">
            Quant Lite and Quant Pro are not two tiers of the same engine - they are genuinely separate products,
            each with its own execution engine and roadmap. Pick the one that matches what you need today.
          </p>
        </div>

        <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2">
          <Card padding="lg">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-text">Quant Lite</h2>
              <Badge tone="success">Free</Badge>
            </div>
            <p className="mb-4 text-sm text-text-3">
              Build and backtest strategies on the transparent, deterministic legacy execution engine.
            </p>
            <ul className="space-y-2 text-sm text-text-2">
              {QUANT_LITE_FEATURES.map((f) => (
                <li key={f} className="flex gap-2">
                  <span className="text-gold">&bull;</span>
                  {f}
                </li>
              ))}
            </ul>
            <ButtonLink href="/quant-lite" className="mt-6" fullWidth size="md">
              Open Quant Lite
            </ButtonLink>
          </Card>

          <Card padding="lg" raised>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-text">Quant Pro</h2>
              <Badge tone="gold">Advanced</Badge>
            </div>
            <p className="mb-4 text-sm text-text-3">Advanced research and execution tooling for serious strategy development.</p>
            <ul className="space-y-2 text-sm text-text-2">
              {QUANT_PRO_FEATURES.map((f) => (
                <li key={f} className="flex gap-2">
                  <span className="text-gold">&bull;</span>
                  {f}
                </li>
              ))}
            </ul>
            <p className="mt-4 text-xs text-text-3">Not yet available. Details are being finalized separately from Quant Lite.</p>
            <ButtonLink href="/quant-lite/upgrade" variant="secondary" className="mt-6" fullWidth size="md">
              Learn more
            </ButtonLink>
          </Card>
        </div>
      </section>
      <Footer />
    </main>
  );
}
