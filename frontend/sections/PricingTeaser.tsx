// sections/PricingTeaser.tsx
// Sprint D2.4.A2 - homepage compression. Replaces the full <Pricing /> block
// (all 4 tiers, full feature lists - identical to /pricing) with a compact
// row of plan name + price chips. Reads the same real config (PLAN_IDS,
// PLAN_LIMITS, billing.config) that sections/Pricing.tsx and app/pricing/
// page.tsx use, so the numbers here can never drift from the real product -
// this is a shorter view of the same data, not a re-typed summary. The full
// tier/feature breakdown stays at /pricing, unchanged.
//
// Sprint D2.4.A3 - shows all 4 real plans (Free/Pro/Elite/Enterprise), not
// a trimmed 3-plan version: dropping the real Elite tier from the homepage
// to match a simpler mockup would misrepresent the actual pricing, which
// this component exists specifically to avoid.
import Link from "next/link";
import { PLAN_IDS, PLAN_LABELS, CURRENCY } from "@/config/billing.config";
import { PLAN_LIMITS } from "@/config/plan-limits";

function priceLabel(priceYearly: number): string {
  if (priceYearly === 0) return `${CURRENCY.symbol}0`;
  return `${CURRENCY.symbol}${priceYearly.toLocaleString(CURRENCY.locale)}/yr`;
}

export default function PricingTeaser() {
  return (
    <section className="bg-ink py-16 text-text md:py-24">
      <div className="mx-auto max-w-4xl px-6 text-center">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-gold">Pricing</p>
        <h2 className="mt-4 font-display text-4xl font-medium md:text-5xl">Simple, transparent pricing</h2>
        <p className="mt-5 text-lg text-text-2">
          Start free and upgrade when you&apos;re ready — every plan runs on the same explainable engine.
        </p>

        <div className="mt-10 flex flex-wrap justify-center gap-3">
          {PLAN_IDS.map((id) => {
            const plan = PLAN_LIMITS[id];
            return (
              <span
                key={id}
                className={`flex items-center gap-2 rounded-control border px-4 py-2.5 text-sm font-medium ${
                  plan.highlighted ? "border-gold bg-gold/10 text-text" : "border-border bg-ink-2 text-text-2"
                }`}
              >
                {PLAN_LABELS[id]}
                <span className="font-mono text-text-3">{priceLabel(plan.priceYearly)}</span>
              </span>
            );
          })}
        </div>

        <div className="mt-8 flex flex-wrap justify-center gap-4">
          <Link
            href="/signup"
            className="rounded-control bg-gold px-8 py-4 font-semibold text-ink transition hover:brightness-110"
          >
            Start Free
          </Link>
          <Link
            href="/pricing"
            className="rounded-control border border-border px-8 py-4 font-semibold text-text transition hover:border-gold"
          >
            Compare Plans →
          </Link>
        </div>
      </div>
    </section>
  );
}
