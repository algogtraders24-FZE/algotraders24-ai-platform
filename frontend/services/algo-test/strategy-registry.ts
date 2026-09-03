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
import { buildGoldenStrategySpec, GOLDEN_STRATEGY_DEFAULT_PRICE_THRESHOLD } from "at24-quant-engine";

/** SignalTimeframe-shaped (matches the rest of the app's request convention, e.g. "5m") - see algo-test.service.ts's own SIGNAL_TIMEFRAME_TO_ENGINE_TIMEFRAME mapping for the engine-token conversion. */
export type AlgoTestCapabilityTimeframe = string;

/**
 * P3.4 - the only three parameter types the Golden Strategy actually
 * needs (a single "number" parameter today) - not a generic dynamic-form
 * type system built ahead of proven need. "select" carries its options in
 * `options`; "number"/"integer" carry `min`/`max`/`step` where meaningful.
 */
export type StrategyParameterType = "number" | "integer" | "boolean" | "select";

export interface StrategyParameterDefinition {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly type: StrategyParameterType;
  readonly defaultValue: number | boolean | string;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  /** Only meaningful for type "select". */
  readonly options?: readonly string[];
  readonly required: boolean;
}

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
  /**
   * P3.4 - this version's immutable parameter schema (see
   * docs/P3.4-STRATEGY-PARAMETERS.md's audit). Belongs to THIS
   * strategyVersion specifically (Q0's own versioning discipline,
   * mirrored here): an incompatible future change to what a parameter
   * means requires a new strategyVersion, never a silent redefinition
   * under the same version.
   */
  readonly parameters: readonly StrategyParameterDefinition[];
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
    // P3.4 - exactly the ONE genuine, signal-affecting strategy parameter
    // this strategy has (see docs/P3.4-STRATEGY-PARAMETERS.md's audit for
    // why position-sizing/stop-loss-distance/take-profit-rMultiple are
    // deliberately excluded - they are risk configuration, not strategy
    // parameters). `defaultValue` is read from the engine's own exported
    // constant, never a duplicated literal.
    parameters: [
      {
        id: "priceThreshold",
        label: "Entry Price Threshold",
        description:
          "The entry condition requires the reference price to close strictly above this value. Defaults to 100 - for XAUUSD (which trades far above 100) the default makes this condition always true, matching the exact P3.3 canonical behavior. Raising it above the instrument's real price range will make the strategy never enter for that range - a genuine, well-defined outcome, not an error.",
        type: "number",
        defaultValue: GOLDEN_STRATEGY_DEFAULT_PRICE_THRESHOLD,
        min: 0,
        max: 1_000_000,
        required: false,
      },
    ],
    status: "available",
  },
];

export interface ParameterValidationFailure {
  readonly field: string;
  readonly message: string;
}

export type ParameterValidationResult =
  | { readonly ok: true; readonly normalized: Readonly<Record<string, number | boolean | string>> }
  | { readonly ok: false; readonly errors: readonly ParameterValidationFailure[] };

/**
 * P3.4 - the ONE authoritative place parameter values are validated
 * (section 7: "the frontend must not be the authoritative validator").
 * Never trusts a client-supplied schema/min/max/defaults - always reads
 * `strategy.parameters` (a server-resolved StrategyDefinition, itself only
 * ever produced by getStrategyDefinition() below), only ever consumes the
 * client's submitted VALUES. Every declared parameter always appears in
 * `normalized` (defaults filled in for anything omitted) so a run's
 * persisted snapshot is always the complete, unambiguous configuration
 * actually used - never a partial object a reader would have to guess
 * defaults for later.
 */
export function validateParameterValues(strategy: StrategyDefinition, submitted: Record<string, unknown> | undefined): ParameterValidationResult {
  const errors: ParameterValidationFailure[] = [];
  const submittedRecord = submitted ?? {};
  const declaredIds = new Set(strategy.parameters.map((p) => p.id));

  for (const key of Object.keys(submittedRecord)) {
    if (!declaredIds.has(key)) {
      errors.push({ field: key, message: `Unknown parameter "${key}" - not declared for strategy "${strategy.strategyId}"@"${strategy.strategyVersion}".` });
    }
  }

  const normalized: Record<string, number | boolean | string> = {};

  for (const param of strategy.parameters) {
    const hasValue = Object.prototype.hasOwnProperty.call(submittedRecord, param.id);
    const raw = hasValue ? submittedRecord[param.id] : undefined;

    if (!hasValue || raw === undefined) {
      if (param.required) {
        errors.push({ field: param.id, message: `Missing required parameter "${param.id}".` });
      } else {
        normalized[param.id] = param.defaultValue;
      }
      continue;
    }

    if (param.type === "number" || param.type === "integer") {
      if (typeof raw !== "number" || !Number.isFinite(raw)) {
        errors.push({ field: param.id, message: `Parameter "${param.id}" must be a finite number.` });
        continue;
      }
      if (param.type === "integer" && !Number.isInteger(raw)) {
        errors.push({ field: param.id, message: `Parameter "${param.id}" must be an integer.` });
        continue;
      }
      if (param.min !== undefined && raw < param.min) {
        errors.push({ field: param.id, message: `Parameter "${param.id}" must be >= ${param.min}, got ${raw}.` });
        continue;
      }
      if (param.max !== undefined && raw > param.max) {
        errors.push({ field: param.id, message: `Parameter "${param.id}" must be <= ${param.max}, got ${raw}.` });
        continue;
      }
      if (param.step !== undefined && param.step > 0) {
        const base = param.min ?? 0;
        const steps = (raw - base) / param.step;
        // Floating-point-safe "is this a whole number of steps" check (Q0's
        // own "never fail a legitimate value on float noise" discipline).
        if (Math.abs(steps - Math.round(steps)) > 1e-9) {
          errors.push({ field: param.id, message: `Parameter "${param.id}" must be a multiple of ${param.step} (from ${base}), got ${raw}.` });
          continue;
        }
      }
      normalized[param.id] = raw;
    } else if (param.type === "boolean") {
      if (typeof raw !== "boolean") {
        errors.push({ field: param.id, message: `Parameter "${param.id}" must be a boolean.` });
        continue;
      }
      normalized[param.id] = raw;
    } else if (param.type === "select") {
      if (typeof raw !== "string" || !(param.options ?? []).includes(raw)) {
        errors.push({ field: param.id, message: `Parameter "${param.id}" must be one of: ${(param.options ?? []).join(", ")}.` });
        continue;
      }
      normalized[param.id] = raw;
    }
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, normalized };
}

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
