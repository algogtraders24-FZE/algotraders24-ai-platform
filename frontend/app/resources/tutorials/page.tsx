// app/resources/tutorials/page.tsx
// Step-by-step how-tos. Every step is taken from how the feature really works today (the same facts as the public
// support knowledge base and the product pages); nothing here promises a result. Links to dashboard pages sign you in first.
import type { Metadata } from "next";
import Link from "next/link";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/sections/Footer";
import PageHero from "@/components/marketing/PageHero";
import Card from "@/components/ui/Card";

export const metadata: Metadata = {
  title: "Tutorials",
  description:
    "Step-by-step guides: backtest a trading idea for free, use your licence key in MetaTrader, connect your account with Live Sync, analyse your trade history and set market alerts.",
  alternates: { canonical: "/resources/tutorials" },
};

interface Tutorial {
  id: string;
  title: string;
  summary: string;
  time: string;
  steps: string[];
  note?: string;
  cta: { label: string; href: string };
}

const TUTORIALS: readonly Tutorial[] = [
  {
    id: "backtest-free",
    title: "Backtest a trading idea for free (Quant Lite)",
    summary: "Turn an idea into rules, test it on real history and download the code.",
    time: "about 10 minutes",
    steps: [
      "Open the Quant Lite builder.",
      "Pick indicators, set the BUY and SELL conditions, and define the stop-loss and take-profit rules.",
      "Choose a supported symbol, timeframe and date range. Coverage is checked before you run.",
      "Run the backtest. It uses one deterministic engine on real historical data.",
      "Read the metrics, equity curve and full trade ledger, and the panel that lists the exact assumptions behind the result.",
      "If you want the code, download MT4, MT5 or Pine Script from the Code Generation section of the results page, and test it before using it live.",
    ],
    note: "A backtest describes how a strategy would have behaved in the past. It is not a prediction.",
    cta: { label: "Open the builder", href: "/quant-lite/builder" },
  },
  {
    id: "licence-key",
    title: "Use your licence key in an Expert Advisor",
    summary: "Where the key is and where it goes in MetaTrader 5 or 4.",
    time: "about 5 minutes",
    steps: [
      "After you buy, open your purchase page and use the reveal option to show your licence key. It looks like AT24-<licence id>.<key>.",
      "Copy the whole string, with no spaces.",
      "In MetaTrader, open Tools, Options, Expert Advisors and allow WebRequest for https://www.algotraders24.ai.",
      "Attach the Expert Advisor to a chart and paste the key into its licence key input (InpLicenseKey). Allow algo trading.",
      "The Expert Advisor checks the key with AT24 and, by default, binds it to the trading account and server it first runs on.",
    ],
    note: "A key runs only the product it was bought for, and on one account at a time. You can move it to another trading account (2 changes in 30 days). If it says the licence is invalid, check that you copied the full string and that the licence shows as ACTIVE on your Licenses page.",
    cta: { label: "Open my licences", href: "/dashboard/licenses" },
  },
  {
    id: "live-sync",
    title: "Connect your MetaTrader account with Live Sync",
    summary: "See your account status in AT24 using a read-only Expert Advisor.",
    time: "about 10 minutes",
    steps: [
      "Open Live Sync in your dashboard and accept the consent box.",
      "Create a device token. It is shown once, so copy it straight away.",
      "Download the Live Sync Expert Advisor for your platform (MetaTrader 5 or 4).",
      "On MetaTrader 4, set the terminal's Account History to All History first, otherwise older trades are not sent.",
      "Allow WebRequest for https://www.algotraders24.ai, attach the Expert Advisor to one chart, paste the token into its settings and allow algo trading.",
      "Your closed deals and account snapshots start to appear. You can revoke the token at any time and the connection stops.",
    ],
    note: "Live Sync is read-only: it cannot place, change or close trades. Numbers are reported by your own terminal and are not verified by a broker.",
    cta: { label: "Open Live Sync", href: "/dashboard/live-sync" },
  },
  {
    id: "edge-analyzer",
    title: "Analyse your trade history (Edge Analyzer)",
    summary: "Find out whether your results show a detectable edge.",
    time: "about 5 minutes",
    steps: [
      "In MetaTrader 5, open the History tab, right-click and choose Report, then HTML. Save the file.",
      "Make sure the terminal is set to English. It must be the English MT5 HTML report, not CSV, PDF or a screenshot.",
      "Upload it on the Edge Analyzer page.",
      "Read the verdict, the key figures checked against the terminal's own results, where you win and lose, and the risk simulation.",
    ],
    note: "Only the English report from a hedging account is verified; netting accounts, MT4 and other platforms are not supported yet. Your file is analysed in memory and account number, name and broker details are never read. Free accounts get the summary, the terminal-match check and three breakdowns; paid plans unlock the full analysis and a PDF export. Informational only, not investment advice.",
    cta: { label: "Open the Edge Analyzer", href: "/dashboard/edge-analyzer" },
  },
  {
    id: "alerts",
    title: "Get market alerts in the bell, Telegram and on your phone",
    summary: "Be told when a market is near a key level, volatile or close to an event.",
    time: "about 5 minutes",
    steps: [
      "Open Alerts in your dashboard and choose what to be told about: near yesterday's high or low, high volatility or an important economic event coming up.",
      "Each alert is sent once when it triggers, then waits before it can fire again.",
      "To use Telegram, choose the link option, open the AT24 bot and press Start. Send /status to check or /stop to turn it off.",
      "To get push notifications, install AT24 as an app: in your browser menu choose Install or Add to Home Screen (on iPhone or iPad open the site in Safari first) and allow notifications.",
    ],
    note: "Alerts are informational and are not trading advice.",
    cta: { label: "Open Alerts", href: "/dashboard/alerts" },
  },
  {
    id: "my-rules",
    title: "Give the AI Assistant your own trading rules",
    summary: "Write your risk limits once so every answer takes them into account.",
    time: "about 5 minutes",
    steps: [
      "Open the Knowledge page and choose My Trading Rules.",
      "Fill in the short form: maximum risk per trade, maximum daily loss, maximum drawdown, the instruments and sessions you trade and when you will not trade. You can add your prop firm's own rules too.",
      "Save. It is stored as one document and saving again replaces it.",
      "Ask the AI Assistant a market question. It answers with your rules in mind and can cite them. It only restates what you wrote.",
    ],
    note: "You can also upload your own documents as text, Markdown or Word (DOCX). If a PDF cannot be read you will be asked to upload it in one of those formats. You can delete your rules and documents at any time.",
    cta: { label: "Open Knowledge", href: "/dashboard/knowledge" },
  },
];

export default function TutorialsPage() {
  return (
    <main className="min-h-screen bg-ink text-text">
      <Navbar />
      <PageHero
        eyebrow="Resources / Tutorials"
        title="Step-by-step guides"
        subtitle="Short, practical how-tos for the things people ask us most. New to AT24? Start with the 15-minute path."
      />

      <section className="px-6 pt-8">
        <div className="mx-auto max-w-3xl">
          <Card className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-text-2">Not sure where to begin?</p>
            <Link href="/getting-started" className="text-sm font-semibold text-gold underline-offset-4 hover:underline">
              Your first 15 minutes with AT24
            </Link>
          </Card>
        </div>
      </section>

      <section className="px-6 py-8">
        <div className="mx-auto max-w-3xl space-y-4">
          {TUTORIALS.map((t) => (
            <details key={t.id} id={t.id} className="group rounded-card border border-border bg-ink-2 p-6 open:border-gold/40">
              <summary className="flex cursor-pointer list-none items-start justify-between gap-4">
                <span>
                  <span className="block text-lg font-semibold">{t.title}</span>
                  <span className="mt-1 block text-sm text-text-2">{t.summary}</span>
                  <span className="mt-2 block text-xs uppercase tracking-wide text-text-3">{t.time}</span>
                </span>
                <span aria-hidden="true" className="mt-1 text-gold transition-transform group-open:rotate-45">
                  +
                </span>
              </summary>
              <ol className="mt-5 list-decimal space-y-2 pl-5 text-sm leading-6 text-text-2">
                {t.steps.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
              {t.note && <p className="mt-4 rounded-control border border-border bg-ink p-3 text-xs leading-5 text-text-3">{t.note}</p>}
              <Link href={t.cta.href} className="mt-5 inline-block text-sm font-semibold text-gold underline-offset-4 hover:underline">
                {t.cta.label}
              </Link>
            </details>
          ))}
        </div>
        <p className="mx-auto mt-8 max-w-3xl text-center text-sm text-text-2">
          Stuck? Ask the AT24 Copilot, or write to{" "}
          <a href="mailto:support@algotraders24.ai" className="text-gold underline-offset-4 hover:underline">
            support@algotraders24.ai
          </a>
          .
        </p>
      </section>

      <Footer />
    </main>
  );
}
