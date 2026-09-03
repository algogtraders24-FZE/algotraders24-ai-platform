import type { StrategySpec } from "../domain/strategy-spec.js";
import { indicator } from "../domain/indicator-reference.js";
import { comparison, indicatorOperand, literal } from "../domain/expression.js";

/**
 * P3.2A — the canonical "Golden Strategy" reference definition, moved
 * here (from test/fixtures/simulation-fixtures.ts) so it has a single,
 * stable, publicly importable location — both the engine's own test
 * suite and any external consumer (e.g. the Native Chart Algo Test
 * integration) import this exact function, never a second copy. This
 * is deliberately the SAME strategy already used and hand-verified in
 * the P3.1 Backtest Truth Audit (docs/P3.1-FINDINGS.md F-1) — nothing
 * about its logic changed in this relocation.
 *
 * A minimal "PRICE" pseudo-indicator whose series is just each bar's
 * close (supplied via `indicatorSeries` exactly like a real computed
 * indicator would be) keeps the entry rule (PRICE > 100) simple and
 * independently hand-verifiable without needing a real SMA/EMA warmup
 * period to reason about. Against a real instrument whose price is
 * already far above 100 (e.g. XAUUSD), this rule is trivially and
 * permanently true — which is fine for this strategy's purpose (a
 * mechanically simple, deterministic, always-eligible-to-enter
 * scenario for proving the pipeline works end to end), not a defect.
 */
export const GOLDEN_STRATEGY_PRICE_INDICATOR = indicator("PRICE");

/**
 * P3.4 — the Golden Strategy's ONE genuine, signal-affecting strategy
 * parameter: the entry condition is `PRICE > priceThreshold`. Everything
 * else configurable-looking in this spec (position-sizing quantity,
 * stop-loss distance, take-profit R-multiple) was risk/execution
 * configuration, not a strategy parameter, and was deliberately NOT
 * exposed in P3.4 — see docs/P3.4-STRATEGY-PARAMETERS.md's audit section
 * for the full category-by-category reasoning. P3.5 (below) is the
 * sprint that deliberately opens that category-#2 slot up, on its own
 * terms — see docs/P3.5-RISK-CONFIGURATION.md.
 */
export const GOLDEN_STRATEGY_DEFAULT_PRICE_THRESHOLD = 100;

/**
 * P3.5 — the three risk/execution values P3.4 identified as category #2
 * ("real, currently-hardcoded configuration values... not exposed" —
 * P3.4-STRATEGY-PARAMETERS.md section 1) and deliberately left out of
 * that sprint's scope. Threaded through the SAME shapes already declared
 * by domain/risk-specification.ts (sizing.method stays "fixed-quantity",
 * stopLoss.type stays "fixed-distance", takeProfit.type stays
 * "risk-multiple") — P3.5 does not invent a new risk representation, it
 * makes the existing hardcoded one configurable. See
 * docs/P3.5-RISK-CONFIGURATION.md.
 */
export const GOLDEN_STRATEGY_DEFAULT_POSITION_SIZE_QUANTITY = 1;
export const GOLDEN_STRATEGY_DEFAULT_STOP_LOSS_DISTANCE = 5;
export const GOLDEN_STRATEGY_DEFAULT_TAKE_PROFIT_R_MULTIPLE = 2;

export interface GoldenStrategyParams {
  /** Defaults to GOLDEN_STRATEGY_DEFAULT_PRICE_THRESHOLD (100) — omitting this, or calling buildGoldenStrategySpec() with no arguments at all, produces a byte-identical StrategySpec to every pre-P3.4 caller (Q0.5-P3.3), so `resultHash` for the default configuration is unaffected by this change. */
  readonly priceThreshold?: number;
  /** P3.5. Defaults to GOLDEN_STRATEGY_DEFAULT_POSITION_SIZE_QUANTITY (1) — maps to `risk.sizing.quantity` (method stays "fixed-quantity"). */
  readonly positionSizeQuantity?: number;
  /** P3.5. Defaults to GOLDEN_STRATEGY_DEFAULT_STOP_LOSS_DISTANCE (5) — maps to `risk.stopLoss.distance` (type stays "fixed-distance"). */
  readonly stopLossDistance?: number;
  /** P3.5. Defaults to GOLDEN_STRATEGY_DEFAULT_TAKE_PROFIT_R_MULTIPLE (2) — maps to `risk.takeProfit.rMultiple` (type stays "risk-multiple"). */
  readonly takeProfitRMultiple?: number;
}

/**
 * P3.4 (additive, backward-compatible): gained an optional `params`
 * argument. `buildGoldenStrategySpec()` and `buildGoldenStrategySpec({})`
 * both still produce the EXACT pre-P3.4 spec (same `parameters: []`, same
 * `literal(100)` entry threshold) — no existing caller (the engine's own
 * 1095+ test suite, P3.2A/P3.2B/P3.3's `run-golden-backtest.ts`) needed to
 * change. `spec.parameters` is deliberately left `[]` regardless of
 * whether `priceThreshold` is overridden: that declarative field has no
 * runtime consumer anywhere in this engine (confirmed by audit — see the
 * P3.4 doc), so populating it would only add a cosmetic, unused entry that
 * changes `computeSemanticStrategyHash`'s output for NO behavioral reason
 * — the actual parameter effect is already fully captured in the
 * `resultHash` via the entry rule's own `literal(priceThreshold)`, which
 * is exactly where a real behavioral difference belongs. The frontend
 * Strategy Registry (services/algo-test/strategy-registry.ts) is this
 * parameter's authoritative, user-facing schema declaration.
 */
export function buildGoldenStrategySpec(params: GoldenStrategyParams = {}): StrategySpec {
  const priceThreshold = params.priceThreshold ?? GOLDEN_STRATEGY_DEFAULT_PRICE_THRESHOLD;
  const positionSizeQuantity = params.positionSizeQuantity ?? GOLDEN_STRATEGY_DEFAULT_POSITION_SIZE_QUANTITY;
  const stopLossDistance = params.stopLossDistance ?? GOLDEN_STRATEGY_DEFAULT_STOP_LOSS_DISTANCE;
  const takeProfitRMultiple = params.takeProfitRMultiple ?? GOLDEN_STRATEGY_DEFAULT_TAKE_PROFIT_R_MULTIPLE;
  return {
    identity: { strategyId: "sim-golden", name: "Simulation Golden Fixture Strategy" },
    version: "1.0.0",
    metadata: { createdAt: Date.parse("2026-01-05T00:00:00Z") },
    instruments: [{ symbol: "SIMFIXTURE", assetClass: "other" }],
    timeframes: ["H1"],
    parameters: [],
    entryRules: [
      {
        id: "entry-price-above-100",
        direction: "BUY",
        condition: comparison(">", indicatorOperand(GOLDEN_STRATEGY_PRICE_INDICATOR), literal(priceThreshold)),
      },
    ],
    exitRules: [],
    risk: {
      sizing: { method: "fixed-quantity", quantity: positionSizeQuantity },
      stopLoss: { type: "fixed-distance", distance: stopLossDistance },
      takeProfit: { type: "risk-multiple", rMultiple: takeProfitRMultiple },
    },
    execution: { fillModel: "next-bar-open", costsExplicitlyZero: true },
  };
}
