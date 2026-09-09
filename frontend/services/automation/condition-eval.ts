// services/automation/condition-eval.ts
// AT24 Automation (MVP) - deterministic, server-side condition evaluation.
//
// LOCKED (AUTOMATION_EXECUTION_CONTRACT.md §5):
//   - 6 operators: gte gt lte lt eq neq.
//   - Numeric ops coerce both sides to number and FAIL CLOSED (result:false,
//     the step is still OK) when either side is NaN / missing - a missing
//     metric is "condition not met", never an error.
//   - eq/neq are strict, same-type compares.
//   - The full { left, op, right, result } is returned and persisted so the
//     Run Detail UI can show "78 >= 75" verbatim.

import type { AutomationConditionOp } from "@/types/automation";
import { resolveContextPath, type AutomationRunContext } from "./context-path";

export interface ConditionSpec {
  left: string; // restricted context path
  op: AutomationConditionOp;
  right: string | number | boolean;
}

export interface ConditionResult {
  left: unknown;
  op: AutomationConditionOp;
  right: string | number | boolean;
  result: boolean;
  /** Set when the outcome is "not met because an operand was missing/NaN". */
  note?: string;
}

const NUMERIC_OPS: ReadonlySet<AutomationConditionOp> = new Set(["gte", "gt", "lte", "lt"]);

export function evaluateCondition(spec: ConditionSpec, ctx: AutomationRunContext): ConditionResult {
  const left = resolveContextPath(spec.left, ctx);
  const { op, right } = spec;

  if (NUMERIC_OPS.has(op)) {
    const l = toNumber(left);
    const r = toNumber(right);
    if (Number.isNaN(l) || Number.isNaN(r)) {
      return {
        left,
        op,
        right,
        result: false,
        note:
          Number.isNaN(l) && left === undefined
            ? `left path "${spec.left}" resolved to undefined`
            : "a numeric operand is not a number",
      };
    }
    const result =
      op === "gte" ? l >= r : op === "gt" ? l > r : op === "lte" ? l <= r : l < r;
    return { left, op, right, result };
  }

  // eq / neq - strict, same-type
  if (left === undefined) {
    return { left, op, right, result: op === "neq", note: `left path "${spec.left}" resolved to undefined` };
  }
  const sameType = typeof left === typeof right;
  const equal = sameType && left === right;
  return { left, op, right, result: op === "eq" ? equal : !equal };
}

function toNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return n;
  }
  if (typeof v === "boolean") return NaN; // never numerically compare a boolean
  return NaN;
}
