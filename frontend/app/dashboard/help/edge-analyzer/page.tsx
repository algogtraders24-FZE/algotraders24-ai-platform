// app/dashboard/help/edge-analyzer/page.tsx
// In-app guide for the Edge Analyzer. Plan-gating lines and limits are read from
// the same constants the product enforces, so this guide cannot drift from it.
import PageHeader from "@/components/ui/PageHeader";
import Badge from "@/components/ui/Badge";
import type { BadgeTone } from "@/components/ui/Badge";
import ButtonLink from "@/components/ui/ButtonLink";
import GuideSection from "@/components/help/GuideSection";
import { FREE_LOCKED_SECTIONS } from "@/services/edge-analyzer/access";
import { MAX_TRADES } from "@/services/edge-analyzer/parsers/mt5-html";
import { MIN_TRADES_FOR_EVIDENCE } from "@/services/edge-analyzer/analysis/edge-evidence";
import type { EdgeLevel } from "@/services/edge-analyzer/analysis/edge-evidence";

const LEVELS: { level: EdgeLevel; label: string; tone: BadgeTone; meaning: string }[] = [
  { level: "insufficient", label: "Not enough data", tone: "neutral", meaning: `Fewer than ${MIN_TRADES_FOR_EVIDENCE} closed trades. Nothing reliable can be said about edge, however good the average looks.` },
  { level: "negative", label: "Negative evidence", tone: "danger", meaning: "The 95% range for the average result per trade stays below zero: the history points to a losing edge." },
  { level: "none", label: "No evidence of edge", tone: "neutral", meaning: "The range includes zero: this result cannot be told apart from luck." },
  { level: "weak", label: "Weak evidence", tone: "warning", meaning: "A positive average that is only marginally distinguishable from luck, or a stronger result that was capped because trades overlap or depend on each other." },
  { level: "moderate", label: "Moderate evidence", tone: "info", meaning: "The 95% range is above zero and the luck-only chance (p-value) is below 5%, with trades reasonably independent." },
  { level: "strong", label: "Strong evidence", tone: "success", meaning: "The 95% range is above zero and the luck-only chance is below 1%, with trades reasonably independent. Still not a guarantee about the future." },
];

const GLOSSARY: [string, string][] = [
  ["Net profit", "Total profit + commission + swap of closed trades."],
  ["Win rate", "Share of trades with a profit above zero. Break-even trades are not wins."],
  ["Profit factor", "Gross profit divided by gross loss. Above 1 means winners outweighed losers."],
  ["Average result / trade", "Net result averaged over all closed trades (also called expectancy)."],
  ["Payoff ratio", "Average win divided by average loss."],
  ["Max drawdown", "Largest fall of the balance from a peak, measured on the closed-trade balance curve."],
  ["95% range", "Where the true average result per trade likely lies, estimated by resampling your own trades."],
  ["p-value", "How often a result this far from zero would appear by luck alone if there were no edge. Smaller is stronger evidence."],
  ["Trades overlapping", "Share of trades that were open at the same time as another. High overlap means trades are not independent, so the statistics are less certain."],
];

const TROUBLE: [string, string][] = [
  ["\"This does not look like a MetaTrader 5 Trade History Report\"", "Upload the HTML report saved from the History tab (right-click → Report → HTML), not a CSV, PDF or screenshot."],
  ["\"The Positions table layout is not recognised\"", "Only the English MT5 report is supported. Re-export with the terminal in English. MT4 and other platforms are not supported yet."],
  ["\"No closed trades were found\"", "The chosen period has no closed positions. Choose a longer period in the History tab."],
  ["\"The file is too large\"", `Reports are limited to ${MAX_TRADES.toLocaleString("en-US")} trades. Export a shorter period.`],
  ["\"Too many analyses\"", "Wait a minute and try again."],
  ["\"Does not fully match the terminal summary\"", "Some figures differ from MetaTrader's own summary in the same file. Treat results with caution and tell Support if it keeps happening."],
];

export default function EdgeAnalyzerGuidePage() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="HOW-TO GUIDE"
        title="Edge Analyzer"
        description="See where your trading results really come from, whether they can be told apart from luck, and how much risk the history implies. Descriptive only: not investment advice."
        action={<ButtonLink href="/dashboard/edge-analyzer" size="sm">Open Edge Analyzer</ButtonLink>}
      />

      <GuideSection title="1. Export your report from MetaTrader 5">
        <ol className="list-decimal space-y-1 pl-5">
          <li>Open the <b className="text-text">History</b> tab in the terminal (Toolbox) and choose the period you want (more closed trades give a more reliable reading).</li>
          <li>Right-click the list → <b className="text-text">Report</b> → <b className="text-text">HTML</b>, and save the file.</li>
          <li>Open the Edge Analyzer, click <b className="text-text">Choose report file</b> and select it. Use the English MT5 report.</li>
        </ol>
        <p className="text-xs text-text-3">Your file is analyzed in memory and is not saved. Account number, name and broker details are never read.</p>
      </GuideSection>

      <GuideSection title="2. Read the verdict">
        <p>The top card shows an evidence level for "is this result distinguishable from luck?" It is a level of evidence from your past trades, never proof and never a validation of a strategy.</p>
        <div className="space-y-2">
          {LEVELS.map((l) => (
            <div key={l.level} className="flex flex-col gap-1 border-t border-border pt-2 sm:flex-row sm:items-start sm:gap-3">
              <span className="sm:w-44 sm:shrink-0"><Badge tone={l.tone} className="normal-case">{l.label}</Badge></span>
              <span>{l.meaning}</span>
            </div>
          ))}
        </div>
        <p>Next to it you may see <b className="text-text">"Matches your terminal's own summary"</b>: AT24 compared its numbers with the totals MetaTrader printed in the same file (net profit, gross profit/loss, trade counts, drawdown). If they match, the report was read correctly.</p>
      </GuideSection>

      <GuideSection title="3. What the numbers mean">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[30rem] text-left">
            <tbody>
              {GLOSSARY.map(([k, v]) => (
                <tr key={k} className="border-t border-border align-top"><td className="py-2 pr-3 font-medium text-text whitespace-nowrap">{k}</td><td className="py-2">{v}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </GuideSection>

      <GuideSection title="4. Where your results come from">
        <p>Breakdown bars show net result, trades and win rate for each group: by strategy/EA tag (the trade comment), symbol, direction, weekday and hour (broker time), and how long trades were held. Groups marked <b className="text-text">"few trades"</b> are too small to read into. These are observations to investigate, not instructions.</p>
        <p>"Habits worth a closer look" compares your lot size after a loss with after a win, and how long you hold winners versus losers.</p>
      </GuideSection>

      <GuideSection title="5. The risk view">
        <p>Your own past trades are resampled thousands of times to show a spread of possible outcomes: how likely a 20%, 30% or 50% drawdown is, and where the balance could end up. Two scenarios are shown. <b className="text-text">"Keeps winning/losing streaks"</b> is the more cautious one because real losing streaks are usually longer than a plain shuffle suggests. It is an illustration of risk, not a forecast.</p>
      </GuideSection>

      <GuideSection title="Free and paid">
        <p>Free accounts get the summary: the verdict, key numbers, the terminal-match check and three breakdowns (strategy tag, symbol, weekday). An active paid plan adds:</p>
        <ul className="list-disc space-y-1 pl-5">
          {FREE_LOCKED_SECTIONS.map((s) => <li key={s}>{s}</li>)}
        </ul>
        <p className="text-xs text-text-3">The PDF is created in your browser from the report on screen. It does not contain the uploaded file name or any account identifier, and nothing is uploaded or stored.</p>
      </GuideSection>

      <GuideSection title="Limits and honest caveats">
        <ul className="list-disc space-y-1 pl-5">
          <li>Closed positions only. Open (floating) profit or loss is excluded.</li>
          <li>Times are your broker's server time, not UTC, so hour and weekday breakdowns follow that clock.</li>
          <li>The statistics assume trades are roughly independent. If many trades overlap or depend on each other (for example several EAs trading at once, or sizing up after losses), AT24 detects it and caps positive evidence at "weak".</li>
          <li>Past results do not predict future results.</li>
          <li>Only the English MetaTrader 5 report (hedging account) has been verified. Netting accounts, MT4 and other platforms are not supported yet.</li>
        </ul>
      </GuideSection>

      <GuideSection title="Troubleshooting">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[30rem] text-left">
            <thead className="text-xs text-text-3"><tr><th className="py-1 pr-3">You see</th><th className="py-1">What to do</th></tr></thead>
            <tbody>
              {TROUBLE.map(([a, b]) => (
                <tr key={a} className="border-t border-border align-top"><td className="py-2 pr-3 text-text">{a}</td><td className="py-2">{b}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-text-3">Informational analysis only. Not investment advice. MetaTrader is a trademark of MetaQuotes Ltd.; AT24 is not affiliated with MetaQuotes.</p>
      </GuideSection>
    </div>
  );
}
