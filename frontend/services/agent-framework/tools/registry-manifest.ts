// services/agent-framework/tools/registry-manifest.ts
// AT24 Agent Framework - A2. The single place the production Tool Registry
// is assembled and frozen.
//
// LOCKED (AN1.4): ONLY tools with a real, callable server-side
// implementation behind an existing AT24 service are registered here.
// ADAPTER_REQUIRED / BLOCKED / NOT_AVAILABLE capabilities are NOT registered
// (see docs/architecture/AN1.4-tool-registry-capability-audit.md) - they are
// added when their consuming agent (A11-A13) is built, with the adapter.

import { ToolRegistry } from "./tool-registry";
import { marketSnapshotTool } from "./impl/market-snapshot.tool";
import { marketIntelligenceTool } from "./impl/market-intelligence.tool";
import { backtestRunTool } from "./impl/backtest-run.tool";
import { portfolioReadTool } from "./impl/portfolio-read.tool";

/** Build a fresh, frozen registry containing exactly the A2 READY tools.
 *  Callable in a test/harness without side effects. */
export function buildToolRegistry(): ToolRegistry {
  return new ToolRegistry()
    .register(marketSnapshotTool)
    .register(marketIntelligenceTool)
    .register(backtestRunTool)
    .register(portfolioReadTool)
    .freeze();
}

/** The process-wide production registry. */
export const toolRegistry = buildToolRegistry();

/** The ids A2 ships, for tests / docs. */
export const A2_TOOL_IDS = ["backtest.run", "market.intelligence", "market.snapshot", "portfolio.read"] as const;
