// types/intelligence-query.ts
// Sprint D2.6.2 - Real-Time Intelligence Query & Context Orchestration
// (Intelligence Engine V2, phase 6). See
// docs/architecture/D2.6.2-intelligence-query-context-spec.md for the
// full normalization rules, symbol/timeframe resolution priority, and
// ambiguity handling this contract represents.
//
// IntelligenceQuery is a NORMALIZED, DETERMINISTIC restatement of a raw
// trader question - never an LLM's interpretation of it. Classification
// uses fixed keyword/phrase rules only (see
// services/intelligence/query/intelligence-query.service.ts). When no
// rule matches, `queryType` is honestly "general-intelligence" and
// `classificationConfidence` is "low" - never a guessed, more specific
// type.
import type { MarketSymbol } from "./market";
import type { SignalTimeframe } from "./signal";

export type IntelligenceQueryType =
  | "current-state"
  | "regime"
  | "hypothesis"
  | "evidence"
  | "risk"
  | "historical"
  | "comparison"
  | "explanation"
  | "general-intelligence";

/**
 * What portion(s) of the Intelligence Engine's output a query is asking
 * about. A single query may resolve to multiple scopes (e.g. "why is
 * Gold weak and what could invalidate this view?" resolves to
 * market-state + regime + evidence + hypotheses + invalidation).
 */
export type IntelligenceQueryScope =
  | "market-state"
  | "regime"
  | "hypotheses"
  | "evidence"
  | "conflicts"
  | "risk"
  | "historical-validation"
  | "intelligence-score"
  | "invalidation"
  | "monitoring"
  | "missing-information"
  | "decision-context";

/** "high" only when at least one deterministic keyword rule matched; "low" whenever the query fell back to general-intelligence - never a probabilistic confidence value. */
export type QueryClassificationConfidence = "high" | "low";

export type MissingQueryContext = "symbol" | "timeframe";

export interface IntelligenceQuery {
  rawQuestion: string;

  /** Resolved per the priority order in resolveSymbol() - undefined, never guessed, when nothing resolves. */
  symbol?: MarketSymbol;
  /** Resolved per the priority order in resolveTimeframe() - undefined, never defaulted to a platform-wide default, when nothing resolves. */
  timeframe?: SignalTimeframe;

  queryType: IntelligenceQueryType;
  /** Deduplicated union of every matched keyword rule's scopes - never just the first rule's scopes. */
  requestedScopes: IntelligenceQueryScope[];

  classificationConfidence: QueryClassificationConfidence;
  /** True whenever zero keyword rules matched (queryType fell back to general-intelligence) OR the symbol could not be resolved due to multiple candidates - see the spec's ambiguity rules. */
  ambiguous: boolean;
  /** Which of symbol/timeframe could not be resolved from any priority source - never silently omitted. */
  missingContext: MissingQueryContext[];

  requestedAt: string;
  /** Independent of intelligenceEngineVersion - bumps only when the classification/resolution rules themselves change. */
  parserVersion: string;
}
