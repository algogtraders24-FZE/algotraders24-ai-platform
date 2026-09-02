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
export function buildGoldenStrategySpec() {
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
                condition: comparison(">", indicatorOperand(GOLDEN_STRATEGY_PRICE_INDICATOR), literal(100)),
            },
        ],
        exitRules: [],
        risk: {
            sizing: { method: "fixed-quantity", quantity: 1 },
            stopLoss: { type: "fixed-distance", distance: 5 },
            takeProfit: { type: "risk-multiple", rMultiple: 2 },
        },
        execution: { fillModel: "next-bar-open", costsExplicitlyZero: true },
    };
}
