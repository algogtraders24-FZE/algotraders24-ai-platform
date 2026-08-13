// lib/intelligence/cron-auth.ts
// Sprint D2.7.10 - Historical Validation Automatic Scheduler.
//
// Extracted from app/api/private/admin/intelligence/evaluate-outcomes/
// route.ts (D2.7.9) so it can be unit-tested directly with plain Web API
// Request objects, with zero dependency on Next.js's request-scoped APIs
// (unlike requireAdmin/SessionService, which need a real request context).
// Behavior is byte-identical to the D2.7.9 original - this is a pure move,
// not a rewrite.
import { timingSafeEqual } from "crypto";
import { loadIntelligenceEvaluationCronSecret } from "@/lib/intelligence/evaluation-env";

/** Constant-time string comparison - never a plain `===` on a secret. Unequal lengths short-circuit (a minor, accepted length leak; still far safer than naive comparison). */
export function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * True when the request carries a valid `Authorization: Bearer <secret>`
 * header matching the configured cron secret (see
 * loadIntelligenceEvaluationCronSecret - accepts either the original
 * INTELLIGENCE_EVALUATION_CRON_SECRET name or Vercel's native CRON_SECRET
 * auto-injection, sprint D2.7.10 §7-8). False whenever the secret isn't
 * configured at all - never treated as "accept anyone."
 */
export function isValidCronSecret(req: Request): boolean {
  const configured = loadIntelligenceEvaluationCronSecret();
  if (!configured) return false;
  const header = req.headers.get("authorization");
  if (!header || !header.startsWith("Bearer ")) return false;
  const presented = header.slice("Bearer ".length).trim();
  if (presented.length === 0) return false;
  return safeCompare(presented, configured);
}
