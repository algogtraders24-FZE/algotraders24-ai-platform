import { validateStrategyIRStructure } from "../domain/strategy-ir/strategy-ir.js";
import { importMQLSource, computeSourceHash } from "../runtime/mql-importer/mql-importer.js";
import { checkReductionEligibility } from "../runtime/reduction/eligibility-gate.js";
import { reduceStrategyIRToSpec } from "../runtime/reduction/ir-to-spec-reducer.js";
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
export const REF_EMA_CROSSOVER_SOURCE = `//+------------------------------------------------------------------+
//| AT24_REF_EMA_CROSSOVER.mq5                                       |
//| Algotraders24 AI -- P3.6 reference import strategy               |
//| EA ID: REF01 | Single-file, no #include, no state machine        |
//| Instrument: XAUUSD | Platform: MetaTrader 5 / MQL5                |
//| Strategy: EMA(9)/EMA(21) crossover, no declared SL/TP price       |
//| (see ref-ema-crossover-strategy.ts's own doc comment for why)     |
//+------------------------------------------------------------------+
#property copyright "Algotraders24 AI"
#property version   "1.0.0"
#property strict
#property description "P3.6 reference strategy: EMA(9)/EMA(21) crossover - proves MQL5 import -> IR -> registry -> simulation."

#include <Trade\\Trade.mqh>
CTrade trade;

input double InpLotSize = 0.10;

datetime g_lastTime = 0;

int OnInit()
{
   return(INIT_SUCCEEDED);
}

void OnDeinit(const int reason)
{
}

void OnTick()
{
   if(Time[0] != g_lastTime)
   {
      g_lastTime = Time[0];
      double fast = iMA(_Symbol,PERIOD_M5,9,0,MODE_EMA,PRICE_CLOSE,0);
      double slow = iMA(_Symbol,PERIOD_M5,21,0,MODE_EMA,PRICE_CLOSE,0);
      if(fast>slow)
      {
         trade.Buy(InpLotSize,_Symbol,0.0,0.0,0.0,"ref-ema-cross");
      }
      if(fast<slow)
      {
         trade.Sell(InpLotSize,_Symbol,0.0,0.0,0.0,"ref-ema-cross");
      }
   }
}
`;
export const REF_EMA_CROSSOVER_STRATEGY_ID = "ref-ema-crossover";
export const REF_EMA_CROSSOVER_VERSION = "1.0.0";
export const REF_EMA_CROSSOVER_SOURCE_FILE_NAME = "AT24_REF_EMA_CROSSOVER.mq5";
export const REF_EMA_CROSSOVER_DIALECT = "MQL5";
/** Deterministic (Q0.8.50/51) — the same function Q0.8's own import pipeline uses, exported here so a registry entry can record it as reproducibility metadata without recomputing it a second way. */
export const REF_EMA_CROSSOVER_SOURCE_HASH = computeSourceHash(REF_EMA_CROSSOVER_SOURCE);
const importResult = importMQLSource({
    sourceText: REF_EMA_CROSSOVER_SOURCE,
    fileName: REF_EMA_CROSSOVER_SOURCE_FILE_NAME,
    forcedDialect: REF_EMA_CROSSOVER_DIALECT,
    options: {
        strategyId: REF_EMA_CROSSOVER_STRATEGY_ID,
        strategyVersion: REF_EMA_CROSSOVER_VERSION,
        instrument: { symbol: "XAUUSD", assetClass: "metal" },
        executionTimeframe: "M5",
        // Fixed, not Date.now() (Q0.7's own determinism rule for anything that
        // feeds a semantic/content hash) - this module's exports must be
        // byte-identical across every process/run, matching Golden Strategy's
        // own fixed `metadata.createdAt` precedent.
        importedAt: Date.parse("2026-09-03T00:00:00Z"),
    },
});
const structuralValidation = validateStrategyIRStructure(importResult.ir);
if (!structuralValidation.valid) {
    // A hard, load-time invariant, not a runtime possibility: this exact
    // source string is committed, reviewed, and covered by
    // test/ref-ema-crossover-strategy.test.ts — if it ever stops importing
    // cleanly (e.g. an importer regression), every consumer of this module
    // must fail loudly and immediately, never silently serve a broken spec.
    throw new Error(`ref-ema-crossover-strategy: imported IR failed structural validation: ${JSON.stringify(structuralValidation)}`);
}
const eligibility = checkReductionEligibility(importResult.ir);
if (!eligibility.eligible) {
    throw new Error(`ref-ema-crossover-strategy: imported IR is not execution-eligible: ${eligibility.blockingReasons.join("; ")}`);
}
/** The real, imported Universal Strategy IR — kept for introspection/evidence (P3.8's future validation/evidence-gate work), not just discarded after reduction. */
export const REF_EMA_CROSSOVER_IR = importResult.ir;
const reduction = reduceStrategyIRToSpec(importResult.ir);
if (reduction.status === "BLOCKED" || !reduction.strategySpec) {
    // Structurally unreachable given the eligibility check above already
    // passed (eligibility and reducibility are the same underlying
    // question, checked twice on purpose - Q0.9's own reducer never
    // fabricates a spec for a BLOCKED reduction), kept as a real, typed
    // guard rather than a non-null assertion, matching P3.4's own
    // "never a non-null assertion where a real guard can exist" discipline.
    throw new Error(`ref-ema-crossover-strategy: reduction was BLOCKED despite passing eligibility: ${reduction.diagnostics.join("; ")}`);
}
/** The reduced, directly-executable StrategySpec — computed once at module load (the import pipeline is pure/deterministic, Q0.8.50/51), never re-imported per call. */
export const REF_EMA_CROSSOVER_SPEC = reduction.strategySpec;
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
export function buildRefEmaCrossoverSpec() {
    return REF_EMA_CROSSOVER_SPEC;
}
