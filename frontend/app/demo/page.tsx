// app/demo/page.tsx
// Landing page of the free 30-day demo. Promotion copy lives here: what you get, how it works, the demo contest. It makes no result
// claims - the visitor tries the product on their own demo account and sees their own results.
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { prisma } from "@/lib/prisma";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/sections/Footer";
import ButtonLink from "@/components/ui/ButtonLink";
import StartDemoButton from "./StartDemoButton";

export const metadata = {
  title: "Free 30-day demo - XXX US30 | Algotraders24 AI",
  description: "Try XXX US30 free for 30 days on your own demo account, track your own results and join the demo contest.",
};
export const dynamic = "force-dynamic";

const day = (d: Date) => d.toISOString().slice(0, 10);

export default async function DemoPage() {
  const user = await getUserOrNull();
  const contest = await prisma.contest
    .findFirst({ where: { tradingSystemId: "XXXUS30", status: { in: ["OPEN", "DRAFT"] } }, orderBy: { startsAt: "asc" } })
    .catch(() => null);
  const contestPublic = contest && contest.status === "OPEN" ? contest : null;

  return (
    <main className="min-h-screen bg-ink pt-20 text-text">
      <Navbar />
      <div className="mx-auto max-w-3xl space-y-8 px-4 py-10 sm:px-6">
        <header className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-gold">Free for 30 days - no card</p>
          <h1 className="text-3xl font-bold sm:text-4xl">Try XXX US30 on your own demo account</h1>
          <p className="text-text-2">
            Run the real EA for 30 days on a demo account, watch it trade, and judge it with your own numbers. No payment, no card. Your demo
            works on one trading account and ends by itself after 30 days.
          </p>
          <div className="pt-2">
            {user ? (
              <StartDemoButton product="XXXUS30" label="Start my free 30-day demo" />
            ) : (
              <div className="flex flex-wrap gap-3">
                <ButtonLink href="/signup">Create a free account</ButtonLink>
                <ButtonLink href="/login?redirect=/demo" variant="secondary">I already have an account</ButtonLink>
              </div>
            )}
          </div>
        </header>

        <section className="grid gap-4 sm:grid-cols-3">
          {[
            ["1. Start", "Create an account (free), press the button, get your key and the demo EA."],
            ["2. Run it", "MetaTrader 5, a US30 chart of a demo account, paste the key. Start with a small lot."],
            ["3. See your results", "Connect the demo to AT24 Live Sync (free) for your own results page and rule check."],
          ].map(([h, t]) => (
            <div key={h} className="rounded-card border border-border bg-ink-2 p-4">
              <h2 className="font-semibold text-text">{h}</h2>
              <p className="mt-1 text-sm text-text-2">{t}</p>
            </div>
          ))}
        </section>

        <section className="space-y-3 rounded-card border border-border bg-ink-2 p-5">
          <h2 className="text-xl font-semibold">Demo contest {contest ? `- ${contest.title}` : "- coming soon"}</h2>
          <ul className="list-disc space-y-1 pl-5 text-sm text-text-2">
            <li>The <b className="text-text">top 3</b> demo results win a <b className="text-text">3-month licence</b> of XXX US30.</li>
            <li>Everyone who takes part gets <b className="text-text">20% off</b> the full product.</li>
            <li>Ranked on your own demo account, by profit %, inside prop-style rules (daily loss and max loss limits) - not by lot size.</li>
            <li>Free to enter: you only need the demo and a free AT24 Live Sync account.</li>
          </ul>
          {contestPublic ? (
            <p className="text-sm text-text-2">
              Window: {day(contestPublic.startsAt)} to {day(contestPublic.endsAt)}.{" "}
              <a className="font-semibold text-gold hover:underline" href={`/contest/${contestPublic.slug}`}>See the rules and the leaderboard →</a>
            </p>
          ) : (
            <p className="text-sm text-text-3">Start your demo now - the contest page opens with the first round.</p>
          )}
        </section>

        <section className="space-y-2 text-xs text-text-3">
          <p>
            The demo is a demo: it runs on a demo account only. Spread, slippage and commission on a real account are different and results can be
            worse. Results on a demo account, including contest results, are terminal-reported and not verified by a broker. Past results do not
            predict future results. Trading leveraged products is risky; this is not financial advice.
          </p>
          <p>Read the product page for the full evidence and its weak points before you decide to buy.</p>
        </section>
      </div>
      <Footer />
    </main>
  );
}
