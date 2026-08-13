// lib/intelligence/evaluation-env.ts
// Sprint D2.7.9 - Historical Validation Production Wiring. Mirrors
// lib/payments/env.ts's pattern exactly: the scheduled outcome-evaluation
// trigger's shared-secret auth is optional at the platform level (no cron
// is required to run this app) - returns null when absent rather than
// throwing. The trigger route treats a null secret as "cron-secret auth
// disabled", falling back to admin-session auth only - never as "any
// caller is accepted."
export function loadIntelligenceEvaluationCronSecret(): string | null {
  const secret = process.env.INTELLIGENCE_EVALUATION_CRON_SECRET;
  if (!secret || secret.trim().length === 0) return null;
  return secret;
}
