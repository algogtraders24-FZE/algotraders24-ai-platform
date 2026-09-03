// services/algo-test/strategy-registry.ts
// P3.3 - Algo Test Productization & Strategy Registry.
// P3.6 - Multi-Strategy Registry + Generic Strategy Contract
// (docs/ALGO_TESTING_PRO_ROADMAP.md section 7,
// docs/P3.6-MULTI-STRATEGY-REGISTRY.md): this is no longer "the Golden
// Strategy registry that happens to be shaped like a registry" - every
// entry (Golden Strategy's own engine-authored spec, and the P3.6
// reference strategy's genuinely MQL5-imported spec) is produced through
// the exact same StrategyDefinition contract and the exact same
// `buildSpec(overrides)` mechanism. algo-test.service.ts never asks
// "which strategy is this" - it calls `strategy.buildSpec(parameters)`
// and runs whatever comes back. Adding a third strategy means adding one
// more array entry with its own `buildSpec` - never touching this file's
// validation/lookup logic, never a strategyId branch anywhere else.
// P3.7 - Generic Parameter Engine (docs/ALGO_TESTING_PRO_ROADMAP.md
// section 8, docs/P3.7-GENERIC-PARAMETER-ENGINE.md): for ENGINE-REFERENCE
// strategies specifically (see that doc for why MQL-imported strategies
// are explicitly out of scope this phase), the per-strategy hand-written
// override-mapping function (P3.4/P3.5/P3.6's own `toGoldenStrategyOverrides`)
// is replaced by ONE generic function, `pickNumericOverrides`, driven
// entirely by the strategy's own declared parameter metadata - adding a
// new engine-reference strategy's numeric parameter needs a metadata
// entry and nothing else, no new per-field mapping code. `category` is
// now a real, formal field on StrategyParameterDefinition (P3.4's own
// signal/risk/execution/provider taxonomy, previously only prose in
// comments).
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
import {
  buildGoldenStrategySpec,
  GOLDEN_STRATEGY_DEFAULT_PRICE_THRESHOLD,
  GOLDEN_STRATEGY_DEFAULT_POSITION_SIZE_QUANTITY,
  GOLDEN_STRATEGY_DEFAULT_STOP_LOSS_DISTANCE,
  GOLDEN_STRATEGY_DEFAULT_TAKE_PROFIT_R_MULTIPLE,
  GOLDEN_STRATEGY_PRICE_INDICATOR,
  GOLDEN_STRATEGY_IMPORT_STAGES,
  buildRefEmaCrossoverSpec,
  REF_EMA_CROSSOVER_SOURCE_HASH,
  REF_EMA_CROSSOVER_SOURCE_FILE_NAME,
  REF_EMA_CROSSOVER_DIALECT,
  REF_EMA_CROSSOVER_IMPORT_STAGES,
  computeSemanticStrategyHash,
  calculateSeries,
  ema,
  indicator,
  indicatorKey,
  type StrategySpec,
  type OHLCVBar,
  type StageResult,
} from "at24-quant-engine";

/** SignalTimeframe-shaped (matches the rest of the app's request convention, e.g. "5m") - see algo-test.service.ts's own SIGNAL_TIMEFRAME_TO_ENGINE_TIMEFRAME mapping for the engine-token conversion. */
export type AlgoTestCapabilityTimeframe = string;

/**
 * P3.6 - where a registered strategy's StrategySpec actually comes from.
 * "engine-reference" = authored directly as TypeScript in
 * at24-quant-engine/src/reference/ (Golden Strategy). "mql-import" =
 * produced by running a real MQL4/MQL5 source string through
 * importMQLSource() -> reduceStrategyIRToSpec() (see
 * ref-ema-crossover-strategy.ts). Every future adapter this roadmap names
 * (cTrader/cBot, NinjaScript, Pine, natural language, direct IR - see
 * docs/ALGO_TESTING_PRO_ROADMAP.md's architecture diagram) adds its own
 * `kind` here, never a special case in the code that CONSUMES `source` -
 * nothing outside this type declaration and the two display strings in
 * algo-test-formatting (frontend-only, informational) branches on `kind`.
 */
export type StrategySource =
  | { readonly kind: "engine-reference"; readonly module: string }
  | { readonly kind: "mql-import"; readonly dialect: "MQL4" | "MQL5"; readonly sourceFileName: string; readonly sourceHash: string };

/**
 * P3.6 - reproducibility metadata (docs/ALGO_TESTING_PRO_ROADMAP.md
 * section 5). `baseContentHash` is `computeSemanticStrategyHash()` of the
 * strategy's DEFAULT-parameter StrategySpec, computed once at registry
 * load time - a fixed, inspectable fingerprint of "what this registry
 * entry's unmodified behavior actually is," independent of whatever
 * parameters a given run later overrides (a run's own `strategyHash`,
 * P3.5's own finding, already reflects THOSE overrides - this field is
 * about the registry entry's own pinned identity, not any one run).
 */
export interface StrategyReproducibility {
  readonly baseContentHash: string;
}

/**
 * P3.4 - the only three parameter types the Golden Strategy actually
 * needs (a single "number" parameter today) - not a generic dynamic-form
 * type system built ahead of proven need. "select" carries its options in
 * `options`; "number"/"integer" carry `min`/`max`/`step` where meaningful.
 */
export type StrategyParameterType = "number" | "integer" | "boolean" | "select";

/**
 * P3.7 - P3.4's own audit taxonomy (docs/P3.4-STRATEGY-PARAMETERS.md
 * section 1), formalized as a real field instead of only prose in
 * comments: "signal" = a category-#1 genuine, signal-affecting parameter
 * (safely exposable - e.g. Golden's `priceThreshold`). "risk" =
 * category-#2 execution/risk configuration (position sizing,
 * stop-loss/take-profit - e.g. Golden's other three parameters).
 * "execution"/"provider" are reserved for category #3/#4
 * (engine-internals / data-provider configuration) - no registered
 * parameter uses them today, since P3.4's audit never found a safely-
 * exposable one of either kind, but the taxonomy names them so a future
 * parameter is classified deliberately, never left uncategorized.
 */
export type StrategyParameterCategory = "signal" | "risk" | "execution" | "provider";

export interface StrategyParameterDefinition {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly type: StrategyParameterType;
  readonly category: StrategyParameterCategory;
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
  /** P3.6 - see StrategySource's own doc comment. */
  readonly source: StrategySource;
  /** P3.6 - see StrategyReproducibility's own doc comment. */
  readonly reproducibility: StrategyReproducibility;
  /**
   * P3.6 - the ONE piece of genuinely per-strategy logic the generic
   * contract still needs: turning already-validated parameter overrides
   * into this strategy's own StrategySpec. Every strategy owns its own
   * `buildSpec` - algo-test.service.ts calls it identically for all of
   * them (`strategy.buildSpec(parameters)`), never branching on
   * `strategyId`. Called ONLY with output from validateParameterValues()
   * below (every declared parameter present, already type/range-checked)
   * - never a raw, unchecked client value.
   */
  readonly buildSpec: (overrides: Readonly<Record<string, number | boolean | string>>) => StrategySpec;
  /**
   * P3.6 - the OTHER genuinely per-strategy piece of logic the generic
   * contract needs: which indicators this strategy's entry conditions
   * actually reference, computed from real bars via at24-quant-engine's
   * own `calculateSeries()` (runtime/indicator-engine.ts) - never a
   * second, divergent indicator-math implementation. Same "each entry
   * owns it, run-backtest.ts never branches on strategyId" discipline as
   * `buildSpec`.
   */
  readonly buildIndicatorSeries: (bars: readonly OHLCVBar[]) => ReadonlyMap<string, readonly (number | boolean | undefined)[]>;
  /**
   * P3.8 - the IMPORTED/PARSED/IR_VALID/EXECUTION_VALID lifecycle stages
   * (docs/P3.8-VALIDATION-EVIDENCE-GATE.md), in canonical order, computed
   * ONCE by the strategy's own reference module (GOLDEN_STRATEGY_IMPORT_STAGES
   * / REF_EMA_CROSSOVER_IMPORT_STAGES - never recomputed here, never a
   * second source of truth). algo-test.service.ts combines these with the
   * per-run stages (DATA_VALID onward) it computes for a specific request.
   */
  readonly importLifecycle: readonly StageResult[];
}

const goldenSpec = buildGoldenStrategySpec();
const refEmaCrossoverSpec = buildRefEmaCrossoverSpec();

/**
 * P3.4 - the ONE genuine, signal-affecting strategy parameter this
 * strategy has (`priceThreshold`, defaultValue read from the engine's
 * own exported constant, never a duplicated literal). P3.5 adds the
 * three risk/execution parameters P3.4 deliberately excluded from that
 * sprint's scope (docs/P3.4-STRATEGY-PARAMETERS.md's audit) - these are
 * real StrategyParameterDefinition entries now, same mechanism, same
 * validateParameterValues() below, no new parameter-type system. See
 * docs/P3.5-RISK-CONFIGURATION.md. P3.7 - extracted to a named constant
 * (previously inline in the registry array) so `buildSpec` below can
 * derive its own parameter-id list from this SAME array - one list, not
 * two kept in sync by hand.
 */
const GOLDEN_PARAMETERS: readonly StrategyParameterDefinition[] = [
  {
    id: "priceThreshold",
    label: "Entry Price Threshold",
    description:
      "The entry condition requires the reference price to close strictly above this value. Defaults to 100 - for XAUUSD (which trades far above 100) the default makes this condition always true, matching the exact P3.3 canonical behavior. Raising it above the instrument's real price range will make the strategy never enter for that range - a genuine, well-defined outcome, not an error.",
    type: "number",
    category: "signal",
    defaultValue: GOLDEN_STRATEGY_DEFAULT_PRICE_THRESHOLD,
    min: 0,
    max: 1_000_000,
    required: false,
  },
  {
    id: "positionSizeQuantity",
    label: "Position Size (quantity)",
    description: "Fixed quantity opened per entry (risk.sizing, method fixed-quantity). Defaults to 1 - the P3.4-and-earlier hardcoded value.",
    type: "number",
    category: "risk",
    defaultValue: GOLDEN_STRATEGY_DEFAULT_POSITION_SIZE_QUANTITY,
    min: 0.0001,
    max: 1_000_000,
    required: false,
  },
  {
    id: "stopLossDistance",
    label: "Stop-Loss Distance",
    description:
      "Protective stop, expressed as a price distance from the signal price (risk.stopLoss, type fixed-distance). Defaults to 5 - the P3.4-and-earlier hardcoded value. A smaller distance closes losing positions sooner; changing it changes the run's reproducible strategy identity (strategyHash), not just its display.",
    type: "number",
    category: "risk",
    defaultValue: GOLDEN_STRATEGY_DEFAULT_STOP_LOSS_DISTANCE,
    min: 0.0001,
    max: 1_000_000,
    required: false,
  },
  {
    id: "takeProfitRMultiple",
    label: "Take-Profit (R-multiple)",
    description: "Profit target expressed as a multiple of the stop-loss distance (risk.takeProfit, type risk-multiple). Defaults to 2 - the P3.4-and-earlier hardcoded value.",
    type: "number",
    category: "risk",
    defaultValue: GOLDEN_STRATEGY_DEFAULT_TAKE_PROFIT_R_MULTIPLE,
    min: 0.0001,
    max: 1_000_000,
    required: false,
  },
];

/** Golden Strategy's own PRICE pseudo-indicator (its series is just each bar's close) - identical logic to run-golden-backtest.ts's own buildPriceIndicatorSeries(), duplicated deliberately rather than shared: each registry entry owns its own indicator-building logic end to end (the same discipline `buildSpec` follows), never a shared function multiple entries reach into. */
function buildGoldenIndicatorSeries(bars: readonly OHLCVBar[]): ReadonlyMap<string, readonly (number | boolean | undefined)[]> {
  return new Map([[indicatorKey(GOLDEN_STRATEGY_PRICE_INDICATOR), bars.map((b) => b.close)]]);
}

/** ref-ema-crossover's own EMA(9)/EMA(21) series, computed from real bars via the engine's own calculateSeries() fold over the real `ema` IndicatorDefinition (indicators/ema.ts) - not a second, hand-rolled EMA implementation. `null` (still-warming-up) maps to `undefined`, matching indicatorSeries' own established convention elsewhere in this codebase. */
function buildRefEmaCrossoverIndicatorSeries(bars: readonly OHLCVBar[]): ReadonlyMap<string, readonly (number | boolean | undefined)[]> {
  const fast = calculateSeries(ema, bars, { period: 9 }).map((v) => v ?? undefined);
  const slow = calculateSeries(ema, bars, { period: 21 }).map((v) => v ?? undefined);
  return new Map([
    [indicatorKey(indicator("EMA", 9)), fast],
    [indicatorKey(indicator("EMA", 21)), slow],
  ]);
}

/**
 * P3.7 - the ONE generic mechanism every engine-reference strategy uses to
 * turn already-validated overrides into its own typed build-params
 * object, replacing P3.4/P3.5/P3.6's hand-written, per-strategy
 * `toGoldenStrategyOverrides()`. Relies on one formal, now-documented
 * contract (see docs/P3.7-GENERIC-PARAMETER-ENGINE.md): a
 * StrategyParameterDefinition's `id` must equal the corresponding
 * optional field name in the strategy's own build-params interface
 * (e.g. `GoldenStrategyParams`), and today's engine-reference strategies'
 * build-params are all `number | undefined`. `overrides` is already
 * guaranteed by `validateParameterValues()` to carry only declared ids
 * with already-type-checked values - this function's own `typeof`
 * check is therefore redundant defense against a caller that bypassed
 * that contract, not a place new business logic lives. Given this,
 * adding a new engine-reference strategy's numeric parameter needs a
 * metadata entry (with a matching build-params field) and ONE call site
 * referencing its own parameter-id list - never a new hand-written
 * mapping function.
 */
export function pickNumericOverrides<K extends string>(parameterIds: readonly K[], overrides: Readonly<Record<string, number | boolean | string>>): Partial<Record<K, number>> {
  const picked: Partial<Record<K, number>> = {};
  for (const id of parameterIds) {
    const value = overrides[id];
    if (typeof value === "number") picked[id] = value;
  }
  return picked;
}

/**
 * The registry. Adding a strategy means adding one more entry here (and,
 * separately, a real StrategySpec-producing function for it to run
 * against) - never touching the validation/persistence code that reads
 * this array. Proven by this exact file: P3.6 added a second, genuinely
 * different strategy (an MQL5 import, not another engine-reference
 * function) without changing validateParameterValues(),
 * getStrategyDefinition(), listAvailableStrategies(), or
 * isStrategyAvailable() at all.
 */
export const STRATEGY_REGISTRY: readonly StrategyDefinition[] = [
  {
    strategyId: "golden",
    strategyVersion: goldenSpec.version,
    displayName: "Golden Strategy",
    description: "AT24's canonical reference strategy (at24-quant-engine's buildGoldenStrategySpec()) - the same strategy validated end-to-end in P3.2B, unchanged.",
    supportedSymbols: ["XAUUSD"],
    supportedTimeframes: ["5m"],
    source: { kind: "engine-reference", module: "at24-quant-engine/reference/golden-strategy" },
    reproducibility: { baseContentHash: computeSemanticStrategyHash(goldenSpec) },
    // P3.7 - the generic mechanism: derive the parameter-id list from
    // THIS strategy's own declared metadata (GOLDEN_PARAMETERS, the exact
    // array assigned to `parameters:` below - never a second, independent
    // id list), pick matching numeric overrides generically, pass them to
    // the engine's own typed build function. No per-field mapping code.
    buildSpec: (overrides) => buildGoldenStrategySpec(pickNumericOverrides(GOLDEN_PARAMETERS.map((p) => p.id), overrides)),
    buildIndicatorSeries: buildGoldenIndicatorSeries,
    importLifecycle: GOLDEN_STRATEGY_IMPORT_STAGES,
    parameters: GOLDEN_PARAMETERS,
    status: "available",
  },
  {
    strategyId: "ref-ema-crossover",
    strategyVersion: refEmaCrossoverSpec.version,
    displayName: "Reference: EMA Crossover (MQL5 import)",
    description:
      "P3.6's generic-import proof point: a real, single-file MQL5 EA (EMA(9)/EMA(21) crossover, no #include dependencies, no state machine) imported through at24-quant-engine's actual MQL importer - importMQLSource() -> reduceStrategyIRToSpec() - not authored directly as TypeScript like Golden Strategy. Deliberately not G01 - G01's real production EA (multi-file, state-machine dispatch) is not importable with today's importer; see docs/ALGO_TESTING_PRO_ROADMAP.md's \"Future: G01 Full Import Fidelity\" item.",
    supportedSymbols: ["XAUUSD"],
    supportedTimeframes: ["5m"],
    // No exposed Strategy Parameters: the source's one input
    // (InpLotSize) is category #2 (execution/risk configuration, P3.4's
    // own taxonomy), and there is no category-#1 signal parameter in
    // this source (the EMA periods 9/21 are compiled directly into the
    // imported IR, not exposed as MQL inputs) - see
    // ref-ema-crossover-strategy.ts's own doc comment.
    parameters: [],
    status: "available",
    source: {
      kind: "mql-import",
      dialect: REF_EMA_CROSSOVER_DIALECT,
      sourceFileName: REF_EMA_CROSSOVER_SOURCE_FILE_NAME,
      sourceHash: REF_EMA_CROSSOVER_SOURCE_HASH,
    },
    reproducibility: { baseContentHash: computeSemanticStrategyHash(refEmaCrossoverSpec) },
    // Overrides are intentionally ignored - see the "no exposed
    // parameters" note above. validateParameterValues() already rejects
    // any submitted key that isn't declared (this entry declares none),
    // so `buildSpec` is only ever called with an empty object in
    // practice; accepting the parameter keeps the generic-contract
    // signature identical for every registry entry.
    buildSpec: () => refEmaCrossoverSpec,
    buildIndicatorSeries: buildRefEmaCrossoverIndicatorSeries,
    importLifecycle: REF_EMA_CROSSOVER_IMPORT_STAGES,
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
