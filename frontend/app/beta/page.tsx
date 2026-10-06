// app/beta/page.tsx
// Beta launch - "Your First 15 Minutes with AT24". A public, guided path for
// a new beta tester: one real question, one real idea, one real test, then
// feedback. Every step links to a route that already exists; nothing here is
// a new feature, a metric or a claim about results. Self-composed Navbar/
// Footer and session-aware CTA, matching app/quant-lite/page.tsx.
// Step 3 deliberately points at Quant Lite (free, no sign-in needed to build)
// because it is the one real "test a hypothesis" flow every beta user can
// reach; Algo Testing Pro stays a follow-up for users on a Pro plan.
import type { Metadata } from "next";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/sections/Footer";
import ButtonLink from "@/components/ui/ButtonLink";
import Card from "@/components/ui/Card";
import PageHero from "@/components/marketing/PageHero";
import { SessionService } from "@/services/auth/SessionService";

export const metadata: Metadata = {
  title: "Your First 15 Minutes",
  description:
    "Not sure where to start? A 15-minute guided path through AT24: ask a market question, explore the research, test one trading idea, and tell us what you found.",
  alternates: { canonical: "/beta" },
};

const STEPS = [
  {
    when: "Minutes 1-3",
    title: "Ask your first market question",
    description:
      "Open the AI Assistant and ask something you are actually wondering about a market you trade - not a test prompt.",
    href: "/dashboard/assistant",
    cta: "Open AI Assistant",
  },
  {
    when: "Minutes 3-7",
    title: "Explore the intelligence and research",
    description:
      "Run a Market Intelligence analysis on the same instrument and read the evidence, risk and confidence behind it. Check AI News for what is moving it.",
    href: "/dashboard/market-intelligence",
    cta: "Run an analysis",
  },
  {
    when: "Minutes 7-12",
    title: "Test one trading hypothesis",
    description:
      "Turn your idea into rules in the Quant Lite Strategy Builder, then backtest it on real historical data and read the full trade ledger.",
    href: "/quant-lite/builder",
    cta: "Build and backtest",
  },
  {
    when: "Minutes 12-15",
    title: "Review your result and give feedback",
    description:
      "Was it useful? Was anything confusing? What was missing? Use the Feedback button in the bottom-right of any dashboard page - it takes a minute and we read every one.",
    href: "/dashboard",
    cta: "Go to dashboard",
  },
] as const;

export default async function BetaFirstFifteenMinutesPage() {
  const sessionUser = await SessionService.getSessionUser();
  const isAuthenticated = !!sessionUser;

  return (
    <main className="min-h-screen bg-ink text-text">
      <Navbar isAuthenticated={isAuthenticated} />
      <PageHero
        eyebrow="Beta"
        title="Your First 15 Minutes with AT24"
        subtitle="Don't know where to start? Try this."
      />

      <section className="px-6 py-12">
        <ol className="mx-auto max-w-3xl space-y-4">
          {STEPS.map((s, i) => (
            <li key={s.title}>
              <Card className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control border border-gold/30 bg-gold/10 text-sm font-semibold text-gold">
                  {i + 1}
                </span>
                <div className="flex-1">
                  <p className="text-xs font-semibold uppercase tracking-wider text-gold">{s.when}</p>
                  <h2 className="mt-1 text-lg font-semibold text-text">{s.title}</h2>
                  <p className="mt-1 text-sm text-text-2">{s.description}</p>
                </div>
                <ButtonLink href={s.href} variant={i === 0 ? "primary" : "secondary"}>
                  {s.cta}
                </ButtonLink>
              </Card>
            </li>
          ))}
        </ol>

        <div className="mx-auto mt-10 max-w-3xl rounded-card border border-gold/30 bg-gold/5 p-6 text-center">
          <p className="text-lg font-semibold text-text">Bring your own trading idea.</p>
          <p className="mt-2 text-sm text-text-2">
            AT24 is most useful when you use it on a problem you actually trade.
          </p>
          {!isAuthenticated && (
            <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
              <ButtonLink href="/signup" size="lg">
                Create your free account
              </ButtonLink>
              <ButtonLink href="/login" variant="secondary" size="lg">
                Log in
              </ButtonLink>
            </div>
          )}
        </div>

        <p className="mx-auto mt-8 max-w-3xl text-center text-xs text-text-3">
          AT24 is an educational research tool. Backtests describe the past and do not predict future results. Nothing
          here is financial advice or a trading signal.
        </p>
      </section>
      <Footer />
    </main>
  );
}
