// services/algo-test/strategy-registry.ts
// P3.3 - Algo Test Productization & Strategy Registry.
//
// The explicit, server-side source of truth for "which strategies exist,
// which version are they at, and which symbol/timeframe combinations do
// they support" - replacing P3.2B's hardcoded SUPPORTED_STRATEGY_IDS /
// SUPPORTED_SYMBOLS / SUPPORTED_TIMEFRAMES constants (algo-test.service.ts)
// with one place a new strategy is registered, never a rewrite of the
// validation logic that reads it. Registering a strategy here does not
// build a second execution engine - every registered strategy still runs
// through at24-quant-engine's own runSimulation()/StrategySpec, exactly as
// P3.2B already proved for the Golden Strategy.
//
// P3.3 registers exactly ONE strategy, deliberately: the Golden Strategy.
// No artificial second entry is added just to prove the registry is
// "really" a registry - see docs/P3.3-STRATEGY-REGISTRY.md.
import { buildGoldenStrategySpec } from "at24-quant-engine";

/** SignalTimeframe-shaped (matches the rest of the app's request convention, e.g. "5m") - see algo-test.service.ts's own SIGNAL_TIMEFRAME_TO_ENGINE_TIMEFRAME mapping for the engine-token conversion. */
export type AlgoTestCapabilityTimeframe = string;

export interface StrategyDefinition {
  readonly strategyId: string;
  /**
   * Read directly off the engine's own StrategySpec.version at module load
   * (buildGoldenStrategySpec().version) - never a duplicated string literal
   * that could silently drift from what the engine itself declares.
   */
  readonly strategyVersion: string;
  readonly displayName: string;
  readonly description: string;
  /** Single source of truth for the Capability Registry - never a second, independent symbol/timeframe list elsewhere. */
  readonly supportedSymbols: readonly string[];
  readonly supportedTimeframes: readonly AlgoTestCapabilityTimeframe[];
  readonly status: "available";
}

const goldenSpec = buildGoldenStrategySpec();

/**
 * The registry. Adding a second strategy later means adding one more
 * entry here (and, separately, a real StrategySpec for it to run against)
 * - never touching the validation/persistence code that reads this array.
 */
export const STRATEGY_REGISTRY: readonly StrategyDefinition[] = [
  {
    strategyId: "golden",
    strategyVersion: goldenSpec.version,
    displayName: "Golden Strategy",
    description: "AT24's canonical reference strategy (at24-quant-engine's buildGoldenStrategySpec()) - the same strategy validated end-to-end in P3.2B, unchanged.",
    supportedSymbols: ["XAUUSD"],
    supportedTimeframes: ["5m"],
    status: "available",
  },
];

export function getStrategyDefinition(strategyId: string): StrategyDefinition | undefined {
  return STRATEGY_REGISTRY.find((s) => s.strategyId === strategyId);
}

export function listAvailableStrategies(): readonly StrategyDefinition[] {
  return STRATEGY_REGISTRY.filter((s) => s.status === "available");
}

/** True only for a strategyId that is both registered AND currently available - a registry entry with a future non-"available" status (none exist today) would not pass this. */
export function isStrategyAvailable(strategyId: string): boolean {
  return getStrategyDefinition(strategyId)?.status === "available";
}
