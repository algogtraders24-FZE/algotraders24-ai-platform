"use client";
// components/chart-engine/ProSidePanel.tsx
// Right-hand panel of the Pro Chart (Pipflow-style tabs): Analysis (plan card + annotations), Trade (the paper
// account), Strategies (what is "watching" this chart). Presentational; NativeChart owns the state.
import type { ReactNode } from "react";
import Link from "next/link";
import type { TradePlan } from "@/lib/chart-engine/annotations/plan";
import type { AnnotationResult } from "@/lib/chart-engine/annotations/types";
import { AnnotationSummary, PlanOverlay } from "./ProModeBar";
import ProChat from "./ProChat";
import { buildReadout } from "@/lib/chart-engine/annotations/readout";
import type { ChartCandle } from "@/types/chart-data";

export type ProTab = "analysis" | "chat" | "trade" | "strategies";

interface Props {
  tab: ProTab;
  onTab: (t: ProTab) => void;
  symbol: string;
  timeframe: string;
  plan: TradePlan | null;
  analysis: AnnotationResult | null;
  onExecute: (side: "buy" | "sell") => void;
  onClosePlan: () => void;
  formatPrice: (n: number) => string;
  /** The paper-trading panel; always mounted (hidden when another tab is open) so its order ticket keeps working. */
  trade: ReactNode;
  onAnalyze: () => void;
  candles: ChartCandle[];
}

const TABS: { key: ProTab; label: string }[] = [
  { key: "analysis", label: "Analysis" },
  { key: "chat", label: "Chat" },
  { key: "trade", label: "Trade" },
  { key: "strategies", label: "Strategies" },
];

export function ProSidePanel({ tab, onTab, symbol, timeframe, plan, analysis, onExecute, onClosePlan, formatPrice, trade, onAnalyze, candles }: Props) {
  const watching = plan ? 1 : 0;
  return (
    <aside className="flex w-full shrink-0 flex-col gap-3 border-t border-border p-3 xl:w-80 xl:border-l xl:border-t-0">
      <div role="tablist" aria-label="Pro chart panel" className="flex items-center gap-1 rounded-control border border-border bg-ink-3 p-0.5">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            type="button"
            aria-selected={tab === t.key}
            onClick={() => onTab(t.key)}
            className={`flex-1 rounded-[4px] px-2 py-1.5 text-xs font-medium transition ${tab === t.key ? "bg-ink-4 text-text" : "text-text-3 hover:text-text"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className={tab === "analysis" ? "flex flex-col gap-3" : "hidden"}>
        <button type="button" onClick={onAnalyze} className="w-full rounded-control border border-border bg-ink-3 py-2 text-xs font-semibold text-text hover:border-gold/50">
          {analysis ? "Re-analyze" : "Analyze chart"}
        </button>
        {plan ? (
          <PlanOverlay inline plan={plan} onExecute={onExecute} onClose={onClosePlan} formatPrice={formatPrice} />
        ) : (
          <div className="rounded-panel border border-border bg-ink-2 p-3 text-xs text-text-3">
            Press <button type="button" onClick={onAnalyze} className="text-gold underline">Analyze chart</button> to get the structure map and a trade plan (or stand aside).
          </div>
        )}
        <div className="rounded-panel border border-border bg-ink-2 p-3">
          <AnnotationSummary analysis={analysis} formatPrice={formatPrice} />
        </div>
        {analysis && (
          <div className="rounded-panel border border-border bg-ink-2 p-3 text-xs text-text-2">
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-3">Market analysis</p>
            <p className="leading-relaxed">{buildReadout(candles, analysis, plan, formatPrice)?.paragraph ?? "Not enough candles for a readout."}</p>
            <p className="mt-2 text-[11px] text-text-3">Measured on the loaded candles. A description of the chart, not a prediction.</p>
          </div>
        )}
      </div>

      {tab === "chat" && <ProChat symbol={symbol} timeframe={timeframe} />}

      <div className={tab === "trade" ? "block" : "hidden"}>{trade}</div>

      <div className={tab === "strategies" ? "flex flex-col gap-3" : "hidden"}>
        <div className="flex items-center justify-between text-[11px] uppercase tracking-wide text-text-3">
          <span>Watching {symbol} · {timeframe.toUpperCase()}</span>
          <span>{watching} {watching === 1 ? "card" : "cards"}</span>
        </div>
        <div className="rounded-panel border border-border bg-ink-2 p-3 text-xs text-text-2">
          <div className="flex items-center justify-between">
            <span className="font-medium text-text">Structure Retest</span>
            <span className="rounded-full bg-green-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-green-400">Free</span>
          </div>
          <p className="mt-1 text-[11px] text-text-3">Waits for a BOS / CHoCH, then a retest of an order block or OTE zone. Stop beyond the zone, target 2R.</p>
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
        <div className="rounded-panel border border-dashed border-border bg-ink-2/60 p-3 text-xs text-text-3">
          <div className="flex items-center justify-between">
            <span className="font-medium text-text-2">Auto-trading bots</span>
            <span className="rounded-full bg-gold/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-gold">Advanced plan</span>
          </div>
          <p className="mt-1">Coming to the advanced plan. Strategies you build or pick from the gallery will appear here as watching cards.</p>
        </div>
        <Link href="/dashboard/quant-chat" className="rounded-control bg-gold px-3 py-2 text-center text-xs font-semibold text-ink hover:opacity-90">
          Build with AI
        </Link>
        <Link href="/dashboard/algo-test-library" className="rounded-control border border-border bg-ink-3 px-3 py-2 text-center text-xs text-text-2 hover:text-text">
          Gallery
        </Link>
      </div>
    </aside>
  );
}
