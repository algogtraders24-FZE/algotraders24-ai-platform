import type { Operand } from "../expression.js";
import type { ValidationResult } from "../validation-result.js";
import { ok, fail } from "../validation-result.js";

/**
 * Q0.11.3 — the canonical, platform-neutral price references a LIMIT/STOP
 * price may be expressed in. `ABSOLUTE`/`CLOSE`/`OPEN`/`HIGH`/`LOW`/
 * `INDICATOR_VALUE` are plain Q0.2/Q0.7 `Operand`s (never a second value
 * representation — "OPERAND" wraps the existing type verbatim). `MID`
 * (the reference bar's own `(high+low)/2`) and `ATR_OFFSET` (a base price
 * plus/minus an ATR-multiple distance, reusing the exact
 * `RiskLegBinding`-style arithmetic Q0.9/Q0.10 already established for
 * SL/TP/management legs) are the two references this package can compute
 * deterministically without a live bid/ask feed. `BID`/`ASK` are named
 * explicitly (not omitted) precisely so a detected `Bid`/`Ask`-based
 * price reference is recorded as `UNSUPPORTED`, never silently dropped or
 * approximated with an OHLCV proxy (Q0.11.3's own rule: "unsupported
 * references must BLOCK, never silently approximate").
 */
export type PriceReferenceKind = "ABSOLUTE" | "CLOSE" | "OPEN" | "HIGH" | "LOW" | "MID" | "BID" | "ASK" | "ATR_OFFSET" | "INDICATOR_VALUE";

export type PriceReference =
  | { readonly kind: "OPERAND"; readonly operand: Operand }
  | { readonly kind: "MID" }
  | { readonly kind: "ATR_OFFSET"; readonly base: Operand; readonly atrMultiple: number; readonly atrPeriod: number; readonly direction: "ADD" | "SUBTRACT" }
  | { readonly kind: "UNSUPPORTED"; readonly reason: "BID" | "ASK" };

export function priceReferenceKind(ref: PriceReference): PriceReferenceKind {
  switch (ref.kind) {
    case "OPERAND":
      if (ref.operand.kind === "literal") return "ABSOLUTE";
      if (ref.operand.kind === "indicator") return "INDICATOR_VALUE";
      return ref.operand.ref.series === "CLOSE" || ref.operand.ref.series === "OPEN" || ref.operand.ref.series === "HIGH" || ref.operand.ref.series === "LOW"
        ? (ref.operand.ref.series as "CLOSE" | "OPEN" | "HIGH" | "LOW")
        : "ABSOLUTE";
    case "MID":
      return "MID";
    case "ATR_OFFSET":
      return "ATR_OFFSET";
    case "UNSUPPORTED":
      return ref.reason;
  }
}

export function validatePriceReference(ref: PriceReference, path: string): ValidationResult {
  switch (ref.kind) {
    case "OPERAND":
    case "MID":
      return ok();
    case "ATR_OFFSET":
      if (!(ref.atrMultiple > 0)) return fail(`${path}: atrMultiple must be > 0`);
      if (!(ref.atrPeriod > 0)) return fail(`${path}: atrPeriod must be > 0`);
      return ok();
    case "UNSUPPORTED":
      return fail(`${path}: "${ref.reason}" is not a deterministically computable price reference (no live bid/ask feed exists in this simulation model) — never silently approximated with an OHLCV proxy`);
  }
}
