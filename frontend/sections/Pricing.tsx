// sections/Pricing.tsx
// Sprint D2.1 (Phase 9) - homepage pricing preview built ENTIRELY from the
// real production billing configuration (config/plan-limits.ts +
// config/billing.config.ts), read directly so it can never drift from the
// product. No invented plans, no invented numbers: prices are the real
// priceYearly values (the only prices that live in code today — monthly
// pricing lives in the DB Plan table and is deliberately not fabricated
// here), and every listed limit comes straight from PLAN_LIMITS.
//
// Fully re-themed to Brand Identity v1.0 (gold / ink / white / slate). The
// off-brand PLAN_COLORS/PLAN_ACCENTS (sky/violet/amber) from billing.config
// are intentionally NOT used on the marketing surface.
//
// Server Component: static content + links, no interactivity needed.
import Link from "next/link";
import { Check } from "lucide-react";
import { PLAN_IDS, PLAN_LABELS, CURRENCY } from "@/config/billing.config";
import { PLAN_LIMITS } from "@/config/plan-limits";

function priceLabel(priceYearly: number): { amount: string; period: string } {
  if (priceYearly === 0) return { amount: `${CURRENCY.symbol}0`, period: "forever" };
  return { amount: `${CURRENCY.symbol}${priceYearly.toLocaleString(CURRENCY.locale)}`, period: "per year" };
}

function featuresFor(id: (typeof PLAN_IDS)[number]): string[] {
  const p = PLAN_LIMITS[id];
  const feats = [
    `${p.aiCredits.toLocaleString(CURRENCY.locale)} AI credits / month`,
    `${p.maxAgents.toLocaleString(CURRENCY.locale)} AI agent${p.maxAgents === 1 ? "" : "s"}`,
    `${p.maxAutomations.toLocaleString(CURRENCY.locale)} automations`,
    `${p.teamMembers} team member${p.teamMembers === 1 ? "" : "s"}`,
  ];
  if (p.apiAccess) feats.push("API access");
  if (p.prioritySupport) feats.push("Priority support");
  if (p.customBranding) feats.push("Custom branding");
  return feats;
}

const CTA_LABEL: Record<string, string> = {
  free: "Start Free",
  pro: "Choose Pro",
  elite: "Choose Elite",
  enterprise: "Get started",
};

export default function Pricing() {
  return (
    <section className="bg-ink py-16 text-text md:py-24">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-gold">Pricing</p>
          <h2 className="mt-4 font-display text-4xl font-medium md:text-5xl">Simple, transparent pricing</h2>
          <p className="mt-5 text-lg text-text-2">
            Start free and upgrade when you&apos;re ready — every plan runs on the same explainable engine.
          </p>
        </div>

        <div className="mt-16 grid gap-6 lg:grid-cols-4">
          {PLAN_IDS.map((id) => {
            const plan = PLAN_LIMITS[id];
            const highlighted = plan.highlighted;
            const { amount, period } = priceLabel(plan.priceYearly);
            return (
              <div
                key={id}
                className={`relative flex flex-col rounded-panel border p-8 transition-all duration-300 ${
                  highlighted
                    ? "border-gold bg-ink-2 shadow-raised lg:-translate-y-2"
                    : "border-border bg-ink-2 hover:border-gold/50"
                }`}
              >
                {highlighted && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-control bg-gold px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-ink">
                    Recommended
                  </span>
                )}
                <h3 className="text-lg font-semibold">{PLAN_LABELS[id]}</h3>
                <div className="mt-4 flex items-baseline gap-1.5">
                  <span className="font-display text-4xl font-semibold">{amount}</span>
                  <span className="text-sm text-text-3">{period}</span>
                </div>
                <p className="mt-3 min-h-[2.5rem] text-sm leading-6 text-text-2">{plan.description}</p>

                <Link
                  href="/signup"
                  className={`mt-6 rounded-control px-5 py-3 text-center text-sm font-semibold transition ${
                    highlighted
                      ? "bg-gold text-ink hover:brightness-110"
                      : "border border-border text-text hover:border-gold"
                  }`}
                >
                  {CTA_LABEL[id]}
                </Link>

                <ul className="mt-8 space-y-3 border-t border-border pt-6">
                  {featuresFor(id).map((feat) => (
                    <li key={feat} className="flex items-start gap-2.5 text-sm text-text-2">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-gold" aria-hidden="true" />
                      {feat}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>

        <p className="mt-10 text-center text-sm text-text-3">
          Transparent pricing · Upgrade anytime · Secure payments
        </p>
      </div>
    </section>
  );
}
