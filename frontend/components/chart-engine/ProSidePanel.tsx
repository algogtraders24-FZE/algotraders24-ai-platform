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
  lastPrice?: number;
}

const TABS: { key: ProTab; label: string }[] = [
  { key: "analysis", label: "Analysis" },
  { key: "chat", label: "Chat" },
  { key: "trade", label: "Trade" },
  { key: "strategies", label: "Strategies" },
];

export function ProSidePanel({ tab, onTab, symbol, timeframe, plan, analysis, onExecute, onClosePlan, formatPrice, trade, onAnalyze, lastPrice }: Props) {
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
          <details className="rounded-panel border border-border bg-ink-2 p-3 text-xs text-text-2">
            <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wide text-text-3">Market analysis</summary>
            <ul className="mt-2 space-y-1.5">
              {readout(analysis, plan, lastPrice, formatPrice).map((r) => (
                <li key={r.title}>
                  <span className="font-medium text-text">{r.title}</span>
                  <span className="text-text-3"> {r.text}</span>
                </li>
              ))}
            </ul>
          </details>
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

/** Plain-language readout built only from the numbers already on the chart (structure, levels, ATR, the plan). */
function readout(analysis: AnnotationResult, plan: TradePlan | null, last: number | undefined, fmt: (n: number) => string): { title: string; text: string }[] {
  const rows: { title: string; text: string }[] = [];
  const breaks = analysis.annotations.filter((a) => a.type === "structure").sort((a, b) => (a.type === "structure" && b.type === "structure" ? b.toTime - a.toTime : 0));
  const b = breaks[0];
  rows.push({ title: "Trend:", text: b && b.type === "structure" ? `latest structure break is a ${b.kind} ${b.bias} at ${fmt(b.price)}.` : "no structure break in the loaded candles." });
  const levels = analysis.annotations.flatMap((a) => (a.type === "level" ? [a] : []));
  if (last !== undefined && levels.length > 0) {
    const above = levels.filter((l) => l.price > last).sort((x, y) => x.price - y.price)[0];
    const below = levels.filter((l) => l.price < last).sort((x, y) => y.price - x.price)[0];
    rows.push({ title: "Key levels:", text: `${above ? `resistance ${fmt(above.price)} (${above.touches} touches)` : "no resistance mapped above"}; ${below ? `support ${fmt(below.price)} (${below.touches} touches)` : "no support mapped below"}.` });
  }
  const atr = analysis.params.atr;
  rows.push({ title: "Volatility:", text: `ATR(14) ${fmt(atr)}${last ? ` (${((atr / last) * 100).toFixed(2)} % of price)` : ""}.` });
  if (plan && plan.state === "plan") {
    const risk = Math.abs(plan.entry - plan.stop);
    rows.push({ title: "Risk:", text: `stop is ${(risk / atr).toFixed(1)} ATR from entry (${fmt(risk)}); target is ${plan.rr} x that distance. Losing trades lose 1 R, winners make ${plan.rr} R.` });
  } else if (plan) {
    rows.push({ title: "Risk:", text: "no plan, so no risk is taken." });
  }
  return rows;
}
