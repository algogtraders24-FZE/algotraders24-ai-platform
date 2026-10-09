// lib/auth/mfa.ts
// (Pure - no I/O.) Two-factor authentication with an authenticator app (Supabase TOTP).
// A user who enrolled a TOTP factor has `nextLevel = "aal2"`; until they enter a code in the current session they are still at
// `currentLevel = "aal1"`. Enforcement is behind MFA_ENFORCE=true so enrolling can be tested first, and switched off instantly
// (remove the variable) if anything ever goes wrong - nobody can be locked out by a code bug.

export type AalLevel = string | null | undefined; // Supabase: "aal1" | "aal2"

export function mfaEnforced(raw: string | undefined | null = process.env.MFA_ENFORCE): boolean {
  return (raw ?? "").trim().toLowerCase() === "true";
}

/** What the gate must do for a signed-in request: let it through, or send the user to enter their authenticator code. */
export function mfaDecision(aal: { currentLevel: AalLevel; nextLevel: AalLevel }, enforce: boolean): "allow" | "challenge" {
  if (!enforce) return "allow";
  return aal.nextLevel === "aal2" && aal.currentLevel !== "aal2" ? "challenge" : "allow";
}

/** Same-origin relative paths only (the redirect target comes from a query string an attacker could set). */
export function safeNext(target: string | null | undefined, fallback = "/dashboard"): string {
  if (!target || !target.startsWith("/") || target.startsWith("//") || target.startsWith("/\\")) return fallback;
  return target;
}

/** A TOTP code is exactly six digits; spaces a user may type are ignored. */
export function normalizeTotp(input: string): string | null {
  const digits = input.replace(/\s+/g, "");
  return /^\d{6}$/.test(digits) ? digits : null;
}
