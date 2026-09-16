// lib/ai/strategy-compiler/strategy-explainer.ts
// QP-2 - Conversational Strategy Builder (docs/architecture/
// QUANT_PRO_MASTER_ARCHITECTURE_LOCK.md, QP-2 decisions - explanation
// turns are deterministic, never an LLM call to paraphrase structured data
// this codebase already has). Renders an already-compiled StrategySpec
// (the SAME object compileNaturalLanguageStrategy() already produces -
// never a second interpretation of it) into plain-English lines. Pure,
// synchronous, client-safe - no network call, no provider, no randomness.
// Covers exactly the sub-shapes the AI compiler's own schema.ts can ever
// produce (fixed-quantity/percent-equity-risk sizing, fixed-distance/
// atr-multiple stop, fixed-distance/risk-multiple target, SMA/EMA/RSI/ATR
// indicators, comparison/logical expressions up to depth 4) - never
// fabricates a description for a field the compiled spec doesn't have set.
import type { StrategySpec, EntryRule, ExitRule } from "at24-quant-engine";
import type { Expression, Operand } from "at24-quant-engine";

function describeOperand(op: Operand): string {
  if (op.kind === "literal") return String(op.value);
  if (op.kind === "indicator") {
    const { name, params } = op.ref;
    if (name === "PRICE") return "price";
    return params.length > 0 ? `${name}(${params.join(",")})` : name;
  }
  // "series" operands are excluded from the AI compiler's own accepted
  // input (schema.ts) - never produced by compileNaturalLanguageStrategy().
  // Handled here only so this function never throws on a StrategySpec
  // built some other way, matching the "never fabricate, degrade honestly"
  // discipline the rest of this codebase uses for an unexpected shape.
  return "a raw price series reference";
}

const COMPARISON_WORDS: Readonly<Record<string, string>> = {
  ">": "is greater than",
  ">=": "is at or above",
  "<": "is less than",
  "<=": "is at or below",
  "==": "equals",
  "!=": "does not equal",
  cross_above: "crosses above",
  cross_below: "crosses below",
};

function describeExpression(expr: Expression): string {
  if (expr.type === "comparison") {
    const word = COMPARISON_WORDS[expr.operator] ?? expr.operator;
    return `${describeOperand(expr.left)} ${word} ${describeOperand(expr.right)}`;
  }
  if (expr.type === "logical") {
    const parts = expr.operands.map(describeExpression);
    if (expr.operator === "NOT") return `not (${parts[0] ?? ""})`;
    return parts.join(expr.operator === "AND" ? " and " : " or ");
  }
  // "boolean-reference" - not produced by the AI compiler's schema.ts
  // (deliberately excluded, same reasoning as the "series" operand above).
  return "a boolean condition";
}

function describeEntryRule(rule: EntryRule): string {
  return `${rule.direction} when ${describeExpression(rule.condition)}`;
}

function describeExitRule(rule: ExitRule): string {
  const scope = rule.appliesTo ? ` (applies to ${rule.appliesTo} positions only)` : "";
  return `Exit when ${describeExpression(rule.condition)}${scope}`;
}

function describeSizing(spec: StrategySpec["risk"]["sizing"]): string {
  if (spec.method === "fixed-quantity") return `a fixed quantity of ${spec.quantity} unit(s) per trade`;
  if (spec.method === "percent-equity-risk") return `${spec.percent}% of equity at risk per trade`;
  if (spec.method === "fixed-lot") return `a fixed ${spec.lots} lot(s) per trade`;
  return `${spec.atrMultiple}x ATR(${spec.atrPeriod}) risk-based sizing`;
}

function describeStopLoss(rule: StrategySpec["risk"]["stopLoss"]): string | undefined {
  if (!rule) return undefined;
  if (rule.type === "fixed-distance") return `a fixed stop-loss ${rule.distance} price unit(s) from entry`;
  if (rule.type === "atr-multiple") return `a stop-loss at ${rule.atrMultiple}x ATR(${rule.atrPeriod}) from entry`;
  return `a fixed stop-loss at price ${rule.price}`;
}

function describeTakeProfit(rule: StrategySpec["risk"]["takeProfit"]): string | undefined {
  if (!rule) return undefined;
  if (rule.type === "fixed-distance") return `a fixed take-profit ${rule.distance} price unit(s) from entry`;
  if (rule.type === "risk-multiple") return `a take-profit at ${rule.rMultiple}R (risk-multiple)`;
  return `a fixed take-profit at price ${rule.price}`;
}

/**
 * Renders a compiled StrategySpec as plain-English lines. Every line is
 * conditional on the underlying field actually being set - a field the
 * compiler never populated (e.g. no take-profit declared) is simply
 * omitted, never rendered as "none" or a guessed default.
 */
export function explainStrategySpec(spec: StrategySpec): string {
  const lines: string[] = [];

  lines.push(`**${spec.identity.name}**`);
  lines.push(`Instrument(s): ${spec.instruments.map((i) => i.symbol).join(", ")}`);
  lines.push(`Timeframe(s): ${spec.timeframes.join(", ")}`);

  if (spec.entryRules.length > 0) {
    lines.push("Entry rules:");
    for (const rule of spec.entryRules) lines.push(`  - ${describeEntryRule(rule)}`);
  }

  if (spec.exitRules.length > 0) {
    lines.push("Exit rules:");
    for (const rule of spec.exitRules) lines.push(`  - ${describeExitRule(rule)}`);
  }

  lines.push(`Position sizing: ${describeSizing(spec.risk.sizing)}`);

  const stopLossLine = describeStopLoss(spec.risk.stopLoss);
  if (stopLossLine) lines.push(`Stop-loss: ${stopLossLine}`);

  const takeProfitLine = describeTakeProfit(spec.risk.takeProfit);
  if (takeProfitLine) lines.push(`Take-profit: ${takeProfitLine}`);

  const assumptions: string[] = [`fill model: ${spec.execution.fillModel}`];
  if (spec.execution.costsExplicitlyZero) assumptions.push("zero spread/slippage/commission/fees (explicitly declared)");
  lines.push(`Execution assumptions: ${assumptions.join(", ")}`);

  return lines.join("\n");
}
