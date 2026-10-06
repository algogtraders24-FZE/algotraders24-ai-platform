// services/mcp/mcp-registry.ts
// AT24 MCP v1 - the catalog of tools exposed to EXTERNAL MCP clients.
//
// A dedicated, frozen ToolRegistry: it reuses the existing implementations
// (no logic is copied) but is deliberately SEPARATE from the internal
// production registry (registry-manifest.ts), so exposing a tool externally
// is an explicit decision here and never a side effect of an internal agent
// registering one. Internal agents keep using the internal registry directly
// (no MCP hop).

import { ToolRegistry } from "@/services/agent-framework/tools/tool-registry";
import { marketSnapshotTool } from "@/services/agent-framework/tools/impl/market-snapshot.tool";
import { marketIntelligenceTool } from "@/services/agent-framework/tools/impl/market-intelligence.tool";
import { backtestRunTool } from "@/services/agent-framework/tools/impl/backtest-run.tool";
import { newsSearchTool } from "@/services/agent-framework/tools/impl/news-search.tool";
import { economicCalendarTool } from "./tools/economic-calendar.tool";
import { strategyLibrarySearchTool } from "./tools/strategy-library-search.tool";
import { riskCalculatorTool } from "./tools/risk-calculator.tool";
import { createEdgeAnalysisTool } from "./tools/edge-analysis.tool";
import type { EdgeSavedStore } from "@/services/edge-analyzer/saved";

export { MCP_TOOL_MAP, MCP_TOOL_NAMES, isMcpToolName, type McpToolName } from "./mcp-tool-map";

/** @param deps.edgeStore injected in tests; production uses the Prisma-backed store (loaded lazily). */
export function buildMcpRegistry(deps: { edgeStore?: EdgeSavedStore } = {}): ToolRegistry {
  return new ToolRegistry()
    .register(marketSnapshotTool)
    .register(marketIntelligenceTool)
    .register(backtestRunTool)
    .register(newsSearchTool)
    .register(economicCalendarTool)
    .register(strategyLibrarySearchTool)
    .register(riskCalculatorTool)
    .register(createEdgeAnalysisTool({ store: deps.edgeStore }))
    .freeze();
}
