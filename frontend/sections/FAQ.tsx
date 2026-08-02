// sections/FAQ.tsx
// Sprint D2.1 (Phase 10) - honest FAQ. Every answer reflects the current
// production platform, not aspiration: the "signal service" answer holds the
// line on positioning, the "markets" answer does not overclaim live coverage
// (it depends on the connected data provider), and the "data handling" answer
// states only what is actually true today — authenticated accounts and
// payment processing delegated to Stripe/NOWPayments — without inventing a
// privacy guarantee the codebase can't yet point to. Native <details>
// accordions: accessible and fully functional with zero JavaScript.
import { ChevronDown } from "lucide-react";

const FAQS = [
  {
    q: "What is Algotraders24 AI?",
    a: "An AI Trading Intelligence Platform. It runs market evidence through a deterministic pipeline — evidence, reasoning, risk, and confidence — and explains every conclusion in plain language. It's built for decision support, not for handing you a verdict to follow blindly.",
  },
  {
    q: "Is this a signal service?",
    a: "No. We don't sell buy-or-sell signals. Instead of a bare instruction, you see the supporting and opposing evidence, an eight-category risk breakdown, and a confidence score — so you can weigh the reasoning and check the work yourself.",
  },
  {
    q: "How does the platform work?",
    a: "Every analysis runs the same services in the same order: market data is ingested, evidence is fused and ranked, reasoning classifies each item as supporting, opposing, or unresolved, risk is assessed across eight categories, confidence is scored, and the result is composed into a plain-language explanation. Because it's deterministic, the same evidence always produces the same analysis.",
  },
  {
    q: "Which markets are supported?",
    a: "Across its tools and products, the platform covers forex, crypto, and Indian markets, with integrations for MetaTrader 5, TradingView, cTrader, NinjaTrader, and major crypto exchanges. Live analysis coverage depends on the connected market-data provider and continues to expand.",
  },
  {
    q: "Is there a free plan?",
    a: "Yes. The Free plan is $0 and includes core tools — 500 AI credits a month, an AI agent, and automations — so you can try the platform before deciding to upgrade.",
  },
  {
    q: "Can I upgrade later?",
    a: "Any time. You can move between Free, Pro, Elite, and Enterprise from your billing dashboard; your plan simply sets your limits, and upgrading raises them right away.",
  },
  {
    q: "How is my data handled?",
    a: "You sign in through an authenticated account, and payments are processed entirely by established providers — Stripe for cards and NOWPayments for crypto — so sensitive payment details are handled by them, not stored by us.",
  },
] as const;

export default function FAQ() {
  return (
    <section className="bg-ink py-16 text-text md:py-24">
      <div className="mx-auto max-w-3xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-gold">FAQ</p>
          <h2 className="mt-4 font-display text-4xl font-medium md:text-5xl">Questions, answered plainly</h2>
          <p className="mt-5 text-lg text-text-2">No hedging — the same honesty the platform applies to every analysis.</p>
        </div>

        <div className="mt-14 space-y-3">
          {FAQS.map((item) => (
            <details
              key={item.q}
              className="group overflow-hidden rounded-card border border-border bg-ink-2 transition-colors open:border-gold/40"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-6 py-5 text-base font-semibold text-text [&::-webkit-details-marker]:hidden">
                {item.q}
                <ChevronDown
                  className="h-5 w-5 shrink-0 text-gold transition-transform duration-300 group-open:rotate-180"
                  aria-hidden="true"
                />
              </summary>
              <p className="border-t border-border px-6 py-5 text-sm leading-7 text-text-2">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
