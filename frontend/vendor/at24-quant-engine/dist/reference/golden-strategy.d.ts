import type { StrategySpec } from "../domain/strategy-spec.js";
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
export declare const GOLDEN_STRATEGY_PRICE_INDICATOR: import("../domain/indicator-reference.js").IndicatorReference;
export declare function buildGoldenStrategySpec(): StrategySpec;
