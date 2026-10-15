// app/calibration/page.tsx
// Public, live calibration scoreboard: every volatility range the platform states ("about 80% of past moves stayed within
// +/-X over the next 12h / 24h") is recorded when it is issued and checked when its time has passed. Every forecast counts,
// none is removed. Below 30 settled forecasts a row says "collecting" instead of a verdict. No direction is ever forecast.
import type { Metadata } from "next";
import Link from "next/link";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/sections/Footer";
import PageHero from "@/components/marketing/PageHero";
import { readScoreboard } from "@/services/calibration/production";
import { SYMBOL_LABEL } from "@/services/market-alerts/alerts";
import { MIN_SAMPLE, TARGET_COVERAGE, type CalibrationRow } from "@/services/calibration/forecast";

export const revalidate = 600;

export const metadata: Metadata = {
  title: "Calibration scoreboard",
  description: "We state a volatility range for each market every 4 hours and check it afterwards. This is the live hit rate of those ranges - every forecast counted.",
  alternates: { canonical: "/calibration" },
};

const pct = (v: number | null) => (v === null ? "-" : `${(v * 100).toFixed(0)}%`);
const STATUS_TEXT: Record<CalibrationRow["status"], string> = {
  collecting: "Collecting data",
  "on-target": "On target",
  above: "Above target (ranges are a bit wide)",
  below: "Below target (ranges are a bit narrow)",
};
const STATUS_TONE: Record<CalibrationRow["status"], string> = {
  collecting: "text-text-3",
  "on-target": "text-success",
  above: "text-gold",
  below: "text-danger",
};

function Table({ rows, label }: { rows: CalibrationRow[]; label: (r: CalibrationRow) => string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase tracking-wider text-text-3">
          <tr>
            <th className="py-2 pr-4 font-medium">Market</th>
            <th className="py-2 pr-4 font-medium">Window</th>
            <th className="py-2 pr-4 font-medium">Checked</th>
            <th className="py-2 pr-4 font-medium">Stayed inside</th>
            <th className="py-2 pr-4 font-medium">95% range</th>
            <th className="py-2 font-medium">Verdict</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.symbol}-${r.horizon}`} className="border-t border-border">
              <td className="py-2 pr-4 text-text">{label(r)}</td>
              <td className="py-2 pr-4 text-text-2">{r.horizon}h</td>
              <td className="py-2 pr-4 font-mono text-text-2">{r.n}</td>
              <td className="py-2 pr-4 font-mono text-text">{pct(r.rate)}</td>
              <td className="py-2 pr-4 font-mono text-text-3">{r.lo === null || r.hi === null ? "-" : `${pct(r.lo)} - ${pct(r.hi)}`}</td>
              <td className={`py-2 ${STATUS_TONE[r.status]}`}>{STATUS_TEXT[r.status]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function CalibrationPage() {
  const board = await readScoreboard();
  const since = board.since ? new Date(board.since).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : null;
  return (
    <main className="min-h-screen bg-ink text-text">
      <Navbar />
      <PageHero eyebrow="Algotraders24" title="Do our ranges hold up?" subtitle="A live scoreboard. We state a range, then check it." />
      <section className="px-6 pb-16 pt-4">
        <div className="mx-auto max-w-4xl space-y-6">
          <div className="rounded-panel border border-border bg-ink-2 p-6">
            <h2 className="text-lg font-semibold text-text">What is being checked</h2>
            <p className="mt-2 leading-7 text-text-2">
              Every 4 hours, for each market we cover, the platform states how far price typically moves: &ldquo;about {TARGET_COVERAGE * 100}% of past moves stayed within
              &plusmn;X over the next 12 hours (and 24 hours)&rdquo;. That statement is saved the moment it is made. When 12 or 24 hours have passed we compare it with the
              price that actually printed. If the market was closed and there is no price to compare with, that forecast is voided - it is never counted as a success.
            </p>
            <p className="mt-3 leading-7 text-text-2">
              This is a range for the <em>size</em> of a move. It says nothing about direction, and it is not a target or a trade signal. If the ranges are good, about
              {" "}{TARGET_COVERAGE * 100}% of forecasts should stay inside. Every forecast is counted; none is removed or re-run.
            </p>
          </div>

          <div className="rounded-panel border border-border bg-ink-2 p-6">
            <h2 className="text-lg font-semibold text-text">Live results</h2>
            <p className="mt-1 text-sm text-text-3">
              {board.available && since ? `Since ${since}. ${board.issued} forecasts issued so far.` : "The scoreboard has just started; the first results arrive within a day."}{" "}
              A row shows a verdict only after {MIN_SAMPLE} checked forecasts.
            </p>
            <div className="mt-4">
              <Table rows={board.all} label={() => "All markets"} />
            </div>
            <h3 className="mt-6 text-sm font-semibold uppercase tracking-wider text-text-3">Ordinary windows vs windows with a scheduled US release</h3>
            <p className="mt-1 text-xs text-text-3">
              US CPI, Non-Farm Payrolls and Fed rate decisions move markets far more than usual. When one falls inside the window the band is widened (see below); this
              shows whether it holds in both kinds of window.
            </p>
            <div className="mt-2">
              <Table rows={board.byWindow.normal} label={() => "Ordinary windows"} />
              <Table rows={board.byWindow.event} label={() => "Release windows (band widened)"} />
            </div>
            <h3 className="mt-6 text-sm font-semibold uppercase tracking-wider text-text-3">By market</h3>
            <div className="mt-2">
              <Table rows={board.bySymbol} label={(r) => `${SYMBOL_LABEL[r.symbol] ?? r.symbol}`} />
            </div>
          </div>

          <div className="rounded-panel border border-border bg-ink-2 p-6">
            <h2 className="text-lg font-semibold text-text">What a backtest said first</h2>
            <p className="mt-2 leading-7 text-text-2">
              Before showing this to anyone we checked the same band on past data it had never seen: 3.7 years of hourly Gold and Bitcoin, fitted on 2023-2024 and tested on
              2025-2026. The 80% band held its stated coverage: Gold 82% (12h) and 81% (24h), Bitcoin 79% and 81%. It is not uniform across conditions - in quiet Gold markets
              the band covered about 67%, in busy ones about 90% - and two markets over one period is not a guarantee. The live table above is the real test.
            </p>
            <p className="mt-3 leading-7 text-text-2">
              One weakness showed up and was fixed: around US CPI, payrolls and Fed decisions the plain band covered only about 53% of 12-hour windows on Gold (it cannot
              know a release is coming). The band is now widened when such a release falls inside the window - 12h x2.0 and 24h x1.4 for gold-like markets, 12h x1.3 for
              crypto - fitted on 2023-2024 and checked on 2025-2026. Silver and the forex pairs use the gold factors without having been tested on their own; the table
              above will show whether that holds.
            </p>
            <p className="mt-3 text-sm text-text-3">
              We also tested whether our market-structure reading predicts direction. It does not do so reliably, so we do not present it as a signal. The full write-up is in our
              research notes; the method is on the <Link href="/methodology" className="text-gold hover:underline">methodology</Link> page.
            </p>
          </div>

          <p className="text-sm text-text-3">
            Nothing here is financial advice. Read the <Link href="/company/disclaimer" className="text-gold hover:underline">disclaimer</Link>.
          </p>
        </div>
      </section>
      <Footer />
    </main>
  );
}
