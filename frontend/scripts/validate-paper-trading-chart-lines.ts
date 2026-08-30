// scripts/validate-paper-trading-chart-lines.ts
// Paper Trading, post-completion phase - MT5's real "Show Ask price line"
// (metatrader5.com's own help docs: Bid line always shown by default, Ask
// line a real Properties > Show toggle) plus MT5's own real "click the
// bid/ask price to open a position" One Click Trading interaction. This
// suite covers the pure rendering (renderer.ts's drawTradeLines(),
// canvas-colors.ts's buyLine/sellLine) and, via structural source-text
// checks (this codebase's own established convention for React/DOM-event
// wiring that a Node script can't otherwise exercise), the click-to-quick-
// trade wiring between NativeChart.tsx and PaperTradingPanel.tsx's
// forwardRef/useImperativeHandle surface.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderChart } from "../lib/chart-engine/renderer";
import { resolveChartColors, type ChartTheme } from "../lib/chart-engine/canvas-colors";
import { priceToY } from "../lib/chart-engine/coordinate-system";
import { fitToData } from "../lib/chart-engine/viewport";
import type { ChartCandle } from "../types/chart-data";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
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

function makeCandleSeries(count: number, stepMs: number, base = 100): ChartCandle[] {
  const start = Date.now() - count * stepMs;
  const out: ChartCandle[] = [];
  for (let i = 0; i < count; i++) {
    const o = base + Math.sin(i / 4) * 3;
    const c = o + (i % 3 === 0 ? -1 : 1) * 0.5;
    const h = Math.max(o, c) + 0.8;
    const l = Math.min(o, c) - 0.8;
    out.push({ time: start + i * stepMs, open: o, high: h, low: l, close: c, volume: 500 });
  }
  return out;
}

interface FillRectCall {
  x: number;
  y: number;
  w: number;
  h: number;
}

function recordingCtx(): { ctx: CanvasRenderingContext2D; fillRects: FillRectCall[]; fillTexts: string[]; strokeStyles: string[] } {
  const fillRects: FillRectCall[] = [];
  const fillTexts: string[] = [];
  const strokeStyles: string[] = [];
  const ctx = {
    clearRect: () => {},
    fillRect: (x: number, y: number, w: number, h: number) => {
      fillRects.push({ x, y, w, h });
    },
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => {},
    fillText: (text: string) => {
      fillTexts.push(text);
    },
    setLineDash: () => {},
    set fillStyle(_v: string) {},
    set strokeStyle(v: string) {
      strokeStyles.push(v);
    },
    set lineWidth(_v: number) {},
    set font(_v: string) {},
    set textAlign(_v: string) {},
    set textBaseline(_v: string) {},
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, fillRects, fillTexts, strokeStyles };
}

function renderWith(overrides: Partial<Parameters<typeof renderChart>[0]>): { fillTexts: string[]; strokeStyles: string[]; fillRects: FillRectCall[]; viewport: ReturnType<typeof fitToData>; priceRowHeight: number } {
  const candles = makeCandleSeries(60, 60_000);
  const viewport = fitToData(candles);
  const { ctx, fillTexts, strokeStyles, fillRects } = recordingCtx();
  const dims = { width: 800, height: 400, priceAxisWidth: 60, timeAxisHeight: 24 };
  renderChart({
    ctx,
    dims,
    candles,
    viewport,
    timeframe: "1h",
    colors: resolveChartColors("at24"),
    ...overrides,
  });
  return { fillTexts, strokeStyles, fillRects, viewport, priceRowHeight: dims.height - dims.timeAxisHeight };
}

function colorTests(): void {
  const themes: ChartTheme[] = ["at24", "mt5", "mt5-green"];
  for (const theme of themes) {
    test(`1 (${theme}): resolveChartColors provides real, distinct buyLine/sellLine - never undefined, never the same value`, () => {
      const colors = resolveChartColors(theme);
      assert.ok(colors.buyLine && typeof colors.buyLine === "string");
      assert.ok(colors.sellLine && typeof colors.sellLine === "string");
      assert.notEqual(colors.buyLine, colors.sellLine);
    });
  }

  test("2: buyLine/sellLine are the SAME real green/red across every theme (matches PaperTradingPanel.tsx's own text-signal-up/text-signal-down P&L colors) - never drifting per candle-body theme, unlike bullish/bearish", () => {
    const at24 = resolveChartColors("at24");
    const mt5 = resolveChartColors("mt5");
    const mt5Green = resolveChartColors("mt5-green");
    assert.equal(at24.buyLine, mt5.buyLine);
    assert.equal(mt5.buyLine, mt5Green.buyLine);
    assert.equal(at24.sellLine, mt5.sellLine);
    assert.equal(mt5.sellLine, mt5Green.sellLine);
  });
}

function rendererTests(): void {
  test("3: showTradeLines defaults to false - every existing renderChart() caller/test renders with zero BUY/SELL tags, byte-for-byte unchanged", () => {
    const { fillTexts } = renderWith({ liveQuote: { bid: 100, ask: 100.05 } });
    assert.ok(!fillTexts.includes("BUY"));
    assert.ok(!fillTexts.includes("SELL"));
  });

  test("4: showTradeLines=true with no liveQuote draws no trade lines either - never a fabricated bid/ask when the real quote hasn't loaded yet", () => {
    const { fillTexts } = renderWith({ showTradeLines: true, liveQuote: null });
    assert.ok(!fillTexts.includes("BUY"));
    assert.ok(!fillTexts.includes("SELL"));
  });

  test("5: showTradeLines=true with a real liveQuote draws both BUY and SELL tags", () => {
    const { fillTexts } = renderWith({ showTradeLines: true, liveQuote: { bid: 100, ask: 100.05 } });
    assert.ok(fillTexts.includes("BUY"));
    assert.ok(fillTexts.includes("SELL"));
  });

  test("6: the BUY tag is drawn at exactly priceToY(liveQuote.ask, ...) - the SAME formula NativeChart.tsx's own click hit-test uses, so a click can never land on a pixel the line wasn't actually drawn at", () => {
    const liveQuote = { bid: 100, ask: 100.05 };
    const { fillRects, viewport, priceRowHeight } = renderWith({ showTradeLines: true, liveQuote });
    const expectedAskY = priceToY(liveQuote.ask, viewport, priceRowHeight);
    const tagRect = fillRects.find((r) => Math.abs(r.y + 7 - expectedAskY) < 0.01 && r.x === 4);
    assert.ok(tagRect, "expected a tag fillRect at the exact real ask y-coordinate");
  });

  test("7: the SELL tag is drawn at exactly priceToY(liveQuote.bid, ...)", () => {
    const liveQuote = { bid: 100, ask: 100.05 };
    const { fillRects, viewport, priceRowHeight } = renderWith({ showTradeLines: true, liveQuote });
    const expectedBidY = priceToY(liveQuote.bid, viewport, priceRowHeight);
    const tagRect = fillRects.find((r) => Math.abs(r.y + 7 - expectedBidY) < 0.01 && r.x === 4);
    assert.ok(tagRect, "expected a tag fillRect at the exact real bid y-coordinate");
  });

  test("8: a degenerate zero-spread quote (bid === ask) draws only ONE tag, never two overlapping ones", () => {
    const { fillTexts } = renderWith({ showTradeLines: true, liveQuote: { bid: 100, ask: 100 } });
    const total = fillTexts.filter((t) => t === "BUY" || t === "SELL").length;
    assert.equal(total, 1);
  });
}

function wiringTests(): void {
  test("9: NativeChart.tsx's pointer-down handler hit-tests the ask/bid lines using the exact same priceToY(liveQuote.ask/.bid, viewport, row.height) formula renderer.ts's drawTradeLines() draws them at - the click target and the visible line can never drift apart", () => {
    const src = read("components/chart-engine/NativeChart.tsx");
    assert.ok(src.includes("priceToY(liveQuote.ask, viewport, row.height)"));
    assert.ok(src.includes("priceToY(liveQuote.bid, viewport, row.height)"));
  });

  test("10: a click on the ask line calls paperTradingRef.current?.quickTrade('buy'); a click on the bid line calls quickTrade('sell') - never swapped", () => {
    const src = read("components/chart-engine/NativeChart.tsx");
    const askIdx = src.indexOf("Math.abs(y - askY)");
    const bidIdx = src.indexOf("Math.abs(y - bidY)");
    assert.ok(askIdx > -1 && bidIdx > -1 && askIdx < bidIdx);
    const askBlock = src.slice(askIdx, bidIdx);
    const bidBlock = src.slice(bidIdx, bidIdx + 200);
    assert.ok(/quickTrade\("buy"\)/.test(askBlock), "the ask-line branch must call quickTrade('buy')");
    assert.ok(/quickTrade\("sell"\)/.test(bidBlock), "the bid-line branch must call quickTrade('sell')");
  });

  test("11: the trade-line click hit-test is gated on symbol === activeSymbol - a non-active tiled pane's clicks never quietly control a different pane's account", () => {
    const src = read("components/chart-engine/NativeChart.tsx");
    const idx = src.indexOf("paperTradingRef.current?.quickTrade");
    // Widened from 400: the e.preventDefault() comment (explaining why a
    // canvas with tabIndex=0 needs it to stop its native pointerdown
    // focus-default from stealing focus back from quickTrade()'s own
    // quantityInputRef.focus() call) pushed the real distance to the
    // symbol check further back - 900 comfortably covers it.
    const before = src.slice(Math.max(0, idx - 900), idx);
    assert.ok(/symbol === activeSymbol/.test(before));
  });

  test("12: PaperTradingPanel.tsx exposes a real forwardRef + useImperativeHandle 'quickTrade' surface - never a second, disconnected order-entry code path from the chart click", () => {
    const src = read("components/chart-engine/PaperTradingPanel.tsx");
    assert.ok(src.includes("forwardRef<PaperTradingPanelHandle, PaperTradingPanelProps>"));
    assert.ok(src.includes("useImperativeHandle("));
    assert.ok(src.includes("quickTrade: (clickedSide: PaperPositionSide) => {"));
  });

  test("13: a quick-trade with a real, already-typed quantity opens the SAME confirm modal 'Place Order' uses - never a second, unconfirmed instant-fill path", () => {
    const src = read("components/chart-engine/PaperTradingPanel.tsx");
    const idx = src.indexOf("quickTrade: (clickedSide");
    const block = src.slice(idx, idx + 400);
    assert.ok(block.includes("setConfirmOpen(true)"));
  });

  test("14: NativeChart.tsx passes showTradeLines only for the pane whose PaperTradingPanel is active (symbol === activeSymbol) - a non-active tiled pane never shows clickable-looking lines it can't actually act on", () => {
    const src = read("components/chart-engine/NativeChart.tsx");
    assert.ok(src.includes("showTradeLines: symbol === activeSymbol,"));
  });
}

async function main(): Promise<void> {
  console.log("=== Colors (canvas-colors.ts) ===");
  colorTests();
  console.log("\n=== Renderer (renderer.ts's drawTradeLines) ===");
  rendererTests();
  console.log("\n=== Chart-click -> Paper Trading wiring ===");
  wiringTests();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
