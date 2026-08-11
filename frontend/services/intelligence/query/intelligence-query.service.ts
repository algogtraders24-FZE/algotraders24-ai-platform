// services/intelligence/query/intelligence-query.service.ts
// Sprint D2.6.2 - Real-Time Intelligence Query & Context Orchestration.
// Pure, synchronous, I/O-free query normalizer: turns a raw trader
// question into a deterministic IntelligenceQuery. No LLM, no intent
// classification model, no network - every classification is a fixed
// keyword/phrase rule, documented and versioned
// (INTELLIGENCE_QUERY_PARSER_VERSION). When no rule matches, this is
// honest about it: queryType falls back to "general-intelligence" and
// classificationConfidence to "low" - never a guessed, more specific
// interpretation. See docs/architecture/D2.6.2-intelligence-query-
// context-spec.md §1-3 for the full rule tables and rationale.
import type { MarketSymbol } from "@/types/market";
import type { SignalTimeframe } from "@/types/signal";
import { isKnownMarket } from "@/lib/market-data/market-registry";
import type {
  IntelligenceQuery,
  IntelligenceQueryType,
  IntelligenceQueryScope,
  MissingQueryContext,
} from "@/types/intelligence-query";
import type { ConversationIntelligenceContext } from "@/types/intelligence-context-request";

export const INTELLIGENCE_QUERY_PARSER_VERSION = "1.0.0";

// Colloquial aliases for the known market registry (lib/market-data/
// market-registry.ts) - a small, explicit, hand-authored lookup table,
// never a fuzzy/semantic match. Every value here must be a real,
// registered symbol; extending the registry with a new market requires
// a matching entry here to be extractable from free text at all.
const SYMBOL_ALIASES: Record<string, MarketSymbol> = {
  gold: "XAUUSD",
  xau: "XAUUSD",
  silver: "XAGUSD",
  xag: "XAGUSD",
  bitcoin: "BTCUSD",
  btc: "BTCUSD",
  ethereum: "ETHUSD",
  eth: "ETHUSD",
  solana: "SOLUSD",
  sol: "SOLUSD",
  xrp: "XRPUSD",
  ripple: "XRPUSD",
  euro: "EURUSD",
  pound: "GBPUSD",
  sterling: "GBPUSD",
  cable: "GBPUSD",
  yen: "USDJPY",
  // Sprint D2.6.6 - India (NSE). Note tokenize() only matches single
  // words (see below) - "bank nifty" as two separate tokens cannot be
  // distinguished from "nifty" alone, so "banknifty" (no space) is the
  // reliable free-text form for BANKNIFTY; this is an explicit,
  // documented limitation of the existing single-token alias design,
  // not something this sprint redesigns. TCS/INFY/HDFCBANK/RELIANCE
  // already resolve without an alias entry here because their raw
  // uppercased token exactly equals their market-registry.ts symbol id.
  nifty: "NIFTY50",
  nifty50: "NIFTY50",
  banknifty: "BANKNIFTY",
  infosys: "INFY",
};

const TIMEFRAME_TOKENS: readonly SignalTimeframe[] = ["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w"];

// Explicit alias table, same discipline as SYMBOL_ALIASES - a fixed set
// of common spellings, never a parsed/inferred duration.
const TIMEFRAME_ALIASES: Record<string, SignalTimeframe> = {
  m1: "1m",
  m5: "5m",
  m15: "15m",
  m30: "30m",
  h1: "1h",
  h4: "4h",
  d1: "1d",
  w1: "1w",
  hourly: "1h",
  daily: "1d",
  weekly: "1w",
};

function tokenize(question: string): string[] {
  return question.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

export interface SymbolResolution {
  symbol?: MarketSymbol;
  source: "explicit-query" | "request-context" | "conversation-context" | "unresolved";
  /** Non-empty only when multiple distinct symbols were mentioned in the raw text - the deterministic reason a symbol was NOT resolved from the query itself. */
  ambiguousCandidates: MarketSymbol[];
}

export interface TimeframeResolution {
  timeframe?: SignalTimeframe;
  source: "explicit-query" | "request-context" | "conversation-context" | "unresolved";
}

/** Priority order: (1) explicit in the question text, (2) request-supplied context, (3) active conversation context, (4) unresolved. Never invents a symbol. */
export function resolveSymbol(
  rawQuestion: string,
  requestContextSymbol: MarketSymbol | undefined,
  conversationContext: ConversationIntelligenceContext | undefined,
): SymbolResolution {
  const tokens = tokenize(rawQuestion);
  const found = new Set<MarketSymbol>();
  for (const token of tokens) {
    const alias = SYMBOL_ALIASES[token];
    if (alias) {
      found.add(alias);
      continue;
    }
    const upper = token.toUpperCase();
    if (isKnownMarket(upper)) found.add(upper);
  }

  if (found.size === 1) {
    return { symbol: [...found][0], source: "explicit-query", ambiguousCandidates: [] };
  }
  if (found.size > 1) {
    // Multiple distinct symbols mentioned - never guess which one the trader means.
    return { symbol: undefined, source: "unresolved", ambiguousCandidates: [...found] };
  }
  if (requestContextSymbol) {
    return { symbol: requestContextSymbol, source: "request-context", ambiguousCandidates: [] };
  }
  if (conversationContext?.activeSymbol) {
    return { symbol: conversationContext.activeSymbol, source: "conversation-context", ambiguousCandidates: [] };
  }
  return { symbol: undefined, source: "unresolved", ambiguousCandidates: [] };
}

/** Same priority order as resolveSymbol. Never defaults to a platform-wide default timeframe. */
export function resolveTimeframe(
  rawQuestion: string,
  requestContextTimeframe: SignalTimeframe | undefined,
  conversationContext: ConversationIntelligenceContext | undefined,
): TimeframeResolution {
  const tokens = tokenize(rawQuestion);
  for (const token of tokens) {
    if ((TIMEFRAME_TOKENS as readonly string[]).includes(token)) {
      return { timeframe: token as SignalTimeframe, source: "explicit-query" };
    }
    const alias = TIMEFRAME_ALIASES[token];
    if (alias) return { timeframe: alias, source: "explicit-query" };
  }
  if (requestContextTimeframe) {
    return { timeframe: requestContextTimeframe, source: "request-context" };
  }
  if (conversationContext?.activeTimeframe) {
    return { timeframe: conversationContext.activeTimeframe, source: "conversation-context" };
  }
  return { timeframe: undefined, source: "unresolved" };
}

interface QueryTypeRule {
  name: string;
  test: (lowerQuestion: string) => boolean;
  queryType: IntelligenceQueryType;
  scopes: readonly IntelligenceQueryScope[];
}

// Checked in this exact order. `queryType` on the final IntelligenceQuery
// is the FIRST matching rule's queryType (most specific/actionable
// phrasing wins); `requestedScopes` is the deduplicated UNION of every
// matching rule's scopes - see the worked "why is Gold weak and what
// could invalidate this view?" example in the spec, which matches both
// the "invalidation" and "evidence" rules and reports the union of both.
const QUERY_TYPE_RULES: readonly QueryTypeRule[] = [
  {
    name: "invalidation",
    test: (q) => /\binvalidat|disprove|prove.*wrong|proven wrong/.test(q),
    queryType: "hypothesis",
    scopes: ["hypotheses", "invalidation"],
  },
  {
    name: "hypothesis",
    test: (q) => /hypothes|what could happen|what happens next|what might happen|scenario/.test(q),
    queryType: "hypothesis",
    scopes: ["hypotheses"],
  },
  {
    name: "evidence",
    test: (q) => /\bwhy\b|\breason\b|\bevidence\b|\bbecause\b/.test(q),
    queryType: "evidence",
    scopes: ["evidence", "conflicts", "market-state", "regime"],
  },
  {
    name: "regime",
    test: (q) => /\bregime\b|\btrend\b|market condition|\bphase\b/.test(q),
    queryType: "regime",
    scopes: ["regime", "market-state"],
  },
  {
    name: "historical",
    test: (q) => /historical|worked before|track record|validated|past performance|has this worked/.test(q),
    queryType: "historical",
    scopes: ["historical-validation"],
  },
  {
    name: "risk",
    test: (q) => /\brisks?\b/.test(q),
    queryType: "risk",
    scopes: ["risk"],
  },
  {
    name: "score",
    test: (q) => /confiden|how much should i trust|reliab/.test(q),
    queryType: "explanation",
    scopes: ["intelligence-score"],
  },
  {
    name: "comparison",
    test: (q) => /\bcompare\b|\bversus\b|\bvs\b/.test(q),
    queryType: "comparison",
    scopes: ["market-state", "regime"],
  },
  {
    name: "current-state",
    test: (q) => /what is .* doing|current (state|price)|right now|\bstatus\b|how is .* (doing|trading)/.test(q),
    queryType: "current-state",
    scopes: ["market-state"],
  },
];

export interface ParseIntelligenceQueryInput {
  rawQuestion: string;
  requestContextSymbol?: MarketSymbol;
  requestContextTimeframe?: SignalTimeframe;
  conversationContext?: ConversationIntelligenceContext;
  /** Caller-supplied for determinism/testability - never Date.now() internally. */
  requestedAt: string;
}

export class IntelligenceQueryService {
  parse(input: ParseIntelligenceQueryInput): IntelligenceQuery {
    const lower = input.rawQuestion.toLowerCase();

    const matched = QUERY_TYPE_RULES.filter((rule) => rule.test(lower));
    const scopeSet = new Set<IntelligenceQueryScope>();
    for (const rule of matched) for (const scope of rule.scopes) scopeSet.add(scope);

    const symbolResolution = resolveSymbol(input.rawQuestion, input.requestContextSymbol, input.conversationContext);
    const timeframeResolution = resolveTimeframe(input.rawQuestion, input.requestContextTimeframe, input.conversationContext);

    const missingContext: MissingQueryContext[] = [];
    if (!symbolResolution.symbol) missingContext.push("symbol");
    if (!timeframeResolution.timeframe) missingContext.push("timeframe");

    const noRuleMatched = matched.length === 0;
    const queryType: IntelligenceQueryType = noRuleMatched ? "general-intelligence" : matched[0].queryType;
    const requestedScopes: IntelligenceQueryScope[] = noRuleMatched ? ["decision-context"] : [...scopeSet];

    return {
      rawQuestion: input.rawQuestion,
      symbol: symbolResolution.symbol,
      timeframe: timeframeResolution.timeframe,
      queryType,
      requestedScopes,
      classificationConfidence: noRuleMatched ? "low" : "high",
      ambiguous: noRuleMatched || symbolResolution.ambiguousCandidates.length > 0,
      missingContext,
      requestedAt: input.requestedAt,
      parserVersion: INTELLIGENCE_QUERY_PARSER_VERSION,
    };
  }
}
