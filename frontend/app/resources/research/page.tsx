// app/resources/research/page.tsx
// Public summary of our own validation research, taken from frontend/docs/research/SMC_AND_VOLATILITY_RD.md.
// Every number below is from that document; if the research is re-run, update both. We publish the negative
// results too - that is the point of the page.
import type { Metadata } from "next";
import Link from "next/link";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/sections/Footer";
import PageHero from "@/components/marketing/PageHero";
import Card from "@/components/ui/Card";

export const metadata: Metadata = {
  title: "Research",
  description:
    "Our own tests of what predicts price and what does not - including the results that did not go our way. Smart-money structure, CFTC positioning and volatility ranges.",
  alternates: { canonical: "/resources/research" },
};

const STUDIES = [
  {
    verdict: "No reliable direction signal",
    tone: "text-text-2",
    title: "Does the smart-money (SMC) score predict price?",
    question: "When the SMC structure leans bullish or bearish, does price actually move that way afterwards?",
    result:
      "Not reliably. On Bitcoin the lean carried no information at any horizon. On Gold, bullish leans beat bearish leans over 12 hours, but only in the second half of the data and only in the \"developing\" bucket, over a period when Gold rose strongly - so it may simply be tracking the trend. A higher score did not rank outcomes better: \"strong\" was no better than \"developing\", and on Bitcoin it was worse.",
    action: "SMC structure stays on the platform as a description of swings, zones and sweeps, and is labelled as context, never a predictor.",
  },
  {
    verdict: "No detectable direction signal",
    tone: "text-text-2",
    title: "Does CFTC positioning (Commitment of Traders) predict price?",
    question: "Does it help to know whether speculators are crowded long or short in Gold, the Euro or Bitcoin futures?",
    result:
      "We found nothing we can rely on. Of 36 tests, 2 looked significant, and both rested on 12 crowded weeks - about what chance produces across 36 tests. Weekly data gives only a few dozen extreme readings per market, so this rules out large effects, not small ones.",
    action: "If positioning is ever shown, it will be as plain context, with the same disclosure.",
  },
  {
    verdict: "Works - and is shown",
    tone: "text-gold",
    title: "Can we forecast the size of a move?",
    question: "Even without direction, can we say how far a market typically moves over the next 12 or 24 hours?",
    result:
      "Yes. A range scaled by current volatility (ATR) held its stated coverage on data it had not been fitted on: an 80% band achieved 78-82% on Gold and Bitcoin at 4, 12 and 24 hours. A fixed-percentage range on Gold achieved only about 60%.",
    action: "The \"typical move size\" range in Market Intelligence and on the Markets pages. It describes size, not direction or a target.",
  },
  {
    verdict: "Found a weakness - fixed",
    tone: "text-gold",
    title: "Is the range reliable around big scheduled releases?",
    question: "Does the same range hold in windows that contain US CPI, payrolls or a Fed decision?",
    result:
      "No. In those windows the plain band covered only about 53% of 12-hour Gold windows (82% in ordinary ones). After the release the band was fine, because volatility had already jumped.",
    action: "The range now widens when a release falls inside the window. Pooled coverage sits near 80-85%. Silver and forex use the Gold factors untested, which we say openly.",
  },
] as const;

export default function ResearchPage() {
  return (
    <main className="min-h-screen bg-ink text-text">
      <Navbar />
      <PageHero
        eyebrow="Resources / Research"
        title="What we tested, including what failed"
        subtitle="We test our own features before we describe them. These are the results, good and bad."
      />

      <section className="px-6 py-12">
        <div className="mx-auto max-w-4xl space-y-6">
          {STUDIES.map((s) => (
            <Card key={s.title} padding="lg">
              <p className={`text-xs font-semibold uppercase tracking-[0.2em] ${s.tone}`}>{s.verdict}</p>
              <h2 className="mt-2 text-xl font-semibold">{s.title}</h2>
              <p className="mt-3 text-sm italic leading-6 text-text-3">{s.question}</p>
              <p className="mt-3 text-sm leading-6 text-text-2">
                <span className="font-semibold text-text">What we found. </span>
                {s.result}
              </p>
              <p className="mt-3 text-sm leading-6 text-text-2">
                <span className="font-semibold text-text">What we did about it. </span>
                {s.action}
              </p>
            </Card>
          ))}
        </div>
      </section>

      <section className="px-6 pb-4">
        <div className="mx-auto max-w-3xl rounded-card border border-border bg-ink-2/60 p-6">
          <h2 className="text-base font-semibold">How to read this</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-text-2">
            <li>Data: Gold hourly (Jan 2023 - Sep 2026, 21,996 bars) and Bitcoin hourly (Jan 2023 - Oct 2026, 33,094 bars). Tests were run on the later part of the data that the settings were not fitted on.</li>
            <li>Two instruments, one period and one timeframe. We make no claim beyond that. Forex pairs and indices were not tested on their own.</li>
            <li>No look-ahead: each decision uses only what was known at that time, and entry is at the next bar.</li>
            <li>Past behaviour does not guarantee future behaviour. Nothing here is trading advice.</li>
          </ul>
          <p className="mt-4 text-sm text-text-2">
            See also the{" "}
            <Link href="/methodology" className="text-gold underline-offset-4 hover:underline">
              Methodology
            </Link>{" "}
            and the live{" "}
            <Link href="/calibration" className="text-gold underline-offset-4 hover:underline">
              Calibration Scoreboard
            </Link>
            , which checks every range we state against what price actually did.
          </p>
        </div>
      </section>

      <Footer />
    </main>
  );
}
