import type { StrategySpec } from "../domain/strategy-spec.js";
import type { StrategyIR } from "../domain/strategy-ir/strategy-ir.js";
/**
 * P3.6 — the deliberately small, single-file, genuinely-importable
 * reference strategy proving the real MQL5 -> IR -> registry ->
 * simulation path end to end. NOT G01 (see
 * docs/ALGO_TESTING_PRO_ROADMAP.md's "Future: G01 Full Import Fidelity"
 * item for why G01's own multi-file, state-machine architecture is
 * explicitly out of scope for this phase — confirmed by direct probe
 * against the real G01 source, not assumed: it produces 34
 * UNRESOLVED_CROSS_FILE_CALL diagnostics and a hollow, always-false
 * entry condition).
 *
 * This strategy IS real, in the sense that matters here: a classic
 * EMA(9)/EMA(21) crossover, inline in OnTick (no wrapping helper
 * function — the ONE provable simple-entry-condition shape this
 * importer's semantic analyzer reconstructs, per
 * test/fixtures/q14-mql-corpus.ts's own established EMA-cross pattern),
 * no #include dependencies, no state machine. Deliberately carries NO
 * stop-loss/take-profit price arguments: an earlier attempt to declare
 * literal SL/TP prices directly on `trade.Buy()`/`trade.Sell()` proved
 * (empirically, not assumed) that the importer does not resolve ANY
 * price argument there — literal or not — into a StopLossRule/
 * TakeProfitRule; a declared-but-unresolved protective exit BLOCKS
 * eligibility entirely (Q0's own "nothing would actually be simulated
 * is refused outright" rule, exercised directly by
 * test/fixtures/q14-mql-corpus.ts's mql5-23 fixture). Omitting SL/TP
 * price arguments (matching every real, ELIGIBLE fixture in that
 * corpus) keeps this strategy honestly within what the importer can
 * actually prove, rather than declaring a risk contract it cannot back.
 *
 * The single source of truth is this string constant, not a separate
 * .mq5 file — a separate file would require this package's vendored
 * `dist/` copy (frontend/vendor/at24-quant-engine, see
 * docs/P3.2A.1-DEPLOYMENT-GATE.md) to also ship raw MQL text alongside
 * its JS/d.ts output, which the existing vendor-sync script does not
 * do. Embedding it here matches the exact convention
 * test/fixtures/q14-mql-corpus.ts already established for MQL fixtures
 * in this codebase.
 */
export declare const REF_EMA_CROSSOVER_SOURCE = "//+------------------------------------------------------------------+\n//| AT24_REF_EMA_CROSSOVER.mq5                                       |\n//| Algotraders24 AI -- P3.6 reference import strategy               |\n//| EA ID: REF01 | Single-file, no #include, no state machine        |\n//| Instrument: XAUUSD | Platform: MetaTrader 5 / MQL5                |\n//| Strategy: EMA(9)/EMA(21) crossover, no declared SL/TP price       |\n//| (see ref-ema-crossover-strategy.ts's own doc comment for why)     |\n//+------------------------------------------------------------------+\n#property copyright \"Algotraders24 AI\"\n#property version   \"1.0.0\"\n#property strict\n#property description \"P3.6 reference strategy: EMA(9)/EMA(21) crossover - proves MQL5 import -> IR -> registry -> simulation.\"\n\n#include <Trade\\Trade.mqh>\nCTrade trade;\n\ninput double InpLotSize = 0.10;\n\ndatetime g_lastTime = 0;\n\nint OnInit()\n{\n   return(INIT_SUCCEEDED);\n}\n\nvoid OnDeinit(const int reason)\n{\n}\n\nvoid OnTick()\n{\n   if(Time[0] != g_lastTime)\n   {\n      g_lastTime = Time[0];\n      double fast = iMA(_Symbol,PERIOD_M5,9,0,MODE_EMA,PRICE_CLOSE,0);\n      double slow = iMA(_Symbol,PERIOD_M5,21,0,MODE_EMA,PRICE_CLOSE,0);\n      if(fast>slow)\n      {\n         trade.Buy(InpLotSize,_Symbol,0.0,0.0,0.0,\"ref-ema-cross\");\n      }\n      if(fast<slow)\n      {\n         trade.Sell(InpLotSize,_Symbol,0.0,0.0,0.0,\"ref-ema-cross\");\n      }\n   }\n}\n";
export declare const REF_EMA_CROSSOVER_STRATEGY_ID = "ref-ema-crossover";
export declare const REF_EMA_CROSSOVER_VERSION = "1.0.0";
export declare const REF_EMA_CROSSOVER_SOURCE_FILE_NAME = "AT24_REF_EMA_CROSSOVER.mq5";
export declare const REF_EMA_CROSSOVER_DIALECT: "MQL5";
/** Deterministic (Q0.8.50/51) — the same function Q0.8's own import pipeline uses, exported here so a registry entry can record it as reproducibility metadata without recomputing it a second way. */
export declare const REF_EMA_CROSSOVER_SOURCE_HASH: string;
/** The real, imported Universal Strategy IR — kept for introspection/evidence (P3.8's future validation/evidence-gate work), not just discarded after reduction. */
export declare const REF_EMA_CROSSOVER_IR: StrategyIR;
/** The reduced, directly-executable StrategySpec — computed once at module load (the import pipeline is pure/deterministic, Q0.8.50/51), never re-imported per call. */
export declare const REF_EMA_CROSSOVER_SPEC: StrategySpec;
/**
 * This strategy declares zero exposed Strategy Parameters (see
 * strategy-registry.ts's own entry for it) — `InpLotSize` is category #2
 * (execution/risk configuration, P3.4's own taxonomy), and no category-#1
 * signal parameter exists in this source, matching exactly how P3.4
 * classified Golden Strategy's own non-`priceThreshold` inputs. `overrides`
 * is accepted for interface parity with buildGoldenStrategySpec() (the
 * generic registry contract calls every strategy's build function the
 * same way — see strategy-registry.ts's `buildSpec`), but is intentionally
 * unused: there is nothing here to override.
 */
export declare function buildRefEmaCrossoverSpec(): StrategySpec;
