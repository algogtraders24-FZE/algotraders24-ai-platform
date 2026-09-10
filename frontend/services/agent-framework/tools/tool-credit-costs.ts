// services/agent-framework/tools/tool-credit-costs.ts
// AT24 Agent Framework - A2. PLACEHOLDER per-tool credit costs.
//
// LOCKED (AN1.2 P3): no pricing decisions this sprint. These are placeholder
// constants only. The real credit ledger + enforcement + estimation is A9.
// A2 uses these solely to (a) populate ToolDefinition.creditCost and (b) let
// the gateway stamp a pre-estimate on ToolResult.creditsConsumed so the
// metering *seam* is exercised. None of these numbers is a committed price.
//
// PLACEHOLDER - pricing pass required (A9).

export const TOOL_CREDIT_COST_PLACEHOLDERS = {
  "market.snapshot": 1,
  "market.intelligence": 4,
  "backtest.run": 8,
  "portfolio.read": 1,
  "research.knowledge_search": 2,
  "news.search": 2,
  "support.knowledge_search": 2,
  "support.account_read": 1,
} as const;

export type PlaceholderCostToolId = keyof typeof TOOL_CREDIT_COST_PLACEHOLDERS;

export function placeholderFlatCost(toolId: PlaceholderCostToolId): number {
  return TOOL_CREDIT_COST_PLACEHOLDERS[toolId];
}
