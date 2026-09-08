// types/credits.ts
// Sprint IA2 - inert type skeleton for a future AI-credit ledger. Nothing
// in the app reads or writes these yet - app/dashboard/credits/page.tsx
// still honestly states credit metering "not yet available", and no
// service/route/Prisma model implements this. This exists purely so a
// future credit-metering sprint has a documented starting shape instead of
// designing from scratch - per this sprint's explicit instruction not to
// implement fake metering. Do not wire this to real reads/writes without a
// real pricing/policy decision first (see the original IA sprint brief:
// "the exact credit prices/amounts are NOT being finalized").
export type CreditActionCategory =
  | "strategy_generation"
  | "strategy_modification"
  | "optimization"
  | "explanation"
  | "research"
  | "market_analysis"
  | "backtest_analysis"
  | "ai_agent_run"
  | "large_context_operation";

export interface CreditLedgerEntry {
  id: string;
  userId: string;
  category: CreditActionCategory;
  /** Credits consumed by this single action. Always > 0 - refunds/grants would be a separate entry type, not a negative amount. */
  amount: number;
  balanceAfter: number;
  createdAt: string;
  description: string;
}

export interface CreditBalance {
  userId: string;
  balance: number;
  updatedAt: string;
}

// Single source of truth for the human-readable category list - shared by
// any future ledger UI and by the Credits page's honest "what's planned"
// roadmap list today, so the two can never drift apart.
export const CREDIT_ACTION_LABELS: Record<CreditActionCategory, string> = {
  strategy_generation: "AI strategy generation",
  strategy_modification: "AI strategy modification",
  optimization: "AI optimization",
  explanation: "AI explanation",
  research: "AI research",
  market_analysis: "AI market analysis",
  backtest_analysis: "AI-powered backtest analysis",
  ai_agent_run: "AI agents",
  large_context_operation: "Large-context AI operations",
};
