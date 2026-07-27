// types/analysis-run.ts
// Sprint 15D.1 - Domain representation of a single market-intelligence
// analysis, deliberately distinct from a ConversationMessage (locked
// decision: AnalysisRun is a separate long-term domain concept). No Prisma
// model or migration exists yet - this is the service-boundary shape only,
// designed so a future PrismaAnalysisRunRepository can back it without
// changing the shape (the same evolution Message/Conversation followed
// across Sprint 15C.3-15C.7). userId mirrors every other entity in this
// project: always session-derived by the caller, never trusted from a
// client-supplied value.
import type { MarketSymbol } from "./market";
import type { MarketContext } from "./market-context";

export type AnalysisRunStatus = "pending" | "completed" | "unavailable" | "failed";

export interface AnalysisRun {
  id: string;
  userId: string;
  symbol: MarketSymbol;
  status: AnalysisRunStatus;
  /** Null until the run completes; also null if it ends unavailable/failed. */
  context: MarketContext | null;
  /** Human-readable outcome: an AI-generated summary on success, or the reason on unavailable/failed. */
  summary: string | null;
  createdAt: string;
  completedAt: string | null;
}
