import type { IndicatorInputField } from "../indicator.js";
import type { Timeframe } from "../market-data.js";

/** Q0.7.5 — the 6 indicator families AT24 already implements (indicators/*.ts), named explicitly so a translator can target a known, tested implementation rather than a generic call. */
export type NamedIndicatorFamily = "SMA" | "EMA" | "RSI" | "ATR" | "MACD" | "BOLLINGER_BANDS";

export interface NamedIndicatorIR {
  readonly kind: "named";
  readonly family: NamedIndicatorFamily;
  readonly params: readonly (number | string)[];
  readonly inputs?: readonly IndicatorInputField[];
  readonly timeframe?: Timeframe;
}

/**
 * Q0.7.5 — a generic escape hatch for any indicator AT24 does not (yet)
 * ship a named implementation for. Does NOT implement "hundreds of
 * indicators" (explicitly out of scope) — it only gives the IR a way to
 * RECORD that a source strategy used one, with enough structure
 * (name/parameters/inputs/timeframe/source/warmup/outputFields) that a
 * future sprint can either add a matching NamedIndicatorFamily or mark it
 * UNSUPPORTED, never silently drop it.
 */
export interface IndicatorCall {
  readonly kind: "generic";
  readonly name: string;
  readonly parameters: readonly (number | string | boolean)[];
  readonly inputs: readonly IndicatorInputField[];
  readonly timeframe?: Timeframe;
  readonly source?: string;
  readonly warmup?: number;
  readonly outputFields: readonly string[];
}

export type IndicatorIR = NamedIndicatorIR | IndicatorCall;
