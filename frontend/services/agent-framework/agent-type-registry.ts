// services/agent-framework/agent-type-registry.ts
// AT24 Agent Framework - Agent Type Registry (A1).
//
// LOCKED (AN1.2 decision D1): agent `type` is a validated free string. This
// code registry - NOT a Prisma enum - is the authority for which types
// exist and what each one's defaults and ceilings are. Adding EXECUTION,
// COMPLIANCE, PORTFOLIO_OPTIMIZER, STRATEGY_MONITOR, DATA_QUALITY later is
// one entry here plus (maybe) tools - zero schema migration.
//
// This file is declarative: a frozen data table plus pure lookup helpers.
// It has NO runtime behavior (no I/O, no DB, no network) and imports only
// from the contract layer. The dependency direction is:
//     contracts  <-  registry  <-  runtime (A4)
// never the reverse.

import type { AutonomyLevel } from "@/types/agent-framework/autonomy-contract";
import type { PermissionKey } from "@/types/agent-framework/permission-contract";

/** The 8 locked, canonical capabilities (AT24 AI Agents brief section 1). The
 *  Supervisor/Orchestrator is deliberately NOT here - it is runtime
 *  architecture, not a user-created agent type. */
export type AgentType =
  | "RESEARCH"
  | "MARKET_INTELLIGENCE"
  | "STRATEGY_RESEARCH"
  | "BACKTEST_OPTIMIZATION"
  | "RISK"
  | "NEWS_EVENT"
  | "TRADING_DECISION"
  | "PORTFOLIO"
  // CS1 (Chat Support Agent). NOT one of the 8 trading-capability types -
  // a customer-support specialisation of the same runtime. Read-only,
  // escalate-to-human, strictly separate from the main AI Assistant.
  | "SUPPORT";

export interface AgentTypeSpec {
  key: AgentType;
  label: string;
  description: string;
  /** Tool ids this type is seeded with in the Agent Builder. The Tool
   *  Registry (A2) is the authority on whether a tool actually exists /
   *  is enabled - these are defaults, not guarantees. */
  defaultTools: readonly string[];
  /** Permission grants seeded for this type. Still an allowlist - anything
   *  not here is denied. Never includes a DANGEROUS_PERMISSION. */
  defaultPermissions: readonly PermissionKey[];
  /** Hard ceiling on autonomyLevel for agents of this type. v1: every type
   *  is capped at 1 (decision-support / recommendation) - no agent takes an
   *  action this sprint. */
  autonomyCap: AutonomyLevel;
  /** True for RISK: a RISK agent's output is never gated by, or overridden
   *  by, a Trading Decision agent (brief section 18). */
  independentOfDecision?: boolean;
}

export const AGENT_TYPE_REGISTRY: Readonly<Record<AgentType, AgentTypeSpec>> = Object.freeze({
  RESEARCH: {
    key: "RESEARCH",
    label: "Research Agent",
    description: "Goal -> research -> evidence -> synthesis -> evidence-backed report.",
    defaultTools: ["research.knowledge_search", "research.web_search", "news.search"],
    defaultPermissions: ["CAN_RUN_RESEARCH", "CAN_READ_NEWS", "CAN_USE_MEMORY"],
    autonomyCap: 1,
  },
  MARKET_INTELLIGENCE: {
    key: "MARKET_INTELLIGENCE",
    label: "Market Intelligence Agent",
    description: "Regime / trend / momentum / volatility / key levels / risks / confidence, with evidence, over the existing deterministic pipeline.",
    defaultTools: ["market.intelligence", "market.snapshot", "indicators.compute", "news.search"],
    defaultPermissions: ["CAN_READ_MARKET_DATA", "CAN_READ_NEWS", "CAN_USE_MEMORY"],
    autonomyCap: 1,
  },
  STRATEGY_RESEARCH: {
    key: "STRATEGY_RESEARCH",
    label: "Strategy Research Agent",
    description: "Hypothesis -> strategy construction -> at24-quant-engine backtest -> robustness / OOS -> risk analysis -> recommendation.",
    defaultTools: ["market.intelligence", "strategy.library_lookup", "backtest.run", "risk.evaluate"],
    defaultPermissions: ["CAN_READ_MARKET_DATA", "CAN_RUN_RESEARCH", "CAN_RUN_BACKTEST", "CAN_USE_MEMORY"],
    autonomyCap: 1,
  },
  BACKTEST_OPTIMIZATION: {
    key: "BACKTEST_OPTIMIZATION",
    label: "Backtest / Optimization Agent",
    description: "Orchestrates backtests, parameter sweeps, walk-forward, Monte Carlo and sensitivity via the existing Quant/Algo-Test capability. Never a second engine.",
    defaultTools: ["backtest.run", "indicators.compute"],
    defaultPermissions: ["CAN_RUN_BACKTEST", "CAN_READ_MARKET_DATA", "CAN_USE_MEMORY"],
    autonomyCap: 1,
  },
  RISK: {
    key: "RISK",
    label: "Risk Agent",
    description: "Independent risk assessment: position / portfolio / drawdown / exposure / correlation / volatility / event / execution / strategy risk.",
    defaultTools: ["risk.evaluate", "portfolio.read", "market.snapshot"],
    defaultPermissions: ["CAN_READ_PORTFOLIO", "CAN_READ_MARKET_DATA", "CAN_USE_MEMORY"],
    autonomyCap: 1,
    independentOfDecision: true,
  },
  NEWS_EVENT: {
    key: "NEWS_EVENT",
    label: "News / Event Agent",
    description: "Tracks and evaluates market-moving news and scheduled events, with source citations.",
    defaultTools: ["news.search"],
    defaultPermissions: ["CAN_READ_NEWS", "CAN_USE_MEMORY"],
    autonomyCap: 1,
  },
  TRADING_DECISION: {
    key: "TRADING_DECISION",
    label: "Trading Decision Agent",
    description: "Decision support only in v1: decision / confidence / thesis / evidence / contradictions / invalidation. Never wired to live order execution.",
    defaultTools: ["market.intelligence", "risk.evaluate"],
    defaultPermissions: ["CAN_READ_MARKET_DATA", "CAN_USE_MEMORY"],
    autonomyCap: 1,
  },
  PORTFOLIO: {
    key: "PORTFOLIO",
    label: "Portfolio Agent",
    description: "Diversification / allocation / correlation review over the user's (paper) portfolio.",
    defaultTools: ["portfolio.read", "risk.evaluate"],
    defaultPermissions: ["CAN_READ_PORTFOLIO", "CAN_USE_MEMORY"],
    autonomyCap: 1,
  },
  SUPPORT: {
    key: "SUPPORT",
    label: "Support Assistant",
    description:
      "Answers a platform / product / billing / licensing support question strictly from the platform-owned " +
      "support knowledge base and (for account questions) the requester's own record status, then either " +
      "cites the answer or hands off to a human. Read-only; never a trade or an account change.",
    defaultTools: ["support.knowledge_search", "support.account_read"],
    defaultPermissions: ["CAN_RUN_SUPPORT", "CAN_READ_ACCOUNT_RECORDS"],
    autonomyCap: 1,
  },
});

export const AGENT_TYPES: readonly AgentType[] = Object.freeze(
  Object.keys(AGENT_TYPE_REGISTRY) as AgentType[],
);

/**
 * Legacy compatibility (AN1.2 decision D3). The 3 seeded rows and the mock
 * data in data/mock-agents.ts use an older vocabulary. These are mapped to
 * the canonical keys - the DB rows are never rewritten. A legacy type with
 * no framework equivalent (seo-writer, customer-support) intentionally has
 * no mapping: those agents stay on the frozen legacy layer. The CS1 `SUPPORT`
 * type is a NEW, purpose-built agent - deliberately NOT wired to the legacy
 * `customer-support` mock, and never inherits its behaviour.
 */
export const LEGACY_AGENT_TYPE_ALIASES: Readonly<Record<string, AgentType>> = Object.freeze({
  "market-analyst": "MARKET_INTELLIGENCE",
  "trading-copilot": "TRADING_DECISION",
  "risk-manager": "RISK",
  "news-researcher": "NEWS_EVENT",
  "portfolio-advisor": "PORTFOLIO",
  "strategy-generator": "STRATEGY_RESEARCH",
});

/** True iff `raw` is a canonical registry key. */
export function isRegisteredAgentType(raw: string): raw is AgentType {
  return Object.prototype.hasOwnProperty.call(AGENT_TYPE_REGISTRY, raw);
}

/** True iff `raw` is a canonical key OR a known legacy alias. This is the
 *  predicate the AgentDefinition validator uses at write time. */
export function isKnownAgentType(raw: string): boolean {
  return isRegisteredAgentType(raw) || Object.prototype.hasOwnProperty.call(LEGACY_AGENT_TYPE_ALIASES, raw);
}

/** Resolve any accepted string to its canonical key, or null if unknown. */
export function resolveAgentType(raw: string): AgentType | null {
  if (isRegisteredAgentType(raw)) return raw;
  return LEGACY_AGENT_TYPE_ALIASES[raw] ?? null;
}

/** The spec for a type (canonical or legacy alias), or undefined if unknown. */
export function getAgentTypeSpec(raw: string): AgentTypeSpec | undefined {
  const key = resolveAgentType(raw);
  return key ? AGENT_TYPE_REGISTRY[key] : undefined;
}

/** The autonomy ceiling for a type, or undefined if the type is unknown. */
export function autonomyCapForType(raw: string): AutonomyLevel | undefined {
  return getAgentTypeSpec(raw)?.autonomyCap;
}
