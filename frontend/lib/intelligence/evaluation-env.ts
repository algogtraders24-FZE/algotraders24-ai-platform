// lib/intelligence/evaluation-env.ts
// Sprint D2.7.9 - Historical Validation Production Wiring. Mirrors
// lib/payments/env.ts's pattern exactly: the scheduled outcome-evaluation
// trigger's shared-secret auth is optional at the platform level (no cron
// is required to run this app) - returns null when absent rather than
// throwing. The trigger route treats a null secret as "cron-secret auth
// disabled", falling back to admin-session auth only - never as "any
// caller is accepted."
//
// Sprint D2.7.10 - Historical Validation Automatic Scheduler. Vercel Cron
// has a documented, zero-extra-code auto-injection convention: if an env
// var literally named CRON_SECRET exists on the project, Vercel
// automatically sends `Authorization: Bearer <that value>` on every
// cron-triggered request (https://vercel.com/docs/cron-jobs/manage-cron-
// jobs#securing-cron-jobs). That name is NOT configurable - Vercel will
// never inject a differently-named variable. Rather than blindly renaming
// the established D2.7.9 secret (which would break any existing non-
// Vercel caller already configured against it) or introducing a second,
// independently-checked secret, this reads INTELLIGENCE_EVALUATION_
// CRON_SECRET first (the original, explicit name - works with any
// scheduler/manual caller) and falls back to CRON_SECRET (Vercel's native
// convention - works with zero extra configuration beyond setting that one
// env var in the Vercel dashboard). Both names authenticate through the
// exact same check in lib/intelligence/cron-auth.ts - one secret concept,
// two recognized source variables, never two independent secrets.
export function loadIntelligenceEvaluationCronSecret(): string | null {
  const primary = process.env.INTELLIGENCE_EVALUATION_CRON_SECRET;
  if (primary && primary.trim().length > 0) return primary;
  const vercelNative = process.env.CRON_SECRET;
  if (vercelNative && vercelNative.trim().length > 0) return vercelNative;
  return null;
}
