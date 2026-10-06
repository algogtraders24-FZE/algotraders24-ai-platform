// services/mcp/mcp-tool-map.ts
// AT24 MCP v1 - the external-name -> internal-tool-id map. Pure (no imports of
// heavy services) so the facade and scripts can use it without loading
// Prisma/providers. The ONLY place MCP names are mapped.

export const MCP_TOOL_MAP = {
  market_snapshot: "market.snapshot",
  market_intelligence: "market.intelligence",
  quant_backtest: "backtest.run",
  news_search: "news.search",
  economic_calendar: "calendar.events",
  strategy_library_search: "strategy.library_search",
  risk_calculator: "risk.calculator",
} as const;

export type McpToolName = keyof typeof MCP_TOOL_MAP;

export const MCP_TOOL_NAMES = Object.keys(MCP_TOOL_MAP) as McpToolName[];

export function isMcpToolName(value: string): value is McpToolName {
  return Object.prototype.hasOwnProperty.call(MCP_TOOL_MAP, value);
}
