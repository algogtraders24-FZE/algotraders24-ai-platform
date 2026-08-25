// scripts/validate-native-chart-tiling.ts
// Sprint D2.7.11 Phase 3 - multi-symbol TILED layout (real, simultaneously-
// visible charts in a grid, not just tabs). Native-engine only; AdvancedChart
// stays a single, non-tiled instance always following WorkspaceContext's
// own symbol. See ChartPanel.tsx's own header comment for the full design:
// - `panes` always has exactly `layout` (1/2/4) entries, front-truncated on
//   shrink, grown from the primary pane's symbol on grow.
// - Exactly one pane is "primary", bidirectionally synced with
//   WorkspaceContext.symbol; every other pane owns a fully independent
//   symbol/timeframe/indicator set.
// - NativeChart takes `symbol`/`name` as controlled props now (previously
//   read from WorkspaceContext directly) - see validate-native-chart-
//   verification.ts for the "this must not silently regress to a context
//   read" wiring tests already covering that specific change; this file
//   covers the NEW pane-management/layout/session-persistence pieces that
//   have no other home.
//
// No component-rendering framework exists in this codebase - matches the
// established "read source, assert control-flow snippets present"
// convention (see validate-native-chart-interaction.ts's own
// nativeChartSrc() helper) for the React wiring, plus real behavioral
// tests against chart-session-state.ts's actually-exported pure functions.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`  ok - ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL - ${name}`);
    console.error(err instanceof Error ? `    ${err.message}` : `    ${String(err)}`);
  }
}

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const panelSrc = () => read("components/chart-engine/ChartPanel.tsx");
const paneSrc = () => read("components/chart-engine/ChartPane.tsx");
const nativeChartSrc = () => read("components/chart-engine/NativeChart.tsx");

async function main(): Promise<void> {
  console.log("=== Layout (ChartPanel.tsx) ===");

  await test("the layout selector offers exactly 1, 2, and 4 panes - MT5's own common tiling presets, never an invented set, and never a full drag/resize window manager (explicitly out of scope)", () => {
    const src = panelSrc();
    assert.ok(/LAYOUTS.*=.*\[1,\s*2,\s*4\]/.test(src));
  });

  await test("the layout selector only renders when the Native engine is active - tiling is a native-chart-only feature, AdvancedChart (TradingView) stays a single, untouched, non-tiled instance", () => {
    const src = panelSrc();
    const layoutBlock = src.slice(src.indexOf('aria-label="Chart layout"') - 60, src.indexOf('aria-label="Chart layout"') + 40);
    assert.ok(layoutBlock.includes('provider === "native"'));
  });

  await test("AdvancedChart itself was not touched by this phase - it still takes zero props and reads everything from WorkspaceContext, exactly as before Phase 3", () => {
    const src = read("components/workspace/tradingview/AdvancedChart.tsx");
    assert.ok(src.includes("useWorkspace()"));
  });

  await test("growing the layout (setLayout) creates new panes seeded from the PRIMARY pane's current symbol, never an arbitrary/hardcoded default - a new pane should show 'another view of what I'm already looking at', not a surprise instrument", () => {
    const src = panelSrc();
    const fnBlock = src.slice(src.indexOf("function setLayout"), src.indexOf("function setLayout") + 500);
    assert.ok(fnBlock.includes("prev.find((p) => p.id === primaryPaneId)?.symbol"));
    assert.ok(fnBlock.includes("makePane(templateSymbol)"));
  });

  await test("shrinking the layout front-truncates the panes array (prev.slice(0, next)) - the simple, honest 'these panes are gone' model, never a hidden 4-pane buffer silently kept in memory", () => {
    const src = panelSrc();
    const fnBlock = src.slice(src.indexOf("function setLayout"), src.indexOf("function setLayout") + 500);
    assert.ok(fnBlock.includes("prev.slice(0, next)"));
  });

  console.log("\n=== Primary pane <-> WorkspaceContext sync ===");

  await test("the primary pane's symbol is kept in sync FROM WorkspaceContext.symbol via a dedicated effect - the one direction of the bidirectional sync that doesn't go through an explicit user action", () => {
    const src = panelSrc();
    assert.ok(/p\.id === primaryPaneId && p\.symbol !== contextSymbol/.test(src));
  });

  await test("changing the PRIMARY pane's own symbol calls setContextSymbol (bubbles to WorkspaceContext) rather than only updating local pane state - so the rest of the workspace (header/AI Intelligence/Assistant/Research) follows the primary pane, exactly like the single-chart behavior before this phase", () => {
    const src = panelSrc();
    const fnBlock = src.slice(src.indexOf("function setPaneSymbol"), src.indexOf("function setPaneSymbol") + 300);
    assert.ok(fnBlock.includes("if (id === primaryPaneId) setContextSymbol(symbol);"));
  });

  await test("changing a NON-primary pane's symbol updates ONLY that pane's own local state - it must never call setContextSymbol (that would silently drag the rest of the workspace onto a symbol the user only wanted in one extra pane)", () => {
    const src = panelSrc();
    const fnBlock = src.slice(src.indexOf("function setPaneSymbol"), src.indexOf("function setPaneSymbol") + 300);
    assert.ok(fnBlock.includes("else updatePane(id, (p) => ({ ...p, symbol }));"));
  });

  await test("promoting a different pane to primary (setPrimary) pushes THAT pane's symbol into WorkspaceContext - never the reverse (a stale context value overwriting the newly-promoted pane)", () => {
    const src = panelSrc();
    const fnBlock = src.slice(src.indexOf("function setPrimary"), src.indexOf("function setPrimary") + 300);
    assert.ok(fnBlock.includes("setContextSymbol(pane.symbol);"));
    assert.ok(fnBlock.includes("setPrimaryPaneId(id);"));
  });

  await test("if a layout shrink removes the pane that was primary, primary falls back to the first remaining pane - never left pointing at a pane id that no longer exists in the array", () => {
    const src = panelSrc();
    assert.ok(/!panes\.some\(\(p\) => p\.id === primaryPaneId\)/.test(src));
  });

  console.log("\n=== hypothesisType guard (NativeChart.tsx) ===");

  await test("hypothesisType is only forwarded to MicrostructurePanel when THIS pane's own symbol matches WorkspaceContext's active symbol - WorkspaceResearch only ever computed a hypothesis for ONE symbol at a time, so a pane showing a DIFFERENT instrument must not receive it", () => {
    const src = nativeChartSrc();
    assert.ok(src.includes("hypothesisType={symbol === activeSymbol ? hypothesisType : undefined}"));
  });

  await test("NativeChart still reads hypothesisType from WorkspaceContext (that relay itself is untouched - only its per-pane applicability changed), renamed to activeSymbol specifically so it can never be confused with the component's OWN `symbol` prop", () => {
    const src = nativeChartSrc();
    assert.ok(/const \{ symbol: activeSymbol, hypothesisType \} = useWorkspace\(\);/.test(src));
  });

  console.log("\n=== ChartPane.tsx ===");

  await test("the per-pane header (independent instrument search + primary toggle) only renders when there's more than one visible pane - with a single pane, NativeChart's own ChartHeader/ChartToolbar already show the symbol, so a second search box would be redundant clutter", () => {
    const src = paneSrc();
    assert.ok(src.includes("{showControls && ("));
  });

  await test("ChartPane reuses InstrumentSearchBox (the same real search/discovery/keyboard-nav GlobalSymbolSelector uses) for a pane's own symbol control - never a second, drifting search implementation", () => {
    const src = paneSrc();
    assert.ok(src.includes('import InstrumentSearchBox from "@/components/workspace/InstrumentSearchBox";'));
    assert.ok(src.includes("<InstrumentSearchBox"));
  });

  await test("ChartPane derives the instrument's display name via the real market registry (getMarket), never a hardcoded or guessed name", () => {
    const src = paneSrc();
    assert.ok(src.includes("getMarket(pane.symbol)?.name"));
  });

  console.log("\n=== InstrumentSearchBox extraction (GlobalSymbolSelector.tsx) ===");

  await test("GlobalSymbolSelector is now a thin wrapper around InstrumentSearchBox wired to WorkspaceContext - the actual search/debounce/keyboard-nav/discovery logic lives in exactly one place, never duplicated for the new per-pane use", () => {
    const src = read("components/workspace/GlobalSymbolSelector.tsx");
    assert.ok(src.includes('import InstrumentSearchBox from "./InstrumentSearchBox";'));
    assert.ok(src.includes("<InstrumentSearchBox value={symbol} onChange={setSymbol} />"));
    assert.ok(!src.includes("/api/private/instruments/search"), "the actual fetch call must live only in InstrumentSearchBox now, not duplicated here");
  });

  await test("InstrumentSearchBox itself has zero WorkspaceContext coupling - it's a fully generic, controlled value/onChange component, reusable by any caller (global selector today, per-pane search since this phase)", () => {
    const src = read("components/workspace/InstrumentSearchBox.tsx");
    assert.ok(!src.includes("useWorkspace"));
    assert.ok(src.includes("value: string;") && src.includes("onChange: (symbol: string) => void;"));
  });

  console.log("\n=== Session persistence (ChartPanel.tsx <-> chart-session-state.ts) ===");

  await test("ChartPanel persists provider/layout/panes/primaryPaneIndex together, gated by the same hydratedRef guard the pre-Phase-3 flat shape already used - never overwriting a not-yet-restored saved value with the still-default initial state", () => {
    const src = panelSrc();
    assert.ok(src.includes("if (!hydratedRef.current) return;"));
    const writeCall = src.slice(src.indexOf("writeChartWorkspaceLayout({"), src.indexOf("writeChartWorkspaceLayout({") + 250);
    assert.ok(writeCall.includes("provider,") && writeCall.includes("layout,") && writeCall.includes("panes:") && writeCall.includes("primaryPaneIndex"));
  });

  await test("session persistence was DELIBERATELY session-scoped-only at Phase 3 ship time (avoiding bundling two separate scope decisions into one already-large phase) and has since been promoted to a real durable per-user database table (ChartWorkspaceLayout) as its own dedicated follow-up - mirrors exactly the Phase 1 -> 1b precedent for drawn-object persistence", () => {
    const sessionSrc = read("lib/chart-engine/chart-session-state.ts");
    assert.ok(!sessionSrc.includes("window.sessionStorage"), "chart-session-state.ts itself is now pure types+sanitizers, no I/O");
    const serviceSrc = read("services/chart/chart-workspace-layout.service.ts");
    assert.ok(/prisma|PrismaClient/i.test(serviceSrc), "the durable tier genuinely persists via Prisma, not a re-labeled sessionStorage call");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
