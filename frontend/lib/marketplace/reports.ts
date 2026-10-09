// lib/marketplace/reports.ts
// (Pure policy - no I/O. Safe for the browser and for scripts/validate-listing-reports.ts.)
// Seller self-serve Phase 5. Only a buyer who PAID for the listing can report it (keeps competitors and trolls out), one report per
// buyer; SUSPEND_THRESHOLD distinct buyers with an open report suspend the listing automatically. The platform owner's own listings
// are never auto-suspended (their reports are still recorded for the owner to read).

export const SUSPEND_THRESHOLD = 3;
export const MAX_DETAILS_CHARS = 1000;
export const MIN_DETAILS_CHARS = 10;

export const REPORT_REASONS = [
  { key: "MALWARE", label: "It contains malware or does something harmful" },
  { key: "FAKE_RESULTS", label: "The results or claims are fake or misleading" },
  { key: "NOT_AS_DESCRIBED", label: "It is not what the listing describes" },
  { key: "DOES_NOT_WORK", label: "It does not work at all" },
  { key: "COPYRIGHT", label: "It copies someone else's product" },
  { key: "OTHER", label: "Something else" },
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number]["key"];

export function isReportReason(v: unknown): v is ReportReason {
  return typeof v === "string" && REPORT_REASONS.some((r) => r.key === v);
}

/** Returns an error message, or null when the report is acceptable. */
export function validateReport(input: { reason: unknown; details: unknown }): string | null {
  if (!isReportReason(input.reason)) return "Please choose a reason.";
  const details = typeof input.details === "string" ? input.details.trim() : "";
  if (details.length < MIN_DETAILS_CHARS) return `Please describe the problem in at least ${MIN_DETAILS_CHARS} characters.`;
  if (details.length > MAX_DETAILS_CHARS) return `Please keep the description under ${MAX_DETAILS_CHARS} characters.`;
  return null;
}

export function shouldAutoSuspend(input: { distinctOpenReporters: number; publicationState: string; sellerIsPlatformOwner: boolean }): boolean {
  if (input.sellerIsPlatformOwner) return false;
  if (input.publicationState !== "PUBLISHED" && input.publicationState !== "READY") return false;
  return input.distinctOpenReporters >= SUSPEND_THRESHOLD;
}
