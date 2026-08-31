import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { importMQLSource } from "../src/runtime/mql-importer/mql-importer.js";
import { compareParity } from "../src/runtime/strategy-ir/parity-engine.js";
import { computeCrossPlatformSemanticHash } from "../src/runtime/strategy-ir/ir-hash.js";
import { validateStrategyIR } from "../src/runtime/strategy-ir/ir-validator.js";
import { baseOptions } from "./fixtures/mql-fixtures.js";
import type { StrategyIR } from "../src/domain/strategy-ir/strategy-ir.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MQL4_BUY_SOURCE = `
  input double InpRiskPercent = 1.0;
  void start()
    {
     int ticket = OrderSend(_Symbol,OP_BUY,0.1,Ask,3,sl,tp,"c",1,0,clrBlue);
    }
`;

const MQL5_BUY_SOURCE = `
  input double InpRiskPercent = 1.0;
  CTrade g_trade;
  void OnTick()
    {
     bool sent = g_trade.Buy(0.1,_Symbol,0.0,sl,tp,"c");
    }
`;

test("Q0.8.48/49: equivalent MQL4 (OrderSend/OP_BUY) and MQL5 (CTrade.Buy) BUY-market-with-SL/TP sources produce the IDENTICAL cross-platform semantic hash", () => {
  const mql4 = importMQLSource({ sourceText: MQL4_BUY_SOURCE, fileName: "buy.mq4", options: baseOptions({ strategyId: "buy-mql4" }), forcedDialect: "MQL4" });
  const mql5 = importMQLSource({ sourceText: MQL5_BUY_SOURCE, fileName: "buy.mq5", options: baseOptions({ strategyId: "buy-mql5" }), forcedDialect: "MQL5" });

  assert.equal(mql4.ir.sourcePlatform, "MT4_MQL4");
  assert.equal(mql5.ir.sourcePlatform, "MT5_MQL5");
  assert.notEqual(mql4.ir.sourcePlatform, mql5.ir.sourcePlatform);

  // Platform identity differs, so the CANONICAL (full-identity) hash must differ...
  const canonicalHashesDiffer = mql4.ir.provenance.sourceHash !== mql5.ir.provenance.sourceHash;
  assert.ok(canonicalHashesDiffer);

  // ...but the semantic hash (Q0.8.49 — platform-specific metadata excluded) must match, since both describe the same BUY/0.1-lot/SL/TP/1%-risk strategy.
  assert.equal(computeCrossPlatformSemanticHash(mql4.ir), computeCrossPlatformSemanticHash(mql5.ir));
});

test("Q0.8.48: a genuine semantic difference (BUY vs SELL) between two platforms' sources is NOT masked by the semantic hash", () => {
  const mql4Buy = importMQLSource({ sourceText: MQL4_BUY_SOURCE, fileName: "buy.mq4", options: baseOptions(), forcedDialect: "MQL4" });
  const mql5SellSource = MQL5_BUY_SOURCE.replace("g_trade.Buy", "g_trade.Sell");
  const mql5Sell = importMQLSource({ sourceText: mql5SellSource, fileName: "sell.mq5", options: baseOptions(), forcedDialect: "MQL5" });
  assert.notEqual(computeCrossPlatformSemanticHash(mql4Buy.ir), computeCrossPlatformSemanticHash(mql5Sell.ir));
});

test("Q0.8.46: compareParity() between the two equivalent MQL4/MQL5 sources reports EXACT semantic agreement on entries/risk, differing only in platform-identifying fields", () => {
  const mql4 = importMQLSource({ sourceText: MQL4_BUY_SOURCE, fileName: "buy.mq4", options: baseOptions(), forcedDialect: "MQL4" });
  const mql5 = importMQLSource({ sourceText: MQL5_BUY_SOURCE, fileName: "buy.mq5", options: baseOptions(), forcedDialect: "MQL5" });
  const report = compareParity(mql4.ir, mql5.ir);
  assert.equal(report.identical, false); // full IR hash differs (platform identity)
  const entriesDiff = report.differences.find((d) => d.feature === "entries");
  const riskDiff = report.differences.find((d) => d.feature === "risk");
  assert.equal(entriesDiff, undefined, "entries must be semantically identical between the two platforms");
  assert.equal(riskDiff, undefined, "risk must be semantically identical between the two platforms");
});

// --- Q0.8.46: hand-built vs imported G01 StrategyIR parity ---

const G01_PATH = path.resolve(__dirname, "../../ea-research/G01_LiquiditySweep_MSS_FVG/AT24_GOLD_G01_LiquiditySweep_MSS_FVG.mq5");

/**
 * A HAND-BUILT G01 IR, representing what a careful human analyst reading
 * the same source would record — deliberately similar to (not better
 * than) the automated import's honesty about the unrepresentable state
 * machine, since that gap is a genuine limitation of Q0.7's IR itself,
 * not a parser shortfall. It differs in ONE deliberate, documented way
 * (a human recognizes the account is a fresh MT5 default -> NETTING with
 * higher confidence, expressed as APPROXIMATED rather than the
 * importer's own WARNING-only note) so the parity comparison below has
 * something real to classify.
 */
function buildHandBuiltG01IR(sourceHash: string): StrategyIR {
  const placeholderCondition = { type: "comparison" as const, operator: "==" as const, left: { kind: "literal" as const, value: 1 }, right: { kind: "literal" as const, value: 0 } };
  return {
    strategyId: "g01-hand-built",
    strategyVersion: "1.10.0",
    sourcePlatform: "MT5_MQL5",
    sourceLanguage: "MQL5",
    sourceVersion: "5",
    sourceHash,
    irVersion: "0.1.0",
    metadata: { name: "G01 Liquidity Sweep MSS FVG (hand-built)", createdAt: 0 },
    instruments: [{ symbol: "XAUUSD", assetClass: "metal" }],
    timeframes: ["M5", "M15"],
    timeframeSeries: [
      { timeframe: "M5", role: "EXECUTION", availabilityPolicy: "HTF_CLOSE_AVAILABLE", alignmentPolicy: "CLOSE_ALIGNED" },
      { timeframe: "M15", role: "HIGHER", availabilityPolicy: "HTF_CLOSE_AVAILABLE", alignmentPolicy: "CLOSE_ALIGNED" },
    ],
    parameters: [],
    indicators: [],
    conditions: [],
    entries: [
      { id: "entry-buy", direction: "BUY", condition: placeholderCondition, sizingModel: { method: "percent-equity-risk", percent: 0.5 }, timing: "INTRABAR", executionType: "MARKET" },
      { id: "entry-sell", direction: "SELL", condition: placeholderCondition, sizingModel: { method: "percent-equity-risk", percent: 0.5 }, timing: "INTRABAR", executionType: "MARKET" },
    ],
    exits: [
      { id: "exit-sl", kind: "STOP_LOSS" },
      { id: "exit-tp", kind: "TAKE_PROFIT" },
    ],
    positionManagement: {
      accountingMode: "NETTING",
      pyramiding: { allowPyramiding: false, sameDirectionBehavior: "REJECT", oppositeDirectionBehavior: "REJECT" },
      reversal: { buyToSell: "PLATFORM_DEFINED", sellToBuy: "PLATFORM_DEFINED", platformDefaultDescription: "fresh MT5 accounts default to netting mode; not independently verified against the actual deployed account" },
    },
    timezone: { strategyTimezone: "UNSPECIFIED_BROKER_SERVER_TIME" },
    repaintingModel: "REALTIME_DEPENDENT",
    realtimeHistoricalAsymmetry: { historicalVsRealtimeDiffers: true, barCloseVsIntrabarDiffers: true, note: "entry trigger reads live bid/ask every tick, independent of bar-close state-machine progression" },
    barCloseSemantics: "INTRABAR",
    priceSource: "CUSTOM",
    slTpReference: "ATR_DERIVED",
    risk: { sizing: { method: "percent-equity-risk", percent: 0.5 } },
    execution: { declared: { fillModel: "intrabar-touch", costsExplicitlyZero: true }, platformDefaultsUsed: ["MQL5 CTrade market order execution (immediate, broker-determined fill); spread/slippage not modeled in source"] },
    dependencies: { symbols: [], timeframes: ["M15"] },
    provenance: {
      sourcePlatform: "MT5_MQL5",
      sourceHash,
      sourceVersion: "5",
      irVersion: "0.1.0",
      translationHash: sourceHash,
      semanticStatus: "APPROXIMATED",
      unsupportedSemantics: [
        { feature: "entry/exit signal logic", reason: "multi-bar state machine spanning several #include modules, not a single Expression tree", severity: "BLOCKING", executionImpact: "entries[].condition is a placeholder" },
        { feature: "stop-loss / take-profit values", reason: "SL/TP computed by unresolved cross-file functions", severity: "BLOCKING", executionImpact: "risk.stopLoss/takeProfit left unset" },
      ],
      approximations: [
        { feature: "position accounting mode", original: "not declared in source", replacement: "NETTING", difference: "assumed from MT5's fresh-account default, not verified", impact: "wrong if the deployed account was explicitly switched to hedging mode" },
        { feature: "position sizing method", original: 'input "InpRiskPercent"', replacement: 'PositionSizingMethod { method: "percent-equity-risk", percent: 0.5 }', difference: "actual lot-size formula unresolved", impact: "simulated size may differ from the real EA's" },
      ],
    },
  };
}

test("Q0.8.46: hand-built vs. imported G01 StrategyIR agree on every core structural dimension (instruments, timeframes, entries, exits, risk sizing method)", () => {
  const sourceText = fs.readFileSync(G01_PATH, "utf8");
  const { ir: imported, document } = importMQLSource({
    sourceText,
    fileName: "AT24_GOLD_G01_LiquiditySweep_MSS_FVG.mq5",
    options: { strategyId: "g01-imported", strategyVersion: "1.10.0", instrument: { symbol: "XAUUSD", assetClass: "metal" }, executionTimeframe: "M5", importedAt: 0 },
  });
  const handBuilt = buildHandBuiltG01IR(document.sourceHash);

  const report = compareParity(handBuilt, imported);

  assert.deepEqual(handBuilt.instruments, imported.instruments);
  assert.deepEqual([...handBuilt.timeframes].sort(), [...imported.timeframes].sort());
  assert.equal(handBuilt.entries.length, imported.entries.length);
  assert.equal(handBuilt.exits.length, imported.exits.length);
  assert.equal(handBuilt.risk.sizing.method, imported.risk.sizing.method);
  assert.equal(handBuilt.repaintingModel, imported.repaintingModel);

  // The ONE deliberate difference: hand-built claims APPROXIMATED (with an
  // explicit accounting-mode approximation record); the automated importer
  // stays at UNSUPPORTED and merely WARNS about accounting mode. This
  // difference is explicitly surfaced by the comparator, never hidden.
  assert.notEqual(handBuilt.provenance.semanticStatus, imported.provenance.semanticStatus);

  // Both are honestly execution-INELIGIBLE — this is the whole point: the state-machine gap is real, not a parser artifact.
  assert.equal(validateStrategyIR(handBuilt).executionEligible, false);
  assert.equal(validateStrategyIR(imported).executionEligible, false);

  assert.ok(report.differences.length > 0, "the deliberate provenance/approximation difference must be reported, never silently absorbed");
});
