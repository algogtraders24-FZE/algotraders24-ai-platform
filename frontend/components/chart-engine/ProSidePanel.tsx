"use client";
// components/chart-engine/ProSidePanel.tsx
// Right-hand panel of the Pro Chart, laid out like the reference chart: Chat (analysis + PRAGYA chat with quick prompts),
// PRAGYA (voice), Trade (MT5 connection), Strategies (watching cards, build, gallery). Presentational; NativeChart owns the state.
import Link from "next/link";
import type { TradePlan } from "@/lib/chart-engine/annotations/plan";
import type { AnnotationResult } from "@/lib/chart-engine/annotations/types";
import { AnnotationSummary, PlanOverlay } from "./ProModeBar";
import ProChat from "./ProChat";
import BrokerPanel from "./BrokerPanel";
import { buildReadout } from "@/lib/chart-engine/annotations/readout";
import type { ChartCandle } from "@/types/chart-data";

export type ProTab = "chat" | "voice" | "trade" | "strategies";

interface Props {
  tab: ProTab;
  onTab: (t: ProTab) => void;
  symbol: string;
  timeframe: string;
  plan: TradePlan | null;
  analysis: AnnotationResult | null;
  /** Execute on the plan card: opens the Trade tab (MT5 connection). */
  onExecute: () => void;
  onClosePlan: () => void;
  formatPrice: (n: number) => string;
  onAnalyze: () => void;
  candles: ChartCandle[];
  getChatFacts: () => string | null;
  pragya: { status: "idle" | "loading" | "ready" | "error"; text: string };
  /** Opens the Strategy Tester drawer under the chart. */
  onOpenTester: () => void;
  /** Phones: the panel is a bottom sheet that is opened and closed on demand. */
  mobileOpen?: boolean;
  onMobileClose?: () => void;
  /** The Analyze scan is running: the Chat tab shows a loader instead of its content. */
  scanning?: boolean;
}

const TABS: { key: ProTab; label: string }[] = [
  { key: "chat", label: "Chat" },
  { key: "voice", label: "PRAGYA" },
  { key: "trade", label: "Trade" },
  { key: "strategies", label: "Strategies" },
];

function Mt5Panel({ plan, formatPrice }: { plan: TradePlan | null; formatPrice: (n: number) => string }) {
  return (
    <div className="flex flex-col items-center gap-3 px-2 pt-16 text-center">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h14a2 2 0 012 2v9a2 2 0 01-2 2H6a2 2 0 01-2-2V7zM4 7l12-3v3M16 13h2" /></svg>
      <p className="text-[16px] font-semibold text-text">No MT5 account connected</p>
      <p className="text-[13px] leading-relaxed text-text-3">Connect your MetaTrader 5 account to send this chart&apos;s trades to your broker. An order is only ever sent when you press the button yourself.</p>
      <button type="button" disabled className="mt-1 w-full cursor-not-allowed rounded-lg bg-gold/40 px-4 py-2.5 text-[14px] font-semibold text-ink/80">Connect MT5 (coming soon)</button>
      {plan && plan.state === "plan" && (
        <div className="mt-4 w-full rounded-lg border border-border bg-ink-3 p-3 text-left text-[13px] text-text-2">
          <p className="mb-1 text-[11.5px] font-semibold uppercase tracking-wide text-text-3">Current plan (not sent anywhere)</p>
          <p>{plan.dir.toUpperCase()} · {plan.entryType === "limit" ? "limit" : "market"} entry {formatPrice(plan.entry)}, stop {formatPrice(plan.stop)}, target {formatPrice(plan.target)} (R:R 1:{plan.rr}).</p>
        </div>
      )}
    </div>
  );
}

export function ProSidePanel({ tab, onTab, symbol, timeframe, plan, analysis, onExecute, onClosePlan, formatPrice, onAnalyze, candles, pragya, getChatFacts, onOpenTester, mobileOpen = false, onMobileClose, scanning = false }: Props) {
  const watching = plan ? 1 : 0;
  return (
    <aside className={`${mobileOpen ? "flex" : "hidden"} fixed inset-x-0 bottom-0 z-[70] h-[52vh] w-full flex-col gap-3 overflow-y-auto rounded-t-2xl border-t border-border bg-ink-2 p-3 text-text-2 max-md:pb-20 shadow-2xl md:static md:z-auto md:flex md:h-full md:w-[380px] md:shrink-0 md:rounded-none md:border-l md:border-t-0 md:shadow-none`}>
      <div className="flex items-center justify-between md:hidden">
        <span className="mx-auto h-1 w-10 rounded-full bg-ink-4" aria-hidden="true" />
        <button type="button" onClick={onMobileClose} aria-label="Close panel" className="absolute right-3 top-2 flex h-8 w-8 items-center justify-center rounded-md text-text-3 hover:bg-ink-4 hover:text-text">✕</button>
      </div>
      <div role="tablist" aria-label="Pro chart panel" className="flex items-center gap-1 rounded-lg bg-ink-3 p-0.5">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            type="button"
            aria-selected={tab === t.key}
            onClick={() => onTab(t.key)}
            className={`flex-1 rounded-md px-2 py-1.5 text-[14px] font-medium transition ${tab === t.key ? "bg-ink-4 text-text" : "text-text-3 hover:text-text"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className={tab === "chat" && scanning ? "flex flex-col items-center gap-4 pt-20 text-center" : "hidden"} role="status" aria-live="polite">
        <span className="relative flex h-16 w-16 items-center justify-center rounded-full bg-gold/10 text-2xl text-gold">
          <span className="absolute inset-0 animate-spin rounded-full border-2 border-gold/20 border-t-gold" aria-hidden="true" />
          ✦
        </span>
        <p className="text-[14px] text-text-3">Scanning price action…</p>
      </div>

      <div className={tab === "chat" && !scanning ? "flex flex-col gap-3" : "hidden"}>
        {!analysis ? (
          <div className="flex flex-col items-center gap-1 pt-3 text-center">
            <p className="text-[15px] font-semibold text-text">{symbol} · {timeframe.toUpperCase()}</p>
            <p className="text-[13px] text-text-3">Ask PRAGYA anything about this chart</p>
            <button type="button" onClick={onAnalyze} className="mt-3 w-full rounded-lg bg-gold py-2.5 text-[14px] font-semibold text-ink hover:brightness-110">Analyze chart</button>
            <div className="my-3 flex w-full items-center gap-3 text-[11.5px] uppercase tracking-wider text-text-3"><span className="h-px flex-1 bg-ink-4" />or ask<span className="h-px flex-1 bg-ink-4" /></div>
          </div>
        ) : (
          <>
            <button type="button" onClick={onAnalyze} className="w-full rounded-lg border border-border bg-ink-3 py-2 text-[14px] font-semibold text-text hover:bg-ink-4">Re-analyze</button>
            {plan && <PlanOverlay inline plan={plan} onExecute={onExecute} onClose={onClosePlan} formatPrice={formatPrice} />}
            <div className="rounded-lg border border-border bg-ink-3/60 p-3">
              <AnnotationSummary analysis={analysis} formatPrice={formatPrice} />
            </div>
            <div className="rounded-lg border border-border bg-ink-3/60 p-3 text-[14px] text-text-2">
              {pragya.status !== "idle" && pragya.status !== "error" && (
                <div className="mb-3 rounded-md border border-gold/30 bg-gold/5 p-2.5">
                  <p className="mb-1 text-[12.5px] font-semibold uppercase tracking-wide text-gold">✦ PRAGYA</p>
                  {pragya.status === "loading" ? <p className="text-text-3">PRAGYA is writing the analysis…</p> : <p className="leading-relaxed">{pragya.text}</p>}
                </div>
              )}
              <p className="mb-1.5 text-[12.5px] font-semibold uppercase tracking-wide text-text-3">Measured readout</p>
              <p className="leading-relaxed">{buildReadout(candles, analysis, plan, formatPrice)?.paragraph ?? "Not enough candles for a readout."}</p>
              <p className="mt-2 text-[12.5px] text-text-3">Measured on the loaded candles. A description of the chart, not a prediction.</p>
            </div>
          </>
        )}
        <ProChat symbol={symbol} timeframe={timeframe} getFacts={getChatFacts} onAnalyze={onAnalyze} />
      </div>

      <div className={tab === "voice" ? "flex flex-col items-center gap-4 pt-16 text-center" : "hidden"}>
        <div className="flex gap-1 rounded-full bg-ink-3 p-0.5 text-[13px]">
          <span className="rounded-full bg-gold px-4 py-1.5 font-medium text-text">Voice</span>
          <button type="button" onClick={() => onTab("chat")} className="rounded-full px-4 py-1.5 text-text-3 hover:text-text">Text</button>
        </div>
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-gold/15 text-3xl text-gold">✦</div>
        <p className="text-[16px] font-semibold text-text">PRAGYA</p>
        <p className="text-[13px] text-text-3">Your voice-powered trading assistant</p>
        <button type="button" disabled className="w-full cursor-not-allowed rounded-lg bg-gold/40 px-4 py-2.5 text-[14px] font-semibold text-ink/80">Start Conversation (coming soon)</button>
        <p className="text-[12.5px] text-text-3">Voice is not available yet. The Text tab and the Chat tab already answer from this chart.</p>
      </div>

      <div className={tab === "trade" ? "block" : "hidden"}>
        <BrokerPanel active={tab === "trade"} symbol={symbol} plan={plan} formatPrice={formatPrice} fallback={<Mt5Panel plan={plan} formatPrice={formatPrice} />} />
      </div>

      <div className={tab === "strategies" ? "flex flex-col gap-3" : "hidden"}>
        <div className="flex items-center justify-between text-[12.5px] uppercase tracking-wide text-text-3">
          <span>Watching {symbol} · {timeframe.toUpperCase()}</span>
          <span>{watching} {watching === 1 ? "card" : "cards"}</span>
        </div>
        <div className="rounded-lg border border-border bg-ink-3/60 p-3 text-[14px] text-text-2">
          <div className="flex items-center justify-between">
            <span className="font-medium text-text">Structure Retest</span>
            <span className="rounded-full bg-green-500/15 px-2 py-0.5 text-[11.5px] font-semibold uppercase text-green-400">Free</span>
          </div>
          <p className="mt-1 text-[12.5px] text-text-3">Waits for a BOS / CHoCH, then a retest of an order block or OTE zone. Stop beyond the zone, target 2R.</p>
          <p className="mt-2">
            {!plan ? (
              <>Status: not analysed yet. <button type="button" onClick={onAnalyze} className="text-gold underline">Analyze chart</button></>
            ) : plan.state === "plan" ? (
              <>Status: <span className={plan.dir === "long" ? "text-green-400" : "text-red-400"}>{plan.dir} setup</span> at {formatPrice(plan.entry)}</>
            ) : (
              <>Status: standing aside. {plan.reason}</>
            )}
          </p>
        </div>
        <div className="rounded-lg border border-dashed border-border p-3 text-[14px] text-text-3">
          <div className="flex items-center justify-between">
            <span className="font-medium text-text-2">Auto-trading bots</span>
            <span className="rounded-full bg-gold/15 px-2 py-0.5 text-[11.5px] font-semibold uppercase text-gold">Advanced plan</span>
          </div>
          <p className="mt-1">Coming to the advanced plan. Strategies you build or pick from the gallery will appear here as watching cards.</p>
        </div>
        <Link href="/dashboard/quant-chat" className="rounded-lg bg-gold px-3 py-2.5 text-center text-[14px] font-semibold text-ink hover:brightness-110">Build with AI</Link>
        <Link href="/dashboard/algo-test-library" className="rounded-lg border border-border bg-ink-3 px-3 py-2.5 text-center text-[14px] text-text-2 hover:bg-ink-4">Gallery</Link>
        <button type="button" onClick={onOpenTester} className="rounded-lg border border-gold/40 bg-gold/10 px-3 py-2.5 text-center text-[14px] font-semibold text-gold hover:bg-gold/20">Open Strategy Tester</button>
      </div>
    </aside>
  );
}
