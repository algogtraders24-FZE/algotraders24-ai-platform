import type { RiskViolation, RiskViolationCode, RiskViolationReason, RiskViolationSeverity } from "../../domain/risk-evaluation.js";

export function makeViolation(
  code: RiskViolationCode,
  severity: RiskViolationSeverity,
  message: string,
  relevantValue: number | string | boolean | null,
  configuredLimit: number | string | boolean | null,
  reason: RiskViolationReason,
): RiskViolation {
  return { code, severity, message, relevantValue, configuredLimit, reason };
}
