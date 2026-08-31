/**
 * Q0.7.22 — the source strategy's OWN repainting behavior, as researched
 * in docs/Q0.4_LOOKAHEAD_REPAINTING.md. `UNKNOWN` is a legitimate,
 * honest value (a translator that cannot prove which category applies
 * must say so) — but per Q0.7.22's explicit rule, a strategy with
 * `UNKNOWN` (or `REPAINTING`) repainting status MUST NOT receive a clean
 * "validated" execution status from the IR validator (see
 * runtime/strategy-ir/ir-validator.ts).
 */
export type RepaintingModel = "NON_REPAINTING" | "CONFIRMED_ONLY" | "REALTIME_DEPENDENT" | "REPAINTING" | "UNKNOWN";

/**
 * Q0.7.23 — whether the source's actual behavior differs between these
 * four evaluation contexts. `false` for every field is the ONLY way to
 * claim "no asymmetry" — the IR never assumes it by omission.
 */
export interface RealtimeHistoricalAsymmetry {
  readonly historicalVsRealtimeDiffers: boolean;
  readonly barCloseVsIntrabarDiffers: boolean;
  readonly note?: string;
}

/**
 * Q0.7.24 — when a strategy's CONDITION is evaluated (distinct from
 * entry-exit-ir.ts's EntryTiming, which governs when a TRIGGERED entry's
 * order is submitted). Never assumed identical across platforms — Q0's
 * own `generateSignal()` is ON_BAR_CLOSE only (Q0.5.29), and this field
 * is exactly what lets a translator record that a source strategy used a
 * DIFFERENT timing without AT24 silently normalizing it away.
 */
export type BarCloseSemantics = "ON_BAR_OPEN" | "ON_BAR_CLOSE" | "INTRABAR" | "NEXT_BAR_OPEN" | "NEXT_BAR_CLOSE";
