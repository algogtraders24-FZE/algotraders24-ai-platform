// types/market-regime-overview.ts
// Sprint D2.8.16 - the reframed "AI Signals" page's data contract. This
// deliberately does NOT reuse types/signal.ts's Signal shape (direction,
// targets, entry/stopLoss/takeProfit) - that shape is a trade-signal
// contract, and this platform has a permanent, repeatedly-documented
// principle against ever generating a BUY/SELL call, a target price, or a
// win-rate claim (see types/intelligence-decision-context.ts,
// types/verified-answer-response.ts, types/intelligence-score.ts). This
// type instead surfaces the SAME real regime/decision-state/Intelligence
// Score/evidence data the Workspace Research panel and Market Intelligence
// page already show for one symbol at a time - just batched across a fixed
// set of instruments for an at-a-glance overview. A quality/completeness
// score, never a probability of profit.
import type { MarketSymbol } from "./market";
import type { SignalTimeframe } from "./signal";
import type { RegimeType } from "./intelligence-regime";
import type { DecisionState } from "./intelligence-decision-context";
import type { RiskLevel } from "./risk";

export type MarketRegimeOverviewStatus = "resolved" | "insufficient-data" | "unresolved";

export interface MarketRegimeOverviewItem {
  symbol: MarketSymbol;
  name: string;
  status: MarketRegimeOverviewStatus;
  timeframe?: SignalTimeframe;
  regimeType?: RegimeType;
  decisionState?: DecisionState;
  /** The real, unmodified Intelligence Score - undefined only in the genuine total-blackout case, never a fabricated placeholder. */
  intelligenceScore?: number;
  riskLevel?: RiskLevel;
  /** The regime's own deterministic confidence (0-100) - unlike the data-quality score below, this one differs per market. */
  regimeConfidence?: number;
  /** Which risk categories sit at the overall level, and the engine's own first reason for the worst one (e.g. "7 of 8 evidence types unavailable"). The overall risk is the WORST of eight categories, so this says what is driving it. */
  riskDriver?: { categories: string[]; reason: string };
  /** One real, engine-produced evidence/basis line - never invented commentary. */
  basis?: string;
  generatedAt?: string;
}
