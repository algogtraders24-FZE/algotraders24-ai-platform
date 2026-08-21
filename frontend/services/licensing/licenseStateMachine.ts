// services/licensing/licenseStateMachine.ts
// Sprint M11 - Deterministic License state machine (brief section 4).
// Pure, DB-free, platform-free - the ONLY place license state transitions
// are decided. Every transition not explicitly listed in TRANSITIONS is
// invalid and fails closed (returns ok:false), never silently allowed.
import type { LicenseStatus } from "@/types/marketplace-license";

export type LicenseEvent = "ACTIVATE" | "SUSPEND" | "REINSTATE" | "REVOKE" | "EXPIRE";

export type TransitionResult = { ok: true; next: LicenseStatus } | { ok: false; reason: string };

// REVOKED and EXPIRED are terminal - no event ever leaves them (a revoked
// or expired license must be re-issued as a new License row, never
// resurrected in place; this is what keeps revocation history real - see
// M11 brief section 15, "never silently delete license history").
const TRANSITIONS: Record<LicenseStatus, Partial<Record<LicenseEvent, LicenseStatus>>> = {
  ISSUED: { ACTIVATE: "ACTIVE", REVOKE: "REVOKED", EXPIRE: "EXPIRED" },
  ACTIVE: { SUSPEND: "SUSPENDED", REVOKE: "REVOKED", EXPIRE: "EXPIRED" },
  SUSPENDED: { REINSTATE: "ACTIVE", REVOKE: "REVOKED", EXPIRE: "EXPIRED" },
  REVOKED: {},
  EXPIRED: {},
};

export function canTransition(current: LicenseStatus, event: LicenseEvent): boolean {
  return TRANSITIONS[current]?.[event] !== undefined;
}

export function transition(current: LicenseStatus, event: LicenseEvent): TransitionResult {
  const next = TRANSITIONS[current]?.[event];
  if (!next) {
    return { ok: false, reason: `Invalid transition: ${event} is not allowed from ${current}.` };
  }
  return { ok: true, next };
}

export function isTerminal(status: LicenseStatus): boolean {
  return status === "REVOKED" || status === "EXPIRED";
}

// A license may run RuntimeValidation (M11 brief section 9) only in this
// one state - ISSUED (never activated) and every terminal/suspended state
// must fail closed.
export function isUsable(status: LicenseStatus): boolean {
  return status === "ACTIVE";
}
